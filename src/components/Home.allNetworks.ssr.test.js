// Home.vue (SSR) — "Tum Aglar" kapsami Solana'yi HER IKI YONDE de icerir.
//
// KOK NEDEN (nihai inceleme, Bulgu 3): `useSolanaAssets` Home.vue'de TEK bir
// yerden, `chainVm(network.currentNetwork) === 'solana'` dalinin ICINDEN
// cagriliyordu. Yani EVM bir zincirde "Tum Aglar" seciliyken Home Solana
// bakiyesini HIC cekmiyordu: SOL satiri YOK, ice aktarilmis SPL satirlari 0.00.
// SelectAssets.vue ise AYNI EKRANIN Gonder secicisi ve kapsama baktigi icin SOL'u
// CANLI bakiyesiyle listeliyordu -- iki ekran kullanicinin SOL'u olup olmadigi
// konusunda AYRI cevaplar veriyordu.
//
// Spec'in bu gereksinim icin yazdigi gerekce zaten buydu: "Portfoy toplami eksik
// olursa kullanici parasinin kayboldugunu sanir."
//
// Bu dosya AYRICA bir EVM REGRESYON CIPASIDIR (ilk test): Solana kapsam disindayken
// EVM yolunun urettigi HER SEY (satirlar, toplam, yuzde, bakiye sozlugu, zincir
// basina RPC ucu, fiyat istegi) BIREBIR kilitlenir. Bu daldaki iki canli EVM
// gerilemesi yalnizca once/sonra olcumleriyle yakalanmisti; olcum artik testte.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
// `get` de saplaniyor: Home artik NewsStrip'i icinde tasiyor ve o bilesen
// `GET /news` cagiriyor. Saplanmazsa cagri TypeError verir, NewsStrip'in kendi
// try/catch'i onu YUTAR ve bu dosya farkinda olmadan GOMULU duyuru listesini
// render eder. Bos liste dondurerek serit hic cizilmez ve bu testler yalniz
// Home'un KENDI davranisini olcer (seridin kendisi: NewsStrip.ssr.test.js).
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))

// JsonRpcProvider SSR'da gercek bir uca baglanmamali; Home yalnizca kuruyor
// (bakiye okumasi useTokenBalance uzerinden gidiyor). Kismi mock: `ethers`in
// geri kalani (baska bilesenler kullaniyor) GERCEK kalir.
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { tokenScopeStore } from '../store/tokenScope'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const ETH = supported_chains.find((c) => c.chainId === 1)
const SOLANA = supported_chains.find((c) => c.chainId === 'solana-mainnet')

const USDT_ETH = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const USDC_POLY = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'
const SOLANA_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

// TON BIRLESMESI (origin/main -> feat/solana). Bu dosya yazildiginda Home'un
// capraz-zincir kovasi IKI kaynakliydi (ice aktarilmis EVM tokenlari + Solana
// satirlari) ve satir listesi TAM esitlikle kilitlenmisti. Birlesmeyle UCUNCU
// kaynak geldi: `loadCurrentTokens` her hesabin token haritasina TON native
// satirini `ensureTonNativeToken` ile TOHUMLAR (bkz. utils/ton/tonTokenSeed.js --
// "TON satiri buraya girmezse kullanicinin TON bakiyesi hicbir yerde gorunmez",
// tonTokenSeed.test.js bunu ayrica kilitler). Satir HESAP TIPINDEN bagimsizdir:
// TON adresi EVM hesabiyla AYNI ifadeden turer, yani bu testin EVM hesabinda da
// bulunur.
//
// Kilit GEVSETILMEDI, kovanin yeni gercegine GENISLETILDI: satir listesi hala TAM
// esitlikle karsilastiriliyor. Cipanin asil iddialari -- Solana'ya HIC ag turu
// yapilmamasi, zincir basina RPC ucu, toplam/yuzde, Solana kimliginin fiyat
// istegine GIRMEMESI -- oldugu gibi duruyor.
//
// TON satiri EVM toplamlarini KIRLETMEZ: `updateBalance` TON dalinda kasa kilitli
// oldugu icin (SSR'da WALLET_LOCKED) yalnizca `error` isaretler, `amount`/`value`
// HIC yazilmaz -- bu yuzden asagidaki `user.usd` beklentileri DEGISMEDI.
const TON_NATIVE_KEY = '-239|0x0'
// AYNI satirin BAKIYE SOZLUGUNDEKI anahtari (tokenBucketKey: alt cizgi).
const TON_BALANCE_KEY = '-239_0x0'
// Kova capraz zincir oldugu icin fiyat istegi de TON'un kimligini tasir: satir
// listede ve "Tum Aglar" toplamindaysa fiyati da cekilmelidir.
const TON_COINGECKO_ID = 'the-open-network'

const SOL_ROW = {
    chainId: 'solana-mainnet', address: 'native', symbol: 'SOL', name: 'Solana',
    decimals: 9, amount: 3, logoURI: null,
    image: { thumb: '', small: '', large: '' }, coingecko_id: 'solana',
}

const PRICES = [
    { coingecko_id: 'tether', market_data: { priceUSD: 1, change: { h24: 0.5 }, sparkline: { d7: Array(144).fill(0.99) } } },
    { coingecko_id: 'usd-coin', market_data: { priceUSD: 2, change: { h24: -1 }, sparkline: { d7: Array(144).fill(2.5) } } },
    { coingecko_id: 'solana', market_data: { priceUSD: 20, change: { h24: 3 }, sparkline: { d7: Array(144).fill(19) } } },
]

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    useTokenBalanceMock.mockImplementation(async (_owner, tokenAddress) => (tokenAddress === USDT_ETH ? 10 : 4))
    axiosPostMock.mockResolvedValue({ status: 200, data: { tokens: PRICES } })
    useSolanaAssetsMock.mockResolvedValue([SOL_ROW])
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockReset()
    useSolanaAssetsMock.mockReset()
    useTokenBalanceMock.mockReset()
    delete globalThis.chrome
})

/**
 * EVM zinciri (Ethereum) AKTIF, iki zincirde ice aktarilmis EVM tokeni var ve
 * hesabin turetilmis bir Solana adresi VAR. `filter` = kapsam pill'inin degeri.
 */
async function renderHome(filter) {
    installChromeStub({
        currentNetwork: ETH,
        active_account: {
            address: '0xAbCdEf0000000000000000000000000000000001',
            solanaAddress: SOLANA_ADDRESS,
            key: 'acc1',
        },
        imported_tokens: {
            acc1: {
                1: [{ name: 'Tether', symbol: 'usdt', decimals: 6, address: USDT_ETH, image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether' }],
                137: [{ name: 'USD Coin', symbol: 'usdc', decimals: 6, address: USDC_POLY, image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin' }],
            },
        },
        vaults: [],
    })

    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = ETH
    network.rpc = 'https://evm.example/rpc'

    tokenScopeStore().filter = filter

    const captured = captureInstance(app, 'Home')
    const html = await render(app)
    return { captured, html, user: userStore() }
}

const rowKeys = (captured) =>
    captured.instance.setupState.currentTokens.map((t) => `${t.chainId}|${t.address}`)

describe('Home.vue (SSR) -- EVM aktif, kapsam AKTIF ZINCIR (EVM regresyon cipasi)', () => {
    it('EVM yolu birebir korunur ve Solana HIC sorgulanmaz', async () => {
        const { captured, user } = await renderHome(1)

        // Solana kapsam DISINDA: tek bir ag turu bile yapilmamali.
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()

        expect(rowKeys(captured)).toEqual([
            `1|${USDT_ETH}`,
            `137|${USDC_POLY}`,
            TON_NATIVE_KEY,
        ])

        // Bakiye okumasi ZINCIR BASINA kendi ucundan yapilir (network.rpc'ye
        // DUSMEZ): bu tam olarak bu dalda bir kez kaybolmus davranistir.
        expect(useTokenBalanceMock.mock.calls).toEqual([
            ['0xAbCdEf0000000000000000000000000000000001', USDT_ETH, 'https://ethereum-rpc.publicnode.com'],
            ['0xAbCdEf0000000000000000000000000000000001', USDC_POLY, 'https://polygon-bor-rpc.publicnode.com'],
        ])

        // 10 USDT @ $1 + 4 USDC @ $2 = 18
        expect(user.usd).toBe(18)
        expect(user.tokenBalances[`1_${USDT_ETH}`]).toEqual({
            amount: 10, price: 1, change: 0.5, value: 10, nowValue: 10, oldValue: 9.9,
        })
        expect(user.tokenBalances[`137_${USDC_POLY}`]).toEqual({
            amount: 4, price: 2, change: -1, value: 8, nowValue: 8, oldValue: 10,
        })
        expect(user.percentage).toBeCloseTo(-9.54773869346733, 10)
        expect(user.percentageUSD).toBeCloseTo(-1.9, 10)

        // Fiyat istegi Solana kimligini TASIMAZ (cipanin iddiasi bu). TON kimligi
        // kovada bir SATIR oldugu icin girer -- bkz. TON_NATIVE_KEY notu.
        expect(axiosPostMock.mock.calls.map((c) => c[1].ids)).toEqual([['tether', 'usd-coin', TON_COINGECKO_ID]])
        expect(axiosPostMock.mock.calls[0][1].ids).not.toContain('solana')
    })

    it('BASKA bir EVM zinciri kapsamdayken de Solana sorgulanmaz', async () => {
        await renderHome(137)
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
    })
})

describe('Home.vue (SSR) -- EVM aktif + "Tum Aglar": Solana portfoye GIRER (Bulgu 3)', () => {
    it('SOL satiri CANLI bakiyesiyle listede ve toplama SAYILIR', async () => {
        const { captured, user } = await renderHome('all')

        // Adres, hesaptaki hazir alandan cozuldu; ek bir mesaj turu gerekmedi.
        expect(useSolanaAssetsMock).toHaveBeenCalledWith(SOLANA_ADDRESS)

        // SOL satiri EVM satirlarini (ve TON native satirini) SILMEDEN eklenir --
        // birlesim EKLER, DEGISTIRMEZ.
        expect(rowKeys(captured)).toEqual([
            `1|${USDT_ETH}`,
            `137|${USDC_POLY}`,
            TON_NATIVE_KEY,
            'solana-mainnet|native',
        ])

        // CANLI bakiye (0.00 DEGIL).
        expect(user.tokenBalances['solana-mainnet_native'].amount).toBe(3)
        expect(user.tokenBalances['solana-mainnet_native'].value).toBe(60)

        // Toplam: 18 (EVM) + 3 SOL @ $20 = 78. Bulgu 3'un ta kendisi -- eskiden 18.
        expect(user.usd).toBe(78)

        // Fiyat istegi SOL'un coingecko_id'sini de TASIMALI: tasimazsa satir
        // gorunur ama degeri 0 kalir ve toplama katkisi olmaz.
        expect(axiosPostMock.mock.calls.map((c) => c[1].ids)).toEqual([['tether', 'usd-coin', TON_COINGECKO_ID, 'solana']])

        // Solana satiri EVM bakiye okumasina GIRMEZ: rpcUrlsOf(Solana) bostur ve
        // satir network.rpc'ye duserek EVM ucuna base58 bir mint sorardi.
        const readAddresses = useTokenBalanceMock.mock.calls.map((c) => c[1])
        expect(readAddresses).toEqual([USDT_ETH, USDC_POLY])
    })

    // SelectAssets.vue ile PARITE: kapsam dogrudan Solana secildiginde de
    // (aktif zincir EVM olsa bile) satirlar cekilir.
    it('kapsam dogrudan Solana secildiginde de satirlar cekilir', async () => {
        const { captured, user } = await renderHome('solana-mainnet')

        expect(useSolanaAssetsMock).toHaveBeenCalledWith(SOLANA_ADDRESS)
        expect(rowKeys(captured)).toContain('solana-mainnet|native')
        expect(user.tokenBalances['solana-mainnet_native'].amount).toBe(3)
    })

    // Adres COZULEMEDI ("kullanicinin Solana varligi yok" ile AYNI SEY DEGIL --
    // kasa kilitli olabilir): EVM portfoyu SIFIRLA EZILMEZ.
    it('Solana adresi cozulemezse EVM portfoyu bozulmaz', async () => {
        useSolanaAssetsMock.mockResolvedValue([])
        const { user } = await renderHome('all')
        expect(user.usd).toBe(18)
    })
})

// ---------------------------------------------------------------------------
// SIMETRIK YON (birlesme incelemesi, YUKSEK): SOLANA AKTIF + "Tum Aglar".
//
// KOK NEDEN: birlesik `updateBalance`in Solana dali `applySolanaRows(rows)`
// cagirip ERKEN DONUYORDU. `applySolanaRows` YALNIZCA Solana satirlari icin
// anahtar yazar; EVM ve TON satirlarina HIC dokunulmuyordu. Ama o satirlar
// kovada (capraz zincir) DURUYOR ve "Tum Aglar" kapsaminda LISTELENIYOR:
// `user.tokenBalances[key]` HIC yazilmadigi icin sablon ne `amount` ne `error`
// buluyor ve `formatTokenAmount(undefined)` sessizce '0' basiyordu.
//
// Kullaniciya UYDURMA "0 TON / $0.00" gosteriliyordu. SOGUK ACILISTA (uzantiyi
// Solana secili acmak) onceki dongunun degeri de YOKTUR, yani "yalnizca
// tazelenmiyor" savunmasi GECERSIZ.
//
// Bu, TON tarafinin (origin/main) ACIKCA yazdigi iki kurali ihlal ediyordu:
//   (a) bakiye okunamadiysa 0 GOSTERME, `error` isaretle;
//   (b) TON kendi yolundan (ensureTonAddress + getTonBalance) okunur.
// HEAD^2'deki dongu bunu AKTIF AGDAN BAGIMSIZ yapiyordu -- ayni mantik Solana
// dalinda da kosmali.
describe('Home.vue (SSR) -- SOLANA aktif + "Tum Aglar": EVM/TON satirlari UYDURMA 0 GOSTERMEZ', () => {
    async function renderHomeOnSolana() {
        installChromeStub({
            currentNetwork: SOLANA,
            active_account: {
                address: '0xAbCdEf0000000000000000000000000000000001',
                solanaAddress: SOLANA_ADDRESS,
                key: 'acc1',
            },
            imported_tokens: {
                acc1: {
                    1: [{ name: 'Tether', symbol: 'usdt', decimals: 6, address: USDT_ETH, image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether' }],
                    137: [{ name: 'USD Coin', symbol: 'usdc', decimals: 6, address: USDC_POLY, image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin' }],
                },
            },
            vaults: [],
        })

        const app = createApp(Home, { props: { embedded: false } })
        app.use(createTestPinia())
        app.use(createTestI18n())

        const network = networkStore()
        network.currentNetwork = SOLANA
        // Kullanici Ethereum'dan Solana'ya gecti: Solana kaydinda `rpc` YOK,
        // setRpc cagrilmaz ve `network.rpc` ONCEKI zincirin ucunda BAYAT kalir.
        // Asagidaki uc iddiasi bu bayat degerin KULLANILMADIGINI da olcer.
        network.rpc = 'https://stale-evm.example/rpc'

        tokenScopeStore().filter = 'all'

        const captured = captureInstance(app, 'Home')
        const html = await render(app)
        return { captured, html, user: userStore() }
    }

    it('EVM satirlari KENDI ucundan CANLI okunur ve toplama girer', async () => {
        const { captured, user } = await renderHomeOnSolana()

        // Liste capraz zincir: EVM + TON tohumu + canli Solana satiri.
        expect(rowKeys(captured)).toEqual([
            `1|${USDT_ETH}`,
            `137|${USDC_POLY}`,
            TON_NATIVE_KEY,
            'solana-mainnet|native',
        ])

        // Bakiye ZINCIR BASINA kendi ucundan okunur -- bayat `network.rpc`
        // KULLANILMAZ ve base58 bir mint EVM ucuna SORULMAZ.
        expect(useTokenBalanceMock.mock.calls).toEqual([
            ['0xAbCdEf0000000000000000000000000000000001', USDT_ETH, 'https://ethereum-rpc.publicnode.com'],
            ['0xAbCdEf0000000000000000000000000000000001', USDC_POLY, 'https://polygon-bor-rpc.publicnode.com'],
        ])

        expect(user.tokenBalances[`1_${USDT_ETH}`]).toEqual({
            amount: 10, price: 1, change: 0.5, value: 10, nowValue: 10, oldValue: 9.9,
        })
        expect(user.tokenBalances[`137_${USDC_POLY}`]).toEqual({
            amount: 4, price: 2, change: -1, value: 8, nowValue: 8, oldValue: 10,
        })

        // 10 USDT @ $1 + 4 USDC @ $2 + 3 SOL @ $20 = 78. Bulgunun ta kendisi --
        // eskiden 60 (yalniz Solana) cikiyordu.
        expect(user.usd).toBe(78)
    })

    it('TON satiri okunamadiysa `error` isaretlenir -- UYDURMA 0 YAZILMAZ', async () => {
        const { html, user } = await renderHomeOnSolana()

        // SSR'da kasa kilitli (vaults bos, oturum ana anahtari yok):
        // ensureTonAddress FIRLATIR. Kural: `amount` HIC atanmaz, `error` konur.
        expect(user.tokenBalances[TON_BALANCE_KEY]).toEqual({ error: true })
        expect(user.tokenBalances[TON_BALANCE_KEY].amount).toBeUndefined()

        // Sablon `error` bayragina bakip "—" basar; "0 TON" GORUNMEMELI.
        expect(html).toContain('— TON')
        expect(html).not.toContain('0 TON')
    })

    it('fiyat istegi TUM satirlarin kimligini tasir (EVM + TON + Solana)', async () => {
        await renderHomeOnSolana()
        expect(axiosPostMock.mock.calls.map((c) => c[1].ids)).toEqual([
            ['tether', 'usd-coin', TON_COINGECKO_ID, 'solana'],
        ])
    })
})

// ---------------------------------------------------------------------------
// AYNI BULGUNUN IKINCI YUZU: Solana satirlari OKUNAMAZSA ne olur?
//
// Erken donusun kaldirilmasi tek basina yetmiyordu -- dal `if (!rows) return`
// ile de cikiyordu. O yol tam olarak bulgunun tarif ettigi SOGUK ACILIS
// senaryosudur: kasa kilitliyken SOLANA_GET_ADDRESS hata doner, `rows` null olur
// ve TON/EVM satirlari yine hic okunmadan "0" gorunurdu.
//
// Simetrik kural da burada olculuyor: Solana satirlari OKUNAMADIYSA onlar da
// UYDURMA 0 gostermez, `error` isaretlenir (ice aktarilmis SPL yer tutuculari
// dahil). "Okunamadi" (null) ile "kullanicinin Solana varligi yok" (bos dizi)
// AYNI SEY DEGILDIR.
describe('Home.vue (SSR) -- Solana OKUNAMADI: diger VM satirlari yine de okunur', () => {
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    function install({ solanaAddress }) {
        installChromeStub({
            currentNetwork: SOLANA,
            active_account: solanaAddress
                ? { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress, key: 'acc1' }
                : { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            imported_tokens: {
                acc1: {
                    1: [{ name: 'Tether', symbol: 'usdt', decimals: 6, address: USDT_ETH, image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether' }],
                    137: [{ name: 'USD Coin', symbol: 'usdc', decimals: 6, address: USDC_POLY, image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin' }],
                    // ImportToken.vue'nun yazdigi SPL yer tutucusu (amount:0).
                    'solana-mainnet': [{
                        name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
                    }],
                },
            },
            vaults: [],
        })
    }

    async function renderOnSolana() {
        const app = createApp(Home, { props: { embedded: false } })
        app.use(createTestPinia())
        app.use(createTestI18n())

        const network = networkStore()
        network.currentNetwork = SOLANA
        network.rpc = 'https://stale-evm.example/rpc'
        tokenScopeStore().filter = 'all'

        const captured = captureInstance(app, 'Home')
        const html = await render(app)
        return { captured, html, user: userStore() }
    }

    // ADRES COZULEMEDI: hesapta hazir `solanaAddress` yok ve SOLANA_GET_ADDRESS
    // hata donuyor (installChromeStub'in varsayilani). Eski kod burada
    // `if (!rows) return` ile cikiyordu.
    it('adres cozulemezse EVM/TON satirlari YINE DE okunur', async () => {
        install({ solanaAddress: null })
        const { user } = await renderOnSolana()

        expect(useSolanaAssetsMock).not.toHaveBeenCalled()

        // EVM satirlari CANLI okundu (eskiden hicbiri okunmuyordu).
        expect(user.tokenBalances[`1_${USDT_ETH}`].amount).toBe(10)
        expect(user.tokenBalances[`137_${USDC_POLY}`].amount).toBe(4)
        expect(user.usd).toBe(18)

        // TON: kasa kilitli -> `error`, `amount` YOK.
        expect(user.tokenBalances[TON_BALANCE_KEY]).toEqual({ error: true })
    })

    // SIMETRIK KURAL: okunamayan Solana satiri da "0" gostermez.
    it('okunamayan Solana satiri UYDURMA 0 degil `error` gosterir', async () => {
        install({ solanaAddress: null })
        const { html, user } = await renderOnSolana()

        // Ice aktarilmis SPL yer tutucusu: bakiye OKUNAMADI, `amount` YAZILMAZ.
        expect(user.tokenBalances[`solana-mainnet_${MINT}`]).toEqual({ error: true })

        // Ayrica: yer tutucu EVM bakiye dongusune GIRMEDI. Girseydi rpcPath bayat
        // `network.rpc`ye duser ve EVM ucuna base58 bir mint sorulurdu (mock 4
        // dondururdu, yani yukaridaki `error` iddiasi da coker).
        const readAddresses = useTokenBalanceMock.mock.calls.map((c) => c[1])
        expect(readAddresses).toEqual([USDT_ETH, USDC_POLY])

        // Ekranda o satir "— USDC" basar (miktar yerine tire). Ciplak
        // `not.toContain('0 USDC')` ISE YARAMAZ: Polygon USDC satiri "4.0000 USDC"
        // basiyor ve o dize de '0 USDC' iceriyor.
        expect(html).toContain('— USDC')
    })

    // Solana RPC'si FIRLATTI: hata disaridaki genel catch'e dusseydi BUTUN
    // portfoy (EVM + TON dahil) okunmadan kalirdi.
    it('Solana cagrisi FIRLATSA bile EVM/TON portfoyu okunur', async () => {
        install({ solanaAddress: SOLANA_ADDRESS })
        useSolanaAssetsMock.mockRejectedValue(new Error('SOLANA_RPC_DOWN'))

        const { user } = await renderOnSolana()

        expect(useSolanaAssetsMock).toHaveBeenCalledWith(SOLANA_ADDRESS)
        expect(user.tokenBalances[`1_${USDT_ETH}`].amount).toBe(10)
        expect(user.usd).toBe(18)
        expect(user.tokenBalances[TON_BALANCE_KEY]).toEqual({ error: true })
        expect(user.tokenBalances[`solana-mainnet_${MINT}`]).toEqual({ error: true })
    })
})

// SIMETRIK YON (bulgunun "DIKKAT" maddesi): EVM AKTIF + "Tum Aglar" iken Solana
// satirlari ne oluyor? Canli okuma yolu Home.allNetworks'un ilk blogunda zaten
// kilitli; burada kilitlenen OKUNAMAMA halidir -- ayni kural EVM aktifken de
// gecerli olmali.
describe('Home.vue (SSR) -- EVM aktif + "Tum Aglar": okunamayan Solana satiri "0" GOSTERMEZ', () => {
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    it('adres cozulemezse ice aktarilmis SPL satiri `error` isaretlenir', async () => {
        installChromeStub({
            currentNetwork: ETH,
            // `solanaAddress` YOK -> SOLANA_GET_ADDRESS hata doner.
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            imported_tokens: {
                acc1: {
                    1: [{ name: 'Tether', symbol: 'usdt', decimals: 6, address: USDT_ETH, image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether' }],
                    'solana-mainnet': [{
                        name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
                    }],
                },
            },
            vaults: [],
        })

        const app = createApp(Home, { props: { embedded: false } })
        app.use(createTestPinia())
        app.use(createTestI18n())

        const network = networkStore()
        network.currentNetwork = ETH
        network.rpc = 'https://evm.example/rpc'
        tokenScopeStore().filter = 'all'

        captureInstance(app, 'Home')
        await render(app)
        const user = userStore()

        expect(user.tokenBalances[`solana-mainnet_${MINT}`]).toEqual({ error: true })
        // EVM tarafi bundan ETKILENMEZ.
        expect(user.tokenBalances[`1_${USDT_ETH}`].amount).toBe(10)
        expect(user.usd).toBe(10)
    })
})

// ---------------------------------------------------------------------------
// BAYAT DEGER SILME: markSolanaRowsUnread'in `delete value/nowValue/oldValue`
// satirlari (Home.vue:697-699).
//
// Yukaridaki "okunamayan Solana satiri UYDURMA 0 degil `error` gosterir" testi
// SOGUK durumdan baslar: sozlukte o anahtar HIC yoktur, silinecek bir sey de
// yoktur. Bu blok BAYAT durumdan baslar: satir ONCEKI turda BASARIYLA okunmus,
// `value/nowValue/oldValue` sozlukte DOLUDUR, sonraki turda okuma DUSER.
//
// Ayrimin gorunur oldugu yer sozluk degil EKRAN: `error` bayragi satiri "-"
// yapar (Home.vue:161/166), ama TOPLAM bakiye SOZLUGUNU gezer. Bayat `value`
// birakilirsa kullanici "okunamadi" isaretli bir satir gorurken baslikta o
// satirin parasi HALA sayiliyor olur -- ekran ile toplam birbirini YALANLAR.
//
// Toplami GERCEKTEN kim hesapliyor? IKI ayri tuketici var ve ikisi de bu blokta
// olculuyor:
//   (1) `filteredUsd` / `filteredPercentageInfo` (Home.vue:447/457) -- kapsam
//       pill'i BELIRLI bir agdaysa baslik dogrudan sozlukten toplar. EN KISA
//       yol: TEK bir basarisiz tur yeter.
//   (2) `applySolanaRows`in toplam dongusu (Home.vue:1033) -- JSDoc'un gerekce
//       olarak gosterdigi tuketici. AYNI turda ULASILAMAZ (`rows` ya null ya
//       dolu; markSolanaRowsUnread ile applySolanaRows birbirini disliyor) ama
//       TURLAR ARASI ULASILABILIR: basarili -> basarisiz -> basarili dizisinde
//       ucuncu tur toplami sozlukten YENIDEN hesaplar. Ucuncu test bunu olcer,
//       yani JSDoc'un gerekcesi OLU DEGIL, yalnizca tek turda gorunmuyor.
describe('Home.vue (SSR) -- Solana okumasi DUSTUGUNDE bayat deger toplamdan da DUSER', () => {
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const SPL_KEY = `solana-mainnet_${MINT}`

    // useSolanaAssets'in CANLI dondurdugu satir: ayni mint, gercek bakiyeyle.
    const SPL_ROW = {
        chainId: 'solana-mainnet', address: MINT, symbol: 'usdc', name: 'USD Coin',
        decimals: 6, amount: 5, logoURI: null,
        image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
    }

    function install() {
        installChromeStub({
            currentNetwork: SOLANA,
            active_account: {
                address: '0xAbCdEf0000000000000000000000000000000001',
                solanaAddress: SOLANA_ADDRESS,
                key: 'acc1',
            },
            imported_tokens: {
                acc1: {
                    1: [{ name: 'Tether', symbol: 'usdt', decimals: 6, address: USDT_ETH, image: { thumb: '', small: '', large: '' }, coingecko_id: 'tether' }],
                    // ImportToken.vue'nun yazdigi SPL yer tutucusu: canli satir
                    // gelmese bile listede KALIR, yani bayat degeri de tasiyabilir.
                    'solana-mainnet': [{
                        name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
                    }],
                },
            },
            vaults: [],
        })
    }

    /**
     * Aktif ag SOLANA secilir. Bu KASITLI: `loadCurrentTokens` bakiye sozlugunu
     * yalnizca EVM/TON aktifken siler (Home.vue:622), yani "onceki turun
     * degerleri sozlukte duruyor" durumu tam olarak bu agda GERCEKTIR.
     */
    async function renderOnSolana(filter, seed) {
        const app = createApp(Home, { props: { embedded: false } })
        app.use(createTestPinia())
        app.use(createTestI18n())

        const network = networkStore()
        network.currentNetwork = SOLANA
        network.rpc = 'https://stale-evm.example/rpc'
        tokenScopeStore().filter = filter

        // ONCEKI turdan devreden sozluk (yalnizca ilk testte kullanilir; digerleri
        // bayat degeri GERCEK bir basarili turla uretir).
        if (seed) Object.assign(userStore().tokenBalances, seed)

        const captured = captureInstance(app, 'Home')
        const html = await render(app)
        return { captured, html, user: userStore() }
    }

    // Tek turda olculebilen en dogrudan celiski: satir ekranda "-", baslik ise
    // bayat degeri sayiyor. Sozluk ONCEKI turdan devredilmis gibi kuruluyor
    // (aktif ag Solana oldugu icin bu devir GERCEKTEN oluyor).
    it('ekranda "-" gosterilen satir baslik toplamina KATILMAZ', async () => {
        install()
        useSolanaAssetsMock.mockRejectedValue(new Error('SOLANA_RPC_DOWN'))

        const { captured, html, user } = await renderOnSolana('solana-mainnet', {
            [SPL_KEY]: { amount: 5, price: 2, change: -1, value: 10, nowValue: 10, oldValue: 12.5 },
        })

        // `amount` BILEREK durur (sablonda `error` zaten oncelikli), fiyat/degisim
        // de metadata'dir; SILINEN yalnizca PARA alanlaridir.
        expect(user.tokenBalances[SPL_KEY]).toEqual({ amount: 5, price: 2, change: -1, error: true })

        // Satir ekranda tire basiyor.
        expect(html).toContain('— USDC')

        // ... ve baslik da onu saymiyor. Bayat `value` kalsaydi burasi 10 olurdu:
        // ekranda "okunamadi", baslikta "$10.00".
        expect(captured.instance.setupState.filteredUsd).toBe(0)
        expect(captured.instance.setupState.filteredPercentageInfo).toEqual({ pct: 0, usd: 0 })
    })

    // Ayni celiski, TOHUMSUZ: bayat deger GERCEK bir basarili turdan geliyor.
    it('gercek iki tur (okundu -> dustu): baslik toplami bayat degeri BIRAKMAZ', async () => {
        install()
        useSolanaAssetsMock.mockResolvedValue([SPL_ROW])

        const { captured, user } = await renderOnSolana('solana-mainnet')

        // 1. TUR: satir CANLI okundu -- 5 USDC @ $2 = 10.
        expect(user.tokenBalances[SPL_KEY].value).toBe(10)
        expect(captured.instance.setupState.filteredUsd).toBe(10)

        // 2. TUR: 10 saniyelik zamanlayicinin yaptigi TAM OLARAK budur --
        // `startBalanceUpdates` araliga yalnizca `updateBalance`i baglar.
        useSolanaAssetsMock.mockRejectedValue(new Error('SOLANA_RPC_DOWN'))
        await captured.instance.setupState.updateBalance()

        expect(user.tokenBalances[SPL_KEY].error).toBe(true)
        expect(user.tokenBalances[SPL_KEY].value).toBeUndefined()
        expect(user.tokenBalances[SPL_KEY].nowValue).toBeUndefined()
        expect(user.tokenBalances[SPL_KEY].oldValue).toBeUndefined()

        // 10 -> 0. Bayat deger kalsaydi baslik HIC degismezdi.
        expect(captured.instance.setupState.filteredUsd).toBe(0)
        expect(captured.instance.setupState.filteredPercentageInfo.usd).toBe(0)
    })

    // JSDoc'un gosterdigi tuketici (`applySolanaRows`in toplam dongusu) TURLAR
    // ARASI ULASILABILIR. Dizi: okundu -> dustu -> YENIDEN okundu, ama ucuncu
    // turda SPL satiri artik CANLI listede YOK (token hesabi kapandi / bakiye
    // sifira dustu). Yer tutucu satir `imported_tokens` kovasindan geldigi icin
    // listede KALIR ve toplam dongusu onu SOZLUKTEN okur.
    it('sonraki BASARILI tur da bayat degeri saymaz (applySolanaRows toplam dongusu)', async () => {
        install()
        useSolanaAssetsMock.mockResolvedValue([SOL_ROW, SPL_ROW])

        const { captured, user } = await renderOnSolana('all')

        // 1. TUR: 10 USDT @ $1 + 3 SOL @ $20 + 5 USDC @ $2 = 80.
        expect(user.usd).toBe(80)
        expect(user.tokenBalances[SPL_KEY].value).toBe(10)

        // 2. TUR: Solana RPC'si dustu -- toplam EVM'e (10) iner, Solana satirlari
        // `error`. Toplami burada EVM dongusu yazar, applySolanaRows CALISMAZ.
        useSolanaAssetsMock.mockRejectedValue(new Error('SOLANA_RPC_DOWN'))
        await captured.instance.setupState.updateBalance()
        expect(user.usd).toBe(10)

        // 3. TUR: Solana geri geldi ama YALNIZCA SOL satiriyla. Toplami artik
        // applySolanaRows hesapliyor ve `currentTokens`taki SPL yer tutucusunu
        // SOZLUKTEN okuyor.
        useSolanaAssetsMock.mockResolvedValue([SOL_ROW])
        await captured.instance.setupState.updateBalance()

        expect(user.tokenBalances[SPL_KEY].value).toBeUndefined()

        // 10 (USDT) + 60 (SOL) = 70. Bayat 10 kalsaydi 80 cikardi -- ekranda hala
        // "-" gorunen bir satir toplama para eklerdi.
        expect(user.usd).toBe(70)

        // Yuzde de AYNI sozlukten cikar: 70 - (9.9 USDT + 57 SOL) = 3.1.
        // Bayat nowValue/oldValue kalsaydi 80 - 79.4 = 0.6 olurdu.
        expect(user.percentageUSD).toBeCloseTo(3.1, 10)
    })
})
