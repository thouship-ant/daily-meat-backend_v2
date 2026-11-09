# Daily Meat API v2

NestJS + Prisma + PostgreSQL rewrite of the Express/Sequelize backend, organised as a **modular monolith with three
independent API surfaces**: Customer, Admin and Driver.

```
src/
├─ api/                    ← API SURFACES: thin controllers + DTOs only, no business logic
│  ├─ customer/            mounted at /customer   (mobile app)
│  ├─ admin/               mounted at /admin      (back-office)
│  ├─ driver/              mounted at /driver     (delivery app)
│  ├─ webhooks/            /payments/webhook      (Cashfree, signature-authenticated)
│  └─ shared/              health, app-version, DTOs reused by several surfaces
├─ modules/                ← DOMAIN: all business rules. Know nothing about HTTP surfaces.
│  ├─ auth  users  addresses  catalog  hubs  coupons  support
│  ├─ orders               placement · lifecycle (state machine) · queries · manual orders · delivery slots
│  ├─ payments             verify + webhook reconciliation
│  ├─ tracking             live driver location + arrival detection
│  └─ notifications        push + realtime socket; reacts to domain events
├─ infrastructure/         ← prisma · cache (redis|memory) · messaging (SMS/email) · payment gateway · storage
└─ common/                 envelope, errors, guards, decorators, domain events, utils
```

## Why it is loosely coupled

* **Surfaces don't know each other.** `CustomerApiModule`, `AdminApiModule`, `DriverApiModule` each import only the
  domain modules they need. Changing the Admin API cannot break the Customer app; any surface can later become its own
  deployable by giving it its own `main.ts`.
* **Domain modules don't know HTTP or notifications.** Orders emit events (`order.placed`, `order.status_changed`,
  `orders.assigned`, `driver.arrived` … see [domain-events.ts](src/common/events/domain-events.ts)); the
  `notifications` module is the only listener that decides who is told what. Add SMS/WhatsApp by adding a listener,
  not by touching orders.
* **One state machine** ([order-status.ts](src/modules/orders/order-status.ts)) decides who may move an order where
  (admin / driver / customer), with compare-and-set updates so concurrent requests can't corrupt state.
* **Infrastructure is swappable.** Cache is Redis *or* memory, the payment gateway is one class, storage is S3-compatible.

## Response format (every endpoint)

```jsonc
// success
{ "success": true, "message": "Order placed.", "data": { … }, "meta": { "page":1,"limit":20,"total":57,"totalPages":3,"hasNext":true,"hasPrev":false }, "requestId": "…", "timestamp": "…" }
// error
{ "success": false, "error": { "code": "COUPON_INVALID", "message": "Coupon has expired.", "statusCode": 400, "details": { "reason": "EXPIRED" } }, "requestId": "…", "path": "/api/v1/customer/orders", "timestamp": "…" }
```

Clients branch on `error.code` (e.g. `OTP_INVALID`, `COD_LIMIT_EXCEEDED`, `STORE_CLOSED`, `INVALID_STATUS_TRANSITION`),
never on message text. Validation failures return `details: [{ field, messages[] }]`. Fields are camelCase; money is a
number; list endpoints are paginated (`?page=&limit=`); orders have one consistent shape for every role (cost/profit
only for admins).

## Running

```bash
cp .env.example .env            # fill DATABASE_URL + the two JWT secrets at minimum
docker compose up -d            # local Postgres + Redis (optional)
npm install
npx prisma migrate deploy       # or `migrate dev` while developing
ADMIN_EMAIL=you@x.in ADMIN_PASSWORD='strong-pass' npm run seed:admin
npm run seed:demo               # optional: hub, product, slot, driver (+919000000001 / driver1234)
npm run start:dev
```

Swagger per app: `/docs/customer` · `/docs/admin` · `/docs/driver`. Health: `GET /api/v1/health`.
Tests: `npm test` (state machine, coupon rules, delivery fee/hours). Unit tests don't need a database.

### Using your existing v1 database
The Prisma schema maps onto v1's tables, columns and enums unchanged. Do **not** run `migrate deploy` against it:

```bash
npx prisma migrate resolve --applied 20261108063501_init    # tell Prisma the baseline already exists
```

then deploy normally. Back up first. After cut-over, old sessions must sign in again (refresh tokens are now stored
hashed) and `users.otp*` columns are unused (OTPs live in the cache, hashed).

## Route map

| Surface | Highlights |
|---|---|
| **Customer** `/customer` | `auth/otp/send`, `auth/otp/verify`, `auth/token/refresh`, `me`, `catalog/*`, `addresses`, `hubs/resolve`, `delivery-slots`, **`orders/quote`**, `orders`, `orders/:id/cancel`, `coupons/*`, `payments/verify`, `support/tickets` |
| **Admin** `/admin` | `auth/login`, `dashboard`, `orders` (+ filters, manual create, `assign-driver`, `:id/status`, `:id/assignment-suggestions`), `drivers`, `customers`, `catalog/*` (+image upload), `hubs`, `slots`, `coupons`, `tickets`, `auth/sessions/logout-all` |
| **Driver** `/driver` | `auth/login`, `dashboard`, `orders/active`, `orders/completed`, `orders/:id/{pick,out-for-delivery,deliver,fail,arrived}`, `orders/bulk/*`, `location` |
| Realtime | Socket.IO, same access token; rooms `user_<id>`, `admin_room`, `order_<id>` (access-checked) |

## What changed from v1 (behaviour you should know about)

**Security / correctness fixes**
* Prices, product names, **delivery fee and discount are computed server-side**; v1 trusted client-sent fee and names.
* Payment webhook is **HMAC-verified** (v1 accepted anything) and re-checks status with the gateway; a failed attempt no
  longer *deletes* the order — only an expired/terminated payment cancels it, and its coupon is released.
* Cost prices never reach customers via the catalog; customer order responses hide cost/profit.
* OTPs are hashed, attempt-limited, rate-limited and shared across instances (v1 kept new users' OTPs in a process
  global and logged OTPs); staff accounts can't use the customer OTP route; each surface accepts only its own role.
* Refresh tokens rotate and are stored hashed; deactivated users are rejected immediately (per request, cached 30 s).
* Drivers can only report location / act on **their own** orders; sockets can only subscribe to orders they may see.
* Order ids retry on collision; coupon rows are locked during checkout; the payment gateway call happens *after* the DB
  transaction instead of inside it.
* Order status changes follow a state machine (v1 allowed e.g. DELIVERED → PENDING).
* Cancelling an order releases its coupon redemption; deleting a product/variant used by past orders deactivates it.
* Manual (phone) orders that are pre-paid are marked PAID (v1 left them invisible in the admin list).

**Usability additions**: `POST /customer/orders/quote` (price preview), `GET /customer/hubs/resolve`, consistent
pagination and filters/search on admin lists, `allowedNextStatuses` on admin order detail, per-app Swagger, request ids.

## Not ported yet (still in the v1 repo)
Cron jobs (promo/re-engagement/slot/"tomorrow plan"/scheduled notifications), marketing broadcasts & app-update
pushes, seller bills, category analytics, contact-form messages, customer CSV export, performance middleware,
Cloudinary uploads (v2 uses S3-compatible storage), address geocoding fallback (clients must send coordinates).
The Prisma schema already contains their tables, so each can be added as a new module without migrations.

## Client migration notes
URLs moved to `/api/v1/{customer|admin|driver}/…`, field names are camelCase, responses are enveloped, and actions are
`POST`/`PATCH` (v1 used `PUT` for actions). `distance_tiers` accepts v1's loose key names but are exposed as
`{ upToKm, fee }`.
