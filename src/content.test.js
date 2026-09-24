// content.js'in sayfa<->arka plan ropru davranisi -- sahte window/document/chrome
// ile GERCEKTEN calistirilarak.
//
// Bulgu (dapp bug taramasi): kapinin engelledigi payload SESSIZCE dusuruluyordu.
// injected.js request() {resolve,reject}'i _callbacks'e koyar ve YALNIZ yanit
// gelince siler; yanitsiz birakilan istek dapp tarafinda sonsuza dek askida
// kalir (request() icinde zaman asimi yok) ve callback sizintisi olusur.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let win
let sentToBackground
let onMessageListeners

function installStubs(hostname = 'app.dedust.io', origin = 'https://app.dedust.io', { ustCerceveMi = true } = {}) {
    win = new EventTarget()
    win.posted = []
    win.postMessage = (data) => { win.posted.push(data) }
    // GOREV 14: content.js TON disconnect olaylarini kendi cercevesinin
    // `window.location.hostname`iyle suzuyor. Solana dali AYNI suzgeci ORIGIN ile
    // uygular (K5) -- bu yuzden sahte location IKISINI de tasir.
    win.location = { hostname, origin }
    // C1.3: solanaCerceveIzinli `window !== window.top` ile ust cerceveyi
    // kontrol eder. Varsayilan TOP-FRAME (kendine esit) -- iframe testleri
    // `ustCerceveMi:false` ile FARKLI bir nesneye isaret ettirir.
    win.top = ustCerceveMi ? win : {}
    vi.stubGlobal('window', win)

    vi.stubGlobal('document', {
        head: { appendChild: () => {} },
        documentElement: { appendChild: () => {} },
        createElement: () => ({ setAttribute: () => {}, remove: () => {}, set onload(_) {} }),
    })

    sentToBackground = []
    onMessageListeners = []
    globalThis.chrome = {
        runtime: {
            getURL: (p) => 'chrome-extension://wats/' + p,
            sendMessage: vi.fn((payload, cb) => {
                sentToBackground.push(payload)
                cb({ result: 'ok' })
            }),
            onMessage: { addListener: (fn) => { onMessageListeners.push(fn) } },
            lastError: undefined,
        },
    }
}

function deliverFromBackground(message) {
    for (const listener of onMessageListeners) listener(message, {}, () => {})
}

function deliverFromPage(payload, id = 'req-1') {
    const event = new Event('message')
    event.source = win
    event.data = { target: 'wats_content_script', id, payload }
    win.dispatchEvent(event)
}

beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllGlobals()
    installStubs()
    await import('./content.js')
})

describe('content.js -- kapinin engelledigi payload YANITSIZ BIRAKILMAZ', () => {
    it('ic aksiyon tasiyan payload sayfaya 4200 hatasiyla geri doner, arka plana GITMEZ', () => {
        deliverFromPage({ type: 'SIGN', message: {} }, 'blocked-1')

        expect(sentToBackground).toEqual([])
        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_inpage',
            id: 'blocked-1',
            error: expect.objectContaining({ code: 4200 }),
        }))
    })

    it('bozuk (nesne olmayan) payload da yanitlanir', () => {
        deliverFromPage('kotu-dizge', 'blocked-2')

        expect(sentToBackground).toEqual([])
        expect(win.posted).toContainEqual(expect.objectContaining({
            id: 'blocked-2',
            error: expect.objectContaining({ code: 4200 }),
        }))
    })

    it('mesru dapp istegi degismedi: arka plana gider, yaniti sayfaya tasinir (regresyon)', () => {
        deliverFromPage({ method: 'eth_chainId', params: [] }, 'ok-1')

        expect(sentToBackground).toEqual([{ method: 'eth_chainId', params: [] }])
        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_inpage',
            id: 'ok-1',
            result: 'ok',
        }))
    })
})

// GOREV 14: notifyTonDapp defekti (arka planda duzeltildi -- utils/tonDappFunctions.js)
// artik TUM sekmelere frameId VERMEDEN yolluyor; TEK gercek suzgec burada, cerceve
// duzeyinde. Bu blok o suzgecin GERCEKTEN calistigini kanitlar -- olmasaydi
// notifyTonDapp'in "artik hepsine yolluyorum" degisikligi TEK BASINA hicbir sey
// duzeltmezdi, sadece yanlis cerceveye de ulasir hale getirirdi.
// CANLI HATA (2026-09-11): "Error handling response: TypeError: Cannot read
// properties of null (reading 'result')". `response` NULL geldi, `lastError`
// BOSTU ve eski kod `response.result`u KORUMASIZ okuyordu -> callback FIRLADI
// -> asagidaki postMessage HIC calismadi -> sayfaya hicbir sey gitmedi ->
// injected.js'in `_callbacks` kaydi cozulmedi (orada zaman asimi YOK) ->
// dapp'in await'i SONSUZA asili kaldi. Konsol hatasi belirti, olu kilitlenmis
// dapp asil zarardi. `error` icin `?.` ZATEN vardi; eksik olan `result`ti.
describe('content.js -- BOS yanit dapp i asili BIRAKMAZ', () => {
    const bosYanitlar = [['null', null], ['undefined', undefined], ['dizge', 'bozuk']]

    it.each(bosYanitlar)('%s yanitinda callback FIRLATMAZ', (_ad, deger) => {
        chrome.runtime.sendMessage = vi.fn((payload, cb) => { cb(deger) })
        expect(() => deliverFromPage({ method: 'eth_chainId', params: [] })).not.toThrow()
    })

    it.each(bosYanitlar)('%s yanitinda sayfaya EIP-1193 sekilli hata postalanir', (_ad, deger) => {
        chrome.runtime.sendMessage = vi.fn((payload, cb) => { cb(deger) })
        deliverFromPage({ method: 'eth_chainId', params: [] }, 'req-bos')

        const yanit = win.posted.find((m) => m.id === 'req-bos')
        expect(yanit, 'sayfaya HICBIR mesaj gitmedi -- dapp sonsuza asilirdi').toBeTruthy()
        expect(yanit.error).toEqual({ code: -32603, message: expect.any(String) })
    })

    // OKSUZ ICERIK BETIGI (2026-09-11 tarayicida olculdu): uzanti yeniden
    // yuklendiginde acik sayfadaki betik eski baglamda kalir ve
    // `chrome.runtime.sendMessage` SENKRON FIRLAR -- callback HIC cagrilmaz,
    // yani yukaridaki bos-yanit kapisi de calismaz. Olculen davranis: istek
    // 2.5 sn icinde hic cevaplanmadi (injected.js'te zaman asimi YOK).
    it('sendMessage FIRLARSA dapp asili kalmaz, sayfa yenileme mesaji doner', () => {
        chrome.runtime.sendMessage = vi.fn(() => { throw new Error('Extension context invalidated.') })

        expect(() => deliverFromPage({ method: 'eth_chainId', params: [] }, 'req-oksuz')).not.toThrow()

        const yanit = win.posted.find((m) => m.id === 'req-oksuz')
        expect(yanit, 'sayfaya HICBIR mesaj gitmedi -- dapp sonsuza asilirdi').toBeTruthy()
        expect(yanit.error.code).toBe(-32603)
        expect(yanit.error.message).toMatch(/[Rr]efresh/)
    })

    // Saglikli yanit yolu DEGISMEDI: `result` aynen gecer, `null` bir sonuc da
    // (EIP-3326'nin wallet_switchEthereumChain donusu TAM OLARAK budur)
    // "bos yanit" sayilmaz.
    it('gecerli yanitta result aynen gecer', () => {
        chrome.runtime.sendMessage = vi.fn((payload, cb) => { cb({ result: '0x38' }) })
        deliverFromPage({ method: 'eth_chainId', params: [] }, 'req-ok')

        expect(win.posted.find((m) => m.id === 'req-ok').result).toBe('0x38')
    })

    it('result NULL olan gecerli yanit hata sayilmaz (EIP-3326 donusu)', () => {
        chrome.runtime.sendMessage = vi.fn((payload, cb) => { cb({ result: null }) })
        deliverFromPage({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }, 'req-null')

        const yanit = win.posted.find((m) => m.id === 'req-null')
        expect(yanit.error).toBeUndefined()
        expect(yanit.result).toBeNull()
    })
})

// EVM SERIDI: TON dalindaki AYNI cerceve suzgeci, AYNI gerekceyle.
//
// IKI DEFEKTI BIRDEN kapatir:
//  (a) ULASMAYAN OLAY -- `notifyConnectedDapps` artik frameId VERMEDEN TUM
//      sekmelere yolluyor (bkz. background.js'teki not), cunku eski "ust cerceve
//      hostname'i" suzgeci iframe icindeki dapp'i HIC bulamiyordu.
//  (b) SIZAN OLAY -- content.js `all_frames:true` ile calisir ve bu dalda HICBIR
//      suzgec YOKTU: bagli bir dapp sayfasindaki ucuncu taraf iframe'ler
//      (reklam/widget/analitik) `accountsChanged` ile kullanicinin EVM adresini
//      kendi sayfalarina alabiliyordu. Kullanici hicbir sey gormeden sizan bir
//      adres, TON/Solana seritlerinde en bastan onlenmis bir hataydi.
describe('content.js -- EVM olayi CERCEVE duzeyinde suzulur', () => {
    it('hedef listesi bu cercevenin location.hostname ini ICERIYORSA sayfaya iletilir', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('dapp.example')
        await import('./content.js')

        // LISTE: arka plan sekme basina TEK mesaj yolluyor ve bagli hostname'lerin
        // HEPSINI tasiyor (gerekce background.js'te). Bu cerceve yalnizca KENDI
        // adini arar.
        deliverFromBackground({ target: 'wats_inpage', hostnames: ['baska.example', 'dapp.example'], method: 'accountsChanged', result: ['0xAaaa'] })

        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_inpage',
            method: 'accountsChanged',
            result: ['0xAaaa'],
        }))
    })

    // ASIL SIZINTI SENARYOSU: kullanici `dapp.example`a bagli, sayfada
    // `ads.thirdparty.tld` iframe'i var. O cercevede calisan content.js kopyasi
    // AYNI mesaji alir; iletirse hic baglanmadigi bir origin kullanicinin EVM
    // adresini `window.ethereum.on('accountsChanged')` ile ogrenir.
    it('mesajdaki hostname FARKLIYSA HICBIR SEY iletilmez (ucuncu taraf iframe sizintisi)', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('ads.thirdparty.tld')
        await import('./content.js')

        deliverFromBackground({ target: 'wats_inpage', hostnames: ['dapp.example'], method: 'accountsChanged', result: ['0xAaaa'] })

        expect(win.posted.find((m) => m.target === 'wats_inpage')).toBeUndefined()
    })

    // FAIL-CLOSED: hedef listesi TASIMAYAN bir mesaj (eski bicim, ya da baska bir
    // yoldan gelen) hangi cerceveye ait oldugunu KANITLAYAMAZ. Ileten bir
    // surum, yukaridaki (b) sizintisini eski haliyle geri getirirdi.
    it('mesajda hedef listesi HIC YOKSA iletilmez', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('dapp.example')
        await import('./content.js')

        deliverFromBackground({ target: 'wats_inpage', method: 'accountsChanged', result: ['0xAaaa'] })

        expect(win.posted.find((m) => m.target === 'wats_inpage')).toBeUndefined()
    })
})

describe('content.js -- TON disconnect olayi CERCEVE duzeyinde suzulur (Gorev 14)', () => {
    it('mesajdaki hostname bu cercevenin location.hostname iyle ESLESIRSE sayfaya iletilir', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('app.dedust.io')
        await import('./content.js')

        deliverFromBackground({ target: 'wats_ton_inpage', hostname: 'app.dedust.io', event: { event: 'disconnect', id: 1, payload: {} } })

        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_ton_inpage',
            event: { event: 'disconnect', id: 1, payload: {} },
        }))
    })

    // ASIL DEFEKT SENARYOSU: dapp bir iframe icinde, bu SEKMENIN digerinde
    // (baska bir cercevesinde -- or. ust sayfa ya da sayfadaki BASKA bir iframe)
    // calisan content.js kopyasi AYNI mesaji alir ama KENDI hostname'i farkli.
    // O kopya olayi sayfaya ILETMEMELI -- iletirse ya yanlis dapp'e "baglantin
    // kesildi" der ya da hic kimseye ulasmayan bir olay icin sessiz kalmasi
    // gereken cerceve gurultu yapar.
    it('mesajdaki hostname bu cercevenin location.hostname inden FARKLIYSA HICBIR SEY iletilmez', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('baska-cerceve.example')
        await import('./content.js')

        deliverFromBackground({ target: 'wats_ton_inpage', hostname: 'app.dedust.io', event: { event: 'disconnect', id: 1, payload: {} } })

        expect(win.posted.find((m) => m.target === 'wats_ton_inpage')).toBeUndefined()
    })
})

// SOLANA SERIDI. Yanit YANLIS serite dusseydi injected.js id'yi kendi
// _callbacks'inda bulamaz ve SESSIZCE atardi -- dapp'in await'i sonsuza dek
// asili kalir, callback de sizar. Dosyanin kendi yorumu bu tuzagi TON icin
// zaten yazmisti; bu blok ucuncu serit icin kanitlar.
describe('content.js -- solana_* yaniti KENDI seridine doner', () => {
    it('solana_connect yaniti wats_solana_inpage e gider, wats_inpage e ASLA', () => {
        deliverFromPage({ method: 'solana_connect', params: [{ silent: false }] }, 'sol-1')

        expect(sentToBackground).toEqual([{ method: 'solana_connect', params: [{ silent: false }] }])
        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_solana_inpage',
            id: 'sol-1',
            result: 'ok',
        }))
        expect(win.posted.find((m) => m.target === 'wats_inpage')).toBeUndefined()
        expect(win.posted.find((m) => m.target === 'wats_ton_inpage')).toBeUndefined()
    })

    it('EVM ve TON seritleri DEGISMEDI (regresyon)', () => {
        deliverFromPage({ method: 'eth_chainId', params: [] }, 'evm-1')
        deliverFromPage({ method: 'tonconnect_restore', params: [] }, 'ton-1')

        expect(win.posted).toContainEqual(expect.objectContaining({ target: 'wats_inpage', id: 'evm-1' }))
        expect(win.posted).toContainEqual(expect.objectContaining({ target: 'wats_ton_inpage', id: 'ton-1' }))
    })
})

// C1.3 -- SAVUNMA DERINLIGI: solanaInjected.js'in enjeksiyon kapsami
// (manifest.config.js -- top-frame + https/localhost/127.0.0.1) bu dosyada
// (content.js, <all_urls> + all_frames:true) zorlanmiyordu; bir iframe ya da
// yabanci semali bir sayfa solana_* payload'ini dogrudan bu dinleyiciye
// postMessage edebilirdi. ASIL kapi arka planda solanaSayfaKapisi'dir --
// asagidaki testler yalniz bu dosyanin istegi arka plana HIC gondermedigini
// kanitlar (background'a hic ulasmadigi icin background'daki kapiyi tekrar
// TEST ETMEZ).
describe('content.js -- solana serit sayfa kapisi (C1.3, savunma derinligi)', () => {
    it('UST CERCEVE DEGILSE (iframe) solana istegi 4100 ile YANITLANIR, arka plana GITMEZ', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('app.jup.ag', 'https://app.jup.ag', { ustCerceveMi: false })
        await import('./content.js')

        deliverFromPage({ method: 'solana_connect', params: [{ silent: false }] }, 'sol-iframe')

        expect(sentToBackground).toEqual([])
        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_solana_inpage',
            id: 'sol-iframe',
            error: { code: 4100, message: 'Unauthorized.' },
        }))
    })

    it('SEMA IZIN LISTESI DISINDAYSA (http, localhost/127.0.0.1 DEGIL) solana istegi 4100 ile YANITLANIR, arka plana GITMEZ', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('app.jup.ag', 'http://app.jup.ag')
        await import('./content.js')

        deliverFromPage({ method: 'solana_connect', params: [{ silent: false }] }, 'sol-http')

        expect(sentToBackground).toEqual([])
        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_solana_inpage',
            id: 'sol-http',
            error: { code: 4100, message: 'Unauthorized.' },
        }))
    })

    it('UST cerceve + http://localhost -> IZIN LISTESI GECER, istek arka plana gider', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('localhost', 'http://localhost:3000')
        await import('./content.js')

        deliverFromPage({ method: 'solana_connect', params: [{ silent: false }] }, 'sol-localhost')

        expect(sentToBackground).toEqual([{ method: 'solana_connect', params: [{ silent: false }] }])
        expect(win.posted).toContainEqual(expect.objectContaining({ target: 'wats_solana_inpage', id: 'sol-localhost', result: 'ok' }))
    })

    // EVM/TON seritleri BU kapiya TABI DEGIL -- iframe'de calisan bir EVM
    // dapp'i (mevcut, mesru davranis) bu degisiklikle KIRILMAMALI.
    it('EVM istegi iframe icinde bile arka plana gider (kapi yalniz solana seridi icin)', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('app.jup.ag', 'https://app.jup.ag', { ustCerceveMi: false })
        await import('./content.js')

        deliverFromPage({ method: 'eth_chainId', params: [] }, 'evm-iframe')

        expect(sentToBackground).toEqual([{ method: 'eth_chainId', params: [] }])
    })
})

// K5: TON dalinin `hostname` karsilastirmasi Solana'da YETMEZ. Solana oturumlari
// TAM ORIGIN ile anahtarlanir; hostname ile suzmek `https://app.x.com` oturumunun
// olayini `http://app.x.com`a ve o host'un HER portuna verirdi.
describe('content.js -- solana change olayi ORIGIN ile suzulur', () => {
    it('origin ESLESIRSE olay sayfaya iletilir', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('app.jup.ag', 'https://app.jup.ag')
        await import('./content.js')

        deliverFromBackground({
            target: 'wats_solana_inpage',
            origin: 'https://app.jup.ag',
            event: { event: 'change', payload: { accounts: [] } },
        })

        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_solana_inpage',
            event: { event: 'change', payload: { accounts: [] } },
        }))
    })

    it('hostname AYNI ama sema/port FARKLIYSA HICBIR SEY iletilmez', async () => {
        vi.resetModules()
        vi.unstubAllGlobals()
        installStubs('app.jup.ag', 'http://app.jup.ag:8080')
        await import('./content.js')

        deliverFromBackground({
            target: 'wats_solana_inpage',
            origin: 'https://app.jup.ag',
            event: { event: 'change', payload: { accounts: [] } },
        })

        expect(win.posted.find((m) => m.target === 'wats_solana_inpage')).toBeUndefined()
    })
})
