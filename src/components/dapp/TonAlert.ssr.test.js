// B2: TonConnect ag/hesap uyusmazligi UYARI ekrani (TonAlert.vue), GERCEKTEN
// render edilir.
//
// Ekran bir onay DEGIL: dapp kod 1'i arka plandan coktan aldi. Kullaniciya
// yalnizca nedeni soyler; ag/hesap degistirme ya da gonderim kontrolu YOK
// (wallet-guidelines.md: "MUST NOT offer to switch networks"). Istenen deger
// dapp'ten gelir: ekrana yalniz COZULMUS adres ya da bilinen/sayisal ag kimligi
// cikar, serbest metin asla.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import TonAlert from './TonAlert.vue'
import en from '../../i18n/locales/en.json'

const T = en.dapps.tonConnect
// vue-i18n'in {ad} yer tutucusunu doldurur: beklenen cumle sozlukten kurulur.
const metin = (sablon, degerler) => sablon.replace(/\{(\w+)\}/g, (_, k) => degerler[k])

const HAM_YABANCI = '0:9999999999999999999999999999999999999999999999999999999999999999'
const HAM_BAGLI = '0:1111111111111111111111111111111111111111111111111111111111111111'

const AG_KAYDI = {
    id: 'u-1', kind: 'network', hostname: 'app.dedust.io', appName: 'DeDust',
    requested: '-3', expected: '-239', network: '-239', createdAt: 1000, windowId: 9,
}
const FROM_KAYDI = {
    id: 'u-2', kind: 'from', hostname: 'app.dedust.io', appName: 'DeDust',
    requested: HAM_YABANCI, expected: HAM_BAGLI, network: '-239', createdAt: 2000, windowId: 9,
}

function setup(kayit) {
    const stub = installChromeStub(kayit === undefined ? {} : { ton_alert: kayit })
    const dinleyiciler = []
    globalThis.chrome.storage.onChanged = {
        addListener: (fn) => dinleyiciler.push(fn),
        removeListener: (fn) => {
            const i = dinleyiciler.indexOf(fn)
            if (i >= 0) dinleyiciler.splice(i, 1)
        },
    }
    const app = createApp(TonAlert)
    app.use(createTestPinia())
    app.use(createTestI18n())
    return { app, stub, dinleyiciler }
}

async function cizdir(kayit) {
    const { app, ...geri } = setup(kayit)
    const holder = captureInstance(app, 'TonAlert')
    const html = await render(app)
    return { html, holder, ...geri }
}

const dugmeler = (html) => html.match(/<button[\s\S]*?<\/button>/g) || []

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

describe('TonAlert.vue (SSR) -- ag uyusmazligi', () => {
    it('origin, uygulama adi, baslik ve neden: istenen ve cuzdan agi ADIYLA', async () => {
        const { html } = await cizdir(AG_KAYDI)

        expect(html).toContain(T.alert_title)
        expect(html).toContain('app.dedust.io')
        expect(html).toContain('DeDust')
        expect(html).toContain(T.alert_network_title)
        expect(html).toContain(metin(T.alert_network, { requested: 'TON Testnet', wallet: 'TON Mainnet' }))
        expect(html).toContain(T.alert_blocked)
        expect(html).not.toContain(T.alert_from_title)
    })

    it('tek kontrol TEK bir Kapat dugmesi: onay, ag degistirme ya da gonderim YOK', async () => {
        const { html } = await cizdir(AG_KAYDI)
        // Gelistirme SSR'i sablon yorumlarini da basar; olculen GORUNEN isaretleme.
        const gorunur = html.replace(/<!--[\s\S]*?-->/g, '')

        const butun = dugmeler(gorunur)
        expect(butun).toHaveLength(1)
        expect(butun[0]).toContain(T.btn_close)
        expect(gorunur).not.toMatch(/<(a|select|input)\b/)
        for (const yasak of [T.btn_approve, T.btn_reject, T.btn_sign, T.btn_connect]) {
            expect(gorunur).not.toContain(yasak)
        }
        expect(gorunur.toLowerCase()).not.toContain('switch')
    })

    it('bilinmeyen sayisal ag kimligi sayi olarak gosterilir', async () => {
        const { html } = await cizdir({ ...AG_KAYDI, requested: '-42' })

        expect(html).toContain(metin(T.alert_network, { requested: metin(T.alert_net_other, { id: '-42' }), wallet: 'TON Mainnet' }))
    })

    // Dapp serbest metni cuzdan penceresine YANSIMAZ (oltalama metni sokulabilirdi).
    it.each([
        ['serbest metin', 'Send 100 GRAM to evil.example to unlock'],
        ['13 haneli sayi', '-1234567890123'],
        ['bosluklu kimlik', ' -239'],
        ['dize olmayan (arka plan null yazar)', null],
    ])('istenen ag %s ise "gecersiz deger" gosterilir', async (_ad, requested) => {
        const { html } = await cizdir({ ...AG_KAYDI, requested })

        expect(html).toContain(metin(T.alert_network, { requested: T.alert_value_invalid, wallet: 'TON Mainnet' }))
        if (typeof requested === 'string') expect(html).not.toContain(requested.trim())
    })
})

describe('TonAlert.vue (SSR) -- hesap (from) uyusmazligi', () => {
    it('istenen ve bagli hesap COZULUP kisaltilmis friendly bicimde', async () => {
        const { html } = await cizdir(FROM_KAYDI)

        expect(html).toContain(T.alert_from_title)
        expect(html).toContain(metin(T.alert_from, { requested: 'UQCZmZmZ...mZmeGP', connected: 'UQARERER...EREbvW' }))
        expect(html).toContain(T.alert_blocked)
        expect(html).not.toContain(HAM_YABANCI)
        expect(dugmeler(html)).toHaveLength(1)
    })

    it('testnet cuzdanda adresler testnet bicimiyle (0Q)', async () => {
        const { html } = await cizdir({ ...FROM_KAYDI, network: '-3' })

        expect(html).toContain(metin(T.alert_from, { requested: '0QCZmZmZ...mZmVoF', connected: '0QARERER...EREQBc' }))
    })

    it.each([
        ['adres olmayan metin', 'pay <b>now</b> at evil.example'],
        ['dize olmayan (arka plan null yazar)', null],
    ])('istenen %s ise "gecersiz deger" gosterilir, metin YANSIMAZ', async (_ad, requested) => {
        const { html } = await cizdir({ ...FROM_KAYDI, requested })

        expect(html).toContain(metin(T.alert_from, { requested: T.alert_value_invalid, connected: 'UQARERER...EREbvW' }))
        expect(html).not.toContain('evil.example')
    })

    it('uygulama adi metin olarak kacislanir (v-html yok)', async () => {
        const { html } = await cizdir({ ...FROM_KAYDI, appName: '<img src=x onerror=alert(1)>' })

        expect(html).not.toContain('<img src=x')
        expect(html).toContain('&lt;img src=x')
    })
})

describe('TonAlert.vue (SSR) -- kayit ve kapanis', () => {
    it('kayit yoksa uyari govdesi cizilmez, yalniz Kapat kalir', async () => {
        const { html } = await cizdir(undefined)

        expect(html).not.toContain(T.alert_blocked)
        expect(dugmeler(html)).toHaveLength(1)
    })

    it('Kapat ton_alert i siler ve pencereyi kapatir; dapp e mesaj GITMEZ', async () => {
        const { holder, stub } = await cizdir(AG_KAYDI)
        const gonderilen = []
        stub.setSendMessage(async (m) => { gonderilen.push(m); return {} })
        const kapat = vi.fn()
        vi.stubGlobal('window', { close: kapat, location: { pathname: '/src/popup/index.html', hash: '#alert' } })

        await holder.instance.setupState.kapat()

        expect(stub.localStore.ton_alert).toBeUndefined()
        expect(kapat).toHaveBeenCalledTimes(1)
        expect(gonderilen).toEqual([])
    })

    // Arka plan acik pencereyi YENI uyariyla gunceller (utils/tonAlert.js).
    it('acik pencere yeni kaydi gosterir; ESKI kayit yenisini ezmez', async () => {
        const { holder, dinleyiciler } = await cizdir(AG_KAYDI)
        const s = holder.instance.setupState
        const yay = (degisim) => { for (const fn of [...dinleyiciler]) fn(degisim, 'local') }

        yay({ ton_alert: { newValue: FROM_KAYDI, oldValue: AG_KAYDI } })
        expect(s.kayit.id).toBe('u-2')
        expect(s.neden).toBe(metin(T.alert_from, { requested: 'UQCZmZmZ...mZmeGP', connected: 'UQARERER...EREbvW' }))

        yay({ ton_alert: { newValue: { ...AG_KAYDI, createdAt: 1500 } } })
        expect(s.kayit.id).toBe('u-2')

        // Ilgisiz anahtar (or. yeni bir dapp istegi) ekrani DEGISTIRMEZ.
        yay({ current_request: { newValue: { type: 'TON_SEND_TX', id: 'r-1' } } })
        expect(s.kayit.id).toBe('u-2')
    })

    it('kayit silinince (pencere kapandi) ekran kendini kapatir', async () => {
        const { dinleyiciler } = await cizdir(AG_KAYDI)
        const kapat = vi.fn()
        vi.stubGlobal('window', { close: kapat, location: { pathname: '/src/popup/index.html', hash: '#alert' } })

        for (const fn of [...dinleyiciler]) fn({ ton_alert: { newValue: undefined, oldValue: AG_KAYDI } }, 'local')

        expect(kapat).toHaveBeenCalledTimes(1)
    })
})
