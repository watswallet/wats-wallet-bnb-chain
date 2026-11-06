// Bridge.vue: UC istek govdesi (BRIDGE_QUOTE, ATS_BRIDGE_FEE_QUOTE, BRIDGE) arka plandaki teklif kaydinin anahtarina
// baglanir (gizli-mod cok-ag spec 4.6, P10).
//
// ACIK: arka plan her gecerli teklif icin oturum deposuna (zincir, to, data, value) anahtarli bir kayit yazar
// (getBridgeQuote) ve gonderimde ayni anahtari mesajdan yeniden kurup arar (bridge, atsBridgeFeeQuote). Anahtarin
// UC ucu Bridge.vue'da ayri ayri, ayri nesnelerden kurulur:
//   BRIDGE_QUOTE          fromChain = network.currentNetwork.chainId                       (getBridgeData)
//   ATS_BRIDGE_FEE_QUOTE  chainId = action.fromChainId; to, data, value = transactionRequest   (refreshAtsOpFee)
//   BRIDGE                chain = action.fromChainId; to, data, value = transactionRequest      (bridge)
// Bu ucu baska hicbir test birbirine baglamaz: background.bridgeGuard.test.js'teki bridgeMsg() / feeMsg() Bridge.vue'dan
// ELLE kopyalanmis govdelerdir, BridgeQuoteStale.ssr.test.js ise yalniz msg.type'i tutar. Koruma iki modda da
// zorunlu oldugundan, bir govdenin bozulmasi (value sayiya cevrilir, zincir baska yerden okunur, to/data baska
// nesneden alinir) her normal kullanicinin koprusunu SESSIZCE BRIDGE_QUOTE_NOT_FOUND yapar: kapali-basarisiz oldugu
// icin para riski yoktur, ama kopru herkes icin olur ve baska hicbir test kirmizi olmaz.
//
// NE OLCULUR: ekran GERCEK Bridge.vue. Arka plan yerine, background.js'teki uc cagri yerinin AYNI alan eslemesiyle
// GERCEK rememberBridgeQuote / assertBridgeQuoteBound (utils/bridgeQuoteGuard.js) calisir; oturum deposu duz bir
// nesne uzerinde sahte { get, set }'tir. Ekran getBridgeData -> refreshAtsOpFee -> bridge sirasiyla surulur ve guard
// hicbir istegi reddetmemelidir. Alan eslemesinin background.js'teki kaynagi son describe'ta kaynak taramasiyla
// kilitlenir: orada bir ad degisirse bu dosyadaki kopya sessizce eskimez, kirmizi olur.
//
// Iki senaryo (canli LI.FI /quote yanitlarinin bicimi: fromChainId SAYI, value HEX dizge, action.toAddress ve
// fromAddress istekteki adresle yankilanir): native kaynak + sifirdan farkli value + onay adresi router'dan AYRI, ve
// ERC-20 kaynak + value '0x0' + onay adresi router ile AYNI (canlida estimate.approvalAddress == transactionRequest.to).
// Yalniz birinde ayirt edilen bir govde hatasi (ornegin onay adresi yerine to gondermek) boylece yakalanir.
//
// main'e alinirken BridgeQuoteStale.ssr.test.js ile ayni bagimlilik uyarlamasi gerekir (test-utils/offlineMocks.js
// main'de yok); Bridge.vue ve bridgeQuoteGuard.js oldugu gibi gider.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Gercek bakiye aginin hicbirine ihtiyac yok.
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// Fiyat sorgusu gercek aga cikmasin (onMounted'ta atsPrice.loadById).
vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())

// Teklif transactionRequest tasiyinca getBridgeData gaz kontrolu icin bir JsonRpcProvider kurar: GERCEK bir RPC'ye
// cikmasin. ethers'in geri kalani (id, parseUnits, formatUnits, getAddress) GERCEK kalir: kayit anahtari ethers.id ile kurulur.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class SahteSaglayici {
        async getBalance() { return 10n ** 20n }
        async getFeeData() { return { maxFeePerGas: 1n, gasPrice: 1n } }
    }
    return { ...actual, ethers: { ...actual.ethers, JsonRpcProvider: SahteSaglayici } }
})

import { getAddress } from 'ethers'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import { rememberBridgeQuote, assertBridgeQuoteBound, bridgeQuoteKey, BRIDGE_QUOTES_KEY } from '../utils/bridgeQuoteGuard'
import Bridge from './Bridge.vue'
import supported_chains from '../data/supported_chains.json'

const here = dirname(fileURLToPath(import.meta.url))

// Gnosis: ATS zinciri (ucret ATS ile, payWithAts) ama GASSIZ (Pimlico) zincir DEGIL; ekran RPC'siz kurulur.
const GNOSIS = supported_chains.find((c) => c.chainId === 100)
const POLYGON = supported_chains.find((c) => c.chainId === 137)
const ACCOUNT = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc-a', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const NATIVE = '0x0000000000000000000000000000000000000000'
const XDAI = { address: NATIVE, decimals: 18, symbol: 'XDAI' }
const USDC = { address: getAddress('0x' + 'dd'.repeat(20)), decimals: 6, symbol: 'USDC' }
const OUT_TOKEN = { address: NATIVE, decimals: 18, symbol: 'POL' }
const ROUTER = getAddress('0x' + '5a'.repeat(20))
const SPENDER = getAddress('0x' + '6b'.repeat(20))
const CALLDATA = '0x' + 'ab'.repeat(68)
const UCRET_OK = { success: true, transferFee: '1', symbol: 'ATS', ready: true, opCount: 1, atsBalance: 10 }

const SCENARIOS = [
    ['native kaynak, sifirdan farkli hex value, onay adresi router degil',
        { inToken: XDAI, fromAmount: '1000000000000000000', value: '0xde0b6b3a7640000', approvalAddress: SPENDER }],
    ['ERC-20 kaynak, value 0x0, onay adresi router ile ayni (canli LI.FI bicimi)',
        { inToken: USDC, fromAmount: '1000000', value: '0x0', approvalAddress: ROUTER }],
]

// Canli LI.FI /quote yanitinin ekranin ve guard'in okudugu parcalari. toAddress ve fromAddress imzaciyla ayni (kayit
// zorunlu kilar); fromChainId SAYIDIR; transactionRequest.value HEX dizgedir.
const lifiQuote = ({ inToken, fromAmount, value, approvalAddress }) => ({
    id: 'lifi-canli-bicim',
    action: {
        fromChainId: 100, toChainId: 137, fromAddress: ACCOUNT.address, toAddress: ACCOUNT.address,
        fromAmount, fromToken: inToken, toToken: OUT_TOKEN,
    },
    estimate: { approvalAddress, toAmount: '990000000000000000', executionDuration: 60 },
    transactionRequest: { from: ACCOUNT.address, to: ROUTER, chainId: 100, data: CALLDATA, value },
})

// chrome.storage.session'in { get, set } yuzu, duz bir nesne uzerinde. Gercek depo JSON tabanlidir: deger JSON gidis-
// donusunden gecer, boylece JSON'a uymayan bir kayit burada da dusar.
function fakeSession() {
    const store = {}
    return {
        store,
        get: async (key) => (key in store ? { [key]: JSON.parse(JSON.stringify(store[key])) } : {}),
        set: async (obj) => { for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v)) },
    }
}

// SAHTE ARKA PLAN. Alan eslemesi background.js'tekiyle AYNIDIR (son describe onu kaynak taramasiyla kilitler):
//   getBridgeQuote     rememberBridgeQuote(chrome.storage.session, { fromChain, quote: data, signer: wallet.address })
//   atsBridgeFeeQuote  assertBridgeQuoteBound(chrome.storage.session, { chain: chainId, to, data, value, approvalAddress, signer })
//   bridge             assertBridgeQuoteBound(chrome.storage.session, { chain, to, data, value, approvalAddress, signer })
// `signer` (wallet.address) mesajdaki `index`ten cozulur (resolveAccount): bilinmeyen index imzaciyi tanimsiz birakir ve
// guard reddeder. Guard'in firlattigi her hata `redler`e yazilir ve arka planin gercek yaniti gibi doner
// ({ success: false, error }); testler `redler`in bos kalmasini ister.
function arkaPlan(stub, quote) {
    const gorulen = []   // sirayla { type, message }: ekranin yolladigi TAM mesajlar
    const redler = []    // guard'in attigi her hata: { type, error }
    const imzaci = (m) => (m.index === ACCOUNT.derivationPath ? ACCOUNT.address : undefined)
    stub.setSendMessage(async ({ type, message: m }) => {
        gorulen.push({ type, message: m })
        const session = globalThis.chrome.storage.session
        try {
            if (type === 'BRIDGE_QUOTE') {
                await rememberBridgeQuote(session, { fromChain: m.fromChain, quote, signer: imzaci(m) })
                return { success: true, data: quote }
            }
            if (type === 'ATS_BRIDGE_FEE_QUOTE') {
                await assertBridgeQuoteBound(session, {
                    chain: m.chainId, to: m.to, data: m.data, value: m.value, approvalAddress: m.approvalAddress, signer: imzaci(m),
                })
                return { ...UCRET_OK }
            }
            if (type === 'BRIDGE') {
                await assertBridgeQuoteBound(session, {
                    chain: m.chain, to: m.to, data: m.data, value: m.value, approvalAddress: m.approvalAddress, signer: imzaci(m),
                })
                return { success: true, hash: '0xhash' }
            }
        } catch (e) {
            redler.push({ type, error: e.message })
            return { success: false, error: e.message }
        }
        return { success: false, error: `beklenmeyen mesaj: ${type}` }
    })
    return { gorulen, redler }
}

afterEach(() => {
    useTokenBalanceMock.mockClear()
    vi.useRealTimers()
    delete globalThis.chrome
})

// Ekrani kurar, render eder; chrome.runtime.sendMessage sahte arka plana baglanir. Miktar 1.
async function ekran(senaryo) {
    const stub = installChromeStub({ currentNetwork: GNOSIS, active_account: ACCOUNT })
    const session = fakeSession()
    globalThis.chrome.storage.session = session
    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = GNOSIS
    pageStore().currentPage = 'bridge'
    cryptoStore().bridge = { inToken: senaryo.inToken, outToken: OUT_TOKEN, toChain: POLYGON, amount: 0 }
    const holder = captureInstance(app, 'Bridge')
    await render(app)
    const s = holder.instance.setupState
    s.amount = '1'
    const quote = lifiQuote(senaryo)
    return { s, session, quote, ...arkaPlan(stub, quote) }
}

// Ekran akisinin tamami: teklif al, ATS ucret teklifi iste, gonder. Her adimdan sonra guard'in hicbir istegi
// reddetmedigini ister (ilk bozuk adim kendi mesajiyla duser, sonraki adimlarin kafa karistirici hatalari beklenmez).
async function surus(senaryo) {
    const e = await ekran(senaryo)
    const { s, session, quote, redler } = e

    await s.getBridgeData()
    expect(redler, 'BRIDGE_QUOTE: alici/imzaci/anahtar kaydi reddedildi').toEqual([])
    expect(s.bridgeData?.id, 'BRIDGE_QUOTE: teklif ekrana gelmedi').toBe(quote.id)
    const anahtar = bridgeQuoteKey(GNOSIS.chainId, quote.transactionRequest.to, quote.transactionRequest.data, quote.transactionRequest.value)
    expect(Object.keys(session.store[BRIDGE_QUOTES_KEY] ?? {}), 'BRIDGE_QUOTE: kayit beklenen (zincir, to, data, value) anahtariyla yazilmadi').toEqual([anahtar])

    await s.refreshAtsOpFee()
    expect(redler, 'ATS_BRIDGE_FEE_QUOTE: ucret teklifi kayda baglanamadi').toEqual([])
    expect(s.atsError).toBeNull()
    expect(s.atsReady, 'ATS_BRIDGE_FEE_QUOTE: ucret teklifi hazir degil').toBe(true)

    // Basari ekrani 1.5 sn sonra ana sayfaya doner (setTimeout); sahte zamanlayici bunu testin disina tasirmaz.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await s.bridge()
    expect(redler, 'BRIDGE: gonderim kayda baglanamadi').toEqual([])
    expect(s.bridgeError).toBe(false)
    expect(s.bridge_success).toBe(true)
    expect(s.quoteStale).toBe(false)
    return e
}

describe('Bridge.vue: uc govde arka plan teklif kaydinin anahtarina baglanir (gercek guard, sahte depo)', () => {
    it.each(SCENARIOS)('%s: getBridgeData -> refreshAtsOpFee -> bridge, hicbir istek reddedilmez', async (_ad, senaryo) => {
        const { gorulen } = await surus(senaryo)
        expect(gorulen.map((g) => g.type)).toEqual(['BRIDGE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE', 'BRIDGE'])
        // Onay baglamasi bos gecmesin: guard, mesajda onay adresi YOKSA onu denetlemez. ATS kolunda ikisi de tasimali.
        const [, ucret, gonderim] = gorulen.map((g) => g.message)
        expect(ucret.approvalAddress, 'ATS_BRIDGE_FEE_QUOTE onay adresini tasimiyor: guard onay baglamasini sessizce atlar').toBe(senaryo.approvalAddress)
        expect(gonderim.approvalAddress, 'BRIDGE onay adresini tasimiyor: guard onay baglamasini sessizce atlar').toBe(senaryo.approvalAddress)
    })

    it('KONTROL: sahte arka plan gercekten reddeder (govde alani bozulunca anahtar ya da onay tutmaz; yukaridaki yesil bos gecmesin)', async () => {
        const { gorulen } = await surus(SCENARIOS[0][1])
        const [, ucret, gonderim] = gorulen.map((g) => g.message)
        const gonder = (type, message) => globalThis.chrome.runtime.sendMessage({ type, message })
        const NOT_FOUND = { success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' }
        const MISMATCH = { success: false, error: 'BRIDGE_RECEIVER_MISMATCH' }
        // Senaryo 0'da value sifirdan farkli ve onay adresi router degil: her bozulma ayirt edilir.
        const bozulmalar = [
            ['ucret: value sayiya cevrilmis', 'ATS_BRIDGE_FEE_QUOTE', { ...ucret, value: String(Number(ucret.value)) }, NOT_FOUND],
            ['ucret: zincir hedef zincir', 'ATS_BRIDGE_FEE_QUOTE', { ...ucret, chainId: POLYGON.chainId }, NOT_FOUND],
            ['ucret: to yerine onay adresi', 'ATS_BRIDGE_FEE_QUOTE', { ...ucret, to: ucret.approvalAddress }, NOT_FOUND],
            ['ucret: onay adresi yerine to', 'ATS_BRIDGE_FEE_QUOTE', { ...ucret, approvalAddress: ucret.to }, MISMATCH],
            ['gonderim: value sayiya cevrilmis', 'BRIDGE', { ...gonderim, value: Number(gonderim.value) }, NOT_FOUND],
            ['gonderim: zincir hedef zincir', 'BRIDGE', { ...gonderim, chain: POLYGON.chainId }, NOT_FOUND],
            ['gonderim: to yerine onay adresi', 'BRIDGE', { ...gonderim, to: gonderim.approvalAddress }, NOT_FOUND],
            ['gonderim: onay adresi yerine to', 'BRIDGE', { ...gonderim, approvalAddress: gonderim.to }, MISMATCH],
            ['gonderim: baska hesabin index\'i', 'BRIDGE', { ...gonderim, index: "m/44'/60'/0'/0/1" }, MISMATCH],
        ]
        for (const [ad, type, message, beklenen] of bozulmalar) {
            expect(await gonder(type, message), ad).toEqual(beklenen)
        }
        // Bozulmamis kopyalar hala geciyor: ret govdeden geliyor, depodan ya da sureden degil.
        expect((await gonder('ATS_BRIDGE_FEE_QUOTE', { ...ucret })).success).toBe(true)
        expect((await gonder('BRIDGE', { ...gonderim })).success).toBe(true)
    })
})

// Bu dosyanin sahte arka plani background.js'teki uc cagri yerinin alan eslemesini KOPYALAR. Kopya sessizce eskirse
// (alan adi degisir, cagri baska bir nesneden beslenir) yesil kalir ama gercek akisi artik olcmez; bu yuzden eslemenin
// kendisi kilitlenir. Bir ad bilerek degisirse buradaki kalip, arayuz govdeleri (Bridge.vue) ve arkaPlan() birlikte guncellenir.
describe('Bridge.vue: sahte arka planin alan eslemesi background.js ile ayni (kaynak kilidi)', () => {
    const kaynak = yorumsuz(readFileSync(join(here, '..', 'background.js'), 'utf8')).replace(/\s+/g, ' ')

    it('getBridgeQuote: kayit fromChain (mesajdan), LI.FI yaniti ve cuzdan adresiyle yazilir', () => {
        expect(kaynak).toMatch(/rememberBridgeQuote\(chrome\.storage\.session, \{ fromChain, quote: data, signer: wallet\.address \}\)/)
    })

    it('atsBridgeFeeQuote: zincir mesajin chainId alani, to/data/value/onay adresi mesajdan', () => {
        expect(kaynak).toMatch(/assertBridgeQuoteBound\(chrome\.storage\.session, \{ chain: chainId, to, data, value, approvalAddress, signer: wallet\.address,? \}\)/)
    })

    it('bridge: zincir mesajin chain alani, to/data/value mesajdan, onay adresi message.message.approvalAddress', () => {
        expect(kaynak).toMatch(/assertBridgeQuoteBound\(chrome\.storage\.session, \{ chain, to, data, value, approvalAddress: message\.message\.approvalAddress, signer: wallet\.address,? \}\)/)
    })
})
