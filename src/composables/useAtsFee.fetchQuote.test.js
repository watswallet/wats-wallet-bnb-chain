// useAtsFee.loadAtsFee `fetchQuote` parametresi (xStocks Task 23): teklif kaynagi disaridan verilebilir.
// Yanit sekli ATS_FEE_QUOTE ile AYNI oldugundan kart/engel/onboarding mantigi kopyalanmaz.
// Mevcut useAtsFee.test.js'e DOKUNULMAZ; fetchQuote verilmezse davranis degismez (alttaki ikinci blok).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const VALID_CFG = {
  paymaster: '0x1111111111111111111111111111111111111111',
  delegate: '0x2222222222222222222222222222222222222222',
  entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
  token: { address: '0xAAA0000000000000000000000000000000000000', symbol: 'ATS', decimals: 18 },
}
vi.mock('../utils/atsConfig', () => ({ getAtsConfig: () => VALID_CFG }))

import { useAtsFee } from './useAtsFee'
import { resolveAtsBlocker } from '../utils/atsBlocker'

const ARGS = { chainId: 56, address: '0x' + '1'.repeat(40), call: null, sentAssetAddress: null, sendAmount: 0 }
const OK = { success: true, ready: true, mode: 'direct', transferFee: 1.25, atsBalance: 10, symbol: 'ATS', nextSteps: [] }

beforeEach(() => {
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) } },
  }
})

describe('useAtsFee.loadAtsFee fetchQuote verilince', () => {
  it('sendMessage CAGRILMAZ; atsFee/ready/decision yanittan dolar', async () => {
    const fetchQuote = vi.fn(async () => ({ ...OK, transferFee: 2.5, atsBalance: 7, ready: true }))
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, fetchQuote })
    expect(fetchQuote).toHaveBeenCalledTimes(1)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(a.atsFee.value).toBe(2.5)
    expect(a.atsBalance.value).toBe(7)
    expect(a.ready.value).toBe(true)
    expect(a.decision.value).toBeNull()
    expect(a.blocked.value).toBe(false)
    expect(a.loading.value).toBe(false)
  })

  it('hazir degil + engel kodu: decision resolveAtsBlocker ile, bloklu', async () => {
    const fetchQuote = async () => ({ ...OK, ready: false, decision: resolveAtsBlocker('src-balance-missing') })
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, fetchQuote })
    expect(a.ready.value).toBe(false)
    expect(a.decision.value.action).toBe('buy-ats')
    expect(a.blocked.value).toBe(true)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('basarisiz yanit (success:false + kod): ucret bosalir, karar koddan, hata yazilir', async () => {
    const fetchQuote = async () => ({ success: false, code: 'src-allowance-missing', error: 'x' })
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, fetchQuote })
    expect(a.atsFee.value).toBeNull()
    expect(a.decision.value.action).toBe('run-onboarding')
    expect(a.error.value).toBe('x')
    expect(a.blocked.value).toBe(true)
  })

  it('fetchQuote reddederse ucret bosalir ve hata yazilir (yutulmaz, yukleme kapanir)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = useAtsFee()
    await a.loadAtsFee({ ...ARGS, fetchQuote: async () => { throw new Error('worker kapandi') } })
    expect(a.atsFee.value).toBeNull()
    expect(a.error.value).toBe('worker kapandi')
    expect(a.loading.value).toBe(false)
    spy.mockRestore()
  })

  it('runOnboarding sonrasi tazeleme AYNI fetchQuote ile yapilir (ATS_FEE_QUOTE degil)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true })
    const fetchQuote = vi.fn(async () => OK)
    const a = useAtsFee()
    const ok = await a.runOnboarding({ ...ARGS, fetchQuote })
    expect(ok).toBe(true)
    const types = chrome.runtime.sendMessage.mock.calls.map((c) => c[0].type)
    expect(types).toEqual(['ATS_RUN_ONBOARDING'])
    expect(fetchQuote).toHaveBeenCalledTimes(1)
    expect(a.atsFee.value).toBe(1.25)
  })
})

describe('useAtsFee.loadAtsFee fetchQuote VERILMEZSE davranis ayni', () => {
  it('ATS_FEE_QUOTE gonderilir ve yanit ayni sekilde islenir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue(OK)
    const a = useAtsFee()
    const call = { to: '0x' + '9'.repeat(40), value: 5n, data: '0x' }
    await a.loadAtsFee({ ...ARGS, call })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
    const msg = chrome.runtime.sendMessage.mock.calls[0][0]
    expect(msg.type).toBe('ATS_FEE_QUOTE')
    expect(msg.message.chainId).toBe(56)
    expect(msg.message.call.value).toBe('5')
    expect(a.atsFee.value).toBe(1.25)
    expect(a.ready.value).toBe(true)
  })
})
