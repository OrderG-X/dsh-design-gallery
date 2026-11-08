#!/usr/bin/env node
/**
 * 发布前：从 npm 取上一版目录，算这次的版本号。
 *
 *   node scripts/prev.mjs --out prev/
 *     prev/index.json        上一版目录（没有就不写：第一次发布）
 *     prev/thumbs/*.webp     上一版的封面（rev 没变的条目沿用它，不用这次重截的）
 *     GITHUB_OUTPUT：catalog_version / packs_version（今天第几次：YYYY.MDD.RUN）、prev_sha（上一版 index 的内容哈希，不含 serial / generated）
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readTar } from 'dsh-design-studio/gallery'
import { CATALOG_PKG, PACKS_PKG, todayVersion, contentSha } from './build-index.mjs'

const REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '')

async function packument(name) {
  const r = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
  return r.json()
}

/** 今天已经发过几次：versions 里 YYYY.MDD.* 的最大 RUN + 1 */
export function nextRun(versions, d = new Date()) {
  const head = todayVersion(0, d).replace(/\.0$/, '.')
  let max = 0
  for (const v of versions || []) if (v.startsWith(head)) max = Math.max(max, Number(v.slice(head.length)) || 0)
  return max + 1
}

async function main() {
  const oi = process.argv.indexOf('--out')
  const out = path.resolve(oi > 0 ? process.argv[oi + 1] : 'prev')
  fs.mkdirSync(out, { recursive: true })
  const cat = await packument(CATALOG_PKG)
  const packs = await packument(PACKS_PKG)
  let prev = null
  const latest = cat && cat['dist-tags'] && cat['dist-tags'].latest
  if (latest && cat.versions[latest] && !/^0\.0\.0/.test(latest)) {
    const dist = cat.versions[latest].dist
    const r = await fetch(dist.tarball, { signal: AbortSignal.timeout(30000) })
    const buf = Buffer.from(await r.arrayBuffer())
    const want = String(dist.integrity || '')
    if (want.startsWith('sha512-') && crypto.createHash('sha512').update(buf).digest('base64') !== want.slice(7)) throw new Error('上一版目录的 integrity 对不上')
    const all = readTar(buf)
    const f = all.find((x) => x.path === 'index.json')
    if (f) {
      prev = JSON.parse(f.data.toString('utf8'))
      fs.writeFileSync(path.join(out, 'index.json'), f.data)
      fs.mkdirSync(path.join(out, 'thumbs'), { recursive: true })
      for (const x of all) if (/^thumbs\/[a-z0-9_-]{1,90}\.webp$/.test(x.path)) fs.writeFileSync(path.join(out, x.path), x.data)
    }
  }
  const catalogVersion = todayVersion(nextRun(cat ? Object.keys(cat.versions || {}) : []))
  const packsVersion = todayVersion(nextRun(packs ? Object.keys(packs.versions || {}) : []))
  const lines = `catalog_version=${catalogVersion}\npacks_version=${packsVersion}\nprev_sha=${contentSha(prev)}\nhas_prev=${prev ? 'true' : 'false'}\n`
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines)
  process.stdout.write(lines)
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
