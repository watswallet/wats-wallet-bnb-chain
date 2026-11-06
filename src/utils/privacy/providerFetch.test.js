import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from '../../test-utils/kaynakTarama'
import { providerTimeoutFor, wrapProviderFetch, installProviderFetch } from './providerFetch'

const API = 'https://api.silentswap.com'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

describe('providerTimeoutFor: yalniz api.silentswap.com ana makinesi (spec 4.2 sureler tablosu)', () => {
    it('sureler: /orders 28 sn, /order/{ticket} ve /deposit-tx 20 sn, /dest-assets 8 sn; digerleri 20 sn', () => {
        expect(providerTimeoutFor(`${API}/orders`)).toBe(28000)
        expect(providerTimeoutFor(`${API}/order/0xabc`)).toBe(20000)
        expect(providerTimeoutFor(`${API}/order/0xabc/deposit-tx`)).toBe(20000)
        expect(providerTimeoutFor(`${API}/dest-assets`)).toBe(8000)
        expect(providerTimeoutFor(`${API}/baska-bir-uc`)).toBe(20000)
        expect(providerTimeoutFor(`${API}/orders?x=1`)).toBe(28000)
        expect(providerTimeoutFor(`${API}:443/orders`)).toBe(28000)
    })

    it('URL nesnesi de kabul edilir', () => {
        expect(providerTimeoutFor(new URL(`${API}/dest-assets`))).toBe(8000)
    })

    it('baska ana makine, http, benzer alan adi, goreli yol ve dizge/URL olmayan girdi null', () => {
        for (const v of [
            'https://api.coingecko.com/api/v3/ping', 'http://api.silentswap.com/orders', 'https://api.silentswap.com.evil.example/orders',
            'https://evil.example/https://api.silentswap.com/orders', 'https://sub.api.silentswap.com/orders', '/orders', 'orders', '',
            undefined, null, 42, {}, { url: `${API}/orders` },
        ]) {
            expect(providerTimeoutFor(v), String(v)).toBeNull()
        }
        if (typeof Request === 'function') expect(providerTimeoutFor(new Request(`${API}/orders`))).toBeNull()
    })
})

describe('wrapProviderFetch', () => {
    it('SilentSwap istegine zaman asimi sinyali ekler; ozgun init DEGISMEZ, ote alanlar korunur', async () => {
        const taban = vi.fn(async () => 'cevap')
        const sinyal = { sinyal: 'zaman-asimi' }
        const zamanAsimi = vi.fn(() => sinyal)
        const sarili = wrapProviderFetch(taban, { timeoutSignal: zamanAsimi })
        const init = { method: 'POST', headers: { a: 'b' }, body: '{}' }
        expect(await sarili(`${API}/orders`, init)).toBe('cevap')
        expect(zamanAsimi).toHaveBeenCalledWith(28000)
        expect(taban).toHaveBeenCalledWith(`${API}/orders`, { method: 'POST', headers: { a: 'b' }, body: '{}', signal: sinyal })
        expect(init).toEqual({ method: 'POST', headers: { a: 'b' }, body: '{}' })
    })

    it('init verilmeyen istek de sinyal alir', async () => {
        const taban = vi.fn(async () => null)
        await wrapProviderFetch(taban, { timeoutSignal: () => 'S' })(`${API}/dest-assets`)
        expect(taban).toHaveBeenCalledWith(`${API}/dest-assets`, { signal: 'S' })
    })

    it('istegin kendi sinyali varsa sarmalayici DOKUNMAZ (ayni init nesnesi)', async () => {
        const taban = vi.fn(async () => null)
        const zamanAsimi = vi.fn()
        const init = { signal: new AbortController().signal }
        await wrapProviderFetch(taban, { timeoutSignal: zamanAsimi })(`${API}/orders`, init)
        expect(zamanAsimi).not.toHaveBeenCalled()
        expect(taban.mock.calls[0][1]).toBe(init)
    })

    it('baska ana makine ve Request nesnesi degismeden gecer', async () => {
        const taban = vi.fn(async () => null)
        const sarili = wrapProviderFetch(taban, { timeoutSignal: () => { throw new Error('cagrilmamali') } })
        await sarili('https://api.coingecko.com/api/v3/ping')
        expect(taban).toHaveBeenLastCalledWith('https://api.coingecko.com/api/v3/ping', undefined)
        const init = { method: 'GET' }
        await sarili('https://example.org/', init)
        expect(taban.mock.calls.at(-1)[1]).toBe(init)
        if (typeof Request === 'function') {
            const istek = new Request(`${API}/orders`)
            await sarili(istek)
            expect(taban.mock.calls.at(-1)[0]).toBe(istek)
        }
    })

    // Baglamsiz cagri "Illegal invocation" verir (ust belge 5.6): orijinal fetch globalThis baglamiyla cagrilir.
    it('orijinal fetch globalThis baglamiyla cagrilir', async () => {
        let baglam
        const taban = function () { baglam = this; return Promise.resolve(null) }
        await wrapProviderFetch(taban, { timeoutSignal: () => 'S' })(`${API}/orders`, {})
        expect(baglam).toBe(globalThis)
        await wrapProviderFetch(taban)('https://example.org/')
        expect(baglam).toBe(globalThis)
    })

    // Promise.race bekleyen istegi iptal etmez; gercek AbortSignal fetch'i REDDEDER.
    it('sure dolunca istek GERCEKTEN iptal olur (fetch sinyal ile reddedilir)', async () => {
        vi.useFakeTimers()
        try {
            const taban = (input, init) => new Promise((_, reddet) => {
                init.signal.addEventListener('abort', () => reddet(init.signal.reason))
            })
            const zamanAsimi = (ms) => {
                const denetci = new AbortController()
                setTimeout(() => denetci.abort(new DOMException('zaman asimi', 'TimeoutError')), ms)
                return denetci.signal
            }
            let bitti = false
            const sonuc = wrapProviderFetch(taban, { timeoutSignal: zamanAsimi })(`${API}/orders`, { method: 'POST' }).catch((e) => e.name)
            sonuc.then(() => { bitti = true })
            await vi.advanceTimersByTimeAsync(27999)
            expect(bitti).toBe(false)
            await vi.advanceTimersByTimeAsync(1)
            expect(await sonuc).toBe('TimeoutError')
        } finally {
            vi.useRealTimers()
        }
    })

    it('varsayilan zaman asimi AbortSignal.timeout ile kurulur ve AbortSignal.any HIC cagrilmaz (tanimsizken de calisir)', async () => {
        const timeoutCasusu = vi.spyOn(AbortSignal, 'timeout')
        const anyTanimi = Object.getOwnPropertyDescriptor(AbortSignal, 'any')
        const anyCasusu = anyTanimi ? vi.spyOn(AbortSignal, 'any') : null
        const taban = vi.fn(async () => null)
        await wrapProviderFetch(taban)(`${API}/order/0x1`, {})
        expect(timeoutCasusu).toHaveBeenCalledWith(20000)
        expect(taban.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
        if (anyCasusu) expect(anyCasusu).not.toHaveBeenCalled()
        // Chrome 115'te AbortSignal.any yoktur: sarmalayici yine calismali.
        Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true })
        try {
            await wrapProviderFetch(taban)(`${API}/orders`, {})
            expect(taban.mock.calls.at(-1)[1].signal).toBeInstanceOf(AbortSignal)
        } finally {
            if (anyTanimi) Object.defineProperty(AbortSignal, 'any', anyTanimi)
            else delete AbortSignal.any
        }
    })

    it('kaynak: AbortSignal.any kullanilmaz, AbortSignal.timeout kullanilir', () => {
        const kod = yorumsuz(readFileSync(fileURLToPath(new URL('./providerFetch.js', import.meta.url)), 'utf8'))
        expect(kod).not.toMatch(/AbortSignal\.any/)
        expect(kod).toMatch(/AbortSignal\.timeout/)
    })
})

describe('installProviderFetch', () => {
    it('hedefin fetch\'ini BIR kez sarar; ikinci kurulum sarmalayiciyi tekrar sarmaz', () => {
        const taban = vi.fn(async () => null)
        const hedef = { fetch: taban }
        expect(installProviderFetch(hedef)).toBe(true)
        const sarili = hedef.fetch
        expect(sarili).not.toBe(taban)
        expect(installProviderFetch(hedef)).toBe(false)
        expect(hedef.fetch).toBe(sarili)
    })

    it('fetch yoksa hicbir sey yapmaz', () => {
        const hedef = {}
        expect(installProviderFetch(hedef)).toBe(false)
        expect(hedef).toEqual({})
    })

    it('kurulu sarmalayici SilentSwap istegine sinyal ekler, digerlerine eklemez', async () => {
        const taban = vi.fn(async () => null)
        const hedef = { fetch: taban }
        installProviderFetch(hedef)
        await hedef.fetch(`${API}/order/0x1`, { method: 'GET' })
        expect(taban.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
        await hedef.fetch('https://api.coingecko.com/x', { method: 'GET' })
        expect(taban.mock.calls[1][1]).toEqual({ method: 'GET' })
    })
})

// SDK `jsonFetch` global fetch'i sinyalsiz cagirir: sarmalayici, SDK istemcisi kurulmadan ONCE ve yalniz istemci kurulurken
// devreye girer (spec 4.2'nin "acilista" kurulumundan bilincli sapma: Interfaces notuna bak).
describe('privacyClient() SDK istemcisini kurarken fetch sarilir', () => {
    it('ilk cagrida bir kez sarar, ikinci cagri ayni istemciyi dondurur ve tekrar sarmaz', async () => {
        vi.resetModules()
        const sahte = vi.fn(async () => null)
        vi.stubGlobal('fetch', sahte)
        const { privacyClient } = await import('./silentswap')
        expect(globalThis.fetch).toBe(sahte)
        const istemci = privacyClient()
        const sarili = globalThis.fetch
        expect(sarili).not.toBe(sahte)
        expect(privacyClient()).toBe(istemci)
        expect(globalThis.fetch).toBe(sarili)
        await globalThis.fetch(`${API}/orders`, { method: 'POST' })
        expect(sahte.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    })
})
