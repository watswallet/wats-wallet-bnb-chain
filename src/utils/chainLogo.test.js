// Ag logosu/adi cozumlemesinin TEK kopyasi (utils/chainLogo.js).
//
// NEDEN VAR: ayni yardimci bugun ALTI yerde kopyalanmis (Home.vue:515,
// NetworkScopePill.vue:210, SelectAssets.vue:158, SearchTokens.vue:175,
// swap/swapFrom.vue:202, bridge/bridgeFrom.vue:171) ve DORDU karsilastirmayi
// `Number()` ile yapiyor -- Solana'nin kimligi METIN ('solana-mainnet'),
// Number('solana-mainnet') NaN, NaN === NaN yanlis: Solana rozeti sessizce
// varsayilana dusuyor. Kopyalarin hepsi buraya cevrilecegi icin kural burada
// TEK yerde kilitlenir.
//
// KIRILGAN NOKTA: SelectAssets.ssr.test.js:288 `chainLogo(999999) === '/default-chain.png'`
// bekliyor. O dize VARSAYILAN YEDEK olarak KALMAK ZORUNDA; kartta yedek ACIKCA
// null verilip TokenLogo monogramina dusulur (dosya GERCEKTEN yok, bugun kirik
// resim ciziliyor).
import { describe, it, expect } from 'vitest'
import { chainLogo, chainName } from './chainLogo'
import { ALL_CHAINS } from '../data/chains'

const kayit = (id) => ALL_CHAINS.find((c) => String(c.chainId) === String(id))

describe('chainLogo -- logo cozumlemesi', () => {
    it('EVM kimligini SAYI olarak cozer', () => {
        expect(chainLogo(1)).toBe(kayit(1).logoURI)
        expect(chainLogo(56)).toBe(kayit(56).logoURI)
    })

    // chainId hem 1 hem '1' olarak dolasiyor (bkz. utils/vm.js).
    it('EVM kimligini METIN yazimiyla da cozer', () => {
        expect(chainLogo('137')).toBe(kayit(137).logoURI)
    })

    // Kopyalarin dordunu bozan tam olarak bu: Number() ile NaN olur.
    it('Solana nin METIN kimligini cozer, varsayilana DUSMEZ', () => {
        const solana = kayit('solana-mainnet')
        expect(solana.logoURI).toBeTruthy()
        expect(chainLogo('solana-mainnet')).toBe(solana.logoURI)
        expect(chainLogo('solana-mainnet')).not.toBe('/default-chain.png')
    })

    // TON'un kimligi NEGATIF sayi; isaret kaybolursa yanlis kayitla eslesir.
    it('TON un negatif kimligini cozer', () => {
        expect(chainLogo(-239)).toBe(kayit(-239).logoURI)
        expect(chainLogo('-239')).toBe(kayit(-239).logoURI)
    })

    it('bilinmeyen zincir VARSAYILAN yedege duser (SelectAssets.ssr.test.js:288 buna bagli)', () => {
        expect(chainLogo(999999)).toBe('/default-chain.png')
    })

    // Kart, kirik resim yerine TokenLogo monogramini istiyor -- bunun icin
    // yedegin ACIKCA null verilebilmesi gerekir.
    it('cagiran kendi yedegini verebilir (kart null verir)', () => {
        expect(chainLogo(999999, null)).toBe(null)
        expect(chainLogo(999999, '')).toBe('')
    })

    // Number(null) 0, Number('') 0: kontrolsuz birakilirsa cozulememis bir
    // zincir chainId 0 olan bir kayitla eslesirdi (bkz. vm.js numericChainId).
    it('bos/eksik kimlik yedege duser, 0 ile ESLESMEZ', () => {
        expect(chainLogo(null)).toBe('/default-chain.png')
        expect(chainLogo(undefined)).toBe('/default-chain.png')
        expect(chainLogo('')).toBe('/default-chain.png')
    })
})

describe('chainName -- ag adi cozumlemesi', () => {
    it('EVM ve Solana adlarini cozer', () => {
        expect(chainName(56)).toBe(kayit(56).name)
        expect(chainName('solana-mainnet')).toBe(kayit('solana-mainnet').name)
    })

    it('TON un negatif kimligini cozer', () => {
        expect(chainName(-239)).toBe(kayit(-239).name)
    })

    // ALL_CHAINS (LISTED_CHAINS DEGIL): testnet kayitlari prod derlemesinde
    // listeden DUSER ama kimlik cozumlemesi ASLA filtrelenmemeli, aksi halde
    // gecmisteki bir testnet islemi adsiz kalir.
    it('testnet kaydini da cozer -- ALL_CHAINS uzerinden bakar', () => {
        expect(chainName(-3)).toBe(kayit(-3).name)
    })

    // Cagiran kendi metnine (kartta t('header.network')) dussun diye BOS DIZE:
    // uydurulmus bir ad, anlasilmayan bir addan daha kotudur.
    it('bilinmeyen zincir icin BOS DIZE doner', () => {
        expect(chainName(999999)).toBe('')
        expect(chainName(null)).toBe('')
    })
})
