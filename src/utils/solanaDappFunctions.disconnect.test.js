import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGIN = 'https://app.jup.ag'
const OTEKI = 'https://raydium.io'
const SENDER = { origin: ORIGIN, url: ORIGIN + '/swap', tab: { id: 9 } }
const ADDR = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const SESSION = { address: ADDR, publicKey: 'ee'.repeat(32), accountKey: 'k1', cluster: 'solana:mainnet', appMeta: null, connectedAt: 1 }

vi.mock('./solana/derive', () => ({ deriveSolanaAddress: vi.fn(), deriveSolanaKeypair: vi.fn() }))
vi.mock('./crypto-utils', () => ({ unlockVault: vi.fn(), decryptSecret: vi.fn() }))

function kurChrome(local = {}, tabs = [{ id: 1 }, { id: 2 }]) {
    const store = { ...local }
    const gonderilen = []
    const yazimlar = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { yazimlar.push(obj); Object.assign(store, obj) },
                remove: async (k) => { delete store[k] },
            },
            session: { get: async () => ({}) },
        },
        tabs: {
            query: async () => tabs,
            sendMessage: async (tabId, msg) => { gonderilen.push({ tabId, msg }) },
        },
        windows: { create: async () => ({ id: 1 }), remove: async () => {}, get: async () => ({}), getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }), onRemoved: { addListener: () => {} } },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, gonderilen, yazimlar }
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
afterEach(() => { delete globalThis.chrome })

describe('notifySolanaDapp', () => {
    it('TUM sekmelere frameId VERMEDEN yollar -- iframe suzgeci sayfada calisir', async () => {
        const { gonderilen } = kurChrome({})
        const { notifySolanaDapp } = await import('./solanaDappFunctions.js')
        await notifySolanaDapp(ORIGIN, { event: 'change', payload: { accounts: [] } })
        expect(gonderilen.map((g) => g.tabId)).toEqual([1, 2])
        // Yuk sekli notifyTonDapp'in AYNISI ama alan `hostname` DEGIL `origin`:
        // yetki kaynagi TAM ORIGIN'dir (K5) ve content.js suzgeci de origin ile
        // karsilastirir. `hostname` gonderilseydi http:// serit de eslesirdi.
        expect(gonderilen[0].msg).toEqual({
            target: 'wats_solana_inpage',
            origin: ORIGIN,
            event: { event: 'change', payload: { accounts: [] } },
        })
    })

    it('id siz sekmeler atlanir, tek bir sekmenin hatasi digerlerini kesmez', async () => {
        const { gonderilen } = kurChrome({}, [{ id: undefined }, { id: 5 }])
        globalThis.chrome.tabs.sendMessage = async (tabId, msg) => {
            gonderilen.push({ tabId, msg })
            throw new Error('Receiving end does not exist')
        }
        const { notifySolanaDapp } = await import('./solanaDappFunctions.js')
        await expect(notifySolanaDapp(ORIGIN, { event: 'change', payload: { accounts: [] } })).resolves.toBeUndefined()
        expect(gonderilen.map((g) => g.tabId)).toEqual([5])
    })
})

describe('handleSolanaDisconnect — sayfadan gelen kesme', () => {
    async function kes(kur) {
        const { handleSolanaDisconnect } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDisconnect({ method: 'solana_disconnect' }, SENDER, (r) => yanitlar.push(r))
        return { yanitlar, ...kur }
    }

    it('oturumu siler ve bos nesne doner', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: SESSION } })
        const { yanitlar, store } = await kes(kur)
        expect(yanitlar[0]).toEqual({ result: {} })
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
        // BASKA origin'in oturumuna DOKUNULMAZ.
        expect(store.solana_dapps[OTEKI]).toEqual(SESSION)
    })

    // KAYIP GUNCELLEME KORUMASI: kayit YOKKEN butun haritayi geri yazmak, TAM O
    // ANDA onay ekranindan inen bir putSolanaSession'i EZERDI (kullanici baska bir
    // sekmede tam o sirada baglaniyorken). Yaziya hic GEREK yoksa yazma.
    it('oturum YOKSA 4100 doner ve depoya HIC YAZILMAZ', async () => {
        const kur = kurChrome({ solana_dapps: { [OTEKI]: SESSION } })
        const { yanitlar, yazimlar } = await kes(kur)
        expect(yanitlar[0].error.code).toBe(4100)
        expect(yazimlar).toEqual([])
    })
})

describe('handleDisconnectSolanaDapp — ayarlar ekranindan kesme', () => {
    async function kes(origin, kur) {
        const { handleDisconnectSolanaDapp } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleDisconnectSolanaDapp({ type: 'DISCONNECT_SOLANA_DAPP', origin }, { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        return { yanitlar, ...kur }
    }

    it('kaydi siler ve dapp e change -> accounts:[] gonderir', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        const { yanitlar, store, gonderilen } = await kes(ORIGIN, kur)
        expect(yanitlar[0]).toEqual({ success: true })
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
        expect(gonderilen[0].msg.event).toEqual({ event: 'change', payload: { accounts: [] } })
    })

    // Bildirim IDEMPOTENT: oturum onceden yoksa da zararsizdir. Ama YAZIM
    // yapilmamalidir (kayip guncelleme).
    it('kayit yoksa depoya yazilmaz ama bildirim yine gider', async () => {
        const kur = kurChrome({ solana_dapps: {} })
        const { yanitlar, yazimlar, gonderilen } = await kes(ORIGIN, kur)
        expect(yanitlar[0]).toEqual({ success: true })
        expect(yazimlar).toEqual([])
        expect(gonderilen.length).toBe(2)
    })
})

describe('disconnectOrphanedSolanaSessions', () => {
    it('hesabi artik olmayan oturumlari siler ve haber verir', async () => {
        const kur = kurChrome({
            solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: { ...SESSION, accountKey: 'silinmis' } },
        })
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([{ id: 'v1', accounts: [{ key: 'k1' }] }])
        expect(kur.store.solana_dapps[ORIGIN]).toEqual(SESSION)
        expect(kur.store.solana_dapps[OTEKI]).toBeUndefined()
        expect(kur.gonderilen.map((g) => g.msg.origin)).toEqual([OTEKI, OTEKI])
    })

    // "bilmiyorum" ile "hicbir hesap yok" AYNI SEY DEGIL: ikincisini varsaymak
    // kullanicinin butun dapp baglantilarini GERI ALINAMAZ sekilde silerdi.
    it('hesap anahtari cozulemezse HICBIR SEY silinmez', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([])
        expect(kur.store.solana_dapps[ORIGIN]).toEqual(SESSION)
        expect(kur.yazimlar).toEqual([])
        expect(kur.gonderilen).toEqual([])
    })
})
