// SAYI / TARIH BICIMI KALINTI TARAMASI (Dil destegi, Bolum C).
//
// Ekrandaki sayi ve tarihler UYGULAMA DILINE gore yazilir. Sabit 'en-US' ya da dilsiz
// (`toLocaleString()` -> sistem/tarayici dili) bir cagri, 12 dilli arayuzde yanlis ayrac
// ve tarih sirasi basar: Almanca kullanici "1,234.5" gorur, ya da Turkce arayuzde
// tarayici dili Ingilizce oldugu icin tarih "11/14/2023" cikar.
//
// Dosya listesi diskten TURETILIR (yeni dosya kendiliginden taranir; elle liste yok).
// Tarama `yorumsuz()` ile yapilir: yorum bir ihlali gizleyemez / sahte ihlal uretemez.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'
import { formatAtsAmount } from '../utils/atsAmountFormat'

const BU_DIZIN = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(BU_DIZIN, '..')

// toLocale(Date|Time)?String('en-US' ...) ya da argumansiz toLocale(Date|Time)?String(); ayni
// tehlike Intl kurucularinda da var (sabit 'en-US' ya da dilsiz kurucu).
const YASAK = [
    /toLocale(?:Date|Time)?String\(\s*['"]en-US['"]/,
    /toLocale(?:Date|Time)?String\(\s*\)/,
    /Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|ListFormat|PluralRules)\(\s*(?:['"]en-US['"]|\))/,
]

// Bilerek en-US'te kalan dosyalar. Her kaydin NEDENI yazili olmak zorunda (kullanici karari).
const ISTISNALAR = [
    {
        dosya: 'utils/atsAmountFormat.js',
        neden: 'ATS tutari kopyalanip borsaya girilen bir sayi: ondalik ayracinin dile gore virgule donmesi (8,583333) kullaniciyi yanlis miktara goturur',
    },
    {
        dosya: 'components/Dapp.vue',
        neden: 'atsCompact ATS tutarini gosterir; atsAmountFormat.js ile ayni gerekce (kopyalanip borsaya girilen tutar)',
    },
]

const testDosyasi = (ad) => /\.(test|spec)\.[cm]?js$/.test(ad)

function yururle(dizin) {
    const cikti = []
    for (const girdi of fs.readdirSync(dizin, { withFileTypes: true })) {
        const yol = path.join(dizin, girdi.name)
        if (girdi.isDirectory()) {
            if (girdi.name === 'node_modules') continue
            cikti.push(...yururle(yol))
        } else if (/\.(js|vue)$/.test(girdi.name) && !testDosyasi(girdi.name)) {
            cikti.push(yol)
        }
    }
    return cikti
}

const goreli = (yol) => path.relative(SRC, yol).split(path.sep).join('/')

// Yorumlar atildiktan sonra hangi yasak kaliplar var -> [{ kalip, satir }].
function ihlaller(metin) {
    const kod = yorumsuz(metin)
    const bulunan = []
    for (const kalip of YASAK) {
        for (const eslesme of kod.matchAll(new RegExp(kalip.source, 'g'))) {
            bulunan.push({ kalip: String(kalip), satir: kod.slice(0, eslesme.index).split('\n').length })
        }
    }
    return bulunan
}

describe('kaynak: sabit en-US ve dilsiz sayi/tarih bicimleme kalintisi', () => {
    // POZITIF KONTROL: tarayici kendi kaliplarini gercekten yakalamiyorsa asagidaki "temiz"
    // sonucu hicbir sey ifade etmez.
    it('tarayicinin kendisi isirir: her yasak kalip ornek metinde yakalanir', () => {
        const ORNEKLER = [
            "n.toLocaleString('en-US', { maximumFractionDigits: 2 })",
            'new Date(ms).toLocaleDateString()',
            "new Intl.NumberFormat('en-US').format(n)",
        ]
        ORNEKLER.forEach((metin) => {
            expect(ihlaller(metin).length, metin).toBeGreaterThan(0)
        })
        // Varyantlar: cift tirnak + bosluk, Time/duz String, argumansiz Intl kurucusu.
        expect(ihlaller('d.toLocaleTimeString( "en-US" )')).toHaveLength(1)
        expect(ihlaller('n.toLocaleString( )')).toHaveLength(1)
        expect(ihlaller('new Intl.DateTimeFormat().format(d)')).toHaveLength(1)
    })

    it('dil verilmis cagrilar ihlal sayilmaz', () => {
        expect(ihlaller('n.toLocaleString(locale.value, { maximumFractionDigits: 2 })')).toEqual([])
        expect(ihlaller('d.toLocaleDateString(locale)')).toEqual([])
        expect(ihlaller('new Intl.NumberFormat(locale, { style: "currency", currency: code })')).toEqual([])
        expect(ihlaller('new Intl.DateTimeFormat(props.locale, { hour: "2-digit" }).format(d)')).toEqual([])
    })

    it('yorumdaki kalip ihlal sayilmaz, kod satirindaki sayilir (satir numarasiyla)', () => {
        expect(ihlaller("// n.toLocaleString('en-US')\n/* d.toLocaleDateString() */")).toEqual([])
        expect(ihlaller("<!-- n.toLocaleString('en-US') -->")).toEqual([])

        const bulunan = ihlaller("// aciklama\nconst s = n.toLocaleString('en-US')")
        expect(bulunan).toHaveLength(1)
        expect(bulunan[0].satir).toBe(2)
    })

    it('tarama kapsami bos degil (beklenen dosyalar listede, test dosyasi yok)', () => {
        const adlar = yururle(SRC).map(goreli)
        expect(adlar).toContain('utils/tokenMark.js')
        expect(adlar).toContain('utils/priceHistory.js')
        expect(adlar).toContain('components/ConfirmTransaction.vue')
        expect(adlar).toContain('components/Token.vue')
        for (const { dosya } of ISTISNALAR) expect(adlar).toContain(dosya)
        expect(adlar.some(testDosyasi)).toBe(false)
    })

    it('her istisnanin nedeni yazili', () => {
        for (const { dosya, neden } of ISTISNALAR) {
            expect(neden.length, dosya).toBeGreaterThan(20)
        }
    })

    it('istisnalar gercekten ihlal tasiyor (artik gerekmeyen istisna listede kalmaz)', () => {
        for (const { dosya } of ISTISNALAR) {
            const metin = fs.readFileSync(path.join(SRC, dosya), 'utf8')
            expect(ihlaller(metin).length, dosya).toBeGreaterThan(0)
        }
    })

    it('src altindaki .vue ve .js (test haric) dosyalarinda sabit en-US / dilsiz bicimleme yok (istisnalar haric)', () => {
        const izinli = new Set(ISTISNALAR.map((i) => i.dosya))
        const sorunlar = []
        for (const yol of yururle(SRC)) {
            const rel = goreli(yol)
            if (izinli.has(rel)) continue
            for (const b of ihlaller(fs.readFileSync(yol, 'utf8'))) {
                sorunlar.push(`${rel}:${b.satir} ${b.kalip}`)
            }
        }
        expect(sorunlar, `Sabit en-US ya da dilsiz bicimleme (uygulama dilini ver):\n${sorunlar.join('\n')}`).toEqual([])
    })
})

// ISTISNA: ATS tutari uygulama dilinden BAGIMSIZDIR (formatAtsAmount saf, dil almaz).
describe('ATS tutari en-US kalir', () => {
    it('ondalik nokta ve binlik virgul uygulama diline bakmadan sabit', () => {
        expect(formatAtsAmount(8.583333)).toBe('8.583333')
        expect(formatAtsAmount(1234.5)).toBe('1,234.5')
    })
})
