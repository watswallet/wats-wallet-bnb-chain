// Islem sayaclari (analytics_counts): background.js GERCEKTEN ice aktarilir (harness
// background.cow.test.js ten). Sinanan: ANALYTICS_COUNT ic mesaji (beyaz liste), CoW emri
// icin "yalniz kesin kabul sayilir" kurali ve uc kapi (derleme bayragi, kullanici tercihi,
// gizli hesap). Fazla sayim kabul edilmez, eksik sayim kabul edilir.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'
import supported_chains from './data/supported_chains.json'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const bayrak = vi.hoisted(() => ({ acik: true }))
vi.mock('./utils/featureFlags', async (importOriginal) => ({
  ...(await importOriginal()),
  // Getter: bayrak her import'ta okunmali (resetModules sonrasi).
  get XSTOCKS_ENABLED() { return true },
  // Gizlilik bayragi da her import'ta okunur: importOriginal onbellekte kalir, stubEnv aksi halde ikinci testten sonra etkisiz.
  get PRIVACY_ENABLED() { return import.meta.env.VITE_PRIVACY_ENABLED === 'true' },
  get ANALYTICS_ENABLED() { return bayrak.acik },
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

async function boot({ acik = true, kilitli = false, depo = {} } = {}) {
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
    analytics_enabled: true, // onay modeli: kayit yok = KAPALI; testler kabul edilmis varsayar
    ...depo,
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


const SAYAC = 'analytics_counts'
const sayac = async () => { await flush(); await flush(); return localStore[SAYAC] }

heavyBackgroundTimeouts()

describe('ANALYTICS_COUNT ic mesaji', () => {
  it('walletCreate ve walletImport sayilir', async () => {
    await boot()
    expect(await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletCreate' } })).toEqual({ success: true })
    await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletImport' } })
    await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletImport' } })
    expect(await sayac()).toEqual({ walletCreate: 1, walletImport: 2 })
  })

  it('transfer/swap/bridge mesajla ISTENEMEZ (beyaz liste)', async () => {
    await boot()
    for (const kind of ['transfer', 'swap', 'bridge', 'dapp', undefined]) {
      await send({ type: 'ANALYTICS_COUNT', message: { kind } })
    }
    expect(await sayac()).toBeUndefined()
  })

  it('SAYFADAN (dapp) gelen ANALYTICS_COUNT reddedilir, sayac artmaz', async () => {
    await boot()
    await send({ method: 'ANALYTICS_COUNT', message: { kind: 'walletCreate' } }, { tab: { id: 7 }, url: 'https://evil.example/' })
    await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletCreate' } }, { tab: { id: 7 }, url: 'https://evil.example/' })
    expect(await sayac()).toBeUndefined()
  })

  it('derleme bayragi KAPALIYKEN artmaz', async () => {
    await boot({ acik: false })
    await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletCreate' } })
    expect(await sayac()).toBeUndefined()
  })

  it('karar verilmemisse (analytics_enabled kayitsiz) artmaz', async () => {
    await boot()
    delete localStore.analytics_enabled
    await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletCreate' } })
    expect(await sayac()).toBeUndefined()
  })

  it('kullanici kapatmissa artmaz', async () => {
    await boot({ depo: { analytics_enabled: false } })
    await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletImport' } })
    expect(await sayac()).toBeUndefined()
  })

  // Gizlilik ozelligi ACIK derleme: kapali derlemede arka plan acilista Gizli Hesap'i geri alir
  // (rollbackPrivateAccountOnStart) ve aktif hesap testin ortasinda genel hesaba doner.
  it('gizli hesapta artmaz (bayrakli kayit, kasada eslesen Gizli Hesap kaydi)', async () => {
    vi.stubEnv('VITE_PRIVACY_ENABLED', 'true')
    try {
      const gizli = { key: 'private-0x' + 'cc'.repeat(20), type: 'hd', address: '0x' + 'cc'.repeat(20), derivationPath: "m/44'/60'/0'/1/0", private: true }
      await boot({ depo: {
        active_account: gizli,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }], privateAccount: gizli }],
      } })
      await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletImport' } })
      expect(await sayac()).toBeUndefined()
      expect(localStore.analytics_counts).toBeUndefined()
    } finally { vi.unstubAllEnvs() }
  })

  it('gizli hesapta artmaz (bayragi dusmus kayit: arka planin KIMLIKLE hesapladigi kapi)', async () => {
    vi.stubEnv('VITE_PRIVACY_ENABLED', 'true')
    try {
      const gizli = { key: 'private-0x' + 'cc'.repeat(20), type: 'hd', address: '0x' + 'cc'.repeat(20), derivationPath: "m/44'/60'/0'/1/0", private: true }
      // Kasada Gizli Hesap kaydi VAR; aktif kayitta `private` bayragi YOK (eski kayit): yalniz kimlik kapisi yakalar.
      await boot({ depo: {
        active_account: { ...gizli, private: undefined },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }], privateAccount: gizli }],
      } })
      await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletImport' } })
      expect(await sayac()).toBeUndefined()
    } finally { vi.unstubAllEnvs() }
  })

  it('gizli moddan cikinca (genel hesap) ayni mesaj SAYILIR: kapi yalniz moda bagli', async () => {
    vi.stubEnv('VITE_PRIVACY_ENABLED', 'true')
    try {
      await boot()
      await send({ type: 'ANALYTICS_COUNT', message: { kind: 'walletImport' } })
      expect(await sayac()).toEqual({ walletImport: 1 })
    } finally { vi.unstubAllEnvs() }
  })
})

describe('CoW emri sayimi: yalniz KESIN kabul', () => {
  const emir = (r) => { svc.placeOrder.mockResolvedValue(r) }
  const ver = () => send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })

  it('state open -> swap 1', async () => {
    await boot()
    emir({ success: true, uid: uidOf(1), validTo: 1, state: 'open' })
    await ver()
    expect(await sayac()).toEqual({ swap: 1 })
  })

  it.each([
    ['submitting (belirsiz)', { success: true, uid: uidOf(1), validTo: 1, state: 'submitting' }],
    ['duplicated', { success: true, uid: uidOf(1), validTo: 1, state: 'open', duplicated: true }],
    ['hata', { success: false, code: 'UNKNOWN' }],
    ['durumsuz basari', { success: true, uid: uidOf(1) }],
  ])('%s SAYILMAZ', async (_ad, r) => {
    await boot()
    emir(r)
    await ver()
    expect(await sayac()).toBeUndefined()
  })

  it('COW_APPROVE_EXECUTE (yalniz onay) SAYILMAZ', async () => {
    await boot()
    await send({ type: 'COW_APPROVE_EXECUTE', message: { quoteId: QID } })
    expect(await sayac()).toBeUndefined()
  })

  it('bayrak kapali / kullanici kapatmis: open olsa da artmaz', async () => {
    for (const opts of [{ acik: false }, { depo: { analytics_enabled: false } }]) {
      await boot(opts)
      emir({ success: true, uid: uidOf(1), validTo: 1, state: 'open' })
      await ver()
      expect(await sayac()).toBeUndefined()
    }
  })
})
