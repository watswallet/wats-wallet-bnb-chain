// CoW ATS ucreti III: cift ucret korumasinin 3. katmani. Bir ucret kaydi `sending` durumunda kalmis
// ve sonuc belirsizse (MV3 calisani op gonderildikten sonra olmus olabilir) karari ZINCIR verir.
// Karar tablosu: yeni nonce yalniz "bu uid in op u inmedi KANITLI" ise (NOT_BOUND_PROVEN); kanit
// yoksa HICBIR SEY gonderilmez (UNKNOWN). Saf okuma: kaydi bu modul DEGISTIRMEZ; cagiran uygular.
import { zeroPadValue } from 'ethers'
import { USER_OP_EVENT_TOPIC, findUserOpEvents, readAccountNonce, readBlockNumber, readFeeReceipt } from './feeChain'

export const RESOLVE = Object.freeze({
  NOT_LANDED: 'NOT_LANDED',
  PAID: 'PAID',
  NOT_BOUND_PROVEN: 'NOT_BOUND_PROVEN',
  UNKNOWN: 'UNKNOWN',
})
export const FEE_LOG_CHUNK_BLOCKS = 2000

const unknown = (reason) => ({ result: RESOLVE.UNKNOWN, reason })

/**
 * op = fee.op ({nonce,startBlock,...}). Donus:
 *  { result:'NOT_LANDED' }                 -- getNonce === op.nonce: AYNI nonce ile yeniden gonder
 *  { result:'PAID', paidTxHash, atsChargedRaw }
 *  { result:'NOT_BOUND_PROVEN', txHash }   -- nonce baska bir op a gitti, calldata uid e bagli DEGIL
 *  { result:'UNKNOWN', reason }            -- HICBIR SEY GONDERME
 */
export async function resolveFeeOp({ provider, entryPoint, paymasters, owner, uid, op, chunk = FEE_LOG_CHUNK_BLOCKS }) {
  let opNonce
  try {
    opNonce = BigInt(op.nonce)
  } catch {
    return unknown('EVENT_NOT_FOUND')
  }

  let n
  try {
    n = await readAccountNonce({ provider, entryPoint, owner })
  } catch {
    return unknown('RPC')
  }
  if (n === opNonce) return { result: RESOLVE.NOT_LANDED }
  // Zincir geriye gitmez: nonce kayittakinden kucukse saglayici bayat; gonderme.
  if (n < opNonce) return unknown('RPC')

  // Tarama basi uydurulmaz.
  const start = op.startBlock
  if (!Number.isSafeInteger(start) || start < 0) return unknown('EVENT_NOT_FOUND')

  let latest
  try {
    latest = await readBlockNumber(provider)
  } catch {
    return unknown('RPC')
  }

  const ownerTopic = zeroPadValue(owner, 32).toLowerCase()
  const found = []
  for (let from = start; from <= latest; from += chunk) {
    const to = Math.min(from + chunk - 1, latest)
    let logs
    try {
      logs = await provider.getLogs({
        address: entryPoint,
        topics: [USER_OP_EVENT_TOPIC, null, ownerTopic],
        fromBlock: from,
        toBlock: to,
      })
    } catch {
      // Kismi tarama "bulunamadi" sayilmaz.
      return unknown('RPC')
    }
    for (const ev of findUserOpEvents(logs, { entryPoint, owner })) {
      if (ev.nonce === opNonce) found.push(ev)
    }
  }

  // Olay yok (RPC gecikmesi/kirpilmis kayit olabilir) ya da ayni nonce icin birden cok islem: yeni op YOK.
  if (found.length === 0) return unknown('EVENT_NOT_FOUND')
  const hashes = new Set(found.map((e) => e.txHash))
  if (hashes.size !== 1) return unknown('EVENT_NOT_FOUND')
  const txHash = found[0].txHash
  if (!txHash) return unknown('NOT_FOUND')

  let r
  try {
    r = await readFeeReceipt({ provider, entryPoint, paymasters, txHash, owner, uid, nonce: opNonce })
  } catch {
    return unknown('RPC')
  }
  if (r.status === 'PAID') return { result: RESOLVE.PAID, paidTxHash: r.paidTxHash, atsChargedRaw: r.atsChargedRaw }
  if (r.status === 'NOT_BOUND') return { result: RESOLVE.NOT_BOUND_PROVEN, txHash }
  return unknown(r.status)
}
