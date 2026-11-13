#!/bin/bash
# 这个投稿 PR 被关过、重开过没有（关了又重开，事件记录还在；见 closed-by.sh）。谁关的都算：作者先自己关了、维护者再 /reject 时机器人不会再关一次，
#   拒稿的标签又可能没打上——只认「作者自己关的不算」就会漏掉这种被拒过的。
#   机器人替网页投稿开的 PR：投稿的 issue 被关过也算（作者重开 issue 再改，会开出新号的 PR，旧 PR 的记录带不过来）。
# 用法：bash scripts/was-closed.sh <PR 的 JSON 文件（GET pulls/<号>）> [从什么时候起（ISO 时间，同一秒的也算）]
# 退出码：0 关过；3 没关过；1 查不到（记录、时间读不出来；机器人代开的读不出投稿 issue）
# 环境变量：GH_TOKEN、GITHUB_REPOSITORY、APP_SLUG
set -euo pipefail
f=$1
since=${2:-}
: "${APP_SLUG:?要 APP_SLUG}"
n=$(jq -r '.number // ""' "$f" 2>/dev/null) || exit 1
[[ "$n" =~ ^[1-9][0-9]*$ ]] || exit 1
rc=0; bash scripts/closed-by.sh "$n" "" "$since" || rc=$?
[ "$rc" = 3 ] || exit "$rc"
# 作者读不出来（缺字段、空的）不能当成「不是机器人代开的」
login=$(jq -r 'if (.user.login | type) == "string" and .user.login != "" then .user.login else error("bad") end' "$f" 2>/dev/null) || exit 1
[ "$login" = "${APP_SLUG}[bot]" ] || exit 3
pre="Submission: https://github.com/$GITHUB_REPOSITORY/issues/"
iss=$(jq -r --arg pre "$pre" '[(.body // "") | split("\n")[] | sub("\r$"; "") | select(startswith($pre)) | ltrimstr($pre)][0] // ""' "$f" 2>/dev/null) || exit 1
[[ "$iss" =~ ^[1-9][0-9]*$ ]] || exit 1
rc=0; bash scripts/closed-by.sh "$iss" "" "$since" || rc=$?
exit "$rc"
