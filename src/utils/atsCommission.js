// SWAP/BRIDGE KOMISYONU — saf karar katmani. Belge: "Swap ve Bridge Komisyonu".
//
// Bu dosyada AG YOK, IMZA YOK, ZINCIR YOK. Yalnizca dort soruyu yanitlar:
//   1) Hangi bolgedeyiz?           -> resolveCommissionRegion  (§02)
//   2) Ne kadar komisyon?          -> readCommission           (§01, §04)
//   3) Hata gelince ne yapilir?    -> commissionErrorDecision  (§07)
//   4) ATS satan swap'a ne girer?  -> maxAtsSellAmount         (§06.1)
// Ayrica rota elemesi: routeRequiresNative (§06.3).
//
// NEDEN AYRI DOSYA: bu dort kararin hepsi TEST EDILEBILIR ve hepsi para maliyetli. Gonderim
// koduna gomulu halde ancak canli bir op ile dogrulanabilirlerdi; burada bir birim testi
// yetiyor.
//
// KOMISYON SU AN BACKEND'DE KAPALI (2026-08-17 canli olcum: budget.commissionAts "0",
// commissionTreasury alani hic yok). Bu katmanin tamami 0 komisyonda BUGUNKU davranisi
// birebir uretir; acildiginda kod degisikligi gerekmez.
import { ATS_SRC_CHAIN_ID } from './atsConfig'

// --- 1) bolge (§02) ---------------------------------------------------------------------

/**
 * Komisyon bolgesi: 'local' (BSC — komisyon op'un ICINE) | 'src' (spoke — komisyon BSC
 * tahsilatinin icinde, op'a HICBIR SEY eklenmez).
 *
 * KAYNAK /paymaster/status'un `collection` alanidir, chainId kurali DEGIL. Alan sunucunun
 * kendi yapilandirmasindan gelir; istemcide tutulan bir kural onunla sessizce ayrisabilir ve
 * ayrisma iki yone de para kaybettirir:
 *   - spoke'ta yanlislikla 'local' saymak -> op'a fazladan transfer eklenir = CIFT ODEME
 *   - BSC'de yanlislikla 'src' saymak     -> calls[0] eksik = commission-missing, op gitmez
 *
 * Alan yoksa (eski sunucu) ozelligi kapatmiyoruz: bugunku zincir kuralina duser ve sonuc
 * atsConfig.isCrosschainCollection ile BIREBIR aynidir.
 */
export function resolveCommissionRegion(status, chainId) {
  const c = status && status.collection
  if (c === 'local' || c === 'src') return c
  return Number(chainId) === ATS_SRC_CHAIN_ID ? 'local' : 'src'
}

// --- 2) tutar (§01, §04) ----------------------------------------------------------------

const toBig = (v) => {
  if (v === undefined || v === null || v === '') return null
  try { return BigInt(v) } catch { return null }
}

/**
 * /status'ten batch'i KURMAK icin gereken komisyon + hazine.
 *
 * DIKKAT — BU BIR ON TAHMINDIR, OTORITE DEGIL. /status bir op'a BAKMAZ (callData almaz) ve
 * canli olcumde (2026-08-19) ON ZINCIRIN HEPSINDE ayni degeri doner. Bir op'un komisyon
 * tasiyip tasimayacaginin TEK otoritesi, O op'un callData'si ile yapilan /quote'un
 * `commissionAts` alaninin VARLIGIDIR (bkz. resolveLockedCommission). Buradaki tutar
 * yalnizca (1) hazine adresinin kaynagi ve (2) komisyonlu OLMASI MUHTEMEL op'lar icin bir
 * TOHUM'dur; her op'a uygulamak SESSIZ ASIRI ODEMEDIR.
 *
 * Alan YOKSA 0 doner (komisyon kapali — hata degil). Alan VAR ama cozulemiyorsa FIRLATIR:
 * bozuk bir tutarla kurulan batch /sponsor'da commission-missing verir ve kullanici sebebi
 * gorunmeyen bir hata gorur; burada durmak gorunur ve bedelsizdir.
 */
export function readCommission(status) {
  const b = (status && status.budget) || {}
  const raw = b.commissionAts
  let amount = 0n
  if (raw !== undefined && raw !== null && raw !== '') {
    const parsed = toBig(raw)
    if (parsed === null) throw new Error(`commissionAts cozulemedi: ${String(raw)}`)
    if (parsed < 0n) throw new Error(`commissionAts negatif: ${String(raw)}`)
    amount = parsed
  }
  return { amount, treasury: b.commissionTreasury || undefined }
}

/**
 * BIR OP'UN GERCEK KOMISYONU. TEK OTORITE: o op'un KENDI callData'si ile yapilan /quote'un
 * `commissionAts` alani (canli olcum 2026-08-19: alan yalnizca callData backend'in TANIDIGI
 * bir router'a dokunuyorsa doner; duz transfer ve listesiz hedefte HIC gelmez).
 *
 * `callDataSent` KRITIK — alanin YOKLUGU iki farkli sey demek olabilir:
 *   (a) backend bu op'tan komisyon ISTEMIYOR            -> 0  (callDataSent === true)
 *   (b) /quote'a callData HIC verilmedi (soru sorulmadi) -> cevap yok, `fallback`e duseriz
 * (b)'yi 0 saymak, maxAtsSellRaw tavanini gercekte alinacak tutar kadar YUKSELTIR ve op'u
 * zincirde AA33 ile oldururdu; o yuzden orada muhafazakar davraniriz.
 *
 * Bolge parametresi ALMAZ ve bu bilinclidir: "komisyon op'un ICINE girer mi" (bolgeye bagli,
 * buildOpCallData'nin isi) ile "bu op ne kadar komisyon dogurur" (bolgeden BAGIMSIZ — spoke'ta
 * da BSC'deki ATS bakiyesinden cikar) AYRI sorulardir.
 *
 * FAIL-CLOSED: cozulemez/negatif alan FIRLATIR (readCommission ile ayni davranis).
 */
export function resolveLockedCommission({ quoteCommissionAts, callDataSent, fallback = 0n }) {
  if (quoteCommissionAts !== undefined && quoteCommissionAts !== null && quoteCommissionAts !== '') {
    const parsed = toBig(quoteCommissionAts)
    if (parsed === null) throw new Error(`quote commissionAts cozulemedi: ${String(quoteCommissionAts)}`)
    if (parsed < 0n) throw new Error(`quote commissionAts negatif: ${String(quoteCommissionAts)}`)
    return { amount: parsed, authoritative: true }
  }
  if (callDataSent) return { amount: 0n, authoritative: true }
  return { amount: toBig(fallback) ?? 0n, authoritative: false }
}

// --- 3) hata kodlari (§07) --------------------------------------------------------------

// Dordu de YALNIZ POST /paymaster/sponsor'dan doner ve HICBIRINDE tahsilat yapilmamistir —
// bu yuzden hepsi guvenle yeniden denenebilir (capraz-zincirde bile para gitmemistir).
//
// `localOnly`: ilk uc kod HER ZINCIRDE dogar, cunku komisyon kapisi mod seciminden ONCE
// calisir — spoke zincirde swap yapan bir cuzdan da commission-quote-required alabilir.
// Yalniz commission-missing BSC'ye ozgudur, cunku yalniz orada komisyon op'un icinde
// dogrulanir.
const DECISIONS = {
  'commission-quote-required': {
    action: 'quote-with-calldata', needsRequote: true, localOnly: false, charged: false,
  },
  'commission-lock-missing': {
    action: 'quote-with-calldata', needsRequote: true, localOnly: false, charged: false,
  },
  'commission-calldata-mismatch': {
    action: 'quote-with-calldata', needsRequote: true, localOnly: false, charged: false,
  },
  // Mesaj beklenen VE bulunan tutari tasir; batch yeni tutarla yeniden kurulur ve IKINCI bir
  // /quote turu GEREKMEZ (§07). Gereksiz bir /quote hem gecikme hem de kilidin degismesi
  // demektir.
  'commission-missing': {
    action: 'rebuild-batch', needsRequote: false, localOnly: true, charged: false,
  },
}

export const COMMISSION_ERROR_CODES = Object.freeze(Object.keys(DECISIONS))

/** Komisyonla ilgisiz kodda `null` doner — cagiran kendi hata yoluna (atsBlocker) gitsin. */
export function commissionErrorDecision(err) {
  const code = err && err.code
  if (!code) return null
  return DECISIONS[code] ? { code, ...DECISIONS[code] } : null
}

// `commission-missing` mesajinin BICIMI belgede tanimli DEGIL. Once yapisal alanlara bakilir;
// metin ayristirmasi yalnizca yedektir ve cozemezse null doner — cagiran taze bir /quote
// turuna duser. Fazladan bir gidis-gelis, YANLIS tutarla batch kurmaktan kat kat ucuzdur.
const EXPECTED_PATTERNS = [
  /(?:beklenen|expected)\D{0,20}?(\d+)/i,
]

export function parseExpectedCommission(err) {
  if (!err) return null
  for (const key of ['expectedCommissionAts', 'expectedCommission', 'expected']) {
    const v = toBig(err[key])
    if (v !== null && v >= 0n) return v
  }
  const msg = typeof err.message === 'string' ? err.message : ''
  for (const re of EXPECTED_PATTERNS) {
    const m = msg.match(re)
    if (m) {
      const v = toBig(m[1])
      if (v !== null && v >= 0n) return v
    }
  }
  return null
}

// --- 4) bakiye matematigi (§06.1) -------------------------------------------------------

/**
 * ATS SATAN bir swap'a en fazla ne kadar ATS girebilir.
 *
 *   bakiye - (gaz ucreti x op sayisi) - komisyon
 *
 * BACKEND BUNU DENETLEMEZ. /quote ve /sponsor yalnizca komisyonun dogru tutarda ve dogru
 * sirada oldugunu dogrular; kalan bakiyenin swap'a yettigini DEGIL. Ihlal edilirse op
 * zincirde AA33 ile duser ve gaz yanar — belgenin bu kurali yazdigi tek yer §06.1'dir.
 *
 * `opCount`: bootstrap modunda IKI op gider ve her biri AYRI AYRI ucretlendirilir.
 * Negatife DUSMEZ: 0 doner, cagiran "yetersiz" kartini gosterir.
 */
export function maxAtsSellAmount({ balanceRaw, feeRaw, commissionRaw = 0n, opCount = 1 }) {
  const balance = toBig(balanceRaw) ?? 0n
  const fee = (toBig(feeRaw) ?? 0n) * BigInt(opCount || 1)
  const commission = toBig(commissionRaw) ?? 0n
  const left = balance - fee - commission
  return left > 0n ? left : 0n
}

// --- 5) rota elemesi (§06.3) ------------------------------------------------------------

/**
 * Paymaster gazi oder, `msg.value`'yu ODEMEZ. `transactionRequest.value > 0` olan bir rota —
 * native->native kopru — bu yolla calismaz; kullanicinin native bakiyesi gerekir.
 *
 * ERC20 swap ve ERC20 kopru rotalari value: 0 tasir ve kapsam icindedir.
 *
 * FAIL-CLOSED: cozulemeyen bir value "native gerekmiyor" sayilamaz — o rota gonderilir ve
 * zincirde duser. Cozemiyorsak eliyoruz.
 */
export function routeRequiresNative(tx) {
  const raw = tx && tx.value
  if (raw === undefined || raw === null || raw === '') return false
  const v = toBig(raw)
  if (v === null) return true
  return v > 0n
}
