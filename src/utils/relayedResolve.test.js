import { describe, it, expect, vi } from 'vitest'
import { makeRelayedGate } from './relayedResolve.js'

describe('makeRelayedGate', () => {
  it('asil op (transfer/swap/bridge) onRelayed edilince bir kez resolve eder', () => {
    for (const kind of ['transfer', 'swap', 'bridge']) {
      const resolve = vi.fn()
      const gate = makeRelayedGate({ resolve })
      gate({ txHash: '0xabc', kind })
      gate({ txHash: '0xabc', kind })
      expect(resolve).toHaveBeenCalledTimes(1)
      expect(resolve).toHaveBeenCalledWith({ txHash: '0xabc', kind })
    }
  })

  it('bootstrap/onboarding op resolve ETMEZ', () => {
    const resolve = vi.fn()
    const gate = makeRelayedGate({ resolve })
    gate({ txHash: '0x1', kind: 'bootstrap' })
    gate({ txHash: '0x2', kind: 'onboarding' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('unconfirmed:true resolve ETMEZ, sonraki onayli asil op yine de edebilir', () => {
    const resolve = vi.fn()
    const gate = makeRelayedGate({ resolve })
    gate({ txHash: '0x1', kind: 'transfer', unconfirmed: true })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('hash yoksa resolve ETMEZ', () => {
    const resolve = vi.fn()
    makeRelayedGate({ resolve })({ kind: 'transfer' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('kuyruk gorevi makbuz bitene kadar cozulmez, popup cevabi hash gelince doner', async () => {
    let receiptDone
    const receipt = new Promise((r) => { receiptDone = r })
    const order = []
    let popupAnswer
    const popup = new Promise((resolve) => { popupAnswer = resolve })
    const gate = makeRelayedGate({ resolve: (info) => { order.push('popup'); popupAnswer(info) } })
    const task = (async () => {
      gate({ txHash: '0xh', kind: 'transfer' })
      await receipt
      order.push('receipt')
    })()
    let taskDone = false
    task.then(() => { taskDone = true })
    await popup
    await Promise.resolve()
    expect(taskDone).toBe(false)
    receiptDone()
    await task
    expect(order).toEqual(['popup', 'receipt'])
  })
})
