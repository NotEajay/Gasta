#!/usr/bin/env bash
# GasTa ETL — full setup and import for one NCR bulletin week
set -euo pipefail
cd "$(dirname "$0")/.."

WEEK="${1:-2026-04-28}"
PDF="data/bulletins/ncr-${WEEK}.pdf"
SQL="output/load-ncr-${WEEK}.sql"

echo "==> Step 1/5: Python virtual environment"
python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt

echo "==> Step 2/5: Environment file"
if [[ ! -f .env ]]; then
  cp .env.example .env
  # Copy Supabase URL from mobile app if available
  if [[ -f ../mobile/.env ]]; then
    URL=$(grep EXPO_PUBLIC_SUPABASE_URL ../mobile/.env | cut -d= -f2-)
    if [[ -n "$URL" ]]; then
      sed -i '' "s|^SUPABASE_URL=.*|SUPABASE_URL=${URL}|" .env 2>/dev/null || \
        sed -i "s|^SUPABASE_URL=.*|SUPABASE_URL=${URL}|" .env
    fi
  fi
  echo "Created etl/.env — add SUPABASE_SERVICE_ROLE_KEY before load step."
fi

mkdir -p data/bulletins output

echo "==> Step 3/5: Download DOE NCR PDF (week ${WEEK})"
.venv/bin/python run.py download-ncr --week "$WEEK" --out-dir data/bulletins

echo "==> Step 4/5: Parse PDF"
.venv/bin/python run.py parse "$PDF" --region ncr -o "output/parsed-ncr-${WEEK}.json"

echo "==> Step 5/5: Export SQL + load to Supabase"
.venv/bin/python run.py export-sql "$PDF" --region ncr -o "$SQL"

if grep -q "your-service-role-key" .env 2>/dev/null || ! grep -q "SUPABASE_SERVICE_ROLE_KEY=ey" .env 2>/dev/null; then
  echo ""
  echo "Service role key not set in etl/.env"
  echo "Option A — add SUPABASE_SERVICE_ROLE_KEY to etl/.env, then run:"
  echo "  .venv/bin/python run.py load $PDF --region ncr"
  echo ""
  echo "Option B — paste this file in Supabase SQL Editor:"
  echo "  $SQL"
  exit 0
fi

.venv/bin/python run.py load "$PDF" --region ncr
echo "Done — real DOE prices loaded for NCR week ${WEEK}."
