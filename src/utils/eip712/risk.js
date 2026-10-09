// risk.js -- typed data risk siniflandiricisi (SAF modul, D4 Faz 1, AG CAGRISI YOK).
//
// Girdi parse.js'in normallestirilmis typedData'sidir; ama modul savunmaci
// yazildi (bicimi bozuk girdide firlatmaz, null doner).
//
// SINIFLAMA KANONIK TIP DIZGISINE GORE yapilir (EIP-712 `encodeType`): gercek
// token sozlesmesi yalniz o TAM dizgiyi kabul eder; primaryType/alan adi sezgisi
// yalniz YEDEKtir (kanonik olmayan ama permit benzeri istek -> "yorumlanamiyor").
//
// Donus: null (taninmayan, permit benzeri olmayan tur) ya da
//   { kind, level, flags[], spender?, amount?, expiry?, deadline?, allowed?, items? }
//   kind  : 'erc2612' | 'dai' | 'permit2' | 'seaport' | 'permit_unknown'
//   level : 'warning' | 'danger'
//   flags : 'unlimited' | 'practically_unlimited' | 'no_expiry' | 'expired'
//           | 'replayable' | 'receives_nothing'   (sabit sirayla, tekrarsiz)
//   spender: EIP-55 adres (KISALTILMAMIS); amount/expiry/deadline: ONDALIK string
//           (ham birim; token ondaligi BILINMIYOR, insan okunur sayi uretilmez)
import { getAddress } from 'ethers'

const TWO_128 = 2n ** 128n
const NO_EXPIRY_AT = 2n ** 48n - 1n // Permit2 uint48 azami: "suresiz"
const FLAG_ORDER = ['unlimited', 'practically_unlimited', 'no_expiry', 'expired', 'replayable', 'receives_nothing']
const DANGER_FLAGS = new Set(['unlimited', 'practically_unlimited', 'replayable', 'receives_nothing'])

const PERMIT2_DETAILS = 'PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)'
const PERMIT2_TOKEN_PERMISSIONS = 'TokenPermissions(address token,uint256 amount)'
const SEAPORT_TAIL = 'ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount,address recipient)OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)'
const seaportOrder = (counterName) => `OrderComponents(address offerer,address zone,OfferItem[] offer,ConsiderationItem[] consideration,uint8 orderType,uint256 startTime,uint256 endTime,bytes32 zoneHash,uint256 salt,bytes32 conduitKey,uint256 ${counterName})${SEAPORT_TAIL}`

// Kanonik dizgi -> { kind, family }. Dizgiler resmi kaynaklardan okundu
// (Uniswap Permit2 PermitHash.sol, MakerDAO dai.sol, seaport-js constants.ts);
// Seaport 1.0'in `nonce` varyanti DOGRULANMADI (eslesmezse zararsiz: kayit
// "yorumlanamiyor" yoluna duser).
const KNOWN = new Map([
  ['Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)', { kind: 'erc2612', family: 'erc2612' }],
  ['Permit(address holder,address spender,uint256 nonce,uint256 expiry,bool allowed)', { kind: 'dai', family: 'dai' }],
  [`PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)${PERMIT2_DETAILS}`, { kind: 'permit2', family: 'permit2_single' }],
  [`PermitBatch(PermitDetails[] details,address spender,uint256 sigDeadline)${PERMIT2_DETAILS}`, { kind: 'permit2', family: 'permit2_batch' }],
  [`PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)${PERMIT2_TOKEN_PERMISSIONS}`, { kind: 'permit2', family: 'transfer_single' }],
  [`PermitBatchTransferFrom(TokenPermissions[] permitted,address spender,uint256 nonce,uint256 deadline)${PERMIT2_TOKEN_PERMISSIONS}`, { kind: 'permit2', family: 'transfer_batch' }],
  [seaportOrder('counter'), { kind: 'seaport', family: 'seaport' }],
  [seaportOrder('nonce'), { kind: 'seaport', family: 'seaport' }],
])

// Witness'li Permit2 ailesi: son alan (`witness`) cagirana ozgu yapi oldugundan
// tam dizgi sabit degil; bas kisim + TokenPermissions tanimi denetlenir.
const WITNESS_HEAD = {
  PermitWitnessTransferFrom: ['TokenPermissions permitted', 'address spender', 'uint256 nonce', 'uint256 deadline'],
  PermitBatchWitnessTransferFrom: ['TokenPermissions[] permitted', 'address spender', 'uint256 nonce', 'uint256 deadline'],
}

const SEAPORT_ITEM_TYPES = ['NATIVE', 'ERC20', 'ERC721', 'ERC1155', 'ERC721_WITH_CRITERIA', 'ERC1155_WITH_CRITERIA']

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

function big(value) {
  try {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
    if (typeof value === 'string' && /^(?:-?\d+|0x[0-9a-fA-F]+)$/.test(value) && value.length <= 200) return BigInt(value)
  } catch { /* null asagida */ }
  return null
}

const dec = (value) => {
  const b = big(value)
  return b === null ? null : b.toString()
}

function addr(value) {
  if (typeof value !== 'string') return null
  try { return getAddress(value) } catch { return value }
}

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// ---------------------------------------------------------------------------
// Kanonik tip dizgisi: Ad(tur ad,...) + bagimli tipler alfabetik. Eksik tipte null.
/**
 * @param {Record<string, Array<{name: string, type: string}>>} types
 * @param {string} primaryType
 * @returns {string | null}
 */
export function canonicalTypeString(types, primaryType) {
  if (!isObj(types) || typeof primaryType !== 'string') return null
  const deps = new Set()
  const stack = [primaryType]
  const seen = new Set()
  while (stack.length) {
    const name = stack.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const fields = types[name]
    if (!Array.isArray(fields)) return null
    for (const f of fields) {
      if (!isObj(f) || typeof f.type !== 'string') return null
      const base = f.type.replace(/(\[\d*\])+$/, '')
      if (Object.prototype.hasOwnProperty.call(types, base)) {
        if (base !== primaryType) deps.add(base)
        stack.push(base)
      }
    }
  }
  const encodeOne = (name) => `${name}(${types[name].map((f) => `${f.type} ${f.name}`).join(',')})`
  return encodeOne(primaryType) + [...deps].sort().map(encodeOne).join('')
}

function uintWidth(types, typeName, fieldName) {
  const field = (types[typeName] || []).find((f) => f.name === fieldName)
  const m = field && /^uint(\d+)$/.exec(field.type)
  return m ? Number(m[1]) : 256
}

function amountFlags(value, bits) {
  if (value === null) return []
  if (value === 2n ** BigInt(bits) - 1n) return ['unlimited']
  if (value >= TWO_128) return ['practically_unlimited']
  return []
}

// zeroMeans: deadline:0 'expired' (EIP-2612), expiry:0 'no_expiry' (DAI), yoksa null
function timeFlags(value, zeroMeans) {
  if (value === null) return []
  if (value === 0n && zeroMeans) return [zeroMeans]
  if (value >= NO_EXPIRY_AT) return ['no_expiry']
  return []
}

function replayFlags(typedData) {
  const declared = Array.isArray(typedData.types && typedData.types.EIP712Domain)
    ? typedData.types.EIP712Domain.map((f) => f && f.name)
    : []
  return declared.includes('chainId') && declared.includes('verifyingContract') ? [] : ['replayable']
}

function finish(kind, flagList, extra) {
  const set = new Set(flagList)
  const flags = FLAG_ORDER.filter((f) => set.has(f))
  const level = kind === 'permit_unknown' || flags.some((f) => DANGER_FLAGS.has(f)) ? 'danger' : 'warning'
  return { kind, level, flags, ...extra }
}

// ---------------------------------------------------------------------------
function classifyErc2612(td) {
  const { message, types } = td
  const value = big(message.value)
  const deadline = big(message.deadline)
  return finish('erc2612', [
    ...amountFlags(value, uintWidth(types, 'Permit', 'value')),
    ...timeFlags(deadline, 'expired'),
    ...replayFlags(td),
  ], { spender: addr(message.spender), amount: dec(message.value), expiry: dec(message.deadline) })
}

function classifyDai(td) {
  const { message } = td
  const allowed = message.allowed === true
  const expiry = big(message.expiry)
  return finish('dai', [
    ...(allowed ? ['unlimited'] : []), // DAI: allowed:true tanim geregi SINIRSIZ
    ...timeFlags(expiry, 'no_expiry'), // expiry:0 SURESIZ
    ...replayFlags(td),
  ], { spender: addr(message.spender), amount: allowed ? null : '0', expiry: dec(message.expiry), allowed })
}

function permit2Allowance(td, details) {
  const { message, types } = td
  const list = details.filter(isObj)
  const bits = uintWidth(types, 'PermitDetails', 'amount')
  const flags = []
  const items = list.map((d) => {
    flags.push(...amountFlags(big(d.amount), bits), ...timeFlags(big(d.expiration), null))
    return { token: addr(d.token), amount: dec(d.amount), expiration: dec(d.expiration) }
  })
  flags.push(...timeFlags(big(message.sigDeadline), null), ...replayFlags(td))
  return { flags, items }
}

function classifyPermit2Single(td) {
  const { message } = td
  const { flags, items } = permit2Allowance(td, isObj(message.details) ? [message.details] : [])
  const first = items[0] || {}
  return finish('permit2', flags, {
    spender: addr(message.spender), amount: first.amount ?? null, expiry: first.expiration ?? null, deadline: dec(message.sigDeadline), items,
  })
}

function classifyPermit2Batch(td) {
  const { message } = td
  const { flags, items } = permit2Allowance(td, Array.isArray(message.details) ? message.details : [])
  return finish('permit2', flags, {
    spender: addr(message.spender), amount: null, expiry: null, deadline: dec(message.sigDeadline), items,
  })
}

function permit2Transfer(td, permitted) {
  const { message, types } = td
  const bits = uintWidth(types, 'TokenPermissions', 'amount')
  const flags = []
  const items = permitted.filter(isObj).map((p) => {
    flags.push(...amountFlags(big(p.amount), bits))
    return { token: addr(p.token), amount: dec(p.amount) }
  })
  flags.push(...timeFlags(big(message.deadline), null), ...replayFlags(td))
  return { flags, items }
}

function classifyTransferSingle(td) {
  const { message } = td
  const { flags, items } = permit2Transfer(td, isObj(message.permitted) ? [message.permitted] : [])
  return finish('permit2', flags, {
    spender: addr(message.spender), amount: items[0] ? items[0].amount : null, expiry: null, deadline: dec(message.deadline), items,
  })
}

function classifyTransferBatch(td) {
  const { message } = td
  const { flags, items } = permit2Transfer(td, Array.isArray(message.permitted) ? message.permitted : [])
  return finish('permit2', flags, {
    spender: addr(message.spender), amount: null, expiry: null, deadline: dec(message.deadline), items,
  })
}

// Seaport: verilen (offer) + imzalayanin ALDIGI (consideration, alici = offerer)
// kalemler. Hic alinan (pozitif miktarli) kalem yoksa 'receives_nothing'.
function classifySeaport(td) {
  const { message } = td
  const offerer = message.offerer
  const items = []
  const nameOf = (t) => {
    const b = big(t)
    return b === null ? 'UNKNOWN' : (SEAPORT_ITEM_TYPES[Number(b)] || 'UNKNOWN')
  }
  const toItem = (side, it) => ({
    side,
    itemType: nameOf(it.itemType),
    token: addr(it.token),
    identifier: dec(it.identifierOrCriteria),
    amount: dec(it.startAmount),
    endAmount: dec(it.endAmount),
  })
  for (const it of Array.isArray(message.offer) ? message.offer : []) {
    if (isObj(it)) items.push(toItem('give', it))
  }
  let receivesSomething = false
  for (const it of Array.isArray(message.consideration) ? message.consideration : []) {
    if (!isObj(it) || !sameAddress(it.recipient, offerer)) continue
    items.push(toItem('receive', it))
    if ((big(it.startAmount) ?? 0n) > 0n || (big(it.endAmount) ?? 0n) > 0n) receivesSomething = true
  }
  return finish('seaport', [...(receivesSomething ? [] : ['receives_nothing']), ...replayFlags(td)], { items })
}

const HANDLERS = {
  erc2612: classifyErc2612,
  dai: classifyDai,
  permit2_single: classifyPermit2Single,
  permit2_batch: classifyPermit2Batch,
  transfer_single: classifyTransferSingle,
  transfer_batch: classifyTransferBatch,
  seaport: classifySeaport,
}

function isWitnessFamily(types, primaryType) {
  const head = WITNESS_HEAD[primaryType]
  const fields = types[primaryType]
  if (!head || !Array.isArray(fields) || fields.length !== head.length + 1) return false
  const matches = head.every((h, i) => fields[i] && `${fields[i].type} ${fields[i].name}` === h)
  const last = fields[head.length]
  if (!matches || !last || last.name !== 'witness' || !/^[A-Za-z_]\w*$/.test(last.type)) return false
  const perms = types.TokenPermissions
  return Array.isArray(perms) && perms.length === 2
    && perms[0].name === 'token' && perms[0].type === 'address'
    && perms[1].name === 'amount' && perms[1].type === 'uint256'
}

// Yedek sezgi: kanonik olmayan ama permit benzeri.
function looksLikePermit(types, primaryType) {
  if (/permit/i.test(primaryType)) return true
  const fields = types[primaryType]
  return Array.isArray(fields) && fields.some((f) => f && f.name === 'spender' && f.type === 'address')
}

/**
 * @param {{ domain: object, types: object, primaryType: string, message: object }} typedData
 * @returns {null | { kind: string, level: 'warning'|'danger', flags: string[], spender?: string|null, amount?: string|null, expiry?: string|null, deadline?: string|null, allowed?: boolean, items?: object[] }}
 */
export function classifyTypedData(typedData) {
  try {
    if (!isObj(typedData) || !isObj(typedData.types) || !isObj(typedData.message) || typeof typedData.primaryType !== 'string') return null
    const { types, primaryType, message } = typedData
    const canonical = canonicalTypeString(types, primaryType)
    const known = canonical === null ? undefined : KNOWN.get(canonical)
    if (known) return HANDLERS[known.family](typedData)
    if (isWitnessFamily(types, primaryType)) {
      return primaryType === 'PermitWitnessTransferFrom' ? classifyTransferSingle(typedData) : classifyTransferBatch(typedData)
    }
    if (looksLikePermit(types, primaryType)) {
      return finish('permit_unknown', replayFlags(typedData), { spender: addr(message.spender) })
    }
    return null
  } catch {
    // Kapali-basarisiz: yorumlanirken bir sey patladiysa "guvenli" demeyiz.
    return finish('permit_unknown', [], { spender: null })
  }
}
