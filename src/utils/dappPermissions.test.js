import { describe, it, expect } from 'vitest'
import {
    ETH_ACCOUNTS_CAPABILITY,
    RESTRICT_RETURNED_ACCOUNTS,
    buildPermissions,
    parseRevokeParams,
} from './dappPermissions'

/**
 * EIP-2255 izin sekilleri ve `wallet_revokePermissions` parametre ayristirma
 * (SAF modul: chrome yok).
 */

const ORIGIN = 'https://dapp.example'
const A = '0xAaaaaa0000000000000000000000000000000001'
const B = '0xBbbbbb0000000000000000000000000000000002'

describe('sabitler', () => {
    it('izin adi ve kisit tipi EIP-2255 / MetaMask adlaridir', () => {
        expect(ETH_ACCOUNTS_CAPABILITY).toBe('eth_accounts')
        expect(RESTRICT_RETURNED_ACCOUNTS).toBe('restrictReturnedAccounts')
    })
})

describe('buildPermissions', () => {
    it('TEK izin: invoker = gonderen origin, parentCapability = eth_accounts, kisit = sirali hesaplar, date = connectedAt', () => {
        const record = { accounts: [B, A], connectedAt: 1_700_000_000_000, allowedChains: [1, 10], chainId: '0x1', favicon: 'x' }
        const result = buildPermissions({ origin: ORIGIN, record, orderedAccounts: [A, B] })

        expect(result).toEqual([{
            invoker: ORIGIN,
            parentCapability: 'eth_accounts',
            caveats: [{ type: 'restrictReturnedAccounts', value: [A, B] }],
            date: 1_700_000_000_000,
        }])
    })

    it('wagmi yolu: permissions[0].caveats[0].value hesap dizisidir', () => {
        const result = buildPermissions({ origin: ORIGIN, record: {}, orderedAccounts: [A] })
        expect(result[0].caveats[0].value).toEqual([A])
    })

    it('`allowedChains` / `gasless` / `favicon` gibi ic alanlar izin olarak ACILMAZ', () => {
        const record = { accounts: [A], connectedAt: 1, allowedChains: [1], gasless: true, favicon: 'x', followActive: true }
        const json = JSON.stringify(buildPermissions({ origin: ORIGIN, record, orderedAccounts: [A] }))

        for (const sizinti of ['allowedChains', 'gasless', 'favicon', 'followActive']) expect(json).not.toContain(sizinti)
    })

    it('eski kayitta `connectedAt` yoksa `date` alani HIC yazilmaz (undefined degil, anahtar yok)', () => {
        for (const record of [{}, { connectedAt: undefined }, { connectedAt: 'dun' }, { connectedAt: NaN }, undefined]) {
            const [permission] = buildPermissions({ origin: ORIGIN, record, orderedAccounts: [A] })
            expect(permission).not.toHaveProperty('date')
        }
    })

    it('hesap listesi KOPYALANIR (sonucu degistirmek girdiyi bozmaz)', () => {
        const ordered = [A, B]
        const [permission] = buildPermissions({ origin: ORIGIN, record: {}, orderedAccounts: ordered })
        permission.caveats[0].value.push('x')

        expect(ordered).toEqual([A, B])
    })

    it('hesap yoksa izin YOK: bos / dizi olmayan -> []', () => {
        expect(buildPermissions({ origin: ORIGIN, record: {}, orderedAccounts: [] })).toEqual([])
        expect(buildPermissions({ origin: ORIGIN, record: {}, orderedAccounts: undefined })).toEqual([])
        expect(buildPermissions({ origin: ORIGIN, record: {}, orderedAccounts: 'x' })).toEqual([])
    })

    it('origin gecersizse izin YOK -> []', () => {
        for (const origin of [undefined, null, '', 42]) {
            expect(buildPermissions({ origin, record: {}, orderedAccounts: [A] })).toEqual([])
        }
    })
})

describe('parseRevokeParams', () => {
    it('[{ eth_accounts: {} }] -> ok, eth_accounts iptal edilir', () => {
        expect(parseRevokeParams([{ eth_accounts: {} }])).toEqual({ ok: true, value: { revokesEthAccounts: true } })
    })

    it('eth_accounts + baska anahtar -> ok, eth_accounts iptal edilir', () => {
        expect(parseRevokeParams([{ eth_accounts: {}, eth_chainId: {} }])).toEqual({ ok: true, value: { revokesEthAccounts: true } })
    })

    it('yalniz baska anahtar -> ok ama eth_accounts IPTAL EDILMEZ (hosgorulu, yok sayilir)', () => {
        expect(parseRevokeParams([{ eth_chainId: {} }])).toEqual({ ok: true, value: { revokesEthAccounts: false } })
    })

    it('eth_accounts degeri ne olursa olsun (ornegin null) anahtarin VARLIGI yeter', () => {
        expect(parseRevokeParams([{ eth_accounts: null }]).value.revokesEthAccounts).toBe(true)
    })

    it.each([
        ['params yok', undefined],
        ['params dizi degil', { eth_accounts: {} }],
        ['bos dizi', []],
        ['null', [null]],
        ['bos nesne', [{}]],
        ['dizi', [[{ eth_accounts: {} }]]],
        ['metin', ['eth_accounts']],
        ['sayi', [1]],
        ['bool', [true]],
    ])('%s -> -32602', (_ad, params) => {
        expect(parseRevokeParams(params)).toEqual({ ok: false, error: { code: -32602, message: expect.any(String) } })
    })

    it('JSON `__proto__` anahtari DUZ anahtar sayilir: ok, eth_accounts degil; Object.prototype KIRLENMEZ', () => {
        const hostile = JSON.parse('{"__proto__":{"polluted":true}}')
        expect(parseRevokeParams([hostile])).toEqual({ ok: true, value: { revokesEthAccounts: false } })
        expect({}.polluted).toBeUndefined()
    })

    it('prototip zincirindeki `eth_accounts` SAYILMAZ (yalniz kendi anahtari)', () => {
        const inherited = Object.create({ eth_accounts: {} })
        inherited.baska = {}
        expect(parseRevokeParams([inherited]).value.revokesEthAccounts).toBe(false)
    })
})
