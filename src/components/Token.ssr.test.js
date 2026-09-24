// Token.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (F3, kod incelemesi): bu ekranin Swap/Kopru/Al-Sat dugmeleri ("ikinci
// giris kapisi", bkz. Home.vue'nun dugmeleri) HICBIR testte dogrulanmiyordu --
// `assetRouteWiring.test.js` dosyayi METIN olarak okuyor ama gorunurluk hakkinda
// hicbir sey iddia etmiyor. Reviewer'in kanitladigi gibi, uc `v-if`i BIRDEN
// SILMEK butun paketi (106 dosya/1524 test) YESIL birakiyordu. Bu dosya
// davranisa bakar.
//
// AYNI zamanda F4'u de dogrular: kaynak TOKENIN KENDI ZINCIRIDIR, aktif ag
// DEGIL -- Solana aktifken bir Polygon token kaydi acilirsa Swap/Kopru/Al-Sat
// yine GORUNUR olmali.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Bu dosyanin konusu buton gorunurlugu: gercek fiyat/bakiye aginin (axios,
// useTokenBalance) hicbirine ihtiyaci yok. `address: '0x0'` (native) secilerek
// ethers Contract/decimals dali da (yalniz ERC-20 icin calisir) devre disi
// kalir -- bu yuzden 'ethers' MOCKLANMASINA gerek YOK.
const axiosPostMock = vi.fn()
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

// TON BAKIYE ZINCIRI MOCKLANIR. Kanonik kayit COZULDUGUNDE onMounted'in TON kolu
// gercekten calisir ve aga cikardi (getTonBalance -> HTTP). Bu dosyanin konusu
// devredilen KAYIT, bakiye degil. Mevcut TON testleri kaydi cozulemez birakiyor,
// yani o dala hic girmiyor ve bu mocklardan ETKILENMIYORLAR.
vi.mock('../utils/ton/tonIdentity', () => ({ ensureTonAddress: async () => 'UQTest' }))
vi.mock('../utils/ton/tonClient', () => ({ getTonClient: () => ({}) }))
vi.mock('../utils/ton/tonBalance', () => ({ getTonBalance: async () => 0 }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import { userStore } from '../store/user'
import Token from './Token.vue'
import supported_chains from '../data/supported_chains.json'
import { solanaMintOf } from '../utils/solana/sendMint'
import { SOL_NATIVE_MARKER } from '../utils/solana/constants'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const mockTokenRecord = (overrides = {}) => ({
    name: 'USD Coin',
    symbol: 'usdc',
    coingecko_id: 'usd-coin',
    image: { thumb: '', large: '' },
    address: '0x0',
    market_data: {
        priceUSD: 1,
        market_cap: 1000,
        volume: 500,
        circulating_supply: 1000,
        ath: 1.1,
        atl: 0.9,
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

function setup(chainRecord, { tokenId = 'usd-coin', selectedRef = null, tokenBalances = null } = {}) {
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

    const page = pageStore()
    const user = userStore()
    if (tokenBalances) user.tokenBalances = tokenBalances

    return { app, network, crypto, page, user }
}

describe('Token.vue (SSR) -- ikinci giris kapisi: Swap/Kopru/Al-Sat token un KENDI zincirine bakar (Task 15 F3+F4)', () => {
    it('EVM aktif, token AYNI EVM zincirinde: Swap/Kopru GORUNUR', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        const { app } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' } })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
        expect(html).toContain('>Send<')
        // Takas/Kopru dugmelerini SUREN kapi `canSwap`/`canBridge`
        // (chainSupportsFlow); `features` yalnizca ATS/Al/dapp icindir ve
        // `swap`/`bridge` alanlari evmGates.js'ten KALDIRILDI -- uretimde
        // okuyuculari yoktu, yani buradaki eski iddia dugme kaybolsa bile
        // yesil kalabilirdi.
        expect(captured.instance.setupState.canSwap).toBe(true)
        expect(captured.instance.setupState.canBridge).toBe(true)
        expect(captured.instance.setupState.features).toEqual({ ats: true, buy: true, dapp: true })
    })

    // F4'un TAM iddia ettigi senaryo: aktif ag Solana, ama acilan token kaydi
    // bir Polygon tokeni. ensureChain() zaten Swap/Bridge'e GIRMEDEN once bu
    // kaydin zincirine geciyor -- yani bu dugmeler ANLAMLI ve gorunmeli.
    it('Solana AKTIF ama token Polygon (137): Swap/Kopru YINE GORUNUR', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        const { app } = setup(SOLANA_CHAIN, { tokenId: 'usd-coin', selectedRef: { id: 'usd-coin', chainId: 137, address: '0x0' } })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
        // Takas/Kopru dugmelerini SUREN kapi `canSwap`/`canBridge`
        // (chainSupportsFlow); `features` yalnizca ATS/Al/dapp icindir ve
        // `swap`/`bridge` alanlari evmGates.js'ten KALDIRILDI -- uretimde
        // okuyuculari yoktu, yani buradaki eski iddia dugme kaybolsa bile
        // yesil kalabilirdi.
        expect(captured.instance.setupState.canSwap).toBe(true)
        expect(captured.instance.setupState.canBridge).toBe(true)
        expect(captured.instance.setupState.features).toEqual({ ats: true, buy: true, dapp: true })
    })

    // Gercek bir Solana token sayfasi: `selected_token_ref` yok (ya da baska bir
    // id'ye ait, bkz. pickedRef'in id kontrolu) -- kanonik kayit chainId
    // TASIMIYOR (bkz. Token.vue'deki not), yani zincir COZULEMEZ ve HEPSI kapali
    // kalmali (evmOnlyFeatures(null) ilkesiyle AYNI).
    it('token kaydinin zinciri COZULEMEZSE (selected_token_ref yok) Swap/Kopru GIZLENIR, Gonder kalir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'some-spl-token' }) } })

        const { app } = setup(SOLANA_CHAIN, { tokenId: 'some-spl-token', selectedRef: null })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(html).not.toContain('>Swap<')
        expect(html).not.toContain('>Bridge<')
        expect(html).toContain('>Send<')
        // Ayni gerekce (yukaridaki EVM iddialari): dugmeyi SUREN kapi bu.
        expect(captured.instance.setupState.canSwap).toBe(false)
        expect(captured.instance.setupState.canBridge).toBe(false)
        expect(captured.instance.setupState.features).toEqual({ ats: false, buy: false, dapp: false })
    })

    // KOD INCELEMESI (turu 2, C): kayit YUKLENEMEDIGINDE (arka uc 500 doner ya da
    // istek reddedilir) `token.value` null kalir -- ONCEDEN bu, EVM'de bile
    // Swap/Kopru/Al-Sat'i GIZLIYORDU. Bu, Task 15 oncesine gore olculebilir bir EVM
    // davranis degisimiydi ve ayni mekanizma HER NORMAL YUKLEMENIN ilk aninda da
    // dugmelerin once yok olup sonra "pat" diye belirmesine yol aciyordu.
    // ensureChain() bu durumda HICBIR gecis yapmaz (Number(undefined) sonlu degil),
    // yani islem AKTIF AGDA calisir -- kapi da aktif aga bakar.
    it('kayit YUKLENEMEZSE (500) EVM aktifken Swap/Kopru GORUNUR KALIR', async () => {
        axiosPostMock.mockResolvedValue({ status: 500, data: {} })

        const { app } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' } })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.token).toBeNull()
        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
        // Takas/Kopru dugmelerini SUREN kapi `canSwap`/`canBridge`
        // (chainSupportsFlow); `features` yalnizca ATS/Al/dapp icindir ve
        // `swap`/`bridge` alanlari evmGates.js'ten KALDIRILDI -- uretimde
        // okuyuculari yoktu, yani buradaki eski iddia dugme kaybolsa bile
        // yesil kalabilirdi.
        expect(captured.instance.setupState.canSwap).toBe(true)
        expect(captured.instance.setupState.canBridge).toBe(true)
        expect(captured.instance.setupState.features).toEqual({ ats: true, buy: true, dapp: true })
    })

    it('istek REDDEDILIRSE de EVM aktifken dugmeler GORUNUR KALIR', async () => {
        axiosPostMock.mockRejectedValue(new Error('network down'))

        const { app } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' } })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.token).toBeNull()
        expect(html).toContain('>Swap<')
        // Dugmeyi SUREN kapi `canSwap` (chainSupportsFlow). Onceden burada
        // `features.swap` iddia ediliyordu; o alan dugmeye hicbir zaman bagli
        // DEGILDI (ve evmGates.js'ten kaldirildi), yani iddia dugme kaybolsa
        // bile yesil kalabilirdi.
        expect(captured.instance.setupState.canSwap).toBe(true)
    })

    // AYNI yol Solana aktifken KAPALI kalir: ensureChain gecis yapmayacagi icin
    // islem Solana'da calisirdi -- yani dugmeler gercekten anlamsiz.
    it('kayit YUKLENEMEZSE Solana aktifken dugmeler GIZLI kalir', async () => {
        axiosPostMock.mockResolvedValue({ status: 500, data: {} })

        const { app } = setup(SOLANA_CHAIN, { tokenId: 'usd-coin', selectedRef: null })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(html).not.toContain('>Swap<')
        expect(html).not.toContain('>Bridge<')
        expect(captured.instance.setupState.canSwap).toBe(false)
    })

    it('Solana aktif, token de Solana (chainId cozulur ama vm solana): Swap/Kopru GIZLENIR', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        // TASK 16a: pickedRef() ARTIK Solana'nin METIN chainId'sini KABUL EDIYOR
        // (once `Number.isFinite(Number(picked.chainId))` onu topluca reddediyordu).
        // Yani bu test artik "chainId cozulemedi" yolunu DEGIL, gercekten cozulmus
        // bir SOLANA kaydini olcuyor -- F4'un "token kaydinin zinciri Solana ise de
        // kapali kalmali" tarafi.
        const { app } = setup(SOLANA_CHAIN, { tokenId: 'sol-token', selectedRef: { id: 'sol-token', chainId: 'solana-mainnet', address: 'native' } })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.token.chainId).toBe('solana-mainnet')
        // Ayni gerekce (yukaridaki EVM iddialari): dugmeyi SUREN kapi bu.
        expect(captured.instance.setupState.canSwap).toBe(false)
        expect(captured.instance.setupState.canBridge).toBe(false)
        expect(captured.instance.setupState.features).toEqual({ ats: false, buy: false, dapp: false })
    })
})

// TASK 16a, Madde 2: "Solana satiri OLU BIR DOKUNUS".
//
// Home satiri (useSolanaAssets) `chainId: 'solana-mainnet'` ve `address:
// 'native' | <base58 mint>` tasiyor. Token.vue eskiden bu kimligi KAPIDA
// ATIYORDU: `pickedRef` metin chainId'yi reddediyor, kayit kanonik kayda
// (address '0x0', chainId YOK) DUSUYOR ve Gonder ekrani `sendAsset?.address ||
// SOL_NATIVE_MARKER` dedigi icin '0x0'i bir SPL MINT'i saniyordu.
describe('Token.vue (SSR) -- Solana satiri Gonder e DURUST bir kimlikle ulasir (Task 16a)', () => {
    it('native SOL: chainId METIN kalir, address ikame EDILMEZ ve Gonder e tasinir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'solana', symbol: 'sol' }) } })

        const { app, crypto, page } = setup(SOLANA_CHAIN, {
            tokenId: 'solana',
            selectedRef: { id: 'solana', chainId: 'solana-mainnet', address: 'native' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.chainId).toBe('solana-mainnet')
        expect(crypto.sendAsset.address).toBe('native')
        // Kanonik kaydin ANA zincir adresi ('0x0') SIZMADI.
        expect(crypto.sendAsset.address).not.toBe('0x0')
        expect(page.currentPage).toBe('send')
    })

    it('SPL mint: base58 harf kasasi BIREBIR korunur', async () => {
        const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'usd-coin' }) } })

        const { app, crypto } = setup(SOLANA_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 'solana-mainnet', address: MINT, decimals: 6 },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.address).toBe(MINT)
        expect(crypto.sendAsset.address).not.toBe(MINT.toLowerCase())
    })

    // ONDALIK ZINCIRDE DOGRULANIR: createTransferCheckedInstruction yanlis
    // ondalikli bir SPL transferini DUSURUR ve Send/ConfirmTransaction ondaligi
    // yalnizca `crypto.sendAsset.decimals`ten okuyor (yoksa SOL_DECIMALS=9'a
    // duser). 6 ondalikli bir tokeni 9 ile gondermek her SPL gonderimini
    // basarisiz yapardi.
    it('SPL: ondalik SATIRDAN alinip Gonder e tasinir (9 a DUSMEZ)', async () => {
        const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'usd-coin' }) } })

        const { app, crypto } = setup(SOLANA_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 'solana-mainnet', address: MINT, decimals: 6 },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.decimals).toBe(6)

        await captured.instance.setupState.selectSend()
        expect(crypto.sendAsset.decimals).toBe(6)
    })

    it('native SOL: ondalik 9 olarak tasinir (buildTransferPlan bunu SART kosuyor)', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'solana' }) } })

        const { app, crypto } = setup(SOLANA_CHAIN, {
            tokenId: 'solana',
            selectedRef: { id: 'solana', chainId: 'solana-mainnet', address: 'native', decimals: 9 },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()
        expect(crypto.sendAsset.decimals).toBe(9)
    })

    // Ethers yolu (JsonRpcProvider + ERC-20 decimals + useTokenBalance) Solana'da
    // CALISTIRILMAMALI: Solana kaydinda `rpc` alani YOK, saglayici bir yere
    // baglanamaz, `decimals()` duser ve varsayilan 18 KAYDA yazilirdi (SOL 9).
    it('Solana da EVM bakiye yolu HIC calismaz; bakiye Home un kovasindan okunur', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'solana' }) } })

        const { app } = setup(SOLANA_CHAIN, {
            tokenId: 'solana',
            selectedRef: { id: 'solana', chainId: 'solana-mainnet', address: 'native' },
            tokenBalances: { 'solana-mainnet_native': { amount: 2.5, value: 375 } },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(useTokenBalanceMock).not.toHaveBeenCalled()
        expect(captured.instance.setupState.balance).toBe(2.5)
        expect(captured.instance.setupState.usdBalance).toBe(375)
        // `decimals` null BIRAKILIR (sablon satiri gizler): 18 yazmak YALAN olurdu.
        expect(captured.instance.setupState.decimals).toBeNull()
    })

    it('kovada kayit yoksa bakiye 0 olur, ekran cokmez', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'solana' }) } })

        const { app } = setup(SOLANA_CHAIN, {
            tokenId: 'solana',
            selectedRef: { id: 'solana', chainId: 'solana-mainnet', address: 'native' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.balance).toBe(0)
    })

    // CAPRAZ VM: aktif ag Ethereum, satir Solana. ensureChain ONCE aga gecmeli --
    // eskiden `Number('solana-mainnet')` NaN oldugu icin arama hicbir kayitla
    // eslesmiyor ve fonksiyon `false` donup Gonder'i TAMAMEN engelliyordu.
    it('EVM aktifken Solana satiri once AGI degistirir, sonra Gonder e gider', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'solana' }) } })

        const { app, network, crypto, page } = setup(ETH_CHAIN, {
            tokenId: 'solana',
            selectedRef: { id: 'solana', chainId: 'solana-mainnet', address: 'native' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(network.currentNetwork.chainId).toBe('solana-mainnet')
        expect(crypto.sendAsset.chainId).toBe('solana-mainnet')
        expect(page.currentPage).toBe('send')
    })

    // EVM REGRESYONU: ayni yol sayisal kimlikte tam olarak eskisi gibi calismali.
    it('EVM satiri: kimlik SAYI kalir, ethers bakiye yolu CALISIR, Gonder e gidilir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        const { app, network, crypto, page } = setup(ETH_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.token.chainId).toBe(1)
        expect(useTokenBalanceMock).toHaveBeenCalled()

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.chainId).toBe(1)
        expect(crypto.sendAsset.address).toBe('0x0')
        expect(network.currentNetwork.chainId).toBe(1)
        expect(page.currentPage).toBe('send')
    })
})

// KOD INCELEMESI (Bulgu 1 -- KRITIK): metadata'si BULUNAMAYAN bir SPL satiri.
//
// Zincir: useSolanaAssets `coingecko_id: null` yazar (metadata endpoint'i HERHANGI
// bir hatada bos Map donuyor -- bilerek) -> Home.selectToken `id: null` yazar ->
// `/getTokenDataById` reddeder -> catch yutar -> `token` NULL kalir -> Gonder
// dugmesinin `v-if`i YOK -> `crypto.sendAsset = null` -> Send.vue'nun
// `solanaMintOf` fonksiyonu (`asset?.address || SOL_NATIVE_MARKER`) null'i NATIVE
// SOL'e cevirir. Kullanici SPL satirindan geldigini sanarken SOL imzalardi.
describe('Token.vue (SSR) -- metadata SIZ SPL satiri NATIVE SOL a donusmez (Bulgu 1)', () => {
    const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
    const ROW = { id: null, chainId: 'solana-mainnet', address: MINT, decimals: 5, symbol: 'DezX...B263' }

    it('kanonik kayit COZULEMESE de Gonder e giden varlik SPL kimligini tasir', async () => {
        axiosPostMock.mockRejectedValue(new Error('Request failed with status code 400'))

        const { app, crypto, page } = setup(SOLANA_CHAIN, { tokenId: null, selectedRef: ROW })
        const captured = captureInstance(app, 'Token')
        await render(app)

        // Kok neden AYNEN duruyor: kanonik kayit yok.
        expect(captured.instance.setupState.token).toBeNull()
        // Ama ekranin/gonderimin kullandigi kayit ARTIK satirdan uretiliyor.
        expect(captured.instance.setupState.displayToken).not.toBeNull()

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset).not.toBeNull()
        expect(crypto.sendAsset.chainId).toBe('solana-mainnet')
        expect(crypto.sendAsset.address).toBe(MINT)
        expect(crypto.sendAsset.decimals).toBe(5)
        expect(crypto.sendAsset.symbol).toBe('DezX...B263')
        expect(page.currentPage).toBe('send')
    })

    // ASIL IDDIA, Send.vue'nun KENDI fonksiyonuyla olculur: bu kayit native SOL
    // OLARAK YORUMLANAMAZ.
    it('Send.vue nun solanaMintOf u bu varligi NATIVE SOL saymaz', async () => {
        axiosPostMock.mockRejectedValue(new Error('boom'))

        const { app, crypto } = setup(SOLANA_CHAIN, { tokenId: null, selectedRef: ROW })
        const captured = captureInstance(app, 'Token')
        await render(app)
        await captured.instance.setupState.selectSend()

        expect(solanaMintOf(crypto.sendAsset)).toBe(MINT)
        expect(solanaMintOf(crypto.sendAsset)).not.toBe(SOL_NATIVE_MARKER)
    })

    // ILK BOYAMANIN (yukleniyor) karsi ucu: istek BITTIKTEN sonra gecmis yoksa
    // ACIKCA "yok" denir. Ilk boyama tarafi TokenChartState.ssr.test.js'te.
    it('grafik "yukleniyor" da TAKILI KALMAZ, fiyat gecmisi YOK der', async () => {
        axiosPostMock.mockRejectedValue(new Error('boom'))

        const { app } = setup(SOLANA_CHAIN, { tokenId: null, selectedRef: ROW })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.loaded).toBe(true)
        expect(html).toContain('No price history for this token.')
        expect(html).not.toContain('Chart Loading')
        // Satirin kimligi ekranda GORUNUR (isimsiz ekran degil).
        expect(html).toContain('DezX...B263')
    })

    // Kayit COZULURSE grafik dali secilir: yukleme mesaji YOK ve karar
    // `coingecko_id` uzerinden veriliyor.
    //
    // NOT: "No price history..." metni burada ARANMAZ -- CryptoChart.vue AYNI
    // i18n anahtarini KENDI bos-veri durumu icin de kullaniyor ve bu SSR
    // ortaminda fiyat gecmisi hic cekilmiyor. Yani o metnin varligi bu testte
    // hangi dalin secildigini AYIRT ETMEZ.
    it('kayit cozulunce grafik dali secilir, yukleme mesaji kalmaz', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'solana' }) } })

        const { app } = setup(SOLANA_CHAIN, {
            tokenId: 'solana',
            selectedRef: { id: 'solana', chainId: 'solana-mainnet', address: 'native', decimals: 9 },
        })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.loaded).toBe(true)
        expect(captured.instance.setupState.displayToken.coingecko_id).toBe('solana')
        expect(html).not.toContain('Chart Loading')
    })

    // Ortada satir da yoksa gidilecek durust bir kimlik YOKTUR: bos bir Gonder
    // formu acmak duzeltilen arizanin ta kendisi.
    it('satir HIC yoksa Gonder e GIDILMEZ', async () => {
        axiosPostMock.mockRejectedValue(new Error('boom'))

        const { app, crypto, page } = setup(SOLANA_CHAIN, { tokenId: null, selectedRef: null })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset).toBeNull()
        expect(page.currentPage).not.toBe('send')
    })

    // EVM REGRESYONU: kanonik kayit yuklenemediginde Takas/Kopru'nun kaynagi
    // DEGISMEDI -- `token.value` hala null gider (Swap kendi native tohumuna duser).
    it('EVM de kayit yuklenemezse swap.inToken HALA null (davranis degismedi)', async () => {
        axiosPostMock.mockResolvedValue({ status: 500, data: {} })

        const { app, crypto } = setup(ETH_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSwap()
        expect(crypto.swap.inToken).toBeNull()
    })
})

// KOD INCELEMESI (Task 16b): Send.vue'nun USD tahmini `crypto.sendAsset?.market?.priceUSD`
// okur ama bu ekran fiyati HEP `market_data` alaninda tutuyordu (bkz. sablondaki
// `displayToken?.market_data...`) ve Gonder'e devrederken bu alan HICBIR ZAMAN
// `.market`e KOPYALANMIYORDU. Home -> Token -> Gonder yoluyla ulasilan HER
// varlikta (EVM DAHIL) tahmin daima $0.00 gorunuyordu -- Solana'ya OZGU bir
// bozukluk degil, ama Solana SPL akisinda fark edildi (useSolanaAssets
// satirlarinin `market` alani hic tasimamasi ayni SEMPTOMU -- $0.00 tahmini --
// uretiyordu).
describe('Token.vue (SSR) -- Gonder e devredilen varlik dogru fiyati tasir (Task 16b)', () => {
    it('EVM: kanonik kayittaki market_data artik .market olarak da tasinir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'usd-coin' }) } })

        const { app, crypto } = setup(ETH_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.market).toEqual(mockTokenRecord().market_data)
        expect(crypto.sendAsset.market.priceUSD).toBe(1)
    })

    it('Solana: metadata BULUNAN bir token icin GERCEK fiyat .market uzerinden Gonder e ulasir', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({ coingecko_id: 'usd-coin', symbol: 'usdc', market_data: { ...mockTokenRecord().market_data, priceUSD: 0.999 } }) },
        })

        const { app, crypto } = setup(SOLANA_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 'solana-mainnet', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.market.priceUSD).toBe(0.999)
    })

    // Metadata'si olmayan bir SPL icin GERCEKTEN bilinen bir fiyat YOK --
    // burada $0.00 YALAN degil, tek dogru cevap: uydurulmus bir fiyat
    // GOSTERMEMEK de ayni derecede onemli.
    it('Solana: metadata BULUNAMAYAN SPL icin market HALA tam sekilli ama fiyati sifir (uydurulmaz)', async () => {
        axiosPostMock.mockRejectedValue(new Error('no canonical record'))
        const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

        const { app, crypto } = setup(SOLANA_CHAIN, {
            tokenId: null,
            selectedRef: { id: null, chainId: 'solana-mainnet', address: MINT, decimals: 5, symbol: 'DezX...B263' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.market).toBeTruthy()
        expect(crypto.sendAsset.market.priceUSD).toBe(0)
    })
})

// KOD INCELEMESI (Bulgu 4 + B): COZULEMEYEN ama BOS OLMAYAN bir chainId ('abc').
//
// Bir ara surumde olcut yalnizca BOSLUK kontroluydu; bu, 'abc'yi "beyan edilmis
// kimlik" sayiyor, `tokenChainRecord` null'a dusuyor (dugmeler kayboluyor) ve
// `ensureChain` false donup GONDER'i ISLEVSIZ birakiyordu. assetChain.js ise AYNI
// degeri bilerek MUAF sayiyor. Iki yer artik `isResolvableChainId`ten okuyor;
// asagisi EVM davranisinin TUR ONCESIYLE ayni oldugunu kilitler.
describe('Token.vue (SSR) -- cozulemeyen METIN chainId EVM davranisini BOZMAZ (Bulgu B)', () => {
    const ABC = { id: 'usd-coin', chainId: 'abc', address: '0xAbCdEf0000000000000000000000000000000009' }

    it('kayit AKTIF aga duser: Swap/Kopru GORUNUR kalir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        const { app } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: ABC })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        // Takas/Kopru dugmelerini SUREN kapi `canSwap`/`canBridge`
        // (chainSupportsFlow); `features` yalnizca ATS/Al/dapp icindir ve
        // `swap`/`bridge` alanlari evmGates.js'ten KALDIRILDI -- uretimde
        // okuyuculari yoktu, yani buradaki eski iddia dugme kaybolsa bile
        // yesil kalabilirdi.
        expect(captured.instance.setupState.canSwap).toBe(true)
        expect(captured.instance.setupState.canBridge).toBe(true)
        expect(captured.instance.setupState.features).toEqual({ ats: true, buy: true, dapp: true })
        expect(html).toContain('>Swap<')
    })

    it('Gonder CALISIR ve ag DEGISMEZ (kimlik cozulemedi -> aktif agda kalinir)', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        const { app, network, crypto, page } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: ABC })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSend()

        expect(page.currentPage).toBe('send')
        expect(crypto.sendAsset).not.toBeNull()
        expect(network.currentNetwork.chainId).toBe(1)
        // pickedRef 'abc'yi REDDEDER: kayit kanonik kalir, satirin adresi YAPISMAZ.
        expect(captured.instance.setupState.token.chainId).toBeUndefined()
    })
})

// MOONPAY EKRANDA GIZLI (utils/onrampConfig.js ONRAMP_ENABLED).
//
// Yukaridaki testler ZINCIR kapisini olcmeye devam ediyor - `features` nesnesi
// hala `buy: true/false` iddia ediyor. Ama dugmenin CIZILIP cizilmedigi artik
// AYRI bir soru: zincir "evet" derken bayrak "hayir" diyor. Bu yuzden HTML'deki
// gorunurluk iddialari oradan alinip buraya, tek bir yere toplandi. Basliklardan
// da "Al-Sat" cikarildi: o testler artik Al dugmesinin cizimini olcmuyor.
describe('Token.vue (SSR) -- Al dugmesi onramp bayragina bagli', () => {
    it('zincir kapisi ACIK olsa bile dugme CIZILMEZ', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord() } })

        const { app } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' } })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        // KAPININ ACIK OLDUGUNU ONCE DOGRULA. Aksi halde bu test, dugmeyi
        // zincir kapisi gizlediginde de yesil kalirdi - yani yokluk tarafindan
        // tatmin edilen bir iddia olurdu ve hicbir sey olcmezdi.
        expect(captured.instance.setupState.features.buy).toBe(true)
        expect(html).not.toContain('>Buy<')

        // Komsu dugmeler ETKILENMEDI: kapi yalnizca Al'a ait.
        expect(html).toContain('>Swap<')
        expect(html).toContain('>Send<')
    })
})

// SENKRON NOTU (origin/main 55f832b ile birlesme): MoonPay ekranda GLOBAL
// olarak gizlendi (utils/onrampConfig.js ONRAMP_ENABLED), yani '>Buy<' artik
// HICBIR halde render EDILMEZ. Asagidaki testler ZINCIR KAPISINI olcuyor, cizimi
// degil -- bu yuzden Al iddialari `features.buy` uzerinden yazildi. HTML iddiasi
// birakilsaydi: negatif olanlar YOKLUK tarafindan tatmin edilip hicbir sey
// olcmez, pozitif olan ise bayrak yuzunden KIRILIRDI. Cizim sorusu yukaridaki
// 'Al dugmesi onramp bayragina bagli' describe'inda TEK yerde duruyor.
// KOD INCELEMESI (birlesme sonrasi tur): kapinin FAIL-OPEN yuzu.
//
// `tokenChainRecord` yalnizca KANONIK kayda (`token.value`) bakiyordu ve o kayit
// cozulemedigi ANDA AKTIF AGA dusuyordu. Somut zincir: tokenScope varsayilani "Tum
// Aglar" + aktif ag Ethereum + metadata'si OLMAYAN bir SPL satiri -> coingecko_id
// null -> props.id null -> /getTokenDataById reddeder -> token.value null ->
// tokenChainRecord = ETHEREUM kaydi -> o SOLANA satirinda Takas/Kopru/Al ACIK.
// Ustteki iki wiring dosyasinin `not.toMatch(/chainSupportsFlow\(network\.currentNetwork/)`
// iddiasi bunu GORMEZ: kod aktif agi TEK ATLAMAYLA (tokenChainRecord) okuyor.
//
// UCUNCU KAYNAK: `pickedRef()` -- yani SATIRIN kendisi (crypto.selected_token_ref).
// "Kayit HENUZ YUKLENMEDI" ile "kayit yuklenemedi AMA satirin zinciri BELLI" AYRI
// durumlardir; ayiran sey satirin BEYAN ETTIGI kimliktir:
//   - satir COZULEBILIR bir chainId tasiyorsa kapi ONU okur (aktif aga DUSMEZ),
//   - satir yoksa ya da kimligi cozulemiyorsa ('abc') aktif ag SON CARE kalir --
//     cunku o halde `ensureChain` de hicbir gecis yapmaz, yani islem GERCEKTEN
//     aktif agda calisir (Token.ssr.test.js'in 500/red/'abc' testleri bunu olcuyor).
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)

describe('Token.vue (SSR) -- kanonik kayit COZULEMEZSE kapi SATIRIN zincirini okur, aktif aga DUSMEZ', () => {
    const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
    const SPL_ROW = { id: null, chainId: 'solana-mainnet', address: MINT, decimals: 5, symbol: 'DezX...B263' }
    const TON_ROW = { id: null, chainId: -239, address: '0x0', decimals: 9, symbol: 'TON' }

    it('Ethereum AKTIF + metadata SIZ SPL satiri: Takas/Kopru/Al GIZLI, Gonder kalir', async () => {
        axiosPostMock.mockRejectedValue(new Error('no canonical record'))

        const { app } = setup(ETH_CHAIN, { tokenId: null, selectedRef: SPL_ROW })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        // Kok neden AYNEN duruyor: kanonik kayit YOK.
        expect(captured.instance.setupState.token).toBeNull()
        // Ama kapi artik SATIRIN zincirini goruyor.
        expect(captured.instance.setupState.tokenChainRecord.chainId).toBe('solana-mainnet')
        // Ayni gerekce (yukaridaki EVM iddialari): dugmeyi SUREN kapi bu.
        expect(captured.instance.setupState.canSwap).toBe(false)
        expect(captured.instance.setupState.canBridge).toBe(false)
        expect(captured.instance.setupState.features).toEqual({ ats: false, buy: false, dapp: false })
        expect(html).not.toContain('>Swap<')
        expect(html).not.toContain('>Bridge<')
        expect(html).toContain('>Send<')
        // AYNI kok nedenin ETIKET ikizi: "Ag" satiri da aktif aga dusuyordu
        // (SOLANA satirinda "Ethereum" yaziyordu).
        expect(captured.instance.setupState.assetChainName).toBe('Solana')
    })

    // AYNI satir, kanonik kayit GELSE de sonuc ayni olmali: satirin zinciri Solana.
    // (Kayit gelen yol zaten yesildi; burada iki yolun AYNI cevabi verdigi kilitlenir --
    // yoksa "kayit gelirse kapali, gelmezse acik" gibi bir davranis kalirdi.)
    it('Ethereum AKTIF + SPL satiri: kayit GELSE de GELMESE de kapi AYNI cevabi verir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: mockTokenRecord({ coingecko_id: 'usd-coin' }) } })

        const { app } = setup(ETH_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 'solana-mainnet', address: MINT, decimals: 6 },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.canSwap).toBe(false)
        expect(captured.instance.setupState.features.buy).toBe(false)
    })

    // TON satiri AYNI kok nedene sahip ama cevabi FARKLI -- ve fark tam olarak
    // chainKind.js tablosundan geliyor: TON'da takas VAR (STON.fi), kopru YOK
    // (LI.FI EVM disi tasimiyor), MoonPay TON'u kapsamiyor (evmGates).
    it('Ethereum AKTIF + kayit cozulemeyen TON satiri: Kopru/Al GIZLI, Takas ACIK', async () => {
        axiosPostMock.mockRejectedValue(new Error('no canonical record'))

        const { app } = setup(ETH_CHAIN, { tokenId: null, selectedRef: TON_ROW })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.token).toBeNull()
        expect(captured.instance.setupState.tokenChainRecord.chainId).toBe(-239)
        expect(html).toContain('>Swap<')
        expect(html).not.toContain('>Bridge<')
        // MoonPay TON'u kapsamiyor (evmGates); kapi bayrakta olculur.
        expect(captured.instance.setupState.features.buy).toBe(false)
    })

    // KAPI ILE EYLEM AYNI ZINCIRI GORMELI. Kapi artik satirin zincirine baktigina
    // gore, `ensureChain` de o zincire gecmek ZORUNDA: aksi halde TON satirinda
    // acilan Takas dugmesi kullaniciyi ETHEREUM takas ekranina gotururdu (kaydin
    // cozulemedigi durumda `token.value` null oldugu icin eski cagri HICBIR ZAMAN
    // ag degistirmiyordu).
    it('kayit cozulemeyen TON satirinda Takas ONCE agi degistirir', async () => {
        axiosPostMock.mockRejectedValue(new Error('no canonical record'))

        const { app, network, page } = setup(ETH_CHAIN, { tokenId: null, selectedRef: TON_ROW })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSwap()

        expect(network.currentNetwork.chainId).toBe(TON_CHAIN.chainId)
        expect(page.currentPage).toBe('swap')
    })

    // AYNANIN OTEKI YUZU: Solana aktifken bir EVM satiri acilirsa kapi ACILMALI
    // (F4'un iddiasi) -- ve eylem de o EVM agina gecmeli. Kayit cozulemedigi icin
    // ONCEDEN kapi SOLANA'ya (aktif aga) dusup dugmeleri gizliyordu.
    it('Solana AKTIF + kayit cozulemeyen EVM satiri: dugmeler GORUNUR', async () => {
        axiosPostMock.mockResolvedValue({ status: 500, data: {} })

        const { app } = setup(SOLANA_CHAIN, {
            tokenId: 'usd-coin',
            selectedRef: { id: 'usd-coin', chainId: 1, address: '0x0' },
        })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.token).toBeNull()
        expect(captured.instance.setupState.tokenChainRecord.chainId).toBe(1)
        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
        // Kapi ACIK; dugmenin cizilmemesi onramp bayraginin ayri kararidir.
        expect(captured.instance.setupState.features.buy).toBe(true)
    })

    // SINIR: satir HIC yoksa gidilecek baska kaynak KALMAZ ve aktif ag SON CARE'dir.
    // Bu, yukaridaki fail-closed iddiasiyla CELISMEZ: `ensureChain` de bu halde
    // hicbir gecis yapmaz, yani islem GERCEKTEN aktif agda calisir.
    it('satir HIC yoksa aktif ag SON CARE kalir (EVM de dugmeler GORUNUR)', async () => {
        axiosPostMock.mockResolvedValue({ status: 500, data: {} })

        const { app } = setup(ETH_CHAIN, { tokenId: 'usd-coin', selectedRef: null })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.tokenChainRecord.chainId).toBe(1)
        expect(html).toContain('>Swap<')
        expect(captured.instance.setupState.canSwap).toBe(true)
    })
})

// ---------------------------------------------------------------------------
// TAKAS'A DEVREDILEN VARLIK ONDALIGINI VE SEMBOLUNU KAYBEDIYORDU
//
// CANLI OLCUM (2026-09-15): POST /getTokenDataById {id:'the-open-network'} ->
//   { symbol: "ton", name: "Toncoin", address: "EQAAA...M9c" } -- `decimals` ALANI YOK.
// AYIRT EDICI KONTROL, ayni uctan ayni turda: {id:'tether'} -> `decimals: 6` VAR.
// Yani alan ucun semasinda MEVCUT, bu KAYITTA yok -- olcum bir seyi ayirt ediyor.
//
// ZINCIR: onMounted kanonik kaydi yazar; ondaligi ZINCIRDEN okuyan ERC-20 dali
// `address !== '0x0'` sartli oldugu icin NATIVE varlikta HIC calismaz ve TON kolu
// yalnizca bakiye okur -> `token.value.decimals === undefined`. `selectSwap` bu
// kaydi OLDUGU GIBI devrediyordu -> Swap.vue `message.inDecimals` undefined ->
// background `tonSwapAssets` JETTON_DECIMALS_MISSING atar -> "Teklif alinamadi".
// (Kullanicinin konsolunda BIREBIR bu hata goruldu.)
//
// AYNI KOKUN IKINCI, GORUNUR YUZU: sembol de kanonik kayittan geliyordu, yani
// Takas ekraninda cuzdanin her yerde kullandigi "GRAM" yerine "TON" yaziyordu.
//
// `selectSend` bu duzeltmeyi ZATEN almisti (Bulgu 4, yukarida); `selectSwap`
// ATLANMISTI. Dosyanin kendi ilkesi zaten bunu soyluyor (bkz. pickedRef notu):
// "KIMLIK satirdan, PIYASA VERISI kanonik kayittan" -- ondalik ve sembol KIMLIKTIR.
// ---------------------------------------------------------------------------
describe('Token.vue (SSR) -- Takas/Gonder e devredilen varlik KIMLIGINI korur', () => {
    // Satir Home.vue'nun yazdigi sey: ondalik ve sembol ORADA BILINIYOR
    // (zincir token listesi: GRAM/9 -- canli olculdu).
    const TON_ROW = { id: 'the-open-network', chainId: -239, address: '0x0', decimals: 9, symbol: 'GRAM' }
    // Kanonik kayit: ondalik YOK, sembol CoinGecko'nunki.
    const TON_CANONICAL = mockTokenRecord({
        coingecko_id: 'the-open-network', name: 'Toncoin', symbol: 'ton', address: '0x0',
    })

    const acTonEkrani = async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: TON_CANONICAL } })
        const ctx = setup(TON_CHAIN, { tokenId: 'the-open-network', selectedRef: TON_ROW })
        const captured = captureInstance(ctx.app, 'Token')
        await render(ctx.app)
        return { ...ctx, captured }
    }

    it('selectSwap: ONDALIK satirdan tasinir (kanonik kayitta YOK)', async () => {
        const { crypto, captured } = await acTonEkrani()
        // Kok nedenin KENDISI de kilitlenir: kanonik kayit gercekten ondaliksiz geliyor.
        //
        // OLCUM NOKTASI TASINDI (TON ondalik duzeltmesi, bkz. TokenTonPrice.ssr.test.js):
        // bu satir eskiden ayni seyi `setupState.token.decimals` uzerinden olcuyordu ve
        // o VEKIL artik gecerli degil -- Token.vue TON kolunda ondaligi SATIRDAN alip
        // KAYDA yaziyor (Solana dalindaki ayni desen), cunku ERC-20 `decimals()` yolu
        // bir TON adresinde duserek kayda 18 YAZIYORDU ve o deger jetton bakiyesini
        // 1e12 kat kucultuyordu. Iddia KAYNAGA tasindi ki hem kok neden kilitli kalsin
        // hem de yeni davranis (kayit artik DOGRU ondaligi tasir) olculsun.
        expect(TON_CANONICAL.decimals).toBeUndefined()
        expect(captured.instance.setupState.token.decimals).toBe(9)

        await captured.instance.setupState.selectSwap()

        expect(crypto.swap.inToken.decimals,
            'ondalik devredilmedi -> takas teklifi JETTON_DECIMALS_MISSING ile duser').toBe(9)
    })

    it('selectSwap: SEMBOL satirdan tasinir (kanonik kayit "ton" diyor)', async () => {
        const { crypto, captured } = await acTonEkrani()
        await captured.instance.setupState.selectSwap()

        expect(crypto.swap.inToken.symbol,
            'Takas ekrani cuzdanin GRAM i yerine CoinGecko nun TON unu gosteriyor').toBe('GRAM')
    })

    it('PIYASA VERISI hala KANONIK kayittan gelir (kimlik satiri her seyi ezmez)', async () => {
        const { crypto, captured } = await acTonEkrani()
        await captured.instance.setupState.selectSwap()

        expect(crypto.swap.inToken.market_data.priceUSD).toBe(1)
        expect(crypto.swap.inToken.coingecko_id).toBe('the-open-network')
        expect(crypto.swap.inToken.name).toBe('Toncoin')
    })

    it('selectSend AYNI kimligi tasir (iki ekran AYRISMAZ)', async () => {
        const { crypto, captured } = await acTonEkrani()
        await captured.instance.setupState.selectSend()

        expect(crypto.sendAsset.decimals).toBe(9)
        expect(crypto.sendAsset.symbol).toBe('GRAM')
    })

    // ONDALIK TAHMIN EDILMEZ. Satir da tasimiyorsa alan YAZILMAZ -- 18'e (ya da
    // herhangi bir varsayilana) dusmek, 9 ondalikli bir varligi 10^9 kat yanlis
    // gonderilen bir miktara cevirirdi. Bu esleme olmadan "eksikse 18 yaz" gibi
    // bir sadelestirme ustteki testlerin HEPSINI gecerdi.
    it('satir da ondalik tasimiyorsa alan UYDURULMAZ', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: TON_CANONICAL } })
        const { app, crypto } = setup(TON_CHAIN, {
            tokenId: 'the-open-network',
            selectedRef: { ...TON_ROW, decimals: undefined },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSwap()

        expect(crypto.swap.inToken.decimals).toBeUndefined()
    })

    // SATIRIN EKSIGI KANONIK KAYDI SILEMEZ -- ESLENMIS IDDIA.
    //
    // Mutasyonla olculdu: korumalari (`Number.isInteger(...) ? ... : {}` ve
    // `picked.symbol ? ... : {}`) kaldirip alanlari KOSULSUZ yazmak ustteki
    // testlerin HEPSINI gecti. Cunku oradaki kanonik kayit da o alanlari
    // tasimiyor; iki taraf da `undefined` uretiyor ve test HICBIR SEYI AYIRT
    // ETMIYOR. Ayirt eden durum budur: kanonik kayit alani TASIYOR, satir
    // tasimiyor. Kosulsuz yazim burada IYI bir degeri `undefined` ile ezer.
    //
    // Bu hayali bir durum degil: /getTokenDataById BAZI kayitlarda `decimals`
    // tasiyor (canli olcum: {id:'tether'} -> 6) ve TON zincir listesinde satirlarin
    // 18/25'i ondalik TASIMIYOR (canli olcum, ayni tur).
    it('satir alani tasimiyorsa KANONIK deger KORUNUR (undefined ile EZILMEZ)', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({
                coingecko_id: 'tether', name: 'Tether', symbol: 'usdt', decimals: 6, address: '0x0',
            }) },
        })
        const { app, crypto } = setup(TON_CHAIN, {
            tokenId: 'tether',
            selectedRef: { id: 'tether', chainId: -239, address: '0x0' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSwap()

        expect(crypto.swap.inToken.decimals, 'kanonik ondalik EZILDI').toBe(6)
        expect(crypto.swap.inToken.symbol, 'kanonik sembol EZILDI').toBe('usdt')
    })

    // GERILEME KILIDI: kanonik kayit cozulemezse Takas'a HALA null gider (yukarida
    // ayrica kilitli olan karar). Satirdan kayit URETMEK bu turun konusu DEGIL.
    it('kanonik kayit cozulemezse swap.inToken HALA null', async () => {
        axiosPostMock.mockRejectedValue(new Error('no canonical record'))
        const { app, crypto } = setup(TON_CHAIN, { tokenId: 'the-open-network', selectedRef: TON_ROW })
        const captured = captureInstance(app, 'Token')
        await render(app)

        await captured.instance.setupState.selectSwap()

        expect(crypto.swap.inToken).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// TOKEN DETAY EKRANI NATIVE VARLIGA UCUNCU TARAFIN ADINI VERIYORDU
//
// Ana ekranda satir "GRAM" yaziyor (Home.vue diskteki kayittan basiyor), satira
// basilinca acilan ekranin BASLIGI "Toncoin", rozeti "ton", "Dolasimdaki Arz"
// birimi "TON" oluyordu. Ilk boyamada satirdan uretilen kayit dogru GRAM'i
// gosterip, kanonik istek donunce ekranin GERI DONMESI hatayi gozle de
// dogrulanabilir kiliyordu.
//
// CANLI OLCUM (2026-09-17): POST /getTokenDataById {id:'the-open-network'} ->
//   { name: "Toncoin", symbol: "ton" }   (uretim DB'si CoinGecko adini tasiyor)
//
// `satirKimligiyle` (Takas/Gonder devri) bu duzeltmeyi ZATEN almisti ama ekranin
// KENDI gosterimi atlanmisti -- ustelik o yardimci `name` alanina hic dokunmuyor,
// yani baslik oradan da duzelemezdi.
// ---------------------------------------------------------------------------
describe('Token.vue (SSR) -- NATIVE varligin GORUNEN adi cuzdanindir', () => {
    const TON_ROW = { id: 'the-open-network', chainId: -239, address: '0x0', decimals: 9, symbol: 'GRAM' }
    const TON_CANONICAL = mockTokenRecord({
        coingecko_id: 'the-open-network', name: 'Toncoin', symbol: 'ton', address: '0x0',
    })

    it('kanonik kayit "Toncoin" dese de ekran GRAM gosterir', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: TON_CANONICAL } })
        const { app } = setup(TON_CHAIN, { tokenId: 'the-open-network', selectedRef: TON_ROW })
        const captured = captureInstance(app, 'Token')
        const html = await render(app)

        expect(captured.instance.setupState.displayToken.name,
            'baslik CoinGecko nun "Toncoin" unu gosteriyor').toBe('GRAM')
        expect(captured.instance.setupState.displayToken.symbol).toBe('GRAM')
        expect(html).not.toContain('Toncoin')
    })

    it('PIYASA VERISI hala KANONIK kayittan gelir (ad ezmesi her seyi ezmez)', async () => {
        axiosPostMock.mockResolvedValue({ status: 200, data: { token: TON_CANONICAL } })
        const { app } = setup(TON_CHAIN, { tokenId: 'the-open-network', selectedRef: TON_ROW })
        const captured = captureInstance(app, 'Token')
        await render(app)

        const shown = captured.instance.setupState.displayToken
        expect(shown.market_data.priceUSD).toBe(1)
        expect(shown.coingecko_id).toBe('the-open-network')
    })

    // ASIRI DUZELTME KILIDI: ezme yalnizca NATIVE varliklarda. Jetton/ERC-20
    // adlari kanonik kayitta dogrudur; kosulsuz ezme "Tether"i "USDT" yapardi.
    it('native OLMAYAN varligin kanonik adi KORUNUR', async () => {
        axiosPostMock.mockResolvedValue({
            status: 200,
            data: { token: mockTokenRecord({
                coingecko_id: 'tether', name: 'Tether', symbol: 'usdt', address: '0x0',
            }) },
        })
        const { app } = setup(TON_CHAIN, {
            tokenId: 'tether',
            selectedRef: { id: 'tether', chainId: -239, address: '0x0' },
        })
        const captured = captureInstance(app, 'Token')
        await render(app)

        expect(captured.instance.setupState.displayToken.name).toBe('Tether')
        expect(captured.instance.setupState.displayToken.symbol).toBe('usdt')
    })
})
