import { fetchSolanaAssets } from './balances'
import { SOL_NATIVE_MARKER } from './constants'

/**
 * Send ve Onay ekranlarinin Solana bakiye okumasinin TEK noktasi (final cuzdan-istemci-1).
 *
 * KOK NEDEN: fetchSolanaAssets iki RPC cagrisini (SOL getBalance, SPL getTokenAccountsByOwner) kendi
 * try/catch'iyle YUTAR ve hatayi yalniz dizinin numaralandirilamaz `splFailed` / `solFailed` ozelligine
 * yazar -- FIRLATMAZ. Cagiranlar `assets.find(...)?.amount || 0` ile okudugu icin okuma hatasi "0 bakiye"
 * olarak gorunuyordu (12,5 USDC'si olan kullaniciya "yetersiz bakiye", 10 SOL'u olana "yetersiz gaz").
 *
 * KURAL: okuma hatasi ASLA 0 bakiye olmaz. Hedef varligin okumasi dustuyse FIRLATIR; cagiran bunu
 * "bakiye okunamadi" olarak gosterir (Send: "-" + kilitli form; Onay: ag-hatasi metni + kilitli dugme).
 *   - hedef native SOL  -> solFailed firlatir
 *   - hedef SPL mint    -> splFailed firlatir
 * Hedefle ILGISIZ bayrak firlatmaz: SPL okumasi saglamken SOL'un dusmesi SPL bakiyesini bozmaz.
 * Okuma BASARILIYKEN hedef satir yoksa (ATA yok / bakiye 0) gercek 0 doner -- bu bir hata degildir.
 *
 * Bayraksiz duz dizi (balances modulunu yalniz fetchSolanaAssets ile mock'layan testler) hata sayilmaz.
 *
 * @param {string} address cuzdanin Solana adresi (base58)
 * @param {string} mint SOL_NATIVE_MARKER ya da SPL mint adresi
 * @returns {Promise<number>} okunan miktar (UI birimi)
 * @throws {Error} 'SOLANA_BALANCE_UNAVAILABLE' (hedefin okumasi dustu ya da adres yok); fetchSolanaAssets hatasi aynen
 */
export async function readSolanaBalanceOrThrow(address, mint) {
    // Adres yoksa bakiye BILINMIYOR demektir; bos listeye dusup 0 yazmak "paran yok" der.
    if (typeof address !== 'string' || address.length === 0) throw new Error('SOLANA_BALANCE_UNAVAILABLE')

    const assets = await fetchSolanaAssets(address)

    const native = mint === SOL_NATIVE_MARKER
    if (native ? assets?.solFailed === true : assets?.splFailed === true) {
        throw new Error('SOLANA_BALANCE_UNAVAILABLE')
    }

    return assets.find((a) => a.mint === mint)?.amount || 0
}
