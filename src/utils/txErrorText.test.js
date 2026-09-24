// HAM MAKINE KODU EKRANA CIKMAZ.
//
// CANLI KUSUR (kullanici ekran goruntusu): Takas karti kirmizi satirda
// "TON_QUOTE_FEE_ABOVE_APPROVED" yaziyordu.
//
// KOK NEDEN: TON takasi ORTAK (EVM ile PAYLASILAN) takas yakalayicisina dusuyor
// ve orasi `error.message`i OKUNABILIR BIR CUMLE sayip karta oldugu gibi
// yaziyordu. Oysa TON kolu MAKINE KODU firlatiyor: tonQuoteVerify'in
// TonQuoteVerifyError'u (on alti kod) ve tonSwap'in TON_SWAP_* kodlari.
// Ikisi de TON_SEND_ERRORS tablosunda DEGIL -- yani "tanidigim kodu cevir,
// tanimadigim metni oldugu gibi bas" kurali tam da burada yaniliyordu.
//
// BU DOSYA SON KAPIYI olcer: kullaniciya gosterilecek metni ureten katman, bir
// KOD'a benzeyen hicbir seyi ham basmamali -- hangi uretici yazmis olursa olsun.
// Kaynak tarafindaki duzeltme ayrica kilitli (asagidaki 'ortak yakalayici' blogu).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { looksLikeErrorCode, txErrorText } from './txErrors'

const BACKGROUND = readFileSync(fileURLToPath(new URL('../background.js', import.meta.url)), 'utf8')
const TX_STATUS = readFileSync(fileURLToPath(new URL('../components/TransactionStatus.vue', import.meta.url)), 'utf8')

// Gercek ceviri yerine ANAHTARI dondururuz: bu dosyanin olctugu sey metnin
// KENDISI degil, HANGI kaynaktan geldigi.
const t = (key) => `[${key}]`

const tx = (meta, status = 'error') => ({ status, meta })

describe('makine kodu tespiti', () => {
    it.each([
        'TON_QUOTE_FEE_ABOVE_APPROVED',
        'TON_SWAP_QUOTE_STALE',
        'CALL_EXCEPTION',
        'TON_VAULT_NOT_FOUND',
    ])('%s bir KODdur', (code) => {
        expect(looksLikeErrorCode(code)).toBe(true)
    })

    it.each([
        'Transaction failed on-chain',
        'execution reverted: TRANSFER_FROM_FAILED',
        'İşlem zincirde başarısız oldu.',
        'insufficient funds for intrinsic transaction cost',
        '',
        null,
        undefined,
        42,
    ])('%s bir kod DEGILDIR', (text) => {
        expect(looksLikeErrorCode(text)).toBe(false)
    })
})

describe('kart metni -- ham kod SIZMAZ', () => {
    it('CANLI KUSUR: ham quote-dogrulama kodu ekrana basilmaz', () => {
        const out = txErrorText(tx({ error: 'TON_QUOTE_FEE_ABOVE_APPROVED' }), t)
        expect(out).not.toContain('TON_QUOTE_FEE_ABOVE_APPROVED')
    })

    // Yalnizca "gizlemek" yetmez: kullanici BIR SEY gormeli. Bos bir kirmizi
    // satir, ham koddan daha kotudur.
    it('gizlenen kodun yerine ANLASILIR bir metin gecer', () => {
        expect(txErrorText(tx({ error: 'TON_QUOTE_FEE_ABOVE_APPROVED' }), t))
            .toBe('[transactionStatus.errors.generic]')
    })

    // Kod TANINIYORSA cevrilir - gizlenip jenerige dusmez. `error` alanina
    // dusmus olmasi (errorCode yerine) sebebi kaybettirmemeli.
    it('taninan bir kod `error` alanina dusmusse yine de CEVRILIR', () => {
        expect(txErrorText(tx({ error: 'TON_VAULT_NOT_FOUND' }), t))
            .toBe('[send.tonErrors.vaultNotFound]')
    })

    it('cevrilemeyen HAM CUMLE oldugu gibi kalir -- teshis kaybolmaz', () => {
        const raw = 'execution reverted: TRANSFER_FROM_FAILED'
        expect(txErrorText(tx({ error: raw }), t)).toBe(raw)
    })

    it('errorCode varsa o kazanir', () => {
        expect(txErrorText(tx({ errorCode: 'ONCHAIN_FAILED', error: 'yoksayilir' }), t))
            .toBe('[transactionStatus.errors.onchainFailed]')
    })

    it('hicbir sey yoksa ama islem DUSTUYSE jenerik metin basilir', () => {
        expect(txErrorText(tx({}), t)).toBe('[transactionStatus.errors.generic]')
    })

    it('islem dusmediyse satir HIC cizilmez', () => {
        expect(txErrorText(tx({}, 'processing'), t)).toBe('')
    })
})

describe('ortak yakalayici -- kaynak tarafindaki duzeltme', () => {
    // Kodun on altisini tek tek tabloya yazmak yerine SINIFI taniyoruz:
    // TonQuoteVerifyError'un HER kodu ayni seyi anlatiyor (sunucunun kurdugu
    // govde niyetten sapti) ve zaten tek bir i18n karsiligi var.
    it('TonQuoteVerifyError ortak yakalayicida SINIFIYLA taniniyor', () => {
        expect(BACKGROUND).toContain("const txErrorFromException = ")
        const govde = BACKGROUND.slice(
            BACKGROUND.indexOf('const txErrorFromException = '),
            BACKGROUND.indexOf('\n}', BACKGROUND.indexOf('const txErrorFromException = ')),
        )
        expect(govde, 'quote-dogrulama hatasi taninmiyor').toContain('TonQuoteVerifyError')
    })

    it('kart metni saf katmandan geliyor (bilesen kendi kuralini kurmuyor)', () => {
        expect(TX_STATUS).toContain('txErrorText(tx, t)')
    })
})
