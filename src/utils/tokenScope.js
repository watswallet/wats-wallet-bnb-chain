/**
 * Token listelerinin AG KAPSAMI (scope).
 *
 * Token secme ekranlari eskiden yalnizca cuzdanin AKTIF agini gosteriyordu: baska
 * bir zincirdeki token'i gondermek icin kullanicinin basliktan ag degistirip
 * ekrana tekrar girmesi gerekiyordu. Artik ekranin kendi kapsami var: bir chainId
 * ya da "tum aglar".
 *
 * Buradaki fonksiyonlar SAFTIR: Pinia, chrome.storage ve Vue'ya dokunmazlar.
 * Zincir listesi ve aktif ag bilgisi parametre olarak gecirilir; testler
 * (client vitest ortami 'node') magazasiz kosar.
 */
import { ALL_NETWORKS } from './networkFilter'
import { normalizeBucketChainId, normalizeKeyAddress, tokenBucketKey } from './homeTokenBucket'

/**
 * Bakiye haritasi anahtari.
 *
 * Native varlik her zincirde '0x0' oldugu icin YALNIZ adrese gore anahtarlamak
 * "Tum Aglar" modunda zincirleri birbirine karistirir (Ethereum'un ETH miktari
 * BNB satirinda gorunur). Adres kucuk harfe indirilir: depodaki (imported)
 * adresler checksum'li, backend'den gelenler karisik yazimda olabiliyor.
 *
 * ANAHTAR BICIMI ARTIK homeTokenBucket.js'ten gelir — UCUNCU bir sozlesme
 * yazmamak icin. Onceden burada `Number(chainId)` ve KOSULSUZ `.toLowerCase()`
 * vardi; ikisi de Solana'da yanlisti:
 *   - `Number('solana-mainnet')` NaN'dir ve NaN her metin kimligi TEK bir
 *     'NaN_...' kovasinda toplar (iki farkli zincirin tokeni ayni satira duser),
 *   - base58 buyuk/kucuk harf DUYARLIDIR; kucultulen bir mint artik o mint
 *     degildir.
 * `normalizeKeyAddress` kucultmeyi yalnizca '0x' ile baslayan adreslere
 * uygular, yani EVM anahtarlari BIREBIR eskisi gibi uretilir (bkz. kendi testi).
 */
export function balanceKey(chainId, address) {
    return tokenBucketKey(normalizeBucketChainId(chainId), normalizeKeyAddress(address))
}

/**
 * `imported_tokens[account.key]` haritasini ({ [chainId]: Token[] }) duz listeye
 * cevirir. chainId KOVA anahtarindan alinir: kayittaki eski/eksik bir chainId
 * alani belirleyici degildir.
 */
export function flattenImportedTokens(byChain) {
    if (!byChain || typeof byChain !== 'object') return []

    const out = []
    for (const chainId of Object.keys(byChain)) {
        const list = byChain[chainId]
        if (!Array.isArray(list) || list.length === 0) continue
        for (const token of list) out.push({ ...token, chainId: Number(chainId) })
    }
    return out
}

/**
 * Kapsamin kapsadigi chainId'ler. Bos dizi "istek atmaya deger bir kapsam yok"
 * anlamina gelir; cagiran ag istegini hic yapmaz.
 */
export function scopeChainIds(scope, chains) {
    const list = Array.isArray(chains) ? chains : []

    if (scope === ALL_NETWORKS) {
        return list.map((c) => Number(c.chainId)).filter((id) => Number.isFinite(id))
    }

    // null/undefined/'' ONCE elenir: Number(null) === 0 ve 0 sonlu bir sayi.
    // Aksi halde kapsam henuz cozulmemisken chainId 0 icin istek atilirdi.
    if (scope === null || scope === undefined || scope === '') return []

    const id = Number(scope)
    return Number.isFinite(id) ? [id] : []
}

/**
 * Bir token'in bakiyesi hangi RPC'den okunur.
 *
 * Aktif zincir icin store'daki canli RPC kullanilir (findFastestRPC onu daha
 * hizlisina yukseltmis olabilir); diger zincirler icin pakete gomulu ilk RPC.
 * Home.vue capraz zincir bakiyeleri zaten boyle okuyor.
 */
export function rpcUrlFor(chainId, { activeChainId, activeRpc, chains } = {}) {
    const id = Number(chainId)
    if (!Number.isFinite(id)) return null

    if (activeRpc && Number(activeChainId) === id) return activeRpc

    const chain = (Array.isArray(chains) ? chains : []).find((c) => Number(c.chainId) === id)
    return chain?.rpc?.[0]?.url ?? null
}
