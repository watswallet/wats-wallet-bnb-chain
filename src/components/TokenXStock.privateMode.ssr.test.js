// Token.vue (SSR) -- hisse (xStock) tokeni: Al / Sat yuzeyi Token.vue'da YOK (StockDetail'e tasindi), gizli modda da
// (sahip karari 2026-10-16: xStocks gizli modda KAPALI; CoW emri Gizli adresi CoW'a IP ile gosterir).
// Kalip TokenXStock.ssr.test.js (xStock fiksturleri) + Token.privacy.ssr.test.js (gizli mod kurulumu) ile AYNI.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

// ensureChain'in ag degisimi (Token.vue): gercek RPC hiz testi yapmasin; mod degisimi bekleme SIRASINDA taklit edilir.
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))

vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: vi.fn(async () => 2) }))

// Carpan bilgisi bu testin konusu degil: bilinmeyen carpan fiyati tireye cevirir, dugmeler etkilenmez.
vi.mock('../utils/stockBalances', async (importOriginal) => ({
    ...(await importOriginal()),
    ensureMultipliersFor: async () => {},
    multiplierFor: () => null,
}))

// xStock adresleri NATIVE ('0x0') degil: ERC-20 decimals() dali calisir; sahte saglayici aga cikmaz.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} },
        Contract: class { async decimals() { return 18n } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { butonSayisi } from '../test-utils/ssrHtmlYardimcilari.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { popupStore } from '../store/popup'
import { privacyStore } from '../store/privacy'
import Token from './Token.vue'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SPY = XSTOCKS.find((s) => s.symbol === 'SPYx')

const tokenRecord = () => ({
    name: 'SP500', symbol: 'spyx', coingecko_id: 'sp500-xstock',
    image: { thumb: '', large: '' }, address: '0x0',
    market_data: {
        priceUSD: 781.3, market_cap: 1000, volume: 500, circulating_supply: 1000,
        ath: 800, atl: 600, change: { h24: 0.1 }, sparkline: { d7: [] },
    },
})

beforeEach(() => {
    axiosPostMock.mockResolvedValue({ status: 200, data: { token: tokenRecord() } })
})

afterEach(() => {
    axiosPostMock.mockReset()
    applyNetworkChangeMock.mockClear()
    delete globalThis.chrome
})

async function mount({ privateActive }) {
    installChromeStub({
        currentNetwork: ETH_CHAIN,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })
    const app = createApp(Token, { props: { id: 'sp500-xstock' } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ETH_CHAIN
    cryptoStore().selected_token_ref = { id: 'sp500-xstock', chainId: ETH_CHAIN.chainId, address: SPY.address }
    privacyStore().active = privateActive
    const captured = captureInstance(app, 'Token')
    const html = await render(app)
    return { html, state: captured.instance.setupState }
}

// Hisse alim-satim girisi main 2a8acd4 ile Token.vue'dan StockDetail ekranina tasindi; Token.vue artik Al/Sat dugmesi,
// selectStockTrade ve stock_trade atamasi tasimaz. Gizli modda hisse ekranlari KAPALI (Dilim 0c G5, E-R12a:
// popup/App.vue isStockPage + privateStockClosure.test.js): hisse tokeni siradan Token ekraninda acilir. Bu dosya
// Token.vue'nun her iki modda da hisse alim-satim yuzeyi tasimadigini kilitler.
describe('Token.vue (SSR) -- hisse (xStock) tokeni, gizli mod', () => {
    for (const privateActive of [false, true]) {
        const mod = privateActive ? 'gizli' : 'normal'

        it(`${mod} modda: Al / Sat girisi ve data-xstock-trade YOK; sayfa gercekten cizildi`, async () => {
            const { html, state } = await mount({ privateActive })

            // Olumlu iddia: Token sayfasi cizildi. 'Your Balance' (token.yourBalance) iki modda da kosulsuz basilir; yoksa asagidaki "yok" iddialari bos gecerdi.
            expect(html).toContain('Your Balance')
            if (privateActive) {
                // Gizli modda KLASIK Takas/Kopru yok (Token.vue swapBridgeShown = !privacy.active) ve SPYx bir SilentSwap kaynagi degil (adresi kayit
                // defterinde yok), yani ozel dugme de cikmaz: ikisi de 0.
                expect(butonSayisi(html, 'Bridge')).toBe(0)
                expect(butonSayisi(html, 'Swap')).toBe(0)
            } else {
                expect(butonSayisi(html, 'Bridge')).toBeGreaterThanOrEqual(1)
            }
            expect(butonSayisi(html, 'Buy / Sell')).toBe(0)
            expect(html).not.toContain('data-xstock-trade')
            expect(typeof state.selectStockTrade).toBe('undefined')
        })
    }

    it('gizli modda Gonder dugmesi yok (hisse tokeni siradan gizli Token ekrani gibi davranir)', async () => {
        const { html } = await mount({ privateActive: true })

        expect(butonSayisi(html, 'Send')).toBe(0)
    })

    it('Token.vue kaynagi stock_trade atamasi, selectStockTrade ve stockTrade.entry icermez (iki mod icin ortak kilit)', () => {
        const kaynak = yorumsuz(readFileSync(fileURLToPath(new URL('./Token.vue', import.meta.url)), 'utf8'))
        expect(kaynak).not.toContain('stock_trade')
        expect(kaynak).not.toContain('selectStockTrade')
        expect(kaynak).not.toContain('stockTrade.entry')
        expect(kaynak).not.toContain('data-xstock-trade')
    })
})
