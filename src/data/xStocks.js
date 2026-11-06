// xStocks: Backed Finance (Kraken / Payward grubu) tokenize hisse ve ETF urunu.
// EVM'de (Ethereum 1, BNB Smart Chain 56, Arbitrum One 42161) ayni adreste duran,
// 18 ondalikli, REBASE CARPANLI ERC-20 tokenlardir. Ihracci Backed Assets (JE)
// Limited (Jersey SPV); hukuki nitelik izleyici sertifikasi (tracker certificate),
// HISSE SAHIPLIGI DEGIL. bStocks (BTech Holdings / Binance) ile ALAKASI YOK.
//
// Asagidaki 24 hisse `npm run verify:xstocks` olcumuyle (olcum 3, 2026-10-13 14:15-16:45 UTC,
// ABD piyasasi ACIK) belirlendi ve KULLANICI ONAYIYLA katalogdadir (ilk 8 hisse ayrica
// 2026-10-09/10 olcumlerinden, spec Ek A ve B). Katalogu elle genisletmeyin: betik katalog
// satirlarini ONERIR, insan commit eder. Olcumde gecen ama onaylanmayan SLVx, GSx ve MRKx
// katalogda YOK (satis fiyati referansin %2'sinden fazla altinda; simetrik satis kilidi
// Faz 2). Zincir basina kapsam her hissenin `chains` listesindedir (olcumde gecen ciftler):
//   - Ethereum ve BSC: hisselerin cogu; TSLAx ve NVDAx Arbitrum'da CoW'da yol bulunamadigi
//     icin (NO_LIQUIDITY) yalniz Ethereum ve BSC'dedir.
//   - Arbitrum: yalniz MSTRx (SPYx 2026-10-15 cikarildi: alis primi +%1,11, ALIS_PRIMI_YUKSEK).
//
// DOGRULAMA DISIPLINI: adres EIP-55 biciminde ve TUM EVM zincirlerinde AYNI
// (deterministik dagitim); bu yuzden girdi basina chainId degil `chains` listesi
// vardir. Her adres listelendigi her zincirde sunlari gecmek ZORUNDA: eth_getCode
// bos degil, symbol() eslesiyor, decimals() == 18, EIP-1967 implementasyon slotu
// XSTOCKS_IMPLEMENTATIONS'tan birini gosteriyor (sahte token savunmasi), getCurrentMultiplier()
// > 0 ve CoW fiyat kapisi. Base'de sahte "AAPLx" / "TSLAx" tokenlari ve havuzlari
// var: sembol ya da ad eslestirmesiyle token eklemek kullaniciyi dolandiriciya goturur.
//
// coingeckoId ISIMDEN URETILMEZ, CoinGecko listesinden alinir. `wrapped-*-xstock`
// (ERC-4626 sarmalayici) kimlikleri KATALOGA GIRMEZ: sarmalayici rebase etmez ve
// ortak implementasyonu tasimaz.
//
// LOGO YOK: ihracci kullanim sartlari (md. 6) marka / logo kullanim hakki vermez.
// Logo, sunucunun fiyat yanitindaki CoinGecko `image` nesnesinden gelir; yoksa
// sembol harfi cizilir.
//
// BIRIM: balanceOf() ZATEN carpanlidir (rebase). bStocks'un uiMultiplier /
// balanceOfUI kolu xStocks'a UYGULANMAZ. CoinGecko fiyati ise carpanli HAM birimdedir
// ve zincirdeki getCurrentMultiplier() ile BOLUNUR (utils/stockPricing.js).
//
// Bu dosya SAF VERIDIR: hicbir import yok. Node betikleri (verify-xstocks) ve sunucu
// tohumlayicisi (seed-xstocks) capraz-paket olarak dogrudan okur.

export const XSTOCKS_CHAIN_IDS = [1, 56, 42161]

// Kabul edilen Backed implementasyonlari (TransparentUpgradeableProxy arkasinda; ayni
// adresler tum zincirlerde). Sahte tokenin slotu bos ya da bu listenin DISINDADIR; uclu
// bir adres, asagidaki koken kanitina esdeger bir olcum olmadan EKLENMEZ.
// Koken kaniti (2026-10-13, zincirden okundu): iki implementasyonun proxy'leri AYNI
// ProxyAdmin'i (0x696C685a02A1Fc6E2AaCbe26CD6695F4f4a6a085, EIP-1967 admin slotu
// 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103) kullanir ve o
// ProxyAdmin'in owner()'i Backed Safe'idir (0x49754062E35f7591B93cc4F9915965be89643a65;
// TSLAx'inkiyle ayni). Ikisi de Blockscout'ta dogrulanmis "BackedAutoFeeTokenImplementation".
export const XSTOCKS_IMPLEMENTATIONS = [
  // Ilk olculen 8 hisse (TSLAx, NVDAx, SPYx...) bunu kullanir; katalogdaki her hissenin hangisini kullandigi verify:xstocks adim 3 ile olculur. Kaynak: eth.blockscout.com, dogrulanma
  // 2026-06-24, solc 0.8.9, contracts/BackedAutoFeeTokenImplementation.sol.
  '0x65c40D624Af3B18C109fBF87B7DEff34CdC5f19b',
  // Yeni xStocks'un buyuk cogunlugu bunu kullanir (ornek AAOIx; 24 hisselik Ethereum orneginde 21/24).
  // Kaynak: eth.blockscout.com, dogrulanma 2025-11-27, solc 0.8.9, ayni kaynak dosya adi.
  '0xd865Ce1B07540b5edE20e8298f48da69770Fe22e',
]

// EIP-1967 implementasyon slotu: keccak256('eip1967.proxy.implementation') - 1
export const XSTOCKS_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

// CoinGecko asset_platform_id (supported_chains.json chainSlug ile AYNI; testle kilitli).
export const XSTOCKS_PLATFORM_BY_CHAIN = {
  1: 'ethereum',
  56: 'binance-smart-chain',
  42161: 'arbitrum-one',
}

// xStocks ailesinin TUM CoinGecko kimlikleri (`tesla-xstock`, `wrapped-tesla-xstock`, ...) bu desene uyar.
// Sunucu (server/data/xstocks.js) AYNI deseni kullanir; esitlik testle kilitli.
export const XSTOCK_FAMILY_ID = /-xstock$/

// `underlying`: dayanak ticker (buyuk harf), bStocks ile eslesme anahtari; ACIK yazilir, sembolden
// TURETILMEZ (utils/stocks/stockCompanies.test.js 10 ciftlik gozden gecirilmis listeyi kilitler).
// `name`: resmi token listesindeki (backed-fi/cowswap-xstocks-tokenlist v7.2.0) ad,
// sondaki " xStock" atilmis. `chains`: verify:xstocks'un olcup gectigi zincirler.
export const XSTOCKS = [
  {
    symbol: 'TSLAx',
    underlying: 'TSLA',
    name: 'Tesla',
    address: '0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0',
    chains: [1, 56],
    coingeckoId: 'tesla-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'NVDAx',
    underlying: 'NVDA',
    name: 'NVIDIA',
    address: '0xc845b2894dBddd03858fd2D643B4eF725fE0849d',
    chains: [1, 56],
    coingeckoId: 'nvidia-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'SPYx',
    underlying: 'SPY',
    name: 'SP500',
    address: '0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48',
    chains: [1, 56],
    coingeckoId: 'sp500-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'AAPLx',
    underlying: 'AAPL',
    name: 'Apple',
    address: '0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a',
    chains: [1],
    coingeckoId: 'apple-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'QQQx',
    underlying: 'QQQ',
    name: 'Nasdaq',
    address: '0xa753A7395cAe905Cd615Da0B82A53E0560f250af',
    chains: [1],
    coingeckoId: 'nasdaq-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'GOOGLx',
    underlying: 'GOOGL',
    name: 'Alphabet',
    address: '0xe92f673Ca36C5E2Efd2DE7628f815f84807e803F',
    chains: [1],
    coingeckoId: 'alphabet-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'MSTRx',
    underlying: 'MSTR',
    name: 'MicroStrategy',
    address: '0xAE2f842EF90C0d5213259Ab82639D5BBF649b08E',
    chains: [1, 56, 42161],
    coingeckoId: 'microstrategy-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'COINx',
    underlying: 'COIN',
    name: 'Coinbase',
    address: '0x364f210f430eC2448Fc68A49203040F6124096F0',
    chains: [1],
    coingeckoId: 'coinbase-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'AMZNx',
    underlying: 'AMZN',
    name: 'Amazon.com',
    address: '0x3557Ba345B01EFa20A1bdDC61F573BFD87195081',
    chains: [1, 56],
    coingeckoId: 'amazon-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'MSFTx',
    underlying: 'MSFT',
    name: 'Microsoft',
    address: '0x5621737f42dAE558b81269FcB9E9E70c19Aa6b35',
    chains: [1, 56],
    coingeckoId: 'microsoft-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'AVGOx',
    underlying: 'AVGO',
    name: 'Broadcom',
    address: '0x38BAC69cbBd28156796e4163B2B6dcb81E336565',
    chains: [1, 56],
    coingeckoId: 'broadcom-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'Vx',
    underlying: 'V',
    name: 'Visa',
    address: '0x2363FD1235C1B6d3A5088DdF8dF3A0b3A30C5293',
    chains: [1, 56],
    coingeckoId: 'visa-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'KOx',
    underlying: 'KO',
    name: 'Coca-Cola',
    address: '0xdCC1a2699441079dA889B1F49e12B69cC791129b',
    chains: [1, 56],
    coingeckoId: 'coca-cola-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'MUx',
    underlying: 'MU',
    name: 'Micron Technology',
    address: '0xf6a873BAe4Ba1B304e45dF52A4b7D176E1C6a8c4',
    chains: [1],
    coingeckoId: 'micron-technology-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'MRNAx',
    underlying: 'MRNA',
    name: 'Moderna',
    address: '0xeFD30445A4ec1f4b3E0a6f4d9bDbd215F805047F',
    chains: [1, 56],
    coingeckoId: 'moderna-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'CRCLx',
    underlying: 'CRCL',
    name: 'Circle',
    address: '0xfEbDEd1B0986a8ee107f5AB1a1c5a813491DeCEB',
    chains: [1, 56],
    coingeckoId: 'circle-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'GLXYx',
    underlying: 'GLXY',
    name: 'Galaxy Digital',
    address: '0xf7F4fAC56f012dE7Dd6adFF54C761986B9E0655a',
    chains: [1],
    coingeckoId: 'galaxy-digital-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'BSPx',
    underlying: 'BSP',
    name: 'Bending Spoons',
    address: '0x7796F4E23a62eF3653829c21032A9E24bEaf4Cf5',
    chains: [1, 56],
    coingeckoId: 'bending-spoons-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'VTx',
    underlying: 'VT',
    name: 'Vanguard Total World',
    address: '0x6d5edEEbBc6A4099Eb8bb289EB3b80D799f7b28C',
    chains: [1],
    coingeckoId: 'vanguard-total-world-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'VTIx',
    underlying: 'VTI',
    name: 'Vanguard',
    address: '0xbD730E618bcD88C82dDeE52e10275CF2f88A4777',
    chains: [56],
    coingeckoId: 'vanguard-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
  {
    symbol: 'COPXx',
    underlying: 'COPX',
    name: 'Global X Copper Miners',
    address: '0x89BAB39D627A9e34f0dc782C53457e80Ee8Fb9D9',
    chains: [1],
    coingeckoId: 'global-x-copper-miners-xstock',
    decimals: 18,
    issuer: 'xstocks',
  },
]
