// ARKA PLAN (IMZALAMA) YOLU — `background.js:createTonKeyPair`.
//
// Neden ayri bir dosya: bu plandaki en pahali kusur tam olarak burada yasadi ve
// ON BIR gozden gecirmeden gecti. Sebebi acik — mevcut testlerin hepsi KIMLIK
// seklini (`tonIdentityForAccount`) olcuyordu, arka planin sekli hic
// olculmuyordu. Arka plan kendi kopyasini kurup `secretKind` GECIRMEYINCE, TON
// kasasindaki ifade `value.includes(' ')` sezgisine dusuyor ve BIP39 dalina
// giriyordu:
//
//   Kullaniciya gosterilen adres  : tonIdentityForAccount -> UQB1-bGB... (dogru)
//   Imzalamada kullanilan anahtar : deriveTonAccount(secret, account, {testnet})
//                                   -> UQBviJxv... (YANLIS)
//
// Ikisi de "gecerli gorunumlu" bir W5 adresi uretir; bip39.mnemonicToSeed saf
// PBKDF2'dir ve saglama DOGRULAMAZ, yani hicbir yerde hata cikmaz. Gonderimler
// hic ulasmaz.
//
// Burada iki sey birden olculuyor:
//   1) YAPISAL — background.js gercekten tek govdeyi cagiriyor mu (kaynak metin;
//      arka plandaki bir geri donusu goren TEK sey budur).
//   2) DAVRANISSAL — arka planin CALISMA ORTAMI (oturum JWK'si + diskteki kasa)
//      bire bir kurulup, IMZALAYAN anahtarin urettigi adresin GOSTERILEN adresle
//      ayni oldugu dogrulaniyor; ve eski seklin gercekten baska bir adres
//      urettigi altin vektorle sabitleniyor (yani (1)'in bos bir kilit olmadigi).

import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTonVault, deriveMasterKey, randBytes } from '../crypto-utils'
import { tonSecretForAccount, tonIdentityForAccount } from './tonIdentity'
import { deriveTonAccount, tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'

const BACKGROUND = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')
// Kod -> i18n ANAHTARI tablosu background.js'ten BURAYA tasindi: arka plan servis
// calisani dil bilmez ve oradaki SABIT TURKCE cumleler ingilizce arayuzde oldugu
// gibi gorunuyordu. Taramanin AMACI degismedi -- eksik kalan bir kod hala
// sessizce jenerik mesaja duserdi.
const TON_SEND_ERRORS_SRC = readFileSync(fileURLToPath(new URL('./tonSendErrors.js', import.meta.url)), 'utf8')

// `createTonKeyPair` govdesi: sonraki `async function` tanimina kadar.
const CREATE_TON_KEY_PAIR = (() => {
    const start = BACKGROUND.indexOf('async function createTonKeyPair')
    expect(start, 'background.js icinde createTonKeyPair bulunamadi').toBeGreaterThan(-1)
    const rest = BACKGROUND.slice(start + 1)
    const end = rest.indexOf('\nasync function ')
    return rest.slice(0, end === -1 ? undefined : end)
})()

const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
const VIA_TON = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'
// eski 'bip39' sezgisinin urettigi adresti (VIA_BIP39 = 'UQBviJxvVm84QbDBDJ_6quvu9nO2ZKJeOmSBRuDR-58k-e7m').
// 2026-09-10'da yol kapandigi icin artik uretilmiyor, deger yalnizca belge amaciyla anilir.

describe('createTonKeyPair TEK turetme govdesini cagirir', () => {
    // Iddia GOVDEYE bakiyor, dosyaya degil: `toContain('tonIdentityForAccount')`
    // import satiriyla da karsilanirdi - bu depoda daha once tam bu kusur bulundu.
    it('tonIdentityForAccount CAGRILIR', () => {
        expect(CREATE_TON_KEY_PAIR).toMatch(/tonIdentityForAccount\(/)
    })

    // ASIL KUSUR: arka plan kendi turetmesini kuruyordu. O ikinci govde GERI
    // GELMEMELI - geri gelirse `secretKind`i unutmak yine mumkun olur.
    it('kendi turetmesini KURMAZ (deriveTonAccount cagirmaz)', () => {
        expect(CREATE_TON_KEY_PAIR).not.toMatch(/deriveTonAccount\(/)
    })

    it('sirri kendi cikarip elden gecirmez (tonSecretForAccount cagirmaz)', () => {
        // Sir cikarma + turetme AYRI iki adima bolunurse aradaki `secretKind`
        // yine dusebilir; bolunmenin kendisi kusurun sekliydi.
        expect(CREATE_TON_KEY_PAIR).not.toMatch(/tonSecretForAccount\(/)
    })

    it('background.js artik deriveTonAccount i HIC ice aktarmaz', () => {
        expect(BACKGROUND).not.toMatch(/import\s*\{[^}]*\bderiveTonAccount\b[^}]*\}\s*from/)
    })
})

describe('arka planin CALISMA ORTAMINDA imzalayan anahtar = gosterilen adres', () => {
    let masterKey
    let tonVault
    const account = { key: 'ton-1', type: 'ton', address: VIA_TON }

    beforeAll(async () => {
        masterKey = await deriveMasterKey('parola-123456', randBytes(32))
        tonVault = await createTonVault(masterKey, DUAL, account)
    })

    /**
     * background.js:createTonKeyPair'in bire bir kopyasi DEGIL, ORTAMI:
     * oturumdaki JWK'den geri kurulan masterKey + diskten okunan `vaults`.
     * Cagrilan govde production'in cagirdigi govdenin AYNISI.
     */
    const backgroundKeyPair = async (vaults, acc, { testnet = false } = {}) => {
        // Arka plan masterKey'i chrome.storage.session'daki JWK'den KURAR. Bu
        // adim atlanirsa test, uretimde kullanilmayan bir CryptoKey ile calisir.
        const jwk = await crypto.subtle.exportKey('jwk', masterKey)
        const sessionKey = await crypto.subtle.importKey(
            'jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']
        )
        return await tonIdentityForAccount(sessionKey, vaults, acc, { testnet })
    }

    it('TON kasasinda arka plan TON semasini kullanir (altin vektor)', async () => {
        const { friendly } = await backgroundKeyPair([tonVault], account)
        expect(friendly).toBe(VIA_TON)
    })

    // ASIL DEGISMEZ: imzalayan anahtarin sozlesme adresi ile kullaniciya
    // GOSTERILEN adres ayni olmak ZORUNDA. Kusur tam olarak bu esitligin
    // bozulmasiydi ve yalnizca `friendly` kontrolu bunu goremezdi - iki yol
    // ayri ayri dogru gorunup birbirinden sapabilir.
    it('imzalayan keyPair in W5 adresi, gosterilen adresle BIREBIR ayni', async () => {
        const { keyPair, friendly } = await backgroundKeyPair([tonVault], account)
        expect(toFriendlyTon(tonWalletAddress(keyPair.publicKey))).toBe(friendly)
        expect(friendly).toBe(VIA_TON)
    })

    it('testnet secildiginde de esitlik korunur', async () => {
        const { keyPair, friendly } = await backgroundKeyPair([tonVault], account, { testnet: true })
        expect(friendly.startsWith('0Q')).toBe(true)
        expect(toFriendlyTon(tonWalletAddress(keyPair.publicKey, { testnet: true }), { testnet: true }))
            .toBe(friendly)
    })

    // KUSURUN TAM SEKLI, altin vektorle sabit. Eski cagri sekli (secretKind YOK)
    // artik SESSIZCE turetmiyor - sezgi silindi ve gurultulu duruyor.
    it('eski arka plan sekli (secretKind YOK) artik SESSIZCE turetmez', async () => {
        const secret = await tonSecretForAccount(masterKey, [tonVault], account)

        await expect(deriveTonAccount(secret, account, { testnet: false }))
            .rejects.toThrow('TON_SECRET_KIND_MISSING')
    })

    // TERSINE DONDU (2026-09-10): eski SLIP-10 'bip39' yolu KAPATILDI. Bir
    // zamanlar bu blok sezginin GERCEKTEN baska bir adres (VIA_BIP39) urettigini
    // kilitliyordu; artik o yol sessizce baska bir adres uretmek yerine
    // GURULTULU firlatiyor - bkz. tonAccount.js SECRET_KINDS yorumu.
    // 2026-09-11: 'bip39' ARTIK FIRLATMIYOR (gerekce tonAccount.js'in o dalinda).
    // Kilitlenen sey SESSIZLIGIN olmamasi: eski sema ACIKCA istenmeden secilmez
    // ve istendiginde BASKA -- yani eski -- bir adres verir. Ikisinin ayni cikmasi
    // semanin coktugunu gosterirdi.
    it("eski 'bip39' semasi SEZGIYLE secilmez; istendiginde BASKA adres verir", async () => {
        const secret = await tonSecretForAccount(masterKey, [tonVault], account)

        const varsayilan = await deriveTonAccount(secret, account, { secretKind: 'tonMnemonic' })
        const eskiSema = await deriveTonAccount(secret, account, { secretKind: 'bip39' })

        expect(eskiSema.friendly).toMatch(/^UQ/)
        expect(eskiSema.friendly).not.toBe(varsayilan.friendly)
    })

    // Spec §6 ek korumasi: kasa tipi biliniyorsa uyusmazlik SESSIZ KALMAZ.
    it('kasa tipi tonMnemonic iken baska sema TON_SECRET_KIND_MISMATCH atar', async () => {
        const secret = await tonSecretForAccount(masterKey, [tonVault], account)

        await expect(deriveTonAccount(secret, account, { vaultType: 'tonMnemonic' }))
            .rejects.toThrow('TON_SECRET_KIND_MISMATCH')

        await expect(deriveTonAccount(secret, account, { vaultType: 'tonMnemonic', secretKind: 'bip39' }))
            .rejects.toThrow('TON_SECRET_KIND_MISMATCH')
    })

    it('kasa tipi ile sema uyusuyorsa kapi GECIRIR', async () => {
        const secret = await tonSecretForAccount(masterKey, [tonVault], account)
        const { friendly } = await deriveTonAccount(secret, account, {
            vaultType: 'tonMnemonic', secretKind: 'tonMnemonic',
        })
        expect(friendly).toBe(VIA_TON)
    })
})

describe('utils/ton altinda atilan her TON_* kodu kullaniciya CEVRILIR', () => {
    // KAPSAM GENISLETILDI: eskiden yalnizca uc turetme dosyasi taraniyordu
    // (tonAccount / tonMnemonic / tonIdentity). Turetme bogazi sertlestikce dort
    // yeni kod dogdu (TON_ACCOUNT_REQUIRED, TON_ADDRESS_MISMATCH,
    // TON_VAULT_TYPE_INVALID, TON_SECRET_KIND_MISSING) ve hepsi imzalama yolundan
    // kullaniciya ULASABILIYOR. Tablodan eksik kalan bir kod
    // TON_SEND_ERROR_FALLBACK'e duser: kullanici "islem gonderilemedi" gorur ve
    // SEBEP kaybolur. Dosya listesi elle tutulmuyor - yeni bir modul eklendiginde
    // liste guncellenmezse tarama sessizce kor kalirdi.
    const TON_DIR = fileURLToPath(new URL('.', import.meta.url))
    const SOURCES = readdirSync(TON_DIR).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))

    const MAP = (() => {
        const start = TON_SEND_ERRORS_SRC.indexOf('export const TON_SEND_ERRORS = {')
        expect(start, 'TON_SEND_ERRORS bulunamadi').toBeGreaterThan(-1)
        return TON_SEND_ERRORS_SRC.slice(start, TON_SEND_ERRORS_SRC.indexOf('\n}', start))
    })()

    const allThrown = (() => {
        const codes = new Set()
        for (const file of SOURCES) {
            const src = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8')
            for (const m of src.matchAll(/throw new Error\('([A-Z0-9_]+)'\)/g)) codes.add(m[1])
        }
        return [...codes]
    })()

    // KENDI SUNUM YOLU OLAN KODLAR. Bunlar TON_SEND_ERROR_MESSAGES'a BILEREK
    // girmiyor; her biri kullaniciya BASKA bir yoldan ulasiyor:
    //   TON_SWAP_*   -> Swap.vue `code` alanini KENDISI okuyup kendi metnini
    //                   basiyor (teklif onizlemesi). GONDERIM aninda ise islem
    //                   kartina dusuyorlar ve karsiliklari utils/ton/tonSwapErrors.js
    //                   tablosunda -- tamligi tonSwapErrors.test.js kilitliyor.
    //                   Iki kume BILEREK ayri: buradaki tarama GONDERIM yolunu
    //                   kapsiyor, takas kodlarini karistirmak ikisini birbirine
    //                   baglardi.
    //   TON_PROOF_*  -> TonConnect ispat dogrulamasi; dapp'e protokol hatasi
    //                   olarak doner, gonderim ekranina HIC gelmez.
    //   TON_FEE_*    -> yapilandirma/derleme hatalari; gelistiriciye bakar,
    //                   kullaniciya degil.
    //   TON_AMOUNT_* -> tonFeeAmounts.js'in ic tip kapilari; disari cikmadan
    //                   cagiran tarafindan ele aliniyor.
    //   TON_VAULT_ALREADY_IMPORTED -> OLUSTURMA akisinin hatasi, gonderimin degil;
    //                   kendi i18n anahtari var.
    // Bu listeye bir kod EKLEMEK bilincli bir karardir. Liste olmadan yeni bir
    // kod sessizce genel yedege duserdi; liste ile duser ama SEBEBI yazili olur.
    const OWN_PRESENTATION = new Set([
        'TON_SWAP_GAS_UNKNOWN', 'TON_SWAP_INSUFFICIENT_BALANCE', 'TON_SWAP_INSUFFICIENT_TON',
        'TON_SWAP_PRICE_IMPACT_HIGH', 'TON_SWAP_QUOTE_FAILED', 'TON_SWAP_QUOTE_MISMATCH',
        'TON_SWAP_QUOTE_STALE',
        'TON_PROOF_BAD_ADDRESS_HASH', 'TON_PROOF_BAD_MESSAGE_HASH', 'TON_PROOF_BAD_TIMESTAMP',
        'TON_FEE_BASE_MISSING', 'TON_FEE_DOMAIN_MISMATCH',
        'TON_AMOUNT_INVALID_TYPE', 'TON_AMOUNT_NOT_INTEGER',
        'TON_VAULT_ALREADY_IMPORTED',
    ])

    const thrown = allThrown.filter((c) => !OWN_PRESENTATION.has(c))

    // Cozumleyici bos bir liste dondurseydi asagidaki it.each HIC kosmaz ve blok
    // yesil gorunurdu - yani olmayan bir korumayi dogrulamis olurduk.
    it('taramada turetme bogazinin YENI kodlari da bulunur', () => {
        expect(thrown).toContain('TON_SECRET_KIND_MISMATCH')
        expect(thrown).toContain('TON_SECRET_KIND_INVALID')
        expect(thrown).toContain('TON_MNEMONIC_INVALID')
        expect(thrown).toContain('TON_ACCOUNT_REQUIRED')
        expect(thrown).toContain('TON_ADDRESS_MISMATCH')
        expect(thrown).toContain('TON_VAULT_TYPE_INVALID')
        expect(thrown).toContain('TON_SECRET_KIND_MISSING')
        expect(thrown.length).toBeGreaterThan(25)
    })

    it.each(thrown)('%s icin anlasilir bir mesaj var', (code) => {
        expect(MAP).toContain(`'${code}':`)
    })

    // Muafiyet listesi CANLI kalmali. Silinen bir kod icin muafiyet birakmak,
    // yarin AYNI adla donen baska bir kodu sessizce tablodan muaf tutar - liste
    // o zaman koruma degil, kor nokta olur.
    it('muafiyet listesinde ARTIK ATILMAYAN kod kalmaz', () => {
        expect([...OWN_PRESENTATION].filter((c) => !allThrown.includes(c))).toEqual([])
    })
})
