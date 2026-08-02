function clean(value = "") {
  return String(value).replace(/\r/g, "").trim();
}

function list(value = "") {
  return clean(value).split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function rewriteResumeLocally(profile = {}, target = {}) {
  const targetRole = clean(target.targetRole || profile.targetRoles || "目标岗位");
  const skills = unique(list(profile.skills)).slice(0, 8);
  const achievements = clean(profile.achievements);
  const original = clean(profile.resumeText);
  const years = Number(profile.yearsExperience);
  const experience = Number.isFinite(years) && years >= 0 ? `${years} 年` : "相关";
  const focusLabels = {
    results: "成果与业务结果",
    skills: "技能与专业能力",
    management: "管理与协作",
    transition: "转行可迁移能力"
  };

  const summaryParts = [`目标岗位：${targetRole}`, `${experience}工作经验`];
  if (skills.length) summaryParts.push(`核心能力：${skills.slice(0, 5).join("、")}`);

  const sections = [
    `求职目标\n${targetRole}`,
    `职业概况\n${summaryParts.slice(1).join("；")}。`
  ];
  if (skills.length) sections.push(`核心能力\n${skills.map((item) => `• ${item}`).join("\n")}`);
  if (achievements) sections.push(`代表成果\n${achievements}`);
  sections.push(`工作与项目经历\n${original}`);
  if (profile.education) sections.push(`教育背景\n${clean(profile.education)}`);
  if (profile.extraMaterials) sections.push(`补充材料\n${clean(profile.extraMaterials)}`);

  const changeNotes = [
    `把“${targetRole}”放在简历开头，帮助招聘方快速确认求职方向`,
    skills.length ? `将 ${skills.slice(0, 4).join("、")} 提前展示，减少关键信息被埋没` : "保留原始经历，未添加无法核验的技能",
    achievements ? "把已提供的代表成果独立成段，强化结果证据" : "暂未生成量化成果，避免编造数字",
    `本次表达重点：${focusLabels[target.focus] || focusLabels.results}`
  ];

  const missingEvidence = [];
  if (!achievements) missingEvidence.push("缺少可核验的成果、规模或效率数据，建议补充真实数字");
  if (!clean(target.jobDescription)) missingEvidence.push("未提供目标岗位 JD，当前只能按岗位名称进行通用重组");
  if (!skills.length) missingEvidence.push("核心技能尚未填写，无法针对岗位要求调整关键词顺序");
  if (!missingEvidence.length) missingEvidence.push("请逐句核对新版简历，确认所有描述均与真实经历一致");

  return {
    mode: "local",
    headline: `${targetRole}｜${skills.slice(0, 3).join(" · ") || "真实经历版"}`,
    professionalSummary: summaryParts.slice(1).join("；") + "。",
    rewrittenResume: sections.join("\n\n"),
    changeNotes,
    missingEvidence,
    rewrittenAt: new Date().toISOString(),
    disclaimer: "本地改写只重组用户提供的真实材料；请在投递前人工核对全部内容。"
  };
}

export function validateResumeRewrite(value) {
  if (!value || typeof value !== "object") return false;
  return ["headline", "professionalSummary", "rewrittenResume", "disclaimer"].every((key) => typeof value[key] === "string")
    && ["changeNotes", "missingEvidence"].every((key) => Array.isArray(value[key]));
}

export const resumeRewriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "professionalSummary", "rewrittenResume", "changeNotes", "missingEvidence", "disclaimer"],
  properties: {
    headline: { type: "string" },
    professionalSummary: { type: "string" },
    rewrittenResume: { type: "string" },
    changeNotes: { type: "array", items: { type: "string" } },
    missingEvidence: { type: "array", items: { type: "string" } },
    disclaimer: { type: "string" }
  }
};
