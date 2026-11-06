// cow/feeResolve.js: belirsiz ucret op'unu zincirden cozer (Review Focus 1). Sahte saglayici: ag yok,
// yazma yok. Yeni nonce yalniz NOT_BOUND_PROVEN (kanitli "inmedi") ile; kanitsizlikta UNKNOWN.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Interface, hexlify, zeroPadValue, id } from 'ethers'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { FEE_CHAIN_ABI, USER_OP_EVENT_TOPIC } from './feeChain'
import { resolveFeeOp, RESOLVE, FEE_LOG_CHUNK_BLOCKS } from './feeResolve'

const IFACE = new Interface(FEE_CHAIN_ABI)
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ENTRY = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const PM = '0x1111111111111111111111111111111111111111'
const TX = '0x' + 'ab'.repeat(32)
const mkUid = (seed) => hexlify(id(seed)) + OWNER.slice(2).toLowerCase() + '00112233'
const UID = mkUid('emir-1')
const UID2 = mkUid('emir-2')

const execData = (dest, value, func) => IFACE.encodeFunctionData('execute', [dest, value, func])
const mkOp = ({ sender = OWNER, nonce = 5n, callData, paymaster = PM } = {}) => ({
  sender,
  nonce,
  initCode: '0x',
  callData: callData ?? execData(OWNER, 0n, UID),
  accountGasLimits: zeroPadValue('0x01', 32),
  preVerificationGas: 1n,
  gasFees: zeroPadValue('0x01', 32),
  paymasterAndData: paymaster ? paymaster + '00'.repeat(40) : '0x',
  signature: '0x',
})
const handleOpsData = (ops) => IFACE.encodeFunctionData('handleOps', [ops, OTHER])
const sponsoredLog = () => {
  const e = IFACE.encodeEventLog('Sponsored', [OWNER, 7_500_000_000_000_000_000n, 3n])
  return { address: PM, topics: e.topics, data: e.data, index: 4, transactionHash: TX, blockNumber: 150 }
}
const userOpLog = ({ sender = OWNER, nonce = 5n, block = 150, tx = TX } = {}) => {
  const e = IFACE.encodeEventLog('UserOperationEvent', [id('h' + nonce), sender, PM, nonce, true, 1n, 2n])
  return { address: ENTRY, topics: e.topics, data: e.data, index: 5, transactionHash: tx, blockNumber: block }
}

const hex32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0')

// Sahte saglayici: nonce, son blok, kayitlar; getLogs penceresine gore suzer ve cagrilari kaydeder.
function mkProvider({
  nonce = 6n,
  latest = 1000,
  logs = [],
  receipt = { status: 1, to: ENTRY, logs: [sponsoredLog(), userOpLog()] },
  txData = handleOpsData([mkOp()]),
  nonceError = false,
  logsError = null, // pencere sirasi (0 tabanli) ya da true -> hepsi
  blockError = false,
} = {}) {
  const calls = []
  const logCalls = []
  return {
    calls,
    logCalls,
    call: async (req) => {
      calls.push(['call', req])
      if (nonceError) throw new Error('rpc down')
      return hex32(nonce)
    },
    getBlockNumber: async () => {
      if (blockError) throw new Error('rpc down')
      return latest
    },
    getLogs: async (f) => {
      logCalls.push(f)
      if (logsError === true || logsError === logCalls.length - 1) throw new Error('rpc window')
      return logs.filter((l) => l.blockNumber >= f.fromBlock && l.blockNumber <= f.toBlock)
    },
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => (txData === null ? null : { data: txData }),
  }
}

const OP = { nonce: '5', startBlock: 100 }
const run = (provider, over = {}) =>
  resolveFeeOp({ provider, entryPoint: ENTRY, paymasters: [PM], owner: OWNER, uid: UID, op: OP, ...over })

describe('sabitler', () => {
  it('RESOLVE donmus ve chunk 2000', () => {
    expect(Object.isFrozen(RESOLVE)).toBe(true)
    expect(Object.values(RESOLVE).sort()).toEqual(['NOT_BOUND_PROVEN', 'NOT_LANDED', 'PAID', 'UNKNOWN'])
    expect(FEE_LOG_CHUNK_BLOCKS).toBe(2000)
  })
})

describe('dort ana dal', () => {
  it('nonce esit -> NOT_LANDED (ayni nonce ile yeniden gonder), log taranmaz', async () => {
    const p = mkProvider({ nonce: 5n })
    expect(await run(p)).toEqual({ result: 'NOT_LANDED' })
    expect(p.logCalls).toHaveLength(0)
  })

  it('nonce ileri + eslesen op + Sponsored -> PAID', async () => {
    const p = mkProvider({ logs: [userOpLog()] })
    expect(await run(p)).toEqual({ result: 'PAID', paidTxHash: TX, atsChargedRaw: '7500000000000000000' })
  })

  it('nonce ileri + baska op (calldata uid e bagli degil) -> NOT_BOUND_PROVEN', async () => {
    const p = mkProvider({
      logs: [userOpLog()],
      txData: handleOpsData([mkOp({ callData: execData(OWNER, 0n, UID2) })]),
    })
    expect(await run(p)).toEqual({ result: 'NOT_BOUND_PROVEN', txHash: TX })
  })

  it('nonce ileri + olay yok -> UNKNOWN/EVENT_NOT_FOUND', async () => {
    const p = mkProvider({ logs: [] })
    expect(await run(p)).toEqual({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })
  })

  it('baska nonce nin olayi eslesmez -> EVENT_NOT_FOUND', async () => {
    const p = mkProvider({ logs: [userOpLog({ nonce: 4n })] })
    expect(await run(p)).toEqual({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })
  })
})

describe('Review Focus 1: kanitsizlikta asla NOT_BOUND_PROVEN donmez', () => {
  const wrapperTx = '0x12345678' + '00'.repeat(64) // handleOps degil
  const cases = [
    ['nonce okuma RPC hatasi', () => mkProvider({ nonceError: true }), {}, 'RPC'],
    ['son blok okuma hatasi', () => mkProvider({ blockError: true }), {}, 'RPC'],
    ['nonce geride (bayat saglayici)', () => mkProvider({ nonce: 4n }), {}, 'RPC'],
    ['getLogs hatasi (tek pencere)', () => mkProvider({ logsError: true, logs: [userOpLog()] }), {}, 'RPC'],
    [
      'ikinci pencere hatasi, ilk pencerede olay yok',
      () => mkProvider({ latest: 4300, logsError: 1, logs: [userOpLog({ block: 3000 })] }),
      {},
      'RPC',
    ],
    ['makbuz null', () => mkProvider({ logs: [userOpLog()], receipt: null }), {}, 'NOT_FOUND'],
    ['tx null', () => mkProvider({ logs: [userOpLog()], txData: null }), {}, 'NOT_FOUND'],
    ['handleOps sarmali degil', () => mkProvider({ logs: [userOpLog()], txData: wrapperTx }), {}, 'UNSUPPORTED_WRAPPER'],
    [
      'makbuz EntryPoint e gitmemis',
      () => mkProvider({ logs: [userOpLog()], receipt: { status: 1, to: OTHER, logs: [] } }),
      {},
      'UNSUPPORTED_WRAPPER',
    ],
    [
      'Sponsored olayi yok',
      () => mkProvider({ logs: [userOpLog()], receipt: { status: 1, to: ENTRY, logs: [userOpLog()] } }),
      {},
      'NO_SPONSORED_EVENT',
    ],
    [
      'makbuz revert',
      () => mkProvider({ logs: [userOpLog()], receipt: { status: 0, to: ENTRY, logs: [] } }),
      {},
      'REVERTED',
    ],
    ['startBlock yok', () => mkProvider({ logs: [userOpLog()] }), { op: { nonce: '5' } }, 'EVENT_NOT_FOUND'],
    ['startBlock gecersiz', () => mkProvider({ logs: [userOpLog()] }), { op: { nonce: '5', startBlock: -3 } }, 'EVENT_NOT_FOUND'],
    ['startBlock dize', () => mkProvider({ logs: [userOpLog()] }), { op: { nonce: '5', startBlock: 'abc' } }, 'EVENT_NOT_FOUND'],
  ]
  it.each(cases)('%s -> UNKNOWN', async (_ad, mk, over, reason) => {
    const r = await run(mk(), over)
    expect(r.result).not.toBe(RESOLVE.NOT_BOUND_PROVEN)
    expect(r.result).not.toBe(RESOLVE.PAID)
    expect(r).toEqual({ result: 'UNKNOWN', reason })
  })
})

describe('ayni nonce icin birden cok farkli islem / gecersiz nonce', () => {
  const TX2 = '0x' + 'cd'.repeat(32)

  it('ayni nonce icin iki FARKLI txHash -> UNKNOWN/EVENT_NOT_FOUND (makbuz okunmaz, yeni op yok)', async () => {
    const p = mkProvider({ logs: [userOpLog({ tx: TX }), userOpLog({ tx: TX2 })] })
    let makbuz = 0
    p.getTransactionReceipt = async () => {
      makbuz += 1
      return { status: 1, to: ENTRY, logs: [sponsoredLog(), userOpLog()] }
    }
    expect(await run(p)).toEqual({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })
    expect(makbuz).toBe(0)
  })

  it('ayni txHash iki kez (tekrarlanan kayit) tek islem sayilir -> PAID', async () => {
    const p = mkProvider({ logs: [userOpLog(), userOpLog()] })
    expect((await run(p)).result).toBe('PAID')
  })

  it.each([['dize', 'abc'], ['ondalik', '5.5'], ['nesne', {}]])(
    'BigInt e cevrilemeyen op.nonce (%s) -> UNKNOWN/EVENT_NOT_FOUND, zincire hic dokunulmaz',
    async (_ad, nonce) => {
      const p = mkProvider({ logs: [userOpLog()] })
      expect(await run(p, { op: { nonce, startBlock: 100 } })).toEqual({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })
      expect(p.calls).toHaveLength(0)
      expect(p.logCalls).toHaveLength(0)
    },
  )
})

describe('tarama pencereleri', () => {
  it('start 100, latest 4300, chunk 2000 -> 3 cagri, bosluksuz ve kesisimsiz', async () => {
    const p = mkProvider({ latest: 4300, logs: [] })
    await run(p)
    expect(p.logCalls.map((f) => [f.fromBlock, f.toBlock])).toEqual([
      [100, 2099],
      [2100, 4099],
      [4100, 4300],
    ])
  })

  it('olay son pencerede olsa da bulunur', async () => {
    const p = mkProvider({ latest: 4300, logs: [userOpLog({ block: 4200 })] })
    expect((await run(p)).result).toBe('PAID')
  })

  it('start == latest -> tek pencere', async () => {
    const p = mkProvider({ latest: 100, logs: [] })
    await run(p)
    expect(p.logCalls.map((f) => [f.fromBlock, f.toBlock])).toEqual([[100, 100]])
  })

  it('filtre: EntryPoint adresi, UserOperationEvent topic i ve owner topic i; baska owner eslesmez', async () => {
    const p = mkProvider({ logs: [userOpLog({ sender: OTHER })] })
    const r = await run(p)
    expect(r).toEqual({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })
    const f = p.logCalls[0]
    expect(f.address).toBe(ENTRY)
    expect(f.topics[0]).toBe(USER_OP_EVENT_TOPIC)
    expect(f.topics[1]).toBeNull()
    expect(f.topics[2]).toBe(zeroPadValue(OWNER, 32).toLowerCase())
  })

  it('saglayici owner filtresini uygulamasa bile baska owner in olayi eslesmez (istemci tarafi suzgec)', async () => {
    const p = mkProvider({ logs: [] })
    p.getLogs = async (f) => {
      p.logCalls.push(f)
      return [userOpLog({ sender: OTHER })]
    }
    expect(await run(p)).toEqual({ result: 'UNKNOWN', reason: 'EVENT_NOT_FOUND' })
  })
})

describe('yalniz okur', () => {
  it('kaynak orders / chrome. / patchOrder icermez ve yazma yontemi cagirmaz', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const src = yorumsuz(fs.readFileSync(path.join(dir, 'feeResolve.js'), 'utf8'))
    expect(src).not.toMatch(/orders/)
    expect(src).not.toMatch(/chrome\./)
    expect(src).not.toMatch(/patchOrder/)
    expect(src).not.toMatch(/sendTransaction|broadcast|sponsor|signMessage|signTypedData/)
  })
})
