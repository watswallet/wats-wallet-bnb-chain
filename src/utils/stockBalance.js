// TAM BAKIYE MATEMATIGI (Al/Sat ekrani). Bakiye Number (float) tasirsa MAX ve yuzde cipleri bakiyenin USTUNE cikabilir:
// 18 ondalikli BSC USDC icin 0.188405789675366912 -> Number 0.18840578967536692 ve toFixed(6) 0.188406 (yukari) olur,
// emir zincirdeki bakiyeyi asar (INSUFFICIENT_BALANCE). Burada her sey BigInt atom uzerindedir ve hep ASAGI yuvarlanir.
// Saf modul: ethers yok, DOM yok.

export const DISPLAY_FRAC = 6 // giris alani ve kart gosterimi en fazla bu kadar ondalik (USD tokenlerinde tam deger)

const PLAIN = /^\d+(\.\d*)?$/

const toBig = (v) => {
  if (typeof v === 'bigint') return v
  if (typeof v === 'string' && /^\d{1,78}$/.test(v)) return BigInt(v)
  return null
}

// Atomu tam duz ondalik metne cevirir (sondaki sifirlar atilir, kayip yok).
export function unitsString(atoms, decimals) {
  const v = toBig(atoms)
  if (v === null || !Number.isInteger(decimals) || decimals < 0) return '0'
  if (decimals === 0) return v.toString()
  const s = v.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

// Yuzdeyi (0..1) basis puanina cevirir; bolme ASAGI yuvarlar. Gecersiz yuzde 0.
export function percentOfAtoms(atoms, percent) {
  const v = toBig(atoms)
  const p = Number(percent)
  if (v === null || !Number.isFinite(p) || p <= 0) return 0n
  const bps = BigInt(Math.min(10000, Math.round(p * 10000)))
  return (v * bps) / 10000n
}

// '1.25' -> atom. Ondaligi asan ya da bozuk metin null (cagiran karar verir; sessizce kirpilmaz).
export function decimalToAtoms(text, decimals) {
  if (typeof text !== 'string' || !PLAIN.test(text) || !Number.isInteger(decimals) || decimals < 0) return null
  const [whole, frac = ''] = text.split('.')
  if (frac.length > decimals) return null
  return BigInt(whole + frac.padEnd(decimals, '0'))
}

// true/false; tutar ondaligi asarsa ya da bakiye atomu yoksa null (cagiran float yoluna doner).
export function isInsufficientAtoms(amountText, atoms, decimals) {
  const have = toBig(atoms)
  const want = decimalToAtoms(amountText, decimals)
  if (have === null || want === null) return null
  return want > have
}

// Bekleyen dusum degerini (metin ya da Number) atoma cevirir; fazla ondalik YUKARI yuvarlanir (dusum buyur, bakiye kuculur).
// Duz ondalik metin tam cevrilir; ustel gosterim vb. Number yoluna duser.
export function toAtomsCeil(value, decimals, round = 'up') {
  if (!Number.isInteger(decimals) || decimals < 0) return 0n
  let text = typeof value === 'string' ? value.trim() : ''
  if (!PLAIN.test(text)) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return 0n
    // En kisa gidis-donus gosterimi (0.1 -> '0.1'); ustel gosterim yalniz cok kucuk degerlerde toFixed'e duser.
    text = PLAIN.test(String(n)) ? String(n) : n.toFixed(Math.min(decimals, 20))
  }
  const [whole, frac = ''] = text.split('.')
  const kept = frac.slice(0, decimals).padEnd(decimals, '0')
  let out = BigInt(whole + kept)
  if (round === 'up' && /[1-9]/.test(frac.slice(decimals))) out += 1n
  return out
}

/**
 * Number degerlerinden (ATS ucreti: gereken ve bakiye hesaplari Number tasir) kart modeli. Gereken YUKARI, mevcut ASAGI
 * atoma cevrilir. Bozuk gereken ya da yeterli bakiye -> null.
 */
export function shortfallOfNumbers({ required, have, decimals = 18, symbol, locale = 'en' } = {}) {
  const need = Number(required)
  if (required == null || !Number.isFinite(need) || need <= 0) return null
  const owned = Number(have)
  return buildInsufficient({
    requiredAtoms: toAtomsCeil(need, decimals, 'up'),
    availableAtoms: Number.isFinite(owned) && owned > 0 ? toAtomsCeil(owned, decimals, 'down') : 0n,
    decimals,
    symbol,
    locale,
  })
}

const localSep = (locale) => {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'
  } catch {
    return '.'
  }
}

/**
 * Gosterim metni. round 'down' (varsayilan): bakiye gibi sahip olunan miktar, asla fazla gostermez.
 * round 'up': gereken ve eksik, asla eksik gostermez. Sifir olmayip gosterilemeyecek kadar kucuk -> '<0,000001' (down).
 */
export function formatAtoms(atoms, decimals, { locale = 'en', round = 'down', maxFrac = DISPLAY_FRAC } = {}) {
  const v = toBig(atoms)
  if (v === null || !Number.isInteger(decimals) || decimals < 0) return '-'
  const sep = localSep(locale)
  const frac = Math.min(maxFrac, decimals)
  const scale = 10n ** BigInt(decimals - frac)
  let q = v / scale
  if (round === 'up' && v % scale !== 0n) q += 1n
  if (q === 0n && v > 0n) return `<0${sep}${'0'.repeat(Math.max(0, frac - 1))}1`
  const text = unitsString(q, frac)
  return text.replace('.', sep)
}

/**
 * MAX / yuzde cipi: { amount, display }. amount emre giden TAM dize (atomdan, asagi yuvarlanmis);
 * display giris alaninda gorunen, DISPLAY_FRAC ondaliga asagi kirpilmis dize. Sifir sonuc -> bos.
 */
export function chipAmount({ atoms, decimals, percent }) {
  const picked = percentOfAtoms(atoms, percent)
  if (picked <= 0n) return { amount: '', display: '' }
  const amount = unitsString(picked, decimals)
  return { amount, display: cutDisplay(amount) }
}

// Tam ondalik dizeyi DISPLAY_FRAC ondaliga ASAGI kirpar (yuvarlamaz); giris alani bunu gosterir, emir tam dizeyi kullanir.
export function cutDisplay(amount) {
  const [whole, frac = ''] = String(amount).split('.')
  const cut = frac.slice(0, DISPLAY_FRAC).replace(/0+$/, '')
  return cut ? `${whole}.${cut}` : whole
}

/**
 * 'Bakiye yetersiz' karti modeli ya da null. params: gereken (yukari), mevcut (asagi), eksik (yukari).
 * equalizeAmount: 'Tutari bakiyeye esitle' dugmesinin yazacagi TAM dize (mevcut > 0 ise), yoksa null.
 */
export function buildInsufficient({ requiredAtoms, availableAtoms, decimals, symbol, locale = 'en' } = {}) {
  const need = toBig(requiredAtoms)
  const have = toBig(availableAtoms)
  if (need === null || have === null || have >= need) return null
  if (typeof symbol !== 'string' || symbol === '' || !Number.isInteger(decimals) || decimals < 0) return null
  return {
    params: {
      required: formatAtoms(need, decimals, { locale, round: 'up' }),
      have: formatAtoms(have, decimals, { locale }),
      missing: formatAtoms(need - have, decimals, { locale, round: 'up' }),
      symbol,
    },
    equalizeAmount: have > 0n ? unitsString(have, decimals) : null,
  }
}
