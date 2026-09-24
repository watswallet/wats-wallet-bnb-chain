import { describe, it, expect, vi } from 'vitest'
import {
    detectSurface, closeOrNavigate,
    SURFACE_POPUP, SURFACE_WINDOW, SURFACE_PANEL,
} from './uiSurface'

const loc = (pathname, hash = '') => ({ pathname, hash })

describe('detectSurface', () => {
    it('panel sayfasi yolundan tanir', () => {
        expect(detectSurface(loc('/src/sidepanel/index.html'))).toBe(SURFACE_PANEL)
    })

    it('onay penceresini #window hash inden tanir', () => {
        expect(detectSurface(loc('/src/popup/index.html', '#window'))).toBe(SURFACE_WINDOW)
    })

    it('hash siz popup sayfasi popup tur', () => {
        expect(detectSurface(loc('/src/popup/index.html'))).toBe(SURFACE_POPUP)
    })

    // Panel yolu hash ten ONCE bakilir: paneli '#window' ile acan bir akis yok,
    // ama bir gun olursa panel yine panel kalmali.
    it('panel yolu hash i yener', () => {
        expect(detectSurface(loc('/src/sidepanel/index.html', '#window'))).toBe(SURFACE_PANEL)
    })

    it('konum yoksa (SSR / node) popup varsayilir', () => {
        expect(detectSurface(null)).toBe(SURFACE_POPUP)
        expect(detectSurface(undefined)).toBe(SURFACE_POPUP)
    })
})

describe('closeOrNavigate', () => {
    it('pencere modunda window.close cagirir, sayfayi DEGISTIRMEZ', () => {
        const page = { currentPage: 'settings' }
        const close = vi.fn()
        closeOrNavigate('welcome', { page, surface: SURFACE_WINDOW, closeFn: close })
        expect(close).toHaveBeenCalledTimes(1)
        expect(page.currentPage).toBe('settings')
    })

    it('popup modunda da window.close cagirir', () => {
        const page = { currentPage: 'settings' }
        const close = vi.fn()
        closeOrNavigate('welcome', { page, surface: SURFACE_POPUP, closeFn: close })
        expect(close).toHaveBeenCalledTimes(1)
    })

    // PANELDE KAPANMA YOK: `window.close()` ya hicbir sey yapmaz ya da TUM
    // paneli kapatir -- ikisi de "bu ekrandan cik" niyetinden farkli.
    it('panel modunda kapatmaz, hedef sayfaya gider', () => {
        const page = { currentPage: 'settings' }
        const close = vi.fn()
        closeOrNavigate('welcome', { page, surface: SURFACE_PANEL, closeFn: close })
        expect(close).not.toHaveBeenCalled()
        expect(page.currentPage).toBe('welcome')
    })

    it('panelde hedef sayfa verilmezse hicbir sey yapmaz', () => {
        const page = { currentPage: 'settings' }
        const close = vi.fn()
        closeOrNavigate(null, { page, surface: SURFACE_PANEL, closeFn: close })
        expect(close).not.toHaveBeenCalled()
        expect(page.currentPage).toBe('settings')
    })
})
