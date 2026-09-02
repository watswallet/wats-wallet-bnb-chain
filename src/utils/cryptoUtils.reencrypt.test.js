import { describe, it, expect, beforeAll } from 'vitest'
import {
    createVault,
    createVaultWithPrivateKey,
    decryptSecret,
    deriveMasterKey,
    encryptMnemonicWithMaster,
    randBytes,
    reencryptVaults,
    syncActiveAccount,
    unlockVault
} from './crypto-utils'

// Şifre değiştirme akışının KRİPTO tarafının regresyon testleri.
//
// Eski kod ChangePassword.vue içinde createVault(newMasterKey, mnemonic) çağırıp
// 3. 'account' argümanını atlıyordu ve her zaman TypeError atıyordu. Buradaki
// testler yeniden şifrelemenin doğruluğunu korur: vault.id ve meta korunur,
// importedSecret döndürülür, eski anahtar artık açamaz.
//
// KAPSAM DIŞI: bugun ikinci ve asıl yıkıcı yarısı olan YAZIM SIRASI (walletSalt/jwk
// kasalardan önce yazılması) burada test EDİLMEZ — o özellik çağıran tarafa ait ve
// passwordChange.test.js'te korunuyor.

const MNEMONIC = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = '0x' + '11'.repeat(32)

describe('reencryptVaults — şifre değişiminde kasaların yeniden şifrelenmesi', () => {
    let oldMasterKey
    let newMasterKey
    let vaults

    beforeAll(async () => {
        oldMasterKey = await deriveMasterKey('eski-parola-123', randBytes(32))
        newMasterKey = await deriveMasterKey('yeni-parola-456', randBytes(32))

        const hdVault = await createVault(oldMasterKey, MNEMONIC, {
            key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001', name: 'Hesap 1'
        })
        const pkVault = await createVaultWithPrivateKey(oldMasterKey, PRIVATE_KEY, {
            key: 'acc-2', address: '0xBbB0000000000000000000000000000000000002', name: 'Hesap 2'
        })

        vaults = [hdVault, pkVault]
    }, 60000)

    it('hem hd hem privateKey kasasını yeni master key ile açılabilir yapar', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        expect(out).toHaveLength(2)
        expect(await unlockVault(newMasterKey, out[0])).toBe(MNEMONIC)
        expect(await unlockVault(newMasterKey, out[1])).toBe(PRIVATE_KEY)
    }, 60000)

    it('vault.id ve meta alanlarını korur, yalnızca ciphertext/iv yeniler', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        out.forEach((v, i) => {
            // vaultKey (masterKey + vault.id)'den türetiliyor; id değişirse kasa açılamaz.
            expect(v.id).toBe(vaults[i].id)
            expect(v.type).toBe(vaults[i].type)
            expect(v.fingerprint).toBe(vaults[i].fingerprint)
            expect(v.accounts).toEqual(vaults[i].accounts)
            expect(v.createdAt).toBe(vaults[i].createdAt)
            expect(v.mnemonic).not.toBe(vaults[i].mnemonic)
        })
    }, 60000)

    it('eski master key yeniden şifrelenmiş kasaları açamaz', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        await expect(unlockVault(oldMasterKey, out[0])).rejects.toThrow()
    }, 60000)

    it('kaynak kasaları değiştirmez', async () => {
        const before = JSON.parse(JSON.stringify(vaults))
        await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        expect(JSON.parse(JSON.stringify(vaults))).toEqual(before)
    }, 60000)

    it('tek bir kasa çözülemezse hata atar — çağıran taraf hiçbir şey yazmamalı', async () => {
        // 2. kasanın id'si ile 1. kasanın ciphertext'i: AES-GCM doğrulaması patlar.
        const bozuk = [vaults[0], { ...vaults[1], mnemonic: vaults[0].mnemonic }]

        await expect(reencryptVaults(bozuk, oldMasterKey, newMasterKey)).rejects.toThrow()
    }, 60000)

    it('id olmayan kasayı reddeder', async () => {
        const { id, ...idsiz } = vaults[0]

        await expect(reencryptVaults([idsiz], oldMasterKey, newMasterKey)).rejects.toThrow(/id/)
    }, 30000)

    it('dizi olmayan girdiyi reddeder', async () => {
        await expect(reencryptVaults(null, oldMasterKey, newMasterKey)).rejects.toThrow()
        await expect(reencryptVaults(undefined, oldMasterKey, newMasterKey)).rejects.toThrow()
    })

    it('boş kasa listesi için boş dizi döner', async () => {
        await expect(reencryptVaults([], oldMasterKey, newMasterKey)).resolves.toEqual([])
    })

    it('createVault/createVaultWithPrivateKey account argümanı olmadan patlar (eski bugun kaynağı)', async () => {
        await expect(createVault(oldMasterKey, MNEMONIC)).rejects.toThrow()
        await expect(createVaultWithPrivateKey(oldMasterKey, PRIVATE_KEY)).rejects.toThrow()
    }, 60000)
})

// HD kasaya yükseltilmiş içe aktarılmış hesaplar (CreateAccount.vue:270-292): eski
// private key ciphertext'i accounts[0].importedSecret içine taşınıyor ve
// background.js:151 onu decryptSecret ile açıyor. Şifre değişiminde bu blob da
// yenilenmezse hesap bir daha imzalayamaz.
describe('reencryptVaults — accounts[].importedSecret rotasyonu', () => {
    let oldMasterKey
    let newMasterKey
    let vaults

    beforeAll(async () => {
        oldMasterKey = await deriveMasterKey('eski-parola-123', randBytes(32))
        newMasterKey = await deriveMasterKey('yeni-parola-456', randBytes(32))

        // Yükseltme öncesi: privateKey kasası.
        const vault = await createVaultWithPrivateKey(oldMasterKey, PRIVATE_KEY, {
            key: 'acc-imported', address: '0xCcC0000000000000000000000000000000000003',
            name: 'İçe Aktarılan', type: 'imported'
        })

        // CreateAccount.vue:275-292 yükseltmesinin aynısı: yeni mnemonic kasaya
        // yazılır, eski private key ciphertext'i importedSecret'e taşınır.
        const upgraded = await encryptMnemonicWithMaster(MNEMONIC, oldMasterKey, vault.id)

        vault.accounts[0].importedSecret = {
            ciphertext: vault.mnemonic,
            iv: vault.iv,
            salt: vault.vaultSalt
        }
        vault.mnemonic = upgraded.ciphertext
        vault.iv = upgraded.iv
        vault.data = upgraded.ciphertext
        vault.type = 'hd'

        vaults = [vault]
    }, 60000)

    it('yükseltme kurgusu doğru: eski anahtarla hem mnemonic hem private key açılıyor', async () => {
        expect(await unlockVault(oldMasterKey, vaults[0])).toBe(MNEMONIC)
        expect(await decryptSecret(vaults[0].accounts[0].importedSecret, oldMasterKey, vaults[0].id))
            .toBe(PRIVATE_KEY)
    }, 60000)

    it('importedSecret yeni master key ile açılabilir hale gelir', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        expect(await unlockVault(newMasterKey, out[0])).toBe(MNEMONIC)
        expect(await decryptSecret(out[0].accounts[0].importedSecret, newMasterKey, out[0].id))
            .toBe(PRIVATE_KEY)
    }, 60000)

    it('eski master key artık importedSecret\'i açamaz', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        await expect(decryptSecret(out[0].accounts[0].importedSecret, oldMasterKey, out[0].id))
            .rejects.toThrow()
    }, 60000)

    it('importedSecret ciphertext/iv dışındaki alanlarını korur', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)
        const before = vaults[0].accounts[0].importedSecret
        const after = out[0].accounts[0].importedSecret

        expect(after.salt).toBe(before.salt)
        expect(after.ciphertext).not.toBe(before.ciphertext)
        expect(after.iv).not.toBe(before.iv)
    }, 60000)

    it('kaynak hesapları değiştirmez — accounts derin kopyalanır', async () => {
        const before = JSON.parse(JSON.stringify(vaults))
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        expect(JSON.parse(JSON.stringify(vaults))).toEqual(before)
        expect(out[0].accounts).not.toBe(vaults[0].accounts)
        expect(out[0].accounts[0]).not.toBe(vaults[0].accounts[0])
    }, 60000)

    it('ölü vault.data alanını yeni ciphertext ile günceller (eski anahtarla açılabilen kopya kalmaz)', async () => {
        const out = await reencryptVaults(vaults, oldMasterKey, newMasterKey)

        expect(out[0].data).toBe(out[0].mnemonic)
        expect(out[0].data).not.toBe(vaults[0].data)
    }, 60000)

    it('data alanı olmayan kasaya data eklemez', async () => {
        const plain = await createVault(oldMasterKey, MNEMONIC, {
            key: 'acc-plain', address: '0xDdD0000000000000000000000000000000000004', name: 'Sade'
        })
        const out = await reencryptVaults([plain], oldMasterKey, newMasterKey)

        expect('data' in out[0]).toBe(false)
    }, 60000)
})

describe('syncActiveAccount — diskteki aktif hesap kopyası', () => {
    const vaultsWith = (importedSecret) => ([{
        id: 'vault-1',
        accounts: [
            { key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001' },
            { key: 'acc-2', address: '0xBbB0000000000000000000000000000000000002', importedSecret }
        ]
    }])

    it('importedSecret taşımayan aktif hesabı aynı referansla döner (yazım gerekmez)', () => {
        const active = { key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001' }

        expect(syncActiveAccount(active, vaultsWith({ ciphertext: 'x', iv: 'y' }))).toBe(active)
    })

    it('null/undefined aktif hesabı olduğu gibi döner', () => {
        expect(syncActiveAccount(null, [])).toBe(null)
        expect(syncActiveAccount(undefined, [])).toBe(undefined)
    })

    it('key ile eşleşen hesabın yenilenmiş importedSecret\'ini alır', () => {
        const yeni = { ciphertext: 'yeni-ct', iv: 'yeni-iv' }
        const active = { key: 'acc-2', address: '0xBbB0000000000000000000000000000000000002', importedSecret: { ciphertext: 'eski-ct', iv: 'eski-iv' } }

        const out = syncActiveAccount(active, vaultsWith(yeni))

        expect(out.importedSecret).toEqual(yeni)
        expect(out.key).toBe('acc-2')
        expect(out).not.toBe(active)
    })

    it('key yoksa büyük/küçük harf duyarsız adresle eşleşir', () => {
        const yeni = { ciphertext: 'yeni-ct', iv: 'yeni-iv' }
        const active = { address: '0xbbb0000000000000000000000000000000000002', importedSecret: { ciphertext: 'eski-ct' } }

        expect(syncActiveAccount(active, vaultsWith(yeni)).importedSecret).toEqual(yeni)
    })

    it('eşleşme bulunamazsa hata atar — sessizce eski blob bırakmaz', () => {
        const active = { key: 'yok', address: '0xEeE0000000000000000000000000000000000009', importedSecret: { ciphertext: 'eski-ct' } }

        expect(() => syncActiveAccount(active, vaultsWith({ ciphertext: 'yeni-ct' }))).toThrow(/bulunamadı/)
    })
})
