#!/bin/bash
# Round-robin tournament: every pair of strategies plays SEEDS deals twice (duplicate format).
# Usage: scripts/tournament.sh "hard medium agent1 agent2 agent3 agent4" 100 20 8
set -u
LIST=${1:-"medium hard agent1 agent2 agent3 agent4"}
SEEDS=${2:-100}
BUDGET=${3:-20}
PAR=${4:-8}
SEED0=${SEED0:-500000}
mkdir -p results/tournament
read -ra S <<< "$LIST"
jobs=()
for ((i = 0; i < ${#S[@]}; i++)); do
  for ((j = i + 1; j < ${#S[@]}; j++)); do jobs+=("${S[i]} ${S[j]}"); done
done
echo "pairs: ${#jobs[@]}  seeds/pair: $SEEDS (x2 matches)  budget: ${BUDGET}ms  parallel: $PAR"
run() {
  set -- $1
  A=$1 B=$2 SEEDS=$SEEDS BUDGET=$BUDGET SEED0=$SEED0 OUT=results/tournament/$1-vs-$2.json \
    npx vitest run tests/duel.test.ts > /dev/null 2>&1 && echo "done $1 vs $2" || echo "FAILED $1 vs $2"
}
export -f run; export SEEDS BUDGET SEED0
printf '%s\n' "${jobs[@]}" | xargs -P "$PAR" -I{} bash -c 'run "{}"'
