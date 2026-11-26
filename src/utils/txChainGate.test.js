import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isChainBlocked, GATE_NO_HASH_MS } from './txChainGate'

const NOW = 1_000_000_000_000
const BSC = 56
const TON = -239
const card = (o = {}) => ({
  id: 'other', status: 'queued', timestamp: NOW - 1000, accountKey: 'A',
  meta: { chainId: BSC }, ...o,
})
const withHash = (o = {}) => card({ status: 'processing', meta: { chainId: BSC, txHash: '0xabc' }, ...o })
const ask = (cards, extra = {}) => isChainBlocked(cards, { txId: 'me', accountKey: 'A', chainId: BSC, now: NOW, ...extra })

describe('txChainGate - durum x zincir turu', () => {
  it('EVM: onceki hash siz queued reddeder', () => expect(ask([card()])).toBe(true))
  it('EVM: onceki hash siz processing reddeder', () =>
    expect(ask([card({ status: 'processing' })])).toBe(true))
  it('EVM: onceki hash li processing IZIN verir', () => expect(ask([withHash()])).toBe(false))
  it('ATS: hash li processing izin (kuyrukta bekler), hash siz reddeder', () => {
    expect(ask([withHash({ meta: { chainId: BSC, txHash: '0x1', ats: true } })], { ats: true })).toBe(false)
    expect(ask([card({ status: 'processing' })], { ats: true })).toBe(true)
  })
  it('success / error kartlari kilitlemez', () => {
    expect(ask([card({ status: 'success' }), card({ status: 'error', id: 'x' })])).toBe(false)
  })
  it('TON: hash li olsun olmasin bekleyen TON karti reddeder (hasPendingTonTx)', () => {
    const t = card({ status: 'processing', meta: { chainId: TON, txHash: '0x1' } })
    expect(ask([t], { chainId: TON })).toBe(true)
    expect(ask([card({ meta: { chainId: TON } })], { chainId: TON })).toBe(true)
  })
  it('baska zincirin karti kilitlemez; EVM karti TON gonderimini kilitlemez', () => {
    expect(ask([card({ meta: { chainId: 1 } })])).toBe(false)
    expect(ask([card()], { chainId: TON })).toBe(false)
  })
})

describe('txChainGate - kendi kaydi ve yas siniri', () => {
  it('kendi id li queued kart kapiyi TETIKLEMEZ (EVM, ATS, TON)', () => {
    expect(ask([card({ id: 'me' })])).toBe(false)
    expect(ask([card({ id: 'me' })], { ats: true })).toBe(false)
    expect(ask([card({ id: 'me', meta: { chainId: TON } })], { chainId: TON })).toBe(false)
  })
  it('5 dk dan eski hash siz kart kilitlemez, 5 dk icindeki kilitler', () => {
    expect(ask([card({ timestamp: NOW - GATE_NO_HASH_MS - 1 })])).toBe(false)
    expect(ask([card({ status: 'processing', timestamp: NOW - GATE_NO_HASH_MS - 1 })])).toBe(false)
    expect(ask([card({ timestamp: NOW - GATE_NO_HASH_MS + 1000 })])).toBe(true)
  })
  it('timestamp i olmayan kart kilitlemez (TON kapisiyla ayni guvenli yon)', () => {
    expect(ask([card({ timestamp: undefined })])).toBe(false)
  })
})

describe('txChainGate - hesap suzmesi', () => {
  it('normal hesabin karti gizli hesabi kilitlemez ve tersi', () => {
    expect(ask([card({ accountKey: 'NORMAL' })], { accountKey: 'PRIV' })).toBe(false)
    expect(ask([card({ accountKey: 'PRIV' })], { accountKey: 'NORMAL' })).toBe(false)
    expect(ask([card({ accountKey: 'PRIV' })], { accountKey: 'PRIV' })).toBe(true)
  })
  it('accountKey i etiketsiz eski kart guvenli yone dusulur (kilitler)', () => {
    expect(ask([card({ accountKey: null })])).toBe(true)
  })
  it('bozuk girdi cokmez', () => {
    expect(ask(null)).toBe(false)
    expect(ask([null, undefined, {}])).toBe(false)
  })
})

describe('txChainGate - background kablolamasi (kaynak tarama)', () => {
  const src = readFileSync(new URL('../background.js', import.meta.url), 'utf8')
  const start = src.indexOf('async function sendTxInternal')
  const body = src.slice(start, src.indexOf('function tonSendErrorCode', start))
  it('sendTxInternal kapiyi kendi txId si ve hesap anahtariyla cagirir, gonderimden ONCE', () => {
    expect(src).toMatch(/from '\.\/utils\/txChainGate'/)
    const gate = body.indexOf('isChainBlocked(')
    expect(gate).toBeGreaterThan(0)
    expect(body.slice(gate, gate + 250)).toMatch(/txId/)
    expect(body.slice(gate, gate + 250)).toMatch(/accountKey: account\?\.key/)
    expect(gate).toBeLessThan(body.indexOf('wallet.sendTransaction'))
    expect(gate).toBeLessThan(body.indexOf('executeAtsTransfer('))
  })
  it('red kart TX_DROPPED degil PREVIOUS_TX_PENDING hata mesajiyla reject eder ve yeni yazim anahtari yok', () => {
    expect(body).toMatch(/PREVIOUS_TX_PENDING/)
  })
})

describe('txChainGate - sonradan gelen kart', () => {
  it('kendi kartindan SONRA yazilan queued kart kapiyi tetiklemez (B, ardindan gelen C yuzunden reddedilmez)', () => {
    const me = card({ id: 'me', status: 'processing', timestamp: NOW - 5000 })
    expect(ask([me, card({ id: 'c', timestamp: NOW - 1000 })])).toBe(false)
  })
  it('kendi kartindan ONCE yazilan hash siz kart yine kilitler', () => {
    const me = card({ id: 'me', status: 'processing', timestamp: NOW - 1000 })
    expect(ask([me, card({ id: 'a', timestamp: NOW - 5000 })])).toBe(true)
  })
  it('kendi karti listede yoksa tum bekleyen kartlar sayilir (guvenli yon)', () => {
    expect(ask([card({ id: 'c', timestamp: NOW - 1000 })])).toBe(true)
  })
})
