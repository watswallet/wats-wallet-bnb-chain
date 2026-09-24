// Token.vue (SSR) -- bStocks rozeti, ihracci bilgisi ve kopru kapisi (Task 10).
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

function setup({ tokenId, address, aktifAg = BSC_CHAIN }) {
    installChromeStub({
        currentNetwork: aktifAg,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })

    const app = createApp(Token, { props: { id: tokenId } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = aktifAg

    const crypto = cryptoStore()
    // `chainId` SATIRIN zinciri, aktif agin DEGIL: Home'un Hisseler sekmesi
    // aktif ag ne olursa olsun goruluyor ve bir hisseye basmak bu kaydi yaziyor.
    crypto.selected_token_ref = { id: tokenId, chainId: 56, address }

    return { app }
}

describe('Token.vue (SSR) -- bStock rozeti, ihracci bilgisi ve kopru kapisi (Task 10)', () => {
    it('bStock satirinda rozet render edilir', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        captureInstance(app, 'Token')
        const html = await render(app)

        expect(html).toContain('Tokenized stock')
    })

    it('bStock satirinda Kopru butonu disabled', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.canBridge).toBe(true)
        expect(captured.instance.setupState.tokenIsBStock).toBe(true)

        const bridgeButtonMatch = html.match(/<button[^>]*disabled[^>]*>[\s\S]*?Bridge[\s\S]*?<\/button>/)
        expect(bridgeButtonMatch).not.toBeNull()
    })

    it('bStock satirinda aciklama metni render edilir', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        captureInstance(app, 'Token')
        const html = await render(app)

        expect(html).toContain('Tokenized stocks exist only on BNB Chain and cannot be bridged.')
    })

    it('bStock OLMAYAN bir BSC tokeninde Kopru butonu ACIK ve rozet YOK', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: 'tether', name: 'Tether USD', symbol: 'usdt' }) },
        })

        const { app } = setup({ tokenId: 'tether', address: NON_BSTOCK_BSC_ADDRESS })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.tokenIsBStock).toBe(false)
        expect(html).not.toContain('Tokenized stock')
        expect(html).not.toContain('Tokenized stocks exist only on BNB Chain and cannot be bridged.')

        const bridgeButtonMatch = html.match(/<button[^>]*>[\s\S]*?Bridge[\s\S]*?<\/button>/)
        expect(bridgeButtonMatch).not.toBeNull()
        expect(bridgeButtonMatch[0]).not.toContain('disabled')
    })

    // ISIN -- spec §6.2'nin kapanmamis tek vaadiydi: deger `data/bStocks.js`te
    // vardi ama HICBIR ekranda gosterilmiyordu. Tokenize edilmis SERTIFIKANIN
    // altindaki gercek menkul kiymeti kullanici ancak boyle dogrulayabilir.
    it('bStock satirinda ISIN gosterilir', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        const captured = captureInstance(app, 'Token')
        const html = yorumsuzHtml(await render(app))

        // Kayittaki DEGERIN KENDISI: sabit kodlanmis bir ornek degil.
        expect(GOOGLB.isin).toBeTruthy()
        expect(captured.instance.setupState.bStockIsin).toBe(GOOGLB.isin)
        // Etiket ve DEGER BIRLIKTE: ayri iki `toContain` ikisinin ayni satirda
        // oldugunu kanitlamaz ve "ISIN" dizesi baska bir yerden de gelebilir.
        expect(html).toMatch(new RegExp(`>ISIN<[\\s\\S]{0,300}${GOOGLB.isin}`))
    })

    it('bStock OLMAYAN bir BSC tokeninde ISIN satiri YOK', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: 'tether', name: 'Tether USD', symbol: 'usdt' }) },
        })

        const { app } = setup({ tokenId: 'tether', address: NON_BSTOCK_BSC_ADDRESS })
        const captured = captureInstance(app, 'Token')
        const html = yorumsuzHtml(await render(app))

        expect(captured.instance.setupState.bStockIsin).toBeNull()
        expect(html).not.toContain(GOOGLB.isin)
        expect(html).not.toContain('>ISIN<')
    })

    // `isBStock` ve `bStockIsin` AYNI sorgunun iki yuzu (Token.vue yorumu):
    // ayni zincir/adres argumanlariyla ayni saf fonksiyona gidiyorlar. Ayrisirlarsa
    // rozet gorunup ISIN kaybolur (ya da tersi) -- ikisi de sessiz.
    it('rozet bayragi ile ISIN AYNI kayittan gelir (ayrisamaz)', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        const captured = captureInstance(app, 'Token')
        await render(app)

        const state = captured.instance.setupState
        // IKISI DE DOLU olmali: cıplak bir esitlik iddiasi (`tokenIsBStock ===
        // (bStockIsin !== null)`) IKISI DE BOZUKKEN de yesil kalirdi.
        expect(state.tokenIsBStock).toBe(true)
        expect(state.bStockIsin).toBe(GOOGLB.isin)
        expect(state.tokenIsBStock).toBe(state.bStockIsin !== null)
    })

    // HISSELER SEKMESI AKTIF AG NE OLURSA OLSUN GORULUYOR, yani hisse detayi
    // Ethereum aktifken de acilabiliyor -- bu degisikligin YENI ACTIGI yol.
    // Bakiye BSC'den okunmali: aktif agin ucuna sorulursa o adreste kontrat
    // yoktur ve kullanici sahip oldugu hisseyi SIFIR gorur.
    it('Ethereum aktifken acilan bStock ta bakiye BSC den okunur', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({
            tokenId: GOOGLB.coingecko_id,
            address: GOOGLB.address,
            aktifAg: ETH_CHAIN,
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(networkStore().currentNetwork.chainId).toBe(1)
        expect(captured.instance.setupState.tokenIsBStock).toBe(true)

        const cagri = useTokenBalanceMock.mock.calls.at(-1)
        expect(cagri).toBeDefined()
        const [, tokenAdresi, rpc, chainId] = cagri
        expect(tokenAdresi).toBe(GOOGLB.address)
        // 4. arguman OLMADAN useTokenBalance'in bStock kolu ACILMAZ ve bakiye
        // `balanceOf` ile (carpansiz) SESSIZCE EKSIK cikar.
        expect(chainId).toBe(56)
        // RPC de BSC'nin: aktif agin (Ethereum) ucu DEGIL.
        // `chain.rpc` DIZE DIZISI DEGIL, `{ url }` nesneleri tasir.
        const uclari = (chain) => chain.rpc.map((r) => (typeof r === 'string' ? r : r.url))
        expect(uclari(BSC_CHAIN)).toContain(rpc)
        expect(uclari(ETH_CHAIN)).not.toContain(rpc)
    })

    it('Takas butonu bStock ta ACIK kalir (PancakeSwap rotasi gercek)', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: GOOGLB.coingecko_id }) },
        })

        const { app } = setup({ tokenId: GOOGLB.coingecko_id, address: GOOGLB.address })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.canSwap).toBe(true)
        const swapButtonMatch = html.match(/<button[^>]*>[\s\S]*?Swap[\s\S]*?<\/button>/)
        expect(swapButtonMatch).not.toBeNull()
        expect(swapButtonMatch[0]).not.toContain('disabled')
    })
})
