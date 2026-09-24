// POPUP KOPRUSU -- DAVRANIS TESTI (kaynak kilidi DEGIL).
//
// `popup/main.js` bir GIRIS BETIGIDIR: ice aktarildigi anda kopruyu calistirir.
// Burada gercekten ice aktarilir ve sonucu OLCULUR. Vue mount'u
// `document.querySelector('#app')` null dondugu icin sessizce no-op olur
// (@vue/runtime-dom: `if (!container) return`), yani DOM'suz node ortaminda
// onyuklemenin geri kalani sonuna kadar kosar.
//
// KAPATILAN OLCUM BOSLUGU (M17): popupBridge.test.js'teki "panel acildiktan
// SONRA kendini kapatir" iddiasi `indexOf('openSidePanelHere')` ile
// `indexOf('window.close()')`i karsilastiriyordu; ilk eslesme dosyanin
// 3. satirindaki IMPORT'tur, yani iddia yalnizca "import kapatmadan once gelir"
// diyordu. Gercek kural ise sudur: kapatma YALNIZCA panel GERCEKTEN acildiysa
// yapilir -- aksi halde kullanici hicbir yuzey olmadan kalir.
import { describe, it, expect, vi, afterEach } from 'vitest'

const PANEL_YOLU = '/src/sidepanel/index.html'
const POPUP_YOLU = '/src/popup/index.html'

/**
 * `popup/main.js`i TAZE ice aktarir.
 *
 * `vi.resetModules()` SART: giris betigi yan etkisini yalnizca ILK ice
 * aktarmada uretir; ayrica utils/uiSurface.js yuzeyi modul kapsaminda
 * onbellekler.
 */
async function kopruyuCalistir({ hash = '', uiMode = 'sidepanel', panelAcilir = true, getCurrentReddet = false } = {}) {
    vi.resetModules()

    const kapat = vi.fn()
    const sidePanelOpen = vi.fn(async () => { if (!panelAcilir) throw new Error('acilamadi') })
    const connect = vi.fn(() => ({ onDisconnect: { addListener: () => {} }, disconnect: () => {} }))

    const sahteBelge = {
        querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
        visibilityState: 'hidden',
    }
    vi.stubGlobal('window', {
        location: { pathname: hash === '#window' ? POPUP_YOLU : POPUP_YOLU, hash },
        close: kapat,
        document: sahteBelge,
        addEventListener: () => {},
        removeEventListener: () => {},
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        performance: { now: () => Date.now() },
    })
    vi.stubGlobal('document', sahteBelge)
    vi.stubGlobal('setInterval', () => 1)
    vi.stubGlobal('fetch', async () => ({ ok: true }))

    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const depo = { uiMode, vaults: [], currentNetwork: { chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://rpc.example' }] } }
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(istenen.map((k) => [k, depo[k]]))
                },
                set: async () => {},
                remove: async () => {},
            },
            onChanged: { addListener: () => {}, removeListener: () => {} },
        },
        runtime: {
            connect,
            onMessage: { addListener: () => {}, removeListener: () => {} },
            sendMessage: async () => ({}),
            getURL: (p) => `chrome-extension://wats/${p}`,
        },
        tabs: { create: () => {}, query: async () => [] },
        windows: {
            getCurrent: getCurrentReddet
                ? () => Promise.reject(new Error('pencere yok'))
                : async () => ({ id: 7 }),
            onRemoved: { addListener: () => {} },
        },
        sidePanel: { open: sidePanelOpen, setPanelBehavior: async () => {} },
        action: { setPopup: async () => {} },
    }

    await import('./main.js')
    // Kopru zincirini (storage okumasi + windows.getCurrent + open) bitir.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))

    return { kapat, sidePanelOpen, connect }
}

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

// ZAMAN SINIRI ACIKLAMASI: kopruyuCalistir() vi.resetModules() ve
// main.js'in taze ice aktarilmasini icerdigi icin (ethers, @solana/web3.js,
// vue gibi butun bagliliklar yeniden cozulur) bu testler ~9.5 saniye suruyor.
// Global 15000ms siniri altinda yuk ortaminda azdiracidir (arasira zaman asiyor);
// 60000ms'lik acik siniri tayin regrasyonlari gururdan ayirtmak mumkun kilar.
describe('popup koprusu -- davranis', () => {
    it('mod PANEL ve panel GERCEKTEN acildiysa popup kendini kapatir', async () => {
        const { kapat, sidePanelOpen, connect } = await kopruyuCalistir({ uiMode: 'sidepanel' })

        expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 7 })
        expect(kapat).toHaveBeenCalledTimes(1)
        // Kapaniyorsa arayuzu KURMAZ: iki yuzey birden acilmaz.
        expect(connect).not.toHaveBeenCalled()
    }, 60000)

    // ASIL KURAL. Panel acilamadiysa kapatmak kullaniciyi HICBIR yuzey olmadan
    // birakirdi -- kopru tam da bunu onlemek icin var.
    it('panel ACILAMAZSA kapatmaz, popup arayuzunu kurar', async () => {
        const { kapat, connect } = await kopruyuCalistir({ uiMode: 'sidepanel', panelAcilir: false })

        expect(kapat).not.toHaveBeenCalled()
        expect(connect).toHaveBeenCalled()
    }, 60000)

    it('mod POPUP ise panel hic denenmez', async () => {
        const { kapat, sidePanelOpen, connect } = await kopruyuCalistir({ uiMode: 'popup' })

        expect(sidePanelOpen).not.toHaveBeenCalled()
        expect(kapat).not.toHaveBeenCalled()
        expect(connect).toHaveBeenCalled()
    }, 60000)

    // Onay penceresi ('#window') ASLA kopruye girmez: dapp onayi ayri pencerede
    // kalir (S7.1); orayi panele cevirmek bekleyen istegi askida birakirdi.
    it('onay penceresi kopruye girmez', async () => {
        const { kapat, sidePanelOpen, connect } = await kopruyuCalistir({ hash: '#window', uiMode: 'sidepanel' })

        expect(sidePanelOpen).not.toHaveBeenCalled()
        expect(kapat).not.toHaveBeenCalled()
        expect(connect).toHaveBeenCalled()
    }, 60000)

    // M9 -- pencere aramasi mod OKUNMADAN once baslatiliyor (butce icin,
    // bilerek). Reddederse ve kimse beklemiyorsa bu ISLENMEMIS bir promise
    // reddidir. `.catch` ile yutulur; kopru sessizce popup'a duser.
    it('M9: windows.getCurrent REDDETSE BILE arayuz kurulur (islenmemis red yok)', async () => {
        const redler = []
        const yakala = (e) => redler.push(e)
        process.on('unhandledRejection', yakala)
        try {
            const { kapat, connect } = await kopruyuCalistir({ uiMode: 'sidepanel', getCurrentReddet: true })

            expect(kapat).not.toHaveBeenCalled()
            expect(connect).toHaveBeenCalled()
            expect(redler).toEqual([])
        } finally {
            process.off('unhandledRejection', yakala)
        }
    }, 60000)
})
