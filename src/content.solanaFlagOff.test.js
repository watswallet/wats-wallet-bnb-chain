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
