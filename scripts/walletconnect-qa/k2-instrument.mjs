// K2 tani yamasi -- YALNIZ SCRATCH KOPYAYA uygulanir (WT dosyalarina ASLA yazilmaz).
//
// Amac: ilk istegin hangi halkada kayboldugunu zaman damgasiyla gormek. Uc halka:
//   (1) sayfa dunyasi  injected.js  -> window.__k2inj  (sayfadan okunur)
//   (2) icerik betigi  content.js   -> console.debug('[k2] ...') (sayfa oturumunun konsol olaylarindan toplanir)
//   (3) service worker background.js-> globalThis.__k2log + __k2swStart (SW oturumundan okunur)
// Tum damgalar Date.now() (ayni makine, ayni saat). Yama davranisi DEGISTIRMEZ, yalniz kayit ekler;
// yine de zamanlamayi az da olsa etkiler: sonuclar "kayitli" diye etiketlenir (bkz. plan Faz 2).
//
// Kullanim:  node scripts/walletconnect-qa/k2-instrument.mjs --check   (WT kaynaklarinda capalar buluniyor mu; HICBIR ESE YAZMAZ)
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Her yama: dosya, capa (TEK SATIR, EOL'suz, TAM metin), `insert` = capadan SONRA, `beforeLines` = capadan ONCE
// eklenecek satirlar (EOL dosyadan algilanir). Eklenen her satir `;` ile baslar ya da kendi basina bir ifadedir (ASI tuzagi).
export const PATCHES = [
  {
    file: 'src/injected.js',
    anchor: 'const generateId = () => Math.random().toString(36).substring(2, 15)',
    insert: [";(window.__k2inj = window.__k2inj || { posts: [] }).posts.push({ at: Date.now(), src: 'inj', ev: 'injected-eval', detail: '' })"],
  },
  {
    file: 'src/content.js',
    anchor: "window.addEventListener('message', (event) => {",
    insert: [],
    beforeLines: ["console.debug('[k2]', JSON.stringify({ at: Date.now(), src: 'content', ev: 'listener-registering', detail: document.readyState }))"],
  },
  {
    file: 'src/injected.js',
    anchor: "      this._callbacks.set(id, { resolve, reject })",
    insert: ["      ;(window.__k2inj = window.__k2inj || { posts: [] }).posts.push({ at: Date.now(), src: 'inj', ev: 'request-post', detail: method + ' #' + id })"],
  },
  {
    file: 'src/content.js',
    anchor: "    if (event.source !== window || !event.data || event.data.target !== 'wats_content_script') return",
    insert: ["    console.debug('[k2]', JSON.stringify({ at: Date.now(), src: 'content', ev: 'got-message', detail: String(event.data.payload && event.data.payload.method) + ' #' + event.data.id }))"],
  },
  {
    file: 'src/content.js',
    anchor: "        chrome.runtime.sendMessage(event.data.payload, (response) => {",
    insert: ["            console.debug('[k2]', JSON.stringify({ at: Date.now(), src: 'content', ev: 'sendMessage-cb', detail: String(event.data.payload && event.data.payload.method) + ' #' + event.data.id + ' lastError=' + String(chrome.runtime.lastError && chrome.runtime.lastError.message) + ' response=' + (response === undefined ? 'undefined' : response === null ? 'null' : 'obj') }))"],
    beforeLines: ["        console.debug('[k2]', JSON.stringify({ at: Date.now(), src: 'content', ev: 'sendMessage-call', detail: String(event.data.payload && event.data.payload.method) + ' #' + event.data.id }))"],
  },
  {
    file: 'src/background.js',
    anchor: "chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {",
    insert: ["  ;(globalThis.__k2log = globalThis.__k2log || []).push({ at: Date.now(), src: 'sw', ev: 'onMessage-enter', detail: String(message && (message.method || message.type)) })"],
  },
  {
    file: 'src/background.js',
    anchor: "  const action = message.method || message.type;",
    insert: [
      "  { const __orig = sendResponse; sendResponse = (r) => { (globalThis.__k2log = globalThis.__k2log || []).push({ at: Date.now(), src: 'sw', ev: 'sendResponse', detail: String(action) }); return __orig(r) } }",
    ],
  },
]

// background.js'in ILK import'u olarak eklenen yan-etki modulu: SW modulunun degerlendirme BASLANGICI.
export const SW_START_MODULE = {
  path: 'src/k2-sw-start.js',
  content: "globalThis.__k2swStart = Date.now();\n;(globalThis.__k2log = globalThis.__k2log || []).push({ at: Date.now(), src: 'sw', ev: 'module-eval-start', detail: '' })\n",
  firstImportAnchor: "import { ethers, HDNodeWallet, Wallet } from 'ethers'",
  firstImportInsert: "import './k2-sw-start.js'",
}

function eolOf(s) { return s.includes('\r\n') ? '\r\n' : '\n' }

// Saf: kaynak metne yamalari uygular. Capa TAM BIR kez bulunmazsa FIRLATIR (kayma sessiz gecmez).
export function patchSource(file, src) {
  let out = src
  for (const p of PATCHES.filter((x) => x.file === file)) {
    const eol = eolOf(out)
    const lines = out.split(eol)
    const hits = lines.map((l, i) => (l === p.anchor ? i : -1)).filter((i) => i >= 0)
    if (hits.length !== 1) throw new Error(`k2-instrument: capa ${file} icinde ${hits.length} kez bulundu (1 olmali): ${p.anchor.slice(0, 80)}`)
    const i = hits[0]
    if (p.beforeLines) lines.splice(i, 0, ...p.beforeLines)
    const at = lines.indexOf(p.anchor)
    lines.splice(at + 1, 0, ...p.insert)
    out = lines.join(eol)
  }
  if (file === 'src/background.js') {
    const eol = eolOf(out)
    const lines = out.split(eol)
    const hits = lines.map((l, i) => (l === SW_START_MODULE.firstImportAnchor ? i : -1)).filter((i) => i >= 0)
    if (hits.length !== 1) throw new Error('k2-instrument: background.js ilk import capasi bulunamadi')
    lines.splice(hits[0], 0, SW_START_MODULE.firstImportInsert)
    out = lines.join(eol)
  }
  return out
}

export function applyInstrumentation(clientDir) {
  for (const file of [...new Set(PATCHES.map((p) => p.file))]) {
    const full = join(clientDir, file)
    writeFileSync(full, patchSource(file, readFileSync(full, 'utf8')))
  }
  writeFileSync(join(clientDir, SW_START_MODULE.path), SW_START_MODULE.content)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--check')) {
  const clientDir = process.argv.includes('--client') ? process.argv[process.argv.indexOf('--client') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  let bad = 0
  for (const file of [...new Set(PATCHES.map((p) => p.file))]) {
    try {
      patchSource(file, readFileSync(join(clientDir, file), 'utf8'))
      console.log(`OK    ${file}`)
    } catch (e) { bad += 1; console.log(`KAYMA ${file}: ${e.message}`) }
  }
  process.exit(bad ? 1 : 0)
}
