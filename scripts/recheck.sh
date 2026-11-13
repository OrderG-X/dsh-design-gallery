#!/bin/bash
# 让某个投稿 PR 的 pr-check 重跑：把 PR 转成草稿、再标回「可以审了」（ready_for_review 会触发 pr-check，闸门跟着重算）。
#   - 机器人（App）没有 Actions 权限，不能直接点重跑；
#   - 也不用「关了再开」：和维护者 /reject 撞上时会把刚拒掉的 PR 又打开。标草稿再标回，PR 被关了也不会被打开。
# 用法：bash scripts/recheck.sh <PR 号> <提交 sha> [还得带着的标签（正则）]
#   动手前再查一遍：开着、不是草稿（作者自己的草稿不替他改）、head 还是这个提交；
#   给了第三个参数（定时复查挂起的）：还得带着那个标签，而且维护者没 /hold（held: maintainer）
# 环境变量：GH_TOKEN（App）、GITHUB_REPOSITORY、GITHUB_REPOSITORY_OWNER、APP_SLUG（认机器人自己发的提醒）
#   DRAFT_RC：因为是草稿（作者自己的）没重跑时的退出码，默认 0。要这回检查一定得有结论的（闸门写结果时发现规矩变了）给 4：
#   草稿重跑不了，调用的一方据此转去写「没跑完」
set -euo pipefail
draft_rc=${DRAFT_RC:-0}
n=$1
sha=$2
need=${3:-}
R="$GITHUB_REPOSITORY"
: "${APP_SLUG:?要 APP_SLUG}"
# 看 PR 现在的样子：state、draft、head 都得读得出来（读不出来就算查不到，不能当成「关了」「不是草稿」）
#   查到了设 pr_state、pr_draft、pr_head（文件留着取标签、node_id）；被关了就不用再管；查不到返回 1
look() {
  local s
  gh api "repos/$R/pulls/$n" > recheck-now.json 2>/dev/null || return 1
  s=$(jq -r 'if (.state | type) == "string" and (.draft | type) == "boolean" and (.head.sha | type) == "string" then "\(.state) \(.draft) \(.head.sha)" else error("bad") end' recheck-now.json 2>/dev/null) || return 1
  read -r pr_state pr_draft pr_head <<< "$s" || return 1
  [ "$pr_state" = open ] || { echo "#$n 被关了，不用管"; exit 0; }
}
# @ 维护者（同一个 PR 24 小时内只 @ 一次这种「重跑没成」：定时任务每 6 小时会再来一遍，不刷屏）
stuck() {
  local since pinged
  since=$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)
  pinged=$(gh api "repos/$R/issues/$n/comments" --paginate --jq ".[] | select(.user.login == \"${APP_SLUG}[bot]\" and (.body | startswith(\"<!-- dsh-gallery-stuck -->\")) and .created_at >= \"$since\") | .id" 2>/dev/null | tail -1 || true)
  if [ -n "$pinged" ]; then echo "#$n 24 小时内提醒过了，不再 @"; return 0; fi
  printf '<!-- dsh-gallery-stuck -->\n@%s %s\n' "$GITHUB_REPOSITORY_OWNER" "$1" > recheck-stuck.md
  gh pr comment "$n" --repo "$R" --body-file recheck-stuck.md >/dev/null || true
}
# 查 PR 现在的样子，查不到多试两回（GitHub 偶尔报错）；还是查不到：请维护者看一下，这步失败
#   （调用的一方可能已经在卡上说了会自动重跑：不能悄悄断掉）
look_or_stuck() {
  local i
  for i in 1 2 3; do
    if look; then return 0; fi
    [ "$i" = 3 ] || sleep 5
  done
  echo "#$n 查不到这个 PR"
  stuck '机器人要重跑这个投稿的检查，却一直查不到这个 PR（GitHub 报错），没能重跑，麻烦看一下、需要的话在 Actions 里手动重跑 pr-check。 / The bot wanted to re-run the checks for this submission but kept failing to read the PR (GitHub errors), so they were not re-run; please take a look and re-run pr-check from Actions if needed.'
  exit 1
}
look_or_stuck
[ "$pr_draft" = false ] || { echo "#$n 是草稿，不动"; exit "$draft_rc"; }
[ "$pr_head" = "$sha" ] || { echo "#$n 已经有新提交，不动"; exit 0; }
if [ -n "$need" ]; then
  jq -r '.labels[].name' recheck-now.json > recheck-labels.txt
  if grep -qx 'held: maintainer' recheck-labels.txt; then echo "#$n 维护者挂起了，不动"; exit 0; fi
  grep -qE "$need" recheck-labels.txt || { echo "#$n 标签变了，不动"; exit 0; }
fi
id=$(jq -r '.node_id // ""' recheck-now.json)
[ -n "$id" ] || { echo "#$n 读不出 node_id"; exit 1; }
draft='mutation($id: ID!) { convertPullRequestToDraft(input: {pullRequestId: $id}) { pullRequest { isDraft } } }'
ready='mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }'
# 和 main 有没有冲突：mergeable 还没算出来（null）就等一会儿再查（GitHub 在后台算，最多等约 1 分钟）；还是不知道就请维护者看、这步失败。
#   有冲突（false）：pull_request 的工作流根本不会跑，转草稿再标回也没用——告诉作者先把 main 合进来、解决冲突再推
#   （推上来检查自己会跑；有冲突也合并不了）。同一个提交只说一次；说不出去这步失败
m=$(jq -r '.mergeable' recheck-now.json)
for i in 1 2 3 4 5 6; do
  [ "$m" = null ] || break
  sleep 10
  look_or_stuck
  [ "$pr_draft" = false ] || { echo "#$n 是草稿，不动"; exit "$draft_rc"; }
  [ "$pr_head" = "$sha" ] || { echo "#$n 已经有新提交，不动"; exit 0; }
  m=$(jq -r '.mergeable' recheck-now.json)
done
if [ "$m" = null ]; then
  stuck '机器人要重跑这个投稿的检查，但 GitHub 一直算不出它和 main 有没有冲突，没敢动，麻烦看一下：有冲突请作者先解决；没有就在 Actions 里手动重跑 pr-check。 / The bot wanted to re-run the checks, but GitHub could not tell whether this PR conflicts with main, so it left it alone; please take a look: ask the author to resolve conflicts if there are any, otherwise re-run pr-check from Actions.'
  exit 1
fi
if [ "$m" = false ]; then
  said=$(gh api "repos/$R/issues/$n/comments" --paginate --jq ".[] | select(.user.login == \"${APP_SLUG}[bot]\" and (.body | startswith(\"<!-- dsh-gallery-conflict $sha -->\"))) | .id" 2>/dev/null | tail -1) || { echo "#$n 查不到说没说过冲突"; exit 1; }
  if [ -z "$said" ]; then
    printf '<!-- dsh-gallery-conflict %s -->\n%s\n' "$sha" '这个 PR 和 main 有冲突，检查跑不了：请先把最新的 main 合进来（或 rebase）、解决冲突再推送，检查会自动重跑。 / This PR conflicts with main, so the checks cannot run: please merge the latest main (or rebase), resolve the conflicts and push; the checks will re-run automatically.' > recheck-conflict.md
    gh pr comment "$n" --repo "$R" --body-file recheck-conflict.md >/dev/null || { echo "#$n 冲突的说明发不出去"; exit 1; }
  fi
  echo "#$n 和 main 有冲突，检查跑不了，等作者解决"
  exit 0
fi
# 现在的草稿是谁转的：看时间线最后一次「转草稿 / 标回」（按接口给的先后）。设 who：bot 机器人自己、other 别人（作者、维护者自己转的，
#   不替他标回）、none 不是草稿；查不到（或时间线和 PR 对不上：是草稿、最后一条却不是转草稿）返回 1
whodraft() {
  local ev
  who=
  look || return 1
  if [ "$pr_draft" != true ]; then who=none; return 0; fi
  gh api --paginate "repos/$R/issues/$n/timeline?per_page=100" --jq '.[] | select(.event == "convert_to_draft" or .event == "ready_for_review") | "\(.event) \(.actor.login // "-")"' > recheck-tl.txt 2>/dev/null || return 1
  ev=$(tail -1 recheck-tl.txt)
  case "$ev" in
    "convert_to_draft ${APP_SLUG}[bot]") who=bot ;;
    "convert_to_draft "*) who=other ;;
    *) return 1 ;;
  esac
}
# 1. 转草稿。报错不一定没生效（响应丢了）：查实际的样子——是机器人转成的草稿就往下走（不管提交变没变，都得标回去）；
#    是别人（作者）这几秒里自己转的草稿：不替他标回，他标回时检查自己会重跑；没成、又有了新提交就不用管了（新提交自己会重跑检查）；没成就再试。
#    最后一回查不到（不知道转没转成、是谁转的）：不去标回（可能是作者自己的草稿），请维护者看一眼；
#    真是机器人转的，定时任务半小时后也会替它标回
# 任务被取消（超时、手动取消）：走之前查一下现在的草稿是谁的，确定是机器人转的才标回去（转草稿的请求发出去以前就挂上：发出去就可能已经生效）；
#   不看「之前转成没转成」：可能已经标回过、作者又自己转了草稿。查不到就不动。
# 收不到信号的情况（机器直接没了）、取消时查不到的由定时任务兜底：机器人转的草稿半小时后还没标回就替它标回
drafted=; unsure=; who=
trap 'echo "被取消了，看 #$n 是不是机器人转的草稿，是就标回去"; if whodraft && [ "$who" = bot ]; then gh api graphql -f query="$ready" -f id="$id" >/dev/null 2>&1 || true; fi; exit 1' INT TERM
for i in 1 2 3; do
  if gh api graphql -f query="$draft" -f id="$id" >/dev/null; then drafted=1; break; fi
  echo "#$n 转草稿报错了，查一下实际的样子"
  sleep 5
  if ! whodraft; then unsure=1; continue; fi
  unsure=
  case "$who" in
    bot) drafted=1; break ;;
    other) echo "#$n 是别人自己转的草稿，不替他标回（他标回时检查会重跑）"; exit "$draft_rc" ;;
  esac
  [ "$pr_head" = "$sha" ] || { echo "#$n 有新提交了（检查会自己重跑），不用管"; exit 0; }
done
if [ -z "$drafted" ]; then
  if [ -n "$unsure" ]; then
    stuck '机器人重跑这个投稿的检查时，查不到 PR 有没有转成草稿（GitHub 一直报错），没敢动它，麻烦看一下：PR 是草稿就点 Ready for review；不是草稿、检查也没在重跑，就在 Actions 里手动重跑 pr-check。 / The bot could not tell whether this PR was turned into a draft (GitHub kept failing), so it left it alone; please take a look: click "Ready for review" if the PR is a draft, otherwise re-run pr-check from Actions if it is not running.'
  else
    stuck '机器人没能让这个投稿的检查重跑（转草稿没成功），麻烦在 Actions 里手动重跑 pr-check。 / The bot could not re-run the checks for this submission (converting it to a draft failed); please re-run pr-check from Actions.'
  fi
  exit 1
fi
# 2. 标回「可以审了」（这一下触发检查重跑）。报错就查现在的草稿是谁的：已经不是草稿了（其实标回了，响应丢了）就算成；
#    是作者（别人）的草稿（其实标回了、作者又自己转了）：不替他标回；还是机器人的草稿、或者查不到：接着试
for i in 1 2 3; do
  if gh api graphql -f query="$ready" -f id="$id" >/dev/null; then echo "#$n 已重新标成可以审了，检查会重跑"; exit 0; fi
  sleep 5
  if whodraft; then
    case "$who" in
      none) echo "#$n 已经不是草稿了，检查会重跑"; exit 0 ;;
      other) echo "#$n 现在是别人自己转的草稿，不替他标回（他标回时检查会重跑）"; exit 0 ;;
    esac
  fi
done
# 还是草稿（或者查不到）：请维护者手动标回（草稿不能合并），这一步也算失败
stuck '机器人为了重跑检查把这个 PR 转成了草稿，却没能标回「可以审了」，麻烦点一下 Ready for review。 / The bot turned this PR into a draft to re-run its checks but could not mark it ready again; please click "Ready for review".'
exit 1
