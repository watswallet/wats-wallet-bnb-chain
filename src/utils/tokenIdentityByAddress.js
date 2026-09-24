/**
 * Adresten kurtarilan fiyat kimliginin ZINCIR DOGRULAMASI — saf katman.
 * AG YOK, DEPO YOK: yalnizca verilen iki nesne okunur.
 *
 * NEDEN VAR: bir satirin `coingecko_id`si eksik oldugunda Token.vue kimligi
 * sunucunun /getTokenByAddress ucundan (server/router.js:17) kurtarir. O uc TEK
 * BASINA GUVENILMEZ ve iki sebebi de CANLI OLCULDU (2026-09-18):
 *
 *   1. Govdedeki chainId'yi YOK SAYAR. `{"address":"EQCxE6mU...","chainId":1}`
 *      gonderildi, cevap yine chainId:-239 ile geldi -- handler yalnizca
 *      `address` okuyor (server/controllers/tokenController.js:503).
 *   2. DB kolunda `address` BENZERSIZ DEGIL (server/models/Token.js). Olculen
 *      somut tuzak: `{"address":"0x4200000000000000000000000000000000000006"}`
 *      -> coingecko_id "bridged-wrapped-ethereum-bob-network", chain
 *      "bob-network" -- oysa ayni adres Base/Optimism gibi bircok zincirde
 *      BASKA bir varliktir.
 *
 * Dogrulamasiz kabul etmek, kullaniciya BASKA bir tokenin fiyatini bu tokenin
 * fiyati diye gostermek olurdu. YANLIS fiyat EKSIK fiyattan KOTUDUR, cunku
 * kullanici ona bakip alim/satim karari verir -- server/data/tonJettons.js'in
 * STON kararindaki AYNI olcut. Bu yuzden kimlik ancak cevabin satirla AYNI
 * zincire ait oldugu KANITLANDIGINDA doner; kanit yoksa `null`.
 *
 * IKI KANIT BICIMI VAR, cunku ucun iki kolu farkli sekilli cevap veriyor:
 *   - KURASYONLU kol (TON jettonlari, SPL) chainId DAMGALAR -> birebir esitlik.
 *   - DB kolu chainId TASIMAZ, yalniz CoinGecko platform kimligi olan `chain`
 *     alani vardir -> zincir kaydinin `chainSlug`i ile karsilastirilir (o alanin
 *     degerleri tam olarak bu platform kimlikleridir, bkz.
 *     data/supportedChainsSlug.test.js).
 *
 * BILINEN VE KABUL EDILEN SINIR: sunucu `chain` alaninda alias'lari da kabul
 * ediyor ('polygon' ~ 'polygon-pos'). Cuzdanin slug'i ile birebir esitlik
 * aradigimiz icin boyle bir kayit REDDEDILIR -- yani kurtarma calismaz ve satir
 * bugunku haliyle (fiyatsiz) kalir. Bu, YANLIS zincire eslesme riskini almaktansa
 * BILEREK secilen taraftir; genisletmek gerekirse alias tablosu SUNUCUDAN
 * (server/utils/chainTokens.js) tasinmali, burada TAHMIN EDILMEMELIDIR.
 */
import { isSameChainId } from './vm'
import { isResolvableChainId } from './chainIdentity'
import { ALL_CHAINS } from '../data/chains'

/**
 * @param {object|null} serverToken /getTokenByAddress cevabindaki `token`
 * @param {object|null} row `crypto.selected_token_ref` bicimi ({ chainId, address, ... })
 * @returns {string|null} dogrulanmis coingecko_id, ya da null (kanit yok)
 */
export function recoveredCoingeckoId(serverToken, row) {
    const id = serverToken?.coingecko_id
    if (typeof id !== 'string' || !id) return null
    // Satirin kendi zinciri cozulemiyorsa karsilastirilacak bir sey YOK.
    if (!row || !isResolvableChainId(row.chainId)) return null

    // 1. KURASYONLU KOL: cevap chainId damgalar. Karsilastirma isSameChainId ile
    //    (bu depodaki DIGER her kimlik karsilastirmasiyla ayni olcut): `Number()`
    //    Solana'nin METIN kimligini NaN yapar ve `NaN === NaN` false'tur.
    if (isResolvableChainId(serverToken.chainId)) {
        return isSameChainId(serverToken.chainId, row.chainId) ? id : null
    }

    // 2. DB KOLU: yalniz `chain` slug'i var.
    const chain = ALL_CHAINS.find(c => isSameChainId(c.chainId, row.chainId))
    const slug = typeof chain?.chainSlug === 'string' ? chain.chainSlug.trim().toLowerCase() : ''
    const donen = typeof serverToken.chain === 'string' ? serverToken.chain.trim().toLowerCase() : ''
    if (!slug || !donen) return null

    return donen === slug ? id : null
}
