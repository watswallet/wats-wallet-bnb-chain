// view.js -- typed data onay ekrani icin DUZ satir listesi (SAF modul).
//
// Girdi parse.js'in NORMALLESMIS typedData'sidir: gorunum kodlayicinin tukettigi
// degeri cizer, ham JSON belirtecini ASLA. Ozyineleme ekranda DEGIL burada
// duzlestirilir. GIZLEME YOK: satir sayisi tavani asilirsa `overLimit` true olur
// (cagiran istegi -32602 ile reddeder); tavan altinda bile kisaltma varsa
// `truncated` true olur ve ekran "tumunu goster" acilana kadar Imzala'yi
// devre disi birakir. Hicbir metin HTML olarak yorumlanmaz (cagiran v-html
// KULLANMAZ); dapp metinleri gorunurKil'dan gecer.
import { getAddress } from 'ethers'
import { gorunurKil } from '../solana/visibleText.js'

export const DEFAULT_VIEW_LIMITS = Object.freeze({
  maxRows: 500, // sert tavan; asilirsa overLimit
  previewRows: 100, // bundan sonrasi varsayilan olarak daraltilir (hiddenByDefault)
  maxStringChars: 200, // uzun dize/bytes kisaltma esigi (kod noktasi)
})

const MAX_DEPTH = 40 // parse.js zaten 32 ile sinirlar; burasi sonsuz donguye karsi sigorta
const MAX_UNSIGNED_PATHS = 20
const PRIMITIVE = /^(?:bool|address|string|bytes\d*|u?int\d*)$/
const NEWLINES = /[\r\n]+/g
const NEWLINE_MARK = ' \u23ce ' // satir sonu isareti (satir sayisi sinirlanir)

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

function splitType(typeStr) {
  const m = /^(.*?)((?:\[\d*\])*)$/.exec(String(typeStr))
  const dims = m[2] ? m[2].match(/\[\d*\]/g) : []
  return { base: m[1], dims }
}

function clip(text, max) {
  const chars = Array.from(text)
  if (chars.length <= max) return { shown: text, clipped: false }
  return { shown: chars.slice(0, max).join('') + '\u2026', clipped: true }
}

// Yaprak degerin gosterim metni. Adres TAM ve EIP-55; tamsayi BigInt (Number YOK).
function formatLeaf(base, value, limits) {
  let text
  if (base === 'address') {
    try { text = getAddress(String(value)) } catch { text = String(value) }
  } else if (/^u?int\d*$/.test(base)) {
    try { text = BigInt(value).toString() } catch { text = String(value) }
  } else if (base === 'bool') {
    text = String(value)
  } else if (base === 'string') {
    text = gorunurKil(String(value).replace(NEWLINES, NEWLINE_MARK))
  } else {
    text = gorunurKil(String(value))
  }
  const hiddenChars = base === 'string' && text !== String(value).replace(NEWLINES, NEWLINE_MARK)
  // Adres kisaltilmaz; geri kalani esigi asarsa kisaltilir.
  if (base === 'address') return { display: text, full: text, truncated: false, hiddenChars }
  const { shown, clipped } = clip(text, limits.maxStringChars)
  return { display: shown, full: text, truncated: clipped, hiddenChars }
}

/**
 * @param {{ domain: object, types: object, primaryType: string, message: object }} typedData
 * @param {{ maxRows?: number, previewRows?: number, maxStringChars?: number }} [limits]
 * @returns {{
 *   rows: Array<{ section: 'domain'|'message', path: string, label: string, depth: number, type: string,
 *                 kind: 'group'|'value', display: string, full: string, truncated: boolean,
 *                 hiddenChars: boolean, hiddenByDefault: boolean }>,
 *   warnings: Array<{ code: 'unsigned_fields'|'hidden_chars'|'chain_missing', paths?: string[], count?: number }>,
 *   truncated: boolean,
 *   overLimit: boolean }}
 */
export function buildTypedDataView(typedData, limits = {}) {
  const lim = { ...DEFAULT_VIEW_LIMITS, ...limits }
  const rows = []
  const unsigned = []
  let unsignedCount = 0
  let overLimit = false

  const push = (row) => {
    if (overLimit) return false
    if (rows.length >= lim.maxRows) { overLimit = true; return false }
    rows.push(row)
    return true
  }

  const note = (path, value, fields) => {
    const known = new Set(fields.map((f) => f.name))
    for (const key of Object.keys(value)) {
      if (known.has(key)) continue
      unsignedCount++
      if (unsigned.length < MAX_UNSIGNED_PATHS) unsigned.push(`${path}.${key}`)
    }
  }

  const invalid = (section, path, label, depth, type) => push({
    section, path, label: gorunurKil(label), depth, type, kind: 'value',
    display: '[invalid]', full: '[invalid]', truncated: false, hiddenChars: false, hiddenByDefault: false,
  })

  const walkField = (section, path, label, typeStr, value, depth, types) => {
    if (overLimit) return
    if (depth > MAX_DEPTH) { overLimit = true; return }
    const { base, dims } = splitType(typeStr)
    if (dims.length > 0) {
      if (!Array.isArray(value)) { invalid(section, path, label, depth, typeStr); return }
      const innerType = base + dims.slice(0, -1).join('')
      const display = `[${value.length}]`
      if (!push({
        section, path, label: gorunurKil(label), depth, type: typeStr, kind: 'group',
        display, full: display, truncated: false, hiddenChars: false, hiddenByDefault: false,
      })) return
      value.forEach((item, i) => walkField(section, `${path}[${i}]`, `[${i}]`, innerType, item, depth + 1, types))
      return
    }
    if (hasOwn(types, base)) {
      if (!isObj(value)) { invalid(section, path, label, depth, typeStr); return }
      if (!push({
        section, path, label: gorunurKil(label), depth, type: typeStr, kind: 'group',
        display: base, full: base, truncated: false, hiddenChars: false, hiddenByDefault: false,
      })) return
      walkStruct(section, path, types[base], value, depth + 1, types)
      return
    }
    if (!PRIMITIVE.test(base)) { invalid(section, path, label, depth, typeStr); return }
    const leaf = formatLeaf(base, value, lim)
    push({
      section, path, label: gorunurKil(label), depth, type: typeStr, kind: 'value', ...leaf, hiddenByDefault: false,
    })
  }

  const walkStruct = (section, path, fields, value, depth, types) => {
    if (!Array.isArray(fields) || !isObj(value)) return
    note(path, value, fields)
    for (const f of fields) {
      if (overLimit) return
      walkField(section, `${path}.${f.name}`, f.name, f.type, value[f.name], depth, types)
    }
  }

  const types = isObj(typedData && typedData.types) ? typedData.types : {}
  const domainFields = Array.isArray(types.EIP712Domain) ? types.EIP712Domain : []
  // Alan tipleri ilkel oldugundan domain icin yapi tablosu gerekmez.
  walkStruct('domain', 'domain', domainFields, isObj(typedData && typedData.domain) ? typedData.domain : {}, 0, {})
  walkStruct('message', 'message', types[typedData && typedData.primaryType], typedData && typedData.message, 0, types)

  rows.forEach((row, i) => { row.hiddenByDefault = i >= lim.previewRows })
  const truncated = overLimit || rows.length > lim.previewRows || rows.some((r) => r.truncated)

  const warnings = []
  if (unsignedCount > 0) warnings.push({ code: 'unsigned_fields', paths: unsigned, count: unsignedCount })
  if (rows.some((r) => r.hiddenChars)) warnings.push({ code: 'hidden_chars' })
  if (!domainFields.some((f) => f && f.name === 'chainId')) warnings.push({ code: 'chain_missing' })

  return { rows, warnings, truncated, overLimit }
}
