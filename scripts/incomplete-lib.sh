# 「检查没跑完」的两个 job（贴卡、等一会儿再重跑）共用：source 进来用
# 要的变量：R（仓库）、n（PR 号）、RUN_SHA、RUN_ID、RUN_ATTEMPT、RUN_HEAD_BRANCH、RUN_HEAD_REPO_ID（来源仓库的 node_id：改名也不变）、READ_TOKEN（能读 Actions 的 GITHUB_TOKEN）、APP_SLUG、GITHUB_REPOSITORY_OWNER

# 单独 @ 维护者（24 小时内同一个 PR 只一次；维护者 /hold 过的不 @；发之前再看一眼 head）
#   别的提交的闸门回合可能同时走到这里，只让还是最新提交的那个 @（查不到就照发）
ping_maint() {
  local since pinged now
  gh api --paginate "repos/$R/issues/$n/labels?per_page=100" --jq '.[].name' > ping-labels.txt 2>/dev/null || : > ping-labels.txt
  if grep -qx 'held: maintainer' ping-labels.txt; then echo "维护者挂起了，不 @"; return 0; fi
  since=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)
  # 查不到提醒过没有：返回失败（不能当成没提醒过再 @ 一次；调用方写在 || 里时 set -e 管不到这里）
  pinged=$(gh api "repos/$R/issues/$n/comments" --paginate --jq ".[] | select(.user.login == \"${APP_SLUG}[bot]\" and (.body | test(\"^<!-- dsh-gallery-stuck [0-9a-f]{40} -->\")) and .created_at >= \"$since\") | .id" | tail -1) || return 1
  [ -z "$pinged" ] || { echo "24 小时内提醒过了"; return 0; }
  # 确实读到关了、或者确实读到了别的提交（40 位）才不 @；查不到、缺字段都照发
  now=$(gh api "repos/$R/pulls/$n" --jq '"\(.state) \(.head.sha)"' 2>/dev/null || echo error)
  case "$now" in
    "closed "*) echo "#$n 已经关了，不 @"; return 0 ;;
    "open "*) if [[ "${now#open }" =~ ^[0-9a-f]{40}$ ]] && [ "${now#open }" != "$RUN_SHA" ]; then echo "#$n 有新提交，不 @"; return 0; fi ;;
  esac
  printf '<!-- dsh-gallery-stuck %s -->\n@%s %s\n' "$RUN_SHA" "$GITHUB_REPOSITORY_OWNER" "$1" > stuck.md
  gh pr comment "$n" --repo "$R" --body-file stuck.md >/dev/null
}

# 这个 PR 这个提交一共跑过几回检查：只数 pr-check.yml 这个文件的、同一个来源仓库 + 来源分支的（分页取全），
#   结论不论（成功了却没产物的也算），算上手动重跑。
# 设 attempts（跑过几回）、busy（几回还没跑完）、stale（1 = 触发这回的已经不是最新的：后面又跑过，或者这回被重跑过）
# 数不准（查询出错、数据不对、连触发这回的都没数到、哪一步算出错）就 return 1：调用的地方在 if 里，-e 管不到，每一步都自己查
count() {
  local newest mine
  [ -n "${RUN_HEAD_BRANCH:-}" ] && [ -n "${RUN_HEAD_REPO_ID:-}" ] || return 1
  GH_TOKEN="$READ_TOKEN" gh api --paginate "repos/$R/actions/workflows/pr-check.yml/runs?head_sha=$RUN_SHA&per_page=100" > runs-raw.json 2>/dev/null || return 1
  jq -r --arg b "$RUN_HEAD_BRANCH" --arg r "$RUN_HEAD_REPO_ID" '.workflow_runs[] | select(.head_branch == $b and .head_repository.node_id == $r) | "\(.id) \(.status) \(.conclusion // "none") \(.run_attempt)"' runs-raw.json > runs.txt 2>/dev/null || return 1
  if grep -qvE '^[0-9]+ [a-z_]+ [a-z_]+ [0-9]+$' runs.txt; then return 1; fi
  mine=$(awk -v id="$RUN_ID" '$1 == id { print $4; exit }' runs.txt) || return 1
  attempts=$(awk '$3 != "cancelled" && $3 != "skipped" { s += $4 } END { print s + 0 }' runs.txt) || return 1
  busy=$(awk '$2 != "completed" { c++ } END { print c + 0 }' runs.txt) || return 1
  # 别的回合被取消了的不算「后面又跑过」（同 latest-check.sh）
  newest=$(awk -v id="$RUN_ID" '$3 != "cancelled" || $1 == id' runs.txt | sort -n | tail -1 | cut -d' ' -f1) || return 1
  [[ "$mine" =~ ^[0-9]+$ && "$attempts" =~ ^[0-9]+$ && "$busy" =~ ^[0-9]+$ && "$newest" =~ ^[0-9]+$ ]] || return 1
  if [ "$newest" -gt "$RUN_ID" ] || [ "$mine" -gt "$RUN_ATTEMPT" ]; then stale=1; else stale=0; fi
}
