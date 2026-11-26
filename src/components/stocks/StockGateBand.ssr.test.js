// StockGateBand.vue (Ilk Alim Kapisi, Task 19; K32 sonrasi Task 41): Swap / Kopru / StockTrade'de tek kilit-hatirlatma bandi.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. test-utils/ssrRender.js KULLANIM notu).
//
// KOK NEDEN / KAPATILAN HATA: bant yalniz AYNADIR; kullaniciya ne gosterdigi hukuki sinirlari tasir:
//  - ihtiyat-yalniz nedenlerde "ihracci yasakliyor" denmez; bStocks dondurma notu YALNIZ bStocks + ihraccinin kendi
//    listesi nedeninde (IP_COUNTRY_ISSUER) cikar (xStocks icin kaynaksiz iddia olurdu);
//  - kume disi / bozuk neden ekrana HAM KOD olarak cikmaz (CHECK_FAILED), yer tutucular bos kalmaz;
//  - hisse olmayan cikti (idle) ekrani DEGISTIRMEZ; bant hicbir eylem dugmesi tasimaz ve sayfa degistirmez (beyan yok, K32);
//  - ulke bilinmiyorsa (COUNTRY_UNKNOWN) bant AMBER "yeniden denenecek" der, rose "engelli" demez.
// Olu nedenler (US_PERSON, TEXT_UPDATE_REQUIRED, ...) icin hicbir uretici kalmadi: senaryolar canli nedenlerle kurulur.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { butonlar, yorumsuzHtml } from '../../test-utils/ssrHtmlYardimcilari.js'
import { pageStore } from '../../store/pageStore'
import { STOCK_GATE_REASONS } from '../../utils/stockGate/errors'
import { countryLabel } from '../../utils/stockGate/countryLabel'
import { BUNDLED_ELIGIBILITY_RULES } from '../../data/eligibilityRules'
import StockGateBand from './StockGateBand.vue'

const KAYNAK = readFileSync(fileURLToPath(new URL('./StockGateBand.vue', import.meta.url)), 'utf8')
const ISSUERS = ['bstocks', 'xstocks']
const LOCALES = ['tr', 'en']
// Karar fonksiyonunun GERCEKTEN urettigi kilit nedenleri (decide.js): geri kalan 10 ad yalniz eski tuketiciler icin kumede durur (PE12).
const CANLI_NEDENLER = ['KILL_SWITCH', 'IP_COUNTRY_ISSUER', 'IP_COUNTRY_PRECAUTION', 'COUNTRY_UNKNOWN']

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const text = (html) => decode(yorumsuzHtml(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

const G = (over = {}) => ({ state: 'ok', reason: null, ipCountry: 'DE', ...over })
const BLOCK = (reason, over = {}) => G({ state: 'blocked', reason, ...over })

async function ciz(gate, { issuer = 'bstocks', locale = 'tr', openable } = {}) {
    const pinia = createTestPinia()
    const props = { gate, issuer }
    if (openable !== undefined) props.openable = openable
    const app = createApp(StockGateBand, { props, use: [pinia, createTestI18n(locale)] })
    // SSR ciktisi sablon yorumlarini tasir (icinde veri kanca adlari var): iddialardan ONCE atilir (G3)
    return yorumsuzHtml(await render(app))
}

const t = (locale, key, params) => createTestI18n(locale).global.t(key, params)

afterEach(() => { delete globalThis.chrome })

describe('idle ve gecersiz ihracci: bant YOK (bugunku ekran aynen kalir)', () => {
    it('idle durumunda hicbir sey cizilmez', async () => {
        const html = await ciz(G({ state: 'idle' }))
        expect(yorumsuzHtml(html)).toBe('')
        expect(html).not.toContain('data-stock-gate')
    })

    // isValidIssuer yalniz BICIM kontrolu (Bolum 2): bicimi gecersiz ad ('Dogecoin') cizilmez. Bicimi gecerli ama adi / metni
    // olmayan ihracci ('dogecoin') bant cizer ve ham anahtar degil bas harfi buyuk kimlikle gosterilir (asagidaki Bolum 2 describe).
    it('issuer null ya da bicimi gecersizse durum ne olursa olsun cizilmez', async () => {
        for (const issuer of [null, 'Dogecoin', '__proto__']) {
            for (const state of ['ok', 'blocked', 'error']) {
                const html = await ciz(G({ state, reason: 'IP_COUNTRY_ISSUER' }), { issuer })
                expect(yorumsuzHtml(html), `${issuer}/${state}`).toBe('')
            }
        }
    })
})

describe('checking / ok / warn', () => {
    it('checking: kontrol ediliyor satiri iki dilde', async () => {
        const tr = await ciz(G({ state: 'checking' }), { locale: 'tr' })
        const en = await ciz(G({ state: 'checking' }), { locale: 'en' })
        expect(tr).toContain('data-stock-gate="checking"')
        expect(text(tr)).toBe('Kontrol ediliyor')
        expect(text(en)).toBe('Checking')
    })

    it.each(ISSUERS)('StockGateBand: ok (%s): tek satir hatirlatma, uyari ve kilit alanlari YOK', async (issuer) => {
        for (const locale of LOCALES) {
            const html = await ciz(G(), { issuer, locale })
            expect(html).toContain('data-stock-gate="ok"')
            expect(html).toContain('data-stock-gate-reminder')
            expect(text(html)).toBe(t(locale, `stockGate.reminder.${issuer}`))
            expect(html).not.toContain('data-stock-gate-warn')
            expect(html).not.toContain('data-stock-gate-reason')
            expect(html).not.toContain('data-stock-gate-action')
            expect(butonlar(html)).toEqual([])
        }
    })

    // K43 (2026-11-14, sahip karari): UYGUN ihracci icin ulke uyumluluk uyarisi YOK. `warn` durumu (eski ya da onbellekteki, uyari
    // listesi dolu bir kural tablosundan gelebilir) `ok` ile AYNI cizilir: yalniz kisa urun hatirlatmasi, ek uyari satiri yok.
    // Kilit bantlari (blocked / error) bu degisiklikten ETKILENMEZ (asagidaki describe pozitif kontrolu).
    it('StockGateBand K43: warn (xstocks, TR) ulke uyarisi CIZMEZ, yalniz urun hatirlatmasi; ok ile ayni gorunum', async () => {
        for (const locale of LOCALES) {
            const html = await ciz(G({ state: 'warn', ipCountry: 'TR' }), { issuer: 'xstocks', locale })
            expect(html).toContain('data-stock-gate="warn"')
            expect(html).toContain('data-stock-gate-reminder')
            expect(html).not.toContain('data-stock-gate-warn')
            expect(text(html)).toBe(t(locale, 'stockGate.reminder.xstocks'))
            expect(html).not.toContain('text-amber-700')
            expect(html).not.toContain('border-amber-300')
            expect(html).not.toContain('<input')
            expect(html).not.toContain('type="checkbox"')
            expect(text(html)).not.toMatch(/yerel mevzuat|local law|stockGate.warn/i)
            // ok ile birebir ayni cizim (yalniz durum niteligi farkli)
            const ok = await ciz(G({ state: 'ok', ipCountry: 'TR' }), { issuer: 'xstocks', locale })
            expect(html.replace('data-stock-gate="warn"', 'data-stock-gate="ok"')).toBe(ok)
        }
    })

    it('StockGateBand K43: warn her ulke kodunda (DE, bozuk, yok) ve her ihraccida ek uyari satiri cizmez, ham anahtar yolu cikmaz', async () => {
        for (const locale of LOCALES) {
            for (const issuer of ISSUERS) {
                for (const ipCountry of ['DE', 'tr', null, undefined, 12]) {
                    const html = await ciz(G({ state: 'warn', ipCountry }), { issuer, locale })
                    expect(html, `${issuer}/${locale}/${String(ipCountry)}`).not.toContain('data-stock-gate-warn')
                    expect(text(html), String(ipCountry)).toBe(t(locale, `stockGate.reminder.${issuer}`))
                    expect(text(html)).not.toContain('stockGate.warn')
                }
            }
        }
    })

    it('StockGateBand K43 pozitif kontrol: kilit (blocked) bandi uyari kaldirilinca da degismez (IP_COUNTRY_ISSUER, TR, bstocks)', async () => {
        for (const locale of LOCALES) {
            const html = await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }), { issuer: 'bstocks', locale })
            expect(html).toContain('data-stock-gate="blocked"')
            expect(html).toContain('data-stock-gate-reason="IP_COUNTRY_ISSUER"')
            expect(text(html)).toContain(t(locale, 'stockGate.lock.IP_COUNTRY_ISSUER', {
                issuer: t(locale, 'stockGate.issuerName.bstocks'),
                country: countryLabel('TR', locale),
            }))
        }
    })
})

describe('blocked / error: HER canli neden icin metin', () => {
    // Canli kilit nedenleri iki dilde, iki ihraccida: metin gorunur, yer tutucu KALMAZ, ham anahtar yolu cikmaz.
    it.each(CANLI_NEDENLER)('%s: kilit metni gorunur (tr + en, iki ihracci)', async (neden) => {
        for (const locale of LOCALES) {
            for (const issuer of ISSUERS) {
                const html = await ciz(BLOCK(neden, { ipCountry: 'IR' }), { issuer, locale })
                const beklenen = t(locale, `stockGate.lock.${neden}`, {
                    issuer: t(locale, `stockGate.issuerName.${issuer}`),
                    country: countryLabel('IR', locale),
                })
                expect(text(html), `${neden}/${issuer}/${locale}`).toContain(beklenen)
                expect(text(html)).not.toMatch(/\{(country|issuer|declared|ip)\}/)
                expect(text(html)).not.toContain('stockGate.')
                expect(html).toContain('data-stock-gate="blocked"')
                expect(html).toContain(`data-stock-gate-reason="${neden}"`)
            }
        }
    })

    it('StockGateBand: COUNTRY_UNKNOWN amber ton ve stockGate.lock.COUNTRY_UNKNOWN metni', async () => {
        for (const locale of LOCALES) {
            const html = await ciz(BLOCK('COUNTRY_UNKNOWN', { ipCountry: null }), { locale })
            expect(html).toContain('data-stock-gate-reason="COUNTRY_UNKNOWN"')
            expect(text(html)).toBe(t(locale, 'stockGate.lock.COUNTRY_UNKNOWN'))
            expect(html).toContain('border-amber-300')
            expect(html).toContain('bg-amber-50')
            expect(html).toContain('text-amber-800')
            expect(html).not.toContain('border-rose-300')
            expect(html).not.toContain('text-rose-800')
            expect(html).toContain('role="status"')
            expect(html).not.toContain('role="alert"')
        }
    })

    it('rose ton (alert) YALNIZ COUNTRY_UNKNOWN disindaki kilitlerde ve hatada; ok / warn / checking notr', async () => {
        for (const neden of STOCK_GATE_REASONS.filter((n) => n !== 'COUNTRY_UNKNOWN')) {
            const html = await ciz(BLOCK(neden))
            expect(html, neden).toContain('border-rose-300')
            expect(html, neden).toContain('role="alert"')
            expect(html, neden).not.toContain('border-amber-300')
        }
        const hata = await ciz(G({ state: 'error', reason: null }))
        expect(hata).toContain('border-rose-300')
        expect(hata).toContain('role="alert"')
        for (const state of ['ok', 'warn', 'checking']) {
            const html = await ciz(G({ state }))
            expect(html, state).toContain('border-slate-200')
            expect(html, state).not.toContain('border-rose-300')
            expect(html, state).not.toContain('border-amber-300')
        }
    })

    it('ihracci nedeninde hukuki ihracci adi (BTech Holdings / Backed Assets) gorunur; ihtiyat nedeninde ADI GECMEZ', async () => {
        const adi = { bstocks: 'BTech Holdings', xstocks: 'Backed Assets' }
        for (const issuer of ISSUERS) {
            expect(text(await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'KP' }), { issuer, locale: 'en' })), `${issuer}/IP_COUNTRY_ISSUER`).toContain(adi[issuer])
            const metin = text(await ciz(BLOCK('IP_COUNTRY_PRECAUTION', { ipCountry: 'DE' }), { issuer, locale: 'en' }))
            expect(metin, `${issuer}/IP_COUNTRY_PRECAUTION`).not.toContain(adi.bstocks)
            expect(metin).not.toContain(adi.xstocks)
            expect(metin).toContain('not an issuer ban')
        }
    })

    it('StockGateBand: data-stock-gate-action ve data-stock-gate-reset-hint DOM\'da yok (hicbir durum x neden x ihracci x dil)', async () => {
        for (const issuer of ISSUERS) {
            for (const locale of LOCALES) {
                const durumlar = [
                    ...STOCK_GATE_REASONS.map((neden) => BLOCK(neden, { ipCountry: 'KP' })),
                    G({ state: 'error', reason: 'CHECK_FAILED' }), G({ state: 'checking' }), G({ state: 'ok' }), G({ state: 'warn', ipCountry: 'TR' }),
                ]
                for (const gate of durumlar) {
                    const html = await ciz(gate, { issuer, locale })
                    const ad = `${issuer}/${locale}/${gate.state}/${gate.reason}`
                    expect(html, ad).not.toContain('data-stock-gate-action')
                    expect(html, ad).not.toContain('data-stock-gate-reset-hint')
                    expect(butonlar(html), ad).toEqual([])
                }
            }
        }
    })

    it('error durumu CHECK_FAILED kilidi gosterir (gate.reason ne olursa olsun)', async () => {
        for (const reason of [null, 'IP_COUNTRY_ISSUER', 'bogus']) {
            const html = await ciz(G({ state: 'error', reason }), { locale: 'tr' })
            expect(html).toContain('data-stock-gate="error"')
            expect(html).toContain('data-stock-gate-reason="CHECK_FAILED"')
            expect(text(html)).toBe(t('tr', 'stockGate.lock.CHECK_FAILED'))
        }
    })

    it('kume disi neden ham kod olarak CIKMAZ (CHECK_FAILED)', async () => {
        for (const reason of ['RULES_INVALID', 'ISSUER_UNKNOWN', 'bogus', undefined, null, 42, '__proto__']) {
            const html = await ciz(BLOCK(reason))
            expect(html, String(reason)).toContain('data-stock-gate-reason="CHECK_FAILED"')
            expect(text(html), String(reason)).toContain(t('tr', 'stockGate.lock.CHECK_FAILED'))
            expect(text(html)).not.toContain('RULES_INVALID')
        }
    })

    it('ulke kodu eksikken bile cokmez ve yer tutucu "?" olur', async () => {
        const html = await ciz(BLOCK('IP_COUNTRY_PRECAUTION', { ipCountry: null }), { locale: 'en' })
        expect(text(html)).toContain(t('en', 'stockGate.lock.IP_COUNTRY_PRECAUTION', { country: '?' }))
        expect(text(html)).not.toMatch(/\{(country|issuer)\}/)
    })
})

// Bolum 2: tabloya yeni ihraccilar (ondo, coinbase, robinhood, st0x) girdi. Bantin ihracci adi yer tutucusu `stockGate.issuerName.<id>`
// metninden gelir; adi olmayan (tabloda olmayan ya da yeni eklenmis) bicimi gecerli ihracci icin HAM ANAHTAR degil bas harfi buyuk
// kimlik gorunur. Kalici hatirlatma metni yalniz kartli ihraccilarda (bstocks, xstocks) vardir: baska ihraccida ok / warn bandi
// ham `stockGate.reminder.<id>` anahtarini gostermemek icin CIZILMEZ (kilit ve hata bantlari tum ihraccilarda cizilir).
describe('Bolum 2: yeni ve bilinmeyen ihraccilar', () => {
    const TABLO_IHRACCILARI = Object.keys(BUNDLED_ELIGIBILITY_RULES.issuers)
    const YENILER = TABLO_IHRACCILARI.filter((i) => !ISSUERS.includes(i))
    const BILINMEYEN = [['foo', 'Foo'], ['dogecoin', 'Dogecoin'], ['constructor', 'Constructor'], ['a1-b', 'A1-b']]

    it('pozitif bekci: tablo alti ihracci tasir, yenileri ondo / coinbase / robinhood / st0x', () => {
        expect(TABLO_IHRACCILARI).toHaveLength(6)
        expect([...YENILER].sort()).toEqual(['coinbase', 'ondo', 'robinhood', 'st0x'])
    })

    it.each(TABLO_IHRACCILARI)('%s: IP_COUNTRY_ISSUER kilidi stockGate.issuerName.<ihracci> metnini kullanir (tr + en), ham anahtar ve yer tutucu yok', async (issuer) => {
        for (const locale of LOCALES) {
            const html = await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'KP' }), { issuer, locale })
            const ad = t(locale, `stockGate.issuerName.${issuer}`)
            expect(ad, 'pozitif bekci: ad ceviri anahtarindan gelir, ham anahtar degil').not.toContain('stockGate.')
            expect(text(html), `${issuer}/${locale}`).toContain(t(locale, 'stockGate.lock.IP_COUNTRY_ISSUER', { issuer: ad, country: countryLabel('KP', locale) }))
            expect(text(html)).not.toContain('stockGate.')
            expect(text(html)).not.toMatch(/\{(country|issuer)\}/)
            expect(html).toContain('data-stock-gate="blocked"')
        }
    })

    it('yeni ihracci adlari marka adidir ve ayni gorunur: Ondo, Coinbase, Robinhood, st0x (kucuk harfli, bas harfi buyutulmez)', async () => {
        const beklenen = { ondo: 'Ondo', coinbase: 'Coinbase', robinhood: 'Robinhood', st0x: 'st0x' }
        for (const [issuer, ad] of Object.entries(beklenen)) {
            const metin = text(await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'KP' }), { issuer, locale: 'en' }))
            expect(metin, issuer).toContain(`The product's issuer (${ad})`)
        }
    })

    it.each(BILINMEYEN)("adi olmayan ihracci (%s): ham anahtar degil bas harfi buyuk kimlik ('%s'); kilit ve hata bantlari cizilir", async (issuer, gorunen) => {
        for (const locale of LOCALES) {
            const html = await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'KP' }), { issuer, locale })
            expect(html, issuer).toContain('data-stock-gate="blocked"')
            expect(text(html)).toContain(t(locale, 'stockGate.lock.IP_COUNTRY_ISSUER', { issuer: gorunen, country: countryLabel('KP', locale) }))
            expect(text(html)).not.toContain('stockGate.')
            expect(text(html)).not.toContain('function')
            expect(text(html)).not.toContain('[object')
            const hata = await ciz(G({ state: 'error', reason: null }), { issuer, locale })
            expect(hata).toContain('data-stock-gate-reason="CHECK_FAILED"')
            expect(text(hata)).toBe(t(locale, 'stockGate.lock.CHECK_FAILED'))
        }
    })

    it.each([...YENILER, 'foo', 'constructor'])('%s: ok / warn bandi CIZILMEZ (kalici hatirlatma metni yok, ham stockGate.reminder anahtari cikmaz); idle de bos', async (issuer) => {
        for (const state of ['ok', 'warn', 'idle']) {
            for (const openable of [false, true]) {
                const html = await ciz(G({ state, ipCountry: 'TR' }), { issuer, openable })
                expect(yorumsuzHtml(html), `${issuer}/${state}/${openable}`).toBe('')
            }
        }
    })

    it.each([...YENILER, 'foo'])('%s: kontrol ediliyor (checking) iskeleti cizilir; dondurma notu yalniz bstocks icin (IP_COUNTRY_ISSUER da olsa yok)', async (issuer) => {
        for (const locale of LOCALES) {
            const html = await ciz(G({ state: 'checking' }), { issuer, locale })
            expect(html).toContain('data-stock-gate="checking"')
            expect(text(html)).toBe(locale === 'tr' ? 'Kontrol ediliyor' : 'Checking')
        }
        const kilit = await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'KP' }), { issuer })
        expect(kilit).not.toContain('data-stock-gate-freeze-note')
    })

    it('bicimi gecersiz ihracci hala cizilmez (Dogecoin, BSTOCKS, __proto__): ad sorgusuna girmez', async () => {
        for (const issuer of ['Dogecoin', 'BSTOCKS', '__proto__', '']) {
            expect(yorumsuzHtml(await ciz(BLOCK('IP_COUNTRY_ISSUER'), { issuer })), issuer).toBe('')
        }
    })
})

describe('K22 dondurma notu: kapsam matrisi', () => {
    it('StockGateBand: dondurma notu YALNIZ bstocks + IP_COUNTRY_ISSUER (tum neden x ihracci x dil; xstocks + ayni neden ve bstocks + IP_COUNTRY_PRECAUTION / KILL_SWITCH / COUNTRY_UNKNOWN icin YOK)', async () => {
        for (const issuer of ISSUERS) {
            for (const neden of STOCK_GATE_REASONS) {
                for (const locale of LOCALES) {
                    const html = await ciz(BLOCK(neden, { ipCountry: 'KP' }), { issuer, locale })
                    const beklenen = issuer === 'bstocks' && neden === 'IP_COUNTRY_ISSUER'
                    expect(html.includes('data-stock-gate-freeze-note'), `${issuer}/${neden}/${locale}`).toBe(beklenen)
                    if (beklenen) expect(text(html)).toContain(t(locale, 'stockGate.band.freezeNote.bstocks'))
                    else expect(text(html)).not.toContain(t(locale, 'stockGate.band.freezeNote.bstocks'))
                }
            }
        }
    })

    it('dondurma notu kilit metninin ALTINDA gelir', async () => {
        const html = await ciz(BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }), { issuer: 'bstocks' })
        expect(html.indexOf('data-stock-gate-freeze-note')).toBeGreaterThan(html.indexOf('data-stock-gate-reason'))
    })

    it('kilit olmayan durumlarda (ok, warn, checking) dondurma notu YOK', async () => {
        for (const state of ['ok', 'warn', 'checking']) {
            const html = await ciz(G({ state, reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' }), { issuer: 'bstocks' })
            expect(html, state).not.toContain('data-stock-gate-freeze-note')
        }
    })
})

describe('bant tiklamada hicbir sey yapmaz (beyan yok, K32)', () => {
    it('render currentPage i ve sayfa verisini DEGISTIRMEZ; bantta tiklanabilir oge (buton) YOK', async () => {
        const pinia = createTestPinia()
        const app = createApp(StockGateBand, {
            props: { gate: BLOCK('IP_COUNTRY_ISSUER', { ipCountry: 'TR' }), issuer: 'xstocks' },
            use: [pinia, createTestI18n('tr')],
        })
        const html = yorumsuzHtml(await render(app))
        expect(butonlar(html)).toEqual([])
        expect(html).not.toContain('@click')
        expect(html).not.toContain('onclick')
        expect(pageStore().currentPage).toBe('')
        expect(pageStore().data).toBeNull()
    })
})

describe('kaynak kilitleri (yorumsuz tarama)', () => {
    const kod = yorumsuz(KAYNAK)

    it('pozitif bekci: tarama gercek kodu goruyor', () => {
        expect(kod).toContain('data-stock-gate-freeze-note')
        expect(kod).toContain('COUNTRY_UNKNOWN')
    })

    it('beyan / sayfa gecisi izi yok: openGate, returnPage, actionKind, resetHint, goToGate, currentPage, pageStore', () => {
        expect(kod).not.toMatch(/openGate|returnPage|return-page|actionKind|resetHint|RESET_HINT|goToGate|currentPage|pageStore/)
        expect(kod).not.toMatch(/'declare'|DECLARATION_REQUIRED|UPDATE_DECLARATION|UPDATE_EXTENSION|stockGate\.action/)
        // Task 42 (K38): tek istisna = openable iken hatirlatma satirinin kart dugmesi (yalniz open-card olayi yayar)
        expect(kod.split('<button')).toHaveLength(2)
        expect(kod.split('@click')).toHaveLength(2)
        expect(kod).toContain('<button v-if="openable" type="button" data-stock-card-open')
        expect(kod.slice(kod.indexOf('<button'), kod.indexOf('</button>'))).toContain("@click=\"emit('open-card', issuer)\"")
    })

    it('bant yalniz ipCountry okur: country, stale, declared, accountId okunmaz; info tonu yok', () => {
        expect(kod).toContain('props.gate.ipCountry')
        expect(kod).not.toMatch(/gate\.(country|stale|declared|accountId)|\bdeclared\b|\binfo\b/)
    })

    it('bayrak, depo, mesaj, log ve ham HTML yok; bant onay kutusu tasimaz', () => {
        expect(kod).not.toMatch(/featureFlags/)
        expect(kod).not.toMatch(/chrome\./)
        expect(kod).not.toMatch(/console\./)
        expect(kod).not.toMatch(/v-html/)
        expect(kod).not.toMatch(/<input/)
        expect(kod).not.toMatch(/privateKey/)
    })
})

// Task 42 (K38): hatirlatma satiri salt okunur kartin kalici giris dugmesidir -- yalniz `openable` iken, yalniz ok / warn'da.
describe('openable: hatirlatma satiri karti acan dugme (K38)', () => {
    for (const issuer of ISSUERS) {
        it(`band: openable + ok / warn -> hatirlatma dugmesi (${issuer}); metin ayni, kart girisi etiketi eklenir`, async () => {
            for (const state of ['ok', 'warn']) {
                const html = await ciz(G({ state, ipCountry: 'TR' }), { issuer, openable: true })
                const dugmeler = butonlar(html).filter((b) => b.nitelikler.includes('data-stock-card-open'))
                expect(dugmeler, state).toHaveLength(1)
                expect(decode(dugmeler[0].metin)).toContain(t('tr', `stockGate.reminder.${issuer}`))
                expect(decode(dugmeler[0].metin)).toContain(t('tr', 'stockGate.card.open'))
                expect(html).toContain('data-stock-gate-reminder')
            }
        })
    }

    it('band: open-card olayi tiklamada ihracciyla yayilir (kaynak: @click emit open-card issuer)', () => {
        const kod = yorumsuz(KAYNAK)
        expect(kod).toContain(`@click="emit('open-card', issuer)"`)
        expect(kod).toContain("defineEmits(['open-card'])")
        // olay yalniz bir dugmeden yayilir; bant kendi basina sayfa degistirmez ya da mesaj gondermez
        expect(kod.split("emit('open-card'")).toHaveLength(2)
    })

    it('band: openable false (varsayilan) -> duz metin, dugme YOK', async () => {
        for (const openable of [undefined, false]) {
            for (const state of ['ok', 'warn']) {
                const html = await ciz(G({ state, ipCountry: 'TR' }), { openable })
                expect(html, `${openable}/${state}`).toContain('data-stock-gate-reminder')
                expect(html).not.toContain('data-stock-card-open')
                expect(butonlar(html)).toHaveLength(0)
                expect(text(html)).not.toContain(t('tr', 'stockGate.card.open'))
            }
        }
    })

    it('band: openable true iken blocked / error / checking / idle -> dugme YOK', async () => {
        const durumlar = [G({ state: 'checking' }), G({ state: 'idle' }), G({ state: 'error' }), ...CANLI_NEDENLER.map((n) => BLOCK(n))]
        for (const gate of durumlar) {
            const html = await ciz(gate, { openable: true })
            expect(html, `${gate.state}/${gate.reason}`).not.toContain('data-stock-card-open')
            expect(butonlar(html)).toHaveLength(0)
        }
        // pozitif bekci: ayni girdiyle ok durumunda dugme VAR
        expect(await ciz(G(), { openable: true })).toContain('data-stock-card-open')
    })

    it('band: openable iki dilde de cizilir (tr, en)', async () => {
        for (const locale of LOCALES) {
            const html = await ciz(G(), { openable: true, locale })
            expect(text(html)).toContain(t(locale, 'stockGate.card.open'))
        }
    })
})
