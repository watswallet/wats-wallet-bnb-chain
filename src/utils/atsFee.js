// ATS ucret mantigi — saf, test edilebilir. Tum miktarlar INSAN birimi (Number/string).

// EIP-7702 delegasyon kontrolu: hesabin kodu TAM olarak 0xef0100 || delegate olmali.
// Paymaster bunu zincirde dogruluyor; farkliysa backend 400 doner.
export function isDelegatedTo(code, delegate) {
  if (!code || !delegate) return false
  const want = '0xef0100' + String(delegate).toLowerCase().replace(/^0x/, '')
  return String(code).toLowerCase() === want
}

// Gereken toplam ATS (insan birimi). Bootstrap gerekiyorsa onun ucreti de eklenir;
// gonderilen varlik ATS'nin kendisiyse transfer tutari da aranir.
// transferFee bilinmiyorsa null -> cagiran bunu "blokla" olarak yorumlar.
export function requiredAtsAmount({ transferFee, bootstrapFee, sentAssetAddress, atsAddress, sendAmount } = {}) {
  if (transferFee == null) return null
  const sameToken =
    sentAssetAddress && atsAddress &&
    String(sentAssetAddress).toLowerCase() === String(atsAddress).toLowerCase()
  return Number(transferFee) + Number(bootstrapFee || 0) + (sameToken ? Number(sendAmount || 0) : 0)
}

// Bakiye gerekeni karsiliyor mu? Ucret bilinmiyorsa KATI davranir (spec bolum 7).
export function isAtsFeeInsufficient({ atsBalance, ...rest } = {}) {
  const required = requiredAtsAmount(rest)
  if (required == null) return true
  return Number(atsBalance || 0) < required
}

// ATS transferinde gas icin native GEREKMEZ. Yalnizca native coin GONDERILIYORSA
// tutar kadar native gerekir. (Gas'i buraya katmak, 0 ETH'li kullaniciyi yanlislikla
// bloklardi — ozelligin butun amaci bu durumu calistirmak.)
export function isNativeAmountInsufficient({ nativeBalance, isNativeSend, sendAmount } = {}) {
  const required = isNativeSend ? Number(sendAmount || 0) : 0
  return Number(nativeBalance || 0) < required
}

// Onay ekraninin hangi ucret kolunu kullanacagi (spec §2). Karar TEK yerde ve saf
// oldugu icin birim test edilebilir; ekranlar yalnizca sonucu uygular.
//   'ats'    -> zorla ATS (ATS zinciri; kullanici transferi DE dapp islemi DE)
//   'dapp'   -> mevcut Pimlico fee-token secici (per-dapp gasless opt-in ayrica bakilir)
//   'native' -> duz native gas (secici yok)
//
// ATS ZINCIRI ONCE GELIR, `fromDapp` SONRA. Onceki kural `fromDapp` gorur gormez
// 'dapp' donuyordu ve sonucu su celiskiydi: BNB'si olmayan bir kullanici Gonder
// ekraninda ayni zincirde ATS ile gonderebiliyor, ama bir dapp'in istedigi islemi
// HIC yapamiyordu -- ekranda tek gorulen "Yetersiz Ag Ucreti" idi (canli, BSC).
// `fromDapp` artik yalnizca ATS'siz zincirlerde anlamli: orada Pimlico secicisini
// acar (yine per-dapp opt-in'e bagli), ATS zincirlerinde ise ucret her iki akista
// da ATS'tir.
export function pickFeeBranch({ fromDapp, atsEnabled } = {}) {
  if (atsEnabled) return 'ats'
  return fromDapp ? 'dapp' : 'native'
}

// /quote iki fiyat doner. Hangisinin gecerli oldugu TAHSILATIN NEREDE yapildigina baglidir.
// Ayni alani hem ekranda hem onay siniri karsilastirmasinda kullan — farkli alanlari
// karsilastirmak her islemi reddettirir.
//
// Parametre `mode` DEGIL, `crosschain` BOOLEAN'idir (bkz. atsConfig.isCrosschainCollection):
// backend'in /quote notu bunu kendi agziyla soyluyor — "ATS kaynak zincirde (BSC) ise
// atsFeeCrosschain gecerlidir" — yani belirleyici, ATS'nin nerede durdugudur, hedef
// zincirdeki sponsorluk sekli (`mode`) degil.
export function pickAtsFee(quote, crosschain) {
  const xc = quote && quote.atsFeeCrosschain
  // BILINMIYOR (undefined/null) ise pahali taraf: eksik gostermek kullaniciyi sasirtir,
  // fazla gostermek yalnizca temkinlidir.
  if (crosschain === false) return quote.atsFee
  return xc || quote.atsFee
}

// Bootstrap'ta op1'in (approve + 7702) ucreti. Backend op1'i imzali PATH 2'den gecirir: TABAN
// YOK, markup bootstrapMarkupBps (canlida 0) — fiyati /quote'un `atsFeeBootstrap` alanidir
// (paymaster sponsor.ts:677). Onu normal op'un tabanli `atsFee`'siyle fiyatlamak ekranda
// ucreti IKIYE KATLIYORDU (canli, BSC: 41.74 ATS gosterildi, gercek ust sinir ~21.76).
//
// YALNIZ ayni zincirde: capraz-zincirde op1 backend'de 'crosschain' siniflanir ve TAM
// capraz-zincir ucreti kesilir (sponsor.ts:1045-1087) — orada normal op fiyati dogrudur.
// Alan yoksa/gecersizse de ayni muhafazakar tarafa duser: op1'i 0 saymak gerekeni eksik
// gosterir, op1 odenir ve op2 bakiyeden duser (para gitmis, transfer gonderilmemis).
export function pickBootstrapFee(quote, { mode, crosschain, feeRaw } = {}) {
  if (mode !== 'bootstrap') return '0'
  if (crosschain === false) {
    try {
      const b = BigInt(quote && quote.atsFeeBootstrap)
      if (b > 0n) return b.toString()
    } catch { /* gecersiz alan: asagidaki muhafazakar tarafa dus */ }
  }
  return feeRaw
}

// "en fazla" niteleyicisi YALNIZ iade GERCEKTEN mumkunse dogrudur. Normal yolda kontrat hem
// on odemeyi hem postOp borcunu minChargeAts tabaninda keser (ATSPaymaster.sol _atsFor):
// ucret tabandaysa iade SIFIRDIR — BSC'de gaz ~$0.04 iken $1 taban her zaman kazanir.
// Capraz-zincirde postOp hic yoktur. Emin olunamayan her durumda false: fazladan bir
// "en fazla" var olmayan bir iadeyi vaat eder, eksik olan yalnizca temkinlidir.
// BigInt ZORUNLU: ~2e19 wei'de Number son basamaklari kaybeder, tabandaki ucret ESIT cikmali.
export function atsFeeRefundable({ crosschain, feeRaw, minChargeAts } = {}) {
  if (crosschain !== false) return false
  if (feeRaw == null || minChargeAts == null) return false
  try { return BigInt(feeRaw) > BigInt(minChargeAts) } catch { return false }
}

// src-allowance-low'u /sponsor un reddetmesini beklemeden yakalar: /status taban ucretle
// (minChargeAts) sorar, gercek op daha pahali olabilir. budget alaninin var olma sebebi budur.
export function needsBudgetTopUp({ feeRaw, srcAllowance } = {}) {
  if (feeRaw == null || srcAllowance == null) return false
  try { return BigInt(feeRaw) > BigInt(srcAllowance) } catch { return false }
}
