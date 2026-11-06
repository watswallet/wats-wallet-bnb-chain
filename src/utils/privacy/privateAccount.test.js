import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { HDNodeWallet } from 'ethers'
import { createVault, createVaultWithPrivateKey, deriveMasterKey, randBytes } from '../crypto-utils'
import { fakeStorage } from '../../test-utils/fakeStorage'
import {
    PRIVATE_ACCOUNT_PATH, isPrivateAccount, findPrivateAccount,
    pickVaultForPrivateAccount, derivePrivateAccount, ensurePrivateAccount, accountByKey,
    privateNowOf, readPrivateNow,
} from './privateAccount'

const MNEMONIC = 'test test test test test test test test test test test junk'
const root = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
const account0 = root.derivePath("m/44'/60'/0'/0/0")
const gizliBeklenen = root.derivePath("m/44'/60'/0'/1/0")

describe('privateAccount', () => {
    let masterKey, hdVault, pkVault

    beforeAll(async () => {
        masterKey = await deriveMasterKey('parola-123456', randBytes(32))
        hdVault = await createVault(masterKey, MNEMONIC, {
            key: 'hd-0', address: account0.address, name: 'Hesap 1', type: 'hd', index: 0,
            derivationPath: "m/44'/60'/0'/0/0",
        })
        pkVault = await createVaultWithPrivateKey(masterKey, '0x' + '11'.repeat(32), {
            key: 'pk-0', address: '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A', name: 'Ice', type: 'privateKey',
        })
    }, 60000)

    it('yol BIP44 change dalidir ve normal hesaplarla cakismaz', () => {
        expect(PRIVATE_ACCOUNT_PATH).toBe("m/44'/60'/0'/1/0")
        const acc = derivePrivateAccount(MNEMONIC, { fingerprint: 'fp' }, { name: 'Gizli Hesap' })
        expect(acc.address).toBe(gizliBeklenen.address)
        expect(acc.address).not.toBe(account0.address)
        expect(acc).toMatchObject({ type: 'hd', private: true, derivationPath: PRIVATE_ACCOUNT_PATH, fingerprint: 'fp', name: 'Gizli Hesap' })
        expect(acc.index).toBeUndefined()
        expect(acc.tonAddress).toBeUndefined()
        expect(typeof acc.key).toBe('string')
    })

    it('ad ZORUNLUDUR: eksik ad sessizce Ingilizce olmaz, turetme firlatir', () => {
        expect(() => derivePrivateAccount(MNEMONIC, { fingerprint: 'fp' })).toThrow('PRIVATE_NAME_REQUIRED')
        expect(() => derivePrivateAccount(MNEMONIC, { fingerprint: 'fp' }, {})).toThrow('PRIVATE_NAME_REQUIRED')
        expect(() => derivePrivateAccount(MNEMONIC, { fingerprint: 'fp' }, { name: '  ' })).toThrow('PRIVATE_NAME_REQUIRED')
        expect(() => derivePrivateAccount(MNEMONIC, { fingerprint: 'fp' }, { name: 5 })).toThrow('PRIVATE_NAME_REQUIRED')
    })

    it('ensure: ad yoksa turetme firlatir ve depoya HICBIR SEY yazilmaz', async () => {
        const storage = fakeStorage({ vaults: [hdVault] })
        await expect(ensurePrivateAccount({ storage, masterKey, preferredAccount: null }))
            .rejects.toThrow('PRIVATE_NAME_REQUIRED')
        expect(storage.set).not.toHaveBeenCalled()
    })

    it('anahtar KASAYA ozgu ve belirleyicidir: ayni kasa ayni anahtari, farkli kasa farkli anahtari verir', () => {
        const ilk = derivePrivateAccount(MNEMONIC, hdVault, { name: 'Gizli Hesap' })
        const ikinci = derivePrivateAccount(MNEMONIC, hdVault, { name: 'Private Account' })
        expect(ikinci.key).toBe(ilk.key)
        const baskaMnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
        const baska = derivePrivateAccount(baskaMnemonic, { id: 'baska-kasa', fingerprint: 'fp2' }, { name: 'Gizli Hesap' })
        expect(baska.key).not.toBe(ilk.key)
        expect(ilk.key).not.toBe('hd-0')
    })

    it('kayip guncelleme sonrasi yeniden turetme AYNI anahtari verir (anahtara bagli kayitlar yetim kalmaz)', async () => {
        const storage = fakeStorage({ vaults: [hdVault] })
        const ilk = await ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' })
        // baska bir yazar kasalari eski haline dondurur (privateAccount kaybolur)
        storage.data.vaults = [hdVault]
        const yeniden = await ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' })
        expect(yeniden.key).toBe(ilk.key)
    })

    it('depoda duran kayit anahtarini korur (mevcut kayitlar bozulmaz)', async () => {
        const eski = { key: 'eski-rastgele-anahtar', address: gizliBeklenen.address, private: true, type: 'hd', name: 'Gizli Hesap' }
        const storage = fakeStorage({ vaults: [{ ...hdVault, privateAccount: eski }] })
        const acc = await ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' })
        expect(acc.key).toBe('eski-rastgele-anahtar')
        expect(storage.set).not.toHaveBeenCalled()
    })

    it('mnemonic degilse PRIVATE_NEEDS_HD_VAULT', () => {
        expect(() => derivePrivateAccount('0x' + '11'.repeat(32), {}, { name: 'Gizli Hesap' })).toThrow('PRIVATE_NEEDS_HD_VAULT')
    })

    it('isPrivateAccount yalniz private === true', () => {
        expect(isPrivateAccount({ private: true })).toBe(true)
        expect(isPrivateAccount({ private: 'true' })).toBe(false)
        expect(isPrivateAccount(null)).toBe(false)
    })

    it('findPrivateAccount: diziyi, bos girdiyi ve privateAccount olmayan kasalari guvenle ele alir', () => {
        const gizli = { key: 'g', address: '0x' + 'cd'.repeat(20), private: true }
        const kasa = { id: 'v', accounts: [], privateAccount: gizli }
        expect(findPrivateAccount([{ id: 'x', accounts: [] }, null, kasa])).toEqual({ vault: kasa, account: gizli })
        expect(findPrivateAccount([{ id: 'x', accounts: [] }])).toBe(null)
        expect(findPrivateAccount(undefined)).toBe(null)
    })

    it('kasa secimi: tercih edilen hesabin HD kasasi, yoksa ilk HD kasa', () => {
        expect(pickVaultForPrivateAccount([pkVault, hdVault], { key: 'hd-0' })).toBe(hdVault)
        expect(pickVaultForPrivateAccount([pkVault, hdVault], { key: 'pk-0' })).toBe(hdVault)
        expect(pickVaultForPrivateAccount([pkVault, { type: 'tonMnemonic', accounts: [] }], null)).toBe(null)
    })

    it('kasa secimi: privateAccount tasimayan kasalarda ve gecersiz girdide bile cokmez', () => {
        // findVaultForAccount artik vault.privateAccount'u (cogu kasada undefined) eslestiriciye verir.
        const duz = { id: 'a', type: 'hd', accounts: [{ key: 'k1', address: '0x1' }] }
        expect(pickVaultForPrivateAccount([duz], { key: 'yok' })).toBe(duz)
        expect(pickVaultForPrivateAccount(undefined, { key: 'hd-0' })).toBe(null)
        expect(pickVaultForPrivateAccount([null, undefined], { key: 'hd-0' })).toBe(null)
    })

    it('ensurePrivateAccount turetir, accounts dizisine DOKUNMADAN privateAccount alanina yazar', async () => {
        const storage = fakeStorage({ vaults: [pkVault, hdVault] })
        const acc = await ensurePrivateAccount({ storage, masterKey, preferredAccount: { key: 'hd-0' }, name: 'Gizli Hesap' })
        expect(acc.address).toBe(gizliBeklenen.address)
        const yazilan = storage.data.vaults.find((v) => v.id === hdVault.id)
        expect(yazilan.privateAccount.address).toBe(gizliBeklenen.address)
        expect(yazilan.accounts).toHaveLength(1)
        expect(findPrivateAccount(storage.data.vaults).account.key).toBe(acc.key)
    })

    it('ensurePrivateAccount ikinci cagrida AYNI hesabi doner, yeniden yazmaz', async () => {
        const storage = fakeStorage({ vaults: [hdVault] })
        const ilk = await ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' })
        storage.set.mockClear()
        const ikinci = await ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' })
        expect(ikinci.key).toBe(ilk.key)
        expect(storage.set).not.toHaveBeenCalled()
    })

    // Yalniz private key / TON kasasi olan kullanici.
    it('HD kasa yoksa PRIVATE_NEEDS_HD_VAULT ve depoya HICBIR SEY yazilmaz', async () => {
        const storage = fakeStorage({ vaults: [pkVault, { id: 't', type: 'tonMnemonic', accounts: [] }] })
        await expect(ensurePrivateAccount({ storage, masterKey, preferredAccount: { key: 'pk-0' }, name: 'Gizli Hesap' }))
            .rejects.toThrow('PRIVATE_NEEDS_HD_VAULT')
        expect(storage.set).not.toHaveBeenCalled()
    })

    // Ust uste binen cagrilar tek hesap uretir.
    it('ust uste binen iki ensure cagrisi AYNI anahtari doner ve depoda tek privateAccount kalir', async () => {
        const storage = fakeStorage({ vaults: [hdVault] })
        const [a, b] = await Promise.all([
            ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' }),
            ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' }),
        ])
        expect(b.key).toBe(a.key)
        const yazilan = storage.data.vaults.filter((v) => v.privateAccount)
        expect(yazilan).toHaveLength(1)
        expect(yazilan[0].privateAccount.key).toBe(a.key)
        expect(storage.set).toHaveBeenCalledTimes(1)
    })

    it('okuma ile yazma arasinda depoya inen degisiklik ezilmez', async () => {
        const storage = fakeStorage({ vaults: [pkVault, hdVault] })
        const ilkGet = storage.get.getMockImplementation()
        let sayac = 0
        storage.get.mockImplementation(async (keys) => {
            const sonuc = await ilkGet(keys)
            if (++sayac === 1) {
                // turetme suruyorken baska yazar pkVault'a hesap ekler
                Promise.resolve().then(() => {
                    storage.data.vaults = storage.data.vaults.map((v) => (
                        v.id === pkVault.id ? { ...v, accounts: [...v.accounts, { key: 'yeni', address: '0x2' }] } : v
                    ))
                })
            }
            return sonuc
        })
        const acc = await ensurePrivateAccount({ storage, masterKey, preferredAccount: { key: 'hd-0' }, name: 'Gizli Hesap' })
        const pk = storage.data.vaults.find((v) => v.id === pkVault.id)
        expect(pk.accounts.map((x) => x.key)).toContain('yeni')
        expect(storage.data.vaults.find((v) => v.id === hdVault.id).privateAccount.key).toBe(acc.key)
    })

    it('turetme sirasinda baska bir Gizli Hesap yazildiysa o doner, ustune yazilmaz', async () => {
        const storage = fakeStorage({ vaults: [hdVault] })
        const ilkGet = storage.get.getMockImplementation()
        const baskasi = { key: 'baska', address: '0x' + 'ab'.repeat(20), private: true }
        let sayac = 0
        storage.get.mockImplementation(async (keys) => {
            const sonuc = await ilkGet(keys)
            if (++sayac === 1) {
                Promise.resolve().then(() => {
                    storage.data.vaults = storage.data.vaults.map((v) => ({ ...v, privateAccount: baskasi }))
                })
            }
            return sonuc
        })
        const acc = await ensurePrivateAccount({ storage, masterKey, preferredAccount: null, name: 'Gizli Hesap' })
        expect(acc.key).toBe('baska')
        expect(storage.set).not.toHaveBeenCalled()
    })
})

describe('accountByKey', () => {
    it('normal hesaplari ve Gizli Hesap\'i bulur', () => {
        const g = { key: 'g-1', private: true }
        const vaults = [{ accounts: [{ key: 'a-1' }] }, { accounts: [{ key: 'b-1' }], privateAccount: g }]
        expect(accountByKey(vaults, 'b-1')).toEqual({ key: 'b-1' })
        expect(accountByKey(vaults, 'g-1')).toBe(g)
        expect(accountByKey(vaults, 'yok')).toBe(null)
        expect(accountByKey(vaults, undefined)).toBe(null)
    })

    it('kasa listesi bozuksa null (fail-closed)', () => {
        expect(accountByKey(undefined, 'a-1')).toBe(null)
        expect(accountByKey([null, { accounts: 'x' }], 'a-1')).toBe(null)
    })
})

// PF-DD2 / PF-DD11: popup'in tek "simdi Gizli mi" karari -- hesap tabanli, hesap yoksa store, okuma hatasinda kapali-basarisiz.
describe('privateNowOf / readPrivateNow', () => {
    afterEach(() => { delete globalThis.chrome })
    const depo = (get) => { globalThis.chrome = { storage: { local: { get } } } }

    it('privateNowOf: hesap varsa HESAP karar verir (store yok sayilir); hesap yoksa store', () => {
        expect(privateNowOf({ key: 'g', private: true }, false)).toBe(true)
        expect(privateNowOf({ key: 'a' }, true)).toBe(false)
        expect(privateNowOf(undefined, true)).toBe(true)
        expect(privateNowOf(null, false)).toBe(false)
        expect(privateNowOf(undefined, undefined)).toBe(false)
    })

    it('readPrivateNow: depodaki aktif hesabi taze okur; store ile anlasamazsa hesaba uyar', async () => {
        depo(async () => ({ active_account: { key: 'g', private: true } }))
        expect(await readPrivateNow(false)).toBe(true)
        depo(async () => ({ active_account: { key: 'a' } }))
        expect(await readPrivateNow(true)).toBe(false)
    })

    it('readPrivateNow: okunabilir hesap yoksa store kararina duser', async () => {
        depo(async () => ({}))
        expect(await readPrivateNow(true)).toBe(true)
        expect(await readPrivateNow(false)).toBe(false)
    })

    it('readPrivateNow: depo okunamazsa Gizli sayilir (kapali-basarisiz), store ne derse desin', async () => {
        const get = vi.fn(async () => { throw new Error('depo yok') })
        depo(get)
        expect(await readPrivateNow(false)).toBe(true)
        expect(get).toHaveBeenCalledWith('active_account')
    })
})
