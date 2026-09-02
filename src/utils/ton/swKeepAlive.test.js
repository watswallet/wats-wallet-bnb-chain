import { describe, it, expect, vi, afterEach } from 'vitest'
import { withKeepAlive, KEEP_ALIVE_INTERVAL_MS, KEEP_ALIVE_STORAGE_KEY } from './swKeepAlive'

// `chrome` bu depoda vitest'in node ortaminda YOKTUR (bkz. vitest.config.js:
// environment 'node'). Testler onu globalThis'e KENDILERI koyar ve her testten sonra
// KALDIRIR - birakilan bir global, sonraki dosyalarin "chrome yok" dalini sessizce
// olculemez hale getirirdi.
function installFakeChrome() {
    const get = vi.fn(async () => ({}))
    globalThis.chrome = { storage: { local: { get } } }
    return get
}

afterEach(() => {
    delete globalThis.chrome
    vi.useRealTimers()
})

describe('withKeepAlive - chrome YOKKEN', () => {
    it('fn i DUZ cagirir, sonucu dondurur, FIRLATMAZ', async () => {
        const fn = vi.fn(async () => 'deger')
        await expect(withKeepAlive(fn)).resolves.toBe('deger')
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('fn firlatirsa hata cagirana AYNEN gecer', async () => {
        const boom = new Error('patladi')
        await expect(withKeepAlive(async () => { throw boom })).rejects.toBe(boom)
    })
})

describe('withKeepAlive - chrome VARKEN', () => {
    it('20 sn de bir chrome.storage.local.get cagirir', async () => {
        vi.useFakeTimers()
        const get = installFakeChrome()

        let release
        const running = withKeepAlive(() => new Promise((resolve) => { release = resolve }))

        expect(get).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)
        expect(get).toHaveBeenCalledTimes(1)
        expect(get).toHaveBeenCalledWith(KEEP_ALIVE_STORAGE_KEY)
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)
        expect(get).toHaveBeenCalledTimes(2)

        release('bitti')
        await expect(running).resolves.toBe('bitti')
    })

    it('fn BITINCE zamanlayici DURUR - sonsuza kadar SW yi ayakta tutmaz', async () => {
        vi.useFakeTimers()
        const get = installFakeChrome()

        await withKeepAlive(async () => 'ok')

        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 5)
        expect(get).not.toHaveBeenCalled()
    })

    it('fn FIRLATSA da zamanlayici DURUR ve hata gecer', async () => {
        vi.useFakeTimers()
        const get = installFakeChrome()

        await expect(withKeepAlive(async () => { throw new Error('patladi') })).rejects.toThrow('patladi')

        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS * 5)
        expect(get).not.toHaveBeenCalled()
    })

    it('get REDDEDERSE fn in sonucu etkilenmez (yakalanmamis reddetme yok)', async () => {
        vi.useFakeTimers()
        installFakeChrome()
        globalThis.chrome.storage.local.get = vi.fn(() => Promise.reject(new Error('depo kapali')))

        let release
        const running = withKeepAlive(() => new Promise((resolve) => { release = resolve }))
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)

        release('bitti')
        await expect(running).resolves.toBe('bitti')
    })

    it('get SENKRON firlatirsa da fn in sonucu etkilenmez', async () => {
        vi.useFakeTimers()
        installFakeChrome()
        globalThis.chrome.storage.local.get = vi.fn(() => { throw new Error('depo kapali') })

        let release
        const running = withKeepAlive(() => new Promise((resolve) => { release = resolve }))
        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS)

        release('bitti')
        await expect(running).resolves.toBe('bitti')
    })
})
