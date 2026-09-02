import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

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
    'tabs' 
  ],

  host_permissions: [
    "<all_urls>"
  ],

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
    {
      matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
      js: ["src/solanaInjected.js"],
      run_at: "document_start",
      all_frames: false,
      world: "MAIN"
    }
  ],
  
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'; connect-src 'self' https: http: ws: wss:;",
    sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'; default-src 'none'; connect-src *;"
  }
})