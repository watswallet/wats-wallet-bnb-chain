// ResetApp.vue: onay kelimesi HER 12 dilde, dilin kendi kelimesiyle, tam yazilabilir ve kabul edilir.
// Mantik utils/resetConfirm.js'te (resetConfirm.test.js); burada BILESENIN o mantiga dogru bagli oldugu
// gercek SSR render ile olculur: girdi siniri kelimeyi kesmez, dugme dogru yazilista acilir.
// Dil dosyalari diskten okunan GERCEK dosyalardir (yeni dil eklenince otomatik kosulur).
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createI18n } from 'vue-i18n'
import { createApp, captureInstance, render, createTestPinia, installChromeStub } from '../../../test-utils/ssrRender.js'
import { resetInputLimit } from '../../../utils/resetConfirm'
import ResetApp from './ResetApp.vue'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'i18n', 'locales')
const oku = (kod) => JSON.parse(readFileSync(join(localesDir, kod + '.json'), 'utf8'))
const codes = readdirSync(localesDir)
    .filter((ad) => ad.endsWith('.json'))
    .map((ad) => ad.slice(0, -'.json'.length))
    .sort()
const en = oku('en')

// vue-i18n SSR'da "parent scope" bilgisini basar: konu disi gurultu.
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
    delete globalThis.chrome
})

// `yazilan`: kullanicinin girdisi (render'dan once bilesen durumuna yazilir). Doner: { html, dugme }.
async function ciz(kod, yazilan) {
    installChromeStub({})
    const dil = oku(kod)
    const app = createApp(ResetApp)
    app.use(createTestPinia())
    app.use(createI18n({ legacy: false, locale: kod, fallbackLocale: 'en', messages: { en, [kod]: dil } }))
    if (yazilan !== undefined) {
        captureInstance(app, 'ResetApp', (instance) => { instance.setupState.confirmationText = yazilan })
    }
    const html = (await render(app)).replace(/<!--[\s\S]*?-->/g, '')
    // Ilk dugme Geri'dir; sifirlama dugmesi sonuncusudur.
    const dugme = [...html.matchAll(/<button[^>]*>/g)].at(-1)?.[0] ?? ''
    const girdi = html.match(/<input[^>]*>/)?.[0] ?? ''
    return { html, dugme, girdi, dil: dil.settings.security.resetApp }
}

describe.each(codes)('ResetApp %s: onay kelimesi', (kod) => {
    it('girdi siniri kelimeden turer (sabit 10 degil) ve kelimenin tamamina yeter; dugme kapali baslar', async () => {
        const { girdi, dugme, dil } = await ciz(kod)
        const sinir = Number(girdi.match(/maxlength="(\d+)"/)?.[1])
        expect(sinir).toBe(resetInputLimit(dil.confirm_keyword))
        expect(sinir).toBeGreaterThanOrEqual(dil.confirm_keyword.normalize('NFD').length)
        expect(dugme).toContain('disabled')
    })

    it('kelime ekranda (etiket + yer tutucu) aynen gosterilir', async () => {
        const { html, girdi, dil } = await ciz(kod)
        expect(girdi).toContain(`placeholder="${dil.confirm_keyword}"`)
        expect(html).toContain(`>${dil.confirm_keyword}</span>`)
    })

    it('dogru yazilisla dugme acilir ("Sil" etiketi gorunur): kucuk harf, NFD, bosluklu, aksansiz', async () => {
        const w = oku(kod).settings.security.resetApp.confirm_keyword
        const aksansiz = w.normalize('NFD').replace(/\p{M}/gu, '').replace(/Đ/g, 'D')
        for (const girdi of [w, w.toLowerCase(), w.normalize('NFD'), `  ${w} `, aksansiz.toLowerCase()]) {
            const { dugme, html, dil } = await ciz(kod, girdi)
            expect(dugme, `${kod}: "${girdi}" dugmeyi acmali`).not.toContain('disabled')
            expect(html).toContain(dil.btn_delete)
        }
    })

    it('yanlis ya da eksik girdide dugme kapali kalir', async () => {
        const w = oku(kod).settings.security.resetApp.confirm_keyword
        for (const girdi of ['', ' ', w.slice(0, -1), w + 'X', 'DELETE']) {
            const { dugme } = await ciz(kod, girdi)
            expect(dugme, `${kod}: "${girdi}" dugmeyi acmamali`).toContain('disabled')
        }
    })
})

describe('ResetApp kaynak', () => {
    const kaynak = readFileSync(new URL('./ResetApp.vue', import.meta.url), 'utf8')

    it('sabit maxlength="10" kalmadi; onay kelimesi karsilastirmasi ortak yardimciyla yapilir', () => {
        expect(kaynak).not.toMatch(/maxlength="\d+"/)
        expect(kaynak).toMatch(/:maxlength="inputLimit"/)
        expect(kaynak).toMatch(/isResetConfirmed\(/)
        // Eski ham karsilastirma geri gelmesin.
        expect(kaynak).not.toMatch(/confirmationText\.value\.toUpperCase\(\)\s*===/)
    })
})
