// G4: ATS gonderiminde hata siniflamasi. Belirsiz sonuc (opSuccess null / txHash var) 'basarisiz' DEGIL, beklemede kalir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { atsSendOutcome } from './atsSendOutcome'
import { yorumsuz } from '../test-utils/kaynakTarama'

describe('atsSendOutcome', () => {
  it('opSuccess false (zincirde ic revert) -> error', () => {
    expect(atsSendOutcome({ opSuccess: false })).toEqual({ kind: 'error' })
  })
  it('opSuccess null -> unverified (kart error YAZILMAZ)', () => {
    expect(atsSendOutcome({ opSuccess: null, userOpHash: '0xuo' })).toEqual({ kind: 'unverified', userOpHash: '0xuo' })
  })
  it('txHash var (relay basarisiz dedi / makbuz dogrulanamadi) -> unverified, hash ve userOpHash tasinir', () => {
    expect(atsSendOutcome({ txHash: '0xh', userOpHash: '0xuo' })).toEqual({ kind: 'unverified', txHash: '0xh', userOpHash: '0xuo' })
  })
  it('txHash da opSuccess da yoksa -> error', () => {
    expect(atsSendOutcome(new Error('x'))).toEqual({ kind: 'error' })
    expect(atsSendOutcome(null)).toEqual({ kind: 'error' })
  })
  it('opSuccess false iken txHash olsa da error (kesin sonuc)', () => {
    expect(atsSendOutcome({ opSuccess: false, txHash: '0xh' })).toEqual({ kind: 'error' })
  })
})

describe('background.js ATS gonderim kolu (kaynak)', () => {
  const SRC = yorumsuz(readFileSync(fileURLToPath(new URL('../background.js', import.meta.url)), 'utf8'))
  const bas = SRC.indexOf('if (atsTransfer && isAtsChain(chainId))')
  const dal = SRC.slice(bas, SRC.indexOf('if (gasToken && isGaslessChain(chainId))', bas))
  const catchGovde = SRC.slice(SRC.indexOf('atsSendOutcome(error)') - 200, SRC.indexOf('atsSendOutcome(error)') + 900)

  it('onRelayed kartini ats:true ile isaretler ve asla success yazmaz', () => {
    const rel = dal.slice(dal.indexOf('onRelayed:'), dal.indexOf("updateTxStatus(txId, 'success'"))
    expect(rel).toMatch(/ats:\s*true/)
    expect(rel).not.toMatch(/'success'/)
  })
  it('userOpHash onUserOp ile alinip karta yazilir', () => {
    expect(dal).toMatch(/onUserOp/)
    expect(dal).toMatch(/userOpHash/)
  })
  it('catch atsSendOutcome ile belirsiz sonucta karti processing birakir, reject unverified', () => {
    expect(bas).toBeGreaterThan(-1)
    expect(SRC).toMatch(/atsSendOutcome\(error\)/)
    expect(catchGovde).toMatch(/'processing'/)
    expect(catchGovde).toMatch(/unverified/)
  })
  it('swap ATS dali degismedi: yalniz executeAtsTransfer success donunce success yazar (unverified deseni korunur)', () => {
    const b = SRC.indexOf("opKind: 'swap'")
    const swapDal = SRC.slice(b, b + 2500)
    expect(swapDal).toMatch(/unverified:\s*true/)
    expect(swapDal).toMatch(/updateTxStatus\(txId, 'success', \{ txHash: txHash \|\| hash, chainId, amount, type: 'Swap' \}\)/)
  })
})
