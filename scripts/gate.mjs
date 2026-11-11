#!/usr/bin/env node
/**
 * 投稿闸门：读 PR 检查的结果（不可信数据，严格读），定车道、贴审核卡、决定要不要自动合并。
 * 只在拿着 App token、检出 main 的 job 里跑。PR 检查 job 的产物不可信（PR 能改那个 job）：
 * 闸门先自己按 PR 的真实改动重跑规则检查（不渲染，--trusted），再用产物补上渲染体检和截图。
 *
 *   node scripts/gate.mjs <产物 results.json> --trusted <闸门重跑的 results.json> --out gate.json
 *
 * 环境变量（由工作流用 GitHub API 查好传进来）：
 *   PR_AUTHOR_LOGIN / PR_AUTHOR_ID   PR 作者（机器人代开的 issue 投稿，传 issue 作者）
 *   ACCOUNT_CREATED_AT               作者账号创建时间（ISO）
 *   PRIOR_MERGED                     作者已合并满 7 天、没被举报下架的设计有几套
 *   SHOTS_BASE                       截图的公开地址前缀（孤儿分支 review-shots 的 raw 地址）
 *   （违规记录 policy/strikes.json、手动信任 trust-overrides.json 由这里自己从 main 读，按数字 id 认）
 *   PENDING / TODAY                  作者同时在等审核的投稿数、24 小时内交了几套（含这一个）
 *
 * 产物 gate.json：{ conclusion, lane, labels, automerge, held, summary, comment }
 *
 * 车道（第一版：只有你一个人审，先保守）：
 *   A 自动合并：全绿没标记、只有一套风格卡（作者 ≥30 天）。模板、设计系统（包括老作者更新自己的）一律等维护者看
 *   B 要你看一眼：其余全部（每个作者的第一套、有标记的、近似的、新模板 / 设计系统）
 *   C 必须你细看：碰了受保护路径、别人的目录
 *   账号 <7 天：先挂起（held: author）；同时在等 >3 个或 24 小时内 >3 套：先排队（held: limit）；都会自动复查
 *   违规两次（policy/strikes.json）：不再收
 */

import fs from 'node:fs'
import path from 'node:path'

const DAY = 86400000
// 投稿内容来的字：去掉能变成 HTML / 链接 / 表格的符号，@ 换成全角（不提醒任何人）
const S = (v, n = 200) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>`|[\]]/g, ' ').replace(/@/g, '＠').slice(0, n) : '')
const isArr = Array.isArray

/** 严格读 results.json：只留认识的字段、限长；路径只认 shots/<id>/<名>.jpg */
export function readResults(raw) {
  let r
  try { r = JSON.parse(raw) } catch { return null }
  if (!r || typeof r !== 'object' || !isArr(r.entries)) return null
  const items = (xs, n) => (isArr(xs) ? xs.slice(0, n).map((x) => ({ code: S(x && x.code, 40), msg: S(x && x.msg, 300), msgEn: S(x && x.msgEn, 300) })) : [])
  return {
    lane: r.lane === 'C' ? 'C' : '',
    guard: items(r.guard, 20),
    deleted: isArr(r.deleted) ? r.deleted.slice(0, 20).map((x) => S(x, 100)).filter((x) => /^(templates|systems|styles)\/[a-z0-9-]+__[a-z0-9-]+$/.test(x)) : [],
    entries: r.entries.slice(0, 5).map((e) => ({
      id: /^[a-z0-9-]{1,39}__[a-z0-9-]{3,40}$/.test(e && e.id) ? e.id : 'unknown',
      dir: S(e && e.dir, 100),
      type: ['template', 'system', 'style'].includes(e && e.type) ? e.type : 'template',
      ok: e && e.ok === true,
      errors: items(e && e.errors, 30),
      flags: items(e && e.flags, 30),
      soft: isArr(e && e.soft) ? e.soft.length : 0,
      update: !!(e && e.update === true),
      kind: S(e && e.kind, 20),
      screens: isArr(e && e.screens) ? e.screens.slice(0, 24).map((x) => S(x, 70)) : [],
      shots: isArr(e && e.shots) ? e.shots.slice(0, 24).filter((x) => typeof x === 'string' && /^shots\/[a-z0-9-]+__[a-z0-9-]+\/[A-Za-z0-9._-]{1,70}\.jpg$/.test(x)) : [],
    })),
  }
}

/**
 * 合并两份结果：trusted 是闸门自己（拿着 token 的可信 job）按 PR 真实改动重跑的规则检查（不渲染），
 * art 是 PR 检查 job 的产物（渲染体检、截图；PR 能改那个 job，所以不可信）。
 * 结构守卫、车道、归属、规则全以 trusted 为准；产物只能多报问题、带截图，不能把没过的变成过。
 */
export function mergeResults(trusted, art) {
  if (!trusted) return null
  const byId = new Map((art ? art.entries : []).map((e) => [e.id, e]))
  const same = (a, b) => a.code === b.code && a.msg === b.msg
  return {
    lane: trusted.lane,
    guard: trusted.guard,
    deleted: trusted.deleted,
    entries: trusted.entries.map((t) => {
      const a = byId.get(t.id)
      if (!a) return { ...t, ok: false, errors: [...t.errors, { code: 'noRender', msg: '没拿到渲染体检结果，改一下再推送会重跑', msgEn: 'Render check results are missing; push again to re-run' }].slice(0, 30) }
      const errors = [...t.errors]
      for (const x of a.errors) if (!errors.some((y) => same(x, y))) errors.push(x)
      const flags = [...t.flags]
      for (const x of a.flags) if (!flags.some((y) => same(x, y))) flags.push(x)
      return { ...t, ok: t.ok && a.ok, errors: errors.slice(0, 30), flags: flags.slice(0, 30), soft: a.soft, shots: a.shots }
    }),
  }
}

export const LIMIT = { pending: 3, daily: 3 }

/**
 * 作者的记录（policy/ 里读的，在 main 上，可信）：
 *   违规几次：strikes.json 按数字 id 认（老记录没 id 的按用户名）
 *   维护者手动给的信任：trust-overrides.json 里 { tier, id }，id 对得上才算（用户名能被别人重新注册）
 */
export function standing({ login = '', id = 0, strikes = [], overrides = {} } = {}) {
  const l = String(login).toLowerCase()
  const n = (isArr(strikes) ? strikes : []).filter((s) => s && (Number.isInteger(s.id) && s.id > 0 ? s.id === id : !!l && String(s.login || '').toLowerCase() === l)).length
  const o = overrides && typeof overrides === 'object' ? overrides[l] : null
  const override = o && typeof o === 'object' && ['T0', 'T2'].includes(o.tier) && Number.isInteger(o.id) && id > 0 && o.id === id ? o.tier : ''
  return { strikes: n, override }
}

/** 作者信任等级（维护者 /trust、/untrust 过的以那个为准） */
export function tierOf({ createdAt, priorMerged = 0, reports = 0, now = Date.now(), override = '' }) {
  const age = createdAt ? (now - Date.parse(createdAt)) / DAY : 0
  if (override === 'T0' || override === 'T2') return { tier: override, age: age >= 0 ? age : 0 }
  if (!(age >= 0)) return { tier: 'T0', age: 0 }
  if (age < 30) return { tier: 'T0', age }
  if (priorMerged >= 1 && reports === 0) return { tier: 'T2', age }
  return { tier: 'T1', age }
}

/**
 * 定车道：
 *   A（自动合并）：只有一套、检查全过、没标记，而且是风格卡（作者不是 T0）。
 *     模板、设计系统的更新不自动合并：只看改了多少（bigChange）挡不住「挪一下样式、换个类名」这种整页换样，一律给人看
 *   B：等维护者看；C：动了受保护的路径
 * 挂起：账号不满 7 天（/trust 过的不挂）；同时在等的超过 3 个、24 小时内交了超过 3 套
 * 违规两次（strikes.json）：不再收
 */
export function decide(res, { login = '', createdAt = '', priorMerged = 0, strikes = 0, override = '', pending = 0, today = 0, partial = false, shotsBase = '', now = Date.now() } = {}) {
  const labels = new Set()
  const { tier, age } = tierOf({ createdAt, priorMerged, reports: strikes, now, override })
  const blocked = strikes >= 2
  const failed = blocked || res.guard.length > 0 || res.entries.some((e) => !e.ok)
  const flagged = res.entries.some((e) => e.flags.length > 0)
  let lane = res.lane === 'C' ? 'C' : 'B'
  let held = ''
  const one = res.entries.length === 1 ? res.entries[0] : null
  // partial：24 小时投稿数没数全（翻页到了上限）——不能按不完整的数放行，转人工
  if (!failed && lane !== 'C' && one && !flagged && !partial && one.type === 'style' && tier !== 'T0') lane = 'A'
  if (!failed && age < 7 && override !== 'T2') held = 'author'
  else if (!failed && (pending > LIMIT.pending || today > LIMIT.daily)) held = 'limit'
  if (failed) labels.add('checks: fail')
  else labels.add('checks: pass')
  if (blocked) labels.add('blocked: strikes')
  for (const e of res.entries) for (const f of e.flags) labels.add(`flag: ${f.code}`)
  if (held) labels.add(`held: ${held}`)
  if (partial) labels.add('count: partial')
  labels.add(`lane: ${lane}`)
  const automerge = lane === 'A' && !failed && !held
  const conclusion = failed ? 'failure' : held || lane !== 'A' ? 'neutral' : 'success'
  return { conclusion, lane, labels: [...labels].slice(0, 12), automerge, held, tier, comment: card(res, { login, lane, tier, held, failed, blocked, pending, today, partial, shotsBase, age }) }
}

/** 审核卡（中英文）：结论、问题清单、截图、维护者能回的命令 */
export function card(res, { login, lane, tier, held, failed, blocked = false, pending = 0, today = 0, partial = false, shotsBase, age = 0 }) {
  const L = []
  L.push('<!-- dsh-gallery-gate -->')
  if (blocked) L.push(`### ✗ 这个账号不再收稿 / This account can no longer submit`, '', '这个账号已经有两次违规记录（见 POLICY.md）。有疑问请开 issue 找维护者。 / This account has two strikes (see POLICY.md). Open an issue if you think this is a mistake.')
  else if (failed) L.push(`### ✗ 没过检查 / Checks failed`)
  else if (held === 'limit') L.push(`### ⏸ 先排队：一次交太多了 / On hold: too many at once`, '', `每人同时最多 ${LIMIT.pending} 个在等审核、24 小时内最多交 ${LIMIT.daily} 套（现在：在等 ${pending} 个，24 小时内 ${today} 套）。每 6 小时自动重查一次，数量回到上限以内就接着往下走，不用重新提交。 / Up to ${LIMIT.pending} open submissions and ${LIMIT.daily} per 24 hours per person (now: ${pending} open, ${today} in 24 hours). Re-checked every 6 hours; it continues once you are back under the limits. No need to resubmit.`)
  else if (held === 'author') {
    const d = Math.max(0, Math.floor(age))
    L.push(`### ⏸ 先挂起：账号太新 / On hold: account too new`, '', `GitHub 账号注册不满 7 天的投稿先挂起（这个账号现在 ${d} 天）。每 6 小时自动重查一次，满 7 天就接着往下走，不用重新提交。 / Submissions from GitHub accounts younger than 7 days are held (this one is ${d} days old). Re-checked every 6 hours; it continues once the account is 7 days old. No need to resubmit.`)
  }
  else if (lane === 'A') L.push(`### ✓ 全过，自动合并 / All green, auto-merging`)
  else L.push(`### ✓ 检查都过了，等维护者看一眼 / Checks passed, waiting for a maintainer`)
  L.push('')
  for (const g of res.guard) L.push(`- ✗ ${g.msg}  \n  ${g.msgEn}`)
  for (const e of res.entries) {
    L.push(`**${e.dir || e.id}**（${e.type}${e.kind ? ` · ${e.kind}` : ''}${e.screens.length ? ` · ${e.screens.length} 屏` : ''}）`)
    for (const x of e.errors) L.push(`- ✗ ${x.msg}  \n  ${x.msgEn}`)
    for (const x of e.flags) L.push(`- ⚠ ${x.msg}  \n  ${x.msgEn}`)
    if (e.soft) L.push(`- · 排版小问题 ${e.soft} 处（CI 字体和你电脑不同，仅供参考） / ${e.soft} minor layout notes (CI fonts differ, FYI)`)
    if (shotsBase && e.shots.length) {
      L.push('')
      L.push(e.shots.slice(0, 8).map((s) => `<img src="${shotsBase.replace(/\/+$/, '')}/${s}" width="180" alt="${s.split('/').pop()}">`).join(' '))
    }
    L.push('')
  }
  if (res.deleted.length) L.push(`删掉的 / Removed: ${res.deleted.join(', ')}`)
  if (failed && !blocked) L.push('照上面改好后推送（或在 issue 里重新上传），会自动重查。 / Fix the items above and push (or re-upload in the issue); checks re-run automatically.')
  if (!failed && partial) L.push('· 24 小时投稿数没数全（这段时间 PR 太多），这次不自动合并。 / Could not count all submissions from the last 24 hours, so this will not auto-merge.')
  if (!failed && lane !== 'A') L.push(`维护者：回复 \`/approve\` 合并，\`/hold <原因>\` 挂起，\`/reject <原因>\` 关闭。（作者 @${login || '?'}，等级 ${tier}，车道 ${lane}）`)
  return L.join('\n')
}

/**
 * 这个人（按数字 ID，改了名也算同一个）同时在等的投稿、24 小时内交的投稿：直接开的 PR + 机器人代开的（说明里的 Submitted-by 行）
 * pulls：GitHub API 的 PR 列表（工作流分页取全）
 */
export function countMine(pulls, { id, bot = '', since = '' }) {
  const want = String(Number(id) || 0)
  if (want === '0') return { pending: 0, today: 0 }
  const line = new RegExp(`^Submitted-by: [A-Za-z0-9-]{1,39} \\(${want}\\)$`, 'm')
  const seen = new Set()
  let pending = 0
  let today = 0
  for (const p of Array.isArray(pulls) ? pulls : []) {
    if (!p || typeof p !== 'object' || !Number.isInteger(p.number) || seen.has(p.number)) continue
    seen.add(p.number)
    const u = p.user || {}
    const mine = String(u.id) === want || (bot && u.login === bot && line.test(String(p.body || '').replace(/\r\n/g, '\n')))
    if (!mine) continue
    if (p.state === 'open') pending++
    if (since && String(p.created_at || '') >= since) today++
  }
  return { pending, today }
}

function main() {
  if (process.argv[2] === '--count') {
    // node scripts/gate.mjs --count pulls1.json [pulls2.json …]（环境变量 ID、BOT、SINCE）→ pending=、today=
    const all = process.argv.slice(3).flatMap((f) => { try { const v = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(v) ? v.flat() : [] } catch { return [] } })
    const c = countMine(all, { id: process.env.ID, bot: process.env.BOT || '', since: process.env.SINCE || '' })
    console.log(`pending=${c.pending}\ntoday=${c.today}`)
    return
  }
  const file = process.argv[2]
  const oi = process.argv.indexOf('--out')
  const out = oi > 0 ? process.argv[oi + 1] : 'gate.json'
  const ti = process.argv.indexOf('--trusted')
  const read = (f) => (f && fs.existsSync(f) ? readResults(fs.readFileSync(f, 'utf8')) : null)
  // 给了 --trusted：以闸门自己重跑的为准，产物只能多报问题；没给（本地试用）才只看产物
  const res = ti > 0 ? mergeResults(read(process.argv[ti + 1]), read(file)) : read(file)
  // 作者记录从 main 上的 policy/ 读（这个 job 检出的是 main）
  const pol = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join('policy', f), 'utf8')) } catch { return d } }
  const login = process.env.PR_AUTHOR_LOGIN || ''
  const st = standing({ login, id: Number(process.env.PR_AUTHOR_ID || 0), strikes: pol('strikes.json', []), overrides: pol('trust-overrides.json', {}) })
  const g = res
    ? decide(res, { login, createdAt: process.env.ACCOUNT_CREATED_AT || '', priorMerged: Number(process.env.PRIOR_MERGED || 0), strikes: st.strikes, override: st.override, pending: Number(process.env.PENDING || 0), today: Number(process.env.TODAY || 0), partial: process.env.COUNT_PARTIAL !== '0', shotsBase: process.env.SHOTS_BASE || '' })
    : { conclusion: 'failure', lane: 'B', labels: ['checks: fail'], automerge: false, held: '', comment: '<!-- dsh-gallery-gate -->\n### ✗ 检查结果读不出来 / Could not read check results\n\n维护者看一下工作流日志。 / A maintainer will look at the workflow log.' }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(g, null, 2) + '\n')
  console.log(`${g.conclusion} · 车道 ${g.lane}${g.held ? ' · 挂起' : ''}${g.automerge ? ' · 自动合并' : ''}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
