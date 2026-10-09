// WalletConnect QA harness'i -- yerel TLS/HTTP taklit sunucusu (spec bolum 12, S4 ve S5 a).
//
// TEK surec, iki dinleyici, ayni islemci:
//   - HTTP  (127.0.0.1:<httpPort>)  : derlemeye `VITE_API_URL` / `VITE_BUNDLER_BASE` olarak verilir
//   - HTTPS (127.0.0.1:<httpsPort>) : Chrome `--host-resolver-rules` ile `*.watswallet.com`
//                                     (ve hermetik fazda RPC ana makineleri) buraya eslenir
//
// Yonlendirme ana makineye gore:
//   RPC ana makinesi (rpc-mock'un bildigi)  -> JSON-RPC taklidi
//   *.watswallet.com / 127.0.0.1 / localhost -> uretim API taklidi (konserve cevaplar)
//   baska ana makine                        -> `pages` tablosundaki yerel sayfalar (kuru kosu dapp'i)
//
// YAZMA KURALI: /profile, /checkUsername, /moonpay ve izinli paymaster yollari DISINDAKI her
// non-GET istek (bilinen SALT-OKUNUR POST'lar haric: `/ton/rpc`, bkz. READ_ONLY_POSTS) 403 doner VE `blockedWrites` listesine yazilir. Gercek bir sunucuya hicbir
// sey ulasmaz; ulasmadigi `NetworkGuard` ile ayrica kanitlanir.
//
// DURUSTLUK KURALI: bilinmeyen yol 404 doner ve `unknownPaths` listesine yazilir; ilk kuru
// kosuda liste okunur, gerekirse konserve tablo genisletilir. Konserve cevaplarin gercek
// backend ile biresbir ayni olmasi DOGRULANMADI (cuzdan ayristirdigi kadari).
import http, { createServer as createHttpServer } from 'node:http'
import https, { createServer as createHttpsServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { keccak256, id as keccakId, Interface } from 'ethers'

const MAX_UINT = (2n ** 256n - 1n).toString()
const ATS_COLLECTOR = '0xE39E4D2EAb51b7a77D2d6bf35b1C0501B7cB75cF'
const EXECUTE = new Interface(['function execute(address dest, uint256 value, bytes func)'])
const hex = (n) => `0x${BigInt(n).toString(16)}`
const WATS = (host) => host === 'watswallet.com' || host.endsWith('.watswallet.com')
const LOOPBACK = (host) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]'

// openssl: PATH'te veya Git for Windows'un yaninda. Yoksa net bir hatayla durur.
export function findOpenssl() {
  const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe']
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' })
      return c
    } catch { /* siradaki aday */ }
  }
  throw new Error('openssl bulunamadi (TLS taklit sertifikasi icin gerekli). Git for Windows ile gelir: C:/Program Files/Git/usr/bin/openssl.exe')
}

// Kendinden imzali sertifika uretir (gecici profil icin; Chrome `--ignore-certificate-errors` ile calisir).
export function ensureTlsCert(dir) {
  mkdirSync(dir, { recursive: true })
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync(findOpenssl(), [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
      '-subj', '/CN=wats-qa-local',
      '-addext', 'subjectAltName=DNS:*.watswallet.com,DNS:watswallet.com,DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } })
  }
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// options:
//   rpcMock        : createRpcMock() ornegi (zorunlu)
//   httpPort       : HTTP dinleyici portu (0 = bos port; sabit port derlemeyi yeniden kullanmak icindir)
//   tls            : { key, cert } (ensureTlsCert)
//   pages          : { [host]: { [path]: { type, body } } }   yerel sayfalar (kuru kosu dapp'i)
//   paymasterFor   : (chainId, crosschain) => adres        ATS paymaster adresi (atsConfig'ten)
//   userOpHashFn   : (userOp, chainId) => 0x..             cuzdanin computeUserOpHash'i (opsiyonel)
//   entryPoint     : EntryPoint adresi (makbuz logu icin)
export async function startStub({ rpcMock, tls, httpPort = 0, pages = {}, paymasterFor = () => `0x${'ab'.repeat(20)}`, userOpHashFn = null, entryPoint = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' }) {
  const requests = [] // { t, scheme, host, method, path, kind }
  const blockedWrites = []
  const unknownPaths = []
  // Uzantinin POST ile yaptigi SALT-OKUNUR vekil okumalari (bilinen: TON RPC vekili `POST /ton/rpc`, @ton/ton TonClient
  // JSON-RPC). Gercek sunucuya HICBIR sey gitmez; konserve HATA cevabi doner (uzanti hata durumunu tolere eder: onceki
  // 403 cevabiyla da kosular gecti). `blockedWrites`'a DUSMEZ: yoksa her kosu KALICI SAHTE bulgu uretirdi. Baska bilinen
  // salt-okunur POST yolu kuru kosuda `blockedWrites`'ta gorunurse buraya eklenir (README TUZAK 12); cevap govdesi
  // gercek vekille birebir ayni olmayabilir (DOGRULANMADI).
  const READ_ONLY_POSTS = new Set(['/ton/rpc'])
  const readOnlyPosts = {} // yol -> sayi
  const sponsorCalls = []
  const userOps = [] // relay'e ulasan UserOp'lar (cozulmus hedef/deger ile)
  let quoteSeq = 0

  const canned = {
    '/news': [],
    '/getImportedTokens': [],
    '/getTokensDataById': [],
    '/getTokenByAddress': [],
    '/getChainTokens': [],
    '/getTokenDataById': {},
    '/getTokenPriceHistory': [],
    '/wallet/reputation': {},
    '/wallet/history': [],
  }

  function statusFor(chainId, sender) {
    const hub = Number(chainId) === 56
    return {
      chainId: Number(chainId), mode: hub ? 'normal' : 'crosschain', ready: true, delegated: true, delegation: 'ours',
      collection: hub ? 'local' : 'src', nextSteps: [], sender,
      budget: { srcBalance: (1000n * 10n ** 18n).toString(), srcAllowance: MAX_UINT, minChargeAts: (10n ** 17n).toString() },
    }
  }

  function quoteFor(body) {
    const chainId = Number(body.chainId)
    const fee = (15n * 10n ** 17n).toString()
    const q = {
      atsFee: fee, atsFeeFormatted: '1.5', validUntil: Math.floor(Date.now() / 1000) + 120, note: 'qa-stub canned quote',
      minChargeAts: (10n ** 17n).toString(), minChargeAtsFormatted: '0.1', atsFeeRefundable: chainId === 56,
      quoteId: `qa-quote-${++quoteSeq}`, quoteExpiresAt: Math.floor(Date.now() / 1000) + 120,
    }
    if (chainId !== 56) {
      q.atsFeeCrosschain = fee
      q.atsFeeCrosschainFormatted = '1.5'
      if (body.sender && body.nonce !== undefined && body.callData) {
        q.feeAuth = {
          domain: { name: 'ATS Crosschain Gas', version: '1', chainId: 56, verifyingContract: ATS_COLLECTOR },
          types: { XcFeeAuth: [
            { name: 'dstChainId', type: 'uint256' }, { name: 'sender', type: 'address' }, { name: 'nonce', type: 'uint256' },
            { name: 'callDataHash', type: 'bytes32' }, { name: 'maxCostCap', type: 'uint256' }, { name: 'atsAmount', type: 'uint256' },
            { name: 'deadline', type: 'uint64' },
          ] },
          primaryType: 'XcFeeAuth',
          message: {
            dstChainId: String(chainId), sender: body.sender, nonce: BigInt(body.nonce).toString(), callDataHash: keccak256(body.callData),
            maxCostCap: (3n * 10n ** 18n).toString(), atsAmount: fee, deadline: Math.floor(Date.now() / 1000) + 120,
          },
        }
      }
    }
    return q
  }

  function sponsorFor(body) {
    const chainId = Number(body.chainId)
    const paymaster = paymasterFor(chainId, chainId !== 56)
    // paymaster(20) | pmVerificationGasLimit(16) | pmPostOpGasLimit(16) = 52 bayt
    const prefix = `${paymaster}${'00'.repeat(15)}${'01'}${'00'.repeat(15)}${'01'}`
    return {
      paymaster, paymasterAndDataPrefix: prefix, paymasterData: `0x${'11'.repeat(65)}`,
      settlementId: keccakId(`${body.sender || ''}:${body.nonce || ''}:${quoteSeq}`), atsFee: (15n * 10n ** 17n).toString(),
    }
  }

  function decodeCall(callData) {
    try {
      const p = EXECUTE.parseTransaction({ data: callData })
      return { to: p.args[0], value: p.args[1].toString(), data: p.args[2] }
    } catch { return null }
  }

  function relayFor(body) {
    const chainId = Number(body.chainId)
    const uo = body.userOp || {}
    const txHash = keccak256(`0x${Buffer.from(JSON.stringify(uo)).toString('hex')}`)
    let userOpHash = null
    try { userOpHash = userOpHashFn ? userOpHashFn(uo, chainId) : null } catch { userOpHash = null }
    userOps.push({ chainId, sender: uo.sender, nonce: uo.nonce, call: decodeCall(uo.callData), callData: uo.callData, paymasterAndData: String(uo.paymasterAndData || '').slice(0, 42), userOpHash, txHash })
    rpcMock.addKnownTx(txHash, chainId, userOpHash ? { entryPoint, userOpHash, sender: uo.sender, paymaster: String(uo.paymasterAndData || '').slice(0, 42) } : null)
    return { success: true, txHash, userOpHash }
  }

  async function onApi(req, res, host, path, query, bodyText) {
    const method = req.method
    // Konserve OKUMA yollari (POST olanlar dahil: /getTokensDataById gibi). Yazma yollari asagida engellenir.
    if (path in canned) return json(res, 200, canned[path])
    if (method === 'GET') {
      if (path === '/health') {
        return json(res, 200, { ok: true, chains: [10, 56, 137, 8453, 42161].map((c) => ({ chainId: c, paymaster: paymasterFor(c, false), bootstrapRemainingToday: 99 })) })
      }
      if (path === '/paymaster/status') return json(res, 200, statusFor(query.get('chainId'), query.get('sender')))
      if (path !== '/favicon.ico') unknownPaths.push(`${method} ${host}${path}`)
      return json(res, 404, { error: 'qa-stub: unknown path' })
    }
    let body = {}
    try { body = bodyText ? JSON.parse(bodyText) : {} } catch { /* gecersiz govde: bos say */ }
    if (method === 'POST' && path === '/paymaster/quote') return json(res, 200, quoteFor(body))
    if (method === 'POST' && path === '/paymaster/sponsor') {
      sponsorCalls.push({ chainId: body.chainId, sender: body.sender, nonce: body.nonce, call: decodeCall(body.callData), quoteId: body.quoteId })
      return json(res, 200, sponsorFor(body))
    }
    if (method === 'POST' && path === '/paymaster/relay') return json(res, 200, relayFor(body))
    if (method === 'POST' && path === '/bundler/auth') return json(res, 200, { token: 'qa-stub-token' })
    if (method === 'POST' && READ_ONLY_POSTS.has(path)) {
      readOnlyPosts[path] = (readOnlyPosts[path] || 0) + 1
      return json(res, 503, { ok: false, error: 'qa-stub: salt-okunur vekil okumasi taklit edilmiyor', code: 503 })
    }
    blockedWrites.push(`${method} ${host}${path}`)
    return json(res, 403, { error: 'qa-stub: write blocked' })
  }

  const route = (scheme, req, res, bodyText) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase()
    const url = new URL(req.url, `${scheme}://${host}`)
    const path = url.pathname
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', '*')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    const rec = { t: Date.now(), scheme, host, method: req.method, path, kind: '' }
    requests.push(rec)
    if (req.method === 'OPTIONS') { rec.kind = 'preflight'; res.writeHead(204); return res.end() }

    const rpcChain = req.method === 'POST' ? rpcMock.chainIdForRequest(host, path) : null
    if (rpcChain !== null && !WATS(host)) {
      rec.kind = 'rpc'
      const out = rpcMock.handleHttp({ chainId: rpcChain, bodyText })
      res.writeHead(out.status, { 'content-type': 'application/json' })
      return res.end(out.body)
    }
    if (WATS(host) || LOOPBACK(host)) {
      rec.kind = 'api'
      return onApi(req, res, host, path, url.searchParams, bodyText)
    }
    const page = pages[host] && pages[host][path]
    if (page && req.method === 'GET') {
      rec.kind = 'page'
      res.writeHead(200, { 'content-type': page.type || 'text/html' })
      return res.end(page.body)
    }
    rec.kind = 'unknown-host'
    if (path !== '/favicon.ico') unknownPaths.push(`${req.method} ${host}${path}`)
    return json(res, 404, { error: 'qa-stub: unknown host' })
  }

  // Bir istekteki beklenmeyen hata sunucuyu ve kosuyu COKERTMEZ; 500 + kayit.
  const handler = (scheme) => (req, res) => {
    const chunks = []
    req.on('data', (d) => chunks.push(d))
    req.on('end', () => {
      try {
        route(scheme, req, res, Buffer.concat(chunks).toString('utf8'))
      } catch (e) {
        unknownPaths.push(`HANDLER-ERROR ${req.method} ${req.url}: ${e.message}`)
        if (!res.headersSent) json(res, 500, { error: `qa-stub internal: ${e.message}` })
      }
    })
  }

  const httpServer = createHttpServer(handler('http'))
  const httpsServer = createHttpsServer({ key: tls.key, cert: tls.cert }, handler('https'))
  await Promise.all([
    new Promise((r) => httpServer.listen(httpPort, '127.0.0.1', r)),
    new Promise((r) => httpsServer.listen(0, '127.0.0.1', r)),
  ])
  return {
    httpPort: httpServer.address().port,
    httpsPort: httpsServer.address().port,
    requests, blockedWrites, unknownPaths, readOnlyPosts, sponsorCalls, userOps,
    summary: () => ({ requests: requests.length, byKind: requests.reduce((a, r) => ({ ...a, [r.kind]: (a[r.kind] || 0) + 1 }), {}), blockedWrites: [...new Set(blockedWrites)], unknownPaths: [...new Set(unknownPaths)], readOnlyPosts: { ...readOnlyPosts }, sponsorCalls: sponsorCalls.length, userOps: userOps.length }),
    close: () => Promise.all([new Promise((r) => httpServer.close(r)), new Promise((r) => httpsServer.close(r))]),
  }
}

// ---------------------------------------------------------------------------
// Kendi kendini sinama
// ---------------------------------------------------------------------------
export async function selfTest({ rpcMock, tmpDir }) {
  const assert = (await import('node:assert/strict')).default
  const tls = ensureTlsCert(tmpDir)
  const stub = await startStub({
    rpcMock, tls,
    pages: { 'dapp.qa-local.test': { '/': { type: 'text/html', body: '<h1>qa</h1>' } } },
    paymasterFor: () => '0x00000000000000000000000000000000000000dd',
  })
  try {
    const call = (scheme, port, host, method, path, body) => new Promise((resolve, reject) => {
      const lib = scheme === 'https' ? https : http
      const opts = { host: '127.0.0.1', port, method, path, headers: { host, 'content-type': 'application/json' }, rejectUnauthorized: false }
      const r = lib.request(opts, (res) => {
        let b = ''
        res.on('data', (d) => { b += d })
        res.on('end', () => resolve({ status: res.statusCode, body: b && b.startsWith('{') || b.startsWith('[') ? JSON.parse(b) : null, text: b }))
      })
      r.on('error', reject)
      if (body) r.write(JSON.stringify(body))
      r.end()
    })
    // API (HTTPS, watswallet ana makinesi)
    const health = await call('https', stub.httpsPort, 'bundler.watswallet.com', 'GET', '/health')
    assert.equal(health.status, 200)
    const st = await call('https', stub.httpsPort, 'bundler.watswallet.com', 'GET', '/paymaster/status?chainId=10&sender=0x1')
    assert.equal(st.body.collection, 'src')
    const q = await call('https', stub.httpsPort, 'bundler.watswallet.com', 'POST', '/paymaster/quote', { chainId: 10, sender: '0x00000000000000000000000000000000000000aa', nonce: '0x0', callData: '0x1234' })
    assert.equal(q.body.feeAuth.primaryType, 'XcFeeAuth')
    assert.equal(q.body.feeAuth.message.callDataHash, keccak256('0x1234'))
    const sp = await call('https', stub.httpsPort, 'bundler.watswallet.com', 'POST', '/paymaster/sponsor', { chainId: 10, sender: '0x00000000000000000000000000000000000000aa' })
    assert.equal((sp.body.paymasterAndDataPrefix.length - 2) / 2, 52)
    // yazma yollari engelli
    const w = await call('https', stub.httpsPort, 'api.extension.watswallet.com', 'POST', '/profile', { username: 'x' })
    assert.equal(w.status, 403)
    // HTTP (derleme env'i) ayni islemci
    const news = await call('http', stub.httpPort, '127.0.0.1', 'GET', '/news')
    assert.deepEqual(news.body, [])
    const unk = await call('http', stub.httpPort, '127.0.0.1', 'GET', '/nope')
    assert.equal(unk.status, 404)
    // salt-okunur POST (TON RPC vekili): 503 konserve hata, blockedWrites'a DUSMEZ, sayilir
    const tonRead = await call('http', stub.httpPort, '127.0.0.1', 'POST', '/ton/rpc', { id: '1', jsonrpc: '2.0', method: 'getAddressInformation', params: {} })
    assert.equal(tonRead.status, 503)
    assert.ok(!stub.summary().blockedWrites.some((x) => x.includes('/ton/rpc')))
    assert.equal(stub.summary().readOnlyPosts['/ton/rpc'], 1)
    // RPC ana makinesi TLS uzerinden
    const rpc = await call('https', stub.httpsPort, 'mainnet.optimism.io', 'POST', '/', { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] })
    assert.equal(rpc.body.result, '0xa')
    // yerel sayfa
    const page = await call('https', stub.httpsPort, 'dapp.qa-local.test', 'GET', '/')
    assert.equal(page.text, '<h1>qa</h1>')
    const s = stub.summary()
    assert.ok(s.blockedWrites.includes('POST api.extension.watswallet.com/profile'))
    assert.ok(s.unknownPaths.includes('GET 127.0.0.1/nope'))
    return 'bundler-stub: tum sinama vakalari gecti'
  } finally {
    await stub.close()
  }
}
