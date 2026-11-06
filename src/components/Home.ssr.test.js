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
import { currencyStore } from '../store/currency'
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

// PARA BIRIMI (Plan B, Gorev 7): ana ekran toplami, 24 saat degisimi ve token satiri SECILI birimde.
// Veri Solana satirlariyla kurulur (useSolanaAssets + fiyat yaniti): toplam ve satir degeri gercek
// hesap yolundan (applySolanaRows) gelir, `user.usd` elle yazilmaz.
describe('Home.vue (SSR) -- secili para birimi (ana ekran)', () => {
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const SOL_ADDR = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

    // ImportToken.vue'nun yazdigi kova: ayni mint (okunamadi vakasinda satir bundan gelir).
    const IMPORTED = {
        acc1: { 'solana-mainnet': [{ name: 'USD Coin', symbol: 'usdc', decimals: 6, address: MINT, image: { thumb: '', small: '', large: '' }, coingecko_id: 'foo-coin' }] },
    }
    const row = (amount) => ({
        chainId: 'solana-mainnet', address: MINT, symbol: 'usdc', name: 'USD Coin',
        decimals: 6, amount, logoURI: null, image: { thumb: '', small: '', large: '' }, coingecko_id: 'foo-coin',
    })
    const priceReply = (price, oldPrice, h24 = 1.5) => ({
        status: 200,
        data: { tokens: [{ coingecko_id: 'foo-coin', market_data: { priceUSD: price, change: { h24 }, sparkline: { d7: Array.from({ length: 144 }, (_, i) => (i === 143 ? oldPrice : price)) } } }] },
    })

    // Boslukli biciler nbsp / dar nbsp kullanir; SSR cikti sablon yorumu tasir.
    const temiz = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/[  ]/g, ' ')
    const duz = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const baslik = (html) => {
        const m = temiz(html).match(/<span class="[^"]*leading-tight[^"]*">[\s\S]*?<button/)
        return { html: m[0], text: duz(m[0].replace(/<button$/, '')) }
    }
    const degisim24 = (html) => temiz(html).match(/duration-300">([^<]*)<\/span><span class="text-slate-400 dark:text-zinc-600 text-\[10px\]/)[1]
    const satirDegeri = (html, belirtec) => {
        const chunk = temiz(html).split('<button').find((b) => b.includes(belirtec))
        return chunk.match(/<span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">([^<]*)<\/span>/)[1]
    }

    beforeEach(() => {
        vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    })

    afterEach(() => {
        axiosPostMock.mockReset()
        axiosPostMock.mockImplementation(async () => ({ status: 200, data: { tokens: [] } }))
        useSolanaAssetsMock.mockReset()
        useSolanaAssetsMock.mockImplementation(async () => [])
    })

    /**
     * code/rate: depodaki secim ve kur (rate yoksa kur tablosu bos: USD'ye dusme). rows: canli Solana satirlari
     * (null = okunamadi). reply: fiyat yaniti (null = bos tablo). visible: false -> bakiye gizli.
     */
    async function mountHome({ code = 'usd', rate = null, locale = 'en', amount = 2, reply = priceReply(39, 36), rows, visible = true } = {}) {
        useSolanaAssetsMock.mockResolvedValue(rows === undefined ? [row(amount)] : rows)
        axiosPostMock.mockResolvedValue(reply || { status: 200, data: { tokens: [] } })
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: SOL_ADDR, key: 'acc1' },
            imported_tokens: IMPORTED,
            vaults: [],
            isBalanceVisible: visible,
        })

        const pinia = createTestPinia()
        const currency = currencyStore()
        currency.code = code
        if (rate) {
            const now = Date.now()
            currency.snapshot = { rates: { [code]: rate }, currencies: [], updatedAt: now, stale: false, fetchedAt: now }
        }

        const app = createApp(Home, { props: { embedded: false } })
        app.use(pinia)
        app.use(createTestI18n(locale))
        networkStore().currentNetwork = SOLANA_CHAIN

        const captured = captureInstance(app, 'Home')
        const html = await render(app)
        return { html, captured, user: userStore() }
    }

    it('varsayilan USD: baslik "$" + sayi, 24 sa degisim ve satir "$" ile; gizliyken ****', async () => {
        const { html, user } = await mountHome()

        expect(user.usd).toBe(78)
        const b = baslik(html)
        expect(b.text).toContain('$')
        expect(b.text).toContain('78.00')
        expect(b.html).toContain('text-[42px]')
        expect(degisim24(html)).toBe('$6.00')
        expect(satirDegeri(html, '2.0000 USDC')).toBe('$78.00')

        const gizli = await mountHome({ visible: false })
        const g = baslik(gizli.html)
        expect(g.text).toContain('$')          // sembol gizlenmez, yalniz sayi
        expect(g.text).toContain('****')
        expect(g.text).not.toContain('78.00')
        expect(degisim24(gizli.html)).toBe('***')
        expect(satirDegeri(gizli.html, 'USDC')).toBe('****')
    })

    it('depo TRY, kur 40, tr dili: baslik sayisi 3.120,00, sembol ₺ ayri kucuk span; degisim ve satir ₺', async () => {
        const { html } = await mountHome({ code: 'try', rate: 40, locale: 'tr' })

        const b = baslik(html)
        expect(b.text).toContain('3.120,00')
        expect(b.html).toContain('<span class="text-2xl text-slate-400 dark:text-zinc-500">₺</span>')
        expect(b.text).not.toContain('$')
        expect(degisim24(html)).toBe('₺240,00')
        expect(satirDegeri(html, '2.0000 USDC')).toBe('₺3.120,00')
    })

    it('24 saat degisim negatifse isaret korunur (-₺240,00)', async () => {
        const { html } = await mountHome({ code: 'try', rate: 40, locale: 'tr', reply: priceReply(39, 42) })

        expect(degisim24(html)).toBe('-₺240,00')
    })

    it('depo TRY ama kur YOK: baslik, degisim ve satir "USD" etiketli (₺ ya da eski kurla yazilmaz)', async () => {
        const { html } = await mountHome({ code: 'try', locale: 'tr' })

        const b = baslik(html)
        expect(b.text).toContain('USD')
        expect(b.text).toContain('78,00')
        expect(b.text).not.toContain('₺')
        expect(degisim24(html)).toBe('USD 6,00')
        expect(satirDegeri(html, '2.0000 USDC')).toBe('USD 78,00')
    })

    it('token satirinda value YOK (fiyat bilinmiyor): "$0.00" (bugunku davranis); okunamadi (error) "—"', async () => {
        // Fiyat tablosu bos -> applySolanaRows satiri `continue` ile atlar, value hic yazilmaz.
        const bos = await mountHome({ reply: null })
        expect(satirDegeri(bos.html, '2.0000 USDC')).toBe('$0.00')
        expect(baslik(bos.html).text).toContain('0.00')

        // Canli okuma dustu (rows null) -> markSolanaRowsUnread satiri error isaretler.
        const okunamadi = await mountHome({ rows: null })
        expect(satirDegeri(okunamadi.html, 'USDC')).toBe('—')
    })

    it('IDR, kur 16000, en dili: baslikta IDR ve 16,000,000.00, yazi boyutu 26 px (42 px DEGIL)', async () => {
        // 2 x 500 = 1000 USD -> 16.000.000 IDR
        const { html, user } = await mountHome({ code: 'idr', rate: 16000, amount: 2, reply: priceReply(500, 500) })

        expect(user.usd).toBe(1000)
        const b = baslik(html)
        expect(b.text).toContain('IDR')
        expect(b.text).toContain('16,000,000.00')
        expect(b.html).toContain('text-[26px]')
        expect(b.html).not.toContain('text-[42px]')
        expect(b.html).toContain('whitespace-nowrap')
    })

    it('gizliyken boyut GERCEK uzunluktan secilir: goz dugmesine basinca sicramaz', async () => {
        const acik = await mountHome({ code: 'idr', rate: 16000, reply: priceReply(500, 500) })
        const gizli = await mountHome({ code: 'idr', rate: 16000, reply: priceReply(500, 500), visible: false })

        expect(baslik(gizli.html).text).toContain('****')
        expect(baslik(gizli.html).html).toContain('text-[26px]')
        expect(baslik(gizli.html).html).toBe(baslik(acik.html).html.replace('16,000,000.00', '****'))
    })

    it('depo USD, 1234,56 USD: baslik 42 px kalir', async () => {
        const { html, user } = await mountHome({ amount: 2, reply: priceReply(617.28, 617.28) })

        expect(user.usd).toBeCloseTo(1234.56, 6)
        const b = baslik(html)
        expect(b.text).toContain('1,234.56')
        expect(b.html).toContain('text-[42px]')
    })

    it('sembolu sonda yazan dil (de, EUR): sayi basliga, sembol sondaki kucuk span a gider', async () => {
        const { html } = await mountHome({ code: 'eur', rate: 0.5, locale: 'de', reply: priceReply(39, 36) })

        // 2 x 39 = 78 USD x 0,5 = 39 EUR -> "39,00 €"
        const b = baslik(html)
        expect(b.text).toBe('39,00 €')
        expect(b.html).toContain('<span class="text-2xl text-slate-400 dark:text-zinc-500">€</span>')
        expect(b.html).not.toContain('<span class="text-2xl text-slate-400 dark:text-zinc-500"></span>')
    })
})
