#!/usr/bin/env node
/**
 * 举报自动先隐藏：仿冒钓鱼、色情暴力这两类，有 3 个满 30 天的不同账号分别举报同一套
 * → 先写进下架名单（reason: reported），立刻发新目录；维护者看过后：误伤回 /restore，确认就不用动。
 *
 *   node scripts/reports.mjs parse                       读 ISSUE_BODY（刚开的举报 issue），GITHUB_OUTPUT 写 id=、kind=、hide_kind=true|false
 *   node scripts/reports.mjs candidates --id <作者__名字> --issues issues.json   要查账号年龄的人（每行一个）
 *   node scripts/reports.mjs decide --id <作者__名字> --issues issues.json --ages ages.json [--apply] --out action.json
 *     issues.json：API 列出的 label=report、还开着的 issue（分页取全；内容不可信，严格解析）
 *     只算上次撤销下架（/restore）之后的举报；维护者关掉的举报不算
 *     ages.json：{ 用户名: 账号创建时间 }（工作流用 API 查的）
 */

import fs from 'node:fs'
import path from 'node:path'
import { ROOT, readJson } from './lib/repo.mjs'
import { applyPolicy } from './chatops.mjs'

const DAY = 86400000
export const HIDE_KINDS = ['phish', 'adult']
export const NEED = 3
export const MIN_AGE = 30
const ID = /^[a-z0-9-]{1,39}__[a-z0-9-]{3,40}$/

/** report.yml 表单的正文 → { id, kind }；看不懂的 null */
export function parseReport(body) {
  const text = String(body || '').replace(/\r\n/g, '\n')
  const field = (head) => {
    const i = text.indexOf(`### ${head}\n`)
    if (i < 0) return ''
    const rest = text.slice(i + head.length + 5).replace(/^\n+/, '')
    return rest.split('\n')[0].trim()
  }
  const id = field('设计 id / Design id').toLowerCase()
  const p = field('问题 / Problem')
  if (!ID.test(id)) return null
  const kind = p.startsWith('仿冒') ? 'phish' : p.startsWith('色情') ? 'adult' : p.startsWith('侵犯') ? 'copyright' : p.startsWith('有真实的个人信息') ? 'personal' : p.startsWith('恶意') ? 'malicious' : 'other'
  return { id, kind }
}

/**
 * 有效举报人（按数字 id 去重）：同一套、两类之一、还开着、在上次撤销下架之后提的、不是机器人、不是作者自己
 * 账号年龄另查（只查这些人），见 shouldHide
 */
export function candidates(issues, { id, since = '' }) {
  const author = id.split('__')[0]
  const who = new Map()
  for (const it of Array.isArray(issues) ? issues : []) {
    if (!it || it.pull_request) continue
    if (it.state && it.state !== 'open') continue // 维护者关掉的（处理过 / 判了没问题）不算
    if (since && !(String(it.created_at || '') > since)) continue // 撤销下架之前的旧举报不算
    const r = parseReport(it.body)
    const u = it.user || {}
    if (!r || r.id !== id || !HIDE_KINDS.includes(r.kind)) continue
    if (u.type === 'Bot' || typeof u.login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(u.login) || !Number.isInteger(u.id)) continue
    if (u.login.toLowerCase() === author) continue
    if (!who.has(u.id)) who.set(u.id, u.login)
  }
  return [...who.values()]
}

/** 够不够自动先隐藏：有效举报人里账号满 30 天的不同账号 ≥ 3 */
export function shouldHide(issues, { id, ages = {}, now = Date.now(), since = '' }) {
  const ok = candidates(issues, { id, since }).filter((login) => (now - Date.parse(ages[login] || '')) / DAY >= MIN_AGE)
  return { hide: ok.length >= NEED, reporters: ok.slice(0, 10) }
}

/** 这一套上次被撤销下架是什么时候（之前的举报都处理过了） */
export function restoredSince(denylist, id) {
  return (Array.isArray(denylist) ? denylist : []).filter((d) => d && d.id === id && typeof d.restored === 'string').map((d) => d.restored).sort().pop() || ''
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : ''
}

function main() {
  const cmd = process.argv[2]
  if (cmd === 'parse') {
    const r = parseReport(process.env.ISSUE_BODY || '')
    const out = r ? `id=${r.id}\nkind=${r.kind}\nhide_kind=${HIDE_KINDS.includes(r.kind)}\n` : 'id=\nkind=\nhide_kind=false\n'
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, out)
    console.log(out.trim())
    return
  }
  if (cmd === 'candidates') {
    // 要查账号年龄的人（每行一个用户名，全部列出；工作流逐个查，凑够 3 个满 30 天的就停）
    const id = arg('--id')
    if (!ID.test(id)) { console.error('id 不对'); process.exit(2) }
    const since = restoredSince(readJson(path.join(ROOT, 'policy', 'denylist.json'), []), id)
    for (const u of candidates(readJson(arg('--issues'), []), { id, since })) console.log(u)
    return
  }
  if (cmd === 'decide') {
    const id = arg('--id')
    if (!ID.test(id)) { console.error('id 不对'); process.exit(2) }
    const issues = readJson(arg('--issues'), [])
    const ages = readJson(arg('--ages'), {})
    const deny = readJson(path.join(ROOT, 'policy', 'denylist.json'), [])
    const already = deny.some((d) => d && d.id === id && !d.restored)
    const r = shouldHide(issues, { id, ages, since: restoredSince(deny, id) })
    const a = { ...r, id, already }
    if (r.hide && !already && process.argv.includes('--apply')) a.changed = applyPolicy({ action: 'takedown', id, reason: 'reported' })
    fs.writeFileSync(arg('--out') || 'action.json', JSON.stringify(a, null, 2) + '\n')
    console.log(`${id}：${r.reporters.length} 个有效举报${r.hide ? (already ? '，已经下架了' : '，先隐藏') : ''}`)
    return
  }
  console.error('用法见文件开头')
  process.exit(2)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
