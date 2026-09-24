import { describe, it, expect, vi, afterEach } from 'vitest'
import { createUiSync, installUiSync } from './uiSync'

let listeners

function stub() {
    listeners = []
    globalThis.chrome = {
        storage: {
            onChanged: {
                addListener: vi.fn((fn) => listeners.push(fn)),
                removeListener: vi.fn((fn) => {
                    const i = listeners.indexOf(fn)
                    if (i > -1) listeners.splice(i, 1)
                }),
            },
        },
    }
}

const degistir = (changes, area = 'local') => listeners.forEach((fn) => fn(changes, area))

afterEach(() => { delete globalThis.chrome })

describe('createUiSync', () => {
    it('ilgilendigi anahtar degisince isleyiciyi cagirir', () => {
        stub()
        const onHesap = vi.fn()
        const s = createUiSync({ handlers: { active_account: onHesap } })
        s.start()

        degistir({ active_account: { newValue: { address: '0xb' } } })
        expect(onHesap).toHaveBeenCalledWith({ address: '0xb' }, undefined)
    })

    it('ilgilenmedigi anahtari yok sayar', () => {
        stub()
        const onHesap = vi.fn()
        createUiSync({ handlers: { active_account: onHesap } }).start()

        degistir({ prices: { newValue: 1 } })
        expect(onHesap).not.toHaveBeenCalled()
    })

    it('local DISI alanlari yok sayar', () => {
        stub()
        const onHesap = vi.fn()
        createUiSync({ handlers: { active_account: onHesap } }).start()

        degistir({ active_account: { newValue: {} } }, 'session')
        expect(onHesap).not.toHaveBeenCalled()
    })

    // IDEMPOTENT: store'lar pinia singleton'i ve bootstrap yeniden kosarsa
    // dinleyici COGALIRDI (transaction.js'teki mevcut sizinti tam olarak bu).
    it('iki kez start bir tek dinleyici birakir', () => {
        stub()
        const s = createUiSync({ handlers: { active_account: vi.fn() } })
        s.start()
        s.start()
        expect(listeners.length).toBe(1)
    })

    it('stop dinleyiciyi kaldirir', () => {
        stub()
        const onHesap = vi.fn()
        const s = createUiSync({ handlers: { active_account: onHesap } })
        s.start()
        s.stop()

        expect(listeners.length).toBe(0)
    })

    it('isleyici firlatirsa digerleri yine calisir', () => {
        stub()
        const patlak = vi.fn(() => { throw new Error('patladi') })
        const saglam = vi.fn()
        createUiSync({ handlers: { a: patlak, b: saglam } }).start()

        expect(() => degistir({ a: { newValue: 1 }, b: { newValue: 2 } })).not.toThrow()
        expect(saglam).toHaveBeenCalled()
    })

    it('eski degeri de isleyiciye verir (kendi yazdigini eleyebilmek icin)', () => {
        stub()
        const onAg = vi.fn()
        createUiSync({ handlers: { currentNetwork: onAg } }).start()

        degistir({ currentNetwork: { newValue: { chainId: 2 }, oldValue: { chainId: 1 } } })
        expect(onAg).toHaveBeenCalledWith({ chainId: 2 }, { chainId: 1 })
    })
})

// installUiSync: bootstrap.js'in cagirdigi gercek kablolama. Brief'in
// interface satiri bunu vaat ediyor ("installUiSync(deps) -> () => void")
// ama Step 3/5 hicbir yerde tanimlamiyor -- burada ekleniyor. Store'lar ve
// i18n her testte SAHTE (plain obje) enjekte edilir, gercek Pinia store'lari
// DEGIL: modul enjeksiyon sinirini korumali.
function sayanAlan(baslangic) {
    let deger = baslangic
    let yazma = 0
    return {
        get deger() { return deger },
        set deger(v) { deger = v; yazma++ },
        get yazma() { return yazma },
    }
}

function sahteBagimliliklar({ adres = null, hesap = null, ag = null, dil = 'en' } = {}) {
    const adresAlan = sayanAlan(adres)
    const hesapAlan = sayanAlan(hesap)
    const agAlan = sayanAlan(ag)
    const dilAlan = sayanAlan(dil)
    // AG icin IKI AYRI KANAL, BILEREK: `agAlan` DOGRUDAN alan atamasini
    // (`network.currentNetwork = ...`) sayar, `benimsenenler` ise depo eylemini
    // (`adoptNetwork`) kaydeder. Ayri tutulmazlarsa "hangisinin cagrildigi"
    // sorusu SORULAMAZ -- ve tam o soru bu dosyanin kapattigi hatadir: dogrudan
    // atama agin YARISINI senkronlar, `rpc`/`rpcChainId` onceki zincirde kalir.
    const benimsenenler = []
    return {
        adresAlan,
        hesapAlan,
        agAlan,
        benimsenenler,
        dilAlan,
        userStore: () => ({
            get address() { return adresAlan.deger },
            set address(v) { adresAlan.deger = v },
            get activeAccount() { return hesapAlan.deger },
            set activeAccount(v) { hesapAlan.deger = v },
        }),
        networkStore: () => ({
            get currentNetwork() {
                return benimsenenler.length ? benimsenenler[benimsenenler.length - 1] : agAlan.deger
            },
            set currentNetwork(v) { agAlan.deger = v },
            adoptNetwork: (v) => { benimsenenler.push(v) },
        }),
        i18n: { global: { locale: { get value() { return dilAlan.deger }, set value(v) { dilAlan.deger = v } } } },
    }
}

describe('installUiSync', () => {
    it('active_account degisince userStore().address gunceller', () => {
        stub()
        const { adresAlan, userStore, networkStore, i18n } = sahteBagimliliklar()
        installUiSync({ userStore, networkStore, i18n })

        degistir({ active_account: { newValue: { address: '0xa' } } })
        expect(adresAlan.deger).toBe('0xa')
    })

    it('adres ayniysa yeniden yazmaz (dongu onlemi)', () => {
        stub()
        const { adresAlan, userStore, networkStore, i18n } = sahteBagimliliklar({ adres: '0xa' })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ active_account: { newValue: { address: '0xa' } } })
        expect(adresAlan.yazma).toBe(0)
    })

    it('adres yoksa yok sayar', () => {
        stub()
        const { adresAlan, hesapAlan, userStore, networkStore, i18n } = sahteBagimliliklar()
        installUiSync({ userStore, networkStore, i18n })

        degistir({ active_account: { newValue: {} } })
        expect(adresAlan.yazma).toBe(0)
        expect(hesapAlan.yazma).toBe(0)
    })

    // ADRES TEK BASINA YETMEZ: Header'in gosterdigi ad/avatar/profil adresten
    // TUREMEZ, hesap NESNESINDEN gelir. Yalnizca adres tasindiginda B paneli
    // Home'da YENI hesabin bakiyelerini, basliginda ONCEKI hesabin adini
    // gosteriyordu. (Zincirin tamami Header.ssr.test.js'te surulur.)
    it('active_account degisince hesap NESNESI de depoya yazilir', () => {
        stub()
        const yeniHesap = { address: '0xb', key: 'acc2', name: 'Hesap B' }
        const { hesapAlan, userStore, networkStore, i18n } = sahteBagimliliklar({
            adres: '0xa', hesap: { address: '0xa', key: 'acc1', name: 'Hesap A' },
        })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ active_account: { newValue: yeniHesap } })
        expect(hesapAlan.deger).toEqual(yeniHesap)
    })

    // AYNI hesap tekrar yazilmaz: gereksiz reaktif tetikleme yok.
    it('ayni hesap anahtari yeniden yazilmaz', () => {
        stub()
        const hesap = { address: '0xa', key: 'acc1' }
        const { hesapAlan, userStore, networkStore, i18n } = sahteBagimliliklar({ adres: '0xa', hesap })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ active_account: { newValue: { ...hesap } } })
        expect(hesapAlan.yazma).toBe(0)
    })

    it('ag chainId aynysa yeniden yazmaz (sonsuz ping-pong onlemi)', () => {
        stub()
        const { agAlan, benimsenenler, userStore, networkStore, i18n } = sahteBagimliliklar({ ag: { chainId: 1 } })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ currentNetwork: { newValue: { chainId: 1 } } })
        expect(agAlan.yazma).toBe(0)
        expect(benimsenenler).toEqual([])
    })

    // AGIN TAMAMI SENKRONLANIR, YARISI DEGIL.
    //
    // Kapatilan hata: bu isleyici `network.currentNetwork = yeni` diyordu. Zincir
    // kaydi degisiyor ama `rpc` ONCEKI zincirin ucunda kaliyor ve `rpcChainId`
    // da oyle -- ustelik onu duzeltecek kimse yok: App.vue'nun `reconnect()`i
    // yalnizca `checkConnection()` BASARISIZ olunca kosar, eski uc ise saglikli.
    // Bu arada Home.vue'nun izleyicisi chainId degisimiyle atesleniyor ve
    // bakiyeleri BAYAT uctan okuyor. Yani B paneli YENI agin adini ONCEKI
    // zincirin verisinin ustunde gosteriyordu.
    //
    // Kural depoda (`adoptNetwork`, store/network.js) ve BU KOPRU ONU CAGIRMALI;
    // alani dogrudan yazmak kurali ATLAR. Depo eyleminin kendi davranisi
    // store/network.test.js'te GERCEK store ile olculuyor.
    it('ag chainId farkliysa depo eylemini (adoptNetwork) cagirir', () => {
        stub()
        const { benimsenenler, userStore, networkStore, i18n } = sahteBagimliliklar({ ag: { chainId: 1 } })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ currentNetwork: { newValue: { chainId: 2 } } })
        expect(benimsenenler).toEqual([{ chainId: 2 }])
    })

    it('ag degisimini DOGRUDAN alan atamasiyla yapmaz', () => {
        stub()
        const { agAlan, userStore, networkStore, i18n } = sahteBagimliliklar({ ag: { chainId: 1 } })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ currentNetwork: { newValue: { chainId: 2 } } })
        expect(agAlan.yazma).toBe(0)
    })

    it('dil ayniysa yeniden yazmaz', () => {
        stub()
        const { dilAlan, userStore, networkStore, i18n } = sahteBagimliliklar({ dil: 'tr' })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ language: { newValue: 'tr' } })
        expect(dilAlan.yazma).toBe(0)
    })

    it('dil farkliysa i18n global locale gunceller', () => {
        stub()
        const { dilAlan, userStore, networkStore, i18n } = sahteBagimliliklar({ dil: 'tr' })
        installUiSync({ userStore, networkStore, i18n })

        degistir({ language: { newValue: 'en' } })
        expect(dilAlan.deger).toBe('en')
    })

    it('donen teardown dinleyiciyi kaldirir', () => {
        stub()
        const { userStore, networkStore, i18n } = sahteBagimliliklar()
        const kapat = installUiSync({ userStore, networkStore, i18n })

        expect(listeners.length).toBe(1)
        kapat()
        expect(listeners.length).toBe(0)
    })
})
