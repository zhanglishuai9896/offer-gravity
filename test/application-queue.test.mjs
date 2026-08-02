import test from "node:test";
import assert from "node:assert/strict";
import { buildApplicationQueue } from "../lib/application-queue.mjs";

test("application queue selects only high-match BOSS opportunities", () => {
  const profile = { name: "小乔", yearsExperience: 4, skills: "采购,供应链", resumeText: "真实简历" };
  const queue = buildApplicationQueue(profile, [
    { id: "1", source: "boss", title: "采购主管", publisher: "甲公司", url: "https://www.zhipin.com/job/1", match: { score: 90 } },
    { id: "2", source: "boss", title: "销售", publisher: "乙公司", url: "https://www.zhipin.com/job/2", match: { score: 60 } },
    { id: "3", source: "official", title: "采购主管", publisher: "丙公司", url: "https://example.com/3", match: { score: 95 } }
  ], { threshold: 80, dailyLimit: 10, onlyBoss: true });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].title, "采购主管");
  assert.match(queue[0].greeting, /4 年/);
});

test("application queue respects exclusions and daily limit", () => {
  const opportunities = Array.from({ length: 5 }, (_, index) => ({ id: String(index), source: "boss", title: index === 0 ? "保险销售" : `设计师${index}`, publisher: "公司", url: `https://www.zhipin.com/${index}`, match: { score: 90 - index } }));
  const queue = buildApplicationQueue({ resumeText: "真实简历" }, opportunities, { threshold: 70, dailyLimit: 2, excludedKeywords: "保险" });
  assert.equal(queue.length, 2);
  assert.ok(queue.every((item) => !item.title.includes("保险")));
});
