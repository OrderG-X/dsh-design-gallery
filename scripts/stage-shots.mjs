#!/usr/bin/env node
/**
 * 把 PR 检查产物里的截图（不可信）挑出来放到要推到 review-shots 分支的目录：
 * 只要 shots/<作者__名字>/<名字>.jpg、真是 JPEG、不超过 2MB，最多 60 张。
 *
 *   node scripts/stage-shots.mjs <产物目录> <目标目录>
 */

import fs from 'node:fs'
import path from 'node:path'

const OK = /^shots\/[a-z0-9-]{1,39}__[a-z0-9-]{3,40}\/[A-Za-z0-9._-]{1,70}\.jpg$/

export function stage(src, dest, { max = 60, size = 2 * 1024 * 1024 } = {}) {
  const base = path.join(src, 'shots')
  const out = []
  if (!fs.existsSync(base) || fs.lstatSync(base).isSymbolicLink()) return out
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue
    for (const f of fs.readdirSync(path.join(base, d.name), { withFileTypes: true })) {
      const rel = `shots/${d.name}/${f.name}`
      if (!f.isFile() || !OK.test(rel) || out.length >= max) continue
      const buf = fs.readFileSync(path.join(base, d.name, f.name))
      if (buf.length > size || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) continue
      fs.mkdirSync(path.join(dest, 'shots', d.name), { recursive: true })
      fs.writeFileSync(path.join(dest, rel), buf)
      out.push(rel)
    }
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const n = stage(process.argv[2], process.argv[3])
  console.log(`${n.length} 张截图`)
}
