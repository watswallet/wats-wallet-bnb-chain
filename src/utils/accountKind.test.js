import { describe, it, expect } from 'vitest'
import { isTonOnlyAccount, chainsForAccount, accountSupportsChain } from './accountKind'

const TON = { chainId: -239, name: 'TON' }
const TON_TESTNET = { chainId: -3, name: 'TON Testnet' }
const ETH = { chainId: 1, name: 'Ethereum' }
const ALL = [ETH, TON, TON_TESTNET]

describe('isTonOnlyAccount', () => {
    it("type 'ton' olan hesap TON'a kilitlidir", () => {
        expect(isTonOnlyAccount({ type: 'ton' })).toBe(true)
    })

    it('diger hesap tipleri kilitli DEGILDIR', () => {
        expect(isTonOnlyAccount({ type: 'hd' })).toBe(false)
        expect(isTonOnlyAccount({ type: 'imported' })).toBe(false)
        expect(isTonOnlyAccount({ type: 'privateKey' })).toBe(false)
    })

    // FAIL-OPEN. Hesap okunamadiysa kilit UYGULANMAZ: acilista active_account
    // bir an bos olabiliyor ve o anda kilidi uygulamak, TON'u degil BUTUN
    // agları kapatirdi.
    it('hesap yoksa kilit uygulanmaz', () => {
        expect(isTonOnlyAccount(null)).toBe(false)
        expect(isTonOnlyAccount(undefined)).toBe(false)
        expect(isTonOnlyAccount({})).toBe(false)
    })
})

describe('chainsForAccount', () => {
    it('TON hesabina YALNIZCA TON aglari listelenir', () => {
        expect(chainsForAccount({ type: 'ton' }, ALL)).toEqual([TON, TON_TESTNET])
    })

    it('normal hesaba liste AYNEN doner', () => {
        expect(chainsForAccount({ type: 'hd' }, ALL)).toBe(ALL)
    })
})

describe('accountSupportsChain', () => {
    it('TON hesabi TON zincirini destekler', () => {
        expect(accountSupportsChain({ type: 'ton' }, TON)).toBe(true)
        expect(accountSupportsChain({ type: 'ton' }, -3)).toBe(true)
    })

    it('TON hesabi EVM zincirini DESTEKLEMEZ', () => {
        expect(accountSupportsChain({ type: 'ton' }, ETH)).toBe(false)
        expect(accountSupportsChain({ type: 'ton' }, 1)).toBe(false)
    })

    it('normal hesap her zinciri destekler', () => {
        expect(accountSupportsChain({ type: 'hd' }, ETH)).toBe(true)
        expect(accountSupportsChain({ type: 'hd' }, TON)).toBe(true)
    })
})
