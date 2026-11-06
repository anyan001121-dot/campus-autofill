// 表单识别与填充引擎。被 content.js（自动填充）和 popup.js（手动按钮）共用。
//
// 不联网、不调用任何 AI 接口（刻意的——"语义理解"得把页面发给模型，破坏"数据只留在本机"）。
//
// ── 为什么是现在这个结构（v2，2026-10 重写）──────────────────────────────
// v1 是"每个网站踩一个坑、补一条特例"：精确 label 文字、固定 placeholder、
// 固定的分区标题配对。换到某电商公司就全线失效——某电商公司的 label 是
// <div><span>*</span>学校名称:</div>（有子元素、带星号和冒号），v1 只认
// "无子元素且文字完全相等"的 label，一个都找不到；某互联网公司的 placeholder 是
// "请输入项目名称"，v1 只认"项目名称"，于是项目整段跳过、再被兜底规则把 5 个
// 项目拼成一大段塞进一个框。
//
// v2 拆成四层，每层都只依赖"所有网站都有"的结构，不依赖某个网站的写法：
//   1. 控件发现 discoverControls：把 antd v3/v4、Element UI、原生 select、
//      单选组、点开式只读输入框 统一成"控件"，一个复合组件只算一个控件。
//   2. 标签解析 resolveLabel：从控件往上爬，找到"只包含这一个控件"的最大容器，
//      容器里控件以外的文字就是它的标签（去掉 * 和冒号）。爬不到就用"DOM 顺序上
//      最近的前一段文字"，并记下中间隔了几个控件（part）——"起止时间"后面的
//      开始/结束、Moka 的 年/月/年/月 四个选择器靠这个归到同一个标签下。
//   3. 分区与行 buildModel：分区标题 = 匹配"教育/实习/项目/获奖…"且后面紧跟着
//      控件的短文字（导航栏的同名文字后面跟的是别的导航项，自然被排除）。
//      分区内第 N 次出现的"项目名称"属于第 N 行。
//   4. 填值 applyXxx：按控件类型分派，每种组件库一套点选方式。
//
// 重复条目（教育/项目/获奖…）的分配规则：先把"已经有内容"的行按名称对上
// profile 里的那一条（只补这行的空字段），剩下没用过的条目再按顺序进空行，
// 不够就点"添加"。这样同一条经历不会被重复填进多行（早期版本的重复填写问题）。
//
// ── v3（2026-10-20）：把历次出错归成四个根因，在底层各修一次 ─────────────
// 回看 某电商公司 / 某互联网公司 / Moka / 飞书 / 某德企(SmartRecruiters) 的每次故障，都不是
// "某个网站特殊"，而是下面四个假设之一不成立：
//   ① 假设"元素都在 document 里"——Shadow DOM、iframe、单页应用换页都不成立。
//      → 第 0 层：所有查找/比顺序/判包含都走 deepAll/closestDeep/domOrder；
//        manifest all_frames；网址变化时补跑。
//   ② 假设"控件长成某个组件库的样子"（.ant-select、.el-select…）——自研组件、
//      Web Components 一换就认不出类型。
//      → 先认 ARIA 语义（role=combobox/listbox/option、aria-label、label 属性），
//        class 名只是加分项；类型认错也能自愈（见③）。
//   ③ 假设"事件发出去 = 填上了"——飞书只认 mousedown、某电商公司只认原生 click、
//      SmartRecruiters 的候选框失焦就清空，以前都被当成"已填充"，静默漏填。
//      → 每次写入后读回验证；不成功按阶梯升级：
//        setter → 原生输入管线 insertText → 当成候选框打字选择；
//        合成点击 → 原生 click()。最后仍空着的字段在提示里列给用户手动补。
//   ④ 假设"规则列表里第一条命中的就是对的"——"最高学历专业"被"最高学历"抢、
//      "有兴趣在那里工作"被"兴趣"抢、"名字"在有"姓氏"时被当全名。
//      → bestRule：命中文字最长（最具体）的规则胜出，block 规则一票否决。
//
// 遇到新网站填不中：先在页面控制台跑
//   window.postMessage({ type: "AYA_DIAG" }, "*")
// 然后看 document.documentElement.dataset.ayaDiag（只含标签和字段名，不含个人信息），
// 看是"标签没认出来"、"分区没认出来"还是"控件类型没认出来"，再去对应那层改。

(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || "")
    .replace(/[（(](选填|必填|可选|非必填)[)）]/g, "")
    .replace(/[\s*＊:：]/g, "");
  const isVisible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const pad2 = (n) => String(n).padStart(2, "0");

  // ════════════════════════ 0. 穿透 Shadow DOM ════════════════════════
  // 踩过的坑（SmartRecruiters / 某德企）：Web Components 网站（spl-input、Shoelace、
  // Ionic、Salesforce LWC…）的输入框全在 shadow root 里，document.querySelectorAll
  // 一个都找不到，looksLikeForm() 直接判成"不是表单"，整页一个字段都不填。
  // 所以引擎里所有"找元素 / 比先后 / 判包含 / 往上爬"都走下面这组函数。
  // 普通页面没有 shadow root，结果和原生 API 完全一样。
  const shadowOf = (el) => el.shadowRoot ||
    (el.localName.includes("-") && typeof chrome !== "undefined" && chrome.dom && chrome.dom.openOrClosedShadowRoot
      ? chrome.dom.openOrClosedShadowRoot(el) : null); // 扩展里连 closed shadow root 也能进
  const parentDeep = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const containsDeep = (a, b) => { for (let n = b; n; n = parentDeep(n)) if (n === a) return true; return false; };
  const closestDeep = (el, sel) => { for (let n = el; n; n = parentDeep(n)) if (n.matches && n.matches(sel)) return n; return null; };
  // DOM 顺序遍历（shadow 内容排在宿主之后、宿主的 light 子节点之前）
  function deepAll(sel, root = document) {
    const out = [];
    const visit = (r) => {
      for (const el of r.querySelectorAll("*")) {
        if (el.matches(sel)) out.push(el);
        const sr = shadowOf(el);
        if (sr) visit(sr);
      }
    };
    visit(root);
    return out;
  }
  // 元素 → 它自己以及一路外层的 shadow 宿主（由内到外）
  const hostChain = (n) => { const c = [n]; let r; while ((r = n.getRootNode()) && r.host) { n = r.host; c.push(n); } return c; };
  const domOrder = (a, b) => {
    if (a === b) return 0;
    const ca = hostChain(a), cb = hostChain(b);
    for (let i = 0; i < ca.length; i++) {
      const j = cb.findIndex(y => y.getRootNode() === ca[i].getRootNode());
      if (j < 0) continue;
      const x = ca[i], y = cb[j];
      if (x === y) return i > j ? 1 : -1; // 一个在另一个的 shadow 里：宿主在前
      const pos = x.compareDocumentPosition(y);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    }
    return 0;
  };
  const before = (a, b) => domOrder(a, b) < 0;

  // ════════════════════════ 底层交互 ════════════════════════

  function setTextValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    // composed：事件能冒出 shadow root，监听挂在宿主组件上的也收得到
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    flash(el);
  }

  // 读回验证：组件"接没接受"只能事后看。got 和任一目标值去掉空白/星号后
  // 相等或互相包含（电话会被格式化成"138 0013 8000"、长文本可能被截断）就算成功
  const looksSet = (got, wants) => {
    const g = norm(got);
    if (!g) return false;
    return wants.filter(Boolean).some(w => { const n = norm(String(w)); return g === n || g.includes(n) || (g.length >= 2 && n.includes(g)); });
  };

  // 写文字：真实地 聚焦 → 写入 → 失焦，等组件处理完再读回来。
  //   ① 原生 setter + input/change（React/Vue/antd 都认）
  //   ② 被清空或没变 → execCommand("insertText")：走浏览器原生输入管线，
  //      等同于用户打字，组件库再怎么包装都会收到
  // 都不行返回 false，由调用方决定要不要当成"要选候选项的框"再试。
  async function writeText(el, v) {
    const once = async (how) => {
      if (typeof el.focus === "function") el.focus();
      how();
      await sleep(30);
      if (typeof el.blur === "function") el.blur();
      await sleep(120);
      return looksSet(el.value, [v]);
    };
    if (await once(() => setTextValue(el, v))) return true;
    return once(() => {
      if (typeof el.select === "function") el.select();
      if (!document.execCommand("insertText", false, v)) setTextValue(el, v);
      flash(el);
    });
  }

  function flash(el) {
    const old = el.style.outline;
    el.style.outline = "2px solid #1f4d3f";
    setTimeout(() => { el.style.outline = old; }, 1500);
  }

  // 不同组件库监听的事件不一样：飞书（Lark）只认 mousedown，antd v3 下拉认
  // click，有的认 pointerdown——统一派发完整序列。
  // keepFocus：点弹层里的翻页按钮/格子时不把焦点抢过去——飞书 ud__picker 的输入框
  // 一失焦面板就关，翻第二页时面板已经没了
  function fireClick(el, keepFocus) {
    // 带上元素中心的坐标：某游戏公司 Moka 的年份长列表按点击位置认选项，坐标是 0,0 就选成了列表第一项"2126"
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
    const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    el.dispatchEvent(new MouseEvent("mouseover", o));
    el.dispatchEvent(new MouseEvent("mousemove", o));
    el.dispatchEvent(new PointerEvent("pointerdown", o));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    if (!keepFocus && typeof el.focus === "function") el.focus();
    el.dispatchEvent(new PointerEvent("pointerup", o));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }

  // 只滚动装着选项的那个列表，不动整页（block: nearest 在列表里已可见时什么也不做）
  function scrollIntoList(el) {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.scrollHeight > a.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(a).overflowY)) {
        const r = el.getBoundingClientRect(), b = a.getBoundingClientRect();
        if (r.top < b.top) a.scrollTop -= (b.top - r.top) + 4;
        else if (r.bottom > b.bottom) a.scrollTop += (r.bottom - b.bottom) + 4;
        return;
      }
    }
  }

  // 收起没选中东西的面板：Escape 是大多数组件认的，再点一下空白处兜底。
  function closePanel() {
    let t = document.activeElement || document;
    while (t && t.shadowRoot && t.shadowRoot.activeElement) t = t.shadowRoot.activeElement;
    ["keydown", "keyup"].forEach(type =>
      t.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true, composed: true })));
    ["mousedown", "mouseup", "click"].forEach(type =>
      document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  }

  const POPUP_SEL = [
    ".ant-select-dropdown", ".ant-picker-dropdown", ".ant-calendar-picker-container", ".ant-cascader-menus",
    // 飞书 atsx（antd v3 改了前缀）
    ".atsx-select-dropdown", ".atsx-cascader-menus",
    ".el-popper", ".el-select-dropdown", ".el-picker-panel", "#aya-toast", "[role=listbox]",
    // 某科技公司（aui）：下拉面板、校验提示气泡（"必填"）
    ".aui-select-dropdown", ".aui-picker-panel", ".aui-date-picker", ".aui-tooltip__popper",
  ].join(",");

  // ════════════════════════ 1. 控件发现 ════════════════════════

  // 复合组件的根节点。顺序有讲究：cascader 在 v4 里也带 .ant-select，要先认。
  const WIDGETS = [
    { kind: "cascader", sel: ".ant-cascader-picker, .ant-select.ant-cascader, .el-cascader, .atsx-cascader-picker" },
    { kind: "date-range", sel: ".ant-picker-range, .el-range-editor" },
    { kind: "date", sel: ".ant-picker, .ant-calendar-picker, .el-date-editor" },
    // .atsx-select：飞书（某消费品公司登记表）的下拉。原来不认，里面的搜索小框被当成文本框，
    // 下面一格文本框就拿到了上面下拉的标签——"湖北武汉"填进了期望薪资、"前10%"填进了研究方向
    { kind: "select", sel: ".ant-select, .el-select, .atsx-select" },
    { kind: "radio", sel: ".ant-radio-group, .el-radio-group" },
  ];
  const WIDGET_SEL = WIDGETS.map(w => w.sel).join(",");
  const SKIP_TYPES = ["hidden", "submit", "button", "file", "password", "image", "reset", "search"];

  function discoverControls() {
    const ctrls = [];
    for (const el of deepAll(WIDGET_SEL)) {
      if (!isVisible(el) || closestDeep(el, POPUP_SEL)) continue;
      if (parentDeep(el) && closestDeep(parentDeep(el), WIDGET_SEL)) continue; // 只要最外层
      const w = WIDGETS.find(w => el.matches(w.sel));
      let kind = w.kind;
      // antd v3 的区间选择器根节点也是 .ant-calendar-picker
      if (kind === "date" && el.querySelector(".ant-calendar-range-picker-input")) kind = "date-range";
      ctrls.push({ kind, el, input: el.querySelector("input:not([type=radio]), textarea") });
    }
    const radioGroups = {};
    for (const el of deepAll("input, textarea, select")) {
      if (!isVisible(el) || closestDeep(el, WIDGET_SEL) || closestDeep(el, POPUP_SEL)) continue;
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (el.tagName === "SELECT") { ctrls.push({ kind: "native-select", el, input: el }); continue; }
      if (el.tagName === "TEXTAREA") { ctrls.push({ kind: "textarea", el, input: el }); continue; }
      if (type === "radio") { (radioGroups[el.name || Math.random()] = radioGroups[el.name] || []).push(el); continue; }
      if (type === "checkbox") { ctrls.push({ kind: "checkbox", el, input: el }); continue; }
      // type=search 一般是站内搜索框；但飞书 ud__select 的输入框也是 search + role=combobox
      if (SKIP_TYPES.includes(type) && !(type === "search" && el.getAttribute("role") === "combobox")) continue;
      // 只读、或者 placeholder 是"请选择"/"年"/"月"/"YYYY" 的输入框，基本都是
      // 点开才弹列表的自定义下拉（Moka、飞书都是这样），直接赋值组件不认。
      const ph = (el.getAttribute("placeholder") || "").trim();
      const isPicker = el.readOnly || /^(请选择|选择|年|月|YYYY|YYYY-MM|年份|月份)$/.test(ph);
      // 可输入的 combobox（ARIA 标准写法）：要打字 → 等候选 → 点选项，光写文字
      // 失焦就被清空（SmartRecruiters 的公司/学校/城市都是这样）
      // 没标 role 的自研下拉（某制造企业 phoenix-select 的输入框可打字、没 placeholder）：
      // 看外面几层有没有 select/picker/cascader/dropdown 字样的 class
      const inSelect = (() => {
        let a = el;
        for (let i = 0; i < 4 && a; i++, a = parentDeep(a)) {
          const cls = typeof a.className === "string" ? a.className : "";
          if (/(^|[\s_-])(select|picker|cascader|dropdown|combobox|autocomplete)/i.test(cls) && !/input-?group/i.test(cls)) return true;
        }
        return false;
      })();
      const isCombo = !isPicker && (el.getAttribute("role") === "combobox" || inSelect);
      ctrls.push({ kind: isPicker ? "picker" : isCombo ? "combo" : "text", el, input: el });
    }
    for (const radios of Object.values(radioGroups)) {
      let box = radios[0].parentElement;
      while (box && !radios.every(r => box.contains(r))) box = box.parentElement;
      ctrls.push({ kind: "radio", el: box || radios[0], input: null, radios });
    }
    return ctrls.sort((a, b) => domOrder(a.el, b.el));
  }

  // ════════════════════════ 2. 标签解析 ════════════════════════

  // 页面上的"短文字"按 DOM 顺序排成一列，和控件穿插在一起。标签解析和分区识别都
  // 在这条线性序列上做——这是对"标签和输入框在 DOM 里不相邻、只在视觉上相邻"
  // （Moka 用 Grid 分开摆）这类布局唯一稳定的信号。
  function deepTextNodes() {
    const out = [];
    const walk = (root) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (n.nodeType === Node.TEXT_NODE) { out.push(n); continue; }
        const sr = shadowOf(n);
        if (sr) walk(sr);
      }
    };
    walk(document.body);
    return out;
  }

  function collectTexts(ctrls) {
    const texts = [];
    for (const n of deepTextNodes()) {
      const p = n.parentElement || (n.parentNode && n.parentNode.host);
      if (!p || closestDeep(p, "script, style, noscript, option") || closestDeep(p, POPUP_SEL)) continue;
      const t = norm(n.textContent);
      if (!t || t.length > 30) continue;
      if (/^(请选择|请输入|请填写)/.test(t)) continue; // 下拉框里的占位文字，不是标签
      if (!isVisible(p)) continue;
      if (ctrls.some(c => containsDeep(c.el, p))) continue; // 控件自己的显示文字（已选值、选项文字）不算
      texts.push({ node: n, el: p, text: t });
    }
    return texts;
  }

  // "从 / 至"这种只有一个字的日期标签，统一成引擎认识的"开始时间 / 结束时间"
  const canonLabel = (t) => /^(从|自|起|开始|from|start)$/i.test(t) ? "开始时间"
    : /^(至|到|止|结束|to|until|end)$/i.test(t) ? "结束时间" : t;

  // 显式标签：<label for> / el.labels / aria-labelledby / aria-label / Web Component
  // 宿主上的 label 属性（<spl-input label="名字">、<sl-input label=…>）
  function explicitLabel(inp) {
    if (!inp) return null;
    const root = inp.getRootNode();
    const lab = (inp.labels && inp.labels[0]) ||
      (inp.id && root.querySelector && root.querySelector(`label[for="${CSS.escape(inp.id)}"]`));
    if (lab && norm(lab.innerText || lab.textContent)) return { text: norm(lab.innerText || lab.textContent), el: lab };
    const by = inp.getAttribute("aria-labelledby");
    if (by && root.getElementById) {
      const t = by.split(/\s+/).map(id => root.getElementById(id)).filter(Boolean).map(e => e.textContent).join("");
      if (norm(t)) return { text: norm(t), el: null };
    }
    for (const h of hostChain(inp).slice(1, 4)) {
      const t = h.getAttribute("label");
      if (norm(t)) return { text: norm(t), el: null };
    }
    const al = inp.getAttribute("aria-label");
    if (norm(al) && !/^(year|month|day|年|月|日|search|搜索)$/i.test(norm(al))) return { text: norm(al), el: null };
    return null;
  }

  const GENERIC_PH = /^(请输入|请选择|请填写|输入|选择|开始日期|结束日期|开始时间|结束时间|请选择日期|日期|年|月|日|YYYY|YYYY-MM|至|-)?$/;
  const SEPARATOR = /^(~|～|-|—|–|至|到|年|月|日|\/)$/;

  function meaningfulPlaceholder(c) {
    const ph = c.input && (c.input.getAttribute("placeholder") || "").trim();
    if (!ph) return "";
    const core = norm(ph.replace(/^(请输入|请选择|请填写|输入|选择|填写)+/, ""));
    return GENERIC_PH.test(core) || core.length > 16 ? "" : core;
  }

  // 组件库的"表单项 + 标签"结构。某科技公司（aui）的下拉框套了七八层，往上爬 6 层
  // 够不着标签，只能直接认表单项。
  // 飞书把 antd 改了前缀（atsx-form-item），所以再按"class 以 -form-item 结尾"通配
  const FORM_ITEM_SEL = ".ant-form-item, .el-form-item, .aui-form-item, .ivu-form-item, .arco-form-item, .tiny-form-item, .n-form-item, .t-form__item, [class$='-form-item'], [class*='-form-item '], [class$='-formily-item'], [class*='-formily-item ']";
  const FORM_LABEL_SEL = ".ant-form-item-label, .el-form-item__label, .aui-form-item__label, .ivu-form-item-label, .arco-form-item-label, .tiny-form-item__label, .n-form-item-label, .t-form__label, [class$='-form-item-label'], [class*='-form-item-label '], [class$='-formily-item-label'], [class*='-formily-item-label ']";
  // 标签块里常带一行说明（飞书"起止时间"下面的"无准确的毕业时间可填写预计毕业时间"），
  // 有 <label> 就只取 <label> 的文字
  const labelText = (el) => {
    const inner = el.tagName === "LABEL" ? null : el.querySelector("label");
    return norm((inner && norm(inner.innerText) ? inner : el).innerText || "");
  };
  // 控件自己显示的格式提示（"YYYY-MM""MM"）不是标签
  const FORMAT_TEXT = /^(y{2,4}|m{1,2}|d{1,2}|h{1,2})([\s\/.:年月日~至-]*(y{2,4}|m{1,2}|d{1,2}|h{1,2}))*[年月日]?$/i;

  // 通用的"兄弟标签"：从控件往上爬，每一层看它前面的兄弟元素。
  //   · 优先 <label>/<dt>/<th> 或 class 带 label/title 的元素（某制造企业 label.form-item__text、
  //     某科技公司 aui-form-item__label、antd/Element 都是）；
  //   · 其次才是普通短文字——手机号框前面那个写着"中国大陆"的区号按钮就是普通文字，
  //     不能抢在"手机号"标签前面；
  //   · "请选择/请输入"这种占位文字不算；
  //   · 兄弟里出现别的控件就停（那是别的字段的地盘）；父节点里还有别的控件就不再往上，
  //     免得一路爬到分区标题（"教育经历"）。
  const PLACEHOLDER_TEXT = /^(请选择|请输入|请填写|选择|输入)/;
  // 标签下面的说明行（飞书 ud-formily-item-label-desc"无准确的毕业时间可填写预计毕业时间"）
  // class 里也带 label，但不是字段名
  // 按 class 里的完整词判断（"label-desc""tips"算，"tooltip""description-free"这种拼在一起的不算）：
  // 某外企 Moka 的下拉框 class 带"no-adaptive-tooltip"，按子串匹配"tip"会把整个框当成提示
  const clsWord = (words) => new RegExp(`(^|[\\s_-])(${words})([\\s_-]|$)|[a-z](${words.replace(/(^|\|)([a-z])/g, (m, a, c) => a + c.toUpperCase())})([A-Z_\\s-]|$)`);
  const HINT_CLS = clsWord("desc|description|hint|help|extra|tip|tips|note|explain|subtitle|sub-title");
  const isHintEl = (el) => { for (let a = el, k = 0; a && k < 3; a = a.parentElement, k++) if (HINT_CLS.test(typeof a.className === "string" ? a.className : "")) return true; return false; };
  const isLabelEl = (el) => {
    const cls = typeof el.className === "string" ? el.className : "";
    return !HINT_CLS.test(cls) && (/^(LABEL|DT|TH|LEGEND)$/.test(el.tagName) || /label|title/i.test(cls));
  };
  // ── 不可能是字段名的文字 ──
  // 所有找标签的办法都先过这一关。以后遇到新的干扰文字（又一种占位、说明、按钮），
  // 只在这里加一条，不用去改每一种找法。
  // 历史：某制造企业"请选择"、飞书"YYYY-MM"、飞书"无准确的毕业时间…"说明行、手机号前的
  // "中国大陆"区号按钮、日期中间的"至"。
  // allowLong：显式关联/表单项的标签可以很长（某德企英文问题句"Are you legally authorized…"），
  // 只有靠猜的那几种才限长度
  function notLabelWhy(text, el, allowLong) {
    const t = norm(text);
    if (!t) return "空";
    if (PLACEHOLDER_TEXT.test(t)) return "占位文字";
    if (SEPARATOR.test(t)) return "分隔符";
    if (FORMAT_TEXT.test(t)) return "格式提示";
    // 日期格里显示着的值（"2023-05"、日期框里的"至今"）不是标签。某消费品公司飞书：项目起止时间填过后，
    // 控件拿"2023-05"当标签，认不出是起止时间，日期错了也改不了（2026-11-02）
    if (/^\d{4}\s*[-/.年]\s*\d{1,2}\s*月?(\s*[-/.]\s*\d{1,2}\s*日?)?$/.test(t)) return "日期值";
    // 飞书 period 格子把"2026""-""05"拆成几个 span，每段单独看也都不是标签
    if (/^(至今|现在|\d{1,4})$/.test(t) && el && el.nodeType === 1 && closestDeep(el, "[class*=date-picker], [class*=period], [class*=calendar], [class*=-picker]")) return "日期值";
    if (!allowLong && t.length > 30) return "太长";
    if (el && el.nodeType === 1) {
      if (isHintEl(el)) return "说明文字";
      if (closestDeep(el, "button, [role=button]")) return "按钮";
      if (closestDeep(el, POPUP_SEL)) return "弹层";
      if (isShownValue(el)) return "已选的值";
    }
    return "";
  }
  // 下拉框里显示"已选的值"的那一层（Moka sd-Input-display-value、antd selection-item）。某硬件公司 Moka
  // 的年/月下拉选完后，"2025"出现在输入框前面，被当成下一格（甚至这一格自己）的标签；读值时
  // 又在"装着标签的那一层"停下，结果明明选上了却读成空，下一轮又去选
  const SHOWN_VALUE_CLS = /display-?value|selection-?item|selected-?value|select-?selection-?(item|selected)/i;
  function isShownValue(el) {
    for (let a = el, k = 0; a && k < 4; a = a.parentElement, k++) if (SHOWN_VALUE_CLS.test(typeof a.className === "string" ? a.className : "")) return true;
    return false;
  }
  const okLabel = (text, el, allowLong) => !notLabelWhy(text, el, allowLong);

  // 通用的"兄弟标签"：从控件往上爬，每一层看它前面的兄弟元素。
  //   · 优先 <label>/<dt>/<th> 或 class 带 label/title 的元素；其次普通短文字
  //   · 兄弟里出现别的控件就停；父节点里还有别的控件就不再往上（免得爬到分区标题）
  // 返回 { label, plain } 两个候选（各自可能为空），由 resolveLabels 统一挑
  function structuralLabel(c, ctrls) {
    const others = ctrls.filter(o => o !== c);
    const textOf = (el) => {
      if (!isVisible(el)) return "";
      const t = labelText(el) || norm(el.textContent);
      return okLabel(t, el) ? t : "";
    };
    let node = c.el, plain = null;
    for (let depth = 0; depth < 12; depth++) {
      const parent = parentDeep(node);
      if (!parent || parent === document.body) break;
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (others.some(o => containsDeep(sib, o.el))) return { plain };
        const labs = [...(isLabelEl(sib) ? [sib] : []), ...Array.from(sib.querySelectorAll("label, dt, th, legend, [class*=label], [class*=title], [class*=Label], [class*=Title]")).filter(isLabelEl).reverse()];
        for (const lab of labs) {
          const lt = textOf(lab);
          if (lt) return { label: { text: lt, el: lab }, plain };
        }
        const pt = !plain && textOf(sib);
        if (pt) plain = { text: pt, el: sib };
      }
      if (others.some(o => containsDeep(parent, o.el))) break;
      node = parent;
    }
    return { plain };
  }

  // 找标签：每种办法各出一个候选，先统一过 notLabelWhy，再按可靠程度取最高的。
  // 可靠程度（越大越可信）：
  //   100 显式关联（label[for]、input.labels、aria-labelledby、宿主 label 属性）
  //    90 组件库表单项的标签（这一项里只有这一个控件）
  //    80 结构标签：前面兄弟里的 <label>/class 带 label 的元素
  //    74 结构标签：前面兄弟里的普通短文字
  //    70 aria-label（在组件库表单项里时，表单项标签更准）
  //    60 往上爬：只装着这一个控件的最大容器里、控件前面的文字
  //    40 有意义的 placeholder（"请输入项目名称"→"项目名称"）
  //    20 DOM 顺序上最近的前一段文字（会带 part：中间隔了几个控件）
  // 顺序和改造前的逐级退路一致；区别是"前一级拿到的是占位/说明/按钮文字"时不再硬用，
  // 而是让给下一级。c.labelSrc 记下来源，诊断里能看到。
  function resolveLabels(ctrls, texts) {
    // 合并成一条 DOM 顺序的序列：{text} 和 {ctrl} 交替
    const seq = [...texts.map(t => ({ t, el: t.el })), ...ctrls.map(c => ({ c, el: c.el }))]
      .sort((a, b) => domOrder(a.el, b.el));
    const seqIndex = new Map(seq.map((s, i) => [s.c || s.t, i]));

    for (const c of ctrls) {
      const cands = [];
      const add = (score, src, text, el, extra) => {
        if (text && okLabel(text, el, src === "显式" || src === "aria" || src === "表单项")) cands.push(Object.assign({ score, src, text: norm(text), el: el || null }, extra));
      };
      const toggle = c.kind === "checkbox" || c.kind === "radio";
      const inp = c.input || (c.radios && c.radios[0]);
      const fi = closestDeep(c.el, FORM_ITEM_SEL);

      // 显式关联。复选框/单选只认 label[for]（文字一般在框后面，交给往上爬）
      const ex = !toggle ? explicitLabel(inp)
        : inp && inp.id && (() => { const l = inp.getRootNode().querySelector(`label[for="${CSS.escape(inp.id)}"]`); return l && norm(l.innerText) ? { text: norm(l.innerText), el: l } : null; })();
      if (ex && !(ex.el && containsDeep(ex.el, c.el))) {
        add(ex.el || !fi ? 100 : 70, ex.el ? "显式" : "aria", canonLabel(ex.text), ex.el, { canon: true });
      }
      // 组件库表单项
      const fiLabel = fi && fi.querySelector(FORM_LABEL_SEL);
      if (fiLabel && ctrls.filter(o => fi.contains(o.el)).length === 1) add(90, "表单项", labelText(fiLabel), fiLabel);
      // 结构标签
      if (!toggle) {
        const st = structuralLabel(c, ctrls);
        if (st.label) add(80, "兄弟标签", canonLabel(st.label.text), st.label.el, { canon: true });
        if (st.plain) add(74, "兄弟文字", canonLabel(st.plain.text), st.plain.el, { canon: true });
      }
      // 往上爬
      let a = c.el;
      for (let i = 0; i < 6 && parentDeep(a) && parentDeep(a) !== document.body; i++) {
        a = parentDeep(a);
        if (ctrls.some(o => o !== c && containsDeep(a, o.el))) break;
        const own = texts.filter(t => containsDeep(a, t.el) && okLabel(t.text, t.el));
        const pre = own.filter(t => before(t.el, c.el));
        // 复选框/单选的文字通常在框后面（"□ 至今"）
        const pick = pre.length ? pre[pre.length - 1] : (c.kind === "checkbox" && own.length ? own[0] : null);
        if (pick) { add(60, "容器", pick.text, pick.el); break; }
      }
      // placeholder
      const ph = meaningfulPlaceholder(c);
      if (ph) add(40, "占位", ph, null);
      // DOM 顺序最近的前一段文字
      let part = 0;
      for (let i = seqIndex.get(c) - 1; i >= 0; i--) {
        const s = seq[i];
        if (s.c) { part++; continue; }
        if (!okLabel(s.t.text, s.t.el)) continue;
        add(20, "前文", s.t.text, s.t.el, { part });
        break;
      }

      const best = cands.sort((x, y) => y.score - x.score)[0];
      c.label = best ? best.text : "";
      c.labelEl = best ? best.el : null;
      c.labelSrc = best ? best.src : "";
      c.part = best && best.part ? best.part : 0;
    }
  }

  // ════════════════════════ 3. 分区与行 ════════════════════════

  const SECTION_TYPES = [
    { type: "edu", re: /教育|学历信息|学习经历|^education$/i },
    { type: "intern", re: /实习|工作经历|职业经历|工作履历|^(工作)?经验$|^(work)?experience$|^employment/i },
    { type: "project", re: /项目/ },
    { type: "campus", re: /校园|社团|学生工作|在校经历|组织经历|学生干部|社会实践|在校实践|校内实践|实践经历/ },
    { type: "honor_other", re: /其他荣誉|其它荣誉|^奖学金$/ }, // 某科技公司把"奖学金"单列一块
    { type: "award", re: /获奖|荣誉|奖励|奖项|竞赛/ },
    { type: "lang", re: /语言/ },
    // 某电商公司"发明成果专利"。"其他信息"里的"专利 上传"只是文件上传，后面没有控件
    // 也没有"添加"按钮，不会被当成分区
    { type: "ip", re: /专利|著作权|软著|发明成果|知识产权/ },
    // "您的简历""给招聘团队发信息"这类结尾分区也要认出来，否则后面的 网站/LinkedIn
    // 会被算进上一个"教育经历"分区、按教育字段去匹配，结果一个都不填
    { type: "other", re: /基本信息|个人信息|论文|期刊|技能|证书|作品|附件|其他|其它|自我|求职意向|附加|家庭|培训|意向|简历|社交|求职信|留言|发信息|附言|会议|相关经验/ },
  ];
  // 以这些结尾的短文字是字段标签（"项目名称""获奖时间"），不是分区标题
  const LABELISH = /(名称|时间|日期|等级|级别|类型|类别|描述|职责|角色|内容|职务|情况|证书|号码|方式|年月)$/;

  function buildSections(ctrls, texts) {
    const labelEls = new Set(ctrls.map(c => c.labelEl).filter(Boolean));
    const labelList = [...labelEls];
    // 在某个字段标签里面的文字（"项目成果""所属期刊"）是字段名，不是分区标题
    const inLabel = (t) => labelEls.has(t.el) || labelList.some(l => containsDeep(l, t.el));
    // "获奖情况"以"情况"结尾像字段名，但它字号明显比字段标签大，就是分区标题
    const px = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;
    const sizes = labelList.map(px).filter(Boolean).sort((x, y) => x - y);
    const labelPx = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    const looksHeading = (t) => labelPx && px(t.el) >= labelPx + 2;
    // "添加竞赛奖项"是按钮，不是标题
    const cands = texts.filter(t => t.text.length <= 10 && !inLabel(t) && (!LABELISH.test(t.text) || looksHeading(t)) &&
      !/^[+＋]?(添加|新增|增加)/.test(t.text) && SECTION_TYPES.some(s => s.re.test(t.text)));
    // 只有"后面紧跟着控件或'添加'按钮（在下一个候选标题之前）"的才算真正的分区
    // 标题；导航栏里同名的文字后面跟的是别的导航项，自然被筛掉。
    // 踩过的坑：一开始只认"后面有控件"，结果某互联网公司上一条都还没有的空分区
    // （"项目经历 + 添加"）不算分区，插件根本不会去点"添加"，整段不填。
    const addBtns = findAddButtons();
    const headers = [];
    for (let i = 0; i < cands.length; i++) {
      const h = cands[i], next = cands[i + 1];
      const inside = (el) => before(h.el, el) && (!next || before(el, next.el));
      if (ctrls.some(c => inside(c.el)) || addBtns.some(inside)) {
        const type = SECTION_TYPES.find(s => s.re.test(h.text)).type;
        // 某科技公司式：每条已保存的经历自带一个同名小标题（"项目经历-1""项目经历-2"…）。
        // 当成几个分区的话，每个分区都从 profile 第一条开始配，条目就串了、重复加。
        // 紧挨着的同名同类标题合成一个分区，里面的条目当作多行。
        const prev = headers[headers.length - 1];
        if (prev && prev.type === type && prev.text === h.text) continue;
        headers.push({ el: h.el, text: h.text, type });
      }
    }
    for (const c of ctrls) {
      let sec = null;
      for (const h of headers) { if (before(h.el, c.el)) sec = h; else break; }
      c.section = sec;
    }
    headers.forEach((h, i) => { h.next = headers[i + 1] || null; });
    return headers;
  }

  // ════════════════════════ 字段定义（schema） ════════════════════════

  // 经历正文（项目/实习/校园）在 profile 里拆成四段，每段自带【】标题：
  // STAR 结构（字段名沿用旧的）：core_result【背景与任务】 responsibilities【个人职责】 task_action【任务与行动】 insight【项目成果】。
  // 网站有单独的"职责"框 → 职责框只放【个人职责】，描述框放其余三段；
  // 只有一个描述框 → 四段全放。标题统一用【】，内容用资料里的完整版，不缩减。
  // withInsight=false：页面另有"成果"框（某制造企业"项目描述 + 项目成果"），成果放那边
  const descText = (e, withResp, withInsight = true) => [e.core_result, withResp ? e.responsibilities : null, e.task_action, withInsight ? e.insight : null]
    .filter(Boolean).join("\n\n");
  const endDay = (y, m, d) => d || (y && m ? String(new Date(Number(y), Number(m), 0).getDate()) : undefined);

  // 英语考试的中英文写法："IELTS 6.5" → 雅思；CET-6 → 六级 …
  // "湖北武汉"：选项可能是"武汉市""湖北省武汉市""湖北省/武汉市"，搜索框搜"武汉"最准
  const PROVINCE = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)?/;
  const placeSyn = (v) => {
    const t = String(v || "").trim();
    const m = t.match(PROVINCE);
    const prov = m ? m[1] : "", city = t.slice(m ? m[0].length : 0).replace(/市$/, "");
    if (!prov || !city) return { syn: [t], search: [t] };
    return { syn: [t, `${prov}省${city}市`, `${city}市`, city, `${prov}省`, prov], search: [city, prov] };
  };
  const examSyn = (v) => {
    const t = String(v || ""), out = [t];
    if (/ielts|雅思/i.test(t)) out.push("雅思", "IELTS");
    if (/toefl|托福/i.test(t)) out.push("托福", "TOEFL");
    if (/cet-?6|六级/i.test(t)) out.push("六级", "CET-6", "CET6", "大学英语六级");
    if (/cet-?4|四级/i.test(t)) out.push("四级", "CET-4", "CET4", "大学英语四级");
    if (/tem-?8|专八|专业八级/i.test(t)) out.push("专业八级", "TEM-8");
    if (/tem-?4|专四|专业四级/i.test(t)) out.push("专业四级", "TEM-4");
    return out;
  };
  // ── 学历类选项按"事实"判断 ──
  // 一个选项常常同时说好几件事："全日制本科-全国统一招生考试" = 全日制 + 本科 + 统招。
  // 每家网站的分类方式都不一样（某外企"学位属于哪一类"、飞书"学历类型"、某制造企业"学习形式"），
  // 同义词表列不全，而且"全日制本科-全国统一…"和"全日制本科-非全国统一…"开头一样，
  // 光看文字分不出来。所以：把选项拆成几个维度的事实，和这条经历的事实对——
  //   · 选项说的任何一项和事实矛盾，或者是资料里不知道的事 → 排除；
  //   · 剩下的里，一致项最多且只有一个 → 选它；并列、或一项都对不上（"其他""不适用"）→ 不选。
  // 每个维度里，否定写法放在前面（"非全日制"要先于"全日制"认）。
  const EDU_FACTS = [
    ["mode", "非全日制", /非全日制|在职|业余|函授|夜大|part-?time/i],
    ["mode", "全日制", /全日制|full-?time/i],
    ["admit", "非统招", /非全国统一|非统招|非统一招生|自考|自学考试|成人|网络教育|开放大学|电大|专升本/],
    ["admit", "海外", /海外|境外|港澳台|留学|国外|overseas|international/i],
    ["admit", "统招", /统招|全国统一招生|统一招生|普通高等|普通高校|普通全日制/],
    ["region", "香港", /jupas|香港|hongkong/i],
    ["program", "MBA", /mba|emba|工商管理硕士/i],
    ["program", "专业学位", /专业学位|专业型|专硕/],
    ["program", "学术学位", /学术学位|学术型|学硕/],
    ["level", "博士", /博士|phd|doctor/i],
    ["level", "硕士", /硕士|研究生|master|msc|meng/i],
    ["level", "本科", /本科|学士|bachelor|undergrad/i],
    ["level", "大专", /大专|专科|高职|associate/i],
    ["level", "高中及以下", /高中|中专|初中|职高|技校/],
  ];
  function optionFacts(text) {
    const out = {};
    for (const [dim, val, re] of EDU_FACTS) if (!(dim in out) && re.test(text)) out[dim] = val;
    return out;
  }
  // 这条教育经历的事实。admit（统招）在资料没写时按"国内全日制=统招"推断
  function eduFacts(e) {
    if (!e) return {};
    const level = /博士/.test(e.degree) ? "博士" : /硕士|研究生/.test(e.degree) ? "硕士" : /学士|本科/.test(e.degree) ? "本科" : /专科|大专/.test(e.degree) ? "大专" : undefined;
    return {
      level,
      mode: e.study_mode || undefined,
      admit: e.admission || (e.overseas ? "海外" : e.study_mode === "全日制" ? "统招" : undefined),
      region: e.overseas ? "海外" : "内地",
      program: e.program || undefined,
    };
  }
  // 返回打分函数：选项文字 → 一致项个数；矛盾或无法确认 → null
  const eduJudge = (e) => {
    const f = eduFacts(e);
    return (text) => {
      const of = optionFacts(text);
      let agree = 0;
      for (const [dim, val] of Object.entries(of)) {
        if (f[dim] === undefined || f[dim] !== val) return null;
        agree++;
      }
      return agree;
    };
  };

  const degreeSyn = (d) => d === "学士" || d === "本科" ? ["本科", "学士", "大学本科"] :
    d === "硕士" ? ["硕士", "硕士研究生", "研究生"] : d === "博士" ? ["博士", "博士研究生"] : [d];
  // "前20%"：某科技公司选项写"TOP20%"，有的网站写"前20%""Top 20%"
  const eduRankSyn = (r) => { const n = String(r || "").match(/\d+/); return n ? [r, `TOP${n[0]}%`, `Top${n[0]}%`, `前${n[0]}%`] : [r]; };
  // 奖项级别按档位对照（某外企选项是 国家级/区域级/院校级/部门级）。
  // 例：地区级竞赛（省市级）对应"区域级"，比国家级低一档
  const LEVEL_TIERS = [
    ["国际级", "国际", "世界级"],
    ["国家级", "全国", "国际/国家级", "国家", "全国性"],
    ["省市级", "区域级", "省部级", "省级", "地区级", "区域", "市级", "地市级", "省"],
    ["校级", "院校级", "学校级", "校"],
  ];
  const levelSyn = (l) => { const t = LEVEL_TIERS.find(x => x.includes(l)); return t ? [l, ...t.filter(x => x !== l)] : [l]; };

  // 语言熟练度：各家档位叫法不同（飞书 入门/日常会话/商务会话/无障碍沟通/母语），
  // 按档位对应，同档的写法都列上
  const langLevelSyn = (l) => {
    const tiers = [
      ["母语", "native"],
      ["精通", "无障碍沟通", "流利", "fluent", "proficient", "熟练掌握"],
      ["熟练", "商务会话", "良好", "熟练使用", "advanced"],
      ["一般", "日常会话", "中等", "intermediate"],
      ["入门", "基础", "了解", "basic", "beginner"],
    ];
    const t = tiers.find(x => x.includes(l));
    return t ? [l, ...t.filter(x => x !== l)] : [l];
  };
  // 学历类型/学习形式：海外院校选"海外及港澳台"，国内全日制选"统招全日制"
  const studyModeSyn = (e) => e.overseas
    ? ["海外及港澳台", "海外", "境外", "海外院校", "留学", "国外", e.study_mode]
    : e.study_mode === "全日制" ? ["统招全日制", "全日制统招", "全日制", "统招", "全国普通高等院校全日制", "普通全日制"] : [e.study_mode];

  // 每个重复分区：anchor 是"这一行是哪一条"的判断依据；fields 里 re 匹配标签，
  // kinds 限定控件类型（同样叫"职责"，单行框是角色、多行框是职责描述）。
  const SCHEMAS = {
    edu: {
      entries: (p) => p.education_entries || [],
      anchor: "school",
      entryName: (e) => e.school,
      // 学校按英文名选上后页面显示英文名"University of Edinburgh"：对行时中英文名都算这一条
      entryNames: (e) => [e.school, e.school_en].filter(Boolean),
      fields: [
        { key: "is_highest", re: /是否最高学历/, val: (e, p) => e.degree === p.education.highest_degree ? "是" : "否" },
        // "是否双学位"填"否"；"双学位/专业名称"是名称框，不能也写"否"（某消费品公司飞书登记表，2026-11-02）
        { key: "double_name", re: /(双学位|辅修).*(名称|专业名|学校)|^(第二|双)专业$/, val: () => "" },
        { key: "double", re: /双学位|辅修/, val: () => "否" },
        // 学校库常常只有英文名（Moka："University of Edinburgh"），中文搜不到——中英文都搜
        { key: "school_city", re: /(学校|院校|大学)(所在)?(城市|地点|所在地)/, val: (e) => e.city },
        { key: "school", re: /学校|院校|大学|^(教育)?机构$/, not: /学院|地点|地址|所在地|城市|地区/, val: (e) => e.school,
          syn: (e) => [e.school, e.school_en].filter(Boolean), search: (e) => [e.school, e.school_en].filter(Boolean) },
        { key: "college", re: /学院|院系|系别|所在系/, val: (e) => e.college },
        { key: "major", re: /专业/, not: /类别|排名|方向|门类|成绩/, val: (e) => e.major, search: (e) => e.major },
        { key: "degree", re: /学历|学位/, val: (e) => e.degree, syn: (e) => degreeSyn(e.degree), judge: eduJudge },
        { key: "study_mode", re: /学习形式|培养方式|就读方式|学习方式|学历类型|教育类型|学历性质|学制类型/, val: (e) => e.study_mode, syn: studyModeSyn, judge: eduJudge },
        // 某外企"您的学位属于以下哪一类？"：选项是"全日制硕士/全日制本科-全国统一招生考试…"
        { key: "edu_class", re: /(学位|学历).{0,8}(哪一类|哪类|类别|类型|性质|种类)/, val: (e) => (e.study_mode || "") + (e.degree || ""), judge: eduJudge },
        { key: "rank", re: /排名/, val: (e) => e.rank, syn: (e) => eduRankSyn(e.rank) },
        { key: "start", re: /入学(时间|日期|年月)|开始时间/, date: (e) => [e.start_year, e.start_month, e.start_day] },
        { key: "end", re: /毕业(时间|日期|年月)|结束时间/, date: (e) => [e.end_year, e.end_month, endDay(e.end_year, e.end_month, e.end_day)] },
        { key: "range", re: /时间|日期|年月|就读|在校/, not: /获奖|颁奖|发表|发布/, range: (e) => e },
      ],
    },
    intern: {
      entries: (p) => internsOf(p),
      anchor: "company",
      entryName: (e) => e.company,
      fields: [
        { key: "ongoing", re: /至今|目前在|仍在|currently/i, kinds: ["checkbox"], check: (e) => !!e.ongoing },
        { key: "company", re: /公司|单位|企业|机构|雇主|employer|company/i, not: /地点|地址|城市/, val: (e) => e.company },
        { key: "dept", re: /部门/, val: (e) => e.dept },
        { key: "title", re: /职位|岗位|职务|职称|角色|头衔|^title$|jobtitle/i, val: (e) => e.title },
        { key: "resp", re: /职责/, kinds: ["textarea"], val: (e) => e.responsibilities },
        { key: "content", re: /内容|描述|职责|工作|业绩/, val: (e, p, row) => e.core_result ? descText(e, !row.has("resp")) : e.one_liner },
        { key: "range", re: /时间|日期|年月|起止/, range: (e) => e },
      ],
    },
    project: {
      entries: (p) => p.project_entries || [],
      anchor: "name",
      entryName: (e) => e.name,
      fields: [
        { key: "ongoing", re: /至今/, kinds: ["checkbox"], check: (e) => !!e.ongoing },
        { key: "name", re: /项目名称|^名称$|^项目$/, val: (e) => e.name },
        { key: "role", re: /职务|角色|担任|身份|职位/, val: (e) => e.role_short },
        { key: "role", re: /职责/, kinds: ["text"], val: (e) => e.role_short },
        { key: "resp", re: /职责|贡献/, kinds: ["textarea"], val: (e) => e.responsibilities },
        // 有单独"职责"框时描述只放成果；没有（某电商公司只有一个"项目描述"）就成果+职责合在一起
        { key: "result", re: /成果|业绩|收获/, kinds: ["textarea"], val: (e) => e.insight },
        { key: "desc", re: /描述|内容|简介|介绍|成果|详情/, val: (e, p, row) => descText(e, !row.has("resp"), !row.has("result")) },
        { key: "range", re: /时间|日期|年月|起止/, range: (e) => e },
      ],
    },
    campus: {
      entries: (p) => p.campus_entries || [],
      anchor: "name",
      entryName: (e) => e.name,
      fields: [
        { key: "ongoing", re: /至今/, kinds: ["checkbox"], check: (e) => !!e.ongoing },
        { key: "name", re: /名称|组织|社团|活动|经历/, not: /描述/, val: (e) => e.name },
        { key: "role", re: /职务|角色|职位|担任/, kinds: ["text", "select", "picker"], val: (e) => e.role },
        { key: "resp", re: /职责/, kinds: ["textarea"], val: (e) => e.responsibilities },
        { key: "result", re: /成果|业绩|收获/, kinds: ["textarea"], val: (e) => e.insight },
        { key: "desc", re: /描述|内容|简介|情况/, val: (e, p, row) => descText(e, !row.has("resp"), !row.has("result")) },
        { key: "range", re: /时间|日期|年月|起止/, range: (e) => e },
      ],
    },
    award: {
      // 分区名或字段名带"竞赛"（某互联网公司"竞赛获奖"）就只放比赛；某电商公司"荣誉奖励"有
      // "奖项类型"可选，全放；"其他荣誉"分区只放非比赛的（奖学金）。
      entries: (p, sec, rowsText) => {
        const all = p.honors || [];
        const compOnly = /竞赛/.test(sec.text) || /竞赛/.test(rowsText) && !/类型/.test(rowsText);
        return compOnly ? all.filter(h => h.type === "竞赛") : all;
      },
      anchor: "name",
      entryName: (e) => e.name,
      fields: [
        { key: "type", re: /类型|类别/, val: (e) => e.type, syn: (e) => e.type === "竞赛" ? ["竞赛奖项", "竞赛", "比赛"] : e.type === "奖学金" ? ["奖学金"] : ["其他", "荣誉称号", "荣誉"] },
        // 下拉框里的"级别"是 国家级/省市级/校级；文本框里的"等级"填具体奖项（全国二等奖）
        { key: "level", re: /级别|等级/, kinds: ["select", "native-select", "picker", "combo", "radio"], val: (e) => e.level, syn: (e) => levelSyn(e.level) },
        { key: "level_text", re: /级别|等级/, kinds: ["text"], val: (e) => e.award },
        // 获奖时间是单个日期，但控件可能拆成 年+月 两个选择器，所以也走 range 的
        // 分配逻辑（ongoing=true 表示没有结束日期）
        { key: "time", re: /时间|日期|年月|年份/, range: (e) => ({ start_year: e.year, start_month: e.month, start_day: e.day, ongoing: "single" }) },
        { key: "desc", re: /情况|描述|说明|内容|概述|简介|介绍/, val: (e) => `${e.name} ${e.award}`.trim() },
        // 某金融公司"授予单位"（必填）。放在 name 前面：name 的正则不认"单位"，但以后别的写法可能带"奖项"
        { key: "issuer", re: /授予单位|授奖单位|颁奖单位|颁发单位|颁奖机构|颁发机构|授予机构|颁发部门|发证单位|发证机构|主办单位|主办方/, val: (e) => e.issuer },
        { key: "name", re: /名称|奖项|荣誉|获奖/, val: (e, p, row) => row.has("level_text") || row.has("desc") ? e.name : `${e.name} ${e.award}`.trim() },
      ],
    },
    honor_other: null, // 下面按 award 复用，只是条目换成非比赛的
    lang: {
      entries: (p) => p.language_entries || [],
      anchor: "type",
      entryName: (e) => e.type,
      fields: [
        // 某电商公司"语言/证书/技能"分区每行先选"技能类型"（外语/证书/IT技能…）
        { key: "skill_kind", re: /技能类型|技能类别/, val: () => "外语", syn: () => ["外语", "语言", "语言能力", "外语能力"] },
        { key: "ls", re: /听说/, val: (e) => e.listening_speaking, syn: (e) => langLevelSyn(e.listening_speaking) },
        { key: "rw", re: /读写/, val: (e) => e.reading_writing, syn: (e) => langLevelSyn(e.reading_writing) },
        { key: "cert", re: /证书|成绩|考试|分数/, val: (e) => e.cert },
        { key: "level", re: /掌握|熟练|水平|程度|等级/, val: (e) => e.level, syn: (e) => langLevelSyn(e.level) },
        // 某消费品公司飞书：一行里"英语能力"(精通/熟练/良好/普通) + "其他语言能力"(文本)。
        // 原来"其他语言能力"被 type 接走填了"英语"，"英语能力"没人认
        { key: "en_level", re: /^英语(能力|水平)$/, val: (e) => e.type === "英语" ? e.level : "", syn: (e) => langLevelSyn(e.level) },
        { key: "other_lang", re: /其他(外)?语|第二外语|小语种/, val: () => "" },
        { key: "type", re: /语言|语种/, val: (e) => e.type },
      ],
    },
  };
  // 专利 / 软件著作权。某电商公司字段：成果类型(下拉) / 成果名称 / 登记号 / 登记日期 / 发明人排名(下拉) / 核心简介
  const ipTypeSyn = (t) => t === "软件著作权" ? ["软件著作权（软著）", "软件著作权", "软著", "计算机软件著作权"] : [t];
  const rankSyn = (n) => n === 1 ? ["第一发明人/第一著作人", "第一", "1"] : n === 2 ? ["第二发明人/第二著作人", "第二", "2"]
    : n === 0 ? ["独立发明人/独立著作人", "独立"] : ["第三及以后发明人/著作人", "第三及以后", "第三"];
  SCHEMAS.ip = {
    entries: (p) => p.ip_entries || [],
    anchor: "name",
    entryName: (e) => e.name,
    fields: [
      { key: "type", re: /类型|类别|种类/, val: (e) => e.type, syn: (e) => ipTypeSyn(e.type) },
      { key: "rank", re: /排名|排序|位次|署名/, val: (e) => String(e.rank), syn: (e) => rankSyn(e.rank) },
      { key: "reg_no", re: /登记号|申请号|授权号|专利号|证书号|编号/, val: (e) => e.reg_no },
      { key: "date", re: /日期|时间/, range: (e) => ({ start_year: e.reg_year, start_month: e.reg_month, start_day: e.reg_day, ongoing: "single" }) },
      { key: "intro", re: /简介|介绍|描述|内容|说明/, val: (e) => descText(e, true) },
      { key: "name", re: /名称|成果|专利|软件/, val: (e) => e.name },
    ],
  };
  // 实习可以有多段：internship_entries（从新到旧）。老资料只有一段 internship，也照样认。
  function internsOf(p) {
    const list = Array.isArray(p.internship_entries) && p.internship_entries.length ? p.internship_entries
      : p.internship && p.internship.company ? [p.internship] : [];
    return list.filter(e => e && e.company);
  }

  SCHEMAS.honor_other = Object.assign({}, SCHEMAS.award, {
    entries: (p) => (p.honors || []).filter(h => h.type !== "竞赛"),
  });

  // 不在重复分区里的单一字段。标签现在是解析出来的短文字，所以正则尽量写成
  // 整词/开头匹配——v1 用宽松的上下文匹配，"最高学历专业"被"最高学历"规则抢走、
  // 填成了"硕士"。
  // ctx.hasSurname：页面上有单独的"姓氏"框时，"名字"指的是名（颜）而不是全名
  function basicFields(p, ctx = {}) {
    const E = p.education || {};
    const projText = (p.project_entries || []).map(x => `${x.name}｜${x.role_short}\n${descText(x, true)}`).join("\n\n———\n\n");
    const hi = (p.education_entries || []).find(e => e.degree === E.highest_degree) || {};
    const interns = internsOf(p);
    return [
      { re: /英文名|englishname/i, val: p.name_en },
      { re: /^(姓|姓氏|lastname|surname|familyname)$/i, val: p.last_name },
      ...(ctx.hasSurname ? [{ re: /^(名|名字|firstname|givenname)$/i, val: p.first_name }] : []),
      { re: /^(姓名|真实姓名|中文姓名|考生姓名|申请人姓名|候选人姓名|名字|name|fullname|yourname)$/i, val: p.name },
      { re: /紧急|家庭|父|母|亲属|推荐人|导师|内推/, val: null, block: true }, // 别人的联系方式，不填（命中就一票否决）
      { re: /手机|电话|联系方式|mobile|phone/i, val: p.phone, syn: () => [p.phone, "+86", "中国"] },
      { re: /邮箱|email|邮件/i, val: p.email },
      // 个人信息里的"学习形式"指最高学历的（全日制）
      { re: /学习形式|培养方式|就读方式|学习方式/, val: hi.study_mode, judge: () => eduJudge(hi) },
      { re: /微信/, val: p.wechat },
      { re: /^性别$|gender/i, val: p.gender, syn: () => [p.gender, p.gender === "女" ? "女性" : "男性"] },
      // "出生地"也带"出生"两个字（某外企 Moka 把生日填进了出生地）
      { re: /出生|生日|birth/i, not: /出生地|出生城市|出生省|出生国|出生所在|birthplace|place of birth|country of birth/i, date: [p.birth_year, p.birth_month, p.birth_day], text: p.birth_date },
      { re: /出生地|出生城市|出生省|出生所在|birthplace|place of birth/i, val: p.birth_place },
      { re: /籍贯|生源地|户口所在地/, val: p.native_place, syn: () => placeSyn(p.native_place).syn, search: placeSyn(p.native_place).search },
      { re: /民族/, val: p.ethnicity, syn: () => [p.ethnicity, (p.ethnicity || "").replace(/族$/, "")] },
      { re: /政治面貌/, val: p.political_status },
      { re: /国籍|国家/, val: p.nationality, syn: () => [p.nationality, "中国大陆", "中华人民共和国"], search: p.nationality },
      { re: /期望.*城市|意向城市|期望.*地点|意向.*地点/, val: p.expected_city },
      { re: /现居|居住|所在地|所在城市|现住|常住|^城市$|^city$|^location$/i, val: p.current_city, search: [p.current_city, p.current_city_en] },
      { re: /薪资|薪酬|月薪/, val: p.expected_salary },
      { re: /到岗|可入职|入职时间/, val: p.available_date },
      { re: /^(最高学历|学历|最高学位)$/, val: E.highest_degree, syn: () => degreeSyn(E.highest_degree), judge: () => eduJudge(hi) },
      { re: /最高学历(学校|院校)|毕业院校|^(学校|院校)$/, val: E.highest_school,
        syn: () => [E.highest_school, hi.school_en].filter(Boolean), search: [E.highest_school, hi.school_en].filter(Boolean) },
      { re: /最高学历专业|^专业$/, val: E.highest_major },
      { re: /最高学历毕业(日期|时间)|^毕业(时间|日期|年月)$/, date: [hi.end_year, hi.end_month, endDay(hi.end_year, hi.end_month, hi.end_day)], text: E.master_end },
      { re: /作品集|portfolio|个人网站|个人主页|^网站$|^(个人)?网址$|^website$/i, val: p.portfolio },
      { re: /github/i, val: p.github },
      { re: /自我评价|自我介绍|自我描述|个人简介|个人优势|关于我|aboutme|summary/i, val: p.self_intro_long, alt: p.self_intro_short },
      { re: /求职方向|意向职能|应聘方向|岗位方向/, val: p.job_direction },
      // 下拉选项写中文（雅思/托福/六级），profile 写的是"IELTS 6.5"，两种写法都给
      { re: /英语水平|外语水平|英语等级|雅思|ielts|语言能力/i, val: p.english_level, syn: () => examSyn(p.english_level) },
      // "英语等级成绩"只收数字（某制造企业校验"请输入数值"）
      { re: /(英语|外语|雅思|托福|ielts|toefl).{0,4}(成绩|分数|得分)/i, val: ((p.english_level || "").match(/\d+(\.\d+)?/) || [])[0] },
      { re: /工作经验|经验年限/, val: p.work_experience_level, syn: () => [p.work_experience_level, "应届生", "应届", "无经验"] },
      { re: /^(专业)?技能(特长)?$|^skills$/i, val: p.skills_short },
      // 一个框同时问特长和爱好时两段都放；"技能特长"已被上一条接走
      { re: /特长.*(兴趣|爱好)|(兴趣|爱好).*特长/, val: [p.specialty && "特长：" + p.specialty, p.hobbies && "兴趣爱好：" + p.hobbies].filter(Boolean).join("\n") },
      { re: /特长/, val: p.specialty },
      // 不能写成 /兴趣/：某德企的"告诉公司您有兴趣在那里工作"（求职动机）会被当成爱好
      { re: /兴趣爱好|^(个人|业余)?爱好$|^兴趣$|hobb/i, val: p.hobbies },
      // 只有"一个大文本框装全部经历"的网站才用这几条合并版
      { re: /^(项目经历|项目经验)$/, kinds: ["textarea"], val: projText },
      { re: /^(实习经历|工作经历)$/, kinds: ["textarea"], val: interns.map(it => `${it.company}｜${it.dept || ""}｜${it.title || ""}（${it.period || ""}）\n${it.one_liner || ""}`).join("\n\n") },
      { re: /^(荣誉|获奖情况|获奖经历|荣誉奖项|奖励情况)$/, kinds: ["textarea", "text"], val: p.honors_text },
    ];
  }

  // ════════════════════════ 4. 读值 / 判空 ════════════════════════

  // 控件里"显示出来的值"：可见文字，去掉报错/说明/提示这类元素里的字
  // ghost：Moka 下拉打开时把"鼠标/键盘停在的那一项"淡淡地预显示在框里（sd-Select-ghost），不是选中值。
  // 某硬件公司"毕业时间"的月份因此读成了"1"，被当成已填跳过
  const NOT_VALUE_CLS = clsWord("error|err|explain|feedback|invalid|warn|warning|message|msg|tip|tips|help|desc|hint|extra|placeholder|ghost|preview");
  // 下拉选项列表（Moka 打开时把列表画在下拉框容器里面）
  const OPTION_LIST_CLS = /option|menu|listbox|popup|popover|dropdown-?(list|panel|menu)/i;
  function displayText(box) {
    const out = [];
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.trim();
      if (!t) continue;
      let bad = false;
      // 只看 box 里面的元素（box 自己的 class 不算：Moka 框本身带"tooltip"）
      for (let e = n.parentElement; e && e !== box; e = e.parentElement) {
        const cls = typeof e.className === "string" ? e.className : "";
        if (!isVisible(e) || NOT_VALUE_CLS.test(cls) || OPTION_LIST_CLS.test(cls) || /^(listbox|option|menu)$/.test(e.getAttribute("role") || "")) { bad = true; break; }
      }
      if (!bad) out.push({ t, g: n.parentElement && n.parentElement.parentElement });
    }
    // 3 段以上并排的兄弟文字是展开着的选项列表（不靠 class 名认：各家列表 class 五花八门），
    // 不是选中值——Moka 打开时读到过"国家级区域级院校级部门级"
    const per = new Map();
    for (const x of out) per.set(x.g, (per.get(x.g) || 0) + 1);
    return norm(out.filter(x => per.get(x.g) < 3).map(x => x.t).join(" "));
  }

  function readValue(c) {
    switch (c.kind) {
      case "text": case "textarea": return (c.input.value || "").trim();
      case "picker": case "combo": {
        const v = (c.input.value || "").trim();
        if (v) return v;
        // 输入框一直空着、选中的值显示在旁边的元素里（飞书 ud__select、Moka sd-Select 的
        // "sd-Input-display-value"）。读不到的话引擎会以为没选上，一遍遍重开下拉
        // 往外找到装着字段名的那一层就停（再往外就是整个字段，会读到"必填项未填写"这类
        // 报错文字——某外企 Moka 的学校名称就被这样当成"已有值"跳过了）
        for (let a = parentDeep(c.input), k = 0; a && k < 4; a = parentDeep(a), k++) {
          if (c.labelEl && containsDeep(a, c.labelEl)) break;
          // 爬到装着别的输入框的那一层就停：Moka 年/月/年/月 外面包着 month-range-select，
          // 再往上读会把开始的"2023 4"当成空着的结束年份的值
          if (Array.from(a.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden])")).some(i => i !== c.input)) break;
          const cls = typeof a.className === "string" ? a.className : "";
          if (!/select|cascader|dropdown|combobox/i.test(cls)) continue;
          const t = displayText(a);
          if (t && t.length <= 40 && !PLACEHOLDER_TEXT.test(t) && !FORMAT_TEXT.test(t)) return t;
        }
        // 飞书 period picker 的 input 是隐藏的、一直空着，值显示在两个格子里
        const sl = rangeSlots(c);
        return sl && sl.some(el => DATE_SHOWN.test(norm(el.innerText))) ? sl.map(el => norm(el.innerText)).join(" ~ ") : "";
      }
      case "native-select": {
        const o = c.el.options[c.el.selectedIndex];
        return !o || !o.value || /请选择|select|^$/i.test(o.text.trim()) ? "" : o.text.trim();
      }
      case "checkbox": return c.el.checked ? "1" : "";
      case "radio":
        if (c.radios) return c.radios.some(r => r.checked) ? "1" : "";
        return c.el.querySelector(".ant-radio-wrapper-checked, .is-checked, input:checked") ? "1" : "";
      case "select": {
        const v = c.el.querySelector(".ant-select-selection-selected-value, .ant-select-selection-item, .ant-select-selection__choice__content, .atsx-select-selection-selected-value, .atsx-select-selection__choice__content");
        if (v) return v.textContent.trim();
        const inp = c.el.querySelector("input.el-input__inner, .el-select__input");
        return inp ? (inp.value || "").trim() : "";
      }
      case "cascader": {
        const v = c.el.querySelector(".ant-cascader-picker-label, .ant-select-selection-item, input");
        return v ? (v.value !== undefined && v.tagName === "INPUT" ? v.value : v.textContent).trim() : "";
      }
      case "date": case "date-range": return c.input ? (c.input.value || "").trim() : "";
    }
    return "";
  }

  // ════════════════════════ 5. 填值 ════════════════════════

  const popupVisible = (d) => isVisible(d) && !/-hidden\b/.test(d.className) && getComputedStyle(d).display !== "none";

  // 选项打分：完全相等 > 选项包含目标 > 目标包含选项。v1 是"找到第一个包含的就点"，
  // 容易点到"硕士及以上"这类更长的选项。
  const isCJK = (ch) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch || "");
  const SEP_CH = /^[,，、/|()（）\[\]【】\-—_·.&]$/;
  function wholeIn(t, w) {
    for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
      const a = t[i - 1], b = t[i + w.length];
      const okSide = (ch, inner) => ch === undefined || SEP_CH.test(ch) || isCJK(ch) !== isCJK(inner);
      if (okSide(a, w[0]) && okSide(b, w[w.length - 1])) return true;
    }
    return false;
  }
  function bestOption(options, wants, minScore = 21) {
    let best = null, bestScore = 0;
    const ws = wants.filter(Boolean).map(norm);
    if (wants.judge) {
      const scored = [];
      for (const o of options) {
        const t = norm(o.textContent);
        const sc = t ? wants.judge(t) : null;
        if (sc) scored.push({ o, t, sc });
      }
      if (!scored.length) return null;
      const top = Math.max(...scored.map(x => x.sc));
      const tops = scored.filter(x => x.sc === top);
      // 同一个选项在 DOM 里出现两次（显示框 + 列表）不算并列
      if (new Set(tops.map(x => x.t)).size === 1) return tops[0].o;
      // 真并列：只有其中恰好一个和资料原词完全一样才选，否则宁可不选
      const exact = tops.filter(x => ws.includes(x.t));
      return new Set(exact.map(x => x.t)).size === 1 ? exact[0].o : null;
    }
    for (const o of options) {
      const t = norm(o.textContent);
      if (!t) continue;
      for (const [wi, w] of ws.entries()) {
        let s = 0;
        if (t === w) s = 30;
        // 以目标开头、紧跟括号/分隔符/行政后缀：是同一个东西的另一种写法
        // （"杭州"→"杭州市, 浙江"，"爱丁堡大学"→"爱丁堡大学(University of Edinburgh)"）
        else if (t.startsWith(w) && /^[,，、/|()（）\[\]【】\-—_·市省区县州]/.test(t.slice(w.length))) s = 25 - Math.min(4, (t.length - w.length) / 10);
        // 中英并列的名字（Moka 学校库"Huazhong Agricultural University 华中农业大学"）：目标完整出现，
        // 两边挨着的是边界、分隔符或另一种文字（中文挨英文）——也是同一个东西
        else if (wholeIn(t, w)) s = 24;
        // 只是包含（"统计学"→"统计学与机器学习"、"经济统计学"）：两边挨着的还是中文，是别的
        // 东西，分数压在 NEAR_MIN 以下，默认不会选
        else if (t.includes(w)) s = 20 - Math.min(9, t.length - w.length);
        else if (t.length >= 2 && w.includes(t)) s = 10;
        s -= wi * 0.1; // 同分时优先 wants 里靠前的
        if (s > bestScore) { bestScore = s; best = o; }
      }
    }
    return bestScore >= minScore ? best : null;
  }

  const OPTION_SEL = [
    ".ant-select-dropdown-menu-item:not(.ant-select-dropdown-menu-item-disabled)",
    ".atsx-select-dropdown-menu-item:not(.atsx-select-dropdown-menu-item-disabled)",
    ".ant-select-item-option:not(.ant-select-item-option-disabled)",
    ".el-select-dropdown__item:not(.is-disabled)",
    ".aui-select-dropdown__item:not(.is-disabled)",
    "[role=option]",
  ].join(",");

  // 通用"点开 → 等选项 → 点中"。先找组件库标准的选项元素；找不到（Moka、飞书
  // 这类自研组件）就退回"点开之后新变得可见的叶子节点"——按可见性变化而不是
  // "新增 DOM 节点"判断，因为飞书的选项面板一直在 DOM 里、只是切换显示。
  // verify：传了就在点完之后读回控件的值，没变就换原生 click() 再点一次（某电商公司
  // antd-mobile、部分 Web Components 只认原生 click），还不行算失败——
  // 不再"点了就当成功"。
  // "叶子文字"：没有子元素，或者子元素只是搜索高亮这类行内标签
  // （某制造企业搜索结果"<mark>武汉</mark>市"，整个"武汉市"才是选项）
  const textLeaf = (el) => el.children.length === 0 || (el.children.length <= 3 &&
    Array.from(el.querySelectorAll("*")).every(ch => /^(MARK|EM|B|STRONG|I|FONT|SMALL|SPAN)$/.test(ch.tagName) && ch.children.length === 0));

  // 默认只接受"完全一样"或"以它开头+括号/分隔符/行政后缀"的选项。原来门槛是 1 分，
  // 选不到原词就选"最接近"的——某外企 Moka 把专业"统计学"选成了"统计学与机器学习"。
  // 叫法不统一的字段（学历、学习形式、排名、语言水平）靠同义词表对上，也是完全一致
  const NEAR_MIN = 21;
  // 这次填充里 openAndChoose 有没有见到过弹层里的选项（见 combo：从来没弹出候选的输入框按普通文字处理）
  let SAW_OPTIONS = false;
  // 这个字段已经点中过一个对得上的选项（每次 applyValue / fillDate 开始时清零）。点中之后
  // 读回没确认上，也不再换别的办法反复点开找——用户要的是"有合适的就直接选，不要一直找"。
  // 某硬件公司 Moka 登录后选完会自动保存、整块重画，原来的框读不到值，引擎就一遍遍重开
  let PICKED = false;
  async function openAndChoose(trigger, wants, { search = null, searchInput = null, attempts = 16, minScore = NEAR_MIN, verify = null } = {}) {
    if (PICKED) return false;
    const wasVisible = new Set(deepAll("*", document.body).filter(isVisible));
    fireClick(trigger);
    await sleep(250);
    // 点一下开、再点一下关的下拉（某制造企业 phoenix）：上一次没关掉的话这一下反而关上了。
    // 点完什么新东西都没出现就再点一次
    if (!deepAll("*", document.body).some(el => !wasVisible.has(el) && isVisible(el))) {
      fireClick(trigger);
      await sleep(250);
    }
    // 弹层自带搜索框（某制造企业籍贯/民族面板顶上的"搜索"）就在那里打字
    if (search) {
      const pop = deepAll("input", document.body).find(i => i !== searchInput && isVisible(i) && !wasVisible.has(i) && !i.readOnly &&
        /^(text|search|)$/i.test(i.getAttribute("type") || "") && closestDeep(i, POPUP_SEL + ", [class*=popover], [class*=dropdown], [class*=layer], [class*=panel], [class*=popup]"));
      if (pop) searchInput = pop;
    }
    // 只读框点开后才变成可输入（某科技公司 aui 的"请选择或者输入"）——点开之后再看
    if (search && searchInput && !searchInput.readOnly) {
      // 整段写入而不是模拟逐字键入：实测逐字太快，搜索框会漏字（"杭州"只剩"州"）
      setTextValue(searchInput, search);
      // 某科技公司 aui 只在 keyup 时过滤列表，光有 input 事件列表不变
      ["keydown", "keyup"].forEach(type => searchInput.dispatchEvent(new KeyboardEvent(type, { key: "Process", keyCode: 229, bubbles: true, composed: true })));
      await sleep(600);
    } else if (search && searchInput) {
      search = null;
    }
    for (let i = 0; i < attempts; i++) {
      const popups = deepAll(POPUP_SEL).filter(popupVisible);
      // Web Components 的 role=option 里常常只有 <slot>，textContent 是空的——
      // 空文字的选项不算，退回到"弹层里的可见叶子文字"
      let opts = popups.flatMap(p => deepAll(OPTION_SEL, p)).filter(o => isVisible(o) && o.textContent.trim());
      if (opts.length) SAW_OPTIONS = true;
      if (!opts.length) {
        opts = popups.flatMap(p => deepAll("*", p))
          .filter(el => textLeaf(el) && isVisible(el) && el.textContent.trim());
      }
      if (!opts.length) {
        opts = deepAll("*", document.body)
          .filter(el => textLeaf(el) && isVisible(el) && !wasVisible.has(el) && el.textContent.trim());
      }
      let hit = bestOption(opts, wants, minScore);
      // 允许自填的下拉会把打的字原样列成第一项（某科技公司"华中农业大学 / 华中农业大学"），
      // 同名时选后面那个真正的列表项
      if (hit && search) {
        const same = opts.filter(o => norm(o.textContent) === norm(hit.textContent));
        if (same.length > 1) hit = same[same.length - 1];
      }
      if (hit) {
        // 同一行里的圆圈/勾选框（"先勾选再确定"式面板：某制造企业民族/籍贯，每项前一个
        // 圆圈，底部 取消/确定）。点文字之前先记下它的样子，好判断点文字有没有勾上
        let tick = null;
        for (let a = hit, k = 0; a && k < 6 && !tick; a = a.parentElement, k++) {
          const ticks = Array.from(a.querySelectorAll("input[type=radio], input[type=checkbox], [class*=radio], [class*=checkbox], [class*=check], [class*=icon]"))
            .filter(el => !el.contains(hit) && !hit.contains(el) && el.getClientRects().length);
          if (ticks.length > 2) break; // 已经爬到整张列表了，再点就点到别的选项
          tick = ticks[0] || null;
        }
        const sig = (el) => el ? [typeof el.className === "string" ? el.className : (el.className && el.className.baseVal) || "",
          el.getAttribute("aria-checked"), el.checked, el.innerHTML.length].join("|") : "";
        const tickBefore = sig(tick);
        // 长列表里的目标常在滚动区外（年份 2126→1926，2020 在第 107 项）：先滚到眼前再点
        scrollIntoList(hit);
        await sleep(120);
        fireClick(hit);
        flash(trigger);
        await sleep(200);
        PICKED = true;
        if (!verify) return true;
        // 点完整个控件被网站换掉了（重画）：点击已经被接收，不再在旧元素上确认
        if (!trigger.isConnected) return true;
        // verify 可以直接返回 true/false（年份框的 yearVerify），也可以返回读到的文字
        const ok = () => { const got = verify(); return typeof got === "boolean" ? got : looksSet(got, [hit.textContent, ...wants]); };
        if (ok()) return true;
        const confirmBtn = () => deepAll("button, a, span, div", document.body).find(el => isVisible(el) && !wasVisible.has(el) &&
          /^(确定|确认|完成|ok|confirm|done)$/i.test(el.textContent.trim()) &&
          !Array.from(el.children).some(ch => /确定|确认|完成/i.test(ch.textContent || "")));
        const pressConfirm = async () => { const b = confirmBtn(); if (b) { fireClick(b); await sleep(300); } return ok(); };
        // 点文字没把圆圈勾上 → 点圆圈。勾上了就别再点（再点会取消勾选）
        if (tick && tick.isConnected && sig(tick) === tickBefore) {
          // 点圆圈正中的那个元素（通常是里面的 svg），和真人点击落点一样；
          // 某制造企业的监听挂在 svg 上，点外层容器没反应
          const r = tick.getBoundingClientRect();
          const under = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          fireClick(under && tick.contains(under) ? under : (tick.querySelector("svg, input, i") || tick));
          await sleep(200);
          if (ok()) return true;
        }
        if (await pressConfirm()) return true;
        if (hit.isConnected) { hit.click(); await sleep(250); if (ok() || await pressConfirm()) return true; }
        closePanel();
        return false;
      }
      await sleep(150);
    }
    closePanel();
    return false;
  }

  // ── 日期 ──
  // antd v4（某互联网公司）：.ant-picker-dropdown，格子 title="2026-05-01"，翻页按钮 .ant-picker-header-*-btn
  // antd v3（某电商公司）：.ant-calendar-picker-container，格子 title="2026年5月1日"，按钮 .ant-calendar-*-btn
  // 两者都：点开 → 用上一月/下一月/上一年/下一年翻到目标月 → 点 title 对应的格子。
  // 区间面板点完开始日期不会关，自动切到结束日期，接着再点一次即可。
  function openDatePanel() {
    return deepAll(".ant-picker-dropdown, .ant-calendar-picker-container").find(popupVisible);
  }

  async function pickInDatePanel(y, m, d) {
    const iso = `${y}-${pad2(m)}-${pad2(d)}`;
    const cn = `${Number(y)}年${Number(m)}月${Number(d)}日`;
    const target = Number(y) * 12 + Number(m) - 1;
    for (let guard = 0; guard < 300; guard++) {
      const p = openDatePanel();
      if (!p) return false;
      const cell = Array.from(p.querySelectorAll(`[title="${iso}"], [title="${cn}"]`)).find(c =>
        isVisible(c) && !/(last-month|next-month|cell-disabled)/.test(c.className) &&
        (!c.classList.contains("ant-picker-cell") || c.classList.contains("ant-picker-cell-in-view")));
      if (cell) {
        fireClick(cell.querySelector(".ant-picker-cell-inner, .ant-calendar-date") || cell);
        await sleep(250);
        return true;
      }
      const yb = p.querySelector(".ant-picker-year-btn, .ant-calendar-year-select");
      const mb = p.querySelector(".ant-picker-month-btn, .ant-calendar-month-select");
      if (!yb || !mb) return false;
      const diff = target - (parseInt(yb.textContent) * 12 + parseInt(mb.textContent) - 1);
      const big = Math.abs(diff) >= 12, fwd = diff > 0;
      const sel = big
        ? (fwd ? ".ant-picker-header-super-next-btn, .ant-calendar-next-year-btn" : ".ant-picker-header-super-prev-btn, .ant-calendar-prev-year-btn")
        : (fwd ? ".ant-picker-header-next-btn, .ant-calendar-next-month-btn" : ".ant-picker-header-prev-btn, .ant-calendar-prev-month-btn");
      // 区间面板左右各一套按钮，左边的"下一月"是隐藏的，挑可见的
      const btn = Array.from(p.querySelectorAll(sel)).find(b => isVisible(b) && b.style.visibility !== "hidden");
      if (!btn) return false;
      fireClick(btn);
      await sleep(80);
    }
    return false;
  }

  // 一个日期控件填一个日期。[y, m, d]，缺日默认 1 号（缺月不填，不瞎编）。
  // 每个字段花了多久、成没成（只记标签，不记值），排查"一直在找"用：AYA.trace
  let TRACE = [];
  const traced = (fn, what) => async (c, ...args) => {
    const t0 = Date.now();
    let ok = false;
    try { ok = await fn(c, ...args); return ok; }
    finally { const c0 = Array.isArray(c) ? c[0] : c;
      TRACE.push({ label: c0 && c0.label, kind: c0 && c0.kind, what, ms: Date.now() - t0, ok: !!ok }); }
  };
  const fillDate = traced(fillDate0, "date");
  async function fillDate0(c, ymd) {
    PICKED = false;
    let [y, m, d] = ymd || [];
    if (!y) return false;
    const isAntd = c.el.matches(".ant-picker, .ant-calendar-picker") || c.el.closest(".ant-picker, .ant-calendar-picker");
    // 某科技公司的日期框 placeholder 是"请选择"（所以被认成 picker），但其实能直接打字。
    // 能打字、要的又是完整年月的，走下面的文字输入
    const ph = c.input ? (c.input.getAttribute("placeholder") || "").trim() : "";
    const typable = c.input && !c.input.readOnly && m && !/^(年|月|YYYY|年份|月份)$/.test(ph);
    // 只选年份的点开式选择器（Moka/飞书 placeholder "YYYY"/"年"/"请选择年份"）。
    // 某外企 Moka 的出生日期也是只读框（placeholder"日期（年月日）"），原来一律当成
    // 年份下拉，在日历里找"2000"找不到，就点了最像的"20"号 → 填成了本月 20 日。
    const yearOnly = /年|yyyy/i.test(ph) && !/月|mm|日|dd/i.test(ph);
    const yearVerify = () => (readValue(c) || "").includes(String(y));
    if (c.kind === "picker" && !typable && (yearOnly || !m)) {
      return openAndChoose(c.input, [String(y), `${y}年`], { verify: yearVerify });
    }
    // 看不出是年份还是日期（placeholder 只写"请选择"）：先只认和年份完全一样的选项，
    // 不接受近似项，不行再按日期面板处理
    if (c.kind === "picker" && !typable && !/月|mm|日|dd/i.test(ph) &&
      await openAndChoose(c.input, [String(y), `${y}年`], { minScore: 28, attempts: 4, verify: yearVerify })) return true;
    if (!m) return false;
    d = d || 1;
    if (isAntd) {
      fireClick(c.input || c.el);
      await sleep(300);
      const ok = await pickInDatePanel(y, m, d);
      if (openDatePanel()) closePanel();
      return ok;
    }
    // 自研下拉式日期（某制造企业 phoenix）：框本身打字没用，先走弹层
    if (c.kind === "combo" || c.kind === "picker") {
      // 同一页的日期控件基本是同一种：上次哪种办法成功就先用哪种，省掉一半的开合
      const ways = DATE_WAY === "panel" ? [pickInGenericPanel, typeIntoDatePopup] : [typeIntoDatePopup, pickInGenericPanel];
      for (const way of ways) {
        if (await way(c, y, m, d)) { DATE_WAY = way === pickInGenericPanel ? "panel" : "input"; return true; }
      }
    }
    // Element UI / 原生 date / 普通文本：可以直接输入文字，回车确认
    if (c.input && !c.input.readOnly) {
      const val = c.input.type === "month" ? `${y}-${pad2(m)}` : `${y}-${pad2(m)}-${pad2(d)}`;
      setTextValue(c.input, val);
      pressEnter(c.input);
      c.input.dispatchEvent(new Event("blur", { bubbles: true }));
      await sleep(200);
      if (dateLooksSet(c, y, m)) return true;
    }
    if (c.kind !== "text") return false;
    // 看着是普通输入框、点开却是日历（飞书 throne-biz-date-range-picker）：打字不认，走面板
    return (await typeIntoDatePopup(c, y, m, d)) || pickInGenericPanel(c, y, m, d);
  }

  let DATE_WAY = null;
  const pressEnter = (el) => ["keydown", "keypress", "keyup"].forEach(type =>
    el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, composed: true })));

  // 读回来的值里依次出现了年、月，就算填上（"2001-10-15""2001年10月""2001/10"都认）
  function dateLooksSet(c, y, m) {
    const nums = (readValue(c) || "").match(/\d+/g) || [];
    const i = nums.findIndex(n => Number(n) === Number(y));
    return i >= 0 && Number(nums[i + 1]) === Number(m);
  }

  // 通用日历面板（没有输入框的月份/日期面板：某制造企业"开始时间"、rc-calendar、
  // 各家自研）：不认组件库，只认三样东西——
  //   ① 弹层里显示的年份（"2026" / "2026年"）；
  //   ② 年份旁边的"上一年/下一年"按钮（class 带 prev/next，或文字 « »）；
  //   ③ 写着"10月"/"10"的月份格子，选完如果出现日格子再点日。
  // 翻年后重新读年份确认，点完读回原控件确认。
  async function pickInGenericPanel(c, y, m, d) {
    const before = new Set(deepAll("*", document.body).filter(isVisible));
    fireClick(c.input || c.el);
    await sleep(350);
    const trig = c.input || c.el;
    const leaf = (el) => el.children.length === 0 || Array.from(el.children).every(ch => ch.tagName === "svg" || !ch.textContent.trim());
    const cls = (el) => typeof el.className === "string" ? el.className : (el.className && el.className.baseVal) || "";
    const isYear = (el) => leaf(el) && /^\d{4}\s*年?$/.test(el.textContent.trim());
    // 别的字段框里显示着的年份（带 display-value 的那一层）不是面板年份
    const inOtherField = (el) => isShownValue(el.parentElement || el);
    // 点一下开、再点一下关的框（某硬件公司 Moka 出生日期）：前一步没关干净时这一下反而关上了——
    // 看不到任何面板年份就再点一次。不能只看"有没有新元素"：Moka 点一下整块重画，别的框里
    // 显示的"2027"也成了新元素
    if (!deepAll("*", document.body).some(el => isVisible(el) && isYear(el) && !inOtherField(el))) {
      fireClick(trig);
      await sleep(350);
    }
    // 面板在点之前就开着（区间选择器选完开始自动切到结束）时，元素不是"新出现的"——
    // 那就退回"所有可见的年份文字里离这个框最近的那个"所在的面板
    let pool = () => deepAll("*", document.body).filter(el => isVisible(el) && !before.has(el));
    if (!pool().some(el => isYear(el) && !inOtherField(el))) {
      const fi = closestDeep(trig, FORM_ITEM_SEL) || parentDeep(trig);
      const tr = trig.getBoundingClientRect();
      const near = deepAll("*", document.body).filter(el => isVisible(el) && isYear(el) && !inOtherField(el) && !containsDeep(fi, el))
        .sort((a, b) => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.abs(p.top - tr.bottom) + Math.abs(p.left - tr.left) - Math.abs(q.top - tr.bottom) - Math.abs(q.left - tr.left); })[0];
      if (!near) { closePanel(); return false; }
      let panel = near;
      for (let k = 0; k < 8 && parentDeep(panel) && parentDeep(panel) !== document.body; k++) {
        const up = parentDeep(panel);
        if (containsDeep(up, trig)) break;
        panel = up;
      }
      pool = () => [panel, ...panel.querySelectorAll("*")].filter(isVisible);
    }
    const fresh = pool;
    // 离这个框最近的年份文字（面板就开在框旁边）。原来取"最后一个"：某硬件公司 Moka 的日期面板就画在
    // 字段里（不是挂到页面末尾），点开时整块重画，后面教育经历框里显示的"2022"也成了新元素，
    // 被当成面板年份，翻年按钮找不到，生日就一直空着
    const tr0 = trig.getBoundingClientRect();
    const dist = (el) => { const r = el.getBoundingClientRect(); return Math.abs(r.top - tr0.bottom) + Math.abs(r.left - tr0.left); };
    const yearEl = () => fresh().filter(el => isYear(el) && !inOtherField(el)).sort((p, q) => dist(p) - dist(q))[0];
    let ye = yearEl();
    if (!ye) { closePanel(); return false; }
    for (let guard = 0; guard < 40; guard++) {
      ye = yearEl();
      if (!ye) break;
      const cur = parseInt(ye.textContent);
      if (cur === Number(y)) break;
      // 年份所在的表头里找翻页按钮；"年"按钮优先于"月"按钮
      // 从年份往外一层层找，最近的那组按钮就是这个面板自己的
      const fwd = Number(y) > cur;
      const want = fwd ? /next|right|forward/i : /prev|left|back/i;
      const dbl = fwd ? /^(»|>>)$/ : /^(«|<<)$/;
      let btn = null;
      for (let head = ye.parentElement, k = 0; head && k < 5 && !btn; head = head.parentElement, k++) {
        const btns = Array.from(head.querySelectorAll("a, button, span, i, div")).filter(b => isVisible(b) && !b.contains(ye));
        btn = btns.find(b => want.test(cls(b)) && /year|super|double/i.test(cls(b))) ||
          btns.find(b => dbl.test(b.textContent.trim())) ||
          btns.find(b => want.test(cls(b)) && !/month|day/i.test(cls(b)));
      }
      // 按钮 class 里没有 prev/next（飞书 ud__picker：只有两个图标按钮）：表头里没文字的
      // 按钮，去掉展开/收起那个，按位置左=上一年、右=下一年
      if (!btn) {
        for (let head = ye.parentElement, k = 0; head && k < 4 && !btn; head = head.parentElement, k++) {
          const icons = Array.from(head.querySelectorAll("button, [role=button]")).filter(b => isVisible(b) && !b.textContent.trim() &&
            !/collapse|expand|rotate|toggle|drop|down|close|clear/i.test(cls(b) + " " + Array.from(b.querySelectorAll("*")).map(cls).join(" ")) &&
            b.getBoundingClientRect().left > ye.getBoundingClientRect().right - 1);
          if (icons.length >= 2) {
            icons.sort((p, q) => p.getBoundingClientRect().left - q.getBoundingClientRect().left);
            btn = fwd ? icons[icons.length - 1] : icons[0];
          }
        }
      }
      if (!btn) break;
      fireClick(btn, true);
      await sleep(120);
    }
    ye = yearEl();
    if (!ye || parseInt(ye.textContent) !== Number(y)) { closePanel(); return false; }
    // 按天选的日历（Moka sd-basic-selector："« ‹ 2026年 十月 › »" + 日期格）：年份旁边
    // 还显示着月份，就用单箭头翻到目标月，再点当月那一天。原来这里会去找"10月"格子，
    // 找不到就点了日期格里的"10"号，日子就错了。
    const monthEl = () => { const y2 = yearEl(); return y2 && Array.from(y2.parentElement.children).find(e => e !== y2 && leaf(e) && monthOf(e.textContent)); };
    if (monthEl()) return pickDayInCalendar(c, y, m, d, { yearEl, monthEl, fresh, leaf, cls });
    const mm = Number(m);
    // 月份格子的写法各家不同："10月""10""十月"（某硬件公司 Moka）"Oct"——都按 monthOf 认
    const cell = fresh().filter(el => leaf(el) && monthOf(el.textContent) === mm &&
      !/disabled/i.test(cls(el) + " " + cls(el.parentElement || el)))
      // 带字的（"10月""十月""Oct"）优先，避免点到日期格子里的"10"号
      .sort((p, q) => (/\D/.test(q.textContent.trim()) ? 1 : 0) - (/\D/.test(p.textContent.trim()) ? 1 : 0))[0];
    if (!cell) { closePanel(); return false; }
    fireClick(cell, true);
    await sleep(300);
    if (dateLooksSet(c, y, m)) return true;
    // 选完月份进入了日格子
    const dd = String(Number(d || 1));
    const day = fresh().find(el => leaf(el) && el.textContent.trim() === dd &&
      !/(last|next|prev)-?month|disabled|other/i.test(cls(el) + " " + cls(el.parentElement || el)));
    if (day) { fireClick(day, true); await sleep(300); if (dateLooksSet(c, y, m)) return true; }
    closePanel();
    return false;
  }

  // "10月""十月""10""Oct""October" → 10
  function monthOf(text) {
    const t = norm(text);
    let r = t.match(/^(\d{1,2})\s*月?$/);
    if (r && +r[1] >= 1 && +r[1] <= 12) return +r[1];
    const cn = "一二三四五六七八九";
    r = t.match(/^(十[一二]?|[一二三四五六七八九])月$/);
    if (r) { const x = r[1]; return x === "十" ? 10 : x[0] === "十" ? 10 + cn.indexOf(x[1]) + 1 : cn.indexOf(x) + 1; }
    const en = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const i = en.indexOf(t.slice(0, 3).toLowerCase());
    return /^[a-z]+\.?$/i.test(t) && i >= 0 ? i + 1 : 0;
  }

  async function pickDayInCalendar(c, y, m, d, { yearEl, monthEl, fresh, leaf, cls }) {
    const target = Number(m);
    for (let guard = 0; guard < 14; guard++) {
      const me = monthEl();
      if (!me) break;
      const cur = monthOf(me.textContent);
      if (cur === target) break;
      const fwd = target > cur;
      const want = fwd ? /next|right|forward/i : /prev|left|back/i;
      const single = fwd ? /^(›|>|＞)$/ : /^(‹|<|＜)$/;
      let btn = null;
      for (let head = me.parentElement, k = 0; head && k < 4 && !btn; head = head.parentElement, k++) {
        const btns = Array.from(head.querySelectorAll("a, button, span, i, div")).filter(b => isVisible(b) && !b.contains(me));
        // 单箭头 = 翻月；带 year/super/double 的是翻年，排除
        btn = btns.find(b => want.test(cls(b)) && !/year|super|double/i.test(cls(b))) || btns.find(b => single.test(b.textContent.trim()));
      }
      if (!btn) break;
      fireClick(btn, true);
      await sleep(120);
    }
    const me = monthEl(), ye = yearEl();
    if (!me || monthOf(me.textContent) !== target || !ye || parseInt(ye.textContent) !== Number(y)) { closePanel(); return false; }
    // 日期格里常露出上月末、下月初的灰色日子：只在"第一个 1 号"到"下一个 1 号"之间找
    const days = fresh().filter(el => leaf(el) && /^\d{1,2}$/.test(el.textContent.trim()) && +el.textContent.trim() <= 31 && !el.contains(me) && el !== me);
    const first = days.findIndex(el => el.textContent.trim() === "1");
    const next = days.findIndex((el, i) => i > first && el.textContent.trim() === "1");
    const inMonth = days.slice(Math.max(first, 0), next > first ? next : days.length);
    const dd = String(Number(d || 1));
    const day = inMonth.find(el => el.textContent.trim() === dd && !/disabled/i.test(cls(el) + " " + cls(el.parentElement || el)));
    if (!day) { closePanel(); return false; }
    fireClick(day, true);
    await sleep(300);
    const nums = (readValue(c) || "").match(/\d+/g) || [];
    const i = nums.findIndex(n => Number(n) === Number(y));
    if (i >= 0 && Number(nums[i + 1]) === target && Number(nums[i + 2]) === Number(dd)) return true;
    closePanel();
    return false;
  }

  // 通用日期弹层：点开后弹层里多出一个可输入的日期框（rc-calendar 一系：某制造企业
  // phoenix-calendar-input，很多自研组件都是这个结构），照它现有值/占位符的格式
  // 写日期 → 回车 → 读回原控件确认。不认组件库，只认"点开后新出现的日期输入框"。
  async function typeIntoDatePopup(c, y, m, d) {
    const trigger = c.input || c.el;
    const before = new Set(deepAll("input", document.body).filter(isVisible));
    fireClick(trigger);
    await sleep(350);
    const chain = (el) => { const out = []; for (let a = el, k = 0; a && k < 6; k++, a = parentDeep(a)) out.push(typeof a.className === "string" ? a.className : ""); return out.join(" "); };
    const pin = deepAll("input", document.body).find(i => i !== c.input && isVisible(i) && !before.has(i) && !i.readOnly &&
      /calendar|date|picker|time/i.test(chain(i)));
    if (!pin) { closePanel(); return false; }
    const fmt = (pin.value || pin.getAttribute("placeholder") || "").trim();
    const sep = (fmt.match(/^(?:\d{4}|Y{4})([-/.年])/i) || [])[1] || "-";
    const monthOnly = /^(\d{4}|Y{4})[-/.年](\d{1,2}|M{2})月?$/i.test(fmt);
    const val = sep === "年" ? `${y}年${Number(m)}月${monthOnly ? "" : Number(d) + "日"}`
      : [y, pad2(m)].concat(monthOnly ? [] : [pad2(d)]).join(sep);
    pin.focus();
    setTextValue(pin, val);
    await sleep(250);
    pressEnter(pin);
    await sleep(350);
    if (dateLooksSet(c, y, m)) return true;
    closePanel();
    return false;
  }

  // 一行里所有被认成"起止时间"的控件，按 part 排好序，按数量决定怎么分配：
  //   1 个区间控件（某互联网公司 antd range）→ 开始、结束连续点
  //   2 个日期控件（某电商公司 开始日期 ~ 结束日期）→ 各填一个
  //   4 个点开式选择器（Moka 年/月/年/月）→ 依次选
  //   1 个普通日期 → 当成开始日期
  // ongoing（至今）不填结束日期，交给"至今"复选框或用户自己处理。
  // 日期精确到日、profile 只有年月时：开始取 1 号，结束取当月最后一天。
  // 踩过的坑：结束也取 1 号的话，同月的比赛（5 月开始、5 月结束）会变成"05-01 → 05-01"。
  const lastDay = (y, m) => new Date(Number(y), Number(m), 0).getDate();

  // 一个控件里并排两个显示格（飞书 period picker：一个隐藏 input + "YYYY-MM"开始格 +
  // "YYYY-MM"结束格）。不认组件库：在控件外层的日期/选择器容器里，找"自己显示的是
  // 日期格式提示、日期或至今"的最外层元素，正好两个就当成开始格、结束格。
  const DATE_SHOWN = /^(\d{4}\s*[-/.年]\s*\d{1,2}\s*月?(\s*[-/.]\s*\d{1,2}\s*日?)?|\d{4}\s*年?|至今|现在|now|present)$/i;
  function rangeSlots(c) {
    let box = c.el;
    for (let k = 0; k < 4 && box; k++, box = parentDeep(box)) {
      const cls = typeof box.className === "string" ? box.className : "";
      if (/date|picker|period|range|calendar|time/i.test(cls) && box.tagName !== "INPUT") break;
    }
    if (!box || box === document.body || box.tagName === "INPUT") return null;
    const shows = (el) => { const t = norm(el.innerText || ""); return t && (FORMAT_TEXT.test(t) || DATE_SHOWN.test(t)); };
    const slots = Array.from(box.querySelectorAll("*")).filter(el => isVisible(el) && el.tagName !== "INPUT" && shows(el) &&
      !(el.parentElement && el.parentElement !== box && shows(el.parentElement)));
    return slots.length === 2 ? slots : null;
  }

  // 滚动列式年月面板：左列年份（结束列可能还有"至今"），右列 01–12。
  // 只认"同一个父元素下 ≥3 个年份/月份文字"的列表，取离触发格最近的那组；
  // 面板已经自己弹出来（选完开始自动跳到结束）就直接用，没有再点触发格。
  async function pickColumns(trigger, y, m, ok, toNow) {
    const leaf = (el) => el.children.length === 0 || Array.from(el.children).every(ch => !ch.textContent.trim());
    const dist = (el) => { const a = el.getBoundingClientRect(), b = trigger.getBoundingClientRect(); return Math.abs(a.left - b.left) + Math.abs(a.top - b.bottom); };
    const column = (re) => {
      const groups = new Map();
      for (const el of deepAll("*", document.body)) {
        if (!leaf(el) || !re.test(el.textContent.trim()) || !isVisible(el) || containsDeep(trigger, el)) continue;
        const p = el.parentElement;
        groups.set(p, (groups.get(p) || []).concat(el));
      }
      return [...groups.entries()].filter(([, g]) => g.length >= 3).sort((a, b) => dist(a[0]) - dist(b[0])).map(([, g]) => g)[0] || null;
    };
    const YEAR = /^\d{4}\s*年?$/, MONTH = /^(0?[1-9]|1[0-2])\s*月?$/, NOW = /^(至今|现在|今|now|present)$/i;
    for (let attempt = 0; attempt < 2; attempt++) {
      let years = attempt === 0 ? column(YEAR) : null;
      if (!years) { fireClick(trigger); await sleep(350); years = column(YEAR); }
      if (!years) continue;
      if (toNow) {
        const now = Array.from(years[0].parentElement.children).find(el => NOW.test(el.textContent.trim()));
        if (!now) return false;
        fireClick(now, true); await sleep(300);
        if (ok()) return true;
        continue;
      }
      const ye = years.find(el => parseInt(el.textContent) === Number(y));
      if (!ye) return false;
      fireClick(ye, true); await sleep(250);
      const months = column(MONTH);
      const me = months && months.find(el => parseInt(el.textContent) === Number(m));
      if (!me) continue;
      fireClick(me, true); await sleep(300);
      if (ok()) return true;
    }
    return false;
  }

  // 日期面板里的"至今"格子：面板可能已经开着（选完开始自动切到结束），先找离这个框
  // 最近的"至今"，没有再点开找
  async function pickNowInPanel(c) {
    const trig = c.input || c.el;
    const fi = closestDeep(trig, FORM_ITEM_SEL) || parentDeep(trig);
    const NOW = /^(至今|现在|今|now|present)$/i;
    const find = () => {
      const tr = trig.getBoundingClientRect();
      return deepAll("*", document.body).filter(el => el.children.length === 0 && NOW.test(el.textContent.trim()) && isVisible(el) && !containsDeep(fi, el))
        .sort((a, b) => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return Math.abs(p.top - tr.bottom) + Math.abs(p.left - tr.left) - Math.abs(q.top - tr.bottom) - Math.abs(q.left - tr.left); })[0];
    };
    let now = find();
    if (!now) { fireClick(trig); await sleep(350); now = find(); }
    if (!now) { closePanel(); return false; }
    fireClick(now, true);
    await sleep(300);
    if (/至今|现在|now|present/i.test(readValue(c))) return true;
    closePanel();
    return false;
  }

  const fillRange = traced(fillRange0, "range");
  async function fillRange0(parts, r, overwrite) {
    let filled = 0;
    const S = [r.start_year, r.start_month, r.start_day || 1];
    let E = [r.end_year, r.end_month, r.end_day || (r.end_year && r.end_month ? lastDay(r.end_year, r.end_month) : undefined)];
    // "至今"：有"至今"复选框的网站交给复选框（fillGroup 里处理）；没有复选框、
    // 结束日期又必填的（某互联网公司/某电商公司的区间选择器不允许只填开始），填今天——
    // 至今的意思就是到投递当天。获奖时间这种单个日期（end_year 本来就没有）不走这里。
    const hasEndSlot = parts.length >= 2 || (parts[0] && parts[0].kind === "date-range");
    let tryNow = false;
    if (r.ongoing && r.ongoing !== "single" && hasEndSlot && !r.hasOngoingBox) {
      const t = new Date();
      E = [t.getFullYear(), t.getMonth() + 1, t.getDate()];
      r = Object.assign({}, r, { ongoing: false });
      tryNow = true; // 结束日期面板里有"至今"就选至今（飞书），没有才填今天
    }
    const need = (c) => overwrite || !readValue(c);
    if (parts.length === 1 && parts[0].kind === "date-range") {
      const c = parts[0];
      if (!need(c) || !r.start_year || !r.start_month) return 0;
      const inputs = Array.from(c.el.querySelectorAll("input"));
      if (c.el.matches(".el-range-editor")) {
        setTextValue(inputs[0], `${S[0]}-${pad2(S[1])}-${pad2(S[2] || 1)}`); filled++;
        if (!r.ongoing && E[0]) { setTextValue(inputs[1], `${E[0]}-${pad2(E[1])}-${pad2(E[2] || 1)}`); filled++; }
        return filled;
      }
      fireClick(inputs[0] || c.el);
      await sleep(300);
      if (await pickInDatePanel(S[0], S[1], S[2] || 1)) filled++;
      if (!r.ongoing && E[0] && E[1] && await pickInDatePanel(E[0], E[1], E[2] || 1)) filled++;
      if (openDatePanel()) closePanel();
      return filled;
    }
    const slots = parts.length === 1 && parts[0].kind !== "date-range" ? rangeSlots(parts[0]) : null;
    if (slots) {
      if (!r.start_year || !r.start_month) return 0;
      const showsDate = (el, y, m) => { const n = norm(el.innerText).match(/\d+/g) || []; return Number(n[0]) === Number(y) && Number(n[1]) === Number(m); };
      const empty = (el) => !DATE_SHOWN.test(norm(el.innerText));
      const ongoing = r.ongoing && r.ongoing !== "single";
      let want = 0;
      if (overwrite || empty(slots[0])) { want++; if (await pickColumns(slots[0], S[0], S[1], () => showsDate(slots[0], S[0], S[1]))) filled++; }
      if (overwrite || empty(slots[1])) {
        if (ongoing) {
          want++;
          if (await pickColumns(slots[1], 0, 0, () => /至今|现在|now|present/i.test(slots[1].innerText), true)) filled++;
          else { const t = new Date(); if (await pickColumns(slots[1], t.getFullYear(), t.getMonth() + 1, () => showsDate(slots[1], t.getFullYear(), t.getMonth() + 1))) filled++; }
        } else if (E[0] && E[1]) {
          want++;
          if (await pickColumns(slots[1], E[0], E[1], () => showsDate(slots[1], E[0], E[1]))) filled++;
        }
      }
      closePanel();
      // 只填上一半（开始有、结束没有）也要让用户知道
      parts.partial = filled > 0 && filled < want;
      return filled;
    }
    // 点开式年/月框选上值以后 placeholder"年""月"就没了，会被认成 combo。
    // 踩过的坑（某游戏公司 Moka 项目经验）：开始年月已有值、结束为空，四个框一半 combo 一半 picker，
    // 没走这里，掉进下面的"普通日期"分支——整串开始日期写进了年份框，结束年月也没填。
    const ymBox = (c) => c.kind === "picker" || c.kind === "combo";
    if (parts.length === 4 && parts.every(ymBox)) {
      const vals = [S[0], S[1], r.ongoing ? null : E[0], r.ongoing ? null : E[1]];
      // 先记下哪几格本来是空的：某硬件公司 Moka 一选年份，月份自动变成"1"，事后再看就以为月份填过了
      const needs = parts.map(need);
      for (let i = 0; i < 4; i++) {
        if (!vals[i] || !needs[i]) continue;
        const v = String(Number(vals[i]));
        PICKED = false; // 四个框各是各的
        if (await openAndChoose(parts[i].input, i % 2 === 0 ? [v, `${v}年`] : [v, pad2(v), `${v}月`], { minScore: 28, verify: () => readValue(parts[i]) })) filled++;
      }
      return filled;
    }
    if (parts.length === 2 && parts.every(ymBox)) {
      // 两个点开式：可能是"开始年份/结束年份"，也可能是同一个日期的"年/月"，
      // 看 placeholder 判断；已选过值的框没有 placeholder，就看显示的是不是"年份 + 1–12"
      const ph = parts.map(c => (c.input.getAttribute("placeholder") || ""));
      const shown = parts.map(c => norm(readValue(c) || ""));
      // placeholder 要"只是年/月"：某游戏公司 Moka 校园经历的两个按天日历 placeholder 是"日期（年月日）"，
      // 里面也有"月"，被当成年+月一对 → 结束时间被点成了本月 9 号（9 是开始月份）
      const YPH = /^(请?选择)?(年|年份|yyyy)$/i, MPH = /^(请?选择)?(月|月份|mm)$/i;
      const YV = /^\d{4}年?$/, MV = /^(0?[1-9]|1[0-2])月?$/;
      const isY = (i) => YPH.test(ph[i].trim()) || YV.test(shown[i]), isM = (i) => MPH.test(ph[i].trim()) || MV.test(shown[i]);
      const looksYM = isY(0) && isM(1) && !/日|dd/i.test(ph[0] + ph[1]);
      if (looksYM) {
        PICKED = false;
        // 月份要不要填，在选年之前看：某硬件公司 Moka 一选年份，月份自动变成"1"，事后再看就以为月份已经填了
        const needMonth = need(parts[1]);
        // 只认完全一致的年/月（"1"不能点成"10""11"）
        if (need(parts[0]) && await openAndChoose(parts[0].input, [String(S[0]), `${S[0]}年`], { minScore: 28, verify: () => readValue(parts[0]) })) filled++;
        PICKED = false;
        if (needMonth && S[1] && await openAndChoose(parts[1].input, [String(Number(S[1])), pad2(S[1]), `${Number(S[1])}月`], { minScore: 28, verify: () => readValue(parts[1]) })) filled++;
        return filled;
      }
    }
    if (parts[0] && need(parts[0]) && await fillDate(parts[0], S)) filled++;
    if (parts[1] && !r.ongoing && need(parts[1]) && ((tryNow && await pickNowInPanel(parts[1])) || await fillDate(parts[1], E))) filled++;
    return filled;
  }

  // 打字 → 等候选 → 点最像的那项，最后读回输入框确认。search 可以给多个写法
  // （"杭州"搜不到就试"Hangzhou"）。
  async function chooseByTyping(c, wants, search) {
    // 没给专门的搜索词就把每种写法都搜一遍（"IELTS 6.5"搜不到，"雅思"能搜到）
    const terms = [...new Set([].concat(search || wants.slice(0, 4)).filter(Boolean))];
    for (const term of terms) {
      const w2 = wants.concat(term);
      w2.judge = wants.judge;
      if (await openAndChoose(c.input, w2, { search: term, searchInput: c.input, attempts: 14, verify: () => c.input.value })) return true;
    }
    return false;
  }

  // 把一个值填进一个控件。v 可以是字符串（文本 / 选项），syn 是备选的选项写法。
  // 返回值是"读回来确认过"的结果，不是"事件发出去了"。
  // judge：按事实给选项打分（学历类字段，见 eduJudge）；有它时只按它选，不再按文字近似
  const applyValue = traced(applyValue0, "value");
  async function applyValue0(c, v, { syn = null, search = null, judge = null } = {}) {
    PICKED = false;
    if (v === undefined || v === null || v === "") return false;
    const wants = (syn && syn.length ? syn : [v]).map(String);
    if (judge) wants.judge = judge; // 跟着 wants 传到 openAndChoose / bestOption
    switch (c.kind) {
      case "text": case "textarea": {
        // 单行框存不下换行，浏览器会吞掉，读回来对不上就当成失败（某消费品公司"特长兴趣"）：换成分号
        if (c.input && c.input.tagName === "INPUT") v = String(v).replace(/\s*\n+\s*/g, "；");
        if (await writeText(c.input, String(v))) return true;
        if (c.kind === "textarea") return false;
        // 写进去又被清掉：其实是"必须从候选里选"的框（没标 role=combobox 的自动补全）。
        // 按 combo 再试一次，控件类型认错了也能自愈
        const ok = await chooseByTyping(c, wants, search);
        if (ok) c.kind = "combo";
        return ok;
      }
      case "native-select": {
        const opt = bestOption(Array.from(c.el.options), wants);
        if (!opt) return false;
        c.el.value = opt.value;
        c.el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        c.el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        flash(c.el);
        return c.el.value === opt.value;
      }
      case "radio": {
        const options = c.radios
          ? c.radios.map(r => ({ el: r, textContent: (r.closest("label") || r.parentElement).innerText || "" }))
          : Array.from(c.el.querySelectorAll(".ant-radio-wrapper, .el-radio, label")).map(l => ({ el: l, textContent: l.innerText }));
        const hit = bestOption(options, wants);
        if (!hit) return false;
        const target = hit.el.tagName === "INPUT" ? hit.el : (hit.el.querySelector("input") || hit.el);
        target.click(); // 真 click，React 受控组件才会更新状态
        flash(hit.el);
        return true;
      }
      case "checkbox":
        if (!c.el.checked) c.el.click();
        return c.el.checked;
      case "select": {
        const trigger = c.el.querySelector(".ant-select-selection, .ant-select-selector, .atsx-select-selection, .el-input__inner, .el-select__wrapper") || c.el;
        const terms = [].concat(search || []).filter(Boolean);
        search = terms[0];
        const si = c.el.querySelector(".ant-select-search__field, .ant-select-selection-search-input, .atsx-select-search__field, input.el-input__inner");
        const searchInput = si && !si.readOnly ? si : null;
        // 先只认"完全相等"的选项；没有再搜索，最后看完整列表里有没有"以它开头+括号/后缀"的写法（不接受只是包含的）。
        // 踩过的坑（某互联网公司"最高学历专业"）：可搜索的长列表初始只显示一部分，"统计学"
        // 不在里面，按"包含"打分直接点中了"经济统计学"。
        const verify = () => readValue(c);
        if (await openAndChoose(trigger, wants, { minScore: 28, attempts: 6, verify })) return true;
        if (searchInput) {
          const ts = terms.length ? terms : [wants[0]];
          for (const t of ts) if (await openAndChoose(trigger, wants, { search: t, searchInput, minScore: 28, verify })) return true;
          for (const t of ts) if (await openAndChoose(trigger, wants, { search: t, searchInput, attempts: 4, verify })) return true;
          return false;
        }
        return openAndChoose(trigger, wants, { attempts: 4, verify });
      }
      case "combo": {
        SAW_OPTIONS = false;
        // 点开就有完整列表的（某制造企业民族/英语等级）先直接找完全相等的项，找不到再打字搜
        if (await openAndChoose(c.input, wants, { minScore: 28, attempts: 4, verify: () => readValue(c) })) return true;
        if (await chooseByTyping(c, wants, search)) return true;
        // 打字、点开都从来没弹出过候选（某硬件公司 Moka 未登录时的"学校名称"）：它其实是能自由输入的框，
        // 写进去离开后还在就算填上，不再反复点开找
        if (!SAW_OPTIONS) { closePanel(); return writeText(c.input, String(v)); }
        // 搜索框只认开头的字、搜不出来时：回到完整列表再找一次（仍然只接受完全一致或"开头+括号/后缀"）
        return openAndChoose(c.input, wants, { attempts: 4, verify: () => readValue(c) });
      }
      case "picker": {
        const verify = () => readValue(c);
        if (!search) return openAndChoose(c.input, wants, { verify });
        // 可搜索的大列表（国籍、学校、专业）：初始只显示前面一截。和 select 一样
        // 先只认完全相等，再打字过滤，最后回完整列表再找——都不接受"只是包含"的项，免得"统计学"点中"统计学与机器学习"。
        // 框是不是可输入要点开才知道（openAndChoose 里判断）
        const terms = [].concat(search).filter(Boolean);
        if (await openAndChoose(c.input, wants, { minScore: 28, attempts: 4, verify })) return true;
        for (const term of terms) if (await openAndChoose(c.input, wants, { search: term, searchInput: c.input, minScore: 28, verify })) return true;
        for (const term of terms) if (await openAndChoose(c.input, wants, { search: term, searchInput: c.input, attempts: 6, verify })) return true;
        return false;
      }
      case "cascader":
        return false; // 省/市/区级联：各家结构差太多，先不自动填，诊断里会列出来
      case "date": case "date-range":
        return false; // 日期走 fillDate / fillRange
    }
    return false;
  }

  // ════════════════════════ 6. 组装 ════════════════════════

  // 标签 → 规则：最具体的匹配胜出，而不是"列表里第一条命中的"。
  // 过去好几次出错都是同一个原因——规则按顺序抢：
  //   "最高学历专业"被"最高学历"抢走、"技能特长"差点被"特长"抢走、
  //   "告诉公司您有兴趣在那里工作"被"兴趣"抢走、"名字"在有"姓氏"框时该填名不该填全名。
  // 现在：命中的文字越长越具体（"最高学历专业" 6 字 > "最高学历" 4 字）；
  // 整个标签被 ^…$ 完整匹配的最长；一样长才看列表顺序。
  // block 规则（紧急联系人、父母…）一旦命中直接否决，不参与比较。
  function bestRule(rules, c) {
    const label = c.label || "";
    if (!label) return null;
    let best = null, bestLen = 0;
    for (const f of rules) {
      // "combo"（能打字的下拉）是后来才加的类型，早期规则的 kinds 只写了 select/picker——
      // 写了下拉类的规则一律也认 combo（某外企 Moka 的"奖项级别"就因此一直没填）
      if (f.kinds && !f.kinds.includes(c.kind) && !(c.kind === "combo" && f.kinds.some(k => k === "select" || k === "picker"))) continue;
      if (f.not && f.not.test(label)) continue;
      const m = label.match(f.re);
      if (!m || !m[0].length) continue;
      if (f.block) return f;
      if (m[0].length > bestLen) { best = f; bestLen = m[0].length; }
    }
    return best;
  }

  function fieldFor(schema, c) {
    const f = bestRule(schema.fields, c);
    return f && (c.part === 0 || f.range) ? f : null;
  }

  function buildModel(profile) {
    const ctrls = discoverControls();
    const texts = collectTexts(ctrls);
    resolveLabels(ctrls, texts);
    const sections = buildSections(ctrls, texts);
    // 分区内分行：同一个字段（key + part）第 N 次出现就属于第 N 行
    const groups = sections.map(sec => ({ sec, schema: SCHEMAS[sec.type] || null, rows: [] }));
    const loose = [];
    for (const c of ctrls) {
      const g = c.section && groups.find(g => g.sec === c.section);
      if (!g || !g.schema) { loose.push(c); continue; }
      const f = fieldFor(g.schema, c);
      c.field = f;
      if (!f) continue;
      // 两个各自带标签的日期框（"开始时间""结束时间"，SmartRecruiters 的"从/至"）：
      // 结束那个算第 2 部分，不然会被当成下一行的开始时间
      if (f.range && !c.part && /^(结束|截止|终止)/.test(c.label)) c.part = 1;
      // 同一行里不同标签映射到同一字段（"项目描述""项目成果"都像描述）不算换行；
      // 同一个标签第 N 次出现才是第 N 行
      const slot = f.key + "#" + (f.range ? c.part : 0) + "#" + (f.range ? "" : c.label);
      g.counts = g.counts || {};
      g.counts[slot] = (g.counts[slot] || 0) + 1;
      const rowIdx = g.counts[slot] - 1;
      const row = g.rows[rowIdx] = g.rows[rowIdx] || new Map();
      if (!row.has(f.key)) row.set(f.key, []);
      row.get(f.key).push(c);
    }
    for (const g of groups) g.rows = Array.from(g.rows, r => r || new Map());
    // 分区里不在输入框里的短文字：已保存条目的卡片（"某某公司 / 2023.07"）
    for (const g of groups) {
      const labelEls = new Set(ctrls.map(c => c.labelEl).filter(Boolean));
      g.shownTexts = texts.filter(t => !labelEls.has(t.el) && before(g.sec.el, t.el) && (!g.sec.next || before(t.el, g.sec.next.el)))
        .map(t => t.text);
    }
    return { ctrls, sections, groups, loose };
  }

  // 判断"页面上已有的这一行"和"profile 里的这一条"是不是同一段经历。
  // 踩过的坑（某电商公司）：用户自己写的名字和 profile 里的叫法经常差很多——
  // "基于 RAG + LLM 的智能…" vs "本科毕业设计｜Coze RAG + LLM 智能知识检索"、
  // "第六届 XX杯 高校…" vs "XX杯 全国大学生数学建模挑战赛"。
  // 只用"互相包含"判断对不上，插件就把同一个项目/奖项又加了一行，出现重复。
  // 现在两种信号任一成立就算同一条：
  //   ① 有共同的英文词（≥3 个字母：rag / llm / xgboost…），这类词几乎都是专名；
  //   ② 中文按相邻两字切片后的重合度（Dice 系数）≥ 0.35。
  const simKey = (s) => norm(s).replace(/[｜|·•，,。.、“”"'()（）\-+]/g, "").toLowerCase();
  function similarity(a, b) {
    const A = simKey(a), B = simKey(b);
    if (!A || !B) return 0;
    if (A.includes(B) || B.includes(A)) return 1;
    // 共有一个英文实词才算很像；"university""college"这类通用词不算
    // （"University of Edinburgh"和"Huazhong Agricultural University"不是同一所学校）
    const GENERIC_EN = /^(university|college|school|institute|institution|academy|the|and|for|of|technology|science|sciences|national|international|company|group|limited|ltd|inc|corp|corporation|center|centre|department|project|analysis)$/;
    const words = (s) => (s.match(/[a-z]{3,}/g) || []).filter(w => !GENERIC_EN.test(w));
    const wa = new Set(words(A));
    if (words(B).some(w => wa.has(w))) return 0.9;
    const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
    const ga = grams(A), gb = grams(B);
    let both = 0; ga.forEach(x => { if (gb.has(x)) both++; });
    return ga.size + gb.size ? (2 * both) / (ga.size + gb.size) : 0;
  }

  // 一个分区：先把已有内容的行对上条目（按相似度从高到低贪心配对，每条只用一次），
  // 剩下的条目进空行，空行不够就点"添加"
  const entryKey = (g, e, j) => g.sec.type + "|" + (g.schema.entryName(e) || j);
  // 长文字比内容：去掉空白、标点和【背景与任务】这类小标题，前 40 个字互相包含，
  // 或整体二元组重合度 ≥ 0.6（用户改过几个字也认得出来）
  const bodyKey = (s) => String(s || "").replace(/【[^】]{0,12}】/g, "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
  function sameText(a, b) {
    const A = bodyKey(a), B = bodyKey(b);
    if (A.length < 6 || B.length < 6) return A && A === B;
    if (A.includes(B.slice(0, 40)) || B.includes(A.slice(0, 40))) return true;
    const grams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
    const ga = grams(A), gb = grams(B);
    let both = 0; ga.forEach(x => { if (gb.has(x)) both++; });
    return (2 * both) / (ga.size + gb.size) >= 0.6;
  }
  // 一行里有没有填过东西（文字框、多行框、可输入下拉）。日期和勾选框不算：网站常常预设
  const rowTextCtrls = (row) => Array.from(row.values()).flat().filter(c => c.part === 0 || c.part == null)
    .filter(c => c.kind === "text" || c.kind === "textarea" || c.kind === "combo");
  // 没有名称框的行（某游戏公司 Moka 的项目经验只有 起止时间 / 至今 / 项目描述）：
  // 按框里的内容和这一条会写进去的内容比。原来没有名称框就当成空行，
  // 下一条项目又填进第一行：不开覆盖时报"无可填写"，开了覆盖就把上一条盖掉（2026-11-06）
  function contentScore(g, row, e, profile) {
    for (const f of g.schema.fields) {
      if (f.range || f.check || f.date || !f.val) continue;
      for (const c of row.get(f.key) || []) {
        const have = readValue(c);
        if (!have) continue;
        let want = "";
        try { want = f.val(e, profile, row); } catch (err) {}
        if (want && sameText(have, want)) return 1;
      }
    }
    return 0;
  }
  // 单项填写时插件只拿到要填的那一条（profile-view.js 的 only），看不到别的条目：
  // "华中地区高校数学建模邀请赛"那一行和要填的"华中农业大学数学建模竞赛"名字很像，
  // 被当成同一条，又把上一条盖掉。FULL 是完整资料，只用来认"页面上已有的行是哪一条"
  let FULL = null;
  function planRows(g, profile) {
    const rowsText = g.rows.map(r => Array.from(r.values()).flat().map(c => c.label).join(" ")).join(" ");
    const entries = g.schema.entries(profile, g.sec, rowsText);
    const assign = [];
    const filledRows = [];
    g.rows.forEach((row, i) => {
      const anchor = row.get(g.schema.anchor);
      if (anchor) {
        const text = readValue(anchor[0]);
        if (text) filledRows.push({ i, text }); else assign[i] = null;
      } else if (rowTextCtrls(row).some(c => readValue(c))) filledRows.push({ i, text: "", byContent: true });
      else assign[i] = null;
    });
    // "填一条 → 保存 → 变成卡片 → 再点添加"式的网站（SmartRecruiters、很多外企 ATS）：
    // 已保存的条目不在输入框里，只以文字出现在分区里。名字对得上的条目算已经有了，
    // 不然每次重新扫描都会把第一条再填一遍
    // 配对用完整资料里的全部条目（单项填写时也一样），配上的若不是这次要填的，那一行不碰
    const nameOf = (e) => g.schema.entryName(e) || "";
    let all = entries;
    if (FULL) {
      try { all = g.schema.entries(FULL, g.sec, rowsText); } catch (err) { all = entries; }
      const have = new Set(all.map(nameOf));
      all = all.concat(entries.filter(e => !have.has(nameOf(e))));
    }
    const target = (e) => entries.find(x => x === e || nameOf(x) === nameOf(e)) || null;
    const shown = new Set();
    const namesOf = (e) => (g.schema.entryNames ? g.schema.entryNames(e) : [g.schema.entryName(e)]).filter(Boolean);
    const nameSc = (t, e) => Math.max(0, ...namesOf(e).map(name => similarity(t, name)));
    // 页面上显示过的卡片文字：算在和它最像的那一条头上，不再算给每一条名字有点像的
    for (const t of g.shownTexts || []) {
      if (t.length < 2) continue;
      let best = -1, bs = 0;
      all.forEach((e, k) => { const s = nameSc(t, e); if (s > bs) { bs = s; best = k; } });
      if (bs >= 0.6) { const tg = target(all[best]); if (tg) shown.add(entries.indexOf(tg)); }
    }
    const pairs = [];
    for (const r of filledRows) {
      const row = g.rows[r.i];
      all.forEach((e, k) => {
        const sc = r.byContent ? contentScore(g, row, e, profile) : nameSc(r.text, e);
        if (sc >= 0.35) pairs.push({ i: r.i, k, sc });
      });
    }
    pairs.sort((a, b) => b.sc - a.sc);
    // 按名称配行时所有条目都参与、分高的先配；"页面上显示过"（shown）只用来决定还缺不缺、
    // 要不要开新行。原来 shown 的条目直接不参与配对——学校按中文名选上后显示英文名"University of Edinburgh"
    // 被当成已保存卡片，第一行只好配给二元组相似度更低的另一所学校，第二条就永远不开行
    const usedRow = new Set(), usedEntry = new Set(), usedAll = new Set();
    for (const { i, k } of pairs) {
      if (usedRow.has(i) || usedAll.has(k)) continue;
      usedRow.add(i); usedAll.add(k);
      const tg = target(all[k]);
      if (tg) usedEntry.add(entries.indexOf(tg));
      assign[i] = { entry: tg, existing: true };
    }
    // 有内容但对不上任何条目的行：用户自己写的、profile 里没有的——不碰
    for (const r of filledRows) if (!usedRow.has(r.i)) assign[r.i] = { entry: null, existing: true };
    // 已经分配过行、但那一行锚点没填上的条目：不再开新行（见 ATTEMPTED）
    const rest = entries.filter((e, j) => !usedEntry.has(j) && !shown.has(j) && !ATTEMPTED.has(entryKey(g, e, j)));
    g.rows.forEach((row, i) => {
      if (assign[i] === null) assign[i] = rest.length ? { entry: rest.shift(), existing: false } : { entry: null };
    });
    return { assign, missing: rest.length, entries };
  }

  // 页面上所有"添加/新增"按钮（取最内层元素）。排除"添加学校全称"这类自动补全提示、
  // "上传附件"之类。
  function findAddButtons() {
    // 自定义按钮组件（<spl-button>、<sl-button>）文字直接挂在宿主上，也要算
    return deepAll("button, a, span, div, i, [role=button]", document.body)
      .concat(deepAll("*", document.body).filter(el => /-button$/.test(el.localName)))
      .filter(el => {
        if (!isVisible(el) || closestDeep(el, POPUP_SEL)) return false;
        const t = norm(el.textContent);
        if (!t || t.length > 8 || !/^[+＋]?(添加|新增|增加)/.test(t) || /删除|移除|全称|附件|上传/.test(t)) return false;
        return !Array.from(el.children).some(ch => /添加|新增|增加/.test(ch.textContent || ""));
      })
      .sort(domOrder);
  }

  function findAddButton(sec) {
    return findAddButtons().find(el => before(sec.el, el) && (!sec.next || before(el, sec.next.el))) || null;
  }

  // 认出了字段、profile 也有值、但读回验证没通过的控件——包括"文字留在框里、
  // 网站其实没接受"的情况，所以不能只看最后框是不是空的。之后哪一轮填成功了
  // 再划掉。报告里只有标签文字，没有个人信息。
  let MISSED = new Map();
  // 这一次填充里已经失败过的控件：后面几轮不再重试（否则对不上的下拉每轮都开合好几次）
  let FAILED = new WeakSet();
  // 这一次填充里已经分配过行的条目（分区类型|条目名）：锚点字段（学校名称）没填上时，
  // 这一行对不上任何条目，下一轮会以为这条还没填、再点"添加"开新行——某外企 Moka
  // 的教育背景就这样多出了好几行。分配过一次就算用掉了
  let ATTEMPTED = new Set();
  // 同一个页面上每个字段只试一次——跨多次 fillForm（插件在页面加载时、3 秒后各跑一次）。
  // 某硬件公司 Moka 登录后选完一项会自动保存、整块重画，原来的元素没了，新元素又是空的，
  // 下一轮就再选一遍，看起来就是"性别一直在选、语言一直在填"。按"分区|行|字段"记住：
  // 填上过的不再填（之后变空多半是网站重画或用户自己清掉的），试过没成的不再反复点开找。
  // 用户在弹窗里手动点"填充"时清空重来（fillForm 的 fresh）。
  let PAGE = { href: null, done: new Set(), gaveUp: new Set() };
  const pageMem = () => {
    if (PAGE.href !== location.href) PAGE = { href: location.href, done: new Set(), gaveUp: new Set() };
    return PAGE;
  };
  // 返回 true = 这个字段这一页已经处理过，跳过（没成的仍然列进漏填提示）
  const seen = (c, key, where) => {
    c.memKey = key;
    const mem = pageMem();
    if (mem.done.has(key)) return true;
    if (mem.gaveUp.has(key)) { if (!readValue(c)) MISSED.set(c.el, { c, label: (where ? where + "·" : "") + (c.label || "?") }); return true; }
    return false;
  };
  const miss = (c, where) => { if (c && c.el) { FAILED.add(c.el); if (c.memKey) pageMem().gaveUp.add(c.memKey); MISSED.set(c.el, { c, label: (where ? where + "·" : "") + (c.label || "?") }); } };
  const hit = (c) => { if (c && c.el) { if (c.memKey) pageMem().done.add(c.memKey); MISSED.delete(c.el); } };

  async function fillGroup(g, profile, overwrite, report) {
    let filled = 0;
    const { assign } = planRows(g, profile);
    for (let i = 0; i < g.rows.length; i++) {
      const row = g.rows[i];
      const a = assign[i];
      if (!a || !a.entry) continue;
      ATTEMPTED.add(entryKey(g, a.entry, g.schema.entries(profile, g.sec, "").indexOf(a.entry)));
      // 覆盖模式下"已有内容的行"也按对上的那条重新填；普通模式只补空字段
      const e = a.entry;
      for (const f of g.schema.fields) {
        const cs = row.get(f.key);
        if (!cs) continue;
        try {
          if (f.range) {
            const parts = cs.filter(c => c.field === f).sort((x, y) => x.part - y.part || domOrder(x.el, y.el));
            if (parts.length && parts.every(c => FAILED.has(c.el))) continue;
            if (!parts.length) continue;
            const rk = `${g.sec.text}|${i}|${f.key}`;
            if (parts.map((c, k) => seen(c, rk + "|" + k, g.sec.text)).some(Boolean) && !overwrite) continue;
            const n = await fillRange(parts, Object.assign({}, f.range(e), { hasOngoingBox: row.has("ongoing") }), overwrite);
            // "至今"的结束时间本来就该空着（勾了"至今"后结束框通常被禁用）
            const ongoingEnd = (c) => e.ongoing && e.ongoing !== "single" && row.has("ongoing") && c.part > 0;
            if (!n && f.range(e).start_year) parts.filter(c => !readValue(c) && !ongoingEnd(c)).forEach(c => miss(c, g.sec.text));
            else if (n) parts.forEach(hit);
            if (parts.partial) miss(parts[0], g.sec.text);
            filled += n;
            continue;
          }
          for (const [k, c] of cs.entries()) {
            if (FAILED.has(c.el) || (!overwrite && readValue(c))) continue;
            if (seen(c, `${g.sec.text}|${i}|${f.key}|${k}`, g.sec.text) && !overwrite) continue;
            if (f.check) { if (f.check(e) && await applyValue(c, true)) { filled++; hit(c); } continue; }
            if (f.date) { if (await fillDate(c, f.date(e))) { filled++; hit(c); } else if (f.date(e)[0]) miss(c, g.sec.text); continue; }
            const v = f.val(e, profile, row);
            if (await applyValue(c, v, { syn: f.syn ? f.syn(e) : null, search: f.search ? f.search(e) : null, judge: f.judge ? f.judge(e) : null })) { filled++; hit(c); }
            else if (v) miss(c, g.sec.text);
          }
        } catch (err) {
          console.error(`[校招投递助手] ${g.sec.text} 第${i + 1}行 ${f.key} 出错，跳过：`, err);
        }
      }
    }
    return filled;
  }

  async function fillLoose(ctrls, profile, overwrite) {
    const hasSurname = ctrls.some(c => /^(姓|姓氏|lastname|surname|familyname)$/i.test(c.label || ""));
    const fields = basicFields(profile, { hasSurname });
    let filled = 0;
    const ord = new Map();
    for (const [ci, c] of ctrls.entries()) {
      if (!c.label || c.kind === "checkbox" || c.part > 0 || FAILED.has(c.el)) continue;
      const lk = `${c.section ? c.section.text : ""}|${c.label}`;
      ord.set(lk, (ord.get(lk) || 0) + 1);
      if (!overwrite && readValue(c)) continue;
      const f = bestRule(fields, c);
      if (!f) continue;
      if (seen(c, lk + "|" + ord.get(lk)) && !overwrite) continue;
      try {
        if (f.date) {
          // 年、月分成两个下拉（某硬件公司 Moka"毕业时间"：placeholder"年""月"）：交给 fillRange 的同款逻辑，
          // 原来只填了年那一格
          const mon = ctrls[ci + 1];
          const pair = mon && mon.part === 1 && mon.label === c.label && c.kind === "picker" && mon.kind === "picker" &&
            /月/.test(mon.input && mon.input.getAttribute("placeholder") || "") && !/月/.test(c.input && c.input.getAttribute("placeholder") || "");
          if (c.kind === "text" || c.kind === "textarea") { if (f.text) { setTextValue(c.input, f.text); filled++; hit(c); } }
          else if (pair) {
            const n = await fillRange([c, mon], { start_year: f.date[0], start_month: f.date[1], ongoing: "single" }, overwrite);
            if (n) { filled += n; hit(c); } else if (f.date[0]) miss(c);
          }
          else if (await fillDate(c, f.date)) { filled++; hit(c); }
          else if (f.date[0]) miss(c);
          continue;
        }
        // 有字数上限且长版放不下时改用短版（alt），免得被网站截断或校验不过
        let val = f.val;
        const max = c.input && c.input.maxLength;
        if (f.alt && max > 0 && val && val.length > max) val = f.alt;
        if (!val) continue; // profile 里没有这项（或是 block 规则），不算失败
        if (await applyValue(c, val, { syn: f.syn ? f.syn() : null, search: f.search, judge: f.judge ? f.judge() : null })) { filled++; hit(c); }
        else miss(c);
      } catch (err) {
        console.error(`[校招投递助手] 字段"${c.label}"出错，跳过：`, err);
      }
    }
    return filled;
  }

  // 必填项：input required / aria-required，或标签旁边有 * 号（各家写法：
  // <span class="xx-asterisk">*</span>、label 带 required class、文字直接带 *）
  function isRequired(c) {
    const inp = c.input || (c.radios && c.radios[0]);
    if (inp && (inp.required || inp.getAttribute("aria-required") === "true")) return true;
    const cls = (el) => typeof el.className === "string" ? el.className : "";
    const REQ = /required|asterisk|is-must|\bmust\b/i;
    // 只在"只装着这一个字段"的小范围里找 * 号：往上找到整个分区，就会把别的字段的 *
    // 算到这个字段头上（非必填的"QQ号"被报成必填）
    const small = (sc) => sc && deepAll("input, textarea, select", sc).length <= 3;
    const scopes = [];
    const fi = closestDeep(c.el, FORM_ITEM_SEL);
    if (small(fi)) scopes.push(fi);
    if (c.labelEl) {
      scopes.push(c.labelEl);
      for (let a = c.labelEl.parentElement, k = 0; a && k < 2 && small(a); a = a.parentElement, k++) scopes.push(a);
    }
    for (const sc of scopes) {
      if (!sc) continue;
      if (REQ.test(cls(sc)) || /^\*|\*$/.test(norm(sc === fi ? "" : sc.innerText || ""))) return true;
      const label = fi && sc === fi ? sc.querySelector(FORM_LABEL_SEL + ", label") : sc;
      if (label && Array.from(label.querySelectorAll("*")).some(el => REQ.test(cls(el)) || el.textContent.trim() === "*")) return true;
    }
    return false;
  }

  // 填完以后再扫一遍：必填、还空着、又不在漏填清单里的框，一律报出来，并写明原因。
  // 踩过的坑（飞书起止时间）：控件没认出来 → 不匹配 → 跳过 → 不报漏填，用户看到
  // "填好了"，其实一整类字段是空的。
  function reportEmptyRequired(profile) {
    const model = buildModel(profile);
    const hasSurname = model.ctrls.some(c => /^(姓|姓氏|lastname|surname|familyname)$/i.test(c.label || ""));
    const basics = basicFields(profile, { hasSurname });
    for (const c of model.ctrls) {
      if (c.kind === "checkbox" || MISSED.has(c.el) || readValue(c) || !isRequired(c)) continue;
      // 灰掉的框不用填：某金融公司项目"结束时间"勾了"至今"后日期框被禁用，原来照样报"结束时间（资料里没有）"
      if ((c.input && c.input.disabled) || closestDeep(c.input || c.el, ".is-disabled, [aria-disabled=true], [disabled]")) continue;
      const g = c.section && model.groups.find(x => x.sec === c.section);
      const basic = !c.field && (!g || !g.schema) ? bestRule(basics, c) : null;
      let why = basic && basic.block ? "需你自己填" : (c.field || basic) ? "资料里没有" : "未识别";
      // 证书分区：资料里本来就没有证书（雅思在语言能力里），说清楚，别让人以为是没认出来
      if (why === "未识别" && c.section && /证书/.test(c.section.text) && !(profile.certificates || []).length) why = "资料里没有证书";
      const name = c.label || meaningfulPlaceholder(c) || "未命名字段";
      MISSED.set(c.el, { c, label: (c.section ? c.section.text + "·" : "") + name + "（" + why + "）" });
    }
  }

  // overwrite=true：已有内容的字段也用 profile 覆盖（弹窗里的开关，默认关）。
  // 跑最多三轮：点"添加"会多出空行；有些字段要先选了"奖项类型"才会出现
  // （某电商公司选"竞赛奖项"后才出"竞赛奖项名称"）——每轮重新扫描页面，已填的
  // 行按名称对上不会重复填。
  async function fillForm(profile, opts) {
    const overwrite = !!(opts && opts.overwrite);
    FULL = (opts && opts.full) || null;
    if (opts && opts.fresh) { const mem = pageMem(); mem.done.clear(); mem.gaveUp.clear(); }
    let total = 0;
    MISSED = new Map();
    FAILED = new WeakSet();
    ATTEMPTED = new Set();
    TRACE = []; api.trace = TRACE;
    const dead = new Set(); // 点了"添加"没多出行的分区，不再点
    const secKey = (sec) => sec.type + "@" + sec.text;
    const rowCount = (key) => {
      const g = buildModel(profile).groups.find(x => secKey(x.sec) === key);
      return g ? g.rows.length : 0;
    };
    for (let pass = 0; pass < 4; pass++) {
      const model = buildModel(profile);
      let filled = await fillLoose(model.loose, profile, overwrite && pass === 0);
      let added = false;
      for (const g of model.groups) {
        if (!g.schema) continue;
        filled += await fillGroup(g, profile, overwrite && pass === 0);
        const key = secKey(g.sec);
        let { missing } = planRows(g, profile);
        while (missing > 0 && !dead.has(key)) {
          const btn = findAddButton(g.sec);
          const n0 = rowCount(key);
          if (!btn) { dead.add(key); break; }
          fireClick(btn);
          await sleep(400);
          if (rowCount(key) <= n0) {
            // 某电商公司的"+ 添加"（antd-mobile 的 am-button）对模拟的 pointer/mouse 序列
            // 没反应，只认原生 click()——补一次，还不行才放弃这个分区
            (btn.closest("a, button") || btn).click();
            await sleep(400);
          }
          if (rowCount(key) <= n0) { dead.add(key); break; }
          added = true;
          missing--;
        }
      }
      total += filled;
      if (!added && filled === 0) break;
    }
    // 单项填写（弹窗里某一项旁边的"填"按钮）只管这一项，不去报整页其他空着的必填框
    if (!(opts && opts.scope)) reportEmptyRequired(profile);
    api.lastMissed = [...new Set([...MISSED.values()].filter(x => x.c.el.isConnected).map(x => x.label))];
    return total;
  }

  // 诊断：只输出"每个控件被认成了什么"，不含任何个人信息，方便适配新网站。
  function diagnose(profile) {
    const model = buildModel(profile);
    const hasSurname = model.ctrls.some(c => /^(姓|姓氏|lastname|surname|familyname)$/i.test(c.label || ""));
    const lines = [];
    for (const c of model.ctrls) {
      const g = c.section && model.groups.find(g => g.sec === c.section);
      let row = "";
      if (g && g.schema && c.field) {
        const idx = g.rows.findIndex(r => Array.from(r.values()).some(cs => cs.includes(c)));
        row = ` 行${idx + 1}`;
      }
      const basic = !c.field && (!g || !g.schema) ? bestRule(basicFields(profile, { hasSurname }), c) : null;
      lines.push(`[${c.section ? c.section.text + "/" + c.section.type : "无分区"}${row}] ${c.kind} 标签="${c.label}"${c.labelSrc ? "‹" + c.labelSrc + "›" : ""}${c.part ? " part" + c.part : ""} → ${c.field ? c.field.key : basic ? "基本:" + basic.re.source.slice(0, 20) : "未匹配"}${readValue(c) ? "（已有值）" : ""}`);
    }
    return lines.join("\n");
  }

  function looksLikeForm() {
    return discoverControls().filter(c => c.kind !== "checkbox").length >= 4;
  }

  // 改了引擎就同时改这里和 manifest.json 的 version（测试页会检查两者一致）。
  // 提示和弹窗里显示它，一眼看出页面里跑的是不是旧版。
  const ENGINE_VERSION = "1.1.0";
  const api = { fillForm, looksLikeForm, diagnose, lastMissed: [], version: ENGINE_VERSION,
    // 只给 tests/ 回归测试调试用（页面脚本访问不到插件隔离环境里的这个对象）
    _t: { buildModel, fillDate, fillRange, readValue, pickInGenericPanel, typeIntoDatePopup, applyValue, isRequired } };
  window.AYA = api;
})();
