// K2 -- sayfa yuklenir yuklenmez atilan ILK provider istegi ASKIDA KALMAZ.
//
// KOK NEDEN (OLCULDU, 2026-10-05): icerik betigi (content.js) `import` tasidigi icin crxjs onu DOGRUDAN degil bir
// YUKLEYICI ile kaydeder (`assets/content.js-loader-*.js`): yukleyici `await import(chrome.runtime.getURL(...))` ile
// asil dosyayi cekene kadar `window.addEventListener('message', ...)` KURULMAZ. injected.js ise import tasimaz,
// manifestte world:MAIN olarak SENKRON girer. Sayfa betigi `window.ethereum.request(...)`'i document_start'ta
// atarsa mesaj, dinleyici yokken `window.postMessage` ile yayinlanir ve KAYBOLUR; injected.js'te zaman asimi
// yoktur, istek sonsuza dek askida kalir. Duzeltme: injected.js istegi icerik betigi ONAYLAYANA (ack) kadar yeniden
// yollar; content.js ayni kimligi ikinci kez ARKA PLANA gecirmez (tekrar onay penceresi acilmasin).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

const INJECTED = readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

let win
let sent
let provider

/** Sayfa dunyasi: postMessage GERCEKTEKI GIBI asenkron (mikro-gorev) ve gonderen == pencere. */
function newPage() {
    win = new EventTarget()
    win.posted = []
    win.location = { hostname: 'app.example.com', origin: 'https://app.example.com' }
    win.top = win
    win.postMessage = (data) => {
        win.posted.push(data)
        queueMicrotask(() => {
            const ev = new Event('message')
            ev.source = win
            ev.data = data
            win.dispatchEvent(ev)
        })
    }
    return win
}

function loadInjected() {
    new Function('window', 'crypto', INJECTED)(win, globalThis.crypto)
    provider = win.ethereum
}

/** Icerik betigini ISTENEN ANDA yukler (gercekte: yukleyicinin dinamik import'u bitince). */
async function loadContent({ hang = false } = {}) {
    vi.resetModules()
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { head: { appendChild: () => {} }, documentElement: { appendChild: () => {} } })
    sent = []
    globalThis.chrome = {
        runtime: {
            sendMessage: vi.fn((payload, cb) => { sent.push(payload); if (!hang) cb({ result: [] }) }),
            onMessage: { addListener: () => {} },
            lastError: undefined,
        },
    }
    await import('./content.js')
}

const istekIdleri = () => win.posted.filter((m) => m.target === 'wats_content_script').map((m) => m.id)
const ackler = () => win.posted.filter((m) => m.target === 'wats_inpage' && m.ack)

beforeEach(() => {
    vi.useFakeTimers()
    vi.unstubAllGlobals()
    newPage()
    loadInjected()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe('K2 -- icerik betigi istekten SONRA hazir olursa istek yine de yanitlanir', () => {
    it('ilk istek dinleyici yokken atilir; icerik betigi gec yuklenince istek yeniden yollanip yanitlanir', async () => {
        let sonuc = 'bekliyor'
        provider.request({ method: 'eth_accounts' }).then(() => { sonuc = 'cozuldu' }, () => { sonuc = 'reddedildi' })

        await vi.advanceTimersByTimeAsync(50) // dinleyici YOK: ilk mesaj kayboldu
        expect(sonuc).toBe('bekliyor')

        await loadContent() // yukleyicinin dinamik import'u simdi bitti
        await vi.advanceTimersByTimeAsync(500)

        expect(sonuc).toBe('cozuldu')
        expect(sent).toHaveLength(1) // arka plana TEK kez gitti
        expect(sent[0]).toEqual({ method: 'eth_accounts', params: [] })
    })

    it('icerik betigi zaten hazirsa ack gelir ve yeniden gonderme HIC olmaz', async () => {
        await loadContent()
        const p = provider.request({ method: 'eth_chainId' })
        await vi.advanceTimersByTimeAsync(2000)
        await expect(p).resolves.toEqual([])
        expect(istekIdleri()).toHaveLength(1)
        expect(ackler()).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0) // ack sonrasi yeniden gonderme zamanlayicisi KALMAZ
    })
})

describe('K2 -- ayni kimlik arka plana IKI KEZ gitmez', () => {
    it('ayni id ile iki mesaj: arka plana bir kez, ack iki kez', async () => {
        await loadContent()
        const mesaj = { target: 'wats_content_script', id: 'dup-1', payload: { method: 'eth_requestAccounts', params: [] } }
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(1)
        expect(ackler().filter((a) => a.ack === 'dup-1')).toHaveLength(2)
    })
})

describe('K2 -- icerik betigi HIC gelmezse istek sonsuza dek askida kalmaz', () => {
    it('10 sn icinde ack yoksa -32603 ile reddedilir ve zamanlayici kalmaz', async () => {
        let hata = null
        provider.request({ method: 'eth_accounts' }).catch((e) => { hata = e })
        await vi.advanceTimersByTimeAsync(10_500)
        expect(hata).not.toBeNull()
        expect(hata.code).toBe(-32603)
        expect(hata.message).toMatch(/did not respond/i)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('ack GELDIKTEN sonra yanit gecikirse (onay penceresi) zaman asimi YOK', async () => {
        await loadContent({ hang: true }) // yanit hic gelmez: kullanici onay penceresinde
        let sonuc = 'bekliyor'
        provider.request({ method: 'eth_requestAccounts' }).then(() => { sonuc = 'cozuldu' }, () => { sonuc = 'reddedildi' })
        await vi.advanceTimersByTimeAsync(120_000)
        expect(sonuc).toBe('bekliyor')
    })
})

describe('K2 -- diger seritler etkilenmez', () => {
    // T20: TON seridi artik KENDI hattinda ack alir (k2FirstRequestTon.test.js); EVM saglayicisi o ack'i gormez.
    it('tonconnect_ istegine EVM hattinda (wats_inpage) ack GITMEZ', async () => {
        await loadContent()
        win.postMessage({ target: 'wats_content_script', id: 'ton-1', payload: { method: 'tonconnect_restore', params: [] } })
        await vi.advanceTimersByTimeAsync(10)
        expect(ackler()).toHaveLength(0)
    })

    it('solana_ istegine hicbir hatta ack GITMEZ (solanaInjected.js ack bilmez)', async () => {
        await loadContent()
        win.postMessage({ target: 'wats_content_script', id: 'sol-1', payload: { method: 'solana_connect', params: [] } })
        await vi.advanceTimersByTimeAsync(10)
        expect(win.posted.filter((m) => 'ack' in m)).toHaveLength(0)
    })

    it('sahte ack (bilinmeyen kimlik) hata atmaz ve bekleyen istegi cozmez', async () => {
        let sonuc = 'bekliyor'
        provider.request({ method: 'eth_accounts' }).then(() => { sonuc = 'cozuldu' }, () => { sonuc = 'reddedildi' })
        win.postMessage({ target: 'wats_inpage', ack: 'yok-boyle-bir-id' })
        await vi.advanceTimersByTimeAsync(10)
        expect(sonuc).toBe('bekliyor')
    })
})
