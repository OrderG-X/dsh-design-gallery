#!/usr/bin/env node
/**
 * 查投稿：和插件「用这个开始」「打成 zip」同一份规则（dsh-design-studio/gallery），再断网开出来体检、截图。
 *
 *   node scripts/check.mjs templates/abc__cafe styles/abc__mint      查指定的几套
 *   node scripts/check.mjs --changed changed.txt                      按 PR 改了哪些文件查（git diff -z --name-status 的输出；每行一个路径也认）
 *   node scripts/check.mjs --all                                      全部重查（每周用）
 *
 * 环境变量：
 *   SUBMITTER_LOGIN / SUBMITTER_ID   投稿人（PR 作者，或 issue 投稿的 issue 作者）；不给就不查归属（本地自查）
 *   MAINTAINER=1                      维护者改的（允许碰别人目录、受保护路径）
 *   OUT                               结果放哪（默认 out/）：results.json + shots/<id>/<屏>.jpg
 *   NO_RENDER=1                       不开浏览器（只跑规则）
 *
 * 退出码：0 全过；1 有硬失败；2 用法错
 * results.json 是给 gate 读的不可信数据（它会再按严格 schema 读一遍）
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import jsQR from 'jsqr'
import { checkPack, message, renderPack, normalizeHtml, decodePng } from 'dsh-design-studio/gallery'
import { ROOT, PROTECTED, DIR_OF, parseEntryPath, loadDir, loadVocab, listEntries } from './lib/repo.mjs'
import { parseChanged } from './changed.mjs'

export { parseChanged }

const MAX_DELETE = 2 // 一个 PR 删掉超过 2 套已有的：多半是旧 fork 同步坏了

function parseArgs(argv) {
  const o = { dirs: [], changed: null, all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--changed') o.changed = argv[++i]
    else if (a === '--all') o.all = true
    else if (a.startsWith('-')) { console.error(`不认识的参数 ${a}`); process.exit(2) }
    else o.dirs.push(a.replace(/\/+$/, ''))
  }
  return o
}

/**
 * PR 的结构守卫（B8 第 1 条）：只能动 <type>/<自己>__<slug>/；碰了受保护路径 → C 车道；删太多 → 失败
 * @returns { errors, lane, dirs: [entry 路径] }
 */
export function guard(changed, { login = '', id = 0, maintainer = false, root = ROOT, prevAuthor = prevAuthorId } = {}) {
  const errors = []
  let lane = ''
  const dirs = new Set()
  const deleted = new Set()
  const missing = new Set()
  for (const c of changed) {
    if (PROTECTED.test(c.path) || /^[^/]+$/.test(c.path)) { lane = 'C'; if (!maintainer) errors.push({ code: 'protected', x: c.path }); continue }
    const e = parseEntryPath(c.path)
    if (!e) { errors.push({ code: 'where', x: c.path }); continue }
    if (!e.ok) { errors.push({ code: 'dirName', x: `${e.dir}/${e.id}` }); continue }
    if (login && e.login !== login.toLowerCase() && !maintainer) { lane = 'C'; errors.push({ code: 'notYours', x: `${e.dir}/${e.id}` }); continue }
    const key = `${e.dir}/${e.id}`
    if (c.status === 'D' && !fs.existsSync(path.join(root, key))) { deleted.add(key); continue }
    dirs.add(key)
    // 改了 / 加了的文件必须真的取出来了、是普通文件（取的时候被藏起来、是软链接的都算没过）
    if (c.status !== 'D') {
      let st = null
      try { st = fs.lstatSync(path.join(root, c.path)) } catch { /* 没有 */ }
      if (!st || !st.isFile()) missing.add(c.path)
    }
  }
  for (const x of [...missing].slice(0, 5)) errors.push({ code: 'missing', x })
  // 删掉整套：也要是原作者（按 main 上的数字 ID），而且一律等维护者看（防止夹带删别人的）
  if (deleted.size && !maintainer) {
    lane = 'C'
    for (const key of deleted) {
      const was = prevAuthor(key, root)
      if (!id || !was || was !== id) errors.push({ code: 'ownerId', x: key })
    }
  }
  if (deleted.size > MAX_DELETE && !maintainer) errors.push({ code: 'massDelete', n: deleted.size })
  if (!maintainer && dirs.size > 1) errors.push({ code: 'onePerPr', n: dirs.size })
  return { errors, lane, dirs: [...dirs], deleted: [...deleted] }
}

const GUARD_MSG = {
  protected: { zh: '改了只有维护者能改的地方「{x}」：投稿只能动 templates/、systems/、styles/ 下自己的目录', en: 'Touched a maintainer-only path "{x}": submissions may only change your own folder under templates/, systems/ or styles/' },
  where: { zh: '「{x}」不在任何设计目录里：放到 templates/<你的 GitHub 用户名>__<名字>/ 下', en: '"{x}" is outside any design folder: put it under templates/<your-github-login>__<name>/' },
  dirName: { zh: '目录名「{x}」不对：写成 <GitHub 用户名小写>__<名字>，名字用 3–40 个小写字母、数字、-', en: 'Folder name "{x}" is wrong: use <lowercase-github-login>__<name>, name is 3–40 lowercase letters, digits or -' },
  notYours: { zh: '「{x}」不是你的目录（目录名开头要是你的 GitHub 用户名）', en: '"{x}" is not your folder (it must start with your GitHub login)' },
  massDelete: { zh: '这个 PR 删了 {n} 套已有的设计：多半是 fork 太旧，先同步再提', en: 'This PR deletes {n} existing designs: your fork is probably out of date, sync it first' },
  onePerPr: { zh: '一个 PR 只交一套（这次有 {n} 套）：拆开提', en: 'One design per PR (this one has {n}): split it up' },
  missing: { zh: '「{x}」没检查到（被 .gitattributes 之类藏起来了，或者不是普通文件）：投稿里只放普通文件', en: '"{x}" could not be checked (hidden by .gitattributes or similar, or not a regular file): submit plain files only' },
  owner: { zh: 'design.json 的 author 要是你自己（{x}）', en: 'design.json author must be you ({x})' },
  ownerId: { zh: '「{x}」已经属于另一个 GitHub 账号（用户名一样但账号不是同一个，可能改过名）：换个名字投，或找维护者迁移', en: '"{x}" already belongs to a different GitHub account (same login, different account, e.g. after a rename): submit under a new name or ask a maintainer to migrate it' },
  typeDir: { zh: 'design.json 的 type 是 {n}，要放在 {x}/ 下', en: 'design.json type is {n}, so it belongs in {x}/' },
  dupId: { zh: '「{x}」这个名字在 {n}/ 下已经有了：不同类型也不能同名，换个名字', en: '"{x}" already exists under {n}/: names must be unique across types, pick another name' },
  dupContent: { zh: '「{x}」和已有的「{n}」内容一样', en: '"{x}" is identical to the existing "{n}"' },
  render: { zh: '「{x}」开不出来：{n}', en: '"{x}" failed to render: {n}' },
  bigChange: { zh: '「{x}」这次改了大约 {n}%：大改要维护者看一眼再合并', en: '"{x}" changed about {n}% this time: big rewrites need a maintainer to look before merging' },
  qr: { zh: '「{x}」里有能扫的二维码（内容：{n}）：市场不收二维码，换成一个占位方块', en: '"{x}" contains a scannable QR code ({n}): the gallery does not accept QR codes, replace it with a placeholder square' },
  qrSkipped: { zh: '「{x}」没查完有没有二维码（{n}）：要维护者看一眼', en: '"{x}" was not fully checked for QR codes ({n}): a maintainer needs to look' },
  qrLike: { zh: '「{x}」里有像二维码定位块的花纹（扫不出内容）：看一眼是不是二维码', en: '"{x}" has a pattern that looks like QR finder squares (nothing decodes): check whether it is a QR code' },
  hard: { zh: '「{x}」体检有严重问题：{n}', en: '"{x}" has a serious layout problem: {n}' },
  needsFix: { zh: '「{x}」还有能自动修的问题（注释 / 站外链接 / 表单地址），用插件「打成 zip」或「分享」会自动修好', en: '"{x}" still has auto-fixable problems (comments / outside links / form targets); the plugin\'s zip / share does this for you' },
}
const say = (p, lang = 'zh') => (GUARD_MSG[p.code] ? (lang === 'en' ? GUARD_MSG[p.code].en : GUARD_MSG[p.code].zh).replace(/\{(\w+)\}/g, (_, k) => (p[k] === undefined ? '' : String(p[k]))) : message(p, lang))

const ISSUE_NAMES = { covered: '内容被系统栏压住', capsule: '被小程序胶囊挡住', island: '被灵动岛挡住', winctl: '被窗口按钮挡住', homebar: '被底部横条压住', img: '图片坏了', deadlink: '跳到不存在的页' }

/** 归一化后的 HTML 指纹（查重用：同一套换个目录名再交一遍） */
function fingerprint(files) {
  const h = crypto.createHash('sha256')
  for (const f of files.filter((x) => /\.html$/i.test(x.path)).sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(normalizeHtml(f.data.toString('utf8'), { file: f.path }).text.replace(/\s+/g, ' ').trim())
  }
  return h.digest('hex')
}

/** main 上这套原来的作者数字 ID（没有这套 / 不在 git 里给 0）：用户名能被别人重新注册，归属要按数字 ID 认 */
export function prevAuthorId(rel, root = ROOT) {
  try {
    const raw = execFileSync('git', ['-C', root, 'show', `HEAD:./${rel}/design.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 20 })
    const m = JSON.parse(raw)
    return m && m.author && Number.isInteger(m.author.id) ? m.author.id : 0
  } catch { return 0 }
}

/**
 * 和 main 上原来那版比，改了多少（0 = 一样，1 = 全换了）。老作者（T2）更新能自动合并，但大改要人看。
 * 分几组各比各的，取最大的那组（分开比是为了不让大量没变的部分把「某一类全换了」稀释掉）：
 *   text  页面里看得到的字
 *   attrs 属性值（alt、title、value、class、链接……带不带引号都认；style 归样式）
 *   css   样式（CSS 文件、<style>、style 属性），每条声明连着它所在的选择器比（两块互换样式也算改了）
 *   tags  结构（标签名 + 属性名）
 *   media 图片等（按哈希）；other json / txt（按行）
 * text / attrs / css / tags / other 两边加起来不到 4 片不算（太少）；media 只要有就算。design.json、说明文件不算。读不到原来那版返回 null。
 */
export function changeParts(rel, files, root = ROOT) {
  const norm = (x) => x.replace(/\s+/g, ' ').trim()
  const css = (text, name, scope, out) => {
    const stack = []
    let buf = ''
    const emit = () => { const d = norm(buf); if (d) out.css.push(`${name}:${[scope, ...stack].filter(Boolean).join(' > ')}|${d}`); buf = '' }
    for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, ' ')) {
      if (ch === '{') { stack.push(norm(buf)); buf = '' } else if (ch === ';') emit()
      else if (ch === '}') { emit(); stack.pop() } else buf += ch
    }
    emit()
  }
  const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  const take = (name, buf, out) => {
    if (/\.(html?|svg)$/i.test(name)) {
      let t = buf.toString('utf8').replace(/<!--[\s\S]*?-->/g, ' ')
      t = t.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, c) => { css(c, name, '', out); return ' ' })
      t = t.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
      for (const m of t.matchAll(/<(\/?)([a-zA-Z][^\s\/>]*)([^>]*)>/g)) {
        const tag = m[2].toLowerCase()
        const names = []
        for (const at of (m[3] || '').matchAll(ATTR)) {
          const an = at[1].toLowerCase()
          const v = at[2] ?? at[3] ?? at[4]
          names.push(an)
          if (v === undefined) continue
          if (an === 'style') css(v, name, `style@${tag}`, out)
          else { const nv = norm(v); if (nv) out.attrs.push(`${name}:${tag}.${an}=${nv}`) }
        }
        out.tags.push(`${name}:<${m[1]}${tag}${names.length ? ' ' + names.join(' ') : ''}>`)
      }
      for (const seg of t.split(/<[^>]*>/)) { const v = norm(seg); if (v) out.text.push(`${name}:${v}`) }
    } else if (/\.css$/i.test(name)) css(buf.toString('utf8'), name, '', out)
    else if (/\.(json|txt)$/i.test(name)) { for (const l of buf.toString('utf8').split('\n')) { const v = norm(l); if (v) out.other.push(`${name}:${v}`) } } else out.media.push(`${name}#${crypto.createHash('sha256').update(buf).digest('hex')}`)
  }
  const counted = (p) => !/^(design\.json|[^/]*\.md|LICENSE[^/]*)$/i.test(p)
  const empty = () => ({ text: [], attrs: [], css: [], tags: [], media: [], other: [] })
  const before = empty()
  try {
    const git = (args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 })
    const names = git(['ls-tree', '-r', '-z', '--name-only', '--full-tree', 'HEAD', '--', rel]).toString('utf8').split('\0').filter(Boolean)
    if (!names.length) return null
    for (const n of names.slice(0, 400)) { const p = n.slice(rel.length + 1); if (counted(p)) take(p, git(['show', `HEAD:./${n}`]), before) }
  } catch { return null }
  const after = empty()
  for (const f of files) if (counted(f.path)) take(f.path, f.data, after)
  const bag = (list) => { const m = new Map(); for (const t of list) m.set(t, (m.get(t) || 0) + 1); return m }
  const parts = {}
  for (const k of Object.keys(before)) {
    const A = bag(before[k])
    const B = bag(after[k])
    let common = 0
    for (const [t, n] of A) common += Math.min(n, B.get(t) || 0)
    const tot = before[k].length + after[k].length
    parts[k] = tot >= (k === 'media' ? 1 : 4) ? 1 - (2 * common) / tot : 0
  }
  return parts
}
export function changeRatio(rel, files, root = ROOT) {
  const parts = changeParts(rel, files, root)
  return parts ? Math.max(...Object.values(parts)) : 1
}
// 任何一组改了三成以上就算大改（转人工）。宁可多看几次：维护者就是作者自己和 Claude，量不大
export const BIG_CHANGE = 0.3

/** renderPack 给的 PNG 截图里用 jsQR 真扫：扫得出内容的就是二维码 → [{ code: 'qr', x, n }]（每个文件报一次） */
export function qrFound(out) {
  const res = []
  const done = new Set()
  for (const q of (out && out.qrShots) || []) {
    if (done.has(q.file)) continue
    const img = decodePng(q.png)
    if (!img) continue
    let code = null
    try { code = jsQR(img.rgba, img.width, img.height, { inversionAttempts: 'attemptBoth' }) } catch { code = null }
    if (code && typeof code.data === 'string' && code.data) {
      done.add(q.file)
      res.push({ code: 'qr', x: q.file, n: code.data.replace(/[\x00-\x1f]/g, ' ').slice(0, 60) })
    }
  }
  return res
}

/** 查一套 → { id, type, ok, errors, flags, shots, kind, screens } */
export async function checkEntry(rel, { vocab, login = '', id = 0, maintainer = false, render = true, out = '', others = null, prevAuthor = prevAuthorId } = {}) {
  const e = parseEntryPath(rel + '/x')
  const res = { id: e ? e.id : rel, dir: rel, type: e ? e.type : '', ok: false, errors: [], flags: [], shots: [], kind: '', screens: [] }
  const add = (p) => res.errors.push({ code: p.code, msg: say(p), msgEn: say(p, 'en') })
  const flag = (p) => res.flags.push({ code: p.code, msg: say(p), msgEn: say(p, 'en') })
  const abs = path.join(ROOT, rel)
  if (!e || !e.ok) { add({ code: 'dirName', x: rel }); return res }
  if (!fs.existsSync(abs)) { add({ code: 'where', x: rel }); return res }
  // 目录本身是软链接：不跟（不然会读到仓库外面的文件）
  if (fs.lstatSync(abs).isSymbolicLink() || !fs.lstatSync(abs).isDirectory()) { add({ code: 'path', x: rel }); return res }
  // 同一个名字在别的类型目录下也有（templates/x 和 systems/x）：插件按名字找，会拿错
  const twins = listEntries().filter((x) => x.id === e.id && x.dir !== e.dir)
  if (twins.length) add({ code: 'dupId', x: e.id, n: twins.map((x) => x.dir).join('、') })
  const { files, problems } = loadDir(abs)
  for (const p of problems) add(p)
  const r = checkPack(files, { mode: 'ci', vocab })
  for (const p of r.errors) add(p)
  for (const p of r.flags) flag(p)
  res.kind = r.kind
  res.screens = r.screens
  const m = r.manifest
  if (m && m.type && DIR_OF[m.type] !== e.dir) add({ code: 'typeDir', x: DIR_OF[m.type], n: m.type })
  if (m && m.author && typeof m.author === 'object') {
    if (String(m.author.login || '').toLowerCase() !== e.login) add({ code: 'owner', x: e.login })
    else if (login && !maintainer && (String(m.author.login).toLowerCase() !== login.toLowerCase() || (id && m.author.id !== id))) add({ code: 'owner', x: login })
  }
  // 已经在 main 上的这套：数字 ID 要和原来的一样（同名的新账号不能顶替）
  if (!maintainer) {
    const was = prevAuthor(rel)
    if (was && !(m && m.author && m.author.id === was)) add({ code: 'ownerId', x: rel })
    else if (was) {
      res.update = true // 作者更新自己已上架的那套（老作者可自动合并）
      // 大改（某一类改了三成以上）：标出来，转人工看（标记会让车道走 B）
      const ratio = changeRatio(rel, files)
      if (ratio > BIG_CHANGE) flag({ code: 'bigChange', x: rel, n: Math.round(ratio * 100) })
    }
  }
  // 能自动修的（注释、外链）在仓库里就该是修好的：修一遍有变化就说明没修
  for (const f of files.filter((x) => /\.html$/i.test(x.path))) {
    if (normalizeHtml(f.data.toString('utf8'), { file: f.path }).text !== f.data.toString('utf8')) { add({ code: 'needsFix', x: f.path }); break }
  }
  if (others && r.type === 'template' && files.some((f) => /\.html$/i.test(f.path))) {
    const fp = fingerprint(files)
    const same = others.get(fp)
    if (same && same !== e.id) add({ code: 'dupContent', x: e.id, n: same })
  }
  if (render && r.type === 'template' && !res.errors.length && r.screens.length) {
    try {
      // 不算屏的页面（_ 开头的）只扫二维码
      const others = files.filter((f) => /\.html$/i.test(f.path) && !r.screens.includes(f.path)).map((f) => f.path)
      const out1 = await renderPack(abs, { screens: r.screens, kind: r.kind || 'web', size: (r.manifest && r.manifest.size) || '', qr: 'shots', qrPages: others })
      for (const x of out1.errors) add({ code: 'render', x: x.file, n: x.error })
      // 二维码：能扫出来的退回（换成占位方块）；只是像的（定位块那种花纹）标出来给人看
      const qrs = qrFound(out1)
      for (const p of qrs) add(p)
      for (const x of out1.qrLike || []) if (!qrs.some((q) => q.x === x.file)) flag({ code: 'qrLike', x: x.file })
      qrSkippedFlags(out1, flag)
      for (const x of out1.hard) add({ code: 'hard', x: x.file, n: `${ISSUE_NAMES[x.type] || x.type}${x.text ? `（${x.text}）` : ''}` })
      if (out1.soft.length) res.soft = out1.soft.slice(0, 30)
      if (out) {
        const dir = path.join(out, 'shots', e.id)
        fs.mkdirSync(dir, { recursive: true })
        for (const s of out1.shots) {
          if (!s.jpg) continue
          const name = s.file.replace(/\.html$/i, '.jpg')
          fs.writeFileSync(path.join(dir, name), s.jpg)
          res.shots.push(`shots/${e.id}/${name}`)
        }
      }
    } catch (err) {
      add({ code: 'render', x: e.id, n: String(err && err.message || err).slice(0, 160) })
    }
  }
  // 设计系统：所有页面（components.html 等）也断网开出来扫二维码（不截图；体检只看错误）
  if (render && r.type === 'system' && !res.errors.length) {
    // 所有页面（子目录里的也算）：体检只开根目录的前 24 个，二维码全扫（扫不完的标 qrSkipped 转人工）
    const htmls = files.filter((f) => /\.html$/i.test(f.path)).map((f) => f.path)
    const top = htmls.filter((f) => !f.includes('/')).slice(0, 24)
    try {
      const out1 = await renderPack(abs, { screens: top, kind: 'web', shots: false, qr: 'shots', qrPages: htmls })
      for (const x of out1.errors) add({ code: 'render', x: x.file, n: x.error })
      const qrs = qrFound(out1)
      for (const p of qrs) add(p)
      for (const x of out1.qrLike || []) if (!qrs.some((q) => q.x === x.file)) flag({ code: 'qrLike', x: x.file })
      qrSkippedFlags(out1, flag)
    } catch (err) {
      add({ code: 'render', x: e.id, n: String(err && err.message || err).slice(0, 160) })
    }
  }
  res.ok = !res.errors.length
  return res
}

/** 二维码没扫完的（页面太长、图太多、开不出来）：不算查过，标出来转人工 */
function qrSkippedFlags(out, flag) {
  const why = { long: '页面太长，没截完', budget: '截图总数到上限了', images: '图片太多，没逐张查', open: '没打开' }
  const done = new Set()
  for (const x of (out && out.qrSkipped) || []) {
    const k = `${x.file}|${x.why}`
    if (done.has(k)) continue
    done.add(k)
    flag({ code: 'qrSkipped', x: x.file || '图片', n: why[x.why] || x.why })
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  const login = process.env.SUBMITTER_LOGIN || ''
  const id = Number(process.env.SUBMITTER_ID || 0) || 0
  const maintainer = process.env.MAINTAINER === '1'
  const out = path.resolve(process.env.OUT || 'out')
  const render = process.env.NO_RENDER !== '1'
  const vocab = loadVocab()
  fs.mkdirSync(out, { recursive: true })

  const result = { at: new Date().toISOString(), login, lane: '', guard: [], entries: [], deleted: [] }
  let dirs = o.dirs
  if (o.changed) {
    const g = guard(parseChanged(fs.readFileSync(o.changed)), { login, id, maintainer })
    result.guard = g.errors.map((p) => ({ code: p.code, msg: say(p), msgEn: say(p, 'en') }))
    result.lane = g.lane
    result.deleted = g.deleted
    dirs = g.dirs
  }
  if (o.all) dirs = listEntries().map((x) => `${x.dir}/${x.id}`)

  // 查重：先算出仓库里其他套的指纹
  const others = new Map()
  for (const x of listEntries()) {
    if (x.type !== 'template' || dirs.includes(`${x.dir}/${x.id}`)) continue
    try { others.set(fingerprint(loadDir(x.abs).files), x.id) } catch { /* 坏的不算 */ }
  }
  for (const d of dirs) result.entries.push(await checkEntry(d, { vocab, login, id, maintainer, render, out, others }))

  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n')
  const bad = result.guard.length + result.entries.filter((x) => !x.ok).length
  for (const g of result.guard) console.log(`✗ ${g.msg}`)
  for (const x of result.entries) {
    console.log(`${x.ok ? '✓' : '✗'} ${x.dir}${x.flags.length ? `（${x.flags.length} 处要人看）` : ''}`)
    for (const er of x.errors) console.log(`    ✗ ${er.msg}`)
    for (const f of x.flags) console.log(`    · ${f.msg}`)
  }
  if (!dirs.length && !result.guard.length) console.log('没有要查的设计')
  process.exitCode = bad ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(2) })
