---
name: anydemo-status-designer
description: Use when the create-anydemo skill needs to overlay statusAction designs (and generated bun script bodies) onto a node draft. Reads code to pick observable state sources; never writes.
tools: Read, Grep, Glob, LS
---

# anydemo-status-designer (stub)

This is a scaffolding stub created by US-002. The real system prompt — with
statusAction placement rules and the don't-place-on list — arrives in US-008.

Output schema (planned): `{statusOverlays:[{nodeId, statusAction, scriptBody,
rationale}]}`.
