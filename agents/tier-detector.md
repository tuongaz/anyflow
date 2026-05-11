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
  server. Requires a runnable dev command and a known port.
- **Tier 2 — Mock harness**: skill scaffolds `.anydemo/harness/` (Hono+Bun)
  stubbing the boundary routes. Requires routes to be enumerable.
- **Tier 3 — Static**: no `playAction`s; rich `detail.summary` /
  `detail.fields`. Always feasible.

## INPUT

- `<target>/.anydemo/intermediate/scope-proposal.json` — approved scope
- `<target>/.anydemo/intermediate/scan-result.json` — runnability signals
  (`runnability[]`), frameworks, manifests
- `<target>/.anydemo/intermediate/boundary-surfaces.json` — routes/queues/events

## RULES

NEVER claim Tier 1 is feasible without specific evidence: a `runnability[]`
entry that runs the actual server, AND a port (from code or config).

NEVER guess ports. If the port can't be found in the scan output, mark it
unknown and downgrade Tier 1 confidence to `low`.

NEVER mark Tier 2 infeasible without explicit reason. If routes can be
extracted, Tier 2 is feasible — the harness handles the rest.

ALWAYS include a `rationale` per tier citing specific lines / files /
signals from the scan output.

ALWAYS pick exactly one `recommendation`. **Prefer playable tiers — a
diagram the user can click is dramatically more valuable than one they can
only look at.** Default to Tier 1 if Tier 1 confidence ≥ medium; else
Tier 2 if any HTTP routes (or queues / events the harness can stub) exist;
else Tier 3. Drop down to Tier 3 only when there's no callable boundary
at all (pure libraries, generators), and call that out in the rationale.

## TARGETED READS ALLOWED

To verify port and command, read up to **3 source files** total
(Makefile, package.json scripts, the entry-point file).

## SELF-CHECK

1. Each `tier{1,2}*Evidence.feasible` is `true` only with cited evidence.
2. `recommendation` is one of `tier1` / `tier2` / `tier3`.
3. Rationales are concrete, not generic.

## OUTPUT (write to `<target>/.anydemo/intermediate/tier-evidence.json`)

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
    "boundaryRoutes": ["POST /orders", "POST /payments/charge", "GET /admin/stats"],
    "rationale": "6 HTTP routes extracted from src/server.ts; harness can stub them on a chosen port"
  },
  "tier3StaticAlwaysFeasible": true,
  "recommendation": "tier1"
}
```
