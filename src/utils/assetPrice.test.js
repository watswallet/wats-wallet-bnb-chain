import { describe, it, expect } from 'vitest'
import { assetPriceUSD, tokenToUsd, formatUsd, tokenToUsdInput, usdToToken } from './assetPrice'

describe('assetPriceUSD - IKI AYRI SEKIL', () => {
    // SelectAssets.vue:206 kanonik `market_data`yi `market` diye YENIDEN
    // ADLANDIRIYOR; Token.vue kaydi oldugu gibi birakiyor. Send.vue yalnizca
    // `market` okudugu icin Ana ekran -> Token -> Gonder yolunda fiyat 0 cikiyor
    // ve ekranda "$0.00" yaziyordu. Tek kapi ikisini de bilir.
    it('market.priceUSD okur (varlik listesi yolu)', () => {
        expect(assetPriceUSD({ market: { priceUSD: 612.5 } })).toBe(612.5)
    })

    it('market_data.priceUSD okur (Token ekrani yolu)', () => {
        expect(assetPriceUSD({ market_data: { priceUSD: 612.5 } })).toBe(612.5)
    })

    it('ikisi de varsa market oncelikli', () => {
        expect(assetPriceUSD({ market: { priceUSD: 1 }, market_data: { priceUSD: 2 } })).toBe(1)
    })

    it('metin fiyat sayiya cevrilir', () => {
        expect(assetPriceUSD({ market: { priceUSD: '3.5' } })).toBe(3.5)
    })

    // null tek bir sey demek: FIYAT BILINMIYOR. Ekran "-" gosterir, dolar
    // girisi kapanir. 0 dondurmek "bu token bedava" demekti.
    it('fiyat yoksa null', () => {
        expect(assetPriceUSD(null)).toBeNull()
        expect(assetPriceUSD({})).toBeNull()
        expect(assetPriceUSD({ market: {} })).toBeNull()
        expect(assetPriceUSD({ market: { priceUSD: null } })).toBeNull()
    })

    it('sifir ve negatif fiyat da BILINMIYOR sayilir', () => {
        // 0 ile bolmek dolar -> token cevrimini sonsuza goturur.
        expect(assetPriceUSD({ market: { priceUSD: 0 } })).toBeNull()
        expect(assetPriceUSD({ market: { priceUSD: -1 } })).toBeNull()
    })

    it('sayi olmayan fiyat BILINMIYOR sayilir', () => {
        expect(assetPriceUSD({ market: { priceUSD: 'abc' } })).toBeNull()
        expect(assetPriceUSD({ market: { priceUSD: Infinity } })).toBeNull()
    })
})

describe('tokenToUsd - SAYI doner', () => {
    it('miktari fiyatla carpar', () => {
        expect(tokenToUsd('2', 612.5)).toBe(1225)
    })

    // Metin dondurseydi tek bir bicim iki tuketiciye birden hizmet etmek
    // zorunda kalirdi: ekran "<0.01" ister, type="number" girisi duz sayi ister.
    it('bicimlendirilmemis sayi doner', () => {
        expect(typeof tokenToUsd('1', 0.000001)).toBe('number')
    })

    it('fiyat bilinmiyorsa null - 0 DEGIL', () => {
        expect(tokenToUsd('2', null)).toBeNull()
        expect(tokenToUsd('2', undefined)).toBeNull()
    })

    it('bos/gecersiz miktar null', () => {
        expect(tokenToUsd('', 10)).toBeNull()
        expect(tokenToUsd('abc', 10)).toBeNull()
        expect(tokenToUsd(null, 10)).toBeNull()
    })

    it('sifir miktar 0', () => {
        expect(tokenToUsd('0', 10)).toBe(0)
    })
})

describe('formatUsd', () => {
    it('iki basamakli metin', () => {
        expect(formatUsd(1225)).toBe('1225.00')
    })

    it('sifir 0.00', () => {
        expect(formatUsd(0)).toBe('0.00')
    })

    // "0.00", fiyatin HIC bilinmedigi durumla ayni goruntuyu uretirdi -
    // duzeltilen hatanin ta kendisi. Sifir olmayan kucuk deger ayirt edilir.
    it('sifirdan buyuk ama 0.01 altindaki tutar "<0.01"', () => {
        expect(formatUsd(0.000001)).toBe('<0.01')
    })

    it('null girdi null doner - "0.00" DEGIL', () => {
        expect(formatUsd(null)).toBeNull()
        expect(formatUsd(undefined)).toBeNull()
    })
})

describe('tokenToUsdInput', () => {
    it('kutuya yazilabilir duz sayi metni', () => {
        expect(tokenToUsdInput('2', 612.5)).toBe('1225')
    })

    // formatUsd "<0.01" uretir; type="number" girisi bunu kabul etmez.
    it('etiket URETMEZ - kucuk tutarda da sayi doner', () => {
        expect(tokenToUsdInput('1', 0.000001)).toBe('0')
    })

    // Yukari yuvarlanan dolar, token'a geri cevrildiginde bakiyeyi asar.
    it('ASAGI kirpar - yuvarlamaz', () => {
        expect(tokenToUsdInput('1', 0.999)).toBe('0.99')
    })

    it('fiyat bilinmiyorsa bos metin', () => {
        expect(tokenToUsdInput('2', null)).toBe('')
    })
})

describe('usdToToken', () => {
    it('dolari fiyata boler', () => {
        expect(usdToToken('1225', 612.5, 18)).toBe('2')
    })

    it('ondalik basamak sayisina gore KIRPILIR - yuvarlanmaz', () => {
        // Yukari yuvarlamak bakiyeyi asabilir; kirpmak asla asmaz.
        expect(usdToToken('10', 3, 6)).toBe('3.333333')
    })

    it('ondalik bilinmiyorsa 8 basamaga kirpilir', () => {
        expect(usdToToken('10', 3, undefined)).toBe('3.33333333')
    })

    it('fiyat bilinmiyorsa null', () => {
        expect(usdToToken('10', null, 18)).toBeNull()
    })

    it('bos/gecersiz dolar null', () => {
        expect(usdToToken('', 10, 18)).toBeNull()
        expect(usdToToken('abc', 10, 18)).toBeNull()
    })

    it('sifir dolar "0"', () => {
        expect(usdToToken('0', 10, 18)).toBe('0')
    })

    it('bilimsel gosterim uretmez', () => {
        // Cok kucuk sonuclar "1e-7" olarak yazilirsa v-model'e ve toNano'ya
        // bozuk bir metin gider.
        const out = usdToToken('0.0000001', 1, 18)
        expect(out).not.toContain('e')
    })
})
