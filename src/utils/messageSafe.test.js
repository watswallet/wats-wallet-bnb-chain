// chrome.runtime.sendMessage'in serilestirme siniri.
//
// GERCEK VAKA (2026-08-09, Ethereum mainnet): onay ekraninda "Ucret hesaplanamadi" cikiyordu.
// Giden govde tertemizdi (chainId/address/call ucu de klonlanabiliyordu) ama Chrome yine
// "Could not serialize message." atiyordu — cunku hata YANITTAN geliyordu: `quoteAtsTransfer`
// donusunde `gas` (alti BigInt alan) ve `maxPriorityFeePerGas` (BigInt) var ve `atsFeeQuote`
// bunlari oldugu gibi popup'a yolluyordu. Chrome hatayi GONDERENIN promise'ine dusurdugu icin
// sorun giden govdede saniliyordu.
import { describe, it, expect } from 'vitest'
import { toMessageSafe } from './messageSafe'

describe('toMessageSafe', () => {
  it('BigInt i string e cevirir', () => {
    expect(toMessageSafe(10n)).toBe('10')
    expect(toMessageSafe({ a: 1n })).toEqual({ a: '1' })
  })

  it('ic ice nesne ve dizilerde de cevirir', () => {
    expect(toMessageSafe({ gas: { callGasLimit: 1n, list: [2n, { x: 3n }] } }))
      .toEqual({ gas: { callGasLimit: '1', list: ['2', { x: '3' }] } })
  })

  it('BigInt olmayan degerleri AYNEN birakir', () => {
    const input = { s: 'x', n: 1, b: true, z: null, u: undefined, arr: [1, 'a'] }
    expect(toMessageSafe(input)).toEqual(input)
  })

  it('null/undefined govdeyi patlatmaz', () => {
    expect(toMessageSafe(null)).toBe(null)
    expect(toMessageSafe(undefined)).toBe(undefined)
  })

  it('GERCEK VAKA: quote yaniti oncesinde klonlanamaz, sonrasinda klonlanabilir', () => {
    // quoteAtsTransfer'in gercek donus sekli (ilgili kismi).
    const quote = {
      ready: true,
      mode: 'crosschain',
      transferFee: 1.25,
      opCount: 1,
      gas: {
        callGasLimit: 125000n, verificationGasLimit: 375000n, preVerificationGas: 125000n,
        paymasterVerificationGasLimit: 250000n, paymasterPostOpGasLimit: 0n,
        maxFeePerGas: 3000000000n,
      },
      maxPriorityFeePerGas: 100000000n,
    }
    // Duzeltmeden ONCE olan durum: mesajlasma sinirindan GECEMEZ.
    // Sinir JSON'dur, structuredClone DEGIL — structuredClone BigInt'i kabul eder, Chrome etmez.
    expect(() => JSON.stringify({ success: true, ...quote })).toThrow(/BigInt/)
    // Sonrasi: gecer ve ekranin okudugu alanlar bozulmadan kalir.
    const safe = toMessageSafe({ success: true, ...quote })
    expect(() => JSON.stringify(safe)).not.toThrow()
    expect(safe.transferFee).toBe(1.25)
    expect(safe.mode).toBe('crosschain')
    expect(safe.gas.callGasLimit).toBe('125000')
  })
})
