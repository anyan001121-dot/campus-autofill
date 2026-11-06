// 资料存在浏览器本地，见 profile-store.js
const loadProfile = () => window.AYA_STORE.load();
const SCRIPTS = ["fill-engine.js", "profile-view.js", "profile-store.js", "content.js"];

// fillTarget：有的话这一行多一个「填」按钮，只填这一项（规则见 profile-view.js 的 only）
function addCopyRow(container, label, text, fillTarget) {
  if (!text) return;
  const row = document.createElement("div");
  row.className = "row";
  const l = document.createElement("div");
  l.className = "label";
  l.textContent = label;
  l.title = text;
  row.appendChild(l);
  if (fillTarget) row.appendChild(fillButton("填", fillTarget, "fillone"));
  const b = document.createElement("button");
  b.textContent = "复制";
  b.className = "copybtn";
  b.onclick = () => {
    navigator.clipboard.writeText(text);
    b.textContent = "已复制✓";
    setTimeout(() => (b.textContent = "复制"), 1200);
  };
  row.appendChild(b);
  container.appendChild(row);
}

function fillButton(text, target, cls) {
  const b = document.createElement("button");
  b.textContent = text;
  b.className = cls;
  b.title = "只把这一项填进当前页面";
  b.onclick = async () => {
    b.disabled = true;
    await runFill(target);
    b.disabled = false;
  };
  return b;
}

// 每个分类一个面板，一次只显示一个，用顶部的下拉框 / 左右箭头切换，不用一直往下滑
function addCategory(container, title) {
  const panel = document.createElement("div");
  panel.className = "cat-panel";
  panel.dataset.title = title;
  container.appendChild(panel);
  return panel;
}

// 分类最上面的「填这一类全部」按钮
function addCatFill(panel, text, target) {
  panel.appendChild(fillButton(text, target, "cat-fill"));
}

function setupCatNav(list) {
  const panels = [...list.querySelectorAll(".cat-panel")].filter(p => p.querySelector(".row"));
  list.querySelectorAll(".cat-panel").forEach(p => { if (!p.querySelector(".row")) p.remove(); });
  const select = document.getElementById("catSelect");
  select.innerHTML = "";
  panels.forEach((p, i) => select.add(new Option(p.dataset.title, i)));
  const show = (i) => {
    i = (i + panels.length) % panels.length;
    panels.forEach((p, j) => (p.hidden = j !== i));
    select.value = i;
    list.scrollTop = 0;
    try { localStorage.setItem("ayaCat", i); } catch (e) {}
  };
  select.onchange = () => show(+select.value);
  document.getElementById("catPrev").onclick = () => show(+select.value - 1);
  document.getElementById("catNext").onclick = () => show(+select.value + 1);
  let saved = 0;
  try { saved = +localStorage.getItem("ayaCat") || 0; } catch (e) {}
  show(saved < panels.length ? saved : 0);
}

// 列表内容跟着投递方向变：项目经历只列这个方向的项目
function renderList(raw, track) {
  const profile = window.AYA_VIEW.byTrack(raw, track);
  const list = document.getElementById("copyList");
  list.innerHTML = "";
  let sec;

  sec = addCategory(list, "个人资料");
  addCatFill(sec, "只填个人资料（基本信息、教育、语言、自我介绍）", { type: "basic" });
  addCopyRow(sec, "出生年月", profile.birth_date_cn);
  addCopyRow(sec, "籍贯", profile.native_place);
  addCopyRow(sec, "民族", profile.ethnicity);
  addCopyRow(sec, "政治面貌", profile.political_status);
  addCopyRow(sec, "现居城市", profile.current_city);
  addCopyRow(sec, "求职方向", profile.job_direction);
  addCopyRow(sec, "个人网站 / 作品集", profile.portfolio);
  addCopyRow(sec, "GitHub", profile.github);

  sec = addCategory(list, "自我介绍 / 技能");
  addCopyRow(sec, "自我介绍（长）", profile.self_intro_long);
  addCopyRow(sec, "自我介绍（短）", profile.self_intro_short);
  addCopyRow(sec, "技能一行版", profile.skills_short);
  addCopyRow(sec, "AI 能力描述", profile.skills_ai);
  addCopyRow(sec, "特长", profile.specialty);
  addCopyRow(sec, "兴趣爱好", profile.hobbies);

  sec = addCategory(list, "教育经历");
  (profile.education_entries || []).forEach(e => addCopyRow(sec, "教育经历｜" + e.school,
    `${e.school}｜${e.major}｜${e.degree}（${e.start_year}.${e.start_month} - ${e.end_year}.${e.end_month}）`));

  sec = addCategory(list, "实习经历");
  window.AYA_VIEW.internsOf(profile).forEach(it => addCopyRow(sec, "实习｜" + it.company + (it.title ? "｜" + it.title : ""),
    `${it.company}｜${it.dept || ""}｜${it.title || ""}（${it.period || ""}）\n${[it.core_result, it.responsibilities, it.task_action, it.insight].filter(Boolean).join("\n\n") || it.one_liner || ""}`,
    { type: "intern", name: it.company, title: it.title }));

  sec = addCategory(list, `项目经历（${window.AYA_VIEW.tracksOf(raw)[track] || "都填"}）`);
  // 四段（core_result / responsibilities / task_action / insight）在资料里
  // 已经自带【】标题，这里直接拼，不要再额外加一次标题，不然会出现
  // "【核心成果】【核心成果】"这种重复——之前真的出现过。
  // 和自动填充同一个规则：职责框只放【个人职责】，描述框放其余三段。
  const projectEntries = profile.project_entries || [];
  const full = (p) => [p.core_result, p.responsibilities, p.task_action, p.insight].filter(Boolean).join("\n\n");
  const desc = (p) => [p.core_result, p.task_action, p.insight].filter(Boolean).join("\n\n");
  addCopyRow(sec, "全部项目经历（合并）",
    projectEntries.map(p => `${p.name}｜${p.role_short}\n${full(p)}`).join("\n\n———\n\n"));
  projectEntries.forEach(p => {
    addCopyRow(sec, "项目｜" + p.name, `${p.name}\n${full(p)}`, { type: "project", name: p.name });
    addCopyRow(sec, "　└ 项目职责", p.responsibilities);
    addCopyRow(sec, "　└ 项目描述", desc(p));
  });

  sec = addCategory(list, "组织经历");
  (profile.campus_entries || []).forEach(e =>
    addCopyRow(sec, "组织｜" + e.name, `${e.name}｜${e.role || ""}\n${full(e)}`, { type: "campus", name: e.name }));
  addCopyRow(sec, "组织经历（一段话）", profile.organizations);

  sec = addCategory(list, "荣誉奖项");
  addCatFill(sec, "填全部奖项", { type: "award" });
  addCopyRow(sec, "荣誉列表", profile.honors_text);
  (profile.honors || []).forEach(h => addCopyRow(sec, "奖项｜" + h.name, `${h.name} ${h.award}（${h.date_cn}）`, { type: "award", name: h.name }));

  sec = addCategory(list, "专利 / 软著");
  (profile.ip_entries || []).forEach(e => {
    addCopyRow(sec, "成果名称", e.name);
    addCopyRow(sec, "登记号", e.reg_no);
    addCopyRow(sec, "证书号", e.cert_no);
    addCopyRow(sec, "登记日期", `${e.reg_year}-${String(e.reg_month).padStart(2, "0")}-${String(e.reg_day).padStart(2, "0")}`);
    addCopyRow(sec, "核心简介", full(e));
  });

  setupCatNav(list);
}

function isRestrictedUrl(url) {
  return !url || /^(chrome|edge|about|chrome-extension|devtools):/i.test(url)
    || url.startsWith("https://chrome.google.com/webstore")
    || url.startsWith("https://chromewebstore.google.com");
}

function ping(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "AYA_PING" }, (resp) => {
      resolve(!chrome.runtime.lastError && resp && resp.scoped ? resp : null);
    });
  });
}

function sendFillMessage(tabId, only) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "AYA_FILL", only: only || null }, (resp) => {
      resolve({ ok: !chrome.runtime.lastError, resp });
    });
  });
}

// only 为空 = 按当前投递方向填整页；有值 = 只填这一项
async function runFill(only) {
  const status = document.getElementById("status");
  status.textContent = only ? "正在填这一项…" : "填充中…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (isRestrictedUrl(tab.url)) {
    status.textContent = "这是浏览器/商店内置页面，插件不允许在这类页面运行";
    return;
  }

  // 单项填写：先确认页面里的脚本支持"只填这一项"。插件更新后没刷新的页面里还是旧脚本，
  // 旧脚本收到消息会把整页都填了，所以不支持就不发，提示刷新。
  if (only && !(await ping(tab.id))) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: SCRIPTS });
    } catch (e) {}
    if (!(await ping(tab.id))) {
      status.textContent = "⚠️ 这个页面里还是旧版脚本，不支持单项填写。请刷新页面（F5）后再点「填」。";
      return;
    }
  }

  let { ok, resp } = await sendFillMessage(tab.id, only);

  if (!ok) {
    // 常见原因：扩展是在这个标签页打开之后才安装/重新加载的，页面里还没有脚本。
    // 自动补注入一次脚本文件，再重发一次消息，不用劳烦用户自己去刷新页面。
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: SCRIPTS,
      });
      ({ ok, resp } = await sendFillMessage(tab.id, only));
    } catch (e) {
      ok = false;
    }
  }

  if (!ok) {
    status.textContent = "注入失败，手动刷新一下这个页面再试一次";
    return;
  }
  if (resp && resp.noProfile) {
    status.textContent = "还没有导入资料：点上面的「资料管理」导入后再填";
    return;
  }
  const filled = resp && resp.filled;
  const missed = (resp && resp.missed) || [];
  // 插件重新加载后，已打开的页面里还是旧脚本——版本对不上就提醒刷新
  const want = chrome.runtime.getManifest().version;
  const stale = resp && resp.version !== want ? `⚠️ 这个页面里跑的是旧版（${resp.version ? "v" + resp.version : "旧版"}，最新 v${want}），请刷新页面后再填。` : "";
  const none = only ? "这一项没有可填的空白位置（已经填过，或页面上没有对应的栏目）" : "没找到能匹配的空白字段";
  status.textContent = stale + (filled > 0 ? `已填充 ${filled} 个字段` : none)
    + (missed.length ? `；没填上：${missed.join("、")}` : "");
}

(async function init() {
  document.getElementById("manageBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  const raw = await loadProfile();

  // 还没有资料：只显示导入引导
  if (!raw) {
    document.getElementById("main").hidden = true;
    document.getElementById("empty").hidden = false;
    document.getElementById("setupBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
    return;
  }

  // 投递方向：按资料里的 track_names 生成按钮（再加"都填"）；资料里没定义方向就不显示这一栏。
  // 选中的方向存在 chrome.storage.local，content.js 自动填充和一键填充都按它挑项目
  const tracks = window.AYA_VIEW.tracksOf(raw);
  const trackRow = document.getElementById("trackRow");
  for (const [key, label] of Object.entries(tracks)) {
    const b = document.createElement("button");
    b.dataset.track = key;
    b.textContent = label;
    trackRow.appendChild(b);
  }
  if (Object.keys(tracks).length <= 1) {
    trackRow.hidden = true;
    document.getElementById("trackLabel").hidden = true;
  }
  let { track: savedTrack = "all" } = await chrome.storage.local.get("track");
  savedTrack = window.AYA_VIEW.validTrack(raw, savedTrack);
  const trackBtns = [...trackRow.querySelectorAll("button")];
  const setTrack = (track) => {
    trackBtns.forEach(b => b.classList.toggle("on", b.dataset.track === track));
    renderList(raw, track);
  };
  trackBtns.forEach(b => b.addEventListener("click", () => {
    chrome.storage.local.set({ track: b.dataset.track });
    setTrack(b.dataset.track);
  }));
  setTrack(savedTrack);

  // 自动填充开关：存在 chrome.storage.local 里，content.js 每次打开页面都会读一次。
  const toggle = document.getElementById("autoToggle");
  const { autoFillEnabled = true } = await chrome.storage.local.get("autoFillEnabled");
  toggle.checked = autoFillEnabled;
  toggle.addEventListener("change", () => {
    chrome.storage.local.set({ autoFillEnabled: toggle.checked });
  });

  // 覆盖开关：默认关闭（只填空白字段，不碰已有内容）。打开之后，自动填充和
  // 手动点"立即重新扫描并填充当前页"都会直接拿 profile 里的数据覆盖已有内容——
  // 要不要覆盖、什么时候覆盖，交给用户自己判断，插件不替用户决定。
  const overwriteToggle = document.getElementById("overwriteToggle");
  const { overwriteFilled = false } = await chrome.storage.local.get("overwriteFilled");
  overwriteToggle.checked = overwriteFilled;
  overwriteToggle.addEventListener("change", () => {
    chrome.storage.local.set({ overwriteFilled: overwriteToggle.checked });
  });

  document.getElementById("fillBtn").addEventListener("click", () => runFill(null));
})();

// 标题旁显示插件版本，和页面提示里的版本对照
{
  const h = document.querySelector("header h1");
  if (h) h.textContent += " v" + chrome.runtime.getManifest().version;
}
