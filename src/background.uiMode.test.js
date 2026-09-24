import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './test-utils/kaynakTarama'

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let startupListeners
let installedListeners
let clickListeners
let changedListeners
let localStore
let chromeRef

function installChromeStub() {
    const listeners = {
        onAlarm: [], onConnect: [], onStartup: [], onInstalled: [],
        onMessage: [], onClicked: [], onChanged: [],
    }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    chromeRef = globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            // YOLU EKLER. Onceden argumani YOK SAYIP her cagriya ayni koku
            // donduruyordu; `getURL('onboarding.html')` ile `getURL('')` ayirt
            // edilemiyordu ve hangi sayfanin acildigini olcmek imkansizdi.
            getURL: (p = '') => EXTENSION_ORIGIN + p,
            onConnect: add('onConnect'),
            onStartup: add('onStartup'),
            onInstalled: add('onInstalled'),
            onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()),
            lastError: null,
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            onChanged: add('onChanged'),
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
                remove: vi.fn(async () => {}),
            },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            getCurrent: vi.fn(async () => ({ id: 7 })),
            onRemoved: { addListener: vi.fn() },
            remove: vi.fn(),
        },
        action: {
            setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(),
            setPopup: vi.fn(async () => {}),
            onClicked: add('onClicked'),
        },
        sidePanel: {
            setPanelBehavior: vi.fn(async () => {}),
            open: vi.fn(async () => {}),
        },
    }
    return listeners
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

/**
 * Arka plani SIFIRDAN ice aktarir.
 *
 * `baslangicDepo` PARAMETRE, cunku background.js modul UST DUZEYINDE
 * `readStoredUiMode().then(applyUiMode)` cagirir -- yani import ANINDA modu bir
 * kez UYGULAR. Testin olcecegi cagri o import-zamani uygulamasindan AYIRT
 * EDILEBILIR olmali; bunun tek saglam yolu deponun import'tan ONCE dogru
 * degerle doldurulmasidir (bkz. 'panel moduna geri doner' testindeki not).
 */
async function kur(baslangicDepo = {}) {
    vi.resetModules()
    vi.clearAllMocks()
    // KASA VARSAYILAN OLARAK DOLU. Bu dosyanin konusu KURULMUS bir cuzdanin
    // yuzey modudur. Bos `vaults` artik AYRI bir durumdur (kurulum modu: ikon
    // tiklamasi hicbir yuzey acmaz) ve asagida KENDI testleriyle olculuyor --
    // varsayilan bos kalsaydi buradaki her iddia farkinda olmadan o dali olcerdi.
    localStore = { vaults: [{ id: 'v1' }], dapps: {}, ...baslangicDepo }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
    startupListeners = listeners.onStartup
    installedListeners = listeners.onInstalled
    clickListeners = listeners.onClicked
    changedListeners = listeners.onChanged
}

beforeEach(async () => {
    await kur()
})

afterEach(() => { delete globalThis.chrome })

describe('background -- SET_UI_MODE', () => {
    it('modu yazar ve uygular', async () => {
        const yanit = await callHandler({ type: 'SET_UI_MODE', mode: 'popup' })
        expect(yanit).toEqual({ success: true, mode: 'popup' })
        expect(localStore.uiMode).toBe('popup')
        expect(chromeRef.action.setPopup).toHaveBeenCalledWith({ popup: 'src/popup/index.html' })
        expect(chromeRef.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false })
    })

    // KOD INCELEMESI (final inceleme, I6): bu test HANDLER'in bir sey yaptigini
    // KANITLAMIYORDU. `localStore.uiMode` bos oldugunda import-zamani
    // `readStoredUiMode().then(applyUiMode)` cagrisi varsayilan PANEL moduna
    // duser ve `setPopup({popup:''})`i test govdesi daha baslamadan ZATEN
    // cagirir -- handler hicbir sey yapmasa da iddia gecerdi.
    //
    // Depo import'tan ONCE 'popup' ile tohumlanir: o zaman import-zamani
    // uygulamasi `setPopup(POPUP_PATH)` cagirir ve `{popup:''}`in TEK olasi
    // kaynagi OLCULEN KODDUR. `clearAllMocks` da eklenir, ama tek basina
    // yeterli degil: fire-and-forget top-level promise'in ne zaman
    // cozuldugu garanti altinda degildir.
    it('panel moduna geri doner', async () => {
        await kur({ uiMode: 'popup' })
        expect(chromeRef.action.setPopup).toHaveBeenCalledWith({ popup: 'src/popup/index.html' })
        vi.clearAllMocks()

        await callHandler({ type: 'SET_UI_MODE', mode: 'sidepanel' })

        expect(localStore.uiMode).toBe('sidepanel')
        expect(chromeRef.action.setPopup).toHaveBeenCalledWith({ popup: '' })
        expect(chromeRef.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    })

    // Switch burada GECERLILIK icin OTORITER: writeUiMode kendi basina
    // yazmayi reddeder ama applyUiMode gecersiz girdide PANEL'e duserdi --
    // ikisi ayri cagrilirsa depodaki tercih (degismez) ile UYGULANAN davranis
    // (panele kayar) birbirinden AYRILIRDI. Bu yuzden gecersiz mod ne
    // YAZILMALI ne de UYGULANMALI, ve yanit bir hata olmali.
    it('gecersiz mod yazilmaz ve uygulanmaz', async () => {
        // Modul ice aktarilirken kendi top-level SW-acilis uygulamasi
        // (readStoredUiMode().then(applyUiMode)) zaten calisip bu mock'lari en
        // az bir kez cagirmis olabilir -- bu testin ILGILENDIGI sey HANDLER'in
        // kendisinin hicbir sey cagirmadigidir, import zamanindaki ayri bir
        // uygulamanin degil. Once temizle, sonra sadece handler'i olc.
        vi.clearAllMocks()
        const yanit = await callHandler({ type: 'SET_UI_MODE', mode: 'sacmalik' })
        expect(localStore.uiMode).toBeUndefined()
        expect(chromeRef.sidePanel.setPanelBehavior).not.toHaveBeenCalled()
        expect(chromeRef.action.setPopup).not.toHaveBeenCalled()
        expect(yanit).toEqual({ error: 'Invalid ui mode' })
    })

    // KAPI: sayfadan gelen mesaj reddedilmeli.
    it('dapp kokenli SET_UI_MODE reddedilir', async () => {
        const yanit = await callHandler(
            { type: 'SET_UI_MODE', mode: 'popup' },
            { url: 'https://evil.example', tab: { id: 3 } },
        )
        expect(yanit).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
        expect(localStore.uiMode).toBeUndefined()
    })
})

describe('background -- mod uygulama noktalari', () => {
    // setPopup KALICI DEGIL: tarayici yeniden baslayinca manifest'teki
    // default_popup geri gelir. onStartup bu sifirlanmayi yakalayan yerdir.
    it('onStartup modu yeniden uygular', async () => {
        localStore.uiMode = 'sidepanel'
        vi.clearAllMocks()
        for (const fn of startupListeners) await fn()
        expect(chromeRef.action.setPopup).toHaveBeenCalledWith({ popup: '' })
    })

    // M18 -- onInstalled HIC OLCULMUYORDU. Bu dalin trafigi onStartup'tan cok
    // daha yuksek: MEVCUT HER KULLANICI uzanti guncellemesinde tam olarak
    // buradan gecer. Kayit dusse ya da `applyUiMode` cagrisi kalksa hicbir test
    // kirilmadan guncelleme sonrasi ilk tiklama eski yuzeyi acardi.
    it('onInstalled modu uygular (guncellemede HER kullanicinin gectigi yol)', async () => {
        expect(installedListeners.length).toBeGreaterThan(0)
        localStore.uiMode = 'sidepanel'
        vi.clearAllMocks()

        for (const fn of installedListeners) await fn({ reason: 'update' })

        expect(chromeRef.action.setPopup).toHaveBeenCalledWith({ popup: '' })
        expect(chromeRef.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    })

    it('onInstalled popup tercihini de uygular', async () => {
        localStore.uiMode = 'popup'
        vi.clearAllMocks()

        for (const fn of installedListeners) await fn({ reason: 'update' })

        expect(chromeRef.action.setPopup).toHaveBeenCalledWith({ popup: 'src/popup/index.html' })
    })
})

// M19 -- KOKEN KAPISI ISLEYICININ ICINDE DE TEKRARLANIR (S4.6).
//
// BU IDDIA BILEREK KAYNAK DUZEYINDE. Kapi DAVRANISSAL olarak olculemez ve
// olculemedigi ISPATLANDI: dagiticinin switch'ten ONCEKI genel kapisi
// (`messageBlockReason` -> 'internal-only') bu mesaji zaten AYNI yanitla
// reddediyor, yani ic kontrol kaldirildiginda gozlemlenebilir davranis
// DEGISMIYOR (olculdu: kontrol silindiginde koken testi YESIL kaldi). Bu bir
// delik degil, SAVUNMA DERINLIGI -- ve Solana isleyicileriyle tutarlilik.
// Davranissal olarak kirilamayan bir iddiayi davranissalmis gibi yazmak, bu
// planin bes kez uretip attigi hatanin ta kendisi olurdu; bu yuzden iddia
// oldugu gibi, SET_UI_MODE case GOVDESINE sinirlanmis bir kaynak kilididir.
describe('background -- SET_UI_MODE koken kapisini TEKRARLAR (S4.6)', () => {
    const kaynak = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')

    // KOD INCELEMESI (CRLF/yorum turu, M5-M6): govde HAM kaynaktan kesiliyordu,
    // yani asagidaki iki iddia YORUM METNIYLE de saglanabiliyordu. Olculdu:
    // kapi satirinin basina `// ` konuldugunda (kapi FIILEN DEVRE DISI) her iki
    // iddia da YESIL kaliyordu; dort satirlik kapi blogu tamamen silinip yerine
    // `// TODO: restore if (!isWalletUiMessage(sender)) here` yazildiginda da
    // yesil kaliyordu -- yani isleyicide SIFIR kapi kodu varken. Govde artik
    // yorumlari BOSLUKLA degistirilmis kaynaktan kesilir (uzunluk korunur, yani
    // sira karsilastirmasi aynen calisir).
    const kod = yorumsuz(kaynak)

    /** `case 'SET_UI_MODE':` ile BIR SONRAKI `case` arasindaki govde. */
    const caseGovdesi = () => {
        const bas = kod.indexOf("case 'SET_UI_MODE':")
        expect(bas).toBeGreaterThan(-1)
        const son = kod.indexOf("    case '", bas + 1)
        expect(son).toBeGreaterThan(bas)
        return kod.slice(bas, son)
    }

    it('isleyici govdesi isWalletUiMessage(sender) kontrolu tasir', () => {
        expect(caseGovdesi()).toMatch(/if \(!isWalletUiMessage\(sender\)\)/)
    })

    it('koken kontrolu gecerlilik kontrolunden ONCE gelir', () => {
        const govde = caseGovdesi()
        const kokenAt = govde.indexOf('isWalletUiMessage(sender)')
        const gecerlilikAt = govde.indexOf('isValidUiMode(message.mode)')
        expect(kokenAt).toBeGreaterThan(-1)
        expect(gecerlilikAt).toBeGreaterThan(kokenAt)
    })

    // Kapinin GERCEKTEN kapali oldugu (yani dis kapinin da kapali oldugu)
    // yukaridaki 'dapp kokenli SET_UI_MODE reddedilir' testinde davranissal
    // olarak olculuyor -- bu iki iddia onun YERINE degil, YANINA.
})

describe('background -- ikon tiklamasi emniyet agi', () => {
    it('onClicked paneli o PENCEREDE acar', async () => {
        expect(clickListeners.length).toBeGreaterThan(0)
        await clickListeners[0]({ windowId: 9 })
        expect(chromeRef.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 })
    })
})

// ---------------------------------------------------------------------------
// KURULUM MODU: cuzdan HENUZ YOKKEN ikon tiklamasi YUZEY ACMAZ.
//
// KOK NEDEN: ilk kurulumda iki sey ayni anda aciliyordu -- onboarding sekmesi VE
// yan panel. Panel o anda kullaniciya yapabilecegi hicbir sey sunmuyor; tek isi
// kurulumdur ve o kurulum sekmede.
//
// MEKANIK KISIT (utils/uiMode.js): panel modunda Chrome paneli DOGRUDAN acar ve
// `chrome.action.onClicked` HIC TETIKLENMEZ -- yani "once cuzdan var mi" diye
// bakabilecegimiz bir nokta yoktur. Bu yuzden kurulum sirasinda IKI yuzey de
// kapatilir (popup yolu temiz + panel davranisi kapali); karar o zaman arka plana
// duser.
// ---------------------------------------------------------------------------
describe('background -- kurulum modu (cuzdan yok)', () => {
    it('kasa yokken panel davranisi ACILMAZ', async () => {
        await kur({ vaults: [] })
        expect(chromeRef.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false })
        expect(chromeRef.sidePanel.setPanelBehavior).not.toHaveBeenCalledWith({ openPanelOnActionClick: true })
    })

    it('kasa yokken ikon tiklamasi PANEL ACMAZ, kurulum sekmesi acar', async () => {
        await kur({ vaults: [] })
        await clickListeners[0]({ windowId: 9 })

        expect(chromeRef.sidePanel.open).not.toHaveBeenCalled()
        expect(chromeRef.tabs.create).toHaveBeenCalledWith({
            url: expect.stringContaining('onboarding.html'),
        })
    })

    // Kurulumunu yarida birakip ikona tekrar basan kullanici her basista yeni bir
    // sekme acsaydi, gizli ifadesini yazdigi sekmenin HANGISI oldugu belirsizlesirdi.
    it('kurulum sekmesi ZATEN acikken yenisi ACILMAZ, var olan one gelir', async () => {
        await kur({ vaults: [] })
        chromeRef.tabs.query = vi.fn(async () => [{ id: 42, windowId: 3 }])
        chromeRef.tabs.update = vi.fn(async () => {})

        await clickListeners[0]({ windowId: 9 })

        expect(chromeRef.tabs.update).toHaveBeenCalledWith(42, { active: true })
        expect(chromeRef.tabs.create).not.toHaveBeenCalled()
    })

    // Cuzdan varken YOL DEGISMEZ: bu, kurulum dalinin normal kullaniciya
    // sizmadiginin kanitidir.
    it('kasa VARKEN ikon tiklamasi kurulum sekmesi ACMAZ', async () => {
        await kur({ vaults: [{ id: 'v1' }] })
        await clickListeners[0]({ windowId: 9 })

        expect(chromeRef.tabs.create).not.toHaveBeenCalled()
        expect(chromeRef.sidePanel.open).toHaveBeenCalledWith({ windowId: 9 })
    })

    // KURULUM BITINCE PANEL GERI GELMELI. Aksi halde kullanici cuzdanini
    // olusturur ve ikona bastiginda HICBIR SEY acilmaz -- kurulum modu kalici bir
    // tuzaga donusurdu.
    it('ilk kasa yazilinca yuzey modu YENIDEN uygulanir', async () => {
        await kur({ vaults: [] })
        expect(changedListeners.length).toBeGreaterThan(0)
        localStore.vaults = [{ id: 'v1' }]
        vi.clearAllMocks()

        changedListeners[0]({ vaults: { newValue: [{ id: 'v1' }] } }, 'local')
        await new Promise((r) => setTimeout(r, 0))

        expect(chromeRef.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true })
    })
})
