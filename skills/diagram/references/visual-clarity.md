# Visual clarity for humans — duplicate to declutter

The diagram pipeline produces diagrams **for humans to read**, not
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

# Node colors — encode risk and trust

The schema accepts a small palette on every node: `default`, `slate`,
`blue`, `green`, `amber`, `red`, `purple`, `pink`. Both `borderColor`
and `backgroundColor` are optional and independent — leaving them unset
falls through to the theme defaults.

**Color is a signal, not decoration.** The bulk of nodes in a diagram
must stay `default`; saturating the canvas with colored borders makes
every node look equally important and defeats the purpose. Apply color
only when it carries semantic meaning the reader can act on at a glance.

## The convention

| `borderColor` | Apply to | Examples |
|---|---|---|
| `red`     | Sensitive data or high-risk operations | A `stateNode` storing patient records, customer PII, raw credit-card numbers, or secrets/credentials; a `playNode` that deletes accounts, triggers payouts, or runs prod migrations |
| `amber`   | Caution — deprecated, rate-limited, beta, flaky | A v1 route slated for removal; a third-party endpoint with a 60/min cap; a feature behind a kill switch |
| `purple`  | Privileged / admin surface                      | Internal-only ops dashboards, super-user mutation endpoints, role-elevated routes |
| `pink`    | External third-party services                   | Stripe, Twilio, Auth0, OpenAI — anything outside the user's codebase boundary |
| `green`   | Public customer-facing happy path               | Top-level entry points (`POST /orders`, `POST /signup`). Use sparingly: typically one or two per diagram |
| `default` | Everything else                                 | Internal services, workers, queues, stores with no special risk profile |
| `slate` / `blue` | Free for ad-hoc grouping (rare)          | A cluster of related background workers; a sub-pipeline visually grouped |

## Worked examples

**Healthcare flow** — a diagram showing how a patient signs up and is
billed:

- `POST /signup` (entry point) → `borderColor: 'green'`
- `Patients DB` (PHI) → `borderColor: 'red'`
- `Stripe` (third party charging the card) → `borderColor: 'pink'`
- `Card Vault` (PCI scope storing card tokens) → `borderColor: 'red'`
- `Email Sender` (internal worker) → `default`
- `Admin Override` (privileged endpoint) → `borderColor: 'purple'`

**Auth flow** — a diagram showing how login works:

- `POST /login` (public) → `borderColor: 'green'`
- `Sessions DB` (raw session tokens) → `borderColor: 'red'`
- `Password Hash Store` (credentials) → `borderColor: 'red'`
- `Old /v1/auth route` (deprecated) → `borderColor: 'amber'`
- `Auth0` (third party SSO) → `borderColor: 'pink'`

## Background color

Functional nodes (`playNode`, `stateNode`) — leave `backgroundColor`
unset. Tinting the fill on a service node usually fights the border
signal and makes the canvas noisier.

Decorative `shapeNode`s — `backgroundColor` is encouraged for sticky
callouts, banners, and grouping rectangles. Pair it with a matching or
contrasting `borderColor` to keep the annotation visually distinct from
the flow.

## Connectors

Connectors also accept `color`. The same red/amber rules apply when a
specific edge represents a high-risk transfer — e.g., a connector that
literally moves cleartext PII between two services warrants
`color: 'red'`. Most connectors should stay unset and inherit the
default styling from their `kind` (`http` / `event` / `queue` /
`default`).

## Self-check

Before emitting wiring:

1. Every node touching PII, secrets, payment data, health records, or
   irreversible side effects has `borderColor: 'red'`.
2. Every external third-party service has `borderColor: 'pink'`.
3. The number of colored nodes is < 50% of the total. If more, demote
   the lower-risk ones to `default` — the signal is being diluted.
4. No functional node has `backgroundColor` set.
