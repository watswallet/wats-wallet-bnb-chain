import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * EVM olay yayini CERCEVE duzeyinde calisir -- ust cerceve hostname'iyle DEGIL.
 *
 * KOK NEDEN: EVM oturumlari `resolveSenderOrigin` ile, yani ISTEGI GONDEREN
 * CERCEVENIN hostname'iyle anahtarlanir (dappFunctions.js, iframe notu). Oysa
 * `notifyConnectedDapps` sekmeyi `tab.url`in -- UST CERCEVENIN adresinin --
 * hostname'iyle suzuyordu. Bir dapp iframe icinde calisiyorsa `tab.url` dapp'in
 * adresini HIC TASIMAZ (sarmalayici/aggregator sitesinin adresidir), dolayisiyla
 * o sekme `connectedHostnames` ile ESLESMEZ ve iframe'deki dapp
 * disconnect/connect/chainChanged olaylarini ASLA ALMAZ.
 *
 * Kullanicinin gordugu: TON'a gecince iframe'deki dapp hala "Connected" der ama
 * her cagrisi 4901 alir; EVM'e geri donuldugunde de uyanma sinyali (connect +
 * chainChanged) gelmedigi icin sayfa yenilenene kadar olu kalir.
 *
 * DUZELTME TON seridinde ZATEN UYGULANMIS olan desendir (notifyTonDapp, Gorev 14
 * ve content.js'teki cerceve suzgeci): yeni permission EKLEMEDEN,
 * `chrome.tabs.sendMessage(tabId, msg)` frameId VERILMEDEN o sekmenin TUM
 * cercevelerine ulasir; hedef hostname mesajin ICINDE tasinir ve hangi cercevenin
 * sayfaya ileteceginе content.js kendi `window.location.hostname`iyle karar verir.
 *
 * Harness background.solanaAccountChanged.test.js'ten alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let localStore
let sentTabMessages

// UST CERCEVE bir sarmalayici site; BAGLI dapp onun ICINDEKI iframe'de.
// `chrome.tabs.query` yalnizca UST cerceve adresini dondurur -- defektin tam
// kaynagi budur, bu yuzden stub gercek Chrome gibi SADECE onu dondurur.
const SARMALAYICI_SEKME = { id: 7, url: 'https://portal.example/swap' }

// UST CERCEVESI http(s) OLMAYAN sekme: icinde http(s) bir dapp iframe'i tasiyabilir.
// Eski `chrome.tabs.query({ url: ['http://*/*','https://*/*'] })` bu sekmeyi ELERDI ve
// icindeki dapp olaylari YINE alamazdi -- bu yuzden url suzgecinin kalkmasi
// AYRICA olculur (sorgu argumanini yoksayan bir stub o parcayi hic gormezdi).
const UZANTI_SEKMESI = { id: 9, url: 'about:blank' }

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onChanged: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    sentTabMessages = []

    globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
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
                    const wanted = keys === undefined ? Object.keys(localStore)
                        : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
                remove: vi.fn(async () => {}),
            },
            onChanged: add('onChanged'),
        },
        tabs: {
            // GERCEK Chrome gibi: `url` deseni verilirse SUZER. Argumani yoksayan bir
            // stub, "url suzgeci kalkti" degisikligini olcemez -- eski koda donunce
            // testler YESIL kalirdi.
            query: vi.fn(async (sorgu) => {
                const hepsi = [SARMALAYICI_SEKME, UZANTI_SEKMESI]
                if (!sorgu?.url) return hepsi
                return hepsi.filter((t) => /^https?:/.test(t.url))
            }),
            sendMessage: vi.fn((tabId, msg) => {
                sentTabMessages.push({ tabId, msg })
                return Promise.resolve()
            }),
            create: vi.fn(),
        },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return { listeners }
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

const evmMesajlari = () => sentTabMessages.filter((m) => m.msg.target === 'wats_inpage')

async function kur() {
    vi.resetModules()
    vi.clearAllMocks()
    localStore = {
        // Oturum IFRAME'in hostname'iyle anahtarlanmis -- ust cerceve
        // (portal.example) burada HIC GECMIYOR.
        dapps: { 'dapp.example': { accounts: ['0xAaaa'], chainId: '0x1' } },
    }
    const stub = installChromeStub()
    await import('./background.js')
    messageListener = stub.listeners.onMessage[0]
}

beforeEach(kur)

describe('notifyConnectedDapps -- iframe icindeki EVM dapp olayi ALIR (ust cerceve hostname i suzgec DEGILDIR)', () => {
    it('ust cerceve BAGLI DEGILKEN bile sekmeye mesaj gider (iframe orada olabilir)', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb' })

        // ESKI DAVRANIS: sifir mesaj -- `portal.example` connectedHostnames'te
        // olmadigi icin sekme tumden atlaniyordu ve iframe'deki dapp olayi
        // hicbir zaman gormuyordu.
        expect(evmMesajlari().length).toBeGreaterThan(0)
        expect(evmMesajlari()[0].tabId).toBe(7)
    })

    it('mesaj HEDEF hostname LISTESINI tasir: hangi cercevenin ileteceginе content.js karar verir', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb' })

        expect(evmMesajlari()[0].msg).toEqual(expect.objectContaining({
            target: 'wats_inpage',
            hostnames: ['dapp.example'],
            method: 'accountsChanged',
            result: ['0xBbbb'],
        }))
    })

    // UST CERCEVESI http(s) OLMAYAN sekme de kapsanir: dapp onun ICINDEKI bir
    // iframe'de olabilir ve eski `url` suzgeci o sekmeyi tumden eliyordu.
    it('ust cercevesi about:blank olan sekme de mesaj ALIR (url suzgeci kalkti)', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb' })

        expect(evmMesajlari().map((m) => m.tabId).sort()).toEqual([7, 9])
    })

    // MALIYET KILIDI: mesaj sayisi SEKME BASINA BIR olmali, "sekme x bagli dapp"
    // CARPIMI degil. Ilk surum hostname basina AYRI mesaj yolluyordu; 20 bagli
    // dapp + 100 sekme = 2.000 sendMessage (ve frameId verilmedigi icin her biri o
    // sekmenin TUM cercevelerine dagiliyordu). Carpim, tek sekmeli bir testte
    // GORUNMEZ -- bu yuzden iki sekme ve iki hostname ile olculur.
    it('sekme basina TEK mesaj gider (sayi, bagli dapp sayisiyla CARPILMAZ)', async () => {
        localStore.dapps = {
            'dapp.example': { accounts: ['0xAaaa'], chainId: '0x1' },
            'ikinci.example': { accounts: ['0xAaaa'], chainId: '0x1' },
            'ucuncu.example': { accounts: ['0xAaaa'], chainId: '0x1' },
        }

        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb' })

        // 2 sekme x 3 bagli dapp = 6 DEGIL, 2 olmali.
        expect(evmMesajlari()).toHaveLength(2)
    })

    it('liste TAM OLARAK bagli hostname leri tasir', async () => {
        localStore.dapps = {
            'dapp.example': { accounts: ['0xAaaa'], chainId: '0x1' },
            'ikinci.example': { accounts: ['0xAaaa'], chainId: '0x1' },
        }

        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb' })

        expect([...evmMesajlari()[0].msg.hostnames].sort()).toEqual(['dapp.example', 'ikinci.example'])
    })

    it('hic bagli dapp yoksa hicbir sekmeye mesaj gitmez (regresyon)', async () => {
        localStore.dapps = {}

        await callHandler({ type: 'ACCOUNT_CHANGED', address: '0xBbbb' })

        expect(evmMesajlari()).toHaveLength(0)
    })
})
