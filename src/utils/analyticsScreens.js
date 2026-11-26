// Ekran girisi sayimi icin currentPage -> ekran anahtari eslemesi (saf modul).
//
// NEDEN ayri modul: App.vue'ya yeni bir sayfa eklenince siniflandirilmasi
// UNUTULMASIN diye kaynak taramasi testi bu iki tabloyu App.vue ile esler.
// Siniflar: SAYILIR (SCREEN_PAGE_MAP), YOKSAYILIR (IGNORED_PAGES, other'e DE
// dusmez), other (listede olmayan her yeni deger).

export const SCREEN_PAGE_MAP = {
    send: 'send',
    swap: 'swap',
    bridge: 'bridge',
    stock_trade: 'stockTrade',
    search_tokens: 'addToken',
    import_token: 'addToken',
    buy_token: 'buyToken',
    settings: 'settings',
    settings_edit_profile: 'settingsProfile',
    settings_edit_username: 'settingsProfile',
    settings_manage_accounts: 'settingsAccounts',
    settings_add_wallet: 'settingsAccounts',
    settings_create_account: 'settingsAccounts',
    settings_edit_account: 'settingsAccounts',
    settings_edit_account_name: 'settingsAccounts',
    settings_preferences: 'settingsPreferences',
    settings_saved_addresses: 'settingsAddresses',
    settings_add_address: 'settingsAddresses',
    settings_edit_address: 'settingsAddresses',
    settings_dapps: 'settingsDapps',
    settings_dapp_permissions: 'settingsDapps',
    settings_security: 'settingsSecurity',
    settings_security_change_password: 'settingsSecurity',
    settings_security_lock_timer: 'settingsSecurity',
    settings_security_reset_app: 'settingsSecurity',
    settings_about: 'settingsAbout',
    forgot_password: 'forgotPassword',
}

// Hic sayilmaz. Gizli sir zinciri ve private_* hassas davranis (toplanmaz),
// dapp onay ekranlarina kullanici kendi girmedi; home/welcome acilis ve kilit
// acma ile (open/unlock) olculur.
export const IGNORED_PAGES = new Set([
    '', 'welcome', 'onboarding_pending', 'home', 'select_asset', 'confirm_transaction',
    'select_network', 'privacy_blocked',
    // Gizli sir zinciri
    'settings_show_phrases', 'settings_phrase_disclaimer', 'settings_phrases',
    'settings_show_private_key', 'settings_private_key_disclaimer', 'settings_private_key',
    'settings_show_ton_key', 'settings_ton_key_disclaimer', 'settings_ton_key',
    'settings_security_select_phrases', 'settings_security_unlock_vault',
    'settings_security_phrases_disclaimer', 'settings_security_show_phrase',
    // Dapp onay ekranlari
    'dapp_connect', 'switch_chain', 'dapp_router', 'sign_message', 'sign_typed_data',
    'ton_connect', 'ton_send_tx', 'ton_sign_data',
    'solana_connect', 'solana_sign_tx', 'solana_sign_message', 'ton_alert', 'connect_dapp',
    // Gizli hesap akislari
    'private_fund', 'private_send', 'private_swap', 'private_bridge',
])

// homeStocks/homeActivity buradan DONMEZ: Home sekme isleyicisi dogrudan sayar.
export function screenKeyForPage(page, { isStockPage = false } = {}) {
    if (page === 'token') return isStockPage ? 'stockDetail' : 'token'
    if (IGNORED_PAGES.has(page)) return null
    return SCREEN_PAGE_MAP[page] ?? 'other'
}

// App.vue izleyicisinin mantigi (saf; chrome/vue importu YOK, bagimliliklar disaridan gelir).
// NEDEN burada: Vue tarafi ince sarmal kalsin, kapilar (yuzey, gizli mod) test edilebilsin.
// Yuzey yalniz popup/panel: dapp onay penceresi (#window) ve #alert sayilmaz. Gizli modda
// hicbir sey yollanmaz. isStockPage ayni giris icin TEK degerlendirilir: hisse ise yalniz
// stockDetail, degilse yalniz token sayilir (ayni giris iki kez ASLA sayilmaz).
// getSurface/privacyActive/isStockPage fonksiyon ya da dogrudan deger olabilir.
const SAYILAN_YUZEYLER = new Set(['popup', 'panel'])
const val = (v) => (typeof v === 'function' ? v() : v)

export function screenCounterHandler({ getSurface, privacyActive, isStockPage, send }) {
    return function onPageChange(yeni) {
        if (!SAYILAN_YUZEYLER.has(val(getSurface))) return
        if (val(privacyActive) === true) return
        const key = screenKeyForPage(yeni, { isStockPage: val(isStockPage) === true })
        if (key === null) return
        send(key)
    }
}
