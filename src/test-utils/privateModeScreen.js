// Ayarlar ekranlarinin (Dapps.vue, DappPermissions.vue) gizli mod SSR testleri icin ORTAK yardimcilar.
// Eskiden iki test dosyasinda birebir kopyaydi (T28 M1). `vue` mock'u (onMounted -> onServerPrefetch, sync watch)
// yine HER test dosyasinin kendisinde durur: vi.mock dosyaya baglidir (bkz. ssrRender.js KULLANIM notu).
import { privacyStore } from '../store/privacy'

const bekle = (ms) => new Promise((r) => setTimeout(r, ms))

// Modu render SIRASINDA (ilk okuma bittikten sonra, renderToString henuz beklerken) cevirir; her adimdan sonra
// bilesenin watcher'inin baslattigi yeniden okumanin bitmesi icin bekler (app.mixin + serverPrefetch).
// `flipSonrasi` verilirse mod cevrildikten HEMEN sonra, bekleme baslamadan once calisir (T29: tutulan okumayi birakir).
export function modDegisimi(app, yeni, { flipSonrasi } = {}) {
    app.mixin({
        async serverPrefetch() {
            await bekle(30)
            privacyStore().active = yeni
            if (flipSonrasi) await flipSonrasi()
            await bekle(30)
        },
    })
}

// chrome.storage.local.get'un ilk argumani uc bicimde gelebilir: dizi, dize ya da nesne ({ dapps: {} } -> anahtarlar
// nesnenin alanlaridir). undefined/null ise TUM depo okunur. Donus: istenen anahtar listesi, ya da null (hepsi).
function istenenAnahtarlar(keys) {
    if (keys === undefined || keys === null) return null
    if (typeof keys === 'string') return [keys]
    if (Array.isArray(keys)) return keys
    if (typeof keys === 'object') return Object.keys(keys)
    return []
}

// chrome.storage.local.get'in `anahtar` iceren ILK cagrisini `birak()` denene kadar tutar (digerleri aninda doner;
// ekranin oturum okumasi disindaki okumalar tutulan cagriyi tuketmesin diye anahtara gore secilir). Dizi, dize ve
// nesne bicimli anahtarlar taninir (T29 M1). Tutulan okuma birakilinca ONCEKI (genel mod) verisiyle cozulur: mod okuma
// suruyorken degisirse gecikmis sonucun listeleri geri doldurup doldurmadigini sinamak icin (T29).
// SESSIZ GECME YOK: hicbir cagri tutulmadiysa (anahtar hic okunmadi ya da bicim taninmadi) test korunan korumayi
// sinamiyor demektir; `birak()` bu durumda FIRLATIR ve `tutuldu` false kalir. Vue, serverPrefetch icindeki bir
// firlatmayi yutup render'a devam eder; bu yuzden testler render'dan sonra `expect(tutulan.tutuldu).toBe(true)` de
// iddia etmelidir. globalThis.chrome onceden kurulmus olmalidir (installChromeStub).
export function ilkOkumayiTut(anahtar = 'dapps') {
    const orijinal = globalThis.chrome.storage.local.get
    let birak
    const tutulan = new Promise((r) => { birak = r })
    let tutuldu = false
    globalThis.chrome.storage.local.get = async (keys) => {
        const istenen = istenenAnahtarlar(keys)
        if (!tutuldu && (istenen === null || istenen.includes(anahtar))) {
            tutuldu = true
            await tutulan
        }
        return orijinal(keys)
    }
    return {
        get tutuldu() { return tutuldu },
        birak: () => {
            if (!tutuldu) throw new Error("ilkOkumayiTut: '" + anahtar + "' iceren hicbir storage.local.get cagrisi tutulmadi; test korumayi sinamiyor")
            birak()
        },
    }
}
