// NATIVE KOPRU — kullanici native'ini koprulyebilir, yalnizca GAZI ATS ile oder.
//
// Onceki kural `transactionRequest.value > 0` olan her rotayi FAIL-CLOSED eliyordu ve
// gerekcesi "paymaster msg.value'yu odemez" idi. Dogru ama SONUCU yanlis: msg.value
// kullanicinin KENDI hesabindan cikar ve kullanici zaten o native'i kopruluyor.
// Swap tarafinda ayni gerekce zaten "native girdili swap ENGELLENMEZ" diye yaziliydi.
//
// Geriye tek gercek kosul kaldi: hesap `value` kadar native tasiyor mu.
import { describe, it, expect, vi } from 'vitest'
import { buildBridgeCalls } from './bridge'

const TO = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const OWNER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const NATIVE = '0x0'
const providerWith = (balance) => ({ getBalance: vi.fn(async () => balance) })

describe('native girdili kopru', () => {
  it('bakiye YETIYORSA gecer ve deger cagriya TASINIR', async () => {
    const value = '0xde0b6b3a7640000' // 1e18
    const calls = await buildBridgeCalls({
      to: TO, data: '0xabcd', value, fromTokenAddress: NATIVE, owner: OWNER,
      amountRaw: '1000000000000000000', provider: providerWith(2n * 10n ** 18n),
    })
    expect(calls).toHaveLength(1)              // native tarafta approve YOK
    expect(calls[0].to).toBe(TO)
    expect(calls[0].value).toBe(10n ** 18n)    // 0n DEGIL
  })

  // Yetmezse op zincirde duser ve BSC'de bir bootstrap hakki yanar: imzadan ONCE durulur.
  it('bakiye YETMIYORSA imzadan once durur', async () => {
    await expect(buildBridgeCalls({
      to: TO, data: '0xabcd', value: '0xde0b6b3a7640000', fromTokenAddress: NATIVE,
      owner: OWNER, amountRaw: '1000000000000000000',
      provider: providerWith(10n ** 17n),      // 0.1 < 1
    })).rejects.toMatchObject({ code: 'insufficient-native-for-value' })
  })

  it('deger cozulemezse 0 VARSAYILMAZ, gonderilmez', async () => {
    await expect(buildBridgeCalls({
      to: TO, data: '0xabcd', value: 'bozuk', fromTokenAddress: NATIVE, owner: OWNER,
      amountRaw: '1', provider: providerWith(10n ** 20n),
    })).rejects.toMatchObject({ code: 'route-value-unreadable' })
  })

  it('value 0 olan ERC20 rotasinda bakiye HIC okunmaz', async () => {
    const provider = providerWith(0n)
    const calls = await buildBridgeCalls({
      to: TO, data: '0xabcd', value: '0x0', fromTokenAddress: NATIVE, owner: OWNER,
      amountRaw: '0', provider,
    })
    expect(provider.getBalance).not.toHaveBeenCalled()
    expect(calls[0].value).toBe(0n)
  })
})
