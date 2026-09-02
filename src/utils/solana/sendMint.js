import { SOL_NATIVE_MARKER } from './constants'

/**
 * Bir varlik kaydinin Solana mint kimligi — TEK normalizasyon noktasi.
 *
 * `address` alani BOS/undefined ise NATIVE SOL varsayilir. Once bu normalizasyon
 * dort ayri yerde (bakiye yuklemesi, confirm(), ConfirmTransaction.vue'nun
 * gonderim cagrisi) tekrarlaniyordu ama IKI yerde (Maks devre disi kontrolu,
 * Maks hesaplamasinin SPL erken donusu) HAM `crypto.sendAsset?.address`
 * karsilastiriliyordu. Adres eksikse (`undefined`) bu iki kontrol NATIVE SOL'u
 * SPL saniyordu: `undefined !== SOL_NATIVE_MARKER` TRUE olur, "Maks" devre disi
 * BIRAKILMAZ ve SPL erken donusu tum SOL bakiyesini (ucret/kira dusulmeden)
 * yazardi — kod incelemesinde bulundu. Artik HERKES bu tek fonksiyondan okur.
 */
export function solanaMintOf(asset) {
    return asset?.address || SOL_NATIVE_MARKER
}
