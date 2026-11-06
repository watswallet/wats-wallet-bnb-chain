import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HDNodeWallet, verifyMessage } from 'ethers'
import { bootBackground, teardownBackground } from './test-utils/backgroundHarness'
import { createVault, deriveMasterKey, randBytes } from './utils/crypto-utils'
import { exportMasterKey } from './utils/masterKey'
import { findVaultForAccount } from './utils/deriveAccount'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Tum background.js'i ayaga kaldiran dosya: yukluyken 15 sn yetmiyor (T28, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

const setPrivacyModeMock = vi.fn()
vi.mock('./utils/privacy/privacyMode', async (importOriginal) => ({
    ...(await importOriginal()),
    setPrivacyMode: (...args) => setPrivacyModeMock(...args),
}))

const GIZLI = { key: 'g-1', address: '0x' + 'cd'.repeat(20), type: 'hd', private: true }
const A = { key: 'a-1', address: '0x' + 'ab'.repeat(20), type: 'hd' }
const B = { key: 'b-1', address: '0x' + 'ef'.repeat(20), type: 'hd' }

let bg, localStore
const callHandler = (...args) => bg.call(...args)

async function boot(flag) {
    localStore = { active_account: A, vaults: [{ accounts: [A, B] }], dapps: { 'a.com': { accounts: [A.address] } }, solana_dapps: {} }
    // Acik sekme (hostname'i a.com): hesap degisiminin EVM yayini yalniz ACIK sekmeli sitelere gider.
    bg = await bootBackground({ privacyFlag: flag, localStore, tabs: [{ id: 7, url: 'https://a.com/' }] })
}

afterEach(teardownBackground)

describe('PRIVACY_MODE_SET', () => {
    beforeEach(() => boot('true'))

    it('setPrivacyMode\'u dogru bagimliliklarla cagirir ve sonucu doner', async () => {
        setPrivacyModeMock.mockResolvedValueOnce({ enabled: true, account: GIZLI })
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(res).toEqual({ success: true, enabled: true, address: GIZLI.address })
        const [enabled, deps] = setPrivacyModeMock.mock.calls[0]
        expect(enabled).toBe(true)
        expect(deps.storage).toBe(chrome.storage.local)
        expect(typeof deps.getMasterKey).toBe('function')
        expect(typeof deps.announce).toBe('function')
        expect(deps.allChains.some((c) => c.chainId === 56)).toBe(true)
    })

    // P5 (spec 4.9): cikista arka plan, girisin kaydettigi donmus ag kaydini setPrivacyMode'a
    // `restoreNetwork` olarak verir (ag, hesap yazimiyla AYNI storage.set'te geri yazilsin diye);
    // giriste vermez (giris davranisi degismez).
    it('cikista donmus ag kaydini restoreNetwork olarak verir, giriste vermez', async () => {
        const donmus = { chainId: 137, name: 'Polygon' }
        localStore.privacy_frozen_network = donmus
        setPrivacyModeMock.mockResolvedValueOnce({ enabled: false, account: A })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        expect(setPrivacyModeMock.mock.calls[0][1].restoreNetwork).toEqual(donmus)

        setPrivacyModeMock.mockResolvedValueOnce({ enabled: true, account: GIZLI })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(setPrivacyModeMock.mock.calls[1][1].restoreNetwork).toBeUndefined()
    })

    it('hata kodunu oldugu gibi tasir', async () => {
        setPrivacyModeMock.mockRejectedValueOnce(new Error('WALLET_LOCKED'))
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(res).toEqual({ success: false, error: 'WALLET_LOCKED' })
    })

    it('getMasterKey oturum anahtari yoksa WALLET_LOCKED firlatir', async () => {
        setPrivacyModeMock.mockImplementationOnce(async (_e, deps) => { await deps.getMasterKey() })
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(res).toEqual({ success: false, error: 'WALLET_LOCKED' })
    })

    // WalletConnect 1.8.3 birlesmesi: hesap degisiminin EVM yayini TEK tetikleyiciden gider
    // (active_account onChanged); announce yalniz Solana yarisini yapar. Ikisi de EVM yaysaydi ayni
    // gecis siteye iki kez bildirilirdi.
    it('announce EVM accountsChanged YAYMAZ (EVM yarisi active_account onChanged ile gider)', async () => {
        setPrivacyModeMock.mockImplementationOnce(async (_e, deps) => {
            await deps.announce(GIZLI)
            await deps.announce(A)
            return { enabled: false, account: A }
        })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        const evm = chrome.tabs.sendMessage.mock.calls.filter(([, msg]) => msg.method === 'accountsChanged')
        expect(evm).toEqual([])
    })

    // Gizli Hesap adi ETKIN arayuz dilinden secilir: kayitli dil yoksa tarayici dilinden
    // (Tercihler'e hic girmemis kullanici arayuzde tarayici diliyle gorur).
    describe('Gizli Hesap adi etkin dilden secilir', () => {
        afterEach(() => vi.unstubAllGlobals())

        async function adiSor(kayitliDil, navigatorLanguages) {
            vi.stubGlobal('navigator', { languages: navigatorLanguages, language: navigatorLanguages[0] })
            if (kayitliDil === undefined) delete localStore.language
            else localStore.language = kayitliDil
            setPrivacyModeMock.mockResolvedValueOnce({ enabled: true, account: GIZLI })
            await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
            return setPrivacyModeMock.mock.calls[0][1].privateAccountName
        }

        it('dil kayitli degil + tarayici tr-TR -> Gizli Hesap', async () => {
            expect(await adiSor(undefined, ['tr-TR'])).toBe('Gizli Hesap')
        })

        it('dil kayitli degil + tarayici en-US -> Private Account', async () => {
            expect(await adiSor(undefined, ['en-US'])).toBe('Private Account')
        })

        it('kayitli en, tarayici tr olsa da kazanir', async () => {
            expect(await adiSor('en', ['tr-TR'])).toBe('Private Account')
        })

        it('kayitli tr, tarayici en olsa da kazanir', async () => {
            expect(await adiSor('tr', ['en-US'])).toBe('Gizli Hesap')
        })
    })

    // Task 4 inceleme M2: boolean olmayan `enabled` sessizce "false" sayilip
    // gizli moddan CIKARMAMALI.
    it.each([['dize "true"', 'true'], ['sayi 1', 1], ['undefined', undefined], ['null', null]])(
        'boolean olmayan enabled (%s) reddedilir, setPrivacyMode cagrilmaz',
        async (_ad, deger) => {
            const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: deger })
            expect(res).toEqual({ success: false, error: 'INVALID_ENABLED' })
            expect(setPrivacyModeMock).not.toHaveBeenCalled()
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled()
        },
    )

    // Task 4 inceleme M3: giris hala calisirken gelen cikis yutulmamali, sirayla uygulanmali.
    it('gecisler gelis sirasiyla TEK TEK uygulanir: giris bitmeden cikis baslamaz', async () => {
        const olaylar = []
        let girisiBitir
        setPrivacyModeMock
            .mockImplementationOnce(async () => {
                olaylar.push('giris-basladi')
                await new Promise((resolve) => { girisiBitir = resolve })
                olaylar.push('giris-bitti')
                return { enabled: true, account: GIZLI }
            })
            .mockImplementationOnce(async () => {
                olaylar.push('cikis-basladi')
                return { enabled: false, account: A }
            })

        const giris = callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        const cikis = callHandler({ type: 'PRIVACY_MODE_SET', enabled: false })
        // Cikis istegi verildi ama giris bitmedi: cikis baslamamali.
        await vi.waitFor(() => expect(olaylar).toEqual(['giris-basladi']))
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(olaylar).toEqual(['giris-basladi'])

        girisiBitir()
        expect(await giris).toEqual({ success: true, enabled: true, address: GIZLI.address })
        expect(await cikis).toEqual({ success: true, enabled: false, address: A.address })
        expect(olaylar).toEqual(['giris-basladi', 'giris-bitti', 'cikis-basladi'])
    })

    it('basarisiz bir gecis kuyrugu kilitlemez: sonraki gecis yine calisir', async () => {
        setPrivacyModeMock
            .mockRejectedValueOnce(new Error('WALLET_LOCKED'))
            .mockResolvedValueOnce({ enabled: true, account: GIZLI })
        const [ilk, ikinci] = await Promise.all([
            callHandler({ type: 'PRIVACY_MODE_SET', enabled: true }),
            callHandler({ type: 'PRIVACY_MODE_SET', enabled: true }),
        ])
        expect(ilk).toEqual({ success: false, error: 'WALLET_LOCKED' })
        expect(ikinci).toEqual({ success: true, enabled: true, address: GIZLI.address })
    })

    it('sayfa kokenli (dapp) istek kapida reddedilir, setPrivacyMode cagrilmaz', async () => {
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: false }, { url: 'https://evil.example/', tab: { id: 3 } })
        expect(res).toEqual({ error: { code: 4100, message: 'Unauthorized' } })
        expect(setPrivacyModeMock).not.toHaveBeenCalled()
    })
})

describe('PRIVACY_MODE_SET bayrak kapali', () => {
    beforeEach(() => boot('false'))

    it('PRIVACY_DISABLED doner, setPrivacyMode cagrilmaz', async () => {
        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(res).toEqual({ success: false, error: 'PRIVACY_DISABLED' })
        expect(setPrivacyModeMock).not.toHaveBeenCalled()
    })
})

describe('ACCOUNT_CHANGED (spec 7.1)', () => {
    beforeEach(() => boot('true'))

    // Hesap degisiminin EVM yayini active_account onChanged'inden gider (yayin DEPODAKI hesaba bakar,
    // mesajin soyledigi adrese degil; spec 6.1-3). ACCOUNT_CHANGED mesaji EVM yaymaz.
    async function hesapDegisti(yeni) {
        const eski = localStore.active_account
        localStore.active_account = yeni
        for (const fn of bg.listeners.onChanged) fn({ active_account: { oldValue: eski, newValue: yeni } }, 'local')
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const evmOlaylari = () => chrome.tabs.sendMessage.mock.calls.filter(([, msg]) => msg.method === 'accountsChanged')

    it('ACCOUNT_CHANGED mesajindaki adres hicbir yere yayinlanmaz ve EVM accountsChanged yollanmaz', async () => {
        await callHandler({ type: 'ACCOUNT_CHANGED', address: GIZLI.address })
        expect(evmOlaylari()).toEqual([])
        for (const [, msg] of chrome.tabs.sendMessage.mock.calls) {
            expect(JSON.stringify(msg)).not.toContain(GIZLI.address)
        }
    })

    it('aktif hesap gizliyse Gizli adres YAYINLANMAZ: acik siteler accountsChanged([]) alir, kayit degismez', async () => {
        await hesapDegisti(GIZLI)
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ method: 'accountsChanged', result: [] }))
        expect(JSON.stringify(chrome.tabs.sendMessage.mock.calls)).not.toContain(GIZLI.address)
        expect(localStore.dapps['a.com'].accounts).toEqual([A.address])
    })

    it('normal hesapta davranis degismez: hibeyi izleyen site yeni hesabi alir', async () => {
        await hesapDegisti(B)
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ method: 'accountsChanged', result: [B.address] }))
    })

    it('aktif hesabin EVM tarafi yoksa bos liste yayinlanir', async () => {
        await hesapDegisti({ key: 't-1', address: 'UQ' + 'A'.repeat(46), type: 'ton' })
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, expect.objectContaining({ method: 'accountsChanged', result: [] }))
    })

    // Solana dongusu iki yolda da calisir (solana_dapps'te en az bir origin var).
    const SOLANA_OTURUM = { 'https://jup.ag': { address: 'S'.repeat(44), accountKey: 'sol-1' } }
    const solanaMesajlari = () => chrome.tabs.sendMessage.mock.calls.filter(([, msg]) => msg.target === 'wats_solana_inpage')

    it('ACCOUNT_CHANGED Solana dapplerine change / bos accounts yollar', async () => {
        localStore.solana_dapps = SOLANA_OTURUM
        await callHandler({ type: 'ACCOUNT_CHANGED', address: A.address })
        const mesajlar = solanaMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0][1]).toEqual(expect.objectContaining({ origin: 'https://jup.ag', event: { event: 'change', payload: { accounts: [] } } }))
    })

    it('gecis duyurusu (announce) da Solana dapplerine change / bos accounts yollar', async () => {
        localStore.solana_dapps = SOLANA_OTURUM
        setPrivacyModeMock.mockImplementationOnce(async (_e, deps) => {
            await deps.announce(GIZLI)
            return { enabled: true, account: GIZLI }
        })
        await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        const mesajlar = solanaMesajlari()
        expect(mesajlar).toHaveLength(1)
        expect(mesajlar[0][1]).toEqual(expect.objectContaining({ origin: 'https://jup.ag', event: { event: 'change', payload: { accounts: [] } } }))
    })
})

// Task 3 inceleme M5: depoya yazilan Gizli Hesap, IMZA YOLLARININ kullandigi arama
// (findVaultForAccount + createWalletInstance'in derivationPath'e saygisi) ile,
// adresi Gizli Hesap'inkiyle ayni bir anahtara cozulmeli. Gercek setPrivacyMode ve
// gercek SIGN dagiticisi uzerinden: SIGN -> signInternal -> resolveAccount (depodaki
// aktif hesap) -> createWalletInstance. Imzadan kurtarilan adres Gizli Hesap'tir.
describe('imza yolu kaniti (gercek setPrivacyMode)', () => {
    const MNEMONIC = 'test test test test test test test test test test test junk'
    const root = HDNodeWallet.fromPhrase(MNEMONIC, null, 'm')
    const normal0 = root.derivePath("m/44'/60'/0'/0/0")
    const gizliBeklenen = root.derivePath("m/44'/60'/0'/1/0")

    it('PRIVACY_MODE_SET(true) sonrasi SIGN, Gizli Hesap adresinin anahtariyla imzalar', async () => {
        // ONCE boot, SONRA depoyu doldur (nesneler referansla gecer): chrome silinmis
        // durumdayken gercek asenkron is (kripto) beklemek, onceki boot'larin bekleyen
        // zamanlayicilarinin atesleyecegi bir pencere acardi (harness artik
        // zamanlayicilari da temizler; bu sira ikinci emniyet).
        const store = {}
        const session = {}
        bg = await bootBackground({ privacyFlag: 'true', localStore: store, sessionStore: session })
        const masterKey = await deriveMasterKey('parola-123456', randBytes(32))
        const hdAccount = { key: 'hd-0', address: normal0.address, name: 'Hesap 1', type: 'hd', index: 0, derivationPath: "m/44'/60'/0'/0/0" }
        const vault = await createVault(masterKey, MNEMONIC, hdAccount)
        Object.assign(store, { active_account: hdAccount, vaults: [vault], currentNetwork: null, language: 'tr' })
        Object.assign(session, { sessionMasterKeyJwk: await exportMasterKey(masterKey) })

        const { setPrivacyMode } = await vi.importActual('./utils/privacy/privacyMode')
        setPrivacyModeMock.mockImplementationOnce(setPrivacyMode)

        const res = await callHandler({ type: 'PRIVACY_MODE_SET', enabled: true })
        expect(res).toEqual({ success: true, enabled: true, address: gizliBeklenen.address })

        const gizli = store.active_account
        expect(gizli.private).toBe(true)
        expect(gizli.address).toBe(gizliBeklenen.address)
        expect(store.vaults[0].privateAccount.key).toBe(gizli.key)
        expect(store.vaults[0].accounts).toHaveLength(1)
        // Imza yollarinin kullandigi arama Gizli Hesap'in kasasini bulur.
        expect(findVaultForAccount(store.vaults, gizli)?.id).toBe(vault.id)

        // Gizli modda SIGN artik KAPIDA engellenir (PRIVATE_USE_PRIVATE_SEND; bkz.
        // background.privacyGate.test.js). Bu testin sorusu kapi DEGIL, depodaki Gizli
        // Hesap kaydinin imza yoluyla dogru anahtara cozulmesidir: AYNI depo/oturumla
        // bayrak KAPALI yeniden baslatilir ve imza yolu dogrudan calistirilir.
        bg = await bootBackground({ privacyFlag: 'false', localStore: store, sessionStore: session })
        const imza = await callHandler({ type: 'SIGN', message: { sign_message: 'gizli mod' } })
        expect(imza.success).toBe(true)
        expect(verifyMessage('gizli mod', imza.signature)).toBe(gizliBeklenen.address)
        expect(verifyMessage('gizli mod', imza.signature)).not.toBe(normal0.address)
    }, 60000)
})
