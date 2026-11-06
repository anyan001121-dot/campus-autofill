// 资料存在浏览器本地（chrome.storage.local 的 "profile"），不上传到任何服务器。
// 弹窗、资料管理页、页面脚本都通过这里读写。
(function () {
  const KEY = "profile";

  async function load() {
    const got = await chrome.storage.local.get(KEY);
    const p = got[KEY];
    return p && typeof p === "object" ? p : null;
  }

  async function save(p) {
    await chrome.storage.local.set({ [KEY]: p });
  }

  async function clear() {
    await chrome.storage.local.remove(KEY);
  }

  // AI 返回的内容常带 ```json 代码块、前后说明文字：只取第一个 { 到最后一个 } 之间
  function parse(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a < 0 || b <= a) throw new Error("没找到 JSON：内容里应该有一对 { }");
    s = s.slice(a, b + 1);
    let p;
    try { p = JSON.parse(s); }
    catch (e) { throw new Error("JSON 格式不对：" + e.message + "。可以让 AI “只输出合法 JSON，不要注释”后重试"); }
    if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("最外层应该是一个 { } 对象");
    return normalize(p);
  }

  // 常见的小问题直接修：数字年月转成字符串、布尔值写成字符串、缺的数组补空
  function normalize(p) {
    const fixEntry = (e) => {
      if (!e || typeof e !== "object") return e;
      for (const k of ["start_year", "start_month", "start_day", "end_year", "end_month", "end_day", "year", "month", "day",
        "birth_year", "birth_month", "birth_day", "reg_year", "reg_month", "reg_day"]) {
        if (typeof e[k] === "number") e[k] = String(e[k]);
      }
      for (const k of ["ongoing", "overseas"]) {
        if (e[k] === "true") e[k] = true;
        if (e[k] === "false") e[k] = false;
      }
      return e;
    };
    fixEntry(p);
    for (const k of ["education_entries", "language_entries", "honors", "project_entries", "campus_entries", "ip_entries"]) {
      if (p[k] == null) p[k] = [];
      if (!Array.isArray(p[k])) p[k] = [p[k]];
      p[k].forEach(fixEntry);
    }
    if (p.internship) fixEntry(p.internship);
    if (!p.education || typeof p.education !== "object") p.education = {};
    // 没写 education 汇总时，从第一条（最高学历）补上
    const top = p.education_entries[0];
    if (top) {
      p.education.highest_school = p.education.highest_school || top.school || "";
      p.education.highest_degree = p.education.highest_degree || top.degree || "";
      p.education.highest_major = p.education.highest_major || top.major || "";
    }
    return p;
  }

  // 导入前给用户看的检查结果：缺了哪些常用字段（不算错误，只是提醒）
  function check(p) {
    const warn = [];
    for (const [k, label] of [["name", "姓名"], ["phone", "手机号"], ["email", "邮箱"], ["gender", "性别"]]) {
      if (!p[k]) warn.push(`没有${label}（${k}）`);
    }
    if (!p.education_entries.length) warn.push("没有教育经历（education_entries）");
    p.education_entries.forEach((e, i) => {
      if (!e.school) warn.push(`第 ${i + 1} 段教育没有学校名`);
      if (!e.start_year) warn.push(`第 ${i + 1} 段教育没有入学年份`);
    });
    p.project_entries.forEach((e, i) => { if (!e.name) warn.push(`第 ${i + 1} 个项目没有名称`); });
    const summary = `教育 ${p.education_entries.length} 段、项目 ${p.project_entries.length} 个、` +
      `实习 ${p.internship && p.internship.company ? 1 : 0} 段、组织经历 ${p.campus_entries.length} 段、奖项 ${p.honors.length} 个`;
    return { summary, warn };
  }

  const api = { load, save, clear, parse, normalize, check };
  if (typeof window !== "undefined") window.AYA_STORE = api;
})();
