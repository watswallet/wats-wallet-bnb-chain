import { describe, it, expect } from 'vitest'
import { resolveAtsBlocker } from '../atsBlocker'
import { resolveTonFeeBlocker, settlementDispositionFor, TON_FEE_I18N_KEYS } from './tonFeeBlocker'

describe('sunucunun ucret kodlari', () => {
    it.each([
        ['ton-stale-rate', 503, 'operator', 'retry-later'],
        ['ton-tank-low', 503, 'operator', 'retry-later'],
        ['ton-estimate-failed', 503, 'transient', 'retry-later'],
        ['ton-cost-over-cap', 400, 'user', 'reduce-amount'],
        ['ton-attach-over-cap', 400, 'user', 'reduce-amount'],
        ['quote-expired', 400, 'internal', 'fresh-quote'],
        ['ton-quote-consumed', 400, 'internal', 'fresh-quote'],
        ['ton-collect-failed', 502, 'transient', 'retry-later'],
    ])('%s -> %s/%s', (code, httpStatus, severity, action) => {
        const d = resolveTonFeeBlocker(code, { httpStatus })
        expect(d.severity).toBe(severity)
        expect(d.action).toBe(action)
    })

    // ton-fee-already-settled bir HATA DEGIL, makbuz sinyalidir (bolum 6). UI'ya cikarsa
    // kullanici "islem basarisiz" sanir - oysa ucreti alinmis ve kurtarma yolu var.
    it('ton-fee-already-settled UI ya CIKMAZ', () => {
        expect(resolveTonFeeBlocker('ton-fee-already-settled', { httpStatus: 400 })).toBeNull()
    })
})

// BSC tarafinin kodlari BIZIM tablomuza KOPYALANMAZ. Kopyalansaydi iki tablo
// kacinilmaz olarak ayrisir ve kullanici TON'da baska, EVM'de baska bir ekran gorurdu.
describe('src-* kodlari resolveAtsBlocker a DELEGE edilir', () => {
    it.each([['src-balance-missing'], ['balance-missing'], ['src-allowance-missing'], ['src-allowance-low']])(
        '%s AYNI nesneyi doner', (code) => {
            expect(resolveTonFeeBlocker(code, { httpStatus: 400 }))
                .toBe(resolveAtsBlocker(code, { httpStatus: 400 }))
        })
})

// Task 2'nin dogrulama kapisi firlatirsa, sunucu bize IMZALAMAYI REDDETTIGIMIZ bir sey
// vermistir. Bu bir ag arizasi degil: ya bir hata ya bir saldiri. Kullaniciyi tekrar
// denemeye itmek YANLIS - ayni yanit yine gelir ve kullanici sonunda "bir sorun yok"
// diye dusunup devam etmeye calisir.
describe('istemci dogrulama kodlari', () => {
    const CODES = [
        'TON_QUOTE_HASH_MISMATCH', 'TON_QUOTE_INTENT_MISMATCH', 'TON_QUOTE_SEALED_MISMATCH',
        'TON_QUOTE_PUBKEY_MISMATCH', 'TON_QUOTE_WALLET_MISMATCH', 'TON_FEE_DOMAIN_MISMATCH',
        'TON_QUOTE_AUTH_TYPE', 'TON_QUOTE_DEADLINE_MISMATCH', 'TON_QUOTE_SEQNO_MISMATCH',
        'TON_QUOTE_FEE_MISMATCH', 'TON_QUOTE_FEE_ABOVE_APPROVED',
        'TON_PAYLOAD_UNPARSEABLE', 'TON_PAYLOAD_UNKNOWN_ACTION',
        'TON_PAYLOAD_BODY_UNVERIFIED', 'TON_PAYLOAD_INIT_UNVERIFIED',
    ]

    it.each(CODES.map((c) => [c]))('%s BLOCKED ve tekrar denemeye itmez', (code) => {
        const d = resolveTonFeeBlocker(code, {})
        expect(d.severity).toBe('blocked')
        expect(d.action).toBe('abort-unsafe')
        expect(d.i18nKey).toBe('send.confirmTransaction.tonUnsafeQuote')
    })

    // Suresi dolmus / tuketilmis teklif AYRI: bunlar guvenlik olayi degil, tazeleme isi.
    it.each([['TON_QUOTE_EXPIRED'], ['TON_QUOTE_WINDOW_TOO_LONG']])('%s fresh-quote', (code) => {
        expect(resolveTonFeeBlocker(code, {}).action).toBe('fresh-quote')
    })
})

describe('kodsuz yanitlar', () => {
    // TUZAK: tahsilat yolundaki altyapi hatalari sir sizdirmamak icin KODSUZ 400'e
    // sariliyor. "Kullanici istegini duzeltsin" demek yanlis - o noktada istek zaten
    // iki imzayla dogrulanmis; kullanicinin duzeltebilecegi hicbir sey yok.
    it.each([['quote'], ['relay']])('kodsuz 400 (%s) USER DEGIL', (phase) => {
        const d = resolveTonFeeBlocker(null, { httpStatus: 400, phase })
        expect(d.severity).not.toBe('user')
        expect(d.action).toBe('retry-later')
    })

    it('kodsuz 400 phase e gore FARKLI metin verir', () => {
        expect(resolveTonFeeBlocker(null, { httpStatus: 400, phase: 'quote' }).i18nKey)
            .not.toBe(resolveTonFeeBlocker(null, { httpStatus: 400, phase: 'relay' }).i18nKey)
    })

    it('bilinmeyen kod sessizce "engel yok"a DUSMEZ', () => {
        expect(resolveTonFeeBlocker('ton-bilinmeyen-kod', { httpStatus: 400 })).not.toBeNull()
    })

    // Task 4'un readTonFeeStatus'u ag hatasinda (cevrimdisi/DNS/engellenen istek)
    // HTTP yaniti OLMAYAN bir hata firlatir - httpStatus null kalir. Bunu "engel
    // yok" saymak ekrani BOS birakir: kullanici cevrimdisi, ucret akisi coktu.
    it('kodsuz VE httpStatus yoksa null DONMEZ - ag hatasi bir engeldir', () => {
        const d = resolveTonFeeBlocker(null, { phase: 'status' })
        expect(d).not.toBeNull()
        expect(d.action).toBe('retry-later')
    })

    // Bu modulde null'un TEK anlami makbuz sinyalidir. Baska bir yol null
    // dondurmeye baslarsa cagiran taraf onu "sorun yok" diye okur.
    it('null YALNIZCA ton-fee-already-settled icin doner', () => {
        const inputs = [
            [null, { phase: 'status' }], [null, { httpStatus: 400, phase: 'quote' }],
            [null, { httpStatus: 500, phase: 'relay' }], ['ton-bilinmeyen', { httpStatus: 400 }],
            ['TON_QUOTE_HASH_MISMATCH', {}], ['src-balance-missing', { httpStatus: 400 }],
        ]
        for (const [code, opts] of inputs) expect(resolveTonFeeBlocker(code, opts)).not.toBeNull()
        expect(resolveTonFeeBlocker('ton-fee-already-settled', { httpStatus: 400 })).toBeNull()
    })
})

// Makbuz akibeti UI kararindan AYRI bir fonksiyondur. Kodsuz 400'u kullanici hatasi
// sanmak ile depoda "temiz red" sanip makbuzu SILMEK iki ayri hata; ikincisi para
// kaybettirir.
describe('settlementDispositionFor', () => {
    it.each([
        [{ httpStatus: 502, code: 'ton-collect-failed' }, 'clear'],
        [{ httpStatus: 400, code: 'ton-fee-already-settled' }, 'keep-settled'],
        [{ httpStatus: 400, code: 'ton-cost-over-cap' }, 'clear'],
        [{ httpStatus: 400, code: 'ton-attach-over-cap' }, 'clear'],
        [{ httpStatus: 400, code: null }, 'keep'],
        [{ httpStatus: 400, code: 'quote-expired' }, 'keep'],
        [{ httpStatus: 500, code: null }, 'keep'],
    ])('%o -> %s', (input, expected) => {
        expect(settlementDispositionFor(input)).toBe(expected)
    })
})

// Task 8'in i18n parite testi bu kumeyi gezer (Ruling 2): anahtar adlari TEK yerde
// yasar, iki liste kacinilmaz olarak ayrisirdi.
describe('TON_FEE_I18N_KEYS', () => {
    it('tablodaki her i18nKey kumede', () => {
        for (const c of ['ton-stale-rate', 'ton-tank-low', 'ton-cost-over-cap']) {
            expect(TON_FEE_I18N_KEYS).toContain(resolveTonFeeBlocker(c, {}).i18nKey)
        }
    })
})
