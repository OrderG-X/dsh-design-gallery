#!/usr/bin/env node
/**
 * 维护者在 PR / issue 里回的命令 → 要做的事（工作流照着执行）。
 * 工作流先用 API 确认评论人是协作者（write 及以上），再跑这个；这里只解析、不碰 GitHub。
 *
 *   COMMENT_BODY / IS_PR / ITEM_NUMBER 经环境变量传入
 *   node scripts/chatops.mjs --out action.json
 *
 * 命令（一条评论只认第一行）：
 *   /approve                     合并（PR）
 *   /hold <原因码>               挂起，打 held: maintainer
 *   /reject <原因码>             关闭，回复原因
 *   /feature <id>  /unfeature <id>
 *   /trust @x  /untrust @x       改 policy/trust-overrides.json
 *   /takedown <id> <原因码>      下架：写 policy/denylist.json，立即发新目录
 *   /restore <id>                撤销下架
 * 原因码：policy/reasons.json 里的键（copy / brand / phish / personal / qr / quality / nsfw / politics / inject / spam / author / other）
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT, readJson, ID_RE } from './lib/repo.mjs'

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
    case '/approve': return isPr ? { action: 'merge' } : { action: 'error', msg: '/approve 只能在 PR 里用' }
    case '/hold': return { action: 'hold', reason: reason(args[0]), text: reasonText(reasons, reason(args[0])) }
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

function reasonText(reasons, r) {
  const x = reasons[r] || reasons.other || { zh: '', en: '' }
  return `${x.zh}\n\n${x.en}`
}

/** 改 policy 文件（feature / trust / takedown / restore）；返回改了哪个文件，没改给 '' */
export function applyPolicy(a, { root = ROOT, now = new Date() } = {}) {
  const p = (n) => path.join(root, 'policy', n)
  const write = (n, v) => { fs.writeFileSync(p(n), JSON.stringify(v, null, 2) + '\n'); return `policy/${n}` }
  if (a.action === 'feature' || a.action === 'unfeature') {
    const list = new Set(readJson(p('featured.json'), []))
    if (a.action === 'feature') list.add(a.id); else list.delete(a.id)
    return write('featured.json', [...list].sort())
  }
  // 信任按数字 id 记（用户名能被别人重新注册）；查不到 id 的不记
  if (a.action === 'trust' || a.action === 'untrust') {
    if (!(Number.isInteger(a.uid) && a.uid > 0)) return ''
    const m = readJson(p('trust-overrides.json'), {})
    m[a.login] = { tier: a.action === 'trust' ? 'T2' : 'T0', id: a.uid, at: now.toISOString() }
    return write('trust-overrides.json', m)
  }
  if (a.action === 'takedown') {
    const list = readJson(p('denylist.json'), []).filter((d) => d.id !== a.id)
    list.push({ id: a.id, at: now.toISOString(), reason: a.reason })
    return write('denylist.json', list)
  }
  // 撤销下架：不删记录，标上 restored（目录据此发「撤销名单」；插件本地记着下架名单，只认签了名的撤销）
  if (a.action === 'restore') {
    const list = readJson(p('denylist.json'), [])
    const hit = list.filter((d) => d.id === a.id && !d.restored)
    if (!hit.length) return ''
    for (const d of hit) d.restored = now.toISOString()
    return write('denylist.json', list)
  }
  return ''
}

function main() {
  const oi = process.argv.indexOf('--out')
  const out = oi > 0 ? process.argv[oi + 1] : 'action.json'
  let a = parseCommand(process.env.COMMENT_BODY || '', { isPr: process.env.IS_PR === 'true' }) || { action: 'none' }
  // /trust、/untrust：工作流用 API 查好被信任账号的数字 id 传进来
  if (a.action === 'trust' || a.action === 'untrust') {
    a.uid = Number(process.env.TARGET_ID || 0)
    if (!(Number.isInteger(a.uid) && a.uid > 0)) a = { action: 'error', msg: `查不到 @${a.login} 这个账号 / Could not find @${a.login}` }
  }
  if (process.argv.includes('--apply')) a.changed = applyPolicy(a)
  fs.writeFileSync(out, JSON.stringify(a, null, 2) + '\n')
  console.log(a.action)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
