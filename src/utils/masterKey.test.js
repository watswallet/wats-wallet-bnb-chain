import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { createVault, createVaultWithPrivateKey, deriveMasterKey, randBytes, toHex } from './crypto-utils'
import {
    exportMasterKey,
    getSessionMasterKey,
    importMasterKey,
    requireSessionMasterKey,
    saltFromHex,
    verifyPassword
} from './masterKey'

// Master key'in diskten kaldırılmasının regresyon testleri.
//
// Şifre doğrulama eskiden diskteki jwk kopyasıyla `derivedJwk.k === storedJwk.k`
// karşılaştırmasıydı; o kopya bugun kendisiydi. Artık doğrulama gerçekten bir kasa
// çözerek yapılıyor. Buradaki testler yeni doğrulayıcının eskisi kadar seçici
// olduğunu garanti eder: doğru şifre kabul, yanlış şifre ret.

const MNEMONIC = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = '0x' + '11'.repeat(32)
const PASSWORD = 'dogru-parola-123'

function fakeSession(initial = {}, localInitial = {}) {
    const store = { ...initial }
    const local = { ...localInitial }

    globalThis.chrome = {
        storage: {
            session: {
                get: vi.fn(async (key) => ({ [key]: store[key] })),
                set: vi.fn(async (obj) => { Object.assign(store, obj) }),
                remove: vi.fn(async (key) => { delete store[key] })
            },
            local: {
                get: vi.fn(async (keys) => {
                    const out = {}
                    for (const key of [].concat(keys)) out[key] = local[key]
                    return out
                }),
                set: vi.fn(async (obj) => { Object.assign(local, obj) })
            }
        }
    }

    return store
}

describe('verifyPassword', () => {
    let walletSalt
    let vaults
    let masterKey

    beforeAll(async () => {
        const salt = randBytes(32)
        walletSalt = toHex(salt)
        masterKey = await deriveMasterKey(PASSWORD, salt)

        const hd = await createVault(masterKey, MNEMONIC, {
            key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001', name: 'Hesap 1'
        })
        const pk = await createVaultWithPrivateKey(masterKey, PRIVATE_KEY, {
            key: 'acc-2', address: '0xBbB0000000000000000000000000000000000002', name: 'Hesap 2'
        })

        vaults = [hd, pk]
    }, 60000)

    it('doğru şifre için master key döner', async () => {
        const out = await verifyPassword(PASSWORD, { walletSalt, vaults })

        expect(out).not.toBeNull()
        // Dönen anahtar gerçekten aynı: aynı raw bytes.
        expect((await exportMasterKey(out)).k).toBe((await exportMasterKey(masterKey)).k)
    }, 60000)

    it('yanlış şifre için null döner, hata atmaz', async () => {
        await expect(verifyPassword('yanlis-parola', { walletSalt, vaults })).resolves.toBeNull()
    }, 60000)

    it('tek karakter farkı bile reddedilir', async () => {
        await expect(verifyPassword(PASSWORD + 'x', { walletSalt, vaults })).resolves.toBeNull()
    }, 60000)

    it('yanlış salt ile doğru şifre de reddedilir', async () => {
        await expect(verifyPassword(PASSWORD, { walletSalt: toHex(randBytes(32)), vaults })).resolves.toBeNull()
    }, 60000)

    it('0x önekli salt da kabul edilir', async () => {
        const out = await verifyPassword(PASSWORD, { walletSalt: '0x' + walletSalt, vaults })

        expect(out).not.toBeNull()
    }, 60000)

    it('eksik girdilerde null döner', async () => {
        await expect(verifyPassword('', { walletSalt, vaults })).resolves.toBeNull()
        await expect(verifyPassword(PASSWORD, { walletSalt: null, vaults })).resolves.toBeNull()
        await expect(verifyPassword(PASSWORD, { walletSalt, vaults: [] })).resolves.toBeNull()
        await expect(verifyPassword(PASSWORD, { walletSalt, vaults: null })).resolves.toBeNull()
        await expect(verifyPassword(PASSWORD)).resolves.toBeNull()
    })

    it('bozuk tek kasa varsa varsayılan modda şifreyi yine kabul eder', async () => {
        // vaults[1]'in ciphertext'i bozuk; vaults[0] hâlâ açılıyor.
        const kismiBozuk = [vaults[0], { ...vaults[1], mnemonic: vaults[0].mnemonic }]

        await expect(verifyPassword(PASSWORD, { walletSalt, vaults: kismiBozuk })).resolves.not.toBeNull()
    }, 60000)

    it('requireAll modunda bozuk tek kasa şifreyi reddettirir', async () => {
        const kismiBozuk = [vaults[0], { ...vaults[1], mnemonic: vaults[0].mnemonic }]

        await expect(
            verifyPassword(PASSWORD, { walletSalt, vaults: kismiBozuk, requireAll: true })
        ).resolves.toBeNull()
    }, 60000)

    it('requireAll modunda tüm kasalar sağlamsa kabul eder', async () => {
        await expect(
            verifyPassword(PASSWORD, { walletSalt, vaults, requireAll: true })
        ).resolves.not.toBeNull()
    }, 60000)

    it('ilk kasa bozuk olsa bile ikinci açılıyorsa kabul eder', async () => {
        const ilkBozuk = [{ ...vaults[0], mnemonic: vaults[1].mnemonic }, vaults[1]]

        await expect(verifyPassword(PASSWORD, { walletSalt, vaults: ilkBozuk })).resolves.not.toBeNull()
    }, 60000)
})

describe('saltFromHex', () => {
    it('0x önekli ve öneksiz hex için aynı byte dizisini üretir', () => {
        expect(Array.from(saltFromHex('00ff10'))).toEqual([0, 255, 16])
        expect(Array.from(saltFromHex('0x00ff10'))).toEqual([0, 255, 16])
    })
})

describe('oturum anahtarı', () => {
    let jwk

    beforeAll(async () => {
        jwk = await exportMasterKey(await deriveMasterKey(PASSWORD, randBytes(32)))
    }, 60000)

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('oturumdaki anahtarı kullanılabilir CryptoKey olarak döner', async () => {
        fakeSession({ sessionMasterKeyJwk: jwk })

        const key = await getSessionMasterKey()

        expect(key).not.toBeNull()
        expect((await exportMasterKey(key)).k).toBe(jwk.k)
    })

    it('dönen anahtar extractable olmalı — deriveVaultKey exportKey("raw") çağırıyor', async () => {
        fakeSession({ sessionMasterKeyJwk: jwk })

        const key = await getSessionMasterKey()

        expect(key.extractable).toBe(true)
        await expect(crypto.subtle.exportKey('raw', key)).resolves.toBeInstanceOf(ArrayBuffer)
    })

    it('cüzdan kilitliyse null döner', async () => {
        fakeSession({})

        await expect(getSessionMasterKey()).resolves.toBeNull()
    })

    it('bozuk jwk için null döner, patlamaz', async () => {
        fakeSession({ sessionMasterKeyJwk: { kty: 'oct', k: 'bu-gecerli-degil' } })

        await expect(getSessionMasterKey()).resolves.toBeNull()
    })

    it('importMasterKey/exportMasterKey gidiş-dönüş tutarlı', async () => {
        const key = await importMasterKey(jwk)

        expect((await exportMasterKey(key)).k).toBe(jwk.k)
    })
})

// Oturum anahtarı BAYAT olabilir: şifre değişiminden sonra LOCK ulaşmazsa ya da
// sıfırlama sonrası temizlenmezse session'da eski anahtar kalır. O anahtarla yeni kasa
// şifrelenirse kasa hiçbir şifreyle açılamaz. requireSessionMasterKey bu yüzden
// anahtarı mevcut bir kasayla doğrulamak zorunda.
describe('requireSessionMasterKey — bayat anahtar koruması', () => {
    let dogruJwk
    let dogruVaults
    let bayatJwk

    beforeAll(async () => {
        const salt = randBytes(32)
        const masterKey = await deriveMasterKey(PASSWORD, salt)
        dogruJwk = await exportMasterKey(masterKey)

        dogruVaults = [await createVault(masterKey, MNEMONIC, {
            key: 'acc-1', address: '0xAaA0000000000000000000000000000000000001', name: 'Hesap 1'
        })]

        // Farklı salt → farklı anahtar: "şifre değişmiş ama session eski" durumu.
        bayatJwk = await exportMasterKey(await deriveMasterKey(PASSWORD, randBytes(32)))
    }, 60000)

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('anahtar depodaki kasayla uyuşuyorsa döner', async () => {
        fakeSession({ sessionMasterKeyJwk: dogruJwk }, { vaults: dogruVaults })

        await expect(requireSessionMasterKey()).resolves.not.toBeNull()
    }, 60000)

    it('kilitliyken WALLET_LOCKED atar', async () => {
        fakeSession({}, { vaults: dogruVaults })

        await expect(requireSessionMasterKey()).rejects.toThrow('WALLET_LOCKED')
    })

    it('BAYAT anahtar için STALE_SESSION_KEY atar — kasa yanlış anahtarla şifrelenmez', async () => {
        fakeSession({ sessionMasterKeyJwk: bayatJwk }, { vaults: dogruVaults })

        await expect(requireSessionMasterKey()).rejects.toThrow('STALE_SESSION_KEY')
    }, 60000)

    it('doğrulanacak kasa yoksa NO_VAULTS atar', async () => {
        fakeSession({ sessionMasterKeyJwk: dogruJwk }, { vaults: [] })

        await expect(requireSessionMasterKey()).rejects.toThrow('NO_VAULTS')

        fakeSession({ sessionMasterKeyJwk: dogruJwk }, {})
        await expect(requireSessionMasterKey()).rejects.toThrow('NO_VAULTS')
    })

    it('bozuk kasa varsa sağlam olanla doğrular', async () => {
        const bozuk = { ...dogruVaults[0], id: 'baska-id' }
        fakeSession({ sessionMasterKeyJwk: dogruJwk }, { vaults: [bozuk, dogruVaults[0]] })

        await expect(requireSessionMasterKey()).resolves.not.toBeNull()
    }, 60000)
})
