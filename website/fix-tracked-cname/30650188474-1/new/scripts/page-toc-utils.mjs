import fs from "node:fs";
import path from "node:path";

export const TOC_MIN_ENTRIES = 3;
export const TOC_MAX_VERBOSE_ENTRIES = 24;

export function collectAuthoredTocFiles(siteRoot) {
  const docsDir = path.join(siteRoot, "public", "docs");
  const apisDir = path.join(siteRoot, "public", "apis");

  return [
    ...collectHtmlFiles(docsDir).filter((file) => path.basename(file) !== "index.html"),
    ...collectHtmlFiles(apisDir)
  ].sort((left, right) => left.localeCompare(right));
}

export function collectMirrorDocFiles(siteRoot) {
  return [
    ...collectHtmlFiles(path.join(siteRoot, "public", "spec")),
    ...collectHtmlFiles(path.join(siteRoot, "public", "adapter-reference"))
  ]
    .filter((file) => path.basename(file) !== "index.html")
    .sort((left, right) => left.localeCompare(right));
}

export function collectHtmlFiles(rootDir) {
  const files = [];

  walk(rootDir);
  return files;

  function walk(dir) {
    for (const entry of safeReadDir(dir)) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(absolute);
      }
    }
  }
}

export function stripMarkdownTableOfContents(markdown) {
  const lines = markdown.split(/\r?\n/);
  const output = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!skipping && trimmed === "## Table of Contents") {
      skipping = true;
      continue;
    }

    if (skipping) {
      if (trimmed === "---") {
        skipping = false;
      }
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

export function collectGeneratedDocHeadings(html) {
  const entries = [];
  const seenIds = new Set();
  const headingPattern = /<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g;

  for (const match of html.matchAll(headingPattern)) {
    const level = Number(match[1]);
    const id = match[2];
    const text = normalizeText(stripTags(match[3]));

    if (!text || id === "table-of-contents" || seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    entries.push({ id, text, level });
  }

  return entries;
}

export function injectAuthoredHeadingIds(html) {
  const entries = [];
  const seenIds = new Set();
  const updatedHtml = html.replace(
    /<h2 class="section-title"([^>]*)>([\s\S]*?)<\/h2>/g,
    (fullMatch, attrs, innerHtml) => {
      const text = normalizeText(stripTags(innerHtml));
      if (!text) {
        return fullMatch;
      }

      const existingIdMatch = attrs.match(/\sid="([^"]+)"/);
      const id = existingIdMatch ? existingIdMatch[1] : uniqueSlug(text, seenIds);
      seenIds.add(id);
      entries.push({ id, text, level: 2 });

      if (existingIdMatch) {
        return fullMatch;
      }

      return `<h2 class="section-title"${attrs} id="${id}">${innerHtml}</h2>`;
    }
  );

  return { html: updatedHtml, entries };
}

export function renderTocSection(entries) {
  const normalizedEntries = prepareTocEntries(entries);

  if (normalizedEntries.length < TOC_MIN_ENTRIES) {
    return "";
  }

  const items = normalizedEntries
    .map(
      (entry) =>
        `<li class="page-toc-item level-${entry.level}"><a href="#${entry.id}" data-toc-target="${entry.id}">${escapeHtml(
          entry.text
        )}</a></li>`
    )
    .join("");

  return `<section class="page-toc-shell" data-page-toc>
  <div class="card page-toc-card">
    <div class="page-toc-head">
      <p class="page-toc-kicker">On this page</p>
      <h2>Jump to a section</h2>
      <p class="page-toc-intro">Use the outline to move through longer pages without losing your place.</p>
    </div>
    <ol class="page-toc-list" data-page-toc-list>
      ${items}
    </ol>
  </div>
</section>`;
}

export function removeRenderedToc(html) {
  return html.replace(/\n\s*<section class="page-toc-shell" data-page-toc>[\s\S]*?<\/section>\n*/g, "\n\n");
}

export function insertTocBeforeTopicBridge(html, tocHtml) {
  const insertion = tocHtml ? `${indentBlock(tocHtml, 8)}\n\n` : "";

  return html.replace(
    /\n\s*<section class="topic-bridge">/,
    `\n\n${insertion}        <section class="topic-bridge">`
  );
}

export function extractRenderedTocEntries(html) {
  const tocMatch = html.match(/<ol class="page-toc-list" data-page-toc-list>([\s\S]*?)<\/ol>/);
  if (!tocMatch) {
    return [];
  }

  const entries = [];
  const linkPattern = /<a href="#([^"]+)" data-toc-target="[^"]*">([\s\S]*?)<\/a>/g;

  for (const match of tocMatch[1].matchAll(linkPattern)) {
    entries.push({
      id: match[1],
      text: normalizeText(stripTags(match[2]))
    });
  }

  return entries;
}

export function compareEntries(expected, actual) {
  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((entry, index) => {
    const current = actual[index];
    return current && current.id === entry.id && current.text === entry.text;
  });
}

export function prepareTocEntries(entries) {
  if (entries.length <= TOC_MAX_VERBOSE_ENTRIES) {
    return entries;
  }

  const topLevelEntries = entries.filter((entry) => entry.level <= 2);
  return topLevelEntries.length >= TOC_MIN_ENTRIES ? topLevelEntries : entries;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, "");
}

export function uniqueSlug(value, seenIds) {
  const base = slugify(value) || "section";

  if (!seenIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (seenIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export function slugify(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function indentBlock(value, spaces) {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
