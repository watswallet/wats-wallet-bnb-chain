import { describe, it, expect } from 'vitest'
import {
    isResolved,
    isExpired,
    isStillPending,
    prunePendingTransactions,
    PENDING_MAX_AGE_MS
} from './pendingTransactions'

const NOW = Date.parse('2026-07-31T12:00:00.000Z')
const minutesAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString()

const pendingTx = (overrides = {}) => ({
    hash: '0xabc',
    receipt_status: 'pending',
    block_timestamp: minutesAgo(1),
    from_address: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    value: '1000000000000000000',
    ...overrides
})

describe('isResolved', () => {
    it("receipt_status 'pending' ise cozulmemistir", () => {
        expect(isResolved(pendingTx())).toBe(false)
    })

    it("receipt_status '1' (basarili) cozulmustur", () => {
        expect(isResolved(pendingTx({ receipt_status: '1' }))).toBe(true)
    })

    it("receipt_status '0' (revert) da cozulmustur - zincir bakiyeye yansitti", () => {
        expect(isResolved(pendingTx({ receipt_status: '0' }))).toBe(true)
    })
})

describe('isExpired', () => {
    it('24 saatten yeni kayit eskimemistir', () => {
        expect(isExpired(pendingTx({ block_timestamp: minutesAgo(23 * 60) }), NOW)).toBe(false)
    })

    it('24 saatten eski kayit eskimistir', () => {
        expect(isExpired(pendingTx({ block_timestamp: minutesAgo(25 * 60) }), NOW)).toBe(true)
    })

    it('zaman damgasi yoksa eskimis sayilmaz (temkinli taraf)', () => {
        expect(isExpired(pendingTx({ block_timestamp: undefined }), NOW)).toBe(false)
    })

    it('bozuk zaman damgasi eskimis sayilmaz', () => {
        expect(isExpired(pendingTx({ block_timestamp: 'not-a-date' }), NOW)).toBe(false)
    })

    it('sinir degeri tam 24 saat henuz eskimemistir', () => {
        expect(isExpired(pendingTx({ block_timestamp: new Date(NOW - PENDING_MAX_AGE_MS).toISOString() }), NOW)).toBe(false)
    })
})

describe('isStillPending', () => {
    it('yeni ve cozulmemis kayit bekliyordur', () => {
        expect(isStillPending(pendingTx(), NOW)).toBe(true)
    })

    it('#8/#15: kurtarma ile onaylanan kayit ARTIK bekliyor sayilmaz', () => {
        // background.checkAndRecoverPendingTxs bu kaydi '1' yapip listede birakiyordu;
        // golge bakiye onu sonsuza dek dusmeye devam ediyordu.
        const recovered = pendingTx({ receipt_status: '1', transaction_fee: '0.0012' })
        expect(isStillPending(recovered, NOW)).toBe(false)
    })

    it("zincir kimligi bulunamadigi icin sonsuza dek 'pending' kalan kayit 24 saat sonra dusulmez", () => {
        const stuck = pendingTx({ block_timestamp: minutesAgo(48 * 60) })
        expect(isStillPending(stuck, NOW)).toBe(false)
    })
})

describe('prunePendingTransactions', () => {
    it('yalnizca gercekten bekleyenleri birakir', () => {
        const list = [
            pendingTx({ hash: '0x1' }),
            pendingTx({ hash: '0x2', receipt_status: '1' }),
            pendingTx({ hash: '0x3', receipt_status: '0' }),
            pendingTx({ hash: '0x4', block_timestamp: minutesAgo(48 * 60) })
        ]

        expect(prunePendingTransactions(list, NOW).map(t => t.hash)).toEqual(['0x1'])
    })

    it('bekleyen kayitlarin sirasi ve icerigi korunur', () => {
        const list = [pendingTx({ hash: '0xa' }), pendingTx({ hash: '0xb' })]
        expect(prunePendingTransactions(list, NOW)).toEqual(list)
    })

    it('dizi olmayan girdide bos dizi doner', () => {
        expect(prunePendingTransactions(undefined, NOW)).toEqual([])
        expect(prunePendingTransactions(null, NOW)).toEqual([])
    })
})
