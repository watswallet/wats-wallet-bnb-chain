import { vi } from 'vitest'

// background.js'i TUM haliyle (vi.resetModules + import) ayaga kaldiran test dosyalari icin DOSYA BASINA zaman asimi.
//
// Kok neden (T28): bu dosyalar her testte ethers + @solana/web3.js + @solana/spl-token zincirini yeniden cozer;
// makine yukluyken (baska oturumlar ayni makineyi paylasir) tek test 15 sn'lik varsayilani asiyor ve ardindan
// bir sonraki test yarim kalmis modul durumundan ('listener is not a function', current_request undefined)
// sahte hatalar veriyordu. Cozum bu dosyalara ozel gevsek sinir; client/vitest.config.js DEGISMEZ, boylece
// hafif testler eski siki sinirla kosar.
//
// KULLANIM: dosyanin importlarindan SONRA, ilk describe/it/beforeEach'ten ONCE bir kez cagrilir (vitest sinirlari
// testler TOPLANIRKEN okur; sonradan cagirmak o ana kadar kaydedilenleri degistirmez).
export const HEAVY_BACKGROUND_TEST_TIMEOUT_MS = 30000
export const HEAVY_BACKGROUND_HOOK_TIMEOUT_MS = 60000

export function heavyBackgroundTimeouts() {
    vi.setConfig({
        testTimeout: HEAVY_BACKGROUND_TEST_TIMEOUT_MS,
        hookTimeout: HEAVY_BACKGROUND_HOOK_TIMEOUT_MS,
    })
}
