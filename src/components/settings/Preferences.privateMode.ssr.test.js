// Preferences.vue (SSR) -- GIZLI MOD ANAHTARLARI (grafit karari, kullanici 2026-10-26).
// Gizli modda indigo notr griye eslenir (style.css "GIZLI MOD MOR PALETI NOTRLESIR"): koyu temada ACIK anahtarin zemini
// (indigo-500 -> orta gri, #797c81) KAPALI anahtarin zemininden (slate-300, #cad5e2) SONUK kaliyor, durum TERS okunuyordu.
// Yan panel anahtari zumrut kullaniyordu: ikinci bir "acik" dili (zumrut gizli modda yalniz "bir koruma acik" demek).
// Gizli modda uc anahtar ayni dili konusur: ACIK zemin murekkep, KAPALI zemin notr gri, topuz koyu temada zeminle
// zitlasir. Her iddianin KONTROL cifti var: normal modda siniflar AYNEN kalir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { privacyStore } from '../../store/privacy'
import Preferences from './Preferences.vue'

afterEach(() => { delete globalThis.chrome })

// `acik`: uc anahtarin (tema, kullanim istatistigi, yan panel) depodaki durumu. `userTheme` her zaman dolu: bos kalirsa
// tema okumasi `window.matchMedia` dalina duser (bu ortamda window yok). `sidePanel`: panelSupported() bunu arar;
// yoksa kayitli 'sidepanel' popup'a duser ve yan panel anahtari ACIK cizilemezdi. `dilModali`: Dil Secimi listesi acik.
async function ciz({ gizli, acik, dilModali = false }) {
    installChromeStub({
        userTheme: acik ? 'dark' : 'light',
        analytics_enabled: acik,
        uiMode: acik ? 'sidepanel' : 'popup',
    })
    globalThis.chrome.sidePanel = {}
    const app = createApp(Preferences)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    privacyStore().active = gizli
    if (dilModali) captureInstance(app, 'Preferences', (i) => { i.setupState.showLangModal = true })
    return render(app)
}

const ANAHTARLAR = ['Theme', 'Usage statistics', 'Open in side panel']

// Etiketi tasiyan satirin (<button>) basindan kapanisina kadar.
const satir = (html, etiket) => {
    const i = html.indexOf(`>${etiket}<`)
    expect(i, etiket).toBeGreaterThan(-1)
    return html.slice(html.lastIndexOf('<button', i), html.indexOf('</button>', i))
}
// Parcada verilen siniflarin HEPSINI tasiyan ilk ogenin sinif listesi, sirali (sinif sirasi gorunumu degistirmez).
const siniflar = (parca, ...isaretler) => {
    const listeler = [...parca.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean))
    return [...(listeler.find((s) => isaretler.every((i) => s.includes(i))) ?? [])].sort()
}
const zemin = (html, etiket) => siniflar(satir(html, etiket), 'h-6', 'w-11')
const topuz = (html, etiket) => siniflar(satir(html, etiket), 'h-5', 'w-5')
const sirali = (...s) => s.sort()

// Durumdan bagimsiz siniflar, kaynaktan elle kopyalandi (normal modda bugun cizilen).
const ZEMIN = ['relative', 'inline-flex', 'h-6', 'w-11', 'shrink-0', 'cursor-pointer', 'rounded-full', 'border-2', 'border-transparent', 'transition-colors', 'duration-500', 'ease-in-out', 'focus:outline-none']
const TOPUZ = ['pointer-events-none', 'inline-block', 'h-5', 'w-5', 'transform', 'rounded-full', 'bg-white', 'shadow-md', 'ring-0', 'transition', 'duration-500', 'ease-in-out']

describe('Preferences.vue (SSR) -- gizli modda anahtarlar grafit: ACIK murekkep, KAPALI notr gri', () => {
    it('KONTROL: normal modda ACIK zemin indigo (yan panel zumrut), topuz beyaz ve sagda', async () => {
        const html = await ciz({ gizli: false, acik: true })
        expect(zemin(html, 'Theme')).toEqual(sirali(...ZEMIN, 'bg-indigo-500'))
        expect(zemin(html, 'Usage statistics')).toEqual(sirali(...ZEMIN, 'bg-indigo-500'))
        expect(zemin(html, 'Open in side panel')).toEqual(sirali(...ZEMIN, 'bg-emerald-500'))
        for (const e of ANAHTARLAR) expect(topuz(html, e), e).toEqual(sirali(...TOPUZ, 'translate-x-5'))
    })

    it('KONTROL: normal modda KAPALI zemin slate-300, topuz beyaz ve solda', async () => {
        const html = await ciz({ gizli: false, acik: false })
        for (const e of ANAHTARLAR) {
            expect(zemin(html, e), e).toEqual(sirali(...ZEMIN, 'bg-slate-300'))
            expect(topuz(html, e), e).toEqual(sirali(...TOPUZ, 'translate-x-0'))
        }
    })

    it('gizli modda ACIK zemin murekkep (acikta zinc-900, koyuda zinc-100), yan panel dahil; topuz koyu temada koyu', async () => {
        const html = await ciz({ gizli: true, acik: true })
        for (const e of ANAHTARLAR) {
            expect(zemin(html, e), e).toEqual(sirali(...ZEMIN, 'bg-zinc-900', 'dark:bg-zinc-100'))
            expect(topuz(html, e), e).toEqual(sirali(...TOPUZ, 'translate-x-5', 'dark:bg-zinc-900'))
        }
    })

    it('gizli modda KAPALI zemin notr gri (acikta zinc-300, koyuda zinc-700); topuz koyu temada acik gri', async () => {
        const html = await ciz({ gizli: true, acik: false })
        for (const e of ANAHTARLAR) {
            expect(zemin(html, e), e).toEqual(sirali(...ZEMIN, 'bg-zinc-300', 'dark:bg-zinc-700'))
            expect(topuz(html, e), e).toEqual(sirali(...TOPUZ, 'translate-x-0', 'dark:bg-zinc-300'))
        }
    })
})

// Ikon karolari ve Dil secimi (son inceleme, 2026-10-27). Gizli modda esleme indigo karoyu griye cekiyor, mavi/amber/
// zumrut karolar renkli kaliyordu: ayni kartta iki renk dili. Dil listesinde secim zumrut idi; zumrut gizli modda yalniz
// "bir koruma acik" demek. Gizli modda karolarin hepsi Ayarlar ana ekranindaki karo gibi notr, secim Oto-Kilit'teki gibi
// murekkep. KONTROL: normal modda siniflar AYNEN kalir.
describe('Preferences.vue (SSR) -- gizli modda ikon karolari notr, dil secimi murekkep', () => {
    const RENKLI = /\b(?:blue|amber|emerald|indigo|violet|purple|fuchsia)-\d/
    const NOTR_KARO = ['bg-slate-100', 'dark:bg-zinc-800/50', 'text-slate-700', 'dark:text-zinc-300']
    const KAROLAR = ['Language', ...ANAHTARLAR]
    const karo = (html, etiket) => siniflar(satir(html, etiket), 'w-8', 'h-8')
    const YUVARLAK = ['w-8', 'h-8', 'rounded-full', 'flex', 'items-center', 'justify-center', 'transition-colors', 'duration-500']

    // Dil Secimi listesindeki satir (<button>); ad, modal basligindan SONRA aranir.
    const dilSatiri = (html, ad) => {
        const baslik = html.indexOf('Select Language')
        expect(baslik).toBeGreaterThan(-1)
        const i = html.indexOf(ad, baslik)
        return html.slice(html.lastIndexOf('<button', i), html.indexOf('</button>', i))
    }
    const DIL_SATIRI = ['w-full', 'p-3', 'rounded-lg', 'flex', 'items-center', 'justify-between', 'transition-all', 'cursor-pointer']

    it('KONTROL: normal modda karolar renkli (dil mavi, tema amber/indigo, istatistik violet, yan panel zumrut)', async () => {
        const acikTema = await ciz({ gizli: false, acik: false })
        expect(karo(acikTema, 'Language')).toEqual(sirali(...YUVARLAK, 'bg-blue-100', 'dark:bg-blue-500/10', 'text-blue-600', 'dark:text-blue-400'))
        expect(karo(acikTema, 'Theme')).toEqual(sirali(...YUVARLAK, 'ease-in-out', 'bg-amber-100', 'text-amber-600'))
        expect(karo(acikTema, 'Usage statistics')).toEqual(sirali(...YUVARLAK, 'shrink-0', 'bg-violet-100', 'dark:bg-violet-500/10', 'text-violet-600', 'dark:text-violet-400'))
        expect(karo(acikTema, 'Open in side panel')).toEqual(sirali(...YUVARLAK, 'bg-emerald-100', 'dark:bg-emerald-500/10', 'text-emerald-600', 'dark:text-emerald-400'))
        const koyuTema = await ciz({ gizli: false, acik: true })
        expect(karo(koyuTema, 'Theme')).toEqual(sirali(...YUVARLAK, 'ease-in-out', 'bg-indigo-500/10', 'text-indigo-400'))
    })

    it('gizli modda dort karo da notr, iki temada; yapisal siniflar normal modla ayni', async () => {
        for (const acik of [false, true]) {
            const normal = await ciz({ gizli: false, acik })
            const gizli = await ciz({ gizli: true, acik })
            for (const e of KAROLAR) {
                const g = karo(gizli, e)
                expect(g.filter((c) => RENKLI.test(c)), e).toEqual([])
                expect(g, e).toEqual(expect.arrayContaining(NOTR_KARO))
                expect(g.filter((c) => !NOTR_KARO.includes(c)), e).toEqual(karo(normal, e).filter((c) => !RENKLI.test(c)))
            }
        }
    })

    it('KONTROL: normal modda secili dil zumrut (satir, yazi, tik)', async () => {
        const s = dilSatiri(await ciz({ gizli: false, acik: true, dilModali: true }), 'English')
        expect(siniflar(s, 'p-3')).toEqual(sirali(...DIL_SATIRI, 'bg-emerald-50', 'dark:bg-emerald-500/10', 'border', 'border-emerald-200', 'dark:border-emerald-500/20'))
        expect(siniflar(s, 'text-sm')).toEqual(sirali('text-sm', 'font-medium', 'transition-colors', 'text-emerald-600', 'dark:text-emerald-400'))
        expect(siniflar(s, 'w-5', 'h-5')).toEqual(sirali('w-5', 'h-5', 'text-emerald-500'))
    })

    it('gizli modda secili dil murekkep: ince murekkep kenar, murekkep yazi ve tik; renk yok', async () => {
        const html = await ciz({ gizli: true, acik: true, dilModali: true })
        const s = dilSatiri(html, 'English')
        expect(siniflar(s, 'p-3')).toEqual(sirali(...DIL_SATIRI, 'bg-white', 'dark:bg-[#131315]', 'border', 'border-zinc-900', 'dark:border-zinc-100'))
        expect(siniflar(s, 'text-sm')).toEqual(sirali('text-sm', 'font-medium', 'transition-colors', 'text-zinc-950', 'dark:text-white'))
        expect(siniflar(s, 'w-5', 'h-5')).toEqual(sirali('w-5', 'h-5', 'text-zinc-950', 'dark:text-white'))
        // Secili olmayan satir normal moddaki gibi kalir.
        expect(siniflar(dilSatiri(html, 'Türkçe'), 'p-3')).toEqual(sirali(...DIL_SATIRI, 'hover:bg-slate-50', 'dark:hover:bg-white/5', 'border', 'border-transparent'))
        expect(html.slice(html.indexOf('Select Language'))).not.toMatch(RENKLI)
    })
})
