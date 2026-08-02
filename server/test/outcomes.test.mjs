import test from "node:test";
import assert from "node:assert/strict";
import { analyzeOutcomes } from "../lib/outcomes.mjs";

test("outcome review avoids conclusions when sample is too small", () => {
  const review = analyzeOutcomes([{ title: "设计师", channel: "official", stage: "已投递" }]);
  assert.equal(review.metrics.applied, 1);
  assert.match(review.diagnosis[0], /样本不足/);
});

test("outcome review identifies low reply conversion", () => {
  const jobs = Array.from({ length: 12 }, (_, index) => ({ title: "产品经理", channel: "platform", stage: index === 0 ? "有效回复" : "已投递" }));
  const review = analyzeOutcomes(jobs);
  assert.ok(review.metrics.replyRate < 10);
  assert.match(review.diagnosis[0], /有效回复率偏低/);
});
