#!/usr/bin/env bash
set -euo pipefail

cd /app

# Exécute la suite séquentielle puis génère report.md et report.html.
node /app/benchmark/src/runner.mjs "$@"
node /app/benchmark/src/generate-report.mjs
