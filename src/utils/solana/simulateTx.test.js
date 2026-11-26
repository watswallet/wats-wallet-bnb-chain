// simulateTx / fetchFeeForMessage / simulateMany: FAIL-OPEN -- hicbir yol
// firlatmaz. Simulasyon sonucu imza KARARINI baglamaz (yalniz gosterim).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { simulateTx, simulateMany, fetchFeeForMessage } from './simulateTx'
import {
    USER, USDC_MINT, ALT_WRITABLE, ALT_READONLY,
    SYSTEM_TRANSFER_SIM, SYSTEM_TRANSFER_ACCOUNT_KEYS,
    USDC_TRANSFER_SIM, USDC_TRANSFER_ACCOUNT_KEYS,
    V0_ALT_SIM, V0_STATIC_KEYS, simResult,
} from '../../test-utils/solanaSimFixtures'

const TX = 'QkFTRTY0LVRY' // base64 degeri onemsiz: rpc taklit
const MSG = 'TUVTU0FHRQ=='

const rpcOf = (map) => vi.fn(async (method) => {
    const v = map[method]
    if (typeof v === 'function') return v()
    return v
})

describe('simulateTx -- istek sekli', () => {
    it('simulateTransaction secenekleri sabit; accounts parametresi YOK; sinyal + zaman asimi iletilir', async () => {
        const rpc = rpcOf({ simulateTransaction: SYSTEM_TRANSFER_SIM })
        const ac = new AbortController()
        await simulateTx({ base64Tx: TX, messageBase64: MSG, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc, signal: ac.signal })
        expect(rpc).toHaveBeenCalledTimes(1)
        const [method, params, opts] = rpc.mock.calls[0]
        expect(method).toBe('simulateTransaction')
        expect(params).toEqual([TX, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }])
        expect(params[1]).not.toHaveProperty('accounts')
        expect(opts.signal).toBe(ac.signal)
        expect(opts.timeoutMs).toBe(6000)
    })

    it('timeoutMs ozel deger iletilir', async () => {
        const rpc = rpcOf({ simulateTransaction: SYSTEM_TRANSFER_SIM })
        await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc, timeoutMs: 1234 })
        expect(rpc.mock.calls[0][2].timeoutMs).toBe(1234)
    })
})

describe('simulateTx -- sonuc', () => {
    it('System 1_000_000 lamport: solDelta = -(1_000_000 + 5000), fee 5000n', async () => {
        const rpc = rpcOf({ simulateTransaction: SYSTEM_TRANSFER_SIM })
        const r = await simulateTx({ base64Tx: TX, messageBase64: MSG, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: true, solDeltaLamports: -(1_000_000n + 5000n), feeLamports: 5000n, tokenDeltas: [], tokensUnreadable: false, partial: false })
        // value.fee var -> getFeeForMessage CAGRILMAZ
        expect(rpc.mock.calls.map((c) => c[0])).toEqual(['simulateTransaction'])
    })

    it('USDC TransferChecked: tokenDeltas [{delta:-1000000n, decimals:6}]', async () => {
        const rpc = rpcOf({ simulateTransaction: USDC_TRANSFER_SIM })
        const r = await simulateTx({ base64Tx: TX, messageBase64: MSG, accountKeys: USDC_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r.ok).toBe(true)
        expect(r.tokenDeltas).toEqual([{ mint: USDC_MINT, delta: -1000000n, decimals: 6 }])
    })

    it('preBalances.length uyusmazligi -> unusable', async () => {
        const rpc = rpcOf({ simulateTransaction: SYSTEM_TRANSFER_SIM })
        const r = await simulateTx({ base64Tx: TX, accountKeys: [USER], user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'unusable' })
    })

    it('err != null -> program_error ve token bakiyeleri GOSTERILMEZ', async () => {
        const sim = simResult({ ...USDC_TRANSFER_SIM.value, err: { InstructionError: [0, { Custom: 17 }] } })
        const rpc = rpcOf({ simulateTransaction: sim })
        const r = await simulateTx({ base64Tx: TX, accountKeys: USDC_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'program_error' })
        expect(r).not.toHaveProperty('tokenDeltas')
        expect(r).not.toHaveProperty('solDeltaLamports')
    })

    it('err null DISINDA her deger program_error (alan HIC yoksa unusable: E-a)', async () => {
        for (const err of ['AccountNotFound', 0, false, '']) {
            const sim = simResult({ ...SYSTEM_TRANSFER_SIM.value, err })
            const rpc = rpcOf({ simulateTransaction: sim })
            const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
            expect(r).toEqual({ ok: false, reason: 'program_error' })
        }
    })

    it('result bos / value nesne degil -> unusable', async () => {
        for (const res of [undefined, null, {}, { value: null }, { value: 'x' }]) {
            const rpc = rpcOf({ simulateTransaction: res })
            const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
            expect(r).toEqual({ ok: false, reason: 'unusable' })
        }
    })
})

describe('simulateTx -- ucret', () => {
    const noFee = simResult({ ...SYSTEM_TRANSFER_SIM.value, fee: undefined })

    it('value.fee yoksa fetchFeeForMessage (getFeeForMessage) cagrilir', async () => {
        const rpc = rpcOf({ simulateTransaction: noFee, getFeeForMessage: { context: {}, value: 205000 } })
        const r = await simulateTx({ base64Tx: TX, messageBase64: MSG, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r.ok).toBe(true)
        expect(r.feeLamports).toBe(205000n)
        const call = rpc.mock.calls.find((c) => c[0] === 'getFeeForMessage')
        expect(call[1][0]).toBe(MSG)
    })

    it('getFeeForMessage reject -> feeLamports null, simulasyon sonucu KORUNUR', async () => {
        const rpc = vi.fn(async (method) => {
            if (method === 'simulateTransaction') return noFee
            throw new Error('SOLANA_RPC_HTTP_403')
        })
        const r = await simulateTx({ base64Tx: TX, messageBase64: MSG, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: true, solDeltaLamports: -(1_000_000n + 5000n), feeLamports: null, tokenDeltas: [], tokensUnreadable: false, partial: false })
    })

    it('ikisi de yoksa feeLamports null (messageBase64 yoksa ikinci cagri hic yapilmaz)', async () => {
        const rpc = rpcOf({ simulateTransaction: noFee })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r.feeLamports).toBeNull()
        expect(rpc.mock.calls.map((c) => c[0])).toEqual(['simulateTransaction'])
    })

    it('value.fee gecersiz (negatif/kesirli/dize) -> yedege dusulur', async () => {
        for (const fee of [-1, 1.5, 'abc', NaN]) {
            const sim = simResult({ ...SYSTEM_TRANSFER_SIM.value, fee })
            const rpc = rpcOf({ simulateTransaction: sim, getFeeForMessage: { value: 7000 } })
            const r = await simulateTx({ base64Tx: TX, messageBase64: MSG, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
            expect(r.feeLamports).toBe(7000n)
        }
    })
})

describe('simulateTx -- v0 + ALT', () => {
    it('anahtar sirasi static, writable, readonly; kullanici static ilk', async () => {
        const rpc = rpcOf({ simulateTransaction: V0_ALT_SIM })
        const r = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: USER, rpc })
        expect(r.ok).toBe(true)
        expect(r.solDeltaLamports).toBe(-5000n)
    })

    it('yuklu adresler listeye EKLENIR: ALT adresleri kullaniciya atfedilmez, indeks sirasi korunur', async () => {
        const rpc = rpcOf({ simulateTransaction: V0_ALT_SIM })
        const r = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: ALT_WRITABLE, rpc })
        // Liste [static x3, writable, readonly] olarak kuruldu -> ALT_WRITABLE indeks 3 (pre=post=7_000_000).
        expect(r.ok).toBe(true)
        expect(r.solDeltaLamports).toBe(0n)
        const r2 = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: ALT_READONLY, rpc })
        expect(r2.ok).toBe(true)
        expect(r2.solDeltaLamports).toBe(0n)
    })

    it('sira dogrulugu: ALT writable ve readonly indeksleri ayri bakiyelerle bulunur', async () => {
        const sim = simResult({
            ...V0_ALT_SIM.value,
            preBalances: [10_000_000, 1, 1, 7_000_000, 9_000_000],
            postBalances: [9_995_000, 1, 1, 6_000_000, 9_500_000],
        })
        const rpc = rpcOf({ simulateTransaction: sim })
        const w = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: ALT_WRITABLE, rpc })
        const ro = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: ALT_READONLY, rpc })
        expect(w.solDeltaLamports).toBe(-1_000_000n)
        expect(ro.solDeltaLamports).toBe(500_000n)
    })

    it('cagiran ALT adreslerini ZATEN cozmusse (tam liste) yedek eklenmez', async () => {
        const full = [...V0_STATIC_KEYS, ALT_WRITABLE, ALT_READONLY]
        const rpc = rpcOf({ simulateTransaction: V0_ALT_SIM })
        const r = await simulateTx({ base64Tx: TX, accountKeys: full, user: USER, rpc })
        expect(r.ok).toBe(true)
        expect(r.solDeltaLamports).toBe(-5000n)
    })

    it('loadedAddresses uzunlugu uyusmazsa yedek ATILIR -> unusable', async () => {
        const sim = simResult({ ...V0_ALT_SIM.value, loadedAddresses: { writable: [ALT_WRITABLE, ALT_WRITABLE], readonly: [ALT_READONLY] } })
        const rpc = rpcOf({ simulateTransaction: sim })
        const r = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'unusable' })
    })

    it('loadedAddresses bozuk (dizi degil) -> yedek yok, uzunluk uyusmazligi unusable', async () => {
        const sim = simResult({ ...V0_ALT_SIM.value, loadedAddresses: { writable: 'x', readonly: null } })
        const rpc = rpcOf({ simulateTransaction: sim })
        const r = await simulateTx({ base64Tx: TX, accountKeys: V0_STATIC_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'unusable' })
    })
})

describe('simulateTx -- hata yollari (firlatmaz)', () => {
    it('rpc 403 -> rpc_error', async () => {
        const rpc = vi.fn(async () => { throw new Error('SOLANA_RPC_HTTP_403') })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'rpc_error' })
    })

    it('SOLANA_RPC_TIMEOUT -> timeout', async () => {
        const rpc = vi.fn(async () => { throw new Error('SOLANA_RPC_TIMEOUT') })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'timeout' })
    })

    it('SOLANA_RPC_ABORTED -> timeout (hesaplanamadi; ayri kod uretilmez)', async () => {
        const rpc = vi.fn(async () => { throw new Error('SOLANA_RPC_ABORTED') })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'timeout' })
    })

    it('rpc senkron firlatsa da / hata nesnesi degilse de firlatmaz', async () => {
        const rpc = vi.fn(() => { throw 'garip' })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'rpc_error' })
    })

    it('girdi eksik/bozuk (base64Tx yok) -> unusable, rpc cagrilmaz', async () => {
        const rpc = vi.fn()
        expect(await simulateTx({ base64Tx: '', accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc }))
            .toEqual({ ok: false, reason: 'unusable' })
        expect(await simulateTx({ base64Tx: TX, accountKeys: null, user: USER, rpc }))
            .toEqual({ ok: false, reason: 'unusable' })
        expect(rpc).not.toHaveBeenCalled()
    })
})

describe('fetchFeeForMessage', () => {
    it('getFeeForMessage [mesaj, {commitment:processed}] -> bigint', async () => {
        const rpc = vi.fn(async () => ({ context: {}, value: 5000 }))
        expect(await fetchFeeForMessage(rpc, MSG)).toBe(5000n)
        expect(rpc.mock.calls[0][0]).toBe('getFeeForMessage')
        expect(rpc.mock.calls[0][1]).toEqual([MSG, { commitment: 'processed' }])
    })

    it('sinyal ve zaman asimi ucuncu parametreyle iletilir', async () => {
        const rpc = vi.fn(async () => ({ value: 5000 }))
        const ac = new AbortController()
        await fetchFeeForMessage(rpc, MSG, { signal: ac.signal, timeoutMs: 999 })
        expect(rpc.mock.calls[0][2]).toEqual({ signal: ac.signal, timeoutMs: 999 })
    })

    it('hata / null / gecersiz deger -> null, firlatmaz', async () => {
        expect(await fetchFeeForMessage(vi.fn(async () => { throw new Error('x') }), MSG)).toBeNull()
        for (const res of [undefined, null, { value: null }, { value: -5 }, { value: 1.5 }, { value: 'a' }]) {
            expect(await fetchFeeForMessage(vi.fn(async () => res), MSG)).toBeNull()
        }
    })

    it('mesaj bos/dize degilse rpc cagrilmaz', async () => {
        const rpc = vi.fn()
        expect(await fetchFeeForMessage(rpc, '')).toBeNull()
        expect(await fetchFeeForMessage(rpc, null)).toBeNull()
        expect(rpc).not.toHaveBeenCalled()
    })
})

describe('simulateMany', () => {
    afterEach(() => { vi.useRealTimers() })

    const item = (i) => ({ base64Tx: `TX${i}`, messageBase64: `M${i}`, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS })

    it('sonuclar girdi sirasiyla; en fazla 3 esanli', async () => {
        let inFlight = 0
        let peak = 0
        const rpc = vi.fn(async () => {
            inFlight += 1
            peak = Math.max(peak, inFlight)
            await new Promise((r) => setTimeout(r, 5))
            inFlight -= 1
            return SYSTEM_TRANSFER_SIM
        })
        const res = await simulateMany([0, 1, 2, 3, 4, 5, 6].map(item), { user: USER, rpc })
        expect(res).toHaveLength(7)
        expect(res.every((r) => r.ok)).toBe(true)
        expect(peak).toBe(3)
        expect(rpc.mock.calls.map((c) => c[1][0]).sort()).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => `TX${i}`))
    })

    it('sonuc dizisi girdi sirasini korur (farkli sonuclar yerine oturur)', async () => {
        const rpc = vi.fn(async (method, params) => {
            // TX0 yavas, TX1 hizli: sira sonuc tamamlanma sirasina gore DEGISMEZ.
            if (params[0] === 'TX0') await new Promise((r) => setTimeout(r, 20))
            if (params[0] === 'TX1') throw new Error('SOLANA_RPC_HTTP_403')
            return SYSTEM_TRANSFER_SIM
        })
        const res = await simulateMany([0, 1, 2].map(item), { user: USER, rpc })
        expect(res.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['ok', 'rpc_error', 'ok'])
    })

    it('bos liste -> bos dizi', async () => {
        expect(await simulateMany([], { user: USER, rpc: vi.fn() })).toEqual([])
        expect(await simulateMany(null, { user: USER, rpc: vi.fn() })).toEqual([])
    })

    it('butce dolunca devam edenler ve baslamamis olanlar timeout; biten sonuc korunur', async () => {
        vi.useFakeTimers()
        // TX0 ve TX1 hemen biter; digerleri iptal sinyaline kadar asili kalir.
        const rpc = vi.fn((method, params, { signal } = {}) => {
            const tx = params[0]
            if (tx === 'TX0' || tx === 'TX1') return Promise.resolve(SYSTEM_TRANSFER_SIM)
            return new Promise((_, reject) => {
                signal?.addEventListener('abort', () => reject(new Error('SOLANA_RPC_ABORTED')))
            })
        })
        const p = simulateMany([0, 1, 2, 3, 4, 5, 6].map(item), { user: USER, rpc, budgetMs: 8000 })
        await vi.advanceTimersByTimeAsync(8000)
        const res = await p
        expect(res[0].ok).toBe(true)
        expect(res[1].ok).toBe(true)
        for (const i of [2, 3, 4, 5, 6]) expect(res[i]).toEqual({ ok: false, reason: 'timeout' })
        // 3 esanli: TX0, TX1 biter -> TX2, TX3, TX4 asili kalir; TX5/TX6 butce dolmadan once
        // baslamis olabilir (TX0/TX1'in yerine). Butce SONRASI hic yeni istek baslamaz.
        const callsAfterBudget = rpc.mock.calls.length
        await vi.advanceTimersByTimeAsync(10000)
        expect(rpc.mock.calls.length).toBe(callsAfterBudget)
    })

    it('butce zaten bitmisken baslayacak olanlarin rpc cagrisi YAPILMAZ', async () => {
        vi.useFakeTimers()
        const rpc = vi.fn((method, params, { signal } = {}) => new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('SOLANA_RPC_ABORTED')))
        }))
        const p = simulateMany([0, 1, 2, 3, 4].map(item), { user: USER, rpc, budgetMs: 100, concurrency: 3 })
        await vi.advanceTimersByTimeAsync(100)
        const res = await p
        expect(res.every((r) => !r.ok && r.reason === 'timeout')).toBe(true)
        // yalniz ilk 3 baslayabildi; TX3 / TX4 icin rpc HIC cagrilmadi.
        expect(rpc).toHaveBeenCalledTimes(3)
    })

    it('bir istegin hatasi digerlerini etkilemez (firlatmaz)', async () => {
        const rpc = vi.fn(async (method, params) => {
            if (params[0] === 'TX1') throw new Error('SOLANA_RPC_HTTP_403')
            return SYSTEM_TRANSFER_SIM
        })
        const res = await simulateMany([0, 1, 2].map(item), { user: USER, rpc })
        expect(res.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['ok', 'rpc_error', 'ok'])
    })

    it('disaridan gelen sinyal iptal edilirse kalanlar timeout (firlatmaz)', async () => {
        const ac = new AbortController()
        const rpc = vi.fn((method, params, { signal } = {}) => new Promise((_, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('SOLANA_RPC_ABORTED')))
        }))
        const p = simulateMany([0, 1].map(item), { user: USER, rpc, signal: ac.signal })
        ac.abort()
        const res = await p
        expect(res).toEqual([{ ok: false, reason: 'timeout' }, { ok: false, reason: 'timeout' }])
    })
})

describe('simulateTx / simulateMany -- gecersiz tipte user / accountKeys (S7-S7-1)', () => {
    const lossSim = { context: {}, value: { err: null, fee: 5000, preBalances: [10_000_000, 2_000_000, 1], postBalances: [0, 12_000_000, 1] } }
    const objKeys = ['A', 'B', 'C'].map((k) => ({ toBase58: () => k }))

    it('user null/undefined -> unusable (ok:true "degisiklik yok" DEGIL)', async () => {
        for (const user of [null, undefined, '']) {
            const rpc = rpcOf({ simulateTransaction: lossSim })
            expect(await simulateTx({ base64Tx: TX, accountKeys: ['A', 'B', 'C'], user, rpc }))
                .toEqual({ ok: false, reason: 'unusable' })
        }
    })

    it('accountKeys PublicKey benzeri nesneler -> unusable', async () => {
        const rpc = rpcOf({ simulateTransaction: lossSim })
        expect(await simulateTx({ base64Tx: TX, accountKeys: objKeys, user: 'A', rpc }))
            .toEqual({ ok: false, reason: 'unusable' })
    })

    it('simulateMany: user null ve nesne anahtarlar -> her satir unusable', async () => {
        const rpc = rpcOf({ simulateTransaction: lossSim })
        const res = await simulateMany([{ base64Tx: TX, accountKeys: ['A', 'B', 'C'] }, { base64Tx: TX, accountKeys: objKeys }], { user: null, rpc })
        expect(res).toEqual([{ ok: false, reason: 'unusable' }, { ok: false, reason: 'unusable' }])
        const res2 = await simulateMany([{ base64Tx: TX, accountKeys: objKeys }], { user: 'A', rpc })
        expect(res2).toEqual([{ ok: false, reason: 'unusable' }])
    })
})

// SU-5: "hicbir yol firlatmaz" sozlesmesi. null arguman, seyrek dizi ve gecersiz user.
describe('simulateTx -- hicbir yol firlatmaz (SU-5)', () => {
    const lossSim = { context: {}, value: { err: null, fee: 5000, preBalances: [10_000_000, 2_000_000, 1], postBalances: [0, 12_000_000, 1] } }

    it('null / undefined / bos arguman -> unusable (TypeError ile reddedilmez), RPC cagrilmaz', async () => {
        for (const args of [null, undefined]) {
            await expect(simulateTx(args)).resolves.toEqual({ ok: false, reason: 'unusable' })
        }
        await expect(simulateTx()).resolves.toEqual({ ok: false, reason: 'unusable' })
    })

    it('gecersiz user RPC den ONCE reddedilir: simulateTransaction HIC cagrilmaz', async () => {
        for (const user of [null, undefined, '', 5, { toBase58: () => 'A' }]) {
            const rpc = rpcOf({ simulateTransaction: lossSim })
            expect(await simulateTx({ base64Tx: TX, accountKeys: ['A', 'B', 'C'], user, rpc }))
                .toEqual({ ok: false, reason: 'unusable' })
            expect(rpc).not.toHaveBeenCalled()
        }
    })

    it('seyrek (delikli) accountKeys -> unusable; delik "gecerli adres" sayilmaz', async () => {
        const seyrek = ['A', , 'C'] // eslint-disable-line no-sparse-arrays
        const rpc = rpcOf({ simulateTransaction: lossSim })
        expect(await simulateTx({ base64Tx: TX, accountKeys: seyrek, user: 'A', rpc }))
            .toEqual({ ok: false, reason: 'unusable' })
    })

    it('gecerli user + gecerli liste: davranis DEGISMEZ (RPC cagrilir, ok:true)', async () => {
        const rpc = rpcOf({ simulateTransaction: lossSim })
        const r = await simulateTx({ base64Tx: TX, accountKeys: ['A', 'B', 'C'], user: 'A', rpc })
        expect(r.ok).toBe(true)
        expect(rpc).toHaveBeenCalledTimes(1)
    })
})

// E-a: `err` alani YOKSA (saglayici bozuk yanit verdi) basari sayilmaz. Gercek RPC her zaman err:null verir.
describe('simulateTx -- err alani yoksa unusable (E-a)', () => {
    it('value.err alani HIC yok -> unusable (ok:true DEGIL), token/SOL verisi gosterilmez', async () => {
        const { err, ...errsiz } = SYSTEM_TRANSFER_SIM.value // eslint-disable-line no-unused-vars
        const rpc = rpcOf({ simulateTransaction: simResult(errsiz) })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'unusable' })
        expect(r).not.toHaveProperty('solDeltaLamports')
    })

    it('value.err acikca undefined -> unusable (JSON null tasir, undefined tasimaz)', async () => {
        const rpc = rpcOf({ simulateTransaction: simResult({ ...SYSTEM_TRANSFER_SIM.value, err: undefined }) })
        const r = await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })
        expect(r).toEqual({ ok: false, reason: 'unusable' })
    })

    it('err:null -> ok:true; err dolu -> program_error (davranis degismez)', async () => {
        const rpc = rpcOf({ simulateTransaction: SYSTEM_TRANSFER_SIM })
        expect((await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc })).ok).toBe(true)
        const hata = rpcOf({ simulateTransaction: simResult({ ...SYSTEM_TRANSFER_SIM.value, err: 'AccountNotFound' }) })
        expect(await simulateTx({ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS, user: USER, rpc: hata }))
            .toEqual({ ok: false, reason: 'program_error' })
    })

    it('simulateMany: err alani olmayan yanit satiri unusable olur', async () => {
        const { err, ...errsiz } = SYSTEM_TRANSFER_SIM.value // eslint-disable-line no-unused-vars
        const rpc = rpcOf({ simulateTransaction: simResult(errsiz) })
        const res = await simulateMany([{ base64Tx: TX, accountKeys: SYSTEM_TRANSFER_ACCOUNT_KEYS }], { user: USER, rpc })
        expect(res).toEqual([{ ok: false, reason: 'unusable' }])
    })
})
