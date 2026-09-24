import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// KAYNAK KILIDI -- App.vue SSR ile mount edilemiyor (canli store + chrome
// zinciri), bu yuzden tel kaynak duzeyinde kilitleniyor.
//
// Kapatilan hata: ag saglik izleyicisinin setInterval donus degeri HICBIR YERE
// atanmiyordu -- durdurulmasi teknik olarak imkansizdi. "Popup nasilsa kapanir"
// varsayimi. Yan panelde dongu acik her pencerede saatlerce doner.
const app = readFileSync(fileURLToPath(new URL('./App.vue', import.meta.url)), 'utf8')

describe('App.vue -- yoklama dongusu durdurulabilir', () => {
    it('izleyici interval i bir kimlige atanir', () => {
        expect(app).toMatch(/connectionTimer\s*=\s*setInterval/)
    })

    it('onUnmounted interval i temizler', () => {
        const blok = app.slice(app.indexOf('onUnmounted('))
        expect(blok).toMatch(/clearInterval\(connectionTimer\)/)
    })

    it('gorunurluk degisimi dinleniyor', () => {
        expect(app).toContain("addEventListener('visibilitychange'")
    })

    it('gorunurluk dinleyicisi de kaldiriliyor', () => {
        const blok = app.slice(app.indexOf('onUnmounted('))
        expect(blok).toContain("removeEventListener('visibilitychange'")
    })

    it('atilmis (atanmamis) setInterval kalmadi', () => {
        // `setInterval(` oncesinde `=` olmayan tek satirlik kullanim aranir.
        const atilmis = [...app.matchAll(/^\s*setInterval\(/gm)]
        expect(atilmis).toEqual([])
    })
})
