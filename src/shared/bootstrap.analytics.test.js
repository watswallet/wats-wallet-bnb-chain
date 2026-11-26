// Task 13 -- `open` sayimi: sayfa yuklemesi basina TEK, yalniz popup/panel yuzeyi.
// bootstrapWalletUi GERCEKTEN calisir; vue/pinia/App/store sahte, sayim istegi izlenir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.hoisted(() => {
    globalThis.document = {
        querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: { classList: { add: () => {}, remove: () => {}, contains: () => false } },
    }
})

const mocks = vi.hoisted(() => ({ count: vi.fn(), privacyActive: false }))

vi.mock('vue', async (importOriginal) => ({
    ...(await importOriginal()),
    createApp: () => ({ use() { return this }, mount: () => {} }),
}))
vi.mock('../popup/App.vue', () => ({ default: {} }))
vi.mock('../store/currency', () => ({ currencyStore: () => ({ init: async () => {} }) }))
vi.mock('../store/privacy', () => ({ privacyStore: () => ({ active: mocks.privacyActive }) }))
vi.mock('../utils/uiSync', () => ({ installUiSync: () => () => {} }))
vi.mock('../utils/popupPort', () => ({ connectPopupPort: () => {} }))
vi.mock('../utils/analyticsCountRequest', () => ({ requestAnalyticsCount: mocks.count }))

import { SURFACE_ALERT, SURFACE_PANEL, SURFACE_POPUP, SURFACE_WINDOW } from '../utils/uiSurface'

let bootstrapWalletUi

beforeEach(async () => {
    // Modul duzeyi bekci her testte taze baslasin: yeniden import
    vi.resetModules()
    mocks.count.mockReset()
    mocks.privacyActive = false
    globalThis.chrome = {
        runtime: { onMessage: { addListener: () => {} } },
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
    ;({ bootstrapWalletUi } = await import('./bootstrap'))
})
afterEach(() => { delete globalThis.chrome })

const src = (p) => readFileSync(resolve(__dirname, p), 'utf8')

describe('open sayimi', () => {
    it('popup yuzeyi: tek open', () => {
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        expect(mocks.count).toHaveBeenCalledTimes(1)
        expect(mocks.count).toHaveBeenCalledWith('open')
    })
    it('panel yuzeyi: tek open', () => {
        bootstrapWalletUi({ surface: SURFACE_PANEL })
        expect(mocks.count).toHaveBeenCalledTimes(1)
        expect(mocks.count).toHaveBeenCalledWith('open')
    })
    it('window yuzeyi (#window): open yok', () => {
        bootstrapWalletUi({ surface: SURFACE_WINDOW })
        expect(mocks.count).not.toHaveBeenCalled()
    })
    it('alert yuzeyi: open yok', () => {
        bootstrapWalletUi({ surface: SURFACE_ALERT })
        expect(mocks.count).not.toHaveBeenCalled()
    })
    it('ayni yuklemede ikinci bootstrapWalletUi cagrisi ikinci open saymaz', () => {
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        bootstrapWalletUi({ surface: SURFACE_PANEL })
        expect(mocks.count).toHaveBeenCalledTimes(1)
    })
    it('window cagrisi bekciyi tuketmez: sonraki popup yine sayilir', () => {
        bootstrapWalletUi({ surface: SURFACE_WINDOW })
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        expect(mocks.count).toHaveBeenCalledTimes(1)
    })
    it('gizli mod aktifken mesaj yollanmaz', () => {
        mocks.privacyActive = true
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        expect(mocks.count).not.toHaveBeenCalled()
    })
})

describe('sayilmayan yollar (kaynak taramasi)', () => {
    it('popupPort.js sayim cagrisi icermez', () => {
        expect(src('../utils/popupPort.js')).not.toMatch(/requestAnalyticsCount|ANALYTICS_COUNT/)
    })
    it("onboarding/main.js requestAnalyticsCount('open') icermez", () => {
        expect(src('../onboarding/main.js')).not.toMatch(/requestAnalyticsCount\(\s*['"]open['"]/)
    })
    it('popup/main.js: kopruDene panelde window.close() ile cikar ve bootstrapWalletUi cagirmaz (popup+panel cift sayim yok)', () => {
        const s = src('../popup/main.js')
        const i = s.indexOf('kopruDene().then((acildi) => {')
        expect(i).toBeGreaterThan(-1)
        const blok = s.slice(i)
        const ret = blok.indexOf('if (acildi) {')
        const close = blok.indexOf('window.close()', ret)
        const boot = blok.indexOf('bootstrapWalletUi(', ret)
        expect(close).toBeGreaterThan(ret)
        expect(blok.slice(close, boot)).toMatch(/return/)
        expect(boot).toBeGreaterThan(close)
    })
    it('ATS satin alma penceresi (?ats-purchase=1#window) SURFACE_WINDOW: open yok', () => {
        // #window hash'i SURFACE_WINDOW'dur; open yalniz popup/panel icin sayilir.
        const s = src('./bootstrap.js')
        expect(s).toMatch(/surface === SURFACE_POPUP \|\| surface === SURFACE_PANEL/)
    })
})
