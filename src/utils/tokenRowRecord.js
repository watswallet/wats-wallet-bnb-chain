/**
 * Kullanicinin BASTIGI SATIRDAN uretilen varlik kaydi — saf katman.
 *
 * KOK NEDEN (kod incelemesi, Bulgu 1 -- Kritik): Token.vue kanonik kaydi
 * `/getTokenDataById`'den cekiyor. Metadata'si BULUNAMAYAN bir SPL satirinin
 * `coingecko_id`si `null` oldugu icin (useSolanaAssets bunu BILEREK yapiyor:
 * satiri listeden dusurmek "param kayboldu" gorunumu uretirdi) istek `id: null`
 * ile gidiyor, reddediliyor, `catch` yutuyor ve `token` NULL kaliyordu.
 * Gonder dugmesinin `v-if`i YOK: kullanici basiyor, `crypto.sendAsset = null`
 * yaziliyor ve Send.vue'nun `solanaMintOf` fonksiyonu
 * (`asset?.address || SOL_NATIVE_MARKER`) null'i NATIVE SOL'e ceviriyordu.
 * Kullanici SPL satirindan geldigini sanarken SOL imzaliyordu.
 *
 * `fetchTokenMetadata` HERHANGI bir istek hatasinda bos Map donuyor (bilerek),
 * yani tek bir metadata kesintisi BUTUN SPL satirlarini bu yola sokar.
 *
 * COZUM: satir zaten bir KIMLIK tasiyor (chainId + address + decimals + symbol).
 * Reddetmek yerine ondan bir kayit uretilir — kullanicinin bakiyesi GERCEK ve
 * gonderilebilmesi gerekiyor.
 *
 * AG YOK, DEPO YOK: yalnizca verilen satir okunur.
 */

// Sablon `token?.market_data.priceUSD` yaziyor: optional chaining YALNIZCA ilk
// halkayi korur, `market_data` eksik olan bir NESNE verilirse TypeError atar ve
// butun ekran coker. Bu yuzden kayit TAM SEKILLI uretilir.
function emptyMarketData() {
    return {
        priceUSD: 0,
        market_cap: 0,
        volume: 0,
        circulating_supply: 0,
        ath: 0,
        atl: 0,
        change: { h24: 0 },
        sparkline: { d7: [] },
    }
}

/**
 * Adresten okunabilir bir etiket. Base58 KUCULTULMEZ, yalnizca kirpilir.
 * useSolanaAssets'in `shortMint`i ile AYNI bicim (ilk 4 + son 4).
 */
export function shortAssetLabel(address) {
    const value = String(address ?? '')
    if (value.length <= 9) return value
    return `${value.slice(0, 4)}...${value.slice(-4)}`
}

/**
 * @param {object|null} row `crypto.selected_token_ref` bicimi:
 *   { id, chainId, address, decimals, symbol }
 * @returns {object|null} null = satir bir varligi TANIMLAMIYOR (adres yok);
 *   cagiran bu durumda akisi SURDURMEMELI.
 */
export function rowTokenRecord(row) {
    if (!row || !row.address) return null

    const label = row.symbol || shortAssetLabel(row.address)
    const record = {
        name: row.name || label,
        symbol: label,
        // Fiyat gecmisi YOK: grafik bu alana bakip gizleniyor. `undefined` degil
        // ACIKCA null -- "henuz yuklenmedi" ile "yok" ayri durumlar.
        coingecko_id: null,
        image: { thumb: '', small: '', large: '' },
        chainId: row.chainId,
        address: row.address,
        market_data: emptyMarketData(),
    }

    // Ondalik TAHMIN EDILMEZ. Satir tasimiyorsa alan hic YAZILMAZ; Send.vue'nun
    // kendi `?? SOL_DECIMALS` varsayilani devreye girer.
    if (Number.isInteger(row.decimals)) record.decimals = row.decimals

    return record
}
