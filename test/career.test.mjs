import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCareerLocally, validateCareerAnalysis } from "../lib/career.mjs";

test("complete cross-industry profile produces actionable career analysis", () => {
  const result = analyzeCareerLocally({
    currentIndustry: "制造业",
    currentRole: "供应链专员",
    yearsExperience: 4,
    education: "本科·物流管理",
    targetIndustries: "新能源,汽车制造",
    targetRoles: "供应链主管,采购主管",
    city: "上海,苏州",
    salary: "18-25K",
    skills: "供应链,采购,Excel,供应商管理",
    achievements: "负责30家供应商管理，将平均交付周期缩短18%，年度采购成本降低120万元。",
    resumeText: "4年制造业供应链经验，负责采购计划、供应商评估、交付与库存协同。"
  });
  assert.equal(validateCareerAnalysis(result), true);
  assert.ok(result.readinessScore >= 75);
  assert.ok(result.roleSuggestions.includes("供应链主管"));
  assert.ok(result.strategy.length >= 3);
});

test("incomplete profile returns gaps instead of invented experience", () => {
  const result = analyzeCareerLocally({ resumeText: "正在找工作。" });
  assert.equal(validateCareerAnalysis(result), true);
  assert.ok(result.readinessScore < 55);
  assert.ok(result.gaps.length >= 3);
});

