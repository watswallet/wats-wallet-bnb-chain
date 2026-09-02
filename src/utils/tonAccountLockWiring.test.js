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
    // Bu olmadan diger iki kapi YETMEZ: kullanici Ethereum'dayken TON hesabina
    // gecerse, hicbir ag DEGISIMI olmadigi icin applyNetworkChange hic calismaz
    // ve kullanici hicbir sey yapamayacagi bir ekranda kalir.
    it('changeAccount TON kilidini uygular', () => {
        const fn = HEADER.slice(HEADER.indexOf('const changeAccount'))
        expect(fn).toContain('isTonOnlyAccount')
    })
})
