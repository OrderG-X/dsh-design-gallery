#!/usr/bin/env node
/**
 * 出插件自带的离线种子：从建好的目录（build-index 的产物）里挑几套模板 + 全部风格卡，
 * 写成设计台 gallery-seed/ 的样子。没联网、或者第一次打开还没取到目录时，设计库市场就显示这些。
 *
 *   node scripts/build-seed.mjs --from dist --out ../dsh-design-studio/gallery-seed
 *
 * 挑哪几套写在 policy/seed.json：{ "templates": ["作者__名字", …] }（每种类型挑一套）。
 * 产物：
 *   index.json           目录同样的格式，只留挑中的模板、全部风格卡；设计系统不带（体积）
 *   thumbs/<id>.webp     封面
 *   d/<id>/<rev>/…       这一套的文件 + 第一屏截图（_shots/，只带一张省体积）
 * 种子跟着插件包走（不单独签名），插件只在没有已验过签名的缓存目录时用它；联网取到目录后就换成正式的。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, readJson } from './lib/repo.mjs'

export const SEED_CAP = 2 * 1024 * 1024 // 整个种子的上限（插件包别太胖）

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

function parseArgs(argv) {
  const o = { from: 'dist', out: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from') o.from = argv[++i]
    else if (argv[i] === '--out') o.out = argv[++i]
    else { console.error(`不认识的参数 ${argv[i]}`); process.exit(2) }
  }
  if (!o.out) { console.error('要给 --out'); process.exit(2) }
  return o
}

/** 读一个文件，和目录里登记的大小、sha256 对得上才要 */
function readChecked(file, want) {
  const b = fs.readFileSync(file)
  if (b.length !== want.size || sha(b) !== want.sha256) throw new Error(`${file} 和目录里登记的对不上`)
  return b
}

export function buildSeed({ from, out, pick = readJson(path.join(ROOT, 'policy', 'seed.json'), { templates: [] }) }) {
  const ix = JSON.parse(fs.readFileSync(path.join(from, 'catalog', 'index.json'), 'utf8'))
  const ids = Array.isArray(pick.templates) ? pick.templates : []
  const designs = []
  for (const id of ids) {
    const e = ix.designs.find((x) => x.id === id && x.type === 'template')
    if (!e) throw new Error(`目录里没有 ${id}`)
    designs.push(e)
  }
  const kinds = designs.map((e) => e.kind)
  if (new Set(kinds).size !== kinds.length) throw new Error('每种类型只挑一套')

  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'thumbs'), { recursive: true })
  let bytes = 0
  const write = (rel, buf) => {
    const f = path.join(out, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, buf)
    bytes += buf.length
  }
  const keep = []
  for (const e of designs) {
    const src = path.join(from, 'packs', e.pack.path)
    if (!fs.existsSync(src)) throw new Error(`批次里没有 ${e.pack.path}（要用这次 build-index 新出的 dist，别用 --prev 沿用旧批次）`)
    for (const f of e.files) write(path.join(e.pack.path, f.p), readChecked(path.join(src, f.p), f))
    const shot = (e.shots || [])[0]
    if (shot) write(path.join(e.pack.path, shot.p), readChecked(path.join(src, shot.p), shot))
    if (e.thumb) write(e.thumb.p, readChecked(path.join(from, 'catalog', e.thumb.p), e.thumb))
    keep.push({ ...e, shots: shot ? [shot] : [] })
  }
  const seed = { ...ix, designs: keep, systems: [], revoked: [], restored: [] }
  write('index.json', Buffer.from(JSON.stringify(seed)))
  if (bytes > SEED_CAP) throw new Error(`种子 ${(bytes / 1024).toFixed(0)}KB，超过 ${SEED_CAP / 1024}KB：少挑几套或换小一点的`)
  return { designs: keep.length, styles: seed.styles.length, bytes }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = parseArgs(process.argv.slice(2))
  const r = buildSeed(o)
  console.log(`种子：${r.designs} 套模板、${r.styles} 张风格卡；${(r.bytes / 1024).toFixed(0)}KB → ${o.out}`)
}
