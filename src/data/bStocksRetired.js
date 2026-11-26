// Emekli bStocks adresleri (K28 ilkesinin bStocks karsiligi, ilk alim kapisi).
//
// NEDEN VAR: e7089f2d (2026-09-29, likidite kurali) BMNRB ve FLNCB'yi istemci katalogundan (data/bStocks.js) cikardi.
// Kapi (tokenizedStocks.stockIssuer) katalog uyeligine bagli oldugundan bu iki adres kapidan dustu; ama token zincirde
// duruyor ve sunucunun /getChainTokens listesi BSC'de hala doner (kayitlar silinmedi), yani genel Takas'in "Alinan"
// listesinde gorunup SWAP gonderilebiliyordu: TR / US / AB dahil her ulkeden, kapisiz. xStocks icin ayni delik K28 ile
// (data/xStocksRetired.js) kapatilmisti; bu liste bStocks icin AYNI kuraldir.
//
// ETKI (YALNIZ CIKTI / edinme tarafi): kapi `bstocks` sorar (tokenizedStocks.stockOutputIssuer) ve Takas "Alinan" /
// Kopru hedef listesi uygun olmayan ihraccinin emekli adresini gostermez (offerable.unavailableOutput). GIRDI (Sat,
// Gonder) tarafi ACIKtir: eldeki token satilabilmeli (K4, K35). Ihracci uygunsa (kapi acik) bStocks'un genel Takas
// yolu degismez: xStocks'un aksine genel Takas / Kopru DISLAMASINA girmez (PancakeSwap rotasi gercek; isGeneralSwap-
// OutputExcluded ve isBridgeTargetBlocked bu listeyi BILMEZ).
//
// KATALOGA GERI GIRMEZ: bu adresler stockEntry'de, Hisseler sekmesinde ve hisse detayinda YOK; fiyat, logo ve bakiye
// okumasi yoktur (elde tutanlarda satir Varliklar'da sade BEP-20 kalir). Bir adres yeniden listelenirse bu dosyadan
// SILINIR (bStocksRetired.test.js ikisini ayni anda yasaklar).
//
// GUNCELLEME TARIFI: bStocks.js'ten bir satir CIKARAN herkes ayni commit'te onu BURAYA ekler ve
// data/stockCatalogLedger.test.js'teki defteri gunceller (defter ikisini de zorlar). Yoksa o token kapisiz alinabilir.
//
// Adresler EIP-55 ve e7089f2d'nin sildigi satirlarla birebir. bStocks yalniz BSC'de (56) vardir; dislama `chains`e
// degil tokenizedStocks.BSTOCKS_CHAIN_ID'ye bakar.
//
// Bu dosya SAF VERIDIR: hicbir import yok (data/xStocks.js, data/bStocks.js ve data/xStocksRetired.js kurali).

export const RETIRED_BSTOCKS = Object.freeze([
  Object.freeze({ symbol: 'BMNRB', name: 'BitMine Immersion', address: '0x3548Da95a9eFFE481e8604664d75e95821e557F5', chains: Object.freeze([56]) }),
  Object.freeze({ symbol: 'FLNCB', name: 'Fluence Energy', address: '0x4af1D41cd9dD950dcA43984b43aaA2A8702714Ac', chains: Object.freeze([56]) }),
])
