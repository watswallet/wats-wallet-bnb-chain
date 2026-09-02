// SelectAssets.vue'nun VARLIK SECIMI yonlendirmesi -- bilesen GERCEKTEN render
// edilip `selectAsset` CAGRILARAK olculur (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (Task 16a, Madde 2): kapida `Number(asset.chainId) !==
// Number(network.currentNetwork?.chainId)` vardi. Iki Solana degeri de NaN'a
// donusuyor, `NaN !== NaN` HER ZAMAN dogru oldugu icin "zincir farkli" saniliyor,
// ardindan `ALL_CHAINS.find(c => Number(c.chainId) === NaN)` HICBIR kayitla
// eslesmedigi icin fonksiyon ciplak `return` ile cikiyordu: satir OLU BIR DOKUNUS.
//
// NOT (kapsam): bu ekran BUGUN Solana satirlarini LISTELEMIYOR (listeyi
// `flattenImportedTokens` besliyor ve o hala `Number(chainId)` yaziyor; ayni
// yardimci Kopru/Arama ekranlarinda da kullaniliyor ve oralarin EVM-only kalmasi
// GEREKIYOR). Yani burada olculen sey KAPININ KENDISIDIR: bir Solana kaydi bu
// fonksiyona ulastigi anda dogru davraniyor mu.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// applyNetworkChange TAKLIT EDILIR: govdesi findFastestRPC ile GERCEK HTTP
// istekleri atiyor. Burada olculen sey "HANGI zincir kaydiyla cagrildi" --
// govdenin kendisi kendi testinde (applyNetworkChange.test.js) kilitli.
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({
    applyNetworkChange: (...args) => applyNetworkChangeMock(...args),
}))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

// Solana satirlari (Home.vue ile AYNI kaynak). Gercek zincir okumasi bu dosyanin
// konusu degil; kilitlenen sey listenin ve bakiyelerin BIRLESTIRILMESI.
const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import SelectAssets from './SelectAssets.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN_ID = 'solana-mainnet'
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const POLYGON_CHAIN = supported_chains.find((c) => c.chainId === 137)

const SOL_ROW = { chainId: SOLANA_CHAIN_ID, address: 'native', symbol: 'SOL' }
const SPL_ROW = { chainId: SOLANA_CHAIN_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC' }
const SOL_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

// useSolanaAssets'in GERCEK cikti sekli (bkz. composables/useSolanaAssets.js).
const SOLANA_ASSETS = [
    { chainId: SOLANA_CHAIN_ID, address: 'native', symbol: 'SOL', name: 'Solana', decimals: 9, amount: 2.5, coingecko_id: 'solana', image: { large: '' } },
    { chainId: SOLANA_CHAIN_ID, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, amount: 12, coingecko_id: 'usd-coin', image: { large: '' } },
]

beforeEach(() => {
    applyNetworkChangeMock.mockClear()
    applyNetworkChangeMock.mockResolvedValue(true)
    useSolanaAssetsMock.mockClear()
    useSolanaAssetsMock.mockResolvedValue(SOLANA_ASSETS)
})

afterEach(() => {
    delete globalThis.chrome
})

async function mount(chainRecord, { solanaAddress = SOL_ADDRESS, importedTokens = {} } = {}) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: {
            address: '0xAbCdEf0000000000000000000000000000000001',
            key: 'acc1',
            ...(solanaAddress ? { solanaAddress } : {}),
        },
        imported_tokens: { acc1: importedTokens },
    })

    const app = createApp(SelectAssets)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    const captured = captureInstance(app, 'SelectAssets')
    const html = await render(app)

    return { captured, html, crypto: cryptoStore(), page: pageStore() }
}

describe('SelectAssets.vue (SSR) -- Solana satiri OLU DOKUNUS degil (Task 16a)', () => {
    it('Solana AKTIFKEN Solana satiri ag degistirmeden Gonder e gider', async () => {
        const { captured, crypto, page } = await mount(SOLANA_CHAIN)

        await captured.instance.setupState.selectAsset(SOL_ROW)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(crypto.sendAsset).toEqual(SOL_ROW)
        expect(page.currentPage).toBe('send')
    })

    it('EVM aktifken Solana satiri ONCE Solana kaydina gecis yapar', async () => {
        const { captured, crypto, page } = await mount(ETH_CHAIN)

        await captured.instance.setupState.selectAsset(SPL_ROW)

        expect(applyNetworkChangeMock).toHaveBeenCalledOnce()
        expect(applyNetworkChangeMock.mock.calls[0][0].chainId).toBe(SOLANA_CHAIN_ID)
        expect(crypto.sendAsset).toEqual(SPL_ROW)
        // Base58 harf kasasi kayitta OLDUGU GIBI durur.
        expect(crypto.sendAsset.address).toBe(SPL_ROW.address)
        expect(page.currentPage).toBe('send')
    })

    it('RPC ye ulasilamazsa (false) akis SURDURULMEZ', async () => {
        applyNetworkChangeMock.mockResolvedValue(false)
        const { captured, crypto, page } = await mount(ETH_CHAIN)

        await captured.instance.setupState.selectAsset(SPL_ROW)

        expect(crypto.sendAsset).toBeNull()
        expect(page.currentPage).not.toBe('send')
    })
})

describe('SelectAssets.vue (SSR) -- EVM davranisi DEGISMEDI (regresyon)', () => {
    it('baska bir EVM zincirinin satiri o zincire gecirir', async () => {
        const { captured, crypto, page } = await mount(ETH_CHAIN)
        const row = { chainId: 137, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT' }

        await captured.instance.setupState.selectAsset(row)

        expect(applyNetworkChangeMock).toHaveBeenCalledOnce()
        expect(applyNetworkChangeMock.mock.calls[0][0].chainId).toBe(POLYGON_CHAIN.chainId)
        expect(crypto.sendAsset).toEqual(row)
        expect(page.currentPage).toBe('send')
    })

    it('METIN yazimli AYNI zincir kimligi gecis TETIKLEMEZ ("1" ile 1)', async () => {
        const { captured, crypto } = await mount(ETH_CHAIN)
        const row = { chainId: '1', address: '0x0', symbol: 'ETH' }

        await captured.instance.setupState.selectAsset(row)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(crypto.sendAsset).toEqual(row)
    })

    it('COZULEMEYEN chainId hala akisi DURDURUR (eskisi gibi)', async () => {
        const { captured, crypto, page } = await mount(ETH_CHAIN)

        await captured.instance.setupState.selectAsset({ chainId: 999999, address: '0xabc' })

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(crypto.sendAsset).toBeNull()
        expect(page.currentPage).not.toBe('send')
    })
})

// KOD INCELEMESI (Bulgu 2): bu ekran cuzdanin BIRINCIL "Gonder" affordance'i ve
// Solana'da IKI SEKILDE bozuktu -- bkz. SelectAssets.vue'deki uzun not.
describe('SelectAssets.vue (SSR) -- Solana varliklari LISTELENIR (Bulgu 2)', () => {
    const SPL_KEY = 'solana-mainnet_EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const EVM_TOKEN = { 1: [{ address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', coingecko_id: 'tether' }] }

    it('kapsam Solana iken SOL ve SPL satirlari listede, bakiyeleriyle', async () => {
        const { captured } = await mount(SOLANA_CHAIN)
        const st = captured.instance.setupState

        st.scope.setFilter(SOLANA_CHAIN_ID)
        await st.applyScope()

        const ids = st.currentTokens.map((t) => `${t.chainId}_${t.address}`)
        expect(ids).toContain('solana-mainnet_native')
        expect(ids).toContain(SPL_KEY)
        expect(st.tokenBalances['solana-mainnet_native']).toBe(2.5)
        expect(st.tokenBalances[SPL_KEY]).toBe(12)
    })

    // (1) Oturum ICI EVM -> Solana gecisi: nextNetworkFilter kapsami
    // 'solana-mainnet' yapar. Eskiden Number() NaN uretip listeyi BOSALTIYORDU.
    it('METIN kapsam kimligi listeyi BOSALTMAZ', async () => {
        const { captured } = await mount(SOLANA_CHAIN)
        const st = captured.instance.setupState

        st.scope.setFilter(SOLANA_CHAIN_ID)
        await st.applyScope()

        expect(st.currentTokens.length).toBe(2)
    })

    // (2) Zaten Solana'dayken acilan TAZE popup: kapsam 'all' kalir. Eskiden liste
    // YALNIZCA EVM tokenlerini gosteriyordu ve birine dokunmak cuzdani sessizce
    // Solana'dan cikariyordu. Artik kullanicinin Solana satirlari da burada.
    it('kapsam "Tum Aglar" iken Solana satirlari EVM ile BIRLIKTE gorunur', async () => {
        const { captured } = await mount(SOLANA_CHAIN, { importedTokens: EVM_TOKEN })
        const st = captured.instance.setupState

        const chainIds = st.currentTokens.map((t) => t.chainId)
        expect(chainIds).toContain(1)
        expect(chainIds).toContain(SOLANA_CHAIN_ID)
    })

    it('SPL mint harf kasasi listede ve bakiye anahtarinda korunur', async () => {
        const { captured } = await mount(SOLANA_CHAIN)
        const st = captured.instance.setupState

        const row = st.currentTokens.find((t) => t.chainId === SOLANA_CHAIN_ID && t.address !== 'native')
        expect(row.address).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
        expect(st.tokenBalances[SPL_KEY]).toBe(12)
        expect(Object.keys(st.tokenBalances)).not.toContain(SPL_KEY.toLowerCase())
    })

    it('Solana adresi cozulemezse EVM listesi AYAKTA kalir', async () => {
        const { captured } = await mount(SOLANA_CHAIN, { solanaAddress: null, importedTokens: EVM_TOKEN })
        const st = captured.instance.setupState

        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
        expect(st.currentTokens.map((t) => t.chainId)).toContain(1)
    })

    it('useSolanaAssets FIRLATIRSA ekran cokmez, EVM listesi kalir', async () => {
        useSolanaAssetsMock.mockRejectedValue(new Error('rpc down'))
        const { captured } = await mount(SOLANA_CHAIN, { importedTokens: EVM_TOKEN })
        const st = captured.instance.setupState

        expect(st.currentTokens.map((t) => t.chainId)).toContain(1)
        expect(st.loading).toBe(false)
    })

    // EVM REGRESYONU: kapsam tek bir EVM zinciri iken Solana HIC sorulmaz
    // (gereksiz ag turu yok) ve liste yalnizca o zincirin tokenlerini tasir.
    it('kapsam tek bir EVM zinciri iken Solana satiri YOK ve Solana sorgusu ATILMAZ', async () => {
        const { captured } = await mount(ETH_CHAIN, { importedTokens: EVM_TOKEN })
        const st = captured.instance.setupState

        useSolanaAssetsMock.mockClear()
        st.scope.setFilter(1)
        await st.applyScope()

        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
        expect(st.currentTokens.map((t) => t.chainId)).toEqual([1])
    })
})

// KOD INCELEMESI (Bulgu D): zincir rozeti KILITSIZDI -- `chainLogo`i tekrar
// `Number()`e cevirmek butun paketi yesil birakiyordu.
//
// Bu rozet ONEMLI: "Tum Aglar" listesinde bir Solana satirini bir EVM satirindan
// ayiran TEK isaret o ve kullanici, dokundugunda cuzdanin agini DEGISTIRECEK bir
// satira basmadan once ona bakiyor (F2'nin "sessiz gecis" tarafi bilerek
// simetrik birakildi -- yuku tasiyan sey bu rozet).
describe('SelectAssets.vue (SSR) -- zincir rozeti Solana da COZULUR (Bulgu D)', () => {
    it('chainLogo Solana kimligini cozer, varsayilana DUSMEZ', () => {
        const solana = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
        expect(solana.logoURI).toBeTruthy()
        return mount(SOLANA_CHAIN).then(({ captured }) => {
            const chainLogo = captured.instance.setupState.chainLogo
            expect(chainLogo(SOLANA_CHAIN_ID)).toBe(solana.logoURI)
            expect(chainLogo(SOLANA_CHAIN_ID)).not.toBe('/default-chain.png')
        })
    })

    it('Solana satirinin rozeti RENDER edilen HTML de gorunur', async () => {
        const solana = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
        const { html } = await mount(SOLANA_CHAIN)

        expect(html).toContain(solana.logoURI)
    })

    // EVM REGRESYONU: sayisal kimlikler eskisi gibi cozulur (metin yazim dahil).
    it('EVM rozetleri degismedi ("137" metin yazimi dahil)', async () => {
        const { captured } = await mount(ETH_CHAIN)
        const chainLogo = captured.instance.setupState.chainLogo
        const polygon = supported_chains.find((c) => c.chainId === 137)

        expect(chainLogo(1)).toBe(supported_chains.find((c) => c.chainId === 1).logoURI)
        expect(chainLogo('137')).toBe(polygon.logoURI)
        // Desteklenmeyen zincir hala varsayilana duser.
        expect(chainLogo(999999)).toBe('/default-chain.png')
    })
})
