// "Tutar ag ucretini karsilamiyor" (CoW SellAmountDoesNotCoverFee) hatasi icin kullaniciya gosterilecek sayilar:
// ag ucreti, girilmesi gereken en az tutar (ucretin 1,2 kati) ve eksik miktar. Saf modul; tum matematik BigInt.
// Sonuc YALNIZ rakam dizeleri tasir (mesaj sinirindan gecer, BigInt yok). Yuvarlama her zaman YUKARI:
// kullanici ekranda gordugu en az tutari girdiginde ucret gercekten karsilanmis olur.
import { formatUnits } from 'ethers'
import { referenceMicro } from './pricing'

const FEE_MAX = 10n ** 36n
const USD_PLACES = 2 // USD tokenlerinde (Al: USDC/USDT) ondalik hane
const STOCK_SIG = 6 // hisse tokeninde anlamli hane
const MICRO = 10n ** 6n

const ceilDiv = (a, b) => (a + b - 1n) / b

// Atom -> en yakin YUKARI kat: ondalik hane sayisina (USD) ya da anlamli hane sayisina (hisse) gore.
const roundUp = (atoms, decimals, side) => {
  if (side === 'buy') {
    if (decimals <= USD_PLACES) return atoms
    const unit = 10n ** BigInt(decimals - USD_PLACES)
    return ceilDiv(atoms, unit) * unit
  }
  const digits = atoms.toString().length
  if (digits <= STOCK_SIG) return atoms
  const unit = 10n ** BigInt(digits - STOCK_SIG)
  return ceilDiv(atoms, unit) * unit
}

// Atom -> okunur dize. USD: sabit 2 hane ("5.00"); hisse: sondaki sifirlar atilir ("0.005", "12").
const text = (atoms, decimals, side) => {
  const [whole, frac = ''] = formatUnits(atoms, decimals).split('.')
  if (side === 'buy') return `${whole}.${frac.padEnd(USD_PLACES, '0').slice(0, USD_PLACES)}`
  const kept = frac.replace(/0+$/, '')
  return kept ? `${whole}.${kept}` : whole
}

// Mikro-USD (6 hane) -> "0.01" gibi 2 haneli, yukari yuvarlanmis dize.
const usdText = (micro) => {
  const unit = 10n ** BigInt(6 - USD_PLACES)
  return text(ceilDiv(micro, unit) * unit, 6, 'buy')
}

/**
 * @param {{ side: 'buy'|'sell', feeAtoms: string, enteredAtoms: bigint, sellDecimals: number, reference: number|null }} girdi
 *   feeAtoms: SATILAN token biriminde ag ucreti (rakam dizesi); enteredAtoms: kullanicinin girdigi tutar (ayni birim).
 * @returns {{ feeAtoms, feeDisplay, feeUsd?, minAmountDisplay, missingDisplay } | null}
 *   null = hesaplanamadi ya da girilen tutar tahmini en azin altinda degil (genel metin gosterilir).
 */
export function smallAmountInfo({ side, feeAtoms, enteredAtoms, sellDecimals, reference } = {}) {
  if (side !== 'buy' && side !== 'sell') return null
  if (typeof feeAtoms !== 'string' || !/^\d{1,40}$/.test(feeAtoms)) return null
  if (typeof enteredAtoms !== 'bigint' || enteredAtoms < 0n) return null
  if (!Number.isInteger(sellDecimals) || sellDecimals < 0 || sellDecimals > 36) return null
  const fee = BigInt(feeAtoms)
  if (fee <= 0n || fee > FEE_MAX) return null

  const min = roundUp(ceilDiv(fee * 12n, 10n), sellDecimals, side)
  const missing = min - enteredAtoms
  if (missing <= 0n) return null

  const out = {
    feeAtoms: fee.toString(),
    feeDisplay: text(roundUp(fee, sellDecimals, side), sellDecimals, side),
  }
  if (side === 'buy') {
    // USDC / USDT 1:1
    out.feeUsd = usdText(ceilDiv(fee * MICRO, 10n ** BigInt(sellDecimals)))
  } else {
    const rm = referenceMicro(reference)
    if (rm !== null) out.feeUsd = usdText(ceilDiv(fee * rm, 10n ** BigInt(sellDecimals)))
  }
  out.minAmountDisplay = text(min, sellDecimals, side)
  out.missingDisplay = text(roundUp(missing, sellDecimals, side), sellDecimals, side)
  return out
}
