// Bekleyen islem iskeleti ZINCIR damgasi tasir (golge bakiye useTokenBalance bu alana bakar).
// chainId yoksa alan HIC yazilmaz: eski kayitlarla ayni sekil.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPendingSkeleton } from './processTransaction'
import { yorumsuz } from '../test-utils/kaynakTarama'

const ALICI = '0x1111111111111111111111111111111111111111'
const TOKEN = '0x2222222222222222222222222222222222222222'
const GONDEREN = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'

const tx = (data) => ({
  hash: '0xdead', nonce: 7, from: GONDEREN, to: TOKEN, value: 0n, data, gasLimit: 21000n, gasPrice: 1000000000n,
})
const TRANSFER = '0xa9059cbb' + '0'.repeat(24) + ALICI.slice(2) + '0'.repeat(64)

describe('buildPendingSkeleton - chain_id damgasi', () => {
  it('ERC-20 gonderisi mesajdaki chainId yi chain_id olarak yazar', () => {
    const s = buildPendingSkeleton(tx(TRANSFER), { amount: '4', chainId: 56, assetData: { symbol: 'tslax' } }, GONDEREN)

    expect(s.chain_id).toBe(56)
  })

  it('native gonderi de damgalanir', () => {
    const s = buildPendingSkeleton(tx('0x'), { amount: '1', chainId: 1 }, GONDEREN)

    expect(s.chain_id).toBe(1)
  })

  it('chainId yoksa chain_id anahtari HIC yazilmaz (eski kayitlarla ayni sekil)', () => {
    const s = buildPendingSkeleton(tx(TRANSFER), { amount: '4', assetData: { symbol: 'tslax' } }, GONDEREN)

    expect('chain_id' in s).toBe(false)
  })

  // Damga yalniz iskelet ZINCIRI BILEN mesajla kurulursa ise yarar: SEND_TRANSACTION isleyicisi
  // chainId'yi message.message'tan okur ve ayni nesneyi iskelete verir.
  it('SEND_TRANSACTION yolu iskeleti chainId tasiyan mesajla kurar (background.js kaynak kilidi)', () => {
    const kod = yorumsuz(readFileSync(new URL('../background.js', import.meta.url), 'utf8'))

    expect(kod).toMatch(/const \{ tx, amount, chainId, assetData, toLabel \} = message\.message/)
    expect(kod).toContain('buildPendingSkeleton(txResponse, message.message)')
  })
})
