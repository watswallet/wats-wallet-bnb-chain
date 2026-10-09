import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * EVM olay yayini CERCEVE duzeyinde calisir -- ust cerceve hostname'iyle DEGIL.
 *
 * KOK NEDEN: EVM oturumlari `resolveSenderOrigin` ile, yani ISTEGI GONDEREN
 * CERCEVENIN hostname'iyle anahtarlanir (dappFunctions.js, iframe notu). Oysa
 * `notifyConnectedDapps` sekmeyi `tab.url`in -- UST CERCEVENIN adresinin --
 * hostname'iyle suzuyordu. Bir dapp iframe icinde calisiyorsa `tab.url` dapp'in
 * adresini HIC TASIMAZ (sarmalayici/aggregator sitesinin adresidir), dolayisiyla
 * o sekme `connectedHostnames` ile ESLESMEZ ve iframe'deki dapp
 * disconnect/connect/chainChanged olaylarini ASLA ALMAZ.
 *
 * DUZELTME TON seridinde ZATEN UYGULANMIS olan desendir (notifyTonDapp, Gorev 14
 * ve content.js'teki cerceve suzgeci): yeni permission EKLEMEDEN,
 * `chrome.tabs.sendMessage(tabId, msg)` frameId VERILMEDEN o sekmenin TUM
 * cercevelerine ulasir; hedef hostname mesajin ICINDE tasinir ve hangi cercevenin
 * sayfaya iletecegine content.js kendi `window.location.hostname`iyle karar verir.
 *
 * T14a (WalletConnect QA): `ACCOUNT_CHANGED` artik EVM `accountsChanged` YAYMAZ;
 * hesap degisiminin TEK tetikleyicisi `chrome.storage.onChanged` `active_account`
 * dinleyicisidir (spec 6 G4 f). Bu yuzden cerceve/sekme basina-tek-mesaj
 * degismezleri `CHAIN_CHANGED` yolundan (ayni notifyConnectedDapps govdesi) olculur;
 * hesap degisimine ozgu kurallar asagidaki ikinci blokta.
 *
 * Harness background.solanaAccountChanged.test.js'ten alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'

let messageListener
let onChangedDinleyicileri
let localStore
let sentTabMessages
let openTabs

// UST CERCEVE bir sarmalayici site; BAGLI dapp onun ICINDEKI iframe'de.
// `chrome.tabs.query` yalnizca UST cerceve adresini dondurur -- defektin tam
// kaynagi budur, bu yuzden stub gercek Chrome gibi SADECE onu dondurur.
const SARMALAYICI_SEKME = { id: 7, url: 'https://portal.example/swap' }

// UST CERCEVESI http(s) OLMAYAN sekme: icinde http(s) bir dapp iframe'i tasiyabilir.
// Eski `chrome.tabs.query({ url: ['http://*/*','https://*/*'] })` bu sekmeyi ELERDI ve
// icindeki dapp olaylari YINE alamazdi -- bu yuzden url suzgecinin kalkmasi
// AYRICA olculur (sorgu argumanini yoksayan bir stub o parcayi hic gormezdi).
const UZANTI_SEKMESI = { id: 9, url: 'about:blank' }

const ADDR_A = '0x' + 'a1'.repeat(20)
const ADDR_B = '0x' + 'b2'.repeat(20)
const ADDR_C = '0x' + 'c3'.repeat(20)
const TON_ADRESI = 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r'

const hesap = (address, type = 'hd') => ({ key: `k-${address.slice(2, 6)}`, type, address })

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [], onChanged: [] }
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
                get: vi.fn(async () => ({})),
                set: vi.fn(async () => {}),
                remove: vi.fn(async () => {}),
            },
            onChanged: add('onChanged'),
        },
        tabs: {
            // GERCEK Chrome gibi: `url` deseni verilirse SUZER. Argumani yoksayan bir
            // stub, "url suzgeci kalkti" degisikligini olcemez -- eski koda donunce
            // testler YESIL kalirdi.
            query: vi.fn(async (sorgu) => {
                if (!sorgu?.url) return openTabs
                return openTabs.filter((t) => /^https?:/.test(t.url))
            }),
            sendMessage: vi.fn((tabId, msg) => {
                sentTabMessages.push({ tabId, msg })
                return Promise.resolve()
            }),
            create: vi.fn(),
        },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return { listeners }
}

// Gercek `navigator.locks` gibi SIRALI (Node'da `locks` yok; dappsStore bunu ister).
function makeLocks() {
    let kuyruk = Promise.resolve()
    return {
        request: vi.fn((ad, a, b) => {
            const cb = typeof a === 'function' ? a : b
            const calisan = kuyruk.then(() => cb({ name: ad }))
            kuyruk = calisan.catch(() => {})
            return calisan
        }),
    }
}

// Mevcut navigator nesnesine YALNIZ `locks` eklenir (navigator'in tamamini degistirmek
// arka plan modullerinin yukledigi kutuphanelerin ortam sezgisini bozabilir).
function installLocks() {
    Object.defineProperty(globalThis.navigator, 'locks', { value: makeLocks(), configurable: true, writable: true })
}

function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

const evmMesajlari = () => sentTabMessages.filter((m) => m.msg.target === 'wats_inpage')
const accountsChangedMesajlari = () => evmMesajlari().filter((m) => m.msg.method === 'accountsChanged')

async function kur() {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    openTabs = [SARMALAYICI_SEKME, UZANTI_SEKMESI]
    localStore = {
        // Oturum IFRAME'in hostname'iyle anahtarlanmis -- ust cerceve
        // (portal.example) burada HIC GECMIYOR.
        dapps: { 'dapp.example': { accounts: ['0xAaaa'], chainId: '0x1' } },
    }
    const stub = installChromeStub()
    installLocks()
    await import('./background.js')
    messageListener = stub.listeners.onMessage[0]
    onChangedDinleyicileri = stub.listeners.onChanged
}

beforeEach(kur)

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.navigator.locks
})

describe('notifyConnectedDapps -- iframe icindeki EVM dapp olayi ALIR (ust cerceve hostname i suzgec DEGILDIR)', () => {
    it('ust cerceve BAGLI DEGILKEN bile sekmeye mesaj gider (iframe orada olabilir)', async () => {
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        // ESKI DAVRANIS: sifir mesaj -- `portal.example` connectedHostnames'te
        // olmadigi icin sekme tumden atlaniyordu ve iframe'deki dapp olayi
        // hicbir zaman gormuyordu.
        expect(evmMesajlari().length).toBeGreaterThan(0)
        expect(evmMesajlari()[0].tabId).toBe(7)
    })

    it('mesaj HEDEF hostname LISTESINI tasir: hangi cercevenin iletecegine content.js karar verir', async () => {
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(evmMesajlari()[0].msg).toEqual(expect.objectContaining({
            target: 'wats_inpage',
            hostnames: ['dapp.example'],
            method: 'chainChanged',
            result: '0x89',
        }))
    })

    // UST CERCEVESI http(s) OLMAYAN sekme de kapsanir: dapp onun ICINDEKI bir
    // iframe'de olabilir ve eski `url` suzgeci o sekmeyi tumden eliyordu.
    it('ust cercevesi about:blank olan sekme de mesaj ALIR (url suzgeci kalkti)', async () => {
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(evmMesajlari().map((m) => m.tabId).sort()).toEqual([7, 9])
    })

    // MALIYET KILIDI: mesaj sayisi SEKME BASINA BIR olmali, "sekme x bagli dapp"
    // CARPIMI degil. Ilk surum hostname basina AYRI mesaj yolluyordu; 20 bagli
    // dapp + 100 sekme = 2.000 sendMessage (ve frameId verilmedigi icin her biri o
    // sekmenin TUM cercevelerine dagiliyordu). Carpim, tek sekmeli bir testte
    // GORUNMEZ -- bu yuzden iki sekme ve uc hostname ile olculur.
    it('sekme basina TEK mesaj gider (sayi, bagli dapp sayisiyla CARPILMAZ)', async () => {
        localStore.dapps = {
            'dapp.example': { accounts: ['0xAaaa'], chainId: '0x1' },
            'ikinci.example': { accounts: ['0xAaaa'], chainId: '0x1' },
            'ucuncu.example': { accounts: ['0xAaaa'], chainId: '0x1' },
        }

        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        // 2 sekme x 3 bagli dapp = 6 DEGIL, 2 olmali.
        expect(evmMesajlari()).toHaveLength(2)
    })

    it('liste TAM OLARAK bagli hostname leri tasir', async () => {
        localStore.dapps = {
            'dapp.example': { accounts: ['0xAaaa'], chainId: '0x1' },
            'ikinci.example': { accounts: ['0xAaaa'], chainId: '0x1' },
        }

        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect([...evmMesajlari()[0].msg.hostnames].sort()).toEqual(['dapp.example', 'ikinci.example'])
    })

    it('hic bagli dapp yoksa hicbir sekmeye mesaj gitmez (regresyon)', async () => {
        localStore.dapps = {}

        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(evmMesajlari()).toHaveLength(0)
    })
})

describe('CHAIN_CHANGED -- dapps yazimi dappsStore.updateDapps uzerinden (spec 7.1 madde 1)', () => {
    it('chainId TUM kayitlarda guncellenir, diger alanlar korunur', async () => {
        localStore.dapps = {
            'dapp.example': { accounts: [ADDR_A], chainId: '0x1', origin: 'https://dapp.example', followActive: true },
            'ikinci.example': { accounts: [ADDR_B], chainId: '0x1', gasless: true },
        }

        const res = await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(res.success).toBe(true)
        expect(localStore.dapps).toEqual({
            'dapp.example': { accounts: [ADDR_A], chainId: '0x89', origin: 'https://dapp.example', followActive: true },
            'ikinci.example': { accounts: [ADDR_B], chainId: '0x89', gasless: true },
        })
    })

    // KAYIP-GUNCELLEME: eski kod haritayi kilitsiz okuyup geri yaziyordu; arada
    // baska bir yazici (popup, wallet_revokePermissions) kayit eklese/silse o
    // degisiklik GERI ALINIRDI. Kilit altinda okuma-degistir-yaz bunu onler.
    it('yazim kilit altinda okur: kilit beklenirken eklenen kayit KAYBOLMAZ', async () => {
        const locks = globalThis.navigator.locks
        const asil = locks.request.getMockImplementation()
        locks.request.mockImplementation(async (ad, a, b) => {
            // Kilit sirasini beklerken baska bir yazici yeni bir kayit yazdi.
            localStore.dapps = { ...localStore.dapps, 'yeni.example': { accounts: [ADDR_C], chainId: '0x1' } }
            return asil(ad, a, b)
        })

        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })

        expect(locks.request.mock.calls.some((c) => c[0] === 'wats-dapps')).toBe(true)
        expect(localStore.dapps['yeni.example']).toEqual({ accounts: [ADDR_C], chainId: '0x89' })
        expect(localStore.dapps['dapp.example'].chainId).toBe('0x89')
    })
})

describe('ACCOUNT_CHANGED artik EVM accountsChanged YAYMAZ (spec 6 G4 f: tek tetikleyici onChanged)', () => {
    it('mesaj basarili doner ama hicbir sekmeye EVM olayi gitmez', async () => {
        localStore.dapps = { 'dapp.example': { accounts: [ADDR_A], chainId: '0x1', followActive: true } }
        openTabs = [{ id: 11, url: 'https://dapp.example/swap' }]

        const res = await callHandler({ type: 'ACCOUNT_CHANGED', address: ADDR_B })

        expect(res.success).toBe(true)
        expect(evmMesajlari()).toEqual([])
        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_A])
    })
})

describe('active_account storage.onChanged -- hesap degisiminin TEK tetikleyicisi (spec 6 G4 f, 7.4 C)', () => {
    const DAPP_SEKMESI = { id: 11, url: 'https://dapp.example/swap' }

    beforeEach(() => {
        localStore.dapps = {
            'dapp.example': { accounts: [ADDR_A], chainId: '0x1', origin: 'https://dapp.example', followActive: true },
        }
        openTabs = [DAPP_SEKMESI]
        // T3 uygulayicisi yeni EVM adresinin KASADA olmasini ister (spec 6 G4: kasa hesabina ait olmali).
        localStore.vaults = [{ id: 'v1', type: 'mnemonic', accounts: [hesap(ADDR_A), hesap(ADDR_B), hesap(ADDR_C)] }]
    })

    // `diskte`: dinleyicinin OKUMASI gereken guncel active_account (olay yukunden
    // BAGIMSIZ: spec "olay yukune degil diske bakilir").
    async function degisimYolla(eski, yeni, { alan = 'local', diskte = yeni, anahtar = 'active_account' } = {}) {
        localStore.active_account = diskte
        const changes = { [anahtar]: { oldValue: eski, newValue: yeni } }
        await Promise.all(onChangedDinleyicileri.map((fn) => fn(changes, alan)))
    }

    it('takip eden, acik sekmeli site: accounts [yeni] olur ve TEK accountsChanged gider', async () => {
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_B])
        const mesajlar = accountsChangedMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0].tabId).toBe(11)
        expect(mesajlar[0].msg.hostnames).toEqual(['dapp.example'])
        expect(mesajlar[0].msg.result).toEqual([ADDR_B])
    })

    it('AYNI olayin iki kez teslimi (cift onChanged) ikinci kez bildirmez', async () => {
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(accountsChangedMesajlari()).toHaveLength(1)
        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_B])
    })

    it('Header yazimi (onChanged) + ACCOUNT_CHANGED mesaji TOPLAMDA tam BIR accountsChanged', async () => {
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))
        const res = await callHandler({ type: 'ACCOUNT_CHANGED', address: ADDR_B })

        expect(res.success).toBe(true)
        expect(accountsChangedMesajlari()).toHaveLength(1)
    })

    it('ACCOUNT_CHANGED once, onChanged sonra gelse de TOPLAMDA tam BIR accountsChanged', async () => {
        localStore.active_account = hesap(ADDR_B)
        await callHandler({ type: 'ACCOUNT_CHANGED', address: ADDR_B })
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(accountsChangedMesajlari()).toHaveLength(1)
    })

    it('uykudaki site (acik sekmesi yok) DOKUNULMAZ ve bildirilmez (kimlik iliskilendirme yok)', async () => {
        const uyuyan = { accounts: [ADDR_A], chainId: '0x1', origin: 'https://uyuyan.example', followActive: true }
        localStore.dapps['uyuyan.example'] = uyuyan

        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(localStore.dapps['uyuyan.example']).toEqual(uyuyan)
        for (const m of accountsChangedMesajlari()) {
            expect(m.msg.hostnames).not.toContain('uyuyan.example')
        }
    })

    it('takip ETMEYEN site, yeni hesap izinli DEGILSE: kayit ve bildirim YOK (izinsiz adres sizmaz)', async () => {
        const kayit = { accounts: [ADDR_A], chainId: '0x1', origin: 'https://dapp.example', followActive: false }
        localStore.dapps['dapp.example'] = kayit

        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(localStore.dapps['dapp.example']).toEqual(kayit)
        expect(accountsChangedMesajlari()).toEqual([])
    })

    it('takip ETMEYEN site, yeni hesap izinliyse aktif hesap BASA alinir ve bildirilir', async () => {
        localStore.dapps['dapp.example'] = {
            accounts: [ADDR_A, ADDR_B], chainId: '0x1', origin: 'https://dapp.example', followActive: false,
        }

        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_B, ADDR_A])
        const mesajlar = accountsChangedMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0].msg.result).toEqual([ADDR_B, ADDR_A])
    })

    it('yeni hesap EVM DEGILSE (TON): izinler degismez, acik sekmeli siteye accountsChanged([]) gider', async () => {
        await degisimYolla(hesap(ADDR_A), hesap(TON_ADRESI, 'ton'))

        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_A])
        const mesajlar = accountsChangedMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0].msg.result).toEqual([])
    })

    it('TON hesabindan EVM hesabina DONUS: [] almis dapp, kayit ayni olsa da accountsChanged([yeni]) alir', async () => {
        await degisimYolla(hesap(TON_ADRESI, 'ton'), hesap(ADDR_A))

        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_A])
        const mesajlar = accountsChangedMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0].msg.result).toEqual([ADDR_A])
    })

    it('iki EVM olmayan hesap arasi gecis (TON -> TON) dapp e tekrar bildirilmez', async () => {
        await degisimYolla(hesap(TON_ADRESI, 'ton'), hesap('UQ-baska-ton-adresi', 'ton'))

        expect(evmMesajlari()).toEqual([])
    })

    // FAIL-CLOSED (spec 9 madde 10): hesabin EVM oldugu KANITLANMADIYSA (tipi eksik)
    // adres 0x gibi gorunse bile dapp'e verilmez, duyurulmaz ve izinler degismez.
    it('tipi BILINMEYEN hesap (0x adresli) EVM sayilmaz: izinler degismez, accountsChanged([]) gider', async () => {
        await degisimYolla(hesap(ADDR_A), { key: 'k-tipsiz', address: ADDR_B })

        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_A])
        const mesajlar = accountsChangedMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0].msg.result).toEqual([])
    })

    it('oldValue yoksa (ilk yazim) hicbir sey yapmaz', async () => {
        await degisimYolla(undefined, hesap(ADDR_B))

        expect(evmMesajlari()).toEqual([])
        expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled()
    })

    it('baska depo alani veya baska anahtar degisimi hicbir sey yapmaz', async () => {
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B), { alan: 'sync' })
        await degisimYolla(1, 2, { anahtar: 'lastActiveTime', diskte: hesap(ADDR_B) })

        expect(evmMesajlari()).toEqual([])
        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_A])
    })

    it('ayni adres (hesap adi/alani degisti): bildirim ve yazim YOK', async () => {
        await degisimYolla(hesap(ADDR_A), { ...hesap(ADDR_A), name: 'Yeni ad' })

        expect(evmMesajlari()).toEqual([])
        expect(globalThis.chrome.storage.local.set).not.toHaveBeenCalled()
    })

    it('yeni adres olay yukunden DEGIL, DISKTEKI active_account tan okunur', async () => {
        // Olay "C" diyor ama disk "B": kayit B'ye gitmeli.
        await degisimYolla(hesap(ADDR_A), hesap(ADDR_C), { diskte: hesap(ADDR_B) })

        expect(localStore.dapps['dapp.example'].accounts).toEqual([ADDR_B])
    })

    // BILINEN SINIR (karar, spec 6 G4): "acik sekmeli" = sekmenin UST CERCEVE
    // hostname'i. iframe icindeki dapp'in hostname'i sekme sorgusundan
    // ogrenilemez (webNavigation izni yok). Guvenli yon: takip ETMEZ, kaydina
    // dokunulmaz, bildirim gitmez -- yani izinsiz sizinti ve kimlik
    // iliskilendirme olmaz; yalniz o dapp yeni hesabi kendiliginden gormez.
    it('iframe icindeki dapp (ust cerceve baska host) acik sekme SAYILMAZ: kayda dokunulmaz', async () => {
        const once = JSON.parse(JSON.stringify(localStore.dapps['dapp.example']))
        openTabs = [SARMALAYICI_SEKME]

        await degisimYolla(hesap(ADDR_A), hesap(ADDR_B))

        expect(localStore.dapps['dapp.example']).toEqual(once)
        expect(accountsChangedMesajlari()).toEqual([])
    })

    it('hata dinleyiciden DISARI sizmaz (yakalanir ve loglanir)', async () => {
        const hata = vi.spyOn(console, 'error').mockImplementation(() => {})
        globalThis.chrome.tabs.query.mockRejectedValue(new Error('sekme sorgusu coktu'))

        await expect(degisimYolla(hesap(ADDR_A), hesap(ADDR_B))).resolves.toBeUndefined()

        expect(hata).toHaveBeenCalled()
        hata.mockRestore()
    })
})
