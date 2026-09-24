// Islem karti hata eslemesinin TAMLIGI -- kaynak uzerinden kilitlenir.
//
// KOK NEDEN: background.js karta ham INGILIZCE cumleler yaziyordu ve
// TransactionStatus.vue onlari oldugu gibi basiyordu; Turkce arayuzde basarisiz
// isleminin sebebi ingilizce okunuyordu. Metinler artik KOD'a cevrildi, ceviri
// ekranda yapiliyor.
//
// YENI RISK, bu testin kapattigi risk: ileride background.js'e eklenen bir kod
// TX_ERRORS'a yazilmayi UNUTULABILIR. resolveTxError jenerik anahtara dustugu icin
// ekran COKMEZ, kirilma SESSIZ olur -- kullanici sebebi belli bir hatanin yerine
// "Islem tamamlanamadi." gorur ve kimse fark etmez. Bu dosya kaynaktaki HER
// `txErrorMeta('KOD'` cagrisini toplar ve tablosunda ACIKCA karsiligi oldugunu
// dogrular. (solana/sendErrors.test.js ile AYNI desen.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { TX_ERRORS, resolveTxError } from './txErrors'
import { isKnownTonSendError } from './ton/tonSendErrors'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, rel), 'utf8')

const BACKGROUND = read('../background.js')
const TR = JSON.parse(read('../i18n/locales/tr.json'))
const EN = JSON.parse(read('../i18n/locales/en.json'))
const TX_STATUS = read('../components/TransactionStatus.vue')

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

// Yalnizca TIRNAK ICINDE, BUYUK_HARF+ALT_CIZGI bir ilk arguman yakalanir:
// `txErrorMeta(errorCode, ...)` gibi degisken gecilen cagri BILEREK disarida kalir
// (onun kodlari ayri bir dalda uretilir, asagida elle dogrulanir).
//
// IKI URETICI de taranir: `txErrorFromException` ortak (swap/bridge) yakalayicilarin
// kullandigi sarmalayicidir ve KENDI yedek kodunu yazar -- yalnizca `txErrorMeta`
// aranirsa o yedekler taramanin DISINDA kalir ve eslemesiz kalabilirlerdi.
function collectEmittedCodes(source) {
    const codes = new Set()
    const re = /(?:txErrorMeta|txErrorFromException)\('([A-Z_]+)'/g
    let m
    while ((m = re.exec(source))) codes.add(m[1])
    return codes
}

describe('islem karti hata eslemesi TAM', () => {
    it("background.js'in yazdigi HER kod TABLO da ACIKCA var", () => {
        const emitted = collectEmittedCodes(BACKGROUND)

        // Emniyet kemeri: regex kirilirsa dongu SESSIZCE 0 kodla "gecer". Bugun
        // sabit kodla yazilan dokuz cagri yeri var; sayinin altina dusmek desenin
        // kendisinin bozuldugunu soyler.
        expect(emitted.size).toBeGreaterThanOrEqual(9)

        for (const code of emitted) {
            // Kod IKI tablodan birinde ACIKCA bulunmali. TON tablosu da gecerli bir
            // ev: resolveTxError oraya devrediyor ve ayni kodlar gonderim
            // ekranlarinda da oradan cozuluyor -- tek kaynak korunuyor.
            const eslendi = Object.prototype.hasOwnProperty.call(TX_ERRORS, code) || isKnownTonSendError(code)
            expect(eslendi, `${code} hicbir tabloda yok`).toBe(true)
        }
    })

    // Degiskenle gecilen dal (duz EVM gonderiminin catch'i) yukaridaki regex'in
    // disinda kalir; oradaki dort kod BURADA elle kilitlenir.
    it('degiskenle atanan kodlar da TABLO da', () => {
        for (const code of ['INSUFFICIENT_NATIVE', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_TOKEN_BALANCE', 'INVALID_PARAMETER']) {
            expect(BACKGROUND, `background.js: ${code} artik uretilmiyor`).toContain(`errorCode = '${code}'`)
            expect(Object.prototype.hasOwnProperty.call(TX_ERRORS, code), code).toBe(true)
        }
    })

    it('TABLO daki ve jenerik yedekteki HER anahtar tr+en de tanimli', () => {
        const keys = new Set([...Object.values(TX_ERRORS), resolveTxError(null)])
        for (const key of keys) {
            expect(get(TR, key), `tr: ${key} yok`).toBeTruthy()
            expect(get(EN, key), `en: ${key} yok`).toBeTruthy()
        }
    })

    it('bilinmeyen/bos kod JENERIK anahtara duser -- ekrana ham kod CIKMAZ', () => {
        for (const bogus of ['YOK_BOYLE_BIR_KOD', '', null, undefined, 42, {}]) {
            expect(resolveTxError(bogus)).toBe('transactionStatus.errors.generic')
        }
    })

    // `{detail}` interpolasyonu YALNIZCA bu anahtarda var ve ham teshis metni
    // (ethers `shortMessage` + `argument`) oraya girer. Yer tutucu iki dilden
    // birinde dusurulurse kullanici HANGI argumanin gecersiz oldugunu bir daha
    // ogrenemez -- cagri yerinin bas yorumu tam da bu kaybi anlatiyor.
    it('invalidParameter {detail} yer tutucusunu IKI dilde de tasir', () => {
        expect(get(TR, TX_ERRORS.INVALID_PARAMETER)).toContain('{detail}')
        expect(get(EN, TX_ERRORS.INVALID_PARAMETER)).toContain('{detail}')
    })

    // Metin uretimi 2026-09-16'da saf katmana tasindi (txErrorText): kart artik
    // KENDI kuralini kurmuyor, yalnizca cagiriyor. Kuralin kendisi -- kodun
    // cevrilmesi, ham cumlenin korunmasi, KOD'a benzeyen metnin ekrana
    // BASILMAMASI -- txErrorText.test.js'te olculuyor.
    it('kart metni saf katmandan geliyor, bilesen kendi kuralini KURMUYOR', () => {
        expect(TX_STATUS).toContain('txErrorText(tx, t)')
    })
})
