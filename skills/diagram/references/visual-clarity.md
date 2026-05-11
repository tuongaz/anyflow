# Visual clarity for humans — duplicate to declutter

The anydemo-diagram pipeline produces diagrams **for humans to read**, not
data graphs for machines. A wiring with 30 nodes and 80 connectors that all
converge on one `db` box is correct but unreadable; the same diagram with
the `db` *drawn three times* near its three consumers is the goal.

The studio's schema allows — and the pipeline *encourages* — duplicating a
single logical resource into multiple node instances with distinct ids:

- Every node has a unique `id`, but `label`, `kind`, `playAction`, and
  `data.detail` can be repeated across duplicates. Two `stateNode`s both
  labeled "Orders DB" are valid; the studio's `/api/diagram/assemble` keeps
  them separate, and React Flow renders them as two boxes.
- Duplicates exist to **shorten arrows and keep lanes clean**. They are not
  for representing different state.

## When to duplicate (apply in Phases 4, 5, 6)

1. **Fan-in ≥ 3.** Any node that would receive ≥3 incoming connectors must
   be split into one instance per cluster of callers.
2. **Cross-cutting infra.** Always duplicate `database`, `cache`, `auth`,
   `logging`, `metrics`, `error reporter`, and any primary queue per
   consumer group — even at 2 callers.
3. **Long-distance edges.** If a connector would cross more than one other
   connector to reach its target, duplicate the target instead of routing
   around the crossing.

## Id conventions for duplicates

Suffix with the consumer name — `db-orders`, `db-payments`,
`cache-checkout`, `auth-public`, `auth-admin`. Keep `label` identical
across the set so a reader recognizes them as the same logical thing.

## What stays single

- The user-facing entry points (one `POST /orders`, not three).
- Domain-owning services (one `orders-service`, not three).
- Anything that genuinely is one box per logical thing.

## Per-phase enforcement

Phases 4, 5, and 6 each enforce a slice of this:

- **Phase 4 (node-selector)** counts incoming fan-in and proposes
  duplicates.
- **Phase 5 (wiring-builder)** rejects any node with fan-in ≥3 in
  self-check.
- **Phase 6 (layout-arranger)** places duplicates next to their consumer,
  not in the original lane.
