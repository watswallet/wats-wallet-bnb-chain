import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFirstLoadGate, FIRST_LOAD_TIMEOUT_MS } from './firstLoadGate'

// ILK YUKLEME KAPISI -- ana sayfa, ilk bakiye turu bitmeden gosterilmez.
//
// Kapinin mantigi Home.vue'nun ICINDE degil BURADA yasiyor: Home SSR ile
// render edildiginde `onMounted` zaten TAMAMLANMIS olur (bkz. ssrRender.js),
// yani "tur bitmedi" hali bilesenin ustunden OLCULEMEZ. Zaman asimi da sahte
// zamanlayici ister. Ikisi de kucuk, bagimsiz bir modulde dogrudan olculur.
describe('ilk yukleme kapisi', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('KAPALI baslar -- ilk tur bitmeden ana sayfa gosterilmez', () => {
        const gate = createFirstLoadGate()
        expect(gate.ready.value).toBe(false)
        gate.dispose()
    })

    it('open() kapiyi acar', () => {
        const gate = createFirstLoadGate()
        gate.open()
        expect(gate.ready.value).toBe(true)
        gate.dispose()
    })

    it('tur BITMESE bile zaman asiminda acilir -- kullanici spinnerda kilitlenmez', () => {
        const gate = createFirstLoadGate({ timeoutMs: 8000 })
        vi.advanceTimersByTime(7999)
        expect(gate.ready.value, 'sure dolmadan acilmamali').toBe(false)
        vi.advanceTimersByTime(1)
        expect(gate.ready.value, 'sure dolunca acilmali').toBe(true)
        gate.dispose()
    })

    it('open() zaman asimi zamanlayicisini TEMIZLER -- yan panel saatlerce yasar', () => {
        const gate = createFirstLoadGate({ timeoutMs: 8000 })
        gate.open()
        expect(vi.getTimerCount()).toBe(0)
    })

    it('dispose() zamanlayiciyi temizler ve kapiyi ACMAZ', () => {
        const gate = createFirstLoadGate({ timeoutMs: 8000 })
        gate.dispose()
        expect(vi.getTimerCount()).toBe(0)
        vi.advanceTimersByTime(60000)
        expect(gate.ready.value).toBe(false)
    })

    // `onOpen`: yukleme ekrani App.vue'da, kapiyi acan tur ise Home.vue'da --
    // ikisini baglayan PAYLASILAN bayragi (page.firstLoadDone) kapinin KENDISI
    // duyurur. Iki acilma yolu da (tur bitti / zaman asimi) AYNI kapidan gecer;
    // biri atlanirsa ortu o yolda asili kalir.
    it('onOpen, tur bitip open() cagrilinca atesler', () => {
        const goren = vi.fn()
        const gate = createFirstLoadGate({ onOpen: goren })
        gate.open()
        expect(goren).toHaveBeenCalledTimes(1)
        gate.dispose()
    })

    it('onOpen, ZAMAN ASIMI yolunda da atesler', () => {
        const goren = vi.fn()
        createFirstLoadGate({ timeoutMs: 8000, onOpen: goren })
        vi.advanceTimersByTime(8000)
        expect(goren).toHaveBeenCalledTimes(1)
    })

    it('onOpen IKINCI kez atesLEMEZ -- zaman asimi ile open() yarisirsa bile', () => {
        const goren = vi.fn()
        const gate = createFirstLoadGate({ timeoutMs: 8000, onOpen: goren })
        gate.open()
        gate.open()
        vi.advanceTimersByTime(60000)
        expect(goren).toHaveBeenCalledTimes(1)
    })

    it('dispose() sonrasi onOpen HIC ateslenmez', () => {
        const goren = vi.fn()
        const gate = createFirstLoadGate({ timeoutMs: 8000, onOpen: goren })
        gate.dispose()
        vi.advanceTimersByTime(60000)
        expect(goren).not.toHaveBeenCalled()
    })

    it('varsayilan zaman asimi bir UST SINIR -- bekleme sonsuz olamaz', () => {
        // Deger buyurse (orn. 60 sn) kapi pratikte ise yaramaz hale gelir:
        // RPC oldugunde kullanici dakikalarca spinnera bakar.
        expect(FIRST_LOAD_TIMEOUT_MS).toBeGreaterThan(0)
        expect(FIRST_LOAD_TIMEOUT_MS).toBeLessThanOrEqual(10000)
    })
})
