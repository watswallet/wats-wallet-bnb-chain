// BuyToken hesapsiz durum: alert() degil, mevcut buyError satirinda gorunur.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})
vi.mock('@moonpay/moonpay-js', () => ({ loadMoonPay: vi.fn() }))
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { cryptoStore } from '../store/crypto'
import BuyToken from './BuyToken.vue'
import en from '../i18n/locales/en.json'

describe('BuyToken hesapsiz durum', () => {
    it('kaynakta alert( yok', () => {
        const src = readFileSync(new URL('./BuyToken.vue', import.meta.url), 'utf8')
        expect(src).not.toMatch(/\balert\(/)
    })

    it('hesap yoksa buyError noAccount olur ve noAccount metni render edilir', async () => {
        installChromeStub({})
        const pinia = createTestPinia()
        cryptoStore().onramp_token = { symbol: 'ETH', name: 'Ether', image: '' }
        const app = createApp(BuyToken, { use: [pinia, createTestI18n('en')] })
        const captured = captureInstance(app, 'BuyToken', (inst) => { inst.setupState.activeAccount = null; inst.setupState.buyToken() })
        const html = await render(app)
        expect(captured.setupStateEmptyError).toBeUndefined()
        expect(captured.instance.setupState.buyError).toBe('noAccount')
        expect(html).toContain(en.buyToken.noAccount)
        expect(html).not.toContain(en.buyToken.buyFailed)
    })
})
