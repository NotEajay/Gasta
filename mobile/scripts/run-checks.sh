#!/bin/bash
# Runs the structural checks for the Budget insights / litres-coverage logic.
#
# The repo has no tsx/ts-node runner installed, so this compiles the pure
# modules to CommonJS with the bundled TypeScript and executes them with node.
# Only the pure functions are exercised: the Supabase client is stubbed and no
# query is performed.
set -uo pipefail

MOBILE_DIR="/Users/dannapaulallagas/Updated Gasta/Gasta/mobile"
OUT="/tmp/chk"

cd "$MOBILE_DIR" || exit 1

# Recompile the pure modules. The shim and the client stub are recreated
# afterwards because the compile clears the output directory.
node node_modules/typescript/bin/tsc \
  scripts/checkBudgetInsights.ts \
  lib/budgetInsights.ts \
  lib/services/budgetAnalytics.ts \
  lib/format.ts \
  constants/Theme.ts \
  --ignoreConfig \
  --outDir "$OUT" \
  --module commonjs \
  --target es2020 \
  --moduleResolution node \
  --skipLibCheck \
  --esModuleInterop 2>&1 | grep -E 'error TS[0-9]' && {
    echo "COMPILE FAILED"
    exit 1
  }

# The compile empties the output directory, so the path-alias shim and the
# Supabase stub are copied in afterwards rather than living in /tmp directly.
mkdir -p "$OUT/lib"
cp scripts/checkSupport/alias.js "$OUT/scripts/alias.js"
cp scripts/checkSupport/supabaseStub.js "$OUT/lib/supabase.js"

node -e "require('$OUT/scripts/alias.js'); require('$OUT/scripts/checkBudgetInsights.js');"
