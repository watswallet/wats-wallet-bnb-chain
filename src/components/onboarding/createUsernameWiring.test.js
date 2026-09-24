import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// KAYNAK KILIDI. Uretici CreateUsername.vue'nun setup kapsamindan
// utils/usernameSuggest.js'e tasindi; bu dosya tasinmanin GERI ALINMADIGINI
// olcer. Gerekce: uretici SFC'nin icine geri kopyalanirsa yine test edilemez
// hale gelir ve iki kopya (biri test edilen, biri ekranda calisan) sessizce
// ayrisir -- ekranda eski 30 kelimelik havuz kalirken testler yesil kalirdi.
const kaynak = readFileSync(fileURLToPath(new URL('./CreateUsername.vue', import.meta.url)), 'utf8')

describe('CreateUsername.vue -- uretici baglantisi', () => {
    it('ureticiyi PAYLASILAN modulden alir', () => {
        expect(kaynak).toMatch(/import \{[^}]*generateUsername[^}]*\} from '\.\.\/\.\.\/utils\/usernameSuggest'/)
    })

    it('kelime havuzlari SFC icinde YENIDEN tanimlanmaz', () => {
        expect(kaynak).not.toMatch(/const\s+prefixes\s*=/)
        expect(kaynak).not.toMatch(/const\s+nouns\s*=/)
        // Eski gomulu ureticinin adi da kalmamali.
        expect(kaynak).not.toContain('const generateRandomUsername')
    })

    // Kirpma SFC'ye geri sizmamali: kirpilan sey adresten gelen benzersizlik eki.
    it('ad SFC icinde KIRPILMAZ', () => {
        expect(kaynak).not.toContain('substring(0, 15)')
        expect(kaynak).not.toContain('substring(0,15)')
    })

    it('onMounted hala bir ad onerir', () => {
        expect(kaynak).toMatch(/username\.value\s*=\s*generateUsername\(/)
    })
})
