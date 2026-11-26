import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { navDirection, NAV_STACK_MAX, LOCK_PAGES } from './navDirection.js'
import { yorumsuz } from '../../test-utils/kaynakTarama.js'

const AP = ['dapp_router', 'privacy_blocked']
const rows = [
    ['0 ayni sayfa', { prev: 'welcome', next: 'welcome', stack: ['home'] }, 'none', ['home'], false],
    ['acilis', { prev: '', next: 'home', stack: [] }, 'none', ['home'], false],
    ['1 Token>Gonder>Geri', { prev: 'send', next: 'select_asset', stack: ['home', 'token', 'send'], intent: 'back' }, 'back', ['home', 'token', 'select_asset'], false],
    ['1 Hesaplari yonet>Geri', { prev: 'settings_manage_accounts', next: 'settings', stack: ['home', 'settings_manage_accounts'], intent: 'back' }, 'back', ['home', 'settings'], false],
    ['2 giris>home', { prev: 'welcome', next: 'home', stack: [] }, 'none', ['home'], true],
    ['3 kilit', { prev: 'home', next: 'welcome', stack: ['home'] }, 'none', [], true],
    ['3 giris>dApp', { prev: 'welcome', next: 'dapp_connect', stack: [] }, 'none', ['dapp_connect'], true],
    ['4 canli istek', { prev: 'home', next: 'dapp_router', stack: ['home'], approvalPages: AP }, 'none', ['dapp_router'], false],
    ['4 gizli mod engeli', { prev: 'home', next: 'privacy_blocked', stack: ['home'], approvalPages: AP }, 'none', ['privacy_blocked'], false],
    ['5 gizli mod', { prev: 'token', next: 'home', stack: ['home', 'token'], privacyChanged: true }, 'none', ['home'], true],
    ['5 VT sinifi', { prev: 'token', next: 'home', stack: ['home', 'token'], privacyTransition: true }, 'none', ['home'], true],
    ['6 akis korumasi', { prev: 'swap', next: 'home', stack: ['home', 'swap'], intent: 'neutral' }, 'none', ['home'], false],
    ['7 ayni sayfa', { prev: 'token', next: 'token', stack: ['home', 'token'], intent: 'back' }, 'none', ['home', 'token'], false],
    ['10 closeOrNavigate', { prev: 'token', next: 'settings', stack: ['home', 'token'], intent: 'back' }, 'back', ['home', 'settings'], false],
    ['10 kilit hedefi', { prev: 'token', next: 'welcome', stack: ['home', 'token'], intent: 'back' }, 'none', [], true],
    ['home her zaman geri', { prev: 'b', next: 'home', stack: ['home', 'a', 'b'] }, 'back', ['home'], false],
    ['bilinmeyen', { prev: 'home', next: 'xyz', stack: ['home'] }, 'fwd', ['home', 'xyz'], false],
    ['yigindaki sayfaya donus', { prev: 'c', next: 'a', stack: ['home', 'a', 'b', 'c'] }, 'back', ['home', 'a'], false],
]

describe('navDirection', () => {
    it.each(rows)('%s', (_ad, girdi, dir, stack, reset) => {
        const r = navDirection(girdi)
        expect(r.dir).toBe(dir)
        expect(r.stack).toEqual(stack)
        expect(r.reset).toBe(reset)
    })

    it('ayni sayfa: yeni dizi doner', () => {
        const s = ['home']
        expect(navDirection({ prev: 'welcome', next: 'welcome', stack: s }).stack).not.toBe(s)
    })

    it('9 tavan: uzunluk 20 ve basta home', () => {
        let stack = ['home']
        let prev = 'home'
        for (let i = 0; i < 25; i++) {
            const next = 'p' + i
            const r = navDirection({ prev, next, stack })
            expect(r.dir).toBe('fwd')
            stack = r.stack
            prev = next
        }
        expect(stack.length).toBe(NAV_STACK_MAX)
        expect(stack[0]).toBe('home')
        expect(stack.at(-1)).toBe('p24')
    })

    it('girdi yigini degismez', () => {
        const s = ['home', 'a']
        const kopya = [...s]
        navDirection({ prev: 'a', next: 'b', stack: s })
        navDirection({ prev: 'a', next: 'home', stack: s })
        navDirection({ prev: 'a', next: 'x', stack: s, intent: 'back' })
        navDirection({ prev: 'a', next: 'x', stack: s, intent: 'neutral' })
        expect(s).toEqual(kopya)
    })

    it('LOCK_PAGES dondurulmus', () => {
        expect(Object.isFrozen(LOCK_PAGES)).toBe(true)
        expect(LOCK_PAGES).toEqual(['welcome', 'forgot_password', 'onboarding_pending'])
    })

    it('kaynak: store/chrome/vue yok', () => {
        const k = yorumsuz(readFileSync(new URL('./navDirection.js', import.meta.url), 'utf8'))
        expect(k).not.toMatch(/from\s+['"][^'"]*(store|chrome|vue)/)
        expect(k).not.toContain('chrome.')
    })
})
