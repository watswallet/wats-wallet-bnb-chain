// EVM dapp PROTOKOL uyumluluk harness'i (evmDappProtocolConformance.test.js icin).
//
// NEDEN BU DOSYA VAR: bu ozellikte her sinir iki taraftan ayri test ediliyordu --
// SSR testleri ekranin NE GONDERDIGINI, arka plan testleri isleyicinin NE
// YAPTIGINI dogruluyordu; ama ikisinin BIRBIRINE BAKTIGI dikis (ekranin
// gonderdigi mesaj ile isleyicinin bekledigi mesaj) hicbir yerde olculmuyordu
// (TON'da ayni bosluk uc hata sizdirdi: bkz. tonConnectProtocolConformance.test.js).
//
// Bu harness TEK surec icinde SU ZINCIRI GERCEKTEN kurar:
//
//   sayfa  ->  GERCEK src/injected.js (new Function, sahte window)
//          ->  GERCEK src/content.js dinleyicisi
//          ->  GERCEK src/background.js dagiticisi (chrome taklidi uzerinde)
//          ->  GERCEK onay ekrani (SSR; Sign.vue / SignTypedData.vue) AYNI chrome'u okur
//          ->  ekranin sendMessage'i GERCEK arka plan dinleyicisine doner
//
// TAKLIT OLAN (ve bilincli olarak oyle birakilan) tek sey `chrome` API'sidir:
// storage (onChanged DAHIL), windows, tabs, runtime.sendMessage yonlendirmesi.
// Onay penceresi simulatoru YOK: pencere yalniz `chrome.windows.create` kaydidir;
// ekrani testin kendisi `openApprovalScreen()` ile GERCEK bilesen olarak acar.
// Pencere kapanisi (`closeApprovalWindow`), service worker yeniden baslamasi
// (`restartServiceWorker`) ve baglanma onayi (`simulateConnectApproval`, ConnectDapp.vue
// GERCEK DEGIL) bu harness'in tek "simulator" islevleridir.
//
// KULLANIM (tuketen test dosyasinda, TAM BU SIRAYLA -- bkz. ssrRender.js basi):
//
//   import { vi } from 'vitest'
//   vi.mock('vue', async (importOriginal) => {
//       const actual = await importOriginal()
//       return { ...actual, onMounted: actual.onServerPrefetch }
//   })
//   vi.hoisted(() => { globalThis.chrome = { windows: { onRemoved: { addListener: () => {} } }, storage: { local: { get: async () => ({}), set: async () => {} } } } })
//   import { createDappEnv } from './test-utils/dappProtocolHarness.js'
//   import Sign from './components/dapp/Sign.vue'
//   import SignTypedData from './components/dapp/SignTypedData.vue'
//
//   const env = await createDappEnv({ screens: {
//       SIGN_MESSAGE: { component: Sign, name: 'Sign', page: 'sign_message' },
//       SIGN_TYPED_DATA: { component: SignTypedData, name: 'SignTypedData', page: 'sign_typed_data' },
//   } })
//   ... env.request('personal_sign', [...]); await env.waitForApproval('SIGN_MESSAGE')
//   const screen = await env.openApprovalScreen(); await screen.state.sign() ...
//   env.dispose()   // HER testin sonunda (afterEach)
//
// `vi.mock('vue')` ve `vi.hoisted` BURADA degil, test dosyasinin KENDISINDE olmak
// zorunda (vitest yalniz test dosyasindaki cagrilari yukari tasir).
import { vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { HDNodeWallet, Wallet } from 'ethers'
import supported_chains from '../data/supported_chains.json'
import { createVault, deriveMasterKey, randBytes, toHex } from '../utils/crypto-utils'
import { createApp, captureInstance, render, createTestPinia, createTestI18n } from './ssrRender.js'
import { pageStore } from '../store/pageStore'
import { updateDapps } from '../utils/dappsStore'

export const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
export const DEFAULT_DAPP_URL = 'https://app.example/swap'
const EXTENSION_ID = 'watswallet'
const TAB_ID = 7
const PORT_CLOSED = 'The message port closed before a response was received.'

// Gercek zamanlayicilar: testler vi.useFakeTimers ile setImmediate'i da sahtelese
// bile bekleme dongusu CALISMALI. Modul yuklenirken (test baslamadan) yakalanir.
const realSetImmediate = globalThis.setImmediate
const realTick = () => new Promise((resolve) => realSetImmediate(resolve))

const INJECTED_SOURCE = readFileSync(new URL('../injected.js', import.meta.url), 'utf8')
// chrome.storage ve runtime mesajlari JSON olarak serilestirilir: undefined alanlar
// duser, Vue reactive Proxy'leri DUZ nesneye doner. structuredClone Proxy'de patlar.
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** Desteklenen zincir kaydi (EVM). Bulunamazsa harness ANINDA patlar. */
export function chainRecord(chainId) {
    const found = supported_chains.find((c) => c.chainId === chainId)
    if (!found) throw new Error('harness: supported_chains icinde chainId yok: ' + chainId)
    return clone(found)
}

// ---------------------------------------------------------------------------
// Sabit cuzdan: HER SUREC ICIN rastgele mnemonic ve parola (kalici yazilmaz,
// hicbir yere basilmaz, fon YOK). PBKDF2 yavas oldugu icin surec basina BIR kez.
// ---------------------------------------------------------------------------
let fixturePromise = null

export function getFixtureWallet() {
    if (!fixturePromise) fixturePromise = buildFixtureWallet()
    return fixturePromise
}

async function buildFixtureWallet() {
    const mnemonic = Wallet.createRandom().mnemonic.phrase
    const root = HDNodeWallet.fromPhrase(mnemonic, null, 'm')
    const makeAccount = (index, name) => {
        const derivationPath = `m/44'/60'/0'/0/${index}`
        return { key: `acc-${index}`, type: 'hd', index, derivationPath, address: root.derivePath(derivationPath).address, name }
    }
    const accountA = makeAccount(0, 'Account 1')
    const accountB = makeAccount(1, 'Account 2')

    const password = 'harness-' + toHex(randBytes(12))
    const masterKey = await deriveMasterKey(password, randBytes(32))
    const vault = await createVault(masterKey, mnemonic, accountA)
    accountB.fingerprint = accountA.fingerprint
    vault.accounts.push(accountB)
    const masterKeyJwk = await crypto.subtle.exportKey('jwk', masterKey)

    return { accountA, accountB, vault, masterKeyJwk }
}

// ---------------------------------------------------------------------------
// Ortam
// ---------------------------------------------------------------------------

/**
 * @param {object} [options]
 * @param {Record<string, {component: object, name: string, page: string}>} [options.screens]
 *        current_request.type -> GERCEK ekran bileseni (ornek: SIGN_MESSAGE -> Sign)
 * @param {string}  [options.dappUrl]        dapp sayfasinin adresi
 * @param {boolean} [options.connected]      dapp hesap A icin baglanmis baslasin
 * @param {boolean} [options.unlocked]       cuzdan kilidi acik baslasin
 * @param {number}  [options.chainId]        aktif EVM zinciri (varsayilan 1)
 */
export async function createDappEnv(options = {}) {
    const {
        screens = {},
        dappUrl = DEFAULT_DAPP_URL,
        connected = true,
        unlocked = true,
        chainId = 1,
    } = options

    const fixture = await getFixtureWallet()
    const { accountA, accountB } = fixture

    // ---- ortak durum -------------------------------------------------------
    const s = {
        local: {},
        session: {},
        events: {},          // olay adi -> [{fn, owner}]
        owner: 'bg',         // addListener'i kim kaydediyor (bg | content)
        page: pageFromUrl(dappUrl),
        tabs: null,          // null = sayfa sekmesi acik; [] = uyuyan site
        windowsOpen: new Map(),
        windowsCreated: [],
        nextWindowId: 1,
        inflight: new Set(), // content tarafi sendMessage geri cagirimlari
        uiLog: [],           // popup/ekran mesajlari {message, response}
        pageMessages: [],    // content.js'in arka plana ilettigi dapp yukleri
        requests: [],        // dapp istekleri {method, state, ...}
        providerEvents: [],  // dapp'in gordugu EIP-1193 olaylari
        lastStorageChange: null,
        failWindowBounds: false,
    }

    const hostname = () => s.page.hostname
    const dappRecord = (accounts) => ({
        accounts,
        chainId: '0x' + chainId.toString(16),
        favicon: '',
        connectedAt: 1_700_000_000_000,
        allowedChains: [chainId],
        origin: s.page.origin,
        followActive: true,
    })

    s.local = {
        vaults: [clone(fixture.vault)],
        active_account: clone(accountA),
        currentNetwork: chainRecord(chainId),
        dapps: connected ? { [hostname()]: dappRecord([accountA.address]) } : {},
        session_active: true,
        lastActiveTime: Date.now(),
    }
    if (unlocked) s.session.sessionMasterKeyJwk = clone(fixture.masterKeyJwk)

    // ---- olay kayitlari ------------------------------------------------------
    const eventApi = (name) => ({
        addListener: (fn) => { (s.events[name] ||= []).push({ fn, owner: s.owner }) },
        removeListener: (fn) => { s.events[name] = (s.events[name] || []).filter((l) => l.fn !== fn) },
        hasListener: (fn) => (s.events[name] || []).some((l) => l.fn === fn),
    })
    const listenersOf = (name, owner) => (s.events[name] || []).filter((l) => !owner || l.owner === owner).map((l) => l.fn)
    const fire = (name, ...args) => { for (const fn of listenersOf(name)) fn(...args) }

    // ---- storage -------------------------------------------------------------
    const readFrom = (bucket, keys) => {
        if (keys === undefined || keys === null) return clone(bucket)
        if (typeof keys === 'string') return { [keys]: clone(bucket[keys]) }
        if (Array.isArray(keys)) return Object.fromEntries(keys.map((k) => [k, clone(bucket[k])]))
        // {anahtar: varsayilan}
        return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, bucket[k] === undefined ? clone(d) : clone(bucket[k])]))
    }
    const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b)

    const storageArea = (bucketName, areaName) => ({
        get: vi.fn(async (keys) => readFrom(s[bucketName], keys)),
        set: vi.fn(async (obj) => {
            const changes = {}
            for (const [k, v] of Object.entries(obj)) {
                const oldValue = clone(s[bucketName][k])
                const newValue = clone(v)
                s[bucketName][k] = newValue
                if (!sameValue(oldValue, newValue)) changes[k] = { oldValue, newValue }
            }
            if (Object.keys(changes).length === 0) return
            s.lastStorageChange = { changes, areaName }
            // Gercek tarayicida onChanged ASENKRON gelir.
            queueMicrotask(() => fire('storage.onChanged', clone(changes), areaName))
        }),
        remove: vi.fn(async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys]
            const changes = {}
            for (const k of list) {
                if (s[bucketName][k] === undefined) continue
                changes[k] = { oldValue: clone(s[bucketName][k]) }
                delete s[bucketName][k]
            }
            if (Object.keys(changes).length === 0) return
            s.lastStorageChange = { changes, areaName }
            queueMicrotask(() => fire('storage.onChanged', clone(changes), areaName))
        }),
    })

    // ---- mesaj yonlendirme ---------------------------------------------------
    const pageSender = () => ({
        id: EXTENSION_ID,
        origin: s.page.origin,
        url: s.page.url,
        frameId: 0,
        tab: { id: TAB_ID, url: s.page.url, favIconUrl: s.page.origin + '/favicon.ico' },
    })
    const walletUiSender = () => ({ id: EXTENSION_ID, url: EXTENSION_ORIGIN + 'src/popup/index.html#window' })

    /**
     * Arka plan dinleyicisine mesaj teslim eder. `return true` vermeyen ve
     * senkron yanitlamayan dinleyici icin Chrome'un davranisi taklit edilir:
     * kanal kapanir, gonderici `undefined` + lastError gorur.
     */
    const dispatchToBackground = (message, sender, respond, onNoResponse) => {
        let responded = false
        let promisedAsync = false
        const once = (response) => {
            if (responded) return
            responded = true
            respond(response)
        }
        for (const fn of listenersOf('runtime.onMessage', 'bg')) {
            try {
                if (fn(message, sender, once) === true) promisedAsync = true
            } catch (error) {
                console.error('harness: arka plan dinleyicisi firlatti', error)
            }
        }
        if (!promisedAsync && !responded) queueMicrotask(() => { if (!responded) onNoResponse() })
    }

    const fromWalletUi = (message) => new Promise((resolve) => {
        const record = { message: clone(message), response: undefined }
        s.uiLog.push(record)
        dispatchToBackground(clone(message), walletUiSender(), (response) => {
            record.response = clone(response)
            resolve(response)
        }, () => resolve(undefined))
    })

    const fromPage = (message, callback) => {
        const entry = { done: false }
        const finish = (response, lastErrorMessage) => {
            if (entry.done) return
            entry.done = true
            s.inflight.delete(entry)
            globalThis.chrome.runtime.lastError = lastErrorMessage ? { message: lastErrorMessage } : undefined
            try { callback(response) } finally { globalThis.chrome.runtime.lastError = undefined }
        }
        entry.finish = finish
        s.inflight.add(entry)
        s.pageMessages.push(clone(message))
        dispatchToBackground(clone(message), pageSender(), (response) => finish(response), () => finish(undefined, PORT_CLOSED))
    }

    const runtimeSendMessage = (message, a, b) => {
        const callback = typeof a === 'function' ? a : b
        if (typeof callback === 'function') { fromPage(message, callback); return undefined }
        // Arka planin KENDI yayini (kilitlenince arayuze) kendi dinleyicisine donmez.
        if (message && message.type === 'SESSION_EXPIRED') return Promise.resolve()
        return fromWalletUi(message)
    }

    // ---- chrome taklidi --------------------------------------------------------
    const removeWindow = async (id) => {
        if (!s.windowsOpen.has(id)) throw new Error('No window with id: ' + id)
        s.windowsOpen.delete(id)
        queueMicrotask(() => fire('windows.onRemoved', id))
    }

    globalThis.chrome = {
        alarms: {
            create: vi.fn(), get: vi.fn(async () => undefined), getAll: vi.fn(async () => []),
            clear: vi.fn(async () => true), onAlarm: eventApi('alarms.onAlarm'),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setPopup: vi.fn(async () => {}) },
        sidePanel: { setPanelBehavior: vi.fn(async () => {}), setOptions: vi.fn(async () => {}), open: vi.fn(async () => {}) },
        runtime: {
            id: EXTENSION_ID,
            getURL: (path = '') => EXTENSION_ORIGIN + path,
            lastError: undefined,
            onMessage: eventApi('runtime.onMessage'),
            onConnect: eventApi('runtime.onConnect'),
            onStartup: eventApi('runtime.onStartup'),
            onInstalled: eventApi('runtime.onInstalled'),
            sendMessage: vi.fn(runtimeSendMessage),
            connect: vi.fn(() => ({ onDisconnect: eventApi('port.onDisconnect'), onMessage: eventApi('port.onMessage'), postMessage: () => {}, disconnect: () => {} })),
        },
        storage: {
            local: storageArea('local', 'local'),
            session: storageArea('session', 'session'),
            onChanged: eventApi('storage.onChanged'),
        },
        tabs: {
            query: vi.fn(async () => (s.tabs === null ? [{ id: TAB_ID, url: s.page.url, favIconUrl: '' }] : clone(s.tabs))),
            sendMessage: vi.fn(async (tabId, message) => {
                for (const fn of listenersOf('runtime.onMessage', 'content')) fn(message, { id: EXTENSION_ID }, () => {})
            }),
            create: vi.fn(async () => ({ id: 99 })),
            update: vi.fn(async () => ({})),
        },
        windows: {
            create: vi.fn(async (opts) => {
                // Gercek Chrome gibi: ekran disi sinirlar REDDEDILIR (N3 vakasi:
                // son odaklanan pencere ekran disindaysa left/top gecersiz sayilir).
                if (s.failWindowBounds && (opts.left !== undefined || opts.top !== undefined)) {
                    throw new Error('Invalid value for bounds. Bounds must be at least 50% within visible screen space.')
                }
                const id = s.nextWindowId++
                s.windowsOpen.set(id, opts)
                s.windowsCreated.push({ id, ...opts })
                return { id }
            }),
            get: vi.fn(async (id) => {
                if (!s.windowsOpen.has(id)) throw new Error('No window with id: ' + id)
                return { id }
            }),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0, state: 'normal' })),
            remove: vi.fn(removeWindow),
            onRemoved: eventApi('windows.onRemoved'),
        },
    }

    // ---- sayfa dunyasi (GERCEK injected.js + GERCEK content.js) ---------------
    const win = new EventTarget()
    Object.defineProperty(win, 'location', { get: () => ({ hostname: s.page.hostname, origin: s.page.origin, href: s.page.url }) })
    win.top = win
    win.postMessage = (data) => {
        // Gercek tarayicida postMessage ASENKRON teslim edilir.
        queueMicrotask(() => {
            const event = new Event('message')
            event.source = win
            event.data = data
            win.dispatchEvent(event)
        })
    }
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', {
        head: { appendChild: () => {} },
        documentElement: { appendChild: () => {} },
        createElement: () => ({ setAttribute: () => {}, remove: () => {} }),
        addEventListener: () => {},
        removeEventListener: () => {},
    })
    // navigator.locks: GERCEK tarayicidaki gibi ayni ada sahip istekleri SIRAYA sokar
    // (dappsStore.updateDapps bunun altinda calisir; bagliklar arasi seri yazim).
    const lockQueues = new Map()
    vi.stubGlobal('navigator', {
        clipboard: { writeText: async () => {} },
        locks: {
            request: (name, a, b) => {
                const callback = typeof a === 'function' ? a : b
                const previous = lockQueues.get(name) || Promise.resolve()
                const run = previous.then(() => callback({ name, mode: 'exclusive' }))
                lockQueues.set(name, run.catch(() => {}))
                return run
            },
        },
    })

    // Uretim sunucusuna / RPC'ye hicbir ag cagrisi gitmemeli: bu testler HERMETIK.
    const fetchSpy = vi.fn(async () => { throw new Error('harness: ag cagrisi (fetch) YASAK') })
    vi.stubGlobal('fetch', fetchSpy)

    new Function('window', 'crypto', INJECTED_SOURCE)(win, globalThis.crypto)
    const provider = win.wats

    async function loadContent() {
        s.owner = 'content'
        try { await import('../content.js') } finally { s.owner = 'bg' }
    }

    async function loadBackground() {
        s.owner = 'bg'
        await import('../background.js')
    }

    vi.resetModules()
    await loadContent()
    await loadBackground()
    fetchSpy.mockClear()

    for (const name of ['accountsChanged', 'chainChanged', 'connect', 'disconnect']) {
        provider.on(name, (detail) => s.providerEvents.push({ event: name, detail: clone(detail) }))
    }

    // ---- yardimcilar -----------------------------------------------------------
    const settle = async (ticks = 30) => { for (let i = 0; i < ticks; i++) await realTick() }

    async function waitFor(predicate, label, maxTicks = 600) {
        for (let i = 0; i < maxTicks; i++) {
            if (predicate()) return
            await realTick()
        }
        throw new Error(`harness.waitFor zaman asimi: ${label}\n` + JSON.stringify({
            current_request: s.local.current_request?.type,
            windows: s.windowsCreated.length,
            hanging: s.requests.filter((r) => r.state === 'pending').map((r) => r.method),
        }))
    }

    const env = {
        provider,
        win,
        fixture,
        accountA,
        accountB,
        chrome: globalThis.chrome,
        fetchSpy,
        /** Depodaki ham durum (YALNIZ okumak icin). */
        get store() { return s.local },
        get session() { return s.session },
        get windowsCreated() { return s.windowsCreated },
        get uiLog() { return s.uiLog },
        /** Arka plana gercekten ulasan dapp yukleri (method adina gore suzulebilir). */
        pageCalls: (method) => s.pageMessages.filter((m) => !method || m.method === method),
        get providerEvents() { return s.providerEvents },
        get hostname() { return hostname() },
        get origin() { return s.page.origin },
        settle,
        waitFor,

        eventsOf: (name) => s.providerEvents.filter((e) => e.event === name).map((e) => e.detail),
        currentRequest: () => s.local.current_request,
        dappRecord: (accounts) => dappRecord(accounts),

        /** Dapp istegi (GERCEK provider.request). Donen promise, hata durumunda `Error` + `code` ile reddeder. */
        request(method, params) {
            const record = { method, state: 'pending' }
            const promise = provider.request(params === undefined ? { method } : { method, params })
            record.promise = promise.then(
                (value) => { record.state = 'resolved'; record.value = value; return value },
                (error) => { record.state = 'rejected'; record.error = error; throw error },
            )
            record.promise.catch(() => {})
            s.requests.push(record)
            return record.promise
        },
        /** Reddedilmesi BEKLENEN istek: hatayi doner; basarili olursa test patlar. */
        async requestError(method, params) {
            try {
                const value = await env.request(method, params)
                throw new Error(`harness: ${method} reddedilmedi, sonuc: ${JSON.stringify(value)}`)
            } catch (error) {
                if (String(error?.message || '').startsWith('harness: ')) throw error
                return error
            }
        },
        /** Henuz cozulmemis dapp istekleri (yontem adlari). */
        hanging: () => s.requests.filter((r) => r.state === 'pending').map((r) => r.method),

        // ---- onay penceresi / ekran ------------------------------------------
        waitForApproval: (type) => waitFor(() => s.local.current_request?.type === type, `current_request.type === ${type}`),

        /** current_request.type'a karsilik gelen GERCEK ekrani render eder. */
        async openApprovalScreen() {
            const request = s.local.current_request
            if (!request) throw new Error('harness: current_request yok, acilacak ekran yok')
            const entry = screens[request.type]
            if (!entry) throw new Error('harness: ekran kaydi yok: ' + request.type)
            const pinia = createTestPinia()
            const app = createApp(entry.component)
            app.use(pinia)
            app.use(createTestI18n())
            const page = pageStore()
            page.currentPage = entry.page
            const holder = captureInstance(app, entry.name)
            const html = await render(app)
            if (holder.setupStateEmptyError) throw holder.setupStateEmptyError
            return { app, page, holder, html, state: holder.instance.setupState }
        },

        /** Ekranin sendMessage cagrilari arasinda `type`a uyanlar (dikis kilidi icin). */
        uiMessages: (type) => s.uiLog.filter((r) => r.message?.type === type),

        /** Kullanici onay penceresini kapatir (X dugmesi). */
        async closeApprovalWindow() {
            const ids = [...s.windowsOpen.keys()]
            if (ids.length === 0) throw new Error('harness: kapatilacak acik onay penceresi yok')
            await globalThis.chrome.windows.remove(ids[ids.length - 1])
            await settle(10)
        },

        /**
         * ConnectDapp.vue'nun onay yolunun SOZLESMESI (ConnectDapp.ssr.test.js'te
         * GERCEK ekranla sinanir): dapps kaydi yazilir, sonra CONNECT_WALLET_SUCCESS
         * gider. Bu harness'te ConnectDapp.vue GERCEK DEGILDIR (spec bolum 11: bu
         * dosyanin gercek ekranlari Sign ve SignTypedData); yalniz arka planin
         * baglanma SONRASI davranisi surulur.
         */
        async simulateConnectApproval(accounts = [accountA.address]) {
            await env.waitForApproval('CONNECT')
            const request = s.local.current_request
            await updateDapps((dapps) => { dapps[hostname()] = dappRecord(accounts) })
            await globalThis.chrome.runtime.sendMessage({
                type: 'CONNECT_WALLET_SUCCESS', requestId: request.id, status: 'success', data: { result: accounts },
            })
        },

        // ---- cuzdan durumu --------------------------------------------------------
        /** Header.changeAccount'un birinci yarisi: active_account yazimi (storage.onChanged tetiklenir). */
        async writeActiveAccount(account) {
            await globalThis.chrome.storage.local.set({ active_account: clone(account) })
            await settle(10)
        },
        /** Header.changeAccount'un ikinci yarisi: ACCOUNT_CHANGED mesaji. */
        async announceAccountChanged(account) {
            const response = await fromWalletUi({ type: 'ACCOUNT_CHANGED', address: account.address })
            await settle(10)
            return response
        },
        /** applyNetworkChange'in yazdigi iki sey: currentNetwork + CHAIN_CHANGED. */
        async switchNetworkFromUi(nextChainId) {
            await globalThis.chrome.storage.local.set({ currentNetwork: chainRecord(nextChainId) })
            const response = await fromWalletUi({ type: 'CHAIN_CHANGED', chainId: nextChainId })
            await settle(10)
            return response
        },
        /** Ayni storage.onChanged olayinin IKINCI teslimi (cift onChanged vakasi). */
        redeliverLastStorageChange() {
            if (!s.lastStorageChange) throw new Error('harness: yeniden teslim edilecek storage degisikligi yok')
            fire('storage.onChanged', clone(s.lastStorageChange.changes), s.lastStorageChange.areaName)
        },
        /** Dogrudan (olaysiz) diske yaz: baslangic durumunu kurmak icin. */
        seed(patch) { for (const [k, v] of Object.entries(patch)) s.local[k] = clone(v) },
        /** Cuzdani kilitle (lockWallet'in yaptigi: oturum anahtarini sil). */
        lock() { delete s.session.sessionMasterKeyJwk },
        /** Kilidi ac (popup'ta Login'in yaptigi: oturum anahtarini geri yaz). */
        unlock() { s.session.sessionMasterKeyJwk = clone(fixture.masterKeyJwk) },
        /** Dapp sayfasini baska bir adrese tasi (ayni sekme, yeni origin). */
        navigate(url) { s.page = pageFromUrl(url) },
        /** windows.create, left/top verilirse Chrome'un ekran-disi sinir hatasiyla reddeder (N3). */
        failWindowBounds() { s.failWindowBounds = true },
        /** Sitenin acik sekmesi kalmadi (uyuyan site). */
        closeTab() { s.tabs = [] },

        /**
         * Service worker olur ve yeniden dogar: bekleyen sendMessage geri cagirimlari
         * lastError ile biter (Chrome kanali kapatir), arka plan dinleyicileri silinir,
         * modul durumu (pendingRequests, pencere kilidi) SIFIRLANIR; storage KALIR.
         */
        async restartServiceWorker() {
            for (const entry of [...s.inflight]) entry.finish(undefined, PORT_CLOSED)
            for (const name of Object.keys(s.events)) s.events[name] = s.events[name].filter((l) => l.owner !== 'bg')
            vi.resetModules()
            await loadBackground()
            fetchSpy.mockClear()
            await settle(5)
        },

        /** Testin sonunda cagrilir: global saplamalari ve chrome'u kaldirir. */
        dispose() {
            vi.unstubAllGlobals()
            delete globalThis.chrome
        },
    }

    return env
}

function pageFromUrl(url) {
    const u = new URL(url)
    return { url: u.href, origin: u.origin, hostname: u.hostname }
}
