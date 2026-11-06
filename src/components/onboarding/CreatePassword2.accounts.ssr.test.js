// Ilk cuzdanda taranan hesaplar: onboarding/index.vue tarama sonucundaki hesap sayisini
// CreatePassword2'ye `account_count` olarak tasir; kasa (`vaults`) YALNIZ burada, sifre
// adiminda, TEK `chrome.storage.local.set` ile yazilir (tarama hicbir sey yazmaz).
//
// CreatePassword2 GERCEKTEN render edilir ve create() gercek PBKDF2 / AES / HD turetmesiyle
// calisir; yalniz agir TON turetmesi sahtedir (gercegi newAccountTonAddress.test.js'te).
// Depodaki baska SSR testlerinde gorulen `vi.mock('vue', ...)` (onMounted -> onServerPrefetch)
// BURADA yok: CreatePassword2 onMounted kullanmaz, tum is create() icinde ve elle cagrilir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../utils/ton/newAccountTonAddress', () => ({
    tonFieldsForNewAccount: vi.fn(async (_m, i) => ({ tonAddress: 'UQ-test-' + i, tonScheme: 'test' })),
}))

import { getBytes } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { passwordStrength, MIN_PASSWORD_SCORE } from '../../utils/passwordStrength'
import { deriveMasterKey, unlockVault } from '../../utils/crypto-utils'
import { userStore } from '../../store/user'
import CreatePassword2 from './CreatePassword2.vue'

const JUNK = 'test test test test test test test test test test test junk'
// Bu ifadenin MetaMask/Trust yolundaki bilinen ilk uc adresi (hdAccounts.test.js ile ayni).
const HARDHAT = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
]
const STRONG = 'Kuvvetli-Parola-2026!x'

// vue-i18n (gelistirme derlemesi), yerel kapsami olmayan her <i18n-t> icin "Not found parent
// scope" uyarisini basar ve kuresel kapsamla devam eder; bu ekrandaki sozlesme baglantisi o
// etiketi kullanir (Receive.ssr.test.js de ayni uyariyi basar). YALNIZ bu uyari susturulur,
// baska uyarilar aynen akar.
let warnSpy
beforeEach(() => {
    const realWarn = console.warn
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
        if (!String(args[0]).includes('Not found parent scope')) realWarn(...args)
    })
})
afterEach(() => {
    warnSpy.mockRestore()
    delete globalThis.chrome
})

// Ekrani render eder, parolayi/sartlari doldurur ve create()'i calistirir. Ekranin
// disindan gorulebilen her seyi dondurur: depo, set cagrilari, 'confirmed' olayi, user
// deposu ve ekranin hata metni (create() hatayi yutup metne yazar; bos olmali).
async function run(props) {
    const { localStore: store } = installChromeStub({})
    const setSpy = vi.spyOn(globalThis.chrome.storage.local, 'set')
    const onConfirmed = vi.fn()
    const pinia = createTestPinia()
    const app = createApp(CreatePassword2, { props: { ...props, onConfirmed } })
    app.use(pinia)
    app.use(createTestI18n())
    const holder = captureInstance(app, 'CreatePassword2')
    await render(app)
    const state = holder.instance.setupState
    state.password = STRONG
    state.confirmPassword = STRONG
    state.termsAccepted = true
    await state.create()
    return { store, setSpy, onConfirmed, user: userStore(pinia), errorMessage: state.errorMessage }
}

describe('CreatePassword2: ilk cuzdanda hesap sayisi', () => {
    it('on kosul: test parolasi guc esigini gecer', () => {
        expect(passwordStrength(STRONG)).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE)
    })

    it('account_count=3 -> tek kasada 3 hesap, adlar Wats 1..3, aktif hesap indeks 0', async () => {
        const { store, setSpy, onConfirmed, errorMessage } = await run({ mnemonic: JUNK, account_count: 3 })
        expect(errorMessage).toBe('')
        expect(store.vaults).toHaveLength(1)
        expect(store.vaults[0].accounts.map((a) => [a.index, a.name])).toEqual([[0, 'Wats 1'], [1, 'Wats 2'], [2, 'Wats 3']])
        expect(store.active_account.index).toBe(0)
        expect(setSpy.mock.calls.filter(([o]) => 'vaults' in o)).toHaveLength(1)
        expect(onConfirmed).toHaveBeenCalledWith('create_username')
    })

    // "Hesap ekle" ile ayni kayit bicimi: ayni seed'in her hesabi MetaMask/Trust yolundan,
    // TON adresi OLUSTURMA ANINDA yazilmis ve kasanin parmak izini tasir.
    it('hesaplar HD yolundan, TON alanlari ve kasa parmak iziyle gelir', async () => {
        const { store } = await run({ mnemonic: JUNK, account_count: 3 })
        const [vault] = store.vaults
        expect(vault.type).toBe('hd')
        expect(vault.accounts.map((a) => a.address)).toEqual(HARDHAT)
        expect(vault.accounts.map((a) => a.derivationPath)).toEqual([
            "m/44'/60'/0'/0/0", "m/44'/60'/0'/0/1", "m/44'/60'/0'/0/2",
        ])
        expect(vault.accounts.map((a) => a.tonAddress)).toEqual(['UQ-test-0', 'UQ-test-1', 'UQ-test-2'])
        expect(vault.accounts.every((a) => a.type === 'hd' && a.tonScheme === 'test')).toBe(true)
        expect(new Set(vault.accounts.map((a) => a.fingerprint))).toEqual(new Set([vault.fingerprint]))
        expect(new Set(vault.accounts.map((a) => a.key)).size).toBe(3)
    })

    it('aktif hesap kasanin ilk hesabi; user deposuna da o yazilir', async () => {
        const { store, user } = await run({ mnemonic: JUNK, account_count: 3 })
        expect(store.active_account).toEqual(store.vaults[0].accounts[0])
        expect(store.active_account.address).toBe(HARDHAT[0])
        expect(user.address).toBe(HARDHAT[0])
        expect(user.vault.id).toBe(store.vaults[0].id)
    })

    // Kasa gercekten acilabilmeli: sifre dogrulamasi kasa cozerek yapiliyor (utils/masterKey.js).
    // Bas/son bosluklu ifade de kurulur ve kasaya KIRPILMIS haliyle girer (assembleHdVault
    // kirpmaz, bosluklu ifade createVault icinde firlatirdi).
    it('kasa sifreyle acilir ve ifade kirpilmis haliyle saklanir', async () => {
        const { store, errorMessage } = await run({ mnemonic: `  ${JUNK} `, account_count: 2 })
        expect(errorMessage).toBe('')
        const masterKey = await deriveMasterKey(STRONG, getBytes(store.walletSalt))
        expect(await unlockVault(masterKey, store.vaults[0])).toBe(JUNK)
        expect(store.vaults[0].accounts).toHaveLength(2)
    })

    it('account_count verilmezse bugunku gibi TEK hesap', async () => {
        const { store } = await run({ mnemonic: JUNK })
        expect(store.vaults[0].accounts).toHaveLength(1)
        expect(store.vaults[0].accounts[0].name).toBe('Wats 1')
    })

    it.each([0, -2, 'x'])('account_count=%s gecersiz -> TEK hesap', async (v) => {
        const { store } = await run({ mnemonic: JUNK, account_count: v })
        expect(store.vaults[0].accounts).toHaveLength(1)
    })

    // Sayi tarayicidan gelir (en fazla SCAN_MAX_ACCOUNTS = 20), ama kasayi kuran uc nokta kendi savunmasini tasir:
    // sonsuz ya da dev bir sayi buildHdAccounts'u bitmeyen bir donguye sokardi (her turda TON turetmesi), isCreating
    // hep true kalir ve ekran takilirdi. Sonlu ve 1..20 araligina sikisir; tam sayiya yuvarlanir (asagi).
    it.each([
        [Infinity, 20],
        [21, 20],
        [-Infinity, 1],
        [2.9, 2],
    ])('account_count=%s -> %i hesap (sonlu ve 1..20 araligina sikisir)', async (v, beklenen) => {
        const { store, errorMessage } = await run({ mnemonic: JUNK, account_count: v })
        expect(errorMessage).toBe('')
        expect(store.vaults[0].accounts).toHaveLength(beklenen)
        expect(store.vaults[0].accounts.map((a) => a.index)).toEqual(Array.from({ length: beklenen }, (_, i) => i))
    })
})

// Geri dugmesi kasa yazimi surerken kilitli: create() walletSalt'i yazdiktan sonra 20 hesapli ilk cuzdanda ~4 sn
// surer; bu sirada Geri -> 'start' sirlari siler ama create() kasayi yine yazar ve son emit unmount edilmis
// bilesende sessizce duser (ekran baslangicta, depoda cuzdan: ayni seed tekrar iceri alinamaz).
describe('CreatePassword2: Geri dugmesi kasa yazimi surerken kilitli', () => {
    // Ekrani render eder; isCreating'i render'dan ONCE verilen degere kurar (captureInstance onCapture,
    // render'dan once calisir). Ilk <button>, Geri dugmesidir (sifre goster/gizle ve gonder dugmesi sonra gelir).
    async function geriDugmesi(isCreating) {
        installChromeStub({})
        const onConfirmed = vi.fn()
        const pinia = createTestPinia()
        const app = createApp(CreatePassword2, { props: { mnemonic: JUNK, account_count: 3, onConfirmed } })
        app.use(pinia)
        app.use(createTestI18n())
        const holder = captureInstance(app, 'CreatePassword2', (instance) => { instance.setupState.isCreating = isCreating })
        const html = await render(app)
        const tag = html.match(/<button[^>]*>/)[0]
        return { tag, onConfirmed, state: holder.instance.setupState }
    }

    it('isCreating=true iken Geri dugmesi disabled', async () => {
        const { tag } = await geriDugmesi(true)
        expect(tag).toMatch(/\sdisabled(=|\s|>)/)
    })

    it('isCreating=false iken Geri dugmesi etkin', async () => {
        const { tag } = await geriDugmesi(false)
        expect(tag).not.toMatch(/\sdisabled(=|\s|>)/)
    })

    it('goBack: isCreating=true iken start olayi YAYILMAZ, false iken yayilir', async () => {
        const { state, onConfirmed } = await geriDugmesi(true)
        state.goBack()
        expect(onConfirmed).not.toHaveBeenCalled()
        state.isCreating = false
        state.goBack()
        expect(onConfirmed).toHaveBeenCalledTimes(1)
        expect(onConfirmed).toHaveBeenCalledWith('start')
    })
})
