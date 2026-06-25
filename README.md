# MetaXperts ERP

> A complete, modern **Enterprise Resource Planning** system you can run on your own servers.
> Multi-company, event-driven, and built entirely from open-source parts.

MetaXperts ERP is one platform that runs a whole business: **finance & accounting, inventory,
sales & POS, CRM, HR & payroll, manufacturing, projects, assets, e-commerce, a help desk,
subscriptions, a pharmacy, plus AI insights and reporting.** Many separate companies (tenants) can
use the same installation at once, and each company's data is completely isolated from the others.

This README is written so that **anyone** — even someone who has never deployed software before — can
get the system running and start using it. If a step looks intimidating, just copy the commands
exactly as shown.

---

## Table of Contents

1. [What you get](#1-what-you-get)
2. [How the system is put together (the big picture)](#2-how-the-system-is-put-together-the-big-picture)
3. [How information flows through the system](#3-how-information-flows-through-the-system)
4. [Before you start (prerequisites)](#4-before-you-start-prerequisites)
5. [Quick start — run everything with Docker](#5-quick-start--run-everything-with-docker)
6. [Logging in and your first steps](#6-logging-in-and-your-first-steps)
7. [A typical day — how you actually use it](#7-a-typical-day--how-you-actually-use-it)
8. [Running for real (production deployment)](#8-running-for-real-production-deployment)
9. [Developer setup (optional — for people changing the code)](#9-developer-setup-optional--for-people-changing-the-code)
10. [Backups, updates, and day-to-day operations](#10-backups-updates-and-day-to-day-operations)
11. [Troubleshooting](#11-troubleshooting)
12. [Project layout & further reading](#12-project-layout--further-reading)

---

## 1. What you get

MetaXperts ERP is organised into **modules**. Each module is one area of the business. Every company
on the platform can switch modules on or off for itself.

| Module | What it does |
|---|---|
| **Finance & Accounting** | Full accounting suite: chart of accounts, vouchers (cash/bank/journal), maker-checker approval, General Ledger, Trial Balance, Balance Sheet, Income Statement, Cash Flow, AR/AP with aging, bank reconciliation, budgets, cost centres, fiscal-period locking, year-end close, multi-currency. |
| **Inventory** | Stock tracking with weighted-average valuation, requisitions, purchase orders, goods receipts (GRN), gate passes, issues, and material returns. |
| **Sales & POS** | Point-of-sale with registers, shifts, sales, and returns — including an **offline mode** that keeps selling when the internet drops and syncs later. |
| **CRM** | Accounts, leads (with conversion), opportunities with weighted forecasting, activities, and sales reports. |
| **HR & Payroll** | Employee lifecycle, leave, payroll, attendance, performance reviews, and HR reports. |
| **Manufacturing** | Bills of materials, work orders, and production costing — consumes raw materials and receives finished goods through inventory. |
| **Projects** | Project management, tasks, timesheets (approved time becomes cost), and expenses. |
| **Fixed Assets** | Asset register, depreciation runs, disposals, and maintenance. |
| **E-commerce** | A public online store (`/shop/<your-store>`) plus an admin — integrated with inventory, accounting, and CRM. |
| **Help Desk** | Support tickets with an SLA engine (pause/resume/breach), agent console, and a customer portal. |
| **Subscriptions** | Recurring billing, dunning, MRR tracking, and a customer portal. |
| **Pharmacy** | Drug master with batch/expiry (first-expiry-first-out) tracking on the inventory ledger, integrated with accounting. |
| **AI & Reporting** | Forecasting, lead scoring, anomaly detection, plus a report builder (preset and custom reports). |
| **Notifications** | In-app notification feed and bell, driven by real business events, with optional email. |

Behind the scenes you also get **multi-company isolation**, **role-based security**, an **audit
trail**, **observability dashboards** (metrics + tracing), and **reliable event delivery** so nothing
gets lost.

---

## 2. How the system is put together (the big picture)

Think of MetaXperts ERP as a few cooperating programs ("services"), each with one job. You don't have
to start them by hand — Docker runs them all together.

```
                                  ┌──────────────────────────┐
   You (browser) ───────────────► │   WEB  (the dashboard)   │   Next.js
                                  └────────────┬─────────────┘
                                               │ calls
                                               ▼
                                  ┌──────────────────────────┐
                                  │   API  (the brain)       │   NestJS
                                  │  business rules, auth,   │
                                  │  database, security      │
                                  └───┬───────────┬──────────┘
                          writes data │           │ posts "events" (things that happened)
                                      ▼           ▼
                          ┌────────────────┐  ┌────────────────┐
                          │   Postgres     │  │   RabbitMQ     │  message broker
                          │   (database)   │  └───────┬────────┘
                          └────────────────┘          │ delivers events
                                                       ▼
                                          ┌──────────────────────────┐
                                          │  WORKER (the reactor)    │   NestJS + BullMQ
                                          │  reacts to events:       │
                                          │  notifications, GL posts,│
                                          │  forecasts, etc.         │
                                          └────────────┬─────────────┘
                                                       │ asks for AI
                                                       ▼
                                          ┌──────────────────────────┐
                                          │   ML  (the AI service)   │   Python / FastAPI
                                          │  forecasts, anomalies,   │
                                          │  OCR, semantic search    │
                                          └──────────────────────────┘
```

**The four apps, in plain words:**

- **WEB** — the website you click around in. It shows screens and talks to the API.
- **API** — the brain. It checks who you are, enforces the rules, and reads/writes the database. This
  is where the business logic lives.
- **WORKER** — the helper that runs in the background. When something happens (a sale, a closed deal),
  the API records an "event" and the worker reacts to it (sends a notification, posts to the ledger,
  updates a forecast) — without making you wait.
- **ML** — the AI service. It does forecasting, anomaly detection, document OCR, and smart search.

**The supporting infrastructure** (all started automatically by Docker):

| Piece | Purpose (in plain words) |
|---|---|
| **Postgres** | The database — where all your data is stored. |
| **PgBouncer** | A "traffic controller" in front of the database so many requests share connections efficiently. |
| **Redis** | Fast temporary memory — caching and background job queues. |
| **RabbitMQ** | The "post office" that carries events from the API to the worker. |
| **MinIO** | File storage (photos, attachments, PDFs) — works like Amazon S3 but on your own server. |
| **Prometheus + Grafana** | Monitoring dashboards — show how healthy and busy the system is. |
| **OTel Collector** | Collects traces so you can follow a single request across all the services. |

Everything is **open-source and self-hostable** — there are no paid or closed-source dependencies and
nothing phones home.

---

## 3. How information flows through the system

Here is what happens, step by step, when you do something — say, **close a sale**:

1. You click **Save** in the **web** dashboard.
2. The **API** checks you're logged in, confirms which company you belong to, and validates the data.
3. In **one single database transaction**, the API both (a) records the sale and (b) writes an
   "event" row saying *"a sale happened."* Either both succeed or neither does — so records and events
   can never disagree.
4. A relay reads that event and hands it to **RabbitMQ** (the post office).
5. The **worker** picks up the event and reacts: it posts the accounting entries to the General
   Ledger, updates stock levels, and sends you a notification — all in the background.
6. If the reaction needs AI (e.g. a sales forecast), the worker asks the **ML** service.
7. A full **trace** of this journey is recorded so an operator can see every hop if needed.

The important promise: **your data is always tenant-scoped** (locked to your company) and **events
are never lost**, even if a service restarts mid-flight.

---

## 4. Before you start (prerequisites)

You only need **two** things installed on the machine that will run the system:

1. **Docker** and **Docker Compose** — this runs the whole platform.
   Install from <https://docs.docker.com/get-docker/>. Verify with:
   ```bash
   docker --version
   docker compose version
   ```
2. **Git** — to download the code.
   ```bash
   git --version
   ```

> For *developing* the code (not just running it) you'll additionally want **Node.js 22+** and
> **pnpm** — see [section 9](#9-developer-setup-optional--for-people-changing-the-code). For just
> running the system, Docker is enough.

A machine with **4 CPU cores and 8 GB of RAM** is comfortable for a demo or a small company.

---

## 5. Quick start — run everything with Docker

This gets the **full system** running on your computer in a few minutes.

### Step 1 — Download the code

```bash
git clone https://github.com/aliugoki/erp.git
cd erp
```

### Step 2 — Create your settings file

The system reads its settings from a file called `.env`. A template is provided — copy it:

```bash
cp .env.example .env
```

Now open `.env` in any text editor and replace every `replace_me` with a real value. The most
important ones are the **passwords** and **secrets**. The easiest way to make a strong secret:

```bash
openssl rand -base64 48
```

Paste a fresh random value for each of these (use a *different* value for each):

- `POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SERVICE_AUTH_SECRET`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`

> **Never share your real `.env` file or commit it to Git** — it contains your secrets. The
> `.gitignore` already prevents this.

### Step 3 — Start everything

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build
```

This builds and launches all four apps plus the database, broker, cache, storage, and monitoring.
The first run takes a few minutes. Check that everything is healthy:

```bash
docker compose -f infra/docker-compose.prod.yml ps
```

Wait until the services show as healthy/running.

### Step 4 — Set up the database

The database starts empty. Create its tables (this is **idempotent** — safe to run more than once):

```bash
bash infra/scripts/migrate-prod.sh
```

### Step 5 — Load a demo company with sample data

This creates a ready-to-explore company called **Acme** with data across every module:

```bash
API_URL=http://127.0.0.1:3300 \
OWNER_URL=postgresql://metaxperts:<your-postgres-password>@127.0.0.1:55433/metaxperts \
  bash infra/scripts/seed-demo.sh
```

(Replace `<your-postgres-password>` with the `POSTGRES_PASSWORD` from your `.env`.) The script prints
the demo login details when it finishes.

### Step 6 — Open the dashboard

| What | Address | Notes |
|---|---|---|
| **ERP dashboard (start here)** | <http://localhost:3001> | The main app. |
| API | <http://localhost:3300> | The backend (you normally don't open this directly). |
| AI service | <http://localhost:8088> | The ML service. |
| RabbitMQ admin | <http://localhost:15672> | Event broker dashboard. |
| Grafana monitoring | <http://localhost:3004> | Health dashboards. |
| Prometheus | <http://localhost:9092> | Raw metrics. |

> Port numbers come from `infra/docker-compose.prod.yml`. If a port is already used on your machine,
> edit that file.

To stop everything: `docker compose -f infra/docker-compose.prod.yml down`
To wipe all data and start fresh: add `-v` to that command.

---

## 6. Logging in and your first steps

Open the dashboard at **<http://localhost:3001>** and sign in with the demo account created in Step 5.
Its email is `admin@acme.test`, and the exact login details (email + the demo passphrase) are printed
at the top of `infra/scripts/seed-demo.sh` and echoed by that script when it runs.

> There is also a platform **super-admin** account (used to create and manage companies across the
> whole installation); its credentials are likewise documented in `infra/scripts/seed-demo.sh`. Most
> people only ever use the company admin above.

Once logged in:

1. **Look at the left sidebar** — it lists only the modules your company has switched on.
2. **Go to Settings** to turn modules on/off, invite users, and assign roles.
3. **Pick a module** (try *Finance* or *Inventory*) to start working.

To create a **brand-new company** (instead of using the demo), log in as the super-admin and open
**Platform → Companies** in the sidebar. From there you can list every company, **create one** (which
provisions the company, its first admin user, and its feature plan in a single step and shows you the
credentials to hand over), and **suspend or reactivate** a company. Suspending a company immediately
blocks all of its users from logging in — it's enforced by the API, not just hidden in the UI.

---

## 7. A typical day — how you actually use it

Every module follows the **same simple pattern**, so once you learn one you know them all:

> **A three-pane layout**: a list on the left, the selected record's details in the middle, and
> actions on the right. You can **Create, Read, Update, and Delete** records everywhere.

Some common end-to-end flows:

- **Sell something (POS):** open *POS* → open a register/shift → ring up items → take payment →
  finish. Stock drops automatically, the sale posts to accounting in the background, and you get a
  receipt. (If the internet drops, POS keeps working and syncs when it reconnects.)
- **Buy stock (Inventory):** raise a *Requisition* → turn it into a *Purchase Order* → receive goods
  with a *GRN*. Stock value updates using weighted-average costing.
- **Close a deal (CRM):** create a *Lead* → convert it to an *Account* + *Opportunity* → move it
  through stages → mark it won. The assignee gets a notification.
- **Record the books (Finance):** create a *Voucher* (cash/bank/journal) → a second person approves it
  (maker-checker) → it posts to the *General Ledger*. View the *Trial Balance*, *Balance Sheet*, and
  *Income Statement* any time.
- **Run payroll (HR):** maintain employees → record attendance and leave → run payroll → review HR
  reports.
- **Get insights (AI & Reporting):** open *AI Insights* for forecasts, lead scores, and anomaly
  flags, or build a custom report in the *Report Builder*.

The **notification bell** (top of the screen) tells you when background reactions affect you — a deal
closed, a ticket breached SLA, stock ran low, and so on.

---

## 8. Running for real (production deployment)

The quick start above already uses the production stack. For a real deployment, additionally:

1. **Use a real domain with HTTPS.** An Nginx reverse-proxy config and TLS setup live under
   `infra/nginx/`. Point your domain at the server and let Nginx terminate HTTPS in front of the web
   and API.
2. **Supply secrets safely.** Instead of putting secrets directly in `.env`, use your secret store or
   mount files and use the `*_FILE` convention (e.g. `JWT_ACCESS_SECRET_FILE=/run/secrets/jwt`). The
   config loader supports this.
3. **Enable the background workers** *after* migrations have run. These are off by default and turned
   on with environment flags:
   - `OUTBOX_RELAY_ENABLED` — publishes events to the broker.
   - `WORKER_REACTIONS_ENABLED` — runs the business reactions.
   - `NOTIFICATIONS_ENABLED` — turns events into notifications.
   - `REPORTING_REFRESH_ENABLED` — refreshes report read-models.
4. **Confirm health.** Each app exposes:
   - `GET /health` — is the process alive?
   - `GET /health/ready` — is it ready (database + Redis reachable)? It reports 503 while draining for
     shutdown, so your load balancer pulls it before it stops.
   - `GET /metrics` — Prometheus metrics.
5. **Roll out updates with zero lost work.** `SHUTDOWN_DRAIN_MS` lets each instance finish in-flight
   requests before stopping. Restart one instance at a time. Full steps are in
   **[`docs/runbook.md`](docs/runbook.md)**.

The complete operations guide — deploy, rolling restart, rollback, alerts→actions, dead-letter-queue
drain, graceful degradation, and scaling — is in **[`docs/runbook.md`](docs/runbook.md)**.

---

## 9. Developer setup (optional — for people changing the code)

This is for engineers who want to modify the system. If you only want to *use* it, skip this.

This is a **pnpm monorepo** running on **Node.js 22**. The apps run on your machine while only the
infrastructure (database, broker, etc.) runs in Docker.

```bash
# 1. Install dependencies
pnpm install

# 2. Start just the infrastructure (Postgres, Redis, RabbitMQ, MinIO, monitoring)
pnpm infra:up

# 3. Create the database tables
pnpm --filter @app/api migration:run

# 4. Run the apps you're working on (each in its own terminal)
pnpm --filter @app/api dev      # API
pnpm --filter @app/web dev      # Web dashboard (http://localhost:3001)
```

Useful commands from the repo root:

```bash
pnpm -w typecheck     # strict TypeScript check, zero errors expected
pnpm -w lint          # linting
pnpm -w test          # unit tests
pnpm infra:logs       # tail infrastructure logs
pnpm infra:ps         # show infrastructure containers
pnpm infra:reset      # stop infra AND wipe its data
```

**Important conventions** (enforced — read `CLAUDE.md` and `docs/adr/` before contributing):

- **Never use database `synchronize`** — every schema change is a reviewed, idempotent migration.
- **Never publish an event outside the transactional outbox** — business change + event commit
  together.
- **Never write a business query without tenant scope** — enforced both in code and by Postgres
  Row-Level Security.
- Money is always **integer minor units + currency code**, never floating point.
- All responses use a standard success envelope; all errors use RFC 7807 `problem+json`.

The authoritative design decisions are the Architecture Decision Records in
[`docs/adr/`](docs/adr/) (ADR-001 … ADR-009). The full build history is in
[`CHANGELOG-BUILD.md`](CHANGELOG-BUILD.md).

---

## 10. Backups, updates, and day-to-day operations

**Back up the database** (custom-format dump, optional upload to S3/MinIO):

```bash
bash infra/scripts/backup.sh
```

**Restore from a backup** (test restores into a scratch database first):

```bash
bash infra/scripts/restore.sh <backup-file>
```

**Apply a new version:**

```bash
git pull
docker compose -f infra/docker-compose.prod.yml up -d --build
bash infra/scripts/migrate-prod.sh          # apply any new migrations (idempotent)
```

**Continuous integration** runs on every change: typecheck, lint, unit tests, end-to-end tests
against the infrastructure, plus security scans (dependency audit, Trivy, pip-audit). See
`.github/workflows/`.

---

## 11. Troubleshooting

| Symptom | What to check |
|---|---|
| A page won't load at `localhost:3001` | Is the `web` container up? `docker compose -f infra/docker-compose.prod.yml ps`. Check logs: `docker compose -f infra/docker-compose.prod.yml logs web`. |
| "Port already in use" on startup | Another program uses that port. Edit the `ports:` mapping in `infra/docker-compose.prod.yml`. |
| Login fails on the demo account | Did the seed script (Step 5) complete? Re-run it — it's idempotent and exits cleanly if the demo already exists. |
| Tables/columns missing errors | Migrations weren't run. Run `bash infra/scripts/migrate-prod.sh`. |
| Notifications / background reactions don't happen | The background workers are flag-gated and off by default — set `OUTBOX_RELAY_ENABLED`, `WORKER_REACTIONS_ENABLED`, `NOTIFICATIONS_ENABLED` and restart. |
| Can't connect to the database | Confirm `POSTGRES_PASSWORD` in `.env` matches what you pass to the scripts, and that PgBouncer is healthy. |
| Need to see what's happening end-to-end | Open Grafana (<http://localhost:3004>) for dashboards, or check traces via the OTel pipeline. |

To read logs for any single service:

```bash
docker compose -f infra/docker-compose.prod.yml logs -f <service>   # e.g. api, web, worker, ml
```

---

## 12. Project layout & further reading

```
erp/
├─ apps/
│  ├─ api/      NestJS — the brain: business logic, auth, database, outbox
│  ├─ web/      Next.js — the dashboard you click around in
│  ├─ worker/   NestJS + BullMQ — reacts to events in the background
│  └─ ml/       Python FastAPI — AI/ML service
├─ packages/
│  ├─ shared/   shared contracts (envelopes, Money, event definitions)
│  └─ config/   validated environment schema
├─ infra/
│  ├─ docker-compose.yml          dev infrastructure
│  ├─ docker-compose.prod.yml     full production stack
│  ├─ nginx/                      reverse-proxy + HTTPS
│  └─ scripts/                    migrate / seed / backup / restore / acceptance
├─ docs/
│  ├─ adr/        Architecture Decision Records (the binding decisions)
│  └─ runbook.md  operations guide
├─ CLAUDE.md                     engineering conventions ("the constitution")
└─ CHANGELOG-BUILD.md            full build history
```

Further reading:

- **[`docs/runbook.md`](docs/runbook.md)** — operations: deploy, restart, rollback, scaling.
- **[`docs/adr/`](docs/adr/)** — why the system is built the way it is.
- **[`CLAUDE.md`](CLAUDE.md)** — coding conventions and non-negotiable rules.
- **[`CHANGELOG-BUILD.md`](CHANGELOG-BUILD.md)** — what was built, chunk by chunk.

---

*MetaXperts ERP — multi-tenant, event-driven, 100% open-source and self-hostable.*
