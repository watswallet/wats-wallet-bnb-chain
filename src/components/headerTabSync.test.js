import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { yorumsuz, blokGovdesi } from '../test-utils/kaynakTarama'

const here = dirname(fileURLToPath(import.meta.url))
const header = readFileSync(join(here, 'Header.vue'), 'utf8')

describe('Header -- sekme degisimine tepki', () => {
    it('tabs.onActivated ve onUpdated dinleniyor', () => {
        expect(header).toContain('chrome.tabs.onActivated.addListener')
        expect(header).toContain('chrome.tabs.onUpdated.addListener')
    })

    // Dinleyici REFERANSI saklanmali: addListener'a verilen ok fonksiyonu bir
    // degiskene alinmazsa removeListener SESSIZCE hicbir sey yapmaz.
    //
    // KOD INCELEMESI (CRLF/kapsam turu): onceki hal `indexOf('onUnmounted(')`
    // ile DOSYA SONUNA KADAR dilim aliyordu -- 78693 karakterlik dosyanin
    // 9978'i, yani hook'un govdesi ARTI ondan sonraki BUTUN `watch()` bloklari.
    // Olculdu: iki `removeListener` cagrisi onUnmounted'in DISINA, hicbir zaman
    // cagrilmayan bir fonksiyona tasindiginda test YINE YESIL kaliyordu -- yani
    // "dinleyiciler onUnmounted ta kaldiriliyor" adli test tam da anlattigi
    // sizintida kirmizi OLAMIYORDU. Govde artik suslu parantez ESLESTIRILEREK
    // kesilir (satir sonundan bagimsiz) ve hook'ta BITER.
    it('dinleyiciler onUnmounted ta kaldiriliyor', () => {
        const blok = blokGovdesi(header, /onUnmounted\(\(\)\s*=>\s*/)
        expect(blok).not.toBeNull()
        expect(blok).toContain('chrome.tabs.onActivated.removeListener')
        expect(blok).toContain('chrome.tabs.onUpdated.removeListener')
    })

    // Onceki hal (review round 1, Bulgu 1): `indexOf('onActivated')`'tan
    // itibaren 600 karakterlik bir pencere ariyordu. Bu ILK 'onActivated'
    // aslinda `chrome.tabs.onActivated.addListener` cagrisinin ICINDE
    // (dinleyici KAYDI, govde DEGIL) ve gercek `onTabActivated`/`onTabUpdated`
    // govdeleri bunun 346 karakter ONCESINDE, pencerenin DISINDA kaliyordu --
    // pencere yalniz dosyanin sonundaki ILGISIZ `watch()` blogundaki
    // `loadConnectionState()`i buluyordu. Govdeler baska bir sey cagrisa da
    // (orn. bos birakilsa) test YINE YESIL kalirdi. Asagidaki iki test bunun
    // yerine `const onTabActivated =` / `const onTabUpdated =`in KENDI
    // govdesine (regex ile sinirlanmis) bakar.
    it('onTabActivated govdesi GERCEKTEN loadConnectionState cagirir', () => {
        const govdeEslesme = header.match(/const onTabActivated = \([^)]*\) => \{([\s\S]*?)\}/)
        expect(govdeEslesme).not.toBeNull()
        expect(govdeEslesme[1]).toContain('loadConnectionState')
    })

    it('onTabUpdated govdesi GERCEKTEN loadConnectionState cagirir', () => {
        const govdeEslesme = header.match(/const onTabUpdated = \([^)]*\) => \{([\s\S]*?)\}/)
        expect(govdeEslesme).not.toBeNull()
        expect(govdeEslesme[1]).toContain('loadConnectionState')
    })
})

describe('Header -- sorgu panelin kendi penceresine sabit', () => {
    it('ham lastFocusedWindow kullanilmiyor', () => {
        expect(header).not.toContain('lastFocusedWindow')
    })

    // KOD INCELEMESI: onceki hal `toContain('activeTabQuery')` idi ve 543.
    // satirdaki IMPORT tarafindan tek basina saglaniyordu. Olculdu: gercek
    // cagri `chrome.tabs.query({ lastFocusedWindow: true })` haline geri
    // cevrildiginde (testin adindaki gerileme) iddia YINE YESIL kaliyordu.
    // Artik SAYIM yapilir: dosyadaki HER `chrome.tabs.query` cagrisi
    // `activeTabQuery()`den gecmek zorunda -- bir tanesi bile sarmalanmamis
    // birakilsa sayilar tutmaz.
    it('activeTabQuery uzerinden sorguluyor', () => {
        const kod = yorumsuz(header)
        const tumSorgular = [...kod.matchAll(/chrome\.tabs\.query\(/g)]
        const sabitlenmis = [...kod.matchAll(/chrome\.tabs\.query\(activeTabQuery\(\)\)/g)]
        expect(tumSorgular.length).toBeGreaterThan(0)
        expect(sabitlenmis.length).toBe(tumSorgular.length)
    })

    // KOD INCELEMESI: onceki hal `toContain('initPanelWindowId')` idi. Dizge
    // dosyada BES kez geciyor ve UCU YORUM (1012, 1015, 1042. satirlar), biri
    // import. Olculdu: `await initPanelWindowId()` cagrisi onMounted'dan
    // TAMAMEN silindiginde iddia YINE YESIL kaliyordu -- yorumlar tek basina
    // yetiyordu. Artik cagri onMounted GOVDESINDE, `await` edilmis halde
    // aranir ("acilista cozuluyor" tam olarak bu demek).
    it('panel pencere kimligi acilista cozuluyor', () => {
        const mountGovdesi = blokGovdesi(header, /onMounted\(async\s*\(\)\s*=>\s*/)
        expect(mountGovdesi).not.toBeNull()
        expect(mountGovdesi).toMatch(/await initPanelWindowId\(\)/)
    })

    // Sekme degisiminde hostname ESKI degerinde kalmamali: mevcut try/catch
    // BOS ve hata yutuldugunda currentTabHostname degismiyordu.
    //
    // KOD INCELEMESI: onceki hal dosyanin TAMAMINDA `currentTabHostname.value
    // = ''` ariyordu. Bu atama kodda IKI yerde var: 919. satir (`if (!tab?.url)`
    // erken-donus dali) ve 963. satir (`catch` blogu). Testin adi ve yorumu
    // kurali CATCH'e baglıyor; olculdu: catch govdesi eski "her seyi yut"
    // haline geri getirildiginde dosya-genelindeki regex 919. satir sayesinde
    // YINE YESIL kaliyordu -- yani yazildigi gerileme onu kirmizi YAPAMIYORDU.
    // Iddia artik yalniz catch blogunun govdesine bakar.
    it('sekme cozulemezse hostname temizleniyor', () => {
        const yukleGovdesi = blokGovdesi(header, /async function loadConnectionState\(\)\s*/)
        expect(yukleGovdesi).not.toBeNull()
        const catchGovdesi = blokGovdesi(yukleGovdesi, /catch \(e\)\s*/)
        expect(catchGovdesi).not.toBeNull()
        expect(catchGovdesi).toMatch(/currentTabHostname\.value = ''/)
    })
})
