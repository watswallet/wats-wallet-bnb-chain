import { describe, it, expect, vi } from 'vitest'
import { finishDappSend, failDappSend } from './dappSendFlow'

const mk = (over = {}) => {
  const sent = []
  const pages = []
  return {
    sent, pages,
    args: { fromDapp: true, requestId: 'r1', sendMessage: vi.fn(async (m) => { sent.push(m) }), setPage: (p) => pages.push(p), txFailedText: 'failed', ...over },
  }
}

describe('finishDappSend', () => {
  it('pending + dapp: tam bir SEND_TX_REJECTED -32603, SUCCESS yok, home', async () => {
    const c = mk()
    await finishDappSend({ ...c.args, response: { success: false, unverified: true } })
    expect(c.sent.map((m) => m.type)).toEqual(['SEND_TX_REJECTED'])
    expect(c.sent[0].error.code).toBe(-32603)
    expect(c.pages).toEqual(['home'])
  })
  it('pending dapp\'siz: mesaj yok, home', async () => {
    const c = mk({ fromDapp: false })
    await finishDappSend({ ...c.args, response: { success: false, unverified: true } })
    expect(c.sent).toEqual([])
    expect(c.pages).toEqual(['home'])
  })
  it('basari + dapp: SUCCESS hash ile, home', async () => {
    const c = mk()
    await finishDappSend({ ...c.args, response: { success: true, txHash: '0xh' } })
    expect(c.sent).toEqual([{ type: 'SEND_TX_SUCCESS', requestId: 'r1', status: 'success', data: { result: '0xh' } }])
    expect(c.pages).toEqual(['home'])
  })
  it('kesin hata firlatir', async () => {
    const c = mk()
    await expect(finishDappSend({ ...c.args, response: { success: false, error: 'boom' } })).rejects.toThrow('boom')
    expect(c.sent).toEqual([])
  })
})

describe('failDappSend', () => {
  it('dapp: REJECTED -32603 err.message ile, home', async () => {
    const c = mk()
    expect(await failDappSend({ ...c.args, err: new Error('x') })).toBe('dapp')
    expect(c.sent[0]).toEqual({ type: 'SEND_TX_REJECTED', requestId: 'r1', status: 'error', error: { code: -32603, message: 'x' } })
    expect(c.pages).toEqual(['home'])
  })
  it('dapp\'siz: alert doner, mesaj yok', async () => {
    const c = mk({ fromDapp: false })
    expect(await failDappSend({ ...c.args, err: new Error('x') })).toBe('alert')
    expect(c.sent).toEqual([])
  })
})

describe('cift cevap korumasi (replied bayragi)', () => {
  const flow = async (c, response, state) => {
    try {
      await finishDappSend({ ...c.args, response, state })
    } catch (err) {
      return failDappSend({ ...c.args, err, state })
    }
  }
  it('pending sendMessage firlatirsa toplam 1 REJECTED denenir, home', async () => {
    const c = mk({ sendMessage: vi.fn(async () => { throw new Error('port closed') }) })
    await flow(c, { success: false, unverified: true }, { replied: false })
    expect(c.args.sendMessage).toHaveBeenCalledTimes(1)
    expect(c.pages).toContain('home')
  })
  it('SUCCESS sendMessage firlatirsa REJECTED GONDERILMEZ, home', async () => {
    const c = mk({ sendMessage: vi.fn(async () => { throw new Error('port closed') }) })
    await flow(c, { success: true, txHash: '0xh' }, { replied: false })
    expect(c.args.sendMessage).toHaveBeenCalledTimes(1)
    expect(c.args.sendMessage.mock.calls[0][0].type).toBe('SEND_TX_SUCCESS')
    expect(c.pages).toContain('home')
  })
  it('arka plan hatasi: REJECTED -32603 mesaji ayni kalir', async () => {
    const c = mk()
    await flow(c, { success: false, error: 'boom' }, { replied: false })
    expect(c.sent).toEqual([{ type: 'SEND_TX_REJECTED', requestId: 'r1', status: 'error', error: { code: -32603, message: 'boom' } }])
  })
  it('catch icindeki sendMessage firlatsa da home calisir', async () => {
    const c = mk({ sendMessage: vi.fn(async () => { throw new Error('closed') }) })
    await failDappSend({ ...c.args, err: new Error('x'), state: { replied: false } })
    expect(c.pages).toEqual(['home'])
  })
})
