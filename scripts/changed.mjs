#!/usr/bin/env node
/**
 * PR 改了哪些文件：读 git diff -z --name-status 的输出。不依赖任何包（工作流装依赖之前就要用）。
 *
 *   node scripts/changed.mjs <changed.txt>     列出改动碰到的设计目录（一行一个；名字合法的才算）
 */

import fs from 'node:fs'

/**
 * git diff -z --name-status（NUL 分隔，路径原样，中文名不转义）、git diff --name-status 或纯路径列表 → [{ status, path }]
 * 工作流里一律用 -z：不加 -z 时 git 会把中文等路径加引号、转成八进制，读出来就不是真路径了
 */
export function parseChanged(text) {
  const out = []
  const str = Buffer.isBuffer(text) ? text.toString('utf8') : String(text)
  if (str.includes('\0')) {
    const t = str.split('\0')
    for (let i = 0; i < t.length; i++) {
      const st = t[i]
      if (!st) continue
      const m = /^([AMDRCTUX])\d*$/.exec(st)
      if (!m) { out.push({ status: 'M', path: st }); continue } // 对不上格式：当成改了这个路径（守卫会按路径判）
      if (m[1] === 'R' || m[1] === 'C') { out.push({ status: 'D', path: t[i + 1] || '' }); out.push({ status: 'A', path: t[i + 2] || '' }); i += 2 } else { out.push({ status: m[1], path: t[i + 1] || '' }); i += 1 }
    }
    return out.filter((x) => x.path)
  }
  for (const line of str.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const m = /^([AMDRCT])\d*\t(.+?)(?:\t(.+))?$/.exec(t)
    if (!m) { out.push({ status: 'M', path: t }); continue }
    if (m[1] === 'R' || m[1] === 'C') { out.push({ status: 'D', path: m[2] }); out.push({ status: 'A', path: m[3] }) } else out.push({ status: m[1], path: m[2] })
  }
  return out
}

/** 改动里碰到的设计目录（名字合法的才算，都是 ASCII，能放心给 shell 用）：工作流按这个取文件 */
export function changedDirs(changed) {
  const set = new Set()
  for (const c of changed) {
    const m = /^(templates|systems|styles)\/([a-z0-9-]{1,39}__[a-z0-9-]{3,40})\//.exec(c.path)
    if (m) set.add(`${m[1]}/${m[2]}`)
  }
  return [...set].sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = process.argv[2]
  if (!f) { console.error('用法：node scripts/changed.mjs <changed.txt>'); process.exit(2) }
  for (const d of changedDirs(parseChanged(fs.readFileSync(f)))) console.log(d)
}
