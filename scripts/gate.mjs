#!/usr/bin/env node
/**
 * 投稿闸门（初筛）：读 PR 检查的结果（不可信数据，严格读），定车道、贴审核卡、提醒维护者。
 * 不合并：合并只由维护者（审核会话）看过后发 /approve。
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
 *   MAINTAINER                       仓库主人（别人的投稿等人看时 @ 这个账号）
 *   MAINT_HELD                       PR 上有没有维护者的 held: maintainer（true / false）
 *   REOPENED                         PR 有没有被关过、又重开了（谁关的都算；网页投稿还看投稿的 issue；true / false）
 *
 * 产物 gate.json：{ conclusion, lane, labels, held, ping, maintHeld, comment }（ping：要单独发的 @ 维护者那条，不用发就是空；
 *   maintHeld：算的时候维护者挂没挂起）
 *
 * 车道（只是给维护者的参考；哪条车道都不自动合并，一律等维护者 /approve）：
 *   A 全绿：没标记、只有一套风格卡（作者不是 T0），看一眼就行
 *   B 要你看一眼：其余全部（每个作者的第一套、有标记的、近似的、新模板 / 设计系统）
 *   C 必须你细看：碰了受保护路径、别人的目录
 *   账号 <7 天：先挂起（held: author）；同时在等 >3 个或 24 小时内 >3 套：先排队（held: limit）；都会自动复查
 *   违规两次（policy/strikes.json）：不再收
 */

import fs from 'node:fs'
import path from 'node:path'
import { readPolicyJson } from './lib/repo.mjs'

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
  // 手动信任按数字 id 找（不按用户名：改了名也还是那个人，/untrust 不能靠改名绕过）。同一个 id 有几条（改名前后各 /trust、/untrust 过）：
  //   取最后记的（at 最晚）；分不出先后（有一条的时间读不出来、最晚的有几条）就保守：有 T0 就是 T0
  const mine = (overrides && typeof overrides === 'object' && !isArr(overrides) ? Object.values(overrides) : [])
    .filter((o) => o && typeof o === 'object' && ['T0', 'T2'].includes(o.tier) && Number.isInteger(o.id) && id > 0 && o.id === id)
  const times = mine.map((o) => Date.parse(o.at))
  const last = Math.max(...times)
  const top = times.some((t) => !Number.isFinite(t)) ? mine : mine.filter((o, i) => times[i] === last)
  const override = !mine.length ? '' : top.some((o) => o.tier === 'T0') ? 'T0' : 'T2'
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
 *   A（全绿，看一眼就行）：只有一套、检查全过、没标记，而且是风格卡（作者不是 T0）
 *   B：其余的；C：动了受保护的路径
 * 哪条车道都不自动合并：一律等维护者（审核会话）看过发 /approve
 * 挂起：账号不满 7 天（/trust 过的不挂）；同时在等的超过 3 个、24 小时内交了超过 3 套
 * 违规两次（strikes.json）：不再收
 */
// 审核卡最多 2 万字：GitHub 评论最多 65536 字、检查说明最多 65535 字；工作流写检查说明时按字节截到 6 万，
//   一个字最多 3 字节（UTF-16 的一个单位），2 万字不会被截在半个字上
export const CARD_MAX = 20000
export const capCard = (t) => (t.length <= CARD_MAX ? t : `${t.slice(0, CARD_MAX - 120)}\n\n…（审核卡太长，后面省略了 / The rest of this card was cut because it is too long）`)

export function decide(res, { login = '', createdAt = '', priorMerged = 0, strikes = 0, override = '', pending = 0, today = 0, partial = false, shotsBase = '', owner = '', sha = '', maintHeld = false, reopened = false, now = Date.now() } = {}) {
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
  // 维护者挂起着（held: maintainer，标签是维护者的，这里不动它）：不 @，卡上照实写
  const mheld = !failed && !!maintHeld
  // 被关过又重开了（维护者 /reject、手动关过、作者自己关过；网页投稿看投稿的 issue）：拒稿的标签可能没打上，不能只看标签——卡上照实写，提醒维护者
  const reop = !failed && !!reopened
  // 控制用的标签（检查结果、封禁、挂起、没数全、车道）一个不少；只给展示用的 flag 标签限个数（一个 PR 最多贴 12 个）
  const control = [failed ? 'checks: fail' : 'checks: pass']
  if (blocked) control.push('blocked: strikes')
  if (held) control.push(`held: ${held}`)
  if (partial) control.push('count: partial')
  control.push(`lane: ${lane}`)
  const flags = new Set()
  for (const e of res.entries) for (const f of e.flags) flags.add(`flag: ${f.code}`)
  const labels = [...control, ...[...flags].slice(0, 12 - control.length)]
  const conclusion = failed ? 'failure' : held || mheld || reop || lane !== 'A' ? 'neutral' : 'success'
  // 别人交的、检查过了、没挂起：单独发一条 @ 维护者（都要人看；审核卡是反复改的那一条，改出来的 @ 不会提醒）
  const ping = !failed && !held && !mheld && /^[A-Za-z0-9-]{1,39}$/.test(owner) && String(login).toLowerCase() !== owner.toLowerCase()
    ? (reop
      ? `<!-- dsh-gallery-ping -->\n@${owner} 这个投稿被关过又重开了，过了检查，等你看一眼（车道 ${lane}）。 / This submission was closed and reopened; it passed the checks and is waiting for your review (lane ${lane}).`
      : `<!-- dsh-gallery-ping -->\n@${owner} 有新投稿过了检查，等你看一眼（车道 ${lane}）。 / A new submission passed the checks and is waiting for your review (lane ${lane}).`)
    : ''
  // maintHeld：算的时候 PR 上有没有 held: maintainer（post 写之前再看一眼，变了就作废重算）
  return { conclusion, lane, labels, held, tier, ping, maintHeld: !!maintHeld, comment: capCard(card(res, { login, lane, tier, held, failed, blocked, pending, today, partial, shotsBase, age, sha, mheld, reop })) }
}

/** 审核卡（中英文）：结论、问题清单、截图、维护者能回的命令 */
export function card(res, { login, lane, tier, held, failed, blocked = false, pending = 0, today = 0, partial = false, shotsBase, age = 0, sha = '', mheld = false, reop = false }) {
  const L = []
  L.push('<!-- dsh-gallery-gate -->')
  if (blocked) L.push(`### ✗ 这个账号不再收稿 / This account can no longer submit`, '', '这个账号已经有两次违规记录（见 POLICY.md）。有疑问请开 issue 找维护者。 / This account has two strikes (see POLICY.md). Open an issue if you think this is a mistake.')
  else if (failed) L.push(`### ✗ 没过检查 / Checks failed`)
  else if (held === 'limit') L.push(`### ⏸ 先排队：一次交太多了 / On hold: too many at once`, '', `每人同时最多 ${LIMIT.pending} 个在等审核、24 小时内最多交 ${LIMIT.daily} 套（现在：在等 ${pending} 个，24 小时内 ${today} 套）。每 6 小时自动重查一次，数量回到上限以内就接着往下走，不用重新提交。 / Up to ${LIMIT.pending} open submissions and ${LIMIT.daily} per 24 hours per person (now: ${pending} open, ${today} in 24 hours). Re-checked every 6 hours; it continues once you are back under the limits. No need to resubmit.`)
  else if (held === 'author') {
    const d = Math.max(0, Math.floor(age))
    L.push(`### ⏸ 先挂起：账号太新 / On hold: account too new`, '', `GitHub 账号注册不满 7 天的投稿先挂起（这个账号现在 ${d} 天）。每 6 小时自动重查一次，满 7 天就接着往下走，不用重新提交。 / Submissions from GitHub accounts younger than 7 days are held (this one is ${d} days old). Re-checked every 6 hours; it continues once the account is 7 days old. No need to resubmit.`)
  }
  else if (mheld) L.push(`### ⏸ 检查都过了，维护者挂起着 / Checks passed, on hold by a maintainer`)
  else if (reop) L.push(`### ⏸ 检查都过了；这个 PR 被关过又重开了，等维护者看过再合 / Checks passed; this PR was closed and reopened, so it waits for a maintainer`)
  else if (lane === 'A') L.push(`### ✓ 全绿（风格卡），等维护者看一眼 / All green (style card), waiting for a maintainer`)
  else L.push(`### ✓ 检查都过了，等维护者看一眼 / Checks passed, waiting for a maintainer`)
  L.push('')
  // 给维护者的命令放在最前面（卡太长会截掉后面）。/approve 要带上查过的这一版的完整提交号（只合这一版；短的几位能被刻意撞上）：照抄就行
  const ap = /^[0-9a-f]{40}$/.test(sha) ? `/approve ${sha}` : '/approve <完整提交号>'
  // 过了检查的都给（哪条车道都要维护者放行；挂起了——数量超了、账号太新——维护者也可以直接看过就合）
  if (!failed) L.push(`维护者：看过这一版回复 \`${ap}\` 合并，\`/hold <原因>\` 挂起，\`/reject <原因>\` 关闭。（作者 @${login || '?'}，等级 ${tier}，车道 ${lane}）`, '')
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
  if (!failed && partial) L.push('· 24 小时投稿数没数全（这段时间 PR 太多），数量上限没核全，维护者留意一下。 / Could not count all submissions from the last 24 hours, so the rate limit was not fully checked.')
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

/**
 * 挂起的投稿现在能不能接着走（定时任务用它决定要不要重跑检查）：闸门按现在的数会不会一点都不挂起——
 * 和 decide 里一样：先看账号（满 7 天或 /trust 过 T2），再看数量（同时在等的、24 小时内交的都在上限以内）
 */
export function heldReady({ createdAt = '', override = '', pending = 0, today = 0, now = Date.now() } = {}) {
  const age = createdAt ? (now - Date.parse(createdAt)) / DAY : NaN
  if (!(age >= 7) && override !== 'T2') return false
  return pending <= LIMIT.pending && today <= LIMIT.daily
}

function main() {
  // PR 列表读不到、不是 JSON、不是 PR 数组都直接报错退出（不能当成 0 个：会放过数量上限）
  const readPulls = (files) => { if (!files.length) throw new Error('没给 PR 列表'); return files.flatMap((f) => {
    const v = JSON.parse(fs.readFileSync(f, 'utf8'))
    const list = Array.isArray(v) ? v.flat() : null
    if (!list || !list.every((p) => p && typeof p === 'object' && Number.isInteger(p.number))) throw new Error(`${f} 不是 PR 列表`)
    return list
  }) }
  // 作者记录从 main 上的 policy/ 读（用到它的 job 检出的是 main）。只有文件不存在才用默认值：
  //   读不了、JSON 坏了（维护者手改漏个逗号）、类型不对都直接报错退出——不能当成空名单（违规记录、/untrust 就都不算了）
  const pol = (f, d) => readPolicyJson(path.join('policy', f), d)
  if (process.argv[2] === '--count') {
    // node scripts/gate.mjs --count pulls1.json [pulls2.json …]（环境变量 ID、BOT、SINCE）→ pending=、today=
    const c = countMine(readPulls(process.argv.slice(3)), { id: process.env.ID, bot: process.env.BOT || '', since: process.env.SINCE || '' })
    console.log(`pending=${c.pending}\ntoday=${c.today}`)
    return
  }
  if (process.argv[2] === '--held') {
    // node scripts/gate.mjs --held pulls1.json [pulls2.json …]（环境变量 ID、LOGIN、BOT、SINCE、ACCOUNT_CREATED_AT）→ ready=0|1
    const id = Number(process.env.ID || 0)
    const c = countMine(readPulls(process.argv.slice(3)), { id, bot: process.env.BOT || '', since: process.env.SINCE || '' })
    const st = standing({ login: process.env.LOGIN || '', id, strikes: [], overrides: pol('trust-overrides.json', {}) })
    console.log(`ready=${heldReady({ createdAt: process.env.ACCOUNT_CREATED_AT || '', override: st.override, ...c }) ? 1 : 0}`)
    return
  }
  const file = process.argv[2]
  const oi = process.argv.indexOf('--out')
  const out = oi > 0 ? process.argv[oi + 1] : 'gate.json'
  const ti = process.argv.indexOf('--trusted')
  const read = (f) => (f && fs.existsSync(f) ? readResults(fs.readFileSync(f, 'utf8')) : null)
  // 给了 --trusted：以闸门自己重跑的为准，产物只能多报问题；没给（本地试用）才只看产物
  const res = ti > 0 ? mergeResults(read(process.argv[ti + 1]), read(file)) : read(file)
  const login = process.env.PR_AUTHOR_LOGIN || ''
  const st = standing({ login, id: Number(process.env.PR_AUTHOR_ID || 0), strikes: pol('strikes.json', []), overrides: pol('trust-overrides.json', {}) })
  const opts = { login, createdAt: process.env.ACCOUNT_CREATED_AT || '', priorMerged: Number(process.env.PRIOR_MERGED || 0), strikes: st.strikes, override: st.override, pending: Number(process.env.PENDING || 0), today: Number(process.env.TODAY || 0), partial: process.env.COUNT_PARTIAL !== '0', shotsBase: process.env.SHOTS_BASE || '', owner: process.env.MAINTAINER || '', sha: process.env.HEAD_SHA || '', maintHeld: process.env.MAINT_HELD === 'true', reopened: process.env.REOPENED === 'true' }
  // alt：维护者挂起状态反过来的那一份（算完、写之前维护者 /hold 了或摘了标签：post 直接换成这份写，不用重跑检查）
  const both = (o) => { const d = decide(res, o); const a = decide(res, { ...o, maintHeld: !o.maintHeld }); return { ...d, alt: { conclusion: a.conclusion, labels: a.labels, ping: a.ping, maintHeld: a.maintHeld, comment: a.comment } } }
  const g = res
    ? both(opts)
    : { conclusion: 'failure', lane: 'B', labels: ['checks: fail'], held: '', ping: '', comment: '<!-- dsh-gallery-gate -->\n### ✗ 检查结果读不出来 / Could not read check results\n\n维护者看一下工作流日志。 / A maintainer will look at the workflow log.' }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(g, null, 2) + '\n')
  console.log(`${g.conclusion} · 车道 ${g.lane}${g.held ? ' · 挂起' : ''}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
