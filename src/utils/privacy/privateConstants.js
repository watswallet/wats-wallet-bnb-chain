// Gizli modun arayuz ile arka plan arasinda PAYLASILAN sabitleri. Bu dosyanin HICBIR import'u yoktur ve
// OLMAMALIDIR: popup bunu okurken arka plan yurutucusunu (privateOrderExec.js) ya da SDK istemcisini
// (silentswap.js: viem + bitcoin-psbt) paketine cekmemeli (T25 M3). Kaynak taramasi testi
// (privatePopupImports.test.js) popup kaynaklarinin o iki dosyayi iceri almadigini denetler.

// Yatirma baslarken ve IMZADAN hemen once tekliften en az bu kadar sure kalmali: approve ve
// yatirma madenlenirken teklif dolabilir (gec yatirma DROPPED yoluna duser). Sunucu saatiyle
// istemci saati karsilastirildigi icin kucuk bir pay da saat farkini emer. Ekran da ayni sureyle
// "Teklif al"a doner.
export const QUOTE_MIN_REMAINING_MS = 20000

// Tutar KANONIK bicimde olmali: tam sayi ya da en cok 18 ondalik (BSC USDC'si 18 haneli). Ekran girdisi
// ve arka plan teklif istegi AYNI kurali kullanir; viem parseUnits '10.', '.5', '-12' kabul eder ve
// 19+ ondalikta sessizce YUVARLAR (T25 U:M-8c). Tek kopya: iki taraf zamanla ayrismasin (T25 M9).
export const CANONICAL_AMOUNT_RE = /^\d+(\.\d{1,18})?$/
