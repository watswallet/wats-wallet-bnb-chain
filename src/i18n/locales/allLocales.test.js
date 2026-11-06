// Diskteki HER dil dosyasinin (en.json disinda) YAPISAL butunlugu.
//
// KOK NEDEN: 10 yeni dil yapay zeka ajanlariyla en.json kaynagindan uretiliyor ve insan
// kontrolu yok. Ceviri sirasinda sessizce bozulan seyleri makine yakalamali: yer tutucu adi
// cevrilmis ({amount} -> {monto}), dusmus {count}, bozulmus <strong> oznitelikleri, tek
// bicimli dilde artakalan `|`, serbest `@`, vue-i18n'in derleyemedigi mesaj, cevrilmis marka
// terimi, ceviri yerine kalmis ingilizce metin. Hicbiri `$t` cagrisini cokertmez; kullanici
// ham anahtar, bozuk cumle ya da yanlis terim gorur.
//
// Dosya listesi diskten okunur: yeni bir <kod>.json eklendiginde test OTOMATIK onu da kosar.
// `describe.each(...)('%s dil dosyasi')` adi DEGISMEZ: ceviri gorevleri
// `-t "<kod> dil dosyasi"` ile yalniz kendi dilini suzer.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { baseCompile } from '@intlify/message-compiler'
import { PLURAL_FORMS, SUPPORTED_LANGS, CHROME_LOCALE_DIR } from '../languages'
import { flatten, placeholders, htmlTags, pluralFormCount, containsTerm } from '../messageTools'
import { PROTECTED_TERMS } from '../protectedTerms'

const here = dirname(fileURLToPath(import.meta.url))

const read = (dosya) => JSON.parse(readFileSync(join(here, dosya), 'utf8'))

const en = read('en.json')
const enFlat = flatten(en)
const enMap = new Map(enFlat)

const codes = readdirSync(here)
    .filter((ad) => ad.endsWith('.json') && ad !== 'en.json')
    .map((ad) => ad.slice(0, -'.json'.length))
    .sort()

// Ham anahtar yolu: bozuk bir birlestirme / yarim ceviri degerin yerine "send.errors.foo" birakir.
const HAM_ANAHTAR = /^[a-zA-Z]+(\.[a-zA-Z0-9_]+){2,}$/

// Her dilin yazi sistemi: degerlerin en az %85'inde bulunmali (kalan %15: yalniz terim,
// sayi ve simgeden olusan degerler).
const YAZI_SISTEMI = {
    ru: /\p{Script=Cyrillic}/u,
    'zh-CN': /\p{Script=Han}/u,
    ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
    ko: /\p{Script=Hangul}/u,
}
const YAZI_ESIGI = 0.85
const AYNI_DEGER_ESIGI = 0.15

// Sorun listesi bos olmali; bos degilse anahtar adlariyla gorunur.
function bos(sorunlar) {
    expect(sorunlar).toEqual([])
}

describe('en kaynagi', () => {
    it('dosya en az bir anahtar iceriyor ve hepsi dize', () => {
        expect(enFlat.length).toBeGreaterThan(0)
        expect(enFlat.filter(([, v]) => typeof v !== 'string').map(([k]) => k)).toEqual([])
    })

    it('| iceren her anahtar tam 2 bicimli (tekil | cogul)', () => {
        const sorunlar = enFlat
            .filter(([, v]) => v.includes('|'))
            .filter(([, v]) => pluralFormCount(v) !== 2)
            .map(([k, v]) => `${k}: ${pluralFormCount(v)} bicim`)
        bos(sorunlar)
    })

    it('her mesaj hatasiz derlenir', () => {
        const hatalar = []
        for (const [k, v] of enFlat) {
            baseCompile(v, { onError: (e) => hatalar.push(`${k}: ${e.message}`) })
        }
        bos(hatalar)
    })
})

describe.each(codes)('%s dil dosyasi', (kod) => {
    const dil = read(`${kod}.json`)
    const flat = flatten(dil)
    const map = new Map(flat)
    // Anahtar kumesi testi eksik/fazla anahtari bildirir; geri kalan testler ceviride
    // OLAN anahtarlar uzerinde calisir ki tek bir eksik anahtar 10 testi birden kirmasin.
    const ortak = flat.filter(([k]) => enMap.has(k))

    it('anahtar kumesi en ile ayni (fazla/eksik anahtar yok)', () => {
        const eksik = enFlat.map(([k]) => k).filter((k) => !map.has(k))
        const fazla = flat.map(([k]) => k).filter((k) => !enMap.has(k))
        expect({ eksik, fazla }).toEqual({ eksik: [], fazla: [] })
    })

    it('tum degerler dize; bos/yalniz-bosluk degeri ve ham anahtar yolu yok', () => {
        const sorunlar = []
        for (const [k, v] of flat) {
            if (typeof v !== 'string') sorunlar.push(`${k}: dize degil`)
            else if (v.trim() === '') sorunlar.push(`${k}: bos`)
            else if (HAM_ANAHTAR.test(v.trim())) sorunlar.push(`${k}: ham anahtar yolu "${v}"`)
        }
        bos(sorunlar)
    })

    it('yer tutucu kumesi her anahtarda en ile ayni', () => {
        const sorunlar = []
        for (const [k, v] of ortak) {
            const beklenen = placeholders(enMap.get(k))
            const gercek = placeholders(v)
            if (beklenen.join(',') !== gercek.join(',')) {
                sorunlar.push(`${k}: beklenen {${beklenen.join(', ')}} bulunan {${gercek.join(', ')}}`)
            }
        }
        bos(sorunlar)
    })

    it('HTML etiketleri (oznitelikleriyle, adetiyle) en ile ayni', () => {
        const sorunlar = []
        for (const [k, v] of ortak) {
            const beklenen = htmlTags(enMap.get(k))
            const gercek = htmlTags(v)
            if (JSON.stringify(beklenen) !== JSON.stringify(gercek)) {
                sorunlar.push(`${k}: beklenen ${JSON.stringify(beklenen)} bulunan ${JSON.stringify(gercek)}`)
            }
        }
        bos(sorunlar)
    })

    it('cogul: en cogulsa dilin bicim sayisi kadar parca, degilse hic |', () => {
        expect(PLURAL_FORMS[kod], `${kod} icin PLURAL_FORMS tanimli olmali`).toBeGreaterThan(0)
        const sorunlar = []
        for (const [k, v] of ortak) {
            const enCogul = enMap.get(k).includes('|')
            const parca = pluralFormCount(v)
            if (enCogul && parca !== PLURAL_FORMS[kod]) {
                sorunlar.push(`${k}: ${parca} parca, beklenen ${PLURAL_FORMS[kod]}`)
            } else if (!enCogul && v.includes('|')) {
                sorunlar.push(`${k}: en'de | yok ama ceviride var`)
            }
        }
        bos(sorunlar)
    })

    it("@ yalnizca en'de de varsa bulunur", () => {
        const sorunlar = ortak
            .filter(([k, v]) => v.includes('@') && !enMap.get(k).includes('@'))
            .map(([k]) => `${k}: serbest @`)
        bos(sorunlar)
    })

    it('her mesaj vue-i18n derleyicisiyle hatasiz derlenir', () => {
        const hatalar = []
        for (const [k, v] of flat) {
            baseCompile(v, { onError: (e) => hatalar.push(`${k}: ${e.message}`) })
        }
        bos(hatalar)
    })

    it('korunan terimler (Rehber 2.1): en degerinde tam sozcuk olarak gecen terim ceviride de gecer', () => {
        const sorunlar = []
        for (const [k, v] of ortak) {
            const enDeger = enMap.get(k)
            for (const { term, ignoreCase } of PROTECTED_TERMS) {
                if (containsTerm(enDeger, term, { ignoreCase }) && !containsTerm(v, term, { ignoreCase })) {
                    sorunlar.push(`${k}: "${term}" eksik`)
                }
            }
        }
        bos(sorunlar)
    })

    // Latin yazili dillerde (es, pt-BR, vi, id, de, fr, tr) ayirt edici bir yazi sistemi yok:
    // bu test yalniz ru, zh-CN, ja, ko icin kayitlanir.
    const yazi = YAZI_SISTEMI[kod]
    if (yazi) {
        it(`degerlerin en az %${YAZI_ESIGI * 100}'inde dilin yazi sistemi bulunur`, () => {
            const eslesen = flat.filter(([, v]) => yazi.test(v)).length
            const oran = eslesen / flat.length
            const yok = flat.filter(([, v]) => !yazi.test(v)).map(([k]) => k)
            expect(
                oran,
                `${kod}: yazi sistemi orani ${(oran * 100).toFixed(1)}%, olmayanlar: ${yok.slice(0, 15).join(', ')}`,
            ).toBeGreaterThanOrEqual(YAZI_ESIGI)
        })
    }

    it(`en ile birebir ayni degerlerin orani en fazla %${AYNI_DEGER_ESIGI * 100}`, () => {
        const ayni = ortak.filter(([k, v]) => v === enMap.get(k)).map(([k]) => k)
        const oran = ayni.length / enFlat.length
        expect(
            oran,
            `${kod}: en ile ayni oran ${(oran * 100).toFixed(1)}%, ornekler: ${ayni.slice(0, 15).join(', ')}`,
        ).toBeLessThanOrEqual(AYNI_DEGER_ESIGI)
    })
})

// 12 DIL KAPISI: dosyalarin diskte olmasi dilin uygulamada CALISTIGI anlamina gelmez.
// Yukaridaki describe.each yalniz diskteki dosyalari sinar; bir dil dosyasi yazilip
// index.js'e baglanmazsa kullanici o dili secse bile vue-i18n 'en'e duser ve hicbir test
// kirilmazdi. Bu blok katalog (SUPPORTED_LANGS), diskteki dosyalar, Chrome `_locales`
// klasorleri ve calisan i18n ornegini ayni kumeye baglar.
describe('12 dil kapisi', () => {
    const localesDir = join(here, '..', '..', '..', '_locales')
    const klasorler = readdirSync(localesDir).filter((ad) =>
        readdirSync(join(localesDir, ad)).includes('messages.json'),
    )
    const fark = (a, b) => [...a].filter((x) => !b.has(x)).sort()

    let i18n

    beforeAll(async () => {
        // index.js import edilirken applySavedLanguage chrome.storage.local.get'i cagirir;
        // tanimsiz chrome console.warn gurultusu uretirdi.
        globalThis.chrome = { storage: { local: { get: vi.fn(async () => ({})) } } }
        vi.resetModules()
        ;({ default: i18n } = await import('../index.js'))
    })

    afterAll(() => {
        delete globalThis.chrome
        vi.restoreAllMocks()
    })

    it('diskteki dil dosyalari (+ en) SUPPORTED_LANGS kumesine esit', () => {
        const diskte = new Set([...codes, 'en'])
        const katalog = new Set(SUPPORTED_LANGS)
        expect({ katalogdaOlupDosyasiOlmayan: fark(katalog, diskte), dosyasiOlupKatalogdaOlmayan: fark(diskte, katalog) })
            .toEqual({ katalogdaOlupDosyasiOlmayan: [], dosyasiOlupKatalogdaOlmayan: [] })
    })

    it('_locales klasorleri CHROME_LOCALE_DIR degerlerine esit', () => {
        const diskte = new Set(klasorler)
        const katalog = new Set(Object.values(CHROME_LOCALE_DIR))
        expect({ katalogdaOlupKlasoruOlmayan: fark(katalog, diskte), klasoruOlupKatalogdaOlmayan: fark(diskte, katalog) })
            .toEqual({ katalogdaOlupKlasoruOlmayan: [], klasoruOlupKatalogdaOlmayan: [] })
    })

    it.each(SUPPORTED_LANGS)('%s: yaprak sayisi en ile esit', (kod) => {
        const dil = kod === 'en' ? en : read(`${kod}.json`)
        expect(flatten(dil).length).toBe(enFlat.length)
    })

    it('i18n.global.availableLocales SUPPORTED_LANGS ile ayni 12 dil', () => {
        expect([...i18n.global.availableLocales].sort()).toEqual([...SUPPORTED_LANGS].sort())
        expect(i18n.global.availableLocales).toHaveLength(12)
    })

    // Calisma aninda gercekten O dil yukleniyor mu: t() mesaj bulamazsa fallbackLocale 'en'e
    // duser, yani baglanmamis bir dil icin de bir metin doner -- ama o dilin degeri olmaz.
    it.each(SUPPORTED_LANGS)('%s: common.close calisma aninda o dilin degerini verir', (kod) => {
        const dil = kod === 'en' ? en : read(`${kod}.json`)
        const beklenen = dil.common.close
        expect(typeof beklenen).toBe('string')
        expect(i18n.global.t('common.close', {}, { locale: kod })).toBe(beklenen)
    })
})
