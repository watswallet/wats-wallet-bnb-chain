// YEREL YAZI TIPI KILIDI (hiz isi, 2026-11-07).
// Taban: App.vue ve onboarding/index.vue `@import url(https://fonts.googleapis.com/...)` ile Inter'i AGDAN cekiyordu.
// Bu, render'i bloklayan bir CSS istegidir (ag yavassa/yoksa ilk boyama bekler) ve uzanti ekranlarinin dis bir
// ucu dinlemesi demekti. Ayni font (Inter, degisken, opsz+wght) artik pakette yerel.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oku = (yol) => readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8')
const app = oku('./App.vue')
const onboarding = oku('../components/onboarding/index.vue')
const bootstrap = oku('../shared/bootstrap.js')
const onboardingMain = oku('../onboarding/main.js')
const pkg = JSON.parse(oku('../../package.json'))

describe('yerel Inter', () => {
    it.each([['App.vue', app], ['onboarding/index.vue', onboarding]])('%s Google Fonts\'tan font cekmez', (_ad, kaynak) => {
        expect(kaynak).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
        expect(kaynak).not.toMatch(/@import\s+url\(/)
    })
    it.each([['App.vue', app], ['onboarding/index.vue', onboarding]])('%s yerel aileyi ve eski adi yedek olarak ister', (_ad, kaynak) => {
        expect(kaynak).toMatch(/font-family:\s*"Inter Variable",\s*"Inter",\s*sans-serif/)
    })
    it('popup/panel ve onboarding giris noktalari yerel fontu (opsz: Google sunumuyla ayni eksenler) yukler', () => {
        expect(bootstrap).toContain("import '@fontsource-variable/inter/opsz.css'")
        expect(onboardingMain).toContain("import '@fontsource-variable/inter/opsz.css'")
    })
    it('paket kesin surumle bagimlilik ve kurulu', () => {
        expect(pkg.dependencies['@fontsource-variable/inter']).toMatch(/^\d+\.\d+\.\d+$/)
        expect(existsSync(fileURLToPath(new URL('../../node_modules/@fontsource-variable/inter/opsz.css', import.meta.url)))).toBe(true)
    })
})
