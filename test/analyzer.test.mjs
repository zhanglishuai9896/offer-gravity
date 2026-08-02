import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally, validateAnalysis } from "../lib/analyzer.mjs";

const profile = {
  targetRoles: "品牌视觉设计师",
  city: "上海",
  salary: "15-20K",
  yearsExperience: 3,
  resumeText: "本科学历，3年品牌视觉设计经验。负责消费品牌VI升级、包装设计、电商详情页与营销海报，熟练使用Photoshop、Illustrator和Figma。",
  portfolioSummary: "主导品牌升级项目，完成视觉系统和线上线下物料落地。"
};

test("matching design job receives a valid, positive analysis", () => {
  const result = analyzeLocally(profile, {
    title: "品牌视觉设计师",
    company: "测试品牌",
    location: "上海",
    description: "本科，2年以上品牌视觉设计经验，负责品牌升级、VI、包装和电商视觉，熟练使用Figma和Photoshop。"
  });
  assert.equal(validateAnalysis(result), true);
  assert.ok(result.score >= 70);
  assert.equal(result.recommendation, "A 优先投");
  assert.ok(result.strengths.length > 0);
  assert.match(result.greeting, /品牌视觉设计师/);
});

test("hard requirement mismatch lowers recommendation", () => {
  const result = analyzeLocally(profile, {
    title: "高级3D动效设计师",
    company: "测试公司",
    location: "北京",
    description: "硕士学历，8年以上3D动效经验，必须熟练使用C4D、Blender，负责大型影视特效项目。"
  });
  assert.equal(validateAnalysis(result), true);
  assert.ok(result.score < 50);
  assert.equal(result.recommendation, "C 不建议投");
  assert.ok(result.gaps.length > 0);
});

test("analysis never exceeds score bounds", () => {
  const result = analyzeLocally({}, { description: "普通岗位描述" });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(validateAnalysis(result), true);
});

