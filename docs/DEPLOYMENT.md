# Deployment and database workflow

Two systems are deployed: the **database** (Supabase) and the **web app** (Vercel). Deploy the
database first, because a new app version may depend on new schema.

## 1. Local development with the Supabase CLI

Requirements: Node 22 (see `.nvmrc`), Docker (for the local Supabase stack), and the Supabase CLI
(`npx supabase` or a global install).

```bash
npm ci
npm run db:start            # starts Postgres, Auth, Studio and the API in Docker
npm run db:reset            # drops local data, applies every migration, runs seed.sql
cp .env.example .env.local  # then paste the local URL and anon key that `supabase status` prints
npm run dev                 # http://127.0.0.1:5173
```

Local Studio is at http://127.0.0.1:54323. The demo user `demo@example.com` has no password by
default. Set one in Studio (Authentication > Users) before signing in.

## 2. Making a schema change

Never edit a migration that has been applied anywhere. Create a new one:

```bash
npx supabase migration new add_something           # creates supabase/migrations/<timestamp>_add_something.sql
# write the SQL, then:
npm run db:reset                                    # rebuild locally from scratch: proves the migrations still apply
npm run test:db                                     # runs the schema, seed and SQL accounting/RLS tests
npm run db:types                                    # writes src/lib/database.types.ts; update src/lib/types.ts to match
```

If you prefer to write the change in Studio and capture it, use
`npx supabase db diff -f add_something` to generate the migration from the local database. Review the
generated file before committing. Add or update tests in `supabase/tests/` for every new rule or policy.

## 3. Verifying a deployed database matches the repository

Run these against the linked hosted project:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>           # project ref from the dashboard URL
npx supabase migration list                             # Local and Remote columns must match
npx supabase db diff --linked --schema public           # must print no changes
```

A non-empty diff means someone changed the hosted schema by hand. Capture that change as a migration
(`npx supabase db diff --linked -f reconcile_<name>`), review it, and commit it. Do not edit the
hosted database directly.

## 4. Applying migrations to the hosted project

Migrations are applied by the pipeline, not by hand:

```bash
npx supabase db push --linked        # applies pending files from supabase/migrations, in order
```

The CLI applies pending files in filename order and stops at the first failure. Check the output and
`npx supabase migration list` after any failed push to see exactly which files were applied. Fix the
problem with a new migration, never by editing a file that has already run.

Before a production push, take a backup (see `docs/BACKUP_AND_RECOVERY.md`).

## 5. Web app on Vercel

1. Import the GitHub repository in Vercel. The framework is detected as Vite; `vercel.json` sets the
   build command, output directory and SPA rewrite.
2. Set these **Production** and **Preview** environment variables in the Vercel project settings:
   - `VITE_SUPABASE_URL`: the project URL (`https://<project-ref>.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY`: the **publishable / anon** key only
3. Never add a service-role key or a database password to any `VITE_` variable, because Vite
   embeds `VITE_` values in the browser bundle. Server-side secrets belong in Supabase Edge
   Function secrets, which this app does not use.
4. In Supabase Authentication > URL Configuration, set the Site URL to the production domain and
   add the Vercel preview domains to the redirect allow-list.

## 6. Release order

1. Merge to `main` only when CI is green (lint, typecheck, unit tests, build, database tests, secret scan).
2. Apply new migrations to the hosted project (`supabase db push --linked`).
3. Vercel deploys `main` automatically. Confirm the deployment and sign in with a test account.
4. Verify with `supabase db diff --linked` that the hosted schema matches the repository.

## 7. Rollback

- **Application**: promote the previous deployment in Vercel (Deployments > Promote to Production).
- **Database**: migrations are forward-only. To undo a change, write a new migration that reverses it,
  and test it locally first. For data damage, restore from a backup (see `docs/BACKUP_AND_RECOVERY.md`).
