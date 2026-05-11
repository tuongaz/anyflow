# Troubleshooting

Quick lookup for the most common failure modes of the anydemo-diagram
pipeline. Each row maps a symptom to a one-line fix.

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `curl: (7) Failed to connect ... 4321` in Phase 0 | Studio not running | `cd $PLUGIN_ROOT && bun run dev`, or set `ANYDEMO_STUDIO_URL` |
| Phase 1 fails with `node: cannot find scan-target.mjs` | `CLAUDE_PLUGIN_ROOT` unset and skill not in default locations | Re-run Phase 0 — the fallback chain expects the plugin install at `~/.claude/plugins/anydemo-diagram/` or the flat-skill install at `~/.claude/skills/anydemo-diagram/`. Symlink there if vendored elsewhere. |
| `scan-result.json` shows zero files | Target has no recognized framework | Add a framework hint file (`apps/<name>/package.json`, `pyproject.toml`, `Gemfile`) or check `$SKILL_DIR/frameworks/` for support |
| Demo registers as "Untitled diagram" | Phase 5 wiring plan missing top-level `name` | Phase 5 must emit `{"name": "<title>", ...}`. Use the title from `scope-proposal.json`. |
| `/api/demos/validate` rejects with "connector references unknown node" | Wiring used `from`/`to` instead of `source`/`target`, or a typo'd id | Re-run Phase 5 — the studio uses `source`/`target` only |
| `/api/demos/validate` rejects with "playNode requires playAction" | Tier-3 wiring missed a demotion | All `dynamic-play` candidates become `stateNode` on Tier 3 |
| Canvas blank at `/d/<slug>` | Stale SPA bundle | Hard-refresh (`Cmd+Shift+R`), or open `/d/<slug>` directly rather than the studio root |
| Spaghetti edges; "I can't tell what's going on" | Single fan-in node overloaded | Apply Visual clarity — duplicate `db`, `cache`, `auth` per consumer |
| `harness/server.ts` missing on Tier 2 | Phase 5b skipped | Re-dispatch `harness-author`; never edit harness templates by hand |

## If the canvas appears blank

The studio is a React SPA and the most common cause of a blank canvas is a
stale JavaScript bundle. Tell the user, in order:

1. **Hard-refresh the page** — `Cmd+Shift+R` (macOS) or `Ctrl+Shift+R`
   (Linux/Windows). Bypasses the SPA's cached bundle.
2. **Navigate directly to `<STUDIO_URL>/d/<slug>`** (not the studio root) —
   a deep link forces the registry to load the demo by slug.
3. **Confirm the demo is registered** — `curl -fsS "$STUDIO_URL/api/demos" | jq '.demos[] | select(.slug == "<slug>")'` should print the demo metadata.
4. **Tail the studio logs** — the validate/register endpoints log every
   rejection with a JSON body; a silent reject usually means the studio is
   on a different port than `$ANYDEMO_STUDIO_URL`.
