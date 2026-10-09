// S7.1, IKINCI YOL -- bootstrap.js'teki dapp mesaj dinleyicisi yuzey KORLUGU.
//
// Bu dosya KAYNAK KILIDI DEGIL: `bootstrapWalletUi` GERCEKTEN calistirilir ve
// kaydettigi `chrome.runtime.onMessage` dinleyicisi GERCEKTEN cagrilir. Vue
// mount'u `document.querySelector('#app')` null dondugu icin sessizce no-op
// olur (@vue/runtime-dom: `if (!container) return`), yani DOM'suz node
// ortaminda onyuklemenin geri kalani sonuna kadar kosar.
//
// KAPATILAN HATA: DAPP_CONNECTION / DAPP_SIGN_MESSAGE / DAPP_SEND_TX dallarinin
// GONDEREN KONTROLU YOK ve bu blok artik PANELE de kuruluyor. Bugun bir
// gondereni bulunmuyor (gercek yonlendirme `current_request` uzerinden yurur ve
// content.js `type` tasiyan sayfa yuklerini reddeder), ama kapanmayan bir
// yuzeyde kapisiz bir onay gecisi birakmak S7.1'in yasakladigi seydir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `bootstrap.js` -> `App.vue` -> `utils/dappFunctions.js` zinciri MODUL UST
// DUZEYINDE chrome.windows.onRemoved.addListener cagirir; ayrica @vue/runtime-dom
// modul ust duzeyinde `document.createElement('template')` calistirir. Ikisi de
// import ANINDA olur, test govdesinden ONCE.
vi.hoisted(() => {
    globalThis.document = {
        querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
    }
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { bootstrapWalletUi } from './bootstrap'
import { SURFACE_PANEL, SURFACE_POPUP, SURFACE_ALERT } from '../utils/uiSurface'
import { pageStore } from '../store/pageStore'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'

const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1' }

let mesajDinleyicileri
// CHECK_UNLOCK yaniti: testler kilitli cuzdani buradan kurar (beforeEach acik yapar).
let kilitAcildi = true

function chromeKur() {
    mesajDinleyicileri = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const depo = { active_account: HESAP, currentNetwork: { chainId: 1, name: 'Ethereum' } }
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(istenen.map((k) => [k, depo[k]]))
                },
                set: async () => {},
            },
            onChanged: { addListener: () => {}, removeListener: () => {} },
        },
        runtime: {
            connect: () => ({ onDisconnect: { addListener: () => {} }, disconnect: () => {} }),
            onMessage: { addListener: (fn) => mesajDinleyicileri.push(fn), removeListener: () => {} },
            sendMessage: async (msg) => (msg?.type === 'CHECK_UNLOCK' ? { unlocked: kilitAcildi } : {}),
            lastError: null,
        },
        windows: { onRemoved: { addListener: () => {} } },
    }
}

/**
 * Onyuklemeyi calistirir ve testin okuyacagi store'lari hazirlar.
 *
 * `currentNetwork` ELLE kurulur: DAPP_SEND_TX dali `network.currentNetwork.name`
 * okur ve taze bir store'da bu alan `null`dir (initializeCurrentNetwork async).
 * Kurulmazsa dal SATIRIN ONCESINDE patlar, `page.currentPage` hic yazilmaz ve
 * PANEL testleri kapi OLMADAN DA yesil kalirdi -- yani hicbir sey olcmezlerdi.
 */
function onyukle(surface) {
    bootstrapWalletUi({ surface })
    const page = pageStore()
    networkStore().currentNetwork = { chainId: 1, name: 'Ethereum' }
    page.currentPage = 'home'
    return page
}

/**
 * Kayitli TUM onMessage dinleyicilerini cagirir, is bitene kadar bekler ve
 * dinleyicilerin DONUS DEGERLERINI doner.
 *
 * Dinleyicinin donus degeri BEKLENMEZ (gercek Chromium de beklemez; K1): is
 * govdesi arka planda kosar. Sahte `chrome` yalniz mikro-gorev (Promise)
 * kullandigi icin bir MAKRO tur (setTimeout 0) tum zincirin bitmesine yeter.
 */
async function mesajGonder(msg) {
    const donusler = mesajDinleyicileri.map((fn) => fn(msg))
    await new Promise((r) => setTimeout(r, 0))
    return donusler
}

beforeEach(() => { kilitAcildi = true; chromeKur() })
afterEach(() => { delete globalThis.chrome })

describe('bootstrap dapp dinleyicisi -- yuzey kapisi', () => {
    it('PANELDE DAPP_SEND_TX onay ekranina GECIRMEZ', async () => {
        const page = onyukle(SURFACE_PANEL)

        await mesajGonder({ type: 'DAPP_SEND_TX', from: HESAP.address, to: '0xdead', amount: '1', asset: 'ETH' })

        expect(page.currentPage).toBe('home')
    })

    it('POPUPTA DAPP_SEND_TX onay ekranina GECIRIR (kontrol)', async () => {
        const page = onyukle(SURFACE_POPUP)

        await mesajGonder({ type: 'DAPP_SEND_TX', from: HESAP.address, to: '0xdead', amount: '1', asset: 'ETH' })

        expect(page.currentPage).toBe('dapp_router')
    })

    it('PANELDE DAPP_SIGN_MESSAGE de gecirmez', async () => {
        const page = onyukle(SURFACE_PANEL)

        await mesajGonder({ type: 'DAPP_SIGN_MESSAGE', message: 'merhaba' })

        expect(page.currentPage).toBe('home')
    })

    it('PANELDE DAPP_CONNECTION da gecirmez', async () => {
        const page = onyukle(SURFACE_PANEL)

        await mesajGonder({ type: 'DAPP_CONNECTION' })

        expect(page.currentPage).toBe('home')
    })
})

// B2: TonConnect uyari penceresi (SURFACE_ALERT) bir cuzdan arayuzu DEGIL.
// Port acsaydi acik arayuz sayilir ve "arayuz kapaninca kilitle" karari onu
// beklerdi. Async dapp dinleyicisi her runtime mesajina bir Promise doner;
// uyari penceresi baska sayfalarin mesajlarina hic karismamali.
describe('bootstrap -- uyari yuzeyi', () => {
    it('UYARI yuzeyi arayuz portu ACMAZ ve dapp dinleyicisi KURMAZ', () => {
        const connect = vi.spyOn(chrome.runtime, 'connect')

        onyukle(SURFACE_ALERT)

        expect(connect).not.toHaveBeenCalled()
        expect(mesajDinleyicileri).toHaveLength(0)
    })

    it('POPUP yuzeyi port acar ve dapp dinleyicisini kurar (kontrol)', () => {
        const connect = vi.spyOn(chrome.runtime, 'connect')

        onyukle(SURFACE_POPUP)

        expect(connect).toHaveBeenCalledTimes(1)
        expect(mesajDinleyicileri).toHaveLength(1)
    })
})

// K1 (WalletConnect QA, T18): dinleyici arka planin yanitini EZMEMELI. Async
// bir dinleyici Promise dondurur ve Chromium bunu "undefined yanit" sayar;
// popup/onay penceresi/panel acikken dapp "bos yanit" alirdi. Sozlesme: kurulu
// HER yuzeyde (POPUP, PANEL), HER mesaj tipinde (bilinmeyenler dahil) donus
// degeri TAM OLARAK `false`tur -- Promise, true ya da undefined DEGIL. (UYARI
// yuzeyinde dinleyici hic kurulmaz, bkz. yukaridaki `uyari yuzeyi` testleri.)
describe('bootstrap dapp dinleyicisi -- yanit EZMEZ (K1)', () => {
    const MESAJLAR = [
        { type: 'DAPP_CONNECTION' },
        { type: 'DAPP_SIGN_MESSAGE', message: 'merhaba' },
        { type: 'DAPP_SEND_TX', from: HESAP.address, to: '0xdead', amount: '1', asset: 'ETH' },
        { type: 'BASKA_BIR_MESAJ' },
    ]

    it.each([
        ['POPUP', SURFACE_POPUP],
        ['PANEL', SURFACE_PANEL],
    ])('%s: dinleyici Promise degil, tam olarak false doner', async (_ad, yuzey) => {
        onyukle(yuzey)
        expect(mesajDinleyicileri).toHaveLength(1)

        for (const msg of MESAJLAR) {
            const [donus] = await mesajGonder(msg)
            expect(donus).toBe(false)
        }
    })
})

// KARAKTERIZASYON: cevirme gövdeyi DEGISTIRMEMELI. Bu testler tabanda da
// YESILDIR; kilitli/kilitsiz dallari refactor sessizce bozarsa kirilirlar.
describe('bootstrap dapp dinleyicisi -- is govdesi korundu', () => {
    it('POPUPTA kilit aciksa DAPP_CONNECTION connect_dapp ekranina gecirir', async () => {
        const page = onyukle(SURFACE_POPUP)

        await mesajGonder({ type: 'DAPP_CONNECTION' })

        expect(page.currentPage).toBe('connect_dapp')
    })

    it('POPUPTA kilit kapaliysa DAPP_CONNECTION welcome ekranina gecirir ve donusu hatirlar', async () => {
        const page = onyukle(SURFACE_POPUP)
        kilitAcildi = false

        await mesajGonder({ type: 'DAPP_CONNECTION' })

        expect(page.currentPage).toBe('welcome')
        expect(page.redirect).toBe('connect_dapp')
    })

    it('POPUPTA kilit kapaliyken DAPP_SIGN_MESSAGE mesaji saklar ve welcome a gecirir', async () => {
        const page = onyukle(SURFACE_POPUP)
        kilitAcildi = false

        await mesajGonder({ type: 'DAPP_SIGN_MESSAGE', message: 'merhaba' })

        expect(page.currentPage).toBe('welcome')
        expect(page.redirect).toBe('sign_message')
        expect(cryptoStore().user_message).toBe('merhaba')
    })
})
