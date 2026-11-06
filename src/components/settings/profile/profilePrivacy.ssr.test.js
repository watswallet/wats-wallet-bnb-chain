// Profil ekranlari gizli modda (C-I4 + E-I6).
//
// KOK NEDEN: EditUsername.save() Gizli Hesap adresini mesaja gomup SIGN gonderiyordu;
// kapi PRIVATE_USE_PRIVATE_SEND ile reddediyor ve `if (!data.success) return` bunu
// SESSIZCE yutuyordu (kaydet bir sey yapmiyor, hata yok). Engel yalniz kapidir: bir gun
// SIGN serbest birakilirsa { userID, address: <Gizli Hesap>, signature } sunucumuza
// gidip Gizli Hesabi profil kimligine baglardi. Burada: satir gizlenir, save() SIGN'a
// HIC ulasmaz ve reddedilince gorunur hata verir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn(async () => ({ data: {} }))
vi.mock('axios', () => ({ default: { post: (...a) => axiosPostMock(...a) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../../test-utils/ssrRender.js'
import { privacyStore } from '../../../store/privacy'
import { pageStore } from '../../../store/pageStore'
import EditProfile from './EditProfile.vue'
import EditUsername from './EditUsername.vue'

const NORMAL = { key: 'a', address: '0xAbCdEf0000000000000000000000000000000001', derivationPath: "m/44'/60'/0'/0/0" }
const GIZLI = { key: 'p', address: '0xCcccCccc00000000000000000000000000000003', private: true, derivationPath: "m/44'/60'/0'/1/0" }
const USER = { username: 'tester', userID: 'u-1' }

afterEach(() => {
    axiosPostMock.mockClear()
    delete globalThis.chrome
})

function mount(Component, name, { privateActive, active = NORMAL, sendMessage }) {
    const stub = installChromeStub({ active_account: active, user: USER })
    if (sendMessage) stub.setSendMessage(sendMessage)
    const app = createApp(Component)
    app.use(createTestPinia())
    app.use(createTestI18n('en'))
    privacyStore().active = privateActive
    const captured = captureInstance(app, name)
    return { app, captured }
}

describe('EditProfile.vue (SSR) -- kullanici adi satiri', () => {
    it('normal modda satir GORUNUR (regresyon)', async () => {
        const { app } = mount(EditProfile, 'EditProfile', { privateActive: false })
        const html = await render(app)
        expect(html).toContain('>Username<')
        expect(html).toContain('@tester')
    })

    it('gizli modda satir GORUNMEZ (ne etiket ne ad)', async () => {
        const { app } = mount(EditProfile, 'EditProfile', { privateActive: true, active: GIZLI })
        const html = await render(app)
        expect(html).not.toContain('>Username<')
        expect(html).not.toContain('@tester')
        expect(html).not.toContain('settings_edit_username')
    })
})

describe('EditUsername.vue (SSR) -- save() gizli modda', () => {
    async function kaydetmeyiDene({ privateActive, active, sendMessage }) {
        const calls = []
        const { app, captured } = mount(EditUsername, 'EditUsername', {
            privateActive, active,
            sendMessage: async (m) => { calls.push(m); return sendMessage ? sendMessage(m) : { success: true, signature: '0xsig' } },
        })
        await render(app)
        const state = captured.instance.setupState
        // Kaydedilebilir duruma getir (yeni, gecerli bir ad)
        state.username = 'yeni_ad'
        state.isValid = true
        await state.save()
        return { state, calls }
    }

    it('gizli modda SIGN HIC gonderilmez, sunucuya istek gitmez, gorunur hata verilir', async () => {
        const { state, calls } = await kaydetmeyiDene({ privateActive: true, active: GIZLI })
        expect(calls.filter((m) => m.type === 'SIGN')).toHaveLength(0)
        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(state.errorMessage).toBe('An unknown error occurred.')
        expect(state.saving).toBe(false)
    })

    it('arayuz bayragi geride kalsa bile aktif hesap Gizli Hesapsa SIGN gonderilmez', async () => {
        const { calls, state } = await kaydetmeyiDene({ privateActive: false, active: GIZLI })
        expect(calls.filter((m) => m.type === 'SIGN')).toHaveLength(0)
        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(state.errorMessage).toBe('An unknown error occurred.')
    })

    it('normal modda SIGN gonderilir ve basarida profil ekranina donulur (regresyon)', async () => {
        const { state, calls } = await kaydetmeyiDene({ privateActive: false })
        expect(calls.filter((m) => m.type === 'SIGN')).toHaveLength(1)
        expect(axiosPostMock).toHaveBeenCalledTimes(1)
        expect(state.errorMessage).toBeNull()
        expect(pageStore().currentPage).toBe('settings_edit_profile')
    })

    it('SIGN reddedilirse (success:false) sessiz kalmaz: gorunur genel hata, sunucuya istek yok', async () => {
        const { state } = await kaydetmeyiDene({
            privateActive: false,
            sendMessage: async () => ({ success: false, error: 'PRIVATE_USE_PRIVATE_SEND' }),
        })
        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(state.errorMessage).toBe('An unknown error occurred.')
        // Ham kapi kodu ekrana cikmaz.
        expect(state.errorMessage).not.toContain('PRIVATE')
        expect(state.saving).toBe(false)
    })
})
