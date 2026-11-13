/**
 * 内容仓库脚本的测试：假仓库（GALLERY_ROOT）里跑检查、守卫、建目录、签名、收稿、闸门、命令。
 * 渲染要 Chrome：没有就跳过那几条（NO_RENDER）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeZip, findBrowser } from 'dsh-design-studio/gallery'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REAL = path.resolve(HERE, '..')
const FAKE = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-test-'))
process.env.GALLERY_ROOT = FAKE
fs.cpSync(path.join(REAL, 'vocab'), path.join(FAKE, 'vocab'), { recursive: true })
fs.cpSync(path.join(REAL, 'policy'), path.join(FAKE, 'policy'), { recursive: true })
fs.copyFileSync(path.join(REAL, 'LICENSE'), path.join(FAKE, 'LICENSE'))
const HAS_CHROME = !!findBrowser()

const { guard, parseChanged, checkEntry, changeRatio, changeParts, BIG_CHANGE } = await import('../scripts/check.mjs')
const { changedDirs } = await import('../scripts/changed.mjs')
const { build, paletteOf, todayVersion, nextSerial, contentSha, readShots } = await import('../scripts/build-index.mjs')
const { signBytes, verifyBytes, rawPublic } = await import('../scripts/sign.mjs')
const { parseForm, field, findAttachments, findRepoZips, agreed, repoZipParts, sameRepoZip, prepare, stripJpeg, stripPng, slugify, download } = await import('../scripts/intake.mjs')
const { apply } = await import('../scripts/intake-apply.mjs')
const { readResults, decide, mergeResults, standing, countMine } = await import('../scripts/gate.mjs')
const { parseReport, shouldHide, candidates, restoredSince, designAuthorId } = await import('../scripts/reports.mjs')
const { parseCommand, applyPolicy } = await import('../scripts/chatops.mjs')
const { stage } = await import('../scripts/stage-shots.mjs')
const { extract, parseTree, safeEntry } = await import('../scripts/extract.mjs')
const { nextRun } = await import('../scripts/prev.mjs')
const { loadVocab } = await import('../scripts/lib/repo.mjs')

const screen = (title, kind = 'app', extra = '') => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="dsh-design" content="${kind}"><title>${title} · 抹茶时光</title><link rel="stylesheet" href="tokens.css"></head><body><h1>${title}</h1>${extra}<a href="menu.html">菜单</a></body></html>`
const manifest = (over = {}) => ({
  format: 1, type: 'template', title: { zh: '抹茶时光', en: 'Matcha Time' }, description: { zh: '茶饮店两屏' }, kind: 'app',
  screens: [{ file: 'home.html', title: { zh: '首页' } }, { file: 'menu.html', title: { zh: '菜单' } }],
  categories: ['food'], tags: ['menu'], license: 'CC0-1.0', author: { login: 'Alice-1', id: 42 }, ai: { generated: true, tool: 'dsh-design-studio@0.11.0' }, ...over,
})
function putEntry(rel, files) {
  const dir = path.join(FAKE, rel)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const [n, v] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true })
    fs.writeFileSync(path.join(dir, n), typeof v === 'string' ? v : Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2))
  }
  return dir
}
const goodFiles = (over = {}) => ({
  'design.json': manifest(over),
  'home.html': screen('首页'),
  'menu.html': screen('菜单'),
  'tokens.css': ':root{--bg:#f7f7ef;--text:#1f2a14;--primary:#4c7229;--accent:#c8d9a6}body{background:var(--bg);color:var(--text)}',
})

test('守卫：只能动自己的目录、受保护路径转 C、删太多算失败、一次一套', () => {
  putEntry('templates/alice-1__matcha', goodFiles())
  const g1 = guard(parseChanged('A\ttemplates/alice-1__matcha/home.html\nA\ttemplates/alice-1__matcha/design.json'), { login: 'Alice-1' })
  assert.deepEqual(g1.errors, [])
  assert.deepEqual(g1.dirs, ['templates/alice-1__matcha'])
  const g2 = guard(parseChanged('M\tscripts/check.mjs\nA\ttemplates/bob__thing/a.html'), { login: 'alice-1' })
  assert.equal(g2.lane, 'C')
  assert.deepEqual(g2.errors.map((e) => e.code).sort(), ['notYours', 'protected'])
  const g3 = guard(parseChanged(['D\ttemplates/x1__aaa/a.html', 'D\ttemplates/x2__bbb/a.html', 'D\ttemplates/x3__ccc/a.html'].join('\n')), { login: 'x1' })
  assert.ok(g3.errors.some((e) => e.code === 'massDelete' || e.code === 'notYours'))
  const g4 = guard(parseChanged('A\ttemplates/alice-1__one/a.html\nA\ttemplates/alice-1__two/a.html'), { login: 'alice-1' })
  assert.ok(g4.errors.some((e) => e.code === 'onePerPr'))
  const g5 = guard(parseChanged('A\ttemplates/Alice__Bad Name/a.html\nA\treadme.txt'), { login: 'alice' })
  assert.ok(g5.errors.some((e) => e.code === 'dirName'))
  assert.equal(g5.lane, 'C') // 根目录的文件也算受保护
  // 改名：拆成删 + 加
  assert.deepEqual(parseChanged('R100\ttemplates/a__old/x.html\ttemplates/a__new/x.html').map((c) => c.status), ['D', 'A'])
})

test('查一套：好的过；作者不是投稿人、目录类型不对、没修的外链都拒', async () => {
  putEntry('templates/alice-1__matcha', goodFiles())
  const vocab = loadVocab(FAKE)
  const ok = await checkEntry('templates/alice-1__matcha', { vocab, login: 'Alice-1', id: 42, render: false })
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
  const other = await checkEntry('templates/alice-1__matcha', { vocab, login: 'mallory', id: 7, render: false })
  assert.ok(other.errors.some((e) => e.code === 'owner'))
  putEntry('styles/alice-1__matcha2', goodFiles())
  const wrongDir = await checkEntry('styles/alice-1__matcha2', { vocab, render: false })
  assert.ok(wrongDir.errors.some((e) => e.code === 'typeDir'))
  fs.rmSync(path.join(FAKE, 'styles'), { recursive: true })
  putEntry('templates/alice-1__ext', goodFiles({ title: { zh: '外链' } }))
  fs.writeFileSync(path.join(FAKE, 'templates/alice-1__ext/home.html'), screen('首页', 'app', '<a href="https://evil.example/x">x</a><!-- hi -->'))
  const ext = await checkEntry('templates/alice-1__ext', { vocab, render: false })
  assert.equal(ext.ok, false)
  assert.ok(ext.errors.some((e) => e.code === 'needsFix' || e.code === 'externalLink' || e.code === 'comment'))
  fs.rmSync(path.join(FAKE, 'templates/alice-1__ext'), { recursive: true })
  // 软链接直接拒
  putEntry('templates/alice-1__link', goodFiles())
  fs.symlinkSync('/etc/hosts', path.join(FAKE, 'templates/alice-1__link/hosts.css'))
  const link = await checkEntry('templates/alice-1__link', { vocab, render: false })
  assert.ok(link.errors.some((e) => e.code === 'path'))
  fs.rmSync(path.join(FAKE, 'templates/alice-1__link'), { recursive: true })
})

test('查一套：和已有的一样算重复', async () => {
  const vocab = loadVocab(FAKE)
  putEntry('templates/bob__copycat', goodFiles({ author: { login: 'bob', id: 9 } }))
  const others = new Map()
  const { files } = (await import('../scripts/lib/repo.mjs')).loadDir(path.join(FAKE, 'templates/alice-1__matcha'))
  const h = crypto.createHash('sha256')
  // 用 check.mjs 同样的指纹：直接跑一遍全量查重流程更真实
  for (const f of files.filter((x) => /\.html$/.test(x.path)).sort((a, b) => a.path.localeCompare(b.path))) h.update(f.data.toString('utf8').replace(/\s+/g, ' ').trim())
  others.set(h.digest('hex'), 'alice-1__matcha')
  const dup = await checkEntry('templates/bob__copycat', { vocab, render: false, others })
  assert.ok(dup.errors.some((e) => e.code === 'dupContent'))
  fs.rmSync(path.join(FAKE, 'templates/bob__copycat'), { recursive: true })
})

test('断网渲染：截图、硬问题', { skip: !HAS_CHROME && '没有 Chrome' }, async () => {
  const vocab = loadVocab(FAKE)
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-out-'))
  const r = await checkEntry('templates/alice-1__matcha', { vocab, render: true, out })
  assert.equal(r.ok, true, JSON.stringify(r.errors))
  assert.deepEqual(r.shots, ['shots/alice-1__matcha/home.jpg', 'shots/alice-1__matcha/menu.jpg'])
  const jpg = fs.readFileSync(path.join(out, r.shots[0]))
  assert.equal(jpg[0], 0xff)
  // 坏图（引用不存在的图片会被规则拦；这里用一张能过规则但打不开的「图」：扩展名和头对得上但内容截断）
  putEntry('templates/alice-1__broken', { ...goodFiles(), 'home.html': screen('首页', 'app', '<img src="a.png" width="40" height="40" alt="">'), 'a.png': Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008060000001ff3ff61', 'hex') })
  const b = await checkEntry('templates/alice-1__broken', { vocab, render: true, out })
  assert.ok(b.errors.some((e) => e.code === 'hard') || b.errors.some((e) => e.code === 'magic'), JSON.stringify(b.errors))
  fs.rmSync(path.join(FAKE, 'templates/alice-1__broken'), { recursive: true })
})

test('二维码：能扫出来的退回，只是像的标出来', { skip: !HAS_CHROME && '没有 Chrome' }, async () => {
  const { qrMatrix, qrPath } = await import(path.join(REAL, 'node_modules/dsh-design-studio/lib/qr.js'))
  const vocab = loadVocab(FAKE)
  const m = qrMatrix('https://evil.example/pay')
  const n = m.length
  const svg = `<svg viewBox="-4 -4 ${n + 8} ${n + 8}" width="150" height="150" role="img" aria-label="码"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${qrPath(m)}" fill="#111"/></svg>`
  putEntry('templates/alice-1__qrcode', { ...goodFiles(), 'home.html': screen('首页', 'app', `<div style="height:900px"></div><p>扫码付款</p>${svg}`) })
  const r = await checkEntry('templates/alice-1__qrcode', { vocab, render: true })
  assert.ok(r.errors.some((e) => e.code === 'qr' && e.msg.includes('evil.example')), JSON.stringify(r.errors))
  // 三个定位块的样子、中间是乱画的（扫不出）：只标出来
  const finder = (x, y) => `<div style="position:absolute;left:${x}px;top:${y}px;width:28px;height:28px;border:4px solid #111;box-sizing:border-box;background:#fff"><div style="margin:4px;width:12px;height:12px;background:#111"></div></div>`
  const fake = `<div style="position:relative;width:132px;height:132px;background:#fff">${finder(0, 0)}${finder(104, 0)}${finder(0, 104)}<div style="position:absolute;left:44px;top:44px;width:40px;height:40px;background:repeating-linear-gradient(45deg,#111 0 4px,#fff 4px 9px)"></div></div>`
  putEntry('templates/alice-1__qrcode', { ...goodFiles(), 'home.html': screen('首页', 'app', `<p>扫码</p>${fake}`) })
  const f = await checkEntry('templates/alice-1__qrcode', { vocab, render: true })
  assert.ok(!f.errors.some((e) => e.code === 'qr'), JSON.stringify(f.errors))
  assert.ok(f.flags.some((x) => x.code === 'qrLike'), JSON.stringify(f.flags))
  // 普通的两屏：没有
  const ok = await checkEntry('templates/alice-1__matcha', { vocab, render: true })
  assert.ok(!ok.errors.some((e) => e.code === 'qr') && !ok.flags.some((x) => x.code === 'qrLike'))
  fs.rmSync(path.join(FAKE, 'templates/alice-1__qrcode'), { recursive: true })
})

test('二维码：长页面中段、设计系统样张也扫', { skip: !HAS_CHROME && '没有 Chrome' }, async () => {
  const vocab = loadVocab(FAKE)
  const { qrMatrix, qrPath } = await import(path.join(REAL, 'node_modules/dsh-design-studio/lib/qr.js'))
  const m = qrMatrix('https://evil.example/mid')
  const n = m.length
  const svg = `<svg viewBox="-4 -4 ${n + 8} ${n + 8}" width="150" height="150" role="img" aria-label="码"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${qrPath(m)}" fill="#111"/></svg>`
  // 长页面：二维码放在约 5600px 处（以前只截前几段 + 最后一段，会漏）
  // 再放几个位置，包括正好卡在两张截图接缝上的
  try {
    for (const top of [5600, 1700, 2450, 3300]) {
      putEntry('templates/alice-1__longpage', { ...goodFiles(), 'home.html': screen('首页', 'app', `<div style="height:${top}px"></div>${svg}<div style="height:6000px"></div>`) })
      const r = await checkEntry('templates/alice-1__longpage', { vocab, render: true })
      assert.ok(r.errors.some((e) => e.code === 'qr' && e.msg.includes('evil.example/mid')), `${top}: ${JSON.stringify(r.errors)}`)
    }
    // 没列成屏的页面规则本来就不收（所以模板的页面都扫到了）
    putEntry('templates/alice-1__longpage', { ...goodFiles(), '_promo.html': screen('活动', 'app', svg) })
    const r2 = await checkEntry('templates/alice-1__longpage', { vocab, render: false })
    assert.ok(r2.errors.some((e) => e.code === 'screenUnlisted'), JSON.stringify(r2.errors))
  } finally { fs.rmSync(path.join(FAKE, 'templates/alice-1__longpage'), { recursive: true, force: true }) }
  // 设计系统的样张页
  const sys = {
    'design.json': { format: 1, type: 'system', title: { zh: '青竹', en: 'Bamboo' }, description: { zh: '安静的绿色系统' }, categories: ['food'], license: 'CC0-1.0', author: { login: 'alice-1', id: 42 }, ai: { generated: true, tool: 'dsh-design-studio@0.11.0' } },
    'system.json': { name: '青竹' },
    'tokens.css': ':root{--color-bg:#ffffff;--color-text:#111111;--color-primary:#2f6f4f}',
    'components.css': '.btn{color:var(--color-primary)}',
    'DESIGN.md': '# 青竹\n',
  }
  const page = (extra) => `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>组件 · 青竹</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="components.css"></head><body><button class="btn">按钮</button>${extra}</body></html>`
  putEntry('systems/alice-1__bamboo', { ...sys, 'components.html': page(svg) })
  const s1 = await checkEntry('systems/alice-1__bamboo', { vocab, render: true })
  assert.ok(s1.errors.some((e) => e.code === 'qr'), JSON.stringify(s1.errors))
  // 第 25 个页面也扫
  const many = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [`p${String(i).padStart(2, '0')}.html`, page('')]))
  putEntry('systems/alice-1__bamboo', { ...sys, 'components.html': page(''), ...many, 'zz-last.html': page(svg) })
  const s3 = await checkEntry('systems/alice-1__bamboo', { vocab, render: true })
  assert.ok(s3.errors.some((e) => e.code === 'qr' && e.msg.includes('zz-last.html')), JSON.stringify(s3.errors))
  // 子目录里的 HTML 规则本来就不收
  putEntry('systems/alice-1__bamboo', { ...sys, 'components.html': page(''), 'pages/more.html': page(svg) })
  const s4 = await checkEntry('systems/alice-1__bamboo', { vocab, render: false })
  assert.ok(s4.errors.some((e) => e.code === 'subHtml'), JSON.stringify(s4.errors))
  putEntry('systems/alice-1__bamboo', { ...sys, 'components.html': page('') })
  const s2 = await checkEntry('systems/alice-1__bamboo', { vocab, render: true })
  assert.equal(s2.ok, true, JSON.stringify(s2.errors))
  assert.ok(!s2.flags.some((f) => f.code === 'qrSkipped'), JSON.stringify(s2.flags))
  fs.rmSync(path.join(FAKE, 'systems/alice-1__bamboo'), { recursive: true })
})

test('二维码：扫不完的（超预算）不算查过，标出来转人工', { skip: !HAS_CHROME && '没有 Chrome' }, async () => {
  const { renderPack } = await import('dsh-design-studio/gallery')
  const dir = putEntry('templates/alice-1__budget', { ...goodFiles(), 'home.html': screen('首页', 'app', '<div style="height:9000px"></div>') })
  try {
    const out = await renderPack(dir, { screens: ['home.html', 'menu.html'], kind: 'app', shots: false, qr: 'shots', qrBudget: { parts: 3, total: 3, images: 0 } })
    assert.ok(out.qrSkipped.some((x) => x.file === 'home.html' && x.why === 'long'), JSON.stringify(out.qrSkipped))
    assert.ok(out.qrSkipped.some((x) => x.file === 'menu.html' && x.why === 'budget'), JSON.stringify(out.qrSkipped))
    assert.equal(out.qrShots.length, 3)
  } finally { fs.rmSync(dir, { recursive: true }) }
})

test('同一个名字不能跨类型：检查拒、建目录两边都不收', async () => {
  const vocab = loadVocab(FAKE)
  putEntry('templates/alice-1__sample', goodFiles())
  putEntry('styles/alice-1__sample', { 'design.json': { format: 1, type: 'style', title: { zh: '薄荷' }, license: 'CC0-1.0', author: { login: 'alice-1', id: 42 } }, 'style.json': { name: '薄荷' } })
  const r = await checkEntry('templates/alice-1__sample', { vocab, render: false })
  assert.ok(r.errors.some((e) => e.code === 'dupId' && e.msg.includes('styles')), JSON.stringify(r.errors))
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dup-'))
  const b = await build({ out, render: false })
  assert.ok(![...b.index.designs, ...b.index.systems, ...b.index.styles].some((e) => e.id === 'alice-1__sample'))
  assert.equal(b.skipped.filter((x) => x.id === 'alice-1__sample' && x.why === 'dupId').length, 2)
  fs.rmSync(path.join(FAKE, 'templates/alice-1__sample'), { recursive: true })
  fs.rmSync(path.join(FAKE, 'styles/alice-1__sample'), { recursive: true })
})

test('离线种子：只带挑中的模板（每种类型一套）、全部风格卡、文件和目录对得上；挑错了报错', async () => {
  const { buildSeed } = await import('../scripts/build-seed.mjs')
  putEntry('templates/alice-1__seeda', goodFiles())
  putEntry('templates/alice-1__seedb', goodFiles({ title: { zh: '抹茶二号', en: 'Matcha Two' } }))
  putEntry('styles/alice-1__seedmint', { 'design.json': { format: 1, type: 'style', title: { zh: '薄荷', en: 'Mint' }, description: { zh: '清爽的薄荷绿' }, license: 'CC0-1.0', author: { login: 'alice-1', id: 42 }, ai: { generated: true, tool: 'dsh-design-studio@0.11.0' } }, 'style.json': { c: { bg: '#ffffff', surface: '#f4fbf8', text: '#10221b', muted: '#3f5a50', line: '#d6e7e0', primary: '#1f7a5c', accent: '#f2a541', on: '#ffffff', link: '#1f7a5c' }, head: 'ROUND', w: 700, radius: 12, shadow: 'none' } })
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-seed-'))
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-seed-out-'))
  try {
    const b = await build({ out, render: false })
    assert.ok(!b.skipped.some((x) => /seed/.test(x.id)), JSON.stringify(b.skipped))
    const r = buildSeed({ from: out, out: seed, pick: { templates: ['alice-1__seeda'] } })
    assert.equal(r.designs, 1)
    const ix = JSON.parse(fs.readFileSync(path.join(seed, 'index.json'), 'utf8'))
    assert.deepEqual(ix.designs.map((e) => e.id), ['alice-1__seeda'])
    assert.deepEqual(ix.systems, [])
    assert.ok(ix.styles.some((e) => e.id === 'alice-1__seedmint'))
    const e = ix.designs[0]
    for (const f of e.files) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(seed, e.pack.path, f.p))).digest('hex'), f.sha256)
    assert.ok(b.index.designs.some((x) => x.id === 'alice-1__seedb'))
    assert.throws(() => buildSeed({ from: out, out: seed, pick: { templates: ['alice-1__seeda', 'alice-1__seedb'] } }), /每种类型只挑一套/)
    assert.throws(() => buildSeed({ from: out, out: seed, pick: { templates: ['alice-1__nope'] } }), /没有/)
  } finally {
    for (const d of [out, seed, path.join(FAKE, 'templates/alice-1__seeda'), path.join(FAKE, 'templates/alice-1__seedb'), path.join(FAKE, 'styles/alice-1__seedmint')]) fs.rmSync(d, { recursive: true, force: true })
  }
})

test('改动列表：-z 格式（中文名原样）、只列合法的设计目录', () => {
  const z = ['A', 'templates/alice-1__matcha/assets/抹茶 图.svg', 'M', 'templates/alice-1__matcha/home.html', 'D', 'styles/bob__mint/style.json', 'R100', 'templates/a__old/x.html', 'templates/a__new1/x.html', 'A', 'templates/Bad Name/a.html', 'M', 'README.md', ''].join('\0')
  const c = parseChanged(Buffer.from(z))
  assert.deepEqual(c.map((x) => x.status), ['A', 'M', 'D', 'D', 'A', 'A', 'M'])
  assert.equal(c[0].path, 'templates/alice-1__matcha/assets/抹茶 图.svg')
  assert.deepEqual(changedDirs(c), ['styles/bob__mint', 'templates/a__new1', 'templates/a__old', 'templates/alice-1__matcha'])
  // 中文名不再被当成「不在设计目录里」
  const g = guard(parseChanged(Buffer.from(['A', 'templates/alice-1__matcha/assets/抹茶.svg', ''].join('\0'))), { login: 'alice-1' })
  assert.ok(!g.errors.some((e) => e.code === 'where'), JSON.stringify(g.errors))
  // 真 git：带中文名的提交，-z 输出解析出来是原路径
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-z-'))
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'core.quotepath=true', ...a])
  git('init', '-q')
  git('commit', '-q', '--allow-empty', '-m', 'base')
  const base = git('rev-parse', 'HEAD').toString().trim()
  fs.mkdirSync(path.join(repo, 'templates/alice-1__matcha/assets'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'templates/alice-1__matcha/assets/抹茶.svg'), '<svg/>')
  git('add', '-A')
  git('commit', '-q', '-m', 'add')
  const quoted = git('diff', '--no-renames', '--name-status', `${base}...HEAD`).toString()
  assert.match(quoted, /"templates/) // 不加 -z：加引号转义了
  const raw = git('diff', '-z', '--no-renames', '--name-status', `${base}...HEAD`)
  assert.equal(parseChanged(raw)[0].path, 'templates/alice-1__matcha/assets/抹茶.svg')
  fs.rmSync(repo, { recursive: true, force: true })
})

test('老作者大改：改了一半以上标出来', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-big-'))
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@x', ...a])
  git('init', '-q')
  const rel = 'templates/alice-1__matcha'
  const files = goodFiles()
  for (const [n, v] of Object.entries(files)) { fs.mkdirSync(path.join(repo, rel), { recursive: true }); fs.writeFileSync(path.join(repo, rel, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2)) }
  git('add', '-A')
  git('commit', '-q', '-m', 'v1')
  const asList = (o) => Object.entries(o).map(([n, v]) => ({ path: n, data: Buffer.isBuffer(v) ? v : Buffer.from(typeof v === 'string' ? v : JSON.stringify(v, null, 2)) }))
  assert.equal(changeRatio(rel, asList(files), repo), 0)
  const small = { ...files, 'home.html': files['home.html'].replace('<h1>首页</h1>', '<h1>首页</h1><p>新加一句</p>') }
  assert.ok(changeRatio(rel, asList(small), repo) < BIG_CHANGE)
  const big = { ...files, 'home.html': '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>完全不同</title></head><body><main><section>另一套布局</section><section>别的文字</section><footer>页脚</footer></main></body></html>', 'menu.html': '<!doctype html><html><body><div>换掉了</div></body></html>', 'tokens.css': ':root{--bg:#000}' }
  assert.ok(changeRatio(rel, asList(big), repo) > BIG_CHANGE)
  assert.equal(changeRatio('templates/nobody__here', asList(files), repo), 1) // 读不到原来的：当全换了
  // 骨架不变（18 组卡片的标签一样）、正文和样式全换：也算大改（不被没变的标签稀释）
  const cards = (words, cls) => Array.from({ length: 18 }, (_, i) => `<div class="${cls}"><h3>${words[0]} ${i}</h3><p>${words[1]}第 ${i} 号</p><span>${words[2]}</span></div>`).join('\n')
  const v1 = { ...files, 'home.html': screen('首页', 'app', cards(['果园', '今天采摘', '¥28'], 'card')), 'tokens.css': ':root{--bg:#f7f7ef;--text:#1f2a14}\n.card{padding:12px;border-radius:8px}\n.card h3{font-size:18px}' }
  for (const [n, v] of Object.entries(v1)) fs.writeFileSync(path.join(repo, rel, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  git('add', '-A')
  git('commit', '-q', '-m', 'v2')
  const rewrite = { ...v1, 'home.html': screen('首页', 'app', cards(['民宿', '可以预订', '¥680/晚'], 'card')), 'tokens.css': ':root{--bg:#101820;--text:#f0e6d2}\n.card{display:grid;gap:4px;margin:0 auto}\n.card h3{letter-spacing:.1em}' }
  const parts = changeParts(rel, asList(rewrite), repo)
  assert.ok(changeRatio(rel, asList(rewrite), repo) > BIG_CHANGE, JSON.stringify(parts))
  assert.ok(parts.tags < 0.2, JSON.stringify(parts)) // 骨架确实没怎么变
  // 两块互换样式（声明一条没少，只是换了位置）：样式按选择器比，算改了
  const sec = (a, b) => ({ ...v1, 'tokens.css': `body{margin:0;background:#fff;color:#111}main{display:grid;grid-template-columns:2fr 1fr;gap:20px;padding:30px}button{border:0;padding:16px;background:#ddd;color:#111}.first{${a}}.second{${b}}` })
  const sa = 'background:#f7e3b0;border-radius:30px;padding:40px;font-size:24px'
  const sb = 'background:#c4e9ed;border-radius:0px;padding:12px;font-size:15px'
  const s1 = sec(sa, sb)
  for (const [n, v] of Object.entries(s1)) fs.writeFileSync(path.join(repo, rel, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  git('add', '-A')
  git('commit', '-q', '-m', 'v3')
  const swapped = sec(sb, sa)
  assert.ok(changeRatio(rel, asList(swapped), repo) > BIG_CHANGE, JSON.stringify(changeParts(rel, asList(swapped), repo)))
  // 不带引号的属性值（<input value=…>）全换：也算
  const inputs = (w) => screen('首页', 'app', Array.from({ length: 18 }, (_, i) => `<article><div><label><input readonly value=${w}${i}></label></div></article>`).join(''))
  const a1 = { ...s1, 'home.html': inputs('果园采摘') }
  for (const [n, v] of Object.entries(a1)) fs.writeFileSync(path.join(repo, rel, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  git('add', '-A')
  git('commit', '-q', '-m', 'v4')
  const a2 = { ...a1, 'home.html': inputs('小屋度假') }
  assert.ok(changeRatio(rel, asList(a2), repo) > BIG_CHANGE, JSON.stringify(changeParts(rel, asList(a2), repo)))
  // 换掉唯一的一张图：也算（图换了要人看）
  const withImg = { ...a1, 'assets/a.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' }
  fs.mkdirSync(path.join(repo, rel, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(repo, rel, 'assets/a.svg'), withImg['assets/a.svg'])
  git('add', '-A')
  git('commit', '-q', '-m', 'v5')
  const pngish = { ...withImg, 'assets/a.png': Buffer.from([0x89, 0x50]) }
  delete pngish['assets/a.svg']
  assert.ok(changeParts(rel, asList(pngish), repo).media > BIG_CHANGE)
  for (const [n, v] of Object.entries(v1)) fs.writeFileSync(path.join(repo, rel, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  fs.rmSync(path.join(repo, rel, 'assets'), { recursive: true })
  git('add', '-A')
  git('commit', '-q', '-m', 'v6')
  // 改一张卡的价格：不算大改
  const tweak = { ...v1, 'home.html': v1['home.html'].replace('¥28</span>', '¥30</span>') }
  assert.ok(changeRatio(rel, asList(tweak), repo) < BIG_CHANGE, JSON.stringify(changeParts(rel, asList(tweak), repo)))
  fs.rmSync(repo, { recursive: true, force: true })
  // 闸门：有 bigChange 标记就走 B
  const now = Date.parse('2026-11-06T00:00:00Z')
  const upd = readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: true, errors: [], flags: [{ code: 'bigChange', msg: 'x' }], shots: [], update: true }] }))
  assert.equal(decide(upd, { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', priorMerged: 1, now }).lane, 'B')
})

test('闸门：24 小时投稿数没数全就不算全绿（卡上提醒维护者留意）', () => {
  const now = Date.parse('2026-11-06T00:00:00Z')
  const style = readResults(JSON.stringify({ entries: [{ id: 'alice-1__mint', type: 'style', ok: true, errors: [], flags: [], shots: [] }] }))
  assert.equal(decide(style, { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', now }).conclusion === 'success', true)
  const d = decide(style, { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', partial: true, now })
  assert.equal(d.conclusion === 'success', false)
  assert.equal(d.lane, 'B')
  assert.ok(d.labels.includes('count: partial'))
  assert.match(d.comment, /没数全/)
})

test('举报：候选人全列出来（不截前 100 个）', () => {
  const body = `### 设计 id / Design id\n\neve__bank\n\n### 问题 / Problem\n\n仿冒真实网站或机构 / Imitates a real site or organization\n\n### 说明 / Details\n\n_No response_`
  const issues = Array.from({ length: 105 }, (_, i) => ({ state: 'open', created_at: '2026-11-05T00:00:00Z', user: { login: `u${i}`, id: 1000 + i, type: 'User' }, body }))
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-rep-')), 'issues.json')
  fs.writeFileSync(f, JSON.stringify(issues))
  const out = execFileSync(process.execPath, [path.join(REAL, 'scripts/reports.mjs'), 'candidates', '--id', 'eve__bank', '--issues', f], { env: { ...process.env, GALLERY_ROOT: FAKE } }).toString().trim().split('\n')
  assert.equal(out.length, 105)
  assert.equal(out[104], '1104 u104') // 「数字 id 用户名」：工作流按 id 查年龄
})

test('建目录：一个批次包装不下的下次再发（插件读得了）', async () => {
  putEntry('templates/alice-1__batch-a', goodFiles())
  putEntry('templates/alice-1__batch-b', goodFiles({ title: { zh: '第二套' } }))
  try {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-batch-'))
    const b = await build({ out, render: false, budget: { files: 5, bytes: 1e9 } })
    const inIndex = b.index.designs.map((e) => e.id)
    const later = b.skipped.filter((x) => x.why === 'nextBatch').map((x) => x.id)
    assert.ok(later.length >= 1, JSON.stringify(b.skipped))
    assert.ok(later.every((id) => !inIndex.includes(id)))
    // 下一次（上一版目录带着已发的）：剩下的打进新批次
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-batch-'))
    const b2 = await build({ out: out2, prev: b.index, render: false, budget: { files: 5, bytes: 1e9 } })
    const ids2 = b2.index.designs.map((e) => e.id)
    assert.ok(later.some((id) => ids2.includes(id)), JSON.stringify(b2.skipped))
  } finally {
    fs.rmSync(path.join(FAKE, 'templates/alice-1__batch-a'), { recursive: true, force: true })
    fs.rmSync(path.join(FAKE, 'templates/alice-1__batch-b'), { recursive: true, force: true })
  }
})

test('建目录：装不下、沿用旧版时封面也用旧的（哈希对得上）', async () => {
  putEntry('templates/alice-1__batch-a', goodFiles())
  putEntry('templates/alice-1__batch-b', goodFiles({ title: { zh: '第二套' } }))
  try {
    const budget = { files: 5, bytes: 1e9 }
    const b0 = await build({ out: fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-batch-')), render: false, budget })
    const skipId = b0.skipped.find((x) => x.why === 'nextBatch').id
    const ids = ['alice-1__batch-a', 'alice-1__batch-b']
    const prevDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-prev-'))
    fs.mkdirSync(path.join(prevDir, 'thumbs'))
    const olds = {}
    const designs = ids.map((id) => {
      const buf = Buffer.from(`old-thumb-${id}`)
      olds[id] = buf
      fs.writeFileSync(path.join(prevDir, 'thumbs', `${id}.webp`), buf)
      return { id, type: 'template', rev: '0ldrev', title: { zh: '旧版' }, pack: { v: '2026.1101.1', path: `d/${id}/0ldrev/` }, thumb: { p: `thumbs/${id}.webp`, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length } }
    })
    const prev = { serial: b0.index.serial, designs, systems: [], styles: [] }
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-batch-'))
    const b1 = await build({ out, prev, prevDir, render: false, budget })
    assert.ok(b1.skipped.some((x) => x.id === skipId && x.why === 'nextBatch'), JSON.stringify(b1.skipped))
    const kept = b1.index.designs.find((e) => e.id === skipId)
    assert.equal(kept.rev, '0ldrev')
    assert.deepEqual(fs.readFileSync(path.join(out, 'catalog', kept.thumb.p)), olds[skipId])
    // 拿不到上一版的封面：不带封面，也不留对不上的哈希
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-batch-'))
    const b2 = await build({ out: out2, prev, render: false, budget })
    const kept2 = b2.index.designs.find((e) => e.id === skipId)
    assert.equal(kept2.rev, '0ldrev')
    assert.equal(kept2.thumb, undefined)
    assert.equal(fs.existsSync(path.join(out2, 'catalog', 'thumbs', `${skipId}.webp`)), false)
  } finally {
    fs.rmSync(path.join(FAKE, 'templates/alice-1__batch-a'), { recursive: true, force: true })
    fs.rmSync(path.join(FAKE, 'templates/alice-1__batch-b'), { recursive: true, force: true })
  }
})

test('建目录：字段、调色板、风格卡内联、下架的不进、批次沿用、serial 只增', async () => {
  putEntry('styles/alice-1__mint', {
    'design.json': { format: 1, type: 'style', title: { zh: '薄荷' }, description: { zh: '清爽的薄荷绿' }, license: 'CC0-1.0', author: { login: 'alice-1', id: 42 }, ai: { generated: false } },
    'style.json': { c: { bg: '#ffffff', surface: '#f4fbf7', text: '#10231a', muted: '#3d5a4b', line: '#d5e8de', primary: '#1e6b47', accent: '#2f9e6b', on: '#ffffff', link: '#1e6b47' }, head: 'SANS', w: 600, radius: 12, shadow: 'none', nzh: '留白多；主色只点缀', dzh: '清爽' },
  })
  putEntry('templates/carol__gone', goodFiles({ author: { login: 'carol', id: 5 }, title: { zh: '要下架的' } }))
  fs.writeFileSync(path.join(FAKE, 'policy/denylist.json'), JSON.stringify([{ id: 'carol__gone', at: '2026-11-06T00:00:00Z', reason: 'policy' }]))
  fs.writeFileSync(path.join(FAKE, 'policy/featured.json'), JSON.stringify(['alice-1__mint']))
  putEntry('templates/alice-1__matcha', goodFiles({ shareHash: 'ab'.repeat(16) }))
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
  const now = new Date('2026-11-06T12:00:00Z')
  const r = await build({ out, render: false, now })
  const idx = JSON.parse(fs.readFileSync(path.join(out, 'catalog/index.json'), 'utf8'))
  assert.equal(idx.format, 1)
  assert.equal(idx.serial, 2026110601)
  assert.deepEqual(idx.designs.map((d) => d.id), ['alice-1__matcha'])
  assert.deepEqual(idx.styles.map((d) => d.id), ['alice-1__mint'])
  assert.equal(idx.designs[0].shareHash, 'ab'.repeat(16)) // 投稿记号进目录，插件靠它认出「我分享的已上架」
  assert.equal(idx.styles[0].featured, true)
  assert.equal(idx.styles[0].style.head, 'SANS')
  assert.ok(idx.revoked.some((x) => x.id === 'carol__gone'))
  const d = idx.designs[0]
  assert.deepEqual(d.palette, { bg: '#f7f7ef', text: '#1f2a14', primary: '#4c7229', accent: '#c8d9a6' })
  assert.equal(d.pack.v, '2026.1106.1')
  assert.ok(fs.existsSync(path.join(out, 'packs', d.pack.path, 'home.html')))
  assert.equal(d.files.length, 4)
  assert.match(d.digest, /^[0-9a-f]{64}$/)
  assert.equal(r.packed, 1)
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'catalog/package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-design-gallery')
  // 第二次：上一版里已有同一 rev → 沿用批次，不再打包；serial 比上一版大
  const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
  const r2 = await build({ out: out2, prev: idx, render: false, now })
  assert.equal(r2.packed, 0)
  assert.equal(r2.index.designs[0].pack.v, '2026.1106.1')
  assert.equal(r2.index.serial, 2026110602)
  assert.equal(contentSha(r2.index), contentSha(idx))
  assert.equal(fs.existsSync(path.join(out2, 'packs')), false)
  assert.deepEqual(r2.index.restored, [])
  // 撤销下架（/restore 标上 restored）：从下架名单里拿掉（上一版里的也拿掉），发「撤销名单」，这套回到目录
  fs.writeFileSync(path.join(FAKE, 'policy/denylist.json'), JSON.stringify([{ id: 'carol__gone', at: '2026-11-06T00:00:00Z', reason: 'policy', restored: '2026-11-07T00:00:00Z' }]))
  const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
  const r3 = await build({ out: out3, prev: r2.index, render: false, now })
  assert.ok(!r3.index.revoked.some((x) => x.id === 'carol__gone'), JSON.stringify(r3.index.revoked))
  assert.deepEqual(r3.index.restored, [{ id: 'carol__gone', at: '2026-11-07T00:00:00Z' }])
  assert.ok(r3.index.designs.some((x) => x.id === 'carol__gone'))
  // 下架名单、精选手改坏了：不发（当成空的发出去，下架的会重新露出来）
  for (const f of ['denylist.json', 'featured.json']) {
    const keep = fs.readFileSync(path.join(FAKE, 'policy', f), 'utf8')
    fs.writeFileSync(path.join(FAKE, 'policy', f), '[{"id": "carol__gone",}]')
    await assert.rejects(build({ out: fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-')), prev: r3.index, render: false, now }), f)
    fs.writeFileSync(path.join(FAKE, 'policy', f), keep)
  }
  fs.writeFileSync(path.join(FAKE, 'policy/denylist.json'), '[]')
  fs.writeFileSync(path.join(FAKE, 'policy/featured.json'), '[]')
  fs.rmSync(path.join(FAKE, 'templates/carol__gone'), { recursive: true })
})

test('建目录的小工具', () => {
  assert.deepEqual(paletteOf(':root{--color-bg:#FFF;--brand:#123456;--ink:#000000}'), { bg: '#ffffff', text: '#000000', primary: '#123456' })
  assert.equal(todayVersion(3, new Date('2026-01-05T00:00:00Z')), '2026.105.3')
  assert.equal(nextSerial(2026110699, new Date('2026-11-06T00:00:00Z')), 2026110700)
  assert.equal(nextRun(['2026.1106.1', '2026.1106.2', '2026.1105.9'], new Date('2026-11-06T10:00:00Z')), 3)
  assert.equal(nextRun([], new Date('2026-11-06T10:00:00Z')), 1)
})

test('签名：签了能验，改一个字节就不对，别的钥匙不认', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' })
  const bytes = Buffer.from('{"format":1}')
  const sig = signBytes(bytes, pem)
  const pub = rawPublic(publicKey)
  assert.equal(verifyBytes(bytes, sig, [pub]), true)
  assert.equal(verifyBytes(Buffer.from('{"format":2}'), sig, [pub]), false)
  const other = rawPublic(crypto.generateKeyPairSync('ed25519').publicKey)
  assert.equal(verifyBytes(bytes, sig, [other]), false)
  assert.equal(verifyBytes(bytes, sig, [other, pub]), true) // 两把钥匙钉着，哪把对都行
  assert.equal(verifyBytes(bytes, 'garbage', [pub]), false)
})

test('收稿：表单、附件地址、下载只跟 GitHub 自己的跳转', async () => {
  const body = '### 设计包 / Design pack\n\n[matcha.zip](https://github.com/user-attachments/files/123456/matcha.zip)\n\n### 短名 / Short name\n\nmatcha-time\n\n### 授权 / License\n\nCC-BY-4.0（别人用要署你的名 / others must credit you）\n\n### 确认 / Confirm\n\n- [X] ok'
  const f = parseForm(body)
  assert.equal(field(f, 'Short name'), 'matcha-time')
  assert.match(field(f, '授权'), /CC-BY/)
  assert.deepEqual(findAttachments(field(f, 'Design pack')), ['https://github.com/user-attachments/files/123456/matcha.zip'])
  assert.deepEqual(findAttachments('https://evil.example/x.zip https://github.com/someone/repo/raw/x.zip'), [])
  assert.equal(slugify('Matcha Time!! 抹茶'), 'matcha-time')
  // 一键投稿：zip 在投稿人自己仓库里、按提交号钉死；别人仓库的不认，分支名（会变）的不认
  const sha = 'a'.repeat(40)
  const own = `https://github.com/Alice-1/dsh-design-gallery/raw/${sha}/submission.zip`
  assert.deepEqual(findRepoZips(`[x](${own})`, 'alice-1'), { mine: [own], others: 0 })
  assert.deepEqual(findRepoZips(`https://github.com/bob/dsh-design-gallery/raw/${sha}/submission.zip`, 'alice-1'), { mine: [], others: 1 })
  assert.deepEqual(findRepoZips('https://github.com/Alice-1/r/raw/main/submission.zip', 'alice-1'), { mine: [], others: 0 })
  assert.deepEqual(findRepoZips(`${own}.exe ${own}/x`, 'alice-1'), { mine: [], others: 0 })
  assert.deepEqual(findRepoZips(`${own}?download=1 ${own}#x`, 'alice-1'), { mine: [], others: 0 })
  assert.deepEqual(findRepoZips(`见 ${own}。`, 'alice-1'), { mine: [own], others: 0 })
  // 四个确认要逐条勾上（API 开的 issue 不受表单必填约束；别的勾选顶替不了）
  const AG = ['这是我自己（或用设计台）做的原创设计', '品牌是虚构的，没有仿冒', '里面没有真实的个人信息 / x', '同意按上面选的授权公开，并收进设计市场']
  const conf = (n, extra = '') => parseForm(`### 确认 / Confirm\n\n${AG.map((x, i) => `- [${i < n ? 'X' : ' '}] ${x}`).join('\n')}${extra}`)
  assert.equal(agreed(conf(4)), true)
  assert.equal(agreed(conf(3)), false)
  assert.equal(agreed(conf(3, '\n- [x] 别的东西\n- [x] 再来一个')), false)
  assert.equal(agreed(parseForm(`### 确认 / Confirm\n\n${AG.map((x) => `- [x] ${x}`).slice(0, 3).join('\n')}\n- [x] ${AG[0]}`)), false)
  assert.equal(agreed(parseForm(`### 设计包 / Design pack\n\n${AG.map((x) => `- [x] ${x}`).join('\n')}`)), false)
  // 下载一键投稿的 zip：每一跳都得是同一个仓库、同一个提交、同一个文件
  const want = repoZipParts(own)
  assert.deepEqual(want, { owner: 'alice-1', repo: 'dsh-design-gallery', sha, file: 'submission.zip' })
  const ok = sameRepoZip(want)
  assert.equal(ok(own), true)
  assert.equal(ok(`https://raw.githubusercontent.com/alice-1/dsh-design-gallery/${sha}/submission.zip`), true)
  assert.equal(ok(`https://github.com/bob/dsh-design-gallery/raw/${sha}/submission.zip`), false) // 仓库转给别人后的跳转
  assert.equal(ok(`https://raw.githubusercontent.com/bob/dsh-design-gallery/${sha}/submission.zip`), false)
  assert.equal(ok(`https://raw.githubusercontent.com/alice-1/dsh-design-gallery/${'d'.repeat(40)}/submission.zip`), false)
  assert.equal(ok(`https://raw.githubusercontent.com/alice-1/dsh-design-gallery/${sha}/other.zip`), false)
  assert.equal(ok(`https://raw.githubusercontent.com/alice-1/dsh-design-gallery/${sha}/submission.zip?x=1`), false)
  const moved = { [own]: { status: 301, location: `https://github.com/bob/dsh-design-gallery/raw/${sha}/submission.zip` } }
  const fk = async (u) => { const h = moved[u]; return { status: h ? h.status : 200, headers: { get: (k) => (k === 'location' && h ? h.location : null) }, body: [Buffer.from('PK')] } }
  await assert.rejects(download(own, { fetcher: fk, allow: ok }), /不下载/)
  const fine = { [own]: { status: 302, location: `https://raw.githubusercontent.com/Alice-1/dsh-design-gallery/${sha}/submission.zip` } }
  const fk2 = async (u) => { const h = fine[u]; return { status: h ? h.status : 200, headers: { get: (k) => (k === 'location' && h ? h.location : null) }, body: [Buffer.from('PK')] } }
  assert.equal((await download(own, { fetcher: fk2, allow: ok })).toString(), 'PK')
  // 跳到别处的不下载
  const hops = { 'https://github.com/user-attachments/files/1/a.zip': { status: 302, location: 'https://evil.example/a.zip' } }
  const fake = async (u) => { const h = hops[u]; return { status: h ? h.status : 404, headers: new Map(Object.entries({ location: h && h.location })), body: [] } }
  fake.headersGet = true
  await assert.rejects(download('https://github.com/user-attachments/files/1/a.zip', { fetcher: async (u, o) => { const r = await fake(u, o); return { ...r, headers: { get: (k) => r.headers.get(k) } } } }), /不下载/)
})

test('收稿：修好、改作者、去照片信息、查规则', () => {
  const vocab = loadVocab(FAKE)
  const files = Object.entries({ ...goodFiles({ author: { login: 'someone-else', id: 1, name: '小A' }, from: { zip: 'x' }, shareToken: 'abc', shareHash: 'cd'.repeat(16) }) }).map(([p, v]) => ({ path: p, data: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) }))
  files[1] = { path: 'home.html', data: Buffer.from(screen('首页', 'app', '<!-- 注释 --><a href="https://x.example">x</a>')) }
  const p = prepare(files, { login: 'Alice-1', id: 42, license: 'CC-BY-4.0', slug: 'matcha-time', vocab })
  assert.equal(p.ok, true, JSON.stringify(p.errors))
  assert.equal(p.dir, 'templates/alice-1__matcha-time')
  const m = JSON.parse(p.files.find((f) => f.path === 'design.json').data)
  assert.deepEqual(m.author, { login: 'Alice-1', id: 42, name: '小A' })
  assert.equal(m.license, 'CC-BY-4.0')
  assert.equal(m.from, undefined)
  assert.equal(m.shareToken, undefined)
  assert.equal(m.shareHash, 'cd'.repeat(16)) // 记号留着（只是哈希，不是 token）
  const badHash = prepare(Object.entries(goodFiles({ shareHash: 'NOT-A-HASH' })).map(([n, v]) => ({ path: n, data: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) })), { login: 'Alice-1', id: 42, slug: 'x-hash', vocab })
  assert.equal(badHash.ok, false)
  assert.ok(p.changes.some((c) => /home\.html/.test(c) && /注释/.test(c)))
  // JPEG 去 EXIF
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe1, 0x00, 0x08]), Buffer.from('Exif\0\0'), Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]), Buffer.from([0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9])])
  const s = stripJpeg(jpg)
  assert.ok(s && !s.includes(Buffer.from('Exif')))
  assert.equal(s[0], 0xff)
  // PNG 去文字块
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); data.copy(b, 8); return b }
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('tEXt', Buffer.from('GPS\0secret')), chunk('IEND', Buffer.alloc(0))])
  const sp = stripPng(png)
  assert.ok(sp && !sp.includes(Buffer.from('secret')))
})

test('收稿第二步：不信第一步的产物', () => {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-art-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-root-'))
  fs.cpSync(path.join(REAL, 'vocab'), path.join(root, 'vocab'), { recursive: true })
  const write = (dir, files) => { for (const [n, v] of Object.entries(files)) { const p = path.join(art, 'files', dir, n); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)) } }
  // 产物说的目录不是 issue 作者的
  fs.writeFileSync(path.join(art, 'intake.json'), JSON.stringify({ ok: true, dir: 'templates/victim__x-design' }))
  write('templates/victim__x-design', goodFiles({ author: { login: 'victim', id: 3 } }))
  const r1 = apply(art, { login: 'alice-1', id: 42, issue: 7, root })
  assert.equal(r1.ok, false)
  // 目录对，但作者 id 被改了
  fs.writeFileSync(path.join(art, 'intake.json'), JSON.stringify({ ok: true, dir: 'templates/alice-1__matcha', changes: ['home.html：删掉注释'] }))
  write('templates/alice-1__matcha', goodFiles({ author: { login: 'alice-1', id: 999 } }))
  assert.equal(apply(art, { login: 'alice-1', id: 42, issue: 7, root }).ok, false)
  // 都对：放进工作区，回复里列出自动修的
  write('templates/alice-1__matcha', goodFiles({ author: { login: 'alice-1', id: 42 }, shareHash: 'ef'.repeat(16) }))
  const r3 = apply(art, { login: 'Alice-1', id: 42, issue: 7, root })
  assert.equal(r3.ok, true, r3.reply)
  assert.equal(r3.branch, 'submission/7')
  assert.ok(fs.existsSync(path.join(root, 'templates/alice-1__matcha/home.html')))
  assert.match(r3.reply, /删掉注释/)
  assert.match(r3.reply, /投稿记号 \/ Ref: `efefefefefef`/)
  // 产物里的说明文字不能 @ 人、不能塞 HTML
  fs.writeFileSync(path.join(art, 'intake.json'), JSON.stringify({ ok: false, errors: [{ msg: '@everyone <img src=x onerror=1>' }] }))
  const r4 = apply(art, { login: 'alice-1', id: 42, issue: 7, root })
  assert.ok(!/@everyone/.test(r4.reply) && !/<img/.test(r4.reply))
})

test('闸门：严格读结果、车道、挂起、审核卡', () => {
  const raw = JSON.stringify({
    lane: '', guard: [], deleted: ['templates/x__y', '../../etc'],
    entries: [{ id: 'alice-1__mint', dir: 'styles/alice-1__mint', type: 'style', ok: true, errors: [], flags: [], shots: ['shots/alice-1__mint/a.jpg', '../../x.jpg', 'https://evil/x.jpg'], extra: 'x' }],
  })
  const res = readResults(raw)
  assert.deepEqual(res.deleted, ['templates/x__y'])
  assert.deepEqual(res.entries[0].shots, ['shots/alice-1__mint/a.jpg'])
  assert.equal(readResults('not json'), null)
  const now = Date.parse('2026-11-06T00:00:00Z')
  const old = '2024-01-01T00:00:00Z'
  const a = decide(res, { login: 'alice-1', createdAt: old, now })
  assert.equal(a.lane, 'A')
  assert.equal(a.conclusion === 'success', true)
  assert.equal(a.conclusion, 'success')
  const fresh = decide(res, { login: 'alice-1', createdAt: '2026-11-03T00:00:00Z', now })
  assert.equal(fresh.held, 'author')
  assert.equal(fresh.conclusion === 'success', false)
  assert.ok(fresh.labels.includes('held: author'))
  assert.match(fresh.comment, /账号太新/)
  assert.match(fresh.comment, /现在 3 天/)
  assert.match(fresh.comment, /满 7 天就接着往下走/)
  const tpl = readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: true, errors: [], flags: [{ code: 'password', msg: '有密码框', msgEn: 'password' }], shots: ['shots/alice-1__matcha/home.jpg'] }] }))
  const b = decide(tpl, { login: 'alice-1', createdAt: old, shotsBase: 'https://raw.githubusercontent.com/o/r/review-shots/3/9', now })
  assert.equal(b.lane, 'B')
  assert.equal(b.conclusion, 'neutral')
  assert.ok(b.labels.includes('flag: password'))
  assert.match(b.comment, /<!-- dsh-gallery-gate -->/)
  assert.match(b.comment, /review-shots\/3\/9\/shots\/alice-1__matcha\/home\.jpg/)
  assert.match(b.comment, /\/approve <完整提交号>/)
  // 知道是哪个提交：卡上直接给出整行 /approve <40 位>，照抄就行
  const H = 'c'.repeat(40)
  assert.ok(decide(tpl, { login: 'alice-1', createdAt: old, now, sha: H }).comment.includes(`/approve ${H}`))
  // 别人交的、过了检查：单独 @ 维护者（A 车道也要人看：机器人不合并）；自己交的、挂起的、没过的都不 @
  assert.match(decide(tpl, { login: 'alice-1', createdAt: old, owner: 'OrderG-X', now }).ping, /^<!-- dsh-gallery-ping -->\n@OrderG-X /)
  assert.equal(decide(tpl, { login: 'orderg-x', createdAt: old, owner: 'OrderG-X', now }).ping, '')
  assert.match(decide(res, { login: 'alice-1', createdAt: old, owner: 'OrderG-X', now }).ping, /^<!-- dsh-gallery-ping -->\n@OrderG-X .*（车道 A）/)
  assert.equal(decide(tpl, { login: 'alice-1', createdAt: '2026-11-03T00:00:00Z', owner: 'OrderG-X', now }).ping, '')
  assert.equal(decide(tpl, { login: 'alice-1', createdAt: old, owner: '', now }).ping, '')
  assert.equal(decide(readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: false, errors: [{ code: 'x', msg: 'x' }], flags: [], shots: [] }] })), { login: 'alice-1', createdAt: old, owner: 'OrderG-X', now }).ping, '')
  // 维护者挂起着（held: maintainer）：检查都过了也不说「自动合并」、不自动合、不 @；卡上照实写、给 /approve 命令；没过的照旧是失败
  const mh = decide(res, { login: 'alice-1', createdAt: old, owner: 'OrderG-X', sha: H, maintHeld: true, now })
  // 记下算的时候挂没挂起（post 写之前再比）
  assert.equal(mh.maintHeld, true)
  assert.equal(a.maintHeld, false)
  assert.equal(mh.conclusion === 'success', false)
  assert.equal(mh.conclusion, 'neutral')
  assert.equal(mh.ping, '')
  assert.match(mh.comment, /维护者挂起着/)
  assert.ok(!/自动合并/.test(mh.comment.split('\n').slice(0, 3).join('\n')), mh.comment)
  assert.ok(mh.comment.includes(`/approve ${H}`))
  assert.equal(decide(tpl, { login: 'alice-1', createdAt: old, owner: 'OrderG-X', maintHeld: true, now }).ping, '')
  const mhBad = decide(readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: false, errors: [{ code: 'x', msg: 'x' }], flags: [], shots: [] }] })), { login: 'alice-1', createdAt: old, maintHeld: true, now })
  assert.equal(mhBad.conclusion, 'failure')
  assert.ok(!/维护者挂起着/.test(mhBad.comment))
  // 被关过又重开了（拒稿的标签可能没打上）：A 车道也不自动合并，卡上照实写、给 /approve、@ 维护者；没过的照旧是失败
  const ro = decide(res, { login: 'alice-1', createdAt: old, owner: 'OrderG-X', sha: H, reopened: true, now })
  assert.equal(ro.lane, 'A')
  assert.equal(ro.conclusion === 'success', false)
  assert.equal(ro.conclusion, 'neutral')
  assert.match(ro.comment, /被关过又重开了/)
  assert.ok(!/自动合并/.test(ro.comment.split('\n').slice(0, 3).join('\n')), ro.comment)
  assert.ok(ro.comment.includes(`/approve ${H}`))
  assert.match(ro.ping, /^<!-- dsh-gallery-ping -->\n@OrderG-X .*被关过又重开了/)
  assert.equal(decide(res, { login: 'orderg-x', createdAt: old, owner: 'OrderG-X', reopened: true, now }).ping, '')
  assert.equal(decide(res, { login: 'alice-1', createdAt: old, owner: 'OrderG-X', reopened: true, maintHeld: true, now }).ping, '')
  const roBad = decide(readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: false, errors: [{ code: 'x', msg: 'x' }], flags: [], shots: [] }] })), { login: 'alice-1', createdAt: old, reopened: true, now })
  assert.equal(roBad.conclusion, 'failure')
  assert.ok(!/被关过又重开了/.test(roBad.comment))
  const bad = decide(readResults(JSON.stringify({ guard: [{ code: 'protected', msg: '改了 scripts' }], lane: 'C', entries: [] })), { createdAt: old, now })
  assert.equal(bad.conclusion, 'failure')
  assert.equal(bad.lane, 'C')
})

test('守卫：改了的文件必须真的取到了；删整套也要是原作者、一律等维护者', () => {
  putEntry('styles/alice__mine', { 'style.json': '{}' })
  // 改动列表里有、工作区里没有（被 .gitattributes 藏了 / 是软链接）→ 拒
  const hid = guard(parseChanged('A\tstyles/alice__mine/style.json\nA\tstyles/alice__mine/payload.html\nA\tstyles/alice__mine/.gitattributes'), { login: 'alice', id: 222 })
  assert.deepEqual(hid.errors.filter((e) => e.code === 'missing').map((e) => e.x).sort(), ['styles/alice__mine/.gitattributes', 'styles/alice__mine/payload.html'])
  fs.symlinkSync('/etc/hosts', path.join(FAKE, 'styles/alice__mine/link.css'))
  assert.ok(guard(parseChanged('A\tstyles/alice__mine/link.css'), { login: 'alice', id: 222 }).errors.some((e) => e.code === 'missing'))
  fs.rmSync(path.join(FAKE, 'styles/alice__mine/link.css'))
  // 同名新账号（222）删掉 main 上属于 111 的整套，顺手加一套自己的
  const ch = parseChanged('D\tstyles/alice__victim/style.json\nD\tstyles/alice__victim/design.json\nA\tstyles/alice__mine/style.json')
  const steal = guard(ch, { login: 'alice', id: 222, prevAuthor: () => 111 })
  assert.equal(steal.lane, 'C')
  assert.ok(steal.errors.some((e) => e.code === 'ownerId' && e.x === 'styles/alice__victim'))
  const own = guard(ch, { login: 'alice', id: 111, prevAuthor: () => 111 })
  assert.equal(own.lane, 'C')
  assert.ok(!own.errors.some((e) => e.code === 'ownerId'))
  assert.equal(guard(ch, { maintainer: true, prevAuthor: () => 111 }).lane, '')
  fs.rmSync(path.join(FAKE, 'styles/alice__mine'), { recursive: true })
})

test('取 PR 文件：按 git 树取，不听 .gitattributes，软链接不取', () => {
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-git-'))
  const run = (...a) => execFileSync('git', ['-C', g, ...a], { encoding: 'utf8' })
  run('init', '-q')
  const d = path.join(g, 'styles/bob__mint')
  fs.mkdirSync(path.join(d, 'img'), { recursive: true })
  fs.writeFileSync(path.join(d, 'style.json'), '{}')
  fs.writeFileSync(path.join(d, 'payload.html'), '<script>alert(1)</script>')
  fs.writeFileSync(path.join(d, 'img/a.svg'), '<svg/>')
  fs.writeFileSync(path.join(d, '.gitattributes'), '.gitattributes export-ignore\npayload.html export-ignore\n')
  fs.symlinkSync('/etc/hosts', path.join(d, 'evil.css'))
  run('add', '-A')
  run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x')
  const sha = run('rev-parse', 'HEAD').trim()
  // git archive 真的会藏（证明这条测试有意义）
  assert.ok(!run('archive', '--format=tar', sha, 'styles/bob__mint').includes('payload.html'))
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-out-'))
  const skipped = extract(g, sha, out, ['styles/bob__mint'])
  for (const f of ['style.json', 'payload.html', 'img/a.svg', '.gitattributes']) assert.ok(fs.existsSync(path.join(out, 'styles/bob__mint', f)), f)
  assert.ok(!fs.existsSync(path.join(out, 'styles/bob__mint/evil.css')))
  assert.deepEqual(skipped, ['mode\tstyles/bob__mint/evil.css'])
  assert.deepEqual(parseTree('100644 blob abc 12\ta/b c\0'), [{ mode: '100644', type: 'blob', oid: 'abc', size: 12, path: 'a/b c' }])
  assert.equal(safeEntry({ type: 'blob', mode: '100644', size: 1, path: 'x/../y' }, 'x'), 'path')
  assert.equal(safeEntry({ type: 'commit', mode: '160000', size: -1, path: 'x/sub' }, 'x'), 'mode')
})

test('归属：已有的目录，数字 ID 要和 main 上原来的作者一样', async () => {
  putEntry('templates/alice-1__matcha', goodFiles())
  const vocab = loadVocab(FAKE)
  const same = await checkEntry('templates/alice-1__matcha', { vocab, login: 'alice-1', id: 42, render: false, prevAuthor: () => 42 })
  assert.equal(same.ok, true, JSON.stringify(same.errors))
  // 同名新账号（111 → 222）：design.json 写的是新 id，main 上原来是 111
  putEntry('templates/alice-1__matcha', goodFiles({ author: { login: 'Alice-1', id: 222 } }))
  const taken = await checkEntry('templates/alice-1__matcha', { vocab, login: 'alice-1', id: 222, render: false, prevAuthor: () => 111 })
  assert.equal(taken.ok, false)
  assert.ok(taken.errors.some((e) => e.code === 'ownerId'))
  const fresh = await checkEntry('templates/alice-1__matcha', { vocab, login: 'alice-1', id: 222, render: false, prevAuthor: () => 0 })
  assert.ok(!fresh.errors.some((e) => e.code === 'ownerId'))
  const maint = await checkEntry('templates/alice-1__matcha', { vocab, maintainer: true, render: false, prevAuthor: () => 111 })
  assert.ok(!maint.errors.some((e) => e.code === 'ownerId'))
  putEntry('templates/alice-1__matcha', goodFiles())
  // 收稿第二步也查：仓库里已有的这套属于别的数字 ID → 不收、不覆盖
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-art-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-root-'))
  fs.cpSync(path.join(REAL, 'vocab'), path.join(root, 'vocab'), { recursive: true })
  const dest = path.join(root, 'templates/alice-1__matcha')
  fs.mkdirSync(dest, { recursive: true })
  fs.writeFileSync(path.join(dest, 'design.json'), JSON.stringify(manifest({ author: { login: 'alice-1', id: 111 } })))
  fs.writeFileSync(path.join(art, 'intake.json'), JSON.stringify({ ok: true, dir: 'templates/alice-1__matcha' }))
  for (const [n, v] of Object.entries(goodFiles({ author: { login: 'alice-1', id: 222 } }))) { const f = path.join(art, 'files/templates/alice-1__matcha', n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)) }
  const r = apply(art, { login: 'alice-1', id: 222, issue: 9, root })
  assert.equal(r.ok, false)
  assert.match(r.reply, /另一个 GitHub 账号/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'design.json'), 'utf8')).author.id, 111)
  assert.ok(!fs.existsSync(path.join(dest, 'home.html')))
})

test('闸门：PR 改得了的产物只能多报问题，不能把没过的变成过', () => {
  const trusted = readResults(JSON.stringify({ lane: 'C', guard: [{ code: 'protected', msg: '改了 scripts' }], entries: [{ id: 'alice-1__matcha', type: 'template', ok: false, errors: [{ code: 'owner', msg: '作者不对' }], flags: [{ code: 'password', msg: '有密码框' }], shots: [] }] }))
  const forged = readResults(JSON.stringify({ lane: '', guard: [], entries: [{ id: 'alice-1__matcha', type: 'style', ok: true, errors: [], flags: [], shots: ['shots/alice-1__matcha/home.jpg'] }, { id: 'zed__extra', type: 'style', ok: true, errors: [], flags: [], shots: [] }] }))
  const m = mergeResults(trusted, forged)
  assert.equal(m.lane, 'C')
  assert.equal(m.guard.length, 1)
  assert.equal(m.entries.length, 1)
  assert.equal(m.entries[0].ok, false)
  assert.equal(m.entries[0].type, 'template')
  assert.ok(m.entries[0].errors.some((e) => e.code === 'owner'))
  assert.ok(m.entries[0].flags.some((e) => e.code === 'password'))
  assert.deepEqual(m.entries[0].shots, ['shots/alice-1__matcha/home.jpg'])
  const now = Date.parse('2026-11-06T00:00:00Z')
  assert.equal(decide(m, { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', now }).conclusion === 'success', false)
  // 可信侧过了、产物报渲染问题：不过
  const tOk = readResults(JSON.stringify({ lane: 'A', guard: [], entries: [{ id: 'alice-1__mint', type: 'style', ok: true, errors: [], flags: [], shots: [] }] }))
  const aBad = readResults(JSON.stringify({ lane: 'A', guard: [], entries: [{ id: 'alice-1__mint', type: 'style', ok: false, errors: [{ code: 'hard', msg: '底部被挡' }], flags: [], shots: [] }] }))
  assert.equal(mergeResults(tOk, aBad).entries[0].ok, false)
  // 产物里少了这套（PR 删掉了渲染步骤）：不过
  const gone = mergeResults(tOk, readResults(JSON.stringify({ lane: 'A', guard: [], entries: [] })))
  assert.equal(gone.entries[0].ok, false)
  assert.ok(gone.entries[0].errors.some((e) => e.code === 'noRender'))
  assert.equal(mergeResults(null, aBad), null)
})

test('发布：截图从无权限 job 的产物来，只收真图、不超大小，图的哈希进目录', async () => {
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-shots-'))
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20, 2)])
  const d = path.join(shots, 'alice-1__matcha')
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'thumb.webp'), webp)
  fs.writeFileSync(path.join(d, 'home.jpg'), jpg)
  fs.writeFileSync(path.join(d, 'menu.jpg'), Buffer.from('<svg onload=alert(1)>')) // 不是 JPEG
  fs.writeFileSync(path.join(d, 'extra.jpg'), jpg) // 目录里没有这屏
  fs.writeFileSync(path.join(d, 'check.json'), JSON.stringify({ severe: 1, warn: 'x' }))
  const r = readShots(shots, 'alice-1__matcha', ['home.html', 'menu.html'])
  assert.ok(r.thumb && r.thumb.equals(webp))
  assert.deepEqual(r.shots.map((x) => x.file), ['home.html'])
  assert.deepEqual(r.check, { severe: 1, warn: 0 })
  // 软链接、超大、没有的：当没截到
  const e = path.join(shots, 'bob__x')
  fs.mkdirSync(e)
  fs.symlinkSync('/etc/hosts', path.join(e, 'home.jpg'))
  fs.writeFileSync(path.join(e, 'thumb.webp'), Buffer.concat([webp, Buffer.alloc(300 * 1024)]))
  const r2 = readShots(shots, 'bob__x', ['home.html'])
  assert.equal(r2.thumb, null)
  assert.deepEqual(r2.shots, [])
  assert.deepEqual(readShots(shots, 'nobody__y', ['home.html']), { thumb: null, shots: [], check: { severe: 0, warn: 0 } })
  fs.symlinkSync(d, path.join(shots, 'carol__link'))
  assert.equal(readShots(shots, 'carol__link', ['home.html']).thumb, null)
  // 建目录：封面和截图都带 sha256 + 大小
  putEntry('templates/alice-1__matcha', goodFiles())
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
  const b = await build({ out, shotsFrom: shots, now: new Date('2026-11-06T12:00:00Z') })
  const x = b.index.designs.find((y) => y.id === 'alice-1__matcha')
  const h = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
  assert.deepEqual(x.thumb, { p: 'thumbs/alice-1__matcha.webp', sha256: h(webp), size: webp.length })
  assert.deepEqual(x.shots, [{ p: '_shots/home.jpg', sha256: h(jpg), size: jpg.length }])
  assert.deepEqual(x.check, { severe: 1, warn: 0 })
  assert.ok(fs.readFileSync(path.join(out, 'catalog', x.thumb.p)).equals(webp))
  assert.ok(fs.readFileSync(path.join(out, 'packs', x.pack.path, '_shots/home.jpg')).equals(jpg))
  assert.ok(!fs.existsSync(path.join(out, 'packs', x.pack.path, '_shots/menu.jpg')))
})

test('发布：同一提交再建一次，重截的封面字节变了也沿用旧的，目录哈希不变；内容改了照样发', async () => {
  const id = 'alice-1__steady'
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])
  const webp = (n) => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20, n)])
  const h = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
  // 每次截图 job 的产物：封面字节不一样（浏览器渲染不完全确定），体检数也可能抖
  const shotsOf = (thumb, check) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-shots-'))
    fs.mkdirSync(path.join(dir, id))
    fs.writeFileSync(path.join(dir, id, 'thumb.webp'), thumb)
    fs.writeFileSync(path.join(dir, id, 'home.jpg'), jpg)
    fs.writeFileSync(path.join(dir, id, 'check.json'), JSON.stringify(check))
    return dir
  }
  const now = new Date('2026-11-07T12:00:00Z')
  putEntry(`templates/${id}`, goodFiles({ title: { zh: '稳稳的' } }))
  try {
    const out1 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
    const b1 = await build({ out: out1, shotsFrom: shotsOf(webp(1), { severe: 0, warn: 1 }), now })
    const e1 = b1.index.designs.find((y) => y.id === id)
    assert.equal(e1.thumb.sha256, h(webp(1)))
    // 发布流程：prev.mjs 把上一版解到 prev/（index.json + thumbs/），build 的 prevDir 就是那里
    const prevDir = path.join(out1, 'catalog')
    const prev = JSON.parse(fs.readFileSync(path.join(prevDir, 'index.json'), 'utf8'))
    const out2 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
    const b2 = await build({ out: out2, prev, prevDir, shotsFrom: shotsOf(webp(2), { severe: 0, warn: 2 }), now })
    assert.equal(contentSha(b2.index), contentSha(prev)) // 「没变化就不发」拦得住
    assert.equal(b2.packed, 0)
    const e2 = b2.index.designs.find((y) => y.id === id)
    assert.deepEqual(e2.thumb, e1.thumb)
    assert.deepEqual(e2.check, e1.check)
    assert.ok(fs.readFileSync(path.join(out2, 'catalog', e2.thumb.p)).equals(webp(1)))
    // 取不到上一版的封面（或对不上）：用这次截的，目录里的哈希和文件一致
    const out3 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
    const b3 = await build({ out: out3, prev, prevDir: '', shotsFrom: shotsOf(webp(2), { severe: 0, warn: 2 }), now })
    const e3 = b3.index.designs.find((y) => y.id === id)
    assert.equal(e3.thumb.sha256, h(webp(2)))
    assert.deepEqual(e3.check, { severe: 0, warn: 2 })
    assert.ok(fs.readFileSync(path.join(out3, 'catalog', e3.thumb.p)).equals(webp(2)))
    // 内容真改了（rev 变）：新封面、新批次，目录哈希变 → 照样发
    putEntry(`templates/${id}`, goodFiles({ title: { zh: '稳稳的（改版）' } }))
    const out4 = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dist-'))
    const b4 = await build({ out: out4, prev, prevDir, shotsFrom: shotsOf(webp(3), { severe: 0, warn: 0 }), now })
    const e4 = b4.index.designs.find((y) => y.id === id)
    assert.notEqual(e4.rev, e1.rev)
    assert.equal(e4.thumb.sha256, h(webp(3)))
    assert.deepEqual(e4.check, { severe: 0, warn: 0 })
    assert.equal(b4.packed, 1)
    assert.notEqual(contentSha(b4.index), contentSha(prev))
  } finally {
    fs.rmSync(path.join(FAKE, 'templates', id), { recursive: true, force: true })
  }
})

test('维护者命令：解析、改规矩文件', () => {
  // /approve 要带完整的 40 位提交号（短号能被刻意撞上）：没带、带短的都交出空的，工作流回话让补上
  const H = 'AbCdEf0123456789abcdef0123456789ABCDEF01'
  assert.deepEqual(parseCommand(`/approve ${H}`, { isPr: true }), { action: 'merge', sha: H.toLowerCase() })
  for (const c of ['/approve', '/approve abcdef0', `/approve ${H}0`, `/approve ${H.slice(0, 39)}g`]) assert.deepEqual(parseCommand(c, { isPr: true }), { action: 'merge', sha: '' }, c)
  assert.equal(parseCommand('/approve', { isPr: false }).action, 'error')
  assert.equal(parseCommand('/hold brand', { isPr: true }).reason, 'brand')
  // /hold 只在 PR 上（合并只看 PR）：issue 上发的回话让去 PR
  assert.equal(parseCommand('/hold brand').action, 'error')
  assert.equal(parseCommand('/reject whatever').reason, 'other')
  assert.equal(parseCommand('谢谢！\n/feature alice-1__mint').id, 'alice-1__mint')
  assert.equal(parseCommand('/feature ../../x').action, 'error')
  assert.equal(parseCommand('/trust @Alice-1').login, 'alice-1')
  assert.deepEqual(parseCommand('/takedown alice-1__mint copyright'), { action: 'takedown', id: 'alice-1__mint', reason: 'copyright' })
  assert.equal(parseCommand('hello'), null)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-pol-'))
  fs.cpSync(path.join(REAL, 'policy'), path.join(root, 'policy'), { recursive: true })
  fs.writeFileSync(path.join(root, 'policy/featured.json'), '[]') // 真的精选单子有内容，这里从空的开始
  fs.writeFileSync(path.join(root, 'policy/denylist.json'), '[]') // 真的下架单子也可能有记录（比如审核流程测试那条）
  const now = new Date('2026-11-06T00:00:00Z')
  assert.equal(applyPolicy({ action: 'takedown', id: 'a__bcd', reason: 'policy' }, { root, now }), 'policy/denylist.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'policy/denylist.json'))), [{ id: 'a__bcd', at: '2026-11-06T00:00:00.000Z', reason: 'policy' }])
  const later = new Date('2026-11-06T01:00:00Z')
  assert.equal(applyPolicy({ action: 'restore', id: 'a__bcd' }, { root, now: later }), 'policy/denylist.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'policy/denylist.json'))), [{ id: 'a__bcd', at: '2026-11-06T00:00:00.000Z', reason: 'policy', restored: '2026-11-06T01:00:00.000Z' }]) // 记录留着，标上撤销
  assert.equal(applyPolicy({ action: 'restore', id: 'a__bcd' }, { root }), '')
  applyPolicy({ action: 'takedown', id: 'a__bcd', reason: 'copyright' }, { root, now: new Date('2026-11-06T02:00:00Z') })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'policy/denylist.json'))).map((d) => [d.id, d.reason, !!d.restored]), [['a__bcd', 'copyright', false]]) // 再下架：换成新的一条
  applyPolicy({ action: 'feature', id: 'a__bcd' }, { root })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'policy/featured.json'))), ['a__bcd'])
  // 信任按数字 id 记；查不到 id 的不记
  assert.equal(applyPolicy({ action: 'trust', login: 'alice-1' }, { root, now }), '')
  assert.equal(applyPolicy({ action: 'trust', login: 'alice-1', uid: 42 }, { root, now }), 'policy/trust-overrides.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'policy/trust-overrides.json')))['id:42'], { tier: 'T2', id: 42, login: 'alice-1', at: '2026-11-06T00:00:00.000Z' })
})

/** 工作流里某一步的 run: | 脚本（去掉缩进） */
function stepScript(file, name) {
  const lines = fs.readFileSync(path.join(REAL, '.github/workflows', file), 'utf8').split('\n')
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  const r = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l))
  assert.ok(at >= 0 && r > at, `${file} 里没找到「${name}」的 run`)
  const ind = lines[r].search(/\S/)
  const body = []
  for (const l of lines.slice(r + 1)) { if (l.trim() && l.search(/\S/) <= ind) break; body.push(l) }
  const cut = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)))
  return body.map((l) => l.slice(cut)).join('\n')
}
const HAS_JQ = (() => { try { execFileSync('jq', ['--version'], { stdio: 'ignore' }); return true } catch { return false } })()

test('维护者命令：下架 / 撤销不另外派发 publish（App 没有 Actions 写权限），推到 main 就靠 push 触发', () => {
  // 机器人（App token）推 policy/** 到 main → publish 的 push 触发器自己跑
  const pub = fs.readFileSync(path.join(REAL, '.github/workflows/publish.yml'), 'utf8')
  assert.match(pub, /push:\s*\n\s*branches: \[main\]\s*\n\s*paths: \[[^\]]*'policy\/\*\*'/)
  // 哪个工作流都不调 gh workflow run（App 没这个权限，403 会让后面的回复、打标签全跳过）
  for (const f of fs.readdirSync(path.join(REAL, '.github/workflows'))) {
    const code = fs.readFileSync(path.join(REAL, '.github/workflows', f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')
    assert.doesNotMatch(code, /gh workflow run/, f)
  }
  // 自动隐藏：推上去了就记 hidden=true（后面那步才会告诉举报人「已隐藏」）
  assert.match(stepScript('reports.yml', '数有效举报，够了就先隐藏'), /if git push -q origin HEAD:main; then\s*\n\s*echo "hidden=true"/)
})

test('维护者命令：/takedown 真跑「照做」那步——推上 main、回「✓ 已处理」；推不上回 ⚠', { skip: (process.platform === 'win32' || !HAS_JQ) && '要 bash + jq' }, () => {
  const script = stepScript('chatops.yml', '照做')
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-chatops-'))
  const sh = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim()
  const remote = path.join(w, 'remote.git')
  const work = path.join(w, 'work')
  sh(['init', '-q', '--bare', remote], w)
  fs.mkdirSync(path.join(work, 'policy'), { recursive: true })
  sh(['init', '-q'], work)
  fs.writeFileSync(path.join(work, 'policy/denylist.json'), '[]\n')
  sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'], work)
  sh(['add', 'policy'], work)
  sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'policy'], work)
  sh(['remote', 'add', 'origin', remote], work)
  sh(['push', '-q', 'origin', 'HEAD:main'], work)
  // 假 gh：记下调用和回复内容；gh workflow run 像真的一样 403
  const bin = path.join(w, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho "gh $*" >> "$GH_LOG"\nprev=""; for a in "$@"; do [ "$prev" = "--body-file" ] && { echo "REPLY: $(cat "$a")" >> "$GH_LOG"; }; prev="$a"; done\n[ "$1" = "workflow" ] && { echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; }\nexit 0\n', { mode: 0o755 })
  const run = () => {
    const log = path.join(w, `gh-${Date.now()}-${Math.random()}.log`)
    fs.writeFileSync(path.join(work, 'action.json'), JSON.stringify({ action: 'takedown', id: 'a__bcd', reason: 'policy', changed: 'policy/denylist.json' }))
    fs.writeFileSync(path.join(work, 'policy/denylist.json'), JSON.stringify([{ id: 'a__bcd', at: new Date().toISOString(), reason: 'policy' }]) + '\n')
    let code = 0
    try {
      execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd: work, stdio: 'pipe', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_LOG: log, GH_TOKEN: 'x', N: '3', ACTOR: 'OrderG-X', GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: path.join(w, 'out') } })
    } catch (e) { code = e.status }
    return { code, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' }
  }
  const ok = run()
  assert.equal(ok.code, 0, ok.log)
  assert.match(ok.log, /REPLY: ✓ 已处理：takedown/)
  assert.doesNotMatch(ok.log, /gh workflow/)
  assert.equal(sh(['--git-dir', remote, 'log', '-1', '--format=%s', 'main'], w), 'takedown by OrderG-X (#3)')
  // 推不上（远端没了 / main 被别人先改了）：不说「已处理」，回 ⚠ 让维护者再发一次，这一步算失败
  sh(['remote', 'set-url', 'origin', path.join(w, 'gone.git')], work)
  const bad = run()
  assert.equal(bad.code, 1, bad.log)
  assert.match(bad.log, /REPLY: ⚠ 推不上 main/)
  assert.doesNotMatch(bad.log, /已处理/)
})

test('维护者命令：第一次 /trust（信任名单文件原来没有）也推上去；/untrust 推上去以后不在这里回话，交给 confirm', { skip: (process.platform === 'win32' || !HAS_JQ) && '要 bash + jq' }, () => {
  const script = stepScript('chatops.yml', '照做')
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-trust-push-'))
  const sh = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim()
  const remote = path.join(w, 'remote.git')
  const work = path.join(w, 'work')
  sh(['init', '-q', '--bare', remote], w)
  fs.mkdirSync(path.join(work, 'policy'), { recursive: true })
  sh(['init', '-q'], work)
  fs.writeFileSync(path.join(work, 'policy/strikes.json'), '[]\n')
  sh(['add', 'policy'], work)
  sh(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], work)
  sh(['remote', 'add', 'origin', remote], work)
  sh(['push', '-q', 'origin', 'HEAD:main'], work)
  const bin = path.join(w, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho "gh $*" >> "$GH_LOG"\nprev=""; for a in "$@"; do [ "$prev" = "--body-file" ] && { echo "REPLY: $(cat "$a")" >> "$GH_LOG"; }; prev="$a"; done\nexit 0\n', { mode: 0o755 })
  const run = (action) => {
    const log = path.join(w, `gh-${Math.random()}.log`)
    const out = path.join(w, `out-${Math.random()}`)
    fs.writeFileSync(out, '')
    fs.writeFileSync(path.join(work, 'action.json'), JSON.stringify(action))
    let code = 0
    try {
      execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], { cwd: work, stdio: 'pipe', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_LOG: log, GH_TOKEN: 'x', N: '3', ACTOR: 'OrderG-X', GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: out } })
    } catch (e) { code = e.status }
    return { code, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', out: fs.readFileSync(out, 'utf8') }
  }
  // 第一次 /trust：文件是新的（没被 git 管）
  fs.writeFileSync(path.join(work, 'policy/trust-overrides.json'), JSON.stringify({ 'id:42': { tier: 'T2', id: 42, login: 'alice', at: '2026-11-12T00:00:00Z' } }) + '\n')
  const t = run({ action: 'trust', login: 'alice', uid: 42, changed: 'policy/trust-overrides.json' })
  assert.equal(t.code, 0, t.log)
  assert.match(t.log, /REPLY: ✓ 已处理：trust/)
  assert.equal(sh(['--git-dir', remote, 'log', '-1', '--format=%s', 'main'], w), 'trust by OrderG-X (#3)')
  assert.match(sh(['--git-dir', remote, 'show', 'main:policy/trust-overrides.json'], w), /"id:42"/)
  // 没变：说没有要改的
  const same = run({ action: 'trust', login: 'alice', uid: 42, changed: 'policy/trust-overrides.json' })
  assert.match(same.log, /REPLY: 没有要改的/)
  // /untrust：推上去，不回话，交给 confirm
  fs.writeFileSync(path.join(work, 'policy/trust-overrides.json'), JSON.stringify({ 'id:42': { tier: 'T0', id: 42, login: 'alice', at: '2026-11-12T01:00:00Z' } }) + '\n')
  const u = run({ action: 'untrust', login: 'alice', uid: 42, changed: 'policy/trust-overrides.json' })
  assert.equal(u.code, 0, u.log)
  assert.doesNotMatch(u.log, /REPLY/)
  assert.equal(sh(['--git-dir', remote, 'log', '-1', '--format=%s', 'main'], w), 'untrust by OrderG-X (#3)')
  assert.match(u.out, /^action=untrust$/m)
  assert.match(u.out, /"uid":42/)
})

test('治理：违规两次不收、手动信任按 id、待审和每天上限、模板更新也给人看', () => {
  const strikes = [{ login: 'alice-1', id: 42, why: 'x' }, { login: 'Alice-1', id: 42, why: 'y' }, { login: 'alice-1', id: 999, why: 'old owner of the name' }, { login: 'bob', why: 'no id' }]
  assert.deepEqual(standing({ login: 'Alice-1', id: 42, strikes }), { strikes: 2, override: '' })
  assert.equal(standing({ login: 'alice-1', id: 7, strikes }).strikes, 0) // 同名新账号不背别人的记录
  assert.equal(standing({ login: 'bob', id: 5, strikes }).strikes, 1)
  const overrides = { 'alice-1': { tier: 'T2', id: 42 }, bob: 'T2', carol: { tier: 'T2', id: 9 } }
  assert.equal(standing({ login: 'alice-1', id: 42, overrides }).override, 'T2')
  assert.equal(standing({ login: 'bob', id: 5, overrides }).override, '') // 老格式（没 id）不认
  assert.equal(standing({ login: 'carol', id: 10, overrides }).override, '') // id 对不上不认
  const now = Date.parse('2026-11-06T00:00:00Z')
  const old = '2024-01-01T00:00:00Z'
  const style = readResults(JSON.stringify({ entries: [{ id: 'alice-1__mint', type: 'style', ok: true, errors: [], flags: [], shots: [] }] }))
  const blocked = decide(style, { login: 'alice-1', createdAt: old, strikes: 2, now })
  assert.equal(blocked.conclusion, 'failure')
  assert.equal(blocked.conclusion === 'success', false)
  assert.ok(blocked.labels.includes('blocked: strikes'))
  assert.match(blocked.comment, /不再收稿/)
  const limit = decide(style, { login: 'alice-1', createdAt: old, pending: 4, now })
  assert.equal(limit.held, 'limit')
  assert.equal(limit.conclusion === 'success', false)
  assert.ok(limit.labels.includes('held: limit'))
  // 排队卡只讲数量，不提账号年龄（之前误写了「满 7 天后会自动重查」）
  assert.match(limit.comment, /一次交太多了/)
  assert.match(limit.comment, /在等 4 个/)
  assert.doesNotMatch(limit.comment, /7 天|7 days/)
  assert.equal(decide(style, { login: 'alice-1', createdAt: old, today: 4, now }).held, 'limit')
  assert.equal(decide(style, { login: 'alice-1', createdAt: old, pending: 3, today: 3, now }).conclusion === 'success', true)
  // /trust 过的新账号不挂起；/untrust（T0）的风格卡也不自动合并
  assert.equal(decide(style, { login: 'alice-1', createdAt: '2026-11-05T00:00:00Z', override: 'T2', now }).held, '')
  assert.equal(decide(style, { login: 'alice-1', createdAt: old, override: 'T0', now }).lane, 'B')
  // 模板、设计系统：老作者（T2）更新自己已上架的也不自动合并（一律给人看）
  const upd = (over = {}) => readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: true, errors: [], flags: [], shots: [], update: true, ...over }] }))
  assert.equal(decide(upd(), { login: 'alice-1', createdAt: old, priorMerged: 1, now }).conclusion === 'success', false)
  assert.equal(decide(upd(), { login: 'alice-1', createdAt: old, priorMerged: 1, now }).lane, 'B')
  assert.equal(decide(upd({ type: 'system' }), { login: 'alice-1', createdAt: old, override: 'T2', now }).conclusion === 'success', false)
  assert.equal(decide(upd({ update: false }), { login: 'alice-1', createdAt: old, priorMerged: 1, now }).lane, 'B')
  assert.equal(decide(upd({ flags: [{ code: 'password', msg: 'x' }] }), { login: 'alice-1', createdAt: old, priorMerged: 1, now }).lane, 'B')
  assert.equal(decide(upd(), { login: 'alice-1', createdAt: old, priorMerged: 0, now }).lane, 'B')
  // 可信侧算出「更新」，产物说了不算
  const merged = mergeResults(readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: true, errors: [], flags: [], shots: [] }] })), upd())
  assert.equal(merged.entries[0].update, false)
})

test('收稿第二步：违规两次的账号不收', () => {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-art-'))
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-root-'))
  fs.cpSync(path.join(REAL, 'vocab'), path.join(root, 'vocab'), { recursive: true })
  fs.mkdirSync(path.join(root, 'policy'))
  fs.writeFileSync(path.join(root, 'policy/strikes.json'), JSON.stringify([{ login: 'alice-1', id: 42 }, { login: 'alice-1', id: 42 }]))
  fs.writeFileSync(path.join(art, 'intake.json'), JSON.stringify({ ok: true, dir: 'templates/alice-1__matcha' }))
  const r = apply(art, { login: 'alice-1', id: 42, issue: 3, root })
  assert.equal(r.ok, false)
  assert.match(r.reply, /不再收稿/)
})

test('举报：三个满 30 天的不同账号举报仿冒 / 色情才先隐藏', () => {
  const body = (id, kind) => `### 设计 id / Design id\n\n${id}\n\n### 问题 / Problem\n\n${kind}\n\n### 说明 / Details\n\n_No response_`
  const PH = '仿冒真实网站或机构 / Imitates a real site or organization'
  assert.deepEqual(parseReport(body('Eve__Bank', PH)), { id: 'eve__bank', kind: 'phish' })
  assert.equal(parseReport(body('../x', PH)), null)
  assert.equal(parseReport(body('eve__bank', '侵犯我的版权 / Infringes my copyright')).kind, 'copyright')
  const now = Date.parse('2026-11-06T00:00:00Z')
  const old = '2025-01-01T00:00:00Z'
  const it = (login, id, b = body('eve__bank', PH), extra = {}) => ({ user: { login, id, type: 'User' }, body: b, ...extra })
  // 年龄按数字 id 记（工作流按 id 查）
  const ages = { 1: old, 2: old, 3: old, 4: '2026-11-01T00:00:00Z', 5: old }
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('c', 3)], { id: 'eve__bank', ages, now }).hide, true)
  assert.equal(shouldHide([it('a', 1), it('a', 1), it('b', 2)], { id: 'eve__bank', ages, now }).hide, false) // 同一个人举报两次算一个
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('d', 4)], { id: 'eve__bank', ages, now }).hide, false) // 新账号不算
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('eve', 5)], { id: 'eve__bank', ages, now }).hide, false) // 作者自己不算
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('c', 3, body('eve__bank', '其他 / Other'))], { id: 'eve__bank', ages, now }).hide, false) // 别的类别不自动
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('c', 3, body('eve__shop', PH))], { id: 'eve__bank', ages, now }).hide, false) // 别的设计
  assert.equal(shouldHide([it('a', 1), it('b', 2), { user: { login: 'bot', id: 6, type: 'Bot' }, body: body('eve__bank', PH) }], { id: 'eve__bank', ages: { ...ages, 6: old }, now }).hide, false)
  // 按名字记的年龄不算（改了名、旧名被别人占了：名字对得上也不是这个人）
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('c', 3)], { id: 'eve__bank', ages: { a: old, b: old, c: old }, now }).hide, false)
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('c', 3)], { id: 'eve__bank', ages: { 1: old, 2: old, 3: '2026-11-01T00:00:00Z', c: old }, now }).hide, false)
  assert.deepEqual(shouldHide([it('a', 1), it('b', 2), it('c', 3)], { id: 'eve__bank', ages, now }).reporters, ['a', 'b', 'c'])
  // 撤销下架之后：之前的旧举报不再算；维护者关掉的不算
  const at = (t) => ({ created_at: t, state: 'open' })
  const before = [it('a', 1, undefined, at('2026-11-01T00:00:00Z')), it('b', 2, undefined, at('2026-11-01T00:00:00Z')), it('c', 3, undefined, at('2026-11-01T00:00:00Z'))]
  const since = restoredSince([{ id: 'eve__bank', reason: 'reported', restored: '2026-11-03T00:00:00Z' }, { id: 'x__y', restored: '2026-11-05T00:00:00Z' }], 'eve__bank')
  assert.equal(since, '2026-11-03T00:00:00Z')
  assert.equal(shouldHide([...before, it('d', 4, undefined, at('2026-11-04T00:00:00Z'))], { id: 'eve__bank', ages, now, since }).hide, false)
  assert.equal(shouldHide(before.map((x) => ({ ...x, state: 'closed' })), { id: 'eve__bank', ages, now }).hide, false)
  // 按时间比：/restore 记的是带毫秒的（…00.000Z），同一秒的举报（…00Z）算之前，不再算；之后一秒的算；时间读不出来的不算
  const ms = '2026-11-03T00:00:00.000Z'
  const sameSec = it('a', 1, undefined, at('2026-11-03T00:00:00Z'))
  const after = [it('b', 2, undefined, at('2026-11-03T00:00:01Z')), it('c', 3, undefined, at('2026-11-04T00:00:00Z'))]
  assert.equal(shouldHide([sameSec, ...after], { id: 'eve__bank', ages, now, since: ms }).hide, false)
  assert.equal(shouldHide([it('a', 1, undefined, at('2026-11-03T00:00:00.001Z')), ...after], { id: 'eve__bank', ages, now, since: ms }).hide, true)
  assert.equal(shouldHide([it('a', 1, undefined, at('garbage')), ...after], { id: 'eve__bank', ages, now, since: ms }).hide, false)
  // 要查年龄的只是有效举报人，按数字 id 去重（改名的同一个人不算两个）
  assert.deepEqual(candidates([it('a', 1), it('a-new', 1), it('b', 2), it('eve', 5), it('z', 9, body('eve__bank', '其他 / Other'))], { id: 'eve__bank' }), [{ id: 1, login: 'a' }, { id: 2, login: 'b' }])
  // 作者按数字 id 认（知道 id 时）：作者改了名再举报不算；接手了旧名 eve 的别人照算
  const ages2 = { ...ages, 77: old }
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('eve-new', 5)], { id: 'eve__bank', ages: ages2, now, authorId: 5 }).hide, false)
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('eve', 77)], { id: 'eve__bank', ages: ages2, now, authorId: 5 }).hide, true)
  // 不知道 id（读不到 design.json）：退回按用户名认
  assert.equal(shouldHide([it('a', 1), it('b', 2), it('eve', 77)], { id: 'eve__bank', ages: ages2, now }).hide, false)
  // design.json 里的 author.id：三种类型的目录都找；没有、读不出来、不是正整数给 0
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-author-'))
  const put = (dir, id, author) => { fs.mkdirSync(path.join(root, dir, id), { recursive: true }); fs.writeFileSync(path.join(root, dir, id, 'design.json'), typeof author === 'string' ? author : JSON.stringify({ author })) }
  put('styles', 'eve__bank', { login: 'eve', id: 5 })
  put('templates', 'x__one', { login: 'x', id: 6 })
  put('systems', 'y__two', { login: 'y', id: '7' })
  put('styles', 'z__bad', '{')
  assert.equal(designAuthorId('eve__bank', root), 5)
  assert.equal(designAuthorId('x__one', root), 6)
  for (const id of ['y__two', 'z__bad', 'none__here', '../x']) assert.equal(designAuthorId(id, root), 0, id)
})

test('闸门：限额按数字 ID 算（改了名也算同一人），机器人代投也算', () => {
  const pr = (number, user, extra = {}) => ({ number, user, state: 'open', created_at: '2026-11-06T10:00:00Z', body: '', ...extra })
  const bot = 'dsh-gallery[bot]'
  const pulls = [
    pr(1, { login: 'alice', id: 7 }),
    pr(2, { login: 'alice-renamed', id: 7 }),
    pr(3, { login: bot, id: 99 }, { body: 'Submission: x\nSubmitted-by: old-name (7)' }),
    pr(4, { login: bot, id: 99 }, { body: 'Submitted-by: alice (77)' }),
    pr(5, { login: 'mallory', id: 8 }, { body: 'Submitted-by: alice (7)' }), // 不是机器人写的不认
    pr(6, { login: 'alice', id: 7 }, { state: 'closed', created_at: '2026-11-04T00:00:00Z' }),
    pr(1, { login: 'alice', id: 7 }), // 翻页重复的不重算
  ]
  assert.deepEqual(countMine(pulls, { id: 7, bot, since: '2026-11-05T12:00:00Z' }), { pending: 3, today: 3 })
  assert.deepEqual(countMine(pulls, { id: 0, bot }), { pending: 0, today: 0 })
})

test('截图暂存：只要对的路径、真 JPEG', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-shots-'))
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-stage-'))
  fs.mkdirSync(path.join(src, 'shots/alice-1__matcha'), { recursive: true })
  fs.writeFileSync(path.join(src, 'shots/alice-1__matcha/home.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))
  fs.writeFileSync(path.join(src, 'shots/alice-1__matcha/evil.jpg'), '<svg onload=alert(1)>')
  fs.writeFileSync(path.join(src, 'shots/alice-1__matcha/x.html'), 'x')
  fs.mkdirSync(path.join(src, 'shots/BAD NAME'), { recursive: true })
  fs.writeFileSync(path.join(src, 'shots/BAD NAME/a.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
  assert.deepEqual(stage(src, dest), ['shots/alice-1__matcha/home.jpg'])
})

test('真 zip 走一遍收稿（readZip + prepare）', async () => {
  const { readZip } = await import('dsh-design-studio/gallery')
  const files = Object.entries(goodFiles()).map(([p, v]) => ({ path: `抹茶/${p}`, data: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) }))
  const zip = writeZip(files)
  const back = readZip(zip).files
  const p = prepare(back, { login: 'alice-1', id: 42, license: 'CC0-1.0', vocab: loadVocab(FAKE) })
  assert.equal(p.ok, true, JSON.stringify(p.errors))
  assert.equal(p.dir, 'templates/alice-1__matcha-time')
})

test('脚本能直接跑（命令行）', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-cli-'))
  const r = execFileSync(process.execPath, [path.join(REAL, 'scripts/check.mjs'), 'templates/alice-1__matcha'], { env: { ...process.env, GALLERY_ROOT: FAKE, OUT: out, NO_RENDER: '1' }, encoding: 'utf8' })
  assert.match(r, /✓ templates\/alice-1__matcha/)
  const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'))
  assert.equal(res.entries[0].ok, true)
})

test('检查：一套查崩了（怪写法、目录读不了）——这套记成没过，照样查别的、照样写出结果（闸门才有结论）', { skip: process.getuid && process.getuid() === 0 }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-crash-'))
  for (const d of ['vocab', 'policy']) fs.cpSync(path.join(FAKE, d), path.join(root, d), { recursive: true })
  fs.copyFileSync(path.join(FAKE, 'LICENSE'), path.join(root, 'LICENSE'))
  const put = (rel, files) => { const dir = path.join(root, rel); fs.mkdirSync(dir, { recursive: true }); for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2)) }
  put('templates/alice-1__matcha', goodFiles())
  // author.login 写成带怪 toString 的对象：以前拿它 String() 会让整个检查崩掉
  put('templates/alice-1__weird', goodFiles({ author: { login: { toString: null }, id: 42 } }))
  put('templates/alice-1__locked', goodFiles())
  const locked = path.join(root, 'templates/alice-1__locked')
  fs.chmodSync(locked, 0o000)
  try {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-crash-out-'))
    const r = spawnSync(process.execPath, [path.join(REAL, 'scripts/check.mjs'), 'templates/alice-1__matcha', 'templates/alice-1__weird', 'templates/alice-1__locked'], { env: { ...process.env, GALLERY_ROOT: root, OUT: out, NO_RENDER: '1' }, encoding: 'utf8' })
    const res = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'))
    const by = Object.fromEntries(res.entries.map((e) => [e.dir, e]))
    assert.equal(res.entries.length, 3, r.stdout + r.stderr)
    assert.equal(by['templates/alice-1__matcha'].ok, true, JSON.stringify(by['templates/alice-1__matcha'].errors))
    assert.equal(by['templates/alice-1__weird'].ok, false)
    assert.ok(by['templates/alice-1__weird'].errors.some((x) => x.code === 'owner'), JSON.stringify(by['templates/alice-1__weird'].errors))
    const c = by['templates/alice-1__locked']
    assert.equal(c.ok, false)
    assert.ok(c.errors.some((x) => x.code === 'crash' && x.msg.includes('templates/alice-1__locked') && x.msgEn), JSON.stringify(c.errors))
    // 闸门据此判：失败（不是「没结论」）
    assert.equal(decide(readResults(JSON.stringify(res)), { login: 'alice-1', createdAt: '2020-01-01T00:00:00Z', now: Date.parse('2026-11-13T00:00:00Z') }).conclusion, 'failure')
  } finally { fs.chmodSync(locked, 0o755) }
})

test('闸门标签：一个 PR 最多 12 个，控制用的（检查结果、封禁、挂起、没数全、车道）一个不少，只少展示用的 flag', () => {
  const now = Date.parse('2026-11-06T00:00:00Z')
  const many = (n, over = {}) => readResults(JSON.stringify({ entries: [{ id: 'alice-1__matcha', type: 'template', ok: true, errors: [], flags: Array.from({ length: n }, (_, i) => ({ code: `f${i}`, msg: 'x' })), shots: [], ...over }] }))
  // 挂起（账号太新）+ 没数全 + 封禁（检查没过）：控制标签都在前面、都在
  const d = decide(many(20), { login: 'alice-1', createdAt: '2026-11-05T00:00:00Z', partial: true, now })
  assert.equal(d.labels.length, 12)
  for (const l of ['checks: pass', 'held: author', 'count: partial', 'lane: B']) assert.ok(d.labels.includes(l), l)
  assert.equal(d.labels.filter((l) => l.startsWith('flag: ')).length, 8)
  const b = decide(many(20), { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', strikes: 2, partial: true, now })
  for (const l of ['checks: fail', 'blocked: strikes', 'count: partial', 'lane: B']) assert.ok(b.labels.includes(l), l)
  assert.equal(b.labels.length, 12)
  // flag 少的：全给
  const few = decide(many(2), { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', now })
  assert.deepEqual(few.labels, ['checks: pass', 'lane: B', 'flag: f0', 'flag: f1'])
  // 同一个 flag 只算一次
  const dup = decide(readResults(JSON.stringify({ entries: [1, 2].map((k) => ({ id: `alice-1__m${k}`, type: 'template', ok: true, errors: [], flags: [{ code: 'password', msg: 'x' }], shots: [] })) })), { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', now })
  assert.deepEqual(dup.labels.filter((l) => l.startsWith('flag: ')), ['flag: password'])
})

test('手动信任按数字 id 找：改了名也认；同一个 id 有几条取最后记的（at 最晚），时间一样或读不出来保守取 T0', async () => {
  // 改名：记的时候叫 old-name，现在叫 new-name
  assert.equal(standing({ login: 'new-name', id: 42, overrides: { 'old-name': { tier: 'T2', id: 42, at: '2026-11-01T00:00:00Z' } } }).override, 'T2')
  // 改名前 /trust、改名后 /untrust：后记的 T0 说了算（不能靠改名绕过 /untrust）
  const two = { 'old-name': { tier: 'T2', id: 42, at: '2026-11-01T00:00:00Z' }, 'new-name': { tier: 'T0', id: 42, at: '2026-11-02T00:00:00Z' } }
  assert.equal(standing({ login: 'new-name', id: 42, overrides: two }).override, 'T0')
  assert.equal(standing({ login: 'old-name', id: 42, overrides: two }).override, 'T0')
  // 反过来：先 /untrust、后 /trust
  const back = { a: { tier: 'T0', id: 42, at: '2026-11-01T00:00:00Z' }, b: { tier: 'T2', id: 42, at: '2026-11-02T00:00:00Z' } }
  assert.equal(standing({ login: 'b', id: 42, overrides: back }).override, 'T2')
  // 时间一样、读不出来（哪怕只有一条读不出来，另一条是有效的 T2）：T0
  assert.equal(standing({ login: 'x', id: 42, overrides: { a: { tier: 'T2', id: 42, at: 't' }, b: { tier: 'T0', id: 42 } } }).override, 'T0')
  assert.equal(standing({ login: 'x', id: 42, overrides: { a: { tier: 'T2', id: 42, at: '2026-11-01T00:00:00Z' }, b: { tier: 'T0', id: 42 } } }).override, 'T0')
  assert.equal(standing({ login: 'x', id: 42, overrides: { a: { tier: 'T2', id: 42, at: '2026-11-01T00:00:00Z' }, b: { tier: 'T0', id: 42, at: 'later' } } }).override, 'T0')
  // 只有 T2（时间读不出来也一样）：T2
  assert.equal(standing({ login: 'x', id: 42, overrides: { a: { tier: 'T2', id: 42, at: 'x' }, b: { tier: 'T2', id: 42 } } }).override, 'T2')
  assert.equal(standing({ login: 'x', id: 42, overrides: { a: { tier: 'T2', id: 42, at: '2026-11-01T00:00:00Z' }, b: { tier: 'T0', id: 42, at: '2026-11-01T00:00:00Z' } } }).override, 'T0')
  // 别人的、没 id 的、tier 不对的、id 是 0 的都不算
  assert.equal(standing({ login: 'x', id: 42, overrides: { x: { tier: 'T2', id: 7 }, y: { tier: 'T9', id: 42 }, z: 'T2' } }).override, '')
  assert.equal(standing({ login: 'x', id: 0, overrides: { x: { tier: 'T2', id: 0 } } }).override, '')
  // 名单不是对象：不认（读的时候已经报错了，这里只是不崩）
  assert.equal(standing({ login: 'x', id: 42, overrides: [{ tier: 'T2', id: 42 }] }).override, '')
})

test('规矩文件严格读：只有文件不存在才用默认值；JSON 坏了、类型不对、读不了都报错（不能当成空名单）', async () => {
  const { readPolicyJson } = await import('../scripts/lib/repo.mjs')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-pol-'))
  const f = (n, t) => { const p = path.join(d, n); fs.writeFileSync(p, t); return p }
  assert.deepEqual(readPolicyJson(path.join(d, 'none.json'), []), [])
  assert.deepEqual(readPolicyJson(path.join(d, 'none.json'), {}), {})
  assert.deepEqual(readPolicyJson(f('ok.json', '[{"id":1}]'), []), [{ id: 1 }])
  assert.deepEqual(readPolicyJson(f('ok2.json', '{"a":{"tier":"T2","id":1}}'), {}), { a: { tier: 'T2', id: 1 } })
  assert.throws(() => readPolicyJson(f('bad.json', '[{"id":1},]'), []))
  assert.throws(() => readPolicyJson(f('obj.json', '{}'), []))
  assert.throws(() => readPolicyJson(f('arr.json', '[]'), {}))
  assert.throws(() => readPolicyJson(f('null.json', 'null'), {}))
  assert.throws(() => readPolicyJson(f('str.json', '"x"'), {}))
  assert.throws(() => readPolicyJson(d, {})) // 是个目录：读不了
  // 闸门（命令行）：规矩文件坏了就退出非 0，不写 gate.json
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-polcli-'))
  fs.mkdirSync(path.join(cwd, 'policy'))
  fs.writeFileSync(path.join(cwd, 'policy/strikes.json'), '[{"id":1},]')
  fs.writeFileSync(path.join(cwd, 'results.json'), JSON.stringify({ entries: [] }))
  assert.throws(() => execFileSync(process.execPath, [path.join(REAL, 'scripts/gate.mjs'), 'results.json', '--out', 'gate.json'], { cwd, stdio: 'pipe' }))
  assert.ok(!fs.existsSync(path.join(cwd, 'gate.json')))
  fs.writeFileSync(path.join(cwd, 'policy/strikes.json'), '[]')
  fs.writeFileSync(path.join(cwd, 'policy/trust-overrides.json'), '[]')
  assert.throws(() => execFileSync(process.execPath, [path.join(REAL, 'scripts/gate.mjs'), 'results.json', '--out', 'gate.json'], { cwd, stdio: 'pipe' }))
  fs.writeFileSync(path.join(cwd, 'policy/trust-overrides.json'), '{}')
  execFileSync(process.execPath, [path.join(REAL, 'scripts/gate.mjs'), 'results.json', '--out', 'gate.json'], { cwd, stdio: 'pipe' })
  // 闸门还写好「维护者挂起状态反过来」的那一份（post 写之前状态变了就用它）
  for (const mh of ['true', 'false']) {
    fs.writeFileSync(path.join(cwd, 'results.json'), JSON.stringify({ entries: [{ id: 'alice-1__mint', type: 'style', ok: true, errors: [], flags: [], shots: [] }] }))
    execFileSync(process.execPath, [path.join(REAL, 'scripts/gate.mjs'), 'results.json', '--out', 'gate.json'], { cwd, stdio: 'pipe', env: { ...process.env, GALLERY_ROOT: cwd, MAINT_HELD: mh, PR_AUTHOR_LOGIN: 'alice-1', ACCOUNT_CREATED_AT: '2020-01-01T00:00:00Z', PRIOR_MERGED: '1', COUNT_PARTIAL: '0' } })
    const g = JSON.parse(fs.readFileSync(path.join(cwd, 'gate.json'), 'utf8'))
    assert.equal(g.maintHeld, mh === 'true')
    assert.equal(g.alt.maintHeld, mh !== 'true')
    assert.equal(g.conclusion === 'success', mh !== 'true', JSON.stringify(g))
    assert.equal(g.alt.conclusion === 'success', mh === 'true')
    assert.equal(typeof g.alt.comment, 'string')
    assert.ok(Array.isArray(g.alt.labels))
  }
  // 被关过又重开了（REOPENED）：两份都不自动合并（反过来的只是维护者挂起）
  for (const mh of ['true', 'false']) {
    execFileSync(process.execPath, [path.join(REAL, 'scripts/gate.mjs'), 'results.json', '--out', 'gate.json'], { cwd, stdio: 'pipe', env: { ...process.env, GALLERY_ROOT: cwd, MAINT_HELD: mh, REOPENED: 'true', PR_AUTHOR_LOGIN: 'alice-1', ACCOUNT_CREATED_AT: '2020-01-01T00:00:00Z', PRIOR_MERGED: '1', COUNT_PARTIAL: '0' } })
    const g = JSON.parse(fs.readFileSync(path.join(cwd, 'gate.json'), 'utf8'))
    assert.equal(g.conclusion === 'success', false, JSON.stringify(g))
    assert.equal(g.alt.conclusion === 'success', false)
    assert.equal(g.alt.conclusion, 'neutral')
  }
  assert.ok(fs.existsSync(path.join(cwd, 'gate.json')))
})

test('/trust、/untrust 写信任名单：同一个 id 只留一条（改名前的旧条目去掉）；名单坏了就报错、不覆盖', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-trust-'))
  fs.mkdirSync(path.join(root, 'policy'))
  const read = () => JSON.parse(fs.readFileSync(path.join(root, 'policy/trust-overrides.json'), 'utf8'))
  const now = new Date('2026-11-12T00:00:00Z')
  applyPolicy({ action: 'trust', login: 'old-name', uid: 42 }, { root, now })
  applyPolicy({ action: 'trust', login: 'carol', uid: 9 }, { root, now })
  applyPolicy({ action: 'untrust', login: 'new-name', uid: 42 }, { root, now })
  assert.deepEqual(read(), { 'id:9': { tier: 'T2', id: 9, login: 'carol', at: now.toISOString() }, 'id:42': { tier: 'T0', id: 42, login: 'new-name', at: now.toISOString() } })
  assert.equal(standing({ login: 'new-name', id: 42, overrides: read() }).override, 'T0')
  // 用户名被别人重新注册：账号 42 叫 alice 时 /untrust 过，后来改了名；账号 99 注册了 alice、维护者 /trust 它——不能覆盖 42 的记录
  fs.writeFileSync(path.join(root, 'policy/trust-overrides.json'), JSON.stringify({ alice: { tier: 'T0', id: 42, at: '2026-11-01T00:00:00Z' } }))
  applyPolicy({ action: 'trust', login: 'alice', uid: 99 }, { root, now })
  assert.equal(standing({ login: 'renamed', id: 42, overrides: read() }).override, 'T0')
  assert.equal(standing({ login: 'alice', id: 99, overrides: read() }).override, 'T2')
  applyPolicy({ action: 'untrust', login: 'alice', uid: 99 }, { root, now })
  assert.equal(standing({ login: 'renamed', id: 42, overrides: read() }).override, 'T0')
  assert.equal(Object.keys(read()).length, 2)
  // 名单坏了：报错，文件原样不动
  fs.writeFileSync(path.join(root, 'policy/trust-overrides.json'), '{"carol": ')
  assert.throws(() => applyPolicy({ action: 'trust', login: 'dave', uid: 5 }, { root, now }))
  assert.equal(fs.readFileSync(path.join(root, 'policy/trust-overrides.json'), 'utf8'), '{"carol": ')
  fs.writeFileSync(path.join(root, 'policy/trust-overrides.json'), '[]')
  assert.throws(() => applyPolicy({ action: 'untrust', login: 'dave', uid: 5 }, { root, now }))
})

test('命令的先后按评论时间算：保护的（/untrust、/takedown）一律生效；放行的（/trust、/restore）碰上更晚（或同一秒）的保护记录就不改', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-order-'))
  fs.mkdirSync(path.join(root, 'policy'))
  const T = (h) => new Date(`2026-11-12T${String(h).padStart(2, '0')}:00:00Z`)
  const trust = () => JSON.parse(fs.readFileSync(path.join(root, 'policy/trust-overrides.json'), 'utf8'))['id:42']
  // clock：处理的这一刻（默认就是评论时间）
  const run = (action, h, extra = {}, clock = T(h).getTime()) => { const a = { action, login: 'alice', uid: 42, id: 'alice__x', reason: 'policy', ...extra }; const f = applyPolicy(a, { root, now: T(h), clock }); return { f, stale: !!a.stale } }
  const TF = 'policy/trust-overrides.json'
  // 10 点 /untrust 生效以后，9 点那条 /trust 才跑到（或被重跑）：不改
  assert.deepEqual(run('untrust', 10), { f: TF, stale: false })
  assert.deepEqual(run('trust', 9), { f: '', stale: true })
  assert.equal(trust().tier, 'T0')
  // 11 点 /trust（比 /untrust 晚）：生效，记录里的时间是评论时间
  assert.deepEqual(run('trust', 11), { f: TF, stale: false })
  assert.equal(trust().tier, 'T2')
  assert.equal(trust().at, T(11).toISOString())
  // 保护的一律生效：10 点那条 /untrust 被重跑也照样收紧，时间记成最晚的（11 点）——之后晚到的 11 点、10 点的旧 /trust 都盖不回去
  assert.deepEqual(run('untrust', 10), { f: TF, stale: false })
  assert.equal(trust().tier, 'T0')
  assert.equal(trust().at, T(11).toISOString())
  assert.deepEqual(run('trust', 11), { f: '', stale: true })
  assert.deepEqual(run('trust', 10), { f: '', stale: true })
  assert.equal(trust().tier, 'T0')
  // 要放开：再发一次（更晚的）/trust
  assert.deepEqual(run('trust', 12), { f: TF, stale: false })
  assert.equal(trust().tier, 'T2')
  // 同一秒：/untrust 盖得过 /trust，/trust 盖不过 /untrust；已经是不比它早的 /untrust 就不用改
  assert.deepEqual(run('untrust', 12), { f: TF, stale: false })
  assert.equal(trust().tier, 'T0')
  assert.deepEqual(run('trust', 12), { f: '', stale: true })
  assert.deepEqual(run('untrust', 12), { f: '', stale: false })
  assert.deepEqual(run('untrust', 11), { f: '', stale: false })
  // 同一个 id 有几条（改名前的、老写法的）：哪怕有一条不比这条早的 T0，最新的那条可能是放开的——并成一条 T0，时间取最晚的
  fs.writeFileSync(path.join(root, TF), JSON.stringify({ 'id:42': { tier: 'T0', id: 42, at: T(10).toISOString() }, alice: { tier: 'T2', id: 42, at: T(12).toISOString() } }))
  assert.deepEqual(run('untrust', 9), { f: TF, stale: false })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, TF), 'utf8')), { 'id:42': { tier: 'T0', id: 42, login: 'alice', at: T(12).toISOString() } })
  assert.equal(standing({ login: 'alice', id: 42, overrides: JSON.parse(fs.readFileSync(path.join(root, TF), 'utf8')) }).override, 'T0')
  // 时间读不出来的旧记录：/trust 不盖（分不出先后），/untrust 照写
  fs.writeFileSync(path.join(root, TF), JSON.stringify({ 'id:42': { tier: 'T0', id: 42, at: 'garbage' } }))
  assert.equal(run('trust', 13).stale, true)
  assert.equal(run('untrust', 13).stale, false)
  assert.equal(trust().at, T(13).toISOString())
  // 读不出时间的保护记录当成「最晚到现在」：20 点重跑一条 9 点的旧 /untrust，记成 20 点——之后晚到的 14 点 /trust 放不开，20 点以后发的才行
  fs.writeFileSync(path.join(root, TF), JSON.stringify({ 'id:42': { tier: 'T0', id: 42, at: 'garbage' }, alice: { tier: 'T2', id: 42, at: T(8).toISOString() } }))
  assert.deepEqual(run('untrust', 9, {}, T(20).getTime()), { f: TF, stale: false })
  assert.equal(trust().at, T(20).toISOString())
  assert.equal(run('trust', 14).stale, true)
  assert.equal(trust().tier, 'T0')
  assert.equal(run('trust', 21).stale, false)
  assert.equal(trust().tier, 'T2')
  // 下架 / 撤销
  fs.writeFileSync(path.join(root, 'policy/denylist.json'), '[]')
  const DF = 'policy/denylist.json'
  const deny = () => JSON.parse(fs.readFileSync(path.join(root, DF), 'utf8'))
  assert.equal(run('takedown', 10).f, DF)
  // 9 点的 /restore 是旧的（下架是 10 点发的）：不撤；同一秒的也不撤
  assert.deepEqual(run('restore', 9), { f: '', stale: true })
  assert.deepEqual(run('restore', 10), { f: '', stale: true })
  assert.equal(deny()[0].restored, undefined)
  assert.deepEqual(run('restore', 11), { f: DF, stale: false })
  assert.equal(deny()[0].restored, T(11).toISOString())
  // 保护的一律生效：11 点撤销以后，10 点那条 /takedown 被重跑——照样下架，时间记成最晚的（11 点），晚到的旧 /restore 撤不了
  assert.deepEqual(run('takedown', 10), { f: DF, stale: false })
  assert.deepEqual(deny().map((d) => [d.id, d.at, d.restored]), [['alice__x', T(11).toISOString(), undefined]])
  assert.deepEqual(run('restore', 11), { f: '', stale: true })
  // 要恢复：再发一次（更晚的）/restore
  assert.deepEqual(run('restore', 12), { f: DF, stale: false })
  assert.equal(deny()[0].restored, T(12).toISOString())
  // 同一秒的 /takedown 盖得过 /restore
  assert.deepEqual(run('takedown', 12), { f: DF, stale: false })
  assert.equal(deny().filter((d) => d.id === 'alice__x' && !d.restored).length, 1)
  // 已经下架着（这条或更晚的命令下的）：不用再记；更早下的照样换成这条（原因可能变了）
  assert.deepEqual(run('takedown', 12), { f: '', stale: false })
  assert.deepEqual(run('takedown', 10), { f: '', stale: false })
  assert.deepEqual(run('takedown', 13, { reason: 'copyright' }), { f: DF, stale: false })
  assert.deepEqual(deny().map((d) => [d.id, d.reason, d.at]), [['alice__x', 'copyright', T(13).toISOString()]])
  // 读不出时间的下架、撤销记录：当成「最晚到现在」——20 点重跑一条 9 点的旧 /takedown，记成 20 点，之后晚到的 14 点 /restore 撤不了
  fs.writeFileSync(path.join(root, DF), JSON.stringify([{ id: 'alice__x', at: T(5).toISOString(), restored: 'garbage' }]))
  assert.deepEqual(run('takedown', 9, {}, T(20).getTime()), { f: DF, stale: false })
  assert.deepEqual(deny().map((d) => [d.id, d.at, d.restored]), [['alice__x', T(20).toISOString(), undefined]])
  assert.deepEqual(run('restore', 14), { f: '', stale: true })
  assert.deepEqual(run('restore', 21), { f: DF, stale: false })
  // 下架记录本身的时间读不出来（还下架着）：/restore 盖不过（分不出先后）；补发一次 /takedown 把它并成「处理的这一刻」，之后发的 /restore 才行
  fs.writeFileSync(path.join(root, DF), JSON.stringify([{ id: 'alice__x', at: 'garbage', reason: 'policy' }]))
  assert.deepEqual(run('restore', 21), { f: '', stale: true })
  assert.deepEqual(run('takedown', 9, {}, T(20).getTime()), { f: DF, stale: false })
  assert.deepEqual(deny().map((d) => [d.id, d.at, d.restored]), [['alice__x', T(20).toISOString(), undefined]])
  assert.deepEqual(run('restore', 19), { f: '', stale: true })
  assert.deepEqual(run('restore', 21), { f: DF, stale: false })
  // 同一套有好几条（手改出来的）：也并成一条
  fs.writeFileSync(path.join(root, DF), JSON.stringify([{ id: 'alice__x', at: T(12).toISOString() }, { id: 'alice__x', at: 'garbage' }]))
  assert.deepEqual(run('takedown', 10, {}, T(20).getTime()), { f: DF, stale: false })
  assert.deepEqual(deny().map((d) => [d.id, d.at]), [['alice__x', T(20).toISOString()]])
  // 规矩文件手改坏了：不改、不覆盖（当成空的写回去，别的下架记录就丢了）
  for (const [f, action] of [['denylist.json', 'takedown'], ['denylist.json', 'restore'], ['featured.json', 'feature'], ['trust-overrides.json', 'untrust']]) {
    fs.writeFileSync(path.join(root, 'policy', f), '[{"id": "b__yyy",}]')
    assert.throws(() => run(action, 14, { id: 'b__yyy' }), f)
    assert.equal(fs.readFileSync(path.join(root, 'policy', f), 'utf8'), '[{"id": "b__yyy",}]')
  }
})

test('维护者命令（命令行）：规矩文件坏了回 error、不改；--holds 列出 /approve 之后（或同一秒）发 /hold 的人', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-cli-'))
  fs.mkdirSync(path.join(root, 'policy'))
  fs.writeFileSync(path.join(root, 'policy/denylist.json'), '[1,]')
  const cli = (args, env = {}) => spawnSync(process.execPath, [path.join(REAL, 'scripts/chatops.mjs'), ...args], { cwd: root, env: { ...process.env, GALLERY_ROOT: root, ...env }, encoding: 'utf8' })
  const r = cli(['--apply', '--out', path.join(root, 'a.json')], { COMMENT_BODY: '/takedown alice__xyz', COMMENT_AT: '2026-11-12T10:00:00Z' })
  assert.equal(r.status, 0, r.stderr)
  const a = JSON.parse(fs.readFileSync(path.join(root, 'a.json'), 'utf8'))
  assert.equal(a.action, 'error')
  assert.match(a.msg, /规矩文件读不出来，没改/)
  assert.equal(fs.readFileSync(path.join(root, 'policy/denylist.json'), 'utf8'), '[1,]')
  // --holds
  const since = '2026-11-13T01:00:00Z'
  const c = (id, login, body, at = '2026-11-13T01:00:05Z', type = 'User') => ({ id, user: { login, type }, body, created_at: at })
  const pages = [[c(400, 'm1', '/hold', '2026-11-13T00:00:00Z'), c(499, 'm2', '/hold brand', since), c(500, 'me', '/approve x')], [c(501, 'm3', '看一下\n /hold'), c(502, 'm4', '/hold\uFEFFx'), c(503, 'bot[bot]', '/hold', undefined, 'Bot'), c(504, 'm5', '/holdx'), c(505, 'm6', '/approve y\n/hold'), c(498, 'm7', '/hold', 'x'), c(506, 'm8', '/reject spam')]]
  fs.writeFileSync(path.join(root, 'c.json'), JSON.stringify(pages))
  const h = cli(['--holds', path.join(root, 'c.json'), '--id', '500', '--since', since])
  assert.equal(h.status, 0, h.stderr)
  // /reject 也算（关了以后作者能重开自己的 PR：旧的 /approve 不能越过它）
  //   每条一行「评论 id 发的人」（工作流按评论看机器人有没有点 👀）
  assert.deepEqual(h.stdout.trim().split('\n').sort(), ['498 m7', '499 m2', '501 m3', '502 m4', '506 m8'])
  // 读不出来（不是分页的列表、/approve 的 id 空着或不对、时间不对、评论缺 id）：失败（工作流当成挂起了）
  for (const [p, id, t] of [[{}, '500', since], [pages, 'x', since], [pages, '', since], [pages, '500', 'garbage'], [[[{ user: { login: 'a' }, body: '/hold' }]], '500', since]]) {
    fs.writeFileSync(path.join(root, 'c.json'), JSON.stringify(p))
    assert.notEqual(cli(['--holds', path.join(root, 'c.json'), '--id', id, '--since', t]).status, 0, JSON.stringify([p, id, t]))
  }
  // --action：认得的命令是什么（取消回话用）；不是命令是 none
  const ac = (body, pr = 'true') => cli(['--action'], { COMMENT_BODY: body, IS_PR: pr }).stdout.trim()
  assert.equal(ac('说明\r\n/hold'), 'hold')
  assert.equal(ac('\ufeff/approve\u00a0' + 'a'.repeat(40)), 'merge')
  assert.equal(ac('/hold', 'false'), 'error')
  assert.equal(ac('看这里 https://x.y/z'), 'none')
  assert.equal(ac('/approved'), 'none')
  // --target：/trust、/untrust 要查的用户名（工作流拿去查数字 id）；别的命令、不是命令都不出东西
  const tg = (body, pr = 'false') => cli(['--target'], { COMMENT_BODY: body, IS_PR: pr })
  assert.equal(tg('/untrust @Alice-1').stdout.trim(), 'alice-1')
  assert.equal(tg('请看一下\n/trust bob').stdout.trim(), 'bob')
  for (const b of ['/takedown alice__xyz', '/approve ' + 'a'.repeat(40), 'hello /untrust x', '']) {
    const t = tg(b, 'true')
    assert.equal(t.status, 0, t.stderr)
    assert.equal(t.stdout, '', b)
  }
})

test('检查：闸门算出来合进 main 以后和 PR 里不一样的目录（BEHIND）、合不到一起（CONFLICT）——报错，不能过', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-behind-'))
  const changed = path.join(out, 'changed.txt')
  const dir = path.join(FAKE, 'templates/alice-1__matcha')
  const f = fs.readdirSync(dir).find((x) => fs.statSync(path.join(dir, x)).isFile())
  fs.writeFileSync(changed, `M\0templates/alice-1__matcha/${f}\0`)
  const run = (env) => {
    spawnSync(process.execPath, [path.join(REAL, 'scripts/check.mjs'), '--changed', changed], { env: { ...process.env, GALLERY_ROOT: FAKE, OUT: out, NO_RENDER: '1', SUBMITTER_LOGIN: 'alice-1', ...env }, encoding: 'utf8' })
    return JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'))
  }
  const base = run({})
  assert.ok(!base.guard.some((x) => x.code === 'conflict'), JSON.stringify(base.guard))
  const e0 = base.entries.find((x) => x.dir === 'templates/alice-1__matcha')
  assert.ok(e0 && !e0.errors.some((x) => x.code === 'behind'))
  const b = run({ BEHIND: ' templates/x__y templates/alice-1__matcha' })
  const e = b.entries.find((x) => x.dir === 'templates/alice-1__matcha')
  assert.equal(e.ok, false)
  assert.ok(e.errors.some((x) => x.code === 'behind' && /Update branch/.test(x.msg) && /Update branch/.test(x.msgEn)))
  const c = run({ CONFLICT: '1' })
  assert.ok(c.guard.some((x) => x.code === 'conflict' && /冲突/.test(x.msg)))
  // 落后的目录在 PR 里整个删掉了（没有条目）：记在守卫上，也不能过
  assert.ok(b.guard.some((x) => x.code === 'behind' && x.msg.includes('templates/x__y')), JSON.stringify(b.guard))
  // 闸门据此判：都是失败
  const old = '2020-01-01T00:00:00Z', now = Date.parse('2026-11-13T00:00:00Z')
  for (const r of [b, c, run({ BEHIND: 'templates/x__y' })]) assert.equal(decide(readResults(JSON.stringify(r)), { login: 'alice-1', createdAt: old, now }).conclusion, 'failure')
  assert.notEqual(decide(readResults(JSON.stringify(base)), { login: 'alice-1', createdAt: old, now }).conclusion, 'failure')
})

test('submission-open.sh：机器人代开的 PR 投稿 issue 开着才放（0）；关了 3；读不出、查不到 1；别人开的不管', { skip: process.platform === 'win32' && '要 bash' }, () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-subopen-'))
  const bin = path.join(w, 'bin'); fs.mkdirSync(bin)
  // 假 gh：issues/<号> 的状态从环境变量拿；STATE=fail 就报错
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho "$*" >> "$W/gh.log"\n[ "$STATE" = fail ] && exit 1\necho "$STATE"\n', { mode: 0o755 })
  const go = (prj, state = 'open false') => {
    const f = path.join(w, 'pr.json'); fs.writeFileSync(f, JSON.stringify(prj)); fs.writeFileSync(path.join(w, 'gh.log'), '')
    const r = spawnSync('bash', [path.join(REAL, 'scripts/submission-open.sh'), f], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, W: w, STATE: state, GITHUB_REPOSITORY: 'o/r', APP_SLUG: 'bot' }, encoding: 'utf8' })
    return { code: r.status, gh: fs.readFileSync(path.join(w, 'gh.log'), 'utf8') }
  }
  const bot = (body) => ({ user: { login: 'bot[bot]' }, body })
  const body = 'Submitted-by: a (1)\r\nSubmission: https://github.com/o/r/issues/12\r\n'
  assert.equal(go(bot(body)).code, 0)
  assert.match(go(bot(body)).gh, /api repos\/o\/r\/issues\/12 /)
  assert.equal(go(bot(body), 'closed false').code, 3)
  // 被拒了（rejected 标签：作者自己关过、又重开了）：也不合
  assert.equal(go(bot(body), 'open true').code, 3)
  assert.equal(go(bot(body), 'open').code, 1)
  assert.equal(go(bot(body), 'fail').code, 1)
  assert.equal(go(bot(body), 'weird').code, 1)
  for (const b of ['', 'Submission: https://github.com/x/y/issues/12', 'Submission: https://github.com/o/r/issues/0', 'Submission: https://github.com/o/r/issues/12x']) assert.equal(go(bot(b)).code, 1, b)
  // 别人开的 PR：不查
  const eve = go({ user: { login: 'eve' }, body })
  assert.equal(eve.code, 0)
  assert.equal(eve.gh, '')
  // 作者读不出来（缺字段、空的、不是字符串）：不能当成「别人开的」放过，算查不到
  for (const prj of [{ body }, { user: null, body }, { user: {}, body }, { user: { login: '' }, body }, { user: { login: 5 }, body }]) {
    const r = go(prj)
    assert.equal(r.code, 1, JSON.stringify(prj))
    assert.equal(r.gh, '')
  }
})

test('was-closed.sh：作者读不出来（缺字段、空的）算查不到（1），不当成「不是机器人代开的」只看 PR 自己的记录', { skip: process.platform === 'win32' && '要 bash' }, () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-wasclosed-'))
  const bin = path.join(w, 'bin'); fs.mkdirSync(bin)
  // 在临时目录里跑（脚本会在当前目录写中间文件）
  fs.mkdirSync(path.join(w, 'scripts'))
  for (const f of ['was-closed.sh', 'closed-by.sh']) fs.copyFileSync(path.join(REAL, 'scripts', f), path.join(w, 'scripts', f))
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/bash\necho "$*" >> "$W/gh.log"\necho "[]"\n', { mode: 0o755 })
  const go = (prj) => {
    const f = path.join(w, 'pr.json'); fs.writeFileSync(f, JSON.stringify(prj)); fs.writeFileSync(path.join(w, 'gh.log'), '')
    const r = spawnSync('bash', [path.join(w, 'scripts/was-closed.sh'), f], { cwd: w, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, W: w, GITHUB_REPOSITORY: 'o/r', APP_SLUG: 'bot' }, encoding: 'utf8' })
    return { code: r.status, gh: fs.readFileSync(path.join(w, 'gh.log'), 'utf8') }
  }
  // 对照：别人开的、没被关过：3
  assert.equal(go({ number: 7, user: { login: 'eve' }, body: '' }).code, 3)
  for (const prj of [{ number: 7, body: '' }, { number: 7, user: {}, body: '' }, { number: 7, user: { login: '' }, body: '' }, { number: 7, user: { login: null }, body: '' }]) {
    assert.equal(go(prj).code, 1, JSON.stringify(prj))
  }
})

test('审核卡太长被截短时，给维护者的完整 /approve 命令还在（放在最前面）', () => {
  const now = Date.parse('2026-11-06T00:00:00Z')
  const H = 'd'.repeat(40)
  const item = (i) => ({ code: `c${i}`, msg: `提醒${i}`.repeat(80).slice(0, 400), msgEn: `note ${i} `.repeat(50).slice(0, 400) })
  const res = readResults(JSON.stringify({ entries: Array.from({ length: 4 }, (_, k) => ({ id: `alice-1__m${k}xx`, type: 'template', ok: true, errors: [], flags: Array.from({ length: 40 }, (_, i) => item(i)), shots: Array.from({ length: 8 }, (_, i) => `shots/alice-1__m${k}xx/s${i}.jpg`) })) }))
  const d = decide(res, { login: 'alice-1', createdAt: '2020-01-01T00:00:00Z', shotsBase: 'https://raw.githubusercontent.com/o/r/review-shots/3/9', sha: H, now })
  assert.equal(d.conclusion, 'neutral')
  assert.match(d.comment, /审核卡太长，后面省略了/)
  assert.ok(d.comment.includes(`/approve ${H}`))
  // A 车道（全绿风格卡）：挂起了（数量超了）、没挂起，卡上都给 /approve（机器人不合并，一律维护者看过再合）
  const style = readResults(JSON.stringify({ entries: [{ id: 'alice-1__sty', type: 'style', ok: true, errors: [], flags: [], shots: [] }] }))
  const lim = decide(style, { login: 'alice-1', createdAt: '2020-01-01T00:00:00Z', priorMerged: 3, today: 5, sha: H, now })
  assert.deepEqual([lim.lane, lim.held, lim.conclusion === 'success'], ['A', 'limit', false])
  assert.ok(lim.comment.includes(`/approve ${H}`))
  const auto = decide(style, { login: 'alice-1', createdAt: '2020-01-01T00:00:00Z', priorMerged: 3, sha: H, now })
  assert.deepEqual([auto.lane, auto.conclusion], ['A', 'success'])
  assert.ok(auto.comment.includes(`/approve ${H}`))
  // 结果里没有「自动合并」这回事
  assert.ok(!('automerge' in auto))
  assert.doesNotMatch(auto.comment, /自动合并|auto-merg/)
  assert.match(auto.comment, /等维护者看一眼/)
})

test('审核卡太长就截短（评论上限 65536 字）：截短的说清楚，短的原样', async () => {
  const { capCard, CARD_MAX } = await import('../scripts/gate.mjs')
  assert.equal(capCard('abc'), 'abc')
  const exact = 'x'.repeat(CARD_MAX)
  assert.equal(capCard(exact), exact)
  const long = capCard('y'.repeat(CARD_MAX * 5))
  assert.ok(long.length <= CARD_MAX)
  assert.match(long, /审核卡太长，后面省略了/)
  // decide 出来的卡也截了：每套设计的错误、提醒都写满（不截的话远超上限）
  const now = Date.parse('2026-11-06T00:00:00Z')
  const item = (i) => ({ code: `c${i}`, msg: `错误${i}`.repeat(60).slice(0, 300), msgEn: `error ${i} `.repeat(40).slice(0, 300) })
  const res = readResults(JSON.stringify({ entries: Array.from({ length: 5 }, (_, k) => ({ id: `alice-1__m${k}xx`, type: 'template', ok: false, errors: Array.from({ length: 30 }, (_, i) => item(i)), flags: Array.from({ length: 30 }, (_, i) => item(i + 30)), shots: [] })) }))
  assert.ok(res.entries[0].errors[0].msg.length > 100 && res.entries[0].errors.length === 30)
  const d = decide(res, { login: 'alice-1', createdAt: '2024-01-01T00:00:00Z', now })
  assert.ok(d.comment.length <= CARD_MAX, String(d.comment.length))
  assert.match(d.comment, /审核卡太长，后面省略了/)
  assert.match(d.comment, /^<!-- dsh-gallery-gate -->/)
})
