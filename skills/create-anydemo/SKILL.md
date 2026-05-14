---
name: create-anydemo
description: Use when the user asks to create, generate, or scaffold an AnyDemo flow from a natural-language prompt (triggers like "create a demo", "show how X works", "make me a flow of Y", "diagram our checkout system"). Orchestrates four sub-agents and bun scripts to write a registered, validated demo under <project>/.anydemo/<slug>/.
---

# create-anydemo (stub)

This is a scaffolding stub created by US-002. The real orchestration body
arrives in US-009.

Until then, this skill should be considered non-functional: it documents the
intended trigger description so the surrounding plugin layout can be
validated, but the Phase 0..7 workflow has not yet been written.

Sub-agents to be wired up by later stories:

- `anydemo-discoverer` — explores the codebase, returns a context brief
- `anydemo-node-planner` — turns the brief into a node + connector draft
- `anydemo-play-designer` — overlays playAction designs + script bodies
- `anydemo-status-designer` — overlays statusAction designs + script bodies

Scripts to be wired up by later stories:

- `scripts/validate-schema.ts` — local Zod validation against vendored schema
- `scripts/register.ts` — POST /api/demos/register on the running studio
- `scripts/unregister.ts` — DELETE /api/demos/:id for rollback
- `scripts/validate-end-to-end.ts` — drive Play actions, watch status SSE
