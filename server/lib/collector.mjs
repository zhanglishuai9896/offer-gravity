import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;

function cleanText(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(...values) {
  return values.map(cleanText).find(Boolean) || "";
}

function normalizeSalary(value) {
  if (!value) return "";
  if (typeof value === "string") return cleanText(value);
  const min = value.minValue ?? value.min;
  const max = value.maxValue ?? value.max;
  const currency = value.currency || "";
  const unit = value.unitText || value.interval || "";
  if (min == null && max == null) return "";
  return `${currency} ${min ?? ""}${max != null ? `–${max}` : ""}${unit ? ` / ${unit}` : ""}`.trim();
}

function locationText(value) {
  if (!value) return "";
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => {
    const address = item?.address || item || {};
    return [address.addressCountry, address.addressRegion, address.addressLocality, address.streetAddress]
      .filter(Boolean).join(" ");
  }).filter(Boolean).join(" / ");
}

export function opportunityFingerprint(job = {}) {
  const stable = [job.source || "", job.externalId || "", job.company || "", job.title || "", job.location || "", job.url || ""]
    .map((item) => cleanText(item).toLowerCase()).join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 24);
}

export function normalizeOpportunity(job = {}) {
  const normalized = {
    source: cleanText(job.source || "official"),
    externalId: cleanText(job.externalId),
    title: cleanText(job.title) || "未命名岗位",
    company: cleanText(job.company),
    publisher: cleanText(job.publisher || job.company),
    location: cleanText(job.location),
    salary: cleanText(job.salary),
    employmentType: cleanText(job.employmentType),
    workplaceType: cleanText(job.workplaceType),
    datePosted: job.datePosted || null,
    validThrough: job.validThrough || null,
    description: cleanText(job.description).slice(0, 40_000),
    url: cleanText(job.url),
    applyUrl: cleanText(job.applyUrl || job.url),
    collectedAt: new Date().toISOString()
  };
  normalized.expired = Boolean(normalized.validThrough && new Date(normalized.validThrough).getTime() < Date.now());
  normalized.fingerprint = opportunityFingerprint(normalized);
  normalized.risks = detectOpportunityRisks(normalized);
  return normalized;
}

export function detectOpportunityRisks(job = {}) {
  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const risks = [];
  if (!job.company && !job.publisher) risks.push("招聘主体不明确");
  if (!job.url && !job.applyUrl) risks.push("缺少可核验的原始链接");
  if (!job.description || cleanText(job.description).length < 60) risks.push("职位信息不完整");
  if (/押金|培训费|入职费|保证金|付费上岗|先交费/.test(text)) risks.push("疑似要求求职者付费");
  if (/加微信|私聊微信|扫码咨询|高薪日结|无需经验.*日入/.test(text)) risks.push("存在引流或夸大宣传特征");
  if (job.expired) risks.push("职位可能已经过期");
  return risks;
}

export function dedupeOpportunities(items = []) {
  const seen = new Set();
  return items.map(normalizeOpportunity).filter((item) => {
    if (item.expired || seen.has(item.fingerprint)) return false;
    seen.add(item.fingerprint);
    return true;
  });
}

function isPrivateIp(address) {
  if (!net.isIP(address)) return true;
  if (address === "::1" || address === "0.0.0.0" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export async function assertPublicUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("请输入有效的公开网页地址"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("只允许采集 HTTP 或 HTTPS 公开网页");
  if (url.username || url.password) throw new Error("网页地址不能包含账号密码");
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((item) => isPrivateIp(item.address))) throw new Error("不允许访问本机或内网地址");
  return url;
}

async function fetchPublicText(rawUrl) {
  let current = await assertPublicUrl(rawUrl);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "OfferIndex/1.0 (+public-job-feed; contact=owner)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("招聘页重定向地址无效");
      current = await assertPublicUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error(`公开招聘源返回 ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) return { text: await response.text(), url: current.href };
    let size = 0;
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("招聘源内容超过 2MB 限制");
      chunks.push(value);
    }
    return { text: new TextDecoder().decode(Buffer.concat(chunks)), url: current.href };
  }
  throw new Error("招聘页重定向次数过多");
}

export async function robotsAllows(rawUrl) {
  const target = await assertPublicUrl(rawUrl);
  const robotsUrl = new URL("/robots.txt", target);
  try {
    const response = await fetch(robotsUrl, {
      redirect: "error",
      headers: { "User-Agent": "OfferIndex/1.0 (+public-job-feed; contact=owner)" },
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return true;
    const text = (await response.text()).slice(0, 200_000);
    let applies = false;
    const rules = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      if (!line) continue;
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === "user-agent") applies = value === "*" || value.toLowerCase() === "offerindex";
      else if (applies && (key === "allow" || key === "disallow") && value) rules.push({ type: key, path: value });
    }
    const matching = rules.filter((rule) => target.pathname.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length);
    return !matching.length || matching[0].type === "allow";
  } catch {
    return true;
  }
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value["@graph"])) return [value, ...value["@graph"].flatMap(flattenJsonLd)];
  return [value];
}

export function parseJobPostingHtml(html, pageUrl) {
  const scripts = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const entries = [];
  for (const match of scripts) {
    try { entries.push(...flattenJsonLd(JSON.parse(match[1]))); } catch {}
  }
  const jobs = entries.filter((item) => {
    const type = item?.["@type"];
    return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
  }).map((item) => normalizeOpportunity({
    source: "official",
    externalId: item.identifier?.value || item.identifier || "",
    title: item.title,
    company: item.hiringOrganization?.name,
    location: locationText(item.jobLocation) || item.applicantLocationRequirements?.name,
    salary: normalizeSalary(item.baseSalary?.value || item.baseSalary),
    employmentType: Array.isArray(item.employmentType) ? item.employmentType.join(" / ") : item.employmentType,
    workplaceType: item.jobLocationType,
    datePosted: item.datePosted,
    validThrough: item.validThrough,
    description: item.description,
    url: item.url || pageUrl,
    applyUrl: item.url || pageUrl
  }));
  if (jobs.length) return dedupeOpportunities(jobs);

  const title = firstText(
    String(html).match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1],
    String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  );
  const description = firstText(
    String(html).match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i)?.[1],
    html
  );
  return [normalizeOpportunity({ source: "official", title, description, url: pageUrl })];
}

async function collectOfficial(target) {
  if (!await robotsAllows(target)) throw new Error("该网站的 robots.txt 不允许自动读取此招聘页面");
  const { text, url } = await fetchPublicText(target);
  return parseJobPostingHtml(text, url);
}

async function collectGreenhouse(boardToken) {
  if (!/^[a-zA-Z0-9_-]{2,100}$/.test(boardToken)) throw new Error("Greenhouse Board Token 格式无效");
  const { text } = await fetchPublicText(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`);
  const payload = JSON.parse(text);
  return dedupeOpportunities((payload.jobs || []).map((job) => ({
    source: "greenhouse", externalId: job.id, title: job.title, company: payload.name || boardToken,
    location: job.location?.name, datePosted: job.updated_at, description: job.content,
    url: job.absolute_url, applyUrl: job.absolute_url
  })));
}

async function collectLever(site) {
  if (!/^[a-zA-Z0-9_-]{2,100}$/.test(site)) throw new Error("Lever Site 名称格式无效");
  const { text } = await fetchPublicText(`https://api.lever.co/v0/postings/${site}?mode=json`);
  const payload = JSON.parse(text);
  return dedupeOpportunities((Array.isArray(payload) ? payload : []).map((job) => ({
    source: "lever", externalId: job.id, title: job.text, company: site,
    location: job.categories?.location, employmentType: job.categories?.commitment,
    workplaceType: job.workplaceType, salary: job.salaryDescription || normalizeSalary(job.salaryRange),
    description: job.descriptionPlain || job.description, url: job.hostedUrl, applyUrl: job.applyUrl
  })));
}

export async function collectOpportunities({ type, target, limit = 50 } = {}) {
  if (!target || !String(target).trim()) throw new Error("请填写公开招聘源地址或标识");
  let jobs;
  if (type === "greenhouse") jobs = await collectGreenhouse(String(target).trim());
  else if (type === "lever") jobs = await collectLever(String(target).trim());
  else if (type === "official") jobs = await collectOfficial(String(target).trim());
  else throw new Error("暂不支持这个采集来源");
  return dedupeOpportunities(jobs).slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
}
