import { writeFile } from "node:fs/promises";

const apiBaseUrl = process.env.VITE_API_BASE_URL || process.env.API_BASE_URL || "";
const source = `window.OFFER_API_BASE_URL = ${JSON.stringify(apiBaseUrl)};\n`;

await writeFile(new URL("../public/env.js", import.meta.url), source);
