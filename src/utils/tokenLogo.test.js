import { describe, it, expect, afterEach } from 'vitest'
import { tokenLogo, VARSAYILAN_TOKEN_LOGOSU, setLocalLogosOnly, localLogosOnly } from './tokenLogo'

// OLCULDU 2026-09-14, canli API (POST /getChainTokens):
//   chainId  56 / 1  -> image: {large, small, thumb}        (nesne)
//   chainId -239 TON -> image: {large, small, thumb}        (nesne, YERLI coin)
//   chainId -239 USDT/NOT/DOGS/STON/HMSTR -> image: "https://..."  (DIZE)
// Kod her yerde `token.image?.large` okuyordu; bir dizenin `.large`i undefined
// oldugu icin TON jetton'lari gri yer tutucuya dusuyordu -- oysa URL'ler
// gecerliydi (besi de 200 PNG).
describe('tokenLogo', () => {
    it('nesne bicimi: large tercih edilir', () => {
        expect(tokenLogo({ image: { large: 'L', small: 'S', thumb: 'T' } })).toBe('L')
    })

    // TAM OLARAK DUZELTILEN HATA.
    it('DIZE bicimi: URL dogrudan kullanilir (TON jetton"lari)', () => {
        expect(tokenLogo({ image: 'https://cdn.dogs.dev/dogs.png' })).toBe('https://cdn.dogs.dev/dogs.png')
    })

    it('logoURI da kabul edilir (koprude/zincir listesinde kullanilan alan)', () => {
        expect(tokenLogo({ logoURI: 'https://x/y.png' })).toBe('https://x/y.png')
    })

    // Oncelik SIRASI onemli: bir kayitta hem `image` hem `logoURI` olabilir ve
    // `image` API'nin TAZE verisi, `logoURI` ise coguzaman diskteki ESKI kopya.
    it('image, logoURI"den ONCE gelir', () => {
        expect(tokenLogo({ image: { large: 'TAZE' }, logoURI: 'ESKI' })).toBe('TAZE')
    })

    it('large yoksa small, o da yoksa thumb', () => {
        expect(tokenLogo({ image: { small: 'S', thumb: 'T' } })).toBe('S')
        expect(tokenLogo({ image: { thumb: 'T' } })).toBe('T')
    })

    // FIRLATMAZ. Home.vue `token.image.large` yaziyordu ve `image` hic yoksa
    // TypeError atiyordu (Swap.vue:85'teki yorum ayni tuzagi anlatiyor).
    it('eksik/bos girdide yer tutucu doner, ASLA firlatmaz', () => {
        for (const t of [null, undefined, {}, { image: null }, { image: {} }, { image: '' }, { image: 123 }, { logoURI: '' }]) {
            expect(tokenLogo(t)).toBe(VARSAYILAN_TOKEN_LOGOSU)
        }
    })

    // Bosluk yalnizca dize bicimindeki URL'lerde gorulduyse de, kirpilmamis bir
    // deger `src`e girince tarayici onu goreli yol sanip 404 uretir.
    it('bosluklu URL kirpilir', () => {
        expect(tokenLogo({ image: '  https://x/y.png  ' })).toBe('https://x/y.png')
    })

    it('cagiran kendi yer tutucusunu verebilir', () => {
        expect(tokenLogo(null, '/ozel.png')).toBe('/ozel.png')
    })
})

// GIZLI MOD (gizli-mod cok-ag spec 4.7 "Logolar yerel (D6)"): uzak logo gorseli, tarayicinin ucuncu taraf CDN'ine
// IP ve "hangi logolar istendi" bilgisiyle istek atmasi demektir. `installPrivacySync` mod degisince anahtari
// cevirir; cagiran yerler degismez.
describe('tokenLogo -- ozel modda yalniz yerel yollar', () => {
    afterEach(() => setLocalLogosOnly(false))

    it('anahtar varsayilan KAPALI; yalniz tam true acar', () => {
        expect(localLogosOnly()).toBe(false)
        setLocalLogosOnly('true')
        expect(localLogosOnly()).toBe(false)
        setLocalLogosOnly(1)
        expect(localLogosOnly()).toBe(false)
        setLocalLogosOnly(true)
        expect(localLogosOnly()).toBe(true)
    })

    it('KONTROL: anahtar kapaliyken uzak URL AYNEN doner (normal mod degismez)', () => {
        expect(tokenLogo({ image: { large: 'https://cdn.example/a.png' } })).toBe('https://cdn.example/a.png')
        expect(tokenLogo({ logoURI: 'https://cdn.example/b.png' })).toBe('https://cdn.example/b.png')
    })

    it('anahtar aciksa uzak URL yer tutucuya doner (nesne, dize, logoURI ve logo bicimleri)', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ image: { large: 'https://cdn.example/a.png', small: 'https://cdn.example/s.png' } })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ image: 'https://cdn.example/a.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ logoURI: 'https://cdn.example/b.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ logo: 'http://cdn.example/c.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
    })

    it('protokol-goreli (//host) ve veri/blob adresleri yerel SAYILMAZ', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ image: '//cdn.example/a.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ image: 'data:image/png;base64,AAAA' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ image: 'blob:chrome-extension://x/y' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
    })

    it('ayni kaynaktan yollar (/ ile baslayan) kabul edilir', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ image: { large: '/usdc.png', small: '/usdc.png', thumb: '/usdc.png' } })).toBe('/usdc.png')
        expect(tokenLogo({ image: '/ats.png' })).toBe('/ats.png')
        expect(tokenLogo({ logoURI: '/chains/56.png' })).toBe('/chains/56.png')
    })

    it('uzak large atlanir, yerel small/thumb/logoURI SIRAYLA aranir', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ image: { large: 'https://cdn.example/a.png', small: '/s.png', thumb: '/t.png' } })).toBe('/s.png')
        expect(tokenLogo({ image: { large: 'https://cdn.example/a.png' }, logoURI: '/yerel.png' })).toBe('/yerel.png')
    })

    it('cagiranin yedegi korunur: null yedek monogram icin null doner', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ image: 'https://cdn.example/a.png' }, null)).toBeNull()
        expect(tokenLogo({ image: 'https://cdn.example/a.png' }, '/ozel.png')).toBe('/ozel.png')
    })
})
// POPULER TOKENLERE YEREL LOGO (sahip karari 2026-10-23): paketlenmis (chainId, adres) ciftleri ozel modda yerel dosyaya doner.
describe('tokenLogo -- ozel modda paketlenmis yerel token logolari', () => {
    afterEach(() => setLocalLogosOnly(false))
    const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca'
    const LINK_CS = '0x514910771aF9Ca656af840dff83E8264EcF986CA'
    const uzak = { chainId: 1, address: LINK_CS, image: { large: 'https://cdn.example/link.png' } }

    it('ozel mod + paketli cift: uzak logo yerine yerel dosya doner (adres buyuk/kucuk harf fark etmez)', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo(uzak)).toBe('/tokens/1/' + LINK + '.png')
        expect(tokenLogo({ chainId: 1, address: LINK })).toBe('/tokens/1/' + LINK + '.png')
        expect(tokenLogo({ chainId: '1', address: LINK_CS, logoURI: 'https://cdn.example/x.png' })).toBe('/tokens/1/' + LINK + '.png')
    })

    it('ozel mod + paketli OLMAYAN cift ya da chainId/adres eksik: yer tutucu', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ chainId: 56, address: LINK_CS, image: 'https://cdn.example/a.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ chainId: 1, address: '0x' + '12'.repeat(20) })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ address: LINK_CS, image: 'https://cdn.example/a.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
        expect(tokenLogo({ chainId: 1, image: 'https://cdn.example/a.png' })).toBe(VARSAYILAN_TOKEN_LOGOSU)
    })

    it('ozel mod: zaten yerel olan gorsel paketli yola ONCE gelir', () => {
        setLocalLogosOnly(true)
        expect(tokenLogo({ chainId: 1, address: LINK_CS, image: '/ats.png' })).toBe('/ats.png')
    })

    it('KONTROL: normal modda paketli cift olsa da uzak logo AYNEN doner, logosuz token yer tutucu kalir', () => {
        expect(tokenLogo(uzak)).toBe('https://cdn.example/link.png')
        expect(tokenLogo({ chainId: 1, address: LINK_CS })).toBe(VARSAYILAN_TOKEN_LOGOSU)
    })
})
