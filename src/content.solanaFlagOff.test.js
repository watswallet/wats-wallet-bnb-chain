// Bayrak KAPALIYKEN content.js Solana seridini arka plana HIC iletmez.
//
// UCUNCU katman (manifest kaydi ve arka plan kapisindan sonra): normal bir
// derlemede solanaInjected.js enjekte edilmedigi icin bu mesaj zaten dogmaz --
// ama `wats_content_script` hedefini HERHANGI bir sayfa yazabilir ve content.js
// <all_urls> uzerinde calisir. Sessiz dusurme YOK: yanitsiz istek sayfadaki
// await'i sonsuza dek asili birakir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let win
let sentToBackground
let onMessageListeners

function installStubs() {
    win = new EventTarget()
    win.posted = []
    win.postMessage = (data) => { win.posted.push(data) }
    win.location = { hostname: 'app.jup.ag', origin: 'https://app.jup.ag' }
    win.top = win
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
            sendMessage: vi.fn((payload, cb) => { sentToBackground.push(payload); cb({ result: 'ok' }) }),
            onMessage: { addListener: (fn) => { onMessageListeners.push(fn) } },
            lastError: undefined,
        },
    }
}

function deliverFromPage(payload, id = 'req-1') {
    const event = new Event('message')
    event.source = win
    event.data = { target: 'wats_content_script', id, payload }
    win.dispatchEvent(event)
}

async function yukle(bayrak) {
    vi.resetModules()
    vi.unstubAllGlobals()
    vi.stubEnv('VITE_SOLANA_ENABLED', bayrak)
    installStubs()
    await import('./content.js')
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete globalThis.chrome })

describe('content.js -- SOLANA_ENABLED kapali', () => {
    it('solana_ metodu arka plana GITMEZ ve sayfaya 4200 doner', async () => {
        await yukle('false')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-1')

        expect(sentToBackground).toEqual([])
        expect(win.posted).toContainEqual(expect.objectContaining({
            target: 'wats_solana_inpage',
            id: 'sol-1',
            error: expect.objectContaining({ code: 4200 }),
        }))
    })

    // Birlesme hazirligi B3 (bayrak kapali denetimi bulgu (b)): bayrak KAPALIYKEN Solana seridi taban/main ile BIREBIR --
    // ack YOK, tekilleme YOK, yalniz 4200. Bayrak kapali derlemede solanaInjected.js enjekte edilmez; bu seride ack
    // bekleyen mesru bir saglayici yoktur ve ack'i yalniz bu derlemede var olmayan O5 saglayicisi bilir.
    it('bayrak kapaliyken ack GITMEZ, yalniz 4200 yaniti gelir (taban/main ile birebir)', async () => {
        await yukle('false')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-ack')

        expect(win.posted).toEqual([
            expect.objectContaining({ target: 'wats_solana_inpage', id: 'sol-ack', error: expect.objectContaining({ code: 4200 }) }),
        ])
        expect(win.posted.some((m) => 'ack' in m)).toBe(false)
        expect(sentToBackground).toEqual([])
    })

    it('bayrak kapaliyken Solana seridinde tekilleme YOK: ayni kimligin her kopyasi kendi 4200 yanitini alir (taban/main ile birebir)', async () => {
        await yukle('false')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-tekrar')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-tekrar')

        expect(win.posted).toHaveLength(2)
        for (const m of win.posted) {
            expect(m).toEqual(expect.objectContaining({ target: 'wats_solana_inpage', id: 'sol-tekrar', error: expect.objectContaining({ code: 4200 }) }))
        }
        expect(sentToBackground).toEqual([])
    })

    it('bayrak kapaliyken EVM ve TON seritlerinin ack + tekillemesi AYNEN calisir', async () => {
        await yukle('false')
        deliverFromPage({ method: 'eth_requestAccounts', params: [] }, 'evm-ack')
        deliverFromPage({ method: 'eth_requestAccounts', params: [] }, 'evm-ack')
        deliverFromPage({ method: 'tonconnect_connect', params: [] }, 'ton-ack')

        expect(win.posted).toContainEqual({ target: 'wats_inpage', ack: 'evm-ack' })
        expect(win.posted).toContainEqual({ target: 'wats_ton_inpage', ack: 'ton-ack' })
        // EVM ikinci kopyasi arka plana GITMEZ (tekilleme), TON bir kez gider.
        expect(sentToBackground.filter((p) => p.method === 'eth_requestAccounts')).toHaveLength(1)
        expect(sentToBackground.filter((p) => p.method === 'tonconnect_connect')).toHaveLength(1)
    })

    it('KONTROL: bayrak ACIKKEN Solana seridi ack alir ve ayni kimligin ikinci kopyasi arka plana gitmez', async () => {
        await yukle('true')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-acik')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-acik')

        expect(win.posted[0]).toEqual({ target: 'wats_solana_inpage', ack: 'sol-acik' })
        expect(sentToBackground).toHaveLength(1)
    })

    it('EVM metodu AYNEN gecer -- kapi yalniz Solana seridini keser', async () => {
        await yukle('false')
        deliverFromPage({ method: 'eth_requestAccounts', params: [] }, 'evm-1')
        expect(sentToBackground).toHaveLength(1)
    })

    it('bayrak ACIKKEN solana_ metodu arka plana ILETILIR', async () => {
        await yukle('true')
        deliverFromPage({ method: 'solana_connect', params: [{}] }, 'sol-2')
        expect(sentToBackground).toHaveLength(1)
    })
})
