// 回归用例：每个用例 = 一段仿真表单 + 期望结果。
// data-t 是测试自己用来找字段的记号，引擎不看它。
// 期望写法：
//   { t: "key", eq: "值" }            字段值完全相等（"" 表示必须留空）
//   { t: "key", starts: "前缀" } / { t: "key", has: "子串" } / { t: "key", lacks: "子串" }
//   { diag: '标签="X"', has: "/award" } 诊断里这一行要包含某段文字（分区/匹配结果）
//   { diag: "X", none: true }          诊断里不能出现含 X 的行
//   { missed: "子串" } / { notMissed: "子串" }  漏填提示里有 / 没有某项
(() => {
  const M = () => window.MOCK;
  // 通用小积木
  // 资料里的年月写成 "YYYY-MM"（示例资料换了也不用改测试）
  const ym = (e, k) => `${e[k + "_year"]}-${String(e[k + "_month"]).padStart(2, "0")}`;
  const sec = (title, body, style = "") => `<section><h3 style="${style}">${title}</h3>${body}</section>`;
  const star = '<span class="req-asterisk">*</span>';

  // ── 飞书 atsx（antd 改了前缀）──
  const atsxItem = (t, label, control, { desc = "", req = true } = {}) => `
    <div class="atsx-row atsx-form-item" data-t="${t}">
      <div class="atsx-col atsx-form-item-label"><label class="${req ? "atsx-form-item-required" : ""}"><div class="customResumeForm-fieldName">${label}</div><div class="customResumeForm-fieldName-desc"></div></label>${desc ? `<div>${desc}</div>` : ""}</div>
      <div class="atsx-col atsx-form-item-control-wrapper"><div class="atsx-form-item-control"><span class="atsx-form-item-children">${control}</span></div></div>
    </div>`;
  const period = `<div class="atsx-date-picker atsx-date-picker-period-month">
      <div class="atsx-date-picker-period-month-label"><span>YYYY</span><span>-</span><span>MM</span></div>
      <div class="atsx-date-picker-period-line" style="display:inline-block;width:20px"></div>
      <div class="atsx-date-picker-period-month-label"><span>YYYY</span><span>-</span><span>MM</span></div>
      <input class="atsx-date-picker-period-hidden-input" style="width:1px;height:1px;opacity:0;border:0;padding:0">
    </div>`;

  // ── 飞书 ud-formily ──
  const udItem = (t, label, control, { desc = "" } = {}) => `
    <div class="ud-formily-item ud-formily-item-layout-vertical" data-t="${t}">
      <div class="ud-formily-item-label"><div class="ud-formily-item-label-content"><span><label>${label}</label><span class="ud-formily-item-asterisk">*</span></span></div></div>
      ${desc ? `<div class="ud-formily-item-label-desc">${desc}</div>` : ""}
      <div class="ud-formily-item-control"><div class="ud-formily-item-control-content"><div class="ud-formily-item-control-content-component">${control}</div></div></div>
    </div>`;
  const udInput = `<div class="ud__input"><label class="ud__input-input-wrap"><input class="ud__native-input"></label></div>`;
  const udMonth = `<div class="ud__picker"><div class="ud__picker-inputWrapper"><input class="ud__picker-input ud__native-input mock-month" placeholder="YYYY-MM"></div></div>`;
  const udRange = (now) => `<div class="throne-biz-date-range-picker-wrapper mock-range${now ? " mock-now" : ""}">
      <div class="throne-biz-date-range-picker-input"><div class="ud__input"><label class="ud__input-input-wrap"><div class="ud__input-input__placeholder__wrapper"><input class="ud__native-input"></div></label></div></div>
      <div class="throne-biz-date-range-picker-rangeInput-seperator"><div class="throne-biz-date-range-picker-seperator"></div></div>
      <div class="throne-biz-date-range-picker-input"><div class="ud__input"><label class="ud__input-input-wrap"><div class="ud__input-input__placeholder__wrapper"><input class="ud__native-input"></div></label></div></div>
    </div>`;
  const udSel = (opts) => `<div class="ud__select mock-udselect" data-opts="${opts}"><div class="ud__select__selector ud__select__selector-readOnly"><div class="ud__select__selector__content"><span class="mock-value"></span><div class="ud__select__selector__placeholder"></div><div class="ud__select__selector__search"><input class="ud__select__selector__search__input ud__native-input" role="combobox" autocomplete="off" type="search" readonly value=""></div></div><div class="ud__select__selector__arrow"><svg width="10" height="10"><path d="M1 3 L5 7 L9 3" stroke="#666" fill="none"/></svg></div></div></div>`;

  // ── 某制造企业 phoenix：label 和框左右并排 ──
  const pxItem = (t, label, control) => `
    <div class="form-item" data-t="${t}" style="display:flex">
      <label class="form-item__text" style="width:120px;font-size:14px">${label}</label>
      <div class="form-item__content">${control}</div>
    </div>`;

  // ── 某科技公司 aui ──
  const auiItem = (t, label, control) => `
    <div class="aui-form-item" data-t="${t}"><label class="aui-form-item__label">${label}</label>
      <div class="aui-form-item__content"><div><div><div><div><div><div>${control}</div></div></div></div></div></div></div>
    </div>`;

  // ── Moka（某外企）──
  const mkField = (t, label, control) => `
    <div class="apply-field select_info" data-t="${t}">
      <div class="title"><span><span>${label}</span></span><span class="required-asterisk"></span></div>
      <div class="ctrl">${control}</div>
      <div class="error-msg">必填项未填写</div>
    </div>`;
  const mkSelect = (opts) => `<div class="sd-Dropdown-container mock-mksel" data-opts="${opts}"><label class="sd-Input-container sd-Select-container select_info no-adaptive-tooltip"><span class="sd-Input-display-value"><span></span></span><input type="text" class="sd-Input-input" autocomplete="nope"><span class="sd-Select-addon"><svg width="10" height="10"><path d="M1 3 L5 7 L9 3" stroke="#666" fill="none"/></svg></span></label></div>`;

  // Moka 起止时间：年/月/年/月 四个下拉 + 至今（某游戏公司 2026-10-29）
  const mkYM = (t, ph, opts) => `<div class="item-ym" data-t="${t}" style="display:inline-block;width:90px"><div class="sd-Dropdown-container mock-mkym" data-opts="${opts}"><label class="sd-Input-container sd-Select-container"><span class="sd-Input-display-value"><span></span></span><input type="text" class="sd-Input-input" placeholder="${ph}"></label></div></div>`;
  const YEARS = Array.from({ length: 201 }, (_, i) => 2126 - i).join("|"), MONTHS = Array.from({ length: 12 }, (_, i) => i + 1).join("|");
  const mkMonthRange = (k) => `<div class="month-range-select">${mkYM(k + "y1", "年", YEARS)}${mkYM(k + "m1", "月", MONTHS)}<span>-</span>${mkYM(k + "y2", "年", YEARS)}${mkYM(k + "m2", "月", MONTHS)}</div><label class="sd-Checkbox-container"><input type="checkbox" class="sd-Checkbox-input"><span>至今</span></label>`;

  // ── 某金融公司（Element UI el-form）──
  const elItem = (t, label, control, req = true) => `<div class="el-form-item${req ? " is-required" : ""} el-form-item--small" data-t="${t}"><label class="el-form-item__label">${label}</label><div class="el-form-item__content">${control}</div></div>`;
  const elInput = (extra = "") => `<div class="el-input el-input--small${extra ? " is-disabled" : ""}"><input type="text" class="el-input__inner" ${extra}></div>`;

  const COL24 = (...items) => `<div class="atsx-row-flex atsx-row-flex-space-between">${items.map(i => `<div class="atsx-col atsx-col-24">${i}</div>`).join("")}</div>`;
  const ATSX_SEL = '<div class="atsx-select-lg atsx-select-theme-default atsx-select atsx-select-enabled"><div class="atsx-select-selection"><div class="atsx-select-selection__rendered"><div class="atsx-select-search atsx-select-search--inline" style="display:none"><div class="atsx-select-search__field__wrap"><input class="atsx-select-search__field"><span class="atsx-select-search__field__mirror"></span></div></div></div><span class="atsx-select-arrow" style="display:inline-block;width:10px;height:10px"></span></div></div>';

  // 读字段当前显示的值
  function valueOf(item) {
    const pp = item.querySelector(".atsx-date-picker");
    if (pp && pp.readSlots) return pp.readSlots();
    const mk = item.querySelector(".sd-Input-display-value");
    if (mk) return mk.textContent.trim();
    const sel = item.querySelector(".mock-value");
    if (sel) return sel.textContent.trim();
    const sh = item.querySelector("mock-field");
    if (sh) return sh.shadowRoot.querySelector("input").value;
    const ins = [...item.querySelectorAll("input, textarea")].filter(i => i.type !== "hidden" && !i.classList.contains("phoenix-search"));
    return ins.map(i => i.value).join("|");
  }

  const CASES = [
    {
      name: "基础标签：最长匹配、block 规则、无 role 自动补全（某德企/某电商公司历史坑）",
      html: sec("个人信息", [
        ["xing", "姓氏"], ["ming", "名字"], ["major", "最高学历专业"], ["skill", "技能特长"], ["hobby", "兴趣爱好"],
        ["mom", "母亲手机号码"], ["phone", "手机号码"], ["why", "告诉公司您有兴趣在那里工作", "textarea"], ["city", "所在城市"], ["mail", "邮箱"],
      ].map(([t, l, tag]) => `<div data-t="${t}"><label for="b_${t}">${l}</label>${tag === "textarea" ? `<textarea id="b_${t}"></textarea>` : `<input id="b_${t}">`}</div>`).join("")),
      setup: (root) => M().autocomplete(root.querySelector("#b_city"), ["武汉市, 湖北", "武汉东湖新区"]),
      expect: (P) => [
        { t: "xing", eq: P.last_name }, { t: "ming", eq: P.first_name }, { t: "major", eq: P.education.highest_major },
        { t: "skill", eq: P.skills_short }, { t: "hobby", eq: P.hobbies }, { t: "mom", eq: "" }, { t: "phone", eq: P.phone },
        { t: "why", eq: "" }, { t: "city", eq: "武汉市, 湖北" }, { t: "mail", eq: P.email },
      ],
    },
    {
      name: "飞书 atsx：隐藏 input + 两个 YYYY-MM 格子、滚动年/月列、至今（2026-10-23）",
      html: sec("教育经历",
        atsxItem("school", "学校名称", '<input class="atsx-input">') +
        atsxItem("edu_period", "起止时间", period, { desc: "无准确的毕业时间可填写预计毕业时间" })) +
        sec("项目经历",
          atsxItem("pname", "项目名称", '<input class="atsx-input">') +
          atsxItem("p_period", "起止时间", period)),
      setup: (root) => root.querySelectorAll(".atsx-date-picker").forEach(M().periodPicker),
      expect: (P) => [
        { t: "school", eq: P.education_entries[0].school },
        { t: "edu_period", eq: `${ym(P.education_entries[0], "start")} ~ ${ym(P.education_entries[0], "end")}` },
        { t: "pname", eq: P.project_entries[0].name },
        { t: "p_period", eq: `${ym(P.project_entries[0], "start")} ~ 至今` },
        { diag: "起止时间", lacks: "YYYY" },
        { notMissed: "起止时间" },
      ],
    },
    {
      name: "飞书 ud-formily：月份面板（无名翻年按钮、失焦即关）、ud__select、说明行（2026-10-23）",
      html: sec("基本信息",
        udItem("name", "姓名", udInput) +
        udItem("sex", "性别", udSel("男|女")) +
        udItem("birth", "出生日期", udMonth)) +
        sec("教育经历",
          udItem("school", "学校名称", udInput) +
          udItem("e_period", "起止时间", udRange(false), { desc: "无准确的毕业时间可填写预计毕业时间" }) +
          udItem("etype", "学历类型", udSel("海外及港澳台|统招全日制|统招非全日制|自考|其他"))) +
        sec("实习经历",
          udItem("company", "公司名称", udInput) +
          udItem("i_period", "起止时间", udRange(true))) +
        sec("项目经历",
          udItem("pname", "项目名称", udInput) +
          udItem("p_period", "起止时间", udRange(true))) +
        sec("语言能力",
          udItem("lang", "语言", udSel("英语|日语|韩语")) +
          udItem("level", "精通程度", udSel("入门|日常会话|商务会话|无障碍沟通|母语"))),
      setup: (root) => {
        root.querySelectorAll(".mock-udselect").forEach(b => M().udSelect(b, b.dataset.opts.split("|")));
        root.querySelectorAll(".mock-month").forEach(i => M().monthInput(i));
        root.querySelectorAll(".mock-range").forEach(w => M().monthRange(w, { now: w.classList.contains("mock-now") }));
      },
      expect: (P) => [
        { t: "name", eq: P.name }, { t: "sex", eq: P.gender }, { t: "birth", eq: "2001-10" },
        { t: "school", eq: P.education_entries[0].school },
        { t: "e_period", eq: `${ym(P.education_entries[0], "start")}|${ym(P.education_entries[0], "end")}` },
        { t: "etype", eq: "海外及港澳台" },
        { t: "company", eq: P.internship_entries[0].company }, { t: "i_period", eq: `${ym(P.internship_entries[0], "start")}|${ym(P.internship_entries[0], "end")}` },
        { t: "pname", eq: P.project_entries[0].name }, { t: "p_period", eq: `${ym(P.project_entries[0], "start")}|至今` },
        { t: "lang", eq: "英语" }, { t: "level", eq: "无障碍沟通" },
        { diag: "无准确", none: true }, // 说明行不能当标签：诊断里不该出现这段字
        { notMissed: "性别" }, { notMissed: "起止时间" },
      ],
    },
    {
      name: "某制造企业 phoenix：并排标签、区号按钮、勾选+确定面板、搜索、成果框、获奖情况标题（2026-10-22）",
      html: sec("个人信息",
        pxItem("phone", "手机号", '<button type="button" class="area-code">中国大陆</button><input class="phoenix-input">') +
        pxItem("nation", "民族", '<div class="phoenix-select"><input class="mock-tick" readonly placeholder="请选择"></div>') +
        pxItem("native", "籍贯", '<div class="phoenix-select"><input class="mock-tick mock-search" readonly placeholder="请选择"></div>')) +
        sec("获奖情况",
          pxItem("award", "奖项名称", '<input class="phoenix-input">'), "font-size:20px") +
        sec("项目经历",
          pxItem("pname", "项目名称", '<input class="phoenix-input">') +
          pxItem("pdesc", "项目描述", '<textarea></textarea>') +
          pxItem("presult", "项目成果", '<textarea></textarea>')) +
        sec("在校实践",
          pxItem("org", "组织名称", '<input class="phoenix-input">')),
      setup: (root) => {
        M().tickPanel(root.querySelector('[data-t="nation"] input'), ["回族", "汉族", "满族", "蒙古族"]);
        M().tickPanel(root.querySelector('[data-t="native"] input'), ["北京市", "武汉新区", "武汉市", "襄阳市", "杭州市"], { search: true });
      },
      expect: (P) => [
        { t: "phone", has: P.phone },
        { t: "nation", eq: P.ethnicity },
        { t: "native", eq: "武汉市" },
        { t: "pname", eq: P.project_entries[0].name },
        { t: "presult", starts: "【项目成果】" },
        { t: "pdesc", lacks: "【项目成果】" },
        { diag: '标签="手机号"', has: "基本:" },
        { diag: '标签="奖项名称"', has: "/award" },
        { diag: '标签="组织名称"', has: "/campus" },
      ],
    },
    {
      name: "某科技公司 aui：每条经历同名小标题、添加按钮不当标题、深层表单项、TOP 排名（2026-10-22）",
      html: sec("教育经历",
        auiItem("school", "学校名称", '<input class="aui-input__inner">') +
        auiItem("rank", "成绩排名", '<div class="aui-select"><input class="aui-input__inner mock-aui" readonly placeholder="请选择"></div>')) +
        sec("项目经历", auiItem("p1", "项目名称", '<input class="aui-input__inner">')) +
        sec("项目经历", auiItem("p2", "项目名称", '<input class="aui-input__inner">')) +
        '<button type="button" class="aui-button">添加项目经历</button>',
      setup: (root) => M().auiSelect(root.querySelector(".mock-aui"), ["TOP5%", "TOP10%", "TOP20%", "TOP30%", "其他"]),
      expect: (P) => [
        { t: "school", eq: P.education_entries[0].school },
        { t: "rank", eq: "TOP10%" },
        { t: "p1", eq: P.project_entries[0].name },
        { t: "p2", eq: P.project_entries[1].name },
      ],
    },
    {
      name: "杂项：只认 mousedown 的下拉（飞书早期）、Shadow DOM（某德企）",
      html: sec("基本信息",
        `<div data-t="name"><label for="m_n">姓名</label><input id="m_n"></div>` +
        `<div data-t="pol"><label for="m_p">政治面貌</label><input id="m_p" class="mock-md" readonly placeholder="请选择"></div>` +
        `<div data-t="mail"><mock-field label="邮箱"></mock-field></div>` +
        `<div data-t="x1"><label for="m_x">备注说明</label><input id="m_x"></div>`),
      setup: (root) => M().mousedownSelect(root.querySelector(".mock-md"), ["中共党员", "共青团员", "群众"]),
      expect: (P) => [
        { t: "name", eq: P.name }, { t: "pol", eq: P.political_status }, { t: "mail", eq: P.email },
      ],
    },
    {
      name: "统一排除：标签是普通文字、旁边是区号按钮（P4）",
      html: sec("基本信息",
        `<div data-t="ph" style="display:flex"><span>手机号码</span><button type="button" class="code-btn">+86</button><input></div>` +
        `<div data-t="nm" style="display:flex"><span>姓名</span><input></div>`),
      setup: () => {},
      expect: (P) => [
        { t: "ph", eq: P.phone }, { t: "nm", eq: P.name },
        { diag: "+86", none: true },
      ],
    },
    {
      name: "Moka 某外企：出生日期≠出生地、按天日历、选中值在旁边、报错文字不是值（2026-10-25）",
      html: sec("个人信息",
        mkField("sex", "性别", mkSelect("男|女")) +
        mkField("birth", "出生日期", '<input class="mock-mkdate" readonly placeholder="日期（年月日）">') +
        mkField("bplace", "出生地", mkSelect("北京|上海|武汉"))),
      setup: (root) => {
        root.querySelectorAll(".mock-mksel").forEach(b => M().mokaSelect(b.closest(".apply-field"), b.dataset.opts.split("|")));
        M().mokaDate(root.querySelector(".mock-mkdate"));
      },
      expect: (P) => [
        { t: "sex", eq: P.gender },
        { t: "birth", eq: "2001-10-15" },
        { t: "bplace", eq: "" },               // 资料里没有出生地：不填，更不能填成日期
        { notMissed: "性别" },                  // 选上了就不能报漏填（读不到才会反复重开）
        { fn: () => document.querySelector('[data-t="sex"]').__opens <= 2, what: "性别下拉最多打开 2 次", got: () => String(document.querySelector('[data-t="sex"]').__opens) },
        { missed: "出生地（资料里没有）" },
      ],
    },
    {
      name: "某硬件公司 Moka：选完自动保存、字段被重画成空的也不反复选；生日月份写成'十月'（2026-10-25）",
      runs: 2,
      html: sec("个人信息",
        mkField("sex", "性别", mkSelect("男|女")) +
        mkField("birth", "出生日期 (年龄)", '<input class="mock-mkmonth" readonly placeholder="出生日期 (年龄)">')) +
        sec("语言能力", mkField("lvl", "掌握程度", mkSelect("一般|良好|熟练|精通"))),
      setup: (root) => {
        window.__mkOpens = {};
        root.querySelectorAll(".mock-mksel").forEach(b => M().mokaSelect(b.closest(".apply-field"), b.dataset.opts.split("|"), { redraw: true }));
        M().mokaMonth(root.querySelector(".mock-mkmonth"));
      },
      expect: (P) => [
        { t: "birth", starts: "2001-10" },
        { fn: () => (window.__mkOpens.sex || 0) <= 1, what: "性别下拉跑两次一共只打开 1 次", got: () => String(window.__mkOpens.sex) },
        { fn: () => (window.__mkOpens.lvl || 0) <= 1, what: "语言掌握程度跑两次一共只打开 1 次", got: () => String(window.__mkOpens.lvl) },
        { notMissed: "出生日期" },
      ],
    },
    {
      name: "选不上的学校 + 会真加行的添加按钮：行数不能超过资料条数（2026-10-25）",
      html: sec("教育背景", '<div class="rows"></div><button type="button" class="add-btn">添加教育经历</button>'),
      setup: (root) => {
        const rows = root.querySelector(".rows");
        const addRow = () => {
          const d = document.createElement("div");
          d.className = "edu-row";
          d.innerHTML = mkField("school", "学校名称", mkSelect("北京大学|清华大学")) +
            `<div data-t="major"><label>专业</label><input class="major"></div>`;
          rows.appendChild(d);
          M().mokaSelect(d.querySelector(".apply-field"), ["北京大学", "清华大学"]);
        };
        addRow();
        root.querySelector(".add-btn").addEventListener("click", addRow);
        window.__eduRows = () => rows.children.length;
      },
      expect: (P) => [
        { fn: () => window.__eduRows() <= P.education_entries.length, what: "教育行数 ≤ 资料条数", got: () => String(window.__eduRows()) },
        { missed: "学校名称" },
        { fn: () => [...document.querySelectorAll('[data-t="school"]')].reduce((n, f) => n + f.__opens, 0) <= 8, what: "选不上的学校下拉总共最多打开 8 次", got: () => String([...document.querySelectorAll('[data-t="school"]')].reduce((n, f) => n + f.__opens, 0)) },
      ],
    },
    {
      name: "选项对不上就不选：专业不能选成'统计学与机器学习'（2026-10-25）",
      html: sec("教育背景",
        mkField("school", "学校名称", mkSelect("北京大学|爱丁堡大学(University of Edinburgh)|爱丁堡艺术学院")) +
        mkField("major", "专业", mkSelect("统计学与机器学习|经济统计学|数学"))),
      setup: (root) => root.querySelectorAll(".mock-mksel").forEach(b => M().mokaSelect(b.closest(".apply-field"), b.dataset.opts.split("|"))),
      expect: (P) => [
        { t: "school", eq: "爱丁堡大学(University of Edinburgh)" },
        { t: "major", eq: "" },
        { missed: "专业" },
      ],
    },
    {
      name: "学历类选项按事实判断：某外企学位类别、学习形式（2026-10-25）",
      html: sec("教育背景", [1, 2].map(i =>
        `<div data-t="s${i}"><label>学校名称</label><input class="school-in"></div>` +
        mkField(`d${i}`, "学历", mkSelect("本科|硕士|博士|高中|大专|中专|初中及以下|MBA|其他")) +
        mkField(`c${i}`, "您的学位属于以下哪一类？", mkSelect("全日制硕士|非全日制硕士|全日制本科-全国统一招生考试|全日制本科-非全国统一招生考试|非全日制本科|Full-time Bachelor Degree – JUPAS Applicants|Full-time Bachelor Degree – Non JUPAS Applicants|不适用")) +
        mkField(`m${i}`, "学习形式", mkSelect("全国普通高等院校全日制|全国普通高等院校非全日制|成人教育|自学考试|海外留学"))).join("<hr>")),
      setup: (root) => root.querySelectorAll(".mock-mksel").forEach(b => M().mokaSelect(b.closest(".apply-field"), b.dataset.opts.split("|"))),
      expect: (P) => [
        { t: "s1", eq: P.education_entries[0].school }, { t: "s2", eq: P.education_entries[1].school },
        { t: "d1", eq: "硕士" }, { t: "d2", eq: "本科" },
        { t: "c1", eq: "全日制硕士" }, { t: "c2", eq: "全日制本科-全国统一招生考试" },
        { t: "m1", eq: "海外留学" }, { t: "m2", eq: "全国普通高等院校全日制" },
        // 选上了就要读得到：读不到会一遍遍重开（Moka 框的 class 带 tooltip，曾被当成提示文字整框排除）
        { fn: () => [...document.querySelectorAll(".apply-field")].every(f => f.__opens <= 2), what: "每个下拉最多打开 2 次",
          got: () => [...document.querySelectorAll(".apply-field")].map(f => f.dataset.t + ":" + f.__opens).join(" ") },
      ],
    },
    {
      name: "学校库只有英文名 / 中英并列：中英文都搜、按完整名字认、跑两次不重复加行（2026-10-25 某外企）",
      runs: 2,
      html: sec("教育背景", '<div class="rows2"></div><button type="button" class="add2">添加教育经历</button>'),
      setup: (root) => {
        const OPTS = ["Edinburgh College of Art", "Edinburgh Napier University", "University of Edinburgh",
          "Chutian College of Huazhong Agricultural University 华中农业大学楚天学院", "Huazhong Agricultural University 华中农业大学"];
        const box = root.querySelector(".rows2");
        let n = 0;
        const add = () => {
          n++;
          const d = document.createElement("div");
          d.innerHTML = mkField(`s${n}`, "学校名称", mkSelect("x").replace('data-opts="x"', 'data-opts=""')) + `<div data-t="mj${n}"><label>专业</label><input></div>`;
          box.appendChild(d);
          M().mokaSelect(d.querySelector(".apply-field"), OPTS, { search: true });
        };
        add();
        root.querySelector(".add2").addEventListener("click", add);
        window.__rows2 = () => box.children.length;
      },
      expect: (P) => [
        { t: "s1", eq: "University of Edinburgh" },
        { t: "s2", eq: "Huazhong Agricultural University 华中农业大学" },
        { t: "mj1", eq: P.education_entries[0].major }, { t: "mj2", eq: P.education_entries[1].major },
        // 按英文名选上后，下一轮要认得出这一行就是爱丁堡大学，不能再加行
        { fn: () => window.__rows2() === 2, what: "教育行数正好 2 行", got: () => String(window.__rows2()) },
      ],
    },
    {
      name: "奖项级别按档位：省市级=区域级（比国家级低一档），校级=院校级（2026-10-25 某外企）",
      html: sec("获奖经历", [1, 2, 3, 4].map(i =>
        `<div data-t="n${i}"><label>奖项名称</label><input></div>` +
        mkField(`l${i}`, "奖项级别", mkSelect("国家级|区域级|院校级|部门级"))).join("<hr>")),
      setup: (root) => root.querySelectorAll(".mock-mksel").forEach(b => M().mokaSelect(b.closest(".apply-field"), b.dataset.opts.split("|"))),
      expect: (P) => {
        const want = { "国家级": "国家级", "省市级": "区域级", "校级": "院校级" };
        return [1, 2, 3, 4].flatMap(i => {
          const h = P.honors[i - 1];
          return [{ t: `n${i}`, has: h.name.slice(0, 6) }, { t: `l${i}`, eq: want[h.level] }];
        });
      },
    },
    {
      name: "必填项提示：没认出来 / 资料里没有 / 故意不填 都要报出来（P1）",
      html: sec("基本信息",
        atsxItem("name", "姓名", "<input>") +
        atsxItem("ecity", "期望城市", "<input>") +
        atsxItem("emerg", "紧急联系人电话", "<input>") +
        atsxItem("unk", "XQ编号", "<input>") +
        atsxItem("opt", "QQ号", "<input>", { req: false })),
      setup: () => {},
      expect: (P) => [
        { t: "name", eq: P.name },
        { missed: "期望城市（资料里没有）" },
        { missed: "紧急联系人电话（需你自己填）" },
        { missed: "XQ编号（未识别）" },
        { notMissed: "QQ号" },  // 非必填不报
        { notMissed: "姓名" },
      ],
    },
    {
      name: "单项填写：只填点的那个项目，已填的项目行和基本信息都不动、不报整页漏填（2026-10-28）",
      html: sec("基本信息", atsxItem("name", "姓名", "<input>")) +
        sec("项目经历", auiItem("p1", "项目名称", '<input class="aui-input__inner">')) +
        sec("项目经历", auiItem("p2", "项目名称", '<input class="aui-input__inner">')),
      setup: (root, P) => { root.querySelector('[data-t="p1"] input').value = P.project_entries[0].name; },
      view: (P) => window.AYA_VIEW.only(P, { type: "project", name: P.project_entries[2].name }),
      scope: "project",
      expect: (P) => [
        { t: "name", eq: "" },
        { t: "p1", eq: P.project_entries[0].name },
        { t: "p2", eq: P.project_entries[2].name },
        { notMissed: "姓名" },
      ],
    },
    {
      name: "投递方向：选产品经理只填 pm 项目，并按 pm 顺序（2026-10-28）",
      html: sec("项目经历", auiItem("p1", "项目名称", '<input class="aui-input__inner">')) +
        sec("项目经历", auiItem("p2", "项目名称", '<input class="aui-input__inner">')) +
        sec("项目经历", auiItem("p3", "项目名称", '<input class="aui-input__inner">')),
      setup: () => {},
      view: (P) => {
        const Q = JSON.parse(JSON.stringify(P));
        Q.project_entries.forEach((e, i) => (e.tracks = { data: i + 1 }));
        Q.project_entries[4].tracks = { data: 5, pm: 1 };
        Q.project_entries[0].tracks = { data: 1, pm: 2 };
        return window.AYA_VIEW.byTrack(Q, "pm");
      },
      expect: (P) => [
        { t: "p1", eq: P.project_entries[4].name },
        { t: "p2", eq: P.project_entries[0].name },
        { t: "p3", eq: "" },
      ],
    },
    {
      name: "Moka 年/月/年/月：开始已选、结束空着，不能把整串日期写进年份框，结束要补上（2026-10-29 某游戏公司）",
      html: sec("项目经验",
        mkField("rng", "起止时间", mkMonthRange("a")) +
        mkField("pn", "项目名称", '<label class="sd-Input-container"><input class="sd-Input-input" placeholder="项目名称"></label>')),
      setup: (root, P) => {
        root.querySelectorAll(".mock-mkym").forEach(b => M().mokaSelect(b.closest(".item-ym"), b.dataset.opts.split("|"), { byPoint: true }));
        const E = P.project_entries.find(e => /统计建模大赛/.test(e.name));
        root.querySelector('[data-t="pn"] input').value = E.name;
        // 页面上开始年月已有值（上次自动保存的）：显示值有了，placeholder 没了
        for (const [t, v] of [["ay1", E.start_year], ["am1", E.start_month]]) {
          const f = root.querySelector(`[data-t="${t}"]`);
          f.querySelector(".sd-Input-display-value span").textContent = String(Number(v));
          f.querySelector("input").removeAttribute("placeholder");
        }
      },
      expect: (P) => {
        const E = P.project_entries.find(e => /统计建模大赛/.test(e.name));
        return [
          { t: "ay1", eq: String(Number(E.start_year)) }, { t: "am1", eq: String(Number(E.start_month)) },
          { t: "ay2", eq: String(Number(E.end_year)) }, { t: "am2", eq: String(Number(E.end_month)) },
        ];
      },
    },
    {
      name: "Moka 年份长列表（2126→1926）按点击位置认选项：要滚到目标再点，不能都选成 2126（2026-10-29 某游戏公司）",
      html: sec("项目经验",
        mkField("rng", "起止时间", mkMonthRange("b")) +
        mkField("pn", "项目名称", '<label class="sd-Input-container"><input class="sd-Input-input" placeholder="项目名称"></label>')),
      setup: (root, P) => {
        root.querySelectorAll(".mock-mkym").forEach(b => M().mokaSelect(b.closest(".item-ym"), b.dataset.opts.split("|"), { byPoint: true }));
        root.querySelector('[data-t="pn"] input').value = P.project_entries.find(e => /邀请赛/.test(e.name)).name;
      },
      expect: (P) => {
        const E = P.project_entries.find(e => /邀请赛/.test(e.name));
        return [
          { t: "by1", eq: String(Number(E.start_year)) }, { t: "bm1", eq: String(Number(E.start_month)) },
          { t: "by2", eq: String(Number(E.end_year)) }, { t: "bm2", eq: String(Number(E.end_month)) },
        ];
      },
    },
    {
      name: "Moka 校园经历：结束时间在左、开始时间在右，两个按天日历各填各的（2026-10-29 某游戏公司）",
      html: sec("校园经历",
        mkField("ce", "结束时间", '<input class="mock-mkdate" readonly placeholder="日期（年月日）">') +
        mkField("cs", "开始时间", '<input class="mock-mkdate" readonly placeholder="日期（年月日）">') +
        mkField("cr", "职务", '<label class="sd-Input-container"><input class="sd-Input-input" placeholder="职务"></label>')),
      setup: (root) => root.querySelectorAll(".mock-mkdate").forEach(i => M().mokaDate(i)),
      expect: (P) => {
        const E = P.campus_entries[0], pad = (n) => String(n).padStart(2, "0");
        const last = new Date(Number(E.end_year), Number(E.end_month), 0).getDate();
        return [
          { t: "cs", eq: `${E.start_year}-${pad(E.start_month)}-01` },
          { t: "ce", eq: `${E.end_year}-${pad(E.end_month)}-${pad(last)}` },
        ];
      },
    },
    {
      name: "某金融公司 el-form：奖励'授予单位'要填；结束时间勾了至今被禁用不报漏填；证书说清是资料里没有（2026-11-02）",
      html: sec("项目经历",
        elItem("pn", "项目名称", elInput()) +
        elItem("pe", "结束时间", elInput("disabled") + '<label class="el-checkbox is-checked"><input type="checkbox" class="el-checkbox__original" checked><span>至今</span></label>')) +
        sec("证书", elItem("cn", "证书名称", elInput())) +
        sec("奖励信息", elItem("an", "奖励名称", elInput()) + elItem("ai", "授予单位", elInput()) + elItem("aw", "证明人", elInput(), false)),
      setup: (root, P) => { root.querySelector('[data-t="pn"] input').value = P.project_entries[0].name; },
      expect: (P) => [
        { t: "an", starts: P.honors[0].name },
        { t: "ai", eq: P.honors[0].issuer },
        { t: "aw", eq: "" },
        { notMissed: "结束时间" },
        { missed: "证书名称（资料里没有证书）" },
      ],
    },
    {
      name: "飞书 atsx-select：下拉里的搜索小框不能当文本框，下一格不能拿到上一格的标签（2026-11-02 某消费品公司：籍贯→期望薪资、排名→研究方向）",
      // 真实结构：每格包在 atsx-col-24 里，同一个 atsx-row-flex 下并排；下拉里的搜索框 display:none
      html: sec("基本信息", COL24(atsxItem("np", "籍贯", ATSX_SEL) , atsxItem("sal", "期望薪资（月薪）", '<input class="atsx-input atsx-input-lg">'))) +
        sec("教育经历", COL24(atsxItem("sch", "学校名称", '<input class="atsx-input atsx-input-lg">'), atsxItem("rk", "成绩排名", ATSX_SEL),
          atsxItem("dir", "研究方向", '<input class="atsx-input atsx-input-lg">', { req: false }),
          atsxItem("dbl", "是否双学位/专业", '<input class="atsx-input atsx-input-lg">', { req: false }),
          atsxItem("dbn", "双学位/专业名称", '<input class="atsx-input atsx-input-lg">', { req: false }))),
      setup: () => {},
      expect: () => [
        { t: "sal", eq: "" },
        { t: "dir", eq: "" },
        { t: "dbl", eq: "否" },
        { t: "dbn", eq: "" },
        { diag: 'text 标签="籍贯"', none: true },
        { diag: 'text 标签="成绩排名"', none: true },
      ],
    },
    // 某游戏公司 Moka 项目经验只有 起止时间 / 至今 / 项目描述，没有名称框（2026-11-06）。
    // 原来没有名称框的行一律当空行：单项填写第二个项目时又填进第一行——不开覆盖报"无可填写"，开了覆盖就盖掉上一条
    ...[false, true].map(ow => ({
      name: `单项填写·没有名称框的项目行：按描述认出第一行是别的项目，新项目点添加另开一行${ow ? "（开覆盖）" : ""}（2026-11-06 某游戏公司）`,
      html: sec("项目经验", '<div class="prows"></div><button type="button" class="padd">添加项目经验</button>'),
      setup: (root, P) => {
        const rows = root.querySelector(".prows");
        const addRow = () => {
          const n = rows.children.length + 1;
          const d = document.createElement("div");
          d.innerHTML = mkField("pd" + n, "项目描述", '<textarea class="sd-TextArea"></textarea>');
          rows.appendChild(d);
        };
        addRow();
        const E = P.project_entries[0];
        rows.querySelector("textarea").value = [E.core_result, E.task_action].join("\n\n");
        root.querySelector(".padd").addEventListener("click", addRow);
        window.__projRows = () => rows.children.length;
      },
      view: (P) => window.AYA_VIEW.only(P, { type: "project", name: P.project_entries[2].name }),
      scope: "project",
      overwrite: ow,
      expect: (P) => [
        { t: "pd1", starts: P.project_entries[0].core_result.slice(0, 20) },
        { t: "pd2", starts: P.project_entries[2].core_result.slice(0, 20) },
        { fn: () => window.__projRows() === 2, what: "项目行数 = 2", got: () => String(window.__projRows()) },
      ],
    })),
    // 单项填写时引擎只拿到要填的那一条："华中地区高校数学建模邀请赛"那一行和要填的
    // "华中农业大学数学建模竞赛"名字很像，被认成同一条（2026-11-06）
    ...[false, true].map(ow => ({
      name: `单项填写·名字相近的奖项：已填的地区赛不能被当成校赛${ow ? "（开覆盖）" : ""}（2026-11-06）`,
      html: sec("获奖经历", '<div class="arows"></div><button type="button" class="aadd">添加获奖经历</button>'),
      setup: (root, P) => {
        const rows = root.querySelector(".arows");
        const addRow = () => {
          const n = rows.children.length + 1;
          const d = document.createElement("div");
          d.innerHTML = mkField("an" + n, "奖项名称", '<input class="sd-Input-input">');
          rows.appendChild(d);
        };
        addRow();
        rows.querySelector("input").value = P.honors[1].name;
        root.querySelector(".aadd").addEventListener("click", addRow);
        window.__awRows = () => rows.children.length;
      },
      view: (P) => window.AYA_VIEW.only(P, { type: "award", name: P.honors[2].name }),
      scope: "award",
      overwrite: ow,
      expect: (P) => [
        { t: "an1", eq: P.honors[1].name },
        { t: "an2", starts: P.honors[2].name },
        { fn: () => window.__awRows() === 2, what: "奖项行数 = 2", got: () => String(window.__awRows()) },
      ],
    })),
    // 实习可以有多段（internship_entries）：点添加另开一行，按顺序各填一段
    {
      name: "多段实习：只有一行时点添加，两段实习各填一行，不重复",
      html: sec("实习经历", '<div class="irows"></div><button type="button" class="iadd">添加实习经历</button>'),
      setup: (root) => {
        const rows = root.querySelector(".irows");
        const addRow = () => {
          const n = rows.children.length + 1;
          const d = document.createElement("div");
          d.innerHTML = mkField("ic" + n, "公司名称", '<input class="sd-Input-input">') +
            mkField("it" + n, "职位名称", '<input class="sd-Input-input">') +
            mkField("id" + n, "工作内容", '<textarea class="sd-TextArea"></textarea>');
          rows.appendChild(d);
        };
        addRow();
        root.querySelector(".iadd").addEventListener("click", addRow);
        window.__inRows = () => rows.children.length;
      },
      expect: (P) => [
        { t: "ic1", eq: P.internship_entries[0].company }, { t: "it1", eq: P.internship_entries[0].title },
        { t: "id1", has: P.internship_entries[0].task_action.slice(0, 20) },
        { t: "ic2", eq: P.internship_entries[1].company }, { t: "it2", eq: P.internship_entries[1].title },
        { t: "id2", has: P.internship_entries[1].task_action.slice(0, 20) },
        { fn: () => window.__inRows() === 2, what: "实习行数 = 2", got: () => String(window.__inRows()) },
      ],
    },
    ...[false, true].map(ow => ({
      name: `单项填写·第二段实习：第一行已填第一段，不能盖掉，另开一行${ow ? "（开覆盖）" : ""}`,
      html: sec("实习经历", '<div class="irows"></div><button type="button" class="iadd">添加实习经历</button>'),
      setup: (root, P) => {
        const rows = root.querySelector(".irows");
        const addRow = () => {
          const n = rows.children.length + 1;
          const d = document.createElement("div");
          d.innerHTML = mkField("ic" + n, "公司名称", '<input class="sd-Input-input">') +
            mkField("it" + n, "职位名称", '<input class="sd-Input-input">');
          rows.appendChild(d);
        };
        addRow();
        rows.querySelector("input").value = P.internship_entries[0].company;
        root.querySelector(".iadd").addEventListener("click", addRow);
        window.__inRows = () => rows.children.length;
      },
      view: (P) => window.AYA_VIEW.only(P, { type: "intern", name: P.internship_entries[1].company, title: P.internship_entries[1].title }),
      scope: "intern",
      overwrite: ow,
      expect: (P) => [
        { t: "ic1", eq: P.internship_entries[0].company },
        { t: "ic2", eq: P.internship_entries[1].company }, { t: "it2", eq: P.internship_entries[1].title },
        { fn: () => window.__inRows() === 2, what: "实习行数 = 2", got: () => String(window.__inRows()) },
      ],
    })),
  ];

  window.TEST_CASES = { CASES, valueOf };
})();
