import test from "node:test";
import assert from "node:assert/strict";
import { extractResumeLocally } from "../lib/resume-parser.mjs";

test("extracts plain text resumes locally", async () => {
  const result = await extractResumeLocally({ buffer: Buffer.from("产品经理\n5年B端经验"), fileName: "resume.txt", mimeType: "text/plain" });
  assert.equal(result.mode, "local_text");
  assert.match(result.text, /5年B端经验/);
});

test("rejects legacy doc with an actionable message", async () => {
  await assert.rejects(
    extractResumeLocally({ buffer: Buffer.from("legacy"), fileName: "resume.doc", mimeType: "application/msword" }),
    /另存为 DOCX 或 PDF/
  );
});

test("validates PDF magic bytes before parsing", async () => {
  await assert.rejects(
    extractResumeLocally({ buffer: Buffer.from("not a pdf"), fileName: "resume.pdf", mimeType: "application/pdf" }),
    /有效的 PDF/
  );
});
