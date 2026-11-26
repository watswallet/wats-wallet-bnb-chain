// Takas "Alinan" secicisinde SUNUCU aramasi.
//
// CANLI BULGU 2026-11-20: arama kutusu yalniz YUKLU sayfanin (populer siradaki ilk 50 token) icinde ariyordu.
// Sunucunun /getChainTokens `search` alani hic kullanilmiyordu; BSC'de "usdc" yazinca USDC bulunamadi, sunucuya
// ayni arama sorulunca bulundu. Bu modul yazma bitince (gecikmeli) tek bir sunucu aramasi yapar; gec gelen eski
// yanit yeni aramanin sonucunu ezmez. Saf: ag ve zamanlayici disaridan verilir.
export const REMOTE_SEARCH_MIN_LENGTH = 2
export const REMOTE_SEARCH_DELAY_MS = 300

/**
 * @param {{ fetchTokens: (query: string) => Promise<Array>, onResult: (r: { query: string, tokens: Array }) => void,
 *           delayMs?: number }} opts
 * @returns {{ request: (query: string) => void, cancel: () => void }}
 *   request: kisa sorgu (< 2 karakter) sunucuya gitmez ve sonucu hemen bosaltir. Hata ya da dizi olmayan yanit bos
 *   sonuc verir; firlatmaz. cancel: bekleyen ve suren aramanin sonucunu dusurur.
 */
export function createRemoteTokenSearch({ fetchTokens, onResult, delayMs = REMOTE_SEARCH_DELAY_MS }) {
    let timer = null
    let seq = 0

    const clear = () => {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
    }

    function request(rawQuery) {
        clear()
        const id = ++seq
        const query = typeof rawQuery === 'string' ? rawQuery.trim() : ''
        if (query.length < REMOTE_SEARCH_MIN_LENGTH) {
            onResult({ query, tokens: [] })
            return
        }
        timer = setTimeout(async () => {
            timer = null
            let tokens = []
            try {
                const r = await fetchTokens(query)
                tokens = Array.isArray(r) ? r : []
            } catch {
                tokens = []
            }
            if (id === seq) onResult({ query, tokens })
        }, delayMs)
    }

    function cancel() {
        clear()
        seq++
    }

    return { request, cancel }
}

/**
 * Secicinin arama sonucu: yerel eslesmeler + (sorgu AYNIYSA) sunucunun bulduklari, tekil; tam sembol eslesmesi once.
 * `remote` baska bir sorguya aitse (yazma surerken) yalniz yerel eslesmeler doner. `keep` sunucu satirlarina da
 * secicinin kendi suzgecini (hisse dislama, logosuz, ice aktarilmis / secili token) uygulamak icindir.
 */
export function combineSearchResults({ localMatches, remote, query, keep = () => true }) {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
    const remoteRows = remote && typeof remote.query === 'string' && remote.query.toLowerCase() === q && Array.isArray(remote.tokens)
        ? remote.tokens.filter((t) => t && keep(t))
        : []
    const merged = mergeTokenLists(localMatches, remoteRows)
    const exact = (t) => (t.symbol || '').toLowerCase() === q
    return [...merged.filter(exact), ...merged.filter((t) => !exact(t))]
}

// Birlesik liste: once `primary`, ardindan `secondary`nin yenileri. Adres (harf duyarsiz) ile tekil: sunucu
// adresleri kucuk harf, depodaki ice aktarilmis kayitlar checksum'li olabilir.
export function mergeTokenLists(primary, secondary) {
    const seen = new Set()
    const out = []
    for (const token of [...(primary || []), ...(secondary || [])]) {
        if (!token || typeof token.address !== 'string') continue
        const key = token.address.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push(token)
    }
    return out
}
