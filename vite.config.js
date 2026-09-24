import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import zip from 'vite-plugin-zip-pack'
import manifest from './manifest.config.js'
import { name, version } from './package.json'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { tonConnectDeviceInfo } from './src/utils/ton/tonConnectDevice.js'

export default defineConfig({
  define: {
    global: 'globalThis',
    // TON CIHAZ BILGISI DERLEME ZAMANINDA GOMULUR -- tek kaynak yine
    // utils/ton/tonConnectDevice.js, bu config onu import edip yaziyor.
    //
    // SEBEP BIR OPTIMIZASYON DEGIL, BIR HATA SINIFI: crxjs bir icerik betiginde
    // TEK bir `import` satiri gorurse onu DOGRUDAN degil bir YUKLEYICI ile
    // kaydediyor ve yukleyici `await import(...)` ile uzantidan ayri dosyalar
    // cekiyor. Bu da TON koprusunu (a) GEC yapiyor -- olculdu: sayfa acildiktan
    // ~82 ms sonra -- ve (b) o dosyalarin indirilmesi engellenirse (korumali
    // iframe, kati CSP) koprü HIC kurulmuyor. EVM saglayicisi ayni sayfada
    // sorunsuz calisirken, cunku injected.js hic import etmedigi icin TEK PARCA
    // ve senkron cikiyor.
    //
    // OLCULDU (build ciktisindaki manifest, 2026-09-13):
    //   tonInjected.js importlu  -> "assets/tonInjected.js-loader-*.js"
    //   tonInjected.js importsuz -> "assets/tonInjected.js-*.js"  (injected.js gibi)
    //
    // Degeri ELLE YAZMAK yasak: tonConnectDevice.js'in bas yorumundaki
    // olum-sonrasi inceleme, bu betimin UC KOPYASININ ikisinin sessizce
    // `features: []` ile kalmasini ve HER islemin sessizce reddedilmesini
    // anlatiyor. Burasi kopya acmaz, tek kaynagi OKUR.
    __TON_DEVICE_INFO__: JSON.stringify(tonConnectDeviceInfo()),
  },
  resolve: {
    alias: {
      '@': `${path.resolve(__dirname, 'src')}`,
      buffer: 'buffer/',
    },
  },
  build: {
    rollupOptions: {
      input: {
        onboarding: 'onboarding.html'
      }
    }
  },
  plugins: [
    // @ton/core global `Buffer`i VARSAYAR: hicbir yerde import etmez, 41 yerde
    // dogrudan kullanir ve BitString.EMPTY = new BitString(Buffer.alloc(0),0,0)
    // gibi MODUL YUKLENIRKEN calisan satirlari var. Tarayicida ve MV3 service
    // worker inda global Buffer YOKTUR, o yuzden popup acilirken chunk
    // "ReferenceError: Buffer is not defined" ile patlar ve cuzdan hic acilmaz.
    //
    // Bunu bir giris dosyasinda globalThis.Buffer = Buffer diyerek COZEMEYIZ:
    // ESM de import edilen chunk lar giris kodundan ONCE calisir, yani atama her
    // zaman gec kalir. Bu eklenti bunun yerine her modulun icindeki ciplak
    // Buffer i yerel bir import a cevirir; sira sorunu diye bir sey kalmaz.
    //
    // Yalnizca Buffer aciktir. global zaten yukaridaki define ile, process ise
    // hic gerekmedigi icin kapalidir - MV3 te paket boyutu ve saldiri yuzeyi
    // bosuna buyumesin.
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true, global: false, process: false },
      protocolImports: false,
    }),
    vue(),
    crx({ manifest }),
    zip({ outDir: 'release', outFileName: `${name}-${version}.zip` }),
    tailwindcss()
  ],
  server: {
    cors: {
      origin: [
        /chrome-extension:\/\//,
      ],
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  }
})