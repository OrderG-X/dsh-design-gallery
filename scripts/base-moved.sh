#!/bin/bash
# 闸门算完以后 main 有没有动过会影响结论的地方：
#   - 任何设计目录（templates/ systems/ styles/）：同名的设计（同类型或别的类型）、同一套被别的 PR 改过、内容一样的别的设计合进来了……
#     闸门当时没看到，合进去的就不是查过的样子（比如两个 PR 往同一套各加 35 个文件，各自没超 60 个，合起来超了）
#   - 检查用的规则和代码（scripts/ vocab/ schema/ 依赖、工作流）：按新规矩可能就不过了
# 动过就让检查按 main 现在的样子重算（合并的那一刻只有一种样子：闸门算的 main + 这个 PR，闸门那边已经核过 PR 的目录和合并出来的一样）
# 用法：bash scripts/base-moved.sh <闸门算的那版 main（40 位或至少 12 位缩写）>
#   要在检出了 main（完整历史）的目录里跑。比的是 GitHub 上「现在」的 main：先 git fetch origin main（job 检出以后可能又有人推了），
#   不是检出时的 HEAD。到真正合并之间还有几秒——那一瞬间维护者直接往 main 推设计 / 规则的，挡不住（合并的队里只有合并）
# 退出码：0 没动；3 动了（该重算）；1 说不准（base 不对 / 不在 main 的历史里……）
set -euo pipefail
base=${1:-}
[[ "$base" =~ ^[0-9a-f]{12,40}$ ]] || { echo "闸门算的那版 main 不对：$base"; exit 1; }
git fetch -q --no-tags origin main 2>/dev/null || { echo "取不到 GitHub 上现在的 main"; exit 1; }
now=$(git rev-parse -q --verify 'FETCH_HEAD^{commit}') || { echo "取不到 GitHub 上现在的 main"; exit 1; }
full=$(git rev-parse -q --verify "$base^{commit}") || { echo "历史里找不到 $base"; exit 1; }
git merge-base --is-ancestor "$full" "$now" || { echo "$base 不在 main 的历史里"; exit 1; }
paths=(templates systems styles scripts vocab schema package.json package-lock.json .github)
rc=0; git --literal-pathspecs diff --quiet "$full" "$now" -- "${paths[@]}" || rc=$?
case "$rc" in 0) exit 0 ;; 1) ;; *) echo "比不出来（git diff 出错）"; exit 1 ;; esac
echo "闸门算完以后 main 上这些地方变了：$(git --literal-pathspecs diff --name-only "$full" "$now" -- "${paths[@]}" | cut -d/ -f1-2 | sort -u | head -20 | tr '\n' ' ')"
exit 3
