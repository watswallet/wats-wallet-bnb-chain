// ATS (AllToScan) paymaster ile transfer ucreti odenen zincirler.
// Adresler + backend URL'i PUBLIC'tir (backend auth'suz; istemci dogrudan konusur).
//
// ONEMLI: zorunlu alanlardan biri bile bos oldugu surece getAtsConfig null doner,
// isAtsChain false olur ve transferler duz native akista kalir. Yeni zincir acmak =
// buradaki kaydin adreslerini doldurmak; baska kod degismez.
//
// ADRESLER NEDEN BACKEND'DEN CEKILMIYOR: istemcinin kendi sabitini tutmasi bir
// GUVENLIK kontrolu. /paymaster/sponsor baska bir paymaster adresi dondururse
// assertSponsorConsistent gonderimi durdurur. Adresi backend'den alsaydik o kontrol
// kendi kendini dogrulayan bir tautoloji olurdu: yanlis spender'a MaxUint256 approve
// gonderilir, allowance hic yukselmez, her denemede postOp revert eder ve paymaster
// deposit'ten gaz odeyip SIFIR ATS toplar.
//
// Gaz alanlari ARTIK SABIT DEGIL: her op icin estimateGas + buildGasParams ile kurulur
// (bkz. atsPaymaster.buildAtsGasParams). Sabit tavan capraz-zincirde iadesiz fazla odemeydi —
// olculdu: verilen tavanin yalniz %18'i kullaniliyordu.

// Zincirlerin cogunda ayni: EntryPoint v0.8 deterministik adreste. Yine de zincir
// basina DOGRULANMALI — backend'inkiyle birebir ayni olmazsa imza dogrulanmaz.
const ENTRY_POINT_V08 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
const BACKEND_BASE = 'https://bundler.watswallet.com'

// logoURI YEREL bir varliktir (public/ats.png — Alltoscan'in gercek marka isareti).
// Uzak URL kullanilmaz: uc 404 verdiginde <img @error> zinciri sonsuz fetch dongusune
// giriyordu ve logo cevrimdisi hic gorunmezdi.
const atsToken = (address) => ({ address, symbol: 'ATS', decimals: 18, logoURI: '/ats.png' })

// 7702 delegate'i ON ZINCIRDE DE ayni adreste ve bytecode'u birebir ayni (sha256 ilk 12:
// bb7c53173060, 7300 karakter runtime kod). Deterministik dagitim; zincir basina ayri
// sabit tutmaya gerek yok. Kullanicinin EOA'si buna delege edildigi icin dogrulugu
// kritik: her zincirde getCode ile karsilastirildi.
const DELEGATE = '0x268D193D74D3B9a13a82DA831302cf8DBdC9245A'

// Ucretin TAHSIL EDILDIGI zincir. Kullanicinin gercek ATS'si yalnizca burada durur; diger
// zincirlerdeki bakiyeler kullaniciya hic acilmayan ATSOFT kalintilaridir (belge 01).
export const ATS_SRC_CHAIN_ID = 56

// Ucret CAPRAZ-ZINCIR mi tahsil ediliyor? Cevap YALNIZCA zincire baglidir: kullanicinin
// gercek ATS'si sadece BSC'de durur, dolayisiyla 56 DISINDAKI her aginda tahsilat BSC'deki
// toplayici uzerinden yapilir.
//
// BU BILGI /status'un `mode` ALANINDAN TURETILEMEZ — 2026-08-10'da canlida olculdu:
//   chainId 1 -> mode:"bootstrap", ready:true, srcAllowance:"0"   ... ama /sponsor
//   ayni op'u `src-allowance-missing` ile reddetti.
// Yani `mode` HEDEF ZINCIRDEKI sponsorluk seklini anlatir (7702 + paymaster izni gerekiyor
// mu), tahsilatin NEREDE yapildigini DEGIL. Ikisi dik kavramlar; birlestirmek uc ayri
// hataya yol aciyordu: (1) izin kontrolu hic kosmuyor ve kullanici ucus sirasinda oluyor,
// (2) ekran atsFee gosterirken backend atsFeeCrosschain tahsil ediyor, (3) remote
// paymaster'in postOp'u olmadigi halde postOp gazi butcelenip capraz-zincirde IADESIZ
// odeniyor.
export const isCrosschainCollection = (chainId) => Number(chainId) !== ATS_SRC_CHAIN_ID

// ATSGasCollector — capraz-zincir yolunda kullanicinin ATS'sini transferFrom ile ceken kontrat.
// Belge bu adresi VERMIYOR (SDK da enjekte edilen bir secenek olarak aliyor); belgedeki BSC
// tahsilat isleminden (0xc079fbd3...b3b3) cozuldu ve zincirde dogrulandi:
//   ats() = 0x75D8BB7f...B81d (BSC ATS), owner() = paymaster ile ayni, settled(bytes32) var.
export const ATS_COLLECTOR = '0xE39E4D2EAb51b7a77D2d6bf35b1C0501B7cB75cF'

// Cogu zincirde ATS ayni adreste (deterministik dagitim). Ethereum ve BSC ayrik.
const ATS_SHARED = '0xE2D977DC010F15BDDAA656141890e3e00E16D012'

// 2026-08-12 FILO YENILEMESI: backend same-chain paymaster'larin YENI NESLINI dagitti
// (runtime 17524 karakter; eski nesil 16192). Eski adreslerin EntryPoint deposit'i her
// zincirde 0'a indi, yenilerinki dolu — yani eski filo OLU, adresleri tutmak bootstrap
// approve'unu olu kontrata gonderirdi (allowance hic gorulmez, ozellik sessizce olur).
// Tek istisna Ethereum (1): orada hala eski nesil (16192) canli ve /health de onu donuyor.
//
// Adresler /health'ten alinip ZINCIRDE dogrulandi (kor kopya degil): her birinde
// entryPoint() = bizim v0.8, owner() = 0xb42f545b... (eski filoyla ayni sahip),
// ats() = o zincirin yapilandirilmis ATS'i, deposit > 0 (OP haric — orada 0 olculdu,
// backend'e bildirilmeli).
const PM_POLYGON_BASE_CELO = '0xBcD8538fC26e9957101B467aD6B97c2792692B63' // Polygon, Base, Celo

// UZAKTAN PAYMASTER (ATSRemotePaymaster) — capraz-zincir op'larini HEDEF zincirde
// sponsorlayan AYRI kontrat. Same-chain `ATSPaymaster` DEGILDIR ve `/health` bu adresi
// DONMEZ; allowlist yalniz same-chain paymaster'i tanidigi icin capraz-zincir op'u
// `sponsor paymaster adresi izinli kumede degil` ile reddediliyordu — yani ozelligin ASIL
// yolu, tam da onboarding bittikten sonra kapaliydi (2026-08-10; once chainId 1, sonra 137).
//
// NEDEN /sponsor'un DEDIGI KABUL EDILMIYOR: istemcinin kendi sabitini tutmasi bir kontrol;
// adresi sunucudan almak onu kendi kendini dogrulayan bir tautolojiye cevirirdi (dosyanin
// basindaki nota bakin). Her adres ZINCIRDE dogrulandi (2026-08-10) ve dordu de AYNI imzayi
// tasiyor:
//   runtime kod  = 10236 karakter (same-chain paymaster 16192 — FARKLI kontrat)
//   entryPoint() = 0x4337084D... (bizim EntryPoint v0.8)
//   ats()        = YOK           (capraz-zincirde hedef zincirde ATS'ye dokunmaz)
//   owner()      = 0xb42f545b... (same-chain paymaster ile AYNI sahip; ATSGasCollector'in
//                                 ucretleri gonderdigi adres de bu)
//   EntryPoint deposit'i dolu
//
// 2026-08-12: backend `/health`e `remotePaymaster` alanini EKLEDI (rapor 4c kapandi) ve
// tablo dokuz zincirin tamamiyla dolduruldu. Kaynak /health olsa da adresler ZINCIRDE
// dogrulanmadan yazilmadi (aksi halde allowlist kendi kendini dogrulayan bir tautoloji
// olurdu — dosyanin basindaki not): dokuzu da runtime 10236 karakter, entryPoint() =
// bizim v0.8, owner() = 0xb42f545b... (same-chain filo ile ayni sahip), ats() YOK.
//
// Adresler cogunlukla zincir basina farkli (deterministik degil); tek istisna Mantle/Celo
// ikilisi — ayni adres, iki zincirde de ayni bytecode (2026-08-12 canli Celo hatasi
// "izinli kumede degil" boyle cozuldu). Gomulu tablo /health'e ragmen DURUYOR: /health
// ulasilamazsa (fail-static) capraz-zincir yolu bu tabloyla ayakta kalir.
const REMOTE_PAYMASTERS = {
  1: '0x0A8CD7A0E3F70BAA801acc2D576BE05bfd8B4b1e',     // Ethereum
  10: '0xAcdA4ed33E1296799cBEc4501f13fd7292E1132b',    // Optimism (Gnosis'in same-chain PM'iyle ayni adres, farkli kontrat)
  25: '0x33dc18DF2E9466CEe4b354D4fcE9e8950F5e8017',    // Cronos
  100: '0x8d13462672ABf324598aBFB66334B26D516D44EB',   // Gnosis
  137: '0x478b9dc2f24b13c2D8dD56F898b741469138ad7A',   // Polygon
  5000: '0x51CFC0A368cAE29e9be37c340Ba16ab5737fec59',  // Mantle
  8453: '0x1465397102cB623Fe85Bd76aE6BD525E026cD340',  // Base
  42161: '0xd101950BCE7abd294C2a55F3D4c9508f70042868', // Arbitrum One
  42220: '0x51CFC0A368cAE29e9be37c340Ba16ab5737fec59', // Celo (Mantle ile ayni kontrat/adres)
}

// `id` remote paymaster'i tabloya baglamak icin: kayitla adresi elle eslestirmek, ikisinden
// biri tasindiginda sessizce yanlis zincire bakmak demekti.
const chain = (id, paymaster, token, extra = {}) => ({
  paymaster, delegate: DELEGATE, entryPoint: ENTRY_POINT_V08,
  token: atsToken(token), backendBase: BACKEND_BASE,
  srcChainId: ATS_SRC_CHAIN_ID,
  ...(REMOTE_PAYMASTERS[id] ? { remotePaymaster: REMOTE_PAYMASTERS[id] } : {}),
  ...extra,
})

// Backend'in destekledigi zincirler (kendi hata mesajindan: 42161, 8453, 56, 137, 1,
// 10, 100, 42220, 5000, 25) ile cuzdanin destekledigi aglar AYNI kumedir.
//
// Adresler zincirde DOGRULANDI (2026-08-12, filo yenilemesi sonrasi — gerekce yukarida):
// - paymaster'lar yeni nesil (runtime 17524; Ethereum eski nesil 16192'de kaldi)
// - her paymaster'in ats()'i o zincirin ATS tokenine bakar; symbol='ATS', decimals=18
// - delegate on zincirde de ayni adres ve ayni bytecode
//
// Yanlis bir adres yine de fon kaybettirmez: sendOneOp once /sponsor'u cagirip
// assertSponsorConsistent ile backend'in paymaster'ini bununla karsilastirir, ayrisirsa
// IMZADAN ONCE durur. Ama approve yanlis spender'a giderse allowance hic yukselmez ve
// ozellik o zincirde sessizce calismaz — bu yuzden adresler dogrulanmadan yazilmamali.
export const ATS_CHAINS = {
  1: chain(1, '0xfc5ab2451c28a2E92A2Ea90e126e1f890c75Df9e',
    '0x20bE3d6D519c5825715afa003Ea857f750dEC1c8'),                  // Ethereum (2026-08-13: yeni nesle gecti)
  25: chain(25, '0x4A275c4D99bf3747A459362DF44D3FcC413d4dD5', ATS_SHARED),       // Cronos
  10: chain(10, '0xb5F03d9d3BB48AbDf2964F0E41186fFEe12C0A7e', ATS_SHARED),       // Optimism
  56: chain(56, '0x004e1f5aB1B7bf85412B11628Ca7A8C73Cd8ad53',
    '0x75D8BB7fBd4782a134211dc350Ba5c715197B81d', { collector: ATS_COLLECTOR }), // BNB Smart Chain
  100: chain(100, '0xAcdA4ed33E1296799cBEc4501f13fd7292E1132b', ATS_SHARED),     // Gnosis (OP'nin remote PM'iyle ayni adres, farkli kontrat)
  137: chain(137, PM_POLYGON_BASE_CELO, ATS_SHARED),                             // Polygon
  5000: chain(5000, '0x063d4e5Ee1C60489509cD5b93DD9190713d6E2C3', ATS_SHARED),   // Mantle
  8453: chain(8453, PM_POLYGON_BASE_CELO, ATS_SHARED),                           // Base
  42161: chain(42161, '0x89e6FA55fC0e29dFCdf1bbfA50c9c0BcC216c74c', ATS_SHARED), // Arbitrum One
  42220: chain(42220, PM_POLYGON_BASE_CELO, ATS_SHARED),                         // Celo
}

// Saf cekirdek: verilen config tablosundan gecerli kaydi cozer.
// Eksik/bos zorunlu alan = yapilandirilmamis = null. backendBase de zorunlu:
// olmadan istemci paymaster backend'ine ulasamaz, ozellik atil kalmali.
export function getAtsConfigFrom(chains, chainId) {
  const c = chains && chains[Number(chainId)]
  if (!c) return null
  if (!c.paymaster || !c.delegate || !c.entryPoint) return null
  if (!c.token || !c.token.address) return null
  if (!c.backendBase) return null
  return c
}

export const getAtsConfig = (chainId) => getAtsConfigFrom(ATS_CHAINS, chainId)
export const isAtsChain = (chainId) => getAtsConfig(chainId) !== null

// Ucret her zaman kaynak zincirde (BSC) tahsil edilir; onboarding op'lari da orada kosar.
export const getAtsSourceConfig = () => getAtsConfig(ATS_SRC_CHAIN_ID)
