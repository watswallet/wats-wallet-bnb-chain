import { describe, it, expect } from 'vitest'
import { mnemonicValidate } from '@ton/crypto'
import { tonMnemonicFromSeed, TON_FROM_SEED_DOMAIN } from './tonFromSeed'

// Ana BIP39 ifadesinden hesap basina GECERLI bir TON-native ifade turetiyoruz.
//
// Neden SLIP-10 m/44'/607'/{i}' DEGIL: Tonkeeper'in BIP-39 yolu sabittir
// (TON_DERIVATION_PATH = "m/44'/607'/0'"), hesap indeksi kavrami yoktur. O yolla
// uretilen index>0 adresleri baska hicbir cuzdanda IFADEYLE acilamazdi. Burada
// uretilen sey TON'un KENDI semasinda gecerli bir ifadedir -- Tonkeeper'in
// BIRINCIL dali -- yani her hesap tam erisimle acilir.

const MASTER = 'abandon '.repeat(11) + 'about'

// ALTIN VEKTOR. Bu deger DEGISIRSE turetme kurali degismis demektir ve ayni ana
// ifadeye sahip kullanicinin eski TON adresi uygulamada ULASILAMAZ olur.
const GOLDEN_INDEX_0 =
    'trend club box change armed century health mirror lesson diary oil design ' +
    'actor pretty stuff able bright surge minor forest liberty gasp useful coast'

describe('tonMnemonicFromSeed — uretilen sey GECERLI bir TON-native ifadedir', () => {
    it('altin vektor: ayni ana ifade + index 0 HER ZAMAN ayni ifadeyi verir', async () => {
        expect(await tonMnemonicFromSeed(MASTER, 0)).toBe(GOLDEN_INDEX_0)
    })

    it('24 kelime uretir', async () => {
        const phrase = await tonMnemonicFromSeed(MASTER, 0)
        expect(phrase.split(' ')).toHaveLength(24)
    })

    // Testin varlik sebebi: Tonkeeper'in kabul edebilmesi. Ifade yalnizca
    // "uretilmis" degil, TON semasinda GECERLI olmali.
    it('@ton/crypto ifadeyi GECERLI sayar', async () => {
        const phrase = await tonMnemonicFromSeed(MASTER, 0)
        expect(await mnemonicValidate(phrase.split(' '))).toBe(true)
    })

    it('farkli index FARKLI ifade verir', async () => {
        const a = await tonMnemonicFromSeed(MASTER, 0)
        const b = await tonMnemonicFromSeed(MASTER, 1)
        expect(a).not.toBe(b)
    })

    it('farkli ana ifade FARKLI sonuc verir', async () => {
        const other = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
        const a = await tonMnemonicFromSeed(MASTER, 0)
        const b = await tonMnemonicFromSeed(other, 0)
        expect(a).not.toBe(b)
    })

    // Kullanicinin ifadeyi bir bosluk fazla yapistirmasi BASKA bir cuzdan
    // uretmemeli.
    it('fazladan bosluk ayni sonucu verir', async () => {
        const a = await tonMnemonicFromSeed(MASTER, 0)
        const b = await tonMnemonicFromSeed('  ' + MASTER + '  ', 0)
        expect(a).toBe(b)
    })

    it('alan adi dondurulmustur', () => {
        expect(TON_FROM_SEED_DOMAIN).toBe('wats/ton-from-seed/v1')
    })
})

describe('tonMnemonicFromSeed — gecersiz index SESSIZCE duzeltilmez', () => {
    // Gerekce: index turetme yoluna girer. Duzeltilseydi iki farkli hesap ayni
    // TON adresini paylasir ve hesap izolasyonu sessizce kirilirdi.
    it.each([-1, 1.5, NaN, '0', null, undefined, 0x80000000])(
        'index %p icin TON_INDEX_INVALID firlatir',
        async (bad) => {
            await expect(tonMnemonicFromSeed(MASTER, bad)).rejects.toThrow('TON_INDEX_INVALID')
        }
    )
})
