import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// Gizli mod gecis yan etkilerinin KENDINI ONARMASI (Task 20) -- GERCEK dagitici uzerinden.
// Yan etkiler (bekleyen onaylari iptal, donmus zincir kaydi, cikista tek uzlastirma) mesaja
// degil DEPODAKI aktif hesaba bakar: PRIVACY_MODE_SET disinda bir yol aktif hesabi Gizli
// Hesap'a sokarsa / cikarirsa ACCOUNT_CHANGED (ya da servis calisani acilisi) gecisi tamamlar.

// Giris, gercek setPrivacyMode yerine bu sahte ile yapilir (kasa acma / HD turetme bu
// testin konusu degil); cikis GERCEK setPrivacyMode'dur.
let girisSahte = null
vi.mock('./utils/privacy/privacyMode', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        setPrivacyMode: (enabled, deps) => (enabled && girisSahte ? girisSahte(enabled, deps) : actual.setPrivacyMode(enabled, deps)),
    }
})

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const YABANCI_SENDER = { url: 'https://yabanci.example/', origin: 'https://yabanci.example', tab: { id: 5, url: 'https://yabanci.example/' } }
const DAPP_SENDER = { url: 'https://site.example/app', origin: 'https://site.example', tab: { id: 3, url: 'https://site.example/app' } }
const ETH = { chainId: 1, name: 'Ethereum' }
const POLYGON = { chainId: 137, name: 'Polygon' }
const FROZEN = 'privacy_frozen_network'
const KAPALI_CEVAP = { error: { code: 4001, message: 'User closed the window.' } }

let bg, localStore
const callHandler = (...args) => bg.call(...args)
const sakinles = () => new Promise((resolve) => setTimeout(resolve, 20))
const olaylar = (method) => chrome.tabs.sendMessage.mock.calls.map((c) => c[1]).filter((m) => m.method === method)

async function boot({ flag = 'true', active = A, extra = {}, ...opts } = {}) {
    localStore = {
        active_account: active,
        vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
        currentNetwork: ETH,
        privacy_mode: { lastPublicAccountKey: 'a-1', introSeen: true },
        dapps: { 'site.example': { accounts: [A.address], chainId: '0x1' } },
        solana_dapps: {},
        ...extra,
    }
    // Acik sekme (site.example): hesap degisiminin EVM yayini (onChanged -> applyAccountSwitchToDapps)
    // yalniz ACIK sekmeli sitelere gider.
    bg = await bootBackground({ privacyFlag: flag, localStore, sessionStore: {}, tabs: [{ id: 3, url: 'https://site.example/app' }], ...opts })
    await sakinles()
    chrome.tabs.sendMessage.mockClear()
    chrome.windows.remove.mockClear()
}

// Bir yabanci site popup acan bir istek yollar; popup'in acik kalmasi "bekleyen onay"dir.
async function bekleyenIstek() {
    chrome.windows.create.mockClear()
    const bekleyen = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
    await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
    let bitti = false
    bekleyen.then(() => { bitti = true })
    return { bekleyen, bittiMi: () => bitti }
}

// Header.changeAccount: active_account'u ONCE yazar, sonra ACCOUNT_CHANGED yollar.
// Gercek chrome'da bu yazim onChanged'i de atesler (oldValue/newValue ile); hesap degisiminin EVM
// yayini (WalletConnect 1.8.3 birlesmesi) YALNIZ oradan gider, ACCOUNT_CHANGED EVM yaymaz.
async function hesapSec(hesap) {
    const eski = localStore.active_account
    localStore.active_account = hesap
    for (const fn of bg.listeners.onChanged) fn({ active_account: { oldValue: eski, newValue: hesap } }, 'local')
    const cevap = await callHandler({ type: 'ACCOUNT_CHANGED', address: hesap.address })
    await sakinles()
    return cevap
}

beforeEach(() => {
    girisSahte = null
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    await sakinles()
    teardownBackground()
    vi.restoreAllMocks()
})

describe('ACCOUNT_CHANGED: Gizli Hesap tarafindan CIKAN hesap secimi cikis yan etkilerini calistirir', () => {
    // P5: onarim yolu (hesabi MESAJSIZ yazan yuzey) ana yolla AYNI sonucu verir: giris oncesi ag geri yazilir
    // (eskiden burada tek uzlastirma chainChanged 0x89 beklenirdi: son gizli ag sitelere gorunurdu).
    it('bekleyen onay 4001 alir, donmus kayit silinir, giris oncesi ag geri yazilir ve sitelere chainChanged GITMEZ', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON, last_evm_chain_id: 137 } })
        const { bekleyen } = await bekleyenIstek()
        expect(localStore.current_request.type).toBe('PRIVACY_BLOCKED')

        const cevap = await hesapSec(A)
        expect(cevap).toEqual({ success: true })

        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        expect(localStore.current_request).toBeUndefined()
        expect(localStore[FROZEN]).toBeUndefined()
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(localStore.last_evm_chain_id).toBe(1)
        expect(olaylar('chainChanged')).toEqual([])
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [A.address] })])
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
    })

    it('canli zincir donmus zincirle aynisa uzlastirma YOLLANMAZ ama kayit silinir, onay iptal edilir', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: ETH } })
        const { bekleyen } = await bekleyenIstek()
        await hesapSec(A)
        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        expect(olaylar('chainChanged')).toEqual([])
        expect(localStore[FROZEN]).toBeUndefined()
    })
})

describe('ACCOUNT_CHANGED: Gizli Hesap\'a GIREN hesap secimi giris yan etkilerini calistirir', () => {
    it('bekleyen onay 4001 alir, donmus kayit snapshot olur, Gizli Hesap adresi duyurulmaz, zincir donar', async () => {
        await boot()
        const { bekleyen } = await bekleyenIstek()
        expect(localStore.current_request.type).toBe('CONNECT')

        await hesapSec(GIZLI)

        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        expect(localStore.current_request).toBeUndefined()
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('accountsChanged')).toEqual([expect.objectContaining({ result: [] })])
        // Giristen sonra ag degisimi yayinlanmaz (donmus zincir devrede).
        chrome.tabs.sendMessage.mockClear()
        localStore.currentNetwork = POLYGON
        await callHandler({ type: 'CHAIN_CHANGED', chainId: 137 })
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x1' })
    })

    it('ag kaydi hic yoksa snapshot null yazilir (kayit var = gecis tamam)', async () => {
        await boot()
        delete localStore.currentNetwork
        await hesapSec(GIZLI)
        expect(localStore[FROZEN]).toBeNull()
    })
})

describe('ACCOUNT_CHANGED: idempotent ve PRIVACY_MODE_SET ile CIFT CALISMAZ', () => {
    it('ayni ACCOUNT_CHANGED iki kez: ikinci cagri hicbir sey yapmaz (ag bir kez geri yazilir, yeni onaya dokunmaz)', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        await hesapSec(A)
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])

        const yeni = await bekleyenIstek()
        expect(localStore.current_request.type).toBe('CONNECT')
        chrome.storage.local.set.mockClear()
        await callHandler({ type: 'ACCOUNT_CHANGED', address: A.address })
        await sakinles()
        expect(chrome.storage.local.set.mock.calls.filter(([nesne]) => 'currentNetwork' in nesne)).toEqual([])
        expect(olaylar('chainChanged')).toEqual([])
        expect(yeni.bittiMi()).toBe(false)
        expect(localStore.current_request.type).toBe('CONNECT')

        for (const fn of bg.listeners.onRemoved) fn(1)
        await yeni.bekleyen
    })

    it('PRIVACY_MODE_SET cikisini tamamladiysa ardindan gelen ACCOUNT_CHANGED yan etkileri TEKRARLAMAZ', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(cikis.success).toBe(true)
        // P5: cikis giris oncesi agi (ETH) hesap yazimiyla birlikte geri yazdi; sitelere olay gitmez.
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])

        // Header de cikistan sonra ACCOUNT_CHANGED yollar; bu arada yeni bir onay acildi.
        const yeni = await bekleyenIstek()
        chrome.windows.remove.mockClear()
        chrome.storage.local.set.mockClear()
        await callHandler({ type: 'ACCOUNT_CHANGED', address: A.address })
        await sakinles()

        // Yan etkiler TEKRARLANMAZ: yeni ag yazimi, olay ya da onay iptali yok.
        expect(chrome.storage.local.set.mock.calls.filter(([nesne]) => 'currentNetwork' in nesne)).toEqual([])
        expect(olaylar('chainChanged')).toEqual([])
        expect(yeni.bittiMi()).toBe(false)
        expect(chrome.windows.remove).not.toHaveBeenCalled()

        for (const fn of bg.listeners.onRemoved) fn(1)
        await yeni.bekleyen
    })

    it('PRIVACY_MODE_SET girisini tamamladiysa ardindan gelen ACCOUNT_CHANGED snapshot\'i EZMEZ, onaya dokunmaz', async () => {
        await boot()
        girisSahte = async (_enabled, deps) => {
            await chrome.storage.local.set({ active_account: GIZLI, currentNetwork: POLYGON })
            await deps.announce(GIZLI)
            return { enabled: true, account: GIZLI }
        }
        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(giris.success).toBe(true)
        // Snapshot girisin ONCEKI agi (ETH); girisin kendi cevirdigi ag (POLYGON) degil.
        expect(localStore[FROZEN]).toEqual(ETH)

        const yeni = await bekleyenIstek()
        expect(localStore.current_request.type).toBe('PRIVACY_BLOCKED')
        chrome.windows.remove.mockClear()
        await callHandler({ type: 'ACCOUNT_CHANGED', address: GIZLI.address })
        await sakinles()

        expect(localStore[FROZEN]).toEqual(ETH)
        expect(yeni.bittiMi()).toBe(false)
        expect(chrome.windows.remove).not.toHaveBeenCalled()

        for (const fn of bg.listeners.onRemoved) fn(1)
        await yeni.bekleyen
    })

    it('normal modda donmus kayit yokken ACCOUNT_CHANGED bekleyen onaya DOKUNMAZ (siradan hesap degisimi)', async () => {
        await boot()
        const { bekleyen, bittiMi } = await bekleyenIstek()
        await hesapSec({ ...A, key: 'a-2', address: '0x' + '12'.repeat(20) })
        await sakinles()
        expect(bittiMi()).toBe(false)
        expect(localStore[FROZEN]).toBeUndefined()
        expect(chrome.windows.remove).not.toHaveBeenCalled()
        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyen
    })
})

// storage.onChanged'i gercek chrome gibi calistirir: yazim sonrasi dinleyiciler cagrilir.
function onChangedTetikle(changes, area = 'local') {
    for (const fn of bg.listeners.onChanged) fn(changes, area)
}

// chrome.storage.local.set aktif hesabi yazarsa onChanged de atesler (gercek tarayici davranisi).
function setiOnChangedeBagla() {
    const gercekSet = chrome.storage.local.set.getMockImplementation()
    chrome.storage.local.set.mockImplementation(async (obj) => {
        await gercekSet(obj)
        if (obj.active_account) onChangedTetikle({ active_account: { newValue: obj.active_account } })
    })
}

describe('storage.onChanged: aktif hesabi HERHANGI bir yol degistirirse yan etkiler depoyu izler (I1)', () => {
    it('mesajsiz cikis (yeni genel hesap ekleme gibi): active_account yazilir, 4001 + giris oncesi ag geri yazilir + kayit silinir, chainChanged YOK', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const { bekleyen } = await bekleyenIstek()
        localStore.active_account = A
        onChangedTetikle({ active_account: { newValue: A } })

        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        await sakinles()
        expect(localStore[FROZEN]).toBeUndefined()
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
    })

    // Mesajsiz yazar hesabi KENDI yazimiyla degistirir, agi biz atomik yazamayiz: yazim ile onarim arasindaki
    // pencerede siteler donmus kaydi gormeli (dappVisibleNetwork hesap turune bakmadan kaydi dondurur).
    it('P5 pencere: hesap yazildi, onarim henuz kosmadi: eth_chainId ve net_version DONMUS agi verir; onarim sonrasi da ayni', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        localStore.active_account = A // onChanged TETIKLENMEDI: onarim kosmadi
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x1' })
        expect(await callHandler({ method: 'net_version' }, DAPP_SENDER)).toEqual({ result: '1' })

        onChangedTetikle({ active_account: { newValue: A } })
        await sakinles()
        expect(localStore[FROZEN]).toBeUndefined()
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x1' })
        expect(olaylar('chainChanged')).toEqual([])
    })

    it('KONTROL: onarim yolunda da donmus zincir paketli listede yoksa geri yazim yok; bugunku uzlastirma calisir', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: { chainId: 99999, name: 'Kaldirilmis ag' }, currentNetwork: POLYGON } })
        localStore.active_account = A
        onChangedTetikle({ active_account: { newValue: A } })
        await sakinles()
        expect(localStore[FROZEN]).toBeUndefined()
        expect(localStore.currentNetwork).toEqual(POLYGON)
        expect(olaylar('chainChanged')).toEqual([expect.objectContaining({ result: '0x89' })])
    })

    it('geri yazim DUSERSE (ag yazimi hatasi) cikis yine tamamlanir: bugunku uzlastirma chainChanged yollar, kayit silinir', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const gercekSet = chrome.storage.local.set.getMockImplementation()
        chrome.storage.local.set.mockImplementation(async (nesne) => {
            if ('currentNetwork' in nesne) throw new Error('depo yazilamadi')
            return gercekSet(nesne)
        })
        localStore.active_account = A
        onChangedTetikle({ active_account: { newValue: A } })
        await sakinles()
        expect(localStore.currentNetwork).toEqual(POLYGON)
        expect(olaylar('chainChanged')).toEqual([expect.objectContaining({ result: '0x89' })])
        expect(localStore[FROZEN]).toBeUndefined()
        expect(console.error.mock.calls.map((c) => String(c[0])).join(' | ')).toContain('gizli mod cikisi ag geri yazimi')
    })

    it('mesajsiz giris: active_account Gizli Hesap olur, snapshot yazilir, bekleyen onay iptal edilir', async () => {
        await boot()
        const { bekleyen } = await bekleyenIstek()
        localStore.active_account = GIZLI
        onChangedTetikle({ active_account: { newValue: GIZLI } })

        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        expect(localStore[FROZEN]).toEqual(ETH)
    })

    it('baska alan (vaults) ya da baska alan adi (sync) heal tetiklemez', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        localStore.active_account = A
        onChangedTetikle({ vaults: { newValue: [] } })
        onChangedTetikle({ active_account: { newValue: A } }, 'sync')
        await sakinles()
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
    })

    it('bayrak KAPALIYKEN active_account degisimi hicbir sey yapmaz', async () => {
        await boot({ flag: 'false', extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        localStore.active_account = A
        onChangedTetikle({ active_account: { newValue: A } })
        await sakinles()
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
    })

    it('depo okunamazsa onChanged heal hicbir yan etki calistirmaz (fail-closed)', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const { bekleyen, bittiMi } = await bekleyenIstek()
        const gercekGet = chrome.storage.local.get.getMockImplementation()
        chrome.storage.local.get.mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.includes(FROZEN)) throw new Error('disk')
            return gercekGet(keys)
        })
        localStore.active_account = A
        onChangedTetikle({ active_account: { newValue: A } })
        await sakinles()
        expect(bittiMi()).toBe(false)
        expect(localStore[FROZEN]).toEqual(ETH)

        chrome.storage.local.get.mockImplementation(gercekGet)
        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyen
    })

    it('PRIVACY_MODE_SET cikisi: kendi active_account yazimi onChanged atesler ama yan etkiler TEK KEZ', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        setiOnChangedeBagla()
        const { bekleyen } = await bekleyenIstek()
        chrome.windows.remove.mockClear()

        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(cikis.success).toBe(true)
        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        await sakinles()

        // P5: ag hesap yazimiyla birlikte geri yazildi (onChanged'in tetikledigi onarim bunu TEKRARLAMAZ), olay yok.
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
        expect(localStore[FROZEN]).toBeUndefined()
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
        // Sonradan acilan onaya dokunulmaz.
        const yeni = await bekleyenIstek()
        await sakinles()
        expect(yeni.bittiMi()).toBe(false)
        for (const fn of bg.listeners.onRemoved) fn(1)
        await yeni.bekleyen
    })

    it('PRIVACY_MODE_SET girisi: kendi active_account yazimi onChanged atesler, snapshot ezilmez, onay TEK KEZ iptal edilir', async () => {
        await boot()
        setiOnChangedeBagla()
        girisSahte = async (_enabled, deps) => {
            await chrome.storage.local.set({ active_account: GIZLI, currentNetwork: POLYGON })
            await deps.announce(GIZLI)
            return { enabled: true, account: GIZLI }
        }
        const { bekleyen } = await bekleyenIstek()
        chrome.windows.remove.mockClear()

        const giris = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(giris.success).toBe(true)
        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        await sakinles()

        expect(localStore[FROZEN]).toEqual(ETH)
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
        const yeni = await bekleyenIstek()
        await sakinles()
        expect(yeni.bittiMi()).toBe(false)
        for (const fn of bg.listeners.onRemoved) fn(1)
        await yeni.bekleyen
    })

    it('Header akisi: active_account yazimi (onChanged) + ACCOUNT_CHANGED ayni gecisi bir kez tamamlar', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const { bekleyen } = await bekleyenIstek()
        chrome.windows.remove.mockClear()

        localStore.active_account = A
        onChangedTetikle({ active_account: { newValue: A } })
        const cevap = await callHandler({ type: 'ACCOUNT_CHANGED', address: A.address })
        expect(cevap).toEqual({ success: true })
        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        await sakinles()

        // P5: ag bir kez geri yazildi (ETH), sitelere olay gitmedi; onay penceresi tek kez kapandi.
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
        expect(localStore[FROZEN]).toBeUndefined()
    })
})

describe('ACCOUNT_CHANGED, PRIVACY_MODE_SET girisi hala SURERKEN: heal gecici duruma dokunmaz (M1)', () => {
    it('giris yarida (snapshot yazildi, aktif hesap henuz genel) gelen ACCOUNT_CHANGED gecis bitene kadar bekler', async () => {
        await boot()
        let birak
        const bekle = new Promise((resolve) => { birak = resolve })
        girisSahte = async (_enabled, deps) => {
            await bekle
            await chrome.storage.local.set({ active_account: GIZLI, currentNetwork: POLYGON })
            await deps.announce(GIZLI)
            return { enabled: true, account: GIZLI }
        }
        const { bekleyen } = await bekleyenIstek()
        chrome.windows.remove.mockClear()

        const giris = callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        await vi.waitFor(() => expect(localStore[FROZEN]).toEqual(ETH))
        // Gecici durum: snapshot var, aktif hesap hala genel. Heal bunu "yarim cikis" sanip silseydi
        // kayit burada kaybolur ve sitelere gereksiz uzlastirma giderdi.
        let accountChangedBitti = false
        const accountChanged = callHandler({ type: 'ACCOUNT_CHANGED', address: A.address }).then((c) => { accountChangedBitti = true; return c })
        await sakinles()
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
        expect(accountChangedBitti).toBe(false)

        birak()
        expect((await giris).success).toBe(true)
        expect(await accountChanged).toEqual({ success: true })
        expect(await bekleyen).toEqual(KAPALI_CEVAP)
        await sakinles()

        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
        expect(chrome.windows.remove).toHaveBeenCalledTimes(1)
    })
})

describe('ACCOUNT_CHANGED: bayrak kapali ve fail-closed', () => {
    it('bayrak KAPALIYKEN onarim calismaz (cikis acilis geri almasinin isi)', async () => {
        await boot({ flag: 'false', extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        await hesapSec(A)
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])
    })

    it('depo okunamazsa (donmus kayit okumasi) HICBIR yan etki calismaz, cevap yine de basarili', async () => {
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH, currentNetwork: POLYGON } })
        const { bekleyen, bittiMi } = await bekleyenIstek()
        const gercekGet = chrome.storage.local.get.getMockImplementation()
        chrome.storage.local.get.mockImplementation(async (keys) => {
            if (Array.isArray(keys) && keys.includes(FROZEN)) throw new Error('disk')
            return gercekGet(keys)
        })
        const cevap = await hesapSec(A)
        await sakinles()
        expect(cevap).toEqual({ success: true })
        expect(bittiMi()).toBe(false)
        expect(localStore[FROZEN]).toEqual(ETH)
        expect(olaylar('chainChanged')).toEqual([])

        chrome.storage.local.get.mockImplementation(gercekGet)
        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyen
    })
})

describe('servis calisani acilisi (bayrak ACIK): yarim kalmis gecis depodan tamamlanir', () => {
    it('genel hesap + donmus kayit: cikis yan etkileri (giris oncesi ag geri yazilir, kayit silinir, dapps degismez)', async () => {
        await boot({ active: A, extra: { [FROZEN]: ETH, currentNetwork: POLYGON, last_evm_chain_id: 137 } })
        expect(localStore[FROZEN]).toBeUndefined()
        // P5: boot() olay sayaclarini sifirladi; geri yazim depodan, "olay gitmedi" ise dapps'ten okunur
        // (eskiden uzlastirma dapps[*].chainId'yi 0x89 yapardi).
        expect(localStore.currentNetwork).toEqual(ETH)
        expect(localStore.last_evm_chain_id).toBe(1)
        expect(localStore.dapps['site.example'].chainId).toBe('0x1')
    })

    it('Gizli Hesap + donmus kayit YOK: giris yan etkileri (snapshot yazilir)', async () => {
        await boot({ active: GIZLI, extra: { currentNetwork: POLYGON } })
        expect(localStore[FROZEN]).toEqual(POLYGON)
    })

    // P5 (spec 4.9 madde 6): kayit yokken onarimda alinan kayit "sitelerin o ana dek gordugu ag"dir
    // (kayit yokken dappVisibleNetwork canli agi dondurur); cikista o geri yuklenir. "Son gizli ag
    // gorunmez" garantisi bu durumda onarim anindan SONRASI icindir.
    it('P5: onarimin aldigi kayit "sitelerin gordugu ag"dir; sonradan degisen gizli ag degil, o geri yuklenir', async () => {
        await boot({ active: GIZLI, extra: { currentNetwork: POLYGON, last_evm_chain_id: 137 } })
        expect(localStore[FROZEN]).toEqual(POLYGON)
        // Onarimdan SONRA gizli oturumda ag degisir; siteler yine kaydi gorur.
        localStore.currentNetwork = ETH
        localStore.last_evm_chain_id = 1
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x89' })

        const cikis = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        await sakinles()
        expect(cikis.success).toBe(true)
        expect(localStore.currentNetwork).toEqual(POLYGON)
        expect(localStore.last_evm_chain_id).toBe(137)
        expect(olaylar('chainChanged')).toEqual([])
        expect(await callHandler({ method: 'eth_chainId' }, DAPP_SENDER)).toEqual({ result: '0x89' })
    })

    it('tutarli durum (genel + kayit yok / Gizli + kayit var) acilista HICBIR SEY yazmaz', async () => {
        await boot({ active: A })
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(chrome.storage.local.remove).not.toHaveBeenCalled()
        teardownBackground()
        await boot({ active: GIZLI, extra: { [FROZEN]: ETH } })
        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(chrome.storage.local.remove).not.toHaveBeenCalled()
        expect(localStore[FROZEN]).toEqual(ETH)
    })
})

describe('R1-NB2: acilis geri almasi erken donerse dapp mesaji TEK KEZ cevaplanir', () => {
    it('chrome.storage.local.get yokken (kismen taklit chrome) privacyStartup takili kalmaz', async () => {
        bg = await bootBackground({ privacyFlag: 'false', localStore: {}, sessionStore: {}, storageLocalGet: false })
        let cevapSayisi = 0
        const cevap = new Promise((resolve) => {
            const dondu = bg.listeners.onMessage[0]({ method: 'eth_chainId' }, DAPP_SENDER, () => {
                cevapSayisi += 1
                resolve()
            })
            expect(dondu).toBe(true)
        })
        await cevap
        await sakinles()
        expect(cevapSayisi).toBe(1)
    })
})
