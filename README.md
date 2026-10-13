# Personal Accounting

A personal finance web app for cash, bank accounts, bKash, Nagad, Rocket and credit cards, in BDT.
It tracks income and expenses, transfers, loans and repayments, budgets, savings goals, and monthly and
yearly reports with CSV export.

Financial data is stored in PostgreSQL on Supabase. Access is enforced by Row Level Security, and every
multi-row operation runs in a single database transaction.

## Stack

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Vite 7, Tailwind CSS 4 |
| Charts | Recharts 3 |
| Validation | Zod 4 (forms), plus CHECK constraints and triggers in the database |
| Auth and data | Supabase Auth, PostgreSQL 17, Supabase CLI for migrations |
| Tests | Vitest (unit), plain SQL run with `psql` (schema, accounting and RLS) |
| CI | GitHub Actions: lint, typecheck, unit tests, build, database tests, secret scan |
| Hosting | Vercel (web), Supabase (database) |

## Repository layout

```
src/                 React app: pages, components, contexts, data access (src/lib)
tests/               Vitest unit tests for accounting rules, money, CSV, schemas, idempotency
supabase/
  config.toml        Supabase CLI configuration
  migrations/        Every schema change, as an ordered SQL file. Applied files are never edited.
  seed.sql           Fictional demo data only
  tests/             SQL tests for accounting rules and access control
scripts/             db-test.sh (fresh DB + migrations + seed + SQL tests), check-secrets.sh
docs/                DATABASE_SCHEMA.md, ACCOUNTING_RULES.md, DEPLOYMENT.md, BACKUP_AND_RECOVERY.md
.github/workflows/   CI
```

## Quick start

Requirements: Node 22, Docker (for the local Supabase stack).

```bash
npm ci
npm run db:start          # local Postgres, Auth and Studio in Docker
npm run db:reset          # build the database from the migrations and load the seed
cp .env.example .env.local   # fill in the local URL and anon key shown by `supabase status`
npm run dev               # http://127.0.0.1:5173
```

Sign up with any email, or set a password for `demo@example.com` in Studio to use the demo data.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript project check |
| `npm test` | Unit tests |
| `npm run build` | Production build into `dist/` |
| `npm run test:db` | Rebuild a scratch database from the migrations, load the seed, run the SQL tests (needs `PG*` variables) |
| `npm run check:secrets` | Scan tracked files for credentials |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase stack |
| `npm run db:diff` | Compare the linked hosted database with the migrations |
| `npm run db:types` | Generate `src/lib/database.types.ts` from the local database (reference; the app uses the hand-written `src/lib/types.ts`) |

## Accounting in brief

- Income and expenses are separate from transfers and loans. Transfers never count as income or expense.
- Borrowed money is not income. Loan principal is not income or expense; only loan interest is.
- Refunds reduce expense and are never income.
- Balances are computed from the opening balance and every movement, so they cannot drift.
- Each money-moving submit carries an idempotency key, so a retry cannot post twice.

Full rules: [docs/ACCOUNTING_RULES.md](docs/ACCOUNTING_RULES.md).

## Security

- Row Level Security on every table. Each policy compares `user_id` to `auth.uid()`.
- Composite foreign keys stop a row from referencing another user's data.
- Write functions check ownership themselves, and anonymous users have no table access.
- Loans and audit logs are read-only for clients. Loan changes happen only through the loan functions.
- Secrets never enter the repository. `.env*` files are ignored except `.env.example`, which holds
  placeholders only. The browser receives only the publishable/anon key.
- The secret scan runs in CI on every pull request.

## Documentation

- [Database schema](docs/DATABASE_SCHEMA.md)
- [Accounting rules](docs/ACCOUNTING_RULES.md)
- [Deployment and migration workflow](docs/DEPLOYMENT.md)
- [Backup and recovery](docs/BACKUP_AND_RECOVERY.md)
