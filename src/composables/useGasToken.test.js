import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('axios', () => ({ default: { post: vi.fn(async () => ({ data: {} })) } }))
vi.mock('../store/config', () => ({ configStore: () => ({ api: 'http://api' }) }))

import axios from 'axios'
import { useGasToken } from './useGasToken'

const OPT = (token, balance, gasFee) => ({ token, symbol: 'T', decimals: 6, balance, gasFee, logoURI: '' })

beforeEach(() => {
  vi.clearAllMocks()
  globalThis.chrome = { runtime: { sendMessage: vi.fn() } }
  axios.post.mockResolvedValue({ data: {} })
})

describe('useGasToken', () => {
  it('loadGasOptions options doldurur, native yeterliyse gasToken null kalir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, options: [OPT('0xAAA', 5, 0.3)] })
    const g = useGasToken()
    await g.loadGasOptions({ chainId: 1, address: '0x0', bundlerBase: 'http://b', sentAsset: null, sendAmount: 0, nativeInsufficient: false })
    expect(g.gasTokenOptions.value).toHaveLength(1)
    expect(g.gasToken.value).toBe(null)
  })

  it('native yetersizse en yuksek bakiyeli (yeterli) token default secilir', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, options: [OPT('0xAAA', 1, 0.3), OPT('0xBBB', 9, 0.3)] })
    const g = useGasToken()
    await g.loadGasOptions({ chainId: 1, address: '0x0', bundlerBase: 'http://b', sentAsset: null, sendAmount: 0, nativeInsufficient: true })
    expect(g.gasToken.value).toBe('0xBBB')
  })

  it('ayni (chain,sentAsset) icin yeniden kesif YAPMAZ (cache)', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, options: [OPT('0xAAA', 5, 0.3)] })
    const g = useGasToken()
    const args = { chainId: 1, address: '0x0', bundlerBase: 'http://b', sentAsset: { address: '0xAAA' }, sendAmount: 0, nativeInsufficient: false }
    await g.loadGasOptions(args)
    await g.loadGasOptions(args)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('selectedInsufficient: secili token gas+transfer karsilamiyorsa true', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, options: [OPT('0xAAA', 0.5, 0.3)] })
    const g = useGasToken()
    await g.loadGasOptions({ chainId: 1, address: '0x0', bundlerBase: 'http://b', sentAsset: { address: '0xAAA' }, sendAmount: '0.3', nativeInsufficient: false })
    g.gasToken.value = '0xAAA'
    expect(g.selectedInsufficient.value).toBe(true)
  })

  it('resetGasToken state temizler', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, options: [OPT('0xAAA', 5, 0.3)] })
    const g = useGasToken()
    await g.loadGasOptions({ chainId: 1, address: '0x0', bundlerBase: 'http://b', sentAsset: null, sendAmount: 0, nativeInsufficient: true })
    g.resetGasToken()
    expect(g.gasToken.value).toBe(null)
    expect(g.gasTokenOptions.value).toEqual([])
  })

  it('enrichLogos DB logosunu options.logoURI ye yazar', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ success: true, options: [OPT('0xAAA', 5, 0.3)] })
    axios.post.mockResolvedValue({ data: { token: { image: { large: 'http://logo/a.png' } } } })
    const g = useGasToken()
    await g.loadGasOptions({ chainId: 1, address: '0x0', bundlerBase: 'http://b', sentAsset: null, sendAmount: 0, nativeInsufficient: false })
    await new Promise((r) => setTimeout(r)) // fire-and-forget enrichLogos'in tamamlanmasini bekle
    expect(g.gasTokenOptions.value[0].logoURI).toBe('http://logo/a.png')
  })
})
