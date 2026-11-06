// StockAtsFeeCard: bStocks Al/Sat ATS ucret karti. Sunum; sayilar ve kararlar `ats` (reactive useAtsOpFee) girdisinden gelir.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reactive } from 'vue'

vi.mock('../../composables/useAtsPurchase', () => ({ useAtsPurchase: () => ({ live: true, open: vi.fn(async () => true) }) }))

const priceMock = vi.hoisted(() => ({ value: null }))
vi.mock('../../composables/useUsdPrice', async () => {
    const { ref } = await import('vue')
    return { useUsdPrice: () => ({ price: ref(priceMock.value), loadById: async () => {}, loadNative: async () => {} }) }
})

import { ssrRender, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import { resolveAtsBlocker } from '../../utils/atsBlocker'
import StockAtsFeeCard from './StockAtsFeeCard.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

const makeAts = (over = {}) =>
    reactive({
        atsFee: 1.5, atsSymbol: 'ATS', loading: false, feeRefundable: false, prepaid: null, decision: null, nextSteps: [],
        insufficient: false, totalAtsCost: 1.7, requiredAtsFor: () => 1.7, ...over,
    })

async function mount(ats, locale = 'en') {
    return clean(await ssrRender(StockAtsFeeCard, { props: { ats }, global: { plugins: [createTestI18n(locale)] } }))
}

describe('StockAtsFeeCard', () => {
    it('toplam ucret ve ATS simgesi/sembolu gorunur, engel/eksik bolumu yok', async () => {
        const html = await mount(makeAts())
        expect(html).toContain('data-stock-ats-card')
        expect(text(html)).toContain('1.7')
        expect(text(html)).toContain('ATS')
        expect(html).not.toContain('data-ats-decision')
        expect(html).not.toContain('data-ats-insufficient')
    })

    it('ucret yokken ve yukleniyorken tutar yok (iskelet)', async () => {
        const html = await mount(makeAts({ atsFee: null, loading: true, totalAtsCost: null }))
        expect(html).toContain('animate-pulse')
        expect(text(html)).not.toContain('1.7')
    })

    it('onboarding karari: aciklama + "kurulumu calistir" dugmesi, ATS al yok', async () => {
        const html = await mount(makeAts({ decision: resolveAtsBlocker('src-allowance-low'), nextSteps: ['approve'] }))
        expect(html).toContain('data-ats-decision')
        expect(html).toContain('data-ats-onboarding')
        expect(html).not.toContain('Buy ATS')
    })

    it('ATS yok karari: ATS Al dugmesi (satis yolu acik), onboarding yok', async () => {
        const html = await mount(makeAts({ decision: resolveAtsBlocker('src-balance-missing') }))
        expect(html).toContain('data-ats-decision')
        expect(html).toContain('Buy ATS')
        expect(html).not.toContain('data-ats-onboarding')
    })

    it('istemci hatasi (internal) karari CIZILMEZ', async () => {
        const html = await mount(makeAts({ decision: resolveAtsBlocker('settlement-mismatch') }))
        expect(html).not.toContain('data-ats-decision')
    })

    it('karar yukleme sirasinda gizli', async () => {
        const html = await mount(makeAts({ loading: true, decision: resolveAtsBlocker('src-balance-missing') }))
        expect(html).not.toContain('data-ats-decision')
    })

    it('bakiye ucrete yetmiyorsa ve sunucu karari yoksa: eksik bakiye bolumu + gereken tutar + ATS Al', async () => {
        const html = await mount(makeAts({ insufficient: true }))
        expect(html).toContain('data-ats-insufficient')
        expect(text(html)).toContain('1.7')
        expect(html).toContain('Buy ATS')
    })

    it('eksik bakiye bolumu gereken, mevcut ve eksik ATS miktarini yazar (tr virgul)', async () => {
        const html = await mount(makeAts({ insufficient: true, atsBalance: 0.5 }), 'tr')
        expect(text(html)).toContain('Bakiye yetersiz: 1,7 ATS gerekiyor, cüzdanında 0,5 ATS var (1,2 ATS eksik).')
        const en = await mount(makeAts({ insufficient: true, atsBalance: 0.5 }))
        expect(text(en)).toContain('Insufficient balance: 1.7 ATS needed, your wallet has 0.5 ATS (1.2 ATS short).')
    })

    it('sunucu karari ayni seyi anlatiyorsa eksik bolumu tekrarlanmaz', async () => {
        const html = await mount(makeAts({ insufficient: true, decision: resolveAtsBlocker('src-balance-missing') }))
        expect(html).toContain('data-ats-decision')
        expect(html).not.toContain('data-ats-insufficient')
    })

    it('Turkce metin', async () => {
        const html = await mount(makeAts({ insufficient: true }), 'tr')
        expect(text(html)).toContain('ATS')
        expect(html).toContain('data-ats-insufficient')
    })

    it('kaynak taramasi: onboarding olayi dis katmana yayilir; hesap/mesaj yok', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockAtsFeeCard.vue'), 'utf8'))
        expect(src).toMatch(/@click="\$emit\('onboard'\)"/)
        for (const yasak of ['sendMessage', 'parseUnits', 'uiMultiplier', '1e18', 'v-html']) expect(src).not.toContain(yasak)
    })

    describe('dolar karsiligi', () => {
        it('fiyat var -> "≈ $" ve dogru deger (1.7 x 0.5 = 0.85)', async () => {
            priceMock.value = 0.5
            for (const loc of ['en', 'tr']) {
                const html = await mount(makeAts(), loc)
                expect(text(html)).toContain('≈ $0.85')
            }
        })
        it('cok kucuk -> "<0.01"', async () => {
            priceMock.value = 0.001
            expect(text(await mount(makeAts()))).toContain('≈ $&lt;0.01')
        })
        it('fiyat yok / 0 -> satir yok', async () => {
            priceMock.value = null
            expect(text(await mount(makeAts()))).not.toContain('≈')
            priceMock.value = 0
            expect(text(await mount(makeAts()))).not.toContain('$0.00')
        })
        it('tutar yok -> satir yok', async () => {
            priceMock.value = 0.5
            const html = await mount(makeAts({ atsFee: null, totalAtsCost: null }))
            expect(text(html)).not.toContain('≈')
        })
    })
})
