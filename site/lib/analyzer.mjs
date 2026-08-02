const STOP_WORDS = new Set([
  "负责", "相关", "具备", "能够", "以及", "进行", "工作", "岗位", "要求", "优先",
  "熟悉", "掌握", "良好", "以上", "经验", "能力", "设计", "公司", "团队", "项目",
  "我们", "需要", "可以", "一个", "具有", "完成", "协作", "理解", "使用", "参与"
]);

const SKILL_WORDS = [
  "品牌", "视觉", "电商", "平面", "包装", "字体", "插画", "摄影", "视频", "动效",
  "三维", "3d", "ui", "ux", "figma", "photoshop", "illustrator", "indesign",
  "c4d", "blender", "ai", "aigc", "midjourney", "运营", "营销", "提案", "策略",
  "物料", "详情页", "主图", "海报", "画册", "vi", "品牌升级", "用户研究",
  "销售", "商务", "渠道", "客户", "客服", "采购", "供应链", "物流", "仓储", "生产",
  "制造", "质量", "工程", "机械", "电气", "建筑", "施工", "财务", "会计", "审计",
  "税务", "金融", "投研", "风控", "银行", "保险", "法务", "法律", "合规", "人力资源",
  "招聘", "薪酬", "行政", "教育", "教学", "课程", "医疗", "护理", "医药", "研发",
  "实验", "产品", "数据", "算法", "前端", "后端", "java", "python", "sql", "云计算",
  "项目管理", "市场", "内容", "新媒体", "直播", "短视频", "文案", "翻译", "咨询"
];

function normalize(text = "") {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractKeywords(text) {
  const source = normalize(text);
  const skills = SKILL_WORDS.filter((word) => source.includes(word));
  const latin = source.match(/[a-z][a-z0-9+.#-]{1,20}/g) || [];
  return unique([...skills, ...latin.filter((word) => !STOP_WORDS.has(word))]).slice(0, 60);
}

function extractYears(text) {
  const values = [...normalize(text).matchAll(/(\d+)\s*(?:年|年以上)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => value >= 0 && value <= 30);
  return values.length ? Math.max(...values) : null;
}

function extractCandidateYears(profile) {
  const explicit = Number(profile.yearsExperience);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return extractYears(profile.resumeText);
}

function educationRequirement(text) {
  const source = normalize(text);
  if (source.includes("硕士") || source.includes("研究生")) return "硕士及以上";
  if (source.includes("本科")) return "本科及以上";
  if (source.includes("大专") || source.includes("专科")) return "大专及以上";
  return "未明确";
}

function candidateEducation(text) {
  const source = normalize(text);
  if (source.includes("硕士") || source.includes("研究生")) return "硕士";
  if (source.includes("本科")) return "本科";
  if (source.includes("大专") || source.includes("专科")) return "大专";
  return "未填写";
}

function educationRank(value) {
  if (value.includes("硕士")) return 3;
  if (value.includes("本科")) return 2;
  if (value.includes("大专")) return 1;
  return 0;
}

function includesAny(text, values) {
  const source = normalize(text);
  return values.some((value) => value && source.includes(normalize(value)));
}

function clip(text, max = 22) {
  const clean = String(text || "").replace(/\s+/g, "").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function buildGreeting(profile, job, matchedKeywords) {
  const role = job.title || profile.targetRoles || "该岗位";
  const evidence = matchedKeywords.length
    ? `在${matchedKeywords.slice(0, 3).join("、")}方面有真实项目经验`
    : "具备相关工作或项目经验";
  return `您好，我关注到贵司的${role}岗位。我有${profile.yearsExperience || "多"}年相关经验，${evidence}，简历中有对应经历。如果岗位仍在招聘，希望有机会进一步沟通。`;
}

export function analyzeLocally(profile = {}, job = {}) {
  const resume = normalize(`${profile.resumeText || ""} ${profile.skills || ""} ${profile.achievements || ""} ${profile.extraMaterials || profile.portfolioSummary || ""}`);
  const jd = normalize(`${job.industry || ""} ${job.title || ""} ${job.description || ""}`);
  const jdKeywords = extractKeywords(jd);
  const matched = jdKeywords.filter((word) => resume.includes(word)).slice(0, 10);
  const missing = jdKeywords.filter((word) => !resume.includes(word)).slice(0, 8);
  const targetRoles = String(profile.targetRoles || "").split(/[，,、/\n]/).map((v) => v.trim()).filter(Boolean);
  const roleMatch = !targetRoles.length || includesAny(job.title, targetRoles) || includesAny(profile.targetRoles, [job.title]);
  const requiredYears = extractYears(jd);
  const actualYears = extractCandidateYears(profile);
  const yearsOk = requiredYears === null || actualYears === null || actualYears >= Math.max(0, requiredYears - 1);
  const requiredEducation = educationRequirement(jd);
  const actualEducation = candidateEducation(profile.resumeText);
  const educationOk = requiredEducation === "未明确" || actualEducation === "未填写" || educationRank(actualEducation) >= educationRank(requiredEducation);
  const locationOk = !profile.city || !job.location || normalize(job.location).includes(normalize(profile.city)) || normalize(profile.city).includes(normalize(job.location));

  const keywordRate = jdKeywords.length ? matched.length / Math.min(jdKeywords.length, 16) : 0.45;
  let score = 35 + Math.round(Math.min(1, keywordRate) * 40);
  score += roleMatch ? 10 : -12;
  score += yearsOk ? 7 : -15;
  score += educationOk ? 4 : -10;
  score += locationOk ? 4 : -8;
  score = Math.max(12, Math.min(94, score));

  const recommendation = score >= 72 ? "A 优先投" : score >= 50 ? "B 谨慎投" : "C 不建议投";
  const strengths = matched.length
    ? matched.slice(0, 4).map((word) => `材料中有“${word}”相关经历，可对应岗位的核心要求`)
    : ["目前材料与职位描述的直接关键词重合较少，需要先补充真实项目证据"];
  const gaps = [];
  if (!roleMatch) gaps.push("岗位名称与当前目标方向不完全一致，需要确认是否接受方向变化");
  if (!yearsOk) gaps.push(`岗位可能要求约 ${requiredYears} 年经验，目前填写为 ${actualYears ?? "未知"} 年`);
  if (!educationOk) gaps.push(`岗位可能要求${requiredEducation}，当前材料识别为${actualEducation}`);
  if (!locationOk) gaps.push(`目标城市为${profile.city}，岗位地点为${job.location}`);
  missing.slice(0, 4).forEach((word) => gaps.push(`材料中暂未找到“${word}”的直接证据`));
  if (!gaps.length) gaps.push("未发现明显硬性缺口，仍需人工确认公司与岗位真实性");

  const resumeSuggestions = matched.slice(0, 3).map((word) => `把与“${word}”有关的真实项目放到更靠前位置，并补充职责、动作与结果`);
  if (!resumeSuggestions.length) resumeSuggestions.push("先补充 2—3 个与岗位最接近的真实项目，再进行针对性投递");
  resumeSuggestions.push("把最相关的经历放到材料前部，避免让招聘方自行寻找匹配点");

  const hardConditions = [
    {
      label: "工作年限",
      requirement: requiredYears === null ? "未明确" : `${requiredYears} 年左右`,
      candidate: actualYears === null ? "未填写" : `${actualYears} 年`,
      verdict: requiredYears === null || actualYears === null ? "待确认" : yearsOk ? "满足" : "有风险"
    },
    {
      label: "学历",
      requirement: requiredEducation,
      candidate: actualEducation,
      verdict: requiredEducation === "未明确" || actualEducation === "未填写" ? "待确认" : educationOk ? "满足" : "不满足"
    },
    {
      label: "地点",
      requirement: job.location || "未填写",
      candidate: profile.city || "未填写",
      verdict: !job.location || !profile.city ? "待确认" : locationOk ? "满足" : "有风险"
    }
  ];

  const summary = recommendation.startsWith("A")
    ? `岗位与当前材料存在较明确的匹配证据，建议针对性调整后尽快投递。`
    : recommendation.startsWith("B")
      ? `岗位有可尝试的匹配点，但存在需要人工确认或补强的条件。`
      : `当前材料与岗位要求差距较大，继续投入时间的性价比可能不高。`;

  return {
    mode: "local",
    score,
    recommendation,
    summary,
    hardConditions,
    strengths,
    gaps: gaps.slice(0, 6),
    resumeSuggestions: resumeSuggestions.slice(0, 5),
    greeting: buildGreeting(profile, job, matched),
    nextAction: recommendation.startsWith("A") ? "调整材料后投递" : recommendation.startsWith("B") ? "补充信息后决定" : "暂时跳过",
    matchedKeywords: matched.slice(0, 12),
    analyzedAt: new Date().toISOString(),
    disclaimer: "本地规则分析仅供求职决策参考，请人工核对岗位信息与所有生成内容。"
  };
}

export function validateAnalysis(value) {
  if (!value || typeof value !== "object") return false;
  if (!Number.isFinite(value.score) || value.score < 0 || value.score > 100) return false;
  if (!["A 优先投", "B 谨慎投", "C 不建议投"].includes(value.recommendation)) return false;
  return ["hardConditions", "strengths", "gaps", "resumeSuggestions"].every((key) => Array.isArray(value[key]));
}

export const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "recommendation", "summary", "hardConditions", "strengths", "gaps", "resumeSuggestions", "greeting", "nextAction", "matchedKeywords", "disclaimer"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 100 },
    recommendation: { type: "string", enum: ["A 优先投", "B 谨慎投", "C 不建议投"] },
    summary: { type: "string" },
    hardConditions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "requirement", "candidate", "verdict"],
        properties: {
          label: { type: "string" },
          requirement: { type: "string" },
          candidate: { type: "string" },
          verdict: { type: "string", enum: ["满足", "待确认", "有风险", "不满足"] }
        }
      }
    },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    resumeSuggestions: { type: "array", items: { type: "string" } },
    greeting: { type: "string" },
    nextAction: { type: "string" },
    matchedKeywords: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" }
  }
};
