// EN KRITIK KURAL: /sponsor IMZADAN ONCE cagrilmali. getHash paymasterAndData'nin 20:52 arasi
// baytlarini (paymaster gaz limitleri) imzaya dahil eder; sonradan degistirmek imzayi SESSIZCE
// gecersiz kilar (zincirde AA34). Bu testler sirayi ve makbuz gecisini kilitler.
import { describe, it, expect, vi } from 'vitest'
import { runSponsoredOp } from './flow'

const PM = '0xfc8d7183E0f2db7Aadf3D11F56F5908118Ae0Fce'   // 8453 paymaster'i
const PREFIX = PM + '0'.repeat(64)                          // 52 byte
const SENDER = '0x' + '1'.repeat(40)

function makeClient(over = {}) {
  const calls = []
  return {
    calls,
    quote: vi.fn(async (gas, sender) => { calls.push('quote'); return { atsFee: '10', quoteId: 'Q1', ...(over.quote || {}) } }),
    sponsor: vi.fn(async (req) => {
      calls.push('sponsor')
      calls.sponsorReq = req
      return { paymasterAndDataPrefix: PREFIX, paymasterData: '0xabcd', paymaster: PM, atsFee: '10', settlementId: '0xset', mode: 'crosschain', ...(over.sponsor || {}) }
    }),
    relay: vi.fn(async () => { calls.push('relay'); return { success: true, txHash: '0x' + 'f'.repeat(64) } }),
  }
}

const makeSigner = (calls) => ({
  address: SENDER,
  signDigest: vi.fn(async (d) => { calls.push('sign'); return '0x' + 'cd'.repeat(65) }),
  signAuthorization: vi.fn(async ({ chainId, delegate, nonce }) => ({
    chainId, address: delegate, nonce, yParity: 0, r: '0x' + '11'.repeat(32), s: '0x' + '22'.repeat(32),
  })),
})

const GAS = {
  callGasLimit: 100000n, verificationGasLimit: 300000n, preVerificationGas: 100000n,
  paymasterVerificationGasLimit: 200000n, paymasterPostOpGasLimit: 0n, maxFeePerGas: 2100n,
}
const args = (client, signer, over = {}) => ({
  client, chainId: 8453, signer, callData: '0x1234', nonce: 5n,
  gas: GAS, maxPriorityFeePerGas: 100n, delegated: true, ...over,
})

describe('runSponsoredOp cagri sirasi', () => {
  it('quote -> sponsor -> imza -> relay sirasini dayatir', async () => {
    const client = makeClient()
    const signer = makeSigner(client.calls)
    await runSponsoredOp(args(client, signer))
    expect(client.calls.filter((c) => c !== undefined)).toEqual(['quote', 'sponsor', 'sign', 'relay'])
  })

  it('quote un quoteId sini sponsor a aktarir (fiyat kilidi)', async () => {
    const client = makeClient()
    await runSponsoredOp(args(client, makeSigner(client.calls)))
    expect(client.calls.sponsorReq.quoteId).toBe('Q1')
  })

  it('paymasterAndData yeniden PAKETLENMEZ: prefix + data.slice(2)', async () => {
    const client = makeClient()
    await runSponsoredOp(args(client, makeSigner(client.calls)))
    const op = client.relay.mock.calls[0][0]
    expect(op.paymasterAndData.toLowerCase()).toBe((PREFIX + 'abcd').toLowerCase())
  })

  it('delege DEGILSE authorization imzalar ve marker initCode kullanir', async () => {
    const client = makeClient()
    const signer = makeSigner(client.calls)
    await runSponsoredOp(args(client, signer, { delegated: false, txCount: 3 }))
    expect(signer.signAuthorization).toHaveBeenCalledWith({ chainId: 8453, delegate: expect.any(String), nonce: 3 })
    expect(client.calls.sponsorReq.initCode).toBe('0x7702' + '00'.repeat(18))
  })

  it('delege degil ve txCount yoksa FIRLATIR (sessizce yanlis nonce ile imzalama)', async () => {
    const client = makeClient()
    await expect(runSponsoredOp(args(client, makeSigner(client.calls), { delegated: false })))
      .rejects.toThrow(/txCount/)
  })
})

describe('runSponsoredOp — tahsilat makbuzu', () => {
  it('settlement verilince sponsor a aktarilir ve quote ATLANIR', async () => {
    // Makbuz varken quoteId aranmaz: kullanici zaten odedi, bakiyesi dusmus olabilir.
    const client = makeClient()
    await runSponsoredOp(args(client, makeSigner(client.calls), {
      settlement: { id: '0xset', atsAmount: '10' },
    }))
    expect(client.quote).not.toHaveBeenCalled()
    expect(client.calls.sponsorReq.settlement).toEqual({ id: '0xset', atsAmount: '10' })
  })

  it('sponsor yanitindaki settlementId ve atsFee yi geri dondurur (retry icin)', async () => {
    const client = makeClient()
    const r = await runSponsoredOp(args(client, makeSigner(client.calls)))
    expect(r.settlementId).toBe('0xset')
    expect(r.atsFee).toBe('10')
  })

  it('onQuoted ve onSponsored geri cagrilari calisir', async () => {
    const client = makeClient()
    const onQuoted = vi.fn(), onSponsored = vi.fn()
    await runSponsoredOp(args(client, makeSigner(client.calls), { onQuoted, onSponsored }))
    expect(onQuoted).toHaveBeenCalledWith(expect.objectContaining({ quoteId: 'Q1' }))
    expect(onSponsored).toHaveBeenCalledWith(expect.objectContaining({ settlementId: '0xset' }))
  })

  it('relay success:false ise firlatir', async () => {
    const client = makeClient()
    client.relay = vi.fn(async () => ({ success: false, txHash: '0x' + 'a'.repeat(64) }))
    await expect(runSponsoredOp(args(client, makeSigner(client.calls)))).rejects.toThrow(/relay/)
  })

  // Review bulgu 1: cagiran (atsPaymaster.js sendOneOp) "islem zincire gitti mi" ayrimini
  // txHash'e bakarak yapiyor — txHash VARSA ayni nonce ile yeniden DENEMIYOR. Bu yuzden
  // relay basarisiz dedigi durumda bile hataya txHash iliştirilmis olmasi ZORUNLU.
  it('relay success:false ise hataya txHash iliştirir', async () => {
    const client = makeClient()
    const txHash = '0x' + 'a'.repeat(64)
    client.relay = vi.fn(async () => ({ success: false, txHash }))
    const err = await runSponsoredOp(args(client, makeSigner(client.calls))).catch((e) => e)
    expect(err.txHash).toBe(txHash)
  })
})
