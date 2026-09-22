# QR Table Ordering Platform

Multi-tenant SaaS: restaurants put a QR code on each table, customers order
from their phone with no login, staff run kitchen/bar/waiter dashboards.
Payment is collected manually by the waiter — no in-app payment in v1.

## Status: Phase 1 of 9 (build steps 1–3)

Done — schema, core order-submission API, tracking endpoint, all with
tenant isolation enforced at the query layer and verified end-to-end
locally.

Not built yet (see "Build order" below): notifications (SQS + Africa's
Talking/SES), staff auth + kitchen/bar/waiter dashboards, the real-time
layer, admin onboarding (menu CRUD, QR generation), AWS infrastructure as
code, CI/CD, and load testing.

## Stack (this phase)

- **Language**: TypeScript / Node 20
- **HTTP**: Express — a thin adapter today; route bodies are one-line calls
  into `modules/*/*.service.ts`, so swapping the adapter for API
  Gateway + Lambda handlers later is a routing change, not a rewrite
- **DB**: PostgreSQL via `pg`, raw parameterized SQL (no ORM) so the tenant
  filter in every query is visible and auditable
- **Migrations**: `node-pg-migrate`
- **Validation**: `zod`
- **Logging**: `pino` / `pino-http`, structured JSON
- **Tests**: `vitest`

## Design decisions carried over from the spec (do not "fix" these)

- Customer ordering is stateless — no login, no session cookie. A refresh
  mid-browse is a fresh start, by design.
- The order itself is the recovery mechanism: `contact_value` is required
  at submission, and `/track/{public_token}` is the *only* way a customer
  ever sees status again. There is no "my orders" list.
- `Order.id` is an internal bigserial and is never serialized in any API
  response — only `public_token` (a `crypto.randomUUID()`, 122 bits of
  entropy) is exposed.
- Every table with a `restaurant_id` is queried with `restaurant_id` in the
  `WHERE` clause, inside the repository function itself — never trusted
  from a caller. See `modules/*/*.repository.ts`.
- `Order.contact_value` is deliberately not yet used as a cross-order
  lookup key — that's the future "statement by phone number" feature,
  explicitly out of scope. See the comment on the `order` table migration.
- `MenuItem.destination` (kitchen/bar) is copied onto each `OrderItem` at
  order-creation time rather than looked up live — a design decision not
  spelled out in the original schema draft, but necessary since the given
  schema has `OrderItem.destination` with no source field on `MenuItem`
  other than adding one. This keeps a later menu edit from silently
  rerouting an order already in the kitchen queue.

## Local setup

```bash
docker compose up -d          # Postgres on localhost:5434
cp .env.example .env
npm install
npm run migrate:up
npm run seed                  # creates demo restaurant "amani-grill" + 2 tables + menu
npm run dev                   # http://localhost:3010
```

`npm run seed` prints the per-table QR URLs to try, e.g.:

```
GET /r/amani-grill/t/<qr_token>
```

## Verified locally

- `GET /r/{slug}/t/{qr_token}` resolves restaurant + table, opens (or
  reuses) the active `TableSession`, returns the menu
- `POST /r/{slug}/t/{qr_token}/orders` validates items/contact info,
  rejects menu items that don't belong to the resolved restaurant (tenant
  isolation on the write path), creates `Order` + `OrderItem`s in a
  transaction, returns `{ public_token, tracking_url }`
- `GET /track/{public_token}` returns only that order's items/status,
  rate-limited (in-process fixed-window limiter standing in for API
  Gateway throttling in production — see `src/lib/rateLimit.ts`)
- Cross-tenant isolation: a second restaurant's `qr_token` does not resolve
  under another restaurant's slug (404, not data leakage); a second
  restaurant's `menu_item_id` is rejected with a validation error rather
  than silently accepted onto the wrong tenant's order
- `npx vitest run` — 7 passing tests on the order validation logic
- `npx tsc --noEmit` — clean under `strict`

## Known gaps to close before this counts as "production"

- `npm audit` flags dev-only transitive vulnerabilities (vitest's
  `esbuild` dev server, `node-pg-migrate`'s `glob` CLI) — neither is
  reachable at runtime, but should be revisited before CI is wired up
- No automated integration tests against a real Postgres yet (all
  verification so far is manual `curl` + one unit-test file); step 2 of
  the remaining build order should add a DB-backed test suite
- `PUBLIC_BASE_URL` must be set correctly per environment or tracking
  links will point at the wrong host

## Build order (from the original spec)

1. ~~Postgres schema + migrations, seed script~~ — done
2. ~~Core order-submission API~~ — done
3. ~~`/track/{public_token}` endpoint~~ — done
4. Notification service (SQS-backed), wired into order submission
5. Staff auth + kitchen/bar/waiter dashboards (HTTP polling first)
6. Real-time layer on top of the polling version
7. Admin onboarding (restaurant signup, menu management, QR generation)
8. AWS infra as code (Lambda, API Gateway, RDS free tier, SQS), CI/CD
9. Load test order-submission and tracking before calling v1 done
