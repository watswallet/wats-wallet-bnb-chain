import { describe, it, expect } from 'vitest'
import { sendCatchOutcome } from './sendCatchOutcome'

describe('sendCatchOutcome', () => {
    it('yayin yapildiysa hicbir hata asla failed olmaz', () => {
        for (const err of [new Error('x'), { code: 'NETWORK_ERROR' }, { code: 'INSUFFICIENT_FUNDS' }, null]) {
            const o = sendCatchOutcome(err, true)
            expect(o.kind).toBe('sent')
            expect(o.key).toBeNull()
        }
    })
    it('ag hatasi + yayin yok -> belirsiz (statusUnknown), basarisiz degil', () => {
        const o = sendCatchOutcome({ code: 'NETWORK_ERROR' }, false, true)
        expect(o.kind).toBe('unknown')
        expect(o.key).toBe('send.errors.network')
    })
    it('yetersiz bakiye txFailed degil yetersiz bakiye anahtari', () => {
        const o = sendCatchOutcome({ code: 'INSUFFICIENT_FUNDS' }, false)
        expect(o).toEqual({ kind: 'failed', key: 'send.insufficientBalance' })
    })
    it('digerleri txFailed', () => {
        expect(sendCatchOutcome(new Error('boom'), false))
            .toEqual({ kind: 'failed', key: 'send.confirmTransaction.txFailed' })
    })
    it('yayin BASLAMADAN gelen ag hatasi belirsiz degil: kesin red', () => {
        expect(sendCatchOutcome({ code: 'NETWORK_ERROR' }, false, false))
            .toEqual({ kind: 'failed', key: 'send.confirmTransaction.txFailed' })
        expect(sendCatchOutcome(new Error('timeout'), false))
            .toEqual({ kind: 'failed', key: 'send.confirmTransaction.txFailed' })
    })
})
