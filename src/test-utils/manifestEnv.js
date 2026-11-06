import { afterAll } from 'vitest'

// manifest.config.js NODE tarafinda calisir ve loadEnv ile gercek .env dosyalarini okur; loadEnv onekli
// process.env degerlerini dosyalarin USTUNE koyar (bos dizge de ustune biner). Kisisel bir .env.*.local'deki
// yazim hatasi (bicimi bozuk integratorId) ya da .env.production'da acilmis bir Gizli mod bayragi manifest
// testlerini kirmamali: bu uc degisken HER ZAMAN acikca verilir. Uc manifest testi (manifestInjection,
// manifestSidePanel, manifestDevKey) bu tek yardimciyi kullanir (T23 M7).
export const MANIFEST_ENV_KEYS = [
    'VITE_EXTENSION_PUBLIC_KEY',
    'VITE_SILENTSWAP_INTEGRATOR_ID',
    'VITE_PRIVACY_ENABLED',
    // Teslim ag listeleri (gizli-mod cok-ag spec 4.2, derleme kapisi): kisisel bir .env.*.local'deki bozuk liste de testi kirmasin.
    'VITE_PRIVATE_SEND_CHAINS',
    'VITE_PRIVATE_FUND_CHAINS',
    // ATS satin alma bayragi (degismez (c), spec 4.2 kural 4): derleme kapisi BSC disi Para yukle icin bunu okur.
    'VITE_PRIVATE_ATS_SALE',
    // Gizli modda Takas/Kopru bayragi (1.10): uretim derlemesi 'true' ile durur, testler hep acikca 'false' verir.
    'VITE_PRIVATE_SWAP_BRIDGE',
]

// Onceki degerleri alir ve geri yukleyen fonksiyonu dondurur (tanimsizdi ise siler).
export function snapshotManifestEnv() {
    const eski = Object.fromEntries(MANIFEST_ENV_KEYS.map((k) => [k, process.env[k]]))
    return () => {
        for (const [k, v] of Object.entries(eski)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
}

// Alti degiskeni de acikca kurar: varsayilan anahtar yok, integratorId bos, Gizli mod kapali, iki teslim ag listesi GECERLI
// `56`/`56` (derleme kapisi bos Para yukle listesini yalniz Gizli mod acik uretim derlemesinde reddeder; mevcut
// integratorId testleri o yolu kullanir ve yeni kapiya takilmamali) ve ATS satin alma bayragi KAPALI ('false'): tanimsiz
// birakmak loadEnv'i modun .env dosyasina dusururdu (gelistirmede 'true', uretimde 'false'), yani sonuc moda bagli olurdu.
export function setManifestEnv({ key = '', integratorId = '', privacy = 'false', send = '56', fund = '56', atsSale = 'false', swapBridge = 'false' } = {}) {
    for (const name of MANIFEST_ENV_KEYS) delete process.env[name]
    process.env.VITE_EXTENSION_PUBLIC_KEY = key
    process.env.VITE_SILENTSWAP_INTEGRATOR_ID = integratorId
    process.env.VITE_PRIVACY_ENABLED = privacy
    process.env.VITE_PRIVATE_SEND_CHAINS = send
    process.env.VITE_PRIVATE_FUND_CHAINS = fund
    process.env.VITE_PRIVATE_ATS_SALE = atsSale
    process.env.VITE_PRIVATE_SWAP_BRIDGE = swapBridge
}

// Test dosyasi manifest.config.js'i STATIK import ediyorsa: yan etkili import (manifestEnvHermetic.js)
// o import'tan ONCE yazilir ve bu fonksiyon modul degerlendirilirken ortami kurar, dosya bitince geri yukler.
export function stubManifestEnvForFile() {
    const restore = snapshotManifestEnv()
    setManifestEnv()
    afterAll(restore)
}
