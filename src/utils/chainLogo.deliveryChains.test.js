import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chainLogo } from './chainLogo'

// GIZLI MOD TESLIM AGLARI (gizli-mod cok-ag spec 4.1 son madde, E8): ozel modda yalniz yerel dosya cizilir, bu yuzden
// on teslim aginin logosunun HEPSI paketin kendi dosyasidir. Alti ag (10, 25, 137, 8453, 42161, 42220) bugune kadar uzak
// CDN'den geliyordu; bir kez indirilip pakete konur ve supported_chains.json yerel yola cevrilir (normal mod da etkilenir).
// Mevcut chainLogo.test.js'e dokunulmaz: bu kilit kendi dosyasindadir.
const TESLIM_AGLARI = [56, 1, 8453, 42161, 10, 137, 100, 42220, 5000, 25]
const YENI_LOGOLAR = [10, 25, 137, 8453, 42161, 42220]
const PNG_IMZASI = '89504e470d0a1a0a'
const publicDosyasi = (yol) => fileURLToPath(new URL(`../../public${yol}`, import.meta.url))

describe('chainLogo -- gizli mod teslim aglarinin logosu yerel dosyadir', () => {
    it.each(TESLIM_AGLARI)('ag %i: logoURI /chains/<id>.png ve dosya paketin public klasorunde vardir', (id) => {
        expect(chainLogo(id)).toBe(`/chains/${id}.png`)
        expect(existsSync(publicDosyasi(chainLogo(id)))).toBe(true)
    })

    // Dosya gercek bir PNG, kare ve kucuk olmali: 2000 px'lik 100 KB'lik kaynak gorseli paketi sismirir.
    it.each(YENI_LOGOLAR)('ag %i: yeni logo gercek bir kare PNG ve 100 KB altindadir', (id) => {
        const veri = readFileSync(publicDosyasi(`/chains/${id}.png`))
        expect(veri.subarray(0, 8).toString('hex')).toBe(PNG_IMZASI)
        const genislik = veri.readUInt32BE(16)
        expect(genislik).toBe(veri.readUInt32BE(20))
        expect(genislik).toBeLessThanOrEqual(512)
        expect(veri.length).toBeLessThan(100_000)
    })
})
