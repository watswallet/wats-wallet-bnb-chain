import { describe, it, expect, beforeAll } from 'vitest'
import { HDNodeWallet, Wallet } from 'ethers'
import {
    createVault,
    createVaultWithPrivateKey,
    deriveMasterKey,
    encryptMnemonicWithMaster,
    randBytes
} from './crypto-utils'
import { findVaultForAccount, exportAccountPrivateKey } from './deriveAccount'

// #5: 'Private key göster' Wallet.fromPhrase(mnemonic) kullaniyordu; bu HER ZAMAN
// m/44'/60'/0'/0/0 turetir. Ikinci hesap icin BASKA bir hesabin anahtari
// gosteriliyordu ve ice aktarilmis hesaplar hic disa aktarilamiyordu.
// Ayrica kasa hesap ADIYLA aranmasi (#25) ad cakismasinda yanlis kasayi aciyordu.

const MNEMONIC = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = '0x' + '11'.repeat(32)

const root = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
const account0 = root.derivePath("m/44'/60'/0'/0/0")
const account1 = root.derivePath("m/44'/60'/0'/0/1")
const importedWallet = new Wallet(PRIVATE_KEY)

describe('findVaultForAccount', () => {
    const vaultA = { id: 'v1', accounts: [{ key: 'a-1', address: '0xAAa0000000000000000000000000000000000001', name: 'Hesap 1' }] }
    const vaultB = { id: 'v2', accounts: [{ key: 'b-1', address: '0xBBb0000000000000000000000000000000000002', name: 'Hesap 1' }] }

    it('#25: ayni ada sahip iki kasada DOGRU kasayi key ile bulur', () => {
        // Ad ile arama vaultA'yi dondururdu; kullaniciya yanlis kurtarma cumlesi gosterilirdi.
        expect(findVaultForAccount([vaultA, vaultB], vaultB.accounts[0]).id).toBe('v2')
    })

    it('key yoksa adrese duser (buyuk/kucuk harf farkini yok sayar)', () => {
        const account = { address: '0xbbb0000000000000000000000000000000000002' }
        expect(findVaultForAccount([vaultA, vaultB], account).id).toBe('v2')
    })

    it('key eslesmesi adres eslesmesinden once gelir', () => {
        // Ayni adres iki kasada: key hangisini isaret ediyorsa o kazanir.
        const shared = '0xCcC0000000000000000000000000000000000003'
        const first = { id: 'v1', accounts: [{ key: 'k-1', address: shared }] }
        const second = { id: 'v2', accounts: [{ key: 'k-2', address: shared }] }

        expect(findVaultForAccount([first, second], { key: 'k-2', address: shared }).id).toBe('v2')
    })

    it('bulunamazsa null doner', () => {
        expect(findVaultForAccount([vaultA], { key: 'yok', address: '0x' + '9'.repeat(40) })).toBeNull()
        expect(findVaultForAccount(null, vaultA.accounts[0])).toBeNull()
    })
})

describe('exportAccountPrivateKey', () => {
    let masterKey
    let hdVault
    let pkVault

    beforeAll(async () => {
        masterKey = await deriveMasterKey('parola-123456', randBytes(32))

        hdVault = await createVault(masterKey, MNEMONIC, {
            key: 'hd-0', address: account0.address, name: 'Hesap 1', type: 'hd', index: 0,
            derivationPath: "m/44'/60'/0'/0/0"
        })
        // Ayni kasadan turetilmis ikinci HD hesap
        hdVault.accounts.push({
            key: 'hd-1', address: account1.address, name: 'Hesap 2', type: 'hd', index: 1,
            derivationPath: "m/44'/60'/0'/0/1"
        })

        pkVault = await createVaultWithPrivateKey(masterKey, PRIVATE_KEY, {
            key: 'pk-0', address: importedWallet.address, name: 'İçe aktarılan', type: 'privateKey'
        })
    }, 60000)

    it('ilk HD hesabin anahtarini dogru verir', async () => {
        const key = await exportAccountPrivateKey(masterKey, [hdVault, pkVault], hdVault.accounts[0])
        expect(key).toBe(account0.privateKey)
    }, 60000)

    it('#5: IKINCI HD hesabin anahtarini verir, hesap #0"inkini DEGIL', async () => {
        const key = await exportAccountPrivateKey(masterKey, [hdVault, pkVault], hdVault.accounts[1])

        expect(key).toBe(account1.privateKey)
        expect(key).not.toBe(account0.privateKey)
        expect(new Wallet(key).address).toBe(account1.address)
    }, 60000)

    it('#5: ice aktarilmis hesap artik disa aktarilabilir', async () => {
        // Eskiden Wallet.fromPhrase(privateKey) firlatiyordu, catch yutuyordu ve
        // kullanici 'Anahtar bulunamadı' goruyordu.
        const key = await exportAccountPrivateKey(masterKey, [hdVault, pkVault], pkVault.accounts[0])
        expect(key).toBe(PRIVATE_KEY)
    }, 60000)

    it('derivationPath yoksa index"ten turetilir', async () => {
        const account = { key: 'hd-1', address: account1.address, type: 'hd', index: 1 }
        const key = await exportAccountPrivateKey(masterKey, [hdVault], account)
        expect(key).toBe(account1.privateKey)
    }, 60000)

    it('turetilen adres hesabin adresiyle uyusmuyorsa HATA verir', async () => {
        // Guvenlik agi: yanlis anahtari sessizce gostermektense akisi durdur.
        const corrupted = { key: 'hd-1', address: account1.address, type: 'hd', index: 5 }
        await expect(exportAccountPrivateKey(masterKey, [hdVault], corrupted))
            .rejects.toThrow('DERIVED_ADDRESS_MISMATCH')
    }, 60000)

    it('hesap hicbir kasada yoksa HATA verir', async () => {
        const stranger = { key: 'yok', address: '0x' + '9'.repeat(40), type: 'hd', index: 0 }
        await expect(exportAccountPrivateKey(masterKey, [hdVault], stranger))
            .rejects.toThrow('ACCOUNT_VAULT_NOT_FOUND')
    }, 60000)

    it('HD kasaya tasinmis ice aktarilmis hesap importedSecret"ten cozulur', async () => {
        const other = new Wallet('0x' + '22'.repeat(32))
        const { ciphertext, iv } = await encryptMnemonicWithMaster(other.privateKey, masterKey, hdVault.id)

        const vault = {
            ...hdVault,
            accounts: [...hdVault.accounts, {
                key: 'imp-1', address: other.address, type: 'imported',
                importedSecret: { ciphertext, iv }
            }]
        }

        const key = await exportAccountPrivateKey(masterKey, [vault], vault.accounts[2])
        expect(key).toBe(other.privateKey)
    }, 60000)
})

// R3 (2026-09-05 tasarim belgesi, risk defteri): `extractPrivateKey` TON hesabini
// SESSIZCE karsiliyordu.
//
// Mekanizma: `:77`'deki imported/privateKey kapisi TON hesabini gecirmez, akis
// asagi duser; `unlockVault` 24 kelimelik TON ifadesini doner ve `secret.includes(' ')`
// DOGRUDUR. Siradan bir TON ifadesinde `HDNodeWallet.fromPhrase` BIP39 sagalamasinda
// patlar (deponun kendi olcumu: 300 TON ifadesinin 0'i gecti) -- ama ~1/500 CIFT
// GECERLI ifadede BASARILI olur ve TON ifadesinden bir EVM anahtari dogar.
//
// Bugun bizi yalnizca KAZA kurtariyor: `exportAccountPrivateKey`in `:64-69`'daki
// adres karsilastirmasi tutmuyor, cunku `account.address` bir `UQ...` dizesi. O kaza
// bir refactor uzaklikta. Kapi ACIKCA konuluyor.
//
// Kasa GERCEK olmak zorunda DEGIL: kapi `unlockVault`tan ONCE calisiyor, yani bu
// test kripto yapmadan (ve 100k turlu PBKDF2 beklemeden) kosar. Kapi kaldirilirsa
// test yine kirmizi olur -- sadece BASKA bir hatayla.
describe('TON hesabinda EVM ozel anahtari URETILMEZ (R3)', () => {
    const TON_ACCOUNT = {
        key: 'ton-0', name: 'TON 1', type: 'ton', index: 0,
        address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
        tonAddress: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
    }
    const TON_VAULT = { id: 'v-ton', type: 'tonMnemonic', fingerprint: 'F_TON', accounts: [TON_ACCOUNT] }

    it('type:"ton" hesapta TON_ACCOUNT_NO_EVM_KEY firlatir', async () => {
        await expect(exportAccountPrivateKey('kullanilmaz', [TON_VAULT], TON_ACCOUNT))
            .rejects.toThrow('TON_ACCOUNT_NO_EVM_KEY')
    })

    // Kapi HESAP turune bakmali, KASA turune degil: bir TON kasasinin icinde
    // (bozuk bir kayitta) EVM hesabi bulunmasi bu kapiyi kapatmamali, ve tersi de
    // dogru -- kapi hesabin kendi `type` alanindan okur.
    it('kapi HESAP turunden okur, kasa turunden DEGIL', async () => {
        const evmInTonVault = { key: 'x', type: 'hd', address: '0x' + '9'.repeat(40), index: 0 }
        const weird = { id: 'v-x', type: 'tonMnemonic', accounts: [evmInTonVault] }
        await expect(exportAccountPrivateKey('kullanilmaz', [weird], evmInTonVault))
            .rejects.not.toThrow('TON_ACCOUNT_NO_EVM_KEY')
    })
})
