// HISSELER FIYAT TAZELEMESI -- zamanlama ve sekme izleme Home.vue'nun DISINDA.
//
// Neden ayri modul (firstLoadGate.js ile ayni gerekce): Home SSR ile test
// ediliyor ve orada bilesen hic sokulmez (onUnmounted calismaz), izleyiciler
// de render bitince durdurulur. "Sekmeden cikinca durur", "ust uste binmez",
// "panel gizliyken istek atmaz" gibi davranislar burada sahte zamanlayiciyla
// ve gercek Vue reaktivitesiyle (effectScope) olculur. Home.vue yalnizca
// BAGLAR.
//
// YALNIZCA ZAMANLAMA: neyin istenecegini cagiran verir (`refresh`). Home'da bu
// yalniz FIYAT istegidir -- bakiyeler DEGIL (spec 7): 22 token x getCode +
// balanceOfUI + decimals tek public BSC ucuna gider, dakikada bir tekrari
// pahalidir.
import { watch, onScopeDispose } from 'vue'

// Atlas fiyati zincirde 60 sn'de bir yenileniyor ve sunucu dakikada bir
// okuyor; daha sik sormak yeni bir sey getirmez.
export const STOCKS_REFRESH_MS = 60000

// Panel gorunmezken yoklama yapilmaz -- Home'un 10 sn'lik bakiye dongusuyle
// AYNI kural (pollingVisibility.test.js): surekli ag trafigi ve kullanicinin
// cuzdani acik tuttugunu ele veren duzenli bir istek deseni. `document` yoksa
// (SSR/test ortami) panel gorunur sayilir.
const panelGizli = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export function createStocksRefresher({ refresh, intervalMs = STOCKS_REFRESH_MS, isHidden = panelGizli } = {}) {
  let timer = null
  // UST USTE BINME KORUMASI: axios'un varsayilan zaman asimi YOK. Asili kalan
  // bir istek varken her dakika yenisi eklenseydi, ag duzelince hepsi birden
  // doner ve eski cevaplar yenilerin ustune yazabilirdi.
  let inFlight = false

  const tick = async () => {
    if (inFlight || isHidden()) return
    inFlight = true
    try {
      await refresh()
    } catch (error) {
      // Tek bir basarisiz tur donguyu OLDURMEZ: bir sonraki dakika yeniden denenir.
      console.error('Hisse fiyatlari tazelenemedi:', error)
    } finally {
      inFlight = false
    }
  }

  // HEMEN istek ATMAZ: sekme acilisinin kendi yuklemesi var (Home.vue
  // loadBStockData). Burasi yalnizca SONRAKI dakikalari kapsar; ilk istegi iki
  // kez atmak ayni cevabi iki kez beklemek demekti.
  const start = () => {
    if (timer !== null) return
    timer = setInterval(tick, intervalMs)
  }

  const stop = () => {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  return {
    start,
    stop,
    // Sekme durumunu TEK cagriyla uygular; ayni degerle tekrar cagrilmasi zararsiz.
    sync: (gorunur) => (gorunur ? start() : stop()),
    isRunning: () => timer !== null,
  }
}

// SEKMEYE BAGLI TAZELEME -- Home.vue'nun kullandigi giris noktasi. Bir bilesenin
// setup'inda (ya da bir effectScope icinde) cagrilmak ZORUNDA: izleyici ve
// temizlik o kapsama baglanir.
//
// `visible`: "Hisseler paneli su an ekranda mi" sorusunun reaktif cevabi
// (Home'da `() => gorunenSekme.value === 'stocks'`). Tek izleyici butun
// yollari kapsar: sekmeye tiklamak, baska sekmeye gecmek ve hesap kapisinin
// paneli TIKLAMASIZ gizlemesi ya da geri getirmesi.
//
// `immediate`: bilesen kurulurken panel zaten aciksa (token detayindan donus,
// hatirlanan sekme) tazeleme o anda baslar. Izleyici yalnizca DEGISIMI
// gorseydi bu an kacardi ve donen kullanici hic tazeleme almazdi.
//
// `flush: 'sync'`: karar degistigi ANDA uygulanir, bir sonraki render'i
// beklemez. Kaynak tek bir boolean, geri cagri yalnizca start/stop: ucuz ve
// yalnizca deger DEGISINCE calisir. Ikinci kazanc olculebilirlik: Vue SSR'da
// 'sync' izleyiciyi render SURESINCE canli tutar (ertelenen izleyicileri hic
// kurmaz), yani Home'un SSR testi hesap kapisinin tazelemeyi durdurdugunu
// GERCEKTEN gorur.
//
// `onScopeDispose`: bilesen sokulunce Vue onun effect kapsamini durdurur ve
// zamanlayici burada temizlenir. Hisse satirina basmak Home'u SOKER (App.vue
// `:key="page.currentPage"`); durdurulmasaydi sokulmus bilesen dakikada bir
// istek atmaya devam ederdi. onUnmounted yerine bu, cunku temizlik ayni
// kapsamdaki izleyiciyle birlikte gider ve bilesensiz de olculebilir.
export function useStocksRefresh({ visible, ...options }) {
  const refresher = createStocksRefresher(options)
  watch(visible, (gorunur) => refresher.sync(gorunur), { immediate: true, flush: 'sync' })
  onScopeDispose(refresher.stop)
  return refresher
}
