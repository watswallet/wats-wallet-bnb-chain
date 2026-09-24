import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let panelWindow

async function yukle() {
    vi.resetModules()
    panelWindow = await import('./panelWindow')
}

afterEach(() => { delete globalThis.chrome })

describe('panelWindow (panel yuzeyi)', () => {
    beforeEach(async () => {
        vi.doMock('./uiSurface', () => ({ isPanel: () => true }))
        globalThis.chrome = { windows: { getCurrent: vi.fn(async () => ({ id: 12 })) } }
        await yukle()
    })

    it('pencere kimligini bir kez okur ve onbellekler', async () => {
        expect(await panelWindow.initPanelWindowId()).toBe(12)
        expect(await panelWindow.initPanelWindowId()).toBe(12)
        expect(globalThis.chrome.windows.getCurrent).toHaveBeenCalledTimes(1)
        expect(panelWindow.getPanelWindowId()).toBe(12)
    })

    it('sorguyu kendi penceresine sabitler', async () => {
        await panelWindow.initPanelWindowId()
        expect(panelWindow.activeTabQuery()).toEqual({ active: true, windowId: 12 })
    })

    // Cozum basarisiz olursa lastFocusedWindow'a DUSMEK, yanlis pencerenin
    // sekmesini dondurme riskini geri getirir -- ama hicbir sey dondurmemek
    // Header'i tamamen bos birakirdi. Bilincli takas.
    it('kimlik cozulemezse lastFocusedWindow a duser', async () => {
        globalThis.chrome.windows.getCurrent = vi.fn(async () => { throw new Error('yok') })
        expect(await panelWindow.initPanelWindowId()).toBe(null)
        expect(panelWindow.activeTabQuery()).toEqual({ active: true, lastFocusedWindow: true })
    })
})

describe('panelWindow (panel DISI yuzey)', () => {
    beforeEach(async () => {
        vi.doMock('./uiSurface', () => ({ isPanel: () => false }))
        globalThis.chrome = { windows: { getCurrent: vi.fn(async () => ({ id: 12 })) } }
        await yukle()
    })

    it('popup / onay penceresinde pencere kimligi OKUNMAZ', async () => {
        expect(await panelWindow.initPanelWindowId()).toBe(null)
        expect(globalThis.chrome.windows.getCurrent).not.toHaveBeenCalled()
    })

    it('sorgu eski bicimde kalir', () => {
        expect(panelWindow.activeTabQuery()).toEqual({ active: true, lastFocusedWindow: true })
    })
})
