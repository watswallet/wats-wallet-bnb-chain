// Home.vue (SSR) -- KAYMAK iddialari (G2: tek sekme gostergesi; G6: sekme icerigi yonlu giris; G10: yapiskan sekmeler; G11: mini bakiye seridi; sonraki gorevler genisletir).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { watch } from 'vue'
import { readFileSync } from 'node:fs'
import { yorumsuz, blokGovdesi, cagriGovdesi } from '../test-utils/kaynakTarama'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const bayrak = vi.hoisted(() => ({ analytics: false }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get ANALYTICS_ENABLED() { return bayrak.analytics },
}))
vi.mock('../composables/useSolanaAssets', () => ({ useSolanaAssets: async () => [] }))
// Bakiye okumasi ve fiyat tablosu test basina degistirilebilir (varsayilan: 0 bakiye, bos fiyat tablosu).
const ag = vi.hoisted(() => ({ bakiye: async () => 0, fiyatlar: [], ton: null }))
vi.mock('../composables/useTokenBalance', () => ({ useTokenBalance: (...a) => ag.bakiye(...a) }))
vi.mock('axios', () => ({
    default: {
        post: async () => ({ status: 200, data: { tokens: ag.fiyatlar } }),
        get: async () => ({ status: 200, data: { news: [] } }),
    },
}))
vi.mock('ethers', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, JsonRpcProvider: class { constructor(url) { this.url = url } destroy() {} } }
})
vi.mock('../utils/applyNetworkChange', () => ({ applyNetworkChange: async () => true }))
// TON yerel satiri hd hesapta kovaya her zaman tohumlanir ve testte OKUNAMAZ: tur "okunamadi" biter, toplam artik
// $0.00 degil tire (2026-11-17 hesap degisimi duzeltmesi). ag.ton verilirse TON okunur (0 bakiye), tur "okundu" biter.
vi.mock('../utils/ton/tonIdentity', async (importOriginal) => { const o = await importOriginal(); return { ...o, ensureTonAddress: async (...a) => (ag.ton ? 'UQ_TEST_ADRES' : o.ensureTonAddress(...a)) } })
vi.mock('../utils/ton/tonBalance', async (importOriginal) => { const o = await importOriginal(); return { ...o, getTonBalance: async (...a) => (ag.ton ? ag.ton(...a) : o.getTonBalance(...a)) } })

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import { privacyStore } from '../store/privacy'
import { pageStore } from '../store/pageStore'
import { tokenScopeStore } from '../store/tokenScope'
import { userStore } from '../store/user'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { createCounter } from '../utils/motion/tween'
import Home from './Home.vue'
import supported_chains from '../data/supported_chains.json'

const BSC = supported_chains.find((c) => c.chainId === 56)
const NORMAL = { address: '0xAbCdEf0000000000000000000000000000000001', key: 'acc1', type: 'hd', name: 'Hesap 1' }
const NORMAL2 = { address: '0xAbCdEf0000000000000000000000000000000002', key: 'acc2', type: 'hd', name: 'Hesap 2' }
const GIZLI = { address: '0xCcccCccc00000000000000000000000000000003', key: 'private-0xcccccccc00000000000000000000000000000003', type: 'hd', private: true, name: 'Gizli Hesap' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterEach(() => {
    vi.unstubAllGlobals()
    setLocalLogosOnly(false)
    delete globalThis.chrome
    ag.bakiye = async () => 0
    ag.fiyatlar = []
    ag.ton = null
})

async function mountHome({ gizli, bucket = {}, sayfa = {}, kapsam = 'all', digerKovalar = {}, depo = {}, onCapture } = {}) {
    const hesap = gizli ? GIZLI : NORMAL
    const stub = installChromeStub({
        currentNetwork: BSC,
        active_account: hesap,
        imported_tokens: { [hesap.key]: bucket, ...digerKovalar },
        vaults: [{ accounts: [NORMAL, NORMAL2], privateAccount: GIZLI }],
        ...depo,
    })
    stub.setSendMessage(async () => ({}))
    const app = createApp(Home, { props: { embedded: false } })
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    const network = networkStore()
    network.currentNetwork = BSC
    network.rpc = BSC.rpc[0].url
    privacyStore().active = gizli
    tokenScopeStore().filter = kapsam
    setLocalLogosOnly(gizli)
    Object.assign(pageStore(), sayfa)
    const captured = captureInstance(app, 'Home', onCapture)
    const html = await render(app)
    return { html, state: captured.instance.setupState, stub }
}

const say = (metin, parca) => metin.split(parca).length - 1
const satir = (html) => {
    const i = html.indexOf('pt-5 pb-0 border-b')
    return html.slice(i, html.indexOf('</div>', html.lastIndexOf('kaymak-gosterge')))
}

describe('Home.vue (SSR) -- tek sekme gostergesi (G2)', () => {
    it('normal mod: satirda tek kaymak-gosterge span i, bg-indigo-500, w-12; dugmelerin icinde cizgi div i yok', async () => {
        const { html } = await mountHome({ gizli: false })
        expect(say(html, 'kaymak-gosterge')).toBe(1)
        const sp = html.match(/<span[^>]*kaymak-gosterge[^>]*>/)[0]
        expect(sp).toContain('bg-indigo-500')
        expect(sp).toContain('w-12')
        expect(sp).not.toContain('w-px')
        expect(html).not.toContain('absolute bottom-0 left-0 right-0 h-0.5')
    })

    it('gizli mod: gosterge bg-zinc-950, satirda indigo/violet/purple/fuchsia yok', async () => {
        const { html } = await mountHome({ gizli: true })
        const sp = html.match(/<span[^>]*kaymak-gosterge[^>]*>/)[0]
        expect(sp).toContain('bg-zinc-950')
        expect(satir(html)).not.toMatch(/indigo|violet|purple|fuchsia/)
    })

    it('acik sekmeye yeniden tiklama isaret birakmaz', async () => {
        const { state } = await mountHome({ gizli: false })
        state.sekmeSec('assets')
        expect(state.kullaniciSekmeTiklamasi).toBe(false)
        state.sekmeSec('activity')
        expect(state.kullaniciSekmeTiklamasi).toBe(true)
    })
})

describe('Home.vue (SSR) -- sekme icerigi yonlu giris (G6, spec 7.3, K9)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))

    it.each([
        ['assets', false],
        ['activity', false],
        ['private', true],
    ])('ilk cizimde (%s) kaymak-sekme- sinifi yok; sekmeGiris bos baslar', async (sekme, gizli) => {
        const { html, state } = await mountHome({ gizli, sayfa: { homeTab: sekme } })
        expect(state.gorunenSekme).toBe(sekme)
        expect(html).not.toContain('kaymak-sekme-')
        expect(state.sekmeGiris).toBe('')
    })

    it('tiklama isareti SSR da sinif yazmaz (izleyici calismaz)', async () => {
        const { html, state } = await mountHome({ gizli: false })
        state.sekmeSec('activity')
        expect(state.sekmeGiris).toBe('')
        expect(html).not.toContain('kaymak-sekme-')
    })

    it('dort sekme blogu :class="sekmeGiris" tasir; sarmalayici yok, PrivateOrders te embedded den SONRA', () => {
        expect(SABLON).toContain(`<PrivateOrders v-if="gorunenSekme === 'private'" embedded :class="sekmeGiris" />`)
        expect(SABLON).toContain(`<div v-if="gorunenSekme === 'assets'" class="flex-1 relative flex flex-col" :class="sekmeGiris">`)
        expect(SABLON).toContain(`<div v-if="gorunenSekme === 'activity'" class="overflow-hidden relative" :class="sekmeGiris">`)
        expect(SABLON).toContain(`<div v-if="gorunenSekme === 'stocks'" class="flex-1 relative flex flex-col" :class="sekmeGiris">`)
        expect(say(SABLON, ':class="sekmeGiris"')).toBe(4)
    })

    it('izleyici: yalniz kullanici tiklamasi VE hareket izniyle yon sinifi; aksi halde bos (otomatik dusus kaymaz, K9)', () => {
        const govde = blokGovdesi(HAM, /watch\(gorunenSekme,\s*\(yeni,\s*eski\)\s*=>\s*/)
        expect(govde).not.toBeNull()
        const isaret = govde.search(/kullaniciSekmeTiklamasi\s*=\s*false/)
        const atama = govde.search(/sekmeGiris\.value\s*=\s*kullanici\s*&&\s*motionAllowed\(\)\s*\?\s*tabSlideClass\(eski,\s*yeni\)\s*:\s*''/)
        expect(isaret).toBeGreaterThan(-1)
        expect(atama).toBeGreaterThan(isaret)
        // Zamanlayici her degisimde once temizlenir, sonra yalniz sinif yazildiysa kurulur.
        const temizle = govde.search(/sekmeGirisDurdur\(\)/)
        expect(temizle).toBeGreaterThan(-1)
        expect(temizle).toBeLessThan(atama)
        expect(govde).toMatch(/setTimeout\([\s\S]*sekmeGiris\.value\s*=\s*''[\s\S]*TAB_SLIDE_CLEAR_MS\s*\)/)
    })

    it('zamanlayici onUnmounted da temizlenir', () => {
        const govde = blokGovdesi(HAM, /onUnmounted\(\(\)\s*=>\s*/)
        expect(govde).toMatch(/sekmeGirisDurdur\(\)/)
        const durdur = blokGovdesi(HAM, /const sekmeGirisDurdur\s*=\s*\(\)\s*=>\s*/)
        expect(durdur).toMatch(/clearTimeout\(sekmeGirisZamanlayici\)/)
    })
})

describe('Home.vue (SSR) -- sayan degerler (G7, spec 7.6, K6, K7)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const SCRIPT = KOD.slice(KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')

    it('dort CountingText: yuzde, 24 sa degeri, satir degeri, mini serit toplami (G11); hepsi kimlik tasir', () => {
        const etiketler = tekBosluk(SABLON).match(/<CountingText\b[^>]*\/>/g) || []
        expect(etiketler.length).toBe(4)
        for (const e of etiketler) expect(e).toMatch(/:identity="/)
        expect(SCRIPT).toMatch(/import CountingText from '\.\/motion\/CountingText\.vue'/)
    })

    it('yuzde: metin dugumu CountingText, ok ve renk hedefe bagli (aynen)', () => {
        const s = tekBosluk(SABLON)
        expect(s).toContain(`<CountingText v-else :text="isBalanceVisible ? filteredPercentageInfo.pct.toFixed(2) + '%' : '***'" :value="isBalanceVisible ? filteredPercentageInfo.pct : null" :format="yuzdeBicim" :identity="sayacKimligi" />`)
        // G9: renk sinifi diziye alindi, ikinci eleman goz basisindaki gecici kSwap sinifi (bos iken SSR sinifi ayni).
        expect(s).toContain(`:class="[filteredPercentageInfo.pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400', gozDegisSinifi]"`)
        expect(s).toContain(`:class="{ 'rotate-x-180': filteredPercentageInfo.pct < 0 }"`)
        expect(SCRIPT).toMatch(/const yuzdeBicim = \(n\) => n\.toFixed\(2\) \+ '%'/)
    })

    it('24 sa degeri: sinif aynen, metin bugunku ifade, format moneyOrZero', () => {
        const s = tekBosluk(SABLON)
        expect(s).toMatch(/<CountingText v-else class="text-slate-500 dark:text-zinc-400 text-xs font-medium transition-colors duration-300" :class="gozDegisSinifi" :text="isBalanceVisible \? moneyOrZero\(filteredPercentageInfo\.usd\) : '\*\*\*'" [^>]*:format="moneyOrZero" :identity="sayacKimligi" \/>/)
    })

    it('satir degeri: sinif aynen, metin bugunku uclu ifade, satir kimligi', () => {
        const s = tekBosluk(SABLON)
        expect(s).toContain(`<CountingText v-else class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300" :class="gozDegisSinifi" :text="isBalanceVisible ? ((user.tokenBalances[token.chainId + '_' + token.address]?.error || user.tokenBalances[token.chainId + '_' + token.address]?.valueUnknown) ? '—' : moneyOrZero(user.tokenBalances[token.chainId + '_' + token.address]?.value)) : '****'" :value="satirSayacDegeri(token)" :format="moneyOrZero" :identity="satirSayacKimligi(token)" />`)
    })

    it('format proplari kararli fonksiyon: sablonda satir ici ok fonksiyonu yok', () => {
        expect(SABLON).not.toContain(':format="(')
    })

    it('listeHazir yalniz startBalanceUpdates te ilk loadCurrentTokens donusunden SONRA true olur', () => {
        expect(SCRIPT).toMatch(/const listeHazir = ref\(false\)/)
        const govde = blokGovdesi(HAM, /const startBalanceUpdates = async \(\) =>\s*/)
        const yukle = govde.search(/await loadCurrentTokens\(\)/)
        const hazir = govde.search(/listeHazir\.value = true/)
        expect(yukle).toBeGreaterThan(-1)
        expect(hazir).toBeGreaterThan(yukle)
        expect(say(SCRIPT, 'listeHazir.value = true')).toBe(1)
    })

    it('sayacKimligi = taban (hesap, gizli mod, etkin para birimi, dil, kapsam, liste hazir, sozluk dolu, ilk yukleme) + toplam okuma parcasi', async () => {
        const { state } = await mountHome({ gizli: false })
        const parca = state.sayacKimligi.split('|')
        expect(parca.length).toBe(10)
        expect(parca.slice(0, 9).join('|')).toBe(state.sayacKimlikTabani)
        expect(parca[0]).toBe('acc1')
        expect(parca[1]).toBe('false')
        expect(parca[2]).toBe('usd')
        expect(parca[3]).toBe('false')
        expect(parca[4]).toBe('en')
        expect(parca[5]).toBe('all')
        expect(parca[6]).toBe('true')
        expect(state.listeHazir).toBe(true)
        // Bos kova: TON okunamadi (SSR'da kasa kilitli), hicbir satir okunmadi -> toplam yazilmadi.
        expect(parca[9]).toBe('okunmadi:0,0,0')
    })

    it('ilk yukleme, liste hazir ve kapsam kimligi GERCEKTEN degistirir (toplam ve satir kimligi)', async () => {
        const { state } = await mountHome({ gizli: false })
        const page = pageStore()
        const tok = { chainId: 56, address: '0xabc' }
        const kimlikler = () => [state.sayacKimligi, state.satirSayacKimligi(tok)]
        const yazicilar = {
            firstLoadDone: (v) => { page.firstLoadDone = v },
            listeHazir: (v) => { state.listeHazir = v },
            kapsam: (v) => { tokenScopeStore().filter = v ? 'all' : 56 },
        }
        for (const [ad, yaz] of Object.entries(yazicilar)) {
            yaz(false)
            const kapali = kimlikler()
            yaz(true)
            const acik = kimlikler()
            expect(kapali[0], ad).not.toBe(acik[0])
            expect(kapali[1], ad).not.toBe(acik[1])
        }
        page.firstLoadDone = false
        expect(state.sayacKimligi.split('|')[8]).toBe('false')
        page.firstLoadDone = true
        expect(state.sayacKimligi.split('|')[8]).toBe('true')
    })

    it('taban okumaVar (sozluk dolu): sozluk bossa ya da anahtar null ise false, doluysa true', async () => {
        const { state } = await mountHome({ gizli: false })
        const user = userStore()
        user.tokenBalances = {}
        expect(state.sayacKimlikTabani.split('|')[7]).toBe('false')
        user.tokenBalances = { '56_0x1': { value: 3 } }
        expect(state.sayacKimlikTabani.split('|')[7]).toBe('true')
        user.balancesAccountKey = null
        expect(state.sayacKimlikTabani.split('|')[7]).toBe('false')
    })

    it('toplam okuma parcasi: yalniz toplamlar BU hesap icin yazilinca okundu; yer tutucu yetmez, okunmadiyken deger kimlikte', async () => {
        const { state } = await mountHome({ gizli: false })
        const user = userStore()
        const toplam = () => state.sayacKimligi.split('|')[9]
        expect(state.toplamHesabi).toBeNull()
        // Satir yer tutucusu (TON kolu turun basinda yazar) sozlugu doldurur ama toplami okunmus YAPMAZ.
        user.tokenBalances = { '-239_0x0': {} }
        expect(state.sayacKimlikTabani.split('|')[7]).toBe('true')
        expect(toplam()).toBe('okunmadi:0,0,0')
        // Okunmadiyken her deger degisimi kimligi de degistirir: aninda yazilir, sayilmaz.
        user.percentage = 2.5
        const once = state.sayacKimligi
        user.percentage = 3
        expect(state.sayacKimligi).not.toBe(once)
        // Bu hesabin toplami yazildi: parca sabit, deger kimlige girmez (ekrandaki degisim sayar).
        state.toplamHesabi = 'acc1'
        expect(state.toplamOkundu).toBe(true)
        expect(toplam()).toBe('okundu')
        const okundu = state.sayacKimligi
        user.percentage = 4
        user.usd = 99
        expect(state.sayacKimligi).toBe(okundu)
        // Hesap degisimi: toplam baska hesabin, bu hesap icin okunmadi.
        user.balancesAccountKey = 'acc2'
        expect(toplam()).toMatch(/^okunmadi:/)
        user.balancesAccountKey = null
        state.toplamHesabi = null
        expect(state.toplamOkundu).toBe(false)
    })

    it('toplamHesabi yalniz toplamlarin YAZILDIGI uc yerde isaretlenir (tur sonu, applySolanaRows, onbellek); iki sifirlama blogu isareti SILER', () => {
        const isaret = /toplamHesabi\.value = (?!null\b)/g
        const silme = /toplamHesabi\.value = null\b/g
        expect((SCRIPT.match(isaret) || []).length).toBe(4)
        expect((SCRIPT.match(silme) || []).length).toBe(2)
        const tur = blokGovdesi(HAM, /if \(readCount > 0\)\s*/)
        expect(tur).toMatch(/user\.usd = usdBalance\s*toplamHesabi\.value = user\.balancesAccountKey\s*user\.totalsReadFor = user\.balancesAccountKey\s*$/)
        const sol = blokGovdesi(HAM, /const applySolanaRows = \(rows\) =>\s*/)
        expect(sol).toMatch(/user\.usd = usdBalance\s*toplamHesabi\.value = user\.balancesAccountKey\s*user\.totalsReadFor = user\.balancesAccountKey\s*$/)
        // loadCurrentTokens: tek isaret onbellek dalinda; iki silme de sifirlama bloklarinin sonunda.
        const yukle = blokGovdesi(HAM, /const loadCurrentTokens = async \(\) =>\s*/)
        expect((yukle.match(isaret) || []).length).toBe(1)
        expect((yukle.match(silme) || []).length).toBe(2)
        expect(yukle).toMatch(/if \(onbellektenBoyandi && user\.balancesAccountKey === seedAccount\.key\) \{\s*toplamHesabi\.value = seedAccount\.key\s*user\.totalsReadFor = seedAccount\.key\s*\}/)
        const sifirla1 = blokGovdesi(HAM, /if \(user\.balancesAccountKey !== null && user\.balancesAccountKey !== seedAccount\.key\)\s*/)
        expect(sifirla1).toMatch(/user\.balancesAccountKey = seedAccount\.key\s*toplamHesabi\.value = null\s*user\.totalsReadFor = null\s*user\.totalsFailedFor = null\s*$/)
        const sifirla2 = blokGovdesi(HAM, /if \(user\.balancesAccountKey !== null && user\.balancesAccountKey !== active_account\.key\)\s*/)
        expect(sifirla2).toMatch(/user\.percentageUSD = 0\s*toplamHesabi\.value = null\s*user\.totalsReadFor = null\s*user\.totalsFailedFor = null\s*$/)
        // Silme onbellek isaretinden ONCE: hidrasyon ayni yuklemede yeniden isaretleyebilir.
        expect(yukle.search(silme)).toBeLessThan(yukle.search(/toplamHesabi\.value = seedAccount\.key/))
    })

    it('satirSayacKimligi = taban + | + chainId_address (toplam okuma parcasi satira girmez); satirSayacDegeri yalniz gorunur, hatasiz, sonlu deger', async () => {
        const { state } = await mountHome({ gizli: false })
        const user = userStore()
        const tok = { chainId: 56, address: '0xabc' }
        expect(state.satirSayacKimligi(tok)).toBe(state.sayacKimlikTabani + '|56_0xabc')
        const satirOnce = state.satirSayacKimligi(tok)
        state.toplamHesabi = 'acc1'
        expect(state.satirSayacKimligi(tok)).toBe(satirOnce)
        user.tokenBalances = { '56_0xabc': { value: 12.5 } }
        expect(state.satirSayacDegeri(tok)).toBe(12.5)
        user.tokenBalances = { '56_0xabc': { value: 12.5, error: true } }
        expect(state.satirSayacDegeri(tok)).toBeNull()
        user.tokenBalances = { '56_0xabc': { value: 12.5, valueUnknown: true } }
        expect(state.satirSayacDegeri(tok)).toBeNull()
        user.tokenBalances = { '56_0xabc': {} }
        expect(state.satirSayacDegeri(tok)).toBeNull()
        user.tokenBalances = { '56_0xabc': { value: Number.NaN } }
        expect(state.satirSayacDegeri(tok)).toBeNull()
        user.tokenBalances = { '56_0xabc': { value: 12.5 } }
        state.isBalanceVisible = false
        expect(state.satirSayacDegeri(tok)).toBeNull()
    })

    it('24 sa degeri CountingText ile de degisim24 ayiklayicisinin kalibina uyar', async () => {
        ag.ton = async () => 0
        const { html } = await mountHome({ gizli: false })
        const temiz = html.replace(/<!--[\s\S]*?-->/g, '')
        expect(temiz).toMatch(/duration-300">([^<]*)<\/span><span class="text-slate-400 dark:text-zinc-600 text-\[10px\]/)
    })
})

describe('Home.vue (SSR) -- hesap degisiminde sayan toplam 0 dan saymaz (G7 inceleme; K6, 7.6)', () => {
    const img = { thumb: '/usdt.png', small: '/usdt.png', large: '/usdt.png' }
    const USDT_BSC = { name: 'Tether', symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chain: 'binance-smart-chain', coingecko_id: 'tether', image: img }
    const USDC_BSC = { name: 'USD Coin', symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, chain: 'binance-smart-chain', coingecko_id: 'usd-coin', image: img }
    const FIYATLAR = [
        { coingecko_id: 'tether', market_data: { priceUSD: 1, change: { h24: 0.5 }, sparkline: { d7: Array(144).fill(0.99) } } },
        { coingecko_id: 'usd-coin', market_data: { priceUSD: 2, change: { h24: -1 }, sparkline: { d7: Array(144).fill(1.9) } } },
    ]
    const KOVA = { 56: [USDT_BSC, USDC_BSC] }
    const TON_ANAHTARI = '-239_0x0'

    // Hap metni ve degeri sablondaki ifadelerin aynisi (bakiye gorunur).
    const hapYuzde = (state) => ({ text: state.filteredPercentageInfo.pct.toFixed(2) + '%', value: state.filteredPercentageInfo.pct, identity: state.sayacKimligi })
    const hapDeger = (state) => ({ text: state.moneyOrZero(state.filteredPercentageInfo.usd), value: state.sayilabilir(state.filteredPercentageInfo.usd), identity: state.sayacKimligi })

    // GERCEK sayac denetleyicisi; HER reaktif yazimdan sonra beslenir (flush: 'sync': Vue'nun cizim
    // sikligindan daha siki, yani ara durumlarin hicbiri kacmaz). Tween baslarsa `kareler` dolar.
    function sayacKur(oku) {
        const yaz = []
        const kareler = []
        const zamanlayicilar = new Map()
        let no = 0
        const sayac = createCounter({
            initial: oku(),
            format: (n) => `ARA ${n}`,
            onText: (metin) => yaz.push(metin),
            ticker: { add: (f) => kareler.push(f), remove: () => {} },
            motionAllowed: () => true,
            setTimer: (fn) => { zamanlayicilar.set(++no, fn); return no },
            clearTimer: (i) => { zamanlayicilar.delete(i) },
        })
        const durdur = watch(oku, (h) => sayac.update(h), { flush: 'sync' })
        // 120 ms birlestirme penceresini hemen kapatir: bekleyen hedef varsa tween o an baslar.
        const bosalt = () => { for (const [i, fn] of [...zamanlayicilar]) { zamanlayicilar.delete(i); fn() } }
        return { yaz, kareler, bosalt, durdur: () => { durdur(); sayac.dispose() } }
    }

    it.each([['all'], [56]])('kapsam %s: hesap degisimi -> TON yer tutucusu -> satirlar -> tur sonu toplami: ara kare yok, metin aninda', async (kapsam) => {
        ag.fiyatlar = FIYATLAR
        ag.bakiye = async (_sahip, adres) => (adres === USDT_BSC.address ? 10 : 20)
        const { state, stub } = await mountHome({ gizli: false, bucket: KOVA, kapsam, digerKovalar: { acc2: KOVA } })
        const user = userStore()
        expect(user.balancesAccountKey).toBe('acc1')
        expect(state.filteredPercentageInfo.pct).not.toBe(0)
        const yuzde = sayacKur(() => hapYuzde(state))
        const deger = sayacKur(() => hapDeger(state))
        const bosalt = () => { yuzde.bosalt(); deger.bosalt() }

        // Hesap degisimi (acc2 icin oturum onbellegi YOK); bakiye okumalari elle bekletilir.
        const bekleyen = []
        ag.bakiye = () => new Promise((coz) => bekleyen.push(coz))
        stub.localStore.active_account = NORMAL2
        const tur = state.startBalanceUpdates()
        await vi.waitFor(() => expect(bekleyen).toHaveLength(2))
        expect(user.balancesAccountKey).toBe('acc2')
        // TON kolu yer tutucusunu turun basinda, toplamlardan ONCE yazdi (bulgunun sirasi).
        expect(user.tokenBalances[TON_ANAHTARI]).toBeDefined()
        expect(state.filteredPercentageInfo.pct).toBe(0)
        bosalt()

        // Ilk satir okunur (suzgec seciliyse hap kismi toplama gecer), sonra ikincisi ve tur sonu toplami.
        bekleyen[0](10)
        await vi.waitFor(() => expect(Object.values(user.tokenBalances).filter((b) => b.amount !== undefined)).toHaveLength(1))
        bosalt()
        bekleyen[1](30)
        await tur
        bosalt()

        expect(state.filteredPercentageInfo.pct).not.toBe(0)
        expect(yuzde.kareler).toHaveLength(0)
        expect(deger.kareler).toHaveLength(0)
        expect(yuzde.yaz.some((m) => m.startsWith('ARA'))).toBe(false)
        expect(yuzde.yaz.at(-1)).toBe(hapYuzde(state).text)
        expect(deger.yaz.at(-1)).toBe(hapDeger(state).text)

        // Pozitif kontrol: okuma oturduktan sonra EKRANDA degisen deger sayar (test bos gecmiyor).
        ag.bakiye = async (_sahip, adres) => (adres === USDT_BSC.address ? 40 : 30)
        await state.updateBalance()
        bosalt()
        expect(yuzde.kareler).toHaveLength(1)
        expect(deger.kareler).toHaveLength(1)
        yuzde.durdur()
        deger.durdur()
    })

    it.each([['all'], [56]])('kapsam %s: hizli geri donus A -> B -> A (B turu bitmeden): A nin eski okumasi gecerli sayilmaz, 0 dan sayma yok', async (kapsam) => {
        ag.fiyatlar = FIYATLAR
        ag.bakiye = async (_sahip, adres) => (adres === USDT_BSC.address ? 10 : 20)
        const { state, stub } = await mountHome({ gizli: false, bucket: KOVA, kapsam, digerKovalar: { acc2: KOVA } })
        const user = userStore()
        // acc1 tam okundu: toplam bu hesap icin yazildi.
        expect(state.toplamOkundu).toBe(true)
        const yuzde = sayacKur(() => hapYuzde(state))
        const deger = sayacKur(() => hapDeger(state))
        const bosalt = () => { yuzde.bosalt(); deger.bosalt() }

        const bekleyen = []
        ag.bakiye = () => new Promise((coz) => bekleyen.push(coz))
        // acc2'ye gecis; okumalari bitmeden acc1'e geri donus.
        stub.localStore.active_account = NORMAL2
        const tur1 = state.startBalanceUpdates()
        await vi.waitFor(() => expect(bekleyen).toHaveLength(2))
        expect(user.balancesAccountKey).toBe('acc2')
        bosalt()
        stub.localStore.active_account = NORMAL
        const tur2 = state.startBalanceUpdates()
        await vi.waitFor(() => expect(bekleyen).toHaveLength(4))
        expect(user.balancesAccountKey).toBe('acc1')
        // Sifirlama toplamlari 0'a cekti; acc1'in ONCEKI okumasi artik gecerli degil.
        expect(state.toplamOkundu).toBe(false)
        expect(state.filteredPercentageInfo.pct).toBe(0)
        bosalt()

        // Eski tur (acc2) duser; yeni turun satirlari ve toplami gelir.
        bekleyen[0](10)
        bekleyen[1](30)
        await tur1
        bosalt()
        bekleyen[2](10)
        await vi.waitFor(() => expect(Object.values(user.tokenBalances).filter((b) => b.amount !== undefined)).toHaveLength(1))
        bosalt()
        bekleyen[3](30)
        await tur2
        bosalt()

        expect(state.toplamOkundu).toBe(true)
        expect(state.filteredPercentageInfo.pct).not.toBe(0)
        expect(yuzde.kareler).toHaveLength(0)
        expect(deger.kareler).toHaveLength(0)
        expect(yuzde.yaz.some((m) => m.startsWith('ARA'))).toBe(false)
        expect(deger.yaz.some((m) => m.startsWith('ARA'))).toBe(false)
        expect(yuzde.yaz.at(-1)).toBe(hapYuzde(state).text)
        expect(deger.yaz.at(-1)).toBe(hapDeger(state).text)
        yuzde.durdur()
        deger.durdur()
    })
    // KULLANICI HATASI 2026-11-17: hesap degisince toplam ve satirlar yeni hesap okunana kadar YANLIS $0.00 / 0
    // gosteriyordu. Simdi: bekleniyor -> yukleme cubugu, tur bitti okunamadi -> tire, okundu -> sayi.
    it('hesap degisimi: yeni hesap okunana kadar bekleniyor (cubuk), satirlar okunmadi; tur sonunda okundu', async () => {
        ag.fiyatlar = FIYATLAR
        ag.bakiye = async (_sahip, adres) => (adres === USDT_BSC.address ? 10 : 20)
        const { state, stub } = await mountHome({ gizli: false, bucket: KOVA, kapsam: 'all', digerKovalar: { acc2: KOVA } })
        const user = userStore()
        expect(state.toplamDurumu).toBe('okundu')
        expect(user.totalsReadFor).toBe('acc1')

        const bekleyen = []
        ag.bakiye = () => new Promise((coz) => bekleyen.push(coz))
        stub.localStore.active_account = NORMAL2
        const tur = state.startBalanceUpdates()
        await vi.waitFor(() => expect(bekleyen).toHaveLength(2))
        expect(user.balancesAccountKey).toBe('acc2')
        expect(user.totalsReadFor).toBeNull()
        expect(state.toplamDurumu).toBe('bekleniyor')
        expect(state.satirOkunmadi({ chainId: 56, address: USDT_BSC.address })).toBe(true)

        bekleyen[0](10)
        bekleyen[1](30)
        await tur
        expect(state.toplamDurumu).toBe('okundu')
        expect(user.totalsReadFor).toBe('acc2')
        expect(state.satirOkunmadi({ chainId: 56, address: USDT_BSC.address })).toBe(false)
        // Isaret yalniz bellekte: depoya hicbir yazimda gecmez.
        expect(JSON.stringify(stub.localStore)).not.toMatch(/totalsReadFor|totalsFailedFor/)
    })

    it('hesap degisimi: tur bitti ama hicbir satir okunamadi -> okunamadi (tire), sonsuz cubuk yok', async () => {
        ag.fiyatlar = FIYATLAR
        ag.bakiye = async () => 5
        const { state, stub } = await mountHome({ gizli: false, bucket: KOVA, kapsam: 'all', digerKovalar: { acc2: KOVA } })
        ag.bakiye = async () => { throw new Error('rpc dustu') }
        stub.localStore.active_account = NORMAL2
        await state.startBalanceUpdates()
        expect(userStore().balancesAccountKey).toBe('acc2')
        expect(state.toplamDurumu).toBe('okunamadi')
    })

    it('bos liste dali toplami okunmus sayar (gercek 0, sonsuz cubuk yok)', () => {
        const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
        const bos = blokGovdesi(HAM, /if\(tokens\.length === 0 && !hasSolanaRows\)\s*/)
        expect(bos).toMatch(/toplamHesabi\.value = user\.balancesAccountKey\s*user\.totalsReadFor = user\.balancesAccountKey\s*return\s*$/)
    })

    it('SSR: tek satir 0 okundu -> $0.00, cubuk yok; okunamadi -> baslikta tire, yanlis $0.00 YOK', async () => {
        ag.ton = async () => 0
        const okundu = await mountHome({ gizli: false })
        expect(okundu.state.toplamDurumu).toBe('okundu')
        expect(okundu.html).not.toContain('kaymak-iskelet')
        expect(okundu.html).toContain('0.00')
        ag.ton = null
        const okunamadi = await mountHome({ gizli: false })
        expect(okunamadi.state.toplamDurumu).toBe('okunamadi')
        const temiz = okunamadi.html.replace(/<!--[\s\S]*?-->/g, '')
        const baslik = temiz.match(/<span class="[^"]*leading-tight[^"]*">[\s\S]*?<button/)[0]
        expect(baslik).toContain('<span class="relative tabular-nums"><span>—</span></span>')
        expect(baslik).not.toContain('0.00')
        expect(temiz).not.toContain('kaymak-iskelet')
    })

    it('satirOkunmadi: kayit yok / yer tutucu {} -> true; okunmus 0, hata -> false', async () => {
        const { state } = await mountHome({ gizli: false })
        const user = userStore()
        const t = { chainId: 56, address: '0xabc' }
        user.tokenBalances = {}
        expect(state.satirOkunmadi(t)).toBe(true)
        user.tokenBalances = { '56_0xabc': {} }
        expect(state.satirOkunmadi(t)).toBe(true)
        user.tokenBalances = { '56_0xabc': { amount: 0 } }
        expect(state.satirOkunmadi(t)).toBe(false)
        user.tokenBalances = { '56_0xabc': { error: true } }
        expect(state.satirOkunmadi(t)).toBe(false)
    })

    it('sablon: baslik, hap, serit ve satirlar durumla baglanir; stil 150 ms gizli bekler, hareket azaltilmissa nabiz yok', () => {
        const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
        expect(HAM).toContain(`<OdometerNumber v-if="isBalanceVisible && toplamDurumu === 'okundu'" key="acik"`)
        expect(HAM).toContain(`<span v-else-if="isBalanceVisible" key="bekle"><span v-if="toplamDurumu === 'bekleniyor'" class="kaymak-iskelet`)
        expect(HAM).toContain(`<svg v-if="isBalanceVisible && toplamDurumu === 'okundu'" class="w-3 h-3"`)
        expect(say(HAM, `isBalanceVisible && toplamDurumu !== 'okundu'`)).toBe(2)
        expect(say(HAM, 'isBalanceVisible && satirOkunmadi(token)')).toBe(3)
        expect(HAM).toContain('<span v-if="satirOkunmadi(token)" class="kaymak-iskelet')
        const CSS = readFileSync(new URL('../popup/style.css', import.meta.url), 'utf8')
        const bas = CSS.indexOf('.kaymak-iskelet {')
        const kural = CSS.slice(bas, CSS.indexOf('}', bas))
        expect(kural).toContain('opacity: 0;')
        expect(kural).toContain('animation: kaymak-iskelet 1.2s ease-in-out 0.15s infinite alternate;')
        const azalt = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'))
        expect(azalt).toContain('.kaymak-iskelet { animation: kaymak-iskelet-duz 0s linear 0.15s forwards; }')
    })
})

describe('Home.vue (SSR) -- sayac rakamli toplam (G8, spec 7.7, K6, D9)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const SCRIPT = KOD.slice(KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')

    it('baslik sayi bolumu: relative tabular-nums sarmalayici icinde OdometerNumber / ****; gizli ve acik ayni yapi', () => {
        const s = tekBosluk(SABLON)
        // G9 (spec 7.8): cift, sarmalayicinin ICINDE anahtarli kaymak-goz gecisine alindi; sarmalayici ve dallar aynen.
        expect(s).toContain(`<span class="relative tabular-nums"><Transition name="kaymak-goz" :css="gozAnimasyonu"><OdometerNumber v-if="isBalanceVisible && toplamDurumu === 'okundu'" key="acik" :text="headlineParts.number" :size="headlineSize" :identity="sayacKimligi" :locale="locale" /><span v-else-if="isBalanceVisible" key="bekle"><span v-if="toplamDurumu === 'bekleniyor'" class="kaymak-iskelet w-[3.5em] h-[0.75em]" aria-hidden="true"></span><template v-else>—</template></span><span v-else key="gizli">****</span></Transition></span>`)
        expect(say(SABLON, '<OdometerNumber')).toBe(1)
        expect(SCRIPT).toMatch(/import OdometerNumber from '\.\/motion\/OdometerNumber\.vue'/)
        expect(SABLON).not.toContain("isBalanceVisible ? headlineParts.number : '****'")
    })

    it('SSR: baslik sayisi sarmalayici icinde ozniteliksiz tek span, duz metin; sutun yok, sayi oznitelikte yok', async () => {
        ag.ton = async () => 0
        const { html } = await mountHome({ gizli: false })
        const temiz = html.replace(/<!--[\s\S]*?-->/g, '')
        const baslik = temiz.match(/<span class="[^"]*leading-tight[^"]*">[\s\S]*?<button/)[0]
        const m = baslik.match(/<span class="relative tabular-nums"><span>([^<]*)<\/span><\/span>/)
        expect(m).not.toBeNull()
        expect(m[1]).toBe('0.00')
        expect(temiz).not.toContain('kaymak-odometre')
        expect(baslik).not.toMatch(/="[^"]*0\.00[^"]*"/)
    })
})

describe('Home.vue (SSR) -- goz gecisi ve goz tercihi bellegi (G9, spec 7.8, D4)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const SCRIPT = KOD.slice(KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')
    const baslik = (html) => html.replace(/<!--[\s\S]*?-->/g, '').match(/<span class="[^"]*leading-tight[^"]*">[\s\S]*?<button/)[0]
    // Hareket izni olan belge (gorunur, azaltilmis hareket yok); `azalt` ile tercih acilir.
    const hareketliBelge = (azalt = false) => vi.stubGlobal('document', {
        addEventListener: () => {},
        removeEventListener: () => {},
        visibilityState: 'visible',
        defaultView: { matchMedia: () => ({ matches: azalt }) },
    })
    afterEach(() => { vi.useRealTimers() })

    it('bellek false + depo false: baslikta ****, sayi DOM da yok', async () => {
        const { html, state } = await mountHome({ gizli: false, sayfa: { balanceVisible: false }, depo: { isBalanceVisible: false } })
        const b = baslik(html)
        expect(b).toContain('<span class="relative tabular-nums"><span>****</span></span>')
        expect(b).not.toContain('0.00')
        expect(state.isBalanceVisible).toBe(false)
    })

    it('bellek false + depo true: ilk cizim (Home un kendi onMounted indan once) bellekten gizli; depo sonra animasyonsuz uzlasir', async () => {
        let ilk
        const { state } = await mountHome({
            gizli: false,
            sayfa: { balanceVisible: false },
            depo: { isBalanceVisible: true },
            onCapture: (i) => { ilk = i.setupState.isBalanceVisible },
        })
        expect(ilk).toBe(false)
        expect(state.isBalanceVisible).toBe(true)
        expect(pageStore().balanceVisible).toBe(true)
        expect(state.gozAnimasyonu).toBe(false)
        expect(state.gozDegis).toBe(false)
    })

    it('bellek bos (ilk kurulum): gorunur baslar, depo okumasi bellegi doldurur', async () => {
        let ilk
        const { state } = await mountHome({ gizli: false, depo: { isBalanceVisible: false }, onCapture: (i) => { ilk = i.setupState.isBalanceVisible } })
        expect(ilk).toBe(true)
        expect(state.isBalanceVisible).toBe(false)
        expect(pageStore().balanceVisible).toBe(false)
    })

    it('depoda deger yoksa bellek bos kalir, gorunur', async () => {
        const { state } = await mountHome({ gizli: false })
        expect(state.isBalanceVisible).toBe(true)
        expect(pageStore().balanceVisible).toBeNull()
    })

    it('toggleBalanceVisibility: bellek ters doner ve depoya { isBalanceVisible } yazilir', async () => {
        const { state } = await mountHome({ gizli: false, depo: { isBalanceVisible: true } })
        const set = vi.spyOn(globalThis.chrome.storage.local, 'set')
        state.toggleBalanceVisibility()
        expect(state.isBalanceVisible).toBe(false)
        expect(pageStore().balanceVisible).toBe(false)
        expect(set).toHaveBeenLastCalledWith({ isBalanceVisible: false })
        state.toggleBalanceVisibility()
        expect(state.isBalanceVisible).toBe(true)
        expect(pageStore().balanceVisible).toBe(true)
        expect(set).toHaveBeenLastCalledWith({ isBalanceVisible: true })
    })

    it('hareket izni yokken (SSR belgesi) goz basisi gecis ve kSwap kurmaz', async () => {
        const { state } = await mountHome({ gizli: false })
        expect(state.gozAnimasyonu).toBe(false)
        expect(state.gozDegis).toBe(false)
        expect(state.gozDegisSinifi).toBe('')
        state.toggleBalanceVisibility()
        expect(state.gozAnimasyonu).toBe(false)
        expect(state.gozDegis).toBe(false)
        expect(state.gozDegisSinifi).toBe('')
    })

    it('hareket azaltilmissa goz basisi gecis ve kSwap kurmaz', async () => {
        const { state } = await mountHome({ gizli: false })
        hareketliBelge(true)
        state.toggleBalanceVisibility()
        expect(state.gozAnimasyonu).toBe(false)
        expect(state.gozDegis).toBe(false)
    })

    it('hareket izniyle: basis ikisini acar, 220 ms sonra kapanir; her basista zamanlayici yeniden kurulur', async () => {
        const { state } = await mountHome({ gizli: false })
        hareketliBelge(false)
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        state.toggleBalanceVisibility()
        expect(state.gozAnimasyonu).toBe(true)
        expect(state.gozDegis).toBe(true)
        expect(state.gozDegisSinifi).toBe('kaymak-kswap')
        vi.advanceTimersByTime(200)
        state.toggleBalanceVisibility()
        vi.advanceTimersByTime(219)
        expect(state.gozAnimasyonu).toBe(true)
        expect(state.gozDegis).toBe(true)
        vi.advanceTimersByTime(1)
        expect(state.gozAnimasyonu).toBe(false)
        expect(state.gozDegis).toBe(false)
        expect(state.gozDegisSinifi).toBe('')
        expect(vi.getTimerCount()).toBe(0)
    })

    it.each([[true], [false]])('SSR HTML de kaymak-kswap ve kaymak-goz yok (gorunur: %s)', async (gorunur) => {
        const { html } = await mountHome({ gizli: false, depo: { isBalanceVisible: gorunur } })
        expect(html).not.toContain('kaymak-kswap')
        expect(html).not.toContain('kaymak-goz')
    })

    it('gizli mod: SSR HTML de kaymak-kswap ve kaymak-goz yok', async () => {
        const { html } = await mountHome({ gizli: true, depo: { isBalanceVisible: false } })
        expect(html).not.toContain('kaymak-kswap')
        expect(html).not.toContain('kaymak-goz')
    })

    it('kaynak: baslik cifti tek kaymak-goz gecisinde, anahtarli; css gozAnimasyonu na bagli', () => {
        const s = tekBosluk(SABLON)
        expect(say(SABLON, '<Transition name="kaymak-goz" :css="gozAnimasyonu">')).toBe(1)
        expect(say(SABLON, 'kaymak-goz')).toBe(1)
        expect(s).toMatch(/<Transition name="kaymak-goz" :css="gozAnimasyonu"><OdometerNumber v-if="isBalanceVisible && toplamDurumu === 'okundu'" key="acik" [^>]*\/><span v-else-if="isBalanceVisible" key="bekle">[\s\S]*?<\/template><\/span><span v-else key="gizli">\*\*\*\*<\/span><\/Transition>/)
    })

    it('kaynak: goz tercihi setup ta bellekten senkron; onMounted depo okumasi bellegi yazar, gecis kurmaz', () => {
        expect(SCRIPT).toMatch(/const isBalanceVisible = ref\(page\.balanceVisible \?\? true\)/)
        expect(SCRIPT).toMatch(/const gozAnimasyonu = ref\(false\)/)
        expect(SCRIPT).toMatch(/const gozDegis = ref\(false\)/)
        expect(SCRIPT).toMatch(/const gozDegisSinifi = computed\(\(\) => \(gozDegis\.value \? 'kaymak-kswap' : ''\)\)/)
        const mount = blokGovdesi(HAM, /onMounted\(async \(\) =>\s*/)
        expect(mount).not.toBeNull()
        expect(mount).not.toMatch(/gozAnimasyonu|gozDegis/)
        const dal = blokGovdesi(mount, /if \(storage\.isBalanceVisible !== undefined\)\s*/)
        expect(dal).toMatch(/isBalanceVisible\.value = storage\.isBalanceVisible/)
        expect(dal).toMatch(/page\.balanceVisible = storage\.isBalanceVisible/)
    })

    it('kaynak: toggle once izni okur ve gecisi kurar, sonra ters cevirir, bellege ve depoya yazar', () => {
        const govde = blokGovdesi(HAM, /const toggleBalanceVisibility = \(\) =>\s*/)
        expect(govde).not.toBeNull()
        const izin = govde.search(/const izin = motionAllowed\(\)/)
        const gecis = govde.search(/gozAnimasyonu\.value = izin/)
        const degis = govde.search(/gozDegis\.value = izin/)
        const ters = govde.search(/isBalanceVisible\.value = !isBalanceVisible\.value/)
        expect(izin).toBeGreaterThan(-1)
        expect(gecis).toBeGreaterThan(izin)
        expect(degis).toBeGreaterThan(izin)
        expect(ters).toBeGreaterThan(gecis)
        expect(ters).toBeGreaterThan(degis)
        expect(govde).toMatch(/page\.balanceVisible = isBalanceVisible\.value/)
        expect(govde).toMatch(/chrome\.storage\.local\.set\(\{ isBalanceVisible: isBalanceVisible\.value \}\)/)
        expect(govde).toMatch(/GOZ_DEGIS_MS/)
        expect(SCRIPT).toMatch(/const GOZ_DEGIS_MS = 220\b/)
    })

    it('kaynak: zamanlayici onUnmounted da temizlenir', () => {
        const govde = blokGovdesi(HAM, /onUnmounted\(\(\)\s*=>\s*/)
        expect(govde).toMatch(/gozDurdur\(\)/)
        const durdur = blokGovdesi(HAM, /const gozDurdur\s*=\s*\(\)\s*=>\s*/)
        expect(durdur).toMatch(/clearTimeout\(gozZamanlayici\)/)
    })

    it('kaynak: kSwap sinifi hap yuzdesi, 24 sa degeri, satir degeri, miktar ve mini serit toplamina (G11) baglanir; baska yere degil', () => {
        const s = tekBosluk(SABLON)
        expect(say(SABLON, 'gozDegisSinifi')).toBe(5)
        expect(s).toMatch(/<CountingText v-else class="text-\[15px\] font-bold text-slate-900 dark:text-white" :class="gozDegisSinifi" :text="isBalanceVisible \? moneyOrZero\(filteredUsd\) : '\*\*\*\*'"/)
        expect(s).toContain(`<span class="flex items-center text-xs font-bold gap-1" :class="[filteredPercentageInfo.pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400', gozDegisSinifi]">`)
        expect(s).toMatch(/<CountingText v-else class="text-slate-500 dark:text-zinc-400 text-xs font-medium transition-colors duration-300" :class="gozDegisSinifi" :text="isBalanceVisible \? moneyOrZero\(filteredPercentageInfo\.usd\)/)
        expect(s).toMatch(/<CountingText v-else class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300" :class="gozDegisSinifi" :text="isBalanceVisible \? \(\(user\.tokenBalances/)
        expect(s).toContain(`<span class="truncate text-xs text-slate-500 dark:text-zinc-500 font-medium text-start transition-colors duration-300" :class="gozDegisSinifi"><span v-if="isBalanceVisible && satirOkunmadi(token)" class="kaymak-iskelet w-[3em] h-[0.9em]" aria-hidden="true"></span>{{ isBalanceVisible && satirOkunmadi(token) ? '' : (isBalanceVisible ? (user.tokenBalances`)
    })
})

describe('Home.vue (SSR) -- yapiskan sekmeler (G10, spec 7.9, K8)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const SCRIPT = KOD.slice(KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')
    const temizle = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const etiket = (html, bas) => (bas < 0 ? '' : html.slice(bas, html.indexOf('>', bas) + 1))
    const siniflar = (e) => (e.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    const sekmeSatiriBasi = (html) => html.lastIndexOf('<div', html.indexOf('pt-5 pb-0 border-b'))
    const sekmeSatiri = (html) => etiket(html, sekmeSatiriBasi(html))
    const panel = (html) => etiket(html, html.lastIndexOf('<div', html.indexOf('shadow-[0_-10px_40px_rgba(0,0,0,0.05)]')))
    const seciciSatiri = (html) => etiket(html, html.lastIndexOf('<div', html.indexOf('justify-between px-7 pt-4')))

    it('normal: sekme satiri sticky top-11 z-20, panel zemini, yapismamisken rounded-t-4xl; konum isareti bitisik', async () => {
        const { html } = await mountHome({ gizli: false })
        const e = sekmeSatiri(html)
        expect(e).toContain('pt-5 pb-0 border-b')
        expect(e).toContain('bg-white dark:bg-[#0c0c0e]')
        const s = siniflar(e)
        for (const c of ['sticky', 'top-11', 'z-20', 'bg-white', 'dark:bg-[#0c0c0e]', 'rounded-t-4xl', 'transition-colors', 'duration-300']) expect(s).toContain(c)
        expect(s).not.toContain('top-0')
        expect(s).not.toContain('relative')
        expect(e).not.toContain('backdrop-')
    })

    it('gizli: sekme satiri top-0 yapisir, top-11 yok', async () => {
        const { html } = await mountHome({ gizli: true })
        const s = siniflar(sekmeSatiri(html))
        for (const c of ['sticky', 'top-0', 'z-20', 'bg-white', 'dark:bg-[#0c0c0e]', 'rounded-t-4xl']) expect(s).toContain(c)
        expect(s).not.toContain('top-11')
    })

    it.each([false, true])('yapistiginda (gizli=%s) kose 0: rounded-t-4xl dusmus', async (gizli) => {
        const { html, state } = await mountHome({ gizli, onCapture: (i) => { i.setupState.yapisti = true } })
        expect(state.yapisti).toBe(true)
        const s = siniflar(sekmeSatiri(html))
        expect(s).toContain('sticky')
        expect(s).not.toContain('rounded-t-4xl')
    })

    it('panel icerik tabanli esasla uzar (flex-[1_0_auto]); normalde serit kadar eksik, gizlide tam en az yukseklik', async () => {
        const normal = await mountHome({ gizli: false })
        const gizli = await mountHome({ gizli: true })
        for (const { html } of [normal, gizli]) {
            const s = siniflar(panel(html))
            expect(s).toContain('flex-[1_0_auto]')
            expect(s).toContain('rounded-t-4xl')
            expect(s).not.toContain('flex-1')
            expect(html).not.toContain('flex-1 bg-white')
        }
        // +2px: panelin 1 px border-t'si ve gozcunun 1 px'i (G10 inceleme bulgusu); payi olmadan kisa sekmede en fazla
        // kaydirma satiri cizginin 1 px altinda birakir, yapisikken kisa sekmeye geciste satir kayar ve kose geri gelir.
        expect(siniflar(panel(normal.html))).toContain('min-h-[calc(100%-2.75rem+2px)]')
        expect(siniflar(panel(normal.html))).not.toContain('min-h-[calc(100%+2px)]')
        expect(siniflar(panel(gizli.html))).toContain('min-h-[calc(100%+2px)]')
        expect(siniflar(panel(gizli.html))).not.toContain('min-h-[calc(100%-2.75rem+2px)]')
        for (const { html } of [normal, gizli]) {
            const s = siniflar(panel(html))
            expect(s).not.toContain('min-h-full')
            expect(s).not.toContain('min-h-[calc(100%-2.75rem)]')
        }
    })

    it.each([false, true])('Aktiviteler kabi (gizli=%s) icerik boyunda: flex-1 ile gerilmez, panelin en az yuksekligi History nin ortalanan bos/hata durumlarina gecmez', async (gizli) => {
        const html = temizle((await mountHome({ gizli, sayfa: { homeTab: 'activity' } })).html)
        const kok = html.indexOf('w-full h-full bg-transparent flex flex-col')
        expect(kok).toBeGreaterThan(-1)
        const kap = etiket(html, html.lastIndexOf('<div', html.lastIndexOf('<div', kok) - 1))
        expect(siniflar(kap)).toEqual(['overflow-hidden', 'relative'])
        expect(SABLON).not.toMatch(/<div v-if="gorunenSekme === 'activity'" class="[^"]*\bflex-1\b/)
    })

    it('gizli: ag secici satiri relative z-10 (yapisik sekmelerin altindan gecer); relative z-30 iki modda da tek', async () => {
        const gizli = await mountHome({ gizli: true })
        const s = siniflar(seciciSatiri(gizli.html))
        expect(s).toContain('relative')
        expect(s).toContain('z-10')
        expect(gizli.html.split('relative z-30').length - 1).toBe(1)
        const normal = await mountHome({ gizli: false })
        expect(normal.html.split('relative z-30').length - 1).toBe(1)
    })

    it.each([false, true])('gozcu (gizli=%s): aria-hidden, net yukseklik 0, sekme satirindan hemen once', async (gizli) => {
        const html = temizle((await mountHome({ gizli })).html)
        const satirBasi = sekmeSatiriBasi(html)
        const gozcuBasi = html.lastIndexOf('<div', satirBasi - 1)
        const g = etiket(html, gozcuBasi)
        expect(g).toContain('aria-hidden="true"')
        expect(siniflar(g)).toEqual(['h-px', '-mb-px'])
        expect(html.slice(gozcuBasi + g.length, satirBasi)).toBe('</div>')
    })

    it('kaynak: kok ref li kaydirici; useHomeStickyBar kok, gozcu ve ofsetle (gizlide 0, normalde SERIT_PX) kurulur', () => {
        expect(SABLON).toMatch(/<div ref="kok" class="w-full h-full max-w-\[420px\] mx-auto flex flex-col [^"]*overflow-y-auto/)
        expect(SABLON).toMatch(/<div ref="sekmeGozcu" aria-hidden="true" class="h-px -mb-px"><\/div>/)
        const govde = tekBosluk(cagriGovdesi(HAM, /const yapiskanCubuk = useHomeStickyBar\(/) ?? '')
        expect(govde).toContain('scrollerRef: kok')
        expect(govde).toContain('sentinelRef: sekmeGozcu')
        expect(govde).toContain('offsetPx: () => (privacy.active ? 0 : SERIT_PX)')
        expect(SCRIPT).toMatch(/const yapisti = yapiskanCubuk\.stuck\b/)
        expect(SCRIPT).toMatch(/import \{[^}]*\buseHomeStickyBar\b[^}]*\bSERIT_PX\b[^}]*\} from '\.\.\/composables\/useHomeStickyBar'|import \{[^}]*\bSERIT_PX\b[^}]*\buseHomeStickyBar\b[^}]*\} from '\.\.\/composables\/useHomeStickyBar'/)
    })

    it('kaynak: kaydiriciya overflow-anchor verilmez (spec 7.10); sekme satirinda backdrop-filter yok', () => {
        expect(KOD).not.toContain('overflow-anchor')
        const i = SABLON.indexOf('pt-5 pb-0 border-b')
        const e = SABLON.slice(SABLON.lastIndexOf('<div', i), SABLON.indexOf('<button', i))
        expect(e).toContain('sticky')
        expect(e).not.toContain('backdrop')
    })
})

describe('Home.vue (SSR) -- mini bakiye seridi (G11, spec 7.9 Mini serit, K8, D10)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const SCRIPT = KOD.slice(KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')
    const temizle = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const etiket = (html, bas) => (bas < 0 ? '' : html.slice(bas, html.indexOf('>', bas) + 1))
    const siniflar = (e) => (e.match(/class="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    const KAP = '<div class="sticky top-0 z-30 h-0" aria-hidden="true">'
    const SERIT_SINIFI = 'kaymak-serit absolute inset-x-0 top-0 h-11 flex items-center justify-between px-7 bg-white dark:bg-[#0c0c0e] border-b border-slate-100 dark:border-white/5'
    // Kok kaydiricinin acilis etiketinden hemen sonraki ilk oge.
    const kokIlkCocuk = (html) => etiket(html, html.indexOf('>', html.indexOf('max-w-[420px] mx-auto flex flex-col')) + 1)
    // Serit kabi ve icerigi (kap > serit > etiket span + deger span).
    const serit = (html) => {
        const bas = html.indexOf(KAP)
        return bas < 0 ? '' : html.slice(bas, html.indexOf('</div></div>', bas) + '</div></div>'.length)
    }
    const seritDegeri = (s) => s.match(/<span class="text-\[15px\] font-bold text-slate-900 dark:text-white">([^<]*)<\/span>/)?.[1]
    // Istemci cizimi: SSR'da kok ref'i bos oldugu icin seritHazir false kalir; mount sonrasini taklit etmek icin
    // yakalama aninda (Home'un kendi onMounted'larindan sonra, cizimden once) acilir.
    const istemci = ({ onCapture, ...ek } = {}) => mountHome({ ...ek, onCapture: (i) => { i.setupState.seritHazir = true; onCapture?.(i) } })

    it.each([false, true])('SSR HTML de serit yok (gizli=%s): kaymak-serit, kap ve Total balance yok; seritHazir false; data-balance-toggle tek', async (gizli) => {
        const { html, state } = await mountHome({ gizli })
        expect(html).not.toContain('kaymak-serit')
        expect(html).not.toContain('sticky top-0 z-30 h-0')
        expect(html).not.toContain('Total balance')
        expect(state.seritHazir).toBe(false)
        expect(say(html, 'data-balance-toggle')).toBe(1)
    })

    it('istemcide normal mod: serit kabi kokun ilk cocugu (Header dan once), aria-hidden; serit sinifi mevcut renklerle, gorunmezken kaymak-serit-gizli', async () => {
        const { html } = await istemci({ gizli: false })
        const t = temizle(html)
        expect(kokIlkCocuk(t)).toBe(KAP)
        const s = serit(t)
        expect(s.indexOf('<header')).toBe(-1)
        expect(t.indexOf('<header')).toBeGreaterThan(t.indexOf(KAP))
        const ic = etiket(s, s.indexOf('<div', 1))
        // SSR dinamik sinifi statik siniftan once yazar; kume olarak karsilastirilir.
        expect(siniflar(ic).sort()).toEqual([...SERIT_SINIFI.split(' '), 'kaymak-serit-gizli'].sort())
        expect(say(t, 'kaymak-serit-gizli')).toBe(1)
    })

    it('istemcide: solda Total balance etiketi, sagda moneyOrZero(filteredUsd) toplami', async () => {
        ag.ton = async () => 0
        const { html, state } = await istemci({ gizli: false })
        const s = serit(temizle(html))
        expect(s).toContain('<span class="text-xs text-slate-500 dark:text-zinc-400">Total balance</span>')
        expect(seritDegeri(s)).toBe(state.moneyOrZero(state.filteredUsd))
        expect(seritDegeri(s)).toBe('$0.00')
    })

    it('istemcide: seritte goz dugmesi ve leading-tight yok; data-balance-toggle tek; Home.ssr baslik ayiklayicisi hala basligi alir', async () => {
        const { html } = await istemci({ gizli: false })
        const t = temizle(html)
        const s = serit(t)
        expect(s).not.toContain('data-balance-toggle')
        expect(s).not.toContain('leading-tight')
        expect(s).not.toContain('<button')
        expect(say(t, 'data-balance-toggle')).toBe(1)
        const b = t.match(/<span class="[^"]*leading-tight[^"]*">[\s\S]*?<button/)[0]
        expect(b).toContain('<span class="relative tabular-nums">')
        expect(b).not.toContain('kaymak-serit')
    })

    it('istemcide bakiye gizliyse seritte ****, sayi yok', async () => {
        const { html } = await istemci({ gizli: false, sayfa: { balanceVisible: false }, depo: { isBalanceVisible: false } })
        const s = serit(temizle(html))
        expect(seritDegeri(s)).toBe('****')
        expect(s).not.toContain('0.00')
    })

    it('istemcide baslik cikinca (seritGorunur) kaymak-serit-gizli duser', async () => {
        const { html, state } = await istemci({ gizli: false, onCapture: (i) => { i.setupState.seritGorunur = true } })
        expect(state.seritGorunur).toBe(true)
        const s = serit(temizle(html))
        const ic = etiket(s, s.indexOf('<div', 1))
        expect(siniflar(ic).sort()).toEqual(SERIT_SINIFI.split(' ').sort())
    })

    it('gizli modda istemcide de serit cizilmez (seritHazir true olsa da)', async () => {
        const { html, state } = await istemci({ gizli: true })
        expect(state.seritHazir).toBe(true)
        expect(html).not.toContain('kaymak-serit')
        expect(html).not.toContain('sticky top-0 z-30 h-0')
        expect(html).not.toContain('Total balance')
    })

    it('kaynak: serit kokun ilk cocugu; v-if="seritHazir && !privacy.active", aria-hidden; metin isBalanceVisible ? ... : ****; goz dugmesi ve leading-tight yok', () => {
        const s = tekBosluk(SABLON)
        // G15: kok etiketi simge ucusunun kaydirici isaretini (data-home-scroller) tasir; serit yine ilk cocuk.
        expect(s).toMatch(/<div ref="kok" class="[^"]*" data-home-scroller> <div v-if="seritHazir && !privacy\.active" class="sticky top-0 z-30 h-0" aria-hidden="true"> <div class="kaymak-serit absolute inset-x-0 top-0 h-11 flex items-center justify-between px-7 bg-white dark:bg-\[#0c0c0e\] border-b border-slate-100 dark:border-white\/5" :class="seritGorunur \? '' : 'kaymak-serit-gizli'">/)
        expect(s).toContain(`<span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('home.totalBalance') }}</span>`)
        expect(s).toContain(`<CountingText v-else class="text-[15px] font-bold text-slate-900 dark:text-white" :class="gozDegisSinifi" :text="isBalanceVisible ? moneyOrZero(filteredUsd) : '****'" :value="isBalanceVisible ? filteredUsd : null" :format="moneyOrZero" :identity="sayacKimligi" />`)
        const bas = s.indexOf('<div v-if="seritHazir && !privacy.active"')
        const blok = s.slice(bas, s.indexOf('<Header></Header>', bas))
        expect(blok).toContain('kaymak-serit')
        expect(blok).not.toContain('data-balance-toggle')
        expect(blok).not.toContain('leading-tight')
        expect(blok).not.toContain('<button')
        expect(say(SABLON, 'seritHazir')).toBe(1)
        expect(say(SABLON, 'seritGorunur')).toBe(1)
        expect(say(SABLON, "$t('home.totalBalance')")).toBe(1)
    })

    it('kaynak: seritHazir yalniz senkron bir onMounted ta ve kok.value doluyken true yapilir', () => {
        expect(SCRIPT).toMatch(/const seritHazir = ref\(false\)/)
        expect(SCRIPT).toMatch(/onMounted\(\(\) => \{\s*if \(kok\.value\) seritHazir\.value = true\s*\}\)/)
        expect(say(SCRIPT, 'seritHazir.value =')).toBe(1)
    })

    it('kaynak: useHomeStickyBar baslik ref iyle kurulur; seritGorunur = stripShown; baslik span i ref="baslikBakiye"', () => {
        const govde = tekBosluk(cagriGovdesi(HAM, /const yapiskanCubuk = useHomeStickyBar\(/) ?? '')
        expect(govde).toContain('headlineRef: baslikBakiye')
        expect(govde).toContain('sentinelRef: sekmeGozcu')
        expect(SCRIPT).toMatch(/const baslikBakiye = ref\(null\)/)
        expect(SCRIPT).toMatch(/const seritGorunur = yapiskanCubuk\.stripShown\b/)
        expect(tekBosluk(SABLON)).toMatch(/<span ref="baslikBakiye" class="font-bold text-slate-900 dark:text-white leading-tight /)
        expect(say(SABLON, 'ref="baslikBakiye"')).toBe(1)
    })
})

describe('Home.vue (SSR) -- kaydirma hafizasi (G13, spec 7.10, K2, H10)', () => {
    const HAM = readFileSync(new URL('./Home.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const SCRIPT = KOD.slice(KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')
    const img = { thumb: '/usdt.png', small: '/usdt.png', large: '/usdt.png' }
    const USDT_BSC = { name: 'Tether', symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chain: 'binance-smart-chain', coingecko_id: 'tether', image: img }
    const varlikSatirlari = (html) => html.match(/<button[^>]*kaymak-satir[^>]*>/g) ?? []

    it('varlik satiri data-row-key = chainId_address (tokenBucketKey bicimi, adres kucultulmez)', async () => {
        const { html, state } = await mountHome({ gizli: false, bucket: { 56: [USDT_BSC] }, kapsam: 56 })
        const satir = varlikSatirlari(html).find((e) => e.includes(USDT_BSC.address))
        expect(satir).toBeDefined()
        expect(satir).toContain(`data-row-key="56_${USDT_BSC.address}"`)
        // Gorunen her varlik satirinin anahtari satirAnahtari ile ayni.
        for (const t of state.displayedTokens) expect(html).toContain(`data-row-key="${state.satirAnahtari(t)}"`)
    })

    it("satirAnahtari zincir kimligini normalizeBucketChainId ile yazar ('0x38' gibi bicimler de 56_ olur)", async () => {
        const { state } = await mountHome({ gizli: false })
        expect(state.satirAnahtari({ chainId: 56, address: '0xAbC' })).toBe('56_0xAbC')
        expect(state.satirAnahtari({ chainId: '56', address: '0xAbC' })).toBe('56_0xAbC')
        expect(state.satirAnahtari({ chainId: 'solana', address: 'Mint1' })).toBe('solana_Mint1')
    })

    it('SSR: kok ref i bos, geri yukleme yok ve settled false; bellek yazilmaz', async () => {
        const kayit = { key: 'acc1|0|56', tab: 'assets', top: 300, anchorKey: null, anchorOffset: null }
        const { state } = await mountHome({ gizli: false, kapsam: 56, sayfa: { homeScroll: kayit } })
        expect(await state.kaydirma.settled).toBe(false)
        expect(pageStore().homeScroll).toEqual(kayit)
    })

    it('kaynak: varlik satiri dugmesi :data-row-key="satirAnahtari(token)"; tiklama bagi aynen', () => {
        const dugme = SABLON.match(/<button[^>]*?v-for="token in displayedTokens"[\s\S]*?>/)
        expect(dugme).not.toBeNull()
        expect(dugme[0]).toContain(':data-row-key="satirAnahtari(token)"')
        expect(dugme[0]).toContain('@click="selectToken(token)"')
        expect(say(SABLON, ':data-row-key=')).toBe(2)
    })

    it('kaynak: satirAnahtari = tokenBucketKey(normalizeBucketChainId(token.chainId), token.address)', () => {
        expect(tekBosluk(SCRIPT)).toContain('const satirAnahtari = (token) => tokenBucketKey(normalizeBucketChainId(token.chainId), token.address)')
    })

    it('kaynak: useHomeScrollMemory kok, sayfa deposu, anahtar, gorunen sekme, sinir, liste hazir ve recompute ile kurulur', () => {
        const govde = tekBosluk(cagriGovdesi(HAM, /const kaydirma = useHomeScrollMemory\(/) ?? '')
        expect(govde).toContain('scrollerRef: kok')
        expect(govde).toContain('page,')
        expect(govde).toContain('key: () => scrollKey({ accountKey: user.balancesAccountKey, privateMode: privacy.active, scope: scope.filter })')
        expect(govde).toContain('tab: () => gorunenSekme.value')
        expect(govde).toContain('boundary: () => (privacy.active ? 0 : SERIT_PX) + (sekmeSatiri.value?.offsetHeight ?? 0)')
        expect(govde).toContain('listReady: listeHazir')
        expect(govde).toContain('onRestored: () => yapiskanCubuk.recompute()')
        expect(SCRIPT).toMatch(/import \{ useHomeScrollMemory \} from '\.\.\/composables\/useHomeScrollMemory'/)
        expect(SCRIPT).toMatch(/import \{ scrollKey \} from '\.\.\/utils\/motion\/scrollMemory'/)
    })

    it('kaynak: denetleyici listeHazir ve yapiskanCubuk tanimlarindan SONRA kurulur', () => {
        const kurulum = SCRIPT.indexOf('const kaydirma = useHomeScrollMemory(')
        expect(kurulum).toBeGreaterThan(SCRIPT.indexOf('const listeHazir = ref(false)'))
        expect(kurulum).toBeGreaterThan(SCRIPT.indexOf('const yapiskanCubuk = useHomeStickyBar('))
    })
})

describe('Home.vue (SSR) -- simge ucusu isaretleri (G15, spec 7.5, H7)', () => {
    const img = { thumb: '/usdt.png', small: '/usdt.png', large: '/usdt.png' }
    const USDT_BSC = { name: 'Tether', symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chain: 'binance-smart-chain', coingecko_id: 'tether', image: img }
    // Anahtarli varlik satirinin icindeki data-flight-icon'lu acilis etiketini (simge kabi) doner.
    const simgeKabi = (html, anahtar) => {
        const satir = html.indexOf(`data-row-key="${anahtar}"`)
        if (satir === -1) return null
        const i = html.indexOf('data-flight-icon=', satir)
        if (i === -1 || i > html.indexOf('</button>', satir)) return null
        return html.slice(html.lastIndexOf('<div', i), html.indexOf('>', i) + 1)
    }

    it('normal mod: varlik satirinin simge kabinda data-flight-icon="56_0x..." (satir anahtariyla ayni)', async () => {
        const { html, state } = await mountHome({ gizli: false, bucket: { 56: [USDT_BSC] }, kapsam: 56 })
        const anahtar = `56_${USDT_BSC.address}`
        const kap = simgeKabi(html, anahtar)
        expect(kap).not.toBeNull()
        expect(kap).toContain(`data-flight-icon="${anahtar}"`)
        expect(kap).toContain('relative min-w-10 h-10 rounded-full bg-slate-100')
        // Gorunen her varlik satirinin simge kabi, kendi satir anahtarini tasir.
        for (const t of state.displayedTokens) expect(html).toContain(`data-flight-icon="${state.satirAnahtari(t)}"`)
        expect(say(html, 'data-flight-icon=')).toBe(state.displayedTokens.length)
    })

    it('kok kaydirici data-home-scroller, sekme satiri data-home-tabs tasir (birer kez)', async () => {
        const { html } = await mountHome({ gizli: false })
        expect(say(html, 'data-home-scroller')).toBe(1)
        expect(say(html, 'data-home-tabs')).toBe(1)
        const i = html.indexOf('data-home-tabs')
        expect(html.slice(html.lastIndexOf('<div', i), html.indexOf('>', i) + 1)).toContain('pt-5 pb-0 border-b')
    })

    it('saglayici yokken (SSR, App disi) inject null: hazir sinyali sessizce atlanir', async () => {
        const { state } = await mountHome({ gizli: false, kapsam: 56 })
        expect(state.ucus).toBeNull()
        expect(await state.kaydirma.settled).toBe(false)
    })
})
