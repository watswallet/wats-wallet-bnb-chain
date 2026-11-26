// SPL mint -> metadata (symbol/name/logoURI/coingecko_id) toplu cozumu.
//
// PAYLASILAN katman: useSolanaAssets.js (bakiye listesi, Home/SelectAssets) VE
// History.vue'nun gecmis listesi AYNI /solana/tokens ucunu, AYNI kumeleme/
// hata-yalitma kurallarini kullanmali. Bu fonksiyon ONCEDEN useSolanaAssets.js
// icinde MODUL-OZEL idi (disari aktarilmiyordu); Task 14 review round 1 (Bulgu
// 5) SPL satirlarinin Gecmis'te kisaltilmis mint gosterdigini, oysa AYNI
// cuzdanin Home'da AYNI token icin sembolu ('USDC') zaten bildigini isaret
// etti — mint->sembol cozumu burada TEK yerde toplanip HER IKI ekran de
// BURADAN cagirirsa bu ayrisma bir daha olusamaz.
import { SOLANA_API_BASE } from './client'
import { SOLANA_ENABLED } from '../featureFlags'

// Sunucunun /solana/tokens sinirinin AYNASI (server/controllers/solanaController.js
// `mints.length > 100` -> 400). Iki ayri repo/dagitim oldugu icin PAYLASILAN bir
// sabit yok; bu yuzden deger burada yorumla birlikte tekrarlanir. Airdrop'la
// doldurulmus cuzdanlarda 100'den fazla SPL hesabi SIRADANDIR: tek istekte hepsi
// gonderilirse sunucu 400 doner ve TUM metadata haritasi (iyi bilinen tokenler
// dahil) bos kalirdi — her token mint kisaltmasina duserdi. Kumeler halinde
// istek atmak bir kumenin basarisiz olmasini digerlerinden YALITIR.
export const MINT_BATCH_SIZE = 100

// Her kume { map, complete } doner. `complete` sunucunun govde duzeyindeki
// `complete` alanidir: false = saglayici sorgulari tamamlanamadi (kalan mint'ler
// sonra tekrar sorulabilir). Alan YOKSA (eski sunucu) "tam" varsayilir.
async function fetchTokenMetadataBatch(mints) {
    try {
        const r = await fetch(`${SOLANA_API_BASE}/solana/tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mints }),
        })
        if (!r.ok) return { map: new Map(), complete: false }
        const body = await r.json()
        const list = Array.isArray(body?.tokens) ? body.tokens : []
        return { map: new Map(list.map(t => [t.mint, t])), complete: body?.complete !== false }
    } catch {
        // Metadata YARDIMCIDIR, zorunlu degil: uc duserse cagiran (bakiye
        // listesi de, gecmis listesi de) mint kisaltmasiyla calismaya devam
        // eder — bir metadata kesintisi ASLA listenin KENDISINI BOSALTMAMALI.
        return { map: new Map(), complete: false }
    }
}

// `complete`, Map'e numaralandirilamaz bir ozellik olarak eklenir: donus tipi
// Map KALIR, `[...map]`/`Object.keys` ve mevcut tuketiciler etkilenmez.
function withComplete(map, complete) {
    Object.defineProperty(map, 'complete', { value: complete, enumerable: false, writable: true, configurable: true })
    return map
}

/**
 * `mints` sunucunun 100'luk sinirina gore KUMELERE bolunur ve HER kume kendi
 * try/catch'i icinde (fetchTokenMetadataBatch) bagimsiz cagrilir. Bir kumenin
 * dusmesi digerlerinin metadata'sini SILMEZ — eski TEK istekli tasarimda 100'u
 * asan tek bir kume butun haritayi bos birakiyordu.
 *
 * Donen deger: `Map<mint, { mint, symbol, name, decimals, logoURI, coingecko_id }>`.
 * Bulunamayan mint'ler haritada YOKTUR (cagiran kendi fallback'ini -- mint
 * kisaltmasi -- uygular).
 *
 * Donen Map'in numaralandirilamaz `complete` ozelligi: tum kumeler 200 ve govde
 * `complete !== false` ise `true`; herhangi bir kume `complete:false`, `!r.ok`
 * veya fetch hatasi verdiyse `false`. Onbellek YOK; bu bilgiyi okuyan tuketici
 * henuz yok (UI notu ayri karar).
 */
export async function fetchTokenMetadata(mints) {
    if (!Array.isArray(mints) || mints.length === 0) return withComplete(new Map(), true)
    // SOLANA AG CIKIS SAVUNMASI (birlesme hazirligi B4): bayrak KAPALIYKEN /solana/tokens istegi HIC atilmaz; bos girdi
    // ile ayni sozlesme (bos harita, complete:true -- bu derlemede sorulacak bir sey yok, yeniden deneme anlamsiz).
    // Bu fonksiyon modulun tek disa acik yolu; fetch yalniz asagidaki kume cagrisinda. Bayrak acikken davranis aynen.
    if (!SOLANA_ENABLED) return withComplete(new Map(), true)

    const batches = []
    for (let i = 0; i < mints.length; i += MINT_BATCH_SIZE) {
        batches.push(mints.slice(i, i + MINT_BATCH_SIZE))
    }

    const results = await Promise.all(batches.map(fetchTokenMetadataBatch))

    const merged = new Map()
    for (const { map } of results) for (const [mint, meta] of map) merged.set(mint, meta)
    return withComplete(merged, results.every(b => b.complete))
}
