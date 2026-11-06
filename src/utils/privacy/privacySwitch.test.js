import { describe, it, expect, vi, afterEach } from 'vitest'
import { reactive } from 'vue'
import { switchPrivacyMode } from './privacySwitch'

afterEach(() => { delete globalThis.chrome })

// Arka plan cevabi + (istenirse) privacyUiSync'in store'u cevirmesini taklit eder.
function setup({ reply = { success: true }, flip = true, throws = false } = {}) {
    const privacy = reactive({ active: false })
    const sent = []
    globalThis.chrome = {
        runtime: {
            sendMessage: async (msg) => {
                sent.push(msg)
                if (throws) throw new Error('baglam yok')
                if (flip && reply.success) setTimeout(() => { privacy.active = msg.enabled }, 5)
                return reply
            },
        },
    }
    return { privacy, sent }
}

function fakeDoc({ vt = true, reducedMotion = false } = {}) {
    const classes = new Set()
    const doc = {
        documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
        defaultView: { matchMedia: (q) => ({ matches: reducedMotion && q.includes('reduce') }) },
        classes,
        started: 0,
        classDuringUpdate: null,
    }
    if (vt) {
        doc.startViewTransition = (update) => {
            doc.started++
            const updateCallbackDone = Promise.resolve().then(() => {
                doc.classDuringUpdate = classes.has('privacy-switching')
                return update()
            })
            return { updateCallbackDone, finished: updateCallbackDone.then(() => {}) }
        }
    }
    return doc
}

describe('switchPrivacyMode', () => {
    it('API varsa gecis icinde istek atar, store donunce onApplied cagrilir', async () => {
        const { privacy, sent } = setup()
        const doc = fakeDoc()
        const onApplied = vi.fn(() => { expect(privacy.active).toBe(true) })
        const res = await switchPrivacyMode(true, { privacy, onApplied, doc })
        expect(res).toEqual({ ok: true })
        expect(sent).toEqual([{ type: 'PRIVACY_MODE_SET', enabled: true }])
        expect(doc.started).toBe(1)
        expect(onApplied).toHaveBeenCalledTimes(1)
    })

    it('gecis boyunca html.privacy-switching sinifi var, bitince kalkar', async () => {
        const { privacy } = setup()
        const doc = fakeDoc()
        await switchPrivacyMode(true, { privacy, doc })
        expect(doc.classDuringUpdate).toBe(true)
        expect(doc.classes.has('privacy-switching')).toBe(false)
    })

    it('API yoksa animasyonsuz ayni sonuc', async () => {
        const { privacy } = setup()
        const doc = fakeDoc({ vt: false })
        const onApplied = vi.fn()
        const res = await switchPrivacyMode(true, { privacy, onApplied, doc })
        expect(res).toEqual({ ok: true })
        expect(onApplied).toHaveBeenCalledTimes(1)
        expect(doc.classes.has('privacy-switching')).toBe(false)
    })

    it('hareketi azalt aciksa gecis baslatilmaz', async () => {
        const { privacy } = setup()
        const doc = fakeDoc({ reducedMotion: true })
        const res = await switchPrivacyMode(true, { privacy, doc })
        expect(res.ok).toBe(true)
        expect(doc.started).toBe(0)
    })

    it('basarisiz istekte onApplied cagrilmaz, hata anahtari doner', async () => {
        const { privacy } = setup({ reply: { success: false, error: 'WALLET_LOCKED' } })
        const doc = fakeDoc()
        const onApplied = vi.fn()
        const res = await switchPrivacyMode(true, { privacy, onApplied, doc })
        expect(res).toEqual({ ok: false, errorKey: 'privacy.errors.WALLET_LOCKED' })
        expect(onApplied).not.toHaveBeenCalled()
        expect(doc.classes.has('privacy-switching')).toBe(false)
    })

    it('mesaj firlatirsa generic hata, asla firlatmaz', async () => {
        const { privacy } = setup({ throws: true })
        const res = await switchPrivacyMode(true, { privacy, doc: fakeDoc() })
        expect(res).toEqual({ ok: false, errorKey: 'privacy.errors.generic' })
    })

    it('store hic donmezse zaman asiminda yine onApplied cagrilir (takili kalmaz)', async () => {
        const { privacy } = setup({ flip: false })
        const onApplied = vi.fn()
        const t0 = Date.now()
        const res = await switchPrivacyMode(true, { privacy, onApplied, doc: fakeDoc(), timeoutMs: 40 })
        expect(res.ok).toBe(true)
        expect(onApplied).toHaveBeenCalledTimes(1)
        expect(Date.now() - t0).toBeGreaterThanOrEqual(35)
    })

    it('store zaten hedef durumdaysa beklemez', async () => {
        const { privacy } = setup({ flip: false })
        privacy.active = true
        const onApplied = vi.fn()
        const t0 = Date.now()
        await switchPrivacyMode(true, { privacy, onApplied, doc: fakeDoc(), timeoutMs: 1000 })
        expect(Date.now() - t0).toBeLessThan(500)
        expect(onApplied).toHaveBeenCalledTimes(1)
    })
})
