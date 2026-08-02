function list(value = "") {
  return String(value).split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function analyzeCareerLocally(profile = {}) {
  const targetRoles = list(profile.targetRoles);
  const targetIndustries = list(profile.targetIndustries);
  const skills = list(profile.skills);
  const filled = [
    profile.currentRole, profile.currentIndustry, profile.yearsExperience, profile.education,
    profile.targetRoles, profile.targetIndustries, profile.city, profile.salary,
    profile.skills, profile.achievements, profile.resumeText
  ].filter((value) => String(value ?? "").trim()).length;
  const readinessScore = clamp(Math.round(filled / 11 * 78) + (skills.length >= 3 ? 8 : 0) + (String(profile.achievements || "").length >= 30 ? 8 : 0), 18, 94);

  const advantages = [];
  if (profile.yearsExperience !== "" && profile.yearsExperience !== undefined) advantages.push(`已有 ${profile.yearsExperience} 年工作经验，可用于建立岗位资历基线`);
  if (skills.length) advantages.push(`已经明确 ${skills.slice(0, 4).join("、")} 等可迁移能力`);
  if (String(profile.achievements || "").trim()) advantages.push("已提供成果信息，可以将简历从职责描述升级为结果表达");
  if (targetRoles.length) advantages.push(`目标岗位已聚焦到 ${targetRoles.slice(0, 3).join("、")}`);
  if (!advantages.length) advantages.push("已经开始系统梳理求职信息，这是建立有效策略的第一步");

  const gaps = [];
  if (!profile.currentRole) gaps.push("缺少当前／上一岗位，难以判断职业路径连续性");
  if (!targetIndustries.length) gaps.push("尚未确定目标行业，可以先选择 1—3 个行业测试市场反馈");
  if (!targetRoles.length) gaps.push("目标岗位过于模糊，需要先确定主投和备选方向");
  if (skills.length < 3) gaps.push("核心能力证据不足，建议补充至少 3 项技能及使用场景");
  if (String(profile.achievements || "").trim().length < 30) gaps.push("成果信息不够具体，建议补充数字、规模、效率或业务结果");
  if (!profile.salary) gaps.push("未填写期望薪资，暂时无法判断岗位筛选边界");
  if (!gaps.length) gaps.push("基础信息较完整，下一步需要用真实投递结果校准方向");

  const roleSuggestions = targetRoles.length
    ? targetRoles.slice(0, 5)
    : [profile.currentRole || "与当前经验相邻的岗位", "可迁移能力岗位", "成长型备选岗位"];
  const industrySuggestions = targetIndustries.length
    ? targetIndustries.slice(0, 5)
    : [profile.currentIndustry || "当前行业", "相邻产业", "对核心能力需求较高的行业"];

  const strategy = [
    `主投方向：${roleSuggestions[0]}；先用 60%—70% 的投递量验证最匹配方向`,
    roleSuggestions[1] ? `备选方向：${roleSuggestions[1]}；仅投硬条件基本满足且能力可迁移的岗位` : "建立一个与主方向相邻的备选岗位",
    "每 20 次投递复盘一次：分别检查岗位选择、简历表达、开场沟通和面试转化",
    "不同岗位只调整与 JD 直接相关的真实经历，不编造能力或项目"
  ];

  const nextSteps = [
    gaps[0],
    "选择 10 个真实岗位进行匹配分析，观察共性要求",
    "建立第一批投递队列，并在每次提交前确认材料版本",
    "一周后根据有效回复率调整行业、岗位和关键词"
  ];

  const grade = readinessScore >= 78 ? "可以开始精准投递" : readinessScore >= 55 ? "方向基本可用，需要补强" : "先完善定位与材料";
  return {
    mode: "local",
    readinessScore,
    grade,
    summary: `当前求职准备度为 ${readinessScore} 分。${grade}。重点不是增加海投数量，而是先把目标、证据和投递反馈连接起来。`,
    advantages: advantages.slice(0, 5),
    gaps: gaps.slice(0, 6),
    roleSuggestions,
    industrySuggestions,
    strategy,
    nextSteps,
    analyzedAt: new Date().toISOString(),
    disclaimer: "职业分析仅供求职决策参考，不构成录用、薪资或职业结果保证。"
  };
}

export function validateCareerAnalysis(value) {
  if (!value || typeof value !== "object") return false;
  if (!Number.isFinite(value.readinessScore) || value.readinessScore < 0 || value.readinessScore > 100) return false;
  return ["advantages", "gaps", "roleSuggestions", "industrySuggestions", "strategy", "nextSteps"].every((key) => Array.isArray(value[key]));
}

export const careerAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["readinessScore", "grade", "summary", "advantages", "gaps", "roleSuggestions", "industrySuggestions", "strategy", "nextSteps", "disclaimer"],
  properties: {
    readinessScore: { type: "number", minimum: 0, maximum: 100 },
    grade: { type: "string" },
    summary: { type: "string" },
    advantages: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    roleSuggestions: { type: "array", items: { type: "string" } },
    industrySuggestions: { type: "array", items: { type: "string" } },
    strategy: { type: "array", items: { type: "string" } },
    nextSteps: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" }
  }
};
