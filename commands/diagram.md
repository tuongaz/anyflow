---
description: Generate a playable AnyDemo architecture diagram from the current codebase
argument-hint: "[free-text request] [--scope=<name>] [--tier=real|mock|static]"
---

Use the `diagram` skill (full instructions in `SKILL.md` — found
at either `$PLUGIN_ROOT/skills/diagram/SKILL.md` for a plugin install, or
`$PLUGIN_ROOT/SKILL.md` for a flat-skill install; the skill's Phase 0
resolves both layouts into `$SKILL_DIR`) to generate a playable
single-flat AnyDemo diagram for the current repository.

User request: `$ARGUMENTS`

Run the full pipeline:

1. **Phase 0** — Pre-flight: resolve `$TARGET` (cwd unless overridden),
   `$STUDIO_URL` (default `http://localhost:4321`), `$PLUGIN_ROOT`, and
   `$SKILL_DIR` (env `CLAUDE_PLUGIN_ROOT` → `~/.claude/plugins/diagram`
   → `~/.claude/skills/diagram` → cwd; first hit wins, and the
   resolver auto-detects plugin vs flat-skill layout). Probe
   `GET $STUDIO_URL/health`. Create `.anydemo/intermediate/`.
2. **Phase 1** — Run the two filesystem scripts under
   `$SKILL_DIR/scripts/` (`scan-target.mjs`, `extract-routes.mjs`), then
   `POST $STUDIO_URL/api/diagram/propose-scope`, then dispatch the
   `target-scanner` subagent.
3. **Phase 2** — Dispatch `scope-proposer`. CHECKPOINT 1 unless `--scope=` was passed.
4. **Phase 3** — Dispatch `tier-detector`. CHECKPOINT 2 unless `--tier=` was passed.
5. **Phase 4** — Dispatch `node-selector`. CHECKPOINT 3 (always).
6. **Phase 5** — Dispatch `wiring-builder` (and `harness-author` on Tier 2).
   The wiring plan MUST include a top-level `"name"` so the studio doesn't
   register the demo as "Untitled diagram".
7. **Phase 6** — Dispatch `layout-arranger`.
8. **Phase 7** — `POST $STUDIO_URL/api/diagram/assemble` and
   `POST $STUDIO_URL/api/demos/validate`. On validation failure, return to
   Phase 5 (max 2 retries).
9. **Phase 8** — `POST $STUDIO_URL/api/demos/register`, report
   `$STUDIO_URL/d/<slug>`, and run `open <url>` (or `xdg-open` on Linux) so
   the browser opens the canvas automatically. If the canvas appears blank,
   walk the user through the four-step recovery in
   `skills/diagram/references/troubleshooting.md` (hard-refresh, direct slug
   URL, confirm registration, tail studio logs).

Use `AskUserQuestion` for the three checkpoints. Preserve `.anydemo/intermediate/`
on failure for resumability.

The diagram is **for humans to read at a glance** — duplicate cross-cutting
nodes (db, cache, auth, queues) per consumer rather than letting many
connectors converge on a single box. See the "Visual clarity for humans"
section in `SKILL.md` for the rules every phase enforces.
