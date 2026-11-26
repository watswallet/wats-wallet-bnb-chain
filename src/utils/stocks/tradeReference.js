// Al/Sat ekraninin REFERANS FIYAT kaynagi (Bolum 2, Gorev 8). SAF: ag, depo, vue YOK.
//
// Referans fiyat YALNIZ BILGIDIR (kilit yok) ve uc motorda uc ayri yerden gelir; ekran satirin ihraccisini (`issuer === 'bstocks'`)
// sormaz, kaynagi buradan alir:
//   'server' -- statik katalog bStocks satiri: ekran sunucudan (Atlas / priceUSD) OKUR ve istege ekler (pancake `referencePrice`).
//               Ilk teklif referans cevaplanmadan istenmez (refSettled).
//   'quote'  -- LCX satiri: referansi teklifin KENDISI tasir (`result.reference = { usd, source }`); beklenecek bir sey yok.
//   null     -- xStocks (CoW): referansi arka plan kurar (kilit ve fark orada); ekranda referans yok.
// LCX satiri ihracci kimligi ne yazarsa yazsin 'quote' sayilir: `source` alani belirleyicidir (engineFor ile ayni kural).

/** @param {{ source?: string, issuer?: string }|null|undefined} entry katalog satiri (stockEntry) @returns {'server'|'quote'|null} */
export function referenceSourceOf(entry) {
  if (entry === null || typeof entry !== 'object') return null
  if (entry.source === 'lcx') return 'quote'
  return entry.issuer === 'bstocks' ? 'server' : null
}

/**
 * Teklifin kendi referans fiyati (USD): yalniz LCX bicimi `{ usd, source }` nesnesi. pancake'in SAYI `reference`i ve
 * eksik / gecersiz (sonlu ve > 0 olmayan) deger null. Ham deger arayuze gecmeden burada dogrulanir.
 */
export function quoteReferenceUsd(result) {
  const reference = result?.reference
  if (reference === null || typeof reference !== 'object' || Array.isArray(reference)) return null
  const { usd } = reference
  return typeof usd === 'number' && Number.isFinite(usd) && usd > 0 ? usd : null
}
