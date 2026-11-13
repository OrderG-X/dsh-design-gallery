#!/usr/bin/env node
/**
 * issue 投稿第二步（拿着 App token 的 job，检出的是 main）：把第一步的产物当不可信数据读，
 * 核对后放进仓库的工作区，写好要回复投稿人的话。开 PR 由工作流做。
 *
 *   ISSUE_AUTHOR_LOGIN / ISSUE_AUTHOR_ID / ISSUE_NUMBER / ISSUE_URL 来自事件本身（可信），不用产物里的
 *   node scripts/intake-apply.mjs <产物目录> --reply reply.md
 *   GITHUB_OUTPUT：ok=true|false、dir=<目录>、branch=submission/<issue 号>
 */

import fs from 'node:fs'
import path from 'node:path'
import { checkPack, message } from 'dsh-design-studio/gallery'
import { ROOT, ID_RE, TYPE_DIRS, loadDir, loadVocab, readPolicyJson } from './lib/repo.mjs'
import { standing } from './gate.mjs'

const S = (v, n = 300) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>`|[\]]/g, ' ').replace(/@/g, '＠').slice(0, n) : '')

export function apply(art, { login, id, issue, issueUrl = '', root = ROOT }) {
  const reply = []
  const res = { ok: false, dir: '', branch: issue ? `submission/${issue}` : '' }
  let r = null
  try { r = JSON.parse(fs.readFileSync(path.join(art, 'intake.json'), 'utf8')) } catch { r = null }
  const lines = (xs) => (Array.isArray(xs) ? xs.slice(0, 30).map((x) => `- ${S(x && x.msg)}  \n  ${S(x && x.msgEn)}`) : [])
  if (!r || typeof r !== 'object') {
    reply.push('### ✗ 没处理成 / Could not process', '', '维护者会看一下。 / A maintainer will take a look.')
    return { ...res, reply: reply.join('\n') }
  }
  // 违规两次（main 上的 policy/strikes.json，按数字 id 认）：不再收
  if (standing({ login, id, strikes: readPolicyJson(path.join(root, 'policy', 'strikes.json'), []) }).strikes >= 2) {
    reply.push('### ✗ 这个账号不再收稿 / This account can no longer submit', '', '这个账号已经有两次违规记录（见 POLICY.md）。有疑问请开 issue 找维护者。 / This account has two strikes (see POLICY.md). Open an issue if you think this is a mistake.')
    return { ...res, reply: reply.join('\n') }
  }
  if (r.ok !== true) {
    reply.push('### ✗ 这次没收下 / Not accepted this time', '', ...lines(r.errors), '', '改好后编辑这个 issue、重新上传 zip，会自动重查。 / Fix the items above, edit this issue and re-upload the zip; it will be re-checked automatically.')
    return { ...res, reply: reply.join('\n') }
  }
  // 目录：类型目录 / 作者小写__名字；作者必须是 issue 作者本人
  const dir = String(r.dir || '')
  const [tdir, entry] = dir.split('/')
  const m = ID_RE.exec(entry || '')
  if (!TYPE_DIRS[tdir] || !m || m[1] !== String(login).toLowerCase() || dir.split('/').length !== 2) {
    reply.push('### ✗ 没处理成 / Could not process', '', '产物目录不对。维护者会看一下。 / Unexpected output folder. A maintainer will take a look.')
    return { ...res, reply: reply.join('\n') }
  }
  const src = path.join(art, 'files', tdir, entry)
  if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) {
    reply.push('### ✗ 没处理成 / Could not process', '', '产物里没有文件。 / No files in the output.')
    return { ...res, reply: reply.join('\n') }
  }
  // 这里再按 ci 规则查一遍（不信第一步），作者也要对得上
  const { files, problems } = loadDir(src)
  const chk = checkPack(files, { mode: 'ci', vocab: loadVocab(root) })
  let man = null
  try { man = JSON.parse(files.find((f) => f.path === 'design.json').data.toString('utf8')) } catch { man = null }
  const authorOk = man && man.author && String(man.author.login).toLowerCase() === String(login).toLowerCase() && man.author.id === id
  if (problems.length || !chk.ok || !authorOk) {
    const errs = [...problems, ...chk.errors].map((p) => ({ msg: message(p), msgEn: message(p, 'en') }))
    if (!authorOk) errs.push({ msg: 'design.json 的作者和 issue 作者对不上', msgEn: 'design.json author does not match the issue author' })
    reply.push('### ✗ 这次没收下 / Not accepted this time', '', ...lines(errs))
    return { ...res, reply: reply.join('\n') }
  }
  const dest = path.join(root, tdir, entry)
  // 已有的这套：数字 ID 要和原来的作者一样（用户名能被别人重新注册）
  let was = null
  try { was = JSON.parse(fs.readFileSync(path.join(dest, 'design.json'), 'utf8')) } catch { was = null }
  if (was && was.author && Number.isInteger(was.author.id) && was.author.id !== id) {
    reply.push('### ✗ 这次没收下 / Not accepted this time', '', '- 这个名字已经属于另一个 GitHub 账号（用户名一样但不是同一个账号）：换个短名再投，或找维护者迁移。  \n  This name already belongs to a different GitHub account (same login, different account): use another short name or ask a maintainer to migrate it.')
    return { ...res, reply: reply.join('\n') }
  }
  fs.rmSync(dest, { recursive: true, force: true }) // 同一作者更新自己的那套：整套换掉
  for (const f of files) {
    const p = path.join(dest, f.path)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, f.data)
  }
  reply.push('### ✓ 收到了，已转成 PR / Received and turned into a pull request', '')
  if (typeof man.shareHash === 'string' && /^[0-9a-f]{32}$/.test(man.shareHash)) reply.push(`投稿记号 / Ref: \`${man.shareHash.slice(0, 12)}\``, '')
  if (Array.isArray(r.changes) && r.changes.length) {
    reply.push('自动修了这些 / Fixed automatically:', ...r.changes.slice(0, 20).map((c) => `- ${S(c, 200)}`), '')
  }
  if (Array.isArray(r.flags) && r.flags.length) reply.push('这些要维护者看一眼 / A maintainer will check these:', ...lines(r.flags), '')
  reply.push('接下来会自动截图、体检，结果贴在 PR 里。 / Screenshots and checks will run next; results will be posted on the PR.')
  return { ok: true, dir, branch: res.branch, reply: reply.join('\n'), title: (man.title && (man.title.zh || man.title.en)) || entry, issueUrl }
}

function main() {
  const art = process.argv[2]
  const ri = process.argv.indexOf('--reply')
  const out = ri > 0 ? process.argv[ri + 1] : 'reply.md'
  const login = process.env.ISSUE_AUTHOR_LOGIN || ''
  const id = Number(process.env.ISSUE_AUTHOR_ID || 0)
  const issue = Number(process.env.ISSUE_NUMBER || 0)
  const r = apply(art, { login, id, issue, issueUrl: process.env.ISSUE_URL || '' })
  fs.writeFileSync(out, r.reply + '\n')
  const title = String(r.title || '').replace(/[\r\n]/g, ' ').slice(0, 60)
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${r.ok}\ndir=${r.dir}\nbranch=${r.branch}\ntitle=${title}\n`)
  console.log(r.ok ? `ok ${r.dir}` : 'not ok')
}

if (import.meta.url === `file://${process.argv[1]}`) main()
