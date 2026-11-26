// Yeni cuzdan olusturma ekrani (CreatePassword.vue): ilk hesabin TON adresi OLUSTURMA ANINDA,
// kullanicinin zaten bekledigi sifreleme adiminda yazilir ve damgalanir. Damgasiz kalsaydi
// ilk Home yuklemesi ensureTonAddress icinde 4-6 sn TON turetmesini beklerdi.
//
// Turetme GERCEK (mock yok): ayni seed'den ayni adres, TON'un kendi turetme yoluyla
// (tonIdentityForAccount, damgali kayitta capraz kontrol de calisir) BIREBIR eslesmeli.
import { describe, it, expect, afterEach } from 'vitest'
import { getBytes } from 'ethers'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { deriveMasterKey } from '../../utils/crypto-utils'
import { tonIdentityForAccount, tonAddressIsCurrentScheme, ensureTonAddress } from '../../utils/ton/tonIdentity'
import { unlockVault } from '../../utils/crypto-utils'
import { heavyBackgroundTimeouts } from '../../test-utils/heavyBackgroundTimeouts.js'
import CreatePassword from './CreatePassword.vue'

heavyBackgroundTimeouts()

const STRONG = 'Kuvvetli-Parola-2026!x'

afterEach(() => { delete globalThis.chrome })

async function run() {
    const { localStore: store } = installChromeStub({})
    const events = {}
    const app = createApp(CreatePassword, {
        props: { onWallet_created: (w) => { events.wallet = w } },
    })
    app.use(createTestPinia())
    app.use(createTestI18n())
    const holder = captureInstance(app, 'CreatePassword')
    await render(app)
    const state = holder.instance.setupState
    state.password = STRONG
    state.confirmPassword = STRONG
    state.termsAccepted = true
    await state.create()
    return { store, events, errorMessage: state.errorMessage }
}

describe('CreatePassword: yeni cuzdanin TON adresi olusturma aninda damgali', () => {
    it('ilk hesap tonAddress + tonScheme tasir; active_account ayni kayit', async () => {
        const { store, errorMessage } = await run()
        expect(errorMessage).toBe('')
        const account = store.vaults[0].accounts[0]
        expect(account.tonAddress).toMatch(/^UQ/)
        expect(tonAddressIsCurrentScheme(account)).toBe(true)
        expect(store.active_account.tonAddress).toBe(account.tonAddress)
        expect(store.active_account.tonScheme).toBe(account.tonScheme)
    })

    it('adres, ayni seed icin TON kimlik yolunun urettigiyle birebir ayni', async () => {
        const { store } = await run()
        const vault = store.vaults[0]
        const account = vault.accounts[0]
        const masterKey = await deriveMasterKey(STRONG, getBytes(store.walletSalt))
        // Damgali kayitta tonIdentityForAccount adres uyusmazliginda TON_ADDRESS_MISMATCH atar.
        const { friendly } = await tonIdentityForAccount(masterKey, store.vaults, account)
        expect(friendly).toBe(account.tonAddress)
        expect(await unlockVault(masterKey, vault)).toBeTruthy()
    })

    it('damgali hesapta ensureTonAddress turetmeden doner (kasaya ve depoya dokunmaz)', async () => {
        const { store } = await run()
        const account = store.active_account
        const before = JSON.stringify(store.vaults)
        // Ana anahtar oturumda YOK: turetme gerekseydi WALLET_LOCKED atardi.
        expect(await ensureTonAddress(account)).toBe(account.tonAddress)
        expect(JSON.stringify(store.vaults)).toBe(before)
    })
})
