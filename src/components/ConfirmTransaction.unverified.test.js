import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ATS gonderim: belirsiz sonuc ('unverified') genel hata gostermez; kart 'processing' kalir, kullanici ana sayfaya
// doner. Aksi halde "gonderilemedi" sanip tekrar gonderir (cift odeme).
const src = readFileSync(new URL('./ConfirmTransaction.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
describe('ConfirmTransaction.vue SEND_TRANSACTION yaniti', () => {
  it('unverified yaniti txFailed hatasi gostermez', () => {
    const i = src.indexOf("console.error('Gonderim reddedildi:'")
    expect(i).toBeGreaterThan(-1)
    const d = src.slice(i - 260, i + 20)
    expect(d).toMatch(/unverified/)
    expect(d).toMatch(/&&\s*!response\.unverified|!response\.unverified/)
  })
})
