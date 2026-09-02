import { describe, it, expect } from 'vitest'
import { isSolanaHistoryRow, historyStatusKind, solanaSymbolLabel } from './historyRowDisplay'

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
