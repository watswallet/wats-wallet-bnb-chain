// BIRLESIK AG KONTROLU (Task 16c) -- NetworkScopePill GERCEKTEN render edilerek
// olculur (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN: ana ekranda GORSEL OLARAK NEREDEYSE AYNI IKI acilir menu vardi --
// baslikta aktif agi (imzalama/gonderim/dapp) degistiren ChangeNetwork chip'i ve
// hemen altinda YALNIZCA listeyi filtreleyen bu pill. Kullanici hangisinin ne
// yaptigini ayirt edemedi. Iki menu tek kontrole indirildi: pill artik
// `switchesNetwork` verildiginde somut bir zincir secilince AKTIF AGI da
// degistirir.
//
// Bu dosyanin kilitledigi sey DAVRANIS, metin degil:
//   - varsayilan (prop'suz) kullanim aktif aga DOKUNMAZ  -> diger DORT cagri yeri
//   - `switchesNetwork` acikken somut zincir DOGRU KAYITLA applyNetworkChange'e gider
//   - "Tum Aglar" ASLA ag degistirmez (bir zincir degildir)
//   - Solana'nin METIN kimligi ('solana-mainnet') bu yolda calisir
//   - aktif zincir menude ISARETLENIR (kapsam 'all' iken "hangi agdayim" sorusu)
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

// GERCEK applyNetworkChange RPC hiz testi yapar ve erisilemezse `alert` cagirir --
// bu ortamda ikisi de yok. Burada olculen sey "dogru zincir kaydiyla CAGRILDI MI",
// govdenin kendisi DEGIL (o applyNetworkChange.test.js'te kilitli).
const applyNetworkChangeMock = vi.fn(async () => true)
vi.mock('../utils/applyNetworkChange', () => ({
    applyNetworkChange: (...args) => applyNetworkChangeMock(...args),
}))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { networkStore } from '../store/network'
import NetworkScopePill from './NetworkScopePill.vue'
import supported_chains from '../data/supported_chains.json'
import { ALL_NETWORKS } from '../utils/networkFilter'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PILL_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'NetworkScopePill.vue'), 'utf8')

const SOLANA_CHAIN_ID = 'solana-mainnet'
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === SOLANA_CHAIN_ID)
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const POLYGON_CHAIN = supported_chains.find((c) => c.chainId === 137)

beforeEach(() => {
    applyNetworkChangeMock.mockClear()
})

afterEach(() => {
    delete globalThis.chrome
})

/**
 * Pill'i TEK BASINA render eder. `emitted`: kok bilesenin `onUpdate:modelValue`
 * prop'una dusen degerler -- SSR'da gercek bir tiklama atilamadigi icin secim
 * `setupState.select(...)` ile yapilir, ama emit yolu GERCEKTIR.
 */
function mountPill({
    modelValue = ALL_NETWORKS,
    switchesNetwork = false,
    currentNetwork = ETH_CHAIN,
    open = false,
} = {}) {
    installChromeStub({ currentNetwork })

    const emitted = []
    const app = createApp(NetworkScopePill, {
        props: {
            modelValue,
            switchesNetwork,
            'onUpdate:modelValue': (value) => emitted.push(value),
        },
    })
    app.use(createTestPinia())
    app.use(createTestI18n())

    // networkStore'un kendi initializeCurrentNetwork()'u chrome.storage'i ASENKRON
    // okur; yarisi kapatmak icin deger BURADA senkron olarak da kurulur.
    networkStore().currentNetwork = currentNetwork

    // Menu `v-if="open"`: acilmadan hicbir satir (ve aktif zincir isareti) render
    // edilmez. Bu yazma, bilesen KENDI serverPrefetch'ine girdigi anda, yani KENDI
    // render'indan ONCE kosar (bkz. ssrRender.js'teki captureInstance notu).
    const captured = captureInstance(app, 'NetworkScopePill', open
        ? (instance) => { instance.setupState.open = true }
        : undefined)

    return { app, captured, emitted }
}

/**
 * Acilir menudeki TEK BIR SATIRIN html'i.
 *
 * NEDEN satir bazli: `html).toContain('>active<')` iddiasi menudeki HERHANGI bir
 * satirdan saglanir. Kod incelemesi bunu OLCTU: `v-if`in polaritesi ters
 * cevrilince (isaret AKTIF OLMAYAN 10 satira tasinince) suite YESIL kaldi, yani
 * iddia isaretin DOGRU SATIRDA oldugunu hic kanitlamiyordu -- kullaniciya tam
 * tersini gosteren bir arayuz testten gecebiliyordu.
 *
 * Satirlar `<button` ile baslar; tetikleyici dugme de bir `<button`tur ama
 * `<span class="truncate">AD</span>` bicimini YALNIZCA menu satirlari basar
 * (tetikleyicideki aktif-ag adi baska bir sinif tasir).
 */
function menuRow(html, chainName) {
    const marker = '<span class="truncate">' + chainName + '</span>'
    return html.split('<button').find((part) => part.includes(marker)) || ''
}

const countOf = (html, needle) => html.split(needle).length - 1

/**
 * Ekranda GERCEKTEN OKUNAN metin: butun etiketler (dolayisiyla TUM OZNITELIKLER)
 * atilir.
 *
 * NEDEN: `title` bir FARE-USTU ipucusudur, ekranda YAZMAZ. Yalnizca
 * `toContain("active: Polygon")` demek, gorunur isareti tamamen kaldiran bir
 * mutasyonu YAKALAMIYORDU (olculdu: v-if="false" ile 23/23 YESIL kaldi) -- yani
 * "ana ekranda hangi agdayim okunuyor mu" sorusu kilitlenmemis olurdu.
 */
const visibleText = (html) => html.replace(/<[^>]*>/g, ' ')

describe('NetworkScopePill (SSR) -- VARSAYILAN kullanim aktif aga DOKUNMAZ', () => {
    // Home DISINDAKI dort cagri yeri (swapFrom, bridgeFrom, SearchTokens,
    // SelectAssets) prop'u GECMEZ. Orada kapsam degistirmek imzalama agini
    // degistirseydi, "Token Ice Aktar"da bir listeyi filtrelemek cuzdani baska
    // zincire tasirdi.
    it('switchesNetwork VERILMEZSE zincir secmek applyNetworkChange i CAGIRMAZ', async () => {
        const { app, captured, emitted } = mountPill({ modelValue: ALL_NETWORKS })
        await render(app)

        await captured.instance.setupState.select(137)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        // Kapsam YINE de tasinir: bu bir filtre kontrolu olarak calismaya devam eder.
        expect(emitted).toEqual([137])
    })

    it('switchesNetwork VERILMEZSE Solana secmek de yalnizca kapsamdir', async () => {
        const { app, captured, emitted } = mountPill({ modelValue: ALL_NETWORKS })
        await render(app)

        await captured.instance.setupState.select(SOLANA_CHAIN_ID)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([SOLANA_CHAIN_ID])
    })
})

describe('NetworkScopePill (SSR) -- switchesNetwork: tek kontrol hem agi hem kapsami tasir', () => {
    it('somut zincir DOGRU ZINCIR KAYDIYLA applyNetworkChange e gider VE kapsam emit edilir', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(137)

        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(1)
        // KAYIT'in KENDISI gecilmeli (chainId degil): applyNetworkChange rpc
        // listesini, adi ve logoyu o kayittan okur.
        const [chain, t] = applyNetworkChangeMock.mock.calls[0]
        expect(chain.chainId).toBe(137)
        expect(chain.name).toBe(POLYGON_CHAIN.name)
        // `t` gecilmezse RPC erisilemedigindeki uyari `t is not a function` ile coker.
        expect(typeof t).toBe('function')
        expect(t('network.rpcUnreachable', { name: 'X' })).not.toBe('network.rpcUnreachable')

        expect(emitted).toEqual([137])
    })

    // METIN KIMLIK: kati `===`/Number() kullanan bir uygulama TAM BURADA patlar --
    // Number('solana-mainnet') NaN'dir, zincir kaydi bulunamaz ve ag hic degismez
    // (kullanici Solana'ya bir daha giremez).
    it('Solana ("solana-mainnet", METIN kimlik) secmek de agi degistirir', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(SOLANA_CHAIN_ID)

        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(1)
        const [chain] = applyNetworkChangeMock.mock.calls[0]
        expect(chain.chainId).toBe(SOLANA_CHAIN_ID)
        expect(chain.vm).toBe('solana')
        expect(emitted).toEqual([SOLANA_CHAIN_ID])
    })

    // GERI DONUS YOLU: Solana aktifken EVM'e donebilmek. Bu yol kapanirsa cuzdan
    // Solana'da kilitlenir (Task 16a'nin cozdugu hatanin aynasi).
    it('Solana AKTIFKEN EVM zincirine geri donulebilir', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: SOLANA_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(1)

        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(1)
        expect(applyNetworkChangeMock.mock.calls[0][0].chainId).toBe(1)
        expect(emitted).toEqual([1])
    })

    // "Tum Aglar" BIR ZINCIR DEGILDIR: gecilecek ag yok. Bu secenek dusurulseydi
    // Home'un capraz zincir portfoy toplami da giderdi.
    it('"Tum Aglar" secmek applyNetworkChange i ASLA cagirmaz', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: 137, switchesNetwork: true, currentNetwork: POLYGON_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(ALL_NETWORKS)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([ALL_NETWORKS])
    })

    // MENUYU KAPATMA HAREKETI: ekranda YAZAN degere basmak bir secim degildir --
    // ama bu YALNIZCA gosterilen zincir ZATEN AKTIFKEN dogrudur. Burada kapsam da
    // aktif ag da Polygon: yapilacak hicbir sey yok, menu sadece kapanir.
    it('gosterilen zincir ZATEN AKTIFKEN ona basmak ne emit eder ne ag degistirir', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: 137, switchesNetwork: true, currentNetwork: POLYGON_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(137)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
    })

    // OLU DUGME (kod incelemesi, yuksek): kapsam ile aktif ag AYRISABILIR ve
    // ayrisma TEK ADIMDA uretilir -- Gonder/Takas/Kopru/Token Ara ekranlarindaki
    // pill'ler `switches-network` GECMEDEN ayni PAYLASILAN store'a yazar
    // (SelectAssets.vue: scope.setFilter(value), ag DEGISMEZ). Home'a donunce
    // etiket "Polygon" der ama cuzdan Ethereum'dadir.
    //
    // Erken donus YALNIZCA modelValue'ye bakarsa, kullanicinin "Polygon'a gec"
    // hareketi TAM BURADA yutulur: Header'daki chip kaldirildigi ve Swap'in
    // ChangeNetwork'u EVM-only oldugu icin bu pill agi degistirmenin TEK yolu,
    // yani dogrudan hareket OLU bir tiklamaya donusur.
    it('kapsam gosterilen zinciri yazarken AKTIF AG BASKAYSA, ona basmak agi DEGISTIRIR', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: 137, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(137)

        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(1)
        expect(applyNetworkChangeMock.mock.calls[0][0].chainId).toBe(137)
        // Kapsam ZATEN 137: emit degeri degistirmez ama `chosen` mandalini kaldirir
        // (kullanici bu soruya ACIKCA cevap verdi).
        expect(emitted).toEqual([137])
    })

    // AYNI OLU DUGME, EN AGIR HALI: Solana. Kapsam Solana'yi yaziyor, cuzdan
    // Ethereum'da. Bu tiklama yutulursa Solana'ya girisin TEK yolu kapanir
    // (Task 16a'nin cozdugu "Solana arayuzden erisilemez" hatasi geri gelir).
    it('kapsam Solana yi yazarken aktif ag EVM ise, Solana ya basmak agi DEGISTIRIR', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: SOLANA_CHAIN_ID, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(SOLANA_CHAIN_ID)

        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(1)
        expect(applyNetworkChangeMock.mock.calls[0][0].chainId).toBe(SOLANA_CHAIN_ID)
        expect(emitted).toEqual([SOLANA_CHAIN_ID])
    })

    // ...ve bu gevseme switchesNetwork VERILMEYEN dort cagri yerine SIZMAMALI:
    // orada kapsam ile aktif agin ayrismasi BEKLENEN durumdur ve gosterilen degere
    // basmak yalnizca menuyu kapatir (swapFrom TURETILMIS deger gosterip PAYLASILAN
    // store'a yazar -- kosulsuz emit Home'un portfoy toplamini sessizce daraltirdi).
    it('switchesNetwork YOKKEN ayrisik durumda bile gosterilen degere basmak SESSIZDIR', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: 137, switchesNetwork: false, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(137)

        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
        expect(emitted).toEqual([])
    })

    // ...ama AKTIF ZINCIRE basmak, kapsam "Tum Aglar" iken GECERLI bir istektir:
    // erken donus YALNIZCA modelValue'ye bakmali, currentNetwork'e DEGIL.
    it('kapsam "Tum Aglar" iken AKTIF zincire basmak kapsami daraltir', async () => {
        const { app, captured, emitted } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        await captured.instance.setupState.select(1)

        expect(emitted).toEqual([1])
        // Ag ZATEN o zincirde: applyNetworkChange yan etkisiz DEGIL (swap/bridge
        // token secimlerini sifirlar, dapp'lere CHAIN_CHANGED yollar). Yalnizca
        // listeyi daralttigi icin kullanicinin secimleri silinmemeli.
        expect(applyNetworkChangeMock).not.toHaveBeenCalled()
    })
})

describe('NetworkScopePill (SSR) -- aktif zincir menude ISARETLENIR', () => {
    // Birlestirmenin TEK gercek riski: "Tum Aglar" seciliyken etiket hicbir zincir
    // adi tasimaz, yani kullanici GORDUGU listeyi bilir ama ISLEM YAPACAGI zinciri
    // bilmez. Isaret bu boslugu kapatir.
    it('EVM aktifken YALNIZ O SATIR isaretli ve etiket CEVRILMIS gelir', async () => {
        const { app, captured } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: ETH_CHAIN, open: true,
        })
        const html = await render(app)

        const isActiveChain = captured.instance.setupState.isActiveChain
        expect(isActiveChain(1)).toBe(true)
        expect(isActiveChain(137)).toBe(false)

        // ISARET AKTIF SATIRDA -- ve BASKA HICBIR SATIRDA. Iddia satir bazli
        // olmazsa ters polarite (isaret 10 aktif-olmayan satirda) da gecerdi.
        expect(menuRow(html, 'Ethereum')).toContain('>active<')
        expect(menuRow(html, 'Polygon')).not.toContain('>active<')
        expect(menuRow(html, 'Solana')).not.toContain('>active<')
        expect(countOf(html, '>active<')).toBe(1)
        // HAM ANAHTAR EKRANDA GORUNMEZ.
        expect(html).not.toContain('common.activeNetwork')
    })

    // METIN kimlik (Solana) ve METIN yazimli EVM kimligi ('137') -- kati `===`
    // ikisini de kacirirdi.
    it('Solana aktifken Solana satiri isaretli, EVM satirlari degil', async () => {
        const { app, captured } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: SOLANA_CHAIN, open: true,
        })
        const html = await render(app)

        const isActiveChain = captured.instance.setupState.isActiveChain
        expect(isActiveChain(SOLANA_CHAIN_ID)).toBe(true)
        expect(isActiveChain(1)).toBe(false)

        expect(menuRow(html, 'Solana')).toContain('>active<')
        expect(menuRow(html, 'Ethereum')).not.toContain('>active<')
        expect(countOf(html, '>active<')).toBe(1)
    })

    it('aktif zincirin METIN yazimli EVM kimligi de ayni zincir sayilir', async () => {
        const { app, captured } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true,
            currentNetwork: { ...POLYGON_CHAIN, chainId: '137' }, open: true,
        })
        await render(app)

        const isActiveChain = captured.instance.setupState.isActiveChain
        expect(isActiveChain(137)).toBe(true)
        expect(isActiveChain(1)).toBe(false)
    })

    // Isaret AG ANAHTARININ parcasidir: agi degistirmeyen dort ekranda "aktif ag"
    // kavraminin listede isi yok (orada kapsam ile aktif ag bilerek AYRISABILIR).
    // Etiket cozumlemesi de isSameChainId tabanli olmali: kapsam degeri
    // nextNetworkFilter/effectiveScope uzerinden METIN olarak ('137') gelebiliyor.
    // Kati === ile chip'te NE AD NE LOGO kalirdi -- kullanici hangi kapsamda
    // oldugunu goremezdi.
    it('METIN yazimli chainId de pill etiketinde ADIYLA cozulur', async () => {
        const { app } = mountPill({ modelValue: '137', currentNetwork: ETH_CHAIN })
        const html = await render(app)

        expect(html).toContain('>Polygon<')
        expect(html).toContain('title="Polygon"')
    })

    it('switchesNetwork VERILMEZSE isaret GOSTERILMEZ', async () => {
        const { app } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: false, currentNetwork: ETH_CHAIN, open: true,
        })
        const html = await render(app)

        expect(html).not.toContain('>active<')
        // Liste yine tam: gizlenen yalnizca isaret.
        expect(html).toContain('<span class="truncate">Ethereum</span>')
        expect(html).toContain('<span class="truncate">Solana</span>')
    })
})

describe('NetworkScopePill (SSR) -- AKTIF AG menu KAPALIYKEN de okunur', () => {
    // KOK NEDEN: Header'daki <ChangeNetwork all-vms /> chip'i aktif zincirin ADINI
    // ana ekranda KOSULSUZ basiyordu; birlestirme onu kaldirdi. Geriye kalan tek
    // kontrolun etiketi ise KAPSAMI gosterir (Home.vue: :model-value="scope.filter")
    // ve tokenScope OTURUM ICI olup her acilista 'all' ile basladigi icin, popup'in
    // VARSAYILAN durumunda ekranda hangi zincirde imzalandigini soyleyen HICBIR SEY
    // kalmiyordu. Menu icindeki isaret bu boslugu KAPATMAZ: bir tiklamanin
    // arkasindadir ve kendinden emin bir etiket kullaniciya menuyu acmak icin sebep
    // vermez.
    it('kapsam "Tum Aglar" iken tetikleyici AKTIF AGIN ADINI tasir (menu KAPALI)', async () => {
        const { app } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: POLYGON_CHAIN,
        })
        const html = await render(app)

        // Menu GERCEKTEN kapali: hicbir satir render edilmedi.
        expect(html).not.toContain('<span class="truncate">Ethereum</span>')
        // ...ama aktif agin adi EKRANDA YAZIYOR (ozniteliklerde degil: `title`
        // yalnizca fare ustunde gorunur, ana ekrani okunur kilmaz).
        expect(visibleText(html)).toContain('Polygon')
        expect(html).toContain('active: Polygon')
    })

    it('Solana aktifken de menu KAPALIYKEN adi gorunur', async () => {
        const { app } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: SOLANA_CHAIN,
        })
        const html = await render(app)

        expect(html).not.toContain('<span class="truncate">Solana</span>')
        expect(visibleText(html)).toContain('Solana')
        expect(html).toContain('active: Solana')
    })

    // AYRISIK DURUM: etiket kapsami ("Polygon") yazarken cuzdan Ethereum'da. Tek
    // chip iki farkli seyi anlatmak zorunda; aktif ag ADIYLA gorunmezse kullanici
    // yanlis zincirde oldugunu bilemez.
    it('kapsam AKTIF OLMAYAN bir zinciri yazarken aktif ag AYRICA gorunur', async () => {
        const { app } = mountPill({
            modelValue: 137, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        const html = await render(app)

        // Etiket KAPSAMI yaziyor...
        expect(html).toContain('>Polygon<')
        // ...aktif ag ise AYRICA ve GORUNUR bicimde adlandiriliyor.
        expect(visibleText(html)).toContain('Ethereum')
        expect(html).toContain('active: Ethereum')
    })

    // switchesNetwork VERILMEYEN dort ekranda "aktif ag" kavraminin listede isi yok:
    // orada kapsam ile aktif ag BILEREK ayrisir ve ikinci bir ag adi yaniltirdi.
    it('switchesNetwork YOKKEN tetikleyici aktif agi HIC anmaz', async () => {
        const { app } = mountPill({
            modelValue: 137, switchesNetwork: false, currentNetwork: ETH_CHAIN,
        })
        const html = await render(app)

        expect(html).toContain('>Polygon<')
        expect(html).not.toContain('Ethereum')
        expect(visibleText(html)).not.toContain('Ethereum')
        expect(html).toContain('title="Polygon"')
    })
})

describe('NetworkScopePill -- menu satirlari GERCEKTEN tiklamaya BAGLI', () => {
    // NEDEN KAYNAK UZERINDEN: vue/server-renderer olay dinleyicilerini HTML'e HIC
    // basmaz, yani bu depodaki TUM SSR harness'i tanimi geregi @click baglantisini
    // olcemez -- testler secimi `setupState.select(...)` ile, sablonu ATLAYARAK
    // yapar. Olculdu (kod incelemesi): @click="select(chain.chainId)" ->
    // @click="open = false" mutasyonu 1806 testin HICBIRINI kirmadi; menu acilir,
    // kullanici Solana'ya basar, hicbir sey olmaz.
    // Ayni kilit deseni depoda ZATEN var: assetRouteWiring.test.js ve
    // SavedAddresses.ssr.test.js.
    it('zincir satiri select(chain.chainId) e baglidir', () => {
        expect(PILL_SOURCE).toContain('@click="select(chain.chainId)"')
    })

    it('"Tum Aglar" satiri select(ALL_NETWORKS) e baglidir', () => {
        // Capraz zincir portfoy toplaminin TEK girisi.
        expect(PILL_SOURCE).toContain('@click="select(ALL_NETWORKS)"')
    })

    it('tetikleyici dugme menuyu acar', () => {
        // Bu baglanti olmadan menu HIC acilmaz: yukaridaki iki satirin varligi bile
        // kullaniciya ulasmaz (testler `open`i ELLE yazdigi icin fark edilmezdi).
        expect(PILL_SOURCE).toContain('@click="open = !open"')
    })
})

describe('NetworkScopePill (SSR) -- BAYAT secim YENISINI EZMEZ', () => {
    // applyNetworkChange ANINDA donmez: findFastestRPC her RPC icin 3sn zaman
    // asimli iki sonda kosar, yani bozuk baglantida SANIYELER surer. Menu secim
    // aninda kapanir ama tetikleyici kilitlenmezse kullanici menuyu tekrar acip
    // BASKA bir zincir secebilir. Iki cagri yarisirsa ONCE baslayan SONRA
    // bitebilir ve emit sirasi tersine doner: kapsam bir zinciri, aktif ag
    // baskasini gosterir. Kullanicinin YENI secimi eskisiyle EZILMEMELI.
    it('once baslayip SONRA biten secim kapsami EMIT ETMEZ', async () => {
        let releaseFirst
        const firstPending = new Promise((resolve) => { releaseFirst = resolve })
        applyNetworkChangeMock
            .mockImplementationOnce(async () => { await firstPending; return true })
            .mockImplementationOnce(async () => true)

        const { app, captured, emitted } = mountPill({
            modelValue: ALL_NETWORKS, switchesNetwork: true, currentNetwork: ETH_CHAIN,
        })
        await render(app)

        const first = captured.instance.setupState.select(137)          // ASKIDA kalir
        const second = captured.instance.setupState.select(SOLANA_CHAIN_ID)
        await second
        releaseFirst()
        await first

        // Ikisi de ag degisimini DENEDI...
        expect(applyNetworkChangeMock).toHaveBeenCalledTimes(2)
        // ...ama kapsam YALNIZCA kullanicinin SON secimini tasir. Bilet korumasi
        // kalkarsa burada [SOLANA, 137] olur ve kullanici Solana sectigi halde
        // liste Polygon'a doner.
        expect(emitted).toEqual([SOLANA_CHAIN_ID])

        applyNetworkChangeMock.mockImplementation(async () => true)
    })

    it('tetikleyici ag degisimi UCUSTAYKEN kilitlidir', () => {
        // Yarisi BASTAN onleyen kapi (bilet korumasi son savunmadir). Kaynak
        // uzerinden: SSR tek sefer render eder, "ucus sirasindaki" durumu
        // gercekten uretemez -- ayni gerekce yukaridaki @click kilitlerinde.
        expect(PILL_SOURCE).toContain(':disabled="switching"')
    })
})
