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

function installStubs(hostname = 'app.dedust.io', origin = 'https://app.dedust.io') {
    win = new EventTarget()
    win.posted = []
    win.postMessage = (data) => { win.posted.push(data) }
    // GOREV 14: content.js TON disconnect olaylarini kendi cercevesinin
    // `window.location.hostname`iyle suzuyor. Solana dali AYNI suzgeci ORIGIN ile
    // uygular (K5) -- bu yuzden sahte location IKISINI de tasir.
    win.location = { hostname, origin }
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
