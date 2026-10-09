import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { effectScope, ref, computed } from 'vue'
import { createStocksRefresher, useStocksRefresh, STOCKS_REFRESH_MS } from './stocksRefresh'

// Hisseler sekmesinin 60 sn'lik FIYAT tazelemesi. Zamanlama Home.vue'nun
// disinda cunku Home'un SSR testinde izleyiciler render bitince durur ve
// onUnmounted calismaz (firstLoadGate.test.js ile ayni gerekce).
describe('hisse fiyat tazelemesi', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aralik 60 sn', () => {
    expect(STOCKS_REFRESH_MS).toBe(60000)
  })

  it('start() HEMEN istemez; 60 sn de bir ister', async () => {
    const refresh = vi.fn(async () => {})
    const r = createStocksRefresher({ refresh, isHidden: () => false })
    r.start()
    expect(refresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(59999)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(2)
    r.stop()
  })

  it('stop() zamanlayiciyi TEMIZLER -- sekmeden cikinca istek biter', async () => {
    const refresh = vi.fn(async () => {})
    const r = createStocksRefresher({ refresh, isHidden: () => false })
    r.start()
    await vi.advanceTimersByTimeAsync(60000)
    r.stop()
    expect(r.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(600000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  // Sekmeye ust uste tiklamak ya da izleyicinin ayni degeri iki kez bildirmesi
  // ikinci bir zamanlayici KURMAMALI: aksi halde dakikada iki istek gider ve
  // stop() yalnizca birini temizler.
  it('start() iki kez cagrilsa da TEK zamanlayici', async () => {
    const refresh = vi.fn(async () => {})
    const r = createStocksRefresher({ refresh, isHidden: () => false })
    r.start()
    r.start()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    r.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sync(true) baslatir, sync(false) durdurur; tekrar zararsiz', () => {
    const r = createStocksRefresher({ refresh: async () => {}, isHidden: () => false })
    r.sync(true)
    r.sync(true)
    expect(r.isRunning()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    r.sync(false)
    r.sync(false)
    expect(r.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('panel GIZLIYKEN istek atilmaz, gorunur olunca bir sonraki turda atilir', async () => {
    let gizli = true
    const refresh = vi.fn(async () => {})
    const r = createStocksRefresher({ refresh, isHidden: () => gizli })
    r.start()
    await vi.advanceTimersByTimeAsync(120000)
    expect(refresh).not.toHaveBeenCalled()

    gizli = false
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    r.stop()
  })

  // Varsayilan gizlilik kapisi Home'un bakiye dongusuyle AYNI ifade.
  it('varsayilan kapi document.visibilityState i okur', async () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    const refresh = vi.fn(async () => {})
    const r = createStocksRefresher({ refresh })
    r.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).not.toHaveBeenCalled()

    vi.stubGlobal('document', { visibilityState: 'visible' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    r.stop()
  })

  it('document YOKSA (SSR/test) panel gorunur sayilir', async () => {
    expect(typeof document).toBe('undefined')
    const refresh = vi.fn(async () => {})
    const r = createStocksRefresher({ refresh })
    r.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    r.stop()
  })

  it('onceki istek BITMEDEN yenisi atilmaz (ust uste binme yok)', async () => {
    let bitir
    const refresh = vi.fn(() => new Promise((resolve) => { bitir = resolve }))
    const r = createStocksRefresher({ refresh, isHidden: () => false })
    r.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)

    // Istek asili: iki tur daha gecer, yeni istek YOK.
    await vi.advanceTimersByTimeAsync(120000)
    expect(refresh).toHaveBeenCalledTimes(1)

    bitir()
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(2)
    r.stop()
  })

  it('basarisiz tur donguyu OLDURMEZ', async () => {
    const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('ag yok'))
      .mockResolvedValue(undefined)
    const r = createStocksRefresher({ refresh, isHidden: () => false })
    r.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(hata).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(2)
    r.stop()
    hata.mockRestore()
  })
})

// ------------------------------------------------------------------
// SEKMEYE BAGLI TAZELEME (useStocksRefresh). Burada GERCEK Vue reaktivitesi
// kosar: `effectScope` bir bilesenin setup kapsaminin aynisidir (Vue her
// bileseni boyle bir kapsamda kurar ve sokerken `scope.stop()` cagirir).
//
// Kaynak Home.vue'daki hesap kapisiyla AYNI sekilde turetilir: hatirlanan
// sekme 'stocks' iken hesap BSC tutamiyorsa panel Varliklar'a duser ve
// `activeTab` DEGISMEZ. Yani panel bir sekme TIKLAMASI olmadan kaybolabilir;
// izleyici bunu da gormeli. (Home'un kendi kapisiyla uctan uca hali
// HomeBStocks.ssr.test.js'te.)
describe('useStocksRefresh -- sekmeye bagli tazeleme', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const kur = ({ sekme = 'stocks', bscTutar = true } = {}) => {
    const activeTab = ref(sekme)
    const stocksAvailable = ref(bscTutar)
    const gorunenSekme = computed(() => (activeTab.value === 'stocks' && !stocksAvailable.value ? 'assets' : activeTab.value))
    const refresh = vi.fn(async () => {})
    const scope = effectScope()
    const refresher = scope.run(() => useStocksRefresh({
      visible: () => gorunenSekme.value === 'stocks',
      refresh,
      isHidden: () => false,
    }))
    return { activeTab, stocksAvailable, refresh, scope, refresher }
  }

  // Token detayindan donus: Home YENIDEN kurulur ve sekme depodan 'stocks'
  // gelir. Degisim yok, yalnizca baslangic degeri var.
  it('kurulurken panel ACIKSA hemen baslar (token detayindan donus)', async () => {
    const { refresh, scope, refresher } = kur()

    expect(refresher.isRunning()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('kurulurken panel KAPALIYSA zamanlayici kurulmaz', async () => {
    const { refresh, scope, refresher } = kur({ sekme: 'assets' })

    expect(refresher.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120000)
    expect(refresh).not.toHaveBeenCalled()
    scope.stop()
  })

  // Iddialar degisimin HEMEN ardindan, nextTick BEKLENMEDEN yapilir: bu,
  // `flush: 'sync'`i de kilitler (Home'un SSR testi ona dayaniyor).
  it('hesap kapisi paneli TIKLAMASIZ gizleyince durur, geri acinca yeniden baslar', async () => {
    const { activeTab, stocksAvailable, refresh, scope, refresher } = kur()
    expect(refresher.isRunning()).toBe(true)

    // BSC tutamayan hesaba gecildi; sekme dugmesine kimse basmadi.
    stocksAvailable.value = false
    expect(activeTab.value).toBe('stocks')
    expect(refresher.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120000)
    expect(refresh).not.toHaveBeenCalled()

    // BSC tutan hesaba geri donuldu: panel geri geldi, tazeleme de.
    stocksAvailable.value = true
    expect(refresher.isRunning()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(refresh).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('sekme tiklamasi da AYNI izleyiciden gecer', () => {
    const { activeTab, scope, refresher } = kur({ sekme: 'assets' })

    activeTab.value = 'stocks'
    expect(refresher.isRunning()).toBe(true)
    activeTab.value = 'activity'
    expect(refresher.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })

  // Bilesen sokulmesi: Vue unmount'ta bilesenin kapsamini durdurur.
  it('kapsam durunca (bilesen sokulmesi) zamanlayici TEMIZLENIR ve bir daha kurulmaz', async () => {
    const { stocksAvailable, refresh, scope, refresher } = kur()
    expect(refresher.isRunning()).toBe(true)

    scope.stop()
    expect(refresher.isRunning()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    // Sokulmus bilesenin kaynagi degisse bile (hesap degisimi arka planda
    // surer) izleyici de durdugu icin zamanlayici GERI GELMEZ.
    stocksAvailable.value = false
    stocksAvailable.value = true
    expect(refresher.isRunning()).toBe(false)
    await vi.advanceTimersByTimeAsync(600000)
    expect(refresh).not.toHaveBeenCalled()
  })

  // Hisse detayina gidip donmek: eski Home sokulur, yenisi kurulur. Eski
  // zamanlayici sizarsa dakikada iki istek gider.
  it('sokulup yeniden kurulunca TEK zamanlayici kalir', async () => {
    const ilk = kur()
    ilk.scope.stop()
    const ikinci = kur()

    expect(ilk.refresher.isRunning()).toBe(false)
    expect(ikinci.refresher.isRunning()).toBe(true)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(60000)
    expect(ilk.refresh).not.toHaveBeenCalled()
    expect(ikinci.refresh).toHaveBeenCalledTimes(1)
    ikinci.scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
