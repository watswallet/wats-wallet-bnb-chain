import { solanaRpc } from './client'
import { computeBalanceDelta } from './balanceDelta'

// Islem simulasyonu + ucret okuma -- FAIL-OPEN: hicbir yol firlatmaz.
//
// GUVEN SINIRI (Constraint 16/24): sonuc UCUNCU TARAF saglayicidan gelir ve yalniz
// ekranda "tahmini bakiye degisimi" gostermek icindir; imza KARARINI baglamaz
// (tek istisna: kullanicinin kendi kor-imza onay kutusu). Simulasyon ile gercek
// yurutme farkli olabilir (Clock/slot'a bagli program). `accounts` parametresi
// BILEREK kullanilmaz (Q11): yetki/izin degisiklikleri simulasyondan okunmaz,
// ekranda sabit `balanceNoPermissionNote` ile "gosterilemez" denir.

const DEFAULT_TIMEOUT_MS = 6000
const DEFAULT_CONCURRENCY = 3
const DEFAULT_BUDGET_MS = 8000

const SIM_OPTIONS = Object.freeze({
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'processed',
})

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Gecerli ucret (negatif olmayan guvenli tamsayi, lamports) -> bigint, aksi halde null. */
function feeOf(v) {
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null
}

/**
 * Hata -> sonuc nedeni. Iptal (SOLANA_RPC_ABORTED: butce doldu / kullanici
 * vazgecti) de "hesaplanamadi"dir; ekranda zaman asimiyla ayni sonuc, yeni bir
 * neden kodu uretilmez.
 */
function reasonOf(e) {
    const m = e?.message
    return m === 'SOLANA_RPC_TIMEOUT' || m === 'SOLANA_RPC_ABORTED' ? 'timeout' : 'rpc_error'
}

/**
 * Toplam ag ucreti (taban + oncelik) -- `getFeeForMessage`. Hata/gecersiz
 * deger -> `null`, ASLA firlatmaz.
 *
 * @param {Function} rpc `(method, params, { signal, timeoutMs })`
 * @param {string} messageBase64 Imza bolumu AYIKLANMIS mesaj baytlarinin base64'u
 * @returns {Promise<bigint|null>}
 */
export async function fetchFeeForMessage(rpc, messageBase64, { signal, timeoutMs } = {}) {
    if (typeof messageBase64 !== 'string' || messageBase64 === '') return null
    try {
        const res = await rpc('getFeeForMessage', [messageBase64, { commitment: 'processed' }], { signal, timeoutMs })
        return feeOf(res?.value)
    } catch {
        return null
    }
}

/**
 * Hesap anahtari listesi (preBalances ile ayni sira): cagiranin verdigi liste +
 * simulasyon yanitinin `loadedAddresses.writable` + `.readonly` adresleri.
 * Cagiran ALT'yi ZATEN cozmus (tam liste verdi) ise yedek EKLENMEZ. Uzunluk
 * `preBalances` ile eslesmezse yedek ATILIR (bos/uyusmayan liste -> computeBalanceDelta
 * `unusable` der). Yedek de dapp'ten degil zincirden gelir.
 */
function fullKeyList(accountKeys, value) {
    const loaded = value.loadedAddresses
    if (
        isRecord(loaded) && Array.isArray(loaded.writable) && Array.isArray(loaded.readonly) &&
        [...loaded.writable, ...loaded.readonly].every((k) => typeof k === 'string')
    ) {
        const extended = [...accountKeys, ...loaded.writable, ...loaded.readonly]
        const preLen = Array.isArray(value.preBalances) ? value.preBalances.length : -1
        if (extended.length > accountKeys.length && extended.length === preLen) return extended
    }
    return accountKeys
}

/**
 * Tek islemi simule eder.
 *
 * @param {{base64Tx: string, messageBase64?: string, accountKeys: string[], user: string,
 *   rpc?: Function, timeoutMs?: number, signal?: AbortSignal}} args
 *   `messageBase64`: imza bolumu AYIKLANMIS mesaj (`parsed.tx` uzerinden serilestirilir;
 *   yalniz ucret yedegi icin). `accountKeys`: static hesap anahtarlari (ALT cozulmusse
 *   tam liste de olabilir).
 * @returns {Promise<{ok:true, solDeltaLamports:bigint, feeLamports:bigint|null,
 *   tokenDeltas:{mint:string, delta:bigint, decimals:number}[], tokensUnreadable:boolean, partial:boolean}
 *   | {ok:false, reason:'program_error'|'unusable'|'timeout'|'rpc_error'}>}
 */
export async function simulateTx(args) {
    try {
        // Destructuring try ICINDE (SU-5): null/undefined arguman TypeError ile reddedilmez, `unusable` olur.
        const {
            base64Tx, messageBase64, accountKeys, user, rpc = solanaRpc, timeoutMs = DEFAULT_TIMEOUT_MS, signal,
        } = args ?? {}
        if (typeof base64Tx !== 'string' || base64Tx === '' || !Array.isArray(accountKeys)) {
            return { ok: false, reason: 'unusable' }
        }
        // Gecersiz user ile RPC'ye GITMEYIZ (SU-5): sonuc zaten `unusable` olurdu (computeBalanceDelta),
        // bos yere simulasyon istegi atilmaz.
        if (typeof user !== 'string' || user === '') return { ok: false, reason: 'unusable' }

        let res
        try {
            res = await rpc('simulateTransaction', [base64Tx, { ...SIM_OPTIONS }], { signal, timeoutMs })
        } catch (e) {
            return { ok: false, reason: reasonOf(e) }
        }

        const value = res?.value
        if (!isRecord(value)) return { ok: false, reason: 'unusable' }

        // Basari YALNIZ `err` alani VAR ve null iken (E-a): gercek RPC her zaman `err: null` verir; alan
        // yoksa (bozuk/yarim yanit) sonuc `unusable` olur, basari sayilmaz. null DISINDA her deger
        // (0, '' dahil) programin basarisiz oldugu anlamina gelir. Basarisiz simulasyonun bakiye/token
        // verisi GUVENILMEZ ve gosterilmez: yanlis bir "degisiklik yok" yanlis guven verirdi.
        if (!('err' in value) || value.err === undefined) return { ok: false, reason: 'unusable' }
        if (value.err !== null) return { ok: false, reason: 'program_error' }

        const delta = computeBalanceDelta({ value, accountKeys: fullKeyList(accountKeys, value), user })
        if (!delta.ok) return { ok: false, reason: 'unusable' }

        // Ucret: simulasyonun `fee`'si -> getFeeForMessage -> null. Yerel hesap YOK
        // (limit x fiyat / 1e6 varsayilan CU yuzunden yanlis cikar).
        let feeLamports = feeOf(value.fee)
        if (feeLamports === null) feeLamports = await fetchFeeForMessage(rpc, messageBase64, { signal, timeoutMs })

        return {
            ok: true,
            solDeltaLamports: delta.solDeltaLamports,
            feeLamports,
            tokenDeltas: delta.tokenDeltas,
            tokensUnreadable: delta.tokensUnreadable,
            partial: delta.partial,
        }
    } catch {
        return { ok: false, reason: 'unusable' }
    }
}

/**
 * Cok islem (signAll): her islem AYRI simule edilir; birbirine bagli islemler
 * farkli sonuc verebilir. Sonuc dizisi girdi siralidir.
 *
 * Toplam `budgetMs` dolunca devam eden istekler IPTAL edilir (fetch gercekten
 * kesilir) ve baslamamis olanlar rpc'ye HIC gitmeden `timeout` olur; biten
 * sonuclar korunur. Disaridan gelen `signal` ayni sekilde calisir.
 *
 * @param {{base64Tx: string, messageBase64?: string, accountKeys: string[]}[]} txs
 * @param {{user: string, rpc?: Function, concurrency?: number, budgetMs?: number,
 *   timeoutMs?: number, signal?: AbortSignal}} options
 */
export async function simulateMany(txs, {
    user, rpc = solanaRpc, concurrency = DEFAULT_CONCURRENCY, budgetMs = DEFAULT_BUDGET_MS, timeoutMs, signal,
} = {}) {
    const list = Array.isArray(txs) ? txs : []
    const results = new Array(list.length)
    if (list.length === 0) return results

    const budget = new AbortController()
    const timer = setTimeout(() => budget.abort(), budgetMs)
    const outer = () => budget.abort()
    if (signal?.aborted) budget.abort()
    else signal?.addEventListener('abort', outer)

    const width = Math.max(1, Math.min(list.length, Number.isFinite(concurrency) ? Math.floor(concurrency) : DEFAULT_CONCURRENCY))
    let next = 0
    const worker = async () => {
        while (next < list.length) {
            const i = next++
            if (budget.signal.aborted) {
                results[i] = { ok: false, reason: 'timeout' }
                continue
            }
            const t = list[i]
            results[i] = await simulateTx({
                base64Tx: t?.base64Tx,
                messageBase64: t?.messageBase64,
                accountKeys: t?.accountKeys,
                user,
                rpc,
                signal: budget.signal,
                ...(timeoutMs === undefined ? {} : { timeoutMs }),
            })
        }
    }

    try {
        await Promise.all(Array.from({ length: width }, worker))
    } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', outer)
    }
    return results
}
