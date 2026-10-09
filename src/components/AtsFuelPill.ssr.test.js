// Yakit hapindaki "ATS Al" (spec §6.4): satis aciksa satin alma ekranini acar ve MEXC kucuk bir
// "Borsadan al" satirinda kalir; satis kapaliyken BUGUNKU gibi MEXC'yi acar.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const satis = vi.hoisted(() => ({ acik: false }))
const acilis = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../composables/useAtsPurchase', () => ({
    useAtsPurchase: () => ({ live: satis.acik, open: acilis }),
}))

import { createApp, render, captureInstance, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import AtsFuelPill from './AtsFuelPill.vue'
import supported_chains from '../data/supported_chains.json'
import { ATS_BUY_URL } from '../utils/atsFuel'

const BSC = supported_chains.find((c) => c.chainId === 56)
const gorunen = (html) => html.replace(/<!--[\s\S]*?-->/g, '')

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    satis.acik = false
    acilis.mockClear()
})

async function ciz() {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    const stub = installChromeStub({})
    stub.setSendMessage(async (m) => (m?.type === 'ATS_FUEL_BALANCE' ? { success: true, balance: '0', symbol: 'ATS' } : {}))
    const app = createApp(AtsFuelPill, { props: { address: '0xAbCdEf0000000000000000000000000000000001' } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    networkStore().currentNetwork = BSC
    // Panel acik cizilsin: dugme panelin icinde.
    const holder = captureInstance(app, 'AtsFuelPill', (instance) => { instance.setupState.open = true })
    const html = gorunen(await render(app))
    return { html, state: holder.instance.setupState }
}

describe('AtsFuelPill (SSR) -- ATS Al', () => {
    it('satis KAPALI: dugme bugunku gibi MEXC yi acar, "Borsadan al" satiri YOK', async () => {
        const { html, state } = await ciz()
        expect(html).toContain('Get ATS')
        expect(html).not.toContain('Buy on exchange')
        const acilan = vi.fn()
        vi.stubGlobal('window', { open: acilan })
        await state.buyAts()
        expect(acilan).toHaveBeenCalledWith(ATS_BUY_URL, '_blank')
        expect(acilis).not.toHaveBeenCalled()
        expect(state.open).toBe(false)
    })

    it('satis ACIK: "ATS Al" satin alma ekranini acar; MEXC kucuk "Borsadan al" satirinda', async () => {
        satis.acik = true
        const { html, state } = await ciz()
        expect(html).toContain('Get ATS')
        expect(html).toContain('Buy on exchange')
        const acilan = vi.fn()
        vi.stubGlobal('window', { open: acilan })
        await state.buyAts()
        expect(acilis).toHaveBeenCalledTimes(1)
        expect(acilan).not.toHaveBeenCalled()
        expect(state.open).toBe(false)
        state.buyOnExchange()
        expect(acilan).toHaveBeenCalledWith(ATS_BUY_URL, '_blank')
    })
})
