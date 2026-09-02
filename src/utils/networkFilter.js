/**
 * Ana ekranin ag filtresi.
 *
 * Bu filtre basliktaki ag seciciden BAGIMSIZ bir kontroldu: varsayilani "tum aglar"
 * ve currentNetwork'e hic baglanmamisti (v1.3.0'dan beri). Kullanici baslikta ag
 * degistirince ana ekranda gorunur hicbir sey degismiyor, ozellik bozukmus gibi
 * duruyordu — oysa liste kasitli olarak capraz zincir bir portfoy gorunumu.
 *
 * Artik ag DEGISIMI filtreyi o zincire atlatir. Ilk yukleme bir degisim SAYILMAZ:
 * acilista "tum aglar" korunur, boylece portfoy toplami ilk bakista gorunur.
 * Kullanici diledigi zaman elle "tum aglar"a donebilir.
 */
import { isSameChainId } from './vm'

export const ALL_NETWORKS = 'all'

export function nextNetworkFilter(current, previousChainId, nextChainId) {
    // Zincir cozulemedi (currentNetwork henuz null ya da bozuk): filtreye dokunma.
    if (!nextChainId) return current

    // Ilk yukleme: null -> zincir. Kullanicinin yaptigi bir secim degil, bu yuzden
    // "tum aglar" varsayilani ezilmez.
    if (!previousChainId) return current

    // Kimlik KENDI TIPINDE dondurulur. Eskiden `Number.isFinite` degilse filtre
    // hic degismiyordu: Solana'ya gecince liste ONCEKI zincirde kaliyor ve
    // kullanici basliktan zincir degistirdigi halde ayni tokenlari goruyordu.
    if (isSameChainId(previousChainId, nextChainId)) return current
    return nextChainId
}

/**
 * TEK ZINCIRLI ekranlar (swapFrom) icin TURETILMIS kapsam. Store'a YAZMAZ.
 *
 * Bildirilen hata: Polygon aktifken Takas'in "Token Sec" secicisi "TUM AGLAR"
 * kapsaminda aciliyordu. Sebep, acilistaki 'all' degerinin bir CEVAP DEGIL,
 * SORULMAMIS BIR SORU olmasi: yukaridaki kural ilk yuklemede (null -> zincir)
 * filtreye bilerek dokunmuyor. Kullanici pill'e hic dokunmadiysa tek zincirli
 * ekran aktif zinciri varsayar; ACIKCA bir sey sectiyse (`chosen`) o cevap HER
 * ekranda gecerlidir — paylasilan kapsamin tum gerekcesi budur.
 *
 * Kapsam store'a YAZILMAZ: yazsaydi Home'a sizardi ve kullanici Takas'a girip
 * cikinca portfoy toplami sessizce duserdi.
 */
export function effectiveScope(filter, chosen, activeChainId) {
    if (chosen) return filter
    if (filter !== ALL_NETWORKS) return filter

    // Zincir cozulemedi (currentNetwork henuz null): uydurma bir zincire dusmek
    // yanlis liste demek; "tum aglar" korunur. Metin kimlikli zincirler (Solana)
    // GECERLIDIR — Number.isFinite kontrolu onlari yanlislikla eliyordu.
    return activeChainId ?? ALL_NETWORKS
}
