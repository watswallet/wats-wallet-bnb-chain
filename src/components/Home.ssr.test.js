// Home.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: Task 15 oncesi Swap/Kopru hizli-eylem dugmeleri KOSULSUZ render
// ediliyordu. Kaynak-tarama bir testin (bkz. homeSolanaWiring.test.js) yakalayamayacagi
// tam da bu sinif hata: `v-if="features.swap"` yerine `v-if="true"` ya da
// `features.swap` hesaplamasinin YANLIS depoya (orn. `network.rpc`) baglanmasi,
// metin tabanli bir kaynak taramasindan kolayca kacar ama GERCEK render'da hemen
// gorunur. Bu dosya davranisa bakar: butonlar EVM'de GORUNUR, Solana'da GORUNMEZ.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js basindaki
// KULLANIM notu -- hoisting, bilesen import edilmeden ONCE devreye girmeli).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Home.vue'nun Solana dali useSolanaAssets/axios'a bakar -- bu dosyanin konusu
// DEGIL (bkz. homeSolanaWiring.test.js), o yuzden ikisi de sabit/bos donecek
// sekilde saplanir. Boylece test yalnizca BUTON GORUNURLUGUNE odaklanir.
const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

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

// Home.vue <Header> icerir ve Header.vue -> utils/dappFunctions.js zinciri
// (FIX 5, isEvmDappAddress ithali) MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir; o satir import ANINDA calisir,
// installChromeStub ise ancak test govdesinde. vi.hoisted olmadan asagidaki
// `import Home from './Home.vue'` "chrome is not defined" ile patlar (ayni
// tuzak: ConnectDapp.ssr.test.js, Header.ssr.test.js).
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { userStore } from '../store/user'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

// Header.vue (Home.vue'nun icinde) onMounted'da `document.addEventListener` cagirir
// (disari tiklamayi yakalamak icin) -- bu SSR ortaminda (jsdom/happy-dom YOK) DOM
// yok, gercek `document` de yok. Bu dosyanin konusu (buton gorunurlugu) bundan
// BAGIMSIZ; sahte bir document ile bu cagriyi zararsiz kilariz.
beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    useSolanaAssetsMock.mockClear()
    delete globalThis.chrome
})

/**
 * Pinia + i18n kurulu bir SSR uygulamasi. `network.currentNetwork` render'dan
 * ONCE senkron olarak ayarlanir -- History.ssr.test.js'teki AYNI gerekce:
 * networkStore'un kendi `initializeCurrentNetwork()`si chrome.storage'i ASENKRON
 * okur, bu yarisla CAKISMAMAK icin BURADA hem store hem installChromeStub AYNI
 * kayitla senkronize edilir.
 */
function setup(chainRecord) {
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    return { app, network }
}

describe('Home.vue (SSR) -- Swap/Kopru hizli eylemleri Solana da GIZLENIR (Task 15)', () => {
    it('EVM aktifken Swap ve Kopru dugmeleri GORUNUR', async () => {
        installChromeStub({
            currentNetwork: ETH_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            imported_tokens: {},
            vaults: [],
        })

        const { app } = setup(ETH_CHAIN)
        const captured = captureInstance(app, 'Home')
        const html = await render(app)

        expect(html).toContain('>Swap<')
        expect(html).toContain('>Bridge<')
        // Takas/Kopru dugmelerini SUREN otorite `canSwap`/`canBridge`
        // (chainSupportsFlow) -- `features` DEGIL. Onceden burada yalnizca
        // `features.swap/bridge` iddia ediliyordu ve o iki alan dugmelerle
        // hicbir zaman bagli DEGILDI (bu yuzden evmGates.js'ten kaldirildilar);
        // yani iddia yesil kalirken dugme kaybolabilirdi.
        expect(captured.instance.setupState.canSwap).toBe(true)
        // Kopru dugmesinin GORUNURLUGU iki kapinin birlesimi: `canBridge`
        // (hesap) VE `!isSolanaNetwork` (zincir) -- ikisi `bridgeActionVisible`
        // icinde birlesir, sablondaki sarmalayici da odur.
        expect(captured.instance.setupState.bridgeActionVisible).toBe(true)
        expect(captured.instance.setupState.features).toEqual({ ats: true, buy: true, dapp: true })
        // F7: dort gorunur dugme -> dort sutun.
        expect(captured.instance.setupState.quickActionGridClass).toBe('grid-cols-4')
        expect(html).toContain('class="grid-cols-4 grid gap-3 px-6 pb-8"')
    })

    it('Solana aktifken Swap ve Kopru dugmeleri GORUNMEZ, Gonder/Al kalir', async () => {
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', key: 'acc1' },
            imported_tokens: {},
            vaults: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'Home')
        const html = await render(app)

        expect(html).not.toContain('>Swap<')
        expect(html).not.toContain('>Bridge<')
        // Gonder/Al (Send/Receive) Solana'da da calisir -- EVM'e ozel DEGIL,
        // bu yuzden gizlenmemeli.
        expect(html).toContain('>Send<')
        expect(html).toContain('>Receive<')
        // Ayni gerekce (yukaridaki EVM iddiasi): dugmeyi SUREN kapi bu.
        expect(captured.instance.setupState.canSwap).toBe(false)
        expect(captured.instance.setupState.bridgeActionVisible).toBe(false)
        expect(captured.instance.setupState.features).toEqual({ ats: false, buy: false, dapp: false })
        // F7 (kod incelemesi): satir sabit `grid-cols-4` idi -- iki dugme gizlenince
        // geriye "iki dugme + iki BOS hucre" kaliyordu, bu BOZUK gorunur. Sutun
        // sayisi GORUNUR dugme sayisina uyar.
        // NOT: ciplak 'grid-cols-4' aramasi ISE YARAMAZ -- Home.vue'de bu sinifi
        // tasiyan BASKA bir izgara daha var. Hizli-eylem satirinin KENDI sinif
        // dizesi TAM olarak eslesir.
        expect(captured.instance.setupState.quickActionGridClass).toBe('grid-cols-2')
        expect(html).toContain('class="grid-cols-2 grid gap-3 px-6 pb-8"')
        expect(html).not.toContain('class="grid-cols-4 grid gap-3 px-6 pb-8"')
    })

    // TASK 16a: satirin KIMLIGI Token.vue'ye (ve oradan Gonder'e) EKSIKSIZ gecmeli.
    // `decimals` DE tasinir: Token.vue kanonik kayittan ondalik alamaz ve Solana'da
    // zincirden okuyacak bir ERC-20 `decimals()` karsiligi YOK. Ondalik yanlissa
    // createTransferCheckedInstruction islemi ZINCIRDE dusurur.
    it('selectToken satirin chainId/address/decimals ini OLDUGU GIBI tasir', async () => {
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', key: 'acc1' },
            imported_tokens: {},
            vaults: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'Home')
        await render(app)

        const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        captured.instance.setupState.selectToken({
            coingecko_id: 'usd-coin', chainId: 'solana-mainnet', address: MINT, decimals: 6,
        })

        const ref = cryptoStore().selected_token_ref
        expect(ref.chainId).toBe('solana-mainnet')
        expect(ref.address).toBe(MINT)          // base58 harf kasasi KUCULTULMEDI
        expect(ref.decimals).toBe(6)
        expect(ref.id).toBe('usd-coin')
    })

    // EVM REGRESYONU: ayni yol sayisal kimlikte eskisi gibi calisir.
    it('selectToken EVM satirinda chainId i SAYI olarak tasir', async () => {
        installChromeStub({
            currentNetwork: ETH_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1' },
            imported_tokens: {},
            vaults: [],
        })

        const { app } = setup(ETH_CHAIN)
        const captured = captureInstance(app, 'Home')
        await render(app)

        captured.instance.setupState.selectToken({
            coingecko_id: 'tether', chainId: '137', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6,
        })

        const ref = cryptoStore().selected_token_ref
        expect(ref.chainId).toBe(137)
        expect(ref.address).toBe('0xc2132D05D31c914a87C6611C10748AEb04B58e8F')
    })

    // `currentNetwork` null'a AYARLANSA bile networkStore'un kendi `initializeCurrentNetwork()`si
    // (fire-and-forget, chrome.storage'i asenkron okur) null'i "kullanilamaz" sayip
    // varsayilan bir EVM agina duser -- yani bu SENARYO burada GERCEKCI SEKILDE
    // KURULAMAZ. evmOnlyFeatures(null) durumu zaten evmGates.test.js'te dogrudan
    // (Home.vue'ye ihtiyac duymadan) kilitli.
})

// KOD INCELEMESI (Task 16b review, F1): kullanici zaten SAHIP oldugu bir SPL
// mint'ini ImportToken.vue ile ice aktarirsa, portfoy toplami o bakiyeyi IKI KEZ
// saymamali. `imported_tokens['acc1']['solana-mainnet']` (ImportToken.vue'nun
// yazdigi kova) VE `useSolanaAssets` (canli bakiye) AYNI mint icin birer satir
// dondurunce, eskiden `[...evmImportedTokens, ...rows]` ikisini de tasiyor ve
// toplam dongu (applySolanaRows) ayni tokenBucketKey'i iki kez topluyordu.
describe('Home.vue (SSR) -- ice aktarilan bir SPL mint SAHIP OLUNAN bakiyeyi IKI KEZ SAYMAZ (F1)', () => {
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    it('ayni mint hem imported_tokens hem canli bakiyede: usd TEK KEZ sayilir', async () => {
        useSolanaAssetsMock.mockResolvedValueOnce([
            {
                chainId: 'solana-mainnet', address: MINT, symbol: 'usdc', name: 'USD Coin',
                decimals: 6, amount: 12.5, logoURI: null,
                image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
            },
        ])
        axiosPostMock.mockResolvedValueOnce({
            status: 200,
            data: { tokens: [{ coingecko_id: 'usd-coin', market_data: { priceUSD: 1, change: { h24: 0 }, sparkline: { d7: [] } } }] },
        })
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', key: 'acc1' },
            // ImportToken.vue'nun yazdigi kova: AYNI mint, amount:0 yer tutucu.
            imported_tokens: {
                acc1: {
                    'solana-mainnet': [{
                        name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
                    }],
                },
            },
            vaults: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        captureInstance(app, 'Home')
        await render(app)

        const user = userStore()
        // 12.5 USDC @ $1 -- ONCEDEN iki kez sayilinca 25 cikiyordu.
        expect(user.usd).toBe(12.5)
        expect(user.usd).not.toBe(25)
    })

    // REGRESYON: kullanicinin SAHIP OLMADIGI (yalniz ice aktarilmis, canlida
    // karsiligi olmayan) bir token hala GORUNUR ve amount:0 ile listede kalir --
    // dedupeTokenRows onu SILMEMELI.
    it('SAHIP OLUNMAYAN (yalniz ice aktarilmis) bir token listede KALIR', async () => {
        const HELD_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        useSolanaAssetsMock.mockResolvedValueOnce([
            {
                chainId: 'solana-mainnet', address: HELD_MINT, symbol: 'bonk', name: 'Bonk',
                decimals: 5, amount: 100, logoURI: null,
                image: { thumb: '', small: '', large: '' }, coingecko_id: 'bonk',
            },
        ])
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', key: 'acc1' },
            imported_tokens: {
                acc1: {
                    'solana-mainnet': [{
                        name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT,
                        image: { thumb: '', small: '', large: '' }, coingecko_id: 'usd-coin',
                    }],
                },
            },
            vaults: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'Home')
        await render(app)

        // TON BIRLESMESI (origin/main -> feat/solana): bu test yazildiginda kova IKI
        // kaynakliydi (ice aktarilmis satirlar + canli Solana satirlari) ve uzunluk 2
        // ile kilitlenmisti. Birlesmeyle UCUNCU kaynak geldi: `loadCurrentTokens` her
        // hesabin token haritasina TON native satirini `ensureTonNativeToken` ile
        // TOHUMLAR (bkz. utils/ton/tonTokenSeed.js; tonTokenSeed.test.js kilitler) --
        // aktif ag Solana olsa bile, cunku kova CAPRAZ ZINCIRDIR.
        //
        // Testin ASIL iddiasi degismedi ve GEVSEMEDI: dedupeTokenRows sahip
        // OLUNMAYAN (yalniz ice aktarilmis) satiri SILMEZ. Liste artik anahtarlariyla
        // TAM esitlik uzerinden kilitleniyor -- uzunluk saymaktan daha DAR bir iddia:
        // hem MINT'in hayatta kaldigini hem de fazladan/eksik satir olmadigini gosterir.
        const rowKeys = captured.instance.setupState.currentTokens.map((t) => `${t.chainId}|${t.address}`)
        expect(rowKeys).toEqual([
            `solana-mainnet|${MINT}`,       // sahip OLUNMAYAN, yalniz ice aktarilmis: KALIR
            '-239|0x0',                     // TON native tohumu (birlesme sonrasi ucuncu kaynak)
            `solana-mainnet|${HELD_MINT}`,  // canli bakiye
        ])
    })
})
