import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('axios', () => ({ default: { post: vi.fn() } }))
import axios from 'axios'
import { getBundlerToken, _clearBundlerTokenCache } from './bundlerAuth'

function makeSigner(address) {
  return { address, signMessage: vi.fn(async () => '0xsig') }
}

beforeEach(() => {
  _clearBundlerTokenCache()
  vi.clearAllMocks()
  const store = {}
  globalThis.chrome = {
    storage: {
      session: {
        get: vi.fn(async (k) => ({ [k]: store[k] })),
        set: vi.fn(async (obj) => { Object.assign(store, obj) }),
      },
    },
  }
  if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
    globalThis.crypto = { getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = 7; return a } }
  }
})

describe('getBundlerToken', () => {
  it('ilk cagri token basar, taze cache ikinci cagride ag yapmaz', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900
    axios.post.mockResolvedValue({ data: { success: true, token: 'TOK', exp } })
    const signer = makeSigner('0xAbC0000000000000000000000000000000000001')
    const t1 = await getBundlerToken({ signer, bundlerBase: 'http://x' })
    const t2 = await getBundlerToken({ signer, bundlerBase: 'http://x' })
    expect(t1).toBe('TOK')
    expect(t2).toBe('TOK')
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('suresi gecmis token yeniden basilir', async () => {
    const signer = makeSigner('0xAbC0000000000000000000000000000000000002')
    axios.post.mockResolvedValueOnce({ data: { success: true, token: 'OLD', exp: Math.floor(Date.now() / 1000) - 10 } })
    await getBundlerToken({ signer, bundlerBase: 'http://x' })
    axios.post.mockResolvedValueOnce({ data: { success: true, token: 'NEW', exp: Math.floor(Date.now() / 1000) + 900 } })
    const t = await getBundlerToken({ signer, bundlerBase: 'http://x' })
    expect(t).toBe('NEW')
    expect(axios.post).toHaveBeenCalledTimes(2)
  })

  it('sunucu success:false -> hata firlatir', async () => {
    axios.post.mockResolvedValue({ data: { success: false, error: 'unauthorized' } })
    const signer = makeSigner('0xAbC0000000000000000000000000000000000003')
    await expect(getBundlerToken({ signer, bundlerBase: 'http://x' })).rejects.toThrow(/unauthorized/)
  })

  it('imzalanan mesaj sunucu formatiyla uyumlu', async () => {
    const exp = Math.floor(Date.now() / 1000) + 900
    axios.post.mockResolvedValue({ data: { success: true, token: 'TOK', exp } })
    const signer = makeSigner('0xAbC0000000000000000000000000000000000004')
    await getBundlerToken({ signer, bundlerBase: 'http://x' })

    expect(signer.signMessage).toHaveBeenCalledTimes(1)
    const [msg] = signer.signMessage.mock.calls[0]
    // format: watswallet-bundler-auth:<lowercase-addr>:<ms-timestamp>:<32-char hex nonce>
    expect(msg).toMatch(/^watswallet-bundler-auth:0x[0-9a-f]+:\d+:[0-9a-f]{32}$/)
    // adres mesajda kucuk harf olmali (server kendi tarafinda toLowerCase yapiyor)
    expect(msg.split(':')[1]).toBe('0xabc0000000000000000000000000000000000004')
    // mesajdaki timestamp, server'a POST edilen ile ayni stringe cozulmeli
    const tsInMsg = msg.split(':')[2]
    const tsInPost = axios.post.mock.calls[0][1].timestamp
    expect(tsInMsg).toBe(String(tsInPost))
  })
})
