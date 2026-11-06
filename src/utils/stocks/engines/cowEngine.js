// CoW (xStocks) motoru: YENIDEN YAZMAZ, delege eder (spec 7.2). Ucret/FEE_TOO_HIGH/kilit mantigi
// `utils/stockTrade.js` ve `utils/cow/*` icinde kalir; `display` (networkFeeUsd, networkFeePct,
// minAmountUsdForFee, lockReason) oldugu gibi gecer (P1/P2 notu).
import { payTokensFor } from '../../cow/config'
import {
  buildQuoteMessage as cowBuildQuoteMessage,
  primaryAction as cowPrimaryAction,
  quoteRows as cowQuoteRows,
} from '../../stockTrade'
import { ENGINE_ERROR, engineErrorKey, isEngineCode } from './errors'

const send = (message) => chrome.runtime.sendMessage(message)

export const cowEngine = Object.freeze({
  id: 'cow',
  hasApprovalStep: true,
  hasPriceImpactGate: false,
  hasReferenceLock: true,
  hasOrderLifecycle: true,
  showsCowDisclosure: true,

  payTokens: (chainId) => payTokensFor(chainId),

  // Arayuz payToken'i nesne verir; stockTrade.js adres dizesi bekler.
  buildQuoteMessage: ({ side, chainId, stockAddress, payToken, amount } = {}) =>
    cowBuildQuoteMessage({ side, chainId, stockAddress, payToken: payToken?.address ?? payToken, amount }),

  quote: (request) => send({ type: 'COW_QUOTE', message: request }),

  atsPayload: () => null,

  quoteRows: (args) => cowQuoteRows(args),

  primaryAction: (quote) => cowPrimaryAction(quote),

  async place({ quote } = {}) {
    const quoteId = quote?.quoteId
    if (typeof quoteId !== 'string' || !quoteId) return { ok: false, code: ENGINE_ERROR.QUOTE_NOT_FOUND }
    let res
    try {
      res = await send({ type: 'COW_PLACE_ORDER', message: { quoteId } })
    } catch {
      return { ok: false, code: ENGINE_ERROR.UNKNOWN }
    }
    if (res?.success && typeof res.uid === 'string') return { ok: true, id: res.uid, kind: 'order', uid: res.uid, state: typeof res.state === 'string' ? res.state : null }
    return { ok: false, code: isEngineCode(res?.code) ? res.code : ENGINE_ERROR.UNKNOWN }
  },

  errorKey: (code) => engineErrorKey(code),
})
