// xStocks Faz 2 -- COW_* ic aksiyonlari, bayrak kapisi ve arka plan baglantisi (Task 17).
//
// background.js GERCEKTEN ice aktarilir (harness background.atsSale.test.js ten). Servis / onay / yoklayici
// fabrikalari casusla degistirilir: burada sinanan DAGITIM katmanidir (kapi, aktif hesap, kasa, kuyruk,
// yanit bicimi). Servislerin ic mantigi kendi test dosyalarinda sinanir.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import supported_chains from './data/supported_chains.json'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './test-utils/kaynakTarama.js'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const bayrak = vi.hoisted(() => ({ acik: true }))
vi.mock('./utils/featureFlags', async (importOriginal) => ({
  ...(await importOriginal()),
  // Getter: vitest fabrika sonucunu resetModules sonrasinda da onbellekte tutar; bayrak her import'ta okunmali.
  get XSTOCKS_ENABLED() {
    return bayrak.acik
  },
}))

const svc = vi.hoisted(() => ({ quote: vi.fn(), placeOrder: vi.fn() }))
const appr = vi.hoisted(() => ({ quote: vi.fn(), execute: vi.fn() }))
const poll = vi.hoisted(() => ({ pollCowOrders: vi.fn() }))
const fabrika = vi.hoisted(() => ({ service: vi.fn(), approve: vi.fn(), poller: vi.fn() }))
vi.mock('./utils/cow/service', () => ({
  createCowService: (...a) => {
    fabrika.service(...a)
    return svc
  },
}))
vi.mock('./utils/cow/approve', async (importOriginal) => ({
  ...(await importOriginal()),
  createCowApprove: (...a) => {
    fabrika.approve(...a)
    return appr
  },
}))
vi.mock('./utils/cow/poller', async (importOriginal) => ({
  ...(await importOriginal()),
  createCowPoller: (...a) => {
    fabrika.poller(...a)
    return poll
  },
}))

// Kasa: gercek BIP-39 ifadesi (hardhat #0); m/44'/60'/0'/0/0 -> HESAP.
const MNEMONIC = 'test test test test test test test test test test test junk'
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => MNEMONIC), decryptSecret: vi.fn() }))

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BASKA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const QID = 'ab'.repeat(16)
const uidOf = (n) => '0x' + n.toString(16).padStart(2, '0').repeat(56)

let messageListener
let sessionStore
let localStore

function installChromeStub() {
  const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
  const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
  globalThis.chrome = {
    alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
    runtime: {
      getURL: () => EXTENSION_ORIGIN,
      onConnect: add('onConnect'),
      onStartup: add('onStartup'),
      onInstalled: add('onInstalled'),
      onMessage: add('onMessage'),
      sendMessage: vi.fn(() => Promise.resolve()),
      lastError: null,
    },
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const wanted = Array.isArray(keys) ? keys : [keys]
          return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
        }),
        set: vi.fn(async (obj) => {
          Object.assign(localStore, obj)
        }),
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => sessionStore),
        set: vi.fn(async (obj) => {
          Object.assign(sessionStore, obj)
        }),
        remove: vi.fn(async () => {}),
      },
    },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
    windows: {
      create: vi.fn(async () => ({ id: 1 })),
      getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
      get: vi.fn(async () => ({ id: 1 })),
      onRemoved: add('onConnect'),
      remove: vi.fn(),
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  }
  return listeners
}

// Isleyici sendResponse'u ASENKRON cagirir (return true). Sozle sarmalanir; kac kez cagrildigi da sayilir.
function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
  const out = { calls: 0 }
  out.promise = new Promise((resolve) => {
    const returned = messageListener(message, sender, (v) => {
      out.calls += 1
      resolve(v)
    })
    if (returned !== true) resolve(undefined)
  })
  return out
}
const send = (message, sender) => callHandler(message, sender).promise

const flush = () => new Promise((r) => setTimeout(r, 0))
const bekle = async (kosul) => {
  for (let i = 0; i < 50 && !kosul(); i++) await flush()
}

async function boot({ acik = true, kilitli = false } = {}) {
  bayrak.acik = acik
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStore = kilitli ? {} : { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
  localStore = {
    active_account: { key: 'k1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0", address: HESAP },
    vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }] }],
    currentNetwork: BSC,
    dapps: {},
    current_transactions: [],
    cow_orders: [],
  }
  const listeners = installChromeStub()
  globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
  await import('./background.js')
  messageListener = listeners.onMessage[0]
  svc.quote.mockResolvedValue({ success: true, quoteId: QID })
  svc.placeOrder.mockResolvedValue({ success: true, uid: uidOf(1) })
  appr.quote.mockResolvedValue({ success: true, quote: { ok: 1 }, resetFirst: false })
  appr.execute.mockResolvedValue({ success: true, confirmed: true, txHash: null })
  poll.pollCowOrders.mockResolvedValue({ polled: 0, results: [] })
}

const COW_ACTIONS = ['COW_QUOTE', 'COW_PLACE_ORDER', 'COW_ORDERS_REFRESH', 'COW_APPROVE_QUOTE', 'COW_APPROVE_EXECUTE']
const quoteMsg = () => ({
  side: 'buy',
  chainId: 56,
  stockAddress: '0x' + '11'.repeat(20),
  payToken: '0x' + '22'.repeat(20),
  amount: '10',
})

describe('bayrak kapisi', () => {
  it.each(COW_ACTIONS)('bayrak kapaliyken %s XSTOCKS_DISABLED doner ve hicbir bagimlilik cagrilmaz', async (type) => {
    await boot({ acik: false })
    const res = await send({ type, message: { quoteId: QID, ...quoteMsg() } })
    expect(res).toEqual({ success: false, code: 'XSTOCKS_DISABLED' })
    expect(fabrika.service).not.toHaveBeenCalled()
    expect(fabrika.approve).not.toHaveBeenCalled()
    expect(fabrika.poller).not.toHaveBeenCalled()
    expect(svc.quote).not.toHaveBeenCalled()
    expect(svc.placeOrder).not.toHaveBeenCalled()
    expect(appr.quote).not.toHaveBeenCalled()
    expect(appr.execute).not.toHaveBeenCalled()
    expect(poll.pollCowOrders).not.toHaveBeenCalled()
  })

  it('bayrak kapaliyken bilinmeyen COW_ adi da XSTOCKS_DISABLED (fail-closed onek)', async () => {
    await boot({ acik: false })
    const res = await send({ type: 'COW_YENI_BIR_SEY', message: {} })
    expect(res).toEqual({ success: false, code: 'XSTOCKS_DISABLED' })
  })

  it('bayrak kapaliyken SWAP_QUOTE etkilenmez (XSTOCKS_DISABLED donmez)', async () => {
    await boot({ acik: false })
    const res = await send({ type: 'SWAP_QUOTE', message: { chainId: 56 } })
    expect(res?.code).not.toBe('XSTOCKS_DISABLED')
  })

  it('bayrak aciksa kapi gecer, tembel fabrika kurulur', async () => {
    await boot()
    expect(fabrika.service).not.toHaveBeenCalled() // modul yuklenirken kurulmaz
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res.success).toBe(true)
    expect(fabrika.service).toHaveBeenCalledTimes(1)
  })
})

describe('koken kapisi', () => {
  it.each(COW_ACTIONS)('sayfa kokenli %s reddedilir (internal-only), servis cagrilmaz', async (type) => {
    await boot()
    const res = await send(
      { type, message: { quoteId: QID, ...quoteMsg() } },
      { tab: { id: 7 }, url: 'https://evil.example/' },
    )
    expect(res).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
    expect(fabrika.service).not.toHaveBeenCalled()
    expect(svc.quote).not.toHaveBeenCalled()
    expect(svc.placeOrder).not.toHaveBeenCalled()
  })

  it('sayfa kokenli istek `method` alanina saklanirsa da reddedilir', async () => {
    await boot()
    const res = await send({ method: 'COW_PLACE_ORDER', message: { quoteId: QID } }, { tab: { id: 7 }, url: 'https://evil.example/' })
    expect(res).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
    expect(svc.placeOrder).not.toHaveBeenCalled()
  })
})

describe('COW_QUOTE', () => {
  it('servise yalniz beste istek alani ve AKTIF hesap adresi gider; ek alanlar atilir', async () => {
    await boot()
    const res = await send({ type: 'COW_QUOTE', message: { ...quoteMsg(), owner: BASKA, account: { address: BASKA }, receiver: BASKA } })
    expect(res).toEqual({ success: true, quoteId: QID })
    expect(svc.quote).toHaveBeenCalledTimes(1)
    const arg = svc.quote.mock.calls[0][0]
    expect(arg).toEqual({ request: quoteMsg(), owner: HESAP })
  })

  it('kasa KILITLIYKEN de calisir (kasa acilmaz)', async () => {
    await boot({ kilitli: true })
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res.success).toBe(true)
    expect(svc.quote).toHaveBeenCalledTimes(1)
  })

  it('EVM tasimayan aktif hesapta UNSUPPORTED_CHAIN, servis cagrilmaz', async () => {
    await boot()
    localStore.active_account = { key: 'k9', type: 'ton', address: 'EQ...' }
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res).toEqual({ success: false, code: 'UNSUPPORTED_CHAIN' })
    expect(svc.quote).not.toHaveBeenCalled()
  })

  it('aktif hesap yoksa UNSUPPORTED_CHAIN', async () => {
    await boot()
    delete localStore.active_account
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res).toEqual({ success: false, code: 'UNSUPPORTED_CHAIN' })
  })

  it('yanit TEK kez gonderilir ve JSON/structuredClone gecer (BigInt toMessageSafe ile dize olur)', async () => {
    await boot()
    svc.quote.mockResolvedValue({ success: true, display: { sell: 10n, nested: [{ a: 5n }] } })
    const h = callHandler({ type: 'COW_QUOTE', message: quoteMsg() })
    const res = await h.promise
    await flush()
    expect(h.calls).toBe(1)
    expect(() => JSON.stringify(res)).not.toThrow()
    expect(structuredClone(res).display.sell).toBe('10')
  })
})

describe('COW_PLACE_ORDER', () => {
  it('mesajdaki account / receiver / tutar YOK SAYILIR: placeOrder yalniz quoteId, activeAddress, getSigner alir', async () => {
    await boot()
    const res = await send({
      type: 'COW_PLACE_ORDER',
      message: { quoteId: QID, account: { address: BASKA, type: 'hd' }, receiver: BASKA, sellAmount: '999999', owner: BASKA },
    })
    expect(res.success).toBe(true)
    expect(svc.placeOrder).toHaveBeenCalledTimes(1)
    const arg = svc.placeOrder.mock.calls[0][0]
    expect(Object.keys(arg).sort()).toEqual(['activeAddress', 'getSigner', 'quoteId'])
    expect(arg.quoteId).toBe(QID)
    expect(arg.activeAddress).toBe(HESAP)
    expect(typeof arg.getSigner).toBe('function')
  })

  it('getSigner aktif hesabin cuzdanini kasadan acar (mesajdaki hesaptan degil)', async () => {
    await boot()
    await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID, account: { address: BASKA } } })
    const { getSigner } = svc.placeOrder.mock.calls[0][0]
    const signer = await getSigner()
    expect(signer.address).toBe(HESAP)
    expect(typeof signer.privateKey).toBe('string')
  })

  it('kasa kilitliyken getSigner WALLET_LOCKED kodlu hata firlatir (ham mesaj degil), emir verilmez', async () => {
    await boot({ kilitli: true })
    await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    const { getSigner } = svc.placeOrder.mock.calls[0][0]
    await expect(getSigner()).rejects.toMatchObject({ code: 'WALLET_LOCKED' })
    const hata = await getSigner().catch((e) => e)
    expect(String(hata.message)).not.toMatch(/password/i)
  })

  it('EVM tasimayan hesapta UNSUPPORTED_CHAIN, placeOrder cagrilmaz', async () => {
    await boot()
    localStore.active_account = { key: 'k9', type: 'ton', address: 'EQ...' }
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual({ success: false, code: 'UNSUPPORTED_CHAIN' })
    expect(svc.placeOrder).not.toHaveBeenCalled()
  })

  it('islem kuyrugunda SERI kosar: ikinci cagri birincinin sozu bitmeden baslamaz (K7)', async () => {
    await boot()
    let birinciyiBitir
    svc.placeOrder.mockImplementationOnce(() => new Promise((r) => { birinciyiBitir = r }))
    svc.placeOrder.mockResolvedValueOnce({ success: true, uid: uidOf(2) })
    const a = callHandler({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    const b = callHandler({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    await bekle(() => svc.placeOrder.mock.calls.length >= 1)
    await flush()
    await flush()
    expect(svc.placeOrder).toHaveBeenCalledTimes(1)
    birinciyiBitir({ success: true, uid: uidOf(1) })
    const [ra, rb] = await Promise.all([a.promise, b.promise])
    expect(svc.placeOrder).toHaveBeenCalledTimes(2)
    expect(ra.uid).toBe(uidOf(1))
    expect(rb.uid).toBe(uidOf(2))
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(1)
  })

  it('servis firlatirsa UNKNOWN doner; console.error govde / hata metni tasimaz', async () => {
    await boot()
    svc.placeOrder.mockRejectedValue(new Error('GIZLI-GOVDE signature=0xdeadbeef postBody'))
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual({ success: false, code: 'UNKNOWN' })
    const loglar = console.error.mock.calls.map((c) => JSON.stringify(c))
    expect(loglar.join('')).not.toMatch(/GIZLI|deadbeef|postBody/)
    expect(console.error).toHaveBeenCalledWith('[cow]', 'unknown')
  })
})

describe('COW_APPROVE_QUOTE / COW_APPROVE_EXECUTE', () => {
  it('COW_APPROVE_QUOTE: yalniz quoteId + aktif adres; kasa acilmaz', async () => {
    await boot({ kilitli: true })
    const res = await send({ type: 'COW_APPROVE_QUOTE', message: { quoteId: QID, spender: BASKA, account: { address: BASKA } } })
    expect(res.success).toBe(true)
    expect(appr.quote).toHaveBeenCalledWith({ quoteId: QID, activeAddress: HESAP })
  })

  it('COW_APPROVE_EXECUTE: quoted iletilir; spender / hesap mesajdan gelmez; getSigner kasadan', async () => {
    await boot()
    const quoted = { fee: '1', sig: 'x' }
    const res = await send({
      type: 'COW_APPROVE_EXECUTE',
      message: { quoteId: QID, quoted, spender: BASKA, to: BASKA, account: { address: BASKA } },
    })
    expect(res.success).toBe(true)
    expect(appr.execute).toHaveBeenCalledTimes(1)
    const arg = appr.execute.mock.calls[0][0]
    expect(Object.keys(arg).sort()).toEqual(['activeAddress', 'getSigner', 'quoteId', 'quoted'])
    expect(arg.activeAddress).toBe(HESAP)
    expect(arg.quoted).toEqual(quoted)
    expect((await arg.getSigner()).address).toBe(HESAP)
  })

  it('COW_APPROVE_EXECUTE kuyrukta seri kosar', async () => {
    await boot()
    let birinciyiBitir
    appr.execute.mockImplementationOnce(() => new Promise((r) => { birinciyiBitir = r }))
    appr.execute.mockResolvedValueOnce({ success: true, txHash: '0x2' })
    const a = callHandler({ type: 'COW_APPROVE_EXECUTE', message: { quoteId: QID, quoted: {} } })
    const b = callHandler({ type: 'COW_APPROVE_EXECUTE', message: { quoteId: QID, quoted: {} } })
    await bekle(() => appr.execute.mock.calls.length >= 1)
    await flush()
    await flush()
    expect(appr.execute).toHaveBeenCalledTimes(1)
    birinciyiBitir({ success: true, txHash: '0x1' })
    await Promise.all([a.promise, b.promise])
    expect(appr.execute).toHaveBeenCalledTimes(2)
  })

  it('onay servisi firlatirsa UNKNOWN', async () => {
    await boot()
    appr.quote.mockRejectedValue(new Error('x'))
    expect(await send({ type: 'COW_APPROVE_QUOTE', message: { quoteId: QID } })).toEqual({ success: false, code: 'UNKNOWN' })
  })
})

describe('COW_ORDERS_REFRESH', () => {
  const kayit = (n, owner, extra = {}) => ({
    uid: uidOf(n),
    owner,
    chainId: 56,
    side: 'buy',
    symbol: 'AAPLx',
    status: 'open',
    sellAmount: '100',
    buyAmount: '5',
    postBody: { signature: '0x' + 'cd'.repeat(65), appData: '{"secret":1}' },
    createdAt: 1000 + n,
    updatedAt: 2000 + n,
    ...extra,
  })

  it('yalniz AKTIF hesabin kayitlari doner; postBody yok; yanit JSON + structuredClone gecer', async () => {
    await boot()
    localStore.cow_orders = [kayit(1, HESAP), kayit(2, BASKA), kayit(3, HESAP.toLowerCase())]
    const res = await send({ type: 'COW_ORDERS_REFRESH', message: {} })
    expect(res.success).toBe(true)
    expect(res.orders.map((o) => o.uid).sort()).toEqual([uidOf(1), uidOf(3)].sort())
    const metin = JSON.stringify(res)
    expect(metin).not.toMatch(/postBody|signature|appData|secret/)
    expect(() => structuredClone(res)).not.toThrow()
    expect(poll.pollCowOrders).toHaveBeenCalledWith({ uids: undefined, withProgress: true })
  })

  it('uids verilirse onlarla suzulur; gecersiz dizeler atilir, en fazla 20 UID poller a gider', async () => {
    await boot()
    const hepsi = Array.from({ length: 25 }, (_, i) => kayit(i + 1, HESAP))
    localStore.cow_orders = hepsi
    const uids = [...hepsi.map((r) => r.uid), 'gecersiz', 5, null, '0x12']
    const res = await send({ type: 'COW_ORDERS_REFRESH', message: { uids } })
    const gecen = poll.pollCowOrders.mock.calls[0][0].uids
    expect(gecen).toHaveLength(20)
    expect(gecen).toEqual(hepsi.slice(0, 20).map((r) => r.uid))
    expect(res.orders).toHaveLength(20)
    expect(res.orders.every((o) => gecen.includes(o.uid))).toBe(true)
  })

  it('uids yoksa bekleyenler + son 20 terminal kayit doner', async () => {
    await boot()
    const terminal = Array.from({ length: 25 }, (_, i) => kayit(i + 1, HESAP, { status: 'fulfilled', updatedAt: 5000 + i }))
    const bekleyen = kayit(40, HESAP, { status: 'submitting' })
    localStore.cow_orders = [...terminal, bekleyen]
    const res = await send({ type: 'COW_ORDERS_REFRESH', message: {} })
    expect(res.orders).toHaveLength(21)
    expect(res.orders.some((o) => o.uid === bekleyen.uid)).toBe(true)
    // en eski terminal kayit disarida kalir
    expect(res.orders.some((o) => o.uid === terminal[0].uid)).toBe(false)
    expect(res.orders.some((o) => o.uid === terminal[24].uid)).toBe(true)
  })

  it('kasa kilitliyken de calisir', async () => {
    await boot({ kilitli: true })
    expect((await send({ type: 'COW_ORDERS_REFRESH', message: {} })).success).toBe(true)
  })

  it('poller firlatirsa UNKNOWN', async () => {
    await boot()
    poll.pollCowOrders.mockRejectedValue(new Error('x'))
    expect(await send({ type: 'COW_ORDERS_REFRESH', message: {} })).toEqual({ success: false, code: 'UNKNOWN' })
  })
})

describe('kaynak taramasi (yorumsuz)', () => {
  const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8'))

  it('sekiz COW_ case i vardir (bes Faz 2 + uc COW_FEE_ Faz 3)', () => {
    expect(kaynak.match(/case "COW_/g)).toHaveLength(8)
  })

  it('COW_ isleyici bolgesinde resolveAccount KULLANILMAZ ve privateKey yalniz atsExecute kapanisinda gecer', () => {
    const bas = kaynak.indexOf('function getCowRuntime')
    const son = kaynak.indexOf('async function atsSaleQuote(')
    expect(bas).toBeGreaterThan(-1)
    expect(son).toBeGreaterThan(bas)
    const bolge = kaynak.slice(bas, son)
    expect(bolge).not.toMatch(/resolveAccount/)
    // privateKey yalniz executeAtsTransfer cagrisinin icinde (`privateKey: signer.privateKey`) gecer
    expect(bolge.match(/privateKey/g)).toHaveLength(2)
    const ae = bolge.indexOf('atsExecute:')
    const cagri = bolge.indexOf('executeAtsTransfer({')
    expect(ae).toBeGreaterThan(-1)
    expect(cagri).toBeGreaterThan(ae)
    expect(bolge.indexOf('privateKey')).toBeGreaterThan(cagri)
    expect(bolge.slice(cagri, cagri + 200)).toMatch(/privateKey: signer\.privateKey/)
  })

  it('islem kuyrugu: COW_PLACE_ORDER ve COW_APPROVE_EXECUTE runCowQueued ile, o da transactionQueue.push ile kosar', () => {
    const govde = (ad) => {
      const bas = kaynak.indexOf(`function ${ad}(`)
      expect(bas).toBeGreaterThan(-1)
      const kalan = kaynak.slice(bas)
      return kalan.slice(0, kalan.search(/\r?\n\}\r?\n/) + 2)
    }
    expect(govde('cowPlaceOrder')).toMatch(/runCowQueued\(/)
    expect(govde('cowApproveExecute')).toMatch(/runCowQueued\(/)
    expect(govde('runCowQueued')).toMatch(/transactionQueue\.push/)
    // teklif / yenileme / onay teklifi kuyruga GIRMEZ
    for (const ad of ['cowQuote', 'cowOrdersRefresh', 'cowApproveQuote']) expect(govde(ad)).not.toMatch(/runCowQueued|transactionQueue/)
  })
})
