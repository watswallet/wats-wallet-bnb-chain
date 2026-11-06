import { COW_ERROR } from './cow/errors'
import { USD_DISPLAY, formatMoney } from './money'

// CoW'un kendi siniri: tutar ag ucretini karsilamiyorsa (AMOUNT_TOO_SMALL) protokol emri kabul etmez ve cuzdan bunu
// degistiremez. 2026-10-21 kullanici karari: cuzdan KENDI asgari tutar kilidi koymaz; bu yuzden eski sabit zincir
// tablosu kaldirildi. Ipucu yalniz aciklama; tutar kontrolu, tablo ya da sayi YOKTUR.
// Ucret biliniyorsa (arka plan CoW govdesinden ya da yedek tekliften okur) ipucu GERCEK sayilari gosterir:
// ag ucreti, girilmesi gereken en az tutar ve eksik miktar. Hesap arka planda (cow/minAmount.js); burada yalniz bicim.
const HINT_ERRORS = new Set([COW_ERROR.AMOUNT_TOO_SMALL])
const BSC_CHAIN_ID = 56
const PLAIN_NUMBER = /^\d{1,40}(\.\d{1,40})?$/

// "1.41" -> yerel ondalik ayraciyla ("1,41"). Yalniz gosterim; tutar alanina ham (noktali) deger gider.
// Yalniz TOKEN tutarlari (ucret, en az, eksik) icin; USD karsiligi (feeUsd) para oldugundan money.js'ten gecer.
function localizeNumber(text, locale) {
  try {
    const sep = new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'
    return text.replace('.', sep)
  } catch {
    return text
  }
}

// Arka plandan gelen sayisal alanlar yalniz duz sayi dizesi olabilir; aksi halde genel metin.
function validInfo(info, symbol) {
  if (!info || typeof info !== 'object' || typeof symbol !== 'string' || symbol === '') return null
  const { feeDisplay, feeUsd, minAmountDisplay, missingDisplay } = info
  for (const v of [feeDisplay, minAmountDisplay, missingDisplay]) {
    if (typeof v !== 'string' || !PLAIN_NUMBER.test(v)) return null
  }
  const usd = typeof feeUsd === 'string' && PLAIN_NUMBER.test(feeUsd) ? feeUsd : null
  return { feeDisplay, feeUsd: usd, minAmountDisplay, missingDisplay }
}

/**
 * "Tutar cok kucuk" hatasi ipucu ya da null. extraKey ('BSC'de ag ucreti birkac sent') BSC (56) disindaki zincirlerde
 * gelir; BSC'de null. errorInfo + symbol (SATILAN token sembolu) gecerliyse sayili metin: { key, params, extraKey,
 * minAmount }; minAmount tutar alanini doldurmak icin ham (noktali) dizedir. Aksi halde genel { key, extraKey }.
 * params.feeUsd TAM BICIMLI tutardir (USD'de '$1.41', kur yokken 'USD 1.41'): ucretin USD karsiligi 'display'
 * (secili birim) ile money.js'ten gecer; sozlukteki metin "$" gommez. Bicimlenemezse (feeUsd yok, kur gecersiz)
 * parantezsiz amountMinNoUsd anahtari kullanilir.
 */
export function smallAmountHint({ chainId, errorCode, errorInfo, symbol, locale = 'en', display = USD_DISPLAY } = {}) {
  if (!HINT_ERRORS.has(errorCode)) return null
  const extraKey = chainId === BSC_CHAIN_ID ? null : 'stockTrade.hint.bscCheap'
  const info = validInfo(errorInfo, symbol)
  if (info === null) return { key: 'stockTrade.hint.amountBelowFee', extraKey }
  const local = (v) => localizeNumber(v, locale)
  const feeUsd = info.feeUsd === null ? null : formatMoney(Number(info.feeUsd), display, { locale })
  return {
    key: feeUsd === null ? 'stockTrade.hint.amountMinNoUsd' : 'stockTrade.hint.amountMin',
    params: {
      fee: local(info.feeDisplay),
      feeUsd: feeUsd ?? '',
      symbol,
      min: local(info.minAmountDisplay),
      missing: local(info.missingDisplay),
    },
    extraKey,
    minAmount: info.minAmountDisplay,
  }
}
