import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    createVault,
    createVaultWithPrivateKey,
    decryptSecret,
    deriveMasterKey,
    encryptMnemonicWithMaster,
    randBytes,
    toHex,
    unlockVault
} from './crypto-utils'
import { changeWalletPassword } from './passwordChange'
import { verifyPassword } from './masterKey'

// Bu dosya 1 numaralı bugun ASIL nedenini koruyor: YAZIM SIRASI.
//
// Eski kod walletSalt ve jwk'yı kasalardan ÖNCE ayrı ayrı yazıyordu. Araya düşen
// bir hata (ki her zaman düşüyordu) diskte yeni salt/jwk + eski anahtarla şifreli
// kasalar bırakıyordu; ne eski ne yeni şifre cüzdanı açabiliyordu.
//
// Kripto tarafı cryptoUtils.reencrypt.test.js'te. Buradaki testler yalnızca şunu
// garanti eder: başarıda TEK yazım, hatada SIFIR yazım.

const MNEMONIC = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = '0x' + '11'.repeat(32)
const OLD_PASSWORD = 'eski-parola-123'
const NEW_PASSWORD = 'yeni-parola-456'

function makeStorage(initial) {
    const store = JSON.parse(JSON.stringify(initial))

    return {
        store,
        get: vi.fn(async (keys) => {
            const out = {}
            for (const key of [].concat(keys)) out[key] = store[key]
            return out
        }),
        set: vi.fn(async (changes) => {
            Object.assign(store, JSON.parse(JSON.stringify(changes)))
        })
    }
}

async function unlockAll(password, store) {
    const salt = new Uint8Array(store.walletSalt.match(/.{1,2}/g).map(b => parseInt(b, 16)))
    const masterKey = await deriveMasterKey(password, salt)

    return Promise.all(store.vaults.map(vault => unlockVault(masterKey, vault)))
}

describe('changeWalletPassword — yazım sırası', () => {
    let baseStore

    beforeEach(async () => {
        const oldSalt = randBytes(32)
        const oldMasterKey = await deriveMasterKey(OLD_PASSWORD, oldSalt)
        const oldJwk = await crypto.subtle.exportKey('jwk', oldMasterKey)

        const hdVault = await createVault(oldMasterKey, MNEMONIC, {
            key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001', name: 'Hesap 1', type: 'hd'
        })
        const pkVault = await createVaultWithPrivateKey(oldMasterKey, PRIVATE_KEY, {
            key: 'acc-2', address: '0xBbB0000000000000000000000000000000000002', name: 'Hesap 2', type: 'imported'
        })

        baseStore = {
            walletSalt: toHex(oldSalt),
            jwk: JSON.stringify(oldJwk),
            vaults: [hdVault, pkVault],
            active_account: { key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001', name: 'Hesap 1', type: 'hd' }
        }
    }, 60000)

    it('başarıda TAM OLARAK BİR kez yazar ve salt/vaults aynı çağrıda gider', async () => {
        const storage = makeStorage(baseStore)

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        expect(storage.set).toHaveBeenCalledTimes(1)

        const written = storage.set.mock.calls[0][0]
        expect(Object.keys(written).sort()).toEqual(['needsPasswordRotation', 'vaults', 'walletSalt'])
        expect(written.walletSalt).not.toBe(baseStore.walletSalt)
    }, 60000)

    it('rotasyon uyarısı bayrağını aynı tek yazımda temizler', async () => {
        const storage = makeStorage({ ...baseStore, needsPasswordRotation: true })

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        expect(storage.set).toHaveBeenCalledTimes(1)
        expect(storage.store.needsPasswordRotation).toBe(false)
    }, 60000)

    it('şifre değişimi başarısız olursa bayrak korunur — uyarı gösterilmeye devam eder', async () => {
        const bozuk = JSON.parse(JSON.stringify(baseStore))
        bozuk.vaults[1].mnemonic = bozuk.vaults[0].mnemonic
        bozuk.needsPasswordRotation = true

        const storage = makeStorage(bozuk)

        await expect(
            changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
        ).rejects.toThrow()

        expect(storage.set).not.toHaveBeenCalled()
        expect(storage.store.needsPasswordRotation).toBe(true)
    }, 60000)

    it('master key\'i ASLA diske yazmaz', async () => {
        const storage = makeStorage(baseStore)

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        for (const call of storage.set.mock.calls) {
            expect(call[0]).not.toHaveProperty('jwk')
            expect(call[0]).not.toHaveProperty('sessionMasterKeyJwk')
        }
    }, 60000)

    it('başarıdan sonra yeni şifre tüm kasaları açar, eski şifre açamaz', async () => {
        const storage = makeStorage(baseStore)

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        await expect(unlockAll(NEW_PASSWORD, storage.store)).resolves.toEqual([MNEMONIC, PRIVATE_KEY])
        await expect(unlockAll(OLD_PASSWORD, storage.store)).rejects.toThrow()
    }, 60000)

    it('değişimden sonra yeni şifre verifyPassword ile doğrulanır, eski şifre reddedilir', async () => {
        const storage = makeStorage(baseStore)

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        const { walletSalt, vaults } = storage.store

        await expect(verifyPassword(NEW_PASSWORD, { walletSalt, vaults })).resolves.not.toBeNull()
        await expect(verifyPassword(OLD_PASSWORD, { walletSalt, vaults })).resolves.toBeNull()
    }, 60000)

    it('bir kasa çözülemezse HİÇ yazmaz ve depo bit bit aynı kalır', async () => {
        const bozuk = JSON.parse(JSON.stringify(baseStore))
        // 2. kasanın id'si + 1. kasanın ciphertext'i: yeniden şifreleme patlar.
        bozuk.vaults[1].mnemonic = bozuk.vaults[0].mnemonic

        const storage = makeStorage(bozuk)
        const before = JSON.stringify(storage.store)

        await expect(
            changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
        ).rejects.toThrow()

        expect(storage.set).not.toHaveBeenCalled()
        expect(JSON.stringify(storage.store)).toBe(before)
    }, 60000)

    it('hatadan sonra ESKİ şifre hâlâ çalışır — asıl bugun yakalanacağı yer', async () => {
        const bozuk = JSON.parse(JSON.stringify(baseStore))
        bozuk.vaults[1].mnemonic = bozuk.vaults[0].mnemonic

        const storage = makeStorage(bozuk)

        await expect(
            changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
        ).rejects.toThrow()

        // Salt/jwk kasalardan önce yazılsaydı bu satır patlardı.
        const salt = new Uint8Array(storage.store.walletSalt.match(/.{1,2}/g).map(b => parseInt(b, 16)))
        const masterKey = await deriveMasterKey(OLD_PASSWORD, salt)
        const storedJwk = JSON.parse(storage.store.jwk)

        expect((await crypto.subtle.exportKey('jwk', masterKey)).k).toBe(storedJwk.k)
        await expect(unlockVault(masterKey, storage.store.vaults[0])).resolves.toBe(MNEMONIC)
    }, 60000)

    it('yanlış mevcut şifreyle çağrılırsa yazmaz', async () => {
        const storage = makeStorage(baseStore)

        await expect(
            changeWalletPassword({ storage, currentPassword: 'yanlis-parola', newPassword: NEW_PASSWORD })
        ).rejects.toThrow()

        expect(storage.set).not.toHaveBeenCalled()
    }, 60000)

    it('kasa verisi eksikse yazmaz', async () => {
        const storage = makeStorage({ walletSalt: baseStore.walletSalt, jwk: baseStore.jwk })

        await expect(
            changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })
        ).rejects.toThrow(/Kasa verisi/)

        expect(storage.set).not.toHaveBeenCalled()
    })

    it('storage veya şifre eksikse hemen reddeder', async () => {
        await expect(changeWalletPassword({ currentPassword: 'a', newPassword: 'b' })).rejects.toThrow(/storage/)
        await expect(changeWalletPassword({ storage: {}, currentPassword: 'a', newPassword: 'b' })).rejects.toThrow(/storage/)

        const storage = makeStorage(baseStore)
        await expect(changeWalletPassword({ storage, currentPassword: '', newPassword: 'b' })).rejects.toThrow(/şifre/)
        await expect(changeWalletPassword({ storage, currentPassword: 'a', newPassword: '' })).rejects.toThrow(/şifre/)
        expect(storage.set).not.toHaveBeenCalled()
    })
})

describe('changeWalletPassword — importedSecret taşıyan aktif hesap', () => {
    it('aktif hesabın importedSecret blob\'unu aynı tek yazımda yeniler', async () => {
        const oldSalt = randBytes(32)
        const oldMasterKey = await deriveMasterKey(OLD_PASSWORD, oldSalt)
        const oldJwk = await crypto.subtle.exportKey('jwk', oldMasterKey)

        // CreateAccount.vue:275-292 yükseltmesi: privateKey kasası hd'ye dönüşür,
        // eski private key ciphertext'i accounts[0].importedSecret'e taşınır.
        const vault = await createVaultWithPrivateKey(oldMasterKey, PRIVATE_KEY, {
            key: 'acc-imported', address: '0xCcC0000000000000000000000000000000000003',
            name: 'İçe Aktarılan', type: 'imported'
        })
        const upgraded = await encryptMnemonicWithMaster(MNEMONIC, oldMasterKey, vault.id)

        vault.accounts[0].importedSecret = { ciphertext: vault.mnemonic, iv: vault.iv, salt: vault.vaultSalt }
        vault.mnemonic = upgraded.ciphertext
        vault.iv = upgraded.iv
        vault.type = 'hd'

        const storage = makeStorage({
            walletSalt: toHex(oldSalt),
            jwk: JSON.stringify(oldJwk),
            vaults: [vault],
            active_account: { ...vault.accounts[0] }
        })

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        expect(storage.set).toHaveBeenCalledTimes(1)
        expect(Object.keys(storage.set.mock.calls[0][0]).sort())
            .toEqual(['active_account', 'needsPasswordRotation', 'vaults', 'walletSalt'])

        // background.js:151 blob'u active_account kopyasından okuyor: yeni anahtarla açılmalı.
        const salt = new Uint8Array(storage.store.walletSalt.match(/.{1,2}/g).map(b => parseInt(b, 16)))
        const newMasterKey = await deriveMasterKey(NEW_PASSWORD, salt)

        await expect(
            decryptSecret(storage.store.active_account.importedSecret, newMasterKey, storage.store.vaults[0].id)
        ).resolves.toBe(PRIVATE_KEY)
    }, 60000)

    it('importedSecret taşımayan aktif hesabı yazıma dahil etmez', async () => {
        const oldSalt = randBytes(32)
        const oldMasterKey = await deriveMasterKey(OLD_PASSWORD, oldSalt)
        const oldJwk = await crypto.subtle.exportKey('jwk', oldMasterKey)

        const vault = await createVault(oldMasterKey, MNEMONIC, {
            key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001', name: 'Hesap 1', type: 'hd'
        })

        const storage = makeStorage({
            walletSalt: toHex(oldSalt),
            jwk: JSON.stringify(oldJwk),
            vaults: [vault],
            active_account: { key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001' }
        })

        await changeWalletPassword({ storage, currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD })

        expect(Object.keys(storage.set.mock.calls[0][0])).not.toContain('active_account')
    }, 60000)
})
