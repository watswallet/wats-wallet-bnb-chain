// KOK NEDEN / KAPATILAN HATA
// Ilk alim kapisinin KOPRU yolu (spec ilk-alim-kapisi 5.3, 11.3, K15). Kapatilan hata siniflari:
//  (1) kapi 'queued' kaydindan SONRA konursa ret hayalet bir "Kopru" karti birakir; provider / LI.FI /
//      ATS backend cagrisindan SONRA konursa engelli kullanici yine de istek attirir;
//  (2) BRIDGE mesajindaki to/data/value LI.FI'nin hazir calldata'sidir ve hedef tokeni belli etmez: eski bir
//      panel toTokenAddress'siz gonderirse BSC'ye giden koprude bStock aldirabilir -> alan yoksa KAPALI;
//  (3) hedef zincir `toChain` mesaj alanindan alinir; aktif ag / kaynak zincir (`chain`) kullanilirsa kapi
//      yanlis zincirde sorar;
//  (4) hisse adresinin yazimi (buyuk / kucuk / checksum), toChain'in metin olmasi ya da yerel BNB hedefi
//      (sifir adres, 0xEeee) kapiyi ya atlatir ya da mesru koprudeki hedefi gereksiz reddeder (RF4);
//  (5) hesap bagi (G23, K39): bridge() mesaja hesap ATAMAZ; imza hesabini kapi degil resolveAccount (depodaki aktif hesap) belirler.
// Test gercek background.js'i mesajlarla surer; LI.FI motoru, ATS backend'i, provider ve ag SAPLANIR
// (mock kalibi: background.atsSale.test.js). Pozitif bekciler: her "gitmedi / yazilmadi" iddiasinin yaninda
// ayni yolun GERCEKTEN calistigi bir test var.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { HDNodeWallet, Wallet, getAddress } from 'ethers'
import supported_chains from './data/supported_chains.json'
import { BRIDGE_QUOTES_KEY, bridgeQuoteKey } from './utils/bridgeQuoteGuard'
import { BSTOCKS } from './data/bStocks'
import { RETIRED_XSTOCKS } from './data/xStocksRetired'
import { RETIRED_BSTOCKS } from './data/bStocksRetired'
import { BUNDLED_ELIGIBILITY_RULES } from './data/eligibilityRules'
import { stockIssuer, stockOutputIssuer } from './utils/tokenizedStocks'
import { blokGovdesi, yorumsuz } from './test-utils/kaynakTarama'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const h = vi.hoisted(() => ({
    MNEMONIC: 'test test test test test test test test test test test junk',
    providerCtor: vi.fn(),
    bridgeQuote: vi.fn(),
    crossChainSwap: vi.fn(),
    buildBridgeCalls: vi.fn(),
    quoteAtsTransfer: vi.fn(),
    executeAtsTransfer: vi.fn(),
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SpyProvider { constructor(...a) { h.providerCtor(...a) } }
    return { ...actual, JsonRpcProvider: SpyProvider, ethers: { ...actual.ethers, JsonRpcProvider: SpyProvider } }
})

// LI.FI motoru: teklif, calistirma ve cagri listesi uretimi casus; kapi reddettiyse HICBIRI cagrilmaz.
vi.mock('./utils/bridge', async (importOriginal) => ({
    ...(await importOriginal()),
    default: (...a) => h.bridgeQuote(...a),
    crossChainSwap: (...a) => h.crossChainSwap(...a),
    buildBridgeCalls: (...a) => h.buildBridgeCalls(...a),
}))

vi.mock('./utils/atsPaymaster', async (importOriginal) => ({
    ...(await importOriginal()),
    quoteAtsTransfer: (...a) => h.quoteAtsTransfer(...a),
    executeAtsTransfer: (...a) => h.executeAtsTransfer(...a),
}))

vi.mock('./utils/crypto-utils', () => ({ unlockVault: vi.fn(async () => h.MNEMONIC), decryptSecret: vi.fn() }))

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const ETH = supported_chains.find((c) => c.chainId === 1)
const BUNDLED = BUNDLED_ELIGIBILITY_RULES
const BSTOCK = BSTOCKS[0].address
const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const ROUTER = '0x5555555555555555555555555555555555555555'
const BNB_ZERO = '0x0000000000000000000000000000000000000000'
const BNB_PLACEHOLDER = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const root = HDNodeWallet.fromPhrase(h.MNEMONIC, null, 'm')
const walletAt = (i) => root.derivePath(`m/44'/60'/0'/0/${i}`)
const accountAt = (i, key) => ({ key, type: 'hd', index: i, derivationPath: `m/44'/60'/0'/0/${i}`, address: walletAt(i).address })
const ACC_A = accountAt(0, 'k1')
const ACC_B = accountAt(1, 'k2')

let messageListener
let sessionStore
let localStore
let eligibilityBody
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

const eligibilityCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/eligibility?v=2'))
const otherFetches = () => fetchSpy.mock.calls.filter(([u]) => !String(u).endsWith('/eligibility?v=2'))
const touched = (key) => globalThis.chrome.storage.local.get.mock.calls.some(([k]) => String(JSON.stringify(k)).includes(key))
const serverBody = (rules, ipCountry) => ({ success: true, version: rules.version, ipCountry, rules })
// Sunucu tablosu = gomulu kopya; IP ulkesi verilen deger (kapi karari yalniz ihracci + tablo + ulkeden verilir, K33).
const serveCountry = (ip = 'AR') => { eligibilityBody = serverBody(structuredClone(BUNDLED), ip) }

const bridgeMsg = (over = {}) => ({
    chain: 1, toChain: 56, toTokenAddress: BSTOCK, to: ROUTER, from: USDT_ETH, data: '0x', value: '0',
    amount: 12, amount_raw: '12000000', fromTokenData: { symbol: 'USDT' }, ...over,
})
const quoteMsg = (over = {}) => ({
    fromChain: 1, toChain: 56, inToken: { address: USDT_ETH, decimals: 6 }, outToken: { address: BSTOCK, decimals: 18 },
    amount: '12', filter: 'RECOMMENDED', slippage: 0.5, ...over,
})
// KOPRU ALICI KORUMASI (main, gizli-mod P10): bridge() ve atsBridgeFeeQuote() mesajdaki (zincir, to, data, value) icin
// getBridgeQuote'un oturum deposuna yazdigi kaydi arar; yoksa BRIDGE_QUOTE_NOT_FOUND. Kapi bu korumadan ONCE oturur
// (reddedilen yollar kayda hic bakmaz); kapidan GECEN yollarin devam ettigini sinayan testler kaydi onceden yazar.
const seedQuote = (signer, { chain = 1, to = ROUTER, data = '0x', value = '0', approval = ROUTER } = {}) => {
    const key = bridgeQuoteKey(chain, to, data, value)
    sessionStore[BRIDGE_QUOTES_KEY] = { ...(sessionStore[BRIDGE_QUOTES_KEY] || {}), [key]: { signer, approval, createdAt: Date.now() } }
}
// LI.FI /quote yaniti: alici = imzaci (rememberBridgeQuote reddetmesin). Imzaci, motora gecen ozel anahtardan turetilir.
const lifiQuoteFor = (privateKey) => {
    const signer = new Wallet(privateKey).address
    return {
        action: { toToken: { address: BSTOCK }, toAddress: signer, fromAddress: signer },
        estimate: {},
        transactionRequest: { to: ROUTER, data: '0x', value: '0', chainId: 1 },
    }
}
const atsMsg = (over = {}) => ({
    chainId: 1, to: ROUTER, data: '0x', value: '0', fromTokenAddress: USDT_ETH, amount_raw: '12000000',
    approvalAddress: ROUTER, toChain: 56, toTokenAddress: BSTOCK, ...over,
})

// Kapi reddettiyse HICBIR yan etki olmamali: gecmis kaydi, provider, LI.FI, ATS teklifi, ag.
async function expectNoSideEffects() {
    await settle()
    expect(localStore.current_transactions).toEqual([])
    expect(h.providerCtor).not.toHaveBeenCalled()
    expect(h.bridgeQuote).not.toHaveBeenCalled()
    expect(h.crossChainSwap).not.toHaveBeenCalled()
    expect(h.buildBridgeCalls).not.toHaveBeenCalled()
    expect(h.quoteAtsTransfer).not.toHaveBeenCalled()
    expect(h.executeAtsTransfer).not.toHaveBeenCalled()
    expect(otherFetches()).toEqual([])
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    eligibilityBody = null
    fetchSpy.mockImplementation(async (url) => {
        if (String(url).endsWith('/eligibility?v=2')) {
            if (!eligibilityBody) throw new Error('offline')
            const text = JSON.stringify(eligibilityBody)
            return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }
        }
        return { ok: false, status: 503, text: async () => '', json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchSpy)
    h.bridgeQuote.mockImplementation(async (...a) => lifiQuoteFor(a[7]))
    h.crossChainSwap.mockResolvedValue({ hash: '0xbr', waitPromise: Promise.resolve({ status: 1 }) })
    h.buildBridgeCalls.mockResolvedValue([])
    h.quoteAtsTransfer.mockResolvedValue({ fee: '1' })
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: structuredClone(ACC_A),
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: ACC_A.address }, { key: 'k2', address: ACC_B.address }] }],
        currentNetwork: ETH,
        current_transactions: [],
        dapps: {},
    }
    seedQuote(ACC_A.address)
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('fikstur bekcisi', () => {
    it('BSTOCK BSC hissesi; yerel BNB degil; TR bStocks icin engelli', () => {
        expect(stockIssuer(56, BSTOCK)).toBe('bstocks')
        expect(stockIssuer(56, BNB_ZERO)).toBeNull()
        expect(stockIssuer(56, BNB_PLACEHOLDER)).toBeNull()
        expect(BUNDLED.issuers.bstocks.blocked).toContain('TR')
    })
})

describe('BRIDGE -- kapi queued kaydindan ve her ag cagrisindan ONCE', () => {
    it('toTokenAddress = bStock (BSC), ulke bilinmiyor -> { success:false, error: STOCK_GATE:COUNTRY_UNKNOWN }; queued, provider, LI.FI YOK', async () => {
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg() })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('engelli IP (TR, bStocks) -> STOCK_GATE:IP_COUNTRY_ISSUER', async () => {
        serveCountry('TR')
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg() })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it('ATS kolu (atsBridge:true) ayni kapidan gecer: ret, executeAtsTransfer YOK', async () => {
        const res = await callHandler({
            type: 'BRIDGE',
            message: bridgeMsg({ atsBridge: true, fromTokenAddress: USDT_ETH, approvalAddress: ROUTER, atsQuoted: { transferFee: 1, commissionFee: 0 } }),
        })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('TAMAM (ulke AR) -> mevcut yola duser: queued yazilir, LI.FI calistirilir', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg() })
        expect(res).toEqual({ success: true, hash: '0xbr' })
        const rec = await waitForRecord((t) => t?.meta?.type === 'Bridge')
        expect(rec?.meta?.toChainId).toBe(56)
        expect(h.crossChainSwap).toHaveBeenCalledTimes(1)
    })

    // Spec 14 madde 5: arayuz fromChain === toChain'i bir liste filtresiyle engeller (selectToChains.vue:108),
    // ama hedef secildikten sonra ag degisirse ayni zincire dusulebilir. Kapi cikti-anahtarli oldugundan
    // BSC'den BSC'ye bStock aldiran bir kopru de reddedilir.
    it('hedef zincir kaynakla AYNI (56 -> 56): bStock hedefi yine kapidan gecer', async () => {
        localStore.currentNetwork = supported_chains.find((c) => c.chainId === 56)
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ chain: 56, toChain: 56 }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })
})

describe('BRIDGE -- hedef token alani yoksa KAPALI (fail-closed, spec 5.3, K15)', () => {
    // Eski panel (guncelleme oncesi alinmis teklifi gonderen) BSC'ye giden koprude toTokenAddress'siz mesaj
    // yollar; to/data/value mesajdan geldigi icin tek savunma burasi.
    it.each([
        ['undefined', undefined],
        ['bos dize', ''],
        ['bosluk', '   '],
        ['sayi', 5],
        ['null', null],
        ['nesne', {}],
    ])('toChain 56 / "56" ve toTokenAddress %s -> STOCK_GATE:CHECK_FAILED; queued yok, ag yok', async (_ad, toTokenAddress) => {
        for (const toChain of [56, '56']) {
            const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toChain, toTokenAddress }) })
            expect(res).toEqual({ success: false, error: 'STOCK_GATE:CHECK_FAILED' })
        }
        await expectNoSideEffects()
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })

    it('toTokenAddress anahtari mesajda HIC yoksa da ayni (eski panelin gercek sekli)', async () => {
        const message = bridgeMsg()
        delete message.toTokenAddress
        const res = await callHandler({ type: 'BRIDGE', message })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:CHECK_FAILED' })
        await expectNoSideEffects()
    })

    // Hisse edinilemeyen hedefler etkilenmez: eski panel yalniz BSC'ye giden koprude yenilenmeyi gerektirir.
    it('toChain 1, 42161, 137, -239, solana-mainnet, undefined, null ve alan YOK: kapi no-op, kopru yapilir', async () => {
        for (const toChain of [1, 42161, 137, -239, 'solana-mainnet', undefined, null]) {
            const message = bridgeMsg({ toChain })
            delete message.toTokenAddress
            const res = await callHandler({ type: 'BRIDGE', message })
            expect(res, String(toChain)).toEqual({ success: true, hash: '0xbr' })
        }
        expect(h.crossChainSwap).toHaveBeenCalledTimes(7)
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })

    it.each([['sifir adresi', BNB_ZERO], ['0xEeee yer tutucusu', BNB_PLACEHOLDER]])(
        'BSC\'ye yerel BNB hedefi (%s) ACIK kalir: ulke bilinmezken de kopru yapilir, kapi bagimliliklara dokunmaz', async (_ad, toTokenAddress) => {
            const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress }) })
            expect(res).toEqual({ success: true, hash: '0xbr' })
            expect(touched('stock_gate_rules_cache')).toBe(false)
            expect(eligibilityCalls()).toEqual([])
        })
})

describe('BRIDGE -- hisse adresi yazimi ve toChain turu kapiyi ATLATAMAZ (RF4)', () => {
    it.each([
        ['kucuk harf', BSTOCK.toLowerCase(), 56],
        ['buyuk harf govde', `0x${BSTOCK.slice(2).toUpperCase()}`, 56],
        ['checksum', getAddress(BSTOCK.toLowerCase()), 56],
        ['bosluklu', `  ${BSTOCK}  `, 56],
        ['toChain metin ("56")', BSTOCK, '56'],
        ['0x on eki yok (B-F1)', BSTOCK.slice(2), 56],
        ['0x on eki yok, buyuk harf (B-F1)', BSTOCK.slice(2).toUpperCase(), 56],
    ])('%s: STOCK_GATE:IP_COUNTRY_ISSUER', async (_ad, toTokenAddress, toChain) => {
        serveCountry('TR')
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress, toChain }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })
})

// KOK NEDEN / KAPATILAN HATA (main senkron B-F1): 0x on eki olmayan hedef adresi hisse taninmaz; evaluateBridgeTarget 'hisse degil'
// (ok:true, stock:false) doner, BRIDGE / BRIDGE_QUOTE / ATS_BRIDGE_FEE_QUOTE engelli ulkede LI.FI'ye ve ATS backend'ine giderdi.
describe('BRIDGE / BRIDGE_QUOTE / ATS_BRIDGE_FEE_QUOTE -- 0x on eki olmayan hedef adresi kapiyi ATLATAMAZ (B-F1)', () => {
    const adresler = [['0x onekisiz', BSTOCK.slice(2)], ['0x onekisiz buyuk harf', BSTOCK.slice(2).toUpperCase()], ['bosluklu 0x onekisiz', ` ${BSTOCK.slice(2)} `]]

    it.each(adresler)('%s, TR: BRIDGE_QUOTE -> STOCK_GATE:IP_COUNTRY_ISSUER; provider ve LI.FI YOK', async (_ad, address) => {
        serveCountry('TR')
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg({ outToken: { address, decimals: 18 } }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it.each(adresler)('%s, TR: ATS_BRIDGE_FEE_QUOTE -> { success:false, STOCK_GATE:IP_COUNTRY_ISSUER, code }; ATS teklifi YOK', async (_ad, toTokenAddress) => {
        serveCountry('TR')
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg({ toTokenAddress }) })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('pozitif bekci: izinli ulkede (AR) 0x onekisiz hedef kapidan GECER ve LI.FI teklifi alinir', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg({ outToken: { address: BSTOCK.slice(2), decimals: 18 } }) })
        expect(res.success).toBe(true)
        expect(h.bridgeQuote).toHaveBeenCalledTimes(1)
        expect(eligibilityCalls()).toHaveLength(1)
    })
})

// KOK NEDEN / KAPATILAN HATA (main senkron A-MF-3): main'in kopru alici korumasi (assertBridgeQuoteBound, P10) kayit yoksa
// BRIDGE_QUOTE_NOT_FOUND doner. Kapi bu korumadan ONCE oturmali: engelli ulkede, teklif kaydi OLMASA bile, ret kapi reddi olur
// (STOCK_GATE) ve kayda hic bakilmaz. Ust beforeEach her teste teklif kaydini onceden yazdigindan siralama hicbir testte sinanmiyordu;
// koruma kapidan once olsa yalniz hata kodu degisirdi ve yakalanmazdi. Burada kayit SILINIR; pozitif bekci: izinli ulkede ayni
// kayitsiz mesaj korumaya GERCEKTEN takilir.
describe('BRIDGE / ATS_BRIDGE_FEE_QUOTE -- kapi, main kopru alici korumasindan ONCE oturur (A-MF-3)', () => {
    beforeEach(() => { delete sessionStore[BRIDGE_QUOTES_KEY] })

    it('engelli ulke + teklif kaydi YOK: ATS_BRIDGE_FEE_QUOTE -> STOCK_GATE:IP_COUNTRY_ISSUER (BRIDGE_QUOTE_NOT_FOUND DEGIL)', async () => {
        serveCountry('TR')
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg() })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('engelli ulke + teklif kaydi YOK: BRIDGE -> STOCK_GATE:IP_COUNTRY_ISSUER; queued kaydi ve LI.FI YOK', async () => {
        serveCountry('TR')
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg() })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it('pozitif bekci: izinli ulke (AR) + teklif kaydi YOK -> ATS_BRIDGE_FEE_QUOTE alici korumasina takilir (BRIDGE_QUOTE_NOT_FOUND)', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg() })
        expect(res.success).toBe(false)
        expect(res.error).toContain('BRIDGE_QUOTE_NOT_FOUND')
        expect(h.quoteAtsTransfer).not.toHaveBeenCalled()
    })

    it('pozitif bekci: izinli ulke (AR) + teklif kaydi YOK -> BRIDGE alici korumasina takilir, LI.FI imzasi YOK', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg() })
        expect(res.success).toBe(false)
        expect(String(res.error)).toContain('BRIDGE_QUOTE_NOT_FOUND')
        expect(h.crossChainSwap).not.toHaveBeenCalled()
    })
})

describe('BRIDGE -- imza hesabi kapidan gelmez (G23, K39)', () => {
    it('bridge() message.message.account ATAMAZ: LI.FI depodaki aktif hesabin anahtariyla calisir', async () => {
        serveCountry('AR')
        const msg = { type: 'BRIDGE', message: bridgeMsg() }
        const res = await callHandler(msg)
        expect(res).toEqual({ success: true, hash: '0xbr' })
        expect('account' in msg.message).toBe(false)
        expect(h.crossChainSwap).toHaveBeenCalledTimes(1)
        expect(h.crossChainSwap.mock.calls[0][5]).toBe(walletAt(0).privateKey)
    })

    it('aktif hesap baska ise (ACC_B) LI.FI onun anahtariyla calisir: imza hesabini kapi sabitlemez', async () => {
        serveCountry('AR')
        localStore.active_account = structuredClone(ACC_B)
        seedQuote(ACC_B.address)
        const msg = { type: 'BRIDGE', message: bridgeMsg() }
        expect(await callHandler(msg)).toEqual({ success: true, hash: '0xbr' })
        expect('account' in msg.message).toBe(false)
        expect(h.crossChainSwap.mock.calls[0][5]).toBe(walletAt(1).privateKey)
        expect(h.crossChainSwap.mock.calls[0][5]).not.toBe(walletAt(0).privateKey)
    })

    it('hisse olmayan hedefte de hesap nesnesi ATANMAZ', async () => {
        const msg = { type: 'BRIDGE', message: bridgeMsg({ toTokenAddress: BNB_ZERO }) }
        expect(await callHandler(msg)).toEqual({ success: true, hash: '0xbr' })
        expect('account' in msg.message).toBe(false)
    })
})

describe('BRIDGE_QUOTE -- kapi LI.FI /quote ve provider oncesi; teklifte fail-closed YOK (P13)', () => {
    it('hedef bStock, ulke bilinmiyor -> { success:false, error: STOCK_GATE:COUNTRY_UNKNOWN }; provider ve LI.FI YOK', async () => {
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg() })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('engelli IP -> STOCK_GATE:IP_COUNTRY_ISSUER', async () => {
        serveCountry('TR')
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg() })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        await expectNoSideEffects()
    })

    it('TAMAM -> LI.FI teklifi alinir (hedef zincir toChain)', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg() })
        expect(res.success).toBe(true)
        expect(h.bridgeQuote).toHaveBeenCalledTimes(1)
        const args = h.bridgeQuote.mock.calls[0]
        expect(args.slice(0, 7)).toEqual([1, 56, { address: USDT_ETH, decimals: 6 }, { address: BSTOCK, decimals: 18 }, '12', 'RECOMMENDED', 0.5])
    })

    it('hedef hisse degil: kapi depoya ve aga dokunmaz', async () => {
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg({ outToken: { address: BNB_ZERO, decimals: 18 } }) })
        expect(res.success).toBe(true)
        expect(touched('stock_gate_rules_cache')).toBe(false)
        expect(eligibilityCalls()).toEqual([])
    })

    it('P13: outToken adresi eksik -> teklifte kapi acik (fail-closed yalniz BRIDGE ve ATS_BRIDGE_FEE_QUOTE)', async () => {
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg({ outToken: { decimals: 18 } }) })
        expect(res.success).toBe(true)
        expect(h.bridgeQuote).toHaveBeenCalledTimes(1)
        expect(touched('stock_gate_rules_cache')).toBe(false)
    })
})

describe('ATS_BRIDGE_FEE_QUOTE -- toChain + toTokenAddress, ayni kural, provider ve teklif oncesi', () => {
    it('hedef bStock, ulke bilinmiyor -> { success:false, error: STOCK_GATE:<NEDEN>, code: STOCK_GATE }; provider, cagri listesi, teklif YOK', async () => {
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg() })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('toChain 56 ve toTokenAddress YOK -> STOCK_GATE:CHECK_FAILED (fail-closed)', async () => {
        const message = atsMsg()
        delete message.toTokenAddress
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:CHECK_FAILED', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('toChain alani HIC yok (eski panel yuku): kapi no-op, teklif alinir', async () => {
        const message = atsMsg()
        delete message.toChain
        delete message.toTokenAddress
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message })
        expect(res).toMatchObject({ success: true, fee: '1' })
        expect(h.quoteAtsTransfer).toHaveBeenCalledTimes(1)
        expect(touched('stock_gate_rules_cache')).toBe(false)
    })

    it('TAMAM (ulke AR) -> ATS teklifi alinir (opKind bridge)', async () => {
        serveCountry('AR')
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg() })
        expect(res).toMatchObject({ success: true, fee: '1' })
        expect(h.quoteAtsTransfer).toHaveBeenCalledTimes(1)
        expect(h.quoteAtsTransfer.mock.calls[0][0]).toMatchObject({ chainId: 1, opKind: 'bridge' })
    })
})

// KOK NEDEN / KAPATILAN HATA (K28): emekli xStocks adresi (9fb92682) kopru HEDEFI olarak kapisiz ve dislamasiz kaliyordu
// (kapi yalniz katalog hissesine bakiyordu). Hedef emekli adres de kapidan gecer; LI.FI motoru onu ayrica reddeder
// (bridgeXstocks.test.js).
describe('BRIDGE / BRIDGE_QUOTE / ATS_BRIDGE_FEE_QUOTE -- emekli xStocks hedefi (K28)', () => {
    const emekli = (sembol) => RETIRED_XSTOCKS.find((r) => r.symbol === sembol).address
    const PYPLX = emekli('PYPLx')
    const ADBEX = emekli('ADBEx')

    it('fikstur bekcisi: PYPLx ve ADBEx katalog hissesi DEGIL ama cikti tarafinda xstocks', () => {
        expect(stockIssuer(56, PYPLX)).toBeNull()
        expect(stockOutputIssuer(56, PYPLX)).toBe('xstocks')
        expect(stockIssuer(1, ADBEX)).toBeNull()
        expect(stockOutputIssuer(1, ADBEX)).toBe('xstocks')
    })

    it('BRIDGE_QUOTE hedef BSC emekli PYPLx, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN; provider ve LI.FI YOK', async () => {
        const res = await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg({ outToken: { address: PYPLX, decimals: 18 } }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('BRIDGE hedef BSC emekli PYPLx, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN; queued ve LI.FI YOK', async () => {
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress: PYPLX }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('ATS_BRIDGE_FEE_QUOTE hedef BSC emekli PYPLx -> code STOCK_GATE; provider, cagri listesi ve teklif YOK', async () => {
        const res = await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg({ toTokenAddress: PYPLX }) })
        expect(res).toMatchObject({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('hedef zincir BSC DISI (Ethereum) ve emekli ADBEx: kapiya yine girilir (bridgeTargetGated emekli adresi hisse sayar)', async () => {
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toChain: 1, toTokenAddress: ADBEX }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('kapi ihraccisi xstocks sorar: TR bstocks icin engel (IP_COUNTRY_ISSUER) ama xstocks icin yalniz uyari -> emekli PYPLx gecer (dislama LI.FI motorunda: bridgeXstocks.test.js)', async () => {
        serveCountry('TR')
        expect(await callHandler({ type: 'BRIDGE', message: bridgeMsg() })).toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress: PYPLX }) })).toEqual({ success: true, hash: '0xbr' })
    })
})

// KOK NEDEN / KAPATILAN HATA (K28 ilkesinin bStocks karsiligi): emekli bStocks adresi (BMNRB / FLNCB, e7089f2d) BSC'ye
// giden koprude hedef token olarak kapisiz kaliyordu (kapi yalniz katalog hissesine bakiyordu; evaluateBridgeTarget
// stockIssuer null buldugu icin { ok:true, stock:false } donerdi). Hedef emekli adres artik bstocks sayilir.
describe('BRIDGE / BRIDGE_QUOTE / ATS_BRIDGE_FEE_QUOTE -- emekli bStocks hedefi (K28 ilkesi)', () => {
    const [BMNRB, FLNCB] = RETIRED_BSTOCKS.map((r) => r.address)

    it('fikstur bekcisi: BMNRB ve FLNCB katalog hissesi DEGIL ama cikti tarafinda bstocks', () => {
        for (const adres of [BMNRB, FLNCB]) {
            expect(stockIssuer(56, adres)).toBeNull()
            expect(stockOutputIssuer(56, adres)).toBe('bstocks')
        }
    })

    it.each([['BMNRB', BMNRB], ['FLNCB', FLNCB]])('TR + hedef BSC emekli %s: BRIDGE_QUOTE, BRIDGE ve ATS_BRIDGE_FEE_QUOTE -> STOCK_GATE:IP_COUNTRY_ISSUER; provider, queued, LI.FI YOK', async (_ad, adres) => {
        serveCountry('TR')
        expect(await callHandler({ type: 'BRIDGE_QUOTE', message: quoteMsg({ outToken: { address: adres, decimals: 18 } }) }))
            .toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress: adres }) }))
            .toEqual({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER' })
        expect(await callHandler({ type: 'ATS_BRIDGE_FEE_QUOTE', message: atsMsg({ toTokenAddress: adres }) }))
            .toMatchObject({ success: false, error: 'STOCK_GATE:IP_COUNTRY_ISSUER', code: 'STOCK_GATE' })
        await expectNoSideEffects()
    })

    it('hedef emekli BMNRB, ulke bilinmiyor -> STOCK_GATE:COUNTRY_UNKNOWN', async () => {
        const res = await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress: BMNRB }) })
        expect(res).toEqual({ success: false, error: 'STOCK_GATE:COUNTRY_UNKNOWN' })
        await expectNoSideEffects()
    })

    it('uygun ulke (AR): emekli BMNRB hedefi mevcut yola duser (bStocks kopru hedefi acik)', async () => {
        serveCountry('AR')
        expect(await callHandler({ type: 'BRIDGE', message: bridgeMsg({ toTokenAddress: BMNRB }) })).toEqual({ success: true, hash: '0xbr' })
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

    it('getBridgeQuote(): requireEvmVm < kapi < provider < bridgeQuote(; DUZ evaluate (P13), fail-closed YOK', () => {
        const g = body('getBridgeQuote')
        const kapi = at(g, 'await getStockGate()')
        expect(at(g, 'requireEvmVm(toFound)')).toBeLessThan(kapi)
        expect(kapi).toBeLessThan(at(g, 'new ethers.JsonRpcProvider'))
        expect(kapi).toBeLessThan(at(g, 'bridgeQuote('))
        expect(g).toMatch(/stockOutputIssuer\(toChain, outToken\?\.address\)/)
        expect(g).toMatch(/\.evaluate\(/)
        expect(g).not.toMatch(/evaluateBridgeTarget/)
    })

    it('bridge(): destructure toTokenAddress tasir; kapi < uniqueKey < queued; hesap ATANMAZ (G23)', () => {
        const g = body('bridge')
        const kapi = at(g, 'evaluateBridgeTarget(')
        expect(g.slice(0, g.indexOf('uniqueKey()'))).toMatch(/toChain,\s*toTokenAddress,\s*fromTokenData\s*\}\s*=\s*message\.message/)
        expect(kapi).toBeLessThan(at(g, 'uniqueKey()'))
        expect(kapi).toBeLessThan(at(g, "updateTxStatus(txId, 'queued'"))
        // A-MF-3: main'in P10 alici korumasi kapidan SONRA gelir (kapi reddi kayda hic bakmaz)
        expect(kapi).toBeLessThan(at(g, 'assertBridgeQuoteBound('))
        expect(g).not.toMatch(/\.account\s*=/)
        expect(g).not.toMatch(/g\.account/)
    })

    it('atsBridgeFeeQuote(): destructure toChain + toTokenAddress; isAtsChain < kapi < provider, assertBridgeQuoteBound(, buildBridgeCalls(, quoteAtsTransfer(', () => {
        const g = body('atsBridgeFeeQuote')
        const kapi = at(g, 'evaluateBridgeTarget(')
        expect(g.slice(0, g.indexOf('isAtsChain(chainId)'))).toMatch(/toChain,\s*toTokenAddress\s*\}\s*=\s*message\.message/)
        expect(at(g, 'isAtsChain(chainId)')).toBeLessThan(kapi)
        expect(kapi).toBeLessThan(at(g, 'new ethers.JsonRpcProvider'))
        expect(kapi).toBeLessThan(at(g, 'assertBridgeQuoteBound('))
        expect(kapi).toBeLessThan(at(g, 'buildBridgeCalls('))
        expect(kapi).toBeLessThan(at(g, 'quoteAtsTransfer('))
    })

    it('TQ-2: bridge() ve atsBridgeFeeQuote(): kapi esitzamanli on kontrolun (bridgeTargetGated) ICINDE; yardimci hisse hedefi VEYA bridgeStockChainIds zinciri icin sorar (ETH -> ARB gibi hedeflerde kapiya hic girilmez)', () => {
        for (const ad of ['bridge', 'atsBridgeFeeQuote']) {
            const g = body(ad)
            const on = at(g, 'if (bridgeTargetGated(toChain, toTokenAddress)) {')
            expect(on, ad).toBeLessThan(at(g, 'getStockGate().evaluateBridgeTarget('))
        }
        const yardimci = blokGovdesi(BG, /function bridgeTargetGated\([^)]*\)\s*/)
        expect(yardimci, 'bridgeTargetGated govdesi').not.toBeNull()
        expect(yardimci).toMatch(/stockOutputIssuer\(toChain,\s*address\)/)
        expect(yardimci).toMatch(/bridgeStockChainIds\(\)\.includes\(Number\(toChain\)\)/)
        expect(yardimci).not.toMatch(/getStockGate|await/)
    })

    it('hedef zincir mesajdan okunur: aktif ag (currentNetwork) ve kaynak zincir kapiya HEDEF diye verilmez; teklif isleyicileri hesap atamaz', () => {
        for (const ad of ['getBridgeQuote', 'bridge', 'atsBridgeFeeQuote']) {
            expect(body(ad), ad).not.toMatch(/currentNetwork/)
        }
        expect(body('bridge')).not.toMatch(/evaluateBridgeTarget\(\{\s*toChain:\s*chain/)
        expect(body('getBridgeQuote')).not.toMatch(/\.account\s*=/)
        expect(body('atsBridgeFeeQuote')).not.toMatch(/\.account\s*=/)
        expect(yorumsuz(BG)).not.toMatch(/\bg\.account\b/)
    })
})
