//
// swapFrom "Select Token" listesi: HICBIR ANDA ayni `:key` iki satirda bulunmaz.
//
// KOK NEDEN. getChainTokens() sunucu listesini SUZULMEMIS olarak allTokens'a yazar; imported ile
// cakisanlari eleyen ve outToken'i disari alan suzgec loadTokens'ta, `await getChainTokens()`
// donusunde -- yani Vue'nun render isi (atamanin hemen ardindan siraya girer) calistiktan SONRA --
// uygulanir. Render o ara durumu cizer: [...imported, ...allTokens] ayni balanceKey'i iki kez tasir
// (BNB '0x0', SPCXB...). Ardindan suzgec calisinca liste tekrar benzersiz olur AMA Vue'nun anahtarli
// diff'i (patchKeyedChildren) ESKI listede tekrar eden anahtari tasiyamaz: outToken'in imported'dan
// dusmesi bastaki hizayi bozunca "bilinmeyen dizi" kolu iki eski dugumu ayni yeni vnode'a yamar,
// birini ne kullanir ne kaldirir -> ekranda ARTAN satir. Mantiksal liste dogru kalir, DOM yanlistir.
//
// SSR'de diff YOK; bu test bu yuzden sonucu degil DEGISMEZI olcer: displayedTokens'in her ara degeri
// (flush:'sync' izleyici) benzersiz anahtar tasimali. Eksik bir zaman noktasi kalmaz.
import { describe, it, expect, vi, afterEach } from 'vitest'

// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Satis bayragi: hedef ATS iken liste ya sabit odeme listesidir (acik) ya da genel birlesimdir (kapali).
const satis = vi.hoisted(() => ({ acik: true }))
vi.mock('../../utils/atsSaleConfig', async (importOriginal) => ({
    ...(await importOriginal()),
    isAtsSaleLive: () => satis.acik,
}))

const useTokenBalanceMock = vi.fn()
vi.mock('../../composables/useTokenBalance', () => ({
    useTokenBalance: (...a) => useTokenBalanceMock(...a),
}))
const axiosPost = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: vi.fn() } }))

import { watch } from 'vue'
import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { balanceKey } from '../../utils/tokenScope'
import SwapFrom from './swapFrom.vue'
import supported_chains from '../../data/supported_chains.json'
import { BSTOCKS } from '../../data/bStocks'

const BSC = supported_chains.find((c) => c.chainId === 56)
const SPCXB = BSTOCKS.find((t) => t.symbol === 'SPCXB')
const ZERO = '0x0000000000000000000000000000000000000000'
const ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const USD1 = '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d'
const USDT = '0x55d398326f99059fF775485246999027B3197955'
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'
const img = { thumb: 't', small: 's', large: 'l' }

// Depo: sunucu varsayilani [ATS, BNB] + Ana ekranin sahip olunan hisseye ekledigi SPCXB (seedOwnedBStocks).
// Adresler depoda checksum'lu / ZeroAddress, sunucuda kucuk harf / '0x0' (balanceKey ikisini katlar).
const STORED = () => [
    { name: 'Alltoscan', symbol: 'ATS', address: ATS, decimals: 18, coingecko_id: 'alltoscan', image: img },
    { name: 'BNB', symbol: 'BNB', address: ZERO, decimals: 18, coingecko_id: 'binancecoin', image: img },
    { name: SPCXB.name, symbol: 'SPCXB', address: SPCXB.address, decimals: 18, coingecko_id: SPCXB.coingecko_id, image: img },
]
const SERVER = () => [
    { address: '0x0', chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'binancecoin', symbol: 'BNB', name: 'BNB', decimals: 18, image: img, native: true },
    { address: SPCXB.address.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: SPCXB.coingecko_id, symbol: 'SPCXB', name: SPCXB.name, decimals: 18, image: img },
    { address: USD1.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'usd1-wlfi', symbol: 'USD1', name: 'USD1', decimals: 18, image: img },
    { address: USDT.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'tether', symbol: 'USDT', name: 'Tether USD', decimals: 18, image: img },
    { address: ATS.toLowerCase(), chain: 'binance-smart-chain', chainId: 56, coingecko_id: 'alltoscan', symbol: 'ATS', name: 'Alltoscan', decimals: 18, image: img },
]
// openAtsPurchase (useAtsPurchase.js) ATS_SALE_OUT_RECORD ile ayni sekil: "ATS Al" sonrasi Swap boyle acilir.
const OUT_ATS = { name: 'Alltoscan', symbol: 'ats', address: ATS, decimals: 18, chainId: 56 }

afterEach(() => {
    delete globalThis.chrome
    satis.acik = true
    useTokenBalanceMock.mockReset()
    axiosPost.mockReset()
})

async function mount({ outToken, satisAcik = true }) {
    satis.acik = satisAcik
    installChromeStub({
        currentNetwork: BSC,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: { acc1: { 56: STORED() } },
    })
    useTokenBalanceMock.mockImplementation(async (_w, a) => {
        a = String(a).toLowerCase()
        if (a === '0x0' || a === ZERO) return 0.008354
        if (a === SPCXB.address.toLowerCase()) return 0.000065
        return 0
    })
    axiosPost.mockImplementation(async (url, body) => {
        if (url.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: SERVER() } }
        if (url.endsWith('/getTokensDataById')) {
            return { status: 200, data: { success: true, tokens: (body.ids || []).map((id) => ({ coingecko_id: id, market_data: { priceUSD: 1 } })) } }
        }
        throw new Error('beklenmeyen url ' + url)
    })

    const app = createApp(SwapFrom)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = BSC
    network.rpc = BSC.rpc[0].url
    cryptoStore().swap.outToken = outToken

    // Her ara degeri kaydet. onCapture, bilesenin KENDI yukleme kancasi ilk `await`inde beklerken
    // calisir; birlesim yolunda imported/allTokens atamalari ondan SONRA gelir, yani hicbir ara deger
    // kacmaz. Sabit odeme listesi ise ilk `await`ten ONCE yazilir (izleyici kurulmadan): `immediate`
    // o ilk degeri de kaydeder.
    const snapshots = []
    captureInstance(app, 'swapFrom', (instance) => {
        watch(
            () => instance.setupState.displayedTokens.map((t) => balanceKey(t.chainId, t.address)),
            (keys) => snapshots.push(keys),
            { flush: 'sync', immediate: true },
        )
    })
    await render(app)
    return { snapshots }
}

const yinelenen = (snapshots) => snapshots.filter((keys) => new Set(keys).size !== keys.length)

describe('swapFrom: listedeki :key degerleri HER ANDA benzersiz', () => {
    // ATS Al sonrasi (hedef ATS, BSC, satis yolu acik) liste genel birlesim DEGIL, sabit odeme listesidir
    // (bkz. swapFrom.atsSale.ssr.test.js); birlesim yolunun degismezi asagidaki testlerde kilitli.
    it('outToken = ATS (ATS Al sonrasi): yalniz BNB, USDT, USDC; hicbir ara listede yinelenen anahtar yok', async () => {
        const { snapshots } = await mount({ outToken: { ...OUT_ATS } })
        const odemeListesi = ['56_0x0', '56_' + USDT.toLowerCase(), '56_' + USDC.toLowerCase()]

        // Ilk kayit izleyicinin kuruldugu an, yani bakiye okumasi DAHA cozulmeden: satirlar o okumayi BEKLEMEZ
        // (tek RPC asilirsa secici bos kalmasin), bakiyeler sonradan satirlara islenir. Bos gecmis bu iddiada duser.
        expect(snapshots[0]).toEqual(odemeListesi)

        expect(yinelenen(snapshots)).toEqual([])
        // Son durum: odeme tokenleri, bu sirayla; ice aktarilanlar ve sunucu listesi karismaz.
        const son = snapshots[snapshots.length - 1]
        expect(son).toEqual(odemeListesi)
    })

    // Birlesim yolunun ASIL senaryosu: hedefin ice aktarilanlardan dusmesi baslardaki hizayi bozuyordu.
    // Hedef ATS olsa da satis yolu KAPALIYKEN liste ayni birlesimdir.
    it('outToken = ATS ama satis yolu kapali: hicbir ara listede yinelenen anahtar yok', async () => {
        const { snapshots } = await mount({ outToken: { ...OUT_ATS }, satisAcik: false })

        // Kontrol: izleyici gercekten ara degerleri gordu (bos gecmis testi anlamsiz kilardi). `immediate`
        // baslangic degerini de kaydettigi icin esik bir fazla: gercek degisim sayisi eskisiyle ayni.
        expect(snapshots.length).toBeGreaterThan(3)

        expect(yinelenen(snapshots)).toEqual([])
        // Son durum da dogru: ATS (outToken) yok, BNB ve SPCXB TEK.
        const son = snapshots[snapshots.length - 1]
        expect(son).toEqual([
            '56_0x0',
            '56_' + SPCXB.address.toLowerCase(),
            '56_' + USD1.toLowerCase(),
            '56_' + USDT.toLowerCase(),
        ])
    })

    it('outToken yok: ayni degismez', async () => {
        const { snapshots } = await mount({ outToken: null })
        // `immediate` baslangic degerini de kaydeder: esik bir fazla (gercek degisim sayisi eskisiyle ayni).
        expect(snapshots.length).toBeGreaterThan(3)
        expect(yinelenen(snapshots)).toEqual([])
    })
})
