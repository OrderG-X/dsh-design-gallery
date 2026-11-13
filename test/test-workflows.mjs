// 工作流里「检查没跑完」「挂起复查」「装字体重试」这几步：抽出 run 脚本，用假的 gh / apt-get 真跑一遍
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REAL = path.resolve(HERE, '..')
const { heldReady, LIMIT } = await import('../scripts/gate.mjs')
const HAS_JQ = (() => { try { execFileSync('jq', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()
const SKIP = (process.platform === 'win32' || !HAS_JQ) && '要 bash + jq'

/** 工作流里某一步的 run: | 脚本（去掉缩进） */
function stepScript(file, name) {
  const lines = fs.readFileSync(path.join(REAL, '.github/workflows', file), 'utf8').split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  const r = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l))
  assert.ok(at >= 0 && r > at, `${file} 里没找到「${name}」的 run`)
  const ind = lines[r].search(/\S/)
  const body = []
  for (const l of lines.slice(r + 1)) { if (l.trim() && l.search(/\S/) <= ind) break; body.push(l) }
  const cut = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
  return body.map((l) => l.slice(cut)).join('\n')
}

// 假 gh：按「方法 路径」（gh api）或「命令 子命令」（gh pr view…）查 FIX 里的回应（正则，取能对上的里最长的——要盖掉默认回应，键要写得比默认的长），带 --jq 就真用 jq 过一遍；每次调用记进 GH_LOG
//   回应：{ body } / { code, stderr? } / { bodies: [...], codes: [...] }（按第几次调用取）/ { pages: [...] }（分页：带 --paginate 才给全，不带只给第一页）
//   没写回应的请求（API 和 gh pr / gh issue 一样）一律报错（写错路径、命令不会被当成成功）；GraphQL 的 mutation 和变量对不上也报错
//   pr-check 的运行记录没写来源的，默认是 #7 的来源（o/r 的 submission/7）；要测别的来源就写明 head_branch / head_repository
const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs'), cp = require('child_process')
const a = process.argv.slice(2)
const fix = JSON.parse(fs.readFileSync(process.env.FAKE_FIX, 'utf8'))
const rec = { args: a, token: process.env.GH_TOKEN || '' }
const api = a[0] === 'api'
let method = '', p = '', jq = '', paginate = false, fields = [], bad = false
for (let i = 1; i < a.length; i++) {
  const x = a[i]
  if (x === '--jq') jq = a[++i]
  else if (x === '--paginate') paginate = true
  else if (x === '--body-file') rec.file = fs.readFileSync(a[++i], 'utf8')
  else if (!api) continue
  else if (x === '-X') method = a[++i]
  else if (x === '-f' || x === '-F') { const v = a[++i]; fields.push(v); if (v.includes('=@')) rec.file = fs.readFileSync(v.split('=@')[1], 'utf8') }
  else if (x === '--input') ++i
  else if (x.startsWith('-')) {}
  else if (!p) p = x
}
if (api) {
  if (!method) method = fields.length ? 'POST' : 'GET'
  rec.route = method + ' ' + p
  if (p === 'graphql') {
    const q = (fields.find((f) => f.startsWith('query=')) || '').slice(6)
    const m = /^mutation\\(\\$id: ID!\\) \\{ (convertPullRequestToDraft|markPullRequestReadyForReview)\\(input: \\{pullRequestId: \\$id\\}\\)/.exec(q)
    rec.route = 'graphql:' + (m ? m[1] : '?')
    if (!m || !fields.some((f) => /^id=PR_\\d+$/.test(f))) bad = true
  }
} else rec.route = a.slice(0, 2).join(' ')
rec.fields = fields
const hit = Object.keys(fix).filter((k) => k !== '__n' && new RegExp(k).test(rec.route)).sort((x, y) => y.length - x.length)[0]
const r = hit ? fix[hit] : { code: 1 }
let k = 0
if (hit && (Array.isArray(r.codes) || Array.isArray(r.bodies))) { const c = (fix.__n = fix.__n || {}); c[hit] = (c[hit] || 0) + 1; k = c[hit]; fs.writeFileSync(process.env.FAKE_FIX, JSON.stringify(fix)) }
let code = bad ? 1 : Array.isArray(r.codes) ? r.codes[Math.min(k, r.codes.length) - 1] : r.code || 0
const b = Array.isArray(r.bodies) ? r.bodies[Math.min(k, r.bodies.length) - 1] : r.body
let pages = r.pages ? (paginate ? r.pages : r.pages.slice(0, 1)) : [b === undefined ? {} : b]
if (rec.route.includes('/actions/workflows/pr-check.yml/runs')) pages = pages.map((pg) => pg && Array.isArray(pg.workflow_runs) ? { ...pg, workflow_runs: pg.workflow_runs.map((x) => x && typeof x === 'object' ? { head_branch: 'submission/7', head_repository: { full_name: 'o/r', node_id: 'R_o' }, ...x } : x) } : pg)
let out = ''
// 出错的请求（像真的 gh 一样）不出内容；jq 过不去也算出错
if (code) out = ''
else if (jq) { try { out = pages.map((pg) => cp.execFileSync('jq', ['-r', jq], { input: JSON.stringify(pg), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })).join('') } catch { out = ''; code = 1 } }
else if (api) out = pages.map((pg) => JSON.stringify(pg) + '\\n').join('')
rec.code = code
if (code && r.stderr) process.stderr.write(r.stderr)
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(rec) + '\\n')
process.stdout.write(out)
process.exit(code)
`
// 假 date（macOS 没有 GNU date -d）：认 -u、-d '<N> minutes|hours|days ago' / ISO 时间、+%s、+%Y-%m-%dT%H:%M:%SZ
const FAKE_DATE = `#!/usr/bin/env node
const a = process.argv.slice(2); let t = Date.now(), fmt = ''
for (let i = 0; i < a.length; i++) {
  if (a[i] === '-d') { const s = a[++i]; const m = /^(\\d+) (minutes|hours|days) ago$/.exec(s); t = m ? Date.now() - m[1] * { minutes: 60e3, hours: 3600e3, days: 86400e3 }[m[2]] : Date.parse(s) }
  else if (a[i].startsWith('+')) fmt = a[i].slice(1)
}
const d = new Date(t)
process.stdout.write((fmt === '%s' ? String(Math.floor(t / 1000)) : d.toISOString().replace(/\\.\\d{3}Z$/, 'Z')) + '\\n')
`

function sandbox(extra = {}) {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-wf-'))
  const bin = path.join(w, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'date'), FAKE_DATE, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/bash\necho "$*" >> "$SLEEP_LOG"\n', { mode: 0o755 })
  for (const [n, body] of Object.entries(extra)) fs.writeFileSync(path.join(bin, n), body, { mode: 0o755 })
  return { w, bin }
}

/** 一个假环境（假 gh / date / sleep、脚本、回应、调用记录）；几步接着跑时共用一个（回应的「第几次调用」接着数） */
function newBox({ fix, cwd, extra, scripts = {} } = {}) {
  const { w, bin } = sandbox(extra)
  const dir = cwd || w
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  for (const f of ['recheck.sh', 'gate.mjs', 'latest-check.sh', 'incomplete-lib.sh', 'policy-lib.sh', 'base-moved.sh', 'submission-open.sh', 'closed-by.sh', 'was-closed.sh', 'chatops.mjs', 'lib/repo.mjs']) fs.copyFileSync(path.join(REAL, 'scripts', f), path.join(dir, 'scripts', f))
  for (const [f, body] of Object.entries(scripts)) fs.writeFileSync(path.join(dir, 'scripts', f), body)
  const fixFile = path.join(w, 'fix.json')
  fs.writeFileSync(fixFile, JSON.stringify(fix || {}))
  const log = path.join(w, 'gh.log')
  const sleepLog = path.join(w, 'sleep.log')
  fs.writeFileSync(log, '')
  fs.writeFileSync(sleepLog, '')
  return { w, bin, dir, fixFile, log, sleepLog }
}

function runStep(file, name, { fix, env = {}, cwd, extra, scripts = {}, box, sub = {} } = {}) {
  const b = box || newBox({ fix, cwd, extra, scripts })
  // sub：把脚本里的 ${{ … }} 换成测试里的值（照原样替换）
  const script = Object.entries(sub).reduce((t, [x, y]) => t.split(x).join(y), stepScript(file, name))
  const r = spawnSync('bash', ['-e', '-c', script], {
    cwd: b.dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${b.bin}:${process.env.PATH}`, FAKE_FIX: b.fixFile, GH_LOG: b.log, SLEEP_LOG: b.sleepLog, GITHUB_REPOSITORY: 'o/r', GITHUB_REPOSITORY_OWNER: 'o', ...env },
  })
  const calls = fs.readFileSync(b.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const sleeps = fs.readFileSync(b.sleepLog, 'utf8').split('\n').filter(Boolean)
  return { code: r.status, out: r.stdout + r.stderr, calls, sleeps, w: b.w, box: b }
}

// ───────── 挂起放行的条件 ─────────

test('挂起放行：和闸门一样——账号满 7 天（或 /trust 过）而且数量在上限以内才放', () => {
  const now = Date.parse('2026-11-12T00:00:00Z')
  assert.equal(heldReady({ createdAt: '2026-11-04T00:00:00Z', now }), true)
  assert.equal(heldReady({ createdAt: '2026-11-06T00:00:00Z', now }), false)
  assert.equal(heldReady({ createdAt: '', now }), false) // 查不到注册时间不放
  assert.equal(heldReady({ createdAt: '2026-11-11T00:00:00Z', override: 'T2', now }), true)
  assert.equal(heldReady({ createdAt: '2026-11-01T00:00:00Z', pending: LIMIT.pending, today: LIMIT.daily, now }), true)
  assert.equal(heldReady({ createdAt: '2026-11-01T00:00:00Z', pending: LIMIT.pending + 1, now }), false) // 账号够了但数量还超：闸门会挂成 limit
  assert.equal(heldReady({ createdAt: '2026-11-01T00:00:00Z', today: LIMIT.daily + 1, now }), false)
})

// ───────── 检查没跑完 ─────────

const SHA = 'a'.repeat(40)
// main 上违规记录 / 手动信任的版本（contents API 的 blob sha）：默认 strikes.json 是 1111…、trust-overrides.json 没有（404）；记在检查 external_id 里的短写法是 PS
const POL = `${'1'.repeat(40)} none`
const PS = `${'1'.repeat(12)}/none`
const POLICY_FIX = {
  '^GET repos/o/r/contents/policy/strikes.json': { body: { sha: '1'.repeat(40) } },
  '^GET repos/o/r/contents/policy/trust-overrides.json': { code: 1, stderr: 'gh: Not Found (HTTP 404)\n' },
}
// 闸门算的那版 main（base）：一个小 git 仓库，要用的测试把它复制到工作目录（HEAD 就是「现在的 main」，默认和 base 一样）；
//   检查 external_id 里记的是前 12 位 B12
const gitIn = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
const BASE_REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-base-'))
gitIn(BASE_REPO, 'init', '-q', '-b', 'main')
fs.mkdirSync(path.join(BASE_REPO, 'styles/bob__xyz'), { recursive: true })
fs.writeFileSync(path.join(BASE_REPO, 'styles/bob__xyz/style.json'), '{}\n')
gitIn(BASE_REPO, 'add', '.')
gitIn(BASE_REPO, 'commit', '-qm', 'base')
const BASE = gitIn(BASE_REPO, 'rev-parse', 'HEAD')
const B12 = BASE.slice(0, 12)
// 合并前会取一次「GitHub 上现在的 main」（git fetch origin main）：测试里 origin 就是它自己
const withBase = (cwd) => { fs.cpSync(BASE_REPO, cwd, { recursive: true }); gitIn(cwd, 'remote', 'add', 'origin', cwd); return cwd }
/** 在工作目录的「main」上再提交一个文件（模拟闸门算完以后 main 又变了） */
const mainAdds = (cwd, file) => { fs.mkdirSync(path.join(cwd, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(cwd, file), '{}\n'); gitIn(cwd, 'add', file); gitIn(cwd, 'commit', '-qm', `add ${file}`) }

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400e3).toISOString().replace(/\.\d{3}Z$/, 'Z')
const pr = (over = {}) => ({ number: 7, node_id: 'PR_7', state: 'open', draft: false, mergeable: true, labels: [], head: { sha: SHA, ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } }, base: { ref: 'main' }, user: { login: 'alice', id: 5 }, ...over })
// 这个提交跑过的 pr-check：第一条是触发这次闸门的那回（id 100），后面的默认是更早的（id 99、98…），要更新的就写明 id
const runsOf = (...list) => ({ body: { workflow_runs: list.map(([conclusion, run_attempt = 1, status = 'completed', id], i) => ({ id: id ?? 100 - i, status, conclusion, run_attempt })) } })
const baseFix = (over = {}) => ({
  '^GET repos/o/r/pulls/7$': { body: pr() },
  '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['failure']),
  '^POST repos/o/r/check-runs$': { body: {} },
  '^GET repos/o/r/issues/7/comments$': { body: [] },
  '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [{ name: 'checks: pass' }, { name: 'lane: B' }, { name: 'held: author' }] },
  '^DELETE repos/o/r/issues/7/labels/': { body: {} },
  '^POST repos/o/r/issues/7/labels$': { body: [] },
  '^PATCH repos/o/r/issues/comments/\\d+$': { body: {} },
  '^graphql:': { body: { data: {} } },
  '^GET repos/o/r/issues/7/timeline': { body: [{ event: 'convert_to_draft', actor: { login: 'bot[bot]' } }] },
  // 事件记录（有没有被关过）：默认没关过
  '^GET repos/o/r/issues/7/events': { body: [] },
  // 评论里的 /hold、/reject（/approve 核对时看）：默认没有；机器人点的 👀：默认没有
  '^GET repos/o/r/issues/7/comments\\?per_page=100$': { body: [] },
  '^GET repos/o/r/issues/comments/\\d+/reactions': { body: [] },
  '^pr comment$': {},
  ...over,
})
const incEnv = (over = {}) => ({ GH_TOKEN: 'app', READ_TOKEN: 'read', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: '1', RUN_CONCLUSION: 'failure', RUN_PRS: '[{"number":7,"base":{"ref":"main"}}]', RUN_HEAD_REPO_ID: 'R_o', RUN_HEAD_BRANCH: 'submission/7', APP_SLUG: 'bot', GITHUB_REPOSITORY_OWNER: 'OrderG-X', WAIT: '300', MAX: '3', ...over })
// 「检查没跑完」分三个 job：找 PR → 贴卡（排 PR 的队）→ 等一会儿再重跑；像 Actions 一样接着跑，上一步的输出给下一步
const INC = ['检查没跑完：找是哪个 PR', '检查没跑完：贴卡、说多久以后重跑', '检查没跑完：等一会儿让检查重跑']
function runInc({ fix, env = {}, extra } = {}) {
  const box = newBox({ fix, extra })
  let r, text = '', k = 0
  const go = (name, more = {}) => {
    const o = path.join(box.w, `out-${k++}`)
    fs.writeFileSync(o, '')
    r = runStep('pr-gate.yml', name, { box, env: { ...env, ...more, GITHUB_OUTPUT: o } })
    text += r.out
    return Object.fromEntries(fs.readFileSync(o, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  }
  const a = go(INC[0])
  const codes = [r.code]
  if (r.code === 0 && a.number) {
    const b = go(INC[1], { N: a.number })
    codes.push(r.code)
    // 和工作流一样：上一段定下了要重跑（wait）就跑，不管它后面贴卡、写检查成没成
    if (b.wait) { go(INC[2], { N: a.number, WAIT_S: b.wait, BEFORE: b.attempts }); codes.push(r.code) }
  }
  return { ...r, out: text, codes }
}
const acts = (r) => r.calls.filter((c) => c.args[0] === 'pr' || c.route.startsWith('graphql:')).map((c) => (c.args[0] === 'pr' ? c.args[1] : c.route.slice(8)))
const RERUN = ['convertPullRequestToDraft', 'markPullRequestReadyForReview']

test('检查没跑完：第一回——贴卡（中英文、说不是投稿的问题）、写失败的 Submission gate、换标签、等 5 分钟转草稿再标回', { skip: SKIP }, () => {
  const labels = { body: [{ name: 'checks: pass' }, { name: 'lane: B' }, { name: 'held: maintainer' }, { name: 'held: author' }] }
  const r = runInc({ fix: baseFix({ '^GET repos/o/r/issues/7/labels\\?per_page=100$': labels }), env: incEnv() })
  assert.equal(r.code, 0, r.out)
  const card = r.calls.find((c) => c.args[0] === 'pr' && c.args[1] === 'comment')
  assert.match(card.file, /^<!-- dsh-gallery-gate -->\n### ⟳ 检查没跑完/)
  assert.match(card.file, /不是投稿本身的问题/)
  assert.match(card.file, /not with your submission/)
  assert.match(card.file, /大约 5 分钟后自动重跑/)
  const chk = r.calls.find((c) => c.route === 'POST repos/o/r/check-runs')
  assert.ok(chk.fields.includes('conclusion=failure') && chk.fields.includes('name=Submission gate') && chk.fields.includes(`head_sha=${SHA}`) && chk.fields.includes('external_id=100/1'))
  assert.equal(r.calls.find((c) => c.route.includes('/actions/')).token, 'read') // App 没有 Actions 权限，数次数用 GITHUB_TOKEN
  const del = r.calls.filter((c) => c.route.startsWith('DELETE ')).map((c) => decodeURIComponent(c.route.split('/labels/')[1]))
  assert.deepEqual(del.sort(), ['checks: pass', 'held: author', 'lane: B']) // 维护者的 held: maintainer 留着
  assert.ok(r.calls.find((c) => c.route === 'POST repos/o/r/issues/7/labels').fields.includes('labels[]=checks: incomplete'))
  assert.deepEqual(r.sleeps, ['300'])
  assert.deepEqual(acts(r), ['comment', ...RERUN])
  assert.ok(!r.calls.some((c) => c.args[1] === 'close' || c.args[1] === 'reopen')) // 不关 PR
  assert.ok(r.calls.filter((c) => c.route.startsWith('graphql:')).every((c) => c.fields.includes('id=PR_7')))
})

test('检查没跑完：已有审核卡就改那张（只认机器人自己的）；第二回等 10 分钟', { skip: SKIP }, () => {
  const fix = baseFix({
    '^GET repos/o/r/issues/7/comments$': { body: [{ id: 55, user: { login: 'bot[bot]' }, body: '<!-- dsh-gallery-gate -->\nold' }, { id: 56, user: { login: 'evil' }, body: '<!-- dsh-gallery-gate -->\nfake' }] },
    '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['failure'], ['cancelled'], ['timed_out']),
  })
  const r = runInc({ fix, env: incEnv() })
  assert.equal(r.code, 0, r.out)
  const patch = r.calls.find((c) => c.route === 'PATCH repos/o/r/issues/comments/55')
  assert.ok(patch && /大约 10 分钟后/.test(patch.file))
  assert.deepEqual(acts(r), RERUN)
  assert.deepEqual(r.sleeps, ['600'])
})

test('检查没跑完：跑满 3 回（成功了却没产物、手动重跑都算）不再重跑，单独 @ 维护者一次', { skip: SKIP }, () => {
  for (const [runs, attempt] of [[runsOf(['failure'], ['failure'], ['startup_failure']), '1'], [runsOf(['success'], ['success', 2]), '1'], [runsOf(['success', 3]), '3']]) {
    const r = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs }), env: incEnv({ RUN_ATTEMPT: attempt }) })
    assert.equal(r.code, 0, r.out)
    const posts = r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment')
    assert.equal(posts.length, 2, JSON.stringify(runs))
    // 先 @ 维护者、再贴卡（贴卡失败了 @ 也发出去了）
    assert.match(posts[0].file, new RegExp(`^<!-- dsh-gallery-stuck ${SHA} -->\n@OrderG-X `))
    assert.match(posts[1].file, /不再自动重跑/)
    assert.ok(!r.calls.some((c) => c.route.startsWith('graphql:')))
    assert.deepEqual(r.sleeps, [])
  }
})

test('检查没跑完：@ 维护者按 PR 算、24 小时内只一次（换个提交也不再 @）；维护者 /hold 过的不 @', { skip: SKIP }, () => {
  const full = { '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['failure', 3]) }
  const env = incEnv({ RUN_ATTEMPT: '3' })
  const ping = (hoursAgo, sha = 'c'.repeat(40), who = 'bot[bot]') => ({ id: 9, user: { login: who }, created_at: iso(hoursAgo / 24), body: `<!-- dsh-gallery-stuck ${sha} -->\n@OrderG-X …` })
  const posts = (comments, more = {}) => {
    const r = runInc({ fix: baseFix({ ...full, '^GET repos/o/r/issues/7/comments$': { body: comments }, ...more }), env })
    assert.equal(r.code, 0, r.out)
    return r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment').length
  }
  assert.equal(posts([ping(2, SHA)]), 1) // 这个提交 @ 过：只贴审核卡
  assert.equal(posts([ping(2)]), 1) // 别的提交 2 小时前 @ 过：也不再 @
  assert.equal(posts([ping(30)]), 2) // 30 小时前的：再 @ 一次
  assert.equal(posts([ping(2, SHA, 'evil')]), 2) // 别人假冒的提醒不算
  // 重跑脚本「标不回」的那种提醒不算这一类
  assert.equal(posts([{ id: 9, user: { login: 'bot[bot]' }, created_at: iso(0.05), body: '<!-- dsh-gallery-stuck -->\n@OrderG-X …' }]), 2)
  assert.equal(posts([], { '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [{ name: 'held: maintainer' }] } }), 1) // 维护者挂起了：不 @
  // 要 @ 之前 PR 有了新提交 / 被关了（别的提交的闸门回合会管）：不 @；再看那一下查不到就照发
  assert.equal(posts([], { '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } })] } }), 1)
  assert.equal(posts([], { '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr({ state: 'closed' })] } }), 1)
  assert.equal(posts([], { '^GET repos/o/r/pulls/7$': { bodies: [pr(), {}], codes: [0, 1] } }), 2)
})

test('检查没跑完：整个跳过的（PR 自己改了检查工作流）——不贴卡、不重跑', { skip: SKIP }, () => {
  const r = runInc({ fix: baseFix(), env: incEnv({ RUN_CONCLUSION: 'skipped' }) })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.calls.length, 0)
})

test('检查没跑完：触发这回的已经不是最新的（后面又跑过、这回被重跑过）——什么都不写', { skip: SKIP }, () => {
  const writes = (r) => r.calls.filter((c) => c.args[0] === 'pr' || /^(POST|PATCH|DELETE) |^graphql:/.test(c.route))
  for (const [runs, attempt] of [[runsOf(['failure'], ['success', 1, 'completed', 101]), '1'], [runsOf(['failure'], ['none', 1, 'queued', 101]), '1'], [runsOf(['success', 2]), '1']]) {
    const r = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs }), env: incEnv({ RUN_ATTEMPT: attempt }) })
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(writes(r), [], JSON.stringify(runs))
    assert.deepEqual(r.sleeps, [])
  }
  // 对照：就是最新的那回（重跑后的第 2 回）照常处理
  const cur = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['failure', 2]) }), env: incEnv({ RUN_ATTEMPT: '2' }) })
  assert.equal(cur.code, 0, cur.out)
  assert.deepEqual(cur.sleeps, ['600'])
  assert.deepEqual(acts(cur), ['comment', ...RERUN])
})

test('检查没跑完：跑过几回要分页数全（触发这回的在第二页也认）', { skip: SKIP }, () => {
  const run = (id, conclusion) => ({ id, status: 'completed', conclusion, run_attempt: 1 })
  const r = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { pages: [{ workflow_runs: [run(99, 'failure')] }, { workflow_runs: [run(100, 'failure')] }] } }), env: incEnv() })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(r.sleeps, ['600']) // 数到了 2 回
  assert.deepEqual(acts(r), ['comment', ...RERUN])
})

test('检查没跑完：数不准跑过几回（查询出错、连触发这回的都没数到）——判断不了是不是最新的：不写检查、卡片、标签，只 @ 维护者，算失败', { skip: SKIP }, () => {
  for (const runs of [{ code: 1, body: {} }, { body: { workflow_runs: [] } }, { body: { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'failure', run_attempt: 1 }] } }]) {
    const r = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs }), env: incEnv() })
    assert.equal(r.code, 1, r.out)
    assert.ok(!r.calls.some((c) => /^(POST|PATCH|DELETE) |^graphql:/.test(c.route)), JSON.stringify(r.calls.map((c) => c.route)))
    const posts = r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment')
    assert.equal(posts.length, 1)
    assert.match(posts[0].file, new RegExp(`^<!-- dsh-gallery-stuck ${SHA} -->\n@OrderG-X .*查不到它跑过几回`))
    const ac = r.calls.find((c) => c.route.includes('/actions/')); assert.ok(ac.args.includes('--paginate'))
  }
  // 24 小时内 @ 过、维护者挂起了：连 @ 也不发，照样算失败
  const pinged = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { code: 1 }, '^GET repos/o/r/issues/7/comments$': { body: [{ id: 9, user: { login: 'bot[bot]' }, created_at: iso(0.05), body: `<!-- dsh-gallery-stuck ${SHA} -->\n…` }] } }), env: incEnv() })
  assert.equal(pinged.code, 1, pinged.out)
  assert.equal(pinged.calls.filter((c) => c.args[0] === 'pr').length, 0)
})

test('检查没跑完：等的时候已经有别的检查（在跑的、多跑了一回的）——不再添一回', { skip: SKIP }, () => {
  const busy = runsOf(['failure'], ['none', 1, 'in_progress'])
  const newer = runsOf(['failure'], ['failure', 1, 'completed', 101]) // 等的时候又来了一回（跑完了）
  for (const [first, later] of [[runsOf(['failure']), busy], [runsOf(['failure']), runsOf(['failure', 2])], [busy, busy], [runsOf(['failure']), newer]]) {
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { bodies: [first.body, later.body], codes: [0, later.code || 0] } })
    const r = runInc({ fix, env: incEnv() })
    assert.equal(r.code, 0, r.out)
    assert.equal(r.sleeps.length, 1)
    assert.deepEqual(acts(r), ['comment'], JSON.stringify(later))
  }
  // 等的时候来的那回被取消了（重跑旧回合、手动取消）：不算又跑过，照常重跑
  const canc = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { bodies: [runsOf(['failure']).body, runsOf(['failure'], ['cancelled', 1, 'completed', 101]).body] } })
  const cr = runInc({ fix: canc, env: incEnv() })
  assert.equal(cr.code, 0, cr.out)
  assert.deepEqual(acts(cr), ['comment', ...RERUN])
  // 等完再数的时候数不准（查询出错、数据不对）：卡上说了会自动重跑，不能悄悄断掉——@ 维护者，这步算失败，不重跑
  for (const later of [{ code: 1, body: {} }, { body: { workflow_runs: [{ id: 100, status: 'completed', conclusion: 'failure', run_attempt: null }] } }]) {
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { bodies: [runsOf(['failure']).body, later.body], codes: [0, later.code || 0] } })
    const r = runInc({ fix, env: incEnv() })
    assert.equal(r.code, 1, r.out)
    assert.equal(r.sleeps.length, 1)
    assert.deepEqual(acts(r), ['comment', 'comment'])
    assert.match(r.calls.filter((c) => c.args[1] === 'comment')[1].file, new RegExp(`^<!-- dsh-gallery-stuck ${SHA} -->\n@OrderG-X .*没能重跑`))
  }
})

test('检查没跑完：数跑过几回时哪一步出错（排序、统计出错，记录格式不对）都算数不准——不写、@ 维护者、算失败，不能退回「第 1 回」接着重跑', { skip: SKIP }, () => {
  const writes = (r) => r.calls.filter((c) => /^(POST|PATCH|DELETE) |^graphql:/.test(c.route))
  const cases = [
    [{}, { sort: '#!/bin/bash\nexit 42\n' }],
    [{}, { awk: '#!/bin/bash\nexit 42\n' }],
    [{ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { body: { workflow_runs: [{ id: 100, status: 'completed', conclusion: 'failure', run_attempt: 'x' }] } } }, undefined],
  ]
  for (const [over, extra] of cases) {
    const r = runInc({ fix: baseFix(over), env: incEnv(), extra })
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(writes(r), [], JSON.stringify(extra || over))
    assert.deepEqual(r.sleeps, [])
    const posts = r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment')
    assert.equal(posts.length, 1)
    assert.match(posts[0].file, /查不到它跑过几回/)
  }
})

test('检查没跑完：排 PR 的队，轮到了 PR 已经有新提交、被关了——不写（不能盖掉新提交的卡和标签）', { skip: SKIP }, () => {
  for (const p of [pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } }), pr({ state: 'closed' })]) {
    const box = newBox({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: p } }) })
    const o = path.join(box.w, 'out'); fs.writeFileSync(o, '')
    const r = runStep('pr-gate.yml', INC[1], { box, env: { ...incEnv(), N: '7', GITHUB_OUTPUT: o } })
    assert.equal(r.code, 0, r.out)
    assert.ok(!r.calls.some((c) => c.args[0] === 'pr' || /^(POST|PATCH|DELETE) /.test(c.route)), JSON.stringify(r.calls.map((c) => c.route)))
    assert.equal(fs.readFileSync(o, 'utf8'), '') // 也不排重跑
  }
})

test('检查没跑完：取消的、PR 关了的、有新提交的、来源对不上的都不动', { skip: SKIP }, () => {
  const c1 = runInc({ fix: baseFix(), env: incEnv({ RUN_CONCLUSION: 'cancelled' }) })
  assert.equal(c1.code, 0, c1.out)
  assert.equal(c1.calls.length, 0)
  for (const p of [pr({ state: 'closed' }), pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } }), pr({ head: { sha: SHA, ref: 'other', repo: { full_name: 'o/r', node_id: 'R_o' } } }), pr({ head: { sha: SHA, ref: 'submission/7', repo: null } })]) {
    const r = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: p } }), env: incEnv() })
    assert.equal(r.code, 0, r.out)
    assert.ok(!r.calls.some((c) => c.args[0] === 'pr' || c.route.startsWith('POST ') || c.route.startsWith('graphql:')), JSON.stringify(r.calls))
  }
})

test('检查没跑完：fork 来的（GitHub 不给号）按来源仓库 + 分支 + 提交找，唯一才认；同一提交两个 PR 就不动；往别的分支合的不算', { skip: SKIP }, () => {
  const fork = (n, repo, ref, base = 'main') => ({ number: n, head: { sha: SHA, ref, repo: { full_name: repo, node_id: `R_${repo.split('/')[0]}` } }, base: { ref: base } })
  const env = incEnv({ RUN_PRS: '[]', RUN_HEAD_REPO_ID: 'R_alice', RUN_HEAD_BRANCH: 'main' })
  const p7 = pr({ head: { sha: SHA, ref: 'main', repo: { full_name: 'alice/r', node_id: 'R_alice' } } })
  const aliceRuns = { body: { workflow_runs: [{ id: 100, status: 'completed', conclusion: 'failure', run_attempt: 1, head_branch: 'main', head_repository: { full_name: 'alice/r', node_id: 'R_alice' } }] } }
  const one = runInc({ fix: baseFix({ '^GET repos/o/r/pulls\\?state=open': { body: [fork(3, 'bob/r', 'main'), fork(7, 'alice/r', 'main')] }, '^GET repos/o/r/pulls/7$': { body: p7 }, '^GET repos/o/r/actions/workflows/pr-check.yml/runs': aliceRuns }), env })
  assert.equal(one.code, 0, one.out)
  assert.deepEqual(acts(one), ['comment', ...RERUN])
  const two = runInc({ fix: baseFix({ '^GET repos/o/r/pulls\\?state=open': { body: [fork(3, 'alice/r', 'main'), fork(7, 'alice/r', 'main')] } }), env })
  assert.equal(two.code, 0, two.out)
  assert.deepEqual(acts(two), [])
  const none = runInc({ fix: baseFix({ '^GET repos/o/r/pulls\\?state=open': { body: [fork(3, 'bob/r', 'main')] } }), env })
  assert.deepEqual(acts(none), [])
  // GitHub 给了两个号也不认
  const multi = runInc({ fix: baseFix({ '^GET repos/o/r/pulls\\?state=open': { body: [] } }), env: incEnv({ RUN_PRS: '[{"number":7,"base":{"ref":"main"}},{"number":8,"base":{"ref":"main"}}]' }) })
  assert.deepEqual(acts(multi), [])
  // 同一个来源另开了一个往别的分支合的 PR（#8 → submission/5）：只认往 main 合的 #7（GitHub 给的号、fork 按列表找都一样）
  const side = runInc({ fix: baseFix(), env: incEnv({ RUN_PRS: '[{"number":8,"base":{"ref":"submission/5"}},{"number":7,"base":{"ref":"main"}}]' }) })
  assert.equal(side.code, 0, side.out)
  assert.deepEqual(acts(side), ['comment', ...RERUN])
  assert.ok(!side.calls.some((c) => c.route.includes('/pulls/8')))
  const sideFork = runInc({ fix: baseFix({ '^GET repos/o/r/pulls\\?state=open': { body: [fork(8, 'alice/r', 'main', 'submission/5'), fork(7, 'alice/r', 'main')] }, '^GET repos/o/r/pulls/7$': { body: p7 }, '^GET repos/o/r/actions/workflows/pr-check.yml/runs': aliceRuns }), env })
  assert.equal(sideFork.code, 0, sideFork.out)
  assert.deepEqual(acts(sideFork), ['comment', ...RERUN])
  const onlySide = runInc({ fix: baseFix({ '^GET repos/o/r/pulls\\?state=open': { body: [fork(8, 'alice/r', 'main', 'submission/5')] } }), env })
  assert.deepEqual(acts(onlySide), [])
})

test('检查没跑完：作者自己的草稿——贴卡说标成可以审了就会重跑，机器人不替他改', { skip: SKIP }, () => {
  const r = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: pr({ draft: true }) } }), env: incEnv() })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(acts(r), ['comment'])
  assert.match(r.calls.find((c) => c.args[1] === 'comment').file, /Ready for review/)
  assert.deepEqual(r.sleeps, [])
})

test('检查没跑完：等的时候维护者关了 / 作者推了新提交——不碰它', { skip: SKIP }, () => {
  for (const change of ['j[k].body.state="closed"', `j[k].body.head.sha="${'b'.repeat(40)}"`]) {
    const extra = { sleep: `#!/bin/bash\necho "$*" >> "$SLEEP_LOG"\nnode -e 'const fs=require("fs"),f=process.env.FAKE_FIX,j=JSON.parse(fs.readFileSync(f)),k="^GET repos/o/r/pulls/7$";${change};fs.writeFileSync(f,JSON.stringify(j))'\n` }
    const r = runInc({ fix: baseFix(), env: incEnv(), extra })
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(acts(r), ['comment'], change)
  }
})

test('重跑：标不回「可以审了」——按 PR 实际的样子办：还是草稿（或查不到）试 3 次再 @ 维护者；被关了、不是草稿就算了', { skip: SKIP }, () => {
  const asDraft = { bodies: [pr(), pr(), pr({ draft: true })] } // 闸门查一次、recheck 查一次，之后都是草稿
  const r = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': asDraft, 'graphql:markPullRequestReadyForReview': { codes: [1, 1, 1] } }), env: incEnv() })
  assert.equal(r.code, 1, r.out)
  assert.deepEqual(acts(r), ['comment', RERUN[0], RERUN[1], RERUN[1], RERUN[1], 'comment'])
  assert.match(r.calls.filter((c) => c.args[1] === 'comment').pop().file, /^<!-- dsh-gallery-stuck -->\n@OrderG-X .*Ready for review/)
  const ok2 = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': asDraft, 'graphql:markPullRequestReadyForReview': { codes: [1, 0] } }), env: incEnv() })
  assert.equal(ok2.code, 0, ok2.out)
  assert.deepEqual(acts(ok2), ['comment', RERUN[0], RERUN[1], RERUN[1]])
  // 查不到实际样子：接着试，3 回都不行就 @
  const lost = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: pr(), codes: [0, 0, 1, 1, 1] }, 'graphql:markPullRequestReadyForReview': { codes: [1, 1, 1] } }), env: incEnv() })
  assert.equal(lost.code, 1, lost.out)
  assert.deepEqual(acts(lost), ['comment', RERUN[0], RERUN[1], RERUN[1], RERUN[1], 'comment'])
  // 被关了：不 @
  const closed = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ state: 'closed', draft: true })] }, 'graphql:markPullRequestReadyForReview': { codes: [1] } }), env: incEnv() })
  assert.equal(closed.code, 0, closed.out)
  assert.deepEqual(acts(closed), ['comment', RERUN[0], RERUN[1]])
  // 标回报错、查到已经不是草稿（其实标回了）：算成，不 @
  const back = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: pr() }, 'graphql:markPullRequestReadyForReview': { code: 1 } }), env: incEnv() })
  assert.equal(back.code, 0, back.out)
  assert.deepEqual(acts(back), ['comment', RERUN[0], RERUN[1]])
  // 是草稿的时候作者推了新提交：照样标回（不然 PR 一直是草稿）
  const pushed = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ draft: true, head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } })] }, 'graphql:markPullRequestReadyForReview': { codes: [1, 0] } }), env: incEnv() })
  assert.equal(pushed.code, 0, pushed.out)
  assert.deepEqual(acts(pushed), ['comment', RERUN[0], RERUN[1], RERUN[1]])
})

test('重跑：转草稿报错——按实际的样子办：其实转成了就标回；没转成再试，3 回都没成 @ 维护者（检查没能重跑，不能装作成了）', { skip: SKIP }, () => {
  const convert = (codes) => ({ 'graphql:convertPullRequestToDraft': { codes } })
  // 其实转成了（响应丢了）：标回
  const applied = runInc({ fix: baseFix({ ...convert([1]), '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ draft: true })] } }), env: incEnv() })
  assert.equal(applied.code, 0, applied.out)
  assert.deepEqual(acts(applied), ['comment', ...RERUN])
  // 没转成，第二回成了
  const second = runInc({ fix: baseFix(convert([1, 0])), env: incEnv() })
  assert.equal(second.code, 0, second.out)
  assert.deepEqual(acts(second), ['comment', RERUN[0], ...RERUN])
  // 3 回都没转成：不标回、@ 维护者去手动重跑，算失败
  const never = runInc({ fix: baseFix(convert([1, 1, 1])), env: incEnv() })
  assert.equal(never.code, 1, never.out)
  assert.deepEqual(acts(never), ['comment', RERUN[0], RERUN[0], RERUN[0], 'comment'])
  assert.match(never.calls.filter((c) => c.args[1] === 'comment').pop().file, /^<!-- dsh-gallery-stuck -->\n@OrderG-X .*手动重跑 pr-check/)
  // 没转成、作者推了新提交：新提交自己会重跑，不用管
  const moved = runInc({ fix: baseFix({ ...convert([1]), '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } })] } }), env: incEnv() })
  assert.equal(moved.code, 0, moved.out)
  assert.deepEqual(acts(moved), ['comment', RERUN[0]])
  // 转成了、却在这期间有了新提交：还是得标回
  const both = runInc({ fix: baseFix({ ...convert([1]), '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ draft: true, head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } })] } }), env: incEnv() })
  assert.equal(both.code, 0, both.out)
  assert.deepEqual(acts(both), ['comment', ...RERUN])
})

test('假 gh 自己：GraphQL 变量对不上就报错（免得测试把写错的请求当成功）', { skip: SKIP }, () => {
  const { w, bin } = sandbox()
  const fix = path.join(w, 'fix.json'); fs.writeFileSync(fix, JSON.stringify({ '^graphql:': { body: {} } }))
  const log = path.join(w, 'log'); fs.writeFileSync(log, '')
  const gh = (...a) => spawnSync(path.join(bin, 'gh'), a, { env: { ...process.env, FAKE_FIX: fix, GH_LOG: log } }).status
  const q = 'mutation($id: ID!) { convertPullRequestToDraft(input: {pullRequestId: $id}) { pullRequest { isDraft } } }'
  assert.equal(gh('api', 'graphql', '-f', `query=${q}`, '-f', 'id=PR_7'), 0)
  assert.equal(gh('api', 'graphql', '-f', `query=${q}`, '-f', 'pr=PR_7'), 1)
  assert.equal(gh('api', 'graphql', '-f', `query=${q.replace('pullRequestId', 'prId')}`, '-f', 'id=PR_7'), 1)
  assert.equal(gh('api', 'repos/o/r/unknown'), 1) // 没写回应的 API 请求报错
  assert.equal(gh('pr', 'merge', '7'), 1) // 没写回应的 gh pr / gh issue 命令也报错
})

test('闸门工作流：有产物才走闸门、没产物走 incomplete；算的按提交排队，写到 PR 上的按 PR 排队；闸门不合并（只有维护者 /approve 合）；排队的不被顶掉；整个仓库不点重跑、不关了再开', () => {
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/pr-gate.yml'), 'utf8')
  const lock = (g) => `    concurrency:\n      group: ${g}\n      cancel-in-progress: false\n      queue: max\n`
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  assert.match(y, new RegExp(esc(`\n  gate:\n    needs: probe\n`) + '    # [^\\n]*\\n' + esc(`    if: \${{ !cancelled() && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.path == '.github/workflows/pr-check.yml' && needs.probe.outputs.has != 'false' && needs.probe.outputs.fresh != 'false' }}\n`) + '    runs-on: [^\\n]+\\n    timeout-minutes: \\d+\\n' + esc(lock('pr-gate-${{ github.event.workflow_run.head_sha }}'))))
  assert.match(y, new RegExp(esc(`\n  post:\n    needs: gate\n`) + '    # [^\\n]*\\n' + esc(`    if: \${{ !cancelled() && needs.gate.result == 'success' && needs.gate.outputs.number != '' }}\n`) + '    runs-on: [^\\n]+\\n    timeout-minutes: \\d+\\n' + esc(lock('dsh-pr-${{ needs.gate.outputs.number }}'))))
  // 闸门只做初筛：不合并（没有 automerge，也不调合并接口）；合并只在 chatops 的 confirm 里（维护者 /approve）
  assert.doesNotMatch(y, /\n  automerge:\n|gh pr merge|\/merge\b|merge=true|USE_ALT/)
  assert.doesNotMatch(y.slice(y.indexOf('\n  post:\n'), y.indexOf('\n  incomplete:\n')), /\n    outputs:\n/)
  assert.ok(!fs.existsSync(path.join(REAL, 'scripts/held-by-comment.sh')))
  for (const f of fs.readdirSync(path.join(REAL, '.github/workflows'))) {
    const code = fs.readFileSync(path.join(REAL, '.github/workflows', f), 'utf8')
    if (f !== 'chatops.yml') assert.doesNotMatch(code, /gh pr merge|pulls\/[^/\s]+\/merge/, f)
  }
  // 没产物、闸门自己出错了、写结果的 post 出错了：走 incomplete（贴卡、过几分钟重跑）；过期的不走
  assert.match(y, new RegExp(esc(`\n  incomplete:\n    needs: [probe, gate, post]\n    if: \${{ !cancelled() && (needs.probe.result == 'success' || needs.probe.result == 'failure') && needs.probe.outputs.fresh != 'false' && (needs.probe.outputs.has == 'false' || needs.gate.result == 'failure' || needs.post.result == 'failure') }}\n`)))
  // 祖先（gate、post）跳过了、失败了：后面两段要显式写 !cancelled()，不然被跟着跳过
  assert.match(y, new RegExp(esc(`\n  incomplete_post:\n    needs: incomplete\n    if: \${{ !cancelled() && needs.incomplete.result == 'success' && needs.incomplete.outputs.number != '' }}\n`) + '    runs-on: [^\\n]+\\n    timeout-minutes: \\d+\\n' + esc(lock('dsh-pr-${{ needs.incomplete.outputs.number }}'))))
  // 不在 incomplete 之后的 job 都不用管；会接在 gate / post 后面的 job，条件都写了状态函数（不然祖先跳过、失败会把它们跟着跳过）
  const jobs = y.slice(y.indexOf('\njobs:\n')).split(/\n(?=  [a-z_]+:\n)/).slice(1).map((c) => [/^  ([a-z_]+):\n/.exec(c)[1], c])
  assert.ok(jobs.length >= 6, jobs.map((j) => j[0]).join())
  for (const [name, body] of jobs) {
    const needs = (/\n    needs: (\[[^\]]*\]|\S+)/.exec(body) || [])[1] || ''
    if (!needs) continue
    assert.match(body, /\n    if: \$\{\{ !cancelled\(\) && /, name)
  }
  // 等几分钟再重跑的那段不排 PR 的队（不然维护者命令要干等）
  const rc = y.slice(y.indexOf('\n  incomplete_recheck:'))
  // 上一段（贴卡、写检查）失败了也照样重跑：不要求它成功，只要它定下了要重跑（wait）
  assert.match(rc, /^\n  incomplete_recheck:\n    needs: \[incomplete, incomplete_post\]\n    # [^\n]*\n    if: \$\{\{ !cancelled\(\) && needs\.incomplete\.result == 'success' && needs\.incomplete_post\.outputs\.wait != '' \}\}\n/)
  assert.doesNotMatch(rc, /concurrency:/)
  // 写 PR 的步骤都只在排 PR 队的 job 里
  const jobOf = (step) => { const at = y.indexOf(`- name: ${step}`); assert.ok(at > 0, step); return [...y.slice(0, at).matchAll(/\n  ([a-z_]+):\n/g)].pop()[1] }
  assert.equal(jobOf('写检查、贴卡、打标签'), 'post')
  assert.equal(jobOf("'@ 维护者（每个 PR 一次；检查没过、挂起了、维护者 /hold 过的不提醒）'"), 'post')
  assert.equal(jobOf('检查没跑完：贴卡、说多久以后重跑'), 'incomplete_post')
  assert.doesNotMatch(y, /\n  ping:\n/)
  assert.doesNotMatch(y, /\nconcurrency:/)
  // 维护者命令排合并的队（/approve 一次只合一个；/hold、/untrust 回话前等前面正在合的走完）
  const ops = fs.readFileSync(path.join(REAL, '.github/workflows/chatops.yml'), 'utf8')
  assert.ok(ops.includes(lock('dsh-merge')))
  assert.doesNotMatch(ops, /\nconcurrency:/)
  // 只认 pr-check.yml 这个文件跑出来的（PR 能另加一个同名工作流）
  assert.match(y, /\n  probe:\n    if: github\.event\.workflow_run\.event == 'pull_request' && github\.event\.workflow_run\.path == '\.github\/workflows\/pr-check\.yml'\n/)
  for (const f of fs.readdirSync(path.join(REAL, '.github/workflows'))) {
    const code = fs.readFileSync(path.join(REAL, '.github/workflows', f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    assert.doesNotMatch(code, /gh run rerun|gh run list|gh pr reopen/, f)
    // 用了排队的都得是 queue: max（默认一个组只留一个排队的，会被顶掉）——顶层的、job 里的都查。
    // 例外：cancel-in-progress: true 的（本来就只要最新那回）；publish.yml（排着的被顶掉不丢东西，见那里的说明）
    for (const m of code.matchAll(/\n( *)concurrency:\n((?:\1  [^\n]*\n)+)/g)) {
      if (/cancel-in-progress: true/.test(m[2])) continue
      if (f === 'publish.yml' && m[1] === '' && /group: publish\n/.test(m[2])) continue
      assert.match(m[2], /queue: max/, `${f}: ${m[2]}`)
    }
  }
  const chk = fs.readFileSync(path.join(REAL, '.github/workflows/pr-check.yml'), 'utf8')
  assert.match(chk, /types: \[[^\]]*\bready_for_review\b/) // 标回「可以审了」要能触发检查
  assert.match(chk, /types: \[[^\]]*\bedited\b/) // 改了目标分支（改成往 main 合）不推提交也要重查
})

test('probe：只认这一回（attempt 开始以后）传的、没过期的 check-results，给出最新那个的 id', { skip: SKIP }, () => {
  const T0 = '2026-11-12T10:00:00Z'
  const art = (id, created_at, over = {}) => ({ id, name: 'check-results', expired: false, created_at, ...over })
  const probe = (fix) => {
    const o = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-probe-')), 'out')
    fs.writeFileSync(o, '')
    const r = runStep('pr-gate.yml', '看检查产物在不在', { fix: { artifacts: fix }, env: { GH_TOKEN: 't', RUN: '1', STARTED: T0, GITHUB_OUTPUT: o } })
    return { r, out: fs.readFileSync(o, 'utf8').trim() }
  }
  const got = (artifacts) => { const { r, out } = probe({ body: { artifacts } }); assert.equal(r.code, 0, r.out); return out }
  assert.equal(got([art(5, '2026-11-12T10:03:00Z')]), 'has=true\nid=5')
  assert.equal(got([art(5, '2026-11-12T10:03:00Z', { expired: true }), art(6, '2026-11-12T10:03:00Z', { name: 'x' })]), 'has=false')
  assert.equal(got([]), 'has=false')
  // 重跑：上一回传的（这回开始之前）不算；这回没传就是没产物
  assert.equal(got([art(3, '2026-11-12T09:50:00Z')]), 'has=false')
  assert.equal(got([art(3, '2026-11-12T09:50:00Z'), art(4, '2026-11-12T10:02:00Z')]), 'has=true\nid=4')
  // 这回传了不止一个（不该有，但 PR 能改 pr-check）：取最新的
  assert.equal(got([art(9, '2026-11-12T10:02:00Z'), art(8, '2026-11-12T10:04:00Z')]), 'has=true\nid=8')
  // 在第二页的也认（按名字筛、分页取全）
  const many = Array.from({ length: 100 }, (_, i) => ({ id: 100 + i, name: `junk-${i}`, expired: false, created_at: T0 }))
  const p2 = probe({ pages: [{ artifacts: many }, { artifacts: [art(7, '2026-11-12T10:01:00Z')] }] })
  assert.equal(p2.r.code, 0, p2.r.out)
  assert.equal(p2.out, 'has=true\nid=7')
  assert.match(p2.r.calls[0].route, /artifacts\?name=check-results&/)
  // 查询出错：这步失败、不写 has（照旧走闸门，不当成「没产物」去重跑）
  const bad = probe({ code: 1 })
  assert.notEqual(bad.r.code, 0)
  assert.equal(bad.out, '')
})

test('闸门取产物：按 probe 认定的 id 下载那一个（不按名字取，免得取到上一回的）；没有 id 就失败', { skip: SKIP }, () => {
  const extra = { unzip: '#!/bin/bash\nwhile [ $# -gt 0 ]; do case "$1" in -d) mkdir -p "$2"; echo 7 > "$2/pr"; shift 2;; *) shift;; esac; done\n' }
  const ok = runStep('pr-gate.yml', '取检查产物（按 probe 认定的那一个 id 取）', { fix: { '^GET repos/o/r/actions/artifacts/42/zip$': { body: 'zip' } }, env: { GH_TOKEN: 't', ID: '42' }, extra })
  assert.equal(ok.code, 0, ok.out)
  assert.deepEqual(ok.calls.map((c) => c.route), ['GET repos/o/r/actions/artifacts/42/zip'])
  assert.equal(fs.readFileSync(path.join(ok.w, 'artifact/pr'), 'utf8').trim(), '7')
  const none = runStep('pr-gate.yml', '取检查产物（按 probe 认定的那一个 id 取）', { fix: {}, env: { GH_TOKEN: 't', ID: '' }, extra })
  assert.notEqual(none.code, 0)
  assert.equal(none.calls.length, 0)
  // 检查产物不按名字下载（只按 id）；download-artifact 只有 post 取 gate 这次运行自己传的 gate-result
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/pr-gate.yml'), 'utf8')
  const dl = [...y.matchAll(/uses: actions\/download-artifact@v4\n((?: {8}[^\n]*\n)+)/g)]
  assert.equal(dl.length, 1)
  for (const d of dl) assert.match(d[1], /^        with:\n          name: gate-result\n          path: gate-result\n$/)
  const post = y.indexOf('\n  post:\n'), inc = y.indexOf('\n  incomplete:\n')
  assert.ok(post < dl[0].index && dl[0].index < inc)
})

test('闸门核对 PR：触发这回的已经不是这个提交最新的一回（后面又跑过、这回被重跑过、数不到这回）——跳过，什么都不写', { skip: SKIP }, () => {
  const step = '核对是哪个 PR（按来源找往 main 合的那个）'
  const go = (runs, attempt = '1') => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-gate-'))
    fs.mkdirSync(path.join(cwd, 'artifact')); fs.writeFileSync(path.join(cwd, 'artifact/pr'), '7')
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const fix = { '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs, '^GET repos/o/r/pulls\\?state=open': { body: [pr()] }, '^GET repos/o/r/pulls/7$': { body: pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } }) } }
    const r = runStep('pr-gate.yml', step, { fix, env: { GH_TOKEN: 'app', READ_TOKEN: 'read', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: attempt, RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', APP_SLUG: 'bot', GITHUB_OUTPUT: o }, cwd })
    return { r, out: fs.readFileSync(o, 'utf8').trim() }
  }
  for (const [runs, attempt] of [[runsOf(['failure'], ['success', 1, 'completed', 101]), '1'], [runsOf(['success', 2]), '1'], [{ pages: [{ workflow_runs: [{ id: 100, run_attempt: 1 }] }, { workflow_runs: [{ id: 101, run_attempt: 1 }] }] }, '1']]) {
    const { r, out } = go(runs, attempt)
    assert.equal(r.code, 0, r.out)
    assert.equal(out, 'skip=true', JSON.stringify(runs))
    assert.deepEqual(r.calls.map((c) => c.route.split('?')[0]), ['GET repos/o/r/actions/workflows/pr-check.yml/runs'])
    assert.equal(r.calls[0].token, 'read')
  }
  // 说不准（查询出错、列表是空的、数不到这回又没有更新的、数据不对）：这步失败（不写结果），不能当成过期悄悄跳过
  for (const runs of [{ code: 1 }, { body: { workflow_runs: [] } }, { body: { workflow_runs: [{ id: 5, run_attempt: 1 }] } }, { body: { workflow_runs: [{ id: 100, run_attempt: null }] } }]) {
    const bad = go(runs)
    assert.notEqual(bad.r.code, 0, JSON.stringify(runs))
    assert.equal(bad.out, '')
  }
  // 对照：是最新的那回（重跑后的第 2 回）就往下核 PR
  const cur = go(runsOf(['success', 2]), '2')
  assert.ok(cur.r.calls.some((c) => c.route === 'GET repos/o/r/pulls/7'), cur.r.out)
  // 别的 PR（别的分支、别的 fork）指着同一个提交、跑得更晚：不算这个 PR 的，不能把这回顶成过期
  for (const other of [{ head_branch: 'submission/8' }, { head_repository: { full_name: 'eve/r', node_id: 'R_eve' } }]) {
    const x = go({ body: { workflow_runs: [{ id: 100, run_attempt: 1 }, { id: 101, run_attempt: 1, ...other }] } })
    assert.equal(x.r.code, 0, x.r.out)
    assert.ok(x.r.calls.some((c) => c.route === 'GET repos/o/r/pulls/7'), JSON.stringify(other)) // 过了「是不是最新」，往下核 PR
  }
  // 只有别的来源跑过（数不到这回）：说不准，这步失败
  const only = go({ body: { workflow_runs: [{ id: 100, run_attempt: 1, head_branch: 'submission/8' }] } })
  assert.notEqual(only.r.code, 0)
  assert.equal(only.out, '')
})

test('闸门核对 PR：号按这回检查的来源在开着的、往 main 合的 PR 里找（不用产物里写的号）；往别的分支合的不算；列表之后 PR 变了就跳过', { skip: SKIP }, () => {
  const step = '核对是哪个 PR（按来源找往 main 合的那个）'
  const go = (list, one = pr(), art = '8', ev = { body: [] }, more = {}) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-gate0-'))
    fs.mkdirSync(path.join(cwd, 'artifact')); fs.writeFileSync(path.join(cwd, 'artifact/pr'), art)
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const fix = {
      '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['success']),
      '^GET repos/o/r/pulls\\?state=open': list,
      '^GET repos/o/r/pulls/7$': { body: { user: { login: 'alice', id: 5 }, html_url: 'https://github.com/o/r/pull/7', body: '', ...one } },
      '^GET user/5$': { body: { id: 5, login: 'alice', created_at: iso(30) } },
      '^GET repos/o/r/pulls\\?state=all': { body: [] },
      '^GET repos/o/r/issues/7/events': ev,
      ...more,
    }
    const r = runStep('pr-gate.yml', step, { fix, env: { GH_TOKEN: 'app', READ_TOKEN: 'read', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', APP_SLUG: 'bot', GITHUB_OUTPUT: o }, cwd })
    return { r, out: fs.readFileSync(o, 'utf8') }
  }
  const side = pr({ number: 8, base: { ref: 'submission/5' } })
  // 产物里写的是 8（PR 能改检查）、同一个来源还有个往 submission/5 合的 #8：结论给往 main 合的 #7
  const ok = go({ body: [side, pr()] })
  assert.equal(ok.r.code, 0, ok.r.out)
  assert.match(ok.out, /^number=7$/m)
  assert.match(ok.out, /^mheld=false$/m)
  assert.ok(!ok.r.calls.some((c) => c.route.includes('/pulls/8')))
  // 维护者挂起着：交给闸门（卡上照实写）
  assert.match(go({ body: [pr()] }, pr({ labels: [{ name: 'checks: pass' }, { name: 'held: maintainer' }] })).out, /^mheld=true$/m)
  // 被关过又重开了：谁关的都算（作者先自己关了、维护者再 /reject 时机器人不会再关一次）；
  //   机器人代开的还看投稿的 issue（作者重开 issue 再改会开出新号的 PR）；事件记录查不到、读不出来就失败
  assert.match(ok.out, /^reop=false$/m)
  const closed = (id, t = '2026-11-12T00:00:00Z') => ({ event: 'closed', actor: { id, login: `u${id}` }, created_at: t })
  const other = { pages: [[{ event: 'labeled', actor: { id: 1 }, created_at: '2026-11-11T00:00:00Z' }], [closed(99), { event: 'reopened', actor: { id: 5 }, created_at: '2026-11-12T01:00:00Z' }]] }
  assert.match(go({ body: [pr()] }, pr(), '8', other).out, /^reop=true$/m) // 第二页才有，也认
  assert.match(go({ body: [pr()] }, pr(), '8', { body: [closed(5)] }).out, /^reop=true$/m) // 作者自己关的也算
  const botPr = pr({ user: { login: 'bot[bot]', id: 99 }, body: 'x\nSubmitted-by: alice (5)\nSubmission: https://github.com/o/r/issues/3' })
  const iss3 = (ev) => ({ '^GET repos/o/r/issues/3/events': ev })
  assert.match(go({ body: [pr()] }, botPr, '8', { body: [closed(99)] }).out, /^reop=true$/m)
  assert.match(go({ body: [pr()] }, botPr, '8', { body: [] }, iss3({ body: [closed(5)] })).out, /^reop=true$/m) // 新号的 PR，投稿 issue 关过
  assert.match(go({ body: [pr()] }, botPr, '8', { body: [] }, iss3({ body: [] })).out, /^reop=false$/m)
  // 说明是 CRLF 换行（维护者在网页上改过）：照样认出投稿人和投稿 issue
  const crlf = go({ body: [pr()] }, pr({ user: { login: 'bot[bot]', id: 99 }, body: 'x\r\nSubmitted-by: alice (5)\r\nSubmission: https://github.com/o/r/issues/3\r\n' }), '8', { body: [] }, iss3({ body: [] }))
  assert.equal(crlf.r.code, 0, crlf.r.out)
  assert.match(crlf.out, /^login=alice$/m)
  assert.match(crlf.out, /^id=5$/m)
  assert.match(crlf.out, /^submission=https:\/\/github\.com\/o\/r\/issues\/3$/m)
  for (const [ev, more] of [[{ code: 1 }, {}], [{ body: { message: 'x' } }, {}], [{ body: [{ event: 'closed', actor: { id: 9 } }] }, {}]]) {
    const x = go({ body: [pr()] }, pr(), '8', ev, more)
    assert.notEqual(x.r.code, 0, JSON.stringify(ev))
    assert.doesNotMatch(x.out, /^number=/m)
  }
  for (const [one, more] of [[botPr, iss3({ code: 1 })], [pr({ user: { login: 'bot[bot]', id: 99 }, body: 'Submitted-by: alice (5)' }), {}]]) {
    const x = go({ body: [pr()] }, one, '8', { body: [] }, more)
    assert.notEqual(x.r.code, 0, x.r.out) // 投稿 issue 查不到、读不出是哪个：失败
  }
  // 只有往别的分支合的、来源对不上的（别的分支、别的仓库、别的提交）：跳过，什么都不算
  for (const list of [[side], [pr({ head: { sha: SHA, ref: 'submission/9', repo: { node_id: 'R_o' } } })], [pr({ head: { sha: SHA, ref: 'submission/7', repo: { node_id: 'R_eve' } } })], [pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { node_id: 'R_o' } } })], []]) {
    const x = go({ body: list })
    assert.equal(x.r.code, 0, x.r.out)
    assert.equal(x.out.trim(), 'skip=true', JSON.stringify(list))
    assert.ok(!x.r.calls.some((c) => /pulls\/\d+$/.test(c.route)))
  }
  // 列表之后单个 PR 变了（关了、有新提交、改成往别的分支合、来源变了）：跳过
  for (const one of [{ state: 'closed' }, { head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { node_id: 'R_o' } } }, { base: { ref: 'dev' } }, { head: { sha: SHA, ref: 'x', repo: { node_id: 'R_o' } } }]) {
    const x = go({ body: [pr()] }, pr(one))
    assert.equal(x.r.code, 0, x.r.out)
    assert.equal(x.out.trim(), 'skip=true', JSON.stringify(one))
  }
  // 单个 PR 读出来缺字段（状态、提交、来源、作者）：失败（交给 incomplete），不能当成「PR 变了」悄悄跳过
  for (const one of [{ state: null }, { state: 'weird' }, { head: { sha: SHA, repo: { node_id: 'R_o' } } }, { head: { sha: SHA, ref: 'submission/7', repo: {} } }, { head: { sha: 'xyz', ref: 'submission/7', repo: { node_id: 'R_o' } } }, { base: {} }, { user: undefined }, { user: { login: 'alice' } }, { user: { id: 5 } }]) {
    const x = go({ body: [pr()] }, pr(one))
    assert.notEqual(x.r.code, 0, JSON.stringify(one))
    assert.equal(x.out, '', JSON.stringify(one))
  }
  // 列表读坏了、查不到：失败（不能当成没有 PR）
  for (const list of [{ code: 1 }, { body: { message: 'x' } }, { body: [{ title: 'no number' }] }]) {
    const x = go(list)
    assert.notEqual(x.r.code, 0, JSON.stringify(list))
    assert.equal(x.out, '')
  }
  // GitHub 给的号不对（不是正整数）：失败
  const bad = go({ body: [pr()] }, pr({ number: '07' }))
  assert.notEqual(bad.r.code, 0)
})

test('重跑：转草稿报错、又一直查不到实际样子（不知道转没转成）——当成转了去标回，最后请维护者确认，算失败；不能把 PR 留成草稿', { skip: SKIP }, () => {
  const lost = { '^GET repos/o/r/pulls/7$': { body: pr(), codes: [0, 0, 1, 1, 1, 1, 1, 1] } }
  // 不知道转没转成、是谁转的：不去标回（可能是作者自己的草稿），@ 维护者看一眼，算失败
  const r = runInc({ fix: baseFix({ ...lost, 'graphql:convertPullRequestToDraft': { codes: [1, 1, 1] } }), env: incEnv() })
  assert.equal(r.code, 1, r.out)
  assert.deepEqual(acts(r), ['comment', RERUN[0], RERUN[0], RERUN[0], 'comment'])
  assert.match(r.calls.filter((c) => c.args[1] === 'comment').pop().file, /^<!-- dsh-gallery-stuck -->\n@OrderG-X .*查不到 PR 有没有转成草稿/)
  // 转成了、标回一直报错（又查不到）：试 3 回，@ 说标不回
  const r2 = runInc({ fix: baseFix({ ...lost, 'graphql:markPullRequestReadyForReview': { codes: [1, 1, 1] } }), env: incEnv() })
  assert.equal(r2.code, 1, r2.out)
  assert.deepEqual(acts(r2), ['comment', RERUN[0], RERUN[1], RERUN[1], RERUN[1], 'comment'])
  assert.match(r2.calls.filter((c) => c.args[1] === 'comment').pop().file, /Ready for review/)
  // 前两回查不到、最后一回查到了「不是草稿、提交没变」：确实没转成 → 说转草稿没成功，不去标回
  const known = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: pr(), codes: [0, 0, 1, 1, 0] }, 'graphql:convertPullRequestToDraft': { codes: [1, 1, 1] } }), env: incEnv() })
  assert.equal(known.code, 1, known.out)
  assert.deepEqual(acts(known), ['comment', RERUN[0], RERUN[0], RERUN[0], 'comment'])
  assert.match(known.calls.filter((c) => c.args[1] === 'comment').pop().file, /转草稿没成功/)
})

test('重跑：转草稿报错后查到是草稿——看时间线是谁转的：机器人转的就标回；作者（别人）自己转的不替他标回；时间线查不到、对不上就算说不准', { skip: SKIP }, () => {
  const drafty = { '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ draft: true })] }, 'graphql:convertPullRequestToDraft': { codes: [1] } }
  const tl = (events) => ({ '^GET repos/o/r/issues/7/timeline': { body: events.map(([event, login]) => ({ event, actor: { login } })) } })
  const bot = runInc({ fix: baseFix({ ...drafty, ...tl([['convert_to_draft', 'bot[bot]']]) }), env: incEnv() })
  assert.equal(bot.code, 0, bot.out)
  assert.deepEqual(acts(bot), ['comment', RERUN[0], RERUN[1]])
  for (const events of [[['convert_to_draft', 'alice']], [['convert_to_draft', 'bot[bot]'], ['ready_for_review', 'bot[bot]'], ['convert_to_draft', 'alice']]]) {
    const other = runInc({ fix: baseFix({ ...drafty, ...tl(events) }), env: incEnv() })
    assert.equal(other.code, 0, other.out)
    assert.deepEqual(acts(other), ['comment', RERUN[0]], JSON.stringify(events))
    assert.match(other.out, /不替他标回/)
    assert.ok(other.calls.find((c) => c.route.includes('/timeline')).args.includes('--paginate'))
  }
  // 是草稿、时间线最后却是「标回」（对不上）或查不到时间线：说不准，3 回都这样就不标回、@ 维护者
  for (const t of [tl([['ready_for_review', 'bot[bot]']]), { '^GET repos/o/r/issues/7/timeline': { code: 1 } }]) {
    const odd = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ draft: true })] }, 'graphql:convertPullRequestToDraft': { codes: [1, 1, 1] }, ...t }), env: incEnv() })
    assert.equal(odd.code, 1, odd.out)
    assert.deepEqual(acts(odd), ['comment', RERUN[0], RERUN[0], RERUN[0], 'comment'])
    assert.match(odd.calls.filter((c) => c.args[1] === 'comment').pop().file, /查不到 PR 有没有转成草稿/)
  }
})

test('重跑：PR 读出来缺字段（state / draft / head 不对）——当成查不到，失败、不动', { skip: SKIP }, () => {
  for (const junk of [{ ...pr(), draft: undefined }, { ...pr(), state: null }, { ...pr(), head: {} }]) {
    const r = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), junk] } }), env: incEnv() })
    assert.equal(r.code, 1, r.out)
    // 试 3 回还是读不出来：@ 维护者（卡上说了会自动重跑，不能悄悄断掉）
    assert.deepEqual(acts(r), ['comment', 'comment'], JSON.stringify(junk))
    assert.match(r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment').pop().file, /^<!-- dsh-gallery-stuck -->\n@OrderG-X 机器人要重跑这个投稿的检查，却一直查不到这个 PR/)
    assert.equal(r.calls.filter((c) => c.route === 'GET repos/o/r/pulls/7').length, 4)
    assert.match(r.out, /查不到这个 PR/)
  }
  // 等 mergeable 算出来的时候一直读不出来：也 @ 维护者
  const mid = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), { ...pr(), mergeable: null }, {}], codes: [0, 0, 1] } }), env: incEnv() })
  assert.equal(mid.code, 1, mid.out)
  assert.deepEqual(acts(mid), ['comment', 'comment'])
  assert.match(mid.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment').pop().file, /一直查不到这个 PR/)
  // 偶尔读不出来一回：再试就好了，照常重跑
  //   （贴卡那一步一开始就读不出来：试 3 回，还是不行 @ 维护者、这步失败；读出来了照常）
  const cardFail = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { code: 1 } }), env: incEnv() })
  assert.equal(cardFail.code, 1, cardFail.out)
  assert.deepEqual(acts(cardFail), ['comment'])
  assert.match(cardFail.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment')[0].file, /^<!-- dsh-gallery-stuck a{40} -->\n@OrderG-X 这个投稿的检查没跑完，机器人又一直查不到这个 PR/)
  //   读得到但缺字段（一直缺）：也 @（不能把「读不出 state / head」当成关了、有新提交）
  const cardJunk = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { body: {} } }), env: incEnv() })
  assert.equal(cardJunk.code, 1, cardJunk.out)
  assert.deepEqual(acts(cardJunk), ['comment'])
  assert.match(cardJunk.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment')[0].file, /一直查不到这个 PR/)
  const cardOnce = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [{}, pr()], codes: [1, 0] } }), env: incEnv() })
  assert.equal(cardOnce.code, 0, cardOnce.out)
  assert.deepEqual(acts(cardOnce), ['comment', RERUN[0], RERUN[1]])
  const once = runInc({ fix: baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), {}, pr()], codes: [0, 1, 0] } }), env: incEnv() })
  assert.equal(once.code, 0, once.out)
  assert.deepEqual(acts(once), ['comment', RERUN[0], RERUN[1]])
})

test('重跑：「重跑没成」的 @ 同一个 PR 24 小时内只发一次（定时任务每 6 小时会再来）；只认机器人自己发的', { skip: SKIP }, () => {
  const old = (hoursAgo, who = 'bot[bot]', body = '<!-- dsh-gallery-stuck -->\n@OrderG-X …') => ({ id: 9, user: { login: who }, created_at: iso(hoursAgo / 24), body })
  const stucks = (comments) => {
    const r = runInc({ fix: baseFix({ 'graphql:convertPullRequestToDraft': { codes: [1, 1, 1] }, '^GET repos/o/r/issues/7/comments$': { body: comments } }), env: incEnv() })
    assert.equal(r.code, 1, r.out)
    return r.calls.filter((c) => c.args[1] === 'comment' && /^<!-- dsh-gallery-stuck -->/.test(c.file)).length
  }
  assert.equal(stucks([]), 1)
  assert.equal(stucks([old(2)]), 0)
  assert.equal(stucks([old(30)]), 1)
  assert.equal(stucks([old(2, 'evil')]), 1)
  assert.equal(stucks([old(2, 'bot[bot]', `<!-- dsh-gallery-stuck ${SHA} -->\n@OrderG-X …`)]), 1) // 「没跑完」那种不算这一类
})

// ───────── 装字体重试 ─────────

function fontsRun(failTimes) {
  const extra = {
    npm: '#!/bin/bash\nexit 0\n',
    timeout: '#!/bin/bash\nshift\nexec "$@"\n',
    sudo: '#!/bin/bash\nexec "$@"\n',
    'apt-get': `#!/bin/bash\nn=$(cat "$APT_N" 2>/dev/null || echo 0)\nfor a in "$@"; do if [ "$a" = update ]; then n=$((n+1)); echo $n > "$APT_N"; [ $n -le ${failTimes} ] && { echo "Temporary failure resolving" >&2; exit 100; }; fi; done\nexit 0\n`,
  }
  const n = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-apt-')), 'n')
  return runStep('pr-check.yml', '装依赖和中文字体', { env: { APT_N: n }, extra })
}

test('装中文字体：断网就等一会儿再来，一共 3 回；3 回都不行才失败、说清不是投稿的问题', { skip: SKIP }, () => {
  const ok = fontsRun(0)
  assert.equal(ok.code, 0, ok.out)
  assert.deepEqual(ok.sleeps, [])
  const twice = fontsRun(2)
  assert.equal(twice.code, 0, twice.out)
  assert.deepEqual(twice.sleeps, ['60', '120'])
  const bad = fontsRun(3)
  assert.equal(bad.code, 1, bad.out)
  assert.deepEqual(bad.sleeps, ['60', '120'])
  assert.match(bad.out, /::error::装中文字体试了 3 回都没成功：GitHub 机器网络的问题，不是投稿的问题/)
})

// ───────── 挂起复查 ─────────

const HELD_STEP = '挂起的：能接着走了（账号满 7 天、数量回到上限以内）就重跑检查；挂起 14 天没动静的列出来'
function heldRun(pulls, { users = {}, overrides = null, fresh = {}, after = {}, ready = [0], more = {}, scripts, sub } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-held-'))
  fs.mkdirSync(path.join(cwd, 'policy'))
  if (overrides) fs.writeFileSync(path.join(cwd, 'policy/trust-overrides.json'), JSON.stringify(overrides))
  const fix = {
    '^GET repos/o/r/pulls\\?state=open': { body: pulls },
    '^GET repos/o/r/pulls\\?state=all': { body: pulls },
    'graphql:markPullRequestReadyForReview': { codes: ready },
    '^graphql:': { body: {} },
    '^GET repos/o/r/issues/\\d+/timeline': { body: [] },
    '^GET repos/o/r/issues/\\d+/comments': { body: [] },
    '^pr comment$': {},
    '^pr close$': {},
    ...more,
  }
  // recheck.sh 动手前再查的那一次：默认和列表里一样，fresh 里给了就用新的（模拟列表之后被维护者关了、改了标签）
  // after：转了草稿以后再查看到的样子
  for (const p of pulls) {
    const now = { node_id: `PR_${p.number}`, draft: false, mergeable: true, ...p, ...(fresh[p.number] || {}) }
    // fresh 里给 null：单独查这个 PR 报错
    fix[`^GET repos/o/r/pulls/${p.number}$`] = fresh[p.number] === null ? { code: 1 } : after[p.number] ? { bodies: [now, { ...now, ...after[p.number] }] } : { body: now }
  }
  // 账号按数字 id 查（机器人代开的按 Submitted-by 行里的 id）
  for (const p of pulls) {
    const m = /^Submitted-by: ([A-Za-z0-9-]+) \((\d+)\)$/m.exec(p.body || '')
    const [login, id] = p.user && p.user.login === 'bot[bot]' ? (m ? [m[1], Number(m[2])] : []) : [p.user && p.user.login, p.user && p.user.id]
    if (login in users) fix[`^GET user/${id}$`] = { body: { id, login, created_at: users[login] } }
  }
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  const r = runStep('scheduled.yml', HELD_STEP, { fix, env: { GH_TOKEN: 'app', APP_SLUG: 'bot', GITHUB_REPOSITORY_OWNER: 'OrderG-X', GITHUB_OUTPUT: o }, cwd, scripts, sub })
  // 交给 close-stale 的「要关的」（没写就是 null）
  const line = fs.readFileSync(o, 'utf8').split('\n').find((l) => l.startsWith('close='))
  return { ...r, close: line ? JSON.parse(line.slice(6)) : null }
}

const held = (n, labels, user, over = {}) => ({ number: n, state: 'open', labels: [].concat(labels).map((name) => ({ name })), user, body: '', updated_at: iso(1), created_at: iso(3), head: { sha: String(n).repeat(40).slice(0, 40) }, ...over })
const heldActs = (r) => r.calls.filter((c) => c.args[0] === 'pr' || c.route.startsWith('graphql:')).map((c) => (c.args[0] === 'pr' ? `${c.args[1]} ${c.args[2]}` : `${c.route.slice(8)} ${c.fields.find((f) => f.startsWith('id=')).slice(6)}`))

test('挂起复查：账号满 7 天的、机器人代投的投稿人满 7 天的重跑检查；不满的、维护者挂起的（含双标签）不动；14 天没动静的列出来交给 close-stale', { skip: SKIP }, () => {
  const pulls = [
    held(1, 'held: author', { login: 'old', id: 11 }),
    held(2, 'held: author', { login: 'new', id: 12 }),
    held(3, 'held: author', { login: 'bot[bot]', id: 99 }, { body: 'x\nSubmitted-by: old2 (13)\n' }),
    held(4, 'held: maintainer', { login: 'old', id: 11 }),
    held(5, 'held: author', { login: 'new', id: 12 }, { updated_at: iso(15) }),
    held(6, ['held: author', 'held: maintainer'], { login: 'old', id: 11 }),
  ]
  const r = heldRun(pulls, { users: { old: iso(30), new: iso(2), old2: iso(8) } })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(heldActs(r), [`${RERUN[0]} 1`, `${RERUN[1]} 1`, `${RERUN[0]} 3`, `${RERUN[1]} 3`]) // 这里不关
  assert.ok(!r.calls.some((c) => c.route === 'GET repos/o/r/pulls/6' || c.route === 'GET repos/o/r/pulls/4')) // 维护者挂起的连查都不查
  assert.deepEqual(r.close, [{ n: 5, upd: pulls[4].updated_at }])
  // 没有要关的：交空列表（close-stale 就不跑）；一回最多交 50 个
  assert.deepEqual(heldRun([held(1, 'held: author', { login: 'new', id: 12 })], { users: { new: iso(2) } }).close, [])
  const many = heldRun(Array.from({ length: 60 }, (_, i) => held(i + 1, 'held: author', { login: 'new', id: 12 }, { updated_at: iso(15) })), { users: { new: iso(2) } })
  assert.equal(many.close.length, 50)
  // 后面出错、整个任务算失败也照样交（失败前写的）
  const failing = heldRun([held(5, 'held: author', { login: 'new', id: 12 }, { updated_at: iso(15) }), held(1, 'held: author', { login: 'gone', id: 13 })], { more: { '^GET user/13$': { code: 1 } } })
  assert.equal(failing.code, 1, failing.out)
  assert.deepEqual(failing.close.map((x) => x.n), [5])
  // 机器人代开的说明是 CRLF 换行：照样认出投稿人
  const crlfHeld = heldRun([held(3, 'held: author', { login: 'bot[bot]', id: 99 }, { body: 'x\r\nSubmitted-by: old2 (13)\r\n' })], { users: { old2: iso(8) } })
  assert.equal(crlfHeld.code, 0, crlfHeld.out)
  assert.deepEqual(heldActs(crlfHeld), [`${RERUN[0]} 3`, `${RERUN[1]} 3`])
  // 要关的先交出去，再一个个重跑（重跑要等 GitHub 算冲突，任务超时也不耽误关）
  assert.ok(r.out.indexOf('#5 挂起 14 天没动静') < r.out.indexOf('#1 能接着走了'), r.out)
  // 重跑只在开头 7 分钟内起头：时间不够了，剩下的下一轮再重跑，不算失败（要关的照交）
  const late = heldRun(pulls, { users: { old: iso(30), new: iso(2), old2: iso(8) }, sub: { '-ge 420 ]': '-ge 0 ]' } })
  assert.equal(late.code, 0, late.out)
  assert.deepEqual(heldActs(late), [])
  assert.match(late.out, /#1 能接着走了，但这一轮时间不够了/)
  assert.deepEqual(late.close, [{ n: 5, upd: pulls[4].updated_at }])
  assert.match(fs.readFileSync(path.join(REAL, '.github/workflows/scheduled.yml'), 'utf8'), /\n  recheck-held:\n    runs-on: ubuntu-24\.04\n(    #.*\n)*    timeout-minutes: 15\n/)
  // close-stale：一个 PR 一个任务、排这个 PR 的队；没有要关的不跑；前一个 job 失败也跑
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/scheduled.yml'), 'utf8')
  const job = y.slice(y.indexOf('\n  close-stale:\n'))
  assert.match(job, /^\n  close-stale:\n    needs: recheck-held\n    if: \$\{\{ !cancelled\(\) && needs\.recheck-held\.outputs\.close != '' && needs\.recheck-held\.outputs\.close != '\[\]' \}\}\n/)
  assert.match(job, /\n      fail-fast: false\n      matrix:\n        pr: \$\{\{ fromJSON\(needs\.recheck-held\.outputs\.close\) \}\}\n    concurrency:\n      group: dsh-pr-\$\{\{ matrix\.pr\.n \}\}\n      cancel-in-progress: false\n      queue: max\n/)
  assert.match(y, /\n    outputs:\n      close: \$\{\{ steps\.held\.outputs\.close \}\}\n/)
})

test('挂起复查：列表取完后维护者 /reject 了、/hold 了、作者推了新提交、闸门已经放行——动手前再查一遍，不碰', { skip: SKIP }, () => {
  const races = [{ state: 'closed' }, { labels: [{ name: 'held: author' }, { name: 'held: maintainer' }] }, { head: { sha: 'f'.repeat(40) } }, { labels: [{ name: 'checks: pass' }] }, { draft: true }]
  for (const change of races) {
    const r = heldRun([held(1, 'held: author', { login: 'old', id: 11 })], { users: { old: iso(30) }, fresh: { 1: change } })
    assert.equal(r.code, 0, r.out)
    assert.ok(r.calls.some((c) => c.route === 'GET repos/o/r/pulls/1'), '要重查') // 真走到了 recheck.sh
    assert.deepEqual(heldActs(r), [], JSON.stringify(change))
  }
  // 对照：没变就会重跑
  const same = heldRun([held(1, 'held: author', { login: 'old', id: 11 })], { users: { old: iso(30) } })
  assert.deepEqual(heldActs(same), [`${RERUN[0]} 1`, `${RERUN[1]} 1`])
})

test('挂起复查：/trust 过的（按数字 id）放；账号够了但数量还超的不放，降下来就放', { skip: SKIP }, () => {
  const t = heldRun([held(1, 'held: author', { login: 'new', id: 12 })], { users: { new: iso(1) }, overrides: { new: { tier: 'T2', id: 12 } } })
  assert.deepEqual(heldActs(t), [`${RERUN[0]} 1`, `${RERUN[1]} 1`])
  const wrongId = heldRun([held(1, 'held: author', { login: 'new', id: 12 })], { users: { new: iso(1) }, overrides: { new: { tier: 'T2', id: 77 } } })
  assert.deepEqual(heldActs(wrongId), [])
  const u = { login: 'busy', id: 21 }
  const over = heldRun([1, 2, 3, 4].map((n) => held(n, n === 1 ? 'held: author' : 'held: limit', u)), { users: { busy: iso(100) } })
  assert.equal(over.code, 0, over.out)
  assert.deepEqual(heldActs(over), []) // 在等 4 个 > 3：账号挂起的那个也不放
  const fewer = heldRun([held(1, 'held: limit', u, { created_at: iso(2) })], { users: { busy: iso(100) } })
  assert.deepEqual(heldActs(fewer), [`${RERUN[0]} 1`, `${RERUN[1]} 1`])
})

test('挂起复查：标不回「可以审了」就 @ 维护者，接着处理下一个，最后整个任务算失败', { skip: SKIP }, () => {
  const u = { login: 'old', id: 11 }
  const r = heldRun([held(1, 'held: author', u), held(2, 'held: author', u)], { users: { old: iso(30) }, ready: [1, 1, 1, 0], after: { 1: { draft: true } } })
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /::error::/)
  assert.deepEqual(heldActs(r), [`${RERUN[0]} 1`, `${RERUN[1]} 1`, `${RERUN[1]} 1`, `${RERUN[1]} 1`, 'comment 1', `${RERUN[0]} 2`, `${RERUN[1]} 2`])
  assert.match(r.calls.find((c) => c.args[1] === 'comment').file, /^<!-- dsh-gallery-stuck -->\n@OrderG-X /)
})

test('每周清理截图分支：只留开着的 PR 的目录（审核卡还在用）；列不出开着的 PR 就不清；还没有这个分支也行', { skip: SKIP }, () => {
  const STEP = '清理截图分支（只留开着的 PR 的）'
  const REMOTE = 'https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git'
  const setup = (dirs) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-shots-'))
    const bare = path.join(work, 'r.git')
    gitIn(work, 'init', '-q', '--bare', bare)
    if (dirs.length) {
      const seed = path.join(work, 'seed')
      gitIn(work, 'init', '-q', seed)
      for (const d of dirs) { fs.mkdirSync(path.join(seed, d, '100'), { recursive: true }); fs.writeFileSync(path.join(seed, d, '100/a.jpg'), d) }
      gitIn(seed, 'add', '.')
      gitIn(seed, 'commit', '-qm', 'shots')
      gitIn(seed, 'push', '-q', bare, 'HEAD:refs/heads/review-shots')
    }
    return bare
  }
  const tree = (bare) => gitIn(bare, 'ls-tree', '-r', '--name-only', 'review-shots').split('\n').filter(Boolean)
  const go = (bare, list) => runStep('scheduled.yml', STEP, { fix: { '^pr list$': list }, env: { TOKEN: 't', GH_TOKEN: 't' }, sub: { [REMOTE]: bare } })
  const bare = setup(['3', '9', '12'])
  const r = go(bare, { body: [{ number: 3 }, { number: 12 }, { number: 40 }] })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(tree(bare), ['12/100/a.jpg', '3/100/a.jpg'])
  // 列不出开着的 PR：不清
  const keep = setup(['3', '9'])
  const k = go(keep, { code: 1 })
  assert.equal(k.code, 0, k.out)
  assert.deepEqual(tree(keep), ['3/100/a.jpg', '9/100/a.jpg'])
  // 还没有这个分支：建一个空的
  const none = setup([])
  const n = go(none, { body: [{ number: 3 }] })
  assert.equal(n.code, 0, n.out)
  assert.deepEqual(tree(none), [])
})

test('close-stale：轮到了（排在这个 PR 的队里）再单独查一遍——这期间有人动过、被关了、不挂了就不关；查不到、读不出来就失败、不关', { skip: SKIP }, () => {
  const upd = iso(15)
  const stale = (over = {}) => held(5, 'held: author', { login: 'new', id: 12 }, { updated_at: upd, ...over })
  const go = (res, n = '5', close = {}, comment = {}) => runStep('scheduled.yml', '再查一遍，没动静就关', { fix: { '^GET repos/o/r/pulls/5$': res, '^pr close$': close, '^pr comment$': comment }, env: { GH_TOKEN: 'app', N: n, UPD: upd } })
  const closes = (r) => r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'close')
  const ok = (over = {}) => ({ bodies: [stale(over), { state: 'closed' }] })
  const base = go(ok())
  assert.equal(base.code, 0, base.out)
  assert.equal(closes(base).length, 1)
  // 先关、核实关上了再说（不带 --comment：gh 会先评论再关，评论刷新了「最后动静」、关失败就又要等 14 天）
  assert.ok(!closes(base)[0].args.includes('--comment') && closes(base)[0].args.includes('5'))
  assert.deepEqual(base.calls.filter((c) => c.args[0] === 'pr').map((c) => c.args[1]), ['close', 'comment'])
  assert.equal(closes(go(ok({ labels: [{ name: 'held: limit' }] }))).length, 1)
  // 关失败、关了还开着：失败，不评论
  for (const [res, close] of [[ok(), { code: 1 }], [{ bodies: [stale(), { state: 'open' }] }, {}]]) {
    const r = go(res, '5', close)
    assert.notEqual(r.code, 0, r.out)
    assert.ok(!r.calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'comment'))
  }
  // 关上了、说明发不出去：再试一次，还不行只记警告（PR 已经关了，不算失败）
  const mute = go(ok(), '5', {}, { code: 1 })
  assert.equal(mute.code, 0, mute.out)
  assert.equal(mute.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'comment').length, 2)
  assert.match(mute.out, /::warning::#5 关上了，但说明没发出去/)
  const once = go(ok(), '5', {}, { codes: [1, 0] })
  assert.equal(once.code, 0, once.out)
  assert.ok(!/::warning::/.test(once.out))
  for (const change of [{ updated_at: iso(0) }, { state: 'closed' }, { labels: [{ name: 'checks: pass' }] }]) {
    const r = go({ body: stale(change) })
    assert.equal(r.code, 0, r.out)
    assert.equal(closes(r).length, 0, JSON.stringify(change))
  }
  for (const bad of [{ code: 1 }, { body: stale({ labels: null }) }, { body: stale({ updated_at: null }) }]) {
    const r = go(bad)
    assert.notEqual(r.code, 0, JSON.stringify(bad))
    assert.equal(closes(r).length, 0)
  }
  const junkN = go({ body: stale() }, '05')
  assert.notEqual(junkN.code, 0)
  assert.equal(junkN.calls.length, 0)
})

// ───────── 维护者 /approve ─────────

// pr-check 跑过的：默认一回、早就跑完了（闸门检查在它之后写的）
const CHECK_DONE = { body: { workflow_runs: [{ id: 100, status: 'completed', run_attempt: 1 }] } }
// 维护者发 /approve 的时间和评论 id；/approve 写的提交号（默认就是现在的 SHA）；这条评论之后的评论（看有没有 /hold）
const SINCE = '2026-11-13T01:00:00Z'
function approve({ views, checks, merge = {}, extra, runs = CHECK_DONE, want = SHA, later = [], more = {}, main } = {}) {
  const cwd = withBase(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-approve-')))
  if (main) mainAdds(cwd, main)
  const v = { headRefOid: SHA, headRefName: 'submission/7', headRepository: { id: 'R_o', name: 'r' }, baseRefName: 'main', isDraft: false, state: 'OPEN', body: 'x\nSubmission: https://github.com/o/r/issues/3', url: 'https://github.com/o/r/pull/7' }
  const fix = {
    'pr view': views ? { bodies: views.map((o) => ({ ...v, ...o })) } : { body: v },
    [`^GET repos/o/r/commits/${SHA}/check-runs`]: checks,
    '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs,
    '^GET repos/o/r/issues/7/comments\\?per_page=100$': { body: later },
    '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [] },
    'pr merge': merge,
    '^pr edit$': {},
    '^issue comment$': {},
    // 规矩版本（默认和检查里记的一样）；规矩变了会让检查重跑（scripts/recheck.sh：读 PR、转草稿再标回）
    ...POLICY_FIX,
    '^GET repos/o/r/pulls/7$': { body: pr() },
    '^graphql:': { body: { data: {} } },
    '^GET repos/o/r/issues/7/timeline': { body: [{ event: 'convert_to_draft', actor: { login: 'bot[bot]' } }] },
    '^GET repos/o/r/issues/7/comments$': { body: [] },
    '^GET repos/o/r/issues/7/events': { body: [] },
    '^GET repos/o/r/issues/3/events': { body: [] },
    '^GET repos/o/r/issues/comments/\\d+/reactions': { body: [] },
    '^pr comment$': {},
    ...more,
  }
  return runStep('chatops.yml', '合并（/approve）', { fix, env: { GH_TOKEN: 'app', READ_TOKEN: 'read', N: '7', ACTOR: 'maint', SINCE, COMMENT_ID: '500', ACTION_JSON: JSON.stringify({ action: 'merge', sha: want }), APP_ID: '42', APP_SLUG: 'bot' }, cwd, extra })
}
// 闸门写的检查：external_id 记着是哪一回 pr-check（默认就是 CHECK_DONE 那回：100/1）
const gateRuns = (...list) => ({ check_runs: list.map(([id, conclusion, status = 'completed', ext = `100/1/${PS}/${B12}`]) => ({ id, status, conclusion: status === 'completed' ? conclusion : null, external_id: ext })) })
const replies = (r) => r.calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'comment').map((c) => c.file)
const merges = (r) => r.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'merge')

test('/approve：只认机器人 App 自己写的、最新的那条 Submission gate；过了才合，合的就是查过的那一版', { skip: SKIP }, () => {
  const ok = approve({ checks: { body: gateRuns([5, 'success']) } })
  assert.equal(ok.code, 0, ok.out)
  assert.equal(merges(ok).length, 1)
  assert.ok(merges(ok)[0].args.includes('--match-head-commit') && merges(ok)[0].args.includes(SHA))
  assert.match(merges(ok)[0].args.join(' '), /Submission: https:\/\/github\.com\/o\/r\/issues\/3\nApproved-by: maint/)
  const q = ok.calls.find((c) => c.route.includes('/check-runs')).route
  assert.match(q, /check_name=Submission%20gate&app_id=42&/)
  assert.ok(ok.calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'edit' && c.args.includes('reviewed')))
  // 最新的一条（id 最大）说了算；在跑的、出错的、没有的都不合
  for (const [checks, word] of [[{ body: gateRuns([9, 'failure'], [5, 'success']) }, 'failure'], [{ body: gateRuns([5, 'success'], [9, null, 'in_progress']) }, 'pending'], [{ code: 1 }, 'error'], [{ body: gateRuns() }, 'none']]) {
    const r = approve({ checks })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 0, word)
    assert.match(replies(r)[0], new RegExp(`检查没过或还没跑完（${word}）`))
  }
  assert.equal(merges(approve({ checks: { body: gateRuns([5, 'failure'], [9, 'neutral']) } })).length, 1)
  // 分页：最新的那条在第二页
  const paged = approve({ checks: { pages: [gateRuns([5, 'success']), gateRuns([9, 'failure'])] } })
  assert.equal(merges(paged).length, 0)
})

test('/approve：等机器人把草稿标回来以后再核一遍——这期间检查变红、有新提交、关了、一直是草稿都不合', { skip: SKIP }, () => {
  // pr view 的调用顺序：取 head、取说明、等草稿（若干次）、核一遍
  const red = approve({ views: [{}, {}, { isDraft: true }, {}, {}], checks: { bodies: [gateRuns([5, 'success']), gateRuns([6, 'failure'], [5, 'success'])] } })
  assert.equal(red.code, 0, red.out)
  assert.equal(merges(red).length, 0)
  assert.match(replies(red)[0], /（failure）/)
  for (const after of [{ headRefOid: 'b'.repeat(40) }, { state: 'CLOSED' }]) {
    const r = approve({ views: [{}, {}, { isDraft: true }, {}, after], checks: { body: gateRuns([5, 'success']) } })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 0, JSON.stringify(after))
    assert.match(replies(r)[0], /PR 变了/)
  }
  const stuck = approve({ views: [{}, {}, { isDraft: true }], checks: { body: gateRuns([5, 'success']) } })
  assert.equal(stuck.code, 0, stuck.out)
  assert.equal(stuck.sleeps.length, 6)
  assert.equal(merges(stuck).length, 0)
  assert.match(replies(stuck)[0], /PR 变了/)
})

test('/approve：合并报错、其实合上了（响应丢了，合的就是批准的这一版）——当成合上了，记「审过」、摘挂起标签', { skip: SKIP }, () => {
  const gate = { body: gateRuns([5, 'success']) }
  const r = approve({ checks: gate, merge: { code: 1 }, more: { '^GET repos/o/r/pulls/7$': { body: { ...pr(), merged: true } } } })
  assert.equal(r.code, 0, r.out)
  assert.equal(merges(r).length, 1)
  assert.ok(r.calls.some((x) => x.args[0] === 'pr' && x.args[1] === 'edit' && x.args.includes('reviewed') && x.args.includes('held: maintainer')))
  // 合上的不是批准的这一版：不算，照旧再试
  const other = approve({ checks: gate, merge: { code: 1 }, more: { '^GET repos/o/r/pulls/7$': { body: { ...pr({ head: { sha: 'b'.repeat(40), ref: 'submission/7', repo: { full_name: 'o/r', node_id: 'R_o' } } }), merged: true } } } })
  assert.ok(!other.calls.some((x) => x.args[0] === 'pr' && x.args[1] === 'edit'))
  // 合并报错、紧接着的查询也出错；下一回再核时 PR 已经是 MERGED：先看是不是其实合上了（是批准的这一版）——当成合上了，不说「PR 变了」
  //   GET pulls/7 依次是：开头核挂起、第一回核挂起、核投稿 issue、合并报错后查（出错）、下一回看到 PR 变了再查
  //   pr view 依次是：开头看、读说明、第一回等草稿、第一回再核、合并之前最后看一眼、第二回等草稿、第二回再核
  const later = approve({ checks: gate, merge: { code: 1 }, views: [{}, {}, {}, {}, {}, { state: 'MERGED' }, { state: 'MERGED' }], more: { '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr(), {}, { ...pr(), merged: true }], codes: [0, 0, 0, 1, 0] } } })
  assert.equal(later.code, 0, later.out)
  assert.equal(merges(later).length, 1)
  assert.ok(later.calls.some((x) => x.args[0] === 'pr' && x.args[1] === 'edit' && x.args.includes('reviewed')), later.out)
  assert.deepEqual(replies(later), [])
  // 核到一半（查检查、挂起、投稿 issue 的时候）改成往别的分支合了：合并之前最后看一眼认出来，不合
  const retarget = approve({ checks: gate, views: [{}, {}, {}, {}, { baseRefName: 'submission/5' }] })
  assert.equal(retarget.code, 0, retarget.out)
  assert.equal(merges(retarget).length, 0)
  assert.match(replies(retarget)[0], /PR 变了/)
})

test('/approve：合并失败（刚好被转成了草稿）就从头核一遍再试，3 回都不行才说清楚、算失败', { skip: SKIP }, () => {
  const second = approve({ checks: { body: gateRuns([5, 'success']) }, merge: { codes: [1, 0] } })
  assert.equal(second.code, 0, second.out)
  assert.equal(merges(second).length, 2)
  assert.equal(second.calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'edit').length, 1)
  const never = approve({ checks: { body: gateRuns([5, 'success']) }, merge: { code: 1 } })
  assert.equal(never.code, 1, never.out)
  assert.equal(merges(never).length, 3)
  assert.ok(!never.calls.some((c) => c.args[0] === 'pr' && c.args[1] === 'edit')) // 没合上不打「审过」
  assert.match(replies(never)[0], /合并试了 3 回都没成功/)
})

test('/approve：只认最新那回 pr-check 算出来的闸门检查（external_id 对得上 run id/attempt）——在（重）跑、重跑完还没重算、旧回合后写的都不算；读 Actions 用 GITHUB_TOKEN', { skip: SKIP }, () => {
  const run = (status, run_attempt = 1, id = 100) => ({ id, status, run_attempt })
  const no = (checks, runs, word) => {
    const r = approve({ checks: { body: checks }, runs })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 0, JSON.stringify([checks, runs]))
    assert.match(replies(r)[0], new RegExp(`（${word}）`))
  }
  no(gateRuns([5, 'success']), { body: { workflow_runs: [run('in_progress', 2)] } }, 'pending') // 机器人刚转草稿再标回：重跑中
  no(gateRuns([5, 'success']), { body: { workflow_runs: [run('completed'), run('queued', 1, 101)] } }, 'pending') // 新的一回在排队
  no(gateRuns([5, 'success']), { body: { workflow_runs: [run('completed', 2)] } }, 'pending') // 重跑完了，闸门还没写这回的
  no(gateRuns([5, 'success']), { body: { workflow_runs: [run('in_progress')] } }, 'pending') // 最新那回还没跑完（哪怕记的就是它）
  no(gateRuns([5, 'success'], [6, 'success', 'completed', '-']), { body: { workflow_runs: [run('completed', 2)] } }, 'pending') // 没记 external_id 的（旧写法）不算
  no(gateRuns([5, 'success']), { pages: [{ workflow_runs: [run('completed')] }, { workflow_runs: [run('completed', 1, 101)] }] }, 'pending') // 新的那回在第二页
  no(gateRuns([5, 'success'], [9, 'failure']), CHECK_DONE, 'failure') // 同一回的闸门重跑过：取最新那条
  no(gateRuns([5, 'success'], [9, null, 'in_progress']), CHECK_DONE, 'pending')
  no(gateRuns([5, 'success']), { code: 1 }, 'error')
  no(gateRuns([5, 'success']), { body: { workflow_runs: [] } }, 'error')
  // 旧回合（99/1）后写的成功不算数，也不挡最新那回（100/2）自己的结论
  const late = approve({ checks: { body: gateRuns([5, 'failure', 'completed', '100/2'], [9, 'success', 'completed', '99/1']) }, runs: { body: { workflow_runs: [run('completed', 1, 99), run('completed', 2)] } } })
  assert.equal(merges(late).length, 0)
  assert.match(replies(late)[0], /（failure）/)
  const lateOk = approve({ checks: { body: gateRuns([5, 'success', 'completed', `100/2/${PS}/${B12}`], [9, 'failure', 'completed', '99/1']) }, runs: { body: { workflow_runs: [run('completed', 1, 99), run('completed', 2)] } } })
  assert.equal(merges(lateOk).length, 1)
  const ok = approve({ checks: { body: gateRuns([5, 'success']) } })
  assert.equal(merges(ok).length, 1)
  assert.match(fs.readFileSync(path.join(REAL, '.github/workflows/chatops.yml'), 'utf8'), /\n    permissions:\n      actions: read\n/)
  const ac = ok.calls.filter((c) => c.route.includes('/actions/'))
  assert.ok(ac.length && ac.every((c) => c.token === 'read' && c.args.includes('--paginate')))
  assert.ok(ac.some((c) => c.route.includes(`head_sha=${SHA}`)))
  // 等草稿标回的时候检查重跑了：再核那一下看到在跑，不合
  const mid = approve({ views: [{}, {}, { isDraft: true }, {}, {}], checks: { body: gateRuns([5, 'success']) }, runs: { bodies: [CHECK_DONE.body, { workflow_runs: [run('in_progress', 2)] }] } })
  assert.equal(mid.code, 0, mid.out)
  assert.equal(merges(mid).length, 0)
  assert.match(replies(mid)[0], /（pending）/)
})

test('/approve：只看这个 PR 的来源（来源仓库 + 分支）跑的 pr-check——别的 PR 指着同一个提交、跑得更晚、还在跑，都不挡；来源读不出来就不合', { skip: SKIP }, () => {
  const run = (status, id, over = {}) => ({ id, status, run_attempt: 1, ...over })
  for (const other of [{ head_branch: 'submission/8' }, { head_repository: { full_name: 'eve/r', node_id: 'R_eve' } }]) {
    const r = approve({ checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100), run('in_progress', 101, other)] } } })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 1, JSON.stringify(other))
  }
  // 对照：同一个来源的新一回在跑：不合
  const same = approve({ checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100), run('in_progress', 101)] } } })
  assert.equal(merges(same).length, 0)
  // fork 来的：按 fork 的仓库和分支认
  const fork = { headRefName: 'main', headRepository: { id: 'R_alice', name: 'r' } }
  // pr view：开头看、读说明、等草稿、再核、合并之前最后看一眼
  const fr = approve({ views: [fork, {}, {}, fork, fork], checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100, { head_branch: 'main', head_repository: { full_name: 'alice/r', node_id: 'R_alice' } }), run('in_progress', 101)] } } })
  assert.equal(fr.code, 0, fr.out)
  assert.equal(merges(fr).length, 1)
  // 只有别的来源跑过：当成查不到
  const none = approve({ checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100, { head_branch: 'x' })] } } })
  assert.equal(merges(none).length, 0)
  assert.match(replies(none)[0], /（error）/)
  // 来源仓库没了（fork 删了）、字段缺：不合
  for (const bad of [{ headRepository: null }, { headRefName: null }, { headRepository: { name: 'r' } }, { headRepository: { id: '' } }, { headRefOid: '' }, { headRefOid: 'x' }]) {
    const r = approve({ views: [bad], checks: { body: gateRuns([5, 'success']) } })
    assert.equal(r.code, 1, JSON.stringify(bad))
    assert.equal(merges(r).length, 0)
    assert.match(replies(r)[0], /查不到这个 PR/)
  }
})

test('维护者命令：先认人（不排队）；动手（apply）不排任何队、取消不了；/approve 的合并和 /hold、/untrust 的回话（confirm）排合并的队；被取消了另一个不排队的 job 说一声', () => {
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/chatops.yml'), 'utf8')
  const job = (name, next) => y.slice(y.indexOf(`\n  ${name}:\n`), next ? y.indexOf(`\n  ${next}:\n`) : undefined)
  const auth = job('auth', 'apply'), apply = job('apply', 'confirm'), confirm = job('confirm', 'cancelled'), canc = job('cancelled')
  assert.ok(y.indexOf('\n  auth:\n') < y.indexOf('\n  apply:\n') && y.indexOf('\n  apply:\n') < y.indexOf('\n  confirm:\n') && y.indexOf('\n  confirm:\n') < y.indexOf('\n  cancelled:\n'))
  // 入口只粗筛「评论里有 /」：和 chatops.mjs 的解析一样（命令可以在说明下面一行、前面有空格），不能比解析窄
  assert.match(auth, /\n  auth:\n    if: contains\(github\.event\.comment\.body, '\/'\) && github\.event\.comment\.user\.type != 'Bot'\n/)
  assert.match(auth, /\n    outputs:\n      ok: \$\{\{ steps\.who\.outputs\.ok \}\}\n/)
  assert.match(auth, /- name: 是不是维护者\n        id: who\n/)
  assert.doesNotMatch(auth, /actions\/checkout|npm ci|permissions:/)
  // 只有 confirm 排队（dsh-merge）；auth、apply、cancelled 都不排任何队（PR 里的工作流取消不了它们）
  for (const j of [auth, apply, canc]) assert.doesNotMatch(j, /concurrency:/)
  assert.match(confirm, /\n    concurrency:\n      group: dsh-merge\n      cancel-in-progress: false\n      queue: max\n/)
  assert.match(apply, /^\n  apply:\n    needs: auth\n    if: needs\.auth\.outputs\.ok == 'true'\n/)
  assert.match(confirm, /^\n  confirm:\n    needs: \[auth, apply\]\n    if: needs\.apply\.outputs\.action == 'merge' \|\| needs\.apply\.outputs\.action == 'hold' \|\| needs\.apply\.outputs\.action == 'untrust'\n/)
  // cancelled 也管 apply 在「照做」开始之前就失败了（准备的步骤出错）——再认人时确实不是维护者了的不管
  assert.match(canc, /^\n  cancelled:\n    needs: \[auth, apply, confirm\]\n(    #.*\n)*    if: always\(\) && needs\.auth\.outputs\.ok == 'true' && \(needs\.apply\.result == 'cancelled' \|\| needs\.confirm\.result == 'cancelled' \|\| \(needs\.apply\.result == 'failure' && needs\.apply\.outputs\.did != 'true' && needs\.apply\.outputs\.denied != 'true'\)\)\n/)
  assert.match(apply, /\n      did: \$\{\{ steps\.do\.outputs\.did \}\}\n/)
  assert.match(apply, /\n      denied: \$\{\{ steps\.reauth\.outputs\.denied \}\}\n/)
  assert.match(apply, /- name: 动手前再认一次人\n        id: reauth\n/)
  // 「照做」第一件事就是记下开始了（之后出错它自己回话）
  assert.match(apply, /- name: 照做\n        id: do\n[\s\S]*?run: \|\n          set -euo pipefail\n          echo "did=true" >> "\$GITHUB_OUTPUT"\n/)
  // apply 不装依赖（chatops.mjs 只用 node 自带的模块）：少一个会失败的准备步骤
  assert.doesNotMatch(apply, /npm (ci|install)/)
  for (const f of ['scripts/chatops.mjs', 'scripts/lib/repo.mjs']) {
    const src = fs.readFileSync(path.join(REAL, f), 'utf8')
    for (const m of src.matchAll(/^import .* from '([^']+)'/gm)) assert.ok(m[1].startsWith('node:') || m[1].startsWith('.'), `${f}: ${m[1]}`)
  }
  // 合并只在 confirm 里；改规矩、打 hold 标签只在 apply 里
  assert.equal((y.match(/gh pr merge/g) || []).length, 1)
  assert.ok(confirm.includes('gh pr merge'))
  assert.ok(apply.includes("--add-label 'held: maintainer'") && !confirm.includes("--add-label 'held: maintainer'"))
  assert.ok(apply.includes('git push') && !confirm.includes('git push'))
  // 再认人：apply 动手前、confirm 合并前（App token 之后、checkout 之前）
  for (const [j, name] of [[apply, '动手前再认一次人'], [confirm, '轮到了再认一次人']]) {
    const at = j.indexOf(`- name: ${name}`)
    assert.ok(at > j.indexOf('create-github-app-token') && at < j.indexOf('actions/checkout'), name)
  }
  assert.match(confirm, /- name: 轮到了再认一次人\n        if: needs\.apply\.outputs\.action == 'merge'\n/)
  // 都检出 main 现在的样子；confirm 要完整历史（比同名的设计）
  assert.match(apply, /actions\/checkout@v4\n        with:\n          ref: main\n/)
  assert.match(confirm, /actions\/checkout@v4\n        with:\n          ref: main\n          fetch-depth: 0\n/)
  assert.match(confirm, /\n    permissions:\n      actions: read\n/)
  assert.doesNotMatch(apply + canc, /permissions:/)
  assert.match(y, /\npermissions: \{\}\n/)
})

test('挂起复查：查投稿人账号出错、算放不放出错或输出不对——记失败、接着处理下一个；账号没了（404）不算失败', { skip: SKIP }, () => {
  const u = { login: 'old', id: 11 }
  const two = [held(1, 'held: author', { login: 'gone', id: 12 }), held(2, 'held: author', u)]
  const err = heldRun(two, { users: { old: iso(30) }, more: { '^GET user/12$': { code: 1 } } })
  assert.equal(err.code, 1, err.out)
  assert.deepEqual(heldActs(err), [`${RERUN[0]} 2`, `${RERUN[1]} 2`])
  const gone = heldRun(two, { users: { old: iso(30) }, more: { '^GET user/12$': { code: 1, stderr: 'gh: Not Found (HTTP 404)\n' } } })
  assert.equal(gone.code, 0, gone.out)
  assert.deepEqual(heldActs(gone), [`${RERUN[0]} 2`, `${RERUN[1]} 2`])
  // 按 id 查到的账号对不上（接口给了别人）：记失败、不动它
  const mis = heldRun([held(1, 'held: author', u)], { more: { '^GET user/11$': { body: { id: 99, created_at: iso(30) } } } })
  assert.equal(mis.code, 1, mis.out)
  assert.deepEqual(heldActs(mis), [])
  for (const gate of ['process.exit(3)\n', 'console.log("ready=x")\n']) {
    const r = heldRun([held(1, 'held: author', u)], { users: { old: iso(30) }, scripts: { 'gate.mjs': gate } })
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(heldActs(r), [])
  }
})

test('挂起复查：自动重跑有上限——一周内转了 3 回草稿（或重跑没成 @ 过，加起来 3 回）还挂着就停、@ 一次；这个提交停了就一直不动（过了一周也不再来），有新提交才重新算', { skip: SKIP }, () => {
  const u = { login: 'old', id: 11 }
  const SHA1 = '1'.repeat(40)
  const ev = (n, daysAgo = 1, who = 'bot[bot]', event = 'convert_to_draft') => Array.from({ length: n }, () => ({ event, actor: { login: who }, created_at: iso(daysAgo) }))
  const cm = (body, daysAgo = 1, who = 'bot[bot]') => ({ id: 1, user: { login: who }, created_at: iso(daysAgo), body })
  const go = (timeline, comments = []) => heldRun([held(1, 'held: author', u)], { users: { old: iso(30) }, more: { '^GET repos/o/r/issues/\\d+/timeline': timeline, '^GET repos/o/r/issues/\\d+/comments': { body: comments } } })
  const capped = go({ pages: [ev(2), ev(1)] }) // 分页数全
  assert.equal(capped.code, 0, capped.out)
  assert.deepEqual(heldActs(capped), ['comment 1'])
  assert.match(capped.calls.find((c) => c.args[1] === 'comment').file, new RegExp(`^<!-- dsh-gallery-stuck held ${SHA1} -->\n@OrderG-X `))
  assert.ok(capped.calls.find((c) => c.route.includes('/timeline')).args.includes('--paginate'))
  // 重跑没成的 @（机器人自己的、一周内的）也算次数：转草稿一直失败时不会有转草稿记录
  assert.deepEqual(heldActs(go({ body: ev(1) }, [cm('<!-- dsh-gallery-stuck -->\n@x a'), cm('<!-- dsh-gallery-stuck -->\n@x b')])), ['comment 1'])
  assert.deepEqual(heldActs(go({ body: [] }, [cm('<!-- dsh-gallery-stuck -->\n@x', 1), cm('<!-- dsh-gallery-stuck -->\n@x', 2), cm('<!-- dsh-gallery-stuck -->\n@x', 3)])), ['comment 1'])
  // 这个提交停过了：过了一周（旧记录不算了）也不再重跑、不再 @
  const stopped = go({ body: [] }, [cm(`<!-- dsh-gallery-stuck held ${SHA1} -->\n@x`, 20)])
  assert.equal(stopped.code, 0, stopped.out)
  assert.deepEqual(heldActs(stopped), [])
  assert.ok(!stopped.calls.some((c) => c.route.includes('/timeline')))
  // 别人假冒的停用标记、别的提交的停用标记都不算：照常重跑
  assert.deepEqual(heldActs(go({ body: [] }, [cm(`<!-- dsh-gallery-stuck held ${SHA1} -->\n@x`, 1, 'evil')])), [`${RERUN[0]} 1`, `${RERUN[1]} 1`])
  assert.deepEqual(heldActs(go({ body: [] }, [cm(`<!-- dsh-gallery-stuck held ${'2'.repeat(40)} -->\n@x`)])), [`${RERUN[0]} 1`, `${RERUN[1]} 1`])
  // 不到 3 回、一周以前的、别人转的草稿、标回的事件、别人的 @、「没跑完」那种 @ 都不算
  for (const [t, c] of [[ev(2), []], [[...ev(2), ...ev(1, 8)], []], [[...ev(2), ...ev(1, 1, 'alice')], []], [[...ev(2), ...ev(1, 1, 'bot[bot]', 'ready_for_review')], []],
    [ev(2), [cm('<!-- dsh-gallery-stuck -->\n@x', 8)]], [ev(2), [cm('<!-- dsh-gallery-stuck -->\n@x', 1, 'evil')]], [ev(2), [cm(`<!-- dsh-gallery-stuck ${SHA} -->\n@x`)]]]) {
    assert.deepEqual(heldActs(go({ body: t }, c)), [`${RERUN[0]} 1`, `${RERUN[1]} 1`], JSON.stringify([t, c]))
  }
  for (const bad of [{ '^GET repos/o/r/issues/\\d+/timeline': { code: 1 } }, { '^GET repos/o/r/issues/\\d+/comments': { code: 1 } }]) {
    const r = heldRun([held(1, 'held: author', u)], { users: { old: iso(30) }, more: bad })
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(heldActs(r), [])
  }
})

test('挂起复查：PR 列表读坏了（翻页拿到的不是列表、列表里不是 PR）——不能当成 0 个放行，整个任务失败', { skip: SKIP }, () => {
  const u = { login: 'old', id: 11 }
  for (const recent of [{ body: { message: 'Server Error' } }, { body: [{ foo: 1 }] }]) {
    const r = heldRun([held(1, 'held: author', u)], { users: { old: iso(30) }, more: { '^GET repos/o/r/pulls\\?state=all': recent } })
    assert.notEqual(r.code, 0, r.out)
    assert.deepEqual(heldActs(r), [], JSON.stringify(recent))
  }
  // 开着的 PR 列表坏了（某页是 null、错误对象、里面不是 PR）：也不能当成「没有 PR」悄悄成功（草稿兜底、挂起重跑全漏掉）
  for (const open of [{ pages: [[held(1, 'held: author', u)], null] }, { body: { message: 'Server Error' } }, { body: [{ foo: 1 }] }, { body: [{ number: '1' }] }]) {
    const r = heldRun([held(1, 'held: author', u)], { users: { old: iso(30) }, more: { '^GET repos/o/r/pulls\\?state=open': open, '^GET repos/o/r/pulls\\?state=all': { body: [] } } })
    assert.notEqual(r.code, 0, r.out)
    assert.deepEqual(heldActs(r), [], JSON.stringify(open))
  }
})

test('挂起复查：兜底——机器人转的草稿半小时后还没标回（任务被取消、机器没了）就替它标回；作者自己转的、已经标回过的、刚转的不动', { skip: SKIP }, () => {
  const ev = (event, who, minsAgo) => ({ event, actor: { login: who }, created_at: new Date(Date.now() - minsAgo * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z') })
  const d = (n) => ({ number: n, node_id: `PR_${n}`, state: 'open', draft: true, labels: [], user: { login: 'a', id: 1 }, body: '', updated_at: iso(1), created_at: iso(3), head: { sha: SHA } })
  const tl = {
    1: [ev('convert_to_draft', 'bot[bot]', 120)], // 机器人转的、两小时没标回：标回
    2: [ev('convert_to_draft', 'bot[bot]', 120), ev('ready_for_review', 'bot[bot]', 119), ev('convert_to_draft', 'alice', 60)], // 作者后来自己转的
    3: [ev('convert_to_draft', 'alice', 120)],
    4: [ev('convert_to_draft', 'bot[bot]', 5)], // 刚转，可能正在标回
    5: [],
  }
  const more = { '^GET repos/o/r/pulls\\?state=all': { body: [] } }
  for (const [n, t] of Object.entries(tl)) more[`^GET repos/o/r/issues/${n}/timeline\\?per_page=100`] = { pages: [t.slice(0, 1), t.slice(1)] }
  const r = heldRun([1, 2, 3, 4, 5].map(d), { more })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(heldActs(r), [`${RERUN[1]} 1`])
  assert.ok(r.calls.filter((c) => c.route.includes('/timeline')).every((c) => c.args.includes('--paginate')))
  // 查不到时间线：记失败，别的照常
  const bad = heldRun([d(1), d(2)], { more: { '^GET repos/o/r/pulls\\?state=all': { body: [] }, '^GET repos/o/r/issues/1/timeline\\?per_page=100': { code: 1 }, '^GET repos/o/r/issues/2/timeline\\?per_page=100': { body: [ev('convert_to_draft', 'bot[bot]', 120)] } } })
  assert.equal(bad.code, 1, bad.out)
  assert.deepEqual(heldActs(bad), [`${RERUN[1]} 2`])
  // 同一秒里「标回 → 机器人又转草稿」：按接口给的先后取最后一条（不能按文字排序，同一秒时 ready_for_review 会排到后面）
  const t0 = new Date(Date.now() - 120 * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const same = (events) => heldRun([d(1)], { more: { '^GET repos/o/r/pulls\\?state=all': { body: [] }, '^GET repos/o/r/issues/1/timeline\\?per_page=100': { body: events.map(([event, who]) => ({ event, actor: { login: who }, created_at: t0 })) } } })
  const s1 = same([['convert_to_draft', 'bot[bot]'], ['ready_for_review', 'bot[bot]'], ['convert_to_draft', 'bot[bot]']])
  assert.equal(s1.code, 0, s1.out)
  assert.deepEqual(heldActs(s1), [`${RERUN[1]} 1`])
  const s2 = same([['convert_to_draft', 'bot[bot]'], ['ready_for_review', 'bot[bot]']]) // 最后是标回（之后作者自己又转的草稿不算机器人的）
  assert.equal(s2.code, 0, s2.out)
  assert.deepEqual(heldActs(s2), [])
})

test('挂起复查：这一轮刚替机器人标回的草稿（标回就会重跑检查）——后面「挂起的重跑」不再动它；标回失败的照常处理', { skip: SKIP }, () => {
  const u = { login: 'old', id: 11 }
  const old = new Date(Date.now() - 120 * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const p = held(1, 'held: author', u, { draft: true, node_id: 'PR_1' })
  const more = { '^GET repos/o/r/pulls\\?state=all': { body: [] }, '^GET repos/o/r/issues/1/timeline\\?per_page=100': { body: [{ event: 'convert_to_draft', actor: { login: 'bot[bot]' }, created_at: old }] } }
  const r = heldRun([p], { users: { old: iso(30) }, more })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(heldActs(r), [`${RERUN[1]} 1`]) // 只标回一次，不再转草稿
  // 标回报错（可能其实标回了、检查已经在跑）：这一轮也不再动它，任务算失败，下一轮再看
  const err = heldRun([p], { users: { old: iso(30) }, more, ready: [1] })
  assert.equal(err.code, 1, err.out)
  assert.deepEqual(heldActs(err), [`${RERUN[1]} 1`])
})

test('probe：是不是这个提交最新的一回检查——确定过期（有更新的 id、attempt 涨了）才 fresh=false；查不到、说不准就不写（照旧往下走）', { skip: SKIP }, () => {
  const fresh = (runs, attempt = '1') => {
    const o = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-fresh-')), 'out'); fs.writeFileSync(o, '')
    const r = runStep('pr-gate.yml', '是不是这个提交最新的一回检查', { fix: { '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs }, env: { GH_TOKEN: 't', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: attempt, RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', GITHUB_OUTPUT: o } })
    assert.equal(r.code, 0, r.out)
    assert.ok(r.calls[0].args.includes('--paginate'))
    return fs.readFileSync(o, 'utf8').trim()
  }
  assert.equal(fresh(runsOf(['failure'])), 'fresh=true')
  assert.equal(fresh(runsOf(['success', 2]), '2'), 'fresh=true')
  assert.equal(fresh(runsOf(['failure'], ['success', 1, 'completed', 101])), 'fresh=false')
  assert.equal(fresh(runsOf(['success', 2])), 'fresh=false')
  // 说不准（列表是空的、数不到这回又没有更新的、数据不对）：不写，照旧往下走（gate / incomplete 自己再核，核不准就报错），不能当成过期跳过
  assert.equal(fresh({ body: { workflow_runs: [{ id: 5, run_attempt: 1 }] } }), '')
  assert.equal(fresh({ body: { workflow_runs: [] } }), '')
  assert.equal(fresh({ body: { workflow_runs: [{ id: 100, run_attempt: null }] } }), '')
  assert.equal(fresh({ pages: [{ workflow_runs: [{ id: 100, run_attempt: 1 }] }, { workflow_runs: [{ id: 101, run_attempt: 1 }] }] }), 'fresh=false')
  assert.equal(fresh({ code: 1 }), '')
  // 别的 PR（别的分支、别的 fork）指着同一个提交、跑得更晚：不算
  assert.equal(fresh({ body: { workflow_runs: [{ id: 100, run_attempt: 1 }, { id: 101, run_attempt: 1, head_branch: 'submission/8' }] } }), 'fresh=true')
  assert.equal(fresh({ body: { workflow_runs: [{ id: 100, run_attempt: 1 }, { id: 101, run_attempt: 1, head_repository: { full_name: 'eve/r', node_id: 'R_eve' } }] } }), 'fresh=true')
})

// post（写检查、贴卡、打标签，排 PR 的队）：从 gate-result/gate.json 取结果；result 给 null 就是没有这个文件
function gateBox(gate = {}, result) {
  const cwd = withBase(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-post-')))
  const g = JSON.stringify({ conclusion: 'success', lane: 'A', labels: ['lane: A'], ping: '', comment: '<!-- dsh-gallery-gate -->\nok', policy: POL, base: BASE, ...gate })
  if (result !== null) { fs.mkdirSync(path.join(cwd, 'gate-result')); fs.writeFileSync(path.join(cwd, 'gate-result/gate.json'), result ?? g) }
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  return { cwd, o }
}
const postEnv = (o, n = '7') => ({ GH_TOKEN: 'app', READ_TOKEN: 'read', N: n, SHA, SUBMISSION: 'https://github.com/o/r/pull/7', APP_SLUG: 'bot', RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', GITHUB_OUTPUT: o })
const POST_STEP = '写检查、贴卡、打标签'
const outOf = (o) => fs.readFileSync(o, 'utf8')
const writesOf = (r) => r.calls.filter((c) => (c.args[0] === 'pr' && c.args[1] !== 'view') || /^(POST|PATCH|DELETE) /.test(c.route)).map((c) => (c.args[0] === 'pr' ? `pr ${c.args[1]}` : c.route.split(' ')[0] + ' ' + c.route.split('/').slice(3).join('/')))

test('闸门写结果（post）：写之前再核一遍是不是最新那回（算的时候检查又重跑了就作废）；检查记下是哪一回、按哪一版规矩（external_id）；不合并（A 车道也只写卡、等维护者 /approve）', { skip: SKIP }, () => {
  const post = (runs, gate = {}, over = {}, result, n = '7') => {
    const { cwd, o } = gateBox(gate, result)
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runs, '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [] }, '^pr merge$': {}, ...POLICY_FIX, ...over })
    return { ...runStep('pr-gate.yml', POST_STEP, { fix, env: postEnv(o, n), cwd }), output: outOf(o) }
  }
  const ok = post(runsOf(['success']))
  assert.equal(ok.code, 0, ok.out)
  assert.ok(ok.calls.find((c) => c.route === 'POST repos/o/r/check-runs').fields.includes(`external_id=100/1/${PS}/${B12}`))
  assert.ok(!writesOf(ok).includes('pr merge')) // 不合并
  assert.doesNotMatch(ok.output, /^(merge|alt)=/m)
  assert.equal(ok.calls.filter((c) => c.route.includes('/actions/')).length, 1)
  assert.ok(ok.calls.filter((c) => c.route.includes('/actions/')).every((c) => c.token === 'read'))
  // 一开始就不是最新的了：什么都不写
  const stale = post(runsOf(['success', 2]))
  assert.equal(stale.code, 0, stale.out)
  assert.deepEqual(writesOf(stale), [])
  // 查不到、说不准（空列表、数不到这回）：这步失败，不写
  for (const runs of [{ code: 1 }, { body: { workflow_runs: [] } }, { body: { workflow_runs: [{ id: 5, status: 'completed', conclusion: 'success', run_attempt: 1 }] } }]) {
    const bad = post(runs)
    assert.notEqual(bad.code, 0, JSON.stringify(runs))
    assert.deepEqual(writesOf(bad), [])
  }
  // 排 PR 的队的时候作者推了新提交、PR 被关了：不写（不能盖掉新提交的卡和标签）；查不到就失败
  for (const p of [pr({ head: { sha: 'b'.repeat(40) } }), pr({ state: 'closed' })]) {
    const moved = post(runsOf(['success']), {}, { '^GET repos/o/r/pulls/7$': { body: p } })
    assert.equal(moved.code, 0, moved.out)
    assert.deepEqual(writesOf(moved), [])
  }
  const gone = post(runsOf(['success']), {}, { '^GET repos/o/r/pulls/7$': { code: 1 } })
  assert.notEqual(gone.code, 0)
  assert.deepEqual(writesOf(gone), [])
  // 读得到但缺字段（state / head.sha 读不出来）：不能当成「关了 / 有新提交」悄悄不写——失败（交给 incomplete）
  for (const p of [{}, { ...pr(), state: null }, { ...pr(), head: {} }]) {
    const junk = post(runsOf(['success']), {}, { '^GET repos/o/r/pulls/7$': { body: p } })
    assert.equal(junk.code, 1, junk.out)
    assert.deepEqual(writesOf(junk), [])
  }
  // 是草稿、算的时候用的规矩又变了：重跑不了（不替作者改草稿）——这步失败、不写，交给 incomplete（卡上请作者标成可以审了）
  const dr = post(runsOf(['success']), {}, { '^GET repos/o/r/pulls/7$': { body: pr({ draft: true }) }, '^GET repos/o/r/contents/policy/strikes.json': { body: { sha: '2'.repeat(40) } } })
  assert.notEqual(dr.code, 0, dr.out)
  assert.deepEqual(writesOf(dr), [])
  assert.ok(!dr.calls.some((c) => c.route.startsWith('graphql:')))
  // 排队的时候维护者挂没挂起变了（发了 /hold、摘了 held: maintainer）：换成闸门按现在的样子算好的那一份（alt）写，不重跑检查
  const HELD = { '^GET repos/o/r/pulls/7$': { body: pr({ labels: [{ name: 'held: maintainer' }] }) } }
  const conclOf = (r) => r.calls.find((c) => c.route === 'POST repos/o/r/check-runs').fields.find((f) => f.startsWith('conclusion='))
  const sw = post(runsOf(['success']), { alt: { conclusion: 'neutral', labels: ['lane: A'], ping: '', maintHeld: true, comment: '<!-- dsh-gallery-gate -->\nheld-card' } }, HELD)
  assert.equal(sw.code, 0, sw.out)
  assert.equal(conclOf(sw), 'conclusion=neutral')
  assert.ok(sw.calls.some((c) => c.args[1] === 'comment' && /held-card/.test(c.file || '')))
  assert.ok(!sw.calls.some((c) => c.route.startsWith('graphql:')))
  const back = post(runsOf(['success']), { maintHeld: true, conclusion: 'neutral', alt: { conclusion: 'success', labels: ['lane: A'], ping: '', maintHeld: false, comment: '<!-- dsh-gallery-gate -->\nauto' } })
  assert.equal(back.code, 0, back.out)
  assert.equal(conclOf(back), 'conclusion=success')
  assert.ok(!writesOf(back).includes('pr merge'))
  // 没有那一份（读不出来）：这步失败、不写（交给 incomplete 重跑）
  for (const alt of [undefined, { comment: 1 }]) {
    const r = post(runsOf(['success']), { alt }, HELD)
    assert.notEqual(r.code, 0, JSON.stringify(alt))
    assert.ok(!r.calls.some((c) => c.route === 'POST repos/o/r/check-runs'))
  }
  // 没变、或者检查没过（没过的卡不看这个）：照写
  for (const [gate, over] of [[{ maintHeld: true, conclusion: 'neutral' }, HELD], [{ conclusion: 'failure' }, HELD]]) {
    const r = post(runsOf(['success']), gate, over)
    assert.equal(r.code, 0, r.out)
    assert.ok(r.calls.some((c) => c.route === 'POST repos/o/r/check-runs'), JSON.stringify(gate))
    assert.ok(!r.calls.some((c) => c.route.startsWith('graphql:')))
  }
  // 交过来的结果读不出来、没有：失败，不写；号不对（0 开头、不是数）也失败
  for (const result of ['', 'null', '[1]', '{', null]) {
    const junk = post(runsOf(['success']), {}, {}, result)
    assert.notEqual(junk.code, 0, JSON.stringify(result))
    assert.deepEqual(writesOf(junk), [])
  }
  for (const n of ['07', '', 'x']) {
    const junk = post(runsOf(['success']), {}, {}, undefined, n)
    assert.notEqual(junk.code, 0, n)
    assert.deepEqual(writesOf(junk), [])
    assert.equal(junk.calls.length, 0)
  }
  // 重跑旧的一回（100 的第 2 回）时 PR 的并发组把新的一回（101）取消了：取消的不算「后面又跑过」，照常写；101 还在跑就算过期
  const rerun = (other) => {
    const { cwd, o } = gateBox()
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': { body: { workflow_runs: [{ id: 100, status: 'completed', conclusion: 'success', run_attempt: 2 }, { id: 101, run_attempt: 1, ...other }] } }, '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [] }, ...POLICY_FIX })
    return runStep('pr-gate.yml', POST_STEP, { fix, env: { ...postEnv(o), RUN_ATTEMPT: '2' }, cwd })
  }
  const cancelled = rerun({ status: 'completed', conclusion: 'cancelled' })
  assert.equal(cancelled.code, 0, cancelled.out)
  assert.ok(cancelled.calls.find((c) => c.route === 'POST repos/o/r/check-runs').fields.includes(`external_id=100/2/${PS}/${B12}`))
  for (const other of [{ status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'success' }]) {
    const r = rerun(other)
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(writesOf(r), [], JSON.stringify(other))
  }
})

test('闸门交结果：gate 把号交给 post（job 输出），gate.json 加上算的时候用的规矩版本、传成这次运行的产物 gate-result（不塞进环境变量，大了会超限）；跳过的不交（post 就不跑）', { skip: SKIP }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-result-'))
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' }).trim()
  git('init', '-q')
  fs.mkdirSync(path.join(cwd, 'policy'))
  fs.writeFileSync(path.join(cwd, 'policy/strikes.json'), '{"alice":1}\n')
  git('add', 'policy'); git('commit', '-qm', 'x')
  const blob = git('rev-parse', 'HEAD:policy/strikes.json')
  const g = { conclusion: 'success', comment: '多行\n<!-- x -->\nEOF_DSH_PING\n' + 'x'.repeat(200000) }
  fs.writeFileSync(path.join(cwd, 'gate.json'), JSON.stringify(g))
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  const r = runStep('pr-gate.yml', '交给写结果的 job（按 PR 排队再写）', { env: { N: '7', GITHUB_OUTPUT: o }, cwd })
  assert.equal(r.code, 0, r.out)
  assert.equal(fs.readFileSync(o, 'utf8'), 'number=7\n') // 结果本身不走输出
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, 'gate-result/gate.json'), 'utf8')), { ...g, policy: `${blob} none`, base: git('rev-parse', 'HEAD') })
  // gate.json 不是对象：失败
  fs.writeFileSync(path.join(cwd, 'gate.json'), '[1]')
  assert.notEqual(runStep('pr-gate.yml', '交给写结果的 job（按 PR 排队再写）', { env: { N: '7', GITHUB_OUTPUT: o }, cwd }).code, 0)
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/pr-gate.yml'), 'utf8')
  assert.match(y, /- name: 交给写结果的 job（按 PR 排队再写）\n        if: steps\.pr\.outputs\.skip != 'true'\n/)
  assert.match(y, /\n      - uses: actions\/upload-artifact@v4\n        if: steps\.pr\.outputs\.skip != 'true'\n        with:\n          name: gate-result\n          path: gate-result\/gate\.json\n          # [^\n]*\n          retention-days: 30\n          overwrite: true\n          if-no-files-found: error\n/)
  // gate 的输出只有号和投稿链接（结果不走 job 输出）
  const gate = y.slice(y.indexOf('\n  gate:\n'), y.indexOf('\n  post:\n'))
  assert.doesNotMatch(gate, /result: \$\{\{/)
  assert.doesNotMatch(y, /\bRESULT\b/)
})

test('闸门写结果：算的时候用的违规记录 / 手动信任和 main 上现在的不一样（维护者 /untrust 了……）——这回作废、让检查重跑，什么都不写；查不到就失败', { skip: SKIP }, () => {
  const step = POST_STEP
  const post = (over = {}, gate = {}) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-pol-'))
    fs.mkdirSync(path.join(cwd, 'gate-result'))
    fs.writeFileSync(path.join(cwd, 'gate-result/gate.json'), JSON.stringify({ conclusion: 'success', lane: 'A', labels: ['lane: A'], ping: '', comment: 'ok', policy: POL, base: BASE, ...gate }))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['success']), '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [] }, '^pr merge$': {}, ...POLICY_FIX, ...over })
    return runStep('pr-gate.yml', step, { fix, env: { GH_TOKEN: 'app', READ_TOKEN: 'read', N: '7', SHA, SUBMISSION: 'x', APP_SLUG: 'bot', RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', GITHUB_OUTPUT: o }, cwd })
  }
  const wrote = (r) => r.calls.filter((c) => (c.args[0] === 'pr' && c.args[1] !== 'view') || /^(POST|PATCH|DELETE) /.test(c.route)).map((c) => c.args[0] === 'pr' ? `pr ${c.args[1]}` : c.route)
  const ok = post()
  assert.equal(ok.code, 0, ok.out)
  assert.ok(wrote(ok).includes('POST repos/o/r/check-runs'))
  assert.equal(ok.calls.filter((c) => c.route.includes('/contents/policy/')).length, 2) // 写之前两个文件
  assert.ok(ok.calls.filter((c) => c.route.includes('/contents/policy/')).every((c) => c.route.endsWith('?ref=main')))
  // 一开始就变了：一个都不写，转草稿再标回让检查重跑
  for (const changed of [{ '^GET repos/o/r/contents/policy/strikes.json': { body: { sha: '2'.repeat(40) } } }, { '^GET repos/o/r/contents/policy/trust-overrides.json': { body: { sha: '3'.repeat(40) } } }]) {
    const r = post(changed)
    assert.equal(r.code, 0, r.out)
    assert.deepEqual(wrote(r), [], JSON.stringify(changed))
    assert.deepEqual(acts(r), RERUN)
  }
  // 变了、要重跑的时候（等 GitHub 算冲突）作者把 PR 转成了草稿：重跑不了，这步失败（交给 incomplete 写「没跑完」），不写
  const strikes2 = { '^GET repos/o/r/contents/policy/strikes.json': { body: { sha: '2'.repeat(40) } } }
  const drafted = post({ ...strikes2, '^GET repos/o/r/pulls/7$': { bodies: [pr({ mergeable: null }), pr({ mergeable: null }), pr({ mergeable: null, draft: true })] } })
  assert.equal(drafted.code, 4, drafted.out)
  assert.deepEqual(wrote(drafted), [])
  assert.deepEqual(acts(drafted), [])
  // 算的时候没记版本（旧写法）：也算变了
  const noPol = post({}, { policy: undefined })
  assert.deepEqual(wrote(noPol), [])
  assert.deepEqual(acts(noPol), RERUN)
  // 查不到（不是 404）、版本号不对：失败，不写
  for (const bad of [{ '^GET repos/o/r/contents/policy/strikes.json': { code: 1, stderr: 'HTTP 500' } }, { '^GET repos/o/r/contents/policy/strikes.json': { body: { sha: 'zz' } } }]) {
    const r = post(bad)
    assert.notEqual(r.code, 0, JSON.stringify(bad))
    assert.deepEqual(wrote(r), [])
    assert.deepEqual(acts(r), [])
  }
})

test('闸门写结果：旧标签删不掉（除了已经没了的 404）就失败，不能留着旧的挂起标签说成功；count: partial 也是闸门自己的', { skip: SKIP }, () => {
  const step = POST_STEP
  const go = (del) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-lbl-'))
    fs.mkdirSync(path.join(cwd, 'gate-result'))
    fs.writeFileSync(path.join(cwd, 'gate-result/gate.json'), JSON.stringify({ conclusion: 'neutral', lane: 'B', labels: ['checks: pass', 'lane: B'], ping: '', comment: 'ok', policy: POL, base: BASE }))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const labels = { body: [{ name: 'held: author' }, { name: 'count: partial' }, { name: 'held: maintainer' }, { name: 'reviewed' }] }
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['success']), '^GET repos/o/r/issues/7/labels\\?per_page=100$': labels, '^DELETE repos/o/r/issues/7/labels/': del, ...POLICY_FIX })
    return runStep('pr-gate.yml', step, { fix, env: { GH_TOKEN: 'app', READ_TOKEN: 'read', N: '7', SHA, SUBMISSION: 'x', APP_SLUG: 'bot', RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', GITHUB_OUTPUT: o }, cwd })
  }
  const ok = go({ body: {} })
  assert.equal(ok.code, 0, ok.out)
  assert.deepEqual(ok.calls.filter((c) => c.route.startsWith('DELETE ')).map((c) => decodeURIComponent(c.route.split('/labels/')[1])), ['held: author', 'count: partial'])
  assert.ok(ok.calls.some((c) => c.route === 'POST repos/o/r/issues/7/labels'))
  const gone = go({ code: 1, stderr: 'gh: Label does not exist (HTTP 404)\n' })
  assert.equal(gone.code, 0, gone.out)
  const err = go({ code: 1, stderr: 'gh: Server Error (HTTP 500)\n' })
  assert.notEqual(err.code, 0)
  assert.ok(!err.calls.some((c) => c.route === 'POST repos/o/r/issues/7/labels'))
})

// ───────── 第八轮：规矩版本、被取消的回合、合并的队、取消时标回 ─────────

test('/approve：检查是按旧的违规记录 / 信任名单算的（main 上的变了）——不合，说清楚、让检查按现在的重算；查不到规矩版本、检查没记版本、记录格式不对都不合；没过的不用查规矩', { skip: SKIP }, () => {
  const changed = approve({ checks: { body: gateRuns([5, 'success']) }, more: { '^GET repos/o/r/contents/policy/strikes.json': { body: { sha: '2'.repeat(40) } } } })
  assert.equal(changed.code, 0, changed.out)
  assert.equal(merges(changed).length, 0)
  assert.match(replies(changed)[0], /按旧的违规记录/)
  assert.deepEqual(changed.calls.filter((c) => c.route.startsWith('graphql:')).map((c) => c.route.slice(8)), RERUN)
  assert.ok(changed.calls.filter((c) => c.route.includes('/contents/policy/')).every((c) => c.route.endsWith('?ref=main')))
  // 信任名单从没有变成有了，也算变了
  const trust = approve({ checks: { body: gateRuns([5, 'success']) }, more: { '^GET repos/o/r/contents/policy/trust-overrides.json': { body: { sha: '3'.repeat(40) } } } })
  assert.equal(merges(trust).length, 0)
  assert.match(replies(trust)[0], /按旧的违规记录/)
  // 查不到（不是 404）、版本号不对：error，不合，也不重跑
  for (const bad of [{ code: 1, stderr: 'gh: Server Error (HTTP 502)\n' }, { body: { sha: 'zz' } }]) {
    const err = approve({ checks: { body: gateRuns([5, 'success']) }, more: { '^GET repos/o/r/contents/policy/strikes.json': bad } })
    assert.equal(err.code, 0, err.out)
    assert.equal(merges(err).length, 0, JSON.stringify(bad))
    assert.match(replies(err)[0], /（error）/)
    assert.ok(!err.calls.some((c) => c.route.startsWith('graphql:')))
  }
  // 检查只记了 <run>/<attempt>（「检查没跑完」写的失败检查）：成功的不认（当成还没算完），失败的照样是失败、不用查规矩
  const noPol = approve({ checks: { body: gateRuns([5, 'success', 'completed', '100/1']) } })
  assert.equal(merges(noPol).length, 0)
  assert.match(replies(noPol)[0], /（pending）/)
  const inc = approve({ checks: { body: gateRuns([5, 'failure', 'completed', '100/1']) } })
  assert.equal(merges(inc).length, 0)
  assert.match(replies(inc)[0], /（failure）/)
  assert.ok(!inc.calls.some((c) => c.route.includes('/contents/policy/')))
  // 100/10/… 不能当成 100/1 的
  const ten = approve({ checks: { body: gateRuns([5, 'success', 'completed', `100/10/${PS}/${B12}`]) } })
  assert.equal(merges(ten).length, 0)
  assert.match(replies(ten)[0], /（pending）/)
  // 记录格式不对（external_id 里有空格）：error
  const junk = approve({ checks: { body: gateRuns([5, 'success', 'completed', '100/1 x']) } })
  assert.equal(merges(junk).length, 0)
  assert.match(replies(junk)[0], /（error）/)
})

test('/approve：同一个来源后来的一回被取消了（重跑旧的一回时会这样）——不挡；fork 改了名（node_id 不变）照样认', { skip: SKIP }, () => {
  const run = (status, id, over = {}) => ({ id, status, run_attempt: 1, ...over })
  const canc = approve({ checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100, { conclusion: 'success' }), run('completed', 101, { conclusion: 'cancelled' })] } } })
  assert.equal(canc.code, 0, canc.out)
  assert.equal(merges(canc).length, 1)
  // 对照：后来的一回没被取消（跑完了，闸门还没写它的）：不合
  const done = approve({ checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100, { conclusion: 'success' }), run('completed', 101, { conclusion: 'success' })] } } })
  assert.equal(merges(done).length, 0)
  assert.match(replies(done)[0], /（pending）/)
  const renamed = { headRefName: 'main', headRepository: { id: 'R_alice', name: 'r-renamed' } }
  const rn = approve({ views: [renamed], checks: { body: gateRuns([5, 'success']) }, runs: { body: { workflow_runs: [run('completed', 100, { head_branch: 'main', head_repository: { full_name: 'alice/r', node_id: 'R_alice' } })] } } })
  assert.equal(rn.code, 0, rn.out)
  assert.equal(merges(rn).length, 1)
})

test('维护者命令：轮到了再认一次人——排队时权限被撤了、查不到就不做', { skip: SKIP }, () => {
  const go = (resp) => runStep('chatops.yml', '轮到了再认一次人', { fix: { '^GET repos/o/r/collaborators/maint/permission$': resp }, env: { GH_TOKEN: 'app', ACTOR: 'maint' } })
  for (const p of ['admin', 'maintain', 'write']) assert.equal(go({ body: { permission: p } }).code, 0, p)
  for (const resp of [{ body: { permission: 'read' } }, { body: { permission: 'none' } }, { code: 1 }]) assert.notEqual(go(resp).code, 0, JSON.stringify(resp))
})

test('apply 动手前再认人：确实不是维护者了记下 denied（cancelled 不回话）；读不出来、不认得的值不记（cancelled 说没能处理）', { skip: SKIP }, () => {
  const go = (resp) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-reauth-'))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const r = runStep('chatops.yml', '动手前再认一次人', { fix: { '^GET repos/o/r/collaborators/maint/permission$': resp }, env: { GH_TOKEN: 'app', ACTOR: 'maint', GITHUB_OUTPUT: o }, cwd })
    return { code: r.code, out: fs.readFileSync(o, 'utf8') }
  }
  for (const p of ['admin', 'maintain', 'write']) assert.deepEqual(go({ body: { permission: p } }), { code: 0, out: '' }, p)
  for (const p of ['read', 'triage', 'none']) assert.deepEqual(go({ body: { permission: p } }), { code: 1, out: 'denied=true\n' }, p)
  for (const resp of [{ code: 1 }, { body: {} }, { body: { permission: 'weird' } }]) assert.deepEqual(go(resp), { code: 1, out: '' }, JSON.stringify(resp))
})

test('同一个来源后来的一回被取消了（重跑旧的一回时 PR 的并发组会取消新的）——不算「后面又跑过」：核对、probe、检查没跑完都照常', { skip: SKIP }, () => {
  const canc = runsOf(['failure'], ['cancelled', 1, 'completed', 101])
  // 核对 PR：往下核
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-gate-'))
  fs.mkdirSync(path.join(cwd, 'artifact')); fs.writeFileSync(path.join(cwd, 'artifact/pr'), '7')
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  const k = runStep('pr-gate.yml', '核对是哪个 PR（按来源找往 main 合的那个）', { fix: { '^GET repos/o/r/actions/workflows/pr-check.yml/runs': canc, '^GET repos/o/r/pulls\\?state=open': { body: [pr()] }, '^GET repos/o/r/pulls/7$': { body: pr() } }, env: { GH_TOKEN: 'app', READ_TOKEN: 'read', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', APP_SLUG: 'bot', GITHUB_OUTPUT: o }, cwd })
  assert.ok(k.calls.some((c) => c.route === 'GET repos/o/r/pulls/7'), k.out)
  assert.doesNotMatch(fs.readFileSync(o, 'utf8'), /skip=true/)
  // 这回自己被取消了（id 就是它）：还是认得到这回
  const self = runStep('pr-gate.yml', '是不是这个提交最新的一回检查', { fix: { '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['cancelled']) }, env: { GH_TOKEN: 't', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', GITHUB_OUTPUT: o } })
  assert.equal(self.code, 0, self.out)
  // probe：fresh=true
  const o2 = path.join(cwd, 'out2'); fs.writeFileSync(o2, '')
  const pf = runStep('pr-gate.yml', '是不是这个提交最新的一回检查', { fix: { '^GET repos/o/r/actions/workflows/pr-check.yml/runs': canc }, env: { GH_TOKEN: 't', RUN_SHA: SHA, RUN_ID: '100', RUN_ATTEMPT: '1', RUN_HEAD_BRANCH: 'submission/7', RUN_HEAD_REPO_ID: 'R_o', GITHUB_OUTPUT: o2 } })
  assert.equal(pf.code, 0, pf.out)
  assert.equal(fs.readFileSync(o2, 'utf8').trim(), 'fresh=true')
  // 检查没跑完：照常第一回（被取消的不算跑过）
  const r = runInc({ fix: baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': canc }), env: incEnv() })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(r.sleeps, ['300'])
  assert.deepEqual(acts(r), ['comment', ...RERUN])
})

test('重跑：标回报错后查到是作者自己又转的草稿（其实标回了）——不再替他标回', { skip: SKIP }, () => {
  const fix = baseFix({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr(), pr({ draft: true })] }, 'graphql:markPullRequestReadyForReview': { codes: [1, 0] }, '^GET repos/o/r/issues/7/timeline': { body: [{ event: 'convert_to_draft', actor: { login: 'bot[bot]' } }, { event: 'ready_for_review', actor: { login: 'bot[bot]' } }, { event: 'convert_to_draft', actor: { login: 'alice' } }] } })
  const r = runInc({ fix, env: incEnv() })
  assert.equal(r.code, 0, r.out)
  assert.deepEqual(acts(r), ['comment', RERUN[0], RERUN[1]])
  assert.match(r.out, /不替他标回/)
})

test('重跑：和 main 有冲突（mergeable=false）——pull_request 的检查跑不了，不转草稿；告诉作者先解决冲突（同一个提交只说一次）；说不出去算失败', { skip: SKIP }, () => {
  const go = (over, env = {}) => {
    const box = newBox({ fix: { '^GET repos/o/r/pulls/7$': { body: pr({ mergeable: false }) }, '^graphql:': { body: { data: {} } }, '^GET repos/o/r/issues/7/comments$': { body: [] }, '^pr comment$': {}, ...over } })
    const r = spawnSync('bash', ['scripts/recheck.sh', '7', SHA], { cwd: box.dir, encoding: 'utf8', env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_FIX: box.fixFile, GH_LOG: box.log, SLEEP_LOG: box.sleepLog, GITHUB_REPOSITORY: 'o/r', GITHUB_REPOSITORY_OWNER: 'o', APP_SLUG: 'bot', ...env } })
    const calls = fs.readFileSync(box.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    return { code: r.status, out: r.stdout + r.stderr, calls }
  }
  const r = go()
  assert.equal(r.code, 0, r.out)
  assert.ok(!r.calls.some((c) => c.route.startsWith('graphql:')))
  const say = r.calls.find((c) => c.args[0] === 'pr' && c.args[1] === 'comment')
  assert.match(say.file, new RegExp(`^<!-- dsh-gallery-conflict ${SHA} -->\n.*有冲突`))
  // 这个提交说过了：不再说
  const again = go({ '^GET repos/o/r/issues/7/comments$': { body: [{ id: 3, user: { login: 'bot[bot]' }, body: `<!-- dsh-gallery-conflict ${SHA} -->\nx` }] } })
  assert.equal(again.code, 0, again.out)
  assert.ok(!again.calls.some((c) => c.args[1] === 'comment'))
  // 说不出去、查不到说没说过：失败
  for (const over of [{ '^pr comment$': { code: 1 } }, { '^GET repos/o/r/issues/7/comments$': { code: 1 } }]) assert.equal(go(over).code, 1)
  // 没冲突：照常转草稿再标回
  const fine = go({ '^GET repos/o/r/pulls/7$': { body: pr({ mergeable: true }) } })
  assert.equal(fine.code, 0, fine.out)
  assert.deepEqual(fine.calls.filter((c) => c.route.startsWith('graphql:')).map((c) => c.route.slice(8)), RERUN)
  // 还没算出来（null）：等一会儿再查——算出来有冲突就说冲突，没冲突照常重跑
  const later = go({ '^GET repos/o/r/pulls/7$': { bodies: [pr({ mergeable: null }), pr({ mergeable: null }), pr({ mergeable: false })] } })
  assert.equal(later.code, 0, later.out)
  assert.ok(!later.calls.some((c) => c.route.startsWith('graphql:')))
  assert.ok(later.calls.some((c) => c.args[1] === 'comment' && /dsh-gallery-conflict/.test(c.file || '')))
  const ok2 = go({ '^GET repos/o/r/pulls/7$': { bodies: [pr({ mergeable: null }), pr({ mergeable: true })] } })
  assert.equal(ok2.code, 0, ok2.out)
  assert.deepEqual(ok2.calls.filter((c) => c.route.startsWith('graphql:')).map((c) => c.route.slice(8)), RERUN)
  // 一直算不出来：不动、请维护者看，这步失败
  const never = go({ '^GET repos/o/r/pulls/7$': { body: pr({ mergeable: null }) } })
  assert.equal(never.code, 1, never.out)
  assert.ok(!never.calls.some((c) => c.route.startsWith('graphql:')))
  assert.ok(never.calls.some((c) => c.args[1] === 'comment' && /算不出它和 main 有没有冲突/.test(c.file || '')))
  // 是草稿（一开始就是、等的时候作者转成了草稿）：不动；默认算成功，给了 DRAFT_RC（闸门写结果时）就用它（交给 incomplete）
  const draftLater = { '^GET repos/o/r/pulls/7$': { bodies: [pr({ mergeable: null }), pr({ mergeable: null, draft: true })] } }
  for (const over of [draftLater, { '^GET repos/o/r/pulls/7$': { body: pr({ draft: true }) } }]) {
    const d0 = go(over)
    assert.equal(d0.code, 0, d0.out)
    const d4 = go(over, { DRAFT_RC: '4' })
    assert.equal(d4.code, 4, d4.out)
    assert.ok(!d4.calls.some((c) => c.route.startsWith('graphql:')))
  }
  // 转草稿报错、一看是作者自己转的草稿：也是没重跑，同样用 DRAFT_RC
  const theirs = go({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr({ draft: true })] }, 'graphql:convertPullRequestToDraft': { code: 1 }, '^GET repos/o/r/issues/7/timeline': { body: [{ event: 'convert_to_draft', actor: { login: 'alice' } }] } }, { DRAFT_RC: '4' })
  assert.equal(theirs.code, 4, theirs.out)
})

test('检查没跑完：贴卡、写检查、打标签失败了——要不要重跑在动手写之前就定了，重跑照样进行；满 3 回先 @ 维护者、不再重跑', { skip: SKIP }, () => {
  for (const bad of [{ '^POST repos/o/r/check-runs$': { code: 1 } }, { '^pr comment$': { code: 1 } }, { '^POST repos/o/r/issues/7/labels$': { code: 1 } }]) {
    const r = runInc({ fix: baseFix(bad), env: incEnv() })
    assert.notEqual(r.codes[1], 0, JSON.stringify(bad))
    assert.equal(r.codes.length, 3, JSON.stringify(bad))
    assert.equal(r.codes[2], 0, r.out)
    assert.deepEqual(r.sleeps, ['300'])
    assert.deepEqual(r.calls.filter((c) => c.route.startsWith('graphql:')).map((c) => c.route.slice(8)), RERUN)
  }
  // 满 3 回：先 @ 维护者，再写（写失败了 @ 也发出去了），不再重跑
  const full = runInc({ fix: baseFix({ '^POST repos/o/r/check-runs$': { code: 1 }, '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['failure'], ['failure'], ['failure']) }), env: incEnv() })
  assert.equal(full.codes.length, 2)
  assert.notEqual(full.codes[1], 0)
  assert.ok(full.calls.some((c) => c.args[1] === 'comment' && /dsh-gallery-stuck/.test(c.file || '')), full.out)
  assert.ok(!full.calls.some((c) => c.route.startsWith('graphql:')))
  // 查不到提醒过没有：不 @（不能当成没提醒过），也照样往下写
  const q = runInc({ fix: baseFix({ '^GET repos/o/r/issues/7/comments$': { code: 1 }, '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['failure'], ['failure'], ['failure']) }), env: incEnv() })
  assert.ok(!q.calls.some((c) => c.args[1] === 'comment' && /dsh-gallery-stuck/.test(c.file || '')), q.out)
  assert.match(q.out, /没能 @ 维护者/)
})

test('重跑：任务被取消（收到 TERM）——查现在的草稿是谁的：机器人转的才标回去；作者的、不是草稿的、查不到的不动；都算失败', { skip: SKIP }, () => {
  // 假 sleep：第一次睡的时候给 recheck.sh 发 TERM（模拟取消）
  const killer = '#!/bin/bash\necho "$*" >> "$SLEEP_LOG"\nkill -TERM $PPID\n'
  const go = (over) => {
    const box = newBox({ fix: { '^graphql:': { body: { data: {} } }, 'graphql:convertPullRequestToDraft': { codes: [1] }, '^GET repos/o/r/issues/7/timeline': { body: [{ event: 'convert_to_draft', actor: { login: 'bot[bot]' } }] }, '^GET repos/o/r/issues/7/comments$': { body: [] }, '^pr comment$': {}, ...over }, extra: { sleep: killer } })
    const r = spawnSync('bash', ['scripts/recheck.sh', '7', SHA], { cwd: box.dir, encoding: 'utf8', env: { ...process.env, PATH: `${box.bin}:${process.env.PATH}`, FAKE_FIX: box.fixFile, GH_LOG: box.log, SLEEP_LOG: box.sleepLog, GITHUB_REPOSITORY: 'o/r', GITHUB_REPOSITORY_OWNER: 'o', APP_SLUG: 'bot' } })
    const calls = fs.readFileSync(box.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    return { code: r.status, out: r.stdout + r.stderr, gql: calls.filter((c) => c.route.startsWith('graphql:')).map((c) => c.route.slice(8)) }
  }
  // 转草稿报错（其实转成了），睡的时候被取消：是机器人转的草稿 → 标回
  const bot = go({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr({ draft: true })] } })
  assert.equal(bot.code, 1, bot.out)
  assert.deepEqual(bot.gql, RERUN)
  assert.match(bot.out, /被取消了/)
  // 作者自己转的草稿：不动
  const other = go({ '^GET repos/o/r/pulls/7$': { bodies: [pr(), pr({ draft: true })] }, '^GET repos/o/r/issues/7/timeline': { body: [{ event: 'convert_to_draft', actor: { login: 'alice' } }] } })
  assert.equal(other.code, 1, other.out)
  assert.deepEqual(other.gql, [RERUN[0]])
  // 不是草稿（没转成）、查不到 PR：不动
  for (const p of [{ body: pr() }, { bodies: [pr()], codes: [0, 1] }]) {
    const x = go({ '^GET repos/o/r/pulls/7$': p })
    assert.equal(x.code, 1, x.out)
    assert.deepEqual(x.gql, [RERUN[0]], JSON.stringify(p))
  }
})

test('挂起复查：手动信任名单读坏了（不是对象）——算不出能不能放：记失败、不动', { skip: SKIP }, () => {
  for (const overrides of ['{bad', [1]]) {
    const r = heldRun([held(1, 'held: author', { login: 'old', id: 11 })], { users: { old: iso(30) }, overrides })
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(heldActs(r), [], JSON.stringify(overrides))
    assert.match(r.out, /算不出能不能放/)
  }
})

test('publish：截图和发布用同一个 main 提交（shots 一开始取一次）；只单独重跑 publish 时 main 变了就不发', { skip: SKIP }, () => {
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/publish.yml'), 'utf8')
  const shots = y.slice(y.indexOf('\n  shots:\n'), y.indexOf('\n  publish:\n'))
  const pub = y.slice(y.indexOf('\n  publish:\n'))
  assert.match(shots, /\n    outputs:\n      sha: \$\{\{ steps\.pin\.outputs\.sha \}\}\n/)
  assert.ok(shots.indexOf('id: pin') > 0 && shots.indexOf('id: pin') < shots.indexOf('actions/checkout@v4'))
  assert.match(shots, /actions\/checkout@v4\n        with:\n          ref: \$\{\{ steps\.pin\.outputs\.sha \}\}\n/)
  assert.match(pub, /actions\/checkout@v4\n        with:\n          ref: \$\{\{ needs\.shots\.outputs\.sha \}\}\n/)
  const guard = pub.indexOf("if: github.run_attempt != '1'")
  assert.ok(guard > 0 && guard < pub.indexOf('actions/checkout@v4'))
  // 取 main 的提交：格式不对、查不到就失败
  const pin = (resp) => { const o = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-pin-')), 'out'); fs.writeFileSync(o, ''); const r = runStep('publish.yml', '取 main 现在的提交（截图、建目录都用这一个）', { fix: { '^GET repos/o/r/commits/main$': resp }, env: { GH_TOKEN: 't', GITHUB_OUTPUT: o } }); return { code: r.code, out: fs.readFileSync(o, 'utf8').trim() } }
  assert.deepEqual(pin({ body: { sha: SHA } }), { code: 0, out: `sha=${SHA}` })
  for (const bad of [{ code: 1 }, { body: { sha: 'x' } }, { body: {} }]) assert.notEqual(pin(bad).code, 0, JSON.stringify(bad))
  // 重跑时核对
  const check = (resp) => runStep('publish.yml', '核对：截图那会儿取的 main 还是现在的 main（只单独重跑这个 job 时会不一样：那就不发，请重跑全部 job）', { fix: { '^GET repos/o/r/commits/main$': resp }, env: { GH_TOKEN: 't', PINNED: SHA } }).code
  assert.equal(check({ body: { sha: SHA } }), 0)
  assert.notEqual(check({ body: { sha: 'b'.repeat(40) } }), 0)
  assert.notEqual(check({ code: 1 }), 0)
})

// ───────── 第九轮：命令不排队就生效、合并的队里核对；同名的设计；标签分页；pr-check 按提交分组 ─────────

test('维护者命令 apply「照做」：/hold 打标签、/approve 和 /untrust 交给 confirm（命令原样传过去）；都不在这里回「已处理」', { skip: SKIP }, () => {
  const go = (action, fix = {}) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-apply-'))
    fs.writeFileSync(path.join(cwd, 'action.json'), JSON.stringify(action))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const r = runStep('chatops.yml', '照做', { fix: { '^issue edit$': {}, '^issue comment$': {}, '^POST repos/o/r/issues/comments/600/reactions$': { body: {} }, ...fix }, env: { GH_TOKEN: 'app', N: '7', ACTOR: 'maint', COMMENT_ID: '600', GITHUB_OUTPUT: o }, cwd })
    const out = fs.readFileSync(o, 'utf8')
    const m = /^json<<(EOF_[0-9a-f]+)\n([\s\S]*?)\n\1\n/m.exec(out)
    return { ...r, action: (/^action=(.*)$/m.exec(out) || [])[1], json: m ? JSON.parse(m[2]) : null }
  }
  const hold = go({ action: 'hold', reason: 'other', text: '先挂起\n\nOn hold' })
  assert.equal(hold.code, 0, hold.out)
  assert.ok(hold.calls.some((c) => c.args[0] === 'issue' && c.args[1] === 'edit' && c.args.includes('held: maintainer')))
  assert.ok(!hold.calls.some((c) => c.args[0] === 'issue' && c.args[1] === 'comment'))
  assert.equal(hold.action, 'hold')
  assert.equal(hold.json.text, '先挂起\n\nOn hold')
  // 给这条 /hold 点 👀（记下生效了：发的人后来降权了，之前排着的 /approve 也认它）
  assert.ok(hold.calls.some((c) => c.route === 'POST repos/o/r/issues/comments/600/reactions' && c.args.includes('content=eyes')), hold.out)
  assert.equal(hold.json.unrecorded, undefined)
  // 点不上（试 3 回）：照样生效、交给 confirm，回话时说一声
  const noEyes = go({ action: 'hold', reason: 'other', text: 'x' }, { '^POST repos/o/r/issues/comments/600/reactions$': { code: 1 } })
  assert.equal(noEyes.code, 0, noEyes.out)
  assert.equal(noEyes.action, 'hold')
  assert.equal(noEyes.json.unrecorded, true)
  assert.equal(noEyes.calls.filter((c) => c.route === 'POST repos/o/r/issues/comments/600/reactions').length, 3)
  const m = go({ action: 'merge', sha: SHA })
  assert.equal(m.code, 0, m.out)
  assert.equal(m.action, 'merge')
  assert.equal(m.json.sha, SHA)
  assert.deepEqual(m.calls, [])
  // /approve 没写完整提交号：不交给 confirm（不合），回话给出现在那一版的完整提交号；查不到就只说要写
  for (const [fix, re] of [[{ body: pr() }, new RegExp(`/approve ${SHA}`)], [{ code: 1 }, /要写上你看过的那一版的完整提交号（40 位，审核卡上照抄）。没合并/]]) {
    const bare = go({ action: 'merge', sha: '' }, { '^GET repos/o/r/pulls/7$': fix })
    assert.equal(bare.code, 0, bare.out)
    assert.equal(bare.action, undefined)
    assert.match(replies(bare)[0], re)
  }
  // 打不上标签：失败（不交给 confirm）
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-apply-'))
  fs.writeFileSync(path.join(cwd, 'action.json'), JSON.stringify({ action: 'hold', text: 'x' }))
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  const bad = runStep('chatops.yml', '照做', { fix: { '^issue edit$': { code: 1 }, '^issue comment$': {}, '^POST repos/o/r/issues/comments/600/reactions$': { body: {} } }, env: { GH_TOKEN: 'app', N: '7', ACTOR: 'maint', COMMENT_ID: '600', GITHUB_OUTPUT: o }, cwd })
  assert.equal(bad.code, 1, bad.out)
  assert.equal(fs.readFileSync(o, 'utf8'), 'did=true\n') // 只记下「照做」开始了，没交给 confirm
  // 👀 在打标签之前点（标签打不上，之前排着的 /approve 也认这条 /hold），回话请再发
  assert.ok(bad.calls.findIndex((c) => c.route === 'POST repos/o/r/issues/comments/600/reactions') >= 0, bad.out)
  assert.ok(bad.calls.findIndex((c) => c.route === 'POST repos/o/r/issues/comments/600/reactions') < bad.calls.findIndex((c) => c.args[1] === 'edit'))
  assert.match(replies(bad)[0], /没打上 held: maintainer.*请再发一次 \/hold/)
})

test('维护者命令 apply「照做」：/reject 先关、关上了才回原因——先关投稿的 issue、再关 PR、再关机器人替这个 issue 开的别的 PR；已经合并了照实说、关不上说清楚', { skip: SKIP }, () => {
  const go = (fix, event = { issue: { number: 7, pull_request: {} } }) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-reject-'))
    fs.writeFileSync(path.join(cwd, 'action.json'), JSON.stringify({ action: 'close', reason: 'spam', text: '拒了 / Rejected' }))
    fs.writeFileSync(path.join(cwd, 'event.json'), JSON.stringify(event))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    return runStep('chatops.yml', '照做', { fix: { '^issue comment$': {}, '^pr comment$': {}, '^POST repos/o/r/issues/\\d+/labels$': {}, '^POST repos/o/r/issues/comments/600/reactions$': { body: {} }, ...fix }, env: { GH_TOKEN: 'app', N: '7', ACTOR: 'maint', APP_SLUG: 'bot', COMMENT_ID: '600', GITHUB_OUTPUT: o, GITHUB_EVENT_PATH: path.join(cwd, 'event.json') }, cwd })
  }
  const comments = (r) => r.calls.filter((c) => c.args[1] === 'comment').map((c) => `${c.args[0]} ${c.args[2]}`)
  const marks = (r) => r.calls.filter((c) => /^POST repos\/o\/r\/issues\/\d+\/labels$/.test(c.route)).map((c) => `${c.route.split('/')[4]} ${c.fields.join()}`)
  const closes = (r) => r.calls.filter((c) => c.args[1] === 'close').map((c) => `${c.args[0]} ${c.args[2]}`)
  const O = { state: 'open', merged: false, user: { login: 'eve' } }, C = { state: 'closed', merged: false, user: { login: 'eve' } }
  // 别人开的 PR：先关，关上了再回原因
  const ok = go({ '^GET repos/o/r/pulls/7$': { bodies: [O, O, C] }, '^pr close$': {} })
  assert.equal(ok.code, 0, ok.out)
  const order = ok.calls.filter((c) => ['close', 'comment'].includes(c.args[1])).map((c) => c.args[1])
  assert.deepEqual(order, ['close', 'comment'])
  assert.deepEqual(replies(ok), ['拒了 / Rejected\n'])
  // 关之前先给这条 /reject 点 👀（关不上时，之前排着的 /approve 靠它认）；点不上不拦
  const eyesAt = ok.calls.findIndex((c) => c.route === 'POST repos/o/r/issues/comments/600/reactions')
  assert.ok(eyesAt >= 0 && eyesAt < ok.calls.findIndex((c) => c.args[1] === 'close'), ok.out)
  const noEyes = go({ '^GET repos/o/r/pulls/7$': { bodies: [O, O, C] }, '^pr close$': {}, '^POST repos/o/r/issues/comments/600/reactions$': { code: 1 } })
  assert.equal(noEyes.code, 0, noEyes.out)
  assert.deepEqual(replies(noEyes), ['拒了 / Rejected\n'])
  // 已经合并了：不回「拒了」，说已经合并、要下架用 /takedown
  const merged = go({ '^GET repos/o/r/pulls/7$': { body: { ...C, merged: true } } })
  assert.equal(merged.code, 0, merged.out)
  assert.deepEqual(closes(merged), [])
  assert.match(replies(merged)[0], /已经合并了，关不了/)
  // 关的时候刚好合并了（关失败，再查是合并了）
  const race = go({ '^GET repos/o/r/pulls/7$': { bodies: [O, O, { ...C, merged: true }] }, '^pr close$': { code: 1 } })
  assert.match(replies(race)[0], /已经合并了/)
  // 关不上、查不到：说清楚，算失败
  for (const [fix, re] of [[{ '^GET repos/o/r/pulls/7$': { body: O }, '^pr close$': { code: 1 } }, /没关上这个 PR/], [{ '^GET repos/o/r/pulls/7$': { code: 1 } }, /查不到这个 PR，PR 没关/]]) {
    const r = go(fix)
    assert.equal(r.code, 1, r.out)
    assert.match(replies(r)[0], re)
    assert.equal(replies(r).length, 1)
  }
  // 已经关了（没合并）：照样回原因
  const was = go({ '^GET repos/o/r/pulls/7$': { body: C } })
  assert.equal(was.code, 0, was.out)
  assert.deepEqual(replies(was), ['拒了 / Rejected\n'])
  // 机器人替网页投稿开的 PR：先关投稿的 issue（带上原因），再关这个 PR，再关机器人替这个 issue 开的别的 PR
  const url = 'https://github.com/o/r/issues/12'
  const botPr = (body, login = 'bot[bot]') => ({ ...O, user: { login }, body })
  const others = [
    { number: 7, user: { login: 'bot[bot]' }, body: `Submission: ${url}` },
    { number: 30, user: { login: 'bot[bot]' }, body: `Submitted-by: a (1)\r\nSubmission: ${url}\r\n` },
    { number: 31, user: { login: 'eve' }, body: `Submission: ${url}` },
    { number: 32, user: { login: 'bot[bot]' }, body: `Submission: ${url}0` },
  ]
  const botFix = (over = {}) => ({ '^GET repos/o/r/pulls/7$': { bodies: [botPr(`Submitted-by: a (1)\r\nSubmission: ${url}\r\n`), O, C] }, '^GET repos/o/r/issues/12$': { bodies: [{ state: 'open' }, { state: 'closed' }] }, '^issue close$': {}, '^pr close$': {}, '^GET repos/o/r/pulls\\?state=open': { body: others }, ...over })
  const bot = go(botFix())
  assert.equal(bot.code, 0, bot.out)
  assert.deepEqual(closes(bot), ['issue 12', 'pr 7', 'pr 30'])
  // 先打上作者去不掉的记号（这个 PR：held: maintainer，读 PR 之前就打；投稿 issue：rejected），再关
  assert.deepEqual(marks(bot), ['7 labels[]=held: maintainer', '12 labels[]=rejected'])
  assert.ok(bot.calls.findIndex((c) => c.route.endsWith('/labels')) < bot.calls.findIndex((c) => c.route === 'GET repos/o/r/pulls/7'))
  // 读不出 PR：没关、请再发，但 held: maintainer 已经打上了（之前排着的 /approve 不会合）
  const noRead = go({ '^GET repos/o/r/pulls/7$': { code: 1 } })
  assert.equal(noRead.code, 1, noRead.out)
  assert.deepEqual(marks(noRead), ['7 labels[]=held: maintainer'])
  assert.deepEqual(closes(noRead), [])
  assert.match(replies(noRead)[0], /查不到这个 PR，PR 没关/)
  assert.doesNotMatch(replies(noRead)[0], /投稿的 issue/)
  //   机器人替网页投稿开的（评论事件里带着 PR 的作者、说明）：投稿的 issue 照样标 rejected、关掉（不然作者改 issue 又开出新号的 PR）
  const botEv = { issue: { number: 7, pull_request: {}, user: { login: 'bot[bot]' }, body: 'Submitted-by: a (1)\r\nSubmission: https://github.com/o/r/issues/12\r\n' } }
  const noReadBot = go({ '^GET repos/o/r/pulls/7$': { code: 1 }, '^issue close$': {}, '^GET repos/o/r/issues/12$': { body: { state: 'closed' } } }, botEv)
  assert.equal(noReadBot.code, 1, noReadBot.out)
  assert.deepEqual(marks(noReadBot), ['7 labels[]=held: maintainer', '12 labels[]=rejected'])
  assert.deepEqual(closes(noReadBot), ['issue 12'])
  assert.match(replies(noReadBot)[0], /查不到这个 PR，PR 没关.*投稿的 issue #12 已经标了 rejected、关掉了/)
  //   投稿 issue 没关上、标签没打上：照实说没处理完（不说「什么都没关」，也不说关了）
  for (const fix of [{ '^GET repos/o/r/issues/12$': { body: { state: 'open' } } }, { '^GET repos/o/r/issues/12$': { body: { state: 'closed' } }, '^POST repos/o/r/issues/\\d+/labels$': { codes: [0, 1] } }, { '^GET repos/o/r/issues/12$': { code: 1 } }]) {
    const r = go({ '^GET repos/o/r/pulls/7$': { code: 1 }, '^issue close$': {}, ...fix }, botEv)
    assert.equal(r.code, 1, r.out)
    assert.match(replies(r)[0], /投稿的 issue #12 没处理完/, JSON.stringify(fix))
    assert.equal(replies(r).length, 1)
  }
  //   读出来了但缺作者、缺状态、缺 merged（不能当成「别人开的」）：和读不出一样，拿事件里的投稿 issue 保护
  for (const pr of [{ state: 'open', merged: false, body: '' }, { state: 'open', merged: false, user: {}, body: '' }, { state: 'open', merged: false, user: { login: '' } }, { merged: false, user: { login: 'bot[bot]' } }, { state: 'open', user: { login: 'bot[bot]' } }]) {
    const r = go({ '^GET repos/o/r/pulls/7$': { body: pr }, '^issue close$': {}, '^GET repos/o/r/issues/12$': { body: { state: 'closed' } }, '^pr close$': {} }, botEv)
    assert.equal(r.code, 1, r.out)
    assert.deepEqual(closes(r), ['issue 12'], JSON.stringify(pr))
    assert.deepEqual(marks(r), ['7 labels[]=held: maintainer', '12 labels[]=rejected'])
    assert.match(replies(r)[0], /查不到这个 PR，PR 没关/)
  }
  //   机器人开的 PR、现在的说明里没有投稿 issue（被维护者改过）：用事件里的；两处都没有：照样关 PR，说清楚、算失败
  const fromEv = go(botFix({ '^GET repos/o/r/pulls/7$': { bodies: [botPr('改过的说明'), O, C] } }), botEv)
  assert.equal(fromEv.code, 0, fromEv.out)
  assert.deepEqual(closes(fromEv), ['issue 12', 'pr 7', 'pr 30'])
  const noIss = go({ '^GET repos/o/r/pulls/7$': { bodies: [botPr('改过的说明'), O, C] }, '^pr close$': {} }, { issue: { number: 7, pull_request: {}, user: { login: 'bot[bot]' }, body: '' } })
  assert.equal(noIss.code, 1, noIss.out)
  assert.deepEqual(closes(noIss), ['pr 7'])
  assert.match(replies(noIss).pop(), /读不出它是哪个投稿 issue 的/)
  //   别人开的 PR（事件里的作者不是机器人）：不碰 issue
  const noReadEve = go({ '^GET repos/o/r/pulls/7$': { code: 1 } }, { issue: { number: 7, pull_request: {}, user: { login: 'eve' }, body: 'Submission: https://github.com/o/r/issues/12' } })
  assert.deepEqual(marks(noReadEve), ['7 labels[]=held: maintainer'])
  assert.deepEqual(closes(noReadEve), [])
  assert.ok(bot.calls.findIndex((c) => c.route.endsWith('/labels')) < bot.calls.findIndex((c) => c.args[1] === 'close'))
  // 记号打不上：照样关、回原因，最后说清楚、算失败（再发一次）
  const noMark = go(botFix({ '^POST repos/o/r/issues/\\d+/labels$': { code: 1 } }))
  assert.equal(noMark.code, 1, noMark.out)
  assert.deepEqual(closes(noMark), ['issue 12', 'pr 7', 'pr 30'])
  assert.match(replies(noMark).pop(), /没打上「拒了」的标签/)
  // 关的时候不带 --comment（gh 会先发评论再关：评论发不出去就关不了、评论发了关不上又成了「先回话」）；都关上了再回原因
  assert.ok(bot.calls.filter((c) => c.args[1] === 'close').every((c) => !c.args.includes('--comment')))
  assert.deepEqual(comments(bot), ['pr 30', 'issue 7', 'issue 12'])
  assert.deepEqual(replies(bot), ['拒了 / Rejected\n', '拒了 / Rejected\n'])
  const lastClose = Math.max(...bot.calls.map((c, i) => (c.args[1] === 'close' ? i : -1)))
  assert.ok(bot.calls.findIndex((c) => c.args[0] === 'issue' && c.args[1] === 'comment') > lastClose)
  // 别人开的：不碰 issue
  const eveIss = go({ '^GET repos/o/r/pulls/7$': { bodies: [botPr(`Submission: ${url}`, 'eve'), O, C] }, '^pr close$': {} })
  assert.equal(eveIss.code, 0, eveIss.out)
  assert.deepEqual(closes(eveIss), ['pr 7'])
  // 机器人开的、写的是别的仓库的（认不出投稿 issue）：不碰那个 issue，照样关 PR，说清楚、算失败
  const xIss = go({ '^GET repos/o/r/pulls/7$': { bodies: [botPr('Submission: https://github.com/x/y/issues/12'), O, C] }, '^pr close$': {} })
  assert.equal(xIss.code, 1, xIss.out)
  assert.deepEqual(closes(xIss), ['pr 7'])
  assert.match(replies(xIss).pop(), /读不出它是哪个投稿 issue 的/)
  // 投稿的 issue 关不上：PR 也先不关、说清楚、算失败（再发一次 /reject）
  const stuck = go(botFix({ '^GET repos/o/r/issues/12$': { body: { state: 'open' } }, '^issue close$': { code: 1 } }))
  assert.equal(stuck.code, 1, stuck.out)
  assert.deepEqual(closes(stuck), ['issue 12'])
  assert.match(replies(stuck)[0], /投稿的 issue #12 没关上/)
  assert.equal(replies(stuck).length, 1)
  // 都关上了、在这儿回原因失败：投稿 issue 上照样留一份，这步算失败
  const noSay = go(botFix({ '^issue comment$': { codes: [1, 0] } }))
  assert.equal(noSay.code, 1, noSay.out)
  assert.deepEqual(closes(noSay), ['issue 12', 'pr 7', 'pr 30'])
  assert.deepEqual(comments(noSay), ['pr 30', 'issue 7', 'issue 12'])
  // issue 早就关了：不再关、不再贴原因，接着关 PR
  const already = go(botFix({ '^GET repos/o/r/issues/12$': { body: { state: 'closed' } } }))
  assert.equal(already.code, 0, already.out)
  assert.deepEqual(closes(already), ['pr 7', 'pr 30'])
  // 在 issue（网页投稿）上：关 issue（不另贴原因，最后回在 issue 上），再把机器人替它开的 PR 一起关
  const iurl = 'https://github.com/o/r/issues/7'
  const list = [
    { number: 20, user: { login: 'bot[bot]' }, body: `Submitted-by: alice (42)\r\nSubmission: ${iurl}\r\n` },
    { number: 21, user: { login: 'eve' }, body: `Submission: ${iurl}` },
    { number: 22, user: { login: 'bot[bot]' }, body: `Submission: ${iurl}0` },
  ]
  const iss = { issue: { number: 7, html_url: iurl } }
  const is = go({ '^issue close$': {}, '^GET repos/o/r/issues/7$': { bodies: [{ state: 'open' }, { state: 'closed' }] }, '^GET repos/o/r/pulls\\?state=open': { body: list }, '^pr close$': {} }, iss)
  assert.equal(is.code, 0, is.out)
  assert.deepEqual(closes(is), ['issue 7', 'pr 20'])
  assert.ok(!is.calls.find((c) => c.args[1] === 'close' && c.args[0] === 'issue').args.includes('--comment'))
  assert.deepEqual(replies(is), ['拒了 / Rejected\n'])
  // issue 关不上、PR 列表查不到、PR 关不上：说清楚，算失败
  for (const [fix, re] of [
    [{ '^issue close$': { code: 1 }, '^GET repos/o/r/issues/7$': { body: { state: 'open' } } }, /投稿的 issue #7 没关上/],
    [{ '^issue close$': {}, '^GET repos/o/r/issues/7$': { body: { state: 'closed' } }, '^GET repos/o/r/pulls\\?state=open': { code: 1 } }, /查不到机器人替投稿 #7 开的别的 PR/],
    [{ '^issue close$': {}, '^GET repos/o/r/issues/7$': { body: { state: 'closed' } }, '^GET repos/o/r/pulls\\?state=open': { body: list }, '^pr close$': { code: 1 } }, /另一个 PR #20 没关上/],
  ]) {
    const r = go(fix, iss)
    assert.equal(r.code, 1, r.out)
    assert.match(replies(r)[0], re)
  }
})

test('维护者命令 apply「照做」：对同一个账号 / 同一套设计已经有更晚的命令生效了（这条是旧的）——不改、不推，说清楚', { skip: SKIP }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-stale-'))
  fs.writeFileSync(path.join(cwd, 'action.json'), JSON.stringify({ action: 'trust', login: 'alice', uid: 42, stale: true, changed: '' }))
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  const r = runStep('chatops.yml', '照做', { fix: { '^issue comment$': {} }, env: { GH_TOKEN: 'app', N: '7', ACTOR: 'maint', GITHUB_OUTPUT: o }, cwd })
  assert.equal(r.code, 0, r.out)
  assert.match(replies(r)[0], /这条旧的没改/)
  assert.equal(fs.readFileSync(o, 'utf8'), 'did=true\n') // 只记下「照做」开始了，没交给 confirm
  // apply 把评论时间传给 chatops.mjs
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/chatops.yml'), 'utf8')
  assert.match(y, /COMMENT_AT: \$\{\{ github\.event\.comment\.created_at \}\}/)
})

test('confirm「核对、回话」：/hold——PR 已经合并了就说来不及、查不到就说清楚；没合并、issue 上的照常回；/untrust——列出评论之后这个人（按 id，含机器人代开的）合并的 PR', { skip: SKIP }, () => {
  const SINCE = '2026-11-12T10:00:00Z'
  const go = (action, fix, isPr = 'true') => runStep('chatops.yml', '核对、回话（/hold、/untrust）', { fix: { '^issue comment$': {}, ...fix }, env: { GH_TOKEN: 'app', N: '7', IS_PR: isPr, SINCE, APP_SLUG: 'bot', ACTION_JSON: JSON.stringify(action) } })
  const hold = { action: 'hold', text: '先挂起 / On hold' }
  const open = go(hold, { '^GET repos/o/r/pulls/7$': { body: { merged: false } } })
  assert.equal(open.code, 0, open.out)
  assert.deepEqual(replies(open), ['先挂起 / On hold\n'])
  const merged = go(hold, { '^GET repos/o/r/pulls/7$': { body: { merged: true } } })
  assert.equal(merged.code, 0, merged.out)
  assert.match(replies(merged)[0], /核对时这个 PR 已经合并了/) // 只说核对时已经合了（分不清是不是后来又批准合的）
  const err = go(hold, { '^GET repos/o/r/pulls/7$': { code: 1 } })
  assert.equal(err.code, 1, err.out)
  assert.match(replies(err)[0], /查不到这个 PR 是不是已经合并了/)
  const issue = go(hold, {}, 'false')
  assert.equal(issue.code, 0, issue.out)
  assert.deepEqual(replies(issue), ['先挂起 / On hold\n'])
  // apply 没能给 /hold 点上 👀：回话里说一声
  const unrec = go({ ...hold, unrecorded: true }, { '^GET repos/o/r/pulls/7$': { body: { merged: false } } })
  assert.equal(unrec.code, 0, unrec.out)
  assert.match(replies(unrec)[0], /^先挂起 \/ On hold\n\n⚠ 没能给这条 \/hold 点上 👀/)
  // 查不到合没合并、已经合并了：也带上这一句
  const unrecErr = go({ ...hold, unrecorded: true }, { '^GET repos/o/r/pulls/7$': { code: 1 } })
  assert.equal(unrecErr.code, 1, unrecErr.out)
  assert.match(replies(unrecErr)[0], /查不到这个 PR 是不是已经合并了[^\n]*\n\n⚠ 没能给这条 \/hold 点上 👀/)
  const unrecMerged = go({ ...hold, unrecorded: true }, { '^GET repos/o/r/pulls/7$': { body: { merged: true } } })
  assert.match(replies(unrecMerged)[0], /核对时这个 PR 已经合并了[^\n]*\n\n⚠ 没能给这条 \/hold 点上 👀/)
  assert.ok(!issue.calls.some((c) => c.route.startsWith('GET repos/o/r/pulls')))
  // /untrust
  const un = { action: 'untrust', login: 'alice', uid: 42 }
  const p = (number, user, merged_at, updated_at = merged_at || '2026-11-12T11:00:00Z', body = '') => ({ number, user, merged_at, updated_at, body })
  const list = [
    p(11, { login: 'alice', id: 42 }, '2026-11-12T10:00:05Z'),
    p(12, { login: 'bot[bot]', id: 1 }, '2026-11-12T10:00:06Z', undefined, 'x\nSubmitted-by: alice (42)\ny'),
    p(13, { login: 'eve', id: 7 }, '2026-11-12T10:00:07Z'),
    p(14, { login: 'alice', id: 42 }, null),
    p(15, { login: 'bot[bot]', id: 1 }, '2026-11-12T10:00:08Z', undefined, 'Submitted-by: alice (420)'),
    p(10, { login: 'alice', id: 42 }, '2026-11-12T09:00:00Z'),
  ]
  const u = go(un, { '^GET repos/o/r/pulls\\?state=closed': { body: list } })
  assert.equal(u.code, 0, u.out)
  assert.match(replies(u)[0], /^✓ 已处理：untrust。⚠ 这条命令发出以后，这个人有这些 PR 合并了，请核对一下：#11 #12 （/) // 不断言是按旧名单合的（可能是后来批准的）
  const none = go(un, { '^GET repos/o/r/pulls\\?state=closed': { body: [list[2], list[5]] } })
  assert.deepEqual(replies(none), ['✓ 已处理：untrust / Done: untrust\n'])
  // 翻页：满一页、最后一个还晚于评论就接着翻
  const full = Array.from({ length: 100 }, (_, i) => p(100 + i, { login: 'eve', id: 7 }, '2026-11-12T10:30:00Z'))
  const paged = go(un, { '^GET repos/o/r/pulls\\?state=closed': { bodies: [full, [list[0]]] } })
  assert.equal(paged.code, 0, paged.out)
  assert.match(replies(paged)[0], /#11/)
  assert.equal(paged.calls.filter((c) => c.route.includes('state=closed')).length, 2)
  // 查不到、读坏了：回话说没查全，算失败
  for (const bad of [{ code: 1 }, { body: { message: 'x' } }]) {
    const b = go(un, { '^GET repos/o/r/pulls\\?state=closed': bad })
    assert.equal(b.code, 1, b.out)
    assert.match(replies(b)[0], /没查全/)
  }
})

test('chatops 解析：/trust、/untrust 写在说明下面一行、前面有空格、网页的 CRLF 换行——同一个解析器拿用户名、查数字 id、照写；查不到不改；别的命令不查账号', { skip: SKIP }, () => {
  const go = (body, fix = { '^GET users/alice$': { body: { id: 42 } } }) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-parse-'))
    fs.mkdirSync(path.join(cwd, 'policy'))
    fs.writeFileSync(path.join(cwd, 'policy/trust-overrides.json'), '{}')
    const r = runStep('chatops.yml', '解析命令、改规矩文件', { fix, cwd, extra: { npm: '#!/bin/bash\nexit 0\n' }, env: { COMMENT_BODY: body, COMMENT_AT: '2026-11-13T01:00:00Z', IS_PR: 'true', GH_TOKEN: 'app', GALLERY_ROOT: '' } })
    return { r, a: JSON.parse(fs.readFileSync(path.join(cwd, 'action.json'), 'utf8')), trust: JSON.parse(fs.readFileSync(path.join(cwd, 'policy/trust-overrides.json'), 'utf8')) }
  }
  for (const b of ['请收紧一下\r\n/untrust @Alice', '  /untrust alice', '说明\n\t/untrust @alice 理由']) {
    const { r, a, trust } = go(b)
    assert.equal(r.code, 0, r.out)
    assert.equal(a.action, 'untrust', b)
    assert.equal(trust['id:42'].tier, 'T0', b)
    assert.ok(r.calls.some((c) => c.route === 'GET users/alice'), b)
  }
  const miss = go('/untrust @alice', { '^GET users/alice$': { code: 1 } })
  assert.equal(miss.r.code, 0, miss.r.out)
  assert.equal(miss.a.action, 'error')
  assert.deepEqual(miss.trust, {})
  for (const b of ['/hold', '看这里 https://x.y/z', 'hello /untrust @alice']) {
    const x = go(b)
    assert.equal(x.r.code, 0, x.r.out)
    assert.ok(!x.r.calls.some((c) => c.route.startsWith('GET users/')), b)
    assert.deepEqual(x.trust, {}, b)
  }
})

test('chatops 的 cancelled：apply 被取消、/approve 被取消（照实说合没合并）、/hold /untrust 的核对被取消——各说清楚', { skip: SKIP }, () => {
  const go = (APPLY, ACTION, merged = { body: { merged: false } }, COMMENT_BODY = ACTION === 'merge' ? '/approve x' : '  /untrust @a', scripts = {}) => replies(runStep('chatops.yml', '说一声命令被取消了', { fix: { '^issue comment$': {}, '^GET repos/o/r/pulls/7$': merged }, env: { GH_TOKEN: 'app', N: '7', APPLY, ACTION, COMMENT_BODY, IS_PR: 'true', GALLERY_ROOT: '' }, scripts }))[0]
  assert.match(go('cancelled', ''), /可能没做完，请再发一次/)
  // apply 在「照做」之前就失败了：说没能处理、什么都没改
  assert.match(go('failure', ''), /没能处理（准备的时候出错了，什么都没改），请再发一次/)
  assert.match(go('failure', '', undefined, '/reject spam'), /没能处理/)
  assert.equal(go('failure', '', undefined, '看这里 https://x.y/z'), undefined)
  // 网页发的评论是 \r\n 换行、命令单独一行：照样认得
  assert.match(go('cancelled', '', undefined, '/hold\r\n请等一下'), /可能没做完，请再发一次/)
  // 不是命令（第一条 / 开头的行不是认得的命令、/ 只在句子中间）：不说
  for (const b of ['看这里 https://x.y/z', '/approved 了吗', '路径 a/b\n/ 单独一个']) assert.equal(go('cancelled', '', undefined, b), undefined, b)
  // 和 apply 用同一个解析器：NBSP、BOM 之类的空白照样认得
  for (const b of ['/approve\u00a0' + 'a'.repeat(40), '\ufeff/hold\u00a0other', '\u3000/reject']) assert.match(go('cancelled', '', undefined, b), /可能没做完/, JSON.stringify(b))
  // 准备步骤（取代码、装 node）出错了也接着回话
  const cj = fs.readFileSync(path.join(REAL, '.github/workflows/chatops.yml'), 'utf8')
  const cpart = cj.slice(cj.indexOf('\n  cancelled:\n'))
  for (const u of ['actions/checkout@v4', 'actions/setup-node@v4']) assert.match(cpart, new RegExp(`- uses: ${u.replace(/[.]/g, '\\.')}\n        continue-on-error: true\n        timeout-minutes: \\d+\n`), u)
  // 解析器自己出错了：当成是命令照说（多说一句不碍事）
  assert.match(go('cancelled', '', undefined, '看这里 https://x.y/z', { 'chatops.mjs': 'process.exit(1)\n' }), /可能没做完/)
  assert.match(go('success', 'merge'), /没有合并，请再发一次/)
  assert.match(go('success', 'merge', { body: { merged: true } }), /不过 PR 已经合并了/)
  assert.match(go('success', 'merge', { code: 1 }), /查不到合没合并/)
  assert.match(go('success', 'untrust'), /命令已经生效，但排队核对时被取消了/)
})

test('/approve：检查算完以后 main 上的设计、检查规则动过（别的投稿先合进来、规则改了）——不合、让检查按现在的 main 重算；只动了别的（精选、说明）照合；没记 main 版本、版本不在历史里都不合', { skip: SKIP }, () => {
  for (const f of ['templates/alice-1__mint/template.json', 'styles/carol__abc/style.json', 'systems/x__y/s.json', 'scripts/check.mjs', 'vocab/tags.json', 'package-lock.json', '.github/workflows/pr-gate.yml']) {
    const r = approve({ checks: { body: gateRuns([5, 'success']) }, main: f })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 0, f)
    assert.match(replies(r)[0], /检查算完以后 main 动过/)
    assert.deepEqual(r.calls.filter((c) => c.route.startsWith('graphql:')).map((c) => c.route.slice(8)), RERUN)
  }
  for (const f of ['policy/featured.json', 'README.md']) {
    const r = approve({ checks: { body: gateRuns([5, 'success']) }, main: f })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 1, f)
  }
  // 没记 main 版本（旧写法）：当成没算完
  const old = approve({ checks: { body: gateRuns([5, 'success', 'completed', `100/1/${PS}`]) } })
  assert.equal(merges(old).length, 0)
  assert.match(replies(old)[0], /（pending）/)
  // 记的版本不在历史里、写法不对：error，不合
  for (const b of ['f'.repeat(12), 'zz' + 'f'.repeat(10)]) {
    const r = approve({ checks: { body: gateRuns([5, 'success', 'completed', `100/1/${PS}/${b}`]) } })
    assert.equal(r.code, 0, r.out)
    assert.equal(merges(r).length, 0, b)
    assert.match(replies(r)[0], /（error）/)
  }
})

test('/approve <完整提交号>：只合写的那一版——PR 现在不是这一版不合；之后有维护者发了 /hold、打上了 held: maintainer 不合（查不到也不合），之前挂起的照合（合完摘标签）；不是往 main 合的、投稿的 issue 关了都不合', { skip: SKIP }, () => {
  const gate = { body: gateRuns([5, 'success']) }
  const B = 'b'.repeat(40)
  const no = (r, re, code = 0) => { assert.equal(r.code, code, r.out); assert.equal(merges(r).length, 0, r.out); assert.match(replies(r)[0], re) }
  // 现在是 B，批准的是 SHA（之后作者推了）：不合，告诉现在是哪一版
  no(approve({ views: [{ headRefOid: B }], checks: gate }), new RegExp(`PR 现在是 bbbbbbb，不是你批准的 aaaaaaa.*/approve ${B}`))
  // 批准的是 B、现在是 SHA（强推回以前的）
  no(approve({ checks: gate, want: B }), /不是你批准的 bbbbbbb/)
  // 交过来的提交号不对（短号、没有）：失败
  for (const want of [SHA.slice(0, 7), '']) no(approve({ checks: gate, want }), /读不出要合的是哪一版/, 1)
  // 等草稿标回的时候作者推了 B：再核那一下认出来
  no(approve({ views: [{}, {}, { isDraft: true }, {}, { headRefOid: B }], checks: gate }), /PR 变了/)
  // 之后有维护者发了 /hold（标签本来就挂着时不会多出打标签的记录，只能看评论）：不合
  const c = (id, login, body, type = 'User', created_at = '2026-11-13T01:00:05Z') => ({ id, user: { login, type }, body, created_at })
  const perm = (p) => ({ '^GET repos/o/r/collaborators/[^/]+/permission$': p })
  no(approve({ checks: gate, later: [c(501, 'maint2', '/hold other')], more: perm({ body: { permission: 'write' } }) }), /又挂起了/)
  no(approve({ checks: gate, later: [c(501, 'maint2', '看了一下\n  /hold')], more: perm({ body: { permission: 'admin' } }) }), /又挂起了/)
  // 和命令解析一样认（﻿ 之类 JS 当空白的字符）；同一秒发的（id 更小）按保护的算；时间读不出来也算
  no(approve({ checks: gate, later: [c(501, 'maint2', '/hold﻿other')], more: perm({ body: { permission: 'write' } }) }), /又挂起了/)
  no(approve({ checks: gate, later: [c(499, 'maint2', '/hold', 'User', SINCE)], more: perm({ body: { permission: 'write' } }) }), /又挂起了/)
  no(approve({ checks: gate, later: [c(499, 'maint2', '/hold', 'User', 'garbage')], more: perm({ body: { permission: 'write' } }) }), /又挂起了/)
  no(approve({ checks: gate, more: { '^GET repos/o/r/issues/7/comments\\?per_page=100$': { pages: [[c(400, 'x', 'hi')], [c(501, 'maint2', '/hold')]] }, ...perm({ body: { permission: 'maintain' } }) } }), /又挂起了/)
  // 发 /hold 的人后来降权了，但这条当时生效了（机器人给它点了 👀）：还是不合；别人点的 👀 不算；查不到算挂起了
  const eyes = (login, code = 0) => ({ '^GET repos/o/r/issues/comments/501/reactions\\?content=eyes': code ? { code } : { body: [{ id: 1, content: 'eyes', user: { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' } }] } })
  no(approve({ checks: gate, later: [c(501, 'maint2', '/hold')], more: { ...perm({ body: { permission: 'read' } }), ...eyes('bot[bot]') } }), /又挂起了/)
  no(approve({ checks: gate, later: [c(501, 'maint2', '/hold')], more: { ...perm({ body: { permission: 'read' } }), ...eyes('x', 1) } }), /又挂起了/)
  // /reject 关不上（PR 还开着、没有关闭记录），发的人后来降权了：机器人当时点了 👀，也不合
  no(approve({ checks: gate, later: [c(501, 'maint2', '/reject spam')], more: { ...perm({ body: { permission: 'read' } }), ...eyes('bot[bot]') } }), /又挂起了/)
  const otherEyes = approve({ checks: gate, later: [c(501, 'maint2', '/hold')], more: { ...perm({ body: { permission: 'read' } }), ...eyes('maint2') } })
  assert.equal(merges(otherEyes).length, 1, otherEyes.out)
  // 查不到评论、查不到权限：算挂起了
  no(approve({ checks: gate, later: [c(501, 'maint2', '/hold')], more: perm({ code: 1 }) }), /又挂起了/)
  no(approve({ checks: gate, more: { '^GET repos/o/r/issues/7/comments\\?per_page=100$': { code: 1 } } }), /又挂起了/)
  // 不算：这条之前的、机器人发的、不是维护者的、不是 /hold 的、第一条命令不是 /hold 的
  for (const [later, p] of [[[c(500, 'maint2', '/hold')], 'write'], [[c(499, 'maint2', '/hold', 'User', '2026-11-13T00:59:59Z')], 'write'], [[c(501, 'bot[bot]', '/hold', 'Bot')], 'write'], [[c(501, 'eve', '/hold')], 'read'], [[c(501, 'maint2', '/holdx')], 'write'], [[c(501, 'maint2', '/approve x\n/hold')], 'write']]) {
    const r = approve({ checks: gate, later, more: perm({ body: { permission: p } }) })
    assert.equal(merges(r).length, 1, JSON.stringify(later) + r.out)
  }
  // 挂起的标签：评论之后打上的不合；之前就挂着的照合，合完摘掉
  const labels = { '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [{ name: 'held: maintainer' }] } }
  const ev = (t) => ({ '^GET repos/o/r/issues/7/events': { body: [{ event: 'labeled', label: { name: 'held: maintainer' }, created_at: '2026-11-12T00:00:00Z' }, { event: 'labeled', label: { name: 'held: maintainer' }, created_at: t }] } })
  no(approve({ checks: gate, more: { ...labels, ...ev('2026-11-13T01:00:03Z') } }), /发 \/approve 之后又挂起了/)
  no(approve({ checks: gate, more: { ...labels, ...ev(SINCE) } }), /又挂起了/)
  no(approve({ checks: gate, more: { ...labels, '^GET repos/o/r/issues/7/events': { code: 1 } } }), /又挂起了/)
  no(approve({ checks: gate, more: { '^GET repos/o/r/issues/7/labels\\?per_page=100$': { code: 1 } } }), /又挂起了/)
  const before = approve({ checks: gate, more: { ...labels, ...ev('2026-11-13T00:59:00Z') } })
  assert.equal(merges(before).length, 1, before.out)
  assert.ok(before.calls.some((x) => x.args[0] === 'pr' && x.args[1] === 'edit' && x.args.includes('held: maintainer')))
  // 这条 /approve 之后（同一秒也算）PR 被关过、又重开了（/reject 了，关的人后来不是维护者了；作者重开）：不合；之前关过又开的照合；
  //   等草稿标回的时候关过的，再核那一下认出来；事件记录查不到也不合
  const closedAt = (t, id = 9, r = '2026-11-13T02:00:00Z') => ({ '^GET repos/o/r/issues/7/events': { body: [{ event: 'closed', actor: { id }, created_at: t }, { event: 'reopened', actor: { id: 5 }, created_at: r }] } })
  no(approve({ checks: gate, more: closedAt('2026-11-13T01:00:30Z') }), /关了又重开/)
  no(approve({ checks: gate, more: closedAt(SINCE) }), /关了又重开/)
  no(approve({ checks: gate, more: closedAt('2026-11-13T01:00:30Z', 5) }), /关了又重开/) // 作者自己关的也作废（PR 变过）
  assert.equal(merges(approve({ checks: gate, more: closedAt('2026-11-13T00:59:00Z', 9, '2026-11-13T00:59:30Z') })).length, 1)
  // /approve 时 PR 正关着（之前关的），之后有人 /reject（不再关一次、标签本来就在）、作者再重开：重开在这条之后，也不合
  no(approve({ checks: gate, more: closedAt('2026-11-12T00:00:00Z', 5, '2026-11-13T01:00:30Z') }), /关了又重开/)
  no(approve({ views: [{}, {}, { isDraft: true }, {}, {}], checks: gate, more: { '^GET repos/o/r/issues/7/events': { bodies: [[], [{ event: 'closed', actor: { id: 9 }, created_at: '2026-11-13T01:00:30Z' }]] } } }), /关了又重开/)
  no(approve({ checks: gate, more: { '^GET repos/o/r/issues/7/events': { code: 1 } } }), /又挂起了/)
  // 机器人代开的：投稿的 issue 在这条 /approve 之后关过又开了（作者重开、拒稿标签没打上）也不合；之前关过的照合
  const botOpen = { '^GET repos/o/r/pulls/7$': { body: pr({ user: { login: 'bot[bot]' }, body: 'Submitted-by: a (1)\nSubmission: https://github.com/o/r/issues/3\n' }) }, '^GET repos/o/r/issues/3$': { body: { state: 'open', labels: [] } } }
  const issClosed = (t) => ({ '^GET repos/o/r/issues/3/events': { body: [{ event: 'closed', actor: { id: 1 }, created_at: t }] } })
  no(approve({ checks: gate, more: { ...botOpen, ...issClosed('2026-11-13T01:00:30Z') } }), /关了又重开/)
  assert.equal(merges(approve({ checks: gate, more: { ...botOpen, ...issClosed('2026-11-12T00:00:00Z') } })).length, 1)
  // 等草稿标回的时候挂上了：再核那一下认出来，不合
  const mid = approve({ views: [{}, {}, { isDraft: true }, {}, {}], checks: gate, more: { '^GET repos/o/r/issues/7/labels\\?per_page=100$': { bodies: [[], [{ name: 'held: maintainer' }]] }, ...ev('2026-11-13T01:00:30Z') } })
  no(mid, /又挂起了/)
  // 机器人替网页投稿开的 PR：投稿的 issue 关了（拒了、撤了）不合；查不到不合、算失败；开着照合
  const botPr = { '^GET repos/o/r/pulls/7$': { body: pr({ user: { login: 'bot[bot]' }, body: 'Submitted-by: a (1)\r\nSubmission: https://github.com/o/r/issues/3\r\n' }) } }
  no(approve({ checks: gate, more: { ...botPr, '^GET repos/o/r/issues/3$': { body: { state: 'closed' } } } }), /投稿的 issue 已经关了/)
  no(approve({ checks: gate, more: { ...botPr, '^GET repos/o/r/issues/3$': { code: 1 } } }), /查不到投稿的 issue/, 1)
  assert.equal(merges(approve({ checks: gate, more: { ...botPr, '^GET repos/o/r/issues/3$': { body: { state: 'open' } } } })).length, 1)
  // 不是往 main 合的
  no(approve({ views: [{ baseRefName: 'submission/5' }], checks: gate }), /不是往 main 合的/)
})

test('闸门可信侧重查：查的是合进 main 以后的样子——PR 动到的目录合并出来和 PR 里不一样就报 behind、合不到一起报 conflict（交给 check.mjs）；main 只动了别处不碍事', { skip: SKIP }, () => {
  const go = (mainChange) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-trusted-'))
    gitIn(cwd, 'init', '-q', '-b', 'main')
    const put = (f, t) => { fs.mkdirSync(path.join(cwd, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(cwd, f), t) }
    put('templates/alice__a/a.txt', 'a\n'); put('styles/bob__b/s.json', '{}\n')
    gitIn(cwd, 'add', '.'); gitIn(cwd, 'commit', '-qm', 'm0')
    const m0 = gitIn(cwd, 'rev-parse', 'HEAD')
    gitIn(cwd, 'checkout', '-q', '-b', 'pr')
    put('templates/alice__a/b.txt', 'pr\n'); gitIn(cwd, 'add', '.'); gitIn(cwd, 'commit', '-qm', 'pr')
    const head = gitIn(cwd, 'rev-parse', 'HEAD')
    gitIn(cwd, 'checkout', '-q', 'main')
    mainChange(put, (f) => gitIn(cwd, 'rm', '-q', f))
    gitIn(cwd, 'add', '-A'); gitIn(cwd, 'commit', '-qm', 'm1', '--allow-empty')
    fs.writeFileSync(path.join(cwd, 'pr.json'), JSON.stringify({ base: { sha: m0 }, head: { repo: { clone_url: cwd } } }))
    const scripts = {
      'changed.mjs': "process.stdout.write('templates/alice__a\\n')\n",
      'extract.mjs': '',
      'check.mjs': "import fs from 'node:fs'; fs.mkdirSync(process.env.OUT, { recursive: true }); fs.writeFileSync(process.env.OUT + '/results.json', JSON.stringify({ conflict: process.env.CONFLICT, behind: process.env.BEHIND }))\n",
    }
    const r = runStep('pr-gate.yml', '可信侧重查（不信产物）：按 PR 的真实改动重算结构守卫、归属、规则', { cwd, scripts, env: { RUN_SHA: head }, sub: { '${{ github.server_url }}/${{ github.repository }}.git': cwd } })
    assert.equal(r.code, 0, r.out)
    return JSON.parse(fs.readFileSync(path.join(cwd, 'trusted/results.json'), 'utf8'))
  }
  assert.deepEqual(go((put) => put('styles/bob__b/s.json', '{"x":1}\n')), { conflict: '0', behind: '' })
  assert.deepEqual(go((put, rm) => rm('templates/alice__a/a.txt')), { conflict: '0', behind: ' templates/alice__a' })
  assert.deepEqual(go((put) => put('templates/alice__a/c.txt', 'main\n')), { conflict: '0', behind: ' templates/alice__a' })
  assert.deepEqual(go((put) => put('templates/alice__a/b.txt', 'main\n')), { conflict: '1', behind: '' })
})

test('base-moved.sh：只看会影响结论的地方（设计目录、scripts、vocab、schema、依赖、工作流）；参数不对、版本不在历史里都算说不准', { skip: SKIP }, () => {
  const go = (base, main) => {
    const cwd = withBase(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-moved-')))
    if (main) mainAdds(cwd, main)
    return spawnSync('bash', [path.join(REAL, 'scripts/base-moved.sh'), ...(base === undefined ? [] : [base])], { cwd, encoding: 'utf8' }).status
  }
  assert.equal(go(BASE), 0)
  assert.equal(go(B12), 0)
  for (const f of ['templates/a__b/x.html', 'systems/a__b/x.json', 'styles/a__b/x.json', 'scripts/x.mjs', 'vocab/x.json', 'schema/x.json', 'package.json', 'package-lock.json', '.github/workflows/x.yml']) assert.equal(go(BASE, f), 3, f)
  for (const f of ['policy/featured.json', 'README.md', 'docs/x.md', 'templatesx/a.json']) assert.equal(go(BASE, f), 0, f)
  for (const b of [undefined, '', 'xyz', 'f'.repeat(40), BASE.slice(0, 11), ':(glob)*']) assert.equal(go(b), 1, String(b))
  // 比的是 GitHub 上现在的 main（检出之后 main 又合进了别的），不是检出的那份
  const remote = withBase(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-remote-')))
  const cwd = withBase(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-moved-')))
  gitIn(cwd, 'remote', 'set-url', 'origin', remote)
  const run = () => spawnSync('bash', [path.join(REAL, 'scripts/base-moved.sh'), BASE], { cwd, encoding: 'utf8' }).status
  assert.equal(run(), 0)
  mainAdds(remote, 'styles/carol__abc/style.json')
  assert.equal(run(), 3)
  // 取不到：说不准
  gitIn(cwd, 'remote', 'set-url', 'origin', path.join(remote, 'nope'))
  assert.equal(run(), 1)
})

test('闸门写结果（post）：gate.json 没记算的时候 main 是哪一版——失败、不写', { skip: SKIP }, () => {
  for (const gate of [{ base: undefined }, { base: 'x' }]) {
    const { cwd, o } = gateBox(gate)
    const fix = baseFix({ '^GET repos/o/r/actions/workflows/pr-check.yml/runs': runsOf(['success']), '^GET repos/o/r/issues/7/labels\\?per_page=100$': { body: [] }, ...POLICY_FIX })
    const r = runStep('pr-gate.yml', POST_STEP, { fix, env: postEnv(o), cwd })
    assert.notEqual(r.code, 0, JSON.stringify(gate))
    assert.deepEqual(writesOf(r), [])
  }
})

test('标签都分页取全（维护者的 held: maintainer 可能在第二页）；pr-check 按 PR + 提交分组（重跑旧提交不取消现在提交的那回）', () => {
  for (const f of ['.github/workflows/pr-gate.yml', 'scripts/incomplete-lib.sh', '.github/workflows/chatops.yml', '.github/workflows/scheduled.yml']) {
    const code = fs.readFileSync(path.join(REAL, f), 'utf8')
    for (const m of code.matchAll(/gh api[^\n]*issues\/\$[A-Za-z]+\/labels[^\n]*/g)) {
      if (/-X (DELETE|POST)/.test(m[0])) continue
      assert.match(m[0], /--paginate .*labels\?per_page=100"/, `${f}: ${m[0]}`)
    }
  }
  const chk = fs.readFileSync(path.join(REAL, '.github/workflows/pr-check.yml'), 'utf8')
  assert.match(chk, /\nconcurrency:\n  group: pr-check-\$\{\{ github\.event\.pull_request\.number \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \}\}\n  cancel-in-progress: true\n/)
})

test('网页投稿开 PR：开完（不管开 PR 那步成没成）按分支找机器人开的 PR——issue 还开着就交出链接；issue 关了就都关掉（先关再说原因）', { skip: SKIP }, () => {
  const go = (state, list, branch = 'submission/5', events = { body: [] }) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-intake-'))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const fix = { '^GET repos/o/r/pulls\\?state=open&per_page=100&head=o:submission/5$': { body: list }, '^GET repos/o/r/issues/5$': state, '^GET repos/o/r/issues/5/events': events, '^pr close$': {}, '^pr comment$': {} }
    const r = runStep('issue-intake.yml', '开完再看一眼 issue', { fix, env: { GH_TOKEN: 'app', N: '5', AUTHOR_ID: '50', BRANCH: branch, APP_SLUG: 'bot', GITHUB_OUTPUT: o }, cwd })
    return { ...r, outp: fs.readFileSync(o, 'utf8') }
  }
  const list = [{ number: 9, html_url: 'https://github.com/o/r/pull/9', user: { login: 'bot[bot]' } }, { number: 10, html_url: 'https://github.com/o/r/pull/10', user: { login: 'eve' } }]
  const open = go({ body: { state: 'open' } }, list)
  assert.equal(open.code, 0, open.out)
  assert.equal(open.outp, 'url=https://github.com/o/r/pull/9\n')
  assert.ok(!open.calls.some((c) => c.args[0] === 'pr'))
  // 还开着，但开 PR 的时候被维护者关过、作者又重开了：也算关了；作者自己关了又开的照常；查不到这步失败
  const ev = (id) => ({ body: [{ event: 'closed', actor: { id }, created_at: '2026-11-13T01:00:00Z' }, { event: 'reopened', actor: { id: 50 }, created_at: '2026-11-13T01:00:05Z' }] })
  const reop = go({ body: { state: 'open' } }, list, undefined, ev(99))
  assert.equal(reop.code, 0, reop.out)
  assert.equal(reop.outp, 'closed=true\n')
  assert.deepEqual(reop.calls.filter((c) => c.args[0] === 'pr').map((c) => `${c.args[1]} ${c.args[2]}`), ['close 9', 'comment 9'])
  const self = go({ body: { state: 'open' } }, list, undefined, ev(50))
  assert.equal(self.code, 0, self.out)
  assert.equal(self.outp, 'url=https://github.com/o/r/pull/9\n')
  const evErr = go({ body: { state: 'open' } }, list, undefined, { code: 1 })
  assert.notEqual(evErr.code, 0)
  assert.equal(evErr.outp, '')
  // 被拒了（rejected 标签：作者自己关过、又重开了）也算关了
  const rej = go({ body: { state: 'open', labels: [{ name: 'rejected' }] } }, list)
  assert.equal(rej.code, 0, rej.out)
  assert.equal(rej.outp, 'closed=true\n')
  assert.deepEqual(rej.calls.filter((c) => c.args[0] === 'pr').map((c) => `${c.args[1]} ${c.args[2]}`), ['close 9', 'comment 9'])
  const closed = go({ body: { state: 'closed' } }, list)
  assert.equal(closed.code, 0, closed.out)
  assert.equal(closed.outp, 'closed=true\n')
  assert.deepEqual(closed.calls.filter((c) => c.args[0] === 'pr').map((c) => `${c.args[1]} ${c.args[2]}`), ['close 9', 'comment 9'])
  assert.ok(!closed.calls.find((c) => c.args[1] === 'close').args.includes('--comment'))
  // 查不到、分支名不对、关不上：这步失败、什么都不交（回话那步按开 PR 那步的结果说，见下一个测试）
  assert.notEqual(go({ code: 1 }, list).code, 0)
  assert.notEqual(go({ body: { state: 'open' } }, list, 'main').code, 0)
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-intake-'))
  const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
  const bad = runStep('issue-intake.yml', '开完再看一眼 issue', { fix: { '^GET repos/o/r/pulls\\?state=open': { body: list }, '^GET repos/o/r/issues/5$': { body: { state: 'closed' } }, '^pr close$': { code: 1 } }, env: { GH_TOKEN: 'app', N: '5', AUTHOR_ID: '50', BRANCH: 'submission/5', APP_SLUG: 'bot', GITHUB_OUTPUT: o }, cwd })
  assert.notEqual(bad.code, 0)
  // 关不上：这步失败，但已经记下 issue 关了（回话那步不会说收到了）
  assert.equal(fs.readFileSync(o, 'utf8'), 'closed=true\n')
})

test('网页投稿：维护者 /reject 过的（rejected 标签，作者去不掉）——作者自己重开、再改也不处理、不开 PR', { skip: SKIP }, () => {
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/issue-intake.yml'), 'utf8')
  assert.match(y, /\n  unpack:\n(?:    #[^\n]*\n)*    if: [^\n]*&& !contains\(github\.event\.issue\.labels\.\*\.name, 'rejected'\)\n/)
  const run = (body, ev = { body: [] }, author = '50') => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-still-'))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const r = runStep('issue-intake.yml', 'issue 还开着才开 PR', { fix: { '^GET repos/o/r/issues/5$': { body }, '^GET repos/o/r/issues/5/events': ev }, env: { GH_TOKEN: 'app', N: '5', AUTHOR_ID: author, GITHUB_OUTPUT: o }, cwd })
    return { r, out: fs.readFileSync(o, 'utf8').trim() }
  }
  const go = (body, ev) => { const x = run(body, ev); assert.equal(x.r.code, 0, x.r.out); return x.out }
  const open = { state: 'open', labels: [{ name: 'submission' }] }
  assert.equal(go(open), 'open=true')
  assert.equal(go({ state: 'open', labels: [{ name: 'submission' }, { name: 'rejected' }] }), 'open=false')
  assert.equal(go({ state: 'closed' }), 'open=false')
  // rejected 标签没打上：被别人（维护者 /reject 时机器人、维护者手动）关过的也不开；作者自己关了又开的照开
  const closedBy = (id) => ({ body: [{ event: 'closed', actor: { id }, created_at: '2026-11-12T00:00:00Z' }, { event: 'reopened', actor: { id: 50 }, created_at: '2026-11-12T01:00:00Z' }] })
  assert.equal(go(open, closedBy(99)), 'open=false')
  assert.equal(go(open, closedBy(50)), 'open=true')
  // 查不到、投稿人 id 不对：失败，不开
  for (const [ev, author] of [[{ code: 1 }, '50'], [{ body: [] }, ''], [{ body: [] }, 'x']]) {
    const x = run(open, ev, author)
    assert.notEqual(x.r.code, 0)
    assert.doesNotMatch(x.out, /open=true/)
  }
})

test('网页投稿回话：这回的内容真放进了 PR（开 / 更新 PR 那步成功、找得到 PR）才附链接说收到；没成功就说没处理成，之前的 PR 说清楚还是上一版', { skip: SKIP }, () => {
  const go = (env) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-reply-'))
    fs.writeFileSync(path.join(cwd, 'reply.md'), '### ✓ 收到了\n')
    return replies(runStep('issue-intake.yml', '回复投稿人', { fix: { '^issue comment$': {}, '^issue edit$': {} }, env: { GH_TOKEN: 'app', N: '5', ...env }, cwd }))[0]
  }
  const url = 'https://github.com/o/r/pull/9'
  assert.equal(go({ OK: 'true', CPR: 'success', AFTER: 'success', PR_URL: url }), `### ✓ 收到了\n\nPR: ${url}\n`)
  // 开 / 更新 PR 那步失败（可能已经开了、更新了，只是加标签失败）、开完再看 issue 那步失败、找不到 PR：都不说收到了，说没能确认
  for (const env of [{ CPR: 'failure', AFTER: 'success', PR_URL: url }, { CPR: 'skipped', AFTER: 'skipped', PR_URL: url }, { CPR: 'success', AFTER: 'failure', PR_URL: url }, { CPR: 'success', AFTER: 'success', PR_URL: '' }, { CPR: 'skipped', AFTER: 'skipped', PR_URL: '' }]) {
    const r = go({ OK: 'true', ...env })
    assert.match(r, /没能确认处理完/, JSON.stringify(env))
    assert.doesNotMatch(r, /收到了|还是上一版/)
    if (env.PR_URL) assert.match(r, new RegExp(`请看一下里面是不是这一版.*${url}`))
  }
  // 没过检查：照 intake-apply 写的回
  assert.equal(go({ OK: 'false', CPR: 'skipped', PR_URL: '' }), '### ✓ 收到了\n')
})

test('举报（工作流）：举报人的注册时间按数字 id 查（改名、旧名被别人占了也不算错人）；返回的 id 对不上、查不到的不算；年龄按 id 记', { skip: SKIP }, () => {
  const step = '数有效举报，够了就先隐藏'
  const body = '### 设计 id / Design id\n\neve__bank\n\n### 问题 / Problem\n\n仿冒真实网站或机构 / Imitates a real site or organization\n\n### 说明 / Details\n\n_No response_'
  const iss = (login, id) => ({ number: 100 + id, state: 'open', created_at: '2026-11-05T00:00:00Z', user: { login, id, type: 'User' }, body })
  const old = '2025-01-01T00:00:00Z'
  const go = (users) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-rep-wf-'))
    const fix = { '^GET repos/o/r/issues\\?labels=report': { body: [iss('a', 1), iss('b', 2), iss('c', 3)] }, ...users }
    // 不真写 main：去掉 --apply、git 换成什么都不做的
    const r = runStep('reports.yml', step, { fix, env: { GH_TOKEN: 'app', ID: 'eve__bank' }, cwd, sub: { ' --apply': '' }, extra: { git: '#!/bin/bash\nexit 0\n' }, scripts: { 'reports.mjs': fs.readFileSync(path.join(REAL, 'scripts/reports.mjs'), 'utf8') } })
    const read = (f) => JSON.parse(fs.readFileSync(path.join(cwd, f), 'utf8'))
    return { r, ages: read('ages.json'), action: read('action.json') }
  }
  const u = (id, created_at = old, login = `u${id}`) => ({ [`^GET user/${id}$`]: { body: { id, login, created_at } } })
  const ok = go({ ...u(1), ...u(2), ...u(3) })
  assert.equal(ok.r.code, 0, ok.r.out)
  assert.deepEqual(ok.ages, { 1: old, 2: old, 3: old })
  assert.equal(ok.action.hide, true)
  assert.ok(!ok.r.calls.some((c) => c.route.startsWith('GET users/')), '不按用户名查')
  // 返回的 id 对不上、查不到（账号没了、接口出错）：这个人不算
  for (const bad of [{ '^GET user/3$': { body: { id: 33, login: 'c', created_at: old } } }, { '^GET user/3$': { code: 1 } }, { '^GET user/3$': { body: { message: 'x' } } }]) {
    const x = go({ ...u(1), ...u(2), ...bad })
    assert.equal(x.r.code, 0, x.r.out)
    assert.equal(x.action.hide, false, JSON.stringify(bad))
    assert.ok(!('3' in x.ages))
  }
  // 新账号不算
  assert.equal(go({ ...u(1), ...u(2), ...u(3, new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 19) + 'Z') }).action.hide, false)
  // 够数了但下架名单 5 回都推不上 main：这步失败（不能悄悄成功），回话那步 @ 维护者
  // 假 git：main 上的下架名单记在 main-deny.json（没有这个文件就是 main 上还没有）；reset --hard 回到 main 的样子；
  //   push 都报错：landOn 第几回推送其实推上去了（响应丢了）；restoredAfter：推上去以后维护者马上 /restore 了
  //   fetchOk：第几回 fetch 能成（之后的都失败）
  const hideRun = ({ fetchOk = 99, landOn = 0, restoredAfter = false, issues } = {}) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-rep-push-'))
    fs.mkdirSync(path.join(cwd, 'policy'))
    const o = path.join(cwd, 'out'); fs.writeFileSync(o, '')
    const land = restoredAfter ? `jq '[.[] | .restored = "2026-11-12T00:00:00Z"]' policy/denylist.json > main-deny.json` : 'cp policy/denylist.json main-deny.json'
    const gitStub = `#!/bin/bash\necho "$*" >> git.log\ncase "$1" in\n  fetch) k=$(grep -c '^fetch' git.log); [ "$k" -le ${fetchOk} ] ;;\n  diff) [ -f main-deny.json ] && cmp -s main-deny.json policy/denylist.json ;;\n  push) k=$(grep -c '^push' git.log); if [ "$k" = ${landOn} ]; then ${land}; fi; exit 1 ;;\n  reset) if [ -f main-deny.json ]; then cp main-deny.json policy/denylist.json; else rm -f policy/denylist.json; fi ;;\n  rev-parse) echo c0ffee ;;\n  merge-base) [ -f main-deny.json ] ;;\n  *) exit 0 ;;\nesac\n`
    const r = runStep('reports.yml', step, { fix: { '^GET repos/o/r/issues\\?labels=report': issues || { body: [iss('a', 1), iss('b', 2), iss('c', 3)] }, ...u(1), ...u(2), ...u(3) }, env: { GH_TOKEN: 'app', ID: 'eve__bank', GITHUB_OUTPUT: o }, cwd, extra: { git: gitStub }, scripts: { 'reports.mjs': fs.readFileSync(path.join(REAL, 'scripts/reports.mjs'), 'utf8') } })
    const log = fs.readFileSync(path.join(cwd, 'git.log'), 'utf8').split('\n')
    return { r, pushes: log.filter((l) => l.startsWith('push')).length, out: fs.readFileSync(o, 'utf8'), users: r.calls.filter((c) => c.route.startsWith('GET user/')).length }
  }
  const pushFail = hideRun()
  assert.notEqual(pushFail.r.code, 0, pushFail.r.out)
  assert.equal(pushFail.pushes, 5)
  assert.doesNotMatch(pushFail.out, /hidden=true/)
  // 每回都重新数举报，查过的账号不再查
  assert.equal(pushFail.r.calls.filter((c) => c.route.startsWith('GET repos/o/r/issues?labels=report')).length, 6)
  assert.equal(pushFail.users, 3)
  // 推不上、再取 main 也取不到：本地还留着没推上去的提交，不能当成「已经下架了」——这步失败
  const noFetch = hideRun({ fetchOk: 1 })
  assert.notEqual(noFetch.r.code, 0, noFetch.r.out)
  assert.equal(noFetch.pushes, 1)
  assert.doesNotMatch(noFetch.out, /hidden=true/)
  // 推送报错、其实推上去了（下一回取 main 看到了这个提交、还下架着）：算写进去了，是这回隐藏的
  const landed = hideRun({ landOn: 1 })
  assert.equal(landed.r.code, 0, landed.r.out)
  assert.equal(landed.pushes, 1)
  assert.match(landed.out, /^hidden=true$/m)
  // 第 5 回推送其实推上去了：第 6 回确认，算写进去了（不误报失败）
  const fifth = hideRun({ landOn: 5 })
  assert.equal(fifth.r.code, 0, fifth.r.out)
  assert.equal(fifth.pushes, 5)
  assert.match(fifth.out, /^hidden=true$/m)
  // 推上去了，但维护者紧接着 /restore 了：写进去了，但不说「隐藏了」（不打 auto-hidden）
  const restored = hideRun({ landOn: 1, restoredAfter: true })
  assert.equal(restored.r.code, 0, restored.r.out)
  assert.equal(restored.pushes, 1)
  assert.doesNotMatch(restored.out, /hidden=true/)
  // 第一回推不上，等着重推的时候有一条举报被关了：重新数，不够 3 个了，不再下架
  const shrink = hideRun({ issues: { bodies: [[iss('a', 1), iss('b', 2), iss('c', 3)], [iss('a', 1), iss('b', 2)]] } })
  assert.equal(shrink.r.code, 0, shrink.r.out)
  assert.equal(shrink.pushes, 1)
  assert.doesNotMatch(shrink.out, /hidden=true/)
  // 举报一直读不到：这步失败，不推
  const noIssues = hideRun({ issues: { code: 1 } })
  assert.notEqual(noIssues.r.code, 0, noIssues.r.out)
  assert.equal(noIssues.pushes, 0)
  // 真 git：main 上还没有下架名单（第一次写，新文件）——要真提交、推上去（git diff 看不到没跟踪的新文件，得先加进暂存区再比）
  {
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-rep-origin-'))
    gitIn(origin, 'init', '-q', '--bare', '-b', 'main')
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-rep-real-'))
    gitIn(cwd, 'init', '-q', '-b', 'main')
    fs.mkdirSync(path.join(cwd, 'policy'))
    fs.writeFileSync(path.join(cwd, 'policy/.keep'), '')
    gitIn(cwd, 'add', 'policy/.keep')
    gitIn(cwd, 'commit', '-q', '-m', 'init')
    gitIn(cwd, 'remote', 'add', 'origin', origin)
    gitIn(cwd, 'push', '-q', 'origin', 'main')
    const o = path.join(cwd, '..', path.basename(cwd) + '.out'); fs.writeFileSync(o, '')
    const r = runStep('reports.yml', step, { fix: { '^GET repos/o/r/issues\\?labels=report': { body: [iss('a', 1), iss('b', 2), iss('c', 3)] }, ...u(1), ...u(2), ...u(3) }, env: { GH_TOKEN: 'app', ID: 'eve__bank', GITHUB_OUTPUT: o }, cwd, scripts: { 'reports.mjs': fs.readFileSync(path.join(REAL, 'scripts/reports.mjs'), 'utf8') } })
    assert.equal(r.code, 0, r.out)
    assert.match(fs.readFileSync(o, 'utf8'), /^hidden=true$/m)
    const deny = JSON.parse(gitIn(origin, 'show', 'main:policy/denylist.json'))
    assert.ok(deny.some((d) => d.id === 'eve__bank' && d.reason === 'reported' && !d.restored), JSON.stringify(deny))
  }
  const reply = (env) => replies(runStep('reports.yml', '告诉举报人和维护者', { fix: { '^issue comment$': {}, '^POST repos/o/r/issues/9/labels$': { body: [] } }, env: { GH_TOKEN: 'app', N: '9', ID: 'eve__bank', GITHUB_REPOSITORY_OWNER: 'OrderG-X', ...env } }))[0]
  assert.match(reply({ COUNTED: 'failure', HIDDEN: '' }), /^收到。⚠ @OrderG-X .*出错了/)
  assert.match(reply({ COUNTED: 'success', HIDDEN: 'true' }), /先自动隐藏了/)
  assert.match(reply({ COUNTED: 'success', HIDDEN: '' }), /^收到，维护者会看/)
  assert.match(reply({ COUNTED: 'skipped', HIDDEN: '' }), /^收到，维护者会看/)
  // 前面的步骤（装依赖、读举报）失败、数举报那步被跳过：也 @ 维护者
  assert.match(reply({ COUNTED: 'skipped', HIDDEN: '', JOB_STATUS: 'failure' }), /^收到。⚠ @OrderG-X .*出错了/)
  assert.match(reply({ COUNTED: 'skipped', HIDDEN: '', JOB_STATUS: 'success' }), /^收到，维护者会看/)
  const y = fs.readFileSync(path.join(REAL, '.github/workflows/reports.yml'), 'utf8')
  assert.match(y, /- name: 告诉举报人和维护者\n        if: \$\{\{ !cancelled\(\) \}\}\n        env:\n          JOB_STATUS: \$\{\{ job\.status \}\}\n/)
})

test('shell 里变量后面紧跟中文的都加了 {}（不然有的 bash / locale 会把中文当成变量名的一部分）', () => {
  const files = [...fs.readdirSync(path.join(REAL, '.github/workflows')).map((f) => `.github/workflows/${f}`), ...fs.readdirSync(path.join(REAL, 'scripts')).filter((f) => f.endsWith('.sh')).map((f) => `scripts/${f}`)]
  const bad = []
  for (const f of files) fs.readFileSync(path.join(REAL, f), 'utf8').split('\n').forEach((l, i) => { if (/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7F]/.test(l)) bad.push(`${f}:${i + 1}`) })
  assert.deepEqual(bad, [])
})
