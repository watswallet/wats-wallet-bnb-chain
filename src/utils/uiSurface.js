/**
 * Cuzdan arayuzunun UC yuzeyi.
 *
 *  popup   -- arac cubugu ikonundan acilan klasik acilir pencere
 *  window  -- dapp onay ekrani (chrome.windows.create, '#window' hash'i)
 *  panel   -- Chrome yan paneli
 *
 * Ayrimin TEK sahibi bu modul. Bugune kadar tek bir dal vardi (main.js'teki
 * hash kontrolu) ve "kapanabilir bir yuzeydeyim" varsayimi 10 ayri yerde
 * ortuk olarak yapiliyordu -- panelde hepsi sessizce bozulur.
 */
export const SURFACE_POPUP = 'popup'
export const SURFACE_WINDOW = 'window'
export const SURFACE_PANEL = 'panel'

const PANEL_PATH_PARCASI = '/sidepanel/'

/**
 * @param {{pathname?: string, hash?: string}|null} loc
 */
export function detectSurface(loc) {
    if (!loc) return SURFACE_POPUP

    // Yol ONCE: panel bir SAYFADIR, hash'i ne olursa olsun panel kalir.
    if (typeof loc.pathname === 'string' && loc.pathname.includes(PANEL_PATH_PARCASI)) {
        return SURFACE_PANEL
    }
    if (loc.hash === '#window') return SURFACE_WINDOW
    return SURFACE_POPUP
}

// Yuzey sayfa omru boyunca DEGISMEZ: bir kez hesapla.
let onbellek = null

export function getSurface() {
    if (onbellek === null) {
        onbellek = detectSurface(typeof window === 'undefined' ? null : window.location)
    }
    return onbellek
}

export function isPanel() {
    return getSurface() === SURFACE_PANEL
}

/**
 * "Bu ekrandan cik" -- yuzeye gore.
 *
 * Depoda 10 ayri yerde ham `window.close()` vardi. Panelde bu cagri ya hicbir
 * sey yapmaz (kullanici kilitlenmis cuzdanin ESKI ekraninda asili kalir) ya da
 * TUM paneli kapatir. Ikisi de cagri yerinin niyeti degil; niyet "su ekrana
 * don"du. Bu yuzden her cagri yeri artik ACIK bir hedef verir.
 *
 * ISTISNA: panelin KENDISINI kapatmak (mod degisimi, S4.5) bu fonksiyondan
 * gecmez -- orada gercekten `window.close()` istenir.
 *
 * @param {string|null} targetPage panel modunda gidilecek sayfa
 * @param {{page: object, surface?: string, closeFn?: () => void}} opts
 */
export function closeOrNavigate(targetPage, { page, surface, closeFn } = {}) {
    const yuzey = surface ?? getSurface()

    if (yuzey === SURFACE_PANEL) {
        if (targetPage && page) page.currentPage = targetPage
        return
    }

    const kapat = closeFn ?? (typeof window === 'undefined' ? null : () => window.close())
    kapat?.()
}
