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

// N2 (hata kodu hijyeni): imza basarisiz olunca arayuz `error` GONDERMIYORDU ve
// resolvePendingRequest bunu 4001 "Request rejected by user" diye dapp'e
// iletiyordu -- ariza kullanici reddi gibi gorunuyordu. Artik imza hatasi
// -32603, kullanici reddi 4001.
describe('Sign.vue (SSR) -- ret yollarinda SAYISAL hata kodu (N2)', () => {
    function setupSignFlow(signImpl) {
        const stub = installChromeStub({
            current_request: SIGN_REQUEST_FOR_B,
            active_account: ACCOUNT_A,
            vaults: [{ id: 'v1', type: 'mnemonic', accounts: [ACCOUNT_A, ACCOUNT_B] }],
        })
        const gonderilenMesajlar = []
        stub.setSendMessage(async (msg) => {
            gonderilenMesajlar.push(msg)
            if (msg.type === 'SIGN') return signImpl(msg)
            return {}
        })
        const app = createApp(Sign)
        app.use(createTestPinia())
        app.use(createTestI18n())
        const page = pageStore()
        page.currentPage = 'sign'
        return { app, page, gonderilenMesajlar }
    }

    // Susturucu bu describe'a ozel geri yuklenir (baska describe eklenirse sizmasin).
    let consoleErrorSpy
    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(() => {
        consoleErrorSpy.mockRestore()
    })

    const reddi = (mesajlar) => mesajlar.find((m) => m.type === 'SIGN_MESSAGE_REJECTED')

    it('SIGN {success:false} donerse -32603 ile reddedilir (4001 DEGIL), ekran home a doner', async () => {
        const { app, page, gonderilenMesajlar } = setupSignFlow(() => ({ success: false }))
        const holder = captureInstance(app, 'Sign')
        await render(app)

        await holder.instance.setupState.sign()

        const red = reddi(gonderilenMesajlar)
        expect(red).toBeDefined()
        expect(red.requestId).toBe('req-sign-1')
        expect(red.status).toBe('error')
        expect(red.error).toEqual({ code: -32603, message: 'Signing failed.' })
        expect(gonderilenMesajlar.find((m) => m.type === 'SIGN_MESSAGE_SUCCESS')).toBeUndefined()
        expect(page.currentPage).toBe('home')
    })

    it('SIGN istegi FIRLATIRSA (arka plan ulasilamaz) ayni -32603 ile reddedilir', async () => {
        const { app, gonderilenMesajlar } = setupSignFlow(() => { throw new Error('port closed') })
        const holder = captureInstance(app, 'Sign')
        await render(app)

        await holder.instance.setupState.sign()

        expect(reddi(gonderilenMesajlar).error).toEqual({ code: -32603, message: 'Signing failed.' })
    })

    it('imza hatasi metni kullanici reddi ifadesi TASIMAZ (AppKit mesajdan da anlar)', async () => {
        const { app, gonderilenMesajlar } = setupSignFlow(() => ({ success: false }))
        const holder = captureInstance(app, 'Sign')
        await render(app)

        await holder.instance.setupState.sign()

        expect(reddi(gonderilenMesajlar).error.message).not.toMatch(/reject|cancel|denied/i)
    })

    it('Reddet (cancel) 4001 ile kalir: kullanici reddi AYNI kod, degismedi (regresyon)', async () => {
        const { app, page, gonderilenMesajlar } = setupSignFlow(() => ({ success: true, signature: '0xsig' }))
        const holder = captureInstance(app, 'Sign')
        await render(app)

        await holder.instance.setupState.cancel()

        const red = reddi(gonderilenMesajlar)
        expect(red.error).toEqual({ code: 4001, message: 'Sign Request cancelled by user.' })
        expect(gonderilenMesajlar.find((m) => m.type === 'SIGN')).toBeUndefined()
        expect(page.currentPage).toBe('home')
    })
})
