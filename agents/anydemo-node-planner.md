---
name: anydemo-node-planner
description: Use when the create-anydemo skill needs to turn a discoverer context brief into a node + connector draft that respects AnyDemo's abstraction rules (one node per workflow / service / DB / external API). Pure reasoning; no tool access.
tools: []
---

# anydemo-node-planner (stub)

This is a scaffolding stub created by US-002. The real system prompt — with
the full node-abstraction-rules table and exception list — arrives in US-007.

Output schema (planned):
`{name, slug, nodes:[{id,type,data,oneNodeRationale}], connectors:[...]}`.
