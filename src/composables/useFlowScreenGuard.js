import { onMounted, watch } from 'vue'
import { chainSupportsFlow } from '../utils/chainKind'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'

/**
 * AKIS EKRANI KORUMASI -- "bu ekran bu zincirde anlamli mi" sorusunun TEK yeri.
 *
 * IKI AYRI SORUNU BIRLIKTE COZER; ayri ayri cozulurlerse ikisi de geri gelir.
 *
 * 1) KAPI OTORITESI TEKTIR.
 *    Dugmeyi SUNAN otorite `chainSupportsFlow(chain, FLOW.X)` (Home.vue ve
 *    Token.vue'daki canSwap/canBridge). Ekrani KAPATAN koruma bir donem
 *    `evmOnlyFeatures(chain).swap`e bakiyordu ve o ikisi TON'da CELISIYORDU:
 *    chainKind.js TON takasini (STON.fi) ACIKCA destekliyor, evmOnlyFeatures
 *    ise "EVM + rpc listesi dolu" sordugu icin TON'da false donuyordu. Sonuc:
 *    Takas dugmesi TON'da gorunuyor, ekran acilir acilmaz kullaniciyi disari
 *    atiyordu. Koruma artik dugmeyle AYNI tabloyu okur.
 *
 *    Koruma KALDIRILMADI, yalnizca OTORITESI degisti: gerekcesi hala ikinci
 *    savunma katmani olmak -- yarin baska bir kod yolu (or. sayfa durumunun geri
 *    yuklenmesi, bir dapp'in ag degistirme istegi, ekranin KENDI icindeki ag
 *    secici) `currentPage`i kontrolsuz yazarsa kullanici kullanilamaz bir
 *    ekranda kalmasin.
 *
 * 2) ILK KONTROL SETUP'TA CALISMAZ.
 *    Bu satirlar eskiden `{ immediate: true }` ile kuruluyordu, yani ilk
 *    kontrol bilesenin SETUP'i sirasinda SENKRON calisip `currentPage`e
 *    yaziyordu. App.vue ekranlari
 *    `<Transition name="fade-slide" mode="out-in"><div :key="page.currentPage">`
 *    icinde tutuyor; anahtarin TEK bir flush icinde iki kez degismesi
 *    (token -> swap -> home) gecisi KILITLIYOR: `swap` sarmalayicisinin AYRILMA
 *    gecisi, henuz baslamamis GIRIS gecisinden once kurulur, girisin ertelenen
 *    nextFrame'i `el._endId`i artirir ve ayrilmanin `resolveIfNotStale`i kalici
 *    olarak bayat kalir. `afterLeave` hic cagrilmaz, BaseTransition'in
 *    `state.isLeaving`i sonsuza dek `true` kalir ve Transition o andan sonra
 *    yalniz bos bir yorum dugumu render eder. Kullanicinin gordugu KALICI SIYAH
 *    EKRAN budur -- konsolda TEK BIR HATA YOK, cunku bu bir istisna degil bir
 *    kilitlenme.
 *
 *    Bu yuzden ilk kontrol `onMounted`a alindi: yama BITTIKTEN sonra calisir,
 *    giris gecisi kurulmustur, olasi ayrilma onu duzgunce iptal edebilir.
 *    Korumanin ASIL isi -- kullanici EKRANDAYKEN agin degismesi -- watch ile
 *    oldugu gibi durur.
 */

/**
 * Saf cekirdek: Pinia'ya da bilesen ornegine de bagimli DEGIL, yalnizca aktif
 * bir effectScope ister. Bu ayrim testin "ag SONRADAN degisince koruma
 * atesleniyor mu" yarisini olcebilmesi icin var -- SSR harness'i (ssrRender.js)
 * render COZULUNCE effect scope'u durdurdugu icin o yari orada OLCULEMEZ.
 *
 * ILK CALISTIRMAYI BILEREK YAPMAZ (`immediate` YOK) ve `enforce`u cagirana
 * DONDURUR: "ne zaman" karari cagirana ait, ve tek dogru cevap setup'tan
 * SONRASIDIR (yukaridaki 2. madde).
 */
export function createFlowScreenGuard({ flow, getChain, leaveScreen }) {
    const enforce = () => {
        if (chainSupportsFlow(getChain(), flow)) return
        leaveScreen()
    }

    // `deep: true`: aktif ag kaydi YERINDE guncellenebiliyor (ayni nesne, degisen
    // alanlar) -- sig bir izleyici o degisimi kacirirdi.
    watch(getChain, enforce, { deep: true })

    return enforce
}

/**
 * Bilesen sarmalayicisi. Ekran bilesenleri TEK SATIRDA bunu cagirir; kapi
 * otoritesi de ilk kontrolun ZAMANI da burada, tek yerde tutulur.
 */
export function useFlowScreenGuard(flow, { fallbackPage = 'home' } = {}) {
    const network = networkStore()

    const enforce = createFlowScreenGuard({
        flow,
        getChain: () => network.currentNetwork,
        // `pageStore()` CAGRI ANINDA cozulur, setup'ta degil: koruma ates
        // etmedikce sayfa deposuna hic dokunulmaz.
        leaveScreen: () => { pageStore().currentPage = fallbackPage },
    })

    onMounted(enforce)

    return enforce
}
