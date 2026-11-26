// Ilk alim kapisi -- CoW yuzeyi, arka plan baglantisi (Task 29, spec 5.4-5.6, 5.9, 11.3, K31).
//
// KOK NEDEN / KAPATILAN HATA: getCowRuntime kapiyi servis ve onay katmanlarina baglamazsa (a) varsayilan "Al'i reddet" kapisi
// her kullaniciyi kilitler ya da (b) kapi hic sorulmaz ve engelli kullanici CoW'a ulasir; kapi COW_FEE_* eylemlerine de girerse
// (c) engelli ve borclu kullanici borcunu odeyemez. Karar hesaba bagli degildir (K39, G24): kapiya owner gitmez ve kapi ACCOUNT_CHANGED
// uretmez; imza / sahip esitligini dort bagimsiz denetim yapar (checkQuote, service, approve, cowFeeApproveChange). Bu dosya GERCEK background.js, GERCEK
// createCowService / createCowApprove ve GERCEK kapi (getStockGate) ile sinar; yalniz ag siniri sahtedir.
// Pozitif bekciler: her "reddedildi" iddiasinin yaninda ayni yolun kapidan GERCEKTEN gectigi (sahte referans -> REFERENCE_MISSING
// kilidi / ATS teklifi) bir test var; Sat ve COW_FEE_* engelli kullanicida da calisir.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HDNodeWallet } from 'ethers'
import supported_chains from './data/supported_chains.json'
import { XSTOCKS } from './data/xStocks'
import { COUNTRY_CODES } from './data/countryCodes'
import { BUNDLED_ELIGIBILITY_RULES } from './data/eligibilityRules'
import { effectiveBlocked } from './utils/stockGate/rules'
import { PAY_TOKENS } from './utils/cow/config'
import { QUOTE_KEY_PREFIX } from './utils/cow/quoteStore'
import { newOrderRecord } from './utils/cow/orders'
import { blokGovdesi, yorumsuz } from './test-utils/kaynakTarama'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// vi.mock fabrikalari dosyanin en ustune tasinir: paylasilan casuslar vi.hoisted ile ONCE kurulmali.
const h = vi.hoisted(() => ({
  MNEMONIC: 'test test test test test test test test test test test junk',
  quoteAtsTransfer: vi.fn(),
  executeAtsTransfer: vi.fn(),
  api: { quote: vi.fn(), postOrder: vi.fn(), getOrder: vi.fn(), getOrderStatus: vi.fn(), getTrades: vi.fn() },
  chain: { readDecimals: vi.fn(), readBalance: vi.fn(), readAllowance: vi.fn(), readPermitInfo: vi.fn() },
  reference: { getReference: vi.fn(), getTrading: vi.fn() },
  fee: {
    settler: { settleCowFees: vi.fn(), approveFeeChange: vi.fn() },
    claimer: { claimRefunds: vi.fn() },
    statusFor: vi.fn(),
    prepare: vi.fn(),
  },
}))

// Ag siniri sahte; servis / onay / kapi GERCEK.
vi.mock('./utils/cow/api', async (importOriginal) => ({ ...(await importOriginal()), createCowApi: () => h.api }))
vi.mock('./utils/cow/chain', async (importOriginal) => ({ ...(await importOriginal()), createCowChain: () => h.chain }))
vi.mock('./utils/cow/reference', async (importOriginal) => ({ ...(await importOriginal()), createCowReference: () => h.reference }))
vi.mock('./utils/cow/feeRuntime', async (importOriginal) => ({ ...(await importOriginal()), createFeeRuntime: () => h.fee }))
vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
  ...(await importOriginal()),
  quoteAtsTransfer: (...a) => h.quoteAtsTransfer(...a),
  executeAtsTransfer: (...a) => h.executeAtsTransfer(...a),
}))
// Kasa: gercek BIP-39 ifadesi; kapi reddettiyse HICBIR yolda acilmamali.
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => h.MNEMONIC), decryptSecret: vi.fn() }))

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const BSC = supported_chains.find((c) => c.chainId === 56)
const BUNDLED = BUNDLED_ELIGIBILITY_RULES
// G2: katalog / ulke / odeme tokeni kural tablosundan ve katalogdan TURETILIR; sabit hisse sayisi ya da sirasi varsayilmaz.
const XS = XSTOCKS.find((s) => s.chains.includes(56))
const PAY = PAY_TOKENS[56][0].address
const TANIMSIZ = '0x' + '11'.repeat(20)
const QID = 'ab'.repeat(16)
const UID = '0x' + 'ab'.repeat(56)
const TEMIZ_ULKE = COUNTRY_CODES.find(
  (c) => !effectiveBlocked(BUNDLED, 'xstocks').has(c) && !BUNDLED.issuers.xstocks.warn.includes(c),
)
const ENGELLI_ULKE = BUNDLED.issuers.xstocks.blocked[0]
const ACIK = {
  openNow: true,
  currentPeriod: 'market',
  nextChangeAt: '2026-10-15T20:00:00.000Z',
  limitsPerPeriod: { market: { maxOrderFiatValue: '100000' } },
}
const sonrakiSurum = (v) => {
  const [gun, n] = v.split('.')
  return `${gun}.${Number(n) + 1}`
}

const root = HDNodeWallet.fromPhrase(h.MNEMONIC, null, 'm')
const walletAt = (i) => root.derivePath(`m/44'/60'/0'/0/${i}`)
const accountAt = (i, key) => ({ key, type: 'hd', index: i, derivationPath: `m/44'/60'/0'/0/${i}`, address: walletAt(i).address })
const ACC_A = accountAt(0, 'k1')
const ACC_B = accountAt(1, 'k2')

let messageListener
let alarmListener
let sessionStore
let localStore
let eligibilityBody
let afterActiveRead // null | () => void: 'active_account' ILK okunduktan SONRA bir kez calisir (G20 yarisi)
const fetchSpy = vi.fn()

function makeArea(getStore, { onRead } = {}) {
  const pick = (store, keys) => {
    if (keys === undefined || keys === null) return { ...store }
    if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {}
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))
    return Object.fromEntries(Object.entries(keys).map(([k, dflt]) => [k, k in store ? store[k] : dflt]))
  }
  return {
    get: vi.fn(async (keys) => {
      const out = structuredClone(pick(getStore(), keys))
      if (onRead) onRead(out)
      return out
    }),
    set: vi.fn(async (obj) => {
      Object.assign(getStore(), structuredClone(obj))
    }),
    remove: vi.fn(async (keys) => {
      for (const k of [].concat(keys)) delete getStore()[k]
    }),
  }
}

function installChromeStub() {
  const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
  const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
  globalThis.chrome = {
    alarms: { get: vi.fn(async () => ({ name: 'checkInactivity' })), create: vi.fn(), onAlarm: add('onAlarm') },
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
      local: makeArea(() => localStore, {
        onRead: (out) => {
          if (afterActiveRead && 'active_account' in out) {
            const f = afterActiveRead
            afterActiveRead = null
            f()
          }
        },
      }),
      session: makeArea(() => sessionStore),
    },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
    windows: {
      create: vi.fn(async () => ({ id: 1 })),
      getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
      get: vi.fn(async () => ({ id: 1 })),
      getCurrent: vi.fn(async () => ({ id: 1 })),
      onRemoved: add('onConnect'),
      remove: vi.fn(),
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setPopup: vi.fn(async () => {}) },
  }
  return listeners
}

// Isleyici sendResponse'u ASENKRON cagirir (return true); sozle sarmalanir.
function send(message, sender = { url: EXTENSION_ORIGIN }) {
  return new Promise((resolve) => {
    const returned = messageListener(message, sender, resolve)
    if (returned !== true) resolve(undefined)
  })
}

// vi.resetModules sonrasi background.js in gordugu kasa casusu: testin tepesinde import edilen ornek bayat olabilir
const kasa = async () => (await import('./utils/crypto-utils')).unlockVault
const eligibilityCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/eligibility'))
const otherFetches = () => fetchSpy.mock.calls.filter(([u]) => !String(u).endsWith('/eligibility'))
const touched = (key) => globalThis.chrome.storage.local.get.mock.calls.some(([k]) => String(JSON.stringify(k)).includes(key))

// ip: sunucunun bildirdigi baglanti ulkesi (varsayilan: xStocks icin engelsiz ve uyarisiz temiz ulke; null = ulke bilinmiyor);
// oldur: buyEnabled=false (acil durdurma, daha yuksek surumle).
async function boot({ ip = TEMIZ_ULKE, oldur = false } = {}) {
  vi.resetModules()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  afterActiveRead = null
  const rules = structuredClone(BUNDLED)
  if (oldur) {
    rules.version = sonrakiSurum(BUNDLED.version)
    rules.issuers.xstocks.buyEnabled = false
  }
  eligibilityBody = { success: true, version: rules.version, ipCountry: ip, rules }
  fetchSpy.mockImplementation(async (url) => {
    if (String(url).endsWith('/eligibility')) {
      const text = JSON.stringify(eligibilityBody)
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }
    }
    return { ok: false, status: 503, text: async () => '', json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchSpy)
  h.chain.readDecimals.mockResolvedValue(18)
  h.chain.readBalance.mockResolvedValue(10n ** 30n)
  h.chain.readAllowance.mockResolvedValue(0n)
  h.chain.readPermitInfo.mockResolvedValue({ ok: false })
  // referans yok: kapidan gecen Al teklifi / emri dogal olarak REFERENCE_MISSING ile durur (kapinin GECTIGININ kaniti)
  h.reference.getReference.mockResolvedValue({ reference: null })
  h.reference.getTrading.mockResolvedValue({ ok: true, trading: ACIK })
  h.quoteAtsTransfer.mockResolvedValue({ fee: '1' })
  h.fee.statusFor.mockResolvedValue({ fees: [], debt: false })
  h.fee.settler.settleCowFees.mockResolvedValue({ outcome: 'NONE' })
  h.fee.settler.approveFeeChange.mockResolvedValue({ outcome: 'PENDING', code: 'APPROVED' })
  sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
  localStore = {
    active_account: structuredClone(ACC_A),
    vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: ACC_A.address }, { key: 'k2', address: ACC_B.address }] }],
    currentNetwork: BSC,
    current_transactions: [],
    dapps: {},
    cow_orders: [],
  }
  const listeners = installChromeStub()
  globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
  await import('./background.js')
  messageListener = listeners.onMessage[0]
  alarmListener = listeners.onAlarm[0] // ilk onAlarm dinleyicisi: checkInactivity (kilit + CoW yoklamasi); ikincisi analytics ping
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const quoteMsg = (over = {}) => ({ side: 'buy', chainId: 56, stockAddress: XS.address, payToken: PAY, amount: '10', ...over })

// Teklif kaydi (quoteInner'in yazdigi sekil). Varsayilan: Al, emir penceresi (approval none).
function kayit(over = {}) {
  const t = Date.now()
  return {
    quoteId: QID,
    createdAt: t,
    expiresAt: t + 60_000,
    approveUntil: t + 300_000,
    owner: ACC_A.address,
    chainId: 56,
    side: 'buy',
    symbol: XS.symbol,
    stockAddress: XS.address,
    payToken: PAY,
    sellToken: PAY,
    buyToken: XS.address,
    sellAmount: '10000000000000000000',
    networkFee: '0',
    expectedBuy: '5000000000000000000',
    minBuy: '4900000000000000000',
    sellDecimals: 18,
    buyDecimals: 18,
    protocolFeeBps: 2,
    fees: { network: '1', protocol: '1', partner: '1' },
    cowQuoteId: 7,
    verified: true,
    appData: { json: '{}', hash: '0x' + '00'.repeat(32) },
    approval: { mode: 'none', allowance: '1' },
    locked: false,
    lockReason: null,
    consumed: false,
    display: {},
    reference: null,
    ...over,
  }
}
const ONAY = { approval: { mode: 'onchain', allowance: '0' } } // onay penceresi icin kayit
const SAT = { side: 'sell', sellToken: XS.address, buyToken: PAY }
const koy = (rec) => {
  sessionStore[QUOTE_KEY_PREFIX + rec.quoteId] = rec
}
const saklanan = () => sessionStore[QUOTE_KEY_PREFIX + QID]
const borclu = () => ({
  uid: UID,
  owner: ACC_A.address,
  chainId: 56,
  status: 'fulfilled',
  createdAt: 1000,
  fee: { mode: 'ats', state: 'owed', quotedAtsRaw: '1' },
})

const KILIT = (gateReason) => ({
  success: true,
  locked: true,
  lockReason: 'STOCK_GATE',
  gateReason,
  quoteId: null,
  display: null,
  approval: null,
  reference: null,
  notice: null,
  warnings: [],
})
const RED = (gateReason) => ({ success: false, code: 'STOCK_GATE', gateReason })
const REFERANS_YOK = { success: false, code: 'REFERENCE_MISSING' } // kapidan gecen emrin duraklama noktasi

describe('fikstur bekcisi', () => {
  it('hisse BSC katalogunda; temiz ulke xStocks icin engelsiz ve uyarisiz; engelli ulke xStocks tablosunda; hesaplar farkli', () => {
    expect(XS).toBeTruthy()
    expect(TEMIZ_ULKE).toMatch(/^[A-Z]{2}$/)
    expect(effectiveBlocked(BUNDLED, 'xstocks').has(TEMIZ_ULKE)).toBe(false)
    expect(BUNDLED.issuers.xstocks.warn).not.toContain(TEMIZ_ULKE)
    expect(BUNDLED.issuers.xstocks.blocked).toContain(ENGELLI_ULKE)
    expect(PAY).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(ACC_A.address).not.toBe(ACC_B.address)
  })

  it('pozitif bekci: okuma kancasi aktif hesabi gercekten degistirir (G20 testlerinin vakumda gecmemesi icin)', async () => {
    await boot()
    afterActiveRead = () => {
      localStore.active_account = structuredClone(ACC_B)
    }
    expect((await globalThis.chrome.storage.local.get('active_account')).active_account.key).toBe('k1')
    expect((await globalThis.chrome.storage.local.get('active_account')).active_account.key).toBe('k2')
  })
})

describe('COW_QUOTE (spec 5.4, K31): kapi borc kilidinden ve her ag okumasindan ONCE', () => {
  it('engelli baglanti ulkesi + Al: STOCK_GATE kilidi; api, zincir, referans ve ucret hazirligi HIC cagrilmaz; yalniz /eligibility istegi atilir', async () => {
    await boot({ ip: ENGELLI_ULKE })
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res).toEqual(KILIT('IP_COUNTRY_ISSUER'))
    expect(h.api.quote).not.toHaveBeenCalled()
    for (const fn of Object.values(h.chain)) expect(fn).not.toHaveBeenCalled()
    expect(h.reference.getReference).not.toHaveBeenCalled()
    expect(h.reference.getTrading).not.toHaveBeenCalled()
    expect(h.fee.prepare).not.toHaveBeenCalled()
    expect(eligibilityCalls()).toHaveLength(1)
    expect(otherFetches()).toEqual([])
  })

  it('pozitif bekci: uygun kullanici Al kapidan GECER (REFERENCE_MISSING kilidi, getReference cagrilir); /eligibility bir kez', async () => {
    await boot()
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res).toMatchObject({ success: true, locked: true, lockReason: 'REFERENCE_MISSING', quoteId: null })
    expect(h.reference.getReference).toHaveBeenCalledTimes(1)
    expect(eligibilityCalls()).toHaveLength(1)
  })

  it('ulke bilinmiyor (ipCountry null) -> COUNTRY_UNKNOWN kilidi (K33); ag cagrisi yok', async () => {
    await boot({ ip: null })
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res).toEqual(KILIT('COUNTRY_UNKNOWN'))
    expect(h.reference.getReference).not.toHaveBeenCalled()
  })

  it('acil durdurma (buyEnabled=false, daha yuksek surum) -> KILL_SWITCH kilidi', async () => {
    await boot({ oldur: true })
    expect(await send({ type: 'COW_QUOTE', message: quoteMsg() })).toEqual(KILIT('KILL_SWITCH'))
  })

  it('sira (K31): engelli + Faz 3 borclu -> STOCK_GATE; kapi acikken ayni borclu FEE_DEBT alir (borc kilidi kapinin ARKASINDA calisir)', async () => {
    await boot({ ip: ENGELLI_ULKE })
    localStore.cow_orders = [borclu()]
    expect(await send({ type: 'COW_QUOTE', message: quoteMsg() })).toEqual(KILIT('IP_COUNTRY_ISSUER'))
    expect(h.fee.prepare).not.toHaveBeenCalled()
    await boot()
    localStore.cow_orders = [borclu()]
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(res).toMatchObject({ success: true, locked: true, lockReason: 'FEE_DEBT' })
    expect(res.feeDebtUids).toEqual([UID])
  })

  it('Sat kapiya HIC sorulmaz: engelli baglanti ulkesinde de teklif akar; /eligibility istegi ve kural onbellegi okumasi YOK', async () => {
    await boot({ ip: ENGELLI_ULKE })
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg({ side: 'sell' }) })
    expect(res).toMatchObject({ success: true, locked: true, lockReason: 'REFERENCE_MISSING' })
    expect(h.reference.getReference).toHaveBeenCalledTimes(1)
    expect(eligibilityCalls()).toHaveLength(0)
    expect(touched('stock_gate_rules_cache')).toBe(false)
  })

  it('katalog disi hisse adresi quoteInner da UNSUPPORTED_TOKEN ile durur: kapiya HIC ulasmaz', async () => {
    await boot({ ip: ENGELLI_ULKE })
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg({ stockAddress: TANIMSIZ }) })
    expect(res).toMatchObject({ success: false, code: 'UNSUPPORTED_TOKEN' })
    expect(eligibilityCalls()).toHaveLength(0)
  })

  it('G24: aktif hesap kapi sirasinda degisse de kapi ACCOUNT_CHANGED URETMEZ (karar hesaba bagli degil); teklif akar', async () => {
    await boot()
    afterActiveRead = () => {
      localStore.active_account = structuredClone(ACC_B)
    }
    const res = await send({ type: 'COW_QUOTE', message: quoteMsg() })
    expect(afterActiveRead).toBeNull() // kanca gercekten tetiklendi (vakumda gecmez)
    expect(res.code).not.toBe('ACCOUNT_CHANGED')
    expect(res).toMatchObject({ success: true, locked: true, lockReason: 'REFERENCE_MISSING' })
    expect(h.reference.getReference).toHaveBeenCalledTimes(1)
  })
})

describe('COW_PLACE_ORDER (spec 5.6, K31): teklifi YAKMADAN peek + kapi', () => {
  it('Al kaydi + engelli: STOCK_GATE ve teklif TUKETILMEMIS (consumed:false); kasa acilmaz, POST yok', async () => {
    await boot({ ip: ENGELLI_ULKE })
    koy(kayit())
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual(RED('IP_COUNTRY_ISSUER'))
    expect(saklanan().consumed).toBe(false)
    expect(await kasa()).not.toHaveBeenCalled()
    expect(h.api.postOrder).not.toHaveBeenCalled()
  })

  it('pozitif bekci: Al kaydi + uygun kullanici kapidan GECER: claim edilir (consumed:true), emir tradeGate te REFERENCE_MISSING ile durur', async () => {
    await boot()
    koy(kayit())
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual(REFERANS_YOK)
    expect(saklanan().consumed).toBe(true)
    expect(eligibilityCalls()).toHaveLength(1)
  })

  it('Sat kaydi: engelli baglanti ulkesinde de acik (claim edilir); /eligibility istegi YOK', async () => {
    await boot({ ip: ENGELLI_ULKE })
    koy(kayit(SAT))
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual(REFERANS_YOK)
    expect(saklanan().consumed).toBe(true)
    expect(eligibilityCalls()).toHaveLength(0)
  })

  it('kayit yok: kapi atlanir, claim QUOTE_NOT_FOUND verir (kapi kayitsiz karar uydurmaz)', async () => {
    await boot({ ip: ENGELLI_ULKE })
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual({ success: false, code: 'QUOTE_NOT_FOUND' })
    expect(eligibilityCalls()).toHaveLength(0)
  })

  it('katalog disi hisse adresi tasiyan Al kaydi (ok:true, stock:false) kapidan GECMEZ: CHECK_FAILED; teklif tuketilmez; /eligibility istegi yok', async () => {
    await boot()
    koy(kayit({ stockAddress: TANIMSIZ, buyToken: TANIMSIZ }))
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual(RED('CHECK_FAILED'))
    expect(saklanan().consumed).toBe(false)
    expect(eligibilityCalls()).toHaveLength(0)
  })

  it('G24: bagimsiz ACCOUNT_CHANGED (checkQuote): kayit sahibi A, aktif hesap B -> kapi hesapsiz gecer, claim ACCOUNT_CHANGED verir ve teklifi TUKETMEZ (consumed:false); kasa acilmaz, POST yok', async () => {
    await boot()
    koy(kayit())
    localStore.active_account = structuredClone(ACC_B)
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })
    expect(res).toEqual({ success: false, code: 'ACCOUNT_CHANGED' })
    expect(eligibilityCalls()).toHaveLength(1) // kapi GERCEKTEN soruldu ve gecti: ret kapidan degil checkQuote tan
    expect(saklanan().consumed).toBe(false)
    expect(await kasa()).not.toHaveBeenCalled()
    expect(h.api.postOrder).not.toHaveBeenCalled()
  })

  it('owner karsilastirmasi (bagimsiz denetim, kapi degil) buyuk / kucuk harf duyarsiz: kucuk harfli aktif hesap + checksum kayit ve checksum aktif hesap + kucuk harfli kayit ikisi de gecer', async () => {
    await boot()
    localStore.active_account = { ...structuredClone(ACC_A), address: ACC_A.address.toLowerCase() }
    koy(kayit())
    expect(await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })).toEqual(REFERANS_YOK)
    await boot()
    koy(kayit({ owner: ACC_A.address.toLowerCase() }))
    expect(await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID } })).toEqual(REFERANS_YOK)
  })

  it('istekteki baska alanlar (side, stockAddress, chainId) YOK SAYILIR: karar kayittan gelir', async () => {
    await boot({ ip: ENGELLI_ULKE })
    koy(kayit())
    const res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId: QID, side: 'sell', stockAddress: TANIMSIZ, chainId: 1 } })
    expect(res).toEqual(RED('IP_COUNTRY_ISSUER'))
  })
})

describe('COW_APPROVE_QUOTE / COW_APPROVE_EXECUTE (spec 5.5, K31): karar KAYITTAN gelir', () => {
  it.each([
    ['COW_APPROVE_QUOTE', { quoteId: QID }],
    ['COW_APPROVE_EXECUTE', { quoteId: QID, quoted: {} }],
  ])('%s: Al kaydi + engelli -> STOCK_GATE; allowance okumasi, ATS teklifi / yurutme ve kasa acilmasi YOK', async (type, message) => {
    await boot({ ip: ENGELLI_ULKE })
    koy(kayit(ONAY))
    const res = await send({ type, message })
    expect(res).toEqual(RED('IP_COUNTRY_ISSUER'))
    expect(h.chain.readAllowance).not.toHaveBeenCalled()
    expect(h.quoteAtsTransfer).not.toHaveBeenCalled()
    expect(h.executeAtsTransfer).not.toHaveBeenCalled()
    expect(await kasa()).not.toHaveBeenCalled()
  })

  it.each([
    ['COW_APPROVE_QUOTE', { quoteId: QID }, () => h.quoteAtsTransfer],
    ['COW_APPROVE_EXECUTE', { quoteId: QID, quoted: {} }, () => h.executeAtsTransfer],
  ])('pozitif bekci (%s): Al kaydi + uygun kullanici kapidan GECER ve ATS adimina ulasir (EXECUTE icin de; yalniz QUOTE degil)', async (type, message, adim) => {
    await boot()
    koy(kayit(ONAY))
    const res = await send({ type, message })
    expect(res.code).not.toBe('STOCK_GATE')
    expect(adim()).toHaveBeenCalledTimes(1)
    expect(eligibilityCalls()).toHaveLength(1)
    if (type === 'COW_APPROVE_QUOTE') expect(res).toMatchObject({ success: true, quote: { fee: '1' }, resetFirst: false })
  })

  it('Sat kaydi (hisse onayi): engelli baglanti ulkesinde de acik; /eligibility istegi YOK', async () => {
    await boot({ ip: ENGELLI_ULKE })
    koy(kayit({ ...ONAY, ...SAT }))
    const res = await send({ type: 'COW_APPROVE_QUOTE', message: { quoteId: QID } })
    expect(res).toMatchObject({ success: true })
    expect(h.quoteAtsTransfer).toHaveBeenCalledTimes(1)
    expect(eligibilityCalls()).toHaveLength(0)
  })

  it('istekteki side / stockAddress / chainId YOK SAYILIR: Al kaydina Sat etiketi takmak kapiyi acmaz', async () => {
    await boot({ ip: ENGELLI_ULKE })
    koy(kayit(ONAY))
    const res = await send({ type: 'COW_APPROVE_QUOTE', message: { quoteId: QID, side: 'sell', stockAddress: TANIMSIZ, chainId: 1 } })
    expect(res).toEqual(RED('IP_COUNTRY_ISSUER'))
  })

  it('katalog disi hisse adresi tasiyan Al kaydi kapidan GECMEZ: CHECK_FAILED; allowance okunmaz', async () => {
    await boot()
    koy(kayit({ ...ONAY, stockAddress: TANIMSIZ, buyToken: TANIMSIZ }))
    const res = await send({ type: 'COW_APPROVE_QUOTE', message: { quoteId: QID } })
    expect(res).toEqual(RED('CHECK_FAILED'))
    expect(h.chain.readAllowance).not.toHaveBeenCalled()
  })

  it.each([
    ['COW_APPROVE_QUOTE', { quoteId: QID }],
    ['COW_APPROVE_EXECUTE', { quoteId: QID, quoted: {} }],
  ])('G24: bagimsiz ACCOUNT_CHANGED (%s, peekQuoteForApprove): kayit sahibi A, aktif hesap B -> kapidan ONCE ACCOUNT_CHANGED; teklif tuketilmez; ATS teklifi / yurutme ve kasa acilmasi YOK', async (type, message) => {
    await boot()
    koy(kayit(ONAY))
    localStore.active_account = structuredClone(ACC_B)
    const res = await send({ type, message })
    expect(res).toEqual({ success: false, code: 'ACCOUNT_CHANGED' })
    expect(saklanan().consumed).toBe(false)
    expect(h.chain.readAllowance).not.toHaveBeenCalled()
    expect(h.quoteAtsTransfer).not.toHaveBeenCalled()
    expect(h.executeAtsTransfer).not.toHaveBeenCalled()
    expect(await kasa()).not.toHaveBeenCalled()
  })
})

describe('COW_FEE_* kapi DISINDA (K31): engelli ve borclu kullanici borcunu odeyebilir', () => {
  const uidMsg = { uid: UID }

  it.each([
    ['COW_FEE_STATUS', {}],
    ['COW_FEE_PAY', {}],
    ['COW_FEE_APPROVE_CHANGE', uidMsg],
  ])('%s: engelli baglanti ulkesinde de calisir; /eligibility istegi ve kural onbellegi okumasi YOK', async (type, message) => {
    await boot({ ip: ENGELLI_ULKE })
    const res = await send({ type, message })
    expect(res.success).toBe(true)
    expect(res.code).toBeUndefined()
    expect(eligibilityCalls()).toHaveLength(0)
    expect(touched('stock_gate_rules_cache')).toBe(false)
  })

  it('islevsel bekci: ucret eylemleri gercekten feeRuntime a ulasir (STATUS statusFor, PAY ve APPROVE_CHANGE settleCowFees)', async () => {
    await boot({ ip: ENGELLI_ULKE })
    await send({ type: 'COW_FEE_STATUS', message: {} })
    expect(h.fee.statusFor).toHaveBeenCalledTimes(1)
    await send({ type: 'COW_FEE_PAY', message: {} })
    await send({ type: 'COW_FEE_APPROVE_CHANGE', message: uidMsg })
    expect(h.fee.settler.settleCowFees).toHaveBeenCalledTimes(2)
    expect(h.fee.settler.approveFeeChange).toHaveBeenCalledTimes(1)
  })
})

describe('K14 poller muafiyeti (davranis): imzali emrin yeniden gonderimi kapiya BAGLI DEGIL', () => {
  // Zaten imzalanmis ve write-ahead ile kaydedilmis bir emrin devami (yeniden POST) kapi karari DEGILDIR; kapi yalniz yeni
  // Al niyetini keser. Kaynak kilidi (Task 31) yapiyi sabitler, bu test davranisi: poller'a ileride kapi eklenirse ya da
  // alarm yoluna bir kapi sorgusu girerse engelli kullanicinin imzali emri yetim kalir.
  const submittingKayit = () => ({
    ...newOrderRecord({
      uid: UID,
      chainId: 56,
      owner: ACC_A.address,
      side: 'buy',
      symbol: XS.symbol,
      sellToken: PAY,
      buyToken: XS.address,
      sellAmount: '10000000000000000000',
      buyAmount: '4900000000000000000',
      expectedBuy: '5000000000000000000',
      validTo: Math.floor(Date.now() / 1000) + 1800,
      createdAt: Date.now() - 120_000, // SUBMIT_GRACE_MS (60 sn) dolmus: yoklama GET ile baslar
      approvalMode: 'none',
      postBody: { signature: '0x' + 'aa'.repeat(65) },
    }),
    status: 'submitting',
  })
  const tikle = () => alarmListener({ name: 'checkInactivity' })
  const KOSULLAR = [
    ['engelli baglanti ulkesi', { ip: ENGELLI_ULKE }],
    ['acil durdurma (buyEnabled=false)', { oldur: true }],
    ['ulke bilinmiyor', { ip: null }],
  ]

  it('pozitif bekci: KAPI ACIKKEN de submitting emri yeniden POST edilir (testin vakumda gecmemesi icin)', async () => {
    await boot()
    localStore.cow_orders = [submittingKayit()]
    h.api.getOrder.mockResolvedValue({ ok: false, code: 'ORDER_NOT_FOUND' })
    h.api.postOrder.mockResolvedValue({ ok: true, data: UID })
    await tikle()
    expect(h.api.getOrder).toHaveBeenCalledTimes(1)
    expect(h.api.postOrder).toHaveBeenCalledTimes(1)
  })

  it.each(KOSULLAR)('%s: submitting emri alarm tikinda TAM BIR KEZ yeniden POST edilir; /eligibility sorulmaz, kural onbellegi okunmaz', async (_ad, secenek) => {
    await boot(secenek)
    localStore.cow_orders = [submittingKayit()]
    h.api.getOrder.mockResolvedValue({ ok: false, code: 'ORDER_NOT_FOUND' })
    h.api.postOrder.mockResolvedValue({ ok: true, data: UID })
    await tikle()
    expect(h.api.postOrder).toHaveBeenCalledTimes(1)
    expect(h.api.postOrder.mock.calls[0][0]).toBe(56)
    expect(eligibilityCalls()).toHaveLength(0)
    expect(touched('stock_gate_rules_cache')).toBe(false)
    expect(localStore.cow_orders[0].status).toBe('open') // yeniden POST kabul edildi: kayit open'a gecti
  })
})

describe('kaynak taramasi (yorumsuz): kapi enjeksiyonu ve sinirlari', () => {
  const ham = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')
  const kod = yorumsuz(ham)
  const runtime = blokGovdesi(ham, /function getCowRuntime\(\)\s*/)
  const fonksiyon = (ad) => blokGovdesi(ham, new RegExp(`function ${ad}\\([^)]*\\)\\s*`))

  it('getCowRuntime: iki fabrika gate: cowStockGate alir, quoteStore salt-okunur peekQuote tasir; poller satiri kapiyi anmaz', () => {
    expect(runtime).toBeTruthy()
    expect(runtime.match(/gate: cowStockGate/g)).toHaveLength(2)
    expect(runtime).toMatch(/createCowApprove\(\{[\s\S]*?gate: cowStockGate/)
    expect(runtime).toMatch(/createCowService\(\{[\s\S]*?gate: cowStockGate/)
    expect(runtime.match(/peekQuote:/g)).toHaveLength(1)
    expect(runtime).toMatch(/peekQuote: \(\{ quoteId \}\) => cowQuoteStore\.getQuote\(quoteId, \{ storage: chrome\.storage\.session \}\)/)
    const poller = runtime.match(/createCowPoller\([^)]*\)/)?.[0]
    expect(poller).toBeTruthy()
    expect(poller).not.toMatch(/gate/i)
  })

  it('cowStockGate: getStockGate().evaluate, stock !== true fail-closed; owner, hesap karsilastirmasi ve ACCOUNT_CHANGED YOK (G24); ham hesap nesnesi donmez', () => {
    const govde = blokGovdesi(ham, /async function cowStockGate\(\{[^}]*\}\)\s*/)
    expect(govde).toBeTruthy()
    expect(govde).toMatch(/getStockGate\(\)\.evaluate\(\{ chainId, outAddress: stockAddress \}\)/)
    expect(govde).toMatch(/if \(g\.stock !== true\) return \{ ok: false, reason: 'CHECK_FAILED' \}/)
    expect(govde).not.toMatch(/\bowner\b|toLowerCase|ACCOUNT_CHANGED|\baction\b/)
    expect(govde).not.toMatch(/\.\.\.g\b|account:|g\.account/)
  })

  it('cowStockGate yalniz kendi tanimi ve getCowRuntime icinde gecer (uc kez); baska islevde yok', () => {
    expect(kod.match(/cowStockGate/g)).toHaveLength(3)
    expect(runtime.match(/cowStockGate/g)).toHaveLength(2)
  })

  it('COW_FEE_* islevleri, settleCowFeesSafe, claimRefundsSafe ve pollCowOrdersSafe kapi cagrisi tasimaz (govdeler bulunur, bos tarama degil)', () => {
    for (const ad of ['cowFeeStatus', 'cowFeeSettle', 'cowFeePay', 'cowFeeApproveChange', 'settleCowFeesSafe', 'claimRefundsSafe', 'pollCowOrdersSafe']) {
      const govde = fonksiyon(ad)
      expect(govde, ad).toBeTruthy()
      expect(govde, ad).not.toMatch(/StockGate|stockGate/)
    }
  })
})
