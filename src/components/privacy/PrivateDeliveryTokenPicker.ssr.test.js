import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
const api = vi.hoisted(() => ({ post: null }))
vi.mock('axios', () => ({ default: { post: (...a) => api.post(...a) } }))

import { getAddress } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { shortenAddress } from '../../utils/shortenAddress'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'

const CAKE = getAddress('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82')
// Gizli modda LOGOSUZ SATIR GOSTERILMEZ (hasPrivateLogo): listede gorunmesi beklenen fixture tokenlari PAKETLI (ag, adres) ciftleridir
// (public/tokens); NOLOGO adreslerinin paketli logosu yoktur ve gizlenmeleri beklenir.
const XYZ = getAddress('0x00f8da33734feb9b946fec2228c25072d2e2e41f')
const NOLOGO = getAddress('0x' + '42'.repeat(20))
const BASE_USDC = getAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const BASE_X = getAddress('0x940181a94a35a4569e4529a3cdfb74e38fd98631')
const REMOTE = [
    { address: '0x0', symbol: 'BNB', name: 'BNB', decimals: 18, native: true, image: { large: 'https://img/bnb.png' } },
    { address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18, image: { large: 'https://img/usdc.png' } },
    { address: CAKE.toLowerCase(), symbol: 'CAKE', name: 'PancakeSwap', decimals: 18 },
    { address: getAddress('0x' + '11'.repeat(20)), symbol: 'NODEC', name: 'Ondaliksiz' },
    { address: getAddress('0x0782b6d8c4551b9760e74c0545a9bcd90bdc41e5'), symbol: '<b>X</b>', name: 'Kacis', decimals: 18 },
    { address: NOLOGO, symbol: 'NOLOGO', name: 'Logosuz', decimals: 18 },
]

afterEach(() => { delete globalThis.chrome })

function mount({ nativeEnabled = true, selected = null, post, chainId = 56 } = {}) {
    installChromeStub({
        active_account: { key: 'g-1' },
        // Ice aktarilan tokenler ag kovasina gore saklanir (imported_tokens[hesap][chainId]).
        imported_tokens: { 'g-1': {
            56: [{ address: XYZ, symbol: 'XYZ', name: 'Xyz Token', decimals: 9 }],
            8453: [{ address: BASE_X, symbol: 'BX', name: 'Base Token', decimals: 8 }],
        } },
    })
    const calls = []
    api.post = post || (async (url, body) => { calls.push({ url, body }); return { data: { tokens: REMOTE } } })
    const events = { select: [], logos: [], close: 0 }
    const app = createApp(PrivateDeliveryTokenPicker, {
        props: { chainId, nativeEnabled, selected, onSelect: (t, logo) => { events.select.push(t); events.logos.push(logo) }, onClose: () => { events.close++ } },
    })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'PrivateDeliveryTokenPicker')
    return { app, captured, calls, events }
}

describe('PrivateDeliveryTokenPicker', () => {
    it('dialog; sira BNB, USDC, ice aktarilan, sunucu listesi; bozuk kayit yok; USDC bir kez', async () => {
        const html = await render(mount().app)
        expect(html).toContain('role="dialog"')
        expect(html).toContain('aria-modal="true"')
        const at = (s) => html.indexOf(`>${s}<`)
        expect(at('BNB')).toBeGreaterThan(-1)
        expect(at('BNB')).toBeLessThan(at('USDC'))
        expect(at('USDC')).toBeLessThan(at('XYZ'))
        expect(at('XYZ')).toBeLessThan(at('CAKE'))
        expect(html).not.toContain('NODEC')
        expect(html.split('>USDC<').length - 1).toBe(1)
    })

    it('sunucu listesi istegi hesap adresi tasimaz: yalniz BSC, sayfa ve limit', async () => {
        const { app, calls } = mount()
        await render(app)
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toMatch(/\/getChainTokens$/)
        expect(calls[0].body).toEqual({ chain: 'binance-smart-chain', chainId: 56, skip: 0, limit: 100 })
    })

    it('yerel teslim kapaliyken BNB listelenmez', async () => {
        const html = await render(mount({ nativeEnabled: false }).app)
        expect(html).not.toContain('>BNB<')
        expect(html).toContain('>USDC<')
    })

    it('liste yuklenemezse BNB, USDC ve ice aktarilanlar yine secilebilir (Review Focus 2)', async () => {
        const html = await render(mount({ post: async () => { throw new Error('ag yok') } }).app)
        expect(html).toContain('>BNB<')
        expect(html).toContain('>USDC<')
        expect(html).toContain('>XYZ<')
        expect(html).not.toContain('Loading...')
    })

    it('sembol HTML olarak yorumlanmaz', async () => {
        const html = await render(mount().app)
        // Sembol normalizeDeliveryToken'da buyuk harfe cevrilir: <b>X</b> -> <B>X</B>; kacislanmis hali beklenir.
        expect(html).not.toContain('<b>X</b>')
        expect(html).not.toContain('<B>X</B>')
        expect(html).toContain('&lt;B&gt;X&lt;/B&gt;')
    })


    it('secim yalniz { chainId, address, symbol, decimals } yayar; kapatma close yayar', async () => {
        const { app, captured, events } = mount({ selected: { chainId: 56, address: CAKE, symbol: 'CAKE', decimals: 18 } })
        await render(app)
        const s = captured.instance.setupState
        s.choose(s.tokens.find((t) => t.symbol === 'CAKE'))
        expect(events.select).toEqual([{ chainId: 56, address: CAKE, symbol: 'CAKE', decimals: 18 }])
        s.close()
        expect(events.close).toBe(1)
    })

    // FU7: yalniz BIR isaret var ve secili tokenin satirinda; secili satir aria-current tasir (FU8).
    it('secili token tam bir kez isaretlenir ve isaret secili tokenin satirindadir', async () => {
        const html = await render(mount({ selected: { chainId: 56, address: CAKE.toLowerCase(), symbol: 'CAKE', decimals: 18 } }).app)
        expect(html.split('data-selected="true"').length - 1).toBe(1)
        expect(rowOf(html, 'CAKE')).toContain('data-selected="true"')
        expect(rowOf(html, 'CAKE')).toContain('aria-current="true"')
        for (const sembol of ['BNB', 'USDC', 'XYZ']) {
            expect(rowOf(html, sembol), sembol).not.toContain('data-selected')
            expect(rowOf(html, sembol), sembol).not.toContain('aria-current')
        }
    })

    // Logolar TEK cozucudan (privateTokenLogo): secim logo tasimaz, satir sunucu gorselini degil paketli dosyayi cizer.
    it('satir logolari paketli: BNB yerel coin logosu, USDC /usdc.png, paketli CAKE kendi dosyasi, bilinmeyen token yedek simge; secim logo tasimaz', async () => {
        const { app, captured, events } = mount()
        const html = await render(app)
        expect(rowOf(html, 'BNB')).toMatch(/<img[^>]*src="\/chains\/56\.png"/)
        expect(rowOf(html, 'USDC')).toMatch(/<img[^>]*src="\/usdc\.png"/)
        expect(rowOf(html, 'CAKE')).toMatch(new RegExp(`<img[^>]*src="/tokens/56/${CAKE.toLowerCase()}\.png"`))
        expect(rowOf(html, 'XYZ')).toMatch(new RegExp(`<img[^>]*src="/tokens/56/${XYZ.toLowerCase()}\.png"`))
        // Paketli logosu olmayan sunucu satiri (NOLOGO) gri yer tutucuyla DEGIL, hic cizilmez (gizli modda logosuz satir yok).
        expect(html).not.toContain('>NOLOGO<')
        expect(html).not.toContain('/default-token.png"')
        const s = captured.instance.setupState
        s.choose(s.tokens.find((t) => t.symbol === 'BNB'))
        s.choose(s.tokens.find((t) => t.symbol === 'CAKE'))
        expect(events.logos).toEqual([undefined, undefined])
    })

    it('sunucu listesi cekilemezse USDC satiri yer tutucu degil yerel /usdc.png logosunu gosterir', async () => {
        const html = await render(mount({ post: async () => { throw new Error('ag yok') } }).app)
        expect(rowOf(html, 'USDC')).toMatch(/<img[^>]*src="\/usdc\.png"/)
    })

    it('BNB satiri tam olarak { 56, sifir adres, BNB, 18 } yayar', async () => {
        const { app, captured, events } = mount()
        await render(app)
        const s = captured.instance.setupState
        s.choose(s.tokens.find((t) => t.symbol === 'BNB'))
        expect(events.select).toEqual([{ chainId: 56, address: '0x0000000000000000000000000000000000000000', symbol: 'BNB', decimals: 18 }])
    })

    // SSR'da izleyiciler calismaz: bu test yerel suzmeyi ve istek govdesini loadRemote'u ELLE cagirarak sinar;
    // izleyicinin loadRemote'a baglandigi ayri bir kaynak kilidi testinde (asagida) kilitli.
    it('arama (yerel suzme + istek govdesi): liste suzulur ve loadRemote sunucuya search gonderir', async () => {
        const { app, captured, calls } = mount()
        await render(app)
        const s = captured.instance.setupState
        s.search = 'cake'
        expect(s.tokens.map((t) => t.symbol)).toEqual(['CAKE'])
        await s.loadRemote('cake')
        expect(calls[1].body).toEqual({ chain: 'binance-smart-chain', chainId: 56, skip: 0, limit: 100, search: 'cake' })
    })

    it('arama kaynak kilidi: watch(search) SEARCH_DEBOUNCE_MS ile loadRemote a baglanir', () => {
        const kaynak = kaynakOku('./PrivateDeliveryTokenPicker.vue')
        expect(kaynak).toContain('watch(search, onSearchChanged)')
        expect(kaynak).toMatch(/function onSearchChanged\(q\) \{[\s\S]*?setTimeout\(\(\) => loadRemote\(q\), SEARCH_DEBOUNCE_MS\)/)
    })

    // FU3: tek karakterlik arama sunucuya gitmez (yerel suzme yine uygulanir); bos arama varsayilan listeyi yukler.
    it('sunucu aramasi yalniz kirpilmis 2+ karakterde gider; 1 karakter istek yapmaz', async () => {
        const { app, captured, calls } = mount()
        await render(app)
        const s = captured.instance.setupState
        expect(calls).toHaveLength(1)
        await s.loadRemote('c')
        await s.loadRemote('  c ')
        expect(calls).toHaveLength(1)
        await s.loadRemote('ca')
        expect(calls).toHaveLength(2)
        expect(calls[1].body.search).toBe('ca')
        await s.loadRemote('')
        expect(calls).toHaveLength(3)
        expect(calls[2].body).not.toHaveProperty('search')
        s.search = 'c'
        const semboller = s.tokens.map((t) => t.symbol)
        expect(semboller).toContain('CAKE')
        expect(semboller).toContain('USDC')
        expect(semboller).not.toContain('BNB')
    })

    it('satir logosu tembel, async, no-referrer ve hata yedegi tasir', async () => {
        const html = await render(mount().app)
        const usdc = rowOf(html, 'USDC')
        const img = usdc.match(/<img[^>]*>/)[0]
        expect(img).toContain('loading="lazy"')
        expect(img).toContain('decoding="async"')
        expect(img).toContain('referrerpolicy="no-referrer"')
        const kaynak = kaynakOku('./PrivateDeliveryTokenPicker.vue')
        expect(kaynak).toContain('@error="onLogoError"')
        expect(kaynak).toMatch(/function onLogoError\(e\) \{\s*e\.target\.onerror = null\s*e\.target\.src = '\/default-token\.png'/)
    })

    // FU5: BNB ve BSC USDC disindaki tokenlarda kisa sozlesme adresi (taklit tokenleri ayirt etmek icin).
    it('BNB ve USDC disindaki satirlar kisa sozlesme adresini gosterir; BNB ve USDC gostermez', async () => {
        const html = await render(mount().app)
        expect(rowOf(html, 'CAKE')).toContain(shortenAddress(CAKE))
        expect(rowOf(html, 'XYZ')).toContain(shortenAddress(XYZ))
        for (const sembol of ['BNB', 'USDC']) expect(rowOf(html, sembol), sembol).not.toMatch(/0x[0-9a-fA-F]{4}\.\.\./)
    })

    // Cilalama P3: adres satiri okunur kontrast (en az slate-500 / dark zinc-400) ve addan daha sonuk.
    it('kisa adres satiri okunur kontrast tasir ve ad satirindan daha sonuktur', async () => {
        const html = await render(mount().app)
        const cake = rowOf(html, 'CAKE')
        const adres = cake.match(/<span class="([^"]*)"[^>]*>0x0E09[^<]*<\/span>/)[1]
        const ad = cake.match(/<span class="([^"]*)"[^>]*>PancakeSwap<\/span>/)[1]
        expect(adres).toContain('text-slate-500')
        expect(adres).toContain('dark:text-zinc-400')
        expect(adres).not.toMatch(/text-slate-[34]00|dark:text-zinc-[5-9]00/)
        expect(ad).toMatch(/text-slate-600/)
        expect(ad).toMatch(/dark:text-zinc-300/)
    })

    // Cilalama P4: panel sabit yuksekliktedir (icerik suzulunce ust kenar ziplamaz); liste panel icinde kayar.
    it('panel sabit yukseklikte (h-[80%]) ve liste kendi icinde kayar', async () => {
        // Ham kaynak: yorumsuz() tarayicisi bg-slate-900/50 gibi sinif egik cizgilerini regex sanip metni yutabilir.
        const kaynak = readFileSync(fileURLToPath(new URL('./PrivateDeliveryTokenPicker.vue', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/class="pi-panel [^"]*h-\[80%\]/)
        expect(kaynak).not.toMatch(/class="pi-panel [^"]*max-h-/)
        expect(kaynak).toMatch(/<ul class="flex-1 min-h-0 overflow-y-auto/)
    })

    // FU8: arama kutusunun erisilebilir adi var.
    it('arama kutusu aria-label tasir', async () => {
        const html = await render(mount().app)
        expect(html).toMatch(/<input[^>]*aria-label="Search tokens"/)
    })
})

// Cok agli teslim (gizli-mod cok-ag spec 4.8): liste, istek ve secim SECILEN agin kimligini tasir.
describe('PrivateDeliveryTokenPicker -- cok agli teslim', () => {
    const BASE_REMOTE = [
        { address: BASE_USDC.toLowerCase(), symbol: 'USDC', name: 'USD Coin', decimals: 6 },
        { address: getAddress('0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf'), symbol: 'AERO', name: 'Aerodrome', decimals: 18 },
    ]
    const basePost = (calls) => async (url, body) => { calls.push(body); return { data: { tokens: BASE_REMOTE } } }

    it('Base: o agin yerel coini ve USDC si, o agin ice aktarilanlari ve sunucu listesi; BSC satirlari gorunmez; istek Base slug ve chainId tasir', async () => {
        const calls = []
        const html = await render(mount({ chainId: 8453, post: basePost(calls) }).app)
        const sira = ['ETH', 'USDC', 'BX', 'AERO'].map((sembol) => html.indexOf(`>${sembol}<`))
        expect(sira.every((i) => i > -1), sira.join()).toBe(true)
        expect([...sira].sort((a, b) => a - b)).toEqual(sira)
        for (const sembol of ['BNB', 'CAKE', 'XYZ']) expect(html, sembol).not.toContain(`>${sembol}<`)
        expect(html.split('>USDC<').length - 1).toBe(1)
        expect(calls).toEqual([{ chain: 'base', chainId: 8453, skip: 0, limit: 100 }])
    })

    it('Base secimi { chainId, address, symbol, decimals } yayar: USDC 6 ondalik, ETH sifir adres 18; satirda ETH logosu (Base logosu degil)', async () => {
        const { app, captured, events } = mount({ chainId: 8453, post: basePost([]) })
        const html = await render(app)
        expect(rowOf(html, 'ETH')).toMatch(/<img[^>]*src="\/chains\/1\.png"/)
        const s = captured.instance.setupState
        s.choose(s.tokens.find((t) => t.symbol === 'ETH'))
        s.choose(s.tokens.find((t) => t.symbol === 'USDC'))
        expect(events.select).toEqual([
            { chainId: 8453, address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 },
            { chainId: 8453, address: BASE_USDC, symbol: 'USDC', decimals: 6 },
        ])
        expect(events.logos).toEqual([undefined, undefined])
    })

    // PF-C3: olay chainId'yi satirin damgasindan degil panelin chainId prop'undan alir (spec 4.1 damgalama 3, bolum 8).
    it('secim olayi satirin kendi chainId damgasini degil panelin chainId prop unu tasir', async () => {
        const { app, captured, events } = mount({ chainId: 8453, post: basePost([]) })
        await render(app)
        const s = captured.instance.setupState
        const satir = s.tokens.find((t) => t.symbol === 'USDC')
        s.choose({ ...satir, chainId: 56 })
        expect(events.select).toEqual([{ chainId: 8453, address: BASE_USDC, symbol: 'USDC', decimals: 6 }])
    })

    it('kimlik (chainId, adres): ayni adres baska agda secili sayilmaz', async () => {
        const secili = (selected) => render(mount({ chainId: 8453, selected, post: basePost([]) }).app)
        const dogru = await secili({ chainId: 8453, address: BASE_USDC, symbol: 'USDC', decimals: 6 })
        expect(dogru.split('data-selected="true"').length - 1).toBe(1)
        expect(rowOf(dogru, 'USDC')).toContain('data-selected="true"')
        const baskaAg = await secili({ chainId: 56, address: BASE_USDC, symbol: 'USDC', decimals: 18 })
        expect(baskaAg).not.toContain('data-selected')
    })

    it('yerel teslim kapaliyken Base ETH satiri yok, USDC var', async () => {
        const html = await render(mount({ chainId: 8453, nativeEnabled: false, post: basePost([]) }).app)
        expect(html).not.toContain('>ETH<')
        expect(html).toContain('>USDC<')
    })

    it('ATS satiri yalniz BSC listesinde: BSC listesinde var, Base listesinde yok', async () => {
        const bsc = await render(mount({ post: basePost([]) }).app)
        expect(bsc).toContain('>ATS<')
        const base = await render(mount({ chainId: 8453, post: basePost([]) }).app)
        expect(base).not.toContain('>ATS<')
    })

    it('tabloda olmayan ag: liste bos, sunucuya sorulmaz, panel cokmez ve kapatilabilir', async () => {
        const calls = []
        const { app, captured, events } = mount({ chainId: 99999, post: basePost(calls) })
        await render(app)
        const s = captured.instance.setupState
        expect(s.tokens).toEqual([])
        expect(calls).toEqual([])
        s.close()
        expect(events.close).toBe(1)
    })
})

// FU4: yukleme / hata / bos durumlari.
describe('PrivateDeliveryTokenPicker -- yukleme, hata ve onbellek', () => {
    // Bos sorgu varsayilan sayfayi, 'dog' sorgusu tek DOGE satirini dondurur.
    const DOGE = { address: getAddress('0x0df0587216a4a1bb7d5082fdc491d93d2dd4b413'), symbol: 'DOGE', name: 'Doge', decimals: 8 }
    const bySearch = (calls) => async (url, body) => {
        calls.push({ url, body })
        return { data: { tokens: body.search ? [DOGE] : REMOTE } }
    }

    it('ilk yukleme basarisizsa mesaj ve tekrar dene dugmesi gorunur; BNB, USDC ve ice aktarilanlar secilebilir kalir', async () => {
        const { app, captured } = mount({ post: async () => { throw new Error('ag yok') } })
        const html = await render(app)
        expect(html).toContain('Could not load tokens. Please check your connection.')
        expect(html).toContain('Try again')
        expect(html).not.toContain('No tokens found')
        for (const sembol of ['BNB', 'USDC', 'XYZ']) expect(rowOf(html, sembol), sembol).toContain('<button')
        const s = captured.instance.setupState
        expect(s.loadFailed).toBe(true)
        s.choose(s.tokens.find((t) => t.symbol === 'XYZ'))
    })

    it('basarili yuklemede hata mesaji yok', async () => {
        const html = await render(mount().app)
        expect(html).not.toContain('Could not load tokens')
        expect(html).not.toContain('Try again')
    })

    it('istek basarisiz olunca son iyi liste korunur, loadFailed kalkar tekrar denemede', async () => {
        let fail = false
        const calls = []
        const { app, captured } = mount({ post: async (url, body) => { calls.push(body); if (fail) throw new Error('ag yok'); return { data: { tokens: REMOTE } } } })
        await render(app)
        const s = captured.instance.setupState
        expect(s.loadFailed).toBe(false)
        fail = true
        await s.loadRemote('ca')
        expect(s.loadFailed).toBe(true)
        expect(s.loading).toBe(false)
        expect(s.tokens.map((t) => t.symbol)).toEqual(expect.arrayContaining(['BNB', 'USDC', 'XYZ', 'CAKE']))
        fail = false
        await s.loadRemote('ca')
        expect(s.loadFailed).toBe(false)
    })

    it('tekrar dene dugmesi gecerli aramayla yeniden ister; 1 karakterde varsayilan listeyi ister', async () => {
        const { app, captured, calls } = mount({ post: async () => { throw new Error('ag yok') } })
        await render(app)
        const s = captured.instance.setupState
        api.post = async (url, body) => { calls.push({ url, body }); return { data: { tokens: REMOTE } } }
        s.search = 'cake'
        await s.retry()
        expect(calls.at(-1).body.search).toBe('cake')
        expect(s.loadFailed).toBe(false)
        s.search = 'c'
        await s.retry()
        expect(calls.at(-1).body).not.toHaveProperty('search')
    })

    it('arama temizlenince onbellekteki varsayilan sayfa ANINDA geri gelir (istek beklenmez)', async () => {
        const calls = []
        const { app, captured } = mount({ post: bySearch(calls) })
        await render(app)
        const s = captured.instance.setupState
        await s.loadRemote('dog')
        expect(s.tokens.map((t) => t.symbol)).toContain('DOGE')
        expect(s.tokens.map((t) => t.symbol)).not.toContain('CAKE')
        api.post = () => new Promise(() => {})
        s.loadRemote('')
        expect(s.tokens.map((t) => t.symbol)).toContain('CAKE')
        expect(s.tokens.map((t) => t.symbol)).not.toContain('DOGE')
        // onbellekten donerken "Loading..." yanip sonmez
        expect(s.loading).toBe(false)
    })

    // Cilalama P5: sunucu aramasi beklerken eslesen yerel satirlar (BNB, USDC, ice aktarilan) gorunur kalir,
    // "Yukleniyor" satiri onlarin ALTINDA cikar; hic eslesme yoksa yalniz yukleniyor satiri vardir.
    describe('sunucu aramasi beklerken', () => {
        // Render sirasinda istek "bekliyor" durumuna getirilir: arama metni + loading elle kurulur, istegin finally'si
        // eski sayilir (requestSeq artar) ve loading'i kapatamaz. SSR'da izleyiciler calismaz, durum dogrudan surulur.
        async function pendingHtml(query) {
            let s
            const { app, captured } = mount({ post: async () => {
                // Ilk cagri bilesenin kendi serverPrefetch'inden gelir; instance henuz yakalanmamis olabilir.
                await new Promise((r) => setTimeout(r, 0))
                s = captured.instance.setupState
                s.onSearchChanged('')
                s.search = query
                s.loading = true
                return { data: { tokens: REMOTE } }
            } })
            const html = await render(app)
            return { html, s }
        }

        it('eslesen yerel satirlar gorunur, yukleniyor satiri satirlarin altindadir', async () => {
            const { html, s } = await pendingHtml('bn')
            expect(s.loading).toBe(true)
            expect(html).toContain('>BNB<')
            expect(html).toContain('Loading...')
            expect(html.indexOf('>BNB<')).toBeLessThan(html.indexOf('Loading...'))
            expect(html).not.toContain('No tokens found')
        })

        it('ice aktarilan token da eslesirse gorunur; eslesmeyen satirlar gizlenir', async () => {
            const { html } = await pendingHtml('xyz')
            expect(html).toContain('>XYZ<')
            expect(html).not.toContain('>USDC<')
            expect(html.indexOf('>XYZ<')).toBeLessThan(html.indexOf('Loading...'))
        })

        it('hic yerel eslesme yoksa yalniz yukleniyor satiri gorunur', async () => {
            const { html } = await pendingHtml('zzqq')
            expect(html).toContain('Loading...')
            expect(html).not.toContain('<button type="button" class="w-full flex items-center gap-3')
            expect(html).not.toContain('No tokens found')
        })
    })

    describe('arama degisimi (onSearchChanged)', () => {
        afterEach(() => { vi.useRealTimers() })

        it('2+ karakter yazilinca istek bitene kadar yukleniyor durumu aciktir ("bulunamadi" cakmaz)', async () => {
            const calls = []
            const { app, captured } = mount({ post: bySearch(calls) })
            // SSR render gercek zamanda biter; sahte zamanlayici yalniz debounce icin.
            await render(app)
            vi.useFakeTimers()
            const s = captured.instance.setupState
            const once = calls.length
            s.search = 'zz'
            s.onSearchChanged('zz')
            expect(s.loading).toBe(true)
            expect(s.tokens).toEqual([])
            expect(calls).toHaveLength(once)
            await vi.advanceTimersByTimeAsync(300)
            expect(calls).toHaveLength(once + 1)
            expect(calls.at(-1).body.search).toBe('zz')
            expect(s.loading).toBe(false)
        })

        it('tek karakter ve bos arama beklemeden onbellekten doner, tek karakter istek yapmaz', async () => {
            const calls = []
            const { app, captured } = mount({ post: bySearch(calls) })
            await render(app)
            vi.useFakeTimers()
            const s = captured.instance.setupState
            await s.loadRemote('dog')
            const once = calls.length
            s.search = 'c'
            s.onSearchChanged('c')
            expect(s.loading).toBe(false)
            expect(s.tokens.map((t) => t.symbol)).toContain('CAKE')
            await vi.advanceTimersByTimeAsync(400)
            expect(calls).toHaveLength(once)
            s.search = ''
            s.onSearchChanged('')
            await vi.advanceTimersByTimeAsync(400)
            expect(calls).toHaveLength(once + 1)
            expect(calls.at(-1).body).not.toHaveProperty('search')
        })
    })
})

// Satir HTML'i: sembolu iceren <li> parcasi.
function rowOf(html, symbol) {
    return html.split('<li').find((parca) => parca.includes(`>${symbol}<`)) || ''
}
function kaynakOku(yol) {
    return yorumsuz(readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8'))
}
