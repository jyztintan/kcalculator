# KCalculator

Telegram-first calorie tracking with a database-backed backend, a web dashboard, reminders, and CSV migration tooling for your existing Google Sheets workflow.

## What is included

- `apps/api`: Fastify API, Telegram bot, Prisma schema, reminders, natural-language parsing, and CSV import/export scripts
- `apps/dashboard`: Next.js dashboard with summary cards and chart views inspired by your current master sheet
- `packages/shared`: shared Zod schemas and domain types used across the app

## Core features

- Telegram commands for `/start`, `/log`, `/day`, `/week`, `/goal`, `/reminders`, and `/editlast`
- Structured logging flow with inline buttons and favourite foods
- Natural-language fallback with explicit confirmation before saving
- Postgres data model for users, foods, meal entries, reminders, and parse audit history
- Dashboard for trend charts, goal hit/miss visibility, and top-food breakdowns
- CSV import/export path so you can migrate from Google Sheets without keeping Sheets as the runtime backend

## Setup

1. Copy `.env.example` to `.env` and fill in at least:
   - `DATABASE_URL`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_ALLOWED_USER_IDS`
   - `DEFAULT_DASHBOARD_TELEGRAM_ID`
2. Start Postgres:

```bash
docker compose up -d
```

3. Generate the Prisma client and push the schema:

```bash
npm run prisma:generate
npm run db:push
```

4. Seed a starter user and sample favourite:

```bash
npm run seed
```

5. Run the backend and dashboard:

```bash
npm run dev:api
npm run dev:dashboard
```

6. [For devs] Visualise backend data with: `npx prisma studio --schema apps/api/prisma/schema.prisma`

2. Visualise dashboard data with: `npm run dev:dashboard`

## Google Sheets migration

Export the sheet as CSV, then run:

```bash`
IMPORT_FILE="/absolute/path/to/export.csv" npm run import:csv
```

The importer looks for flexible column names such as `Date`, `Date (Present)`, `Food`, `Calories`, and `Target`.

To export data back out:

```bash
EXPORT_DIR="exports" npm run export:csv
```

## Natural-language parsing

The bot always prefers a structured save model even when you type natural language. For example:

- `lunch chicken rice 650`
- `had protein oats for breakfast 420`

If parsing confidence is high, the bot asks for confirmation before the entry is persisted. If `OPENAI_API_KEY` is not configured, the parser falls back to built-in heuristics.
