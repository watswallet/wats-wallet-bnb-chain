// dappsStore.updateDapps: bayat-goruntu (kayip guncelleme) yarisinin kapatildigini kilitler.
//
// Sahte depo YAVAS: her get/set bir zamanlayici turu bekler. Bu, iki bagimsiz
// yazicinin "oku -> bekle -> yaz" araligini gercekten ic ice sokar; anlik
// donen bir sahte yaris HIC uretemezdi ve test kilit olmadan da yesil kalirdi.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { updateDapps, DAPPS_LOCK_NAME } from './dappsStore.js'

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

let store
let setCalls

function installChrome() {
    store = {}
    setCalls = []
    globalThis.chrome = {
        storage: {
            local: {
                // Gercek chrome.storage her okumada YAPISAL KOPYA doner.
                get: async (key) => {
                    await sleep()
                    return key in store ? { [key]: JSON.parse(JSON.stringify(store[key])) } : {}
                },
                set: async (obj) => {
                    await sleep()
                    setCalls.push(obj)
                    for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v))
                },
            },
        },
    }
}

// FIFO karsilikli dislama: ayni adli iki istek ust uste binmez.
function installFakeLocks() {
    const requests = []
    const tails = new Map()
    vi.stubGlobal('navigator', {
        locks: {
            request: (name, callback) => {
                requests.push(name)
                const previous = tails.get(name) || Promise.resolve()
                const run = previous.then(() => callback({ name }))
                tails.set(name, run.catch(() => {}))
                return run
            },
        },
    })
    return requests
}

beforeEach(() => { installChrome() })

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

describe('updateDapps -- kilit', () => {
    it('kilit adi wats-dapps ve navigator.locks.request uzerinden calisir', async () => {
        const requests = installFakeLocks()
        await updateDapps((d) => { d['a.com'] = { accounts: ['0x1'] } })
        expect(DAPPS_LOCK_NAME).toBe('wats-dapps')
        expect(requests).toEqual(['wats-dapps'])
    })

    it('iki es zamanli yazim KAYIP GUNCELLEME uretmez (kilit ile)', async () => {
        installFakeLocks()
        const p1 = updateDapps(async (d) => { await sleep(40); d['a.com'] = { accounts: ['0x1'] } })
        const p2 = updateDapps((d) => { d['b.com'] = { accounts: ['0x2'] } })
        await Promise.all([p1, p2])
        expect(Object.keys(store.dapps).sort()).toEqual(['a.com', 'b.com'])
    })

    // TEST DUYARLILIGI: kilit "hemen cagir" ile degistirilince AYNI senaryo
    // gercekten bir guncelleme KAYBEDER. Bu kontrol olmasaydi yukaridaki test,
    // sahte deponun yaris uretemedigini degil kilidin ise yaradigini
    // ispatlamis olmazdi.
    it('kontrol: kilitsiz (hemen cagiran) sahte ile ayni senaryo bir guncellemeyi KAYBEDER', async () => {
        vi.stubGlobal('navigator', { locks: { request: (_name, callback) => callback({}) } })
        const p1 = updateDapps(async (d) => { await sleep(40); d['a.com'] = { accounts: ['0x1'] } })
        const p2 = updateDapps((d) => { d['b.com'] = { accounts: ['0x2'] } })
        await Promise.all([p1, p2])
        expect(Object.keys(store.dapps)).toHaveLength(1)
    })

    it('navigator.locks YOKSA modul-ici kuyrukla yine seri calisir', async () => {
        vi.stubGlobal('navigator', {})
        const p1 = updateDapps(async (d) => { await sleep(40); d['a.com'] = { accounts: ['0x1'] } })
        const p2 = updateDapps((d) => { d['b.com'] = { accounts: ['0x2'] } })
        await Promise.all([p1, p2])
        expect(Object.keys(store.dapps).sort()).toEqual(['a.com', 'b.com'])
    })

    it('navigator hic tanimli degilse de calisir', async () => {
        vi.stubGlobal('navigator', undefined)
        await updateDapps((d) => { d['a.com'] = { accounts: [] } })
        expect(store.dapps['a.com']).toEqual({ accounts: [] })
    })
})

describe('updateDapps -- okuma/yazma kurallari', () => {
    beforeEach(() => { installFakeLocks() })

    it('mutator diskteki GUNCEL haritayi gorur ve yerinde degisiklik yazilir', async () => {
        store.dapps = { 'a.com': { accounts: ['0x1'], chainId: '0x1' } }
        const result = await updateDapps((d) => { d['a.com'].chainId = '0x89' })
        expect(store.dapps['a.com']).toEqual({ accounts: ['0x1'], chainId: '0x89' })
        expect(result['a.com'].chainId).toBe('0x89')
    })

    it('diskte dapps yoksa mutator bos nesne alir', async () => {
        let gorulen
        await updateDapps((d) => { gorulen = d })
        expect(gorulen).toEqual({})
    })

    it('diskteki deger duz nesne degilse (dizi) bos nesne sayilir', async () => {
        store.dapps = ['bozuk']
        let gorulen
        await updateDapps((d) => { gorulen = d })
        expect(gorulen).toEqual({})
    })

    it('mutator duz nesne dondururse O yazilir', async () => {
        store.dapps = { 'a.com': { accounts: ['0x1'] } }
        await updateDapps(() => ({ 'z.com': { accounts: ['0x9'] } }))
        expect(Object.keys(store.dapps)).toEqual(['z.com'])
    })

    it('duz nesne OLMAYAN donus degeri (delete ifadesinin true su, null) YOK SAYILIR', async () => {
        store.dapps = { 'a.com': { accounts: ['0x1'] }, 'b.com': { accounts: ['0x2'] } }
        await updateDapps((d) => delete d['a.com'])
        expect(Object.keys(store.dapps)).toEqual(['b.com'])
        await updateDapps(() => null)
        expect(Object.keys(store.dapps)).toEqual(['b.com'])
    })

    it('async mutator BEKLENIR', async () => {
        await updateDapps(async (d) => { await sleep(5); d['a.com'] = { accounts: ['0x1'] } })
        expect(store.dapps['a.com']).toEqual({ accounts: ['0x1'] })
    })

    it('hicbir sey degismediyse storage.local.set CAGRILMAZ', async () => {
        store.dapps = { 'a.com': { accounts: ['0x1'] } }
        await updateDapps(() => {})
        await updateDapps((d) => { d['a.com'].accounts = ['0x1'] })
        expect(setCalls).toHaveLength(0)
    })

    it('degisiklik varsa tam BIR kez yazilir', async () => {
        store.dapps = { 'a.com': { accounts: ['0x1'] } }
        await updateDapps((d) => { d['a.com'].accounts.push('0x2') })
        expect(setCalls).toHaveLength(1)
        expect(setCalls[0]).toEqual({ dapps: { 'a.com': { accounts: ['0x1', '0x2'] } } })
    })

    it('mutator firlatirsa YAZMA yok, hata yukari cikar ve sonraki cagri CALISIR', async () => {
        store.dapps = { 'a.com': { accounts: ['0x1'] } }
        await expect(updateDapps((d) => { d['a.com'].accounts = []; throw new Error('patladi') })).rejects.toThrow('patladi')
        expect(store.dapps['a.com'].accounts).toEqual(['0x1'])
        expect(setCalls).toHaveLength(0)

        await updateDapps((d) => { d['b.com'] = { accounts: [] } })
        expect(Object.keys(store.dapps).sort()).toEqual(['a.com', 'b.com'])
    })

    it('mutator fonksiyon degilse TypeError ile reddeder', async () => {
        await expect(updateDapps(undefined)).rejects.toThrow(TypeError)
        await expect(updateDapps('x')).rejects.toThrow(TypeError)
    })
})
