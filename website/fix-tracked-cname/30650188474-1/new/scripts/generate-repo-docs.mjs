#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectGeneratedDocHeadings,
  indentBlock,
  renderTocSection,
  stripMarkdownTableOfContents
} from "./page-toc-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(siteRoot, "public");
const searchBasePath = path.join(siteRoot, "source", "search-index.base.json");
const generatedSearchIndexPath = path.join(publicRoot, "data", "search-index.json");
const fontStylesheetUrl =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@500;700&display=swap";

const args = process.argv.slice(2);
const isCheck = args.includes("--check");

const mirrorConfigs = [createSpecConfig(), createAdapterConfig()];
const selectedMirrorIds = parseMirrorSelection(args, mirrorConfigs);
const selectedMirrorConfigs = mirrorConfigs.filter((config) => selectedMirrorIds.has(config.id));

for (const config of selectedMirrorConfigs) {
  if (!fs.existsSync(config.docsRoot)) {
    console.error(`${config.repoLabel} docs directory not found: ${config.docsRoot}`);
    process.exit(1);
  }
}

assertPandoc();

const mirrorStates = selectedMirrorConfigs.map(createMirrorState);
const docLookups = new Map(
  mirrorStates.map((state) => [
    state.config.repoSlug,
    new Map(state.docs.map((doc) => [doc.sourceRepoRel, doc.outputRel]))
  ])
);

let changedFiles = 0;

for (const state of mirrorStates) {
  const navGroups = buildNavGroups(state.docs, state.config.categoryOrder);
  const navSequence = navGroups.flatMap((group) => group.entries);

  for (const doc of state.docs) {
    const fragment = renderMarkdown(stripMarkdownTableOfContents(doc.markdown));
    const bodyHtml = rewriteLinks(
      stripFirstHeading(fragment),
      doc,
      state.config,
      docLookups
    );
    const html = wrapMirrorDocPage({
      config: state.config,
      doc,
      navGroups,
      navSequence,
      bodyHtml,
      tocEntries: collectGeneratedDocHeadings(bodyHtml)
    });

    changedFiles += writeFile(path.join(publicRoot, doc.outputRel), html);
  }

  changedFiles += writeFile(
    path.join(publicRoot, state.config.indexOutputRel),
    wrapMirrorIndexPage(state.config, navGroups)
  );
}

const baseSearchEntries = JSON.parse(fs.readFileSync(searchBasePath, "utf8"));
const existingSearchEntries = fs.existsSync(generatedSearchIndexPath)
  ? JSON.parse(fs.readFileSync(generatedSearchIndexPath, "utf8"))
  : [];
const allMirrorSearchEntries = mirrorConfigs.flatMap((config) => {
  if (!selectedMirrorIds.has(config.id)) {
    return preserveExistingMirrorSearchEntries(existingSearchEntries, config);
  }

  const state = mirrorStates.find((candidate) => candidate.config.id === config.id);
  return [
    config.collectionSearchEntry,
    ...state.docs.map((doc) => ({
      title: `${config.searchTitlePrefix}: ${doc.title}`,
      url: `/${doc.outputRel}`,
      excerpt: doc.summary,
      keywords: buildKeywords(doc, config)
    }))
  ];
});

changedFiles += writeFile(
  generatedSearchIndexPath,
  `${JSON.stringify([...baseSearchEntries, ...allMirrorSearchEntries], null, 2)}\n`
);

if (isCheck && changedFiles > 0) {
  console.error("Generated repo mirror docs are out of date. Run `npm run generate:repo-docs`.");
  process.exit(1);
}

const generatedSummary = mirrorStates
  .map((state) => `${state.docs.length} ${state.config.consoleLabel} pages`)
  .join(" and ");

console.log(`${isCheck ? "Checked" : "Generated"} ${generatedSummary}.`);

function parseMirrorSelection(rawArgs, configs) {
  const selected = new Set();

  for (let index = 0; index < rawArgs.length; index += 1) {
    if (rawArgs[index] !== "--mirror") {
      continue;
    }

    const rawValue = rawArgs[index + 1];
    if (!rawValue) {
      console.error("Expected a value after --mirror.");
      process.exit(1);
    }

    for (const value of rawValue.split(",")) {
      const normalized = value.trim().toLowerCase();
      if (!normalized || normalized === "all") {
        configs.forEach((config) => selected.add(config.id));
        continue;
      }

      const match = configs.find((config) => config.id === normalized);
      if (!match) {
        console.error(`Unknown mirror id '${value}'. Expected one of: ${configs.map((config) => config.id).join(", ")}`);
        process.exit(1);
      }

      selected.add(match.id);
    }
  }

  if (!selected.size) {
    configs.forEach((config) => selected.add(config.id));
  }

  return selected;
}

function preserveExistingMirrorSearchEntries(existingEntries, config) {
  const prefix = `/${config.outputRootRel}/`;
  return existingEntries.filter((entry) => typeof entry.url === "string" && entry.url.startsWith(prefix));
}

function createSpecConfig() {
  const repoRoot = resolveRepoRoot("--spec-dir", "../spec");
  const docsRoot = path.join(repoRoot, "docs");

  return {
    id: "spec",
    repoSlug: "MCPAQL/spec",
    repoLabel: "MCPAQL/spec",
    repoRoot,
    docsRoot,
    githubBase: "https://github.com/MCPAQL/spec/blob/main",
    outputRootRel: "spec",
    indexOutputRel: "spec/index.html",
    consoleLabel: "spec",
    searchTitlePrefix: "Spec",
    collectionSearchEntry: {
      title: "Repo-Synced Spec Reference",
      url: "/spec/index.html",
      excerpt:
        "Full website-hosted mirror of the MCP-AQL spec docs generated from the specification repository source.",
      keywords: ["spec mirror", "repo synced", "full docs", "reference", "generated"]
    },
    siteSectionTitle: "MCP-AQL Spec",
    navTitle: "Repo-Synced Spec",
    navNote:
      "Generated from `MCPAQL/spec` so the website carries the deeper protocol material too.",
    docStatusPill: "REPO-SYNCED SPEC DOC",
    docCollectionLabel: "Full Spec Reference",
    docCollectionButtonLabel: "Browse Full Spec Reference",
    sourcePathPrefix: "spec",
    footerLinks: [
      { label: "Docs Library", href: "docs/index.html" },
      { label: "Repo-Synced Spec", href: "spec/index.html" },
      { label: "MCPAQL Organization", href: "https://github.com/MCPAQL" },
      { label: "Dollhouse Research", href: "https://dollhouseresearch.com" }
    ],
    docBreadcrumbTrail: [{ label: "Full Spec", href: "spec/index.html" }],
    indexBreadcrumbTrail: [],
    indexDescription:
      "Repo-synced full MCP-AQL spec reference generated from the specification repository.",
    indexStatusPill: "REPO-SYNCED SPEC REFERENCE",
    indexHeading: "The deeper protocol docs now live on the website too",
    indexLede:
      "These pages are generated from `MCPAQL/spec` so the public site can carry the full protocol and adapter material, not just summaries and links back to GitHub.",
    indexHeroActions: [
      { label: "Read The Normative Draft", href: "spec/versions/v1.0.0-draft.html", variant: "primary" },
      { label: "Back To Docs Library", href: "docs/index.html", variant: "secondary" }
    ],
    indexUsageTitle: "How To Use This Section",
    indexUsagePoints: [
      'Use the summary pages in <a href="../docs/index.html">Docs Library</a> for orientation and launch framing.',
      "Use this repo-synced reference for the fuller spec text hosted directly on the website.",
      "In case of conflict, the versioned draft under <code>versions/</code> remains the normative source."
    ],
    categoryOrder: [
      "Core",
      "Versions",
      "Adapter",
      "Security",
      "Features",
      "Guides",
      "Process",
      "Architecture",
      "Research",
      "Reference",
      "ADRs"
    ],
    categoryFor(sourceRepoRel) {
      const firstSegment = sourceRepoRel.split("/")[0];
      const mapping = new Map([
        ["overview.md", "Core"],
        ["crude-pattern.md", "Core"],
        ["endpoint-modes.md", "Core"],
        ["introspection.md", "Core"],
        ["operations.md", "Core"],
        ["error-codes.md", "Core"],
        ["conformance-testing.md", "Core"],
        ["plugin-contracts.md", "Core"],
        ["versions", "Versions"],
        ["adapter", "Adapter"],
        ["security", "Security"],
        ["features", "Features"],
        ["guides", "Guides"],
        ["process", "Process"],
        ["architecture", "Architecture"],
        ["research", "Research"],
        ["reference", "Reference"],
        ["adr", "ADRs"]
      ]);

      return mapping.get(firstSegment) || mapping.get(path.basename(sourceRepoRel)) || "Core";
    },
    includeSourceRel(sourceRepoRel) {
      return !sourceRepoRel.startsWith("agent/development/");
    },
    extraSources: [
      {
        sourceRepoRel: "README.md",
        outputRel: "spec/repo/README.html",
        category: "Core",
        scopeLabel: "Repository source"
      },
      {
        sourceRepoRel: "CHANGELOG.md",
        outputRel: "spec/repo/CHANGELOG.html",
        category: "Process",
        scopeLabel: "Repository source"
      }
    ],
    extraDocActions(doc) {
      return [];
    }
  };
}

function createAdapterConfig() {
  const repoRoot = resolveRepoRoot("--adapter-dir", "../mcpaql-adapter");
  const docsRoot = path.join(repoRoot, "docs");

  return {
    id: "adapter",
    repoSlug: "MCPAQL/mcpaql-adapter",
    repoLabel: "MCPAQL/mcpaql-adapter",
    repoRoot,
    docsRoot,
    githubBase: "https://github.com/MCPAQL/mcpaql-adapter/blob/main",
    outputRootRel: "adapter-reference",
    indexOutputRel: "adapter-reference/index.html",
    consoleLabel: "adapter reference",
    searchTitlePrefix: "Adapter",
    collectionSearchEntry: {
      title: "Reference Adapter Docs",
      url: "/adapter-reference/index.html",
      excerpt:
        "Website-hosted mirror of the reference adapter repo docs covering runtime architecture, guides, ADRs, and examples.",
      keywords: ["adapter docs", "implementation", "runtime", "guides", "reference adapter"]
    },
    siteSectionTitle: "MCP-AQL Adapter Reference",
    navTitle: "Reference Adapter Docs",
    navNote:
      "Generated from `MCPAQL/mcpaql-adapter` so the website carries the implementation architecture, guides, and ADRs too.",
    docStatusPill: "REPO-SYNCED ADAPTER DOC",
    docCollectionLabel: "Reference Adapter Docs",
    docCollectionButtonLabel: "Browse Reference Adapter Docs",
    sourcePathPrefix: "mcpaql-adapter",
    footerLinks: [
      { label: "Adapter Patterns", href: "apis/index.html" },
      { label: "Reference Adapter Docs", href: "adapter-reference/index.html" },
      { label: "Reference Adapter Repo", href: "https://github.com/MCPAQL/mcpaql-adapter" },
      { label: "Dollhouse Research", href: "https://dollhouseresearch.com" }
    ],
    docBreadcrumbTrail: [
      { label: "Adapter Patterns", href: "apis/index.html" },
      { label: "Reference Adapter Docs", href: "adapter-reference/index.html" }
    ],
    indexBreadcrumbTrail: [{ label: "Adapter Patterns", href: "apis/index.html" }],
    indexDescription:
      "Repo-synced implementation documentation for the MCP-AQL reference adapter generated from the adapter repository.",
    indexStatusPill: "REPO-SYNCED IMPLEMENTATION REFERENCE",
    indexHeading: "The reference adapter docs now live on the website too",
    indexLede:
      "These pages are generated from `MCPAQL/mcpaql-adapter` so implementers can read the runtime architecture, practical guides, and ADRs on the website instead of bouncing out to GitHub.",
    indexHeroActions: [
      { label: "Open Adapter Patterns", href: "apis/index.html", variant: "primary" },
      { label: "Implementation Profiles", href: "docs/implementation-profiles.html", variant: "secondary" }
    ],
    indexUsageTitle: "How To Use This Section",
    indexUsagePoints: [
      'Use <a href="../apis/index.html">Adapter Patterns</a> to choose the correct target-system shape first.',
      "Use this repo-synced section for runtime architecture, development workflow, testing guidance, migration notes, and implementation ADRs.",
      'When you need normative protocol rules, jump to the website-hosted <a href="../spec/index.html">Full Spec Reference</a>.'
    ],
    categoryOrder: ["Overview", "Architecture", "Guides", "ADRs", "Examples"],
    categoryFor(sourceRepoRel) {
      if (sourceRepoRel === "README.md") {
        return "Overview";
      }

      const firstSegment = sourceRepoRel.split("/")[0];
      const mapping = new Map([
        ["architecture", "Architecture"],
        ["guides", "Guides"],
        ["adr", "ADRs"],
        ["examples", "Examples"]
      ]);

      return mapping.get(firstSegment) || "Overview";
    },
    includeSourceRel(sourceRepoRel) {
      return !sourceRepoRel.startsWith("session-notes/");
    },
    extraSources: [
      {
        sourceRepoRel: "README.md",
        outputRel: "adapter-reference/repo/README.html",
        category: "Overview",
        scopeLabel: "Repository source"
      },
      {
        sourceRepoRel: "examples/README.md",
        outputRel: "adapter-reference/examples/README.html",
        category: "Examples",
        scopeLabel: "Repository source"
      }
    ],
    extraDocActions(doc) {
      return [
        {
          label: "Adapter Patterns Hub",
          href: relativePathFromDoc(doc.outputRel, "apis/index.html"),
          variant: "secondary"
        }
      ];
    }
  };
}

function resolveRepoRoot(flag, fallbackRel) {
  const argIndex = args.indexOf(flag);
  const override = argIndex >= 0 && args[argIndex + 1] ? args[argIndex + 1] : fallbackRel;
  return path.resolve(siteRoot, override);
}

function createMirrorState(config) {
  const docs = [
    ...collectDocs(config.docsRoot, config.includeSourceRel).map((sourceFile) => {
      const sourceRel = path.relative(config.docsRoot, sourceFile).replace(/\\/g, "/");
      return createDocRecord({
        sourceFile,
        sourceRepoRel: `docs/${sourceRel}`,
        outputRel: `${config.outputRootRel}/${sourceRel.replace(/\.md$/i, ".html")}`,
        category: config.categoryFor(sourceRel),
        scopeLabel: "Support document"
      });
    }),
    ...config.extraSources
      .map((source) => {
        const sourceFile = path.join(config.repoRoot, source.sourceRepoRel);
        if (!fs.existsSync(sourceFile)) {
          return null;
        }

        return createDocRecord({
          sourceFile,
          sourceRepoRel: source.sourceRepoRel,
          outputRel: source.outputRel,
          category: source.category,
          scopeLabel: source.scopeLabel
        });
      })
      .filter(Boolean)
  ];

  return {
    config,
    docs
  };
}

function createDocRecord({ sourceFile, sourceRepoRel, outputRel, category, scopeLabel }) {
  const markdown = fs.readFileSync(sourceFile, "utf8");
  const { body, metadata } = splitFrontMatter(markdown);
  const title = extractTitle(body, sourceRepoRel, metadata);
  const status = extractField(body, "Status", metadata);
  const version = extractField(body, "Version", metadata);
  const lastUpdated = extractField(body, "Last Updated", metadata);
  const summary = extractSummary(body, title);

  return {
    sourceFile,
    sourceRepoRel,
    outputRel,
    markdown,
    title,
    status,
    version,
    lastUpdated,
    summary,
    category,
    scopeLabel
  };
}

function assertPandoc() {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
  } catch (error) {
    console.error("pandoc is required to generate the repo-synced website docs.");
    process.exit(1);
  }
}

function collectDocs(rootDir, includeSourceRel) {
  const files = [];

  walk(rootDir);

  return files.sort((left, right) => left.localeCompare(right));

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const rel = path.relative(rootDir, absolute).replace(/\\/g, "/");
      if (!includeSourceRel(rel)) {
        continue;
      }

      files.push(absolute);
    }
  }
}

function extractTitle(markdown, sourceRel, metadata = {}) {
  if (metadata.title) {
    return metadata.title.trim();
  }

  let inCodeFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (!inCodeFence && /^#\s+/.test(trimmed)) {
      return trimmed.replace(/^#\s+/, "").trim();
    }
  }

  return sourceRel
    .replace(/\.md$/i, "")
    .split("/")
    .pop()
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (value) => value.toUpperCase());
}

function extractField(markdown, label, metadata = {}) {
  const normalizedKey = label.toLowerCase().replace(/\s+/g, "_");
  if (metadata[normalizedKey]) {
    return metadata[normalizedKey].trim();
  }

  const expression = new RegExp(`^\\*\\*${escapeRegExp(label)}:\\*\\*\\s+(.+)$`, "m");
  const match = markdown.match(expression);
  return match ? match[1].trim() : "";
}

function extractSummary(markdown, title) {
  const lines = markdown.split(/\r?\n/);
  let inCodeFence = false;
  let skipToc = false;
  const paragraph = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    if (trimmed === "## Table of Contents") {
      skipToc = true;
      continue;
    }

    if (skipToc) {
      if (trimmed === "---") {
        skipToc = false;
      }
      continue;
    }

    if (!trimmed) {
      if (paragraph.length) {
        break;
      }
      continue;
    }

    if (
      /^\*\*(Version|Status|Last Updated|Moved from):\*\*/.test(trimmed) ||
      /^>\s*\*\*Note:\*\*/.test(trimmed) ||
      /^[a-z_]+:\s+.+$/i.test(trimmed) ||
      /^[-*+]\s+/.test(trimmed) ||
      /^\d+\.\s+/.test(trimmed) ||
      /^#{1,6}\s+/.test(trimmed) ||
      /^\|/.test(trimmed)
    ) {
      continue;
    }

    paragraph.push(trimmed.replace(/^>\s?/, ""));
  }

  if (!paragraph.length) {
    return title;
  }

  return stripMarkdown(paragraph.join(" ")).slice(0, 220);
}

function renderMarkdown(markdown) {
  return execFileSync("pandoc", ["--from=gfm", "--to=html5", "--wrap=none"], {
    input: markdown,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  });
}

function stripFirstHeading(html) {
  return html.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, "");
}

function rewriteLinks(html, currentDoc, currentConfig, docLookups) {
  return html.replace(/\b(href|src)="([^"]+)"/g, (fullMatch, attribute, target) => {
    return `${attribute}="${resolveTarget(target, currentDoc, currentConfig, docLookups)}"`;
  });
}

function resolveTarget(target, currentDoc, currentConfig, docLookups) {
  if (!target || target.startsWith("#") || target.startsWith("/") || /^mailto:|^tel:/i.test(target)) {
    return target;
  }

  if (/^[a-z]+:/i.test(target)) {
    const parsedGitHubTarget = parseGithubTarget(target);
    if (!parsedGitHubTarget) {
      return target;
    }

    const localTarget = resolveMirrorTarget(
      parsedGitHubTarget.repoSlug,
      parsedGitHubTarget.repoRelativeTarget,
      currentDoc.outputRel,
      docLookups,
      parsedGitHubTarget.anchor
    );

    return localTarget || target;
  }

  const [rawPath, hash = ""] = target.split("#");
  const anchor = hash ? `#${hash}` : "";
  const repoRelativeTarget = path
    .normalize(path.join(path.dirname(currentDoc.sourceRepoRel), rawPath))
    .replace(/\\/g, "/");

  const localTarget = resolveMirrorTarget(
    currentConfig.repoSlug,
    repoRelativeTarget,
    currentDoc.outputRel,
    docLookups,
    anchor
  );
  if (localTarget) {
    return localTarget;
  }

  return `${currentConfig.githubBase}/${repoRelativeTarget}${anchor}`;
}

function parseGithubTarget(target) {
  const match = target.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|tree)\/[^/]+\/(.+?)(?:#(.+))?$/
  );
  if (!match) {
    return null;
  }

  return {
    repoSlug: match[1],
    repoRelativeTarget: match[2],
    anchor: match[3] ? `#${match[3]}` : ""
  };
}

function resolveMirrorTarget(repoSlug, repoRelativeTarget, currentOutputRel, docLookups, anchor = "") {
  const lookup = docLookups.get(repoSlug);
  if (!lookup) {
    return null;
  }

  const normalized = repoRelativeTarget.replace(/\\/g, "/").replace(/^\.\//, "");

  if (normalized.endsWith(".md") && lookup.has(normalized)) {
    return `${relativePathWithinPublic(currentOutputRel, lookup.get(normalized))}${anchor}`;
  }

  if (!path.extname(normalized)) {
    const readmeRel = `${normalized.replace(/\/$/, "")}/README.md`;
    if (lookup.has(readmeRel)) {
      return `${relativePathWithinPublic(currentOutputRel, lookup.get(readmeRel))}${anchor}`;
    }
  }

  return null;
}

function buildNavGroups(docs, categoryOrder) {
  const grouped = new Map();
  for (const category of categoryOrder) {
    grouped.set(category, []);
  }

  for (const doc of docs) {
    if (!grouped.has(doc.category)) {
      grouped.set(doc.category, []);
    }
    grouped.get(doc.category).push(doc);
  }

  return Array.from(grouped.entries())
    .map(([category, entries]) => ({ category, entries }))
    .filter((group) => group.entries.length > 0);
}

function wrapMirrorDocPage({ config, doc, navGroups, navSequence, bodyHtml, tocEntries }) {
  const navHtml = renderNavGroups(navGroups, doc.outputRel);
  const pageNavHtml = renderDocPageNav(doc, navSequence, config.indexOutputRel);
  const tocHtml = renderTocSection(tocEntries);
  const sourceUrl = `${config.githubBase}/${doc.sourceRepoRel}`;
  const metaBits = [
    `<span class="state-chip live">${escapeHtml(doc.scopeLabel)}</span>`,
    doc.status ? `<span class="state-chip pending">${escapeHtml(doc.status)}</span>` : "",
    doc.version ? `<span class="state-chip">${escapeHtml(doc.version)}</span>` : "",
    doc.lastUpdated ? `<span class="state-chip">${escapeHtml(doc.lastUpdated)}</span>` : ""
  ]
    .filter(Boolean)
    .join("");
  const heroActions = [
    {
      label: "Open Source Markdown",
      href: sourceUrl,
      variant: "primary"
    },
    {
      label: config.docCollectionButtonLabel,
      href: relativePathFromDoc(doc.outputRel, config.indexOutputRel),
      variant: "secondary"
    },
    ...config.extraDocActions(doc)
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(doc.summary)}">
  <title>${escapeHtml(config.siteSectionTitle)} | ${escapeHtml(doc.title)}</title>
  ${renderFontStylesheetTags()}
  <link rel="stylesheet" href="${relativeAssetPath(doc.outputRel, "css/style.css")}">
</head>
<body>
  <header>
    <div class="container">
      <nav>
        <a class="logo" href="${relativePathFromDoc(doc.outputRel, "index.html")}"><span class="logo-mark"></span>MCP-AQL</a>
        <ul class="nav-links">
          <li><a href="${relativePathFromDoc(doc.outputRel, "index.html")}">Home</a></li>
          <li><a href="${relativePathFromDoc(doc.outputRel, "docs/index.html")}">Docs</a></li>
          <li><a href="${relativePathFromDoc(doc.outputRel, "launch-checklist.html")}">Launch Checklist</a></li>
          <li><a href="${relativePathFromDoc(doc.outputRel, "apis/index.html")}">Adapter Patterns</a></li>
          <li><a href="${relativePathFromDoc(doc.outputRel, "case-studies/github-mcp.html")}">Case Studies</a></li>
        </ul>
        <form class="site-search" data-search-form data-index-url="${relativePathFromDoc(doc.outputRel, "data/search-index.json")}" role="search">
          <label class="sr-only" for="site-search-input">Search MCP-AQL docs</label>
          <input id="site-search-input" data-search-input type="search" placeholder="Search MCP-AQL docs, spec pages, and adapter patterns...">
          <span class="search-count" data-search-count></span>
          <ul class="search-results" data-search-results hidden></ul>
        </form>
      </nav>
    </div>
  </header>

  <main>
    <div class="container docs-shell">
      <aside class="docs-side">
        <h2>${escapeHtml(config.navTitle)}</h2>
        <p class="docs-side-note">${escapeHtml(config.navNote).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>
        ${navHtml}
      </aside>

      <article class="docs-main">
        <nav class="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href="${relativePathFromDoc(doc.outputRel, "index.html")}">Home</a></li>
            ${config.docBreadcrumbTrail
              .map(
                (entry) =>
                  `<li><a href="${relativePathFromDoc(doc.outputRel, entry.href)}">${escapeHtml(entry.label)}</a></li>`
              )
              .join("")}
            <li><span class="current">${escapeHtml(doc.title)}</span></li>
          </ol>
        </nav>
        <section class="hero docs-hero">
          <div class="hero-inner">
            <span class="status-pill">${escapeHtml(config.docStatusPill)}</span>
            <h1>${escapeHtml(doc.title)}</h1>
            <p class="lede">${escapeHtml(doc.summary)}</p>
            <div class="spec-meta">${metaBits}</div>
            <p class="spec-source">Source: <a href="${sourceUrl}">${escapeHtml(
              `${config.sourcePathPrefix}/${doc.sourceRepoRel}`
            )}</a></p>
            <div class="hero-actions">
              ${renderHeroActions(heroActions)}
            </div>
          </div>
        </section>
${tocHtml ? `\n${indentBlock(tocHtml, 8)}\n` : ""}

        <section>
          <div class="card spec-prose">
            ${bodyHtml}
          </div>
        </section>
        ${pageNavHtml}
      </article>
    </div>
  </main>

  <footer>
    <div class="container">
      <p>&copy; 2026 DollhouseMCP Inc. d/b/a Dollhouse Research. MCP-AQL public draft documentation portal.</p>
      <div class="footer-links">
        ${renderFooterLinks(config.footerLinks, doc.outputRel)}
      </div>
    </div>
  </footer>

  <script src="${relativeAssetPath(doc.outputRel, "js/search.js")}" defer></script>
</body>
</html>
`;
}

function wrapMirrorIndexPage(config, navGroups) {
  const sections = navGroups
    .map((group) => {
      const cards = group.entries
        .map((doc) => {
          const href = relativePathWithinPublic(config.indexOutputRel, doc.outputRel);
          return `<article class="card">
  <h3><a class="card-title-link" href="${href}">${escapeHtml(doc.title)}</a></h3>
  <p>${escapeHtml(doc.summary)}</p>
  <div class="spec-meta">
    <span class="state-chip live">${escapeHtml(doc.scopeLabel)}</span>
    ${doc.status ? `<span class="state-chip pending">${escapeHtml(doc.status)}</span>` : ""}
  </div>
</article>`;
        })
        .join("\n");

      return `<section>
  <h2 class="section-title">${escapeHtml(group.category)}</h2>
  <div class="grid cols-3 spec-index-grid">
    ${cards}
  </div>
</section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeHtml(config.indexDescription)}">
  <title>${escapeHtml(config.siteSectionTitle)} | ${escapeHtml(config.docCollectionLabel)}</title>
  ${renderFontStylesheetTags()}
  <link rel="stylesheet" href="${relativeAssetPath(config.indexOutputRel, "css/style.css")}">
</head>
<body>
  <header>
    <div class="container">
      <nav>
        <a class="logo" href="${relativePathFromDoc(config.indexOutputRel, "index.html")}"><span class="logo-mark"></span>MCP-AQL</a>
        <ul class="nav-links">
          <li><a href="${relativePathFromDoc(config.indexOutputRel, "index.html")}">Home</a></li>
          <li><a href="${relativePathFromDoc(config.indexOutputRel, "docs/index.html")}">Docs</a></li>
          <li><a href="${relativePathFromDoc(config.indexOutputRel, "launch-checklist.html")}">Launch Checklist</a></li>
          <li><a href="${relativePathFromDoc(config.indexOutputRel, "apis/index.html")}">Adapter Patterns</a></li>
          <li><a href="${relativePathFromDoc(config.indexOutputRel, "case-studies/github-mcp.html")}">Case Studies</a></li>
        </ul>
        <form class="site-search" data-search-form data-index-url="${relativePathFromDoc(
          config.indexOutputRel,
          "data/search-index.json"
        )}" role="search">
          <label class="sr-only" for="site-search-input">Search MCP-AQL docs</label>
          <input id="site-search-input" data-search-input type="search" placeholder="Search MCP-AQL docs, spec pages, and adapter patterns...">
          <span class="search-count" data-search-count></span>
          <ul class="search-results" data-search-results hidden></ul>
        </form>
      </nav>
    </div>
  </header>

  <main>
    <div class="container">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="${relativePathFromDoc(config.indexOutputRel, "index.html")}">Home</a></li>
          ${config.indexBreadcrumbTrail
            .map(
              (entry) =>
                `<li><a href="${relativePathFromDoc(config.indexOutputRel, entry.href)}">${escapeHtml(entry.label)}</a></li>`
            )
            .join("")}
          <li><span class="current">${escapeHtml(config.docCollectionLabel)}</span></li>
        </ol>
      </nav>
      <section class="hero">
        <div class="hero-inner">
          <span class="status-pill">${escapeHtml(config.indexStatusPill)}</span>
          <h1>${escapeHtml(config.indexHeading)}</h1>
          <p class="lede">${escapeHtml(config.indexLede).replace(/`([^`]+)`/g, "<code>$1</code>")}</p>
          <div class="hero-actions">
            ${renderHeroActions(
              config.indexHeroActions.map((action) => ({
                ...action,
                href: relativePathFromDoc(config.indexOutputRel, action.href)
              }))
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 class="section-title">${escapeHtml(config.indexUsageTitle)}</h2>
        <div class="card">
          <ul>
            ${config.indexUsagePoints.map((point) => `<li>${point}</li>`).join("")}
          </ul>
        </div>
      </section>

      ${sections}
    </div>
  </main>

  <footer>
    <div class="container">
      <p>&copy; 2026 DollhouseMCP Inc. d/b/a Dollhouse Research. MCP-AQL public draft documentation portal.</p>
      <div class="footer-links">
        ${renderFooterLinks(config.footerLinks, config.indexOutputRel)}
      </div>
    </div>
  </footer>

  <script src="${relativeAssetPath(config.indexOutputRel, "js/search.js")}" defer></script>
</body>
</html>
`;
}

function renderFontStylesheetTags() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="${fontStylesheetUrl}">
  <link href="${fontStylesheetUrl}" rel="stylesheet" media="print" onload="this.onload=null;this.media='all'">
  <noscript><link href="${fontStylesheetUrl}" rel="stylesheet"></noscript>`;
}

function renderHeroActions(actions) {
  return actions
    .map(
      (action) =>
        `<a class="btn btn-${action.variant || "secondary"}" href="${action.href}">${escapeHtml(action.label)}</a>`
    )
    .join("");
}

function renderFooterLinks(links, currentOutputRel) {
  return links
    .map((link) => {
      const href = /^[a-z]+:/i.test(link.href)
        ? link.href
        : relativePathFromDoc(currentOutputRel, link.href);
      return `<a href="${href}">${escapeHtml(link.label)}</a>`;
    })
    .join("");
}

function renderNavGroups(navGroups, currentOutputRel) {
  return navGroups
    .map((group) => {
      const links = group.entries
        .map((entry) => {
          const href = relativePathWithinPublic(currentOutputRel, entry.outputRel);
          const currentAttr =
            entry.outputRel === currentOutputRel ? ' class="current" aria-current="page"' : "";
          return `<li><a${currentAttr} href="${href}">${escapeHtml(entry.title)}</a></li>`;
        })
        .join("");

      return `<div class="docs-side-group">
  <h3>${escapeHtml(group.category)}</h3>
  <ul>${links}</ul>
</div>`;
    })
    .join("");
}

function renderDocPageNav(doc, navSequence, indexOutputRel) {
  const currentIndex = navSequence.findIndex((entry) => entry.outputRel === doc.outputRel);
  const previousDoc = currentIndex > 0 ? navSequence[currentIndex - 1] : null;
  const nextDoc = currentIndex >= 0 && currentIndex < navSequence.length - 1 ? navSequence[currentIndex + 1] : null;

  return renderPageNav({
    previous: previousDoc
      ? {
          href: relativePathWithinPublic(doc.outputRel, previousDoc.outputRel),
          eyebrow: "Previous page",
          label: previousDoc.title
        }
      : {
          href: relativePathFromDoc(doc.outputRel, indexOutputRel),
          eyebrow: "Reference overview",
          label: path.basename(path.dirname(indexOutputRel)) === "spec" ? "Full Spec Reference" : "Reference Adapter Docs"
        },
    next: nextDoc
      ? {
          href: relativePathWithinPublic(doc.outputRel, nextDoc.outputRel),
          eyebrow: "Next page",
          label: nextDoc.title
        }
      : {
          href: relativePathFromDoc(doc.outputRel, indexOutputRel),
          eyebrow: "Back to index",
          label: path.basename(path.dirname(indexOutputRel)) === "spec" ? "Full Spec Reference" : "Reference Adapter Docs"
        }
  });
}

function renderPageNav({ previous, next }) {
  return `<nav class="page-nav" aria-label="Page navigation">
  ${renderPageNavLink(previous, "prev")}
  ${renderPageNavLink(next, "next")}
</nav>`;
}

function renderPageNavLink(entry, direction) {
  return `<a class="page-nav-link ${direction}" href="${entry.href}">
    <span class="page-nav-eyebrow">${escapeHtml(entry.eyebrow)}</span>
    <strong class="page-nav-label">${escapeHtml(entry.label)}</strong>
  </a>`;
}

function buildKeywords(doc, config) {
  const pathWords = doc.sourceRepoRel
    .replace(/\.md$/i, "")
    .split(/[\/\-]/)
    .map((value) => value.toLowerCase())
    .filter(Boolean);

  const titleWords = doc.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  return Array.from(
    new Set([config.id, doc.category.toLowerCase(), ...pathWords, ...titleWords])
  ).slice(0, 12);
}

function relativeAssetPath(currentOutputRel, assetRelFromPublic) {
  return relativePathWithinPublic(currentOutputRel, assetRelFromPublic);
}

function relativePathFromDoc(currentOutputRel, publicRel) {
  return relativePathWithinPublic(currentOutputRel, publicRel);
}

function relativePathWithinPublic(fromRel, toRel) {
  const relative = path.relative(path.dirname(fromRel), toRel).replace(/\\/g, "/");
  return relative || path.basename(toRel);
}

function writeFile(targetPath, content) {
  const existing = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : null;
  if (existing === content) {
    return 0;
  }

  if (!isCheck) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
  }

  return 1;
}

function stripMarkdown(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/[_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitFrontMatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { metadata: {}, body: markdown };
  }

  const endIndex = markdown.indexOf("\n---\n", 4);
  if (endIndex < 0) {
    return { metadata: {}, body: markdown };
  }

  const rawFrontMatter = markdown.slice(4, endIndex);
  const body = markdown.slice(endIndex + 5);
  const metadata = {};

  for (const line of rawFrontMatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    metadata[match[1].trim().toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, "");
  }

  return { metadata, body };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
