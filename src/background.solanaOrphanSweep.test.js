import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Yetim Solana oturumlarinin SUPURULMESI -- tetikleyiciler (spec 4.3).
 *
 * IKI AYRI YOL, IKI AYRI TEST TEKNIGI:
 *
 *  - `chrome.storage.onChanged` yolu DAVRANISLA olculur (asagidaki describe):
 *    dinleyiciyi cagirip depoda gercekten silinip silinmedigine bakariz.
 *  - `onStartup` yolu KAYNAK METNINDEN kilitlenir: o dinleyiciyi cagirmak
 *    cleanupLegacyStorage / repairRpcFormat / checkAndRecoverPendingTxs /
 *    recoverTonFees zincirinin TAMAMINI da calistirir ve bu testi ILGISIZ
 *    baska bir dalin kirilganligina baglardi. Kardes yol (tonFeeBackgroundWiring
 *    "onStartup ve onInstalled dallarinda da cagriliyor") ayni tekniktedir.
 */

const BG_RAW = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')
// YORUM TUZAGI: naif bir toContain, aranani yalnizca bir ACIKLAMA YORUMUNDA
// tasiyan dosyada da yesil kalir. Iddialar yorumlari SIYRILMIS metinde calisir.
const BG = BG_RAW.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n')

function blockAfter(src, marker, closer) {
    const start = src.indexOf(marker)
    if (start === -1) return null
    const end = src.indexOf(closer, start + marker.length)
    return end === -1 ? src.slice(start) : src.slice(start, end)
}

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let localStore
let sentTabMessages
let listeners

const YETIM = {
    address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
    publicKey: '5f0e1a', accountKey: 'silinmis-hesap', cluster: 'solana:mainnet',
    appMeta: { name: 'Jupiter', icon: null }, connectedAt: 1756700000,
}
const SAGLAM = {
    address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    publicKey: 'c31d02', accountKey: 'acc-1', cluster: 'solana:mainnet',
    appMeta: { name: 'Tensor', icon: null }, connectedAt: 1756700001,
}
const VAULTS = [{ id: 'v1', accounts: [{ key: 'acc-1' }] }]

function installChromeStub() {
    listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onChanged: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
    sentTabMessages = []

    globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
            onConnect: add('onConnect'),
            onStartup: add('onStartup'),
            onInstalled: add('onInstalled'),
            onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()),
            lastError: null,
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = keys === undefined ? Object.keys(localStore)
                        : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => ({ sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })),
                set: vi.fn(async () => {}),
                remove: vi.fn(async () => {}),
            },
            onChanged: add('onChanged'),
        },
        tabs: {
            query: vi.fn(async () => [{ id: 7, url: 'https://herhangi-bir-sekme.example/' }]),
            sendMessage: vi.fn((tabId, msg) => { sentTabMessages.push({ tabId, msg }); return Promise.resolve() }),
            create: vi.fn(),
        },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
}

// Dinleyici sozu BEKLENMEDEN cagriliyor (storage.onChanged senkron bir API);
// mikro gorevlerin bosalmasi icin bir tur beklenir.
const tikBekle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStore = {
        vaults: VAULTS,
        solana_dapps: { 'https://jup.ag': YETIM, 'https://tensor.trade': SAGLAM },
    }
    installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
})

describe('yetim Solana oturumlari -- storage.onChanged tetikleyicisi', () => {
    it('dinleyici KAYITLI', () => {
        expect(listeners.onChanged.length).toBeGreaterThan(0)
    })

    it('vaults degisince yetim origin SILINIR, saglam oturum KALIR', async () => {
        await listeners.onChanged[0]({ vaults: { newValue: VAULTS } }, 'local')
        await tikBekle()

        expect(localStore.solana_dapps['https://jup.ag']).toBeUndefined()
        expect(localStore.solana_dapps['https://tensor.trade']).toEqual(SAGLAM)
    })

    it('silinen oturumun dapp ine HABER verilir, saglam origin HABER ALMAZ', async () => {
        await listeners.onChanged[0]({ vaults: { newValue: VAULTS } }, 'local')
        await tikBekle()

        // .find yalnizca ILK mesaji kontrol eder: saglam origin'e de (yanlislikla)
        // bildirim gonderen bir mutant, listede jup.ag'den ONCE gelirse bu testi
        // yanlis-yesil tutardi. Tum `wats_solana_inpage` hedefli mesajlarin origin
        // KUMESI (sirasiyla) tek yetim ile SINIRLI olmali.
        const solana = sentTabMessages.filter((m) => m.msg.target === 'wats_solana_inpage')
        expect(solana.map((m) => m.msg.origin)).toEqual(['https://jup.ag'])
        expect(solana[0].msg.event).toEqual({ event: 'change', payload: { accounts: [] } })
    })

    // `vaults` DISINDAKI her yazim (ki bu depoda saniyede birkac tane olur:
    // current_transactions, prices, current_request...) supurgeyi tetiklerse
    // her yazimda solana_dapps + vaults okunur -- gereksiz ve gurultulu.
    it('vaults DISINDA bir anahtar degisirse supurge CALISMAZ', async () => {
        await listeners.onChanged[0]({ dapps: { newValue: {} } }, 'local')
        await tikBekle()

        expect(localStore.solana_dapps['https://jup.ag']).toEqual(YETIM)
    })

    it('local DISINDA bir alan (session/sync) degisirse supurge CALISMAZ', async () => {
        await listeners.onChanged[0]({ vaults: { newValue: VAULTS } }, 'session')
        await tikBekle()

        expect(localStore.solana_dapps['https://jup.ag']).toEqual(YETIM)
    })

    // K2 (controller karari): `vaults` anahtari degisiklik nesnesinde VAR ama
    // `newValue` UNDEFINED -- yani anahtar SILINDI (yedekten geri yukleme /
    // migration arasi bir an, ya da ileride bir "tum hesaplari sifirla" akisi).
    // sweepOrphanedSolanaSessions degisiklik nesnesine degil `chrome.storage
    // .local.get('vaults')` cagrisinin SONUCUNA bakar; bu cagri localStore'da
    // vaults YOKSA `undefined` doner ve fonksiyon bunu `[]`e katlar (varsayilan
    // parametre / destructuring default). disconnectOrphanedSolanaSessions([])
    // -> orphanSolanaOrigins FAIL-OPEN (accountKeys bos -> []) -> HICBIR SEY
    // silinmez, hata firlatilmaz. Bu test supurgenin YINE DE TETIKLENDIGINI
    // (get('vaults') cagrisi ile) ve FAIL-OPEN oldugunu (depo degismedi) birlikte
    // kanitlar.
    it('vaults anahtari SILINMISSE (newValue undefined) supurge yine CALISIR ama FAIL-OPEN kalir', async () => {
        delete localStore.vaults

        await listeners.onChanged[0]({ vaults: { oldValue: VAULTS, newValue: undefined } }, 'local')
        await tikBekle()

        expect(chrome.storage.local.get).toHaveBeenCalledWith('vaults')
        expect(localStore.solana_dapps['https://jup.ag']).toEqual(YETIM)
        expect(localStore.solana_dapps['https://tensor.trade']).toEqual(SAGLAM)
    })
})

describe('yetim Solana oturumlari -- onStartup teli (kaynak metni)', () => {
    it('disconnectOrphanedSolanaSessions IMPORT ediliyor', () => {
        expect(BG).toContain("from './utils/solanaDappFunctions'")
        expect(BG).toContain('disconnectOrphanedSolanaSessions')
    })

    it('sweepOrphanedSolanaSessions vaults i OKUYUP fonksiyona GECIRIYOR', () => {
        const body = blockAfter(BG, 'async function sweepOrphanedSolanaSessions(', '\n}')
        expect(body).not.toBeNull()
        // `vaults` gecirilmezse fonksiyon bos liste gorur ve orphanSolanaOrigins
        // FAIL-OPEN oldugu icin SESSIZCE hicbir sey yapmaz.
        expect(body).toContain("get('vaults')")
        expect(body).toContain('disconnectOrphanedSolanaSessions(vaults)')
    })

    it('onStartup dalinda AWAIT ile ve recoverTonFees SONRASINDA CAGRILIYOR', () => {
        const startup = blockAfter(BG, 'chrome.runtime.onStartup.addListener', '\n})')
        expect(startup).not.toBeNull()
        // `await` pini: pinlenmezse awaitsiz bir cagri (sweep tamamlanmadan
        // onStartup donebilir -- yetimler bir sonraki tetikleyiciye kadar
        // kalir) sessizce gecerdi. Sira pini (recoverTonFees SONRASI): sweep
        // ondan ONCE tasinirsa TON kur/ucret kurtarma zincirinin davranissal
        // olmayan bir yeniden siralamasi bu testi kirmadan geciverirdi.
        expect(startup).toMatch(/await sweepOrphanedSolanaSessions\(\)/)
        expect(startup).toMatch(/await recoverTonFees\(\)[\s\S]*await sweepOrphanedSolanaSessions\(\)/)
    })

    // Ciplak bir `chrome.storage.onChanged.addListener` modul kapsaminda calisir
    // ve `onChanged` TANIMLAMAYAN yedi mevcut arka plan kosum takiminin HEPSINDE
    // TypeError atarak background.js'i import eden her testi kirar.
    it('storage.onChanged kaydi OPSIYONEL cagriyla yapiliyor', () => {
        expect(BG).toMatch(/chrome\.storage\.onChanged\?\.addListener\?\.\(/)
    })
})
