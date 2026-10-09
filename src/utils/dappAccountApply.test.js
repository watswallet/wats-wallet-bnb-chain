// applyAccountSwitchToDapps: hesap degisiminin tek giris noktasi (spec 6 G4 f).
// GERCEK dappsStore.updateDapps + sahte chrome.storage + sahte kilit kullanilir;
// yani "yalniz degisen kayit yazilir/bildirilir" ve "ikinci teslim zararsiz"
// kurallari uctan uca olculur.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyAccountSwitchToDapps, collectOpenHostnames, resetAccountSwitchMemory, ACCOUNT_REVOKED_ERROR } from './dappAccountApply.js'
import { updateDapps } from './dappsStore.js'

const A = '0xAaaa000000000000000000000000000000000001'
const B = '0xBbbb000000000000000000000000000000000002'
const C = '0xCccc000000000000000000000000000000000003'
const TON = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'

let store
let setCalls

function installChrome(initial) {
    store = JSON.parse(JSON.stringify(initial))
    setCalls = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (key) => (key in store ? { [key]: JSON.parse(JSON.stringify(store[key])) } : {}),
                set: async (obj) => {
                    setCalls.push(obj)
                    for (const [k, v] of Object.entries(obj)) store[k] = JSON.parse(JSON.stringify(v))
                },
            },
        },
    }
}

beforeEach(() => {
    resetAccountSwitchMemory()
    const tails = new Map()
    vi.stubGlobal('navigator', {
        locks: {
            request: (name, callback) => {
                const run = (tails.get(name) || Promise.resolve()).then(() => callback({ name }))
                tails.set(name, run.catch(() => {}))
                return run
            },
        },
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
    vi.restoreAllMocks()
})

const VAULTS = [{ fingerprint: 'f1', accounts: [{ key: 'k1', address: A }, { key: 'k2', address: B }, { key: 'k3', address: C }] }]

function makeDeps(open = ['site.com'], extra = {}) {
    return {
        updateDapps,
        notifyDappHostnames: vi.fn(async () => {}),
        getOpenHostnames: vi.fn(async () => new Set(open)),
        rejectPendingForOrigin: vi.fn(async () => 0),
        now: () => 777,
        ...extra,
    }
}

describe('applyAccountSwitchToDapps -- takip eden site', () => {
    it('[previous] kaydi [next] olur, bildirilir, yazilir, bekleyen onaylar 4100 ile reddedilir', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A], origin: 'https://site.com', chainId: '0x1' } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(sonuc).toEqual({ changed: true, notified: ['site.com'] })
        expect(store.dapps['site.com']).toEqual({ accounts: [B], origin: 'https://site.com', chainId: '0x1', followedAt: 777 })
        expect(deps.notifyDappHostnames).toHaveBeenCalledTimes(1)
        expect(deps.notifyDappHostnames).toHaveBeenCalledWith(['site.com'], 'accountsChanged', [B])
        expect(deps.rejectPendingForOrigin).toHaveBeenCalledWith('https://site.com', ACCOUNT_REVOKED_ERROR)
        expect(ACCOUNT_REVOKED_ERROR.code).toBe(4100)
    })

    it('ONCE yaz SONRA bildir: bildirim aninda disk zaten yenidir', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        let bildirimdekiDisk
        const deps = makeDeps(['site.com'], {
            notifyDappHostnames: vi.fn(async () => { bildirimdekiDisk = JSON.parse(JSON.stringify(store.dapps)) }),
        })

        await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(bildirimdekiDisk['site.com'].accounts).toEqual([B])
    })

    it('eski kayitta origin yoksa bekleyen istekler https://hostname icin reddedilir', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()
        await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(deps.rejectPendingForOrigin).toHaveBeenCalledWith('https://site.com', ACCOUNT_REVOKED_ERROR)
    })
})

describe('applyAccountSwitchToDapps -- takip etmeyen ve uyuyan siteler', () => {
    it('uyuyan (sekmesi acik olmayan) siteye dokunulmaz, bildirilmez', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'uyuyan.com': { accounts: [A] } } })
        const deps = makeDeps(['baska.com'])

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(sonuc).toEqual({ changed: false, notified: [] })
        expect(store.dapps['uyuyan.com'].accounts).toEqual([A])
        expect(setCalls).toHaveLength(0)
        expect(deps.notifyDappHostnames).not.toHaveBeenCalled()
    })

    it('followActive false ve next izinli degil: yazma YOK, bildirim YOK (sizinti yok)', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A], followActive: false } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(sonuc).toEqual({ changed: false, notified: [] })
        expect(setCalls).toHaveLength(0)
        expect(deps.notifyDappHostnames).not.toHaveBeenCalled()
        expect(deps.rejectPendingForOrigin).not.toHaveBeenCalled()
    })

    it('cok hesapli, takip etmeyen site: aktif basa alinir, bildirilir, onaylar REDDEDILMEZ', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A, B], followActive: false } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(sonuc).toEqual({ changed: true, notified: ['site.com'] })
        expect(store.dapps['site.com'].accounts).toEqual([B, A])
        expect(deps.notifyDappHostnames).toHaveBeenCalledWith(['site.com'], 'accountsChanged', [B, A])
        expect(deps.rejectPendingForOrigin).not.toHaveBeenCalled()
    })
})

describe('applyAccountSwitchToDapps -- tek-seferlik / idempotans', () => {
    it('saklanan sira zaten yeni sira ([B,A], previous A): YAZMA yok ama dapp bayat gordugu icin BILDIRILIR; ayni olayin ikinci teslimi bildirmez', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [B, A], followActive: false } } })
        const deps = makeDeps()

        const ilk = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(ilk).toEqual({ changed: false, notified: ['site.com'] })
        expect(setCalls).toHaveLength(0)
        expect(deps.notifyDappHostnames).toHaveBeenCalledWith(['site.com'], 'accountsChanged', [B, A])

        const ikinci = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(ikinci).toEqual({ changed: false, notified: [] })
        expect(deps.notifyDappHostnames).toHaveBeenCalledTimes(1)
    })

    it('AYNI cagri ikinci kez gelirse yazmaz, bildirmez', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] }, 'cok.com': { accounts: [A, B], followActive: false } } })
        const deps = makeDeps(['site.com', 'cok.com'])

        const ilk = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(ilk.changed).toBe(true)
        const yazimSayisi = setCalls.length
        const bildirimSayisi = deps.notifyDappHostnames.mock.calls.length

        const ikinci = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(ikinci).toEqual({ changed: false, notified: [] })
        expect(setCalls).toHaveLength(yazimSayisi)
        expect(deps.notifyDappHostnames).toHaveBeenCalledTimes(bildirimSayisi)
    })

    it('previous == next (yeniden adlandirma): sekmelere ve depoya HIC bakilmaz', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: A.toLowerCase() }, deps)

        expect(sonuc).toEqual({ changed: false, notified: [] })
        expect(deps.getOpenHostnames).not.toHaveBeenCalled()
        expect(setCalls).toHaveLength(0)
    })

    it('plan KILIT ALTINDA o anki kayitlardan hesaplanir (arada eklenen kayit da islenir)', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps(['site.com', 'gec.com'], {
            // getOpenHostnames ile updateDapps ARASINDA baska bir baglam kayit yazdi.
            getOpenHostnames: vi.fn(async () => {
                store.dapps['gec.com'] = { accounts: [A] }
                return new Set(['site.com', 'gec.com'])
            }),
        })

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(store.dapps['gec.com'].accounts).toEqual([B])
        expect(sonuc.notified.sort()).toEqual(['gec.com', 'site.com'])
    })

    it('farkli yuklu siteler icin grup basina bir bildirim', async () => {
        installChrome({
            vaults: VAULTS,
            dapps: {
                'bir.com': { accounts: [A] },
                'iki.com': { accounts: [A] },
                'cok.com': { accounts: [A, B], followActive: false },
            },
        })
        const deps = makeDeps(['bir.com', 'iki.com', 'cok.com'])

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(deps.notifyDappHostnames.mock.calls).toEqual([
            [['bir.com', 'iki.com'], 'accountsChanged', [B]],
            [['cok.com'], 'accountsChanged', [B, A]],
        ])
        expect(sonuc.notified).toEqual(['bir.com', 'iki.com', 'cok.com'])
    })
})

describe('applyAccountSwitchToDapps -- EVM adresi olmayan hesap', () => {
    it('EVM -> TON: kayit degismez, acik bagli siteye accountsChanged([])', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: TON }, deps)

        expect(sonuc).toEqual({ changed: false, notified: ['site.com'] })
        expect(store.dapps['site.com'].accounts).toEqual([A])
        expect(setCalls).toHaveLength(0)
        expect(deps.notifyDappHostnames).toHaveBeenCalledWith(['site.com'], 'accountsChanged', [])
        expect(deps.rejectPendingForOrigin).not.toHaveBeenCalled()
    })

    it('TON -> EVM donusu: [next] izinli site yazma olmadan accountsChanged([next]) alir', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: TON, nextAddress: A }, deps)

        expect(sonuc).toEqual({ changed: false, notified: ['site.com'] })
        expect(deps.notifyDappHostnames).toHaveBeenCalledWith(['site.com'], 'accountsChanged', [A])
    })
})

describe('applyAccountSwitchToDapps -- giris dogrulama', () => {
    it('yeni EVM adresi KASADA degilse hicbir sey yapilmaz', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: '0xDddd000000000000000000000000000000000004' }, deps)

        expect(sonuc).toEqual({ changed: false, notified: [] })
        expect(setCalls).toHaveLength(0)
        expect(deps.notifyDappHostnames).not.toHaveBeenCalled()
    })

    it('kasa yoksa (vaults eksik) fail-closed: hicbir sey yapilmaz', async () => {
        installChrome({ dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()
        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(sonuc).toEqual({ changed: false, notified: [] })
    })

    it('enjekte edilen isVaultAddress kullanilir', async () => {
        installChrome({ dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps(['site.com'], { isVaultAddress: async (adres) => adres === B })
        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(sonuc.changed).toBe(true)
    })

    it('previous ya da next eksikse hicbir sey yapilmaz', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        const deps = makeDeps()
        for (const args of [{}, { previousAddress: A }, { nextAddress: B }, { previousAddress: '', nextAddress: B }, undefined]) {
            expect(await applyAccountSwitchToDapps(args, deps)).toEqual({ changed: false, notified: [] })
        }
        expect(deps.getOpenHostnames).not.toHaveBeenCalled()
    })
})

describe('applyAccountSwitchToDapps -- hata dayanikliligi', () => {
    it('updateDapps firlatirsa bildirim YOK, sonuc bos, hata yukari CIKMAZ', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const deps = makeDeps(['site.com'], { updateDapps: async () => { throw new Error('depo yazilamadi') } })

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(sonuc).toEqual({ changed: false, notified: [] })
        expect(deps.notifyDappHostnames).not.toHaveBeenCalled()
    })

    it('getOpenHostnames firlatirsa sonuc bos, hata yukari CIKMAZ', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const deps = makeDeps(['site.com'], { getOpenHostnames: async () => { throw new Error('sekme okunamadi') } })
        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(sonuc).toEqual({ changed: false, notified: [] })
    })

    it('bildirim basarisiz olursa diger gruplar ve onay reddi YINE calisir', async () => {
        installChrome({
            vaults: VAULTS,
            dapps: { 'bir.com': { accounts: [A], origin: 'https://bir.com' }, 'cok.com': { accounts: [A, B], followActive: false } },
        })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const deps = makeDeps(['bir.com', 'cok.com'], {
            notifyDappHostnames: vi.fn(async (hostnames) => { if (hostnames[0] === 'bir.com') throw new Error('sekme yok') }),
        })

        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)

        expect(deps.notifyDappHostnames).toHaveBeenCalledTimes(2)
        expect(sonuc.notified).toEqual(['cok.com'])
        expect(deps.rejectPendingForOrigin).toHaveBeenCalledWith('https://bir.com', ACCOUNT_REVOKED_ERROR)
        expect(sonuc.changed).toBe(true)
    })

    it('rejectPendingForOrigin firlatirsa sonuc yine dondurulur', async () => {
        installChrome({ vaults: VAULTS, dapps: { 'site.com': { accounts: [A] } } })
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const deps = makeDeps(['site.com'], { rejectPendingForOrigin: async () => { throw new Error('pencere yok') } })
        const sonuc = await applyAccountSwitchToDapps({ previousAddress: A, nextAddress: B }, deps)
        expect(sonuc).toEqual({ changed: true, notified: ['site.com'] })
    })
})

describe('collectOpenHostnames', () => {
    it('sekme adreslerinden hostname kumesi cikarir', () => {
        const kume = collectOpenHostnames([
            { url: 'https://app.x.io/path?q=1' },
            { url: 'http://localhost:5173/' },
            { url: 'https://app.x.io/baska' },
        ])
        expect([...kume].sort()).toEqual(['app.x.io', 'localhost'])
    })
    it('adressiz, bozuk ve hostname i olmayan sekmeler atlanir; dizi degilse bos', () => {
        expect(collectOpenHostnames([{}, { url: 'bozuk' }, { url: 'about:blank' }, null, undefined]).size).toBe(0)
        expect(collectOpenHostnames(undefined).size).toBe(0)
    })
})
