import { describe, it, expect } from 'vitest'
import { nativeSymbolOf, nativeUnits, evmNativeParts } from './nativeAmount'
import supported_chains from '../data/supported_chains.json'

const ETH = supported_chains.find((c) => c.chainId === 1)
const BSC = supported_chains.find((c) => c.chainId === 56)

describe('nativeSymbolOf — satirdaki birim etiketi zincirden gelir', () => {
    it('Ethereum agi ETH doner', () => {
        expect(nativeSymbolOf(ETH)).toBe('ETH')
    })

    // KOK NEDEN: getListAmount'un native dali SABIT 'ETH' yaziyordu. BNB Chain'de
    // 0,5 BNB gonderen kullanici listede "0,5 ETH" goruyordu -- duz bir yalan.
    it('BNB Chain agi BNB doner, ETH DEGIL', () => {
        expect(nativeSymbolOf(BSC)).toBe('BNB')
        expect(nativeSymbolOf(BSC)).not.toBe('ETH')
    })

    // Bilinmeyen zincirde 'ETH'e DUSMEK ayni yalani geri getirirdi. Bos dize
    // donmek durustur: kullanici sayiyi birimsiz gorur, YANLIS birimle degil.
    it('bilinmeyen zincirde bos dize doner (ETH e DUSMEZ)', () => {
        expect(nativeSymbolOf(null)).toBe('')
        expect(nativeSymbolOf(undefined)).toBe('')
        expect(nativeSymbolOf({})).toBe('')
        expect(nativeSymbolOf({ nativeCurrency: {} })).toBe('')
    })
})

describe('nativeUnits — ham deger (wei) okunabilir birime cevrilir', () => {
    it('18 ondalikli zincirde 1e18 wei = 1', () => {
        expect(nativeUnits('1000000000000000000', ETH)).toBe(1)
    })

    it('metin ve sayi girdisi ayni sonucu verir', () => {
        expect(nativeUnits(1000000000000000000, ETH)).toBe(1)
    })

    it('kesirli tutar dogru cozulur', () => {
        expect(nativeUnits('500000000000000000', BSC)).toBe(0.5)
    })

    // Ondalik zincirden okunur: sabit 1e18 varsaymak, ondaligi farkli bir
    // zincirde tutari 10^n kat yanlis gosterirdi.
    it('ondalik zincir kaydindan okunur, sabit 18 varsayilmaz', () => {
        const altiOndalik = { nativeCurrency: { symbol: 'XYZ', decimals: 6 } }
        expect(nativeUnits('1000000', altiOndalik)).toBe(1)
    })

    it('zincir bilinmiyorsa 18 ondaliga duser (EVM varsayilani)', () => {
        expect(nativeUnits('1000000000000000000', null)).toBe(1)
    })

    it('gecersiz degerde null doner (0 gostermez)', () => {
        expect(nativeUnits(null, ETH)).toBeNull()
        expect(nativeUnits(undefined, ETH)).toBeNull()
        expect(nativeUnits('', ETH)).toBeNull()
        expect(nativeUnits('abc', ETH)).toBeNull()
    })

    it('sifir degeri 0 doner (null DEGIL — bu gecerli bir tutar)', () => {
        expect(nativeUnits('0', ETH)).toBe(0)
    })
})

describe('evmNativeParts — liste/modal satirindaki native tutar', () => {
    const TON = supported_chains.find((c) => Number(c.chainId) === -239)
    const SOLANA = supported_chains.find((c) => c.chainId === 'solana-mainnet')
    const YARIM_ETH = '500000000000000000'

    it('EVM aginda tutar, isaret ve sembol birlikte cozulur', () => {
        expect(evmNativeParts({ category: 'send', value: YARIM_ETH }, BSC))
            .toEqual({ amount: 0.5, sign: '-', symbol: 'BNB' })
    })

    it('alim satirinda isaret arti olur', () => {
        expect(evmNativeParts({ category: 'receive', value: YARIM_ETH }, ETH).sign).toBe('+')
    })

    it('yerel bekleyen iskeletin "native send" kategorisi de gonderim sayilir', () => {
        expect(evmNativeParts({ category: 'native send', value: YARIM_ETH }, ETH).sign).toBe('-')
    })

    // Yon BILINMIYORSA isaret KONMAZ: uydurma bir eksi, islemin yonu hakkinda
    // yalan soyler (sozlesme etkilesimleri kategorisizdir).
    it('kategori taninmiyorsa isaret bos kalir', () => {
        expect(evmNativeParts({ value: YARIM_ETH }, ETH).sign).toBe('')
        expect(evmNativeParts({ category: 'contract interaction', value: YARIM_ETH }, ETH).sign).toBe('')
    })

    // KOK NEDEN (inceleme bulgusu): ondalik AKTIF AGDAN okunuyordu. Kullanici
    // Ethereum'da 0,5 ETH gonderip TON agina gecerse -- ve /ton/history hata
    // verirse -- EVM bekleyen satiri listede KALIYOR. TON kaydinda ondalik 9
    // oldugu icin 0,5 ETH "500.00M GRAM" olarak gorunuyordu: hem zincir hem
    // BUYUKLUK yanlis. Bu dala yalniz EVM satirlari ulasir ve TUM EVM zincirleri
    // 18 ondalik kullanir (supported_chains.json ile dogrulandi), bu yuzden
    // ondalik SABIT 18'dir, aktif agdan OKUNMAZ.
    it('aktif ag TON iken bile tutar 18 ondalikla cozulur (10^9 kat sismez)', () => {
        expect(evmNativeParts({ category: 'send', value: YARIM_ETH }, TON).amount).toBe(0.5)
    })

    it('aktif ag Solana iken de tutar 18 ondalikla cozulur', () => {
        expect(evmNativeParts({ category: 'send', value: YARIM_ETH }, SOLANA).amount).toBe(0.5)
    })

    // Sembol AKTIF AGDAN gelir ama YALNIZCA aktif ag EVM ise: EVM olmayan bir
    // agda duran bu satir o agin varligi DEGILDIR, "GRAM" yazmak duz bir yalandir.
    it('aktif ag EVM degilse sembol BOS kalir (GRAM/SOL yazmaz)', () => {
        expect(evmNativeParts({ category: 'send', value: YARIM_ETH }, TON).symbol).toBe('')
        expect(evmNativeParts({ category: 'send', value: YARIM_ETH }, SOLANA).symbol).toBe('')
    })

    it('zincir bilinmiyorsa sembol bos, tutar yine cozulur', () => {
        expect(evmNativeParts({ category: 'send', value: YARIM_ETH }, null))
            .toEqual({ amount: 0.5, sign: '-', symbol: '' })
    })

    it('deger yoksa ya da sifirsa amount null doner', () => {
        expect(evmNativeParts({ category: 'send', value: '0' }, ETH).amount).toBeNull()
        expect(evmNativeParts({ category: 'send' }, ETH).amount).toBeNull()
        expect(evmNativeParts(null, ETH).amount).toBeNull()
    })

    it('cozulemeyen degerde amount null doner', () => {
        expect(evmNativeParts({ category: 'send', value: 'abc' }, ETH).amount).toBeNull()
    })
})
