// ATS SATIS YOLU -- saf kapilar (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.1, §6.3).
//
// Ekran (Swap.vue) ve arka plan (background.js swapQuote/swap erken dali) AYNI soruyu AYNI
// fonksiyonla sorar: ikisi ayrisirsa ekran satis teklifi gosterirken gonderim Pancake'e
// giderdi. I/O yok; arayuz paketine girer (atsSale.js'in aksine).
import {
  ATS_SALE_ATS, ATS_SALE_CHAIN_ID, ATS_SALE_PAY_TOKENS, ATS_SALE_ZERO_ADDRESS, isAtsSaleLive,
} from './atsSaleConfig'

const norm = (a) => (typeof a === 'string' ? a.trim().toLowerCase() : '')

/**
 * Kaynak tokenin satis odeme tokeni karsiligi; degilse null.
 *
 * Cuzdanda native BNB '0x0' ile gosterilir (nativeToken.js); "Varliklarim" kaydi ise
 * ZeroAddress tasir (data/imported_tokens.json). Ikisi de BNB'dir. BOS ya da tanimsiz adres
 * BNB SAYILMAZ: adressiz bir kayit (uuid'li eski kayit) baska bir token olabilir. 0xEeee
 * yer tutucusu da sayilmaz -- motor onu native tanimiyor (nativeToken.js NATIVE_TOKEN_ADDRESS).
 */
export function salePayTokenFor(address) {
  const a = norm(address)
  if (!a) return null
  if (a === '0x0' || a === ATS_SALE_ZERO_ADDRESS) return ATS_SALE_PAY_TOKENS.find((t) => t.symbol === 'BNB')
  return ATS_SALE_PAY_TOKENS.find((t) => t.symbol !== 'BNB' && norm(t.address) === a) || null
}

const isSaleChain = (chainId) => Number(chainId) === ATS_SALE_CHAIN_ID
const isAtsOut = (address) => norm(address) === norm(ATS_SALE_ATS)

/** Cift bir satis cifti mi (bayraga BAKMAZ). Odeme tokeni kaydi ya da null. */
export function saleRequestFor({ chainId, inTokenAddress, outTokenAddress } = {}) {
  if (!isSaleChain(chainId) || !isAtsOut(outTokenAddress)) return null
  return salePayTokenFor(inTokenAddress)
}

/** Satis yolu ACIKSA istek: bayrak + adresler (isAtsSaleLive) VE satis cifti. */
export function liveSaleRequest(msg) {
  return isAtsSaleLive() ? saleRequestFor(msg) : null
}

export const isAtsSaleRoute = (msg) => liveSaleRequest(msg) !== null

/**
 * Hedef ATS (BSC) ama kaynak odeme tokeni DEGIL: genel "rota yok" yerine "USDT, USDC veya
 * BNB ile alabilirsin" gosterilir (spec §6.3). Kaynak secili degilse sessiz.
 */
export function isAtsSaleHint({ chainId, inTokenAddress, outTokenAddress } = {}) {
  if (!isAtsSaleLive() || !isSaleChain(chainId) || !isAtsOut(outTokenAddress)) return false
  return !!norm(inTokenAddress) && salePayTokenFor(inTokenAddress) === null
}
