import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'

// KAYNAK KILIDI -- yan panelde hesap seridi (Header.vue cekmecesi) yuksekligi.
//
// Kapatilan hata (kullanici bildirimi): yan panelde serit, altinda bos yer
// dururken kaydirma cubuguna giriyordu. Neden: seridin kaydirilan listesi
// `max-h-87.5` (350px) tasir; bu sinir 600px'lik POPUP icindir. Popup'ta AYNEN
// kalir, yalniz `html.side-panel` altinda kaldirilir.
//
// SINIR: vitest ortami `node`, gercek yerlesim OLCULEMEZ. Bu dosya yalnizca
// sinif adlarini ve CSS bildirimlerini kilitler: sinifi ya da kurali silen,
// kapsamini popup'a tasiyan, blogu yanlis yere koyan degisiklik kirmizi olur.
// "Kaydirma cubugu gercekten cikmiyor" dogrulamasi derlemeli ELLE yapilir
// (plan Gorev 9 Step 6; task-9-report.md'de listelenir).
const here = dirname(fileURLToPath(import.meta.url))
const HEADER = readFileSync(join(here, 'Header.vue'), 'utf8')
const CSS = readFileSync(join(here, '..', 'popup', 'style.css'), 'utf8')

// CSS iddialari YORUMLARI ayiklanmis kaynakta aranir: bir kuralin metni yalniz
// bir yorumun icinde yazili kalirsa iddia yesil KALMAMALI. `yorumsuz` uzunlugu
// korur, yani `indexOf` siralamasi ham kaynakla ayni sonucu verir.
const CSS_KOD = yorumsuz(CSS)

describe('Header -- yan panelde hesap seridi yuksekligi', () => {
    it('serit kapsayicilari sinif tasir ve popup icin max-h-87.5 KORUNUR', () => {
        // `account-rail` TAM belirtec olarak aranir: `account-rail-list` ile karismaz.
        expect(HEADER).toMatch(/class="(?:[^"]*\s)?account-rail(?:\s[^"]*)?"/)
        // Iki sinif AYNI class dizgesinde, SIRADAN BAGIMSIZ (lookahead):
        // `account-rail-list` basa da sona da eklense gecer.
        expect(HEADER).toMatch(/class="(?=[^"]*\baccount-rail-list\b)(?=[^"]*\bmax-h-87\.5\b)[^"]*"/)
    })

    it('yan panel kurallari html.side-panel ile sinirli: liste max-height none !important ve esner', () => {
        expect(CSS_KOD).toMatch(/html\.side-panel \.account-rail-list\s*\{[^}]*max-height:\s*none\s*!important/)
        expect(CSS_KOD).toMatch(/html\.side-panel \.account-rail-list\s*\{[^}]*flex:\s*1 1 0%/)
        expect(CSS_KOD).toMatch(/html\.side-panel \.account-rail-list\s*\{[^}]*min-height:\s*0/)
        expect(CSS_KOD).toMatch(/html\.side-panel \.account-rail\s*\{[^}]*min-height:\s*0/)
    })

    it('rail kurallari yalniz html.side-panel altinda: popup etkilenmez', () => {
        const secicier = CSS_KOD.match(/[^{}]*\.account-rail[^{}]*(?=\{)/g) || []
        expect(secicier.length).toBeGreaterThanOrEqual(2)
        // Virgulle gruplanmis bir listede de HER uye panel kapsamini tasimali:
        // `html.side-panel .account-rail, .account-rail-list` popup'a sizardi.
        const uyeler = secicier.flatMap((s) => s.split(',')).map((s) => s.trim())
        expect(uyeler.every((s) => s.startsWith('html.side-panel '))).toBe(true)
    })

    it('yeni blok mevcut panel bloklarinin ALTINDA', () => {
        // popupStandaloneWindow.test.js `html.side-panel,` blogunu indexOf ile ilk
        // `}`ye kadar keser; yeni blok o bloklarin ONUNE konursa o dilimi bozar.
        const kokBloguAt = CSS_KOD.indexOf('html.side-panel .page-wrapper > div')
        expect(kokBloguAt).toBeGreaterThan(-1)
        expect(CSS_KOD.indexOf('html.side-panel .account-rail')).toBeGreaterThan(kokBloguAt)
    })

    it('alt eylem seridi kucultulemez (shrink-0)', () => {
        const satir = HEADER.split('\n').find((l) => l.includes('gap-2 px-3 pt-4 border-t'))
        expect(satir).toBeDefined()
        expect(satir).toContain('shrink-0')
    })
})
