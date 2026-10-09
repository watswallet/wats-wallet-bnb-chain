// parse.js -- eth_signTypedData_v4 parametre ayristirici (SAF modul).
//
// `chrome`, depo, ag YOK. Dapp'ten gelen [adres, typedData] ciftini dogrular,
// SIKI yaprak turu denetiminden gecirir ve imzalanacak/gosterilecek NORMALLESMIS
// typedData'yi uretir. Hicbir sey firlatmaz: sonuc her zaman
// { ok:true, value } ya da { ok:false, error:{ code, message } } dir.
//
// Tasarim belgesi (bolum 6 G1): "gosterilen = imzalanan". Ozet (digest.js) ve
// ekran (view.js) YALNIZ bu dosyanin urettigi normallesmis degeri tuketir; ham
// JSON belirteci ASLA cizilmez/hash'lenmez. Ethers 6.16 `bool` kodlayicisi
// `(!value) ? false : true` oldugundan JSON string "false" DOGRU olarak
// kodlanir: bu yuzden her yaprak, ozet hesabindan ONCE Solidity turuyle
// eslestirilir.
import { getAddress } from 'ethers'

// Ayarlanabilir sinirlar (DOGRULANMADI: gercek fixture'larla sinanacak).
export const LIMITS = Object.freeze({
  MAX_RAW_BYTES: 256 * 1024,
  MAX_DEPTH: 32,
  MAX_NODES: 5000,
  MAX_NAME_LENGTH: 64,
})

const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

class ParamError extends Error {
  constructor(message, code = INVALID_PARAMS) {
    super(message)
    this.code = code
  }
}
const fail = (message, code) => { throw new ParamError(message, code) }

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const ATOMIC_NAME_RE = /^(bool|address|string|bytes|bytes\d+|u?int\d*)$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const DECIMAL_RE = /^-?(0|[1-9][0-9]*)$/
const HEX_INT_RE = /^0x[0-9a-fA-F]+$/
const HEX_BYTES_RE = /^0x(?:[0-9a-fA-F]{2})*$/
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/
const MAX_NUMERIC_STRING = 200
const MAX_ARRAY_FIXED_SIZE = 100000

// EIP-712 standart alan adlari ve BEKLENEN turleri. Turu bunlardan farkli
// bildirilen standart ad reddedilir (verifyingContract'in string olmasi gibi).
const STANDARD_DOMAIN_FIELDS = [
  ['name', 'string'],
  ['version', 'string'],
  ['chainId', 'uint256'],
  ['verifyingContract', 'address'],
  ['salt', 'bytes32'],
]
const STANDARD_TYPE_CHECK = {
  name: (t) => t === 'string',
  version: (t) => t === 'string',
  chainId: (t) => /^uint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)$/.test(t),
  verifyingContract: (t) => t === 'address',
  salt: (t) => t === 'bytes32',
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

function checkName(name, what) {
  if (typeof name !== 'string' || name.length === 0 || name.length > LIMITS.MAX_NAME_LENGTH || !NAME_RE.test(name)) {
    fail(`Invalid ${what} name.`)
  }
  if (FORBIDDEN_KEYS.has(name)) fail(`Forbidden ${what} name.`)
}

// ---------------------------------------------------------------------------
// Ham metin taramasi: JSON.parse 2^53 ustu tam sayiyi SESSIZCE yuvarlar. Dize
// disindaki her sayi belirteci duz, guvenli bir tam sayi olmali; ondalik ve
// ustel biciminin EIP-712'de karsiligi yok. (viem buyuk degerleri ondalik
// STRING yollar.)
function findUnsafeNumber(raw) {
  const n = raw.length
  let i = 0
  while (i < n) {
    const c = raw.charCodeAt(i)
    if (c === 34) { // dize: kacislari atlayarak kapanisa kadar
      i++
      while (i < n) {
        const d = raw.charCodeAt(i)
        if (d === 92) i += 2
        else if (d === 34) break
        else i++
      }
      i++
      continue
    }
    if (c === 45 || (c >= 48 && c <= 57)) {
      let j = i + 1
      while (j < n) {
        const d = raw.charCodeAt(j)
        const numeric = (d >= 48 && d <= 57) || d === 46 || d === 101 || d === 69 || d === 43 || d === 45
        if (!numeric) break
        j++
      }
      const token = raw.slice(i, j)
      if (!DECIMAL_RE.test(token) || !Number.isSafeInteger(Number(token))) return token
      i = j
      continue
    }
    i++
  }
  return null
}

// Tum JSON agaci: dugum sayisi, ic ice gecme derinligi ve yasak anahtarlar.
// Yinelemesiz (yigin tasmasi yok).
function checkJsonShape(root) {
  let nodes = 0
  const stack = [[root, 1]]
  while (stack.length) {
    const [value, depth] = stack.pop()
    nodes++
    if (nodes > LIMITS.MAX_NODES) fail('Typed data has too many values.')
    if (typeof value !== 'object' || value === null) continue
    if (depth > LIMITS.MAX_DEPTH) fail('Typed data is nested too deeply.')
    if (Array.isArray(value)) {
      for (const item of value) stack.push([item, depth + 1])
    } else {
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) fail('Typed data contains a forbidden key.')
        stack.push([value[key], depth + 1])
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tur dizgisi: taban + [] / [N] sonekleri. uint/int icin GENISLIK ACIK olmali
// ("uint" takma adi reddedilir; typehash dizgisi kanonik kalsin).
function parseTypeString(typeStr) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)((?:\[(?:[1-9][0-9]{0,5})?\])*)$/.exec(typeStr)
  if (!m) fail('Invalid type string.')
  const dims = []
  const re = /\[([0-9]*)\]/g
  let d
  while ((d = re.exec(m[2])) !== null) {
    if (d[1] === '') dims.push(null)
    else {
      const size = Number(d[1])
      if (size > MAX_ARRAY_FIXED_SIZE) fail('Fixed array size is too large.')
      dims.push(size)
    }
  }
  return { base: m[1], dims }
}

function atomicKind(base) {
  if (base === 'bool' || base === 'address' || base === 'string' || base === 'bytes') return { kind: base }
  let m = /^(u?)int(\d+)$/.exec(base)
  if (m) {
    const width = Number(m[2])
    if (String(width) !== m[2] || width === 0 || width > 256 || width % 8 !== 0) fail('Invalid integer width.')
    return { kind: 'int', signed: m[1] === '', width }
  }
  m = /^bytes(\d+)$/.exec(base)
  if (m) {
    const size = Number(m[1])
    if (String(size) !== m[1] || size < 1 || size > 32) fail('Invalid bytes size.')
    return { kind: 'bytesN', size }
  }
  return null
}

// ---------------------------------------------------------------------------
// Sema: types -> Map(ad -> [{name,type}]).
function readTypes(typesIn) {
  const map = new Map()
  for (const typeName of Object.keys(typesIn)) {
    checkName(typeName, 'type')
    if (typeName !== 'EIP712Domain' && ATOMIC_NAME_RE.test(typeName)) fail('A struct type cannot use a built-in type name.')
    const fieldsIn = typesIn[typeName]
    if (!Array.isArray(fieldsIn)) fail(`Type "${typeName}" must be an array of fields.`)
    const seen = new Set()
    const fields = []
    for (const f of fieldsIn) {
      if (!isPlainObject(f)) fail(`Type "${typeName}" has an invalid field.`)
      checkName(f.name, 'field')
      if (typeof f.type !== 'string') fail(`Field "${f.name}" of "${typeName}" needs a string type.`)
      if (seen.has(f.name)) fail(`Type "${typeName}" has a duplicate field.`)
      seen.add(f.name)
      fields.push({ name: f.name, type: f.type })
    }
    map.set(typeName, fields)
  }
  return map
}

function readDomainFields(typeMap, domain) {
  let fields
  if (typeMap.has('EIP712Domain')) {
    fields = typeMap.get('EIP712Domain')
    for (const f of fields) {
      const { base, dims } = parseTypeString(f.type)
      if (dims.length > 0 || !atomicKind(base)) fail('EIP712Domain fields must use primitive types.')
      const check = STANDARD_TYPE_CHECK[f.name]
      if (check && !check(f.type)) fail(`EIP712Domain field "${f.name}" has an unexpected type.`)
    }
  } else {
    fields = []
    for (const [name, type] of STANDARD_DOMAIN_FIELDS) {
      if (hasOwn(domain, name)) fields.push({ name, type })
    }
  }
  return fields
}

// primaryType'tan erisilebilen tipler; dongu ve derinlik denetimi.
function collectReachable(typeMap, primaryType) {
  const reachable = new Set()
  const onPath = new Set()
  const visit = (name, depth) => {
    if (depth > LIMITS.MAX_DEPTH) fail('Type graph is nested too deeply.')
    if (onPath.has(name)) fail('Type graph is circular.')
    if (reachable.has(name)) return
    onPath.add(name)
    for (const f of typeMap.get(name)) {
      const { base } = parseTypeString(f.type)
      if (atomicKind(base)) continue
      if (base === 'EIP712Domain') fail('EIP712Domain cannot be used as a field type.')
      if (!typeMap.has(base)) fail(`Unknown type "${base}".`)
      visit(base, depth + 1)
    }
    onPath.delete(name)
    reachable.add(name)
  }
  visit(primaryType, 1)
  return reachable
}

// ---------------------------------------------------------------------------
// Yaprak normallestirme.
function toBigIntStrict(value, path) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) fail(`${path} must be a safe integer.`)
    return BigInt(value)
  }
  if (typeof value === 'string') {
    if (value.length > MAX_NUMERIC_STRING) fail(`${path} is too long.`)
    if (DECIMAL_RE.test(value) || HEX_INT_RE.test(value)) return BigInt(value)
  }
  return fail(`${path} must be an integer (number, decimal string or 0x hex string).`)
}

function normalizeLeaf(atom, value, path) {
  switch (atom.kind) {
    case 'bool':
      if (typeof value !== 'boolean') fail(`${path} must be a JSON boolean.`)
      return value
    case 'int': {
      const big = toBigIntStrict(value, path)
      const bits = BigInt(atom.width)
      const min = atom.signed ? -(1n << (bits - 1n)) : 0n
      const max = atom.signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n
      if (big < min || big > max) fail(`${path} is out of range.`)
      return big.toString()
    }
    case 'address': {
      if (typeof value !== 'string' || !ADDRESS_RE.test(value)) fail(`${path} must be a 0x address.`)
      try { return getAddress(value) } catch { return fail(`${path} has an invalid address checksum.`) }
    }
    case 'bytes':
      if (typeof value !== 'string' || !HEX_BYTES_RE.test(value)) fail(`${path} must be a 0x hex string.`)
      return value.toLowerCase()
    case 'bytesN':
      if (typeof value !== 'string' || !HEX_BYTES_RE.test(value) || value.length !== 2 + atom.size * 2) {
        fail(`${path} must be ${atom.size} bytes of 0x hex.`)
      }
      return value.toLowerCase()
    case 'string':
      if (typeof value !== 'string') fail(`${path} must be a string.`)
      if (LONE_SURROGATE_RE.test(value)) fail(`${path} is not valid text.`)
      return value
    default:
      return fail('Unsupported type.')
  }
}

function makeNormalizer(typeMap) {
  const normalizeValue = (typeStr, value, path, depth) => {
    if (depth > LIMITS.MAX_DEPTH) fail('Typed data is nested too deeply.')
    const { base, dims } = parseTypeString(typeStr)
    if (dims.length > 0) {
      const size = dims[dims.length - 1]
      if (!Array.isArray(value)) fail(`${path} must be an array.`)
      if (size !== null && value.length !== size) fail(`${path} must have exactly ${size} items.`)
      const innerType = base + dims.slice(0, -1).map((s) => (s === null ? '[]' : `[${s}]`)).join('')
      return value.map((item, i) => normalizeValue(innerType, item, `${path}[${i}]`, depth + 1))
    }
    const atom = atomicKind(base)
    if (atom) return normalizeLeaf(atom, value, path)
    return normalizeStruct(typeMap.get(base), value, path, depth + 1)
  }
  const normalizeStruct = (fields, value, path, depth) => {
    if (!isPlainObject(value)) fail(`${path} must be an object.`)
    const out = {}
    const known = new Set()
    for (const f of fields) {
      known.add(f.name)
      if (!hasOwn(value, f.name)) fail(`${path}.${f.name} is required.`)
      out[f.name] = normalizeValue(f.type, value[f.name], `${path}.${f.name}`, depth)
    }
    // Semada olmayan alanlar IMZAYA GIRMEZ ama saklanir: gorunum bunlari
    // "imzalanmayan alan" notuyla bildirir (view.js).
    for (const key of Object.keys(value)) {
      if (!known.has(key)) out[key] = value[key]
    }
    return out
  }
  return { normalizeValue, normalizeStruct }
}

function toActiveChainId(activeChainId) {
  try {
    if (typeof activeChainId === 'bigint') return activeChainId >= 0n ? activeChainId : null
    if (typeof activeChainId === 'number' && Number.isSafeInteger(activeChainId) && activeChainId >= 0) return BigInt(activeChainId)
    if (typeof activeChainId === 'string' && (/^(0|[1-9][0-9]*)$/.test(activeChainId) || HEX_INT_RE.test(activeChainId)) && activeChainId.length <= 80) return BigInt(activeChainId)
  } catch { /* asagida null */ }
  return null
}

// ---------------------------------------------------------------------------
function parseOrThrow(params, activeChainId) {
  if (!Array.isArray(params) || params.length < 2) fail('params must be [address, typedData].')

  const [addr, input] = params
  if (typeof addr !== 'string' || !ADDRESS_RE.test(addr)) fail('The first param must be a 0x signer address.')
  try { getAddress(addr) } catch { fail('The signer address has an invalid checksum.') }
  const signWith = addr.toLowerCase()

  let raw
  if (typeof input === 'string') raw = input
  else if (isPlainObject(input)) {
    try { raw = JSON.stringify(input) } catch { fail('Typed data is not valid JSON.') }
  } else fail('The second param must be typed data (JSON string or object).')
  if (typeof raw !== 'string') fail('Typed data is not valid JSON.')
  if (raw.length > LIMITS.MAX_RAW_BYTES || new TextEncoder().encode(raw).length > LIMITS.MAX_RAW_BYTES) {
    fail('Typed data is too large.')
  }

  const unsafe = findUnsafeNumber(raw)
  if (unsafe !== null) fail('Numbers must be safe integers; pass large values as strings.')

  let doc
  try { doc = JSON.parse(raw) } catch { fail('Typed data is not valid JSON.') }
  if (!isPlainObject(doc)) fail('Typed data must be a JSON object.')
  checkJsonShape(doc)

  if (!isPlainObject(doc.types)) fail('typedData.types is required.')
  if (typeof doc.primaryType !== 'string') fail('typedData.primaryType is required.')
  if (!isPlainObject(doc.domain)) fail('typedData.domain is required.')
  if (!isPlainObject(doc.message)) fail('typedData.message is required.')

  const typeMap = readTypes(doc.types)
  const primaryType = doc.primaryType
  checkName(primaryType, 'primaryType')
  if (primaryType === 'EIP712Domain') fail('primaryType cannot be EIP712Domain.')
  if (!typeMap.has(primaryType)) fail(`Unknown primaryType "${primaryType}".`)

  const domainFields = readDomainFields(typeMap, doc.domain)
  const reachable = collectReachable(typeMap, primaryType)

  const { normalizeStruct } = makeNormalizer(typeMap)
  const domain = normalizeStruct(domainFields, doc.domain, 'domain', 1)
  const message = normalizeStruct(typeMap.get(primaryType), doc.message, 'message', 1)

  // Zincir: YALNIZ bildirilmis (imzaya giren) chainId kontrol edilir.
  let chainCheck = 'missing'
  if (domainFields.some((f) => f.name === 'chainId')) {
    const active = toActiveChainId(activeChainId)
    if (active === null) fail('The active chain id is not available.', INTERNAL_ERROR)
    const provided = BigInt(domain.chainId)
    if (provided !== active) {
      fail(`Provided chainId "${provided}" must match the active chainId "${active}".`)
    }
    chainCheck = 'match'
  }

  // Normallesmis tipler: EIP712Domain basta, sonra primaryType'tan erisilebilenler
  // (dapp'in sirasiyla). Erisilemeyen fazladan tipler atilir.
  const types = { EIP712Domain: domainFields.map((f) => ({ name: f.name, type: f.type })) }
  for (const [name, fields] of typeMap) {
    if (name !== 'EIP712Domain' && reachable.has(name)) types[name] = fields.map((f) => ({ name: f.name, type: f.type }))
  }

  return { signWith, typedData: { domain, types, primaryType, message }, chainCheck }
}

/**
 * @param {unknown} params dapp'in `params` dizisi: [adres, typedData]
 * @param {{ activeChainId?: number|string|bigint }} [opts]
 * @returns {{ ok: true, value: { signWith: string, typedData: { domain: object, types: object, primaryType: string, message: object }, chainCheck: 'match'|'missing' } } | { ok: false, error: { code: number, message: string } }}
 */
export function parseTypedDataParams(params, { activeChainId } = {}) {
  try {
    return { ok: true, value: parseOrThrow(params, activeChainId) }
  } catch (e) {
    if (e instanceof ParamError) return { ok: false, error: { code: e.code, message: e.message } }
    return { ok: false, error: { code: INVALID_PARAMS, message: 'Typed data could not be processed.' } }
  }
}
