// Kopru nesnesini GERCEKTEN kurup davranisini olcen testler.
//
// KOK NEDEN: `window.wats` bugun DUZ ATAMA ile yaziliyor (injected.js). Iki ayri
// MAIN-world betik ayni nesneyi yazdiginda, yukleme sirasi degisirse biri
// otekini EZER ve dapp cuzdani bulamaz -- hata mesaji da olmaz.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// injected.js bir modul degil, dogrudan bir <script>; ters-sira testi icin
// kaynagini GERCEKTEN calistiririz (injectedProvider.test.js'teki desenin aynisi).
const INJECTED_SOURCE = readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

function kurWindow() {
    const dinleyiciler = []
    const gonderilen = []
    globalThis.window = {
        addEventListener: (tip, fn) => { if (tip === 'message') dinleyiciler.push(fn) },
        removeEventListener: () => {},
        postMessage: (data) => { gonderilen.push(data) },
        dispatchEvent: () => {},
    }
    globalThis.window.self = globalThis.window
    return { dinleyiciler, gonderilen }
}

/** Arka plandan gelen yaniti taklit eder. */
function yanitla(dinleyiciler, data) {
    for (const fn of dinleyiciler) fn({ source: globalThis.window, data })
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.window })

describe('tonInjected kopru yuzeyi', () => {
    it('window.wats.tonconnect TonConnect arayuzunu tasir', async () => {
        kurWindow()
        await import('./tonInjected.js')
        const b = globalThis.window.wats.tonconnect
        expect(b.protocolVersion).toBe(2)
        expect(b.isWalletBrowser).toBe(false)
        for (const ad of ['connect', 'restoreConnection', 'send', 'listen']) {
            expect(typeof b[ad]).toBe('function')
        }
        expect(b.walletInfo.name).toBeTruthy()
        expect(b.deviceInfo.maxProtocolVersion).toBe(2)
    })

    // features BAGLAYICI bir bildirimdir: dapp buna bakip istegini kurar.
    it('features SendTransaction(maxMessages 4) ve SignData bildirir', async () => {
        kurWindow()
        await import('./tonInjected.js')
        const f = globalThis.window.wats.tonconnect.deviceInfo.features
        const send = f.find((x) => x && x.name === 'SendTransaction')
        const sign = f.find((x) => x && x.name === 'SignData')
        expect(send.maxMessages).toBe(4)
        expect(sign.types).toEqual(['text', 'binary', 'cell'])
    })

    it('mevcut window.wats EZILMEZ, uzerine eklenir', async () => {
        kurWindow()
        globalThis.window.wats = { isWatsWallet: true, request: () => {} }
        await import('./tonInjected.js')
        expect(globalThis.window.wats.isWatsWallet).toBe(true)
        expect(globalThis.window.wats.tonconnect).toBeTruthy()
    })

    // TERS SIRA: karar 1'in DIGER yarisi. Yukaridaki test tonInjected.js'in
    // injected.js'ten SONRA yuklendigini varsayiyordu; manifest dizisindeki
    // sira degisirse (ya da bir cerceve iki betigi farkli sirada calistirirsa)
    // injected.js SONRA gelip window.wats'i DUZ ATAMA ile degistirebilir. O
    // atama savunmaci (bkz. injected.js), ama bunu kanitlayan bir test yoktu.
    it('injected.js SONRA yuklenirse de tonconnect KORUNUR (ters sira)', async () => {
        kurWindow()
        await import('./tonInjected.js')
        expect(globalThis.window.wats.tonconnect).toBeTruthy()

        // injected.js'i AYNI sahte window uzerinde GERCEKTEN calistiririz --
        // kaynagi kaynak-taramasi degil, calistirilarak dogrulanir.
        new Function('window', 'crypto', INJECTED_SOURCE)(globalThis.window, globalThis.crypto)

        // EVM saglayicisinin KENDI uyeleri de gelmis olmali -- yalnizca
        // tonconnect'in hayatta kalmasi yetmez, duz atamanin ustune binen
        // savunmaci kod EVM tarafini da kirmamali.
        expect(globalThis.window.wats.isWatsWallet).toBe(true)
        expect(typeof globalThis.window.wats.request).toBe('function')
        expect(globalThis.window.wats.tonconnect).toBeTruthy()
        expect(globalThis.window.wats.tonconnect.protocolVersion).toBe(2)
    })
})

describe('kopru -> arka plan', () => {
    it('connect dogru metot ve params ile postMessage yapar', async () => {
        const { gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const req = { manifestUrl: 'https://a/m.json', items: [{ name: 'ton_addr' }] }
        globalThis.window.wats.tonconnect.connect(2, req)
        const m = gonderilen[0]
        expect(m.target).toBe('wats_content_script')
        expect(m.payload.method).toBe('tonconnect_connect')
        expect(m.payload.params[0]).toEqual(req)
        expect(m.id).toBeTruthy()
    })

    it('send tonconnect_send ile gecer', async () => {
        const { gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const req = { method: 'sendTransaction', params: ['{}'], id: '1' }
        globalThis.window.wats.tonconnect.send(req)
        expect(gonderilen[0].payload.method).toBe('tonconnect_send')
        expect(gonderilen[0].payload.params[0]).toEqual(req)
    })

    it('restoreConnection tonconnect_restore ile gecer', async () => {
        const { gonderilen } = kurWindow()
        await import('./tonInjected.js')
        globalThis.window.wats.tonconnect.restoreConnection()
        expect(gonderilen[0].payload.method).toBe('tonconnect_restore')
    })
})

describe('arka plan -> kopru', () => {
    it('yanit gelen id ile promise cozulur', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const p = globalThis.window.wats.tonconnect.restoreConnection()
        yanitla(dinleyiciler, { target: 'wats_ton_inpage', id: gonderilen[0].id, result: { event: 'connect' } })
        await expect(p).resolves.toEqual({ event: 'connect' })
    })

    // TonConnect'te hata BIR EXCEPTION DEGIL, bir OLAY GOVDESIDIR. reject etmek
    // dapp'in kendi hata isleyicisini atlar ve kullaniciya kirik bir ekran gosterir.
    it('hata yaniti REJECT etmez, hata govdesini COZER', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const p = globalThis.window.wats.tonconnect.connect(2, { manifestUrl: 'x' })
        const hata = { event: 'connect_error', id: 0, payload: { code: 300, message: 'rejected' } }
        yanitla(dinleyiciler, { target: 'wats_ton_inpage', id: gonderilen[0].id, result: hata })
        await expect(p).resolves.toEqual(hata)
    })

    // TASIMA KATMANI hatalari (content.js'in 4200 engeli, lastError dali,
    // arka planin dondugu response.error) `result` degil `error` tasir.
    // Eskiden yalnizca `result` okunuyordu -- bu ucu resolve(undefined) idi
    // ve dapp'in SDK'si `response.event` okurken cokuyordu.
    it('4200 engeli (isPagePayloadAllowed reddi) connect_error OLAYINA donusur, kod 400', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const p = globalThis.window.wats.tonconnect.restoreConnection()
        yanitla(dinleyiciler, {
            target: 'wats_ton_inpage',
            id: gonderilen[0].id,
            error: { code: 4200, message: 'Method not supported.' },
        })
        const sonuc = await p
        expect(sonuc.event).toBe('connect_error')
        expect(typeof sonuc.id).toBe('number')
        expect(sonuc.payload.code).toBe(400)
    })

    // FINAL INCELEME (K3): dappFunctions.js onay penceresi KAPATILDIGINDA
    // (onRemoved) ya da bir istek YENISIYLE DEGISTIRILDIGINDE 4001 gonderir --
    // bu acikca Reddet'e basmakla AYNI anlama gelir (spec SS3.2: "reddetti VEYA
    // pencereyi kapatti"), 300 USER_REJECTS_ERROR olmali, UNKNOWN_ERROR (0)
    // DEGIL. Eskiden 4001 de digerleri gibi 0'a dusuyordu; @tonconnect/ui bunu
    // hata sanip modalini kirik birakiyordu.
    it('4001 (pencere kapatildi / istek degistirildi) connect_error OLAYINA donusur, kod 300', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const p = globalThis.window.wats.tonconnect.restoreConnection()
        yanitla(dinleyiciler, {
            target: 'wats_ton_inpage',
            id: gonderilen[0].id,
            error: { code: 4001, message: 'User closed the window.' },
        })
        const sonuc = await p
        expect(sonuc.event).toBe('connect_error')
        expect(sonuc.payload.code).toBe(300)
    })

    it('send yolunda 4001 de AppRequest in id sini tasir ve kod 300 olur', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const req = { method: 'sendTransaction', params: ['{}'], id: 'req-99' }
        const p = globalThis.window.wats.tonconnect.send(req)
        yanitla(dinleyiciler, {
            target: 'wats_ton_inpage',
            id: gonderilen[0].id,
            error: { code: 4001, message: 'Request replaced by a new one.' },
        })
        const sonuc = await p
        expect(sonuc.error.code).toBe(300)
        expect(sonuc.id).toBe('req-99')
    })

    it('kodsuz tasima hatasi (chrome.runtime.lastError) UNKNOWN_ERROR (0) olarak connect_error olur', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const p = globalThis.window.wats.tonconnect.connect(2, { manifestUrl: 'x' })
        yanitla(dinleyiciler, {
            target: 'wats_ton_inpage',
            id: gonderilen[0].id,
            error: { message: 'Could not establish communication with the wallet background service.' },
        })
        const sonuc = await p
        expect(sonuc.event).toBe('connect_error')
        expect(sonuc.payload.code).toBe(0)
    })

    // send()'in hata govdesi AppRequest'in KENDI id'sini tasimali (protokol
    // boyle tanimliyor), gonderi id'sini DEGIL. Bilinmeyen bir kod (123, arka
    // planin dogrudan dondugu response.error dalinin bir ornegi) da UNKNOWN_ERROR'a duser.
    it('send tasima hatasi AppRequest in id sini tasir, bilinmeyen kod UNKNOWN_ERROR (0) olur', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        const req = { method: 'sendTransaction', params: ['{}'], id: 'req-42' }
        const p = globalThis.window.wats.tonconnect.send(req)
        yanitla(dinleyiciler, {
            target: 'wats_ton_inpage',
            id: gonderilen[0].id,
            error: { code: 123, message: 'arka plan hatasi' },
        })
        const sonuc = await p
        expect(sonuc.error.code).toBe(0)
        expect(sonuc.id).toBe('req-42')
    })

    it('EVM hedefi (wats_inpage) TON kopruyu ETKILEMEZ', async () => {
        const { dinleyiciler, gonderilen } = kurWindow()
        await import('./tonInjected.js')
        let cozuldu = false
        globalThis.window.wats.tonconnect.restoreConnection().then(() => { cozuldu = true })
        yanitla(dinleyiciler, { target: 'wats_inpage', id: gonderilen[0].id, result: { x: 1 } })
        await Promise.resolve()
        expect(cozuldu).toBe(false)
    })

    it('listen ile kaydedilen dinleyici disconnect olayini alir', async () => {
        const { dinleyiciler } = kurWindow()
        await import('./tonInjected.js')
        const gorulen = []
        const dur = globalThis.window.wats.tonconnect.listen((e) => gorulen.push(e))
        const olay = { event: 'disconnect', id: 0, payload: {} }
        yanitla(dinleyiciler, { target: 'wats_ton_inpage', event: olay })
        expect(gorulen).toEqual([olay])

        dur()
        yanitla(dinleyiciler, { target: 'wats_ton_inpage', event: olay })
        expect(gorulen.length).toBe(1)
    })
})
