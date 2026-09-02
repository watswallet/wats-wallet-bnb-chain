// Sign.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (dapp bug taramasi): personal_sign istegi BELIRLI bir adres icin
// gelir (params[1], background signWith olarak saklar) ama Sign.vue kosulsuz
// AKTIF hesapla imzaliyordu. Kullanici baglantidan sonra hesap degistirdiyse
// dapp'e YANLIS hesabin imzasi doner (SIWE/login dogrulamasi patlar) ya da
// dapp'e hic verilmemis bir hesabin imzasi sizar.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import Sign from './Sign.vue'

const ACCOUNT_A = { key: 'ka', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd', derivationPath: "m/44'/60'/0'/0/0" }
const ACCOUNT_B = { key: 'kb', address: '0xBbbb000000000000000000000000000000000002', name: 'Hesap B', type: 'hd', derivationPath: "m/44'/60'/0'/0/1" }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function setup(currentRequest, { activeAccount = ACCOUNT_A } = {}) {
    const stub = installChromeStub({
        current_request: currentRequest,
        active_account: activeAccount,
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [ACCOUNT_A, ACCOUNT_B] }],
    })
    const gonderilenMesajlar = []
    stub.setSendMessage(async (msg) => {
        gonderilenMesajlar.push(msg)
        if (msg.type === 'SIGN') return { success: true, signature: '0xsig' }
        return {}
    })

    const app = createApp(Sign)
    app.use(createTestPinia())
    app.use(createTestI18n())
    const page = pageStore()
    page.currentPage = 'sign'

    return { app, page, stub, gonderilenMesajlar }
}

const SIGN_REQUEST_FOR_B = {
    type: 'SIGN_MESSAGE',
    id: 'req-sign-1',
    origin: 'https://dapp.example',
    favicon: '',
    messageToSign: '0xdeadbeef',
    // Dapp, B hesabi icin imza istedi; aktif hesap ise A.
    signWith: ACCOUNT_B.address,
}

describe('Sign.vue (SSR) -- imzalayan hesap istekteki signWith adresinden cozulur', () => {
    it('ekranda aktif hesap DEGIL, istenen (signWith) hesap gosterilir', async () => {
        const { app } = setup(SIGN_REQUEST_FOR_B)
        const holder = captureInstance(app, 'Sign')
        await render(app)

        expect(holder.setupStateEmptyError).toBeUndefined()
        expect(holder.instance.setupState.activeAccountAddress).toBe(ACCOUNT_B.address)
        expect(holder.instance.setupState.activeAccountName).toBe('Hesap B')
    })

    it('sign(): imza istegi AKTIF hesapla degil, signWith hesabiyla gonderilir', async () => {
        const { app, gonderilenMesajlar } = setup(SIGN_REQUEST_FOR_B)
        const holder = captureInstance(app, 'Sign')
        await render(app)

        await holder.instance.setupState.sign()

        // resolveAccount (background.js) SIGN mesajindaki `account` NESNESINI
        // kullanir; `index` alani imzalayani SECMEZ. Imzalayan acikca tasinmali.
        const signMsg = gonderilenMesajlar.find(m => m.type === 'SIGN')
        expect(signMsg).toBeDefined()
        expect(signMsg.message.account?.address).toBe(ACCOUNT_B.address)

        const successMsg = gonderilenMesajlar.find(m => m.type === 'SIGN_MESSAGE_SUCCESS')
        expect(successMsg).toBeDefined()
        expect(successMsg.requestId).toBe('req-sign-1')
    })

    it('signWith YOKSA (eski kayit) aktif hesaba dusulur', async () => {
        const { app, gonderilenMesajlar } = setup({ ...SIGN_REQUEST_FOR_B, signWith: undefined })
        const holder = captureInstance(app, 'Sign')
        await render(app)

        expect(holder.instance.setupState.activeAccountAddress).toBe(ACCOUNT_A.address)

        await holder.instance.setupState.sign()
        const signMsg = gonderilenMesajlar.find(m => m.type === 'SIGN')
        expect(signMsg.message.account?.address).toBe(ACCOUNT_A.address)
    })

    it('signWith hicbir kasada yoksa (hesap silinmis) istek REDDEDILIR, imza atilmaz', async () => {
        const silinmis = '0xCccc000000000000000000000000000000000003'
        const { app, page, gonderilenMesajlar } = setup({ ...SIGN_REQUEST_FOR_B, signWith: silinmis })
        const holder = captureInstance(app, 'Sign')
        await render(app)

        const rejectMsg = gonderilenMesajlar.find(m => m.type === 'SIGN_MESSAGE_REJECTED')
        expect(rejectMsg).toBeDefined()
        expect(rejectMsg.requestId).toBe('req-sign-1')
        expect(gonderilenMesajlar.find(m => m.type === 'SIGN')).toBeUndefined()
        expect(page.currentPage).toBe('home')
    })
})
