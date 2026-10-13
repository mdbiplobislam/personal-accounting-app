# Backup and recovery

Financial data lives only in PostgreSQL. The repository holds the schema and the demo seed, so it
can rebuild an empty database, but it does **not** hold any user's data. Backups are therefore
essential.

## What is protected by what

| Asset | Source of truth | Protection |
|---|---|---|
| Schema, RLS, functions | `supabase/migrations/` in Git | Git history and code review |
| User financial data | hosted Postgres | Supabase backups (see below) and manual dumps |
| Secrets (keys, passwords) | Supabase and Vercel dashboards | Never in Git; rotate on suspicion of exposure |

## Automated backups (Supabase)

- Supabase takes daily backups of hosted projects. Retention depends on the plan.
- Point-in-time recovery (PITR) is available on higher tiers and allows restoring to a specific second.
  Check the plan under Project Settings > Database > Backups before you rely on it.
- Restore options and their downtime depend on the plan and on Supabase's current process. Confirm them in the Supabase documentation and plan a maintenance window before you need one.

## Manual logical backup

Run from a trusted machine. Use the **direct** connection string from Supabase, and keep the output out of Git:

```bash
export PGPASSWORD='<database password from the Supabase dashboard>'
pg_dump --format=custom --no-owner --no-privileges \
  --host db.<project-ref>.supabase.co --port 5432 --username postgres --dbname postgres \
  --schema public --file "pa-$(date +%F).dump"
unset PGPASSWORD
```

This dump covers `public` only. Auth users (including password hashes) live in the `auth` schema and
are protected by Supabase's own backups; do not copy them into ad-hoc files.

Store dumps encrypted. A dump contains real financial data, so treat it like the database itself:
limit access, and never attach one to an issue, a PR or a chat.

Verify a dump before relying on it:

```bash
pg_restore --list "pa-2026-03-01.dump" > /dev/null && echo "dump is readable"
```

## Restore procedure

Restore into a **new** database first, check it, then switch the application to it.

```bash
createdb -h <host> -U postgres pa_restore_check
pg_restore --no-owner --no-privileges --dbname pa_restore_check pa-2026-03-01.dump
psql -h <host> -U postgres -d pa_restore_check -c "select count(*) from public.transactions;"
```

Compare the row counts and the account balances (`select * from public.account_balances`) with the
values recorded before the incident. When they match, restore into production during a window, or
restore the dump into a new Supabase project and repoint the app's environment variables.

## Recovering from a bad migration

1. Stop the release. Do not run further `supabase db push` commands.
2. Assess the damage on a copy of the database (a backup or a branch database).
3. Either write a corrective forward migration and test it with `npm run test:db`, or restore from the
   backup taken before the push.

## Recovering from a leaked credential

1. Rotate the database password (Supabase dashboard > Database settings) and the publishable/anon key if it was exposed.
2. Remove the value from Git history with a history rewrite, and treat the old value as compromised.
3. Check `audit_logs` and Supabase logs for unexpected access.
4. Record the incident in `docs/` as a short note.

## Rehearsal

Restore a fresh backup into a scratch database at least once per quarter and run `npm run test:db`
against it, so the restore path is known to work before it is needed.
