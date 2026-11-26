// pendingRecovery: SW yeniden basladiginda hash'li 'processing' kartlari zincirden cozer (G3a: davranis tasindi).
import { describe, it, expect, vi } from 'vitest'
import { recoverStuckCards } from './pendingRecovery'

const CHAIN = { chainId: 56, rpc: [{ url: 'http://rpc' }] }

function kur({ cards, makbuz = null, ozel = false, ozelKey = 'PRIV', opSuccess = null } = {}) {
  const depo = { cards: cards.map((c) => JSON.parse(JSON.stringify(c))) }
  const receiptCagri = vi.fn(async () => makbuz)
  const deps = {
    activeIsPrivate: vi.fn(async () => ozel),
    supportedChains: [CHAIN],
    providerFactory: vi.fn(() => ({ getTransactionReceipt: receiptCagri })),
    now: () => 1_000_000_000_000,
    privateAccountKey: vi.fn(async () => ozelKey),
    getAtsConfig: vi.fn(() => ({ entryPoint: '0xEP' })),
    extractUserOpSuccess: vi.fn(() => opSuccess),
    readCards: vi.fn(async () => depo.cards),
    mutateCards: vi.fn(async (fn) => { const n = await fn(depo.cards); if (n !== undefined) depo.cards = n }),
  }
  return { depo, deps, receiptCagri }
}
const kart = (o = {}) => ({ id: 'a', status: 'processing', timestamp: 1_000_000_000_000 - 1000, meta: { txHash: '0xh', chainId: 56 }, ...o })

describe('recoverStuckCards (G3a)', () => {
  it('hash li processing + makbuz status 1 -> success', async () => {
    const { depo, deps } = kur({ cards: [kart()], makbuz: { status: 1 } })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('success')
  })
  it('hash li processing + makbuz status 0 -> error', async () => {
    const { depo, deps } = kur({ cards: [kart()], makbuz: { status: 0 } })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('error')
  })
  it('makbuz yok -> kart degismez', async () => {
    const { depo, deps } = kur({ cards: [kart()], makbuz: null })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('processing')
  })
  it('gizli modda (activeIsPrivate true) HIC RPC cagrilmaz, kart degismez', async () => {
    const { depo, deps, receiptCagri } = kur({ cards: [kart()], makbuz: { status: 1 }, ozel: true })
    await recoverStuckCards(deps)
    expect(deps.providerFactory).not.toHaveBeenCalled()
    expect(receiptCagri).not.toHaveBeenCalled()
    expect(depo.cards[0].status).toBe('processing')
  })
})

const DK = 60 * 1000
const SAAT = 60 * DK
const yas = (ms) => 1_000_000_000_000 - ms

describe('recoverStuckCards (G3): yas siniri', () => {
  it('hash siz queued 5 dk dan eskiyse error, daha yeniyse dokunulmaz', async () => {
    const { depo, deps } = kur({ cards: [
      { id: 'q1', status: 'queued', timestamp: yas(6 * DK), meta: {} },
      { id: 'q2', status: 'queued', timestamp: yas(4 * DK), meta: {} },
    ] })
    await recoverStuckCards(deps)
    expect(depo.cards.find((c) => c.id === 'q1').status).toBe('error')
    expect(depo.cards.find((c) => c.id === 'q2').status).toBe('queued')
  })
  it('hash siz processing 5 dk dan eskiyse error, daha yeniyse dokunulmaz', async () => {
    const { depo, deps, receiptCagri } = kur({ cards: [
      { id: 'p1', status: 'processing', timestamp: yas(6 * DK), meta: { chainId: 56 } },
      { id: 'p2', status: 'processing', timestamp: yas(1 * DK), meta: { chainId: 56 } },
    ] })
    await recoverStuckCards(deps)
    expect(depo.cards.find((c) => c.id === 'p1').status).toBe('error')
    expect(depo.cards.find((c) => c.id === 'p1').meta.errorCode).toBe('TX_DROPPED')
    expect(depo.cards.find((c) => c.id === 'p2').status).toBe('processing')
    expect(receiptCagri).not.toHaveBeenCalled()
  })
  it('hash li kart 5 dk yasini asinca error OLMAZ (yalniz hash siz kartlar icin)', async () => {
    const { depo, deps } = kur({ cards: [kart({ timestamp: yas(10 * DK) })], makbuz: null })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('processing')
  })
  it('hash li kart makbuzsuz 24 saati asinca error olur', async () => {
    const { depo, deps } = kur({ cards: [kart({ timestamp: yas(25 * SAAT) })], makbuz: null })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('error')
  })
})

describe('recoverStuckCards (G3): ATS kartlari userOp olayiyla cozulur', () => {
  const atsKart = () => kart({ meta: { txHash: '0xh', chainId: 56, ats: true, userOpHash: '0xuo' } })
  it('TX status 1 ama userOp olayi false -> error', async () => {
    const { depo, deps } = kur({ cards: [atsKart()], makbuz: { status: 1 }, opSuccess: false })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('error')
    expect(deps.extractUserOpSuccess).toHaveBeenCalledWith({ status: 1 }, '0xEP', '0xuo')
  })
  it('userOp olayi true -> success', async () => {
    const { depo, deps } = kur({ cards: [atsKart()], makbuz: { status: 1 }, opSuccess: true })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('success')
  })
  it('olay yok (null) -> processing KALIR, success ASLA yazilmaz', async () => {
    const { depo, deps } = kur({ cards: [atsKart()], makbuz: { status: 1 }, opSuccess: null })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('processing')
  })
  it('TX status 0 -> error', async () => {
    const { depo, deps } = kur({ cards: [atsKart()], makbuz: { status: 0 }, opSuccess: true })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('error')
  })
  it('ats:true ama userOpHash yok -> dogrulanamaz, processing KALIR (success yazilmaz)', async () => {
    const { depo, deps } = kur({ cards: [kart({ meta: { txHash: '0xh', chainId: 56, ats: true } })], makbuz: { status: 1 }, opSuccess: true })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('processing')
    expect(deps.extractUserOpSuccess).not.toHaveBeenCalled()
  })
  it('ats isareti olmayan eski kart TX makbuzuyla cozulur (K9)', async () => {
    const { depo, deps } = kur({ cards: [kart()], makbuz: { status: 1 }, opSuccess: false })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('success')
    expect(deps.extractUserOpSuccess).not.toHaveBeenCalled()
  })
})

describe('recoverStuckCards (G3 / K11 degisti): gizli hesap kartlari', () => {
  const gizliKart = (o = {}) => kart({ accountKey: 'PRIV', ...o })
  it('gizli hesabin hash li karti normal modda RPC ye GITMEZ ve processing KALIR (5 dk dan sonra da)', async () => {
    const { depo, deps, receiptCagri } = kur({ cards: [gizliKart({ timestamp: yas(10 * DK) })], makbuz: { status: 0 } })
    await recoverStuckCards(deps)
    expect(deps.providerFactory).not.toHaveBeenCalled()
    expect(receiptCagri).not.toHaveBeenCalled()
    expect(depo.cards[0].status).toBe('processing')
  })
  it('gizli hesabin hash li karti yalniz 24 saat siniriyla error olur (RPC siz)', async () => {
    const { depo, deps, receiptCagri } = kur({ cards: [gizliKart({ timestamp: yas(25 * SAAT) })], makbuz: { status: 1 } })
    await recoverStuckCards(deps)
    expect(receiptCagri).not.toHaveBeenCalled()
    expect(depo.cards[0].status).toBe('error')
  })
  it('gizli hesabin hash siz karti 5 dk sonra RPC siz error olur', async () => {
    const { depo, deps, receiptCagri } = kur({ cards: [{ id: 'g', status: 'queued', accountKey: 'PRIV', timestamp: yas(6 * DK), meta: {} }] })
    await recoverStuckCards(deps)
    expect(receiptCagri).not.toHaveBeenCalled()
    expect(depo.cards[0].status).toBe('error')
  })
  it('normal hesabin karti (baska accountKey) sorgulanir', async () => {
    const { depo, deps } = kur({ cards: [kart({ accountKey: 'NORMAL' })], makbuz: { status: 1 } })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('success')
  })
  it('gizli modda (activeIsPrivate true) yas siniri da dahil kart DEGISMEZ', async () => {
    const { depo, deps } = kur({ cards: [{ id: 'q', status: 'queued', timestamp: yas(9 * DK), meta: {} }], ozel: true })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('queued')
    expect(deps.readCards).not.toHaveBeenCalled()
  })
})

describe('recoverStuckCards (inceleme bulgulari): 24 saat siniri her dalda', () => {
  it('makbuz sorgusu hata firlatirsa 24 saati asan hash li kart error olur, daha yenisine dokunulmaz', async () => {
    const { depo, deps } = kur({ cards: [kart({ id: 'e1', timestamp: yas(25 * SAAT) }), kart({ id: 'e2', timestamp: yas(2 * SAAT) })] })
    deps.providerFactory = vi.fn(() => ({ getTransactionReceipt: vi.fn(async () => { throw new Error('unsupported') }) }))
    await recoverStuckCards(deps)
    expect(depo.cards.find((c) => c.id === 'e1').status).toBe('error')
    expect(depo.cards.find((c) => c.id === 'e2').status).toBe('processing')
  })
  it('zincir desteklenenlerde yoksa 24 saati asan hash li kart error olur, yenisine dokunulmaz', async () => {
    const { depo, deps } = kur({ cards: [
      kart({ id: 'z1', timestamp: yas(25 * SAAT), meta: { txHash: '0xh', chainId: 999 } }),
      kart({ id: 'z2', timestamp: yas(2 * SAAT), meta: { txHash: '0xh', chainId: 999 } }),
    ] })
    await recoverStuckCards(deps)
    expect(depo.cards.find((c) => c.id === 'z1').status).toBe('error')
    expect(depo.cards.find((c) => c.id === 'z2').status).toBe('processing')
  })
  it('hash siz karar uygulanirken canli akis hash yazmissa hash li karta TX_DROPPED yazilmaz', async () => {
    const { depo, deps } = kur({ cards: [{ id: 'r', status: 'processing', timestamp: yas(6 * DK), meta: { chainId: 56 } }] })
    const asil = deps.mutateCards
    deps.mutateCards = vi.fn(async (fn) => {
      depo.cards[0].meta = { chainId: 56, txHash: '0xyeni' } // yaris: snapshot'tan sonra hash yazildi
      return asil(fn)
    })
    await recoverStuckCards(deps)
    expect(depo.cards[0].status).toBe('processing')
  })
  it('userOpHash == txHash (userOp hash i, TX hash i degil) kart makbuzla cozulemez: 24 saatte bile error yazilmaz', async () => {
    const { depo, deps, receiptCagri } = kur({ cards: [kart({ timestamp: yas(25 * SAAT), meta: { txHash: '0xuo', chainId: 56, ats: true, userOpHash: '0xuo' } })] })
    await recoverStuckCards(deps)
    expect(receiptCagri).not.toHaveBeenCalled()
    expect(depo.cards[0].status).toBe('processing')
  })
})
