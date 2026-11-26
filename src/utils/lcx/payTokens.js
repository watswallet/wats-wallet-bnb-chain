// LCX HISSE (RWA) ODEME TOKENLERI -- bir hisse teklifinde hissenin "diger tarafi" olabilen tokenler (Bolum 2, Gorev 5).
// Saf modul: ag, chrome ve zincir okumasi yok.
//
// NEDEN TABLO: hisse yolu ZINCIR OKUMAZ. Hissenin ondaligi katalog satirindan, odeme tokeninin ondaligi buradan gelir; ham tutar
// (parseUnits) bu ondaliklarla kurulur ve yanlis ondalik amountIn'i 10^12 kat kaydirir (USDC Ethereum'da 6, BSC'de 18). Tablo
// sunucudaki kurasyonlu liste (server/data/evmStablecoins.js: zincirden symbol() / decimals() ile dogrulanmis) ile birebir ayni
// olmak zorundadir; payTokens.test.js ayrismayi yakalar. Sira her agda USDC, USDT, native.
//
// Native adresi eklentinin '0x0' isaretcisidir (nativeAsset.js); LCX'e giderken select.js toLcxToken onu tam sifir adresine cevirir.
import { isNativeAsset } from '../nativeAsset.js'

// Native coin: sembol (supported_chains / nativeChainInfo ile ayni), 18 ondalik.
const NATIVE_SYMBOLS = { 1: 'ETH', 56: 'BNB', 10: 'ETH', 137: 'POL', 42161: 'ETH', 8453: 'ETH', 100: 'XDAI', 25: 'CRO' }

const stable = (symbol, address, decimals) => Object.freeze({ symbol, address, decimals })
const native = (chainId) => Object.freeze({ symbol: NATIVE_SYMBOLS[chainId], address: '0x0', decimals: 18, native: true })
const row = (chainId, usdc, usdt) => Object.freeze([usdc, usdt, native(chainId)])

/** chainId -> [{ symbol, address, decimals, native?: true }] ; sira USDC, USDT, native. Adresler checksum. */
export const LCX_PAY_TOKENS = Object.freeze({
    1: row(1, stable('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6), stable('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6)),
    56: row(56, stable('USDC', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18), stable('USDT', '0x55d398326f99059fF775485246999027B3197955', 18)),
    10: row(10, stable('USDC', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6), stable('USDT', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 6)),
    137: row(137, stable('USDC', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6), stable('USDT', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6)),
    42161: row(42161, stable('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6), stable('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6)),
    8453: row(8453, stable('USDC', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6), stable('USDT', '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 6)),
    // Gnosis'te USDC koprulu surumdur: zincirdeki sembol USDC.e.
    100: row(100, stable('USDC.e', '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0', 6), stable('USDT', '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', 6)),
    25: row(25, stable('USDC', '0xc21223249CA28397B4B6541dfFaEcC539BfF0c59', 6), stable('USDT', '0x66e428c3f67a68878562e79A0234c1F83c208770', 6)),
})

/**
 * Bu agda `address` bir odeme tokeni mi? Native her bicimiyle ('0x0', ZeroAddress, 0xEeee...) tanir; ERC-20 adresi buyuk / kucuk harf
 * fark etmez. Eksik adres (null, undefined, bos dize) native SAYILMAZ: isNativeAsset Send akisi icin bunlari native der, ama takasta
 * eksik bir alan sessizce native'e cevrilmez -- null doner (cagiran isteği reddeder).
 * @param {number} chainId
 * @param {string} address
 * @returns {{ symbol: string, address: string, decimals: number, native?: true } | null}
 */
export function lcxPayToken(chainId, address) {
    if (typeof address !== 'string' || address.trim() === '') return null
    // Object.hasOwn: 'constructor' / '__proto__' gibi ad-tabanli tuzaklara dusmez.
    if (typeof chainId !== 'number' || !Object.hasOwn(LCX_PAY_TOKENS, chainId)) return null
    const rows = LCX_PAY_TOKENS[chainId]
    if (isNativeAsset(address)) return rows.find((r) => r.native === true) ?? null
    const lower = address.toLowerCase()
    return rows.find((r) => r.native !== true && r.address.toLowerCase() === lower) ?? null
}
