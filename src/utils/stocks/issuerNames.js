// Ihracci gorunen adi ve rozet harfi (SAF: ag, depo, tarayici API'si YOK). IssuerSwitch, IssuerLogo, IssuerInfoSheet ve StockDetail
// ayni kuralla adlandirir.
//
// Ihracci kimligi sunucudan gelir ve `constructor` gibi miras adlar da gecerli bicimdir (`^[a-z0-9-]{2,32}$`). vue-i18n miras adi "bulur"
// ve ceviri cagrisi cokebilir; bu yuzden ceviri anahtari `stockIssuer.<id>` kimlikle KOSULSUZ kurulmaz: adi olan
// ihraccilar acik bir listededir (dizi uyeligi; nesne anahtariyla arama / prototip YOK). Adi olmayan ihracci bas harfi buyuk kimlikle
// gosterilir ("foo-bar" -> "Foo-bar").

/** Ceviri adi (`stockIssuer.<id>`) olan ihraccilar. Yeni marka: locale anahtari + buraya girdi (locales.test.js ve IssuerSwitch testi ayni listeyi okur). */
export const NAMED_ISSUERS = Object.freeze(['bstocks', 'xstocks', 'ondo', 'coinbase', 'robinhood', 'st0x'])

/** Statik katalog ihraccilari: marka logosu ve kendi karsilastirma metinleri var. Bunlarin disindaki her ihracci bir LCX ihraccisidir. */
export const STATIC_ISSUERS = Object.freeze(['bstocks', 'xstocks'])

/** Bir LCX ihraccisi mi (statik katalog ihraccisi degil, dolu dize)? */
export const isLcxIssuer = (issuer) => typeof issuer === 'string' && issuer !== '' && !STATIC_ISSUERS.includes(issuer)

/** Ihracci adi: adi olanlar `stockIssuer.<id>` ceviri metni, digerleri bas harfi buyuk kimlik. `t` = vue-i18n t. */
export function issuerDisplayName(issuer, t) {
  const id = String(issuer)
  return NAMED_ISSUERS.includes(id) ? t(`stockIssuer.${id}`) : id.charAt(0).toUpperCase() + id.slice(1)
}

/** Rozet harfi: gorunen adin ilk harfi, buyuk (st0x -> S). Ad bossa bos dize. */
export const issuerInitial = (name) => (Array.from(String(name ?? ''))[0] ?? '').toUpperCase()
