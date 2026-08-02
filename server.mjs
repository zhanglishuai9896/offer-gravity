import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { analyzeLocally, analysisSchema, validateAnalysis } from "./lib/analyzer.mjs";
import { analyzeCareerLocally, careerAnalysisSchema, validateCareerAnalysis } from "./lib/career.mjs";
import { rewriteResumeLocally, resumeRewriteSchema, validateResumeRewrite } from "./lib/resume.mjs";
import { analyzePersonalityLocally } from "./lib/personality.mjs";
import { matchOpportunityLocally } from "./lib/opportunity.mjs";
import { collectOpportunities } from "./lib/collector.mjs";
import { bearerToken, CommercialStore, PLANS, publicAccount } from "./lib/commercial.mjs";
import { analyzeOutcomes } from "./lib/outcomes.mjs";
import { buildApplicationQueue } from "./lib/application-queue.mjs";
import { analyzeMbti } from "./lib/mbti.mjs";
import { extractResumeLocally } from "./lib/resume-parser.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC = join(ROOT, "public");
loadDotEnv(join(ROOT, ".env"));

const PORT = Number(process.env.PORT) || 4173;
const API_KEY = process.env.OPENAI_API_KEY?.trim();
const MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra";
const MAX_BODY = 12_000_000;
const COMMERCIAL_MODE = process.env.COMMERCIAL_MODE === "1";
const ALLOW_DEMO_BILLING = process.env.ALLOW_DEMO_BILLING === "1";
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER?.trim() || "unconfigured";
const PAYMENT_CHECKOUT_ENDPOINT = process.env.PAYMENT_CHECKOUT_ENDPOINT?.trim();
const PAYMENT_SERVICE_TOKEN = process.env.PAYMENT_SERVICE_TOKEN?.trim();
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
const RESUME_PARSER_ENDPOINT = process.env.RESUME_PARSER_ENDPOINT?.trim();
const SOURCE_SYNC_MINUTES = Math.max(5, Number(process.env.SOURCE_SYNC_MINUTES) || 30);
const BOSS_OFFICIAL_API_ENDPOINT = process.env.BOSS_OFFICIAL_API_ENDPOINT?.trim();
const BOSS_OFFICIAL_API_TOKEN = process.env.BOSS_OFFICIAL_API_TOKEN?.trim();
const store = await new CommercialStore(join(ROOT, "data", "store.json")).init();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY) throw new Error("请求内容过大");
  }
  return JSON.parse(body || "{}");
}

function safetyIdentifier(deviceId = "anonymous") {
  return createHash("sha256").update(`offer-copilot:${deviceId}`).digest("hex").slice(0, 64);
}

function authenticatedUser(req) {
  const token = bearerToken(req);
  return { token, user: token ? store.userForToken(token) : null };
}

function requireUser(req, res) {
  const auth = authenticatedUser(req);
  if (!auth.user) {
    sendJson(res, 401, { error: "请先登录账号" });
    return null;
  }
  return auth;
}

async function consumeCommercial(req, res, feature) {
  if (!COMMERCIAL_MODE) return true;
  const auth = requireUser(req, res);
  if (!auth) return false;
  try {
    await store.consume(auth.user.id, feature);
    return true;
  } catch (error) {
    sendJson(res, 402, { error: error.message, code: error.code || "PLAN_REQUIRED" });
    return false;
  }
}

function safePlan(plan) {
  return {
    id: plan.id, name: plan.name, price: plan.price, days: plan.days,
    analysisLimit: plan.analysisLimit, resumeLimit: plan.resumeLimit,
    radar: plan.radar, reviews: plan.reviews, humanReview: Boolean(plan.humanReview), fairUse: Boolean(plan.fairUse)
  };
}

async function extractResume(body) {
  const fileName = String(body.fileName || "resume.txt").slice(0, 180);
  const mimeType = String(body.mimeType || "text/plain").slice(0, 100);
  if (typeof body.text === "string" && body.text.trim()) {
    return { text: body.text.slice(0, 100_000), fileName, mode: "text" };
  }
  const encoded = String(body.base64 || "");
  if (!encoded) throw new Error("请选择简历文件");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength > 8_000_000) throw new Error("简历文件不能超过 8MB");
  try {
    const parsed = await extractResumeLocally({ buffer, fileName, mimeType });
    return { ...parsed, fileName };
  } catch (localError) {
    if (!RESUME_PARSER_ENDPOINT) throw localError;
    const response = await fetch(RESUME_PARSER_ENDPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, mimeType, base64: encoded }), signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`简历解析服务返回 ${response.status}`);
    const payload = await response.json();
    if (!String(payload.text || "").trim()) throw new Error("简历解析服务没有返回文本");
    return { text: String(payload.text).slice(0, 100_000), fileName, mode: "provider" };
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

async function analyzeWithAI(profile, job, deviceId) {
  const input = {
    candidate: {
      currentIndustry: profile.currentIndustry,
      currentRole: profile.currentRole,
      education: profile.education,
      targetIndustries: profile.targetIndustries,
      targetRoles: profile.targetRoles,
      city: profile.city,
      salary: profile.salary,
      yearsExperience: profile.yearsExperience,
      priorities: profile.priorities,
      exclusions: profile.exclusions,
      skills: profile.skills,
      achievements: profile.achievements,
      resumeText: profile.resumeText,
      extraMaterials: profile.extraMaterials || profile.portfolioSummary
    },
    job
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      safety_identifier: safetyIdentifier(deviceId),
      reasoning: { effort: "low" },
      instructions: [
        "你是面向中国各行业求职者的岗位分析助手。",
        "只根据候选人提供的真实材料和职位描述判断，不编造经历，不承诺录用结果。",
        "匹配分必须由硬条件、目标方向和材料证据共同决定；没有证据时明确说未找到。",
        "招呼语自然、具体、简短，不复制整段 JD，不声称候选人没有提供的能力。",
        "输出中文。结论 A 表示证据充分且无明显硬伤；B 表示可尝试但有待确认风险；C 表示硬伤或方向偏差明显。"
      ].join("\n"),
      input: JSON.stringify(input),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "job_analysis",
          strict: true,
          schema: analysisSchema
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI 服务返回 ${response.status}: ${detail.slice(0, 240)}`);
  }
  const payload = await response.json();
  const text = extractOutputText(payload);
  const result = JSON.parse(text);
  if (!validateAnalysis(result)) throw new Error("AI 返回了无法识别的分析结果");
  return { ...result, mode: "ai", model: MODEL, analyzedAt: new Date().toISOString() };
}

async function analyzeCareerWithAI(profile, deviceId) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      safety_identifier: safetyIdentifier(deviceId),
      reasoning: { effort: "low" },
      instructions: [
        "你是面向中国求职者的职业定位与求职策略顾问，适用于所有合法行业和岗位。",
        "只依据用户提供的真实信息分析，不编造能力、经历、薪资数据或就业结果。",
        "分析当前经验、教育、技能、成果、目标行业、目标岗位、城市、薪资和限制条件。",
        "给出可解释的准备度、优势、缺口、建议行业与岗位、投递策略和下一步行动。",
        "避免空泛鼓励；每项建议必须具体、可执行；输出中文。"
      ].join("\n"),
      input: JSON.stringify(profile),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "career_analysis",
          strict: true,
          schema: careerAnalysisSchema
        }
      }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI 服务返回 ${response.status}: ${detail.slice(0, 240)}`);
  }
  const payload = await response.json();
  const result = JSON.parse(extractOutputText(payload));
  if (!validateCareerAnalysis(result)) throw new Error("AI 返回了无法识别的职业分析结果");
  return { ...result, mode: "ai", model: MODEL, analyzedAt: new Date().toISOString() };
}

async function rewriteResumeWithAI(profile, target, deviceId) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      safety_identifier: safetyIdentifier(deviceId),
      reasoning: { effort: "low" },
      instructions: [
        "你是面向中国各行业求职者的简历改写顾问。",
        "只允许使用用户提供的真实简历、技能、成果、教育和补充材料，不得虚构项目、职责、数字、公司、职级或能力。",
        "根据目标岗位和 JD 调整信息顺序、措辞和关键词，把动作与真实结果表达清楚。",
        "无法从材料验证的岗位要求必须写入 missingEvidence，不能补进简历。",
        "rewrittenResume 输出一份可以直接复制的完整中文纯文本简历；changeNotes 解释主要调整。"
      ].join("\n"),
      input: JSON.stringify({ profile, target }),
      text: {
        verbosity: "medium",
        format: {
          type: "json_schema",
          name: "resume_rewrite",
          strict: true,
          schema: resumeRewriteSchema
        }
      }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI 服务返回 ${response.status}: ${detail.slice(0, 240)}`);
  }
  const payload = await response.json();
  const result = JSON.parse(extractOutputText(payload));
  if (!validateResumeRewrite(result)) throw new Error("AI 返回了无法识别的简历改写结果");
  return { ...result, mode: "ai", model: MODEL, rewrittenAt: new Date().toISOString() };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    return sendJson(res, 200, {
      aiEnabled: Boolean(API_KEY), model: API_KEY ? MODEL : null, localMode: !COMMERCIAL_MODE,
      commercialMode: COMMERCIAL_MODE, paymentProvider: PAYMENT_PROVIDER,
      paymentReady: Boolean(PAYMENT_CHECKOUT_ENDPOINT && PAYMENT_WEBHOOK_SECRET), resumeParserReady: true,
      bossConnectorReady: Boolean(BOSS_OFFICIAL_API_ENDPOINT && BOSS_OFFICIAL_API_TOKEN)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/billing/plans") {
    return sendJson(res, 200, { plans: PLANS.map(safePlan) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    try {
      const result = await store.register(await readJson(req));
      return sendJson(res, 201, result);
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    try { return sendJson(res, 200, await store.login(await readJson(req))); }
    catch (error) { return sendJson(res, 401, { error: error.message }); }
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const auth = requireUser(req, res);
    if (!auth) return;
    return sendJson(res, 200, { user: publicAccount(auth.user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const auth = requireUser(req, res);
    if (!auth) return;
    await store.logout(auth.token);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/cloud/state") {
    const auth = requireUser(req, res);
    if (!auth) return;
    return sendJson(res, 200, { cloud: store.cloudState(auth.user.id) });
  }

  if (req.method === "PUT" && url.pathname === "/api/cloud/state") {
    const auth = requireUser(req, res);
    if (!auth) return;
    try {
      const { state } = await readJson(req);
      return sendJson(res, 200, { cloud: await store.saveCloudState(auth.user.id, state) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === "DELETE" && url.pathname === "/api/account") {
    const auth = requireUser(req, res);
    if (!auth) return;
    await store.deleteAccount(auth.user.id);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/billing/checkout") {
    const auth = requireUser(req, res);
    if (!auth) return;
    try {
      const { planId } = await readJson(req);
      const plan = PLANS.find((item) => item.id === planId && item.price > 0);
      if (!plan) return sendJson(res, 400, { error: "套餐不存在" });
      if (ALLOW_DEMO_BILLING) {
        const user = await store.activatePlan(auth.user.id, plan.id);
        await store.addEvent(auth.user.id, { type: "demo_payment_completed", data: { planId } });
        return sendJson(res, 200, { status: "paid", demo: true, user });
      }
      if (PAYMENT_CHECKOUT_ENDPOINT && PAYMENT_WEBHOOK_SECRET) {
        const response = await fetch(PAYMENT_CHECKOUT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(PAYMENT_SERVICE_TOKEN ? { Authorization: `Bearer ${PAYMENT_SERVICE_TOKEN}` } : {}) },
          body: JSON.stringify({ userId: auth.user.id, email: auth.user.email, plan: safePlan(plan), returnUrl: `${url.origin}/#settings` }),
          signal: AbortSignal.timeout(15_000)
        });
        if (!response.ok) throw new Error(`支付服务返回 ${response.status}`);
        const checkout = await response.json();
        if (!String(checkout.checkoutUrl || "").startsWith("https://")) throw new Error("支付服务没有返回安全的收银台地址");
        await store.addEvent(auth.user.id, { type: "payment_checkout_created", data: { planId, orderId: checkout.orderId || null } });
        return sendJson(res, 200, { status: "pending", checkoutUrl: checkout.checkoutUrl, orderId: checkout.orderId || null });
      }
      return sendJson(res, 503, {
        error: "正式支付通道尚未配置", code: "PAYMENT_PROVIDER_REQUIRED",
        provider: PAYMENT_PROVIDER, plan: safePlan(plan), next: "配置微信支付或支付宝服务端回调后才能激活套餐"
      });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/billing/webhook") {
    if (!PAYMENT_WEBHOOK_SECRET || req.headers["x-payment-webhook-secret"] !== PAYMENT_WEBHOOK_SECRET) {
      return sendJson(res, 401, { error: "支付回调验证失败" });
    }
    try {
      const { userId, planId, status, orderId } = await readJson(req);
      if (status !== "paid") return sendJson(res, 202, { ok: true, activated: false });
      const user = await store.activatePlan(String(userId), String(planId));
      await store.addEvent(user.id, { type: "payment_completed", data: { planId, orderId: orderId || null } });
      return sendJson(res, 200, { ok: true, activated: true });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/notifications/subscribe") {
    const auth = requireUser(req, res);
    if (!auth) return;
    try { await store.saveSubscription(auth.user.id, await readJson(req)); return sendJson(res, 201, { ok: true }); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === "GET" && url.pathname === "/api/notifications") {
    const auth = requireUser(req, res);
    if (!auth) return;
    return sendJson(res, 200, { notifications: store.notifications(auth.user.id) });
  }

  if (req.method === "GET" && url.pathname === "/api/opportunities/sources") {
    const auth = requireUser(req, res);
    if (!auth) return;
    return sendJson(res, 200, { sources: store.data.sources[auth.user.id] || [] });
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    try {
      const auth = authenticatedUser(req);
      await store.addEvent(auth.user?.id, await readJson(req));
      return sendJson(res, 202, { ok: true });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/resume/extract") {
    try { return sendJson(res, 200, { resume: await extractResume(await readJson(req)) }); }
    catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
  }

  if (req.method === "POST" && url.pathname === "/api/opportunities/collect") {
    try {
      const body = await readJson(req);
      const opportunities = await collectOpportunities(body);
      const auth = authenticatedUser(req);
      if (body.save && auth.user) await store.saveSource(auth.user.id, body);
      return sendJson(res, 200, { opportunities, collectedAt: new Date().toISOString() });
    } catch (error) { return sendJson(res, 400, { error: error.message || "公开招聘源采集失败" }); }
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    try {
      const { profile = {}, job = {}, deviceId } = await readJson(req);
      if (!String(profile.resumeText || "").trim()) return sendJson(res, 400, { error: "请先填写简历文本" });
      if (!String(job.description || "").trim()) return sendJson(res, 400, { error: "请填写职位描述" });
      if (String(profile.resumeText).length > 80_000 || String(job.description).length > 40_000) {
        return sendJson(res, 400, { error: "材料过长，请精简后重试" });
      }
      if (!await consumeCommercial(req, res, "analysis")) return;
      if (API_KEY) {
        try {
          const analysis = await analyzeWithAI(profile, job, deviceId);
          return sendJson(res, 200, { analysis });
        } catch (error) {
          const fallback = analyzeLocally(profile, job);
          return sendJson(res, 200, {
            analysis: fallback,
            warning: `AI 暂时不可用，已切换为本地分析：${error.message}`
          });
        }
      }
      return sendJson(res, 200, { analysis: analyzeLocally(profile, job) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "请求无法处理" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/career-analysis") {
    try {
      const { profile = {}, deviceId } = await readJson(req);
      if (!String(profile.resumeText || "").trim()) return sendJson(res, 400, { error: "请先填写简历文本" });
      if (String(profile.resumeText).length > 80_000) return sendJson(res, 400, { error: "简历文本过长，请精简后重试" });
      if (API_KEY) {
        try {
          return sendJson(res, 200, { analysis: await analyzeCareerWithAI(profile, deviceId) });
        } catch (error) {
          return sendJson(res, 200, {
            analysis: analyzeCareerLocally(profile),
            warning: `AI 暂时不可用，已切换为本地分析：${error.message}`
          });
        }
      }
      return sendJson(res, 200, { analysis: analyzeCareerLocally(profile) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "请求无法处理" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/rewrite-resume") {
    try {
      const { profile = {}, target = {}, deviceId } = await readJson(req);
      if (!String(profile.resumeText || "").trim()) return sendJson(res, 400, { error: "请先填写简历文本" });
      if (!String(target.targetRole || "").trim()) return sendJson(res, 400, { error: "请填写目标岗位" });
      if (String(profile.resumeText).length > 80_000 || String(target.jobDescription || "").length > 40_000) {
        return sendJson(res, 400, { error: "材料过长，请精简后重试" });
      }
      if (!await consumeCommercial(req, res, "resume")) return;
      if (API_KEY) {
        try {
          return sendJson(res, 200, { rewrite: await rewriteResumeWithAI(profile, target, deviceId) });
        } catch (error) {
          return sendJson(res, 200, {
            rewrite: rewriteResumeLocally(profile, target),
            warning: `AI 暂时不可用，已切换为本地重组：${error.message}`
          });
        }
      }
      return sendJson(res, 200, { rewrite: rewriteResumeLocally(profile, target) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "请求无法处理" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/personality-analysis") {
    try {
      const { profile = {}, answers = {} } = await readJson(req);
      const required = ["peopleEnergy", "communication", "structure", "planning", "novelty", "routine", "pace", "changeTolerance", "detail", "accuracy", "autonomy", "supervision"];
      if (!required.every((key) => Number(answers[key]) >= 1 && Number(answers[key]) <= 5)) {
        return sendJson(res, 400, { error: "请完成全部 12 个工作情境选择" });
      }
      return sendJson(res, 200, { analysis: analyzePersonalityLocally(profile, answers) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "请求无法处理" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/mbti-analysis") {
    try {
      const { answers = {} } = await readJson(req);
      return sendJson(res, 200, { analysis: analyzeMbti(answers) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "MBTI 分析失败" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/match-opportunity") {
    try {
      const { profile = {}, personalityAnalysis = null, opportunity = {} } = await readJson(req);
      if (!String(opportunity.title || opportunity.description || "").trim()) {
        return sendJson(res, 400, { error: "请填写机会标题或发布内容" });
      }
      return sendJson(res, 200, { match: matchOpportunityLocally(profile, personalityAnalysis, opportunity) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || "请求无法处理" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/outcome-review") {
    try {
      const { jobs = [], previousReview = null } = await readJson(req);
      if (!Array.isArray(jobs)) return sendJson(res, 400, { error: "投递记录格式无效" });
      return sendJson(res, 200, { review: analyzeOutcomes(jobs, previousReview) });
    } catch (error) { return sendJson(res, 400, { error: error.message || "结果复盘失败" }); }
  }

  if (req.method === "POST" && url.pathname === "/api/application-queue/prepare") {
    try {
      const { profile = {}, opportunities = [], settings = {}, resumeRewrite = null } = await readJson(req);
      if (!String(profile.resumeText || "").trim()) return sendJson(res, 400, { error: "请先保存真实简历" });
      if (!Array.isArray(opportunities)) return sendJson(res, 400, { error: "岗位列表格式无效" });
      return sendJson(res, 200, { queue: buildApplicationQueue(profile, opportunities, settings, resumeRewrite) });
    } catch (error) { return sendJson(res, 400, { error: error.message || "投递队列生成失败" }); }
  }

  if (req.method === "GET" && url.pathname === "/api/connectors/boss") {
    return sendJson(res, 200, {
      ready: Boolean(BOSS_OFFICIAL_API_ENDPOINT && BOSS_OFFICIAL_API_TOKEN),
      mode: BOSS_OFFICIAL_API_ENDPOINT && BOSS_OFFICIAL_API_TOKEN ? "official_api" : "confirmation_queue",
      message: BOSS_OFFICIAL_API_ENDPOINT && BOSS_OFFICIAL_API_TOKEN ? "BOSS 官方授权连接器已配置" : "未配置 BOSS 官方授权接口；当前只生成投递材料和官方页面确认队列"
    });
  }

  if (req.method === "POST" && url.pathname === "/api/connectors/boss/submit") {
    const auth = requireUser(req, res);
    if (!auth) return;
    if (!BOSS_OFFICIAL_API_ENDPOINT || !BOSS_OFFICIAL_API_TOKEN) {
      return sendJson(res, 503, { error: "尚未获得或配置 BOSS 官方投递接口", code: "BOSS_OFFICIAL_ACCESS_REQUIRED" });
    }
    try {
      const { application, userConfirmed } = await readJson(req);
      if (userConfirmed !== true) return sendJson(res, 400, { error: "提交前必须由求职者明确确认" });
      const response = await fetch(BOSS_OFFICIAL_API_ENDPOINT, {
        method: "POST", headers: { Authorization: `Bearer ${BOSS_OFFICIAL_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: auth.user.id, application }), signal: AbortSignal.timeout(20_000)
      });
      if (!response.ok) throw new Error(`BOSS 官方接口返回 ${response.status}`);
      const payload = await response.json();
      await store.addEvent(auth.user.id, { type: "boss_official_application_submitted", data: { applicationId: payload.applicationId || null, title: application?.title } });
      return sendJson(res, 200, { ok: true, applicationId: payload.applicationId || null, status: "submitted" });
    } catch (error) { return sendJson(res, 400, { error: error.message || "官方接口提交失败" }); }
  }

  return false;
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safe = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const path = join(PUBLIC, safe);
  if (!path.startsWith(PUBLIC)) return sendJson(res, 403, { error: "禁止访问" });
  try {
    const content = await readFile(path);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(path)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'"
    });
    res.end(content);
  } catch {
    if (!extname(requested)) {
      const content = await readFile(join(PUBLIC, "index.html"));
      res.writeHead(200, { "Content-Type": mimeTypes[".html"], "Cache-Control": "no-cache" });
      return res.end(content);
    }
    sendJson(res, 404, { error: "页面不存在" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (handled !== false) return;
  }
  if (!["GET", "HEAD"].includes(req.method)) return sendJson(res, 405, { error: "不支持的请求方式" });
  await serveStatic(req, res, url);
});

async function syncSavedSources() {
  for (const { userId, source } of store.allSources()) {
    try {
      const opportunities = await collectOpportunities(source);
      const seen = new Set(source.seen || []);
      const fresh = opportunities.filter((item) => !seen.has(item.fingerprint));
      const cloud = store.cloudState(userId)?.state || {};
      for (const opportunity of fresh) {
        const match = matchOpportunityLocally(cloud.profile || {}, cloud.personalityAnalysis || null, opportunity);
        if (match.score >= 72) {
          await store.addNotification(userId, {
            type: "opportunity", title: opportunity.title, body: `${opportunity.company || opportunity.publisher || "公开招聘源"} · 匹配 ${Math.round(match.score)} 分`,
            url: opportunity.applyUrl || opportunity.url, opportunity: { ...opportunity, match }
          });
        }
      }
      await store.markSourceSynced(userId, source.id, opportunities.map((item) => item.fingerprint));
    } catch (error) {
      console.warn(`公开招聘源同步失败 ${source.type}:${source.target} - ${error.message}`);
    }
  }
}

const sourceTimer = setInterval(syncSavedSources, SOURCE_SYNC_MINUTES * 60_000);
sourceTimer.unref();

server.listen(PORT, "127.0.0.1", () => {
  console.log(`求职投递助手已启动：http://127.0.0.1:${PORT}`);
  console.log(API_KEY ? `AI 模式：${MODEL}` : "本地分析模式：未配置 OPENAI_API_KEY");
  console.log(`公开招聘源后台同步：每 ${SOURCE_SYNC_MINUTES} 分钟`);
});
