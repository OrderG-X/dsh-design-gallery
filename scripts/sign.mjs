#!/usr/bin/env node
/**
 * 目录签名（ed25519，Node 自带，不加依赖）
 *
 *   node scripts/sign.mjs keygen <私钥存到哪>       生成一对钥匙：私钥写进文件（只给你自己，权限 600），屏幕上只打公钥
 *   node scripts/sign.mjs sign <index.json>          用环境变量 GALLERY_SIGNING_KEY（PEM 私钥）签名，写 index.json.sig（base64）
 *   node scripts/sign.mjs verify <index.json> [公钥]  用公钥验（不给就用 policy/keys.json 里的）
 *
 * 签的是 index.json 的原始字节。插件里钉两把公钥（现用的 + 下一把），换钥匙时先发带新公钥的插件。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT, readJson } from './lib/repo.mjs'

/** 公钥（base64 的 32 字节原始公钥）→ KeyObject */
export function publicKeyOf(b64) {
  const raw = Buffer.from(String(b64), 'base64')
  if (raw.length !== 32) throw new Error('公钥要是 32 字节（base64）')
  // ed25519 SPKI 头 + 32 字节
  return crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
}

export function rawPublic(keyObject) {
  return keyObject.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64')
}

export function signBytes(bytes, privatePem) {
  const key = crypto.createPrivateKey(privatePem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('私钥不是 ed25519')
  return crypto.sign(null, bytes, key).toString('base64')
}

export function verifyBytes(bytes, sigB64, publics) {
  const sig = Buffer.from(String(sigB64).trim(), 'base64')
  if (sig.length !== 64) return false
  return publics.some((p) => { try { return crypto.verify(null, bytes, publicKeyOf(p), sig) } catch { return false } })
}

function main() {
  const [cmd, a, b] = process.argv.slice(2)
  if (cmd === 'keygen') {
    if (!a) { console.error('要给私钥存放路径'); process.exit(2) }
    const out = path.resolve(a)
    if (fs.existsSync(out)) { console.error(`${out} 已经有了，不覆盖`); process.exit(2) }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(out, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' })
    console.log(`私钥已写到 ${out}（只有你能读）。再存一份到别的地方（U 盘 / 密码管理器），丢了就只能换钥匙。`)
    console.log(`公钥（发给维护插件的人，钉进插件里）：${rawPublic(publicKey)}`)
    return
  }
  if (cmd === 'sign') {
    const pem = process.env.GALLERY_SIGNING_KEY
    if (!pem) { console.error('没有 GALLERY_SIGNING_KEY'); process.exit(2) }
    const bytes = fs.readFileSync(a)
    const sig = signBytes(bytes, pem)
    fs.writeFileSync(`${a}.sig`, sig + '\n')
    // 签完立刻用公钥验一遍：钥匙配错了别发出去
    const pubs = readJson(path.join(ROOT, 'policy', 'keys.json'), { keys: [] }).keys
    if (pubs.length && !verifyBytes(bytes, sig, pubs)) { console.error('签名和 policy/keys.json 里的公钥对不上：私钥配错了？'); process.exit(1) }
    console.log(`已签名 ${a}.sig`)
    return
  }
  if (cmd === 'verify') {
    const bytes = fs.readFileSync(a)
    const sig = fs.readFileSync(`${a}.sig`, 'utf8')
    const pubs = b ? [b] : readJson(path.join(ROOT, 'policy', 'keys.json'), { keys: [] }).keys
    const ok = verifyBytes(bytes, sig, pubs)
    console.log(ok ? '签名对' : '签名不对')
    process.exitCode = ok ? 0 : 1
    return
  }
  console.error('用法：sign.mjs keygen <文件> | sign <index.json> | verify <index.json> [公钥]')
  process.exit(2)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
