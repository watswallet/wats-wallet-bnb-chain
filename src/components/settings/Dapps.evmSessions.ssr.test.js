// EVM oturumlari Ayarlar > Dapp'ler ekraninda (T13, WalletConnect QA G3/G4 UI tarafi).
//
// KOK NEDEN: bu ekran `dapps` haritasini YALNIZ mount aninda okuyordu ve silerken
// o BAYAT anlik goruntuden tum haritayi geri yaziyordu. Arada baska bir baglamda
// yazilan her sey (yeni baglanti, hesap degisimi hibesi, baska sitenin iptali)
// sessizce kayboluyordu; dapp'in wallet_revokePermissions cagrisi da listeye
// yansimiyordu. Cozum: silme dappsStore.updateDapps ile (kilit altinda taze
// okuma-degistir-yaz) ve liste createUiSync ile tazelenir.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import Dapps from './Dapps.vue'

const ADRES = '0xAaaa000000000000000000000000000000000001'
const KAYIT = { accounts: [ADRES], chainId: '0x1', allowedChains: [1] }

const DAPPS_VUE = readFileSync(fileURLToPath(new URL('./Dapps.vue', import.meta.url)), 'utf8')

const bosalt = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

// Sahte navigator.locks: kilit adlarini kaydeder, ayni adli istekleri FIFO seri yapar.
function kilitKur() {
    const adlar = []
    const kuyruklar = new Map()
    vi.stubGlobal('navigator', {
        clipboard: { writeText: async () => {} },
        locks: {
            request: (ad, geriCagri) => {
                adlar.push(ad)
                const kosu = (kuyruklar.get(ad) || Promise.resolve()).then(() => geriCagri({ name: ad }))
                kuyruklar.set(ad, kosu.catch(() => {}))
                return kosu
            },
        },
    })
    return adlar
}

function setup({ dapps = {} } = {}) {
    const stub = installChromeStub({ dapps, ton_dapps: {}, solana_dapps: {} })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return { success: true } })

    // installChromeStub storage.onChanged TANIMLAMAZ; dinleyicileri yakalamak icin elle eklenir.
    const dinleyiciler = []
    globalThis.chrome.storage.onChanged = {
        addListener: (fn) => dinleyiciler.push(fn),
        removeListener: (fn) => {
            const i = dinleyiciler.indexOf(fn)
            if (i > -1) dinleyiciler.splice(i, 1)
        },
    }

    const app = createApp(Dapps)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapps'

    return { app, stub, gonderilen, dinleyiciler }
}

describe('Dapps.vue (SSR) -- EVM oturumlari listelenir', () => {
    it('dapps kayitlari hostname ile listelenir', async () => {
        const { app } = setup({ dapps: { 'uniswap.org': KAYIT, 'aave.com': KAYIT } })
        const holder = captureInstance(app, 'Dapps')
        const html = await render(app)

        expect(html).toContain('uniswap.org')
        expect(html).toContain('aave.com')
        expect(holder.instance.setupState.dapps_list).toEqual(['uniswap.org', 'aave.com'])
    })
})

describe('Dapps.vue (SSR) -- EVM baglanti kesme dappsStore uzerinden (T13)', () => {
    it('disconnect YALNIZ kendi anahtarini siler, DISCONNECT_DAPP yollar, kilit altinda calisir', async () => {
        const { app, stub, gonderilen } = setup({ dapps: { 'uniswap.org': { ...KAYIT }, 'aave.com': { ...KAYIT } } })
        const adlar = kilitKur()
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        await holder.instance.setupState.disconnect('uniswap.org')

        expect(Object.keys(stub.localStore.dapps)).toEqual(['aave.com'])
        expect(adlar).toEqual(['wats-dapps'])
        expect(gonderilen).toContainEqual({ type: 'DISCONNECT_DAPP', hostname: 'uniswap.org' })
        expect(holder.instance.setupState.dapps_list).toEqual(['aave.com'])
    })

    // ASIL HATA: mount aninda alinan anlik goruntu geri yaziliyordu; sonradan
    // eklenen kayit silinirdi.
    it('mount SONRASINDA baska baglamda eklenen kayit disconnect ile KAYBOLMAZ', async () => {
        const { app, stub } = setup({ dapps: { 'uniswap.org': { ...KAYIT } } })
        kilitKur()
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        stub.localStore.dapps['yeni.io'] = { accounts: [ADRES], chainId: '0x89', allowedChains: [137] }
        await holder.instance.setupState.disconnect('uniswap.org')

        expect(stub.localStore.dapps['yeni.io']).toEqual({ accounts: [ADRES], chainId: '0x89', allowedChains: [137] })
        expect(stub.localStore.dapps['uniswap.org']).toBeUndefined()
        // Ekran da diskle uzlasir: yeni kayit listede gorunur.
        expect(holder.instance.setupState.dapps_list).toEqual(['yeni.io'])
    })

    it('baska baglamda guncellenen kayit disconnect ile ESKI haline donmez', async () => {
        const { app, stub } = setup({ dapps: { 'uniswap.org': { ...KAYIT }, 'aave.com': { ...KAYIT } } })
        kilitKur()
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        stub.localStore.dapps['aave.com'].accounts = ['0xBbbb000000000000000000000000000000000002']
        await holder.instance.setupState.disconnect('uniswap.org')

        expect(stub.localStore.dapps['aave.com'].accounts).toEqual(['0xBbbb000000000000000000000000000000000002'])
    })
})

describe('Dapps.vue (SSR) -- dapps degisince liste tazelenir (T13)', () => {
    it('dapp wallet_revokePermissions cagirinca kayit listeden kalkar', async () => {
        const { app, stub, dinleyiciler } = setup({ dapps: { 'uniswap.org': { ...KAYIT }, 'aave.com': { ...KAYIT } } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)
        expect(dinleyiciler.length).toBeGreaterThan(0)

        const eski = stub.localStore.dapps
        const yeni = { 'aave.com': { ...KAYIT } }
        stub.localStore.dapps = yeni
        for (const fn of dinleyiciler) fn({ dapps: { newValue: yeni, oldValue: eski } }, 'local')
        await bosalt()

        expect(holder.instance.setupState.dapps_list).toEqual(['aave.com'])
        expect(Object.keys(holder.instance.setupState.apps)).toEqual(['aave.com'])
    })

    it('yeni baglanan site listeye eklenir', async () => {
        const { app, stub, dinleyiciler } = setup({ dapps: {} })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        const yeni = { 'yeni.io': { ...KAYIT } }
        const eski = stub.localStore.dapps
        stub.localStore.dapps = yeni
        for (const fn of dinleyiciler) fn({ dapps: { newValue: yeni, oldValue: eski } }, 'local')
        await bosalt()

        expect(holder.instance.setupState.dapps_list).toEqual(['yeni.io'])
        expect(holder.instance.setupState.hicBaglantiYok).toBe(false)
    })

    it('anahtar tamamen silinirse (newValue yok) liste bosalir ve bos-durum acilir', async () => {
        const { app, dinleyiciler } = setup({ dapps: { 'uniswap.org': { ...KAYIT } } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        for (const fn of dinleyiciler) fn({ dapps: { oldValue: { 'uniswap.org': KAYIT } } }, 'local')
        await bosalt()

        expect(holder.instance.setupState.dapps_list).toEqual([])
        expect(holder.instance.setupState.hicBaglantiYok).toBe(true)
    })

    it('dapps DISINDAKI anahtarin degisimi listeyi DEGISTIRMEZ', async () => {
        const { app, dinleyiciler } = setup({ dapps: { 'uniswap.org': { ...KAYIT } } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        for (const fn of dinleyiciler) fn({ language: { newValue: 'tr', oldValue: 'en' } }, 'local')
        await bosalt()

        expect(holder.instance.setupState.dapps_list).toEqual(['uniswap.org'])
    })
})

// Kaynak kilitleri: kablolamanin YAZILDIGINI kilitler.
describe('Dapps.vue -- kaynak kilitleri (T13)', () => {
    it('bilesende ham chrome.storage dapps yazimi YOK (set({ dapps / set({dapps)', () => {
        expect(DAPPS_VUE).not.toMatch(/set\(\s*\{\s*dapps/)
    })

    it('updateDapps ve createUiSync dogru modullerden ithal edilir, elle dinleyici YOK', () => {
        expect(DAPPS_VUE).toMatch(/import\s*\{\s*updateDapps\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/dappsStore['"]/)
        expect(DAPPS_VUE).toMatch(/import\s*\{\s*createUiSync\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/uiSync['"]/)
        expect(DAPPS_VUE).not.toMatch(/storage\.onChanged\.addListener/)
    })

    it('dappsSync.start() onMounted icinde, dappsSync.stop() onUnmounted icinde', () => {
        expect(DAPPS_VUE).toMatch(/onUnmounted\(\(\) => \{ dappsSync\.stop\(\) \}\)/)
        const mounted = DAPPS_VUE.indexOf('onMounted(async')
        const baslat = DAPPS_VUE.indexOf('dappsSync.start()')
        const okuma = DAPPS_VUE.indexOf("chrome.storage.local.get(['dapps', 'ton_dapps', 'solana_dapps'])")
        expect(mounted).toBeGreaterThan(-1)
        expect(baslat).toBeGreaterThan(mounted)
        // Ilk okumadan ONCE baslar: arada gelen degisiklik kacmasin.
        expect(okuma).toBeGreaterThan(baslat)
    })
})
