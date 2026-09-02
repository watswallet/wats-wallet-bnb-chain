import { describe, it, expect } from 'vitest'
import { packAccountGasLimits, packGasFees, joinPaymasterAndData, buildPackedUserOp } from './userOpPack'

const PM = '0x767F90D739812D707719F3dcc131bD86BC2255f6'
// 52 byte = 20 byte paymaster + 32 byte gaz limitleri = 104 hex karakter
const PREFIX = PM + '0'.repeat(64)

describe('packAccountGasLimits', () => {
  it('verification ONCE, call SONRA (16+16 byte)', () => {
    const out = packAccountGasLimits(0x30d40, 0x186a0)
    expect(out).toHaveLength(2 + 64)
    expect(out.slice(2, 34)).toBe('00000000000000000000000000030d40') // verification
    expect(out.slice(34)).toBe('000000000000000000000000000186a0')   // call
  })
  it('string ve bigint girdiyi kabul eder', () => {
    expect(packAccountGasLimits('200000', 100000n)).toBe(packAccountGasLimits(200000, 100000))
  })
})

describe('packGasFees', () => {
  it('priority ONCE, max SONRA', () => {
    const out = packGasFees(1n, 2n)
    expect(out.slice(2, 34)).toBe('00000000000000000000000000000001') // priority
    expect(out.slice(34)).toBe('00000000000000000000000000000002')   // max
  })
})

describe('joinPaymasterAndData', () => {
  it('prefix + data birlestirilir, prefix DEGISTIRILMEZ', () => {
    expect(joinPaymasterAndData(PREFIX, '0xdeadbeef')).toBe(PREFIX + 'deadbeef')
  })
  it('bos paymasterData (normal mod) prefix aynen kalir', () => {
    expect(joinPaymasterAndData(PREFIX, '0x')).toBe(PREFIX)
    expect(joinPaymasterAndData(PREFIX, undefined)).toBe(PREFIX)
  })
  it('52 byte olmayan prefix reddedilir', () => {
    expect(() => joinPaymasterAndData(PM, '0x')).toThrow(/52 byte/i)
    expect(() => joinPaymasterAndData(PREFIX + '00', '0x')).toThrow(/52 byte/i)
  })

  // Finding 3: kuyruk (paymasterData) da dogrulanmali. Eskiden kor .slice(2) yapiliyordu;
  // 0x'siz bare hex gelirse ILK BYTE sessizce silinirdi (77 byte bootstrap imzasi 76'ya
  // duser) ve hata ancak zincirde AA34 olarak, yalnizca bootstrap kullanicilarinda
  // ortaya cikardi.
  it('0x on eki OLMAYAN bare hex reddedilir (ilk byte sessizce kaybolmaz)', () => {
    expect(() => joinPaymasterAndData(PREFIX, 'deadbeef')).toThrow(/0x on ekli/i)
  })
  it('tek sayida hex basamak reddedilir (tam byte degil)', () => {
    expect(() => joinPaymasterAndData(PREFIX, '0xabc')).toThrow(/hex/i)
  })
  it('hex olmayan karakter reddedilir', () => {
    expect(() => joinPaymasterAndData(PREFIX, '0xzzzz')).toThrow(/hex/i)
  })
  it('77 byte bootstrap imzasi tam olarak eklenir (154 hex basamak korunur)', () => {
    const sig = '0x' + 'ab'.repeat(77)
    const out = joinPaymasterAndData(PREFIX, sig)
    expect(out).toBe(PREFIX + 'ab'.repeat(77))
    // 52 + 77 = 129 byte = 258 hex basamagi + '0x'
    expect(out).toHaveLength(2 + 258)
  })
})

describe('buildPackedUserOp', () => {
  const GAS = { callGasLimit: 100000, verificationGasLimit: 200000, preVerificationGas: 50000 }
  const base = {
    sender: '0x1111111111111111111111111111111111111111',
    nonce: 5, callData: '0xabcd', gas: GAS,
    maxPriorityFeePerGas: 1000000000, maxFeePerGas: 10000000000,
    paymasterAndData: PREFIX,
  }

  it('dokuz alanli op uretir, initCode her zaman 0x', () => {
    const op = buildPackedUserOp(base)
    expect(Object.keys(op).sort()).toEqual([
      'accountGasLimits', 'callData', 'gasFees', 'initCode', 'nonce',
      'paymasterAndData', 'preVerificationGas', 'sender', 'signature',
    ])
    expect(op.initCode).toBe('0x')
  })
  it('imza verilmezse 0x olur', () => {
    expect(buildPackedUserOp(base).signature).toBe('0x')
  })
  it('paketlenmis alanlar ayri yardimcilarla ayni sonucu verir', () => {
    const op = buildPackedUserOp(base)
    expect(op.accountGasLimits).toBe(packAccountGasLimits(GAS.verificationGasLimit, GAS.callGasLimit))
    expect(op.gasFees).toBe(packGasFees(base.maxPriorityFeePerGas, base.maxFeePerGas))
  })
})
