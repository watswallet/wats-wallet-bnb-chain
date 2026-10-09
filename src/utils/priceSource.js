// FIYAT KAYNAGI ETIKETI ("Fiyat: Atlas Oracle") -- ana ekranin Hisseler
// bolumu ve token detayi AYNI kurali buradan okur (spec 7). Iki ekranda ayri
// yazilan bir sure siniri zamanla ayrisir ve ayni hisse bir ekranda "Atlas",
// otekinde etiketsiz gorunurdu.
//
// KAYNAK SUNUCUNUN YAZDIGI IKI ALAN: `price_source` ('atlas' | 'coingecko') ve
// `price_updated_at`. /getTokensDataById ve /getTokenDataById belgeyi oldugu
// gibi dondurdugu icin istemci icin yeni bir uc YOK.
//
// NEDEN TAZELIK DE SART, KAYNAK TEK BASINA YETMEZ: sunucuda bayrak kapatilirsa
// (ATLAS_BSTOCKS_ENABLED=0) poller durur ama `price_source` belgede 'atlas'
// olarak KALIR; CoinGecko fiyati en gec bir sonraki kovasinda (2 saate kadar)
// ezer. O arada ekranda "Atlas" yazmak, artik guncellenmeyen bir fiyati canli
// kaynak gibi gostermek olurdu (spec 6.6).

// Atlas zincirde 60 sn'de bir yazar, sunucu dakikada bir okur; 10 dakika bu
// zincirin birkac turu duser demektir. Daha kisa bir sinir tek bir kacan turda
// etiketi yanip sondururdu.
export const ATLAS_LABEL_MAX_AGE_MS = 600000

// Saat kaymasi toleransi: `price_updated_at` SUNUCU saatidir, `nowMs` kullanicinin
// saati. Birkac saniye ileride duran bir sunucu saati etiketi gizlememeli; ama
// bir dakikadan fazla GELECEKTEKI bir zaman damgasi bozuk veridir ve tazelik
// kaniti sayilmaz.
const CLOCK_SKEW_MS = 60000

export function isAtlasPriced(record, nowMs = Date.now()) {
  if (record?.price_source !== 'atlas') return false
  // `new Date(null)` 1970'i verir (sonlu!); asagidaki yas siniri onu zaten
  // eler. Gecersiz metin ve eksik alan NaN uretir ve burada duser.
  const t = new Date(record.price_updated_at).getTime()
  if (!Number.isFinite(t)) return false
  const age = nowMs - t
  return age <= ATLAS_LABEL_MAX_AGE_MS && age >= -CLOCK_SKEW_MS
}
