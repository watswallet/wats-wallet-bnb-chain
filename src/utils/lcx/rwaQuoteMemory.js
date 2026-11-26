// RWA TEKLIF KAYDI -- quoteId -> { issuer, chainId, stock, side } (Bolum 2, Gorev 5). Bellek ici: hizmet iscisi her an olebilir,
// kalici depoya HICBIR sey yazilmaz.
//
// NEDEN VAR: hisse ALIMI ilk alim kapisindan gecer ve kapi ihracciya bakar (evaluateIssuer). Teklifi gosteren yol ihracciyi LCX
// yanitindan (dogrulanmis: katalog satiriyla eslesti) kaydeder; yurutme (Gorev 6) kapiyi bu kayittaki ihracciyla sorar. Kayit
// yoksa (teklifle onay arasinda hizmet isci yeniden basladi ya da omur doldu) cagiran alimi LCX_REQUOTE ile durdurur: kapi ATLANMAZ.
// Bu modul yalniz saklar; kararlar background.js'tedir.
//
// Omur 130 000 ms: LCX teklifi ~120 sn gecerlidir, 10 sn pay. En cok 64 kayit (en eskisi atilir).
export const RWA_QUOTE_TTL_MS = 130_000
export const RWA_QUOTE_MAX = 64

const memory = new Map() // quoteId -> { info, at }

const validId = (quoteId) => typeof quoteId === 'string' && quoteId !== ''

/**
 * Teklifi kaydeder (kopya saklanir). Bos / dize olmayan quoteId sessizce yok sayilir. Ayni quoteId yeniden yazilirsa en yeni sayilir.
 * @param {string} quoteId
 * @param {{ issuer: string, chainId: number, stock: string, side: 'buy'|'sell' }} info
 * @param {number} [now]
 */
export function rememberRwaQuote(quoteId, info, now = Date.now()) {
    if (!validId(quoteId)) return
    memory.delete(quoteId) // Map ekleme sirasini korur: yeniden yazilan kayit en yeni
    memory.set(quoteId, { info: { ...info }, at: now })
    while (memory.size > RWA_QUOTE_MAX) memory.delete(memory.keys().next().value)
}

/**
 * Kaydi dondurur (kopya) ya da yok / suresi dolmus ise null (suresi dolmus kayit silinir). `>`: tam 130 000 ms yasindaki kayit gecerlidir.
 * @param {string} quoteId
 * @param {number} [now]
 * @returns {{ issuer: string, chainId: number, stock: string, side: 'buy'|'sell' } | null}
 */
export function recallRwaQuote(quoteId, now = Date.now()) {
    if (!validId(quoteId)) return null
    const hit = memory.get(quoteId)
    if (!hit) return null
    if (now - hit.at > RWA_QUOTE_TTL_MS) {
        memory.delete(quoteId)
        return null
    }
    return { ...hit.info }
}

/** YALNIZ testler: kaydi bosaltir. */
export function _resetRwaQuotes() {
    memory.clear()
}
