import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createQuoteController, useCowQuote } from './useCowQuote'

const MSG = { side: 'buy', chainId: 1, stockAddress: '0x1', payToken: '0x2', amount: '10' }
const NOW = 1_800_000_000_000

const readyRes = (over = {}) => ({
  success: true, locked: false, lockReason: null, quoteId: 'q1', expiresAt: NOW + 30_000, approveUntil: NOW + 300_000, display: {}, ...over,
})

function setup(extra = {}) {
  const send = vi.fn(async () => readyRes())
  const changes = []
  const ctrl = createQuoteController({ send, now: () => Date.now(), onChange: (s) => changes.push(s), ...extra })
  return { send, ctrl, changes }
}

describe('createQuoteController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ilk durum idle; request hemen loading, debounce sonra TEK send', async () => {
    const { send, ctrl } = setup()
    expect(ctrl.snapshot().state).toBe('idle')
    ctrl.request(MSG)
    expect(ctrl.snapshot().state).toBe('loading')
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(599)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(ctrl.snapshot().state).toBe('ready')
    ctrl.dispose()
  })

  it('uc hizli request -> tek send, govde son deger', async () => {
    const { send, ctrl } = setup()
    ctrl.request({ ...MSG, amount: '1' })
    await vi.advanceTimersByTimeAsync(100)
    ctrl.request({ ...MSG, amount: '12' })
    await vi.advanceTimersByTimeAsync(100)
    ctrl.request({ ...MSG, amount: '123' })
    await vi.advanceTimersByTimeAsync(600)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].amount).toBe('123')
    ctrl.dispose()
  })

  it('bayat yanit atilir: ilk yanit ikinciden SONRA gelirse', async () => {
    const resolvers = []
    const send = vi.fn(() => new Promise((r) => resolvers.push(r)))
    const { ctrl } = setup({ send })
    ctrl.request({ ...MSG, amount: '1' })
    await vi.advanceTimersByTimeAsync(600)
    ctrl.request({ ...MSG, amount: '2' })
    await vi.advanceTimersByTimeAsync(600)
    expect(send).toHaveBeenCalledTimes(2)
    resolvers[1](readyRes({ quoteId: 'yeni' }))
    await vi.advanceTimersByTimeAsync(0)
    resolvers[0](readyRes({ quoteId: 'eski' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(ctrl.snapshot().quoteId).toBe('yeni')
    ctrl.dispose()
  })

  it('ilk yanit gec gelip ikincisi hala beklerken eski yanit gosterilmez', async () => {
    const resolvers = []
    const send = vi.fn(() => new Promise((r) => resolvers.push(r)))
    const { ctrl } = setup({ send })
    ctrl.request({ ...MSG, amount: '1' })
    await vi.advanceTimersByTimeAsync(600)
    ctrl.request({ ...MSG, amount: '2' })
    resolvers[0](readyRes({ quoteId: 'eski' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(ctrl.snapshot().state).toBe('loading')
    expect(ctrl.snapshot().quoteId).toBeNull()
    ctrl.dispose()
  })

  it('invalidate sonrasi gelen yanit atilir', async () => {
    let resolve
    const send = vi.fn(() => new Promise((r) => { resolve = r }))
    const { ctrl } = setup({ send })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    ctrl.invalidate()
    resolve(readyRes())
    await vi.advanceTimersByTimeAsync(0)
    expect(ctrl.snapshot()).toMatchObject({ state: 'idle', result: null, quoteId: null })
    ctrl.dispose()
  })

  it('dispose sonrasi gelen yanit atilir', async () => {
    let resolve
    const send = vi.fn(() => new Promise((r) => { resolve = r }))
    const { ctrl, changes } = setup({ send })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    ctrl.dispose()
    const n = changes.length
    resolve(readyRes())
    await vi.advanceTimersByTimeAsync(0)
    expect(changes.length).toBe(n)
    expect(ctrl.snapshot().state).toBe('loading')
  })

  it('request(null) -> idle, send yok', async () => {
    const { send, ctrl } = setup()
    ctrl.request(MSG)
    ctrl.request(null)
    expect(ctrl.snapshot().state).toBe('idle')
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).not.toHaveBeenCalled()
    ctrl.dispose()
  })

  describe('INSUFFICIENT_BALANCE sayisal alanlari (errorInfo)', () => {
    const YETERSIZ = (over = {}) => ({ success: false, code: 'INSUFFICIENT_BALANCE', requiredAtoms: '2500000', availableAtoms: '1000000', decimals: 6, ...over })
    const run = async (res) => {
      const { ctrl, send } = setup()
      send.mockResolvedValueOnce(res)
      ctrl.request(MSG)
      await vi.advanceTimersByTimeAsync(600)
      const snap = ctrl.snapshot()
      ctrl.dispose()
      return snap
    }

    it('gecerli alanlar errorInfo olur', async () => {
      const snap = await run(YETERSIZ())
      expect(snap).toMatchObject({ state: 'error', errorCode: 'INSUFFICIENT_BALANCE' })
      expect(snap.errorInfo).toEqual({ requiredAtoms: '2500000', availableAtoms: '1000000', decimals: 6 })
    })

    it('bozuk alan -> errorInfo null (genel metin)', async () => {
      for (const over of [
        { requiredAtoms: 'x' }, { availableAtoms: '-1' }, { availableAtoms: 5 }, { decimals: 6.5 }, { decimals: -1 },
        { decimals: 99 }, { requiredAtoms: undefined }, { requiredAtoms: '9'.repeat(80) },
      ]) {
        const snap = await run(YETERSIZ(over))
        expect(snap).toMatchObject({ state: 'error', errorCode: 'INSUFFICIENT_BALANCE' })
        expect(snap.errorInfo).toBeNull()
      }
    })
  })

  describe('AMOUNT_TOO_SMALL sayisal alanlari (errorInfo)', () => {
    const KUCUK = (over = {}) => ({
      success: false, code: 'AMOUNT_TOO_SMALL', feeAtoms: '1407872', feeDisplay: '1.41', feeUsd: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19', ...over,
    })
    const run = async (res) => {
      const { ctrl, send } = setup()
      send.mockResolvedValueOnce(res)
      ctrl.request(MSG)
      await vi.advanceTimersByTimeAsync(600)
      const snap = ctrl.snapshot()
      ctrl.dispose()
      return snap
    }

    it('gecerli alanlar errorInfo olur (yalniz gosterim alanlari)', async () => {
      const snap = await run(KUCUK())
      expect(snap).toMatchObject({ state: 'error', errorCode: 'AMOUNT_TOO_SMALL' })
      expect(snap.errorInfo).toEqual({ feeDisplay: '1.41', feeUsd: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19' })
    })

    it('feeUsd yoksa ya da gecersizse alan yok, kalanlar var', async () => {
      const a = await run(KUCUK({ feeUsd: undefined }))
      expect(a.errorInfo).toEqual({ feeDisplay: '1.41', minAmountDisplay: '1.69', missingDisplay: '1.19' })
      const b = await run(KUCUK({ feeUsd: '<b>1</b>' }))
      expect('feeUsd' in b.errorInfo).toBe(false)
    })

    it('zorunlu alan gecersiz / eksik / tip yanlis -> errorInfo null (genel metin)', async () => {
      for (const over of [
        { feeDisplay: undefined }, { minAmountDisplay: '' }, { missingDisplay: '-1' }, { missingDisplay: 5 },
        { feeDisplay: '1,41' }, { minAmountDisplay: '1.69 USDC' }, { minAmountDisplay: { x: 1 } }, { feeAtoms: 'x' },
        { minAmountDisplay: '9'.repeat(41) },
      ]) {
        const snap = await run(KUCUK(over))
        expect(snap).toMatchObject({ state: 'error', errorCode: 'AMOUNT_TOO_SMALL' })
        expect(snap.errorInfo).toBeNull()
      }
    })

    it('baska hata kodunda sayisal alanlar gecse bile errorInfo null; ham alan sizmaz', async () => {
      const snap = await run(KUCUK({ code: 'NO_LIQUIDITY', gizli: 'SIR' }))
      expect(snap.errorInfo).toBeNull()
      expect(JSON.stringify(await run(KUCUK({ gizli: 'SIR' })))).not.toContain('SIR')
    })

    it('sonraki basarili teklifte errorInfo temizlenir', async () => {
      const { ctrl, send } = setup()
      send.mockResolvedValueOnce(KUCUK())
      ctrl.request(MSG)
      await vi.advanceTimersByTimeAsync(600)
      expect(ctrl.snapshot().errorInfo).not.toBeNull()
      ctrl.request({ ...MSG, amount: '100' })
      await vi.advanceTimersByTimeAsync(600)
      expect(ctrl.snapshot()).toMatchObject({ state: 'ready', errorInfo: null })
      ctrl.dispose()
    })
  })

  it('hata, kilit ve ready eslemeleri', async () => {
    const { ctrl, send } = setup()
    send.mockResolvedValueOnce({ success: false, code: 'NO_LIQUIDITY', message: 'gizli ayrinti' })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'error', errorCode: 'NO_LIQUIDITY', result: null })
    expect(JSON.stringify(ctrl.snapshot())).not.toContain('gizli ayrinti')

    send.mockResolvedValueOnce({ success: true, locked: true, lockReason: 'MARKET_CLOSED', nextChangeAt: 'x', quoteId: null, display: null })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'locked', lockReason: 'MARKET_CLOSED', quoteId: null })

    send.mockResolvedValueOnce(readyRes({ locked: true, lockReason: 'PRICE_PROTECTION', quoteId: 'kilitli' }))
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'locked', lockReason: 'PRICE_PROTECTION', quoteId: 'kilitli' })

    send.mockResolvedValueOnce(readyRes())
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'ready', quoteId: 'q1', expiresAt: NOW + 30_000, approveUntil: NOW + 300_000, errorCode: null, lockReason: null })
    ctrl.dispose()
  })

  it('send reddi (Could not serialize message dahil) ve garip yanit -> UNKNOWN', async () => {
    const { ctrl, send } = setup()
    send.mockRejectedValueOnce(new Error('Could not serialize message.'))
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'error', errorCode: 'UNKNOWN' })
    expect(JSON.stringify(ctrl.snapshot())).not.toContain('serialize')

    send.mockImplementationOnce(() => { throw new Error('senkron') })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'error', errorCode: 'UNKNOWN' })

    send.mockResolvedValueOnce(undefined)
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(ctrl.snapshot()).toMatchObject({ state: 'error', errorCode: 'UNKNOWN' })
    ctrl.dispose()
  })

  it('expiresAt gelince otomatik yeniler (gorunurken)', async () => {
    const { ctrl, send } = setup()
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(send).toHaveBeenCalledTimes(1)
    send.mockResolvedValueOnce(readyRes({ quoteId: 'q2', expiresAt: Date.now() + 90_000 }))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(send).toHaveBeenCalledTimes(2)
    expect(ctrl.snapshot().quoteId).toBe('q2')
    ctrl.dispose()
  })

  it('gizliyken zamanlayici kurulmaz; gorunur olunca suresi gecmisse hemen yenilenir', async () => {
    let gorunur = false
    const { ctrl, send } = setup({ visible: () => gorunur })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
    gorunur = true
    send.mockResolvedValueOnce(readyRes({ quoteId: 'q3', expiresAt: Date.now() + 90_000 }))
    ctrl.syncVisibility()
    await vi.advanceTimersByTimeAsync(0)
    expect(send).toHaveBeenCalledTimes(2)
    expect(ctrl.snapshot().quoteId).toBe('q3')
    ctrl.dispose()
  })

  it('dispose zamanlayicilari temizler (sayac 0)', async () => {
    const live = new Set()
    const setTimer = vi.fn((fn, ms) => { const id = setTimeout(() => { live.delete(id); fn() }, ms); live.add(id); return id })
    const clearTimer = vi.fn((id) => { live.delete(id); clearTimeout(id) })
    const { ctrl } = setup({ setTimer, clearTimer })
    ctrl.request(MSG)
    expect(live.size).toBe(1)
    await vi.advanceTimersByTimeAsync(600)
    expect(live.size).toBe(1) // expiry
    ctrl.dispose()
    expect(live.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('invalidate expiry zamanlayicisini da temizler', async () => {
    const { ctrl, send } = setup()
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    ctrl.invalidate()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(send).toHaveBeenCalledTimes(1)
    ctrl.dispose()
  })

  it('eszamanli iki refresh tek istek', async () => {
    let resolve
    const send = vi.fn()
      .mockResolvedValueOnce(readyRes())
      .mockImplementation(() => new Promise((r) => { resolve = r }))
    const { ctrl } = setup({ send })
    ctrl.request(MSG)
    await vi.advanceTimersByTimeAsync(600)
    const a = ctrl.refresh()
    const b = ctrl.refresh()
    expect(send).toHaveBeenCalledTimes(2)
    expect(ctrl.snapshot().state).toBe('loading')
    resolve(readyRes({ quoteId: 'r' }))
    await Promise.all([a, b])
    expect(ctrl.snapshot().quoteId).toBe('r')
    ctrl.dispose()
  })

  it('istek yokken refresh bir sey yapmaz', async () => {
    const { ctrl, send } = setup()
    await ctrl.refresh()
    expect(send).not.toHaveBeenCalled()
    ctrl.dispose()
  })
})

describe('useCowQuote (Vue sarmalayici)', () => {
  it('errorInfo ref olarak disari verilir', async () => {
    vi.useFakeTimers()
    const send = vi.fn(async () => ({ success: false, code: 'AMOUNT_TOO_SMALL', feeAtoms: '5', feeDisplay: '0.01', minAmountDisplay: '0.01', missingDisplay: '0.01' }))
    const scope = effectScope()
    const q = scope.run(() => useCowQuote({ request: () => MSG, send }))
    await vi.advanceTimersByTimeAsync(600)
    expect(q.errorInfo.value).toEqual({ feeDisplay: '0.01', minAmountDisplay: '0.01', missingDisplay: '0.01' })
    scope.stop()
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('request getter izlenir, enabled kapaliyken istek yok, kapsam bitince temizlenir', async () => {
    const send = vi.fn(async () => readyRes())
    const msg = ref(null)
    const enabled = ref(true)
    const scope = effectScope()
    const q = scope.run(() => useCowQuote({ request: () => msg.value, enabled, visible: true, send }))
    expect(q.state.value).toBe('idle')
    msg.value = MSG
    await nextTick()
    expect(q.state.value).toBe('loading')
    await vi.advanceTimersByTimeAsync(600)
    expect(send).toHaveBeenCalledTimes(1)
    expect(q.state.value).toBe('ready')
    expect(q.quoteId.value).toBe('q1')

    enabled.value = false
    await nextTick()
    expect(q.state.value).toBe('idle')
    expect(q.result.value).toBeNull()

    enabled.value = true
    await nextTick()
    expect(q.state.value).toBe('loading')
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('varsayilan gonderici COW_QUOTE govdesini { type, message } sarar', async () => {
    const sendMessage = vi.fn(async () => readyRes())
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const scope = effectScope()
    scope.run(() => useCowQuote({ request: () => MSG }))
    await vi.advanceTimersByTimeAsync(600)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'COW_QUOTE', message: MSG })
    scope.stop()
    vi.unstubAllGlobals()
  })
})
