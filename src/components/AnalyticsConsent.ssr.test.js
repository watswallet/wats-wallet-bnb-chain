// AnalyticsConsent.vue -- gizlilik onayi popup'i. Gorunurluk (bayrak + karar yok) ve
// iki dugmenin DEPOYA yazdigi gercek render ile olculur.
// 'vue' mock'u BURADA olmak ZORUNDA (bkz. ssrRender.js): onMounted -> onServerPrefetch.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

afterEach(() => {
    delete globalThis.chrome
    vi.unstubAllEnvs()
    vi.resetModules()
})

async function kur({ bayrak = 'true', depo = {}, locale = 'tr', okumalariSay = false } = {}) {
    vi.resetModules()
    vi.stubEnv('VITE_ANALYTICS_ENABLED', bayrak)
    const ssr = await import('../test-utils/ssrRender.js')
    const { default: Consent } = await import('./AnalyticsConsent.vue')
    const stub = ssr.installChromeStub(depo)
    let okumalar = 0
    if (okumalariSay) {
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = (...a) => { okumalar++; return gercekGet(...a) }
    }
    const app = ssr.createApp(Consent)
    app.use(ssr.createTestPinia())
    app.use(ssr.createTestI18n(locale))
    const captured = ssr.captureInstance(app, 'AnalyticsConsent')
    const html = await ssr.render(app)
    return { html, stub, captured, okumalar: () => okumalar }
}

const decode = (h) => h.replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

describe('AnalyticsConsent.vue -- gorunurluk', () => {
    it('bayrak acik ve karar yok -> gorunur, birebir tr metniyle', async () => {
        const { html } = await kur()
        const t = decode(html)
        expect(t).toContain('Gizlilik politikamızı güncelledik')
        expect(t).toContain('Uygulamayı geliştirmek için kurulum kimliği, sürüm, dil ve işlem sayılarını topluyoruz.')
        expect(t).toContain('Kabul et')
        expect(t).toContain('Reddet')
        expect(t).toContain('Politikayı oku')
        expect(t).not.toMatch(/anonim/i)
    })

    it('politika baglantisi yeni sekmede acilir', async () => {
        const { html } = await kur()
        const t = decode(html)
        expect(t).toContain('href="https://watswallet.github.io/privacy-policy/"')
        expect(t).toContain('target="_blank"')
        expect(t).toContain('noopener')
    })

    it('kabul (true) verilmis -> gizli', async () => {
        const { html } = await kur({ depo: { analytics_enabled: true } })
        expect(decode(html)).not.toContain('Gizlilik politikamızı güncelledik')
    })

    it('ret (false) verilmis -> gizli', async () => {
        const { html } = await kur({ depo: { analytics_enabled: false } })
        expect(decode(html)).not.toContain('Gizlilik politikamızı güncelledik')
    })

    it('bayrak kapali -> hic render edilmez, depoya dokunulmaz, dinleyici kurulmaz', async () => {
        const { html, stub, okumalar } = await kur({ bayrak: 'false', okumalariSay: true })
        expect(decode(html)).not.toContain('Gizlilik politikamızı güncelledik')
        expect(stub.localStore).toEqual({})
        expect(okumalar()).toBe(0)
        expect(stub.changeListenerCount()).toBe(0)
    })

    it('v-if bayragi gorunurlukten bagimsiz da denetler', () => {
        const kaynak = readFileSync(fileURLToPath(new URL('./AnalyticsConsent.vue', import.meta.url)), 'utf8')
        expect(kaynak).toContain('v-if="ANALYTICS_ENABLED && gorunur"')
    })
})

describe('AnalyticsConsent.vue -- dugmeler', () => {
    it('Kabul et: analytics_enabled=true yazar, popup kapanir', async () => {
        const { stub, captured } = await kur()
        expect(captured.instance.setupState.gorunur).toBe(true)
        await captured.instance.setupState.kabulEt()
        expect(stub.localStore.analytics_enabled).toBe(true)
        expect(captured.instance.setupState.gorunur).toBe(false)
    })

    it('Reddet: analytics_enabled=false yazar, kimlik ve sayac silinir, popup kapanir', async () => {
        const { stub, captured } = await kur({ depo: { analytics_state: { installId: 'x' }, analytics_counts: { swap: 1 } } })
        await captured.instance.setupState.reddet()
        expect(stub.localStore.analytics_enabled).toBe(false)
        expect(stub.localStore.analytics_state).toBeUndefined()
        expect(stub.localStore.analytics_counts).toBeUndefined()
        expect(captured.instance.setupState.gorunur).toBe(false)
    })

    it('kapatma karar degildir: gosterimde depoya hicbir sey yazilmaz', async () => {
        const { stub } = await kur()
        expect(stub.localStore).toEqual({})
    })
})

describe('AnalyticsConsent.vue -- onChanged senkronu', () => {
    it('karar disaridan verilince popup kapanir; kayit silinirse geri gelir', async () => {
        const { stub, captured } = await kur()
        stub.emitStorageChange({ analytics_enabled: { newValue: true } })
        expect(captured.instance.setupState.gorunur).toBe(false)
        stub.emitStorageChange({ analytics_enabled: { newValue: undefined } })
        expect(captured.instance.setupState.gorunur).toBe(true)
    })

    it("baska alan ('sync') ya da ilgisiz anahtar popup'i DEGISTIRMEZ", async () => {
        const { stub, captured } = await kur()
        stub.emitStorageChange({ analytics_enabled: { newValue: true } }, 'sync')
        stub.emitStorageChange({ analytics_state: { newValue: { installId: 'z' } } })
        expect(captured.instance.setupState.gorunur).toBe(true)
    })
})

describe('AnalyticsConsent -- yerlesim', () => {
    const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    it('Home ve onboarding baglar; eski kart ve isaret kalmadi', () => {
        // Gizli Hesap aktifken popup HIC cizilmez (eski kartin kullandigi kapi: privacy.active)
        expect(oku('./Home.vue')).toContain('<AnalyticsConsent v-if="!privacy.active" />')
        expect(oku('./Home.vue')).not.toContain('AnalyticsNotice')
        expect(oku('./onboarding/index.vue')).toContain(`<AnalyticsConsent v-if="status === 'start'" />`)
        expect(oku('../utils/analyticsPing.js')).not.toContain('analytics_notice_seen')
    })
    it('Dapp onay pencereleri ve kilit ekrani popup icermez', () => {
        for (const f of ['./Dapp.vue', './Login.vue']) expect(oku(f)).not.toContain('AnalyticsConsent')
    })
})

describe('analyticsConsent 12 dilde', () => {
    const kodlar = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'vi', 'zh-CN']
    it.each(kodlar)('%s: bes anahtar dolu, eski analyticsNotice yok, anonim denmiyor', (kod) => {
        const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${kod}.json`, import.meta.url)), 'utf8'))
        for (const k of ['title', 'body', 'accept', 'decline', 'readPolicy']) {
            expect(typeof j.analyticsConsent[k]).toBe('string')
            expect(j.analyticsConsent[k].trim()).not.toBe('')
        }
        expect(j.analyticsNotice).toBeUndefined()
        expect(JSON.stringify(j.analyticsConsent)).not.toMatch(/anonim|anonym|anónim|匿名|익명|аноним|ẩn danh|anonymous/i)
    })
})

// Tercihler > analitik aciklamasinin daraltilmis vaatleri (eski AnalyticsNotice testinden tasindi).
// nginx access_log acikken 'size baglanamaz' kesin bir vaat degildir; vaatler daraltildi.
// Gercek ceviri dosyalarindan okunur.
describe('Tercihler analyticsDesc -- daraltilmis vaatler', () => {
    const oku = (k) => JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${k}.json`, import.meta.url)), 'utf8')).settings.preferences.analyticsDesc

    it('adres/tutar/token/ag/islem ayrintisi bu istatistiklere ASLA dahil edilmez', () => {
        expect(oku('tr')).toContain('Adresleriniz, tutarlarınız, tokenleriniz, ağlarınız veya işlem ayrıntılarınız bu istatistiklere asla dahil edilmez.')
        expect(oku('en')).toContain('Your addresses, amounts, tokens, networks or transaction details are never included in these statistics.')
    })

    it('"yalnizca toplu istatistiklerde kullanilir" var; "size baglanamaz" ve eski kesin "gonderilmez" vaadi YOK', () => {
        expect(oku('tr')).toContain('yalnızca toplu istatistiklerde kullanılır.')
        expect(oku('en')).toContain('only used in aggregate statistics.')
        expect(oku('tr')).not.toContain('bağlanamaz')
        expect(oku('en')).not.toContain('cannot be linked')
        expect(oku('tr')).not.toContain('asla gönderilmez')
        expect(oku('en')).not.toContain('never sent')
    })
})
