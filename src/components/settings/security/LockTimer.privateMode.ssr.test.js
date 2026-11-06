// LockTimer.vue (SSR) -- GIZLI MOD SECIMI (grafit karari, kullanici 2026-10-26).
// Secili secenegin kenari, radyo halkasi ve noktasi indigo; gizli modda indigo notr griye eslenince (style.css "GIZLI
// MOD MOR PALETI NOTRLESIR") secim sonuk bir griyle ayirt ediliyordu. Gizli modda ucu de murekkep olur (acikta zinc-900;
// koyuda zinc-100 / beyaz), mor parlama yok. Secili olmayan secenek ve normal mod AYNEN kalir (KONTROL ciftleri).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../../test-utils/ssrRender.js'
import { privacyStore } from '../../../store/privacy'
import LockTimer from './LockTimer.vue'

afterEach(() => { delete globalThis.chrome })

// Depoda 5 dakika kayitli: '5 Minutes' secili, '1 Minute' secili degil.
async function ciz({ gizli }) {
    installChromeStub({ lock_timer: 5 })
    const app = createApp(LockTimer)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    privacyStore().active = gizli
    return render(app)
}

// Etiketi tasiyan secenegin (<button>) basindan kapanisina kadar.
const secenek = (html, etiket) => {
    const i = html.indexOf(`>${etiket}<`)
    expect(i, etiket).toBeGreaterThan(-1)
    return html.slice(html.lastIndexOf('<button', i), html.indexOf('</button>', i))
}
// Parcada verilen siniflarin HEPSINI tasiyan ilk ogenin sinif listesi, sirali (sinif sirasi gorunumu degistirmez).
const siniflar = (parca, ...isaretler) => {
    const listeler = [...parca.matchAll(/class="([^"]*)"/g)].map((m) => m[1].split(/\s+/).filter(Boolean))
    return [...(listeler.find((s) => isaretler.every((i) => s.includes(i))) ?? [])].sort()
}
const dugme = (html, etiket) => siniflar(secenek(html, etiket), 'group', 'rounded-xl')
const halka = (html, etiket) => siniflar(secenek(html, etiket), 'w-5', 'h-5')
const nokta = (html, etiket) => siniflar(secenek(html, etiket), 'w-2.5', 'h-2.5')
const sirali = (...s) => s.sort()

// Durumdan bagimsiz siniflar ve normal moddaki renkler, kaynaktan elle kopyalandi.
const DUGME = ['group', 'w-full', 'flex', 'items-center', 'justify-between', 'p-4', 'rounded-xl', 'border', 'transition-all', 'duration-300', 'cursor-pointer']
const HALKA = ['w-5', 'h-5', 'rounded-full', 'border', 'flex', 'items-center', 'justify-center', 'transition-all', 'duration-300']
const NOKTA = ['w-2.5', 'h-2.5', 'rounded-full', 'transition-transform', 'duration-200']
const SECILI_DUGME = ['bg-white', 'dark:bg-[#131315]', 'border-indigo-400', 'dark:border-indigo-500/50', 'shadow-md', 'dark:shadow-[0_0_15px_rgba(99,102,241,0.1)]']
const SECILI_HALKA = ['border-indigo-500', 'bg-indigo-50', 'dark:bg-indigo-500/20']
const NOKTA_RENGI = ['bg-indigo-600', 'dark:bg-indigo-500', 'shadow-[0_0_8px_rgba(79,70,229,0.4)]', 'dark:shadow-[0_0_8px_rgba(99,102,241,0.8)]']
// Secili olmayan secenek: iki modda da ayni olmali.
const BOS_DUGME = ['bg-white', 'dark:bg-[#131315]', 'border-slate-200', 'dark:border-white/5', 'hover:border-slate-300', 'dark:hover:border-white/10', 'hover:bg-slate-50', 'dark:hover:bg-[#18181b]', 'shadow-sm', 'dark:shadow-none']
const BOS_HALKA = ['border-slate-300', 'dark:border-zinc-700', 'bg-slate-50', 'dark:bg-zinc-800/50', 'group-hover:border-slate-400', 'dark:group-hover:border-zinc-500']

describe('LockTimer.vue (SSR) -- gizli modda secim murekkep; secili olmayan ve normal mod ayni', () => {
    it('KONTROL: normal modda secili secenegin kenari, halkasi ve noktasi indigo (parlamali)', async () => {
        const html = await ciz({ gizli: false })
        expect(dugme(html, '5 Minutes')).toEqual(sirali(...DUGME, ...SECILI_DUGME))
        expect(halka(html, '5 Minutes')).toEqual(sirali(...HALKA, ...SECILI_HALKA))
        expect(nokta(html, '5 Minutes')).toEqual(sirali(...NOKTA, ...NOKTA_RENGI, 'scale-100'))
    })

    it('KONTROL: normal modda secili olmayan secenek notr, noktasi gizli (scale-0)', async () => {
        const html = await ciz({ gizli: false })
        expect(dugme(html, '1 Minute')).toEqual(sirali(...DUGME, ...BOS_DUGME))
        expect(halka(html, '1 Minute')).toEqual(sirali(...HALKA, ...BOS_HALKA))
        expect(nokta(html, '1 Minute')).toEqual(sirali(...NOKTA, ...NOKTA_RENGI, 'scale-0'))
    })

    it('gizli modda secili secenegin kenari, halkasi ve noktasi murekkep; mor sinif ve parlama yok', async () => {
        const html = await ciz({ gizli: true })
        expect(dugme(html, '5 Minutes')).toEqual(sirali(...DUGME, 'bg-white', 'dark:bg-[#131315]', 'border-zinc-900', 'dark:border-zinc-100', 'shadow-md', 'dark:shadow-none'))
        expect(halka(html, '5 Minutes')).toEqual(sirali(...HALKA, 'border-zinc-900', 'dark:border-white', 'bg-white', 'dark:bg-white/[0.045]'))
        expect(nokta(html, '5 Minutes')).toEqual(sirali(...NOKTA, 'bg-zinc-900', 'dark:bg-white', 'scale-100'))
    })

    it('gizli modda secili olmayan secenegin kenari ve halkasi normal modla AYNI; noktasi gizli kalir', async () => {
        const html = await ciz({ gizli: true })
        expect(dugme(html, '1 Minute')).toEqual(sirali(...DUGME, ...BOS_DUGME))
        expect(halka(html, '1 Minute')).toEqual(sirali(...HALKA, ...BOS_HALKA))
        expect(nokta(html, '1 Minute')).toContain('scale-0')
    })
})
