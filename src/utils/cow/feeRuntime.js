// CoW ATS ucreti VI: ucret / iade akisinin arka plan baglantisi (plan Task 10, spec 6.7).
// Burada IS MANTIGI YOK: gercek modulleri (zincir okuma, makbuz, cozumleme, HTTP) settler ve claimer'a baglar.
// Anahtar BURADAN GECMEZ: settler imzaciyi getSigner ile ister ve `signer` nesnesini oldugu gibi
// atsFns.executeAtsTransfer'a iletir; ham anahtari acan kapanis background.js'tedir.
// Ucret her zaman BSC'de (56) tahsil edilir (atsConfig.getAtsSourceConfig).
import { JsonRpcProvider } from 'ethers'
import { createFeeSettler } from './feeSettle'
import { createRefundClaimer } from './refundClaim'
import { feeView, feeDebtLock, buildFeeCall } from './fee'
import { readAccountNonce, readBlockNumber, readTokenBalance, readFeeReceipt } from './feeChain'
import { resolveFeeOp } from './feeResolve'
import { FEE_BSC_CHAIN_ID, FEE_OP_KIND } from './config'
import { getAtsConfig } from '../atsConfig'
import { GaslessClient } from '../sdk/gasless'

export const FEE_STATUS_MAX = 50
// Teklif asamasinda emir uid'i yok: teklif yalniz ucret tutarini olcer (cagri sekli sabit: execute(owner,0,uid)).
const PREVIEW_UID = '0x' + '00'.repeat(56)

const lc = (v) => String(v ?? '').toLowerCase()

/**
 * @param {object} p
 * @param {object} p.orders   cow/orders.js arayuzu (loadOrders, patchOrder)
 * @param {object} p.atsFns   { quoteAtsTransfer, executeAtsTransfer, readAtsStatus }
 * @param {(chainId:number)=>string} p.rpcFor
 * @param {Function} p.fetchImpl
 * @param {string} p.baseUrl  Wats API tabani (iade talebi)
 * @param {boolean} p.flag    XSTOCKS_ATS_FEE_ENABLED
 */
export function createFeeRuntime({ orders, atsFns, rpcFor, fetchImpl, baseUrl, flag, now = Date.now, log = () => {} }) {
  // BSC yapilandirmasi ve saglayici TEMBEL: kurulum hicbir sey okumaz / ag acmaz.
  let cached = null
  const bsc = () => {
    if (cached) return cached
    const cfg = getAtsConfig(FEE_BSC_CHAIN_ID)
    if (!cfg) throw new Error('ATS not enabled for chain')
    const rpcUrl = rpcFor(FEE_BSC_CHAIN_ID)
    cached = { cfg, rpcUrl, provider: new JsonRpcProvider(rpcUrl) }
    return cached
  }

  const chain = {
    readAtsBalance: ({ owner }) => {
      const { cfg, provider } = bsc()
      return readTokenBalance({ provider, token: cfg.token.address, owner })
    },
    readNonce: ({ owner }) => {
      const { cfg, provider } = bsc()
      return readAccountNonce({ provider, entryPoint: cfg.entryPoint, owner })
    },
    readBlockNumber: () => readBlockNumber(bsc().provider),
  }

  const ats = {
    status: ({ owner }) => {
      const { cfg } = bsc()
      const client = new GaslessClient({ baseUrl: cfg.backendBase, chainId: FEE_BSC_CHAIN_ID })
      return atsFns.readAtsStatus({ client, address: owner, chainId: FEE_BSC_CHAIN_ID, force: true })
    },
    quote: async ({ owner, call }) => {
      const { rpcUrl } = bsc()
      const q = await atsFns.quoteAtsTransfer({
        chainId: FEE_BSC_CHAIN_ID, rpcUrl, address: owner, call, opKind: FEE_OP_KIND,
      })
      return { feeRaw: q.feeRaw, commissionRaw: q.commissionAts, quoted: q }
    },
    execute: ({ call, quoted, fixedNonce, signer }) => {
      const { rpcUrl } = bsc()
      return atsFns.executeAtsTransfer({
        chainId: FEE_BSC_CHAIN_ID, rpcUrl, call, quoted, opKind: FEE_OP_KIND, fixedNonce, signer,
      })
    },
  }

  const receipt = ({ txHash, owner, uid, nonce }) => {
    const { cfg, provider } = bsc()
    return readFeeReceipt({
      provider, entryPoint: cfg.entryPoint, paymasters: [cfg.paymaster], txHash, owner, uid, nonce,
    })
  }

  const resolve = ({ owner, uid, op }) => {
    const { cfg, provider } = bsc()
    return resolveFeeOp({ provider, entryPoint: cfg.entryPoint, paymasters: [cfg.paymaster], owner, uid, op })
  }

  const settler = createFeeSettler({ orders, chain, ats, receipt, resolve, now, log })
  const claimer = createRefundClaimer({ orders, fetchImpl, baseUrl, now, log })

  /**
   * service.js'in fee.prepare bagimliligi (spec 6.1): SALT OKUR; kasa, anahtar, op gonderimi YOK.
   * Ucret her zaman BSC'de tahsil edilir, bu yuzden emrin zinciri ne olursa olsun BSC okunur (chainId yok sayilir).
   * Durum ya da teklif okunamazsa FIRLATIR (service 'none' sayar); bakiye okunamazsa balanceRaw null.
   * Komisyonlu teklifte quotedFeeRaw null: settler COMMISSION ile engellerdi, kullaniciya ucret gosterilmez.
   */
  async function prepare({ owner }) {
    const { cfg } = bsc()
    const [status, q, balance] = await Promise.all([
      ats.status({ owner }),
      ats.quote({ owner, call: buildFeeCall(owner, PREVIEW_UID) }),
      chain.readAtsBalance({ owner }).catch(() => null),
    ])
    const commission = q && q.commissionRaw != null ? String(q.commissionRaw) : '0'
    const fee = q && q.feeRaw != null ? String(q.feeRaw) : null
    return {
      isEvm: true,
      status,
      balanceRaw: typeof balance === 'bigint' ? balance.toString() : null,
      quotedFeeRaw: commission === '0' ? fee : null,
      decimals: cfg.token.decimals,
    }
  }

  /** Ekran icin: owner'in ucret/iade gorunumleri (en yeni 50) ve borc bayragi. Anahtar ve ag gerekmez. */
  async function statusFor(owner) {
    const list = await orders.loadOrders()
    const all = Array.isArray(list) ? list : []
    const o = lc(owner)
    const fees = all
      .filter((r) => r && lc(r.owner) === o)
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .map(feeView)
      .filter((v) => v !== null)
      .slice(0, FEE_STATUS_MAX)
    const debt = feeDebtLock({ list: all, owner, flagOn: flag === true, now: now() }) !== null
    return { fees, debt }
  }

  return { settler, claimer, statusFor, prepare }
}
