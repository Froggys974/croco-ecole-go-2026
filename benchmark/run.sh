#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Colors ────────────────────────────────────────────────────────────
G=$'\033[38;5;83m'    # fern green
GD=$'\033[38;5;65m'   # dark fern
ND=$'\033[38;5;220m'  # node amber
BN=$'\033[38;5;215m'  # bun peach
GO=$'\033[38;5;80m'   # go cyan
GR=$'\033[38;5;243m'  # grey dim
BD=$'\033[1m'
RS=$'\033[0m'

# ── Go bench destinations ─────────────────────────────────────────────
declare -A GO_DESTS=(
  ["$SCRIPT_DIR/go/01_bench_test.go"]="$ROOT_DIR/projects/01/dist/add.ts/bench_test.go"
  ["$SCRIPT_DIR/go/02_bench_test.go"]="$ROOT_DIR/projects/02/dist/add.ts/bench_test.go"
  ["$SCRIPT_DIR/go/03_bench_test.go"]="$ROOT_DIR/projects/03/dist/add.ts/bench_test.go"
  ["$SCRIPT_DIR/go/04_bench_test.go"]="$ROOT_DIR/projects/04/dist/add.ts/bench_test.go"
)
cleanup() { for dest in "${GO_DESTS[@]}"; do rm -f "$dest"; done; }
trap cleanup EXIT

# ── Helpers ──────────────────────────────────────────────────────────
hline() {
  printf "${GR}  "
  printf '%.0s─' {1..70}
  printf "${RS}\n"
}

section() {
  printf "\n${BD}${G}  %s${RS}\n" "$1"
  hline
  printf "\n"
}

# Log-scale bar length (integer)
log_bar_len() {
  awk -v v="$1" -v m="$2" -v w="$3" 'BEGIN{
    if (v <= 0 || m <= 0) { print 1; exit }
    n = int(log(v) / log(m) * w + 0.5)
    if (n < 1) n = 1
    if (n > w) n = w
    print n
  }'
}

# Build bar string of N chars
make_bar() {
  local n=$1 bar=""
  for ((i = 0; i < n; i++)); do bar+="█"; done
  printf '%s' "$bar"
}

# Format ratio
ratio() {
  awk -v a="$1" -v b="$2" 'BEGIN{
    if (b == 0) { print "∞"; exit }
    r = a / b
    if (r >= 10) printf "×%.0f\n", r
    else         printf "×%.1f\n", r
  }'
}

# ── Banner ───────────────────────────────────────────────────────────
printf "\n"
printf "  ${BD}${G}╔════════════════════════════════════════════════════════════╗${RS}\n"
printf "  ${BD}${G}║${RS}  DuploJS Either Benchmark                                   ${BD}${G}║${RS}\n"
printf "  ${BD}${G}║${RS}  ${ND}Node.js${RS}  ·  ${BN}Bun${RS}  ·  ${GO}Go${RS}  —  exo01 → exo04 · exécution seule  ${BD}${G}║${RS}\n"
printf "  ${BD}${G}╚════════════════════════════════════════════════════════════╝${RS}\n"
printf "\n"

# ── Run Node ─────────────────────────────────────────────────────────
NODE_VER=$(node --version)
printf "  ${ND}●${RS} Node.js ${NODE_VER}  ${GR}running...${RS}"
NODE_OUT=$(node --import=tsx/esm "$SCRIPT_DIR/node-bench.ts" 2>/dev/null)
printf "\r  ${ND}✓${RS} Node.js ${NODE_VER}  ${GR}done             ${RS}\n"

# ── Run Bun ──────────────────────────────────────────────────────────
BUN_VER=$(bun --version)
printf "  ${BN}●${RS} Bun ${BUN_VER}  ${GR}running...${RS}"
BUN_OUT=$(bun run "$SCRIPT_DIR/node-bench.ts" 2>/dev/null | grep -E '^\s*\[exo')
printf "\r  ${BN}✓${RS} Bun ${BUN_VER}  ${GR}done             ${RS}\n"

# ── Run Go ───────────────────────────────────────────────────────────
GO_VER=$(go version | awk '{print $3}')
printf "  ${GO}●${RS} Go ${GO_VER}  ${GR}running...${RS}"
# Le nom du package Go dépend du chemin absolu du projet : on reprend celui du fichier généré
for src in "${!GO_DESTS[@]}"; do
  dest="${GO_DESTS[$src]}"
  pkg=$(grep -m1 '^package ' "$(dirname "$dest")/add.ts.go")
  sed "s/^package .*/$pkg/" "$src" > "$dest"
done
GO_OUT=""
for exo in 01 02 03 04; do
  if ! out=$(cd "$ROOT_DIR/projects/$exo/dist" && go test -bench=. -benchmem -count=1 ./add.ts/ 2>&1); then
    printf "\n  ${GO}✗${RS} Go exo%s a échoué :\n%s\n" "$exo" "$out"
    exit 1
  fi
  GO_OUT+="$out"$'\n'
done
printf "\r  ${GO}✓${RS} Go ${GO_VER}  ${GR}done             ${RS}\n"

# ── Parse results ─────────────────────────────────────────────────────
# Node/Bun: "  [exoNN] label   NNN.N ns/op"  → field (NF-1) = NNN.N
mapfile -t NODE_NS  < <(echo "$NODE_OUT" | grep -E '^\s*\[exo' | awk '{print $(NF-1)}')
mapfile -t BUN_NS   < <(echo "$BUN_OUT"  | grep -E '^\s*\[exo' | awk '{print $(NF-1)}')
# Go: "BenchmarkExoNN-N   ITERS   NNN ns/op   0 B/op   0 allocs/op"
mapfile -t GO_NS    < <(echo "$GO_OUT"   | grep -E '^Benchmark' | awk '{print $3}')
mapfile -t GO_BYTES < <(echo "$GO_OUT"   | grep -E '^Benchmark' | awk '{print $5}')
mapfile -t GO_ALOCS < <(echo "$GO_OUT"   | grep -E '^Benchmark' | awk '{print $7}')

EXOS=(exo01 exo02 exo03 exo04)
LABELS=(
  "add(1,2) → EitherSuccess → isRight"
  "+whenIsRight(result, coalescing)"
  "+pipe(result, whenIsRight(coalescing))"
  "add(-1,2) → EitherFail → passthrough"
)

ALL_NS=("${NODE_NS[@]}" "${BUN_NS[@]}" "${GO_NS[@]}")
MAX_NS=$(printf '%s\n' "${ALL_NS[@]}" | awk 'BEGIN{m=0}{if($1+0>m)m=$1+0}END{print m}')

# ── Results Table ─────────────────────────────────────────────────────
section "Results"

printf "  ${GR}%-8s  %-40s  %9s  %9s  %9s  %s${RS}\n" \
  "" "Exercice" "Node v24" "Bun 1.4.5" "Go 1.27.4" "Allocs (Go)"
printf "  ${GR}"
printf '%.0s─' {1..88}
printf "${RS}\n\n"

for i in 0 1 2 3; do
  exo="${EXOS[$i]}"
  label="${LABELS[$i]}"
  n="${NODE_NS[$i]:-?}"
  b="${BUN_NS[$i]:-?}"
  g="${GO_NS[$i]:-?}"
  al="${GO_ALOCS[$i]:-0}"

  printf "  ${G}[%-6s]${RS}  %-40s  ${ND}%7s ns${RS}  ${BN}%7s ns${RS}  ${GO}%7s ns${RS}  ${G}%s${RS}\n" \
    "$exo" "$label" "$n" "$b" "$g" "$al"
done

# ── Bars (log scale) ──────────────────────────────────────────────────
section "Performance"

BAR_W=38

for i in 0 1 2 3; do
  exo="${EXOS[$i]}"
  n="${NODE_NS[$i]:-0}"
  b="${BUN_NS[$i]:-0}"
  g="${GO_NS[$i]:-0}"

  nlen=$(log_bar_len "$n" "$MAX_NS" "$BAR_W")
  blen=$(log_bar_len "$b" "$MAX_NS" "$BAR_W")
  glen=$(log_bar_len "$g" "$MAX_NS" "$BAR_W")

  nbar=$(make_bar "$nlen"); npad=$((BAR_W - nlen))
  bbar=$(make_bar "$blen"); bpad=$((BAR_W - blen))
  gbar=$(make_bar "$glen"); gpad=$((BAR_W - glen))

  printf "  ${G}[%s]${RS}\n" "$exo"
  printf "    ${ND}Node  %s%*s  %7s ns${RS}\n" "$nbar" "$npad" "" "$n"
  printf "    ${BN}Bun   %s%*s  %7s ns${RS}\n" "$bbar" "$bpad" "" "$b"
  printf "    ${GO}Go    %s%*s  %7s ns${RS}\n" "$gbar" "$gpad" "" "$g"
  printf "\n"
done
