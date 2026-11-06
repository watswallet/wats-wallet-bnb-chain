import { describe, it, expect } from 'vitest'
import { isSolanaHistoryRow, historyStatusKind, solanaSymbolLabel, isCowOrderWithoutTx, cowFeeLine } from './historyRowDisplay'

describe('isSolanaHistoryRow', () => {
    it('direction out/in/self olan satirlar Solana sayilir', () => {
        expect(isSolanaHistoryRow({ direction: 'out' })).toBe(true)
        expect(isSolanaHistoryRow({ direction: 'in' })).toBe(true)
        expect(isSolanaHistoryRow({ direction: 'self' })).toBe(true)
    })

    it('EVM satiri (receipt_status/category tasir, direction tasimaz) Solana sayilmaz', () => {
        expect(isSolanaHistoryRow({ receipt_status: '1', category: 'send' })).toBe(false)
    })

    it('bicimsiz girdi false doner, firlatmaz', () => {
        expect(isSolanaHistoryRow(null)).toBe(false)
        expect(isSolanaHistoryRow(undefined)).toBe(false)
        expect(isSolanaHistoryRow({})).toBe(false)
    })
})

describe('historyStatusKind', () => {
    // Bu grup TAM OLARAK Task 14'un uyardigi regresyonu kilitler: Solana'nin
    // basarili islemi EVM'in receipt_status sozlesmesiyle degerlendirilirse
    // "Basarisiz" gorunur.
    it('basarili Solana islemi confirmed doner (receipt_status YOK, status: success var)', () => {
        expect(historyStatusKind({ direction: 'out', status: 'success' })).toBe('confirmed')
    })

    it('basarisiz Solana islemi failed doner', () => {
        expect(historyStatusKind({ direction: 'out', status: 'failed' })).toBe('failed')
    })

    it('Solana kendine-transfer de status a gore degerlendirilir (direction ayrimi yok)', () => {
        expect(historyStatusKind({ direction: 'self', status: 'success' })).toBe('confirmed')
    })

    // review round 1, Bulgu 2: yerel bekleyen Solana kaydi (pendingSolanaTxToRow)
    // `status: 'pending'` tasir; bu, EVM'in receipt_status'una ESITLENMEDEN
    // dogru siniflandirilmali, aksi halde "Basarisiz" gibi gorunur.
    it('Solana pending (yerel bekleyen kayit) pending doner, confirmed/failed DEGIL', () => {
        expect(historyStatusKind({ direction: 'out', status: 'pending' })).toBe('pending')
    })

    it('EVM pending', () => {
        expect(historyStatusKind({ receipt_status: 'pending' })).toBe('pending')
    })

    it('EVM confirmed (receipt_status "1")', () => {
        expect(historyStatusKind({ receipt_status: '1' })).toBe('confirmed')
    })

    it('EVM failed (receipt_status "0")', () => {
        expect(historyStatusKind({ receipt_status: '0' })).toBe('failed')
    })

    it('EVM receipt_status taniIdi degilse (mevcut sablonun eski varsayilani) failed doner', () => {
        expect(historyStatusKind({ category: 'send' })).toBe('failed')
    })

    it('bos/null girdi failed doner, firlatmaz', () => {
        expect(historyStatusKind(null)).toBe('failed')
        expect(historyStatusKind(undefined)).toBe('failed')
    })
})

describe('solanaSymbolLabel', () => {
    const formatAddress = (addr) => `${addr.slice(0, 4)}...${addr.slice(-4)}`

    it('symbol varsa oldugu gibi doner (SOL)', () => {
        expect(solanaSymbolLabel({ symbol: 'SOL', mint: null }, formatAddress)).toBe('SOL')
    })

    it('symbol yoksa (SPL) mint kisaltilmis olarak doner', () => {
        const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        expect(solanaSymbolLabel({ symbol: null, mint }, formatAddress)).toBe(formatAddress(mint))
    })

    it('ne symbol ne mint varsa bos dizgi doner (undefined/"null" metni SIZDIRILMAZ)', () => {
        expect(solanaSymbolLabel({ symbol: null, mint: null }, formatAddress)).toBe('')
        expect(solanaSymbolLabel(null, formatAddress)).toBe('')
    })

    it('mint HARF KASASI KORUNARAK formatAddress e verilir', () => {
        const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        let seen = null
        solanaSymbolLabel({ symbol: null, mint }, (addr) => { seen = addr; return addr })
        expect(seen).toBe(mint)
        expect(seen).not.toBe(mint.toLowerCase())
    })
})

describe('historyStatusKind: CoW expired/cancelled (Task 25)', () => {
    it("receipt_status 'expired' ve 'cancelled' -> 'expired' (kirmizi Basarisiz DEGIL)", () => {
        expect(historyStatusKind({ receipt_status: 'expired' })).toBe('expired')
        expect(historyStatusKind({ receipt_status: 'cancelled' })).toBe('expired')
    })

    it('diger kollar DEGISMEDI', () => {
        expect(historyStatusKind({ receipt_status: '1' })).toBe('confirmed')
        expect(historyStatusKind({ receipt_status: 'pending' })).toBe('pending')
        expect(historyStatusKind({ receipt_status: '0' })).toBe('failed')
        expect(historyStatusKind({})).toBe('failed')
        expect(historyStatusKind({ receipt_status: 'x' })).toBe('failed')
        expect(historyStatusKind({ direction: 'out', status: 'success' })).toBe('confirmed')
        expect(historyStatusKind({ direction: 'out', status: 'failed' })).toBe('failed')
        expect(historyStatusKind({ direction: 'out', status: 'pending' })).toBe('pending')
    })
})

describe('isCowOrderWithoutTx', () => {
    it('cow + pending/expired true, fulfilled false, source yok false', () => {
        expect(isCowOrderWithoutTx({ source: 'cow', receipt_status: 'pending' })).toBe(true)
        expect(isCowOrderWithoutTx({ source: 'cow', receipt_status: 'expired' })).toBe(true)
        expect(isCowOrderWithoutTx({ source: 'cow', receipt_status: '1' })).toBe(false)
        expect(isCowOrderWithoutTx({ receipt_status: 'pending' })).toBe(false)
        expect(isCowOrderWithoutTx(null)).toBe(false)
    })
})

describe('cowFeeLine (Faz 3 Task 15)', () => {
    const UID = '0x' + 'a1'.repeat(56)
    const tx = (extra = {}) => ({ source: 'cow', cow_uid: UID, receipt_status: '1', ...extra })
    const view = (state, refund = { state: 'none' }) => ({ uid: UID, state, refund })
    const fmt = (raw) => 'F' + raw
    const line = (t, v) => cowFeeLine(t, v ? { [UID]: v } : {}, { format: fmt })

    it('paid + claimable/claiming/approved -> paidPending', () => {
        for (const st of ['claimable', 'claiming', 'approved']) {
            expect(line(tx(), view('paid', { state: st })).key).toBe('stockTrade.atsFee.state.paidPending')
        }
    })
    it('paid + sent -> refundSent, tutar bicimli', () => {
        const r = line(tx(), view('paid', { state: 'sent', atsRaw: '31' }))
        expect(r.key).toBe('stockTrade.atsFee.state.refundSent')
        expect(r.params).toEqual({ amount: 'F31' })
        expect(r.tone).toBe('ok')
    })
    it('paid + rejected -> refundRejected + kisa kod', () => {
        const r = line(tx(), view('paid', { state: 'rejected', code: 'NO_FUNDS' }))
        expect(r.key).toBe('stockTrade.atsFee.state.refundRejected')
        expect(r.params).toEqual({ code: 'NO_FUNDS' })
    })
    it('owed ve sending -> paying', () => {
        expect(line(tx(), view('owed')).key).toBe('stockTrade.atsFee.state.paying')
        expect(line(tx(), view('sending')).key).toBe('stockTrade.atsFee.state.paying')
    })
    it('void / none -> null', () => {
        expect(line(tx(), view('void'))).toBeNull()
        expect(line(tx(), view('idle'))).toBeNull()
        expect(line(tx(), view(null))).toBeNull()
    })
    it('expired / cancelled satirda null (ATS alinmadi)', () => {
        expect(line(tx({ receipt_status: 'expired' }), view('owed'))).toBeNull()
        expect(line(tx({ receipt_status: 'cancelled' }), view('owed'))).toBeNull()
    })
    it('CoW olmayan satir -> null', () => {
        expect(line(tx({ source: undefined }), view('owed'))).toBeNull()
    })
    it('cow_uid haritada yok / yok / bos harita -> null', () => {
        expect(line(tx(), null)).toBeNull()
        expect(cowFeeLine(tx({ cow_uid: undefined }), { [UID]: view('owed') }, {})).toBeNull()
        expect(cowFeeLine(tx(), null, {})).toBeNull()
        expect(cowFeeLine(null, {}, {})).toBeNull()
    })
})
