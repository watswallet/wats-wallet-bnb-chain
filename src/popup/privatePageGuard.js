// Gizli ekranlar (aktarma, gonderme, takas, kopru, islemler) yalniz gizli modda anlamlidir ve Gizli Hesap adresini ya da
// etkinligini gosterir. Mod BASKA bir panelden (uiSync) kapanirsa bu panel o ekranda kalmasin: eve doner
// ve gizli ekranin biraktigi tek seferlik not (ordersNotice) da silinir; yoksa ekrana hic varilmadan mod
// donerse eski bir "transferi dogrulayamadik" notu sonraki Gizli islemler ziyaretinde yeniden belirirdi (T25 U:M-2).
// Cagiran App.vue: `watch(() => privacy.active, (on) => leavePrivatePagesWhenOff(on, page))`. Kasitli olarak
// immediate/sync DEGIL: yalniz mod DEGISIMINDE calisir.
// Gizli islemler ayri sayfa degil, ana ekran sekmesi: Home mod kapaliyken onu Varliklar'a dusurur.
import { stockEntryForRef } from '../utils/stocks/stockRoute'

// private_swap / private_bridge (kendine Takas/Kopru, SilentSwap) App.vue'da YALNIZ PRIVATE_SWAP_BRIDGE bayragiyla baglanir ve
// privacy.active kosulu TASIMAZ (private_fund / private_send ile ayni desen): mod kapaninca o ekranda kalan panelin TEK korumasi
// bu liste. Liste bayraga bagli DEGIL (bayrak kapaliyken ekran zaten baglanmaz). Token'dan gelen tek seferlik
// pageStore().privateSwapSource burada SILINMEZ: ekran onu acilista kendisi tuketir ve gecerliligini dogrular.
export const PRIVATE_PAGES = ['private_fund', 'private_send', 'private_swap', 'private_bridge']

export function leavePrivatePagesWhenOff(on, page) {
    if (on) return
    page.ordersNotice = null
    if (PRIVATE_PAGES.includes(page.currentPage)) page.currentPage = 'home'
}

// xStocks Al / Sat ekranlari gizli modda KAPALI (sahip karari 2026-10-16; CoW emri Gizli adresi CoW'a IP ile gosterir):
// App.vue ekrani gizli modda hic baglamaz. Gizli mod BASKA bir panelden (uiSync) ACILIRSA bu panel o ekranda bos
// kalmasin: eve doner. leavePrivatePagesWhenOff'un tersi; yalniz mod ACILIRKEN calisir. Cagiran App.vue:
// `watch(() => privacy.active, (on) => leaveStockPagesWhenOn(on, page, crypto))` (AYRI satir, immediate/sync DEGIL).
// Hisse DETAYI (Dilim 0c G5, E-R12a) ayri sayfa degil: 'token' sayfasi + hisse ref. StockDetail acikken mod BASKA bir
// panelden acilirsa o ekranda kalinmaz: eve doner (hissesiz ref'te siradan Token ekrani yerinde kalir). `crypto`
// verilmezse (eski cagri) yalniz STOCK_PAGES korunur.
export const STOCK_PAGES = ['stock_trade']

export function leaveStockPagesWhenOn(on, page, crypto) {
    if (!on) return
    if (STOCK_PAGES.includes(page.currentPage)) {
        page.currentPage = 'home'
        return
    }
    if (page.currentPage === 'token' && crypto && stockEntryForRef(crypto.selected_token_ref, { privateMode: false })) {
        page.currentPage = 'home'
    }
}

// Hesap ekranlari (Hesaplari yonet ve ondan acilan her sey) gizli modda ERISILEMEZ: giris dugmeleri (Header cekmecesi,
// Ayarlar) cizilmez. Normal hesaplari gosterirler ve "Hesap olustur" yeni hesabi aktif yapip gizli modu sessizce kapatir.
// Gizli mod BASKA bir panelden (uiSync) ACILIRSA bu panel o ekranlarda kalmasin: eve doner. Sir ekranlari cikista kendi
// sirrini temizler (App.vue SIR_ZINCIRI izleyicisi). Cagiran App.vue:
// `watch(() => privacy.active, (on) => leaveAccountPagesWhenOn(on, page))` (AYRI satir, immediate/sync DEGIL).
export const ACCOUNT_PAGES = [
    'settings_manage_accounts',
    'settings_add_wallet',
    'settings_create_account',
    'settings_edit_account',
    'settings_edit_account_name',
    'settings_show_phrases',
    'settings_phrase_disclaimer',
    'settings_phrases',
    'settings_show_private_key',
    'settings_private_key_disclaimer',
    'settings_private_key',
    'settings_show_ton_key',
    'settings_ton_key_disclaimer',
    'settings_ton_key',
]

export function leaveAccountPagesWhenOn(on, page) {
    if (on && ACCOUNT_PAGES.includes(page.currentPage)) page.currentPage = 'home'
}

// Klasik Takas ('swap') ve Kopru ('bridge') sayfalari gizli modda KAPALI (VITE_PRIVATE_SWAP_BRIDGE'nin degerinden bagimsiz): App.vue Kopru'yu
// hic baglamaz, Takas'i yalniz "yalniz ATS satin alma" kipinde (swapShown) baglar. Gizli mod BASKA bir panelden (uiSync) ACILIRSA bu panel o
// sayfada bos kalmasin: eve doner. Takas, satin alma kipi aciksa (swapShown === true) yerinde kalir (Swap.vue kipi kendisi degistirir).
// leavePrivatePagesWhenOff'un tersi, leaveStockPagesWhenOn ile ayni desen; yalniz mod ACILIRKEN calisir. HER ZAMAN eve doner: hicbir klasik
// ekrana ve private_swap / private_bridge'e yonlendirmez. Cagiran App.vue:
// `watch(() => privacy.active, (on) => leaveSwapBridgePagesWhenOn(on, page, swapShown.value))` (AYRI satir, immediate/sync DEGIL).
export const SWAP_BRIDGE_PAGES = ['swap', 'bridge']

export function leaveSwapBridgePagesWhenOn(on, page, swapShown) {
    if (!on) return
    if (!SWAP_BRIDGE_PAGES.includes(page.currentPage)) return
    if (page.currentPage === 'swap' && swapShown === true) return
    page.currentPage = 'home'
}
