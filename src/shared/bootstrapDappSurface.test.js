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
import { SURFACE_PANEL, SURFACE_POPUP } from '../utils/uiSurface'
import { pageStore } from '../store/pageStore'
import { networkStore } from '../store/network'

const HESAP = { address: '0xAbC0000000000000000000000000000000000001', key: 'k1' }

let mesajDinleyicileri

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
            sendMessage: async (msg) => (msg?.type === 'CHECK_UNLOCK' ? { unlocked: true } : {}),
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

/** Kayitli TUM onMessage dinleyicilerini cagirir ve hepsinin bitmesini bekler. */
async function mesajGonder(msg) {
    for (const fn of mesajDinleyicileri) await fn(msg)
}

beforeEach(() => { chromeKur() })
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
