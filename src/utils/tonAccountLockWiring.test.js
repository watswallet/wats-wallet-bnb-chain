import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Baglanti testleri: saf kapi accountKind.test.js'te olculuyor. Burada olculen
// sey kapinin GERCEKTEN CAGRILDIGI. Depoda bu kalip var (tonFlowWiring.test.js).
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const APPLY = read('./applyNetworkChange.js')
const POPUP = read('../components/popups/networksPopup.vue')
const HEADER = read('../components/Header.vue')

describe('ag degistirme govdesi hesap kilidini uygular', () => {
    // Iddialar DOSYAYA degil FONKSIYON GOVDESINE bakmali: `toContain('accountSupportsChain')`
    // import satiriyla da karsilanir, yani asil CAGRIYI silen bir mutasyon testi
    // gecerdi. Mutasyon testi bunu yakaladi - 4 mutasyondan 3'u kacmisti.
    const APPLY_BODY = APPLY.slice(APPLY.indexOf('export async function applyNetworkChange'))

    it('accountSupportsChain cagrilir', () => {
        expect(APPLY_BODY).toContain('accountSupportsChain(active_account, chain)')
    })

    // Kapi setCurrentNetwork'ten ONCE olmali; sonra olsaydi ag zaten degismis
    // olur ve "ekranda Ethereum yaziyor ama hesabin EVM anahtari yok" durumu
    // olusurdu.
    it('kapi setCurrentNetwork ten ONCE calisir', () => {
        const gate = APPLY_BODY.indexOf('accountSupportsChain(active_account, chain)')
        const set = APPLY_BODY.indexOf('await network.setCurrentNetwork(chain)')
        expect(gate).toBeGreaterThan(-1)
        expect(set).toBeGreaterThan(gate)
    })
})

describe('ag secici hesaba gore listeler', () => {
    // Ayni sebep: import satiri `chainsForAccount`i zaten iceriyor. Olculmesi gereken
    // sey listenin GERCEKTEN o filtreden gecmesi.
    it('chainsForAccount kullanilir', () => {
        const chainsComputed = POPUP.split('\n').find((l) => l.includes('const chains = computed'))
        expect(chainsComputed, 'chains computed bulunamadi').toBeDefined()
        expect(chainsComputed).toContain('chainsForAccount')
    })
})

describe('hesap degisince ag TON a alinir', () => {
    // Bu olmadan diger iki kapi YETMEZ: kullanici Ethereum'dayken eski/legacy
    // `type:'ton'` bir hesaba gecerse, hicbir ag DEGISIMI olmadigi icin
    // applyNetworkChange hic calismaz ve kullanici hicbir sey yapamayacagi bir
    // ekranda kalir.
    //
    // GUNCELLEME (2026-09-10 Gorev 4, accountKindOf/isTonOnlyAccount temizligi):
    // `isTonOnlyAccount` kod tabanindan tamamen kaldirildi ve dogrudan hesap
    // turu esitligine (`acc?.type === 'ton'`) cevrildi -- davranis AYNI.
    it('changeAccount TON kilidini uygular', () => {
        const fn = HEADER.slice(HEADER.indexOf('const changeAccount'))
        expect(fn).not.toContain('isTonOnlyAccount')
        expect(fn).toMatch(/if \(acc\?\.type === 'ton' && !isTon\(network\.currentNetwork\) && tonChain\.value\)/)
    })
})

// AYNA DAL — EVM yonu. Ustteki blok TON yonunu olcuyor; bu blok eksik yariyi.
//
// Kullanici TON agindayken bir EVM hesabina gecerse ag DEGISMEDIGI icin
// applyNetworkChange hic calismaz. Adim 1'den sonra accountSupportsChain cift
// yonlu oldugu icin bu artik yalnizca "bos ekran" degil, YUKLEMLE CELISEN bir
// durum: ag secici o zinciri hesabin listesinden dusurmus (chainsForAccount),
// ama aktif ag hala o. Simetrik yuklem, simetrik uzlastirma.
//
// DUZELTME (2026-09-10, inceleme turu 2, Important 5): kapi `accountHasEvm(acc)`
// DEGIL `!accountHasTon(acc)`. `type:'hd'` hesap TUM_AILELER'de (accountKind.js,
// Gorev 2) oldugu icin `accountHasEvm(hd)` HER ZAMAN `true` donuyordu -- eski
// kosul TON agindayken IKI hd hesap arasinda gecis yapan bir kullaniciyi bile
// zorla Ethereum'a cekiyordu. Dogru soru "bu hesap TON'u KANITLIYOR mu": yalniz
// ice aktarilmis/ozel anahtar hesaplarda (YALNIZ_EVM) `false` doner ve YALNIZ
// onlar TON agindan cikarilmasi gereken GERCEK nufustur.
describe('hesap degisince ag EVM yonunde de uzlasir', () => {
    // Govde `copyRow`da bitirilir: Header.vue'nun geri kalaninda `chainsForAccount`
    // baska amaclarla da gecebilir ve dosya geneline bakan bir iddia, asil dali
    // silen bir mutasyonda gecerdi.
    const fn = HEADER.slice(HEADER.indexOf('const changeAccount'), HEADER.indexOf('const copyRow'))

    it('changeAccount EVM hesabini hesabin destekledigi ilk zincire alir', () => {
        expect(fn).toContain('!accountHasTon(acc)')
        expect(fn).not.toMatch(/accountHasEvm\(acc\)\s*&&\s*isTon/)
        expect(fn).toContain('chainsForAccount(acc, chains)[0]')
    })

    // Hedef SABIT bir zincir OLMAMALI. Sabit yazilirsa (ornegin dogrudan Ethereum)
    // bu dal, store/network.js'in acilis uzlastirmasindan (adim 1) sapar ve ayni
    // hesap iki yoldan iki farkli aga varir.
    it('hedef zincir SABIT yazilmaz, hesaptan cozulur', () => {
        expect(fn).not.toContain('TON_MAINNET_ID')
        expect(fn).toContain('chainsForAccount(acc, chains)[0]')
    })

    // Sira ZORUNLU: applyNetworkChange kendi hesap kapisi icin `active_account`i
    // DISKTEN okuyor (applyNetworkChange.js:47-48). Ayna dal diske yazmadan once
    // calissaydi kapi ONCEKI (TON) hesabi gorur ve gecisi kendi uyarisiyla
    // reddederdi - yani duzeltme hicbir sey yapmaz, ustelik alert atardi.
    it('ayna dal active_account diske yazildiktan SONRA calisir', () => {
        const write = fn.indexOf('chrome.storage.local.set({ active_account: acc })')
        const mirror = fn.indexOf('chainsForAccount(acc, chains)[0]')
        expect(mirror, 'ayna dal bulunamadi').toBeGreaterThan(-1)
        expect(mirror).toBeGreaterThan(write)
    })
})
