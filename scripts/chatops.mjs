#!/usr/bin/env node
/**
 * 维护者在 PR / issue 里回的命令 → 要做的事（工作流照着执行）。
 * 工作流先用 API 确认评论人是协作者（write 及以上），再跑这个；这里只解析、不碰 GitHub。
 *
 *   COMMENT_BODY / IS_PR / ITEM_NUMBER 经环境变量传入
 *   node scripts/chatops.mjs --out action.json
 *
 * 命令（一条评论只认第一条以 / 开头的行，前面可以有说明）：
 *   /approve <完整提交号>        合并（PR）：只合这一版（40 位，审核卡上照抄）
 *   /hold <原因码>               挂起（PR）：打 held: maintainer
 *   /reject <原因码>             关闭，回复原因
 *   /feature <id>  /unfeature <id>
 *   /trust @x  /untrust @x       改 policy/trust-overrides.json
 *   /takedown <id> <原因码>      下架：写 policy/denylist.json，立即发新目录
 *   /restore <id>                撤销下架
 * 原因码：policy/reasons.json 里的键（copy / brand / phish / personal / qr / quality / nsfw / politics / inject / spam / author / other）
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT, readJson, readPolicyJson, ID_RE } from './lib/repo.mjs'

const TAKEDOWN_REASONS = ['copyright', 'author', 'policy', 'security']

export function parseCommand(body, { isPr = false } = {}) {
  const line = String(body || '').split('\n').map((x) => x.trim()).find((x) => x.startsWith('/'))
  if (!line) return null
  const [cmd, ...args] = line.split(/\s+/)
  const reasons = readJson(path.join(ROOT, 'policy', 'reasons.json'), {})
  const reason = (r) => (r && reasons[r] ? r : 'other')
  const id = (x) => (ID_RE.test(String(x || '')) ? String(x) : '')
  const user = (x) => (/^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(String(x || '')) ? String(x).replace(/^@/, '') : '')
  switch (cmd) {
    // /approve <完整提交号>：只合维护者看过的那一版（要 40 位：几位的短号能被刻意造出撞上的提交；没写对的，工作流回话告诉现在是哪一版）
    case '/approve': return isPr ? { action: 'merge', sha: /^[0-9a-f]{40}$/i.test(args[0] || '') ? args[0].toLowerCase() : '' } : { action: 'error', msg: '/approve 只能在 PR 里用' }
    // /hold 只在 PR 上：合并只看 PR 的标签和评论（网页投稿的 issue 上挂起，机器人替它开的 PR 照样会被合并）
    case '/hold': return isPr ? { action: 'hold', reason: reason(args[0]), text: reasonText(reasons, reason(args[0])) } : { action: 'error', msg: '/hold 要在 PR 里发（网页投稿：机器人开的 PR 链接在这个 issue 的回复里） / Send /hold on the PR (for web-form submissions, the bot PR is linked in the replies here)' }
    case '/reject': return { action: 'close', reason: reason(args[0]), text: reasonText(reasons, reason(args[0])) }
    case '/feature': case '/unfeature': return id(args[0]) ? { action: cmd.slice(1), id: id(args[0]) } : { action: 'error', msg: `${cmd} 后面要写设计 id（作者__名字）` }
    case '/trust': case '/untrust': return user(args[0]) ? { action: cmd.slice(1), login: user(args[0]).toLowerCase() } : { action: 'error', msg: `${cmd} 后面要写 @用户名` }
    case '/takedown': {
      if (!id(args[0])) return { action: 'error', msg: '/takedown 后面要写设计 id' }
      const r = TAKEDOWN_REASONS.includes(args[1]) ? args[1] : 'policy'
      return { action: 'takedown', id: id(args[0]), reason: r }
    }
    case '/restore': return id(args[0]) ? { action: 'restore', id: id(args[0]) } : { action: 'error', msg: '/restore 后面要写设计 id' }
    default: return null
  }
}

/**
 * /approve 之后又有谁发了 /hold（confirm 合并前看）：评论 id 比 /approve 大的，或者和它同一秒、时间读不出来的（同一秒按保护的算）。
 * 用和命令一样的解析（第一条 / 开头的行），机器人发的不算；返回 [{ id: 评论 id, login: 发的人 }]
 * （工作流再一条条看：发的人现在还是维护者，或者机器人当时给这条点了 👀（生效了），就算）。
 * comments：issues/<号>/comments 的列表（分页拼起来的）；读不出来就抛错（工作流当成挂起了）
 */
export function holdsAfter(comments, { id, since }) {
  const me = Number(id)
  const t = Date.parse(since)
  if (!Array.isArray(comments) || id === '' || id === null || id === undefined || !Number.isSafeInteger(me) || !Number.isFinite(t)) throw new Error('评论或 /approve 的 id、时间读不出来')
  const who = []
  for (const c of comments) {
    if (!c || typeof c !== 'object' || !Number.isSafeInteger(c.id)) throw new Error('评论读不出来')
    if (c.id === me || (c.user && c.user.type === 'Bot')) continue
    const at = Date.parse(c.created_at)
    if (!(c.id > me || !Number.isFinite(at) || at >= t)) continue
    const a = parseCommand(c.body || '', { isPr: true })
    // /hold 和 /reject 都算挂起（/reject 关了以后作者能重开自己的 PR：旧的 /approve 不能越过它）
    if (!a || (a.action !== 'hold' && a.action !== 'close')) continue
    const login = String((c.user && c.user.login) || '')
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) throw new Error('发 /hold、/reject 的人读不出来')
    who.push({ id: c.id, login })
  }
  return who
}

function reasonText(reasons, r) {
  const x = reasons[r] || reasons.other || { zh: '', en: '' }
  return `${x.zh}\n\n${x.en}`
}

/**
 * 改 policy 文件（feature / trust / takedown / restore）；返回改了哪个文件，没改给 ''。
 * now 是命令（评论）发出的时间，命令的先后按它算（重跑的、排在后面才跑到的旧命令，评论时间还是旧的）：
 *   - 保护的命令（/untrust、/takedown）总是生效；记录的时间取这条和已有记录里最晚的，之后晚到的旧放行命令盖不过它；
 *   - 放行的命令（/trust、/restore）只在没有更晚（或同一秒、时间读不出来）的记录时生效，不然不改、a.stale = true。
 *   （所以旧的 /untrust、/takedown 晚到会再收紧一次：宁可多收紧，维护者再发一次放行的命令就行）
 */
export function applyPolicy(a, { root = ROOT, now = new Date(), clock = Date.now() } = {}) {
  const p = (n) => path.join(root, 'policy', n)
  const t = now.getTime()
  // 保护的记录里有时间读不出来的：不能当它不存在（不然重跑一条旧的保护命令，会把它换成一个旧时间，之后晚到的旧放行命令就能放开）——
  //   当成「最晚到现在」：新记录的时间取到处理的这一刻（clock），这之前发的放行命令都盖不过
  const latest = (times) => Math.max(t, ...times.filter(Number.isFinite), ...(times.some((x) => !Number.isFinite(x)) ? [clock] : []))
  const stale = () => { a.stale = true; return '' }
  const write = (n, v) => { fs.writeFileSync(p(n), JSON.stringify(v, null, 2) + '\n'); return `policy/${n}` }
  if (a.action === 'feature' || a.action === 'unfeature') {
    const list = new Set(readPolicyJson(p('featured.json'), []))
    if (a.action === 'feature') list.add(a.id); else list.delete(a.id)
    return write('featured.json', [...list].sort())
  }
  // 信任按数字 id 记（用户名能被别人重新注册）；查不到 id 的不记
  //   键也用 id（"id:42"）：同一个用户名先后是两个人时，不能拿新的人覆盖旧的人的记录（旧的人 /untrust 过的就失效了）；用户名只记着看
  if (a.action === 'trust' || a.action === 'untrust') {
    if (!(Number.isInteger(a.uid) && a.uid > 0)) return ''
    const m = readPolicyJson(p('trust-overrides.json'), {})
    const mine = Object.entries(m).filter(([, v]) => v && typeof v === 'object' && v.id === a.uid)
    const times = mine.map(([, v]) => Date.parse(v.at))
    let at = t
    if (a.action === 'trust') {
      // 放行：已经有更晚的记录、同一秒的 /untrust、时间读不出来的记录（分不出先后）——这条旧了
      if (mine.some(([, v], i) => !Number.isFinite(times[i]) || times[i] > t || (times[i] === t && v.tier === 'T0'))) return stale()
    } else {
      // 保护：只有一条、就是按 id 记的 /untrust、而且不比这条早——不用改；别的情况（有几条、有放开的、时间读不出来）
      //   都并成一条 /untrust，时间取最晚的（几条里最新的那条可能是放开的，不能因为别处有一条 T0 就不改）
      if (mine.length === 1 && mine[0][0] === `id:${a.uid}` && mine[0][1].tier === 'T0' && Number.isFinite(times[0]) && times[0] >= t) return ''
      at = latest(times)
    }
    // 同一个人（同一个 id）以前记过的条目（改名前的、老写法按用户名做键的）去掉：一个 id 只留一条
    for (const [k] of mine) delete m[k]
    m[`id:${a.uid}`] = { tier: a.action === 'trust' ? 'T2' : 'T0', id: a.uid, login: a.login, at: new Date(at).toISOString() }
    return write('trust-overrides.json', m)
  }
  if (a.action === 'takedown') {
    const all = readPolicyJson(p('denylist.json'), [])
    const mine = all.filter((d) => d && d.id === a.id)
    // 已经下架着、而且是这条或更晚的命令下的（只有这一条、时间读得出来）：不用再记。
    //   时间读不出来的、有好几条的：照样往下并成一条（时间按 clock 取到现在），不然之后的 /restore 永远「旧了」撤不了
    const at0 = mine.length === 1 && !mine[0].restored ? Date.parse(mine[0].at) : NaN
    if (Number.isFinite(at0) && at0 >= t) return ''
    // 保护的命令总是生效（哪怕之后撤销过）：时间取这条和已有记录（下架、撤销）里最晚的，晚到的旧 /restore 撤不了它
    const times = mine.flatMap((d) => [Date.parse(d.at), ...(d.restored === undefined ? [] : [Date.parse(d.restored)])])
    const list = all.filter((d) => !(d && d.id === a.id))
    list.push({ id: a.id, at: new Date(latest(times)).toISOString(), reason: a.reason })
    return write('denylist.json', list)
  }
  // 撤销下架：不删记录，标上 restored（目录据此发「撤销名单」；插件本地记着下架名单，只认签了名的撤销）
  if (a.action === 'restore') {
    const list = readPolicyJson(p('denylist.json'), [])
    const hit = list.filter((d) => d && d.id === a.id && !d.restored)
    if (!hit.length) return ''
    // 下架是这条之后（或同一秒、时间读不出来）发的：这条撤销旧了，不改
    if (hit.some((d) => !(Date.parse(d.at) < t))) return stale()
    for (const d of hit) d.restored = now.toISOString()
    return write('denylist.json', list)
  }
  return ''
}

function main() {
  // --holds <评论 JSON（分页拼起来的，jq -s 的样子）> --id <评论 id；空着就只按时间> --since <评论时间>：列出之后发了 /hold、/reject 的（评论 id 发的人）
  const hi = process.argv.indexOf('--holds')
  if (hi > 0) {
    const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : '' }
    const pages = JSON.parse(fs.readFileSync(process.argv[hi + 1], 'utf8'))
    if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('评论列表读不出来')
    for (const h of holdsAfter(pages.flat(), { id: arg('--id'), since: arg('--since') })) console.log(`${h.id} ${h.login}`)
    return
  }
  // --action：评论里认得的命令是什么（不是命令就是 none）；取消回话那边用它判断要不要说
  if (process.argv.includes('--action')) {
    const t = parseCommand(process.env.COMMENT_BODY || '', { isPr: process.env.IS_PR === 'true' })
    console.log(t ? t.action : 'none')
    return
  }
  // --target：/trust、/untrust 要查的用户名（工作流拿去查数字 id）；别的命令不出东西
  if (process.argv.includes('--target')) {
    const t = parseCommand(process.env.COMMENT_BODY || '', { isPr: process.env.IS_PR === 'true' })
    if (t && (t.action === 'trust' || t.action === 'untrust')) console.log(t.login)
    return
  }
  const oi = process.argv.indexOf('--out')
  const out = oi > 0 ? process.argv[oi + 1] : 'action.json'
  let a = parseCommand(process.env.COMMENT_BODY || '', { isPr: process.env.IS_PR === 'true' }) || { action: 'none' }
  // /trust、/untrust：工作流用 API 查好被信任账号的数字 id 传进来
  if (a.action === 'trust' || a.action === 'untrust') {
    a.uid = Number(process.env.TARGET_ID || 0)
    if (!(Number.isInteger(a.uid) && a.uid > 0)) a = { action: 'error', msg: `查不到 @${a.login} 这个账号 / Could not find @${a.login}` }
  }
  // 命令发出的时间（评论时间）：本地试用不给就用现在
  const now = process.env.COMMENT_AT ? new Date(process.env.COMMENT_AT) : new Date()
  if (!Number.isFinite(now.getTime())) a = { action: 'error', msg: '读不出评论时间 / Could not read the comment time' }
  // 规矩文件读不出来（手改坏了）：不改、不覆盖，回话说清楚
  if (process.argv.includes('--apply')) {
    try { a.changed = applyPolicy(a, { now }) } catch (e) { a = { action: 'error', msg: `规矩文件读不出来，没改（${e.message}），请先修好 policy/ 下的文件 / A policy file could not be read, nothing was changed` } }
  }
  fs.writeFileSync(out, JSON.stringify(a, null, 2) + '\n')
  console.log(a.action)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
