// Token gorseli icin (logo URL'i yok) — deterministik monogram rozeti + tasma-guvenli bakiye formati.
// Tum sinif stringleri LITERAL (Tailwind v4 JIT statik tarama icin sart).

const PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
]

// Native varlik (ETH/BNB...) her zaman emerald aksaniyla — "ag coini" olarak okunur.
const NATIVE_MARK = 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300'

export function markInitials(symbol) {
  const s = String(symbol || '?').replace(/[^a-z0-9]/gi, '')
  return (s.slice(0, 2) || '?').toUpperCase()
}

export function markClass(symbol, isNative = false) {
  if (isNative) return NATIVE_MARK
  const s = String(symbol || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % PALETTE.length
  return PALETTE[h]
}

// Uzun bakiyeleri 360px'e sigdirir; tam hassasiyet :title'da gosterilir.
// `locale` (uygulama dili) EN SONA eklenen istege bagli parametredir; verilmezse en-US
// (eski davranis). Ayrac her kolda ayni dili izler: "125,4568" yaninda "2.50M" cikmasin.
export function formatBalance(n, locale = 'en-US') {
  const num = Number(n)
  if (!isFinite(num)) return '0'
  if (num >= 1e9) return compact(num / 1e9, locale) + 'B'
  if (num >= 1e6) return compact(num / 1e6, locale) + 'M'
  if (num >= 1000) return num.toLocaleString(locale, { maximumFractionDigits: 2 })
  return num.toLocaleString(locale, { maximumFractionDigits: 4 })
}

// 2 ondalikli kisaltma govdesi (toFixed(2) ile ayni basamaklar); binlik ayraci EKLENMEZ
// (999999999 -> "1000.00M" eski davranisi), yalniz ondalik ayraci dile uyar.
function compact(value, locale) {
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
}

// NOTR MONOGRAM (components/TokenAvatar.vue): sembolun ILK harfi/rakami, buyuk harf. Sembol bossa '?'.
export function markLetter(symbol) {
  const m = String(symbol ?? '').match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '?'
}
