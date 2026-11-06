#!/usr/bin/env node
/**
 * 建目录：把仓库里所有设计（去掉下架的）整理成 index.json，顺手出两个 npm 包的内容。
 *
 *   node scripts/build-index.mjs --out dist [--prev 上一版 index.json] [--packs-version 2026.1106.1] [--no-render | --shots-from shots]
 *   node scripts/build-index.mjs --render-only --out shots      只截图（发布流程里没有签名钥匙、没有发布权限的那一步跑这个）
 *
 * 产物：
 *   dist/catalog/   → npm 包 dsh-design-gallery：index.json、thumbs/<id>.webp、index.js、package.json、README、LICENSE（签名由 sign.mjs 加）
 *   dist/packs/     → npm 包 dsh-design-gallery-packs：只放这次新增或改过的 d/<id>/<rev>/（文件 + 每屏截图）。没有新的就不出
 *
 * 规矩：
 *   - 这一步不跑任何投稿里的代码（投稿里本来也没有脚本）；渲染只在本机断网浏览器里
 *   - 上一版目录里已经发过的 <id>@<rev> 沿用它的批次版本，不重复打包
 *   - serial 只增不减（插件靠它防「旧目录复活已下架的」）
 *   - 封面和每屏截图的 sha256 + 大小也写进目录（签名覆盖），插件只认对得上的图
 *   - 发布时截图在另一个 job 里做（--render-only），这边 --shots-from 只收真是 JPEG/WebP、不超大小的图，不开浏览器
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { checkPack, renderPack, KINDS, STYLE_IDS } from 'dsh-design-studio/gallery'
import { ROOT, listEntries, loadDir, loadVocab, readJson } from './lib/repo.mjs'

export const CATALOG_PKG = 'dsh-design-gallery'
export const PACKS_PKG = 'dsh-design-gallery-packs'
export const POLICY = 1
export const MIN_PLUGIN = '0.11.0'
export const SOURCES = {
  registries: ['https://registry.npmmirror.com', 'https://mirrors.cloud.tencent.com/npm', 'https://repo.huaweicloud.com/repository/npm', 'https://registry.npmjs.org'],
  cdn: ['https://cdn.jsdelivr.net/npm', 'https://fastly.jsdelivr.net/npm'],
}
const THUMB_W = 320
export const MEDIA_CAP = { thumb: 256 * 1024, shot: 2 * 1024 * 1024 }
// 一个批次包的上限（插件那边：tar 最多 2000 个文件、tgz 最多下载 40MB）；超了的下次再发（每晚还会跑一次）
export const PACK_BUDGET = { files: 1800, bytes: 36 * 1024 * 1024 }

function parseArgs(argv) {
  const o = { out: 'dist', prev: '', packsVersion: '', render: true, renderOnly: false, shotsFrom: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') o.out = argv[++i]
    else if (a === '--prev') o.prev = argv[++i]
    else if (a === '--packs-version') o.packsVersion = argv[++i]
    else if (a === '--no-render') o.render = false
    else if (a === '--render-only') o.renderOnly = true
    else if (a === '--shots-from') o.shotsFrom = argv[++i]
    else { console.error(`不认识的参数 ${a}`); process.exit(2) }
  }
  return o
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
/** 图的登记：路径 + sha256 + 大小（进签名目录） */
const media = (p, buf) => ({ p, sha256: sha(buf), size: buf.length })
const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
const isWebp = (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP'
const shotName = (file) => file.replace(/\.html$/i, '.jpg')

/** 读一个普通文件（不跟链接、不超大小），不是就 null */
function readPlain(file, cap) {
  try {
    const st = fs.lstatSync(file)
    if (!st.isFile() || st.size > cap) return null
    const b = fs.readFileSync(file)
    return b.length <= cap ? b : null
  } catch { return null }
}

/**
 * 从截图 job 的产物里拿一套的图（产物按不可信处理）：
 *   <dir>/<id>/thumb.webp、<dir>/<id>/<屏>.jpg、<dir>/<id>/check.json
 * 只认目录里该有的名字、真是 WebP/JPEG、不超大小；check 只认两个小整数。缺的就当没截到
 */
export function readShots(dir, id, screens, { shots = true } = {}) {
  const none = { thumb: null, shots: [], check: { severe: 0, warn: 0 } }
  const base = path.join(dir, id)
  try { if (!fs.lstatSync(base).isDirectory()) return none } catch { return none }
  const thumb = readPlain(path.join(base, 'thumb.webp'), MEDIA_CAP.thumb)
  const out = { ...none, thumb: thumb && isWebp(thumb) ? thumb : null }
  if (shots) {
    for (const file of screens) {
      const n = shotName(file)
      if (!/^[A-Za-z0-9._-]{1,70}\.jpg$/.test(n)) continue
      const jpg = readPlain(path.join(base, n), MEDIA_CAP.shot)
      if (jpg && isJpeg(jpg)) out.shots.push({ file, jpg })
    }
  }
  try {
    const c = JSON.parse(readPlain(path.join(base, 'check.json'), 4096).toString('utf8'))
    const n = (x) => (Number.isInteger(x) && x >= 0 && x < 10000 ? x : 0)
    out.check = { severe: n(c && c.severe), warn: n(c && c.warn) }
  } catch { /* 没有就算 0 */ }
  return out
}

/** 截一套：封面 + （模板）每屏 → { thumb, shots: [{ file, jpg }], check } */
async function shoot(e, m, screens) {
  const rr = await renderPack(e.abs, { screens, kind: e.type === 'template' ? (m.kind || 'web') : 'web', size: e.type === 'template' ? m.size || '' : '', thumb: THUMB_W, shots: e.type === 'template' })
  return { thumb: rr.thumb || null, shots: rr.shots.filter((s) => s.jpg), check: { severe: rr.hard.length, warn: rr.soft.length } }
}

/** 只截图（发布流程的无权限 job）：每套写 <out>/<id>/thumb.webp、<屏>.jpg、check.json */
export async function renderAll({ out }) {
  const vocab = loadVocab()
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  let n = 0
  for (const e of listEntries()) {
    if (e.type === 'style') continue
    const { files, problems } = loadDir(e.abs)
    const r = checkPack(files, { mode: 'ci', vocab })
    if (problems.length || !r.ok || !r.manifest) continue
    const got = await shoot(e, r.manifest, e.type === 'template' ? r.screens : ['components.html'])
    const d = path.join(out, e.id)
    fs.mkdirSync(d, { recursive: true })
    if (got.thumb) fs.writeFileSync(path.join(d, 'thumb.webp'), got.thumb)
    for (const s of got.shots) fs.writeFileSync(path.join(d, shotName(s.file)), s.jpg)
    fs.writeFileSync(path.join(d, 'check.json'), JSON.stringify(got.check))
    n++
  }
  fs.writeFileSync(path.join(out, 'done.json'), JSON.stringify({ n })) // 一套都没有也有个文件可传
  return n
}

function git(args) {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

/** 这个目录在 git 里的版本：最后一次改动的 commit（前 12 位）、第一次和最后一次的时间、投稿链接（合并说明里的 Submission: 行） */
export function gitInfo(rel) {
  const last = git(['log', '-1', '--format=%H%x09%cI', '--', rel])
  const first = git(['log', '--diff-filter=A', '--reverse', '--format=%cI', '--', rel]).split('\n')[0]
  const body = git(['log', '--format=%B', '--', rel])
  const sub = /^Submission:\s*(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+)\s*$/m.exec(body)
  const [h, at] = last.split('\t')
  return { rev: h ? h.slice(0, 12) : '', added: first || at || '', updated: at || '', submission: sub ? sub[1] : '' }
}

/** 一套的文件清单和摘要（按路径排好；digest 覆盖全部文件） */
export function fileList(files) {
  const list = files.map((f) => ({ p: f.path, sha256: sha(f.data), size: f.data.length })).sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0))
  const digest = sha(list.map((f) => `${f.p}\0${f.sha256}\n`).join(''))
  return { list, digest, bytes: list.reduce((n, f) => n + f.size, 0) }
}

/** tokens.css 里的 --变量: #颜色 → 底色 / 文字 / 主色 / 强调色（只做展示，猜不到就空着） */
export function paletteOf(css) {
  const vars = {}
  for (const m of String(css || '').matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b/gi)) {
    const k = m[1].toLowerCase()
    if (!(k in vars)) vars[k] = (m[2].length === 4 ? '#' + [...m[2].slice(1)].map((c) => c + c).join('') : m[2]).toLowerCase()
  }
  const pick = (...names) => { for (const n of names) for (const k of Object.keys(vars)) if (k === n || k.endsWith('-' + n)) return vars[k]; return '' }
  const out = { bg: pick('bg', 'background', 'surface-0', 'canvas', 'paper'), text: pick('text', 'fg', 'ink', 'foreground', 'on-bg'), primary: pick('primary', 'brand', 'main'), accent: pick('accent', 'secondary', 'highlight') }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v))
}

const bilingual = (x) => (x && typeof x === 'object' ? Object.fromEntries(['zh', 'en'].filter((k) => typeof x[k] === 'string').map((k) => [k, x[k]])) : undefined)
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)))

/** 今天的批次版本号 YYYY.MDD.RUN（semver 不许前导 0：1 月 5 日是 105） */
export function todayVersion(run = 1, d = new Date()) {
  return `${d.getUTCFullYear()}.${(d.getUTCMonth() + 1) * 100 + d.getUTCDate()}.${run}`
}

/** 目录的「内容」哈希：去掉每次都变的字段（serial / generated / commit），用来判断这次有没有必要发 */
export function contentSha(index) {
  if (!index) return ''
  const { serial, generated, commit, ...rest } = index
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

export function nextSerial(prev, d = new Date()) {
  const base = Number(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}01`)
  return Math.max(base, (Number(prev) || 0) + 1)
}

export async function build({ out, prev = null, prevDir = '', packsVersion = '', render = true, shotsFrom = '', now = new Date(), budget = PACK_BUDGET }) {
  const vocab = loadVocab()
  const denyAll = readJson(path.join(ROOT, 'policy', 'denylist.json'), [])
  const denylist = denyAll.filter((d) => !d.restored)
  // 撤销过下架的（/restore）：从下架名单里拿掉，另发一份「撤销名单」（插件本地记着下架名单，见到签了名的撤销才放出来）
  const restored = new Map(denyAll.filter((d) => d.restored && !denylist.some((x) => x.id === d.id)).map((d) => [d.id, d.restored]))
  const featured = new Set(readJson(path.join(ROOT, 'policy', 'featured.json'), []))
  const denied = new Map(denylist.map((d) => [d.id, d]))
  const prevById = new Map(((prev && [...(prev.designs || []), ...(prev.systems || []), ...(prev.styles || [])]) || []).map((e) => [e.id, e]))
  // 下架名单：上一版的 + 这次的，只增不减
  const revoked = new Map(((prev && prev.revoked) || []).map((r) => [`${r.id}@${r.rev || ''}`, r]))
  for (const d of denylist) revoked.set(`${d.id}@${d.rev || ''}`, clean({ id: d.id, rev: d.rev, at: d.at, reason: d.reason }))
  for (const [k, r] of revoked) if (restored.has(r.id)) revoked.delete(k)

  const catDir = path.join(out, 'catalog')
  const packDir = path.join(out, 'packs')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(catDir, 'thumbs'), { recursive: true })
  const pv = packsVersion || todayVersion(1, now)
  let packed = 0
  const index = {
    format: 1,
    serial: nextSerial(prev && prev.serial, now),
    generated: now.toISOString(),
    commit: git(['rev-parse', 'HEAD']).slice(0, 12),
    policy: POLICY,
    minPlugin: MIN_PLUGIN,
    title: { zh: 'DSH 设计市场', en: 'DSH Design Gallery' },
    metadata: {
      types: ['template', 'system', 'style'],
      kinds: KINDS,
      styles: STYLE_IDS,
      categories: Object.entries(vocab.names.categories).map(([id, n]) => ({ id, ...n })),
      tags: Object.entries(vocab.names.tags).map(([id, n]) => ({ id, ...n })),
      sortKeys: ['featured', 'new', 'updated'],
    },
    sources: { ...SOURCES, packages: { catalog: CATALOG_PKG, packs: PACKS_PKG } },
    revoked: [...revoked.values()],
    restored: [...restored].map(([id, at]) => ({ id, at })),
    designs: [],
    systems: [],
    styles: [],
  }
  const skipped = []
  // 一个批次包装多少：插件读批次包最多 2000 个文件、下载最多 40MB（tgz），留出余量；按没压缩的大小算（压缩后只会更小）
  let packFiles = 0
  let packBytes = 0
  const fits = (files, shots) => {
    const n = files.length + shots.length
    const b = files.reduce((x, f) => x + f.data.length + 1024, 0) + shots.reduce((x, s) => x + s.jpg.length + 1024, 0)
    if (packFiles && (packFiles + n > budget.files || packBytes + b > budget.bytes)) return false
    packFiles += n
    packBytes += b
    return true
  }
  // 沿用上一版的条目：封面从上一版目录包里拿（prev.mjs 解到 prevDir/thumbs/），核对哈希；拿不到就不带封面
  const keepOld = (before) => {
    const keep = { ...before }
    const t = before.thumb
    const want = `thumbs/${before.id}.webp`
    let buf = null
    try { if (t && t.p === want && prevDir) buf = fs.readFileSync(path.join(prevDir, want)) } catch { buf = null }
    if (buf && buf.length === t.size && sha(buf) === t.sha256) fs.writeFileSync(path.join(catDir, want), buf)
    else delete keep.thumb
    return keep
  }
  const all = listEntries()
  // 同一个名字出现在两类里：插件按名字找会拿错，两边都不上目录（PR 检查本该拦住，这里兜底）
  const count = new Map()
  for (const e of all) count.set(e.id, (count.get(e.id) || 0) + 1)
  for (const e of all) {
    if (count.get(e.id) > 1) { skipped.push({ id: e.id, why: 'dupId' }); continue }
    if (denied.has(e.id) && !denied.get(e.id).rev) continue
    const { files, problems } = loadDir(e.abs)
    const r = checkPack(files, { mode: 'ci', vocab })
    // main 上的东西都过了 PR 检查；这里再查一遍是兜底（规则变严了的老条目先不上目录，周报里会列出来）
    if (problems.length || !r.ok || !r.manifest) { skipped.push({ id: e.id, why: [...problems, ...r.errors].slice(0, 3).map((p) => p.code).join(',') }); continue }
    const m = r.manifest
    const g = gitInfo(path.relative(ROOT, e.abs))
    const fl = fileList(files)
    const rev = g.rev || fl.digest.slice(0, 12)
    if (denied.has(e.id) && denied.get(e.id).rev === rev) continue
    const before = prevById.get(e.id)
    const tokens = files.find((f) => f.path === 'tokens.css')
    const entry = clean({
      id: e.id,
      type: e.type,
      rev,
      title: bilingual(m.title),
      description: bilingual(m.description),
      kind: m.kind,
      size: m.size,
      os: m.os,
      style: m.style,
      categories: m.categories,
      tags: m.tags,
      lang: m.lang,
      dark: m.dark,
      license: m.license,
      author: m.author && clean({ login: m.author.login, id: m.author.id, name: m.author.name }),
      ai: m.ai,
      derivedFrom: m.derivedFrom,
      shareHash: m.shareHash, // 插件分享时记下的「投稿记号」（token 的哈希），用来在「我的作品」里认出已上架
      screens: e.type === 'template' ? m.screens.map((s) => clean({ file: s.file, title: bilingual(s.title) })) : undefined,
      files: e.type === 'style' ? undefined : fl.list,
      digest: fl.digest,
      bytes: fl.bytes,
      palette: e.type === 'style' ? undefined : paletteOf(tokens && tokens.data.toString('utf8')),
      disclosure: e.type === 'style' ? undefined : { scripts: 0, images: files.filter((f) => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(f.path)).length, fonts: 'system' },
      featured: featured.has(e.id) || undefined,
      added: (before && before.added) || g.added || now.toISOString(),
      updated: g.updated || now.toISOString(),
      submission: g.submission,
      minPlugin: MIN_PLUGIN,
    })
    if (e.type === 'style') {
      entry.style = JSON.parse(files.find((f) => f.path === 'style.json').data.toString('utf8'))
      index.styles.push(entry)
      continue
    }
    // 截图：模板每屏一张 + 第一屏的小封面；设计系统截 components.html
    const screens = e.type === 'template' ? r.screens : ['components.html']
    const got = shotsFrom ? readShots(shotsFrom, e.id, screens, { shots: e.type === 'template' })
      : render ? await shoot(e, m, screens)
        : { thumb: null, shots: [], check: { severe: 0, warn: 0 } }
    const { shots, thumb } = got
    entry.check = got.check
    const reuse = before && before.rev === rev && before.pack
    if (!reuse && !fits(files, shots)) {
      // 这一批装满了（插件读批次包有文件数、大小上限）：这套下次再发。上一版有旧的就整条沿用旧的（封面也用旧的，
      // 不然目录里的封面哈希对不上文件），没有就先不上目录
      skipped.push({ id: e.id, why: 'nextBatch' })
      if (before && before.pack) (e.type === 'template' ? index.designs : index.systems).push(keepOld(before))
      continue
    }
    if (thumb) {
      fs.writeFileSync(path.join(catDir, 'thumbs', `${e.id}.webp`), thumb)
      entry.thumb = media(`thumbs/${e.id}.webp`, thumb)
    }
    // 内容批次：上一版已经发过这个 rev 的沿用；否则这次打进新批次
    if (reuse) {
      entry.pack = before.pack
      entry.shots = before.shots
    } else {
      const rel = `d/${e.id}/${rev}/`
      const dest = path.join(packDir, rel)
      for (const f of files) {
        fs.mkdirSync(path.dirname(path.join(dest, f.path)), { recursive: true })
        fs.writeFileSync(path.join(dest, f.path), f.data)
      }
      const names = []
      for (const s of shots) {
        const n = `_shots/${shotName(s.file)}`
        fs.mkdirSync(path.join(dest, '_shots'), { recursive: true })
        fs.writeFileSync(path.join(dest, n), s.jpg)
        names.push(media(n, s.jpg))
      }
      entry.pack = { v: pv, path: rel }
      if (names.length) entry.shots = names
      packed++
    }
    ;(e.type === 'template' ? index.designs : index.systems).push(entry)
  }
  // 精选在前，其余按更新时间新到旧
  const order = (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || String(b.updated).localeCompare(String(a.updated))
  index.designs.sort(order)
  index.systems.sort(order)
  index.styles.sort(order)

  const json = JSON.stringify(index)
  fs.writeFileSync(path.join(catDir, 'index.json'), json)
  writeCatalogPackage(catDir, index)
  if (packed) writePacksPackage(packDir, pv)
  return { index, packed, packsVersion: packed ? pv : '', skipped, bytes: Buffer.byteLength(json) }
}

function writeCatalogPackage(dir, index) {
  fs.writeFileSync(path.join(dir, 'index.js'), "import fs from 'node:fs'\n/** 读目录（index.json 原始字节；验签名请用 index.json.sig 和设计台里钉的公钥） */\nexport function load() {\n  return JSON.parse(fs.readFileSync(new URL('./index.json', import.meta.url), 'utf8'))\n}\n")
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: CATALOG_PKG,
    version: '0.0.0-dev',
    description: 'Catalog of the DSH design gallery: signed index of community templates, design systems and style cards for dsh-design-studio, with card thumbnails.',
    type: 'module',
    exports: { '.': './index.js', './index.json': './index.json', './index.json.sig': './index.json.sig', './thumbs/*': './thumbs/*' },
    files: ['index.js', 'index.json', 'index.json.sig', 'thumbs', 'README.md', 'LICENSE'],
    license: 'SEE LICENSE IN LICENSE',
    repository: { type: 'git', url: 'git+https://github.com/OrderG-X/dsh-design-gallery.git' },
    homepage: 'https://github.com/OrderG-X/dsh-design-gallery',
    keywords: ['dsh', 'dsh-design-studio', 'design', 'templates'],
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'README.md'), `# dsh-design-gallery\n\nSigned catalog of the [DSH design gallery](https://github.com/OrderG-X/dsh-design-gallery), read by [dsh-design-studio](https://github.com/OrderG-X/dsh-design-studio). ${index.designs.length} templates, ${index.systems.length} design systems, ${index.styles.length} style cards.\n\nDSH 设计市场的目录（已签名），由设计工作台读取。\n`)
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'))
}

function writePacksPackage(dir, version) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: PACKS_PKG,
    version,
    description: 'Immutable content batches of the DSH design gallery (static HTML/CSS design files and screenshots). Read by dsh-design-studio; not meant to be imported.',
    files: ['d', 'README.md', 'LICENSE'],
    license: 'SEE LICENSE IN LICENSE',
    repository: { type: 'git', url: 'git+https://github.com/OrderG-X/dsh-design-gallery.git' },
  }, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'README.md'), '# dsh-design-gallery-packs\n\nContent batches of the DSH design gallery. Each version only adds new or changed designs; the signed catalog (`dsh-design-gallery`) says which batch holds which design.\n\nDSH 设计市场的内容批次包。\n')
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'))
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.renderOnly) {
    const n = await renderAll({ out: path.resolve(o.out) })
    console.log(`截好 ${n} 套`)
    return
  }
  const prev = o.prev ? readJson(o.prev, null) : null
  const r = await build({ out: path.resolve(o.out), prev, prevDir: o.prev ? path.dirname(path.resolve(o.prev)) : '', packsVersion: o.packsVersion, render: o.render, shotsFrom: o.shotsFrom ? path.resolve(o.shotsFrom) : '' })
  console.log(`目录：${r.index.designs.length} 套模板、${r.index.systems.length} 个设计系统、${r.index.styles.length} 张风格卡；${(r.bytes / 1024).toFixed(1)}KB；serial ${r.index.serial}`)
  console.log(r.packed ? `新批次 ${r.packsVersion}：${r.packed} 套` : '没有新内容要打包')
  for (const s of r.skipped) console.log(`  跳过 ${s.id}（${s.why}）`)
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `packs_version=${r.packsVersion}\nserial=${r.index.serial}\ncontent_sha=${contentSha(r.index)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
