// EN KRITIK KURAL: /sponsor IMZADAN ONCE cagrilmali. getHash paymasterAndData'nin 20:52 arasi
// baytlarini (paymaster gaz limitleri) imzaya dahil eder; sonradan degistirmek imzayi SESSIZCE
// gecersiz kilar (zincirde AA34). Bu testler sirayi ve makbuz gecisini kilitler.
import { describe, it, expect, vi } from 'vitest'
import { hashTypedData, keccak256, recoverTypedDataAddress, recoverAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { TypedDataEncoder, verifyTypedData } from 'ethers'
import { runSponsoredOp, assertFeeAuthForOp } from './flow'

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

// CAPRAZ-ZINCIR UCRET YETKISI (K12). Backend tahsilattan ONCE odeyicinin EIP-712 imzasini
// ister (zorunlu modda imzasiz istek `xc-fee-auth-required`). Bozuk ya da ele gecirilmis bir
// backend kullaniciya BASKA bir op'un ucretini imzalatamasin: alanlar op'la tutmazsa IMZALANMAZ.
const COLLECTOR = '0xE39E4D2EAb51b7a77D2d6bf35b1C0501B7cB75cF'
const feeAuthFor = (msgOver = {}, over = {}) => ({
  domain: { name: 'ATS Crosschain Gas', version: '1', chainId: 56, verifyingContract: COLLECTOR },
  types: {
    XcFeeAuth: [
      { name: 'dstChainId', type: 'uint256' },
      { name: 'sender', type: 'address' },
      { name: 'nonce', type: 'uint256' },
      { name: 'callDataHash', type: 'bytes32' },
      { name: 'maxCostCap', type: 'uint256' },
      { name: 'atsAmount', type: 'uint256' },
      { name: 'deadline', type: 'uint64' },
    ],
  },
  primaryType: 'XcFeeAuth',
  message: {
    dstChainId: '8453', sender: SENDER, nonce: '5', callDataHash: keccak256('0x1234'),
    maxCostCap: '1000', atsAmount: '2628818214158662147', deadline: 1790000000, ...msgOver,
  },
  ...over,
})
const SIG = '0x' + 'ef'.repeat(65)
const withTypedSigner = (calls) => ({
  ...makeSigner(calls),
  signTypedData: vi.fn(async () => { calls.push('feeAuth'); return SIG }),
})

describe('runSponsoredOp — ucret yetkisi (K12)', () => {
  it('quote a nonce verilir; feeAuth imzalanip sponsor a feeAuthSignature olarak gider', async () => {
    const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
    const signer = withTypedSigner(client.calls)
    await runSponsoredOp(args(client, signer))
    expect(client.quote.mock.calls[0][3]).toBe(5n)
    expect(signer.signTypedData).toHaveBeenCalledWith(feeAuthFor())
    expect(client.calls.sponsorReq.feeAuthSignature).toBe(SIG)
    expect(client.calls.sponsorReq.quoteId).toBe('Q1')
    // Imza /sponsor'dan ONCE: sponsor tahsilati imzaya dayanir.
    expect([...client.calls]).toEqual(['quote', 'feeAuth', 'sponsor', 'sign', 'relay'])
  })

  it('signTypedData yoksa signDigest(hashTypedData) ile imzalanir', async () => {
    const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
    const signer = makeSigner(client.calls)
    await runSponsoredOp(args(client, signer))
    expect(signer.signDigest.mock.calls[0][0]).toBe(hashTypedData(feeAuthFor()))
    expect(client.calls.sponsorReq.feeAuthSignature).toBe('0x' + 'cd'.repeat(65))
  })

  it('feeAuth yoksa (ayni zincir) imza da alan da yok', async () => {
    const client = makeClient()
    const signer = withTypedSigner(client.calls)
    await runSponsoredOp(args(client, signer))
    expect(signer.signTypedData).not.toHaveBeenCalled()
    expect('feeAuthSignature' in client.calls.sponsorReq).toBe(false)
  })

  for (const [ne, fa] of [
    ['sender', feeAuthFor({ sender: '0x' + '2'.repeat(40) })],
    ['nonce', feeAuthFor({ nonce: '6' })],
    ['dstChainId', feeAuthFor({ dstChainId: '42161' })],
    ['callDataHash', feeAuthFor({ callDataHash: keccak256('0x9999') })],
    ['primaryType', feeAuthFor({}, { primaryType: 'Baska' })],
    ['domain.name', feeAuthFor({}, { domain: { name: 'Baska', version: '1', chainId: 56, verifyingContract: COLLECTOR } })],
    ['sayisal olmayan nonce', feeAuthFor({ nonce: 'abc' })],
  ]) {
    it(`feeAuth op a ait degilse (${ne}) IMZALANMAZ ve sponsor a GIDILMEZ`, async () => {
      const client = makeClient({ quote: { feeAuth: fa } })
      const signer = withTypedSigner(client.calls)
      await expect(runSponsoredOp(args(client, signer))).rejects.toThrow(/feeAuth bu op'a ait değil/)
      expect(signer.signTypedData).not.toHaveBeenCalled()
      expect(client.sponsor).not.toHaveBeenCalled()
    })
  }

  it('nonce ve dstChainId SAYISAL karsilastirilir ("0x5" == 5, "8453" == 8453)', () => {
    expect(() => assertFeeAuthForOp(feeAuthFor({ nonce: '0x5' }), {
      sender: SENDER.toUpperCase().replace('0X', '0x'), nonce: 5n, chainId: 8453, callData: '0x1234',
    })).not.toThrow()
  })

  it('onFeeAuth IMZADAN ONCE cagrilir; firlatirsa imzalanmaz ve sponsor a gidilmez', async () => {
    const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
    const signer = withTypedSigner(client.calls)
    const onFeeAuth = vi.fn(() => { throw new Error('tutar onaylanandan fazla') })
    await expect(runSponsoredOp(args(client, signer, { onFeeAuth }))).rejects.toThrow(/onaylanandan/)
    expect(onFeeAuth).toHaveBeenCalledWith(feeAuthFor(), { quoteId: 'Q1' })
    expect(signer.signTypedData).not.toHaveBeenCalled()
    expect(client.sponsor).not.toHaveBeenCalled()
  })

  it('onFeeAuthSigned imzadan sonra, sponsor dan ONCE beklenir (kalici kayit yazilabilsin)', async () => {
    const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
    const signer = withTypedSigner(client.calls)
    const onFeeAuthSigned = vi.fn(async (p) => {
      await new Promise((r) => setTimeout(r, 5))
      client.calls.push('kaydedildi')
      expect(p).toEqual({ feeAuth: feeAuthFor(), signature: SIG, quoteId: 'Q1' })
    })
    await runSponsoredOp(args(client, signer, { onFeeAuthSigned }))
    expect([...client.calls]).toEqual(['quote', 'feeAuth', 'kaydedildi', 'sponsor', 'sign', 'relay'])
  })

  // Rehber "Yeniden deneme" B.1: ayni govde — ayni quoteId VE ayni imza. Yeni imza (ya da imzasiz
  // istek) ayni tahsilatin tekrari sayilmaz.
  it('quoteId + feeAuthSignature verilince quote ve imza ATLANIR, ikisi de aynen gider', async () => {
    const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
    const signer = withTypedSigner(client.calls)
    await runSponsoredOp(args(client, signer, { quoteId: 'Q0', feeAuthSignature: SIG }))
    expect(client.quote).not.toHaveBeenCalled()
    expect(signer.signTypedData).not.toHaveBeenCalled()
    expect(client.calls.sponsorReq.quoteId).toBe('Q0')
    expect(client.calls.sponsorReq.feeAuthSignature).toBe(SIG)
  })

  it('makbuzla gidilirken imza GONDERILMEZ (sunucu makbuz yolunda imza istemez)', async () => {
    const client = makeClient()
    const signer = withTypedSigner(client.calls)
    await runSponsoredOp(args(client, signer, {
      settlement: { id: '0xset', atsAmount: '1' }, quoteId: 'Q0', feeAuthSignature: SIG,
    }))
    expect('feeAuthSignature' in client.calls.sponsorReq).toBe(false)
    expect('quoteId' in client.calls.sponsorReq).toBe(false)
  })

  it('kilitsiz bir imza tek basina gonderilmez', async () => {
    const client = makeClient()
    const signer = withTypedSigner(client.calls)
    await runSponsoredOp(args(client, signer, { feeAuthSignature: SIG }))
    expect(client.quote).toHaveBeenCalled()                       // kilit yok -> taze teklif
    expect('feeAuthSignature' in client.calls.sponsorReq).toBe(false)   // eski imza tasinmaz
  })
})

// GERCEK KRIPTO: sunucu ethers verifyTypedData ile dogrular. Mesaj ondalik DIZELER ve deadline
// sayi olarak gelir; viem bunlari EIP-712 olarak dogru kodlamali ve iki yol (signTypedData ile
// signDigest(hashTypedData)) AYNI imzayi uretmeli — aksi halde sunucu xc-fee-auth-invalid doner.
describe('ucret yetkisi imzasi gercek anahtarla odeyiciye cozulur', () => {
  const account = privateKeyToAccount('0x' + '11'.repeat(32))
  const fa = feeAuthFor({ sender: account.address })

  it('signTypedData imzasi sender a cozulur', async () => {
    const sig = await account.signTypedData(fa)
    expect(await recoverTypedDataAddress({ ...fa, signature: sig })).toBe(account.address)
  })

  // Sunucu ethers ile dogrular (server/xc-fee-auth.ts recoverXcFeePayer). viem'in urettigi hash
  // ve imza ethers'in kendi kodlayicisiyla da AYNI cikmali — iki kutuphane ayrisirsa sunucu
  // xc-fee-auth-invalid doner. Mesaj JSON'dan gecmis haliyle (ondalik dizeler, sayi deadline).
  it('ethers TypedDataEncoder ile ayni hash, ethers verifyTypedData ile ayni adres', async () => {
    const json = JSON.parse(JSON.stringify(fa))
    expect(TypedDataEncoder.hash(json.domain, json.types, json.message)).toBe(hashTypedData(json))
    const sig = await account.signTypedData(json)
    expect(verifyTypedData(json.domain, json.types, json.message, sig)).toBe(account.address)
  })

  it('ham hash imzasi (signDigest yolu) da ayni adrese cozulur', async () => {
    const sig = await account.sign({ hash: hashTypedData(fa) })
    expect(await recoverAddress({ hash: hashTypedData(fa), signature: sig })).toBe(account.address)
    expect(await recoverTypedDataAddress({ ...fa, signature: sig })).toBe(account.address)
  })
})

// Imzalayici bos ya da bicimsiz bir deger dondururse istek IMZASIZ gitmemeli: gecis modunda
// sunucu bunu imzasiz tahsilat sayar.
describe('runSponsoredOp — imza bicimi', () => {
  for (const kotu of ['', undefined, '0x', '0x' + 'ab'.repeat(10)]) {
    it(`imza ${JSON.stringify(kotu)} ise sponsor a GIDILMEZ`, async () => {
      const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
      const signer = { ...makeSigner(client.calls), signTypedData: vi.fn(async () => kotu) }
      await expect(runSponsoredOp(args(client, signer))).rejects.toMatchObject({ code: 'xc-fee-auth-signature' })
      expect(client.sponsor).not.toHaveBeenCalled()
    })
  }

  it('64 baytlik (EIP-2098) imza kabul edilir', async () => {
    const client = makeClient({ quote: { feeAuth: feeAuthFor() } })
    const signer = { ...makeSigner(client.calls), signTypedData: vi.fn(async () => '0x' + 'ab'.repeat(64)) }
    await runSponsoredOp(args(client, signer))
    expect(client.calls.sponsorReq.feeAuthSignature).toBe('0x' + 'ab'.repeat(64))
  })
})
