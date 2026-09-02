import { maxSendableSol } from './buildTransferPlan'
import { SOL_NATIVE_MARKER, LAMPORTS_PER_SOL } from './constants'

/**
 * "Maks" dugmesi devre disi mi? — SAF karar katmani.
 *
 * SPL gonderiminde HICBIR ZAMAN devre disi degildir: ucret + olasi ATA kirasi
 * SOL'dan duser, token bakiyesinin KENDISI etkilenmez — tamami sorunsuz
 * gonderilebilir. Native SOL'da ucret+kira baglami (`solanaFee`) olmadan dogru
 * bir tutar hesaplanamaz; `mint` HER ZAMAN `solanaMintOf(...)` ile normalize
 * edilmis olmali (bkz. sendMint.js) — ham/eksik bir deger burada NATIVE'i
 * SPL sanip yanlislikla "etkin" donebilir.
 */
export function isSolanaMaxDisabled({ mint, solanaFee }) {
    return mint === SOL_NATIVE_MARKER && solanaFee == null
}

/**
 * "Maks" tutari — SAF hesap katmani.
 *
 * SPL: token bakiyesinin TAMAMI (ucret SOL'dan duser, token miktarini etkilemez).
 * Native SOL: ucret VE kira muafiyeti minimumu dusulur (bkz. maxSendableSol) —
 * `solanaFee` yoksa (henuz yuklenmedi/okunamadi) null doner, SIFIR KIRA hicbir
 * zaman varsayilmaz (aksi halde hesap kira esiginin altina dusup silinebilir).
 *
 * @returns {string|null} gonderilecek tutar (SOL dizgesi), hesaplanamiyorsa null
 */
export function computeSolanaMaxAmount({ mint, balance, solanaFee }) {
    if (mint !== SOL_NATIVE_MARKER) return String(balance)
    if (isSolanaMaxDisabled({ mint, solanaFee })) return null

    const amount = maxSendableSol({
        lamports: Math.round(Number(balance) * LAMPORTS_PER_SOL),
        feeLamports: solanaFee.feeLamports,
        rentExemptLamports: solanaFee.rentExemptLamports,
    })
    return String(amount)
}
