import { ATS_CHAINS } from '../atsConfig'
import { isNativeAsset } from '../nativeAsset'
import { DELIVERY_CHAINS, deliveryChainOf } from './deliveryChains'
import { USDC_LOGO } from './deliveryTokens'
import { localTokenLogoPath } from './localTokenLogos'
import { UNKNOWN_TOKEN_LOGO, coinLogoOf, nativeCoinLogo, privateChainBadge } from './privateCoinLogo'
import { sourceAssetAddress } from './sourceAssets'

// GIZLI MODDA HER TOKENIN LOGOSU: TEK COZUCU (sahip karari 2026-11-03: "logosuz hicbir yer gormek istemiyorum, her seyin logosu tam olacak").
// Gizli modun gosterebilecegi token kumesi SONLUDUR (kaynak ciftleri, teslim tokenleri, takas/kopru hedefleri, siparis kartlari, Home tohumu);
// kume test-utils/privateTokenInventory.js'te ayni kod yollarindan turetilir ve privateTokenLogo.guard.test.js her uyesinin PAKETLI,
// gercek bir logoya cozuldugunu kilitler. Kaynak ciftleri (PrivateAssetChip / PrivateAssetPicker), teslim cipi ve teslim token secicisi
// (PrivateTransfer, PrivateDeliveryTokenPicker) ve Gizli islemler kartlari (PrivateOrders) logoyu YALNIZ buradan alir; baska yerde logo mantigi
// yazilmaz. Home'un yerel coin satiri (privateNativeRow) SDK'siz kalmak zorundadir (privatePopupImports.test.js) ve ayni coin kuralini bu
// cozucunun de kullandigi alt katmandan (privateCoinLogo.js) alir. Her sonuc client/public altinda paketli bir dosyadir: ag istegi, uzak adres YOK.
//
// SIRA (ilk bulunan kazanir):
//   1) tam (ag, adres) paketli dosya      /tokens/<ag>/<kucuk harf adres>.png  (localTokenLogos.js; xDAI = Gnosis + sifir adres)
//   2) o agin yerel coini ise COININ logosu: ETH hangi ag olursa olsun ETH elmasi (/chains/1.png), L2 logosu ASLA; ag yalniz rozette
//   3) agin USDC'si (tablo adresi) ya da BSC ATS'si  -> /usdc.png, /ats.png
//   4) sembol yedegi: ayni tokenin baska agdaki paketli logosu (DAI -> Ethereum DAI, USDT -> Ethereum USDT)
//   5) hicbiri: yedek simge (/default-token.png) -- gizli modun uretmemesi gereken, gercekten bilinmeyen token
// ADRESLI sorguda (secici, cip) sembol yedegi YALNIZ adres SDK kayit defterindeki o sembolun o agdaki adresiyse calisir: sunucu listesindeki
// kendine "USDT" / "DAI" diyen rastgele bir token gercek logoyu ODUNC ALAMAZ (taklit tokenin logosu aldatici olurdu). Adressiz sorguda
// (siparis karti yalniz sembol + ag tasir) sembol dogrudan kayit defterine ve yedege gider.
export { UNKNOWN_TOKEN_LOGO, privateChainBadge }

// SDK kayit defterindeki (ag, sembol) tokeninin paketli dosyasi.
function registryFile(chainId, symbol) {
    const address = sourceAssetAddress(chainId, symbol)
    return address ? localTokenLogoPath(chainId, address) : null
}

// Ayni sembolun baska teslim aginda paketli logosu (ayni token: kayit defterindeki o agdaki adresinin dosyasi).
function symbolFallback(symbol) {
    for (const c of DELIVERY_CHAINS) {
        const file = registryFile(c.chainId, symbol)
        if (file) return file
    }
    return null
}

const ATS_BSC = ATS_CHAINS[56]?.token ?? null
const isBscAts = (chain, address) => chain?.chainId === 56 && ATS_BSC !== null && address === ATS_BSC.address.toLowerCase()

/**
 * Paketli logo yolu ya da cozulemezse null. { chainId, address?, symbol? }: ag kimligi (sayi/dizge, tabloda yoksa okunamayan sayilir),
 * sozlesme adresi (yerel coin sifir adres, '0x0' ya da bos olabilir; adres yoksa null/undefined) ve sembol.
 */
export function packagedTokenLogo({ chainId, address, symbol } = {}) {
    const chain = deliveryChainOf(chainId)
    const sym = typeof symbol === 'string' && symbol !== '' ? symbol : null
    if (typeof address === 'string' && address.trim() !== '') {
        const addr = address.trim().toLowerCase()
        if (isNativeAsset(addr)) return nativeCoinLogo(chain?.chainId, sym)
        if (!chain) return null
        const exact = localTokenLogoPath(chain.chainId, addr)
        if (exact) return exact
        if (addr === chain.usdcAddress.toLowerCase()) return USDC_LOGO
        if (isBscAts(chain, addr)) return ATS_BSC.logoURI
        // Kimligi kayit defteriyle dogrulanan token ayni tokenin baska agdaki logosunu kullanir; dogrulanamayan ADRESLI token yedek simgeye duser.
        const registered = sym ? sourceAssetAddress(chain.chainId, sym) : null
        return registered && registered.toLowerCase() === addr ? symbolFallback(sym) : null
    }
    if (sym === null) return null
    if (sym === 'USDC') return USDC_LOGO
    if (chain && sym === chain.nativeSymbol) return nativeCoinLogo(chain?.chainId, sym)
    if (ATS_BSC !== null && sym === ATS_BSC.symbol && (!chain || chain.chainId === 56)) return ATS_BSC.logoURI
    if (chain) {
        const file = registryFile(chain.chainId, sym)
        if (file) return file
    }
    return coinLogoOf(sym) ?? symbolFallback(sym)
}

/** Gizli modun tek token logo cozucusu: paketli yol, hic cozulemezse yedek simge. Her zaman yerel yol doner, firlatmaz. */
export const privateTokenLogo = (token) => packagedTokenLogo(token) ?? UNKNOWN_TOKEN_LOGO

/**
 * Gizli modda bu tokenin GERCEK (paketli) logosu var mi? Secici ve listelerin TEK ortak testi (sahip karari 2026-11-03: gizli modda logosuz
 * satir gosterilmez): teslim token secicisi (her kip, ice aktarilan ve sunucu satirlari dahil), kaynak secicisi ve Home'un sifir bakiyeli
 * satirlari bunu kullanir; false = yedek simgeye dusecek = satir GIZLENIR. Bakiyesi olan Home satiri ve gecmis siparis karti ISTISNADIR
 * (para/gecmis gizlenmez): onlar bu testi degil gorunur kalma kuralini izler (privateHomeScope.js hideLogolessZeroRows).
 */
export const hasPrivateLogo = (token) => packagedTokenLogo(token) !== null
