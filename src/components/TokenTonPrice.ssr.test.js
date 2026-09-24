// Token.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (canli teshis 2026-09-18): kullanici TON aginda USDT detayini acti ve
// ekran "$0.00", "0.00%", "Bu token icin fiyat gecmisi yok", butun Piyasa Verileri
// satirlari $0, logo yerine dicebear bas harf avatari gosterdi. Sunucu SAGLAMDI:
// POST /getChainTokens {chainId:-239} USDT satirini coingecko_id:"tether" ile,
// POST /getTokenDataById {id:"tether"} ise priceUSD 0.999189 ile donduruyordu.
//
// ZINCIR. Ana ekran listesi chrome.storage.local.imported_tokens icinden gelir ve
// o kayit DONDURULMUS bir anlik goruntudur -- hicbir kod onu sunucuyla tazelemez
// (bkz. utils/ton/tonTokenSeed.js bas yorumu: "imported_tokens icin baska hicbir
// yerde goc/onarim yok"). Kurasyonlu TON jettonlari 2026-08-24 ile 2026-09-17
// arasinda sunucudan KIMLIKSIZ donuyordu (bkz. e70b89d govdesi), yani o pencerede
// eklenen satir KALICI olarak coingecko_id'siz kaldi. Home.vue selectToken o alani
// dogrudan `crypto.selected_token_id`e yaziyor, Token.vue ise TEK kimlik kaynagi
// olarak `props.id`i kullaniyor: istek {id: undefined} ile gidiyor, uc 404 donuyor
// (CANLI OLCUM: POST /getTokenDataById -d '{}' -> 404 "Token not found"), catch
// yutuyor ve `token` null kaliyor. Ekran o zaman utils/tokenRowRecord.js yedegini
// ciziyor -- o yedek coingecko_id'yi HER durumda null yazar, yani grafik de kapanir.
//
// BU DOSYANIN KILITLEDIGI IKI KARAR:
//
// 1. KIMLIK ADRESTEN KURTARILIR. Satirin kimligi yoksa ekran pes etmez: sunucunun
//    /getTokenByAddress ucu (server/router.js:17) adresten coingecko_id cozer ve
//    CANLI OLCUM'de TON USDT master adresi icin {chainId:-239, coingecko_id:"tether"}
//    donuyor. Boylece kullanici tokeni SILIP YENIDEN EKLEMEDEN duzelir ve ayni
//    onarim her zincirdeki bayat satir icin calisir.
//
//    AMA ZINCIR DOGRULAMASI SART. O uc govdedeki chainId'yi YOK SAYAR (CANLI OLCUM:
//    ayni TON adresine chainId:1 gonderildi, cevap yine -239 geldi) ve DB kolunda
//    adres benzersiz DEGIL: 0x4200...0006 icin "bridged-wrapped-ethereum-bob-network"
//    donuyor, oysa satir Base'de olabilir. Dogrulamasiz kabul etmek, kullaniciya
//    BASKA bir tokenin fiyatini bu tokenin fiyati diye gostermek olurdu -- YANLIS
//    fiyat EKSIK fiyattan KOTUDUR (ayni gerekce: server/data/tonJettons.js'in STON
//    karari). Bu yuzden cevap YA satirla ayni chainId'yi YA DA satirin zincirinin
//    chainSlug'ini tasimak ZORUNDA; ikisi de yoksa kimlik REDDEDILIR.
//
// 2. TON'DA ONDALIK ZINCIRDEN OKUNMAZ. Token.vue'nun ERC-20 `decimals()` blogu
//    "adres '0x0' degilse" kosuluyla kosuyordu, yani bir jetton master adresinde de
//    kosuyor; TON kaydinda RPC ucu YOK (data/supported_chains.json -239 -> rpc: [])
//    ve cagri duserek kayda VARSAYILAN 18 yaziyordu. O deger dogrudan
//    getJettonBalance'a gidiyor: 6 ondalikli USDT'nin ham miktari 1e18'e bolunup
//    bakiye 1e12 kat KUCUK cikiyor ve ekranda "Ondalik 18" yaziyor. Yani 1. karari
//    tek basina uygulamak fiyati getirir ama BAKIYEYI BOZAR.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu -- hoisting).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

// ETHERS MOCKLANIR ama SESSIZ DEGIL: bu dosyanin olctugu sey, TON satirinda bu
// yolun HIC KURULMAMASI. Gercek `ethers` ile de test yesil olurdu (cagri duser,
// 18 yazilir) -- constructor'i saymak, yolun gercekten atlandigini kanitlar.
const contractCtorMock = vi.fn()
vi.mock('ethers', () => ({
    Contract: class {
        constructor(...args) { contractCtorMock(...args) }
        // EVM kollari icin GECERLI bir cevap doner: bu dosyanin konusu TON
        // satirinda bu yolun HIC KURULMAMASI, EVM'de dusmesi degil.
        async decimals() { return 18 }
    },
    JsonRpcProvider: class {},
}))

const jettonBalanceMock = vi.fn(async () => 12.5)
vi.mock('../utils/ton/jettonBalance', () => ({ getJettonBalance: (...args) => jettonBalanceMock(...args) }))
vi.mock('../utils/ton/jettonAddress', () => ({ getJettonWalletAddress: async () => 'EQJettonWalletTest' }))
vi.mock('../utils/ton/tonIdentity', () => ({ ensureTonAddress: async () => 'UQTestOwner' }))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => 0 }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: async () => 0 }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'

const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const BASE_CHAIN = supported_chains.find((c) => c.chainId === 8453)

// CANLI OLCUM'deki gercek master adresi (server/data/tonJettons.js ile birebir).
const USDT_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'

// CANLI OLCUM: POST /getTokenDataById {"id":"tether"} cevabinin ilgili alanlari.
const canonicalTether = () => ({
    coingecko_id: 'tether',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    name: 'Tether',
    symbol: 'usdt',
    chain: 'ethereum',
    image: { thumb: 'https://coin-images.coingecko.com/t.png', small: '', large: '' },
    market_data: {
        priceUSD: 0.999189,
        market_cap: 183293878460,
        volume: 55807409068,
        circulating_supply: 183442587855,
        ath: 1.32,
        atl: 0.572521,
        change: { h24: 0.00143 },
        sparkline: { d7: [] },
    },
})

/**
 * axios.post saplamasini UCA GORE dagitir. `byAddress` null ise adres ucu 404
 * verir (sunucunun bilinmeyen adres cevabi: {success:false,"message":"Token not found"}).
 */
function routeAxios({ byId = {}, byAddress = null }) {
    axiosPostMock.mockImplementation(async (url, body) => {
        // Kimlik cozulunce CryptoChart GERCEKTEN mount olur ve gecmis ister --
        // saplanmazsa cikti bir yigin "Fiyat gecmisi alinamadi" uyarisiyla kirlenir
        // ve grafigin CIZILDIGI gercegi gorunmez olur.
        if (String(url).endsWith('/getTokenPriceHistory')) {
            return { status: 200, data: { success: true, prices: [[1787184000000, 0.9995]], currency: 'usd' } }
        }
        if (String(url).endsWith('/getTokenByAddress')) {
            if (!byAddress) throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } })
            return { status: 200, data: { success: true, token: byAddress } }
        }
        if (String(url).endsWith('/getTokenDataById')) {
            const record = byId[body?.id]
            if (!record) throw Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } })
            return { status: 200, data: { success: true, token: record } }
        }
        throw new Error(`Beklenmeyen uc: ${url}`)
    })
}

afterEach(() => {
    axiosPostMock.mockReset()
    contractCtorMock.mockClear()
    jettonBalanceMock.mockClear()
    delete globalThis.chrome
})

function setup(chainRecord, { tokenId, selectedRef }) {
    installChromeStub({
        currentNetwork: chainRecord,
        active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
    })

    const app = createApp(Token, { props: { id: tokenId } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    const crypto = cryptoStore()
    crypto.selected_token_ref = selectedRef

    return { app }
}

const tonRow = (overrides = {}) => ({
    id: undefined,
    chainId: -239,
    address: USDT_MASTER,
    decimals: 6,
    symbol: 'USDT',
    ...overrides,
})

describe('Token.vue (SSR) -- kimliksiz satirda fiyat kimligi ADRESTEN kurtarilir', () => {
    it('satirda coingecko_id YOKKEN adres ucundan kimlik cozulur ve GERCEK piyasa verisi gelir', async () => {
        routeAxios({
            byId: { tether: canonicalTether() },
            // CANLI OLCUM: POST /getTokenByAddress {"address":"EQCxE6mU..."} cevabi.
            byAddress: {
                address: USDT_MASTER,
                chainId: -239,
                symbol: 'USDT',
                name: 'Tether USD',
                decimals: 6,
                image: 'https://tether.to/images/logoCircle.png',
                coingecko_id: 'tether',
            },
        })

        const { app } = setup(TON_CHAIN, { tokenId: undefined, selectedRef: tonRow() })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.displayToken.coingecko_id).toBe('tether')
        expect(captured.instance.setupState.displayToken.market_data.priceUSD).toBeCloseTo(0.999189, 6)
    })

    it('kimlik kurtarilinca GRAFIK gercekten cizilir -- "fiyat gecmisi yok" metni kalmaz', async () => {
        routeAxios({
            byId: { tether: canonicalTether() },
            byAddress: { address: USDT_MASTER, chainId: -239, coingecko_id: 'tether', decimals: 6 },
        })

        const { app } = setup(TON_CHAIN, { tokenId: undefined, selectedRef: tonRow() })
        captureInstance(app, 'Token')
        const html = await render(app)

        // Kullanicinin bildirdigi metin, ekran goruntusundeki haliyle.
        expect(html).not.toContain('Bu token icin fiyat gecmisi yok')
        expect(html).not.toContain('Bu token için fiyat geçmişi yok')
        // Grafik bileseni gecmisi KENDI kimligiyle istedi (uctan uca kanit).
        const gecmisCagrilari = axiosPostMock.mock.calls.filter(([url]) => String(url).endsWith('/getTokenPriceHistory'))
        expect(gecmisCagrilari.length).toBeGreaterThan(0)
        expect(gecmisCagrilari[0][1].id).toBe('tether')
    })

    it('kurtarilan kayit SATIRIN adresini ve zincirini korur (kanonik kaydin Ethereum adresi YAZILMAZ)', async () => {
        routeAxios({
            byId: { tether: canonicalTether() },
            byAddress: { address: USDT_MASTER, chainId: -239, coingecko_id: 'tether', decimals: 6 },
        })

        const { app } = setup(TON_CHAIN, { tokenId: undefined, selectedRef: tonRow() })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.displayToken.address).toBe(USDT_MASTER)
        expect(captured.instance.setupState.displayToken.chainId).toBe(-239)
    })

    it('adres ucu BASKA zincirin kaydini dondurursa kimlik REDDEDILIR -- yanlis fiyat gosterilmez', async () => {
        // CANLI OLCUM: {"address":"0x4200...0006"} -> chain "bob-network". Satir Base'de.
        routeAxios({
            byId: { 'bridged-wrapped-ethereum-bob-network': { ...canonicalTether(), coingecko_id: 'bridged-wrapped-ethereum-bob-network' } },
            byAddress: {
                address: '0x4200000000000000000000000000000000000006',
                chain: 'bob-network',
                coingecko_id: 'bridged-wrapped-ethereum-bob-network',
            },
        })

        const { app } = setup(BASE_CHAIN, {
            tokenId: undefined,
            selectedRef: { id: undefined, chainId: 8453, address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.token).toBeNull()
        expect(captured.instance.setupState.displayToken.coingecko_id).toBeNull()
        expect(captured.instance.setupState.displayToken.market_data.priceUSD).toBe(0)
    })

    it('chainId TASIMAYAN cevap, satirin chainSlug u ile eslesiyorsa KABUL EDILIR', async () => {
        routeAxios({
            byId: { tether: canonicalTether() },
            // DB kolu chainId dondurmuyor, yalniz `chain` slug'i var (CANLI OLCUM).
            byAddress: { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', chain: 'ethereum', coingecko_id: 'tether' },
        })

        const { app } = setup(ETH_CHAIN, {
            tokenId: undefined,
            selectedRef: { id: undefined, chainId: 1, address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, symbol: 'USDT' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.displayToken.coingecko_id).toBe('tether')
    })

    it('ne chainId ne chainSlug tasiyan cevap REDDEDILIR', async () => {
        routeAxios({
            byId: { tether: canonicalTether() },
            byAddress: { address: USDT_MASTER, coingecko_id: 'tether' },
        })

        const { app } = setup(TON_CHAIN, { tokenId: undefined, selectedRef: tonRow() })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.token).toBeNull()
    })

    it('satir ZATEN kimlik tasiyorsa adres ucu HIC cagrilmaz (gereksiz istek uretilmez)', async () => {
        routeAxios({ byId: { tether: canonicalTether() }, byAddress: { address: USDT_MASTER, chainId: -239, coingecko_id: 'tether' } })

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether' }) })
        captureInstance(app, 'Token')
        await render(app)

        const uclar = axiosPostMock.mock.calls.map(([url]) => String(url))
        expect(uclar.some((u) => u.endsWith('/getTokenByAddress'))).toBe(false)
    })

    it('adres ucu de coz(e)mezse ekran YEDEGE duser ve cokmez', async () => {
        routeAxios({ byId: {}, byAddress: null })

        const { app } = setup(TON_CHAIN, { tokenId: undefined, selectedRef: tonRow() })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.token).toBeNull()
        expect(captured.instance.setupState.loaded).toBe(true)
        expect(html).toContain('USDT')
    })
})

describe('Token.vue (SSR) -- TON jettonunda ondalik ZINCIRDEN OKUNMAZ', () => {
    it('ERC-20 decimals() yolu bir jetton master adresinde HIC kurulmaz', async () => {
        routeAxios({ byId: { tether: canonicalTether() } })

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether' }) })
        captureInstance(app, 'Token')
        await render(app)

        expect(contractCtorMock).not.toHaveBeenCalled()
    })

    it('jetton bakiyesi SATIRIN ondaligiyla (6) okunur, varsayilan 18 e DUSMEZ', async () => {
        routeAxios({ byId: { tether: canonicalTether() } })

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether' }) })
        captureInstance(app, 'Token')
        await render(app)

        expect(jettonBalanceMock).toHaveBeenCalledTimes(1)
        expect(jettonBalanceMock.mock.calls[0][0].decimals).toBe(6)
    })

    it('ekranda gosterilen ondalik da SATIRIN ondaligidir (18 YALANI basilmaz)', async () => {
        routeAxios({ byId: { tether: canonicalTether() } })

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether' }) })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.decimals).toBe(6)
    })

    // KULLANICI RAPORU (2026-09-18, ilk duzeltmeden SONRA): fiyat, grafik ve ondalik
    // artik dogru geliyor ama "DEGER" alani hala "$0" -- bakiye 0.051240 USDT ve
    // birim fiyat $1.00 iken. Sebep bu blokta: jetton kolu `balance`i yaziyor ama
    // `usdBalance`i HIC yazmiyordu; ayni fonksiyonun DIGER UC kolu (Solana, native
    // TON, EVM) yaziyor. Yani hesap eksik degil, bu kolda HIC YAPILMIYORDU.
    it('jetton bakiyesinin DOLAR KARSILIGI hesaplanir (DEGER alani "$0" kalmaz)', async () => {
        routeAxios({ byId: { tether: canonicalTether() } })

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether' }) })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.usdBalance).toBeCloseTo(12.5 * 0.999189, 6)
        expect(html).toContain('$12.49')
    })

    it('bakiye OKUNAMAZSA dolar karsiligi UYDURULMAZ', async () => {
        routeAxios({ byId: { tether: canonicalTether() } })
        jettonBalanceMock.mockRejectedValueOnce(new Error('proxy dustu'))

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether' }) })
        const captured = captureInstance(app, 'Token')
        await render(app)

        // Sablon `balanceError`a bakip "—" basar; sifir bir DEGER gostermek
        // kullaniciya parasinin kayboldugunu dusundururdu.
        expect(captured.instance.setupState.balanceError).toBe(true)
        expect(captured.instance.setupState.usdBalance).toBe(0)
    })

    it('satir ondalik TASIMIYORSA alan UYDURULMAZ (null kalir, sablon satiri gizler)', async () => {
        routeAxios({ byId: { tether: canonicalTether() } })

        const { app } = setup(TON_CHAIN, { tokenId: 'tether', selectedRef: tonRow({ id: 'tether', decimals: undefined }) })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.decimals).toBeNull()
    })
})
