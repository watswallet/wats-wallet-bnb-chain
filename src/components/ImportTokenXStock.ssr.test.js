// ImportToken.vue - SAHTE xSTOCK KIMLIGI (spec 8.4 katman 2), bilesen teli. Karar mantigi
// (stockImportIdentity) utils/tokenizedStocks.test.js'te ayrintili test edilir; burasi BILESENIN o karari
// GERCEKTEN cagirdigini, AD'i de gecirdigini ve dogru zinciri verdigini kilitler. Kalip
// ImportTokenBStock.ssr.test.js ile AYNI (zincir ve sunucu saplanir).
import { describe, it, expect, vi, afterEach } from 'vitest'

const { KONTRATLAR, axiosPostMock } = vi.hoisted(() => ({
    KONTRATLAR: new Map(),
    axiosPostMock: vi.fn(),
}))

vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    class JsonRpcProvider {
        async getCode() { return '0x6080' }
    }
    class Contract {
        constructor(address) {
            const k = KONTRATLAR.get(address.toLowerCase())
            this.name = async () => k.name
            this.symbol = async () => k.symbol
            this.decimals = async () => 18n
        }
    }
    return { ...actual, JsonRpcProvider, Contract }
})

vi.mock('axios', () => ({ default: { post: (...a) => axiosPostMock(...a), get: vi.fn() } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import ImportToken from './ImportToken.vue'
import { XSTOCKS } from '../data/xStocks'
import supported_chains from '../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const BSC_CHAIN = supported_chains.find((c) => c.chainId === 56)
const POLYGON_CHAIN = supported_chains.find((c) => c.chainId === 137)

const TSLA = XSTOCKS.find((s) => s.symbol === 'TSLAx')
// Yalniz bir zincirde (Ethereum) bulunan gercek katalog hissesi (G2: katalogdan turetilir).
const TEK_ZINCIRLI = XSTOCKS.find((s) => s.chains.length === 1)
const SAHTE_AAPLX = '0x3f46948c00000000000000000000000000000000' // katalogda OLMAYAN, adi taklit eden kontrat

afterEach(() => {
    delete globalThis.chrome
    KONTRATLAR.clear()
    axiosPostMock.mockReset()
})

async function dogrula(chainRecord, address) {
    installChromeStub({ active_account: { key: 'acc-1' } })
    const app = createApp(ImportToken)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord
    network.rpc = 'https://rpc.example'

    const captured = captureInstance(app, 'ImportToken')
    await render(app)
    return captured.instance.setupState.validateTokenContract(address)
}

describe('ImportToken.vue (SSR) - xStock taklitcisi kimlik miras almaz', () => {
    // Sunucu getTokenByName'de xStock kayitlarini ADA gore dondurmuyor (Task 9) ama ESKI sunucu ya da aile disi bir
    // kayit hala donebilir: karar sunucuya DEGIL katalog + sembol / ad kuralina dayanir.
    it('Review Focus 4: katalogda olmayan, gercek hissenin adini ve sembolunu tasiyan SAHTE kontrat dogrulanmamis sayilir', async () => {
        KONTRATLAR.set(SAHTE_AAPLX, { name: 'Apple', symbol: 'AAPLx' })
        axiosPostMock.mockResolvedValue({ data: { token: { coingecko_id: 'apple-xstock', image: { large: 'https://sunucu/apple.png' }, chain: 'ethereum' } } })

        const sonuc = await dogrula(ETH_CHAIN, SAHTE_AAPLX)

        expect(sonuc).toMatchObject({ name: 'Apple', symbol: 'AAPLx', image: null, chain: null, coingecko_id: null, known: false })
    })

    it('Review Focus 4: sunucu eslesmese (404) da AD, x ile biten sembol ve "xStock" ile yakalanir (AD gecirilir)', async () => {
        KONTRATLAR.set(SAHTE_AAPLX, { name: 'Fake Stock xStock', symbol: 'FAKEx' })
        axiosPostMock.mockRejectedValue(new Error('Request failed with status code 404'))

        const sonuc = await dogrula(ETH_CHAIN, SAHTE_AAPLX)

        expect(sonuc).toMatchObject({ image: null, coingecko_id: null, known: false })
    })

    it('GERCEK katalog adresi kimligini katalogdan alir ve dogrulanmis sayilir (kendi zincirinde)', async () => {
        KONTRATLAR.set(TSLA.address.toLowerCase(), { name: 'Tesla xStock', symbol: 'TSLAx' })
        axiosPostMock.mockRejectedValue(new Error('Request failed with status code 404'))

        const sonuc = await dogrula(ETH_CHAIN, TSLA.address)

        expect(sonuc).toMatchObject({ coingecko_id: 'tesla-xstock', chain: 'ethereum', known: true })
    })

    // Review Focus 1: ayni adres katalogda OLMAYAN bir zincirde (Polygon) katalog adresi sayilmaz; sembol yine hisse.
    it('Review Focus 1: ayni adres Polygon kovasina eklenirken hisse sayilmaz (zincir kovanin zinciridir)', async () => {
        KONTRATLAR.set(TSLA.address.toLowerCase(), { name: 'Tesla xStock', symbol: 'TSLAx' })
        axiosPostMock.mockResolvedValue({ data: { token: { coingecko_id: 'tesla-xstock', image: { large: 'u' }, chain: 'ethereum' } } })

        const sonuc = await dogrula(POLYGON_CHAIN, TSLA.address)

        expect(sonuc).toMatchObject({ coingecko_id: null, known: false })
    })

    it('Review Focus 4: ilgisiz "ETHx" uyari ALMAZ ve sunucunun kimligini eskisi gibi tasir', async () => {
        const ETHX = '0x1111111111111111111111111111111111111111'
        KONTRATLAR.set(ETHX, { name: 'Ether.fi Staked ETH', symbol: 'ETHx' })
        axiosPostMock.mockResolvedValue({ data: { token: { coingecko_id: 'stader-ethx', image: { large: 'u' }, chain: 'ethereum' } } })

        const sonuc = await dogrula(ETH_CHAIN, ETHX)

        expect(sonuc).toMatchObject({ coingecko_id: 'stader-ethx', image: { large: 'u' }, chain: 'ethereum', known: true })
    })

    it('Review Focus 4: sunucu wrapped-*-xstock kimligi dondururse (ailenin sarmalayicisi) kimlik VERILMEZ', async () => {
        const WRAPPED = '0x2222222222222222222222222222222222222222'
        KONTRATLAR.set(WRAPPED, { name: 'Wrapped Tesla', symbol: 'wTSLA' })
        axiosPostMock.mockResolvedValue({ data: { token: { coingecko_id: 'wrapped-tesla-xstock', image: { large: 'u' }, chain: 'ethereum' } } })

        const sonuc = await dogrula(ETH_CHAIN, WRAPPED)

        expect(sonuc).toMatchObject({ coingecko_id: null, image: null, known: false })
    })

    // T3-R-2 (controller karari): gercek katalog adresi, hissenin `chains` listesinde OLMAYAN bir zincirde
    // (urun destegi yok) dogrulanmis sayilmaz: sari uyari KASITLI ve guvenli taraftir.
    it('T3-R-2: tek zincirli gercek hissenin adresi BSC kovasina eklenirken dogrulanmamis sayilir', async () => {
        // On kosul (FIN-bilesen-9): katalog daralip tek zincirli hisse kalmazsa test anlasilmaz bir TypeError ile
        // degil, ne yapilacagini soyleyen bir mesajla dusmeli.
        expect(
            TEK_ZINCIRLI,
            'katalogda tek zincirli (chains.length === 1) hisse kalmadi: bu testin hissesini test icinde fixture ile kur (kararlar G2)',
        ).toBeDefined()
        expect(TEK_ZINCIRLI.chains).not.toContain(56)
        KONTRATLAR.set(TEK_ZINCIRLI.address.toLowerCase(), { name: TEK_ZINCIRLI.name, symbol: TEK_ZINCIRLI.symbol })
        axiosPostMock.mockRejectedValue(new Error('Request failed with status code 404'))

        const sonuc = await dogrula(BSC_CHAIN, TEK_ZINCIRLI.address)

        expect(sonuc).toMatchObject({ image: null, chain: null, coingecko_id: null, known: false })
    })
})
