// IssuerSwitch -- Al/Sat ihracci secici (spec 5.3). Yalniz 2 secenek varken cizilir.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, createTestI18n } from '../../test-utils/ssrRender.js'
import { companyRows } from '../../utils/stocks/stockCompanies'
import IssuerSwitch from './IssuerSwitch.vue'

const rows = (u) => companyRows(u, { xstocksEnabled: true })
const opt = (u, issuer) => ({ issuer, row: rows(u).find((r) => r.issuer === issuer) })
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

async function html(props, locale = 'en') {
    const app = createApp(IssuerSwitch, { props, use: [createTestI18n(locale)] })
    return clean(await render(app))
}

const SRC = readFileSync(fileURLToPath(new URL('./IssuerSwitch.vue', import.meta.url)), 'utf8')

describe('IssuerSwitch.vue -- gorunurluk', () => {
    it('iki secenek -> secici ve iki data-issuer-option', async () => {
        const out = await html({ options: [opt('TSLA', 'bstocks'), opt('TSLA', 'xstocks')], selected: 'bstocks' })
        expect(out).toContain('data-issuer-switch')
        expect(out).toContain('data-issuer-option="bstocks"')
        expect(out).toContain('data-issuer-option="xstocks"')
        expect(out).toContain('bStocks')
        expect(out).toContain('xStocks')
    })

    it('tek secenek -> DOM te hicbir sey yok', async () => {
        const out = await html({ options: [opt('TSLA', 'bstocks')], selected: 'bstocks' })
        expect(out).not.toContain('data-issuer-switch')
        expect(out).not.toContain('data-issuer-option')
        expect(out).not.toContain('xStocks')
    })

    it('bos secenek -> DOM te yok', async () => {
        const out = await html({ options: [], selected: null })
        expect(out).not.toContain('data-issuer-switch')
    })
})

describe('IssuerSwitch.vue -- secim durumu', () => {
    it('secili secenek aria-pressed=true, digeri false', async () => {
        const out = await html({ options: [opt('TSLA', 'bstocks'), opt('TSLA', 'xstocks')], selected: 'xstocks' })
        expect(out).toMatch(/data-issuer-option="xstocks"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-issuer-option="xstocks"/)
        expect(out).toMatch(/data-issuer-option="bstocks"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-issuer-option="bstocks"/)
    })

    it('erisilebilirlik etiketi switchLabel ceviriden gelir', async () => {
        const en = await html({ options: [opt('TSLA', 'bstocks'), opt('TSLA', 'xstocks')], selected: 'bstocks' }, 'en')
        expect(en).toContain('Issuer selection')
        const tr = await html({ options: [opt('TSLA', 'bstocks'), opt('TSLA', 'xstocks')], selected: 'bstocks' }, 'tr')
        expect(tr).toContain('İhraççı seçimi')
    })
})

describe('IssuerSwitch.vue -- ag notu YOK (kullanici karari 2026-10-23)', () => {
    it('zincir farkli olsa da (AAPL: BSC bStock / Ethereum xStock) "agina gecer" notu cizilmez', async () => {
        const out = await html({ options: [opt('AAPL', 'bstocks'), opt('AAPL', 'xstocks')], selected: 'bstocks' })
        expect(out).toContain('data-issuer-switch')
        expect(out).not.toContain('data-issuer-switch-note')
        expect(out).not.toMatch(/switches to the/i)
    })

    it('dugmeler hic kilitlenmez (ag gecisi beklemesi yok)', async () => {
        const out = await html({ options: [opt('AAPL', 'bstocks'), opt('AAPL', 'xstocks')], selected: 'bstocks' })
        const buttons = out.match(/<button[^>]*data-issuer-option[^>]*>/g) ?? []
        expect(buttons).toHaveLength(2)
        for (const b of buttons) expect(b).not.toMatch(/\sdisabled(=|>|\s)/)
    })
})

describe('IssuerSwitch.vue -- kaynak taramasi (SSR te @click gorunmez)', () => {
    it('dugme pick olayini ihracci ile yayar ve yalniz secili olmayan/serbest durumda tiklanir', () => {
        expect(SRC).toMatch(/@click="[^"]*pick/)
        expect(SRC).toMatch(/defineEmits\(\[\s*'pick'\s*\]\)/)
    })

    it('bilesen ag/store/ana is parcacigi mantigi icermez (yalniz sunum)', () => {
        expect(SRC).not.toMatch(/applyNetworkChange|cryptoStore|networkStore|chrome\./)
    })

    it('metinler i18n ten, sabit metin yok', () => {
        expect(SRC).toContain('stockIssuer.')
        expect(SRC).not.toMatch(/>\s*(bStocks|xStocks)\s*</)
    })
})

describe('IssuerSwitch.vue -- aciklama ve Fark ne baglantisi', () => {
    const both = () => [opt('AAPL', 'bstocks'), opt('AAPL', 'xstocks')]

    it('iki secenekte de alt satir, ag adi o secenegin satirindan', async () => {
        const out = await html({ options: both(), selected: 'bstocks' }, 'tr')
        expect(out).toContain('Binance · BNB Smart Chain · havuzdan takas')
        expect(out).toContain('Backed · Ethereum · emirle alım')
        expect(out.match(/data-issuer-option-sub/g) ?? []).toHaveLength(2)
    })

    it('olculmemis sure iddiasi yok (anında / instant) -- ihracci metinleri', () => {
        for (const f of ['tr', 'en']) {
            const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../../i18n/locales/${f}.json`, import.meta.url)), 'utf8'))
            expect(JSON.stringify(j.stockIssuer)).not.toMatch(/(anında|anlık|instant)/i)
        }
    })

    it('Fark ne baglantisi var, pencere kapaliyken DOM de yok, onerilen yok', async () => {
        const tr = await html({ options: both(), selected: 'bstocks' }, 'tr')
        expect(tr).toContain('Fark ne?')
        expect(tr).not.toContain('data-issuer-info')
        expect(tr).not.toMatch(/önerilen/i)
        const en = await html({ options: both(), selected: 'bstocks' }, 'en')
        expect(en).toMatch(/What(&#39;|')s the difference\?/)
        expect(en).not.toMatch(/recommended/i)
    })

    it('tek ihraccida baglanti ve pencere yok', async () => {
        const out = await html({ options: [opt('TSLA', 'bstocks')], selected: 'bstocks' })
        expect(out).not.toContain('data-issuer-diff-link')
        expect(out).not.toContain('data-issuer-info')
    })

    it('tetikleyici: button, aria-expanded=false kapaliyken, aria-controls, ok simgesi doner', async () => {
        const out = await html({ options: both(), selected: 'bstocks' }, 'en')
        const link = out.match(/<button[^>]*data-issuer-diff-link[^>]*>/)[0]
        expect(link).toContain('type="button"')
        expect(link).toContain('aria-expanded="false"')
        expect(link).toContain('aria-controls="issuer-info-sheet"')
        expect(out).toContain('data-issuer-diff-chevron')
        expect(SRC).toMatch(/:aria-expanded="infoOpen \? 'true' : 'false'"/)
        expect(SRC).toMatch(/infoOpen \? 'rotate-180'/)
        expect(SRC).toContain('motion-reduce:transition-none')
        expect(SRC).toMatch(/:selected="selected"/)
    })

    it('kaynakta baglanti pencereyi acar', () => {
        expect(SRC).toMatch(/@click="infoOpen = true"/)
        expect(SRC).toMatch(/@close="infoOpen = false"/)
    })
})

describe('IssuerInfoSheet.vue', () => {
    it('iki mini kart, her birinde uc bilgi satiri, dialog rolu, kapat dugmesi, yasak kelime yok', async () => {
        const mod = (await import('./IssuerInfoSheet.vue')).default
        for (const loc of ['tr', 'en']) {
            const out = clean(await render(createApp(mod, { props: { networks: 'Ethereum' }, use: [createTestI18n(loc)] })))
            expect(out.match(/data-issuer-card="/g) ?? []).toHaveLength(2)
            expect(out.match(/data-issuer-info-row="/g) ?? []).toHaveLength(6)
            expect(out.indexOf('data-issuer-card="bstocks"')).toBeLessThan(out.indexOf('data-issuer-card="xstocks"'))
            expect(out).toContain('role="dialog"')
            expect(out).toContain('data-issuer-info-close')
            expect(out).toContain('Ethereum')
            expect(out).not.toMatch(/CoW|RFQ|AMM|solver|önerilen|recommended/i)
        }
        const src = readFileSync(fileURLToPath(new URL('./IssuerInfoSheet.vue', import.meta.url)), 'utf8')
        expect(src).toMatch(/@click="\$emit\('close'\)"/)
        expect(src).toContain("'Escape'")
    })
})

describe('IssuerInfoSheet.vue -- baslik, etiket, metinler', () => {
    const SHEET = readFileSync(fileURLToPath(new URL('./IssuerInfoSheet.vue', import.meta.url)), 'utf8')
    const sheet = async (networks, loc) => {
        const mod = (await import('./IssuerInfoSheet.vue')).default
        return clean(await render(createApp(mod, { props: { networks }, use: [createTestI18n(loc)] })))
    }

    it('mini kartlar: dar ekranda alt alta, genis ekranda yan yana; baslikta rozet + ihracci adi', async () => {
        const out = await sheet('Ethereum', 'tr')
        const grid = out.match(/<div[^>]*data-issuer-cards[^>]*>/)[0]
        expect(grid).toContain('grid-cols-1')
        expect(grid).toMatch(/min-\[\d+px\]:grid-cols-2/)
        for (const i of ['bstocks', 'xstocks']) {
            const card = out.match(new RegExp(`<div[^>]*data-issuer-card="${i}"[^>]*>`))[0]
            expect(card).toMatch(/rounded-2xl/)
            expect(out).toContain(`data-issuer-badge="${i}"`)
        }
        expect(out).toContain('Binance çıkarır')
        expect(out).toContain('7/24 açık')
        expect(out).toContain('Alım kapalı, satış açık')
    })

    it('tr + en: ortak cumle ve bilgi satirlari iki dilde dolu', async () => {
        const en = await sheet('Ethereum', 'en')
        expect(en).toContain('Both are digital tokens')
        expect(en.match(/data-issuer-info-row="/g)).toHaveLength(6)
        expect(en).toContain('Open 24/7')
    })

    it('secili ihracci vurgulu (data-selected + vurgu sinifi), digeri degil', async () => {
        const mod = (await import('./IssuerInfoSheet.vue')).default
        const r = async (selected) => clean(await render(createApp(mod, { props: { networks: 'Ethereum', selected }, use: [createTestI18n('tr')] })))
        const card = (out, i) => out.match(new RegExp(`<div[^>]*data-issuer-card="${i}"[^>]*>`))[0]
        const x = await r('xstocks')
        expect(card(x, 'xstocks')).toContain('data-selected="true"')
        expect(card(x, 'xstocks')).toContain('ring-indigo')
        expect(card(x, 'bstocks')).toContain('data-selected="false"')
        expect(card(x, 'bstocks')).not.toContain('ring-indigo')
        const b = await r('bstocks')
        expect(card(b, 'bstocks')).toContain('data-selected="true"')
        expect(card(b, 'xstocks')).not.toContain('ring-indigo')
        const none = await r(null)
        expect(none).not.toContain('data-selected="true"')
    })

    it('gecis: Transition sinifi, 200-250 ms, ease, prefers-reduced-motion kapatir', () => {
        expect(SHEET).toMatch(/prefers-reduced-motion:\s*reduce/)
        expect(SHEET).toMatch(/\.issuer-sheet-enter-active[\s\S]*?(2[0-5]0)ms ease/)
        expect(SHEET).toMatch(/transition:\s*none/)
        expect(SHEET).toContain('opacity')
        expect(SHEET).toContain('translateY')
        expect(SRC).toMatch(/<Transition name="issuer-sheet">\s*<IssuerInfoSheet/)
    })

    it('uppercase sinifi yok', () => {
        expect(SHEET).not.toMatch(/uppercase/)
    })

    it('Fark ne? metni sade: kisa cumleler, teknik terim yok, tr+en dolu (2026-10-30)', () => {
        const FORBID = /likidite|liquidity|RFQ|AMM|çözücü|solver|ihraççı|issuer(?!s? )|emir defteri|order book|havuz|pool/i
        const strs = (o) => Object.values(o).flatMap((v) => (typeof v === 'string' ? [v] : strs(v)))
        for (const f of ['tr', 'en']) {
            const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../../i18n/locales/${f}.json`, import.meta.url)), 'utf8'))
            const d = j.stockIssuer.diff
            expect(Object.keys(d.row)).toEqual(['issuer', 'network', 'how', 'closed'])
            expect(d.cell.fee).toBeUndefined()
            expect(d.cell.gets).toBeUndefined()
            for (const t of strs(d)) {
                expect(t.trim()).not.toBe('')
                expect(t).not.toMatch(FORBID)
                for (const sentence of t.split(/[.;:]\s+/)) expect(sentence.trim().split(/\s+/).length).toBeLessThan(15)
            }
        }
    })

    it('xStocks ag hucresi: tek ag -> Yalniz, cok ag -> yalniz liste (on ek yok)', async () => {
        expect(await sheet('Ethereum', 'tr')).toContain('Yalnız Ethereum')
        expect(await sheet('Ethereum', 'en')).toContain('Only Ethereum')
        const multi = await sheet('Ethereum, BNB Smart Chain', 'tr')
        expect(multi).toContain('Ethereum, BNB Smart Chain')
        expect(multi).not.toContain('Hisseye')
        expect(multi).not.toContain('Yalnız Ethereum')
        expect(await sheet('Ethereum, BNB Smart Chain', 'en')).toContain('Ethereum, BNB Smart Chain')
    })
})


describe('Issuer logolari (2026-10-30)', () => {
    const imgs = (out) => [...out.matchAll(/<img[^>]*data-issuer-logo="(\w+)"[^>]*>/g)].map((m) => m[0])
    it('Fark ne? kartlarinda iki logo: dogru src + alt, harf rozeti yok', async () => {
        const mod = (await import('./IssuerInfoSheet.vue')).default
        const out = clean(await render(createApp(mod, { props: { networks: 'Ethereum' }, use: [createTestI18n('tr')] })))
        const l = imgs(out)
        expect(l).toHaveLength(2)
        expect(l.find((t) => t.includes('"bstocks"'))).toMatch(/src="\/images\/issuers\/bstocks\.png"[^>]*alt="bStocks"|alt="bStocks"[^>]*src="\/images\/issuers\/bstocks\.png"/)
        expect(l.find((t) => t.includes('"xstocks"'))).toMatch(/src="\/images\/issuers\/xstocks\.svg"[^>]*alt="xStocks"|alt="xStocks"[^>]*src="\/images\/issuers\/xstocks\.svg"/)
        expect(out).not.toMatch(/>\s*[bx]\s*<\/span>/)
    })
    it('ihracci secicide iki logo ayni src ile', async () => {
        const out = await html({ options: [opt('TSLA', 'bstocks'), opt('TSLA', 'xstocks')], selected: 'bstocks' }, 'tr')
        const l = imgs(out)
        expect(l).toHaveLength(2)
        expect(l.join('')).toContain('/images/issuers/bstocks.png')
        expect(l.join('')).toContain('/images/issuers/xstocks.svg')
    })
    it('logo bileseni v-html / inline svg kullanmaz', () => {
        const src = readFileSync(fileURLToPath(new URL('./IssuerLogo.vue', import.meta.url)), 'utf8')
        expect(src).not.toMatch(/v-html|<svg/)
    })
})

describe('IssuerSwitch.vue -- piyasa kapali: yalniz alim notu, dugme aktif (2026-10-24)', () => {
    const MON = new Date(2026, 9, 26, 3, 0).toISOString()
    const both = () => [opt('TSLA', 'bstocks'), opt('TSLA', 'xstocks')]
    const btn = (out, issuer) => out.match(new RegExp(`<button[^>]*data-issuer-option="${issuer}"[^>]*>`))[0]

    it('hafta sonu: xStocks dugmesi AKTIF + "Hafta sonu alim kapali" (tr)', async () => {
        const out = await html({ options: both(), selected: 'bstocks', lock: { issuer: 'xstocks', kind: 'weekend', nextChangeAt: MON } }, 'tr')
        expect(btn(out, 'xstocks')).not.toContain('aria-disabled')
        expect(btn(out, 'xstocks')).not.toContain('cursor-not-allowed')
        expect(out).toContain('Hafta sonu alım kapalı')
        expect(out).not.toContain('Hafta sonu kapalı')
    })

    it('tatil: "Alim kapali"; en metinleri', async () => {
        const tr = await html({ options: both(), selected: 'bstocks', lock: { issuer: 'xstocks', kind: 'market', nextChangeAt: MON } }, 'tr')
        expect(tr).toContain('Alım kapalı')
        expect(tr).not.toContain('Hafta sonu alım kapalı')
        const en = await html({ options: both(), selected: 'bstocks', lock: { issuer: 'xstocks', kind: 'weekend', nextChangeAt: MON } }, 'en')
        expect(en).toContain('Buying closed on weekends')
        const enM = await html({ options: both(), selected: 'bstocks', lock: { issuer: 'xstocks', kind: 'market', nextChangeAt: MON } }, 'en')
        expect(enM).toContain('Buying closed')
        expect(enM).not.toContain('on weekends')
    })

    it('kilit yok -> not yok, normal alt metin', async () => {
        const out = await html({ options: both(), selected: 'bstocks' }, 'tr')
        expect(out).not.toContain('aria-disabled')
        expect(out).not.toContain('data-issuer-closed')
    })

    it('tiklama kilitliyken de pick yayar (kaynak koruma)', () => {
        expect(SRC).not.toMatch(/function onPick/)
        expect(SRC).not.toContain('isLocked(o)) return')
        expect(SRC).toMatch(/@click="o\.available === false \|\| \$emit\('pick', o\.issuer\)"/)
    })
})

describe('IssuerSwitch.vue -- yalniz ayni ag (kullanici karari 2026-10-28)', () => {
    const pasif = { ...opt('AAPL', 'bstocks'), available: false }
    const aktif = { ...opt('AAPL', 'xstocks'), available: true }
    const lockWeekend = { issuer: 'xstocks', kind: 'weekend', nextChangeAt: null }

    it('available=false secenek aria-disabled + disabled, alt metin en "Not on this network"', async () => {
        const out = await html({ options: [pasif, aktif], selected: 'xstocks' })
        const btn = out.match(/<button[^>]*data-issuer-option="bstocks"[^>]*>/)[0]
        expect(btn).toContain('aria-disabled="true"')
        expect(out).toContain('Not on this network')
    })

    it('tr alt metin "Bu ağda yok"', async () => {
        const out = await html({ options: [pasif, aktif], selected: 'xstocks' }, 'tr')
        expect(out).toContain('Bu ağda yok')
    })

    it('available=true secenek aria-disabled degil', async () => {
        const out = await html({ options: [pasif, aktif], selected: 'xstocks' })
        const btn = out.match(/<button[^>]*data-issuer-option="xstocks"[^>]*>/)[0]
        expect(btn).not.toContain('aria-disabled="true"')
        expect(out).not.toMatch(/data-issuer-option="xstocks"[^>]*>[\s\S]{0,400}Not on this network[\s\S]*data-issuer-diff-link/)
    })

    it('hafta sonu kilidi ile cakisirsa pasiflik nedeni "Bu ag da yok" oncelikli', async () => {
        const x = { ...opt('AAPL', 'xstocks'), available: false }
        const out = await html({ options: [{ ...opt('AAPL', 'bstocks'), available: true }, x], selected: 'bstocks', lock: lockWeekend })
        expect(out).toContain('Not on this network')
        expect(out).not.toContain('Buying closed on weekends')
    })

    it('pasif secenek tiklaninca pick yayilmaz (kaynakta engel)', () => {
        expect(SRC).toMatch(/@click="o\.available === false \|\| \$emit\('pick', o\.issuer\)"/)
    })
})
