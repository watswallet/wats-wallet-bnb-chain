// messageTools.js: ceviri dosyalarini makinece denetleyen saf yardimcilar.
import { describe, it, expect } from 'vitest'
import { flatten, placeholders, htmlTags, pluralFormCount, containsTerm } from './messageTools'
import { PROTECTED_TERMS } from './protectedTerms'

describe('flatten', () => {
    it('ic ice nesneyi noktali yol ve deger ciftlerine duzlestirir (sira korunur)', () => {
        expect(flatten({ a: { b: 'x', c: { d: 'y' } }, e: 'z' })).toEqual([
            ['a.b', 'x'],
            ['a.c.d', 'y'],
            ['e', 'z'],
        ])
    })

    it('bos nesne -> bos dizi', () => {
        expect(flatten({})).toEqual([])
    })
})

describe('placeholders', () => {
    it('{ad} adlarini tekil ve sirali dondurur', () => {
        expect(placeholders('≈ {count} a | {count} b {x}')).toEqual(['count', 'x'])
    })

    it('adlari kirpar ({ amount } -> amount)', () => {
        expect(placeholders('{ amount } {symbol}')).toEqual(['amount', 'symbol'])
    })

    it('yer tutucu yoksa bos dizi', () => {
        expect(placeholders('Merhaba')).toEqual([])
    })

    it("vue-i18n degismez metin kacisi {'...'} yer tutucu sayilmaz", () => {
        expect(placeholders("a {'@'} b {name}")).toEqual(['name'])
    })

    it('sayisal yer tutucular da ad sayilir ({0})', () => {
        expect(placeholders('{1} then {0}')).toEqual(['0', '1'])
    })
})

describe('htmlTags', () => {
    it('etiketleri tekrarli ve sirali dondurur', () => {
        expect(htmlTags('<strong>{a}</strong><br/>')).toEqual(['</strong>', '<br/>', '<strong>'])
    })

    it('ayni etiketin tekrari sayilir', () => {
        expect(htmlTags('<b>a</b> <b>b</b>')).toEqual(['</b>', '</b>', '<b>', '<b>'])
    })

    it('oznitelikler etiketin parcasidir', () => {
        expect(htmlTags('<span class="x">a</span>')).toEqual(['</span>', '<span class="x">'])
    })

    it('harf olmayan "<" etiket sayilmaz', () => {
        expect(htmlTags('x < 5 and 3 <= y')).toEqual([])
    })
})

describe('pluralFormCount', () => {
    it('| ile ayrilan parca sayisi', () => {
        expect(pluralFormCount('a | b | c')).toBe(3)
        expect(pluralFormCount('a | b')).toBe(2)
    })

    it('| yoksa 1', () => {
        expect(pluralFormCount('a')).toBe(1)
    })

    it("{'|'} kacisi ayirici sayilmaz", () => {
        expect(pluralFormCount("a {'|'} b")).toBe(1)
        expect(pluralFormCount("a {'|'} b | c")).toBe(2)
    })
})

describe('containsTerm', () => {
    it('tam sozcuk eslesir', () => {
        expect(containsTerm('Use ATS now', 'ATS')).toBe(true)
    })

    it('baska sozcugun icindeki eslesme sayilmaz', () => {
        expect(containsTerm('STATS', 'ATS')).toBe(false)
        expect(containsTerm('ATSX', 'ATS')).toBe(false)
        expect(containsTerm('ERC20s', 'ERC20')).toBe(false)
    })

    it('rakam komsulugu da sozcuk sinirini bozar', () => {
        expect(containsTerm('ATS2', 'ATS')).toBe(false)
        expect(containsTerm('2ATS', 'ATS')).toBe(false)
    })

    it('noktalama ve bosluk sinirdir', () => {
        expect(containsTerm('(ATS)', 'ATS')).toBe(true)
        expect(containsTerm('ATS.', 'ATS')).toBe(true)
        expect(containsTerm('x-ATS', 'ATS')).toBe(true)
    })

    it('buyuk/kucuk harf duyarlidir, ignoreCase ile degil', () => {
        expect(containsTerm('Open DApp', 'dApp')).toBe(false)
        expect(containsTerm('Open DApp', 'dApp', { ignoreCase: true })).toBe(true)
    })

    it('Latin olmayan yazi komsulugu sinir sayilir (QRコード)', () => {
        expect(containsTerm('QRコード', 'QR')).toBe(true)
        expect(containsTerm('使用ATS交换', 'ATS')).toBe(true)
    })

    it('cok sozcuklu terim', () => {
        expect(containsTerm('on BNB Chain today', 'BNB Chain')).toBe(true)
        expect(containsTerm('on BNB', 'BNB Chain')).toBe(false)
    })

    it('ilk eslesme sinir disiysa sonrakine bakar', () => {
        expect(containsTerm('STATS and ATS', 'ATS')).toBe(true)
    })

    it('terim yoksa false', () => {
        expect(containsTerm('hello', 'ATS')).toBe(false)
        expect(containsTerm('', 'ATS')).toBe(false)
    })
})

describe('PROTECTED_TERMS', () => {
    // Rehber 2.1 listesinin tamami; sessizce eksilmesin.
    const BEKLENEN = [
        'WATS', 'Wats', 'ATS', 'GRAM', 'TON', 'BNB', 'BNB Chain', 'BSC', 'EVM', 'Solana', 'SOL',
        'Ethereum', 'Arbitrum', 'CoW', 'xStocks', 'bStocks', 'BTech', 'Backed Assets', 'Atlas Oracle',
        'USDT', 'USDC', 'DAI', 'NFT', 'DeFi', 'dApp', 'Web3', 'WalletConnect', 'TonConnect',
        'Binance', 'Moonpay', 'MEXC', 'SHA-256', 'EIP-2612', 'ISIN', 'KYC', 'QR', 'JSON', 'ERC20',
        'URI', 'MAM',
    ]

    it('Rehber 2.1 listesindeki 40 terimin hepsi var', () => {
        expect(PROTECTED_TERMS.map((t) => t.term).sort()).toEqual([...BEKLENEN].sort())
    })

    it('yalniz dApp buyuk/kucuk harf duyarsiz', () => {
        const duyarsiz = PROTECTED_TERMS.filter((t) => t.ignoreCase).map((t) => t.term)
        expect(duyarsiz).toEqual(['dApp'])
    })

    it('terimler tekil', () => {
        const adlar = PROTECTED_TERMS.map((t) => t.term)
        expect(new Set(adlar).size).toBe(adlar.length)
    })
})
