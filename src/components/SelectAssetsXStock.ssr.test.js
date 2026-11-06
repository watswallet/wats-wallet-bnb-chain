// SelectAssets.vue (Gonder secicisi): xStock fiyati zincirdeki carpana bolunur (spec 8.2). Carpan bilinmiyorsa
// satir "$0.00" ya da ham fiyat DEGIL tire gosterir; Send.vue'nun okudugu sendAsset da ayni (bolunmus) kaydi tasir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Arama kutusu watch'inin geri cagrisi: SSR render BITINCE tum watch'lar durdurulur ve ertelenmis watch SSR kurulumunda
// hic kurulmaz, bu yuzden `setupState.searchTerm = ...` onu tetikleyemez. Kaynagi bir ref olan TEK watch (searchTerm)
// burada yakalanir; test onu dogrudan cagirir (digeri `() => network.rpc` bir fonksiyondur).
const izle = vi.hoisted(() => ({ aramaCb: null }))
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onMounted: actual.onServerPrefetch,
        watch: (source, cb, options) => {
            if (actual.isRef(source)) izle.aramaCb = cb
            return actual.watch(source, cb, options)
        },
    }
})

// Bayrak ACIKCA kapali (C-02): fiyatin carpana bolunmesi bayraktan BAGIMSIZDIR, butun dosya bu kosulda kosar.
vi.mock('../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: false }))
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 2 }))
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))

// `zincir` / `adres`: carpanin AIT oldugu (zincir, adres) cifti; beforeEach'te SPYx'e (Ethereum) ayarlanir.
const carpan = vi.hoisted(() => ({ deger: null, cagrilar: [], zincir: null, adres: null, ensureSart: false, bekle: null }))
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    // Kablolama kaniti: hangi satirlarla ve hangi RPC ile cagrildigi kaydedilir.
    ensureMultipliersFor: async (tokens, opts) => {
        carpan.cagrilar.push({ tokens, rpc: opts?.rpcFor?.(1) })
        if (carpan.bekle) await carpan.bekle // asili RPC benzetimi (FIN-bilesen-3: await sonrasi eskime)
    },
    // FIN-bilesen-2 (Review Focus 1): carpan yalniz DOGRU (zincir, adres) ciftine doner. Argumanlari yok sayan
    // `() => deger` mock'u, tuketicinin zinciri dusurmesini (ya da baska zincirle sormasini) yakalayamazdi.
    // `ensureSart`: gercek onbellek gibi, carpan o (zincir, adres) icin ensureMultipliersFor CAGRILDIKTAN sonra bilinir
    // (arama yolunda ensure satirini silmek ancak boyle kirmizi olur).
    multiplierFor: (chainId, address) => {
        const cift = Number(chainId) === carpan.zincir && String(address).toLowerCase() === carpan.adres
        if (!cift) return null
        const istendi = carpan.cagrilar.some((c) => c.tokens.some(
            (t) => Number(t.chainId) === carpan.zincir && String(t.address).toLowerCase() === carpan.adres,
        ))
        return carpan.ensureSart && !istendi ? null : carpan.deger
    },
}))

vi.mock('axios', () => ({
    default: {
        // /getChainTokens (arama): sunucu SPYx'i Ethereum damgasiyla doner; digerleri (/getTokensDataById) fiyat kaydi.
        post: async (url) => (String(url).endsWith('/getChainTokens')
            ? {
                status: 200,
                data: { tokens: [{ coingecko_id: 'sp500-xstock', address: SPY.address, decimals: 18, symbol: 'SPYx', name: 'SP500', chainId: 1 }] },
            }
            : {
                status: 200,
                data: {
                    tokens: [
                        { coingecko_id: 'sp500-xstock', market_data: { priceUSD: 781.3, change: { h24: 0.17 } } },
                        { coingecko_id: 'tether', market_data: { priceUSD: 1, change: { h24: 0 } } },
                    ],
                },
            }),
    },
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import SelectAssets from './SelectAssets.vue'
import { XSTOCKS } from '../data/xStocks'
import { assetPriceUSD } from '../utils/assetPrice'
import supported_chains from '../data/supported_chains.json'
import { XSTOCKS_ENABLED } from '../utils/featureFlags'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const SPY_M = 1005714560286254000n
const SPY_ROW = { coingecko_id: 'sp500-xstock', address: SPY.address, decimals: 18, symbol: 'SPYx', name: 'SP500' }
const USDT_ROW = { coingecko_id: 'tether', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, symbol: 'USDT', name: 'Tether' }

beforeEach(() => {
    carpan.deger = null
    carpan.cagrilar.length = 0
    carpan.zincir = 1
    carpan.adres = SPY.address.toLowerCase()
    carpan.ensureSart = false
    carpan.bekle = null
})

afterEach(() => {
    delete globalThis.chrome
})

async function mount(importedTokens) {
    installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
        imported_tokens: { acc1: importedTokens },
    })

    const app = createApp(SelectAssets)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = ETH_CHAIN

    const captured = captureInstance(app, 'SelectAssets')
    const html = await render(app)
    return { captured, html, crypto: cryptoStore() }
}

// G3: SSR cikti sablon yorumlari tasir; metin aramadan once temizlenir.
const temiz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// C-01: satirin FIYAT hucresi (sembolun altindaki ilk duz <span>) ve DEGER hucresi (sagdaki ikinci satir).
const fiyatHucresi = (html) => temiz(html).match(/<div class="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300"><span>([^<]*)<\/span>/)[1]
const degerHucresi = (html) => temiz(html).match(/<span class="text-xs text-slate-500 dark:text-zinc-500 group-hover:text-slate-600 dark:group-hover:text-zinc-400 transition-colors duration-300">([^<]*)<\/span>/)[1]

const satir = (captured, row) => captured.instance.setupState.currentTokens.find((t) => t.address === row.address)

describe('SelectAssets.vue (SSR) - xStock fiyati', () => {
    it('carpan biliniyorsa satir BIRIM fiyati (776,86) ve degerini gosterir', async () => {
        carpan.deger = SPY_M

        const { captured, html } = await mount({ 1: [SPY_ROW] })

        expect(satir(captured, SPY_ROW).market.priceUSD).toBeCloseTo(776.86, 2)
        expect(html).toContain('$776.86')
        expect(html).toContain('$1.55K') // 2 x 776,86
        expect(html).not.toContain('$781.30')
        expect(fiyatHucresi(html)).toBe('$776.86')
        expect(degerHucresi(html)).toBe('$1.55K')
    })

    // C-02: fiyatin carpana bolunmesi XSTOCKS_ENABLED'dan bagimsiz.
    it('C-02: XSTOCKS_ENABLED=false iken de satir fiyati carpana bolunur (bayrak fiyati kapatmaz)', async () => {
        expect(XSTOCKS_ENABLED).toBe(false)
        carpan.deger = SPY_M

        const { captured, html } = await mount({ 1: [SPY_ROW] })

        expect(satir(captured, SPY_ROW).market.priceUSD).toBeCloseTo(776.86, 2)
        expect(fiyatHucresi(html)).toBe('$776.86')
        expect(fiyatHucresi(html)).not.toBe('$781.30')
    })

    // Review Focus 2: carpan bilinmiyor -> "$0.00" yalan, ham fiyat yanlis; ekran tire yazar.
    it('Review Focus 2: carpan bilinmiyorsa satir tire gosterir ($0.00 ve ham fiyat YOK)', async () => {
        carpan.deger = null

        const { captured, html } = await mount({ 1: [SPY_ROW] })

        expect(satir(captured, SPY_ROW).market.priceUSD).toBe(0)
        const govde = temiz(html)
        expect(govde).toContain('\u2014')
        expect(govde).not.toContain('$0.00')
        expect(govde).not.toContain('$781.30')
        expect(govde).not.toContain('$1.56K')
        // C-01: FIYAT ve DEGER hucreleri tam olarak tire; "$0.00" degil.
        expect(fiyatHucresi(html)).toBe('\u2014')
        expect(degerHucresi(html)).toBe('\u2014')
    })

    // Kablolama: carpanlar fiyat kaydi islenmeden once, xStock satirlari ve zincirin RPC'si ile doldurulur.
    it('updateBalance carpanlari ensureMultipliersFor ile doldurur (SPYx satiri + zincirin RPC ucu)', async () => {
        carpan.deger = SPY_M

        await mount({ 1: [SPY_ROW] })

        expect(carpan.cagrilar.length).toBeGreaterThan(0)
        const cagri = carpan.cagrilar[0]
        expect(cagri.tokens.some((t) => t.address === SPY.address && t.chainId === 1)).toBe(true)
        expect(cagri.rpc).toBe(ETH_CHAIN.rpc[0].url)
    })

    it('Gonder akisi bolunmus kaydi tasir: assetPriceUSD(sendAsset) birim fiyat, bilinmiyorsa null', async () => {
        carpan.deger = SPY_M
        const bilinen = await mount({ 1: [SPY_ROW] })
        await bilinen.captured.instance.setupState.selectAsset(satir(bilinen.captured, SPY_ROW))
        expect(assetPriceUSD(bilinen.crypto.sendAsset)).toBeCloseTo(776.86, 2)

        carpan.deger = null
        const bilinmeyen = await mount({ 1: [SPY_ROW] })
        await bilinmeyen.captured.instance.setupState.selectAsset(satir(bilinmeyen.captured, SPY_ROW))
        expect(assetPriceUSD(bilinmeyen.crypto.sendAsset)).toBeNull()
    })

    it('xStock OLMAYAN token eskisi gibi: USDT $1.00, carpan sorusu fiyati degistirmez', async () => {
        carpan.deger = SPY_M

        const { captured, html } = await mount({ 1: [USDT_ROW] })

        expect(satir(captured, USDT_ROW).market.priceUSD).toBe(1)
        expect(html).toContain('$1.00')
    })
})

// FIN-bilesen-3: Gonder seciciyi ARAMA yolu (searchTerm -> /getChainTokens -> ensureMultipliersFor + displayMarket).
// Duzeltilen hata (aramada ham carpanli fiyat) birebir bu yolda; satir listesi testleri bu yola girmiyordu.
describe('SelectAssets.vue (SSR) - arama sonucundaki xStock fiyati', () => {
    // Arama kutusuna yazilan metin 400 ms sonra istek atar; sonuc (bakiye + fiyat + carpan) bitince isSearching duser.
    const ara = async (captured, terim) => {
        captured.instance.setupState.searchTerm = terim
        izle.aramaCb(terim)
        await vi.advanceTimersByTimeAsync(400)
        await vi.waitFor(() => expect(captured.instance.setupState.isSearching).toBe(false))
    }

    // SPYx ARAMA sonucunda gelir (hesabin ice aktarilmis listesinde YOK): carpan yalniz arama yolundaki ensure ile bilinir.
    const aramaHazirligi = async () => {
        const mounted = await mount({ 1: [USDT_ROW] })
        carpan.cagrilar.length = 0 // mount'un kendi ensure cagrisi sayilmasin
        carpan.ensureSart = true
        return mounted
    }

    it('carpan biliniyorsa arama sonucu BIRIM fiyatla gelir (776,86), ham 781,30 degil', async () => {
        carpan.deger = SPY_M
        const { captured } = await aramaHazirligi()
        vi.useFakeTimers()
        try {
            await ara(captured, 'spy')

            const { searchResults, priceLabel, valueLabel } = captured.instance.setupState
            expect(searchResults).toHaveLength(1)
            expect(searchResults[0].address).toBe(SPY.address)
            expect(searchResults[0].market.priceUSD).toBeCloseTo(776.86, 2)
            expect(priceLabel(searchResults[0])).toBe('$776.86')
            expect(valueLabel(searchResults[0])).toBe('$1.55K') // 2 x 776,86
            // Arama yolu da carpani SATIRIN (zincir, adres) ciftiyle ister.
            expect(carpan.cagrilar).toHaveLength(1)
            expect(carpan.cagrilar[0].tokens.some((t) => t.address === SPY.address && t.chainId === 1)).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it('carpan bilinmiyorsa arama sonucu tire gosterir (priceUSD 0; "$0.00" ve ham 781,30 YOK)', async () => {
        carpan.deger = null
        const { captured } = await aramaHazirligi()
        vi.useFakeTimers()
        try {
            await ara(captured, 'spy')

            const { searchResults, priceLabel, valueLabel } = captured.instance.setupState
            expect(searchResults).toHaveLength(1)
            expect(searchResults[0].market.priceUSD).toBe(0)
            expect(priceLabel(searchResults[0])).toBe('—')
            expect(valueLabel(searchResults[0])).toBe('—')
        } finally {
            vi.useRealTimers()
        }
    })

    it('carpan okunurken (ensure asili) terim degisirse ESKIMIS sonuca market YAZILMAZ', async () => {
        carpan.deger = SPY_M
        const { captured } = await aramaHazirligi()
        let birak
        vi.useFakeTimers()
        try {
            carpan.bekle = new Promise((cozum) => { birak = cozum })
            captured.instance.setupState.searchTerm = 'spy'
            izle.aramaCb('spy')
            await vi.advanceTimersByTimeAsync(400)
            await vi.waitFor(() => expect(carpan.cagrilar).toHaveLength(1)) // istek ensure'de ASILI

            const eski = captured.instance.setupState.searchResults
            expect(eski).toHaveLength(1)

            captured.instance.setupState.searchTerm = '' // terim bosaldi: asili istek artik GECERSIZ
            izle.aramaCb('')
            birak()
            await vi.advanceTimersByTimeAsync(10)

            expect(eski[0].market).toBeUndefined()
            expect(captured.instance.setupState.searchResults).toEqual([])
            expect(captured.instance.setupState.isSearching).toBe(false)
        } finally {
            vi.useRealTimers()
        }
    })
})
