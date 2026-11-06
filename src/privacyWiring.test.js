// GIZLI MOD BAGLANTI KILITLERI (C-I6) -- kaynak-sekil testleri.
//
// Uc yuk tasiyan baglanti davranis testlerinde ortuluyor, bu yuzden yerinden
// cikarilirsa HICBIR test kirmiziya donmuyordu:
//  (a) bootstrapWalletUi gizlilik senkronunu kurar: dusurulurse arayuz gizli modda
//      da NORMAL gorunur ve ozellik ekranlarda kapali kalir, kapi ise (arka plan)
//      calismaya devam eder -- sessiz, tutarsiz bir durum.
//  (b) App.vue'nun UC yonlendiricisi PRIVACY_BLOCKED'i dogru hedefe tasir ve
//      header dugmesi bilgi panelini cizer: biri bozulursa ilk kullanim kilidi ya da
//      engellenen-dapp penceresi bos/takili kalir.
//  (c) Send.vue Gizli Hesap adresini composable'a verir ve uyari kutusunu cizer:
//      dusurulurse erken uyari ve dugme kilidi kaybolur.
// Yorum ve import satirlari taranmaz (yorumsuz): iddia yalnizca KOD ile saglanir.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi } from './test-utils/kaynakTarama'
import { oklchHex, oklchRgb, morMu } from './test-utils/morRenk'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

describe('bootstrap: gizlilik senkronu', () => {
    const govde = blokGovdesi(read('shared/bootstrap.js'), /export function bootstrapWalletUi\([^)]*\)\s*/)

    it('bayrak aciksa installPrivacySync({ privacyStore }) cagrilir ve teardown SAKLANIR', () => {
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/if\s*\(\s*PRIVACY_ENABLED\s*\)\s*\{\s*installPrivacySync\(\s*\{\s*privacyStore\s*\}\s*\)[\s\S]*?privacySyncTeardown\s*=\s*teardown/)
    })

    it('onceki teardown KAPATILIR, ardindan kurulur; uygulama bundan SONRA mount edilir', () => {
        const kod = yorumsuz(govde)
        const kapat = kod.indexOf('privacySyncTeardown?.()')
        const kur = kod.indexOf('installPrivacySync(')
        // Mount artik mountApp() icinde (para birimi bekleyisiyle); senkron zinciri onu SON halka olarak cagirir.
        const mount = kod.indexOf('.then(mountApp)')
        expect(kod).toMatch(/const mountApp = \(\) => \{[\s\S]*?app\.mount\('#app'\)/)
        expect(kapat).toBeGreaterThan(-1)
        expect(kur).toBeGreaterThan(kapat)
        expect(mount).toBeGreaterThan(kur)
        // Gizlilik senkronu, ortak arayuz senkronundan SONRA kurulur.
        expect(kod.indexOf('uiSyncTeardown = installUiSync(')).toBeLessThan(kapat)
    })

    // E14 (gizli-mod cok-ag spec 4.7): gizlilik durumu yuklenmeden mount edilirse ilk cizim ve ilk istekler Gizli
    // Hesap aktifken bile normal mod gibi calisir. Davranisi shared/bootstrapPrivacyMount.test.js olcer; burasi
    // yapinin yerinden oynamasini yakalar: mount senkron zincirinin SON halkasidir, bayrak kapaliyken hemen yapilir.
    it('PRIVACY_ENABLED iken mount, senkron zincirinin SON halkasidir; bayrak kapaliyken hemen mount edilir', () => {
        const kod = yorumsuz(govde)
        const zincir = kod.slice(kod.indexOf('installPrivacySync('))
        expect(zincir).toMatch(/\.catch\(\(e\)\s*=>\s*\{[\s\S]*?\}\)\s*\.then\(mountApp\)/)
        expect(kod).toMatch(/\}\s*else\s*\{\s*mountApp\(\)\s*\}/)
    })
})

describe('bootstrap: fiyat kesicisi (gizli-mod cok-ag spec 4.7, E6)', () => {
    const govdeHam = blokGovdesi(read('shared/bootstrap.js'), /export function bootstrapWalletUi\([^)]*\)\s*/)
    const govde = govdeHam === null ? null : yorumsuz(govdeHam)

    it('bayrak aciksa axios a installPriceGate(axios, () => privacyStore().active) kurulur ve teardown SAKLANIR', () => {
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/if\s*\(\s*PRIVACY_ENABLED\s*\)\s*priceGateTeardown\s*=\s*installPriceGate\(\s*axios\s*,\s*\(\)\s*=>\s*privacyStore\(\)\.active\s*\)/)
    })

    it('onceki kesici KAPATILIR, ardindan kurulur (yoksa her cagri bir kesici daha biriktirir)', () => {
        const kapat = govde.indexOf('priceGateTeardown?.()')
        const kur = govde.indexOf('installPriceGate(')
        expect(kapat).toBeGreaterThan(-1)
        expect(kur).toBeGreaterThan(kapat)
    })

    it('kesici gizlilik senkronundan ONCE kurulur: ilk istekler kapisiz kalmaz', () => {
        expect(govde.indexOf('installPriceGate(')).toBeGreaterThan(-1)
        expect(govde.indexOf('installPriceGate(')).toBeLessThan(govde.indexOf('installPrivacySync('))
    })
})

describe('App.vue: PRIVACY_BLOCKED yonlendirmesi ve ilk kullanim sayfasi', () => {
    const app = yorumsuz(read('popup/App.vue'))

    // Her yonlendirici kendi kardes `case` lerinin KULLANDIGI hedef bicimini kullanir:
    // kilidi acik popup `page.currentPage =`, kilitli popup `page.redirect =`, canli
    // degisim izleyicisi satir ici `page.currentPage =`. Dogru yonlendiricide oldugu,
    // ayni switch'teki kardes case ile AYNI bicimin kullanilmasindan anlasilir.
    const hedef = (metin) => {
        const m = metin.match(/page\.(currentPage|redirect)\s*=\s*'([a-z_]+)'/)
        return m ? { alan: m[1], sayfa: m[2] } : null
    }
    const vakalar = [...app.matchAll(/case 'PRIVACY_BLOCKED':\s*([^\n]*\n[^\n]*)/g)]

    it('PRIVACY_BLOCKED UC yonlendiricide de var', () => {
        expect(vakalar).toHaveLength(3)
    })

    it('her yonlendirici dogru hedefe tasir: acik=currentPage, kilitli=redirect, canli=currentPage', () => {
        expect(vakalar.map((m) => hedef(m[0]))).toEqual([
            { alan: 'currentPage', sayfa: 'privacy_blocked' },
            { alan: 'redirect', sayfa: 'privacy_blocked' },
            { alan: 'currentPage', sayfa: 'privacy_blocked' },
        ])
    })

    it('her PRIVACY_BLOCKED hedefi, ayni switch\'teki kardes case ile AYNI bicimde yazilir', () => {
        for (const m of vakalar) {
            // Eslesmenin hemen oncesindeki en yakin kardes case
            const oncesi = app.slice(0, m.index)
            const kardes = [...oncesi.matchAll(/case 'SOLANA_SIGN_MESSAGE':\s*([^\n]*\n[^\n]*)/g)].pop()
            expect(kardes).toBeTruthy()
            expect(hedef(kardes[0]).alan).toBe(hedef(m[0]).alan)
        }
    })

    it("bilgi paneli header dugmesinden cizilir, 'privacy_intro' sayfasi yok", () => {
        const toggle = yorumsuz(read('components/privacy/PrivacyToggle.vue'))
        expect(toggle).toMatch(/<PrivacyIntro\s+v-if="showIntro"\s+@close="closeIntro"/)
        expect(app).not.toContain('privacy_intro')
        expect(app).toContain(`<PrivacyBlocked v-if="page.currentPage === 'privacy_blocked'"`)
    })
})

describe('Send.vue: Gizli Hesap alicisi', () => {
    const send = yorumsuz(read('components/Send.vue'))

    it('useAddressSecurity a privateAddress verilir', () => {
        expect(send).toContain('privateAddress: computed(() => privacy.privateAddress)')
    })

    it('uyari kutusu privateRecipient ile cizilir', () => {
        expect(send).toContain('v-if="privateRecipient"')
    })

    it('privateRecipient composable dan alinir (yerel kopya yok)', () => {
        expect(send).toMatch(/privateRecipient,\s*\r?\n\s*\}\s*=\s*useAddressSecurity\(/)
    })
})

// Secici listesini yalniz en distaki virgullerden boler: :is(...), :not(...), [..] ve tirnak icindekiler bolunmez.
function ustDuzeyBol(liste) {
    const parcalar = []
    let derinlik = 0
    let tirnak = null
    let bas = 0
    for (let i = 0; i < liste.length; i++) {
        const c = liste[i]
        if (tirnak) {
            if (c === tirnak) tirnak = null
        } else if (c === '"' || c === "'") tirnak = c
        else if (c === '(' || c === '[') derinlik++
        else if (c === ')' || c === ']') derinlik--
        else if (c === ',' && derinlik === 0) {
            parcalar.push(liste.slice(bas, i))
            bas = i + 1
        }
    }
    return [...parcalar, liste.slice(bas)]
}

describe('Gizli mod ton kaymasi', () => {
    const header = yorumsuz(read('components/Header.vue'))
    const css = read('popup/style.css')
    const kod = css.replace(/\/\*[\s\S]*?\*\//g, '')

    it('header gizli modda duz renge boyanmaz', () => {
        expect(header).not.toMatch(/private:bg-/)
    })

    it('header da GIZLI rozeti yok (mod hayalet + tonla belli olur)', () => {
        expect(header).not.toContain('privacy.banner')
    })

    it('gecis animasyonu yalniz html.privacy-switching altinda (tema gecisi etkilenmez)', () => {
        expect(css).toMatch(/html\.privacy-switching::view-transition-old\(root\)/)
        expect(css).toMatch(/html\.privacy-switching::view-transition-new\(root\)/)
    })

    it('koyu temada gri tonlar yalniz html.private.dark altinda (giris ekrani haric) grafit tona kayar', () => {
        expect(css).toMatch(/html\.private\.dark:not\(\.privacy-paused\)\s*\{[^}]*--color-zinc-900:/)
        expect(css).toContain(String.raw`html.private.dark:not(.privacy-paused) .dark\:bg-\[\#09090b\]`)
    })

    // Duraklatma kapisi olmayan gizli kural kalmamali: giris ekrani (html.privacy-paused) da tonlanir ya da murekkebe
    // donerdi ve gizli modu ele verirdi. Her tema ve ortak kural sayilir; html.privacy-switching gibi siniflar sayilmaz.
    it('her html.private kurali giris ekraninda kapali: :not(.privacy-paused) tasir', () => {
        const secicilar = [...kod.matchAll(/([^{};]+)\{/g)].flatMap((m) => ustDuzeyBol(m[1])).map((s) => s.trim())
        const gizli = secicilar.filter((s) => /^html\.private(?![\w-])/.test(s))
        expect(gizli.length).toBeGreaterThan(20)
        expect(gizli.filter((s) => !s.includes(':not(.privacy-paused)'))).toEqual([])
    })

    it('acik temada yalniz html.private:not(.dark) altinda (giris ekrani haric) kayar', () => {
        expect(css).toMatch(/html\.private:not\(\.dark\):not\(\.privacy-paused\)\s*\{[^}]*--color-slate-50:/)
    })

    // Grafit karari (kullanici, 2026-10-26): gizli ton mor DEGIL. Gizli kurallardaki her duz renk (oklch, rgb/rgba, 6 haneli
    // hex) OKLCH'ye cevrilir; mor aralikta (ton 270-335) VE sezilebilir renkte (C >= 0.01) olan kalmamali. Esik morMu'dan
    // (C >= 0.02) siki: reddedilen eski gece-mor zemin #0c0a13 (C 0.019) ve eski acik slate-100 (C 0.013) yakalanir.
    // C 0.01 altindaki sapma gozle secilmez (OKLab'da fark esigi ~0.02); bugunku acik notr tonlar da C 0.002-0.005.
    // Sayilmayan bir renk bicimi (hsl, color-mix, 3/4/8 haneli hex...) yazilirsa test yine kalir.
    it('gizli ton mor degil: gizli kurallardaki hicbir renk mor aralikta ve renkli degil', () => {
        const govdeler = [...kod.matchAll(/html\.private[^{]*:not\(\.privacy-paused\)[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('\n')
        const OKLCH = /oklch\(\s*[\d.]+%?\s+([\d.]+)\s+([\d.]+)\s*\)/g
        const RGB = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[^)]*\)/g
        const HEX = /#[0-9a-f]{6}\b/gi
        const renkler = [
            ...[...govdeler.matchAll(OKLCH)].map((m) => ({ ad: m[0], C: +m[1], H: +m[2] })),
            ...[...govdeler.matchAll(RGB)].map((m) => ({ ad: m[0], ...oklchRgb(+m[1], +m[2], +m[3]) })),
            ...[...govdeler.matchAll(HEX)].map((m) => ({ ad: m[0], ...oklchHex(m[0]) })),
        ]
        expect(renkler.length).toBeGreaterThanOrEqual(10)
        expect(renkler.filter(({ C, H }) => C >= 0.01 && H >= 270 && H <= 335).map((r) => r.ad)).toEqual([])
        const sayilmayan = govdeler.replace(OKLCH, '').replace(RGB, '').replace(HEX, '')
        expect(sayilmayan.match(/\b(?:oklab|oklch|lab|lch|hsla?|hwb|color-mix|color)\(|#[0-9a-f]{3,8}\b/gi)).toBeNull()
    })

    // Grafit karari, ikinci adim (kullanici, 2026-10-26): uygulamanin vurgusu indigo (yuzlerce sinif: menuler, gizli
    // gonderim, Takas/Kopru/Ayarlar). Gizli modda indigo/violet/purple/fuchsia paletlerinin HER tonu iki temada da TEK
    // yerden notre eslenir; normal mod (html.private yok) ve giris ekrani (privacy-paused) etkilenmez.
    const MOR_AILELER = ['indigo', 'violet', 'purple', 'fuchsia']
    const TONLAR = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

    it('gizli modda mor paletlerin her tonu notr rampaya eslenir; rampa iki temada da tanimli', () => {
        const govde = (re) => [...css.matchAll(re)].map((m) => m[1]).join('\n')
        const ortak = govde(/html\.private:not\(\.privacy-paused\)\s*\{([^}]*)\}/g)
        for (const aile of MOR_AILELER) {
            for (const ton of TONLAR) expect(ortak).toMatch(new RegExp(`--color-${aile}-${ton}:\\s*var\\(--gizli-notr-${ton}\\)`))
        }
        for (const tema of [/html\.private\.dark:not\(\.privacy-paused\)\s*\{([^}]*)\}/g, /html\.private:not\(\.dark\):not\(\.privacy-paused\)\s*\{([^}]*)\}/g]) {
            for (const ton of TONLAR) expect(govde(tema)).toContain(`--gizli-notr-${ton}:`)
        }
    })

    // Merkezi kurallar (golge, murekkep, susleme) her biri TEK secici; renkleri tema bloklarinda (--gizli-*). Sinif
    // listeleri bilesenlerden turetilir: yeni bir kullanim listede yoksa ya da bir kopyadan sinif duserse test kalir.
    // Onboarding bu CSS'i yuklemez (kendi style.css'i var, gizli mod orada hic acilmaz): taranmaz.
    const kurallar = (secici) => [...kod.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ secici: m[1].trim(), govde: m[2] })).filter((k) => secici.test(k.secici))
    const temaGovdesi = {
        koyu: [...kod.matchAll(/html\.private\.dark:not\(\.privacy-paused\)\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n'),
        acik: [...kod.matchAll(/html\.private:not\(\.dark\):not\(\.privacy-paused\)\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n'),
    }
    const popupBilesenleri = readdirSync(join(here, 'components'), { recursive: true })
        .filter((f) => f.endsWith('.vue') && !/^onboarding[\\/]/.test(f))
        .map((f) => read(join('components', f)))
    // Bir acilis etiketi; tirnakli ozellik degerlerindeki '>' (ok fonksiyonu, karsilastirma) etiketi bitirmez.
    const ETIKET = /<[a-zA-Z][\w-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*\s*\/?>/g
    const sinifSecicisi = (sinif) => '.' + sinif.replace(/[[\]/.:#%()]/g, '\\$&')
    // Secicideki ilk :is(...) grubunun ogeleri (parantez dengesiyle; tirnak icindeki parantezler sayilmaz).
    const isListesi = (secici) => {
        const bas = secici.indexOf(':is(') + 4
        let derinlik = 1
        let tirnak = null
        for (let i = bas; i < secici.length; i++) {
            const c = secici[i]
            if (tirnak) {
                if (c === tirnak) tirnak = null
            } else if (c === '"' || c === "'") tirnak = c
            else if (c === '(') derinlik++
            else if (c === ')' && --derinlik === 0) return ustDuzeyBol(secici.slice(bas, i)).map((s) => s.trim())
        }
        throw new Error(`:is( kapanmiyor: ${secici}`)
    }

    // Elle yazilmis (rgba) renkli parlamalar degiskenle tonlanmaz: bilesenlerdeki HER mor rgba golge kuralinda olmali.
    it('gizli modda mor parlamalar (rgba ve shadow-indigo-* gibi) tek kuralla tema golgesine iner', () => {
        const golge = kurallar(/^html\.private:not\(\.privacy-paused\) :is\(\[class\*=/)
        expect(golge).toHaveLength(1)
        expect(golge[0].govde).toMatch(/--tw-shadow-color:\s*var\(--gizli-golge\)/)
        for (const aile of MOR_AILELER) expect(golge[0].secici).toContain(`[class*="shadow-${aile}-"]`)
        const morlar = new Set()
        for (const kaynak of popupBilesenleri) {
            for (const m of kaynak.matchAll(/\[[^\]\s"']*rgba\((\d+),\s*(\d+),\s*(\d+)/g)) {
                if (morMu(oklchRgb(+m[1], +m[2], +m[3]))) morlar.add(`${m[1]},${m[2]},${m[3]}`)
            }
        }
        expect(morlar.size).toBeGreaterThan(0)
        for (const rgb of morlar) expect(golge[0].secici).toContain(`[class*="rgba(${rgb}"]`)
    })

    it('golge rengi temaya bolunur: koyuda saydam, acikta notr golge (shadow-md gibi notr golgeler kaybolmaz)', () => {
        expect(temaGovdesi.koyu).toMatch(/--gizli-golge:\s*transparent/)
        expect(temaGovdesi.acik).toMatch(/--gizli-golge:\s*rgb\(0 0 0 \/ 0\.1\)/)
    })

    // Ekran denetimi (2026-10-26): koyu rampa ayni parlaklikta oldugu icin dolu vurgu dugmeleri (bg-indigo-600 + beyaz yazi)
    // orta griye donup PASIF gorunuyordu. Gizli modda bu kalip Home'daki Gonder'in murekkebine esitlenir.
    it('murekkep renkleri tema bloklarinda: acikta zinc-950 ve beyaz yazi, koyuda zinc-200 ve koyu yazi', () => {
        expect(temaGovdesi.acik).toMatch(/--gizli-murekkep:\s*var\(--color-zinc-950\)/)
        expect(temaGovdesi.acik).toMatch(/--gizli-murekkep-yazi:\s*var\(--color-white\)/)
        expect(temaGovdesi.acik).toMatch(/--gizli-murekkep-hover:\s*var\(--color-zinc-800\)/)
        expect(temaGovdesi.koyu).toMatch(/--gizli-murekkep:\s*var\(--color-zinc-200\)/)
        expect(temaGovdesi.koyu).toMatch(/--gizli-murekkep-yazi:\s*var\(--color-zinc-950\)/)
        expect(temaGovdesi.koyu).toMatch(/--gizli-murekkep-hover:\s*var\(--color-zinc-300\)/)
    })

    // Dolgu, hover ve klavye odagi AYNI sinif listesini tasir. Odak: acik temada tarayicinin varsayilan (koyu, bosluksuz)
    // halkasi murekkep dolgunun icinde kayboluyordu (son inceleme, 2026-10-27); Home'daki Gonder gibi bosluklu cizgi.
    const MUREKKEP = /^html\.private:not\(\.privacy-paused\) :is\([^{]*\)\.text-white:not\(:disabled\)(:hover|:focus-visible)?$/
    const murekkep = (durum) => kurallar(MUREKKEP).filter((k) => (k.secici.match(MUREKKEP)[1] ?? '') === durum)

    it('gizli modda dolu vurgu dugmeleri murekkep: dolgu, hover ve odak ayni listeyle; devre disi haric', () => {
        const [dolgu, hover, odak] = ['', ':hover', ':focus-visible'].map(murekkep)
        expect([dolgu.length, hover.length, odak.length]).toEqual([1, 1, 1])
        expect(dolgu[0].govde).toMatch(/background-image:\s*none/)
        expect(dolgu[0].govde).toMatch(/background-color:\s*var\(--gizli-murekkep\)/)
        expect(dolgu[0].govde).toMatch(/(?<![\w-])color:\s*var\(--gizli-murekkep-yazi\)/)
        expect(hover[0].govde).toMatch(/background-color:\s*var\(--gizli-murekkep-hover\)/)
        expect(odak[0].govde).toMatch(/outline:\s*2px solid var\(--gizli-murekkep\)/)
        expect(odak[0].govde).toMatch(/outline-offset:\s*2px/)
        expect(isListesi(hover[0].secici)).toEqual(isListesi(dolgu[0].secici))
        expect(isListesi(odak[0].secici)).toEqual(isListesi(dolgu[0].secici))
    })

    it('ayni etikette text-white ile gecen her dolu mor zemin ve gradyan sinifi murekkep listesinde', () => {
        const liste = isListesi(murekkep('')[0].secici)
        const gerekli = new Set()
        for (const kaynak of popupBilesenleri) {
            for (const [etiket] of kaynak.matchAll(ETIKET)) {
                if (!/(?<![\w:/-])text-white(?![\w/-])/.test(etiket)) continue
                for (const [sinif] of etiket.matchAll(/(?<![\w:/-])(?:bg|from)-(?:indigo|violet|purple|fuchsia)-\d+(?![\w/-])/g)) gerekli.add(sinifSecicisi(sinif))
            }
        }
        // Kopru/Takas gradyanli ana dugmesi ve gizli gonderim dugmeleri bu kaliptadir: tarama bos donerse kendisi bozuktur.
        expect([...gerekli]).toEqual(expect.arrayContaining(['.bg-indigo-600', '.from-indigo-600', '.bg-violet-600']))
        expect([...gerekli].filter((s) => !liste.includes(s))).toEqual([])
    })

    it('koyu rampada vurgu yazi tonlari (300/400) acik murekkep: sonuk gri kalmaz', () => {
        const koyu = [...css.matchAll(/html\.private\.dark:not\(\.privacy-paused\)\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n')
        for (const ton of [300, 400]) {
            const L = +koyu.match(new RegExp(`--gizli-notr-${ton}:\\s*oklch\\(([\\d.]+)%`))?.[1]
            expect(L).toBeGreaterThanOrEqual(85)
        }
    })

    // Yikama kurali da yalniz BOS ogelere dokunur: pointer-events-none tasiyan icerikli bir oge (orn. gradyan yazi)
    // zeminini kaybedip gorunmez olurdu. Icerikli ogenin gradyani zaten notr rampaya eslenir.
    it('gizli modda mor ust yikamalar cizilmez: yalniz bos, tiklanamaz katmanlar', () => {
        const yikama = kurallar(/^html\.private:not\(\.privacy-paused\) \.pointer-events-/)
        expect(yikama).toHaveLength(1)
        expect(yikama[0].secici).toMatch(/^html\.private:not\(\.privacy-paused\) \.pointer-events-none:empty:is\(/)
        expect(yikama[0].govde).toMatch(/background-image:\s*none/)
        for (const aile of MOR_AILELER) expect(yikama[0].secici).toContain(`[class*="from-${aile}-"]`)
    })

    it('bos ogelerdeki her bulaniklik sinifi hale kuralinda: gizli modda bos haleler cizilmez', () => {
        const hale = kurallar(/^html\.private:not\(\.privacy-paused\) :is\(\.blur/)
        expect(hale).toHaveLength(1)
        expect(hale[0].secici).toMatch(/\):empty$/)
        expect(hale[0].govde).toMatch(/display:\s*none/)
        const liste = isListesi(hale[0].secici)
        const gerekli = new Set()
        for (const kaynak of popupBilesenleri) {
            for (const m of kaynak.matchAll(ETIKET)) {
                const bos = m[0].endsWith('/>') || /^\s*<\//.test(kaynak.slice(m.index + m[0].length))
                if (!bos) continue
                for (const [sinif] of m[0].matchAll(/(?<![\w:/-])blur(?:-\[[^\]\s"']+\]|-[\w.]+)?(?![\w/[-])/g)) gerekli.add(sinifSecicisi(sinif))
            }
        }
        expect([...gerekli]).toEqual(expect.arrayContaining(['.blur-xl', '.blur-2xl']))
        expect([...gerekli].filter((s) => !liste.includes(s))).toEqual([])
    })

    it('sabit (hex) koyu zeminler de grafite eslenir: mor-siyah panel, kart kenari, yari saydam menu', () => {
        expect(css).toContain(String.raw`html.private.dark:not(.privacy-paused) .dark\:bg-\[\#0d0b14\]`)
        expect(css).toContain(String.raw`html.private.dark:not(.privacy-paused) .dark\:border-\[\#131315\]`)
        expect(css).toContain(String.raw`html.private.dark:not(.privacy-paused) .dark\:bg-\[\#131315\]\/90`)
    })

    it('atmosfer gelisi yalniz html.privacy-arriving altinda canlandirilir', () => {
        expect(css).toMatch(/html\.privacy-arriving::view-transition-old\(root\)/)
    })
})

describe('App.vue: giris ekraninda atmosfer duraklar', () => {
    const app = yorumsuz(read('popup/App.vue'))

    it('sayfa degisimi denetleyiciye ilk degerle birlikte iletilir', () => {
        expect(app).toMatch(/watch\(\(\) => page\.currentPage, \(now, prev\) => atmosphere\.onPageChange\(now, prev\), \{ immediate: true \}\)/)
    })

    it('sayfa gecisinin bitisi denetleyiciye iletilir', () => {
        expect(app).toContain('<Transition name="fade-slide" mode="out-in" @after-enter="atmosphere.onPageEntered">')
    })
})
