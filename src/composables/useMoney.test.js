import { describe, it, expect, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { createApp, createTestI18n, createTestPinia, render } from '../test-utils/ssrRender.js'
import { currencyStore } from '../store/currency'
import { useMoney } from './useMoney'

// Boslukli biciler dilde nbsp (U+00A0) / dar nbsp (U+202F) kullanir: karsilastirma
// oncesi duz bosluga indirilir.
const norm = (s) => (typeof s === 'string' ? s.replace(/[\u00a0\u202f]/g, ' ') : s)

const NOW = Date.now()

// Taze bir kur gorunumu: updatedAt simdi, oran tablosu verilen kadar.
function freshSnapshot(rates) {
    return { rates, currencies: [], updatedAt: NOW, stale: false, fetchedAt: NOW }
}

// useMoney()'yi gercek bir bilesenin setup'inda calistirir (useI18n ve pinia icin gerekli)
// ve donusunu cikarir: testler fonksiyonlari dogrudan cagirip `null` donusleri de
// gorebilsin (render edilen metin null'i "bos" yapar).
// `prepare(store)` render'dan once depoyu kurar. Ayrica render edilen HTML de doner.
async function mountMoney({ locale = 'en', prepare, template } = {}) {
    const pinia = createTestPinia()
    const store = currencyStore()
    prepare?.(store)

    const i18n = createTestI18n(locale)
    let money
    const Comp = defineComponent({
        setup() {
            money = useMoney()
            return () => h('span', template ? template(money) : '')
        },
    })
    const html = await render(createApp(Comp, { use: [pinia, i18n] }))
    return { m: money, store, i18n, html }
}

const useTry = (rate = 40) => (store) => {
    store.code = 'try'
    store.snapshot = freshSnapshot({ try: rate })
}

afterEach(() => {
    delete globalThis.chrome
})

describe('useMoney: bicim', () => {
    it('varsayilan: USD, en -> "$1,234.50"; tr -> "$1.234,50"', async () => {
        const en = await mountMoney({ locale: 'en', template: (m) => m.money(1234.5) })
        expect(en.html).toBe('<span>$1,234.50</span>')
        expect(en.m.locale.value).toBe('en')

        const tr = await mountMoney({ locale: 'tr', template: (m) => m.money(1234.5) })
        expect(norm(tr.html)).toBe('<span>$1.234,50</span>')
        expect(tr.m.locale.value).toBe('tr')
    })

    it('depo try + kur goruntusu (rate 40) + tr -> "₺49.380,00" (bosluk normalize)', async () => {
        const { m, html } = await mountMoney({ locale: 'tr', prepare: useTry(40), template: (x) => x.money(1234.5) })
        expect(norm(html)).toBe('<span>₺49.380,00</span>')
        expect(norm(m.money(1234.5))).toBe('₺49.380,00')
        expect(m.display.value).toEqual({ code: 'try', rate: 40, fellBack: false })
    })

    it('depo try ama kur yok -> "USD 1,234.50" (kod etiketli)', async () => {
        const { m } = await mountMoney({
            locale: 'en',
            prepare: (store) => { store.code = 'try' },
        })
        expect(m.display.value.fellBack).toBe(true)
        expect(norm(m.money(1234.5))).toBe('USD 1,234.50')
    })

    it('depo try, kur 24 saatten eski -> "USD 1,234.50" (eski kurla "₺" basmaz)', async () => {
        const { m } = await mountMoney({
            locale: 'en',
            prepare: (store) => {
                store.code = 'try'
                const old = NOW - 25 * 60 * 60 * 1000
                store.snapshot = { rates: { try: 40 }, currencies: [], updatedAt: old, stale: true, fetchedAt: NOW }
            },
        })
        expect(norm(m.money(1234.5))).toBe('USD 1,234.50')
    })

    it('opts gecer: style compact ve price', async () => {
        const { m } = await mountMoney({ locale: 'en' })
        expect(m.money(1500, { style: 'compact' })).toBe('$1.5K')
        expect(m.money(0.000008, { style: 'price' })).toBe('$0.000008')
    })

    it('dil ve kur degisince AYNI fonksiyon yeni sonucu verir (okuma cagri aninda)', async () => {
        const { m, store, i18n } = await mountMoney({ locale: 'en' })
        expect(m.money(1234.5)).toBe('$1,234.50')

        i18n.global.locale.value = 'tr'
        expect(norm(m.money(1234.5))).toBe('$1.234,50')

        store.code = 'try'
        store.snapshot = freshSnapshot({ try: 40 })
        expect(norm(m.money(1234.5))).toBe('₺49.380,00')
    })
})

describe('useMoney: gecersiz girdi (money / parts)', () => {
    it('invalid: money(null, { invalid: "—" }) -> "—"; opsiyonsuz -> null', async () => {
        const { m } = await mountMoney()
        expect(m.money(null, { invalid: '—' })).toBe('—')
        expect(m.money(null)).toBeNull()
        expect(m.money(undefined)).toBeNull()
    })

    it('invalid tum gecersiz girdilerde calisir; gecerli girdide devreye girmez', async () => {
        const { m } = await mountMoney()
        for (const bad of [null, undefined, '', '  ', NaN, Infinity, -Infinity, true, {}]) {
            expect(m.money(bad, { invalid: '—' })).toBe('—')
            expect(m.money(bad)).toBeNull()
        }
        expect(m.money(2, { invalid: '—' })).toBe('$2.00')
    })

    it('invalid bos metin de gecerli bir yedektir (null\'a dusmez)', async () => {
        const { m } = await mountMoney()
        expect(m.money(null, { invalid: '' })).toBe('')
    })

    it('parts: onek / sayi / son ek; gecersizde null ve invalid parts\'a uygulanmaz', async () => {
        const { m } = await mountMoney({ locale: 'en' })
        expect(m.parts(1234.5)).toEqual({ prefix: '$', number: '1,234.50', suffix: '' })
        expect(m.parts(null)).toBeNull()
        expect(m.parts(null, { invalid: '—' })).toBeNull()
    })

    it('parts: tr + try -> sayi / son ek ayrimi', async () => {
        const { m } = await mountMoney({ locale: 'tr', prepare: useTry(40) })
        const p = m.parts(1234.5)
        expect(norm(p.prefix)).toBe('₺')
        expect(p.number).toBe('49.380,00')
        expect(p.suffix).toBe('')
    })
})

describe('useMoney: fiatPrice', () => {
    it('fiatPrice(2) kur 40 -> 80; fiatPrice(null) -> null', async () => {
        const { m } = await mountMoney({ prepare: useTry(40) })
        expect(m.fiatPrice(2)).toBe(80)
        expect(m.fiatPrice(null)).toBeNull()
    })

    it('fiatPrice: gecersiz girdiler null; sifir 0 (null degil)', async () => {
        const { m } = await mountMoney({ prepare: useTry(40) })
        for (const bad of [undefined, '', NaN, Infinity, -Infinity]) {
            expect(m.fiatPrice(bad)).toBeNull()
        }
        expect(m.fiatPrice(0)).toBe(0)
        expect(m.fiatPrice('2')).toBe(80)
    })

    it('fiatPrice: kur yokken (USD\'ye dusus) fiyat oldugu gibi doner, ekran USD yazar', async () => {
        const { m } = await mountMoney({ prepare: (store) => { store.code = 'try' } })
        expect(m.fiatPrice(2)).toBe(2)
    })

    it('fiatPrice: varsayilan USD -> fiyat ayni', async () => {
        const { m } = await mountMoney()
        expect(m.fiatPrice(3.5)).toBe(3.5)
    })
})

describe('useMoney: moneyOrZero / partsOrZero', () => {
    it('moneyOrZero: null / undefined / NaN / "" -> "$0.00" (null degil); compact ile de "$0.00"; 1500 compact -> "$1.5K"', async () => {
        const { m } = await mountMoney({ locale: 'en' })
        for (const bad of [null, undefined, NaN, '', Infinity, -Infinity]) {
            expect(m.moneyOrZero(bad)).toBe('$0.00')
            expect(m.moneyOrZero(bad, { style: 'compact' })).toBe('$0.00')
            expect(m.moneyOrZero(bad, { style: 'price' })).toBe('$0.00')
        }
        expect(m.moneyOrZero(1500, { style: 'compact' })).toBe('$1.5K')
    })

    it('moneyOrZero: gecerli girdi money ile AYNI sonucu verir', async () => {
        const { m } = await mountMoney({ locale: 'en' })
        expect(m.moneyOrZero(1234.5)).toBe(m.money(1234.5))
        expect(m.moneyOrZero(0)).toBe('$0.00')
    })

    it('moneyOrZero: depo try + kur yok (fellBack) + gecersiz girdi -> "USD 0.00" (kod etiketli)', async () => {
        const { m } = await mountMoney({ prepare: (store) => { store.code = 'try' } })
        expect(norm(m.moneyOrZero(null))).toBe('USD 0.00')
        expect(norm(m.moneyOrZero(undefined, { style: 'compact' }))).toBe('USD 0.00')
    })

    it('moneyOrZero: secili birimin sifir bicimi (try, tr -> "₺0,00"; jpy -> ondaliksiz)', async () => {
        const tr = await mountMoney({ locale: 'tr', prepare: useTry(40) })
        expect(norm(tr.m.moneyOrZero(null))).toBe('₺0,00')

        const jpy = await mountMoney({
            locale: 'en',
            prepare: (store) => {
                store.code = 'jpy'
                store.snapshot = freshSnapshot({ jpy: 150 })
            },
        })
        expect(jpy.m.moneyOrZero(null)).toBe('¥0')
    })

    it('moneyOrZero: invalid secenegi sifir davranisini bozmaz (hicbir zaman null / yedek metin)', async () => {
        const { m } = await mountMoney()
        expect(m.moneyOrZero(null, { invalid: '—' })).toBe('$0.00')
    })

    it('partsOrZero(undefined) -> { prefix:"$", number:"0.00", suffix:"" }', async () => {
        const { m } = await mountMoney({ locale: 'en' })
        expect(m.partsOrZero(undefined)).toEqual({ prefix: '$', number: '0.00', suffix: '' })
        expect(m.partsOrZero(null)).toEqual({ prefix: '$', number: '0.00', suffix: '' })
        expect(m.partsOrZero(NaN, { style: 'compact' })).toEqual({ prefix: '$', number: '0.00', suffix: '' })
    })

    it('partsOrZero: gecerli girdi parts ile AYNI; kur yokken "USD" etiketli sifir', async () => {
        const { m } = await mountMoney({ locale: 'en' })
        expect(m.partsOrZero(1234.5)).toEqual(m.parts(1234.5))

        const fb = await mountMoney({ prepare: (store) => { store.code = 'try' } })
        const z = fb.m.partsOrZero(null)
        expect(norm(z.prefix)).toBe('USD')
        expect(z.number).toBe('0.00')
        expect(z.suffix).toBe('')
    })
})
