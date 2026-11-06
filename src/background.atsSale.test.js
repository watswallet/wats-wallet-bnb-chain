// ATS SATISI -- arka plan baglantisi (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.2).
//
// background.js GERCEKTEN ice aktarilir (harness background.evmGates.test.js'ten). Satis
// katmaninin AG uclari (fetchAtsSaleQuote, executeAtsSale) ve Pancake motoru saplanir; kapi,
// kasa acma, teklif tazeligi kurali, islem kaydi ve yanit bicimi GERCEK calisir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ethers } from 'ethers'
import supported_chains from './data/supported_chains.json'

// vi.mock fabrikasi dosyanin en ustune tasinir: adresler vi.hoisted ile ONCE kurulmali.
const { DESK, SPONSOR } = vi.hoisted(() => ({
  DESK: '0x1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d',
  SPONSOR: '0x5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b5b',
}))
const satis = vi.hoisted(() => ({ acik: true }))
vi.mock('./utils/atsSaleConfig', async (importOriginal) => ({
  ...(await importOriginal()),
  ATS_SALE_DESK: DESK, ATS_SALE_SPONSOR: SPONSOR,
  isAtsSaleLive: () => satis.acik,
}))

const fetchAtsSaleQuote = vi.hoisted(() => vi.fn())
const executeAtsSale = vi.hoisted(() => vi.fn())
vi.mock('./utils/atsSale', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchAtsSaleQuote: (...a) => fetchAtsSaleQuote(...a),
  executeAtsSale: (...a) => executeAtsSale(...a),
  saleGaslessClient: () => ({ sahte: true }),
}))

// Pancake motoru: satis cifti buraya HIC ulasmamali.
const pancake = vi.hoisted(() => vi.fn())
vi.mock('./utils/swap', () => ({
  MultiChainSwapManager: function MultiChainSwapManager(...a) {
    pancake(...a)
    throw new Error('PANCAKE_YOLU')
  },
}))

// Kasa: gercek BIP-39 ifadesi; m/44'/60'/0'/0/0 -> HESAP.
const MNEMONIC = 'test test test test test test test test test test test junk'
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => MNEMONIC), decryptSecret: vi.fn() }))

import { mapSaleQuote } from './utils/atsSale'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const BSC = supported_chains.find((c) => c.chainId === 56)
const HESAP = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const QID = '0x' + 'ab'.repeat(32)
const yanit = () => ({
  quote: {
    buyer: HESAP, payToken: USDT, payAmount: '5000000000000000000', atsAmount: '96000000000000000000',
    deadline: 1790000000, quoteId: QID,
  },
  signature: '0x' + 'cd'.repeat(65), desk: DESK, sponsor: SPONSOR,
  display: { usdValue: '5', price: '0.05173', referencePrice: '0.0512', priceImpactPct: 0.56, commissionPct: 1, commissionAts: '960000000000000000' },
})
const satisMesaji = (over = {}) => ({
  chainId: 56, inTokenAddress: USDT, outTokenAddress: ATS, amount: '5', slippage: 0.5,
  inTokenData: { symbol: 'usdt' }, outTokenData: { symbol: 'ats' }, ...over,
})
const tazeTeklif = () => mapSaleQuote(yanit(), { receivedAt: Date.now() }).saleQuote

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
        set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
        remove: vi.fn(async () => {}),
      },
      session: {
        get: vi.fn(async () => sessionStore),
        set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
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

// Isleyici sendResponse'u ASENKRON cagirir (return true). Sozle sarmalanir.
function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
  return new Promise((resolve) => {
    const returned = messageListener(message, sender, resolve)
    if (returned !== true) resolve(undefined)
  })
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  satis.acik = true
  // Hata yollari bilerek console.error yazar; test ciktisi temiz kalsin.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
  localStore = {
    active_account: { key: 'k1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0", address: HESAP },
    vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }] }],
    currentNetwork: BSC,
    dapps: {},
    current_transactions: [],
  }
  const listeners = installChromeStub()
  globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
  await import('./background.js')
  messageListener = listeners.onMessage[0]
  fetchAtsSaleQuote.mockResolvedValue(yanit())
  executeAtsSale.mockResolvedValue({ userOpHash: '0xop', txHash: '0xtx' })
})

describe('teklif: satis cifti Pancake e GITMEZ', () => {
  it('SWAP_QUOTE (USDT -> ATS, BSC) satis teklifine dallanir', async () => {
    const res = await callHandler({ type: 'SWAP_QUOTE', message: satisMesaji() })
    expect(pancake).not.toHaveBeenCalled()
    expect(fetchAtsSaleQuote).toHaveBeenCalledTimes(1)
    const arg = fetchAtsSaleQuote.mock.calls[0][0]
    expect(arg.buyer).toBe(HESAP)
    expect(arg.request).toMatchObject({ symbol: 'USDT', quoteAddress: USDT })
    expect(arg.payAmountRaw).toBe(5000000000000000000n)
    expect(res.success).toBe(true)
    expect(res.data.expectedOutput).toBe('96.0')
    expect(res.data.saleQuote.quote.quoteId).toBe(QID)
  })

  it('ATS_SALE_QUOTE ayni yaniti verir', async () => {
    const res = await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji() })
    expect(res.success).toBe(true)
    expect(res.data.saleQuote.desk).toBe(DESK)
  })

  it('sunucunun stok hatasi ipucuyla doner', async () => {
    fetchAtsSaleQuote.mockRejectedValueOnce(Object.assign(new Error('stok'), {
      code: 'stock-insufficient', status: 409, body: { maxAts: '1000', maxUsd: '51.20' },
    }))
    const res = await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji() })
    expect(res).toMatchObject({ success: false, saleError: { code: 'stock-insufficient', maxAts: '1000', maxUsd: '51.20' } })
  })

  it('satis cifti olmayan takas (USDT -> USDC) Pancake e gider', async () => {
    await callHandler({ type: 'SWAP_QUOTE', message: satisMesaji({ outTokenAddress: USDC }) })
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
    expect(pancake).toHaveBeenCalled()
  })

  it('bayrak KAPALI: SWAP_QUOTE bugunku gibi Pancake e gider; ATS_SALE_QUOTE sale-closed', async () => {
    satis.acik = false
    const takas = await callHandler({ type: 'SWAP_QUOTE', message: satisMesaji() })
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
    expect(pancake).toHaveBeenCalled()
    expect(takas.error).toContain('PANCAKE_YOLU')
    const satisUcu = await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji() })
    expect(satisUcu).toMatchObject({ success: false, saleError: { code: 'sale-closed' } })
  })
})

describe('ATS_SALE_EXECUTE -- tazelik kurali ve yurutme', () => {
  it('teklif yoksa yeni teklif REQUOTE olarak doner, alim YAPILMAZ', async () => {
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji() })
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(res.requote.saleQuote.quote.quoteId).toBe(QID)
    expect(localStore.current_transactions).toEqual([])
  })

  it('suresi azalmis teklif (21 sn once alinmis) -> requote', async () => {
    const eski = { ...tazeTeklif(), receivedAt: Date.now() - 21_000 }
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: eski }) })
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(res.requote).toBeDefined()
  })

  // REVIEW FOCUS 1 (arka plan baglantisi)
  it('ekran tutari degistirdi ama teklif eski tutarin -> requote, eski teklifle ALIM YOK', async () => {
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ amount: '6', saleQuote: tazeTeklif() }) })
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(fetchAtsSaleQuote.mock.calls[0][0].payAmountRaw).toBe(6000000000000000000n)
    expect(res.requote).toBeDefined()
  })

  it('taze ve istekle ayni teklif: alim yurur, basari doner, islem kaydi success', async () => {
    const sq = tazeTeklif()
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: sq }) })
    expect(res).toEqual({ success: true, hash: '0xop', txHash: '0xtx' })
    const arg = executeAtsSale.mock.calls[0][0]
    expect(arg.saleQuote).toEqual(sq)
    expect(arg.rpcUrl).toBe(BSC.rpc[0].url)
    expect(new ethers.Wallet(arg.privateKey).address).toBe(HESAP)
    await vi.waitFor(() => {
      expect(localStore.current_transactions[0]).toMatchObject({
        status: 'success', meta: { type: 'Swap', txHash: '0xtx', chainId: 56, fromSymbol: 'usdt', toSymbol: 'ats' },
      })
    })
  })

  it('yurutme hatasi ekran koduyla doner, islem kaydi error', async () => {
    executeAtsSale.mockRejectedValueOnce(Object.assign(new Error('relay-failed'), { code: 'relay-failed', saleCode: 'relay-failed' }))
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: tazeTeklif() }) })
    expect(res).toMatchObject({ success: false, saleError: { code: 'relay-failed' } })
    await vi.waitFor(() => expect(localStore.current_transactions[0].status).toBe('error'))
  })

  it('sonuc BILINMIYORSA islem kaydina error YAZILMAZ (alim gerceklesmis olabilir)', async () => {
    executeAtsSale.mockRejectedValueOnce(Object.assign(new Error('result-unknown'), { code: 'result-unknown', saleCode: 'result-unknown' }))
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: tazeTeklif() }) })
    expect(res.saleError).toEqual({ code: 'result-unknown' })
    await vi.waitFor(() => expect(localStore.current_transactions[0]?.status).toBe('processing'))
    await new Promise((r) => setTimeout(r, 10))
    expect(localStore.current_transactions[0].status).toBe('processing')
  })

  it('result-unknown: bilinen userOpHash/txHash kayda yazilir, kayit processing kalir', async () => {
    executeAtsSale.mockRejectedValueOnce(Object.assign(new Error('result-unknown'), {
      code: 'result-unknown', saleCode: 'result-unknown', userOpHash: '0xop9', txHash: '0xtx9',
    }))
    await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: tazeTeklif() }) })
    await vi.waitFor(() => expect(localStore.current_transactions[0].meta).toMatchObject({ userOpHash: '0xop9', txHash: '0xtx9' }))
    expect(localStore.current_transactions[0].status).toBe('processing')
  })

  it.each([
    ['baska bir desk', { desk: '0x' + '9'.repeat(40) }],
    ['baska bir sponsor', { sponsor: '0x' + '8'.repeat(40) }],
    ['baska bir alici', { quote: { ...yanit().quote, buyer: '0x' + '7'.repeat(40) } }],
    ['baska bir odeme tokeni', { quote: { ...yanit().quote, payToken: USDC } }],
    ['baska bir odeme tutari', { quote: { ...yanit().quote, payAmount: '1' } }],
  ])('arayuzden gelen teklif %s ile uyusmuyorsa requote, alim YOK', async (_ad, degisim) => {
    const kotu = { ...tazeTeklif(), ...degisim }
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: kotu }) })
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(res.requote.saleQuote.desk).toBe(DESK)
    expect(localStore.current_transactions).toEqual([])
  })

  it('sponsor teklifin suresinin doldugunu soylerse (sale-quote-expired) yeni teklif REQUOTE olarak doner; kayit kalmaz', async () => {
    executeAtsSale.mockRejectedValueOnce(Object.assign(new Error('teklif suresi doldu'), { code: 'sale-quote-expired', status: 409 }))
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: tazeTeklif() }) })
    expect(executeAtsSale).toHaveBeenCalledTimes(1)
    expect(fetchAtsSaleQuote).toHaveBeenCalledTimes(1)
    expect(fetchAtsSaleQuote.mock.calls[0][0]).toMatchObject({ buyer: HESAP, payAmountRaw: 5000000000000000000n })
    expect(res.requote.saleQuote.quote.quoteId).toBe(QID)
    expect(res.saleError).toBeUndefined()
    // Acilan 'processing' kaydi yanittan ONCE silindi (kuyruk sirali).
    expect(localStore.current_transactions).toEqual([])
  })

  it('sale-quote-used requote YAPMAZ: "hazirlanamadi" doner', async () => {
    executeAtsSale.mockRejectedValueOnce(Object.assign(new Error('teklif kullanildi'), { code: 'sale-quote-used', status: 409 }))
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: tazeTeklif() }) })
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
    expect(res).toMatchObject({ success: false, saleError: { code: 'prepare-failed' } })
  })

  it('eski arayuzun SWAP mesaji da satis yoluna dallanir (Pancake e gitmez); teklifsiz -> requote', async () => {
    const res = await callHandler({ type: 'SWAP', message: satisMesaji() })
    expect(pancake).not.toHaveBeenCalled()
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(res.requote).toBeDefined()
  })

  it('bayrak KAPALI: ATS_SALE_EXECUTE sale-closed, hicbir sey imzalanmaz', async () => {
    satis.acik = false
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ saleQuote: tazeTeklif() }) })
    expect(res.saleError).toEqual({ code: 'sale-closed' })
    expect(executeAtsSale).not.toHaveBeenCalled()
  })

  // Kabul olcutu "bayrak KAPALI bugunku davranis": swap() basindaki tek satirlik erken dal bayrak
  // kapaliyken liveSaleRequest(null) olmali ve USDT -> ATS Pancake yoluna dusmeli. Pozitif kontrol:
  // Pancake yoneticisi GERCEKTEN kuruldu (PANCAKE_YOLU hatasi satis katmanina degil motora ait).
  it('bayrak KAPALI: SWAP (USDT -> ATS) Pancake yoneticisini kurar, satis yurutmesi HIC cagrilmaz', async () => {
    satis.acik = false
    const res = await callHandler({ type: 'SWAP', message: satisMesaji() })
    expect(pancake).toHaveBeenCalledTimes(1)
    expect(pancake.mock.calls[0][1]).toBe(56)
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
    expect(res?.requote).toBeUndefined()
    expect(res?.saleError).toBeUndefined()
  })
})

describe('koken kapisi', () => {
  it.each(['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE'])('%s sayfadan gelirse 4100 ile reddedilir', async (type) => {
    const res = await callHandler({ type, message: satisMesaji() }, { url: 'https://evil.example/', tab: { id: 7 } })
    expect(res).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
    expect(executeAtsSale).not.toHaveBeenCalled()
  })
})

/// K13 (cok-ag spec 4.5 madde 2): Gizli Hesap KENDI BSC varliklariyla gizli modda ATS alabilir. Isleyici ici savunma
// `assertSaleSignerAllowed` bir ESLIK denetimidir: Gizli imzaci YALNIZ gizli mod canliyken (gizlilik bayragi acik ve aktif
// hesap Gizli kimlik) ve PRIVATE_ATS_SALE aciksa gecer; baska her durumda ayni yanit: hicbir sey imzalanmaz, alici adresi
// sunucuya gitmez, kasa acilmaz, islem karti yazilmaz. `error` kapinin kodudur (PRIVATE_ATS_SALE_BLOCKED). Dogrudan
// ATS_SALE_* mesajinda yaniti KAPI verir (`saleError` alani yok); SWAP/SWAP_QUOTE erken dalinda ISLEYICI verir
// (`saleError.code` = 'sale-closed'). Gizli kimlik icin SWAP/SWAP_QUOTE kapida PRIVATE_SWAP_BRIDGE_CLOSED ile kesilir; isleyici dali yalniz gizlilik bayragi kapaliyken ulasilir.
describe('ATS satin alma -- Gizli Hesap esilik denetimi (assertSaleSignerAllowed)', () => {
  // Fikstur adresi kasanin m/44'/60'/0'/1/0 turetmesine ESIT olmak zorunda: executeAtsSale'e verilen anahtar o yoldan gelir
  // ve teklifin alicisi (buyer) turetilen adresle karsilastirilir.
  const GIZLI_ADRES = '0x4b39F7b0624b9dB86AD293686bc38B903142dbBc'
  const GIZLI = { key: 'g-1', address: GIZLI_ADRES, type: 'hd', private: true, index: 0, derivationPath: "m/44'/60'/0'/1/0" }
  const GENEL = { key: 'k1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0", address: HESAP }
  const GENEL2_ADRES = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  const GENEL2 = { key: 'k2', type: 'hd', index: 1, derivationPath: "m/44'/60'/0'/0/1", address: GENEL2_ADRES }
  const ENGEL = { success: false, error: 'PRIVATE_ATS_SALE_BLOCKED', saleError: { code: 'sale-closed' } }
  const KAPI_ENGEL = { success: false, error: 'PRIVATE_ATS_SALE_BLOCKED' }
  const teklifFor = (buyer) => mapSaleQuote({ ...yanit(), quote: { ...yanit().quote, buyer } }, { receivedAt: Date.now() }).saleQuote

  // Ust duzey beforeEach genel modda bir arka plan kurdu; burada bayraklar + kasa + aktif hesapla YENIDEN kurulur.
  async function bootPrivate({ privacy = 'true', atsSale = 'true', active }) {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('VITE_PRIVACY_ENABLED', privacy)
    vi.stubEnv('VITE_PRIVATE_ATS_SALE', atsSale)
    localStore = {
      active_account: active,
      vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: HESAP }, { key: 'k2', address: GENEL2_ADRES }], privateAccount: GIZLI }],
      currentNetwork: BSC,
      dapps: {},
      current_transactions: [],
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
    fetchAtsSaleQuote.mockResolvedValue(yanit())
    executeAtsSale.mockResolvedValue({ userOpHash: '0xop', txHash: '0xtx' })
  }

  const kasaAcildiMi = async () => (await import('./utils/crypto-utils')).unlockVault
  const hicbirSeyOlmadi = async () => {
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(pancake).not.toHaveBeenCalled()
    expect(await kasaAcildiMi()).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 10))
    expect(localStore.current_transactions).toEqual([])
  }
  const TIPLER = ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE', 'SWAP_QUOTE', 'SWAP']
  const SATIS_TIPLERI = ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']

  afterEach(() => { vi.unstubAllEnvs() })

  it('gizli mod + Gizli imzaci: teklifin alicisi Gizli adres (ATS_SALE_QUOTE), kasa ACILMAZ', async () => {
    await bootPrivate({ active: GIZLI })
    const res = await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji({ account: GIZLI }) })
    expect(res.success).toBe(true)
    expect(fetchAtsSaleQuote).toHaveBeenCalledTimes(1)
    expect(fetchAtsSaleQuote.mock.calls[0][0].buyer).toBe(GIZLI_ADRES)
    expect(await kasaAcildiMi()).not.toHaveBeenCalled()
    expect(pancake).not.toHaveBeenCalled()
  })

  it('gizli mod + Gizli imzaci: ATS_SALE_EXECUTE kasadan m/44\'/60\'/0\'/1/0 anahtariyla yurur, kart Gizli tarafin listesine yazilir', async () => {
    await bootPrivate({ active: GIZLI })
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ account: GIZLI, saleQuote: teklifFor(GIZLI_ADRES) }) })
    expect(res).toEqual({ success: true, hash: '0xop', txHash: '0xtx' })
    expect(executeAtsSale).toHaveBeenCalledTimes(1)
    expect(new ethers.Wallet(executeAtsSale.mock.calls[0][0].privateKey).address).toBe(GIZLI_ADRES)
    await vi.waitFor(() => expect(localStore.current_transactions[0]).toMatchObject({ status: 'success', accountKey: 'g-1' }))
    expect(pancake).not.toHaveBeenCalled()
  })

  // privacyChainIdFor: zincir ATS_SALE_CHAIN_ID sabitinden gelir. Mesajdaki chainId EVM disi olsa kapi ENGELLEMEZ; isleyicinin
  // kendi satis istegi cozumu (liveSaleRequest) o mesaji 'sale-closed' ile geri cevirir (kapinin PRIVATE_ATS_SALE_BLOCKED'i DEGIL).
  it('zincir kapida SABITTIR (BSC): mesajdaki chainId EVM disi olsa da kapi Gizli imzaciyi engellemez', async () => {
    await bootPrivate({ active: GIZLI })
    const res = await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji({ account: GIZLI, chainId: 'solana-mainnet' }) })
    expect(res.error).not.toBe('PRIVATE_ATS_SALE_BLOCKED')
    expect(res.error).not.toBe('PRIVATE_EVM_ONLY')
    expect(res.saleError).toEqual({ code: 'sale-closed' })
    expect(fetchAtsSaleQuote).not.toHaveBeenCalled()
  })

  it('gizli mod + mesajdaki GENEL hesap: kapi engeli (saleError yok), hicbir sey olmaz', async () => {
    await bootPrivate({ active: GIZLI })
    for (const type of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
      const res = await callHandler({ type, message: satisMesaji({ account: GENEL, saleQuote: tazeTeklif() }) })
      expect(res, type).toEqual(KAPI_ENGEL)
    }
    await hicbirSeyOlmadi()
  })

  it('genel mod + mesajdaki Gizli hesap: dogrudan ATS_SALE_* yaniti KAPIDAN gelir (saleError yok), hicbir sey olmaz', async () => {
    await bootPrivate({ active: GENEL })
    for (const type of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
      const res = await callHandler({ type, message: satisMesaji({ account: GIZLI, saleQuote: teklifFor(GIZLI_ADRES) }) })
      expect(res, type).toEqual(KAPI_ENGEL)
    }
    await hicbirSeyOlmadi()
  })

  it('PRIVATE_ATS_SALE KAPALI + gizli mod + Gizli imzaci: dogrudan ATS_SALE_* mesajinda kapi engeller; hicbir sey olmaz', async () => {
    await bootPrivate({ atsSale: 'false', active: GIZLI })
    for (const type of ['ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE']) {
      expect(await callHandler({ type, message: satisMesaji({ account: GIZLI, saleQuote: teklifFor(GIZLI_ADRES) }) }), type).toEqual(KAPI_ENGEL)
    }
    await hicbirSeyOlmadi()
  })

  // Klasik SWAP_QUOTE / SWAP erken dalinin Gizli imzaci icin TEK kapsami: kapi bayrak ne olursa olsun bu iki adi keser (PRIVATE_SWAP_BRIDGE_CLOSED), isleyici dali yalniz gizlilik bayragi kapaliyken ulasilir.
  it('gizlilik bayragi KAPALI (kapi calismaz, geri alma gibi): Gizli imzaci icin dort mesaj da isleyicide ayni engel', async () => {
    await bootPrivate({ privacy: 'false', active: GIZLI })
    for (const type of TIPLER) {
      const res = await callHandler({ type, message: satisMesaji({ account: GIZLI, saleQuote: teklifFor(GIZLI_ADRES) }) })
      expect(res, type).toEqual(ENGEL)
    }
    await hicbirSeyOlmadi()
  })

  // ESKIMIS MOD YARISI: kapi karar verdikten sonra baska bir panel modu degistirir. Isleyici aktif hesabi KENDISI taze okur.
  it('mod yarisi: kapi gizli modda Gizli imzaciyi gecirdi, isleyicide aktif hesap artik genel -> engel, hicbir sey olmaz', async () => {
    await bootPrivate({ active: GIZLI })
    for (const type of SATIS_TIPLERI) {
      const taban = chrome.storage.local.get
      let okuma = 0
      chrome.storage.local.get = vi.fn(async (keys) => {
        const out = await taban(keys)
        if ((Array.isArray(keys) ? keys : [keys]).includes('active_account') && ++okuma > 1) out.active_account = GENEL
        return out
      })
      const res = await callHandler({ type, message: satisMesaji({ account: GIZLI, saleQuote: teklifFor(GIZLI_ADRES) }) })
      chrome.storage.local.get = taban
      expect(res, type).toEqual(ENGEL)
    }
    await hicbirSeyOlmadi()
  })

  it('pozitif kontrol: ayni istek GENEL hesapla teklif alir (engel Gizli kimlige ozgu); gizlilik bayragi kapaliyken de', async () => {
    await bootPrivate({ active: GENEL })
    expect((await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji() })).success).toBe(true)
    await bootPrivate({ privacy: 'false', atsSale: 'false', active: GENEL })
    expect((await callHandler({ type: 'ATS_SALE_QUOTE', message: satisMesaji() })).success).toBe(true)
    expect(fetchAtsSaleQuote).toHaveBeenCalledTimes(1)
  })

  // ISLEM KARTI ETIKETI (bayraktan bagimsiz): kart, imzalayan hesabin key'iyle yazilir; yoksa kuyrukta beklerken mod
  // cevrilirse kart ote tarafin listesine duserdi (ust belge madde 14'un satis yolundaki karsiligi).
  it('islem karti imzalayan hesabin key\'iyle yazilir (aktif hesap farkli olsa da)', async () => {
    await bootPrivate({ privacy: 'false', atsSale: 'false', active: GENEL })
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ account: GENEL2, saleQuote: teklifFor(GENEL2_ADRES) }) })
    expect(res.success).toBe(true)
    await vi.waitFor(() => expect(localStore.current_transactions[0]).toMatchObject({ status: 'success', accountKey: 'k2' }))
  })

  it('imzacinin key i yoksa (taraf belirsiz) imzalanmaz: executeAtsSale cagrilmaz, kart yazilmaz', async () => {
    await bootPrivate({ privacy: 'false', atsSale: 'false', active: GENEL })
    const { key, ...anahtarsiz } = GENEL2
    const res = await callHandler({ type: 'ATS_SALE_EXECUTE', message: satisMesaji({ account: anahtarsiz, saleQuote: teklifFor(GENEL2_ADRES) }) })
    expect(res.success).not.toBe(true)
    expect(executeAtsSale).not.toHaveBeenCalled()
    expect(localStore.current_transactions ?? []).toEqual([])
  })
})
