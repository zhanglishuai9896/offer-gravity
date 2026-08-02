import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMbti } from "../lib/mbti.mjs";

test("MBTI analysis returns a complete type and career guidance", () => {
  const answers = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`q${index + 1}`, index < 5 ? -2 : 2]));
  const result = analyzeMbti(answers);
  assert.equal(result.type, "ENFP");
  assert.ok(result.recommendedRoles.length >= 5);
  assert.equal(result.dimensions.length, 4);
});

test("MBTI analysis requires every answer", () => {
  assert.throws(() => analyzeMbti({ q1: 1 }), /20 道/);
});
