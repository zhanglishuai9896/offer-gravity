import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

async function loadClient(baseUrl = "") {
  const source = await readFile(new URL("../public/api-client.js", import.meta.url), "utf8");
  const calls = [];
  const sandbox = {
    window: { OFFER_API_BASE_URL: baseUrl },
    fetch: async (...args) => {
      calls.push(args);
      return { ok: true };
    }
  };
  sandbox.window.fetch = sandbox.fetch;
  vm.runInNewContext(source, sandbox, { filename: "api-client.js" });
  return { client: sandbox.window.offerApi, calls };
}

test("apiUrl keeps same-origin API paths when no backend URL is configured", async () => {
  const { client } = await loadClient();
  assert.equal(client.apiUrl("/api/config"), "/api/config");
});

test("apiUrl prefixes API paths with the configured backend URL", async () => {
  const { client } = await loadClient("https://api.offer-yinli.example/");
  assert.equal(client.apiUrl("/api/config"), "https://api.offer-yinli.example/api/config");
});

test("apiFetch calls fetch with the resolved backend URL", async () => {
  const { client, calls } = await loadClient("https://api.offer-yinli.example");
  await client.apiFetch("/api/analyze", { method: "POST" });
  assert.equal(calls[0][0], "https://api.offer-yinli.example/api/analyze");
  assert.deepEqual(calls[0][1], { method: "POST" });
});
