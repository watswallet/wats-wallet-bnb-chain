import { describe, it, expect } from 'vitest'
import {
    isResolved,
    isExpired,
    isStillPending,
    prunePendingTransactions,
    PENDING_MAX_AGE_MS,
    hasUnsettledOutgoing
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

// CoW (xStocks Al/Sat) emirleri 'expired' ve 'cancelled' durumlarina gecer; bu durumlar bugune dek testsizdi.
// Cozulmus sayilmazlarsa bekleyen emrin tutari golge bakiyeden sonsuza dek (24 saate dek) dusulurdu.
describe('CoW durumlari', () => {
    it("'expired' ve 'cancelled' isResolved true", () => {
        expect(isResolved(pendingTx({ receipt_status: 'expired' }))).toBe(true)
        expect(isResolved(pendingTx({ receipt_status: 'cancelled' }))).toBe(true)
    })

    it("'expired' ve 'cancelled' isStillPending false (taze kayit olsa bile)", () => {
        expect(isStillPending(pendingTx({ receipt_status: 'expired' }), NOW)).toBe(false)
        expect(isStillPending(pendingTx({ receipt_status: 'cancelled' }), NOW)).toBe(false)
    })

    it('prunePendingTransactions bu kayitlari eler, bekleyen komsuyu tutar', () => {
        const bekleyen = pendingTx({ hash: '0xb' })
        const list = [
            pendingTx({ hash: '0xe', receipt_status: 'expired' }),
            bekleyen,
            pendingTx({ hash: '0xc', receipt_status: 'cancelled' })
        ]
        expect(prunePendingTransactions(list, NOW)).toEqual([bekleyen])
    })
})

describe('hasUnsettledOutgoing - bekleyen islem varken Max bayat bakiyeden hesaplanmaz', () => {
    const N = 1_000_000_000_000
    const card = (o = {}) => ({
        id: 'c1', status: 'processing', timestamp: N - 1000, accountKey: 'A',
        meta: { chainId: 56, txHash: '0xats', ats: true }, ...o,
    })
    const q = (cards, extra = {}) => hasUnsettledOutgoing(cards, { accountKey: 'A', chainId: 56, pendingHashes: [], now: N, ...extra })

    it('hash li processing kart (ATS: pending_transactions yazmaz) bayat sayilir', () => {
        expect(q([card()])).toBe(true)
    })
    it('golge bakiyede ZATEN dusulmus (pending_transactions hash i ayni) kart bayat saymaz', () => {
        expect(q([card()], { pendingHashes: ['0xATS'] })).toBe(false)
    })
    it('hash siz, success/error, baska zincir, baska hesap, 24 saatten eski kart saymaz', () => {
        expect(q([card({ meta: { chainId: 56 } })])).toBe(false)
        expect(q([card({ status: 'success' }), card({ status: 'error' })])).toBe(false)
        expect(q([card({ meta: { chainId: 1, txHash: '0x1' } })])).toBe(false)
        expect(q([card({ accountKey: 'PRIV' })])).toBe(false)
        expect(q([card({ timestamp: N - PENDING_MAX_AGE_MS - 1 })])).toBe(false)
    })
    it('bozuk girdi cokmez', () => {
        expect(q(null)).toBe(false)
        expect(q([null, {}])).toBe(false)
    })
})
