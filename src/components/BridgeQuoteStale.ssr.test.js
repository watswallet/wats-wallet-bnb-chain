// Bridge.vue: kopru alici korumasinin arayuz yarisi (gizli-mod cok-ag spec 4.6, P10).
//
// ARKA PLAN iki kodla reddeder (BRIDGE_RECEIVER_MISMATCH, BRIDGE_QUOTE_NOT_FOUND). Ekran: "Teklif alinamadi"
// ya da "Kopru basarisiz" karti DEGIL, kendi cumlesini (bridge.quoteStale) cizer, eski teklifi atar ve teklifi
// yeniden ister. Hesap ya da gizli mod degisince de onbellekteki teklif atilir.
//
// NE OLCULUR: SSR harness'i izleyicileri calistirmaz (ssrRender.js); bu yuzden izleyicinin KENDISI
// composables/useQuoteScopeGuard.test.js'te, izleyicinin bagli oldugu geri cagri (onQuoteScopeChange) ve
// reddin islenmesi burada setupState uzerinden cagrilarak olculur. Izleyicinin bilesene BAGLI oldugu kaynak
// taramasiyla kilitlenir (son describe).
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

// Gercek bakiye aginin hicbirine ihtiyac yok; cagri sayisi ve adresi izlenir.
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// Fiyat sorgusu gercek aga cikmasin (onMounted'ta atsPrice.loadById).
vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())

import { getCurrentInstance } from 'vue'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Bridge from './Bridge.vue'
import supported_chains from '../data/supported_chains.json'

const here = dirname(fileURLToPath(import.meta.url))

// Gnosis: ATS zinciri (ucret ATS ile, payWithAts) ama GASSIZ (Pimlico) zincir DEGIL; teklif sonrasi gaz kontrolu
// transactionRequest olmadan atlanir. Yani ekran teste hicbir ag cagrisi yapmadan kurulur.
const GNOSIS = supported_chains.find((c) => c.chainId === 100)
const POLYGON = supported_chains.find((c) => c.chainId === 137)
const ACTIVE_A = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc-a', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const ACTIVE_B = { address: '0xBbCdEf0000000000000000000000000000000002', key: 'acc-b', type: 'hd', derivationPath: "m/44'/60'/0'/1/0" }
const NATIVE = '0x0000000000000000000000000000000000000000'
const IN_TOKEN = { address: NATIVE, decimals: 18, symbol: 'XDAI' }
const OUT_TOKEN = { address: NATIVE, decimals: 18, symbol: 'POL' }

// LI.FI teklifinin ekranin okudugu parcalari. transactionRequest YALNIZ gonderim ve ucret testlerinde vardir:
// teklif alininca ekran onunla gaz kontrolu icin gercek bir RPC'ye giderdi.
const quote = (tag, { withTx = false } = {}) => ({
    tag,
    action: { fromChainId: 100, toChainId: 137, fromAmount: '1000000000000000000', fromToken: IN_TOKEN, toToken: OUT_TOKEN },
    estimate: { approvalAddress: '0x' + '6b'.repeat(20), toAmount: '990000000000000000', executionDuration: 60 },
    ...(withTx ? { transactionRequest: { to: '0x' + '5a'.repeat(20), data: '0xabcdef', value: '0x0' } } : {}),
})

afterEach(() => {
    useTokenBalanceMock.mockClear()
    vi.useRealTimers()
    delete globalThis.chrome
})

function kur({ locale = 'en', onCapture, active = ACTIVE_A } = {}) {
    const stub = installChromeStub({ currentNetwork: GNOSIS, active_account: active })
    const app = createApp(Bridge)
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    networkStore().currentNetwork = GNOSIS
    pageStore().currentPage = 'bridge'
    cryptoStore().bridge = { inToken: IN_TOKEN, outToken: OUT_TOKEN, toChain: POLYGON, amount: 0 }
    const holder = captureInstance(app, 'Bridge', onCapture)
    return { app, holder, stub }
}

// Ekrani render eder ve ic duruma (setupState) doner; teklif miktari dolu.
async function ekran(opts) {
    const k = kur(opts)
    await render(k.app)
    const s = k.holder.instance.setupState
    s.amount = '1'
    return { ...k, s }
}

// chrome.runtime.sendMessage cagrilarinin SIRASINI kaydeder; `cevaplar[type]` sabit yanit ya da fonksiyon olabilir.
// Yalniz msg.type tutulur: govdelerin arka plandaki teklif kaydinin anahtariyla uyumu Bridge.recordKey.ssr.test.js'te sabitlenir.
function dinle(stub, cevaplar) {
    const cagrilar = []
    stub.setSendMessage(async (msg) => {
        cagrilar.push(msg.type)
        const c = cevaplar[msg.type]
        return typeof c === 'function' ? c(msg) : c
    })
    return cagrilar
}

describe('Bridge.vue (SSR): bridge.quoteStale karti', () => {
    it('quoteStale kapaliyken kart yok', async () => {
        const { app } = kur({ locale: 'tr' })
        const html = await render(app)
        expect(html).not.toContain('Teklif bu hesaba ait değil')
    })

    it.each([
        ['tr', 'Teklif bu hesaba ait değil ya da süresi doldu. Yeni teklif al.'],
        ['en', 'belong to this account or has expired. Get a new quote.'],
    ])('quoteStale acikken %s metni cizilir', async (locale, metin) => {
        const { app } = kur({ locale, onCapture: (i) => { i.setupState.quoteStale = true } })
        const html = await render(app)
        expect(html).toContain(metin)
    })
})

describe('Bridge.vue: BRIDGE_QUOTE reddi (getBridgeData)', () => {
    it.each(['BRIDGE_RECEIVER_MISMATCH', 'BRIDGE_QUOTE_NOT_FOUND'])('%s: kendi cumlesi, "Teklif alinamadi" karti degil', async (kod) => {
        const { s, stub } = await ekran()
        const cagrilar = dinle(stub, { BRIDGE_QUOTE: { success: false, error: kod } })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await s.getBridgeData()
        expect(s.quoteStale).toBe(true)
        expect(s.bridgeQuoteError).toBe(false)
        expect(s.bridgeData).toBeNull()
        expect(s.bridgeLoading).toBe(false)
        // spec 4.6 Daraltma: ret hemen yeniden istenmez (kabul edilen daraltma): ayni yanit donerdi ve dongu olurdu;
        // yenileme 20 sn'lik aralikta. Bir tur gectikten sonra da yalniz ilk istek vardir.
        await new Promise((r) => setTimeout(r, 0))
        expect(cagrilar).toEqual(['BRIDGE_QUOTE'])
    })

    it('baska hata: eski "Teklif alinamadi" karti, quoteStale kapali (mevcut davranis degismez)', async () => {
        const { s, stub } = await ekran()
        dinle(stub, { BRIDGE_QUOTE: { success: false, error: 'No price quote was available.' } })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        await s.getBridgeData()
        expect(s.quoteStale).toBe(false)
        expect(s.bridgeQuoteError).toBe(true)
    })

    it('gecerli teklif gelince mesaj kalkar ve teklif gosterilir', async () => {
        const { s, stub } = await ekran()
        s.quoteStale = true
        dinle(stub, { BRIDGE_QUOTE: { success: true, data: quote('yeni') } })
        await s.getBridgeData()
        expect(s.quoteStale).toBe(false)
        expect(s.bridgeData.tag).toBe('yeni')
    })
})

describe('Bridge.vue: BRIDGE reddi (bridge)', () => {
    // Onay ekrani: ATS ucret teklifi hazir, gonderilecek teklif ekranda.
    async function onayEkrani(cevaplar) {
        const e = await ekran()
        e.s.atsReady = true
        e.s.bridgeData = quote('eski', { withTx: true })
        e.cagrilar = dinle(e.stub, cevaplar)
        return e
    }

    it.each(['BRIDGE_RECEIVER_MISMATCH', 'BRIDGE_QUOTE_NOT_FOUND'])('%s: hata karti DEGIL, eski teklif atilir ve teklif yeniden istenir', async (kod) => {
        // spec 4.6 Daraltma: yeniden istenen teklif ELLE cozulen bir soz; bekledigi surece eski teklif ATILMIS olmali.
        let coz
        const bekleyen = new Promise((r) => { coz = r })
        const { s, cagrilar } = await onayEkrani({
            BRIDGE: { success: false, error: kod },
            BRIDGE_QUOTE: () => bekleyen,
        })
        const bitti = s.bridge()
        for (let i = 0; i < 50 && !cagrilar.includes('BRIDGE_QUOTE'); i++) await new Promise((r) => setTimeout(r, 0))
        expect(cagrilar).toEqual(['BRIDGE', 'BRIDGE_QUOTE'])
        // Yeni teklif hala yolda: eski (reddedilen) teklif ekranda KALMAMALI.
        expect(s.bridgeData).toBeNull()
        coz({ success: true, data: quote('yeni') })
        await bitti
        expect(cagrilar).toEqual(['BRIDGE', 'BRIDGE_QUOTE'])
        expect(s.bridgeError).toBe(false)
        expect(s.bridgeData.tag).toBe('yeni')
        expect(s.quoteStale).toBe(false)
        expect(s.loading).toBe(false)
    })

    it('yeniden istenen teklif de reddedilirse mesaj kalir ve TEK yeniden istek yapilir (dongu yok)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { s, cagrilar } = await onayEkrani({
            BRIDGE: { success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' },
            BRIDGE_QUOTE: { success: false, error: 'BRIDGE_RECEIVER_MISMATCH' },
        })
        await s.bridge()
        expect(cagrilar).toEqual(['BRIDGE', 'BRIDGE_QUOTE'])
        expect(s.quoteStale).toBe(true)
        expect(s.bridgeError).toBe(false)
        expect(s.bridgeQuoteError).toBe(false)
        expect(s.bridgeData).toBeNull()
    })

    it('baska gonderim hatasi: eski "Kopru basarisiz" karti, yeniden teklif ISTENMEZ', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const { s, cagrilar } = await onayEkrani({ BRIDGE: { success: false, error: 'Insufficient balance' } })
        await s.bridge()
        expect(cagrilar).toEqual(['BRIDGE'])
        expect(s.bridgeError).toBe(true)
        expect(s.quoteStale).toBe(false)
        expect(s.bridgeData.tag).toBe('eski')
    })

    it('basarili gonderim degismez', async () => {
        const { s, cagrilar } = await onayEkrani({ BRIDGE: { success: true, hash: '0xh' } })
        // Basari ekrani 1.5 sn sonra ana sayfaya doner (setTimeout); sahte zamanlayici bunu testin disina tasirmaz.
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        await s.bridge()
        expect(cagrilar).toEqual(['BRIDGE'])
        expect(s.bridge_success).toBe(true)
        expect(s.quoteStale).toBe(false)
    })
})

describe('Bridge.vue: ATS ucret teklifi reddi (refreshAtsOpFee)', () => {
    // SSR izleyicileri calistirmaz: `watch(bridgeData)` (yeni teklif -> ucret teklifi) burada isleyemez, bu yuzden
    // yeni teklifin ucretini testler elle ister (`s.bridgeData = ...; await s.refreshAtsOpFee()`).
    const UCRET_OK = { success: true, transferFee: '1', symbol: 'ATS', ready: true, opCount: 1, atsBalance: 10 }

    it.each(['BRIDGE_RECEIVER_MISMATCH', 'BRIDGE_QUOTE_NOT_FOUND'])('%s: eski teklif atilir ve teklif TEK kez yeniden istenir', async (kod) => {
        const { s, stub } = await ekran()
        s.bridgeData = quote('eski', { withTx: true })
        const cagrilar = dinle(stub, {
            ATS_BRIDGE_FEE_QUOTE: { success: false, error: kod },
            BRIDGE_QUOTE: { success: true, data: quote('yeni') },
        })
        await s.refreshAtsOpFee()
        expect(cagrilar).toEqual(['ATS_BRIDGE_FEE_QUOTE', 'BRIDGE_QUOTE'])
        expect(s.bridgeData.tag).toBe('yeni')
        // Gecerli yeni teklif gelince mesaj kalkar (ret yeniden istekle giderildi).
        expect(s.quoteStale).toBe(false)
        // ATS ucret durumu sifirlandi: kirmizi "ucret hesaplanamadi" karti icin atsError kalmadi.
        expect(s.atsError).toBeNull()
    })

    it('ret tekrarlanirsa ikinci yeniden istek YOK (dongu yok), mesaj ve bos teklif kalir', async () => {
        const { s, stub } = await ekran()
        s.bridgeData = quote('a', { withTx: true })
        const cagrilar = dinle(stub, {
            ATS_BRIDGE_FEE_QUOTE: { success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' },
            BRIDGE_QUOTE: { success: true, data: quote('yeni') },
        })
        await s.refreshAtsOpFee()   // 1. ret: yeniden istek
        s.bridgeData = quote('b', { withTx: true })   // izleyici SSR'de yok: yeni teklifin ucretini elle iste
        await s.refreshAtsOpFee()   // 2. ret: bayrak acik, yeniden istek YOK
        expect(cagrilar).toEqual(['ATS_BRIDGE_FEE_QUOTE', 'BRIDGE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE'])
        expect(s.quoteStale).toBe(true)
        expect(s.bridgeData).toBeNull()
        // Tekrarlanan retten sonra da ATS ucret durumu temizdir (kalici kirmizi kart olmaz).
        expect(s.atsError).toBeNull()
    })

    it('basarili ucret teklifi bayragi kapatir: sonraki ret yine TEK yeniden istek yapar', async () => {
        const { s, stub } = await ekran()
        let ucret = { success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' }
        const cagrilar = dinle(stub, { ATS_BRIDGE_FEE_QUOTE: () => ucret, BRIDGE_QUOTE: { success: true, data: quote('yeni') } })
        s.bridgeData = quote('a', { withTx: true })
        await s.refreshAtsOpFee()   // ret -> yeniden istek (bayrak acildi)
        ucret = UCRET_OK
        s.bridgeData = quote('b', { withTx: true })
        await s.refreshAtsOpFee()   // basari -> bayrak kapandi
        ucret = { success: false, error: 'BRIDGE_RECEIVER_MISMATCH' }
        s.bridgeData = quote('c', { withTx: true })
        await s.refreshAtsOpFee()   // ret -> yine yeniden istek
        expect(cagrilar.filter((tur) => tur === 'BRIDGE_QUOTE')).toHaveLength(2)
    })

    it('baska ucret hatasi: teklif korunur, yeniden istek YOK, quoteStale kapali (mevcut davranis)', async () => {
        const { s, stub } = await ekran()
        s.bridgeData = quote('eski', { withTx: true })
        const cagrilar = dinle(stub, { ATS_BRIDGE_FEE_QUOTE: { success: false, error: 'ATS not enabled for chain', code: 'chain-paused' } })
        await s.refreshAtsOpFee()
        expect(cagrilar).toEqual(['ATS_BRIDGE_FEE_QUOTE'])
        expect(s.quoteStale).toBe(false)
        expect(s.bridgeData.tag).toBe('eski')
    })
})

describe('Bridge.vue (SSR): ATS ucret reddinde kirmizi "ucret hesaplanamadi" karti', () => {
    // SSR'da izleyiciler calismaz ve `captureInstance`in onCapture'i render'i BEKLETMEZ. HTML'nin ucret istendikten
    // SONRAKI durumu yansitmasi icin ucret teklifi render SIRASINDA istenir (serverPrefetch: render, donen sozu
    // bekler). Kurulum ekran() ile ayni: Gnosis'te ATS kolu (payWithAts) acik, transactionRequest'li teklif elde.
    async function ucretIstendiktenSonra(ucretCevabi, teklifCevabi) {
        const { app, stub } = kur({ locale: 'en' })
        let durum
        app.mixin({
            serverPrefetch() {
                const instance = getCurrentInstance()
                if (instance?.type?.__name !== 'Bridge') return undefined
                const s = instance.setupState
                return (async () => {
                    s.amount = '1'
                    s.bridgeData = quote('eski', { withTx: true })
                    dinle(stub, { ATS_BRIDGE_FEE_QUOTE: ucretCevabi, BRIDGE_QUOTE: teklifCevabi })
                    await s.refreshAtsOpFee()
                    durum = { atsError: s.atsError, quoteStale: s.quoteStale }
                })()
            },
        })
        const html = await render(app)
        return { html, durum }
    }
    const KIRMIZI = 'Could not calculate fee'

    it('KONTROL: baska bir ATS ucret hatasinda kirmizi kart cizilir (asagidaki negatif iddia bos gecmesin)', async () => {
        const { html, durum } = await ucretIstendiktenSonra({ success: false, error: 'boom' }, { success: true, data: quote('yeni') })
        expect(durum.atsError).toBe('boom')
        expect(html).toContain(KIRMIZI)
    })

    it.each(['BRIDGE_RECEIVER_MISMATCH', 'BRIDGE_QUOTE_NOT_FOUND'])('%s: kirmizi kart CIKMAZ, atsError temiz; yalniz amber quoteStale karti kalir', async (kod) => {
        // Yeniden istenen teklif de reddedilir: ekranda quoteStale kalici olur, son durum kolay ayirt edilir.
        const { html, durum } = await ucretIstendiktenSonra(
            { success: false, error: kod }, { success: false, error: 'BRIDGE_RECEIVER_MISMATCH' })
        expect(durum.atsError).toBeNull()
        expect(durum.quoteStale).toBe(true)
        expect(html).not.toContain(KIRMIZI)
        expect(html).toContain('belong to this account or has expired. Get a new quote.')
    })
})

describe('Bridge.vue: kaynak kilidi (SSR izleyiciyi calistirmaz)', () => {
    const kaynak = yorumsuz(readFileSync(join(here, 'Bridge.vue'), 'utf8'))

    it('miktar/token/filtre izleyicisi eski mesaji sifirlar (izleyici SSR de calismaz)', () => {
        expect(kaynak).toMatch(/bridgeError\.value = false\s+quoteStale\.value = false/)
    })

    it('metin $t(bridge.quoteStale) ile cizilir; kod listesi tek yerden (isBridgeQuoteRefusal)', () => {
        expect(kaynak).toContain("$t('bridge.quoteStale')")
        expect(kaynak).toMatch(/import \{ isBridgeQuoteRefusal \} from '\.\.\/utils\/bridgeQuoteGuard'/)
        // Kod dizgeleri ekranda elle yazilmaz: eklenecek ucuncu kod tek yerde (bridgeQuoteGuard) tanimlanir.
        expect(kaynak).not.toContain('BRIDGE_RECEIVER_MISMATCH')
        expect(kaynak).not.toContain('BRIDGE_QUOTE_NOT_FOUND')
    })
})

describe('Bridge.vue: hesap / gizli mod degisimi (onQuoteScopeChange)', () => {
    it('onbellekteki teklif ve mesaj atilir, ATS ucret durumu sifirlanir, teklif yeni hesap icin yeniden istenir', async () => {
        const { s, stub } = await ekran()
        s.bridgeData = quote('eski-hesap', { withTx: true })
        s.quoteStale = true
        s.atsReady = true
        // Hesap degisti: depodaki aktif hesap artik B.
        stub.localStore.active_account = ACTIVE_B
        const cagrilar = dinle(stub, { BRIDGE_QUOTE: { success: true, data: quote('yeni-hesap') } })
        await s.onQuoteScopeChange()
        expect(cagrilar).toEqual(['BRIDGE_QUOTE'])
        expect(s.bridgeData.tag).toBe('yeni-hesap')
        expect(s.quoteStale).toBe(false)
        expect(s.atsReady).toBe(false)
        // activeAccount depodan tazelendi ve bakiye YENI hesabin adresiyle okundu.
        expect(s.activeAccount.address).toBe(ACTIVE_B.address)
        expect(useTokenBalanceMock.mock.calls.at(-1)[0]).toBe(ACTIVE_B.address)
    })

    it('teklif yeni hesabin yoluyla istenir (index)', async () => {
        const { s, stub } = await ekran()
        stub.localStore.active_account = ACTIVE_B
        let govde
        dinle(stub, { BRIDGE_QUOTE: (msg) => { govde = msg.message; return { success: true, data: quote('yeni') } } })
        await s.onQuoteScopeChange()
        expect(govde.index).toBe(ACTIVE_B.derivationPath)
    })

    it('yeni teklif BEKLENIRKEN eski hesabin teklifi ekranda ve onaylanabilir KALMAZ', async () => {
        const { s, stub } = await ekran()
        s.bridgeData = quote('eski-hesap', { withTx: true })
        let yeniyiBitir
        stub.setSendMessage(() => new Promise((resolve) => { yeniyiBitir = () => resolve({ success: true, data: quote('yeni-hesap') }) }))
        const degisim = s.onQuoteScopeChange()
        await vi.waitFor(() => expect(yeniyiBitir).toBeTypeOf('function'))
        expect(s.bridgeData, 'yeni teklif gelene dek eski teklif gorunur kaldi').toBeNull()
        yeniyiBitir()
        await degisim
        expect(s.bridgeData.tag).toBe('yeni-hesap')
    })

    it('degisim sirasinda ucusta olan ESKI hesabin teklifi sonucu YAZAMAZ', async () => {
        const { s, stub } = await ekran()
        // 1) Eski hesap icin bir teklif ucusta (cevabi elle tutulur).
        let eskiyiBitir
        stub.setSendMessage(() => new Promise((resolve) => { eskiyiBitir = () => resolve({ success: true, data: quote('eski-ucusta') }) }))
        const ucustaki = s.getBridgeData()
        await vi.waitFor(() => expect(eskiyiBitir).toBeTypeOf('function'))
        // 2) Hesap degisti; geri cagri depoyu okurken (ilk await) eski cevap gelir.
        let depoyuBitir
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = vi.fn((keys) => new Promise((resolve) => { depoyuBitir = () => resolve(gercekGet(keys)) }))
        dinle(stub, { BRIDGE_QUOTE: { success: true, data: quote('yeni-hesap') } })
        const degisim = s.onQuoteScopeChange()
        await vi.waitFor(() => expect(depoyuBitir).toBeTypeOf('function'))
        eskiyiBitir()
        await ucustaki
        expect(s.bridgeData, 'eski hesabin teklifi ekrana yazildi').toBeNull()
        // 3) Geri cagri devam eder; yeni teklif yazilir.
        globalThis.chrome.storage.local.get = gercekGet
        depoyuBitir()
        await degisim
        expect(s.bridgeData.tag).toBe('yeni-hesap')
    })

    it('miktar bos ise teklif ISTENMEZ ama onbellek ve eski mesaj yine atilir', async () => {
        const { s, stub } = await ekran()
        s.amount = null
        s.bridgeData = quote('eski', { withTx: true })
        // getBridgeData bos miktarda quoteStale'e dokunmadan doner: eski mesaji temizleyen geri cagridir.
        s.quoteStale = true
        const cagrilar = dinle(stub, { BRIDGE_QUOTE: { success: true, data: quote('yeni') } })
        await s.onQuoteScopeChange()
        expect(cagrilar).toEqual([])
        expect(s.bridgeData).toBeNull()
        expect(s.quoteStale).toBe(false)
    })

    it('depo okunamazsa geri cagri FIRLATMAZ ve KAPALI-BASARISIZ olur: hesap null, "Teklif alinamadi" karti, bakiye sifir, yeni teklif ISTENMEZ', async () => {
        const { s, stub } = await ekran()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        s.bridgeData = quote('eski-hesap', { withTx: true })
        s.inBalance = 5
        s.bridgeLoading = true
        const cagrilar = dinle(stub, { BRIDGE_QUOTE: { success: true, data: quote('yeni') } })
        const gercekGet = globalThis.chrome.storage.local.get
        // Yalniz geri cagrinin kendi okumasi ('active_account' dizgesi) basarisiz olur; getBridgeData dizi anahtar kullanir.
        // Boylece "hesap okunamadi ama teklif yine de istendi" hatasi (kapali-basarisiz OLMAMA) bu testte gorunur.
        globalThis.chrome.storage.local.get = vi.fn(async (keys) => {
            if (keys === 'active_account') throw new Error('depo yok')
            return gercekGet(keys)
        })
        // Izleyicide firlarsa Vue eszamansiz hata isleyicisine duserdi: geri cagri cozulur.
        await expect(s.onQuoteScopeChange()).resolves.toBeUndefined()
        // ESKI hesapla YENI teklif karismaz: eski adres getBridgeData'nin gaz kontrolunde kullanilamaz.
        expect(s.activeAccount).toBeNull()
        expect(s.bridgeQuoteError).toBe(true)
        expect(s.bridgeData).toBeNull()
        expect(s.inBalance).toBe(0)
        expect(s.bridgeLoading).toBe(false)
        expect(cagrilar).toEqual([])
    })

    it('bakiye okumasi (RPC) basarisiz olursa eski hesabin bakiyesi KALMAZ: hesap B, bakiye 0, teklif yine istenir', async () => {
        const { s, stub } = await ekran()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        s.inBalance = 5
        stub.localStore.active_account = ACTIVE_B
        const cagrilar = dinle(stub, { BRIDGE_QUOTE: { success: true, data: quote('yeni-hesap') } })
        // updateBalances RPC hatasini yutar (catch + console.error) ve inBalance'a dokunmadan doner: sifirlama geri cagrida.
        useTokenBalanceMock.mockRejectedValueOnce(new Error('rpc'))
        await s.onQuoteScopeChange()
        expect(s.activeAccount.address).toBe(ACTIVE_B.address)
        expect(s.inBalance, 'eski hesabin bakiyesi yeni hesabin teklifinin yaninda kaldi').toBe(0)
        expect(cagrilar).toEqual(['BRIDGE_QUOTE'])
        expect(s.bridgeData.tag).toBe('yeni-hesap')
    })

    it('ATS ucret reddi bayragi hesap degisiminde sifirlanir: onceki ret hakki harcamis olsa da sonraki ret yine TEK yeniden istek yapar', async () => {
        const { s, stub } = await ekran()
        s.bridgeData = quote('a', { withTx: true })
        const cagrilar = dinle(stub, {
            ATS_BRIDGE_FEE_QUOTE: { success: false, error: 'BRIDGE_QUOTE_NOT_FOUND' },
            BRIDGE_QUOTE: { success: true, data: quote('yeni') },
        })
        await s.refreshAtsOpFee()   // 1. ret: yeniden istek, bayrak acildi
        stub.localStore.active_account = ACTIVE_B
        await s.onQuoteScopeChange()   // hesap degisti: yeni teklif istenir, bayrak sifirlanir
        s.bridgeData = quote('b', { withTx: true })   // izleyici SSR'de yok: yeni teklifin ucretini elle iste
        await s.refreshAtsOpFee()   // 2. ret: bayrak sifirlandigi icin yine TEK yeniden istek
        expect(cagrilar).toEqual(['ATS_BRIDGE_FEE_QUOTE', 'BRIDGE_QUOTE', 'BRIDGE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE', 'BRIDGE_QUOTE'])
        expect(s.quoteStale).toBe(false)
        expect(s.bridgeData.tag).toBe('yeni')
    })
})


// Izleyicinin KENDI davranisi (kurulurken ateslememe, tek ateslemeli degisim, immediate/sync olmama)
// composables/useQuoteScopeGuard.test.js'te olculur; burada yalniz bilesene BAGLI oldugu kilitlenir.
describe('Bridge.vue: hesap/mod izleyicisi bilesene baglidir (SSR izleyiciyi calistirmaz)', () => {
    const kaynak = yorumsuz(readFileSync(join(here, 'Bridge.vue'), 'utf8'))

    it('useQuoteScopeGuard(onQuoteScopeChange) cagrilir ve composable ice aktarilir', () => {
        expect(kaynak).toMatch(/useQuoteScopeGuard\(onQuoteScopeChange\)/)
        expect(kaynak).toMatch(/import \{ useQuoteScopeGuard \} from '\.\.\/composables\/useQuoteScopeGuard'/)
    })
})
