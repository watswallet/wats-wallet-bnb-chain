// DAPP CAGRISI ZINCIRDE DUSER MU — GONDERIMDEN ONCE SORULUR.
//
// NEDEN ATS KOLUNDA DA GEREKLI: ucreti ATS odedigi icin "gaz yanmaz" sanilabilir, ama
// yanar. Paymaster op'u sponsorlar ve op ZINCIRDE revert etse bile ATS tahsil edilir —
// yani dusen bir dapp cagrisinda kullanici bos yere ATS oder ve dapp geri donen hash'i
// "basarili" sanar. Duz gaz kolundaki eski koruma (kor 65000n ile yayin yapma) ayni
// sebeple konmustu; kol degisince korumanin ortadan kalkmamasi gerekir.
//
// TAHMIN `gasPrice: 0` ILE SORULUR. CANLI OLCUM (BSC, 2026-09-13, 0 BNB'li adres):
//   duz eth_estimateGas          -> "insufficient funds for gas * price + value" (-32000)
//   gasPrice:0 + gecerli cagri   -> 0x5e99  (tahmin CALISIR)
//   gasPrice:0 + revert eden cagri -> "execution reverted" (kod 3)
// Yani sifir bakiyeli kullanici — ozelligin hedef kitlesi — bu soruyu sorabiliyor ve
// cevap gercekten "cagri duser mi" sorusunun cevabi oluyor.

// Tahmin hatasi GONDERIMI DURDURMALI MI?
//
// YALNIZCA revert ailesi durdurur. "Yetersiz bakiye" DURDURMAZ: o ayri bir sorundur,
// ekranda kendi karti vardir (gonderilen native tutar) ve ATS kolunda gaz zaten
// native'den odenmiyor — orada bloklamak, ozelligin tam da calismasi gereken durumu
// (0 native) kapatirdi. Ag/altyapi hatasi da durdurmaz: tahmin alinamamasi cagrinin
// dustugu anlamina gelmez ve calisan bir islemi susturarak iptal ettirmek daha kotudur.
//
// Siralama ONEMLI: "insufficient funds" kontrolu revert desenlerinden ONCE gelir,
// cunku bazi ucler iki ifadeyi ayni metinde dondurur.
export function isRevertError(err) {
  if (!err) return false

  const parcalar = [
    err.shortMessage, err.message, err.reason,
    err.info && err.info.error && err.info.error.message,
    err.error && err.error.message,
  ].filter(Boolean).join(' ')

  if (/insufficient funds/i.test(parcalar)) return false

  // ethers v6 revert'i boyle siniflandirir; saglayici ham kodu 3'tur (geth ailesi).
  if (err.code === 'CALL_EXCEPTION') return true
  if ((err.info && err.info.error && err.info.error.code) === 3) return true
  if ((err.error && err.error.code) === 3) return true

  return /execution reverted|always failing transaction|VM Exception|revert/i.test(parcalar)
}
