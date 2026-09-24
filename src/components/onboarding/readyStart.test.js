// KURULUMUN SON EKRANI -- "BILINMEYEN MOD" DALI (final inceleme, M10).
//
// KAPATILAN HATA: `mode` `null` baslar ve `onMounted` gercek bir chrome IPC
// gidis-donusu (readUiMode -> storage.local.get) bekler. Dugme o sirada ZATEN
// ekranda ve tiklanabilir. Eski kosul `mode.value === UI_MODE_PANEL` idi: erken
// tiklama `false` verir, akis dogrudan `chrome.action.openPopup()`a giderdi --
// ve URUN VARSAYILANI PANEL oldugu icin popup yolu ZATEN temizlenmistir, yani
// o cagri HATA verir. Sonuc: kullanici kurulumu bitirir ve ekranda HICBIR
// cuzdan yuzeyi acilmaz -- S4.7'nin var olma sebebi olan hatanin ta kendisi.
//
// Bu dosya KAYNAK KILIDI DEGIL: bilesen gercekten render edilir ve `start()`
// `mode` HENUZ COZULMEDEN cagrilir (captureInstance'in `onCapture` geri cagrisi
// bilesenin KENDI mount kancasindan ONCE kosar -- bkz. test-utils/ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import Ready from './Ready.vue'

let acikMod

function chromeKur({ uiMode = 'sidepanel', panelAcilir = true } = {}) {
    const sidePanelOpen = vi.fn(async () => { if (!panelAcilir) throw new Error('acilamadi') })
    const openPopup = vi.fn(async () => {})
    globalThis.chrome = {
        storage: {
            local: {
                // Mod okumasi BILEREK gecikmeli: testin olctugu sey tam da bu
                // bekleme penceresinde yapilan tiklamadir.
                get: async () => {
                    await new Promise((r) => setTimeout(r, 5))
                    return { uiMode }
                },
                set: async () => {},
            },
        },
        windows: { getCurrent: async () => ({ id: 7 }) },
        sidePanel: { open: sidePanelOpen },
        action: { openPopup },
    }
    return { sidePanelOpen, openPopup }
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/** `start()`i, bilesenin mount kancasi HENUZ kosmadan cagirir. */
async function erkenTikla(secenekler) {
    const casuslar = chromeKur(secenekler)
    const kapat = vi.fn()
    vi.stubGlobal('window', { close: kapat })

    const app = createApp(Ready)
    app.use(createTestPinia())
    app.use(createTestI18n())

    let tiklamaSozu = null
    const captured = captureInstance(app, 'Ready', (instance) => {
        acikMod = instance.setupState.mode
        tiklamaSozu = instance.setupState.start()
    })

    await render(app)
    await tiklamaSozu

    return { ...casuslar, kapat, captured }
}

describe('Ready.vue -- mod COZULMEDEN tiklanirsa', () => {
    it('mod gercekten HENUZ null (on kosul)', async () => {
        await erkenTikla()
        expect(acikMod).toBeNull()
    })

    // BILINMEYEN = PANEL. Urun varsayilani panel; bilinmeyen modda popup'a
    // gitmek, popup yolu temizlenmis oldugu icin HICBIR yuzey acmamak demektir.
    it('PANEL denenir, dogrudan popup a GIDILMEZ', async () => {
        const { sidePanelOpen, openPopup, kapat } = await erkenTikla()

        expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 7 })
        expect(openPopup).not.toHaveBeenCalled()
        expect(kapat).toHaveBeenCalledTimes(1)
    })

    // DUSME YOLU KORUNUR: openSidePanelHere kendi yetenek/hata kapisini tasir
    // ve acamazsa `false` doner.
    it('panel ACILAMAZSA popup a duser', async () => {
        const { sidePanelOpen, openPopup, kapat } = await erkenTikla({ panelAcilir: false })

        expect(sidePanelOpen).toHaveBeenCalled()
        expect(openPopup).toHaveBeenCalledTimes(1)
        expect(kapat).toHaveBeenCalledTimes(1)
    })
})

describe('Ready.vue -- mod COZULDUKTEN sonra tiklanirsa', () => {
    /** `start()`i, mount kancasi bittikten (mod cozuldukten) SONRA cagirir. */
    async function gecTikla(secenekler) {
        const casuslar = chromeKur(secenekler)
        const kapat = vi.fn()
        vi.stubGlobal('window', { close: kapat })

        const app = createApp(Ready)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const captured = captureInstance(app, 'Ready')
        await render(app)

        await captured.instance.setupState.start()
        return { ...casuslar, kapat, captured }
    }

    it('mod PANEL ise paneli acar', async () => {
        const { sidePanelOpen, openPopup } = await gecTikla({ uiMode: 'sidepanel' })

        expect(sidePanelOpen).toHaveBeenCalled()
        expect(openPopup).not.toHaveBeenCalled()
    })

    // KESIN OLARAK popup tercih edilmisse panel HIC denenmez -- kapi
    // "bilinmeyen"i panele sayar, popup TERCIHINI ezmez.
    it('mod POPUP ise panel HIC denenmez', async () => {
        const { sidePanelOpen, openPopup } = await gecTikla({ uiMode: 'popup' })

        expect(sidePanelOpen).not.toHaveBeenCalled()
        expect(openPopup).toHaveBeenCalledTimes(1)
    })
})
