import { describe, it, expect } from 'vitest'
import { privacyErrorKey, KNOWN_PRIVACY_ERROR_CODES } from './privacyErrors'

describe('privacyErrorKey', () => {
    it('rota yok kodu bilinen koddur (secilen token icin rota yok)', () => {
        expect(KNOWN_PRIVACY_ERROR_CODES.has('PRIVATE_ROUTE_UNAVAILABLE')).toBe(true)
        expect(privacyErrorKey('PRIVATE_ROUTE_UNAVAILABLE')).toBe('privacy.errors.PRIVATE_ROUTE_UNAVAILABLE')
    })

    it('bilinen kodlar kendi anahtarina, digerleri generic\'e', () => {
        expect(privacyErrorKey('WALLET_LOCKED')).toBe('privacy.errors.WALLET_LOCKED')
        expect(privacyErrorKey('PRIVATE_NEEDS_HD_VAULT')).toBe('privacy.errors.PRIVATE_NEEDS_HD_VAULT')
        expect(privacyErrorKey('Something exploded')).toBe('privacy.errors.generic')
        expect(privacyErrorKey(undefined)).toBe('privacy.errors.generic')
    })

    it('kapinin PRIVATE_* kodlari ve INVALID_ENABLED generic\'e duser', () => {
        for (const kod of ['INVALID_ENABLED', 'PRIVATE_DAPP_BLOCKED', 'PRIVATE_SEND_BLOCKED', 'PRIVATE_GATE_ERROR']) {
            expect(privacyErrorKey(kod)).toBe('privacy.errors.generic')
        }
    })

    it('Object.prototype anahtarlari generic\'e duser', () => {
        for (const kod of ['constructor', '__proto__', 'toString']) {
            expect(privacyErrorKey(kod)).toBe('privacy.errors.generic')
        }
    })

    it('gizli aktarma kodlari kendi anahtarina duser', () => {
        // Ekranlarin dallandigi kodlar bilinen kumede olmali (ekran bunlara gore karar verir). Kumenin boyutu ya da
        // tum uyelerin dongusu KILITLENMEZ: iki dilde var olma sarti locales.test.js'te kumeden turetilir.
        for (const kod of ['PRIVATE_MIN_AMOUNT', 'PRIVATE_QUOTE_EXPIRED', 'PRIVATE_QUOTE_NOT_FOUND', 'PRIVATE_UNSUPPORTED', 'PRIVATE_ORDER_IN_PROGRESS', 'PRIVATE_DEPOSIT_UNCONFIRMED', 'PRIVATE_REFUND_UNCONFIRMED']) {
            expect(KNOWN_PRIVACY_ERROR_CODES.has(kod), kod).toBe(true)
            expect(privacyErrorKey(kod)).toBe(`privacy.errors.${kod}`)
        }
    })

    // T5 (sT12): hash'siz ATS yatirmasi icin ayri kod; ekran bunu "izlenemiyor, tekrar deneme" diye gosterir.
    it('PRIVATE_DEPOSIT_UNTRACKED bilinen koddur ve kendi anahtarina duser', () => {
        expect(KNOWN_PRIVACY_ERROR_CODES.has('PRIVATE_DEPOSIT_UNTRACKED')).toBe(true)
        expect(privacyErrorKey('PRIVATE_DEPOSIT_UNTRACKED')).toBe('privacy.errors.PRIVATE_DEPOSIT_UNTRACKED')
        // Hash'li belirsiz durum eski koduyla kalir.
        expect(privacyErrorKey('PRIVATE_DEPOSIT_UNCONFIRMED')).toBe('privacy.errors.PRIVATE_DEPOSIT_UNCONFIRMED')
    })

    it('fallbackKey yalniz bilinmeyen kodlarda kullanilir', () => {
        const fb = 'privacy.errors.PRIVATE_FAILED'
        for (const kod of ['PRIVATE_CHECK_FAILED', 'Something exploded', undefined, null, 'constructor', '__proto__']) {
            expect(privacyErrorKey(kod, fb)).toBe(fb)
        }
        expect(privacyErrorKey('PRIVATE_MIN_AMOUNT', fb)).toBe('privacy.errors.PRIVATE_MIN_AMOUNT')
        expect(privacyErrorKey('PRIVATE_QUOTE_EXPIRED')).toBe('privacy.errors.PRIVATE_QUOTE_EXPIRED')
        expect(privacyErrorKey('PRIVATE_CHECK_FAILED')).toBe('privacy.errors.generic')
    })
})

// SP2 (gizli-mod cok-ag spec 4.10): yeni kodlar bilinen kumede olmali (ekran bunlara gore metin secer); iki dilde var olma
// sarti locales.test.js'te kumeden turetilir.
describe('SP2 teslim agi hata kodlari', () => {
    it('kapali ag, fiyat farki ve hiz siniri kodlari bilinen koddur ve kendi anahtarina duser', () => {
        for (const kod of ['PRIVATE_CHAIN_CLOSED', 'PRIVATE_IMPACT_TOO_HIGH', 'PRIVATE_RATE_LIMITED']) {
            expect(KNOWN_PRIVACY_ERROR_CODES.has(kod), kod).toBe(true)
            expect(privacyErrorKey(kod)).toBe(`privacy.errors.${kod}`)
        }
    })

    // ATS-once kapisi 2026-10-28 kullanici karariyla KALDIRILDI: arka plan bu kodu artik dondurmez, bilinen kumede olmamali.
    it('PRIVATE_ATS_FIRST artik bilinen kod degildir (kapi kaldirildi)', () => {
        expect(KNOWN_PRIVACY_ERROR_CODES.has('PRIVATE_ATS_FIRST')).toBe(false)
        expect(privacyErrorKey('PRIVATE_ATS_FIRST')).toBe('privacy.errors.generic')
    })

    // PRIVATE_MAX_AMOUNT_LIMIT bir arka plan kodu degildir (ekran yanittaki limitUsdc varsa bu anahtari secer); bilinen kume disinda kalir.
    it('PRIVATE_MAX_AMOUNT_LIMIT arka plan kodu degildir: bilinen kumede yok', () => {
        expect(KNOWN_PRIVACY_ERROR_CODES.has('PRIVATE_MAX_AMOUNT_LIMIT')).toBe(false)
    })
})
