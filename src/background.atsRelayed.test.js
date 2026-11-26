import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// G7: ATS takas ve kopru - hash gelince arka plan cevabi serbest, kartlar userOp'a bakar.
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const SRC = read('./background.js').replace(/\r\n/g, '\n')

function dal(baslangic, bitisAnahtar) {
  const bas = SRC.indexOf(baslangic)
  expect(bas).toBeGreaterThan(-1)
  const son = SRC.indexOf(bitisAnahtar, bas)
  expect(son).toBeGreaterThan(bas)
  return SRC.slice(bas, son)
}

describe('ATS swap kolu', () => {
  const swap = () => dal('let atsResult', 'return\n        }\n\n        // GASLESS: approve + swap')
  it('asil op onRelayed edilince makeRelayedGate ile cevap serbest, kart ats:true + userOpHash tasir', () => {
    const d = swap()
    expect(d).toMatch(/makeRelayedGate\(/)
    expect(d).toMatch(/pending:\s*true/)
    expect(d).toMatch(/ats:\s*true/)
    expect(d).toMatch(/onUserOp:/)
    expect(d).toMatch(/userOpHash/)
  })
  it('belirsiz sonuc / hash li hata karti error yapmaz (atsSendOutcome)', () => {
    const k = SRC.indexOf("txErrorFromException('SWAP_FAILED'")
    expect(SRC.slice(SRC.lastIndexOf('} catch (error) {', k), k)).toMatch(/atsSendOutcome\(error\)/)
  })
  it('success yalniz executeAtsTransfer donunce yazilir (degismedi)', () => {
    const d = swap()
    expect(d).toMatch(/updateTxStatus\(txId, 'success'/)
  })
})

describe('ATS kopru kolu', () => {
  const kopru = () => dal('let atsBridgeUserOpHash', '// GASLESS: bridge approve')
  it('makeRelayedGate + ats:true + userOpHash', () => {
    const d = kopru()
    expect(d).toMatch(/makeRelayedGate\(/)
    expect(d).toMatch(/pending:\s*true/)
    expect(d).toMatch(/ats:\s*true/)
    expect(d).toMatch(/onUserOp:/)
    expect(d).toMatch(/userOpHash/)
  })
  it('belirsiz sonuc / hash li hata karti error yapmaz (atsSendOutcome)', () => {
    const k = SRC.indexOf("txErrorFromException('BRIDGE_FAILED'")
    expect(SRC.slice(SRC.lastIndexOf('} catch (error) {', k), k)).toMatch(/atsSendOutcome\(error\)/)
  })
})

describe('Bridge.vue', () => {
  it('olu bridge_success ve 1500 ms bekleme kaldirildi', () => {
    const v = read('./components/Bridge.vue')
    expect(v).not.toMatch(/bridge_success/)
    expect(v).not.toMatch(/1500/)
  })
})
