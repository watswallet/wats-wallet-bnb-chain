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
vi.mock('../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

import { createApp, render, captureInstance, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import AtsBuyButton from './AtsBuyButton.vue'

const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => {
    satis.acik = true
    acilis.mockClear()
})

async function ciz(props = {}) {
    const app = createApp(AtsBuyButton, { props })
    app.use(createTestPinia())
    app.use(createTestI18n())
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
