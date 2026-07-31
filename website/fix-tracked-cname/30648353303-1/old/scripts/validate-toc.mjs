#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOC_MIN_ENTRIES,
  collectAuthoredTocFiles,
  collectGeneratedDocHeadings,
  collectMirrorDocFiles,
  compareEntries,
  extractRenderedTocEntries,
  injectAuthoredHeadingIds,
  prepareTocEntries
} from "./page-toc-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteRoot = path.resolve(__dirname, "..");

const failures = [];

for (const file of collectAuthoredTocFiles(siteRoot)) {
  const html = fs.readFileSync(file, "utf8");
  const { entries } = injectAuthoredHeadingIds(html);
  const expected = prepareTocEntries(entries).map((entry) => ({ id: entry.id, text: entry.text }));
  const actual = extractRenderedTocEntries(html);

  validateEntries({
    file,
    expected,
    actual
  });
}

for (const file of collectMirrorDocFiles(siteRoot)) {
  const html = fs.readFileSync(file, "utf8");
  const proseMatch = html.match(/<div class="card spec-prose">([\s\S]*?)<\/div>\s*<\/section>/);
  if (!proseMatch) {
    continue;
  }

  if (proseMatch[1].includes('id="table-of-contents"')) {
    failures.push(`${relativePath(file)} still contains an inline markdown table of contents block.`);
    continue;
  }

  const expected = prepareTocEntries(collectGeneratedDocHeadings(proseMatch[1])).map((entry) => ({
    id: entry.id,
    text: entry.text
  }));
  const actual = extractRenderedTocEntries(html);

  validateEntries({
    file,
    expected,
    actual
  });
}

if (failures.length) {
  console.error("TOC validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Validated derived TOCs across authored and mirrored docs.");

function validateEntries({ file, expected, actual }) {
  const rel = relativePath(file);

  if (expected.length >= TOC_MIN_ENTRIES) {
    if (!actual.length) {
      failures.push(`${rel} is missing a rendered page TOC.`);
      return;
    }

    if (!compareEntries(expected, actual)) {
      failures.push(`${rel} has TOC entries that do not match the current heading structure.`);
    }
    return;
  }

  if (actual.length) {
    failures.push(`${rel} renders a page TOC even though it does not meet the minimum heading threshold.`);
  }
}

function relativePath(file) {
  return path.relative(siteRoot, file).replace(/\\/g, "/");
}
