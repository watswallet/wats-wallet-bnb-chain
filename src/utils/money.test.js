import { describe, it, expect } from 'vitest'
import {
    USD_DISPLAY,
    convertUsd,
    formatCurrencyAmount,
    formatMoney,
    moneyParts,
} from './money'

// Intl bosluklari   /   ile yazar; karsilastirma icin duz bosluga indirilir.
const norm = (s) => (s == null ? s : s.replace(/[  ]/g, ' '))

const TRY = { code: 'try', rate: 48, fellBack: false }
const JPY = { code: 'jpy', rate: 150, fellBack: false }
const KWD = { code: 'kwd', rate: 0.3, fellBack: false }
const EUR = { code: 'eur', rate: 1, fellBack: false }

describe('USD_DISPLAY', () => {
    it('USD, kur 1, dusme yok', () => {
        expect(USD_DISPLAY).toEqual({ code: 'usd', rate: 1, fellBack: false })
    })

    it('donduruldu', () => {
        expect(Object.isFrozen(USD_DISPLAY)).toBe(true)
    })
})

describe('formatMoney - temel', () => {
    it('usd en', () => expect(formatMoney(1234.5, USD_DISPLAY, { locale: 'en' })).toBe('$1,234.50'))

    it('locale verilmezse en', () => expect(formatMoney(1234.5, USD_DISPLAY)).toBe('$1,234.50'))

    it('try tr', () => expect(norm(formatMoney(10, TRY, { locale: 'tr' }))).toBe('₺480,00'))

    it('usd tr', () => expect(norm(formatMoney(10, USD_DISPLAY, { locale: 'tr' }))).toBe('$10,00'))

    it('kod buyuk harfle de calisir', () => {
        expect(formatCurrencyAmount(1, 'CAD', { locale: 'en' })).toBe('CA$1.00')
    })

    it('cad hicbir zaman cibak $ degil', () => expect(formatCurrencyAmount(1, 'cad', { locale: 'en' })).toBe('CA$1.00'))

    it('kur yokken USD kod etiketli', () => {
        const s = formatMoney(10, { code: 'usd', rate: 1, fellBack: true, requested: 'try' }, { locale: 'en' })
        expect(norm(s)).toBe('USD 10.00')
    })

    it('kur yokken USD tr dilinde de kod etiketli', () => {
        const s = formatMoney(10, { code: 'usd', rate: 1, fellBack: true, requested: 'try' }, { locale: 'tr' })
        expect(norm(s)).toBe('USD 10,00')
    })

    it('dusme etiketi cagiranin currencyDisplay ayarini ezer', () => {
        const s = formatMoney(10, { code: 'usd', rate: 1, fellBack: true }, { locale: 'en', currencyDisplay: 'symbol' })
        expect(norm(s)).toBe('USD 10.00')
    })

    it('currencyDisplay code dusme olmadan da kod yazar', () => {
        expect(norm(formatMoney(10, USD_DISPLAY, { locale: 'en', currencyDisplay: 'code' }))).toBe('USD 10.00')
    })

    it('formatCurrencyAmount degeri DONUSTURMEZ (deger zaten o birimde)', () => {
        expect(norm(formatCurrencyAmount(480, 'try', { locale: 'tr' }))).toBe('₺480,00')
    })

    it('JPY ondaliksiz, KWD 3 ondalik (birimin kendi ondaligi)', () => {
        expect(formatMoney(10, JPY, { locale: 'en' })).toBe('¥1,500')
        expect(norm(formatMoney(5, KWD, { locale: 'en' }))).toBe('KWD 1.500')
    })
})

describe('formatMoney - standard', () => {
    it('kucuk pozitif, sifir, negatif', () => {
        expect(formatMoney(0.004, USD_DISPLAY)).toBe('<$0.01')
        expect(formatMoney(0, USD_DISPLAY)).toBe('$0.00')
        expect(formatMoney(-0.004, USD_DISPLAY)).toBe('$0.00')
        expect(formatMoney(-12.345, USD_DISPLAY)).toBe('-$12.35')
    })

    it('negatif sifir yok (-0)', () => {
        expect(formatMoney(-0, USD_DISPLAY)).toBe('$0.00')
    })

    it('tam esik 0.01 "<" almaz', () => {
        expect(formatMoney(0.01, USD_DISPLAY)).toBe('$0.01')
    })

    it('JPY: 0.5 standartta "<¥1" (sifir olmayan deger ¥0 gorunmez)', () => {
        expect(formatCurrencyAmount(0.5, 'jpy', { locale: 'en' })).toBe('<¥1')
        expect(formatMoney(0, JPY, { locale: 'en' })).toBe('¥0')
    })

    it('KWD: 0.0004 standartta "<" + 3 ondalikli esik', () => {
        expect(norm(formatCurrencyAmount(0.0004, 'kwd', { locale: 'en' }))).toBe('<KWD 0.001')
    })

    it('kucuk pozitif tr dilinde de "<" ile baslar', () => {
        expect(norm(formatMoney(0.004, USD_DISPLAY, { locale: 'tr' }))).toBe('<$0,01')
    })

    it('negatif tutar kucuk birimde sifira yuvarlanirsa eksi yazilmaz', () => {
        expect(formatMoney(-0.001, USD_DISPLAY)).toBe('$0.00')
        expect(formatMoney(-0.01, USD_DISPLAY)).toBe('-$0.01')
    })
})

describe('formatMoney - price', () => {
    const price = { style: 'price' }

    it('0.000008 -> $0.000008; 0.5 -> $0.50; 0.0000004 -> "<$0.000001" (asla $0.00)', () => {
        expect(formatMoney(0.000008, USD_DISPLAY, price)).toBe('$0.000008')
        expect(formatMoney(0.5, USD_DISPLAY, price)).toBe('$0.50')
        expect(formatMoney(0.0000004, USD_DISPLAY, price)).toBe('<$0.000001')
        expect(formatMoney(0.0000004, USD_DISPLAY, price)).not.toBe('$0.00')
    })

    it('0.004 -> $0.004 (birimin ondaligindan kucuk, 6 ondaliga kadar)', () => {
        expect(formatMoney(0.004, USD_DISPLAY, price)).toBe('$0.004')
    })

    it('sifir -> $0.00', () => {
        expect(formatMoney(0, USD_DISPLAY, price)).toBe('$0.00')
    })

    it('price JPY: 0.5 -> "¥1" DEGIL, 0.5 gorunur; KWD 0.0004 -> 6 ondalik', () => {
        expect(formatCurrencyAmount(0.5, 'jpy', { locale: 'en', style: 'price' })).toBe('¥0.5')
        // 1-99 araligi artik 4 anlamli basamakla yazilir (BD3): 1.5 -> "¥1.5", tamsayiya yuvarlanmaz.
        expect(formatCurrencyAmount(1.5, 'jpy', { locale: 'en', style: 'price' })).toBe('¥1.5')
        expect(norm(formatCurrencyAmount(0.0004, 'kwd', { locale: 'en', style: 'price' }))).toBe('KWD 0.0004')
        expect(norm(formatCurrencyAmount(0.0004, 'kwd', { locale: 'en', style: 'price' }))).not.toMatch(/0\.000(?!4)/)
    })

    describe('ondaliksiz/3 ondalikli birimlerde kucuk fiyat hassasiyeti (BD3)', () => {
        const fmt = (v, code) => formatCurrencyAmount(v, code, { locale: 'en', style: 'price' })

        it('JPY: 100 en kucuk birimden kucuk deger 4 anlamli basamak (¥7.56), 100 ve ustu bugunku kural (¥150)', () => {
            expect(fmt(7.56, 'jpy')).toBe('¥7.56')
            expect(fmt(7.5612, 'jpy')).toBe('¥7.561')
            expect(fmt(45.678, 'jpy')).toBe('¥45.68')
            expect(fmt(1.49, 'jpy')).toBe('¥1.49')
            expect(fmt(150, 'jpy')).toBe('¥150')
            expect(fmt(150.4, 'jpy')).toBe('¥150')
            expect(fmt(7, 'jpy')).toBe('¥7')
        })

        it('KRW ve VND: ayni kural; sifira dusme ve "<" kurallari korunur', () => {
            expect(fmt(12.34, 'krw')).toBe('₩12.34')
            expect(fmt(1500, 'krw')).toBe('₩1,500')
            expect(norm(fmt(8.5, 'vnd'))).toBe('₫8.5')
            expect(norm(fmt(2500, 'vnd'))).toBe('₫2,500')
            expect(fmt(0.0000004, 'jpy')).toBe('<¥0.000001')
            expect(fmt(0.5, 'jpy')).toBe('¥0.5')
        })

        it('KWD (3 ondalik): 0.1 altinda 4 anlamli basamak, ustunde bugunku kural', () => {
            expect(norm(fmt(0.0504, 'kwd'))).toBe('KWD 0.0504')
            expect(norm(fmt(0.5, 'kwd'))).toBe('KWD 0.500')
        })

        it('USD/EUR/TRY (2 ondalik) bugunku ciktisini aynen korur', () => {
            expect(fmt(0.0504, 'usd')).toBe('$0.05')
            expect(fmt(0.5, 'usd')).toBe('$0.50')
            expect(fmt(0.123, 'eur')).toBe('€0.12')
        })

        it('significant secenegi: esik birimin 100 en kucuk birimi (JPY < 100, USD < 1, KWD < 0.1)', () => {
            const sig = (v, code) => formatCurrencyAmount(v, code, { locale: 'en', significant: 4 })
            expect(sig(7.56, 'jpy')).toBe('¥7.56')
            expect(sig(1.4912, 'jpy')).toBe('¥1.491')
            expect(sig(150, 'jpy')).toBe('¥150')
            expect(sig(99.5, 'krw')).toBe('₩99.5')
            expect(sig(100, 'krw')).toBe('₩100')
            expect(sig(0.0504, 'usd')).toBe('$0.0504')
            expect(sig(1.2345, 'usd')).toBe('$1.23')
            expect(norm(sig(0.0504, 'kwd'))).toBe('KWD 0.0504')
            expect(norm(sig(0.1234, 'kwd'))).toBe('KWD 0.123')
        })
    })

    it('price: esik ustu degerler standart gibi', () => {
        expect(formatMoney(12.345, USD_DISPLAY, price)).toBe('$12.35')
        expect(formatMoney(0.01, USD_DISPLAY, price)).toBe('$0.01')
    })

    it('price: negatif cok kucuk deger sifir sayilir, eksi yazilmaz', () => {
        expect(formatMoney(-0.0000004, USD_DISPLAY, price)).toBe('$0.00')
    })

    it('price: kurla carpilinca kucuk deger kod etiketli dusmede de korunur', () => {
        const s = formatMoney(0.000008, { code: 'usd', rate: 1, fellBack: true }, price)
        expect(norm(s)).toBe('USD 0.000008')
    })
})

describe('formatMoney - compact', () => {
    const compact = { style: 'compact' }

    it('999.5 -> $999.50, 1500 -> $1.5K, 1234567 -> $1.23M', () => {
        expect(formatMoney(999.5, USD_DISPLAY, compact)).toBe('$999.50')
        expect(formatMoney(1500, USD_DISPLAY, compact)).toBe('$1.5K')
        expect(formatMoney(1234567, USD_DISPLAY, compact)).toBe('$1.23M')
    })

    it('tam 1000 kompakta girer', () => {
        expect(formatMoney(1000, USD_DISPLAY, compact)).toBe('$1K')
    })

    it('negatif buyuk deger de kompakt', () => {
        expect(formatMoney(-1500, USD_DISPLAY, compact)).toBe('-$1.5K')
    })

    it('3 ondalikli birimde (KWD) kompakt RangeError atmaz', () => {
        expect(norm(formatCurrencyAmount(1500, 'kwd', { locale: 'en', style: 'compact' }))).toBe('KWD 1.5K')
    })

    it('kompakt altinda kucuk pozitif standart kuralini izler', () => {
        expect(formatMoney(0.004, USD_DISPLAY, compact)).toBe('<$0.01')
    })
})

describe('formatMoney - significant', () => {
    it('significant 4: 0.0504 -> $0.0504; 1.2345 -> $1.23', () => {
        expect(formatMoney(0.0504, USD_DISPLAY, { significant: 4 })).toBe('$0.0504')
        expect(formatMoney(1.2345, USD_DISPLAY, { significant: 4 })).toBe('$1.23')
    })

    it('1 altinda en fazla n anlamli basamak', () => {
        expect(formatMoney(0.123456, USD_DISPLAY, { significant: 4 })).toBe('$0.1235')
        expect(formatMoney(0.0000123456, USD_DISPLAY, { significant: 4 })).toBe('$0.00001235')
    })

    it('sifir significant ile de $0.00 (anlamli basamak "$0" yazmaz)', () => {
        expect(formatMoney(0, USD_DISPLAY, { significant: 4 })).toBe('$0.00')
    })

    it('gecersiz significant yok sayilir', () => {
        expect(formatMoney(0.5, USD_DISPLAY, { significant: 0 })).toBe('$0.50')
        expect(formatMoney(0.5, USD_DISPLAY, { significant: 'x' })).toBe('$0.50')
    })
})

describe('gecersiz girdi', () => {
    it('gecersiz girdiler null (null -> 0 tuzagi)', () => {
        for (const v of [null, undefined, '', '   ', NaN, Infinity, -Infinity, 'abc', true, {}, []]) {
            expect(formatMoney(v, USD_DISPLAY)).toBeNull()
        }
        expect(formatMoney('12.5', USD_DISPLAY)).toBe('$12.50')
    })

    it('formatCurrencyAmount da ayni sekilde null doner', () => {
        for (const v of [null, undefined, '', NaN, Infinity, 'abc']) {
            expect(formatCurrencyAmount(v, 'usd')).toBeNull()
        }
    })

    it('kod eksikse null (etiketsiz tutar yazilmaz)', () => {
        expect(formatCurrencyAmount(1, '')).toBeNull()
        expect(formatCurrencyAmount(1, undefined)).toBeNull()
        expect(formatCurrencyAmount(1, null)).toBeNull()
        expect(formatCurrencyAmount(1, 5)).toBeNull()
    })

    it('bozuk kur null doner (NaN / 0 / negatif / metin)', () => {
        for (const rate of [NaN, 0, -2, Infinity, 'x', undefined, null]) {
            expect(formatMoney(10, { code: 'try', rate, fellBack: false })).toBeNull()
        }
    })

    it('display verilmezse USD gibi calisir (fiyat zaten USD)', () => {
        expect(formatMoney(10)).toBe('$10.00')
        expect(formatMoney(10, null)).toBe('$10.00')
    })

    it('1e21 ustel yazilmaz', () => expect(formatMoney(1e21, USD_DISPLAY)).not.toMatch(/e\+/i))

    it('cok buyuk sayi kompaktta da ustel degil', () => {
        expect(formatMoney(1e21, USD_DISPLAY, { style: 'compact' })).not.toMatch(/e\+/i)
    })

    it('bilinmeyen kod atmaz', () => expect(() => formatCurrencyAmount(1, 'zzzz')).not.toThrow())

    it('bozuk kod yedege duser: "<deger> <KOD>"', () => {
        expect(formatCurrencyAmount(1, 'zzzz')).toBe('1.00 ZZZZ')
        expect(formatCurrencyAmount(-2.5, 'zzzz')).toBe('-2.50 ZZZZ')
    })

    it('soz diziminde gecerli ama bilinmeyen kod atmaz ve kod yazar', () => {
        expect(norm(formatCurrencyAmount(1, 'xyz', { locale: 'en' }))).toBe('XYZ 1.00')
    })

    it('bozuk locale atmaz, yedege duser', () => {
        expect(formatCurrencyAmount(1, 'usd', { locale: 'xx_YY' })).toBe('1.00 USD')
    })
})

describe('moneyParts', () => {
    it('moneyParts', () => {
        expect(moneyParts(1234.5, USD_DISPLAY, { locale: 'en' })).toEqual({ prefix: '$', number: '1,234.50', suffix: '' })
        expect(moneyParts(1234.5, EUR, { locale: 'de' })).toEqual({ prefix: '', number: '1.234,50', suffix: '€' })
    })

    it('negatif tutarda eksi prefix tarafinda', () => {
        expect(moneyParts(-1234.5, USD_DISPLAY, { locale: 'en' })).toEqual({ prefix: '-$', number: '1,234.50', suffix: '' })
        expect(moneyParts(-1234.5, EUR, { locale: 'de' })).toEqual({ prefix: '-', number: '1.234,50', suffix: '€' })
    })

    it('"<" onekle prefix e girer', () => {
        expect(moneyParts(0.004, USD_DISPLAY, { locale: 'en' })).toEqual({ prefix: '<$', number: '0.01', suffix: '' })
        expect(moneyParts(0.004, EUR, { locale: 'de' })).toEqual({ prefix: '<', number: '0,01', suffix: '€' })
    })

    it('kompakt ek son ek olur', () => {
        expect(moneyParts(1500, USD_DISPLAY, { locale: 'en', style: 'compact' })).toEqual({ prefix: '$', number: '1.5', suffix: 'K' })
    })

    it('kur yokken USD kodu onek/son ek olarak ayrilir', () => {
        const p = moneyParts(10, { code: 'usd', rate: 1, fellBack: true, requested: 'try' }, { locale: 'en' })
        expect(p).toEqual({ prefix: 'USD', number: '10.00', suffix: '' })
    })

    it('kurla carpar', () => {
        expect(norm(moneyParts(10, TRY, { locale: 'tr' }).prefix)).toBe('₺')
        expect(moneyParts(10, TRY, { locale: 'tr' }).number).toBe('480,00')
    })

    it('parcalar birlestirilince formatMoney ile ayni metni verir', () => {
        for (const [v, display, opts] of [
            [1234.5, USD_DISPLAY, { locale: 'en' }],
            [-12.5, EUR, { locale: 'de' }],
            [0.004, USD_DISPLAY, { locale: 'tr' }],
            [10, TRY, { locale: 'tr' }],
        ]) {
            const p = moneyParts(v, display, opts)
            const text = formatMoney(v, display, opts)
            expect(norm(text).replace(/ /g, '')).toBe(norm(p.prefix + p.number + p.suffix).replace(/ /g, ''))
        }
    })

    it('gecersiz girdi null', () => {
        expect(moneyParts(null, USD_DISPLAY)).toBeNull()
        expect(moneyParts('', USD_DISPLAY)).toBeNull()
        expect(moneyParts(NaN, USD_DISPLAY)).toBeNull()
        expect(moneyParts(10, { code: 'try', rate: 0, fellBack: false })).toBeNull()
    })

    it('Intl hata verirse yedek atmaz', () => {
        expect(moneyParts(1, USD_DISPLAY, { locale: 'xx_YY' })).toEqual({ prefix: '', number: '1.00', suffix: 'USD' })
    })
})

describe('convertUsd', () => {
    it('convertUsd', () => {
        expect(convertUsd(10, TRY)).toBe(480)
        expect(convertUsd(NaN, TRY)).toBeNull()
    })

    it('null / bos / metin tuzaklari', () => {
        expect(convertUsd(null, TRY)).toBeNull()
        expect(convertUsd(undefined, TRY)).toBeNull()
        expect(convertUsd('', TRY)).toBeNull()
        expect(convertUsd('abc', TRY)).toBeNull()
        expect(convertUsd(Infinity, TRY)).toBeNull()
    })

    it('sayisal metin kabul', () => {
        expect(convertUsd('2.5', TRY)).toBe(120)
    })

    it('USD_DISPLAY degeri degistirmez', () => {
        expect(convertUsd(12.5, USD_DISPLAY)).toBe(12.5)
    })

    it('bozuk kur null', () => {
        expect(convertUsd(10, { code: 'try', rate: 0, fellBack: false })).toBeNull()
        expect(convertUsd(10, { code: 'try', rate: NaN, fellBack: false })).toBeNull()
        expect(convertUsd(10, { code: 'try', rate: -1, fellBack: false })).toBeNull()
    })

    it('sonuc tasarsa (Infinity) null', () => {
        expect(convertUsd(1e308, { code: 'try', rate: 1e10, fellBack: false })).toBeNull()
    })

    it('display verilmezse USD gibi', () => {
        expect(convertUsd(7)).toBe(7)
    })
})
