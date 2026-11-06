// Token.vue (SSR) -- bStock satiri ARTIK duz token gibi (hisse ekrani T9).
//
// ESKI KONU (Task 10): rozet, ihracci notu, ISIN, kopru kapisi ve Atlas fiyat
// satiri Token.vue'da idi. Hisse detayi StockDetail'e tasindi (popup/App.vue,
// stockRoute.js); bu dosya artik Token.vue'nun o yuzeyleri TASIMADIGINI ve
// bStock satirindaki geri kalan davranisin (bakiye BSC'den, Takas acik, Kopru
// normal token gibi) korundugunu kilitler. Asagidaki tarihce yorumu eski
// tasarimi anlatir.
//
// KOD SEVIYESINDE KOPRU ZATEN KAPALI (commit 340603b): utils/bridge.js
// bridgeQuote bStock icin BSTOCK_NOT_BRIDGEABLE firlatiyor (ag cagrisi
// YAPMADAN) ve bridge/bridgeFrom.vue bStocklari listeden eliyor. Bu dosyanin
// konusu ARAYUZ ayagi -- token detayindaki Kopru butonunun KENDISI: kullanici
// hala bu ekrandan Kopru'ya basabiliyordu ve akis LI.FI'nin rota bulamamasiyla
// hatayla bitiyordu (bStocks kovada oldugu icin secicide GORUNUYOR ama
// kotasyonsuz). Buton disabled yapilir VE yanina aciklama konur.
//
// Takas KAPANMAZ: PancakeSwap rotasi gercek ve zincirde olculdu (bStocks.js
// bas yorumu, verify:bstocks). Bu dosya o ayrimi da kilitler.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu -- hoisting, bilesen import edilmeden ONCE devreye
// girmeli). Kalip Token.ssr.test.js / HomeJettonPrice.ssr.test.js'ten kopyalandi.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu buton/rozet gorunurlugu: gercek fiyat/bakiye aginin
// (axios, useTokenBalance) hicbirine ihtiyaci yok -- Token.ssr.test.js'teki
// AYNI gerekce (native olmayan adresle bile ERC-20 decimals() dali calisir
// ama bu dosyada ilgilenilen alan degil, bu yuzden useTokenBalance/ethers
// hatalari sessizce yutulur, testi etkilemez).
const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// bStock adresleri NATIVE ('0x0') DEGIL, yani onMounted'in ERC-20 decimals()
// dali gercekten calisir ve GERCEK bir RPC'ye baglanmaya calisirdi
// (Home.allNetworks.ssr.test.js / HomeJettonPrice.ssr.test.js ile AYNI mock):
// sahte saglayici decimals() cagrisini dusurur, kod zaten kendi catch'inde
// varsayilan 18'e duser -- bu dosyanin konusu decimals DEGIL, rozet/buton.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'
import { BSTOCKS } from '../data/bStocks'

const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

// GOOGLB -- brief'teki ornek bStock (task-10-brief.md, Son Dogrulama adim 2).
const GOOGLB = BSTOCKS.find((s) => s.symbol === 'GOOGLB')

// AYNI zincirde (56) ama katalogda OLMAYAN bir adres -- bStock OLMAYAN BSC
// tokeni. isBStock bu adresi BSTOCKS Map'inde bulamaz ve false doner.
const NON_BSTOCK_BSC_ADDRESS = '0x55d398326f99059fF775485246999027B3197955' // USDT (BSC)

// SSR CIKTISI SABLON YORUMLARINI AYNEN TASIR -- olculdu: bStock OLMAYAN bir
// tokende bile Token.vue'nun `<!-- ISIN yalnizca bStock satirinda ... -->`
// yorumu HTML'de geciyor. Yani duz bir `toContain('ISIN')` iddiayi KENDI
// YORUMUYLA yesil tutuyordu. Bu dosyadaki her POZITIF metin iddiasi ayni
// tuzagi tasir; yorumlar once temizlenir.
const yorumsuzHtml = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

// ROZET ELEMANI: gorunen metni TAM OLARAK rozet metni olan oge. Duz
// `toContain('Tokenized stock')` kopru aciklamasindaki "Tokenized stocks exist
// only on BNB Chain..." cumlesiyle de karsilaniyordu: rozet silinse (ya da
// govdesi bosaltilsa) bile test yesil kaliyordu.
const rozetVar = (html) => />\s*Tokenized stock\s*</.test(yorumsuzHtml(html))

// BUTONLAR: acilis etiketinin nitelikleri + gorunen metni. Yorumlar ONCE silinir:
// Token.vue'daki "Swap/Bridge" yorumu SSR ciktisina siziyordu ve eski
// `<button...>[\s\S]*?Bridge` regex'i orada durup Kopru'yu HIC icermeyen bir
// araligi olcuyordu.
const butonlar = (html) => [...yorumsuzHtml(html).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map(([, nitelikler, govde]) => ({
        nitelikler,
        metin: govde.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
    }))

// Gorunen metni TAM OLARAK `etiket` olan TEK buton.
const etiketliButon = (html, etiket) => {
    const bulunan = butonlar(html).filter((b) => b.metin === etiket)
    expect(bulunan, `"${etiket}" butonu tam olarak bir kez render edilmeli`).toHaveLength(1)
    return bulunan[0]
}

// `disabled` NITELIGI. Butonun class'inda HER ZAMAN duran Tailwind
// `disabled:opacity-40` oneki sayilmaz (eski regex tam ona takiliyordu):
// tirnakli degerler silinir, kalan nitelik ADLARINDA `disabled` aranir.
const devreDisi = (buton) => /(^|\s)disabled(?=\s|=|$)/.test(buton.nitelikler.replace(/"[^"]*"/g, '""'))

const mockTokenRecord = (overrides = {}) => ({
    name: 'Alphabet',
    symbol: 'googlb',
    coingecko_id: 'alphabet-bstocks-tokenized-stock',
    image: { thumb: '', large: '' },
    address: '0x0',
    market_data: {
        priceUSD: 250,
        market_cap: 1000,
        volume: 500,
        circulating_supply: 1000,
        ath: 260,
        atl: 200,
        change: { h24: 0.1 },
        sparkline: { d7: [] },
    },
    ...overrides,
})

afterEach(() => {
    axiosPostMock.mockClear()
    useTokenBalanceMock.mockClear()
    delete globalThis.chrome
})

function setup({ tokenId, address, aktifAg = BSC_CHAIN, locale = 'en' }) {
    installChromeStub({
        currentNetwork: aktifAg,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })

    const app = createApp(Token, { props: { id: tokenId } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))

    const network = networkStore()
    network.currentNetwork = aktifAg

    const crypto = cryptoStore()
    // `chainId` SATIRIN zinciri, aktif agin DEGIL: Home'un Hisseler sekmesi
    // aktif ag ne olursa olsun goruluyor ve bir hisseye basmak bu kaydi yaziyor.
    crypto.selected_token_ref = { id: tokenId, chainId: 56, address }

    return { app }
}

const bstockKaydi = () => ({ status: 200, data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id, price_source: 'atlas', price_updated_at: new Date(Date.now() - 60000).toISOString() }) } })

describe('Token.vue (SSR) -- bStock urun yuzeyi artik YOK (T9)', () => {
    it('bStock satirinda rozet, ihracci notu, ISIN, kopru aciklamasi ve fiyat kaynagi satiri render edilmez', async () => {
        axiosPostMock.mockResolvedValue(bstockKaydi())

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        const captured = captureInstance(app, 'Token')
        const html = yorumsuzHtml(await render(app))

        // Kayit GERCEKTEN yuklendi (baslikta fiyat var); yoklugu kuraldan.
        expect(html).toContain('$250.00')
        expect(rozetVar(html)).toBe(false)
        expect(html).not.toContain('Tokenized stock')
        expect(html).not.toContain('cannot be bridged')
        expect(html).not.toContain('>ISIN<')
        expect(html).not.toContain(GOOGLB.isin)
        expect(html).not.toContain('Atlas Oracle')
        const durum = captured.instance.setupState
        expect(durum.tokenIsBStock).toBeUndefined()
        expect(durum.tokenIsXStock).toBeUndefined()
        expect(durum.bStockIsin).toBeUndefined()
        expect(durum.atlasPriced).toBeUndefined()
    })

    it('Kopru butonu normal token gibi (canBridge) ve Takas acik; Al / Sat dugmesi yok', async () => {
        axiosPostMock.mockResolvedValue(bstockKaydi())

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.canBridge).toBe(true)
        expect(devreDisi(etiketliButon(html, 'Bridge'))).toBe(false)
        expect(captured.instance.setupState.canSwap).toBe(true)
        expect(devreDisi(etiketliButon(html, 'Swap'))).toBe(false)
        expect(html).not.toContain('data-xstock-trade')
        expect(butonlar(html).filter((b) => b.metin === 'Buy / Sell')).toHaveLength(0)
    })

    it('bStock OLMAYAN bir BSC tokeninde de ayni: rozet yok, Kopru acik', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: 'tether', name: 'Tether USD', symbol: 'usdt' }) },
        })

        const { app } = setup({ tokenId: 'tether', address: NON_BSTOCK_BSC_ADDRESS })
        captureInstance(app, 'Token')
        const html = await render(app)

        expect(rozetVar(html)).toBe(false)
        expect(devreDisi(etiketliButon(html, 'Bridge'))).toBe(false)
    })

    // Kaynak taramasi: SSR'de gorunmeyen baglar da dahil, olu dallar geri gelmesin.
    it('Token.vue kaynaginda hisse dallari ve ilgili i18n anahtarlari yok', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./Token.vue', import.meta.url)), 'utf8')
        for (const yasak of ['tokenIsBStock', 'tokenIsXStock', 'xStockInfo', 'bStockIsin', 'atlasPriced', 'selectStockTrade',
            'stockTrade.entry', 'bStockNoBridge', 'xStockNoBridge', 'noBridgeKey', 'token.bStockBadge', 'token.bStockIssuer']) {
            expect(kaynak, yasak).not.toContain(yasak)
        }
    })
})

describe('Token.vue (SSR) -- bStock satirinda bakiye ve Takas (korunan davranis)', () => {
    // HISSELER SEKMESI AKTIF AG NE OLURSA OLSUN GORULUYOR: bakiye BSC'den okunmali,
    // aktif agin ucuna sorulursa o adreste kontrat yoktur ve kullanici SIFIR gorur.
    it('Ethereum aktifken acilan bStock ta bakiye BSC den okunur', async () => {
        axiosPostMock.mockResolvedValue(bstockKaydi())

        const { app } = setup({
            tokenId: GOOGLB.coingecko_id,
            address: GOOGLB.address,
            aktifAg: ETH_CHAIN,
        })
        captureInstance(app, 'Token')
        await render(app)

        expect(networkStore().currentNetwork.chainId).toBe(1)

        const cagri = useTokenBalanceMock.mock.calls.at(-1)
        expect(cagri).toBeDefined()
        const [, tokenAdresi, rpc, chainId] = cagri
        expect(tokenAdresi).toBe(GOOGLB.address)
        // 4. arguman OLMADAN useTokenBalance'in bStock kolu ACILMAZ ve bakiye
        // `balanceOf` ile (carpansiz) SESSIZCE EKSIK cikar.
        expect(chainId).toBe(56)
        // `chain.rpc` DIZE DIZISI DEGIL, `{ url }` nesneleri tasir.
        const uclari = (chain) => chain.rpc.map((r) => (typeof r === 'string' ? r : r.url))
        expect(uclari(BSC_CHAIN)).toContain(rpc)
        expect(uclari(ETH_CHAIN)).not.toContain(rpc)
    })
})
