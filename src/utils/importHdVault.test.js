import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { installChromeStub } from '../test-utils/ssrRender.js'

// Gercek TON turetmesi newAccountTonAddress.test.js'te kapsaniyor (hdAccounts.test.js ile ayni).
vi.mock('./ton/newAccountTonAddress', () => ({
    tonFieldsForNewAccount: vi.fn(async (_m, i) => ({ tonAddress: 'UQ-test-' + i, tonScheme: 'test' })),
}))

// Yaris testi icin `createVault` sarilir: kasa kurulurken (yani `vaults` ilk okunduktan
// SONRA, yazimdan ONCE) baska bir pencere depoya yazmis gibi davranilir. Gercek
// `createVault` aynen calisir; sadece oncesinde `hooks.onCreateVault` beklenir.
const hooks = vi.hoisted(() => ({ onCreateVault: null }))
vi.mock('./crypto-utils', async (importOriginal) => {
    const orig = await importOriginal()
    return {
        ...orig,
        createVault: vi.fn(async (...args) => {
            await hooks.onCreateVault?.()
            return orig.createVault(...args)
        }),
    }
})

import { deriveMasterKey } from './crypto-utils'
import { buildHdAccounts } from './hdAccounts'
import { addHdVaultToWallet } from './importHdVault'

const JUNK = 'test test test test test test test test test test test junk'
const FP = 'parmak-izi-yeni-seed'
const t = (k) => (k === 'settings.createAccount.account_default' ? 'Wats' : k)

// Depoda onceden duran, baska bir seed'e ait 1 hesapli kasa.
const mevcutKasa = () => ({
    id: 'mevcut',
    type: 'hd',
    fingerprint: 'parmak-izi-eski-seed',
    accounts: [{ key: 'eski-hesap', index: 0, name: 'Wats 1', fingerprint: 'parmak-izi-eski-seed' }],
})

let masterKey
let store
let setSpy
let accounts

beforeAll(async () => {
    masterKey = await deriveMasterKey('parola-123', new Uint8Array(16))
})

beforeEach(async () => {
    ;({ localStore: store } = installChromeStub({ vaults: [mevcutKasa()] }))
    setSpy = vi.spyOn(globalThis.chrome.storage.local, 'set')
    hooks.onCreateVault = null
    // assembleHdVault hesap nesnelerini yerinde degistirir; her test taze liste kullanir.
    accounts = await buildHdAccounts(JUNK, 3)
})

afterEach(() => {
    delete globalThis.chrome
})

describe('addHdVaultToWallet', () => {
    it('3 hesabi TEK set ile yazar; yazilan anahtarlar yalniz vaults ve active_account', async () => {
        const r = await addHdVaultToWallet({ masterKey, mnemonic: JUNK, fingerprint: FP, accounts, t })
        expect(r.status).toBe('added')
        expect(setSpy).toHaveBeenCalledTimes(1)
        expect(Object.keys(setSpy.mock.calls[0][0]).sort()).toEqual(['active_account', 'vaults'])
        expect(store.vaults).toHaveLength(2)
        expect(store.vaults[1].accounts.map((a) => a.index)).toEqual([0, 1, 2])
        expect(store.vaults[1].accounts.map((a) => a.name)).toEqual(['Wats 2', 'Wats 3', 'Wats 4'])
        expect(store.active_account.key).toBe(store.vaults[1].accounts[0].key) // aktif hesap = Hesap 1
    })

    it('donus degeri yazilan kasayi ve hesaplarini verir', async () => {
        const r = await addHdVaultToWallet({ masterKey, mnemonic: JUNK, fingerprint: FP, accounts, t })
        expect(r.vault).toBe(store.vaults[1])
        expect(r.accounts).toBe(r.vault.accounts)
        expect(store.vaults[0].id).toBe('mevcut') // onceki kasa yerinde
    })

    it('mukerrer parmak izi: status duplicate ve HIC yazim yok', async () => {
        store.vaults = [{ ...mevcutKasa(), fingerprint: FP }]
        expect(await addHdVaultToWallet({ masterKey, mnemonic: JUNK, fingerprint: FP, accounts, t })).toEqual({ status: 'duplicate' })
        expect(setSpy).not.toHaveBeenCalled()
        expect(store.vaults).toHaveLength(1)
    })

    it('yazimdan hemen once taze okur: yazma sirasinda baska pencerenin ekledigi kasa EZILMEZ', async () => {
        hooks.onCreateVault = async () => {
            store.vaults = [...store.vaults, { id: 'baska', type: 'hd', fingerprint: 'x', accounts: [{ key: 'k' }] }]
        }
        await addHdVaultToWallet({ masterKey, mnemonic: JUNK, fingerprint: FP, accounts, t })
        expect(store.vaults.map((v) => v.id)).toContain('baska')
        expect(store.vaults).toHaveLength(3)
    })

    it('yazma sirasinda baska pencere AYNI seed i eklediyse: duplicate ve HIC yazim yok', async () => {
        hooks.onCreateVault = async () => {
            store.vaults = [...store.vaults, { id: 'ayni-seed', type: 'hd', fingerprint: FP, accounts: [{ key: 'k' }] }]
        }
        expect(await addHdVaultToWallet({ masterKey, mnemonic: JUNK, fingerprint: FP, accounts, t })).toEqual({ status: 'duplicate' })
        expect(setSpy).not.toHaveBeenCalled()
        expect(store.vaults.map((v) => v.id)).toEqual(['mevcut', 'ayni-seed'])
    })

    it('tum hesaplar kasayla ayni parmak izini tasir', async () => {
        const { vault } = await addHdVaultToWallet({ masterKey, mnemonic: JUNK, fingerprint: FP, accounts, t })
        expect(vault.accounts.every((a) => a.fingerprint === vault.fingerprint)).toBe(true)
    })
})
