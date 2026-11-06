// EVM kullanim yoklamasi: bir adres 10 EVM aginin HERHANGI BIRINDE kullanilmis mi.
//
// "Kullanilmis" = `eth_getTransactionCount(adres, 'latest') > 0` VEYA
// `eth_getBalance(adres, 'latest') > 0` VEYA o agin SABIT token listesindeki (bkz.
// evmUsageTokens.js) herhangi bir tokenin `balanceOf(adres) > 0`. Seed import'unda
// turetilmis hesaplari bulmak icin accountScan.js bunu indeks indeks cagirir (bkz. Bolum A).
//
// TOKEN SINYALI (kullanici karari 2026-11-03, "bulunsun"): yalniz token almis, hic islem
// yapmamis hesap (nonce 0, yerli bakiye 0) da taramada kaybolmasin. Ag basina EK BIR cagri:
// Multicall3.aggregate3 (allowFailure=true) ile tum balanceOf'lar tek eth_call'da.
//   - Token cagrisi hata verir/zaman asimina ugrar/bozuk yanit doner -> o ag icin token
//     sinyali "yok" sayilir; nonce/bakiye sonucu AYNEN korunur.
//   - "Tum aglar hata" (-> 'failed') yalniz nonce+bakiye cagrilarina bakar; token cagrisinin
//     basarisi ya da hatasi bunu degistirmez. (Token bakiyesi POZITIF ise hesap yine
//     kullanilmistir: pozitif kanit hata sayimindan once gelir.)
//   - Ag icin chain.tokens bos/yoksa (Multicall3 dogrulanmamis ya da test) token cagrisi ATILMAZ.
//
// NEDEN HAM fetch (ethers JsonRpcProvider DEGIL):
//   - Iptal edilebilirlik: bir ag 'used' dedigi anda ya da kullanici "Atla" dedigi
//     anda bekleyen istekler GERCEKTEN kesilmeli (AbortController). JsonRpcProvider
//     istegi iptal ettirmez, arka planda asili kalir ve yeniden deneme yapar.
//   - evmReadRpc.js ile ayni gerekce: ham fetch hatayi sarmadan, zaman asimini ve
//     iptali biz yonetiriz.
//
// URL'LER: `rpcUrlsOf` ile PAKETLI supportedChains verisinden gelir. Depodaki
// `currentNetwork.rpc` (kullanici/uzak veri) ASLA kullanilmaz.
//
// SOZLESME: probeEvmAddress ASLA firlatmaz; sonuc 'used' | 'unused' | 'failed'.
//   - 'used'   : en az bir agda nonce, yerli bakiye ya da sabit listedeki bir token
//                bakiyesi > 0.
//   - 'unused' : en az bir ag nonce/bakiye icin yanit verdi ve hicbirinde nonce/bakiye/
//                token > 0 yok.
//   - 'failed' : hicbir agin nonce/bakiye cagrisi yanit vermedi (hepsi hata/zaman asimi)
//                ya da yoklama iptal edildi (yarim yoklama 'unused' sayilamaz: iptal
//                edilen ag belki kullanilmisti).
// Tek bir agin hatasi 'unused' sayilir (tarama kurali: o ag o indeks icin bos);
// yalniz TUM aglar hata verince 'failed' doner.
//
// CAGRI SAYISI: saglikli bir URL'de ag basina en cok 3 cagri (nonce + bakiye + multicall).
// Yedek URL'ye yalniz ilk URL'nin nonce VE bakiye cagrilari hata verince gecilir; ilk URL
// token yanitini zaten coz(ebil)diyse yedek URL'de token cagrisi TEKRARLANMAZ.
//
// Chrome 115: `AbortSignal.any` yok (116+); iptal ve zaman asimi elle
// AbortController + setTimeout ile baglanir.
import supportedChains from '../data/supportedChains'
import { chainVm, rpcUrlsOf } from './vm'
import { MULTICALL3_ADDRESS, usageTokenAddressesFor } from './evmUsageTokens'
import { encodeBalancesCall, decodeBalancesResult, anyPositive } from './multicallBalances'

// Tek bir JSON-RPC cagrisi icin ust sure; asilirsa cagri hata sayilir.
export const PROBE_CALL_TIMEOUT_MS = 4000

// Bir URL'de ayni anda sorulan iki yontem.
const PROBE_METHODS = ['eth_getTransactionCount', 'eth_getBalance']

const HEX_RE = /^0x[0-9a-fA-F]+$/

/**
 * Yoklanacak EVM aglari: yalniz VM'i 'evm' olan ve en az bir RPC'si bulunan
 * kayitlar (Solana ve TON elenir). Gercek veride 10 ag. Sabit token listesi olan
 * (ve Multicall3'u dogrulanmis) aglara `tokens` (adres dizisi) eklenir.
 *
 * @returns {Array<{chainId: number, urls: string[], tokens?: string[]}>}
 */
export function scanChains(chains = supportedChains) {
    return chains
        .filter((c) => chainVm(c) === 'evm')
        .map((c) => {
            const tokens = usageTokenAddressesFor(c.chainId)
            const base = { chainId: c.chainId, urls: rpcUrlsOf(c) }
            return tokens.length > 0 ? { ...base, tokens } : base
        })
        .filter((c) => c.urls.length >= 1)
}

// Tek RPC cagrisi -> hex `result` dizgesi (basarili) | null (herhangi bir hata). ASLA firlatmaz.
// Hata sayilanlar: fetch reddi, !res.ok, JSON-RPC `error` alani, hex olmayan
// `result`, zaman asimi, iptal.
async function callRpc(url, method, params, ctx) {
    // Iptal edilmisse yeni istek ACILMAZ: 'abort' olayi bir daha atesmez, kontrol
    // olmasa istek zaman asimina kadar bos yere beklerdi (ve Atla'dan sonra
    // gereksiz RPC trafigi cikardi).
    if (ctx.isAborted()) return null

    // Cagri basina denetleyici: kendi zaman asimi + ortak iptale baglanti.
    const ctrl = new AbortController()
    const onShared = () => ctrl.abort()
    ctx.shared.signal.addEventListener('abort', onShared, { once: true })
    const timer = setTimeout(() => ctrl.abort(), ctx.timeoutMs)

    // fetchImpl iptal sinyalini dinlemese bile cagri birakilabilsin diye yaris.
    const aborted = new Promise((_, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })

    // fetch'i `ctx.fetchImpl(...)` diye cagirmak `this`'i ctx yapar; tarayicida
    // window.fetch baska bir nesne uzerinden cagrilinca "Illegal invocation" firlatir
    // ve her yoklama sessizce 'failed' olurdu. Yerel degiskenle yalin cagri yapilir.
    const { fetchImpl } = ctx
    const run = async () => {
        const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            cache: 'no-store',
            signal: ctrl.signal,
        })
        if (!res || !res.ok) return null
        const json = await res.json()
        if (!json || typeof json !== 'object' || (json.error !== undefined && json.error !== null)) return null
        if (typeof json.result !== 'string' || !HEX_RE.test(json.result)) return null
        return json.result
    }

    try {
        return await Promise.race([run(), aborted])
    } catch (e) {
        return null
    } finally {
        clearTimeout(timer)
        ctx.shared.signal.removeEventListener('abort', onShared)
    }
}

// nonce/bakiye cagrisi -> BigInt (basarili) | null (herhangi bir hata). ASLA firlatmaz.
async function callHex(url, method, address, ctx) {
    const hex = await callRpc(url, method, [address, 'latest'], ctx)
    return hex === null ? null : BigInt(hex)
}

// Token cagrisi: Multicall3.aggregate3 ile tum balanceOf'lar tek eth_call'da.
// -> { positive: boolean } (yanit cozuldu) | null (hata/zaman asimi/iptal/bozuk yanit: sinyal yok).
// ASLA firlatmaz.
async function callTokens(url, token, ctx) {
    const hex = await callRpc(url, 'eth_call', [{ to: MULTICALL3_ADDRESS, data: token.data }, 'latest'], ctx)
    if (hex === null) return null
    const balances = decodeBalancesResult(hex, token.count)
    return balances === null ? null : { positive: anyPositive(balances) }
}

// Bir agin token cagrisi: sabit token listesi ve hesap adresi gecerliyse { data, count, done }
// (aksi halde null: o agda token yoklamasi ATLANIR). `done`, bir URL'den cozulebilir bir
// token yaniti alindiginda true olur; yedek URL'de ayni agin token cagrisi TEKRARLANMAZ.
function buildTokenCall(chain, address) {
    const tokens = chain.tokens
    if (!Array.isArray(tokens) || tokens.length === 0) return null
    const data = encodeBalancesCall(address, tokens)
    return data === null ? null : { data, count: tokens.length, done: false }
}

// Bir URL'de nonce + bakiye (+ varsa token cagrisi) paralel -> 'used' | 'unused' | 'error'.
// 'used' ilk pozitif sinyalde HEMEN doner (digerlerinin, ozellikle yavas token cagrisinin,
// bitmesi beklenmez). 'error' yalniz nonce VE bakiye cagrilarinin ikisi de hata verince;
// token cagrisi bunu etkilemez.
async function probeUrl(url, address, ctx, token) {
    let markUsed
    const usedFirst = new Promise((resolve) => {
        markUsed = () => resolve('used')
    })

    const base = Promise.all(
        PROBE_METHODS.map(async (method) => {
            const value = await callHex(url, method, address, ctx)
            if (value !== null && value > 0n) markUsed()
            return value
        })
    )
    const tokenResult =
        token === null
            ? Promise.resolve(null)
            : callTokens(url, token, ctx).then((r) => {
                  if (r !== null) token.done = true
                  if (r !== null && r.positive) markUsed()
                  return r
              })

    const settled = Promise.all([base, tokenResult]).then(([values]) =>
        values.some((v) => v !== null) ? 'unused' : 'error'
    )
    return Promise.race([usedFirst, settled])
}

// Bir agin URL'leri sirayla denenir: ikisi de hata veren URL'den sonra siradaki
// -> 'used' | 'unused' | 'error' (URL kalmadiysa).
async function probeChain(chain, address, ctx) {
    const token = buildTokenCall(chain, address)
    for (const url of chain.urls) {
        // Iptal edilmisse siradaki URL'ye GECILMEZ (bkz. callRpc notu).
        if (ctx.isAborted()) return 'error'
        const r = await probeUrl(url, address, ctx, token !== null && !token.done ? token : null)
        if (r !== 'error') return r
    }
    return 'error'
}

/**
 * Adres 10 EVM aginin herhangi birinde kullanilmis mi? ASLA firlatmaz.
 *
 * Aglar eszamanli sorulur; biri 'used' verir vermez sonuc 'used' olur ve
 * bekleyen tum istekler iptal edilir.
 *
 * @param {string} address
 * @param {{signal?: AbortSignal, chains?: Array<{chainId: number, urls: string[], tokens?: string[]}>,
 *          fetchImpl?: typeof fetch, timeoutMs?: number}} [opts]
 * @returns {Promise<'used'|'unused'|'failed'>}
 */
export async function probeEvmAddress(address, opts = {}) {
    let removeCallerListener = () => {}
    const shared = new AbortController()
    try {
        const { signal, chains = scanChains(), fetchImpl = globalThis.fetch, timeoutMs = PROBE_CALL_TIMEOUT_MS } = opts
        const callerAborted = () => signal?.aborted === true
        if (callerAborted()) return 'failed'

        if (signal) {
            const onCallerAbort = () => shared.abort()
            signal.addEventListener('abort', onCallerAbort, { once: true })
            removeCallerListener = () => signal.removeEventListener('abort', onCallerAbort)
        }

        const ctx = {
            shared,
            fetchImpl,
            timeoutMs,
            isAborted: () => shared.signal.aborted || callerAborted(),
        }

        // 'used' ilk bulundugu anda yaris biter; digerlerini beklemeye gerek yok.
        let markUsed
        const usedFirst = new Promise((resolve) => {
            markUsed = () => resolve('used')
        })
        const finished = Promise.all(
            chains.map(async (chain) => {
                const r = await probeChain(chain, address, ctx)
                if (r === 'used') markUsed()
                return r
            })
        ).then((results) => (results.every((r) => r === 'error') ? 'failed' : 'unused'))

        const outcome = await Promise.race([usedFirst, finished])
        // Iptal edilmis yarim yoklama 'unused' sayilmaz; 'used' ise zaten kesin.
        if (outcome !== 'used' && callerAborted()) return 'failed'
        return outcome
    } catch (e) {
        return 'failed'
    } finally {
        // Kalan asili istekleri kes ve cagiranin sinyalinden dinleyiciyi al.
        shared.abort()
        removeCallerListener()
    }
}
