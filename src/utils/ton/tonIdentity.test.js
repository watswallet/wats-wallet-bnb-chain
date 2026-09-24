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
import { tonSecretForAccount, tonIdentityForAccount, ensureTonAddress, TON_SCHEME } from './tonIdentity'
import { tonKeyPairFromMnemonic, tonKeyPairFromPrivateKey, tonWalletAddress, deriveTonAccount } from './tonAccount'
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

    // SILINDI (2026-09-05 manuel TON karari): "HD hesaplarin TON adresi indekse
    // gore AYRISIR", "ozel anahtar hesabinin adresi anahtardan turer" ve "testnet
    // secildiginde adres 0Q ile baslar". Ucu de `tonIdentityForAccount`i EVM
    // hesabiyla cagiriyordu; artik o cagri TON_ACCOUNT_REQUIRED aliyor.
    // Kaybolan kapsam BASKA YERDE duruyor: indeks izolasyonu ve ozel anahtar
    // turetmesi tonAccount.test.js:32/49/80'de, testnet adresi ise yukaridaki
    // "hesap kapisi" blogunda gercek bir TON kasasiyla olculuyor.
    // Kalan dort test `tonSecretForAccount`i olcuyor ve o fonksiyon degismedi.
})

// TURETMENIN TEK BOGAZI: `tonIdentityForAccount`. Bir hesabin TON cuzdani ya
// VARDIR (type:'ton') ya YOKTUR; "henuz turetilmedi" diye ucuncu bir durum
// kalmadi. Kapi olmadan sıradan bir EVM hesabi kendi tohumundan sessizce bir TON
// adresi doguruyordu: kullanicinin hic istemedigi, yedegini almadigi, hicbir
// yerde gormedigi bir cuzdan.
describe('tonIdentityForAccount hesap kapisi — TON olmayan hesap REDDEDILIR', () => {
    // Cift-gecerli ifade: hem TON hem BIP39 semasinda gecerli. Fixture'in degeri
    // bu - yanlis dala dusen bir uygulama BASKA bir adres uretir ve test gorur.
    const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
    const VIA_TON = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'

    let mk
    let hdVaultGate
    let pkVaultGate
    let tonVaultGate

    beforeAll(async () => {
        mk = await deriveMasterKey('parola-kapi-123', randBytes(32))
        hdVaultGate = await createVault(mk, MNEMONIC, {
            key: 'kapi-hd', address: '0x' + '1'.repeat(40), type: 'hd', index: 0,
        })
        pkVaultGate = await createVaultWithPrivateKey(mk, PRIVATE_KEY, {
            key: 'kapi-pk', address: '0x' + '2'.repeat(40), type: 'privateKey',
        })
        tonVaultGate = await createTonVault(mk, DUAL, {
            key: 'kapi-ton', type: 'ton', index: 0, address: VIA_TON,
        })
    })

    // TERSINE DONDU (2026-09-10 tek seed cok zincir): Y1+Y3 karari HER HD hesaba
    // TON verdi (accountKind.js -> accountKindsOf('hd') artik TUM_AILELER
    // iceriyor). Eskiden bu test HD hesabin kapidan TON_ACCOUNT_REQUIRED ile
    // geri cevrildigini kilitliyordu; artik kapidan GECIYOR ve kendi ana
    // ifadesinden TURETILEN (tonFromSeed.js) bir TON adresi doner.
    it("type:'hd' hesap kapidan GECER ve turetilmis TON adresini uretir", async () => {
        const { friendly } = await tonIdentityForAccount(mk, [hdVaultGate], hdVaultGate.accounts[0])
        const direct = await deriveTonAccount(MNEMONIC, { index: 0 }, {
            secretKind: 'derivedTonMnemonic', vaultType: 'hd',
        })
        expect(friendly).toBe(direct.friendly)
        expect(friendly).toMatch(/^UQ/)
    })

    it("type:'privateKey' hesap TON_ACCOUNT_REQUIRED alir", async () => {
        await expect(tonIdentityForAccount(mk, [pkVaultGate], pkVaultGate.accounts[0]))
            .rejects.toThrow('TON_ACCOUNT_REQUIRED')
    })

    // FAIL-CLOSED, bilincli ve `accountKindsOf`in genel yonune TERS. Cogu yuzeyde
    // bilinmeyen tip FAIL-OPEN'dir (acilista `active_account` bir an bos olabiliyor
    // ve o anda her sey kilitlenmemeli). TURETMEDE tersi gecerli: bilinmeyen bir
    // kayittan ed25519 anahtari uretmek, bu belgenin kapattigi sessiz turetmenin
    // ta kendisi. Bekleyen kullanici, yanlis adres alan kullanicidan iyidir.
    it('tipi BILINMEYEN hesap da reddedilir (fail-closed)', async () => {
        await expect(tonIdentityForAccount(mk, [hdVaultGate], { key: 'kapi-hd', address: '0x' + '1'.repeat(40) }))
            .rejects.toThrow('TON_ACCOUNT_REQUIRED')
    })

    // TERSINE DONDU (2026-09-10): eski R5 karari ("bu nufus TON tarafini
    // KAYBEDER") artik GECERSIZ - kapi HER type:'hd' hesabi geciriyor
    // (yukaridaki test) ve `tonVaultForAccount` tonFingerprint'i hala takip
    // ediyor. Eski hibrit kayit artik kaybetmiyor: tonFingerprint GERCEK bir TON
    // kasasini gosteriyorsa o kasadan TAM ERISIMLE cozuluyor.
    it('eski hibrit kayit (type:hd + tonFingerprint) artik kendi TON kasasindan GECER', async () => {
        const hybrid = {
            key: 'kapi-hd', address: '0x' + '1'.repeat(40), type: 'hd',
            tonFingerprint: tonVaultGate.fingerprint,
        }
        const { friendly } = await tonIdentityForAccount(mk, [hdVaultGate, tonVaultGate], hybrid)
        expect(friendly).toBe(VIA_TON)
    })

    // Kapi KASAYA DOKUNMADAN reddeder. Kasa dizisi BOS verilmesine ragmen hata
    // ACCOUNT_VAULT_NOT_FOUND degil TON_ACCOUNT_REQUIRED olmali: yani kasa aramasi
    // hic calismamis, sir hic cozulmemis.
    //
    // 2026-09-10: hesap tipi 'hd'den 'privateKey'ye degisti - 'hd' artik TON
    // tasiyor (yukaridaki test) ve kapiyi GECIP vault aramasina girerdi; bu
    // testin olcmek istedigi sey (kapi ARAMADAN ONCE calisir) icin kapinin
    // GERCEKTEN reddettigi bir tip gerekiyor.
    it('kapi kasa aramasindan ONCE calisir', async () => {
        await expect(tonIdentityForAccount(mk, [], { key: 'yok', type: 'privateKey', address: '0x' + '3'.repeat(40) }))
            .rejects.toThrow('TON_ACCOUNT_REQUIRED')
    })

    it("type:'ton' hesap kapidan GECER ve mainnet adresini uretir", async () => {
        const { friendly } = await tonIdentityForAccount(mk, [tonVaultGate], tonVaultGate.accounts[0])
        expect(friendly).toBe(VIA_TON)
    })

    it("type:'ton' hesapta testnet adresi 0Q ile baslar", async () => {
        const { friendly } = await tonIdentityForAccount(
            mk, [tonVaultGate], tonVaultGate.accounts[0], { testnet: true })
        expect(friendly.startsWith('0Q')).toBe(true)
    })
})

// FIX 7 (kucuk bulgu, fix dalgasi) — `secretKindForVault(vault)` ESKIDEN
// `deriveTonAccount`e ARGUMAN olarak, yani `tonSecretForAccount` (kasayi ACAN
// cagri) TAMAMLANDIKTAN SONRA degerlendiriliyordu. Ustteki `accountHasTon`
// kapisi INV-1'i (type:'ton' hesap ama kasasi 'tonMnemonic' DEGIL) pratikte
// erisilemez kilar, ama defans-derinliginde bu SIRA onemliydi: kapi delinirse
// (ornegin ileride yazilacak bir goc/onarim kodu boyle bir kaydi sessizce
// birakirsa) sir YINE DE kasadan cikarilip SONRADAN atilirdi.
//
// MOCKSUZ kanit: HD kasanin sifreli govdesi (`mnemonic` alani) BOZULUR.
// `unlockVault` GERCEKTEN cagrilirsa AES-GCM auth etiketi uyusmaz ve
// crypto-utils.js:120'deki "Decryption failed: ..." hatasi firlar --
// TON_VAULT_TYPE_INVALID'den TAMAMEN FARKLI, tanınabilir bir hata. Kapi
// dogru sirada calisiyorsa bu bozuk kasa HIC ACILMAZ ve tek gorulen hata
// TON_VAULT_TYPE_INVALID olur.
describe('secretKindForVault kasa acilmadan ONCE calisir (FIX 7, INV-1 defans-derinligi)', () => {
    it("INV-1 ihlali (type:'ton' hesap ama kasa 'hd'): sir COZULMEDEN reddedilir", async () => {
        const mk = await deriveMasterKey('parola-fix7-123456', randBytes(32))
        const hdVaultInv1 = await createVault(mk, MNEMONIC, {
            key: 'inv1-hd', address: '0x' + '7'.repeat(40), type: 'hd', index: 0,
        })

        // Bozuk/gecersiz bir disk kaydi simule edilir: AYNI (hd) kasaya
        // type:'ton' bir hesap eklenir. `tonVaultForAccount` bu hesabi
        // (tonFingerprint yok) `findVaultForAccount` ile bu kasada bulur.
        const rogueAccount = { key: 'inv1-ton', type: 'ton', address: 'UQ' + 'x'.repeat(46) }
        hdVaultInv1.accounts.push(rogueAccount)

        // Sifreli govdeyi BOZ (ters cevir - AYNI base64 alfabesinde kalir,
        // ama AES-GCM auth etiketiyle ARTIK uyusmaz).
        const corruptVault = {
            ...hdVaultInv1,
            mnemonic: hdVaultInv1.mnemonic.split('').reverse().join(''),
        }

        await expect(tonIdentityForAccount(mk, [corruptVault], rogueAccount))
            .rejects.toThrow('TON_VAULT_TYPE_INVALID')
    })
})

// RISK DEFTERI R2 — arayuz bir TON adresi gosterirken arka plan BASKASIYLA
// imzalar. Saklanan `tonAddress` artik diskten OKUNUYOR (knownRecipients.js:51,
// useAddressSecurity.js:78, AddressBook.vue:237, recentRecipients.js:44) ama
// imzalama hala TURETIYOR. Elle duzenlenmis bir kayit ya da ileride yazilan bir
// goc ozdesligi bozar ve hicbir sey yeniden hesaplamaz.
describe('tonIdentityForAccount adres capraz kontrolu (R2)', () => {
    const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
    const VIA_TON = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'
    const BASKA_ADRES = 'UQBviJxvVm84QbDBDJ_6quvu9nO2ZKJeOmSBRuDR-58k-e7m'

    let mk
    let tonVaultR2
    const base = { key: 'r2-ton', type: 'ton', index: 0, address: VIA_TON }

    beforeAll(async () => {
        mk = await deriveMasterKey('parola-r2-123', randBytes(32))
        tonVaultR2 = await createTonVault(mk, DUAL, { ...base })
    })

    // DAMGA SART (2026-09-11): kontrol yalnizca `tonScheme` damgali kayitlarda
    // firlatir. Damgasiz bir kayittaki fark BEKLENIR -- o adres eski SLIP-10
    // semasindan gelmistir (origin/main 1.7.0 onu diske yaziyordu) ve firlatmak
    // o kullanicilarin TON'unu tumden oldururdu.
    it('DAMGALI kayitta tonAddress uyusmuyorsa FIRLATIR', async () => {
        await expect(tonIdentityForAccount(mk, [tonVaultR2], {
            ...base, tonAddress: BASKA_ADRES, tonScheme: TON_SCHEME,
        })).rejects.toThrow('TON_ADDRESS_MISMATCH')
    })

    it('DAMGASIZ (eski sema) kayitta FIRLATMAZ -- fark beklenir', async () => {
        const sonuc = await tonIdentityForAccount(mk, [tonVaultR2], { ...base, tonAddress: BASKA_ADRES })
        expect(sonuc.friendly).toBe(VIA_TON)
    })

    it('kayitli tonAddress turetilenle AYNIYSA gecirir', async () => {
        const { friendly } = await tonIdentityForAccount(mk, [tonVaultR2], { ...base, tonAddress: VIA_TON })
        expect(friendly).toBe(VIA_TON)
    })

    // BOS alan UYUSMAZLIK DEGILDIR. Mevcut type:'ton' kayitlarda
    // `tonAddressTestnet` hic yazilmadi - bos bir alani "uyusmazlik" saymak
    // R2'yi kapatmak icin R5'i acmak olurdu - calisan imzalama olurdu.
    // Kontrol YALNIZCA YANLISI yakalar, EKSIGI degil.
    it('tonAddressTestnet BOSSA testnet turetmesi calismaya devam eder', async () => {
        const { friendly } = await tonIdentityForAccount(
            mk, [tonVaultR2], { ...base, tonAddress: VIA_TON }, { testnet: true })
        expect(friendly.startsWith('0Q')).toBe(true)
    })

    // Kontrol AGA GORE alan secer. Testnet alanina yanlis bir deger yazilmis
    // kayitta MAINNET turetmesi GECMELI (kendi alani dogru), TESTNET turetmesi
    // DUSMELI. Tek bir `tonAddress` alanina bakan bir uygulama ikisini karistirir
    // ve ekranda bir adres, imzada baska bir sozlesme olur.
    it('testnet cagrisi tonAddressTestnet alanini okur', async () => {
        const acc = {
            ...base, tonAddress: VIA_TON, tonAddressTestnet: BASKA_ADRES, tonScheme: TON_SCHEME,
        }
        expect((await tonIdentityForAccount(mk, [tonVaultR2], acc)).friendly).toBe(VIA_TON)
        await expect(tonIdentityForAccount(mk, [tonVaultR2], acc, { testnet: true }))
            .rejects.toThrow('TON_ADDRESS_MISMATCH')
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

// TON kasasi + type:'ton' hesap: turetme bogazi artik YALNIZCA bu sekli kabul
// ediyor (accountHasTon kapisi). Eskiden burada type:'hd' bir hesap vardi ve
// "bugun kullanicilarin diskinde ZATEN var olan durum" diye savunuluyordu; o
// durum artik hicbir kod yolundan uretilemiyor.
const CACHE_DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
const CACHE_TON_ADDR = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'
const ACCOUNT_FIXTURE = { key: 'ton-onbellek-hesabi', type: 'ton', index: 0, address: CACHE_TON_ADDR }

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
        const vault = await createTonVault(sessionMasterKey, CACHE_DUAL, vaultAccount)

        // `tonAddress` alani gecmiste mainnet'ten doldurulmus bir kaydi simule
        // eder. Kusur tam burada ortaya cikar: bu alan AG AYRIMI yapmadan her
        // opts.testnet degeri icin dondurulurse, testnet cagrisi da bu ESKI
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

    // TERSINE DONDU (2026-09-10 tek seed cok zincir). 2026-09-05'te "hd kasasi
    // TON turetmesine HIC girmez" idi ve gerekcesi "EVM hesabinin TON adresi HIC
    // YOK, korunacak bir adres de yok" idi. Y1+Y3 karari bunu bir kez daha
    // tersine cevirdi: artik HER hd hesabin TON'u var, ama DUAL'i dogrudan bir
    // TON ifadesi gibi OKUMAZ (o dal tonMnemonic kasasina ait) - kendi ana
    // ifadesini bir BIP39 tohumu sayip ondan YENI bir TON-native ifade
    // (tonFromSeed.js) arar. Iki turetme FARKLI adres uretir.
    it('hd kasasindaki hesap KENDI turetilmis TON kimligini uretir - VIA_TON DEGIL', async () => {
        const { friendly } = await tonIdentityForAccount(mk, [hdVaultDual], hdAccount)
        expect(friendly).toMatch(/^UQ/)
        expect(friendly).not.toBe(VIA_TON)
    })

    it('TON kasasinin fingerprint i ed25519 tohumundan gelir', async () => {
        // HD kasa AYNI ifadeden EVM ozel anahtariyla hesapliyor; ikisi CAKISMAZ.
        // Cakissaydi ayni ifade "zaten aktarilmis" sanilir ve kullanici TON
        // cuzdanini hic aktaramazdi.
        expect(tonVault.fingerprint).not.toBe(hdVaultDual.fingerprint)
    })
})

import { tonVaultForAccount } from './tonIdentity'
import { secretKindForVault } from './tonIdentity'

// `secretKindForVault` TAM ve FIRLATANDIR. 'hd'/'privateKey' icin `undefined`
// donmek, tonAccount.js'teki TAHMIN MOTORUNU yetkilendiren seydi: undefined
// gecen her cagri `value.includes(' ')` sezgisine dusuyordu ve TON kasasindaki
// 24 kelime BIP39 sanilip SESSIZCE yanlis adres uretiliyordu.
//
// Ustundeki accountHasTon kapisi bu firlatmayi pratikte ERISILEMEZ kilar - yani
// kapi belgelenmiyor, KAPATILIYOR.
describe('secretKindForVault — tam ve firlatan', () => {
    it("tonMnemonic kasasi 'tonMnemonic' semasini verir", () => {
        expect(secretKindForVault({ type: 'tonMnemonic' })).toBe('tonMnemonic')
    })

    // 2026-09-10: 'hd' bu listeden CIKTI - artik firlatmiyor, 'derivedTonMnemonic'
    // donuyor (bkz. asagidaki 'hd kasasi artik TON turetir' bloğu). Tek secp256k1
    // anahtarindan ed25519 TURETILEMEDIGI icin 'privateKey' hala firlatir.
    it.each([['privateKey']])("'%s' kasasi TON_VAULT_TYPE_INVALID firlatir", (type) => {
        expect(() => secretKindForVault({ type })).toThrow('TON_VAULT_TYPE_INVALID')
    })

    it('kasa yok/tanimsiz/bos ise de firlatir - sessiz undefined YOK', () => {
        expect(() => secretKindForVault(undefined)).toThrow('TON_VAULT_TYPE_INVALID')
        expect(() => secretKindForVault(null)).toThrow('TON_VAULT_TYPE_INVALID')
        expect(() => secretKindForVault({})).toThrow('TON_VAULT_TYPE_INVALID')
    })

    // Yakin yazim da sezgiye DUSMEZ: 'tonmnemonic' (kucuk m) gibi tek harflik bir
    // hata TON kasasini BIP39 dalina sokardi.
    it('yakin yazimlar da reddedilir', () => {
        expect(() => secretKindForVault({ type: 'tonmnemonic' })).toThrow('TON_VAULT_TYPE_INVALID')
    })
})

// Hibrit hesap: EVM kasasinda yasar ama TON tarafi BASKA bir kasadan gelir.
// Bag `account.tonFingerprint` ile kurulur - adres degil PARMAK IZI.
//
// BU BLOK SAF YUKLEM TESTIDIR. 2026-09-10 ONCESINDE olctugu dal ERISILEMEZDI:
// `tonIdentityForAccount`in `accountHasTon` kapisi, `tonFingerprint` tasiyan tek
// nufusu (`type:'hd'` eski hibritler) daha kasa cozumlemesine varmadan
// reddediyordu. Artik HER `type:'hd'` hesabin TON'u var (Y1+Y3 karari), yani
// kapi bu nufusu da GECIRIYOR ve dal GERCEKTEN calisiyor - bkz.
// tonIdentity.test.js: 'eski hibrit kayit ... artik kendi TON kasasindan GECER'.
// Fonksiyonun kendisi export ve bu iddialar onun sozlesmesini kilitliyor.
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

describe('secretKindForVault — hd kasasi artik TON turetir (2026-09-10)', () => {
    it('tonMnemonic kasasi TON un kendi semasini kullanir', () => {
        expect(secretKindForVault({ type: 'tonMnemonic' })).toBe('tonMnemonic')
    })

    it('hd kasasi TURETILMIS ifadeyi kullanir', () => {
        expect(secretKindForVault({ type: 'hd' })).toBe('derivedTonMnemonic')
    })

    // Tek secp256k1 anahtarindan ed25519 TURETILEMEZ.
    it('privateKey kasasi FIRLATIR', () => {
        expect(() => secretKindForVault({ type: 'privateKey' })).toThrow('TON_VAULT_TYPE_INVALID')
    })

    // FAIL-CLOSED: kasa tipini yalnizca biz yaziyoruz; tanimadigimiz bir tip
    // bozulmadir ve ondan anahtar uretmek tam olarak kapatilmak istenen sey.
    it('bilinmeyen kasa tipi FIRLATIR', () => {
        expect(() => secretKindForVault({ type: 'gelecek' })).toThrow('TON_VAULT_TYPE_INVALID')
        expect(() => secretKindForVault(undefined)).toThrow('TON_VAULT_TYPE_INVALID')
    })
})

// Yardimci: hd kasasi kurar, chrome.storage.local'a yazar, hesabi doner.
// `fakeTonSession` ile AYNI taklit deseni (masterKey.test.js:fakeSession) -
// burada yeni bir taklit deseni icat edilmiyor.
async function hdKasaKurVeYaz(masterMnemonic, index) {
    const salt = randBytes(32)
    const sessionMasterKey = await deriveMasterKey('parola-hd-dolum-123', salt)
    const jwk = await exportMasterKey(sessionMasterKey)

    const account = {
        key: `hd-dolum-${index}`,
        address: '0x' + String(index).padStart(40, '0'),
        type: 'hd',
        index,
    }
    const vault = await createVault(sessionMasterKey, masterMnemonic, account)

    fakeTonSession(jwk, { vaults: [vault] })

    return { account, vault, masterKey: sessionMasterKey }
}

// Spec §4.2: `ensureTonAddress` kod degisikligi ALMIYOR - rolu degisiyor. Artik
// ana yol degil, olusturma aninda yazilamamis kayitlari (magazadan gelen 1.4.0
// HD hesaplari, testnet alani) dolduran katman. Bu blok o davranisi KILITLER.
describe('ensureTonAddress — hd hesabi doldurur (2026-09-10)', () => {
    const MASTER = 'abandon '.repeat(11) + 'about'
    const GOLDEN_INDEX_0 = 'UQDqyT778Wrtja0ouo994yPNugR3jM7NAofAgs6WnJg6SveD'

    // Magazadaki 1.4.0 kullanicilarinin HD hesaplarinda `tonAddress` alani YOK.
    // Goc YAZILMAZ (2026-09-05 K2); dolduran bu fonksiyondur.
    it('tonAddress alani BOS olan eski kayitta adresi turetir', async () => {
        const { account } = await hdKasaKurVeYaz(MASTER, 0)
        delete account.tonAddress

        expect(await ensureTonAddress(account)).toBe(GOLDEN_INDEX_0)
    })

    // Alan doluysa TURETME HIC KOSMAZ: ~70 ms'lik arama her ekran acilisinda
    // tekrarlanamaz.
    it('alan doluysa VE DAMGALIYSA onbellekten doner, turetmez', async () => {
        const account = {
            type: 'hd', index: 0, tonAddress: 'UQ_onceden_yazilmis', tonScheme: TON_SCHEME,
        }
        expect(await ensureTonAddress(account)).toBe('UQ_onceden_yazilmis')
    })

    // ASIL GOC KAPISI (olculdu 2026-09-11): origin/main (1.7.0) her HD hesap
    // icin `tonAddress`i ESKI SLIP-10 semasindan turetip diske yaziyordu. O alan
    // DAMGASIZ. Onbellek sayilsaydi arayuz sonsuza kadar artik imzalanamayan bir
    // adres gosterirdi -- ve her imza TON_ADDRESS_MISMATCH ile duserdi.
    it('DAMGASIZ alan onbellek SAYILMAZ -- yeniden turetilir', async () => {
        const { account, vault } = await hdKasaKurVeYaz(MASTER, 0)

        // main 1.7.0'in diske yazdigi hal: ESKI SLIP-10 adresi, damga YOK.
        const ESKI = await (async () => {
            const { friendly } = await deriveTonAccount(MASTER, { index: 0 }, {
                secretKind: 'bip39', vaultType: 'hd',
            })
            return friendly
        })()
        account.tonAddress = ESKI
        vault.accounts[0].tonAddress = ESKI
        delete account.tonScheme
        delete vault.accounts[0].tonScheme

        expect(await ensureTonAddress(account)).toBe(GOLDEN_INDEX_0)
    })

    // Eski adres SILINMEZ: kullanicinin orada fonu olabilir ve index > 0'daki
    // eski adres hicbir cuzdanda ifadeyle acilamaz (Tonkeeper'in BIP-39 yolu
    // index 0'a sabittir), yani uygulama disinda kurtarma yolu YOK.
    it('eski adres tonAddressLegacy altina TASINIR, damga yazilir', async () => {
        const { account, vault } = await hdKasaKurVeYaz(MASTER, 0)
        const { friendly: ESKI } = await deriveTonAccount(MASTER, { index: 0 }, {
            secretKind: 'bip39', vaultType: 'hd',
        })
        account.tonAddress = ESKI
        vault.accounts[0].tonAddress = ESKI

        await ensureTonAddress(account)

        const { vaults } = await chrome.storage.local.get('vaults')
        const kayit = vaults[0].accounts[0]
        expect(kayit.tonAddress).toBe(GOLDEN_INDEX_0)
        expect(kayit.tonAddressLegacy).toBe(ESKI)
        expect(kayit.tonScheme).toBe(TON_SCHEME)
    })

    // IKINCI gecis eski adresi EZMEMELI: `tonAddressLegacy` bir kez yazilir.
    it('ikinci cagri tonAddressLegacy uzerine YAZMAZ', async () => {
        const { account, vault } = await hdKasaKurVeYaz(MASTER, 0)
        const { friendly: ESKI } = await deriveTonAccount(MASTER, { index: 0 }, {
            secretKind: 'bip39', vaultType: 'hd',
        })
        account.tonAddress = ESKI
        vault.accounts[0].tonAddress = ESKI

        await ensureTonAddress(account)
        const ilk = (await chrome.storage.local.get('vaults')).vaults[0].accounts[0]

        await ensureTonAddress({ ...ilk })
        const ikinci = (await chrome.storage.local.get('vaults')).vaults[0].accounts[0]

        expect(ikinci.tonAddressLegacy).toBe(ESKI)
    })
})
