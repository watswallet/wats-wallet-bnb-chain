// EKRANDA GORUNEN ATS TUTARI - tek kaynak, saf bicimleyici.
//
// NEDEN AYRI DOSYA (2026-09-15): ayni bolume (AtsShortfallNote) giden sayilar iki
// ekranda IKI FARKLI kuralla biciminiyordu. ConfirmTransaction.vue bu fonksiyonun
// govdesini `atsCompact` adiyla yerel tutuyordu; Swap.vue ise kendi `fmt`siyle
// (toFixed(4) + kuyruk sifir kirpma) yaziyordu. Olculen sonuc:
//   - eksik 0.00004 ATS -> Send "0.00004", takas "0" derdi. "0 ATS eksik" yazan bir
//     kartin yaninda kilitli bir dugme, kullanicinin cozemeyecegi bir bilmecedir.
//   - eksik 8.583333 ATS -> Send "8.583333", takas "8.5833" derdi. Gosterilen kadar
//     yukleyen kullanici YINE bloklu kalir - atsShortfall.js'in var olma sebebi tam
//     olarak bu hatadan kacinmakti ve takas ekrani onu geri getiriyordu.
//
// KURAL (ConfirmTransaction.vue'nun `atsCompact`i AYNEN korunur - o ekranin
// davranisi bu tasimada DEGISMEMELIDIR):
//   - okunamayan/eksik deger -> '—' (sifir DEGIL: "bedava" demek olurdu)
//   - tam sifir -> '0'
//   - >= 0.0001 -> en fazla 6 ondalik, binlik ayraciyla (en-US)
//   - < 0.0001 -> 4 ANLAMLI haneye yuvarlanir; boylece cok kucuk bir eksik "0"a
//     dusmez ve kullanici neyi yuklemesi gerektigini gorur.
//
// Bicim `en-US`e SABITLENMISTIR, kullanicinin diline DEGIL: tutar bir ADRES gibi
// okunup borsaya girilecek bir sayidir; ondalik ayracinin dile gore virgule
// donmesi (8,583333) kopyalayan kullaniciyi yanlis miktara goturur.

/**
 * @param {number|string|null|undefined} value insan birimi ATS
 * @returns {string} ekranda gosterilecek dize
 */
export function formatAtsAmount(value) {
  const n = Number(value)
  if (value == null || !isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n >= 0.0001) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return Number(n.toPrecision(4)).toString()
}
