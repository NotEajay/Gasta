#!/usr/bin/env bash
# GasTa ETL — first-time setup, then load the current week and the price history.
#
# Usage:
#   ./setup_and_import.sh                # setup + current week + full history backfill
#   ./setup_and_import.sh --latest-only  # setup + current week only
set -euo pipefail
cd "$(dirname "$0")"

LATEST_ONLY=0
if [[ "${1:-}" == "--latest-only" ]]; then
  LATEST_ONLY=1
fi

echo "==> Step 1/4: Python virtual environment"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt

echo "==> Step 2/4: Environment file"
if [[ ! -f .env ]]; then
  cp .env.example .env
  # Reuse the Supabase URL from the mobile app when it is already configured.
  if [[ -f ../mobile/.env ]]; then
    URL=$(grep EXPO_PUBLIC_SUPABASE_URL ../mobile/.env | cut -d= -f2-)
    if [[ -n "$URL" ]]; then
      sed -i '' "s|^SUPABASE_URL=.*|SUPABASE_URL=${URL}|" .env 2>/dev/null ||
        sed -i "s|^SUPABASE_URL=.*|SUPABASE_URL=${URL}|" .env
    fi
  fi
  echo "Created etl/.env — add SUPABASE_SERVICE_ROLE_KEY before the load steps."
fi

mkdir -p data/bulletins output

if ! grep -q "SUPABASE_SERVICE_ROLE_KEY=ey" .env 2>/dev/null; then
  echo ""
  echo "SUPABASE_SERVICE_ROLE_KEY is not set in etl/.env."
  echo "Add it (Supabase Dashboard → Settings → API → service_role), then re-run this script."
  exit 1
fi

echo "==> Step 3/4: Sync the latest DOE bulletin for every region"
.venv/bin/python run.py sync-all

if [[ "$LATEST_ONLY" == "1" ]]; then
  echo "Done — current week loaded. Run 'python run.py backfill' later for price history."
  exit 0
fi

echo "==> Step 4/4: Backfill the DOE archive (price history — this takes a while)"
.venv/bin/python run.py backfill

echo "Done — current prices and price history loaded from DOE."
