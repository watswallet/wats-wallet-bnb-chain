// sign.js -- kayitli typed data istegini dogrulayip imzalar (SAF modul).
//
// Anahtar BURAYA girmez: imzaci disaridan `signer.signDigest(hex)` verir
// (atsPaymaster.makeEthersSigner ile ayni sozlesme: HAM digest imzasi, EIP-191
// sarmasi YOK). Popup'tan gelen yuk imzalanmaz: imzalanan ozet, arka planin
// KENDI kaydindan yeniden hesaplanir ve popup'in gonderdigi `expectedDigest`
// ile karsilastirilir. Hicbir sey firlatmaz.
import { hashTypedDataDigest } from './digest.js'

const INTERNAL_ERROR = -32603
const DIGEST_RE = /^0x[0-9a-fA-F]{64}$/
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/

const failure = (message) => ({ ok: false, error: { code: INTERNAL_ERROR, message } })

/**
 * @param {{ request: { typedData: object, digest?: string }, expectedDigest: string, signer: { signDigest: (hex: string) => string | Promise<string> } }} args
 * @returns {Promise<{ ok: true, signature: string } | { ok: false, error: { code: number, message: string } }>}
 */
export async function signStoredTypedData({ request, expectedDigest, signer } = {}) {
  if (!request || typeof request !== 'object' || !request.typedData || typeof request.typedData !== 'object') {
    return failure('Invalid typed data request.')
  }
  if (typeof expectedDigest !== 'string' || !DIGEST_RE.test(expectedDigest)) {
    return failure('Invalid expected digest.')
  }
  if (!signer || typeof signer.signDigest !== 'function') return failure('Signer is not available.')

  let digest
  try {
    digest = hashTypedDataDigest(request.typedData).digest
  } catch {
    return failure('Stored typed data could not be hashed.')
  }
  if (request.digest !== undefined && String(request.digest).toLowerCase() !== digest) {
    return failure('Stored typed data digest does not match.')
  }
  if (expectedDigest.toLowerCase() !== digest) {
    return failure('Typed data digest does not match the displayed request.')
  }

  let signature
  try {
    signature = await signer.signDigest(digest)
  } catch {
    return failure('Signing failed.')
  }
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) return failure('Signing failed.')
  return { ok: true, signature }
}
