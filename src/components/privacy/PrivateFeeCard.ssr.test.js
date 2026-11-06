import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { h as vh } from 'vue'
import { createApp, captureInstance, render, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import PrivateFeeCard from './PrivateFeeCard.vue'
import { QUOTE_MIN_REMAINING_MS } from '../../utils/privacy/privateConstants'

const QUOTE = {
    serviceFeeUsdc: '0.175',
    integratorFeeUsdc: '0.075',
    integratorAddress: '0x' + '99'.repeat(20),
    totalUsdc: '25.25',
    expiresAtMs: Date.UTC(2026, 9, 29, 12, 0, 0) + 600000,
    dest: { chainId: 56, asset: 'USDC', decimals: 18, expectedDestAmount: '24997500000000000000', minDestAmount: '24000000000000000000', quoteUsd: null },
}
const ATS_IDLE = { state: 'idle', amount: null, symbol: 'ATS', required: null, refundable: false, prepaid: false }
const BASE = { mode: 'fund', quote: null, destIsUsdc: true, feeBps: 100, payoutText: '25', minUsdc: 12, belowMin: false, ats: ATS_IDLE }

async function mount(props = {}, { locale = 'en', onCapture } = {}) {
    const app = createApp(PrivateFeeCard, { props: { ...BASE, ...props } })
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    const captured = captureInstance(app, 'PrivateFeeCard', onCapture)
    const out = await render(app)
    return { html: out, captured }
}
const html = async (props, opts) => (await mount(props, opts)).html
// Ayrinti ACIK ham HTML (dipnotlar H1 geregi Ayrinti'nin icindedir; SSR'da tiklama yok, durum yakalanip acilir).
const htmlOpen = async (props, opts) => (await mount(props, { ...opts, onCapture: (inst) => { inst.setupState.detailOpen = true } })).html
// data-testid etiketli elemanin acilis etiketinden baslayan pencere (ham HTML).
function section(h, testid, len = 900) {
    const i = h.indexOf(`data-testid="${testid}"`)
    if (i < 0) return null
    return h.slice(i, i + len)
}
// Elemanin acilis etiketi (class dahil) ham olarak.
function openTag(h, testid) {
    const at = h.indexOf(`data-testid="${testid}"`)
    if (at < 0) return null
    const start = h.lastIndexOf('<', at)
    return h.slice(start, h.indexOf('>', at) + 1)
}
// Elemanin kendi metni: acilis etiketinden, ayni etiket turunun kapanisina kadar.
function textOf(h, testid) {
    const at = h.indexOf(`data-testid="${testid}"`)
    if (at < 0) return null
    const start = h.lastIndexOf('<', at)
    const name = /^<(\w+)/.exec(h.slice(start))[1]
    let depth = 0
    let i = start
    const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g')
    re.lastIndex = start
    let m
    while ((m = re.exec(h))) {
        depth += m[1] ? -1 : 1
        i = re.lastIndex
        if (depth === 0) break
    }
    return h.slice(start, i).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

describe('PrivateFeeCard: kabuk ve ust satir', () => {
    it('AtsFeeCard kabugu ve fee-card test kimligi; baslik "Fees" / "Ücretler"', async () => {
        const h = await html()
        expect(h).toContain('data-testid="fee-card"')
        expect(openTag(h, 'fee-card')).toContain('bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3')
        expect(h).toContain('Fees')
        expect(await html({}, { locale: 'tr' })).toContain('Ücretler')
    })

    it('etiket: feeBps 100 -> tr "SilentSwap %1", en "SilentSwap 1%"', async () => {
        expect(textOf(await html({}, { locale: 'tr' }), 'fee-tag')).toBe('SilentSwap %1')
        expect(textOf(await html(), 'fee-tag')).toBe('SilentSwap 1%')
    })

    it('feeBps null ve teklif yok -> etiket sade "SilentSwap", yuzde yok', async () => {
        const tag = textOf(await html({ feeBps: null }), 'fee-tag')
        expect(tag).toBe('SilentSwap')
        expect(tag).not.toContain('%')
    })

    it('etiket teklif varken teklifin gercek oranini kullanir (0.25 / 25.25 = %1)', async () => {
        expect(textOf(await html({ quote: QUOTE, feeBps: null }), 'fee-tag')).toBe('SilentSwap 1%')
    })
})

describe('PrivateFeeCard: SilentSwap ucreti satiri (teklif oncesi)', () => {
    it('payoutText 25, feeBps 100 -> "≈ 0.25 USDC"', async () => {
        const t = textOf(await html(), 'fee-service')
        expect(t).toContain('SilentSwap fee')
        expect(t).toContain('≈ 0.25 USDC')
    })

    it('feeBps null -> tire', async () => {
        const t = textOf(await html({ feeBps: null }), 'fee-service')
        expect(t).toContain('—')
        expect(t).not.toContain('USDC')
    })

    it('payoutText bos -> tire', async () => {
        expect(textOf(await html({ payoutText: '' }), 'fee-service')).toContain('—')
    })

    it('belowMin -> servis ucreti tire; kartta KIRMIZI not yok (hata tutarin altinda ekranda gosterilir)', async () => {
        const h = await html({ belowMin: true })
        const t = textOf(h, 'fee-service')
        expect(t).toContain('—')
        expect(t).not.toContain('≈')
        // Eski kirmizi dipnot kalkti: kapali Ayrinti'da dipnot hic cizilmez ve kartta kirmizi sinif yok.
        expect(h).not.toContain('data-testid="fee-note-service"')
        expect(h.slice(h.indexOf('data-testid="fee-card"'))).not.toContain('text-red-')
    })

    it('belowMin degilken fee-note-service (Ayrinti icinde) kirmizi degil; metin tutarin ustune eklendigini soyler ve {min} dolar', async () => {
        const h = await htmlOpen()
        expect(openTag(h, 'fee-note-service')).not.toContain('text-red-')
        expect(textOf(h, 'fee-note-service')).toBe('The SilentSwap fee is added on top of the amount. Minimum 12 USDC.')
        expect(textOf(await htmlOpen({}, { locale: 'tr' }), 'fee-note-service')).toBe('SilentSwap ücreti tutarın üstüne eklenir. En az 12 USDC.')
    })

    it('belowMin iken de dipnot YALNIZ Ayrinti icinde ve gri (kirmizi degil); acikken tam bir kez; her iki dilde metin ayni', async () => {
        const kapali = await html({ belowMin: true })
        expect(kapali).not.toContain('data-testid="fee-detail"')
        expect(kapali).not.toContain('data-testid="fee-note-service"')
        expect(kapali).not.toContain('Minimum 12 USDC')
        const acik = await htmlOpen({ belowMin: true })
        expect(acik.split('data-testid="fee-note-service"').length - 1).toBe(1)
        expect(textOf(acik, 'fee-note-service')).toContain('Minimum 12 USDC')
        expect(openTag(acik, 'fee-note-service')).toContain('text-slate-500 dark:text-zinc-500')
        expect(openTag(acik, 'fee-note-service')).not.toContain('text-red-')
        expect(acik.slice(acik.indexOf('data-testid="fee-detail"'))).toContain('data-testid="fee-notes"')
        const tr = await htmlOpen({ belowMin: true }, { locale: 'tr' })
        expect(textOf(tr, 'fee-note-service')).toBe('SilentSwap ücreti tutarın üstüne eklenir. En az 12 USDC.')
        expect(openTag(tr, 'fee-note-service')).not.toContain('text-red-')
    })
})

describe('PrivateFeeCard: SilentSwap ucreti satiri (teklif hazir)', () => {
    it('serviceFee + integratorFee toplami "0.25 USDC", "≈" yok, yerel USDC logosu', async () => {
        const h = await html({ quote: QUOTE })
        const t = textOf(h, 'fee-service')
        expect(t).toContain('0.25 USDC')
        expect(t).not.toContain('≈')
        expect(h.slice(h.indexOf('data-testid="fee-service"'), h.indexOf('data-testid="fee-network"'))).toContain('src="/usdc.png"')
    })
})

describe('PrivateFeeCard: Ag ucreti satiri', () => {
    it('tutar BOS (idle, teklif yolda degil, belowMin degil) -> tire; "calculating…" yok; en/tr; SilentSwap ucreti de tire', async () => {
        const h = await html({ payoutText: '' })
        const t = textOf(h, 'fee-network')
        expect(t).toContain('Network fee')
        expect(t).toContain('—')
        expect(t).not.toContain('calculating')
        expect(textOf(h, 'fee-service')).toContain('—')
        expect(textOf(h, 'fee-service')).not.toContain('calculating')
        const trH = await html({ payoutText: '' }, { locale: 'tr' })
        expect(textOf(trH, 'fee-network')).toContain('—')
        expect(textOf(trH, 'fee-network')).not.toContain('hesaplan')
        expect(textOf(trH, 'fee-service')).toContain('—')
        // Varsayilan (quoteLoading verilmemis) ayni: hicbir sey yuklenmiyor.
        expect(textOf(await html({}), 'fee-network')).not.toContain('calculating')
    })

    it('en az tutarin altinda (belowMin + idle) -> tire; belowMin + loading ve belowMin + teklif yolda hala "calculating…"; sonuc durumlari belowMin den etkilenmez', async () => {
        const dash = await html({ belowMin: true })
        const t = textOf(dash, 'fee-network')
        expect(t).toContain('Network fee')
        expect(t).toContain('—')
        expect(t).not.toContain('calculating')
        const trDash = textOf(await html({ belowMin: true }, { locale: 'tr' }), 'fee-network')
        expect(trDash).toContain('—')
        expect(trDash).not.toContain('hesaplan')
        // Gercek yukleme gizlenmez.
        const loading = textOf(await html({ belowMin: true, ats: { ...ATS_IDLE, state: 'loading' } }), 'fee-network')
        expect(loading).toContain('calculating…')
        expect(loading).not.toContain('—')
        const ready = textOf(await html({ belowMin: true, ats: { ...ATS_IDLE, state: 'ready', amount: '19.7' } }), 'fee-network')
        expect(ready).toContain('19.7 ATS')
    })

    it('teklif yolda (idle + quoteLoading) ve ATS yukleniyor (loading) -> "calculating…" / tr "hesaplanıyor…"; tire yok', async () => {
        for (const [props, ad] of [[{ quoteLoading: true }, 'idle + quoteLoading'], [{ ats: { ...ATS_IDLE, state: 'loading' } }, 'loading'], [{ quoteLoading: true, ats: { ...ATS_IDLE, state: 'loading' } }, 'loading + quoteLoading']]) {
            const t = textOf(await html(props), 'fee-network')
            expect(t, ad).toContain('Network fee')
            expect(t, ad).toContain('calculating…')
            expect(t, ad).not.toContain('—')
            const tr = textOf(await html(props, { locale: 'tr' }), 'fee-network')
            expect(tr, ad).toContain('hesaplanıyor…')
            expect(tr, ad).not.toContain('—')
        }
    })

    it('quoteLoading yalniz idle ile anlamli: ready / short / blocked / error durumlarinda "calculating…" cikmaz', async () => {
        for (const state of ['ready', 'short', 'blocked', 'error']) {
            const t = textOf(await html({ quoteLoading: true, ats: { ...ATS_IDLE, state, amount: '19.7', required: '19.7' } }), 'fee-network')
            expect(t, state).not.toContain('calculating')
        }
    })

    it('ready -> /ats.png, tutar ve sembol; "up to" niteleyicisi yok', async () => {
        const h = await html({ ats: { ...ATS_IDLE, state: 'ready', amount: '19.7' } })
        expect(h.slice(h.indexOf('data-testid="fee-network"'))).toContain('src="/ats.png"')
        expect(textOf(h, 'fee-network')).toContain('19.7 ATS')
        expect(textOf(h, 'fee-network')).not.toContain('up to')
    })

    it('ready + refundable -> "up to" niteleyicisi ve feeNoteUpTo', async () => {
        const ats = { ...ATS_IDLE, state: 'ready', amount: '19.7', refundable: true }
        const h = await htmlOpen({ ats })
        expect(textOf(h, 'fee-network')).toContain('up to')
        expect(h).not.toContain('data-testid="fee-network-short"')
        expect(textOf(h, 'fee-note-network')).toBe('The network fee is at most this amount; any unused part is refunded.')
        expect(textOf(await htmlOpen({ ats }, { locale: 'tr' }), 'fee-note-network')).toContain('iade edilir')
    })

    it('refundable degil -> fund: feeNoteFund, send / swap / bridge: feeNoteSend ("iade edilmez"); hesap adi eki yok', async () => {
        const ats = { ...ATS_IDLE, state: 'ready', amount: '19.7' }
        const fund = await htmlOpen({ ats, mode: 'fund' }, { locale: 'tr' })
        const send = await htmlOpen({ ats, mode: 'send' }, { locale: 'tr' })
        const swap = await htmlOpen({ ats, mode: 'swap' }, { locale: 'tr' })
        const bridge = await htmlOpen({ ats, mode: 'bridge' }, { locale: 'tr' })
        const SEND_TR = 'Ağ ücreti, Gizli Hesap\'ının BSC\'deki ATS bakiyesinden alınır, iade edilmez.'
        expect(textOf(fund, 'fee-note-network')).toBe('Ağ ücreti, seçtiğin hesabın BSC\'deki ATS bakiyesinden alınır, iade edilmez.')
        expect(textOf(send, 'fee-note-network')).toBe(SEND_TR)
        // Takas ve Kopru'de de ucreti Gizli Hesap oder: Gonder ile ayni not.
        expect(textOf(swap, 'fee-note-network')).toBe(SEND_TR)
        expect(textOf(bridge, 'fee-note-network')).toBe(SEND_TR)
        expect(textOf(await htmlOpen({ ats, mode: 'fund' }), 'fee-note-network')).toContain('is not refunded')
        expect(textOf(await htmlOpen({ ats, mode: 'swap' }), 'fee-note-network')).toContain('is not refunded')
    })

    it('H1: iade edilmeyen ATS ucreti kisa metni ("iade edilmez") satirda ve Ayrinti KAPALIYKEN gorunur; yalniz ready + iade edilmez', async () => {
        const ats = { ...ATS_IDLE, state: 'ready', amount: '19.7' }
        const tr = await html({ ats }, { locale: 'tr' })
        expect(tr).not.toContain('data-testid="fee-detail"')
        expect(textOf(tr, 'fee-network')).toContain('19.7 ATS')
        expect(textOf(tr, 'fee-network-short')).toBe('· iade edilmez')
        expect(textOf(await html({ ats }), 'fee-network-short')).toBe('· non-refundable')
        expect(tr.indexOf('data-testid="fee-network-short"')).toBeGreaterThan(tr.indexOf('data-testid="fee-network"'))
        expect(tr.indexOf('data-testid="fee-network-short"')).toBeLessThan(tr.indexOf('data-testid="fee-detail-toggle"'))
        for (const state of ['idle', 'loading', 'short', 'blocked', 'error']) {
            expect(await html({ ats: { ...ATS_IDLE, state, required: '19.7' } })).not.toContain('data-testid="fee-network-short"')
        }
    })

    it('H1: dipnotlar (SilentSwap ustune eklenir, ag ucreti notu) Ayrinti KAPALIYKEN cizilmez, ACIKKEN fee-detail icindedir', async () => {
        const ats = { ...ATS_IDLE, state: 'ready', amount: '19.7' }
        const kapali = await html({ ats, quote: QUOTE })
        expect(kapali).not.toContain('data-testid="fee-note-service"')
        expect(kapali).not.toContain('data-testid="fee-note-network"')
        expect(kapali).not.toContain('is not refunded')
        const acik = await htmlOpen({ ats, quote: QUOTE })
        const bas = acik.indexOf('data-testid="fee-detail"')
        expect(bas).toBeGreaterThan(acik.indexOf('data-testid="fee-detail-toggle"'))
        expect(acik.indexOf('data-testid="fee-note-service"')).toBeGreaterThan(bas)
        expect(acik.indexOf('data-testid="fee-note-network"')).toBeGreaterThan(acik.indexOf('data-testid="fee-note-service"'))
        // Teklif yokken de dipnotlar Ayrinti'dadir (dugme her durumda var).
        const teklifsiz = await htmlOpen({ ats })
        expect(teklifsiz.indexOf('data-testid="fee-note-network"')).toBeGreaterThan(teklifsiz.indexOf('data-testid="fee-detail"'))
        // Kaynak: dipnot elemanlari fee-detail blogundan sonra gelir ve yalniz orada tanimlidir.
        const kaynak = readFileSync(new URL('./PrivateFeeCard.vue', import.meta.url), 'utf8')
        const detay = kaynak.indexOf('data-testid="fee-detail"')
        expect(kaynak.indexOf('data-testid="fee-note-network"')).toBeGreaterThan(detay)
        expect(kaynak.split('data-testid="fee-note-network"').length - 1).toBe(1)
    })

    it('prepaid -> zumrut onceki odeme notu', async () => {
        const h = await html({ ats: { ...ATS_IDLE, state: 'ready', amount: '19.7', prepaid: true } })
        const at = h.indexOf('Covered by your earlier payment')
        expect(at).toBeGreaterThan(0)
        expect(h.slice(Math.max(0, at - 250), at)).toContain('text-emerald-')
        expect(await html({ ats: { ...ATS_IDLE, state: 'ready', amount: '19.7' } })).not.toContain('Covered by your earlier payment')
    })

    it('short + required -> kirmizi "19.7 ATS required" / tr "19.7 ATS gerekli"', async () => {
        const ats = { ...ATS_IDLE, state: 'short', required: '19.7' }
        const h = await html({ ats })
        expect(textOf(h, 'fee-network')).toContain('19.7 ATS required')
        const at = h.indexOf('19.7 ATS required')
        expect(h.slice(Math.max(0, at - 200), at)).toContain('text-red-')
        expect(textOf(await html({ ats }, { locale: 'tr' }), 'fee-network')).toContain('19.7 ATS gerekli')
    })

    it('short + required null -> kirmizi tire', async () => {
        const h = await html({ ats: { ...ATS_IDLE, state: 'short', required: null } })
        const t = textOf(h, 'fee-network')
        expect(t).toContain('—')
        expect(t).not.toContain('required')
        const at = h.indexOf('—', h.indexOf('data-testid="fee-network"'))
        expect(h.slice(Math.max(0, at - 200), at)).toContain('text-red-')
    })

    it('blocked ve error -> tire', async () => {
        for (const state of ['blocked', 'error']) {
            const t = textOf(await html({ ats: { ...ATS_IDLE, state } }), 'fee-network')
            expect(t).toContain('—')
            expect(t).not.toContain('calculating')
        }
    })

    it('ats.message doluysa tire yerine o metin cizilir (X5)', async () => {
        for (const state of ['blocked', 'error']) {
            const t = textOf(await html({ ats: { ...ATS_IDLE, state, message: 'Ücret hesaplanamadı' } }), 'fee-network')
            expect(t).toContain('Ücret hesaplanamadı')
            expect(t).not.toContain('—')
        }
    })

    it('#ats-extra yuvasi ag ucreti satirinin altinda, dipnotlarin ustunde cizilir', async () => {
        const Wrapper = { render: () => vh(PrivateFeeCard, { ...BASE }, { 'ats-extra': () => vh('i', { 'data-testid': 'extra-slot' }, 'EK') }) }
        const app = createApp(Wrapper)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const h = await render(app)
        const slot = h.indexOf('data-testid="extra-slot"')
        expect(slot).toBeGreaterThan(h.indexOf('data-testid="fee-network"'))
        expect(slot).toBeLessThan(h.indexOf('data-testid="fee-detail-toggle"'))
    })
})

describe('PrivateFeeCard: Teslim edilen deger', () => {
    it('destIsUsdc: %99,0 (tr) / 99.0% (en), amber degil', async () => {
        const en = await html({ quote: QUOTE })
        expect(textOf(en, 'fee-share')).toContain('Delivered value')
        expect(textOf(en, 'fee-share')).toContain('99.0%')
        const tr = await html({ quote: QUOTE }, { locale: 'tr' })
        expect(textOf(tr, 'fee-share')).toContain('%99,0')
        expect(en).not.toContain('data-testid="cost-warning"')
        expect(en).not.toContain('data-testid="share-unknown"')
    })

    it('teklif yoksa fee-share ve share-unknown cizilmez', async () => {
        const h = await html()
        expect(h).not.toContain('data-testid="fee-share"')
        expect(h).not.toContain('data-testid="share-unknown"')
    })

    it('warn (>%4 maliyet) -> cost-warning amber, satir amber, metinde "5.0" yalniz sayi', async () => {
        const quote = { ...QUOTE, dest: { ...QUOTE.dest, expectedDestAmount: '24000000000000000000' } }
        const h = await html({ quote })
        const share = textOf(h, 'fee-share')
        expect(share).toContain('95.0%')
        expect(openTag(h, 'fee-share')).toContain('text-amber-')
        const t = textOf(h, 'cost-warning')
        expect(t).toContain('Estimated total cost 5.0%')
        expect(openTag(h, 'cost-warning')).toContain('text-amber-')
        expect(textOf(await html({ quote }, { locale: 'tr' }), 'cost-warning')).toContain('%5,0')
    })

    it('pay null (USDC degil, quoteUsd yok) -> share-unknown, fee-share YOK', async () => {
        const quote = { ...QUOTE, dest: { ...QUOTE.dest, asset: 'BNB', quoteUsd: null } }
        const h = await html({ quote, destIsUsdc: false })
        expect(textOf(h, 'share-unknown')).toContain('couldn\'t be verified')
        expect(h).not.toContain('data-testid="fee-share"')
        expect(h).not.toContain('data-testid="cost-warning"')
    })
})

describe('PrivateFeeCard: Ayrinti', () => {
    it('varsayilan kapali: fee-detail yok, dugme aria-expanded="false"', async () => {
        const h = await html({ quote: QUOTE })
        expect(h).not.toContain('data-testid="fee-detail"')
        expect(openTag(h, 'fee-detail-toggle')).toContain('aria-expanded="false"')
        expect(textOf(h, 'fee-detail-toggle')).toContain('Details')
        expect(textOf(await html({ quote: QUOTE }, { locale: 'tr' }), 'fee-detail-toggle')).toContain('Ayrıntı')
    })

    it('acik (detailOpen = true): dort satir - ucret, ortak ucreti + kisa adres, gecerlilik saati, beklenen teslim', async () => {
        const { html: h } = await mount({ quote: QUOTE }, { onCapture: (inst) => { inst.setupState.detailOpen = true } })
        expect(h).toContain('data-testid="fee-detail"')
        const t = textOf(h, 'fee-detail')
        expect(t).toContain('SilentSwap fee')
        expect(t).toContain('0.175 USDC')
        expect(t).toContain('Partner fee')
        expect(t).toContain('0.075 USDC')
        expect(t).toContain('0x9999...9999')
        expect(t).toContain('Quote valid until')
        const clock = new Date(QUOTE.expiresAtMs - QUOTE_MIN_REMAINING_MS).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }).replace(/\s+/g, ' ')
        expect(t).toContain(clock)
        expect(t).toContain('Expected delivery')
        expect(t).toContain('24.9975 USDC')
        expect(openTag(h, 'fee-detail-toggle')).toContain('aria-expanded="true"')
    })

    it('teklif yokken de Ayrinti dugmesi vardir (dipnotlar icinde); acikken yalniz dipnotlar, ucret satirlari yok', async () => {
        const h = await html()
        expect(h).toContain('data-testid="fee-detail-toggle"')
        const acik = await htmlOpen()
        expect(acik).toContain('data-testid="fee-notes"')
        expect(textOf(acik, 'fee-detail')).not.toContain('Partner fee')
    })
})

describe('PrivateFeeCard: gizlilik ve kaynak', () => {
    it('HTML de "$" karakteri yok (teklifli, ayrintili, uyarili, bos)', async () => {
        const quote = { ...QUOTE, dest: { ...QUOTE.dest, expectedDestAmount: '24000000000000000000' } }
        const { html: h } = await mount(
            { quote, ats: { ...ATS_IDLE, state: 'ready', amount: '19.7', refundable: true, prepaid: true } },
            { onCapture: (i) => { i.setupState.detailOpen = true } },
        )
        expect(h).not.toContain('$')
        expect(await html()).not.toContain('$')
    })

    it('kaynakta usdText, useUsdPrice, http ve xmlns yok', () => {
        const src = readFileSync(new URL('./PrivateFeeCard.vue', import.meta.url), 'utf8')
        expect(src).not.toContain('usdText')
        expect(src).not.toContain('useUsdPrice')
        expect(src).not.toMatch(/\bhttp/)
        expect(src).not.toContain('xmlns')
    })
})
