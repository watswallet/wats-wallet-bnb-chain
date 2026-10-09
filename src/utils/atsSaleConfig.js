// ATS SATISI -- ayar ve bayrak (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.1).
//
// FAIL-CLOSED: satis yolu YALNIZ bayrak acik VE iki adres de gecerli (bos olmayan, sifir
// olmayan, birbirinden farkli) EVM adresiyse acilir. Adresler bos kaldikca bayrak `true`
// yapilsa bile yol KAPALIDIR ve ekran bugunku gibi davranir: "ATS Al" MEXC'yi acar, blokaj
// kartlarinda dugme yok, USDT -> ATS Pancake'e sorulur.
//
// ADRESLER ZINCIRDE DOGRULANMADAN YAZILMAZ (spec §6.1, §9): kod var, owner() == Safe
// (0xb42f...8e6d), sponsorun entryPoint() == v0.8. /sale/quote'un dondurdugu desk/sponsor BU
// sabitlerle karsilastirilir (utils/atsSale.js assertSaleQuote): adresi sunucudan almak,
// atsConfig.js'in basinda anlatilan kendi kendini dogrulayan tautolojiyi kurmak olurdu.
//
// SPONSOR ATS_CHAINS[56]'YA EKLENMEZ: o kayit HER isleme uygulanir. Sponsor yalniz satis
// islemine, cagri basina izin listesiyle verilir (utils/atsSale.js assertSaleSponsorResult).
//
// Satis yolu YALNIZ bu dosyanin sabitlerine dayanir: odeme tokenleri baska bir listeye
// (data/contract_addresses.json, swapChains.js) BAGLI DEGILDIR.

export const ATS_SALE_ENABLED = false
export const ATS_SALE_DESK = ''
export const ATS_SALE_SPONSOR = ''

export const ATS_SALE_CHAIN_ID = 56
// BSC ATS -- atsConfig.js ATS_CHAINS[56].token ile ayni (test kilitler).
export const ATS_SALE_ATS = '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d'
// Desk'in BNB kimligi (Quote.payToken). Cuzdan native BNB'yi '0x0' ile gosterir.
export const ATS_SALE_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Oncelik sirasi = dizi sirasi (spec §6.4: USDT > USDC > BNB). `address` cuzdanin token
// kaydindaki adres, `quoteAddress` teklifin/desk'in kimligi. Ucu de 18 ondalik (spec §2.1).
export const ATS_SALE_PAY_TOKENS = Object.freeze([
  Object.freeze({
    symbol: 'USDT', decimals: 18,
    address: '0x55d398326f99059fF775485246999027B3197955',
    quoteAddress: '0x55d398326f99059fF775485246999027B3197955',
  }),
  Object.freeze({
    symbol: 'USDC', decimals: 18,
    address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    quoteAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  }),
  Object.freeze({ symbol: 'BNB', decimals: 18, address: '0x0', quoteAddress: ATS_SALE_ZERO_ADDRESS }),
])

// Teklif 30 sn gecerli (sunucu PM_SALE_QUOTE_TTL_SEC); kalan < 10 sn ise yurutme yeni teklif
// alir (requote); ekran teklifi 20 sn'de bir tazeler (spec §6.2, §6.3).
export const ATS_SALE_QUOTE_TTL_SEC = 30
export const ATS_SALE_REQUOTE_BELOW_SEC = 10
export const ATS_SALE_REFRESH_MS = 20_000
// Ekrandaki "%1 komisyon dahil" yedegi; asil deger teklifin display.commissionPct alani.
export const ATS_SALE_COMMISSION_PCT = 1

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const usable = (a) => typeof a === 'string' && EVM_ADDRESS.test(a) && a.toLowerCase() !== ATS_SALE_ZERO_ADDRESS

/** Saf cekirdek: verilen ayardan satis yolunun acik olup olmadigi. */
export function atsSaleLiveFrom({ enabled, desk, sponsor } = {}) {
  return enabled === true && usable(desk) && usable(sponsor) && desk.toLowerCase() !== sponsor.toLowerCase()
}

export const isAtsSaleLive = () =>
  atsSaleLiveFrom({ enabled: ATS_SALE_ENABLED, desk: ATS_SALE_DESK, sponsor: ATS_SALE_SPONSOR })
