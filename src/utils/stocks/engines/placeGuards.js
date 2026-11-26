// pancake (bStocks) ve lcx (LCX hisseleri) motorlarinin `place` korumalarindan IKI MOTORUN ORTAK, SAF parcalari. Tek kaynak:
// iki motor bunlari buradan alir, kendi kopyasini tutmaz. Ozellikle `normalizeAtsQuoted` ATS fail-closed kapisidir: gecerli
// `atsQuoted` yoksa `SWAP` GONDERILMEZ (arka plan tavani `atsQuoted` yoksa ya da <= 0 ise SESSIZCE atlar); ileride sikilastirilirsa
// iki motor birlikte sikilasir. `placeGuards.parity.test.js` ayni girdi tablosunu IKI motorun `place`inden gecirip ayni sonucu ister.
//
// Motora ozel durum (teklif kaydi, `used` isareti, mesaj alanlari) BURADA DEGILDIR: her motor kendi `place` dizisini tutar.
// Saf modul: ag, depo ve ethers yok; `send` yalniz cagri aninda `chrome.runtime.sendMessage`i okur.

const NUMERIC = /^\d+(\.\d+)?$/
const MAX_META_LEN = 512

/** `place` basarisiz sonucu: `{ ok:false, code }` (basari sonucunun sekli motora ozeldir). */
export const placeFail = (code) => ({ ok: false, code })

/** Arka plana mesaj (SWAP_QUOTE / SWAP). Chrome nesnesi cagri aninda okunur: testler `globalThis.chrome`i degistirir. */
export const send = (message) => chrome.runtime.sendMessage(message)

export const finitePositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0

// Gecmis karti icin token kimligi: yalniz bilinen alanlar, yalniz dize (logo icin tokenLogo() sekilleri), kisa.
// Sembol yoksa kimlik anlamsiz -> null. Adres verilmisse islemin gercek tokeniyle ESLESMEK zorunda (yoksa 'mismatch').
export function sanitizeTokenData(data, expectedAddress) {
  if (data === undefined || data === null) return null
  if (typeof data !== 'object') return 'mismatch'
  const str = (v) => (typeof v === 'string' && v.trim() !== '' && v.length <= MAX_META_LEN ? v.trim() : null)
  if (data.address !== undefined && data.address !== null) {
    if (typeof data.address !== 'string' || data.address.toLowerCase() !== expectedAddress.toLowerCase()) return 'mismatch'
  }
  const out = {}
  const symbol = str(data.symbol)
  if (!symbol) return null
  out.symbol = symbol
  const name = str(data.name)
  if (name) out.name = name
  out.address = expectedAddress
  if (typeof data.image === 'string') {
    const image = str(data.image)
    if (image) out.image = image
  } else if (data.image && typeof data.image === 'object') {
    const image = {}
    for (const k of ['large', 'small', 'thumb']) {
      const v = str(data.image[k])
      if (v) image[k] = v
    }
    if (Object.keys(image).length) out.image = image
  }
  for (const k of ['logoURI', 'logo']) {
    const v = str(data[k])
    if (v) out[k] = v
  }
  return out
}

// ATS onayi: ucret > 0 (0 olursa arka plan tavani atlar), komisyon >= 0 ve ikisi de sayi. Gecersiz -> null.
export function normalizeAtsQuoted(atsQuoted) {
  if (!atsQuoted || typeof atsQuoted !== 'object') return null
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && NUMERIC.test(v.trim()) ? Number(v) : NaN)
  const transferFee = num(atsQuoted.transferFee)
  const commissionFee = num(atsQuoted.commissionFee)
  if (!Number.isFinite(transferFee) || transferFee <= 0) return null
  if (!Number.isFinite(commissionFee) || commissionFee < 0) return null
  return { transferFee, commissionFee }
}
