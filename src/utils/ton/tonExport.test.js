import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'
import { createVault, createTonVault, deriveMasterKey, randBytes } from '../crypto-utils'
import { exportTonKey } from './tonExport'
import { tonIdentityForAccount } from './tonIdentity'
import { deriveTonAccount } from './tonAccount'

// Fixture BIP39 HD kasadan TON kasasina tasindi: turetme bogazi artik
// type:'ton' olmayan hesabi kabul etmiyor (TON_ACCOUNT_REQUIRED) ve
// `createTonVault` ancak gecerli bir TON ifadesiyle kurulur.
const TON_MNEMONIC = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
const TON_ADDR = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'

// `createVault` gecirilen hesap nesnesine `fingerprint` YAZAR ve onu `accounts`
// dizisine koyar -- yani hesabi ayrica kurmaya gerek yok. vault.type 'hd' olur;
// secretKindForVault'un 'derivedTonMnemonic' demesi icin gereken tek sey budur.
async function hdKasaKur(masterMnemonic, index) {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const account = { key: `hd-${index}`, type: 'hd', index }
    const vault = await createVault(masterKey, masterMnemonic, account)
    return { masterKey, vaults: [vault], account: vault.accounts[0] }
}

// Ice aktarilmis TON hesabi: kasa TON ifadesini tasir, hesap type:'ton'.
async function tonKasaKur() {
    const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
    const vault = await createTonVault(masterKey, TON_MNEMONIC, {
        key: 'ton-0', address: TON_ADDR, type: 'ton', index: 0,
    })
    return { masterKey, vaults: [vault], account: vault.accounts[0] }
}

describe('exportTonKey', () => {
    let masterKey
    let vault

    beforeAll(async () => {
        masterKey = await deriveMasterKey('parola-123456', randBytes(32))
        vault = await createTonVault(masterKey, TON_MNEMONIC, {
            key: 'ton-0', address: TON_ADDR, type: 'ton', index: 0,
        })
    })

    it('disa aktarilan anahtar hesabin ADRESINI uretir', async () => {
        // Kurtarma yolunun tek anlami bu: anahtar, gosterilen adresi acmali.
        const exported = await exportTonKey(masterKey, [vault], vault.accounts[0])
        const identity = await tonIdentityForAccount(masterKey, [vault], vault.accounts[0])
        expect(exported.friendly).toBe(identity.friendly)
    })

    it('anahtar 64 baytlik ed25519 gizli anahtaridir', async () => {
        const exported = await exportTonKey(masterKey, [vault], vault.accounts[0])
        expect(exported.secretKeyHex).toMatch(/^[0-9a-f]{128}$/)
    })

    it('kasasi bulunamayan hesap hata verir', async () => {
        await expect(exportTonKey(masterKey, [vault], { key: 'yok', type: 'ton', address: 'UQyok' }))
            .rejects.toThrow('ACCOUNT_VAULT_NOT_FOUND')
    })

    // Ozel anahtar hesabinda TON anahtari YOKTUR (tek secp256k1 anahtarindan
    // ed25519 TURETILEMEZ): disa aktarma da kasaya HIC dokunmadan reddedilir.
    // R3'un aynasi - orada EVM anahtari TON hesabindan istenmiyordu, burada TON
    // anahtari boyle bir hesaptan.
    //
    // 2026-09-10: hesap tipi 'hd'den 'privateKey'ye degisti - HER 'hd' hesabin
    // artik TON'u var (Y1+Y3 karari), yani 'hd' burada kapidan GECER ve
    // ACCOUNT_VAULT_NOT_FOUND'a duser (bu vault dizisinde o hesabin kasasi yok);
    // testin olcmek istedigi sey (TON olmayan hesap kapida durur) icin kapinin
    // GERCEKTEN reddettigi bir tip gerekiyor.
    it('TON olmayan hesapta disa aktarma REDDEDILIR', async () => {
        await expect(exportTonKey(masterKey, [vault], { key: 'evm-1', type: 'privateKey', address: '0x' + 'a'.repeat(40) }))
            .rejects.toThrow('TON_ACCOUNT_REQUIRED')
    })
})

describe('exportTonKey -- turetilmis TON ifadesi de doner (2026-09-10)', () => {
    const MASTER = 'abandon '.repeat(11) + 'about'
    const GOLDEN_PHRASE =
        'trend club box change armed century health mirror lesson diary oil design ' +
        'actor pretty stuff able bright surge minor forest liberty gasp useful coast'

    it('hd kasasinda turetilmis ifade DOLU gelir', async () => {
        const { masterKey, vaults, account } = await hdKasaKur(MASTER, 0)
        const sonuc = await exportTonKey(masterKey, vaults, account)

        expect(sonuc.mnemonic).toBe(GOLDEN_PHRASE)
        expect(sonuc.mnemonic.split(' ')).toHaveLength(24)
    })

    it('ham anahtar da donmeye devam eder', async () => {
        const { masterKey, vaults, account } = await hdKasaKur(MASTER, 0)
        const sonuc = await exportTonKey(masterKey, vaults, account)

        expect(sonuc.secretKeyHex).toMatch(/^[0-9a-f]{128}$/)
        expect(sonuc.friendly).toMatch(/^UQ/)
    })

    // Turetilmis ifade GERCEKTEN o hesabin adresini acmali -- yoksa kullaniciya
    // Tonkeeper'a girmesi soylenen kelimeler BASKA bir cuzdan acar.
    it('donen ifade gosterilen ADRESI acar', async () => {
        const { masterKey, vaults, account } = await hdKasaKur(MASTER, 0)
        const sonuc = await exportTonKey(masterKey, vaults, account)

        // BAGIMSIZ YOL: donen ifade, ICE AKTARILMIS bir TON ifadesiymis gibi
        // yeniden turetiliyor -- Tonkeeper'in yaptigi tam olarak bu. Ayni
        // fonksiyonu ayni parametrelerle ikinci kez cagirmak hicbir sey olcmezdi.
        const { friendly } = await deriveTonAccount(sonuc.mnemonic, { type: 'ton', index: 0 }, {
            testnet: false,
            secretKind: 'tonMnemonic',
            vaultType: 'tonMnemonic',
        })
        expect(friendly).toBe(sonuc.friendly)
    })

    it('index 1 BASKA bir ifade doner', async () => {
        const a0 = await hdKasaKur(MASTER, 0)
        const a1 = await hdKasaKur(MASTER, 1)
        const s0 = await exportTonKey(a0.masterKey, a0.vaults, a0.account)
        const s1 = await exportTonKey(a1.masterKey, a1.vaults, a1.account)

        expect(s1.mnemonic).not.toBe(s0.mnemonic)
        expect(s1.friendly).not.toBe(s0.friendly)
    })

    // Ice aktarilmis hesapta TON ifadesi kullanicinin KENDI Tonkeeper ifadesidir
    // ve ShowPhrases ekraninda gosteriliyor. Ikinci bir yerde gostermek "hangisi
    // asil" sorusunu dogurur.
    it('tonMnemonic kasasinda ifade NULL gelir', async () => {
        const { masterKey, vaults, account } = await tonKasaKur()
        const sonuc = await exportTonKey(masterKey, vaults, account)

        expect(sonuc.mnemonic).toBeNull()
        expect(sonuc.secretKeyHex).toMatch(/^[0-9a-f]{128}$/)
    })
})

// Kelime IZGARASI -- SESSIZ KIRPMA KAPISI (final inceleme bulgusu, 2026-09-11).
// Kelime listesindeki en uzun kelime 8 harf ve 360px'lik popup'ta uc sutunlu
// izgarada hucreye sigmasi SINIRDA. `truncate` ile kirpilan bir kelime ekranda
// 'mushroo...' gorunur; kullanici onu Tonkeeper'a yazar ve cuzdanini ACAMAZ.
// Tasma gorulur, kirpma GORULMEZ -- tehlikeli olan ikincisi.
describe('TonKey.vue ifade izgarasi kelimeyi KIRPMAZ', () => {
    const TONKEY = readFileSync(
        fileURLToPath(new URL('../../components/settings/accounts/TonKey.vue', import.meta.url)),
        'utf8'
    )
    const izgara = TONKEY.slice(
        TONKEY.indexOf("v-for=\"(word, i) in tonKey.mnemonic"),
        TONKEY.indexOf('</div>', TONKEY.indexOf("v-for=\"(word, i) in tonKey.mnemonic"))
    )

    it('kelime span inda truncate YOK', () => {
        expect(izgara).not.toMatch(/truncate/)
    })

    it('indeks SABIT genislikte -- iki haneli indeks kelimeyi daraltmaz', () => {
        expect(izgara).toMatch(/w-4[^"]*text-right|text-right[^"]*w-4/)
    })
})
