# Contributing

Thank you for your interest in contributing to the MCP-AQL website.

## Workflow

- `main` is the production branch. GitHub Pages deploys from `main`.
- `develop` is reserved for shared staging and integration work when the repository maintainers enable it.
- Use a short-lived feature branch for changes. Prefixes such as `codex/`, `feature/`, `fix/`, or `docs/` are all acceptable.
- Open a pull request for review instead of pushing directly to `main`.
- Visual changes should include screenshots or rendered diff context when practical.

## Branching guidance

1. Branch from `main` for isolated fixes.
2. Keep pull requests focused on one content or infrastructure change.
3. Re-run local checks after editing HTML, Markdown, workflows, or search data.
4. Merge to `main` only after CI is green.

Preview strategy:

- Pull requests run repository quality checks.
- Pull requests that change site content also run VisiDelta preview generation for rendered diffs.
- `develop` pushes are intended for shared preview/build validation once the branch is created and protected on GitHub.

## Contribution requirements

- By submitting a pull request, you agree to the MCP-AQL CLA: `CLA.md`
- Keep public copy accurate to the current spec draft. Do not imply final certification or closed launch gates unless the source repositories show that status.
- Preserve the website's existing documentation voice: concise, public-facing, and explicit about canonical versus practical profile boundaries.

## Licensing

- This repository is licensed under AGPL-3.0. See `LICENSE`.
- Commercial licenses are available. See `COMMERCIAL-LICENSE.md`.
