// Send.vue (SSR) -- Solana bakiye OKUMA HATASI "0 bakiye" diye gosterilmez (final cuzdan-istemci-1).
//
// KOK NEDEN: fetchSolanaAssets iki RPC hatasini (SOL getBalance, SPL getTokenAccountsByOwner) kendi
// icinde yutar ve yalniz dizinin numaralandirilamaz splFailed/solFailed ozelligini isaretler; Send
// bunu FIRLATIR sanip `find(...)?.amount || 0` yaziyordu -> balanceError false, bakiye 0: 12,5 USDC'si
// olan kullanici "yetersiz bakiye" goruyordu. Kural: okuma hatasi => "-" + kilitli form + "Balance
// unavailable"; basarili okuma (gercek 0 dahil) etkilenmez.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Gecmis (karsi taraf) ve ag cagrilari bu dosyanin konusu degil.
vi.mock('axios', () => ({ default: { post: async () => ({ status: 200, data: {} }), get: async () => ({ status: 200, data: {} }) } }))
const fetchHistoryCounterpartiesMock = vi.fn(async () => [])
vi.mock('../utils/historyRecipients', () => ({
    fetchHistoryCounterparties: (...args) => fetchHistoryCounterpartiesMock(...args),
}))
vi.mock('../utils/solana/send', () => ({
    prepareTransferContext: vi.fn(async () => ({})),
}))

// Yalniz fetchSolanaAssets mock'lanir: Send'in KULLANDIGI okuma yolu (yardimci dahil) gercek kalir.
const fetchSolanaAssetsMock = vi.fn()
vi.mock('../utils/solana/balances', () => ({
    fetchSolanaAssets: (...args) => fetchSolanaAssetsMock(...args),
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import Send from './Send.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const SOLANA_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const SOL_ROW = { mint: 'native', amount: 10, decimals: 9 }
const USDC_ROW = { mint: USDC, amount: 12.5, decimals: 6 }

/** fetchSolanaAssets'in gercek cikti sekli: satir dizisi + numaralandirilamaz hata bayraklari. */
function assetsWith(rows, { splFailed = false, solFailed = false } = {}) {
    const out = [...rows]
    Object.defineProperty(out, 'splFailed', { value: splFailed, enumerable: false })
    Object.defineProperty(out, 'solFailed', { value: solFailed, enumerable: false })
    return out
}

afterEach(() => {
    delete globalThis.chrome
    fetchSolanaAssetsMock.mockReset()
    fetchHistoryCounterpartiesMock.mockClear()
})

async function mountSend({ asset, assets }) {
    installChromeStub({
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: SOLANA_ADDRESS, key: 'acc1' },
        vaults: [],
        saved_addresses: [],
    })
    fetchSolanaAssetsMock.mockResolvedValue(assets)

    const pinia = createTestPinia()
    networkStore().currentNetwork = SOLANA
    cryptoStore().sendAsset = asset

    const app = createApp(Send, { use: [pinia, createTestI18n('en')] })
    const holder = captureInstance(app, 'Send')
    const html = await render(app)
    return { html, state: holder.instance.setupState }
}

const SPL_ASSET = { address: USDC, symbol: 'USDC', decimals: 6, name: 'USD Coin' }
const SOL_ASSET = { address: 'native', symbol: 'SOL', decimals: 9, name: 'Solana' }

describe('Send.vue (SSR) -- Solana bakiye okuma hatasi', () => {
    it('SPL okumasi dustu (splFailed, hedef mint satiri yok): balanceError true, form kilitli, "Balance unavailable"', async () => {
        const { state, html } = await mountSend({
            asset: SPL_ASSET,
            assets: assetsWith([SOL_ROW], { splFailed: true }),
        })

        expect(state.balanceError).toBe(true)
        expect(state.isFormValid).toBeFalsy()
        expect(html).toContain('Balance unavailable')
    })

    it('SOL okumasi dustu (solFailed, hedef native): balanceError true, form kilitli', async () => {
        const { state } = await mountSend({
            asset: SOL_ASSET,
            assets: assetsWith([USDC_ROW], { solFailed: true }),
        })

        expect(state.balanceError).toBe(true)
        expect(state.isFormValid).toBeFalsy()
    })

    it('KONTROL: okuma basarili -> bakiye gercek deger, balanceError false', async () => {
        const { state, html } = await mountSend({
            asset: SPL_ASSET,
            assets: assetsWith([SOL_ROW, USDC_ROW]),
        })

        expect(state.balanceError).toBe(false)
        expect(state.balance).toBe(12.5)
        expect(html).not.toContain('Balance unavailable')
    })

    it('KONTROL: okuma basarili ama hedef satir yok (gercek 0 bakiye) -> balanceError false, bakiye 0', async () => {
        const { state } = await mountSend({
            asset: SPL_ASSET,
            assets: assetsWith([SOL_ROW]),
        })

        expect(state.balanceError).toBe(false)
        expect(state.balance).toBe(0)
    })

    it('KONTROL: hedefle ilgisiz okuma hatasi (SPL hedef, yalniz solFailed) bakiyeyi bozmaz', async () => {
        const { state } = await mountSend({
            asset: SPL_ASSET,
            assets: assetsWith([USDC_ROW], { solFailed: true }),
        })

        expect(state.balanceError).toBe(false)
        expect(state.balance).toBe(12.5)
    })
})
