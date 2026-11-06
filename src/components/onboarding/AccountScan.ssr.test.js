// AccountScan.vue GERCEKTEN render edilerek olculur (bkz. src/test-utils/ssrRender.js).
//
// Bilesen sunumsaldir: tarama mantigini ve durumu bilmez, gelen props'u cizer. Uc ekran durumu:
//   scanning -> baslik, aciklama, TEK genel donen gosterge, satirlar, "kontrol ediliyor" satiri, Atla
//   saving   -> scanning ile ayni duzen; kontrol satiri ve Atla YOK (Atla bu asamada hicbir seyi durduramaz)
//   result   -> sayi basligi, not (satirlarin USTUNDE), satirlar (ilkinde Aktif rozeti), dugme; donen gosterge YOK
//
// 'vue' mock'u GEREKMEZ: bilesen onMounted kullanmaz (ssrRender.js KULLANIM notu yalniz onMounted
// kullanan bilesenler icindir).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ssrRender, createTestI18n } from '../../test-utils/ssrRender.js'
import en from '../../i18n/locales/en.json'
import tr from '../../i18n/locales/tr.json'
import AccountScan from './AccountScan.vue'

// SSR metni HTML-kacisli basar ("We're" -> "We&#39;re"); ham ceviriyle karsilastirma
// metin DOGRU basilsa bile kalirdi (ImportPrivate.tonKey.ssr.test.js ile ayni yardimci).
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const T = en.onboarding.accountScan
const TR = tr.onboarding.accountScan
const SRC = readFileSync(fileURLToPath(new URL('./AccountScan.vue', import.meta.url)), 'utf8')

const ROWS = [
    { index: 0, name: 'Wats 1', address: '0x1111111111111111111111111111111111111111', used: true },
    { index: 1, name: 'Wats 2', address: '0x2222222222222222222222222222222222222222', used: true },
]
const CHECKING = { index: 2, name: 'Wats 3', address: '0x3333333333333333333333333333333333333333' }

const html = (props, locale = 'en') => ssrRender(AccountScan, {
    props: { rows: ROWS, checking: null, firstName: 'Wats 1', afterWrite: true, ...props },
    global: { plugins: [createTestI18n(locale)] },
})

// Satirlar <li> ogeleridir (bilesenin satir listesi). Her parca bir satirin acilisindan sonrasidir.
const rowChunks = (h) => h.split('<li').slice(1)

describe('AccountScan: tarama ekrani', () => {
    it('scanning: satirlar, kontrol satiri ve Atla baglantisi gorunur', async () => {
        const h = await html({ phase: 'scanning', checking: { index: 2, name: 'Wats 3', address: '0x3333333333333333333333333333333333333333' } })
        expect(h).toContain(esc(T.title_scanning)); expect(h).toContain('Wats 2'); expect(h).toContain('0x2222...2222')
        expect(h).toContain('Wats 3'); expect(h).toContain(esc(T.checking))
        expect(h).toContain(esc(T.btn_skip.replace('{name}', 'Wats 1')))
        expect(h).not.toContain(esc(T.btn_go_wallet)); expect(h).not.toContain(esc(T.btn_continue)); expect(h).not.toContain(esc(T.note_added))
    })

    it('scanning: TEK genel dondurucu var, basligin altinda ve satirlarin ustunde (taslak yerlesimi); kontrol satirinin kendi dondurucusu yok', async () => {
        const h = await html({ phase: 'scanning', checking: CHECKING })
        expect(h.split('animate-spin')).toHaveLength(2)                         // tam bir tane
        expect(h.indexOf(esc(T.title_scanning))).toBeLessThan(h.indexOf('animate-spin'))
        expect(h.indexOf('animate-spin')).toBeLessThan(h.indexOf('Wats 1'))
    })

    it('saving: Atla baglantisi ve kontrol satiri YOK, satirlar ve genel dondurucu durur', async () => {
        const h = await html({ phase: 'saving', checking: { index: 2, name: 'Wats 3', address: '0x3333333333333333333333333333333333333333' } })
        expect(h).toContain('Wats 2'); expect(h).not.toContain(esc(T.checking)); expect(h).not.toContain(esc(T.btn_skip.replace('{name}', 'Wats 1')))
        expect(h.split('animate-spin')).toHaveLength(2)
    })

    // Ek (brief disi): yerlesim sirasi, rozetin yalniz sonucta olmasi, kontrol satirinin yalniz checking varken cikmasi.
    it('scanning: sira baslik, aciklama, dondurucu, satirlar, kontrol satiri, Atla; Aktif rozeti sonuca ozel', async () => {
        const h = await html({ phase: 'scanning', checking: CHECKING })
        const sira = [
            h.indexOf(esc(T.title_scanning)), h.indexOf(esc(T.desc_scanning)), h.indexOf('animate-spin'),
            h.indexOf('Wats 1'), h.indexOf('Wats 2'), h.indexOf('Wats 3'),
            h.indexOf(esc(T.checking)), h.indexOf(esc(T.btn_skip.replace('{name}', 'Wats 1'))),
        ]
        expect(sira.every((i) => i > -1)).toBe(true)
        expect([...sira].sort((a, b) => a - b)).toEqual(sira)
        expect(h).not.toContain(esc(T.badge_active))
    })

    it('scanning: checking null ise kontrol satiri cikmaz, Atla yine gorunur', async () => {
        const h = await html({ phase: 'scanning', checking: null })
        expect(h).not.toContain(esc(T.checking))
        expect(h).toContain(esc(T.btn_skip.replace('{name}', 'Wats 1')))
    })

    it('scanning: onay isareti yalniz kullanilmis satirlarda; aradaki bos hesapta isaret yok', async () => {
        const rows = [
            ROWS[0],
            { index: 1, name: 'Wats 2', address: '0x2222222222222222222222222222222222222222', used: false },
            { index: 2, name: 'Wats 3', address: '0x3333333333333333333333333333333333333333', used: true },
        ]
        const parcalar = rowChunks(await html({ phase: 'scanning', rows, checking: null }))
        expect(parcalar).toHaveLength(3)
        expect(parcalar.map((p) => p.includes('<svg'))).toEqual([true, false, true])
    })
})

describe('AccountScan: sonuc ekrani', () => {
    it('result + afterWrite: sayi basligi, Aktif rozeti yalniz ilk satirda, note_added, Cuzdana git', async () => {
        const h = await html({ phase: 'result' })
        expect(h).toContain(esc(T.title_found.replace('{count}', '2'))); expect(h.split(esc(T.badge_active))).toHaveLength(2)
        expect(h).toContain(esc(T.note_added)); expect(h).toContain(esc(T.btn_go_wallet)); expect(h).not.toContain(esc(T.btn_skip.replace('{name}', 'Wats 1')))
        expect(h).not.toContain('animate-spin')                                   // sonucta dondurucu yok
        expect(h.indexOf(esc(T.note_added))).toBeLessThan(h.indexOf('Wats 1'))    // taslakta not satirlarin ustunde
    })

    it('result + afterWrite=false: note_will_add ve Devam et', async () => {
        const h = await html({ phase: 'result', afterWrite: false })
        expect(h).toContain(esc(T.note_will_add)); expect(h).toContain(esc(T.btn_continue)); expect(h).not.toContain(esc(T.btn_go_wallet))
    })

    // Ek (brief disi): rozet ilk satirin icinde, baslik notun ustunde, dugme en altta; kontrol satiri sonucta cizilmez.
    it('result: sira baslik, not, satirlar, dugme; rozet ilk satirda; kontrol satiri cizilmez', async () => {
        const h = await html({ phase: 'result', checking: CHECKING })
        const sira = [
            h.indexOf(esc(T.title_found.replace('{count}', '2'))), h.indexOf(esc(T.note_added)),
            h.indexOf('Wats 1'), h.indexOf('Wats 2'), h.indexOf(esc(T.btn_go_wallet)),
        ]
        expect(sira.every((i) => i > -1)).toBe(true)
        expect([...sira].sort((a, b) => a - b)).toEqual(sira)
        const parcalar = rowChunks(h)
        expect(parcalar).toHaveLength(2)                                            // checking verilse de ucuncu satir yok
        expect(parcalar[0]).toContain(esc(T.badge_active)); expect(parcalar[1]).not.toContain(esc(T.badge_active))
        expect(h).not.toContain('Wats 3'); expect(h).not.toContain(esc(T.checking))
    })

    it('result: sayi basligi satir sayisindan gelir (aradaki bos hesaplar dahil)', async () => {
        const rows = [
            ROWS[0],
            { index: 1, name: 'Wats 2', address: '0x2222222222222222222222222222222222222222', used: false },
            { index: 2, name: 'Wats 3', address: '0x3333333333333333333333333333333333333333', used: true },
        ]
        const h = await html({ phase: 'result', rows })
        expect(h).toContain(esc(T.title_found.replace('{count}', '3')))
    })
})

describe('AccountScan: Turkce ve baglantilar', () => {
    // Ek (brief disi): en testleri tr metnindeki yer tutucu adlarini ({name}, {count}) dogrulamaz.
    it('tr: {count} ve {name} yer tutucularinin ikisi de dolar', async () => {
        const sonuc = await html({ phase: 'result' }, 'tr')
        expect(sonuc).toContain(esc(TR.title_found.replace('{count}', '2')))
        expect(sonuc).toContain(esc(TR.note_added)); expect(sonuc).toContain(esc(TR.btn_go_wallet)); expect(sonuc).toContain(esc(TR.badge_active))
        const tarama = await html({ phase: 'scanning', checking: CHECKING }, 'tr')
        expect(tarama).toContain(esc(TR.btn_skip.replace('{name}', 'Wats 1'))); expect(tarama).toContain(esc(TR.checking))
        for (const cikti of [sonuc, tarama]) expect(cikti).not.toMatch(/\{(count|name)\}/)
    })

    // Her isleyici KENDI dugmesinin etiketine baglanir: desen @click'ten o dugmenin </button>'ina kadar
    // gider (baska dugmenin etiketine tasamaz). Iki deseni ayri ayri aramak emit('skip') <-> emit('continue')
    // TAKASINI yakalamazdi (iki desen de eslesirdi); takasta Atla etkisiz kalir, sonuc dugmesi de etkisiz
    // kalir ve sonuc ekrani cikissiz kalirdi.
    it('dugmeler dogru olaya baglidir: Atla -> skip, sonuc dugmesi -> continue (kaynak taramasi)', () => {
        expect(SRC).toMatch(/@click="emit\('skip'\)"[^>]*>(?:(?!<\/button>)[\s\S])*?\$t\('onboarding\.accountScan\.btn_skip'/)
        expect(SRC).toMatch(/@click="emit\('continue'\)"[^>]*>(?:(?!<\/button>)[\s\S])*?\{\{\s*primaryLabel\s*\}\}/)
    })

    // Takas mutanti: iki olay adi yer degistirirse desenler artik eslesmemeli (kaynak metni bellekte degistirilir).
    it('takas mutanti: emit(skip) ile emit(continue) yer degistirirse desenler dusur', () => {
        const takas = SRC.replace(/emit\('skip'\)/g, "emit('__T__')").replace(/emit\('continue'\)/g, "emit('skip')").replace(/emit\('__T__'\)/g, "emit('continue')")
        expect(takas).not.toBe(SRC)
        expect(takas).not.toMatch(/@click="emit\('skip'\)"[^>]*>(?:(?!<\/button>)[\s\S])*?\$t\('onboarding\.accountScan\.btn_skip'/)
        expect(takas).not.toMatch(/@click="emit\('continue'\)"[^>]*>(?:(?!<\/button>)[\s\S])*?\{\{\s*primaryLabel\s*\}\}/)
    })
})
