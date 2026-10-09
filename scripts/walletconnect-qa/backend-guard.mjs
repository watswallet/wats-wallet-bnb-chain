// WalletConnect QA harness'i -- uretim sunucusu yalitimi (spec bolum 12, S4).
//
// Uzanti hedeflerinden (service worker, popup, onay penceresi) cikan HER ag istegini
// siniflar ve kosu sonunda su iddiayi uretir: `*.watswallet.com`'a giden her istek YEREL
// taklit sunucuya ulasmistir; baska yerel olmayan istek yalnizca asagidaki IZINLI
// kategorilerden biridir, digerleri kosuyu BASARISIZ sayar.
//
// IZINLI kategoriler (spec'in iki istisnasi + olculerek eklenen UCUNCU, bkz. README):
//   rpc-read      : `realrpc` fazinda, chain listesindeki public RPC ana makinelerine
//                   yalnizca OKUMA yontemleriyle POST (spec istisna ii: F6/F7 gercek RPC)
//   static-asset  : GET ile Image/Font/Stylesheet/Media (ornek: fonts.gstatic.com,
//                   api.dicebear.com, cryptologos.cc). Eklenti arayuzu bunlari kendi
//                   baslatir (2026-10-05 olcumu); govdesiz, kimliksiz okumadir. Kanitta
//                   AYRI listelenir.
//   (Lab'in kendi trafigi uzanti hedefi DEGILDIR, burada izlenmez: spec istisna i.)
//
// Saf modul: `chrome`/tarayici bagimliligi yok; `node run.mjs --selftest` ile sinanir.
import assert from 'node:assert/strict'

export const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
export const STATIC_TYPES = new Set(['Image', 'Font', 'Stylesheet', 'Media'])
export const IGNORED_SCHEMES = new Set([
  'chrome-extension:', 'chrome:', 'data:', 'blob:', 'about:', 'file:', 'devtools:', 'chrome-untrusted:',
])
// Yalnizca durum OKUYAN yontemler. eth_sendRawTransaction bilerek YOK.
export const READ_RPC_METHODS = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_getBalance', 'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  'eth_call', 'eth_estimateGas', 'eth_getLogs', 'eth_syncing', 'web3_clientVersion',
])

export const hostOf = (url) => {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}
export const isWatsHost = (host) => host === 'watswallet.com' || host.endsWith('.watswallet.com')
const isLoopbackHost = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
const normIp = (ip) => String(ip || '').replace(/^\[|\]$/g, '').toLowerCase()

// supported_chains.json'daki EVM zincirlerinin RPC ana makineleri (cuzdanin okudugu uclar).
export function rpcHostsOf(chains) {
  const hosts = new Set()
  for (const c of chains || []) {
    if (!Array.isArray(c.rpc)) continue
    for (const r of c.rpc) {
      const h = hostOf(r && r.url)
      if (h) hosts.add(h)
    }
  }
  return hosts
}

const rpcMethodsOf = (postData) => {
  try {
    const body = JSON.parse(postData)
    return (Array.isArray(body) ? body : [body]).map((b) => String(b && b.method))
  } catch {
    return null
  }
}

// req: { url, method, resourceType, remoteIPAddress, postData }
// opts: { phase: 'hermetic' | 'realrpc', rpcHosts: Set<string> }
// -> { verdict: 'ignored'|'local'|'unconfirmed-local'|'static-asset'|'rpc-read'|'violation', reason }
export function classifyRequest(req, opts) {
  const { phase, rpcHosts } = opts
  const method = String(req.method || 'GET').toUpperCase()
  let scheme = ''
  try { scheme = new URL(req.url).protocol } catch { /* bozuk URL: asagida ihlal */ }
  if (IGNORED_SCHEMES.has(scheme)) return { verdict: 'ignored', reason: `scheme ${scheme}` }

  const host = hostOf(req.url)
  if (isLoopbackHost(host)) return { verdict: 'local', reason: 'loopback host' }

  const ip = normIp(req.remoteIPAddress)
  if (ip && LOCAL_IPS.has(ip)) return { verdict: 'local', reason: `resolved to ${ip}` }

  if (isWatsHost(host)) {
    if (ip) return { verdict: 'violation', reason: `watswallet host resolved to non-local ip ${ip}` }
    return { verdict: 'unconfirmed-local', reason: 'watswallet host, no response seen (host-resolver maps it local)' }
  }

  // Hermetik fazda RPC ana makineleri de yerele eslenir: yerel olmayan IP ihlaldir.
  if (rpcHosts && rpcHosts.has(host) && phase === 'hermetic') {
    if (ip) return { verdict: 'violation', reason: `hermetic phase: rpc host ${host} resolved to non-local ip ${ip}` }
    return { verdict: 'unconfirmed-local', reason: 'rpc host, no response seen (host-resolver maps it local)' }
  }

  if (method === 'GET' && STATIC_TYPES.has(req.resourceType)) {
    return { verdict: 'static-asset', reason: `${req.resourceType} GET` }
  }

  if (rpcHosts && rpcHosts.has(host) && phase === 'realrpc' && method === 'POST') {
    if (!req.postData) return { verdict: 'rpc-read', reason: 'body not captured, rpc host POST' }
    const methods = rpcMethodsOf(req.postData)
    if (!methods) return { verdict: 'violation', reason: 'rpc body is not JSON' }
    const bad = methods.find((m) => !READ_RPC_METHODS.has(m))
    if (bad) return { verdict: 'violation', reason: `non-read rpc method ${bad}` }
    return { verdict: 'rpc-read', reason: methods.join(',') }
  }

  return { verdict: 'violation', reason: `external request (${method} ${req.resourceType || '?'} -> ${host || req.url})` }
}

// Bir CDP oturumundan gelen Network.* olaylarini toplar. origin = 'sw' | 'popup' | 'approval' | ...
export class NetworkGuard {
  constructor({ phase, rpcHosts }) {
    this.phase = phase
    this.rpcHosts = rpcHosts
    this.pending = new Map() // `${sessionId}:${requestId}` -> kayit
    this.records = []
  }

  handle(origin, sessionId, msg) {
    const p = msg.params || {}
    const key = `${sessionId}:${p.requestId}`
    switch (msg.method) {
      case 'Network.requestWillBeSent': {
        if (p.redirectResponse && this.pending.has(key)) {
          // Yonlendirmeyle biten onceki kaydin IP'sini yitirme (yonlendirme yerele mi dise mi gitti).
          const prev = this.pending.get(key)
          prev.remoteIPAddress = p.redirectResponse.remoteIPAddress || prev.remoteIPAddress
          prev.status = p.redirectResponse.status ?? prev.status
          this.#close(key)
        }
        this.pending.set(key, {
          origin,
          url: p.request.url,
          method: p.request.method,
          resourceType: p.type || '',
          postData: p.request.postData || '',
          remoteIPAddress: '',
          status: null,
          failed: null,
        })
        break
      }
      case 'Network.webSocketCreated':
        this.pending.set(key, { origin, url: p.url, method: 'GET', resourceType: 'WebSocket', postData: '', remoteIPAddress: '', status: null, failed: null })
        break
      case 'Network.responseReceived': {
        const r = this.pending.get(key)
        if (r) {
          r.remoteIPAddress = p.response.remoteIPAddress || ''
          r.status = p.response.status
        }
        break
      }
      case 'Network.loadingFailed': {
        const r = this.pending.get(key)
        if (r) r.failed = p.errorText || 'failed'
        break
      }
      default:
        break
    }
  }

  #close(key) {
    const r = this.pending.get(key)
    this.pending.delete(key)
    if (r) this.records.push(r)
  }

  // Kosu sonunda cagrilir: bekleyen her kaydi siniflar.
  report() {
    for (const key of [...this.pending.keys()]) this.#close(key)
    const opts = { phase: this.phase, rpcHosts: this.rpcHosts }
    const entries = this.records.map((r) => ({
      origin: r.origin,
      method: r.method,
      type: r.resourceType,
      url: r.url.length > 200 ? `${r.url.slice(0, 200)}...` : r.url,
      status: r.status,
      ip: r.remoteIPAddress,
      failed: r.failed,
      ...classifyRequest(r, opts),
    }))
    const counts = {}
    for (const e of entries) counts[e.verdict] = (counts[e.verdict] || 0) + 1
    const violations = entries.filter((e) => e.verdict === 'violation')
    const staticHosts = [...new Set(entries.filter((e) => e.verdict === 'static-asset').map((e) => hostOf(e.url)))].sort()
    const rpcHostsSeen = [...new Set(entries.filter((e) => e.verdict === 'rpc-read').map((e) => hostOf(e.url)))].sort()
    return { phase: this.phase, total: entries.length, counts, violations, staticHosts, rpcHostsSeen, entries, ok: violations.length === 0 }
  }
}

// ---------------------------------------------------------------------------
// Kendi kendini sinama (node scripts/walletconnect-qa/run.mjs --selftest)
// ---------------------------------------------------------------------------
export function selfTest() {
  const rpcHosts = new Set(['mainnet.optimism.io', 'polygon.drpc.org'])
  const cls = (req, phase = 'hermetic') => classifyRequest(req, { phase, rpcHosts }).verdict
  const body = (m) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: [] })

  assert.equal(cls({ url: 'chrome-extension://abc/logo.png' }), 'ignored')
  assert.equal(cls({ url: 'data:image/png;base64,AAAA' }), 'ignored')
  assert.equal(cls({ url: 'http://127.0.0.1:5555/news', method: 'GET' }), 'local')
  assert.equal(cls({ url: 'https://bundler.watswallet.com/health', method: 'GET', remoteIPAddress: '127.0.0.1' }), 'local')
  assert.equal(cls({ url: 'https://bundler.watswallet.com/health', method: 'GET', remoteIPAddress: '[::1]' }), 'local')
  assert.equal(cls({ url: 'https://bundler.watswallet.com/health', method: 'GET' }), 'unconfirmed-local')
  assert.equal(cls({ url: 'https://api.extension.watswallet.com/profile', method: 'POST', remoteIPAddress: '34.1.2.3' }), 'violation')
  assert.equal(cls({ url: 'https://fonts.gstatic.com/s/inter.woff2', method: 'GET', resourceType: 'Font', remoteIPAddress: '142.1.1.1' }), 'static-asset')
  assert.equal(cls({ url: 'https://api.dicebear.com/7.x/identicon/svg?seed=0x1', method: 'GET', resourceType: 'Image' }), 'static-asset')
  // statik kategori yalniz GET + gorsel turleri: ayni ana makineye POST/XHR ihlal
  assert.equal(cls({ url: 'https://api.dicebear.com/x', method: 'POST', resourceType: 'XHR' }), 'violation')
  assert.equal(cls({ url: 'https://tracker.example/pixel', method: 'GET', resourceType: 'XHR' }), 'violation')
  // hermetik faz: RPC ana makinesi yerele eslenmis olmali
  assert.equal(cls({ url: 'https://mainnet.optimism.io/', method: 'POST', resourceType: 'Fetch', remoteIPAddress: '127.0.0.1' }), 'local')
  assert.equal(cls({ url: 'https://mainnet.optimism.io/', method: 'POST', resourceType: 'Fetch', remoteIPAddress: '8.47.69.0' }), 'violation')
  // gercek-RPC fazi: yalniz OKUMA yontemleri
  const real = (m, extra = {}) => cls({ url: 'https://mainnet.optimism.io/', method: 'POST', resourceType: 'Fetch', remoteIPAddress: '8.47.69.0', postData: body(m), ...extra }, 'realrpc')
  assert.equal(real('eth_getTransactionReceipt'), 'rpc-read')
  assert.equal(real('eth_sendRawTransaction'), 'violation')
  assert.equal(cls({ url: 'https://unknown-rpc.example/', method: 'POST', resourceType: 'Fetch', postData: body('eth_call') }, 'realrpc'), 'violation')
  assert.equal(real('eth_call', { postData: JSON.stringify([{ method: 'eth_call' }, { method: 'eth_sendRawTransaction' }]) }), 'violation')
  assert.equal(real('eth_call', { postData: 'not json' }), 'violation')

  // NetworkGuard: olay akisi -> rapor
  const g = new NetworkGuard({ phase: 'hermetic', rpcHosts })
  const ev = (method, params) => ({ method, params })
  g.handle('popup', 's1', ev('Network.requestWillBeSent', { requestId: '1', type: 'XHR', request: { url: 'http://127.0.0.1:9/news', method: 'GET' } }))
  g.handle('popup', 's1', ev('Network.requestWillBeSent', { requestId: '2', type: 'Image', request: { url: 'https://cryptologos.cc/a.png', method: 'GET' } }))
  g.handle('popup', 's1', ev('Network.responseReceived', { requestId: '2', response: { remoteIPAddress: '1.2.3.4', status: 200 } }))
  g.handle('sw', 's2', ev('Network.requestWillBeSent', { requestId: '1', type: 'Fetch', request: { url: 'https://bundler.watswallet.com/paymaster/status', method: 'GET' } }))
  g.handle('sw', 's2', ev('Network.responseReceived', { requestId: '1', response: { remoteIPAddress: '127.0.0.1', status: 200 } }))
  let rep = g.report()
  assert.equal(rep.ok, true)
  assert.equal(rep.total, 3)
  assert.deepEqual(rep.staticHosts, ['cryptologos.cc'])
  g.handle('sw', 's2', ev('Network.requestWillBeSent', { requestId: '9', type: 'Fetch', request: { url: 'https://api.extension.watswallet.com/profile', method: 'POST' } }))
  g.handle('sw', 's2', ev('Network.responseReceived', { requestId: '9', response: { remoteIPAddress: '34.9.9.9', status: 200 } }))
  rep = g.report()
  assert.equal(rep.ok, false)
  assert.equal(rep.violations.length, 1)
  return 'backend-guard: tum sinama vakalari gecti'
}
