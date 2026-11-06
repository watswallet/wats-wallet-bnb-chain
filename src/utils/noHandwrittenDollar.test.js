// KALINTI `$` KILIDI (Para birimi, Bolum B).
//
// Fiyat/deger gosteren her yer tek biciminden (utils/money.js, useMoney) gecer. Elle
// yazilmis bir `$` secili birimi yok sayar ve sessizce yanlis para birimi gosterir:
// kullanici TRY secmisken "$12.34" gorur. Bu dosya o kalibin sizmasini iki yerde kilitler:
//  1. src altindaki kaynak (.vue ve .js, test haric): yasak kaliplar.
//  2. i18n metinleri: "$" yalniz SABIT USD kural metinlerinde (hesaplanmis tutar degil).
//
// Dosya listeleri diskten TURETILIR (yeni dosya kendiliginden taranir; elle liste yok).
// Tarama `yorumsuz()` ile yapilir: yorum bir ihlali gizleyemez / sahte ihlal uretemez.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'

const BU_DIZIN = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(BU_DIZIN, '..')
const LOCALES = path.join(SRC, 'i18n', 'locales')

// ${{ x }}, '$' + x, x + '$', `$${x}`, "$" + x, <span>$</span>
const YASAK = [/\$\{\{/, /\+\s*'\$'/, /'\$'\s*\+/, /`\$\$\{/, /"\$"\s*\+/, />\s*\$\s*</]

// Yasak kalip tasiyan ama ekrana CIKMAYAN kodun izni. Her kaydin nedeni yazili olmak zorunda.
const IZINLI = [{ dosya: 'utils/swap.js', neden: 'totalCostUSD olu alan: hicbir yerde okunmuyor, gosterilmiyor' }]

// `$` icerebilecek TEK sabit kural metinleri (sabit USD tutari; kur ile degismez).
const SABIT_KURAL = [
    'stockTrade.atsFee.title',
    'stockTrade.atsFee.sub',
    'stockTrade.atsFee.netNote',
    'stockTrade.atsFee.confirmLine',
    'atsSale.errors.amountTooSmall',
    'atsSale.errors.amountTooLarge',
]
// Hesaplanmis tutari yer tutucu ile alan metinler: hicbir dilde `$` olmaz.
const HESAPLANMIS = [
    'stockTrade.quote.networkFeeLine',
    'stockTrade.hint.amountMin',
    'atsSale.errors.stockInsufficient',
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

// Tarayici: yorumlar atildiktan sonra hangi yasak kaliplar var -> [{ kalip, satir }].
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

// { 'a.b.c': 'metin' } -- i18n agacini duzlestirir (yalniz string yapraklar).
function duzlestir(nesne, onek = '', cikti = {}) {
    for (const [anahtar, deger] of Object.entries(nesne)) {
        const yol = onek ? `${onek}.${anahtar}` : anahtar
        if (deger && typeof deger === 'object') duzlestir(deger, yol, cikti)
        else if (typeof deger === 'string') cikti[yol] = deger
    }
    return cikti
}

const dilDosyalari = () => fs.readdirSync(LOCALES).filter((ad) => ad.endsWith('.json')).sort()
const dil = (kod) => duzlestir(JSON.parse(fs.readFileSync(path.join(LOCALES, `${kod}.json`), 'utf8')))
const dolarliAnahtarlar = (duz) => Object.keys(duz).filter((k) => duz[k].includes('$')).sort()

describe('kaynak: elle yazilmis dolar kaliplari', () => {
    // POZITIF KONTROL: tarayici kendi kaliplarini gercekten yakalamiyorsa asagidaki "temiz"
    // sonucu hicbir sey ifade etmez. Ornekler YASAK ile ayni sirada.
    it('tarayicinin kendisi isirir: her yasak kalip ornek metinde yakalanir', () => {
        const ORNEKLER = [
            '<span>${{ price }}</span>',
            "const t = price + '$'",
            "const t = '$' + price",
            'const t = `$${price}`',
            'const t = "$" + price',
            '<div><span>$</span></div>',
        ]
        expect(ORNEKLER).toHaveLength(YASAK.length)
        ORNEKLER.forEach((metin, i) => {
            expect(ihlaller(metin).map((b) => b.kalip), metin).toContain(String(YASAK[i]))
        })
    })

    it('yorumdaki kalip ihlal sayilmaz, kod satirindaki sayilir (satir numarasiyla)', () => {
        expect(ihlaller("// const t = '$' + price\n/* `$${x}` */")).toEqual([])
        expect(ihlaller('<!-- ${{ x }} -->')).toEqual([])

        const bulunan = ihlaller("// aciklama\nconst t = '$' + price")
        expect(bulunan).toHaveLength(1)
        expect(bulunan[0].satir).toBe(2)
    })

    it('tarama kapsami bos degil (beklenen dosyalar listede, test dosyasi yok)', () => {
        const adlar = yururle(SRC).map(goreli)
        expect(adlar).toContain('components/popups/AddressBook.vue')
        expect(adlar).toContain('utils/money.js')
        expect(adlar).toContain('utils/swap.js')
        expect(adlar.some(testDosyasi)).toBe(false)
    })

    it('src altindaki .vue ve .js (test haric) dosyalarinda, yorumlar atildiktan sonra yasak kalip yok (izinli liste haric)', () => {
        const izinli = new Set(IZINLI.map((i) => i.dosya))
        const sorunlar = []
        for (const yol of yururle(SRC)) {
            const rel = goreli(yol)
            if (izinli.has(rel)) continue
            for (const b of ihlaller(fs.readFileSync(yol, 'utf8'))) {
                sorunlar.push(`${rel}:${b.satir} ${b.kalip}`)
            }
        }
        expect(sorunlar).toEqual([])
    })

    it('izinli liste bayatlamaz: her kayit hala bir yasak kalip tasiyor ve nedeni yazili', () => {
        for (const { dosya, neden } of IZINLI) {
            expect(neden.length, dosya).toBeGreaterThan(10)
            const yol = path.join(SRC, dosya)
            expect(fs.existsSync(yol), `${dosya} yok`).toBe(true)
            expect(ihlaller(fs.readFileSync(yol, 'utf8')).length, `${dosya} artik temiz: izinden cikar`).toBeGreaterThan(0)
        }
    })
})

describe('i18n: "$" yalniz sabit USD kural metinlerinde', () => {
    it('en.json: "$" iceren anahtarlar TAM OLARAK sabit kural anahtarlaridir (title, sub, netNote, confirmLine, amountTooSmall, amountTooLarge)', () => {
        expect(dolarliAnahtarlar(dil('en'))).toEqual([...SABIT_KURAL].sort())
    })

    it('tr.json: ayni alti anahtar "$" icerir; networkFeeLine / amountMin / stockInsufficient hicbir dilde "$" icermez', () => {
        expect(dolarliAnahtarlar(dil('tr'))).toEqual([...SABIT_KURAL].sort())

        const dosyalar = dilDosyalari()
        expect(dosyalar).toEqual(expect.arrayContaining(['en.json', 'tr.json']))
        for (const dosya of dosyalar) {
            const duz = dil(dosya.replace(/\.json$/, ''))
            for (const anahtar of HESAPLANMIS) {
                // en ve tr'de anahtar MUTLAKA var (bos gecen kilit olmasin); diger dillerde
                // henuz cevrilmemis olabilir: varsa "$" icermemeli.
                if (dosya === 'en.json' || dosya === 'tr.json') {
                    expect(typeof duz[anahtar], `${dosya} ${anahtar}`).toBe('string')
                }
                if (duz[anahtar] !== undefined) expect(duz[anahtar], `${dosya} ${anahtar}`).not.toContain('$')
            }
        }
    })
})
