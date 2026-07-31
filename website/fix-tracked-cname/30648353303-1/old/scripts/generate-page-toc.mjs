#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOC_MIN_ENTRIES,
  collectAuthoredTocFiles,
  injectAuthoredHeadingIds,
  insertTocBeforeTopicBridge,
  removeRenderedToc,
  renderTocSection
} from "./page-toc-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const isCheck = args.includes("--check");

let changedFiles = 0;

for (const file of collectAuthoredTocFiles(siteRoot)) {
  const original = fs.readFileSync(file, "utf8");
  const withoutToc = removeRenderedToc(original);
  const { html: withHeadingIds, entries } = injectAuthoredHeadingIds(withoutToc);
  const tocHtml = entries.length >= TOC_MIN_ENTRIES ? renderTocSection(entries) : "";
  const nextHtml = insertTocBeforeTopicBridge(withHeadingIds, tocHtml);

  if (nextHtml !== original) {
    changedFiles += 1;
    if (!isCheck) {
      fs.writeFileSync(file, nextHtml);
    }
  }
}

if (isCheck && changedFiles > 0) {
  console.error("Derived page TOCs are out of date. Run `npm run generate:page-toc`.");
  process.exit(1);
}

console.log(`${isCheck ? "Checked" : "Generated"} derived TOCs for authored long-form pages.`);
