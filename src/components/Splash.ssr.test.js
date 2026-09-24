import { describe, it, expect } from 'vitest'
import { ssrRender } from '../test-utils/ssrRender.js'
import Splash from './Splash.vue'

// YUKLEME EKRANI -- kullanici karari (2026-09-15): "sadece dark/light theme
// uzerinde duran bir wats logosu, altinda da loading spinner, bu kadar."
//
// "Bu kadar" bir SINIRDIR, bir tarif degil: metin, ilerleme yuzdesi, ipucu
// satiri, marka sloganı eklenmemeli. Asagidaki testler hem varligi hem de bu
// sınırı olcer.
describe('Splash.vue -- yukleme ekrani', () => {
    it('WATS logosunu cizer', async () => {
        const html = await ssrRender(Splash)
        // Login.vue ile AYNI varlik: /logo.png. Tema basina AYRI bir cizim
        // (old-wats-black/white) kullanmak iki tema iki marka demek olurdu.
        expect(html).toContain('src="/logo.png"')
    })

    it('logonun ALTINDA donen bir spinner var', async () => {
        const html = await ssrRender(Splash)
        expect(html).toContain('animate-spin')
        expect(html.indexOf('/logo.png'), 'spinner logodan SONRA gelmeli')
            .toBeLessThan(html.indexOf('animate-spin'))
    })

    it('HER IKI temada da kendi zeminini boyar', async () => {
        const html = await ssrRender(Splash)
        // Zemin saydam birakilirsa altindaki yarim dolu ana sayfa sizar --
        // ekranin butun amaci onu gostermemek.
        expect(html).toContain('bg-[#fcfcfd]')
        expect(html).toContain('dark:bg-[#09090b]')
    })

    it('METIN ICERMEZ -- "bu kadar" sinirinin kilidi', async () => {
        const html = await ssrRender(Splash)
        const gorunurMetin = html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<[^>]+>/g, '')
            .trim()
        expect(gorunurMetin).toBe('')
    })

    it('tumuyle kaplar -- altindaki ekran gorunmez', async () => {
        const html = await ssrRender(Splash)
        expect(html).toContain('fixed inset-0')
    })

    it('kimlik tasir -- tuketen testler onu DETERMINISTIK bulabilsin', async () => {
        const html = await ssrRender(Splash)
        expect(html).toContain('data-splash')
    })
})
