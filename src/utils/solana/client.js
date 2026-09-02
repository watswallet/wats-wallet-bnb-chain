/**
 * Solana JSON-RPC istemcisi — YALNIZCA kendi backend'imize konusur.
 *
 * @solana/web3.js'in Connection sinifi BILEREK kullanilmiyor: o dogrudan bir
 * duguma gider ve saglayici anahtarini istemciye tasimayi zorlar. Uzanti kodu
 * herkese acik oldugu icin oraya anahtar gomulemez.
 */

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

export async function solanaRpc(method, params = []) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SOLANA_RPC_TIMEOUT_MS)

    let body
    try {
        const response = await fetch(`${SOLANA_API_BASE}/solana/rpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
            signal: controller.signal,
        })

        if (!response.ok) throw new Error(`SOLANA_RPC_HTTP_${response.status}`)

        body = await response.json()
    } catch (e) {
        // AbortError'in `message`'i calisma ortamina gore degisir ve bazilarinda
        // BOSTUR. Bos bir mesaj sinir otesine FALSY bir hata olarak gecer ve
        // cagiran `if (err)` dalina hic girmez; bu yuzden hata BURADA kendi
        // tanidik koduna cevriliyor.
        if (e?.name === 'AbortError') throw new Error('SOLANA_RPC_TIMEOUT')
        throw e
    } finally {
        // Basarili yolda da temizlenmeli: aksi halde her cagri, hicbir ise
        // yaramayan bir zamanlayiciyi 15 saniye boyunca canli tutar.
        clearTimeout(timer)
    }

    // JSON-RPC hatasi HTTP 200 ile gelir. Kontrol edilmezse `undefined` result
    // sessizce akar ve kullaniciya bakiye 0 gosterilir.
    if (body?.error) throw new Error(body.error.message || 'SOLANA_RPC_ERROR')

    return body?.result
}
