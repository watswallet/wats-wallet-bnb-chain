import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A-2: background.swap() ATS kolunun SONUC sozlesmesi (background.js service worker; kaynak uzerinden).
//  - makbuz dogrulanamadi (hata txHash tasir) -> islem zincire gitmis olabilir: HATA DEGIL, `unverified:true`
//    ile success doner ve gecmis kaydi 'error' OLMAZ.
//  - userOp ic revert: executeAtsTransfer (atsPaymaster) `success !== true` iken zaten firlatir; 'success' yazilmaz.
const SRC = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')

function swapAtsDali() {
  const bas = SRC.indexOf('if (atsSwap && isAtsChain(chainId))')
  if (bas < 0) return null
  const son = SRC.indexOf('// GASLESS: approve + swap tek UserOp', bas)
  return SRC.slice(bas, son)
}

describe('swap() ATS kolu sonuc sozlesmesi', () => {
  const dal = swapAtsDali()
  it('dal bulunur', () => expect(dal).not.toBeNull())
  it('txHash tasiyan hata unverified:true ile success doner ve kayit error OLMAZ', () => {
    expect(dal).toMatch(/catch\s*\(e\)\s*\{[\s\S]*?e\.txHash[\s\S]*?unverified:\s*true/)
    const catchBody = dal.slice(dal.indexOf('catch (e)'))
    const unverifiedKol = catchBody.slice(0, catchBody.indexOf('throw e'))
    expect(unverifiedKol).not.toMatch(/updateTxStatus\(txId,\s*'error'/)
    expect(unverifiedKol).toMatch(/resolve\(\{\s*success:\s*true/)
  })
  it("basari kaydi 'success' yalniz executeAtsTransfer dondukten sonra yazilir; userOp ic revert zaten firlatir", () => {
    // executeAtsTransfer userOp success !== true iken FIRLATIR (atsPaymaster): donduyse dogrulanmistir.
    expect(dal).toMatch(/userOp `success !== true` iken ZATEN FIRLATIR/)
    expect(dal.lastIndexOf("updateTxStatus(txId, 'success'")).toBeGreaterThan(dal.indexOf('atsResult = await executeAtsTransfer'))
  })
  it('yanit BigInt tasimaz (hash dizgeleri)', () => {
    expect(dal).not.toMatch(/resolve\(\{[^}]*gas[^}]*\}\)/)
  })
})
