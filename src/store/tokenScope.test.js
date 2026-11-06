import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { tokenScopeStore } from './tokenScope'
import { networkStore } from './network'
import { privacyStore } from './privacy'
import { ALL_NETWORKS, effectiveScope } from '../utils/networkFilter'

// Ag filtresi eskiden Home.vue'ya AITTI. Kullanici ana ekranda bir zincir secip
// "Gonder" ya da "Ice Aktar"a gidince o secim kayboluyor, ekran yine aktif aga
// donuyordu: ayni soruya iki ekranda iki farkli cevap. Filtre artik PAYLASILIR.

const ETHEREUM = {
    name: 'Ethereum', chainId: 1,
    rpc: [{ url: 'https://eth-1.example' }],
}
const ARBITRUM = {
    name: 'Arbitrum One', chainId: 42161,
    rpc: [{ url: 'https://arb-1.example' }],
}

let storage

beforeEach(() => {
    storage = {}
    globalThis.chrome = {
        storage: {
            local: {
                get: vi.fn(async (k) => (typeof k === 'string' ? { [k]: storage[k] } : {})),
                set: vi.fn(async (obj) => { Object.assign(storage, obj) }),
            },
        },
    }
    setActivePinia(createPinia())
})

describe('tokenScopeStore', () => {
    it('varsayilan "tum aglar" (portfoy toplami ilk bakista gorunur)', () => {
        expect(tokenScopeStore().filter).toBe(ALL_NETWORKS)
    })

    it('setFilter degeri yazar', () => {
        const scope = tokenScopeStore()
        scope.setFilter(56)
        expect(scope.filter).toBe(56)
    })

    // Ekranlar bu store'u okuyor: iki ayri bilesenin ayni degeri gormesi
    // ozelligin TEK gerekcesi.
    it('ayni store iki cagirana ayni degeri verir', () => {
        tokenScopeStore().setFilter(137)
        expect(tokenScopeStore().filter).toBe(137)
    })

    describe('aktif ag degisimini izler', () => {
        const settle = async () => {
            await new Promise(resolve => setTimeout(resolve, 0))
            await nextTick()
        }

        it('ag degisince filtre YENI zincire atlar', async () => {
            const network = networkStore()
            const scope = tokenScopeStore()
            await settle()

            await network.setCurrentNetwork(ETHEREUM)
            await settle()
            await network.setCurrentNetwork(ARBITRUM)
            await settle()

            expect(scope.filter).toBe(42161)
        })

        // Store olusturulurken currentNetwork null'dan zincire geciyor. Bu bir AG
        // DEGISIMI degil; acilista "tum aglar" korunmazsa portfoy toplami hic
        // gorulemez.
        it('ilk yukleme (null -> zincir) varsayilani EZMEZ', async () => {
            const network = networkStore()
            const scope = tokenScopeStore()
            await settle()

            await network.setCurrentNetwork(ETHEREUM)
            await settle()

            expect(scope.filter).toBe(ALL_NETWORKS)
        })

        it('ayni zincire yeniden gecmek kullanicinin secimini bozmaz', async () => {
            const network = networkStore()
            const scope = tokenScopeStore()
            await settle()

            await network.setCurrentNetwork(ETHEREUM)
            await settle()

            scope.setFilter(ALL_NETWORKS)
            await network.setCurrentNetwork(ETHEREUM)
            await settle()

            expect(scope.filter).toBe(ALL_NETWORKS)
        })
    })
})

// `chosen`: kullanici pill'e DOKUNDU MU. `filter` tek basina bunu ayirt edemiyordu:
// acilistaki 'all' ile kullanicinin ACIKCA sectigi 'all' ayni degerdi. Tek zincirli
// ekranlar (swapFrom) bu yuzden sorulmamis "tum aglar" varsayilaniyla aciliyordu.
describe('tokenScopeStore — chosen bayragi', () => {
    const settle = async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
        await nextTick()
    }

    // T22
    it('acilista chosen false ve filtre "tum aglar"', () => {
        const scope = tokenScopeStore()
        expect(scope.filter).toBe(ALL_NETWORKS)
        expect(scope.chosen).toBe(false)
    })

    // T23
    it('setFilter kullanicinin ACIK cevabidir -> chosen true', () => {
        const scope = tokenScopeStore()
        scope.setFilter(56)
        expect(scope.chosen).toBe(true)
    })

    it('acikca "tum aglar" secmek de bir cevaptir', () => {
        const scope = tokenScopeStore()
        scope.setFilter(ALL_NETWORKS)
        expect(scope.filter).toBe(ALL_NETWORKS)
        expect(scope.chosen).toBe(true)
    })

    // T24 — ag secimi, KAPSAM sorusuna verilmis bir cevap DEGILDIR.
    it('ag degisimi filtreyi zincire atlatir ama chosen FALSE kalir', async () => {
        const network = networkStore()
        const scope = tokenScopeStore()
        await settle()

        await network.setCurrentNetwork(ETHEREUM)
        await settle()
        await network.setCurrentNetwork(ARBITRUM)
        await settle()

        expect(scope.filter).toBe(42161)
        expect(scope.chosen).toBe(false)
    })

    // T25 — ZARAR A KILIDI. effectiveScope TURETIR, store'a YAZMAZ. Biri ileride
    // bunu setFilter'e cevirirse Home'a sizar: kullanici Takas'a girip cikinca
    // portfoy toplami sessizce duser.
    it('effectiveScope store u DEGISTIRMEZ', () => {
        const scope = tokenScopeStore()
        expect(effectiveScope(scope.filter, scope.chosen, 137)).toBe(137)
        expect(scope.filter).toBe(ALL_NETWORKS)
        expect(scope.chosen).toBe(false)
    })
})

// GIZLI MOD (gizli-mod cok-ag spec 4.7 "Home sorgu kumesi" madde 1, E7): ozel modda "Tum aglar" gorunumu
// yoktur. `filter` TURETILMIS okunur degerdir: ham deger 'all' iken ETKIN AGIN kimligi; ham deger store'a
// YAZILMAZ, yani normal moda donuste oldugu gibi durur.
describe('tokenScopeStore -- gizli mod turetmesi', () => {
    const BSC = { name: 'BNB Smart Chain', chainId: 56, rpc: [{ url: 'https://bsc-1.example' }] }
    const settle = async () => {
        await new Promise(resolve => setTimeout(resolve, 0))
        await nextTick()
    }

    // Etkin ag SENKRON kurulur (null -> zincir, yani 'ilk yukleme': kapsam 'all' kalir) ve store'un kendi
    // asenkron baslangic okumasi onu EZMEZ (network.js: currentNetwork doluysa donusu yok sayilir).
    async function kur() {
        const network = networkStore()
        const privacy = privacyStore()
        const scope = tokenScopeStore()
        network.currentNetwork = BSC
        await settle()
        return { network, privacy, scope }
    }

    it('REGRESYON: normal modda filter ham degerdir, ag cozulmus olsa bile "all" kalir', async () => {
        const { scope } = await kur()
        expect(scope.filter).toBe(ALL_NETWORKS)
    })

    it("gizli modda ham 'all' iken filter ETKIN AGIN kimligini dondurur", async () => {
        const { privacy, scope } = await kur()
        privacy.active = true
        expect(scope.filter).toBe(56)
    })

    it('ham deger bir zincirse gizli mod ona DOKUNMAZ (etkin agdan farkli olsa bile)', async () => {
        const { privacy, scope } = await kur()
        scope.setFilter(137)
        privacy.active = true
        expect(scope.filter).toBe(137)
    })

    it('HAM deger store a yazilmaz: gizli moddan donuste "all" korunur', async () => {
        const { privacy, scope } = await kur()
        privacy.active = true
        expect(scope.filter).toBe(56)
        privacy.active = false
        expect(scope.filter).toBe(ALL_NETWORKS)
    })

    it('etkin ag cozulemezse gizli modda uydurma zincire dusmez: all kalir', async () => {
        const { network, privacy, scope } = await kur()
        network.currentNetwork = null
        privacy.active = true
        expect(scope.filter).toBe(ALL_NETWORKS)
    })

    it('eski yazicilar calisir: filter atamasi ham degeri yazar (Home testleri bunu kullanir)', async () => {
        const { privacy, scope } = await kur()
        scope.filter = 137
        expect(scope.filter).toBe(137)
        privacy.active = true
        expect(scope.filter).toBe(137)
        scope.filter = ALL_NETWORKS
        expect(scope.filter).toBe(56)
    })

    it('gizli modda ag degisimi turetilmis degeri yeni agla gunceller', async () => {
        const { network, privacy, scope } = await kur()
        privacy.active = true
        await network.setCurrentNetwork(ARBITRUM)
        await settle()
        expect(scope.filter).toBe(42161)
    })
})
