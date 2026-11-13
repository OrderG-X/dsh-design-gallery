#!/bin/bash
# 这个 PR（或 issue）被关过、重开过没有：看事件记录里的 closed / reopened（关了又重开，记录还在）。
#   重开也算：「从什么时候起」之前就关着、之后才被重开的（比如维护者 /approve 时 PR 正关着，之后有人 /reject、作者再重开），
#   只看关的时间会漏掉
# 用法：bash scripts/closed-by.sh <号> [不算谁动的（数字账号 id，比如作者自己关的、重开的不算；空着就谁动的都算）] [从什么时候起（ISO 时间，同一秒的也算）]
# 退出码：0 关过 / 重开过；3 都没有；1 查不到（记录读不出来、时间读不出来，都当查不到，不能当成没有）
# 环境变量：GH_TOKEN、GITHUB_REPOSITORY
set -euo pipefail
n=$1
skip=${2:-}
since=${3:-}
[[ "$n" =~ ^[1-9][0-9]*$ ]] || exit 1
gh api --paginate "repos/$GITHUB_REPOSITORY/issues/$n/events?per_page=100" > closed-ev.json 2>/dev/null || exit 1
jq -e -s 'all(.[]; type == "array")' closed-ev.json > /dev/null 2>&1 || exit 1
jq -r -s '.[][] | select(type == "object" and (.event == "closed" or .event == "reopened")) | "\(.created_at // "-") \(.actor.id // "-")"' closed-ev.json > closed-ev.txt 2>/dev/null || exit 1
while read -r t a; do
  [[ "$t" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] || exit 1
  if [ -n "$skip" ] && [ "$a" = "$skip" ]; then continue; fi
  if [ -n "$since" ] && [[ "$t" < "$since" ]]; then continue; fi
  exit 0
done < closed-ev.txt
exit 3
