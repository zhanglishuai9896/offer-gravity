import { createHash } from "node:crypto";

function split(value = "") {
  return String(value).split(/[，,、/\n]/).map((item) => item.trim()).filter(Boolean);
}

function textOf(item = {}) {
  return `${item.title || ""} ${item.company || item.publisher || ""} ${item.description || ""}`.toLowerCase();
}

function queueId(item) {
  return createHash("sha256").update(`${item.source}|${item.fingerprint || item.url || ""}|${item.title || ""}`).digest("hex").slice(0, 20);
}

export function buildApplicationGreeting(profile = {}, item = {}) {
  const name = String(profile.name || "").trim();
  const years = Number(profile.yearsExperience);
  const skills = split(profile.skills).slice(0, 3);
  const evidence = String(profile.achievements || "").split(/[。；;\n]/).map((part) => part.trim()).find(Boolean);
  const opening = `您好，我关注到贵司的${item.title || "这个岗位"}`;
  const experience = years > 0 ? `，我有 ${years} 年相关工作经验` : "";
  const skillText = skills.length ? `，主要能力包括${skills.join("、")}` : "";
  const evidenceText = evidence ? `。我曾${evidence.replace(/^我曾/, "")}` : "";
  return `${opening}${experience}${skillText}${evidenceText}。如果岗位仍在招聘，希望有机会进一步沟通。${name ? `——${name}` : ""}`.slice(0, 420);
}

export function buildApplicationQueue(profile = {}, opportunities = [], settings = {}, resumeRewrite = null) {
  const threshold = Math.max(50, Math.min(96, Number(settings.threshold) || 80));
  const dailyLimit = Math.max(1, Math.min(30, Number(settings.dailyLimit) || 10));
  const excluded = split(settings.excludedKeywords || profile.exclusions).map((item) => item.toLowerCase());
  const onlyBoss = settings.onlyBoss !== false;
  const selected = opportunities
    .filter((item) => !onlyBoss || item.source === "boss")
    .filter((item) => Number(item.match?.score || 0) >= threshold)
    .filter((item) => !item.expired)
    .filter((item) => !excluded.some((word) => word && textOf(item).includes(word)))
    .filter((item) => !(item.risks || []).some((risk) => /付费|过期|招聘主体不明确/.test(risk)))
    .sort((a, b) => Number(b.match?.score || 0) - Number(a.match?.score || 0))
    .slice(0, dailyLimit);

  return selected.map((item) => ({
    id: queueId(item), source: item.source, opportunityId: item.id || null,
    title: item.title || "未命名岗位", company: item.company || item.publisher || "公司未填写",
    url: item.applyUrl || item.url || "", score: Number(item.match?.score || 0),
    greeting: buildApplicationGreeting(profile, item),
    resumeText: resumeRewrite?.rewrittenResume || profile.resumeText || "",
    resumeMode: resumeRewrite?.rewrittenResume ? "targeted" : "profile",
    status: "ready_for_confirmation", createdAt: new Date().toISOString()
  }));
}
