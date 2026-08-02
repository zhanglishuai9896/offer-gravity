function number(value, fallback = 3) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, parsed)) : fallback;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function split(value = "") {
  return String(value).split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean);
}

export function analyzePersonalityLocally(profile = {}, answers = {}) {
  const scores = {
    collaboration: Math.round((number(answers.peopleEnergy) + number(answers.communication)) / 2 * 20),
    structure: Math.round((number(answers.structure) + number(answers.planning)) / 2 * 20),
    exploration: Math.round((number(answers.novelty) + (6 - number(answers.routine))) / 2 * 20),
    pace: Math.round((number(answers.pace) + number(answers.changeTolerance)) / 2 * 20),
    detail: Math.round((number(answers.detail) + number(answers.accuracy)) / 2 * 20),
    autonomy: Math.round((number(answers.autonomy) + (6 - number(answers.supervision))) / 2 * 20)
  };

  const high = (key) => scores[key] >= 64;
  let archetype = "平衡适应型";
  if (high("autonomy") && high("detail")) archetype = "独立深耕型";
  else if (high("collaboration") && high("pace")) archetype = "协作推动型";
  else if (high("structure") && high("detail")) archetype = "结构执行型";
  else if (high("exploration") && high("autonomy")) archetype = "探索创造型";
  else if (high("collaboration") && high("structure")) archetype = "组织协调型";

  const roleFamilies = [];
  if (high("collaboration")) roleFamilies.push("销售／商务拓展", "客户成功／顾问", "招聘／员工关系", "项目协调");
  else roleFamilies.push("数据分析／研究", "开发／工程", "财务分析", "设计与专业创作");
  if (high("structure")) roleFamilies.push("项目管理", "供应链／采购", "运营管理", "质量／合规");
  else roleFamilies.push("产品策划", "品牌／内容", "策略研究", "创新业务");
  if (high("detail")) roleFamilies.push("审计／风控", "质量管理", "数据运营");
  if (high("pace")) roleFamilies.push("增长运营", "创业团队综合岗位");

  const targets = split(profile.targetRoles).slice(0, 2);
  const recommendedRoles = unique([...targets, ...roleFamilies]).slice(0, 8);
  const suitableEnvironments = [
    high("autonomy") ? "目标清楚、过程自主，允许个人安排方法和节奏" : "职责明确、反馈及时，有稳定协作和带教支持",
    high("structure") ? "流程、职责与评价标准相对清晰的团队" : "允许试错、可以从模糊问题中建立方法的团队",
    high("collaboration") ? "需要跨部门推动、沟通和建立关系的工作" : "拥有连续专注时间、减少无效会议和高频社交的工作",
    high("pace") ? "变化较快、任务切换和即时反馈较多的环境" : "节奏稳定、能长期积累专业能力的环境"
  ];
  const avoidEnvironments = [
    high("autonomy") ? "事无巨细被监督、缺少决策空间的岗位" : "完全无人支持、边界长期模糊的岗位",
    high("detail") ? "长期只追求速度、忽视质量标准的团队" : "重复核对占比极高、容错率极低的岗位",
    high("collaboration") ? "长期独自工作且几乎没有反馈的环境" : "全天高频陌生沟通、持续情绪劳动的环境"
  ];
  const dimensions = [
    { label: "协作互动", score: scores.collaboration },
    { label: "结构秩序", score: scores.structure },
    { label: "探索变化", score: scores.exploration },
    { label: "工作节奏", score: scores.pace },
    { label: "细节质量", score: scores.detail },
    { label: "自主空间", score: scores.autonomy }
  ];
  const summary = `${archetype}并不代表你只能从事某一种职业。它说明你更可能在${suitableEnvironments.slice(0, 2).join("、")}中保持投入；最终岗位仍应同时核对真实技能、经历和机会条件。`;

  return {
    mode: "local",
    archetype,
    summary,
    dimensions,
    suitableEnvironments,
    recommendedRoles,
    avoidEnvironments,
    interviewTips: [
      `面试时主动询问：这个岗位的成功标准、决策权限和日常协作方式是什么？`,
      `请招聘方描述一个典型工作周，用真实任务判断环境是否符合你的工作偏好。`,
      `不要只凭职位名称决定；把性格画像与岗位职责、团队阶段和管理方式一起判断。`
    ],
    analyzedAt: new Date().toISOString(),
    disclaimer: "这是工作偏好分析，不是临床心理测评，也不能单独决定职业选择。"
  };
}

export function validatePersonalityAnalysis(value) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.archetype !== "string" || typeof value.summary !== "string") return false;
  if (!Array.isArray(value.dimensions) || value.dimensions.length !== 6) return false;
  return ["suitableEnvironments", "recommendedRoles", "avoidEnvironments", "interviewTips"].every((key) => Array.isArray(value[key]));
}
