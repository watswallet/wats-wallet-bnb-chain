// R1 (gizli mod birlestirme inceleme turu 2): Aktivite sekmesi hesap/mod degisiminde
// yeniden kurulmali. SSR testleri izleyici ve remount calistiramaz, bu yuzden kaynak-sekil
// kilidi: Home.vue gomulu <History> bileseni user.address ile anahtarlanmali.
// Yorumsuz taranir: iddia yalnizca KOD ile saglanir.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const kaynak = yorumsuz(readFileSync(join(here, 'Home.vue'), 'utf8'))

describe('Home.vue: gomulu aktivite listesi hesaba baglidir', () => {
    it('<History> user.address ile anahtarlanir', () => {
        const etiket = kaynak.match(/<History\b[^>]*>/)
        expect(etiket).not.toBeNull()
        expect(etiket[0]).toMatch(/:key="user\.address"/)
        expect(etiket[0]).toMatch(/:embedded="true"/)
    })

    // Depo geneli: baska bir .vue (orn. ileride bir gizli aktivite sayfasi) <History>'yi anahtarsiz
    // gomerse mod/hesap degisiminde onceki hesabin listesi ekranda kalirdi (R1-m1).
    it('src altindaki HER <History> kullanimi :key="user.address" tasir; yalniz Home.vue icerir', () => {
        const src = join(here, '..')
        const vueDosyalari = readdirSync(src, { recursive: true })
            .map((d) => String(d).replace(/\\/g, '/'))
            .filter((d) => d.endsWith('.vue'))
        expect(vueDosyalari.length).toBeGreaterThan(30)

        const kullananlar = []
        for (const goreli of vueDosyalari) {
            const temiz = yorumsuz(readFileSync(join(src, goreli), 'utf8'))
            // History.vue kendi adini <History> diye cizmez; yine de kendisi sayilmaz.
            if (goreli.endsWith('/History.vue') || goreli === 'History.vue') continue
            const etiketler = temiz.match(/<History\b[^>]*>/g) || []
            const ice = /import\s+History\b/.test(temiz)
            if (etiketler.length === 0 && !ice) continue
            kullananlar.push(goreli)
            for (const etiket of etiketler) expect(etiket, goreli).toMatch(/:key="user\.address"/)
        }

        expect(kullananlar).toEqual(['components/Home.vue'])
        expect(kaynak.match(/<History\b/g)).toHaveLength(1)
    })
})
