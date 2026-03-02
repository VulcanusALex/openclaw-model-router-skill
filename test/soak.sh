#!/usr/bin/env bash
set -euo pipefail

RUNS="${1:-20}"
if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [ "$RUNS" -le 0 ]; then
  echo "usage: test/soak.sh <runs>" >&2
  exit 2
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${TMPDIR:-/tmp}/model-router-soak-${STAMP}"
mkdir -p "$OUT_DIR"
FIRST_FAIL_LOG=""

for i in $(seq 1 "$RUNS"); do
  LOG_PATH="$OUT_DIR/run-${i}.log"
  if node --test >"$LOG_PATH" 2>&1; then
    printf '[%s/%s] pass\n' "$i" "$RUNS"
  else
    printf '[%s/%s] fail\n' "$i" "$RUNS" >&2
    FIRST_FAIL_LOG="$LOG_PATH"
    break
  fi
done

if [ -n "$FIRST_FAIL_LOG" ]; then
  echo "soak failed: first_failed_run_log=$FIRST_FAIL_LOG" >&2
  exit 1
fi

echo "soak complete: ${RUNS} runs"
echo "logs: $OUT_DIR"
