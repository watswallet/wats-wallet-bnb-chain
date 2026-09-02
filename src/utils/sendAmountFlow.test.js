import { describe, it, expect } from 'vitest'
import { assetPriceUSD, tokenToUsd, formatUsd, tokenToUsdInput, usdToToken } from './assetPrice'
import { SEND_PERCENTS, percentAmount, spendableBalance } from './sendPercent'

// UCTAN UCA AKIS TESTI.
//
// Birim testleri her fonksiyonu tek basina olcuyor; burasi Send.vue'nun bu
// fonksiyonlari BIRLIKTE kullandiginda ortaya cikan sayilari olcer - yuzde
// cipi, birim degistirme ve elle dolar girisi ayni boru hattindan geciyor.
//
// Bu dosya bilesenin mantigini TAKLIT eder. Taklidin gercekten bilesende de
// boyle bagli oldugunu sendAmountWiring.test.js dogruluyor; ikisi ayrilirsa
// oradaki esleme kirilir.

const makeScreen = (asset, balance, reserve) => {
    const price = assetPriceUSD(asset)
    const screen = { mode: 'token', raw: '' }

    // Send.vue: const amount = computed(...)
    screen.amount = () => screen.mode !== 'usd'
        ? screen.raw
        : (usdToToken(screen.raw, price, asset?.decimals) ?? '')

    // Send.vue: writeTokenAmount
    screen.write = (tokenAmount) => {
        screen.raw = screen.mode === 'usd' ? tokenToUsdInput(tokenAmount, price) : tokenAmount
    }

    // Send.vue: toggleUnit
    screen.toggle = () => {
        if (price === null) return
        const current = screen.amount()
        screen.mode = screen.mode === 'usd' ? 'token' : 'usd'
        screen.write(current)
    }

    // Send.vue: setPercent
    screen.setPercent = (percent) => screen.write(
        percentAmount({ balance, reserve, percent, decimals: asset?.decimals })
    )

    // Send.vue: counterValue (token dali)
    screen.usdLine = () => formatUsd(tokenToUsd(screen.amount() || '0', price))

    return screen
}

const BNB = { symbol: 'BNB', decimals: 18, market_data: { priceUSD: 612.5 } }
const BALANCE = 1.2345678901234567
const RESERVE = 0.0004
const SPENDABLE = spendableBalance(BALANCE, RESERVE)

describe('yuzde cipleri - token modu', () => {
    it('MAX harcanabilirin TA KENDISI', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.setPercent(1)
        expect(Number(s.amount())).toBe(SPENDABLE)
    })

    it('hicbir cip harcanabiliri ASMAZ', () => {
        for (const percent of SEND_PERCENTS) {
            const s = makeScreen(BNB, BALANCE, RESERVE)
            s.setPercent(percent)
            expect(Number(s.amount())).toBeLessThanOrEqual(SPENDABLE)
        }
    })

    it('ciplerin orani dogru', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.setPercent(0.5)
        expect(Number(s.amount())).toBeCloseTo(SPENDABLE / 2, 12)
    })
})

describe('yuzde cipleri - dolar modu', () => {
    // Dolar modunda kutuya DOLAR yazilir ve token miktari ondan geri turer.
    // Bu gidip gelmede yukari yuvarlama olsaydi MAX bakiyeyi asardi.
    it('hicbir cip harcanabiliri ASMAZ', () => {
        for (const percent of SEND_PERCENTS) {
            const s = makeScreen(BNB, BALANCE, RESERVE)
            s.toggle()
            expect(s.mode).toBe('usd')
            s.setPercent(percent)
            expect(Number(s.amount())).toBeLessThanOrEqual(SPENDABLE)
        }
    })

    it('MAX yine de harcanabilirin cok yakininda kalir', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.toggle()
        s.setPercent(1)
        // Dolar 2 basamaga kirpildigi icin kucuk bir artik kalir; kayip
        // 1 sentin token karsiligindan buyuk OLMAMALI.
        const lost = SPENDABLE - Number(s.amount())
        expect(lost).toBeGreaterThanOrEqual(0)
        expect(lost).toBeLessThan(0.01 / 612.5)
    })
})

describe('elle dolar girisi', () => {
    it('yazilan dolar token miktarina cevrilir', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.toggle()
        s.raw = '100'
        expect(Number(s.amount())).toBeCloseTo(100 / 612.5, 12)
    })

    // EN PAHALI HATA: kutudaki "100" token sanilirsa cuzdan 100 BNB gonderir.
    it('yazilan sayi token miktari SANILMAZ', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.toggle()
        s.raw = '100'
        expect(s.amount()).not.toBe('100')
        expect(Number(s.amount())).toBeLessThan(1)
    })
})

describe('birim degistirme', () => {
    it('gidip gelmede deger BUYUMEZ', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.raw = '0.5'
        const before = Number(s.amount())
        s.toggle()
        s.toggle()
        expect(s.mode).toBe('token')
        expect(Number(s.amount())).toBeLessThanOrEqual(before)
    })

    it('gidip gelmede kayip 1 sentin altinda kalir', () => {
        const s = makeScreen(BNB, BALANCE, RESERVE)
        s.raw = '0.5'
        const before = Number(s.amount())
        s.toggle()
        s.toggle()
        expect(before - Number(s.amount())).toBeLessThan(0.01 / 612.5)
    })
})

describe('fiyati bilinmeyen varlik', () => {
    const NOPRICE = { symbol: 'XYZ', decimals: 9 }

    it('dolar satiri gosterilmez', () => {
        const s = makeScreen(NOPRICE, 10, 0)
        s.raw = '5'
        expect(s.usdLine()).toBeNull()
    })

    it('birim degistirilemez - kutu token cinsinde kalir', () => {
        const s = makeScreen(NOPRICE, 10, 0)
        s.raw = '5'
        s.toggle()
        expect(s.mode).toBe('token')
        expect(s.amount()).toBe('5')
    })

    it('yuzde cipleri fiyat OLMADAN da calisir', () => {
        const s = makeScreen(NOPRICE, 10, 0)
        s.setPercent(0.25)
        expect(Number(s.amount())).toBe(2.5)
    })
})

describe('jetton - ucret AYRI varliktan odenir', () => {
    // Jetton tarafinda pay ayrilmaz: tam bakiye gonderilebilmeli.
    const USDT = { symbol: 'USDT', decimals: 6, market: { priceUSD: 1 } }

    it('MAX tam jetton bakiyesini yazar', () => {
        const s = makeScreen(USDT, 250.123456, 0)
        s.setPercent(1)
        expect(Number(s.amount())).toBe(250.123456)
    })

    it('6 ondalikli jettonda yuzde 6 basamagi asmaz', () => {
        const s = makeScreen(USDT, 250.123456, 0)
        s.setPercent(0.25)
        const fraction = s.amount().split('.')[1] || ''
        expect(fraction.length).toBeLessThanOrEqual(6)
    })
})
