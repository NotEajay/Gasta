#!/usr/bin/env bash
# GasTa local setup — requires Docker Desktop + Supabase CLI
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Checking prerequisites..."
command -v docker >/dev/null 2>&1 || {
  echo "ERROR: Docker is not installed or not running."
  echo "Install Docker Desktop: https://docs.docker.com/desktop/"
  exit 1
}
command -v supabase >/dev/null 2>&1 || {
  echo "ERROR: Supabase CLI not found."
  echo "Install: brew install supabase/tap/supabase"
  exit 1
}

echo "==> Starting Supabase..."
supabase start

echo "==> Applying migrations + seed data..."
supabase db reset

echo "==> Writing mobile/.env..."
SUPABASE_URL=$(supabase status -o env | grep SUPABASE_URL | cut -d= -f2-)
ANON_KEY=$(supabase status -o env | grep SUPABASE_ANON_KEY | cut -d= -f2-)

cat > mobile/.env <<EOF
EXPO_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
EXPO_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
EOF

echo "==> Installing mobile dependencies..."
cd mobile && npm install

echo ""
echo "Setup complete. Run the app:"
echo "  cd mobile && npm run android"
