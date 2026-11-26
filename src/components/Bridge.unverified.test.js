import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ATS kopru: hash'siz belirsiz sonuc ('unverified') genel hata gostermez; kart 'processing' kalir,
// kullanici ana sayfaya (Islemler paneline) doner. Aksi halde tekrar gondermeye itilir (cift odeme).
const src = readFileSync(new URL('./Bridge.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
describe('Bridge.vue BRIDGE yaniti', () => {
  it("unverified yaniti bridgeError yerine ana sayfaya doner", () => {
    const i = src.indexOf("type: 'BRIDGE', message")
    expect(i).toBeGreaterThan(-1)
    const d = src.slice(i - 120, i + 400)
    expect(d).toMatch(/unverified/)
    expect(d).toMatch(/currentPage = 'home'/)
  })
})
