// WalletConnect QA calismasi, N5 -- RPC duman betigi. SALT OKUNUR.
//
// Calistirma:  cd client && node scripts/walletconnect-qa/rpc-smoke.mjs
// Cikis kodu:  0 = GECTI, 1 = KALDI.
//
// OP (10), Base (8453), Arbitrum One (42161) ve Polygon (137) icin
// src/data/supported_chains.json'daki HER rpc URL'sine var OLMAYAN bir hash icin
// eth_getTransactionReceipt sorar (cuzdanin kendi makbuz sondasi: testRPC.js
// probeReceiptSupport). Hicbir seye yazmaz; baska hicbir yontem gonderilmez.
//
// GECTI/KALDI kurali: her zincirde listenin ILK URL'si (cuzdan found.rpc[0].url'yi
// DOGRUDAN kullanir) OK olmali VE en az bir URL OK olmali. Diger URL'lerdeki
// hata yalnizca UYARIdir (cikis kodu 0).
//
// Public RPC politikalari haber vermeden degisir (2026-08-05, 2026-10-03):
// yayindan hemen once ve listeleme guncelleme gununde (G-5) YENIDEN kosulur.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RECEIPT_PROBE_HASH } from '../../src/utils/testRPC.js'

export const SMOKE_CHAIN_IDS = [10, 8453, 42161, 137]
export const SMOKE_TIMEOUT_MS = 10000

const errorName = (e) => (e && e.name) || ''
const errorText = (e) => String((e && e.message) || e)

// Tek URL'yi yoklar. ASLA firlatmaz: her sonuc bir satirdir.
// status: OK | RPC_ERROR | HTTP_ERROR | NO_RESULT | BAD_JSON | TIMEOUT | NETWORK
export async function probeUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = SMOKE_TIMEOUT_MS } = {}) {
  const started = Date.now()
  const finish = (status, detail) => ({ status, detail, ms: Date.now() - started })
  const timeoutDetail = `${timeoutMs} ms icinde cevap yok`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [RECEIPT_PROBE_HASH],
        id: 1,
      }),
      signal: controller.signal,
      cache: 'no-cache',
    })
    if (!response.ok) return finish('HTTP_ERROR', `HTTP ${response.status}`)

    let data
    try {
      data = await response.json()
    } catch (e) {
      if (errorName(e) === 'AbortError') return finish('TIMEOUT', timeoutDetail)
      return finish('BAD_JSON', 'cevap JSON degil')
    }

    // Sagliksiz: uc canli ama makbuz vermiyor (ornek: -32602 "Archive requests ...").
    if (data && typeof data === 'object' && data.error) {
      return finish('RPC_ERROR', `${data.error.code} ${data.error.message}`)
    }
    // Alan hic yoksa uc bu yontemi tanimiyor demektir (testRPC.js ile ayni kural).
    if (!data || typeof data !== 'object' || !('result' in data)) {
      return finish('NO_RESULT', 'cevapta result alani yok')
    }
    // Var olmayan islem icin DOGRU cevap result:null'dir: saglikli uc.
    return finish('OK', data.result === null ? 'result:null (makbuz yok: beklenen)' : 'result var')
  } catch (e) {
    if (errorName(e) === 'AbortError') return finish('TIMEOUT', timeoutDetail)
    return finish('NETWORK', errorText(e))
  } finally {
    clearTimeout(timer)
  }
}

// Bir zincirin gecti/kaldi karari (saf). results[i], urls[i]'nin probeUrl sonucu.
export function evaluateChain({ chainId, name, urls, results }) {
  const reasons = []
  const warnings = []
  if (urls.length === 0) {
    reasons.push('rpc listesi bos')
  } else {
    if (results[0].status !== 'OK') {
      reasons.push(`ilk URL OK degil: ${urls[0]} (${results[0].status}: ${results[0].detail})`)
    }
    if (!results.some((r) => r.status === 'OK')) {
      reasons.push('hicbir URL OK degil')
    }
    results.forEach((r, i) => {
      if (i > 0 && r.status !== 'OK') {
        warnings.push(`yedek URL OK degil: ${urls[i]} (${r.status}: ${r.detail})`)
      }
    })
  }
  return { chainId, name, pass: reasons.length === 0, reasons, warnings }
}

// Zincirler sirayla, bir zincirin URL'leri paralel yoklanir.
export async function runSmoke({ chains, chainIds = SMOKE_CHAIN_IDS, fetchImpl, timeoutMs } = {}) {
  const rows = []
  const verdicts = []
  for (const chainId of chainIds) {
    const entry = (chains || []).find((c) => c.chainId === chainId)
    if (!entry) {
      verdicts.push({
        chainId,
        name: `chainId ${chainId}`,
        pass: false,
        reasons: ['supported_chains.json icinde bu zincir yok'],
        warnings: [],
      })
      continue
    }
    const urls = (Array.isArray(entry.rpc) ? entry.rpc : []).map((r) => r && r.url).filter(Boolean)
    const results = await Promise.all(urls.map((url) => probeUrl(url, { fetchImpl, timeoutMs })))
    urls.forEach((url, i) => rows.push({ chainId, name: entry.name, position: i + 1, url, ...results[i] }))
    verdicts.push(evaluateChain({ chainId, name: entry.name, urls, results }))
  }
  return { rows, verdicts, exitCode: verdicts.every((v) => v.pass) ? 0 : 1 }
}

export function formatTable(rows) {
  const head = ['ZINCIR', 'SIRA', 'URL', 'SONUC', 'MS', 'AYRINTI']
  const body = rows.map((r) => [
    `${r.name} (${r.chainId})`,
    String(r.position),
    r.url,
    r.status,
    String(r.ms),
    String(r.detail).slice(0, 90),
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)))
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n')
}

function loadChains() {
  const file = new URL('../../src/data/supported_chains.json', import.meta.url)
  return JSON.parse(readFileSync(file, 'utf8'))
}

async function main() {
  console.log(
    `rpc-smoke ${new Date().toISOString()}  (salt okunur: eth_getTransactionReceipt, URL basina ${SMOKE_TIMEOUT_MS / 1000} sn)`,
  )
  const { rows, verdicts, exitCode } = await runSmoke({ chains: loadChains() })
  console.log(formatTable(rows))
  console.log('')
  for (const v of verdicts) {
    console.log(`${v.pass ? 'GECTI' : 'KALDI'}  ${v.name} (${v.chainId})`)
    for (const reason of v.reasons) console.log(`  neden: ${reason}`)
    for (const warning of v.warnings) console.log(`  UYARI: ${warning}`)
  }
  console.log(`\nSONUC: ${exitCode === 0 ? 'GECTI' : 'KALDI'}`)
  process.exitCode = exitCode
}

// Yalnizca dogrudan `node rpc-smoke.mjs` ile kosulunca calisir; vitest'te import
// edilince AGA GITMEZ.
const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    console.error(`rpc-smoke beklenmeyen hata: ${errorText(e)}`)
    process.exitCode = 1
  })
}
