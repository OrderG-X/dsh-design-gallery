#!/bin/bash
# 触发这回闸门的 pr-check（run id + attempt）是不是这个 PR 这个提交最新的一回。
#   只数同一个来源仓库 + 来源分支的（两个 PR 的提交一样时各算各的：别的 PR 的运行 id 更大不算这回过期）
#   - 过期：这个提交有 id 更大的 pr-check（后面又跑过），或者这回现在的 attempt 比触发时的大（被重跑过）
#   - 最新：数到了这回、没有更大的 id、attempt 也没涨
#   - 说不准：查询出错、数据不对、列表里连这回都没有（又没有更大的）——不能当成过期，也不能当成最新
#   别的回合被取消了（conclusion cancelled）的不算「后面又跑过」：比如重跑旧的一回时，PR 的并发组把正在跑的新一回取消了，
#   这时重跑的这回才是最新的（不然两回都没有闸门结论）
# 用法：bash scripts/latest-check.sh <提交 sha> <run id> <run attempt> <来源分支> <来源仓库 node_id（改名也不变）>
# 退出码：0 最新；3 过期；1 说不准
# 环境变量：READ_TOKEN（能读 Actions 的 GITHUB_TOKEN；App 没有 Actions 权限）、GITHUB_REPOSITORY
set -euo pipefail
[ -n "${4:-}" ] && [ -n "${5:-}" ] || { echo "要给来源分支和来源仓库"; exit 1; }
[[ "$2" =~ ^[0-9]+$ && "$3" =~ ^[0-9]+$ ]] || { echo "run id / attempt 不对"; exit 1; }
GH_TOKEN="$READ_TOKEN" gh api --paginate "repos/$GITHUB_REPOSITORY/actions/workflows/pr-check.yml/runs?head_sha=$1&per_page=100" > latest-raw.json || { echo "查不到这个提交跑过哪几回检查"; exit 1; }
jq -r --arg b "$4" --arg r "$5" --argjson me "$2" '.workflow_runs[] | select(.head_branch == $b and .head_repository.node_id == $r and (.conclusion != "cancelled" or .id == $me)) | "\(.id) \(.run_attempt)"' latest-raw.json > latest-runs.txt || { echo "检查记录读不出来"; exit 1; }
if grep -qvE '^[0-9]+ [0-9]+$' latest-runs.txt; then echo "检查记录的格式不对"; exit 1; fi
newest=$(sort -n latest-runs.txt | tail -1 | cut -d' ' -f1)
mine=$(awk -v id="$2" '$1 == id { print $2; exit }' latest-runs.txt)
if [ -n "$newest" ] && [ "$newest" -gt "$2" ]; then echo "这个提交后来又跑过检查（${newest}），这回（$2）作废"; exit 3; fi
[ -n "$mine" ] || { echo "检查记录里数不到这一回（$2）"; exit 1; }
if [ "$mine" -gt "$3" ]; then echo "这回检查（$2）被重跑过（现在第 $mine 回，触发时第 $3 回），这回作废"; exit 3; fi
exit 0
