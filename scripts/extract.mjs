#!/usr/bin/env node
/**
 * 从某个提交里把设计目录原样取出来（当数据）：按 git 树逐个读 blob，不用 git archive。
 * git archive 会听投稿里 .gitattributes 的 export-ignore / export-subst，投稿人能借它把文件藏起来不让检查看到。
 *
 *   node scripts/extract.mjs <git 目录> <提交> <放到哪> <目录>...
 *
 * 只写普通文件（100644 / 100755）；软链接、子模块、太大的、路径怪的都不写，
 * 记进 <放到哪>/.extract-skipped.txt（check.mjs 会因为「改了的文件没取到」报错）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const CAP = { file: 8 << 20, dir: 40 << 20 }
const SEG = /^[^\0/]+$/

/** git ls-tree -r -l -z 的输出 → [{ mode, type, oid, size, path }] */
export function parseTree(buf) {
  const out = []
  for (const rec of String(buf).split('\0')) {
    if (!rec) continue
    const tab = rec.indexOf('\t')
    if (tab < 0) continue
    const [mode, type, oid, size] = rec.slice(0, tab).trim().split(/\s+/)
    out.push({ mode, type, oid, size: size === '-' ? -1 : Number(size), path: rec.slice(tab + 1) })
  }
  return out
}

/** 一个树条目能不能写：普通文件、路径每段都正常 */
export function safeEntry(e, dir) {
  if (e.type !== 'blob' || (e.mode !== '100644' && e.mode !== '100755')) return 'mode'
  if (!e.path.startsWith(dir + '/')) return 'where'
  const segs = e.path.split('/')
  if (segs.some((s) => !SEG.test(s) || s === '.' || s === '..' || s.toLowerCase() === '.git')) return 'path'
  if (!(e.size >= 0) || e.size > CAP.file) return 'size'
  return ''
}

export function extract(gitDir, sha, dest, dirs) {
  const git = (args, opt = {}) => execFileSync('git', ['-C', gitDir, ...args], { maxBuffer: 64 << 20, ...opt })
  const skipped = []
  for (const dir of dirs) {
    let total = 0
    const list = parseTree(git(['ls-tree', '-r', '-l', '-z', '--full-tree', sha, '--', dir]))
    for (const e of list) {
      const why = safeEntry(e, dir) || (total + e.size > CAP.dir ? 'size' : '')
      if (why) { skipped.push(`${why}\t${e.path}`); continue }
      total += e.size
      const data = git(['cat-file', 'blob', e.oid])
      const out = path.join(dest, e.path)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      // 目标或它的上级是软链接（不该有，dest 是刚清空的）：不写
      const real = fs.realpathSync(path.dirname(out))
      if (!real.startsWith(fs.realpathSync(dest) + path.sep)) { skipped.push(`path\t${e.path}`); continue }
      fs.writeFileSync(out, data, { flag: 'wx' })
    }
  }
  if (skipped.length) fs.writeFileSync(path.join(dest, '.extract-skipped.txt'), skipped.join('\n') + '\n')
  return skipped
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [gitDir, sha, dest, ...dirs] = process.argv.slice(2)
  if (!gitDir || !/^[0-9a-f]{40}$/.test(sha || '') || !dest || !dirs.length) { console.error('用法见文件开头'); process.exit(2) }
  const s = extract(gitDir, sha, dest, dirs)
  for (const x of s) console.log(`没取：${x.replace('\t', ' ')}`)
}
