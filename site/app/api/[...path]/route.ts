import { NextResponse } from "next/server";
// @ts-expect-error JavaScript analysis module
import { analyzeLocally } from "../../../lib/analyzer.mjs";
// @ts-expect-error JavaScript analysis module
import { analyzeCareerLocally } from "../../../lib/career.mjs";
// @ts-expect-error JavaScript analysis module
import { rewriteResumeLocally } from "../../../lib/resume.mjs";
// @ts-expect-error JavaScript analysis module
import { analyzePersonalityLocally } from "../../../lib/personality.mjs";
// @ts-expect-error JavaScript analysis module
import { matchOpportunityLocally } from "../../../lib/opportunity.mjs";
// @ts-expect-error JavaScript analysis module
import { analyzeOutcomes } from "../../../lib/outcomes.mjs";
// @ts-expect-error JavaScript analysis module
import { buildApplicationQueue } from "../../../lib/application-queue.mjs";
// @ts-expect-error JavaScript analysis module
import { analyzeMbti } from "../../../lib/mbti.mjs";
// @ts-expect-error JavaScript resume parser module
import { extractResumeLocally } from "../../../lib/resume-parser.mjs";

const plans = [
  { id: "free", name: "免费体验", price: 0, days: 0, analysisLimit: 10, resumeLimit: 0, radar: "manual", reviews: 0 },
  { id: "launch", name: "14 天求职方案", price: 59, days: 14, analysisLimit: 100, resumeLimit: 12, radar: "daily", reviews: 2 },
  { id: "professional", name: "30 天专业版", price: 129, days: 30, analysisLimit: 300, resumeLimit: 30, radar: "instant", reviews: 4 },
  { id: "concierge", name: "30 天陪跑版", price: 299, days: 30, analysisLimit: 500, resumeLimit: 50, radar: "instant", reviews: 6, humanReview: true },
];

function pathOf(context: { params: Promise<{ path: string[] }> }) {
  return context.params.then(({ path }) => `/${path.join("/")}`);
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = await pathOf(context);
  if (path === "/config") return NextResponse.json({ aiEnabled: false, model: null, localMode: true, commercialMode: false, paymentReady: false, resumeParserReady: true, bossConnectorReady: false });
  if (path === "/billing/plans") return NextResponse.json({ plans });
  if (path === "/connectors/boss") return NextResponse.json({ ready: false, mode: "confirmation_queue", message: "公开测试版只生成投递材料和官方页面确认队列" });
  if (path === "/auth/me" || path === "/notifications") return error("公开测试版暂未开放账号云同步", 401);
  return error("接口不存在", 404);
}

export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const path = await pathOf(context);
  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { return error("请求内容无效"); }

  try {
    if (path === "/analyze") {
      if (!String(body.profile?.resumeText || "").trim()) return error("请先填写简历文本");
      if (!String(body.job?.description || "").trim()) return error("请填写职位描述");
      return NextResponse.json({ analysis: analyzeLocally(body.profile, body.job) });
    }
    if (path === "/career-analysis") {
      if (!String(body.profile?.resumeText || "").trim()) return error("请先填写简历文本");
      return NextResponse.json({ analysis: analyzeCareerLocally(body.profile) });
    }
    if (path === "/rewrite-resume") {
      if (!String(body.profile?.resumeText || "").trim()) return error("请先填写简历文本");
      if (!String(body.target?.targetRole || "").trim()) return error("请填写目标岗位");
      return NextResponse.json({ rewrite: rewriteResumeLocally(body.profile, body.target) });
    }
    if (path === "/personality-analysis") return NextResponse.json({ analysis: analyzePersonalityLocally(body.profile || {}, body.answers || {}) });
    if (path === "/mbti-analysis") return NextResponse.json({ analysis: analyzeMbti(body.answers || {}) });
    if (path === "/match-opportunity") return NextResponse.json({ match: matchOpportunityLocally(body.profile || {}, body.personalityAnalysis || null, body.opportunity || {}) });
    if (path === "/outcome-review") return NextResponse.json({ review: analyzeOutcomes(body.jobs || [], body.previousReview || null) });
    if (path === "/application-queue/prepare") return NextResponse.json({ queue: buildApplicationQueue(body.profile || {}, body.opportunities || [], body.settings || {}, body.resumeRewrite || null) });
    if (path === "/resume/extract") {
      if (String(body.text || "").trim()) return NextResponse.json({ resume: { text: String(body.text).slice(0, 100000), fileName: body.fileName || "resume.txt", mode: "text" } });
      const encoded = String(body.base64 || "");
      if (!encoded) return error("请选择简历文件");
      const buffer = Buffer.from(encoded, "base64");
      if (buffer.byteLength > 8_000_000) return error("简历文件不能超过 8MB");
      const parsed = await extractResumeLocally({ buffer, fileName: String(body.fileName || "resume.txt").slice(0, 180), mimeType: String(body.mimeType || "").slice(0, 100) });
      return NextResponse.json({ resume: { ...parsed, fileName: body.fileName || "resume.txt" } });
    }
    if (path === "/events") return NextResponse.json({ ok: true }, { status: 202 });
    if (path.startsWith("/auth/") || path === "/billing/checkout") return error("公开测试版暂未开放账号与支付", 503);
    if (path === "/opportunities/collect") return error("公开测试版请粘贴招聘内容进行匹配", 501);
    if (path === "/connectors/boss/submit") return error("公开测试版不执行真实投递", 503);
    return error("接口不存在", 404);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "请求无法处理");
  }
}

export const PUT = POST;
export const DELETE = POST;
