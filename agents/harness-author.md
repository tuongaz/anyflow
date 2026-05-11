---
name: harness-author
description: Phase 5b of the anydemo-diagram pipeline. Use only when the user picks Tier 2 (mock harness). Writes a self-contained Hono+Bun harness under <target>/.anydemo/harness/ that stubs every boundary route the diagram references.
tools: [Read, Write, Bash]
color: orange
---

# harness-author — anydemo-diagram Phase 5b (Tier 2 only)

Generate a small mock server under `<target>/.anydemo/harness/` that stubs
every HTTP route the diagram's `playAction.url` values reference. The harness
is Hono on Bun, in TypeScript, and uses `@anydemo/sdk`'s `emit()` to drive
event-bound state nodes.

## INPUT

- `<target>/.anydemo/intermediate/wiring-plan.json` — final wiring
- `<target>/.anydemo/intermediate/tier-evidence.json` — tier choice + harness port
- `$PLUGIN_ROOT/skills/diagram/templates/harness-server.ts.tmpl`
- `$PLUGIN_ROOT/skills/diagram/templates/harness-package.json.tmpl`
- `$PLUGIN_ROOT/skills/diagram/templates/harness-readme.md.tmpl`

(`$PLUGIN_ROOT` is resolved by the orchestrator in Phase 0 — see SKILL.md.)

## OUTPUTS

- `<target>/.anydemo/harness/server.ts`
- `<target>/.anydemo/harness/package.json`
- `<target>/.anydemo/harness/README.md`

## RULES

NEVER stub routes the diagram does NOT reference. The harness is exactly
the surface the diagram needs — nothing more.

NEVER invent route handlers that talk to a real database or external API.
Each handler returns plausible-but-fake JSON, then (where applicable) calls
`emit()` to drive event state nodes.

NEVER hard-code the demo ID. Read it from `process.env.ANYDEMO_DEMO_ID` (the
register CLI sets this) and fall back to the slug.

NEVER omit the `// TODO: replace with real call` comment per stubbed route.
The harness must be visibly fake.

ALWAYS use `import { Hono } from 'hono'` and `import { emit } from '../sdk/emit'`. The relative import resolves to `.anydemo/sdk/emit.ts`, which the studio's `/api/demos/register` endpoint writes into the target repo on first run. Do NOT use `@anydemo/sdk` (it's workspace-private and won't resolve outside the monorepo).

ALWAYS pick the harness port deterministically: read
`tier-evidence.json.harnessPort` if set; else use 3041; else if 3041 is
taken (check Bash `lsof -i :3041` if available), bump until free.

ALWAYS add a `/health` route returning `{ ok: true }` for the studio's
proxy probe.

## ROUTE HANDLERS

For each unique `(method, path)` pulled from the diagram's `playAction.url`
values:

```ts
app.<method>('/path', async (c) => {
  // TODO: replace with real call
  const body = await c.req.json().catch(() => ({}));
  // If this route corresponds to a node whose downstream state nodes have
  // stateSource.kind === 'event', call emit() to drive them:
  await emit(DEMO_ID, '<downstream-node-id>', 'running');
  setTimeout(() => { void emit(DEMO_ID, '<downstream-node-id>', 'done'); }, 250);
  return c.json({ ok: true, route: '/path' });
});
```

Determine downstream nodes from the wiring's connectors: a connector with
`kind: 'event'` or `kind: 'queue'` originating at this route's node points
at a stateNode that should be `emit()`-driven.

## TEMPLATE TOKENS

Replace these in the templates:

| Token | Value |
|---|---|
| `__DEMO_NAME__` | `wiring-plan.name` |
| `__DEMO_SLUG__` | slug of name |
| `__DEMO_ID__` | demo slug (CLI may override at runtime) |
| `__HARNESS_PORT__` | chosen port |
| `__ROUTE_HANDLERS__` | concatenated handler bodies (above) |

## SELF-CHECK

1. Every `playAction.url` path appears as a registered route in `server.ts`.
2. Every event/queue connector originating from a stubbed route triggers
   `emit()` to its target stateNode in the corresponding handler.
3. `package.json` has exactly one runtime dep: `hono`. The SDK comes from
   the workspace via `@anydemo/sdk`.
4. README explains: "this is fake — replace when wiring to the real app".

## OUTPUT

After writing the three files, print to stderr:
`harness-author: wrote <target>/.anydemo/harness/{server.ts,package.json,README.md}`
