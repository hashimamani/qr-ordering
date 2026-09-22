# QR Table Ordering Platform

Multi-tenant SaaS: restaurants put a QR code on each table, customers order
from their phone with no login, staff run kitchen/bar/waiter dashboards.
Payment is collected manually by the waiter — no in-app payment in v1.

## Status: steps 1–7 of 9 done and verified locally

Not built yet: AWS infrastructure as code + CI/CD (step 8), load testing
(step 9). See "Build order" below.

## Stack

- **Language**: TypeScript / Node 20
- **HTTP**: Express — a thin adapter; route bodies are one-line calls into
  `modules/*/*.service.ts`, so swapping the adapter for API Gateway +
  Lambda handlers later is a routing change, not a rewrite
- **DB**: PostgreSQL via `pg`, raw parameterized SQL (no ORM) so the tenant
  filter in every query is visible and auditable
- **Migrations**: `node-pg-migrate`
- **Validation**: `zod`
- **Auth**: `jsonwebtoken` (staff JWT, scoped to `restaurant_id` + `role`),
  `bcryptjs` for password hashing
- **Real-time**: `ws` — room-based pub/sub over a single `/realtime`
  WebSocket endpoint (see "Real-time layer" below)
- **Notifications**: pluggable `NotificationProvider`/`NotificationQueue`
  abstractions — Africa's Talking (SMS) + AWS SES (email) providers, an
  in-process queue locally / SQS in production
- **QR codes**: `qrcode`, rendered server-side as base64 PNG
- **Logging**: `pino` / `pino-http`, structured JSON
- **Tests**: `vitest`

## Design decisions carried over from the spec (do not "fix" these)

- Customer ordering is stateless — no login, no session cookie. A refresh
  mid-browse is a fresh start, by design.
- The order itself is the recovery mechanism: `contact_value` is required
  at submission, and `/track/{public_token}` is the *only* way a customer
  ever sees status again. There is no "my orders" list.
- `Order.id` is an internal bigserial and is never serialized in any API
  response — only `public_token` is exposed, anywhere, including staff
  dashboards.
- Every query for restaurant-scoped data takes `restaurant_id` as a
  mandatory parameter and filters on it inside the repository function —
  never trusted from a request body, URL, or the staff JWT's claims
  without re-deriving from the token. See `modules/*/*.repository.ts`.
- `Order.contact_value` is deliberately not yet used as a cross-order
  lookup key — that's the future "statement by phone number" feature,
  explicitly out of scope.
- Notification sending is decoupled from order submission via a queue
  (in-process locally, SQS in production) and never blocks or fails the
  HTTP request; every delivery attempt writes its own `NotificationLog`
  row, success or failure.
- `order_ready` fires exactly once per order — on the *first* order_item
  to reach `ready`, not on every item transition.

## Two deliberate additions beyond the literal spec (flagged, not silent)

1. **`MenuItem.destination`** (kitchen/bar) — the original schema draft
   has `OrderItem.destination` but no source field on `MenuItem` to derive
   it from. Added `MenuItem.destination` and copy it onto each
   `OrderItem` at order-creation time, so a later menu edit can't silently
   reroute an order already in the kitchen queue.
2. **`POST /admin/restaurants/signup`** — the spec's admin routes are all
   gated by a staff JWT, but nothing creates the *first* restaurant +
   admin user for a brand-new tenant (chicken-and-egg). Added this one
   bootstrap route, gated by a shared `PLATFORM_ADMIN_KEY` header instead
   of a staff JWT, since there's no "platform superadmin" concept in the
   given data model.

## Real-time layer

A single `ws` endpoint at `/realtime` with the same room/event contract
the spec describes for the eventual API Gateway WebSocket deployment:

- `restaurant:{id}:kitchen`, `restaurant:{id}:bar`, `restaurant:{id}:waiter`
  — staff dashboards join these; joining requires a `token` field (the
  staff JWT) matching that `restaurant_id` and role (or `admin`)
- `order:{public_token}` — no auth needed to join, same bearer-token
  threat model as the HTTP tracking endpoint

Join protocol: send `{"type":"join","room":"...","token":"..."}` after
connecting. Events pushed: `new_order`, `order_placed`,
`item_status_changed`, `status_changed`, `session_closed`. HTTP polling
still works unchanged — the WebSocket layer is additive, not a
replacement for the REST endpoints.

## Local setup

```bash
docker compose up -d          # Postgres on localhost:5434
cp .env.example .env
npm install
npm run migrate:up
npm run seed                  # demo restaurant "amani-grill", 2 tables, menu, 4 staff logins
npm run dev                   # http://localhost:3010
```

`npm run seed` prints per-table QR URLs and demo staff logins (password
`password123` for all four roles) to the console.

Notifications default to dry-run (`NOTIFICATIONS_DRY_RUN=true`) — they log
instead of calling a real provider, so the full order → notify → track
flow works with no Africa's Talking or SES account.

## Verified locally (steps 1–7)

- Full customer flow: resolve table → menu → place order → tracking page,
  including cross-tenant isolation (wrong-tenant `qr_token` 404s,
  wrong-tenant `menu_item_id` rejected)
- Staff login issues a `restaurant_id`+`role`-scoped JWT; wrong password
  and wrong restaurant both return the same 401 (no user enumeration)
- Kitchen/bar dashboards return only that tenant's items, grouped by
  table, filtered by destination; role gating enforced (`kitchen` role
  gets 403 on `/staff/bar`)
- Order-item status transitions are forward-only (`received → preparing →
  ready → served`); a backward transition is rejected with 409; touching
  another tenant's order item 404s (not leaked, not just 403)
- Waiter view renders each `Order` as its own block per table, never
  flattened — verified two simultaneous orders at one table stayed
  separate
- Closing a table session is idempotency-guarded (409 on double-close);
  scanning the table again after close opens a fresh session
- `order_received` and `order_ready` notifications both fire exactly once
  and write `NotificationLog` rows (verified via direct DB query)
- WebSocket: a client joining `order:{token}` and an authorized
  `restaurant:{id}:kitchen` room received live pushes on an order-item
  status change; joining a restaurant room with no/wrong token was
  rejected
- Admin: restaurant signup requires the platform key (401 without it);
  menu category/item CRUD and table+QR creation all reject cross-tenant
  `category_id`; generated QR PNGs decode and are valid images
- `npx vitest run` — 7 passing tests; `npx tsc --noEmit` — clean under
  `strict`

## Known gaps to close before this counts as "production"

- `npm audit` flags dev-only transitive vulnerabilities (vitest's
  `esbuild` dev server, `node-pg-migrate`'s `glob` CLI, `africastalking`'s
  `joi`) — none reachable at runtime, but revisit before CI is wired up
- No automated integration tests against a real Postgres yet (all
  verification so far is manual `curl`/`ws` scripts + one unit-test file)
- `PUBLIC_BASE_URL` / `PUBLIC_ORDERING_BASE_URL` must be set correctly per
  environment or tracking links and generated QR codes point at the wrong
  host
- The in-process notification queue and WebSocket room state are both
  per-process — fine for one Lambda-per-request in production (each queue
  message and each real-time connection is handled by AWS's own
  infrastructure there, see `infra/`), but means this local server can't
  be horizontally scaled as-is without moving both onto real SQS/API
  Gateway WebSockets

## Build order (from the original spec)

1. ~~Postgres schema + migrations, seed script~~ — done
2. ~~Core order-submission API~~ — done
3. ~~`/track/{public_token}` endpoint~~ — done
4. ~~Notification service (SQS-backed), wired into order submission~~ — done
5. ~~Staff auth + kitchen/bar/waiter dashboards~~ — done
6. ~~Real-time layer~~ — done
7. ~~Admin onboarding~~ — done
8. AWS infra as code (Lambda, API Gateway, RDS free tier, SQS), CI/CD
9. Load test order-submission and tracking before calling v1 done
