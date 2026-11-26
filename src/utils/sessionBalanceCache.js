// Ana ekran bakiyesi icin OTURUM ONBELLEGI (chrome.storage.session) + ATS yakit onbellegi temizligi.
//
// AMAC: popup her acilista bakiye sifirdan yuklenmesin; son bilinen deger ilk boyamada gorunsun,
// guncel deger sessizce gelsin.
//
// SINIRLAR (hepsi testle kilitli, sessionBalanceCache.test.js):
//  - YALNIZ chrome.storage.session. Diske HICBIR sey yazilmaz; tarayici kapaninca ya da cuzdan kilitlenince
//    gider (clearSessionCaches, background.js lockWallet).
//  - Anahtar hesap + ag + para birimi. Baska birinin degeri okunmaz.
//  - GIZLI mod ve gizli hesap verisi HIC yazilmaz, HIC okunmaz.
//  - YARIM tur yazilmaz: beklenen her satir okunmus ve hatasiz olmalidir.
//  - Bu deger yalniz GOSTERIM icindir. Maks gonderim, limit, yeterli bakiye ya da herhangi bir islem
//    dogrulamasinda KULLANILMAZ; oralar canli okur.

export const BALANCE_SNAPSHOT_KEY = 'balance_snapshot'
// atsFuel.js ile ayni ad; oraya import edilmez (dongusel bagimlilik olmasin).
export const FUEL_CACHE_SESSION_KEY = 'ats_fuel_cache'
const MAX_ENTRIES = 8
const ROW_FIELDS = ['amount', 'price', 'change', 'value', 'nowValue', 'oldValue']

const session = () => globalThis.chrome?.storage?.session ?? null
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

export function snapshotKey({ accountKey, chainId, currency } = {}) {
  if (!accountKey || chainId === undefined || chainId === null || chainId === '' || !currency) return null
  return `${accountKey}|${chainId}|${currency}`
}

// Yalniz bilinen, sonlu sayisal alanlar; `error` bilerek TASINMAZ.
function cleanRows(tokenBalances) {
  const out = {}
  for (const [k, row] of Object.entries(tokenBalances || {})) {
    if (!row || typeof row !== 'object') continue
    const clean = {}
    for (const f of ROW_FIELDS) if (finite(row[f])) clean[f] = row[f]
    if (row.valueUnknown === true) clean.valueUnknown = true
    if (Object.keys(clean).length > 0) out[k] = clean
  }
  return out
}

export async function readBalanceSnapshot(key) {
  try {
    const area = session()
    if (!area || !key) return null
    const r = await area.get(BALANCE_SNAPSHOT_KEY)
    const rec = r && r[BALANCE_SNAPSHOT_KEY] && r[BALANCE_SNAPSHOT_KEY][key]
    if (!rec || typeof rec !== 'object' || !rec.tokenBalances) return null
    return rec
  } catch {
    return null
  }
}

export async function writeBalanceSnapshot(key, { tokenBalances, usd, percentage, percentageUSD } = {}) {
  try {
    const area = session()
    if (!area || !key) return
    const r = await area.get(BALANCE_SNAPSHOT_KEY)
    const all = { ...((r && r[BALANCE_SNAPSHOT_KEY]) || {}) }
    delete all[key]
    all[key] = {
      tokenBalances: cleanRows(tokenBalances),
      usd: finite(usd) ? usd : 0,
      percentage: finite(percentage) ? percentage : 0,
      percentageUSD: finite(percentageUSD) ? percentageUSD : 0,
      at: Date.now(),
    }
    // Ekleme sirasi = yenilik sirasi (yeniden yazilan anahtar sona gecer); en eskiler duser.
    const keys = Object.keys(all)
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete all[old]
    await area.set({ [BALANCE_SNAPSHOT_KEY]: all })
  } catch {
    // onbellek bir KOLAYLIKTIR; hatasi ekrani dusurmez
  }
}

/**
 * Son bilinen degeri `user` deposuna yazar. Yalniz depo BOSKEN, ayni (ya da henuz belirsiz) hesaba aitken ve
 * gizli degilken. Okuma sirasinda canli tur gelirse canliyi EZMEZ.
 */
export async function hydrateBalanceSnapshot(user, { accountKey, chainId, currency, isPrivate } = {}) {
  if (isPrivate) return false
  const key = snapshotKey({ accountKey, chainId, currency })
  if (!key) return false
  const usable = () => Object.keys(user.tokenBalances || {}).length === 0
    && (user.balancesAccountKey === null || user.balancesAccountKey === accountKey)
  if (!usable()) return false
  const snap = await readBalanceSnapshot(key)
  if (!snap || !usable()) return false
  user.tokenBalances = snap.tokenBalances
  user.usd = snap.usd
  user.percentage = snap.percentage
  user.percentageUSD = snap.percentageUSD
  user.balancesAccountKey = accountKey
  return true
}

/**
 * Tamamlanmis bir turun sonucunu yazar. `expectedKeys` listedeki HER satir okunmus ve hatasiz degilse yazilmaz
 * (yarim toplam onbellege girmez).
 */
export async function persistBalanceSnapshot(user, { accountKey, chainId, currency, isPrivate, expectedKeys } = {}) {
  if (isPrivate) return false
  const key = snapshotKey({ accountKey, chainId, currency })
  if (!key || user.balancesAccountKey !== accountKey) return false
  if (!Array.isArray(expectedKeys) || expectedKeys.length === 0) return false
  const bal = user.tokenBalances || {}
  for (const row of Object.values(bal)) if (row && row.error) return false
  for (const k of expectedKeys) {
    const row = bal[k]
    if (!row || row.amount === undefined || row.amount === null || !Number.isFinite(Number(row.amount))) return false
  }
  await writeBalanceSnapshot(key, {
    tokenBalances: bal, usd: user.usd, percentage: user.percentage, percentageUSD: user.percentageUSD,
  })
  return true
}

// Kilit / cikis / sifirlama. Hata YUTULUR: kilit asla bunun yuzunden bozulmaz.
// Diskteki ESKI duz metin yakit kopyasi da (surum oncesi) silinir.
export async function clearSessionCaches() {
  try { await session()?.remove([BALANCE_SNAPSHOT_KEY, FUEL_CACHE_SESSION_KEY]) } catch { /* yutulur */ }
  try { await globalThis.chrome?.storage?.local?.remove(['ats_fuel_cache']) } catch { /* yutulur */ }
}
