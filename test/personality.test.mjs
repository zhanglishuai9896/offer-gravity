import test from "node:test";
import assert from "node:assert/strict";
import { analyzePersonalityLocally, validatePersonalityAnalysis } from "../lib/personality.mjs";

test("personality analysis recommends environments without making a career diagnosis", () => {
  const result = analyzePersonalityLocally({ targetRoles: "供应链主管" }, {
    peopleEnergy: 4, communication: 4, structure: 5, planning: 5,
    novelty: 2, routine: 4, pace: 3, changeTolerance: 3,
    detail: 5, accuracy: 5, autonomy: 3, supervision: 3
  });
  assert.equal(validatePersonalityAnalysis(result), true);
  assert.ok(result.recommendedRoles.includes("供应链主管"));
  assert.match(result.disclaimer, /工作偏好|不是临床/);
});

test("independent preference produces focused work environments", () => {
  const result = analyzePersonalityLocally({}, {
    peopleEnergy: 1, communication: 2, structure: 3, planning: 4,
    novelty: 4, routine: 2, pace: 2, changeTolerance: 3,
    detail: 5, accuracy: 5, autonomy: 5, supervision: 1
  });
  assert.equal(result.archetype, "独立深耕型");
  assert.ok(result.suitableEnvironments.some((item) => item.includes("连续专注")));
});
