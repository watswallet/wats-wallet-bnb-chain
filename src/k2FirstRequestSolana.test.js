// O5 -- K2'nin Solana seridi: sayfa acilisindaki ILK Solana istegi KAYBOLMAZ.
//
// KOK NEDEN: content.js crxjs yukleyicisi ile ASENKRON kurulur (16-34 ms); solanaInjected.js importsuz oldugu
// icin senkron girer. Dapp acilista `connect()` atarsa mesaj dinleyici yokken yayinlanir ve KAYBOLUR; callBackground'in
// yeniden gondermesi ve zaman asimi da yoktu. Duzeltme EVM (T19, k2FirstRequest.test.js) ve TON (T20,
// k2FirstRequestTon.test.js) seritlerinin aynisi: sayfa betigi istegi content.js ack'leyene kadar yeniden yollar,
// content.js (hedef, id) bazinda tekillestirir (Gorev 20).
//
// KRITIK (Review Focus 3): ayni solana_signAndSendTransaction arka plana IKI KEZ ulasirsa cift yayin/cift onay
// penceresi olur. Bu yuzden her iki yanin birlikte testi: yeniden gonderim + tekilleme + ack sonrasi uzun onay.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

const SOLANA_KAYNAK = readFileSync(new URL('./solanaInjected.js', import.meta.url), 'utf8')

const ADRES = '11111111111111111111111111111112'
const B64_32 = Buffer.from(new Uint8Array(32).fill(1)).toString('base64')
const B64_64 = Buffer.from(new Uint8Array(64).fill(2)).toString('base64')

let win
let sent
let mapOrnekleri

/** Sayfa dunyasi: postMessage GERCEKTEKI GIBI asenkron (mikro-gorev) ve gonderen == pencere. */
function newPage() {
    win = new EventTarget()
    win.posted = []
    win.location = { hostname: 'app.jup.ag', origin: 'https://app.jup.ag' }
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

/** Solana sayfa betigini yukler ve Wallet Standard cuzdanini dondurur. Betigin Map ornekleri yakalanir. */
function loadSolana() {
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { title: 'Jupiter', querySelector: () => null })
    let cuzdan = null
    win.addEventListener('wallet-standard:register-wallet', (e) => {
        e.detail({ register: (w) => { cuzdan = w; return () => {} } })
    })
    // callbacks/resends tablolari betigin kendi kapsaminda: sizinti yok mu diye yakalanir.
    const GercekMap = globalThis.Map
    mapOrnekleri = []
    vi.stubGlobal('Map', class extends GercekMap {
        constructor(...a) { super(...a); mapOrnekleri.push(this) }
    })
    try {
        new Function('window', SOLANA_KAYNAK)(win)
    } finally {
        vi.stubGlobal('Map', GercekMap)
    }
    return cuzdan
}

const ozellik = (cuzdan, ad) => cuzdan.features[ad]
const connect = (cuzdan) => ozellik(cuzdan, 'standard:connect').connect()
const signMessage = (cuzdan) => ozellik(cuzdan, 'solana:signMessage')
    .signMessage({ message: new Uint8Array([1, 2, 3]) })
const signAndSend = (cuzdan) => ozellik(cuzdan, 'solana:signAndSendTransaction')
    .signAndSendTransaction({ transaction: new Uint8Array([1, 2, 3]), chain: 'solana:mainnet' })

const CEVAPLAR = {
    solana_connect: { address: ADRES, publicKey: B64_32 },
    solana_signMessage: { signedMessage: B64_32, signature: B64_64 },
    solana_signAndSendTransaction: { signatureBytes: B64_64, signature: 'x' },
}

/** Icerik betigini ISTENEN ANDA yukler (gercekte: yukleyicinin dinamik import'u bitince). */
async function loadContent({ hang = false } = {}) {
    vi.resetModules()
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', { head: { appendChild: () => {} }, documentElement: { appendChild: () => {} } })
    sent = []
    globalThis.chrome = {
        runtime: {
            sendMessage: vi.fn((payload, cb) => {
                sent.push(payload)
                if (!hang) cb({ result: CEVAPLAR[payload.method] })
            }),
            onMessage: { addListener: () => {} },
            lastError: undefined,
        },
    }
    await import('./content.js')
}

const istekler = (method) => win.posted.filter((m) => m.target === 'wats_content_script' && (!method || m.payload?.method === method))
const ackler = () => win.posted.filter((m) => m.target === 'wats_solana_inpage' && m.ack)
const tablolarBos = () => mapOrnekleri.every((m) => m.size === 0)

beforeEach(() => {
    vi.useFakeTimers()
    vi.unstubAllGlobals()
    newPage()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

/** Betigin yukleme-sonrasi tek seferlik zamanlayicisi (legacy yuva) bosalsin: kalan sayim yalniz istek zamanlayicilari. */
async function yuklemeSonrasi() {
    await vi.advanceTimersByTimeAsync(5)
}

describe('O5 -- ack yeniden gondermeyi durdurur', () => {
    it('icerik betigi hazirsa: solana_connect bir kez gider, 1 ack, zamanlayici kalmaz', async () => {
        await loadContent()
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        const p = connect(cuzdan)
        await vi.advanceTimersByTimeAsync(2000)
        await expect(p).resolves.toHaveProperty('accounts')
        expect(istekler('solana_connect')).toHaveLength(1)
        expect(ackler()).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('ack bir YANIT sayilmaz: bekleyen istek cozulmez, yalniz yeniden gonderme durur', async () => {
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        let sonuc = 'bekliyor'
        connect(cuzdan).then(() => { sonuc = 'cozuldu' }, () => { sonuc = 'reddedildi' })
        const id = istekler('solana_connect')[0].id
        win.postMessage({ target: 'wats_solana_inpage', ack: id })
        await vi.advanceTimersByTimeAsync(5000)
        expect(sonuc).toBe('bekliyor')
        expect(istekler('solana_connect')).toHaveLength(1) // ack sonrasi yeniden gonderme YOK
        expect(vi.getTimerCount()).toBe(0)
    })

    it('ack gelmeden YANIT gelirse de zamanlayici durur', async () => {
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        const p = connect(cuzdan)
        const id = istekler('solana_connect')[0].id
        win.postMessage({ target: 'wats_solana_inpage', id, result: CEVAPLAR.solana_connect })
        await vi.advanceTimersByTimeAsync(10)
        await expect(p).resolves.toHaveProperty('accounts')
        expect(vi.getTimerCount()).toBe(0)
    })

    it('sahte ack (bilinmeyen kimlik) hata atmaz ve bekleyen istegi cozmez', async () => {
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        let sonuc = 'bekliyor'
        connect(cuzdan).then(() => { sonuc = 'cozuldu' }, () => { sonuc = 'reddedildi' })
        win.postMessage({ target: 'wats_solana_inpage', ack: 'yok-boyle-bir-id' })
        await vi.advanceTimersByTimeAsync(50)
        expect(sonuc).toBe('bekliyor')
        expect(vi.getTimerCount()).toBe(1) // kendi istegi hala ack bekliyor
    })
})

describe('O5 -- icerik betigi istekten SONRA hazir olursa istek yine de yanitlanir', () => {
    for (const [ad, cagir, beklenen] of [
        ['connect', connect, 'solana_connect'],
        ['signMessage', signMessage, 'solana_signMessage'],
        ['signAndSendTransaction', signAndSend, 'solana_signAndSendTransaction'],
    ]) {
        it(`${ad}: ilk mesaj dinleyici yokken kaybolur, yeniden gonderim yanitlanir; arka plana TEK kez gider`, async () => {
            const cuzdan = loadSolana()
            await yuklemeSonrasi()
            let sonuc = 'bekliyor'
            cagir(cuzdan).then((r) => { sonuc = r }, (e) => { sonuc = e })
            await vi.advanceTimersByTimeAsync(50)
            expect(sonuc).toBe('bekliyor')

            await loadContent()
            await vi.advanceTimersByTimeAsync(500)

            expect(sonuc).not.toBe('bekliyor')
            expect(sonuc).not.toBeInstanceOf(Error)
            expect(sent).toHaveLength(1)
            expect(sent[0].method).toBe(beklenen)
            expect(vi.getTimerCount()).toBe(0)
        })
    }
})

describe('O5 -- icerik betigi HIC gelmezse istek sonsuza dek askida kalmaz', () => {
    it('10 sn ack yok -> KODSUZ Error ile reject, tablolar temiz, zamanlayici yok', async () => {
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        let hata = null
        connect(cuzdan).catch((e) => { hata = e })
        await vi.advanceTimersByTimeAsync(500)
        expect(mapOrnekleri.some((m) => m.size > 0)).toBe(true) // istek bekliyor (callbacks dolu)
        await vi.advanceTimersByTimeAsync(10_500)
        expect(hata).toBeInstanceOf(Error)
        expect(hata.code).toBeUndefined()
        expect(hata.message).toMatch(/did not respond/i)
        expect(tablolarBos()).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('en fazla 100 yeniden gonderim yapilir (ilk gonderim + 100)', async () => {
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        connect(cuzdan).catch(() => {})
        await vi.advanceTimersByTimeAsync(20_000)
        expect(istekler('solana_connect')).toHaveLength(101)
    })

    it('ack alinmis istek 60 sn sonra yanitlanir (10 sn sinirina takilmaz)', async () => {
        await loadContent({ hang: true })
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        let sonuc = 'bekliyor'
        signAndSend(cuzdan).then((r) => { sonuc = r }, (e) => { sonuc = e })
        await vi.advanceTimersByTimeAsync(60_000)
        expect(sonuc).toBe('bekliyor')
        expect(ackler()).toHaveLength(1)
        expect(vi.getTimerCount()).toBe(0)

        const id = istekler('solana_signAndSendTransaction')[0].id
        win.postMessage({ target: 'wats_solana_inpage', id, result: CEVAPLAR.solana_signAndSendTransaction })
        await vi.advanceTimersByTimeAsync(10)
        expect(sonuc).toHaveLength(1)
        expect(sonuc[0].signature).toBeInstanceOf(Uint8Array)
        expect(sent).toHaveLength(1)
    })

    it('DataCloneError ilk postta -> -32602 ile reject ve zamanlayici KURULMAZ', async () => {
        const cuzdan = loadSolana()
        await yuklemeSonrasi()
        win.postMessage = () => { throw new DOMException('klonlanamaz', 'DataCloneError') }
        let hata = null
        connect(cuzdan).catch((e) => { hata = e })
        await vi.advanceTimersByTimeAsync(20)
        expect(hata).toBeInstanceOf(Error)
        expect(hata.code).toBe(-32602)
        expect(tablolarBos()).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })
})
