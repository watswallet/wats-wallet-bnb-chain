import { SOLANA_API_BASE } from './client'

// Sunucudaki `getSolanaHistory` handler'iyla AYNI ADI TASIMAZ: ayni ad iki
// katmanda okuyani yanilirdi (biri HTTP cagrisi, digeri Express handler'i).

// KOD INCELEMESI (Task 13, onemli 5): bu cagri Send ekraninin onMounted
// zincirine baglandi (loadTrusted -> fetchHistoryCounterparties ->
// fetchSolanaHistory). fetch'in VARSAYILAN ZAMAN ASIMI YOKTUR: takilmis bir
// proxy Send ekranini SONSUZA DEK yari-yuklu birakirdi (bakiye, ucret izleyici
// hicbiri gelmez). AYNI dosyadaki solanaRpc (client.js) tam bu yuzden bir
// AbortController siniri tasiyor; degistirdigi EVM cagrisi (/wallet/history)
// de axios.post(..., { timeout: 6000 }) kullaniyordu — sinir burada da AYNI
// (6sn), cunku bu tam olarak o cagrinin Solana karsiligidir.
//
// SINIR NEYI KAPSAR (2. tur incelemesi): BASLIKLARI DA GOVDEYI DE, yani
// cagrinin TAMAMINI — axios'un `timeout`'u gibi. Bu bilerek boyle:
// `fetch` promise'i BASLIKLAR gelir gelmez cozulur, govde (`r.json()`) o an
// daha OKUNMAMISTIR. Zamanlayici orada temizlenseydi (ilk yazimda oyleydi),
// baslik donduren ama GOVDEYI hic bitirmeyen bir proxy yine SONSUZA DEK asili
// kalirdi — yani onemli 5 yalnizca YARI kapanmis olurdu ve yukaridaki
// "axios ile ayni" iddiasi da GERCEKTE dogru olmazdi. Bu yuzden clearTimeout
// govde COZULDUKTEN sonra calisan tek bir `finally`dedir ve `r.json()` ayni
// `try` blogunun icindedir. Abort akmakta olan bir govde okumasini da iptal
// eder (spec: sinyal govde akisini da hataya dusurur), bu yuzden `r.json()`
// da AbortError ile duser ve ayni koda cevrilir.
const FETCH_TIMEOUT_MS = 6000

export async function fetchSolanaHistory(address) {
    if (typeof address !== 'string' || address.length === 0) return []

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
        const r = await fetch(`${SOLANA_API_BASE}/solana/history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address }),
            signal: controller.signal,
        })

        if (!r.ok) throw new Error(`SOLANA_HISTORY_HTTP_${r.status}`)

        // GOVDE OKUMASI DA BU BLOGUN ICINDE: bkz. yukaridaki "SINIR NEYI
        // KAPSAR" notu. Disari alinsaydi zamanlayici asagidaki `finally`de
        // ZATEN temizlenmis olurdu ve asili bir govde SINIRSIZ beklerdi.
        const body = await r.json()
        return Array.isArray(body?.history) ? body.history : []
    } catch (e) {
        // AbortError'in `message`'i calisma ortamina gore BOS olabilir; bos bir
        // mesaj sinir otesine FALSY bir hata olarak gecip cagiranin `if (err)`
        // dalini atlatirdi — bu yuzden kendi tanidik koduna cevrilir. Hem
        // BASLIK hem GOVDE asamasindaki abort ayni yere duser.
        if (e?.name === 'AbortError') throw new Error('SOLANA_HISTORY_TIMEOUT')
        throw e
    } finally {
        // Basarili yolda da temizlenmeli: aksi halde her cagri, hicbir ise
        // yaramayan bir zamanlayiciyi saniyelerce canli tutar. Bu `finally`
        // GOVDE COZULDUKTEN sonra calisir, bu yuzden sinir govdeyi de kapsar.
        clearTimeout(timer)
    }
}
