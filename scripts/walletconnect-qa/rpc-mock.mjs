// WalletConnect QA harness'i -- yerel JSON-RPC taklidi (spec bolum 12, S5 a).
//
// F5 (gonderim) hermetik kosar: bakiye/nonce/gas/estimateGas/getBlockByNumber gibi
// zincir okumalari bu taklitle cevaplanir; gercek bir zincire HICBIR sey yazilmaz ve
// gercek bir public RPC'ye gidilmez. Taklit, HTTPS ana makine adi uzerinden
// (bundler-stub.mjs'in TLS sunucusu, `--host-resolver-rules` ile yerele eslenmis RPC
// ana makineleri) cevap verir; `handle()` saf bir islevdir ve dogrudan da sinanir.
//
// DURUSTLUK KURALI: taklit cevap UYDURMAZ. Bilmedigi yontem/secici icin hata doner VE
// `unknown()` listesine yazar; ilk kuru kosuda bu liste okunup tablo genisletilir.
import { Interface, keccak256, id as keccakId, zeroPadValue, AbiCoder, MaxUint256 } from 'ethers'

const hex = (n) => `0x${BigInt(n).toString(16)}`
const lower = (s) => String(s || '').toLowerCase()
const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = `0x${'00'.repeat(32)}`

const ERC20 = new Interface([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
])
const ENTRY_POINT = new Interface(['function getNonce(address,uint192) view returns (uint256)'])

const USER_OP_EVENT_TOPIC = keccakId('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } })
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })

// options.chains: supported_chains.json dizisi. options.funded: { address, native, token }
export function createRpcMock({ chains, funded = null } = {}) {
  const urlToChain = new Map() // `${host}${path}` -> chainId
  const hostToChains = new Map() // host -> Set<chainId>
  for (const c of chains || []) {
    if (!Array.isArray(c.rpc) || typeof c.chainId !== 'number') continue
    for (const r of c.rpc) {
      let u
      try { u = new URL(r.url) } catch { continue }
      const path = u.pathname.replace(/\/+$/, '') || '/'
      urlToChain.set(`${u.hostname.toLowerCase()}${path}`, c.chainId)
      if (!hostToChains.has(u.hostname.toLowerCase())) hostToChains.set(u.hostname.toLowerCase(), new Set())
      hostToChains.get(u.hostname.toLowerCase()).add(c.chainId)
    }
  }

  const native = new Map() // lower(address) -> bigint
  const tokenBalances = new Map() // `${chainId}:${token}:${holder}` -> bigint
  const allowances = new Map() // `${chainId}:${token}:${owner}:${spender}` -> bigint
  const codes = new Map() // `${chainId}:${address}` -> hex
  const txs = new Map() // hash -> { chainId, raw }
  const log = [] // { chainId, method, kind: 'answered' | 'unknown', note }
  const state = { fundedAddress: funded ? lower(funded.address) : null, defaultToken: funded?.token ?? 0n }
  if (funded) native.set(lower(funded.address), funded.native ?? 10n ** 18n)

  const note = (chainId, method, kind, extra) => log.push({ chainId, method, kind, ...(extra ? { note: extra } : {}) })
  const blockNumber = () => 20_000_000 + Math.floor(Date.now() / 12_000) % 1_000_000

  const block = (n) => ({
    number: hex(n), hash: keccak256(`0x${n.toString(16).padStart(8, '0')}`), parentHash: ZERO_HASH,
    nonce: '0x0000000000000000', sha3Uncles: ZERO_HASH, logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: ZERO_HASH, stateRoot: ZERO_HASH, receiptsRoot: ZERO_HASH, miner: ZERO_ADDR,
    difficulty: '0x0', totalDifficulty: '0x0', extraData: '0x', size: '0x220', gasLimit: '0x1c9c380', gasUsed: '0x0',
    timestamp: hex(Math.floor(Date.now() / 1000)), transactions: [], uncles: [], baseFeePerGas: '0x3b9aca00',
  })

  function ethCall(chainId, call) {
    const to = lower(call.to)
    const data = call.data || call.input || '0x'
    const sel = data.slice(0, 10)
    // EntryPoint.getNonce(address,uint192): hermetik hesapta nonce 0
    if (sel === ENTRY_POINT.getFunction('getNonce').selector) {
      return ENTRY_POINT.encodeFunctionResult('getNonce', [0n])
    }
    for (const name of ['balanceOf', 'allowance', 'decimals', 'symbol', 'name', 'totalSupply']) {
      if (sel !== ERC20.getFunction(name).selector) continue
      const args = ERC20.decodeFunctionData(name, data)
      if (name === 'balanceOf') {
        const holder = lower(args[0])
        const v = tokenBalances.get(`${chainId}:${to}:${holder}`)
        const out = v !== undefined ? v : holder === state.fundedAddress ? state.defaultToken : 0n
        return ERC20.encodeFunctionResult(name, [out])
      }
      if (name === 'allowance') {
        const owner = lower(args[0])
        const v = allowances.get(`${chainId}:${to}:${owner}:${lower(args[1])}`)
        const out = v !== undefined ? v : owner === state.fundedAddress ? MaxUint256 : 0n
        return ERC20.encodeFunctionResult(name, [out])
      }
      if (name === 'decimals') return ERC20.encodeFunctionResult(name, [18])
      if (name === 'symbol') return ERC20.encodeFunctionResult(name, ['QAT'])
      if (name === 'name') return ERC20.encodeFunctionResult(name, ['QA Token'])
      return ERC20.encodeFunctionResult(name, [10n ** 30n])
    }
    return null // bilinmeyen secici
  }

  // Tek bir JSON-RPC istegi. chainId zorunlu (HTTP adaptoru ana makineden cozer).
  function handle(chainId, req) {
    const { id = null, method } = req || {}
    const params = (req && req.params) || []
    const ans = (result) => { note(chainId, method, 'answered'); return rpcResult(id, result) }
    switch (method) {
      case 'eth_chainId': return ans(hex(chainId))
      case 'net_version': return ans(String(chainId))
      case 'web3_clientVersion': return ans('wats-qa-rpc-mock/1')
      case 'eth_syncing': return ans(false)
      case 'eth_accounts': return ans([]) // sunucu hesabi ASLA (gercek RPC'ler bazen gercek adres dondurur)
      case 'eth_coinbase': return ans(ZERO_ADDR)
      case 'eth_blockNumber': return ans(hex(blockNumber()))
      case 'eth_gasPrice': return ans('0x3b9aca00')
      case 'eth_maxPriorityFeePerGas': return ans('0x3b9aca')
      case 'eth_feeHistory': {
        const count = Math.max(1, Math.min(Number(BigInt(params[0] ?? 1)), 1024))
        const perc = Array.isArray(params[2]) ? params[2].length : 0
        return ans({
          oldestBlock: hex(blockNumber() - count + 1),
          baseFeePerGas: Array.from({ length: count + 1 }, () => '0x3b9aca00'),
          gasUsedRatio: Array.from({ length: count }, () => 0.5),
          ...(perc ? { reward: Array.from({ length: count }, () => Array.from({ length: perc }, () => '0x3b9aca')) } : {}),
        })
      }
      case 'eth_getBalance': return ans(hex(native.get(lower(params[0])) ?? 0n))
      case 'eth_getTransactionCount': return ans('0x0')
      case 'eth_getCode': return ans(codes.get(`${chainId}:${lower(params[0])}`) ?? '0x')
      case 'eth_getStorageAt': return ans(ZERO_HASH)
      case 'eth_getLogs': return ans([])
      case 'eth_estimateGas': {
        const c = params[0] || {}
        return ans(c.data && c.data !== '0x' ? '0x30d40' : '0x5208')
      }
      case 'eth_getBlockByNumber': {
        const tag = params[0]
        const n = tag === 'latest' || tag === 'pending' || tag === 'safe' || tag === 'finalized' ? blockNumber() : tag === 'earliest' ? 0 : Number(BigInt(tag))
        return ans(block(n))
      }
      case 'eth_getBlockByHash': return ans(block(blockNumber()))
      case 'eth_getTransactionByHash': {
        const t = txs.get(lower(params[0]))
        return ans(t ? { hash: lower(params[0]), blockNumber: hex(blockNumber()), from: ZERO_ADDR, to: ZERO_ADDR, nonce: '0x0', value: '0x0', input: '0x', gas: '0x5208', gasPrice: '0x3b9aca00' } : null)
      }
      case 'eth_getTransactionReceipt': {
        const t = txs.get(lower(params[0]))
        if (!t) return ans(null) // var olmayan islem: saglikli dugumun dogru cevabi (makbuz sondasi)
        return ans({ transactionHash: lower(params[0]), blockNumber: hex(blockNumber()), blockHash: ZERO_HASH, transactionIndex: '0x0', status: '0x1', gasUsed: '0x5208', cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', from: ZERO_ADDR, to: ZERO_ADDR, logs: (t.logs || []).map((l, i) => ({ ...l, blockNumber: hex(blockNumber()), blockHash: ZERO_HASH, transactionHash: lower(params[0]), transactionIndex: '0x0', logIndex: hex(i), removed: false })), logsBloom: `0x${'00'.repeat(256)}`, type: '0x2', contractAddress: null })
      }
      case 'eth_sendRawTransaction': {
        const raw = String(params[0] || '')
        const hash = keccak256(raw)
        txs.set(lower(hash), { chainId, raw })
        return ans(hash)
      }
      case 'eth_call': {
        let out = null
        try { out = ethCall(chainId, params[0] || {}) } catch (e) { out = null }
        if (out === null) {
          note(chainId, method, 'unknown', `${lower((params[0] || {}).to)} ${String((params[0] || {}).data || '').slice(0, 10)}`)
          return rpcError(id, 3, 'execution reverted (qa-rpc-mock: unknown call)', '0x')
        }
        return ans(out)
      }
      default:
        note(chainId, method, 'unknown')
        return rpcError(id, -32601, `qa-rpc-mock: method not implemented: ${method}`)
    }
  }

  const chainIdForRequest = (host, path) => {
    const h = lower(host)
    const p = String(path || '/').split('?')[0].replace(/\/+$/, '') || '/'
    if (urlToChain.has(`${h}${p}`)) return urlToChain.get(`${h}${p}`)
    const set = hostToChains.get(h)
    if (set && set.size === 1) return [...set][0]
    return null
  }

  // HTTP adaptoru: govde metni -> { status, body }. Dizi (batch) desteklenir.
  function handleHttp({ chainId, bodyText }) {
    let parsed
    try { parsed = JSON.parse(bodyText) } catch { return { status: 400, body: JSON.stringify(rpcError(null, -32700, 'parse error')) } }
    // Bozuk parametre (ornegin BigInt('xyz')) tek istegi -32602 yapar, batch'in geri kalanini DUSURMEZ; kayda girer.
    const one = (r) => {
      try { return handle(chainId, r) } catch (e) {
        note(chainId, (r && r.method) || 'unknown', 'unknown', `HANDLER-ERROR ${e.message}`)
        return rpcError((r && r.id) ?? null, -32602, 'qa-rpc-mock: bad params')
      }
    }
    return { status: 200, body: JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)) }
  }

  return {
    handle,
    handleHttp,
    chainIdForRequest,
    hosts: () => [...hostToChains.keys()],
    fund: (address, amountWei) => native.set(lower(address), BigInt(amountWei)),
    setTokenBalance: (chainId, token, holder, amount) => tokenBalances.set(`${chainId}:${lower(token)}:${lower(holder)}`, BigInt(amount)),
    setAllowance: (chainId, token, owner, spender, amount) => allowances.set(`${chainId}:${lower(token)}:${lower(owner)}:${lower(spender)}`, BigInt(amount)),
    setCode: (chainId, address, code) => codes.set(`${chainId}:${lower(address)}`, code),
    log: () => log.slice(),
    unknown: () => log.filter((l) => l.kind === 'unknown'),
    // Taklit bundler (/paymaster/relay) bir UserOp'u "zincire" gonderdiginde makbuzu burada kaydedilir.
    // userOp bilgisi verilirse EntryPoint UserOperationEvent logu (success=true) eklenir; cuzdan
    // ic basariyi bu logdan okur (atsPaymaster: USER_OP_EVENT_TOPIC).
    addKnownTx: (hash, chainId, userOp = null) => {
      const logs = userOp ? [{
        address: userOp.entryPoint,
        topics: [USER_OP_EVENT_TOPIC, userOp.userOpHash, zeroPadValue(userOp.sender, 32), zeroPadValue(userOp.paymaster, 32)],
        data: AbiCoder.defaultAbiCoder().encode(['uint256', 'bool', 'uint256', 'uint256'], [0n, true, 1n, 1n]),
      }] : []
      txs.set(lower(hash), { chainId, raw: null, logs })
    },
    sentRawTransactions: () => [...txs.entries()].map(([hash, t]) => ({ hash, chainId: t.chainId })),
  }
}

// ---------------------------------------------------------------------------
// Kendi kendini sinama
// ---------------------------------------------------------------------------
export async function selfTest(chains) {
  const assert = (await import('node:assert/strict')).default
  const { createServer } = await import('node:http')
  const { JsonRpcProvider } = await import('ethers')
  const me = '0x00000000000000000000000000000000000000aa'
  const mock = createRpcMock({ chains, funded: { address: me, native: 5n * 10n ** 18n, token: 1000n * 10n ** 18n } })

  // saf cagrilar
  assert.equal(mock.handle(10, { id: 1, method: 'eth_chainId' }).result, '0xa')
  assert.equal(mock.handle(10, { id: 1, method: 'eth_getBalance', params: [me, 'latest'] }).result, hex(5n * 10n ** 18n))
  assert.equal(mock.handle(10, { id: 1, method: 'eth_getBalance', params: ['0x00000000000000000000000000000000000000bb', 'latest'] }).result, '0x0')
  assert.equal(mock.handle(10, { id: 1, method: 'eth_getTransactionReceipt', params: ['0x7a1c9f3e5d2b84760ae1cf03b95d6247e803fa1b6cd2947e5081b3fa6c2d9e14'] }).result, null)
  assert.equal(mock.handle(10, { id: 1, method: 'eth_accounts' }).result.length, 0)
  const bal = ERC20.encodeFunctionData('balanceOf', [me])
  assert.equal(BigInt(mock.handle(56, { id: 1, method: 'eth_call', params: [{ to: '0x0000000000000000000000000000000000000001', data: bal }, 'latest'] }).result), 1000n * 10n ** 18n)
  const alw = ERC20.encodeFunctionData('allowance', [me, '0x0000000000000000000000000000000000000002'])
  assert.equal(BigInt(mock.handle(56, { id: 1, method: 'eth_call', params: [{ to: '0x0000000000000000000000000000000000000001', data: alw }, 'latest'] }).result), MaxUint256)
  const nonce = ENTRY_POINT.encodeFunctionData('getNonce', [me, 0])
  assert.equal(BigInt(mock.handle(10, { id: 1, method: 'eth_call', params: [{ to: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108', data: nonce }, 'latest'] }).result), 0n)
  // bilinmeyen: hata + kayit (sessizce uydurmaz)
  assert.equal(mock.handle(10, { id: 2, method: 'debug_traceCall' }).error.code, -32601)
  assert.equal(mock.handle(10, { id: 3, method: 'eth_call', params: [{ to: me, data: '0xdeadbeef' }] }).error.code, 3)
  assert.equal(mock.unknown().length, 2)
  // bozuk parametre: batch'te yalniz o istek hata alir, digeri cevaplanir
  const mixed = JSON.parse(mock.handleHttp({ chainId: 10, bodyText: JSON.stringify([{ id: 1, method: 'eth_getBlockByNumber', params: ['xyz', false] }, { id: 2, method: 'eth_chainId' }, { id: 3, method: 'eth_getBlockByNumber', params: ['earliest', false] }]) }).body)
  assert.equal(mixed[0].error.code, -32602)
  assert.equal(mixed[1].result, '0xa')
  assert.ok(mixed[2].result && !mixed[2].error)
  assert.equal(mock.unknown().length, 3)
  // ham islem -> makbuz
  const sent = mock.handle(10, { id: 4, method: 'eth_sendRawTransaction', params: ['0x02f8'] }).result
  assert.ok(mock.handle(10, { id: 5, method: 'eth_getTransactionReceipt', params: [sent] }).result.status === '0x1')
  // ana makine -> zincir
  assert.equal(mock.chainIdForRequest('mainnet.optimism.io', '/'), 10)
  assert.equal(mock.chainIdForRequest('arb1.arbitrum.io', '/rpc'), 42161)
  assert.equal(mock.chainIdForRequest('example.invalid', '/'), null)

  // ethers JsonRpcProvider gercek HTTP uzerinden: bakiye, blok, gas, makbuz
  const srv = createServer((req, res) => {
    let b = ''
    req.on('data', (d) => { b += d })
    req.on('end', () => {
      const out = mock.handleHttp({ chainId: 10, bodyText: b })
      res.writeHead(out.status, { 'content-type': 'application/json' })
      res.end(out.body)
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const p = new JsonRpcProvider(`http://127.0.0.1:${srv.address().port}`, 10, { staticNetwork: true })
    assert.equal(await p.getBalance(me), 5n * 10n ** 18n)
    assert.ok((await p.getBlock('latest')).number > 0)
    assert.equal(await p.estimateGas({ from: me, to: me, value: 1 }), 21000n)
    assert.equal(await p.getTransactionReceipt('0x7a1c9f3e5d2b84760ae1cf03b95d6247e803fa1b6cd2947e5081b3fa6c2d9e14'), null)
    const fee = await p.getFeeData()
    assert.ok(fee.gasPrice > 0n)
  } finally {
    srv.close()
  }
  return 'rpc-mock: tum sinama vakalari gecti'
}
