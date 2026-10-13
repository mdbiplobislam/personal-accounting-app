#!/usr/bin/env bash
# Builds a fresh PostgreSQL database from the repository's migrations, loads the seed
# data, then runs every SQL test in supabase/tests/. Fails on the first error.
#
# Connection comes from the standard PG* environment variables, e.g.
#   PGHOST=127.0.0.1 PGPORT=54322 PGUSER=postgres PGPASSWORD=postgres npm run test:db
#
# This targets a throwaway database named pa_schema_test, which is dropped and
# recreated on every run. Never point it at a database holding real data.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DB="${PA_TEST_DB:-pa_schema_test}"

if [[ "$TEST_DB" != pa_* ]]; then
  echo "Refusing to reset database '$TEST_DB': the name must start with pa_" >&2
  exit 1
fi

export PGDATABASE=postgres
psql -v ON_ERROR_STOP=1 -q -X -c "drop database if exists ${TEST_DB} with (force);"
psql -v ON_ERROR_STOP=1 -q -X -c "create database ${TEST_DB};"

export PGDATABASE="$TEST_DB"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

echo "==> Local auth shim (plain PostgreSQL only)"
"${PSQL[@]}" -f "$ROOT/scripts/db/local-auth-shim.sql"

echo "==> Migrations"
shopt -s nullglob
migrations=("$ROOT"/supabase/migrations/*.sql)
if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "No migrations found" >&2
  exit 1
fi
for file in "${migrations[@]}"; do
  echo "    $(basename "$file")"
  "${PSQL[@]}" -1 -f "$file"
done

echo "==> Seed data"
"${PSQL[@]}" -1 -f "$ROOT/supabase/seed.sql"

echo "==> SQL tests"
for file in "$ROOT"/supabase/tests/*.sql; do
  echo "    $(basename "$file")"
  "${PSQL[@]}" -f "$file"
done

echo "All database checks passed."
