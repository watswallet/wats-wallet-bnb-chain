// KAYMAK G1: hareket belirtecleri, basma tepkisi ve Home ici uyum gecisleri.
// Kaynak kilitleri (spec 7.1, 7.11, D11, D12). Dosyalar CRLF: regex \n'e dayanmaz.
// G6: sekme icerigi yonlu giris (spec 7.3) CSS kilitleri dosya sonunda.
// G8: sayac rakamli toplam (spec 7.7, D9) CSS kilitleri en sonda.
// G9: goz gecisi ve kSwap (spec 7.8); G11: mini bakiye seridi (spec 7.9) CSS kilitleri ondan sonra.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, cssKuralGovdesi } from '../test-utils/kaynakTarama'
import { TAB_SLIDE_CLEAR_MS } from '../utils/motion/tabSlide'
import { ROLL_MS, ROLL_DELAY_MAX_MS } from '../utils/motion/odometerPlan'

const here = dirname(fileURLToPath(import.meta.url))
const oku = (rel) => yorumsuz(readFileSync(join(here, '..', rel), 'utf8'))
const CSS = oku('popup/style.css')
const HOME = oku('components/Home.vue')
const HEADER = oku('components/Header.vue')
const HISTORY = oku('components/History.vue')
const NEWS = oku('components/NewsStrip.vue')
const sablon = (k) => k.slice(0, k.indexOf('<script'))
const say = (metin, parca) => metin.split(parca).length - 1

// K10 0,26 sn sinirinin disindaki secici parcalari. Odometre donusu 0,6 sn + hane gecikmesi, toplam <= 0,8 sn
// (spec 7.7, Ek insaatci notu 3): arka planda doner, hicbir seyi kilitlemez.
// kaymak-iskelet: yukleme cubugunun nabzi bir gecis degil, bekleme gostergesi (1,2 sn, hareket azaltilmissa yok).
const SURE_ISTISNALARI = ['kaymak-odometre', 'kaymak-iskelet']

describe('kaymak gecisleri (G1)', () => {
    it('@theme static iki egriyi tanimlar', () => {
        expect(CSS).toMatch(/@theme static\s*\{[^}]*--ease-kaymak:\s*cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/)
        expect(CSS).toMatch(/@theme static\s*\{[^}]*--ease-yay:\s*cubic-bezier\(\.34,\s*1\.56,\s*\.64,\s*1\)/)
    })

    it('Home: transition-all kalmadi (sekme cizgisi div leri gitti)', () => {
        const kalan = sablon(HOME).match(/class="[^"]*\btransition-all\b[^"]*"/g) ?? []
        expect(kalan).toEqual([])
    })

    it("Home: duration-300 yalniz 'transition-colors duration-300' (tema rengi); diger her duration-N <= 260", () => {
        const sinif = sablon(HOME).match(/class="[^"]*"/g) ?? []
        for (const c of sinif) {
            for (const m of c.matchAll(/\bduration-(\d+)\b/g)) {
                const n = Number(m[1])
                if (n === 300) expect(c).toContain('transition-colors duration-300')
                else expect(n).toBeLessThanOrEqual(260)
            }
        }
    })

    it('dort karo kaymak-karo tasir, group-hover:scale-105 dort kez korunur', () => {
        expect(say(sablon(HOME), 'kaymak-karo')).toBe(4)
        expect(say(sablon(HOME), 'group-hover:scale-105')).toBe(4)
    })

    it('varlik ve hisse satiri kaymak-satir sinifini tasir', () => {
        expect(say(sablon(HOME), 'group flex w-full items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer kaymak-satir"')).toBe(2)
    })

    it('History satiri kaymak-satir; transition-colors duration-200 yok', () => {
        expect(HISTORY).toContain('cursor-pointer kaymak-satir"')
        expect(HISTORY).not.toContain('transition-colors duration-200')
    })

    it('sekme dugmeleri, hap ve ice aktar dugmesi uyumlu gecis tasir', () => {
        expect(say(sablon(HOME), 'pb-3 text-sm font-semibold transition-colors duration-160 ease-kaymak relative')).toBe(4)
        expect(say(sablon(HOME), 'transition-colors duration-140 ease-kaymak')).toBe(2)
    })

    it('Receive: enter/leave transition-opacity duration-200 ease-kaymak motion-reduce:duration-0', () => {
        const s = 'transition-opacity duration-200 ease-kaymak motion-reduce:duration-0'
        expect(HOME).toContain(`:enter-active-class="'${s}'"`)
        expect(HOME).toContain(`:leave-active-class="'${s}'"`)
    })

    it('Header: bes Transition in her enter/leave sinifi ease-kaymak ve motion-reduce:duration-0 tasir', () => {
        const s = sablon(HEADER)
        const siniflar = s.match(/(?:enter|leave)-active-class="[^"]*"/g) ?? []
        expect(siniflar.length).toBe(10)
        for (const c of siniflar) {
            expect(c).toContain('ease-kaymak')
            expect(c).toContain('motion-reduce:duration-0')
        }
        expect(s).not.toMatch(/\bease-in\b|\bease-out\b/)
        expect(s).not.toContain('cubic-bezier(0.16, 1, 0.3, 1)')
        expect(s).not.toContain('ease-[cubic-bezier(0.16,1,0.3,1)]')
    })

    it('Header: dort eski 300 ms gecisin enter sinifi duration-240; baglanti menusu 200/150 kalir; her duration-N <= 240', () => {
        const s = sablon(HEADER)
        const enter = s.match(/enter-active-class="[^"]*"/g) ?? []
        expect(enter.filter((c) => c.includes('duration-240')).length).toBe(4)
        expect(s).toContain('enter-active-class="transition-all duration-200 ease-kaymak motion-reduce:duration-0"')
        expect(s).toContain('leave-active-class="transition-all duration-150 ease-kaymak motion-reduce:duration-0"')
        // Yalniz Transition sinif degerleri; cekmece halkasi gibi dokunulmayan siniflar kapsam disi.
        const gecisSiniflari = (s.match(/(?:enter|leave)-active-class="[^"]*"/g) ?? []).join(' ')
        for (const m of gecisSiniflari.matchAll(/\bduration-(\d+)\b/g)) {
            expect(Number(m[1])).toBeLessThanOrEqual(240)
        }
    })

    it('Header: cekmece ortusu ve rayi uyumlu; halka sinifi aynen', () => {
        expect(HEADER).toContain('transition-opacity duration-240 ease-kaymak motion-reduce:duration-0')
        expect(HEADER).toContain('transition-transform duration-240 ease-kaymak motion-reduce:duration-0 will-change-transform')
        expect(HEADER).toContain('rounded-full transition-all duration-300 flex items-center justify-center')
    })

    it('NewsStrip noktasi kaymak-nokta; transition-all yok', () => {
        expect(NEWS).toContain('kaymak-nokta')
        expect(NEWS).not.toContain('transition-all')
    })

    it('style.css: kaymak- secicili her kuralin sureleri <= .26s (SURE_ISTISNALARI haric)', () => {
        let kuralSayisi = 0
        for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
            const secici = m[1].trim()
            if (!secici.includes('kaymak-')) continue
            if (SURE_ISTISNALARI.some((p) => secici.includes(p))) continue
            kuralSayisi++
            const bildirimler = m[2].match(/(?:transition|animation)(?:-duration)?\s*:[^;]*/g) ?? []
            for (const b of bildirimler) {
                for (const s of b.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
                    const sn = s[2] === 'ms' ? Number(s[1]) / 1000 : Number(s[1])
                    expect(sn).toBeLessThanOrEqual(0.26)
                }
            }
        }
        expect(kuralSayisi).toBeGreaterThanOrEqual(5)
    })

    it('basma olcegi (scale: .9 / .985) yalniz prefers-reduced-motion: no-preference icinde', () => {
        const medya = CSS.indexOf('@media (prefers-reduced-motion: no-preference)')
        expect(medya).toBeGreaterThan(-1)
        let derinlik = 0
        let son = -1
        for (let i = CSS.indexOf('{', medya); i < CSS.length; i++) {
            if (CSS[i] === '{') derinlik++
            else if (CSS[i] === '}' && --derinlik === 0) { son = i; break }
        }
        const blok = CSS.slice(medya, son)
        const disari = CSS.slice(0, medya) + CSS.slice(son)
        expect(blok).toMatch(/scale:\s*\.9\b/)
        expect(blok).toMatch(/scale:\s*\.985\b/)
        expect(disari).not.toMatch(/(?<![-\w])scale:\s*\.(9|985)\b/)
    })
})

// `sorgu` ile acilan HER @media blogunun govdesi (ic) ve bloklar cikarilmis kalan CSS (dis). Parantez eslestirme;
// satir sonundan bagimsiz.
const medyaAyir = (css, sorgu) => {
    let ic = ''
    let dis = ''
    let i = 0
    for (;;) {
        const bas = css.indexOf(sorgu, i)
        if (bas === -1) { dis += css.slice(i); break }
        const suslu = css.indexOf('{', bas)
        let derinlik = 0
        let son = -1
        for (let j = suslu; j < css.length; j++) {
            if (css[j] === '{') derinlik++
            else if (css[j] === '}' && --derinlik === 0) { son = j; break }
        }
        dis += css.slice(i, bas)
        ic += css.slice(suslu + 1, son) + '\n'
        i = son + 1
    }
    return { ic, dis }
}
const kurallar = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ secici: m[1].trim(), govde: m[2] }))
const ilkKare = (ad) => {
    const kf = cssKuralGovdesi(CSS, new RegExp(String.raw`@keyframes\s+${ad}\s*\{`))
    return kf === null ? null : cssKuralGovdesi(kf, /\bfrom\s*\{/)
}

describe('sekme icerigi yonlu giris (G6, spec 7.3)', () => {
    const { ic: NO_PREF, dis: NO_PREF_DISI } = medyaAyir(CSS, '@media (prefers-reduced-motion: no-preference)')
    const icerikKurali = (sinif) => kurallar(NO_PREF).find((k) => k.secici === `.${sinif}`)
    const satirKurali = () => kurallar(NO_PREF).find((k) => k.secici.includes('.kaymak-satir:nth-child(-n+6)'))
    const gecikmeler = () => kurallar(NO_PREF)
        .filter((k) => /animation-delay\s*:/.test(k.govde))
        .map((k) => {
            const n = k.secici.match(/\.kaymak-satir:nth-child\((\d+)\)/)
            const ms = k.govde.match(/animation-delay\s*:\s*(\d+)ms/)
            return { secici: k.secici, n: n && Number(n[1]), ms: ms && Number(ms[1]) }
        })

    it('@keyframes kaymak-sekme-sag/sol: from translateX(+-28px) ve opacity 0', () => {
        const sag = ilkKare('kaymak-sekme-sag')
        const sol = ilkKare('kaymak-sekme-sol')
        expect(sag).toMatch(/transform:\s*translateX\(28px\)/)
        expect(sag).toMatch(/opacity:\s*0\s*(;|$)/)
        expect(sol).toMatch(/transform:\s*translateX\(-28px\)/)
        expect(sol).toMatch(/opacity:\s*0\s*(;|$)/)
    })

    it('@keyframes kaymak-satir-otur: from translateY(6px) ve opacity 0', () => {
        const otur = ilkKare('kaymak-satir-otur')
        expect(otur).toMatch(/transform:\s*translateY\(6px\)/)
        expect(otur).toMatch(/opacity:\s*0\s*(;|$)/)
    })

    it('icerik .22s tek egriyle, doldurmasiz (kalici transform kalmaz); kurallar no-preference blogunda', () => {
        for (const sinif of ['kaymak-sekme-sag', 'kaymak-sekme-sol']) {
            const k = icerikKurali(sinif)
            expect(k, sinif).toBeTruthy()
            expect(k.govde).toMatch(new RegExp(String.raw`animation:\s*${sinif}\s+\.22s\s+var\(--ease-kaymak\)\s*;?\s*$`))
            expect(k.govde).not.toMatch(/\b(forwards|backwards|both|infinite)\b/)
        }
    })

    it("satirlar: ilk alti satir kaymak-satir-otur .18s backwards (yalniz gecikme suresince), iki yon de", () => {
        const k = satirKurali()
        expect(k).toBeTruthy()
        expect(k.secici).toContain('.kaymak-sekme-sag .kaymak-satir:nth-child(-n+6)')
        expect(k.secici).toContain('.kaymak-sekme-sol .kaymak-satir:nth-child(-n+6)')
        expect(k.govde).toMatch(/animation:\s*kaymak-satir-otur\s+\.18s\s+var\(--ease-kaymak\)\s+backwards\s*;?\s*$/)
    })

    it('gecikmeler 14, 28, 42, 56, 70ms (en fazla 70), 2.-6. satira; iki yon de', () => {
        const g = gecikmeler()
        expect(g.map(({ n, ms }) => [n, ms])).toEqual([[2, 14], [3, 28], [4, 42], [5, 56], [6, 70]])
        for (const { secici, ms } of g) {
            expect(ms).toBeLessThanOrEqual(70)
            expect(secici).toContain('.kaymak-sekme-sag .kaymak-satir:nth-child(')
            expect(secici).toContain('.kaymak-sekme-sol .kaymak-satir:nth-child(')
        }
    })

    it('hareket azaltilmissa yok: animasyon kurallari no-preference blogu disinda gecmez', () => {
        expect(NO_PREF_DISI).not.toMatch(/animation[^;{}]*:\s*[^;{}]*kaymak-(sekme-sag|sekme-sol|satir-otur)/)
        expect(NO_PREF_DISI).not.toMatch(/kaymak-sekme-(sag|sol)[^{}]*\{[^{}]*animation/)
    })

    it('sinif, en uzun hareket bitince kalkar (TAB_SLIDE_CLEAR_MS >= en uzun hareket, <= 260)', () => {
        const icerik = Number(icerikKurali('kaymak-sekme-sag').govde.match(/(\d*\.\d+)s/)[1])
        const satir = Number(satirKurali().govde.match(/(\d*\.\d+)s/)[1])
        const enGec = Math.max(...gecikmeler().map(({ ms }) => ms))
        const enUzunMs = Math.max(Math.round(icerik * 1000), Math.round(satir * 1000) + enGec)
        expect(enUzunMs).toBeLessThanOrEqual(TAB_SLIDE_CLEAR_MS)
        expect(TAB_SLIDE_CLEAR_MS).toBeLessThanOrEqual(260)
    })
})

describe('sayac rakamli toplam (G8, spec 7.7, D9)', () => {
    const { ic: REDUCE, dis: REDUCE_DISI } = medyaAyir(CSS, '@media (prefers-reduced-motion: reduce)')
    const kural = (css, secici) => kurallar(css).find((k) => k.secici === secici)
    const bildirim = (govde, ad) => {
        const m = govde.match(new RegExp(String.raw`(?:^|;)\s*${ad}\s*:\s*([^;]*)`))
        return m ? m[1].trim() : null
    }

    it('SURE_ISTISNALARI yalniz kaymak-odometre ve yukleme cubugu (kaymak-iskelet)', () => {
        expect(SURE_ISTISNALARI).toEqual(['kaymak-odometre', 'kaymak-iskelet'])
    })

    it('serit: flex sutun, transform .6s var(--ease-kaymak) (yalniz transform), ROLL_MS ile ayni', () => {
        const k = kural(REDUCE_DISI, '.kaymak-odometre-serit')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'display')).toBe('flex')
        expect(bildirim(k.govde, 'flex-direction')).toBe('column')
        expect(bildirim(k.govde, 'transition')).toBe('transform .6s var(--ease-kaymak)')
        expect(ROLL_MS).toBe(600)
        expect(ROLL_MS + ROLL_DELAY_MAX_MS).toBeLessThanOrEqual(800)
    })

    it('hucre: inline-block, 1lh, overflow hidden, ust hizali; serit cocuklari 1lh; sabit hucre white-space pre', () => {
        const h = kural(REDUCE_DISI, '.kaymak-odometre-hucre')
        expect(h).toBeTruthy()
        expect(bildirim(h.govde, 'display')).toBe('inline-block')
        expect(bildirim(h.govde, 'height')).toBe('1lh')
        expect(bildirim(h.govde, 'overflow')).toBe('hidden')
        expect(bildirim(h.govde, 'vertical-align')).toBe('top')
        expect(bildirim(kural(REDUCE_DISI, '.kaymak-odometre-serit > span').govde, 'height')).toBe('1lh')
        expect(bildirim(kural(REDUCE_DISI, '.kaymak-odometre-sabit').govde, 'white-space')).toBe('pre')
    })

    it('baslangic: serit gecissiz kurulur', () => {
        const k = kural(REDUCE_DISI, '.kaymak-odometre-baslangic .kaymak-odometre-serit')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'transition')).toBe('none')
    })

    it('hareket azaltilmissa serit gecisi yok', () => {
        const k = kural(REDUCE, '.kaymak-odometre-serit')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'transition')).toBe('none')
    })

    it('odometre kurallari yalniz transform canlandirir (width/top/filter gecisi yok)', () => {
        for (const k of kurallar(CSS).filter((x) => x.secici.includes('kaymak-odometre'))) {
            const t = bildirim(k.govde, 'transition')
            if (t !== null && t !== 'none') expect(t).toMatch(/^transform\s/)
            expect(k.govde).not.toMatch(/\banimation\s*:/)
        }
    })
})

describe('goz gecisi ve kSwap (G9, spec 7.8)', () => {
    const { ic: NO_PREF, dis: NO_PREF_DISI } = medyaAyir(CSS, '@media (prefers-reduced-motion: no-preference)')
    const kural = (css, secici) => kurallar(css).find((k) => k.secici.replace(/\s+/g, ' ') === secici)
    const bildirim = (govde, ad) => {
        const m = govde.match(new RegExp(String.raw`(?:^|;)\s*${ad}\s*:\s*([^;]*)`))
        return m ? m[1].trim() : null
    }

    it('kaymak-goz enter/leave-active: opacity ve filter .18s var(--ease-kaymak)', () => {
        const k = kural(NO_PREF, '.kaymak-goz-enter-active, .kaymak-goz-leave-active')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'transition')).toBe('opacity .18s var(--ease-kaymak), filter .18s var(--ease-kaymak)')
    })

    it('kaymak-goz enter-from / leave-to: opacity 0, filter blur(8px)', () => {
        const k = kural(NO_PREF, '.kaymak-goz-enter-from, .kaymak-goz-leave-to')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'opacity')).toBe('0')
        expect(bildirim(k.govde, 'filter')).toBe('blur(8px)')
    })

    it('kaymak-goz leave-active mutlak konumlanir (ust uste durur, yerlesim ziplamaz)', () => {
        const k = kural(NO_PREF, '.kaymak-goz-leave-active')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'position')).toBe('absolute')
        expect(bildirim(k.govde, 'left')).toBe('0')
        expect(bildirim(k.govde, 'top')).toBe('0')
    })

    it('@keyframes kaymak-kswap: from opacity .1 ve blur(3px); .kaymak-kswap .18s doldurmasiz', () => {
        const ilk = ilkKare('kaymak-kswap')
        expect(ilk).not.toBeNull()
        expect(ilk).toMatch(/opacity:\s*\.1\s*(;|$)/)
        expect(ilk).toMatch(/filter:\s*blur\(3px\)/)
        const k = kural(NO_PREF, '.kaymak-kswap')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'animation')).toBe('kaymak-kswap .18s var(--ease-kaymak)')
        expect(k.govde).not.toMatch(/\b(forwards|backwards|both|infinite)\b/)
    })

    it('hareket azaltilmissa hepsi kapali: goz ve kSwap kurallari no-preference blogu disinda yok', () => {
        for (const k of kurallar(NO_PREF_DISI)) {
            expect(k.secici).not.toMatch(/kaymak-goz|\.kaymak-kswap/)
        }
        expect(NO_PREF_DISI).not.toMatch(/animation[^;{}]*:\s*[^;{}]*kaymak-kswap/)
    })
})

describe('mini bakiye seridi (G11, spec 7.9 Mini serit, K8)', () => {
    const { ic: REDUCE, dis: REDUCE_DISI } = medyaAyir(CSS, '@media (prefers-reduced-motion: reduce)')
    const { ic: NO_PREF, dis: NO_PREF_DISI } = medyaAyir(REDUCE_DISI, '@media (prefers-reduced-motion: no-preference)')
    const kural = (css, secici) => kurallar(css).find((k) => k.secici.replace(/\s+/g, ' ') === secici)
    const bildirim = (govde, ad) => {
        const m = govde.match(new RegExp(String.raw`(?:^|;)\s*${ad}\s*:\s*([^;]*)`))
        return m ? m[1].trim() : null
    }

    it('.kaymak-serit: opaklik ve transform .16s tek egri (var(--ease-kaymak)); yalniz bu ikisi', () => {
        const k = kural(NO_PREF_DISI, '.kaymak-serit')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'transition')).toBe('opacity .16s var(--ease-kaymak), transform .16s var(--ease-kaymak)')
        expect(k.govde).not.toMatch(/\banimation\s*:/)
    })

    it('.kaymak-serit-gizli: opacity 0, translateY(-8px), pointer-events none; iki hareket tercihinde de gecerli (medya blogu disinda)', () => {
        const k = kural(NO_PREF_DISI, '.kaymak-serit-gizli')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'opacity')).toBe('0')
        expect(bildirim(k.govde, 'transform')).toBe('translateY(-8px)')
        expect(bildirim(k.govde, 'pointer-events')).toBe('none')
        expect(k.govde).not.toMatch(/\b(transition|animation)\s*:/)
        expect(kurallar(NO_PREF).some((x) => x.secici.includes('kaymak-serit'))).toBe(false)
    })

    it('hareket azaltilmissa serit gecisi yok (gizli hal ve yapisma kalir)', () => {
        const k = kural(REDUCE, '.kaymak-serit')
        expect(k).toBeTruthy()
        expect(bildirim(k.govde, 'transition')).toBe('none')
        expect(kural(REDUCE, '.kaymak-serit-gizli')).toBeUndefined()
    })

    it('serit kurallari width/top/box-shadow/filter canlandirmaz', () => {
        for (const k of kurallar(CSS).filter((x) => x.secici.includes('kaymak-serit'))) {
            const t = bildirim(k.govde, 'transition')
            if (t !== null && t !== 'none') {
                for (const parca of t.split(',')) expect(parca.trim()).toMatch(/^(opacity|transform)\s/)
            }
        }
    })

    it('Home: serit sinifi tek; baska oge kaymak-serit-gizli almaz', () => {
        expect(say(sablon(HOME), 'kaymak-serit ')).toBe(1)
        expect(say(sablon(HOME), "'kaymak-serit-gizli'")).toBe(1)
    })
})
