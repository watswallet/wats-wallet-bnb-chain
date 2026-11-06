// USDC/USDT meta + logo: Takas ekrani (useAtsPurchase) ve Al/Sat odeme cipleri (StockTrade) TEK kaynak kullanir.
// Logolar native tablodaki (data/native_tokens.json) ile AYNI kaynaktan: CoinGecko gorsel CDN'i
// (2026-10-04 olculdu: large/small/thumb uclari 200 image/png). `image` olmasa tokenLogo gri yer
// tutucuya duserdi; ekran calisirdi ama odeme tokeni tanimsiz gorunurdu.
export const PAY_META = {
    USDT: { name: 'Tether USD', coingecko_id: 'tether', large: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png' },
    USDC: { name: 'USD Coin', coingecko_id: 'usd-coin', large: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png' },
}
export const cgImage = (large) => ({ large, small: large.replace('/large/', '/small/'), thumb: large.replace('/large/', '/thumb/') })
