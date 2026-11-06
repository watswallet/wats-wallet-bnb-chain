// StockFeeNotice.vue (Faz 3 Task 14): feeNoticeOf eslemesini cizer; metin/eylem karari ekranda verilmez.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, h } from 'vue'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'
import StockFeeNotice from './StockFeeNotice.vue'

const HERE = dirname(fileURLToPath(import.meta.url))
const clean = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
const UID = '0x' + 'ab'.repeat(56)
const view = (over = {}) => ({
    uid: UID, chainId: 1, state: 'owed', blocker: null, quotedAtsRaw: '1500000000000000000', freshFeeRaw: null,
    atsChargedRaw: null, paidTxHash: null, noServiceSince: null, refund: { state: 'none', atsRaw: null, txHash: null, code: null }, ...over,
})
const actionsOf = (html) => [...html.matchAll(/data-fee-action="([A-Za-z]+)"/g)].map((m) => m[1])

async function mount(props, locale = 'en') {
    installChromeStub({})
    const app = createApp(defineComponent({ render: () => h(StockFeeNotice, props) }))
    app.use(createTestPinia())
    app.use(createTestI18n(locale))
    return clean(await render(app))
}
afterEach(() => {
    delete globalThis.chrome
})

describe('StockFeeNotice.vue', () => {
    it('bos gorunum listesi hicbir sey cizmez', async () => {
        const html = await mount({ views: [] })
        expect(html).not.toContain('data-fee-notice')
    })

    it('owed: payNow dugmesi ve uid isaretleri', async () => {
        const html = await mount({ views: [view()], formatAtsRaw: () => '1.5' })
        expect(html).toContain('data-fee-notice')
        expect(html).toContain(`data-fee-uid="${UID}"`)
        expect(actionsOf(html)).toEqual(['payNow'])
    })

    it('walletLocked: payNow YOK ve "kilit acilinca" metni tutarla gelir', async () => {
        const html = await mount({ views: [view()], walletLocked: true, formatAtsRaw: () => '1.5' })
        expect(actionsOf(html)).toEqual([])
        expect(html).toContain('1.5')
    })

    it('walletLocked: imza isteyen retry de sunulmaz, buyAts kalir', async () => {
        const v = view({ state: 'blocked', blocker: 'BALANCE', freshFeeRaw: '1500000000000000000' })
        expect(actionsOf(await mount({ views: [v] }))).toEqual(['buyAts', 'retry'])
        expect(actionsOf(await mount({ views: [v], walletLocked: true }))).toEqual(['buyAts'])
    })

    it('her blocker icin feeNoticeOf eylemleri', async () => {
        const blocked = (blocker) => view({ state: 'blocked', blocker, freshFeeRaw: '2000000000000000000' })
        expect(actionsOf(await mount({ views: [blocked('APPROVAL')] }))).toEqual(['prepare'])
        expect(actionsOf(await mount({ views: [blocked('FEE_CHANGED')] }))).toEqual(['approve', 'decline'])
        expect(actionsOf(await mount({ views: [blocked('FEE_STUCK')] }))).toEqual([])
        expect(actionsOf(await mount({ views: [blocked('NO_SERVICE')] }))).toEqual([])
    })

    it('iade durumlari: dugme yok, ton ok/error', async () => {
        const paid = (refund) => view({ state: 'paid', refund: { state: 'none', atsRaw: null, txHash: null, code: null, ...refund } })
        const sent = await mount({ views: [paid({ state: 'sent', atsRaw: '1' })], formatAtsRaw: () => '0.4' })
        expect(sent).toContain('data-fee-tone="ok"')
        expect(sent).toContain('0.4')
        const rej = await mount({ views: [paid({ state: 'rejected', code: 'NO_REFUND_DUE' })] })
        expect(rej).toContain('data-fee-tone="error"')
        expect(rej).toContain('NO_REFUND_DUE')
        expect(actionsOf(rej)).toEqual([])
    })

    it('idle gorunum cizilmez', async () => {
        expect(await mount({ views: [view({ state: 'idle' })] })).not.toContain('data-fee-notice')
    })

    it('dugme olayi { name, uid } yayar', () => {
        const src = readFileSync(resolve(HERE, 'StockFeeNotice.vue'), 'utf8')
        expect(yorumsuz(src)).toContain("emit('action', { name: a, uid: it.uid })")
    })

    it('kaynak: anahtar/ham hata yok, tutar Number ile islenmez', () => {
        const src = yorumsuz(readFileSync(resolve(HERE, 'StockFeeNotice.vue'), 'utf8'))
        expect(src).not.toMatch(/privateKey|mnemonic|error\.message|v-html/)
        expect(src).not.toContain('Number(')
    })
})
