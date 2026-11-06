// useCowOrderWatch (Task 22): popup ici 3 sn emir yoklamasi. Saf cekirdek sahte send + sahte zamanlayici ile.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { effectScope, nextTick, ref } from 'vue'
import { createOrderWatch, useCowOrderWatch, WATCH_INTERVAL_MS, STILL_PENDING_MS } from './useCowOrderWatch'
import { yorumsuz } from '../test-utils/kaynakTarama.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const UID = `0x${'ab'.repeat(56)}`
const OTHER_UID = `0x${'cd'.repeat(56)}`
const NOW = 1_800_000_000_000
const HASH = `0x${'12'.repeat(32)}`

const view = (over = {}) => ({ uid: UID, status: 'open', apiStatus: 'active', executedBuyAmount: null, executedSellAmount: null, txHash: null, ...over })
const reply = (...orders) => ({ success: true, orders })

function setup({ chainId = 1, send, ...extra } = {}) {
  const fn = send ?? vi.fn(async () => reply(view()))
  const changes = []
  const watch = createOrderWatch({ send: fn, uid: UID, chainId, onChange: (s) => changes.push(s), ...extra })
  return { send: fn, watch, changes }
}

describe('createOrderWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sabitler: 3 sn aralik, BSC 60 sn / digerleri 90 sn', () => {
    expect(WATCH_INTERVAL_MS).toBe(3000)
    expect(STILL_PENDING_MS[56]).toBe(60_000)
    expect(STILL_PENDING_MS.default).toBe(90_000)
  })

  it('her 3 sn bir send; govde BIREBIR { type, message: { uids:[uid] } }', async () => {
    const { send, watch } = setup()
    watch.start()
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2999)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toEqual({ type: 'COW_ORDERS_REFRESH', message: { uids: [UID] } })
    expect(Object.keys(send.mock.calls[0][0].message)).toEqual(['uids'])
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(2)
    watch.stop()
  })

  it('ilk faz submitting; initial pending verilirse pending', () => {
    expect(setup().watch.snapshot()).toMatchObject({ phase: 'submitting', apiStatus: null, txHash: null, stillPending: false })
    expect(setup({ initial: 'pending' }).watch.snapshot().phase).toBe('pending')
  })

  it('eslesme: open -> pending (+ apiStatus), submitting -> submitting', async () => {
    const send = vi.fn(async () => reply(view({ status: 'open', apiStatus: 'solved' })))
    const { watch, changes } = setup({ send })
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot()).toMatchObject({ phase: 'pending', apiStatus: 'solved' })
    expect(changes.at(-1).phase).toBe('pending')
    send.mockImplementation(async () => reply(view({ status: 'submitting', apiStatus: null })))
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot()).toMatchObject({ phase: 'submitting', apiStatus: null })
    watch.stop()
  })

  for (const status of ['fulfilled', 'expired', 'cancelled']) {
    it(`${status} terminal: faz, tutarlar, txHash; zamanlayici DURUR (sayac 0), sonra send yok`, async () => {
      const send = vi.fn(async () =>
        reply(view({ status, apiStatus: null, executedBuyAmount: '45', executedSellAmount: '10', txHash: status === 'fulfilled' ? HASH : null })),
      )
      const { watch } = setup({ send })
      watch.start()
      await vi.advanceTimersByTimeAsync(3000)
      expect(watch.snapshot()).toMatchObject({
        phase: status,
        executedBuy: '45',
        executedSell: '10',
        txHash: status === 'fulfilled' ? HASH : null,
      })
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(send).toHaveBeenCalledTimes(1)
    })
  }

  it('send reddi hata fazi URETMEZ ve sonraki tikte yeniden denenir', async () => {
    const send = vi.fn()
    send.mockRejectedValueOnce(new Error('Receiving end does not exist'))
    send.mockResolvedValueOnce({ success: false, code: 'WALLET_LOCKED' })
    send.mockResolvedValue(reply(view({ status: 'fulfilled', txHash: HASH, executedBuyAmount: '1' })))
    const { watch } = setup({ send })
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot().phase).toBe('submitting')
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot().phase).toBe('submitting')
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(3)
    expect(watch.snapshot().phase).toBe('fulfilled')
  })

  it('yaniti olmayan / bozuk yanit sessizce atlanir, faz degismez', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true, orders: 'x' })
      .mockResolvedValue(reply(view({ status: 'open' })))
    const { watch } = setup({ send })
    watch.start()
    await vi.advanceTimersByTimeAsync(9000)
    expect(watch.snapshot().phase).toBe('submitting')
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot().phase).toBe('pending')
    watch.stop()
  })

  it('baska UID li kayitlar yok sayilir; bos liste fazi degistirmez (kayit yok)', async () => {
    const send = vi.fn(async () => reply(view({ uid: OTHER_UID, status: 'fulfilled', txHash: HASH })))
    const { watch } = setup({ send })
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot().phase).toBe('submitting')
    send.mockImplementation(async () => reply())
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot().phase).toBe('submitting')
    // UID karsilastirmasi buyuk/kucuk harf duyarsiz
    send.mockImplementation(async () => reply(view({ uid: `0x${'AB'.repeat(56)}`, status: 'expired' })))
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.snapshot().phase).toBe('expired')
  })

  it('gecersiz UID: HICBIR istek gitmez (bos uids listesi "hepsi gecersiz" belirsizligi dogmaz)', async () => {
    for (const bad of ['', 'abc', '0x12', null, undefined, `0x${'zz'.repeat(56)}`]) {
      const send = vi.fn(async () => reply())
      const watch = createOrderWatch({ send, uid: bad, chainId: 1 })
      watch.start()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(send).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('stillPending: BSC 60 sn sinirinda', async () => {
    const { watch } = setup({ chainId: 56 })
    watch.start()
    await vi.advanceTimersByTimeAsync(59_999)
    expect(watch.snapshot().stillPending).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(watch.snapshot().stillPending).toBe(true)
    watch.stop()
  })

  it('stillPending: diger zincirler 90 sn (Ethereum 1 ve Arbitrum 42161)', async () => {
    for (const chainId of [1, 42161]) {
      const { watch } = setup({ chainId })
      watch.start()
      await vi.advanceTimersByTimeAsync(89_999)
      expect(watch.snapshot().stillPending).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(watch.snapshot().stillPending).toBe(true)
      watch.stop()
    }
  })

  it('terminal fazda stillPending false', async () => {
    const send = vi.fn(async () => reply(view({ status: 'expired' })))
    const { watch } = setup({ chainId: 56, send })
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(watch.snapshot()).toMatchObject({ phase: 'expired', stillPending: false })
  })

  it('gorunmezken send yok ama zamanlayici surer; gorununce yeniden gonderir', async () => {
    let shown = false
    const { send, watch } = setup({ visible: () => shown })
    watch.start()
    await vi.advanceTimersByTimeAsync(12_000)
    expect(send).not.toHaveBeenCalled()
    shown = true
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('yanit gecikirse tikler ust uste binmez', async () => {
    let release
    const send = vi.fn(() => new Promise((r) => { release = r }))
    const { watch } = setup({ send })
    watch.start()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(send).toHaveBeenCalledTimes(1)
    release(reply(view()))
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(2)
    watch.stop()
  })

  it('stop(): bekleyen zamanlayici silinir, sonradan gelen yanit durumu degistirmez', async () => {
    let release
    const send = vi.fn(() => new Promise((r) => { release = r }))
    const { watch, changes } = setup({ send })
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    watch.stop()
    release(reply(view({ status: 'fulfilled', txHash: HASH })))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(watch.snapshot().phase).toBe('submitting')
    expect(changes.every((c) => c.phase === 'submitting')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start() iki kez cagrilsa tek zamanlayici zinciri', async () => {
    const { send, watch } = setup()
    watch.start()
    watch.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(1)
    watch.stop()
  })
})

describe('useCowOrderWatch (Vue sarmalayici)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uid verilince baslar, snapshot alanlari reaktif; kapsam bitince zamanlayici temizlenir', async () => {
    const send = vi.fn(async () => reply(view({ status: 'open', apiStatus: 'active' })))
    const uid = ref(null)
    const scope = effectScope()
    const w = scope.run(() => useCowOrderWatch({ uid: () => uid.value, chainId: 56, send }))
    expect(w.phase.value).toBe('submitting')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).not.toHaveBeenCalled()
    uid.value = UID
    await nextTick()
    await vi.advanceTimersByTimeAsync(3000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(w.phase.value).toBe('pending')
    expect(w.apiStatus.value).toBe('active')
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('varsayilan send chrome.runtime.sendMessage kullanir', async () => {
    const sendMessage = vi.fn(async () => reply(view({ status: 'expired' })))
    globalThis.chrome = { runtime: { sendMessage } }
    try {
      const scope = effectScope()
      const w = scope.run(() => useCowOrderWatch({ uid: () => UID, chainId: 1 }))
      await vi.advanceTimersByTimeAsync(3000)
      expect(sendMessage).toHaveBeenCalledWith({ type: 'COW_ORDERS_REFRESH', message: { uids: [UID] } })
      expect(w.phase.value).toBe('expired')
      scope.stop()
    } finally {
      delete globalThis.chrome
    }
  })

  it('uid degisince eski kosu durur, yenisi baslar', async () => {
    const send = vi.fn(async () => reply())
    const uid = ref(UID)
    const scope = effectScope()
    scope.run(() => useCowOrderWatch({ uid: () => uid.value, chainId: 1, send }))
    await vi.advanceTimersByTimeAsync(3000)
    uid.value = OTHER_UID
    await nextTick()
    await vi.advanceTimersByTimeAsync(3000)
    expect(send.mock.calls.at(-1)[0].message.uids).toEqual([OTHER_UID])
    scope.stop()
  })
})

describe('kaynak taramasi', () => {
  const src = yorumsuz(readFileSync(resolve(HERE, 'useCowOrderWatch.js'), 'utf8'))
  it('hesap/imza/depolama sozlesmesi icermez', () => {
    for (const yasak of ['parseUnits', 'computeAmounts', 'GPV2_', 'sellAmount:', 'localStorage', 'COW_PLACE_ORDER', 'v-html']) {
      expect(src).not.toContain(yasak)
    }
  })
})
