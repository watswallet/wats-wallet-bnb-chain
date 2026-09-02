import { describe, it, expect } from 'vitest'
import { dappValueToWei, dappValueToEtherString } from './dappNativeValue'

/**
 * eth_sendTransaction `value` alani HER ZAMAN wei'dir (hex quantity onerilir ama
 * web3.js gibi kutuphaneler decimal string / Number da gonderir). Onceki kod
 * yalniz '0x' onekli degerleri wei sayiyordu: decimal-wei bir deger ETH gibi
 * yorumlanip 1e18 kat sisiyor, '0x' (yaygin sifir kodlamasi) ise BigInt('0x')
 * ile ekran kurulumunu cokertiyordu.
 */
describe('dappValueToWei', () => {
    it('hex quantity wei olarak cozulur', () => {
        expect(dappValueToWei('0x38d7ea4c68000')).toBe(1000000000000000n)
        expect(dappValueToWei('0x1')).toBe(1n)
    })

    it('decimal string de WEI sayilir (web3.js), ETH DEGIL', () => {
        expect(dappValueToWei('15000000000000000')).toBe(15000000000000000n)
    })

    it('Number da WEI sayilir', () => {
        expect(dappValueToWei(15000000000000000)).toBe(15000000000000000n)
    })

    it("bos/sifir kodlamalari 0n doner ve COKMEZ: '0x', '0x0', '', null, undefined", () => {
        expect(dappValueToWei('0x')).toBe(0n)
        expect(dappValueToWei('0x0')).toBe(0n)
        expect(dappValueToWei('')).toBe(0n)
        expect(dappValueToWei(null)).toBe(0n)
        expect(dappValueToWei(undefined)).toBe(0n)
    })

    it('anlamsiz deger sessizce gecmez, firlatir', () => {
        expect(() => dappValueToWei('abc')).toThrow()
        expect(() => dappValueToWei('1.5')).toThrow()
    })
})

describe('dappValueToEtherString', () => {
    it('wei degerini insan-okur ether dizgesine cevirir', () => {
        expect(dappValueToEtherString('15000000000000000')).toBe('0.015')
        expect(dappValueToEtherString('0x38d7ea4c68000')).toBe('0.001')
    })

    it("sifir kodlamalari '0' doner", () => {
        expect(dappValueToEtherString('0x')).toBe('0')
        expect(dappValueToEtherString('0x0')).toBe('0')
        expect(dappValueToEtherString(undefined)).toBe('0')
    })
})
