#!/usr/bin/env bash
# Fails if a tracked file contains something that looks like a real credential.
# Scans only files Git tracks, so untracked local files such as .env.local are ignored.

set -euo pipefail

cd "$(dirname "$0")/.."

fail=0
report() {
  echo "Possible secret: $1" >&2
  fail=1
}

# Environment files must never be tracked, except the placeholder template.
while IFS= read -r file; do
  case "$file" in
    .env.example) ;;
    .env|.env.*|*/.env|*/.env.*) report "tracked environment file: $file" ;;
  esac
done < <(git ls-files)

# Patterns: JWT-shaped tokens (service-role and anon keys), new-style Supabase secret keys,
# private key blocks and database URLs that carry a literal password.
patterns=(
  'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}'
  'sb_secret_[A-Za-z0-9_-]{10,}'
  '-----BEGIN (RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----'
  'postgres(ql)?://[^[:space:]:/]+:[^[:space:]@/]+@[^[:space:]]+'
)

for pattern in "${patterns[@]}"; do
  # Exclude this script (it contains the patterns). Placeholders are allowed only when they
  # are the whole secret, such as <password> or [PASSWORD]; a real value near the word
  # "example" is still reported.
  matches=$(git grep -nIE -- "$pattern" -- . ':!scripts/check-secrets.sh' || true)
  matches=$(printf '%s\n' "$matches" | grep -vE '(:|/)<[A-Za-z0-9 _-]+>@|\[[A-Z_]+\]@|your-publishable|placeholder-anon' || true)
  if [ -n "$matches" ]; then
    printf '%s\n' "$matches" >&2
    report "pattern $pattern"
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "Secret scan failed. Remove the value, rotate it, and never commit it." >&2
  exit 1
fi
echo "Secret scan passed: no credentials found in tracked files."
