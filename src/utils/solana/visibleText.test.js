// visibleText.js -- uc onay ekraninin (SolanaSignTx/SolanaSignMessage/
// SolanaConnectApprove) ve Dapps.vue'nun PAYLASTIGI tek gorunmezlik/homoglif
// isaretleme katmani (C3.2, Task 23/31 deferred). Onceden SolanaSignTx.vue ve
// SolanaSignMessage.vue AYNI mantigi BAGIMSIZ kopyalar halinde tasiyordu --
// biri guncellenip digeri unutulursa yeni bir karakter sinifi TEK ekranda
// kapanirdi.
import { describe, it, expect } from 'vitest'
import { gorunurKil } from './visibleText.js'

describe('visibleText.js -- gorunurKil', () => {
    // Sifir genislikli karakter EKRANDA GORUNMEZ: "Log" + U+200B + "in" ile
    // "Login" ayni goruntuyu verir.
    it('gorunmez kod noktasini kod-noktasi etiketiyle DEGISTIRIR', () => {
        expect(gorunurKil('Log​in')).toBe('Log[U+200B]in')
    })

    // Kiril 'а' (U+0430) Latin 'a'ya GORSEL olarak ozdestir. Homoglif
    // SILINMEZ, yaninda isaretlenir -- kullanici metni yine oldugu gibi okur
    // ama tuzagi gorur.
    it('homoglif karakteri SILMEDEN yaninda isaretler', () => {
        expect(gorunurKil('аpple')).toBe('а[U+0430]pple')
    })

    // Duz ASCII/Latin metinde isaretlenecek hicbir sey yoktur -- asiri
    // isaretleme de KABUL EDILMEZ (K5: yanlis alarm gurultudur).
    it('duz ASCII metin DEGISMEDEN doner', () => {
        expect(gorunurKil('Jupiter')).toBe('Jupiter')
    })

    // Cagiran taraf her zaman string gecirmeyebilir (orn. sayisal/nesne
    // degerler) -- String() donusumu FIRLATMADAN calismali.
    it('string olmayan girdi String() ile donusturulup islenir', () => {
        expect(gorunurKil(42)).toBe('42')
    })
})

// final SU-3: GORUNMEZ sinifi bu kod noktalarini ISARETLEMIYORDU -- hepsi ekranda bosluk gibi
// ya da hic gorunmez, ama imzalanan/gosterilen BAYT farklidir ("Log" + U+3164 + "in" ile "Login"
// ayni goruntuyu verir). Her kod nokta AYRI kosulur (tek bir aralik testinde bir kod noktasi
// dusse fark edilmezdi).
describe('visibleText.js -- gorunurKil, eksik gorunmez kod noktalari (SU-3)', () => {
    const ETIKET = (cp) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
    const GORUNMEZLER = [
        0x034F, // COMBINING GRAPHEME JOINER
        0x061C, // ARABIC LETTER MARK
        0x115F, // HANGUL CHOSEONG FILLER
        0x1160, // HANGUL JUNGSEONG FILLER
        0x17B4, // KHMER VOWEL INHERENT AQ
        0x17B5, // KHMER VOWEL INHERENT AA
        0x180B, // MONGOLIAN FREE VARIATION SELECTOR ONE
        0x180C,
        0x180D,
        0x180E, // MONGOLIAN VOWEL SEPARATOR
        0x180F,
        0x2065, // atanmamis, Default_Ignorable
        0x206A, // INHIBIT SYMMETRIC SWAPPING (kullanimdan kalkmis bicim karakterleri)
        0x206F,
        0x2800, // BRAILLE PATTERN BLANK
        0x3164, // HANGUL FILLER
        0xFE00, // VARIATION SELECTOR-1
        0xFE0D, // VARIATION SELECTOR-14
        0xFFA0, // HALFWIDTH HANGUL FILLER
        0xFFF9, // INTERLINEAR ANNOTATION ANCHOR
        0xFFFA,
        0xFFFB,
        0xE0000, // etiket blogu (Tags) basi
        0xE0001, // LANGUAGE TAG
        0xE0020, // TAG SPACE
        0xE0041, // TAG LATIN CAPITAL LETTER A
        0xE007F, // CANCEL TAG
        0xE0100, // VARIATION SELECTOR-17
        0xE01EF, // VARIATION SELECTOR-256
    ]

    it.each(GORUNMEZLER.map((cp) => [ETIKET(cp), cp]))('%s kod-noktasi etiketiyle ISARETLENIR', (etiket, cp) => {
        expect(gorunurKil('Log' + String.fromCodePoint(cp) + 'in')).toBe('Log[' + etiket + ']in')
    })

    // Daha once de isaretlenenler DEGISMEDI (regresyon): BOM, sifir genislikli bosluk, yon karakteri.
    it.each([0xFEFF, 0x200B, 0x202E, 0x2066, 0x00AD, 0x0000, 0x007F].map((cp) => [ETIKET(cp), cp]))('eski sinif korunur: %s', (etiket, cp) => {
        expect(gorunurKil('a' + String.fromCodePoint(cp) + 'b')).toBe('a[' + etiket + ']b')
    })

    // Emoji sunum secicileri MESRU metinde cok yaygindir; tum emoji'leri gurultuye bogmamak icin
    // YALNIZ bir emoji tabanindan sonra gelen U+FE0F/U+FE0E isaretlenmez. Baska yerde (duz bir
    // harfin ardinda) ayni karakter gorunmez bir ayristiricidir ve ISARETLENIR.
    it('emoji tabanindan sonraki U+FE0F isaretlenmez (mesru emoji metni bozulmaz)', () => {
        expect(gorunurKil('\u2764\uFE0F')).toBe('\u2764\uFE0F')
        expect(gorunurKil('ok \u{1F600}\uFE0F')).toBe('ok \u{1F600}\uFE0F')
        expect(gorunurKil('\u00A9\uFE0E')).toBe('\u00A9\uFE0E')
        // keycap dizisi: rakam + FE0F + U+20E3
        expect(gorunurKil('1\uFE0F\u20E3')).toBe('1\uFE0F\u20E3')
    })

    it('emoji tabani OLMAYAN yerde U+FE0F / U+FE0E isaretlenir', () => {
        expect(gorunurKil('Log\uFE0Fin')).toBe('Log[U+FE0F]in')
        expect(gorunurKil('Log\uFE0Ein')).toBe('Log[U+FE0E]in')
        // metnin basinda tek basina
        expect(gorunurKil('\uFE0Fx')).toBe('[U+FE0F]x')
        // rakam + FE0F ama keycap tamamlayicisi (U+20E3) YOK
        expect(gorunurKil('1\uFE0F2')).toBe('1[U+FE0F]2')
    })

    it('duz ASCII, Latin, CJK ve emoji metni DEGISMEDEN doner (asiri isaretleme yok)', () => {
        const metin = 'Merhaba d\u00FCnya \u4F60\u597D \u3053\u3093\u306B\u3061\u306F \u{1F600} \u{1F44D}\u{1F3FD} \u{1F1F9}\u{1F1F7}'
        expect(gorunurKil(metin)).toBe(metin)
    })
})
