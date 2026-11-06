import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { getAddress } from 'ethers'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'
import { BSTOCKS } from '../../data/bStocks'
import SERVER_LIST from '../../test-utils/serverTokenList.snapshot.json'

const CRCLB = BSTOCKS.find((t) => t.symbol === 'CRCLB').address
const SPCXB = BSTOCKS.find((t) => t.symbol === 'SPCXB').address
const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
const REMOTE = [
    { address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'PancakeSwap', decimals: 18 },
    { address: CRCLB.toLowerCase(), symbol: 'CRCLB', name: 'Circle Internet Group', decimals: 18 },
]

afterEach(() => { delete globalThis.chrome })

function mount() {
    installChromeStub({
        active_account: { key: 'g-1' },
        imported_tokens: { 'g-1': { 56: [{ address: SPCXB, symbol: 'SPCXB', name: 'SpaceX', decimals: 18 }] } },
    })
    api.post = async () => ({ data: { tokens: REMOTE } })
    const app = createApp(PrivateDeliveryTokenPicker, { props: { chainId: 56, nativeEnabled: true, selected: null, onSelect: () => {}, onClose: () => {} } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    return app
}

describe('PrivateDeliveryTokenPicker: hisse tokenleri gizli modda listelenmez', () => {
    it('sunucu listesindeki (CRCLB) ve ice aktarilan (SPCXB) hisseler yok; CAKE var', async () => {
        const html = await render(mount())
        expect(html).toContain('>CAKE<')
        expect(html).not.toContain('CRCLB')
        expect(html).not.toContain('SPCXB')
    })
})

// Katalog disi 32 hisse (30 Arbitrum xStock + Polygon BCOIN / BNIU): sunucu listesi (snapshot) her kipte secicide ve her ag icin HICBIR hisse satiri cizmez; hisse kuraliyla elenir,
// logo eksikligiyle degil: satirlar sunucu gorseliyle gelir ve paketli logo taramasindan once atilir (secici ilk adimda isStockDeliveryToken / isaret agiyla eler).
describe('PrivateDeliveryTokenPicker: katalog disi hisseler (Arbitrum xStocks, Polygon Backed) hicbir kipte listelenmez', () => {
    const STOCK_NAME = /xstock|^backed /i
    const stockRowsOf = (chainId) => SERVER_LIST.chains[String(chainId)].filter((t) => STOCK_NAME.test(t.name))
    async function htmlFor(chainId, mode) {
        installChromeStub({ active_account: { key: 'g-1' }, imported_tokens: {} })
        const remote = SERVER_LIST.chains[String(chainId)].map((t) => ({ ...t, image: { large: 'https://img.example/' + t.symbol + '.png' } }))
        api.post = async () => ({ data: { tokens: remote } })
        const app = createApp(PrivateDeliveryTokenPicker, { props: { chainId, mode, nativeEnabled: true, selected: null, onSelect: () => {}, onClose: () => {} } })
        app.use(createTestPinia())
        app.use(createTestI18n())
        return render(app)
    }

    it('snapshot bugun Arbitrum\'da 44, Polygon\'da 2 isaretli satir tasir (30 + 2 katalog disi)', () => {
        expect(stockRowsOf(42161)).toHaveLength(44)
        expect(stockRowsOf(137)).toHaveLength(2)
    })

    for (const chainId of [42161, 137]) {
        for (const mode of ['send', 'fund', 'swap', 'bridge']) {
            it(`${chainId} / ${mode}: ne hisse adi ne hisse adresi ne hisse sembolu satir olarak cizilir; USDC kalir`, async () => {
                const html = await htmlFor(chainId, mode)
                expect(html).toContain('>USDC<')
                const rows = stockRowsOf(chainId)
                expect(rows.length).toBeGreaterThan(0)
                for (const t of rows) {
                    expect(html, `${chainId}/${mode}: ${t.name}`).not.toContain(t.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;'))
                    // Sembol bilerek taranmaz: Polygon'da ayni sembollu (bcoin) hisse olmayan bir token (Bomb Crypto) var; kimlik ad + adres.
                    expect(html.toLowerCase(), `${chainId}/${mode}: ${t.address}`).not.toContain(t.address.toLowerCase().slice(2, 8))
                }
            })
        }
    }
})
