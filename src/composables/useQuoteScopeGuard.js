import { watch } from 'vue'
import { userStore } from '../store/user'
import { privacyStore } from '../store/privacy'

/**
 * TEKLIF KAPSAMI KORUMASI (gizli-mod cok-ag spec 4.6, P10, arayuz yarisi).
 *
 * Takas ve Kopru ekranlari teklifi onbellekte tutar (swapData / bridgeData) ve 10-20 sn'de bir tazeler.
 * Kullanici ekrandayken aktif hesap ya da gizli mod degisebilir (baska panelden, uiSync): teklif ESKI hesaba
 * aittir. Kopruda teklifin alicisi eski hesabin adresidir; arka plan bunu imzadan once reddeder
 * (BRIDGE_RECEIVER_MISMATCH), ama ekran bayat teklifi gostermeyi ve onaylatmayi birakmali.
 *
 * Saf cekirdek: Pinia'ya ve bilesen ornegine bagli DEGIL, yalniz aktif bir effectScope ister. SSR harness'i
 * (ssrRender.js) izleyicileri CALISTIRMAZ; "degisince atesliyor mu" yarisi bu yuzden useFlowScreenGuard gibi
 * gercek bir effectScope icinde test edilir (useQuoteScopeGuard.test.js).
 *
 * ILK CALISTIRMAYI BILEREK YAPMAZ (`immediate` YOK): yalniz DEGISIMDE atesler. Geri cagrinin donusu (sozu)
 * dondurulur, boylece Vue'nun eszamansiz hata isleyicisi reddi yutmaz.
 */
export function createQuoteScopeGuard({ getAddress, getPrivacyActive, onChange }) {
    return watch([getAddress, getPrivacyActive], () => onChange())
}

/**
 * Bilesen sarmalayicisi. Takas ve Kopru ekranlari TEK SATIRDA bunu cagirir; hangi iki degerin "hesap/mod"
 * sayildigi (user.address ve privacy.active) burada, tek yerde tutulur.
 */
export function useQuoteScopeGuard(onChange) {
    const user = userStore()
    const privacy = privacyStore()
    return createQuoteScopeGuard({
        getAddress: () => user.address,
        getPrivacyActive: () => privacy.active,
        onChange,
    })
}
