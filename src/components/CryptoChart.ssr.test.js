// CryptoChart: `days` ve `divisor` ozellikleri (hisse ekrani T4). Token.vue yolu (ozelliksiz)
// ayni 30 gun kalir. SSR'de canvas yok; seri cizimi ve izleyiciler kaynak taramasiyla kilitlenir.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const gecmis = vi.hoisted(() => ({ fn: vi.fn(async () => []) }))
vi.mock('../utils/priceHistory', () => ({ fetchPriceHistory: (...a) => gecmis.fn(...a) }))

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import CryptoChart from './CryptoChart.vue'

const kaynak = readFileSync(new URL('./CryptoChart.vue', import.meta.url), 'utf8')
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => gecmis.fn.mockClear())

async function ciz(props = {}) {
    const app = createApp(CryptoChart, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())
    return render(app)
}

describe('CryptoChart days', () => {
    it('ozellik yoksa 30 gun ister (Token.vue yolu)', async () => {
        await ciz({ id: 'bitcoin' })
        expect(gecmis.fn).toHaveBeenCalledTimes(1)
        expect(gecmis.fn.mock.calls[0][1]).toBe('bitcoin')
        expect(gecmis.fn.mock.calls[0][2]).toBe(30)
    })

    it('days verilince o aralik istenir', async () => {
        await ciz({ id: 'x', days: 365 })
        expect(gecmis.fn.mock.calls[0][2]).toBe(365)
    })

    it('days degisince yeniden yuklenir (izleyici kaynakta)', () => {
        expect(kaynak).toMatch(/watch\(\s*\(\)\s*=>\s*\[props\.(id|days)/)
        expect(kaynak).toMatch(/props\.days/)
        expect(kaynak).toMatch(/props\.divisor/)
    })
})

describe('CryptoChart divisor', () => {
    it('divisor bilinmiyorsa (null / 0 / NaN / negatif) seri cizilmez ve bos yazi gosterilir', async () => {
        for (const d of [null, 0, NaN, -2, 'abc']) {
            gecmis.fn.mockResolvedValueOnce([{ time: 1, date: 'a', close: 5 }])
            const html = gorunen(await ciz({ id: 'x', divisor: d }))
            expect(html).toContain('No price history for this token.')
        }
    })

    it('divisor yokken (varsayilan) bolme yapilmaz: close dogrudan kullanilir', () => {
        expect(kaynak).toMatch(/divisor\s*===\s*undefined/)
    })
})
