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
        expect(t).toContain('Uygulamayı geliştirmek için günde bir kez şu bilgileri topluyoruz:')
        expect(t).toContain('Adres, tutar, token ve işlem içeriği gönderilmez.')
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
        const { html } = await kur({ depo: { analytics_enabled: true, analytics_consent_version: 2 } })
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

describe('AnalyticsConsent.vue -- onay durumlari', () => {
    const NOT = 'Metin güncellendi: cüzdanı açma, kilit açma, ekran, başarısız işlem ve ağ sayıları eklendi.'
    it('undecided: popup gorunur, updated notu YOK', async () => {
        const { html, captured } = await kur()
        expect(captured.instance.setupState.gorunur).toBe(true)
        expect(decode(html)).not.toContain(NOT)
    })
    it('reconsent (enabled true, surum yok): popup gorunur ve updated notu VAR', async () => {
        const { html, captured } = await kur({ depo: { analytics_enabled: true } })
        expect(captured.instance.setupState.gorunur).toBe(true)
        expect(decode(html)).toContain(NOT)
    })
    it('accepted (true + surum 2): popup yok', async () => {
        const { html, captured } = await kur({ depo: { analytics_enabled: true, analytics_consent_version: 2 } })
        expect(captured.instance.setupState.gorunur).toBe(false)
        expect(decode(html)).not.toContain(NOT)
    })
    it('declined (false, surumlu ya da surumsuz): popup yok', async () => {
        for (const depo of [{ analytics_enabled: false }, { analytics_enabled: false, analytics_consent_version: 1 }]) {
            const { captured } = await kur({ depo })
            expect(captured.instance.setupState.gorunur).toBe(false)
        }
    })
})

describe('AnalyticsConsent.vue -- dugmeler', () => {
    it('kabul: depoya TEK set enabled true + surum 2', async () => {
        const { stub, captured } = await kur({ depo: { analytics_enabled: true } })
        const setler = []
        const gercek = globalThis.chrome.storage.local.set
        globalThis.chrome.storage.local.set = (...a) => { setler.push(a[0]); return gercek(...a) }
        await captured.instance.setupState.kabulEt()
        expect(setler).toEqual([{ analytics_enabled: true, analytics_consent_version: 2 }])
        expect(stub.localStore.analytics_consent_version).toBe(2)
        expect(captured.instance.setupState.gorunur).toBe(false)
    })
    it('ret: false', async () => {
        const { stub, captured } = await kur({ depo: { analytics_enabled: true } })
        await captured.instance.setupState.reddet()
        expect(stub.localStore.analytics_enabled).toBe(false)
        expect(captured.instance.setupState.gorunur).toBe(false)
    })

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

const bekle = () => new Promise((r) => setTimeout(r, 0))

describe('AnalyticsConsent.vue -- onChanged senkronu', () => {
    it('karar disaridan verilince popup kapanir; kayit silinirse geri gelir', async () => {
        const { stub, captured } = await kur()
        stub.emitStorageChange({ analytics_enabled: { newValue: true }, analytics_consent_version: { newValue: 2 } })
        await bekle()
        expect(captured.instance.setupState.gorunur).toBe(false)
        stub.emitStorageChange({ analytics_enabled: { newValue: undefined } })
        await bekle()
        expect(captured.instance.setupState.gorunur).toBe(true)
    })

    it('depo degisimi (surum anahtari) popup durumunu canli gunceller', async () => {
        const { stub, captured } = await kur({ depo: { analytics_enabled: true, analytics_consent_version: 2 } })
        expect(captured.instance.setupState.gorunur).toBe(false)
        // Surum silinince eski onay yeniden onay bekler: popup gelir (enabled degismedi, yalniz surum).
        stub.emitStorageChange({ analytics_consent_version: { newValue: undefined } })
        await bekle()
        expect(captured.instance.setupState.gorunur).toBe(true)
        expect(captured.instance.setupState.yenidenOnay).toBe(true)
        const kaynak = readFileSync(fileURLToPath(new URL('./AnalyticsConsent.vue', import.meta.url)), 'utf8')
        expect(kaynak).toContain('ANALYTICS_CONSENT_VERSION_KEY in degisiklikler')
        expect(kaynak).toContain('readAnalyticsConsentState(chrome.storage.local)')
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
    it('background.js onChanged: yalniz analytics_enabled newValue false -> forgetQueued (surum degisimi silmez)', () => {
        const k = oku('../background.js')
        expect(k).toContain("changes.analytics_enabled?.newValue === false")
        const i = k.indexOf("changes.analytics_enabled?.newValue === false")
        const blok = k.slice(i - 120, i + 160)
        expect(blok).toContain('forgetQueued(chrome.storage.local)')
        expect(blok).not.toContain('analytics_consent_version')
    })
    it('Dapp onay pencereleri ve kilit ekrani popup icermez', () => {
        for (const f of ['./Dapp.vue', './Login.vue']) expect(oku(f)).not.toContain('AnalyticsConsent')
    })
})

describe('analyticsConsent 12 dilde', () => {
    const kodlar = ['de', 'en', 'es', 'fr', 'id', 'ja', 'ko', 'pt-BR', 'ru', 'tr', 'vi', 'zh-CN']
    it.each(kodlar)('%s: alti anahtar dolu, eski analyticsNotice yok, anonim denmiyor', (kod) => {
        const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${kod}.json`, import.meta.url)), 'utf8'))
        for (const k of ['title', 'body', 'accept', 'decline', 'readPolicy', 'updated']) {
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

    it('adres/tutar/token/islem ayrintisi asla dahil edilmez (ag artik haric DEGIL)', () => {
        expect(oku('tr')).toContain('Adresleriniz, tutarlarınız, tokenleriniz veya işlem ayrıntılarınız bu istatistiklere asla dahil edilmez.')
        expect(oku('tr')).not.toContain('ağlarınız')
        expect(oku('en')).toContain('Your addresses, amounts, tokens or transaction details are never included in these statistics.')
        expect(oku('en')).not.toContain('networks or transaction')
    })

    const AG ={ tr: /ağda/, en: /network/, de: /Netzwerk/i, es: /red/i, fr: /réseau/i, id: /jaringan/i, ja: /ネットワーク/, ko: /네트워크/, 'pt-BR': /rede/i, ru: /сет/i, vi: /mạng/i, 'zh-CN': /网络/ }
    const ADRES = { tr: 'Adres', en: 'addresses', de: 'Adressen', es: 'direcciones', fr: 'adresses', id: 'Alamat', ja: 'アドレス', ko: '주소', 'pt-BR': 'endereços', ru: 'адрес', vi: 'địa chỉ', 'zh-CN': '地址' }
    const kodlar12 = Object.keys(AG)

    // NEDEN: ag artik gonderiliyor; her dilde metin bunu soylemeli, anonim iddiasi olmamali.
    it.each(kodlar12)('%s: analyticsDesc ag/network ifadesi var, anonim denmiyor', (k) => {
        expect(oku(k)).toMatch(AG[k])
        expect(oku(k)).not.toMatch(/anonim|anonym|anónim|匿名|익명|аноним|ẩn danh|anonymous/i)
    })

    // NEDEN: 'adres/token yok' vaadi hicbir dilde ceviriyle kaybolmamali.
    it.each(kodlar12)('%s: analyticsDesc adres/token vaadi korunur', (k) => {
        expect(oku(k).toLowerCase()).toContain(ADRES[k].toLowerCase())
    })

    // NEDEN: body de ag bilgisini soylemeli (onay metni gonderilen veriyle birebir tutarli olmali).
    it.each(kodlar12)('%s: analyticsConsent.body ag ifadesini icerir', (k) => {
        const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${k}.json`, import.meta.url)), 'utf8'))
        expect(j.analyticsConsent.body).toMatch(AG[k])
    })

    it.each(kodlar12)('%s: dort yeni/degisen anahtar dolu string ve anonim icermez', (k) => {
        const j = JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${k}.json`, import.meta.url)), 'utf8'))
        for (const v of [j.analyticsConsent.body, j.analyticsConsent.updated, j.settings.preferences.analyticsDesc, j.settings.preferences.analyticsReconsent]) {
            expect(typeof v).toBe('string')
            expect(v.trim()).not.toBe('')
            expect(v).not.toMatch(/anonim|anonym|anónim|匿名|익명|аноним|ẩn danh|anonymous/i)
        }
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

// Spec 11 + CWS "prominent disclosure": popup govdesi toplanan HER veri turunu adiyla sayar ve Tercihler aciklamasiyla
// AYNI listeyi AYNI sirada soyler. Eklenen/olusturulan cuzdan adedi (walletImport/walletCreate) iki onay duzeyinde de
// sayilip gonderiliyor; eski govdenin genel "eylem sayilari" ifadesi onu kapsiyordu, sayilan yeni liste kapsamiyordu.
describe('analyticsConsent.body ve analyticsDesc ayni tam liste (spec 11)', () => {
    const j = (k) => JSON.parse(readFileSync(fileURLToPath(new URL(`../i18n/locales/${k}.json`, import.meta.url)), 'utf8'))
    const CUZDAN = {
        tr: 'eklenen veya oluşturulan cüzdan', en: 'wallets added or created', de: 'hinzugefügten oder erstellten Wallets',
        es: 'billeteras añadidas o creadas', fr: 'portefeuilles ajoutés ou créés', id: 'dompet yang ditambahkan atau dibuat',
        ja: '追加または作成されたウォレット', ko: '추가 또는 생성된 지갑', 'pt-BR': 'carteiras adicionadas ou criadas',
        ru: 'добавленных или созданных кошельков', vi: 'ví được thêm hoặc tạo', 'zh-CN': '添加或创建钱包',
    }

    it.each(Object.keys(CUZDAN))('%s: body ve analyticsDesc eklenen/olusturulan cuzdan adedini sayar', (k) => {
        expect(j(k).analyticsConsent.body).toContain(CUZDAN[k])
        expect(j(k).settings.preferences.analyticsDesc).toContain(CUZDAN[k])
    })

    it.each(Object.keys(CUZDAN))('%s: cuzdan maddesi body listesinin SONUNDA (ag maddesinden sonra, adres vaadinden once)', (k) => {
        const body = j(k).analyticsConsent.body
        const desc = j(k).settings.preferences.analyticsDesc
        const AG = { tr: 'ağda', en: 'network', de: 'Netzwerk', es: 'red', fr: 'réseau', id: 'jaringan', ja: 'ネットワーク', ko: '네트워크', 'pt-BR': 'rede', ru: 'сети', vi: 'mạng', 'zh-CN': '网络' }
        expect(body.indexOf(CUZDAN[k])).toBeGreaterThan(body.indexOf(AG[k]))
        expect(desc.indexOf(CUZDAN[k])).toBeGreaterThan(desc.indexOf(AG[k]))
    })

    // Ayni sira: acilis, kilit acma, ekran, basarisiz, ag, cuzdan (tr/en kilitlenir; diger diller cevirisi).
    const SIRA = {
        tr: { body: ['cüzdanı açma', 'kilit açma', 'ekran', 'başarısız', 'ağda', 'eklenen veya oluşturulan cüzdan'],
              desc: ['cüzdanın açılma', 'kilit açma', 'ekran', 'başarısız', 'ağda', 'eklenen veya oluşturulan cüzdan'] },
        en: { body: ['wallet opens', 'unlocks', 'screens', 'failed', 'network', 'wallets added or created'],
              desc: ['wallet opens', 'unlocks', 'screen', 'failed', 'network', 'wallets added or created'] },
    }
    it.each(['tr', 'en'])('%s: body ve analyticsDesc maddeleri ayni sirada', (k) => {
        for (const [alan, metin] of [['body', j(k).analyticsConsent.body], ['desc', j(k).settings.preferences.analyticsDesc]]) {
            const yerler = SIRA[k][alan].map((w) => metin.indexOf(w))
            for (const [i, y] of yerler.entries()) expect(y, `${alan}: ${SIRA[k][alan][i]}`).toBeGreaterThan(-1)
            expect(yerler, alan).toEqual([...yerler].sort((a, b) => a - b))
        }
    })

    it('tr body dilbilgisi: "cüzdanı açma ve kilit açma adedi" (eski bozuk "cüzdanın ve kilit açma" yok)', () => {
        expect(j('tr').analyticsConsent.body).toContain('cüzdanı açma ve kilit açma adedi')
        expect(j('tr').analyticsConsent.body).not.toContain('cüzdanın ve kilit')
    })

    // Yeniden onay notu yeni turlerin HEPSINI anar: acilis ve basarisiz sayilari da eklendi.
    it('tr ve en updated notu acilis, kilit acma, ekran, basarisiz ve ag sayilarini anar', () => {
        for (const w of ['cüzdanı açma', 'kilit açma', 'ekran', 'başarısız', 'ağ']) expect(j('tr').analyticsConsent.updated).toContain(w)
        for (const w of ['wallet open', 'unlock', 'screen', 'failed', 'network']) expect(j('en').analyticsConsent.updated).toContain(w)
    })
})
