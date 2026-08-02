import test from "node:test";
import assert from "node:assert/strict";
import { dedupeOpportunities, detectOpportunityRisks, parseJobPostingHtml } from "../lib/collector.mjs";

test("parses public JobPosting JSON-LD into a normalized opportunity", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "JobPosting", title: "品牌设计师",
    hiringOrganization: { name: "示例品牌" }, description: "负责品牌视觉系统与线上内容设计，要求三年以上相关经验。",
    datePosted: "2026-08-01", validThrough: "2027-09-01",
    jobLocation: { address: { addressLocality: "上海", addressCountry: "中国" } },
    url: "https://example.com/jobs/brand-designer"
  })}</script>`;
  const [job] = parseJobPostingHtml(html, "https://example.com/jobs/brand-designer");
  assert.equal(job.title, "品牌设计师");
  assert.equal(job.company, "示例品牌");
  assert.match(job.location, /上海/);
  assert.equal(job.expired, false);
});

test("deduplicates identical opportunities and removes expired jobs", () => {
  const jobs = dedupeOpportunities([
    { source: "official", title: "产品经理", company: "甲公司", url: "https://example.com/1", description: "负责产品规划和增长，要求具备完整项目经验。" },
    { source: "official", title: "产品经理", company: "甲公司", url: "https://example.com/1", description: "重复岗位信息" },
    { source: "official", title: "设计师", company: "乙公司", url: "https://example.com/2", validThrough: "2020-01-01", description: "已过期岗位" }
  ]);
  assert.equal(jobs.length, 1);
});

test("flags suspicious paid recruitment language", () => {
  const risks = detectOpportunityRisks({ title: "兼职", company: "某机构", url: "https://example.com", description: "入职前先交培训费，加微信咨询详情。" });
  assert.ok(risks.includes("疑似要求求职者付费"));
  assert.ok(risks.includes("存在引流或夸大宣传特征"));
});
