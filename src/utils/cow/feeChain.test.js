// cow/feeChain.js: handleOps / Sponsored cozucu ve makbuz okuma (Review Focus 2). Golden veri test
// icinde Interface ile kurulur; dosya fixture'i YOK. Sahte saglayici: ag yok.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Interface, getAddress, hexlify, randomBytes, zeroPadValue, id } from 'ethers'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import {
  HANDLE_OPS_SELECTOR,
  SPONSORED_TOPIC,
  USER_OP_EVENT_TOPIC,
  FEE_CHAIN_ABI,
  parseHandleOps,
  opBindsUid,
  findSponsoredEvents,
  findUserOpEvents,
  readAccountNonce,
  readBlockNumber,
  readTokenBalance,
  readFeeReceipt,
} from './feeChain'

const IFACE = new Interface(FEE_CHAIN_ABI)
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ENTRY = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const PM = '0x1111111111111111111111111111111111111111'
const PM_BAD = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
const TX = '0x' + 'ab'.repeat(32)

// 56 bayt uid: 32 bayt ozet + 20 bayt owner + 4 bayt validTo
const mkUid = (seed) => hexlify(id(seed)) + OWNER.slice(2).toLowerCase() + '00112233'
const UID = mkUid('emir-1')
const UID2 = mkUid('emir-2')

const execData = (dest, value, func) => IFACE.encodeFunctionData('execute', [dest, value, func])
const pmData = (pm) => (pm ? pm + '00'.repeat(40) : '0x')
const mkOp = ({ sender = OWNER, nonce = 5n, callData, paymaster = PM } = {}) => ({
  sender,
  nonce,
  initCode: '0x',
  callData: callData ?? execData(OWNER, 0n, UID),
  accountGasLimits: zeroPadValue('0x01', 32),
  preVerificationGas: 1n,
  gasFees: zeroPadValue('0x01', 32),
  paymasterAndData: pmData(paymaster),
  signature: '0x',
})
const handleOpsData = (ops) => IFACE.encodeFunctionData('handleOps', [ops, OTHER])

const sponsoredLog = ({ address = PM, sender = OWNER, charged = 7_500_000_000_000_000_000n, gas = 3n, index = 4 } = {}) => {
  const e = IFACE.encodeEventLog('Sponsored', [sender, charged, gas])
  return { address, topics: e.topics, data: e.data, index, transactionHash: TX, blockNumber: 99 }
}
const userOpLog = ({ sender = OWNER, nonce = 5n, success = true, paymaster = PM, address = ENTRY, index = 5 } = {}) => {
  const e = IFACE.encodeEventLog('UserOperationEvent', [id('h' + nonce), sender, paymaster, nonce, success, 1n, 2n])
  return { address, topics: e.topics, data: e.data, index, transactionHash: TX, blockNumber: 99 }
}

// Sahte saglayici: cagrilari kaydeder, hicbir sey yazmaz.
function mkProvider({ receipt, data, tx = undefined } = {}) {
  const calls = []
  return {
    calls,
    getTransactionReceipt: async (h) => {
      calls.push(['receipt', h])
      return receipt === undefined ? null : receipt
    },
    getTransaction: async (h) => {
      calls.push(['tx', h])
      return tx === undefined ? { data } : tx
    },
    call: async (req) => {
      calls.push(['call', req])
      return '0x' + (42).toString(16).padStart(64, '0')
    },
    getBlockNumber: async () => 1234,
  }
}

const okReceipt = (logs, over = {}) => ({ status: 1, to: ENTRY, logs, ...over })
const run = (provider, over = {}) =>
  readFeeReceipt({ provider, entryPoint: ENTRY, paymasters: [PM], txHash: TX, owner: OWNER, uid: UID, ...over })

// Iki op'lu paket: owner'in ucret op'u + baskasinin op'u
const goodOps = () => [mkOp(), mkOp({ sender: OTHER, nonce: 1n, callData: execData(OTHER, 0n, UID2), paymaster: PM })]
const goodProvider = (ops = goodOps(), logs = [sponsoredLog(), userOpLog()], rec = {}) =>
  mkProvider({ receipt: okReceipt(logs, rec), data: handleOpsData(ops) })

describe('sabitler', () => {
  it('seciciler ve topic degerleri ABI ile uyumlu', () => {
    expect(IFACE.getFunction('handleOps').selector).toBe(HANDLE_OPS_SELECTOR)
    expect(IFACE.getEvent('Sponsored').topicHash).toBe(SPONSORED_TOPIC)
    expect(IFACE.getEvent('UserOperationEvent').topicHash).toBe(USER_OP_EVENT_TOPIC)
  })
})

describe('parseHandleOps', () => {
  it('op listesini cozer; nonce BigInt, paymaster EIP-55 ya da null', () => {
    const ops = parseHandleOps(handleOpsData([mkOp(), mkOp({ paymaster: null, nonce: 9n })]))
    expect(ops).toHaveLength(2)
    expect(ops[0].sender).toBe(getAddress(OWNER))
    expect(typeof ops[0].nonce).toBe('bigint')
    expect(ops[0].nonce).toBe(5n)
    expect(ops[0].paymaster).toBe(getAddress(PM))
    expect(ops[1].paymaster).toBeNull()
    expect(ops[1].nonce).toBe(9n)
    expect(ops[0].callData).toBe(execData(OWNER, 0n, UID))
  })
  it('bos 0x, bozuk veri ve baska secici UNSUPPORTED_WRAPPER', () => {
    for (const bad of ['0x', '0x765e827f', '0x765e827fdeadbeef', 'xyz', null, undefined, IFACE.encodeFunctionData('execute', [OWNER, 0n, UID])]) {
      expect(() => parseHandleOps(bad)).toThrow(/UNSUPPORTED_WRAPPER/)
      try {
        parseHandleOps(bad)
      } catch (e) {
        expect(e.code).toBe('UNSUPPORTED_WRAPPER')
      }
    }
  })
})

describe('opBindsUid', () => {
  const op = (cd) => ({ callData: cd })
  it('dogru baglanti true; buyuk/kucuk harf duyarsiz', () => {
    expect(opBindsUid(op(execData(OWNER, 0n, UID)), OWNER, UID)).toBe(true)
    expect(opBindsUid(op(execData(OWNER.toLowerCase(), 0n, UID)), OWNER, UID.toUpperCase().replace('0X', '0x'))).toBe(true)
  })
  it('farkli uid, value != 0, dest != owner, ek bayt, eksik bayt: false', () => {
    expect(opBindsUid(op(execData(OWNER, 0n, UID2)), OWNER, UID)).toBe(false)
    expect(opBindsUid(op(execData(OWNER, 1n, UID)), OWNER, UID)).toBe(false)
    expect(opBindsUid(op(execData(OTHER, 0n, UID)), OWNER, UID)).toBe(false)
    expect(opBindsUid(op(execData(OWNER, 0n, UID + '00')), OWNER, UID)).toBe(false)
    expect(opBindsUid(op(execData(OWNER, 0n, UID.slice(0, -2))), OWNER, UID)).toBe(false)
  })
  it('uid 56 bayt degilse ve callData bozuksa false', () => {
    expect(opBindsUid(op(execData(OWNER, 0n, '0x1234')), OWNER, '0x1234')).toBe(false)
    expect(opBindsUid(op('0x'), OWNER, UID)).toBe(false)
    expect(opBindsUid(op('0xb61d27f6zz'), OWNER, UID)).toBe(false)
    expect(opBindsUid(op(IFACE.encodeFunctionData('balanceOf', [OWNER])), OWNER, UID)).toBe(false)
  })
})

describe('findSponsoredEvents / findUserOpEvents', () => {
  it('yalniz izinli paymaster + owner olaylarini doner', () => {
    const logs = [
      sponsoredLog({ index: 1 }),
      sponsoredLog({ address: PM_BAD, index: 2 }),
      sponsoredLog({ sender: OTHER, index: 3 }),
      { ...sponsoredLog({ index: 6 }), topics: [id('Baska()')] },
    ]
    const ev = findSponsoredEvents(logs, { paymasters: [PM], owner: OWNER })
    expect(ev).toHaveLength(1)
    expect(ev[0]).toEqual({ paymaster: getAddress(PM), atsCharged: 7_500_000_000_000_000_000n, gasCost: 3n, logIndex: 1 })
  })
  it('bozuk veri olay sayilmaz', () => {
    const l = { ...sponsoredLog(), data: '0x12' }
    expect(findSponsoredEvents([l], { paymasters: [PM], owner: OWNER })).toEqual([])
  })
  it('findUserOpEvents yalniz owner ve EntryPoint adresine ait olaylari doner', () => {
    const logs = [
      userOpLog({ index: 1 }),
      userOpLog({ sender: OTHER, index: 2 }),
      userOpLog({ address: PM_BAD, index: 3 }),
      userOpLog({ nonce: 6n, success: false, index: 4 }),
    ]
    const ev = findUserOpEvents(logs, { entryPoint: ENTRY, owner: OWNER })
    expect(ev.map((e) => e.logIndex)).toEqual([1, 4])
    expect(ev[0].nonce).toBe(5n)
    expect(ev[0].success).toBe(true)
    expect(ev[0].paymaster).toBe(getAddress(PM))
    expect(ev[1].success).toBe(false)
    expect(ev[0].txHash).toBe(TX)
    expect(ev[0].blockNumber).toBe(99)
    expect(ev[0].userOpHash).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('okuma yardimcilari', () => {
  it('nonce, blok, bakiye', async () => {
    const p = mkProvider()
    expect(await readAccountNonce({ provider: p, entryPoint: ENTRY, owner: OWNER })).toBe(42n)
    expect(await readBlockNumber(p)).toBe(1234)
    expect(await readTokenBalance({ provider: p, token: TOKEN, owner: OWNER })).toBe(42n)
    const nonceCall = p.calls.find((c) => c[0] === 'call')[1]
    expect(nonceCall.to).toBe(ENTRY)
    expect(nonceCall.data.slice(0, 10)).toBe(IFACE.getFunction('getNonce').selector)
  })
  it('saglayici hatasi firlatilir (cagiran UNKNOWN sayar)', async () => {
    const p = { call: async () => { throw new Error('rpc down') }, getBlockNumber: async () => { throw new Error('rpc down') } }
    await expect(readAccountNonce({ provider: p, entryPoint: ENTRY, owner: OWNER })).rejects.toThrow('rpc down')
    await expect(readBlockNumber(p)).rejects.toThrow('rpc down')
    await expect(readTokenBalance({ provider: p, token: TOKEN, owner: OWNER })).rejects.toThrow('rpc down')
  })
})

describe('readFeeReceipt (Review Focus 2 matrisi)', () => {
  it('dogru paket: PAID ve atsChargedRaw', async () => {
    const r = await run(goodProvider())
    expect(r).toEqual({ status: 'PAID', atsChargedRaw: '7500000000000000000', paidTxHash: TX })
  })
  it('nonce verildi ve eslesiyor: PAID; eslesmiyor: NOT_BOUND', async () => {
    expect((await run(goodProvider(), { nonce: '5' })).status).toBe('PAID')
    expect((await run(goodProvider(), { nonce: 6 })).status).toBe('NOT_BOUND')
  })
  it('uid farkli (baska emrin ucret op u sunuldu): NOT_BOUND', async () => {
    expect((await run(goodProvider(), { uid: UID2 })).status).toBe('NOT_BOUND')
  })
  it('execute(owner, 1n, uid): NOT_BOUND', async () => {
    const ops = [mkOp({ callData: execData(OWNER, 1n, UID) })]
    expect((await run(goodProvider(ops))).status).toBe('NOT_BOUND')
  })
  it('dest !== owner: NOT_BOUND', async () => {
    const ops = [mkOp({ callData: execData(OTHER, 0n, UID) })]
    expect((await run(goodProvider(ops))).status).toBe('NOT_BOUND')
  })
  it('owner in iki op u ayni uid e bagli: NOT_BOUND', async () => {
    const ops = [mkOp(), mkOp({ nonce: 6n })]
    expect((await run(goodProvider(ops))).status).toBe('NOT_BOUND')
  })
  it('op sender i owner degil (uid baglanmis olsa da): NOT_BOUND', async () => {
    const ops = [mkOp({ sender: OTHER })]
    expect((await run(goodProvider(ops))).status).toBe('NOT_BOUND')
  })
  it('Sponsored yok: NO_SPONSORED_EVENT', async () => {
    expect((await run(goodProvider(goodOps(), [userOpLog()]))).status).toBe('NO_SPONSORED_EVENT')
  })
  it('iki Sponsored(sender=owner): NO_SPONSORED_EVENT', async () => {
    const logs = [sponsoredLog({ index: 4 }), sponsoredLog({ index: 7 })]
    expect((await run(goodProvider(goodOps(), logs))).status).toBe('NO_SPONSORED_EVENT')
  })
  it('Sponsored izinsiz paymaster dan: NO_SPONSORED_EVENT', async () => {
    const logs = [sponsoredLog({ address: PM_BAD })]
    expect((await run(goodProvider(goodOps(), logs))).status).toBe('NO_SPONSORED_EVENT')
  })
  it('Sponsored.sender baskasi: NO_SPONSORED_EVENT', async () => {
    const logs = [sponsoredLog({ sender: OTHER })]
    expect((await run(goodProvider(goodOps(), logs))).status).toBe('NO_SPONSORED_EVENT')
  })
  it('uid e bagli op sponsorsuz + bagsiz op sponsorlu, tek Sponsored: NO_SPONSORED_EVENT', async () => {
    const ops = [mkOp({ paymaster: null }), mkOp({ nonce: 6n, callData: execData(OWNER, 0n, UID2), paymaster: PM })]
    expect((await run(goodProvider(ops))).status).toBe('NO_SPONSORED_EVENT')
  })
  it('uid e bagli op baska paymaster li: NO_SPONSORED_EVENT', async () => {
    const ops = [mkOp({ paymaster: PM_BAD })]
    expect((await run(goodProvider(ops))).status).toBe('NO_SPONSORED_EVENT')
  })
  it('receipt.to EntryPoint degil: UNSUPPORTED_WRAPPER', async () => {
    expect((await run(goodProvider(goodOps(), [sponsoredLog()], { to: PM_BAD }))).status).toBe('UNSUPPORTED_WRAPPER')
  })
  it('calldata multicall seciciyse: UNSUPPORTED_WRAPPER', async () => {
    const p = mkProvider({ receipt: okReceipt([sponsoredLog()]), data: '0xac9650d8' + '00'.repeat(32) })
    expect((await run(p)).status).toBe('UNSUPPORTED_WRAPPER')
  })
  it('status 0: REVERTED', async () => {
    expect((await run(goodProvider(goodOps(), [sponsoredLog()], { status: 0 }))).status).toBe('REVERTED')
  })
  it('makbuz null: NOT_FOUND (kesin sonuc degil); tx verisi gelmedi: NOT_FOUND', async () => {
    expect((await run(mkProvider({ receipt: null }))).status).toBe('NOT_FOUND')
    expect((await run(mkProvider({ receipt: okReceipt([sponsoredLog()]), tx: null }))).status).toBe('NOT_FOUND')
  })
  it('saglayici hatasi firlatilir', async () => {
    const p = { getTransactionReceipt: async () => { throw new Error('rpc down') } }
    await expect(run(p)).rejects.toThrow('rpc down')
  })
  it('YAZMAZ: yalniz okuma cagrilari yapilir', async () => {
    const p = goodProvider()
    await run(p)
    expect(p.calls.map((c) => c[0]).sort()).toEqual(['receipt', 'tx'])
  })
})

describe('kaynak taramasi', () => {
  const kaynak = yorumsuz(
    fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'feeChain.js'), 'utf8'),
  )
  it('ozel anahtar ve featureFlags icermez', () => {
    expect(kaynak).not.toMatch(/privateKey|PRIVATE_KEY|Wallet\(|featureFlags/i)
  })
  it('ATS paymaster adresi sabit degil', () => {
    expect(kaynak.toLowerCase()).not.toContain('0x004e1f5a')
  })
})
