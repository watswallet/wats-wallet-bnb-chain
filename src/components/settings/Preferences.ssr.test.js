// Preferences.vue -- arayuz modu anahtarinin SET_UI_MODE yanitini okudugunu
// GERCEKTEN render ederek dogrular (bkz. src/test-utils/ssrRender.js).
//
// KAPSAM (bilerek DAR): bu dosya SADECE Gorev 15 kod incelemesi turu 1,
// Bulgu 2'nin kapattigi bosluk icin var -- background {success:true,mode}
// VEYA {error} ile COZULUR (REJECT ETMEZ) ama `arayuzModunuDegistir()`
// yaniti hic OKUMUYORDU: basarisiz bir gecişte bile anahtar ISTENEN duruma
// ATLIYORDU, yani ayarlar ekrani cuzdanin GERCEKTE hangi yuzeyde acilacagi
// konusunda YALAN soyluyordu. Bilesenin geri kalani (dil/tema secimi, 7702
// geri alma) bu dosyanin KONUSU DEGIL.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basi KULLANIM notu): onMounted -> onServerPrefetch aliasi olmadan panelModu
// hic doldurulmaz.
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import Preferences from './Preferences.vue'

afterEach(() => { delete globalThis.chrome })

// `userTheme` ONCEDEN doldurulur ki bilesenin AYRI (bu dosyanin konusu
// olmayan) tema onMounted'i `window.matchMedia` dalina DUSMESIN -- bu ortamda
// `window` yok (bkz. vitest.config.js: environment 'node'), dallanmasa bile
// stub'lanmamis bir global'e dokunmak gurultuye sebep olurdu.
function kur(sendMessageImpl) {
    const stub = installChromeStub({ uiMode: 'sidepanel', userTheme: 'dark' })
    stub.setSendMessage(sendMessageImpl)
    // panelSupported() bu bayragi arar (bkz. utils/uiMode.js); installChromeStub
    // varsayilan olarak sidePanel EKLEMEZ -- eklenmezse arayuzModunuDegistir()
    // ilk satirda SESSIZCE geri doner ve asagidaki testler HICBIR SEY olcmezdi.
    globalThis.chrome.sidePanel = {}

    const app = createApp(Preferences)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    const captured = captureInstance(app, 'Preferences')
    return { stub, captured, app }
}

describe('Preferences.vue -- arayuz modu anahtari, SET_UI_MODE yanitini okur', () => {
    it('{error} donerse: anahtar GERCEK (onceki) durumda kalir', async () => {
        const cagrilar = []
        const { captured, app } = kur(async (msg) => {
            cagrilar.push(msg)
            return { error: 'Invalid ui mode' }
        })
        await render(app)

        // On kosul: depoda 'sidepanel' kayitli, yani anahtar PANEL (true) ile
        // basliyor -- aksi halde asagidaki "hala true" iddiasi anlamsizlasirdi.
        expect(captured.instance.setupState.panelModu).toBe(true)

        await captured.instance.setupState.arayuzModunuDegistir()

        expect(cagrilar).toEqual([{ type: 'SET_UI_MODE', mode: 'popup' }])
        // Basarisiz gecis: anahtar HALA true (panel) -- ISTENEN 'popup'
        // durumuna GECMEDI, ekran YALAN SOYLEMIYOR.
        expect(captured.instance.setupState.panelModu).toBe(true)
    })

    it('{success:true} donerse: anahtar GERCEKTEN doner (kontrol -- test vakumda gecmiyor)', async () => {
        const { captured, app } = kur(async (msg) => ({ success: true, mode: msg.mode }))
        await render(app)

        expect(captured.instance.setupState.panelModu).toBe(true)

        await captured.instance.setupState.arayuzModunuDegistir()

        expect(captured.instance.setupState.panelModu).toBe(false)
    })
})
