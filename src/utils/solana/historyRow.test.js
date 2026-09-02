import { describe, it, expect } from 'vitest'
import { toHistoryRow } from './historyRow'

const ME = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const OTHER = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

const transfer = (from, to, lamports = 1_000_000_000) => ({
    signature: 'SIG1',
    timestamp: 1_700_000_000,
    type: 'TRANSFER',
    nativeTransfers: [{ fromUserAccount: from, toUserAccount: to, amount: lamports }],
    tokenTransfers: [],
    transactionError: null,
})

describe('toHistoryRow', () => {
    it('giden SOL transferi', () => {
        const row = toHistoryRow(transfer(ME, OTHER), ME)
        expect(row).toMatchObject({
            hash: 'SIG1', direction: 'out', counterparty: OTHER, amount: 1, symbol: 'SOL', status: 'success'
        })
    })

    it('gelen SOL transferi', () => {
        const row = toHistoryRow(transfer(OTHER, ME), ME)
        expect(row).toMatchObject({ direction: 'in', counterparty: OTHER, amount: 1 })
    })

    it('SPL transferi mint ve sembolle', () => {
        const raw = {
            signature: 'SIG2', timestamp: 1_700_000_000, type: 'TRANSFER',
            nativeTransfers: [],
            tokenTransfers: [{
                fromUserAccount: ME, toUserAccount: OTHER,
                mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                tokenAmount: 25.5,
            }],
            transactionError: null,
        }
        const row = toHistoryRow(raw, ME)
        expect(row).toMatchObject({ direction: 'out', amount: 25.5, counterparty: OTHER })
    })

    // Basarisiz islem de gecmiste GORUNMELI: ucret odenmistir ve kullanici
    // gonderiminin neden gerceklesmedigini bilmelidir.
    it('basarisiz islem status: failed ile doner', () => {
        const raw = { ...transfer(ME, OTHER), transactionError: { InstructionError: [0, 'Custom'] } }
        expect(toHistoryRow(raw, ME).status).toBe('failed')
    })

    // Adres HARF KASASI KORUNARAK dondurulur: kucultulen bir base58 adres
    // zehirli adres tespitinde BASKA bir adres olur.
    it('karsi taraf adresi kucultulmez', () => {
        const row = toHistoryRow(transfer(ME, OTHER), ME)
        expect(row.counterparty).toBe(OTHER)
        expect(row.counterparty).not.toBe(OTHER.toLowerCase())
    })

    // Transferi olmayan islemler (oy, program cagrisi) LISTEDEN DUSURULUR:
    // kullaniciya anlam ifade etmeyen yuzlerce satir gosterilirse gercek
    // gonderiler kaybolur.
    it('transfer icermeyen islem null doner', () => {
        const raw = { signature: 'SIG3', timestamp: 1, type: 'UNKNOWN', nativeTransfers: [], tokenTransfers: [] }
        expect(toHistoryRow(raw, ME)).toBe(null)
    })

    it('bicimsiz kayit null doner', () => {
        expect(toHistoryRow(null, ME)).toBe(null)
        expect(toHistoryRow({}, ME)).toBe(null)
        expect(toHistoryRow(transfer(ME, OTHER), null)).toBe(null)
    })

    // Kendine transfer (ATA acma gibi) ne giden ne gelen: yon belirlenemezse
    // kullaniciya yanlis ok gosterilmemeli.
    it('kendine transfer self olarak isaretlenir', () => {
        expect(toHistoryRow(transfer(ME, ME), ME).direction).toBe('self')
    })
})
