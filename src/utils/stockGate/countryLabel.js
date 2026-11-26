// Ulke adi cozumleyici: ISO kodu -> kullanicinin dilinde ulke adi.
//
// SAF yardimci: vue, chrome, depo, ag YOK. Tuketici: StockGateBand (bant metinlerindeki {country}).
// Asla firlatmaz.
//
// KURALLAR
//  - Ad `Intl.DisplayNames([locale], { type: 'region' })`'den gelir; ICU surumune baglidir
//    (Node 22.17: TR -> "Turkiye"). Testler ad METNINI degil KOD KUMESINI kilitler.
//  - Ad cozulemezse (Intl yok, locale gecersiz, RangeError) KODUN KENDISI doner.
//  - COUNTRY_CODES disindaki kod (ZZ, UK, 'tr', bilinmeyen) icin ICU'ya SORULMAZ ve kodun
//    kendisi doner: ICU 'ZZ' icin "Bilinmeyen Bolge", 'UK' icin "Birlesik Krallik" der; bunlar
//    listede olmayan kodlardir ve kullaniciya ad gibi gosterilmemelidir.
//  - Dize olmayan kod icin '' doner.
//  - Onbellek YOK: dil calisma aninda degisebilir (Preferences) ve test Intl'i taklit edebilir.
import { COUNTRY_CODE_SET } from '../../data/countryCodes'

const DEFAULT_LOCALE = 'en'

const localeOf = (locale) => (typeof locale === 'string' && locale ? locale : DEFAULT_LOCALE)

/**
 * @param {unknown} code  ISO 3166-1 alpha-2 (BUYUK harf) ya da XK
 * @param {string} locale 'tr' | 'en' ...
 * @returns {string}
 */
export function countryLabel(code, locale) {
  if (typeof code !== 'string') return ''
  if (!COUNTRY_CODE_SET.has(code)) return code
  try {
    const name = new Intl.DisplayNames([localeOf(locale)], { type: 'region', fallback: 'code' }).of(code)
    return typeof name === 'string' && name ? name : code
  } catch {
    return code
  }
}
