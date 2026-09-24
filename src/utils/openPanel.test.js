import { describe, it, expect, vi, afterEach } from 'vitest'
import { openSidePanelHere } from './openPanel'

afterEach(() => { delete globalThis.chrome })

function stub({ open = vi.fn(async () => {}), getCurrent = vi.fn(async () => ({ id: 42 })) } = {}) {
    globalThis.chrome = {
        sidePanel: open ? { setPanelBehavior: vi.fn(), open } : { setPanelBehavior: vi.fn() },
        windows: { getCurrent },
    }
    return globalThis.chrome
}

describe('openSidePanelHere', () => {
    it('once pencere kimligini alir, SONRA paneli acar', async () => {
        const sira = []
        const c = stub({
            getCurrent: vi.fn(async () => { sira.push('getCurrent'); return { id: 42 } }),
            open: vi.fn(async () => { sira.push('open') }),
        })
        const sonuc = await openSidePanelHere()
        expect(sonuc).toBe(true)
        expect(sira).toEqual(['getCurrent', 'open'])
        expect(c.sidePanel.open).toHaveBeenCalledWith({ windowId: 42 })
    })

    // open() tabId veya windowId'den EN AZ BIRINI zorunlu ister: argumansiz
    // cagri "at least one of tabId and windowId must be provided" verir.
    it('windowId olmadan CAGIRMAZ', async () => {
        const c = stub({ getCurrent: vi.fn(async () => ({})) })
        const sonuc = await openSidePanelHere()
        expect(sonuc).toBe(false)
        expect(c.sidePanel.open).not.toHaveBeenCalled()
    })

    it('open desteklenmiyorsa (115) false doner, patlamaz', async () => {
        stub({ open: null })
        await expect(openSidePanelHere()).resolves.toBe(false)
    })

    // Kullanici hareketi penceresi kacirildiysa Chrome firlatir; cagri yeri
    // bunu yutup normal popup olarak devam edebilmeli.
    it('open firlatirsa false doner', async () => {
        stub({ open: vi.fn(async () => { throw new Error('user gesture') }) })
        await expect(openSidePanelHere()).resolves.toBe(false)
    })

    // BUTCE DUZELTMESI: cagri yeri (main.js / Ready.vue) kendi chrome cagrisiyla
    // (ornegin mod okumasi) AYNI ANDA baslattigi bir pencere aramasini buraya
    // verebilir. Bu durumda burada IKINCI bir windows.getCurrent() cagrisi
    // YAPILMAMALI -- aksi halde cagri yerindeki paralellik faydasiz kalir ve
    // open()'dan once yine iki round-trip birikir.
    it('onceden baslatilmis pencere sonucu verilirse KENDI windows.getCurrent cagrisini yapmaz', async () => {
        const c = stub()
        const sonuc = await openSidePanelHere(Promise.resolve({ id: 7 }))
        expect(sonuc).toBe(true)
        expect(c.windows.getCurrent).not.toHaveBeenCalled()
        expect(c.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 })
    })
})
