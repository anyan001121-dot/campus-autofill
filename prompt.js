// 给 AI（ChatGPT、Claude、Kimi、豆包、DeepSeek 等）用的简历解析提示词。
// 资料管理页的「复制提示词」按钮复制的就是这一段；AI解析提示词.md 由它生成（node tools/make-prompt-md.js）。
(function () {
  const PROMPT = `你是简历信息整理助手。请把我在后面提供的简历（以及我补充的个人信息）整理成一个 JSON，供浏览器插件“校招投递助手”自动填写网申表单。

## 规则（务必遵守）
1. 只使用我提供的信息。简历里没有的内容，字符串写 ""，数组写 []，不要猜测、不要编造、不要“合理补全”。
2. 不要写身份证号、护照号、银行卡号、密码等证件或账户信息，即使简历里有也不要写。
3. 经历类长文字（项目、实习、组织经历）保留原文的全部信息，不要缩短、不要概括、不要加入简历里没有的数字或成果。
   - 按意思拆成四段，每段以对应的小标题开头：
     core_result 以“【背景与任务】”开头，responsibilities 以“【个人职责】”开头，
     task_action 以“【任务与行动】”开头，insight 以“【项目成果】”开头。
   - 原文没有某一段的内容，就写 ""。
4. 年、月、日都写成字符串，例如 "2024"、"9"、"15"（月和日不补零）。还在进行中的经历写 "ongoing": true，不写结束年月。
5. education_entries、project_entries、honors 等列表按时间从新到旧排列。education_entries 的第一条是最高学历。
6. 奖项 level 只能填 "国家级"、"省市级"、"校级"、"其他" 之一；type 只能填 "竞赛"、"奖学金"、"其他" 之一。
7. internship_entries 放全部实习/工作经历，每段一条，按时间从新到旧排列；没有实习写 []。
8. 只输出 JSON 本身，放在一个 \`\`\`json 代码块里，不要写注释，不要在 JSON 前后写解释。

## JSON 格式（下面的值是说明，请替换成真实内容）
\`\`\`json
{
  "name": "中文姓名",
  "name_en": "英文名/拼音，如 Xiao Lin",
  "last_name": "姓",
  "first_name": "名",
  "phone": "手机号，纯数字",
  "phone_display": "便于阅读的写法，如 138 0013 8000",
  "email": "邮箱",
  "wechat": "微信号；与手机号相同写“同手机号”",
  "portfolio": "作品集/个人网站链接",
  "github": "GitHub 链接",
  "job_direction": "求职方向，如 数据分析",
  "gender": "男 或 女",
  "birth_date": "YYYY-MM-DD",
  "birth_date_cn": "YYYY年M月D日",
  "birth_year": "YYYY",
  "birth_month": "M",
  "birth_day": "D",
  "native_place": "籍贯，如 湖北武汉",
  "ethnicity": "民族，如 汉族",
  "political_status": "政治面貌，如 共青团员 / 中共党员 / 群众",
  "nationality": "国籍，如 中国",
  "current_city": "现居城市",
  "current_city_en": "现居城市英文",
  "expected_city": "期望城市",
  "expected_salary": "期望薪资",
  "available_date": "可入职时间",
  "work_experience_level": "应届生 / 1-3年 等",
  "education": {
    "highest_school": "最高学历学校",
    "highest_degree": "最高学历：博士/硕士/本科/大专",
    "highest_major": "最高学历专业"
  },
  "education_entries": [
    {
      "school": "学校中文名",
      "school_en": "学校英文名",
      "overseas": false,
      "college": "学院",
      "major": "专业",
      "degree": "博士 / 硕士 / 学士 / 大专",
      "study_mode": "全日制 / 非全日制",
      "rank": "成绩排名，如 前10%；没有写 \\"\\"",
      "city": "学校所在城市",
      "start_year": "", "start_month": "", "start_day": "",
      "end_year": "", "end_month": "", "end_day": ""
    }
  ],
  "english_level": "英语水平一句话，如 IELTS 7.0 / CET-6 560",
  "language_entries": [
    {
      "type": "语种，如 英语",
      "level": "精通 / 熟练 / 良好 / 一般",
      "listening_speaking": "听说能力，同上四档",
      "reading_writing": "读写能力，同上四档",
      "cert": "证书与分数，如 IELTS 7.0"
    }
  ],
  "certificates": [],
  "skills_short": "技能一行版",
  "skills_ai": "AI 工具使用能力一句话（没有写 \\"\\"）",
  "self_intro_short": "自我介绍短版（约 50 字）",
  "self_intro_long": "自我介绍长版（约 150-300 字）",
  "specialty": "特长",
  "hobbies": "兴趣爱好",
  "internship_entries": [
    {
      "company": "公司全称",
      "dept": "部门",
      "title": "职位",
      "period": "YYYY.MM - YYYY.MM",
      "start_year": "", "start_month": "", "end_year": "", "end_month": "",
      "ongoing": false,
      "one_liner": "一句话概括（用原文）",
      "core_result": "【背景与任务】……",
      "responsibilities": "【个人职责】……",
      "task_action": "【任务与行动】……",
      "insight": "【项目成果】……"
    }
  ],
  "project_entries": [
    {
      "name": "项目名称",
      "role_short": "角色，如 个人项目 / 队长 / 负责人",
      "start_year": "", "start_month": "", "end_year": "", "end_month": "",
      "ongoing": false,
      "core_result": "【背景与任务】……",
      "responsibilities": "【个人职责】……",
      "task_action": "【任务与行动】……",
      "insight": "【项目成果】……"
    }
  ],
  "campus_entries": [
    {
      "name": "组织/社团名称",
      "role": "职务",
      "start_year": "", "start_month": "", "end_year": "", "end_month": "",
      "core_result": "【背景与任务】……",
      "responsibilities": "【个人职责】……",
      "task_action": "【任务与行动】……",
      "insight": "【项目成果】……"
    }
  ],
  "organizations": "组织经历一段话版，如 学生会学习部｜部长（2022.09-2023.06）",
  "honors": [
    {
      "name": "奖项/竞赛名称（不含等级）",
      "award": "获奖等级，如 一等奖 / 二等奖学金",
      "year": "", "month": "",
      "date_cn": "YYYY年M月",
      "level": "国家级 / 省市级 / 校级 / 其他",
      "type": "竞赛 / 奖学金 / 其他",
      "issuer": "颁奖单位；简历里没有写 \\"\\""
    }
  ],
  "honors_text": "所有奖项一段话，用；分隔",
  "ip_entries": []
}
\`\`\`

## 可选：按投递方向挑项目
如果我说明了不同的投递方向（例如数据分析、产品经理），请加上：
- "track_names": {"data": "数据分析", "pm": "产品经理"}（键用简短英文）
- "job_direction_by_track": {"data": "数据分析", "pm": "产品经理"}
- 每个项目加 "tracks": {"data": 1, "pm": 3}，表示它属于哪些方向、在该方向里排第几（1 最靠前）。
没有说明就不要加这三项。

## 我的简历和补充信息
（把简历全文粘贴在这里；也可以直接上传简历 PDF / Word 文件。补充信息如籍贯、民族、政治面貌、期望城市等可以写在这里。）
`;
  if (typeof window !== "undefined") window.AYA_PROMPT = PROMPT;
  if (typeof module !== "undefined") module.exports = PROMPT;
})();
