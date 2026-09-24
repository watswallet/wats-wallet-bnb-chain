import { describe, it, expect, afterEach, vi } from 'vitest'

/**
 * Bayrak KAPALIYKEN solanaInjected.js manifest'e HIC yazilmaz.
 *
 * Bu, kapinin EN DIS halkasi: content script kaydedilmezse Solana saglayicisi
 * hicbir sayfaya enjekte edilmez, yani `window.solana` / Wallet Standard kaydi
 * hic olusmaz ve bir dapp cuzdani GOREMEZ. Arka plandaki aksiyon kapisi
 * (background.solanaFlagOff.test.js) bunun ALTINDAKI savunma katmanidir.
 *
 * manifest.config.js NODE tarafinda calisir (`import.meta.env` yok): bayragi
 * vite'in loadEnv'i ile okur ve loadEnv onekli process.env degerlerini de gorur.
 */
async function loadManifest(value) {
    vi.resetModules()
    if (value === undefined) delete process.env.VITE_SOLANA_ENABLED
    else process.env.VITE_SOLANA_ENABLED = value
    const mod = await import('../manifest.config.js')
    return mod.default
}

const solanaKaydi = (manifest) =>
    (manifest.content_scripts || []).find((cs) => (cs.js || []).some((f) => f.includes('solanaInjected')))

describe('manifest Solana bayragina baglidir', () => {
    afterEach(() => { delete process.env.VITE_SOLANA_ENABLED; vi.resetModules() })

    it('bayrak kapaliyken solanaInjected.js content script KAYDI YOKTUR', async () => {
        const manifest = await loadManifest('false')
        expect(solanaKaydi(manifest)).toBeUndefined()
    })

    it('ortam degiskeni hic yokken de kayit yoktur -- varsayilan KAPALI', async () => {
        const manifest = await loadManifest(undefined)
        expect(solanaKaydi(manifest)).toBeUndefined()
    })

    it('bayrak kapaliyken EVM (injected.js) ve TON (tonInjected.js) kayitlari DURUR', async () => {
        const manifest = await loadManifest('false')
        const dosyalar = (manifest.content_scripts || []).flatMap((cs) => cs.js || [])
        expect(dosyalar).toContain('src/injected.js')
        expect(dosyalar).toContain('src/tonInjected.js')
    })

    it('bayrak acikken kayit geri gelir -- kapinin bayraga bagli oldugunu kanitlar', async () => {
        const manifest = await loadManifest('true')
        const kayit = solanaKaydi(manifest)
        expect(kayit).toBeTruthy()
        // Dar kapsam KORUNUR: yalnizca https + localhost, ust cerceve.
        expect(kayit.all_frames).toBe(false)
        expect(kayit.matches).toContain('https://*/*')
    })
})
