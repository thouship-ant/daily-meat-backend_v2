# Deploying Daily Meat API v2 with Docker Compose (production)

Stack on one server: the server's existing **nginx** (HTTPS on 80/443) → **api** container (NestJS + Socket.IO, published only on `127.0.0.1:$PORT`, default 3000; the nginx `proxy_pass` must use the same port) → **PostgreSQL 17** and **Redis 7** containers (internal Docker network only; data in the `pgdata` volume).

Files: `Dockerfile`, `docker-compose.prod.yml`, `infra/nginx-daily-meat.conf`, `infra/deploy.sh`, `infra/backup.sh`. Configuration lives in a single `.env` file on the server (never committed). Customer, Admin and Driver APIs are one deployable (`/api/v1/customer`, `/admin`, `/driver`).

> **v2 runs alongside v1 safely only if it has its own database and its own domain/port.** Do not point v1 and v2 at the same database while both take traffic. See [Cut-over](#5-cut-over-from-v1).

## 1. Server prerequisites

- Ubuntu 22.04/24.04 VPS, 2 vCPU / 2 GB RAM or more.
- A domain (e.g. `api-v2.dailymeat.in`) with an **A record** pointing at the server IP. Ports 80 and 443 open.

```bash
apt update && apt -y upgrade
apt -y install ca-certificates curl git ufw nginx certbot python3-certbot-nginx
timedatectl set-timezone Asia/Kolkata
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
curl -fsSL https://get.docker.com | sh
```

Postgres and Redis are never published, so no firewall rule is needed for 5432 / 6379.

## 2. Get the code and configure

```bash
git clone <your-repo-url> ~/daily-meat-backend-v2 && cd ~/daily-meat-backend-v2
cp .env.example .env
nano .env
chmod 600 .env
```

`docker-compose.prod.yml` reads these from `.env`:

| Variable | Notes |
|---|---|
| `APP_BASE_URL` | Required. Public URL, e.g. `https://api-v2.dailymeat.in` (`https://` + host, no trailing slash/path). The Cashfree webhook URL is built from it: `APP_BASE_URL/api/v1/payments/webhook` |
| `DATABASE_URL` | Required. See below |
| `REDIS_PASSWORD` | Required. Hex only: `openssl rand -hex 24` |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Required, ≥ 16 chars, different from each other. `openssl rand -hex 32` |
| `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | Optional. Default `15m` / `30d` (v1 used 50 days for both — v2 has token refresh, so keep the access token short) |
| `CASHFREE_ENV`, `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | `CASHFREE_ENV=PROD` for live payments. The secret also verifies webhook signatures |
| `SMS_FORTIUS_*`, `SMTP_*` | OTP delivery (SMS for phones, email for email logins). Without them OTPs are **not delivered** in production |
| `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `AWS_REGION`, `AWS_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Product / category / banner images (any S3-compatible store, e.g. Supabase Storage) |
| `EXPO_ACCESS_TOKEN`, `ANDROID_*`, `PUSH_TOKEN_MAX_CHARS` | Push notifications |
| `APP_ANDROID_*`, `APP_IOS_*` | "Update available" prompt |
| `COD_MAX_AMOUNT`, `OTP_*`, `MAX_ACCOUNTS_PER_DEVICE` | Business rules (defaults 3000 / 600 s / 5 / 2) |
| `TEST_ACCOUNT_PHONE_MARKER`, `TEST_ACCOUNT_OTP` | Store-reviewer account with a fixed OTP. **Leave `TEST_ACCOUNT_PHONE_MARKER` empty** unless you need it, or anyone knowing the OTP can sign in as that account |
| `CORS_ORIGINS` | Only needed for browser clients (admin web panel). Comma separated; empty allows any origin |
| `SWAGGER_ENABLED` | Defaults to `false` in the production compose file. Set `true` to expose `/docs/*` |

### DATABASE_URL

One variable sets everything: the Postgres container is created with this user, password and database name, and the API connects with it (**host must stay `db`**).

```
DATABASE_URL=postgresql://daily_meat:STRONG%23PASS%24@db:5432/daily_meat
```

The password goes in the URL **percent-encoded** (`#` = `%23`, `$` = `%24`, `@` = `%40`, `:` = `%3A`, `/` = `%2F`, `%` = `%25`). Easiest is a hex-only password (`openssl rand -hex 24`) which needs no encoding.

The user and password are applied only when the `pgdata` volume is **first created**. Changing `DATABASE_URL` later does not change an existing database: either `ALTER USER daily_meat PASSWORD '...'` inside it, or wipe the volume (`down -v`, deletes all data).

## 3. First deploy

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env"

$C build
$C up -d db redis
$C run --rm migrate          # creates the tables (prisma migrate deploy)
$C up -d                     # starts the api
```

Create the first admin (skip if you import v1 data in step 4 — those admins keep their passwords):

```bash
$C run --rm -e ADMIN_EMAIL=owner@dailymeat.in -e ADMIN_PASSWORD='a-strong-password' tools npx ts-node prisma/seed-admin.ts
```

Add the nginx site (HTTPS is handled by nginx, not Docker):

```bash
sed 's/YOUR_DOMAIN/api-v2.dailymeat.in/' infra/nginx-daily-meat.conf | sudo tee /etc/nginx/sites-available/daily-meat-v2 >/dev/null
sudo ln -s /etc/nginx/sites-available/daily-meat-v2 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api-v2.dailymeat.in
```

The config proxies to `127.0.0.1:3000` with websocket upgrade (needed by Socket.IO) and a 10 MB body limit. If you change `PORT`, change `proxy_pass` too. If v1 still runs on this server on `127.0.0.1:5000`, there is no conflict.

Check:

```bash
$C ps                                       # db, redis and api should be "healthy"
$C logs -f api
curl https://api-v2.dailymeat.in/api/v1/health   # {"success":true,"data":{"status":"ok",...}}
```

## 4. Loading your v1 production data

v2's schema maps onto v1's tables, so data moves with a plain data-only dump. After step 3's `migrate` (the tables must exist and be empty):

1. Export from v1 (its own tooling): `npm run db:export` in the v1 repo → `db-export/data.sql`.
2. Copy it to the server and import:

```bash
$C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 --single-transaction < data.sql
```

3. Create / promote the staff accounts (super admins and the driver, password `DAS@3781`, see `prisma/sql/staff-accounts.sql` for the numbers and roles). It is a separate step on purpose: the import needs empty tables, so the accounts cannot be created by a migration that runs before it.

```bash
$C exec -T db psql -U daily_meat -d daily_meat -v ON_ERROR_STOP=1 --single-transaction < prisma/sql/staff-accounts.sql
$C restart api
```

Run it only when you want those accounts (re)set: it puts the password back to `DAS@3781` and ends their sessions. Numbers that are customers in the data (for example `9363803781`) are promoted in place and keep their orders; the others are created. The numbers with more than one role (`9363803781`, `9600249294`, `8825997939`, all Super Admin + Admin, the first two also Customer / Driver) get the password + OTP + role-choice login. Only a Super Admin sees all hubs, creates hubs and filters every list by hub.

This exact path (fresh v2 schema + v1 `data.sql`, 1,500+ users / 300+ orders) was verified. Imported **admin and driver accounts keep their passwords** (both apps use bcrypt). Customers sign in with OTP as before.

Things to know after importing:
- Users must **sign in again**: v2 stores refresh tokens hashed, so v1 sessions don't carry over.
- v1's `users.otp*` columns are ignored; OTPs live in Redis.
- Do this before the app takes real traffic, and re-export right before switching so no orders are lost.

### Alternative: upgrade the existing v1 database in place
Only if you will **stop v1 completely** and want v2 on the same database. Back up first (`pg_dump -Fc`), then tell Prisma the baseline already exists and apply anything newer:

```bash
$C run --rm migrate npx prisma migrate resolve --applied 20261108063501_init
$C run --rm migrate
```

If that database already received `prisma/migrations/20261110090000_address_review_and_activity` by hand (as the Supabase database did), mark it applied as well before the last command:
`$C run --rm migrate npx prisma migrate resolve --applied 20261110090000_address_review_and_activity`.
`20261111120000_multi_role_and_admin_accounts` then adds `users.additional_roles` and promotes the staff numbers that already exist as users (it never creates users, so it is safe on a populated database); anything it did not find is created by `prisma/sql/staff-accounts.sql`.

Check `GET /api/v1/admin/orders` and the dashboard before reopening to customers. Prefer the fresh-database route above; it is easier to roll back.

## 5. Cut-over from v1

1. Deploy v2 on its own domain with a **copy** of the data (step 4) and test: customer OTP login, place a COD order, admin sees it, assign a driver, driver delivers. Test an online payment with a small real amount if `CASHFREE_ENV=PROD`.
2. v2's URLs and response shapes differ from v1 (`/api/v1/{customer|admin|driver}/…`, camelCase, enveloped `{ success, data }`). **The mobile apps and admin panel must be updated and released first** — see "Client migration notes" in `README.md`. Point their base URL at `https://YOUR_DOMAIN/api/v1`.
3. On cut-over day: stop v1 (or put it in maintenance), take a fresh v1 export, wipe v2's data (`$C down -v`, then repeat steps 3–4), start v2, switch DNS / app config.
4. **Cashfree:** the webhook URL is sent with every order (`APP_BASE_URL/api/v1/payments/webhook`), but if you also configured a webhook URL in the Cashfree dashboard, update it. Webhooks without a valid signature are rejected (401), so the secret key must match.
5. **Rollback:** keep v1 and its database untouched until v2 has been stable for a few days. To roll back, repoint DNS / app config to v1; orders taken in v2 in the meantime exist only in v2's database.

> **Not yet in v2:** scheduled notification jobs (promo / re-engagement / slot / "tomorrow plan"), marketing broadcasts, seller bills, analytics and CSV export. If you rely on these, keep v1 running for them or finish porting before cut-over (list in `README.md`).

## 6. Updating

```bash
./infra/deploy.sh
```

It pulls the code, rebuilds, starts db/redis, applies new migrations, and restarts the API. Create migrations on your dev machine with `npx prisma migrate dev --name what_changed` and commit the generated `prisma/migrations/` folder; production only ever runs `prisma migrate deploy`.

## 7. Backups

```bash
chmod +x infra/backup.sh
crontab -e
0 2 * * * DB_USER=daily_meat DB_NAME=daily_meat /home/deploy/daily-meat-backend-v2/infra/backup.sh
```

Dumps go to `/var/backups/daily-meat` (override with `BACKUP_DIR`) and are kept 35 days. Copy them off the server too (rclone/rsync). Redis holds only cache and OTPs and is not backed up.

Restore into a running db:

```bash
$C exec -T db pg_restore -U daily_meat -d daily_meat --clean --if-exists < db-XXXX.dump
```

## 8. Operations

```bash
$C logs -f api                                  # API logs
$C restart api
$C exec db psql -U daily_meat -d daily_meat     # SQL shell
$C down                                         # stop (data kept)
$C exec redis sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning flushall'   # clear cache (also invalidates pending OTPs)
```

- **Scaling:** unlike v1, the API holds no per-process state when `REDIS_URL` is set (compose always sets it), so extra `api` containers behind nginx are safe for REST. Socket.IO with several containers needs sticky sessions or a Redis adapter, so keep **one** api container until you add that.
- **Every response carries `x-request-id`** (also in error bodies as `requestId`): quote it when searching `$C logs api`.
- **502 from nginx:** the API is not up; check `$C ps`, `$C logs api`, and `curl http://127.0.0.1:3000/api/v1/health` on the server.
- **API exits at start with "…is required":** a mandatory variable (`DATABASE_URL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`) is missing or too short; the log names it.
- **Customers say they get no OTP:** check `SMS_FORTIUS_*` / `SMTP_*`; in production a missing gateway is logged as an error and nothing is sent.
- **HTTPS fails to issue:** the DNS A record must point at this server and port 80 must be reachable; see `sudo certbot certificates` and `/var/log/letsencrypt/`.
- **Prisma "pooler" databases:** if you ever use Supabase's pooler instead of the bundled Postgres, add `?pgbouncer=true&connection_limit=10` to `DATABASE_URL` for the API and use a direct (non-pooled) URL when running `migrate`.
