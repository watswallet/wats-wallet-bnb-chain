import { XSTOCK_EXISTENCE_CHAIN_IDS } from '../tokenizedStocks'

// GIZLI MOD TESLIM FILTRESINE OZEL hisse bilgisi (sahip karari 2026-10-23: tokenlastirilmis hisse ASLA teslim tokeni olmaz).
//
// NEDEN AYRI: ticaret katalogu (data/xStocks.js, data/bStocks.js -> tokenizedStocks.js) Hisseler sekmesini, rozetleri, Takas/Kopru
// dislamasini ve fiyat/bakiye okumasini surer; yalniz URUNE ALINAN hisseleri tasir (21 xStock + 22 bStock). Sunucunun token listesi
// (POST /getChainTokens) ise bu katalogda OLMAYAN daha cok hisse getirir: Arbitrum'da 30 xStock ve Polygon'da 2 Backed tokeni (2026-11-03
// listesi). Onlari kataloga eklemek normal moddaki Hisseler sekmesini (ve Takas/Kopru dislamasini) DEGISTIRIRDI. Bu dosya kataloga DOKUNMAZ:
// yalniz gizli teslim secicisinin ve arka plandaki teslim kapilarinin (stockDelivery.js) bildigi ek bir listedir; tokenizedStocks.js bu
// dosyayi ICE AKTARMAZ (tek yonlu bagimlilik, testle kilitli).
//
// Tanim YALNIZ (chainId, adres) iledir; sembol ya da ad bu listede ASLA bakilmaz (ornek: Polygon'da 0xb2c6... "Bomb Crypto" sembolu bcoin'dir ama
// hisse degildir). Ad/sembol yalniz asagidaki ISARET AGINDA (hasStockIssuerMarker) ve yalniz sunucu/ice aktarilan satirlarinda okunur.

// Backed xStocks AYNI adreste tum EVM zincirlerinde durur (data/xStocks.js baslik notu: deterministik dagitim); dislama kapsami katalogun kendi
// kapsamidir (XSTOCK_EXISTENCE_CHAIN_IDS: Ethereum, BSC, Arbitrum, Optimism, Mantle). Polygon ve Base BILEREK yok (orada ayni adreste taklitler var).
// Adresler kucuk harf; sunucu listesinden alindi (Arbitrum, 2026-11-03).
const XSTOCK_EXTRA = [
    ['0xf8a80d1cb9cfd70d03d655d9df42339846f3b3c8', 'INTCx'], // Intel xStock
    ['0x2380f2673c640fb67e2d6b55b44c62f0e0e69da9', 'GLDx'], // Gold xStock
    ['0x96702be57cd9777f835117a809c7124fe4ec989a', 'METAx'], // Meta xStock
    ['0xe1385fdd5ffb10081cd52c56584f25efa9084015', 'HOODx'], // Robinhood xStock
    ['0xeaad46f4146ded5a47b55aa7f6c48c191deaec88', 'MRVLx'], // Marvell xStock
    ['0x548308e91ec9f285c7bff05295badbd56a6e4971', 'ORCLx'], // Oracle xStock
    ['0xfdddb57878ef9d6f681ec4381dcb626b9e69ac86', 'TQQQx'], // TQQQ xStock
    ['0x6d482cec5f9dd1f05ccee9fd3ff79b246170f8e2', 'PLTRx'], // Palantir xStock
    ['0x80a77a372c1e12accda84299492f404902e2da67', 'MCDx'], // McDonald's xStock
    ['0xa6a65ac27e76cd53cb790473e4345c46e5ebf961', 'NFLXx'], // Netflix xStock
    ['0x12992613fdd35abe95dec5a4964331b1ee23b50d', 'BRK.Bx'], // Berkshire Hathaway xStock
    ['0xe5f6d3b2405abdfe6f660e63202b25d23763160d', 'GMEx'], // Gamestop xStock
    ['0x19c41ea77b34bbdee61c3a87a75d1abda2ed0be4', 'LLYx'], // Eli Lilly xStock
    ['0xd9913208647671fe0f48f7f260076b2c6f310aac', 'IBMx'], // International Business Machines xStock
    ['0x214151022c2a5e380ab80cdac31f23ae554a7345', 'CRWDx'], // CrowdStrike xStock
    ['0xad5cdc3340904285b8159089974a99a1a09eb4c0', 'CVXx'], // Chevron xStock
    ['0x50a1291f69d9d3853def8209cfb1af0b46927be1', 'APPx'], // AppLovin xStock
    ['0xeedb0273c5af792745180e9ff568cd01550ffa13', 'XOMx'], // Exxon Mobil xStock
    ['0x053c784cd87b74f42e0c089f98643e79c1a3ff16', 'CSCOx'], // Cisco xStock
    ['0xdb0482cfad4789798623e64b15eeba01b16e917c', 'JNJx'], // Johnson & Johnson xStock
    ['0x167a6375da1efc4a5be0f470e73ecefd66245048', 'UNHx'], // UnitedHealth xStock
    ['0x4a4073f2eaf299a1be22254dcd2c41727f6f54a2', 'CRMx'], // Salesforce xStock
    ['0xd9fc3e075d45254a1d834fea18af8041207dea0a', 'JPMx'], // JPMorgan Chase xStock
    ['0xf9523e369c5f55ad72dbaa75b0a9b92b3d8b147e', 'NVOx'], // Novo Nordisk xStock
    ['0x36c424a6ec0e264b1616102ad63ed2ad7857413e', 'PEPx'], // PepsiCo xStock
    ['0x1ac765b5bea23184802c7d2d497f7c33f1444a9e', 'PFEx'], // Pfizer xStock
    ['0xa90424d5d3e770e8644103ab503ed775dd1318fd', 'PGx'], // Procter & Gamble xStock
    ['0x3ee7e9b3a992fd23cd1c363b0e296856b04ab149', 'GSx'], // Goldman Sachs xStock
    ['0xfbf2398df672cee4afcc2a4a733222331c742a6a', 'ABBVx'], // AbbVie xStock
    ['0x7aefc9965699fbea943e03264d96e50cd4a97b21', 'WMTx'], // Walmart xStock
]

// Backed'in zincire OZGU tokenlari: yalniz (zincir, adres) cifti, baska zincire genellenmez. Polygon (2026-11-03).
const BACKED_EXACT = [
    [137, '0xbbcb0356bb9e6b3faa5cbf9e5f36185d53403ac9', 'BCOIN'], // Backed Coinbase Global
    [137, '0x2f11eeee0bf21e7661a22dbbbb9068f4ad191b86', 'BNIU'], // Backed NIU Technologies
]

const XSTOCK_EXTRA_ADDRESSES = new Set(XSTOCK_EXTRA.map(([address]) => address))
const BACKED_EXACT_KEYS = new Set(BACKED_EXACT.map(([chainId, address]) => `${chainId}:${address}`))

// Teslim listesinde katalog DISI ama bilinen hisse mi? (stockDelivery.isStockDeliveryToken katalogla birlikte sorar.)
export function isDeliveryOnlyStock(chainId, address) {
    if (typeof address !== 'string' || !address) return false
    const lower = address.toLowerCase()
    const chain = Number(chainId)
    return (XSTOCK_EXISTENCE_CHAIN_IDS.includes(chain) && XSTOCK_EXTRA_ADDRESSES.has(lower)) || BACKED_EXACT_KEYS.has(`${chain}:${lower}`)
}

// ISARET AGI (yalniz teslim secici satirlari: sunucu listesi ve ice aktarilanlar). Adres listesi bugunku sunucu listesini kapsar ama sunucu
// yarin yeni bir xStock/Backed tokeni getirebilir ya da liste 100 satirla sinirli oldugu icin bugun gorunmeyenleri vardir; ihracci ADINI
// kendi isimlendirmesiyle yazar ("<Sirket> xStock", "Backed <Sirket>"). Bu isaretleri tasiyan satir hisse sayilir ve secicide gorunmez
// (fail-closed: yanlis pozitif yalniz bir satirin teslim listesinden gizlenmesi demektir; hisse teslimi ise yasaktir). Arka plandaki kapilar
// adres tabanli kalir (teklifte ad yoktur). Sembol bilerek bakilmaz (cok genis: "...x" ile biten her token).
const XSTOCK_NAME = /\bxstocks?\b/i
const BACKED_NAME = /^backed\s/i

export function hasStockIssuerMarker(name) {
    if (typeof name !== 'string') return false
    const n = name.trim()
    return XSTOCK_NAME.test(n) || BACKED_NAME.test(n)
}

// Testler icin (sayim ve dolasim): ek listelerin kopyalari.
export const DELIVERY_ONLY_XSTOCKS = Object.freeze(XSTOCK_EXTRA.map(([address, symbol]) => Object.freeze({ address, symbol })))
export const DELIVERY_ONLY_BACKED = Object.freeze(BACKED_EXACT.map(([chainId, address, symbol]) => Object.freeze({ chainId, address, symbol })))
