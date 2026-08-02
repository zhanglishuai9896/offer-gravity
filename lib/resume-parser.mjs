import mammothModule from "mammoth";
import { PDFParse } from "pdf-parse";

const mammoth = mammothModule?.default || mammothModule;

function cleanExtractedText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 100_000);
}

export async function extractResumeLocally({ buffer, fileName = "resume", mimeType = "" }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("简历文件为空");
  const lowerName = String(fileName).toLowerCase();
  const type = String(mimeType).toLowerCase();

  if (type.startsWith("text/") || lowerName.endsWith(".txt")) {
    const text = cleanExtractedText(buffer.toString("utf8"));
    if (!text) throw new Error("TXT 文件没有可读取的文字");
    return { text, mode: "local_text" };
  }

  if (type === "application/pdf" || lowerName.endsWith(".pdf")) {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("文件不是有效的 PDF");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = cleanExtractedText(result.text);
      if (!text) throw new Error("PDF 没有可提取文字；扫描版请先进行 OCR");
      return { text, mode: "local_pdf" };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lowerName.endsWith(".docx")) {
    if (buffer.subarray(0, 2).toString("ascii") !== "PK") throw new Error("文件不是有效的 DOCX");
    const result = await mammoth.extractRawText({ buffer });
    const text = cleanExtractedText(result.value);
    if (!text) throw new Error("DOCX 没有可提取文字");
    return { text, mode: "local_docx" };
  }

  if (type === "application/msword" || lowerName.endsWith(".doc")) {
    throw new Error("暂不支持旧版 .doc，请在 Word 中另存为 DOCX 或 PDF 后上传");
  }

  throw new Error("只支持 TXT、PDF 和 DOCX 简历");
}

