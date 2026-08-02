import test from "node:test";
import assert from "node:assert/strict";
import { rewriteResumeLocally, validateResumeRewrite } from "../lib/resume.mjs";

test("resume rewrite only reorganizes supplied candidate evidence", () => {
  const result = rewriteResumeLocally({
    yearsExperience: 4,
    skills: "采购, Excel, 供应商管理",
    achievements: "将采购周期缩短 12%",
    resumeText: "负责供应商开发与采购计划。",
    education: "本科"
  }, { targetRole: "供应链主管", focus: "results", jobDescription: "负责供应链管理" });

  assert.equal(validateResumeRewrite(result), true);
  assert.match(result.rewrittenResume, /采购周期缩短 12%/);
  assert.match(result.rewrittenResume, /负责供应商开发与采购计划/);
  assert.doesNotMatch(result.rewrittenResume, /虚构/);
});

test("resume rewrite reports missing evidence instead of inventing it", () => {
  const result = rewriteResumeLocally({ resumeText: "参与日常运营工作。" }, { targetRole: "运营经理" });
  assert.ok(result.missingEvidence.length >= 2);
  assert.match(result.missingEvidence.join(" "), /缺少|未提供|尚未填写/);
});
