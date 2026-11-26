// Gorev 18 (O3, O4): katalog / arama / ice aktarma ekranlari ORTAK KIMLIK katmanina bagli.
//
// Dort ekran ayni iki sorunu yasiyordu:
//   O4 -- Solana katalogu ADRESLENEMIYORDU: sunucu Solana'yi -101 ile tanir, istemci 'solana-mainnet' ile.
//         `scopeChainIds` Solana'yi `Number('solana-mainnet')` = NaN diye eliyor, "Tum Aglar" listesi hic
//         Solana sormuyor, Solana kapsami ise "istek atmaya deger kapsam yok" sayiliyordu.
//   O3 -- ice aktarilan SPL "Tum Aglar"da chainId NaN HAYALET satir uretiyordu: depo kovasi
//         `imported_tokens[hesap]['solana-mainnet']` `Number()` ile okunuyordu; ayrica SearchTokens
//         Solana satirini yazarken 'NaN' kovasi acar, base58 mint'i kucultup karsilastirirdi.
//
// Kosul: ayni cozum TEK yerden gelir (utils/serverChainId.js + utils/tokenScope.js, Gorev 17).
// Bilesenler bu testte GERCEKTEN render edilir (src/test-utils/ssrRender.js); ag (axios), bakiye ve Solana
// okumasi taklit edilir, uretim API'sine istek ATILMAZ.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// SOLANA_ENABLED bilesenlerde ISLEM ANINDA okunur; bayrak-kapali vakalari bu sahte ile uretilir (varsayilan: ACIK,
// vitest.config.js test.env ile ayni). Zincir listesi (supportedChains.js) modul yuklenirken ACIK degerle kurulur.
const flags = vi.hoisted(() => ({ solana: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, get SOLANA_ENABLED() { return flags.solana } }
})

const axiosPost = vi.fn()
const axiosGet = vi.fn()
vi.mock('axios', () => ({ default: { post: (...a) => axiosPost(...a), get: (...a) => axiosGet(...a) } }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...a) => useTokenBalanceMock(...a) }))

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...a) => useSolanaAssetsMock(...a) }))

// applyNetworkChange gercek HTTP istekleri atar; burada olculen sey o degil.
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: vi.fn(async () => true) }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { chainsForFlow, LISTED_CHAINS } from '../data/chains'
import { tokenScopeStore } from '../store/tokenScope'
import { ALL_NETWORKS } from '../utils/networkFilter'
import SearchTokens from './SearchTokens.vue'
import SelectAssets from './SelectAssets.vue'
import SwapFrom from './swap/swapFrom.vue'
import BridgeFrom from './bridge/bridgeFrom.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA = 'solana-mainnet'
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === SOLANA)

// Karisik harf kasali GERCEK base58 mint'ler: kucultulurse baska (var olmayan) bir mint olur.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const SOL_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const ACCOUNT = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', solanaAddress: SOL_ADDRESS }

// Uzak logo kaynagi olmayan satir secici listelerinden gizlenir (hideLogoless); testler gizlenmesin.
const IMG = { thumb: 'https://img.test/t.png', small: 'https://img.test/s.png', large: 'https://img.test/l.png' }

// SUNUCUNUN satir bicimi: Solana -101, EVM pozitif, TON -239; adres kucuk harf / '0x0' native.
const SRV_SOL_NATIVE = { address: '0x0', chainId: -101, chain: 'solana', symbol: 'SOL', name: 'Solana', decimals: 9, native: true, coingecko_id: 'solana', image: IMG }
const SRV_USDC = { address: USDC_MINT, chainId: -101, chain: 'solana', symbol: 'USDC', name: 'USD Coin', decimals: 6, coingecko_id: 'usd-coin', image: IMG }
const SRV_BONK = { address: BONK_MINT, chainId: -101, chain: 'solana', symbol: 'BONK', name: 'Bonk', decimals: 5, coingecko_id: 'bonk', image: IMG }
const SRV_BNB = { address: '0x0', chainId: 56, chain: 'binance-smart-chain', symbol: 'BNB', name: 'BNB', decimals: 18, native: true, coingecko_id: 'binancecoin', image: IMG }
const SRV_USDT_BSC = { address: '0x55d398326f99059ff775485246999027b3197955', chainId: 56, chain: 'binance-smart-chain', symbol: 'USDT', name: 'Tether USD', decimals: 18, coingecko_id: 'tether', image: IMG }
const SRV_TON = { address: '0x0', chainId: -239, chain: 'the-open-network', symbol: 'GRAM', name: 'GRAM', decimals: 9, native: true, coingecko_id: 'the-open-network', image: IMG }
// Pozitif 101 GERCEK bir EVM zinciridir; Solana'ya DONUSMEMELI.
const SRV_EVM_101 = { address: '0x1111111111111111111111111111111111111101', chainId: 101, chain: 'etherinc', symbol: 'E101', name: 'Evm 101', decimals: 18, image: IMG }

// DEPODAKI (ice aktarilmis) satirlar: kova anahtari zinciri belirler, satirda chainId alani YOKTUR.
const STORED_USDC = { name: 'USD Coin', symbol: 'USDC', decimals: 6, address: USDC_MINT, image: IMG, coingecko_id: 'usd-coin' }
const STORED_BONK = { name: 'Bonk', symbol: 'BONK', decimals: 5, address: BONK_MINT, image: IMG, coingecko_id: 'bonk' }
const STORED_BNB = { name: 'BNB', symbol: 'BNB', decimals: 18, address: '0x0', image: IMG, coingecko_id: 'binancecoin' }
const STORED_TON_JETTON = { name: 'Tether USD', symbol: 'USDT', decimals: 6, address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', image: IMG, coingecko_id: 'tether' }

// useSolanaAssets'in GERCEK cikti sekli: canli bakiye (amount) tasir.
const LIVE_USDC = { chainId: SOLANA, address: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6, amount: 12, coingecko_id: 'usd-coin', image: IMG }

let stub

beforeEach(() => {
    flags.solana = true
    axiosPost.mockReset()
    axiosGet.mockReset()
    useTokenBalanceMock.mockClear()
    useSolanaAssetsMock.mockReset()
    useSolanaAssetsMock.mockResolvedValue([])
})

afterEach(() => {
    delete globalThis.chrome
})

function routeAxios(catalog = []) {
    axiosPost.mockImplementation(async (url) => {
        if (url.endsWith('/getChainTokens')) return { status: 200, data: { success: true, tokens: catalog } }
        if (url.endsWith('/getTokensDataById')) return { status: 200, data: { success: true, tokens: [] } }
        throw new Error('beklenmeyen url ' + url)
    })
    // bridgeFrom'un LI.FI listesi: bos.
    axiosGet.mockImplementation(async () => ({ status: 200, data: { tokens: {} } }))
}

// Sunucuya giden /getChainTokens govdeleri, sirayla.
const catalogBodies = () => axiosPost.mock.calls.filter(([url]) => url.endsWith('/getChainTokens')).map(([, body]) => body)

const rowKey = (t) => `${t.chainId}_${t.address}`

// ---------------------------------------------------------------------------------------------
// SearchTokens
// ---------------------------------------------------------------------------------------------

async function mountSearch({ filter, imported = {}, catalog = [] }) {
    stub = installChromeStub({ currentNetwork: ETH_CHAIN, active_account: ACCOUNT, imported_tokens: { acc1: imported } })
    routeAxios(catalog)

    const app = createApp(SearchTokens)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = ETH_CHAIN
    tokenScopeStore().setFilter(filter)

    const holder = captureInstance(app, 'SearchTokens')
    const html = await render(app)
    return { html, st: holder.instance.setupState }
}

// "Ekle" cipleri (sutun: shrink-0 px-3 py-1.5, metin "Add").
const ekleCipleri = (html) => [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)]
    .filter((m) => ['shrink-0', 'px-3', 'py-1.5'].every((s) => m[1].split(/\s+/).includes(s)) && /\bAdd\b/.test(m[2]))

describe('SearchTokens -- Solana katalogu adreslenir (O4)', () => {
    it('Solana kapsaminda -101 istenir, satirlar solana-mainnet damgali, sunucunun 0x0 SOL satiri atilir', async () => {
        const { st } = await mountSearch({ filter: SOLANA, catalog: [SRV_SOL_NATIVE, SRV_USDC, SRV_BONK] })

        const bodies = catalogBodies()
        expect(bodies).toHaveLength(1)
        expect(bodies[0].chainIds).toEqual([-101])
        expect(bodies[0].chainId).toBe(-101)
        expect(bodies[0].chain).toBe('solana')

        expect(st.generalTokens.map(rowKey)).toEqual([`${SOLANA}_${USDC_MINT}`, `${SOLANA}_${BONK_MINT}`])
        // Base58 harf kasasi OLDUGU GIBI.
        expect(st.generalTokens[0].address).toBe(USDC_MINT)
    })

    it('"Tum Aglar": istek -101 ve -239 i de kapsar, hicbir kimlik metin/NaN degil, her satir kendi kimligiyle', async () => {
        const catalog = [SRV_BNB, SRV_USDT_BSC, SRV_USDC, SRV_TON, SRV_EVM_101]
        const { st } = await mountSearch({ filter: ALL_NETWORKS, catalog })

        const [body] = catalogBodies()
        expect(body.chainIds).toContain(-101)
        expect(body.chainIds).toContain(-239)
        expect(body.chainIds).toContain(56)
        expect(body.chainIds.every((id) => typeof id === 'number' && Number.isFinite(id))).toBe(true)
        // Coklu kapsamda tek zincir alanlari YOK.
        expect(body.chainId).toBeUndefined()

        const byAddr = Object.fromEntries(st.generalTokens.map((t) => [`${t.address}|${String(t.chainId)}`, t.chainId]))
        expect(byAddr[`${USDC_MINT}|${SOLANA}`]).toBe(SOLANA)
        expect(byAddr['0x0|56']).toBe(56)
        // TON davranisi AYNEN: sayisal -239.
        expect(byAddr['0x0|-239']).toBe(-239)
        // Pozitif 101 bir EVM kimligidir: Solana'ya CEVRILMEZ.
        expect(byAddr['0x1111111111111111111111111111111111111101|101']).toBe(101)
    })

    it('tek EVM kapsami eskisi gibi: chainIds [56], slug ve chainId alanlari', async () => {
        const { st } = await mountSearch({ filter: 56, catalog: [SRV_BNB, SRV_USDT_BSC] })

        const [body] = catalogBodies()
        expect(body.chainIds).toEqual([56])
        expect(body.chain).toBe(BSC_CHAIN.chainSlug)
        expect(body.chainId).toBe(56)
        expect(st.generalTokens.map((t) => t.chainId)).toEqual([56, 56])
    })

    // Sunucu `skip`i "su ana kadar aldigin ham satir sayisi" diye okur (server tokenController: prepend/dbSkip).
    // 0x0 SOL satiri damgalamada ATILDIGI icin elenmis sayiyi saymak ikinci sayfanin ilk satirini tekrar getirir ve
    // dolu bir sayfayi (25) `>= limit` sinavindan dusurup kaydirmayi Solana kapsaminda ilk sayfada keserdi.
    it('SAYFALAMA ham satir sayisiyla ilerler: dolu sayfadan 0x0 SOL elense de kaydirma DEVAM eder, sonraki istek skip=25', async () => {
        const mint = (i) => `Mint${String(i).padStart(40, '0')}`
        const page = [SRV_SOL_NATIVE, ...Array.from({ length: 24 }, (_, i) => ({ ...SRV_USDC, address: mint(i), symbol: `T${i}` }))]
        const { st } = await mountSearch({ filter: SOLANA, catalog: page })

        expect(st.generalTokens).toHaveLength(24)
        expect(st.skip).toBe(25)
        expect(st.hasMoreTokens).toBe(true)

        await st.getChainTokens(true)
        const bodies = catalogBodies()
        expect(bodies).toHaveLength(2)
        expect(bodies[1].skip).toBe(25)
    })

    it('kisa sayfa (limit altinda) kaydirmayi bitirir', async () => {
        const { st } = await mountSearch({ filter: SOLANA, catalog: [SRV_SOL_NATIVE, SRV_USDC, SRV_BONK] })

        expect(st.skip).toBe(3)
        expect(st.hasMoreTokens).toBe(false)
    })
})

describe('SearchTokens -- ice aktarilanlar hayalet satir uretmez (O3)', () => {
    it('"Tum Aglar": Solana kovasi solana-mainnet kimligiyle listelenir, NaN satir YOK', async () => {
        const { st } = await mountSearch({
            filter: ALL_NETWORKS,
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
        })

        const list = st.importedTokensList
        expect(list.map(rowKey).sort()).toEqual([`${SOLANA}_${USDC_MINT}`, '56_0x0'].sort())
        expect(list.some((t) => Number.isNaN(t.chainId))).toBe(false)
    })

    it('Solana kapsami: yalniz Solana kovasi', async () => {
        const { st } = await mountSearch({
            filter: SOLANA,
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
        })

        expect(st.importedTokensList.map(rowKey)).toEqual([`${SOLANA}_${USDC_MINT}`])
    })

    it('ayni mint hem ekli hem katalogda: POPULER listede TEKRAR gorunmez; kucuk harfli kopya baska mint sayilir', async () => {
        const lowerUsdc = { ...SRV_USDC, address: USDC_MINT.toLowerCase() }
        const { st } = await mountSearch({
            filter: SOLANA,
            imported: { [SOLANA]: [STORED_USDC] },
            catalog: [SRV_USDC, SRV_BONK, lowerUsdc],
        })

        // Ekli USDC elenir; BONK ve kucuk harfli (baska) mint kalir.
        expect(st.filteredGeneralTokens.map((t) => t.address)).toEqual([BONK_MINT, USDC_MINT.toLowerCase()])
    })

    it('depoda NaN / bos kova anahtari hayalet satir uretmez', async () => {
        const { st } = await mountSearch({
            filter: ALL_NETWORKS,
            imported: { NaN: [STORED_BNB], '': [STORED_BNB], [SOLANA]: [STORED_BONK] },
        })

        const list = st.importedTokensList
        expect(list.every((t) => t.chainId === SOLANA || Number.isFinite(t.chainId))).toBe(true)
        expect(list.some((t) => t.address === BONK_MINT && t.chainId === SOLANA)).toBe(true)
    })

    it('Solana ozellik bayragi KAPALI: eski Solana kovasi "Tum Aglar" listesinde GORUNMEZ, EVM kovasi durur', async () => {
        flags.solana = false
        const { st } = await mountSearch({
            filter: ALL_NETWORKS,
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
        })

        expect(st.importedTokensList.map(rowKey)).toEqual(['56_0x0'])
    })
})

describe('SearchTokens -- importToken / removeToken kova ve esitlik (O3)', () => {
    const solRow = (over = {}) => ({ ...SRV_USDC, chainId: SOLANA, _id: 'srv-1', ...over })
    const bucketsOf = () => stub.localStore.imported_tokens.acc1

    it('Solana satiri imported_tokens[hesap][solana-mainnet] kovasina yazilir; NaN / -101 kovasi YOK; govde tam bu alanlar', async () => {
        const { st } = await mountSearch({ filter: SOLANA, catalog: [SRV_USDC] })

        await st.importToken(solRow())

        const buckets = bucketsOf()
        expect(Object.keys(buckets)).toEqual([SOLANA])
        expect(buckets[SOLANA]).toEqual([{
            name: 'USD Coin', symbol: 'USDC', decimals: 6, address: USDC_MINT, image: IMG, coingecko_id: 'usd-coin',
        }])
    })

    it('ayni mint ikinci kez eklenmez; KUCUK HARFLI mint ayri token olarak eklenir (base58 duyarli)', async () => {
        const { st } = await mountSearch({ filter: SOLANA, catalog: [SRV_USDC] })

        await st.importToken(solRow())
        await st.importToken(solRow())
        expect(bucketsOf()[SOLANA]).toHaveLength(1)

        await st.importToken(solRow({ address: USDC_MINT.toLowerCase() }))
        expect(bucketsOf()[SOLANA].map((t) => t.address)).toEqual([USDC_MINT, USDC_MINT.toLowerCase()])
    })

    it('GECERSIZ decimals (31, -1, 6.5, "6", null, undefined, NaN) YAZILMAZ ve canImport false', async () => {
        const { st } = await mountSearch({ filter: SOLANA, catalog: [SRV_USDC] })

        for (const bad of [31, -1, 6.5, '6', null, undefined, Number.NaN]) {
            await st.importToken(solRow({ decimals: bad }))
            expect(st.canImport(solRow({ decimals: bad }))).toBe(false)
        }
        expect(stub.localStore.imported_tokens.acc1).toEqual({})

        // Sinirlar GECERLI: 0 ve 30.
        for (const ok of [0, 30]) expect(st.canImport(solRow({ decimals: ok }))).toBe(true)
    })

    it('RENDER: gecersiz decimals li Solana satirinda "Ekle" GIZLI; gecerli satirda gorunur', async () => {
        const gecerli = await mountSearch({ filter: SOLANA, catalog: [SRV_USDC] })
        expect(ekleCipleri(gecerli.html)).toHaveLength(1)

        const gecersiz = await mountSearch({ filter: SOLANA, catalog: [{ ...SRV_USDC, decimals: 99 }] })
        expect(gecersiz.html).toContain('USD Coin')
        expect(ekleCipleri(gecersiz.html)).toHaveLength(0)
    })

    it('EVM satiri DEGISMEZ: kova sayisal kimlik, govde sunucu satiri + importedAt, decimals alani zorunlu DEGIL', async () => {
        const { st } = await mountSearch({ filter: 56, catalog: [SRV_BNB] })

        // decimals'siz EVM satiri (mevcut gizli-mod testindeki USDT gibi) hala eklenebilir.
        const row = { address: '0x55d398326f99059fF775485246999027B3197955', chainId: 56, name: 'Tether', symbol: 'usdt' }
        expect(st.canImport(row)).toBe(true)

        await st.importToken(row)
        const stored = bucketsOf()[56]
        expect(stored).toHaveLength(1)
        expect(stored[0]).toMatchObject(row)
        expect(typeof stored[0].importedAt).toBe('string')
        expect(Object.keys(bucketsOf())).toEqual(['56'])
    })

    it('TON satiri (-239) DEGISMEZ: sayisal kova, govde sunucu satiri + importedAt, ayni adres ikinci kez eklenmez', async () => {
        const { st } = await mountSearch({ filter: ALL_NETWORKS, catalog: [SRV_TON] })
        const row = { ...SRV_TON, address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', native: undefined }

        await st.importToken(row)
        await st.importToken(row)

        expect(Object.keys(bucketsOf())).toEqual(['-239'])
        expect(bucketsOf()['-239']).toHaveLength(1)
        expect(bucketsOf()['-239'][0]).toMatchObject({ symbol: 'GRAM', address: row.address, chainId: -239 })
        expect(typeof bucketsOf()['-239'][0].importedAt).toBe('string')
    })

    it('kimligi eksik/cozulemeyen satir HIC kova acmaz (null, undefined, "", "NaN", NaN): "0" kovasi dahil', async () => {
        const { st } = await mountSearch({ filter: SOLANA, catalog: [SRV_USDC] })

        for (const bad of [null, undefined, '', 'NaN', Number.NaN]) {
            await st.importToken(solRow({ chainId: bad }))
            await st.removeToken(solRow({ chainId: bad }))
        }
        expect(bucketsOf()).toEqual({})
    })

    it('removeToken Solana satirini solana-mainnet kovasindan, base58 duyarli siler', async () => {
        const { st } = await mountSearch({
            filter: SOLANA,
            imported: { [SOLANA]: [STORED_USDC, { ...STORED_USDC, address: USDC_MINT.toLowerCase() }] },
        })

        await st.removeToken({ ...STORED_USDC, chainId: SOLANA })

        expect(bucketsOf()[SOLANA].map((t) => t.address)).toEqual([USDC_MINT.toLowerCase()])
        expect(Object.keys(bucketsOf())).toEqual([SOLANA])
    })
})

// ---------------------------------------------------------------------------------------------
// SelectAssets
// ---------------------------------------------------------------------------------------------

async function mountSelect({ filter = ALL_NETWORKS, imported = {}, live = [], catalog = [], account = ACCOUNT, sendMessage = null, network = SOLANA_CHAIN } = {}) {
    stub = installChromeStub({ currentNetwork: network, active_account: account, imported_tokens: { acc1: imported } })
    if (sendMessage) stub.setSendMessage(sendMessage)
    routeAxios(catalog)
    useSolanaAssetsMock.mockResolvedValue(live)

    const app = createApp(SelectAssets)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    networkStore().currentNetwork = network
    tokenScopeStore().setFilter(filter)

    const holder = captureInstance(app, 'SelectAssets')
    const html = await render(app)
    return { html, st: holder.instance.setupState }
}

describe('SelectAssets -- liste ve arama ortak kimlik katmaninda (O3, O4)', () => {
    it('"Tum Aglar": ice aktarilan SPL hayalet satir uretmez ve CANLI satirla TEK satir olur (canli kazanir)', async () => {
        const { st } = await mountSelect({
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC, STORED_BONK] },
            live: [LIVE_USDC],
        })

        const keys = st.currentTokens.map(rowKey)
        expect(keys.filter((k) => k === `${SOLANA}_${USDC_MINT}`)).toHaveLength(1)
        expect(keys).toContain(`${SOLANA}_${BONK_MINT}`)
        expect(keys).toContain('56_0x0')
        expect(st.currentTokens.some((t) => Number.isNaN(t.chainId))).toBe(false)

        const usdc = st.currentTokens.find((t) => t.address === USDC_MINT)
        expect(usdc.amount).toBe(12)
        expect(st.tokenBalances[`${SOLANA}_${USDC_MINT}`]).toBe(12)
    })

    it('Solana kapsami: elde tutulmayan ice aktarilan SPL de listelenir, bakiyesine EVM RPC si ile 0 YAZILMAZ', async () => {
        const { st } = await mountSelect({
            filter: SOLANA,
            imported: { [SOLANA]: [STORED_BONK] },
            live: [],
        })

        expect(st.currentTokens.map(rowKey)).toEqual([`${SOLANA}_${BONK_MINT}`])
        expect(st.tokenBalances[`${SOLANA}_${BONK_MINT}`]).toBeUndefined()
        expect(useTokenBalanceMock).not.toHaveBeenCalled()
    })

    it('tek EVM kapsami: Solana kovasi listeye GIRMEZ, Solana sorgusu atilmaz', async () => {
        const { st } = await mountSelect({
            filter: 56,
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
            live: [LIVE_USDC],
        })

        expect(st.currentTokens.map(rowKey)).toEqual(['56_0x0'])
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
    })

    it('Solana ozellik bayragi KAPALI: ice aktarilan Solana kovasi "Tum Aglar" listesine GIRMEZ, EVM kovasi durur', async () => {
        flags.solana = false
        const { st } = await mountSelect({
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_BONK] },
            live: [],
        })

        expect(st.currentTokens.map(rowKey)).toEqual(['56_0x0'])
    })

    it('Solana ozellik bayragi KAPALI: Solana yoklamasi HIC calismaz (useSolanaAssets ve SOLANA_GET_ADDRESS cagrilmaz), canli satir listeye girmez (V18-1)', async () => {
        flags.solana = false
        for (const filter of [ALL_NETWORKS, SOLANA]) {
            useSolanaAssetsMock.mockClear()
            const sendSpy = vi.fn(async () => ({ result: { address: SOL_ADDRESS } }))
            const { st } = await mountSelect({
                filter,
                imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
                live: [LIVE_USDC],
                // hesapta hazir adres YOK: bayrak acik olsaydi SOLANA_GET_ADDRESS sorulurdu
                account: { ...ACCOUNT, solanaAddress: undefined },
                sendMessage: sendSpy,
            })

            expect(useSolanaAssetsMock).not.toHaveBeenCalled()
            expect(sendSpy).not.toHaveBeenCalled()
            expect(st.currentTokens.some((t) => t.address === USDC_MINT)).toBe(false)
            expect(st.tokenBalances[`${SOLANA}_${USDC_MINT}`]).toBeUndefined()
        }
    })

    // Birlesme hazirligi B5 -- MAGAZA SIZINTISI vakasi birebir: bayrak KAPALI + hesapta solanaAddress DOLU (TON ifadesiyle
    // ice aktarilmis hesap) + aktif ag EVM + kapsam 'Tum Aglar'. Eski kodda hazir adres SOLANA_GET_ADDRESS'e gerek kalmadan
    // dogrudan useSolanaAssets'e gidiyordu; yukaridaki V18-1 testi yalniz adres BOS vakasini olcuyordu.
    it("SIZINTI: bayrak KAPALI + solanaAddress DOLU + EVM aktif + 'Tum Aglar': Solana kaynagi/adres sorgusu/istek YOK, Solana satiri listede YOK", async () => {
        flags.solana = false
        const fetchSpy = vi.fn(async () => ({ ok: false, status: 599, json: async () => ({}) }))
        vi.stubGlobal('fetch', fetchSpy)
        try {
            const sendSpy = vi.fn(async () => ({ result: { address: SOL_ADDRESS } }))
            const { st } = await mountSelect({
                filter: ALL_NETWORKS,
                network: BSC_CHAIN,
                imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
                live: [LIVE_USDC],
                account: ACCOUNT,
                sendMessage: sendSpy,
            })

            expect(ACCOUNT.solanaAddress).toBe(SOL_ADDRESS)
            expect(useSolanaAssetsMock).not.toHaveBeenCalled()
            expect(sendSpy).not.toHaveBeenCalledWith({ type: 'SOLANA_GET_ADDRESS' })
            expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes('/solana/'))).toEqual([])
            expect(st.solanaInScope).toBe(false)
            expect(st.currentTokens.filter((t) => String(t.chainId) === SOLANA)).toEqual([])
            expect(st.tokenBalances[`${SOLANA}_${USDC_MINT}`]).toBeUndefined()
            expect(st.currentTokens.map(rowKey)).toEqual(['56_0x0'])
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it("KONTROL: bayrak ACIK + ayni kurulum (solanaAddress DOLU, EVM aktif, 'Tum Aglar'): useSolanaAssets hazir adresle cagrilir ve Solana satiri listeye girer", async () => {
        const sendSpy = vi.fn(async () => ({ result: { address: SOL_ADDRESS } }))
        const { st } = await mountSelect({
            filter: ALL_NETWORKS,
            network: BSC_CHAIN,
            imported: { 56: [STORED_BNB], [SOLANA]: [STORED_USDC] },
            live: [LIVE_USDC],
            account: ACCOUNT,
            sendMessage: sendSpy,
        })

        expect(useSolanaAssetsMock).toHaveBeenCalledWith(SOL_ADDRESS)
        expect(sendSpy).not.toHaveBeenCalledWith({ type: 'SOLANA_GET_ADDRESS' })
        expect(st.currentTokens.map(rowKey)).toContain(`${SOLANA}_${USDC_MINT}`)
    })

    it('Solana ozellik bayragi ACIK + hesapta hazir adres yok: SOLANA_GET_ADDRESS sorulur (bayrak kapisinin dogru yonde calistigi kilidi)', async () => {
        const sendSpy = vi.fn(async () => ({ result: { address: SOL_ADDRESS } }))
        await mountSelect({
            imported: {},
            live: [LIVE_USDC],
            account: { ...ACCOUNT, solanaAddress: undefined },
            sendMessage: sendSpy,
        })

        expect(sendSpy).toHaveBeenCalledWith({ type: 'SOLANA_GET_ADDRESS' })
        expect(useSolanaAssetsMock).toHaveBeenCalledWith(SOL_ADDRESS)
    })

    it('Solana kapsaminda katalog aramasi -101 ister, satirlari solana-mainnet damgalar, 0x0 SOL i atar, bakiyeye 0 yazmaz', async () => {
        const { st } = await mountSelect({ filter: SOLANA, catalog: [SRV_SOL_NATIVE, SRV_USDC, SRV_BONK] })
        axiosPost.mockClear()
        useTokenBalanceMock.mockClear()

        st.searchTerm = 'usd'
        await st.searchCatalog('usd')

        const [body] = catalogBodies()
        expect(body.chainIds).toEqual([-101])
        expect(body.chainId).toBe(-101)
        expect(body.chain).toBe('solana')
        expect(body.search).toBe('usd')

        expect(st.searchResults.map(rowKey)).toEqual([`${SOLANA}_${USDC_MINT}`, `${SOLANA}_${BONK_MINT}`])
        // Solana satirlari EVM RPC'sinden okunmaz: ne cagri var ne de 0 yazildi.
        expect(useTokenBalanceMock).not.toHaveBeenCalled()
        expect(st.tokenBalances[`${SOLANA}_${USDC_MINT}`]).toBeUndefined()
    })

    it('"Tum Aglar" aramasi: -101 ve -239 kapsanir; karisik sonuc kendi kimlikleriyle (pozitif 101 EVM kalir)', async () => {
        const { st } = await mountSelect({ filter: ALL_NETWORKS, catalog: [SRV_BNB, SRV_USDC, SRV_TON, SRV_EVM_101] })
        axiosPost.mockClear()

        st.searchTerm = 'a'
        await st.searchCatalog('a')

        const [body] = catalogBodies()
        expect(body.chainIds).toContain(-101)
        expect(body.chainIds).toContain(-239)
        expect(body.chainIds.every((id) => typeof id === 'number' && Number.isFinite(id))).toBe(true)
        expect(body.chainId).toBeUndefined()

        const ids = st.searchResults.map((t) => t.chainId)
        expect(ids).toEqual([56, SOLANA, -239, 101])
        // EVM satirlarinin bakiyesi EVM yolundan okunur (3 EVM/TON satiri; Solana satiri degil).
        expect(useTokenBalanceMock.mock.calls.every(([, address]) => address !== USDC_MINT)).toBe(true)
    })

    it('tek EVM aramasi eskisi gibi: chainIds [56] + chain/chainId', async () => {
        const { st } = await mountSelect({ filter: 56, catalog: [SRV_BNB] })
        axiosPost.mockClear()

        st.searchTerm = 'bnb'
        await st.searchCatalog('bnb')

        const [body] = catalogBodies()
        expect(body.chainIds).toEqual([56])
        expect(body.chain).toBe(BSC_CHAIN.chainSlug)
        expect(body.chainId).toBe(56)
        expect(st.searchResults.map((t) => t.chainId)).toEqual([56])
    })
})

// ---------------------------------------------------------------------------------------------
// Swap / Bridge kaynak listeleri
// ---------------------------------------------------------------------------------------------

async function mountSwapFrom(imported) {
    stub = installChromeStub({ currentNetwork: BSC_CHAIN, active_account: ACCOUNT, imported_tokens: { acc1: imported } })
    routeAxios([])

    const app = createApp(SwapFrom)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    const network = networkStore()
    network.currentNetwork = BSC_CHAIN
    network.rpc = BSC_CHAIN.rpc[0].url
    tokenScopeStore().setFilter(ALL_NETWORKS)

    const holder = captureInstance(app, 'swapFrom')
    await render(app)
    return holder.instance.setupState
}

async function mountBridgeFrom(imported) {
    stub = installChromeStub({ currentNetwork: BSC_CHAIN, active_account: ACCOUNT, imported_tokens: { acc1: imported } })
    routeAxios([])

    const app = createApp(BridgeFrom)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    const network = networkStore()
    network.currentNetwork = BSC_CHAIN
    network.rpc = BSC_CHAIN.rpc[0].url
    tokenScopeStore().setFilter(ALL_NETWORKS)

    const holder = captureInstance(app, 'bridgeFrom')
    await render(app)
    return holder.instance.setupState
}

describe('Swap / Bridge kaynak listeleri Solana kovasini ELER (Q3: TON aynen)', () => {
    const IMPORTED = { 56: [STORED_BNB], [SOLANA]: [STORED_USDC], '-239': [STORED_TON_JETTON] }

    it('swapFrom "Tum Aglar": ice aktarilan Solana satiri YOK, BSC ve TON satirlari duruyor', async () => {
        const st = await mountSwapFrom(IMPORTED)

        const keys = st.importedTokens.map(rowKey)
        expect(keys).toContain('56_0x0')
        expect(keys).toContain(`-239_${STORED_TON_JETTON.address}`)
        expect(keys.some((k) => k.startsWith(SOLANA))).toBe(false)
        expect(keys.some((k) => k.startsWith('NaN'))).toBe(false)
    })

    it('bridgeFrom "Tum Aglar": ice aktarilan Solana satiri YOK (ne imported ne birlesik listede), BSC ve TON satirlari duruyor', async () => {
        const st = await mountBridgeFrom(IMPORTED)

        for (const list of [st.importedTokens, st.mergedTokens]) {
            const keys = list.map(rowKey)
            expect(keys).toContain('56_0x0')
            expect(keys).toContain(`-239_${STORED_TON_JETTON.address}`)
            expect(keys.some((k) => k.startsWith(SOLANA))).toBe(false)
            expect(keys.some((k) => k.startsWith('NaN'))).toBe(false)
        }
    })

    it('dayanak: Solana zincir listesinde VAR ama swap ve bridge akislari Solana zincirini listelemez', () => {
        expect(LISTED_CHAINS.some((c) => c.vm === 'solana')).toBe(true)
        for (const flow of ['swap', 'bridge']) {
            expect(chainsForFlow(flow).some((c) => c.vm === 'solana'), flow).toBe(false)
        }
    })

    it('Solana bakiyesi EVM RPC sinden OKUNMAZ (bridge / swap)', async () => {
        await mountSwapFrom(IMPORTED)
        await mountBridgeFrom(IMPORTED)

        const okunan = useTokenBalanceMock.mock.calls.map(([, address]) => address)
        expect(okunan).not.toContain(USDC_MINT)
    })
})

// ---------------------------------------------------------------------------------------------
// Kaynak taramasi: ham /getChainTokens cagrilari
// ---------------------------------------------------------------------------------------------

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir) {
    const out = []
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, ent.name)
        if (ent.isDirectory()) out.push(...walk(full))
        else if (/\.(vue|js)$/.test(ent.name) && !/\.test\.js$/.test(ent.name)) out.push(full)
    }
    return out
}

// Yorumlar esit uzunlukta bosluga cevrilir: yorumda gecen kelime ne iddiayi kirar ne gercek kodu maskeler.
const yorumsuz = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length))
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))

const rel = (full) => relative(SRC_ROOT, full).split(sep).join('/')
const RAW_CALL = /\.post\(\s*[^)]*?['"`]\/getChainTokens['"`]/g

describe('kaynak taramasi: ham /getChainTokens cagrilari', () => {
    const callers = new Map()
    for (const file of walk(SRC_ROOT)) {
        const text = yorumsuz(readFileSync(file, 'utf8'))
        const count = (text.match(RAW_CALL) || []).length
        if (count) callers.set(rel(file), { text, count })
    }

    it('cagiran dosya kumesi SABIT: yeni bir ham cagri bu testi kirar ve gerekcesi buraya yazilmak zorunda', () => {
        expect([...callers.keys()].sort()).toEqual([
            // Solana KAPSAMLI listeler: sunucu kimligi -101, damgalama stampServerTokens ile.
            'components/SearchTokens.vue',
            'components/SelectAssets.vue',
            // Gizli mod teslim secicisi: deliveryChainOf tablosundaki EVM aglari (Solana gizli moddan DISLANIR, Constraint 8).
            'components/privacy/PrivateDeliveryTokenPicker.vue',
            // Swap akisi: chainsForFlow('swap') Solana'yi icermez (isEvm/TON kapisi); kapsam SayiSAL.
            'components/swap/swapFrom.vue',
            // Swap hedefi: aktif ag (swap destekli EVM/TON); Solana'da swap ekrani acilmaz.
            'components/swap/swapTo.vue',
        ].sort())
    })

    for (const file of ['components/SearchTokens.vue', 'components/SelectAssets.vue']) {
        it(`${file}: her ham cagri scopeServerChainIds + stampServerTokens ile, Number() ile damgalama YOK`, () => {
            const { text, count } = callers.get(file)

            expect(text).toMatch(/scopeServerChainIds\(\s*scope\.filter/)
            expect((text.match(/stampServerTokens\(/g) || []).length).toBeGreaterThanOrEqual(count)
            // Eski sekil: `Number(t.chainId ?? ...)` + isFinite suzgeci -- Solana'yi NaN'a dusurur.
            expect(text).not.toMatch(/Number\(\s*(?:t|st|tk)\.chainId\s*\?\?/)
            // Tek zincir govdesindeki chain alani sunucu kimligiyle aranir.
            expect(text).toMatch(/toServerChainId\(\s*c\.chainId\s*\)\s*===\s*ids\[0\]/)
            expect(text).not.toMatch(/Number\(\s*c\.chainId\s*\)\s*===\s*ids\[0\]/)
        })
    }

    it('SearchTokens: kapsam kimligi ise scopeChainIds (NaN yolu) HIC kullanilmaz', () => {
        expect(callers.get('components/SearchTokens.vue').text).not.toMatch(/\bscopeChainIds\(/)
    })

    it('dort ekran ice aktarilanlari ham flattenImportedTokens ile OKUMAZ (kapsam/Solana karari importedForScope da)', () => {
        for (const file of ['components/SearchTokens.vue', 'components/SelectAssets.vue', 'components/swap/swapFrom.vue', 'components/bridge/bridgeFrom.vue']) {
            const text = yorumsuz(readFileSync(join(SRC_ROOT, file), 'utf8'))
            expect(text, file).not.toMatch(/\bflattenImportedTokens\(/)
            expect(text, file).toMatch(/\bimportedForScope\(/)
        }
    })

    it('swap ve bridge ice aktarilanlarda Solana kovasini excludeSolana: true ile eler', () => {
        for (const file of ['components/swap/swapFrom.vue', 'components/bridge/bridgeFrom.vue']) {
            const text = yorumsuz(readFileSync(join(SRC_ROOT, file), 'utf8'))
            expect(text, file).toMatch(/importedForScope\([^)]*excludeSolana:\s*true/)
        }
    })
})
