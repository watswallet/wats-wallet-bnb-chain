import { describe, it, expect } from 'vitest'
import { isRevertError } from './dappGasPreflight'

// KURAL: yalnizca "cagri zincirde duser" diyen hata gonderimi durdurur.
//
// Iki yanlis yon de gercek zarar veriyor:
//   fazla durdurmak -> 0 native'li kullanici (ATS kolunun TUM hedef kitlesi) hicbir
//                      dapp islemi yapamaz; "insufficient funds" tam olarak onun hali.
//   az durdurmak    -> dusen op yayinlanir, paymaster ATS'i yine tahsil eder ve dapp
//                      geri donen hash'i "basarili" sanar.

describe('isRevertError', () => {
  it('ethers CALL_EXCEPTION revert sayilir', () => {
    expect(isRevertError({ code: 'CALL_EXCEPTION', shortMessage: 'execution reverted' })).toBe(true)
  })

  it('saglayici kodu 3 (geth ailesi) revert sayilir', () => {
    // CANLI OLCUM (BSC, gasPrice:0 ile): var olmayan fonksiyona cagri boyle doner.
    expect(isRevertError({ info: { error: { code: 3, message: 'execution reverted: 0x' } } })).toBe(true)
    expect(isRevertError({ error: { code: 3, message: 'execution reverted' } })).toBe(true)
  })

  it('duz metin "execution reverted" revert sayilir', () => {
    expect(isRevertError(new Error('execution reverted'))).toBe(true)
  })

  it('yetersiz bakiye revert DEGILDIR', () => {
    // CANLI OLCUM (BSC, 0 BNB'li adres): -32000 + "insufficient funds for gas * price
    // + value". Bu bir engel degil; ekranda kendi karti var.
    const err = new Error('failed with 16777216 gas: insufficient funds for gas * price + value: address 0x.. have 0 want 1000000000000000000')
    err.code = -32000
    expect(isRevertError(err)).toBe(false)
  })

  it('yetersiz bakiye, "revert" kelimesi ayni metinde gecse bile revert DEGILDIR', () => {
    // Bazi ucler iki ifadeyi birlestirip donuyor; bakiye kontrolu once gelmezse
    // desen eslemesi bu metni yanlislikla engel sayardi.
    expect(isRevertError(new Error('insufficient funds; would revert'))).toBe(false)
  })

  it('ag/altyapi hatasi durdurmaz', () => {
    expect(isRevertError(new Error('could not detect network'))).toBe(false)
    expect(isRevertError({ code: 'TIMEOUT', message: 'request timeout' })).toBe(false)
  })

  it('hata yoksa durdurmaz', () => {
    expect(isRevertError(null)).toBe(false)
    expect(isRevertError(undefined)).toBe(false)
  })
})
