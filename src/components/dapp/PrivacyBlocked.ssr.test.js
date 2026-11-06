import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import PrivacyBlocked from './PrivacyBlocked.vue'

afterEach(() => { delete globalThis.chrome })

// Normal modda her yontemin onay ekraninin kullanici reddinde sayfaya gonderdigi
// TAM nesneler (ConnectDapp.vue:321, Sign.vue:214, Dapp.vue:1360, SwitchChain.vue:191).
// Gizli mod engeli, saklanan istegin YONTEMINE gore ayni nesneyi gondermeli: sayfa
// "reddetti" ile "gizli moddayim" arasindaki farki hicbir yontemde goremez.
const KULLANICI_RED_HATASI = { code: 4001, message: 'User rejected the connection' }
const YONTEM_RED_HATALARI = [
    ['eth_requestAccounts', { code: 4001, message: 'User rejected the connection' }],
    // personal_sign / eth_sendTransaction YOK: gizli modda bu metotlar popup ACMAZ, her site
    // icin aninda 4100 alir (A-I2); bu ekran onlar icin hic acilmaz.
    ['wallet_switchEthereumChain', { code: 4001, message: 'User rejected the chain switch' }],
]

function mount(method, modeSetReply = { success: true }) {
    const request = { type: 'PRIVACY_BLOCKED', id: 'r-1', origin: 'https://site.example' }
    if (method !== undefined) request.method = method
    const stub = installChromeStub({ current_request: request })
    const sent = []
    stub.setSendMessage(async (msg) => {
        sent.push(msg)
        if (msg.type === 'PRIVACY_MODE_SET') {
            if (modeSetReply instanceof Error) throw modeSetReply
            return modeSetReply
        }
        return { success: true }
    })
    const app = createApp(PrivacyBlocked)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const captured = captureInstance(app, 'PrivacyBlocked')
    return { app, captured, sent }
}

describe('PrivacyBlocked', () => {
    it('site adini ve aciklamayi gosterir', async () => {
        const { app } = mount()
        const html = await render(app)
        expect(html).toContain('site.example')
        expect(html).toContain('Private mode is on')
    })

    it('Kapat: istegi normal kullanici reddiyle reddeder ve home\'a doner', async () => {
        const { app, captured, sent } = mount()
        await render(app)
        // Anlamli bir gecis: sayfa home DEGILKEN baslat.
        pageStore().currentPage = 'privacy_blocked'
        await captured.instance.setupState.reject()
        expect(sent).toEqual([{ type: 'CONNECT_WALLET_REJECTED', requestId: 'r-1', status: 'error', error: KULLANICI_RED_HATASI }])
        expect(pageStore().currentPage).toBe('home')
    })

    it('Gizli moddan cik: once PRIVACY_MODE_SET false, sonra ayni ret, sonra home', async () => {
        const { app, captured, sent } = mount()
        await render(app)
        pageStore().currentPage = 'privacy_blocked'
        await captured.instance.setupState.exitPrivacy()
        expect(sent).toEqual([
            { type: 'PRIVACY_MODE_SET', enabled: false },
            { type: 'CONNECT_WALLET_REJECTED', requestId: 'r-1', status: 'error', error: KULLANICI_RED_HATASI },
        ])
        expect(pageStore().currentPage).toBe('home')
    })

    it('Gizli moddan cik basarisiz olursa cevrilmis hatayi gosterir, istegi REDDETMEZ, sayfada kalir', async () => {
        const beklenen = [
            [{ success: false, error: 'WALLET_LOCKED' }, 'Unlock your wallet first.'],
            [{ success: false, error: 'PRIVATE_DAPP_BLOCKED' }, "Private mode couldn't be changed. Try again."],
            [{ success: false, error: 'INVALID_ENABLED' }, "Private mode couldn't be changed. Try again."],
            [null, "Private mode couldn't be changed. Try again."],
            [new Error('ag yok'), "Private mode couldn't be changed. Try again."],
        ]
        for (const [cevap, metin] of beklenen) {
            const { app, captured, sent } = mount(undefined, cevap)
            await render(app)
            pageStore().currentPage = 'privacy_blocked'
            await captured.instance.setupState.exitPrivacy()
            expect(captured.instance.setupState.error).toBe(metin)
            // Ret gonderilirse onay penceresi kapanir ve hata hic gorunmez: istek BEKLEMEDE kalir.
            expect(sent).toEqual([{ type: 'PRIVACY_MODE_SET', enabled: false }])
            expect(sent.some((m) => m.type === 'CONNECT_WALLET_REJECTED')).toBe(false)
            expect(pageStore().currentPage).toBe('privacy_blocked')
            expect(captured.instance.setupState.busy).toBe(false)
        }
    })

    it('basarisiz cikistan sonra hata gorunur ve iki dugme de etkin; Kapat yontemin normal retini gonderir', async () => {
        const { app, captured, sent } = mount('wallet_switchEthereumChain', { success: false, error: 'WALLET_LOCKED' })
        await render(app)
        pageStore().currentPage = 'privacy_blocked'
        await captured.instance.setupState.exitPrivacy()
        // Sablon: hata `v-if="error"` ile, iki dugme `:disabled="busy"` ile bagli (SSR
        // ayni ornegi ikinci kez cizemez; bu yuzden suren durum dogrudan okunur).
        expect(captured.instance.setupState.error).toBe('Unlock your wallet first.')
        expect(captured.instance.setupState.busy).toBe(false)
        await captured.instance.setupState.reject()
        expect(sent).toEqual([
            { type: 'PRIVACY_MODE_SET', enabled: false },
            { type: 'CONNECT_WALLET_REJECTED', requestId: 'r-1', status: 'error', error: { code: 4001, message: 'User rejected the chain switch' } },
        ])
        expect(pageStore().currentPage).toBe('home')
    })

    it('basarisiz cikistan sonra yeniden denenip basarili olursa istek reddedilir, hata silinir, home', async () => {
        const replies = [{ success: false, error: 'WALLET_LOCKED' }, { success: true }]
        const request = { type: 'PRIVACY_BLOCKED', id: 'r-1', origin: 'https://site.example', method: 'wallet_switchEthereumChain' }
        const stub = installChromeStub({ current_request: request })
        const sent = []
        stub.setSendMessage(async (msg) => {
            sent.push(msg)
            return msg.type === 'PRIVACY_MODE_SET' ? replies.shift() : { success: true }
        })
        const app = createApp(PrivacyBlocked)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const captured = captureInstance(app, 'PrivacyBlocked')
        await render(app)
        pageStore().currentPage = 'privacy_blocked'
        await captured.instance.setupState.exitPrivacy()
        expect(captured.instance.setupState.error).toBe('Unlock your wallet first.')
        await captured.instance.setupState.exitPrivacy()
        expect(captured.instance.setupState.error).toBe('')
        expect(sent.map((m) => m.type)).toEqual(['PRIVACY_MODE_SET', 'PRIVACY_MODE_SET', 'CONNECT_WALLET_REJECTED'])
        expect(sent[2].error).toEqual({ code: 4001, message: 'User rejected the chain switch' })
        expect(pageStore().currentPage).toBe('home')
    })

    it('Gizli moddan cik basariliysa hata gostermez', async () => {
        const { app, captured } = mount()
        await render(app)
        await captured.instance.setupState.exitPrivacy()
        expect(captured.instance.setupState.error).toBe('')
    })

    it.each(YONTEM_RED_HATALARI)('%s: Kapat ve Gizli moddan cik normal ekranin ret nesnesini gonderir', async (method, beklenen) => {
        for (const dugme of ['reject', 'exitPrivacy']) {
            const { app, captured, sent } = mount(method)
            await render(app)
            pageStore().currentPage = 'privacy_blocked'
            await captured.instance.setupState[dugme]()
            const ret = sent.find((m) => m.type === 'CONNECT_WALLET_REJECTED')
            expect(ret).toEqual({ type: 'CONNECT_WALLET_REJECTED', requestId: 'r-1', status: 'error', error: beklenen })
            expect(JSON.stringify(ret.error)).not.toMatch(/private|gizli|privacy/i)
            expect(pageStore().currentPage).toBe('home')
        }
    })

    it('yontem yoksa ya da bilinmiyorsa baglanti reddine duser', async () => {
        for (const method of [undefined, 'eth_chainId', 'solana_connect', 'personal_sign', 'eth_sendTransaction', 42]) {
            const { app, captured, sent } = mount(method)
            await render(app)
            await captured.instance.setupState.reject()
            expect(sent[0].error).toEqual(KULLANICI_RED_HATASI)
        }
    })

    it('sayfaya giden hata nesnesi gizli mod metni ya da PRIVATE_* kodu tasimaz', async () => {
        const { app, captured, sent } = mount()
        await render(app)
        await captured.instance.setupState.reject()
        const hata = sent[0].error
        expect(Object.keys(hata).sort()).toEqual(['code', 'message'])
        expect(JSON.stringify(hata)).not.toMatch(/private|gizli|privacy/i)
    })
})
