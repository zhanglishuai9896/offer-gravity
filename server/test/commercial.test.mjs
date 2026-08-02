import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CommercialStore, PLANS } from "../lib/commercial.mjs";

test("commercial plans include launch, professional and concierge tiers", () => {
  assert.deepEqual(PLANS.map((plan) => plan.price), [0, 59, 129, 299]);
  assert.equal(PLANS.find((plan) => plan.price === 59).analysisLimit, 100);
});

test("account store hashes passwords and supports cloud state deletion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "offer-index-"));
  try {
    const store = await new CommercialStore(join(dir, "store.json")).init();
    const registered = await store.register({ email: "queen@example.com", password: "strong-pass", name: "Queen" });
    assert.ok(registered.token);
    assert.equal(store.data.users[0].credentials.password, undefined);
    const loggedIn = await store.login({ email: "queen@example.com", password: "strong-pass" });
    await store.saveCloudState(loggedIn.user.id, { version: 2, jobs: [] });
    assert.equal(store.cloudState(loggedIn.user.id).state.version, 2);
    const usage = await store.consume(loggedIn.user.id, "analysis");
    assert.equal(usage.remaining, 9);
    const source = await store.saveSource(loggedIn.user.id, { type: "official", target: "https://example.com/careers" });
    assert.equal(source.enabled, true);
    assert.equal(store.allSources().length, 1);
    await store.deleteAccount(loggedIn.user.id);
    assert.equal(store.cloudState(loggedIn.user.id), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
