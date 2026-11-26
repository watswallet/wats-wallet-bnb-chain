// computeBalanceDelta: simulateTransaction `value` nesnesinden kullanicinin SOL
// ve token bakiye farki. SAF katman: ag yok, firlatmaz.
import { describe, it, expect } from 'vitest'
import { computeBalanceDelta } from './balanceDelta'
import {
    USER, RECIPIENT, OTHER_OWNER, USDC_MINT, WSOL_MINT, USER_WSOL_ACCT, USER_WSOL_ACCT2,
    SYSTEM_TRANSFER_SIM, SYSTEM_TRANSFER_ACCOUNT_KEYS,
    USDC_TRANSFER_SIM, USDC_RECEIVE_SIM, USDC_TRANSFER_ACCOUNT_KEYS,
    tokenBalance,
} from '../../test-utils/solanaSimFixtures'

const valueOf = (sim, patch = {}) => ({ ...sim.value, ...patch })

describe('computeBalanceDelta -- SOL', () => {
    it('System Transfer: kullanici ucret odeyen -> -(tutar + ucret), post-pre', () => {
        const r = computeBalanceDelta({ value: SYSTEM_TRANSFER_SIM.value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER })
        expect(r.ok).toBe(true)
        expect(r.solDeltaLamports).toBe(-(1_000_000n + 5000n))
        expect(r.tokenDeltas).toEqual([])
    })

    it('kullanici alici ise SOL farki pozitif', () => {
        const r = computeBalanceDelta({ value: SYSTEM_TRANSFER_SIM.value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: RECIPIENT })
        expect(r.ok).toBe(true)
        expect(r.solDeltaLamports).toBe(1_000_000n)
    })

    it('kullanici anahtar listesinde yoksa SOL farki 0n ve token farki bos', () => {
        const r = computeBalanceDelta({ value: SYSTEM_TRANSFER_SIM.value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: OTHER_OWNER })
        expect(r).toEqual({ ok: true, solDeltaLamports: 0n, tokenDeltas: [], tokensUnreadable: false, partial: false })
    })

    it('adres karsilastirmasi BUYUK/kucuk harf duyarli (toLowerCase yok)', () => {
        const r = computeBalanceDelta({ value: SYSTEM_TRANSFER_SIM.value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER.toLowerCase() })
        expect(r.solDeltaLamports).toBe(0n)
    })

    it('preBalances.length anahtar sayisiyla uyusmuyorsa unusable', () => {
        const r = computeBalanceDelta({ value: SYSTEM_TRANSFER_SIM.value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS.slice(0, 2), user: USER })
        expect(r).toEqual({ ok: false, reason: 'unusable' })
    })

    it('postBalances.length uyusmuyorsa unusable', () => {
        const value = valueOf(SYSTEM_TRANSFER_SIM, { postBalances: [8_995_000] })
        expect(computeBalanceDelta({ value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER }))
            .toEqual({ ok: false, reason: 'unusable' })
    })

    it('kullanici bakiyesi guvenli tamsayi degilse (JSON hassasiyet kaybi) unusable', () => {
        const value = valueOf(SYSTEM_TRANSFER_SIM, { preBalances: [2 ** 60, 2_000_000, 1] })
        expect(computeBalanceDelta({ value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER }))
            .toEqual({ ok: false, reason: 'unusable' })
    })

    it('value nesne degilse / dizi alanlari yoksa unusable (firlatmaz)', () => {
        for (const value of [null, undefined, 'x', 5, {}, { preBalances: 'x', postBalances: [] }]) {
            expect(computeBalanceDelta({ value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER }))
                .toEqual({ ok: false, reason: 'unusable' })
        }
        expect(computeBalanceDelta({ value: SYSTEM_TRANSFER_SIM.value, accountKeys: 'x', user: USER }))
            .toEqual({ ok: false, reason: 'unusable' })
    })
})

describe('computeBalanceDelta -- token', () => {
    it('USDC TransferChecked fixture: tokenDeltas tek satir -1000000n, decimals 6', () => {
        const r = computeBalanceDelta({ value: USDC_TRANSFER_SIM.value, accountKeys: USDC_TRANSFER_ACCOUNT_KEYS, user: USER })
        expect(r.ok).toBe(true)
        expect(r.tokenDeltas).toEqual([{ mint: USDC_MINT, delta: -1000000n, decimals: 6 }])
        // Ucret ayri hesaptan: SOL farki yalniz ucret.
        expect(r.solDeltaLamports).toBe(-5000n)
    })

    it('kullanici yalniz alici ise +1000000n', () => {
        const r = computeBalanceDelta({ value: USDC_RECEIVE_SIM.value, accountKeys: USDC_TRANSFER_ACCOUNT_KEYS, user: USER })
        expect(r.tokenDeltas).toEqual([{ mint: USDC_MINT, delta: 1000000n, decimals: 6 }])
    })

    it('baska sahibin token hesabi kullaniciya SAYILMAZ', () => {
        const r = computeBalanceDelta({ value: USDC_TRANSFER_SIM.value, accountKeys: USDC_TRANSFER_ACCOUNT_KEYS, user: OTHER_OWNER })
        expect(r.tokenDeltas).toEqual([{ mint: USDC_MINT, delta: 1000000n, decimals: 6 }])
        const r2 = computeBalanceDelta({ value: USDC_TRANSFER_SIM.value, accountKeys: USDC_TRANSFER_ACCOUNT_KEYS, user: RECIPIENT })
        expect(r2.tokenDeltas).toEqual([])
    })

    it('wSOL ayri satir (SOL farkindan ayri); ayni mint birden cok hesap TOPLANIR', () => {
        const keys = [USER, USER_WSOL_ACCT, USER_WSOL_ACCT2]
        const value = {
            preBalances: [10_000_000, 2_039_280, 2_039_280],
            postBalances: [10_000_000, 2_039_280, 2_039_280],
            preTokenBalances: [
                tokenBalance(1, WSOL_MINT, USER, 3_000_000, 9),
                tokenBalance(2, WSOL_MINT, USER, 1_000_000, 9),
            ],
            postTokenBalances: [
                tokenBalance(1, WSOL_MINT, USER, 500_000, 9),
                tokenBalance(2, WSOL_MINT, USER, 1_500_000, 9),
            ],
        }
        const r = computeBalanceDelta({ value, accountKeys: keys, user: USER })
        // (500k + 1.5M) - (3M + 1M) = -2M
        expect(r.tokenDeltas).toEqual([{ mint: WSOL_MINT, delta: -2_000_000n, decimals: 9 }])
        expect(r.solDeltaLamports).toBe(0n)
    })

    it("yalniz post'ta olan (yeni ATA) pre=0; yalniz pre'de olan (kapanan) post=0", () => {
        const keys = [USER, USER_WSOL_ACCT, USER_WSOL_ACCT2]
        const value = {
            preBalances: [1, 1, 1],
            postBalances: [1, 1, 1],
            preTokenBalances: [tokenBalance(2, WSOL_MINT, USER, 700, 9)],
            postTokenBalances: [tokenBalance(1, USDC_MINT, USER, 250, 6)],
        }
        const r = computeBalanceDelta({ value, accountKeys: keys, user: USER })
        expect(r.tokenDeltas).toEqual(expect.arrayContaining([
            { mint: USDC_MINT, delta: 250n, decimals: 6 },
            { mint: WSOL_MINT, delta: -700n, decimals: 9 },
        ]))
        expect(r.tokenDeltas).toHaveLength(2)
    })

    it('net farki 0 olan mint satiri uretilmez', () => {
        const keys = [USER, USER_WSOL_ACCT]
        const value = {
            preBalances: [1, 1], postBalances: [1, 1],
            preTokenBalances: [tokenBalance(1, USDC_MINT, USER, 100, 6)],
            postTokenBalances: [tokenBalance(1, USDC_MINT, USER, 100, 6)],
        }
        expect(computeBalanceDelta({ value, accountKeys: keys, user: USER }).tokenDeltas).toEqual([])
    })

    it('kullanicinin token kaydi bozuksa (amount rakam dizesi degil) unusable', () => {
        const keys = [USER, USER_WSOL_ACCT]
        const bad = tokenBalance(1, USDC_MINT, USER, 100, 6)
        bad.uiTokenAmount.amount = '1e3'
        const value = {
            preBalances: [1, 1], postBalances: [1, 1],
            preTokenBalances: [bad], postTokenBalances: [],
        }
        expect(computeBalanceDelta({ value, accountKeys: keys, user: USER })).toEqual({ ok: false, reason: 'unusable' })
    })

    it('baskasinin bozuk kaydi sonucu BOZMAZ (yalniz kullanicinin kayitlari okunur)', () => {
        const keys = [USER, USER_WSOL_ACCT]
        const bad = tokenBalance(1, USDC_MINT, OTHER_OWNER, 100, 6)
        bad.uiTokenAmount.amount = 'garip'
        const value = {
            preBalances: [1, 1], postBalances: [1, 1],
            preTokenBalances: [bad], postTokenBalances: [],
        }
        expect(computeBalanceDelta({ value, accountKeys: keys, user: USER }))
            .toEqual({ ok: true, solDeltaLamports: 0n, tokenDeltas: [], tokensUnreadable: false, partial: false })
    })

    it('ayni mint icin celisen decimals -> unusable (uydurma yok)', () => {
        const keys = [USER, USER_WSOL_ACCT]
        const value = {
            preBalances: [1, 1], postBalances: [1, 1],
            preTokenBalances: [tokenBalance(1, USDC_MINT, USER, 100, 6)],
            postTokenBalances: [tokenBalance(1, USDC_MINT, USER, 50, 9)],
        }
        expect(computeBalanceDelta({ value, accountKeys: keys, user: USER })).toEqual({ ok: false, reason: 'unusable' })
    })

    // S10-V10-2 (fail-closed): dizi YOKSA "token degisimi yok" DEGIL "okunamadi"; SOL farki etkilenmez.
    it('pre/postTokenBalances dizi DEGILSE (yok/null/dizge) token farki "okunamadi" isaretlenir, SOL farki korunur', () => {
        for (const patch of [
            { preTokenBalances: null, postTokenBalances: undefined },
            { preTokenBalances: undefined, postTokenBalances: [] },
            { preTokenBalances: [], postTokenBalances: 'x' },
        ]) {
            const value = valueOf(SYSTEM_TRANSFER_SIM, patch)
            const r = computeBalanceDelta({ value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER })
            expect(r.ok).toBe(true)
            expect(r.tokensUnreadable).toBe(true)
            expect(r.tokenDeltas).toEqual([])
            expect(r.solDeltaLamports).toBe(-(1_000_000n + 5000n))
        }
    })

    it('iki dizi de varsa tokensUnreadable false (bos dizi gercek "degisim yok"tur)', () => {
        const value = valueOf(SYSTEM_TRANSFER_SIM, { preTokenBalances: [], postTokenBalances: [] })
        const r = computeBalanceDelta({ value, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER })
        expect(r.tokensUnreadable).toBe(false)
        expect(r.partial).toBe(false)
    })

    it('`owner`siz token kaydi -> sonuc KISMI; owner li kayitlar yine okunur', () => {
        const keys = [USER, USER_WSOL_ACCT]
        const sahipsiz = tokenBalance(1, USDC_MINT, OTHER_OWNER, 100, 6)
        delete sahipsiz.owner
        const value = {
            preBalances: [1, 1], postBalances: [1, 1],
            preTokenBalances: [sahipsiz, tokenBalance(1, WSOL_MINT, USER, 7, 9)], postTokenBalances: [],
        }
        const r = computeBalanceDelta({ value, accountKeys: keys, user: USER })
        expect(r.ok).toBe(true)
        expect(r.partial).toBe(true)
        expect(r.tokenDeltas).toEqual([{ mint: WSOL_MINT, delta: -7n, decimals: 9 }])
        // owner string degilse de ayni
        const bozuk = { ...tokenBalance(1, USDC_MINT, USER, 1, 6), owner: 5 }
        const r2 = computeBalanceDelta({ value: { ...value, preTokenBalances: [bozuk], postTokenBalances: [] }, accountKeys: keys, user: USER })
        expect(r2.partial).toBe(true)
    })
})

describe('computeBalanceDelta -- gecersiz TIPTE user / accountKeys (S7-S7-1)', () => {
    const UNUSABLE = { ok: false, reason: 'unusable' }
    // Kullanici 10_000_000 lamport KAYBETTI: yanlis tip "degisiklik yok" dememeli.
    const lossValue = { preBalances: [10_000_000, 2_000_000, 1], postBalances: [0, 12_000_000, 1] }
    const keys = ['A', 'B', 'C']

    it('accountKeys PublicKey benzeri nesneler ([{toBase58}]) -> unusable', () => {
        const objKeys = keys.map((k) => ({ toBase58: () => k, toString: () => k }))
        expect(computeBalanceDelta({ value: lossValue, accountKeys: objKeys, user: 'A' })).toEqual(UNUSABLE)
    })

    it('accountKeys icinde bos string / sayi / null oge -> unusable', () => {
        expect(computeBalanceDelta({ value: lossValue, accountKeys: ['A', '', 'C'], user: 'A' })).toEqual(UNUSABLE)
        expect(computeBalanceDelta({ value: lossValue, accountKeys: ['A', 5, 'C'], user: 'A' })).toEqual(UNUSABLE)
        expect(computeBalanceDelta({ value: lossValue, accountKeys: ['A', null, 'C'], user: 'A' })).toEqual(UNUSABLE)
    })

    it("user null/undefined/''/nesne/sayi -> unusable (listede yok ile ayni dala DUSMEZ)", () => {
        for (const user of [null, undefined, '', 5, { toBase58: () => 'A' }]) {
            expect(computeBalanceDelta({ value: lossValue, accountKeys: keys, user })).toEqual(UNUSABLE)
        }
    })

    it('gecerli string user + string liste: kayip gorunur; kullanici listede yoksa hala 0n', () => {
        expect(computeBalanceDelta({ value: lossValue, accountKeys: keys, user: 'A' }))
            .toEqual({ ok: true, solDeltaLamports: -10_000_000n, tokenDeltas: [], tokensUnreadable: true, partial: false })
        expect(computeBalanceDelta({ value: lossValue, accountKeys: keys, user: 'Z' }))
            .toEqual({ ok: true, solDeltaLamports: 0n, tokenDeltas: [], tokensUnreadable: true, partial: false })
    })
})

// SU-5: "hicbir yol firlatmaz" sozlesmesi (null arguman, seyrek dizi).
describe('computeBalanceDelta -- hicbir yol firlatmaz (SU-5)', () => {
    it('null / undefined / bos arguman -> unusable (TypeError firlatmaz)', () => {
        expect(computeBalanceDelta(null)).toEqual({ ok: false, reason: 'unusable' })
        expect(computeBalanceDelta(undefined)).toEqual({ ok: false, reason: 'unusable' })
        expect(computeBalanceDelta()).toEqual({ ok: false, reason: 'unusable' })
    })

    it('seyrek (delikli) accountKeys -> unusable; delik "gecerli adres" sayilmaz', () => {
        const value = { preBalances: [10_000_000, 2_000_000, 1], postBalances: [0, 12_000_000, 1], preTokenBalances: [], postTokenBalances: [] }
        const seyrek = ['A', , 'C'] // eslint-disable-line no-sparse-arrays
        expect(computeBalanceDelta({ value, accountKeys: seyrek, user: 'A' })).toEqual({ ok: false, reason: 'unusable' })
    })

    it('REGRESYON: delikli olmayan liste ayni degerle calisir', () => {
        const value = { preBalances: [10_000_000, 2_000_000, 1], postBalances: [0, 12_000_000, 1], preTokenBalances: [], postTokenBalances: [] }
        expect(computeBalanceDelta({ value, accountKeys: ['A', 'B', 'C'], user: 'A' }).ok).toBe(true)
    })
})
