import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { HDNodeWallet } from 'ethers'
import { mnemonicNew } from '@ton/crypto'
import { deriveMasterKey, createVault, unlockVault } from '../crypto-utils'
import { findVaultForAccount } from '../deriveAccount'
import { deriveSolanaAddress } from '../solana/derive'
import { evmMnemonicFromTonMnemonic } from './evmFromTon'
import { tonIdentityForAccount } from './tonIdentity'
import { tonKeyPairFromTonMnemonic } from './tonMnemonic'
import { tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'
import { buildHybridTonAccount } from './hybridTonAccount'

// TEK HESAP, IKI ZINCIR (kullanici karari, 2026-08-29).
//
// Eskiden bir Tonkeeper ifadesi IKI hesap doguruyordu: TON'a kilitli olan ve
// turetilmis EVM kasasindan dogan ayri bir hesap - ki o da KENDI ucuncu TON
// adresini turetiyordu. Artik tek hesap: EVM tarafi turetilmis kasadan, TON
// tarafi ice aktarilan kasadan.

let masterKey
beforeAll(async () => {
    masterKey = await deriveMasterKey('parola-123', new Uint8Array(16))
})

const newTonMnemonic = async () => (await mnemonicNew()).join(' ')


// Bu dosyadaki testlerin cogu GERCEK anahtar turetmesi yapiyor (PBKDF2 +
// BIP39); tek basina calisirken her biri ~0.8sn, ama 129 dosyalik paralel
// kosuda vitest'in 5sn'lik varsayilani devriliyordu. Yavaslik testin AMACI,
// bir tikanma degil - o yuzden sinir buyutuluyor, test hafifletilmiyor.
// (Ayni gerekce: cryptoUtils.reencrypt.test.js icindeki 30000 argumani.)
vi.setConfig({ testTimeout: 30000 })

describe('buildHybridTonAccount — sekil', () => {
    it('TEK hesap uretir; hesap HD tipinde ve EVM adresli', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })

        expect(r.status).toBe('created')
        expect(r.account.type).toBe('hd')
        expect(r.account.derivationPath).toBe("m/44'/60'/0'/0/0")
        expect(r.account.index).toBe(0)
        expect(r.account.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(r.account.name).toBe('Wats 2')
        expect(typeof r.account.key).toBe('string')
    })

    // Hesap TON'a KILITLI DEGIL: kopru, dapp, ATS pill, EVM satiri hepsi hesabin
    // `type` alaninin 'ton' OLMAMASI uzerine kurulu ve hepsi acik olmali.
    it('hesap TON a kilitli DEGIL', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })
        expect(r.account.type === 'ton').toBe(false)
    })

    it('EVM adresi TON ifadesinden TURETILEN ifadenin adresidir', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })
        const expected = HDNodeWallet.fromPhrase(await evmMnemonicFromTonMnemonic(words))
        expect(r.account.address).toBe(expected.address)
    })

    it('AYNI TON ifadesi her zaman AYNI EVM adresini verir', async () => {
        const words = await newTonMnemonic()
        const a = await buildHybridTonAccount(masterKey, words, { name: 'A' })
        const b = await buildHybridTonAccount(masterKey, words, { name: 'B' })
        expect(a.account.address).toBe(b.account.address)
    })

    it('gecersiz TON ifadesi FIRLATIR - yarim kurulum uretmez', async () => {
        await expect(buildHybridTonAccount(masterKey, 'gecersiz ifade', { name: 'X' }))
            .rejects.toThrow('TON_MNEMONIC_INVALID')
    })
})

// SPEC §6.1. findVaultForAccount kasalari sirayla tarar ve ILK eslesmeyi doner.
// Hesap iki kasada da bulunsaydi EVM yolu diziye once eklenen kasayi acardi -
// TON kasasi once eklenirse HDNodeWallet.fromPhrase bir TON ifadesi alirdi.
describe('§6.1 — hesap TEK kasanin accounts dizisinde bulunur', () => {
    it('TON kasasi hesap TASIMAZ', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })
        expect(r.tonVault.accounts).toEqual([])
    })

    it('EVM kasasi hesabi TASIR', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })
        expect(r.evmVault.accounts).toHaveLength(1)
        expect(r.evmVault.accounts[0].address).toBe(r.account.address)
    })
})

// SPEC §6.2 — ALTIN VEKTOR. Goruntuleme onbellegi (account.tonAddress) okurken
// imzalama turetiyor. Ikisi ayrisirsa kullanici A adresini gorup B'nin
// anahtariyla imzalar. Ayni ifadeden geldikleri icin ayrisamazlar; iddia bunu
// KILITLER, varsaymaz.
describe('§6.2 — gosterilen TON adresi imzalayan anahtarin adresidir', () => {
    it('yazilan tonAddress, ifadeden turetilen W5 adresine ESITTIR', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })

        const keyPair = await tonKeyPairFromTonMnemonic(words)
        const expected = toFriendlyTon(tonWalletAddress(keyPair.publicKey))

        expect(r.account.tonAddress).toBe(expected)
    })

    it('tonFingerprint TON kasasini isaret eder', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })
        expect(r.account.tonFingerprint).toBe(r.tonVault.fingerprint)
    })
})

// §6.2'NIN GERCEK KAPANISI.
//
// Ustteki iddia yazilan adresi DOGRUDAN hesaplanan W5 adresiyle karsilastiriyor -
// ayni hesabin iki kopyasi, ikisi de kurulum tarafinda. Asil soru cevapsiz kaliyor:
// IMZALAMA yolu ayni adresi mi uretiyor? O yol kasa cozumlemesinden (tonVaultForAccount),
// gercek sifre cozmeden ve secretKind secimden geciyor; herhangi biri saparsa kullanici
// A adresini gorup B'nin anahtariyla imzalar - background.js:290'da yazili kaza.
//
// Bu blok GERCEK kasalarla, GERCEK kripto ile gidis-donusu kapatir.
describe('§6.2 gidis-donus — kurulum ile IMZALAMA yolu ayni adresi verir', () => {
    // TERSINE DONDU (2026-09-05 manuel TON karari). Hibrit hesap `type:'hd'`
    // oldugu icin turetme bogazindaki accountHasTon kapisindan GECEMEZ; risk
    // defteri R5 bu nufusun TON tarafini KAYBETMESINI acikca yetkilendiriyor.
    // Paralar erisilebilir kalir: TON kasasinin 24 kelimelik ana ifadesi
    // Ayarlar > Guvenlik > Yedekleme'den okunuyor (linkedAccounts.js korunuyor).
    //
    // Kasa SIRASINDAN bagimsizlik iddiasi buradan kalkti ama kaybolmadi:
    // tonIdentity.test.js'teki `tonVaultForAccount` blogu onu saf yuklem olarak
    // olcmeye devam ediyor.
    // GUNCELLENDI (2026-09-10 Gorev 4, tekil aileden kumeye gecis): eski iddia
    // "hibrit hesap turetme bogazindan GECMEZ" idi -- o zaman accountHasTon
    // yalnizca gercek `type:'ton'` hesapta true donuyordu ve hibrit hesap
    // (`type:'hd'` + `tonFingerprint`) reddediliyordu. accountKind.js kumeye
    // gecince (Gorev 2) `type:'hd'` de TUM_AILELER doner, yani kapi artik bu
    // hesabi da GECIRIYOR -- ve tonVaultForAccount'un tonFingerprint dali
    // (tonIdentity.js) tam olarak bu hesabi kendi TON kasasina baglamak icin
    // var. Sonuc: hibrit hesap artik GERCEKTEN basariyla TON kimligi turetiyor.
    it('hibrit hesap kendi TON kasasindan basariyla TON kimligi turetir (tonFingerprint baglantisi)', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })

        const identity = await tonIdentityForAccount(masterKey, [r.tonVault, r.evmVault], r.account)
        expect(identity.friendly).toBe(r.account.tonAddress)
    })

    // §6.1'in gidis-donusu. AYNI hesap, AYNI dizi, ama EVM yolu: hesabin yasadigi
    // kasa EVM kasasi OLMALI. TON kasasi donseydi HDNodeWallet.fromPhrase bir TON
    // ifadesi alirdi.
    it('EVM yolu (findVaultForAccount) her sirada EVM kasasini doner', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })

        for (const order of [[r.tonVault, r.evmVault], [r.evmVault, r.tonVault]]) {
            expect(findVaultForAccount(order, r.account)).toBe(r.evmVault)
        }
    })

    it('EVM kasasindan cozulen ifade hesabin adresini uretir', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })

        const vault = findVaultForAccount([r.tonVault, r.evmVault], r.account)
        const phrase = await unlockVault(masterKey, vault)

        expect(HDNodeWallet.fromPhrase(phrase).address).toBe(r.account.address)
    })
})

// SPEC §6.3. Esit cikarlarsa tonVaultForAccount yanlis kasayi acar.
describe('§6.3 — iki kasa farkli parmak izi tasir', () => {
    it('TON ve EVM kasalarinin parmak izleri CAKISMAZ', async () => {
        const words = await newTonMnemonic()
        const r = await buildHybridTonAccount(masterKey, words, { name: 'Wats 2' })
        expect(r.tonVault.fingerprint).not.toBe(r.evmVault.fingerprint)
        expect(r.account.fingerprint).toBe(r.evmVault.fingerprint)
    })
})

describe('cakisma — TON kasasi zaten var', () => {
    it('AYNI TON ifadesi ikinci kez ice aktarilirsa FIRLATIR', async () => {
        const words = await newTonMnemonic()
        const first = await buildHybridTonAccount(masterKey, words, { name: 'A' })

        await expect(buildHybridTonAccount(masterKey, words, {
            name: 'B',
            existingVaults: [first.tonVault, first.evmVault],
        })).rejects.toThrow('TON_VAULT_ALREADY_IMPORTED')
    })
})

// Kullanici turetilmis BIP39 ifadesini AYRICA elle ice aktarmis olabilir. Yeni bir
// hesap uretmek AYNI m/44'/60'/0'/0/0 adresini ikinci kez, ikinci hesap olarak
// gosterirdi - kullanici birinden harcayinca digeri de bosalirdi.
describe('cakisma — turetilmis EVM kasasi zaten var (damgalama)', () => {
    const setup = async () => {
        const words = await newTonMnemonic()
        const phrase = await evmMnemonicFromTonMnemonic(words)
        const wallet = HDNodeWallet.fromPhrase(phrase)
        const existingAccount = {
            name: 'Elle Aktarilan', type: 'hd', index: 0,
            derivationPath: "m/44'/60'/0'/0/0", address: wallet.address, key: 'elle',
        }
        const existingEvm = await createVault(masterKey, phrase, existingAccount)
        return { words, existingEvm, existingAccount }
    }

    it('status linked doner ve YENI EVM kasasi uretmez', async () => {
        const { words, existingEvm } = await setup()
        const r = await buildHybridTonAccount(masterKey, words, {
            name: 'Wats 3', existingVaults: [existingEvm],
        })
        expect(r.status).toBe('linked')
        expect(r.evmVault).toBeUndefined()
    })

    it('VAR OLAN hesabi damgalar - ikinci hesap uretmez', async () => {
        const { words, existingEvm, existingAccount } = await setup()
        const r = await buildHybridTonAccount(masterKey, words, {
            name: 'Wats 3', existingVaults: [existingEvm],
        })

        expect(existingEvm.accounts).toHaveLength(1)
        expect(r.account).toBe(existingAccount)
        expect(r.account.name).toBe('Elle Aktarilan')
        expect(r.account.tonFingerprint).toBe(r.tonVault.fingerprint)
        expect(r.account.tonAddress).toMatch(/^UQ|^EQ/)
    })

    it('damgalanan hesabin adresi DEGISMEZ', async () => {
        const { words, existingEvm, existingAccount } = await setup()
        const before = existingAccount.address
        await buildHybridTonAccount(masterKey, words, {
            name: 'Wats 3', existingVaults: [existingEvm],
        })
        expect(existingAccount.address).toBe(before)
    })

    // Kasa var ama index:0 hesabi yok (elle silinmis / hic kurulmamis): hesap
    // normal yoldan uretilir ve O kasanin dizisine eklenir - §6.1 yine tek kasa.
    it('kasada index 0 hesabi YOKSA hesap o kasaya eklenir', async () => {
        const { words, existingEvm } = await setup()
        existingEvm.accounts = []

        const r = await buildHybridTonAccount(masterKey, words, {
            name: 'Wats 3', existingVaults: [existingEvm],
        })

        expect(r.status).toBe('linked')
        expect(existingEvm.accounts).toHaveLength(1)
        expect(existingEvm.accounts[0]).toBe(r.account)
        expect(r.account.name).toBe('Wats 3')
    })
})

describe('existingVaults verilmezse cokmez', () => {
    it('created doner', async () => {
        const words = await newTonMnemonic()
        expect((await buildHybridTonAccount(masterKey, words, { name: 'A' })).status)
            .toBe('created')
    })
})

// Kural IKI yerde uygulanmali: ilk cuzdan (CreatePassword2) ve ek cuzdan
// (ImportPhrases). Kullanicinin hangi kapidan girdigine gore farkli bir cuzdan
// almasi, ayni ifadenin iki farkli sonuc vermesi demektir.
describe('iki TON kurulum yolu da yardimciyi kullanir', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    const SITES = [
        ['../../components/onboarding/ImportPhrases.vue'],
        ['../../components/onboarding/CreatePassword2.vue'],
    ]

    it.each(SITES)('%s yardimciyi cagirir', (rel) => {
        expect(read(rel)).toContain('buildHybridTonAccount(')
    })

    it.each(SITES)('%s eski yardimciyi ARTIK cagirmaz', (rel) => {
        expect(read(rel)).not.toContain('buildHybridEvmVault')
    })

    // Kural KOPYALANMAMALI: turetme ve kasa kurulumu YALNIZCA yardimcida.
    it.each(SITES)('%s turetmeyi KOPYALAMAZ', (rel) => {
        const src = read(rel)
        expect(src).not.toContain('evmMnemonicFromTonMnemonic')
    })

    // TON'a KILITLI hesap ARTIK URETILMEZ. `type: 'ton'` yazan bir satir kalirsa
    // kullanicinin ice aktardigi cuzdan yine kopru/dapp disi kalirdi.
    it.each(SITES)('%s type ton hesabi URETMEZ', (rel) => {
        expect(read(rel)).not.toMatch(/type:\s*'ton'/)
    })

    it.each(SITES)('%s createTonVault i DOGRUDAN cagirmaz', (rel) => {
        const src = read(rel)
        const start = src.indexOf('<script setup>')
        expect(src.slice(start)).not.toContain('createTonVault(')
    })

    // existingVaults gecilmezse cakisma kontrolu KOR kalir: ayni TON ifadesi ikinci
    // kez ice aktarilabilir, ya da turetilmis EVM kasasi ikinci kez kurulur.
    // MUTASYONLA BULUNMUS bir kusur sinifi: yardimci dogru, KULLANIMI yanlisti.
    //
    // `existingVaults:` demek YETMEZ - `existingVaults: [...vaults]` de o iddiayi
    // gecerdi. KOPYA TEHLIKESI: yardimcinin 'linked' dali `stored.tonAddress` /
    // `stored.tonFingerprint` damgasini kendisine verilen dizinin UZERINE, YERINDE
    // basar (dosya basligindaki tek kasitli mutasyon). Kopya verilirse damga
    // atilacak nesneye duser, cagiran damgasiz orijinali yazar ve sonuc SESSIZCE
    // bozulur: hicbir yerden referans verilmeyen bir tonMnemonic kasasi + parmak
    // izi olmayan bir hesap. O hesabin TON tarafi findVaultForAccount uzerinden
    // EVM kasasina cozulur, BIP39 ile turetilir ve BASKA bir W5 adresi uretir -
    // ice aktarilan bakiye erisilemez olur ve hicbir yerde hata yukselmez.
    // Bu yuzden diziyi ADIYLA istiyoruz.
    it.each(SITES)('%s existingVaults i KOPYALAMADAN gecirir', (rel) => {
        const src = read(rel)
        const call = src.slice(src.indexOf('buildHybridTonAccount('))
        expect(call.slice(0, call.indexOf('})')), rel).toContain('existingVaults: vaults')
    })

    // 'linked' dalinda EVM kasasi YOKTUR. Kosulsuz push edilirse `vaults` dizisine
    // `undefined` girer ve findVaultForAccount ilk taramada coker.
    it.each(SITES)('%s evmVault u KOSULLU ekler', (rel) => {
        expect(read(rel), rel).toContain('if (evmVault) vaults.push(evmVault)')
    })

    // TON kasasi diske MUTLAKA yazilmali. Asagidaki sira iddiasi bunu TEK BASINA
    // garanti ETMEZ: `indexOf` bulunamayinca -1 doner ve -1 her pozitif indeksten
    // kucuktur - yani push satiri SILINSE de sira iddiasi yesil kalirdi. O durumda
    // kullanicinin TON anahtar malzemesi diske hic ulasmaz ve ice aktardigi cuzdan
    // bir daha acilamaz. Once VARLIK, sonra sira.
    it.each(SITES)('%s tonVault i diziye MUTLAKA ekler', (rel) => {
        expect(read(rel), rel).toContain('vaults.push(tonVault)')
    })

    // TEK YAZIM. Iki ayri `set` cagrisi olsaydi ikincisi patladiginda kullanici
    // yarim bir kurulumla kalirdi ve ice aktarma bir daha calismazdi.
    it('ImportPhrases TEK storage yaziminda kaydeder', () => {
        const src = read('../../components/onboarding/ImportPhrases.vue')
        const fn = src.slice(src.indexOf('const importTonWallet'))
        const body = fn.slice(0, fn.indexOf('\n}'))

        expect(body.match(/chrome\.storage\.local\.set\(/g) || []).toHaveLength(1)
        expect(body).toContain('vaults.push(tonVault)')
        expect(body.indexOf('vaults.push(tonVault)'))
            .toBeLessThan(body.indexOf('chrome.storage.local.set('))
    })

    it('ImportPhrases aktif hesap olarak TEK hesabi yazar', () => {
        const src = read('../../components/onboarding/ImportPhrases.vue')
        const fn = src.slice(src.indexOf('const importTonWallet'))
        expect(fn.slice(0, fn.indexOf('\n}'))).toContain('active_account: account')
    })

    // Zaten ice aktarilmis ifadede kullaniciya uyari gosterilmeli, sessizce
    // gecilmemeli: sessiz gecis "ice aktardim ama hicbir sey olmadi" demektir.
    it('ImportPhrases TON_VAULT_ALREADY_IMPORTED i uyariya cevirir', () => {
        const src = read('../../components/onboarding/ImportPhrases.vue')
        expect(src).toContain('TON_VAULT_ALREADY_IMPORTED')
        expect(src).toContain('alert_already_imported')
    })
})

describe('buildHybridTonAccount — Y2: EVM ve Solana da olusur (2026-09-10)', () => {
    it('hesap kaydinda solanaAddress alani VAR', async () => {
        const tonMnemonic = await newTonMnemonic()

        const { account } = await buildHybridTonAccount(masterKey, tonMnemonic, {
            name: 'TON Hesabi',
            existingVaults: [],
        })

        expect(account.solanaAddress).toBeTypeOf('string')
        expect(account.solanaAddress.length).toBeGreaterThan(30)
    })

    // Solana TURETILMIS BIP39 ifadesinden cikar, TON ifadesinden DEGIL.
    // bip39.mnemonicToSeed bir TON ifadesini de KABUL EDER (saf PBKDF2, checksum
    // yok) ve Phantom'un hic uretmeyecegi bir adres cikarirdi.
    it('solanaAddress turetilmis EVM ifadesinden gelir', async () => {
        const tonMnemonic = await newTonMnemonic()

        const { account } = await buildHybridTonAccount(masterKey, tonMnemonic, {
            name: 'TON Hesabi',
            existingVaults: [],
        })

        const phrase = await evmMnemonicFromTonMnemonic(tonMnemonic)
        const { address } = await deriveSolanaAddress(phrase, 0)
        expect(account.solanaAddress).toBe(address)
    })

    it('AYNI TON ifadesi HER ZAMAN ayni Solana adresini verir', async () => {
        const tonMnemonic = await newTonMnemonic()

        const a = await buildHybridTonAccount(masterKey, tonMnemonic, {
            name: 'A', existingVaults: [],
        })
        const b = await buildHybridTonAccount(masterKey, tonMnemonic, {
            name: 'B', existingVaults: [],
        })
        expect(a.account.solanaAddress).toBe(b.account.solanaAddress)
    })
})
