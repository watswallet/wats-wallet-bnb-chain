import { describe, it, expect, beforeAll } from 'vitest'
import { createVault, deriveMasterKey, randBytes } from '../crypto-utils'
import { exportTonKey } from './tonExport'
import { tonIdentityForAccount } from './tonIdentity'

const MNEMONIC = 'test test test test test test test test test test test junk'

describe('exportTonKey', () => {
    let masterKey
    let vault

    beforeAll(async () => {
        masterKey = await deriveMasterKey('parola-123456', randBytes(32))
        vault = await createVault(masterKey, MNEMONIC, {
            key: 'hd-0', address: '0x' + 'a'.repeat(40), type: 'hd', index: 0,
        })
    })

    it('disa aktarilan anahtar hesabin ADRESINI uretir', async () => {
        // Kurtarma yolunun tek anlami bu: anahtar, gosterilen adresi acmali.
        const exported = await exportTonKey(masterKey, [vault], vault.accounts[0])
        const identity = await tonIdentityForAccount(masterKey, [vault], vault.accounts[0])
        expect(exported.friendly).toBe(identity.friendly)
    })

    it('anahtar 64 baytlik ed25519 gizli anahtaridir', async () => {
        const exported = await exportTonKey(masterKey, [vault], vault.accounts[0])
        expect(exported.secretKeyHex).toMatch(/^[0-9a-f]{128}$/)
    })

    it('kasasi bulunamayan hesap hata verir', async () => {
        await expect(exportTonKey(masterKey, [vault], { key: 'yok', address: '0x' + '9'.repeat(40) }))
            .rejects.toThrow('ACCOUNT_VAULT_NOT_FOUND')
    })
})
