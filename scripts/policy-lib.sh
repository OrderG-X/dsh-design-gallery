# 违规记录、手动信任是哪一版（source 进来用；pr-gate 的 post、chatops 的 /approve）
# 要的变量：GH_TOKEN（App）、GITHUB_REPOSITORY
#
# policy_now：main 上 policy/strikes.json、policy/trust-overrides.json 现在的 blob sha，设 pol="<strikes> <trust>"（没有这个文件记 none）。
#   查不到（不是 404 的错）、版本号不对就返回 1（说明写到 stderr：在 $(...) 里调用也不会混进输出）
# policy_short：记在检查（external_id）里的短写法：两个各取前 12 位，用 / 连起来（none 照写）
policy_now() {
  local f s out=
  for f in strikes.json trust-overrides.json; do
    if s=$(gh api "repos/$GITHUB_REPOSITORY/contents/policy/$f?ref=main" --jq .sha 2> pol-err.txt); then :
    elif grep -q 'HTTP 404' pol-err.txt; then s=none
    else echo "查不到 main 上的 policy/$f" >&2; cat pol-err.txt >&2; return 1; fi
    [[ "$s" =~ ^([0-9a-f]{40}|none)$ ]] || { echo "policy/$f 的版本不对：$s" >&2; return 1; }
    out="$out${out:+ }$s"
  done
  pol="$out"
}

policy_short() {
  local a b
  read -r a b <<< "$1" || true
  [[ "$a" =~ ^([0-9a-f]{40}|none)$ && "$b" =~ ^([0-9a-f]{40}|none)$ ]] || return 1
  printf '%s/%s' "${a:0:12}" "${b:0:12}"
}
