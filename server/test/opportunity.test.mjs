import test from "node:test";
import assert from "node:assert/strict";
import { buildRadarKeywords, matchOpportunityLocally } from "../lib/opportunity.mjs";

test("radar keywords support arbitrary user-entered professions", () => {
  const keywords = buildRadarKeywords({ targetRoles: "宠物医生,临床兽医", targetIndustries: "宠物医疗", skills: "影像诊断,外科" });
  assert.ok(keywords.includes("宠物医生"));
  assert.ok(keywords.includes("影像诊断"));
});

test("matching opportunity receives a high-priority alert", () => {
  const result = matchOpportunityLocally({ targetRoles: "宠物医生", targetIndustries: "宠物医疗", city: "上海", skills: "影像诊断,外科" }, null, {
    title: "上海宠物医院招聘宠物医生",
    description: "要求具备影像诊断和外科经验"
  });
  assert.ok(result.score >= 72);
  assert.equal(result.label, "高匹配提醒");
});
