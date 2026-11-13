// Dapp simgesi: favicon YOKSA harf avatari yedegi gorunmeli.
//
// KOK NEDEN (olculdu): chrome sender.tab.favIconUrl'i favicon yoksa, 404 ya da
// erisilemezse HIC vermez (undefined). `:src="undefined"` Vue'da src ozniteligini
// KALDIRIR; src'siz <img> icin tarayici `error` olayi ATESLEMEZ, dolayisiyla
// `@error="...src = initialsUri(...)"` yedegi hic calismaz ve kirik resim + alt
// metin gorunur. Yedek src'in KENDISINDE (`favicon || initialsUri(...)`) olmali.
//
// 'vue' mock'u BURADA olmak zorunda (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

vi.hoisted(() => {
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { initialsUri } from '../../utils/localAvatar'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import ConnectDapp from './ConnectDapp.vue'
import DappPermissions from '../settings/DappPermissions.vue'
import Dapps from '../settings/Dapps.vue'

const HOST = 'uniswap.org'
const EVM_ADRES = '0xAaaa000000000000000000000000000000000001'
const FAV = 'https://uniswap.org/f.png'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})
afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

// Verilen src'li <img> etiketlerinin src degerlerini dondurur (alt metne gore).
const srcOf = (html, altFragment) => {
    const tags = html.match(/<img\b[^>]*>/g) || []
    const tag = tags.find((t) => t.includes(altFragment))
    expect(tag, `${altFragment} alt metinli <img> bulunamadi`).toBeTruthy()
    const m = tag.match(/\ssrc="([^"]*)"/)
    return m ? m[1].replace(/&amp;/g, '&') : null
}

async function renderConnect(favicon) {
    installChromeStub({
        current_request: { type: 'CONNECT', id: 'r1', origin: `https://${HOST}`, ...(favicon === undefined ? {} : { favicon }) },
        active_account: { key: 'a', type: 'hd', name: 'Hesap A', address: EVM_ADRES },
        currentNetwork: { chainId: 1, name: 'Ethereum' },
    })
    const app = createApp(ConnectDapp)
    app.use(createTestPinia()); app.use(createTestI18n())
    pageStore().currentPage = 'connect_dapp'
    return render(app)
}

describe('ConnectDapp.vue -- dapp simgesi yedegi', () => {
    it('favicon YOKSA src harf avatari olur (src yok = yedek hic calismaz)', async () => {
        const html = await renderConnect(undefined)
        const src = srcOf(html, 'DApp Logo')
        expect(src).toBe(initialsUri(HOST))
    })
    it('favicon bos dizgeyse de harf avatari', async () => {
        const html = await renderConnect('')
        expect(srcOf(html, 'DApp Logo')).toBe(initialsUri(HOST))
    })
    it('calisan favicon AYNEN gorunur', async () => {
        const html = await renderConnect(FAV)
        expect(srcOf(html, 'DApp Logo')).toBe(FAV)
    })
})

describe('DappPermissions.vue -- dapp simgesi yedegi', () => {
    async function r(favicon) {
        installChromeStub({
            vaults: [{ fingerprint: 'f', type: 'hd', accounts: [{ key: 'a', type: 'hd', name: 'A', address: EVM_ADRES }] }],
            dapps: { [HOST]: { accounts: [EVM_ADRES], allowedChains: [1], chainId: '0x1', ...(favicon === undefined ? {} : { favicon }) } },
        })
        const app = createApp(DappPermissions, { props: { dapp: HOST } })
        app.use(createTestPinia()); app.use(createTestI18n())
        return render(app)
    }
    it('favicon YOKSA harf avatari', async () => {
        expect(srcOf(await r(undefined), 'dapp icon')).toBe(initialsUri(HOST))
    })
    it('calisan favicon AYNEN gorunur', async () => {
        expect(srcOf(await r(FAV), 'dapp icon')).toBe(FAV)
    })
})

describe('Dapps.vue -- dapp simgesi yedegi', () => {
    async function r(favicon) {
        installChromeStub({
            dapps: { [HOST]: { accounts: [EVM_ADRES], allowedChains: [1], chainId: '0x1', ...(favicon === undefined ? {} : { favicon }) } },
        })
        const app = createApp(Dapps)
        app.use(createTestPinia()); app.use(createTestI18n())
        return render(app)
    }
    it('favicon YOKSA harf avatari', async () => {
        expect(srcOf(await r(undefined), 'dapp icon')).toBe(initialsUri(HOST))
    })
    it('calisan favicon AYNEN gorunur', async () => {
        expect(srcOf(await r(FAV), 'dapp icon')).toBe(FAV)
    })
})
