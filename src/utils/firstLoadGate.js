import { ref } from 'vue'

/**
 * ILK YUKLEME KAPISI -- ana sayfa, ilk bakiye turu bitmeden gosterilmez.
 *
 * Kapi Home.vue'nun ICINDE degil BURADA: iki sebeple. Birincisi olculebilirlik
 * (Home SSR ile render edildiginde `onMounted` zaten bitmis olur, "tur bitmedi"
 * hali bilesenin ustunden olculemez). Ikincisi zaman asimi -- asagidaki gerekce.
 */

/**
 * UST SINIR: kapi EN FAZLA bu kadar kapali kalir.
 *
 * Kapinin sozu "yarim dolu ekran gosterme"; "sonsuza kadar bekle" DEGIL. RPC
 * dustugunde, arka uc yanit vermedigi ya da TON/Solana kolu asili kaldiginda
 * `updateBalance` tamamlanmayabilir -- o durumda kullanici kendi cuzdanina
 * ERISEMEZDI. Sure dolunca ekran ne kadari geldiyse onunla acilir: eksik bakiye,
 * kilitli bir cuzdandan iyidir. 8 sn, bir popup icin uzun ama panelde (saatlerce
 * acik kalir) hala kabul edilebilir bir tavan.
 */
export const FIRST_LOAD_TIMEOUT_MS = 8000

/**
 * `ready` false baslar. `open()` ya da zaman asimi onu true yapar; ikisi de
 * zamanlayiciyi birakmaz ve IKISI DE `onOpen`den gecer -- yukleme ekrani
 * App.vue'da, kapiyi acan tur Home.vue'da yasiyor ve aralarindaki paylasilan
 * bayragi (page.firstLoadDone) kapinin kendisi duyuruyor. Bir yol callback'i
 * atlasaydi ortu o yolda asili kalirdi.
 *
 * `dispose()` (bilesen sokulurken) kapiyi ACMADAN zamanlayiciyi temizler --
 * popup kisa omurlu, yan panel DEGIL: birakilan bir zamanlayici orada sokulmus
 * bir bilesene yazmaya calisirdi.
 */
export function createFirstLoadGate({ timeoutMs = FIRST_LOAD_TIMEOUT_MS, onOpen } = {}) {
    const ready = ref(false)

    let timer = setTimeout(() => {
        timer = null
        acil()
    }, timeoutMs)

    const clear = () => {
        if (timer === null) return
        clearTimeout(timer)
        timer = null
    }

    // Tek giris noktasi: `onOpen` TAM OLARAK BIR KEZ atesler. Zaman asimi ile
    // turun bitisi YARISABILIR (8. saniyede donen bir tur) -- ikisi de buraya
    // ugrar, ikincisi sessizce duser.
    const acil = () => {
        if (ready.value) return
        clear()
        ready.value = true
        onOpen?.()
    }

    return { ready, open: acil, dispose: clear }
}
