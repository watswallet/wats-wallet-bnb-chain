// src/injected.js'in EIP-1193 BAGLANTI DURUMU -- KAYNAK TARAMASI DEGIL,
// GERCEKTEN CALISTIRILARAK test edilir.
//
// KOK NEDEN (kod incelemesi, Bulgu 5): bu davranis yalnizca metin olarak
// iddia ediliyordu. Reviewer `_connected` atamalarini `window.dispatchEvent`in
// ALTINA tasidi ve 113 dosya / 1610 testin TAMAMI YESIL kaldi. Oysa
// dispatchEvent dinleyicileri SENKRON calistirir ve `on()` dapp geri cagrimini
// TAM O SIRADA cagirir: wagmi/viem'in connector'u kendi `connect` isleyicisinin
// ICINDE `isConnected()` sorarsa BAYAT `false` okur ve yeniden baglanmayi
// reddeder -- bu eslesmenin duzeltmek icin var oldugu arizanin ta kendisi.
//
// injected.js bir <script> dosyasi: hicbir sey disari vermiyor, modul kapsaminda
// `window`a dokunuyor. Bu yuzden kaynak, SAHTE bir `window` (gercek bir
// EventTarget) ile `new Function` icinde CALISTIRILIR.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

/** Sahte sayfa ortami: gercek olay yayilimi, gercek dinleyiciler. */
function loadProvider() {
    const win = new EventTarget()
    // injected.js `crypto.randomUUID()`i yalnizca EIP-6963 duyurusunda kullanir.
    new Function('window', 'crypto', SOURCE)(win, globalThis.crypto)
    return { win, provider: win.wats }
}

/** Icerik betiginin `window.postMessage` ile gonderdigi mesajin esdegeri. */
function deliver(win, method, result) {
    const event = new Event('message')
    event.source = win
    event.data = { target: 'wats_inpage', method, result }
    win.dispatchEvent(event)
}

let win
let provider

beforeEach(() => {
    ({ win, provider } = loadProvider())
})

describe('injected.js -- saglayici sahte bir pencerede GERCEKTEN calisir', () => {
    it('window.wats ve window.ethereum kurulur, baslangicta BAGLI', () => {
        expect(provider).toBeDefined()
        expect(win.ethereum).toBe(provider)
        // Sayfa yuklendiginde TRUE: bugune kadarki davranis buydu ve EVM icin
        // hicbir sey degismemeli.
        expect(provider.isConnected()).toBe(true)
    })
})

describe('injected.js -- disconnect/connect baglanti durumunu GERCEKTEN degistirir', () => {
    it('disconnect sonrasi isConnected() false, connect sonrasi tekrar true', () => {
        deliver(win, 'disconnect', { code: 4901, message: 'Chain Disconnected' })
        expect(provider.isConnected()).toBe(false)

        deliver(win, 'connect', { chainId: '0x89' })
        expect(provider.isConnected()).toBe(true)
    })

    it('olaylar dapp dinleyicisine yuk ile birlikte ULASIR', () => {
        const gorulen = []
        provider.on('disconnect', (d) => gorulen.push(['disconnect', d]))
        provider.on('connect', (d) => gorulen.push(['connect', d]))

        deliver(win, 'disconnect', { code: 4901, message: 'Chain Disconnected' })
        deliver(win, 'connect', { chainId: '0x89' })

        expect(gorulen).toEqual([
            ['disconnect', { code: 4901, message: 'Chain Disconnected' }],
            ['connect', { chainId: '0x89' }],
        ])
    })

    // BULGU 5'IN KILIDI: durum, olay YAYILMADAN ONCE guncellenmeli.
    it('connect dinleyicisinin ICINDE isConnected() ZATEN true', () => {
        let icerideOkunan = null
        provider.on('connect', () => { icerideOkunan = provider.isConnected() })

        deliver(win, 'disconnect', { code: 4901 })
        deliver(win, 'connect', { chainId: '0x1' })

        expect(icerideOkunan).toBe(true)
    })

    it('disconnect dinleyicisinin ICINDE isConnected() ZATEN false', () => {
        let icerideOkunan = null
        provider.on('disconnect', () => { icerideOkunan = provider.isConnected() })

        deliver(win, 'disconnect', { code: 4901 })

        expect(icerideOkunan).toBe(false)
    })

    // EVM REGRESYONU: chainChanged/accountsChanged baglanti durumuna DOKUNMAZ.
    it('chainChanged ve accountsChanged isConnected() i DEGISTIRMEZ', () => {
        deliver(win, 'chainChanged', '0x89')
        deliver(win, 'accountsChanged', ['0xabc'])
        expect(provider.isConnected()).toBe(true)

        deliver(win, 'disconnect', { code: 4901 })
        deliver(win, 'chainChanged', '0x1')
        // Yalnizca 'connect' geri getirir; chainChanged TEK BASINA yetmez --
        // bu eslesmenin var olma sebebi.
        expect(provider.isConnected()).toBe(false)
    })

    it('baska bir kaynaktan/hedeften gelen mesaj yok sayilir', () => {
        const yabanci = new Event('message')
        yabanci.source = win
        yabanci.data = { target: 'baska_bir_kanal', method: 'disconnect', result: {} }
        win.dispatchEvent(yabanci)

        expect(provider.isConnected()).toBe(true)
    })
})
