// Home.vue (SSR) -- GIZLI MOD: yalniz gereken aglar sorgulanir (gizli-mod cok-ag spec 4.7 "Home sorgu kumesi", D6, E7,
// P11, P12, P13). Gizli Hesap aktifken ana ekran:
//   - YALNIZ secili agi (S) sorgular: bakiye turu S'nin kendi ilk RPC'sine gider, baska aglarin kovalari SORGULANMAZ;
//   - S'nin yerel coin satirini kovada yoksa kendisi uretir (Base'e gelen ETH gorunur);
//   - fiyat istegi atmaz, USD toplami / 24 sa cipi / satir USD sutunu cizmez; sirayi yerel coin + sembol A-Z yapar;
//   - Solana adresi istemez (SOLANA_GET_ADDRESS), uzak logo cizmez, gizlilik onayi popup'ini gostermez.
// Her iddianin bir KONTROL ciftı vardir: ayni ekran NORMAL modda ayni seyi yapar (yoksa "yok" iddiasi bos gecerdi).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// Onay popup'i (AnalyticsConsent) yalniz derleme bayragi aciksa cizilir; bayrak yalniz ilgili testte acilir.
const bayrak = vi.hoisted(() => ({ analytics: false }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get ANALYTICS_ENABLED() { return bayrak.analytics },
}))

const useSolanaAssetsMock = vi.fn(async () => [])
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: (...args) => useSolanaAssetsMock(...args) }))

// Zincir bakiye okumasi: hangi RPC ve zincir kimligine gidildigi kaydedilir.
const useTokenBalanceMock = vi.fn(async () => 0)
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...args) => useTokenBalanceMock(...args) }))

const axiosPostMock = vi.fn(async () => ({ status: 200, data: { tokens: [] } }))
const axiosGetMock = vi.fn(async () => ({ status: 200, data: { news: [] } }))
vi.mock('axios', () => ({
    default: {
        post: (...args) => axiosPostMock(...args),
        get: (...args) => axiosGetMock(...args),
    },
}))

// Kurulan her JsonRpcProvider'in adresi kaydedilir (Home yalniz yasam dongusu icin bir ornek tutar; ozel modda kurulmamali).
const saglayicilar = vi.hoisted(() => [])
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url; saglayicilar.push(url) } destroy() {} } }
})

// Cip tiklamasi gercek RPC hiz testi yapmasin: hangi zincir kaydiyla cagrildigi olculur.
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: (...args) => applyNetworkChangeMock(...args) }))

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { tokenScopeStore } from '../store/tokenScope'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { privateSeedRows } from '../utils/privacy/privateDefaultTokens'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const chain = (id) => supported_chains.find((c) => c.chainId === id)
const BSC = chain(56)
const ETH = chain(1)
const BASE = chain(8453)

const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap' }

const img = { thumb: '/usdc.png', small: '/usdc.png', large: '/usdc.png' }
const USDT_ETH = { name: 'Tether', symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, chain: 'ethereum', coingecko_id: null, image: img }
const POL = { name: 'POL', symbol: 'POL', address: '0x0', decimals: 18, chain: 'polygon-pos', coingecko_id: null, image: img }
const CAKE = { name: 'PancakeSwap', symbol: 'CAKE', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', decimals: 18, chain: 'binance-smart-chain', coingecko_id: null, image: img }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    setLocalLogosOnly(false)
    for (const m of [useSolanaAssetsMock, useTokenBalanceMock, axiosPostMock, axiosGetMock, applyNetworkChangeMock]) m.mockClear()
    useTokenBalanceMock.mockImplementation(async () => 0) // bakiye testleri uygulamayi degistirir: varsayilana don
    saglayicilar.length = 0
    delete globalThis.chrome
})

const mesajlar = []

/**
 * Home'u `gizli` modda (Gizli Hesap aktif, privacyStore().active true, yerel logo anahtari acik) ya da normal modda kurar
 * ve render eder. `bucket`: aktif hesabin imported_tokens kovasi. `ag`: etkin ag. `solanaAdresi` verilmezse hesapta yok.
 */
async function mountHome({ gizli, bucket, ag = BSC, solanaAdresi } = {}) {
    mesajlar.length = 0
    const hesap = gizli ? GIZLI : { ...NORMAL, ...(solanaAdresi ? { solanaAddress: solanaAdresi } : {}) }
    const stub = installChromeStub({
        currentNetwork: ag,
        active_account: hesap,
        imported_tokens: bucket === undefined ? {} : { [hesap.key]: bucket },
        vaults: [{ accounts: [NORMAL], privateAccount: GIZLI }],
    })
    stub.setSendMessage(async (msg) => { mesajlar.push(msg?.type); return {} })

    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    const network = networkStore()
    network.currentNetwork = ag
    network.rpc = ag.rpc[0].url
    privacyStore().active = gizli
    tokenScopeStore().filter = 'all' // HAM kapsam: normal modda "tum aglar", gizli modda etkin aga okunur
    setLocalLogosOnly(gizli)
    const captured = captureInstance(app, 'Home')
    const html = await render(app)
    return { html, state: captured.instance.setupState, stub }
}

const okumalar = () => useTokenBalanceMock.mock.calls.map(([, adres, rpc, chainId]) => ({ adres, rpc, chainId }))
const sembolleri = (state) => state.displayedTokens.map((t) => t.symbol)

describe('Home.vue (SSR) -- gizli modda sorgu kumesi yalniz S', () => {
    const KOVA = { 56: privateSeedRows(), 1: [USDT_ETH], 137: [POL] }

    it('KONTROL: normal modda "Tum aglar" kapsami her aginin satirini KENDI RPC sinden okur', async () => {
        await mountHome({ gizli: false, bucket: KOVA })
        const zincirler = new Set(okumalar().map((o) => o.chainId))
        expect([...zincirler].sort((a, b) => a - b)).toEqual([1, 56, 137])
    })

    it('gizli modda yalniz S (BSC) satirlari, BSC nin kendi ilk RPC sinden okunur; Ethereum ve Polygon SORGULANMAZ', async () => {
        const { state } = await mountHome({ gizli: true, bucket: KOVA })

        expect(state.scope.filter).toBe(56)
        expect(okumalar().length).toBeGreaterThan(0)
        for (const o of okumalar()) {
            expect(o.chainId).toBe(56)
            expect(o.rpc).toBe(BSC.rpc[0].url)
        }
        expect(okumalar().map((o) => o.adres.toLowerCase()).sort()).toEqual(
            privateSeedRows().map((r) => r.address.toLowerCase()).sort(),
        )
    })

    it('etkin ag Base (8453) ve kovada Base satiri YOK: yerel coin (ETH) satiri uretilir, yalniz Base sorgulanir', async () => {
        const { state } = await mountHome({ gizli: true, bucket: { 56: privateSeedRows() }, ag: BASE })

        expect(sembolleri(state)).toEqual(['ETH'])
        expect(okumalar()).toEqual([{ adres: '0x0', rpc: BASE.rpc[0].url, chainId: 8453 }])
    })

    it('S bilinmiyorsa (kapsam cozulemedi) HIC ag sorgulanmaz: fail-closed', async () => {
        const { state } = await mountHome({ gizli: true, bucket: KOVA })
        useTokenBalanceMock.mockClear()

        networkStore().currentNetwork = null
        await state.updateBalance()

        expect(okumalar()).toEqual([])
    })

    // Spec 9.9: Home'un `createProvider`i yalniz yasam dongusu icin bir ornek tutar (bakiye her satirin KENDI ucundan okunur).
    // Kurulan ornek ethers surumune gore baglanti acabilir; ozel modda hic kurulmadigi surece o soru acilmaz.
    it('KONTROL: normal modda Home yasam dongusu icin bir JsonRpcProvider kurar', async () => {
        await mountHome({ gizli: false, bucket: KOVA })
        expect(saglayicilar.length).toBeGreaterThan(0)
    })

    it('gizli modda Home HIC JsonRpcProvider kurmaz (kullanilmayan saglayici ethers surumunden bagimsiz sifir istek)', async () => {
        await mountHome({ gizli: true, bucket: KOVA })
        expect(saglayicilar).toEqual([])
    })
})

describe('Home.vue (SSR) -- gizli modda varsayilan token tohumu YEREL (P12)', () => {
    it('tohumsuz Gizli Hesap: yalniz kendi kovasina { 56: [BNB, USDC, ATS] } yazilir, sunucu tohumu ISTENMEZ', async () => {
        const { state, stub } = await mountHome({ gizli: true })

        expect(Object.keys(stub.localStore.imported_tokens)).toEqual([GIZLI.key])
        expect(Object.keys(stub.localStore.imported_tokens[GIZLI.key])).toEqual(['56'])
        expect(sembolleri(state)).toEqual(['BNB', 'ATS', 'USDC'])
        const sunucuTohumu = axiosGetMock.mock.calls.filter(([url]) => String(url).endsWith('/getImportedTokens'))
        expect(sunucuTohumu).toEqual([])
    })

    it('Gizli Hesap kovasina TON tohumu (-239) yazilmaz', async () => {
        const { stub } = await mountHome({ gizli: true })
        expect(Object.keys(stub.localStore.imported_tokens[GIZLI.key])).not.toContain('-239')
    })

    it('KONTROL: normal modda sunucu tohumu istenir', async () => {
        await mountHome({ gizli: false })
        const sunucuTohumu = axiosGetMock.mock.calls.filter(([url]) => String(url).endsWith('/getImportedTokens'))
        expect(sunucuTohumu).toHaveLength(1)
    })
})

describe('Home.vue (SSR) -- gizli modda fiyat, Solana ve USD gorunumu YOK (P11, P13)', () => {
    const fiyatIstekleri = () => axiosPostMock.mock.calls.filter(([url]) => String(url).endsWith('/getTokensDataById'))

    it('KONTROL: normal modda /getTokensDataById ATILIR', async () => {
        await mountHome({ gizli: false, bucket: { 56: [CAKE] } })
        expect(fiyatIstekleri().length).toBeGreaterThan(0)
    })

    it('gizli modda /getTokensDataById HIC atilmaz (Home asil istegi atlar; kesici burada kurulu degil)', async () => {
        await mountHome({ gizli: true, bucket: { 56: privateSeedRows() } })
        expect(fiyatIstekleri()).toEqual([])
    })

    it('KONTROL: normal modda "tum aglar" kapsami Solana adresi ister (SOLANA_GET_ADDRESS)', async () => {
        await mountHome({ gizli: false, bucket: {}, ag: ETH })
        expect(mesajlar).toContain('SOLANA_GET_ADDRESS')
    })

    it('gizli modda SOLANA_GET_ADDRESS ve Solana varlik turu YOK', async () => {
        const { state } = await mountHome({ gizli: true, bucket: { 56: privateSeedRows() } })
        expect(state.solanaInScope).toBe(false)
        expect(mesajlar).not.toContain('SOLANA_GET_ADDRESS')
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
    })

    it('KONTROL: normal modda USD toplami, 24 sa cipi ve satir USD sutunu cizilir', async () => {
        const { html } = await mountHome({ gizli: false, bucket: { 56: [CAKE] } })
        expect(html).toContain('>24H<')
        expect(html).toMatch(/\$0\.00/)
        expect(html).toContain('text-2xl text-slate-400 dark:text-zinc-500">$</span>')
    })

    it('gizli modda USD toplami, 24 sa cipi ve satir USD sutunu CIZILMEZ; goz (gorunurluk) dugmesi KALIR', async () => {
        const { html } = await mountHome({ gizli: true, bucket: { 56: privateSeedRows() } })
        expect(html).not.toContain('>24H<')
        expect(html).not.toMatch(/\$\d/)
        expect(html).not.toContain('text-2xl text-slate-400 dark:text-zinc-500">$</span>')
        // Goz dugmesi: tercih genel moddan paylasilir ve satirlardaki miktarlari da gizler; dugme olmazsa acilamazdi.
        expect(html).toMatch(/<button[^>]*data-balance-toggle[^>]*>\s*<svg/)
    })

    it('gizli modda satir sirasi: yerel coin once, sonra sembol A-Z (USD yokken bakiye siralamasi anlamsiz)', async () => {
        const { state } = await mountHome({ gizli: true, bucket: { 56: [{ ...CAKE }, ...privateSeedRows().reverse()] } })
        expect(sembolleri(state)).toEqual(['BNB', 'ATS', 'CAKE', 'USDC'])
    })
})

describe('Home.vue (SSR) -- gizli modda logolar yerel, onay popup yok (D6)', () => {
    const uzakLogolu = { name: 'Uzak', symbol: 'REMOTE', address: '0x' + '77'.repeat(20), decimals: 18, chain: 'binance-smart-chain', coingecko_id: null, image: { thumb: 'https://cdn.example/t.png', small: 'https://cdn.example/s.png', large: 'https://cdn.example/l.png' } }

    it('KONTROL: normal modda uzak logo URL i aynen cizilir', async () => {
        const { html } = await mountHome({ gizli: false, bucket: { 56: [uzakLogolu] } })
        expect(html).toContain('src="https://cdn.example/l.png"')
    })

    it('gizli modda hicbir <img src> uzak bir ana makineye gitmez (satir logosu da, ag rozeti de)', async () => {
        const { html } = await mountHome({ gizli: true, bucket: { 56: [uzakLogolu, ...privateSeedRows()] } })
        const kaynaklar = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
        expect(kaynaklar.length).toBeGreaterThan(0)
        expect(kaynaklar.filter((k) => /^(https?:)?\/\//.test(k))).toEqual([])
        // Uzak logolu, paketli logosu OLMAYAN ve bakiyesi sifir olan satir gizli modda hic cizilmez (logosuz + sifir bakiye gizlenir, sahip karari 2026-11-03).
        expect(html).not.toContain('>Uzak<')
        expect(kaynaklar).not.toContain('/default-token.png')
    })

    // LOGOSUZ SATIR KURALI (Home bir secici degil malvarligi listesidir): kesin sifir bakiyeli logosuz satir gizlenir; bakiyesi olan ya da bakiyesi
    // okunamayan logosuz satir GORUNUR kalir (para gizlenmez). Kontrol: normal modda ayni satir sifir bakiyeyle de gorunur.
    it('logosuz + sifir bakiyeli ice aktarilan token gizlenir; ayni token NORMAL modda sifir bakiyeyle de gorunur (KONTROL)', async () => {
        const gizli = await mountHome({ gizli: true, bucket: { 56: [uzakLogolu, ...privateSeedRows()] } })
        expect(sembolleri(gizli.state)).not.toContain('REMOTE')
        expect(sembolleri(gizli.state)).toEqual(expect.arrayContaining(['BNB', 'USDC', 'ATS']))
        const normal = await mountHome({ gizli: false, bucket: { 56: [uzakLogolu] } })
        expect(sembolleri(normal.state)).toContain('REMOTE')
    })

    it('logosuz ama BAKIYESI OLAN token gizli modda GORUNUR (yedek simgeyle); para gizlenmez', async () => {
        useTokenBalanceMock.mockImplementation(async (_h, adres) => (String(adres).toLowerCase() === uzakLogolu.address ? 5 : 0))
        const { html, state } = await mountHome({ gizli: true, bucket: { 56: [uzakLogolu, ...privateSeedRows()] } })
        expect(sembolleri(state)).toContain('REMOTE')
        expect(html).toContain('>Uzak<')
        expect(html).toMatch(/5\.0000 REMOTE/)
        const kaynaklar = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
        expect(kaynaklar).toContain('/default-token.png')
        expect(kaynaklar.filter((k) => /^(https?:)?\/\//.test(k))).toEqual([])
    })

    it('logosuz token bakiyesi OKUNAMAZSA gorunur kalir (belirsizlik gizlemez)', async () => {
        useTokenBalanceMock.mockImplementation(async (_h, adres) => { if (String(adres).toLowerCase() === uzakLogolu.address) throw new Error('rpc yok'); return 0 })
        const { state } = await mountHome({ gizli: true, bucket: { 56: [uzakLogolu, ...privateSeedRows()] } })
        expect(sembolleri(state)).toContain('REMOTE')
    })

    it('satir logosunun yerel yedegi var: gizli modda paketli cozucu + gizli yedek simge, normal modda TokenAvatar; ag rozeti gri yer tutucuya DUSMEZ', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./Home.vue', import.meta.url)), 'utf8')
        // Gizli mod: satir logosu TEK cozucudan (privateTokenLogo), hata verirse gizli modun kendi yedek simgesi (degismedi).
        expect(kaynak).toMatch(/v-if="privacy\.active" :src="rowLogo\(token\)"[^>]*@error="handleImageError"/)
        expect(kaynak).toMatch(/const rowLogo = \(token\) => privateTokenLogo\(\{[^}]*\}\)/)
        // Normal mod: TokenAvatar (paketli > sunucu gorseli > Trust Wallet > notr monogram); sabit yedek <img src> yok.
        expect(kaynak).toMatch(/<TokenAvatar v-else :token="token"/)
        // Zincir rozeti bir token logosu degil: yuklenemezse gizlenir.
        expect(kaynak).toMatch(/:src="getChainLogo\(token\.chainId\)"[^>]*@error="hideBrokenImage"/)
    })

    // Eski bilgilendirme karti yerine onay popup'i (AnalyticsConsent): karar yokken normal modda cizilir, Gizli Hesap
    // aktifken CIZILMEZ (gizli modda onay sorulmaz; ping ve sayac zaten kapali).
    it('KONTROL: normal modda gizlilik onayi popup cizilir; gizli modda CIZILMEZ', async () => {
        bayrak.analytics = true
        try {
            const normal = await mountHome({ gizli: false, bucket: {} })
            expect(normal.html).toContain('role="dialog"')
            expect(normal.html.replace(/&#39;/g, "'")).toContain("We've updated our privacy policy")
            const gizli = await mountHome({ gizli: true, bucket: {} })
            expect(gizli.html.replace(/&#39;/g, "'")).not.toContain("We've updated our privacy policy")
            expect(gizli.html).not.toContain('role="dialog"')
        } finally { bayrak.analytics = false }
    })
})

// KONUM (kullanici karari, 2026-10-26): gizli modda ag secici (kapsam pill'i) ve goz dugmesi bakiye alanindan Varliklar
// sekmesinin basina tasindi, normal modda yerleri degismedi; gizli moddaki "Baska aglarda kayitli varliklarin var" ipucu
// satiri (E16) kaldirildi.
describe('Home.vue (SSR) -- gizli modda ag secici ve goz dugmesi Varliklar sekmesinde; baska-ag ipucu yok', () => {
    const KOVA = { 56: privateSeedRows(), 1: [USDT_ETH], 137: [POL] }

    const konumlar = (html) => ({
        sekmeCubugu: html.indexOf('pt-5 pb-0 border-b'),
        pill: html.indexOf('relative z-30'),
        goz: html.indexOf('data-balance-toggle'),
        ilkVarlikSatiri: html.indexOf('group flex w-full items-center justify-between p-3 rounded-xl'),
    })

    // Tek pill, tek goz: iki konumdan yalniz biri cizilir.
    const tekKopya = (html) => {
        expect(html.split('relative z-30').length - 1).toBe(1)
        expect(html.split('data-balance-toggle').length - 1).toBe(1)
    }

    it('KONTROL: normal modda pill ve goz dugmesi bakiye alaninda, sekme cubugundan ONCE', async () => {
        const { html } = await mountHome({ gizli: false, bucket: KOVA })
        const k = konumlar(html)
        expect(k.sekmeCubugu).toBeGreaterThan(-1)
        expect(k.pill).toBeGreaterThan(-1)
        expect(k.pill).toBeLessThan(k.goz)
        expect(k.goz).toBeLessThan(k.sekmeCubugu)
        tekKopya(html)
    })

    it('gizli modda pill ve goz dugmesi sekme cubugundan SONRA, ilk varlik satirindan ONCE', async () => {
        const { html } = await mountHome({ gizli: true, bucket: KOVA })
        const k = konumlar(html)
        expect(k.sekmeCubugu).toBeGreaterThan(-1)
        expect(k.ilkVarlikSatiri).toBeGreaterThan(-1)
        expect(k.pill).toBeGreaterThan(k.sekmeCubugu)
        expect(k.goz).toBeGreaterThan(k.pill)
        expect(k.goz).toBeLessThan(k.ilkVarlikSatiri)
        tekKopya(html)
    })

    it('gizli modda S disinda kayitli aglar olsa da ipucu satiri CIZILMEZ ve o aglar SORGULANMAZ', async () => {
        const { html } = await mountHome({ gizli: true, bucket: KOVA })
        expect(html).not.toContain('data-other-networks')
        expect(html).not.toContain('You have assets saved on other networks')
        expect(okumalar().filter((o) => o.chainId !== 56)).toEqual([])
    })
})

// GIZLI MOD UST ALANI (kullanici karari, 2026-10-26): bakiye alaninin yerinde kalkan karti, altinda buyuk eylem
// kutulari (ust sira Gonder + Al, alt sira Para yukle + Takas + Kopru). Normal modun eylem satiri DEGISMEZ.
describe('Home.vue (SSR) -- gizli modda kalkan karti ve eylem kutulari; normal mod degismez', () => {
    const sekmeCubugu = (html) => html.indexOf('pt-5 pb-0 border-b')
    const altSira = (html) => html.match(/<div[^>]*data-private-secondary[^>]*>/)?.[0] ?? ''

    it('KONTROL: normal modda kalkan karti ve kutular YOK, eylem satiri 4 sutun', async () => {
        const { html } = await mountHome({ gizli: false, bucket: {} })
        expect(html).not.toContain('data-private-shield')
        expect(html).not.toContain('data-private-actions')
        expect(html).toContain('class="grid-cols-4 grid gap-3 px-6 pb-8"')
    })

    it('gizli modda kalkan karti uc korumayi yazar; kutulardan ve sekme cubugundan ONCE durur', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        const kart = html.indexOf('data-private-shield')
        expect(kart).toBeGreaterThan(-1)
        expect(kart).toBeLessThan(html.indexOf('data-private-actions'))
        expect(html.indexOf('data-private-actions')).toBeLessThan(sekmeCubugu(html))
        for (const metin of ['>Private mode on<', '>No on-chain link to your regular accounts<', '>Price requests off<', '>Hidden from dApps<', '>No remote images<']) {
            expect(html).toContain(metin)
        }
    })

    it('gizli modda eski eylem satiri CIZILMEZ; Gonder ve Al aciklamali kutu, alt sira Para yukle + Takas + Kopru 3 sutun', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        expect(html).not.toContain('grid gap-3 px-6 pb-8')
        const kutular = html.slice(html.indexOf('data-private-actions'), sekmeCubugu(html))
        for (const metin of ['>Send<', '>Your address stays hidden<', '>Receive<', '>Share private address<', '>Add funds<', '>Swap<', '>Bridge<']) {
            expect(kutular).toContain(metin)
        }
        expect(altSira(html)).toMatch(/\bgrid-cols-3\b/)
    })

    it('gizli modda Gonder dugmesinin altinda SilentSwap ibaresi YOK, yerine adresin gizli kalir aciklamasi var', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        const kutular = html.slice(html.indexOf('data-private-actions'), sekmeCubugu(html))
        expect(kutular).not.toContain('SilentSwap')
        expect(kutular).not.toContain('Private via')
        expect(kutular).toContain('>Send<')
        expect(kutular).toContain('>Your address stays hidden<')
        expect(kutular).toContain('>Share private address<')
    })
})

// GIZLI MOD UST ALANI, ikinci tur (kullanici karari, 2026-10-26): mor palet ve kalin, kutulu ikonlar reddedildi
// ("renklerini begenmedim, ikonlar cok ucuz duruyor"); secilen yon notr grafit + tek aile ince cizgi ikon.
describe('Home.vue (SSR) -- gizli mod ust alani grafit: mor yok, ikonlar tek kalinlik, ust yikama yok', () => {
    // Blok: kalkan kartinin ebeveyni (kok), KENDI kapanisina kadar. Altindaki NewsStrip dahil degil: gizli modda da
    // hisse disi duyurulari cizer; onun renkleri ve ikonlari bu blogun iddialarini blok degismeden bozardi.
    const blokBasi = (html) => html.lastIndexOf('<div', html.indexOf('<div data-private-shield') - 1)
    // `bas`ta acilan div'i KENDI kapanisina kadar keser.
    const diviKes = (html, bas) => {
        if (bas < 0) return ''
        const re = /<(\/?)div\b/g
        re.lastIndex = bas
        let derinlik = 0
        for (let m; (m = re.exec(html));) {
            derinlik += m[1] ? -1 : 1
            if (derinlik === 0) return html.slice(bas, m.index + '</div>'.length)
        }
        return ''
    }
    const gizliBlok = (html) => diviKes(html, blokBasi(html))
    const sekmeCubuguHtml = (html) => diviKes(html, html.lastIndexOf('<div', html.indexOf('pt-5 pb-0 border-b')))
    const YIKAMA = 'h-48 bg-linear-to-b from-indigo-500/5'

    it('gizli blokta mor ya da indigo sinifi YOK', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        const blok = gizliBlok(html)
        expect(blok).toContain('data-private-secondary')
        expect(blok).not.toMatch(/\b(violet|purple|indigo|fuchsia)-\d/)
    })

    it('gizli bloktaki ikonlar tek aile: her svg 24 izgara, dolgusuz, 1.75 cizgi; her sekil non-scaling-stroke', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        const blok = gizliBlok(html)
        const svgler = blok.match(/<svg\b[^>]*>/g) ?? []
        expect(svgler.length).toBeGreaterThanOrEqual(9)
        for (const svg of svgler) {
            expect(svg).toContain('viewBox="0 0 24 24"')
            expect(svg).toContain('fill="none"')
            expect(svg).toContain('stroke-width="1.75"')
        }
        const sekiller = blok.match(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*>/g) ?? []
        expect(sekiller.length).toBeGreaterThanOrEqual(svgler.length)
        for (const sekil of sekiller) expect(sekil).toContain('vector-effect="non-scaling-stroke"')
        // Tailwind cizgi sinifi (stroke-2, stroke-[1.5]) nitelige ragmen kalinligi ezerdi.
        expect(blok).not.toMatch(/\bstroke-(\d|\[)/)
    })

    it('gizli blogun koku konumlu (relative): varlik kartinin golgesi alt siranin ustune binmez', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        const kokEtiketi = html.slice(blokBasi(html), html.indexOf('>', blokBasi(html)) + 1)
        expect(kokEtiketi).toMatch(/class="[^"]*\brelative\b/)
    })

    it('KONTROL: normal modda Home ust yikamasi (indigo gradyan) cizilir', async () => {
        const { html } = await mountHome({ gizli: false, bucket: {} })
        expect(html).toContain(YIKAMA)
    })

    it('gizli modda Home ust yikamasi CIZILMEZ', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        expect(html).not.toContain(YIKAMA)
    })

    it('KONTROL: normal modda secili sekme indigo (yazi ve alt cizgi)', async () => {
        const { html } = await mountHome({ gizli: false, bucket: {} })
        const sekmeler = sekmeCubuguHtml(html)
        expect(sekmeler).toContain('text-indigo-600')
        expect(sekmeler).toContain('bg-indigo-500')
    })

    it('gizli modda secili sekme notr: sekme cubugunda mor ya da indigo YOK', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        const sekmeler = sekmeCubuguHtml(html)
        expect(sekmeler).toContain('Assets')
        expect(sekmeler).not.toMatch(/\b(violet|purple|indigo|fuchsia)-\d/)
    })
})

// Kapsam pill'i Home'da `scope.filter`e (store'un TURETILMIS degeri) baglanir; "ham all etkin aga okunur" kurali bu zincirin
// sonunda olculur (pill bilesenine dogrudan 56 vermek degisiklikten ONCE de yesil olurdu, bkz. NetworkScopePill.ssr.test.js).
describe('Home.vue (SSR) -- kapsam pill i gizli modda "Tum aglar" yazmaz (E7)', () => {
    const metin = (html) => html.replace(/<[^>]*>/g, ' ')

    it('KONTROL: normal modda ham all kapsaminda pill "All Networks" yazar', async () => {
        const { html } = await mountHome({ gizli: false, bucket: {} })
        expect(metin(html)).toContain('All Networks')
    })

    it('gizli modda ham all etkin aga okunur: pill "All Networks" yazmaz, etkin agin adini yazar', async () => {
        const { html } = await mountHome({ gizli: true, bucket: {} })
        expect(metin(html)).not.toContain('All Networks')
        expect(metin(html)).toContain('BNB Smart Chain')
    })
})

describe('Home.vue (SSR) -- mod Home ACIKKEN degisir (normal -> ozel)', () => {
    it('sonraki tur yalniz S okunur, fiyat istenmez ve S disindaki satirlar listeye girmez', async () => {
        const KOVA = { 56: privateSeedRows(), 1: [USDT_ETH], 137: [POL] }
        const { state, stub } = await mountHome({ gizli: false, bucket: KOVA })
        // Normal modda "Tum aglar": uc aginin satirlari listede.
        const normalZincirler = new Set(state.currentTokens.map((t) => Number(t.chainId)))
        expect([1, 56, 137].every((id) => normalZincirler.has(id))).toBe(true)

        // Arka plan Gizli Hesaba gecti: aktif hesap degisir, mod ozel moda doner (Home kapanmadan).
        stub.localStore.active_account = GIZLI
        stub.localStore.imported_tokens = { ...stub.localStore.imported_tokens, [GIZLI.key]: KOVA }
        privacyStore().active = true
        useTokenBalanceMock.mockClear()
        axiosPostMock.mockClear()

        await state.loadCurrentTokens()
        await state.updateBalance()

        expect(state.scope.filter).toBe(56)
        expect(sembolleri(state)).toEqual(['BNB', 'ATS', 'USDC'])
        expect(new Set(okumalar().map((o) => o.chainId))).toEqual(new Set([56]))
        expect(axiosPostMock.mock.calls.filter(([url]) => String(url).endsWith('/getTokensDataById'))).toEqual([])
    })
})

// PF-DD11 (kontrolcu karari): TUM gizli mod kapilari (fiyat, bakiye kumesi, provider, Solana) depodaki hesaptan her giriste
// taze okunan TEK karardan gelir; privacy.active store'u user.address izleyicisinin gerisinde kalabilir (gizlilik senkronu ayri
// bir storage.onChanged dinleyicisidir). Bu testler store ile hesabin ANLASAMADIGI iki pencereyi olcer.
describe('Home.vue (SSR) -- store ile hesap anlasamadiginda kapilar hesaba bakar (PF-DD11)', () => {
    const KOVA = { 56: privateSeedRows(), 1: [USDT_ETH], 137: [POL] }
    const fiyatIstekleri = () => axiosPostMock.mock.calls.filter(([url]) => String(url).endsWith('/getTokensDataById'))
    const zincirler = () => new Set(okumalar().map((o) => o.chainId))

    // GIRIS: depodaki hesap Gizli, ama popup'in privacy.active'i HALA false.
    async function girisPenceresi() {
        const { state, stub } = await mountHome({ gizli: false, bucket: KOVA, ag: BSC })
        stub.localStore.active_account = GIZLI
        stub.localStore.imported_tokens = { ...stub.localStore.imported_tokens, [GIZLI.key]: KOVA }
        expect(privacyStore().active).toBe(false)
        useTokenBalanceMock.mockClear()
        axiosPostMock.mockClear()
        useSolanaAssetsMock.mockClear()
        saglayicilar.length = 0
        mesajlar.length = 0
        return { state, stub }
    }

    it('GIRIS penceresi (store genel, hesap Gizli): fiyat istegi, S disi bakiye okumasi, Solana adresi/RPC si ve JsonRpcProvider YOK', async () => {
        const { state } = await girisPenceresi()

        await state.loadCurrentTokens()
        await state.updateBalance()

        expect(fiyatIstekleri()).toEqual([])
        expect(okumalar().length).toBeGreaterThan(0)
        expect(zincirler()).toEqual(new Set([56]))
        expect(mesajlar).not.toContain('SOLANA_GET_ADDRESS')
        expect(useSolanaAssetsMock).not.toHaveBeenCalled()
        expect(saglayicilar).toEqual([])
    })

    it('GIRIS penceresinde getTokensData tek basina da fiyat istegi atmaz ve fiyat tablosunu bosaltir', async () => {
        const { state } = await girisPenceresi()

        await state.getTokensData()

        expect(fiyatIstekleri()).toEqual([])
        expect(state.tokensData).toEqual([])
    })

    it('CIKIS penceresi (store Gizli, hesap normal): normal yukleme calisir -- fiyat istegi atilir, tum aglar okunur, provider kurulur', async () => {
        const { state, stub } = await mountHome({ gizli: true, bucket: KOVA, ag: BSC })
        stub.localStore.active_account = NORMAL
        stub.localStore.imported_tokens = { ...stub.localStore.imported_tokens, [NORMAL.key]: KOVA }
        expect(privacyStore().active).toBe(true)
        useTokenBalanceMock.mockClear()
        axiosPostMock.mockClear()
        saglayicilar.length = 0

        await state.loadCurrentTokens()
        await state.updateBalance()

        expect(fiyatIstekleri().length).toBeGreaterThan(0)
        expect(zincirler()).toEqual(new Set([1, 56, 137]))
        expect(saglayicilar.length).toBeGreaterThan(0)
    })

    it('depo okunamazsa (aktif hesap okunamadi) KAPALI-BASARISIZ: Gizli sayilir, fiyat istegi ve S disi okuma yok', async () => {
        const { state } = await mountHome({ gizli: false, bucket: KOVA, ag: BSC })
        useTokenBalanceMock.mockClear()
        axiosPostMock.mockClear()
        saglayicilar.length = 0
        mesajlar.length = 0
        const asil = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = async (anahtar) => {
            if (anahtar === 'active_account') throw new Error('depo okunamadi')
            return asil(anahtar)
        }

        await state.updateBalance()

        expect(fiyatIstekleri()).toEqual([])
        expect([...zincirler()].filter((id) => id !== 56)).toEqual([])
        expect(mesajlar).not.toContain('SOLANA_GET_ADDRESS')
        expect(saglayicilar).toEqual([])
    })
})

describe('Home.vue (SSR) -- bozuk / sira disi Gizli kova', () => {
    it("S kovasi bos dizi (kullanici hepsini sildi): tohum yeniden yazilmaz, yerel coin satiri yine gorunur, baska ag sorgulanmaz", async () => {
        const { state, stub } = await mountHome({ gizli: true, bucket: { 56: [], 1: [USDT_ETH] } })

        expect(sembolleri(state)).toEqual(['BNB'])
        expect(stub.localStore.imported_tokens[GIZLI.key][56]).toEqual([])
        expect(new Set(okumalar().map((o) => o.chainId))).toEqual(new Set([56]))
    })

    it("satirlarda chainId METIN ('56') olsa da S satirlari gorunur ve yalniz S okunur", async () => {
        const metinli = privateSeedRows().map((r) => ({ ...r, chainId: '56' }))
        const { state } = await mountHome({ gizli: true, bucket: { 56: metinli } })

        expect(sembolleri(state)).toEqual(['BNB', 'ATS', 'USDC'])
        expect(new Set(okumalar().map((o) => o.chainId))).toEqual(new Set([56]))
    })

    it('kova bozuk (dizi ya da nesne olmayan) ise Home firlatmaz, hicbir ag okunmaz', async () => {
        const { state } = await mountHome({ gizli: true, bucket: 'bozuk' })

        expect(Array.isArray(state.displayedTokens)).toBe(true)
        expect(okumalar().filter((o) => o.chainId !== 56)).toEqual([])
    })
})

describe('Home.vue (kaynak) -- gizli mod kapilari', () => {
    const kaynak = readFileSync(fileURLToPath(new URL('./Home.vue', import.meta.url)), 'utf8')

    it('"tum aglari goster" dugmesi ozel modda cizilmez', () => {
        expect(kaynak).toMatch(/v-if="selectedFilterNetwork !== 'all' && !privacy\.active"/)
    })
})
