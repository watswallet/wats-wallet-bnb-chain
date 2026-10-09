import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative, sep } from 'node:path'
import { yorumsuz, saltKod } from '../test-utils/kaynakTarama'

// KAYNAK KILIDI: `dapps` yazimi TEK API'den (utils/dappsStore.js updateDapps).
//
// NEDEN: popup bilesenleri (ConnectDapp, Header, DappPermissions, Dapps) tum
// `dapps` haritasini okuyup GERI yazar; service worker da yazar. Arada bir
// `wallet_revokePermissions` ya da hesap degisimi `dapps`i degistirirse popup'in
// bayat goruntusu o degisikligi GERI ALIR -- revoke icin bir GUVENLIK
// gerilemesi (silinen izin geri gelir). Tek cozum: her yazim
// `navigator.locks` altinda okuma-degistir-yaz yapan updateDapps'tan gecer.
//
// Bu test background.js'i ve bilesenleri TARAR. Bilesen gocu T12/T13'un isidir:
// onlar birlesene kadar bu test KIRMIZI olabilir (W2 dalga siniri kapisi).

const SRC = fileURLToPath(new URL('..', import.meta.url))

// `ton_dapps` / `solana_dapps` / `dapps_x` ESLESMEZ: anahtar TAM `dapps` olmali.
const HAM_YAZIM = /\.set\(\s*\{\s*['"]?dapps['"]?\s*[:,}]/g

// Tek yazici ve testler taranmaz.
const ATLANAN_DOSYALAR = new Set(['utils/dappsStore.js'])

function kaynakDosyalari(dizin) {
    const sonuc = []
    for (const girdi of readdirSync(dizin, { withFileTypes: true })) {
        if (girdi.name === 'node_modules') continue
        const tam = join(dizin, girdi.name)
        if (girdi.isDirectory()) {
            sonuc.push(...kaynakDosyalari(tam))
        } else if (/\.(js|mjs|vue)$/.test(girdi.name) && !/\.test\.(js|mjs)$/.test(girdi.name)) {
            sonuc.push(tam)
        }
    }
    return sonuc
}

const goreli = (tam) => relative(SRC, tam).split(sep).join('/')

function hamYazimlar(kaynak) {
    const kod = yorumsuz(kaynak)
    const bulunan = []
    for (const m of kod.matchAll(HAM_YAZIM)) {
        bulunan.push(kod.slice(0, m.index).split('\n').length)
    }
    return bulunan
}

describe('dapps yazim kilidi (spec 7.1 madde 1, 9 madde 14)', () => {
    const dosyalar = kaynakDosyalari(SRC).filter((d) => !ATLANAN_DOSYALAR.has(goreli(d)))

    it('tarama bos gecmiyor: arka plan ve dort bilesen taranan kumede', () => {
        const adlar = dosyalar.map(goreli)
        expect(dosyalar.length).toBeGreaterThan(100)
        for (const beklenen of [
            'background.js',
            'components/Header.vue',
            'components/dapp/ConnectDapp.vue',
            'components/settings/DappPermissions.vue',
            'components/settings/Dapps.vue',
        ]) {
            expect(adlar).toContain(beklenen)
        }
    })

    it('desen ham dapps yazimini yakalar, ton_dapps/solana_dapps i yakalamaz', () => {
        const yakalar = [
            'await chrome.storage.local.set({ dapps })',
            'await chrome.storage.local.set({dapps: newApps})',
            'chrome.storage.local.set({\n  dapps,\n})',
            "chrome.storage.local.set({ 'dapps': x })",
        ]
        for (const ornek of yakalar) expect(hamYazimlar(ornek), ornek).toHaveLength(1)

        const yakalamaz = [
            'await chrome.storage.local.set({ ton_dapps: next })',
            'await chrome.storage.local.set({ solana_dapps })',
            'chrome.storage.local.set({ dapps_cache: 1 })',
            '// chrome.storage.local.set({ dapps })',
        ]
        for (const ornek of yakalamaz) expect(hamYazimlar(ornek), ornek).toHaveLength(0)
    })

    it('hicbir kaynak dosyada ham chrome.storage.local.set({ dapps ... }) YOK', () => {
        const ihlaller = []
        for (const dosya of dosyalar) {
            for (const satir of hamYazimlar(readFileSync(dosya, 'utf8'))) {
                ihlaller.push(`${goreli(dosya)}:${satir}`)
            }
        }
        // Kirmizi ise liste, goce edilecek bilesenleri (T12/T13) ADIYLA gosterir.
        expect(ihlaller).toEqual([])
    })

    it('arka plan dapps yazimi icin updateDapps i kullanir', () => {
        const bg = saltKod(readFileSync(join(SRC, 'background.js'), 'utf8'))
        expect(bg).toMatch(/\bupdateDapps\s*\(/)
        expect(readFileSync(join(SRC, 'background.js'), 'utf8'))
            .toMatch(/import\s*\{[^}]*\bupdateDapps\b[^}]*\}\s*from\s*['"]\.\/utils\/dappsStore['"]/)
    })
})
