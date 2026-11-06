import { defineManifest } from '@crxjs/vite-plugin'
import { loadEnv } from 'vite'
import pkg from './package.json'
import { parseDeliveryChains, checkDeliveryLists, DELIVERY_CHAIN_IDS, BSC_DELIVERY_CHAIN_ID } from './src/utils/privacy/deliveryChains.js'
import { hasPrivateSendSource } from './src/utils/privacy/privateBridgedSources.js'

// SOLANA_ENABLED -- NODE tarafi kopyasi.
//
// Bu dosya vite CONFIG'i yuklenirken calisir: `import.meta.env` burada YOKTUR
// ve src/utils/featureFlags.js import EDILEMEZ (o modul import.meta.env okur).
// Bu yuzden ayni .env dosyalari loadEnv ile elle okunur -- iki okuma, TEK kaynak
// (.env.production / .env.development / .env.local).
//
// crxjs 2.3.0'in defineManifest'i yalnizca DUZ NESNE alir (fonksiyon/`env`
// geri cagrimi yok), bu yuzden mod argv'den cozulur:
//   vite build                  -> production
//   vite build --mode development -> development
//   vite (dev sunucusu)          -> development
// vite'in kabul ettigi uc yazim da okunur: `--mode x`, `--mode=x`, `-m x`.
function modeFromArgv(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mode' || arg === '-m') return argv[i + 1]
    if (arg.startsWith('--mode=')) return arg.slice('--mode='.length)
  }
  return argv.includes('build') ? 'production' : 'development'
}
const mode = modeFromArgv(process.argv)
// loadEnv onekli process.env degerlerini de gorur; testler bayragi oradan verir.
const ENV = loadEnv(mode, process.cwd(), 'VITE_')

// SilentSwap integratorId KAPISI (mekanik). SDK ayni bicimi dayatir ama sarmalayici
// (silentswapConfig.integratorIdFrom) bozuk degeri sessizce atar; yazim hatasi "dolu"
// gorunup entegrator payini kaybettirir. Bu yuzden yapilandirma yuklenirken durdurulur:
//   - bos olmayan id bicime uymuyorsa HER modda,
//   - Gizli mod acik URETIM derlemesinde id bossa.
const INTEGRATOR_ID = ENV.VITE_SILENTSWAP_INTEGRATOR_ID || ''
if (INTEGRATOR_ID && !/^int_[a-z0-9]{24}$/.test(INTEGRATOR_ID)) {
  throw new Error('VITE_SILENTSWAP_INTEGRATOR_ID gecersiz: "int_" + 24 kucuk harf/rakam olmali')
}
if (mode === 'production' && ENV.VITE_PRIVACY_ENABLED === 'true' && !INTEGRATOR_ID) {
  throw new Error('VITE_SILENTSWAP_INTEGRATOR_ID bos: Gizli mod acik uretim derlemesi entegrator kimligi olmadan yapilamaz')
}

// GIZLI MOD TESLIM AG LISTELERI KAPISI (gizli-mod cok-ag spec 4.2 kural 4; integratorId kapisi gibi mekanik, HER modda).
// Yapilandirma yuklenirken: (1) iki listede gecersiz oge (kanonik olmayan, tabloda olmayan ya da bos oge) derlemeyi durdurur;
// (2) degismezler (Para yukle Gonder'in altkumesi; BSC disi Para yukle 56'yi ister; Para yuklede her agin en az bir Gonder kaynagi
// vardir) bozuksa durdurur;
// (3) Gizli mod acik URETIM derlemesinde Para yukle listesi 56'yi icermelidir: Gizli Hesap'a para yuklenemeyen surum cikmaz.
// TESLIM DEGISMEZI (1.10): Gizli Hesap'a teslim edilen varligin ana cikis yolu Gonder'dir (Takas/Kopru acik olsa da kural korunur),
// bu yuzden Gonder kaynagi olmayan bir ag Para yukle listesine giremez. Gonder kaynagi bilgisi privateBridgedSources.js'ten
// (SDK'siz, saf; privateAssetsFor ile esitligi privateFundDelivery.test.js'te kilitli) gelir. Eski "BSC disi Para yukle icin ATS satisi
// acik olmali" sarti KALDIRILDI.
// Saf tablo deliveryChains.js'tedir (import.meta.env okumaz, bu dosya Node'da calisir); ortami okuyan deliveryChainSetting.js
// BURADAN import EDILEMEZ.
const SEND_CHAINS = parseDeliveryChains(ENV.VITE_PRIVATE_SEND_CHAINS)
const FUND_CHAINS = parseDeliveryChains(ENV.VITE_PRIVATE_FUND_CHAINS)
for (const [name, list] of [['VITE_PRIVATE_SEND_CHAINS', SEND_CHAINS], ['VITE_PRIVATE_FUND_CHAINS', FUND_CHAINS]]) {
  if (list.invalid.length) {
    throw new Error(`${name} gecersiz oge: ${JSON.stringify(list.invalid)}. Ogeler virgulle ayrilmis ve tablodaki zincir kimlikleri olmali (${DELIVERY_CHAIN_IDS.join(',')})`)
  }
}
const SEND_SOURCE_CHAINS = DELIVERY_CHAIN_IDS.filter(hasPrivateSendSource)
const DELIVERY_VIOLATIONS = checkDeliveryLists(SEND_CHAINS.ids, FUND_CHAINS.ids, SEND_SOURCE_CHAINS)
if (DELIVERY_VIOLATIONS.length) {
  throw new Error(`VITE_PRIVATE_SEND_CHAINS / VITE_PRIVATE_FUND_CHAINS degismezleri bozuk: ${DELIVERY_VIOLATIONS.join(', ')}`)
}
if (mode === 'production' && ENV.VITE_PRIVACY_ENABLED === 'true' && !FUND_CHAINS.ids.includes(BSC_DELIVERY_CHAIN_ID)) {
  throw new Error(`VITE_PRIVATE_FUND_CHAINS ${BSC_DELIVERY_CHAIN_ID} icermeli: Gizli mod acik uretim derlemesi Gizli Hesap'a para yuklenemeden cikarilamaz`)
}
const SOLANA_ENABLED = ENV.VITE_SOLANA_ENABLED === 'true'
// GIZLI MOD (Plan 2): SilentSwap integratorId'yi BIREBIR chrome-extension://<id>
// origin'ine baglar. Paketlenmemis gelistirme kopyasinin kimligi klasor yoluna gore
// degisir; magaza kaydinin GENEL anahtari yalniz GELISTIRME derlemesine yazilirsa iki
// kopya ayni kimligi tasir ve tek origin kaydi yeter. Uretim paketine `key` YAZILMAZ.
const DEV_KEY = mode === 'development' ? (ENV.VITE_EXTENSION_PUBLIC_KEY || '') : ''

export default defineManifest({
  manifest_version: 3,
  name: '__MSG_extName__',
  short_name: '__MSG_extShortName__',
  description: '__MSG_extDescription__',
  default_locale: 'en',
  ...(DEV_KEY ? { key: DEV_KEY } : {}),
  
  version: pkg.version,
  minimum_chrome_version: '115',

  icons: {
    16: 'icons/logo-16.png',
    32: 'icons/logo-32.png',
    48: 'icons/logo-48.png',
    64: 'icons/logo-64.png',
    128: 'icons/logo-128.png',
    256: 'icons/logo-256.png',
    512: 'icons/logo-512.png',
  },
  
  action: {
    default_icon: {
      16: 'icons/logo-16.png',
      32: 'icons/logo-32.png',
      48: 'icons/logo-48.png',
      64: 'icons/logo-64.png',
      128: 'icons/logo-128.png',
      256: 'icons/logo-256.png',
      512: 'icons/logo-512.png',
    },
    default_title: '__MSG_extName__',
    default_popup: 'src/popup/index.html'
  },

  background: {
    service_worker: 'src/background.js',
    type: 'module'
  },

  permissions: [
    'storage',
    'alarms',
    'tabs',
    // Yan panel. Bu izin kullaniciya GORUNUR bir izin uyarisi uretmez --
    // 'notifications' uretir ve guncellemede uzantiyi kullanici onaylayana
    // kadar devre disi birakirdi (bir cuzdanda kabul edilemez).
    'sidePanel'
  ],

  host_permissions: [
    "<all_urls>"
  ],

  // Yan panel sayfasi. GLOBAL panel: tek bir default_path, pencere basina ayri
  // bir belge. Yol '#'/'?' TASIMAZ -- crxjs bu yolu kirpar ve panel kendi
  // pencere kimligini chrome.windows.getCurrent() ile ogrenir.
  //
  // vite.config.js'e input EKLENMEZ: crxjs 2.3.0 side_panel.default_path'i
  // kendisi giris noktasi yapiyor (htmlFiles -> emitFile). Elle eklemek ayni
  // sayfayi iki kez giris yapardi.
  side_panel: {
    default_path: 'src/sidepanel/index.html'
  },

  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.js"],
      run_at: "document_start",
      all_frames: true
    },
    // Saglayici (window.ethereum) sayfa dunyasina BURADAN girer. Eski yontem
    // content.js'in <script src> eklemesiydi: src'li betik asenkron yuklenir,
    // saglayici sayfanin kendi betiklerinden SONRA olusabiliyor ve dapp'in ilk
    // yoklamasi "cuzdan yok" diyordu. world: MAIN kaydini tarayici sayfanin
    // hicbir betigi calismadan once yurutur (Chrome 111+; minimum burada 115).
    {
      matches: ["<all_urls>"],
      js: ["src/injected.js"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN"
    },
    // TonConnect koprusu. injected.js ile AYNI kosullar: MAIN dunya,
    // document_start, tum cerceveler. Ayri dosya, cunku iki protokolun ortak
    // hicbir kodu yok ve tek dosyada birlestirmek ikisini de okunmaz yapardi.
    {
      matches: ["<all_urls>"],
      js: ["src/tonInjected.js"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN"
    },
    // Solana Wallet Standard koprusu. Digerlerinden AYRILAN IKI NOKTA:
    //
    // 1) KAPSAM DAR: yalnizca https ve localhost. Solana oturumlari TAM ORIGIN ile
    //    anahtarlanir; `http://` bir sayfaya enjekte etmek, ayni host'un https
    //    oturumuyla karistirilabilecek bir yetki yuzeyi acmak olurdu.
    // 2) all_frames: FALSE. Yetki kaynagi tam origin oldugu icin iframe reddi
    //    burada, enjeksiyon seviyesinde uygulanir: kullanicinin adres cubugunda
    //    gordugu site ile onay veren site HER ZAMAN ayni olur.
    //
    // BU KAPSAM TEK BASINA YETMEZ (nihai inceleme C1.3): content.js (asagida,
    // ayri bir kayit) <all_urls> uzerinde all_frames:true ile calisir ve HER
    // cerceve/semadan gelen mesaji oldugu gibi arka plana iletir -- yani
    // yukaridaki `matches`/`all_frames` kisitlamasi YALNIZCA sayfa betiginin
    // enjekte edildigi yeri belirler, dagitici katmanini KORUMAZ. Ayni kapi
    // (tam bu `matches` deseni + top-frame) bu yuzden alti Solana handler'inda
    // (utils/solanaDappFunctions.js -- solanaSayfaKapisi) TEKRAR, fail-closed
    // olarak uygulanir.
    //
    // KAYIT SOLANA_ENABLED'A BAGLI ve bu kapinin EN DIS halkasi: betik enjekte
    // edilmezse `window.solana` ve Wallet Standard kaydi HIC olusmaz, yani bir
    // dapp cuzdani goremez bile. Arka plandaki aksiyon kapisi (background.js)
    // bunun ALTINDAKI katmandir -- ikisi birlikte, ayri ayri degil.
    ...(SOLANA_ENABLED ? [{
      matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
      js: ["src/solanaInjected.js"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN"
    }] : []),
  ],
  
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'; connect-src 'self' https: http: ws: wss:;",
    sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'; default-src 'none'; connect-src *;"
  }
})