// 把资料变成"这一次要填的资料"。弹窗和页面脚本共用这一份规则。
//
// byTrack(p, track)：按投递方向挑项目。
//   方向在资料的 track_names 里自己定义，比如 {"data": "数据分析", "pm": "产品经理"}；
//   每个项目的 tracks 写它属于哪个方向、排第几，比如 {"data": 1, "pm": 5}。
//   track = "all"（都填）时按时间从新到旧排（简历的常规顺序）。
//   资料里没有 track_names 就只有"都填"。
//
// only(p, target)：只留一项，其余清空，引擎就只会填这一项。
//   target.type：basic（个人资料：基本信息、教育、语言、自我介绍）/ project / campus（组织经历）/ intern / award
//   target.name：project / campus / award 用名字指定是哪一条；award 不给名字表示全部奖项。
//   intern 用 target.name（公司）+ target.title（职位）指定是哪一段实习。
(function () {
  // 这些是"经历类"的键；个人资料模式要清掉它们，单项模式只留目标那一项
  const EXP_KEYS = ["project_entries", "projects", "campus_entries", "organizations", "internship", "internship_entries",
    "honors", "honors_text", "ip_entries"];

  const clone = (o) => JSON.parse(JSON.stringify(o));
  // 实习列表（兼容老资料的单段 internship）
  const internsOf = (p) => clone(Array.isArray(p.internship_entries) && p.internship_entries.length ? p.internship_entries
    : p.internship && p.internship.company ? [p.internship] : []).filter(e => e && e.company);
  const endKey = (e) => e.ongoing ? 999999 : Number(e.end_year || e.start_year || 0) * 100 + Number(e.end_month || e.start_month || 0);

  // 资料里定义的投递方向（键 → 显示名），再加一个"都填"
  function tracksOf(p) {
    const names = (p && p.track_names && typeof p.track_names === "object") ? p.track_names : {};
    return Object.assign({}, names, { all: "都填" });
  }

  function projectsFor(p, track) {
    const all = p.project_entries || [];
    if (track === "all") return all.slice().sort((a, b) => endKey(b) - endKey(a));
    return all.filter(e => e.tracks && e.tracks[track] != null).sort((a, b) => a.tracks[track] - b.tracks[track]);
  }

  // 资料里有这个方向就用它，没有就退回"都填"
  function validTrack(p, track) {
    return tracksOf(p)[track] ? track : "all";
  }

  function byTrack(p, track) {
    track = validTrack(p, track);
    const out = clone(p);
    out.project_entries = projectsFor(p, track);
    const dirs = p.job_direction_by_track || {};
    if (track !== "all" && dirs[track]) out.job_direction = dirs[track];
    if (track === "all") {
      const all = Object.values(dirs).filter(Boolean);
      if (all.length > 1) out.job_direction = all.join(" / ");
    }
    return out;
  }

  // 清空：字符串变 ""，数组变 []，对象变 {}。引擎遇到空值会跳过，不会去填。
  function blank(v) { return Array.isArray(v) ? [] : v && typeof v === "object" ? {} : typeof v === "string" ? "" : v; }

  function only(p, target) {
    const out = clone(p);
    const t = target || {};
    if (t.type === "basic") {
      for (const k of EXP_KEYS) if (k in out) out[k] = blank(out[k]);
      return out;
    }
    // 其余模式：先全部清空，再放回目标那一项
    for (const k of Object.keys(out)) if (!k.startsWith("_")) out[k] = blank(out[k]);
    const same = (e) => e && e.name === t.name;
    if (t.type === "project") out.project_entries = (p.project_entries || []).filter(same);
    else if (t.type === "campus") out.campus_entries = (p.campus_entries || []).filter(same);
    else if (t.type === "intern") {
      out.internship_entries = internsOf(p).filter(e => (!t.name || e.company === t.name) && (!t.title || e.title === t.title));
    }
    else if (t.type === "award") {
      out.honors = (p.honors || []).filter(h => !t.name || h.name === t.name);
      if (!t.name) out.honors_text = p.honors_text;
    }
    return out;
  }

  const api = { tracksOf, validTrack, byTrack, only, projectsFor, internsOf };
  if (typeof window !== "undefined") window.AYA_VIEW = api;
  if (typeof module !== "undefined") module.exports = api;
})();
