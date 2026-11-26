// KILIT ACMA SONRASI YAPAY BEKLEME KILIDI (hiz isi, 2026-11-07).
// Taban: unlockSuccess ana ekrana gecmeden once SABIT 800 ms bekliyordu. "Giris yapildi" geri bildirimi
// gorunur kalmali (kisa bir onay) ama gezinme yolunu 800 ms yavaslatmamali.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./Login.vue', import.meta.url)), 'utf8')

describe('Login.vue unlockSuccess', () => {
    const govde = src.slice(src.indexOf('const unlockSuccess'), src.indexOf('</script>'))
    it('basari onayi gorunur kalir ama bekleme en fazla 300 ms', () => {
        const sabit = src.match(/const UNLOCK_SUCCESS_MS = (\d+)/)
        expect(sabit, 'adli sabit').toBeTruthy()
        expect(Number(sabit[1])).toBeGreaterThanOrEqual(150)
        expect(Number(sabit[1])).toBeLessThanOrEqual(300)
        expect(govde).toMatch(/\}, UNLOCK_SUCCESS_MS\)/)
        expect(govde).not.toMatch(/\}, 800\)/)
    })
    it('yonlendirme mantigi (redirect) degismedi', () => {
        expect(govde).toContain("page.currentPage = 'home'")
        expect(govde).toContain('page.currentPage = page.redirect')
        expect(govde).toContain('page.redirect = null')
    })
})
