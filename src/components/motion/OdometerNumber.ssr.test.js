// KAYMAK G8: OdometerNumber yaprak bileseni (spec 7.7, K6, D9).
// SSR'da ve ilk cizimde duz metin: kok ozniteliksiz tek span, sutun yok.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ssrRender } from '../../test-utils/ssrRender.js'
import { yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari.js'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama.js'
import OdometerNumber from './OdometerNumber.vue'

describe('OdometerNumber (SSR)', () => {
    it('duz metin: <span>1,234.56</span>', async () => {
        const html = await ssrRender(OdometerNumber, {
            props: { text: '1,234.56', size: 'text-[42px]', identity: 'acc1|x', locale: 'en' },
        })
        expect(yorumsuzHtml(html)).toBe('<span>1,234.56</span>')
    })

    it('NBSP ve NNBSP aynen; odometre sinifi ve sutun yok', async () => {
        for (const text of ['1 234,56', '1 234,56', '39,00']) {
            const html = yorumsuzHtml(await ssrRender(OdometerNumber, { props: { text, size: 'text-[42px]', identity: '', locale: 'fr' } }))
            expect(html).toBe(`<span>${text}</span>`)
            expect(html).not.toContain('kaymak-odometre')
            expect(html).not.toContain('aria-hidden')
        }
    })
})

describe('OdometerNumber kaynak kilidi (K7)', () => {
    const HAM = readFileSync(new URL('./OdometerNumber.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))
    const tekBosluk = (s) => s.replace(/\s+/g, ' ')

    it('store/chrome import yok; chrome. gecmez', () => {
        expect(KOD).not.toMatch(/from\s+['"][^'"]*(store|chrome)[^'"]*['"]/)
        expect(KOD).not.toContain('chrome.')
    })

    it('emit, expose, v-model, kendi stili yok', () => {
        for (const yasak of ['defineEmits', 'defineExpose', 'defineModel', '$emit', '<style', 'v-model']) {
            expect(KOD).not.toContain(yasak)
        }
    })

    it('duz kok: siniflari ve ozniteligi olmayan span (yalniz ref)', () => {
        expect(tekBosluk(SABLON)).toContain('<span v-if="!gorunum.cells" ref="kok">{{ gorunum.text }}</span>')
    })

    it('donus koku: kaymak-odometre + baslangic sinifi, sr-only gercek metin, aria-hidden hucreler, 0-9 serit, sabit hucre', () => {
        const s = tekBosluk(SABLON)
        expect(s).toContain(`<span v-else ref="kok" class="kaymak-odometre" :class="{ 'kaymak-odometre-baslangic': gorunum.start }">`)
        expect(s).toContain('<span class="sr-only">{{ gorunum.text }}</span>')
        expect(s).toMatch(/<span v-if="h\.char === undefined" class="kaymak-odometre-hucre" aria-hidden="true"> <span class="kaymak-odometre-serit" :style="seritStili\(h\)"> <span v-for="n in 10" :key="n">\{\{ n - 1 \}\}<\/span>/)
        expect(s).toContain('<span v-else class="kaymak-odometre-sabit" aria-hidden="true">{{ h.char }}</span>')
    })

    it('serit stili yalniz transform (translateY(-d*10%)) ve gecikme', () => {
        const govde = blokGovdesi(HAM, /const seritStili = \(h\) => \(/)
        expect(govde).not.toBeNull()
        expect(tekBosluk(govde).trim()).toBe('transform: `translateY(-${h.digit * 10}%)`, transitionDelay: `${h.delay}ms`')
    })

    it('baglanti: createOdometer, motionAllowed her tetikte, kok doluysa yerlesim okunur, izleyici -> update, onBeforeUnmount -> dispose', () => {
        expect(KOD).toMatch(/import \{ createOdometer \} from '\.\.\/\.\.\/utils\/motion\/odometerPlan'/)
        expect(KOD).toMatch(/motionAllowed:\s*\(\)\s*=>\s*motionAllowed\(\)/)
        expect(KOD).toMatch(/canRoll:\s*\(\)\s*=>\s*kok\.value\s*!=\s*null/)
        expect(KOD).toMatch(/nextTick\(/)
        expect(KOD).toMatch(/if \(el\) void el\.offsetWidth/)
        expect(KOD).toMatch(/watch\(\s*\(\)\s*=>\s*\[props\.text,\s*props\.size,\s*props\.identity,\s*props\.locale\]/)
        expect(KOD).toMatch(/sayac\.update\(/)
        const govde = blokGovdesi(HAM, /onBeforeUnmount\(\(\)\s*=>\s*/)
        expect(govde).toMatch(/sayac\.dispose\(\)/)
    })
})
