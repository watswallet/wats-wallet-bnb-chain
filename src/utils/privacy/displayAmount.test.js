import { describe, it, expect } from 'vitest'
import { trimAmount, payAmountLabel, formatRawAmount } from './displayAmount'

describe('trimAmount', () => {
    it('kisa ya da tam sayi tutar oldugu gibi kalir', () => {
        expect(trimAmount('0.0405')).toEqual({ text: '0.0405', exact: '0.0405', trimmed: false })
        expect(trimAmount('25')).toEqual({ text: '25', exact: '25', trimmed: false })
        expect(trimAmount('0.123456')).toMatchObject({ text: '0.123456', trimmed: false })
    })

    it('uzun kuyruk 6 ondalikta KESILIR (yuvarlanmaz) ve tam deger saklanir', () => {
        expect(trimAmount('0.040512345678901234')).toEqual({ text: '0.040512', exact: '0.040512345678901234', trimmed: true })
        // yuvarlansaydi 0.123457 olurdu
        expect(trimAmount('0.1234569999').text).toBe('0.123456')
        expect(trimAmount('12.1000009').text).toBe('12.1')
        expect(trimAmount('7.0000001').text).toBe('7')
    })

    it('6 ondalikta sifira inen deger "<0.000001" olur', () => {
        expect(trimAmount('0.0000001234')).toMatchObject({ text: '<0.000001', trimmed: true })
    })

    it('sayi bicimi disi girdi oldugu gibi doner', () => {
        expect(trimAmount('-')).toEqual({ text: '-', exact: '-', trimmed: false })
        expect(trimAmount(null)).toEqual({ text: '', exact: '', trimmed: false })
        expect(trimAmount('1e-9')).toMatchObject({ text: '1e-9', trimmed: false })
    })
})

describe('payAmountLabel', () => {
    const Q = { totalUsdc: '25.25', sourceInput: { amount: '25250000000000000000', asset: 'USDC', decimals: 18 } }

    it('sourceInput bicimlenirse onu kullanir', () => {
        expect(payAmountLabel(Q, { chainId: 1, asset: 'USDC' })).toBe('25.25 USDC')
        expect(payAmountLabel({ sourceInput: { amount: '1500000', asset: 'USDT', decimals: 6 } }, { chainId: 1, asset: 'USDT' })).toBe('1.5 USDT')
    })

    it('sourceInput yoksa YALNIZ dogrudan rotada totalUsdc', () => {
        const q = { ...Q, sourceInput: null }
        expect(payAmountLabel(q, { chainId: 56, asset: 'USDC' })).toBe('25.25 USDC')
        expect(payAmountLabel(q, { chainId: '56', asset: 'USDC' })).toBe('25.25 USDC')
        expect(payAmountLabel(q, { chainId: 1, asset: 'USDC' })).toBeNull()
        expect(payAmountLabel(q, { chainId: 56, asset: 'USDT' })).toBeNull()
        expect(payAmountLabel(q, null)).toBeNull()
    })

    it('dogrudan rotada sunucu ondaligi rakami olceklese de totalUsdc gosterilir (21 ondalik "1.0 USDC" basmaz)', () => {
        const hostile = { totalUsdc: '1000.0', sourceInput: { amount: '1000000000000000000000', asset: 'USDC', decimals: 21, chainId: 56 } }
        expect(payAmountLabel(hostile, { chainId: 56, asset: 'USDC' })).toBe('1000.0 USDC')
        expect(payAmountLabel({ ...hostile, totalUsdc: undefined }, { chainId: 56, asset: 'USDC' })).toBeNull()
    })

    it('bozuk sourceInput dogrudan rotada totalUsdc a, kopruluyse null a duser', () => {
        const bozuk = { ...Q, sourceInput: { amount: 'abc', asset: 'USDC', decimals: 18 } }
        expect(payAmountLabel(bozuk, { chainId: 56, asset: 'USDC' })).toBe('25.25 USDC')
        expect(payAmountLabel(bozuk, { chainId: 1, asset: 'USDC' })).toBeNull()
    })

    it('dogrudan rotada bile totalUsdc yok ya da sayi degilse null (fail-closed)', () => {
        for (const totalUsdc of [undefined, null, '', 'abc', '1e3', 25.25]) {
            expect(payAmountLabel({ totalUsdc, sourceInput: null }, { chainId: 56, asset: 'USDC' })).toBeNull()
        }
        expect(payAmountLabel(null, { chainId: 56, asset: 'USDC' })).toBeNull()
    })
})

describe('formatRawAmount', () => {
    it('ham birimi ondalikli dizgeye cevirir, bozuksa null', () => {
        expect(formatRawAmount('40500000000000000', 18)).toBe('0.0405')
        expect(formatRawAmount('abc', 18)).toBeNull()
    })
})

// URETIM modeli (ucret USTUNE eklenir, olcum 2026-10-29): 15 istendi -> alicinin alacagi 15, cuzdandan cikan 15.15.
// "Odeyecegin" satiri, izin ve yatirma ayni BRUT tutardir (quote.amount); alicinin tutari (payoutUsdc) odeme degildir.
describe('uretim modeli: Odeyecegin satiri brut tutari gosterir', () => {
    it('ozet payoutUsdc 15, totalUsdc 15.15; satir 15.15 USDC; izin tutari ayni sayi', async () => {
        const { quoteSummary, depositPlanFromQuote } = await import('./silentswap')
        const { olcum15Fixture } = await import('../../test-utils/silentswapFixtures')
        const { usdcTokenOf } = await import('./deliveryTokens')
        const { formatUnits } = await import('ethers')
        const quote = olcum15Fixture()
        const s = quoteSummary(quote, usdcTokenOf(56))
        expect(s.payoutUsdc).toBe('15')
        expect(s.totalUsdc).toBe('15.15')
        expect(payAmountLabel(s, { chainId: 56, asset: 'USDC' })).toBe('15.15 USDC')
        expect(payAmountLabel({ ...s, sourceInput: null }, { chainId: 56, asset: 'USDC' })).toBe('15.15 USDC')
        expect(formatUnits(depositPlanFromQuote(quote).approval.amount, 18)).toBe('15.15')
    })
})
