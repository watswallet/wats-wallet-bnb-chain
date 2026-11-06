import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Tanitim sayfasi grafit tasarim dili kilidi (sahip karari 2026-10-31: "bunu gizli mod'un tasarim diline gore tasarla").
// Sayfa NORMAL modda acilir (html.private yok), yani style.css'teki gizli mod eslemeleri ona uygulanmaz: grafit
// kendi siniflariyla verilmelidir. Kaynak metin taranir; SSR cikti testleri PrivacyIntro.ssr.test.js'te.
const here = dirname(fileURLToPath(import.meta.url))
const kaynak = readFileSync(join(here, 'PrivacyIntro.vue'), 'utf8')
const toggle = readFileSync(join(here, 'PrivacyToggle.vue'), 'utf8')
const sablon = kaynak.slice(kaynak.indexOf('<template>'), kaynak.lastIndexOf('</template>') + '</template>'.length)
const stil = kaynak.slice(kaynak.indexOf('<style'))

// Verilen etiketi (acilis etiketi, ozniteliklerle) ilk gecen class sinifina gore bulur.
const etiketi = (sinif) => {
    const m = sablon.match(new RegExp(`<[a-z0-9]+\\b[^>]*class="[^"]*(?<![\\w-])${sinif}(?![\\w-])[^"]*"[^>]*>`))
    return m ? m[0] : null
}
const siniflar = (metin) => [...metin.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)

describe('PrivacyIntro grafit tasarim dili', () => {
    it('mor ailesi (violet / fuchsia / purple / indigo) sinifi yok', () => {
        expect(kaynak).not.toMatch(/(?<![\w-])(?:[\w-]+:)*[\w-]*(?:violet|fuchsia|purple|indigo)[\w-]*/)
    })

    it('rgba( renk, gradyan ve bg-clip-text yok', () => {
        expect(kaynak).not.toMatch(/rgba?\(/i)
        expect(kaynak).not.toMatch(/bg-linear|bg-gradient|bg-size|bg-clip-text|linearGradient|linear-gradient|text-transparent/)
        expect(kaynak).not.toMatch(/drop-shadow|shadow-\[/)
    })

    it('eski hayalet renk kodlari yok; yalniz grafit yuzeyleri hex olarak gecer', () => {
        for (const eski of ['#c4b5fd', '#8b5cf6', '#d946ef', '#1e1035', 'url(#pi-ghost']) expect(kaynak.toLowerCase()).not.toContain(eski)
        const hexler = [...new Set((kaynak.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((h) => h.toLowerCase()))]
        // Satir ici onek: "#" ile baslayan baska sey (ornegin SVG id) bu taramada yoktur; kalanlar yalniz grafit yuzeyleri olabilir.
        expect(hexler.filter((h) => !['#0b0e13', '#11141a', '#1d2127'].includes(h))).toEqual([])
    })

    it('blur: yalniz arka planda backdrop-blur-sm; panel, halka ve alt alan bulaniklik tasimaz', () => {
        const blurlar = siniflar(sablon).filter((s) => /blur/.test(s))
        expect(blurlar).toEqual(['backdrop-blur-sm'])
        expect(siniflar(etiketi('pi-backdrop'))).toContain('backdrop-blur-sm')
        expect(stil).not.toMatch(/blur|filter/)
    })

    it('arka plan PrivateInfoSheet ile ayni, panel grafit yuzey', () => {
        const arka = siniflar(etiketi('pi-backdrop'))
        for (const s of ['bg-slate-900/50', 'dark:bg-black/70', 'backdrop-blur-sm']) expect(arka).toContain(s)
        const panel = siniflar(etiketi('pi-panel'))
        for (const s of ['rounded-t-3xl', 'border-t', 'border-x', 'border-slate-200', 'dark:border-white/10', 'bg-white', 'dark:bg-[#0b0e13]', 'text-slate-900', 'dark:text-zinc-100', 'max-w-105', 'max-h-[94%]', 'flex', 'flex-col']) {
            expect(panel).toContain(s)
        }
        expect(panel.some((s) => /shadow/.test(s))).toBe(false)
    })

    it('CTA Gizli Gonder murekkebini tasir: zinc-950 / beyaz yazi, koyu temada zinc-200 / zinc-950 yazi', () => {
        const cta = siniflar(etiketi('pi-cta'))
        for (const s of ['bg-zinc-950', 'text-white', 'hover:bg-zinc-800', 'dark:bg-zinc-200', 'dark:text-zinc-950', 'dark:hover:bg-zinc-300', 'rounded-2xl', 'py-3.5', 'font-bold', 'text-sm',
            'focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-zinc-950', 'dark:focus-visible:outline-zinc-200', 'transition-colors', 'disabled:opacity-60']) {
            expect(cta).toContain(s)
        }
        expect(cta.some((s) => /shadow|animate|transition-shadow/.test(s))).toBe(false)
        expect(stil).not.toMatch(/\.pi-cta/)
    })

    it('alt alan opak, bulaniksiz', () => {
        const alt = siniflar(etiketi('pi-footer'))
        for (const s of ['bg-white', 'dark:bg-[#0b0e13]', 'border-t', 'border-slate-200', 'dark:border-white/5']) expect(alt).toContain(s)
    })

    it('hero hayalet: PrivacyToggle ile AYNI yol ve goz sekli, dolu currentColor, ters renkli gozler', () => {
        const yol = (metin) => metin.match(/<svg[^>]*data-icon="ghost"[\s\S]*?<\/svg>/)?.[0]
        const toggleSvg = yol(toggle)
        const introSvg = yol(sablon)
        expect(toggleSvg).toBeTruthy()
        expect(introSvg).toBeTruthy()
        const d = (svg) => svg.match(/<path\s+d="([^"]+)"/)?.[1]
        expect(d(introSvg)).toBe(d(toggleSvg))
        expect(introSvg).toContain('viewBox="0 0 24 24"')
        const gozler = (svg) => [...svg.matchAll(/<ellipse\s+cx="([\d.]+)"\s+cy="([\d.]+)"\s+rx="([\d.]+)"\s+ry="([\d.]+)"/g)].map((m) => m.slice(1, 5).join(','))
        expect(gozler(introSvg)).toEqual(gozler(toggleSvg))
        expect(gozler(introSvg).length).toBe(2)
        expect(introSvg).toMatch(/fill="currentColor"/)
        expect(introSvg).toContain('fill-white dark:fill-zinc-950')
        expect(etiketi('pi-ghost')).toBeTruthy()
        const rozet = siniflar(etiketi('pi-hero'))
        for (const s of ['w-14', 'h-14', 'rounded-2xl', 'bg-slate-100', 'dark:bg-[#1d2127]', 'border', 'border-slate-200', 'dark:border-white/5']) expect(rozet).toContain(s)
        const hayalet = siniflar(etiketi('pi-ghost'))
        expect(hayalet).toContain('text-zinc-900')
        expect(hayalet).toContain('dark:text-zinc-100')
    })

    it('hayalette yalniz goz kirpma animasyonu kalir; yuzme ve golge animasyonlari yok', () => {
        expect(stil).toContain('@keyframes pi-blink')
        expect(stil).toContain('@keyframes pi-in')
        for (const eski of ['pi-float', 'pi-shadow', 'pi-shimmer', 'pi-ghost-body', 'pi-ghost-shadow']) expect(kaynak).not.toContain(eski)
        expect(stil).toMatch(/prefers-reduced-motion: reduce[\s\S]*\.pi-ghost-eyes/)
    })

    it('sinir satirlari grafit: notr zemin, notr ikon kutusu', () => {
        const satir = siniflar(etiketi('pi-limit'))
        for (const s of ['rounded-2xl', 'border', 'border-slate-200', 'dark:border-white/5', 'bg-slate-50', 'dark:bg-[#11141a]']) expect(satir).toContain(s)
        const kutu = siniflar(etiketi('pi-icon-tile'))
        for (const s of ['w-7', 'h-7', 'rounded-xl', 'bg-white', 'dark:bg-[#1d2127]', 'border', 'border-slate-200', 'dark:border-white/5', 'text-slate-600', 'dark:text-zinc-300']) expect(kutu).toContain(s)
    })

    it('baslik duz renk, kisa metin slate/zinc', () => {
        const baslik = etiketi('tracking-tight')
        expect(siniflar(baslik)).toEqual(expect.arrayContaining(['text-xl', 'font-bold', 'tracking-tight']))
        const lead = sablon.match(/<p class="([^"]*)">\{\{ \$t\('privacy\.intro\.lead'\) \}\}/)?.[1].split(/\s+/)
        expect(lead).toEqual(expect.arrayContaining(['text-[13px]', 'leading-relaxed', 'text-slate-600', 'dark:text-zinc-400']))
    })
})
