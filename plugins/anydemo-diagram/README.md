# anydemo-diagram

Claude Code plugin that walks an arbitrary codebase and emits a playable
[AnyDemo](https://github.com/anthropics/anydemo) diagram — a single flat
React-Flow canvas wired to the running app via REST + SSE.

## What it does

Run `/diagram <free-text request>` from inside a target repo (with Claude Code
attached), and the plugin will:

1. Scan the codebase for frameworks, runnability signals, and boundary surfaces
2. Propose a **scope** (the slice of architecture to diagram) — checkpoint 1
3. Detect runnability evidence and propose a **playability tier** — checkpoint 2
4. Pick ≤30 nodes and classify them static vs. dynamic — checkpoint 3
5. Wire connectors (`http` / `event` / `queue`) with real evidence
6. Lay out the diagram on a 24px grid
7. Validate against the studio's Zod `DemoSchema`
8. Register with the running studio via `anydemo register`

Three playability tiers:

- **Tier 1 — Real**: `playAction`s point at the user's running dev server
- **Tier 2 — Mock harness**: scaffolds `.anydemo/harness/` (Hono on Bun)
  stubbing the boundary routes
- **Tier 3 — Static**: rich `detail.summary` / `detail.fields` / `detail.filePath`
  but no live behavior

## Install

This plugin lives inside the `anydemo` monorepo at `plugins/anydemo-diagram/`.

For local development, point Claude Code at the plugin directory:

```bash
claude --plugin-dir /path/to/anydemo/plugins/anydemo-diagram
```

## Usage

```
/diagram show me how the order pipeline works
/diagram --tier=mock how does the auth flow work?
/diagram --scope=billing
```

## Output

In the **target repo**, the plugin writes:

```
.anydemo/
├── demo.json                 # final artifact, watched by studio
├── harness/                  # only if Tier 2
│   ├── server.ts
│   └── package.json
├── sdk/emit.ts               # written by `anydemo register` if any event nodes
└── intermediate/             # cleaned after success; preserved on failure
    ├── scan-result.json
    ├── scope-proposal.json
    ├── tier-evidence.json
    ├── candidate-nodes.json
    ├── wiring-plan.json
    └── layout.json
```

## Layout

```
plugins/anydemo-diagram/
├── .claude-plugin/plugin.json
├── package.json
├── README.md
├── skills/
│   └── diagram/
│       ├── SKILL.md
│       ├── frameworks/      (per-framework hints)
│       ├── scripts/         (deterministic .mjs)
│       └── templates/       (harness templates)
└── agents/                  (7 subagent definitions)
```

See `docs/plans/2026-05-09-playable-diagram-skill-design.md` in the monorepo
for the full design doc.
