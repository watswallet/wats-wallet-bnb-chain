import { describe, it, expect, afterEach } from 'vitest'
import { installChromeStub } from './ssrRender.js'
import { ilkOkumayiTut } from './privateModeScreen.js'

// ilkOkumayiTut sessizce hicbir sey tutmayan bir yardimci OLMAMALI (T29 M1): tutulan okuma yoksa test korumayi sinamaz.

afterEach(() => { delete globalThis.chrome })

const bekle = (ms) => new Promise((r) => setTimeout(r, ms))

// Okuma `ms` icinde BITMEDIYSE true (yani tutuldu).
async function askidaMi(okuma, ms = 25) {
    let bitti = false
    okuma.then(() => { bitti = true })
    await bekle(ms)
    return !bitti
}

describe('ilkOkumayiTut', () => {
    it.each([
        ['dizi', ['dapps', 'ton_dapps']],
        ['dize', 'dapps'],
        ['nesne', { dapps: {} }],
        ['tum depo (undefined)', undefined],
        ['tum depo (null)', null],
    ])('%s bicimli anahtar tutulur, birak() ile cozulur', async (_ad, keys) => {
        installChromeStub({ dapps: { a: 1 } })
        const t = ilkOkumayiTut('dapps')
        const okuma = globalThis.chrome.storage.local.get(keys)
        expect(await askidaMi(okuma)).toBe(true)
        expect(t.tutuldu).toBe(true)
        t.birak()
        await okuma
    })

    it('anahtari icermeyen okuma aninda doner ve tutuldu false kalir', async () => {
        installChromeStub({ dapps: { a: 1 }, vaults: [] })
        const t = ilkOkumayiTut('dapps')
        const okuma = globalThis.chrome.storage.local.get(['vaults'])
        expect(await askidaMi(okuma)).toBe(false)
        expect(t.tutuldu).toBe(false)
    })

    it('hicbir okuma tutulmadiysa birak() sessiz gecmez, FIRLATIR', async () => {
        installChromeStub({ dapps: {} })
        const t = ilkOkumayiTut('dapps')
        await globalThis.chrome.storage.local.get(['vaults'])
        expect(() => t.birak()).toThrow(/hicbir storage.local.get cagrisi tutulmadi/)
    })

    it('yalniz ILK eslesen cagri tutulur; ikincisi aninda doner', async () => {
        installChromeStub({ dapps: { a: 1 } })
        const t = ilkOkumayiTut('dapps')
        const birinci = globalThis.chrome.storage.local.get('dapps')
        const ikinci = globalThis.chrome.storage.local.get('dapps')
        expect(await askidaMi(ikinci)).toBe(false)
        expect(await askidaMi(birinci)).toBe(true)
        t.birak()
        expect(await birinci).toEqual({ dapps: { a: 1 } })
    })
})
