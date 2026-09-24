import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blokGovdesi } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

const main = read('popup/main.js')
const ready = read('components/onboarding/Ready.vue')

// KOPRUNUN KENDI GOVDESI. Suslu parantez ESLESTIRILEREK kesilir (satir
// sonundan bagimsiz) ve yorumlari BOSLUKLA degistirilmis kaynaktan gelir.
//
// KOD INCELEMESI (yorum/import/kapsam turu): asagidaki iddialar eskiden
// main.js'in TAMAMINDA dizge ariyordu. 'openSidePanelHere' dosyada DORT kez
// geciyor (3. satir import, 42. ve 51. satirlar YORUM, 57. satir gercek cagri)
// ve 'UI_MODE_PANEL' IKI kez (4. satir import, 56. satir karsilastirma).
// Olculdu: gercek cagri `return false` ile degistirildiginde ve 56. satirdaki
// karsilastirma tamamen silindiginde iddialarin IKISI DE YESIL kaliyordu.
const kopruGovdesi = () => blokGovdesi(main, /async function kopruDene\(\)\s*/)

describe('popup koprusu', () => {
    it('popup girisi mod panel ise paneli acar', () => {
        const govde = kopruGovdesi()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/\bopenSidePanelHere\s*\(/)
        expect(govde).toContain('UI_MODE_PANEL')
    })

    // KOD INCELEMESI (final inceleme, M17): onceki hali
    // `indexOf('openSidePanelHere')` ile `indexOf('window.close()')`i
    // karsilastiriyordu. O ILK eslesme dosyanin 3. satirindaki IMPORT'tur --
    // yani iddia yalnizca "import, kapatma cagrisindan once gelir" diyordu ve
    // kapatmanin HANGI KOSULDA yapildigi hakkinda HICBIR SEY olcmuyordu.
    //
    // Gercek kural: kapatma YALNIZCA panel gercekten acildiysa (`acildi`)
    // yapilir; aksi halde arayuz kurulur, cunku kapatmak kullaniciyi hicbir
    // yuzey olmadan birakirdi. Iddia artik `.then` geri cagrisinin KENDI
    // govdesine bakar. Davranisin kendisi popupBridgeBehavior.test.js'te
    // GERCEKTEN calistirilarak olculuyor.
    it('kapatma `acildi` dogruyken yapilir, kosulsuz DEGIL', () => {
        const govde = blokGovdesi(main, /kopruDene\(\)\.then\(\(acildi\)\s*=>\s*/)
        expect(govde).not.toBeNull()

        expect(govde).toMatch(/if \(acildi\) \{\s*\r?\n\s*window\.close\(\)/)

        // Acilmadiysa arayuz KURULUR -- yani `bootstrapWalletUi` KOSULLU dalin
        // DISINDA olmali.
        //
        // KOD INCELEMESI: onceki hal yalnizca `govde.toContain('bootstrapWalletUi(')`
        // idi ve dizgenin geri cagrinin HERHANGI bir yerinde olmasi yetiyordu.
        // Olculdu: cagri `if (acildi) { window.close(); ... }` blogunun ICINE
        // tasindiginda -- yani panel ACILAMADIGINDA arayuz HIC kurulmadiginda,
        // tam da bu testin engellemek icin var oldugu durum -- iddia YESIL
        // kaliyordu. Artik kosullu blok ayrica kesilip ICINDE OLMADIGI da
        // dogrulanir.
        const acildiBlok = blokGovdesi(govde, /if \(acildi\)\s*/)
        expect(acildiBlok).not.toBeNull()
        expect(acildiBlok).not.toContain('bootstrapWalletUi(')
        expect(govde).toContain('bootstrapWalletUi(')
    })

    // Onay penceresi ('#window') ASLA kopruye girmez: dapp onayi ayri pencerede
    // kalir (S7.1) ve orayi panele cevirmek bekleyen istegi askida birakirdi.
    //
    // KOD INCELEMESI (kapsam turu): onceki hal dosya GENELINDE ariyordu.
    // Olculdu: kapi `kopruDene`den alinip hicbir zaman cagrilmayan bir
    // `olu()` fonksiyonuna tasindiginda -- yani kopru onay penceresini ARTIK
    // KORUMUYORKEN -- iddia YESIL kaliyordu. Artik kopru govdesinde aranir.
    it('onay penceresi kopruye girmez', () => {
        const govde = kopruGovdesi()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/if \(pencereModu\) return false/)
    })

    // BUTCE DUZELTMESI (review bulgusu): mod okumasi (readUiMode) ve pencere
    // aramasi (chrome.windows.getCurrent) ikisi de GERCEK birer chrome IPC
    // gidis-donusudur. Sirali beklenirse open()'a kadar IKI round-trip gecer ve
    // kullanici hareketi butcesi (bkz. utils/openPanel.js) tukenebilir. Pencere
    // aramasi bu yuzden mod okumasindan ONCE baslamali (paralel), SONRA degil.
    //
    // KOD INCELEMESI: onceki hal SADECE sira karsilastirmasiydi ve sira,
    // "promise BASLATILDI" ile "promise BEKLENDI" arasindaki farki GORMEZ.
    // Olculdu: `chrome.windows.getCurrent()` cagrisinin basina `await`
    // eklendiginde -- yani akis TAMAMEN SIRALI hale gelip open()'a kadar IKI
    // IPC gidis-donusu harcadiginda, tam olarak yukaridaki yorumun anlattigi
    // butce hatasi -- iddia YESIL kaliyordu. `await`in YOKLUGU artik acikca
    // sart kosuluyor; sira karsilastirmasi (goreli, bayt mesafesi DEGIL)
    // yaninda duruyor.
    it('pencere aramasi mod okumasindan ONCE baslar (paralel)', () => {
        const govde = kopruGovdesi()
        expect(govde).not.toBeNull()

        expect(govde).toMatch(/chrome\.windows\.getCurrent\(\)/)
        expect(govde).not.toMatch(/await\s+chrome\.windows\.getCurrent\s*\(/)

        const baslaAt = govde.indexOf('chrome.windows.getCurrent()')
        const modAt = govde.indexOf('await readUiMode()')
        expect(baslaAt).toBeGreaterThan(-1)
        expect(modAt).toBeGreaterThan(-1)
        expect(baslaAt).toBeLessThan(modAt)
    })

    // openSidePanelHere KENDI windows.getCurrent cagrisini YENIDEN yapmamali --
    // zaten baslamis olan pencere sonucunu devralmali. Aksi halde yukaridaki
    // paralellik faydasiz kalir.
    it('openSidePanelHere onceden baslatilmis pencere sonucunu devralir', () => {
        expect(main).toMatch(/openSidePanelHere\(pencereBeklemesi\)/)
    })
})

describe('onboarding sonu -- moda gore dallanir', () => {
    // TIKLAMA ISLEYICISININ KENDI GOVDESI. Ready.vue'de bu bolumun BUTUN
    // iddialari dosya genelinde arıyordu ve YORUMLARLA saglaniyordu:
    // 'openSidePanelHere' DORT kez geciyor (61 import, 66 ve 91 YORUM, 95
    // cagri), 'chrome.action.openPopup' DORT kez (67, 76, 85 YORUM; 100 cagri)
    // ve 'window.close()' IKI kez (76 YORUM, 106 cagri).
    const startGovdesi = () => blokGovdesi(
        ready,
        /(?:const start\s*=\s*async\s*\(\)\s*=>|async\s+function\s+start\s*\([^)]*\))\s*/,
    )

    // KOD INCELEMESI: olculdu -- `acildi = await openSidePanelHere()` satiri
    // TAMAMEN silindiginde eski iddia (import + iki yorum) YESIL kaliyordu.
    it('paneli acmayi dener', () => {
        const govde = startGovdesi()
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/\bopenSidePanelHere\s*\(/)
    })

    // ESKI SIRA YANLISTI: once window.close() sonra chrome.action.openPopup().
    // Sayfa kapanmaya basladiktan sonra ikinci satirin calisacagi GARANTI DEGIL,
    // ve panel varsayilaninda openPopup zaten hata verir -- kullanici kurulumu
    // bitirdiginde ekranda HICBIR cuzdan yuzeyi acilmazdi.
    //
    // KOD INCELEMESI (M17'nin Ready.vue'de KALAN ikizi): onceki hal dosya
    // genelinde `indexOf('openSidePanelHere')` ile `indexOf('window.close()')`i
    // karsilastiriyordu. Ilki 61. satirdaki IMPORT'u, ikincisi 76. satirdaki
    // YORUM'u buluyordu -- yani iddia "import, bir yorumdan once gelir"
    // diyordu. Olculdu: `window.close()` start()'in ILK satirina geri
    // tasindiginda (testin adindaki tam gerileme) iddia YESIL kaliyordu.
    // Artik hem sira hem de "EN SON ifade" start() GOVDESINDE dogrulanir.
    it('kapatma EN SONA alindi', () => {
        const govde = startGovdesi()
        expect(govde).not.toBeNull()

        const acAt = govde.indexOf('openSidePanelHere(')
        const kapatAt = govde.indexOf('window.close()')
        expect(acAt).toBeGreaterThan(-1)
        expect(kapatAt).toBeGreaterThan(acAt)

        const kodSatirlari = govde.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        expect(kodSatirlari[kodSatirlari.length - 1]).toBe('window.close()')
    })

    // KOD INCELEMESI: olculdu -- `await chrome.action.openPopup()` silindiginde
    // (popup'a dusme yolu YOK) eski iddia UC YORUM sayesinde YESIL kaliyordu.
    // Cagri artik `if (!acildi)` dalinin ICINDE aranir: "panel ACILAMAZSA"
    // sartinin kendisi de boylece kilitlenir.
    it('panel acilamazsa popup a duser', () => {
        const govde = startGovdesi()
        expect(govde).not.toBeNull()
        const dusmeDali = blokGovdesi(govde, /if \(!acildi\)\s*/)
        expect(dusmeDali).not.toBeNull()
        expect(dusmeDali).toMatch(/chrome\.action\.openPopup\s*\(/)
    })

    // BUTCE DUZELTMESI (review bulgusu): readUiMode -> chrome.storage.local.get
    // GERCEK bir chrome IPC gidis-donusudur. Tiklama isleyicisinin (start())
    // ICINDE beklenirse, hareket-gerektiren cagrilar (openSidePanelHere VE
    // chrome.action.openPopup) bu bekleme kadar erir. Mod bu yuzden mount
    // aninda okunup saklanmali, tiklamada degil.
    //
    // KOD INCELEMESI: "onMounted( dizgesinden SONRA geliyor" ile "onMounted'in
    // ICINDE" ayni sey DEGIL. Olculdu: hook `onMounted(() => {})` diye
    // bosaltilip `await readUiMode()` start()'in icine tasindiginda `readAt`
    // hala `mountAt`tan buyuk kaliyor ve iddia YESIL geciyordu -- okuma artik
    // onMounted'da HIC olmadigi halde. Artik hook'un GOVDESINDE aranir.
    it('mod mount aninda okunur (onMounted icinde readUiMode)', () => {
        const mountGovdesi = blokGovdesi(ready, /onMounted\(async\s*\(\)\s*=>\s*/)
        expect(mountGovdesi).not.toBeNull()
        expect(mountGovdesi).toMatch(/await readUiMode\(\)/)
    })

    // KOD INCELEMESI (iki ayri kusur): `ready.slice(ready.indexOf('const start ='))`
    // (a) DOSYA SONUNA kadar kesiyordu -- 8793 karakterlik dosyanin 3695'i,
    // getParticleStyle() ve butun <style> blogu dahil -- ve (b) cipa
    // bulunamazsa `indexOf` -1 donup `slice(-1)` TEK KARAKTER birakiyordu,
    // yani negatif iddia SESSIZCE hicbir sey olcmuyordu. Olculdu: bildirim
    // `async function start() {`e cevrilip readUiMode start'in ICINE
    // konuldugunda test YESIL kaliyordu. Govde artik parantez eslestirmeyle
    // kesilir ve BULUNAMADIGI acikca kirmizidir.
    it('start() ICINDE artik readUiMode beklenmez', () => {
        const govde = startGovdesi()
        expect(govde).not.toBeNull()
        expect(govde).not.toContain('readUiMode()')
    })
})
