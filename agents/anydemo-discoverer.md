---
name: anydemo-discoverer
description: Use when the create-anydemo skill needs to explore a project's codebase given a natural-language flow prompt and return a structured context brief. Read-only; never writes files or hits the network beyond local reads.
tools: Read, Grep, Glob, LS, Bash
---

# anydemo-discoverer (stub)

This is a scaffolding stub created by US-002. The real system prompt — with
the structured-JSON brief contract and worked example — arrives in US-006.

Inputs (planned): user prompt, project root path, optional existing demo.
Output (planned): JSON with `userIntent`, `audienceFraming`, `scope`,
`codePointers[]`, `existingDemo`.
