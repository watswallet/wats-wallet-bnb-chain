import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { tonAddressForNewAccount } from './newAccountTonAddress'

// Neden olusturma aninda: ana anahtar zaten acik ve `vaults` zaten yaziliyor.
// Turetme sonraya birakilsaydi ensureTonAddress'in bas yorumunda anlatilan
// KAYIP-GUNCELLEME yarisina girilirdi (korumasiz read-modify-write).

const MASTER = 'abandon '.repeat(11) + 'about'
const GOLDEN_INDEX_0 = 'UQDqyT778Wrtja0ouo994yPNugR3jM7NAofAgs6WnJg6SveD'
const GOLDEN_INDEX_1 = 'UQBdUvb886q08Do1hiOOiysAh8rb1k0bqh3TAoLmJ6UR-RqV'

describe('tonAddressForNewAccount', () => {
    it('index 0 icin altin vektoru uretir', async () => {
        expect(await tonAddressForNewAccount(MASTER, 0)).toBe(GOLDEN_INDEX_0)
    })

    it('index 1 FARKLI adres uretir', async () => {
        expect(await tonAddressForNewAccount(MASTER, 1)).toBe(GOLDEN_INDEX_1)
    })

    it('gecersiz index FIRLATIR', async () => {
        await expect(tonAddressForNewAccount(MASTER, -1)).rejects.toThrow('TON_INDEX_INVALID')
    })
})

// HAYATTA KALAN MUTANT (final inceleme bulgusu, 2026-09-11): Gorev 6'nin asil
// ciktisi -- yeni hesabin TON adresinin OLUSTURMA ANINDA yazilmasi -- iki cagri
// yerinde de SIFIR testle korunuyordu. Iki satir da silinse 4737 testin hicbiri
// kirilmiyordu; ozellik sessizce Gorev 6 oncesine doner ve yeni hesaplar
// `tonAddress`siz dogup ensureTonAddress'in kayip-guncelleme yarisina duserdi.
//
// Ayni blok kilit kancasini da kapsiyor: R5'in guvenlik karari (kilitlenince
// turetilmis ifadeler bellekten silinsin) de korumasizdi.
describe('olusturma/kilit kancalari YERINDE (kaynak metni iddiasi)', () => {
    const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

    it('CreateAccount.vue TON alanlarini olusturma aninda yazar', () => {
        const src = read('../../components/settings/CreateAccount.vue')
        expect(src).toMatch(/await\s+tonFieldsForNewAccount\(/)
        expect(src).toMatch(/\.\.\.tonAlanlari/)
    })

    it('CreatePassword2.vue ilk hesapta AYNISINI yapar', () => {
        const src = read('../../components/onboarding/CreatePassword2.vue')
        expect(src).toMatch(/await\s+tonFieldsForNewAccount\(/)
        expect(src).toMatch(/\.\.\.tonAlanlari/)
    })

    // Damga adresle BIRLIKTE yazilmali: damgasiz dogan bir hesap her acilista
    // bosuna yeniden turetilir ve tonAddressLegacy'sine KENDI dogru adresini yazar.
    it('damga adresle BIRLIKTE uretilir', () => {
        const src = read('./newAccountTonAddress.js')
        expect(src).toMatch(/tonScheme:\s*TON_SCHEME/)
    })

    it('background.js kilitlenmede TON ifade onbellegini temizler (R5)', () => {
        const src = read('../../background.js')
        const lock = src.slice(src.indexOf('lockWallet'))
        expect(lock).toMatch(/clearTonMnemonicCache\(\)/)
    })

    // Onbellek her JS baglaminda AYRI bir Map'tir: service worker'i temizlemek
    // acik kalan popup'inkini temizlemez.
    it('popup da kilitlenmede kendi onbellegini temizler', () => {
        const src = read('../../popup/App.vue')
        expect(src).toMatch(/SESSION_EXPIRED[\s\S]{0,900}?clearTonMnemonicCache\(\)/)
    })
})
