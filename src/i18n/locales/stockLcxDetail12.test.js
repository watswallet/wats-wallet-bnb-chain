// Bolum 2 Gorev 11: LCX detay ekrani ve ihracci bilgisi anahtarlari, 12 dil kilidi.
//   stockDetail.priceUpdatedAt           "Updated {time}" (LCX satirinin fiyat guncelleme zamani)
//   stockIssuer.diff.cell.how.lcx        LCX sutunu "nasil alinir" hucresi
//   stockIssuer.diff.cell.closed.lcx     LCX sutunu "ABD borsasi kapaliyken" hucresi
//   stockIssuer.diff.titleGeneric / introGeneric / footnoteGeneric   "Fark ne?" penceresinin genel baslik, giris ve dipnotu (duzeltme turu 1, karar R10):
//                                        sutunlardan biri LCX ihraccisiyse "bStocks ve xStocks" / "ikisi de" metinleri yanlis olur
// allLocales.test.js yapisal butunlugu (yer tutucu, anahtar kumesi, korunan terimler) denetler ama hangi anahtarin hangi degerle HER dilde
// bulunmasi GEREKTIGINI bilmez. Burada kilitli: 12 dilde var, en / tr birebir, diger 10 dil cevrilmis; marka adlari (LCX Liberty DEX, Chainlink)
// cevrilmez; {time} yer tutucusu her dilde korunur.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SUPPORTED_LANGS } from '../languages'
import { flatten } from '../messageTools'

const here = dirname(fileURLToPath(import.meta.url))
const flatOf = (kod) => new Map(flatten(JSON.parse(readFileSync(join(here, `${kod}.json`), 'utf8'))))
const EN = flatOf('en')

const GENERIC = ['stockIssuer.diff.titleGeneric', 'stockIssuer.diff.introGeneric', 'stockIssuer.diff.footnoteGeneric']
const KEYS = ['stockDetail.priceUpdatedAt', 'stockIssuer.diff.cell.how.lcx', 'stockIssuer.diff.cell.closed.lcx', ...GENERIC]

describe('LCX detay / ihracci bilgisi 12 dil kilidi (Gorev 11)', () => {
    it('pozitif bekci: 12 dil ve en anahtarlari dolu', () => {
        expect(SUPPORTED_LANGS).toHaveLength(12)
        for (const k of KEYS) expect(typeof EN.get(k), k).toBe('string')
    })

    it('en ve tr birebir (brief)', () => {
        const tr = flatOf('tr')
        expect(EN.get('stockDetail.priceUpdatedAt')).toBe('Updated {time}')
        expect(tr.get('stockDetail.priceUpdatedAt')).toBe('Güncellendi: {time}')
        expect(EN.get('stockIssuer.diff.cell.how.lcx')).toBe('Traded on LCX Liberty DEX. Every price is checked against a Chainlink reference price (at most 1% worse).')
        expect(tr.get('stockIssuer.diff.cell.how.lcx')).toBe("LCX Liberty DEX'te alınıp satılır. Her fiyat Chainlink referans fiyatıyla karşılaştırılır (en fazla %1 kötü).")
        expect(EN.get('stockIssuer.diff.cell.closed.lcx')).toBe('You can trade while the US market is closed; the reference is the last closing price.')
        expect(tr.get('stockIssuer.diff.cell.closed.lcx')).toBe('ABD borsası kapalıyken de işlem yapılabilir; referans son kapanış fiyatıdır.')
    })

    it('genel baslik / giris / dipnot: en ve tr birebir (karar R10)', () => {
        const tr = flatOf('tr')
        expect(EN.get('stockIssuer.diff.titleGeneric')).toBe('How the options differ')
        expect(tr.get('stockIssuer.diff.titleGeneric')).toBe('Seçenekler arasındaki farklar')
        expect(EN.get('stockIssuer.diff.introGeneric')).toBe("Each is a digital token that follows the price of the same company's stock. Whichever you buy is the one you own; they do not convert into each other.")
        expect(tr.get('stockIssuer.diff.introGeneric')).toBe('Her seçenek aynı şirketin hisse fiyatını takip eden dijital bir token. Hangisini alırsan o token senin olur; birbirine dönüşmez.')
        expect(EN.get('stockIssuer.diff.footnoteGeneric')).toBe('None of them is a share of stock; they are tokens that follow it. You see the current price on the buy screen.')
        expect(tr.get('stockIssuer.diff.footnoteGeneric')).toBe('Hiçbiri hisse senedi değildir; hisseyi takip eden tokendir. Güncel fiyatı alım ekranında görürsün.')
    })

    it('eski baslik / giris / dipnot (saf bstocks + xstocks) YERINDE ve genel metinlerden farkli (her dilde)', () => {
        for (const kod of SUPPORTED_LANGS) {
            const m = flatOf(kod)
            for (const k of ['title', 'intro', 'footnote']) {
                expect(typeof m.get(`stockIssuer.diff.${k}`), `${kod} ${k}`).toBe('string')
                expect(m.get(`stockIssuer.diff.${k}Generic`), `${kod} ${k}Generic`).not.toBe(m.get(`stockIssuer.diff.${k}`))
            }
        }
    })

    describe.each(SUPPORTED_LANGS)('%s dil dosyasi', (kod) => {
        const m = flatOf(kod)

        it('uc anahtar da var, dolu ve ham anahtar yolu degil', () => {
            for (const k of KEYS) {
                const v = m.get(k)
                expect(typeof v, k).toBe('string')
                expect(v.trim(), k).not.toBe('')
                expect(v, k).not.toBe(k)
            }
        })

        it('priceUpdatedAt: {time} yer tutucusunu tasir', () => {
            expect(m.get('stockDetail.priceUpdatedAt')).toContain('{time}')
        })

        it('genel baslik / giris / dipnot: dolu, yer tutucu tasimaz; baslik bStocks / xStocks adlarini TASIMAZ (iki markaya ozel degil)', () => {
            for (const k of GENERIC) {
                const v = m.get(k)
                expect(v, k).not.toMatch(/[{}|@<>]/)
            }
            expect(m.get('stockIssuer.diff.titleGeneric')).not.toMatch(/bStocks|xStocks/)
        })

        it('how.lcx: marka adlari LCX Liberty DEX ve Chainlink cevrilmeden yazilir; closed.lcx yer tutucu tasimaz', () => {
            const how = m.get('stockIssuer.diff.cell.how.lcx')
            expect(how).toContain('LCX Liberty DEX')
            expect(how).toContain('Chainlink')
            expect(how).not.toMatch(/[{}|@<>]/)
            expect(m.get('stockIssuer.diff.cell.closed.lcx')).not.toMatch(/[{}|@<>]/)
        })

        it('stockIssuer.diff.cell.how / closed: lcx girdisi ile birlikte bstocks / xstocks girdileri yerinde', () => {
            for (const blok of ['how', 'closed']) {
                for (const i of ['bstocks', 'xstocks', 'lcx']) expect(typeof m.get(`stockIssuer.diff.cell.${blok}.${i}`), `${blok}.${i}`).toBe('string')
            }
        })
    })

    it('diger 10 dil en metninden FARKLI (cevrilmis); tr ayri kontrol edildi', () => {
        for (const kod of SUPPORTED_LANGS.filter((k) => k !== 'en')) {
            const m = flatOf(kod)
            for (const k of KEYS) expect(m.get(k), `${kod} ${k}`).not.toBe(EN.get(k))
        }
    })
})
