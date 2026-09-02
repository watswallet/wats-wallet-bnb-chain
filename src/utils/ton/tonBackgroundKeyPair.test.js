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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createTonVault, deriveMasterKey, randBytes } from '../crypto-utils'
import { tonSecretForAccount, tonIdentityForAccount } from './tonIdentity'
import { deriveTonAccount, tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'

const BACKGROUND = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')

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
const VIA_BIP39 = 'UQBviJxvVm84QbDBDJ_6quvu9nO2ZKJeOmSBRuDR-58k-e7m'

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

    // KUSURUN TAM SEKLI, altin vektorle sabit. Bu test olmasaydi yukaridaki
    // yapisal kilitler "bir seyi koruyormus gibi" gorunur ama neyi korudugu
    // gorunmezdi: eski cagri sekli GERCEKTEN baska bir adres uretiyor.
    it('eski arka plan sekli (secretKind YOK) BASKA bir adres uretirdi', async () => {
        const secret = await tonSecretForAccount(masterKey, [tonVault], account)
        const { friendly } = await deriveTonAccount(secret, account, { testnet: false })

        expect(friendly).toBe(VIA_BIP39)
        expect(friendly).not.toBe(VIA_TON)
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

describe('turetme yolundaki her hata kodu kullaniciya CEVRILIR', () => {
    // TON_SECRET_KIND_INVALID / TON_SECRET_KIND_MISMATCH / TON_MNEMONIC_INVALID
    // arka planda ULASILABILIR HALE GELDI: imzalama yolu artik kasa tipini
    // turetmeye geciriyor. TON_SEND_ERROR_MESSAGES'ta karsiligi olmayan bir kod
    // TON_SEND_ERROR_FALLBACK'e duser - kullanici "islem gonderilemedi" gorur ve
    // SEBEP kaybolur; TON_SECRET_KIND_MISMATCH gibi bir kodda kaybolan sey
    // "kasaniz ile anahtariniz uyusmuyor" uyarisidir.
    //
    // Kapsam BILEREK turetme yoluyla sinirli (bu dalganin actigi yuzey). Takas
    // yolundaki TON_SWAP_* kodlari ayri bir tasarima sahip - Swap.vue `code`
    // alanini kendisi okuyor - ve bu dalganin disinda.
    const DERIVATION_FILES = ['./tonAccount.js', './tonMnemonic.js', './tonIdentity.js']

    const MAP = (() => {
        const start = BACKGROUND.indexOf('const TON_SEND_ERROR_MESSAGES = {')
        expect(start, 'TON_SEND_ERROR_MESSAGES bulunamadi').toBeGreaterThan(-1)
        return BACKGROUND.slice(start, BACKGROUND.indexOf('\n}', start))
    })()

    const thrown = (() => {
        const codes = new Set()
        for (const rel of DERIVATION_FILES) {
            const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
            for (const m of src.matchAll(/throw new Error\('([A-Z0-9_]+)'\)/g)) codes.add(m[1])
        }
        return [...codes]
    })()

    // Cozumleyici bos bir liste dondurseydi asagidaki it.each HIC kosmaz ve blok
    // yesil gorunurdu - yani olmayan bir korumayi dogrulamis olurduk.
    it('turetme yolunda gercekten kod bulunur', () => {
        expect(thrown).toContain('TON_SECRET_KIND_MISMATCH')
        expect(thrown).toContain('TON_SECRET_KIND_INVALID')
        expect(thrown).toContain('TON_MNEMONIC_INVALID')
        expect(thrown.length).toBeGreaterThan(4)
    })

    it.each(thrown)('%s icin anlasilir bir mesaj var', (code) => {
        expect(MAP).toContain(`'${code}':`)
    })
})
