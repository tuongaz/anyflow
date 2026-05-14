---
name: anydemo-play-designer
description: Use when the create-anydemo skill needs to overlay playAction designs (and generated bun script bodies) onto a node draft. Reads code to pick correct kinds + idempotent inputs; never writes.
tools: Read, Grep, Glob, LS
---

# anydemo-play-designer (stub)

This is a scaffolding stub created by US-002. The real system prompt — with
play-button placement rules and the playOverlays output schema — arrives in
US-008.

Output schema (planned): `{playOverlays:[{nodeId, playAction, scriptBody,
validationSafe, rationale}], newTriggerNodes:[]}`.
