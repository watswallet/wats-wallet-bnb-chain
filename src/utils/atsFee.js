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
// oldugu icin birim test edilebilir; ConfirmTransaction yalnizca sonucu uygular.
//   'dapp'   -> mevcut Pimlico fee-token secici (per-dapp gasless opt-in ayrica bakilir)
//   'ats'    -> zorla ATS (kullanici transferi + ATS zinciri)
//   'native' -> duz native gas (secici yok)
export function pickFeeBranch({ fromDapp, atsEnabled } = {}) {
  if (fromDapp) return 'dapp'
  return atsEnabled ? 'ats' : 'native'
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

// src-allowance-low'u /sponsor un reddetmesini beklemeden yakalar: /status taban ucretle
// (minChargeAts) sorar, gercek op daha pahali olabilir. budget alaninin var olma sebebi budur.
export function needsBudgetTopUp({ feeRaw, srcAllowance } = {}) {
  if (feeRaw == null || srcAllowance == null) return false
  try { return BigInt(feeRaw) > BigInt(srcAllowance) } catch { return false }
}
