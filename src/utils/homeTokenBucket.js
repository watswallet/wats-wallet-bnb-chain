/**
 * Token kovasi anahtarlari — saf katman.
 *
 * Home.vue depodaki `imported_tokens[accountKey][chainId]` kovalarini okurken
 * `chainId: Number(chainId)` yaziyordu. Solana kimligi METIN oldugu icin bu
 * NaN uretir ve SPL tokenlar listeden SESSIZCE duserdi.
 */
export function normalizeBucketChainId(chainId) {
    const n = Number(chainId)
    return Number.isFinite(n) && String(chainId).trim() !== '' ? n : chainId
}

/**
 * Bakiye sozlugunun anahtari.
 *
 * Adres KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir ve kucultulurse iki
 * farkli token ayni koveya duser, bakiyeler birbirinin ustune yazilir.
 */
export function tokenBucketKey(chainId, address) {
    return `${chainId}_${address}`
}

/**
 * Anahtarda kullanilacak adresin harf kasasi kurali — TEK yer.
 *
 * `tokenBucketKey` adresi HAM alir (Home hem yazarken hem okurken AYNI satir
 * nesnesini kullanir, normalizasyona ihtiyaci yok). Ama tokenScope.js'in
 * `balanceKey`i IKI FARKLI KAYNAGI (depodaki ice aktarilmis tokenler ile arka
 * ucun arama sonuclari) ayni anahtar uzayinda tekillestiriyor: orada EVM
 * adresinin checksum'li mi kucuk harfli mi geldigi kaynaktan kaynaga degisir ve
 * kucultulmezse AYNI token listede IKI KEZ gorunur.
 *
 * Bu yuzden kucultme ADRESIN BICIMINE baglanir, zincire degil:
 *   - '0x' ile baslayan (EVM hex) adres KUCULTULUR — checksum yalnizca bir
 *     gosterim bicimidir, kimligin parcasi DEGILDIR.
 *   - Digerleri (base58 mint, 'native' isaretcisi, sembol) OLDUGU GIBI kalir.
 * Base58 alfabesinde '0' YOKTUR, yani bir Solana adresi bu dala ASLA giremez.
 *
 * SEMBOLLER DE KATLANMAZ — bu ACIK bir karar, ihmal degil (kod incelemesi,
 * Bulgu 3). Eski kod KOSULSUZ kucultuyordu ve SearchTokens.vue:43/86
 * `balanceKey(chainId, address || symbol)` yaziyor, yani buraya gercekten bir
 * TICKER ('USDT') ulasabiliyor. Sembolu katlamak icin onu bir mint'ten AYIRT
 * ETMEK gerekir ve BU MUMKUN DEGIL: base58 alfabesi A-Z'yi (I ve O haric)
 * icerir, 'USDT' bicimce gecerli bir base58 dizesidir. Yani "0x degilse
 * kucult" kurali bir mint'i de kucultur -- kabul edilemez. Sembolun katlanmamasi
 * hicbir seyi bozmaz: bu deger YALNIZCA bir Vue `:key`i olarak kullaniliyor
 * (tekillestirme yollari -- SelectAssets:271, SearchTokens:328, bridgeFrom:339 --
 * sembol yedegini HIC kullanmaz, dogrudan `address` gecer).
 */
export function normalizeKeyAddress(address) {
    const value = String(address ?? '')
    return /^0x/i.test(value) ? value.toLowerCase() : value
}

/**
 * Iki liste `tokenBucketKey(chainId,address)`e gore BIRLESTIRILIR: `preferred`
 * icindeki bir satirla AYNI anahtara sahip `base` satirlari ELENIR, `preferred`
 * satiri KAZANIR.
 *
 * KOK NEDEN (Task 16b review, F1): Home.vue'nun Solana dali
 * `[...evmImportedTokens.value, ...rows]` yaziyordu — kosulsuz birlestirme.
 * Kullanici zaten sahip oldugu bir mint'i ImportToken.vue ile ice aktarirsa
 * (Task 16b, madde 3) `evmImportedTokens` (imported_tokens['solana-mainnet']
 * kovasindan, `amount:0` ile) VE `rows` (useSolanaAssets'in canli okudugu GERCEK
 * bakiye) AYNI `tokenBucketKey`yi tasir. Toplam dongu (`applySolanaRows`)
 * `currentTokens.value`i GEZER ve HER satir icin `user.tokenBalances[key].value`i
 * ekler — ayni anahtar dizide IKI KEZ gecince (bakiye sozlugunde TEK kayit olsa
 * bile) o tutar IKI KEZ SAYILIR. 12.5 USDC @ $1 -> `user.usd = 25`.
 *
 * `preferred` kazanir cunku CANLI satir (gercek miktar, taze metadata) her zaman
 * ice-aktarilmis-ama-hic-guncellenmemis YER TUTUCUDAN (amount:0) daha DOGRUDUR.
 * Kullanicinin sahip OLMADIGI (yani `preferred` icinde YOK) ice aktarilmis bir
 * token ETKILENMEZ — o satir `base`de TEK basina kalir, davranis DEGISMEZ.
 */
export function dedupeTokenRows(base, preferred) {
    const baseList = Array.isArray(base) ? base : []
    const preferredList = Array.isArray(preferred) ? preferred : []

    const preferredKeys = new Set(preferredList.map((r) => tokenBucketKey(r.chainId, r.address)))
    const filteredBase = baseList.filter((r) => !preferredKeys.has(tokenBucketKey(r.chainId, r.address)))

    return [...filteredBase, ...preferredList]
}
