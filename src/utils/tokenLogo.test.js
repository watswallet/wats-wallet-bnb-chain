import { describe, it, expect } from 'vitest'
import { tokenLogo, VARSAYILAN_TOKEN_LOGOSU } from './tokenLogo'

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
