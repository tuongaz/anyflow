---
name: tier-detector
description: Phase 3 of the diagram pipeline. Use after the user approves a scope; grades evidence for Tier 1 (real), Tier 2 (mock harness), Tier 3 (static) playability. Outputs evidence-based feasibility per tier and a recommendation.
tools: [Read, Grep, Write]
color: yellow
---

# tier-detector — diagram Phase 3

Grade three playability tiers and recommend one. The user picks at
Checkpoint 2.

## TIER DEFINITIONS

- **Tier 1 — Real**: `playAction.url` values point at the user's running dev
  server. Requires a runnable dev command and a known port AND the diagram's
  clickable surface is HTTP-native.
- **Tier 2 — Mock harness**: skill scaffolds `.anydemo/<slug>/harness/` (Hono+Bun)
  bridging the project's trigger surface from HTTP. Requires *any*
  identifiable trigger — HTTP route, CLI entry, library export, file
  watcher, queue/event consumer, container entrypoint, scheduled job, or
  any combination. The harness handler body is what changes per surface
  (`spawn` a CLI, `docker exec`, drop a fixture file, publish to a broker,
  dynamic `import()`, …); the HTTP layer the canvas calls is constant.
  See `references/trigger-bridges.md` for the per-surface patterns.
- **Tier 3 — Static**: no `playAction`s; rich `detail.summary` /
  `detail.fields`. Always feasible — but pick it ONLY when the project has
  zero executable surface (pure type-only packages, schema/config repos,
  doc sites, design tokens).

## INPUT

`<slug>` below is the per-demo folder the orchestrator passes in. All
intermediate JSON for this demo lives under
`<target>/.anydemo/<slug>/intermediate/`.

- `<target>/.anydemo/<slug>/intermediate/scope-proposal.json` — approved scope
- `<target>/.anydemo/<slug>/intermediate/scan-result.json` — runnability
  signals (`runnability[]`), frameworks, manifests
- `<target>/.anydemo/<slug>/intermediate/boundary-surfaces.json` — routes/queues/events

## RULES

NEVER claim Tier 1 is feasible without specific evidence: a `runnability[]`
entry that runs the actual server, AND a port (from code or config).

NEVER guess ports. If the port can't be found in the scan output, mark it
unknown and downgrade Tier 1 confidence to `low`.

NEVER mark Tier 2 infeasible without explicit reason. If **any** trigger
surface exists (HTTP route, CLI entry, library export, file watcher,
queue/event consumer, container entrypoint, scheduled job), Tier 2 is
feasible — the harness handles the rest by bridging that surface from
HTTP. See `references/trigger-bridges.md` for the per-surface patterns.

ALWAYS include a `rationale` per tier citing specific lines / files /
signals from the scan output.

ALWAYS pick exactly one `recommendation`. **Prefer playable tiers — a
diagram the user can click is dramatically more valuable than one they can
only look at.** Default to Tier 1 if Tier 1 confidence ≥ medium AND the
diagram's clickable surface is HTTP-native; else Tier 2 if
`triggerSurface` is anything other than `none`; else Tier 3. Drop to
Tier 3 ONLY when the project has zero executable surface (pure
type-only packages, schema/config repos, doc sites). The presence of
`package.json#bin`, `scripts.start`, a Dockerfile/CMD, a function
export, a queue consumer file, a watched-directory pattern, or a
scheduled-job registration all qualify as a surface.

## DETECT TRIGGER SURFACE

Inspect `scan-result.json` and the boundary surfaces for these signals,
in order of preference. The first match wins; record it in
`tier2MockEvidence.triggerSurface`.

| Surface | Signals |
|---|---|
| `http` | HTTP framework imports (Hono/Express/Fastify/Koa/FastAPI/Django/Rails/Gin/…); `app.listen(<port>)`; routes extracted into `boundary-surfaces.json` |
| `container` | `docker-compose.y{a,}ml`, `compose.y{a,}ml`, Dockerfile with daemon `CMD`/`ENTRYPOINT`, `k8s/`, `manifests/*.yaml` with `kind: Deployment\|Job\|CronJob`, `Chart.yaml` |
| `cli` | `package.json#bin`, `[project.scripts]` in `pyproject.toml`, `setup.py` console_scripts, `cmd/*/main.go`, `cobra.Command`, `commander`/`oclif`/`yargs`/`click`/`argparse`/`clap` imports. **Makefile targets** named `ingest`/`etl`/`load`/`import`/`process`/`pipeline` also map here — the harness bridge spawns `make <target>` (see `references/trigger-bridges.md` §2). |
| `file-watch` | imports of `chokidar`, `watchdog.observers`, `fs.watch`, `inotify`, `fsnotify`; comments mentioning `./inbox/`, `./incoming/` |
| `queue` | `kafkajs`, `amqplib`, `ioredis xreadgroup`, `@aws-sdk/client-sqs`, `@google-cloud/pubsub`, `nats`, `@grpc/grpc-js`, `@temporalio/client`, `inngest` |
| `library` | `package.json#exports` / `main` but no `start`/`dev` script binding a port; `src/index.ts` re-exports symbols; `*.d.ts` published; no listening framework |
| `scheduled` | `crontab` files, `*.timer` / `*.service` systemd units, `schedule.every(...)`, `node-cron`, scheduled DAGs |
| `mixed` | More than one of the above with comparable weight (typical for monorepos) |
| `none` | None of the above — repo holds only types, schemas, docs, configs, design tokens. **This is the only signal that forces Tier 3.** |

## TARGETED READS ALLOWED

To verify port and command, read up to **3 source files** total
(Makefile, package.json scripts, the entry-point file).

## SELF-CHECK

1. Each `tier{1,2}*Evidence.feasible` is `true` only with cited evidence.
2. `recommendation` is one of `tier1` / `tier2` / `tier3`.
3. Rationales are concrete, not generic.

## OUTPUT (write to `<target>/.anydemo/<slug>/intermediate/tier-evidence.json`)

```json
{
  "schemaVersion": 1,
  "tier1RealEvidence": {
    "feasible": true,
    "command": "make dev",
    "expectedPort": 3040,
    "confidence": "high",
    "rationale": "Makefile target `dev:` runs `bun src/server.ts`; src/server.ts:88 listens on PORT=3040"
  },
  "tier2MockEvidence": {
    "feasible": true,
    "triggerSurface": "http",
    "bridgeTargets": [
      { "kind": "http", "exposesAs": "POST /orders",        "rationale": "src/routes/orders.ts:14" },
      { "kind": "http", "exposesAs": "POST /payments/charge","rationale": "src/routes/payments.ts:9" }
    ],
    "rationale": "6 HTTP routes extracted from src/server.ts; harness can wrap them on a chosen port",
    "helperScripts": []
  },
  "tier3StaticAlwaysFeasible": true,
  "recommendation": "tier1"
}
```

`triggerSurface` is one of `http | cli | file-watch | queue | container |
library | scheduled | mixed | none`. `bridgeTargets[].kind` is the
per-route surface (same enum) — `mixed` means values vary across targets.
`helperScripts[]` is an optional list of polyglot helper scripts the
harness should ship in the target's own language; see
`references/trigger-bridges.md` for when to use them. Schema:
`{ language: "python"|"go"|"ruby"|"shell"|...; path: ".anydemo/<slug>/harness/runners/<name>"; purpose: string }`.
