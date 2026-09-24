import { defineStore } from "pinia"
import { ref } from "vue"
import { ALL_CHAINS } from '../data/chains'
// UC AYRI SORU, UC AYRI MODUL — birlestirilmemeleri BILEREK:
//   vm.js         : kimlik karsilastirmasi + rpc listesi (Solana kaydinda `rpc` YOK)
//   chainKind.js  : zincirin TIPI (TON kaydi `kind` tasir, `vm` alani YOKTUR)
//   accountKind.js: HESABIN hangi zincirlerde kullanilabilecegi
// Tek alana bakan bir kontrol otekini yanlis siniflandirir; bu yuzden her soru
// kendi kapisindan sorulur.
import { isSameChainId, rpcUrlsOf } from '../utils/vm'
import { isEvm, isTon } from '../utils/chainKind'
import { accountSupportsChain, chainsForAccount } from '../utils/accountKind'

// Cuzdanin DESTEKLEDIGI zincirler. Eskiden burada chain-list.json (~2000 kayitlik tam
// EVM kaydi) vardi: getNetworkByChainId desteklenmeyen bir zinciri de cozebiliyordu, yani
// bir dapp'in chainId'si ya da diskteki eski bir secim, listede hic gorunmeyen bir aga
// gecirebiliyordu. Cozumleme artik desteklenen listeyle sinirli.
export const networkStore = defineStore('networkStore', () => {
    const networks = ref(ALL_CHAINS)
    // Karsilastirma isSameChainId uzerinden: Number('solana-mainnet') NaN'dir ve
    // NaN === NaN false'tur, yani sayisal karsilastirma Solana'yi HIC desteklenmiyor
    // sayardi — kullanici acilista sessizce Ethereum'a duserdi.
    const isSupportedChain = (chainId) =>
        ALL_CHAINS.some((c) => isSameChainId(c.chainId, chainId))
    const currentNetwork = ref(null)
    const rpc = ref(null)
    // `rpc`nin hangi zincire ait oldugu. rpc, currentNetwork'ten TUREMEZ (ayri bir ref)
    // ve findFastestRPC gecikmeli calisir; bu alan olmadan "rpc guncel mi" sorusu
    // cevaplanamiyor ve bakiyeler yanlis zincirden okunuyordu.
    const rpcChainId = ref(null)

    // Zincir kaydinin rpc alani hem dizi hem nesne olabiliyor (repairNetworkData);
    // Solana kaydinda ise HIC YOK. rpcUrlsOf her uc durumu da karsilar.
    const firstRpcUrl = (chain) => rpcUrlsOf(chain)[0] || null

    // findFastestRPC bitince cagrilir; hangi zincir icin secildigini de kaydeder.
    const setRpc = (url, chainId) => {
        if (!url) return
        rpc.value = url
        rpcChainId.value = chainId ?? currentNetwork.value?.chainId ?? null
    }

    // TON'un istemci tarafinda RPC ucu YOK (erisim backend proxy'sinden). Bu durumda
    // rpc BOSALTILMALI: `setRpc` falsy url'de erken cikiyor, yani hicbir sey yapilmazsa
    // eski EVM zincirinin ucu bellekte kalir ve TON'dayken o zincirden okuma yapan
    // kod yollari sessizce calismaya devam eder.
    const clearRpc = (chainId) => {
        rpc.value = null
        rpcChainId.value = chainId ?? currentNetwork.value?.chainId ?? null
    }

    const defaultNetwork = {
        "name": "Ethereum",
        "chain": "ETH",
        "icon": "ethereum",
        "rpc": [
            { "url": "https://ethereum-rpc.publicnode.com" }
        ],
        "features": [
            {
                "name": "EIP155"
            },
            {
                "name": "EIP1559"
            }
        ],
        "faucets": [],
        "nativeCurrency": {
            "name": "Ethereum",
            "symbol": "ETH",
            "decimals": 18
        },
        chainSlug: 'ethereum',
        "infoURL": "https://ethereum.org",
        "shortName": "eth",
        "chainId": 1,
        logoURI: '/chains/1.png'
    }

    // Initialize current network from storage
    const initializeCurrentNetwork = async () => {
        let loaded
        try {
            const result = await chrome.storage.local.get('currentNetwork')
            // Diske null yazilmis olabilir (eski surumler); defaultNetwork'e duser.
            //
            // Desteklenen aglar daraldiginda (or. Avalanche kaldirildi) diskte ARTIK
            // DESTEKLENMEYEN bir zincir kalir. Dogrulanmazsa kullanici listede hic
            // gorunmeyen bir agda acilir: bakiyeler bos, ag secici o zinciri gostermez,
            // ATS ucreti yok. Bu durumda varsayilana dusulur.
            const stored = result.currentNetwork
            const usable = stored?.chainId && isSupportedChain(stored.chainId)

            // Zincir kaydi diske TAMAMEN yazilir (rpc listesi dahil). Oldugu gibi geri
            // yuklenirse paketle gelen RPC duzeltmeleri MEVCUT KURULUMLARA ULASMAZ:
            // App.vue findFastestRPC'yi diskten gelen listeyle calistirir ve kullanici
            // eski ucta kalir. 2026-08-05: publicnode uclari eth_getTransactionReceipt'i
            // ucretli token arkasina aldi, basarili islemler istemcide "dogrulanamadi"
            // oldu; liste guncellendi ama diskteki kayit eski RPC'yi tutuyordu.
            // Depodan yalnizca SECIM (chainId) gecerlidir; kaydin kendisi paketten gelir.
            // isSameChainId: Number(c.chainId)===Number(stored.chainId) Solana'da
            // NaN===NaN (false) uretip `bundled`i hep null birakirdi — diskteki HAM
            // Solana kaydi asla paketle tazelenmezdi (bugun zararsiz, rpc zaten yok;
            // Task 9 kayda alan eklerse sessiz bir bug'a donusur).
            const bundled = usable
                ? ALL_CHAINS.find((c) => isSameChainId(c.chainId, stored.chainId))
                : null
            loaded = bundled || (usable ? stored : defaultNetwork)

            // Duzeltme DISKE de yazilir. Yalnizca bellekte duzeltmek arayuzu ve depoyu
            // ayristirir: depodan DOGRUDAN okuyan yerler eski zinciri gormeye devam eder
            // (dappFunctions.handleGetChainId bagli dapp'e eski chainId'yi bildirir,
            // App.vue ve ConnectDapp de oyle). Kullanici Ethereum gorurken dapp baska
            // bir zincirde islem hazirlar.
            if (!usable && stored !== undefined) {
                await chrome.storage.local.set({ currentNetwork: defaultNetwork })
            } else if (bundled && JSON.stringify(stored) !== JSON.stringify(bundled)) {
                // Tazelenen kayit DISKE de yazilir; aksi halde depodan DOGRUDAN okuyan
                // yerler eski RPC'yi gormeye devam eder.
                await chrome.storage.local.set({ currentNetwork: bundled })
            }

            // HESAP-AG UZLASTIRMASI (spec §9.3) — ACILISTA.
            //
            // Ag kilidi bugune kadar YALNIZCA iki yerde duruyordu: `applyNetworkChange`
            // (ag degisince) ve `Header.changeAccount` (hesap degisince). ICE AKTARMA
            // yolu IKISINDEN DE gecmez — ImportPhrases.vue ve CreatePassword2.vue
            // `active_account`i dogrudan yazip 'ready' der. Kullanici Ethereum'dayken
            // bir TON ifadesi aktarirsa diske "TON hesabi + EVM agi" cifti yazilir ve
            // spec'in adiyla andigi ekranda kalir: "ekranda Ethereum yaziyor ama hicbir
            // sey yapamiyor".
            //
            // Kapi neden ICE AKTARMA EKRANINA degil de BURAYA kondu: iki giris noktasi
            // var (mevcut cuzdana ekleme / ilk kurulum) ve ikisi de ayri kod. Ekrana
            // konsaydi iki kopya olurdu ve ucuncu bir giris noktasi yarin yine
            // unutulurdu. Burada duran kapi her acilista kendini duzeltir — diskte
            // ZATEN olusmus bozuk cift de dahil.
            //
            // FAIL-OPEN: `active_account` okunamazsa accountSupportsChain true doner
            // ve hicbir sey degismez (accountKind.js'in acik kurali).
            const { active_account } = await chrome.storage.local.get('active_account')
            if (!accountSupportsChain(active_account, loaded)) {
                // HEDEF SABIT DEGIL, HESABIN KENDISINDEN gelir. Burada sabit TON
                // yazmak, kapi cift yonlu oldugu anda TERS calisirdi: TON'a park
                // etmis bir EVM hesabi her acilista TON'a GERI yazilirdi.
                const target = chainsForAccount(active_account, ALL_CHAINS)[0]
                if (target) {
                    loaded = target
                    // Diske de yazilir: depodan DOGRUDAN okuyan yerler (dappFunctions,
                    // App.vue, ConnectDapp) aksi halde eski zinciri gormeye devam eder.
                    await chrome.storage.local.set({ currentNetwork: target })
                }
            }
        } catch (error) {
            console.error('Error loading current network from storage:', error)
            loaded = defaultNetwork
        }

        // Bu cagri store olusturulurken AWAIT EDILMEDEN baslatiliyor. Cevap gelene
        // kadar kullanici ag degistirmis olabilir; gec gelen bu sonuc onun secimini
        // ezmemeli.
        if (currentNetwork.value) return

        currentNetwork.value = loaded

        // rpc'yi bos birakmak yerine dogru zincirin ilk RPC'sine ayarla; App.vue'daki
        // izleyici birazdan en hizlisina yukseltecek. TON'un istemci tarafinda RPC ucu
        // YOK (erisim backend proxy'sinden) — burada firstRpcUrl zaten null doner ama
        // clearRpc rpcChainId'yi de dogru zincire cekerek niyeti acikca belirtir.
        // Solana ACILISTA da clearRpc'den GECMEZ; gerekcesi setCurrentNetwork'te.
        if (isTon(loaded)) {
            clearRpc(loaded.chainId)
        } else {
            const fallback = firstRpcUrl(loaded)
            if (fallback) setRpc(fallback, loaded.chainId)
        }
    }

    // Set current network and save to storage
    const setCurrentNetwork = async (network) => {
        // null/gecersiz zincir KABUL EDILMEZ. Bridge'in reverse dugmesi hedef zincir
        // secilmeden basildiginda buraya null geliyordu; currentNetwork null olarak
        // diske de yaziliyor ve sonraki her `currentNetwork.chainId` erisimi
        // TypeError atarak tum arayuzu bozuyordu.
        if (!network || !network.chainId) {
            console.warn('setCurrentNetwork: gecersiz zincir yok sayildi', network)
            return
        }

        // Desteklenmeyen zincire gecilemez. Bu yol dapp'in wallet_switchEthereumChain
        // istegiyle de cagriliyor; dogrulanmazsa bir dapp cuzdani listede olmayan bir
        // aga surukleyebilir.
        if (!isSupportedChain(network.chainId)) {
            console.warn('setCurrentNetwork: desteklenmeyen zincir', network.chainId)
            return
        }

        try {
            currentNetwork.value = network

            // Zincir degisir degismez rpc de YENI zincire cekilir. Cagiranlar rpc'yi
            // findFastestRPC bittikten sonra guncelliyor; o ana kadar (yuzlerce ms)
            // rpc eski zinciri gosterdigi icin bakiye/gas kontrolleri yanlis zincirden
            // okunuyordu. Buradaki ilk RPC gecici ama DOGRU zincire aittir.
            //
            // TON'a gecildiginde ise rpc listesi BOS ve `setRpc` falsy url'de erken
            // cikiyor — hicbir sey yapilmazsa ONCEKI EVM zincirinin ucu bellekte kalir.
            // Bayat bir RPC, TON'dayken EVM zincirinden okuma yapan kod yollarina
            // sessizce yem olur; bu yuzden acikca temizlenir.
            //
            // KAPI SOLANA'YA GENISLETILMEDI (bilincli, birlestirme karari). Solana'da
            // `rpcUrlsOf` zaten [] doner, yani `setRpc` cagrilmaz ve `network.rpc`
            // onceki EVM zincirinde BAYAT kalir. Solana dali bu DEGISMEZIN uzerine
            // kuruldu: Home.vue'nun bakiye izleyicisi tam bu yuzden
            // `[network.rpc, currentNetwork.chainId]` ciftini izliyor (Solana'ya
            // gecince `network.rpc` DEGISMEZ) ve butun Solana okuma yollari zaten
            // chainVm dalinin ARKASINDA. Kapiyi `chainVm(network) !== 'evm'` yapmak
            // dogru yon ama Solana ekranlarinin elle dogrulanmasini gerektirir;
            // birlestirmede TON davranisi AYNEN, Solana davranisi da AYNEN korundu.
            if (isTon(network)) {
                clearRpc(network.chainId)
            } else {
                const fallback = firstRpcUrl(network)
                if (fallback) setRpc(fallback, network.chainId)
            }

            await chrome.storage.local.set({ currentNetwork: network })

            // SON EVM ZINCIRI HATIRLANIR -- yalnizca hedef EVM ise.
            //
            // NEDEN: kullanici GRAM/Solana'dayken bir EVM dapp'ine baglanmak
            // isterse onay ekrani "su EVM agina gec ve baglan" diyor
            // (ConnectDapp.vue + utils/evmReturnChain.js). "Su" sorusunun dogru
            // cevabi kullanicinin GELDIGI zincirdir: BSC kullanicisini her
            // seferinde Ethereum'a atmak, dapp'in hemen ardindan
            // `wallet_switchEthereumChain` gondermesine ve kullanicinin ARKA
            // ARKAYA IKI onay ekrani gormesine yol acardi.
            //
            // KOSUL SART: kosulsuz yazim TON'un -239'unu ya da Solana'nin METIN
            // kimligini "son EVM zinciri" diye kaydeder ve donus dugmesi
            // kullaniciyi cikmak istedigi agin ta kendisine goturur. Okuma
            // tarafinda AYRICA `isEvm` suzgeci var (evmReturnChain) -- iki
            // katman, cunku bu kayit DISKTE KALICI ve eski/bozuk bir deger
            // tasiyor olabilir.
            //
            // AYRI ANAHTAR, `currentNetwork`un icinde bir alan DEGIL: bu deger
            // aktif agin bir OZELLIGI degil, aktif agdan BAGIMSIZ bir hatira --
            // aktif ag TON'ken bile gecerli olmasi gereken tek sey o.
            if (isEvm(network)) {
                await chrome.storage.local.set({ last_evm_chain_id: network.chainId })
            }
        } catch (error) {
            console.error('Error saving current network to storage:', error)
        }
    }

    /**
     * BASKA bir panelde yapilmis ag degisimini BENIMSE (paneller arasi senkron,
     * utils/uiSync.js).
     *
     * `setCurrentNetwork`ten TEK farki diske YAZMAMASIDIR: degisim zaten diskten
     * geldi, geri yazmak sonsuz bir ping-pong baslatirdi. Geri kalan is AYNEN
     * yapilir ve yapilmak ZORUNDADIR.
     *
     * KAPATILAN HATA: uiSync `network.currentNetwork = yeni` diyerek YALNIZCA
     * zincir kaydini kopyaliyordu. `rpc` ONCEKI zincirin ucunda kaliyor ve onu
     * duzeltecek kimse yok: App.vue'nun `reconnect()`i sadece `checkConnection()`
     * BASARISIZ olunca kosar, eski uc ise saglikli. Bu arada Home.vue'nun
     * izleyicisi chainId degisimiyle atesleniyor ve bakiyeleri BAYAT uctan
     * okuyor -- yani B paneli YENI agin adini ONCEKI zincirin verisinin
     * ustunde gosteriyordu. `rpcChainId` ("bu alan olmadan bakiyeler yanlis
     * zincirden okunuyordu") da guncellenmiyordu.
     */
    const adoptNetwork = (network) => {
        if (!network || !network.chainId) return
        if (!isSupportedChain(network.chainId)) {
            console.warn('adoptNetwork: desteklenmeyen zincir', network.chainId)
            return
        }

        currentNetwork.value = network

        // setCurrentNetwork ile AYNI kural, AYNI gerekce (oradaki uzun nota bak):
        // TON'da rpc listesi BOS oldugu icin `setRpc` erken cikar ve onceki EVM
        // ucu bellekte kalirdi; bu yuzden acikca temizlenir. Solana'da kapi
        // BILEREK genisletilmedi -- Home.vue'nun bakiye izleyicisi `network.rpc`nin
        // Solana'ya gecerken DEGISMEMESI uzerine kurulu.
        if (isTon(network)) {
            clearRpc(network.chainId)
        } else {
            const fallback = firstRpcUrl(network)
            if (fallback) setRpc(fallback, network.chainId)
        }
    }

    // Get network by chain ID
    const getNetworkByChainId = (chainId) => {
        return networks.value.find(network => network.chainId === chainId)
    }

    // Initialize the store
    initializeCurrentNetwork()

    return {
        networks,
        currentNetwork,
        defaultNetwork,
        rpc,
        rpcChainId,
        setRpc,
        clearRpc,
        setCurrentNetwork,
        adoptNetwork,
        getNetworkByChainId,
        isSupportedChain,
        initializeCurrentNetwork
    }
})