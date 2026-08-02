function normalize(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function split(value = "") {
  return String(value).split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export function buildRadarKeywords(profile = {}, personalityAnalysis = null) {
  return unique([
    ...split(profile.targetRoles),
    ...split(profile.targetIndustries),
    ...split(profile.skills).slice(0, 5),
    ...(personalityAnalysis?.recommendedRoles || []).slice(0, 4)
  ]).slice(0, 16);
}

export function matchOpportunityLocally(profile = {}, personalityAnalysis = null, opportunity = {}) {
  const keywords = buildRadarKeywords(profile, personalityAnalysis);
  const source = normalize(`${opportunity.title || ""} ${opportunity.publisher || ""} ${opportunity.description || ""}`);
  const roles = split(profile.targetRoles);
  const industries = split(profile.targetIndustries);
  const cities = split(profile.city);
  const matched = keywords.filter((word) => source.includes(normalize(word)));
  const roleMatched = roles.filter((word) => source.includes(normalize(word)));
  const industryMatched = industries.filter((word) => source.includes(normalize(word)));
  const cityMatched = cities.filter((word) => source.includes(normalize(word)));

  let score = 32;
  score += Math.min(28, matched.length * 7);
  if (roleMatched.length) score += 20;
  if (industryMatched.length) score += 8;
  if (cityMatched.length) score += 8;
  if (!roles.length) score += 5;
  score = Math.max(15, Math.min(96, score));

  const label = score >= 72 ? "高匹配提醒" : score >= 52 ? "可以关注" : "低优先级";
  const reasons = [];
  if (roleMatched.length) reasons.push(`岗位方向命中：${roleMatched.slice(0, 2).join("、")}`);
  if (matched.length) reasons.push(`内容中出现你的关键词：${matched.slice(0, 5).join("、")}`);
  if (cityMatched.length) reasons.push(`地点与目标城市匹配：${cityMatched.join("、")}`);
  if (!reasons.length) reasons.push("目前与目标岗位、技能和城市的直接证据较少");
  reasons.push("社交平台发布的信息需核实招聘主体、职位真实性和申请方式");

  return { score, label, matchedKeywords: matched, reasons, matchedAt: new Date().toISOString() };
}
