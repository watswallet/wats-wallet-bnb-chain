// Home.vue VARLIKLAR: xStock fiyati zincirdeki carpana bolunur (spec 8.2). Carpan bilinmiyorsa miktar gorunur,
// DEGER tire olur ve toplama katilmaz: ham CoinGecko fiyati ve uydurma 0 YAZILMAZ (K4).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bayrak ACIKCA kapali (C-02): fiyatin carpana bolunmesi bayraktan BAGIMSIZDIR, butun dosya bu kosulda kosar.
vi.mock('../utils/featureFlags', async (importOriginal) => ({ ...(await importOriginal()), XSTOCKS_ENABLED: false }))

// Zincirden okuma: 2 token. Solana yok.
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 2 }))
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))

// Carpan testten degistirilir: bilinen (SPYx, spec Ek B.1) ya da bilinmeyen (null).
// `zincir` / `adres`: carpanin AIT oldugu (zincir, adres) cifti; beforeEach'te SPYx'e (Ethereum) ayarlanir.
const carpan = vi.hoisted(() => ({ deger: null, cagrilar: [], zincir: null, adres: null, kayitsiz: false }))
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    // Kablolama kaniti: hangi satirlarla ve hangi RPC ile cagrildigi kaydedilir.
    ensureMultipliersFor: async (tokens, opts) => { carpan.cagrilar.push({ tokens, rpc: opts?.rpcFor?.(1) }) },
    // FIN-bilesen-2 (Review Focus 1): carpan yalniz DOGRU (zincir, adres) ciftine doner. Argumanlari yok sayan
    // `() => deger` mock'u, tuketicinin zinciri dusurmesini (ya da baska zincirle sormasini) yakalayamazdi.
    multiplierFor: (chainId, address) => (
        Number(chainId) === carpan.zincir && String(address).toLowerCase() === carpan.adres ? carpan.deger : null
    ),
}))

// CoinGecko ham fiyati 781,30; 24 saat onceki sparkline noktasi 780. Degiskenler yalniz IC fonksiyonda kullanilir
// (fabrika import aninda calisir, modul duzeyi sabitler o an henuz atanmamistir).
vi.mock('axios', () => ({
    default: {
        post: async () => ({
            status: 200,
            data: {
                // FIN-bilesen-1: sunucu bulunmayan kimligi SESSIZCE dusurur -> bos dizi (kayitsiz vaka).
                tokens: carpan.kayitsiz ? [] : [{
                    coingecko_id: 'sp500-xstock',
                    market_data: {
                        priceUSD: 781.3,
                        change: { h24: 0.17 },
                        sparkline: { d7: Array.from({ length: 144 }, (_, i) => (i === 143 ? 780 : 781.3)) },
                    },
                }],
            },
        }),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import Home from './Home.vue'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'
import { XSTOCKS_ENABLED } from '../utils/featureFlags'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const HESAP = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' }
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')
const SPY_KEY = `1_${SPY.address}`
const SPY_M = 1005714560286254000n
const FAKTOR = 1.005714560286254 // SPY_M / 1e18

beforeEach(() => {
    carpan.deger = null
    carpan.kayitsiz = false
    carpan.zincir = 1
    carpan.adres = SPY.address.toLowerCase()
    carpan.cagrilar.length = 0
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

// G3: SSR cikti sablon yorumlari tasir; metin aramadan once temizlenir.
const temiz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
// C-01: SPY satirinin DEGER HUCRESI (satirin sagindaki kalin tutar span'i).
const spySatiri = (html) => temiz(html).split('<button').find((b) => b.includes('2.0000 SPYX'))
const degerHucresi = (html) => spySatiri(html).match(/<span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">([^<]*)<\/span>/)[1]

async function acilis({ ekstra = [] } = {}) {
    installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: HESAP,
        imported_tokens: {
            acc1: { 1: [{ coingecko_id: 'sp500-xstock', address: SPY.address, decimals: 18, symbol: 'SPYx', name: 'SP500' }, ...ekstra] },
        },
        vaults: [],
    })

    const pinia = createTestPinia()
    const app = createApp(Home, { props: { embedded: false } })
    app.use(pinia)
    app.use(createTestI18n())
    const network = networkStore()
    network.currentNetwork = ETH_CHAIN
    // RPC KAPISI (updateBalance basi): `network.rpc` yoksa tur HIC kosmaz.
    network.setRpc(ETH_CHAIN.rpc[0].url, ETH_CHAIN.chainId)

    const captured = captureInstance(app, 'Home')
    const html = await render(app)
    return { captured, html, user: userStore() }
}

describe('Home.vue (SSR) - xStock Varliklar fiyati', () => {
    it('carpan biliniyorsa fiyat, deger ve toplam BIRIM fiyatla (776,86) hesaplanir', async () => {
        carpan.deger = SPY_M

        const { user, html } = await acilis()

        const satir = user.tokenBalances[SPY_KEY]
        expect(satir.price).toBeCloseTo(781.3 / FAKTOR, 6)
        expect(satir.value).toBeCloseTo((2 * 781.3) / FAKTOR, 6)
        expect(satir.valueUnknown).toBeFalsy()
        expect(user.usd).toBeCloseTo((2 * 781.3) / FAKTOR, 6)
        expect(html).toContain('$1553.72') // Home.formatUSDAmount(2 x 776,86)
        expect(degerHucresi(html)).toBe('$1553.72')
    })

    // C-02: fiyatin carpana bolunmesi XSTOCKS_ENABLED'dan bagimsiz (balanceOf zaten carpanli; bolmemek yanlis deger).
    it('C-02: XSTOCKS_ENABLED=false iken de fiyat carpana bolunur (bayrak fiyati kapatmaz)', async () => {
        expect(XSTOCKS_ENABLED).toBe(false)
        carpan.deger = SPY_M

        const { user, html } = await acilis()

        expect(user.tokenBalances[SPY_KEY].price).toBeCloseTo(781.3 / FAKTOR, 6)
        expect(degerHucresi(html)).toBe('$1553.72')
        expect(degerHucresi(html)).not.toBe('$1562.60') // ham fiyatla 2 x 781,30
    })

    // Review Focus 2: sparkline de bolunmeli. Yalniz fiyat bolunurse 24 saatlik degisim -6,28 (yanlis isaret)
    // cikardi; ayni carpanla bolununce +2,59.
    it('Review Focus 2: gunluk degisim AYNI carpanla bolunmus sparkline ile hesaplanir (sahte yuzde yok)', async () => {
        carpan.deger = SPY_M

        const { user } = await acilis()

        expect(user.percentageUSD).toBeCloseTo((2 * (781.3 - 780)) / FAKTOR, 6)
    })

    // Review Focus 2: carpan okunamadi / 0 / onbellek 60 sn'yi asti -> multiplierFor null.
    it('Review Focus 2: carpan bilinmiyorsa miktar gorunur, DEGER tire, toplama katilmaz; ham fiyat sizmaz', async () => {
        carpan.deger = null

        const { user, html } = await acilis()

        const satir = user.tokenBalances[SPY_KEY]
        expect(satir.amount).toBe(2)
        expect(satir.valueUnknown).toBe(true)
        expect(satir).not.toHaveProperty('value')
        expect(satir).not.toHaveProperty('price')
        expect(user.usd).toBe(0)
        const govde = temiz(html)
        expect(govde).not.toContain('$1562.60') // ham fiyatla 2 x 781,30
        expect(govde).not.toContain('$1553.72')
        expect(govde).toContain('\u2014')
        // C-01: SPY satirinin DEGER HUCRESI tam olarak tire; "$0.00" degil.
        expect(degerHucresi(html)).toBe('\u2014')
        expect(degerHucresi(html)).not.toContain('$0.00')
    })

    // Kablolama: carpanlar turun basinda, xStock satirlari ve o zincirin RPC'si ile doldurulur.
    it('updateBalance carpanlari ensureMultipliersFor ile doldurur (SPYx satiri + zincirin RPC ucu)', async () => {
        carpan.deger = SPY_M

        await acilis()

        expect(carpan.cagrilar.length).toBeGreaterThan(0)
        const cagri = carpan.cagrilar[0]
        expect(cagri.tokens.some((t) => t.address === SPY.address && t.chainId === 1)).toBe(true)
        expect(cagri.rpc).toBe(ETH_CHAIN.rpc[0].url)
    })

    // FIN-bilesen-1: /getTokensDataById bulunmayan kimligi SESSIZCE dusurur (seed calismadi / yeni katalog satiri).
    // Carpan bilinse bile fiyat KAYDI yoksa deger bilinmez: miktar gorunur, DEGER tire, "$0.00" DEGIL, toplama katilmaz.
    it('FIN-bilesen-1: sunucuda fiyat kaydi yoksa (tokens: []) miktar gorunur, DEGER hucresi tire ("$0.00" degil), toplam 0', async () => {
        carpan.kayitsiz = true
        carpan.deger = SPY_M

        const { user, html } = await acilis()

        const satir = user.tokenBalances[SPY_KEY]
        expect(satir.amount).toBe(2)
        expect(satir.valueUnknown).toBe(true)
        expect(satir).not.toHaveProperty('value')
        expect(satir).not.toHaveProperty('price')
        expect(satir).not.toHaveProperty('nowValue')
        expect(user.usd).toBe(0)
        expect(degerHucresi(html)).toBe('—')
        expect(degerHucresi(html)).not.toContain('$0.00')
    })

    it('FIN-bilesen-1: kayit da carpan da yoksa ayni sonuc (tire, toplam 0)', async () => {
        carpan.kayitsiz = true
        carpan.deger = null

        const { user, html } = await acilis()

        expect(user.tokenBalances[SPY_KEY].valueUnknown).toBe(true)
        expect(user.usd).toBe(0)
        expect(degerHucresi(html)).toBe('—')
    })

    it('FIN-bilesen-1: kayit sonradan gelince tire kalkar ve deger eklenir', async () => {
        carpan.kayitsiz = true
        carpan.deger = SPY_M
        const { captured, user } = await acilis()
        expect(user.tokenBalances[SPY_KEY].valueUnknown).toBe(true)

        carpan.kayitsiz = false
        await captured.instance.setupState.getTokensData()
        await captured.instance.setupState.updateBalance()

        expect(user.tokenBalances[SPY_KEY].valueUnknown).toBe(false)
        expect(user.tokenBalances[SPY_KEY].value).toBeCloseTo((2 * 781.3) / FAKTOR, 6)
    })

    // Kapsam siniri: kural yalniz xStock satirina uygulanir; kaydi olmayan DUZ token eski davranisla kalir.
    it('FIN-bilesen-1: kaydi olmayan xStock OLMAYAN token valueUnknown ISARETLENMEZ (davranis degismez)', async () => {
        carpan.kayitsiz = true
        carpan.deger = SPY_M
        const DUZ = '0x1111111111111111111111111111111111111111'

        const { user } = await acilis({ ekstra: [{ coingecko_id: 'duz-token', address: DUZ, decimals: 18, symbol: 'DUZ', name: 'Duz' }] })

        expect(user.tokenBalances[`1_${DUZ}`].amount).toBe(2)
        expect(user.tokenBalances[`1_${DUZ}`].valueUnknown).toBeFalsy()
    })

    it('carpan sonradan gelince tire kalkar ve deger eklenir', async () => {
        carpan.deger = null
        const { captured, user } = await acilis()
        expect(user.tokenBalances[SPY_KEY].valueUnknown).toBe(true)

        carpan.deger = SPY_M
        await captured.instance.setupState.updateBalance()

        expect(user.tokenBalances[SPY_KEY].valueUnknown).toBe(false)
        expect(user.tokenBalances[SPY_KEY].value).toBeCloseTo((2 * 781.3) / FAKTOR, 6)
    })
})
