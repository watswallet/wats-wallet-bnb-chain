// Emekli xStocks adresleri (K28, ilk alim kapisi).
//
// NEDEN VAR: 9fb92682 (2026-10-21, "referans gecikmesi") ADBEx, PYPLx ve STRCx'i istemci katalogundan (data/xStocks.js)
// cikardi. Ilk alim kapisi (tokenizedStocks.stockIssuer) ve genel Takas / Kopru dislamasi (isXstockExcludedAddress)
// katalog uyeligine bagli oldugundan bu uc adres ikisinden de dustu: BSC'de PYPLx kapisiz ve dislamasiz alinabiliyordu.
// Bu liste onlari YALNIZ CIKTI (edinme) tarafinda tutar: kapi `xstocks` sorar (stockOutputIssuer), genel Takas
// (isGeneralSwapOutputExcluded) ve Kopru hedefi (isBridgeTargetBlocked) reddeder. GIRDI (Sat, Gonder) tarafi ACIKtir:
// eldeki token satilabilmeli.
//
// KATALOGA GERI GIRMEZ: bu adresler stockEntry'de, Hisseler sekmesinde ve hisse detayinda YOK; fiyat, logo ve bakiye
// okumasi yoktur. Bir adres yeniden listelenirse bu dosyadan SILINIR (xStocksRetired.test.js ikisini ayni anda yasaklar).
//
// Adresler EIP-55 ve 9fb92682'nin sildigi satirlarla birebir. `chains` o satirlardaki URUN kapsamidir; dislama
// `chains`e degil var olunan bes zincire (tokenizedStocks.XSTOCK_EXISTENCE_CHAIN_IDS) bakar.
//
// Bu dosya SAF VERIDIR: hicbir import yok (data/xStocks.js ve data/bStocks.js kurali).

export const RETIRED_XSTOCKS = Object.freeze([
  Object.freeze({ symbol: 'ADBEx', name: 'Adobe', address: '0x16E0B579be45bAaE54cEddd52e742B6457A7fE12', chains: Object.freeze([1]) }),
  Object.freeze({ symbol: 'PYPLx', name: 'PayPal', address: '0xf706585e7e8900bE0267bEE3B9A2F70835EC6628', chains: Object.freeze([1, 56]) }),
  Object.freeze({ symbol: 'STRCx', name: 'Strategy PP Variable', address: '0x1Aad217B8F78dbA5E6693460e8470F8b1A3977f3', chains: Object.freeze([1]) }),
])
