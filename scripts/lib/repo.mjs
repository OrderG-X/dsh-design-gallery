/**
 * 仓库里的设计目录：路径规矩、读成 [{ path, data }]、词表
 *
 *   templates/<login>__<slug>/   一套模板
 *   systems/<login>__<slug>/     一个设计系统
 *   styles/<login>__<slug>/      一张风格卡
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// GALLERY_ROOT：测试时换一个假仓库
export const ROOT = process.env.GALLERY_ROOT ? path.resolve(process.env.GALLERY_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const TYPE_DIRS = { templates: 'template', systems: 'system', styles: 'style' }
export const DIR_OF = { template: 'templates', system: 'systems', style: 'styles' }
// 只有维护者能改的地方（碰了就是 C 车道：必须人看）
export const PROTECTED = /^(\.github|scripts|policy|vocab|schema|test)\//
export const ID_RE = /^([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)__([a-z0-9-]{3,40})$/

/** 'templates/abc__cafe/home.html' → { type, id, login, slug, rest } ；不是设计目录里的给 null */
export function parseEntryPath(p) {
  const parts = String(p).split('/')
  if (parts.length < 2 || !TYPE_DIRS[parts[0]]) return null
  const m = ID_RE.exec(parts[1])
  return { type: TYPE_DIRS[parts[0]], dir: parts[0], id: parts[1], login: m ? m[1] : '', slug: m ? m[2] : '', ok: !!m, rest: parts.slice(2).join('/') }
}

/** 一个设计目录 → [{ path, data }]；软链接、隐藏文件直接算错（返回 problems） */
export function loadDir(abs) {
  const files = []
  const problems = []
  const walk = (dir, rel, depth) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name
      if (ent.name.startsWith('.')) { problems.push({ code: 'path', x: r }); continue }
      const full = path.join(dir, ent.name)
      const st = fs.lstatSync(full)
      if (st.isSymbolicLink()) { problems.push({ code: 'path', x: r }); continue }
      if (st.isDirectory()) { if (depth >= 3) problems.push({ code: 'path', x: r }); else walk(full, r, depth + 1); continue }
      if (!st.isFile()) { problems.push({ code: 'path', x: r }); continue }
      files.push({ path: r, data: fs.readFileSync(full) })
    }
  }
  walk(abs, '', 0)
  return { files, problems }
}

/** 受控词表 → { categories: [id], tags: [id], names: { categories: {id: {zh,en}}, tags } } */
export function loadVocab(root = ROOT) {
  const read = (n) => JSON.parse(fs.readFileSync(path.join(root, 'vocab', `${n}.json`), 'utf8'))
  const out = { names: {} }
  for (const n of ['categories', 'tags']) {
    const list = read(n)
    out[n] = list.map((x) => x.id)
    out.names[n] = Object.fromEntries(list.map((x) => [x.id, { zh: x.zh, en: x.en }]))
  }
  return out
}

export const readJson = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return dflt } }

/** 仓库里现有的全部设计：[{ type, dir, id, abs }] */
export function listEntries(root = ROOT) {
  const out = []
  for (const [dir, type] of Object.entries(TYPE_DIRS)) {
    const base = path.join(root, dir)
    if (!fs.existsSync(base)) continue
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory() || !ID_RE.test(ent.name)) continue
      out.push({ type, dir, id: ent.name, abs: path.join(base, ent.name) })
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}
