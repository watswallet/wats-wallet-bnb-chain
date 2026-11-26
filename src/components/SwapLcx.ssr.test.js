// Takas ekraninda LCX YOLU -- gercek render (plan: docs/superpowers/plans/2026-11-19-lcx-bolum1-takas-stablecoin.md, Gorev 8).
//
// Olculen:
//  (1) arka planin dondurdugu `lcxQuote` ekranda TASINIR ve onayda giden SWAP mesajina AYNI nesne (deger esitligi: ekran durumu Vue sarmali tasir) olarak girer; ATS ucret
//      teklifinin yukune de girer. Yalniz `routerType.name === 'lcx'` iken: TON ve bugunku EVM yanitinda `lcxQuote` alani YOK.
//      Motor lcx diyor ama teklif yoksa SWAP HIC gonderilmez (arka plan yoksa bugunku motoru farkli fiyata calistirirdi).
//  (2) LCX_REFUSED reddi: kod -> cumle (swap.lcx.*), dugme kapali; `lcxDetails` GUVENILMEZ sunucu verisidir, yalniz
//      `fillsUpTo` okunur ve girdi tokeninin ondaligiyla bicimlenir; gecersizse "en fazla {max}" yerine mevcut "miktar cok
//      buyuk" karti cizilir. Bilinmeyen kod ve kodsuz hata mevcut "teklif alinamadi" kartina duser, BASKA MOTORA DUSULMEZ.
//  (3) SWAP yaniti: LCX_REQUOTE / LCX_QUOTE_MISMATCH -> yeni SWAP_QUOTE + "fiyat degisti" notu, ekranda KALIR; diger LCX
//      yurutme kodlari ekranda hata metniyle kalir (ana sayfaya gidilmez). LCX DISI retler (kodsuz { error }, tanimsiz kod)
//      bugunku yol gibi ana sayfaya gider: islem karti sebebiyle orada (M3).
//  (4) Teklif gaz tahmini tasimiyorsa (totalCost null) native gaz uyarisi SWAP_GAS_FALLBACK x gaz fiyatiyla kurulur (M1).
//
// Iddialar CEVRILMIS (en) metin uzerinde; SSR sablon yorumlarini ciktiya bastigi icin yorumlar atilir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { yorumsuz } from '../test-utils/kaynakTarama'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// EVM saglayicisi (native gaz kontrolu: getBalance + getFeeData) aga cikmaz. Varsayilan: ikisi de reddeder (cevrimdisi); yalniz
// gaz uyarisini olcen testler (M1) yanit verir. Diger her ethers ogesi gercektir.
const rpc = vi.hoisted(() => ({ getBalance: vi.fn(), getFeeData: vi.fn() }))
vi.mock('ethers', async (importOriginal) => {
    const real = await importOriginal()
    class FakeProvider {
        constructor(url) { this.url = url }
        getBalance(...a) { return rpc.getBalance(...a) }
        getFeeData(...a) { return rpc.getFeeData(...a) }
    }
    return { ...real, JsonRpcProvider: FakeProvider, ethers: { ...real.ethers, JsonRpcProvider: FakeProvider } }
})

// Fiyat sorgusu gercek aga cikmasin (SwapAtsSale.ssr.test.js ile AYNI mock seti).
vi.mock('../composables/useUsdPrice', async () => (await import('../test-utils/offlineMocks.js')).usdPriceOfflineModule())
const useTokenBalanceMock = vi.fn(async () => 1000)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))
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
            load: async () => {}, stop: () => {}, runOnboarding: async () => {},
        }),
    }
})

// ATS ucreti HAZIR kullanici (BSC'de her takas ATS ister): ucret karari engel uretmez, `load` cagrilari kaydedilir.
const atsLoad = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../composables/useAtsOpFee', async () => {
    const { ref } = await import('vue')
    return {
        useAtsOpFee: () => ({
            atsFee: ref(0.5), atsSymbol: ref('ATS'), atsBalance: ref(100), opCount: ref(1),
            bootstrapFee: ref(0), feeRefundable: ref(false), prepaid: ref(null),
            ready: ref(true), decision: ref(null),
            nextSteps: ref([]), loading: ref(false), error: ref(null), errorCode: ref(null), blocked: ref(false),
            commissionAts: ref('0'), commissionHuman: ref(0), commissionRegion: ref('local'), commissionTreasury: ref(null),
            hasCommission: ref(false), totalAtsCost: ref(0.5), maxAtsSellRaw: ref(null),
            exceedsAtsCap: () => false,
            insufficient: ref(false),
            requiredAtsFor: (extra = 0) => 0.5 + Number(extra || 0),
            insufficientFor: () => false,
            load: atsLoad, runOnboarding: async () => true, reset: () => {},
        }),
    }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import { cryptoStore } from '../store/crypto'
import Swap from './Swap.vue'
import supported_chains from '../data/supported_chains.json'
import en from '../i18n/locales/en.json'
import { LCX_EXEC_CODES, LCX_SHARED_CODES } from '../utils/lcx/calls'
import { SWAP_GAS_FALLBACK } from '../utils/nativeReserve'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
const token = (symbol, address, decimals = 18) => ({
    name: symbol, symbol, address, decimals, chainId: 56, image: { thumb: '', large: '' },
})
const CAKE = token('cake', '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82')
const USDT = token('usdt', '0x55d398326f99059fF775485246999027B3197955')
const USDC6 = token('usdc', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 6)
const HESAP = '0xAbCdEf0000000000000000000000000000000001'

// Arka planin LCX teklif yaniti (lcxSwapData): bilinen alanlar + opak `lcxQuote` (ekran DOKUNMADAN geri tasir).
const LCX_QUOTE = {
    kind: 'swap', quoteId: 'q-1', slippageBps: 50, minOut: '4990000000000000000', spender: '0x' + '11'.repeat(20),
    expiresAt: 1790000000, receivedAt: 1,
}
const TAKAS_VERISI = { expectedOutput: '5', exchangeRate: '1', priceImpact: '0.10%', depthGateWarning: false }
const LCX_VERISI = { ...TAKAS_VERISI, routerType: { name: 'lcx' }, lcxQuote: LCX_QUOTE }
const YENI_LCX_VERISI = { ...LCX_VERISI, expectedOutput: '4.9', lcxQuote: { ...LCX_QUOTE, quoteId: 'q-2' } }

const T = (anahtar) => anahtar.split('.').reduce((o, p) => o?.[p], en)
// SSR metni HTML-kacisli basar (apostrof vb.): iddialar kacisli metinle yapilir.
const KACIS = { '"': '&quot;', '&': '&amp;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }
const esc = (s) => String(s).replace(/["&'<>]/g, (c) => KACIS[c])
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

const mesajlar = []
// Her tur icin sirayla yanit: dizi verilirse sirayla tuketilir, SON yanit tekrarlanir.
let yanitlar
const VARSAYILAN_YANITLAR = () => ({
    teklif: [{ success: true, data: LCX_VERISI }],
    takas: [{ success: true, hash: '0xuserop' }],
})
const siradaki = (liste) => (liste.length > 1 ? liste.shift() : liste[0])
const zamanlayici = vi.fn(() => 7)

const cevrimdisiRpc = () => {
    rpc.getBalance.mockReset()
    rpc.getFeeData.mockReset()
    rpc.getBalance.mockRejectedValue(new Error('cevrimdisi'))
    rpc.getFeeData.mockRejectedValue(new Error('cevrimdisi'))
}
cevrimdisiRpc()

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    mesajlar.length = 0
    yanitlar = VARSAYILAN_YANITLAR()
    atsLoad.mockClear()
    zamanlayici.mockClear()
    useTokenBalanceMock.mockClear()
    cevrimdisiRpc()
})
yanitlar = VARSAYILAN_YANITLAR()

async function ciz({ inToken = CAKE, outToken = USDT, amount = 5, swapData = LCX_VERISI, chain = BSC_CHAIN, onCapture } = {}) {
    vi.stubGlobal('setInterval', zamanlayici)
    vi.stubGlobal('clearInterval', () => {})
    const stub = installChromeStub({
        currentNetwork: chain,
        active_account: { address: HESAP, key: 'acc1', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" },
    })
    stub.setSendMessage(async (msg) => {
        mesajlar.push(msg)
        // Yanit bir Error ise istek reddedilir (sendMessage firlatir).
        if (msg.type === 'SWAP_QUOTE' || msg.type === 'SWAP') {
            const yanit = siradaki(msg.type === 'SWAP_QUOTE' ? yanitlar.teklif : yanitlar.takas)
            if (yanit instanceof Error) throw yanit
            return yanit
        }
        return {}
    })

    const app = createApp(Swap)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = chain
    pageStore().currentPage = 'swap'
    const crypto = cryptoStore()
    crypto.swap.inToken = inToken
    crypto.swap.outToken = outToken

    const holder = captureInstance(app, 'Swap', (instance) => {
        instance.setupState.inTokenAmount = amount
        instance.setupState.swapData = swapData
        onCapture?.(instance.setupState)
    })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

const swapSayisi = () => mesajlar.filter((m) => m.type === 'SWAP').length
const teklifSayisi = () => mesajlar.filter((m) => m.type === 'SWAP_QUOTE').length
const gonderilenSwap = () => mesajlar.find((m) => m.type === 'SWAP')

// Durumu (islem sonu) taze bir cizimle gosterir: SSR tek seferliktir, bu yuzden islemden sonra elde edilen DEGERLER
// yeni bir ekrana yazilip metin orada olculur.
const gorunum = async (yaz, opts = {}) => (await ciz({ swapData: null, onCapture: yaz, ...opts })).html

describe('Swap.vue (SSR) -- LCX: lcxQuote tasima', () => {
    it('teklif yaniti ekrana yazilir: lcxQuote AYNI nesne (deger esitligi)', async () => {
        const { state } = await ciz({ swapData: null })
        await state.getSwapData()
        expect(state.swapData.routerType).toEqual({ name: 'lcx' })
        expect(state.swapData.lcxQuote).toEqual(LCX_QUOTE)
        expect(state.quoteError).toBeNull()
    })

    it('onayda giden SWAP mesajinda message.lcxQuote AYNI nesnedir; basari ana sayfaya doner', async () => {
        const { state } = await ciz()
        expect(state.isValid()).toBe(true)
        await state.swap()
        expect(swapSayisi()).toBe(1)
        expect(gonderilenSwap().message.lcxQuote).toEqual(LCX_QUOTE)
        expect(pageStore().currentPage).toBe('home')
    })

    it('ATS ucret teklifinin yukunde de lcxQuote var (ATS_SWAP_FEE_QUOTE ayni yukle gider)', async () => {
        const { state } = await ciz()
        await state.refreshAtsOpFee()
        expect(atsLoad).toHaveBeenCalledTimes(1)
        const { kind, payload } = atsLoad.mock.calls[0][0]
        expect(kind).toBe('swap')
        expect(payload.lcxQuote).toEqual(LCX_QUOTE)
        expect(payload).toMatchObject({ chainId: 56, inTokenAddress: CAKE.address, outTokenAddress: USDT.address, amount: '5' })
    })

    it('bugunku EVM yaniti (lcxQuote YOK): SWAP mesajinda ve ATS yukunde lcxQuote alani YOK', async () => {
        const { state } = await ciz({ swapData: TAKAS_VERISI })
        await state.refreshAtsOpFee()
        expect('lcxQuote' in atsLoad.mock.calls[0][0].payload).toBe(false)
        await state.swap()
        expect('lcxQuote' in gonderilenSwap().message).toBe(false)
        expect(pageStore().currentPage).toBe('home')
    })

    it('routerType lcx DEGILSE lcxQuote tasinmaz (baska motorun teklifi LCX gibi gonderilmez)', async () => {
        const { state } = await ciz({ swapData: { ...TAKAS_VERISI, routerType: { name: 'pancakeswap' }, lcxQuote: LCX_QUOTE } })
        await state.refreshAtsOpFee()
        expect('lcxQuote' in atsLoad.mock.calls[0][0].payload).toBe(false)
        await state.swap()
        expect('lcxQuote' in gonderilenSwap().message).toBe(false)
    })

    it('TON: tonQuote mesaji degismedi, lcxQuote alani YOK', async () => {
        const TON_NATIVE = { ...token('ton', '0x0000000000000000000000000000000000000000', 9), chainId: -239 }
        const TON_USDT = { ...token('usdt', 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', 6), chainId: -239 }
        const tonQuote = { router: 'EQRouter', receivedAt: 1 }
        // Sahte TON adresi gecersiz: ekran acilista bakiye okuyamaz ve bunu console.error ile bildirir (beklenen).
        const konsol = vi.spyOn(console, 'error').mockImplementation(() => {})
        const { state } = await ciz({
            chain: TON_CHAIN, inToken: TON_NATIVE, outToken: TON_USDT,
            swapData: { ...TAKAS_VERISI, tonQuote },
        })
        expect(konsol).toHaveBeenCalledWith(expect.stringContaining('okunamadi'), expect.anything())
        konsol.mockRestore()
        // TON bakiyesi bu ortamda okunamaz: onay kapisi acilsin diye bakiye elle yazilir.
        state.inBalance = 1000
        await state.swap()
        const mesaj = gonderilenSwap()
        expect(mesaj).toBeTruthy()
        expect(mesaj.message.tonQuote).toEqual(tonQuote)
        expect('lcxQuote' in mesaj.message).toBe(false)
    })

    // R26.4: teklif, LCX guard'inda anlik goruntuye alinir. Guard'dan SONRAKI ilk await (depo okumasi) sirasinda swapData
    // baska bir (LCX olmayan) teklifle degisse bile LCX yolundaki SWAP ASLA lcxQuote'suz gitmez.
    describe('teklif anlik goruntusu (R26.4)', () => {
        const depoOkumasindaDegistir = (state, yeni) => {
            const get = globalThis.chrome.storage.local.get
            globalThis.chrome.storage.local.get = async (...a) => { state.swapData = yeni; return get(...a) }
        }

        it('swapData guard ile gonderim arasinda LCX olmayan teklife donerse SWAP yine O ANKI lcxQuote ile gider', async () => {
            const { state } = await ciz()
            depoOkumasindaDegistir(state, TAKAS_VERISI)
            await state.swap()
            expect(swapSayisi()).toBe(1)
            expect(gonderilenSwap().message.lcxQuote).toEqual(LCX_QUOTE)
        })

        it('swapData guard ile gonderim arasinda silinirse (null) SWAP yine goruntudeki lcxQuote ile gider, hata firlatmaz', async () => {
            const { state } = await ciz()
            depoOkumasindaDegistir(state, null)
            await state.swap()
            expect(gonderilenSwap().message.lcxQuote).toEqual(LCX_QUOTE)
        })

        it('baska bir LCX teklifiyle degisirse de onay anindaki GORUNEN teklif gider (yeni teklif gizlice yerine gecmez)', async () => {
            const { state } = await ciz()
            depoOkumasindaDegistir(state, YENI_LCX_VERISI)
            await state.swap()
            expect(gonderilenSwap().message.lcxQuote).toEqual(LCX_QUOTE)
            expect(gonderilenSwap().message.lcxQuote.quoteId).toBe('q-1')
        })

        it('LCX olmayan yolda guard devreye girmez: degisen swapData LCX alani EKLEMEZ', async () => {
            const { state } = await ciz({ swapData: TAKAS_VERISI })
            depoOkumasindaDegistir(state, LCX_VERISI)
            await state.swap()
            expect('lcxQuote' in gonderilenSwap().message).toBe(false)
        })
    })

    it('routerType lcx ama lcxQuote YOK: SWAP HIC gonderilmez, "takas servisi yanit vermiyor" yazar, ekranda kalinir', async () => {
        const { state } = await ciz({ swapData: { ...TAKAS_VERISI, routerType: { name: 'lcx' } } })
        await state.swap()
        expect(swapSayisi()).toBe(0)
        expect(pageStore().currentPage).toBe('swap')
        expect(state.lcxNotice).toMatchObject({ key: 'swap.lcx.unavailable' })
        const html = await gorunum((s) => { s.lcxNotice = state.lcxNotice })
        expect(html).toContain(esc(T('swap.lcx.unavailable')))
        // Teklif yenileme dongusu yeniden kurulur (10 sn, degismedi).
        expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 10000)
    })
})

describe('Swap.vue (SSR) -- LCX: red (LCX_REFUSED)', () => {
    const red = (lcxCode, lcxDetails) => ({
        error: `LCX reddetti: ${lcxCode}`, code: 'LCX_REFUSED', lcxCode, ...(lcxDetails !== undefined ? { lcxDetails } : {}),
    })

    const DOGRU_METIN = [
        ['off_peg', 'swap.lcx.offPeg'],
        ['below_tolerance', 'swap.lcx.belowTolerance'],
        ['no_reference_rate', 'swap.lcx.noReferenceRate'],
        ['excluded_coin', 'swap.lcx.excluded'],
        ['use_rwa', 'swap.lcx.useStocks'],
    ]
    for (const [lcxCode, anahtar] of DOGRU_METIN) {
        it(`${lcxCode} -> ${anahtar} metni gorunur, dugme kapali, teklif temizlenir`, async () => {
            yanitlar.teklif = [red(lcxCode)]
            const { state } = await ciz()
            await state.getSwapData()
            expect(state.quoteError).toBe('lcx')
            expect(state.lcxRefusal.code).toBe(lcxCode)
            expect(state.swapData).toBeNull()
            expect(state.isValid()).toBe(false)
            expect(state.blockReason).toBe('no-quote')
            const html = await gorunum((s) => { s.quoteError = state.quoteError; s.lcxRefusal = state.lcxRefusal })
            expect(html).toContain(esc(T(anahtar)))
            // Mevcut kartlarin metinleri CIKMAZ.
            expect(html).not.toContain(esc(T('swap.quoteFailed')))
            expect(html).not.toContain(esc(T('swap.quoteNoRoute')))
        })
    }

    it('LCX reddi sonrasi ATS ucret teklifi ISTENMEZ (reddedilen cift bugunku motorda fiyatlanmaz)', async () => {
        yanitlar.teklif = [red('off_peg')]
        const { state } = await ciz()
        await state.getSwapData()
        await state.refreshAtsOpFee()
        expect(atsLoad).not.toHaveBeenCalled()
    })

    it('insufficient_liquidity + fillsUpTo (ham dize): "en fazla {max}" girdi tokeninin ondaligiyla DOLU', async () => {
        yanitlar.teklif = [red('insufficient_liquidity', { fillsUpTo: '1234500000000000000000' })]
        const { state } = await ciz()
        await state.getSwapData()
        expect(state.quoteError).toBe('lcx')
        const html = await gorunum((s) => { s.quoteError = state.quoteError; s.lcxRefusal = state.lcxRefusal })
        expect(html).toContain(esc(T('swap.lcx.insufficientLiquidity').replace('{max}', '1234.5 CAKE')))
        expect(html).not.toContain('{max}')
    })

    it('fillsUpTo SAYI da olabilir; ondalik girdi tokeninden gelir (6 ondalikli USDC)', async () => {
        yanitlar.teklif = [red('insufficient_liquidity', { fillsUpTo: 2500000 })]
        const { state } = await ciz({ inToken: USDC6, outToken: USDT })
        await state.getSwapData()
        expect(state.quoteError).toBe('lcx')
        const html = await gorunum((s) => { s.quoteError = state.quoteError; s.lcxRefusal = state.lcxRefusal }, { inToken: USDC6, outToken: USDT })
        expect(html).toContain(esc(T('swap.lcx.insufficientLiquidity').replace('{max}', '2.5 USDC')))
    })

    // "En fazla" bir USTSINIRDIR: gosterilen sayi gercek fillsUpTo'dan BUYUK olamaz. Dizge 4 ondaliga YUVARLANMAZ, KIRPILIR
    // (eskiden fmt/toFixed en yakina yuvarliyordu: 1.23456789 -> "1.2346", kullanici onu yazinca yine reddedilirdi).
    const KIRPMA = [
        ['1234567890000000000', 18, '1.2345', '1.2346'],          // besinci ondalik 6: yukari yuvarlanmaz
        ['1999990000000000000', 18, '1.9999', '2'],               // 1.99999 -> 2 olmaz
        ['9999999999999999999999', 18, '9999.9999', '10000'],     // 9999.999999... -> 10000 olmaz
        ['1500000000000000000', 18, '1.5', '1.50'],               // tam ondalik: sondaki sifirlar atilir, deger degismez
        ['3000000000000000000', 18, '3', '3.0'],                  // tam sayi
        ['123400000000000000000', 18, '123.4', '123.40'],
        ['2599999', 6, '2.5999', '2.6'],                          // 6 ondalikli token
    ]
    for (const [ham, ondalik, beklenen, yasak] of KIRPMA) {
        it(`fillsUpTo ${ham} (${ondalik} ondalik) -> "en fazla ${beklenen}": ustsinirdan BUYUK yazilmaz`, async () => {
            const giris = ondalik === 18 ? CAKE : USDC6
            yanitlar.teklif = [red('insufficient_liquidity', { fillsUpTo: ham })]
            const { state } = await ciz({ inToken: giris, outToken: USDT })
            await state.getSwapData()
            expect(state.quoteError).toBe('lcx')
            expect(state.lcxRefusal.max).toBe(`${beklenen} ${giris.symbol.toUpperCase()}`)
            // Gosterilen sayi gercek sinirdan buyuk degil (BigInt ile olculur, ekran dizgesinden degil).
            const [tam, kesir = ''] = beklenen.split('.')
            const birim = BigInt(tam + kesir.padEnd(ondalik, '0'))
            expect(birim <= BigInt(ham)).toBe(true)
            const html = await gorunum((s) => { s.quoteError = state.quoteError; s.lcxRefusal = state.lcxRefusal }, { inToken: giris, outToken: USDT })
            expect(html).toContain(esc(T('swap.lcx.insufficientLiquidity').replace('{max}', `${beklenen} ${giris.symbol.toUpperCase()}`)))
            expect(html).not.toContain(`${yasak} ${giris.symbol.toUpperCase()}`)
        })
    }

    it('kirpinca hicbir sey kalmayan kucuk sinir (0.00009) "en fazla 0" demez: "miktar cok buyuk" karti', async () => {
        yanitlar.teklif = [red('insufficient_liquidity', { fillsUpTo: '90000000000000' })]
        const { state } = await ciz()
        await state.getSwapData()
        expect(state.quoteError).toBe('amount')
        const html = await gorunum((s) => { s.quoteError = state.quoteError; s.lcxRefusal = state.lcxRefusal })
        expect(html).toContain(esc(T('swap.quoteAmountTooLarge')))
        expect(html).not.toContain('{max}')
    })

    it('dev sayilar ussel yazima (1e+21) dusmez: dizge kirpilir', async () => {
        yanitlar.teklif = [red('insufficient_liquidity', { fillsUpTo: '1000000000000000000000000000000000000000' })]
        const { state } = await ciz()
        await state.getSwapData()
        expect(state.lcxRefusal.max).toBe('1000000000000000000000 CAKE')
    })

    // Sunucu verisi GUVENILMEZ: gecersiz fillsUpTo ham/bos "{max}" gostermez; mevcut "miktar cok buyuk" kartina duser.
    const GECERSIZ_DETAYLAR = [
        ['detay yok', undefined],
        ['bos nesne', {}],
        ['fillsUpTo yok', { baska: 1 }],
        ['yazi', { fillsUpTo: 'cok' }],
        ['HTML', { fillsUpTo: '<img src=x onerror=alert(1)>' }],
        ['negatif', { fillsUpTo: '-5' }],
        ['sifir', { fillsUpTo: '0' }],
        ['ondalikli', { fillsUpTo: '1.5' }],
        ['null', { fillsUpTo: null }],
        ['nesne', { fillsUpTo: { x: 1 } }],
        ['NaN', { fillsUpTo: NaN }],
        ['detay dizi', ['1000']],
        ['detay yazi', '1000'],
    ]
    for (const [ad, detay] of GECERSIZ_DETAYLAR) {
        it(`insufficient_liquidity, fillsUpTo gecersiz (${ad}): {max} gosterilmez, "miktar cok buyuk" karti`, async () => {
            yanitlar.teklif = [red('insufficient_liquidity', detay)]
            const { state } = await ciz()
            await state.getSwapData()
            expect(state.quoteError).toBe('amount')
            const html = await gorunum((s) => { s.quoteError = state.quoteError })
            expect(html).toContain(esc(T('swap.quoteAmountTooLarge')))
            expect(html).not.toContain('{max}')
            expect(html).not.toContain('onerror')
        })
    }

    it('bilinmeyen lcxCode -> mevcut "teklif alinamadi" karti', async () => {
        yanitlar.teklif = [red('yeni_bir_kod', { fillsUpTo: '5' })]
        const { state } = await ciz()
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        await state.getSwapData()
        hata.mockRestore()
        expect(state.quoteError).toBe('unknown')
        expect(state.swapData).toBeNull()
        const html = await gorunum((s) => { s.quoteError = state.quoteError })
        expect(html).toContain(esc(T('swap.quoteFailed')))
    })

    it('kodsuz { error } -> "teklif alinamadi" ve BASKA MOTOR DENENMEZ (tek SWAP_QUOTE)', async () => {
        yanitlar.teklif = [{ error: 'bir seyler ters gitti' }]
        const { state } = await ciz()
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        await state.getSwapData()
        hata.mockRestore()
        expect(state.quoteError).toBe('unknown')
        expect(teklifSayisi()).toBe(1)
        expect(state.isValid()).toBe(false)
    })

    it('red yeni basarili teklifle temizlenir (kart kalmaz)', async () => {
        yanitlar.teklif = [red('off_peg'), { success: true, data: LCX_VERISI }]
        const { state } = await ciz()
        await state.getSwapData()
        expect(state.quoteError).toBe('lcx')
        await state.getSwapData()
        expect(state.quoteError).toBeNull()
        expect(state.swapData.lcxQuote).toEqual(LCX_QUOTE)
        expect(state.isValid()).toBe(true)
    })
})

describe('Swap.vue (SSR) -- LCX: SWAP yaniti', () => {
    const hata = (code, ekstra = {}) => ({ error: code, code, ...ekstra })

    // Bilesen reddi console.error ile kaydeder (beklenen); testin ciktisina stderr sizmasin diye susturulur ve KAYDI olculur.
    let konsol
    beforeEach(() => { konsol = vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { konsol.mockRestore() })

    for (const kod of ['LCX_REQUOTE', 'LCX_QUOTE_MISMATCH']) {
        it(`${kod} -> yeni SWAP_QUOTE istenir, "fiyat degisti" notu gorunur, ana sayfaya GIDILMEZ`, async () => {
            yanitlar.takas = [hata(kod)]
            yanitlar.teklif = [{ success: true, data: YENI_LCX_VERISI }]
            const { state } = await ciz()
            await state.swap()
            const sira = mesajlar.map((m) => m.type)
            expect(sira.indexOf('SWAP')).toBeGreaterThanOrEqual(0)
            expect(sira.lastIndexOf('SWAP_QUOTE')).toBeGreaterThan(sira.indexOf('SWAP'))
            expect(state.swapData.lcxQuote.quoteId).toBe('q-2')
            expect(pageStore().currentPage).toBe('swap')
            expect(state.lcxNotice).toMatchObject({ key: 'swap.lcx.requoted' })
            // Teklif dongusu 10 sn ile yeniden kurulur (aralik degismedi).
            expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 10000)
            // Kullanici YENIDEN onaylar: yeni teklifle ikinci SWAP yeni lcxQuote'u tasir.
            expect(state.isValid()).toBe(true)
            await state.swap()
            const swaplar = mesajlar.filter((m) => m.type === 'SWAP')
            expect(swaplar).toHaveLength(2)
            expect(swaplar[1].message.lcxQuote).toEqual(YENI_LCX_VERISI.lcxQuote)

            const html = await gorunum((s) => { s.lcxNotice = state.lcxNotice })
            expect(html).toContain(esc(T('swap.lcx.requoted')))
        })
    }

    it('yeniden teklif RED ile donerse "yeni teklif gosterildi" notu KALMAZ (red karti gorunur)', async () => {
        yanitlar.takas = [hata('LCX_REQUOTE')]
        yanitlar.teklif = [{ error: 'LCX reddetti: off_peg', code: 'LCX_REFUSED', lcxCode: 'off_peg' }]
        const { state } = await ciz()
        await state.swap()
        expect(state.lcxNotice).toBeNull()
        expect(state.quoteError).toBe('lcx')
        expect(pageStore().currentPage).toBe('swap')
    })

    const HATA_METNI = [
        ['LCX_TX_MISMATCH', 'swap.lcx.txMismatch'],
        ['LCX_UNAVAILABLE', 'swap.lcx.unavailable'],
        ['INSUFFICIENT_BALANCE', 'transactionStatus.errors.insufficientBalance'],
        ['ONCHAIN_FAILED', 'transactionStatus.errors.onchainFailed'],
    ]
    for (const [kod, anahtar] of HATA_METNI) {
        it(`${kod} -> ${anahtar} metni, ekranda kalinir, YENI SWAP / teklif ISTENMEZ`, async () => {
            yanitlar.takas = [hata(kod)]
            const { state } = await ciz()
            await state.swap()
            expect(pageStore().currentPage).toBe('swap')
            expect(swapSayisi()).toBe(1)
            expect(teklifSayisi()).toBe(0)
            expect(state.lcxNotice).toMatchObject({ key: anahtar })
            expect(konsol).toHaveBeenCalledWith('LCX takas reddedildi:', kod, '')
            // Teklif dongusu yeniden kurulur.
            expect(zamanlayici).toHaveBeenLastCalledWith(expect.any(Function), 10000)
            const html = await gorunum((s) => { s.lcxNotice = state.lcxNotice })
            expect(html).toContain(esc(T(anahtar)))
            expect(html).not.toContain(esc(T('swap.lcx.requoted')))
        })
    }

    it('LCX_TX_MISMATCH yaniti `field` tasir: ekranda ham alan adi YAZILMAZ', async () => {
        yanitlar.takas = [hata('LCX_TX_MISMATCH', { field: 'recipient' })]
        const { state } = await ciz()
        await state.swap()
        expect(konsol).toHaveBeenCalledWith('LCX takas reddedildi:', 'LCX_TX_MISMATCH', 'recipient') // alan adi yalniz kayitta
        const html = await gorunum((s) => { s.lcxNotice = state.lcxNotice })
        expect(html).toContain(esc(T('swap.lcx.txMismatch')))
        expect(html).not.toContain('recipient')
    })

    // M3: LCX DISI bir ret (ATS ucreti onaylanan tavani asti, sponsor reddi, kilitli cuzdan...) arka planda islem kartina
    // 'error' olarak ZATEN yazildi; bugunku yol bu durumda ana sayfaya gider (kart orada). LCX yolu da ayni davranir:
    // "teklif alinamadi" deyip ekranda tutmak kullaniciyi yanlis bir sebeple ve kartin uzaginda birakirdi. BASKA MOTOR DENENMEZ.
    const LCX_DISI_RETLER = [
        ['kodsuz { error } (ATS ucreti onaylanan tutari asti)', { error: 'ATS ucreti onaylanan tutari asti (2 > 1)' }],
        ['kodsuz { error } (kilitli cuzdan)', { error: 'Wallet is locked' }],
        ['tanimsiz kodlu hata (SWAP_USEROP_FAILED)', hata('SWAP_USEROP_FAILED')],
    ]
    for (const [ad, yanit] of LCX_DISI_RETLER) {
        it(`${ad}: bugunku yol gibi ANA SAYFAYA gidilir (kart orada), LCX bildirimi YOK, yeni SWAP / teklif istenmez`, async () => {
            yanitlar.takas = [yanit]
            const { state } = await ciz()
            const onceTeklif = teklifSayisi()
            await state.swap()
            expect(pageStore().currentPage).toBe('home')
            expect(state.lcxNotice).toBeNull()
            expect(swapSayisi()).toBe(1)
            expect(teklifSayisi()).toBe(onceTeklif)
            expect(konsol.mock.calls.filter((c) => c[0] === 'LCX takas reddedildi:')).toEqual([])
            const html = await gorunum((s) => { s.lcxNotice = state.lcxNotice })
            expect(html).not.toContain(esc(T('swap.quoteFailed')))
            expect(html).not.toContain(esc(String(yanit.error)))
        })
    }

    it('LCX yurutme kodlarinin HEPSI (calls.js LCX_EXEC_CODES + LCX_SHARED_CODES) ekranda kalir; listede olmayan kod ana sayfaya gider', async () => {
        for (const kod of [...LCX_EXEC_CODES, ...LCX_SHARED_CODES]) {
            yanitlar = VARSAYILAN_YANITLAR()
            yanitlar.takas = [hata(kod)]
            yanitlar.teklif = [{ success: true, data: YENI_LCX_VERISI }]
            const { state } = await ciz()
            await state.swap()
            expect(pageStore().currentPage, kod).toBe('swap')
            expect(state.lcxNotice, kod).not.toBeNull()
        }
    })

    it('ilk alim kapisi reddi (STOCK_GATE) LCX hatasi sayilmaz: ekranda kalinir, bildirim YOK (kapi bandi yenilenir)', async () => {
        yanitlar.takas = [{ error: 'STOCK_GATE:IP_COUNTRY_ISSUER' }]
        const { state } = await ciz()
        await state.swap()
        expect(pageStore().currentPage).toBe('swap')
        expect(state.lcxNotice).toBeNull()
        expect(swapSayisi()).toBe(1)
        expect(konsol).not.toHaveBeenCalled() // kapi reddi LCX hatasi olarak kaydedilmez
    })

    it('belirsiz sonuc (unverified) bugunku gibi ana sayfaya gider (islem karti orada)', async () => {
        yanitlar.takas = [{ error: 'unverified', unverified: true }]
        const { state } = await ciz()
        await state.swap()
        expect(pageStore().currentPage).toBe('home')
        expect(state.lcxNotice).toBeNull()
        expect(konsol).not.toHaveBeenCalled()
    })

    it('yeni bir onay denemesi onceki bildirimi temizler', async () => {
        yanitlar.takas = [hata('LCX_UNAVAILABLE'), { success: true, hash: '0xuserop' }]
        const { state } = await ciz()
        await state.swap()
        expect(state.lcxNotice).not.toBeNull()
        expect(konsol).toHaveBeenCalledWith('LCX takas reddedildi:', 'LCX_UNAVAILABLE', '')
        await state.swap()
        expect(state.lcxNotice).toBeNull()
        expect(pageStore().currentPage).toBe('home')
    })

    it('LCX DISI yolda (lcxQuote yok) hata yaniti bugunku davranis: ana sayfa, bildirim YOK', async () => {
        yanitlar.takas = [{ error: 'Insufficient balance.' }]
        const { state } = await ciz({ swapData: TAKAS_VERISI })
        await state.swap()
        expect(pageStore().currentPage).toBe('home')
        expect(state.lcxNotice).toBeNull()
    })
})

// M1: LCX teklifi gaz tahmini tasimayabilir (`gasEstimateWei` null -> mapQuote totalCost null; uydurma sayi yazilmaz). Native gaz
// uyarisi bunu 0 sayarsa uyari kaybolur. Spec 3: null ise bugunku SWAP_GAS_FALLBACK -- swapReserve'in teklif yokken kullandigi
// sabitle AYNI (SWAP_GAS_FALLBACK x gaz fiyati). Teklif tahmin tasiyorsa (bugunku motor her zaman tasir) gaz fiyati OKUNMAZ.
describe('Swap.vue (SSR) -- LCX: teklif gaz tahmini tasimiyorsa native gaz uyarisi kaybolmaz (M1)', () => {
    const GWEI5 = 5_000_000_000n
    const yedekMaliyet = Number(BigInt(SWAP_GAS_FALLBACK) * GWEI5) / 1e18 // 0.0015
    const gazli = (totalCost) => ({
        ...LCX_VERISI,
        estimatedGasFee: { totalCost, totalCostFormatted: totalCost === null ? null : `${totalCost} BNB`, totalCostUSD: null, gasType: 'Estimated' },
    })
    // Cizim de teklif isteyebilir (onMounted -> onServerPrefetch); olcum yalniz asagidaki getSwapData turundan.
    const teklifTuru = async ({ teklif, bakiyeWei }) => {
        rpc.getBalance.mockReset()
        rpc.getFeeData.mockReset()
        rpc.getBalance.mockResolvedValue(bakiyeWei)
        rpc.getFeeData.mockResolvedValue({ maxFeePerGas: GWEI5, gasPrice: GWEI5 })
        yanitlar.teklif = [{ success: true, data: teklif }]
        const { state } = await ciz()
        rpc.getFeeData.mockClear()
        await state.getSwapData()
        return state
    }

    it(`totalCost null, ERC-20 girdi, native bakiye 0.001 < SWAP_GAS_FALLBACK x 5 gwei (${yedekMaliyet}): uyari GORUNUR`, async () => {
        expect(yedekMaliyet).toBe(0.0015)
        const state = await teklifTuru({ teklif: gazli(null), bakiyeWei: 1_000_000_000_000_000n })
        expect(rpc.getFeeData).toHaveBeenCalledTimes(1)
        expect(state.evmInsufficientGas).toBe(true)
        expect(state.swapData.routerType.name).toBe('lcx')
        expect(state.quoteError).toBeNull()
    })

    it('totalCost null ama native bakiye yedek maliyetin ustunde (0.002): uyari yok', async () => {
        const state = await teklifTuru({ teklif: gazli(null), bakiyeWei: 2_000_000_000_000_000n })
        expect(rpc.getFeeData).toHaveBeenCalledTimes(1)
        expect(state.evmInsufficientGas).toBe(false)
    })

    it('teklif gaz tahmini tasiyorsa gaz fiyati OKUNMAZ ve teklifinki kullanilir (davranis degismedi)', async () => {
        const az = await teklifTuru({ teklif: gazli('0.0001'), bakiyeWei: 1_000_000_000_000_000n })
        expect(rpc.getFeeData).not.toHaveBeenCalled()
        expect(az.evmInsufficientGas).toBe(false)
        const cok = await teklifTuru({ teklif: gazli('0.002'), bakiyeWei: 1_000_000_000_000_000n })
        expect(rpc.getFeeData).not.toHaveBeenCalled()
        expect(cok.evmInsufficientGas).toBe(true)
    })

    it('gaz fiyati okunamazsa teklif DUSMEZ ("teklif alinamadi" yok); uyari bugunku gibi cizilmez', async () => {
        rpc.getBalance.mockReset()
        rpc.getFeeData.mockReset()
        rpc.getBalance.mockResolvedValue(1_000_000_000_000_000n)
        rpc.getFeeData.mockRejectedValue(new Error('rpc down'))
        yanitlar.teklif = [{ success: true, data: gazli(null) }]
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        try {
            const { state } = await ciz()
            await state.getSwapData()
            expect(state.quoteError).toBeNull()
            expect(state.swapData.routerType.name).toBe('lcx')
            expect(state.evmInsufficientGas).toBe(false)
        } finally {
            uyari.mockRestore()
        }
    })
})

// R26.3: onay sonrasi bildirim (lcxNotice) eski teklife aittir. Yeni teklif sonucu gelince (basari ya da hata karti) silinir:
// "fiyat degisti" karti bir red kartinin ustunde, hata bildirimi de saglikli bir yenilemeden sonra KALMAZ.
describe('Swap.vue (SSR) -- LCX: bildirim ve red durumu yeni teklifle temizlenir (R26)', () => {
    const FIYAT_DEGISTI = () => ({ key: 'swap.lcx.requoted', tone: 'requote' })
    const HATA_BILDIRIMI = () => ({ key: 'swap.lcx.unavailable', tone: 'error' })
    let konsol
    beforeEach(() => { konsol = vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { konsol.mockRestore() })

    it('saglikli yenileme (basarili teklif) "fiyat degisti" bildirimini siler', async () => {
        const { state } = await ciz({ onCapture: (s) => { s.lcxNotice = FIYAT_DEGISTI() } })
        expect(state.lcxNotice).not.toBeNull()
        await state.getSwapData()
        expect(state.swapData.lcxQuote).toEqual(LCX_QUOTE)
        expect(state.lcxNotice).toBeNull()
    })

    it('hata bildirimi saglikli yenilemeden sonra KALMAZ: SWAP LCX_UNAVAILABLE -> bildirim; sonraki basarili teklif -> yok', async () => {
        yanitlar.takas = [{ error: 'LCX_UNAVAILABLE', code: 'LCX_UNAVAILABLE' }]
        const { state } = await ciz()
        await state.swap()
        expect(state.lcxNotice).toMatchObject({ key: 'swap.lcx.unavailable' })
        await state.getSwapData()
        expect(state.lcxNotice).toBeNull()
    })

    it('LCX reddi bildirimi siler: "fiyat degisti" karti red kartinin ustunde durmaz', async () => {
        yanitlar.teklif = [{ error: 'LCX reddetti: off_peg', code: 'LCX_REFUSED', lcxCode: 'off_peg' }]
        const { state } = await ciz({ onCapture: (s) => { s.lcxNotice = FIYAT_DEGISTI() } })
        await state.getSwapData()
        expect(state.quoteError).toBe('lcx')
        expect(state.lcxNotice).toBeNull()
        const html = await gorunum((s) => { s.quoteError = state.quoteError; s.lcxRefusal = state.lcxRefusal; s.lcxNotice = state.lcxNotice })
        expect(html).toContain(esc(T('swap.lcx.offPeg')))
        expect(html).not.toContain(esc(T('swap.lcx.requoted')))
    })

    it('baska her teklif hatasi (miktar cok buyuk / bilinmeyen / kodsuz) da bildirimi siler', async () => {
        for (const yanit of [
            { error: 'LCX reddetti: insufficient_liquidity', code: 'LCX_REFUSED', lcxCode: 'insufficient_liquidity' }, // 'amount'
            { error: 'LCX reddetti: yeni_kod', code: 'LCX_REFUSED', lcxCode: 'yeni_kod' },                              // 'unknown'
            { error: 'bir seyler ters gitti' },                                                                         // 'unknown'
        ]) {
            yanitlar.teklif = [yanit]
            const { state } = await ciz({ onCapture: (s) => { s.lcxNotice = HATA_BILDIRIMI() } })
            await state.getSwapData()
            expect(state.quoteError).not.toBeNull()
            expect(state.lcxNotice, JSON.stringify(yanit)).toBeNull()
        }
    })

    it('teklif istegi firlatirsa (catch dali, "unknown") bildirim de silinir', async () => {
        yanitlar.teklif = [new Error('Extension context invalidated')]
        const { state } = await ciz({ onCapture: (s) => { s.lcxNotice = FIYAT_DEGISTI() } })
        await state.getSwapData()
        expect(state.quoteError).toBe('unknown')
        expect(state.lcxNotice).toBeNull()
        expect(konsol).toHaveBeenCalled() // catch dali hatayi kaydeder
    })

    it('yeniden teklif akisi: "fiyat degisti" yeni teklifin ARDINDAN yazilir (getSwapData onu silmez)', async () => {
        yanitlar.takas = [{ error: 'LCX_REQUOTE', code: 'LCX_REQUOTE' }]
        yanitlar.teklif = [{ success: true, data: YENI_LCX_VERISI }]
        const { state } = await ciz()
        await state.swap()
        expect(state.lcxNotice).toMatchObject({ key: 'swap.lcx.requoted' })
        expect(state.swapData.lcxQuote.quoteId).toBe('q-2')
    })

    // lcxRefusal, quoteError ile birlikte temizlenir (yoksa bayat red verisi ATS ucret teklifini sessizce kilitler).
    it('teklif icin miktar bosaltilinca (getSwapData erken donusu) red ve quoteError birlikte temizlenir', async () => {
        yanitlar.teklif = [{ error: 'LCX reddetti: off_peg', code: 'LCX_REFUSED', lcxCode: 'off_peg' }]
        const { state } = await ciz()
        await state.getSwapData()
        expect(state.lcxRefusal).toMatchObject({ code: 'off_peg' })
        expect(state.quoteError).toBe('lcx')

        state.inTokenAmount = ''
        await state.getSwapData()
        expect(state.quoteError).toBeNull()
        expect(state.lcxRefusal).toBeNull()
    })

    it('yeni basarili teklif de redi temizler; sonra ATS ucret teklifi yeniden istenir', async () => {
        yanitlar.teklif = [{ error: 'LCX reddetti: off_peg', code: 'LCX_REFUSED', lcxCode: 'off_peg' }, { success: true, data: LCX_VERISI }]
        const { state } = await ciz()
        await state.getSwapData()
        await state.refreshAtsOpFee()
        expect(atsLoad).not.toHaveBeenCalled()
        await state.getSwapData()
        expect(state.lcxRefusal).toBeNull()
        await state.refreshAtsOpFee()
        expect(atsLoad).toHaveBeenCalledTimes(1)
    })

    // SSR'de izleyiciler ve ag / hesap degisimi calismaz: quoteError'u temizleyen HER yer lcxRefusal'i da temizlemeli (kaynak kilidi).
    it('quoteError temizlenen her yerde (8 yer) lcxRefusal da temizlenir', () => {
        const kaynak = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Swap.vue'), 'utf8')
        const satirlar = yorumsuz(kaynak).split(/\r?\n/)
        const temizleyenler = satirlar
            .map((satir, i) => [satir.trim(), i])
            .filter(([satir]) => /^quoteError\.value = (null|saleHint\.value \? 'route' : null)$/.test(satir))
        // getSwapData: bas + 4 erken donus; ag izleyicisi; hesap/mod degisimi; ATS Al acici.
        expect(temizleyenler.length).toBeGreaterThanOrEqual(8)
        for (const [, i] of temizleyenler) {
            expect(satirlar.slice(i, i + 3).join('\n'), `satir ${i + 1}`).toContain('lcxRefusal.value = null')
        }
    })
})

describe('Swap.vue (SSR) -- LCX: kaynak kilitleri', () => {
    const kaynak = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Swap.vue'), 'utf8')

    it('bildirim token / miktar degisince temizlenir (saleNotice ile ayni izleyici)', () => {
        const izleyici = kaynak.match(/watch\(\(\) => \[crypto\.swap\.inToken, crypto\.swap\.outToken, inTokenAmount\.value\], \(\) => \{([\s\S]*?)\n\}\)/)
        expect(izleyici).not.toBeNull()
        expect(izleyici[1]).toContain('lcxNotice.value = null')
    })

    it('yenileme araligi 10000 ms (kota tasarrufu istemci onbellegiyle, aralik DEGISMEDI)', () => {
        expect(kaynak).toMatch(/\}, 10000\)/)
    })
})
