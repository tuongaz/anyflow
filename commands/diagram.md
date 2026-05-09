---
description: Generate a playable AnyDemo architecture diagram from the current codebase
argument-hint: "[free-text request] [--scope=<name>] [--tier=real|mock|static]"
---

Use the `anydemo-diagram` skill (in `skills/diagram/SKILL.md`) to generate a
playable single-flat AnyDemo diagram for the current repository.

User request: `$ARGUMENTS`

Run the full pipeline:

1. **Phase 0** — Pre-flight: resolve target root (cwd unless overridden),
   create `.anydemo/intermediate/`.
2. **Phase 1** — Run `scan-target.mjs`, `extract-routes.mjs`, and
   `propose-scope.mjs`, then dispatch the `target-scanner` subagent.
3. **Phase 2** — Dispatch `scope-proposer`. CHECKPOINT 1 unless `--scope=` was passed.
4. **Phase 3** — Dispatch `tier-detector`. CHECKPOINT 2 unless `--tier=` was passed.
5. **Phase 4** — Dispatch `node-selector`. CHECKPOINT 3 (always).
6. **Phase 5** — Dispatch `wiring-builder` (and `harness-author` on Tier 2).
7. **Phase 6** — Dispatch `layout-arranger`.
8. **Phase 7** — Run `assemble-demo.mjs` and `validate-demo.mjs`. On
   validation failure, return to Phase 5 (max 2 retries).
9. **Phase 8** — Run `anydemo register --path <target>` and report the URL.

Use `AskUserQuestion` for the three checkpoints. Preserve `.anydemo/intermediate/`
on failure for resumability.

See `skills/diagram/SKILL.md` for the full pipeline contract and constraints.
