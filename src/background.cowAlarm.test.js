import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz } from './test-utils/kaynakTarama'
import { newOrderRecord } from './utils/cow/orders'

// ALARM TIKINDA BEKLEYEN CoW EMIRLERINI YOKLAMA (plan Task 18, spec 5.6 "Popup kapaliyken", K10).
//
// recoverTonFees ile AYNI kalip: `session_active` kontrolunun USTUNDE baslar (kilitli
// cuzdanda da calisir), BEKLENMEZ (kilit karari ag yuzunden gecikemez), `finally`'de
// beklenir. Bayraktan BAGIMSIZ: bekleyen kayit yoksa poller hic ag istegi atmaz.
//
// Iki bolum: (1) kaynak taramasi (yorumsuz kaynak, her sira iddiasinda VARLIK once),
// (2) calisma testi (background.lockAlarm.test.js harness'i).

// ---------------------------------------------------------------------------
// 1) Kaynak taramasi
// ---------------------------------------------------------------------------
const BG = yorumsuz(readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8'))

function blockAfter(src, marker, closer) {
    const start = src.indexOf(marker)
    if (start === -1) return null
    const end = src.indexOf(closer, start + marker.length)
    return end === -1 ? src.slice(start) : src.slice(start, end)
}

describe('background.js -- CoW alarm kablolamasi (kaynak)', () => {
    const alarm = () => blockAfter(BG, 'chrome.alarms.onAlarm.addListener', '\n})')

    it('pollCowOrders cagrisi onAlarm govdesinde, if (!session_active) satirinin USTUNDE', () => {
        const govde = alarm()
        expect(govde).not.toBeNull()
        const cagri = govde.indexOf('pollCowOrdersSafe(')
        const kapi = govde.indexOf('if (!session_active) return')
        // VARLIK once: eksik dize -1 doner ve -1 < N ile "once" gorunurdu.
        expect(cagri).toBeGreaterThan(-1)
        expect(kapi).toBeGreaterThan(-1)
        expect(cagri).toBeLessThan(kapi)
    })

    it('sarmalayici getCowRuntime().poller.pollCowOrders()i cagirir ve .catch( ile sessizlestirir', () => {
        const govde = blockAfter(BG, 'function pollCowOrdersSafe(', '\n}')
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/getCowRuntime\s*\(\s*\)\s*\.poller\s*\.pollCowOrders\s*\(/)
        expect(govde).toContain('.catch(')
    })

    it('alarm govdesinde pollCowOrders BEKLENMEZ (await yok), bayraga baglanmaz', () => {
        const govde = alarm()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/const\s+cowPolling\s*=\s*pollCowOrdersSafe\s*\(\s*\)/)
        expect(govde).not.toMatch(/await\s+pollCowOrders/)
        expect(govde).not.toMatch(/await\s+pollCowOrdersSafe/)
        expect(govde).not.toContain('XSTOCKS_ENABLED')
    })

    it('sira: cowPolling baslar < shouldLock < await cowPolling < await recovering', () => {
        const govde = alarm()
        expect(govde).not.toBeNull()
        const basla = govde.indexOf('const cowPolling')
        const kilit = govde.indexOf('shouldLock(')
        const cowBekle = govde.indexOf('await cowPolling')
        const tonBekle = govde.indexOf('await recovering')
        expect(basla).toBeGreaterThan(-1)
        expect(kilit).toBeGreaterThan(-1)
        expect(cowBekle).toBeGreaterThan(-1)
        expect(tonBekle).toBeGreaterThan(-1)
        expect(basla).toBeLessThan(kilit)      // yoklama ONCE baslar
        expect(kilit).toBeLessThan(cowBekle)   // kilit karari onu BEKLEMEDEN verilir
        expect(cowBekle).toBeLessThan(tonBekle)
    })
})

// ---------------------------------------------------------------------------
// 2) Calisma testi
// ---------------------------------------------------------------------------
const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const ALARM_NAME = 'checkInactivity'
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const UID = '0x' + 'ab'.repeat(56)

let localStore
let sessionStore
let listeners
let fetchSpy

function installChromeStub() {
    listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
    globalThis.chrome = {
        alarms: { get: vi.fn(async () => ({ name: ALARM_NAME })), create: vi.fn(), onAlarm: add('onAlarm') },
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
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => sessionStore),
                set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
                remove: vi.fn(async (k) => { delete sessionStore[k] }),
            },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            getCurrent: vi.fn(async () => ({ id: 1 })),
            onRemoved: { addListener: vi.fn() },
            remove: vi.fn(),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setPopup: vi.fn(async () => {}) },
    }
}

const bosalt = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }

const acikKayit = () => ({
    ...newOrderRecord({
        uid: UID,
        chainId: 1,
        owner: OWNER,
        side: 'sell',
        symbol: 'AAPLx',
        sellToken: '0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        buyAmount: '190000000',
        expectedBuy: '191000000',
        validTo: Math.floor(Date.now() / 1000) + 1800,
        createdAt: Date.now(),
        approvalMode: 'none',
        postBody: { signature: '0x' + 'aa'.repeat(65) },
    }),
    status: 'open',
})

async function dogur() {
    vi.resetModules()
    await import('./background.js')
    await bosalt()
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    // Bekleyen kayit + KILITLI cuzdan (session_active yok).
    localStore = { lock_timer: 15, lastActiveTime: Date.now(), vaults: [], dapps: {}, cow_orders: [acikKayit()] }
    installChromeStub()
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ uid: UID, status: 'open' }), { status: 200 }))
    globalThis.fetch = fetchSpy
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.doUnmock('./utils/cow/poller')
    delete globalThis.chrome
})

const tikle = async () => {
    const onAlarm = listeners.onAlarm[0]
    expect(onAlarm).toBeTypeOf('function')
    await onAlarm({ name: ALARM_NAME })
    await bosalt()
}

describe('background -- alarm tikinde CoW yoklamasi (calisma)', () => {
    it('bekleyen open kayit + KILITLI cuzdan: alarm CoW getOrder istegini atar', async () => {
        await dogur()
        expect(localStore.session_active).toBeUndefined()

        await tikle()

        const adresler = fetchSpy.mock.calls.map((c) => String(c[0]))
        expect(adresler.some((u) => u.includes(`/api/v1/orders/${UID}`))).toBe(true)
    })

    it('bekleyen kayit YOKSA fetch cagrisi 0', async () => {
        localStore.cow_orders = []
        await dogur()

        await tikle()

        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('XSTOCKS bayragi KAPALI derlemede de alarm tiki bekleyen kaydi isler (K10)', async () => {
        vi.stubEnv('VITE_XSTOCKS_ENABLED', 'false')
        await dogur()

        await tikle()

        const adresler = fetchSpy.mock.calls.map((c) => String(c[0]))
        expect(adresler.some((u) => u.includes(`/api/v1/orders/${UID}`))).toBe(true)
    })

    it('poller ASKIDA kalsa da lockWallet YINE de cagrilir (kilit karari beklenmez)', async () => {
        vi.doMock('./utils/cow/poller', async (orig) => ({
            ...(await orig()),
            createCowPoller: () => ({ pollCowOrders: () => new Promise(() => {}) }),
        }))
        localStore.session_active = true
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000
        await dogur()

        // Isleyici `finally`de askidaki yoklamayi bekleyecegi icin ASLA donmez:
        // await EDILMEZ, yalniz kilit kararinin verildigi dogrulanir.
        const isleyici = listeners.onAlarm[0]({ name: ALARM_NAME })
        isleyici.catch(() => {})
        await bosalt()

        expect(localStore.session_active).toBe(false)
        expect(sessionStore.sessionMasterKeyJwk).toBeUndefined()
    })

    it('poller REDDEDERSE alarm isleyicisi firlatmaz ve kilit karari verilir', async () => {
        vi.doMock('./utils/cow/poller', async (orig) => ({
            ...(await orig()),
            createCowPoller: () => ({ pollCowOrders: () => Promise.reject(new Error('boom')) }),
        }))
        localStore.session_active = true
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000
        await dogur()

        await expect(listeners.onAlarm[0]({ name: ALARM_NAME })).resolves.toBeUndefined()
        await bosalt()

        expect(localStore.session_active).toBe(false)
    })

    it('poller SENKRON firlatirsa da (calisma zamani kurulamadi) isleyici firlatmaz', async () => {
        vi.doMock('./utils/cow/poller', async (orig) => ({
            ...(await orig()),
            createCowPoller: () => { throw new Error('kurulamadi') },
        }))
        localStore.session_active = true
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000
        await dogur()

        await expect(listeners.onAlarm[0]({ name: ALARM_NAME })).resolves.toBeUndefined()
        await bosalt()

        expect(localStore.session_active).toBe(false)
    })

    it('chrome.storage.session YOKSA (eski stub) alarm yolu firlatmaz', async () => {
        delete globalThis.chrome.storage.session
        await dogur()

        await expect(listeners.onAlarm[0]({ name: ALARM_NAME })).resolves.toBeUndefined()
        await bosalt()

        expect(fetchSpy).toHaveBeenCalled()
    })

    it('baska adli alarm CoW yoklamasi baslatmaz', async () => {
        await dogur()

        await listeners.onAlarm[0]({ name: 'baskaBirAlarm' })
        await bosalt()

        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// 3) Faz 3 (plan Task 11): iade talebi + ucret tahsilati kancalari (kaynak)
// ---------------------------------------------------------------------------
describe('background.js -- Faz 3 alarm kablolamasi (kaynak)', () => {
    const alarm = () => blockAfter(BG, 'chrome.alarms.onAlarm.addListener', '\n})')
    const idx = (govde, dize) => {
        const i = govde.indexOf(dize)
        // VARLIK once: eksik dize -1 doner ve -1 < N ile "once" gorunurdu.
        expect(i, `${dize} bulunamadi`).toBeGreaterThan(-1)
        return i
    }

    it('claimRefundsSafe cowPolling un hemen altinda, session_active kapisinin USTUNDE, BEKLENMEDEN baslar', () => {
        const govde = alarm()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/const\s+refundClaiming\s*=\s*claimRefundsSafe\s*\(\s*\)/)
        expect(govde).not.toMatch(/await\s+claimRefunds/)
        const poll = idx(govde, 'const cowPolling')
        const claim = idx(govde, 'const refundClaiming')
        const kapi = idx(govde, 'if (!session_active) return')
        expect(poll).toBeLessThan(claim)
        expect(claim).toBeLessThan(kapi)
    })

    it('sira: shouldLock < await cowPolling < await refundClaiming < await recovering', () => {
        const govde = alarm()
        const kilit = idx(govde, 'shouldLock(')
        const poll = idx(govde, 'await cowPolling')
        const claim = idx(govde, 'await refundClaiming')
        const ton = idx(govde, 'await recovering')
        expect(kilit).toBeLessThan(poll)
        expect(poll).toBeLessThan(claim)
        expect(claim).toBeLessThan(ton)
    })

    it('settleCowFeesSafe YALNIZ shouldLock dalinin else kolunda, lockWallet un ardindan; finally de beklenir', () => {
        const govde = alarm()
        expect(govde).toMatch(/let\s+feeSettling\s*=\s*Promise\.resolve\s*\(\s*\)/)
        const bildirim = idx(govde, 'let feeSettling')
        const tryAt = idx(govde, 'try {')
        expect(bildirim).toBeLessThan(tryAt)
        const kilit = idx(govde, 'if (shouldLock(lock_timer, lastActiveTime)) {')
        const dal = govde.slice(kilit)
        expect(dal).toMatch(/await lockWallet\(\)\s*\}\s*else\s*\{\s*feeSettling\s*=\s*settleCowFeesSafe\s*\(\s*\)\s*\}/)
        // settleCowFeesSafe alarm govdesinde TEK kez ve await edilmeden cagrilir.
        expect(govde.split('settleCowFeesSafe(').length - 1).toBe(1)
        expect(idx(govde, 'await feeSettling')).toBeGreaterThan(idx(govde, 'finally'))
    })

    it('claimRefundsSafe kasa/hesap/bayrak OKUMAZ, claimer.claimRefunds i cagirip .catch( ile sessizlestirir', () => {
        const govde = blockAfter(BG, 'function claimRefundsSafe(', '\n}')
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/getCowRuntime\s*\(\s*\)\s*\.fee\s*\.claimer\s*\.claimRefunds\s*\(/)
        expect(govde).toContain('.catch(')
        expect(govde).not.toContain('XSTOCKS')
        expect(govde).not.toContain('cowActiveAccount')
        expect(govde).not.toContain('storage')
        expect(govde).not.toContain('isUnlocked')
    })

    it('unlockWalletSession session_active:true yazdiktan SONRA settleCowFeesSafe i BEKLEMEDEN cagirir', () => {
        const govde = blockAfter(BG, 'async function unlockWalletSession(', '\n}')
        expect(govde).not.toBeNull()
        const yaz = idx(govde, 'await chrome.storage.local.set({ session_active: true })')
        const tetik = idx(govde, 'settleCowFeesSafe()')
        expect(yaz).toBeLessThan(tetik)
        expect(govde).not.toMatch(/await\s+settleCowFeesSafe/)
    })

    it('settleCowFeesSafe bayragi denetler, kuyruga iter, 30 sn bayatligi ve tek is kuralini uygular', () => {
        const govde = blockAfter(BG, 'function settleCowFeesSafe(', '\n}\n')
        expect(govde).not.toBeNull()
        expect(govde).toContain('XSTOCKS_ATS_FEE_ENABLED')
        expect(govde).toContain('cowActiveAccount()')
        expect(govde).toContain('transactionQueue.push(')
        expect(govde).toContain('processQueue()')
        expect(govde).toContain('FEE_SETTLE_QUEUE_WAIT_MS')
        expect(govde).toContain('cowSignerFor(account)')
    })
})

// ---------------------------------------------------------------------------
// 4) Faz 3: calisma testi -- sira ve kilit guvenligi
// ---------------------------------------------------------------------------
const fee = { claimRefunds: vi.fn(), settleCowFees: vi.fn() }
const HESAP = { key: 'k1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0", address: OWNER }

async function dogurFee() {
    vi.doMock('./utils/cow/feeRuntime', async (orig) => ({
        ...(await orig()),
        createFeeRuntime: () => ({
            settler: { settleCowFees: fee.settleCowFees, approveFeeChange: vi.fn() },
            claimer: { claimRefunds: fee.claimRefunds },
            statusFor: vi.fn(),
        }),
    }))
    await dogur()
}

describe('background -- alarm tikinde iade talebi ve ucret tahsilati (calisma)', () => {
    beforeEach(() => {
        fee.claimRefunds.mockReset()
        fee.settleCowFees.mockReset()
        fee.claimRefunds.mockResolvedValue({ tried: 0 })
        fee.settleCowFees.mockResolvedValue({ outcome: 'NONE' })
        localStore.cow_orders = []
        localStore.active_account = HESAP
    })
    afterEach(() => {
        vi.doUnmock('./utils/cow/feeRuntime')
    })

    it('KILITLI cuzdan: claimRefunds cagrilir, settleCowFees CAGRILMAZ', async () => {
        await dogurFee()
        expect(localStore.session_active).toBeUndefined()

        await tikle()

        expect(fee.claimRefunds).toHaveBeenCalledTimes(1)
        expect(fee.settleCowFees).not.toHaveBeenCalled()
    })

    it('ACIK cuzdan ve kilit GEREKIYOR: lockWallet cagrilir, settleCowFees CAGRILMAZ, claimRefunds cagrilir', async () => {
        localStore.session_active = true
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000
        await dogurFee()

        await tikle()

        expect(localStore.session_active).toBe(false)
        expect(fee.settleCowFees).not.toHaveBeenCalled()
        expect(fee.claimRefunds).toHaveBeenCalledTimes(1)
    })

    it('ACIK cuzdan ve kilit GEREKMIYOR: ikisi de cagrilir (aktif hesap + flagOn:true)', async () => {
        localStore.session_active = true
        localStore.lock_timer = 15
        localStore.lastActiveTime = Date.now()
        await dogurFee()

        await tikle()

        expect(localStore.session_active).toBe(true)
        expect(fee.claimRefunds).toHaveBeenCalledTimes(1)
        expect(fee.settleCowFees).toHaveBeenCalledTimes(1)
        const arg = fee.settleCowFees.mock.calls[0][0]
        expect(arg.owner).toBe(OWNER)
        expect(arg.flagOn).toBe(true)
        expect(arg.getSigner).toBeTypeOf('function')
    })

    it('ucret bayragi KAPALI: acik cuzdanda claimRefunds yine cagrilir, settleCowFees cagrilmaz', async () => {
        vi.stubEnv('VITE_XSTOCKS_ATS_FEE_ENABLED', 'false')
        localStore.session_active = true
        localStore.lock_timer = 15
        localStore.lastActiveTime = Date.now()
        await dogurFee()

        await tikle()

        expect(fee.claimRefunds).toHaveBeenCalledTimes(1)
        expect(fee.settleCowFees).not.toHaveBeenCalled()
    })

    it('Review Focus (kilit guvenligi): claimRefunds HIC cozulmese de lockWallet cagrilir', async () => {
        fee.claimRefunds.mockImplementation(() => new Promise(() => {}))
        localStore.session_active = true
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000
        await dogurFee()

        // Isleyici `finally`de askidaki soz yuzunden donmez: await EDILMEZ, kilit karari dogrulanir.
        const isleyici = listeners.onAlarm[0]({ name: ALARM_NAME })
        isleyici.catch(() => {})
        await bosalt()

        expect(fee.claimRefunds).toHaveBeenCalledTimes(1)
        expect(localStore.session_active).toBe(false)
        expect(sessionStore.sessionMasterKeyJwk).toBeUndefined()
        expect(fee.settleCowFees).not.toHaveBeenCalled()
    })

    it('claimRefunds REDDEDERSE isleyici firlatmaz ve kilit karari verilir', async () => {
        fee.claimRefunds.mockRejectedValue(new Error('boom'))
        localStore.session_active = true
        localStore.lock_timer = 1
        localStore.lastActiveTime = Date.now() - 5 * 60 * 1000
        await dogurFee()

        await expect(listeners.onAlarm[0]({ name: ALARM_NAME })).resolves.toBeUndefined()
        await bosalt()

        expect(localStore.session_active).toBe(false)
    })
})
