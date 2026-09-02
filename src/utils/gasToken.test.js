import { describe, it, expect } from 'vitest'
import { isOptionInsufficient, pickDefaultGasToken } from './gasToken'

const USDC = '0xAAA0000000000000000000000000000000000000'
const USDT = '0xBBB0000000000000000000000000000000000000'

describe('isOptionInsufficient', () => {
  it('bakiye gas tahminini karsiliyorsa yeterli', () => {
    expect(isOptionInsufficient({ token: USDC, balance: 5, gasFee: 0.3 }, {})).toBe(false)
  })
  it('bakiye gas tahmininden kucukse yetersiz', () => {
    expect(isOptionInsufficient({ token: USDC, balance: 0.1, gasFee: 0.3 }, {})).toBe(true)
  })
  it('AYNI token gonderiliyorsa transfer miktari da eklenir', () => {
    // 0.5 bakiye, gas 0.3, gonderilen 0.3 USDC -> gereken 0.6 > 0.5 -> yetersiz
    const opt = { token: USDC, balance: 0.5, gasFee: 0.3 }
    expect(isOptionInsufficient(opt, { sentAssetAddress: USDC, sendAmount: '0.3' })).toBe(true)
    // farkli token gonderiliyorsa transfer eklenmez -> 0.3 <= 0.5 -> yeterli
    expect(isOptionInsufficient(opt, { sentAssetAddress: USDT, sendAmount: '0.3' })).toBe(false)
  })
  it('adres buyuk/kucuk harf duyarsiz eslesir', () => {
    const opt = { token: USDC, balance: 0.5, gasFee: 0.3 }
    expect(isOptionInsufficient(opt, { sentAssetAddress: USDC.toLowerCase(), sendAmount: '0.3' })).toBe(true)
  })
  it('gasFee bilinmiyorsa (0/undefined) yetersiz deme', () => {
    expect(isOptionInsufficient({ token: USDC, balance: 0 }, {})).toBe(false)
    expect(isOptionInsufficient({ token: USDC, balance: 0, gasFee: 0 }, {})).toBe(false)
  })
  it('opt yoksa false', () => {
    expect(isOptionInsufficient(null, {})).toBe(false)
  })
})

describe('pickDefaultGasToken', () => {
  it('gasi karsilayanlar arasinda en yuksek bakiyeliyi secer', () => {
    const opts = [
      { token: USDC, balance: 2, gasFee: 0.3 }, // yeterli
      { token: USDT, balance: 100, gasFee: 0.3 }, // yeterli + en yuksek
    ]
    expect(pickDefaultGasToken(opts, {})).toBe(USDT)
  })
  it('hicbiri gasi karsilamiyorsa null (native ETH kalir)', () => {
    const opts = [
      { token: USDC, balance: 0.1, gasFee: 0.3 },
      { token: USDT, balance: 0.2, gasFee: 0.3 },
    ]
    expect(pickDefaultGasToken(opts, {})).toBe(null)
  })
  it('ayni-token transfer maliyetini hesaba katar', () => {
    // USDT en yuksek bakiyeli ama gonderilen USDT + transfer onu yetersiz birakiyor;
    // USDC yeterli kaliyor -> USDC secilir.
    const opts = [
      { token: USDC, balance: 2, gasFee: 0.3 },        // yeterli
      { token: USDT, balance: 3, gasFee: 0.3 },        // 3 < 0.3 + 2.9 = 3.2 -> yetersiz
    ]
    expect(pickDefaultGasToken(opts, { sentAssetAddress: USDT, sendAmount: '2.9' })).toBe(USDC)
  })
  it('secenek yoksa null (native)', () => {
    expect(pickDefaultGasToken([], {})).toBe(null)
    expect(pickDefaultGasToken(undefined, {})).toBe(null)
  })
})
