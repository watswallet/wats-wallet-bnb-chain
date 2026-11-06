// "Uygulamayi sifirla" onay kelimesi: HER DILDE o dilin kendi kelimesi (kullanici karari
// 2026-11-03), karsilastirma yazilis biciminden bagimsiz, girdi siniri kelimeyi kesmez.
// Kelimeler diskteki GERCEK dil dosyalarindan okunur: yeni dil eklenince otomatik kosulur.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SUPPORTED_LANGS } from '../i18n/languages'
import { foldResetKeyword, isResetConfirmed, resetInputLimit, RESET_INPUT_MIN_LIMIT } from './resetConfirm'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'i18n', 'locales')
const codes = readdirSync(localesDir)
    .filter((ad) => ad.endsWith('.json'))
    .map((ad) => ad.slice(0, -'.json'.length))
    .sort()
const kelime = (kod) => JSON.parse(readFileSync(join(localesDir, kod + '.json'), 'utf8')).settings.security.resetApp.confirm_keyword

const EN = kelime('en')

describe('onay kelimesi: her dilde o dilin kendi kelimesi', () => {
    it('12 dil de taranir', () => {
        expect(codes).toEqual([...SUPPORTED_LANGS].sort())
        expect(codes).toHaveLength(12)
    })

    it.each(codes.filter((k) => k !== 'en'))('%s: kelime Ingilizce "RESET" degil, bos degil, kenarlarda bosluk yok', (kod) => {
        const w = kelime(kod)
        expect(w).not.toBe(EN)
        expect(w.trim()).toBe(w)
        expect(w.length).toBeGreaterThan(1)
    })

    it('ja / ko / vi / id kelimeleri Latin "RESET"ten cevrildi (kullanici karari)', () => {
        expect(kelime('ja')).toBe('リセット')
        expect(kelime('ko')).toBe('초기화')
        expect(kelime('vi')).toBe('ĐẶT LẠI')
        expect(kelime('id')).toBe('ATUR ULANG')
    })

    it.each(codes)('%s: kelime kendi basina NFC bicimindedir (ekrandakiyle birebir ayni yazilir)', (kod) => {
        const w = kelime(kod)
        expect(w.normalize('NFC')).toBe(w)
    })
})

describe.each(codes)('%s: onay kelimesi kabulu', (kod) => {
    const w = kelime(kod)

    it('kelimenin kendisi', () => {
        expect(isResetConfirmed(w, w)).toBe(true)
    })

    it('kucuk harf (genel ve Turkce kurala gore)', () => {
        expect(isResetConfirmed(w.toLowerCase(), w)).toBe(true)
        expect(isResetConfirmed(w.toLocaleLowerCase('tr'), w)).toBe(true)
        expect(isResetConfirmed(w.toLocaleLowerCase(kod), w)).toBe(true)
    })

    it('aksansiz yazim (ABD klavyesi)', () => {
        const aksansiz = w.normalize('NFD').replace(/\p{M}/gu, '').replace(/Đ/g, 'D')
        expect(isResetConfirmed(aksansiz, w)).toBe(true)
        expect(isResetConfirmed(aksansiz.toLowerCase(), w)).toBe(true)
    })

    it('NFD (ayrik aksan / ayrik Hangul) girdi', () => {
        expect(isResetConfirmed(w.normalize('NFD'), w)).toBe(true)
        expect(isResetConfirmed(w.toLowerCase().normalize('NFD'), w)).toBe(true)
    })

    it('basta ve sonda bosluk (NBSP, ideografik bosluk, satir sonu dahil)', () => {
        expect(isResetConfirmed('  ' + w + '  ', w)).toBe(true)
        expect(isResetConfirmed(' ' + w + ' ', w)).toBe(true)
        expect(isResetConfirmed('　' + w + '\n', w)).toBe(true)
        expect(isResetConfirmed('\t' + w + ' ', w)).toBe(true)
    })

    it('gorunmez bicim karakteri (sifir genislikli bosluk) yapistirmayla gelirse', () => {
        expect(isResetConfirmed('​' + w + '‎', w)).toBe(true)
    })

    it('yanlis girdiler reddedilir: bos, bosluk, on ek, fazlalik, baska kelime, baska dilin kelimesi', () => {
        expect(isResetConfirmed('', w)).toBe(false)
        expect(isResetConfirmed('   ', w)).toBe(false)
        expect(isResetConfirmed(w.slice(0, -1), w)).toBe(false)
        expect(isResetConfirmed(w + 'X', w)).toBe(false)
        expect(isResetConfirmed('X' + w, w)).toBe(false)
        expect(isResetConfirmed('DELETE', w)).toBe(false)
        expect(isResetConfirmed(undefined, w)).toBe(false)
        expect(isResetConfirmed(null, w)).toBe(false)
        for (const baska of codes) {
            if (foldResetKeyword(kelime(baska)) === foldResetKeyword(w)) continue
            expect(isResetConfirmed(kelime(baska), w), baska + ' kelimesi ' + kod + ' icin kabul edilmemeli').toBe(false)
        }
    })

    it('girdi siniri kelimenin hicbir yazilis bicimini kesmez (NFC, NFD, bosluklu)', () => {
        const sinir = resetInputLimit(w)
        expect(sinir).toBeGreaterThanOrEqual(RESET_INPUT_MIN_LIMIT)
        expect(w.length).toBeLessThanOrEqual(sinir)
        expect(w.normalize('NFD').length).toBeLessThanOrEqual(sinir)
        expect((' ' + w.normalize('NFD') + ' ').length).toBeLessThanOrEqual(sinir)
    })
})

describe('onay kelimesi: bicimden bagimsiz ama kelimeye bagli', () => {
    it('kelime bos / eksik ceviri ise HICBIR girdi onay sayilmaz', () => {
        for (const bos of ['', '   ', undefined, null]) {
            expect(isResetConfirmed('', bos)).toBe(false)
            expect(isResetConfirmed('RESET', bos)).toBe(false)
            expect(isResetConfirmed(bos, bos)).toBe(false)
        }
    })

    it('tr: "SIFIRLA" icin ASCII "sifirla", dotless "sıfırla", Shift+i ile "SİFİRLA" ve "sifirla" hepsi kabul', () => {
        const w = kelime('tr')
        expect(w).toBe('SIFIRLA')
        for (const girdi of ['sifirla', 'sıfırla', 'SİFİRLA', 'SIFIRLA', 'Sifirla', 'sİfİrla', 'SIFIRLA ']) {
            expect(isResetConfirmed(girdi, w), girdi).toBe(true)
        }
        expect(isResetConfirmed('SIFIRLAR', w)).toBe(false)
    })

    it('vi: "ĐẶT LẠI" icin "dat lai", "đặt lại", cift bosluk ve NFD kabul; bosluksuz "ĐẶTLẠI" degil', () => {
        const w = kelime('vi')
        for (const girdi of ['dat lai', 'đặt lại', 'ĐẶT  LẠI', 'ĐẶT LẠI'.normalize('NFD'), 'Đặt Lại', 'ĐẶT LẠI']) {
            expect(isResetConfirmed(girdi, w), girdi).toBe(true)
        }
        expect(isResetConfirmed('ĐẶTLẠI', w)).toBe(false)
    })

    it('id: "ATUR ULANG" icin kucuk harf ve bosluklu girdi kabul; "RESET" kabul degil', () => {
        const w = kelime('id')
        expect(isResetConfirmed('atur ulang', w)).toBe(true)
        expect(isResetConfirmed(' Atur  Ulang ', w)).toBe(true)
        expect(isResetConfirmed('RESET', w)).toBe(false)
        expect(isResetConfirmed('aturulang', w)).toBe(false)
    })

    it('ja: tam genislik/yari genislik girdi (IME) kabul', () => {
        expect(isResetConfirmed('ﾘｾｯﾄ', kelime('ja'))).toBe(true)
        expect(isResetConfirmed('RESET', kelime('ja'))).toBe(false)
    })

    it('en: tam genislik Latin kabul', () => {
        expect(isResetConfirmed('ＲＥＳＥＴ', 'RESET')).toBe(true)
        expect(isResetConfirmed('ｒｅｓｅｔ', 'RESET')).toBe(true)
    })

    it('ko: ayrik jamo (NFD) ve birlesik hece ayni sayilir', () => {
        const w = kelime('ko')
        expect(isResetConfirmed('초기화'.normalize('NFD'), w)).toBe(true)
        expect(isResetConfirmed('초기', w)).toBe(false)
    })

    it('es / fr: eski sabit sinirin (10) kestigi uzun kelimeler artik tam yazilabilir', () => {
        for (const kod of ['es', 'fr']) {
            const w = kelime(kod)
            expect(w.length).toBeGreaterThan(10)
            expect(resetInputLimit(w)).toBeGreaterThanOrEqual(w.length)
            expect(isResetConfirmed(w, w)).toBe(true)
        }
        expect(kelime('es')).toBe('RESTABLECER')
        expect(kelime('fr')).toBe('RÉINITIALISER')
        expect(isResetConfirmed('reinitialiser', kelime('fr'))).toBe(true)
        expect(isResetConfirmed('restablecer', kelime('es'))).toBe(true)
    })
})

describe('foldResetKeyword', () => {
    it('metin olmayan girdi bos doner', () => {
        expect(foldResetKeyword(undefined)).toBe('')
        expect(foldResetKeyword(null)).toBe('')
    })

    it('girdiyi degistirmez ve kararlidir (idempotent)', () => {
        for (const k of codes) {
            const bir = foldResetKeyword(kelime(k))
            expect(foldResetKeyword(bir)).toBe(bir)
        }
    })
})

describe('resetInputLimit', () => {
    it('kisa kelimede alt taban, uzun kelimede kelimeye gore buyur', () => {
        expect(resetInputLimit('RESET')).toBe(RESET_INPUT_MIN_LIMIT)
        expect(resetInputLimit('A'.repeat(40))).toBe(80)
        expect(resetInputLimit(undefined)).toBe(RESET_INPUT_MIN_LIMIT)
    })
})
