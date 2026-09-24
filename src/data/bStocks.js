// bStocks: Binance'in tokenize hisse urunu (BEP-20, BNB Smart Chain / 56).
// Ihracci BTech Holdings Limited (ADGM'de kurulu SPV, Binance grubu istiraki),
// duzenleyici ADGM FSRA. Hukuki nitelik "Certificates over Shares" - Binance'in
// kendi ifadesiyle bunlar hisse senedi DEGIL, hisse uzerine sertifika.
// Backed Finance / xStocks ile ALAKASI YOK.
//
// DOGRULAMA DISIPLINI (2026-09-18, bsc-dataseed.bnbchain.org):
// Katalogun tek resmi kaynagi Binance degil, ADGM FSRA "Approved Prospectuses"
// kaydidir (BTech Holdings adina 77 onayli prospektus). Binance hicbir yerde
// makinece okunabilir kontrat adresi listesi yayinlamiyor.
//
// Buradaki 22 kaydin HEPSI tek tek zincirde dogrulandi: symbol() beklenenle
// ayni, decimals() == 18, EIP-1967 beacon slotu BSTOCKS_BEACON, compliance()
// BSTOCKS_COMPLIANCE, uiMultiplier() cevap veriyor, identifier() asagidaki ISIN.
// 22/22 gecti. Betik: npm run verify:bstocks
//
// NEDEN BEACON WHITELIST'I SART: DexScreener'da BSC uzerinde "Seagate Tokenized
// bStocks" adli UC AYRI SAHTE kontrat var (0x3f46948c..., 0x5877cf94...,
// 0x059a06de...). Ucunde de beacon slotu BOS ve uiMultiplier() yok. Sembol ya da
// isim eslestirmesiyle token eklemek kullaniciyi dogrudan dolandiriciya goturur.
//
// NEDEN SADECE 22: 77 aday cuzdanin KENDI QuoterV2'siyle olculdu - 25 UYGUN,
// 5 SIG, 47 KOTASYONSUZ. Kotasyonsuzlarin cogunda havuz acilmis ama hic
// beslenmemis (AMDB 2 wei, IBMB 1 wei). 25'ten cikanlar: SOXLB ve TQQQB
// (3x kaldiracli, gunluk yeniden dengelenen, uzun vadede deger eriten urunler)
// ve MRNAB (CoinGecko kaydi YOK, fiyat ve grafik kalici bos kalirdi).
//
// CoinGecko 24s hacmi listeleme kapisi OLARAK KULLANILMADI: o Binance CEX
// hacmidir, DEX hacmi degil. KORUB'da CoinGecko $15,8M hacim gosterirken
// cuzdanin erisebildigi DEX likiditesi $1.
//
// coingecko_id ISIMDEN URETILEMEZ. 22'nin 4'u desen disi; uretilen tahminler
// 404 veriyor ('nvidia-bstocks-tokenized-stock' denendi, yok).
//
// name() zincirde kisa sirket adidir ("Alphabet"), CoinGecko'da ise
// "... (bStocks Tokenized Stock)". Burada KISA ad tutuluyor.
// UYARI: implementasyonda setName(string) ve setSymbol(string) VAR - isim ve
// sembol degisebilir, kalici cache'leme yapma.

export const BSTOCKS_CHAIN_ID = 56

// EIP-1967 beacon slotu: keccak256('eip1967.proxy.beacon') - 1
export const BSTOCKS_BEACON_SLOT = '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'

// 75 gercek bStock'un hepsi bu TEK beacon'i paylasiyor.
// Tek bir beacon yukseltmesi 75 tokenin davranisini ayni anda degistirir.
export const BSTOCKS_BEACON = '0x156d6dce9a4f6139a3406f1f021f1a4880de93a3'

// Ihracci bu kontrat uzerinden adres dondurabiliyor:
// addToSanctionsList(address[]) / removeFromSanctionsList(address[]).
export const BSTOCKS_COMPLIANCE = '0x53dba7aabde774787a1f57236b235567da8e14f4'

export const BSTOCKS = [
  {
    symbol: 'CRCLB',
    name: 'Circle Internet Group',
    address: '0x80f3D493EBCe97e343c53D29a137942416B4ffC0',
    decimals: 18,
    coingecko_id: 'circle-internet-group-bstock',
    isin: 'AE000A4AU3B0',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102173742/large/circle-internet-group-tokenized-bStocks-crclb.png?1781196448',
      small: 'https://coin-images.coingecko.com/coins/images/102173742/small/circle-internet-group-tokenized-bStocks-crclb.png?1781196448',
      thumb: 'https://coin-images.coingecko.com/coins/images/102173742/thumb/circle-internet-group-tokenized-bStocks-crclb.png?1781196448',
    },
  },
  {
    symbol: 'SPCXB',
    name: 'SpaceX',
    address: '0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1',
    decimals: 18,
    coingecko_id: 'spacex-bstocks-tokenized-stock',
    isin: 'AE000A4AVAW6',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102173888/large/bstocks_spacex.png?1781280362',
      small: 'https://coin-images.coingecko.com/coins/images/102173888/small/bstocks_spacex.png?1781280362',
      thumb: 'https://coin-images.coingecko.com/coins/images/102173888/thumb/bstocks_spacex.png?1781280362',
    },
  },
  {
    symbol: 'MSTRB',
    name: 'Strategy',
    address: '0xE87afb3076AeB0f9B14E368DE8145ae6a2826A14',
    decimals: 18,
    coingecko_id: 'strategy-tokenized-bstocks',
    isin: 'AE000A4AU3A2',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102176875/large/mstrb.png?1788940298',
      small: 'https://coin-images.coingecko.com/coins/images/102176875/small/mstrb.png?1788940298',
      thumb: 'https://coin-images.coingecko.com/coins/images/102176875/thumb/mstrb.png?1788940298',
    },
  },
  {
    symbol: 'SNDKB',
    name: 'SanDisk',
    address: '0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb',
    decimals: 18,
    coingecko_id: 'sandisk-bstocks-tokenized-stock',
    isin: 'AE000A4AVAX4',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102173744/large/sandisk-tokenized-bStocks-sndkb.png?1781196896',
      small: 'https://coin-images.coingecko.com/coins/images/102173744/small/sandisk-tokenized-bStocks-sndkb.png?1781196896',
      thumb: 'https://coin-images.coingecko.com/coins/images/102173744/thumb/sandisk-tokenized-bStocks-sndkb.png?1781196896',
    },
  },
  {
    symbol: 'NVDAB',
    name: 'NVIDIA',
    address: '0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436',
    decimals: 18,
    coingecko_id: 'nvidia-bstocks',
    isin: 'AE000A4AVAZ9',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102173743/large/nvidia-tokenized-bStocks-nvdab.png?1781196662',
      small: 'https://coin-images.coingecko.com/coins/images/102173743/small/nvidia-tokenized-bStocks-nvdab.png?1781196662',
      thumb: 'https://coin-images.coingecko.com/coins/images/102173743/thumb/nvidia-tokenized-bStocks-nvdab.png?1781196662',
    },
  },
  {
    symbol: 'GOOGLB',
    name: 'Alphabet',
    address: '0x3F53De71c126BdaBAe20f9cD64848d317f6C3238',
    decimals: 18,
    coingecko_id: 'alphabet-bstocks-tokenized-stock',
    isin: 'AE000A4AVFX3',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174363/large/googlb-bstocks.png?1783451303',
      small: 'https://coin-images.coingecko.com/coins/images/102174363/small/googlb-bstocks.png?1783451303',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174363/thumb/googlb-bstocks.png?1783451303',
    },
  },
  {
    symbol: 'SKHYB',
    name: 'SK Hynix',
    address: '0xCA750eF65f295BBECd685Abf54e82CAf297BDB61',
    decimals: 18,
    coingecko_id: 'sk-hynix-bstocks-tokenized-stock',
    isin: 'AE000A4AVMT7',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174549/large/skhynix.png?1784001947',
      small: 'https://coin-images.coingecko.com/coins/images/102174549/small/skhynix.png?1784001947',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174549/thumb/skhynix.png?1784001947',
    },
  },
  {
    symbol: 'TSLAB',
    name: 'Tesla',
    address: '0x5b1910eAaD6450E50f816082Aa078C41F10C292f',
    decimals: 18,
    coingecko_id: 'tesla-bstocks-tokenized-stock',
    isin: 'AE000A4AU295',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102173745/large/tesla-tokenized-bStocks-tslab.png?1781197024',
      small: 'https://coin-images.coingecko.com/coins/images/102173745/small/tesla-tokenized-bStocks-tslab.png?1781197024',
      thumb: 'https://coin-images.coingecko.com/coins/images/102173745/thumb/tesla-tokenized-bStocks-tslab.png?1781197024',
    },
  },
  {
    symbol: 'BNCB',
    name: 'CEA Industries',
    address: '0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f',
    decimals: 18,
    coingecko_id: 'cea-industries-bstocks-tokenized-stock',
    isin: 'AE000A4AWN91',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102178415/large/CEA_bstock.png?1789526108',
      small: 'https://coin-images.coingecko.com/coins/images/102178415/small/CEA_bstock.png?1789526108',
      thumb: 'https://coin-images.coingecko.com/coins/images/102178415/thumb/CEA_bstock.png?1789526108',
    },
  },
  {
    symbol: 'SPYB',
    name: 'SPDR S&P 500 ETF',
    address: '0x7138b48df7D98D7e3cc221BfE7192D0a178182D8',
    decimals: 18,
    coingecko_id: 'spy-bstocks-tokenized-stock',
    isin: 'AE000A4AU3E4',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174366/large/spyb-bstocks.png?1783452995',
      small: 'https://coin-images.coingecko.com/coins/images/102174366/small/spyb-bstocks.png?1783452995',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174366/thumb/spyb-bstocks.png?1783452995',
    },
  },
  {
    symbol: 'INTCB',
    name: 'Intel',
    address: '0xe614E2fc6C787035FF51f452e8E826Bfd32D5283',
    decimals: 18,
    coingecko_id: 'intel-tokenized-bstocks',
    isin: 'AE000A4AU3D6',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102176876/large/intcb.png?1788940550',
      small: 'https://coin-images.coingecko.com/coins/images/102176876/small/intcb.png?1788940550',
      thumb: 'https://coin-images.coingecko.com/coins/images/102176876/thumb/intcb.png?1788940550',
    },
  },
  {
    symbol: 'BMNRB',
    name: 'BitMine Immersion',
    address: '0x3548Da95a9eFFE481e8604664d75e95821e557F5',
    decimals: 18,
    coingecko_id: 'bitmine-immersion-technologies-bstocks-tokenized-stock',
    isin: 'AE000A4AV533',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102175305/large/BMNRB.png?1786083822',
      small: 'https://coin-images.coingecko.com/coins/images/102175305/small/BMNRB.png?1786083822',
      thumb: 'https://coin-images.coingecko.com/coins/images/102175305/thumb/BMNRB.png?1786083822',
    },
  },
  {
    symbol: 'GMEB',
    name: 'GameStop',
    address: '0x46cEeFDa28Dd7207059ed19B0acdc026955bb15C',
    decimals: 18,
    coingecko_id: 'gamestop-bstocks-tokenized-stock',
    isin: 'AE000A4AVSM9',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102175530/large/gamestop_bstock.png?1786614133',
      small: 'https://coin-images.coingecko.com/coins/images/102175530/small/gamestop_bstock.png?1786614133',
      thumb: 'https://coin-images.coingecko.com/coins/images/102175530/thumb/gamestop_bstock.png?1786614133',
    },
  },
  {
    symbol: 'AAPLB',
    name: 'Apple',
    address: '0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A',
    decimals: 18,
    coingecko_id: 'apple-bstocks-tokenized-stock',
    isin: 'AE000A4AVF76',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102175182/large/aaplb.png?1785455573',
      small: 'https://coin-images.coingecko.com/coins/images/102175182/small/aaplb.png?1785455573',
      thumb: 'https://coin-images.coingecko.com/coins/images/102175182/thumb/aaplb.png?1785455573',
    },
  },
  {
    symbol: 'HOODB',
    name: 'Robinhood Markets',
    address: '0xA394dCEa3fd3847fD793afBFd163E2e3858B7c65',
    decimals: 18,
    coingecko_id: 'robinhood-bstocks-tokenized-stock',
    isin: 'AE000A4AU3C8',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174591/large/hoodb-bstocks.png?1784150616',
      small: 'https://coin-images.coingecko.com/coins/images/102174591/small/hoodb-bstocks.png?1784150616',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174591/thumb/hoodb-bstocks.png?1784150616',
    },
  },
  {
    symbol: 'BABAB',
    name: 'Alibaba Group',
    address: '0x4eF9d3062c7F6ebA4AAE4990c5036598C6eff4ec',
    decimals: 18,
    coingecko_id: 'alibaba-bstocks-tokenized-stock',
    isin: 'AE000A4AVF68',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174588/large/babab-bstocks.png?1784149906',
      small: 'https://coin-images.coingecko.com/coins/images/102174588/small/babab-bstocks.png?1784149906',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174588/thumb/babab-bstocks.png?1784149906',
    },
  },
  {
    symbol: 'MSFTB',
    name: 'Microsoft',
    address: '0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0',
    decimals: 18,
    coingecko_id: 'microsoft-bstocks-tokenized-stock',
    isin: 'AE000A4AVCW2',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174258/large/bstocks_msftb.png?1782837051',
      small: 'https://coin-images.coingecko.com/coins/images/102174258/small/bstocks_msftb.png?1782837051',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174258/thumb/bstocks_msftb.png?1782837051',
    },
  },
  {
    symbol: 'AMZNB',
    name: 'Amazon',
    address: '0x1a4b499833A79A09ad7Cf1D42D7DacF71e92eb00',
    decimals: 18,
    coingecko_id: 'amazon-bstocks-tokenized-stock',
    isin: 'AE000A4AVF50',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102175185/large/amznb.png?1785456628',
      small: 'https://coin-images.coingecko.com/coins/images/102175185/small/amznb.png?1785456628',
      thumb: 'https://coin-images.coingecko.com/coins/images/102175185/thumb/amznb.png?1785456628',
    },
  },
  {
    symbol: 'QQQB',
    name: 'Invesco QQQ Trust',
    address: '0x205812CdBed920aFf76C6580abD681a46D11efc7',
    decimals: 18,
    coingecko_id: 'invesco-qqq-trust-bstocks-tokenized-stock',
    isin: 'AE000A4AVFT1',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174259/large/bstocks_qqqb.png?1782837726',
      small: 'https://coin-images.coingecko.com/coins/images/102174259/small/bstocks_qqqb.png?1782837726',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174259/thumb/bstocks_qqqb.png?1782837726',
    },
  },
  {
    symbol: 'FLNCB',
    name: 'Fluence Energy',
    address: '0x4af1D41cd9dD950dcA43984b43aaA2A8702714Ac',
    decimals: 18,
    coingecko_id: 'fluence-energy-bstocks-tokenized-stock',
    isin: 'AE000A4AVSY4',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102175192/large/FLCNB.png?1785458741',
      small: 'https://coin-images.coingecko.com/coins/images/102175192/small/FLCNB.png?1785458741',
      thumb: 'https://coin-images.coingecko.com/coins/images/102175192/thumb/FLCNB.png?1785458741',
    },
  },
  {
    symbol: 'METAB',
    name: 'Meta Platforms',
    address: '0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0',
    decimals: 18,
    coingecko_id: 'meta-platforms-bstocks-tokenized-stock',
    isin: 'AE000A4AVFU9',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102174260/large/bstocks_metab.png?1782838007',
      small: 'https://coin-images.coingecko.com/coins/images/102174260/small/bstocks_metab.png?1782838007',
      thumb: 'https://coin-images.coingecko.com/coins/images/102174260/thumb/bstocks_metab.png?1782838007',
    },
  },
  {
    symbol: 'HIMSB',
    name: 'Hims & Hers Health',
    address: '0xee6F4bcc88C2C8583d5a65c7D0C877b464100711',
    decimals: 18,
    coingecko_id: 'hims-hers-bstocks-tokenized-stock',
    isin: 'AE000A4AVRX8',
    image: {
      large: 'https://coin-images.coingecko.com/coins/images/102176946/large/hims.png?1789087230',
      small: 'https://coin-images.coingecko.com/coins/images/102176946/small/hims.png?1789087230',
      thumb: 'https://coin-images.coingecko.com/coins/images/102176946/thumb/hims.png?1789087230',
    },
  },
]
