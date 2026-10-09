// T20 -- K2'nin TON seridi: sayfa acilisindaki ILK TonConnect istegi KAYBOLMAZ.
//
// KOK NEDEN (OLCULDU, 2026-10-06, gercek dist): content.js crxjs yukleyicisi ile 16-34 ms GEC dinleyici kurar;
// tonInjected.js importsuz oldugu icin senkron girer. `window.wats.tonconnect.restoreConnection()` document_start'ta
// atilirsa mesaj dinleyici yokken yayinlanir ve KAYBOLUR (30/30), callBackground'in zaman asimi da yoktu.
// Duzeltme EVM seridinin (T19, k2FirstRequest.test.js) aynisi: tonInjected istegi content.js ack'leyene kadar
// yeniden yollar, content.js kimlige gore tekilletirir.
//
// KRITIK: ayni tonconnect_send arka plana IKI KEZ ulasirsa talepIdKabulEt ikinciyi "Request id must be strictly
// increasing" ile reddeder (ilk kopyanin onay penceresi acik kalirken) ve tonconnect_connect ikinci kez gelirse ilk
// bekleyen istek 4001 ile cevaplanir (TON'da 300 "kullanici reddetti"). Bu yuzden ack ve tekilleme content.js'te
// istek ALINDIGI ANDA, kapilardan ONCE yapilir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

const INJECTED = readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

let win
let sent

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

async function loadTon() {
    vi.resetModules()
    vi.stubGlobal('window', win)
    await import('./tonInjected.js')
    return win.wats.tonconnect
}

/** Icerik betigini ISTENEN ANDA yukler (gercekte: yukleyicinin dinamik import'u bitince). */
async function loadContent({ hang = false, response = { result: { ok: true } } } = {}) {
    vi.resetModules()
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { head: { appendChild: () => {} }, documentElement: { appendChild: () => {} } })
    sent = []
    globalThis.chrome = {
        runtime: {
            sendMessage: vi.fn((payload, cb) => { sent.push(payload); if (!hang) cb(response) }),
            onMessage: { addListener: () => {} },
            lastError: undefined,
        },
    }
    await import('./content.js')
}

const istekler = (method) => win.posted.filter((m) => m.target === 'wats_content_script' && (!method || m.payload?.method === method))
const ackler = (hedef) => win.posted.filter((m) => m.target === hedef && m.ack)

beforeEach(() => {
    vi.useFakeTimers()
    vi.unstubAllGlobals()
    newPage()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

const SEND_MSG = { method: 'sendTransaction', params: ['{}'], id: '7' }

describe('T20 -- ack yeniden gondermeyi durdurur', () => {
    it('icerik betigi hazirsa: ack gelir, istek tek kez gider, zamanlayici kalmaz', async () => {
        await loadContent()
        const b = await loadTon()
        const p = b.restoreConnection()
        await vi.advanceTimersByTimeAsync(2000)
        await expect(p).resolves.toEqual({ ok: true })
        expect(istekler('tonconnect_restore')).toHaveLength(1)
        expect(ackler('wats_ton_inpage')).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('ack bir YANIT sayilmaz: bekleyen istek cozulmez, yalniz yeniden gonderme durur', async () => {
        const b = await loadTon()
        let sonuc = 'bekliyor'
        b.restoreConnection().then(() => { sonuc = 'cozuldu' })
        const id = istekler('tonconnect_restore')[0].id
        win.postMessage({ target: 'wats_ton_inpage', ack: id })
        await vi.advanceTimersByTimeAsync(5000)
        expect(sonuc).toBe('bekliyor')
        expect(istekler('tonconnect_restore')).toHaveLength(1) // ack sonrasi yeniden gonderme YOK
        expect(vi.getTimerCount()).toBe(0)
    })

    it('ack gelmeden YANIT gelirse de zamanlayici durur', async () => {
        const b = await loadTon()
        const p = b.restoreConnection()
        const id = istekler('tonconnect_restore')[0].id
        win.postMessage({ target: 'wats_ton_inpage', id, result: { event: 'connect' } })
        await vi.advanceTimersByTimeAsync(10)
        await expect(p).resolves.toEqual({ event: 'connect' })
        expect(vi.getTimerCount()).toBe(0)
    })

    it('sahte ack (bilinmeyen kimlik) hata atmaz ve bekleyen istegi cozmez', async () => {
        const b = await loadTon()
        let sonuc = 'bekliyor'
        b.restoreConnection().then(() => { sonuc = 'cozuldu' })
        win.postMessage({ target: 'wats_ton_inpage', ack: 'yok-boyle-bir-id' })
        await vi.advanceTimersByTimeAsync(50)
        expect(sonuc).toBe('bekliyor')
    })
})

describe('T20 -- icerik betigi istekten SONRA hazir olursa istek yine de yanitlanir', () => {
    for (const [ad, cagir, beklenen] of [
        ['restoreConnection', (b) => b.restoreConnection(), 'tonconnect_restore'],
        ['send', (b) => b.send(SEND_MSG), 'tonconnect_send'],
        ['connect', (b) => b.connect(2, { manifestUrl: 'https://app.example.com/m.json', items: [{ name: 'ton_addr' }] }), 'tonconnect_connect'],
    ]) {
        it(`${ad}: ilk mesaj dinleyici yokken kaybolur, yeniden gonderim yanitlanir; arka plana TEK kez gider`, async () => {
            const b = await loadTon()
            let sonuc = 'bekliyor'
            cagir(b).then((r) => { sonuc = r })
            await vi.advanceTimersByTimeAsync(50)
            expect(sonuc).toBe('bekliyor')

            await loadContent()
            await vi.advanceTimersByTimeAsync(500)

            expect(sonuc).toEqual({ ok: true })
            expect(sent).toHaveLength(1)
            expect(sent[0].method).toBe(beklenen)
            expect(vi.getTimerCount()).toBe(0)
        })
    }
})

describe('T20 -- icerik betigi HIC gelmezse istek sonsuza dek askida kalmaz', () => {
    it('restoreConnection: 10 sn ack yok -> connect_error olayi (resolve, reject degil)', async () => {
        const b = await loadTon()
        let sonuc = null
        b.restoreConnection().then((r) => { sonuc = r })
        await vi.advanceTimersByTimeAsync(10_500)
        expect(sonuc).not.toBeNull()
        expect(sonuc.event).toBe('connect_error')
        expect(sonuc.payload.code).toBe(0)
        expect(sonuc.payload.message).toMatch(/did not respond/i)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('connect: 10 sn ack yok -> connect_error olayi', async () => {
        const b = await loadTon()
        let sonuc = null
        b.connect(2, { manifestUrl: 'x', items: [] }).then((r) => { sonuc = r })
        await vi.advanceTimersByTimeAsync(10_500)
        expect(sonuc.event).toBe('connect_error')
        expect(sonuc.payload.message).toMatch(/did not respond/i)
    })

    it('send: 10 sn ack yok -> AppRequest id ile eslesen {error, id} govdesi', async () => {
        const b = await loadTon()
        let sonuc = null
        b.send(SEND_MSG).then((r) => { sonuc = r })
        await vi.advanceTimersByTimeAsync(10_500)
        expect(sonuc.id).toBe('7')
        expect(sonuc.error.code).toBe(0)
        expect(sonuc.error.message).toMatch(/did not respond/i)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('en fazla 100 yeniden gonderim yapilir (ilk gonderim + 100)', async () => {
        const b = await loadTon()
        b.restoreConnection()
        await vi.advanceTimersByTimeAsync(20_000)
        expect(istekler('tonconnect_restore')).toHaveLength(101)
    })

    it('ack GELDIKTEN sonra yanit gecikirse (onay penceresi) zaman asimi YOK', async () => {
        await loadContent({ hang: true })
        const b = await loadTon()
        let sonuc = 'bekliyor'
        b.send(SEND_MSG).then((r) => { sonuc = r })
        await vi.advanceTimersByTimeAsync(120_000)
        expect(sonuc).toBe('bekliyor')
    })
})

describe('T20 -- ayni kimlik arka plana IKI KEZ gitmez', () => {
    it('ayni id ile uc tonconnect_send: arka plana BIR kez, ack uc kez', async () => {
        await loadContent({ hang: true })
        const mesaj = { target: 'wats_content_script', id: 'ton-dup', payload: { method: 'tonconnect_send', params: [SEND_MSG] } }
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(1)
        expect(ackler('wats_ton_inpage').filter((a) => a.ack === 'ton-dup')).toHaveLength(3)
    })

    it('ayni id ile iki tonconnect_connect: arka plana bir kez', async () => {
        await loadContent({ hang: true })
        const mesaj = { target: 'wats_content_script', id: 'ton-conn', payload: { method: 'tonconnect_connect', params: [{ items: [] }, 2] } }
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(1)
    })

    it('FARKLI kimlikler tekillestirilmez (ayri iki istek)', async () => {
        await loadContent({ hang: true })
        win.postMessage({ target: 'wats_content_script', id: 'a', payload: { method: 'tonconnect_send', params: [SEND_MSG] } })
        win.postMessage({ target: 'wats_content_script', id: 'b', payload: { method: 'tonconnect_send', params: [{ ...SEND_MSG, id: '8' }] } })
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(2)
    })

    it('uctan uca: yukleyici gecikmesinde yeniden gonderilen send arka plana bir kez gider', async () => {
        const b = await loadTon()
        b.send(SEND_MSG)
        await vi.advanceTimersByTimeAsync(250) // 2-3 kopya kayboldu
        await loadContent({ hang: true })
        await vi.advanceTimersByTimeAsync(1000)
        expect(sent).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('kapiya takilan istek de ack alir ve ikinci kez islenmez', async () => {
        await loadContent({ hang: true })
        const mesaj = { target: 'wats_content_script', id: 'ton-gate', payload: { method: 'tonconnect_send', type: 'SWAP', params: [] } }
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(0) // payload kapisi reddetti
        expect(ackler('wats_ton_inpage').filter((a) => a.ack === 'ton-gate')).toHaveLength(2) // ... ama ack gitti
        const ret = win.posted.filter((m) => m.target === 'wats_ton_inpage' && m.id === 'ton-gate' && m.error)
        expect(ret).toHaveLength(1) // tekilleme: ikinci kopya yeniden reddedilmez
    })
})

describe('T20 -- diger seritler etkilenmez', () => {
    it('solana_ istegine ACK GITMEZ (solanaInjected.js ack bilmez, yanit sanabilir)', async () => {
        await loadContent()
        win.postMessage({ target: 'wats_content_script', id: 'sol-1', payload: { method: 'solana_connect', params: [] } })
        await vi.advanceTimersByTimeAsync(10)
        expect(win.posted.filter((m) => m.target === 'wats_solana_inpage' && 'ack' in m)).toHaveLength(0)
        expect(ackler('wats_ton_inpage')).toHaveLength(0)
        expect(ackler('wats_inpage')).toHaveLength(0)
    })

    it('solana_ seridi tekillestirilmez (davranis degismedi)', async () => {
        await loadContent({ hang: true })
        const mesaj = { target: 'wats_content_script', id: 'sol-dup', payload: { method: 'solana_connect', params: [] } }
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(2)
    })

    it('EVM seridi T19 davranisini korur: wats_inpage ack + tekilleme', async () => {
        await loadContent({ hang: true })
        const mesaj = { target: 'wats_content_script', id: 'evm-dup', payload: { method: 'eth_requestAccounts', params: [] } }
        win.postMessage(mesaj)
        win.postMessage(mesaj)
        await vi.advanceTimersByTimeAsync(10)
        expect(sent).toHaveLength(1)
        expect(ackler('wats_inpage').filter((a) => a.ack === 'evm-dup')).toHaveLength(2)
        expect(ackler('wats_ton_inpage')).toHaveLength(0)
    })

    it('EVM saglayicisi TON ack mesajini kendi hattinda gormez', async () => {
        await loadContent()
        new Function('window', 'crypto', INJECTED)(win, globalThis.crypto)
        let sonuc = 'bekliyor'
        win.ethereum.request({ method: 'eth_chainId' }).then(() => { sonuc = 'cozuldu' })
        win.postMessage({ target: 'wats_ton_inpage', ack: 'x' })
        await vi.advanceTimersByTimeAsync(2000)
        expect(sonuc).toBe('cozuldu')
    })
})
