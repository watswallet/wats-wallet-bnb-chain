// KAYMAK G7: CountingText yaprak bileseni (spec 7.6, K6, K7, D8).
// SSR'da ve ilk cizimde metin birebir `text`; kok tek span, ebeveynin sinifi fallthrough ile aynen gecer.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ssrRender } from '../../test-utils/ssrRender.js'
import { yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari.js'
import { yorumsuz, blokGovdesi } from '../../test-utils/kaynakTarama.js'
import CountingText from './CountingText.vue'

const SINIF = 'text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300'
const para = (n) => '$' + n.toFixed(2)

describe('CountingText (SSR)', () => {
    it('sinif + deger: tam sinif kalibiyla tek span, metin birebir text', async () => {
        const html = await ssrRender(CountingText, {
            props: { class: SINIF, text: '$78.00', value: 78, format: para, identity: 'acc1|x' },
        })
        expect(yorumsuzHtml(html)).toBe(`<span class="${SINIF}">$78.00</span>`)
    })

    it('Home.ssr.test.js / HomeXStockPrice.ssr.test.js satir degeri kalibi eslesir', async () => {
        const html = await ssrRender(CountingText, {
            props: { class: SINIF, text: '$1,234.50', value: 1234.5, format: para },
        })
        const m = yorumsuzHtml(html).match(/<span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">([^<]*)<\/span>/)
        expect(m[1]).toBe('$1,234.50')
    })

    it.each([
        ['****', null],
        ['***', null],
        ['—', null],
    ])('sayilamaz metin (%s) aynen yazilir; format cagrilmaz', async (text, value) => {
        let cagri = 0
        const html = await ssrRender(CountingText, {
            props: { text, value, format: (n) => { cagri += 1; return String(n) } },
        })
        expect(yorumsuzHtml(html)).toBe(`<span>${text}</span>`)
        expect(cagri).toBe(0)
    })

    it('ilk cizimde format(hedef) yerine text kullanilir (0 dan sayma yok)', async () => {
        const html = await ssrRender(CountingText, {
            props: { text: '1.50%', value: 1.5, format: () => 'YANLIS' },
        })
        expect(yorumsuzHtml(html)).toBe('<span>1.50%</span>')
    })
})

describe('CountingText kaynak kilidi (K7)', () => {
    const HAM = readFileSync(new URL('./CountingText.vue', import.meta.url), 'utf8')
    const KOD = yorumsuz(HAM)
    const SABLON = KOD.slice(0, KOD.indexOf('<script'))

    it('store/chrome import yok; chrome. gecmez', () => {
        expect(KOD).not.toMatch(/from\s+['"][^'"]*(store|chrome)[^'"]*['"]/)
        expect(KOD).not.toContain('chrome.')
    })

    it('emit, expose, v-model, kendi stili yok', () => {
        for (const yasak of ['defineEmits', 'defineExpose', 'defineModel', '$emit', '<style', 'v-model']) {
            expect(KOD).not.toContain(yasak)
        }
    })

    it('sablon yalniz tek, siniflari ve oznitelikleri olmayan span', () => {
        expect(SABLON.replace(/\s+/g, ' ').trim()).toBe('<template> <span>{{ shown }}</span> </template>')
    })

    it('baglanti: paylasilan ticker, motionAllowed, guncel format prop u, izleyici -> update, onBeforeUnmount -> dispose', () => {
        expect(KOD).toMatch(/ticker:\s*getSharedTicker\(\)/)
        expect(KOD).toMatch(/motionAllowed:\s*\(\)\s*=>\s*motionAllowed\(\)/)
        expect(KOD).toMatch(/format:\s*\(n\)\s*=>\s*props\.format\(n\)/)
        expect(KOD).toMatch(/watch\(\s*\(\)\s*=>\s*\[props\.text,\s*props\.value,\s*props\.identity\]/)
        expect(KOD).toMatch(/counter\.update\(/)
        const govde = blokGovdesi(HAM, /onBeforeUnmount\(\(\)\s*=>\s*/)
        expect(govde).toMatch(/counter\.dispose\(\)/)
    })
})
