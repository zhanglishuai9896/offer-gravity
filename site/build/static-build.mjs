import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const publicDir = new URL("public/", root);
const distDir = new URL("dist/", root);
const outputDir = new URL("dist/client/", root);

await rm(distDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(publicDir, outputDir, { recursive: true });
await writeFile(new URL(".assetsignore", outputDir), "");

console.log("Static build complete: dist/client");
