// YUKLEME EKRANI TEK YERDE: App.vue.
//
// KOK NEDEN 1 -- ACILIS BOSLUGU: `page.currentPage` BOS DIZE ile baslar ve
// App.vue'nun onMounted'i once chrome.storage'i okur, sonra CHECK_UNLOCK'i
// bekler. O ana kadar HICBIR ekranin `v-if`i tutmaz: kullanicinin gordugu
// tamamen bos bir yuzeydir.
//
// KOK NEDEN 2 -- GECIS BOSLUGU: ekranlar `<Transition mode="out-in">` icinde
// yasiyor ve gecis .25s suruyor. Yukleme ekrani Home.vue'nun ICINDE olsaydi
// sira su olurdu: sayfa 'home' olur -> App'in ekrani ANINDA kalkar -> eski
// sarmalayici .25s boyunca AYRILIR -> Home ancak ondan SONRA kurulur ve KENDI
// ekranini cizer. Yani iki ayni goruntunun ARASINDA ~250 ms BOS kare. Bu yuzden
// ekran tek bir yerde durur ve kapiyi PAYLASILAN bir bayrak (page.firstLoadDone)
// tasir -- Home mount olmadan ONCE de, olduktan SONRA da ayni ortu asagidadir.
import { describe, it, expect, afterEach, vi } from 'vitest'

// App.vue -> Header.vue -> utils/dappFunctions.js zinciri MODUL UST DUZEYINDE
// chrome.windows.onRemoved.addListener cagirir; o satir import ANINDA calisir.
vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        runtime: { onMessage: { addListener: () => {} }, sendMessage: async () => ({}) },
        storage: {
            local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
            onChanged: { addListener: () => {} },
        },
    }
})

import { createApp, render, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { pageStore } from '../store/pageStore'
import App from './App.vue'

// 'vue' BURADA MOCK'LANMAZ: onMounted SSR'da hic kosmaz, yani ne App.vue'nun
// acilis mantigi (storage + CHECK_UNLOCK) ne de Home.vue'nun bakiye turu
// devreye girer -- olculmek istenen an tam olarak bu "henuz hicbir sey
// bitmedi" anidir.
function renderAt(currentPage, { firstLoadDone = false } = {}) {
    const pinia = createTestPinia()
    const page = pageStore()
    page.currentPage = currentPage
    page.firstLoadDone = firstLoadDone
    const app = createApp(App)
    app.use(pinia)
    app.use(createTestI18n())
    return render(app)
}

afterEach(() => { vi.unstubAllGlobals() })

describe('App.vue -- yukleme ekrani', () => {
    it('acilista (sayfa henuz secilmemisken) cizilir', async () => {
        expect(await renderAt('')).toContain('data-splash')
    })

    it('sayfa home a gectiginde bakiyeler HAZIR DEGILSE cizilmeye DEVAM eder', async () => {
        // Gecis boslugunun kilidi: bu an Home HENUZ MOUNT OLMAMISTIR
        // (.25s out-in). Ortuyu App tasimazsa burada bos kare gorunur.
        expect(await renderAt('home', { firstLoadDone: false })).toContain('data-splash')
    })

    it('bakiyeler HAZIR olunca kalkar', async () => {
        const html = await renderAt('home', { firstLoadDone: true })
        expect(html).not.toContain('data-splash')
    })

    it('kilitli cuzdanda ASILI KALMAZ -- bayrak acilmamis olsa bile', async () => {
        // Kilit ekraninda Home hic mount olmaz, yani `firstLoadDone` hicbir zaman
        // acilmaz. Kosul sayfaya da bakmasaydi kullanici sonsuz bir spinner
        // ardinda kilitli kalirdi.
        const html = await renderAt('welcome', { firstLoadDone: false })
        expect(html).not.toContain('data-splash')
        expect(html, 'kilit ekrani gercekten cizilmeli').toContain('src="/logo.png"')
    })

    it('dapp onay ekraninda da ASILI KALMAZ', async () => {
        expect(await renderAt('dapp_connect', { firstLoadDone: false })).not.toContain('data-splash')
    })
})
