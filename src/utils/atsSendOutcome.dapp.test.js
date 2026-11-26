// Dapp onay yolu + CoW kart karari + kurtarma: belirsiz sonuc 'basarisiz' DEGILDIR (davranis testleri).
import { describe, it, expect } from 'vitest'
import { dappSendOutcome, atsFailureCard } from './atsSendOutcome'
import { recoverStuckCards } from './pendingRecovery'

describe('dappSendOutcome', () => {
  it('belirsiz yanit (unverified) hata DEGIL: beklemede', () => {
    expect(dappSendOutcome({ success: false, unverified: true }).kind).toBe('pending')
  })
  it('belirsiz yanit txHash tasiyorsa zincirdeki hash dapp sonucu olur', () => {
    expect(dappSendOutcome({ success: false, unverified: true, txHash: '0xh' })).toEqual({ kind: 'success', hash: '0xh' })
  })
  it('kesin hata ve hash yok -> error', () => {
    expect(dappSendOutcome({ success: false, error: 'x' }).kind).toBe('error')
    expect(dappSendOutcome({ success: true }).kind).toBe('error')
    expect(dappSendOutcome(undefined).kind).toBe('error')
  })
  it('txHash hash/signature oncesi secilir', () => {
    expect(dappSendOutcome({ success: true, txHash: '0xt', hash: '0xu' })).toEqual({ kind: 'success', hash: '0xt' })
  })
})

describe('atsFailureCard (CoW)', () => {
  it('belirsiz sonuc processing kalir, userOpHash/txHash tasir', () => {
    expect(atsFailureCard({ opSuccess: null, userOpHash: '0xuo' })).toEqual({ status: 'processing', extra: { userOpHash: '0xuo' } })
  })
  it('kesin revert ve hashsiz hata error', () => {
    expect(atsFailureCard({ opSuccess: false })).toEqual({ status: 'error' })
    expect(atsFailureCard(new Error('x'))).toEqual({ status: 'error' })
  })
})

describe('pendingRecovery: yalniz userOpHash tasiyan ats karti', () => {
  const mk = (card, now) => {
    let list = [card]
    return recoverStuckCards({
      activeIsPrivate: async () => false, supportedChains: [], providerFactory: () => ({}),
      getAtsConfig: () => null, extractUserOpSuccess: () => null, now: () => now,
      readCards: async () => list, mutateCards: async (fn) => { fn(list) },
    }).then(() => list[0])
  }
  const base = { id: 1, status: 'processing', timestamp: 0, meta: { chainId: 56, ats: true, userOpHash: '0xuo' } }
  it('5 dk sonra error OLMAZ', async () => {
    expect((await mk(structuredClone(base), 10 * 60 * 1000)).status).toBe('processing')
  })
  it('24 saat sonra sonlanir', async () => {
    expect((await mk(structuredClone(base), 25 * 3600 * 1000)).status).toBe('error')
  })
  it('hicbir hash yoksa 5 dk kurali korunur', async () => {
    const c = structuredClone(base); delete c.meta.userOpHash
    expect((await mk(c, 10 * 60 * 1000)).status).toBe('error')
  })
})
