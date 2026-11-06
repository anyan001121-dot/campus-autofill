// 自动在每个页面跑一遍：像表单的页面才会真正触发填充，普通网页不会有动作。
// 想关掉自动填充（只保留手动点按钮/复制），去插件弹窗里关闭开关即可。
//
// 加一层 __AYA_CONTENT_LOADED 守卫：popup.js 在"消息发不出去"时会把这个文件
// 重新注入一次兜底（常见于扩展重新加载后、还没刷新过的旧标签页），
// 这里防止同一个页面重复挂监听、重复弹 toast。
if (!window.__AYA_CONTENT_LOADED) {
  window.__AYA_CONTENT_LOADED = true;

  const aya_toast = (text) => {
    const box = document.createElement("div");
    box.id = "aya-toast";
    box.textContent = text;
    box.style.cssText = `
      position: fixed; right: 18px; bottom: 18px; z-index: 2147483647;
      background: #1f4d3f; color: #fff; padding: 10px 16px; border-radius: 8px;
      font-size: 13px; font-family: -apple-system, "PingFang SC", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.2); opacity: 0; transition: opacity .25s;
    `;
    document.body.appendChild(box);
    requestAnimationFrame(() => (box.style.opacity = "1"));
    setTimeout(() => {
      box.style.opacity = "0";
      setTimeout(() => box.remove(), 300);
    }, text.includes("没填上") ? 8000 : 3000);
  };

  // 认出来但没填进去的字段，直接告诉用户去手动补，而不是悄悄漏掉
  const aya_missText = (missed) => missed.length
    ? `；${missed.length} 个没填上，请手动补：${missed.slice(0, 5).join("、")}${missed.length > 5 ? " 等" : ""}` : "";

  // 资料存在浏览器本地（见 profile-store.js）；还没导入时返回 null，什么都不填
  const aya_loadProfile = () => window.AYA_STORE.load();

  // 这一次要填的资料：先按弹窗里选的投递方向挑项目（方向在资料的 track_names 里定义）；
  // only = 弹窗里某一项旁边的"填"按钮，只留那一项（规则见 profile-view.js）
  const aya_fillProfile = async (raw, only) => {
    const { track = "all" } = await chrome.storage.local.get("track");
    const p = window.AYA_VIEW.byTrack(raw, track);
    return only ? window.AYA_VIEW.only(p, only) : p;
  };

  // 同一时间只跑一次填充：一次完整填充（点"添加"、逐格翻日历）可能超过 3 秒，
  // 不加锁的话 3 秒后的补跑会和第一次同时进行，两边都去点"添加"，多出重复的行。
  let aya_running = null;
  // 用户在这个页面点过单项「填」之后，自动填充（3 秒补跑、网址变化补跑）不再整页填，
  // 免得刚只填了一项，又被自动填充把别的项目全填进来。刷新页面后恢复。
  let aya_manualOnly = false;
  // fresh：用户手动点"填充"时，忘掉这一页"已经试过"的记录，全部重新试一遍
  // auto：自动填充。正在跑别的填充时自动填充直接跳过；手动请求要等前一次跑完再跑自己的，
  // 不能直接拿前一次的结果（原来页面刚打开时点单项「填」，拿到的是整页自动填充的结果）
  const aya_fillOnce = async (overwrite, fresh, only, auto) => {
    if (auto && (aya_running || aya_manualOnly)) return 0;
    while (aya_running) { try { await aya_running; } catch (e) {} }
    if (auto && aya_manualOnly) return 0;
    // full：单项填写时把完整资料也交给引擎，只用来认出页面上已有的行是哪一条，
    // 免得把别的条目那一行当成这一条、盖掉它
    aya_running = (async () => {
      const raw = await aya_loadProfile();
      if (!raw) return 0;
      return window.AYA.fillForm(await aya_fillProfile(raw, only),
        { overwrite, fresh, scope: only ? only.type : null, full: only ? raw : null });
    })();
    try { return await aya_running; } finally { aya_running = null; }
  };

  const aya_runAuto = async () => {
    const { autoFillEnabled = true, overwriteFilled = false } = await chrome.storage.local.get(["autoFillEnabled", "overwriteFilled"]);
    if (!autoFillEnabled) return;
    if (!window.AYA || !window.AYA.looksLikeForm()) return;
    if (!(await aya_loadProfile())) return; // 还没导入资料
    const filled = await aya_fillOnce(overwriteFilled, false, null, true);
    if (!filled && aya_manualOnly) return;
    const missed = window.AYA.lastMissed || [];
    if (filled > 0 || missed.length) aya_toast(`校招投递助手 v${window.AYA.version || "?"}：已自动填充 ${filled} 个字段` + aya_missText(missed));
  };

  // document_idle 时跑一次；很多网申页面是 SPA，字段是异步渲染出来的，
  // 所以 3 秒后再补跑一次，只会填还没填过的空白字段，不会重复或冲突。
  aya_runAuto();
  setTimeout(aya_runAuto, 3000);

  // 单页应用点"下一步"不刷新页面（SmartRecruiters、Workday 都是这样），新的一页
  // 字段不会触发上面两次。只在网址变化时补跑——不监听 DOM 变化，免得用户刚
  // 清空的字段又被自动填回去。
  let aya_lastUrl = location.href;
  setInterval(() => {
    if (location.href === aya_lastUrl) return;
    aya_lastUrl = location.href;
    setTimeout(aya_runAuto, 1500);
    setTimeout(aya_runAuto, 4000);
  }, 1000);

  // 适配新网站用的诊断：在页面控制台跑 window.postMessage({ type: "AYA_DIAG" }, "*")，
  // 结果写到 document.documentElement.dataset.ayaDiag 并打印到控制台。
  // 只包含"控件被认成了什么字段"，不含任何个人信息——页面脚本也能读到这个属性，
  // 所以绝不能把 profile 里的值放进去。
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.type !== "AYA_DIAG") return;
    const report = window.AYA.diagnose((await aya_loadProfile()) || {});
    document.documentElement.dataset.ayaDiag = report;
    console.log("[校招投递助手] 诊断：\n" + report);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 弹窗点单项「填」前先问一句：旧版脚本不认识单项填写，会把整页都填了
    if (msg && msg.type === "AYA_PING") {
      sendResponse({ version: window.AYA && window.AYA.version, scoped: true });
      return false;
    }
    if (msg && msg.type === "AYA_FILL") {
      if (msg.only) aya_manualOnly = true;
      // 现在每个 iframe 里也有脚本（有的网申表单嵌在 iframe 里）。弹窗只收第一个
      // 回复：没有表单的子 frame 不回；主页面没有表单时晚一点回，让有表单的
      // iframe 先回，弹窗才不会显示"没找到"。
      const isForm = window.AYA.looksLikeForm();
      if (!isForm && window !== window.top) return false;
      Promise.all([chrome.storage.local.get("overwriteFilled"), aya_loadProfile()])
        .then(([{ overwriteFilled = false }, raw]) => {
          if (!raw) return -1;
          return isForm ? aya_fillOnce(overwriteFilled, true, msg.only || null) : new Promise(r => setTimeout(() => r(0), 1500));
        })
        .then(filled => sendResponse(filled === -1
          ? { filled: 0, missed: [], noProfile: true, version: window.AYA.version }
          : { filled, missed: isForm ? (window.AYA.lastMissed || []) : [], version: window.AYA.version }));
      return true; // 异步响应
    }
  });
}
