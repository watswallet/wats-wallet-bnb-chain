// AnalyticsNotice.vue -- bir kerelik "kullanim istatistigi" bilgilendirme karti.
//
// KOK NEDEN: ping varsayilan ACIK; kullaniciya bunu SOYLEYEN ve tek tikla KAPATTIRAN
// yuzey bu kart. Gorunurlugu (bayrak + goruldu isareti) ve iki dugmenin DEPOYA yazdigi
// seyi gercek render ile olceriz; kaynak taramasi "Kapat kimligi siler mi" sorusunu
// yanitlayamaz.
//
// 'vue' mock'u BURADA olmak ZORUNDA (bkz. ssrRender.js): onMounted -> onServerPrefetch
// aliasi olmadan kart denetimi hic kosmaz ve hep gizli gorunurdu.
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

afterEach(() => {
    delete globalThis.chrome
    vi.unstubAllEnvs()
    vi.resetModules()
})

// Bayrak derleme sabiti: her durumda modulleri taze yukleriz (bkz. Preferences testi).
async function kur({ bayrak = 'true', depo = {}, locale = 'tr', okumalariSay = false } = {}) {
    vi.resetModules()
    vi.stubEnv('VITE_ANALYTICS_ENABLED', bayrak)
    const ssr = await import('../test-utils/ssrRender.js')
    const { default: Notice } = await import('./AnalyticsNotice.vue')
    const stub = ssr.installChromeStub(depo)
    // Okuma sayaci: bayrak kapaliyken depoya OKUMA bile gitmedigini olcmek icin.
    let okumalar = 0
    if (okumalariSay) {
        const gercekGet = globalThis.chrome.storage.local.get
        globalThis.chrome.storage.local.get = (...a) => { okumalar++; return gercekGet(...a) }
    }
    const app = ssr.createApp(Notice)
    app.use(ssr.createTestPinia())
    app.use(ssr.createTestI18n(locale))
    const captured = ssr.captureInstance(app, 'AnalyticsNotice')
    const html = await ssr.render(app)
    return { html, stub, captured, okumalar: () => okumalar }
}

const decode = (h) => h.replace(/&#39;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

describe('AnalyticsNotice.vue -- gorunurluk', () => {
    it('bayrak acik ve goruldu isareti yok -> gorunur, tr metniyle', async () => {
        const { html } = await kur()
        const t = decode(html)
        expect(t).toContain('Kullanım istatistikleri')
        expect(t).toContain('Bu istatistiklere adresleriniz, anahtarlarınız veya bakiyeniz asla dahil edilmez.')
        expect(t).toContain('Tamam')
        // NEDEN 'Istatistikleri kapat': ayni ekrandaki Gelismeler kartlarinin kapatma isaretiyle karismasin.
        expect(t).toContain('İstatistikleri kapat')
    })

    it('en metni de var', async () => {
        const { html } = await kur({ locale: 'en' })
        const t = decode(html)
        expect(t).toContain('Usage statistics')
        expect(t).toContain('Your addresses, keys or balances are never included in these statistics.')
        expect(t).toContain('Turn off statistics')
    })

    it('goruldu isareti true -> gizli', async () => {
        const { html } = await kur({ depo: { analytics_notice_seen: true } })
        expect(decode(html)).not.toContain('Kullanım istatistikleri')
    })

    it('bayrak kapali -> hic render edilmez ve depoya dokunulmaz', async () => {
        const { html, stub, okumalar } = await kur({ bayrak: 'false', okumalariSay: true })
        expect(decode(html)).not.toContain('Kullanım istatistikleri')
        expect(stub.localStore).toEqual({})
        // NEDEN okuma sayilir: yazma olmasa da bayrak kapaliyken depo okumak gereksiz is.
        expect(okumalar()).toBe(0)
    })

    // NEDEN kaynak taramasi: bayrak ikinci kez v-if'te de denetlenir (derinlemesine savunma);
    // onMounted erken donusu varken bu kosul render ile ayrica olculemez.
    it('v-if bayragi gorunurlukten bagimsiz da denetler', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(fileURLToPath(new URL('./AnalyticsNotice.vue', import.meta.url)), 'utf8')
        expect(kaynak).toContain('v-if="ANALYTICS_ENABLED && gorunur"')
    })

    // NEDEN gizli: tercih zaten kapaliyken kart 'gonderiyoruz' derse yanlis ifade olur
    // (kullanici kartin kendi ipucuyla Ayarlar > Tercihler'den kapatip Home'a donebilir).
    it('analitik zaten KAPALI (analytics_enabled === false) -> kart gizli', async () => {
        const { html } = await kur({ depo: { analytics_enabled: false } })
        expect(decode(html)).not.toContain('Kullanım istatistikleri')
    })

    it('analytics_enabled kaydi yoksa (varsayilan ACIK) kart gorunur', async () => {
        const { html } = await kur({ depo: { analytics_state: { installId: 'x' } } })
        expect(decode(html)).toContain('Kullanım istatistikleri')
    })

    it('bayrak kapaliyken onChanged dinleyicisi de kurulmaz', async () => {
        const { stub } = await kur({ bayrak: 'false' })
        expect(stub.changeListenerCount()).toBe(0)
    })
})

// Kart acik dururken baska yuzeyde (Tercihler, baska popup/panel) yapilan degisiklik
// kartin gorunurlugune yansir.
describe('AnalyticsNotice.vue -- onChanged senkronu', () => {
    it('acilista dinleyici kurulur', async () => {
        const { stub } = await kur()
        expect(stub.changeListenerCount()).toBe(1)
    })

    it('goruldu isareti disaridan yazilinca kart kapanir', async () => {
        const { stub, captured } = await kur()
        expect(captured.instance.setupState.gorunur).toBe(true)
        stub.emitStorageChange({ analytics_notice_seen: { newValue: true } })
        expect(captured.instance.setupState.gorunur).toBe(false)
    })

    it('analitik disaridan kapatilinca kart kapanir; yeniden acilinca (isaret yoksa) geri gelir', async () => {
        const { stub, captured } = await kur()
        stub.emitStorageChange({ analytics_enabled: { newValue: false } })
        expect(captured.instance.setupState.gorunur).toBe(false)
        stub.emitStorageChange({ analytics_enabled: { newValue: true } })
        expect(captured.instance.setupState.gorunur).toBe(true)
    })

    it('kayit silinirse (storage.clear) varsayilan ACIK sayilir', async () => {
        const { stub, captured } = await kur({ depo: { analytics_enabled: false } })
        expect(captured.instance.setupState.gorunur).toBe(false)
        stub.emitStorageChange({ analytics_enabled: { newValue: undefined } })
        expect(captured.instance.setupState.gorunur).toBe(true)
    })

    it("baska alan ('sync') ya da ilgisiz anahtar karti DEGISTIRMEZ", async () => {
        const { stub, captured } = await kur()
        stub.emitStorageChange({ analytics_notice_seen: { newValue: true } }, 'sync')
        stub.emitStorageChange({ analytics_state: { newValue: { installId: 'z' } } })
        expect(captured.instance.setupState.gorunur).toBe(true)
    })

    it('dinleyici onUnmounted ile kaldirilir (kaynak taramasi: SSR unmount calistirmaz)', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(fileURLToPath(new URL('./AnalyticsNotice.vue', import.meta.url)), 'utf8')
        expect(kaynak).toMatch(/onUnmounted\(\s*\(\)\s*=>/)
        expect(kaynak).toContain('onChanged?.removeListener?.(depoDegisti)')
        expect(kaynak).toContain('onChanged?.addListener?.(depoDegisti)')
    })
})

// SSR HTML'inde @click yok: iki dugmenin isleyicisi yer degistirse ('Kapat' sessizce yalniz
// 'goruldu' yazsa) davranis testleri yesil kalirdi. Kartin en kritik gizlilik baglantisi
// kaynak duzeyinde kilitlenir: birincil dugme 'tamam', ikincil dugme 'kapat'.
describe('AnalyticsNotice.vue -- dugme / isleyici baglantisi', () => {
    async function kaynakOku() {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        return readFileSync(fileURLToPath(new URL('./AnalyticsNotice.vue', import.meta.url)), 'utf8')
    }

    it('birincil dugme (analyticsNotice.ok) @click="tamam" ile baglidir', async () => {
        const kaynak = await kaynakOku()
        expect(kaynak).toMatch(/<button\s[^>]*@click="tamam"[^>]*>\s*\{\{\s*\$t\('analyticsNotice\.ok'\)\s*\}\}/)
    })

    it('ikincil dugme (analyticsNotice.turnOff) @click="kapat" ile baglidir', async () => {
        const kaynak = await kaynakOku()
        expect(kaynak).toMatch(/<button\s[^>]*@click="kapat"[^>]*>\s*\{\{\s*\$t\('analyticsNotice\.turnOff'\)\s*\}\}/)
    })
})

// Metin vaatleri: nginx access_log acikken 'size baglanamaz' kesin bir vaat degildi;
// vaatler daraltildi. Gercek ceviri dosyalarindan okunur (kart + Tercihler).
describe('analitik metinleri -- daraltilmis vaatler', () => {
    async function dil() {
        const tr = (await import('../i18n/locales/tr.json')).default
        const en = (await import('../i18n/locales/en.json')).default
        return { tr, en }
    }

    it('kart govdesi ve Tercihler aciklamasi: "bu istatistiklere ... dahil edilmez"', async () => {
        const { tr, en } = await dil()
        expect(tr.analyticsNotice.body).toContain('Bu istatistiklere adresleriniz, anahtarlarınız veya bakiyeniz asla dahil edilmez.')
        expect(en.analyticsNotice.body).toContain('Your addresses, keys or balances are never included in these statistics.')
        expect(tr.settings.preferences.analyticsDesc).toContain('Bu istatistiklere adresleriniz, anahtarlarınız veya bakiyeniz asla dahil edilmez.')
        expect(en.settings.preferences.analyticsDesc).toContain('Your addresses, keys or balances are never included in these statistics.')
    })

    it('Tercihler: "yalnizca toplu istatistiklerde kullanilir"; "size baglanamaz" vaadi YOK', async () => {
        const { tr, en } = await dil()
        expect(tr.settings.preferences.analyticsDesc).toContain('daha önce gönderilen sayımlar yalnızca toplu istatistiklerde kullanılır.')
        expect(en.settings.preferences.analyticsDesc).toContain('counts already sent are only used in aggregate statistics.')
        expect(tr.settings.preferences.analyticsDesc).not.toContain('bağlanamaz')
        expect(en.settings.preferences.analyticsDesc).not.toContain('cannot be linked')
    })

    it('eski kesin vaat ("asla gonderilmez") kalmadi', async () => {
        const { tr, en } = await dil()
        for (const m of [tr.analyticsNotice.body, tr.settings.preferences.analyticsDesc]) {
            expect(m).not.toMatch(/gönderilmez/i)
        }
        for (const m of [en.analyticsNotice.body, en.settings.preferences.analyticsDesc]) {
            expect(m).not.toMatch(/never sent/i)
        }
    })

    it('ikincil dugme etiketi: tr "İstatistikleri kapat", en "Turn off statistics"', async () => {
        const { tr, en } = await dil()
        expect(tr.analyticsNotice.turnOff).toBe('İstatistikleri kapat')
        expect(en.analyticsNotice.turnOff).toBe('Turn off statistics')
    })
})

describe('AnalyticsNotice.vue -- Tamam', () => {
    it('isareti yazar, tercihe DOKUNMAZ, kart kapanir', async () => {
        const { stub, captured } = await kur({ depo: { analytics_state: { installId: 'x' } } })
        expect(captured.instance.setupState.gorunur).toBe(true)

        await captured.instance.setupState.tamam()

        expect(stub.localStore.analytics_notice_seen).toBe(true)
        expect(stub.localStore.analytics_enabled).toBeUndefined()
        expect(stub.localStore.analytics_state).toEqual({ installId: 'x' })
        expect(captured.instance.setupState.gorunur).toBe(false)
    })

    it('yazma hatasinda kart ACIK kalir', async () => {
        const { captured } = await kur()
        globalThis.chrome.storage.local.set = async () => { throw new Error('kota') }
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

        await captured.instance.setupState.tamam()

        expect(captured.instance.setupState.gorunur).toBe(true)
        hata.mockRestore()
    })
})

describe('AnalyticsNotice.vue -- Kapat', () => {
    it('tercihi kapatir, kimligi SILER, isareti yazar, kart kapanir', async () => {
        const { stub, captured } = await kur({ depo: { analytics_state: { installId: 'x', lastPingDay: '2026-10-15' } } })

        await captured.instance.setupState.kapat()

        expect(stub.localStore.analytics_enabled).toBe(false)
        expect(stub.localStore.analytics_state).toBeUndefined()
        expect(stub.localStore.analytics_notice_seen).toBe(true)
        expect(captured.instance.setupState.gorunur).toBe(false)
    })

    it('yazma hatasinda kart ACIK kalir (ekran yalan soylemesin)', async () => {
        const { captured } = await kur()
        globalThis.chrome.storage.local.set = async () => { throw new Error('kota') }
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

        await captured.instance.setupState.kapat()

        expect(captured.instance.setupState.gorunur).toBe(true)
        hata.mockRestore()
    })

    it('isaret yazimi patlarsa kart ACIK kalir ama tercih zaten kapali', async () => {
        const { stub, captured } = await kur()
        const gercekSet = globalThis.chrome.storage.local.set
        globalThis.chrome.storage.local.set = async (o) => {
            if ('analytics_notice_seen' in o) throw new Error('kota')
            return gercekSet(o)
        }
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})

        await captured.instance.setupState.kapat()

        expect(captured.instance.setupState.gorunur).toBe(true)
        expect(stub.localStore.analytics_enabled).toBe(false)
        hata.mockRestore()
    })
})

// Kart Home'a baglanmazsa hicbir kullanici gormez; bilesen testleri bunu yakalamaz.
describe('AnalyticsNotice.vue -- Home baglantisi', () => {
    it('Home.vue karti, Gelismeler seridinden ONCE yerlestirir', async () => {
        const { readFileSync } = await import('node:fs')
        const { fileURLToPath } = await import('node:url')
        const kaynak = readFileSync(fileURLToPath(new URL('./Home.vue', import.meta.url)), 'utf8')
        const kart = kaynak.indexOf('<AnalyticsNotice />')
        expect(kart).toBeGreaterThan(-1)
        expect(kart).toBeLessThan(kaynak.indexOf('<NewsStrip />'))
        expect(kaynak).toContain("import AnalyticsNotice from './AnalyticsNotice.vue'")
    })
})
