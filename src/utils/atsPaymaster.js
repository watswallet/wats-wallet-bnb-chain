// ATS paymaster ile transfer — CANLI backend (bundler.watswallet.com) sozlesmesi.
// Ucler: /paymaster/quote | /paymaster/sponsor | /paymaster/relay | /paymaster/status | /health.
// Iletisim SDK'si: gasless.ts (GaslessClient) — dogrudan backendBase'e konusur.
//
// Gonderim artik sdk/flow.ts'teki runSponsoredOp uzerinden yurur (quote/sponsor/assemble/imza/
// relay sirasi ORADA kilitli, computeUserOpHash YEREL hesaplanir). Bu dosya yalnizca ATS'e ozgu
// katmani ekler: op sayisini MODA gore kurma (crosschain/normal -> tek op, bootstrap -> iki op),
// paymaster ALLOWLIST kontrolu, ucret sinirlari ve makbuzlu (settlement) TEK yeniden deneme.
// Gaz alanlari ARTIK SABIT DEGIL: her op icin estimateGas + buildGasParams (sdk/gas-estimate.ts)
//   ile dinamik kurulur (bkz. buildAtsGasParams) — canli backend'de /estimate ucu hala yok.
// Delege OLMAYAN ilk kullanici: runSponsoredOp kendisi initCode=7702 marker + viem authorization
//   bindirir (bkz. flow.ts); bu dosya yalnizca delegated bayragini /status'tan iletir.
import { ethers } from 'ethers'
import { privateKeyToAccount } from 'viem/accounts'
import { ATS_COLLECTOR, ATS_SRC_CHAIN_ID, getAtsConfig, getAtsSourceConfig, isCrosschainCollection } from './atsConfig'
import { pickAtsFee, pickBootstrapFee, atsFeeRefundable, needsBudgetTopUp, isDelegatedTo } from './atsFee'
import { resolveAtsBlocker } from './atsBlocker'
import { GaslessClient, buildBatchCallData, buildCommissionBatchCallData, settlementIdOf } from './sdk/gasless'
import { buildGasParams } from './sdk/gas-estimate'
import { runSponsoredOp } from './sdk/flow'
import { stepsToOps } from './sdk/onboarding'
import {
  resolveCommissionRegion, readCommission, resolveLockedCommission, commissionErrorDecision,
  parseExpectedCommission, maxAtsSellAmount,
} from './atsCommission'

const EXECUTE_IFACE = new ethers.Interface(['function execute(address dest, uint256 value, bytes func)'])
const ERC20_IFACE = new ethers.Interface([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
// Bootstrap butce kapisi op'un DOGRUDAN ATS harcamasini bunlarla cozer (bkz. atsSpendOfCalls).
const ATS_SPEND_IFACE = new ethers.Interface([
  'function transfer(address to, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
])
// Yalnizca nonce icin gerekir; userOpHash artik ZINCIRDEN sorulmaz (7702 bootstrap'ta revert eder).
const ENTRY_POINT_ABI = ['function getNonce(address sender, uint192 key) view returns (uint256)']

const USER_OP_EVENT_TOPIC = ethers.id(
  'UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')

// Ekranda onaylanan ucret ile gonderim anindaki taze quote arasinda izin verilen ust sinir.
const QUOTE_DRIFT_TOLERANCE = 1.25

const TX_WAIT_CONFIRMATIONS = 1
const TX_WAIT_TIMEOUT_MS = 60_000

// --- saf yardimcilar ---

// Bootstrap op'u: TAM olarak tek approve cagrisi. Ikinci cagri eklemek backend'de 400.
export function buildBootstrapCallData(cfg) {
  const approve = ERC20_IFACE.encodeFunctionData('approve', [cfg.paymaster, ethers.MaxUint256])
  return EXECUTE_IFACE.encodeFunctionData('execute', [cfg.token.address, 0n, approve])
}

// buildTransaction ciktisi {to,value,data} tek bicimde sarilir; native/ERC-20 ayrimi icin
// dallanma YOK.
export function buildTransferCallData(call) {
  return EXECUTE_IFACE.encodeFunctionData('execute', [
    call.to,
    call.value ? BigInt(call.value) : 0n,
    call.data && call.data !== '0x' ? call.data : '0x',
  ])
}

// KOMISYON TOHUMU — OTORITE DEGIL, yalnizca /quote turu tasarrufu.
// Backend komisyonu yalnizca TANIDIGI hedefe dokunan op'lardan ister (canli olcum). Tohum,
// bekledigimiz cevabi pesinen batch'e koyar; dogru cikarsa op tek /quote turunda biter.
// YANLIS TOHUMUN BEDELI EN FAZLA BIR /quote TURUDUR, asla yanlis odeme degil — karar
// /quote'un cevabina gore duzeltilir (sendOneOp mutabakat kapisi).
//
// 'bridge' DAHIL — 2026-08-20'de CANLI OLCULDU, cikarimla degil. Once manifestoda
// (`docs/ats-komisyon-router-listesi.json`) yalniz swap router'lari oldugu icin kopru
// hedeflerinin taninmadigi VARSAYILMIS ve 'bridge' tohumdan cikarilmisti. Olcum bunu
// curuttu: Li.Fi Diamond'a (0x1231DEB6…F4EaE) dokunan bir batch icin /quote hem BSC'de
// hem Polygon'da `commissionAts` DONUYOR. Yani backend hedefi TANIYOR ve siniflandirmayi
// cagrilan ADRES uzerinden yapiyor (denemede fonksiyon verisi dolguydu, yine tanidi).
// Tohumu cikarmak BSC'deki her kopruye bosa bir /quote turu ve tuketilmis bir planli
// butce maliyeti yukluyordu — yani duzeltmeye calisilan seyin tam tersi.
const COMMISSION_SEEDED_KINDS = new Set(['swap', 'bridge'])
export function commissionSeedFor(opKind, region, statusCommission) {
  if (region !== 'local') return 0n
  return COMMISSION_SEEDED_KINDS.has(opKind) ? BigInt(statusCommission || 0n) : 0n
}

// TOHUM ile BENIMSEME AYRI SORULARDIR ve ayri kumeleri vardir.
//
// Tohum yukarida: "bugun hangi turde dogru tahmin edebiliyoruz" — bir hiz sorusu.
// Bu kume ise: "/quote komisyon isterse hangi turde sessizce KABUL edebiliriz" — bir GUVEN
// sorusu. Olcut ekrandir: komisyonun kullaniciya gosterildigi akislarda benimseme mesrudur.
//   swap   -> Swap.vue komisyonu ayri satirda gosterir (useAtsOpFee.hasCommission)
//   bridge -> Bridge.vue ayni karti gosterir; belge zaten "Swap ve Bridge Komisyonu"
//   transfer -> ConfirmTransaction.vue komisyonu HIC gostermez ve `assertQuoteWithinApproval`
//               yalniz gaz ucretini sinirlar; yani benimseme, tavansiz ve ekranda izsiz bir
//               odeme olurdu — bu dosyanin kapattigi hatanin ta kendisi, yalnizca tetikleyicisi
//               /status yerine /quote. Gorunur hata, sessiz odemeden iyidir. Send'de komisyon
//               istenecekse ONCE ekran ve tavan yazilmali.
const COMMISSION_ALLOWED_KINDS = new Set(['swap', 'bridge'])
export const commissionPlanFor = (opKind, region) =>
  (region === 'local' && COMMISSION_ALLOWED_KINDS.has(opKind) ? 1 : 0)

/**
 * BIR OP'UN callData'SINI KURAN TEK YER — swap/bridge komisyonu dahil (belge "Swap ve Bridge
 * Komisyonu" §02, §04, §05).
 *
 * Uc bicim vardir; secimi `commission` PARAMETRESI belirler:
 *   1) tek cagri, komisyon yok  -> `execute(to,value,data)`   (bugunku transfer yolu, DEGISMEZ)
 *   2) cok cagri, komisyon yok  -> `executeBatch([...])`
 *   3) komisyon > 0             -> `executeBatch([komisyon, ...cagrilar])`  — YALNIZ 'local'
 *
 * KOMISYON YALNIZ 'local' BOLGEDE OP'A GIRER. Spoke zincirlerde komisyon zaten BSC
 * tahsilatinin icindedir; oraya bir transfer eklemek CIFT ODEME olur (§02 notu). Bu yuzden
 * `commission` cagirana birakilmaz: bolge karari BURADA, tek yerde uygulanir.
 *
 * (1) bilincli: komisyonsuz tek cagriyi batch'e sarmak bugunku transfer callData'sini
 * degistirirdi. Degisiklik zararsiz gorunur ama olculmemistir — ve makbuz (settlement)
 * kimligi callData'ya baglidir, yani surum atlayan bir cuzdanda bekleyen makbuzlar sessizce
 * eslesmez olurdu.
 *
 * `commission` CAGIRANDAN gelir ve MESRU TEK KAYNAGI, bu callData ile yapilan /quote'un
 * `commissionAts` alanidir. Buraya /status'un budget.commissionAts'ini gecirmek SESSIZ ASIRI
 * ODEMEDIR: /status op'a bakmaz, backend komisyonsuz op'ta itiraz etmez, kullanici ekranda
 * hicbir iz gormeden oder. Cagirandaki tohum (bkz. commissionSeedFor) yalnizca TUR SAYISI
 * optimizasyonudur; dogrulugu sendOneOp'un mutabakat kapisi saglar.
 */
export function buildOpCallData({ calls, commission = 0n, treasury, ats, region = 'local' }) {
  const list = (calls || []).filter(Boolean)
  if (list.length === 0) throw new Error('buildOpCallData: en az bir cagri gerekli')
  const amount = region === 'local' ? BigInt(commission || 0n) : 0n
  if (amount > 0n) {
    return buildCommissionBatchCallData({ ats, treasury, commission: amount, calls: list })
  }
  return list.length === 1 ? buildTransferCallData(list[0]) : buildBatchCallData(list)
}

/**
 * Batch'in callGasLimit'i. Cagrilar TEK TEK olculup toplanir; tek bir birlesik estimateGas
 * MUMKUN DEGIL, cunku ikinci cagri birincinin etkisine bagimlidir (approve olmadan swap
 * revert eder ve tahmin patlar).
 *
 * Sarmalayici ek maliyeti cagri BASINA eklenir (estimateCallGas zaten ekliyor); toplamin
 * uzerine ayrica bir sey konmaz — buildGasParams'in %25 marji batch'in dizi kod-cozme
 * maliyetini kapsar.
 *
 * Olculemeyen cagri sabit yedege duser (estimateCallGas'in kendi davranisi); batch'te bu
 * fazla butceleme demektir ama capraz-zincirde bile kullanilmayan gaz IADE EDILIR — eksik
 * butceleme ise op'u zincirde out-of-gas ile oldururdu.
 */
export async function estimateBatchCallGas({ provider, from, calls }) {
  const list = (calls || []).filter(Boolean)
  if (list.length === 0) return CALL_GAS_FALLBACK
  const each = await Promise.all(list.map((call) => estimateCallGas({ provider, from, call })))
  return each.reduce((a, b) => a + b, 0n)
}

// `execute(to,value,data)` sarmalayicisinin ek maliyeti. Ic cagriyi tek basina olcmek
// (eth_estimateGas dogrudan hedefe gider) hesabin CALL + calldata kopyalama maliyetini
// KACIRIR; marj bunu her zaman kapatmaz (21000'lik bir transferde %25 = 5250 < gercek fark).
export const EXECUTE_OVERHEAD_GAS = 15000n
const CALL_GAS_FALLBACK = 200000n

// eth_estimateGas bir ISLEMIN toplam maliyetini doner ve buna 21.000'lik ICSEL (intrinsic)
// islem maliyeti DAHILDIR. callGasLimit ise EntryPoint'in hesaptan hedefe yaptigi ic CALL'un
// butcesidir; icsel maliyet ORAYA GIRMEZ (o, relayer'in disaridaki type-4 islemi icin bir kez
// odenir). Cikarmazsak her op ~21k fazla butcelenir ve capraz-zincirde bu fazlanin IADESI
// YOKTUR — dogrudan kullanicinin cebinden cikar.
const INTRINSIC_TX_GAS = 21000n

// Bos (EIP-161: kodu yok, nonce'u 0, bakiyesi 0) bir adrese DEGER gonderen CALL, EVM'de 25.000
// gazlik "yeni hesap" ucreti oder. eth_estimateGas bu ucreti GORMEZ: ust duzey bir islemde
// alicinin hesabi 21.000'lik icsel maliyetin icinde acilir. Op'ta ise gonderim hesabin
// execute(...)'unun ICINDEKI CALL'dur ve ucret callGasLimit'ten duser.
//
// GERCEK VAKA (2026-10-01, Arbitrum): ilk kez kullanilan bir adrese ETH. Tahmin 22.804
// (Arbitrum L1 payini tahmine katar) -> 1.804 + 15.000 = 16.804, %25 marjla 21.005. Zincir
// durumunda olculen ihtiyac 37.401 (ayni tutar kullanilmis bir adrese 12.401 — fark tam
// 25.000). Ic cagri gazsiz kaldi, op success=false indi; capraz-zincir ucreti BSC'de zaten
// tahsil edilmisti (iade yolu yok). Tahminin tam 21.000 geldigi aglarda (BSC, Polygon) cikarma
// yapilmadigi icin kalan pay acigi ortuyordu — hata yalniz tahmine L1 payi katan aglarda cikti.
export const NEW_ACCOUNT_GAS = 25000n

// Okunamazsa BOS sayilir: fazladan 25.000 gaz kucuk bir iadesiz maliyettir; eksik butce ise
// op'u zincirde dusurur ve ucreti yakar.
async function isEmptyAccount(provider, address) {
  try {
    const [code, nonce, balance] = await Promise.all([
      provider.getCode(address),
      provider.getTransactionCount(address),
      provider.getBalance(address),
    ])
    return (!code || code === '0x') && BigInt(nonce) === 0n && BigInt(balance) === 0n
  } catch {
    return true
  }
}

// Is kurali ihlalleri GECICI DEGILDIR: ayni istek yeniden gonderildiginde ayni cevabi verir.
// `permanent` bayragi sendOneOp'un yeniden denemesini KAPATIR. Onemi para: BSC'de bootstrap
// hakki adres basina 3'tur (belge 11) ve /sponsor cagrisi (yani hak) hata FIRLATILMADAN ONCE
// tuketilmis olur — anlamsiz bir tekrar deneme ikinci hakki da yakar.
function permanentError(message) {
  const err = new Error(message)
  err.permanent = true
  return err
}

// Sifir-native hesapta `from` verilen bir estimateGas bazi RPC'lerde "insufficient funds"
// doner — ozelligin butun amaci o hesabi calistirmak oldugu icin bu bir HATA DEGIL, bir
// RPC kisitidir. Once from ile (en dogru), sonra from suz, en son sabit yedekle dene.
export async function estimateCallGas({ provider, from, call, fallback = CALL_GAS_FALLBACK }) {
  // Onboarding tazelemesinde cagri yoktur; yedek sabit yeterlidir (ucret yalniz ekran icin).
  if (!call || !call.to) return fallback
  const tx = {
    to: call.to,
    value: call.value ? BigInt(call.value) : 0n,
    data: call.data && call.data !== '0x' ? call.data : '0x',
  }
  // Tahminden icsel maliyeti DUS, sonra execute(...) sarmalayicisinin ek maliyetini ekle
  // (bkz. INTRINSIC_TX_GAS ve EXECUTE_OVERHEAD_GAS). Tahmin 21.000'in altindaysa (bazi
  // L2'lerde ya da tuhaf uclarda olabilir) cikarma yapilmaz: negatife dusmek limiti sifirlar
  // ve op zincirde out-of-gas ile REVERT eder.
  // Deger tasiyan cagrida alicinin bos olup olmadigi tahminle PARALEL okunur (bkz.
  // NEW_ACCOUNT_GAS); deger yoksa (token transferi) hic okunmaz. Yedek sabit zaten yeter.
  const newAccount = tx.value > 0n ? isEmptyAccount(provider, call.to) : Promise.resolve(false)
  const callGas = async (e) =>
    (e > INTRINSIC_TX_GAS ? e - INTRINSIC_TX_GAS : e) + EXECUTE_OVERHEAD_GAS +
    ((await newAccount) ? NEW_ACCOUNT_GAS : 0n)
  try { return await callGas(BigInt(await provider.estimateGas({ ...tx, from }))) } catch { /* asagi */ }
  try { return await callGas(BigInt(await provider.estimateGas(tx))) } catch { /* asagi */ }
  console.warn('[ats] estimateGas basarisiz; yedek callGas kullaniliyor')
  return fallback
}

// ZINCIRIN KENDI ONERDIGI FIYAT TABANDIR — 2026-08-10'da BSC'de olculdu.
//
// Odenen gercek fiyat: min(maxFeePerGas, baseFee + priorityFee). BSC'de **baseFee = 0**,
// yani fiyatin TAMAMINI priorityFee tasir. Ayrica BSC 1559'u desteklemedigi icin ethers
// `maxPriorityFeePerGas` alanini **null** doner. Iki sifir carpisinca:
//
//   maxFeePerGas = baseFee(0) * 2 + priority(0) = 0   -> odenen fiyat 0
//
// BSC validator minimumu 0.05 gwei, yani bu op HICBIR KOSULDA kazilamaz: mempool'a girer,
// tutunamaz, dusr. Zincire hicbir sey inmez ama /sponsor cagrisi BASARILI oldugu icin her
// deneme bir bootstrap hakki yakar. Onboarding'in tam da BSC'de olmesinin sebebi buydu;
// baseFee > 0 olan diger dokuz agda ayni formul calisiyordu.
//
// Zincir dogru fiyati ZATEN soyluyor: `eth_gasPrice` = 0.05 gwei. Eski kod onu yalnizca
// `baseFeePerGas` **null** iken yedek olarak okuyordu; BSC'de o alan VAR ama sifir oldugu
// icin yedek hic devreye girmiyordu. Artik taban olarak kullaniliyor.
//
// Diger aglar ETKILENMEZ: orada gasPrice ~ baseFee + priority oldugu icin taban olculen
// priority'nin altinda kalir ve hicbir sey degismez.
export function resolveGasPrice({ baseFeePerGas, priorityFeePerGas, gasPrice }) {
  const base = BigInt(baseFeePerGas || 0n)
  const measured = BigInt(priorityFeePerGas || 0n)
  const suggested = BigInt(gasPrice || 0n)
  // Zincirin onerdigi fiyati karsilamak icin priority'nin tasimasi gereken pay.
  const minPriority = suggested > base ? suggested - base : 0n
  const priority = measured > minPriority ? measured : minPriority
  // Fiyat yine de sifirsa op kazilamaz. SESSIZCE gondermek /sponsor'u cagirir, bootstrap
  // hakkini yakar ve kullaniciya hicbir sey olmamis gibi gorunur — gorunur sekilde dur.
  if (base + priority === 0n) {
    throw new Error('zincirin gaz fiyati okunamadi (0) — op kazilamaz, gonderilmedi')
  }
  return { baseFeePerGas: base, priorityFeePerGas: priority }
}

// Backend'in bootstrap dogrulayicisinin dayattigi callGasLimit TABANI. Sunucunun kendi
// gerekcesi (2026-08-10, canli): "bootstrap: gas.callGasLimit cok dusuk (en az 60000 olmali)
// — aksi halde approve gazdan revert edebilir ve postOp tahsilat basarisiz olurken paymaster
// deposit'i yine de bosalir".
//
// Bizim dinamik tahminimiz bir approve icin bu tabanin ALTINDA kalir ve op /sponsor'da
// REDDEDILIR: olculen ~46.000 - 21.000 icsel + 15.000 sarmalayici = 40.000, +%25 marj = 50.000.
// Taban SON degere uygulanir (marjdan sonra); marjdan once uygulamak 75.000 verirdi ve
// capraz-zincirde aradaki farkin IADESI YOKTUR.
export const MIN_BOOTSTRAP_CALL_GAS = 60000n

// Alti gaz alanini ve gaz fiyatini kurar. `crosschain` ZINCIRDEN turer, /status'un
// mode'undan DEGIL (bkz. atsConfig.isCrosschainCollection): tahsilat 56 disindaki her agda
// BSC'deki toplayici uzerinden yapilir ve remote paymaster'in postOp'u YOKTUR.
//
// `minCallGas`: sunucunun dayattigi taban (bkz. MIN_BOOTSTRAP_CALL_GAS). Varsayilani 0 —
// tabani kosulsuz uygulamak her op'un callGasLimit'ini sisirir ve capraz-zincirde bu iadesiz
// odemedir; yalnizca sunucunun gercekten istedigi op'lara verilir.
//
// `calls` (cogul) verilirse batch olarak olculur; `call` (tekil) bugunku transfer yolu icin
// KORUNUR. Ikisi birden verilirse `calls` kazanir.
export async function buildAtsGasParams({ provider, from, call, calls, crosschain, minCallGas = 0n }) {
  const [callGas, feeData, block] = await Promise.all([
    Array.isArray(calls) && calls.length > 0
      ? estimateBatchCallGas({ provider, from, calls })
      : estimateCallGas({ provider, from, call }),
    provider.getFeeData(),
    provider.getBlock('latest'),
  ])
  // baseFee'yi BLOKTAN oku: feeData.maxFeePerGas saglayiciya gore zaten carpanli gelir ve
  // uzerine bir 2x daha koymak capraz-zincirde dogrudan kullanicidan cikar.
  const { baseFeePerGas, priorityFeePerGas } = resolveGasPrice({
    baseFeePerGas: block?.baseFeePerGas != null ? block.baseFeePerGas : feeData.gasPrice,
    priorityFeePerGas: feeData.maxPriorityFeePerGas,
    gasPrice: feeData.gasPrice,
  })
  const gas = buildGasParams({ callGas, baseFeePerGas, priorityFeePerGas, crosschain: !!crosschain }, 25)
  if (minCallGas && gas.callGasLimit < BigInt(minCallGas)) gas.callGasLimit = BigInt(minCallGas)
  return { gas, maxPriorityFeePerGas: priorityFeePerGas }
}

// viem signAuthorization ciktisi JSON-safe DEGIL: fazladan `v` (BigInt) alani JSON.stringify'i
// PATLATIR ("Do not know how to serialize a BigInt") -> istek backend'e HIC ulasmaz. Backend
// (server/authorization.ts assertAuthorizationShape) TAM su 6 alani bekler; `v` atilir,
// chainId/nonce/yParity number'a normalize edilir. yParity=0 gecerli deger oldugu icin `??`
// (|| DEGIL); yParity yoksa v'den turetilir (27/28 -> 0/1).
export function toBackendAuthorization(raw) {
  return {
    address: raw.address,
    chainId: Number(raw.chainId),
    nonce: Number(raw.nonce),
    yParity: Number(raw.yParity ?? (Number(raw.v) - 27)),
    r: raw.r,
    s: raw.s,
  }
}

// relay yanitindaki success TX seviyesindedir ve op basarisiz olsa bile true donebilir.
// Kesin sonuc EntryPoint'in UserOperationEvent log'undadir. Bulunamazsa null = BILINMIYOR.
export function extractUserOpSuccess(receipt, entryPointAddress, userOpHash) {
  const logs = (receipt && receipt.logs) || []
  const hit = logs.find((l) =>
    l && String(l.address).toLowerCase() === String(entryPointAddress).toLowerCase() &&
    l.topics && l.topics[0] === USER_OP_EVENT_TOPIC &&
    (!userOpHash || String(l.topics[1]).toLowerCase() === String(userOpHash).toLowerCase()))
  if (!hit) return null
  try {
    const [, success] = ethers.AbiCoder.defaultAbiCoder()
      .decode(['uint256', 'bool', 'uint256', 'uint256'], hit.data)
    return Boolean(success)
  } catch { return null }
}

// Backend'in dondurdugu paymaster, YAPILANDIRILMIS adresler kumesinde olmali.
//
// Belge "cuzdan her zaman sunucunun dondurdugu paymaster'i kullansin" diyor; biz bunu bir
// ALLOWLIST'e ceviriyoruz. Gerekce: bootstrap approve'u paymaster'a SINIRSIZ izin verir.
// Adresi kosulsuz backend'den almak o kontrolu kendi kendini dogrulayan bir tautolojiye
// cevirirdi. Allowlist hem zincire/moda gore degisen adresleri (belge 02) hem de guvenligi
// karsilar. Kume /health ile tazelenebilir (_resetPaymasterAllowlist + bir sonraki cagri).
export function assertPaymasterAllowed({ sponsorPaymaster, paymasterAndDataPrefix, allowed }) {
  const list = (allowed || []).filter(Boolean).map((a) => String(a).toLowerCase())
  const pm = String(sponsorPaymaster || '').toLowerCase()
  if (!pm || !list.includes(pm)) {
    throw permanentError(`sponsor paymaster adresi izinli kumede degil (${sponsorPaymaster})`)
  }
  // Imzali 52 byte'in ILK 20'si asil yetkilidir; JSON alani ile ayrisirsa imza baska bir
  // paymaster'a aittir ve approve yanlis spender'a gitmis olur.
  const prefixPm = typeof paymasterAndDataPrefix === 'string'
    ? paymasterAndDataPrefix.slice(0, 42).toLowerCase() : ''
  if (prefixPm !== pm) {
    throw permanentError(`paymasterAndDataPrefix icindeki paymaster sponsor alaniyla uyusmuyor (${prefixPm} != ${pm})`)
  }
}

// Backend'in /sponsor yanitindaki mod, cagiranin BEKLEDIGI modla celismemeli.
//
// Yalnizca TEK yon olumcul: normal/crosschain beklenirken backend bootstrap donerse, gonderilen
// callData kullanicinin GERCEK transferiyken backend onu bir kurulum (approve) op'u saniyor ve
// oyle fiyatlayip imzaliyor — sessiz bir uyusmazlik (eski assertSponsorConsistent'in kaldirdigi
// kontrol). Ters yon (bootstrap beklenirken backend normal/baska bir sey donmesi) olumcul
// DEGIL: allowance/delegasyon arada olusmus olabilir — yalniz loglanir, gonderim durdurulmaz.
export function assertSponsorModeConsistent({ expectedMode, sponsorMode }) {
  if (!sponsorMode) return // alan hic gelmediyse kontrol edilecek bir sey yok
  if (expectedMode === 'bootstrap') {
    if (sponsorMode !== expectedMode) {
      console.warn(`[ats] beklenen mod bootstrap ama sponsor "${sponsorMode}" dondu (yok sayildi)`)
    }
    return
  }
  if (sponsorMode === 'bootstrap') {
    throw permanentError(`backend bootstrap istiyor; ${expectedMode} op'u gonderilemez`)
  }
}

// Zincir basina izinli paymaster kumesi. Gomulu tablo TABANDIR; /health ulasilabiliyorsa
// uzerine eklenir (fail-static: /health duserse gomulu tablo gecerli kalir).
//
// HEDEF ZINCIRDE IKI PAYMASTER ROLU VAR ve kume ikisini de tanimali:
//   - `ATSPaymaster`       -> same-chain (normal/bootstrap) op'lari sponsorlar
//   - `ATSRemotePaymaster` -> CAPRAZ-ZINCIR op'larini sponsorlar; AYRI kontrat, AYRI adres
// `/health` bugun yalnizca birincisini donuyor. Ikincisi eksik kalinca capraz-zincir op'u
// `sponsor paymaster adresi izinli kumede degil` ile reddediliyordu (2026-08-10, chainId 1) —
// yani ozelligin ASIL yolu, tam da onboarding bittikten sonra kapaliydi.
//
// `/health`in ileride `remotePaymaster` alanini eklemesi de destekleniyor: geldigi an
// gomulu tablo doldurulmadan tum zincirlerde calisir.
const allowlistCache = new Map()
export async function paymasterAllowlist({ client, chainId, configured, remote }) {
  const key = Number(chainId)
  if (allowlistCache.has(key)) return allowlistCache.get(key)
  const set = new Set([configured, remote].filter(Boolean))
  try {
    const health = await client.health()
    for (const c of health.chains || []) {
      if (Number(c.chainId) !== key) continue
      if (c.paymaster) set.add(c.paymaster)
      if (c.remotePaymaster) set.add(c.remotePaymaster)
    }
  } catch { /* fail-static: gomulu adres yeterli */ }
  const list = [...set]
  allowlistCache.set(key, list)
  return list
}
export const _resetPaymasterAllowlist = () => allowlistCache.clear()

// runSponsoredOp'un bekledigi WalletSigner. Ham anahtar SDK'ya girmez; iki metot yeter.
export function makeEthersSigner({ wallet, privateKey }) {
  return {
    address: wallet.address,
    // HAM digest imzasi — EIP-191 sarmasi YOK. Simple7702Account ECDSA.recover ile dogrular.
    signDigest: async (digest) => wallet.signingKey.sign(digest).serialized,
    signAuthorization: async ({ chainId, delegate, nonce }) => {
      const owner = privateKeyToAccount(privateKey)
      return toBackendAuthorization(await owner.signAuthorization({
        address: delegate, chainId: Number(chainId), nonce,
      }))
    },
    // CAPRAZ-ZINCIR UCRET YETKISI (K12) — EIP-712. Sunucu ethers verifyTypedData ile dogrular;
    // viem ayni hash'i uretir (sdk/flow.test.js gercek anahtarla dogruluyor). Ham hash'i
    // personal_sign/EIP-191 ile imzalamak `xc-fee-auth-invalid` alirdi.
    signTypedData: async (typedData) => privateKeyToAccount(privateKey).signTypedData(typedData),
  }
}

// Onay ile gonderim arasinda gaz fiyati oynayabilir; ama kullanicinin onayladigindan
// belirgin fazlasi cekilmemeli.
//
// approvedFee = 0 "sifir onaylandi" DEGILDIR, "bu op fiyatlanmadi"dir: quoteAtsTransfer
// bootstrap gerekmiyorken bootstrapFee: 0 dondurur. Onu gecerli bir sinir sayarsak her
// pozitif ucret 0 * 1.25 = 0'i asar ve op KOSULSUZ patlar — quote ile gonderim arasinda
// delegasyon iptal edilip bootstrap gerekli hale geldiginde tam olarak bu olur.
//
// `approvedCommission` ZORUNLU BIR PARCADIR, susleme degil (2026-08-20 canli hatasi):
// /quote'un `atsFee`'si YALNIZ gaz ucretidir ve komisyonu AYRI alanda verir; ama /sponsor'un
// `atsFee`'si TAHSIL EDILECEK TUTARDIR ve spoke zincirde komisyon onun ICINDEDIR (o bolgede
// komisyon op'a girmez, BSC tahsilatina girer). Ikisi ayni tavana vurulunca komisyon acilir
// acilmaz her spoke swap'i patladi: Polygon'da komisyon ucretin tam yarisi oldugu icin oran
// her seferinde 1.5x cikiyordu. Tavan, kullanicinin EKRANDA GORDUGU sayiyla ayni olmali —
// kart zaten ucret + komisyon toplamini gosteriyor.
//
// Tolerans YALNIZ ucrete uygulanir: 1.25x GAZ OYNAMASI icin vardir. Komisyon operatorun
// sabitidir; %25 buyumesine sessizce izin vermek, kullanicinin onaylamadigi bir tutari
// tahsil etmek olurdu.
export function assertQuoteWithinApproval({ freshFee, approvedFee, approvedCommission = 0 }) {
  if (approvedFee == null) return
  const approved = Number(approvedFee)
  if (!Number.isFinite(approved) || approved <= 0) return
  const commission = Number(approvedCommission)
  const ceiling = approved * QUOTE_DRIFT_TOLERANCE +
    (Number.isFinite(commission) && commission > 0 ? commission : 0)
  if (Number(freshFee) > ceiling) {
    // GERCEK tavan yazilir. Eski mesaj `approvedFee`'yi yaziyordu ama karsilastirma
    // `approvedFee * 1.25` ileydi; teshiste sahte bir "tam 1.5x" oruntusu uretip gercek
    // payi gizliyordu.
    throw permanentError(`ATS ucreti onaylanan tutari asti (${freshFee} > ${ceiling})`)
  }
}

// Op'un DOGRUDAN ATS harcamasi (ATS-wei): ATS token'ina giden transfer'ler ve kaynagi
// gonderenin kendisi olan transferFrom'lar. Backend op2'yi TAM OLARAK bununla siniflandirir
// (paymaster server/validate.ts atsSpendOf: `balance >= ucret + harcama`); kapi ayni soruyu
// sormali — fazlasini saymak calisan gonderimi durdurur, eksigini saymak kapiyi kor eder.
// Router'in cektigi ATS (swap) burada da backend'de de SAYILMAZ; onu maxAtsSellRaw tavani korur.
// Cozulemeyen cagri 0 sayilir: kapi en iyi cabadir, son soz backend'indir.
export function atsSpendOfCalls({ calls, ats, sender }) {
  const token = String(ats || '').toLowerCase()
  const me = String(sender || '').toLowerCase()
  let spend = 0n
  for (const c of calls || []) {
    if (!c || String(c.to || '').toLowerCase() !== token || !c.data) continue
    try {
      const tx = ATS_SPEND_IFACE.parseTransaction({ data: c.data })
      if (!tx) continue
      if (tx.name === 'transfer') spend += tx.args[1]
      else if (tx.name === 'transferFrom' && String(tx.args[0]).toLowerCase() === me) spend += tx.args[2]
    } catch { /* ATS'ye giden baska bir cagri (approve vb.) ya da bozuk veri: harcama degil */ }
  }
  return spend
}

// BOOTSTRAP BUTCE KAPISI. Bootstrap'ta op1 (approve + 7702) ONCE iner ve ODENIR; op2'nin
// (asil transfer) bakiyesi ancak SONRA sorulur. Ekran bakiyeyi transfer + op1 ucretiyle
// olcer (op1 tabansiz atsFeeBootstrap). Ikisinin arasinda ucret yukselirse (keeper setRate,
// gaz fiyati) op1 odenir ve op2 'balance-missing' ile duser: kurulum yapilmis, transfer
// gonderilmemis olur. Eski 2x hesap bunu farkinda olmadan ~bir tam ucret payiyla
// ortuyordu; dogru hesapta pay yok, o yuzden kapi burada.
//
// op1'in TAZE /quote'u iki fiyati birden tasir (ayni paylasilan gazla): `atsFee` op2'nin,
// `atsFeeBootstrap` op1'in. Bakiye op1'den ONCE okunur. Kapi onQuoted'da, yani /sponsor'dan
// ONCE kosar: hicbir sey tahsil edilmez, adres basina 3 olan bootstrap hakki yanmaz.
// Bakiye bilinmiyorsa (RPC dustu) kapi atlanir — kendi altyapi hatasiyla calisan bir
// gonderimi durdurmamali; op2'yi yine backend siniflandirir.
export function assertBootstrapBudget({ quote, balanceRaw, spendRaw = 0n }) {
  if (balanceRaw == null) return
  const fee = BigInt(pickAtsFee(quote, false))
  const boot = BigInt(pickBootstrapFee(quote, { mode: 'bootstrap', crosschain: false, feeRaw: fee.toString() }))
  const need = fee + boot + BigInt(spendRaw || 0n)
  if (BigInt(balanceRaw) < need) {
    const err = permanentError(
      `ATS bakiyesi kurulum + transfer icin yetmiyor (${balanceRaw} < ${need}); islem gonderilmedi`)
    err.code = 'balance-missing'
    throw err
  }
}

const human = (raw, decimals) => Number(ethers.formatUnits(BigInt(raw), decimals))

// --- ekran icin: /status onbellegi + teklif ---

// /paymaster/status HER ISLEMDE CAGRILMAZ: uc 9-10 zincir okumasi yapar (hepsi paralel ama
// yine de gercek maliyet). Ayni onay ekraninda hem teklif hem gonderim ayni cevabi kullansin
// diye kisa omurlu bir onbellek tutulur. TTL 30 sn: kullanicinin onay ekraninda gecirdigi
// suredan uzun, ama onboarding sonrasi bayat cevap dondurecek kadar degil (runOnboarding
// zaten onbellegi bosaltir).
const STATUS_TTL_MS = 30_000
const statusCache = new Map()

export async function readAtsStatus({ client, address, chainId, force = false }) {
  const key = `${Number(chainId)}:${String(address).toLowerCase()}`
  const hit = statusCache.get(key)
  if (!force && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value
  const value = await client.status(address)
  statusCache.set(key, { at: Date.now(), value })
  return value
}
export const _resetAtsStatusCache = () => statusCache.clear()

// Ekran icin: "bu kullanici ne yapabilir" (/status) + "ne kadara" (/quote).
// Ikisi AYRI uctur ve bu bilerek boyledir: /status fiyat dondurseydi iki uc ayni fiyati ayri
// ayri hesaplardi — kacinilan sapmanin ta kendisi (2026-08-08'de %40 fazla fiyat gosterildi).
// `force`: /status onbellegini ATLA. Onboarding oncesi ZORUNLUDUR — adimlarin listesi (ve
// hangi adimin hala gerektigi) 30 sn'lik bayat bir cevaptan okunursa kullanici zaten yapilmis
// bir adimi tekrar gonderir (ve bootstrap hakkini yakar).
//
// `calls` (cogul): swap/bridge gibi COK CAGRILI op'lar icin. Verilmezse tekil `call` kullanilir
// ve bugunku transfer davranisi birebir korunur.
export async function quoteAtsTransfer({ chainId, rpcUrl, address, call, calls, force = false, opKind = 'transfer' }) {
  const cfg = getAtsConfig(chainId)
  if (!cfg) throw new Error('ATS not enabled for chain')

  const client = new GaslessClient({ baseUrl: cfg.backendBase, chainId: Number(chainId) })
  const provider = new ethers.JsonRpcProvider(rpcUrl)

  const status = await readAtsStatus({ client, address, chainId, force })
  const mode = status.mode
  const decision = status.ready ? null : resolveAtsBlocker(status.blocker)

  // Tahsilat capraz-zincir mi? Cevap ZINCIRDEN gelir, /status'un mode'undan DEGIL
  // (bkz. atsConfig.isCrosschainCollection — canli olcum orada).
  const crosschain = isCrosschainCollection(chainId)

  // KOMISYON BOLGESI ve TUTARI (belge "Swap ve Bridge Komisyonu" §02, §04).
  // Bolge /status'un `collection` alanindan okunur — `crosschain` ile AYNI SORU DEGIL:
  // `crosschain` gaz ucretinin nerede tahsil edildigini, `region` komisyonun op'a girip
  // girmeyecegini soyler. Bugun ikisi ayni zincir kuralindan turuyor ama kaynaklari FARKLI
  // ve sunucu birini degistirirse digeri onu izlemek zorunda DEGIL.
  const region = resolveCommissionRegion(status, chainId)
  const { amount: commissionAmount, treasury: commissionTreasury } = readCommission(status)

  const opCalls = (Array.isArray(calls) && calls.length > 0 ? calls : [call]).filter(Boolean)

  // Ekran ve gonderim AYNI callData ile AYNI soruyu sormak zorundadir: aksi halde ekranda
  // gosterilen komisyon ve maxAtsSellRaw tavani, gonderimde kurulan batch ile ayrisir.
  const commissionSeed = commissionSeedFor(opKind, region, commissionAmount)

  const { gas, maxPriorityFeePerGas } = await buildAtsGasParams({
    provider, from: address, call, calls: opCalls, crosschain,
    // Ekran, GONDERILECEK op ile AYNI gazi fiyatlamali: bootstrap'ta sunucu tabani
    // uyguladigi icin gercek callGasLimit daha yuksek olur ve gosterilen ucret eksik kalirdi.
    minCallGas: mode === 'bootstrap' ? MIN_BOOTSTRAP_CALL_GAS : 0n,
  })

  // /quote'a callData da verilir (§03/§04): komisyonlu op'ta kilit callData'ya civilidir ve
  // callData'siz uretilen kilit /sponsor'da commission-quote-required ile reddedilir.
  // Cagri listesi bos olabilir (onboarding tazelemesi) — o durumda callData yoktur.
  let quoteCallData
  if (opCalls.length > 0) {
    try {
      quoteCallData = buildOpCallData({
        calls: opCalls, commission: commissionSeed, treasury: commissionTreasury,
        ats: cfg.token.address, region,
      })
    } catch (e) {
      // Tek gercek dusme yolu: tohum > 0 iken /status'te commissionTreasury yok. Ekran teklifi
      // callData'siz da verilebilir (gonderimde yeniden kurulur) ama SESSIZ kalmamali.
      console.warn('[ats] teklif callData kurulamadi, komisyon /status tahminine duser:', e && e.message)
    }
  }

  // sender ZORUNLU: quoteId fiyat kilidi yalniz sender bilindiginde uretilir.
  const quote = await client.quote(gas, address, quoteCallData)
  if (quote.atsFee == null) throw new Error('paymaster quote missing atsFee')
  const feeRaw = pickAtsFee(quote, crosschain)
  // Bootstrap'ta op1'in (approve + 7702) KENDI fiyati; bootstrap degilse '0'.
  const bootstrapFeeRaw = pickBootstrapFee(quote, { mode, crosschain, feeRaw })

  // KILITLENEN komisyon /quote'tan gelir. Alanin YOKLUGU "komisyonsuz" demektir — AMA YALNIZCA
  // callData GONDERILDIYSE. Gonderilmediyse soru hic sorulmamistir ve /status'un tahminine
  // (muhafazakar taraf) duseriz; 0 saymak tavani sahte olarak yukseltirdi.
  const { amount: lockedCommission } = resolveLockedCommission({
    quoteCommissionAts: quote.commissionAts,
    callDataSent: quoteCallData != null,
    fallback: commissionAmount,
  })

  // ODEME DEVRI (spec §6.5): bu nonce'ta odenmis ama inmemis bir islem bu islemi karsiliyor mu?
  // Yalniz capraz-zincirde ve callData kurulabildiyse. Okunamazsa (nonce RPC'si, depo) ekran
  // bugunku gibi davranir — prepaid null.
  let prepaid = null
  if (crosschain && quoteCallData) {
    try {
      const nonce = await new ethers.Contract(cfg.entryPoint, ENTRY_POINT_ABI, provider).getNonce(address, 0)
      const p = await findPrepaid({
        chainId, sender: address, nonce: String(nonce), callData: quoteCallData,
        requiredRaw: BigInt(feeRaw) + lockedCommission,
      })
      if (p) prepaid = { ...p, atsAmount: human(p.atsAmountRaw, cfg.token.decimals) }
    } catch (e) {
      console.warn('[ats] onceki odeme okunamadi:', e && e.message)
    }
  }

  // Bakiye HER ZAMAN BSC'deki gercek ATS'dir. Hedef zincirlerdeki ATSOFT bakiyeleri
  // gelistirme kalintisidir ve kullaniciya hic acilmaz (belge 01). Kaynak zincirin
  // KENDISINDE budget.srcBalance her zaman "0" doner (belge 05) -> orada zincirden oku.
  let balanceRaw = status.budget?.srcBalance ?? '0'
  if (Number(chainId) === ATS_SRC_CHAIN_ID) {
    const token = new ethers.Contract(cfg.token.address, ERC20_IFACE.fragments, provider)
    balanceRaw = (await token.balanceOf(address)).toString()
  }

  return {
    ready: !!status.ready,
    mode,
    blocker: status.blocker,
    decision,
    delegated: !!status.delegated,
    delegation: status.delegation,
    nextSteps: status.nextSteps || [],
    atsBalance: human(balanceRaw, cfg.token.decimals),
    symbol: cfg.token.symbol,
    tokenAddress: cfg.token.address,
    // PER-OP NORMAL ucret (transfer op'u). Onay siniri (assertQuoteWithinApproval) op basina
    // uygulandigi icin bu alan boyle kalmali; ekranin ve butcenin bakacagi TOPLAM
    // transferFee + bootstrapFee'dir.
    transferFee: human(feeRaw, cfg.token.decimals),
    feeRaw,
    // Bu gonderim KAC op'tur. Bootstrap modunda IKI op gider (once approve, sonra transfer)
    // ve her biri AYRI AYRI tahsil edilir. Ekran/butce op1'i hic saymazsa, bakiyesi tam
    // transfer'e yeten kullaniciya "yeterli" gosterilir: op1 iner ve odenir, op2 bakiye
    // yetersizliginden duser — para gitmis, transfer HIC gonderilmemis olur. Op basina tavan
    // (assertQuoteWithinApproval) bunu yakalayamaz — her op tek basina sinir icinde.
    opCount: mode === 'bootstrap' ? 2 : 1,
    // op1'in ucreti. Normal op'la AYNI DEGIL: backend op1'i tabansiz PATH 2'den fiyatlar
    // (atsFeeBootstrap, ~$0.04). Eskiden op1 de normal fiyattan (x2) sayiliyordu ve BSC'de
    // ekran ~$1 fazla gosteriyordu (canli: 41.74 ATS, gercek ust sinir ~21.76). Bkz.
    // atsFee.pickBootstrapFee — capraz-zincirde ve alan yokken normal fiyata duser.
    bootstrapFee: human(bootstrapFeeRaw, cfg.token.decimals),
    bootstrapFeeRaw,
    isCrosschain: crosschain,
    // Kart "en fazla" diyebilir mi? Yalniz ayni zincirde ve ucret minChargeAts tabaninin
    // USTUNDEYSE: tabandaki ucret postOp'ta da tabanda kalir, iade SIFIRDIR. Taban ONCE /quote'un
    // kendi yanitindan (ucretle ayni okuma); eski backend onu dondurmezse /status'un 30 sn
    // onbellekli degerine duser — orada keeper arada tabani YUKSELTTIYSE niteleyici yanlislikla
    // gorunebilir (DUSURDUYSE guvenli tarafta kalir).
    feeRefundable: atsFeeRefundable({
      crosschain, feeRaw, minChargeAts: quote.minChargeAts ?? status.budget?.minChargeAts,
    }),

    // --- swap/bridge komisyonu (belge "Swap ve Bridge Komisyonu") ---
    // 'local' -> komisyon op'un ICINE girer (BSC). 'src' -> op'a HICBIR SEY eklenmez.
    commissionRegion: region,
    // KILITLENEN tutar (ATS-wei, string). Komisyon kapaliyken "0".
    commissionAts: lockedCommission.toString(),
    commissionAtsHuman: human(lockedCommission, cfg.token.decimals),
    // HER teklifte /status'ten TAZE okunur — gomulmez, onbelleklenmez (§06.2).
    commissionTreasury: quote.commissionTreasury || commissionTreasury,
    // §06.1 — ATS SATAN bir swap'a en fazla bu kadar ATS girebilir. Backend BUNU DENETLEMEZ;
    // asilirsa op zincirde AA33 ile duser ve gaz yanar. Cagirani bu tavana uymak zorunda.
    // Komisyon BOLGEDEN BAGIMSIZ olarak BSC'deki ATS'den cikar ('local'de op'un icinde,
    // 'src'de BSC tahsilatinin icinde — §01/§02), bu yuzden her iki bolgede de dusulur.
    maxAtsSellRaw: maxAtsSellAmount({
      balanceRaw,
      feeRaw,
      bootstrapFeeRaw,
      commissionRaw: lockedCommission,
    }).toString(),

    srcAllowance: status.budget?.srcAllowance,
    // Kaynak-zincir izni YALNIZ capraz-zincir yolunda harcanir; suzgec ZINCIRDIR, mod DEGIL.
    // Kaynak zincirin KENDISINDE (56) backend srcAllowance'i her kosulda "0" doner (belge 05),
    // yani suzgecsiz bir needsTopUp BSC'deki HER transferi sahte bir kartla bloklardi. Eskiden
    // suzgec `mode === 'crosschain'` idi ve tam tersi yone kaciriyordu: 2026-08-10'da chainId 1
    // icin backend mode:"bootstrap" + ready:true + srcAllowance:"0" dondu, kontrol HIC kosmadi,
    // ekran yesil gorundu ve op /sponsor'da `src-allowance-missing` ile oldu.
    // Izin TUM op'lar icin yetmeli, tek op icin degil. Bootstrap'ta IKI op gider ve her biri
    // ayri ayri tahsil edilir; yalniz transfer ucretiyle karsilastirmak, izni tek op'a yetip
    // ikisine yetmeyen kullaniciya "yeterli" gosterirdi -> op1 iner ve ODENIR, op2 izin
    // yetmediginden duser: para gitmis, transfer HIC gonderilmemis olur. Bu dal yalniz capraz-
    // zincirde kosar ve orada bootstrapFeeRaw normal fiyattir (pickBootstrapFee) — toplam 2x kalir.
    // KOMISYON DA IZNE SAYILIR: capraz-zincirde BSC'den TEK seferde cekilen tutar ucret +
    // komisyondur (paymaster quote-lock.ts xcCollectAmount) ve /sponsor izni bu TOPLAMLA olcer
    // (crosschain.ts assertSourceFunded -> 'src-allowance-low'). Komisyonsuz transferde 0'dir.
    needsTopUp: crosschain
      && needsBudgetTopUp({
        feeRaw: feeRaw == null ? null : String(BigInt(feeRaw) + BigInt(bootstrapFeeRaw) + lockedCommission),
        srcAllowance: status.budget?.srcAllowance,
      }),
    // ONCEKI ODEME (spec §6.5): null | { kind: 'same'|'carry', atsAmountRaw, atsAmount }.
    // Ekran bunu gorunce butce engellerini (src-*, needsTopUp, yetersiz ATS) bu islem icin kaldirir.
    prepaid,
    gas,
    maxPriorityFeePerGas,
  }
}

// --- tahsilat makbuzunun KALICI deposu ---

// Capraz-zincirde ucret IMZADAN ONCE tahsil edilir (belge 09). Makbuz (settlementId + atsFee)
// yalnizca sendOneOp'un yerel degiskeninde tutulursa, MV3 service worker'inin HERHANGI bir
// await'te sonlandirilmasi odenmis bir ucretin tek kanitini yok eder: kullanici tekrar
// denediginde sunucu yeni bir tahsilat yapar ve ayni op icin IKI KEZ odenir (2026-08-08'de
// tam olarak bu yasandi, 6,9 ATS). Depo bu penceredeki tek savunmadir.
const SETTLEMENT_STORE_KEY = 'ats_pending_settlements'
// Kayit op tamamlanana kadar tutulur (paymaster rehberi: "islem tamamlanana kadar saklayin").
// Makbuz da K12 adaylari da KENDI gazlarini tasir, yani sure gecse de kimlik tutar; sinir yalniz
// birikmeyi onler. 24 saat KISAYDI: nonce ilerlemeden bir gun sonra ayni op yeniden
// gonderilince odenmis makbuz silinmis olurdu ve ucret IKINCI KEZ alinirdi.
const SETTLEMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000

// chrome.storage vitest'in node ortaminda YOKTUR (eklenti disi baglamlarda da olmayabilir).
// Yoksa depo null'dur ve akis eski BELLEK ICI davranisa duser — patlamaz.
// Testler _setAtsSettlementStore ile kendi sahte deposunu enjekte eder.
let settlementStoreOverride
export const _setAtsSettlementStore = (store) => { settlementStoreOverride = store }
function settlementStore() {
  if (settlementStoreOverride !== undefined) return settlementStoreOverride
  try {
    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) {
      return chrome.storage.local
    }
  } catch { /* eklenti disi baglam */ }
  return null
}

// OP KIMLIGI = zincir + gonderen + nonce + callData. Ayni nonce'ta FARKLI bir op (kullanici tutari
// degistirdi, takas yeni rota aldi) KENDI kaydina yazilir. Eskiden tek anahtar paylasiliyordu:
// yeni op'un kesin bir reddi ESKI op'un odenmis makbuzunu siliyor, ayni op sonra yeniden
// gonderilince ucret ikinci kez aliniyordu.
export const settlementRecordKey = ({ chainId, sender, nonce, callData }) =>
  `${Number(chainId)}:${String(sender).toLowerCase()}:${String(nonce)}:${ethers.keccak256(callData || '0x')}`
// Onceki surumun anahtari (callData'siz). Yalniz OKUNUR ve silinir (gecis): kaydin callData'si
// istenen op'la ayniysa.
const legacyRecordKey = ({ chainId, sender, nonce }) =>
  `${Number(chainId)}:${String(sender).toLowerCase()}:${String(nonce)}`

// Gaz alanlari makbuzun KIMLIGINE girer: sunucu settlementId'yi istekten yeniden hesaplar ve
// id nonce'u, callData'yi ve gaz tavanini baglar (belge 09 tablosu). Bir alan bile oynarsa
// settlement-mismatch doner. Onceki surumun kayitlari gazi TASIMIYOR; onlar yalniz parmak izi
// BIREBIR ayni oldugunda yeniden kullanilir.
export function gasFingerprint(gas, maxPriorityFeePerGas) {
  const g = gas || {}
  return [
    g.callGasLimit, g.verificationGasLimit, g.preVerificationGas,
    g.paymasterVerificationGasLimit, g.paymasterPostOpGasLimit, g.maxFeePerGas,
    maxPriorityFeePerGas,
  ].map((v) => String(v ?? '')).join(':')
}

// Gaz alanlari kayda DIZE olarak girer (chrome.storage BigInt tasiyamaz).
const GAS_FIELDS = [
  'callGasLimit', 'verificationGasLimit', 'preVerificationGas',
  'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit', 'maxFeePerGas',
]
const gasToRecord = (gas) => Object.fromEntries(GAS_FIELDS.map((k) => [k, String(gas[k])]))
// Onceki surumun kaydi gazi AYRI tasimiyor; ama gaz izi (gasFingerprint) gazin TAMAMIDIR:
// callGasLimit:verificationGasLimit:preVerificationGas:paymasterVerificationGasLimit:
// paymasterPostOpGasLimit:maxFeePerGas:maxPriorityFeePerGas. Odenmis makbuz o gazla geri
// kurulur — aksi halde gaz fiyati oynayinca eski kayit yok sayilir ve op ikinci kez tahsil edilirdi.
function gasFromKey(gasKey) {
  const parts = String(gasKey || '').split(':')
  if (parts.length !== 7 || !parts.every((x) => /^\d+$/.test(x))) return null
  const n = parts.map((x) => BigInt(x))
  return {
    gas: {
      callGasLimit: n[0], verificationGasLimit: n[1], preVerificationGas: n[2],
      paymasterVerificationGasLimit: n[3], paymasterPostOpGasLimit: n[4], maxFeePerGas: n[5],
    },
    prio: n[6],
  }
}

// Kayittaki gaz -> { gas, prio }; eksik ya da bozuksa null.
function gasFromRecord(rec, prio) {
  if (!rec || prio == null) return null
  try {
    return { gas: Object.fromEntries(GAS_FIELDS.map((k) => [k, BigInt(rec[k])])), prio: BigInt(prio) }
  } catch { return null }
}

// Okunamazsa null — BOS HARITA DEGIL. Bos sanilip yeniden yazilan bir harita, diger op'larin
// odenmis makbuzlarini silerdi (yazanlar okunamayan haritanin uzerine YAZMAZ).
async function readSettlements() {
  const store = settlementStore()
  if (!store) return {}
  try {
    const all = await store.get(SETTLEMENT_STORE_KEY)
    const map = all && all[SETTLEMENT_STORE_KEY]
    return map && typeof map === 'object' ? map : {}
  } catch { return null }
}

// `strict`: yazilamazsa FIRLAT. Ucusa cikacak bir tahsilatin kaydi icin kullanilir — kayitsiz bir
// tahsilat, sonucu kaybolursa geri kazanilamaz.
async function writeSettlements(map, { strict = false } = {}) {
  const store = settlementStore()
  if (!store) return
  try { await store.set({ [SETTLEMENT_STORE_KEY]: map }) } catch (e) { if (strict) throw e }
}

function pruneSettlements(map, now = Date.now()) {
  const out = {}
  for (const [k, v] of Object.entries(map || {})) {
    const at = Number(v && v.savedAt)
    if (Number.isFinite(at) && now - at < SETTLEMENT_TTL_MS) out[k] = v
  }
  return out
}

// Depo TEK bir haritadir (oku-degistir-yaz). Iki yazma ayni anda okursa ikincisi birincinin
// yazdigini EZER — kurulum (atsRunOnboarding) gonderim kuyrugunun DISINDA kosar. Yazmalar bu
// zincirde sira bekler.
let storeQueue = Promise.resolve()
function withStore(fn) {
  const run = storeQueue.then(fn, fn)
  storeQueue = run.catch(() => {})
  return run
}

// BIRLESTIREREK yazar: op'un kaydi makbuzu, K12 adaylarini ve belirsizlik zamanini birlikte
// tasir; birini yazarken digerlerini silmek, belirsiz bir tahsilatin tek izini silmek olurdu.
// `rec` op kimligini (chainId, sender, nonce, callData) icermek ZORUNDA.
export function savePendingSettlement(rec, opts = {}) {
  return withStore(async () => {
    const store = settlementStore()
    if (!store) return
    const okunan = await readSettlements()
    if (okunan === null) {
      if (opts.strict) throw new Error('makbuz deposu okunamadi')
      return
    }
    const map = pruneSettlements(okunan)
    const key = settlementRecordKey(rec)
    map[key] = { ...(map[key] || {}), ...rec, savedAt: Date.now() }
    await writeSettlements(map, opts)
  })
}

// AYNI OP'un kaydi (callData dahil). Onceki surumun anahtarina da bakar: kaydin callData'si
// tutuyorsa o da ayni op'tur.
export async function loadPendingOp({ chainId, sender, nonce, callData }) {
  const map = (await readSettlements()) || {}
  const gecerli = (rec) => !!rec
    && Date.now() - Number(rec.savedAt || 0) < SETTLEMENT_TTL_MS
    && String(rec.callData) === String(callData)
  const rec = map[settlementRecordKey({ chainId, sender, nonce, callData })]
  if (gecerli(rec)) return rec
  const eski = map[legacyRecordKey({ chainId, sender, nonce })]
  return gecerli(eski) ? eski : null
}

// YALNIZ bu op'un kaydini siler; ayni nonce'taki baska bir op'un kaydina DOKUNMAZ.
export function clearPendingSettlement(ref) {
  return withStore(async () => {
    const store = settlementStore()
    if (!store) return
    const okunan = await readSettlements()
    if (okunan === null) return
    const map = pruneSettlements(okunan)
    delete map[settlementRecordKey(ref)]
    const lk = legacyRecordKey(ref)
    if (map[lk] && String(map[lk].callData) === String(ref.callData)) delete map[lk]
    await writeSettlements(map)
  })
}

// --- ODEME DEVRI (spec docs/superpowers/specs/2026-10-01-xc-odeme-devri-design.md) ---
//
// Capraz-zincirde ucret islemden ONCE tahsil edilir ve makbuz kimligi TEK bir islemin
// callData'sina civilidir. Islem inmeden kullanici AYNI nonce'ta FARKLI bir islem baslatirsa
// (takas yeniden fiyatlandi, tutar degisti) eski odeme bosa giderdi. Sunucu (paymaster
// server/xc-carry.ts) ayni (sender, hedef zincir, nonce) icin odenmis bir kimligi yeni isleme
// sayar; cuzdan o kimlikleri buradan toplar.

// Sunucunun bakacagi en fazla oge (paymaster MAX_CARRY_ENTRIES ile ayni).
export const CARRY_MAX_ENTRIES = 4

// paymaster server/userop.ts maxCostOf'un AYNISI: makbuz kimligi bu tavani baglar; bir birim
// sapma baska bir kimlik demektir ve devir sessizce kullanilamaz.
export function maxCostOfGas(g) {
  return (BigInt(g.verificationGasLimit) + BigInt(g.callGasLimit) + BigInt(g.preVerificationGas)
    + BigInt(g.paymasterVerificationGasLimit) + BigInt(g.paymasterPostOpGasLimit)) * BigInt(g.maxFeePerGas)
}

// Ayni chainId:sender:nonce'taki TUM kayitlar (eski callData'siz anahtar dahil), suresi dolmamis.
// Depo okunamazsa BOS liste: devir bir kolayliktir, okunamayan depo gonderimi durdurmamali.
async function recordsAtNonce(ref) {
  const map = (await readSettlements()) || {}
  const legacy = legacyRecordKey(ref)
  const now = Date.now()
  return Object.entries(map)
    .filter(([k, v]) => (k === legacy || k.startsWith(`${legacy}:`))
      && v && now - Number(v.savedAt || 0) < SETTLEMENT_TTL_MS)
    .map(([, v]) => v)
}

const byAmountDesc = (a, b) => {
  const x = BigInt(a.atsAmount)
  const y = BigInt(b.atsAmount)
  if (x === y) return 0
  return x > y ? -1 : 1
}

// Ayni nonce'taki BASKA islemlerin devredilebilir odemeleri ve ucustaki belirsiz deneme.
//   list       : once ONAYLI makbuzlar (sunucu "odendi" dedi), sonra K12 adaylari (belki
//                odendi — sunucu zincirden bakar); her grup tutara gore buyukten kucuge; kimlige
//                gore tekil; en fazla CARRY_MAX_ENTRIES.
//   inFlightAt : onayli makbuzu OLMAYAN bir kaydin uncertainAt'i XC_PENDING_WAIT_MS'ten yeniyse o
//                an. O istek sunucuda hala isleniyor olabilir; gec tahsil edilirse yeni islemin
//                tahsilatiyla CIFT odeme olur (spec §6.4). Onayli makbuz varsa sonuc bellidir.
export async function carryCandidatesFor({ chainId, sender, nonce, callData }) {
  const recs = (await recordsAtNonce({ chainId, sender, nonce }))
    .filter((r) => r.callData && String(r.callData) !== String(callData))
  const now = Date.now()
  const confirmed = []
  const pending = []
  let inFlightAt = null
  for (const r of recs) {
    const callDataHash = ethers.keccak256(r.callData)
    const at = Number(r.uncertainAt || 0)
    if (!r.settlementId && at && now - at < XC_PENDING_WAIT_MS) inFlightAt = Math.max(inFlightAt || 0, at)
    if (r.settlementId && r.atsFee) {
      const g = gasFromRecord(r.settlementGas, r.settlementPrio) || gasFromKey(r.gasKey)
      if (g) {
        confirmed.push({
          id: String(r.settlementId), atsAmount: String(r.atsFee), callDataHash,
          maxCostCap: maxCostOfGas(g.gas).toString(),
        })
      }
    }
    for (const c of Array.isArray(r.candidates) ? r.candidates : []) {
      const g = c && c.id && c.atsAmount != null ? gasFromRecord(c.gas, c.maxPriorityFeePerGas) : null
      if (g) {
        pending.push({
          id: String(c.id), atsAmount: String(c.atsAmount), callDataHash,
          maxCostCap: maxCostOfGas(g.gas).toString(),
        })
      }
    }
  }
  const seen = new Set()
  const list = [...confirmed.sort(byAmountDesc), ...pending.sort(byAmountDesc)]
    .filter((e) => {
      const k = e.id.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, CARRY_MAX_ENTRIES)
  return { list, inFlightAt }
}

// Islem zincire indi (basarili YA DA basarisiz): nonce tuketildi, o nonce'taki HICBIR kayit artik
// kullanilamaz — devir adaylari dahil. Hepsi silinir. Okunamayan depo YAZILMAZ: bos sanilip
// yazilan bir harita diger nonce'larin odenmis makbuzlarini silerdi.
export function clearPendingNonce(ref) {
  return withStore(async () => {
    const store = settlementStore()
    if (!store) return
    const okunan = await readSettlements()
    if (okunan === null) return
    const map = pruneSettlements(okunan)
    const legacy = legacyRecordKey(ref)
    for (const k of Object.keys(map)) {
      if (k === legacy || k.startsWith(`${legacy}:`)) delete map[k]
    }
    await writeSettlements(map)
  })
}

// Ekran 'carry' sozunu yalniz PAYLA verir (son inceleme, onemli #3): gonderimde teklif YENIDEN
// alinir ve gaz ya da kur ekrandakinden yuksek cikabilir; sunucu odemeyi yalniz o anki TAM tutara
// yetiyorsa sayar (paymaster xc-carry.ts), yetmezse ucret ikinci kez alinir. Pay, cuzdanin
// ekran->gonderim sapma toleransidir. Devir listesi gonderimde payli/paysiz HER durumda gider.
const CARRY_SCREEN_MARGIN_PCT = BigInt(Math.round(QUOTE_DRIFT_TOLERANCE * 100))

// Ekran icin (spec §6.5): bu nonce'ta ODENMIS (onayli makbuzlu) ama inmemis bir islem var mi?
//   ayni callData  -> 'same'  (makbuz yolu; her zaman yeter)
//   baska callData -> 'carry' (yalniz tutar bu islemin tam tutarini — ucret + komisyon — PAYLA
//                              karsiliyorsa; bkz. CARRY_SCREEN_MARGIN_PCT)
// K12 adaylari SAYILMAZ: odenip odenmedikleri bilinmiyor; ekran olmayan bir odemeyi vaat etmesin.
export async function findPrepaid({ chainId, sender, nonce, callData, requiredRaw }) {
  const recs = await recordsAtNonce({ chainId, sender, nonce })
  let best = null
  for (const r of recs) {
    if (!r.settlementId || !r.atsFee || !r.callData) continue
    let amount
    try { amount = BigInt(r.atsFee) } catch { continue }
    const same = String(r.callData) === String(callData)
    if (!same && amount * 100n < BigInt(requiredRaw) * CARRY_SCREEN_MARGIN_PCT) continue
    const kind = same ? 'same' : 'carry'
    if (!best || (kind === 'same' && best.kind !== 'same') || (kind === best.kind && amount > best.amount)) {
      best = { kind, amount }
    }
  }
  return best ? { kind: best.kind, atsAmountRaw: best.amount.toString() } : null
}

// --- capraz-zincir ucret yetkisi (K12): yeniden deneme kurallari ---
//
// Paymaster rehberi docs/cuzdan-xc-ucret-yetkisi-gecis.md "Yeniden deneme". Capraz-zincirde
// ucret /sponsor SIRASINDA BSC'den cekilir; makbuz kimligi imzalanan mesajin alti alanindan
// turer. Ayni yetkinin tekrari ayni kimligi uretir (collector ikinci kez cekmez); YENI bir
// /quote + yeni imza ise kur oynadiysa YENI bir kimlik = ikinci tahsilat demektir ve iade
// yolu yoktur. /sponsor hatasi bu yuzden once PARA DURUMUNA gore siniflanir:
//   'rejected'     A — kesin red, ucret cekilmedi: bir kez taze teklif + yeni imza
//   'format'       imza kodlamasi bozuk (istemci hatasi): yeniden DENENMEZ
//   'rate-limited' 429: ucret cekilmedi, AYNI istek kisa bir beklemeden sonra
//   'uncertain'    B — ucret cekilmis olabilir: once ayni govde, sonra makbuz; yeni imza YOK
//   'unpaid' / 'mismatch' — makbuz sorgusunun cevaplari
//   'blocked'      kodlu engel (src-*, remote-not-ready ...): tahsilattan ONCE — ama YALNIZ
//                  op'un ilk B'siz denemesinde. B'den sonra ayni kodlar "odenmis olabilir" demektir
//                  (sunucu bakiye/izni "zaten odendi" kontrolunden ONCE yoklar).
const XC_REJECTED_CODES = new Set([
  'xc-fee-auth-required', 'xc-fee-auth-invalid', 'quote-lock-required', 'quote-lock-stale',
])
// Kodsuz gelen kesin redler (sunucu bunlari yalniz metinle bildiriyor).
const XC_REJECTED_TEXT =
  /quoteId has expired|quoteId was issued for different gas parameters|quoteId was issued for a different sender|quoteId signature is invalid/i

export function classifyXcSponsorError(e) {
  const code = e && e.code
  const status = e && e.status
  const message = String((e && e.message) || '')
  if (code === 'xc-fee-auth-format') return 'format'
  if (XC_REJECTED_CODES.has(code)) return 'rejected'
  if (code === 'settlement-unpaid') return 'unpaid'
  if (code === 'settlement-mismatch') return 'mismatch'
  if (code === 'rate-limited' || status === 429) return 'rate-limited'
  if (!code && XC_REJECTED_TEXT.test(message)) return 'rejected'
  // BSC islemi yayinlanmis olabilir — rehberin acikca B saydigi kodsuz metin.
  if (!code && /collection on the source chain failed/i.test(message)) return 'uncertain'
  // Yanit yok (ag hatasi, zaman asimi) ya da 5xx: sunucu tahsil edip cevabi kaybetmis olabilir.
  if (typeof status !== 'number' || status >= 500) return 'uncertain'
  if (code) return 'blocked'
  // Kodsuz ve taninmayan bir cevap (2xx ama JSON degil, bilinmeyen 4xx metni): para durumu
  // BILINMIYOR. Guvenli taraf B: en kotu ihtimalle kullanici birkac dakika bekletilir; ters
  // taraf ikinci bir tahsilattir.
  return 'uncertain'
}

// Odenmemis makbuzdan sonra yeni bir teklif icin beklenecek sure (rehber B.2: "B grubuna dusen
// son /sponsor denemesinin baslangicindan en az 5 dakika"). Sunucuda islenmekte olan eski
// bir istek bu pencere icinde hala tahsil edebilir; erken yeni teklif ikinci tahsilat olur.
export const XC_PENDING_WAIT_MS = 5 * 60 * 1000

// 429'dan sonra ayni istekten once beklenecek sure (Retry-After istemciye tasinmiyor).
let xcRateLimitWaitMs = 1500
export const _setXcRateLimitWait = (ms) => { xcRateLimitWaitMs = ms }

// Ucret yetkisinin ALANI (domain) ve TIPLERI sabittir: imza YALNIZ BSC'deki gercek ATSGasCollector
// icin gecerli olmali. sdk/flow.ts op alanlarini (sender, nonce, zincir, callData) denetler; burasi
// eklentinin BILDIGI sabitleri: baska bir zincir/kontrat icin atilmis bir yetki kullanicinin
// adina baska bir yerde kullanilabilirdi. Tip listesi degisirse (sunucu bicimi degisti) imza
// atilmaz — istemci bilinmeyen bir seyi imzalamaz.
const XC_FEE_AUTH_TYPES =
  'dstChainId:uint256,sender:address,nonce:uint256,callDataHash:bytes32,maxCostCap:uint256,atsAmount:uint256,deadline:uint64'
export function assertFeeAuthDomain(fa) {
  const bad = (what) => {
    const err = new Error(`feeAuth bu op'a ait degil: ${what} uyusmuyor — imzalanmadi`)
    err.code = 'xc-fee-auth-mismatch'
    throw err
  }
  const d = (fa && fa.domain) || {}
  if (Number(d.chainId) !== ATS_SRC_CHAIN_ID) bad('domain.chainId')
  if (String(d.verifyingContract || '').toLowerCase() !== ATS_COLLECTOR.toLowerCase()) bad('domain.verifyingContract')
  if (String(d.version) !== '1') bad('domain.version')
  const types = (fa && fa.types) || {}
  const fields = (types.XcFeeAuth || []).map((f) => `${f && f.name}:${f && f.type}`).join(',')
  if (Object.keys(types).length !== 1 || fields !== XC_FEE_AUTH_TYPES) bad('types')
}

function xcFeePendingError(cause) {
  const err = permanentError(
    'onceki denemenin ucreti henuz dogrulanamadi: birkac dakika sonra tekrar deneyin ' +
    '(ayni islem icin ucret IKINCI KEZ alinmaz)')
  err.code = 'xc-fee-pending'
  if (cause) err.cause = cause
  return err
}

// --- gonderim ---

const RELAY_RETRY_LIMIT = 1   // makbuzlu YENIDEN DENEME en fazla bir kez

// KOMISYON yeniden denemesi AYRI bir butcedir (belge "Swap ve Bridge Komisyonu" §07):
// dort komisyon kodunun HICBIRINDE tahsilat yapilmamistir, yani bu denemeler kullaniciya
// para maliyeti tasimaz ve makbuzlu denemenin butcesini yemeleri icin bir sebep yok.
// BIR ile sinirli: kalici bir yapilandirma uyusmazliginda (ornegin cuzdanin okudugu hazine
// ile sunucununki farkli) sinirsiz donmek /sponsor'u tekrar tekrar cagirir ve BSC bootstrap'inda
// adres basina 3 olan hakki yakardi.
const COMMISSION_RETRY_LIMIT = 1

// Bir op'un tam yasam dongusu: runSponsoredOp (sira kilitli) + makbuz dogrulamasi + tek
// makbuzlu yeniden deneme + tek komisyon yeniden kurmasi.
//
// `rebuildCallData(commissionAts) -> callData`: YALNIZ komisyonlu BSC op'larinda verilir.
// `commission-missing` geldiginde batch, sunucunun mesajindaki BEKLENEN tutarla yeniden
// kurulur. Verilmezse (transfer/onboarding op'lari) o kod normal hata yoluna gider.
async function sendOneOp({
  client, provider, signer, entryPoint, cfg, gas, maxPriorityFeePerGas, chainId,
  callData, delegated, approvedFee, approvedCommission = 0, kind, crosschain, expectedMode, onRelayed, rebuildCallData,
  // `commissionPlanLeft`: /quote kaynakli (PLANLI) yeniden kurma butcesi. VARSAYILANI 0 —
  // bootstrap ve onboarding cagrilari bunu gecmez, dolayisiyla o op'larda planli gecis KURULMAZ
  // ve beklenmedik bir komisyon istegi /sponsor'a VARMADAN durur (bootstrap hakki korunur).
  commissionBuilt = 0n, commissionRegion = 'local', commissionPlanLeft = 0,
  // YALNIZ bootstrap op1'inde: { balanceRaw, spendRaw } — bkz. assertBootstrapBudget.
  bootstrapBudget = null,
}) {
  // Nonce DONGU BOYUNCA SABITTIR (const). ERC-4337'de key-0 nonce'u YALNIZCA o sender'a ait
  // bir userOp CALISTIGINDA ilerler; yani "nonce degisti" tek anlama gelir: op zincire indi.
  // Denemeler arasinda tazelemek tam da bu sinyali okuyup COPE atardi ve n+1 ile yeniden
  // gondermek kullanicinin transferini IKINCI KEZ calistirirdi (deger iki kez, ucret iki kez).
  // Ayni nonce ile tekrar denemek ise guvenlidir: op zaten indiyse EntryPoint AA25 ile reddeder.
  const nonce = await entryPoint.getNonce(signer.address, 0)
  // 'pending' SART: authorization'in nonce'u, relayer'in type-4 tx'i uygulandigi andaki hesap
  // nonce'u ile ESIT olmali. 'latest' okunursa bekleyen bir islem authorization'i gecersiz kilar.
  const txCount = delegated ? undefined : await provider.getTransactionCount(signer.address, 'pending')
  const allowed = await paymasterAllowlist({
    client, chainId, configured: cfg.paymaster, remote: cfg.remotePaymaster,
  })

  const opRef = { chainId: Number(chainId), sender: signer.address, nonce: String(nonce) }
  // Op kimligi callData'yi de icerir; komisyon yeniden kurmasi callData'yi degistirirse kayit da
  // YENI kimlige gecer (eski op'un kaydina dokunulmaz).
  const opKey = () => ({ ...opRef, callData })
  const gasKey = gasFingerprint(gas, maxPriorityFeePerGas)
  // AYNI OP'UN ONCEKI DENEMESI (bu calismada ya da onceki bir worker omrunde).
  const onceki = await loadPendingOp(opKey())
  // Onaylanmis makbuz (C) KENDI gaziyla sunulur: kimlik gaz tavanini baglar ve kullanici sonra
  // tekrar denediginde gaz tahmini degismis olabilir — aksi halde odenmis makbuz hic sunulmaz ve
  // ayni op IKINCI KEZ tahsil edilir. Onceki surumun kaydinda gaz, gaz izinden geri kurulur.
  let settlement = null
  let settlementGas = null   // { gas, prio } | null = bu denemenin gazi
  if (onceki && onceki.settlementId && onceki.atsFee) {
    const kayitliGaz = gasFromRecord(onceki.settlementGas, onceki.settlementPrio) || gasFromKey(onceki.gasKey)
    if (kayitliGaz) {
      settlement = { id: onceki.settlementId, atsAmount: onceki.atsFee }
      settlementGas = kayitliGaz
    }
  }
  // K12: bu op icin imzalanmis her ucret yetkisi — makbuz kimligi, tutari ve TAHSIL EDILECEGI gaz.
  let candidates = onceki && Array.isArray(onceki.candidates)
    ? onceki.candidates.filter((c) => c && c.id && c.atsAmount != null && gasFromRecord(c.gas, c.maxPriorityFeePerGas))
    : []
  // Son imzali /sponsor denemesinin baslangici — sonucu bilinmiyorsa dolu ("ucusta" ya da B).
  let uncertainAt = onceki && onceki.uncertainAt ? Number(onceki.uncertainAt) : null
  // Bu op bir B donemi yasadi: adaylari op tamamlanana kadar TUTULUR ve her yeni imzadan once
  // makbuzla sorulur (gec tahsil edilmis olabilirler).
  // Onceki bir calismadan kalan "ucusta" isareti de B'dir: o istegin sonucu hic ogrenilmedi
  // (worker yaniti beklerken oldu). Sunucu onu gec tahsil etmis olabilir.
  let bEpisode = !!(onceki && (onceki.bEpisode || onceki.uncertainAt))
  let receiptQueue = !settlement && (uncertainAt || bEpisode) && candidates.length ? [...candidates] : null
  // ODEME DEVRI (spec §6.2, §6.4): ayni nonce'taki BASKA islemlerin odemeleri. Yalniz
  // capraz-zincirde: BSC'de ucret postOp'ta, islem inerse alinir — devredilecek bir sey yok.
  // Liste ve ucustaki deneme her TAZE imzali denemeden ONCE yeniden okunur (dongu basi).
  let devir = { list: [], inFlightAt: null }
  // Ucretin cekilmedigi KESIN olan bir sonla biterken: B donemi yasamamis bir op'un kaydi silinir;
  // yasamissa adaylar KALIR, yalniz "ucusta" isareti kalkar.
  const abandonIfClean = async () => {
    if (uncertainAt || settlement) return
    if (bEpisode) await savePendingSettlement({ ...opKey(), uncertainAt: null })
    else await clearPendingSettlement(opKey())
  }
  // ONCEKI denemenin FIYAT KILIDI. Yeniden denemede taze bir /quote almak, belge 09'un
  // "ayni quoteId -> ayni ucret -> ayni settlementId -> ikinci tahsilat YOK" garantisini
  // bozar: kur arada tiklerse id degisir, settled[id] eslesmez ve ucret IKINCI KEZ alinir.
  // Gaz alanlari deneme boyunca DEGISMEZ (gas bir kez, sendOneOp'a girmeden kurulur), bu
  // yuzden kilidin bagladigi gaz karmasi da tutar.
  let quoteId
  let lastError
  // Iki AYRI butce: makbuzlu (ag hatasi) deneme ve komisyon yeniden kurmasi. Tek sayacta
  // birlestirmek, bedelsiz bir komisyon duzeltmesinin gercek bir ag hatasi icin ayrilmis
  // hakki yemesi demekti.
  let relayRetriesLeft = RELAY_RETRY_LIMIT
  let commissionRetriesLeft = COMMISSION_RETRY_LIMIT
  // UCUNCU BUTCE: /quote kaynakli duzeltme YALNIZCA bir /quote harcar (tahsilat yok, bootstrap
  // hakki yanmaz); /sponsor kaynakli duzeltme BSC'de adres basina 3 olan haktan birini yakar.
  // Farkli fiyat -> farkli butce. Tek sayacta birlestirmek, her komisyonlu swap'in gercek bir
  // commission-missing payini PESINEN yakmasi demekti.
  let commissionPlan = Number(commissionPlanLeft || 0)
  // Batch'in KURULDUGU komisyon tutari. /quote'un kilitledigi tutarla karsilastirilir (asagi).
  let builtCommission = BigInt(commissionBuilt || 0n)
  // K12 butceleri. Kilit ile imza BIRLIKTE tasinir: ayni govdenin tekrari (B.1) ikisini de
  // aynen gondermek zorunda, aksi halde imzasiz ya da baska bir tahsilatin istegi olur.
  let feeAuthSignature
  let freshLeft = 1          // A: bir kez taze teklif + yeni imza
  let sameBodyLeft = 1       // B.1: bir kez ayni govde
  let rateLimitedLeft = 1    // 429: bir kez ayni istek
  for (;;) {
    let sponsorRes = null
    // Bu denemenin TURU — hata yolunun karari buna gore verilir.
    const receipt = !settlement && receiptQueue && receiptQueue.length ? receiptQueue[0] : null
    const sameBody = !settlement && !receipt && !!quoteId && !!feeAuthSignature
    // §6.4 — her TAZE imzali denemeden ONCE: ilk deneme de, kendi makbuz sorgusu ya da kesin red
    // sonrasindaki taze deneme de. Ayni nonce'ta 5 dakikadan yeni, sonucu belirsiz BASKA bir
    // deneme varsa yeni tahsilat BASLATILMAZ: o istek sunucuda hala isleniyor olabilir ve gec
    // tahsil edilirse bu islemin tahsilatiyla CIFT odeme olur (son inceleme, onemli #2). Makbuz
    // sorgusu ve ayni govdenin tekrari yeni tahsilat baslatmaz; onlara dokunulmaz.
    if (crosschain && !settlement && !receipt && !quoteId) {
      devir = await carryCandidatesFor(opKey())
      if (devir.inFlightAt) throw xcFeePendingError()
    }
    let signedNow = false        // bu denemede yeni bir yetki imzalandi ve /sponsor'a gidiliyor
    let quoteHadFeeAuth = false  // teklif yetki istedi (imzaya varilamadiysa kilit kullanilamaz)
    let sponsorStartedAt = null  // imzali /sponsor isteginin baslangici (B'nin 5 dk saati)
    // Istek bir makbuz tasiyor mu (onaylanmis ya da sorgu)? Oyleyse yanit YENI bir tahsilat degildir.
    const makbuzla = !!(settlement || receipt)
    // Makbuz ve aday TAHSIL EDILDIKLERI gazla sunulur; taze deneme bu cagrinin taze gaziyla.
    const denemeGazi = (settlement && settlementGas)
      || (receipt && gasFromRecord(receipt.gas, receipt.maxPriorityFeePerGas))
      || { gas, prio: maxPriorityFeePerGas }
    try {
      const r = await runSponsoredOp({
        client, chainId: Number(chainId), signer, callData, nonce,
        gas: denemeGazi.gas, maxPriorityFeePerGas: denemeGazi.prio,
        delegated, txCount,
        ...(settlement ? { settlement } : receipt ? { settlement: { id: receipt.id, atsAmount: receipt.atsAmount } } : {}),
        ...(quoteId && !receipt ? { quoteId } : {}),
        ...(sameBody ? { feeAuthSignature } : {}),
        // ODEME DEVRI: liste yalniz bu op'un KENDI makbuzu ya da aday sorgusu yokken gider (taze
        // deneme ya da B.1 ayni govde). Her zamanki K12 imzasi da gider: devri tanimayan eski
        // sunucu istegi bugunku gibi normal tahsil eder (spec §5.4).
        ...(!settlement && !receipt && devir.list.length ? { carry: devir.list } : {}),
        // Karsilastirma AYNI ALAN uzerinden yapilmali: mod crosschain ise iki taraf da
        // atsFeeCrosschain, degilse iki taraf da atsFee. Farkli alanlari karsilastirmak
        // sabit ~%40'lik bir sapma uretir ve HER islemi reddettirir.
        onQuoted: (q) => {
          // Teklif ucret yetkisi istiyor (K12): bu kilit ancak IMZASIYLA birlikte kullanilabilir.
          quoteHadFeeAuth = !!q.feeAuth
          // Kilidi SAKLA: bir sonraki deneme bunu yeniden kullanacak (bkz. yukaridaki not).
          quoteId = q.quoteId
          const feeRaw = pickAtsFee(q, crosschain)
          assertQuoteWithinApproval({
            freshFee: human(feeRaw, cfg.token.decimals), approvedFee, approvedCommission,
          })

          // §04 3. ADIM — PROAKTIF KOMISYON MUTABAKATI.
          //
          // Batch bir TOHUM ile kurulur (bkz. commissionSeedFor); KILITLENEN tutar ise
          // /quote'un `commissionAts`'idir ve TEK OTORITE odur. Ikisi iki yone de ayrisabilir:
          // tohum eksik kalmis olabilir (keeper tam o anda `setRate` yazdi) ya da FAZLA
          // olabilir (backend bu op turunden komisyon istemiyor — duz transfer, listesiz hedef).
          //
          // Burada yakalamak, /sponsor'un `commission-missing` demesini BEKLEMEKTEN ucuzdur:
          // o yol bir /sponsor cagrisi daha harcar ve BSC bootstrap'inda bu, adres basina 3
          // ile sinirli hakkin birini yakar. Hatayi ayni KODLA firlatiyoruz ki asagidaki
          // (test edilmis) yeniden kurma yolu aynen kossun.
          // GONDERIM YOLUNDA /quote HER ZAMAN callData ile cagrilir (flow.ts) — bu yuzden
          // alanin YOKLUGU burada TEK anlama gelir: backend bu op'tan komisyon ISTEMIYOR.
          // Kapi IKI YONLU olmak zorunda: eskiden yalniz `q.commissionAts != null` iken
          // kosuyordu ve "batch komisyon tasiyor ama backend istemiyor" hali KOR NOKTAYDI —
          // sessiz asiri odemenin ta kendisi.
          if (commissionRegion === 'local') {
            let locked
            try {
              locked = resolveLockedCommission({
                quoteCommissionAts: q.commissionAts, callDataSent: true,
              }).amount
            } catch (parseErr) {
              // Bozuk sunucu yapilandirmasi GECICI DEGILDIR; yeniden denemek bir tur daha yakar.
              parseErr.permanent = true
              throw parseErr
            }
            if (locked !== builtCommission) {
              const err = new Error(
                `komisyon kilidi batch ile uyusmuyor: beklenen ${locked}, bulunan ${builtCommission}`)
              err.code = 'commission-missing'
              err.expectedCommissionAts = locked.toString()
              // /sponsor kaynakli ayni koddan AYIRT ETMEK icin: butceleri ayiran isaret budur.
              err.fromQuote = true
              throw err
            }
          }

          // Komisyon mutabakatindan SONRA: o kapinin kodu (commission-missing) daha ozguldur.
          if (bootstrapBudget) assertBootstrapBudget({ quote: q, ...bootstrapBudget })
        },
        // K12: imzalanacak tutar BSC'den cekilecek TAM tutardir (gaz + pay + komisyon). Kullanici
        // onay ekraninda bu op'un ucretini onayladi; ayni tavan (res.atsFee kontrolu gibi) burada,
        // IMZADAN ONCE uygulanir. Asilirsa imza atilmaz ve /sponsor'a gidilmez.
        //
        // SON GECERLILIK (deadline) burada BILEREK denetlenmez: imza /quote'tan milisaniyeler
        // sonra atilir ve istemci saati kayiksa her yetki "dolmus" gorunup TUM gonderimleri
        // kilitlerdi. Sure sunucuda denetlenir; dolmussa kodsuz 'quoteId has expired' (A) doner.
        onFeeAuth: (fa) => {
          assertFeeAuthDomain(fa)
          assertQuoteWithinApproval({
            freshFee: human(fa.message.atsAmount, cfg.token.decimals), approvedFee, approvedCommission,
          })
        },
        // YAZ-ONCE: makbuz kimligi /sponsor'dan ONCE depoya girer — "UCUSTA" isaretiyle
        // (uncertainAt = bu denemenin baslangici). Worker yaniti beklerken olurse geride yalniz bu
        // kayit kalir ve bir sonraki deneme onu BELIRSIZ sayar: yeni imza almadan once makbuza
        // sorar. Isaret, sonuc kesinlesince kalkar (basari: kayit silinir; kesin red: asagida).
        onFeeAuthSigned: ({ feeAuth, signature }) => {
          feeAuthSignature = signature
          signedNow = true
          const aday = {
            id: settlementIdOf(feeAuth.message), atsAmount: String(feeAuth.message.atsAmount),
            gas: gasToRecord(denemeGazi.gas), maxPriorityFeePerGas: String(denemeGazi.prio),
          }
          if (!candidates.some((c) => String(c.id).toLowerCase() === aday.id.toLowerCase())) {
            candidates = [...candidates, aday]
          }
        },
        // Imzali bir tahsilat istegi (taze, ayni govde ya da 429 tekrari) ucmadan HEMEN once aday(lar)
        // ve "ucusta" isareti depoya yazilir; isaret BU istegin baslangicidir (B'nin 5 dakikasi
        // buradan sayilir). Worker yanit beklerken olurse geride bu kayit kalir ve bir sonraki
        // deneme onu BELIRSIZ sayar. Yazilamazsa istek GITMEZ: kayitsiz bir tahsilat geri kazanilamaz.
        onBeforeSponsor: async () => {
          if (!signedNow && !sameBody) return
          sponsorStartedAt = Date.now()
          try {
            await savePendingSettlement({ ...opKey(), candidates, uncertainAt: sponsorStartedAt }, { strict: true })
          } catch (storeErr) {
            const err = permanentError('ucret kaydi yazilamadi; tahsilat istegi GONDERILMEDI')
            err.code = 'xc-store-failed'
            err.cause = storeErr
            throw err
          }
        },
        onSponsored: (res) => {
          sponsorRes = res
          // MAKBUZ ONCE YAZILIR, kontroller SONRA kosar. Sunucu /sponsor'a yanit verdiyse
          // capraz-zincirde ucret ZATEN tahsil edilmistir; asagidaki kontrollerden biri
          // firlatsa bile o para gitmistir ve tek geri kazanim yolu makbuzdur. Kontrolden
          // sonra yazmak, tam da paranin gittigi ama op'un gonderilmedigi durumda makbuzu
          // yazmamak olurdu.
          if (res.settlementCarried) {
            // DEVIR: kimlik BASKA bir islemin callData'sina bagli. Bu op'a makbuz olarak YAZILMAZ —
            // makbuz olarak sunulsa sunucu settlement-mismatch derdi. "Ucusta" isareti kalkar: bu
            // istek tahsilat yapmadi. Odemenin asil kaydi (onceki islemin) nonce tuketilene kadar kalir.
            savePendingSettlement({ ...opKey(), uncertainAt: null }).catch(() => { /* bellek ici */ })
          } else if (res.settlementId && res.atsFee) {
            settlement = { id: res.settlementId, atsAmount: res.atsFee }
            // onSponsored SENKRON cagrilir (flow.ts await ETMEZ); yazma best-effort'tur.
            settlementGas = denemeGazi
            savePendingSettlement({
              ...opKey(), gasKey: gasFingerprint(denemeGazi.gas, denemeGazi.prio),
              settlementId: res.settlementId, atsFee: res.atsFee,
              settlementGas: gasToRecord(denemeGazi.gas), settlementPrio: String(denemeGazi.prio),
            }).catch(() => { /* depo yoksa bellek ici davranisa duser */ })
          }
          assertSponsorModeConsistent({ expectedMode, sponsorMode: res.mode })
          assertPaymasterAllowed({
            sponsorPaymaster: res.paymaster,
            paymasterAndDataPrefix: res.paymasterAndDataPrefix,
            allowed,
          })
          // Makbuzla gelen yanit YENI bir tahsilat degildir: onay tavani ilk tahsilatta uygulandi.
          // Fiyat dustukten sonra tekrar uygulamak ODENMIS op'u her denemede kilitler ve ucret
          // kaybolurdu.
          if (res.atsFee != null && !makbuzla && !res.settlementReused) {
            // BURASI PATLIYORDU: res.atsFee TAHSIL EDILECEK tutardir ve spoke zincirde
            // komisyonu ICERIR (bkz. assertQuoteWithinApproval notu).
            assertQuoteWithinApproval({
              freshFee: human(res.atsFee, cfg.token.decimals), approvedFee, approvedCommission,
            })
          }
        },
      })
      if (onRelayed) { try { onRelayed({ txHash: r.txHash, kind }) } catch { /* best-effort */ } }
      const success = await confirmUserOp({ provider, cfg, txHash: r.txHash, userOpHash: r.userOpHash })
      // Op zincire indi (basarili YA DA basarisiz): nonce tuketildi; o nonce'taki TUM kayitlar
      // (devredilen odeme dahil) artik olu (spec §6.3). success null ise sonuc BILINMIYOR —
      // hicbiri silinmez, gerekirse yeniden kullanilabilsin.
      if (success === true || success === false) await clearPendingNonce(opRef)
      return { userOpHash: r.userOpHash, txHash: r.txHash, success }
    } catch (e) {
      lastError = e
      // Hata bir txHash TASIYORSA islem ZINCIRE GITMISTIR (relay basarisiz dedi ya da makbuz
      // dogrulanamadi farketmez) — ayni nonce ile YENIDEN DENEMEK TEHLIKELIDIR (AA25 nonce
      // tekrari ya da CIFT gonderim ihtimali). Hatayi txHash/userOpHash ile OLDUGU GIBI yukari
      // ver; cagiran zincirdeki gercek sonucu bu hash uzerinden sorgulayabilir. Bu, 2026-08-05'teki
      // "makbuz vermeyen RPC" olayinin yanlis-negatif tekrarini ONLER (bkz. controller karari).
      if (e && e.txHash) throw e

      // IS KURALI ihlalleri (mod uyusmazligi, izinsiz paymaster, ucret tavani asimi) GECICI
      // DEGILDIR: ayni istek ayni cevabi verir. Tekrar denemek hicbir seyi duzeltmez ama
      // /sponsor'u BIR KEZ DAHA cagirir — BSC bootstrap'inda bu, adres basina 3 ile sinirli
      // hakkin ikincisini yakar (belge 11).
      //
      // K12: sunucunun imzalatmak istedigi yetki BU op'a ait degil. Tekrar denemek ayni sunucudan
      // ayni seyi ister; kilidi IMZASIZ gondermek ise gecis modunda imzasiz bir tahsilattir.
      if (e && (e.code === 'xc-fee-auth-mismatch' || e.code === 'xc-fee-auth-signature')) {
        await abandonIfClean()
        throw e
      }
      if (e && e.permanent) {
        // /sponsor'a hic varilmadan (orn. tutar onayi) ya da tahsilat oncesi bitti: aday tutulmaz.
        if (!sponsorRes && !receipt && !sameBody) await abandonIfClean()
        throw e
      }

      // --- KOMISYON KODLARI (belge "Swap ve Bridge Komisyonu" §07) ---
      //
      // Dordu de YALNIZ /sponsor'dan doner ve HICBIRINDE TAHSILAT YAPILMAMISTIR. Yani bu
      // yeniden deneme kullaniciya para maliyeti tasimaz ve makbuzlu denemenin butcesinden
      // DUSMEZ (ayri sayac; bkz. COMMISSION_RETRY_LIMIT).
      //
      // Ilk uc kod HER ZINCIRDE dogabilir (komisyon kapisi mod seciminden ONCE calisir), yani
      // bu dal spoke zincirlerde de gereklidir.
      const commissionFix = commissionErrorDecision(e)
      // K12: belirsiz bir denemeden SONRA gelen komisyon kodu "ucret cekilmedi" DEMEK DEGIL —
      // kilidi dusurup yeni teklif + yeni imza almak (kur oynadiysa) ikinci tahsilattir. O hata
      // asagidaki ucret yetkisi kolunda B olarak islenir.
      if (commissionFix && uncertainAt == null) {
        // Komisyon kodlari tahsilattan ONCE doner: bu denemenin "ucusta" isareti kalkar.
        if (sponsorStartedAt != null) await savePendingSettlement({ ...opKey(), uncertainAt: null })
        // Duzeltme BIR KEZ denendi ve ayni kod yine geldi: bu artik gecici bir sapma degil,
        // kalici bir yapilandirma uyusmazligidir (ornegin cuzdanin okudugu hazine ile
        // sunucununki farkli). Genel yeniden deneme koluna DUSURMEK hicbir seyi duzeltmez
        // ama /sponsor'u bir kez daha cagirir — BSC bootstrap'inda bu, adres basina 3 ile
        // sinirli hakkin bir digerini yakar (belge 11). Kodu koruyarak dur.
        // /quote kaynakli duzeltme BEDELSIZDIR (tahsilat yok, bootstrap hakki yanmaz);
        // /sponsor kaynakli olan ise adres basina 3 olan haktan birini ZATEN yakmistir.
        // Farkli fiyat -> farkli butce.
        const planned = e && e.fromQuote === true
        if (planned) {
          if (commissionPlan <= 0) throw e
          commissionPlan--
        } else {
          if (commissionRetriesLeft <= 0) throw e
          commissionRetriesLeft--
        }
        // KILIT callData'YA CIVILIDIR. Dordunde de eldeki quoteId artik kullanilamaz:
        // ya callData'siz uretilmistir (quote-required / lock-missing), ya baska bir
        // callData icindir (calldata-mismatch), ya da batch birazdan DEGISECEKTIR
        // (rebuild-batch). Dusuruyoruz; flow.ts taze kilidi callData ILE alir.
        //
        // §07 "commission-missing'de ikinci /quote gerekmez" burada su anlama gelir: tutari
        // OGRENMEK icin ayri bir tur gerekmiyor (mesaj tasiyor). Kilidin kendisi yine
        // yenilenmeli — aksi halde yeni batch, eski callData icin uretilmis kilide carpar ve
        // bu sefer commission-calldata-mismatch doner (ayni tablonun ucuncu satiri).
        quoteId = undefined
        if (commissionFix.action === 'rebuild-batch') {
          const expected = parseExpectedCommission(e)
          // Tutar cozulemiyorsa UYDURMA. Yanlis bir calls[0] ya ayni hatayi uretir ya da —
          // fazla tutarla — dogrudan kullanici zarari olur (§05: tutar BIREBIR olmali).
          if (expected === null || !rebuildCallData) throw e
          try {
            callData = await rebuildCallData(expected)
          } catch (rebuildErr) {
            // Kod KAYBOLMAMALI: UI Turkce mesaja degil koda bakar (atsBlocker). Yeniden kurma
            // sirasindaki bir hata (ornegin hazine hala yok) orijinal komisyon kodunu gizlerdi.
            if (rebuildErr && !rebuildErr.code) rebuildErr.code = e.code
            throw rebuildErr
          }
          // GELIR-KAYBI UYARISI. Buraya dusmek su demek: op tohum konan bir turden (bugun
          // yalniz swap) ve BSC'de, ama backend komisyon ISTEMEDI. Tek makul aciklama, o
          // router'in backend'in siniflandirma listesinden dusmus olmasidir — komisyon
          // sessizce toplanmaz ve kimse fark etmez.
          //
          // Kosul, ONCEKI yorumun iddia ettigi "backend alani yalniz komisyon cagrisi zaten
          // varken donuyor" arizasini YAPISAL OLARAK yakalayamaz (o evrende locked === built
          // olur ve bu dal hic kosmaz). Yakaladigi sey yukarida yazandir; oyle adlandiriliyor.
          if (expected === 0n && builtCommission > 0n) {
            console.warn('[ats] komisyon BEKLENEN bir op icin backend komisyon ISTEMEDI — router ' +
              'backend listesinden dusmus olabilir (sessiz gelir kaybi)',
              { built: builtCommission.toString(), chainId: Number(chainId) })
          }
          // Yeni tutar artik batch'in KURULDUGU tutardir; guncellemezsek bir sonraki
          // /quote mutabakati eski deger uzerinden kosar ve ayni hatayi uretir.
          builtCommission = expected
          // callData degisti = YENI op kimligi. Eski op'un adaylari yeni op'la ESLESMEZ (kimlik
          // callData'yi baglar); onlar eski op'un kaydinda kalir, burada sifirlanir.
          candidates = []
          bEpisode = false
          uncertainAt = null
          // callData DEGISTI: eldeki makbuz artik BASKA bir op'un makbuzudur, bu op'a
          // uygulanamaz (sunucu settlement-mismatch dondururdu).
          settlement = undefined
        }
        continue
      }

      // --- CAPRAZ-ZINCIR UCRET YETKISI (K12) — /sponsor'un PARA DURUMUNA gore karar ---
      // Yalniz imzali bir /sponsor denemesi, ayni govdenin tekrari ya da makbuz sorgusu buraya
      // girer. sponsorRes doluysa (C: tahsilat basarili, sonra bir sey dustu) asagidaki eski
      // makbuz yolu gecerlidir — orada da YENI imza alinmaz.
      if (!sponsorRes && (signedNow || sameBody || receipt)) {
        const sinif = classifyXcSponsorError(e)

        if (receipt) {
          // B.2 makbuz sorgusu.
          if (sinif === 'unpaid') {
            receiptQueue.shift()
            if (receiptQueue.length) continue
            receiptQueue = null
            // Hicbiri odenmemis. Yeterince beklendiyse (rehber B.2/3) taze teklif — GUNCEL gazla:
            // yeni yetkinin kimligi eskilerden biriyle ayniysa ayni tahsilattir, degilse listeye
            // eklenir. Adaylar KALIR (B donemi).
            if (uncertainAt == null || Date.now() - uncertainAt >= XC_PENDING_WAIT_MS) {
              uncertainAt = null
              await savePendingSettlement({ ...opKey(), candidates, uncertainAt: null, bEpisode })
              quoteId = undefined
              feeAuthSignature = undefined
              continue
            }
            throw xcFeePendingError(e)
          }
          if (sinif === 'mismatch') {
            // Kayitli alanlar ilk istekle birebir ayni olmali; degilse istemci hatasidir.
            // Kayit KALIR: ucret durumu hala belirsiz, yeni teklif ikinci tahsilat olabilir.
            const err = permanentError('makbuz bu islemle eslesmedi (settlement-mismatch); operatore bildirin')
            err.code = 'settlement-mismatch'
            err.cause = e
            throw err
          }
          // Baska bir cevap (ag hatasi, 5xx, 429, remote-not-ready ...): durum hala belirsiz.
          throw xcFeePendingError(e)
        }

        if (sinif === 'format') { await abandonIfClean(); throw e }

        if (sinif === 'rate-limited' && rateLimitedLeft > 0) {
          rateLimitedLeft--
          await new Promise((res) => setTimeout(res, xcRateLimitWaitMs))
          continue                       // AYNI istek: kilit ve imza aynen tekrar gider
        }

        if (sinif === 'uncertain' || uncertainAt != null) {
          // B. Bir kez B'ye dusen op'un sonraki HER hatasi da B'dir (bakiye ilk tahsilattan
          // dusmus olabilir; src-* ya da 'quoteId has expired' bu durumda "odenmedi" DEMEK DEGIL).
          uncertainAt = sponsorStartedAt ?? Date.now()
          bEpisode = true
          await savePendingSettlement({ ...opKey(), candidates, uncertainAt, bEpisode })
          if (sameBodyLeft > 0 && quoteId && feeAuthSignature) {
            sameBodyLeft--
            continue                     // B.1: ayni quoteId + ayni imza
          }
          if (candidates.length) {
            receiptQueue = [...candidates]
            continue                     // B.2: her aday icin makbuz sorgusu
          }
          throw xcFeePendingError(e)
        }

        if (sinif === 'rejected') {
          if (freshLeft > 0) {
            freshLeft--
            quoteId = undefined
            feeAuthSignature = undefined
            // Kesin red: bu denemenin "ucusta" isareti kalkar (aday kalir; tekrar sorulursa
            // odenmemis cikar). Isaret kalsaydi, worker simdi olurse sonraki deneme bosuna
            // 5 dakika bekletilirdi.
            await savePendingSettlement({ ...opKey(), candidates, uncertainAt: null })
            continue                     // A: taze teklif + yeni imza, BIR KEZ
          }
          await abandonIfClean()
          throw e                        // ayni red tekrar: entegrasyon hatasi, tekrar cozmez
        }

        // 'blocked' — ilk B'siz denemede kodlu engel: tahsilattan ONCE reddedildi.
        await abandonIfClean()
        throw e
      }
      // Teklif yetki istedi ama imza/sponsor'a varilamadi (orn. imza hatasi): o kilit imzasiz
      // kullanilamaz — sonraki deneme TAZE teklif alir.
      if (quoteHadFeeAuth && !signedNow) {
        quoteId = undefined
        feeAuthSignature = undefined
      }

      // Buraya yalnizca AG hatasi duser (txHash YOK): quote/sponsor hatasi ya da relay
      // cagrisinin kendisinin (network) reddi.
      //
      // DIKKAT — sponsor yanitina ULASAMAMAK "para gitmedi" DEMEK DEGILDIR: /sponsor sunucuda
      // BASARILI olup yanit tasimada kaybolabilir (baglanti koptu, CDN 504). O durumda
      // onSponsored hic kosmaz, settlementId yakalanamaz ve kalici makbuz da yazilamaz.
      // Tek savunma FIYAT KILIDIDIR: ayni quoteId ile yapilan yeniden deneme ayni ucreti ve
      // ayni settlementId'yi uretir, sunucu settled[id]'yi zincirden gorur ve ikinci kez
      // tahsil etmez (belge 09, katman 1). Bu yuzden `quoteId` denemeler arasinda KORUNUR.
      // Devirli yanit makbuz DEGILDIR (bkz. onSponsored): yeniden deneme ayni govdeyle (carry dahil) gider.
      if (sponsorRes && !sponsorRes.settlementCarried && sponsorRes.settlementId && sponsorRes.atsFee) {
        settlement = { id: sponsorRes.settlementId, atsAmount: sponsorRes.atsFee }
      }
      // Sunucu makbuzu REDDETTIYSE o kayit olu bir kayittir: elde tutmak her denemede ayni
      // reddi uretir ve op 24 saat boyunca takili kalir. Sil ki bir sonraki deneme taze bir
      // fiyat kilidiyle bastan kurabilsin.
      if (e && (e.code === 'settlement-mismatch' || e.code === 'settlement-unpaid')) {
        // Capraz-zincirde rehber C/3: /sponsor BASARILI donmus bir makbuz reddedildiyse YENI teklif
        // alinmaz — bu beklenmeyen bir durumdur, durulur ve kayit KALIR (operator inceler). Kaydi
        // silip devam etmek zamanla taze bir teklife, yani ikinci bir tahsilata varabilirdi
        // (K12 oncesi kayitlar ve imzasiz tahsilatlar dahil).
        if (crosschain) {
          const err = permanentError(`onaylanmis makbuz reddedildi (${e.code}); operatore bildirin`)
          err.code = e.code
          err.cause = e
          throw err
        }
        settlement = undefined
        await clearPendingSettlement(opKey())
      }

      if (relayRetriesLeft <= 0) throw lastError
      relayRetriesLeft--

      // Nonce ILERLEDIYSE op zincire INMISTIR (key-0 nonce'u yalnizca calisan bir op ile
      // artar) — relay yanitini alamamis olmamiz bunu degistirmez. Yeniden gondermek
      // kullanicinin transferini IKINCI KEZ calistirir; DURDUR ve sonucu "dogrulanamadi"
      // olarak bildir. txHash YOK (relay yaniti hic gelmedi) ama userOpHash varsa onu tasi:
      // kullanicinin/cagiranin zincirde arayabilecegi tek tanitici odur.
      const fresh = await entryPoint.getNonce(signer.address, 0)
      if (BigInt(fresh) !== BigInt(nonce)) {
        const err = permanentError(
          'islem sonucu dogrulanamadi: nonce ilerledigi icin op ZINCIRDE CALISMIS olabilir, ' +
          'ayni islem tekrar GONDERILMEDI')
        if (e && e.userOpHash) err.userOpHash = e.userOpHash
        // Orijinal `code`'u TASI: background.js bunu atsBlocker'a veriyor. Dusurursek
        // makine-okunur sebep kaybolur ve kullanici jenerik bir karta duser.
        if (e && e.code) err.code = e.code
        throw err
      }
    }
  }
}

// Kesin sonuc EntryPoint'in UserOperationEvent log'undadir; relay'in kendi success alani
// TX seviyesindedir ve op basarisiz olsa bile true donebilir.
//
// waitForTransaction bazi RPC'lerde (makbuzu ucretli token arkasina alan uclar) zaman asimina
// ugrar; islem zincirde BASARILI olsa bile. O yuzden dusunce dogrudan getTransactionReceipt
// ile bir kez daha bakilir.
export async function confirmUserOp({ provider, cfg, txHash, userOpHash }) {
  let receipt = null
  try {
    receipt = await provider.waitForTransaction(txHash, TX_WAIT_CONFIRMATIONS, TX_WAIT_TIMEOUT_MS)
  } catch { /* asagida yeniden denenir */ }
  if (!receipt) {
    try { receipt = await provider.getTransactionReceipt(txHash) } catch { /* yok */ }
  }
  if (!receipt) {
    const err = new Error(`islem sonucu dogrulanamadi (txHash: ${txHash})`)
    err.txHash = txHash
    err.userOpHash = userOpHash
    throw err
  }
  return extractUserOpSuccess(receipt, cfg.entryPoint, userOpHash)
}

// quoted: quoteAtsTransfer ciktisi. onProgress: ({step,total,kind}). onRelayed: ({txHash,kind}).
//
// `calls` (cogul): swap/bridge gibi COK CAGRILI op'lar. Verilmezse tekil `call` kullanilir ve
// transfer davranisi BIREBIR korunur (tek cagri -> `execute`, batch'e sarilmaz).
export async function executeAtsTransfer({
  privateKey, chainId, rpcUrl, call, calls, quoted, onProgress, onRelayed, opKind = 'transfer',
}) {
  const cfg = getAtsConfig(chainId)
  if (!cfg) throw new Error('ATS not enabled for chain')

  const client = new GaslessClient({ baseUrl: cfg.backendBase, chainId: Number(chainId) })
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)
  const signer = makeEthersSigner({ wallet, privateKey })
  const entryPoint = new ethers.Contract(cfg.entryPoint, ENTRY_POINT_ABI, provider)

  // Modu ve delegasyonu BACKEND soyler; istemci turetmez. Onay ekraninin az once aldigi
  // cevap onbellekte oldugu icin bu genelde ikinci bir RPC turu ACMAZ.
  const status = await readAtsStatus({ client, address: wallet.address, chainId })
  if (!status.ready) {
    const d = resolveAtsBlocker(status.blocker)
    const err = new Error(status.blocker || 'ATS sponsorlugu su an alinamiyor')
    err.code = status.blocker
    err.decision = d
    throw err
  }
  const mode = status.mode

  // Tahsilat zinciri ile hedef zincirdeki sponsorluk sekli AYRI sorulardir: `mode`
  // ikincisini anlatir, bu bayrak birincisini (bkz. atsConfig.isCrosschainCollection).
  const crosschain = isCrosschainCollection(chainId)

  // KOMISYON — belge "Swap ve Bridge Komisyonu" §02/§04/§05.
  //
  // Bolge ve tutar HER GONDERIMDE /status'ten TAZE okunur (§06.2: hazine adresi Safe
  // `setTreasury` ile degisebilen bir YAPILANDIRMADIR). `quoted` ekrandaki teklifi tasir ama
  // komisyon ondan OKUNMAZ: onay ekrani ile gonderim arasinda keeper `setRate` yazmis olabilir
  // ve bayat bir tutar dogrudan commission-missing demektir.
  const region = resolveCommissionRegion(status, chainId)
  const { amount: commissionAmount, treasury: commissionTreasury } = readCommission(status)
  const opCalls = (Array.isArray(calls) && calls.length > 0 ? calls : [call]).filter(Boolean)
  if (opCalls.length === 0) throw new Error('gonderilecek cagri yok')

  const buildMain = (commission, treasury) => buildOpCallData({
    calls: opCalls, commission, treasury, ats: cfg.token.address, region,
  })

  // Batch'i PESINEN komisyonlu kurmak yalnizca komisyonun BEKLENDIGI op turlerinde tur
  // kazandirir; her op'a uygulamak (eski davranis) BSC'deki her duz transfere hazineye giden
  // istenmemis bir ATS transferi ekliyordu.
  const commissionSeed = commissionSeedFor(opKind, region, commissionAmount)

  // `commission-missing` geldiginde batch sunucunun BEKLEDIGI tutarla yeniden kurulur (§07).
  // Yalniz 'local' bolgede anlamlidir — spoke'ta komisyon op'a hic girmez.
  //
  // Hazine adresi elde YOKSA (komisyon /status okunurken KAPALIYDI, arada acildi) /status
  // ZORLA tazelenir: gomulu bir adres kullanmak yerine tek dogru kaynagi yeniden okumak.
  const rebuildCallData = region !== 'local' ? undefined : async (expected) => {
    let treasury = commissionTreasury
    if (!treasury && expected > 0n) {
      const fresh = await readAtsStatus({ client, address: wallet.address, chainId, force: true })
      treasury = readCommission(fresh).treasury
    }
    return buildMain(expected, treasury)
  }

  const { gas, maxPriorityFeePerGas } = await buildAtsGasParams({
    provider, from: wallet.address, call, calls: opCalls, crosschain,
    // Bootstrap akisinda op1 bir approve'dur ve sunucunun tabanina takilir. Gaz iki op
    // arasinda PAYLASILDIGI icin taban ikisine birden uygulanir; transfer op'unun kendi
    // tahmini zaten tabanin ustundeyse bu bir sey degistirmez.
    minCallGas: mode === 'bootstrap' ? MIN_BOOTSTRAP_CALL_GAS : 0n,
  })

  const shared = {
    client, provider, signer, entryPoint, cfg, gas, maxPriorityFeePerGas, chainId,
    delegated: !!status.delegated, onRelayed, expectedMode: mode,
    // Ucret alani op'a gore DEGISMEZ: iki op da ayni zincirde, ayni tahsilat yolunda.
    crosschain,
    // Bolge KARARI TEK YERDE uygulanir — bootstrap op'u da dahil. Gecirilmezse sendOneOp'un
    // 'local' varsayilani kosar ve spoke bir zincirdeki bootstrap op'u (backend chainId 1 icin
    // mode:'bootstrap' donebiliyor — 2026-08-10 canli olayi) komisyonun op'a HIC girmedigi bir
    // bolgede mutabakat kapisini calistirir; planli butcesi de olmadigi icin kurulumu tumden
    // bloke ederdi.
    commissionRegion: region,
  }
  const ops = []

  // IKI-OP akisi YALNIZ bootstrap modunda: hedef zincirde ATS'si var ama izni yok.
  // crosschain'de kurulum BSC'ye tasindigi icin hedef zincirde tek op yeter.
  const total = mode === 'bootstrap' ? 2 : 1
  if (mode === 'bootstrap') {
    // Butce kapisi (assertBootstrapBudget) YALNIZ ayni zincirde: bootstrap bugun yalniz BSC'de
    // olusur ve capraz-zincirde op1 zaten tam capraz-zincir ucretinden (2x) sayiliyor.
    let bootstrapBudget = null
    if (!crosschain) {
      let balanceRaw = null
      try {
        const token = new ethers.Contract(cfg.token.address, ERC20_IFACE.fragments, provider)
        balanceRaw = (await token.balanceOf(wallet.address)).toString()
      } catch (e) {
        console.warn('[ats] bootstrap butce kapisi: bakiye okunamadi, kapi atlaniyor:', e && e.message)
      }
      const spendRaw = atsSpendOfCalls({ calls: opCalls, ats: cfg.token.address, sender: wallet.address })
        + BigInt(commissionSeed || 0n)
      bootstrapBudget = { balanceRaw, spendRaw }
    }
    if (onProgress) onProgress({ step: 1, total, kind: 'bootstrap' })
    const r = await sendOneOp({
      ...shared, callData: buildBootstrapCallData(cfg), kind: 'bootstrap',
      // Tavan BILEREK transfer op'unun (normal) ucretidir, op1'in kendi ucreti DEGIL:
      // onQuoted taze NORMAL ucreti (pickAtsFee) bununla karsilastirir; op1'in ~$0.04'luk
      // ucretini gecirmek her bootstrap gonderimini reddettirirdi. op1'in gercek ust siniri
      // kontrattadir (PATH 2: quoteBootstrapAts, taban yok).
      approvedFee: quoted && quoted.transferFee,
      approvedCommission: quoted && quoted.commissionFee,
      bootstrapBudget,
    })
    ops.push(r)
    if (r.success !== true) throw new Error('kurulum islemi basarisiz; transfer gonderilmedi')
    // Delegasyon op1 ile zincire yazildi.
    shared.delegated = true
  }

  if (onProgress) onProgress({ step: total, total, kind: 'transfer' })
  const r2 = await sendOneOp({
    ...shared,
    callData: buildMain(commissionSeed, commissionTreasury),
    // Komisyon YALNIZ bu op'a takilir. Bootstrap op'u (yukarida) byte duzeyinde kisitlidir:
    // TAM olarak tek approve cagrisi olmak zorunda, ikinci bir cagri eklemek 400 verir.
    rebuildCallData,
    commissionBuilt: commissionSeed,
    commissionRegion: region,
    commissionPlanLeft: commissionPlanFor(opKind, region),
    kind: 'transfer',
    // Transfer op'unun beklenen modu ASLA 'bootstrap' olamaz: bootstrap akisinda kurulum
    // op1'de yapildi, izin artik var ve ikinci op normal yoldan gider. 'bootstrap' vermek
    // kontrolu UYARI koluna dusurur ve spec §4.11'in OLUMCUL saydigi uyusmazligi (transfer
    // op'una backend'in bootstrap donmesi — yani kullanicinin gercek transferini bir kurulum
    // op'u sanip oyle fiyatlamasi/imzalamasi) tam da en cok onemli oldugu op'ta kapatirdi.
    expectedMode: mode === 'bootstrap' ? 'normal' : mode,
    approvedFee: quoted && quoted.transferFee,
    approvedCommission: quoted && quoted.commissionFee,
  })
  ops.push(r2)
  if (r2.success !== true) throw new Error('transfer islemi basarisiz veya sonucu dogrulanamadi')

  return { hash: r2.userOpHash, txHash: r2.txHash, ops }
}

// --- onboarding ---

// Onboarding adiminin BEKLENEN sponsor modu ADIMA GORE degisir; hepsine 'normal' demek
// onboarding'i BASLAMADAN bitirir:
//
//   1. adim (approve-paymaster) TANIM GEREGI bootstrap op'udur — BSC'de paymaster izni
//      henuz YOKTUR (zaten 2. adimin normal olabilmesinin sebebi budur). Backend'in
//      classify'i bu istege 'bootstrap' doner. 'normal' bekleyen assertSponsorModeConsistent
//      FIRLATIR — ustelik /sponsor BASARILI olduktan SONRA, yani acik bir bootstrap imzasi
//      (~5 dk kilit) ve adres basina 3 haktan biri ZATEN harcanmisken (belge 11).
//   2. adim (approve-collector) 1. adimin verdigi izin sayesinde 'normal'dir.
//
// Ters yon zararsizdir: bootstrap beklerken 'normal' gelirse kontrol yalniz uyarir
// (izin/delegasyon arada olusmus olabilir).
function onboardingExpectedMode(op) {
  // Fail-closed: adimin kimligi okunamiyorsa (satici stepsToOps'tan `action`'i dusurmusse)
  // TAHMIN ETME. Yanlis tahminin bedeli sessizce yanan bir bootstrap hakki; burada firlatmak
  // ise HIC /sponsor cagrilmadan, gorunur ve bedelsiz basarisizliktir.
  if (op.action === 'approve-paymaster') return 'bootstrap'
  if (op.action === 'approve-collector') return 'normal'
  throw new Error(`onboarding adiminin action alani taninmiyor: ${op.action}`)
}

// /status'un nextSteps'ini calistirir. Adimlar HER ZAMAN kaynak zincirde (BSC 56) kosar —
// kullanici hangi agda olursa olsun, cunku ucret orada tahsil edilir ve izinler orada verilir.
//
// SIRAYLA kosar, paralel DEGIL: 2. adim (toplayici izni) ucretini pesin alir ve bunu ancak
// 1. adimin verdigi paymaster izni mumkun kilar. Ilk adim duserse ikincisi GONDERILMEZ.
//
// Hicbir adimda native (BNB) gerekmez: her ikisi de sponsorludur.
export async function runAtsOnboarding({ privateKey, address, nextSteps, srcRpcUrl, onProgress }) {
  const cfg = getAtsSourceConfig()
  if (!cfg) throw new Error('ATS kaynak zinciri yapilandirilmamis')

  const ops = stepsToOps(nextSteps || [], cfg.collector)
  // SIFIR ADIMI BASARI SAYMA. Bu fonksiyon YALNIZ "kurulumu baslat" butonundan cagrilir;
  // yani cagrildigi an ekran kullaniciya "kurulum gerekli" demistir. Bos bir adim listesiyle
  // sessizce {steps: []} donmek, butonun HICBIR SEY yapmamasi ve ekranin ayni kalmasi
  // demekti — 2026-08-10'da canlida tam bu yasandi: backend `ready:true` + `nextSteps:[]`
  // donerken kullanici butona basip basip hicbir geri bildirim alamadi.
  //
  // Adimlari burada UYDURMUYORUZ (bkz. sdk/onboarding.ts): hangi adimin gerektigi sunucunun
  // karari ve `approve-collector` icin gereken izin tutari istemcide uretilemez. Yapilacak
  // dogru sey, cikmaz sokagi GORUNUR kilmak.
  if (ops.length === 0) {
    const err = new Error(
      'Sunucu kurulum adimlarini gondermedi (/paymaster/status nextSteps bos). ' +
      'Kurulum baslatilamiyor.')
    err.code = 'onboarding-steps-missing'
    throw err
  }

  // TUM adimlar HIC OP GONDERILMEDEN dogrulanir. Yariya kadar kosup son adimda "bu adim
  // taninmiyor" demek, o ana kadar harcanmis bootstrap haklarini geri getirmez.
  const expectedModes = ops.map((op) => {
    // Adim BASKA bir zincire aitse DUR: asagidaki her sey (client, provider, cfg, entryPoint)
    // KAYNAK zincire gore kurulu. Yok sayip devam etmek, o adimi BSC adresleriyle kodlanmis
    // olarak gonderirdi — yani izni yanlis token/paymaster'a verirdi.
    if (Number(op.chainId) !== ATS_SRC_CHAIN_ID) {
      throw new Error(`onboarding adimi kaynak zincire ait degil (chainId ${op.chainId} != ${ATS_SRC_CHAIN_ID})`)
    }
    return onboardingExpectedMode(op)
  })

  const client = new GaslessClient({ baseUrl: cfg.backendBase, chainId: ATS_SRC_CHAIN_ID })
  const provider = new ethers.JsonRpcProvider(srcRpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)
  // `address` cagiranin ELINDEKI (ornegin /status'u sorguladigi) adres — private key'in
  // turettigi wallet.address ile UYUSMALI. Sessizce yok saymak yerine erken FIRLAT: aksi halde
  // yanlis hesap icin onboarding calisir ve kullaniciya "hazir" gosterilen hesapta hicbir sey
  // degismez (bkz. review: bu parametre daha once hic okunmuyordu).
  if (address && String(address).toLowerCase() !== String(wallet.address).toLowerCase()) {
    throw new Error(`runAtsOnboarding: address parametresi private key'in turettigi adresle uyusmuyor (${address} != ${wallet.address})`)
  }
  const signer = makeEthersSigner({ wallet, privateKey })
  const entryPoint = new ethers.Contract(cfg.entryPoint, ENTRY_POINT_ABI, provider)

  // 7702 delegasyonu ZINCIR BASINADIR: kullanici hedef zincirde delege olsa bile BSC'de
  // olmayabilir. Ilk onboarding op'u gerekirse authorization'i tasir.
  const code = await provider.getCode(wallet.address)
  let delegated = isDelegatedTo(code, cfg.delegate)

  const steps = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (onProgress) onProgress({ step: i + 1, total: ops.length, kind: 'onboarding', label: op.label })
    // Her adim kendi gaz tahminini GERCEK ic cagriyla yapar (approve callData'lari farkli
    // maliyettedir — sinirsiz paymaster izni ile sinirli toplayici izni FARKLI gaz harcar).
    // op.callData = execute(ats, 0, approve(spender, amount)); ic cagriyi (ats + approve
    // verisi) bu callData'dan COZUYORUZ. spender/amount'i burada AYRICA turetmek stepsToOps
    // ile senkron kalmasi gereken bir "ikinci uygulama" yaratirdi (dosyanin basindaki notla
    // ayni gerekce) — decode etmek bunu onler.
    const [innerTo, innerValue, innerData] = EXECUTE_IFACE.decodeFunctionData('execute', op.callData)
    const { gas, maxPriorityFeePerGas } = await buildAtsGasParams({
      provider, from: wallet.address,
      call: { to: innerTo, value: innerValue, data: innerData },
      crosschain: false,   // onboarding op'lari kaynak zincirde, ayni-zincir yolunda kosar
      // Her iki adim da approve; ilki tanim geregi bootstrap op'udur ve sunucunun tabanina
      // takilir. Tabani IKISINE de veriyoruz: ayni-zincirde kullanilmayan gaz IADE edilir
      // (belge: "en fazla; kullanilmayan gaz iade edilir"), yani bedeli yok — ama ikinci
      // adimin da ayni sebeple (approve gazdan revert etmesin) tabanin ustunde olmasi dogru.
      minCallGas: MIN_BOOTSTRAP_CALL_GAS,
    })
    const r = await sendOneOp({
      client, provider, signer, entryPoint, cfg, gas, maxPriorityFeePerGas,
      chainId: ATS_SRC_CHAIN_ID, callData: op.callData, delegated,
      // Onboarding op'lari BSC'de kosar: tahsilat ayni zincirde, capraz-zincir DEGIL.
      approvedFee: null, kind: 'onboarding', crosschain: false,
      expectedMode: expectedModes[i],
    })
    // `!== true` (=== false DEGIL): confirmUserOp eslesen bir UserOperationEvent bulamazsa
    // null doner ve bu BILINMIYOR demektir, basarili degil (handleOps revert etmis ya da hash
    // tutmamis olabilir). Bilinmiyeni basari saymak bir sonraki adimi HIC VERILMEMIS bir izin
    // uzerine gonderir ve bootstrap hakkindan bir tane daha yakar. Dosyadaki diger cikis
    // kontrolleriyle de simetrik.
    if (r.success !== true) throw new Error(`onboarding adimi basarisiz: ${op.label}`)
    delegated = true   // ilk op delegasyonu zincire yazdi
    steps.push({ txHash: r.txHash, label: op.label })
  }
  // ONBELLEGI BOSALT: /status cevabi az once degisti. Bosaltilmazsa ekran TTL boyunca
  // (30 sn) hala "kurulum gerekli" gosterir ve kullanici butona tekrar basar.
  _resetAtsStatusCache()
  return { steps }
}
