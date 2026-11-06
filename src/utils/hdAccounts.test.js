import { describe, it, expect, vi, beforeAll } from 'vitest'

// Gercek TON turetmesi newAccountTonAddress.test.js'te kapsaniyor; burada konu
// HD hesap kaydinin kurulusu ve kasa birlestirme.
vi.mock('./ton/newAccountTonAddress', () => ({
    tonFieldsForNewAccount: vi.fn(async (_m, i) => ({ tonAddress: 'UQ-test-' + i, tonScheme: 'test' })),
}))

import { tonFieldsForNewAccount } from './ton/newAccountTonAddress'
import { deriveMasterKey, unlockVault } from './crypto-utils'
import {
    hdPath,
    countAccounts,
    defaultAccountName,
    buildHdAccount,
    buildHdAccounts,
    assembleHdVault,
} from './hdAccounts'

const JUNK = 'test test test test test test test test test test test junk'
// Bu ifadenin MetaMask/Trust yolundaki bilinen ilk uc adresi.
const HARDHAT = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
]
const t = (k) => (k === 'settings.createAccount.account_default' ? 'Wats' : k)

let masterKey
beforeAll(async () => {
    masterKey = await deriveMasterKey('parola-123', new Uint8Array(16))
})

describe('hdAccounts', () => {
    it('hdPath MetaMask/Trust yolunu uretir', () => {
        expect(hdPath(3)).toBe("m/44'/60'/0'/0/3")
    })

    it('countAccounts hesapsiz ve eksik kasalari 0 sayar', () => {
        expect(countAccounts([{ accounts: [1, 2] }, { accounts: [1] }, {}])).toBe(3)
        expect(countAccounts(undefined)).toBe(0)
    })

    it('defaultAccountName toplam + 1 + offset', () => {
        const vaults = [{ accounts: [1, 2, 3] }, { accounts: [1, 2] }]
        expect(defaultAccountName(t, vaults, 0)).toBe('Wats 6')
        expect(defaultAccountName(t, vaults, 2)).toBe('Wats 8')
    })

    it('buildHdAccount "hesap ekle" ile ayni alanlari uretir', async () => {
        const a = await buildHdAccount(JUNK + ' ', 1, { name: 'Wats 2', fingerprint: 'fp' })
        expect(Object.keys(a).sort()).toEqual(['address', 'createdAt', 'derivationPath', 'fingerprint', 'index', 'key', 'name', 'tonAddress', 'tonScheme', 'type'])
        expect(a).toMatchObject({ address: HARDHAT[1], derivationPath: "m/44'/60'/0'/0/1", index: 1, type: 'hd', name: 'Wats 2', fingerprint: 'fp', tonAddress: 'UQ-test-1', tonScheme: 'test' })
        expect(tonFieldsForNewAccount).toHaveBeenCalledWith(JUNK, 1) // kirpilmis ifade
        expect(typeof a.key).toBe('string')
    })

    it('buildHdAccounts indeks 0..n-1 uretir', async () => {
        const list = await buildHdAccounts(JUNK, 3)
        expect(list.map((a) => a.index)).toEqual([0, 1, 2])
        expect(list.map((a) => a.address)).toEqual(HARDHAT)
    })

    it('assembleHdVault adlari, parmak izini ve kasa icerigini kurar', async () => {
        const accounts = await buildHdAccounts(JUNK, 3)
        const vault = await assembleHdVault({ masterKey, mnemonic: JUNK, accounts, existingVaults: [{ accounts: [1, 2] }], t })
        expect(vault.type).toBe('hd')
        expect(vault.accounts.map((a) => a.name)).toEqual(['Wats 3', 'Wats 4', 'Wats 5'])
        expect(new Set(vault.accounts.map((a) => a.fingerprint))).toEqual(new Set([vault.fingerprint]))
        expect(await unlockVault(masterKey, vault)).toBe(JUNK)
    })

    it('assembleHdVault bos hesap listesinde firlatir', async () => {
        await expect(assembleHdVault({ masterKey, mnemonic: JUNK, accounts: [], existingVaults: [], t })).rejects.toThrow()
    })
})
