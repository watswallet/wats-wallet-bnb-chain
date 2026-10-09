// WalletConnect QA harness'i -- tarayici ve CDP katmani (spec bolum 12, S2).
//
// Atilabilir profil + GERCEK dist (`--load-extension`) ile Chromium'u surer. Bagimlilik YOK:
// Node 22'nin yerlesik WebSocket'i ile CDP konusulur. Tum hedefler (service worker, popup,
// onay penceresi, dapp/Lab sayfasi) `Target.setAutoAttach {flatten:true}` ile tek WebSocket
// uzerinden oturum olarak acilir; uzanti hedeflerinin Network olaylari `NetworkGuard`'a akar.
//
// 2026-10-05 PLAN-ZAMANI OLCUMLERI (headless=new, ms-playwright chromium-1228, Windows 11):
//   - `--load-extension` calisir; SW hedefi `.../service-worker-loader.js`. Chromium'un kendi
//     bilesen uzantisi da `thunk.js` adli bir service_worker hedefi acar: URL'si
//     `service-worker-loader` icerenle ESLE, yoksa yanlis uzantiya baglanirsin.
//   - `chrome.windows.create({type:'popup'})` onay penceresi hedef olarak GORUNUR
//     (`.../src/popup/index.html#window`); ConnectDapp ekrani ~4 sn icinde cizilir (poll et).
//   - TUZAK (--window-size): headless sanal ekrani 800x600'dur. `--window-size` ile ekrandan buyuk pencere
//     istenirse SW'nin `chrome.windows.create` (left = son pencere solu + genislik - 360) cagrisi
//     "Invalid value for bounds. Bounds must be at least 50% within visible screen space." ile
//     reddedilir ve dapp "-32603 Failed to open approval window" alir (spec N3; T8 bunu cuzdanda
//     yedekler, harness yine de bayrak VERMEZ). Gorunum boyutu `Emulation.setDeviceMetricsOverride` ile.
//   - TUZAK: ACIK BIR uzanti popup sekmesi (ana ekran) varken dapp'in `window.ethereum.request`
//     cagrilari "-32603 The wallet returned an empty response" alir (hem onay beklerken hem
//     `eth_chainId` gibi okumalarda; D6'da olculdu). Kilidi actiktan sonra popup sekmesini KAPAT
//     (`closeTarget` oturumun kalkmasini bekler); popup acikken dapp'e ISTEK ATMA, yalniz
//     `window.__qaEvents` / depolama gibi PASIF kaynaklari oku.
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function findChrome(override) {
  if (override) return override
  if (process.env.QA_CHROME) return process.env.QA_CHROME
  const roots = [join(process.env.LOCALAPPDATA || '', 'ms-playwright'), join(process.env.HOME || '', '.cache/ms-playwright')]
  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
    for (const d of dirs) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(root, d, rel)
        if (existsSync(p)) return p
      }
    }
  }
  throw new Error('Chromium bulunamadi. `npx playwright install chromium` ile kur veya QA_CHROME ortam degiskenini ver. (Marka Chrome 137+ --load-extension\'i yok sayar.)')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 0
    this.pending = new Map()
    this.handlers = []
    this.closed = false
    // Soket kapanirsa bekleyen cagrilar sonsuza dek asili kalmasin.
    ws.addEventListener('close', () => {
      this.closed = true
      for (const [, p] of this.pending) p.reject(new Error('CDP WebSocket kapandi'))
      this.pending.clear()
    })
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id)
        this.pending.delete(m.id)
        if (m.error) p.reject(new Error(`${m.error.message} (${m.error.code})`))
        else p.resolve(m.result)
      } else if (m.method) {
        for (const h of this.handlers) {
          try { h(m) } catch (e) { console.error('cdp handler error:', e.message) }
        }
      }
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    try {
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve)
        ws.addEventListener('error', () => reject(new Error('CDP WebSocket baglanamadi')))
      })
    } catch (e) {
      try { ws.close() } catch { /* zaten kapali */ }
      throw e
    }
    return new Cdp(ws)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.nextId
    const msg = { id, method, params, ...(sessionId ? { sessionId } : {}) }
    return new Promise((resolve, reject) => {
      if (this.closed) { reject(new Error('CDP WebSocket kapali')); return }
      this.pending.set(id, { resolve, reject })
      try { this.ws.send(JSON.stringify(msg)) } catch (e) { this.pending.delete(id); reject(e) }
    })
  }

  on(handler) { this.handlers.push(handler) }
  off(handler) { this.handlers = this.handlers.filter((h) => h !== handler) }
  close() { try { this.ws.close() } catch { /* zaten kapali */ } }
}

// Bir hedefe bagli oturum (flatten).
export class Session {
  constructor(browser, sessionId, info, origin) {
    this.browser = browser
    this.sessionId = sessionId
    this.targetId = info.targetId
    this.info = info
    this.origin = origin
    this.logs = []
  }

  get url() { return this.info.url }
  send(method, params) { return this.browser.cdp.send(method, params, this.sessionId) }

  // Her degerlendirme ust sinirlidir: bekleyen bir cuzdan istegi (ornek: onay penceresi hic acilmadi)
  // tum kosuyu SONSUZA dek asili birakmasin.
  async evaluate(expression, { awaitPromise = true, timeout = 90000 } = {}) {
    let timer
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`evaluate zaman asimi (${timeout} ms): ${expression.slice(0, 120)}`)), timeout) })
    let r
    try {
      r = await Promise.race([this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }), limit])
    } finally {
      clearTimeout(timer)
    }
    if (r.exceptionDetails) {
      throw new Error(`evaluate hatasi: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
    }
    return r.result.value
  }

  async waitFor(expression, { timeout = 15000, interval = 250, label = expression } = {}) {
    const end = Date.now() + timeout
    let lastErr = ''
    while (Date.now() < end) {
      try {
        if (await this.evaluate(expression)) return true
      } catch (e) { lastErr = e.message }
      await sleep(interval)
    }
    throw new Error(`zaman asimi (${timeout} ms): ${label}${lastErr ? ` (son hata: ${lastErr})` : ''}`)
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(r.data, 'base64'))
    return file
  }

  async text() { return this.evaluate(`document.body ? document.body.innerText : ''`) }
}

export class Browser {
  // opts: { chrome, extensionDir, profileDir, debugPort, hostRules, headed, extraArgs, onNetwork, label }
  static async launch(opts) {
    mkdirSync(opts.profileDir, { recursive: true })
    const args = [
      opts.headed ? '' : '--headless=new',
      `--remote-debugging-port=${opts.debugPort}`,
      `--user-data-dir=${opts.profileDir}`,
      `--load-extension=${opts.extensionDir}`,
      `--disable-extensions-except=${opts.extensionDir}`,
      '--no-first-run', '--no-default-browser-check', '--ignore-certificate-errors',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      ...(opts.hostRules ? [`--host-resolver-rules=${opts.hostRules}`] : []),
      ...(opts.extraArgs || []),
      'about:blank',
    ].filter(Boolean)
    const child = spawn(opts.chrome, args, { stdio: 'ignore', windowsHide: true })
    child.on('error', (e) => console.error('chrome baslatilamadi:', e.message))
    const killChild = () => {
      try {
        if (process.platform === 'win32' && child.pid) execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
        else child.kill('SIGKILL')
      } catch { /* surec zaten bitmis */ }
    }
    let version = null
    for (let i = 0; i < 80 && !version; i += 1) {
      try { version = await (await fetch(`http://127.0.0.1:${opts.debugPort}/json/version`)).json() } catch { await sleep(250) }
    }
    if (!version) { killChild(); throw new Error('Chrome CDP uc noktasi acilmadi') }
    let cdp
    try {
      cdp = await Cdp.connect(version.webSocketDebuggerUrl)
    } catch (e) {
      killChild()
      throw e
    }
    const b = new Browser(child, cdp, opts)
    // #init hata verirse (dist yuklenmedi, SW yok) Chrome ve CDP soketi SIZMASIN: Node sureci takili kalirdi.
    try { await b.#init() } catch (e) { await b.close(); throw e }
    return b
  }

  constructor(child, cdp, opts) {
    this.child = child
    this.cdp = cdp
    this.opts = opts
    this.sessions = new Map() // sessionId -> Session
    this.byTarget = new Map() // targetId -> Session
    this.extId = null
    this.usedApprovals = new Set()
    this.dialogs = [] // alert/confirm metinleri (ornek: network.rpcUnreachable uyarisi, spec N5 kaniti)
  }

  originOf(info) {
    const ext = this.extId ? `chrome-extension://${this.extId}/` : null
    if (info.type === 'service_worker' && info.url.includes('service-worker-loader')) return 'sw'
    if (info.type === 'service_worker') return 'other-sw'
    if (info.type === 'page' && ext && info.url.startsWith(ext)) return info.url.includes('#window') ? 'approval' : 'popup'
    if (info.type === 'page') return 'page'
    return 'other'
  }

  async #register(sessionId, info) {
    if (this.byTarget.has(info.targetId)) return this.byTarget.get(info.targetId)
    const origin = this.originOf(info)
    const s = new Session(this, sessionId, info, origin)
    this.sessions.set(sessionId, s)
    this.byTarget.set(info.targetId, s)
    try {
      await s.send('Runtime.enable')
      if (info.type === 'page') await s.send('Page.enable')
      if (['sw', 'popup', 'approval'].includes(origin)) await s.send('Network.enable')
    } catch (e) { s.logs.push({ type: 'error', text: `oturum hazirlanamadi: ${e.message}` }) }
    return s
  }

  async #init() {
    this.cdp.on((m) => {
      // QA_DEBUG=1: tum Target.* olaylarini stderr'e yazar (hedef/oturum sorunlarini ayiklamak icin).
      if (process.env.QA_DEBUG && m.method.startsWith('Target.')) console.error(`[target-event ${Date.now() % 1000000}] ${m.method} ${JSON.stringify(m.params).slice(0, 200)}`)
      if (m.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo, waitingForDebugger } = m.params
        this.#register(sessionId, targetInfo)
          .then(() => waitingForDebugger && this.cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId))
          .catch(() => {})
      }
      if (m.method === 'Target.targetInfoChanged') {
        const s = this.byTarget.get(m.params.targetInfo.targetId)
        if (s) { s.info = m.params.targetInfo; s.origin = this.originOf(s.info) }
      }
      if (m.method === 'Target.targetDestroyed') {
        const gone = this.byTarget.get(m.params.targetId)
        if (gone) { this.sessions.delete(gone.sessionId); this.byTarget.delete(gone.targetId) }
      }
      if (m.method === 'Target.detachedFromTarget') {
        const s = this.sessions.get(m.params.sessionId)
        if (s) { this.sessions.delete(m.params.sessionId); this.byTarget.delete(s.targetId) }
      }
      const s = m.sessionId && this.sessions.get(m.sessionId)
      if (!s) return
      if (m.method === 'Page.javascriptDialogOpening') {
        // alert() sayfayi KILITLER; metni kanita yaz ve kapat (uyarilar kosuyu durdurmasin).
        this.dialogs.push({ t: Date.now(), origin: s.origin, type: m.params.type, message: m.params.message })
        this.cdp.send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId).catch(() => {})
      }
      if (m.method.startsWith('Network.') || m.method === 'Network.webSocketCreated') {
        if (this.opts.onNetwork && ['sw', 'popup', 'approval'].includes(s.origin)) this.opts.onNetwork(s.origin, m.sessionId, m)
      }
      if (m.method === 'Runtime.consoleAPICalled' && s.logs.length < 500) {
        s.logs.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400) })
      }
      if (m.method === 'Runtime.exceptionThrown' && s.logs.length < 500) {
        s.logs.push({ type: 'exception', text: String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 400) })
      }
    })
    await this.cdp.send('Target.setDiscoverTargets', { discover: true })
    // Uzanti kimligi: SW hedefi gorunene kadar bekle (SW gec uyanabilir).
    for (let i = 0; i < 60 && !this.extId; i += 1) {
      const { targetInfos } = await this.cdp.send('Target.getTargets')
      const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.includes('service-worker-loader'))
      if (sw) this.extId = new URL(sw.url).host
      else await sleep(250)
    }
    if (!this.extId) throw new Error('uzanti service worker hedefi bulunamadi (service-worker-loader.js). dist yuklenmedi mi?')
    // waitForDebuggerOnStart VARSAYILAN KAPALI (2026-10-05: ilk dapp istegi askida gozlemi ile iliskisi
    // YOKTUR, olculdu; ama duraklatilan hedefler gereksiz risk). QA_PAUSE_ON_START=1 ile acilir: yeni
    // hedeflerin ILK ag olaylari da kacirilmaz (spec S4 tamligi).
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: process.env.QA_PAUSE_ON_START === '1', flatten: true })
    await sleep(800) // otomatik baglanma olaylari gelsin; elle tarama yalniz KALANLARI baglar
    // Onceden var olan hedefleri (SW, about:blank) elle bagla; yinelenen baglanma #register'da elenir.
    const { targetInfos } = await this.cdp.send('Target.getTargets')
    for (const t of targetInfos) {
      if (this.byTarget.has(t.targetId) || !['page', 'service_worker'].includes(t.type)) continue
      if (t.type === 'service_worker' && !t.url.includes(this.extId)) continue
      try {
        const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })
        await this.#register(sessionId, t)
      } catch { /* hedef kapanmis olabilir */ }
    }
  }

  // Tani: bagli oturumlarin ozeti (akis hatasinda kanita yazilir).
  describe() {
    return [...this.sessions.values()].map((x) => ({ type: x.info.type, origin: x.origin, url: x.info.url.slice(0, 100) }))
  }

  // SW oturumu hazir olana kadar bekler (SW durdurulup yeniden baslayinca oturum degisir).
  async swReady(timeout = 20000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const s = this.sw()
      if (s) return s
      await sleep(200)
    }
    throw new Error('uzanti SW oturumu yeniden bagli degil')
  }

  // Uzanti service worker oturumu (chrome.* burada VAR).
  sw() {
    for (const s of this.sessions.values()) if (s.origin === 'sw') return s
    return null
  }

  // Yeni sayfa ac ve oturumunu don.
  async openPage(url, { width = 1280, height = 900 } = {}) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url })
    const s = await this.waitSession(targetId)
    await s.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }).catch(() => {})
    return s
  }

  async waitSession(targetId, timeout = 15000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (this.byTarget.has(targetId)) return this.byTarget.get(targetId)
      await sleep(100)
    }
    throw new Error(`hedef oturumu acilmadi: ${targetId}`)
  }

  // Yeni bir uzanti onay penceresi (`#window`) cikana kadar bekler; oturumunu don.
  // Daha once dondurulen pencereler (`usedApprovals`) atlanir: kapanmis bir pencerenin bayat oturumu
  // yeni istegin penceresi sanilmasin.
  async waitApproval({ timeout = 20000, notIn = [] } = {}) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      for (const s of this.sessions.values()) {
        if (s.origin === 'approval' && !notIn.includes(s.targetId) && !this.usedApprovals.has(s.targetId)) {
          this.usedApprovals.add(s.targetId)
          return s
        }
      }
      await sleep(200)
    }
    throw new Error(`onay penceresi (#window) ${timeout} ms icinde cikmadi`)
  }

  // Bir onay penceresinin kendiliginden kapanmasini bekler (Connect/Sign/Switch tiklamasindan sonra).
  // SONRAKI istegi pencere tamamen kalkmadan baslatmak cuzdanda "-32603 bos yanit" yarisi uretir
  // (2026-10-05 olcumu: ardisik onaylarda ~%20 oraninda). Her onaydan sonra CAGIR.
  async waitClosed(targetId, timeout = 10000) {
    const end = Date.now() + timeout
    while (Date.now() < end && this.byTarget.has(targetId)) await sleep(100)
    await sleep(500)
  }

  // Dapp sekmesinin penceresini "son odaklanan pencere" yaparak uzanti popup sayfasini AYRI bir
  // pencerede acar: Header.vue aktif sekmeyi `tabs.query({active:true, lastFocusedWindow:true})` ile
  // bulur; popup kendi sekmesinde acilirsa dapp'i goremez. DOGRULANMADI mekanizma (headless odak
  // modeli): calismazsa Header dapp baglantisini gostermez, akis DEVIATION doner.
  async openPopupWindowFor(dappSession) {
    const sw = this.sw()
    const origin = new URL(dappSession.url).origin
    const winId = await sw.evaluate(`chrome.tabs.query({}).then((ts) => { const t = ts.find((x) => x.url && x.url.startsWith(${JSON.stringify(origin)})); return t ? t.windowId : null })`)
    if (winId === null) throw new Error(`dapp sekmesi bulunamadi: ${origin}`)
    const known = new Set([...this.sessions.values()].filter((x) => x.origin === 'popup').map((x) => x.targetId))
    await sw.evaluate(`chrome.windows.create({ url: chrome.runtime.getURL('src/popup/index.html'), type: 'popup', width: 360, height: 600, focused: false }).then(() => true)`)
    await sw.evaluate(`chrome.windows.update(${winId}, { focused: true }).then(() => true)`)
    const end = Date.now() + 20000
    while (Date.now() < end) {
      for (const x of this.sessions.values()) if (x.origin === 'popup' && !known.has(x.targetId)) return x
      await sleep(200)
    }
    throw new Error('popup penceresi acilmadi')
  }

  // Hedefi kapatir ve oturumunun GERCEKTEN kalktigini bekler (acik uzanti sayfasi varken dapp
  // istekleri "bos yanit" alir, bkz. dosya basi TUZAK; bu yuzden bekleme sart).
  async closeTarget(targetId) {
    await this.cdp.send('Target.closeTarget', { targetId }).catch(() => {})
    const end = Date.now() + 5000
    while (Date.now() < end && this.byTarget.has(targetId)) await sleep(100)
    await sleep(500)
  }

  // Uzanti popup sayfasini bir SEKMEDE acar (sistem popup'i degildir). Onay beklenirken ACIK birakma.
  async openPopupTab() {
    const s = await this.openPage(`chrome-extension://${this.extId}/src/popup/index.html`, { width: 360, height: 600 })
    return s
  }

  async close() {
    try { this.cdp.close() } catch { /* kapali */ }
    try {
      if (process.platform === 'win32') execSync(`taskkill /PID ${this.child.pid} /T /F`, { stdio: 'ignore' })
      else this.child.kill('SIGKILL')
    } catch { /* surec zaten bitmis */ }
  }
}
