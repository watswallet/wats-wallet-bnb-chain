// "ATS Al" dugmesi -- buy-ats blokaj kartlarinin eylemi (spec §6.4). Satis kapaliyken HICBIR
// SEY cizilmez: kartlar bugunku gibi yalniz metin.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: true }))
const acilis = vi.hoisted(() => vi.fn(async () => true))
// PRIVATE_ATS_SALE derleme sabitidir; bu dosyada mutlak getter ile acilip kapatilir (Header.privacy.ssr.test.js deseni).
const bayrak = vi.hoisted(() => ({ privateAtsSale: true }))
vi.mock('../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))
vi.mock('../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

import { createApp, render, captureInstance, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { privacyStore } from '../store/privacy'
import AtsBuyButton from './AtsBuyButton.vue'

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => {
    satis.acik = true
    bayrak.privateAtsSale = true
    acilis.mockClear()
})

async function ciz(props = {}, { gizli = false } = {}) {
    const app = createApp(AtsBuyButton, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())
    privacyStore().active = gizli
    const holder = captureInstance(app, 'AtsBuyButton')
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('AtsBuyButton (SSR)', () => {
    it('satis KAPALI: hicbir sey cizilmez', async () => {
        satis.acik = false
        const { html } = await ciz()
        expect(html).not.toContain('Buy ATS')
        expect(html).not.toContain('<button')
    })

    it('satis ACIK: "Buy ATS"; tiklama satin alma ekranini acar', async () => {
        const { html, state } = await ciz()
        expect(html).toContain('Buy ATS')
        await state.onClick()
        expect(acilis).toHaveBeenCalledTimes(1)
    })

    it('handler verilirse o cagrilir (dapp onay penceresi)', async () => {
        const handler = vi.fn(async () => {})
        const { state } = await ciz({ handler })
        await state.onClick()
        expect(handler).toHaveBeenCalledTimes(1)
        expect(acilis).not.toHaveBeenCalled()
    })

    it('notKey verilirse not cizilir', async () => {
        const { html } = await ciz({ noteKey: 'atsSale.dappCancelNote' })
        expect(html).toContain('This request will be cancelled; start it again after buying ATS.')
    })

    // K13 (cok-ag spec 4.5): PRIVATE_ATS_SALE ACIKKEN Gizli Hesap kendi alimini yapar; dugme gizli modda da cizilir ve
    // tiklama satin alma ekranini acar. Dapp notu gizli modda YINE cizilmez (gizli modda dapp yok).
    it('gizli mod + satis ACIK + PRIVATE_ATS_SALE ACIK: "Buy ATS" cizilir, blok metni yok, tiklama satin alma ekranini acar, dapp notu cizilmez', async () => {
        const { html, state } = await ciz({ noteKey: 'atsSale.dappCancelNote' }, { gizli: true })
        expect(html).toContain('Buy ATS')
        expect(html).not.toContain('ATS purchases are not available')
        expect(html).not.toContain('This request will be cancelled')
        await state.onClick()
        expect(acilis).toHaveBeenCalledTimes(1)
    })

    // GIZLI MOD (gizli-mod spec 23.8), PRIVATE_ATS_SALE KAPALI: Gizli Hesap ATS alamaz; dugme gizlenir, kisa aciklama cizilir.
    it('gizli mod + satis ACIK + PRIVATE_ATS_SALE KAPALI: dugme CIZILMEZ, aciklama cizilir, dapp notu da cizilmez', async () => {
        bayrak.privateAtsSale = false
        const { html } = await ciz({ noteKey: 'atsSale.dappCancelNote' }, { gizli: true })
        expect(html).not.toContain('<button')
        expect(html).not.toContain('Buy ATS')
        expect(html).toContain('ATS purchases are not available in private mode.')
        expect(html).not.toContain('This request will be cancelled')
    })

    it('gizli mod + satis KAPALI: hicbir sey cizilmez (aciklama da yok: alim zaten yok); bayrak durumundan bagimsiz', async () => {
        satis.acik = false
        for (const acik of [true, false]) {
            bayrak.privateAtsSale = acik
            const { html } = await ciz({}, { gizli: true })
            expect(html).not.toContain('ATS purchases are not available')
            expect(html).not.toContain('<button')
        }
        const { html } = await ciz({}, { gizli: true })
        expect(html).not.toContain('ATS purchases are not available')
        expect(html).not.toContain('<button')
    })

    it('tiklama surerken ikinci tiklama yok sayilir', async () => {
        let bitir
        const handler = vi.fn(() => new Promise((r) => { bitir = r }))
        const { state } = await ciz({ handler })
        const ilk = state.onClick()
        await state.onClick()
        expect(handler).toHaveBeenCalledTimes(1)
        bitir()
        await ilk
    })
})
