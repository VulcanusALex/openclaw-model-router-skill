#!/usr/bin/env bash
set -euo pipefail

RUNS="${1:-20}"
if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [ "$RUNS" -le 0 ]; then
  echo "usage: test/soak.sh <runs>" >&2
  exit 2
fi

for i in $(seq 1 "$RUNS"); do
  node --test >/tmp/model-router-soak-${i}.log 2>&1
  printf '[%s/%s] pass\n' "$i" "$RUNS"
done

echo "soak complete: ${RUNS} runs"
