import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// PRIVATE_ATS_SALE derleme sabitidir; bu dosyada mutlak getter ile acilip kapatilir (Header.privacy.ssr.test.js deseni).
const bayrak = vi.hoisted(() => ({ privateAtsSale: true }))
vi.mock('../../utils/featureFlags', async (importOriginal) => ({
    ...(await importOriginal()),
    get PRIVATE_ATS_SALE() { return bayrak.privateAtsSale },
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import { privacyStore } from '../../store/privacy'
import PrivacyIntro from './PrivacyIntro.vue'

afterEach(() => {
    delete globalThis.chrome
    bayrak.privateAtsSale = true
})

function mount(reply) {
    const stub = installChromeStub({})
    const sent = []
    const closed = []
    stub.setSendMessage(async (msg) => {
        sent.push(msg)
        // privacyUiSync taklidi: basarili istekte store hedef duruma doner.
        if (reply?.success) privacyStore().active = msg.enabled
        return reply
    })
    const app = createApp(PrivacyIntro, { props: { onClose: () => closed.push(true) } })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'PrivacyIntro')
    return { app, captured, sent, closed }
}

describe('PrivacyIntro', () => {
    it('bes siniri de gosterir', async () => {
        const html = await render(mount({ success: true }).app)
        // Kesme isareti iceren parcalar BILEREK secilmedi: SSR ciktisi onu &#39; olarak kacirir.
        for (const parca of ['Depositing and withdrawing', 'a VPN', 'such as an exchange', 'rely on SilentSwap', 'only on this device']) {
            expect(html).toContain(parca)
        }
    })

    // K13 (cok-ag spec 4.8): satin alma yolu acikken giris paneli "Gizlemedigi seyler" listesine altinci satiri ekler.
    it('PRIVATE_ATS_SALE ACIK: altinci sinir (ATS satin alma sunucusu adresi gorur) cizilir', async () => {
        const html = await render(mount({ success: true }).app)
        expect(html).toContain('If you buy ATS, the Wats sale server sees your Private Account address together with your IP.')
        expect((html.match(/pi-limit/g) || []).length).toBe(7)
    })

    it('PRIVATE_ATS_SALE KAPALI: satir CIZILMEZ, bes sinir bugunku gibi', async () => {
        bayrak.privateAtsSale = false
        const html = await render(mount({ success: true }).app)
        expect(html).not.toContain('Wats sale server')
        expect((html.match(/pi-limit/g) || []).length).toBe(6)
    })

    // sT18 (K7 bedeli): Para yuklerken ucret sunucusu iki adresi ayni IP'den gorebilir; bayraga BAGLI DEGIL.
    const FEE_EN = 'When you add funds, the Wats fee server can see your regular account and your Private Account address from the same IP.'
    const FEE_TR = "Para yüklerken ağ ücreti için Wats ödeme sunucusu normal hesabını ve Gizli Hesap adresini aynı IP'den görebilir."

    it('limitFeeServer iki dilde cizilir', async () => {
        const en = await render(mount({ success: true }).app)
        expect(en).toContain(FEE_EN)
        const stub = installChromeStub({})
        stub.setSendMessage(async () => ({ success: true }))
        const appTr = createApp(PrivacyIntro)
        appTr.use(createTestPinia())
        appTr.use(createTestI18n('tr'))
        const tr = await render(appTr)
        // SSR ciktisi kesme isaretini &#39; olarak kacirir.
        expect(tr).toContain(FEE_TR.replace("'", '&#39;'))
    })

    it.each([true, false])('limitFeeServer PRIVATE_ATS_SALE=%s iken de gorunur', async (acik) => {
        bayrak.privateAtsSale = acik
        const html = await render(mount({ success: true }).app)
        expect(html).toContain(FEE_EN)
    })

    it('limitFeeServer satiri limitNetwork satirindan hemen sonra gelir', async () => {
        bayrak.privateAtsSale = false
        const html = await render(mount({ success: true }).app)
        const ag = html.indexOf('Your internet connection (IP) is visible to providers')
        const ucret = html.indexOf(FEE_EN)
        const borsa = html.indexOf('such as an exchange')
        expect(ag).toBeGreaterThan(-1)
        expect(ucret).toBeGreaterThan(ag)
        expect(borsa).toBeGreaterThan(ucret)
    })

    it('ayri sayfa degil, dialog paneli olarak cizilir', async () => {
        const html = await render(mount({ success: true }).app)
        expect(html).toContain('role="dialog"')
        expect(html).toContain('aria-modal="true"')
    })

    it('basarida home\'a doner ve paneli kapatir', async () => {
        const { app, captured, sent, closed } = mount({ success: true })
        await render(app)
        pageStore().currentPage = 'select_asset'
        await captured.instance.setupState.enable()
        expect(sent).toEqual([{ type: 'PRIVACY_MODE_SET', enabled: true }])
        expect(pageStore().currentPage).toBe('home')
        expect(closed).toEqual([true])
    })

    it('hatada cevrilmis mesaji gosterir, panel acik kalir', async () => {
        const { app, captured, closed } = mount({ success: false, error: 'PRIVATE_NEEDS_HD_VAULT' })
        await render(app)
        pageStore().currentPage = 'home'
        await captured.instance.setupState.enable()
        expect(captured.instance.setupState.error).toBe('Private mode needs a wallet created from a recovery phrase.')
        expect(pageStore().currentPage).toBe('home')
        expect(closed).toEqual([])
    })

    it('vazgec mesaj atmadan kapatir; islem surerken kapatmaz', async () => {
        const { app, captured, sent, closed } = mount({ success: true })
        await render(app)
        captured.instance.setupState.busy = true
        captured.instance.setupState.dismiss()
        expect(closed).toEqual([])
        captured.instance.setupState.busy = false
        captured.instance.setupState.dismiss()
        expect(closed).toEqual([true])
        expect(sent).toEqual([])
    })

    it('mesaj gonderimi hata firlatirsa generic metin gosterir, dugme tekrar kullanilabilir kalir', async () => {
        const stub = installChromeStub({})
        stub.setSendMessage(async () => { throw new Error('ag yok') })
        const app = createApp(PrivacyIntro)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const captured = captureInstance(app, 'PrivacyIntro')
        await render(app)
        await captured.instance.setupState.enable()
        expect(captured.instance.setupState.error).toBe("Private mode couldn't be changed. Try again.")
        expect(captured.instance.setupState.busy).toBe(false)
    })

    it('bilinmeyen kodlar generic metne duser', async () => {
        for (const kod of ['INVALID_ENABLED', 'PRIVATE_DAPP_BLOCKED', undefined]) {
            const { app, captured } = mount({ success: false, error: kod })
            await render(app)
            await captured.instance.setupState.enable()
            expect(captured.instance.setupState.error).toBe('Private mode couldn\'t be changed. Try again.')
        }
    })
})
