import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Hesap sayisinin ilk-cuzdan akisindaki BAGLANTISI (kaynak taramasi).
//
// Davranis CreatePassword2.accounts.ssr.test.js'te GERCEK render ile olculur. Burada yalniz
// olculemeyen baglanti noktalari kilitlenir: onboarding/index.vue ekranlar arasi durumu
// tutan bir kok bilesen, SSR'da tiklama/olay gelmez ve cocuk ekranlar gercek olurdu.
const oku = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const INDEX = oku('./index.vue')
const PASSWORD = oku('./CreatePassword2.vue')
const ADD_WALLETS = oku('../settings/AddWallets.vue')

// <Bilesen ... /> etiketinin metni: baglantinin DOGRU bilesene yapildigini kanitlamak icin
// (ayni dize baska bir etikete yazilsa da ilk regex'ler gecerdi).
const etiket = (kaynak, ad) => {
    const bas = kaynak.indexOf(`<${ad}`)
    expect(bas, `${ad} etiketi yok`).toBeGreaterThan(-1)
    return kaynak.slice(bas, kaynak.indexOf('/>', bas))
}

describe('onboarding hesap sayisi baglantisi', () => {
    it('index.vue account_count ref, baglama ve olay dinleyicisi', () => {
        expect(INDEX).toMatch(/const account_count = ref\(1\)/)
        expect(INDEX).toMatch(/:account_count="account_count"/)
        expect(INDEX).toMatch(/@account_count="setAccountCount"/)
    })

    it('sayi CreatePassword2\'ye verilir, ImportPhrases\'ten alinir', () => {
        expect(etiket(INDEX, 'CreatePassword2')).toMatch(/:account_count="account_count"/)
        expect(etiket(INDEX, 'ImportPhrases')).toMatch(/@account_count="setAccountCount"/)
    })

    it('setAccountCount gelen sayiyi ref\'e yazar', () => {
        expect(INDEX).toMatch(/const setAccountCount = n => \{\s*account_count\.value = n\s*\}/)
    })

    it('hesap sayisi ekran degisiminde (start/import_wallet/import_phrases/import_private) 1e sifirlanir', () => {
        expect(INDEX).toMatch(/\[\s*'start',\s*'import_wallet',\s*'import_phrases',\s*'import_private'\s*\]\.includes\(newStatus\)\)\s*account_count\.value = 1/)
    })

    it('CreatePassword2 defineProps account_count tasir', () => {
        expect(PASSWORD).toMatch(/defineProps\(\[[^\]]*'account_count'[^\]]*\]\)/)
    })

    it('Cuzdan ekle yolu ayni ImportPhrases akisina gider (AddWallets import_phrases hedefi)', () => {
        expect(ADD_WALLETS).toMatch(/redirect\(\s*'import_phrases'\s*\)/)
    })
})
