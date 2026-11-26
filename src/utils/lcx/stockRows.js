// LCX HISSE SATIRLARI -- GET /lcx/stocks sonucunun chrome.storage.local onbellegi ve dinamik katalog katmaninin yukleyicisi
// (Bolum 2). Katalog katmani tokenizedStocks.js'tedir (setLcxStockRows); bu modul onu depodan ve agdan besler.
//
// Depo kaydi (LCX_STOCK_ROWS_KEY): { fetchedAt: ms, asOf: ms|null, usEquitiesOpen: boolean, rows: SUNUCU SATIRLARI }.
// Satirlar HAM (sunucu bicimi) saklanir ve her yuklemede yeniden dogrulanir: dogrulama kurallari degisirse eski kayit
// kendiliginden yeni kurala uyar. `asOf` listenin LCX'ten yuklendigi an; `usEquitiesOpen` o kadar bayat olabilir (sunucu
// son iyi listeyi 24 saate dek sunar), bu yuzden ikisi birlikte tutulur.
//
// YUKLU KAYIT: bu modul dinamik katmana en son hangi kayitla satir kurdugunu (`fetchedAt`) tutar. Depodaki kayit yalniz KATMANDA yuklu olandan
// DAHA YENI ise uygulanir (servis isci uzun yasar, popup depoyu 60 sn'de bir tazeler; eski kayit daha yeni bellek satirlarini asla ezmez).
// ROZET: `usEquitiesOpen` sunucuda 24 saate dek bayat sunulabilir; `asOf` 30 dakikadan eskiyse ya da yoksa piyasa rozeti gosterilmez
// (tokenizedStocks.js marketStatusFresh), bu yuzden her kurulumda `asOf` ve `now` birlikte gecirilir.
//
// BAYRAGA VE GIZLI MODA BAKMAZ: ikisini de cagiran denetler (sekme, arka plan acilisi). Depodan okumak ag istegi degildir;
// refreshLcxStockRows ise ag ISTEGI atar, gizli modda cagrilmamalidir (privateRequestCoverage '/lcx/stocks' kaydi).
import { setLcxStockRows, lcxStockRows } from '../tokenizedStocks'
import { fetchLcxStocks } from './client.js'

export const LCX_STOCK_ROWS_KEY = 'lcx_stock_rows'

// Varsayilan depo cagri aninda cozulur (testte chrome tanimsiz olabilir).
const localStore = (storage) => storage ?? globalThis.chrome?.storage?.local

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

// Depo kaydi gecerli degilse null: bozuk kayit yoklukla ayni sayilir (yeniden cekilir), satir kurmaz.
async function readRecord(storage) {
    const st = localStore(storage)
    if (!st) return null
    try {
        const out = await st.get(LCX_STOCK_ROWS_KEY)
        const rec = out?.[LCX_STOCK_ROWS_KEY]
        if (!isObject(rec) || !Number.isFinite(rec.fetchedAt) || !Array.isArray(rec.rows) || typeof rec.usEquitiesOpen !== 'boolean') return null
        return rec
    } catch {
        return null
    }
}

// Katmana en son bu modulun kurdugu liste: { fetchedAt, list }. `list` kurulum anindaki dondurulmus dizidir (her setLcxStockRows /
// _resetLcxStockRows yenisini kurar): katman baska yolla degistiyse kimlik eslesmez ve "yuklu kayit yok" sayilir.
let loaded = null

const loadedFetchedAt = () => (loaded !== null && loaded.list === lcxStockRows() ? loaded.fetchedAt : null)
const nowOf = (now) => (typeof now === 'function' ? now() : now)

function markLoaded(fetchedAt) {
    loaded = { fetchedAt, list: lcxStockRows() }
}

// Kaydi katmana kurar. Katmanda yuklu kayit yoksa ya da kayit ondan DAHA YENIyse uygular; aksi halde eldeki satirlara dokunmaz.
function applyRecord(rec, at) {
    const current = loadedFetchedAt()
    if (current !== null && !(rec.fetchedAt > current)) return
    setLcxStockRows(rec.rows, { usEquitiesOpen: rec.usEquitiesOpen, asOf: rec.asOf, now: at })
    markLoaded(rec.fetchedAt)
}

/**
 * Depodaki satirlari dinamik katmana yukler. YALNIZ depo okur: ag yok, yas siniri yok (kimlik amacli okuma: dislama ve
 * kapi, eski liste de yine dislar). Depo bos ya da bozuksa eldeki satirlara dokunmaz. Kayit YALNIZ katmanda yuklu kayittan daha
 * yeniyse (ya da yuklu kayit yoksa) uygulanir: ucuz bir depo okumasidir, servis isci her istekte cagirabilir.
 * @param {{ storage?: { get: Function }, now?: (() => number) | number }} [opts]
 * @returns {Promise<number>} yukleme sonrasi dinamik katmandaki satir sayisi
 */
export async function hydrateLcxStockRows({ storage, now = Date.now } = {}) {
    const rec = await readRecord(storage)
    if (rec) applyRecord(rec, nowOf(now))
    return lcxStockRows().length
}

let inflight = null

async function refresh({ maxAgeMs, storage, fetchImpl, now }) {
    const at = nowOf(now)

    const rec = await readRecord(storage)
    // Taze depo: ag yok. Gelecekteki fetchedAt (saat geri alinmis) taze SAYILMAZ, yoksa saat duzelene dek yenilenmezdi.
    if (rec && Number.isFinite(maxAgeMs) && at - rec.fetchedAt >= 0 && at - rec.fetchedAt <= maxAgeMs) {
        applyRecord(rec, at)
        return { ok: true, count: lcxStockRows().length, fetched: false }
    }

    let fetched
    try {
        fetched = await fetchLcxStocks({ fetchImpl })
    } catch {
        // Eldeki satirlar (bellekteki ya da hydrate ile yuklenen) KORUNUR: gecici bir ariza listeyi silmez.
        return { ok: false, count: lcxStockRows().length, fetched: false }
    }

    const count = setLcxStockRows(fetched.rows, { usEquitiesOpen: fetched.usEquitiesOpen, asOf: fetched.asOf, now: at })
    markLoaded(at)
    const st = localStore(storage)
    if (st) {
        try {
            await st.set({
                [LCX_STOCK_ROWS_KEY]: { fetchedAt: at, asOf: fetched.asOf, usEquitiesOpen: fetched.usEquitiesOpen, rows: fetched.rows },
            })
        } catch {
            // Depo yazilamadi (kota vb.): bellekteki satirlar gecerli, sonraki cagri yeniden ceker.
        }
    }
    return { ok: true, count, fetched: true }
}

/**
 * Dinamik katmani tazeler. TEK UCUS: aralarinda bitmemis bir cagri varken gelen cagri ayni sonucu bekler, ikinci istek atmaz.
 * Depo `maxAgeMs`'ten tazeyse (yas 0..maxAgeMs) ag yok, depodaki satirlar kurulur; `maxAgeMs` verilmezse her zaman ceker.
 * Basarisizlikta eldeki satirlar korunur ve `{ ok: false }` doner; firlatmaz.
 * @param {{ maxAgeMs?: number, storage?: object, fetchImpl?: typeof fetch, now?: (() => number) | number }} [opts]
 * @returns {Promise<{ ok: boolean, count: number, fetched: boolean }>}
 */
export function refreshLcxStockRows({ maxAgeMs, storage, fetchImpl, now = Date.now } = {}) {
    if (inflight) return inflight
    inflight = refresh({ maxAgeMs, storage, fetchImpl, now }).finally(() => {
        inflight = null
    })
    return inflight
}
