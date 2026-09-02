import { describe, it, expect } from 'vitest'
import { pickDisplayAddress } from './useDisplayAddress'

const EVM = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const TON = 'UQAgPlDEUtqTMAJ1fpGT0AFebk85pdtOYKq72I5Eq9VIIy1P'

describe('pickDisplayAddress', () => {
    it('EVM aginda EVM adresi gosterilir', () => {
        expect(pickDisplayAddress({ chain: { chainId: 1 }, evmAddress: EVM, tonAddress: TON })).toBe(EVM)
    })

    it('TON aginda TON adresi gosterilir', () => {
        expect(pickDisplayAddress({ chain: { chainId: -239, kind: 'ton' }, evmAddress: EVM, tonAddress: TON })).toBe(TON)
    })

    it('TON aginda TON adresi HENUZ YOKSA hicbir sey gosterilmez', () => {
        // 0x'e geri dusmek yasak: kullanici TON'u EVM adresine gonderir ve para gider.
        expect(pickDisplayAddress({ chain: { chainId: -239, kind: 'ton' }, evmAddress: EVM, tonAddress: null })).toBeNull()
        expect(pickDisplayAddress({ chain: { chainId: -239, kind: 'ton' }, evmAddress: EVM, tonAddress: '' })).toBeNull()
    })

    it('zincir cozulemediginde EVM adresi gosterilir', () => {
        expect(pickDisplayAddress({ chain: null, evmAddress: EVM, tonAddress: TON })).toBe(EVM)
    })

    it('hicbir adres yoksa null doner', () => {
        expect(pickDisplayAddress({ chain: { chainId: 1 }, evmAddress: null, tonAddress: null })).toBeNull()
    })
})
