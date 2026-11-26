// KOK NEDEN / KAPATILAN HATA
// Ilk alim kapisinin SWAP yolu (spec ilk-alim-kapisi 5.2, 11.3, 11.5 madde 1). Kapatilan hata siniflari:
//  (1) kapi 'queued' kaydindan SONRA konursa ret hayalet bir "Takas" karti birakir; ag cagrisindan SONRA
//      konursa engelli kullanici yine de RPC / ATS backend'ine istek attirir (provider kurulur, teklif gider);
//  (2) SAT (girdisi hisse, cikti hisse degil) kapiya sokulursa kullanici elindeki hisseyi satamaz (K4);
//  (3) hisse OLMAYAN ciktida kapinin herhangi bir bagimliliga (depo, ag) dokunmasi: her Takas'a gecikme ve
//      yeni hata yuzeyi eklerdi;
//  (4) hesap bagi (G23, K39): swap() mesaja hesap ATAMAZ; imza hesabini kapi degil resolveAccount (depodaki aktif hesap) belirler;
//  (5) hisse adresinin buyuk / kucuk / checksum yazimi ya da chainId'nin metin olmasi kapiyi atlatir (RF4).
// Test gercek background.js'i mesajlarla surer; Pancake yoneticisi, ATS backend'i, provider ve ag SAPLANIR
// (mock kalibi: background.atsSale.test.js). Pozitif bekciler: her "gitmedi / yazilmadi" iddiasinin yaninda
// ayni yolun GERCEKTEN calistigi bir test var.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HDNodeWallet, getAddress } from 'ethers'
import supported_chains from './data/supported_chains.json'
import { BSTOCKS } from './data/bStocks'
import { RETIRED_XSTOCKS } from './data/xStocksRetired'
import { RETIRED_BSTOCKS } from './data/bStocksRetired'
import { BUNDLED_ELIGIBILITY_RULES } from './data/eligibilityRules'
import { stockIssuer, stockOutputIssuer } from './utils/tokenizedStocks'
import { blokGovdesi, yorumsuz } from './test-utils/kaynakTarama'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// vi.mock fabrikalari dosyanin en ustune tasinir: paylasilan casuslar vi.hoisted ile ONCE kurulmali.
const h = vi.hoisted(() => ({
    MNEMONIC: 'test test test test test test test test test test test junk',
    providerCtor: vi.fn(),
    managerCtor: vi.fn(),
    getExpectedOutput: vi.fn(),
    buildSwapCalls: vi.fn(),
    executeSwap: vi.fn(),
    quoteAtsTransfer: vi.fn(),
    executeAtsTransfer: vi.fn(),
}))

// "Provider kurulmadi" iddiasi icin: kurucu sayilir, ag yok.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SpyProvider { constructor(...a) { h.providerCtor(...a) } }
    return { ...actual, JsonRpcProvider: SpyProvider, ethers: { ...actual.ethers, JsonRpcProvider: SpyProvider } }
})

// Pancake motoru: yontemler casus; kapi reddettiyse HICBIRI cagrilmaz.
vi.mock('./utils/swap', () => ({
    MultiChainSwapManager: function MultiChainSwapManager(...a) {
        h.managerCtor(...a)
        this.getExpectedOutput = (...x) => h.getExpectedOutput(...x)
        this.buildSwapCalls = (...x) => h.buildSwapCalls(...x)
        this.executeSwap = (...x) => h.executeSwap(...x)
    },
}))

vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    quoteAtsTransfer: (...a) => h.quoteAtsTransfer(...a),
    executeAtsTransfer: (...a) => h.executeAtsTransfer(...a),
}))

// Kasa: gercek BIP-39 ifadesi; hesaplar m/44'/60'/0'/0/<i>.
vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => h.MNEMONIC), decryptSecret: vi.fn() }))

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const BSC = supported_chains.find((c) => c.chainId === 56)
const BUNDLED = BUNDLED_ELIGIBILITY_RULES
const BSTOCK = BSTOCKS[0].address
const BSTOCK_2 = BSTOCKS[1].address
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const BNB_ZERO = '0x0000000000000000000000000000000000000000'

const root = HDNodeWallet.fromPhrase(h.MNEMONIC, null, 'm')
const walletAt = (i) => root.derivePath(`m/44'/60'/0'/0/${i}`)
const accountAt = (i, key) => ({ key, type: 'hd', index: i, derivationPath: `m/44'/60'/0'/0/${i}`, address: walletAt(i).address })
const ACC_A = accountAt(0, 'k1')
const ACC_B = accountAt(1, 'k2')

let messageListener
let sessionStore
let localStore
let eligibilityBody // null -> sunucu yok (ag hatasi): ulke bilinmez, kapi COUNTRY_UNKNOWN verir
const fetchSpy = vi.fn()

function makeArea(getStore) {
    const pick = (store, keys) => {
        if (keys === undefined || keys === null) return { ...store }
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {}
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))
        return Object.fromEntries(Object.entries(keys).map(([k, dflt]) => [k, k in store ? store[k] : dflt]))
    }
    return {
        get: vi.fn(async (keys) => structuredClone(pick(getStore(), keys))),
        set: vi.fn(async (obj) => { Object.assign(getStore(), structuredClone(obj)) }),
        remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete getStore()[k] }),
    }
}

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
            local: makeArea(() => localStore),
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

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

const settle = () => new Promise((r) => setTimeout(r, 30))
async function waitForRecord(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const found = (localStore.current_transactions || []).find(predicate)
        if (found) return found
        if (Date.now() > deadline) return null
        await new Promise((r) => setTimeout(r, 5))
    }
}
const swapRecord = () => waitForRecord((t) => t?.meta?.type === 'Swap')

const eligibilityCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/eligibility'))
const otherFetches = () => fetchSpy.mock.calls.filter(([u]) => !String(u).endsWith('/eligibility'))
const touched = (key) => globalThis.chrome.storage.local.get.mock.calls.some(([k]) => String(JSON.stringify(k)).includes(key))
const serverBody = (rules, ipCountry) => ({ success: true, version: rules.version, ipCountry, rules })

const swapMsg = (over = {}) => ({
    chainId: 56, inTokenAddress: USDT, outTokenAddress: BSTOCK, amount: '5', slippage: 1,
    inTokenData: { symbol: 'USDT' }, outTokenData: { symbol: 'CRCLB' }, ...over,
})
// Sunucu tablosu = gomulu kopya; IP ulkesi verilen deger (kapi karari yalniz ihracci + tablo + ulkeden verilir, K33).
const serveCountry = (ip = 'AR') => { eligibilityBody = serverBody(structuredClone(BUNDLED), ip) }

// Kapi reddettiyse HICBIR yan etki olmamali: gecmis kaydi, provider, yonetici, ATS teklifi, ag.
async function expectNoSideEffects() {
    await settle()
    expect(localStore.current_transactions).toEqual([])
    expect(h.providerCtor).not.toHaveBeenCalled()
    expect(h.managerCtor).not.toHaveBeenCalled()
    expect(h.executeSwap).not.toHaveBeenCalled()
    expect(h.getExpectedOutput).not.toHaveBeenCalled()
    expect(h.buildSwapCalls).not.toHaveBeenCalled()
    expect(h.quoteAtsTransfer).not.toHaveBeenCalled()
    expect(h.executeAtsTransfer).not.toHaveBeenCalled()
    expect(otherFetches()).toEqual([])
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    eligibilityBody = null
    fetchSpy.mockImplementation(async (url) => {
        if (String(url).endsWith('/eligibility')) {
            if (!eligibilityBody) throw new Error('offline')
            const text = JSON.stringify(eligibilityBody)
            return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }
        }
        return { ok: false, status: 503, text: async () => '', json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchSpy)
    h.getExpectedOutput.mockResolvedValue({ expectedOutput: '1' })
    h.buildSwapCalls.mockResolvedValue({ calls: [] })
    h.executeSwap.mockResolvedValue({ hash: '0xswap', waitPromise: Promise.resolve({ status: 1 }) })
    h.quoteAtsTransfer.mockResolvedValue({ fee: '1' })
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: structuredClone(ACC_A),
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: ACC_A.address }, { key: 'k2', address: ACC_B.address }] }],
        currentNetwork: BSC,
        current_transactions: [],
        dapps: {},
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('fikstur bekcisi', () => {
    it('BSTOCK hisse; USDT ve yerel BNB degil; TR bStocks icin engelli, AR degil', () => {
        expect(stockIssuer(56, BSTOCK)).toBe('bstocks')
        expect(stockIssuer(56, BSTOCK_2)).toBe('bstocks')
        expect(stockIssuer(56, USDT)).toBeNull()
        expect(stockIssuer(56, BNB_ZERO)).toBeNull()
        expect(BUNDLED.issuers.bstocks.blocked).toContain('TR')
        expect(BUNDLED.issuers.bstocks.blocked).not.toContain('AR')
    })
})

describe('SWAP -- kapi queued kaydindan ve her ag cagrisindan ONCE', () => {
    it('bStock ciktisi, ulke bilinmiyor (sunucu yok) -> STOCK_GATE:COUNTRY_UNKNOWN; queued, provider, yonetici ve ag YOK', async () => {
        const res = await callHandler({ type: 'SWAP', message: swapMsg() })
        expect(res).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('bstocks + TR -> STOCK_GATE:IP_COUNTRY_ISSUER', async () => {
        serveCountry('TR')
        const res = await callHandler({ type: 'SWAP', message: swapMsg() })
        expect(res).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
        expect(eligibilityCalls()).toHaveLength(1)
    })

    it('TAMAM (ulke AR) -> mevcut yola duser: queued yazilir, yonetici cagrilir', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'SWAP', message: swapMsg() })
        expect(res).toEqual({ success: true, hash: '0xswap' })
        expect(await swapRecord()).toBeTruthy()
        expect(h.managerCtor).toHaveBeenCalledTimes(1)
        expect(h.executeSwap).toHaveBeenCalledWith(USDT, BSTOCK, '5', 1)
    })

    it('hisse->hisse takas Al sayilir: kapiya girer', async () => {
        const res = await callHandler({ type: 'SWAP', message: swapMsg({ inTokenAddress: BSTOCK_2, outTokenAddress: BSTOCK }) })
        expect(res).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })
})

describe('SWAP -- hisse olmayan cikti: kapi HICBIR bagimliliga dokunmaz (SIFIR ek async)', () => {
    // Pozitif bekci: ayni bagimliliklar (depo, ag) hisse ciktisinda GERCEKTEN okunuyor (ustteki testler).
    it.each([
        ['USDT -> USDT benzeri (hisse degil)', swapMsg({ outTokenAddress: USDT })],
        ['yerel BNB sifir adresi ciktisi', swapMsg({ outTokenAddress: BNB_ZERO })],
        ['bozuk girdi (inTokenAddress a, outTokenAddress b)', swapMsg({ inTokenAddress: 'a', outTokenAddress: 'b' })],
        ['outTokenAddress yok', swapMsg({ outTokenAddress: undefined })],
    ])('%s: ulke bilinmezken de GECER, kapi kural deposuna ve aga dokunmaz, hesap nesnesi atanmaz', async (_ad, message) => {
        const msg = { type: 'SWAP', message }
        const res = await callHandler(msg)
        expect(res).toEqual({ success: true, hash: '0xswap' })
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
        expect('account' in msg.message).toBe(false)
    })

    it('Sat acik: girdisi bStock, cikti USDT -> SWAP ve SWAP_QUOTE kapiyi HIC sormaz', async () => {
        const sat = swapMsg({ inTokenAddress: BSTOCK, outTokenAddress: USDT })
        expect(await callHandler({ type: 'SWAP', message: sat })).toEqual({ success: true, hash: '0xswap' })
        expect(await callHandler({ type: 'SWAP_QUOTE', message: sat })).toEqual({ success: true, data: { expectedOutput: '1' } })
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })
})

describe('SWAP -- hisse adresi yazimi ve chainId turu kapiyi ATLATAMAZ (RF4, swap tarafi)', () => {
    it.each([
        ['kucuk harf', BSTOCK.toLowerCase(), 56],
        ['buyuk harf govde', `0x${BSTOCK.slice(2).toUpperCase()}`, 56],
        ['checksum', getAddress(BSTOCK.toLowerCase()), 56],
        ['chainId metin ("56")', BSTOCK, '56'],
        ['0x on eki yok (B-F1)', BSTOCK.slice(2), 56],
        ['0x on eki yok, buyuk harf (B-F1)', BSTOCK.slice(2).toUpperCase(), 56],
        ['kenar bosluk (B-F1)', `  ${BSTOCK} `, 56],
    ])('%s: STOCK_GATE:IP_COUNTRY_ISSUER', async (_ad, outTokenAddress, chainId) => {
        serveCountry('TR')
        const res = await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress, chainId }) })
        expect(res).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })
})

// KOK NEDEN / KAPATILAN HATA (main senkron B-F1): kapi arama anahtari tam dize esitligiydi; 0x on eki olmayan 40 onaltili hane
// ya da kenar bosluklu adres hisse taninmaz, engelli ulkede SWAP / SWAP_QUOTE / ATS_SWAP_FEE_QUOTE 'queued' kaydi yazar, motoru kurar,
// teklif alirdi (K36 ihlali). Dort aksiyon, katalog bStock ve emekli bStock (K42) icin, ayni normallestirici (tokenizedStocks.js).
describe('SWAP / SWAP_QUOTE / ATS_SWAP_FEE_QUOTE -- 0x on eki olmayan ya da bosluklu cikti adresi kapiyi ATLATAMAZ (B-F1)', () => {
    const RETIRED_BMNRB = RETIRED_BSTOCKS.find((r) => r.symbol === 'BMNRB').address
    const adresler = [
        ['katalog bStock 0x onekisiz', BSTOCK.slice(2)],
        ['katalog bStock 0x onekisiz buyuk harf', BSTOCK.slice(2).toUpperCase()],
        ['katalog bStock bosluklu', ` ${BSTOCK}\n`],
        ['emekli BMNRB 0x onekisiz', RETIRED_BMNRB.slice(2)],
        ['emekli BMNRB bosluklu', `  ${RETIRED_BMNRB}  `],
    ]

    it.each(adresler)('%s, TR: SWAP -> STOCK_GATE:IP_COUNTRY_ISSUER, yan etki YOK (queued, yonetici, ag)', async (_ad, outTokenAddress) => {
        serveCountry('TR')
        expect(await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress }) })).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it.each(adresler)('%s, TR: SWAP_QUOTE -> STOCK_GATE:IP_COUNTRY_ISSUER; provider ve yonetici YOK', async (_ad, outTokenAddress) => {
        serveCountry('TR')
        expect(await callHandler({ type: 'SWAP_QUOTE', message: swapMsg({ outTokenAddress }) })).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it.each(adresler)('%s, TR: ATS_SWAP_FEE_QUOTE -> { success:false, STOCK_GATE:IP_COUNTRY_ISSUER, code }; ATS teklifi YOK', async (_ad, outTokenAddress) => {
        serveCountry('TR')
        const res = await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: swapMsg({ outTokenAddress }) })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('ulke bilinmiyorken de (K33) 0x onekisiz yazim kapali: COUNTRY_UNKNOWN', async () => {
        expect(await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: BSTOCK.slice(2) }) })).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('pozitif bekci: izinli ulkede (AR) 0x onekisiz yazim hisse sayilir ama kapi GECER (kapi karari ulkeyle verilir, yazimla degil)', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'SWAP_QUOTE', message: swapMsg({ outTokenAddress: BSTOCK.slice(2) }) })
        expect(res.success).toBe(true)
        expect(eligibilityCalls()).toHaveLength(1)
    })

    it('Sat acik kalir: 0x onekisiz yazimla girdi hisse, cikti USDT -> kapi HIC sorulmaz', async () => {
        const sat = swapMsg({ inTokenAddress: BSTOCK.slice(2), outTokenAddress: USDT })
        expect(await callHandler({ type: 'SWAP', message: sat })).toEqual({ success: true, hash: '0xswap' })
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })
})

describe('SWAP -- imza hesabi kapidan gelmez (G23, K39)', () => {
    it('swap() message.message.account ATAMAZ: yonetici depodaki aktif hesabin anahtariyla kurulur', async () => {
        serveCountry('AR')
        const msg = { type: 'SWAP', message: swapMsg() }
        const res = await callHandler(msg)
        expect(res).toEqual({ success: true, hash: '0xswap' })
        expect('account' in msg.message).toBe(false)
        expect(h.managerCtor).toHaveBeenCalledTimes(1)
        expect(h.managerCtor.mock.calls[0][0]).toBe(walletAt(0).privateKey)
    })

    it('aktif hesap baska ise (ACC_B) yonetici onun anahtariyla kurulur: karar hesaba bagli degil, imza hesabini kapi sabitlemez', async () => {
        serveCountry('AR')
        localStore.active_account = structuredClone(ACC_B)
        const msg = { type: 'SWAP', message: swapMsg() }
        expect(await callHandler(msg)).toEqual({ success: true, hash: '0xswap' })
        expect('account' in msg.message).toBe(false)
        expect(h.managerCtor.mock.calls[0][0]).toBe(walletAt(1).privateKey)
        expect(h.managerCtor.mock.calls[0][0]).not.toBe(walletAt(0).privateKey)
    })
})

describe('SWAP_QUOTE', () => {
    it('bStock ciktisi, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN; provider, yonetici ve ag YOK', async () => {
        const res = await callHandler({ type: 'SWAP_QUOTE', message: swapMsg() })
        expect(res).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('engelli IP -> STOCK_GATE:IP_COUNTRY_ISSUER', async () => {
        serveCountry('TR')
        const res = await callHandler({ type: 'SWAP_QUOTE', message: swapMsg() })
        expect(res).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it('TAMAM -> teklif alinir', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'SWAP_QUOTE', message: swapMsg() })
        expect(res).toEqual({ success: true, data: { expectedOutput: '1' } })
        expect(h.providerCtor).toHaveBeenCalledTimes(1)
        expect(h.getExpectedOutput).toHaveBeenCalledWith(USDT, BSTOCK, '5', 1, { skipPrice: false })
    })

    it('hisse olmayan cikti: kapi depoya ve aga dokunmaz', async () => {
        const res = await callHandler({ type: 'SWAP_QUOTE', message: swapMsg({ outTokenAddress: USDT }) })
        expect(res.success).toBe(true)
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })
})

describe('ATS_SWAP_FEE_QUOTE', () => {
    it('engelli -> { success:false, error: STOCK_GATE:<NEDEN>, code: STOCK_GATE }; teklif, provider ve yonetici YOK', async () => {
        const res = await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: swapMsg() })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('TAMAM -> ATS teklifi alinir (opKind swap)', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: swapMsg() })
        expect(res).toMatchObject({ success: true, fee: '1' })
        expect(h.quoteAtsTransfer).toHaveBeenCalledTimes(1)
        expect(h.quoteAtsTransfer.mock.calls[0][0]).toMatchObject({ chainId: 56, opKind: 'swap' })
    })

    it('Sat (girdisi bStock, cikti USDT): kapi sorulmaz, teklif alinir', async () => {
        const res = await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: swapMsg({ inTokenAddress: BSTOCK, outTokenAddress: USDT }) })
        expect(res).toMatchObject({ success: true })
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })
})

// KOK NEDEN / KAPATILAN HATA (K28): 9fb92682 ADBEx, PYPLx ve STRCx'i katalogdan cikarinca stockIssuer null dondu ve
// BSC'de PYPLx kapisiz alinabildi. Emekli adres CIKTI tarafinda xstocks sayilir; girdi (Sat) tarafi acik kalir.
describe('SWAP / SWAP_QUOTE / ATS_SWAP_FEE_QUOTE -- emekli xStocks adresi (K28)', () => {
    const PYPLX = RETIRED_XSTOCKS.find((r) => r.symbol === 'PYPLx').address

    it('fikstur bekcisi: PYPLx katalog hissesi DEGIL ama cikti tarafinda xstocks (BSC)', () => {
        expect(stockIssuer(56, PYPLX)).toBeNull()
        expect(stockOutputIssuer(56, PYPLX)).toBe('xstocks')
    })

    it('SWAP cikti emekli PYPLx, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN; queued, provider, yonetici ve ag YOK', async () => {
        const res = await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: PYPLX }) })
        expect(res).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('kapi ihraccisi xstocks sorar: TR bstocks icin engel (IP_COUNTRY_ISSUER) ama xstocks icin yalniz uyari -> emekli PYPLx gecer (dislama motorda: swap.xstockGate.test.js)', async () => {
        serveCountry('TR')
        expect(await callHandler({ type: 'SWAP', message: swapMsg() })).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
        const res = await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: PYPLX.toLowerCase() }) })
        // Yonetici bu dosyada saplanir; XSTOCK_USE_COW reddi utils/swap.js assertNotXStock tadir.
        expect(res).toEqual({ success: true, hash: '0xswap' })
        expect(h.managerCtor).toHaveBeenCalledTimes(1)
    })

    it('SWAP_QUOTE cikti emekli PYPLx, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN; provider ve yonetici YOK', async () => {
        const res = await callHandler({ type: 'SWAP_QUOTE', message: swapMsg({ outTokenAddress: PYPLX }) })
        expect(res).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('ATS_SWAP_FEE_QUOTE cikti emekli PYPLx -> { success:false, error: STOCK_GATE:<NEDEN>, code: STOCK_GATE }; teklif YOK', async () => {
        const res = await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: swapMsg({ outTokenAddress: PYPLX }) })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('Sat acik: girdi emekli PYPLx, cikti USDT -> SWAP, SWAP_QUOTE ve ATS_SWAP_FEE_QUOTE kapiyi HIC sormaz', async () => {
        const sat = swapMsg({ inTokenAddress: PYPLX, outTokenAddress: USDT })
        expect(await callHandler({ type: 'SWAP', message: sat })).toEqual({ success: true, hash: '0xswap' })
        expect(await callHandler({ type: 'SWAP_QUOTE', message: sat })).toEqual({ success: true, data: { expectedOutput: '1' } })
        expect(await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: sat })).toMatchObject({ success: true })
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })

    it('kaynak kilidi: bes kapi cagri yerinin hepsi stockOutputIssuer( sorar, stockIssuer( cagrisi KALMADI, enjeksiyon stockOutputIssuer', () => {
        const BG = yorumsuz(readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8'))
        expect(BG.match(/stockOutputIssuer\(/g)).toHaveLength(5)
        expect(BG).not.toMatch(/\bstockIssuer\(/)
        expect(BG).toMatch(/stockIssuer: stockOutputIssuer,/)
    })
})

// KOK NEDEN / KAPATILAN HATA (K28 ilkesinin bStocks karsiligi): e7089f2d BMNRB ve FLNCB'yi katalogdan cikarinca
// stockIssuer null dondu; token zincirde ve /getChainTokens listesinde kaldigindan TR / US / AB dahil her ulkeden SWAP
// kapisiz gidiyordu (gate.evaluate { ok:true, stock:false }). Emekli bStocks adresi CIKTI tarafinda bstocks sayilir;
// ihracci uygunsa yol DEGISMEZ (bStocks genel Takas'ta acik), girdi (Sat) tarafi acik kalir.
describe('SWAP / SWAP_QUOTE / ATS_SWAP_FEE_QUOTE -- emekli bStocks adresi (K28 ilkesi)', () => {
    const [BMNRB, FLNCB] = RETIRED_BSTOCKS.map((r) => r.address)

    it('fikstur bekcisi: BMNRB ve FLNCB katalog hissesi DEGIL ama cikti tarafinda bstocks (BSC)', () => {
        for (const adres of [BMNRB, FLNCB]) {
            expect(stockIssuer(56, adres)).toBeNull()
            expect(stockOutputIssuer(56, adres)).toBe('bstocks')
        }
        expect(BUNDLED.issuers.bstocks.blocked).toContain('TR')
    })

    it.each([['BMNRB', BMNRB], ['FLNCB', FLNCB]])('SWAP cikti emekli %s, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN; queued, provider, yonetici ve ag YOK', async (_ad, adres) => {
        const res = await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: adres }) })
        expect(res).toEqual({ error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it.each([['BMNRB', BMNRB], ['FLNCB', FLNCB]])('TR + emekli %s: SWAP, SWAP_QUOTE ve ATS_SWAP_FEE_QUOTE -> STOCK_GATE:IP_COUNTRY_ISSUER; hicbir yan etki YOK', async (_ad, adres) => {
        serveCountry('TR')
        expect(await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: adres }) })).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: adres.toLowerCase() }) })).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(await callHandler({ type: 'SWAP_QUOTE', message: swapMsg({ outTokenAddress: adres }) })).toEqual({ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: swapMsg({ outTokenAddress: adres }) }))
            .toMatchObject({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('uygun ulke (AR): emekli BMNRB mevcut yola duser (bStocks genel Takas yolu degismez); katalog-yalniz dislama YOK', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'SWAP', message: swapMsg({ outTokenAddress: BMNRB }) })
        expect(res).toEqual({ success: true, hash: '0xswap' })
        expect(h.executeSwap).toHaveBeenCalledWith(USDT, BMNRB, '5', 1)
    })

    it('Sat acik: girdi emekli BMNRB, cikti USDT -> SWAP, SWAP_QUOTE ve ATS_SWAP_FEE_QUOTE kapiyi HIC sormaz (TR dahil)', async () => {
        serveCountry('TR')
        const sat = swapMsg({ inTokenAddress: BMNRB, outTokenAddress: USDT })
        expect(await callHandler({ type: 'SWAP', message: sat })).toEqual({ success: true, hash: '0xswap' })
        expect(await callHandler({ type: 'SWAP_QUOTE', message: sat })).toEqual({ success: true, data: { expectedOutput: '1' } })
        expect(await callHandler({ type: 'ATS_SWAP_FEE_QUOTE', message: sat })).toMatchObject({ success: true })
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })
})

describe('kaynak kilitleri (spec 11.5 madde 1)', () => {
    const BG = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')
    const body = (name) => {
        const govde = blokGovdesi(BG, new RegExp(`async function ${name}\\(`))
        expect(govde, `${name} govdesi`).not.toBeNull()
        return govde
    }
    const at = (src, needle) => {
        const i = src.indexOf(needle)
        expect(i, needle).toBeGreaterThan(-1)
        return i
    }

    it('swap(): ATS-satis erken dali < hisse sorusu < kapi < uniqueKey < queued', () => {
        const g = body('swap')
        const kapi = at(g, 'await getStockGate()')
        expect(at(g, 'liveSaleRequest(')).toBeLessThan(at(g, 'stockOutputIssuer(chainId, outTokenAddress)'))
        expect(at(g, 'stockOutputIssuer(chainId, outTokenAddress)')).toBeLessThan(kapi)
        expect(kapi).toBeLessThan(at(g, 'uniqueKey()'))
        expect(kapi).toBeLessThan(at(g, "updateTxStatus(txId, 'queued'"))
    })

    it('swapQuote(): assertChainFlow < kapi < new ethers.JsonRpcProvider', () => {
        const g = body('swapQuote')
        const kapi = at(g, 'await getStockGate()')
        expect(at(g, "assertChainFlow(found, 'swap')")).toBeLessThan(kapi)
        expect(kapi).toBeLessThan(at(g, 'new ethers.JsonRpcProvider'))
    })

    it('atsSwapFeeQuote(): isAtsChain < kapi < provider ve quoteAtsTransfer(', () => {
        const g = body('atsSwapFeeQuote')
        const kapi = at(g, 'await getStockGate()')
        expect(at(g, 'isAtsChain(chainId)')).toBeLessThan(kapi)
        expect(kapi).toBeLessThan(at(g, 'new ethers.JsonRpcProvider'))
        expect(kapi).toBeLessThan(at(g, 'quoteAtsTransfer('))
    })

    it('anahtar CIKTI adresidir: uc isleyicide de stockOutputIssuer(chainId, outTokenAddress), girdi adresi hic sorulmaz (Sat acik)', () => {
        for (const ad of ['swap', 'swapQuote', 'atsSwapFeeQuote']) {
            const g = body(ad)
            expect(g, ad).toMatch(/stockOutputIssuer\(chainId, outTokenAddress\)/)
            expect(g, ad).not.toMatch(/stock(?:Output)?Issuer\([^)]*inTokenAddress/)
        }
    })

    it('G23: swap() dahil hicbir kapi isleyicisi hesap nesnesi ATAMAZ; kaynakta g.account yok', () => {
        for (const ad of ['swap', 'swapQuote', 'atsSwapFeeQuote']) {
            expect(body(ad), ad).not.toMatch(/\.account\s*=/)
            expect(body(ad), ad).not.toMatch(/g\.account/)
        }
        expect(yorumsuz(BG)).not.toMatch(/\bg\.account\b/)
    })
})
