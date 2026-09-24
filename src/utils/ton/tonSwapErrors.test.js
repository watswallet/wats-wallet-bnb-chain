// TON takas hata eslemesinin TAMLIGI -- kaynak uzerinden kilitlenir.
//
// KOK NEDEN: takas kodlari ORTAK (EVM ile PAYLASILAN) yakalayiciya dusuyor ve
// orasi `error.message`i okunabilir bir cumle saniyordu; kartta ham
// "TON_SWAP_QUOTE_STALE" gorunuyordu. Son kapi (txErrors.js) artik KOD'a benzeyen
// hicbir seyi ham basmiyor -- ama o kapi TEK BASINA sebebi de gizler. Bu tablo
// sebebi geri veriyor, bu dosya da tablonun eksik kalmamasini sagliyor.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TON_SWAP_ERRORS, isKnownTonSwapError } from './tonSwapErrors'
import { resolveTxError } from '../txErrors'

const TON_DIR = fileURLToPath(new URL('.', import.meta.url))
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const TR = JSON.parse(read('../../i18n/locales/tr.json'))
const EN = JSON.parse(read('../../i18n/locales/en.json'))
const BACKGROUND = read('../../background.js')

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)

// IKI firlatma bicimi de taranir: duz `throw new Error('KOD')` (tonSwap.js,
// tonSwapQuote.js) ve `dur('KOD')` (tonSwapRelayAction.js'in TonSwapRelayError
// kisayolu). Yalnizca birini aramak, oteki ailenin SESSIZCE eslemesiz kalmasina
// izin verirdi.
function collectSwapCodes() {
    const codes = new Set()
    for (const file of readdirSync(TON_DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))) {
        const src = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8')
        for (const m of src.matchAll(/throw new Error\('(TON_SWAP_[A-Z0-9_]+)'\)/g)) codes.add(m[1])
        for (const m of src.matchAll(/dur\('(TON_SWAP_[A-Z0-9_]+)'\)/g)) codes.add(m[1])
    }
    return [...codes]
}

const firlatilanlar = collectSwapCodes()

describe('TON takas hata eslemesi TAM', () => {
    // Emniyet kemeri: regex kirilirsa dongu SESSIZCE 0 kodla "gecer", yani
    // olmayan bir korumayi dogrulamis oluruz.
    it('tarama gercekten kod buluyor', () => {
        expect(firlatilanlar.length).toBeGreaterThanOrEqual(15)
        expect(firlatilanlar).toContain('TON_SWAP_QUOTE_STALE')
        expect(firlatilanlar).toContain('TON_SWAP_RELAY_NO_BODY')
    })

    it.each(firlatilanlar)('%s icin ACIKCA bir karsilik var', (code) => {
        expect(isKnownTonSwapError(code), `${code} tabloda yok`).toBe(true)
    })

    it('HER anahtar tr+en de tanimli', () => {
        for (const key of new Set(Object.values(TON_SWAP_ERRORS))) {
            expect(get(TR, key), `tr: ${key} yok`).toBeTruthy()
            expect(get(EN, key), `en: ${key} yok`).toBeTruthy()
        }
    })

    // Kart cozumleyicisi bu tabloya DEVREDIYOR. Baglanti kopsa tablo dolu kalir
    // ama kullanici yine jenerik metin gorurdu -- sessiz bir kirilma.
    it.each(firlatilanlar)('%s kart cozumleyicisinden JENERIGE dusmuyor', (code) => {
        expect(resolveTxError(code)).not.toBe('transactionStatus.errors.generic')
    })

    it('bilinmeyen kod tabloda YOK sayilir', () => {
        for (const bogus of ['TON_SWAP_YOK', '', null, undefined, 42]) {
            expect(isKnownTonSwapError(bogus)).toBe(false)
        }
    })
})

describe('ortak yakalayici takas kodlarini taniyor', () => {
    it('background.js takas tablosunu sorguluyor', () => {
        expect(BACKGROUND).toContain('isKnownTonSwapError(raw)')
    })

    // TonQuoteVerifyError SINIFLA taninmak ZORUNDA: `message`i "KOD: detay"
    // olabiliyor ve tablo aramasi tutmaz. TonSwapRelayError'da `message` kodun
    // KENDISI, o yuzden tablo aramasi yeterli -- ayrim bilincli.
    it('quote-dogrulama hatasi SINIFLA taniniyor', () => {
        expect(BACKGROUND).toContain("error?.name === 'TonQuoteVerifyError'")
    })
})
