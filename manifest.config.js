import { defineManifest } from '@crxjs/vite-plugin'
import { loadEnv } from 'vite'
import pkg from './package.json'

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
const modeIndex = process.argv.indexOf('--mode')
const mode = modeIndex !== -1
  ? process.argv[modeIndex + 1]
  : (process.argv.includes('build') ? 'production' : 'development')
// loadEnv onekli process.env degerlerini de gorur; testler bayragi oradan verir.
const SOLANA_ENABLED = loadEnv(mode, process.cwd(), 'VITE_').VITE_SOLANA_ENABLED === 'true'

export default defineManifest({
  manifest_version: 3,
  name: '__MSG_extName__',
  short_name: '__MSG_extShortName__',
  description: '__MSG_extDescription__',
  default_locale: 'en',
  
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