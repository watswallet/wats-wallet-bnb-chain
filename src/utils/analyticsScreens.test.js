import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SCREEN_KEYS } from './analyticsPing.js'
import { screenKeyForPage, IGNORED_PAGES, SCREEN_PAGE_MAP } from './analyticsScreens.js'

const APP_VUE = fileURLToPath(new URL('../popup/App.vue', import.meta.url))

const SIR_ZINCIRI_SPEC = [
    'settings_show_phrases', 'settings_phrase_disclaimer', 'settings_phrases',
    'settings_show_private_key', 'settings_private_key_disclaimer', 'settings_private_key',
    'settings_show_ton_key', 'settings_ton_key_disclaimer', 'settings_ton_key',
    'settings_security_select_phrases', 'settings_security_unlock_vault',
    'settings_security_phrases_disclaimer', 'settings_security_show_phrase',
]
const DAPP_ONAY = [
    'dapp_connect', 'switch_chain', 'dapp_router', 'sign_message', 'sign_typed_data',
    'ton_connect', 'ton_send_tx', 'ton_sign_data', 'solana_connect', 'solana_sign_tx',
    'solana_sign_message', 'ton_alert', 'connect_dapp',
]

// Yorumlari soyar: yorum satirina alinmis sayfa degerleri sayfa sayilmaz (P11).
function appVueKaynagi() {
    return readFileSync(APP_VUE, 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
}

function dizi(src, ad) {
    const blok = src.match(new RegExp('const ' + ad + ' = \\[([\\s\\S]*?)\\]'))
    expect(blok, ad + ' bulunamadi').toBeTruthy()
    return [...blok[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

describe('analyticsScreens', () => {
    it('her SCREEN_PAGE_MAP degeri SCREEN_KEYS icinde', () => {
        for (const v of Object.values(SCREEN_PAGE_MAP)) expect(SCREEN_KEYS).toContain(v)
    })

    it('tablo esleme', () => {
        const beklenen = {
            send: 'send', swap: 'swap', bridge: 'bridge', stock_trade: 'stockTrade',
            search_tokens: 'addToken', import_token: 'addToken', buy_token: 'buyToken',
            settings: 'settings',
            settings_edit_profile: 'settingsProfile', settings_edit_username: 'settingsProfile',
            settings_manage_accounts: 'settingsAccounts', settings_add_wallet: 'settingsAccounts',
            settings_create_account: 'settingsAccounts', settings_edit_account: 'settingsAccounts',
            settings_edit_account_name: 'settingsAccounts',
            settings_preferences: 'settingsPreferences',
            settings_saved_addresses: 'settingsAddresses', settings_add_address: 'settingsAddresses',
            settings_edit_address: 'settingsAddresses',
            settings_dapps: 'settingsDapps', settings_dapp_permissions: 'settingsDapps',
            settings_security: 'settingsSecurity', settings_security_change_password: 'settingsSecurity',
            settings_security_lock_timer: 'settingsSecurity', settings_security_reset_app: 'settingsSecurity',
            settings_about: 'settingsAbout', forgot_password: 'forgotPassword',
        }
        for (const [sayfa, anahtar] of Object.entries(beklenen)) expect(screenKeyForPage(sayfa)).toBe(anahtar)
        expect(Object.keys(SCREEN_PAGE_MAP).sort()).toEqual(Object.keys(beklenen).sort())
    })

    it('token + isStockPage -> stockDetail; token -> token', () => {
        expect(screenKeyForPage('token', { isStockPage: true })).toBe('stockDetail')
        expect(screenKeyForPage('token', { isStockPage: false })).toBe('token')
        expect(screenKeyForPage('token')).toBe('token')
    })

    it('yoksayilanlar null (home, welcome, "", select_asset, confirm_transaction, select_network, onboarding_pending, privacy_blocked)', () => {
        for (const p of ['home', 'welcome', '', 'select_asset', 'confirm_transaction', 'select_network', 'onboarding_pending', 'privacy_blocked']) {
            expect(screenKeyForPage(p)).toBeNull()
        }
    })

    it('gizli sir zinciri 13 deger null, other DEGIL', () => {
        expect(SIR_ZINCIRI_SPEC).toHaveLength(13)
        for (const p of SIR_ZINCIRI_SPEC) {
            expect(screenKeyForPage(p)).toBeNull()
            expect(IGNORED_PAGES.has(p)).toBe(true)
        }
    })

    it('dapp onay ekranlari null', () => {
        for (const p of DAPP_ONAY) expect(screenKeyForPage(p)).toBeNull()
    })

    it('private_* null, other DEGIL', () => {
        for (const p of ['private_fund', 'private_send', 'private_swap', 'private_bridge']) {
            expect(screenKeyForPage(p)).toBeNull()
        }
    })

    it('bilinmeyen -> other', () => {
        expect(screenKeyForPage('yeni_ekran_x')).toBe('other')
    })

    it("KAYNAK KILIDI: popup/App.vue icindeki her page.currentPage === '<deger>' degeri SCREEN_PAGE_MAP ya da IGNORED_PAGES icinde", () => {
        const src = appVueKaynagi()
        const degerler = new Set()
        for (const m of src.matchAll(/page\.currentPage === '([a-z_]+)'/g)) degerler.add(m[1])
        for (const ad of ['DAPP_APPROVAL_PAGES', 'SIR_ZINCIRI']) {
            for (const d of dizi(src, ad)) degerler.add(d)
        }
        // Tarama bosa dusmesin (regex bozulursa test sessizce gecmesin).
        expect(degerler.size).toBeGreaterThan(40)
        const kapsanmayan = [...degerler].filter((d) => !(d in SCREEN_PAGE_MAP) && d !== 'token' && !IGNORED_PAGES.has(d))
        expect(kapsanmayan).toEqual([])
    })

    it('SIR_ZINCIRI ve DAPP_APPROVAL_PAGES dizilerinin hepsi IGNORED_PAGES icinde', () => {
        const src = appVueKaynagi()
        for (const ad of ['DAPP_APPROVAL_PAGES', 'SIR_ZINCIRI']) {
            for (const d of dizi(src, ad)) expect(IGNORED_PAGES.has(d)).toBe(true)
        }
    })

    it('SCREEN_KEYS \\ {atsBuy, homeStocks, homeActivity, stockDetail, other} = SCREEN_PAGE_MAP degerleri kumesi (token fonksiyonda turetilir)', () => {
        const turetilen = new Set(['atsBuy', 'homeStocks', 'homeActivity', 'stockDetail', 'other', 'token'])
        const beklenen = SCREEN_KEYS.filter((k) => !turetilen.has(k)).sort()
        const harita = [...new Set(Object.values(SCREEN_PAGE_MAP))].sort()
        expect(harita).toEqual(beklenen)
    })
})
