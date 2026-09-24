import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { tonConnectDeviceInfo } from './src/utils/ton/tonConnectDevice.js'

// vue(): .vue dosyalarinin DOGRUDAN import edilebilmesi icin (bkz.
// src/test-utils/ssrRender.js). Onceden burada Vue derleyicisi YOKTU: mevcut
// *Wiring.test.js dosyalari .vue'yu METIN olarak okuyup kaynak-tarama
// yapiyordu, bilesen hic CALISTIRILMIYORDU -- render/gorunum zamanindaki
// hatalar (getIcon(selectedTx.category) cokmesi gibi) yesil bir suite'ten
// SESSIZCE SIZIYORDU. Bu eklenti SADECE .vue dosyalarini etkiler; mevcut saf
// JS testlerinin hicbiri .vue import ETMEDIGI icin bu degisiklik onlara
// DOKUNMAZ.
export default defineConfig({
  plugins: [vue()],
  // vite.config.js ile AYNI deger, AYNI kaynaktan. tonInjected.js sayfa
  // dunyasinda calisan bir icerik betigi ve import ETMEMEK zorunda (gerekce
  // vite.config.js'te, olcumuyle birlikte) -- cihaz betimini derleme zamaninda
  // buradan aliyor. Test kosusu kendi derlemesini yaptigi icin ayni tanim
  // burada da olmali, yoksa modul testte `__TON_DEVICE_INFO__ is not defined`
  // ile coker. Ikisinin AYNI fonksiyondan okudugu ayrica kilitli
  // (tonInjectedTekParca.test.js).
  define: {
    __TON_DEVICE_INFO__: JSON.stringify(tonConnectDeviceInfo()),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
    // Varsayilan 10 sn, background.js'i her testte yeniden import eden
    // harness'lar icin yetmiyor: vi.resetModules() + ethers + @solana/web3.js +
    // @solana/spl-token zincirinin yeniden cozulmesi soguk veya yuklu bir
    // makinede saniyeler suruyor. O import izolasyonun KENDISIDIR (modul
    // kapsamindaki durum -- withStorageList kuyrugu, chrome dinleyicileri --
    // testler arasinda sizmasin diye), yani kirpilacak bir israf degil.
    //
    // Sinir TEK YERDEN veriliyor, hook basina argumanla DEGIL: hook basina
    // yazildiginda beforeEach'e konup beforeAll'un unutulmasi (ve o hook'un
    // sessizce 10 sn'de kalmasi) tam olarak yasanan seydi. Buradaki deger her
    // hook'u kapsar ve yeni bir hook eklendiginde de gecerlidir.
    // Solana ozellik bayragi TESTLERDE ACIK. Yayin derlemesinde KAPALI
    // (.env.production / .env.development -> VITE_SOLANA_ENABLED=false), ama
    // Solana kodu ve ~700 testi depoda DURUYOR: kapali diye test edilmemesi,
    // bayrak yeniden acildiginda dogrulanmamis bir ozellik yayina cikmasi
    // demekti. Kapali-durum davranisini olcen testler bayragi kendi icinde
    // vi.stubEnv ile 'false'a cevirir (bkz. utils/featureFlags.test.js).
    env: {
      VITE_SOLANA_ENABLED: 'true',
    },
    // @ton-keychain/core YALNIZCA TESTTE kullanilir (devDependency): uretim
    // kodu MAM kuralini kendi yazar, kutuphane ona karsi fark testinde kosar --
    // gerekce tonMamMnemonic.js'in bas yorumunda (GPL-3.0 + MV3).
    //
    // O paketin ESM derlemesi (dist/index.mjs) @ton/crypto'nun ic mnemonic
    // modulune UZANTISIZ import ile bakiyor (`@ton/crypto/dist/mnemonic/mnemonic`).
    // @ton/crypto disariya `exports` haritasi SUNMUYOR (yalnizca `main`), yani
    // bu paket "external" birakilip dogrudan Node'un ESM yukleyicisine gidince
    // (varsayilan davranis) Node siki kurallarla REDDEDIYOR: "Cannot find module
    // ... Did you mean to import '...mnemonic.js'?". CJS derlemesi (dist/index.js)
    // ayni yolu require() ile cagirir ve Node'un CJS cozumleyicisi uzanti
    // EKLEYEREK cozer -- o yuzden `inline` ile bu paketi Vite'in kendi (daha
    // hosgorulu) cozumleyicisinden GECIRMEK sorunu ortadan kaldirir. Yalnizca
    // test kosusunu etkiler; paket zaten uretim derlemesine hic girmiyor.
    server: {
      deps: {
        inline: ['@ton-keychain/core'],
      },
    },
    // Es zamanli is parcacigi sayisi ELLE sinirlanir. Vitest varsayilani
    // CPU-1'dir (bu makinede 11) ve takim o ayarla `JavaScript heap out of
    // memory` ile COKUYORDU -- test hatasi degil, surecin kendisi oluyordu.
    //
    // Sebep hiz degil BELLEK: screenSetupPageWrite.ssr.test.js sinif kilidi icin
    // App.vue'daki 54 ekranin TAMAMINI tek bir is parcaciginda import ediyor
    // (her biri ethers / @solana/web3.js zincirini de getiriyor). O agir isci,
    // background.js'i yeniden import eden diger agir iscilerle AYNI ANDA
    // kosunca toplam talep makinenin bos bellegini asiyor.
    //
    // Olculdu: 11 is parcacigi -> cokuyor; 4 -> 5386 test geciyor ve sure
    // DEGISMIYOR (66.2 sn -> 65.5 sn). Takim transform/collect agirlikli oldugu
    // icin daha fazla paralellik zaten zaman kazandirmiyordu; yalnizca bellek
    // tepe noktasini yukseltiyordu.
    // BELLEK NOTU -- es zamanlilik BILEREK sinirlanmadi.
    //
    // Tam takim varsayilan ayarla (CPU-1 surec) yaklasik 3-4 GB BOS bellek
    // ister. screenSetupPageWrite.ssr.test.js sinif kilidi icin App.vue'daki 54
    // ekranin tamamini import eder ve her biri ethers / @solana/web3.js
    // zincirini de getirir; background.js'i yeniden import eden diger agir
    // dosyalarla ayni anda kosunca tepe talep yuksektir.
    //
    // Makinede o kadar bos bellek YOKKEN kosu bir test hatasiyla degil,
    // surecin kendisiyle coker: `FATAL ERROR: ... JavaScript heap out of
    // memory` ve tinypool/ChildProcess yigin izi. Bu bir sizinti DEGILDIR --
    // olculdu: 7.7 GB bos iken 11 surecle 5386 test 62 sn'de gecti; ayni takim
    // 1 GB bos iken cokuyordu, tek surecle ise (270 sn) yine geciyordu.
    //
    // Bu yuzden burada kalici bir sinir YOK: her makinede kosuyu iki katina
    // cikarmak, gecici bir bellek darligina odenen cok pahali bir bedel olurdu.
    // Bellek darken `npm run test:az-bellek` kullanilir (2 surec, ~140 sn).
    hookTimeout: 30000,
    // hookTimeout gibi TEK YERDEN: soguk vite donusumu (ethers + @solana/web3.js
    // + @solana/spl-token zincirinin ILK testte cozulmesi) ve BIP39 turetme
    // testleri (evmFromTon) varsayilan 5000 ms sinirinin UZERINDE olcumleniyor
    // (5012-5032 ms) -- olcumsel bir hedef, mantik hatasi degil.
    testTimeout: 15000,
  },
})
