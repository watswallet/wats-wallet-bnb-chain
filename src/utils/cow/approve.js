// Zincir ustu approve (spec 6.6, 8.5, K3, K6): cagrilar quoteId kaydindan kurulur; harcayici ve tutar SABIT (degismez 1).
// ATS teklif/yurutme akisi bagimlilik olarak enjekte edilir (Task 17 kapanislari baglar); modul durumu yok.
// Anahtar yalniz getSigner() ile gelir; bu modul ozel anahtara dokunmaz, log'a yazmaz.
import { Interface, MaxUint256, getAddress } from 'ethers'
import { GPV2_VAULT_RELAYER } from './config'
import { COW_ERROR, codedError, isCowCode } from './errors'

export const APPROVE_ABI = ['function approve(address spender,uint256 value) returns (bool)']

/** Eski USDT tipi: allowance sifirdan farkliyken dogrudan yeni deger yazilamaz. Yalniz Ethereum USDT (config PAY_TOKENS ile ayni adres, kucuk harf). */
export const APPROVE_RESET_TOKENS = Object.freeze({ 1: Object.freeze(['0xdac17f958d2ee523a2206206994597c13d831ec7']) })

const iface = new Interface(APPROVE_ABI)
const DIGITS = /^\d+$/

const fail = (code, atsCode) => (atsCode === undefined ? { success: false, code } : { success: false, code, atsCode })

// Kodlu hata kodu aynen; baska her sey UNKNOWN (ic hata metni sizmaz).
const codeOf = (e) => (e && isCowCode(e.code) ? e.code : COW_ERROR.UNKNOWN)

// ATS hata kodu yalniz kisa ASCII dize olarak tasinir; ham mesaj sizmaz.
const atsCodeOf = (e) => (typeof e?.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(e.code) ? e.code : undefined)

const sameAddr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

export function needsApproveReset(chainId, token, allowance) {
  if (typeof allowance !== 'bigint' || allowance <= 0n) return false
  if (typeof token !== 'string') return false
  const liste = APPROVE_RESET_TOKENS[Number(chainId)]
  return Array.isArray(liste) && liste.includes(token.toLowerCase())
}

/** [{ to: token, value: 0n, data }] ya da [{ reset }, { max }]. spender/value PARAMETRE DEGIL. */
export function buildApproveCalls({ chainId, token, allowance } = {}) {
  let to
  try {
    to = getAddress(token)
  } catch {
    throw codedError(COW_ERROR.INVALID_REQUEST)
  }
  if (typeof allowance !== 'bigint' || allowance < 0n) throw codedError(COW_ERROR.INVALID_REQUEST)
  const call = (amount) => ({
    to,
    value: 0n,
    data: iface.encodeFunctionData('approve', [GPV2_VAULT_RELAYER, amount]),
  })
  return needsApproveReset(chainId, to, allowance) ? [call(0n), call(MaxUint256)] : [call(MaxUint256)]
}

export function createCowApprove({ chain, quoteStore, atsQuote, atsExecute, now = Date.now }) {
  // Ortak on adim (davranis 1-3): kayit + taze allowance. Tuketmez.
  async function prepare({ quoteId, activeAddress }) {
    const peek = await quoteStore.peekQuoteForApprove({ quoteId, activeAddress, now: now() })
    if (!peek || peek.ok !== true) return { error: fail(isCowCode(peek?.code) ? peek.code : COW_ERROR.UNKNOWN) }
    const { chainId, owner, sellToken, sellAmount } = peek.record
    if (typeof sellAmount !== 'string' || !DIGITS.test(sellAmount)) return { error: fail(COW_ERROR.INVALID_REQUEST) }
    const need = BigInt(sellAmount)
    const allowance = await chain.readAllowance(chainId, sellToken, owner)
    return { record: peek.record, chainId, owner, token: sellToken, need, allowance }
  }

  async function quote({ quoteId, activeAddress } = {}) {
    let atsFailure
    try {
      const p = await prepare({ quoteId, activeAddress })
      if (p.error) return p.error
      // baska yoldan onay verilmisse gereksiz onay istenmez
      if (p.allowance >= p.need) return fail(COW_ERROR.INVALID_REQUEST)
      const calls = buildApproveCalls({ chainId: p.chainId, token: p.token, allowance: p.allowance })
      try {
        const atsQuoted = await atsQuote({ chainId: p.chainId, address: p.owner, calls })
        return {
          success: true,
          quote: atsQuoted,
          resetFirst: calls.length === 2,
          approveUntil: p.record.approveUntil,
          token: p.token,
          chainId: p.chainId,
        }
      } catch (e) {
        atsFailure = atsCodeOf(e)
      }
      return fail(COW_ERROR.UNKNOWN, atsFailure)
    } catch (e) {
      return fail(codeOf(e))
    }
  }

  async function execute({ quoteId, activeAddress, quoted, getSigner } = {}) {
    try {
      const p = await prepare({ quoteId, activeAddress })
      if (p.error) return p.error
      if (p.allowance >= p.need) {
        return { success: true, skipped: true, allowance: p.allowance.toString(), confirmed: true, txHash: null }
      }
      const calls = buildApproveCalls({ chainId: p.chainId, token: p.token, allowance: p.allowance })
      // anahtar en gec anda; hesap kayittakiyle ayni olmali
      const signer = await getSigner()
      if (!sameAddr(signer?.address, p.owner)) return fail(COW_ERROR.ACCOUNT_CHANGED)
      let sent
      try {
        sent = await atsExecute({ chainId: p.chainId, address: p.owner, calls, quoted, signer })
      } catch (e) {
        return fail(COW_ERROR.UNKNOWN, atsCodeOf(e))
      }
      // makbuz tek basina basari sayilmaz: allowance'in KENDISI sinanir
      const after = await chain.readAllowance(p.chainId, p.token, p.owner)
      if (after < p.need) return fail(COW_ERROR.APPROVAL_REQUIRED)
      const txHash = typeof sent?.txHash === 'string' ? sent.txHash : null
      return { success: true, txHash, allowance: after.toString(), confirmed: true }
    } catch (e) {
      return fail(codeOf(e))
    }
  }

  return { quote, execute }
}
