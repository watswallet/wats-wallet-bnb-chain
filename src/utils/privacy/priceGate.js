// GIZLI MODDA FIYAT ISTEKLERI KAPALI (gizli-mod cok-ag spec 4.7 "Fiyat istekleri kapali (P11)", E6).
//
// Fiyat uc noktalari token kimliklerini (ve IP'yi) ana API'ye, `api.coingecko.com` ise yerel coin kimligini
// ucuncu tarafa tasir. Ozel modda bunlarin HICBIRI gitmez: ekranlar fiyatsiz (USD yok) calisir.
//
// ASIL DAVRANIS CAGIRAN YERLERIN ATLAMASIDIR (Home, swapFrom, swapTo, bridgeFrom, bridgeTo, SelectAssets, Token,
// useUsdPrice tuketicileri). Bu modul GUVENLIK AGIDIR: bir ekran yarin yeni bir fiyat cagrisi eklerse ya da bir
// atlama unutulursa istek aga cikmadan, yerel bir hata koduyla (`PRIVATE_PRICE_OFF`) reddedilir. Envanter testi
// (privateRequestInventory.ssr.test.js) cagiran yerleri KESICI OLMADAN olcer; kesicinin kendi testi
// priceGate.test.js'tedir.
//
// KAPSAM SINIRI: yalniz `axios` istekleri. `fetch` ile giden fiyat yollari (utils/cow/reference.js, swap.js
// getNativeTokenPrice) ayri korunur: xStocks `COW_*` kapisiyla, `getNativeTokenPrice` ise `skipPrice` ile.
//
// SDK ve silentswap importu YOKTUR (privatePopupImports.test.js): popup paketine girer.

export const PRIVATE_PRICE_OFF = 'PRIVATE_PRICE_OFF'

// Ana API'nin fiyat/kimlik cozen uc noktalari (server/router.js). `/getChainTokens` ve `/getTokenByName` BURADA
// DEGILDIR: token LISTESI ve arama metni gizli adres tasimaz (envanter satir 6 ve 23, KALIR).
// `/getRates` fiat kur tablosudur (token kimligi tasimaz) ama ozel modda USD karsiligi gosterilmez; istek hic cikmaz.
const PRICE_PATHS = ['/getTokensDataById', '/getTokenDataById', '/getTokenPriceHistory', '/getTokenByAddress', '/getRates']
const COINGECKO_HOST = 'api.coingecko.com'

// Sorgu dizesi, parca ve sondaki egik cizgiler atilir: `.../getTokensDataById?x=1` de fiyat istegidir.
function barePath(url) {
    return String(url ?? '').split('#')[0].split('?')[0].replace(/\/+$/, '')
}

/** Bu axios istegi kapali fiyat uclarindan biri mi? (`baseURL` ile birlesik ya da mutlak url) */
export function isPriceRequest(config) {
    const full = `${config?.baseURL ?? ''}${config?.url ?? ''}`
    if (full.toLowerCase().includes(COINGECKO_HOST)) return true
    const bare = barePath(config?.url)
    return PRICE_PATHS.some((path) => bare.endsWith(path))
}

/**
 * axios istek kesicisi. `isPrivate` HER istekte cagrilir (mod bilesen yasarken degisir).
 * Kapali bir fiyat istegi ozel moddayken aga CIKMADAN reddedilir.
 */
export function createPriceGate(isPrivate) {
    return (config) => {
        if (isPrivate() && isPriceRequest(config)) {
            const error = new Error(PRIVATE_PRICE_OFF)
            error.code = PRIVATE_PRICE_OFF
            error.config = config
            throw error
        }
        return config
    }
}

/**
 * Kesiciyi bir axios ornegine kurar ve KALDIRAN islevi dondurur (tekrar kurulumda sizinti olmasin).
 * @param {import('axios').AxiosInstance} http
 * @param {() => boolean} isPrivate
 */
export function installPriceGate(http, isPrivate) {
    const id = http.interceptors.request.use(createPriceGate(isPrivate))
    return () => http.interceptors.request.eject(id)
}
