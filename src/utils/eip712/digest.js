// digest.js -- EIP-712 ozet hesabinin TEK yeri (SAF modul).
//
// digest = keccak256(0x1901 || domainSeparator || structHash)
//
// domainSeparator dapp'in `types.EIP712Domain`'ine SADIK hesaplanir (alan sirasi
// dapp'inkidir; ethers'in kanonik domain sirasi KULLANILMAZ). Struct ozeti
// ethers v6 TypedDataEncoder ile, YALNIZ primaryType'tan erisilebilen tiplerle
// hesaplanir (ethers `types` icinde ikinci bir kok tip gorurse "ambiguous
// primary types" ile atar). Girdi parse.js'in normallestirilmis cikisidir;
// gecersiz girdide FIRLATIR (cagiran sign.js yakalar).
import { TypedDataEncoder, concat, keccak256, getBytes } from 'ethers'

function reachableTypes(types, primaryType) {
  const out = {}
  const stack = [primaryType]
  while (stack.length) {
    const name = stack.pop()
    if (Object.prototype.hasOwnProperty.call(out, name)) continue
    const fields = types[name]
    if (!Array.isArray(fields)) throw new TypeError(`Unknown type "${name}"`)
    out[name] = fields
    for (const f of fields) {
      const base = String(f.type).replace(/(\[\d*\])+$/, '')
      if (Object.prototype.hasOwnProperty.call(types, base) && base !== 'EIP712Domain') stack.push(base)
    }
  }
  return out
}

/**
 * @param {{ domain: object, types: object, primaryType: string, message: object }} typedData
 * @returns {{ domainSeparator: string, structHash: string, digest: string }}
 */
export function hashTypedDataDigest(typedData) {
  const { domain, types, primaryType, message } = typedData
  if (primaryType === 'EIP712Domain') throw new TypeError('primaryType cannot be EIP712Domain')
  if (!Array.isArray(types.EIP712Domain)) throw new TypeError('types.EIP712Domain is required')

  const domainEncoder = new TypedDataEncoder({ EIP712Domain: types.EIP712Domain })
  const domainSeparator = domainEncoder.hashStruct('EIP712Domain', domain)

  const encoder = new TypedDataEncoder(reachableTypes(types, primaryType))
  if (encoder.primaryType !== primaryType) throw new TypeError('ambiguous primary type')
  const structHash = encoder.hashStruct(primaryType, message)

  const digest = keccak256(concat([getBytes('0x1901'), domainSeparator, structHash]))
  return { domainSeparator, structHash, digest }
}
