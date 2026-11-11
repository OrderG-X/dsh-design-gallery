#!/usr/bin/env node
/**
 * issue 投稿 → 一个设计目录（给下一步开 PR 用）。在没有任何 token、不引用 secret 的 job 里跑。
 *
 *   ISSUE_BODY / ISSUE_AUTHOR_LOGIN / ISSUE_AUTHOR_ID / ISSUE_NUMBER 只经环境变量传进来（绝不拼进 shell）
 *   node scripts/intake.mjs --out out/intake
 *
 * 做的事：
 *   0. 「确认」四条都要勾（API 开的 issue 不受表单必填约束，这里自己查）
 *   1. 从表单里找附件：只认 https://github.com/user-attachments/ 下的 .zip，或投稿人自己仓库里按提交号钉死的 .zip
 *      （设计台一键投稿走这条），匿名下载，跳转只放行 GitHub 自己的存储
 *   2. 严格解包（和插件同一份 readZip：防路径穿越、软链接、zip 炸弹、限个数和大小）
 *   3. 能自动修的修掉（注释、站外链接改 #、表单提交地址），图片去掉 EXIF / 文字块；写清单 author = issue 作者
 *   4. 用 ci 规则查一遍：不过就写 intake.json { ok:false, errors }，由下一步回复投稿人
 *   5. 不渲染（渲染在 PR 检查里做）
 *
 * 产物：out/intake/intake.json + out/intake/files/<目录>/…
 */

import fs from 'node:fs'
import path from 'node:path'
import { readZip, normalizeHtml, checkPack, message, LICENSES, stripMeta, stripInline } from 'dsh-design-studio/gallery'
import { DIR_OF, ROOT, loadVocab, readJson } from './lib/repo.mjs'

const ZIP_MAX = 8 * 1024 * 1024
const ATTACH = /https:\/\/github\.com\/user-attachments\/(?:files|assets)\/[\w-]+\/[^\s)"'<>]+?\.zip\b/gi
const REDIRECT_OK = (h) => h === 'github.com' || /(^|\.)githubusercontent\.com$/.test(h) || /^github-production-user-asset-[a-z0-9]+\.s3\.amazonaws\.com$/.test(h)

/** issue 表单正文 → { 标题: 值 }（「### 标题\n\n值」一段一段） */
export function parseForm(body) {
  const out = {}
  const parts = String(body || '').split(/^###\s+/m).slice(1)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    const head = (nl < 0 ? p : p.slice(0, nl)).trim()
    const val = (nl < 0 ? '' : p.slice(nl + 1)).trim()
    out[head] = val === '_No response_' ? '' : val
  }
  return out
}

/** 表单值里按字段 id 前缀找（标题写成「设计包 / Design pack」，认中英任一半） */
export function field(form, ...names) {
  for (const [k, v] of Object.entries(form)) {
    const parts = k.split('/').map((x) => x.trim().toLowerCase())
    if (names.some((n) => parts.includes(n.toLowerCase()))) return v
  }
  return ''
}

export function findAttachments(text) {
  return [...new Set(String(text || '').match(ATTACH) || [])]
}

// 设计台一键投稿：zip 放在投稿人自己的仓库（一般是 fork）的某个提交里，地址按提交号钉死。
// 后面紧跟查询串、# 的不认（插件不会这么写；截掉再认就成了另一个地址）
const REPO_ZIP = /https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/[A-Za-z0-9._-]{1,100}\/raw\/[0-9a-f]{40}\/[A-Za-z0-9._-]{1,80}\.zip(?![\w.\/?#-])/g

/** 正文里放在 GitHub 仓库里的 zip：只认投稿人自己仓库的（mine），别人的单独数出来（others） */
export function findRepoZips(text, login) {
  const me = String(login || '').toLowerCase()
  const mine = new Set()
  let others = 0
  for (const m of String(text || '').matchAll(REPO_ZIP)) {
    if (me && m[1].toLowerCase() === me) mine.add(m[0])
    else others++
  }
  return { mine: [...mine], others }
}

// 表单「确认」四条的开头（.github/ISSUE_TEMPLATE/submit-design.yml；设计台一键投稿照抄同样的字）
const AGREE = ['这是我自己', '品牌是虚构的', '里面没有真实的个人信息', '同意按上面选的授权公开']

/** 「确认」那一栏四条都勾了（表单要求必勾；API 开的 issue 不受表单约束，这里逐条查，别的勾选顶替不了） */
export function agreed(form) {
  const lines = String(field(form, 'Confirm', '确认')).split(/\r?\n/)
  return AGREE.every((a) => lines.some((l) => /^[ \t]*[-*] \[[xX]\] /.test(l) && l.replace(/^[ \t]*[-*] \[[xX]\] /, '').startsWith(a)))
}

/** 一键投稿的 zip 地址拆开：{ owner, repo, sha, file }（小写的 owner / repo），不是就 null */
export function repoZipParts(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/raw\/([0-9a-f]{40})\/([A-Za-z0-9._-]{1,80}\.zip)$/.exec(String(url))
  return m ? { owner: m[1].toLowerCase(), repo: m[2].toLowerCase(), sha: m[3], file: m[4] } : null
}

/** 下载一键投稿的 zip：每一跳都得还是同一个仓库、同一个提交、同一个文件（仓库转给别人后的跳转不跟） */
export function sameRepoZip(want) {
  return (u) => {
    if (!want) return false
    const x = new URL(u)
    if (x.protocol !== 'https:' || x.search || x.username || x.port) return false
    const m = x.hostname === 'github.com' ? /^\/([^/]+)\/([^/]+)\/raw\/([0-9a-f]{40})\/([^/]+)$/.exec(x.pathname)
      : x.hostname === 'raw.githubusercontent.com' ? /^\/([^/]+)\/([^/]+)\/([0-9a-f]{40})\/([^/]+)$/.exec(x.pathname) : null
    return !!m && m[1].toLowerCase() === want.owner && m[2].toLowerCase() === want.repo && m[3] === want.sha && m[4] === want.file
  }
}

/** 匿名下载，跟跳转但只跟 GitHub 自己的存储，超过上限就停 */
export async function download(url, { max = ZIP_MAX, fetcher = globalThis.fetch, allow = null } = {}) {
  let u = url
  for (let hop = 0; hop < 5; hop++) {
    const host = new URL(u).hostname
    if (!REDIRECT_OK(host) || new URL(u).protocol !== 'https:') throw new Error(`不下载这个地址：${host}`)
    if (allow && !allow(u)) throw new Error(`不下载这个地址：${host}${new URL(u).pathname.slice(0, 80)}`)
    const r = await fetcher(u, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'dsh-design-gallery-intake' } })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) throw new Error('跳转没有地址')
      u = new URL(loc, u).href
      continue
    }
    if (r.status !== 200) throw new Error(`下载失败 HTTP ${r.status}`)
    const len = Number(r.headers.get('content-length') || 0)
    if (len > max) throw new Error('附件太大')
    const chunks = []
    let n = 0
    for await (const c of r.body) {
      n += c.length
      if (n > max) throw new Error('附件太大')
      chunks.push(Buffer.from(c))
    }
    return Buffer.concat(chunks)
  }
  throw new Error('跳转太多次')
}

/** JPEG：去掉 APP1–APP15（EXIF、XMP、GPS 都在这里）和注释段；坏的原样返回 null */
export function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  const out = [buf.subarray(0, 2)]
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null
    const m = buf[i + 1]
    if (m === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out) } // 图像数据开始：后面原样
    const len = buf.readUInt16BE(i + 2)
    if (len < 2 || i + 2 + len > buf.length) return null
    const drop = (m >= 0xe1 && m <= 0xef) || m === 0xfe
    if (!drop) out.push(buf.subarray(i, i + 2 + len))
    i += 2 + len
  }
  return null
}

/** PNG：去掉文字块和 EXIF 块（tEXt / zTXt / iTXt / eXIf / tIME） */
export function stripPng(buf) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null
  const out = [SIG]
  let i = 8
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.subarray(i + 4, i + 8).toString('latin1')
    const end = i + 12 + len
    if (end > buf.length) return null
    if (!['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) out.push(buf.subarray(i, end))
    i = end
    if (type === 'IEND') return Buffer.concat(out)
  }
  return null
}

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '')
}

/**
 * 包（[{ path, data }]）→ 修好的文件 + 清单 + 改了什么
 * @returns { ok, dir, files, changes: [文字], errors: [{ code, msg }] }
 */
export function prepare(files, { login, id, license, slug: wantSlug, title: wantTitle, vocab, lang = 'zh' }) {
  const changes = []
  const fixed = []
  for (const f of files) {
    if (/\.html$/i.test(f.path)) {
      const before = f.data.toString('utf8')
      const r = normalizeHtml(before, { file: f.path })
      const FIXED = { comment: '删掉注释', form: '表单去掉提交地址', ping: '链接去掉 ping', externalLink: '站外链接改成 #' }
      const what = [...new Set((r.changes || []).map((c) => FIXED[c.code] || c.code))]
      const text = stripInline(r.text)
      if (text !== r.text) what.push('内嵌图片去掉照片信息')
      if (text !== before) changes.push(`${f.path}：${what.join('、')}`)
      fixed.push({ path: f.path, data: Buffer.from(text, 'utf8') })
    } else if (/\.(css|svg)$/i.test(f.path)) {
      const before = f.data.toString('utf8')
      const text = stripInline(before)
      if (text !== before) changes.push(`${f.path}：内嵌图片去掉照片信息`)
      fixed.push(text !== before ? { path: f.path, data: Buffer.from(text, 'utf8') } : f)
    } else if (/\.jpe?g$/i.test(f.path)) {
      const s = stripJpeg(f.data)
      if (s && s.length !== f.data.length) changes.push(`${f.path}：去掉了照片信息（EXIF）`)
      fixed.push({ path: f.path, data: s || f.data })
    } else if (/\.png$/i.test(f.path)) {
      const s = stripPng(f.data)
      if (s && s.length !== f.data.length) changes.push(`${f.path}：去掉了图片里的文字信息`)
      fixed.push({ path: f.path, data: s || f.data })
    } else if (/\.(webp|gif)$/i.test(f.path)) {
      const s = stripMeta(f.data, f.path.slice(-4).toLowerCase() === 'webp' ? 'webp' : 'gif')
      if (s && s.length !== f.data.length) changes.push(`${f.path}：去掉了照片信息（EXIF / XMP / 注释）`)
      fixed.push({ path: f.path, data: s || f.data })
    } else fixed.push(f)
  }
  const mi = fixed.findIndex((f) => f.path === 'design.json')
  let m = null
  try { m = mi >= 0 ? JSON.parse(fixed[mi].data.toString('utf8')) : null } catch { m = null }
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    // 署名以 issue 作者为准；插件自己的本地字段（from、shareToken）不进仓库
    const name = m.author && typeof m.author === 'object' && typeof m.author.name === 'string' ? m.author.name : undefined
    m.author = { login, id, ...(name ? { name } : {}) }
    if (LICENSES.includes(license)) m.license = license
    if (m.from && m.from.id && m.from.rev && !m.derivedFrom) m.derivedFrom = `${m.from.id}@${m.from.rev}`
    delete m.from
    delete m.shareToken
    delete m.share_token
    if (wantTitle && (!m.title || typeof m.title !== 'object')) m.title = { zh: wantTitle }
    fixed[mi] = { path: 'design.json', data: Buffer.from(JSON.stringify(m, null, 2) + '\n', 'utf8') }
  }
  const r = checkPack(fixed, { mode: 'ci', vocab })
  const type = m && DIR_OF[m.type] ? m.type : 'template'
  const title = m && m.title && typeof m.title === 'object' ? (m.title.en || m.title.zh || '') : ''
  const slug = slugify(wantSlug) || slugify(title) || `design-${Date.now().toString(36)}`
  const dir = `${DIR_OF[type]}/${String(login).toLowerCase()}__${slug.length >= 3 ? slug : `${slug}-design`}`
  return { ok: r.ok, dir, files: fixed, changes, errors: r.errors.map((p) => ({ code: p.code, msg: message(p, lang), msgEn: message(p, 'en') })), flags: r.flags.map((p) => ({ code: p.code, msg: message(p, lang), msgEn: message(p, 'en') })) }
}

async function main() {
  const outIdx = process.argv.indexOf('--out')
  const out = path.resolve(outIdx > 0 ? process.argv[outIdx + 1] : 'out/intake')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const login = String(process.env.ISSUE_AUTHOR_LOGIN || '')
  const id = Number(process.env.ISSUE_AUTHOR_ID || 0)
  const issue = Number(process.env.ISSUE_NUMBER || 0)
  const result = { ok: false, issue, login, id, dir: '', changes: [], errors: [], flags: [] }
  const done = () => fs.writeFileSync(path.join(out, 'intake.json'), JSON.stringify(result, null, 2) + '\n')
  try {
    if (!readJson(path.join(ROOT, 'policy', 'intake.json'), { open: true }).open) { result.errors.push({ code: 'closed', msg: '投稿暂停中，晚点再交', msgEn: 'Submissions are paused, please try later' }); return done() }
    if (!/^[A-Za-z0-9-]{1,39}$/.test(login) || !Number.isInteger(id) || id <= 0) throw new Error('不知道是谁交的')
    const form = parseForm(process.env.ISSUE_BODY || '')
    if (!agreed(form)) { result.errors.push({ code: 'agree', msg: '「确认」那四条没勾全：勾上再交', msgEn: 'Not all four boxes under "Confirm" are ticked' }); return done() }
    const text = field(form, 'Design pack', '设计包') || process.env.ISSUE_BODY
    const repo = findRepoZips(text, login)
    const urls = [...findAttachments(text), ...repo.mine]
    if (!urls.length && repo.others) { result.errors.push({ code: 'attachOwner', msg: '设计包要放在你自己的 GitHub 仓库里（或者直接把 zip 拖进「设计包」那一栏）', msgEn: 'The design pack must be in your own GitHub repository (or drag the zip into the "Design pack" field)' }); return done() }
    if (urls.length !== 1) { result.errors.push({ code: 'attach', msg: urls.length ? '一次只交一个 zip' : '没找到设计包：把插件「分享到市场」存下的 zip 拖进「设计包」那一栏', msgEn: urls.length ? 'Attach exactly one zip' : 'No design pack found: drag the zip saved by the plugin into the "Design pack" field' }); return done() }
    const own = repoZipParts(urls[0])
    const zip = await download(urls[0], own ? { allow: sameRepoZip(own) } : {})
    const { files } = readZip(zip)
    const license = /CC-BY/i.test(field(form, 'License', '授权')) ? 'CC-BY-4.0' : 'CC0-1.0'
    const p = prepare(files, { login, id, license, slug: field(form, 'Short name', '短名'), vocab: loadVocab() })
    Object.assign(result, { ok: p.ok, dir: p.dir, changes: p.changes, errors: p.errors, flags: p.flags })
    if (p.ok) {
      for (const f of p.files) {
        const dest = path.join(out, 'files', p.dir, f.path)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, f.data)
      }
    }
  } catch (e) {
    result.errors.push({ code: e && e.code ? `zip_${e.code}` : 'intake', msg: `没处理成：${String((e && e.message) || e).slice(0, 160)}`, msgEn: `Could not process: ${String((e && e.message) || e).slice(0, 160)}` })
  }
  done()
}

if (import.meta.url === `file://${process.argv[1]}`) main()
