// src/injected.js'in EIP-1193/EIP-6963 PROTOKOL yuzeyi -- kaynak tarama
// degil, sahte bir pencerede GERCEKTEN calistirilarak (bkz. injectedProvider.test.js).
//
// Dapp bug taramasinin uc dogrulanmis bulgusu:
//  1) Hata kodlari son adimda YOK EDILIYORDU: reject(new Error(error.message))
//     {code:4001} nesnesini koda cevirmeden dumduz Error yapiyordu -- wagmi/viem
//     "kullanici reddetti"yi (code===4001) tanıyamayip hatayi beklenmedik cuzdan
//     arizasi olarak gosteriyordu.
//  2) removeListener HIC calismiyordu: on() anonim bir sarmalayici kaydeder,
//     removeEventListener'a ise ORIJINAL callback veriliyordu. Kaldirma sessiz
//     no-op; her yeniden abonelikte isleyiciler katlaniyordu.
//  3) EIP-6963 uuid'si her duyuruda YENIDEN uretiliyordu; standart sayfa oturumu
//     boyunca SABIT ister -- cuzdan secicilerinde ayni cuzdan coklaniyordu.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const SOURCE = readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

function loadProvider({ onAnnounce } = {}) {
    const win = new EventTarget()
    const posted = []
    // request() sayfaya window.postMessage ile cikar; burada yakalanir.
    win.postMessage = (data) => { posted.push(data) }
    if (onAnnounce) win.addEventListener('eip6963:announceProvider', onAnnounce)
    new Function('window', 'crypto', SOURCE)(win, globalThis.crypto)
    return { win, provider: win.wats, posted }
}

/** Icerik betiginin sayfa penceresine geri gonderdigi yanitin esdegeri. */
function deliver(win, data) {
    const event = new Event('message')
    event.source = win
    event.data = { target: 'wats_inpage', ...data }
    win.dispatchEvent(event)
}

let win, provider, posted

beforeEach(() => {
    ({ win, provider, posted } = loadProvider())
})

describe('injected.js -- EIP-1193 hata kodlari dapp\'e ULASIR', () => {
    it('4001 (kullanici reddi) reject edilen hatada code olarak durur', async () => {
        const promise = provider.request({ method: 'eth_sendTransaction', params: [{}] })
        const { id } = posted[0]

        deliver(win, { id, error: { code: 4001, message: 'User closed the window.' } })

        const err = await promise.catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('User closed the window.')
        expect(err.code).toBe(4001)
    })

    it('4901 (zincir kopuk) da ayni sekilde tasinir', async () => {
        const promise = provider.request({ method: 'eth_chainId' })
        const { id } = posted[0]

        deliver(win, { id, error: { code: 4901, message: 'CHAIN_NOT_EVM' } })

        const err = await promise.catch((e) => e)
        expect(err.code).toBe(4901)
    })

    it('duz metin hata (eski bicim) hala mesaj olarak gecer', async () => {
        const promise = provider.request({ method: 'eth_accounts' })
        const { id } = posted[0]

        deliver(win, { id, error: 'Unknown message type' })

        const err = await promise.catch((e) => e)
        expect(err.message).toBe('Unknown message type')
    })

    it('basarili yanit degismedi (regresyon)', async () => {
        const promise = provider.request({ method: 'eth_chainId' })
        const { id } = posted[0]

        deliver(win, { id, result: '0x1' })

        await expect(promise).resolves.toBe('0x1')
    })
})

describe('injected.js -- on/removeListener GERCEKTEN eslesir', () => {
    it('removeListener\'dan sonra isleyici bir daha CAGRILMAZ', () => {
        const gorulen = []
        const cb = (d) => gorulen.push(d)

        provider.on('accountsChanged', cb)
        provider.removeListener('accountsChanged', cb)
        deliver(win, { method: 'accountsChanged', result: ['0x1'] })

        expect(gorulen).toEqual([])
    })

    it('kaldir + yeniden abone ol: isleyici KATLANMAZ, bir kez cagrilir', () => {
        const gorulen = []
        const cb = (d) => gorulen.push(d)

        provider.on('accountsChanged', cb)
        provider.removeListener('accountsChanged', cb)
        provider.on('accountsChanged', cb)
        deliver(win, { method: 'accountsChanged', result: ['0x2'] })

        expect(gorulen).toEqual([['0x2']])
    })
})

describe('injected.js -- EIP-6963 uuid sayfa oturumu boyunca SABIT', () => {
    it('ilk duyuru ve sonraki her requestProvider AYNI uuid\'yi tasir', () => {
        const uuids = []
        const { win: w } = loadProvider({ onAnnounce: (e) => uuids.push(e.detail.info.uuid) })

        w.dispatchEvent(new Event('eip6963:requestProvider'))
        w.dispatchEvent(new Event('eip6963:requestProvider'))

        expect(uuids.length).toBe(3)
        expect(new Set(uuids).size).toBe(1)
    })
})
