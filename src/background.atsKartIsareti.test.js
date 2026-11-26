// ATS al/sat ve CoW ATS ucret kartlari ats:true + userOpHash tasir: kurtarma TX makbuz status'u yerine userOp olayiyla
// cozer (ic revert 'success' yazilmaz); userOpHash yoksa makbuzla 'success' ALMAZ.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './test-utils/kaynakTarama'

const oku = (p) => yorumsuz(readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')).replace(/\r\n/g, '\n')
const BG = oku('./background.js')
const SALE = oku('./utils/atsSale.js')

describe('ATS kart isaretleri (kaynak)', () => {
  it('ATS satis karti meta nesnesinde ats:true tasir', () => {
    const i = BG.indexOf('async function atsSaleExecute')
    const g = BG.slice(i, i + 900)
    expect(g).toMatch(/const meta = \{[^}]*ats: true/)
  })
  it('ATS satis onRelayed karta userOpHash yazar ve executeAtsSale onu iletir', () => {
    const i = BG.indexOf('await executeAtsSale(')
    expect(BG.slice(i, i + 500)).toMatch(/onRelayed:[^\n]*userOpHash/)
    expect(SALE).toMatch(/onRelayed\(\{ txHash: r\.txHash, userOpHash: r\.userOpHash \}\)/)
  })
  it('CoW ATS ucret karti ats:true ve userOpHash tasir', () => {
    const i = BG.indexOf('atsExecute: async ({ chainId, calls, quoted, signer })')
    const g = BG.slice(i, i + 900)
    expect(g).toMatch(/const meta = \{[^}]*ats: true/)
    expect(g).toMatch(/onUserOp/)
    expect(g).toMatch(/onRelayed:[^\n]*userOpHash/)
  })
})
