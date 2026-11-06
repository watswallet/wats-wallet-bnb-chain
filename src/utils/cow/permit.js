// CoW permit (EIP-2612) yardimcilari: typed data, domain dogrulama, hooks.pre girdisi, onay modu karari.
// Saf modul: zincir okumasi YOK (degerler parametre gelir, Task 9 chain.js okur).
// Guvenlik degismezi 1: harcayici ve value SABITTIR, cagirici veremez.
import { Interface, MaxUint256, Signature, TypedDataEncoder, getAddress, verifyTypedData } from 'ethers'
import { GPV2_VAULT_RELAYER, permitSupported } from './config'
import { codedError } from './errors'

export const PERMIT_SELECTOR = '0xd505accf'

export const PERMIT_TYPES = Object.freeze({
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
})

// Task 9 chain.js de kullanir (nonces/name/version/DOMAIN_SEPARATOR okumalari).
export const PERMIT_ABI = [
  'function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
]

const bosDegilDize = (v) => typeof v === 'string' && v.length > 0

// BigInt | tamsayi dizesi | guvenli tamsayi -> negatif olmayan BigInt; aksi null.
function toUint(v) {
  let b = null
  if (typeof v === 'bigint') b = v
  else if (typeof v === 'number' && Number.isSafeInteger(v)) b = BigInt(v)
  else if (typeof v === 'string' && /^\d+$/.test(v)) b = BigInt(v)
  return b !== null && b >= 0n ? b : null
}

/** name/version bos olmayan dize degilse PERMIT_DOMAIN_MISMATCH (K8: standart olmayan version() permit yolunu kapatir). */
export function permitDomain({ chainId, token, name, version } = {}) {
  if (!bosDegilDize(name) || !bosDegilDize(version)) throw codedError('PERMIT_DOMAIN_MISMATCH')
  let verifyingContract
  try {
    verifyingContract = getAddress(token)
  } catch {
    throw codedError('PERMIT_DOMAIN_MISMATCH')
  }
  const id = Number(chainId)
  if (!Number.isSafeInteger(id) || id <= 0) throw codedError('PERMIT_DOMAIN_MISMATCH')
  return { name, version, chainId: id, verifyingContract }
}

/** Hesaplanan domain ayiricisi zincirdeki DOMAIN_SEPARATOR() ile (buyuk/kucuk harf duyarsiz) esit degilse PERMIT_DOMAIN_MISMATCH. */
export function verifyPermitDomain(domain, onchainSeparator) {
  if (typeof onchainSeparator !== 'string' || !/^0x[0-9a-f]{64}$/i.test(onchainSeparator)) {
    throw codedError('PERMIT_DOMAIN_MISMATCH')
  }
  const hesaplanan = TypedDataEncoder.hashDomain(domain)
  if (hesaplanan.toLowerCase() !== onchainSeparator.toLowerCase()) throw codedError('PERMIT_DOMAIN_MISMATCH')
}

/** spender ve value parametre ALMAZ (sabit). deadline = emrin validTo'su. message degerleri DIZE. */
export function permitTypedData({ domain, owner, nonce, deadline } = {}) {
  let ownerAddr
  try {
    ownerAddr = getAddress(owner)
  } catch {
    throw codedError('INVALID_REQUEST')
  }
  const n = toUint(nonce)
  const d = toUint(deadline)
  if (n === null || d === null) throw codedError('INVALID_REQUEST')
  return {
    domain,
    types: PERMIT_TYPES,
    primaryType: 'Permit',
    message: {
      owner: ownerAddr,
      spender: GPV2_VAULT_RELAYER,
      value: MaxUint256.toString(),
      nonce: n.toString(),
      deadline: d.toString(),
    },
  }
}

/** signer { signTypedData }; imza owner'a karsi dogrulanir. Anahtara dokunmaz, imzayi/anahtari loglamaz. */
export async function signPermit(signer, typedData) {
  const imza = await signer.signTypedData(typedData.domain, typedData.types, typedData.message)
  let kurtarilan
  try {
    kurtarilan = verifyTypedData(typedData.domain, typedData.types, typedData.message, imza)
  } catch {
    throw codedError('SIGNATURE_MISMATCH')
  }
  if (kurtarilan !== getAddress(typedData.message.owner)) throw codedError('SIGNATURE_MISMATCH')
  return imza
}

const PERMIT_IFACE = new Interface(PERMIT_ABI)

/** callData = permit(owner, GPV2_VAULT_RELAYER, MaxUint256, deadline, v, r, s). gasLimit'i buildAppData ekler. */
export function buildPermitHook({ token, owner, deadline, signature } = {}) {
  try {
    const target = getAddress(token)
    const ownerAddr = getAddress(owner)
    const d = toUint(deadline)
    if (d === null) throw new Error('deadline')
    const { v, r, s } = Signature.from(signature)
    const callData = PERMIT_IFACE.encodeFunctionData('permit', [ownerAddr, GPV2_VAULT_RELAYER, MaxUint256, d, v, r, s])
    return { target, callData }
  } catch {
    // ayrinti (imza dahil) hataya tasinmaz
    throw codedError('INVALID_HOOK')
  }
}

/**
 * Onay modu karari (spec 6.6): yeterli izin none; Al + permit destekli token + dogrulanmis domain permit;
 * geri kalan her durum onchain.
 * @returns {{ mode: 'none'|'permit'|'onchain' }}
 */
export function decideApproval({ side, chainId, payToken, allowance, sellAmount, permitInfoOk } = {}) {
  if (typeof allowance !== 'bigint' || typeof sellAmount !== 'bigint' || sellAmount <= 0n) {
    throw codedError('INVALID_REQUEST')
  }
  if (allowance >= sellAmount) return { mode: 'none' }
  if (side === 'buy' && permitSupported(chainId, payToken) && permitInfoOk === true) return { mode: 'permit' }
  return { mode: 'onchain' }
}
