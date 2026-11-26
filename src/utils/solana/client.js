/**
 * Solana JSON-RPC istemcisi — YALNIZCA kendi backend'imize konusur.
 *
 * @solana/web3.js'in Connection sinifi BILEREK kullanilmiyor: o dogrudan bir
 * duguma gider ve saglayici anahtarini istemciye tasimayi zorlar. Uzanti kodu
 * herkese acik oldugu icin oraya anahtar gomulemez.
 */
import { SOLANA_ENABLED } from '../featureFlags'

// SOLANA AG CIKIS SAVUNMASI (birlesme hazirligi B4): ozellik bayragi KAPALIYKEN bu istemci HIC istek atmaz ve bu
// tipli hatayi firlatir. Kapali derlemede ileride korumasiz yeni bir cagiran yazilsa bile /solana/rpc istegi cikmaz
// (magaza sizintisi sinifi; ekran kapilari Home/SelectAssets ayrica durur). Bos bir sonuc UYDURULMAZ: RPC cagiranlari
// "result yok"u bakiye 0 gibi yanlis bir degere cevirebilirdi; ag hatasi yollari zaten her cagiranda var. Belirsiz
// yayin DEGILDIR (sendErrors.isAmbiguousBroadcastError false doner). Bayrak acik derlemede davranis aynen.
export const SOLANA_DISABLED = 'SOLANA_DISABLED'
function solanaDisabledError() {
    const e = new Error(SOLANA_DISABLED)
    e.code = SOLANA_DISABLED
    return e
}

// API tabani tek kaynaktan: build-time env. store/config.js AYNI degiskeni ve
// AYNI fallback'i kullaniyor — burada Pinia store'u okunamaz cunku bu modul
// service worker'dan da (background.js -> send.js) cagriliyor ve orada Pinia yok.
// Deger .env.[mode] dosyalarinda; kaynak her dalda ayni.
export const SOLANA_API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

let requestId = 0

// fetch'in VARSAYILAN ZAMAN ASIMI YOKTUR: takilmis bir proxy ile acilan bir
// baglanti SONSUZA DEK bekler. Bu, cagiran her yeri de suresiz askida birakir --
// arka planda bir kurtarma turu, popup'ta bir bakiye sorgusu, hatta bir gonderim
// akisi. Sinir BILEREK comert: Solana onaylari saniyeler surer ve
// getSignatureStatuses gibi cagrilar yogun anlarda yavaslayabilir; amac yavas
// bir yaniti kesmek degil, OLU bir baglantiyi serbest birakmak.
const SOLANA_RPC_TIMEOUT_MS = 15000

// Sunucunun sabit "ust akis reddetti" mesaji (solanaController.proxyRpc ile AYNI).
const UPSTREAM_REJECTED_MESSAGE = 'solana upstream rejected request'

// Govde okunamazsa/JSON degilse false: asil HTTP hatasi bozulmaz.
async function upstreamRejected(response) {
    try {
        const json = await response.json()
        return json?.error?.message === UPSTREAM_REJECTED_MESSAGE
    } catch {
        return false
    }
}

// Ucuncu parametre geriye uyumludur: verilmezse bugunku 15 sn davranisi.
//  - timeoutMs: varsayilan siniri bu cagri icin degistirir (sonlu, > 0 olmali;
//    aksi halde varsayilan kullanilir).
//  - signal: HARICI iptal. Sinyal fetch'e baglanir ve istek GERCEKTEN kesilir
//    (Promise.race ile taklit EDILMEZ: fetch 15 sn acik kalir ve paylasimli
//    IP sinirini harcar). Iptal SOLANA_RPC_ABORTED ile reddedilir; bu bir
//    istemci-ici koddur, dapp hata kodu DEGILDIR ve zaman asimindan (TIMEOUT)
//    ayridir: cagiran "kullanici/ust akis vazgecti" ile "ag oldu"yu ayirt eder.
export async function solanaRpc(method, params = [], { signal, timeoutMs } = {}) {
    // Bayrak kapali: istek HIC atilmaz (yukaridaki SOLANA_DISABLED notu).
    if (!SOLANA_ENABLED) throw solanaDisabledError()

    // Zaten iptal edilmisse agi hic rahatsiz etme.
    if (signal?.aborted) throw new Error('SOLANA_RPC_ABORTED')

    const sure = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : SOLANA_RPC_TIMEOUT_MS
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), sure)
    const haricIptal = () => controller.abort()
    signal?.addEventListener('abort', haricIptal)

    let body
    try {
        const response = await fetch(`${SOLANA_API_BASE}/solana/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
            signal: controller.signal,
        })

        if (!response.ok) {
            // Sunucu, ust akis 401/403'unu (WAF/anahtar/uyumluluk filtresi) 502 +
            // sabit mesajla cevirir (solanaController.proxyRpc). Bu KESIN redtir:
            // istek dugume ulasmadi. Duz SOLANA_RPC_HTTP_502 olarak gecerse
            // sendErrors.isAmbiguousBroadcastError onu "belirsiz yayin" sayar ve
            // dapp'e sahte basari / gereksiz bekleyen kayit uretir. Bu yuzden ayri,
            // belirsiz OLMAYAN istemci-ici kod (dapp hata kodu DEGIL).
            if (response.status === 502 && (await upstreamRejected(response))) {
                throw new Error('SOLANA_RPC_UPSTREAM_REJECTED')
            }
            throw new Error(`SOLANA_RPC_HTTP_${response.status}`)
        }

        body = await response.json()
    } catch (e) {
        // AbortError'in `message`'i calisma ortamina gore degisir ve bazilarinda
        // BOSTUR. Bos bir mesaj sinir otesine FALSY bir hata olarak gecer ve
        // cagiran `if (err)` dalina hic girmez; bu yuzden hata BURADA kendi
        // tanidik koduna cevriliyor. Harici sinyal tetiklendiyse iptal, degilse
        // sure dolmustur.
        if (e?.name === 'AbortError') {
            throw new Error(signal?.aborted ? 'SOLANA_RPC_ABORTED' : 'SOLANA_RPC_TIMEOUT')
        }
        throw e
    } finally {
        // Basarili yolda da temizlenmeli: aksi halde her cagri, hicbir ise
        // yaramayan bir zamanlayiciyi 15 saniye boyunca canli tutar; harici
        // sinyale takili dinleyici de uzun omurlu sinyalde birikir.
        clearTimeout(timer)
        signal?.removeEventListener('abort', haricIptal)
    }

    // JSON-RPC hatasi HTTP 200 ile gelir. Kontrol edilmezse `undefined` result
    // sessizce akar ve kullaniciya bakiye 0 gosterilir.
    if (body?.error) throw new Error(body.error.message || 'SOLANA_RPC_ERROR')

    return body?.result
}
