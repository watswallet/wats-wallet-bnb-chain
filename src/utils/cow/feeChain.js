// CoW ATS ucreti II: ucretin odendiginin TEK kaniti zincir verisidir. Bu modul SALT OKUNURDUR:
// handleOps calldata cozumu, execute(owner,0,uid) bagi, Sponsored olayi, nonce/bakiye/blok okuma.
// Hicbir yere YAZMAZ, ag disi yan etkisi yoktur. Paymaster listesi PARAMETREDIR (modul adres
// sabiti tasimaz). Fail-closed: belirsiz sonuc "odendi" sayilmaz; saglayici hatasi firlatilir ve
// cagiran UNKNOWN sayar. Sunucu ikizi: server/service/cowRefundChain.js (ayni mantik).
import { Interface, getAddress, getBytes, hexlify, isHexString } from 'ethers'

export const HANDLE_OPS_SELECTOR = '0x765e827f'
export const SPONSORED_TOPIC = '0x9671d13fb515ea1bac5217acd70f213ec297dab37be5ec45e53654b8c15d3b58'
export const USER_OP_EVENT_TOPIC = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f'
export const FEE_CHAIN_ABI = [
  'function execute(address dest, uint256 value, bytes func)',
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)',
  'event Sponsored(address indexed sender, uint256 atsCharged, uint256 gasCost)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
  'function getNonce(address sender, uint192 key) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]

const IFACE = new Interface(FEE_CHAIN_ABI)
const EXECUTE_SELECTOR = IFACE.getFunction('execute').selector
const UID_BYTES = 56

function unsupported() {
  const e = new Error('UNSUPPORTED_WRAPPER')
  e.code = 'UNSUPPORTED_WRAPPER'
  return e
}

const lc = (s) => String(s).toLowerCase()

// Adres karsilastirmasi EIP-55'e normallestirilerek yapilir; gecersiz adres null doner.
function normAddress(a) {
  try {
    return getAddress(String(a))
  } catch {
    return null
  }
}

/** tx.data -> [{sender, nonce: bigint, callData, paymaster: string|null}] ; selector handleOps degilse UNSUPPORTED_WRAPPER */
export function parseHandleOps(txData) {
  let ops
  try {
    if (typeof txData !== 'string' || !isHexString(txData)) throw unsupported()
    if (lc(txData.slice(0, 10)) !== HANDLE_OPS_SELECTOR) throw unsupported()
    ops = IFACE.decodeFunctionData('handleOps', txData)[0]
  } catch (e) {
    if (e && e.code === 'UNSUPPORTED_WRAPPER') throw e
    throw unsupported()
  }
  return ops.map((op) => {
    const pmd = getBytes(op.paymasterAndData)
    return {
      sender: getAddress(op.sender),
      nonce: BigInt(op.nonce),
      callData: op.callData,
      paymaster: pmd.length >= 20 ? getAddress(hexlify(pmd.slice(0, 20))) : null,
    }
  })
}

/** op.callData = execute(dest,value,func): dest==owner && value==0n && func (bayt duzeyinde) === uid */
export function opBindsUid(op, owner, uid) {
  try {
    const uidBytes = getBytes(uid)
    if (uidBytes.length !== UID_BYTES) return false
    const cd = getBytes(op.callData)
    if (hexlify(cd.slice(0, 4)) !== EXECUTE_SELECTOR) return false
    const [dest, value, func] = IFACE.decodeFunctionData('execute', op.callData)
    if (lc(dest) !== lc(owner)) return false
    if (value !== 0n) return false
    const fb = getBytes(func)
    if (fb.length !== uidBytes.length) return false
    for (let i = 0; i < fb.length; i++) if (fb[i] !== uidBytes[i]) return false
    return true
  } catch {
    return false
  }
}

function topicAddress(topic) {
  try {
    if (!topic) return null
    const b = getBytes(topic)
    if (b.length !== 32) return null
    return getAddress(hexlify(b.slice(12)))
  } catch {
    return null
  }
}

const logIdx = (l) => (l.index != null ? Number(l.index) : l.logIndex != null ? Number(l.logIndex) : null)

/** logs icinde: adres IN paymasters && topic0==SPONSORED_TOPIC && indexed sender==owner */
export function findSponsoredEvents(logs, { paymasters, owner }) {
  const allowed = new Set((paymasters || []).map((p) => getAddress(p)))
  const ownerN = normAddress(owner)
  const out = []
  for (const l of logs || []) {
    const addr = normAddress(l.address)
    if (!addr || !allowed.has(addr)) continue
    const topics = l.topics || []
    if (lc(topics[0] || '') !== SPONSORED_TOPIC) continue
    if (!ownerN || topicAddress(topics[1]) !== ownerN) continue
    try {
      const d = IFACE.decodeEventLog('Sponsored', l.data, topics)
      out.push({ paymaster: addr, atsCharged: BigInt(d.atsCharged), gasCost: BigInt(d.gasCost), logIndex: logIdx(l) })
    } catch {
      // bozuk olay verisi: kanit sayilmaz
    }
  }
  return out
}

export function findUserOpEvents(logs, { entryPoint, owner }) {
  const ep = normAddress(entryPoint)
  const ownerN = normAddress(owner)
  const out = []
  for (const l of logs || []) {
    if (!ep || normAddress(l.address) !== ep) continue
    const topics = l.topics || []
    if (lc(topics[0] || '') !== USER_OP_EVENT_TOPIC) continue
    if (!ownerN || topicAddress(topics[2]) !== ownerN) continue
    try {
      const d = IFACE.decodeEventLog('UserOperationEvent', l.data, topics)
      out.push({
        userOpHash: topics[1],
        nonce: BigInt(d.nonce),
        success: Boolean(d.success),
        paymaster: topicAddress(topics[3]),
        logIndex: logIdx(l),
        txHash: l.transactionHash ?? null,
        blockNumber: l.blockNumber ?? null,
      })
    } catch {
      // bozuk olay verisi: sayilmaz
    }
  }
  return out
}

export async function readAccountNonce({ provider, entryPoint, owner }) {
  const data = IFACE.encodeFunctionData('getNonce', [owner, 0n])
  const raw = await provider.call({ to: entryPoint, data })
  return BigInt(IFACE.decodeFunctionResult('getNonce', raw)[0])
}

export async function readBlockNumber(provider) {
  return Number(await provider.getBlockNumber())
}

export async function readTokenBalance({ provider, token, owner }) {
  const data = IFACE.encodeFunctionData('balanceOf', [owner])
  const raw = await provider.call({ to: token, data })
  return BigInt(IFACE.decodeFunctionResult('balanceOf', raw)[0])
}

/** tx hash'ten: PAID | NOT_FOUND | REVERTED | NOT_BOUND | UNSUPPORTED_WRAPPER | NO_SPONSORED_EVENT */
export async function readFeeReceipt({ provider, entryPoint, paymasters, txHash, owner, uid, nonce = null }) {
  const receipt = await provider.getTransactionReceipt(txHash)
  if (!receipt) return { status: 'NOT_FOUND' }
  if (receipt.status !== 1) return { status: 'REVERTED' }
  if (normAddress(receipt.to) !== normAddress(entryPoint)) return { status: 'UNSUPPORTED_WRAPPER' }
  const tx = await provider.getTransaction(txHash)
  if (!tx) return { status: 'NOT_FOUND' }
  let ops
  try {
    ops = parseHandleOps(tx.data)
  } catch (e) {
    if (e && e.code === 'UNSUPPORTED_WRAPPER') return { status: 'UNSUPPORTED_WRAPPER' }
    throw e
  }
  const ownerN = normAddress(owner)
  const bound = ops.filter(
    (op) => op.sender === ownerN && opBindsUid(op, owner, uid) && (nonce == null || op.nonce === BigInt(nonce)),
  )
  if (bound.length !== 1) return { status: 'NOT_BOUND' }
  const events = findSponsoredEvents(receipt.logs, { paymasters, owner })
  if (events.length !== 1) return { status: 'NO_SPONSORED_EVENT' }
  // Olay uid'e bagli op'a ait olmali: op'un paymaster'i olayi yayandan farkliysa baska op'un olayidir.
  if (bound[0].paymaster !== events[0].paymaster) return { status: 'NO_SPONSORED_EVENT' }
  return { status: 'PAID', atsChargedRaw: events[0].atsCharged.toString(), paidTxHash: txHash }
}
