import { describe, it, expect, beforeEach, vi } from 'vitest'
import { testRPC, findFastestRPC, RECEIPT_PROBE_HASH } from './testRPC'

// 2026-08-05: saglik kontrolu yalnizca blockNumber/net_version/chainId deniyordu.
// publicnode uclari bu ucleri kusursuz cevaplarken eth_getTransactionReceipt'i ucretli
// token arkasina almisti (-32602). Sonuc: findFastestRPC o ucu "excellent" diye seciyor,
// sonra HER islem makbuz bekleyisinde timeout'a dusup zincirde BASARILI oldugu halde
// "islem sonucu dogrulanamadi" gorunuyordu. Canliligi olcmek yetmez; makbuz YETENEGI de
// olculmeli.

const GATED_ERROR = {
  code: -32602,
  message: 'Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode',
}

// Sonda hash'i var OLMAYAN bir islemi gosterir: saglikli dugum `result: null` doner.
// Sifir hash KULLANILAMAZ — Nethermind (Gnosis) onu -32603 ile reddeder ve calisir
// durumdaki uc bozuk sayilirdi.
const okBody = (method) => {
  if (method === 'eth_getTransactionReceipt') return { jsonrpc: '2.0', id: 1, result: null }
  if (method === 'net_version') return { jsonrpc: '2.0', id: 1, result: '1' }
  return { jsonrpc: '2.0', id: 1, result: '0x1234' }
}

// url -> (method) => body. Cagrilan methodlari da kaydeder.
let handlers
let calls

const mockFetch = vi.fn(async (url, init) => {
  const { method } = JSON.parse(init.body)
  calls.push({ url, method })
  const body = handlers[url](method)
  if (body === 'NETWORK_ERROR') throw new TypeError('fetch failed')
  return { ok: true, json: async () => body }
})

beforeEach(() => {
  handlers = {}
  calls = []
  mockFetch.mockClear()
  vi.stubGlobal('fetch', mockFetch)
})

describe('testRPC makbuz yetenegi', () => {
  it('canli AMA makbuz vermeyen uc BASARISIZ sayilir', async () => {
    handlers['https://gated.example'] = (m) =>
      m === 'eth_getTransactionReceipt'
        ? { jsonrpc: '2.0', id: 1, error: GATED_ERROR }
        : okBody(m)

    const r = await testRPC('https://gated.example')

    expect(r.ok).toBe(false)
    expect(r.error).toBe('NO_RECEIPTS')
  })

  it('makbuz veren uc gecerli sayilir ve sonda VAR OLMAYAN bir hash sorar', async () => {
    handlers['https://saglam.example'] = okBody

    const r = await testRPC('https://saglam.example')

    expect(r.ok).toBe(true)
    expect(calls.some((c) => c.method === 'eth_getTransactionReceipt')).toBe(true)
    expect(RECEIPT_PROBE_HASH).toMatch(/^0x[0-9a-f]{64}$/)
    expect(RECEIPT_PROBE_HASH).not.toBe('0x' + '0'.repeat(64))
  })

  it('makbuz alani result: null yerine hic gelmezse de REDDEDER', async () => {
    handlers['https://bos.example'] = (m) =>
      m === 'eth_getTransactionReceipt' ? { jsonrpc: '2.0', id: 1 } : okBody(m)

    expect((await testRPC('https://bos.example')).ok).toBe(false)
  })

  it('canlilik testi duserse makbuz sondasi HIC atilmaz', async () => {
    handlers['https://olu.example'] = () => 'NETWORK_ERROR'

    const r = await testRPC('https://olu.example')

    expect(r.ok).toBe(false)
    expect(calls.some((c) => c.method === 'eth_getTransactionReceipt')).toBe(false)
  })
})

describe('findFastestRPC', () => {
  it('makbuz vermeyen ucu SECMEZ, makbuz veren ucu secer', async () => {
    handlers['https://gated.example'] = (m) =>
      m === 'eth_getTransactionReceipt'
        ? { jsonrpc: '2.0', id: 1, error: GATED_ERROR }
        : okBody(m)
    handlers['https://saglam.example'] = okBody

    const best = await findFastestRPC(['https://gated.example', 'https://saglam.example'])

    expect(best?.url).toBe('https://saglam.example')
  })

  it('hicbir uc makbuz vermiyorsa null doner (yanlis secim yapmaz)', async () => {
    handlers['https://gated-1.example'] = (m) =>
      m === 'eth_getTransactionReceipt'
        ? { jsonrpc: '2.0', id: 1, error: GATED_ERROR }
        : okBody(m)
    handlers['https://gated-2.example'] = handlers['https://gated-1.example']

    const best = await findFastestRPC(['https://gated-1.example', 'https://gated-2.example'])

    expect(best).toBeNull()
  })
})
