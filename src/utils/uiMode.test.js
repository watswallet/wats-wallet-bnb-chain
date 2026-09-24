import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    applyUiMode, readUiMode, writeUiMode, panelSupported, panelOpenSupported,
    UI_MODE_KEY, UI_MODE_PANEL, UI_MODE_POPUP, POPUP_PATH,
} from './uiMode'

let store

function stub({ sidePanel = 'full', setPopup } = {}) {
    // 'noBehavior': `chrome.sidePanel` VAR ama `setPanelBehavior` YOK. Gercek
    // hayatta nadir, ama tam da bu modulun onlemek icin var oldugu ULASILMAZ
    // CUZDAN durumunu ureten dal budur (bkz. asagidaki M6 testi).
    const sp = sidePanel === 'none'
        ? undefined
        : sidePanel === 'noBehavior'
            ? { open: vi.fn(async () => {}) }
            : sidePanel === 'noOpen'
                ? { setPanelBehavior: vi.fn(async () => {}) }
                : { setPanelBehavior: vi.fn(async () => {}), open: vi.fn(async () => {}) }

    globalThis.chrome = {
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, store[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(store, obj) }),
            },
        },
        action: { setPopup: setPopup || vi.fn(async () => {}) },
        ...(sp ? { sidePanel: sp } : {}),
    }
    return globalThis.chrome
}

beforeEach(() => { store = {} })
afterEach(() => { delete globalThis.chrome })

describe('readUiMode', () => {
    it('ayar yoksa VARSAYILAN yan paneldir', async () => {
        stub()
        expect(await readUiMode()).toBe(UI_MODE_PANEL)
    })

    it('kayitli tercihi okur', async () => {
        stub()
        store[UI_MODE_KEY] = UI_MODE_POPUP
        expect(await readUiMode()).toBe(UI_MODE_POPUP)
    })

    it('bozuk deger varsayilana duser', async () => {
        stub()
        store[UI_MODE_KEY] = 'sacmalik'
        expect(await readUiMode()).toBe(UI_MODE_PANEL)
    })

    // 115'te sidePanel yoktur: kayitli tercih ne olursa olsun ETKIN mod popup.
    it('panel desteklenmiyorsa kayitli panel tercihi popup a duser', async () => {
        stub({ sidePanel: 'none' })
        store[UI_MODE_KEY] = UI_MODE_PANEL
        expect(await readUiMode()).toBe(UI_MODE_POPUP)
    })
})

describe('yetenek kontrolleri', () => {
    it('panelSupported / panelOpenSupported tam destekte true', () => {
        stub()
        expect(panelSupported()).toBe(true)
        expect(panelOpenSupported()).toBe(true)
    })

    it('sidePanel yoksa ikisi de false', () => {
        stub({ sidePanel: 'none' })
        expect(panelSupported()).toBe(false)
        expect(panelOpenSupported()).toBe(false)
    })

    // Chrome 115: API var, open() YOK. Panel davranisi kurulabilir ama
    // programatik acma denenmemeli.
    it('open yoksa panelSupported true, panelOpenSupported false', () => {
        stub({ sidePanel: 'noOpen' })
        expect(panelSupported()).toBe(true)
        expect(panelOpenSupported()).toBe(false)
    })
})

describe('applyUiMode', () => {
    it('panel modunda IKI cagriyi da yapar', async () => {
        const c = stub()
        const etkin = await applyUiMode(UI_MODE_PANEL)
        expect(etkin).toBe(UI_MODE_PANEL)
        expect(c.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
        expect(c.action.setPopup).toHaveBeenCalledWith({ popup: '' })
    })

    it('popup modunda davranisi KAPATIR ve popup yolunu geri yazar', async () => {
        const c = stub()
        const etkin = await applyUiMode(UI_MODE_POPUP)
        expect(etkin).toBe(UI_MODE_POPUP)
        expect(c.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false })
        expect(c.action.setPopup).toHaveBeenCalledWith({ popup: POPUP_PATH })
    })

    // EN RISKLI DAL: API yokken setPopup('') cagrilirsa ikona basan kullanici
    // HICBIR SEY acilmadigini gorur -- cuzdan tamamen ulasilmaz olur.
    it('panel desteklenmiyorsa YALNIZCA setPopup(yol) cagirir', async () => {
        const c = stub({ sidePanel: 'none' })
        const etkin = await applyUiMode(UI_MODE_PANEL)
        expect(etkin).toBe(UI_MODE_POPUP)
        expect(c.action.setPopup).toHaveBeenCalledWith({ popup: POPUP_PATH })
        expect(c.action.setPopup).not.toHaveBeenCalledWith({ popup: '' })
    })

    it('open yoksa (115) panel davranisi yine de kurulur', async () => {
        const c = stub({ sidePanel: 'noOpen' })
        const etkin = await applyUiMode(UI_MODE_PANEL)
        expect(etkin).toBe(UI_MODE_PANEL)
        expect(c.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
        expect(c.action.setPopup).toHaveBeenCalledWith({ popup: '' })
    })

    it('chrome cagrisi patlarsa firlatmaz', async () => {
        const c = stub()
        c.action.setPopup = vi.fn(async () => { throw new Error('patladi') })
        await expect(applyUiMode(UI_MODE_PANEL)).resolves.toBeDefined()
    })

    // M6 -- ULASILMAZ CUZDAN. Onceden iki cagri BAGIMSIZ kapilardan geciyordu:
    // `chrome.sidePanel` VAR ama `setPanelBehavior` YOK olan bir tarayicida
    // davranis kurulmadan popup yolu TEMIZLENIYORDU. Sonuc: ikona basan
    // kullanici hicbir sey acilmadigini gorur -- cuzdan tamamen ulasilmaz.
    it('M6: setPanelBehavior YOKSA popup yolu TEMIZLENMEZ', async () => {
        const c = stub({ sidePanel: 'noBehavior' })

        const etkin = await applyUiMode(UI_MODE_PANEL)

        expect(c.action.setPopup).not.toHaveBeenCalledWith({ popup: '' })
        expect(c.action.setPopup).toHaveBeenCalledWith({ popup: POPUP_PATH })
        expect(etkin).toBe(UI_MODE_POPUP)
    })

    // M7 -- SIRA. Popup dalinda davranis ONCE geri aliniyordu; o cagri
    // reddederse `setPopup(POPUP_PATH)` HIC calismiyordu ve kullanici ne
    // panelde ne popup'ta kaliyordu. S9'daki geri alma yordami da bu sirayi
    // (once popup yolu) tarif ediyor.
    it('M7: setPanelBehavior(false) REDDETSE BILE popup yolu geri yazilir', async () => {
        const c = stub()
        c.sidePanel.setPanelBehavior = vi.fn(async () => { throw new Error('reddedildi') })

        await applyUiMode(UI_MODE_POPUP)

        expect(c.action.setPopup).toHaveBeenCalledWith({ popup: POPUP_PATH })
    })

    it('M7: popup yolu davranis geri alinmadan ONCE yazilir', async () => {
        const sira = []
        const c = stub({ setPopup: vi.fn(async () => { sira.push('setPopup') }) })
        c.sidePanel.setPanelBehavior = vi.fn(async () => { sira.push('setPanelBehavior') })

        await applyUiMode(UI_MODE_POPUP)

        expect(sira).toEqual(['setPopup', 'setPanelBehavior'])
    })
})

describe('writeUiMode', () => {
    it('gecerli modu yazar', async () => {
        stub()
        await writeUiMode(UI_MODE_POPUP)
        expect(store[UI_MODE_KEY]).toBe(UI_MODE_POPUP)
    })

    it('gecersiz modu YAZMAZ', async () => {
        stub()
        await writeUiMode('sacmalik')
        expect(store[UI_MODE_KEY]).toBeUndefined()
    })
})
