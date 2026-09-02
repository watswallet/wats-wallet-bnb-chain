// `chrome.runtime.sendMessage` govdesini serilestirilebilir hale getirir.
//
// NEDEN VAR: Chrome uzanti mesajlari BigInt TASIYAMAZ. Bir BigInt govdenin herhangi bir
// derinliginde durursa istek/yanit hic gitmez ve cagirana "Could not serialize message."
// duser. Bu hata YANIT icin de GONDERENIN promise'ine dustugu icin, sorun her seferinde
// giden govdede saniliyor — 2026-08-09'da tam olarak bu oldu: `atsFeeQuote` yaniti
// `quoteAtsTransfer`'in `gas` (alti BigInt alan) ve `maxPriorityFeePerGas` alanlarini
// tasiyordu, ekranda sebepsiz "Ucret hesaplanamadi" cikiyordu.
//
// NEDEN ALAN SILMEK YERINE DONUSTURME: alan adiyla silmek kirilgan — yarin donus sekline
// eklenen yeni bir BigInt ayni hatayi sessizce geri getirir. Burada TIP bazinda calisiyoruz,
// yani sinirdan gecen her sey kosulsuz guvenli.
//
// SINIR JSON'DUR, structuredClone DEGIL: structuredClone BigInt'i sorunsuz klonlar, Chrome
// klonlamaz. Yani bu hatayi taklit etmenin dogru yolu `JSON.stringify` denemektir — testler
// `chrome.runtime`'i mock'ladigi icin gercek sinir aksi halde hic zorlanmaz.
//
// Ayni sebeple Vue'nun reactive proxy'si burada sorun DEGILDIR (`JSON.stringify` proxy'de
// calisir); ilk teshiste oyle sanildi, dogru degildi.
export function toMessageSafe(value) {
  if (typeof value === 'bigint') return value.toString()
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toMessageSafe)
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = toMessageSafe(v)
  return out
}
