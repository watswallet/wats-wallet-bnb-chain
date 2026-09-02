import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

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
    hookTimeout: 30000,
  },
})
