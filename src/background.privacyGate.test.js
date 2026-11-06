import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { PRIVATE_GATE_CODES, PRIVATE_ACTIONS } from './utils/privacy/privacyGate'
import { usdcTokenOf } from './utils/privacy/deliveryTokens'
import { isPrivateModeAction } from './utils/messageGate'
import { extractSwitchCases } from './test-utils/switchCases'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

// Gizli mod kapisinin GERCEK dagitici uzerinden testi (spec 6). Asagidaki yardimcilar
// (sabitler, boot, callHandler) dosyanin tum bloklarinca paylasilir: yardimcilari dosyanin
// BASINDA tut.

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const DAPP_SENDER = { url: 'https://site.example/app', origin: 'https://site.example', tab: { id: 3, url: 'https://site.example/app' } }
const YABANCI_SENDER = { url: 'https://yabanci.example/', origin: 'https://yabanci.example', tab: { id: 5, url: 'https://yabanci.example/' } }
// Desteklenen aglarda OLMAYAN zincir: kapidan gecen istek isleyicide "Unsupported chain"
// ile ANINDA doner (ag cagrisi, RPC, bundler yok); kapi karari zincirden bagimsiz EVM sayar.
const BILINMEYEN_ZINCIR = 999999
const PERSONAL_SIGN = { method: 'personal_sign', params: ['0x68656c6c6f', A.address] }
// Klasik alti ad (R1): gizli kimlik icin bayraktan bagimsiz PRIVATE_SWAP_BRIDGE_CLOSED. Mesajlar eski satirlarinkiyle ayni; ek olarak TON zinciri, genel hesap nesnesi ve index (kapi hicbirine bakmadan keser).
const KLASIK_ALTI = [
    ['SWAP', { chainId: 56, amount: '1' }],
    ['SWAP', { chainId: -239, amount: '1' }],
    ['SWAP', { chainId: 56, amount: '1', account: A }],
    ['SWAP_QUOTE', { chainId: BILINMEYEN_ZINCIR, amount: '1', index: 0 }],
    ['BRIDGE', { chain: BILINMEYEN_ZINCIR, toChain: 1, amount: '1' }],
    ['BRIDGE_QUOTE', { fromChain: BILINMEYEN_ZINCIR, toChain: 1, amount: '1' }],
    ['ATS_SWAP_FEE_QUOTE', { chainId: BILINMEYEN_ZINCIR, amount: '1' }],
    ['ATS_BRIDGE_FEE_QUOTE', { chainId: BILINMEYEN_ZINCIR, amount_raw: '1' }],
]

let bg, localStore
const callHandler = (...args) => bg.call(...args)

async function boot({ active = A, extra = {} } = {}) {
    localStore = {
        active_account: active,
        vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI }],
        currentNetwork: { chainId: 56, name: 'BNB Smart Chain' },
        // site.example'a Genel hesap (A) bagli; yabanci.example hic baglanmamis.
        dapps: { 'site.example': { accounts: [A.address] } },
        solana_dapps: {},
        ...extra,
    }
    bg = await bootBackground({ localStore })
    // Acilis sirasinda arka planin kendi yazimlari testin "islem yapilmadi" olcumune
    // karismasin: sayaclar yazimlar durulduktan sonra sifirlanir.
    await yazimlariBekle()
    chrome.storage.local.set.mockClear()
    chrome.storage.local.get.mockClear()
}

// Kapidan gecen istek icin kanit: yanit bir kapi koduyla (PRIVATE_* / RECIPIENT_IS_PRIVATE)
// DEGIL, isleyicinin kendi sonucuyla gelir.
const kapiyaTakilmadi = (res) => {
    const err = typeof res?.error === 'string' ? res.error : ''
    expect(err).not.toMatch(/^PRIVATE_/)
    expect(err).not.toBe('RECIPIENT_IS_PRIVATE')
}

let konsolHatasi
beforeEach(() => {
    // Hicbir test gercek aga cikmaz.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ag kapali') }))
    // Kapidan gecen isteklerin isleyicileri (ag kapali, bilinmeyen zincir) BEKLENEN
    // console.error uretir; takim ciktisi temiz kalsin.
    konsolHatasi = vi.spyOn(console, 'error').mockImplementation(() => {})
})

// Kapidan gecen swap/kopru/gonderim istegi yanittan SONRA islem kaydini (txStorage)
// arka planda yazar. Teardown chrome'u silmeden once yazimlar bitmeli; yoksa
// "chrome is not defined" sizar. Depo yazimlari iki ardisik turda degismeyince bitmistir.
async function yazimlariBekle() {
    // Test boot'tan ONCE basarisiz olduysa (ya da onceki testin teardown'u chrome'u sildiyse) bekleyecek
    // yazim yoktur; chrome'a dokunmak ikinci bir 'chrome is not defined' hatasi uretip asil farki gizlerdi.
    if (!globalThis.chrome?.storage?.local?.set?.mock) return
    const turBekle = () => new Promise((resolve) => setImmediate(resolve))
    let onceki = -1
    for (let i = 0; i < 50; i++) {
        await turBekle()
        const simdiki = chrome.storage.local.set.mock.calls.length + chrome.storage.local.get.mock.calls.length
        if (simdiki === onceki) return
        onceki = simdiki
    }
}

afterEach(async () => {
    await yazimlariBekle()
    teardownBackground()
    vi.unstubAllGlobals()
    konsolHatasi.mockRestore()
})

// ENGELLENEN ya da FAIL-CLOSED bir istekte isleyici CALISMAMIS olmali. Isleyiciler
// (swap/gonderim) ilk is olarak islem kaydini depoya yazar ve ag cagirir; yazimlar
// durulduktan sonra ikisinin de izi olmamali. (Ilk yanit tek basina yetmez: engel
// yaniti gonderilip isleyici yine de calistirilsa da ilk yanit ayni gorunurdu.)
async function islemYapilmadi({ depoYazimiVar = false } = {}) {
    await yazimlariBekle()
    if (!depoYazimiVar) expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(localStore.current_transactions).toBeUndefined()
}

describe('kapi -- normal mod', () => {
    beforeEach(() => boot())

    it('Gizli Hesap\'a duz ETH gonderimi RECIPIENT_IS_PRIVATE', async () => {
        const res = await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: 56, tx: { to: GIZLI.address, value: '1', data: '0x' } } })
        expect(res).toEqual({ success: false, error: 'RECIPIENT_IS_PRIVATE' })
        await islemYapilmadi()
    })

    it('Gizli Hesap\'a ERC-20 transfer de yakalanir', async () => {
        const data = '0xa9059cbb' + GIZLI.address.slice(2).padStart(64, '0') + '1'.padStart(64, '0')
        const res = await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: 56, tx: { to: '0x' + '55'.repeat(20), data } } })
        expect(res).toEqual({ success: false, error: 'RECIPIENT_IS_PRIVATE' })
        await islemYapilmadi()
    })

    // A-M4: Gizli Hesap bir EOA'dir; cagri verisi taninmasa da ona giden her islem engellenir.
    it('Gizli Hesap a taninmayan cagri verisiyle (value-bearing ya da degil) gonderim de RECIPIENT_IS_PRIVATE', async () => {
        for (const tx of [
            { to: GIZLI.address, value: '1', data: '0xdeadbeef' + '00'.repeat(32) },
            { to: GIZLI.address, data: '0x12345678' },
            { to: GIZLI.address.toUpperCase().replace('0X', '0x'), value: '0', data: '0xabcdef01' },
        ]) {
            const res = await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: 56, tx } })
            expect(res, JSON.stringify(tx)).toEqual({ success: false, error: 'RECIPIENT_IS_PRIVATE' })
        }
        await islemYapilmadi()
    })

    // A-M2: ethers ayni anahtari turetir; kanonik olmayan yol yazimlari kimlik denetiminden kacmamali.
    for (const yol of ["44'/60'/0'/1/0", "m/44'/60'/0'/01/0", "m/44'/60'/0'/1/00", "m/044'/60'/0'/1/0"]) {
        it(`SIGN: kanonik olmayan turetme yolu (${yol}) Gizli Hesap sayilir`, async () => {
            const res = await callHandler({ type: 'SIGN', message: { account: { type: 'hd', index: 0, derivationPath: yol }, sign_message: 'x' } })
            expect(res).toEqual({ success: false, error: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
            await islemYapilmadi()
        })
    }

    it('baska aliciya gonderim kapidan gecer (isleyiciye ulasir)', async () => {
        const res = await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: BILINMEYEN_ZINCIR, tx: { to: A.address, value: '1', data: '0x' } } })
        kapiyaTakilmadi(res)
    })

    it('imzaci Gizli Hesap ise PRIVATE_ACCOUNT_IN_PUBLIC_MODE', async () => {
        const res = await callHandler({ type: 'SIGN', message: { account: GIZLI, sign_message: 'x' } })
        expect(res).toEqual({ success: false, error: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
        await islemYapilmadi()
    })

    // Imzaci KIMLIKLE Gizli Hesap sayilir: `private` bayragi olmasa da ayni adres
    // (0x'li/0x'siz, harf duyarsiz) ya da ayni key Gizli Hesap'tir.
    for (const [ad, hesap] of [
        ['bayraksiz, ayni adres', { type: 'hd', address: GIZLI.address }],
        ['bayraksiz, buyuk harfli adres', { type: 'hd', address: '0x' + GIZLI.address.slice(2).toUpperCase() }],
        ['bayraksiz, 0x onekisiz adres', { type: 'hd', address: GIZLI.address.slice(2) }],
        ['bayraksiz, yalniz key', { type: 'hd', key: GIZLI.key }],
    ]) {
        it(`SIGN: ${ad} Gizli Hesap sayilir, PRIVATE_ACCOUNT_IN_PUBLIC_MODE`, async () => {
            const res = await callHandler({ type: 'SIGN', message: { account: hesap, sign_message: 'x' } })
            expect(res).toEqual({ success: false, error: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' })
            await islemYapilmadi()
        })
    }

    it('UI hesap NESNESI yerine index yollarsa kapi, isleyici gibi, aktif hesabi yargilar', async () => {
        const res = await callHandler({ type: 'SWAP_QUOTE', message: { chainId: BILINMEYEN_ZINCIR, amount: '1', index: 0 } })
        kapiyaTakilmadi(res)
    })

    // Dapp kanali: gecerli bir Genel hesap + bagli site; kapi hicbir sey degistirmez.
    it('eth_accounts bagli siteye hesabini doner (normal modda kapi araya girmez)', async () => {
        const res = await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)
        expect(res).toEqual({ result: [A.address] })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('bagli olmayan sitenin eth_requestAccounts istegi normal CONNECT popup acar', async () => {
        const pending = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe('CONNECT')
        expect(localStore.current_request.type).not.toBe('PRIVACY_BLOCKED')
        for (const fn of bg.listeners.onRemoved) fn(1)
        await pending
    })

    // Bayrak acikken her CONDITIONAL aksiyon, GERCEK dagitici uzerinden, acik/genel bir
    // imzaciyla kapidan gecmeli (imzaci baglama zorunlu: bozulursa PRIVATE_CHECK_FAILED).
    const GENEL_IMZACI_ORNEKLERI = [
        ['SWAP', { chainId: BILINMEYEN_ZINCIR, amount: '1' }],
        ['SWAP_QUOTE', { chainId: BILINMEYEN_ZINCIR, amount: '1' }],
        ['BRIDGE', { chain: BILINMEYEN_ZINCIR, toChain: 1, amount: '1' }],
        ['BRIDGE_QUOTE', { fromChain: BILINMEYEN_ZINCIR, toChain: 1, amount: '1' }],
        ['SEND_TRANSACTION', { chainId: BILINMEYEN_ZINCIR, tx: { to: A.address, value: '1', data: '0x' } }],
        ['SIGN', { sign_message: 'merhaba' }],
        ['ATS_RUN_ONBOARDING', { chainId: BILINMEYEN_ZINCIR, address: A.address }],
        ['GASLESS_TOKEN_OPTIONS', { chainId: BILINMEYEN_ZINCIR, address: A.address }],
        ['ATS_SWAP_FEE_QUOTE', { chainId: BILINMEYEN_ZINCIR, amount: '1' }],
        ['ATS_BRIDGE_FEE_QUOTE', { chainId: BILINMEYEN_ZINCIR, amount_raw: '1' }],
    ]

    for (const [type, message] of GENEL_IMZACI_ORNEKLERI) {
        it(`${type}: aktif genel hesapla kapidan gecer`, async () => {
            const res = await callHandler({ type, message })
            kapiyaTakilmadi(res)
        })

        it(`${type}: mesajdaki genel hesap nesnesiyle de kapidan gecer`, async () => {
            const res = await callHandler({ type, message: { ...message, account: A } })
            kapiyaTakilmadi(res)
        })
    }
})

describe('kapi -- gizli mod', () => {
    beforeEach(() => boot({ active: GIZLI }))

    it('duz gonderim PRIVATE_USE_PRIVATE_SEND', async () => {
        const res = await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: 56, tx: { to: A.address, value: '1', data: '0x' } } })
        expect(res).toEqual({ success: false, error: 'PRIVATE_USE_PRIVATE_SEND' })
        await islemYapilmadi()
    })

    it('imza (SIGN) PRIVATE_USE_PRIVATE_SEND', async () => {
        const res = await callHandler({ type: 'SIGN', message: { sign_message: 'x' } })
        expect(res).toEqual({ success: false, error: 'PRIVATE_USE_PRIVATE_SEND' })
        await islemYapilmadi()
    })

    it('klasik alti ad (SWAP, SWAP_QUOTE, BRIDGE, BRIDGE_QUOTE, ATS_SWAP_FEE_QUOTE, ATS_BRIDGE_FEE_QUOTE) bayrak ACIKKEN de PRIVATE_SWAP_BRIDGE_CLOSED ile reddedilir; isleyici calismaz', async () => {
        // Bu test bayrak acikken kosuyor (vitest varsayilani 'true'): olcum bos bir iddia degil.
        expect((await import('./utils/featureFlags')).PRIVATE_SWAP_BRIDGE).toBe(true)
        for (const [type, message] of KLASIK_ALTI) {
            expect(await callHandler({ type, message }), `${type} ${JSON.stringify(message)}`).toEqual({ success: false, error: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
        }
        await islemYapilmadi()
    })

    it('bayraksiz ama Gizli Hesap kimligini tasiyan imzaci (adres/key) ATS_RUN_ONBOARDING kapisindan gecer', async () => {
        for (const hesap of [
            { type: 'hd', address: GIZLI.address.slice(2).toUpperCase() },
            { type: 'hd', key: GIZLI.key },
        ]) {
            const res = await callHandler({ type: 'ATS_RUN_ONBOARDING', message: { chainId: BILINMEYEN_ZINCIR, address: GIZLI.address, account: hesap } })
            kapiyaTakilmadi(res)
        }
    })

    // A-M3: kasadaki kayitla eslesmeyen BAYRAKLI nesne gizli modda "imzaci Gizli Hesap olmali"
    // kuralini saglamaz (bayrak almis genel hesap swap'i genel anahtarla imzalatirdi).
    it('bayragi almis ama adresi Gizli Hesap in OLMAYAN imzaci PRIVATE_SIGNER_MUST_BE_PRIVATE', async () => {
        const res = await callHandler({ type: 'ATS_RUN_ONBOARDING', message: { chainId: 56, address: A.address, account: { ...A, private: true } } })
        expect(res).toEqual({ success: false, error: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
        await islemYapilmadi()
    })

    it('UI index yollarsa kapi, isleyici gibi, aktif (Gizli) hesabi yargilar', async () => {
        const res = await callHandler({ type: 'ATS_RUN_ONBOARDING', message: { chainId: BILINMEYEN_ZINCIR, address: GIZLI.address, index: 0 } })
        kapiyaTakilmadi(res)
    })

    // Gizli Hesap imzaciyla, EVM zincirinde ATS onboarding ve gazsiz aksiyon gecer (klasik takas/kopru adlari yukaridaki tabloda kapali).
    for (const [type, message] of [
        ['ATS_RUN_ONBOARDING', { chainId: BILINMEYEN_ZINCIR, address: GIZLI.address }],
        ['GASLESS_TOKEN_OPTIONS', { chainId: BILINMEYEN_ZINCIR, address: GIZLI.address }],
    ]) {
        it(`${type}: Gizli Hesap imzaciyla EVM'de kapidan gecer`, async () => {
            const res = await callHandler({ type, message })
            kapiyaTakilmadi(res)
        })
    }

    it('ATS_RUN_ONBOARDING Gizli Hesap disi imzaciyla PRIVATE_SIGNER_MUST_BE_PRIVATE', async () => {
        const res = await callHandler({ type: 'ATS_RUN_ONBOARDING', message: { chainId: 56, address: A.address, account: A } })
        expect(res).toEqual({ success: false, error: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' })
        await islemYapilmadi()
    })

    // ATS onboarding BSC'de (kaynak zincir 56) calisir: karar mesajdaki chainId'ye degil
    // BSC'ye bakar. TON chainId'si yollansa bile EVM sayilir.
    it('ATS_RUN_ONBOARDING BSC uzerinden yargilanir: mesajdaki TON chainId karari degistirmez', async () => {
        const res = await callHandler({ type: 'ATS_RUN_ONBOARDING', message: { chainId: -239, address: GIZLI.address } })
        kapiyaTakilmadi(res)
    })

    it('dapp eth_accounts bos liste alir (bagli site icin bile; isleyici hesabi dondururdu)', async () => {
        const res = await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)
        expect(res).toEqual({ result: [] })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('EVM dapp baglanma istegi popup acar; popup reddedince dapp 4001 alir', async () => {
        const pending = callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request).toMatchObject({ type: 'PRIVACY_BLOCKED', origin: 'https://site.example', method: 'eth_requestAccounts' })

        await callHandler({
            type: 'CONNECT_WALLET_REJECTED', requestId: localStore.current_request.id, status: 'error',
            error: { code: 4001, message: 'User rejected the connection' },
        })
        const res = await pending
        // Popup'in KENDI cevabi: "Another request is being processed." mutex cevabi da 4001
        // oldugu icin yalniz kod yetmez; mesaj normal kullanici retiyle ayni olmali.
        expect(res.error).toEqual({ code: 4001, message: 'User rejected the connection' })
        // Sayfaya donen ret cuzdanin NORMAL kullanici reddinden ayirt edilemez.
        expect(JSON.stringify(res)).not.toMatch(/private/i)
        await islemYapilmadi({ depoYazimiVar: true })
    })

    it('popup penceresi kapatilirsa dapp 4001 alir', async () => {
        const pending = callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        // dappFunctions pencere kapanisini onRemoved dinleyicisiyle yakalar (pencere id'si 1).
        for (const fn of bg.listeners.onRemoved) fn(1)
        expect((await pending).error.code).toBe(4001)
        await islemYapilmadi({ depoYazimiVar: true })
    })

    // Ayni siteden art arda istek -> tek popup.
    it('30 sn icinde ikinci istek popup ACMAZ, aninda 4001 alir', async () => {
        callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        const ikinci = await callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        expect(ikinci.error).toEqual({ code: 4001, message: 'User rejected the connection' })
        expect(chrome.windows.create).toHaveBeenCalledOnce()
    })

    it('bekleme suresi SITE basina: baska site kendi popup\'ini acar', async () => {
        callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        const digerSite = { url: 'https://baska.example/', origin: 'https://baska.example', tab: { id: 4, url: 'https://baska.example/' } }
        callHandler({ method: 'eth_requestAccounts' }, digerSite)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2))
    })

    it('bekleme suresi (30 sn) dolunca ayni site yeniden popup acar', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        try {
            callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
            await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
            vi.setSystemTime(Date.now() + 31000)
            callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
            await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2))
        } finally {
            vi.useRealTimers()
        }
    })

    it('depo okunamazsa FAIL-CLOSED: PRIVATE_CHECK_FAILED', async () => {
        chrome.storage.local.get.mockRejectedValueOnce(new Error('disk'))
        const res = await callHandler({ type: 'SWAP', message: { chainId: 56, amount: '1' } })
        expect(res).toEqual({ success: false, error: 'PRIVATE_CHECK_FAILED' })
        await islemYapilmadi()
    })

    it('depo okunamazsa dapp istegi de FAIL-CLOSED: sayfa NORMAL ret alir, popup acilmaz', async () => {
        chrome.storage.local.get.mockRejectedValueOnce(new Error('disk'))
        const res = await callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        expect(res.error.code).toBe(4001)
        expect(JSON.stringify(res)).not.toMatch(/private/i)
        expect(chrome.windows.create).not.toHaveBeenCalled()
        await islemYapilmadi()
    })
})

// Uretim derlemesi (VITE_PRIVATE_SWAP_BRIDGE=false) ile de ayni yanit. beforeEach'te boot yok: bayrak, testin icinde boot()'tan (bootBackground
// modulleri sifirlar) ONCE stub'lanir; dosya duzeyindeki afterEach (teardownBackground) ortam stub'larini geri alir.
describe('kapi -- gizli mod: klasik alti ad bayrak KAPALIYKEN de kapali', () => {
    it('VITE_PRIVATE_SWAP_BRIDGE "false" iken ayni yanit', async () => {
        vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', 'false')
        await boot({ active: GIZLI })
        expect((await import('./utils/featureFlags')).PRIVATE_SWAP_BRIDGE).toBe(false)
        for (const [type, message] of KLASIK_ALTI) {
            expect(await callHandler({ type, message }), `${type} ${JSON.stringify(message)}`).toEqual({ success: false, error: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
        }
        await islemYapilmadi()
    })
})

// Gizli kimlik YALNIZ `private` isaretiyle degil, kasadaki kayitla eslesmeyle de bilinir (isPrivateIdentity): isareti dusmus eski kayitlar gercek.
// Depodaki aktif hesapta isaret YOK, kasada Gizli Hesap kaydi VAR: gercek dagitici alti klasik adi yine PRIVATE_SWAP_BRIDGE_CLOSED ile keser.
// Olumlu kontrol: ayni mesajlar isaretsiz GENEL hesapla (kayitla eslesmeyen) kapidan gecer, bkz. 'kapi -- normal mod'.
describe('kapi -- gizli mod: isareti dusmus aktif hesap (kasadaki kayitla eslesen)', () => {
    it('aktif hesapta private isareti yokken de klasik alti ad PRIVATE_SWAP_BRIDGE_CLOSED ile reddedilir; isleyici calismaz', async () => {
        const isaretsiz = { type: 'hd', address: GIZLI.address }
        expect(isaretsiz.private).toBeUndefined()
        await boot({ active: isaretsiz })
        // Olcum gercek: depodaki aktif hesap isaretsiz, kasada kayit var.
        expect(localStore.active_account.private).toBeUndefined()
        expect(localStore.vaults[0].privateAccount.address).toBe(GIZLI.address)
        for (const [type, message] of KLASIK_ALTI) {
            expect(await callHandler({ type, message }), `${type} ${JSON.stringify(message)}`).toEqual({ success: false, error: 'PRIVATE_SWAP_BRIDGE_CLOSED' })
        }
        await islemYapilmadi()
    })
})

describe('kapi -- sahte kontrol alani', () => {
    beforeEach(() => boot({ active: GIZLI }))

    it('mesaja yazilan "privacyChecked" benzeri alanlar kapiyi atlatmaz', async () => {
        const res = await callHandler({
            type: 'SEND_TRANSACTION', privacyChecked: true, __privacyChecked: true,
            message: { chainId: 56, tx: { to: A.address, value: '1', data: '0x' } },
        })
        expect(res).toEqual({ success: false, error: 'PRIVATE_USE_PRIVATE_SEND' })
        await islemYapilmadi()
    })
})

// I1: sayfa message.message / message.account alanlarini ISTEDIGI gibi yazabilir.
// Sayfadan cagrilabilen aksiyonlarda imzaci YALNIZ depodaki aktif hesaptir; sahte
// `account.private` iki modda da istegin davranisini DEGISTIRMEMELI (aksi halde bir
// site "kullanici gizli modda mi" sorusunu tek istekle yoklayabilirdi).
describe('kapi -- sayfanin sahte hesap alani', () => {
    const SAHTE_GOVDELER = [
        ['message.account.private', { message: { account: { private: true } } }],
        ['account.private', { account: { private: true } }],
        ['message.account (Gizli Hesap adresi)', { message: { account: { address: GIZLI.address } } }],
    ]

    for (const [ad, sahte] of SAHTE_GOVDELER) {
        it(`normal mod: ${ad} sahtesi istegi DEGISTIRMEZ (CONNECT popup)`, async () => {
            await boot()
            const pending = callHandler({ method: 'eth_requestAccounts', ...sahte }, YABANCI_SENDER)
            await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
            expect(localStore.current_request.type).toBe('CONNECT')
            for (const fn of bg.listeners.onRemoved) fn(1)
            await pending
        })

        it(`gizli mod: ${ad} sahtesi istegi DEGISTIRMEZ (PRIVACY_BLOCKED popup)`, async () => {
            await boot({ active: GIZLI })
            const pending = callHandler({ method: 'eth_requestAccounts', ...sahte }, YABANCI_SENDER)
            await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
            expect(localStore.current_request.type).toBe('PRIVACY_BLOCKED')
            for (const fn of bg.listeners.onRemoved) fn(1)
            await pending
        })
    }

    it('normal mod: sahte hesapli personal_sign de ayni cevabi alir (yetkisiz site: 4100)', async () => {
        await boot()
        const temiz = await callHandler(PERSONAL_SIGN, YABANCI_SENDER)
        const sahte = await callHandler({ ...PERSONAL_SIGN, message: { account: { private: true } } }, YABANCI_SENDER)
        expect(sahte).toEqual(temiz)
        expect(temiz.error.code).toBe(4100)
    })
})

// D: NORMAL modda dApp, Gizli Hesap adresini istegin HERHANGI bir yerine gomerse (router calldata'si, permit
// spender'i, imzalanan metin) istek, onay penceresi acilmadan ve hicbir ag istegi atilmadan reddedilir.
describe('kapi -- normal mod: dApp yukunde Gizli adres', () => {
    beforeEach(() => boot())
    const bare = GIZLI.address.slice(2)
    const pad = (h) => h.padStart(64, '0')
    const KOSULLAR = [
        ['duz tx.to', { method: 'eth_sendTransaction', params: [{ from: A.address, to: GIZLI.address, value: '0x1' }] }],
        ['tx.to buyuk harf', { method: 'eth_sendTransaction', params: [{ from: A.address, to: '0x' + bare.toUpperCase(), value: '0x1' }] }],
        ['ERC-20 transfer alicisi', { method: 'eth_sendTransaction', params: [{ from: A.address, to: '0x' + '55'.repeat(20), data: '0xa9059cbb' + pad(bare) + pad('1') }] }],
        ['router calldata icine gomulu recipient', { method: 'eth_sendTransaction', params: [{ from: A.address, to: '0x' + '66'.repeat(20), data: '0x3593564c' + pad('40') + pad('1') + pad('ff') + pad(bare) + pad('9') }] }],
        ['router calldata icine gomulu, buyuk harf', { method: 'eth_sendTransaction', params: [{ from: A.address, to: '0x' + '66'.repeat(20), data: '0x3593564c' + pad(bare.toUpperCase()) }] }],
        ['typed data permit spender (nesne)', { method: 'eth_signTypedData_v4', params: [A.address, { types: {}, primaryType: 'Permit', domain: { name: 'T' }, message: { owner: A.address, spender: GIZLI.address, value: '1' } }] }],
        ['typed data permit spender (JSON metin)', { method: 'eth_signTypedData_v4', params: [A.address, JSON.stringify({ types: {}, primaryType: 'Permit', domain: {}, message: { spender: GIZLI.address.toUpperCase().replace('0X', '0x') } })] }],
        ['personal_sign icerigi (hex kodlu metin)', { method: 'personal_sign', params: ['0x' + Buffer.from('send to ' + GIZLI.address, 'utf8').toString('hex'), A.address] }],
    ]

    for (const [ad, mesaj] of KOSULLAR) {
        it(`${ad}: pencere acilmadan, ag istegi atilmadan 4001 ile reddedilir`, async () => {
            const res = await callHandler(mesaj, DAPP_SENDER)
            expect(res.error.code).toBe(4001)
            expect(JSON.stringify(res)).not.toMatch(/private|gizli/i)
            expect(chrome.windows.create).not.toHaveBeenCalled()
            await islemYapilmadi()
        })
    }

    it('SEND_TRANSACTION (onay sonrasi yol) calldata icindeki Gizli adresi de yakalar', async () => {
        const data = '0x3593564c' + pad('40') + pad(bare)
        const res = await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: 56, tx: { to: '0x' + '66'.repeat(20), data } } })
        expect(res).toEqual({ success: false, error: 'RECIPIENT_IS_PRIVATE' })
        await islemYapilmadi()
    })

    it('Gizli adresi icermeyen normal dApp islemi/imzasi kapidan gecer (pencere acilir / isleyiciye ulasir)', async () => {
        const pending = callHandler({ method: 'eth_sendTransaction', params: [{ from: A.address, to: '0x' + '77'.repeat(20), data: '0xa9059cbb' + pad('77'.repeat(20)) + pad('1'), value: '0x1' }] }, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe('SEND_TX')
        for (const fn of bg.listeners.onRemoved) fn(1)
        await pending
    })
})

// I2: gizli modda popup'tan ONCE verilen her cevap, aktif hesap o siteye bagli degilken
// normal modda verilecek cevapla BAYT BAYT ayni olmali (cevap farki modu sizdirir).
describe('kapi -- dapp cevap esitligi (normal mod / gizli mod)', () => {
    const YETKISIZ_ISTEKLER = [
        ['eth_sendTransaction', { method: 'eth_sendTransaction', params: [{ from: A.address, to: A.address, value: '0x1' }] }, 4100],
        ['personal_sign', PERSONAL_SIGN, 4100],
        ['wallet_switchEthereumChain bozuk parametre', { method: 'wallet_switchEthereumChain', params: [{ chainId: 'zz' }] }, -32602],
        ['wallet_switchEthereumChain bilinmeyen zincir', { method: 'wallet_switchEthereumChain', params: [{ chainId: '0xfffff1' }] }, 4902],
    ]

    async function cevapAl(active, mesaj, sender) {
        await boot({ active })
        const res = await callHandler(mesaj, sender)
        expect(chrome.windows.create).not.toHaveBeenCalled()
        return res
    }

    for (const [ad, mesaj, kod] of YETKISIZ_ISTEKLER) {
        it(`${ad}: baglanmamis site iki modda ayni cevabi alir`, async () => {
            const normal = await cevapAl(A, mesaj, YABANCI_SENDER)
            const gizli = await cevapAl(GIZLI, mesaj, YABANCI_SENDER)
            expect(normal.error.code).toBe(kod)
            expect(gizli).toEqual(normal)
            expect(JSON.stringify(gizli)).not.toMatch(/private/i)
            await islemYapilmadi()
        })
    }

    it('wallet_switchEthereumChain: zaten o zincirdeyiz (null) iki modda ayni', async () => {
        const mesaj = { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }
        const normal = await cevapAl(A, mesaj, YABANCI_SENDER)
        const gizli = await cevapAl(GIZLI, mesaj, YABANCI_SENDER)
        expect(normal).toEqual({ result: null })
        expect(gizli).toEqual(normal)
    })

    // A-I2: gizli modda HER site "bagli degil" gorunur. Bagli bir site icin bile sign/send
    // popup ACMAZ ve baglanmamis siteyle AYNI aninda 4100'u alir; yoksa "eth_accounts []
    // + popup" normal modda hicbir durumla uretilemeyen bir mod oracle'i olurdu.
    const BAGLI_SIGN_SEND = [
        ['eth_sendTransaction', { method: 'eth_sendTransaction', params: [{ from: A.address, to: A.address, value: '0x1' }] }],
        ['personal_sign', PERSONAL_SIGN],
    ]

    for (const [ad, mesaj] of BAGLI_SIGN_SEND) {
        it(`${ad}: bagli site gizli modda popup ACMAZ, baglanmamis siteyle AYNI 4100'u alir`, async () => {
            await boot({ active: GIZLI })
            const bagli = await callHandler(mesaj, DAPP_SENDER)
            const bagliDegil = await callHandler(mesaj, YABANCI_SENDER)
            expect(chrome.windows.create).not.toHaveBeenCalled()
            expect(bagli.error.code).toBe(4100)
            expect(bagli).toEqual(bagliDegil)
            // Normal modda baglanmamis sitenin alacagi cevapla da ayni.
            const normal = await cevapAl(A, mesaj, YABANCI_SENDER)
            expect(bagli).toEqual(normal)
            expect(JSON.stringify(bagli)).not.toMatch(/private/i)
            await islemYapilmadi()
        })
    }

    it('eth_accounts [] iken sign/send ASLA popup bekletmez (mod oracle yok)', async () => {
        await boot({ active: GIZLI })
        expect(await callHandler({ method: 'eth_accounts' }, DAPP_SENDER)).toEqual({ result: [] })
        for (const [, mesaj] of BAGLI_SIGN_SEND) {
            expect((await callHandler(mesaj, DAPP_SENDER)).error.code).toBe(4100)
        }
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('wallet_switchEthereumChain: baglanmis site iki modda da popup bekletir (normal SWITCH_CHAIN, gizli PRIVACY_BLOCKED)', async () => {
        const mesaj = { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] }
        await boot()
        const bekleyenN = callHandler(mesaj, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request.type).toBe('SWITCH_CHAIN')
        for (const fn of bg.listeners.onRemoved) fn(1)
        await bekleyenN

        await boot({ active: GIZLI })
        const bekleyenG = callHandler(mesaj, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        expect(localStore.current_request).toMatchObject({ type: 'PRIVACY_BLOCKED', method: mesaj.method })
        for (const fn of bg.listeners.onRemoved) fn(1)
        expect((await bekleyenG).error.code).toBe(4001)
        await islemYapilmadi({ depoYazimiVar: true })
    })

    it('erken cevap (zincir yok 4902) bekleme suresini BASLATMAZ', async () => {
        await boot({ active: GIZLI })
        const ilk = await callHandler({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xfffff1' }] }, YABANCI_SENDER)
        expect(ilk.error.code).toBe(4902)
        const pending = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        for (const fn of bg.listeners.onRemoved) fn(1)
        await pending
    })

    it('pencere acilamazsa bekleme suresi BASLAMAZ', async () => {
        await boot({ active: GIZLI })
        // N3 (WalletConnect 1.8.3): konumlu acilis reddedilirse pencere konumsuz BIR KEZ daha denenir;
        // "pencere acilamadi" icin iki deneme de reddedilir (iki cagri), sonraki istek 3. cagridir.
        chrome.windows.create.mockRejectedValueOnce(new Error('pencere yok'))
        chrome.windows.create.mockRejectedValueOnce(new Error('pencere yok'))
        const ilk = await callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        expect(ilk.error.code).toBe(-32603)
        expect(chrome.windows.create).toHaveBeenCalledTimes(2)
        const pending = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(3))
        for (const fn of bg.listeners.onRemoved) fn(1)
        await pending
    })

    it('mutex (baska pencere aciliyor) cevabi bekleme suresini BASLATMAZ', async () => {
        await boot({ active: GIZLI })
        let birak
        chrome.windows.create.mockImplementationOnce(() => new Promise((resolve) => { birak = () => resolve({ id: 1 }) }))
        const birinci = callHandler({ method: 'eth_requestAccounts' }, DAPP_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledOnce())
        const mutexCevabi = await callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        expect(mutexCevabi.error.message).toBe('Another request is being processed.')
        birak()
        await yazimlariBekle()
        const ikinci = callHandler({ method: 'eth_requestAccounts' }, YABANCI_SENDER)
        await vi.waitFor(() => expect(chrome.windows.create).toHaveBeenCalledTimes(2))
        for (const fn of bg.listeners.onRemoved) fn(1)
        await Promise.all([birinci, ikinci])
    })
})

// A-I1: TonConnect / Solana sayfa istekleri gizli modda, TON / Solana hesabi olmayan bir
// aktif hesap (yalniz EVM: ice aktarilmis hesap) + oturumu olmayan site icin NORMAL modda
// verilen cevabin AYNISINI almali (yan etkisiz bir yoklama modu okuyamamali). Ayni yoklama iki
// modda calistirilir ve toEqual ile karsilastirilir (EVM I2 blogu gibi). Zaman damgali id'ler
// icin Date sabitlenir.
describe('kapi -- TON / Solana cevap esitligi (normal mod, yalniz EVM hesap / gizli mod)', () => {
    const EVM_ONLY = { key: 'e-1', address: '0x' + 'ee'.repeat(20), type: 'imported', name: 'Ice aktarilmis' }
    // Solana isleyicileri yalniz ust cerceve + https/localhost ister.
    const SOLANA_SENDER = { ...DAPP_SENDER, frameId: 0 }
    const MANIFEST = 'https://site.example/tonconnect-manifest.json'
    const OTURUM = { address: 'UQ' + 'a'.repeat(46), publicKey: 'ab', accountKey: 'a-1', chain: '-239', connectedAt: 1 }

    const TON_YOKLAMALARI = [
        ['tonconnect_connect (manifestUrl var)', { method: 'tonconnect_connect', params: [{ manifestUrl: MANIFEST, items: [{ name: 'ton_addr' }] }] }, 300],
        ['tonconnect_connect (manifestUrl yok)', { method: 'tonconnect_connect', params: [{ items: [] }] }, 1],
        ['tonconnect_restore (oturum yok)', { method: 'tonconnect_restore', params: [] }, 100],
        ['tonconnect_send sendTransaction', { method: 'tonconnect_send', params: [{ method: 'sendTransaction', id: '7', params: ['{}'] }] }, 100],
        ['tonconnect_send signData', { method: 'tonconnect_send', params: [{ method: 'signData', id: '8', params: ['{}'] }] }, 100],
        ['tonconnect_send bilinmeyen metot', { method: 'tonconnect_send', params: [{ method: 'bilinmiyor', id: '9' }] }, 400],
    ]

    const SOLANA_YOKLAMALARI = [
        ['solana_connect', { method: 'solana_connect', params: [{}] }],
        ['solana_connect (silent)', { method: 'solana_connect', params: [{ silent: true }] }],
        ['solana_signMessage', { method: 'solana_signMessage', params: [{ message: 'aGVsbG8=' }] }],
        ['solana_signIn', { method: 'solana_signIn', params: [{ input: { statement: 'x' } }] }],
        ['solana_signTransaction', { method: 'solana_signTransaction', params: [{ transaction: 'AA==' }] }],
        ['solana_signAndSendTransaction', { method: 'solana_signAndSendTransaction', params: [{ transaction: 'AA==' }] }],
    ]

    async function cevap(active, mesaj, sender, extra) {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(1_700_000_000_000)
        try {
            await boot({ active, extra })
            const res = await callHandler(mesaj, sender)
            expect(chrome.windows.create).not.toHaveBeenCalled()
            return res
        } finally {
            vi.useRealTimers()
        }
    }

    for (const [ad, mesaj, kod] of TON_YOKLAMALARI) {
        it(`${ad}: iki modda ayni cevap`, async () => {
            const normal = await cevap(EVM_ONLY, mesaj, DAPP_SENDER)
            const gizli = await cevap(GIZLI, mesaj, DAPP_SENDER)
            const k = normal.result.payload?.code ?? normal.result.error?.code
            expect(k).toBe(kod)
            expect(gizli).toEqual(normal)
            expect(JSON.stringify(gizli)).not.toMatch(/private/i)
            await islemYapilmadi()
        })

        it(`${ad}: Genel hesaba oturumu olan site de "oturum yok" cevabini alir`, async () => {
            const normal = await cevap(EVM_ONLY, mesaj, DAPP_SENDER)
            const gizli = await cevap(GIZLI, mesaj, DAPP_SENDER, { ton_dapps: { 'site.example': OTURUM } })
            expect(gizli).toEqual(normal)
        })
    }

    it('tonconnect_send disconnect iki modda ayni (gercek isleyici calisir)', async () => {
        const mesaj = { method: 'tonconnect_send', params: [{ method: 'disconnect', id: '1' }] }
        const normal = await cevap(EVM_ONLY, mesaj, DAPP_SENDER)
        const gizli = await cevap(GIZLI, mesaj, DAPP_SENDER)
        expect(normal).toEqual({ result: { result: {}, id: '1' } })
        expect(gizli).toEqual(normal)
    })

    for (const [ad, mesaj] of SOLANA_YOKLAMALARI) {
        it(`${ad}: iki modda ayni cevap`, async () => {
            const normal = await cevap(EVM_ONLY, mesaj, SOLANA_SENDER)
            const gizli = await cevap(GIZLI, mesaj, SOLANA_SENDER)
            expect(gizli).toEqual(normal)
            expect(JSON.stringify(gizli)).not.toMatch(/private/i)
            await islemYapilmadi()
        })

        it(`${ad}: Genel hesaba Solana oturumu olan site de oturumsuz siteyle ayni cevabi alir`, async () => {
            const normal = await cevap(EVM_ONLY, mesaj, SOLANA_SENDER)
            const oturum = { 'https://site.example': { address: 'So1' + 'b'.repeat(40), publicKey: 'ab', accountKey: 'a-1', cluster: 'solana:mainnet' } }
            const gizli = await cevap(GIZLI, mesaj, SOLANA_SENDER, { solana_dapps: oturum })
            expect(gizli).toEqual(normal)
        })
    }

    it('baska kodla engel (fail-closed) TON istegi ordinary ret dondurur, popup acmaz', async () => {
        await boot({ active: GIZLI })
        chrome.storage.local.get.mockRejectedValueOnce(new Error('disk'))
        const res = await callHandler({ method: 'tonconnect_restore' }, DAPP_SENDER)
        expect(res.result.event).toBe('connect_error')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })
})

describe('islem kaydi hesap anahtari (spec 7.3)', () => {
    beforeEach(() => boot())

    it('yeni kayit aktif hesabin anahtarini tasir', async () => {
        await callHandler({ type: 'SEND_TRANSACTION', message: { chainId: BILINMEYEN_ZINCIR, tx: { to: A.address, value: '1', data: '0x' } } })
        await vi.waitFor(() => expect(localStore.current_transactions?.length).toBeGreaterThan(0))
        expect(localStore.current_transactions[0].accountKey).toBe('a-1')
    })
})

// GIZLI SIPARIS KAPISI: PRIVATE_* aksiyonlari gercek dagitici uzerinden. Aksiyonlarin
// isleyicileri (case) vardir; bu bloklar yalniz KAPININ kararini sinar: engel PRIVATE_* kodlariyla
// doner, gecen istek bir kapi koduyla DONMEZ. Isleyicilerin kendi davranisi background.private*.test.js'tedir.
describe('PRIVATE_* kapisi -- gercek dagitici', () => {
    // Aksiyonlar ve kodlar kapinin kendi disa aktarimlarindan gelir (elle tutulan liste yok).
    const ACTIONS = [...PRIVATE_ACTIONS]
    const GATE_CODES = Object.values(PRIVATE_GATE_CODES)
    const YABANCI = '0x' + '12'.repeat(20)
    const GIZLI_KAYITLI = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    let sessionStore

    async function bootGizliSiparis({ active = GIZLI_KAYITLI, flag = 'true', records = {} } = {}) {
        localStore = {
            active_account: active,
            vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI_KAYITLI }],
            currentNetwork: { chainId: 56, name: 'BNB Smart Chain' },
        }
        sessionStore = { private_quotes: records }
        bg = await bootBackground({ privacyFlag: flag, localStore, sessionStore })
        await yazimlariBekle()
    }
    const kayit = (over) => ({ sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: 56, createdAt: Date.now(), quote: { ticket: 't-1' }, ...over })
    const gonder = (type, message) => callHandler({ type, message })
    // Yanit TANIMLI olmali: tanimsiz yanit `not.toContain(undefined)` ile sessizce gecerdi.
    const gateKodu = (res) => {
        expect(res).toBeDefined()
        return res.error
    }

    it('normal modda dort aksiyon da PRIVACY_MODE_OFF', async () => {
        await bootGizliSiparis({ active: A })
        for (const a of ACTIONS) {
            expect(await gonder(a, { sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: 56, ticket: 't-1' }), a)
                .toEqual({ success: false, error: 'PRIVACY_MODE_OFF' })
        }
    })

    it('QUOTE: genel kaynaktan Gizli Hesap\'a gecer, baska adrese PRIVATE_TRANSFER_TARGET', async () => {
        await bootGizliSiparis()
        // sourceAsset ve payoutUsdc gerekli: arka plan desteklenmeyen zincir/varlik ciftini ya da okunamayan tutari kapidan sonra PRIVATE_UNSUPPORTED ile keser.
        const gecen = await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputToken: usdcTokenOf(56) })
        expect(GATE_CODES).not.toContain(gateKodu(gecen))
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: YABANCI, sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
    })

    it('QUOTE: Gizli Hesap kaynak ise her adrese gecer, kendi Gizli adresine de (PRIVATE_SWAP_BRIDGE acik)', async () => {
        await bootGizliSiparis()
        expect(GATE_CODES).not.toContain(gateKodu(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'g-1', outputAddress: YABANCI, sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '25', outputToken: usdcTokenOf(56) })))
        // payoutUsdc '1' yerel asgaride (12 USDC) durur: kapinin gectigini ag cagrisi olmadan kanitlar.
        for (const adres of [GIZLI.address, GIZLI.address.toUpperCase().replace('0X', '0x')]) {
            expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'g-1', outputAddress: adres, sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '1', outputToken: usdcTokenOf(56) }), adres)
                .toEqual({ success: false, error: 'PRIVATE_MIN_AMOUNT', limitUsdc: '12' })
        }
    })

    it('QUOTE: kaynak mesajdaki hesap nesnesinden DEGIL kasadan anahtarla cozulur (sahte message.account yok sayilir)', async () => {
        await bootGizliSiparis()
        // Sahte `account` Gizli Hesap derdi; gercek kaynak a-1 oldugundan yabanci cikti engellenir.
        expect(await gonder('PRIVATE_QUOTE', { account: GIZLI_KAYITLI, sourceAccountKey: 'a-1', outputAddress: YABANCI, sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
    })

    it('QUOTE: bilinmeyen kaynak anahtari, eksik cikti, EVM disi / bilinmeyen zincir', async () => {
        await bootGizliSiparis()
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'yok', outputAddress: GIZLI.address, sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: { toString: () => GIZLI.address }, sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: -239 }))
            .toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: GIZLI.address }))
            .toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
    })

    it('ORDER: teklif yoksa ya da bellekten dusmusse PRIVATE_UNSUPPORTED', async () => {
        await bootGizliSiparis()
        for (const ticket of ['t-yok', undefined, '', 'constructor', '__proto__']) {
            expect(await gonder('PRIVATE_ORDER', { ticket }), String(ticket)).toEqual({ success: false, error: 'PRIVATE_UNSUPPORTED' })
        }
    })

    it('ORDER: kaynak, cikti ve zincir SAKLANAN tekliften okunur; mesajdaki alanlar yok sayilir', async () => {
        await bootGizliSiparis({ records: { 't-1': kayit() } })
        // Mesaj alanlari kapiyi degistiremez: sahte yabanci cikti, TON zinciri, sahte hesap.
        const gecen = await gonder('PRIVATE_ORDER', { ticket: 't-1', outputAddress: YABANCI, sourceChainId: -239, sourceAccountKey: 'g-1', account: GIZLI_KAYITLI, chainId: -239 })
        expect(GATE_CODES).not.toContain(gateKodu(gecen))
    })

    it('ORDER: saklanan teklifin ciktisi Gizli Hesap degilse PRIVATE_TRANSFER_TARGET, zinciri EVM degilse PRIVATE_EVM_ONLY', async () => {
        await bootGizliSiparis({ records: {
            'foreign': kayit({ outputAddress: YABANCI, quote: { ticket: 'foreign' } }),
            'ton': kayit({ sourceChainId: -239, quote: { ticket: 'ton' } }),
        } })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'foreign', outputAddress: GIZLI.address })).toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'ton', sourceChainId: 56 })).toEqual({ success: false, error: 'PRIVATE_EVM_ONLY' })
    })

    it('ORDER: Gizli Hesap kayitli teklifte kendi Gizli adresine gecer (bayrak acik)', async () => {
        await bootGizliSiparis({ records: { self: kayit({ sourceAccountKey: 'g-1', quote: { ticket: 'self' } }) } })
        // deliveryVersion'siz kayit isleyicide PRIVATE_QUOTE_NOT_FOUND ile biter: kapinin gectigini kanitlar.
        expect(await gonder('PRIVATE_ORDER', { ticket: 'self' })).toEqual({ success: false, error: 'PRIVATE_QUOTE_NOT_FOUND' })
    })

    it('normal hesap kendi adresine QUOTE ve ORDER PRIVATE_SAME_ADDRESS (istisna Gizli Hesap\'a ozel)', async () => {
        await bootGizliSiparis({ records: { asame: kayit({ outputAddress: A.address, quote: { ticket: 'asame' } }) } })
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: A.address, sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_SAME_ADDRESS' })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'asame' })).toEqual({ success: false, error: 'PRIVATE_SAME_ADDRESS' })
    })

    it('PRIVATE_SWAP_BRIDGE kapaliyken Gizli Hesap kendi adresine QUOTE ve ORDER PRIVATE_SAME_ADDRESS (uretim davranisi)', async () => {
        // Bayrak bootBackground'dan ONCE kurulur (o resetModules cagirir); afterEach'teki teardown unstubAllEnvs yapar.
        vi.stubEnv('VITE_PRIVATE_SWAP_BRIDGE', 'false')
        await bootGizliSiparis({ records: { self: kayit({ sourceAccountKey: 'g-1', quote: { ticket: 'self' } }) } })
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'g-1', outputAddress: GIZLI.address, sourceChainId: 56, sourceAsset: 'USDC', payoutUsdc: '1', outputToken: usdcTokenOf(56) }))
            .toEqual({ success: false, error: 'PRIVATE_SAME_ADDRESS' })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'self' })).toEqual({ success: false, error: 'PRIVATE_SAME_ADDRESS' })
    })

    it('ORDERS ve REFUND gizli modda gecer (imzaci kapida aranmaz)', async () => {
        await bootGizliSiparis()
        expect(GATE_CODES, 'PRIVATE_ORDERS').not.toContain(gateKodu(await gonder('PRIVATE_ORDERS')))
        // Iade isleyicisi ticket'i { ticket } alanindan okur ve kayitsiz ticket'i PRIVATE_UNSUPPORTED
        // ile reddeder. Kapi bu kodu REFUND icin HICBIR kosulda uretmez (privateActionDecision null
        // doner), yani bu cevap isteginin kapidan gectigini ve isleyiciye ulastigini kanitlar.
        const refund = await gonder('PRIVATE_REFUND', { ticket: 'o-1' })
        expect(GATE_CODES.filter((c) => c !== PRIVATE_GATE_CODES.UNSUPPORTED), 'PRIVATE_REFUND').not.toContain(gateKodu(refund))
        expect(refund).toEqual({ success: false, error: PRIVATE_GATE_CODES.UNSUPPORTED })
    })

    // Isleyicinin DOGRU alani (message.ticket) okudugunu kanitlar: kayitli, iadesi zaten yazilmis bir
    // siparis 'o-1' ticket'i ile bulunursa PRIVATE_REFUND_NOT_ALLOWED doner; yanlis bir alan okunsaydi
    // siparis bulunamaz ve (kayitsiz ticket gibi) PRIVATE_UNSUPPORTED donerdi.
    it('REFUND: isleyici ticket alanindan okur -- kayitli siparis NOT_ALLOWED, kayitsiz UNSUPPORTED', async () => {
        await bootGizliSiparis()
        localStore.private_orders = [{ ticket: 'o-1', sourceAccountKey: 'a-1', refundTxHash: '0xr', status: 'FAILED' }]
        expect(await gonder('PRIVATE_REFUND', { ticket: 'o-1' })).toEqual({ success: false, error: 'PRIVATE_REFUND_NOT_ALLOWED' })
        expect(await gonder('PRIVATE_REFUND', { ticket: 'bilinmeyen' })).toEqual({ success: false, error: PRIVATE_GATE_CODES.UNSUPPORTED })
        // Yanlis alan adlariyla gelen mesaj da siparisi bulamaz.
        expect(await gonder('PRIVATE_REFUND', { id: 'o-1', orderId: 'o-1' })).toEqual({ success: false, error: PRIVATE_GATE_CODES.UNSUPPORTED })
    })

    it('ORDER: Gizli Hesap kaynakli saklanan teklif yabanci ciktiya gecer (gonderim)', async () => {
        await bootGizliSiparis({ records: { 'g': kayit({ sourceAccountKey: 'g-1', outputAddress: YABANCI, quote: { ticket: 'g' } }) } })
        expect(GATE_CODES).not.toContain(gateKodu(await gonder('PRIVATE_ORDER', { ticket: 'g' })))
    })

    it('QUOTE: Gizli Hesap adresi kasada yoksa genel kaynak PRIVATE_TRANSFER_TARGET (fail-closed)', async () => {
        await bootGizliSiparis()
        // Aktif hesap bayrakla Gizli sayilir (mod acik) ama kasada privateAccount kaydi yok:
        // hedefin Gizli Hesap oldugu dogrulanamaz, genel kaynak hicbir cikti adresine gonderemez.
        localStore.vaults = [{ type: 'hd', accounts: [A] }]
        expect(await gonder('PRIVATE_QUOTE', { sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: 56 }))
            .toEqual({ success: false, error: 'PRIVATE_TRANSFER_TARGET' })
    })

    it('ORDER: kaynak anahtari artik cozulmeyen, ciktisi dize olmayan ya da zincirsiz kayit UNSUPPORTED / UNSUPPORTED / EVM_ONLY', async () => {
        await bootGizliSiparis({ records: {
            'anahtarsiz': kayit({ sourceAccountKey: 'silinmis', quote: { ticket: 'anahtarsiz' } }),
            'nesne': kayit({ outputAddress: { address: GIZLI.address }, quote: { ticket: 'nesne' } }),
            'zincirsiz': kayit({ sourceChainId: undefined, quote: { ticket: 'zincirsiz' } }),
        } })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'anahtarsiz' })).toEqual({ success: false, error: PRIVATE_GATE_CODES.UNSUPPORTED })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'nesne' })).toEqual({ success: false, error: PRIVATE_GATE_CODES.UNSUPPORTED })
        expect(await gonder('PRIVATE_ORDER', { ticket: 'zincirsiz' })).toEqual({ success: false, error: PRIVATE_GATE_CODES.EVM_ONLY })
    })

    it('depo okunamazsa FAIL-CLOSED: PRIVATE_CHECK_FAILED, isleyici calismaz', async () => {
        await bootGizliSiparis()
        chrome.storage.local.get.mockRejectedValueOnce(new Error('disk'))
        expect(await gonder('PRIVATE_ORDERS', {})).toEqual({ success: false, error: 'PRIVATE_CHECK_FAILED' })
    })

    it('teklif deposu (oturum) okunamazsa PRIVATE_ORDER FAIL-CLOSED: PRIVATE_CHECK_FAILED', async () => {
        await bootGizliSiparis({ records: { 't-1': kayit() } })
        chrome.storage.session.get.mockRejectedValueOnce(new Error('oturum'))
        expect(await gonder('PRIVATE_ORDER', { ticket: 't-1' })).toEqual({ success: false, error: 'PRIVATE_CHECK_FAILED' })
    })

    // Bayrak kesmesi sayfa kokeni kuraliyla (isPrivateModeAction) AYNI kuraldan turetilir:
    // background.js'te bu kurala uyan HER case adi (ileride eklenecek 'X_PRIVATE_Y' dahil)
    // bayrak kapaliyken PRIVACY_DISABLED almali. Elle yazilmis bir listeye dayanmaz.
    it('kurala uyan her background case adi bayrak kapaliyken PRIVACY_DISABLED', async () => {
        const source = readFileSync(fileURLToPath(new URL('./background.js', import.meta.url)), 'utf8')
        const aile = extractSwitchCases(source).filter(isPrivateModeAction)
        // Olumlu iddia: regex bicim degisikligiyle bos kalirsa dongu sessizce gecmesin.
        expect(aile.sort()).toEqual([...PRIVATE_ACTIONS, 'ATS_PRIVATE_FEE_QUOTE', 'PRIVATE_PROVIDER_INFO'].sort())
        await bootGizliSiparis({ flag: 'false', records: { 't-1': kayit() } })
        for (const a of aile) {
            expect(await gonder(a, { sourceAccountKey: 'a-1', outputAddress: GIZLI.address, sourceChainId: 56, ticket: 't-1' }), a)
                .toEqual({ success: false, error: PRIVATE_GATE_CODES.DISABLED })
        }
    })

    // Kural-turevli kesmenin LISTEYE DEGIL kurala baglandigini kanitlar: bu adlar background.js'te YOK
    // (bugunku listede de yok), yine de aile kuralina (PRIVATE_ oneki / _PRIVATE_ icerigi) uyar. Yukaridaki
    // dongu yalniz bugun var olan case'leri gezer; ileride eklenecek bir aile adi icin tek koruma budur.
    it('listede olmayan ama aile kuralina uyan adlar da bayrak kapaliyken PRIVACY_DISABLED (cuzdan arayuzunden)', async () => {
        await bootGizliSiparis({ flag: 'false', records: { 't-1': kayit() } })
        for (const a of ['FOO_PRIVATE_BAR', 'PRIVATE_FUTURE']) {
            expect(isPrivateModeAction(a), a).toBe(true)
            expect(await gonder(a, { sourceAccountKey: 'a-1', ticket: 't-1' }), a)
                .toEqual({ success: false, error: PRIVATE_GATE_CODES.DISABLED })
        }
    })
})

// I1: sayfa kokenli PRIVATE_* mesaji iki modda (ve bayrak kapaliyken) BAYT BAYT ayni 4100'u
// alir; kapiya ulasmaz. Aksi halde gizli kapi mod oracle'i olurdu ve sahte bir
// sourceAccountKey ile tahmin edilen Gizli Hesap adresi dogrulanabilirdi.
describe('PRIVATE_* -- sayfa kokeni iki modda ayni red (mod sizintisi yok)', () => {
    const ACTIONS = [...PRIVATE_ACTIONS, 'ATS_PRIVATE_FEE_QUOTE', 'PRIVATE_PROVIDER_INFO']
    const RED = { error: { code: 4100, message: 'Unauthorized' } }
    const GIZLI_KAYITLI = { ...GIZLI, derivationPath: "m/44'/60'/0'/1/0" }
    const SAHTE_ANAHTAR = `private-${GIZLI.address}`
    const govde = (over) => ({ sourceAccountKey: SAHTE_ANAHTAR, outputAddress: GIZLI.address, sourceChainId: 56, ticket: 't-1', ...over })

    async function bootMod({ active, flag = 'true' }) {
        localStore = {
            active_account: active,
            vaults: [{ type: 'hd', accounts: [A], privateAccount: GIZLI_KAYITLI }],
            currentNetwork: { chainId: 56, name: 'BNB Smart Chain' },
        }
        bg = await bootBackground({ privacyFlag: flag, localStore, sessionStore: { private_quotes: {} } })
        await yazimlariBekle()
        chrome.storage.local.set.mockClear()
        chrome.storage.local.get.mockClear()
    }

    for (const sender of [DAPP_SENDER, YABANCI_SENDER]) {
        for (const a of ACTIONS) {
            it(`${a} (${sender.origin}): normal mod, gizli mod ve bayrak kapali ayni 4100`, async () => {
                const yanitlar = []
                for (const [active, flag] of [[A, 'true'], [GIZLI_KAYITLI, 'true'], [GIZLI_KAYITLI, 'false']]) {
                    await bootMod({ active, flag })
                    // method olarak (content.js'in gonderdigi sekil) ve type olarak
                    for (const mesaj of [{ method: a, ...govde() }, { type: a, message: govde() }, { method: a, params: [] }]) {
                        const res = await callHandler(mesaj, sender)
                        expect(res).toBeDefined()
                        yanitlar.push(res)
                    }
                    await islemYapilmadi()
                }
                expect(yanitlar.length).toBe(9)
                for (const res of yanitlar) expect(res).toEqual(RED)
            })
        }
    }

    it('sahte sourceAccountKey ile tahmin edilen Gizli Hesap adresi dogrulanamaz (gercek anahtar da ayni)', async () => {
        const yanitlar = []
        for (const key of [SAHTE_ANAHTAR, 'g-1', 'a-1', 'yok']) {
            for (const output of [GIZLI.address, '0x' + '12'.repeat(20)]) {
                await bootMod({ active: GIZLI_KAYITLI })
                yanitlar.push(await callHandler({ method: 'PRIVATE_QUOTE', ...govde({ sourceAccountKey: key, outputAddress: output }) }, YABANCI_SENDER))
            }
        }
        expect(yanitlar.length).toBe(8)
        for (const res of yanitlar) expect(res).toEqual(RED)
    })

    it('cuzdanin kendi arayuzunden gelen istek bu reddi ALMAZ (kapiya ulasir)', async () => {
        await bootMod({ active: A })
        expect(await callHandler({ type: 'PRIVATE_QUOTE', message: govde({ sourceAccountKey: 'a-1' }) }))
            .toEqual({ success: false, error: PRIVATE_GATE_CODES.MODE_OFF })
    })
})
