// Swap.vue: hesap / gizli mod degisince onbellekteki teklifin atilmasi ve bakiyelerin yeni hesapla tazelenmesi
// (gizli-mod cok-ag spec 4.6 madde 4, P10).
//
// Takas teklifi arka planda aktif hesaptan kurulur ve alici imzacidir; yine de ekran bayat teklifi (eski hesabin
// fiyati, gaz tahmini, ATS ucreti) ve eski hesabin bakiyesini (okuBakiye `activeAccount`tan okur, o yalniz
// onMounted'ta atanirdi) gostermemeli ve onaylatmamali. Izleyicinin KENDISI
// composables/useQuoteScopeGuard.test.js'te olculur (SSR harness'i izleyicileri calistirmaz); burada izleyicinin
// bagli oldugu geri cagri (onQuoteScopeChange) setupState uzerinden cagrilir ve izleyicinin bilesene baglandigi
// kaynak taramasiyla kilitlenir.
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

const tonFeeLoad = vi.hoisted(() => vi.fn(async () => {}))
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// TON dali ve fiyat sorgulari gercek aga/kasaya cikmasin (bkz. Swap.ssr.test.js ayni sabitlemeler).
vi.mock('../utils/ton/tonIdentity', () => ({
    ensureTonAddress: async () => 'UQTestTonAddress000000000000000000000000000000',
}))
vi.mock('../composables/useTonFee', async () => {
    const { ref } = await import('vue')
    return {
        useTonFee: () => ({
            atsMaxFee: ref(null), atsMaxFeeRaw: ref(null), relayActive: ref(false), statusUnreadable: ref(false),
            ready: ref(false), decision: ref(null), quote: ref(null), budget: ref(null),
            loading: ref(false), onboarding: ref(false), error: ref(null),
            load: (...args) => tonFeeLoad(...args), stop: () => {}, runOnboarding: async () => {},
        }),
    }
})
vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'

const here = dirname(fileURLToPath(import.meta.url))

// Gnosis: ATS zinciri (payWithAts, ucret teklifi istenir) ama GASSIZ zincir degil ve teklifte estimatedGasFee
// olmadigi surece gaz kontrolu RPC'ye gitmez: ekran teste hicbir ag cagrisi yapmadan kurulur.
const GNOSIS = supported_chains.find((c) => c.chainId === 100)
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
const ACTIVE_A = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc-a', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const ACTIVE_B = { address: '0xAbCdEf0000000000000000000000000000000002', key: 'acc-b', type: 'hd', derivationPath: "m/44'/60'/0'/1/0" }
const OUT_TOKEN = { address: '0x' + '11'.repeat(20), decimals: 18, symbol: 'TKN' }

afterEach(() => {
    useTokenBalanceMock.mockClear()
    tonFeeLoad.mockClear()
    delete globalThis.chrome
})

async function ekran(zincir = GNOSIS) {
    const stub = installChromeStub({ currentNetwork: zincir, active_account: ACTIVE_A })
    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = zincir
    pageStore().currentPage = 'swap'
    // inToken null: ekran bu zincirin native'iyle tohumlar (ensureSwapInToken).
    cryptoStore().swap = { inToken: null, outToken: OUT_TOKEN }
    const holder = captureInstance(app, 'Swap')
    await render(app)
    const s = holder.instance.setupState
    s.inTokenAmount = '1'
    return { s, stub }
}

// chrome.runtime.sendMessage cagrilarinin SIRASINI ve govdelerini kaydeder.
function dinle(stub, cevaplar) {
    const cagrilar = []
    stub.setSendMessage(async (msg) => {
        cagrilar.push(msg)
        const c = cevaplar[msg.type]
        return typeof c === 'function' ? c(msg) : c
    })
    return cagrilar
}
const FEE_OK = { success: true, transferFee: '1', symbol: 'ATS', ready: true, opCount: 1, atsBalance: 10 }
// ATS yakit bakiyesi okumasi (ATS_FUEL_BALANCE) teklif akisindan AYRI bir yandir: teklif testleri onu saymaz.
const teklifCagrilari = (cagrilar) => cagrilar.filter((m) => m.type !== 'ATS_FUEL_BALANCE')

describe('Swap.vue: hesap / gizli mod degisimi (onQuoteScopeChange)', () => {
    it('onbellekteki teklif ve hatalar atilir, ATS ucret durumu sifirlanir; teklif ve ucret yeni hesap icin yeniden istenir', async () => {
        const { s, stub } = await ekran()
        s.swapData = { tag: 'eski-hesap' }
        s.quoteError = 'route'
        s.atsReady = true
        stub.localStore.active_account = ACTIVE_B
        const cagrilar = dinle(stub, {
            SWAP_QUOTE: { data: { tag: 'yeni-hesap', expectedOutput: '1' } },
            ATS_SWAP_FEE_QUOTE: FEE_OK,
        })
        await s.onQuoteScopeChange()
        expect(teklifCagrilari(cagrilar).map((m) => m.type)).toEqual(['SWAP_QUOTE', 'ATS_SWAP_FEE_QUOTE'])
        // Yeni hesabin yolu iki istekte de gider.
        for (const m of teklifCagrilari(cagrilar)) expect(m.message.index).toBe(ACTIVE_B.derivationPath)
        expect(s.swapData.tag).toBe('yeni-hesap')
        expect(s.quoteError).toBeNull()
    })

    it('activeAccount depodan tazelenir; giris ve cikis bakiyesi YENI hesabin adresiyle yeniden okunur', async () => {
        const { s, stub } = await ekran()
        stub.localStore.active_account = ACTIVE_B
        useTokenBalanceMock.mockClear()
        dinle(stub, { SWAP_QUOTE: { data: { tag: 'yeni-hesap' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        await s.onQuoteScopeChange()
        expect(s.activeAccount.address).toBe(ACTIVE_B.address)
        // Giris (inToken) + cikis (outToken) bakiyesi: iki okuma, ikisi de YENI adresle.
        expect(useTokenBalanceMock).toHaveBeenCalledTimes(2)
        for (const [adres] of useTokenBalanceMock.mock.calls) expect(adres).toBe(ACTIVE_B.address)
    })

    it('depo okunamazsa geri cagri FIRLATMAZ ve KAPALI-BASARISIZ olur: hesap null, teklif hata karti, bakiyeler sifir, yeni teklif ISTENMEZ', async () => {
        const { s, stub } = await ekran()
        vi.spyOn(console, 'error').mockImplementation(() => {})
        s.swapData = { tag: 'eski-hesap' }
        s.inBalance = 5
        s.outBalance = 3
        s.swapLoading = true
        const cagrilar = dinle(stub, { SWAP_QUOTE: { data: { tag: 'yeni' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        const gercekGet = globalThis.chrome.storage.local.get
        // Yalniz geri cagrinin kendi okumasi ('active_account' dizgesi) basarisiz olur; getSwapData dizi anahtar kullanir.
        globalThis.chrome.storage.local.get = vi.fn(async (keys) => {
            if (keys === 'active_account') throw new Error('depo yok')
            return gercekGet(keys)
        })
        // Izleyicide firlarsa Vue eszamansiz hata isleyicisine duserdi: geri cagri cozulur.
        await expect(s.onQuoteScopeChange()).resolves.toBeUndefined()
        // ESKI hesapla YENI teklif ve bakiye karismaz: hesap atilir, kart cikar, hicbir istek gitmez.
        expect(s.activeAccount).toBeNull()
        expect(s.quoteError).toBe('unknown')
        expect(s.swapData).toBeNull()
        expect(s.inBalance).toBe(0)
        expect(s.outBalance).toBe(0)
        expect(s.swapLoading).toBe(false)
        expect(cagrilar).toEqual([])
    })

    it('ATS yakit bakiyesi (eksik-ATS bolumunun sayisi) YENI hesabin adresiyle yeniden yuklenir; eski hesabin sayisi kalmaz', async () => {
        const { s, stub } = await ekran()
        const yakit = (msg) => ({ success: true, balance: msg.message.address === ACTIVE_B.address ? '7' : '5', symbol: 'ATS' })
        const cagrilar = dinle(stub, { ATS_FUEL_BALANCE: yakit, SWAP_QUOTE: { data: { tag: 'yeni' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        // Onceki hesabin bakiyesi ekranda (mount'taki yenileAtsYakiti de bunu A icin yukler).
        await s.atsFuel.load(ACTIVE_A.address, GNOSIS.chainId)
        expect(s.atsFuel.balance.value).toBe('5')
        stub.localStore.active_account = ACTIVE_B
        cagrilar.length = 0
        await s.onQuoteScopeChange()
        expect(cagrilar.filter((m) => m.type === 'ATS_FUEL_BALANCE').map((m) => m.message.address)).toEqual([ACTIVE_B.address])
        expect(s.atsFuel.balance.value).toBe('7')
    })

    it('yeni teklif BEKLENIRKEN eski hesabin teklifi ekranda ve onaylanabilir KALMAZ', async () => {
        const { s, stub } = await ekran()
        s.swapData = { tag: 'eski-hesap' }
        let yeniyiBitir
        stub.setSendMessage((msg) => (msg.type === 'SWAP_QUOTE'
            ? new Promise((resolve) => { yeniyiBitir = () => resolve({ data: { tag: 'yeni-hesap' } }) })
            : Promise.resolve(FEE_OK)))
        const degisim = s.onQuoteScopeChange()
        await vi.waitFor(() => expect(yeniyiBitir).toBeTypeOf('function'))
        expect(s.swapData, 'yeni teklif gelene dek eski teklif gorunur kaldi').toBeNull()
        yeniyiBitir()
        await degisim
        expect(s.swapData.tag).toBe('yeni-hesap')
    })

    it('degisim sirasinda ucusta olan ESKI hesabin teklifi sonucu YAZAMAZ ve spinner takili kalmaz', async () => {
        const { s, stub } = await ekran()
        let eskiyiBitir
        // Yalniz teklif istegi asili kalir: geri cagri ATS yakit bakiyesini de ister (ATS_FUEL_BALANCE) ve o hemen cevap alir,
        // yoksa eskiyiBitir yakit istegine baglanir ve eski teklif hic cozulmezdi.
        stub.setSendMessage((msg) => (msg.type === 'SWAP_QUOTE'
            ? new Promise((resolve) => { eskiyiBitir = () => resolve({ data: { tag: 'eski-ucusta' } }) })
            : Promise.resolve(undefined)))
        const ucustaki = s.getSwapData()
        await vi.waitFor(() => expect(eskiyiBitir).toBeTypeOf('function'))
        expect(s.swapLoading).toBe(true)

        // Hesap degisti ve yeni miktar bos: yeni istek hic gitmez, eski cevap yine de yazamaz.
        s.inTokenAmount = ''
        await s.onQuoteScopeChange()
        expect(s.swapLoading, 'spinner takili kaldi').toBe(false)
        eskiyiBitir()
        await ucustaki
        expect(s.swapData).toBeNull()
    })

    it('depo ve bakiye okunurken ucusta olan ESKI hesabin teklifi gelse de yazamaz', async () => {
        const { s, stub } = await ekran()
        // 1) Eski hesap icin bir teklif ucusta (cevabi elle tutulur).
        let eskiyiBitir
        stub.setSendMessage(() => new Promise((resolve) => { eskiyiBitir = () => resolve({ data: { tag: 'eski-ucusta' } }) }))
        const ucustaki = s.getSwapData()
        await vi.waitFor(() => expect(eskiyiBitir).toBeTypeOf('function'))
        // 2) Hesap degisti; geri cagri DEPOYU okurken (ilk await) eski cevap gelir. onQuoteScopeChange sira
        //    numarasini ilk satirda SENKRON arttirdigi icin eski cevap yazamaz (getSwapData daha cagrilmadi).
        let depoyuBitir
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = vi.fn((keys) => new Promise((resolve) => { depoyuBitir = () => resolve(gercekGet(keys)) }))
        dinle(stub, { SWAP_QUOTE: { data: { tag: 'yeni-hesap' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        const degisim = s.onQuoteScopeChange()
        await vi.waitFor(() => expect(depoyuBitir).toBeTypeOf('function'))
        eskiyiBitir()
        await ucustaki
        expect(s.swapData, 'eski hesabin teklifi ekrana yazildi').toBeNull()
        // 3) Geri cagri devam eder; yeni teklif yazilir.
        globalThis.chrome.storage.local.get = gercekGet
        depoyuBitir()
        await degisim
        expect(s.swapData.tag).toBe('yeni-hesap')
    })

    it('miktar bos iken eski hesabin gaz yetersizligi isaretleri de atilir (kirmizi gaz karti swapData baglamina bagli degil)', async () => {
        const { s, stub } = await ekran()
        s.inTokenAmount = ''
        s.evmInsufficientGas = true
        s.tonGasOlculeri = { isNativeIn: true, amount: '1', gasCost: 1 }
        s.tonBalanceOkunan = 5
        s.tonBalanceOkunamadi = true
        dinle(stub, { SWAP_QUOTE: { data: { tag: 'yeni' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        await s.onQuoteScopeChange()
        expect(s.evmInsufficientGas).toBe(false)
        expect(s.tonGasOlculeri).toBeNull()
        expect(s.tonBalanceOkunan).toBeNull()
        expect(s.tonBalanceOkunamadi).toBe(false)
    })

    it('TON agi, miktar bos: TON ucret durumu YENI hesabin gonderenligiyle yeniden yuklenir (eski hesabin karari kalmaz)', async () => {
        const { s, stub } = await ekran(TON_CHAIN)
        s.inTokenAmount = ''
        stub.localStore.active_account = ACTIVE_B
        dinle(stub, { ATS_FUEL_BALANCE: { success: true, balance: '1', symbol: 'ATS' } })
        tonFeeLoad.mockClear()
        await s.onQuoteScopeChange()
        expect(tonFeeLoad).toHaveBeenCalled()
        for (const [arg] of tonFeeLoad.mock.calls) expect(arg.sender).toBe(ACTIVE_B.address)
    })

    it('satis yurutme hatasi (sonuc bilinmiyor) BILEREK silinmez: ikinci alimi engelleyen odur', async () => {
        const { s, stub } = await ekran()
        s.saleExecError = { code: 'result-unknown' }
        dinle(stub, { SWAP_QUOTE: { data: { tag: 'yeni' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        await s.onQuoteScopeChange()
        expect(s.saleExecError).toEqual({ code: 'result-unknown' })
    })

    it('miktar bos ise ne teklif ne ucret istenir; onbellek yine atilir', async () => {
        const { s, stub } = await ekran()
        s.inTokenAmount = ''
        s.swapData = { tag: 'eski' }
        s.atsReady = true
        const cagrilar = dinle(stub, { SWAP_QUOTE: { data: { tag: 'yeni' } }, ATS_SWAP_FEE_QUOTE: FEE_OK })
        await s.onQuoteScopeChange()
        expect(teklifCagrilari(cagrilar)).toEqual([])
        expect(s.swapData).toBeNull()
        // Ucret teklifi de eski hesaba aitti ve yeniden istenmedi: sifirlanmis kalir.
        expect(s.atsReady).toBe(false)
    })
})

describe('Swap.vue: kaynak kilidi (SSR izleyiciyi calistirmaz)', () => {
    const kaynak = yorumsuz(readFileSync(join(here, 'Swap.vue'), 'utf8'))

    it('hesap/mod izleyicisi bilesene baglidir: useQuoteScopeGuard(onQuoteScopeChange)', () => {
        expect(kaynak).toMatch(/useQuoteScopeGuard\(onQuoteScopeChange\)/)
        expect(kaynak).toMatch(/import \{ useQuoteScopeGuard \} from '\.\.\/composables\/useQuoteScopeGuard'/)
    })

    it('geri cagri satis yurutme hatasina (saleExecError) ve bekleyen debounce zamanlayicisina (quoteDebounceTimer) dokunmaz', () => {
        const bas = kaynak.indexOf('const onQuoteScopeChange = async')
        const son = kaynak.indexOf('useQuoteScopeGuard(onQuoteScopeChange)')
        expect(bas).toBeGreaterThan(-1)
        expect(son).toBeGreaterThan(bas)
        const govde = kaynak.slice(bas, son)
        expect(govde).not.toContain('saleExecError')
        // Debounce BILEREK temizlenmez: dolunca teklifi yeniden ister ve periyodik yenilemeyi (startQuoteTimer) o kurar.
        expect(govde).not.toContain('quoteDebounceTimer')
    })
})
