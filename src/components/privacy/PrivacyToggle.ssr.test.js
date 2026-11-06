import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { privacyStore } from '../../store/privacy'
import { pageStore } from '../../store/pageStore'
import { cryptoStore } from '../../store/crypto'
import PrivacyToggle from './PrivacyToggle.vue'

afterEach(() => {
    delete globalThis.chrome
    vi.unstubAllGlobals()
})

function mount(state, reply = { success: true }) {
    const stub = installChromeStub({})
    const sent = []
    stub.setSendMessage(async (msg) => {
        sent.push(msg)
        // privacyUiSync taklidi: basarili istekte store hedef duruma doner.
        if (reply?.success) privacyStore().active = msg.enabled
        return reply
    })
    const app = createApp(PrivacyToggle)
    app.use(createTestPinia())
    app.use(createTestI18n())
    Object.assign(privacyStore(), state)
    const captured = captureInstance(app, 'PrivacyToggle')
    return { app, captured, sent }
}

describe('PrivacyToggle', () => {
    it('durumu aria-pressed ile bildirir', async () => {
        expect(await render(mount({ active: true }).app)).toContain('aria-pressed="true"')
        expect(await render(mount({ active: false }).app)).toContain('aria-pressed="false"')
    })

    it('aria-label iki durumda da SABIT, durum yalniz aria-pressed ile bildirilir (cift duyuru yok)', async () => {
        const acik = await render(mount({ active: true }).app)
        const kapali = await render(mount({ active: false }).app)
        expect(acik).toContain('aria-label="Private mode"')
        expect(kapali).toContain('aria-label="Private mode"')
        expect(acik).toContain('title="Leave private mode"')
        expect(kapali).toContain('title="Switch to private mode"')
    })

    it('bilgi ekrani gorulmediyse paneli acar, sayfa degismez, mesaj atmaz', async () => {
        const { app, captured, sent } = mount({ active: false, introSeen: false })
        await render(app)
        pageStore().currentPage = 'home'
        await captured.instance.setupState.toggle()
        expect(captured.instance.setupState.showIntro).toBe(true)
        expect(pageStore().currentPage).toBe('home')
        expect(sent).toEqual([])
    })

    it('panel kapaninca showIntro sifirlanir', async () => {
        const { app, captured } = mount({ active: false, introSeen: false })
        await render(app)
        await captured.instance.setupState.toggle()
        captured.instance.setupState.closeIntro()
        expect(captured.instance.setupState.showIntro).toBe(false)
    })

    it('kilit degil hayalet ikonu cizer', async () => {
        const html = await render(mount({ active: false }).app)
        expect(html).toContain('data-icon="ghost"')
        expect(html).not.toContain('M16.5 10.5V7a4.5 4.5 0 10-9 0v3.5')
    })

    // Gizli mod grafit karari (kullanici, 2026-10-26): ACIK hal (yalniz gizli modda gorunur) mor ve parlamali degil.
    // KAPALI hal normal modda gorundugu icin aynen kalir.
    it('acikken mor yok; gozler sabit beyaz degil (koyu temada beyaz hayalette kaybolurdu)', async () => {
        const html = await render(mount({ active: true }).app)
        expect(html).toContain('data-icon="ghost"')
        expect(html).not.toMatch(/\b(violet|purple|indigo|fuchsia)-\d/)
        expect(html).not.toContain('fill="#fff"')
    })

    it('acikken parlama (drop-shadow) yok', () => {
        const kaynak = readFileSync(new URL('./PrivacyToggle.vue', import.meta.url), 'utf8')
        expect(kaynak).not.toMatch(/drop-shadow/)
    })

    it('KONTROL: kapali hal (normal mod) degismedi, ustune gelince mor', async () => {
        const html = await render(mount({ active: false }).app)
        expect(html).toContain('hover:text-violet-600 dark:hover:text-violet-300')
    })

    it('gizlideyken cikis mesaji atar ve home\'a doner', async () => {
        const { app, captured, sent } = mount({ active: true, introSeen: true })
        await render(app)
        pageStore().currentPage = 'select_asset'
        await captured.instance.setupState.toggle()
        expect(sent).toEqual([{ type: 'PRIVACY_MODE_SET', enabled: false }])
        expect(pageStore().currentPage).toBe('home')
    })

    it('bilgi ekrani gorulduyse dogrudan giris mesaji atar ve home\'a doner', async () => {
        const { app, captured, sent } = mount({ active: false, introSeen: true })
        await render(app)
        pageStore().currentPage = 'select_asset'
        await captured.instance.setupState.toggle()
        expect(sent).toEqual([{ type: 'PRIVACY_MODE_SET', enabled: true }])
        expect(pageStore().currentPage).toBe('home')
    })

    // P5 (spec 4.9): cikista ag geri yuklenir ama uiSync.adoptNetwork Takas / Kopru secimlerini
    // TEMIZLEMEZ (applyNetworkChange temizler). Gizli oturumda baska agda secilmis token, geri
    // yuklenen agda yoktur; kalirsa yanlis zincirin adresine islem kurulurdu.
    const doldur = () => {
        const crypto = cryptoStore()
        crypto.swap.inToken = { symbol: 'USDC', chainId: 137 }
        crypto.swap.outToken = { symbol: 'USDT', chainId: 137 }
        crypto.bridge.inToken = { symbol: 'ETH', chainId: 137 }
        crypto.bridge.outToken = { symbol: 'SOL' }
        crypto.bridge.toChain = 1
        crypto.bridge.amount = 5
        return crypto
    }
    const bosSecim = { swap: { inToken: null, outToken: null }, bridge: { inToken: null, outToken: null, toChain: null, amount: 0 } }

    it('gizli moddan CIKISTA Takas ve Kopru secimleri sifirlanir', async () => {
        const { app, captured } = mount({ active: true, introSeen: true })
        await render(app)
        const crypto = doldur()
        await captured.instance.setupState.toggle()
        expect({ swap: crypto.swap, bridge: crypto.bridge }).toEqual(bosSecim)
        expect(pageStore().currentPage).toBe('home')
    })

    it('KONTROL: gizli moda GIRISTE secimlere dokunulmaz', async () => {
        const { app, captured } = mount({ active: false, introSeen: true })
        await render(app)
        const crypto = doldur()
        await captured.instance.setupState.toggle()
        expect(crypto.swap.inToken).toEqual({ symbol: 'USDC', chainId: 137 })
        expect(crypto.bridge.toChain).toBe(1)
        expect(crypto.bridge.amount).toBe(5)
    })

    it('KONTROL: cikis BASARISIZSA (ag degismedi) secimler korunur', async () => {
        vi.stubGlobal('alert', vi.fn())
        const { app, captured } = mount({ active: true, introSeen: true }, { success: false, error: 'WALLET_LOCKED' })
        await render(app)
        const crypto = doldur()
        await captured.instance.setupState.toggle()
        expect(crypto.swap.inToken).toEqual({ symbol: 'USDC', chainId: 137 })
        expect(crypto.bridge.amount).toBe(5)
    })

    it('hatada cevrilmis mesaji gosterir, sayfada kalir; bilinmeyen kod generic metne duser', async () => {
        for (const [kod, metin] of [
            ['WALLET_LOCKED', 'Unlock your wallet first.'],
            ['INVALID_ENABLED', 'Private mode couldn\'t be changed. Try again.'],
            ['PRIVATE_DAPP_BLOCKED', 'Private mode couldn\'t be changed. Try again.'],
        ]) {
            const alertMock = vi.fn()
            vi.stubGlobal('alert', alertMock)
            const { app, captured } = mount({ active: false, introSeen: true }, { success: false, error: kod })
            await render(app)
            pageStore().currentPage = 'select_asset'
            await captured.instance.setupState.toggle()
            expect(alertMock).toHaveBeenCalledWith(metin)
            expect(pageStore().currentPage).toBe('select_asset')
        }
    })

    it('mesaj gonderimi hata firlatirsa generic metin gosterir ve dugme tekrar kullanilabilir kalir', async () => {
        const alertMock = vi.fn()
        vi.stubGlobal('alert', alertMock)
        const stub = installChromeStub({})
        stub.setSendMessage(async () => { throw new Error('ag yok') })
        const app = createApp(PrivacyToggle)
        app.use(createTestPinia())
        app.use(createTestI18n())
        Object.assign(privacyStore(), { active: false, introSeen: true })
        const captured = captureInstance(app, 'PrivacyToggle')
        await render(app)
        await captured.instance.setupState.toggle()
        expect(alertMock).toHaveBeenCalledWith("Private mode couldn't be changed. Try again.")
        expect(captured.instance.setupState.busy).toBe(false)
    })
})
