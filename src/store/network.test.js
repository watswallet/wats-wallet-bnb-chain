import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { networkStore } from './network'
import { ALL_CHAINS } from '../data/chains'
import { SOLANA_CHAIN_ID } from '../utils/solana/constants'

// #9: Bridge'in reverse dugmesi hedef zincir secilmeden basildiginda
// setCurrentNetwork(null) cagriliyor, currentNetwork null olarak diske de yaziliyor
// ve sonraki her `currentNetwork.chainId` erisimi tum arayuzu bozuyordu.
//
// #10/#16: `rpc` ayri bir ref ve findFastestRPC gecikmeli calisiyor; zincir
// degistiginde rpc ESKI zinciri gostermeye devam ediyor, bakiye ve gas kontrolleri
// yanlis zincirden okunuyordu.

const ETHEREUM = {
    name: 'Ethereum', chainId: 1,
    rpc: [{ url: 'https://eth-1.example' }, { url: 'https://eth-2.example' }]
}
const ARBITRUM = {
    name: 'Arbitrum One', chainId: 42161,
    rpc: [{ url: 'https://arb-1.example' }]
}

let storage

// Store olusturulurken initializeCurrentNetwork() await edilmeden baslatiliyor.
// Testler o cagri bitmeden devam ederse yaris kosulu olusur; bir tik bekleniyor.
const freshStore = async () => {
    const store = networkStore()
    await new Promise(resolve => setTimeout(resolve, 0))
    return store
}

beforeEach(() => {
    storage = {}
    globalThis.chrome = {
        storage: {
            local: {
                get: vi.fn(async (k) => (typeof k === 'string' ? { [k]: storage[k] } : {})),
                set: vi.fn(async (obj) => { Object.assign(storage, obj) })
            }
        }
    }
    setActivePinia(createPinia())
})

describe('setCurrentNetwork', () => {
    it('gecerli zinciri kaydeder ve diske yazar', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ARBITRUM)

        expect(network.currentNetwork.chainId).toBe(42161)
        expect(storage.currentNetwork.chainId).toBe(42161)
    })

    it('#9: null zinciri REDDEDER - currentNetwork bozulmaz', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ETHEREUM)

        await network.setCurrentNetwork(null)

        expect(network.currentNetwork).not.toBeNull()
        expect(network.currentNetwork.chainId).toBe(1)
    })

    it('#9: null zinciri diske YAZMAZ', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ETHEREUM)
        chrome.storage.local.set.mockClear()

        await network.setCurrentNetwork(null)

        expect(chrome.storage.local.set).not.toHaveBeenCalled()
        expect(storage.currentNetwork.chainId).toBe(1)
    })

    it('chainId tasimayan nesneyi de reddeder', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ETHEREUM)

        await network.setCurrentNetwork({ name: 'Bozuk', rpc: [] })

        expect(network.currentNetwork.chainId).toBe(1)
    })
})

describe('rpc ile zincir eslesmesi', () => {
    it('#10/#16: zincir degisir degismez rpc de YENI zincire gecer', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ETHEREUM)
        expect(network.rpc).toBe('https://eth-1.example')

        // findFastestRPC henuz calismadi; eskiden rpc burada hala Ethereum'du.
        await network.setCurrentNetwork(ARBITRUM)

        expect(network.rpc).toBe('https://arb-1.example')
        expect(network.rpcChainId).toBe(42161)
    })

    it('setRpc secilen RPC ile birlikte zinciri de kaydeder', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ETHEREUM)

        network.setRpc('https://eth-2.example', 1)

        expect(network.rpc).toBe('https://eth-2.example')
        expect(network.rpcChainId).toBe(1)
    })

    it('setRpc bos url ile mevcut RPC"yi bozmaz', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ARBITRUM)

        network.setRpc(null, 42161)

        expect(network.rpc).toBe('https://arb-1.example')
    })

    it('rpc alani nesne olarak gelirse de ilk url alinir', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork({
            name: 'Nesne RPC', chainId: 56,
            rpc: { 0: { url: 'https://bsc-1.example' } }
        })

        expect(network.rpc).toBe('https://bsc-1.example')
        expect(network.rpcChainId).toBe(56)
    })
})

describe('initializeCurrentNetwork', () => {
    it('diskte null kayitliysa varsayilan aga duser', async () => {
        storage.currentNetwork = null
        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.chainId).toBe(1)
        expect(network.rpc).toBeTruthy()
        expect(network.rpcChainId).toBe(1)
    })

    it('diskteki gecerli agi yukler ve rpc"yi ona ayarlar', async () => {
        storage.currentNetwork = ARBITRUM
        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.chainId).toBe(42161)
        expect(network.rpcChainId).toBe(42161)
    })

    // Zincir kaydinin TAMAMI (rpc listesi dahil) diske yaziliyor. Kayit oradan oldugu
    // gibi geri yuklenirse paketle gelen RPC duzeltmeleri MEVCUT KURULUMLARA HIC
    // ULASMAZ: App.vue findFastestRPC'yi diskten gelen listeyle calistirir, kullanici
    // eski (bozuk) ucta kalir. 2026-08-05'te tam bu oldu — publicnode uclari
    // eth_getTransactionReceipt'i kapatti, surum yenilendi ama diskteki kayit eskiydi.
    it('diskteki eski RPC listesi paket icindeki guncel kayitla tazelenir', async () => {
        const bundled = ALL_CHAINS.find((c) => c.chainId === 42161)
        storage.currentNetwork = { ...bundled, rpc: [{ url: 'https://olu-rpc.example' }] }

        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.rpc[0].url).toBe(bundled.rpc[0].url)
        expect(network.rpc).toBe(bundled.rpc[0].url)
        expect(storage.currentNetwork.rpc[0].url).toBe(bundled.rpc[0].url)
    })

    // Review Bulgu 6: `Number(c.chainId) === Number(stored.chainId)` Solana'da
    // NaN===NaN (false) uretip `bundled`i HEP null birakiyordu — diskteki HAM kayit
    // (paketten gelen duzeltmeler HARIC) sonsuza kadar kullanilirdi. Bugun zararsiz
    // (Solana kaydinda tazelenecek rpc yok) ama Task 9 kayda alan eklerse (or.
    // logoURI, nativeCoingeckoId duzeltmesi) sessizce diskte eski kalirdi.
    it('diskteki Solana kaydi paketten TAZELENIR', async () => {
        const bundled = ALL_CHAINS.find((c) => c.chainId === SOLANA_CHAIN_ID)
        storage.currentNetwork = { ...bundled, name: 'Eski Solana Adi' }

        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.name).toBe(bundled.name)
        expect(storage.currentNetwork.name).toBe(bundled.name)
    })

    // TON'un istemci tarafinda RPC ucu YOK (erisim backend proxy'sinden). Diskte TON
    // secili durumdayken uzantı acilirsa ve bu boot yolu (initializeCurrentNetwork)
    // eski EVM ucunu temizlemezse, uzantı TON secili acildiginda bayat bir EVM ucu
    // bellekte kalir ve TON'dayken o zincirden okuma yapan kod yollari sessizce
    // calismaya devam eder — kullanici TON gorurken bakiye/gas kontrolleri yanlis
    // (onceki EVM) zincirden okunur.
    it('diskte TON seciliyken acilista bayat EVM rpc si GERI GELMEZ', async () => {
        const tonBundled = ALL_CHAINS.find((c) => c.chainId === -239)
        storage.currentNetwork = tonBundled

        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.chainId).toBe(-239)
        expect(network.rpc).toBeNull()
        expect(network.rpcChainId).toBe(-239)
    })

    // Karsit test: dal ters kurulursa (or. `isTon` yerine `isEvm` yazilirsa) EVM
    // zincirleri de rpc'si BOSALTILMIS sekilde acilir ve kullanici hicbir zincirde
    // RPC'ye sahip olmadan kalir. Bu test EVM tarafinin bozulmadigini kilitler.
    it('diskte EVM zinciri seciliyken acilista rpc BOSALTILMAZ', async () => {
        storage.currentNetwork = ARBITRUM

        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.chainId).toBe(42161)
        expect(network.rpc).not.toBeNull()
        expect(network.rpcChainId).toBe(42161)
    })

    // --- HESAP-AG UZLASTIRMASI (spec §9.3) ---
    //
    // Ag kilidi `applyNetworkChange` (ag degisince) ve `Header.changeAccount`
    // (hesap degisince) icinde duruyordu; ICE AKTARMA yolu ikisinden de GECMIYOR.
    // ImportPhrases.vue / CreatePassword2.vue `active_account`i dogrudan yazip
    // 'ready' der. Kullanici bir hesabin DESTEKLEMEDIGI bir agdayken o hesabi
    // aktif ederse diskte "hesap + desteklenmeyen ag" cifti kalir. Acilis
    // uzlastirmasi bu cifti KENDI DUZELTIR.
    //
    // DUZELTME (2026-09-10, inceleme turu 2 -- koordinatorden): bir onceki
    // tur burada "Y2: type:'ton' hesabin da EVM'i var" diye TERSINE test
    // yazmisti; bu, spec'teki bir olcum hatasina dayaniyordu. Olculdu:
    // `type:'ton'` hesabi artik HICBIR akis URETMIYOR (Y1 dugmesi iptal,
    // Y2'nin ice aktarilan hesabi `type:'hd'`+`tonFingerprint` doguyor,
    // hybridTonAccount.js:72). Kalan `type:'ton'` kayitlar YALNIZCA eski/
    // legacy gelistirici profilleri: `account.address` bir TON adresidir,
    // EVM'i YOKTUR (accountKind.js duzeltildi: `accountKindsOf({type:'ton'})
    // === ['ton']`). Asagidaki test ORIJINAL davranisina donuyor: TON hesabi
    // EVM aginda acilista TON'a ALINIR -- store/network.js hic degismedi,
    // zaten dogru `accountSupportsChain`i soruyordu.
    //
    // KARSIT durum (HD hesabin TON aginda birakilmasi) DEGISMEDI: hd hesap
    // hala TUM_AILELER'de, o test asagida aynen kaliyor.

    const TON_ACCOUNT = { key: 'ton-1', type: 'ton', address: 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q' }

    it('TON hesabi + EVM agi cifti acilista TON a alinir', async () => {
        storage.currentNetwork = ARBITRUM
        storage.active_account = TON_ACCOUNT

        const network = await freshStore()

        // Yalnizca bellekte duzeltmek YETMEZ: depodan DOGRUDAN okuyan yerler
        // (dappFunctions.handleGetChainId, App.vue, ConnectDapp) eski zinciri
        // gormeye devam ederdi.
        expect(network.currentNetwork.chainId).toBe(-239)
        expect(storage.currentNetwork.chainId).toBe(-239)
        // TON'un istemci tarafinda RPC ucu yok; bayat EVM ucu bellekte kalmamali.
        expect(network.rpc).toBeNull()
        expect(network.rpcChainId).toBe(-239)
    })

    // KARSIT TEST: kapi ters kurulursa (or. kosul negatiflenirse) sıradan EVM
    // hesaplari da TON'a surulur ve cuzdan EVM'de kullanilamaz hale gelir.
    it('EVM hesabi EVM aginda BIRAKILIR', async () => {
        storage.currentNetwork = ARBITRUM
        storage.active_account = { key: 'hd-1', type: 'hd', address: '0x' + '11'.repeat(20) }

        const network = await freshStore()

        expect(network.currentNetwork.chainId).toBe(42161)
        expect(storage.currentNetwork.chainId).toBe(42161)
    })

    it('HD hesabi TON aginda acilista OLDUGU GIBI birakilir (Y2: HD hesabinin da TON u var)', async () => {
        storage.currentNetwork = ALL_CHAINS.find((c) => Number(c.chainId) === -239)
        storage.active_account = { key: 'hd-1', type: 'hd', address: '0x' + '11'.repeat(20) }

        const network = await freshStore()

        expect(network.currentNetwork.chainId).toBe(-239)
        expect(storage.currentNetwork.chainId).toBe(-239)
        // TON'un istemci tarafinda RPC ucu yok; bu hesap icin de degismez.
        expect(network.rpc).toBeNull()
        expect(network.rpcChainId).toBe(-239)
    })

    // UZLASTIRMANIN KENDISI hala GERCEK bir nufus icin gerekli: ice aktarilmis/
    // ozel anahtar hesaplarin (accountKind.js: YALNIZ_EVM) TON'u YOK. Bu test
    // olmadan yukaridaki iki degisiklik uzlastirma kapisini SESSIZCE OLU KOD
    // birakirdi -- kapi hala var ama onu tetikleyen HICBIR fixture kalmazdi.
    it('ozel anahtar hesabi TON aginda acilista hesabin DESTEKLEDIGI ilk zincire alinir (gercek uyusmazlik, YALNIZ_EVM)', async () => {
        storage.currentNetwork = ALL_CHAINS.find((c) => Number(c.chainId) === -239)
        storage.active_account = { key: 'pk-1', type: 'privateKey', address: '0x' + '22'.repeat(20) }

        const network = await freshStore()

        expect(network.currentNetwork.chainId).toBe(1)
        expect(storage.currentNetwork.chainId).toBe(1)
        // TON'un rpc listesi bos; EVM'e alinan hesap RPC'siz KALMAMALI.
        expect(network.rpc).toBeTruthy()
        expect(network.rpcChainId).toBe(1)
    })

    // FAIL-OPEN: acilista `active_account` bir an bos olabiliyor. O anda kilidi
    // uygulamak butun aglari TON'a kilitlerdi (accountKind.js'in acik kurali).
    it('active_account yokken hicbir sey degismez', async () => {
        storage.currentNetwork = ARBITRUM

        const network = await freshStore()

        expect(network.currentNetwork.chainId).toBe(42161)
    })

    // TON hesabi ZATEN TON agindaysa gereksiz bir disk yazimi yapilmamali:
    // her acilista tekrar yazmak, uzlastirmanin kosulsuz calistiginin isaretidir.
    it('TON hesabi zaten TON agindayken currentNetwork YENIDEN YAZILMAZ', async () => {
        const tonBundled = ALL_CHAINS.find((c) => Number(c.chainId) === -239)
        storage.currentNetwork = tonBundled
        storage.active_account = TON_ACCOUNT

        const network = await freshStore()

        expect(network.currentNetwork.chainId).toBe(-239)
        const writes = chrome.storage.local.set.mock.calls.filter(([obj]) => 'currentNetwork' in obj)
        expect(writes).toHaveLength(0)
    })
})

// Desteklenen aglar 10 zincire daraltildi (Avalanche ve Arbitrum Sepolia cikarildi).
// Daralma, DISKTE artik desteklenmeyen bir zincir birakir: dogrulanmazsa kullanici
// listede hic gorunmeyen bir agda acilir — bakiyeler bos, ag secici o zinciri
// gostermez, ATS ucreti yok ve geri donusun yolu belli degildir.
describe('desteklenmeyen zincirler', () => {
    const AVALANCHE = {
        name: 'Avalanche C-Chain', chainId: 43114,
        rpc: [{ url: 'https://avax.example' }]
    }

    it('diskte kalmis desteklenmeyen ag varsayilana duser', async () => {
        storage.currentNetwork = AVALANCHE
        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.chainId).toBe(1)
        expect(network.rpcChainId).toBe(1)
    })

    it('desteklenmeyen aga GECILEMEZ (dapp switchEthereumChain dahil)', async () => {
        const network = await freshStore()
        await network.setCurrentNetwork(ARBITRUM)
        await network.setCurrentNetwork(AVALANCHE)

        expect(network.currentNetwork.chainId).toBe(42161) // degismedi
        expect(network.rpcChainId).toBe(42161)
    })

    it('getNetworkByChainId desteklenmeyen zinciri COZMEZ', async () => {
        const network = await freshStore()
        expect(network.getNetworkByChainId(43114)).toBeUndefined()
        expect(network.getNetworkByChainId(421614)).toBeUndefined()
    })

    it('desteklenen 10 zincirin hepsi cozulur', async () => {
        const network = await freshStore()
        for (const id of [1, 56, 10, 100, 42220, 5000, 8453, 25, 42161, 137]) {
            expect(network.getNetworkByChainId(id)).toBeTruthy()
        }
    })
    // Bellekteki duzeltme DEPOYA da yazilmali. Yazilmazsa store Ethereum gosterirken
    // depo hala eski zinciri tutar ve depodan DOGRUDAN okuyan yerler ayrisir:
    // dappFunctions handleGetChainId bagli dapp'e eski chainId'yi bildirir, App.vue
    // ve ConnectDapp da eski agi gorur. Arayuz bir zincir, dapp baska bir zincir.
    it('desteklenmeyen ag DEPODA da varsayilanla degistirilir', async () => {
        storage.currentNetwork = AVALANCHE
        const network = await freshStore()
        await network.initializeCurrentNetwork()

        expect(network.currentNetwork.chainId).toBe(1)
        expect(storage.currentNetwork?.chainId).toBe(1)
    })

    it('desteklenen ag diske GEREKSIZ yazilmaz', async () => {
        storage.currentNetwork = ARBITRUM
        const network = await freshStore()
        chrome.storage.local.set.mockClear()
        await network.initializeCurrentNetwork()

        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })
})

describe('isSupportedChain — Solana', () => {
    // Number('solana-mainnet') NaN'dir ve NaN === NaN false'tur: duzeltilmezse
    // Solana HIC desteklenmiyor sayilir ve kullanici acilista Ethereum'a duser.
    it('metin kimlikli Solana desteklenir', () => {
        const store = networkStore()
        expect(store.isSupportedChain('solana-mainnet')).toBe(true)
    })

    it('bilinmeyen metin kimlik desteklenmez', () => {
        const store = networkStore()
        expect(store.isSupportedChain('bitcoin-mainnet')).toBe(false)
    })

    it('EVM kimlikleri hala desteklenir', () => {
        const store = networkStore()
        expect(store.isSupportedChain(1)).toBe(true)
        expect(store.isSupportedChain('56')).toBe(true)
        expect(store.isSupportedChain(999999)).toBe(false)
    })
})

describe('TON secildiginde rpc', () => {
    it('bayat EVM ucu TEMIZLENIR', async () => {
        const store = networkStore()

        await store.setCurrentNetwork({ chainId: 1, name: 'Ethereum', rpc: [{ url: 'https://ethereum-rpc.publicnode.com' }] })
        expect(store.rpc).toBe('https://ethereum-rpc.publicnode.com')

        const ton = store.getNetworkByChainId(-239)
        expect(ton, 'TON kaydi yok').toBeTruthy()
        await store.setCurrentNetwork(ton)

        // Bayat kalirsa TON'dayken EVM zincirinden okuma yapan kod sessizce calisir.
        expect(store.rpc).toBeNull()
        expect(store.rpcChainId).toBe(-239)
    })

    it('TON dan EVM e donunce rpc yeniden kurulur', async () => {
        const store = networkStore()
        await store.setCurrentNetwork(store.getNetworkByChainId(-239))
        expect(store.rpc).toBeNull()

        await store.setCurrentNetwork({ chainId: 56, name: 'BNB', rpc: [{ url: 'https://bsc-dataseed.bnbchain.org' }] })
        expect(store.rpc).toBe('https://bsc-dataseed.bnbchain.org')
        expect(store.rpcChainId).toBe(56)
    })
})

describe('adoptNetwork -- BASKA panelde yapilan ag degisimini benimseme', () => {
    // Kapatilan hata: paneller arasi kopru (utils/uiSync.js) `network.currentNetwork = yeni`
    // diyerek agin YARISINI senkronluyordu. `rpc` onceki zincirin ucunda kaliyor,
    // `rpcChainId` da oyle -- ve onlari duzeltecek kimse yok (App.vue'nun reconnect'i
    // yalnizca baglanti KOPUNCA kosar, eski uc ise saglikli). Sonuc: B paneli YENI
    // agin adini ONCEKI zincirin bakiyelerinin ustunde gosteriyordu.
    it('zinciri VE rpc/rpcChainId ciftini BIRLIKTE gunceller', async () => {
        const store = await freshStore()
        await store.setCurrentNetwork(ETHEREUM)
        expect(store.rpc).toBe('https://eth-1.example')

        store.adoptNetwork(ARBITRUM)

        expect(store.currentNetwork.chainId).toBe(42161)
        expect(store.rpc).toBe('https://arb-1.example')
        expect(store.rpcChainId).toBe(42161)
    })

    // setCurrentNetwork'ten TEK farki: degisim zaten DISKTEN geldi, geri yazmak
    // sonsuz bir ping-pong baslatirdi.
    it('diske GERI YAZMAZ', async () => {
        const store = await freshStore()
        await store.setCurrentNetwork(ETHEREUM)
        chrome.storage.local.set.mockClear()

        store.adoptNetwork(ARBITRUM)

        expect(chrome.storage.local.set).not.toHaveBeenCalled()
    })

    it('TON benimsenince bayat EVM ucu TEMIZLENIR', async () => {
        const store = await freshStore()
        await store.setCurrentNetwork(ETHEREUM)
        expect(store.rpc).toBe('https://eth-1.example')

        const ton = store.getNetworkByChainId(-239)
        expect(ton, 'TON kaydi yok').toBeTruthy()
        store.adoptNetwork(ton)

        expect(store.rpc).toBeNull()
        expect(store.rpcChainId).toBe(-239)
    })

    it('desteklenmeyen zinciri yok sayar (currentNetwork bozulmaz)', async () => {
        const store = await freshStore()
        await store.setCurrentNetwork(ETHEREUM)

        store.adoptNetwork({ chainId: 999999, name: 'Sahte', rpc: [{ url: 'https://kotu.example' }] })

        expect(store.currentNetwork.chainId).toBe(1)
        expect(store.rpc).toBe('https://eth-1.example')
    })

    it('null zinciri yok sayar', async () => {
        const store = await freshStore()
        await store.setCurrentNetwork(ETHEREUM)

        store.adoptNetwork(null)

        expect(store.currentNetwork.chainId).toBe(1)
    })
})
