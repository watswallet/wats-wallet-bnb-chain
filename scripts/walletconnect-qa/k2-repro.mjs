// K2 yeniden uretim betigi: sayfa yuklenir yuklenmez atilan ILK provider istegi askida kaliyor mu?
//
// Bagimliliksiz (Node 22: yerlesik WebSocket/fetch). Her kosu: TAZE profil + GERCEK dist (--load-extension) +
// yerel bir HTTP sayfasi; sayfa `window.ethereum.request({method:'eth_accounts'})` cagrisini en erken anda atar.
// `npm run build` ASLA: derleme SCRATCH kopyada `node node_modules/vite/bin/vite.js build` ile yapilir
// (vite-plugin-zip-pack her derlemede release/<ad>-<surum>.zip yazar; WT'de calisirsa magaza zip'ini EZER).
//
// Ornek:
//   node scripts/walletconnect-qa/k2-repro.mjs --runs 30                       (taban: taze profil, hemen at)
//   node scripts/walletconnect-qa/k2-repro.mjs --runs 30 --instrument          (zaman damgali kayit)
//   node scripts/walletconnect-qa/k2-repro.mjs --runs 30 --pre sw-stopped      (H2: SW soguk baslangic)
//   node scripts/walletconnect-qa/k2-repro.mjs --dist <dizin> --runs 30        (derlemeyi atla)
// Cikis kodu: 0 = tum kosular OK; 1 = en az bir HANG/SLOW/ERROR/NOPROVIDER; 2 = betik hatasi (SCRIPT_ERROR).
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, symlinkSync, rmdirSync, readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyRun, summarize, formatSummary, parseArgs, buildPageHtml, mergeTimeline, diagnoseTimeline } from './k2-lib.mjs'
import { applyInstrumentation } from './k2-instrument.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEFAULT_CHROME = 'C:/Users/Numan/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'

function findChrome(opt) {
  if (opt.chrome) return opt.chrome
  if (process.env.QA_CHROME) return process.env.QA_CHROME
  if (existsSync(DEFAULT_CHROME)) return DEFAULT_CHROME
  const root = join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (existsSync(root)) {
    for (const d of readdirSync(root).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const p = join(root, d, 'chrome-win64', 'chrome.exe')
      if (existsSync(p)) return p
    }
  }
  throw new Error('Chromium bulunamadi: --chrome <yol> ya da QA_CHROME ver (marka Chrome 137+ --load-extension yok sayar)')
}

// ---------------------------------------------------------------------------------------------- derleme (scratch)
// Derleme yarida kalirsa scratch (ve node_modules baglantisi) ARDINDA KALMAZ.
function build(opt, wt) {
  const stamp = Date.now()
  const scratch = join(tmpdir(), `k2-build-${stamp}`)
  mkdirSync(scratch, { recursive: true })
  try {
    return buildInto(opt, wt, scratch)
  } catch (e) {
    cleanupBuild(scratch)
    throw e
  }
}

function buildInto(opt, wt, scratch) {
  const clientSrc = join(wt, 'client')
  if (opt.source === 'head') {
    const tarPath = join(scratch, 'client.tar')
    execFileSync('git', ['-C', wt, 'archive', '--format=tar', '-o', tarPath, 'HEAD', 'client'], { stdio: 'inherit' })
    execFileSync('tar', ['-xf', 'client.tar'], { cwd: scratch, stdio: 'inherit' }) // GNU tar: C:\ yolunu uzak makine sanar -> goreli ad + cwd
  } else {
    const list = execFileSync('git', ['-C', wt, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'client'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    for (const rel of list.split('\0').filter(Boolean)) {
      const from = join(wt, rel)
      if (!existsSync(from)) continue // izlenen ama silinmis dosya
      cpSync(from, join(scratch, rel), { recursive: false })
    }
  }
  const scratchClient = join(scratch, 'client')
  symlinkSync(join(clientSrc, 'node_modules'), join(scratchClient, 'node_modules'), 'junction')
  if (opt.instrument) applyInstrumentation(scratchClient)
  const env = { ...process.env, VITE_API_URL: 'http://127.0.0.1:9', VITE_BUNDLER_BASE: 'http://127.0.0.1:9' } // uretim sunucusuna ULASMASIN
  execFileSync(process.execPath, ['scripts/gen-wallet-standard-metadata.mjs'], { cwd: scratchClient, env, stdio: 'ignore' })
  execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: scratchClient, env, stdio: 'ignore' })
  const dist = join(scratchClient, 'dist')
  if (!existsSync(join(dist, 'manifest.json'))) throw new Error(`derleme dist/manifest.json uretmedi: ${dist}`)
  return { scratch, dist }
}

function cleanupBuild(scratch) {
  try { rmdirSync(join(scratch, 'client', 'node_modules')) } catch { /* junction yok/zaten kalkmis */ } // ONCE baglanti: WT paketleri silinmesin
  if (existsSync(join(scratch, 'client', 'node_modules'))) { // baglanti kalkmadiysa HICBIR SEY silme (WT paketleri tehlikede olabilir)
    console.error(`[k2] UYARI: node_modules baglantisi kaldirilamadi, scratch SILINMEDI: ${scratch}`)
    return
  }
  try { rmSync(scratch, { recursive: true, force: true }) } catch (e) { console.error('scratch silinemedi:', e.message) }
}

// ---------------------------------------------------------------------------------------------- CDP
class Cdp {
  constructor(ws) {
    this.ws = ws; this.nextId = 0; this.pending = new Map(); this.handlers = []
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id)
        if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`)); else p.resolve(m.result)
      } else if (m.method) for (const h of this.handlers) { try { h(m) } catch { /* yut */ } }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('CDP WebSocket baglanamadi'))) })
    return new Cdp(ws)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  on(h) { this.handlers.push(h) }
  close() { try { this.ws.close() } catch { /* kapali */ } }
}

async function evalIn(cdp, sessionId, expression, timeout = 15000) {
  let timer
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`evaluate zaman asimi: ${expression.slice(0, 80)}`)), timeout) })
  try {
    const r = await Promise.race([cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId), limit])
    if (r.exceptionDetails) throw new Error(`evaluate hatasi: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
    return r.result.value
  } finally { clearTimeout(timer) }
}

async function findSw(cdp, timeout = 20000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const { targetInfos } = await cdp.send('Target.getTargets')
    const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('service-worker-loader'))
    if (sw) return { targetId: sw.targetId, extId: new URL(sw.url).host }
    await sleep(100)
  }
  return null
}

async function attach(cdp, targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  return sessionId
}

// ---------------------------------------------------------------------------------------------- tek kosu
async function waitDevtools(profile, timeout = 20000) {
  const f = join(profile, 'DevToolsActivePort')
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (existsSync(f)) {
      try { // Windows: Chromium dosyayi yazarken okuma EBUSY verebilir (plan zamani olcumunde 30 kosuda 1 kez): yeniden dene
        const [port, path] = readFileSync(f, 'utf8').trim().split(/\r?\n/)
        if (port && path) return `ws://127.0.0.1:${port}${path}`
      } catch { /* kilitli: sonraki turda tekrar */ }
    }
    await sleep(100)
  }
  throw new Error('DevToolsActivePort gelmedi (Chromium baslamadi)')
}

function killTree(proc) {
  try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { try { proc.kill('SIGKILL') } catch { /* olu */ } }
}

async function runOne(i, opt, ctx) {
  const profile = mkdtempSync(join(tmpdir(), 'k2-prof-'))
  const args = [
    opt.headed ? '' : '--headless=new', `--user-data-dir=${profile}`, `--load-extension=${ctx.dist}`, `--disable-extensions-except=${ctx.dist}`,
    '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', 'about:blank',
  ].filter(Boolean)
  const proc = spawn(ctx.chrome, args, { stdio: 'ignore' })
  const rec = { i, status: 'PENDING', pre: opt.pre, fire: opt.fire, state: opt.state, notes: [] }
  let cdp
  try {
    cdp = await Cdp.connect(await waitDevtools(profile))
    const consoleLines = []
    let pageSession = ''
    cdp.on((m) => {
      if (m.method === 'Runtime.consoleAPICalled' && m.sessionId === pageSession) {
        const a = m.params.args?.[0]?.value
        const b = m.params.args?.[1]?.value
        if (a === '[k2]' && typeof b === 'string') { try { consoleLines.push(JSON.parse(b)) } catch { /* bozuk satir */ } }
      }
    })

    // 1) durum: has-vault = SENTETIK kasa kaydi (cozulemez; yalniz hasVaults() dalini degistirir; T7'nin gercek tohumuyla ESDEGERLIGI DOGRULANMADI)
    let sw = null
    if (opt.pre !== 'none' || opt.state === 'has-vault' || opt.popup) {
      sw = await findSw(cdp)
      if (!sw) throw new Error('service worker hedefi bulunamadi')
    }
    if (opt.state === 'has-vault') {
      const s = await attach(cdp, sw.targetId)
      await cdp.send('Runtime.enable', {}, s)
      let ready = false
      for (let k = 0; k < 50 && !ready; k += 1) { // SW baglami ilk anlarda chrome.storage'i henuz tasimaz (plan zamani olcumu)
        ready = await evalIn(cdp, s, "!!(self.chrome && chrome.storage && chrome.storage.local)").catch(() => false)
        if (!ready) await sleep(100)
      }
      if (!ready) throw new Error('SW icinde chrome.storage hazir olmadi')
      await evalIn(cdp, s, "chrome.storage.local.set({ vaults: [{ fingerprint: 'k2', accounts: [] }] }).then(() => true)")
      await cdp.send('Target.detachFromTarget', { sessionId: s }).catch(() => {})
      await sleep(300)
    }

    // 2) on kosul
    if (opt.pre === 'settle') await sleep(opt.settleMs)
    if (opt.pre === 'sw-idle') { // GERCEK soguk baslangic: SW kendiliginden (bosta ~30 sn) durana kadar bekle; DevTools baglanmaz
      let gone = false
      for (let k = 0; k < 80 && !gone; k += 1) {
        const { targetInfos } = await cdp.send('Target.getTargets')
        gone = !targetInfos.some((t) => t.type === 'service_worker' && t.url.includes('service-worker-loader'))
        if (!gone) await sleep(1000)
      }
      rec.swStopped = gone
      if (!gone) rec.notes.push('SW 80 sn icinde durmadi (alarm/olay uyandiriyor olabilir): sw-idle kosusu GECERSIZ')
    }
    if (opt.pre === 'sw-stopped') {
      const blank = (await cdp.send('Target.createTarget', { url: 'about:blank' })).targetId
      const bs = await attach(cdp, blank)
      await cdp.send('ServiceWorker.enable', {}, bs)
      await cdp.send('ServiceWorker.stopAllWorkers', {}, bs)
      let gone = false
      for (let k = 0; k < 30 && !gone; k += 1) {
        await sleep(100)
        const { targetInfos } = await cdp.send('Target.getTargets')
        gone = !targetInfos.some((t) => t.type === 'service_worker' && t.url.includes('service-worker-loader'))
      }
      rec.swStopped = gone
      if (!gone) rec.notes.push('SW durdurulamadi (ServiceWorker.stopAllWorkers etkisiz): sw-stopped kosusu GECERSIZ')
      await cdp.send('Target.closeTarget', { targetId: blank }).catch(() => {})
      await sleep(200)
    }
    if (opt.popup) {
      await cdp.send('Target.createTarget', { url: `chrome-extension://${sw.extId}/src/popup/index.html` })
      await sleep(1500)
    }

    // 3) sayfa: ONCE hedefe baglan + konsolu ac, SONRA gezin (ilk kayitlar kacmasin)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    pageSession = await attach(cdp, targetId)
    await cdp.send('Runtime.enable', {}, pageSession)
    await cdp.send('Page.enable', {}, pageSession)
    const navAt = Date.now()
    await cdp.send('Page.navigate', { url: ctx.pageUrl }, pageSession)

    // 4) yanit bekle
    let k2 = null
    let timedOut = false
    for (;;) {
      try {
        const v = await evalIn(cdp, pageSession, 'JSON.stringify(window.__k2 || null)', 3000)
        k2 = v ? JSON.parse(v) : null
      } catch { /* gezinme sirasinda baglam yok */ }
      if (k2 && k2.calls.length >= opt.burst && k2.calls.every((c) => c.done)) break
      if (k2 && k2.calls.some((c) => c.status === 'NOPROVIDER')) break
      if (Date.now() - navAt > opt.timeoutMs) { timedOut = true; break }
      await sleep(100)
    }
    const calls = k2 ? k2.calls : []
    rec.status = classifyRun(calls, { timedOut })
    if (timedOut && calls.length < opt.burst) { rec.status = 'SCRIPT_ERROR'; rec.notes.push('sayfa betigi atis yapmadi (sayfa yuklenmedi?)') }
    rec.calls = calls
    rec.firedAfterMs = k2 && k2.firedAt ? k2.firedAt - navAt : null
    rec.readyStateAtFire = k2 ? k2.readyStateAtFire : null

    // 5) askida ise: ikinci istek + gec yanit (hangi halkada kayboldu?)
    if (rec.status === 'HANG') {
      try {
        rec.second = await evalIn(cdp, pageSession, "Promise.race([window.ethereum.request({ method: 'eth_chainId' }).then(function (r) { return { ok: true, r: r } }, function (e) { return { ok: false, e: String(e && e.message), code: e && e.code } }), new Promise(function (r) { setTimeout(function () { r({ timeout: true }) }, 5000) })])", 8000)
        const again = JSON.parse(await evalIn(cdp, pageSession, 'JSON.stringify(window.__k2.calls)', 3000))
        rec.lateAnswered = again.map((c) => c.done)
        if (again.length >= opt.burst && again.every((c) => c.done)) rec.status = 'SLOW' // kayip degil: sure asildiktan SONRA yanitlandi
      } catch (e) { rec.second = { error: e.message } }
    }

    // 6) kayit (yalniz --instrument)
    if (opt.instrument) {
      const inj = await evalIn(cdp, pageSession, 'JSON.stringify((window.__k2inj && window.__k2inj.posts) || [])', 3000).then(JSON.parse).catch(() => [])
      let swLog = []
      let swStart = null
      const sw2 = await findSw(cdp, 1500)
      if (sw2) {
        try {
          const s = await attach(cdp, sw2.targetId)
          const v = JSON.parse(await evalIn(cdp, s, 'JSON.stringify({ start: globalThis.__k2swStart || null, log: globalThis.__k2log || [] })', 4000))
          swLog = v.log; swStart = v.start
        } catch (e) { rec.notes.push(`SW kaydi okunamadi: ${e.message}`) }
      } else rec.notes.push('SW hedefi yok (kosu sirasinda durmus/yeniden dogmus olabilir: kayit kaybolur)')
      rec.swStart = swStart
      rec.timeline = mergeTimeline(navAt, inj, consoleLines, swLog)
      if (rec.status === 'HANG' || rec.status === 'SLOW') rec.diagnosis = diagnoseTimeline(rec.timeline)
    }
    await cdp.send('Browser.close').catch(() => {})
  } catch (e) {
    rec.status = 'SCRIPT_ERROR'
    rec.notes.push(e.message)
  } finally {
    try { cdp?.close() } catch { /* kapali */ }
    killTree(proc)
    await sleep(300)
    for (let k = 0; k < 12; k += 1) { try { rmSync(profile, { recursive: true, force: true }); break } catch { await sleep(500) } } // Windows: Chromium dosyalari birakana kadar bekle
  }
  return rec
}

// ---------------------------------------------------------------------------------------------- ana
async function main() {
  const opt = parseArgs(process.argv.slice(2))
  if (opt.cleanup) { cleanupBuild(opt.cleanup); console.log('[k2] temizlendi: ' + opt.cleanup); process.exit(0) }
  const clientRoot = join(HERE, '..', '..')
  const wt = opt.wt || dirname(clientRoot)
  const chrome = findChrome(opt)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = opt.out || join(wt, '.superpowers', 'sdd', 'walletconnect-qa', 'k2', stamp)
  mkdirSync(outDir, { recursive: true })

  let dist = opt.dist
  let scratch = ''
  if (!dist) {
    console.log(`[k2] derleniyor (scratch, kaynak=${opt.source}${opt.instrument ? ', TANI YAMALI' : ''}) ...`)
    ;({ dist, scratch } = build(opt, wt))
  }
  const html = buildPageHtml({ fire: opt.fire, burst: opt.burst, fireDelayMs: opt.fireDelayMs })
  const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const ctx = { dist, chrome, pageUrl: `http://127.0.0.1:${server.address().port}/` }
  console.log(`[k2] chrome=${chrome}\n[k2] dist=${dist}\n[k2] secenekler=${JSON.stringify({ ...opt, dist: undefined })}`)

  const runs = []
  try {
    for (let i = 1; i <= opt.runs; i += 1) {
      const r = await runOne(i, opt, ctx)
      runs.push(r)
      console.log(`[k2] kosu ${String(i).padStart(2)}/${opt.runs}: ${r.status}${r.calls?.[0]?.ms !== undefined ? ` (${r.calls.map((c) => c.ms).join('/')} ms)` : ''}${r.diagnosis ? ` | teshis=${r.diagnosis.verdict}` : ''}${r.notes.length ? ` | ${r.notes.join(' ; ')}` : ''}`)
    }
  } finally {
    server.close()
    if (scratch && !opt.keep) cleanupBuild(scratch)
    else if (scratch) console.log(`[k2] scratch KALDI (--keep): ${scratch}
[k2]   yeniden kullan: --dist ${dist}
[k2]   temizle    : node scripts/walletconnect-qa/k2-repro.mjs --cleanup ${scratch}`)
  }
  const s = summarize(runs)
  const line = formatSummary(`K2 ${opt.pre}/${opt.fire}/${opt.state}${opt.popup ? '/popup' : ''}${opt.instrument ? '/instr' : ''}`, s)
  console.log(line)
  writeFileSync(join(outDir, 'runs.json'), JSON.stringify({ opt: { ...opt, dist: undefined }, summary: s, runs }, null, 2))
  writeFileSync(join(outDir, 'summary.txt'), `${line}\n`)
  console.log(`[k2] kanit: ${outDir}`)
  const scriptErrors = runs.filter((r) => r.status === 'SCRIPT_ERROR').length
  process.exit(scriptErrors ? 2 : (s.HANG + s.SLOW + s.ERROR + s.NOPROVIDER + s.PENDING) > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[k2] BETIK HATASI:', e.stack || e.message); process.exit(2) })
