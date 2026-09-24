import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oku = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const addWallets = oku('../settings/AddWallets.vue')
const onboarding = oku('./index.vue')

// OLCULEN HATA: "Ozel anahtar ile ice aktar" dugmesi kullaniciyi ozel anahtar
// ekranina GOTURMUYORDU. Iki dugme de hedef tasimayan ayni redirect()'i
// cagiriyor, index.vue kosulsuz 'import_wallet' (yontem secici) ile basliyor ve
// o secicinin varsayilan sekmesi 'import_phrases'.
describe('AddWallets.vue -- ice aktarma dugmeleri HEDEF tasir', () => {
    it('ozel anahtar dugmesi import_private hedefini gecirir', () => {
        expect(addWallets).toMatch(/redirect\(\s*'import_private'\s*\)/)
    })

    // Ifade dugmesi bugun DOGRU yere dusuyor ama TESADUFEN -- seciciden gelen
    // varsayilan sekme sayesinde. Varsayilan degisirse sessizce bozulur.
    it('ifade dugmesi import_phrases hedefini gecirir', () => {
        expect(addWallets).toMatch(/redirect\(\s*'import_phrases'\s*\)/)
    })

    it('hedef URL hash"ine yazilir', () => {
        expect(addWallets).toContain('onboarding.html')
        expect(addWallets).toMatch(/#\$\{|'#'\s*\+|`#/)
    })

    it('hicbir dugme ARTIK hedefsiz redirect cagirmaz', () => {
        expect(addWallets).not.toMatch(/@click="redirect"/)
    })
})

describe('onboarding/index.vue -- baslangic ekrani', () => {
    it('hedefi PAYLASILAN cozumleyiciden alir', () => {
        expect(onboarding).toMatch(/import \{[^}]*onboardingStartScreen[^}]*\} from '\.\.\/\.\.\/utils\/onboardingTarget'/)
    })

    it('hash cozulmezse BUGUNKU davranis korunur', () => {
        expect(onboarding).toContain("'import_wallet'")
        expect(onboarding).toContain("'start'")
    })

    // index.vue KENDI beyaz listesini kurmamali: iki liste zamanla ayrisir ve
    // biri 'password'u kabul ederse walletSalt ezilir (FIRST_WALLET_ONLY notu).
    // Ilk yazimi `status.value = hash` diye ariyordu ve `hashHedefi` degisken
    // adina takiliyordu -- niyeti yanlis ifade eden bir testti. Niyet: HAM hash
    // cozumleyiciye UGRAMADAN hicbir yere gitmesin.
    it('ham hash cozumleyiciye ugramadan KULLANILMAZ', () => {
        const kullanimlar = [...onboarding.matchAll(/(?:window\.)?location\.hash/g)]
        expect(kullanimlar.length, 'hash hic okunmuyor').toBeGreaterThan(0)
        for (const m of kullanimlar) {
            const oncesi = onboarding.slice(Math.max(0, m.index - 40), m.index)
            expect(oncesi, 'ham hash cozumleyici DISINDA kullanilmis').toContain('onboardingStartScreen(')
        }
        expect(onboarding).not.toMatch(/status\.value\s*=\s*(window\.)?location\.hash/)
    })
})
