(async function () {
  const $ = (id) => document.getElementById(id);
  const S = window.AYA_STORE;
  const msg = (text, cls) => { $("msg").textContent = text; $("msg").className = cls || ""; };

  $("promptText").textContent = window.AYA_PROMPT;

  async function refresh() {
    const p = await S.load();
    $("state").textContent = p ? `已保存${p.name ? "（" + p.name + "）" : ""}` : "还没有资料";
    if (p) $("json").value = JSON.stringify(p, null, 2);
  }

  $("copyPrompt").onclick = async () => {
    await navigator.clipboard.writeText(window.AYA_PROMPT);
    $("copyPrompt").textContent = "已复制 ✓";
    setTimeout(() => ($("copyPrompt").textContent = "复制提示词"), 1500);
  };

  async function saveText(text) {
    let p;
    try { p = S.parse(text); }
    catch (e) { msg("没有保存：" + e.message, "bad"); return; }
    await S.save(p);
    const { summary, warn } = S.check(p);
    msg(`已保存：${summary}。` + (warn.length ? `\n请检查：\n· ${warn.join("\n· ")}` : ""), warn.length ? "warn" : "ok");
    await refresh();
  }

  $("save").onclick = () => saveText($("json").value);

  $("importFile").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const f = $("file").files[0];
    if (!f) return;
    const text = await f.text();
    $("json").value = text;
    await saveText(text);
    $("file").value = "";
  };

  $("download").onclick = async () => {
    const p = await S.load();
    if (!p) { msg("还没有保存的资料。", "warn"); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "my-profile.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $("example").onclick = async () => {
    const p = await S.load();
    if (p && !confirm("载入示例会替换掉你已保存的资料，确定吗？（可以先点「下载备份」）")) return;
    const text = await (await fetch(chrome.runtime.getURL("profile.example.json"))).text();
    $("json").value = text;
    await saveText(text);
  };

  $("clear").onclick = async () => {
    if (!confirm("确定清除保存在这个浏览器里的资料吗？（可以先点「下载备份」）")) return;
    await S.clear();
    $("json").value = "";
    msg("已清除。", "ok");
    await refresh();
  };

  await refresh();
})();
