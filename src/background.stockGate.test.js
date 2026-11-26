// KOK NEDEN / KAPATILAN HATA
// Ilk alim kapisinin arka plan KABLOLAMASI (spec ilk-alim-kapisi 5.12, K20, K21). Kapatilan hata siniflari:
//  (1) tek ic aksiyon (STOCK_GATE_STATUS) mesaj kapisina girmezse bir web sayfasi kullanicinin baglanti ulkesini
//      okurdu; beyan yazan / silen / listeleyen aksiyonlar K32 ile kalkti (kaynakta case yok);
//  (2) yanitlara ham aktif hesap nesnesinin (sifreli anahtar malzemesi icerebilir) ya da ham IP dizesinin sizmasi (G11);
//  (3) kararin hesaba bagli olmasi (K39): kapi aktif hesabi ve beyan deposunu OKUMAZ;
//  (4) K20: acil durdurma (buyEnabled:false) yalniz bellekte / oturumda tutulursa servis calisaninin yeniden
//      baslamasi kapiyi sessizce ACARDI; bozuk kalici kayit da kapiyi cokertmemeli (gomulu kopyayla devam).
// Test gercek background.js'i mesajlarla surer (harness: background.txMeta.test.js). Ag YOK: fetch enjekte.
// Pozitif bekciler: her "reddedildi / yazilmadi" iddiasinin yaninda ayni yolun GERCEKTEN calistigi bir test var.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import supported_chains from './data/supported_chains.json'
import { BUNDLED_ELIGIBILITY_RULES } from './data/eligibilityRules'
import { blokGovdesi, yorumsuz } from './test-utils/kaynakTarama'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const PAGE_SENDER = { url: 'https://evil.example/page', tab: { id: 3 } }
const BSC = supported_chains.find((c) => c.chainId === 56)
const BUNDLED = BUNDLED_ELIGIBILITY_RULES

// Ham hesap nesnesi: arayuze SIZMAMASI gereken alan bilerek var.
const ACCOUNT = { key: 'k1', type: 'hd', index: 0, address: '0xabc', importedSecret: 'enc-secret-blob' }
const STATUS_KEYS = ['decision', 'ipCountry', 'reason'] // her ihraccinin karari TAM bu uc anahtar
// STOCK_GATE_STATUS yaniti tablodaki HER ihracciyi tek yanitta verir (K34; Bolum 2: tablo-gudumlu): gomulu tabloda alti ihracci
const REPLY_KEYS = Object.keys(BUNDLED_ELIGIBILITY_RULES.issuers).sort()
const CHECK_FAILED_REPLY = { decision: 'BLOCKED', reason: 'CHECK_FAILED', ipCountry: null }
const bothOf = (v) => Object.fromEntries(REPLY_KEYS.map((issuer) => [issuer, v]))
const ALL_FAILED = bothOf(CHECK_FAILED_REPLY)
const UNAUTHORIZED = { error: { code: 4100, message: 'Unauthorized' } }

let messageListener
let sessionStore
let localStore
let eligibilityBody // null -> sunucu yok (ag hatasi)
const fetchSpy = vi.fn()

// Gercek chrome.storage anlami: yalniz VAR olan anahtarlar doner; string / dizi / nesne (varsayilanli) / null.
function makeArea(getStore) {
    const pick = (store, keys) => {
        if (keys === undefined || keys === null) return { ...store }
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {}
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]))
        return Object.fromEntries(Object.entries(keys).map(([k, dflt]) => [k, k in store ? store[k] : dflt]))
    }
    return {
        get: vi.fn(async (keys) => structuredClone(pick(getStore(), keys))),
        set: vi.fn(async (obj) => { Object.assign(getStore(), structuredClone(obj)) }),
        remove: vi.fn(async (keys) => { for (const k of [].concat(keys)) delete getStore()[k] }),
    }
}

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })
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
        storage: { local: makeArea(() => localStore), session: makeArea(() => sessionStore) },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: {
            create: vi.fn(async () => ({ id: 1 })),
            getLastFocused: vi.fn(async () => ({ width: 1000, left: 0, top: 0 })),
            get: vi.fn(async () => ({ id: 1 })),
            getCurrent: vi.fn(async () => ({ id: 1 })),
            onRemoved: add('onConnect'),
            remove: vi.fn(),
        },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setPopup: vi.fn(async () => {}) },
    }
    return listeners
}

// Servis calisanini (yeniden) baslatir: modul durumu SIFIRLANIR, depo (localStore / sessionStore) korunur.
async function boot() {
    vi.resetModules()
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}
const call = (type, message) => callHandler(message === undefined ? { type } : { type, message })

const eligibilityCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u).endsWith('/eligibility?v=2'))
const touched = (key) => globalThis.chrome.storage.local.get.mock.calls.some(([k]) => String(JSON.stringify(k)).includes(key))

// Sunucu tablosu: gomulu kopyanin KOPYASI (ayni sema) + bir ustte surum + bStocks alimi kapali.
const killRules = () => {
    const r = structuredClone(BUNDLED)
    r.version = BUNDLED.version.replace(/\.(\d+)$/, (_, n) => `.${Number(n) + 1}`)
    r.issuers.bstocks.buyEnabled = false
    return r
}
const serverBody = (rules, ipCountry = null) => ({ success: true, version: rules.version, ipCountry, rules })

beforeEach(async () => {
    vi.clearAllMocks()
    eligibilityBody = null
    fetchSpy.mockImplementation(async (url) => {
        if (String(url).endsWith('/eligibility?v=2')) {
            if (!eligibilityBody) throw new Error('offline')
            const text = JSON.stringify(eligibilityBody)
            return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) }
        }
        return { ok: false, status: 503, text: async () => '', json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchSpy)
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: structuredClone(ACCOUNT),
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
        currentNetwork: BSC,
        current_transactions: [],
        dapps: {},
    }
    await boot()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// Sunucu tablosu: gomulu kopyanin KOPYASI + bir ustte surum, alim ACIK; IP ulkesi verilen deger.
const openRules = () => {
    const r = structuredClone(BUNDLED)
    r.version = BUNDLED.version.replace(/\.(\d+)$/, (_, n) => `.${Number(n) + 1}`)
    return r
}
// `ip` alani sunucu yanitinda HAM IP gibi durur: arayuze sizmadigi asagida denetlenir.
const serveCountry = (ipCountry) => { eligibilityBody = { ...serverBody(openRules(), ipCountry), ip: '203.0.113.9' } }

describe('STOCK_GATE_STATUS -- koken kapisi (tek ic aksiyon, K32)', () => {
    it('sayfa kokenli: 4100 ile reddedilir, depoya ve aga HIC dokunulmaz', async () => {
        const res = await callHandler({ type: 'STOCK_GATE_STATUS', message: { issuer: 'bstocks' } }, PAGE_SENDER)
        expect(res).toEqual(UNAUTHORIZED)
        expect(eligibilityCalls()).toHaveLength(0)
        expect(touched('stock_gate_rules_cache')).toBe(false)
    })

    it('ic aksiyon adi `method` alanina saklansa da sayfadan reddedilir', async () => {
        const res = await callHandler({ method: 'STOCK_GATE_STATUS', message: { issuer: 'bstocks' } }, PAGE_SENDER)
        expect(res).toEqual(UNAUTHORIZED)
        expect(eligibilityCalls()).toHaveLength(0)
    })

    // Pozitif bekci: ayni STATUS eklenti kokenliyse GERCEKTEN islenir (yukaridaki "reddedildi" iddialari vakumda degil).
    it('pozitif bekci: ayni STATUS eklenti kokenliyse islenir', async () => {
        serveCountry('AR')
        const res = await call('STOCK_GATE_STATUS')
        expect(res).toEqual(bothOf({ decision: 'OK', reason: 'OK', ipCountry: 'AR' }))
        expect(eligibilityCalls()).toHaveLength(1) // iki ihracci TEK ensureFresh (tek /eligibility istegi)
    })

    it('P21: STOCK_GATE_STATUS kullanici etkinlik damgasi vurmaz; HEARTBEAT (pozitif bekci) vurur', async () => {
        serveCountry('AR')
        await call('STOCK_GATE_STATUS')
        expect(localStore.lastActiveTime).toBeUndefined()
        // refreshSession() dagiticida AWAIT EDILMEDEN cagriliyor (background.activity.test.js kalibi): yanit
        // beklenmez, mikro-gorevler bosaltilir.
        messageListener({ type: 'HEARTBEAT' }, { url: EXTENSION_ORIGIN }, () => {})
        for (let i = 0; i < 10; i++) await Promise.resolve()
        expect(typeof localStore.lastActiveTime).toBe('number')
    })
})

describe('STOCK_GATE_STATUS', () => {
    it('G11: yanit anahtarlari TAM [bstocks, xstocks], her biri TAM uc anahtar { decision, reason, ipCountry }; ham hesap alani ve IP dizesi sizmaz', async () => {
        serveCountry('AR')
        const res = await call('STOCK_GATE_STATUS')
        expect(Object.keys(res).sort()).toEqual(REPLY_KEYS)
        for (const v of Object.values(res)) expect(Object.keys(v).sort()).toEqual(STATUS_KEYS)
        expect(res).toEqual(bothOf({ decision: 'OK', reason: 'OK', ipCountry: 'AR' }))
        expect(JSON.stringify(res)).not.toContain('enc-secret-blob')
        expect(JSON.stringify(res)).not.toContain('0xabc')
        expect(JSON.stringify(res)).not.toContain('203.0.113')
    })

    it('G11: bir yanitta iki farkli sekil (TR: bstocks BLOCKED / IP_COUNTRY_ISSUER, xstocks OK / OK, K43: uyarisiz uygun); yine her biri uc anahtar', async () => {
        serveCountry('TR')
        const res = await call('STOCK_GATE_STATUS')
        const ok = { decision: 'OK', reason: 'OK', ipCountry: 'TR' }
        expect(res).toEqual({
            bstocks: { decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' },
            xstocks: ok, ondo: ok, coinbase: ok, robinhood: ok, st0x: ok,
        })
        for (const v of Object.values(res)) expect(Object.keys(v).sort()).toEqual(STATUS_KEYS)
        expect(JSON.stringify(res)).not.toContain('203.0.113')
    })

    // K43: WARN karari (eski ya da onbellekteki, uyari listesi dolu tablo) hala uretilir; alim yine ACIK (uygun) sayilir ve istemci
    // bunun icin uyari cizmez. Sunucu tablosu uyari listesi dolu verilirse yanit sekli eskisi gibi kalir.
    it('G11: uyari listesi dolu bir sunucu tablosu (xstocks warn TR) hala WARN / WARN_COUNTRY yanitlar; uc anahtar, IP sizmaz', async () => {
        const r = openRules()
        r.issuers.xstocks.warn = ['TR']
        eligibilityBody = { ...serverBody(r, 'TR'), ip: '203.0.113.9' }
        const res = await call('STOCK_GATE_STATUS')
        expect(res.xstocks).toEqual({ decision: 'WARN', reason: 'WARN_COUNTRY', ipCountry: 'TR' })
        expect(res.bstocks).toEqual({ decision: 'BLOCKED', reason: 'IP_COUNTRY_ISSUER', ipCountry: 'TR' })
        for (const v of Object.values(res)) expect(Object.keys(v).sort()).toEqual(STATUS_KEYS)
        expect(JSON.stringify(res)).not.toContain('203.0.113')
    })

    // Bolum 2: yanit sabit iki ihracci degil TABLO surer. Sunucu tablosuna eklenen ihracci yanitta, kendi satiriyla karar alir.
    it('tablo-gudumlu: sunucu tablosundaki ek ihracci (dogecoin) yanitta; coinbase acil durdurmasi yalniz coinbase i kapatir', async () => {
        const r = openRules()
        r.issuers.dogecoin = { buyEnabled: true, blocked: [], warn: [] }
        r.issuers.coinbase.buyEnabled = false
        eligibilityBody = { ...serverBody(r, 'AR'), ip: '203.0.113.9' }
        const res = await call('STOCK_GATE_STATUS')
        expect(Object.keys(res).sort()).toEqual([...REPLY_KEYS, 'dogecoin'].sort())
        expect(res.dogecoin).toEqual({ decision: 'OK', reason: 'OK', ipCountry: 'AR' })
        expect(res.coinbase).toEqual({ decision: 'BLOCKED', reason: 'KILL_SWITCH', ipCountry: 'AR' })
        expect(res.ondo).toEqual({ decision: 'OK', reason: 'OK', ipCountry: 'AR' })
        for (const v of Object.values(res)) expect(Object.keys(v).sort()).toEqual(STATUS_KEYS)
        expect(JSON.stringify(res)).not.toContain('203.0.113')
    })

    it('ulke bilinmiyor (sunucu yok): tablodaki butun ihracci COUNTRY_UNKNOWN, ipCountry null (K33)', async () => {
        const res = await call('STOCK_GATE_STATUS')
        expect(res).toEqual(bothOf({ decision: 'BLOCKED', reason: 'COUNTRY_UNKNOWN', ipCountry: null }))
    })

    it.each([[undefined], [null], [''], ['dogecoin'], ['__proto__'], [42], [{ issuer: 'bstocks' }]])(
        'G11: { issuer } govdesi (%j) YOK SAYILIR: yanit sekli degismez, hesap ve beyan deposuna dokunulmaz', async (issuer) => {
            serveCountry('AR')
            globalThis.chrome.storage.local.get.mockClear()
            const bos = await call('STOCK_GATE_STATUS')
            expect(await call('STOCK_GATE_STATUS', { issuer })).toEqual(bos)
            expect(Object.keys(bos).sort()).toEqual(REPLY_KEYS)
            expect(touched('stock_declarations')).toBe(false)
            expect(touched('active_account')).toBe(false)
        })

    it('govdesiz mesaj (message alani yok) FIRLATMAZ ve iki ihracci yanitini verir', async () => {
        serveCountry('AR')
        expect(await call('STOCK_GATE_STATUS')).toEqual(bothOf({ decision: 'OK', reason: 'OK', ipCountry: 'AR' }))
    })

    it('M11: isleyici beklenmedik hatada (sendResponse ilk cagrida patlar) KAPALI karar verir (STOCK_GATE_STATUS_FAILED), iki ihracci x 3 anahtar', async () => {
        serveCountry('AR')
        const yanitlar = []
        const sendResponse = (yanit) => {
            yanitlar.push(yanit)
            if (yanitlar.length === 1) throw new Error('kanal kapandi')
        }
        messageListener({ type: 'STOCK_GATE_STATUS' }, { url: EXTENSION_ORIGIN }, sendResponse)
        for (let i = 0; i < 200 && yanitlar.length < 2; i++) await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar).toHaveLength(2)
        const res = yanitlar[1]
        expect(res).toEqual(ALL_FAILED) // catch yolu da tablo-gudumlu: zorunlu iki + gomulu tablonun ihraccilari
        expect(Object.keys(res).sort()).toEqual(REPLY_KEYS)
        for (const v of Object.values(res)) expect(Object.keys(v).sort()).toEqual(STATUS_KEYS)
    })

    it('K39: karar hesaba bagli degil -- active_account yokken de karar verilir ve depodan okunmaz', async () => {
        delete localStore.active_account
        serveCountry('AR')
        globalThis.chrome.storage.local.get.mockClear()
        expect(await call('STOCK_GATE_STATUS')).toEqual(bothOf({ decision: 'OK', reason: 'OK', ipCountry: 'AR' }))
        expect(touched('active_account')).toBe(false)
        expect(touched('stock_declarations')).toBe(false)
    })
})

describe('K20: kalici kural onbellegi (gercek background.js, servis calisani yeniden baslangici)', () => {
    // Pozitif bekci: sunucu acik ve ulke biliniyor -> kapi KAPALI DEGIL. Asagidaki KILL_SWITCH iddialari
    // bu yuzden "her zaman kilit" olarak vakumda gecemez.
    it('pozitif bekci: sunucu ulkeyi verirken bStocks kilidi YOK (kill-switch kapali tablo)', async () => {
        serveCountry('AR')
        expect((await call('STOCK_GATE_STATUS')).bstocks).toMatchObject({ decision: 'OK' })
    })

    it.each([[null], ['AR'], ['TR']])(
        'R3: buyEnabled:false bir kez alindiktan (ulke %j) sonra sunucu yokken VE SW yeniden baslayinca KILL_SWITCH surer', async (ulke) => {
            eligibilityBody = serverBody(killRules(), ulke)
            expect((await call('STOCK_GATE_STATUS')).bstocks).toMatchObject({ decision: 'BLOCKED', reason: 'KILL_SWITCH' })
            expect(eligibilityCalls()).toHaveLength(1)

            // Kalici kayit TAM {v, rules}; IP / zaman damgasi / hesap alani YOK, oturum kaydi `rules` tasimaz.
            expect(Object.keys(localStore.stock_gate_rules_cache).sort()).toEqual(['rules', 'v'])
            expect(localStore.stock_gate_rules_cache.rules.issuers.bstocks.buyEnabled).toBe(false)
            expect(Object.keys(sessionStore.stock_gate_cache ?? {})).not.toContain('rules')

            // SW yeniden basladi: sunucu yok (fetch reddedilir), oturum onbellegi bos, modul durumu sifir, ulke de bilinmiyor.
            eligibilityBody = null
            sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
            await boot()
            expect((await call('STOCK_GATE_STATUS')).bstocks).toEqual({ decision: 'BLOCKED', reason: 'KILL_SWITCH', ipCountry: null })
            expect(eligibilityCalls().length).toBeGreaterThanOrEqual(2)
        })

    // R3 pozitif bekcisi: ayni yeniden baslatma KALICI KAYIT OLMADAN kilidi dusurur. Bu olmadan R3, kilidin
    // baska bir yoldan (oturum kaydi, modul durumu, fetch kalintisi) surdugu bir uygulamada da gecerdi:
    // kilidin kaynagi gercekten `stock_gate_rules_cache` oldugu burada kanitlanir. Kural 1 kalkinca kapi KAPALI
    // KALIR ama nedeni KILL_SWITCH degil COUNTRY_UNKNOWN olur (ulke bilinmiyor).
    it('R3 pozitif bekci: ayni yeniden baslatma kalici kayit SILINIRSE KILL_SWITCH kalkar (kilidin kaynagi kalici kayittir)', async () => {
        eligibilityBody = serverBody(killRules(), 'AR')
        expect((await call('STOCK_GATE_STATUS')).bstocks).toMatchObject({ decision: 'BLOCKED', reason: 'KILL_SWITCH' })
        expect(localStore.stock_gate_rules_cache).toBeDefined()

        eligibilityBody = null
        sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
        delete localStore.stock_gate_rules_cache
        await boot()
        const res = (await call('STOCK_GATE_STATUS')).bstocks
        expect(res.reason).not.toBe('KILL_SWITCH')
        expect(res).toEqual({ decision: 'BLOCKED', reason: 'COUNTRY_UNKNOWN', ipCountry: null })
    })

    it('pozitif bekci: GECERLI kalici kayit sunucusuz da okunur (R4 iddialarinin vakumda gecmemesi icin)', async () => {
        localStore.stock_gate_rules_cache = { v: 1, rules: killRules() }
        expect((await call('STOCK_GATE_STATUS')).bstocks).toMatchObject({ decision: 'BLOCKED', reason: 'KILL_SWITCH' })
    })

    it('kalici kayit buyEnabled:true + ulasilamayan sunucu + ulke null -> COUNTRY_UNKNOWN (kural 2; KILL_SWITCH degil)', async () => {
        localStore.stock_gate_rules_cache = { v: 1, rules: openRules() }
        const res = (await call('STOCK_GATE_STATUS')).bstocks
        expect(res).toEqual({ decision: 'BLOCKED', reason: 'COUNTRY_UNKNOWN', ipCountry: null })
        expect(eligibilityCalls().length).toBeGreaterThanOrEqual(1)
    })

    it.each([
        ['surum v:2', { v: 2, rules: killRules() }],
        ['kurallar bozuk', { v: 1, rules: { version: 'x' } }],
        ['dize', 'bozuk'],
        ['null', null],
    ])('R4: bozuk kalici kayit (%s) yok sayilir: gomulu kopyayla devam, cokme yok, kayit SILINMEZ', async (_ad, kayit) => {
        localStore.stock_gate_rules_cache = structuredClone(kayit)
        // Gomulu kopya gecerli ve alim acik: sunucu ulkeyi verirse OK, vermezse COUNTRY_UNKNOWN (RULES_INVALID / KILL_SWITCH degil).
        expect((await call('STOCK_GATE_STATUS')).bstocks).toEqual({ decision: 'BLOCKED', reason: 'COUNTRY_UNKNOWN', ipCountry: null })
        expect(localStore.stock_gate_rules_cache).toEqual(kayit)
    })
})

describe('background.js -- kaynak kilitleri', () => {
    const BG = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')
    const KOD = yorumsuz(BG)

    it('tembel TEK kapi ornegi: createStockGate( bir kez cagrilir', () => {
        expect(KOD.match(/createStockGate\(/g)).toHaveLength(1)
        expect(KOD).toMatch(/function getStockGate\(\)/)
    })

    it('tek `case` STOCK_GATE_STATUS var; isleyicide try / catch var ve `account` OKUNMAZ; ...g yayilimi yok ve govde OKUNMAZ (G11)', () => {
        expect(KOD).toMatch(/case\s+["']STOCK_GATE_STATUS["']\s*:/)
        const govde = blokGovdesi(BG, /async function stockGateStatus\(/)
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/\btry\b[\s\S]*\bcatch\b/)
        expect(govde).not.toMatch(/\baccount\b/)
        expect(govde).not.toMatch(/\.\.\.g\b/)
        expect(govde).toMatch(/getStockGate\(\)\.status\(/)
        expect(govde).not.toMatch(/message\.message|\.issuer\b/)
    })

    it('STOCK_GATE_DECLARE / LIST / RESET icin case ve isleyici yok (K32; kaynak taramasi)', () => {
        expect(KOD.match(/case\s+["']STOCK_GATE_[A-Z_]+["']\s*:/g)).toHaveLength(1)
        for (const ad of ['STOCK_GATE_DECLARE', 'STOCK_GATE_LIST', 'STOCK_GATE_RESET', 'stockGateDeclare', 'stockGateList', 'stockGateReset']) {
            expect(KOD, ad).not.toContain(ad)
        }
    })

    it('kapi fabrikasi beyan ve hesap bagimliligi almaz (createDeclarations, getActiveAccount, declarations yok; K39)', () => {
        expect(KOD).not.toMatch(/createDeclarations|getActiveAccount|declarations\b|stock_declarations/)
        const blok = KOD.slice(KOD.indexOf('createStockGate({'), KOD.indexOf('createStockGate({') + 600)
        expect(blok).toMatch(/stockIssuer:\s*stockOutputIssuer/)
        expect(blok).toMatch(/rulesClient:\s*createRulesClient/)
    })

    it('kapi bayraga bagli degil: background.js kapi kablolamasi featureFlags ile kosullanmaz', () => {
        const blok = KOD.slice(KOD.indexOf('let stockGateRuntime'), KOD.indexOf('function deserializeTx('))
        expect(blok.length).toBeGreaterThan(200)
        expect(blok).not.toMatch(/SOLANA_ENABLED|XSTOCKS_ENABLED/)
    })
})
