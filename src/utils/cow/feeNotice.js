// ATS islem ucreti: FeeView (fee.js feeView) -> ekran bildirimi eslemesi (spec 4.2).
// Saf: yalniz i18n ANAHTARI ve parametre doner; metin karari ekranlarda verilmez.
import { FEE_STATE, FEE_BLOCKER } from './fee'

const NS = 'stockTrade.atsFee.'
// Ham sunucu kodu ekrana yalniz bu bicimde girer (refundClaim dogrulamasi ile ayni kural).
const CODE_RE = /^[A-Z_]{3,32}$/

const notice = (name, params, tone, actions) => ({ key: NS + name, params, tone, actions })

/**
 * view = fee.js feeView(rec) sonucu. null => gosterilecek bir sey yok.
 * @returns {null | {key: string, params: object, tone: 'info'|'warn'|'error'|'ok', actions: string[]}}
 */
export function feeNoticeOf(view, { walletLocked = false, format = (raw) => raw } = {}) {
  if (!view || typeof view !== 'object') return null
  const fmt = (raw) => format(raw ?? '')
  const refund = view.refund && typeof view.refund === 'object' ? view.refund : { state: 'none' }

  switch (view.state) {
    case FEE_STATE.OWED:
      return walletLocked
        ? notice('state.owedLocked', { amount: fmt(view.quotedAtsRaw) }, 'info', [])
        : notice('state.paying', {}, 'info', ['payNow'])
    case FEE_STATE.SENDING:
      return notice('state.paying', {}, 'info', [])
    case FEE_STATE.BLOCKED:
      switch (view.blocker) {
        case FEE_BLOCKER.BALANCE:
          return notice('state.balance', { amount: fmt(view.freshFeeRaw ?? view.quotedAtsRaw) }, 'warn', ['buyAts', 'retry'])
        case FEE_BLOCKER.APPROVAL:
          return notice('state.approval', {}, 'warn', ['prepare'])
        case FEE_BLOCKER.FEE_CHANGED:
          return notice(
            'state.feeChanged',
            { from: fmt(view.quotedAtsRaw), to: fmt(view.freshFeeRaw) },
            'warn',
            ['approve', 'decline'],
          )
        case FEE_BLOCKER.FEE_STUCK:
          return notice('state.stuck', {}, 'error', [])
        default: // COMMISSION, NO_SERVICE ve bilinmeyen: guvenli taraf "su an alinamiyor"
          return notice('state.unavailable', {}, 'info', [])
      }
    case FEE_STATE.PAID:
      switch (refund.state) {
        case 'claimable':
        case 'claiming':
        case 'approved':
          return notice('state.paidPending', {}, 'info', [])
        case 'sent':
          return notice('state.refundSent', { amount: fmt(refund.atsRaw) }, 'ok', [])
        case 'rejected': {
          const code = typeof refund.code === 'string' && CODE_RE.test(refund.code) ? refund.code : 'UNKNOWN'
          return notice('state.refundRejected', { code }, 'error', [])
        }
        default:
          return null
      }
    default: // idle, void, null
      return null
  }
}
