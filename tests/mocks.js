// 各网站出过错的组件，按真实行为做的最小复刻。只复刻"坑"本身：
// DOM 结构（class 名、哪里有 input、值显示在哪）+ 交互行为（点哪里才有用、什么时候关）。
// 每个复刻上面写着它对应哪个网站、哪次出的错。
(() => {
  const open = new Set(); // 当前开着的弹层：{ pop, owner, close }

  function closeAll() { for (const o of [...open]) o.close(); }
  function register(pop, owner, close) {
    const o = { pop, owner, close: () => { open.delete(o); close(); } };
    open.add(o);
    return o;
  }
  // 点弹层和触发器以外的地方 / 按 Escape → 关（引擎的 closePanel 就是这么做的）
  document.addEventListener("mousedown", (e) => {
    for (const o of [...open]) if (!o.pop.contains(e.target) && !(o.owner && o.owner.contains(e.target))) o.close();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); }, true);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  // 弹层挂在 body 末尾（和真实组件库一样是 portal），放在触发器下面
  function place(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    Object.assign(pop.style, {
      position: "absolute", top: r.bottom + scrollY + 4 + "px", left: r.left + scrollX + "px",
      zIndex: 1000, background: "#fff", border: "1px solid #ccc", padding: "4px", minWidth: "160px",
    });
    document.body.appendChild(pop);
  }
  const ICON = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M8 2 L4 6 L8 10" stroke="#333" fill="none"/></svg>';
  const fire = (inp) => { inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); };
  const range = (a, b) => { const out = []; for (let i = a; i >= b; i--) out.push(i); return out; };
  const pad = (n) => String(n).padStart(2, "0");

  // ── 飞书 atsx period picker（2026-10-23 第一张飞书表，起止时间全空）──
  // 隐藏 input + 两个"YYYY-MM"显示格；点格子弹出 年份列 + 月份列；选完开始自动弹结束；
  // 结束的年份列第一项是"至今"。值只显示在格子里，input 一直是空的。
  function periodPicker(w) {
    const slots = [...w.querySelectorAll(".atsx-date-picker-period-month-label")];
    const val = ["", ""];
    const show = (i, y) => {
      const v = val[i];
      slots[i].innerHTML = v === "至今" ? "<span>至今</span>"
        : v ? `<span>${v.slice(0, 4)}</span><span>-</span><span>${v.slice(5)}</span>`
        : `<span>${y || "YYYY"}</span><span>-</span><span>MM</span>`;
    };
    const openSlot = (i) => {
      closeAll();
      const pop = el("div", "atsx-date-picker-dropdown");
      const panel = el("div", "atsx-date-picker-period-month-panel");
      const yl = el("div", "atsx-date-picker-period-month-panel-list");
      const ml = el("div", "atsx-date-picker-period-month-panel-list");
      for (const l of [yl, ml]) Object.assign(l.style, { display: "inline-block", verticalAlign: "top", maxHeight: "180px", overflow: "auto", width: "70px" });
      let y = null;
      // 真实组件的年份列包含未来几年（预计毕业 2027 能选）
      for (const t of (i === 1 ? ["至今"] : []).concat(range(2031, 1990))) {
        const it = el("div", "atsx-date-picker-period-month-panel-list-item", String(t));
        it.addEventListener("click", () => {
          if (t === "至今") { val[i] = "至今"; show(i); reg.close(); return; }
          y = t; show(i, y);
        });
        yl.appendChild(it);
      }
      for (let m = 1; m <= 12; m++) {
        const it = el("div", "atsx-date-picker-period-month-panel-list-item", pad(m));
        it.addEventListener("click", () => {
          if (!y) return;
          val[i] = `${y}-${pad(m)}`; show(i); reg.close();
          if (i === 0) setTimeout(() => openSlot(1), 30);
        });
        ml.appendChild(it);
      }
      panel.append(yl, ml); pop.appendChild(panel);
      place(pop, slots[i]);
      const reg = register(pop, w, () => pop.remove());
    };
    slots.forEach((s, i) => s.addEventListener("click", () => openSlot(i)));
    w.readSlots = () => val.map(v => v || "").join(" ~ ");
  }

  // ── 飞书 ud__picker 月份面板（2026-10-23 某消费电子公司，出生日期/起止时间全空）──
  // 普通 input，点开是"2026年 + 展开按钮 + 两个没字的翻年按钮 + 12 个月格"；
  // 打字不认（回车/失焦恢复原值）；输入框一失焦面板就关（翻第二年时面板没了的坑）。
  function monthInput(inp, { now = false, onPick } = {}) {
    let committed = "", pop = null, year = 2026, reg = null;
    const close = () => { if (pop) { pop.remove(); pop = null; } if (inp.value !== committed) inp.value = committed; };
    const render = () => {
      pop.innerHTML = "";
      const head = el("div", "ud__picker-panel-header");
      head.style.display = "flex"; // 真实表头是一行：年份 + 展开按钮在左，两个翻年按钮在右
      const left = el("div", "ud__picker-panel-header-content ud__picker-panel-header-content__left");
      left.style.flex = "1";
      left.appendChild(el("span", "ud__picker-panel-header-btn", `${year}年`));
      const col = el("button", "ud__button ud__picker-panel-header-icon ud__picker-panel-header-collapse");
      col.type = "button"; col.innerHTML = '<span class="universe-icon ud__picker-panel-header-rotate">' + ICON + "</span>";
      left.appendChild(col);
      head.appendChild(left);
      for (const d of [-1, 1]) {
        const b = el("button", "ud__button ud__button--icon ud__picker-panel-header-icon");
        b.type = "button"; b.innerHTML = '<span class="universe-icon">' + ICON + "</span>";
        b.addEventListener("click", () => { year += d; render(); });
        head.appendChild(b);
      }
      pop.appendChild(head);
      const grid = el("div", "ud__picker-month-grid");
      const cells = [];
      for (let m = 1; m <= 12; m++) cells.push(pad(m) + "月");
      if (now) cells.push("至今");
      for (const t of cells) {
        const c = el("div", "ud__picker-cell", t);
        Object.assign(c.style, { display: "inline-block", width: "50px", padding: "4px" });
        c.addEventListener("click", () => {
          committed = t === "至今" ? "至今" : `${year}-${t.slice(0, 2)}`;
          inp.value = committed; fire(inp);
          reg.close();
          if (onPick) onPick();
        });
        grid.appendChild(c);
      }
      pop.appendChild(grid);
    };
    const openIt = () => {
      if (pop) return;
      closeAll();
      pop = el("div", "ud__dropdown");
      place(pop, inp);
      render();
      reg = register(pop, inp, close);
    };
    inp.addEventListener("focus", openIt);
    inp.addEventListener("click", openIt);
    inp.addEventListener("blur", () => setTimeout(() => reg && reg.close(), 0));
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.value = committed; });
  }
  // 区间：两个 monthInput，选完开始自动切到结束
  function monthRange(w, { now = false } = {}) {
    const [a, b] = w.querySelectorAll("input");
    monthInput(b, { now });
    monthInput(a, { onPick: () => setTimeout(() => b.focus(), 30) });
  }

  // ── 飞书 ud__select（2026-10-23 某消费电子公司，性别/学历/排名没被认出来）──
  // 输入框 type=search + role=combobox + readonly，一直空着；选中值显示在旁边的 span 里
  function udSelect(box, options) {
    const disp = box.querySelector(".mock-value");
    box.querySelector(".ud__select__selector").addEventListener("click", () => {
      closeAll();
      const pop = el("div", "ud__dropdown");
      for (const t of options) {
        const o = el("div", "ud__select-option", t);
        o.addEventListener("click", () => { disp.textContent = t; reg.close(); });
        pop.appendChild(o);
      }
      place(pop, box);
      const reg = register(pop, box, () => pop.remove());
    });
  }

  // ── 某制造企业 phoenix"先勾选再确定"面板（2026-10-22，民族/籍贯选不上）──
  // 点文字没用，要点圆圈（监听在圆圈上）再点"确定"；籍贯面板自带搜索框
  function tickPanel(inp, options, { search = false } = {}) {
    inp.addEventListener("click", () => {
      closeAll();
      let chosen = null;
      const pop = el("div", "phoenix-popover");
      let sbox = null;
      if (search) { sbox = el("input", "phoenix-search"); sbox.placeholder = "搜索"; pop.appendChild(sbox); }
      const list = el("div", "phoenix-list");
      const items = options.map(t => {
        const row = el("div", "phoenix-item");
        const radio = el("span", "phoenix-radio");
        radio.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" stroke="#666" fill="none"/></svg>';
        Object.assign(radio.style, { display: "inline-block", width: "14px", height: "14px", marginRight: "6px" });
        radio.addEventListener("click", () => {
          chosen = t;
          list.querySelectorAll(".phoenix-radio").forEach(r => { r.classList.remove("checked"); r.setAttribute("aria-checked", "false"); });
          radio.classList.add("checked"); radio.setAttribute("aria-checked", "true");
        });
        row.append(radio, el("span", "phoenix-item-text", t));
        list.appendChild(row);
        return { row, t };
      });
      pop.appendChild(list);
      if (sbox) sbox.addEventListener("input", () => items.forEach(({ row, t }) => { row.style.display = t.includes(sbox.value) ? "" : "none"; }));
      const ok = el("button", "phoenix-btn", "确定");
      ok.type = "button";
      ok.addEventListener("click", () => { if (chosen) { inp.value = chosen; fire(inp); } reg.close(); });
      pop.appendChild(ok);
      place(pop, inp);
      const reg = register(pop, inp, () => pop.remove());
    });
  }

  // ── 某科技公司 aui 下拉（2026-10-22）：只读 input，下拉项 .aui-select-dropdown__item ──
  function auiSelect(inp, options) {
    inp.addEventListener("click", () => {
      closeAll();
      const pop = el("div", "aui-select-dropdown");
      for (const t of options) {
        const o = el("div", "aui-select-dropdown__item", t);
        o.addEventListener("click", () => { inp.value = t; fire(inp); reg.close(); });
        pop.appendChild(o);
      }
      place(pop, inp);
      const reg = register(pop, inp, () => pop.remove());
    });
  }

  // ── 飞书早期（Lark）：选项只认 mousedown，click 没反应 ──
  function mousedownSelect(inp, options) {
    inp.addEventListener("click", () => {
      closeAll();
      const pop = el("div", "lark-select-popup");
      for (const t of options) {
        const o = el("div", "lark-option", t);
        o.addEventListener("mousedown", (e) => { e.preventDefault(); inp.value = t; fire(inp); reg.close(); });
        pop.appendChild(o);
      }
      place(pop, inp);
      const reg = register(pop, inp, () => pop.remove());
    });
  }

  // ── 某德企 SmartRecruiters：输入框在 Shadow DOM 里，标签写在宿主的 label 属性上 ──
  if (!customElements.get("mock-field")) {
    customElements.define("mock-field", class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: "open" }).innerHTML = "<input>"; }
    });
  }

  // ── 无 role 的自动补全（某德企"所在城市"）：必须点候选，没选中失焦就清空 ──
  function autocomplete(c, options) {
    let chosen = "", box = null;
    c.addEventListener("input", () => {
      chosen = ""; if (box) box.remove();
      box = el("div", "lb");
      Object.assign(box.style, { border: "1px solid #999", background: "#fff" });
      options.filter(t => t.includes(c.value.slice(0, 1))).forEach(t => {
        const o = el("div", "", t);
        o.addEventListener("mousedown", (e) => { e.preventDefault(); chosen = t; c.value = t; box.remove(); box = null; });
        box.appendChild(o);
      });
      c.parentNode.appendChild(box);
    });
    c.addEventListener("blur", () => setTimeout(() => { if (!chosen) { c.value = ""; if (box) { box.remove(); box = null; } } }, 50));
  }

  // ── Moka sd-basic 按天日历（2026-10-25 某外企：生日被填成本月 20 号）──
  // 只读 input，placeholder"日期（年月日）"；表头 « ‹ 2026年 十月 › »；日期格前面露出上月末几天
  function mokaDate(inp) {
    let y = 2026, m = 10, pop = null, reg = null;
    const CN = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const icon = (c) => { const e = el("span", "sd-Icon-container " + c); e.style.cssText = "display:inline-block;width:14px;height:14px;border:1px solid #999;margin:0 2px"; return e; };
    const render = () => {
      pop.innerHTML = "";
      const head = el("div", "sd-basic-selector");
      head.style.display = "flex";
      const l = el("div"); const dl = icon("sd-Icon-icondoubleLeft"), sl = icon("sd-Icon-iconleft sd-basic-selector-prev-tool"); l.append(dl, sl);
      const mid = el("div", "sd-basic-selector-content"); mid.append(el("span", "sd-basic-selector-year", `${y}年`), el("span", "sd-basic-selector-month", CN[m - 1]));
      const r = el("div"); const sr = icon("sd-Icon-iconright sd-basic-selector-next-tool"), dr = icon("sd-Icon-icondoubleRight"); r.append(sr, dr);
      dl.addEventListener("click", () => { y--; render(); }); dr.addEventListener("click", () => { y++; render(); });
      sl.addEventListener("click", () => { m--; if (m < 1) { m = 12; y--; } render(); });
      sr.addEventListener("click", () => { m++; if (m > 12) { m = 1; y++; } render(); });
      head.append(l, mid, r); pop.appendChild(head);
      const grid = el("div", "sd-basic-date-grid");
      const first = new Date(y, m - 1, 1).getDay() || 7, days = new Date(y, m, 0).getDate(), prevDays = new Date(y, m - 1, 0).getDate();
      const cell = (t, cur) => {
        const w = el("div", "sd-basic-item-wrapper"); const c = el("div", "sd-basic-date-item", String(t));
        w.style.cssText = "display:inline-block;width:28px;color:" + (cur ? "#000" : "#bbb"); w.appendChild(c);
        if (cur) c.addEventListener("click", () => { inp.value = `${y}-${pad(m)}-${pad(t)}`; fire(inp); reg.close(); });
        grid.appendChild(w);
      };
      for (let i = first - 1; i >= 1; i--) cell(prevDays - i + 1, false);
      for (let t = 1; t <= days; t++) cell(t, true);
      for (let t = 1; t <= 6; t++) cell(t, false);
      pop.appendChild(grid);
    };
    inp.addEventListener("click", () => {
      if (pop) return;
      closeAll();
      pop = el("div", "sd-panal-select-container");
      place(pop, inp); render();
      reg = register(pop, inp, () => { pop.remove(); pop = null; });
    });
  }

  // ── Moka 按月选的出生日期（2026-10-25 某硬件公司：月份格子写成"一月…十二月"，引擎只认"1月/01"，生日一直空着）──
  // 表头 « 2001年 »，下面 12 个月份格；选完框里显示"2001-10 (25岁)"
  function mokaMonth(inp) {
    let y = 1990, pop = null, reg = null;
    const CN = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const icon = (c) => { const e = el("span", "sd-Icon-container " + c + " sd-basic-selector-icon"); e.style.cssText = "display:inline-block;width:14px;height:14px;border:1px solid #999;margin:0 2px"; return e; };
    const render = () => {
      pop.innerHTML = "";
      const head = el("div", "sd-basic-selector"); head.style.display = "flex";
      const l = el("div"), dl = icon("sd-Icon-icondoubleLeft"); l.append(dl);
      const mid = el("div", "sd-basic-selector-content"); mid.append(el("span", "sd-basic-selector-year", `${y}年`));
      const r = el("div"), dr = icon("sd-Icon-icondoubleRight"); r.append(dr);
      dl.addEventListener("click", () => { y--; render(); }); dr.addEventListener("click", () => { y++; render(); });
      head.append(l, mid, r); pop.appendChild(head);
      const grid = el("div", "sd-basic-year-container");
      CN.forEach((t, i) => {
        const w = el("div", "sd-basic-year-wrapper"); const c = el("div", "sd-basic-year-item", t);
        w.style.cssText = "display:inline-block;width:48px"; w.appendChild(c);
        c.addEventListener("click", () => { inp.value = `${y}-${pad(i + 1)} (${2026 - y}岁)`; fire(inp); reg.close(); });
        grid.appendChild(w);
      });
      pop.appendChild(grid);
    };
    inp.addEventListener("click", () => {
      if (pop) return;
      closeAll();
      pop = el("div", "sd-panal-menu-wrapper");
      place(pop, inp); render();
      reg = register(pop, inp, () => { pop.remove(); pop = null; });
    });
  }

  // ── Moka sd-Select（2026-10-25 某外企：选中值在旁边的 span，引擎读不到就一遍遍重开）──
  // 可输入的 input（没有 role），选中值显示在 .sd-Input-display-value；整个字段外层 class 也带
  // select，里面还有"必填项未填写"报错——不能把报错当成已选的值
  // search：可搜索的大列表（学校库）——没打字只显示前两项，打字后按包含过滤（不分大小写）
  // redraw：选完一项后整个字段被换成新的空元素（某硬件公司 Moka 登录后自动保存草稿、整块重画的
  // 最坏情况）。打开次数记在 window.__mkOpens[字段 data-t] 上，换了元素也累计
  // byPoint：按点击坐标认选项（某游戏公司 Moka 年份 2126→1926 的长列表，2026-10-29）。列表限高可滚动，
  // 点的位置不在任何选项上（坐标 0,0、目标在滚动区外）就选成列表第一项——真实页面就是这样全变成 2126
  function mokaSelect(field, options, { search = false, redraw = false, byPoint = false } = {}) {
    const fresh = redraw ? field.cloneNode(true) : null;
    const disp = field.querySelector(".sd-Input-display-value span");
    const err = field.querySelector(".error-msg");
    // 打的字只用来搜索：没选中选项就失焦，清空
    const inp = field.querySelector(".sd-Input-input");
    inp.addEventListener("blur", () => setTimeout(() => { inp.value = ""; }, 0));
    field.__opens = 0; // 被打开了几次（测"对不上时不要一直开合"）
    window.__mkOpens = window.__mkOpens || {};
    field.querySelector(".sd-Select-container").addEventListener("click", () => {
      if (open.size && [...open].some(o => o.owner === field)) return; // 已开着
      field.__opens++;
      window.__mkOpens[field.dataset.t] = (window.__mkOpens[field.dataset.t] || 0) + 1;
      closeAll();
      const pop = el("div", "sd-Dropdown-menu");
      const draw = () => {
        pop.innerHTML = "";
        const q = (inp.value || "").toLowerCase();
        const shown = search ? (q ? options.filter(t => t.toLowerCase().includes(q)) : options.slice(0, 2)) : options;
        if (!shown.length) pop.appendChild(el("div", "sd-Dropdown-empty", "暂无选项"));
        for (let t of shown) {
          const o = el("div", "sd-Dropdown-item", t);
          o.addEventListener("click", (ev) => {
            if (byPoint) {
              const under = document.elementFromPoint(ev.clientX, ev.clientY);
              const item = under && under.closest && under.closest(".sd-Dropdown-item");
              t = item && pop.contains(item) ? item.textContent : shown[0];
            }
            disp.textContent = t; inp.removeAttribute("placeholder"); if (err) err.style.display = "none"; reg.close(); // 真实 Moka 选上后"年""月"提示就没了
            if (fresh) setTimeout(() => { if (!field.isConnected) return; const nf = fresh.cloneNode(true); field.replaceWith(nf); mokaSelect(nf, options, { search, redraw }); }, 50);
          });
          pop.appendChild(o);
        }
      };
      draw();
      if (search) inp.oninput = draw;
      // 真实 Moka：列表画在下拉框容器里面（不是挂到 body），读值时不能把选项当成已选值
      const box = field.querySelector(".sd-Dropdown-container");
      Object.assign(pop.style, { position: "absolute", zIndex: 1000, background: "#fff", border: "1px solid #ccc", minWidth: "160px" });
      if (byPoint) Object.assign(pop.style, { maxHeight: "150px", overflowY: "auto" });
      box.style.position = "relative";
      box.appendChild(pop);
      const reg = register(pop, field, () => pop.remove());
    });
  }

  window.MOCK = { mokaDate, mokaMonth, mokaSelect,  periodPicker, monthInput, monthRange, udSelect, tickPanel, auiSelect, mousedownSelect, autocomplete, closeAll };
})();
