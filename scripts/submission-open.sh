#!/bin/bash
# 机器人替网页投稿开的 PR：投稿的 issue 还开着、没被拒才合（维护者 /reject 了——关了、或者打了 rejected 标签——作者自己关了，就不合）。
#   /reject 和开 PR 的工作流各自会把对方漏下的 PR 关掉，这里是合并前最后一道：不靠那两边一定成功
# 用法：bash scripts/submission-open.sh <PR 的 JSON 文件（GET pulls/<号>）>
# 环境变量：GH_TOKEN、GITHUB_REPOSITORY、APP_SLUG
# 退出码：0 不是机器人代开的、或者 issue 开着没被拒；3 issue 关了或被拒了；1 说不准（读不出投稿 issue、查不到）
set -euo pipefail
f=$1
: "${APP_SLUG:?要 APP_SLUG}"
# 作者读不出来（缺字段、空的）不能当成「不是机器人代开的」
login=$(jq -r 'if (.user.login | type) == "string" and .user.login != "" then .user.login else error("bad") end' "$f" 2>/dev/null) || { echo "PR 读不出作者"; exit 1; }
[ "$login" = "${APP_SLUG}[bot]" ] || exit 0
pre="Submission: https://github.com/$GITHUB_REPOSITORY/issues/"
iss=$(jq -r --arg pre "$pre" '[(.body // "") | split("\n")[] | sub("\r$"; "") | select(startswith($pre)) | ltrimstr($pre)][0] // ""' "$f") || { echo "PR 读不出来"; exit 1; }
[[ "$iss" =~ ^[1-9][0-9]*$ ]] || { echo "机器人代开的 PR 里读不出投稿的 issue"; exit 1; }
st=$(gh api "repos/$GITHUB_REPOSITORY/issues/$iss" --jq '"\(.state) \([.labels[]?.name] | any(. == "rejected"))"' 2>/dev/null) || { echo "查不到投稿的 issue #$iss"; exit 1; }
case "$st" in
  "open false") exit 0 ;;
  "open true") echo "投稿的 issue #$iss 被拒了（rejected）"; exit 3 ;;
  "closed "*) echo "投稿的 issue #$iss 已经关了"; exit 3 ;;
  *) echo "投稿的 issue #$iss 状态不对：$st"; exit 1 ;;
esac
