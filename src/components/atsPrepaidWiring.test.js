// Dort ATS ucret ekrani onceki odeme notunu AYNI anahtarla gecer (spec §6.5). Component anahtar
// TURETMEZ (bkz. AtsFeeCard.ssr.test.js); bu yuzden baglanti ekran kaynaginda kilitlenir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const oku = (ad) => readFileSync(fileURLToPath(new URL(`./${ad}`, import.meta.url)), 'utf8')

describe('onceki odeme notu dort ekranda bagli', () => {
  for (const ad of ['ConfirmTransaction.vue', 'Dapp.vue', 'Swap.vue', 'Bridge.vue']) {
    it(ad, () => {
      const kaynak = oku(ad)
      expect(kaynak).toContain(`:prepaid-key="atsPrepaid ? 'send.confirmTransaction.atsPrepaidNote' : null"`)
      expect(kaynak).toMatch(/prepaid: atsPrepaid/)
    })
  }
})
