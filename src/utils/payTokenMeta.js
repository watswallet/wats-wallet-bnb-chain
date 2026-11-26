// USDC/USDT meta + logo: Takas ekrani (useAtsPurchase) ve Al/Sat odeme cipleri (StockTrade) TEK kaynak kullanir.
// Logolar native tablodaki (data/native_tokens.json) ile AYNI kaynaktan: CoinGecko gorsel CDN'i
// (2026-10-04 olculdu: large/small/thumb uclari 200 image/png). `image` olmasa tokenLogo gri yer
// tutucuya duserdi; ekran calisirdi ama odeme tokeni tanimsiz gorunurdu.
import { buildNativeToken } from './nativeToken'

export const PAY_META = {
    USDT: { name: 'Tether USD', coingecko_id: 'tether', large: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png' },
    USDC: { name: 'USD Coin', coingecko_id: 'usd-coin', large: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png' },
}
export const cgImage = (large) => ({ large, small: large.replace('/large/', '/small/'), thumb: large.replace('/large/', '/thumb/') })

/**
 * Odeme cipinin TokenAvatar'a verdigi token (Bolum 2, Gorev 8). Stable: CoinGecko gorseli (PAY_META; olmayan sembol, orn. Gnosis USDC.e,
 * gorselsiz kalir ve cozucu sonraki kaynaga / monograma duser). Native coin (LCX hisse odemesinde ETH, BNB, POL, XDAI, CRO): agin native
 * tokeni (`buildNativeToken`, Takas / Gonder ile ayni kaynak) -- cozucu once PAKETLI yerel logoyu (ETH hangi L2'de olursa olsun Ethereum
 * logosu, L2 zincir logosu DEGIL), sonra CoinGecko gorselini dener. Ucuncu taraf kaydi / ag istegi burada YOKTUR.
 * @param {{ symbol: string, address: string, native?: boolean }} p  motorun odeme tokeni (engine.payTokens)
 * @param {number|string} chainId  hissenin zinciri
 */
export function payTokenForAvatar(p, chainId) {
    if (p.native === true) {
        const native = buildNativeToken(chainId)
        return { ...(native ?? {}), symbol: p.symbol, address: p.address, native: true }
    }
    const meta = Object.hasOwn(PAY_META, p.symbol) ? PAY_META[p.symbol] : null
    return { symbol: p.symbol, address: p.address, image: meta ? cgImage(meta.large) : null }
}
