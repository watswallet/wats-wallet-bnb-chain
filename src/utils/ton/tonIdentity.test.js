// Gercek kasa/kripto ile calisir (deriveAccount.test.js ile ayni yaklasim): mock yok,
// boylece kasa semasindaki bir degisiklik burada da yakalanir.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    createTonVault,
    createVault,
    createVaultWithPrivateKey,
    deriveMasterKey,
    encryptMnemonicWithMaster,
    randBytes,
} from '../crypto-utils'
import { exportMasterKey } from '../masterKey'
import { tonSecretForAccount, tonIdentityForAccount, ensureTonAddress } from './tonIdentity'
import { tonKeyPairFromMnemonic, tonKeyPairFromPrivateKey, tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'

const MNEMONIC = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = '0x' + '11'.repeat(32)

describe('tonIdentity', () => {
    let masterKey
    let hdVault
    let pkVault

    beforeAll(async () => {
        masterKey = await deriveMasterKey('parola-123456', randBytes(32))

        hdVault = await createVault(masterKey, MNEMONIC, {
            key: 'hd-0', address: '0x' + 'a'.repeat(40), type: 'hd', index: 0,
        })
        hdVault.accounts.push({
            key: 'hd-1', address: '0x' + 'b'.repeat(40), type: 'hd', index: 1,
        })

        pkVault = await createVaultWithPrivateKey(masterKey, PRIVATE_KEY, {
            key: 'pk-0', address: '0x' + 'c'.repeat(40), type: 'privateKey',
        })
    })

    it('HD kasadan mnemonic i cikarir', async () => {
        const secret = await tonSecretForAccount(masterKey, [hdVault], hdVault.accounts[0])
        expect(secret).toBe(MNEMONIC)
    })

    it('ozel anahtar kasasindan anahtari cikarir', async () => {
        const secret = await tonSecretForAccount(masterKey, [pkVault], pkVault.accounts[0])
        expect(secret).toBe(PRIVATE_KEY)
    })

    it('hesabin importedSecret i varsa oncelikli okunur', async () => {
        const importedSecret = await encryptMnemonicWithMaster(PRIVATE_KEY, masterKey, hdVault.id)
        const account = { key: 'imp-1', address: '0x' + 'd'.repeat(40), type: 'imported', importedSecret }
        const vault = { ...hdVault, accounts: [...hdVault.accounts, account] }

        expect(await tonSecretForAccount(masterKey, [vault], account)).toBe(PRIVATE_KEY)
    })

    it('kasasi bulunamayan hesap hata verir', async () => {
        await expect(tonSecretForAccount(masterKey, [hdVault], { key: 'yok', address: '0x' + '9'.repeat(40) }))
            .rejects.toThrow('ACCOUNT_VAULT_NOT_FOUND')
    })

    it('HD hesaplarin TON adresi indekse gore AYRISIR', async () => {
        // Hesap 1 ve Hesap 2 ayni TON adresini paylasirsa hesap izolasyonu yok olur.
        const first = await tonIdentityForAccount(masterKey, [hdVault], hdVault.accounts[0])
        const second = await tonIdentityForAccount(masterKey, [hdVault], hdVault.accounts[1])

        expect(first.friendly).not.toBe(second.friendly)
        expect(first.friendly.startsWith('UQ')).toBe(true)

        const expected = await tonKeyPairFromMnemonic(MNEMONIC, 1)
        expect(second.friendly).toBe(toFriendlyTon(tonWalletAddress(expected.publicKey)))
    })

    it('ozel anahtar hesabinin adresi anahtardan turer', async () => {
        const identity = await tonIdentityForAccount(masterKey, [pkVault], pkVault.accounts[0])
        const expected = tonKeyPairFromPrivateKey(PRIVATE_KEY)
        expect(identity.friendly).toBe(toFriendlyTon(tonWalletAddress(expected.publicKey)))
    })

    it('testnet secildiginde adres 0Q ile baslar', async () => {
        const identity = await tonIdentityForAccount(masterKey, [hdVault], hdVault.accounts[0], { testnet: true })
        expect(identity.friendly.startsWith('0Q')).toBe(true)
    })
})

// chrome.storage ve oturum ana anahtari, masterKey.test.js:fakeSession ile AYNI
// desenle taklit edilir - burada yeni bir taklit deseni icat edilmez.
function fakeTonSession(sessionMasterKeyJwk, localInitial = {}) {
    const local = { ...localInitial }

    globalThis.chrome = {
        storage: {
            session: {
                get: vi.fn(async (key) => ({ [key]: sessionMasterKeyJwk })),
            },
            local: {
                get: vi.fn(async (keys) => {
                    const out = {}
                    for (const key of [].concat(keys)) out[key] = local[key]
                    return out
                }),
                set: vi.fn(async (obj) => { Object.assign(local, obj) }),
            },
        },
    }

    return local
}

const ACCOUNT_FIXTURE = { key: 'ton-onbellek-hesabi', address: '0x' + 'e'.repeat(40), type: 'hd', index: 0 }

// Adres onbellegi ADA GORE degil AGA GORE tutulmali. Eskiden tek bir
// `account.tonAddress` alani vardi ve ensureTonAddress ilk satirda kosulsuz onu
// donduruyordu: testnet'te turetilen adres mainnet'te de dondurulur, ya da tersi.
// Arayuz opts gecmiyordu (mainnet), background { testnet } geciyordu — yani ekranda
// bir adres, imzada baska bir sozlesme.
describe('ensureTonAddress — ag bazli onbellek', () => {
    beforeAll(async () => {
        const salt = randBytes(32)
        const sessionMasterKey = await deriveMasterKey('parola-onbellek-123', salt)
        const jwk = await exportMasterKey(sessionMasterKey)

        const vaultAccount = { ...ACCOUNT_FIXTURE }
        const vault = await createVault(sessionMasterKey, MNEMONIC, vaultAccount)

        // ACCOUNT_FIXTURE, bugun kullanicilarin diskinde ZATEN var olan durumu
        // simule eder: `tonAddress` alani gecmiste mainnet'ten turetilip
        // doldurulmus. Kusur tam burada ortaya cikar: bu alan AG AYRIMI yapmadan
        // her opts.testnet degeri icin dondurulurse, testnet cagrisi da bu ESKI
        // mainnet adresini alir.
        const mainnetIdentity = await tonIdentityForAccount(sessionMasterKey, [vault], vaultAccount)
        ACCOUNT_FIXTURE.tonAddress = mainnetIdentity.friendly

        fakeTonSession(jwk, { vaults: [vault] })
    }, 60000)

    it('mainnet ve testnet AYRI adres dondurur', async () => {
        const account = { ...ACCOUNT_FIXTURE }
        const main = await ensureTonAddress(account, { testnet: false })
        const test = await ensureTonAddress(account, { testnet: true })
        expect(main).not.toBe(test)
    })

    it('mainnet adresi UQ/EQ ile, testnet adresi 0Q/kQ ile baslar', async () => {
        const account = { ...ACCOUNT_FIXTURE }
        const main = await ensureTonAddress(account, { testnet: false })
        const test = await ensureTonAddress(account, { testnet: true })
        expect(main[0]).toMatch(/[UE]/)
        expect(test[0]).toMatch(/[0k]/)
    })

    it('ayni ag icin ikinci cagri ONBELLEKTEN doner (yeniden turetmez)', async () => {
        const account = { ...ACCOUNT_FIXTURE }
        const first = await ensureTonAddress(account, { testnet: false })
        const second = await ensureTonAddress(account, { testnet: false })
        expect(second).toBe(first)
    })
})

// Bu dosyanin bas yorumu MOCK KULLANMAMAYI acikca sart kosuyor: gercek kasa ve
// gercek kripto ile calisilir ki kasa semasindaki bir degisiklik burada da
// yakalansin. Asagidaki testler o kurala uyar - `createTonVault` gercekten
// cagrilir, sir gercekten sifrelenir ve gercekten cozulur.
describe('TON kasasinda turetme tipi kasadan gelir', () => {
    // Ayni ifade, iki turetme, IKI FARKLI ADRES. Fixture'in degeri bu: yanlis
    // dala dusen bir uygulama yanlis adresi uretir ve test gorur.
    const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
    const VIA_TON = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'
    const VIA_BIP39 = 'UQBviJxvVm84QbDBDJ_6quvu9nO2ZKJeOmSBRuDR-58k-e7m'

    let mk
    let tonVault
    let hdVaultDual

    const tonAccount = { key: 'ton-1', type: 'ton', address: VIA_TON }
    const hdAccount = { key: 'hd-1', type: 'hd', address: '0x' + '22'.repeat(20), index: 0 }

    beforeAll(async () => {
        // `exportMasterKey` KULLANILMAZ: o JWK NESNESI dondurur, ama `deriveVaultKey`
        // (crypto-utils.js:50) `crypto.subtle.exportKey('raw', masterKey)` cagiriyor ve
        // bu bir CryptoKey ister — JWK gecirilirse `beforeAll` daha ilk satirda
        // TypeError atar ve blogun tamami coker. Dosyanin mevcut `beforeAll`'u
        // (tonIdentity.test.js:25) zaten dogrusunu yapiyor; ayni desen izleniyor.
        mk = await deriveMasterKey('parola-123456', randBytes(32))
        tonVault = await createTonVault(mk, DUAL, tonAccount)
        // AYNI ifadeyle bir de HD kasa: tek degisken KASA TIPI olsun diye.
        hdVaultDual = await createVault(mk, DUAL, hdAccount)
    })

    it('tonMnemonic kasasi TON turetmesine gider', async () => {
        const { friendly } = await tonIdentityForAccount(mk, [tonVault], tonAccount)
        expect(friendly).toBe(VIA_TON)
    })

    // GERIYE DONUK UYUM: ayni ifade, sadece kasa tipi farkli. Mevcut kasalarin
    // adresi ZERRE degismemeli - diskte duran her TON adresi buna bagli.
    it('hd kasasi ayni ifadede BIP39 turetmesinde KALIR', async () => {
        const { friendly } = await tonIdentityForAccount(mk, [hdVaultDual], hdAccount)
        expect(friendly).toBe(VIA_BIP39)
    })

    it('TON kasasinin fingerprint i ed25519 tohumundan gelir', async () => {
        // HD kasa AYNI ifadeden EVM ozel anahtariyla hesapliyor; ikisi CAKISMAZ.
        // Cakissaydi ayni ifade "zaten aktarilmis" sanilir ve kullanici TON
        // cuzdanini hic aktaramazdi.
        expect(tonVault.fingerprint).not.toBe(hdVaultDual.fingerprint)
    })
})

import { tonVaultForAccount } from './tonIdentity'

// Hibrit hesap: EVM kasasinda yasar ama TON tarafi BASKA bir kasadan gelir.
// Bag `account.tonFingerprint` ile kurulur - adres degil PARMAK IZI, cunku parmak
// izi kasanin kimligidir ve cakismaya karsi zaten olculmustur.
describe('tonVaultForAccount — TON kasa cozumlemesinin tek bogazi', () => {
    const HYBRID = { key: 'k1', address: '0xabc', tonFingerprint: 'F_TON' }
    const EVM_VAULT = { type: 'hd', fingerprint: 'F_EVM', accounts: [HYBRID] }
    const TON_VAULT = { type: 'tonMnemonic', fingerprint: 'F_TON', accounts: [] }

    it('tonFingerprint varsa O kasayi doner - hesabin bulundugu kasayi DEGIL', () => {
        expect(tonVaultForAccount([EVM_VAULT, TON_VAULT], HYBRID)).toBe(TON_VAULT)
    })

    // Kasa dizideki SIRAYA bagli olmamali: findVaultForAccount ilk eslesmeyi
    // donduruyor ve siraya bagli bir cozumleme, kasalarin yazilma sirasi
    // degistiginde sessizce baska bir kasa acardi.
    it('kasa sirasi degisse de AYNI kasayi doner', () => {
        expect(tonVaultForAccount([TON_VAULT, EVM_VAULT], HYBRID)).toBe(TON_VAULT)
    })

    // GERIYE DONUK UYUM: diskteki type:'ton' hesaplarda bu alan YOK. Onlarin TON
    // adresi bugunku cozumlemeye bagli; degisirse adres bir gecede kayar.
    it('tonFingerprint YOKSA findVaultForAccount davranisina duser', () => {
        const legacy = { key: 'k2', address: 'UQlegacy' }
        const tonVault = { type: 'tonMnemonic', fingerprint: 'F_OLD', accounts: [legacy] }
        expect(tonVaultForAccount([tonVault], legacy)).toBe(tonVault)
    })

    // EN KRITIK IDDIA. Duserse hibrit hesabin TON adresi SESSIZCE EVM kasasindan
    // turetilirdi: kullaniciya A adresi gosterilir, imzalama B'nin anahtariyla
    // yapilirdi (background.js:290'da yazili kaza).
    it('tonFingerprint isaret ettigi kasa YOKSA FIRLATIR - EVM kasasina dusmez', () => {
        expect(() => tonVaultForAccount([EVM_VAULT], HYBRID)).toThrow('TON_VAULT_NOT_FOUND')
    })

    it('vaults bos/tanimsizsa da fırlatir', () => {
        expect(() => tonVaultForAccount(undefined, HYBRID)).toThrow('TON_VAULT_NOT_FOUND')
    })
})

// Iki yol da AYNI cozumleyiciyi kullanmali. Biri findVaultForAccount'ta kalirsa
// sir bir kasadan, turetme semasi baska bir kasadan gelir.
describe('tonIdentity TON kasasini TEK yerden cozer', () => {
    const SRC = readFileSync(fileURLToPath(new URL('./tonIdentity.js', import.meta.url)), 'utf8')

    const bodyOf = (name) => {
        const start = SRC.indexOf(`export async function ${name}(`)
        return SRC.slice(start, SRC.indexOf('\n}', start))
    }

    it.each([['tonSecretForAccount'], ['tonIdentityForAccount']])(
        '%s tonVaultForAccount cagirir', (fn) => {
            expect(bodyOf(fn)).toContain('tonVaultForAccount(')
        })

    it.each([['tonSecretForAccount'], ['tonIdentityForAccount']])(
        '%s findVaultForAccount i DOGRUDAN cagirmaz', (fn) => {
            expect(bodyOf(fn)).not.toContain('findVaultForAccount(')
        })
})
