// COW_QUOTE istek dogrulamasi (spec 5.5 "Dogrulamalar"). Saf modul; ag/depo yok.
// Arayuzden yalniz {side, chainId, stockAddress, payToken, amount} okunur; owner arka plandaki aktif hesaptir.
import { getAddress } from 'ethers'
import { stockEntry } from '../tokenizedStocks'
import { COW_CHAIN_IDS, payTokenByAddress } from './config'
import { COW_ERROR } from './errors'

const INVALID = Object.freeze({ ok: false, code: COW_ERROR.INVALID_REQUEST })
const fail = (code) => ({ ok: false, code })

const QUOTE_ID = /^[0-9a-f]{32}$/
// Kullanici biriminde ondalik metin; bilimsel gosterim, bosluk, isaret yok. Olcek Task 13'te parseUnits ile sinanir.
const AMOUNT = /^(0|[1-9]\d{0,29})(\.\d{1,36})?$/

export function validateQuoteId(value) {
  if (typeof value === 'string' && QUOTE_ID.test(value)) return { ok: true, value }
  return INVALID
}

// EIP-55 olmayan karisik harf ve bozuk adres firlatir; tumu null'a duser.
function safeAddress(value) {
  if (typeof value !== 'string') return null
  try {
    return getAddress(value)
  } catch {
    return null
  }
}

/**
 * @param {{ side: string, chainId: number, stockAddress: string, payToken: string, amount: string }} req
 * @param {{ owner: string }} ctx
 */
export function validateQuoteRequest(req, { owner } = {}) {
  if (!req || typeof req !== 'object') return INVALID
  const { side, chainId, stockAddress, payToken, amount } = req

  if (side !== 'buy' && side !== 'sell') return INVALID
  if (!Number.isInteger(chainId) || !COW_CHAIN_IDS.includes(chainId)) return fail(COW_ERROR.UNSUPPORTED_CHAIN)

  const ownerAddr = safeAddress(owner)
  const stockAddr = safeAddress(stockAddress)
  const payAddr = safeAddress(payToken)
  if (!ownerAddr || !stockAddr || !payAddr) return INVALID

  const stock = stockEntry(chainId, stockAddr)
  if (!stock || stock.issuer !== 'xstocks') return fail(COW_ERROR.UNSUPPORTED_TOKEN)
  const pay = payTokenByAddress(chainId, payAddr)
  if (!pay) return fail(COW_ERROR.UNSUPPORTED_TOKEN)

  if (typeof amount !== 'string' || !AMOUNT.test(amount) || !/[1-9]/.test(amount)) return INVALID

  return { ok: true, value: { side, chainId, owner: ownerAddr, stock, pay, amountText: amount } }
}
