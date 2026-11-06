// 从 prompt.js 生成 AI解析提示词.md（改了提示词后跑一次：node tools/make-prompt-md.js）
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const prompt = require(path.join(root, "prompt.js"));
const md = "# AI 解析提示词\n\n把下面整段复制给任意 AI（ChatGPT、Claude、Kimi、豆包、DeepSeek 等），在最后贴上你的简历，" +
  "把它返回的 JSON 粘贴到插件的「资料管理」页保存即可。插件「资料管理」页的「复制提示词」按钮复制的也是这一段。\n\n" +
  "````text\n" + prompt + "````\n";
fs.writeFileSync(path.join(root, "AI解析提示词.md"), md);
console.log("已生成 AI解析提示词.md");
