// IssuerInfoSheet.vue + IssuerLogo.vue -- LCX ihraccilari (Bolum 2, Gorev 11).
// Olculen: (1) IssuerLogo LCX ihraccisi icin HARF ROZETI cizer (`<img>` yok, src yok, erisilebilir ad ihracci adi); bStocks / xStocks logosu
// (`<img>` + src + alt) degismez; (2) "Fark ne?" penceresi YALNIZ o sirketin seceneklerindeki ihraccilarin sutunlarini cizer (BSC GME: bStocks +
// Ondo); LCX sutununun "network" hucresi katalogdaki ag adlarindan, "how" / "closed" hucreleri stockIssuer.diff.cell.{how,closed}.lcx.
// Varsayilan (issuers verilmez) bStocks + xStocks AYNEN kalir (IssuerSwitch.ssr.test.js'teki mevcut testler).
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, createTestI18n, captureInstance } from '../../test-utils/ssrRender.js'
import { companyRows, issuerOptions } from '../../utils/stocks/stockCompanies'
import { stockEntry, setLcxStockRows, _resetLcxStockRows } from '../../utils/tokenizedStocks'
import IssuerLogo from './IssuerLogo.vue'
import IssuerInfoSheet from './IssuerInfoSheet.vue'
import IssuerSwitch from './IssuerSwitch.vue'

const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const read = (name) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()

const logo = async (props, locale = 'en') => clean(await render(createApp(IssuerLogo, { props, use: [createTestI18n(locale)] })))
const sheet = async (props, locale = 'en') => clean(await render(createApp(IssuerInfoSheet, { props, use: [createTestI18n(locale)] })))
const cards = (out) => [...out.matchAll(/data-issuer-card="([^"]+)"/g)].map((m) => m[1])
// Bir ihracci kartinin HTML'i: kart isaretinden sonraki karta (yoksa sayfa sonuna) kadar. Son kartta ortak dipnot da gelir; dipnot
// ihracci adi ya da LCX metni tasimaz, bu yuzden kart basina iddialar etkilenmez.
const card = (out, issuer) => {
    const at = out.indexOf(`data-issuer-card="${issuer}"`)
    expect(at, `${issuer} karti yok`).toBeGreaterThan(-1)
    const next = cards(out).map((i) => out.indexOf(`data-issuer-card="${i}"`)).filter((i) => i > at)
    return next.length ? out.slice(at, Math.min(...next)) : out.slice(at)
}

const HOW_EN = 'Traded on LCX Liberty DEX. Every price is checked against a Chainlink reference price (at most 1% worse).'
const CLOSED_EN = 'You can trade while the US market is closed; the reference is the last closing price.'

describe('IssuerLogo.vue -- harf rozeti (test 4)', () => {
    it('coinbase: harf rozeti "C"; <img> yok, src yok; erisilebilir ad ihracci adi (role=img + aria-label)', async () => {
        const out = await logo({ issuer: 'coinbase' })
        expect(out).not.toContain('<img')
        expect(out).not.toMatch(/\ssrc=/)
        expect(out).toContain('data-issuer-logo="coinbase"')
        expect(out).toContain('role="img"')
        expect(out).toContain('aria-label="Coinbase"')
        expect(text(out)).toBe('C')
    })

    it('baslangic harfi ihracci ADINDAN: ondo O, robinhood R, st0x S', async () => {
        for (const [issuer, letter] of [['ondo', 'O'], ['robinhood', 'R'], ['st0x', 'S'], ['coinbase', 'C']]) {
            expect(text(await logo({ issuer })), issuer).toBe(letter)
        }
    })

    it('boyut sinifi ve veri kancasi (data-issuer-badge) harf rozetine de gecer', async () => {
        const out = await logo({ issuer: 'ondo', size: 'w-5 h-5', 'data-issuer-badge': 'ondo' })
        const tag = out.match(/<span[^>]*data-issuer-logo="ondo"[^>]*>/)[0]
        expect(tag).toContain('w-5 h-5')
        expect(tag).toContain('rounded-full')
        expect(tag).toContain('data-issuer-badge="ondo"')
    })

    it('bStocks / xStocks logosu degismez: <img> + src + alt, harf rozeti yok', async () => {
        const b = await logo({ issuer: 'bstocks' })
        expect(b).toMatch(/<img[^>]*data-issuer-logo="bstocks"/)
        expect(b).toContain('src="/images/issuers/bstocks.png"')
        expect(b).toContain('alt="bStocks"')
        const x = await logo({ issuer: 'xstocks' })
        expect(x).toContain('src="/images/issuers/xstocks.svg"')
        expect(x).toContain('alt="xStocks"')
        expect(b).not.toContain('role="img"')
        expect(x).not.toContain('role="img"')
    })

    it("adi listede olmayan ihracci ('foo-bar', 'constructor'): bas harfi buyuk kimlik, harf rozeti, cokme yok, ham anahtar yok", async () => {
        const foo = await logo({ issuer: 'foo-bar' })
        expect(foo).toContain('aria-label="Foo-bar"')
        expect(text(foo)).toBe('F')
        const odd = await logo({ issuer: 'constructor' })
        expect(odd).toContain('aria-label="Constructor"')
        expect(odd).not.toMatch(/\ssrc=|<img|function|\[object|stockIssuer\./)
        expect(text(odd)).toBe('C')
    })

    it('tr dilinde de ad ve harf', async () => {
        const out = await logo({ issuer: 'coinbase' }, 'tr')
        expect(out).toContain('aria-label="Coinbase"')
    })

    it('kaynak: logo bileseni miras adlara karsi guvenli (Map / dizi uyeligi), v-html ve inline svg yok', () => {
        const src = read('./IssuerLogo.vue')
        expect(src).not.toMatch(/v-html|<svg/)
        expect(src).not.toMatch(/SRC\[issuer\]|LOGOS\[issuer\]/)
    })
})

describe('IssuerInfoSheet.vue -- dinamik sutunlar (test 5)', () => {
    it('issuers verilmezse bStocks + xStocks (bugunku davranis) ve her kartta uc bilgi satiri', async () => {
        const out = await sheet({ networks: 'Ethereum' })
        expect(cards(out)).toEqual(['bstocks', 'xstocks'])
        expect(out.match(/data-issuer-info-row="/g)).toHaveLength(6)
    })

    it('BSC GME: yalniz bstocks + ondo sutunu; xstocks sutunu YOK', async () => {
        const out = await sheet({ issuers: ['bstocks', 'ondo'], networks: '', lcxNetworks: { ondo: 'BNB Smart Chain' } })
        expect(cards(out)).toEqual(['bstocks', 'ondo'])
        expect(out).not.toContain('data-issuer-card="xstocks"')
        expect(out.match(/data-issuer-info-row="/g)).toHaveLength(6)
        // bStocks sutunu bugunku metinleri korur
        expect(card(out, 'bstocks')).toContain('BNB Smart Chain only')
        expect(card(out, 'bstocks')).toContain('Open 24/7')
    })

    it('LCX sutunu: "network" hucresi katalogdaki ag adindan (tek ag -> "Only X", cok ag -> liste); "how" ve "closed" LCX metinleri', async () => {
        const one = await sheet({ issuers: ['bstocks', 'ondo'], networks: '', lcxNetworks: { ondo: 'BNB Smart Chain' } })
        const ondo = card(one, 'ondo')
        expect(text(ondo)).toContain('Only BNB Smart Chain')
        expect(text(ondo)).toContain(HOW_EN)
        expect(text(ondo)).toContain(CLOSED_EN)
        expect(text(ondo)).toContain('Tokenized stock via LCX') // kart basligi alt metni (stockIssuer.sub.lcx)
        expect(text(ondo)).toContain('Ondo')
        const many = await sheet({ issuers: ['coinbase'], lcxNetworks: { coinbase: 'Ethereum, Base' } })
        expect(text(card(many, 'coinbase'))).toContain('Ethereum, Base')
        expect(text(card(many, 'coinbase'))).not.toContain('Only')
    })

    it('LCX sutunu tr: ag hucresi, how ve closed Turkce', async () => {
        const out = await sheet({ issuers: ['bstocks', 'coinbase'], lcxNetworks: { coinbase: 'Base' } }, 'tr')
        const t = text(card(out, 'coinbase'))
        expect(t).toContain('Yalnız Base')
        expect(t).toContain("LCX Liberty DEX'te alınıp satılır. Her fiyat Chainlink referans fiyatıyla karşılaştırılır (en fazla %1 kötü).")
        expect(t).toContain('ABD borsası kapalıyken de işlem yapılabilir; referans son kapanış fiyatıdır.')
    })

    it('statik sutunlar LCX metni TASIMAZ; LCX sutunu bStocks / xStocks metni tasimaz', async () => {
        const out = await sheet({ issuers: ['bstocks', 'xstocks', 'ondo'], networks: 'Ethereum', lcxNetworks: { ondo: 'BNB Smart Chain' } })
        expect(cards(out)).toEqual(['bstocks', 'xstocks', 'ondo'])
        expect(out.split(HOW_EN)).toHaveLength(2)
        expect(card(out, 'ondo')).not.toContain('Binance')
        expect(card(out, 'ondo')).not.toContain('Backed')
        expect(card(out, 'xstocks')).toContain('Only Ethereum')
    })

    it('secili LCX ihraccisi vurgulanir, digerleri degil', async () => {
        const out = await sheet({ issuers: ['bstocks', 'ondo'], selected: 'ondo', lcxNetworks: { ondo: 'BNB Smart Chain' } })
        expect(card(out, 'ondo')).toContain('data-selected="true"')
        expect(card(out, 'bstocks')).toContain('data-selected="false"')
    })

    it("miras adli ihracci ('constructor') ve bilinmeyen ag listesi: cokmez, ham anahtar / function sizmaz, ag hucresi tire", async () => {
        const out = await sheet({ issuers: ['bstocks', 'constructor'], lcxNetworks: {} })
        expect(cards(out)).toEqual(['bstocks', 'constructor'])
        const t = text(card(out, 'constructor'))
        expect(t).toContain('Constructor')
        expect(t).not.toMatch(/stockIssuer\.|function|\[object/)
        expect(t).toContain('—')
        expect(t).toContain(HOW_EN)
    })

    it('kaynak: sutunlar prop listesinden; ihracci adi ve LCX anahtarlari miras-guvenli (dogrudan $t(stockIssuer. + i) yok)', () => {
        const src = read('./IssuerInfoSheet.vue')
        expect(src).toContain('stockIssuer.diff.cell.how.lcx')
        expect(src).toContain('stockIssuer.diff.cell.closed.lcx')
        expect(src).not.toMatch(/\$t\('stockIssuer\.' \+ i\)/)
        expect(src).not.toMatch(/const ISSUERS = \['bstocks', 'xstocks'\]/)
        expect(src).toContain('Object.hasOwn')
    })
})

// ---- Baslik / giris / dipnot / etiket (duzeltme turu 1, karar R10) ----------------------------------------------------------------
// Sutunlar dinamik oldugundan "bStocks ve xStocks" basligi, "Her ikisi ..." girisi ve "Hicbiri ... ikisi de" dipnotu LCX ihraccisi olan kumede YANLIS.
// Kume bir LCX ihraccisi iceriyorsa genel anahtarlar (titleGeneric / introGeneric / footnoteGeneric; ayni metin dialog aria-label'inda), aksi halde
// (saf bstocks + xstocks) eski anahtarlar AYNEN.
describe('IssuerInfoSheet.vue -- genel baslik, giris, dipnot ve aria-label (R10)', () => {
    const TITLE_EN = 'How the options differ'
    const INTRO_EN = "Each is a digital token that follows the price of the same company's stock. Whichever you buy is the one you own; they do not convert into each other."
    const FOOT_EN = 'None of them is a share of stock; they are tokens that follow it. You see the current price on the buy screen.'
    const OLD_TITLE_EN = 'bStocks and xStocks'
    const OLD_INTRO_EN = "Both are digital tokens that follow the price of the same company's stock. Whichever you buy is the one you own; they do not convert into each other."
    const OLD_FOOT_EN = 'Neither is a share of stock; both are tokens that follow it. You see the current price on the buy screen.'
    const label = (out) => out.match(/aria-label="([^"]*)"/)[1]
    const title = (out) => text(out.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1])
    const noOld = (out) => {
        expect(out).not.toContain(OLD_TITLE_EN)
        expect(out).not.toContain('Both are digital tokens')
        expect(out).not.toContain('Neither is a share')
    }

    it('BSC GME (bstocks + ondo): genel baslik, giris, dipnot ve dialog aria-label; eski metinler YOK', async () => {
        const out = await sheet({ issuers: ['bstocks', 'ondo'], lcxNetworks: { ondo: 'BNB Smart Chain' } })
        expect(title(out)).toBe(TITLE_EN)
        expect(label(out)).toBe(TITLE_EN)
        expect(text(out)).toContain(INTRO_EN)
        expect(text(out)).toContain(FOOT_EN)
        noOld(out)
    })

    it('Ethereum TSLA (xstocks + coinbase, bStocks yok): genel metinler', async () => {
        const out = await sheet({ issuers: ['xstocks', 'coinbase'], networks: 'Ethereum, BNB Smart Chain', lcxNetworks: { coinbase: 'Ethereum, Base' } })
        expect(title(out)).toBe(TITLE_EN)
        expect(label(out)).toBe(TITLE_EN)
        expect(text(out)).toContain(INTRO_EN)
        expect(text(out)).toContain(FOOT_EN)
        noOld(out)
    })

    it('uc ve dort sutun (bstocks + xstocks + ondo / + robinhood), tek LCX sutunu ve miras adli ihracci: genel metinler', async () => {
        for (const issuers of [['bstocks', 'xstocks', 'ondo'], ['bstocks', 'xstocks', 'ondo', 'robinhood'], ['ondo'], ['bstocks', 'constructor']]) {
            const out = await sheet({ issuers, networks: 'Ethereum', lcxNetworks: {} })
            expect(title(out), issuers.join()).toBe(TITLE_EN)
            expect(label(out), issuers.join()).toBe(TITLE_EN)
            expect(text(out), issuers.join()).toContain(INTRO_EN)
            noOld(out)
        }
    })

    it('saf bstocks + xstocks (varsayilan ve acik): ESKI baslik, giris, dipnot ve aria-label AYNEN; genel metin YOK', async () => {
        for (const props of [{ networks: 'Ethereum' }, { issuers: ['bstocks', 'xstocks'], networks: 'Ethereum' }, { issuers: ['xstocks', 'bstocks'], networks: 'Ethereum' }]) {
            const out = await sheet(props)
            expect(title(out)).toBe(OLD_TITLE_EN)
            expect(label(out)).toBe(OLD_TITLE_EN)
            expect(text(out)).toContain(OLD_INTRO_EN)
            expect(text(out)).toContain(OLD_FOOT_EN)
            expect(out).not.toContain(TITLE_EN)
            expect(out).not.toContain('Each is a digital token')
            expect(out).not.toContain('None of them')
        }
    })

    it('tr: genel baslik, giris, dipnot ve aria-label; saf bstocks + xstocks eski metinde', async () => {
        const out = await sheet({ issuers: ['bstocks', 'ondo'], lcxNetworks: { ondo: 'BNB Smart Chain' } }, 'tr')
        expect(title(out)).toBe('Seçenekler arasındaki farklar')
        expect(label(out)).toBe('Seçenekler arasındaki farklar')
        expect(text(out)).toContain('Her seçenek aynı şirketin hisse fiyatını takip eden dijital bir token. Hangisini alırsan o token senin olur; birbirine dönüşmez.')
        expect(text(out)).toContain('Hiçbiri hisse senedi değildir; hisseyi takip eden tokendir. Güncel fiyatı alım ekranında görürsün.')
        expect(out).not.toContain('bStocks ve xStocks')
        const old = await sheet({ networks: 'Ethereum' }, 'tr')
        expect(title(old)).toBe('bStocks ve xStocks')
        expect(label(old)).toBe('bStocks ve xStocks')
        expect(text(old)).toContain('İkisi de aynı şirketin hisse fiyatını takip eden dijital tokenler.')
        expect(text(old)).toContain('İkisi de hisse senedi değildir; hisseyi takip eden tokendir.')
    })

    it('kaynak: baslik, giris, dipnot ve aria-label ayni kosuldan (kume LCX ihraccisi iceriyor mu); eski anahtarlar kosulun diger kolu', () => {
        const src = read('./IssuerInfoSheet.vue')
        for (const k of ['title', 'intro', 'footnote']) {
            expect(src).toContain(`stockIssuer.diff.${k}Generic`)
            expect(src).toContain(`stockIssuer.diff.${k}'`)
        }
        expect(src).toContain('issuers.some(isLcxIssuer)')
        expect(src).not.toMatch(/\$t\('stockIssuer\.diff\.(title|intro|footnote)'\)/)
        expect(src).toMatch(/:aria-label="\$t\(titleKey\)"/)
    })
})

// ---- IssuerSwitch entegrasyonu: pencere secenek listesinden kurulur ---------------------------------------------------------------
describe('IssuerSwitch.vue -> IssuerInfoSheet: sutunlar secenek listesinden (test 5)', () => {
    const lcxRaw = (over) => ({
        category: 'stocks', priceSource: 'Chainlink', priceUpdatedAt: 1795071867, marketHours: 'us_equities', depthUsd: 1000, decimals: 18, priceUsd: 100, ...over,
    })
    const GMEON = lcxRaw({ chainId: 56, address: '0xdABb9afF4cf02f26D2014e4cA9f94aC6fe6572a3', symbol: 'GMEON', issuer: 'ondo', underlying: 'GME', name: 'GameStop (Ondo)' })
    const TSLAC_BASE = lcxRaw({ chainId: 8453, address: '0xb2000000000000000000001e800a7f5189430cD0', symbol: 'TSLAC', issuer: 'coinbase', underlying: 'TSLA', decimals: 8, name: 'Tesla (Coinbase)' })
    const TSLAC_ETH = lcxRaw({ chainId: 1, address: '0xb2000000000000000000001e800a7f5189430cD1', symbol: 'TSLAC', issuer: 'coinbase', underlying: 'TSLA', decimals: 8, name: 'Tesla (Coinbase) ETH' })
    const ON = { xstocksEnabled: true, lcxEnabled: true }

    afterEach(() => _resetLcxStockRows())

    async function open(rows, current, selected, locale = 'en') {
        setLcxStockRows(rows, { usEquitiesOpen: true })
        const options = issuerOptions(stockEntry(current.chainId, current.address), ON)
        const app = createApp(IssuerSwitch, { props: { options, selected }, use: [createTestI18n(locale)] })
        captureInstance(app, 'IssuerSwitch', (inst) => { inst.setupState.infoOpen = true })
        return { out: clean(await render(app)), options }
    }

    it('BSC GME: secenekler bStocks + Ondo; pencere yalniz bu iki sutunu cizer, xStocks YOK', async () => {
        const { out, options } = await open([GMEON], GMEON, 'ondo')
        expect(options.map((o) => o.issuer)).toEqual(['bstocks', 'ondo'])
        expect(out).toContain('data-issuer-info')
        expect(cards(out)).toEqual(['bstocks', 'ondo'])
        expect(out).not.toContain('data-issuer-card="xstocks"')
        expect(card(out, 'ondo')).toContain('data-selected="true"')
    })

    it('LCX "network" hucresi katalogdaki ag adlarindan: Ondo yalniz BSC -> "Only BNB Smart Chain"', async () => {
        const { out } = await open([GMEON], GMEON, 'ondo')
        expect(text(card(out, 'ondo'))).toContain('Only BNB Smart Chain')
        expect(text(card(out, 'ondo'))).toContain(HOW_EN)
        expect(text(card(out, 'ondo'))).toContain(CLOSED_EN)
    })

    it('Coinbase iki agda (Ethereum + Base): hucre katalogdaki IKI ag adini sirayla listeler (Ethereum TSLA: xStocks + Coinbase)', async () => {
        const { out, options } = await open([TSLAC_ETH, TSLAC_BASE], TSLAC_ETH, 'coinbase')
        expect(options.map((o) => o.issuer)).toEqual(['xstocks', 'coinbase'])
        expect(cards(out)).toEqual(['xstocks', 'coinbase'])
        expect(text(card(out, 'coinbase'))).toContain('Ethereum, Base')
        // xStocks sutunu mevcut davranisi korur (bu sirketin xStocks aglari)
        expect(text(card(out, 'xstocks'))).toContain('Ethereum, BNB Smart Chain')
    })

    it('pencere kapaliyken DOM te yok; baglanti bStocks + Ondo ile cizilir (Gorev 10 testiyle uyumlu)', async () => {
        setLcxStockRows([GMEON], { usEquitiesOpen: true })
        const options = issuerOptions(stockEntry(56, GMEON.address), ON)
        const out = clean(await render(createApp(IssuerSwitch, { props: { options, selected: 'bstocks' }, use: [createTestI18n('en')] })))
        expect(out).toContain('data-issuer-diff-link')
        expect(out).not.toContain('data-issuer-info')
    })

    it('IssuerSwitch ihracci logosu: LCX ihraccisi harf rozeti (O), bStocks <img>; hicbirinde bozuk <img> yok', async () => {
        setLcxStockRows([GMEON], { usEquitiesOpen: true })
        const options = issuerOptions(stockEntry(56, GMEON.address), ON)
        const out = clean(await render(createApp(IssuerSwitch, { props: { options, selected: 'ondo' }, use: [createTestI18n('en')] })))
        expect([...out.matchAll(/<img[^>]*data-issuer-logo="([^"]+)"/g)].map((m) => m[1])).toEqual(['bstocks'])
        const badge = out.match(/<span[^>]*data-issuer-logo="ondo"[^>]*>([^<]*)<\/span>/)
        expect(badge).not.toBeNull()
        expect(badge[1]).toBe('O')
    })

    it('pencere secenek listesinden acilinca genel baslik / aria-label: BSC GME (bstocks + ondo) ve Ethereum TSLA (xstocks + coinbase); saf iki sutun eski baslik (R10)', async () => {
        const gme = await open([GMEON], GMEON, 'ondo')
        expect(text(gme.out.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1])).toBe('How the options differ')
        expect(gme.out).toContain('aria-label="How the options differ"')
        expect(gme.out).not.toContain('bStocks and xStocks')
        const eth = await open([TSLAC_ETH, TSLAC_BASE], TSLAC_ETH, 'coinbase')
        expect(text(eth.out.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1])).toBe('How the options differ')
        expect(eth.out).toContain('aria-label="How the options differ"')
        expect(text(eth.out)).toContain('None of them is a share of stock')
        // LCX satiri olmayan saf bStocks + xStocks (statik TSLA, LCX katmani bos): eski baslik, giris ve dipnot
        const bstock = companyRows('TSLA', { xstocksEnabled: true, lcxEnabled: false }).find((r) => r.issuer === 'bstocks')
        const pure = await open([], bstock, 'bstocks')
        expect(pure.options.map((o) => o.issuer)).toEqual(['bstocks', 'xstocks'])
        expect(text(pure.out.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1])).toBe('bStocks and xStocks')
        expect(pure.out).toContain('aria-label="bStocks and xStocks"')
        expect(text(pure.out)).toContain('Both are digital tokens')
        expect(text(pure.out)).toContain('Neither is a share of stock')
        expect(pure.out).not.toContain('How the options differ')
    })

    it('Gorev 10 el birakmasi: IssuerSwitch te gecici LOGO_ISSUERS korumasi KALKTI', () => {
        expect(read('./IssuerSwitch.vue')).not.toContain('LOGO_ISSUERS')
    })
})
