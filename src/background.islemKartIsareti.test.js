// Inceleme bulgulari: userOp hash'li kartlar isaretlenir; hizlandirilan (replaced) islemde karta YENI hash yazilir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './test-utils/kaynakTarama'

const SRC = yorumsuz(readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8'))

describe('background.js kart isaretleri (kaynak)', () => {
  it("executeSponsored'tan gelen 'processing' kartlari userOpHash tasir (hash userOp hash'idir)", () => {
    const satirlar = SRC.split('\n').filter((l) => /updateTxStatus\(txId, 'processing', \{ txHash: hash,/.test(l))
    expect(satirlar.length).toBeGreaterThanOrEqual(3)
    for (const l of satirlar) expect(l).toMatch(/userOpHash:\s*hash/)
  })
  it('gonderim izleyicisi sonuc yazarken skeleton.hash (replaced sonrasi yeni hash) kullanir, eski txResponse.hash degil', () => {
    const bas = SRC.indexOf('watchTransactionResolution(txResponse, pendingSkeleton)')
    const govde = SRC.slice(bas, bas + 900)
    expect(govde).toMatch(/pendingSkeleton\.hash/)
    expect(govde).not.toMatch(/txHash:\s*txResponse\.hash/)
  })
})
