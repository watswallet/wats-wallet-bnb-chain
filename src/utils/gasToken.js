// Fee-token (token ile gas) secim mantigi — saf, test edilebilir.
// opt: { token, symbol, decimals, balance, gasFee, logoURI }
//   - balance: kullanicinin o tokendan tuttugu miktar (insan birimi)
//   - gasFee : o tokenle gas'in TAHMINI maliyeti (insan birimi; smartAccount.estimateTokenGasFee)

// Bir seceneğin gas'i (ve AYNI token gonderiliyorsa transfer miktarini da) karsilamaya
// yetip yetmedigi. sentAssetAddress: gonderilen ERC-20 (native send'de null).
export function isOptionInsufficient(opt, { sentAssetAddress, sendAmount } = {}) {
  if (!opt) return false
  const gasFee = Number(opt.gasFee || 0)
  // gasFee bilinmiyorsa (tahmin alinamadi) yetersiz DEME — kullaniciyi yanlis bloklamayalim.
  if (!gasFee) return false
  const sameToken =
    sentAssetAddress && String(opt.token).toLowerCase() === String(sentAssetAddress).toLowerCase()
  const required = gasFee + (sameToken ? Number(sendAmount || 0) : 0)
  return Number(opt.balance || 0) < required
}

// Native yetersizse default fee-token: GAS'I KARSILAYAN en yuksek bakiyeli tokeni sec.
// Hicbir token gas'i karsilamiyorsa null (native/ETH) dondur -> fee ETH'de kalir; kullanici
// (kismi) bakiyesi olsa bile doomed bir tokene otomatik gecmez, native uyarisini gorur.
export function pickDefaultGasToken(options, { sentAssetAddress, sendAmount } = {}) {
  if (!options || !options.length) return null
  const sufficient = options.filter((o) => !isOptionInsufficient(o, { sentAssetAddress, sendAmount }))
  if (!sufficient.length) return null
  const byBalanceDesc = [...sufficient].sort((a, b) => Number(b.balance || 0) - Number(a.balance || 0))
  return byBalanceDesc[0].token
}
