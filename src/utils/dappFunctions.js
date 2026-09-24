import { isEvm } from './chainKind'
import { chainVm, requireEvmVm } from './vm'
import { accountHasEvm } from './accountKind'
import { SWITCH_CHAIN_TYPE, alreadyOnChain, findSwitchTarget, parseRequestedChainId } from './switchChainRequest'

export const pendingRequests = new Map()

/**
 * EVM DISI AG AKTIFKEN DONECEK HATA KODU.
 *
 * EIP-1193'te "zincire bagli degil"in kodu 4901'dir ve istemci kutuphaneleri
 * (wagmi/viem/ethers) onu TANIR: dapp "yanlis agdasin" der. Genel -32603
 * "Internal JSON-RPC error" demektir, yani "cuzdan bozuldu" -- dapp kullaniciya
 * YANLIS sebebi gosterir ve kullanici agini degistirmesi gerektigini ogrenemez.
 *
 * Bu ayrim `eth_chainId` icin ZATEN dogru yapiliyordu (handleGetChainId'deki
 * 4901 dali ve oradaki uzun not). Kardes kapilar -- eth_requestAccounts,
 * eth_sendTransaction, personal_sign -- requireEvmVm'in firlattigi AYNI hatayi
 * catch'te -32603'e dusuruyordu. Ayni kosul, ayni cuzdan, IKI FARKLI kod:
 * canli olculdu (TON aktifken eth_chainId 4901, eth_requestAccounts -32603).
 *
 * Yalnizca KOD eslenir; mesaj cagiranin gonderdigi gibi kalir.
 */
export const dappErrorCode = (error) =>
    (error && error.message === 'CHAIN_NOT_EVM') ? 4901 : -32603

let activeWindowId = null
let isOpeningWindow = false

chrome.windows.onRemoved.addListener((windowId) => {
    // Clear active window tracker
    if (activeWindowId === windowId) {
        activeWindowId = null
    }

    for (const [requestId, requestData] of pendingRequests.entries()) {
        if (requestData.windowId === windowId) {
            requestData.sendResponse({ error: { code: 4001, message: "User closed the window." } })
            pendingRequests.delete(requestId)
            chrome.storage.local.remove('current_request')
            break
        }
    }
})

async function closeExistingWindow() {
    // Close the active window if it exists
    if (activeWindowId !== null) {
        const windowIdToClose = activeWindowId
        activeWindowId = null

        // Reject all pending requests tied to this window
        for (const [requestId, requestData] of pendingRequests.entries()) {
            if (requestData.windowId === windowIdToClose) {
                requestData.sendResponse({ error: { code: 4001, message: "Request replaced by a new one." } })
                pendingRequests.delete(requestId)
            }
        }

        try {
            await chrome.windows.get(windowIdToClose) // Check if window still exists
            await chrome.windows.remove(windowIdToClose)
        } catch (e) {
            // Window already closed
        }
    }
}

/**
 * DISA ACIK: tonDappFunctions.js de bu pencereyi kullanir.
 *
 * IKINCI BIR PENCERE YONETICISI ACILMAZ. `activeWindowId`, `isOpeningWindow`
 * muteksi ve `chrome.windows.onRemoved` dinleyicisi bu modulde ve MODUL
 * KAPSAMINDA; ayri bir kopya, EVM ve TON isteklerinin birbirinin penceresini
 * kapatmasina ve onRemoved'in YANLIS istegi reddetmesine yol acardi.
 */
export async function openApprovalWindow(requestId, sendResponse, currentRequest) {
    // Mutex: prevent concurrent window creation
    if (isOpeningWindow) {
        sendResponse({ error: { code: 4001, message: "Another request is being processed." } })
        return
    }

    isOpeningWindow = true

    try {
        // Close any existing approval window first
        await closeExistingWindow()

        // current_request ANCAK mutex alindiktan sonra yazilir: pencere
        // acilirken gelen ikinci istek hem reddedilir hem de acilmakta olan
        // pencerenin gosterecegi kaydi EZEMEZ. (Eski sira handler'da once
        // yazip sonra mutex'e gelmekti; B'nin verisi A'nin penceresinde
        // gorunup A'nin id'siyle eslesmeyen bir istek yurutulebiliyordu.)
        await chrome.storage.local.set({ current_request: currentRequest })

        const popupWidth = 360
        const popupHeight = 600

        let left = undefined
        let top = undefined
        try {
            const lastWindow = await chrome.windows.getLastFocused()
            if (lastWindow && lastWindow.width && lastWindow.left !== undefined) {
                left = lastWindow.left + lastWindow.width - popupWidth
                top = lastWindow.top
            }
        } catch (e) {
        }

        const window = await chrome.windows.create({
            url: chrome.runtime.getURL('src/popup/index.html#window'),
            type: 'popup',
            width: popupWidth,
            height: popupHeight,
            left,
            top,
            focused: true
        })

        activeWindowId = window.id
        pendingRequests.set(requestId, { sendResponse, windowId: window.id })
    } catch (error) {
        console.error("Window could not open", error)
        // Yazilmis kayit pencereye baglanamadan kalirsa bir sonraki popup
        // acilisi olu bir onay ekranina duser.
        await chrome.storage.local.remove('current_request').catch(() => {})
        sendResponse({ error: { code: -32603, message: "Failed to open approval window." } })
    } finally {
        isOpeningWindow = false
    }
}

/**
 * Istegin kimligi GONDEREN CERCEVEDEN turetilir, ust sekmeden DEGIL.
 *
 * Content script all_frames:true ile calisiyor: `sender.tab.url` her zaman UST
 * sayfayi gosterir. Iframe'deki bir dapp'in istegi ust sayfaya atfedilirse onay
 * ekrani guvenilir sitenin adini/ikonunu gosterir, oturum o siteye yazilir ama
 * yanit (hesaplar/imza) GERCEKTE iframe'e teslim edilir. `sender.origin` gercek
 * cercevenin origin'idir (sandbox'li cercevede 'null' metni gelebilir, o
 * durumda cerceve URL'sine dusulur).
 */
export function resolveSenderOrigin(sender) {
    for (const raw of [sender?.origin, sender?.url, sender?.tab?.url]) {
        if (!raw || raw === 'null') continue
        try {
            const u = new URL(raw)
            return { origin: u.origin, hostname: u.hostname }
        } catch (e) {}
    }
    return { origin: 'Unknown', hostname: 'Unknown' }
}

/**
 * Bir origin'in isteyebilecegi hesabi cozer; yetki yoksa null.
 *
 * eth_sendTransaction/personal_sign yalniz BAGLI origin'lerden ve o origin'e
 * VERILMIS hesaplar icin kabul edilir; aksi halde cuzdana hic baglanmamis bir
 * sayfa imza penceresi actirabilir (phishing) ve bagli bir dapp kullanicinin
 * kendisine verilmemis BASKA hesabindan islem hazirlatabilir. Adres verilmezse
 * dapp'e verilmis ILK hesap kullanilir -- o anki aktif hesaba DUSULMEZ, cunku
 * aktif hesap dapp'in hic gormedigi bir hesap olabilir.
 */
function grantedAccountFor(dapps, hostname, requestedAddress) {
    const accounts = dapps?.[hostname]?.accounts
    if (!Array.isArray(accounts) || accounts.length === 0) return null
    if (requestedAddress === undefined || requestedAddress === null || requestedAddress === '') return accounts[0]
    const wanted = String(requestedAddress).toLowerCase()
    return accounts.find(a => typeof a === 'string' && a.toLowerCase() === wanted) ?? null
}

const UNAUTHORIZED = { code: 4100, message: 'The requested account and/or method has not been authorized by the user.' }

/**
 * EVM dapp sinirindan gececek adres bicimi. `0x` oneki ARANIR, tam hex/uzunluk
 * DEGIL: burada sorulan soru "bu gecerli bir EVM adresi mi" degil, "bu bir EVM
 * adresi mi yoksa bir TON adresi mi". TON'un dort friendly bicimi de
 * (UQ/EQ/0Q/kQ) ve raw bicimi (0:hex) `0x` ile BASLAMAZ; daha sert bir
 * suzgec, mesru ama farkli yazilmis EVM kayitlarini da sessizce dusururdu.
 *
 * DIKKAT -- adres KARSILASTIRMASI hala harf duyarsizdir (grantedAccountFor):
 * `UQ...` metinleri harf DUYARLIDIR ve o karsilastirmadan gecirilmemeleri
 * gerekir; bu suzgec onlarin oraya HIC ulasmamasini saglar.
 *
 * EXPORT: bu ayni suzgec Header.vue (dapp izin modali "Kaydet") ve
 * DappPermissions.vue'de (ayni ekranin ayari sayfasi) BIREBIR kopyalanmisti.
 * Tek kaynaktan gelmesi, uc kopyanin ayrisip biri ('0X' gibi bir yazim
 * varyasyonu) sessizce degismesini imkansiz kilar.
 */
export const isEvmDappAddress = (value) => typeof value === 'string' && value.startsWith('0x')

export async function handleConnectWallet(message, sender, sendResponse) {
    try {
        const requestId = crypto.randomUUID()
        const { origin, hostname } = resolveSenderOrigin(sender)

        // Check if the dapp is already connected
        const { dapps = {}, active_account, currentNetwork } = await chrome.storage.local.get(['dapps', 'active_account', 'currentNetwork'])

        // IKI AYRI KAPI, IKI AYRI SORU (birlestirme notu): asagidaki zincir kapisi
        // "aktif AG EVM mi" diye sorar, asagidaki hesap turu kapisi ise "aktif
        // HESAP eski/legacy TON hesabi mi". Ikisi de gerekli ve biri otekini kapsamaz:
        // EVM aginda duran bir TON hesabi birinci kapidan gecer, EVM disi bir agda
        // duran EVM hesabi ikinciden.
        //
        // Arayuz dapp baglanti girisini EVM disi aglarda gizler (Header.vue,
        // ConnectDapp.vue) ama bir dapp eth_requestAccounts'u HER ZAMAN
        // gonderebilir. Bu cuzdanda dapp oturumu TEK aktif zincire baglidir (bkz.
        // CHAIN_CHANGED/eth_chainId); Solana ya da TON aktifken "baglandi" demek,
        // dapp'e temsil edemeyecegimiz bir EVM oturumu vaat etmek olurdu.
        //
        // KOD INCELEMESI (F1): `currentNetwork` DISKE HENUZ YAZILMAMIS olabilir --
        // App.vue yalniz ILK popup acilisinda 'eth' varsayilanini yazar (onMounted).
        // Kullanici onboarding'i bitirip popup'i HIC ACMADAN dogrudan bir dapp'e
        // giderse bu yazim hic olusmaz ve `currentNetwork` burada `undefined` gelir.
        // `requireEvmVm(undefined)` KOSULSUZ CHAIN_NOT_EVM firlatirdi -- taze
        // kurulmus, hala varsayilan Ethereum'da olan bir cuzdan HER dapp cagrisina
        // hata donerdi. Kayit YOKSA varsayilan zaten EVM'dir (bu kod tabaninin
        // heryerdeki varsayilani, bkz. vm.js chainVm); kapi yalniz kayit VARKEN VE
        // EVM DISINA (Solana / TON) cozulurken kapanir.
        //
        // KOD INCELEMESI (turu 2): kapi requireEvmChain DEGIL requireEvmVm -- yani
        // UC NOKTASI SORULMAZ. eth_requestAccounts/eth_sendTransaction/eth_chainId
        // hicbiri aktif zincirin RPC'sine BAKMAZ (var olan bir adresi/kimligi
        // bildirir, onay penceresini acar). requireEvmChain kullanmak, `rpc` dizisi
        // BOS olan GERCEK bir EVM kaydinda uc yolu da CHAIN_NOT_EVM'e dusururdu --
        // Task 15 ONCESINDE bu kayitla dapp NORMAL calisiyordu ve evmGates.js'in
        // `dapp` bayragi da (arayuz tarafi) o kayitta ACIK diyor: iki katman AYNI
        // seyi soylemek ZORUNDA, aksi halde arayuz Dapp.vue'ye yonlendirirken
        // background AYNI kaydi reddediyordu.
        //
        // KAPI ARTIK FIRLATMIYOR, YOL DEGISTIRIYOR (kullanici bildirimi:
        // "cuzdan en son gram aginda kalmissa dapp ile evm'lere gecemiyor").
        //
        // ESKI DAVRANIS `requireEvmVm(currentNetwork)` idi: EVM disi agda istek
        // onay penceresi ACILMADAN 4901 ile duserdi. Red DOGRUYDU -- EVM disi bir
        // agda "baglandi" demek dapp'e temsil edemeyecegimiz bir oturum vaat
        // etmektir -- ama SESSIZDI: cuzdan hicbir sey gostermiyordu (pencere yok;
        // rozet/bildirim de yok, 'notifications' izni bilerek alinmadi). Kullanici
        // sorunun aktif ag oldugunu HICBIR YERDEN ogrenemiyordu. Ustelik ekip bu
        // durum icin bir aciklama ekranini (ConnectDapp.vue `tonBlocked` karti) ve
        // cevirisini (dapps.connect.ton_not_supported: "Baglanmak icin bir EVM
        // agina gecin") ZATEN yazmisti; o kart ULASILAMAZ olu koddu, cunku onu
        // gosterecek pencereyi acan satir (asagidaki openApprovalWindow) bu
        // kapidan SONRA geliyordu. Yani kapinin TASARLANMIS cikis yolu, kapinin
        // KENDISI yuzunden hic gorunmuyordu.
        //
        // DEGISMEYEN GUVENLIK DEGISMEZI: oturum HALA yalnizca EVM aginda kurulur.
        // Pencere aciliyor ama "Baglan" dugmesi CIZILMIYOR (ConnectDapp.vue
        // `baglanamaz`), yerinde "EVM agina gec ve baglan" duruyor ve `connect()`
        // icindeki `hexChainIdFor` kapisi aynen yerinde. Dapp'e EVM disi bir agda
        // ASLA basarili yanit donmez -- kullanici ya aga gecer ya reddeder.
        //
        // KARDES KAPILAR DEGISMEDI: sendTxDapp ve signMessageDapp EVM disi agda
        // HALA pencere acmadan reddeder. Onlarin ekranlari (Dapp.vue / Sign.vue)
        // EVM'e ozeldir ve "once aga gec" diye bir kurtarma yollari YOKTUR --
        // imzalanacak yuk zaten baska bir zincir icin kurulmustur.
        const zincirEngelli = !!currentNetwork && chainVm(currentNetwork) !== 'evm'

        // HESAP KAPISI (§8 R4). TON hesabinin EVM adresi YOKTUR: sunulursa dapp
        // bir TON adresini EVM adresi sanip islem hazirlar ve kullanici bunu
        // ancak "imzala"ya bastiginda ogrenir. Yukaridaki zincir kapisi BASKA
        // bir soru ("aktif ZINCIR EVM mi") ve bunu KAPSAMAZ: EVM aginda duran
        // bir TON hesabi oradan rahatca gecer.
        //
        // FAIL-OPEN, bilerek: kosul hesap eski/legacy `type:'ton'` ise reddeder,
        // yani turu bilinmeyen bir hesap gecer (§2.1'in null sozlesmesi). Kemer,
        // handleGetAccounts'un cikisindaki 0x suzgecidir.
        //
        // `accountHasTon` KULLANILAMAZ: kumeye gecince (accountKind.js,
        // 2026-09-10) o fonksiyon `type:'hd'` icin de `true` doner ve bu kapi
        // butun siradan EVM kullanicilarini (buyuk cogunluk) dapp baglantisindan
        // reddederdi -- oysa sorulan soru "hesap TON ailesini destekler mi"
        // DEGIL, "`active_account.address` GERCEKTEN bir EVM adresi mi".
        // Dogrudan tip kontrolu bu ayrimi koruyan tek yol.
        if (active_account?.type === 'ton') {
            sendResponse({ error: UNAUTHORIZED })
            return
        }

        // Adres karsilastirmasi HARF DUYARSIZ (grantedAccountFor): kayit kucuk
        // harfle, aktif hesap EIP-55 checksum'uyla tutulmus olabilir -- ayni
        // adrestir. Duyarli karsilastirma bagli dapp'e gereksiz onay penceresi acar.
        // (Eski, hesap turune bakan yerel kosul buradan KALKTI: yukaridaki
        // hesap turu kapisi ayni nufusu, kisayoldan da onay penceresinden de
        // once eliyor.)
        //
        // FIX 4 (kucuk bulgu, fix dalgasi): `isEvmDappAddress` KEMERI burada da
        // gerekli. Yukaridaki hesap turu kapisi FAIL-OPEN (§2.1) - turu
        // bilinmeyen bir hesap gecer. `grantedAccountFor`in harf-duyarsiz
        // karsilastirmasi bir `UQ...` metnini de eslestirebilir (o karsilastirma
        // TON adresleri icin hic tasarlanmadi, bkz. yukaridaki isEvmDappAddress
        // notu); kayitta (eski/bozuk bir yazimdan) boyle bir metin varsa ve aktif
        // hesabin adresi ayniysa bu hizli yol onu SUZGECSIZ EIP-1193 sonucu olarak
        // dondururdu. `0x` onekli olmayan bir adres artik onay penceresine
        // dusuyor; oradaki ConnectDapp'in `accountHasEvm` kapisi (§8 R4c) onu
        // fail-closed reddeder.
        //
        // `!zincirEngelli` SART: hizli yol EVM disi agda CALISMAMALI. Calissaydi
        // yukaridaki degismez ("EVM disi agda dapp'e asla basarili yanit donmez")
        // tam da en cok kullanilan yolda -- zaten bagli bir dapp'in yeniden
        // baglanma cagrisinda -- delinirdi: dapp bir EVM adresi alir, sonraki
        // eth_chainId/eth_sendTransaction cagrilari 4901 yer ve kullanici "bagli
        // ama hicbir sey calismiyor" durumunda kalirdi. Ustelik o dapp aga
        // gecilirken ZATEN `disconnect` almistir (background.js CHAIN_CHANGED
        // dali); ona sessizce "yine bagliyiz" demek iki katmani celiskiye sokar.
        if (!zincirEngelli && active_account && isEvmDappAddress(active_account.address) && grantedAccountFor(dapps, hostname, active_account.address)) {
            // Already connected: return success immediately
            sendResponse({ result: [active_account.address] })
            return
        }

        await openApprovalWindow(requestId, sendResponse, {
            type: 'CONNECT',
            id: requestId,
            favicon: sender.tab?.favIconUrl,
            origin: origin
        });

    } catch (error) {
        console.error('handleConnectWallet error:', error)
        sendResponse({ error: { code: dappErrorCode(error), message: error.message } })
    }
}

export async function sendTxDapp(message, sender, sendResponse) {
    try {
        // Dapp.vue (bu istegin onay ekrani) TAMAMEN EVM'e ozel: `currentNetwork.rpc[0].url`u
        // guard'siz okur. Arayuz eth_requestAccounts'u zaten EVM disi aglarda reddettigi icin
        // bu yol normalde hic tetiklenmez, ama BAGLANTI aktif ag Solana/TON'a gecmeden ONCE
        // kurulmus olabilir (dapps kaydi kalicidir) -- bu yuzden giriste AYRICA kontrol edilir.
        // Kayit YOKSA (bkz. handleConnectWallet'taki F1 notu) varsayilan EVM sayilir;
        // kapi orada anlatilan gerekceyle requireEvmVm'dir (uc noktasi sorulmaz).
        const { currentNetwork, dapps = {} } = await chrome.storage.local.get(['currentNetwork', 'dapps'])
        if (currentNetwork) requireEvmVm(currentNetwork)

        const requestId = crypto.randomUUID()
        const { origin, hostname } = resolveSenderOrigin(sender)
        const data = message.params[0]

        const granted = grantedAccountFor(dapps, hostname, data?.from)
        // 0x SUZGECI (§8 R4): kayitta duran bir `UQ...` metni bu yoldan gecerse
        // onay ekrani onu `from` olarak cizer ve imzalanacak bir sey uretilemez.
        // Kayitlarin nasil kirlenebildigi icin bkz. Header.vue/DappPermissions.vue/
        // ConnectDapp.vue -- ucu de bagimsiz yazicidir ve ucu de suzuluyor.
        if (!granted || !isEvmDappAddress(granted)) {
            sendResponse({ error: UNAUTHORIZED })
            return
        }

        await openApprovalWindow(requestId, sendResponse, {
            type: 'SEND_TX',
            id: requestId,
            origin: origin,
            favicon: sender.tab?.favIconUrl,
            txData: {
                from: data.from || granted,
                to: data.to,
                amount: data.value,
                data: data.data || '0x',
                // Dapp'in bildirdigi gas limiti: zincir tahmini basarisiz
                // oldugunda yayin icin TEK guvenli yedek (bkz. Dapp.vue send).
                gas: data.gas
            }
        });

    } catch (error) {
        console.error('sendTxDapp error:', error)
        sendResponse({ error: { code: dappErrorCode(error), message: error.message } })
    }
}

export async function signMessageDapp(message, sender, sendResponse) {
    try {
        // Karde$ handler'larla ayni kapi: Sign.vue de aktif ag uzerinden calisir
        // ve EVM disi agda acilan pencereyi App.vue bayat sayip siler -- kapisiz
        // birakmak dapp'in promise'ini askıda birakiyordu.
        const { currentNetwork, dapps = {} } = await chrome.storage.local.get(['currentNetwork', 'dapps'])
        if (currentNetwork) requireEvmVm(currentNetwork)

        const requestId = crypto.randomUUID()
        const { origin, hostname } = resolveSenderOrigin(sender)

        // personal_sign parametreleri [mesaj, adres]: imza params[1]'deki hesapla
        // atilmali. Bu adres saklanmazsa Sign.vue o anki AKTIF hesapla imzalar ve
        // dapp'e yanlis hesabin imzasi doner.
        const granted = grantedAccountFor(dapps, hostname, message.params?.[1])
        // 0x SUZGECI (§8 R4): sendTxDapp'teki AYNI kural, AYNI gerekce.
        if (!granted || !isEvmDappAddress(granted)) {
            sendResponse({ error: UNAUTHORIZED })
            return
        }

        await openApprovalWindow(requestId, sendResponse, {
            type: 'SIGN_MESSAGE',
            id: requestId,
            favicon: sender.tab?.favIconUrl,
            origin: origin,
            messageToSign: message.params[0],
            signWith: granted
        });

    } catch (error) {
        console.error('signMessageDapp error:', error)
        sendResponse({ error: { code: dappErrorCode(error), message: error.message } })
    }
}

/**
 * Dapp'e bildirilecek hex chainId. TON'da `null`.
 *
 * TON'un ag kimligi NEGATIF (-239): toString(16) '-ef' verir ve "0x-ef" bicimi
 * hicbir EIP-155 istemcisinin anlayabilecegi bir sey degil. Daha kotusu, dapp bunu
 * tanimadigi bir EVM zinciri sanip islem hazirlarsa kullanici imzalayamayacagi bir
 * onaya bakar. Bu yuzden TON'da chainId BILDIRILMEZ; TonConnect P3'te gelir.
 *
 * SOLANA'da da `null`, ama BOZULMA BICIMI FARKLIYDI: Solana'nin chainId'si METINDIR
 * ('solana-mainnet') ve String.prototype.toString radix argumanini YOKSAYAR, yani
 * `'solana-mainnet'.toString(16)` aynen geri doner ve dapp'e '0xsolana-mainnet'
 * gonderilirdi. Asagidaki `Number.isInteger` suzgeci ikisini de ayni yerde eler:
 * TON'u ISARETINDEN, Solana'yi sayi bile OLMAMASINDAN.
 */
export function hexChainIdFor(chain) {
    if (!isEvm(chain)) return null
    const id = Number(chain?.chainId)
    if (!Number.isInteger(id) || id <= 0) return null
    return '0x' + id.toString(16)
}

export async function handleGetChainId(sendResponse) {
    try {
        const { currentNetwork } = await chrome.storage.local.get('currentNetwork')
        const hexChainId = hexChainIdFor(currentNetwork)

        if (hexChainId) {
            sendResponse({ result: hexChainId })
            return
        }

        // EVM DISI ag secili (TON ya da Solana): dapp'e sahte bir EVM zinciri UYDURULMAZ.
        //
        // BIRLESTIRME NOTU -- yanit IKI DALDAN DA bir parca tasiyor:
        //   KOD 4901 (TON dali): EIP-1193'te "zincire bagli degil"in kodu budur ve
        //   istemci kutuphaneleri onu TANIR; genel 32603 tanimaz.
        //   MESAJ 'CHAIN_NOT_EVM' (Solana dali): bu kod tabaninda "bu zincir EVM degil"
        //   sorusunun TEK adi bu ve ayni ad requireEvmVm'den de cikiyor (utils/vm.js).
        //   Dapp'in gordugu metnin, cuzdanin baska yollarinda gordugu metinle ayni
        //   olmasi bir tesaduf degil: iki kapi AYNI soruya cevap veriyor.
        //
        // Burada requireEvmVm CAGRILMAZ (kapinin kendisi ayni cevabi verirdi):
        // firlatilan hata asagidaki catch'te 32603'e duser ve 4901 kaybolurdu.
        if (currentNetwork && !isEvm(currentNetwork)) {
            sendResponse({ error: { code: 4901, message: 'CHAIN_NOT_EVM' } })
            return
        }

        // Kayit YOKSA varsayilan EVM'dir (bkz. handleConnectWallet'taki F1 notu): taze
        // kurulmus, popup'i henuz hic acmamis bir cuzdan eth_chainId'ye hata degil
        // Ethereum donmeli.
        sendResponse({ result: "0x1" })
    } catch (error) {
        console.error("handleGetChainId error", error.message)
        // CHAIN_NOT_EVM ACIKCA gecer: "Internal Error" bu durumu MASKELER ve dapp'in
        // aslinda ne oldugunu (EVM disi bir ag aktif) ogrenmesini engeller. Yukaridaki
        // 4901 dali bu uc noktada zaten once davraniyor; bu satir, bu dosyadaki DIGER
        // kapilarin (requireEvmVm) firlattigi ayni hatanin buraya sizmasi halinde
        // maskelenmemesi icindir. Baska hatalar (ornegin storage erisim sorunu) eskisi
        // gibi maskeli kalir.
        const publicMessage = error.message === 'CHAIN_NOT_EVM' ? error.message : "Internal Error"
        sendResponse({ error: { code: -32603, message: publicMessage } })
    }
}

/**
 * wallet_switchEthereumChain (EIP-3326): dapp aktif agi degistirmek istiyor.
 *
 * KOK NEDEN: bu metot hic yazilmamisti ve dagiticinin `default:` dalinda
 * `{ error: 'Unknown message type' }` aliyordu (olculdu 2026-09-11, gercek
 * Chromium). Metin DUZ oldugu icin injected.js `err.code`u kopyalayamiyordu;
 * dapp ne 4902 ne 4200 goruyordu, yalnizca "gecilemedi" diyebiliyordu.
 *
 * BURADA `requireEvmVm(currentNetwork)` CAGRILMAZ -- kardes isleyicilerdeki
 * (handleConnectWallet:211, sendTxDapp:279) o satiri buraya kopyalamak bu
 * metodun VAR OLMA SEBEBINI oldururdu: "Solana/TON'dasin, BSC'ye gec" istegi
 * tam olarak EVM DISI bir agdayken gelir ve reddedilmesi gereken sey degildir.
 * Kapi bunun yerine ISTENEN zincire uygulanir (findSwitchTarget).
 *
 * ONAY PENCERESI ACILMADAN once uc erken cikis var; ucu de kullaniciya
 * cevaplanamayacak bir soru sormamak icin:
 *   -32602  parametre bicimi bozuk (EIP'nin istedigi kod)
 *   4902    zincir bizde yok -- EIP-3326'nin ADI OLAN kod
 *   null    zaten o agdayiz; degistirecek bir sey yok
 *   4100    aktif hesap EVM imzalayamaz (TON-only eski kayit); onaylansa bile
 *           applyNetworkChange hesap kapisinda `false` donerdi ve dapp'e
 *           "degisti" demis olurduk -- yalan.
 */
export async function handleSwitchChain(message, sender, sendResponse) {
    try {
        const istenen = parseRequestedChainId(message?.params)
        if (istenen === null) {
            sendResponse({ error: { code: -32602, message: 'Expected params[0].chainId to be a 0x-prefixed hex chain id.' } })
            return
        }

        const hedef = findSwitchTarget(istenen)
        if (!hedef) {
            // 4902 = "bu zincir cuzdana eklenmemis". 4901 ILE KARISTIRMA: o,
            // "saglayici hicbir EVM zincirine bagli degil" demek ve bu dosyada
            // handleGetChainId'de baska bir soruya cevap veriyor.
            //
            // MESAJ DURUST OLMAK ZORUNDA: saglayici `isMetaMask = true`
            // diyor (injected.js:5), bu yuzden wagmi/viem 4902'yi gorunce
            // OTOMATIK olarak wallet_addEthereumChain deneyecek ve o da
            // reddedilecek. Kullanici arka arkaya iki hata gorecek; en azindan
            // ikincisinin neden geldigini bu metin acikliyor.
            sendResponse({ error: { code: 4902, message: 'This chain is not available in this wallet. Adding custom chains (wallet_addEthereumChain) is not supported.' } })
            return
        }

        const { currentNetwork, active_account } = await chrome.storage.local.get(['currentNetwork', 'active_account'])

        if (alreadyOnChain(currentNetwork, hedef.chainId)) {
            sendResponse({ result: null })
            return
        }

        if (!accountHasEvm(active_account)) {
            sendResponse({ error: { code: 4100, message: 'The active account has no EVM address.' } })
            return
        }

        const requestId = crypto.randomUUID()
        const { origin } = resolveSenderOrigin(sender)

        // ALAN ADI `requestedChainId`, `chainId` DEGIL. Header.vue:942 dapp
        // modunda `current_request?.chainId || currentNetwork?.chainId` okuyup
        // baslikta ag adini cizer; `chainId` yazsaydik baslik HENUZ GECILMEMIS
        // agi aktif gibi gosterirdi. O blok bugun olu (dappMode prop'u hicbir
        // yerden true gelmiyor) ama biri `:dapp-mode="true"` yazdigi gun canlanir.
        await openApprovalWindow(requestId, sendResponse, {
            type: SWITCH_CHAIN_TYPE,
            id: requestId,
            origin: origin,
            favicon: sender.tab?.favIconUrl,
            requestedChainId: hedef.chainId,
            requestedChainName: hedef.name,
        })
    } catch (error) {
        console.error('handleSwitchChain error', error.message)
        sendResponse({ error: { code: -32603, message: 'Internal Error' } })
    }
}

/**
 * wallet_addEthereumChain: BILEREK desteklenmiyor.
 *
 * 4200 ("Unsupported Method") donuyor, 4902 DEGIL: 4902 "zincir eklenmemis,
 * eklemeyi dene" demektir ve tam da denenip reddedilecek seyi onerir -- dapp
 * sonsuz bir switch/add dongusune girer. Cuzdan sabit bir zincir listesiyle
 * geliyor (data/supported_chains.json); dogrulanmamis RPC/zincir tanimlarini
 * bir web sayfasinin yazdirmasi ayri bir karardir ve verilmedi.
 *
 * `sendResponse`tan BASKA is yapmadigi icin dagitici bunu tek parametreyle
 * cagirir -- handleGetChainId ile ayni kalip.
 */
export function handleAddChain(sendResponse) {
    sendResponse({ error: { code: 4200, message: 'wallet_addEthereumChain is not supported by this wallet.' } })
}

/**
 * eth_accounts: sessiz baglanti sorgusu. Neredeyse her dapp sayfa yuklenirken
 * cagirir (wagmi/ethers autoconnect). Yaniti HATA DEGIL listedir: bagli
 * degilse (ya da aktif ag EVM disiysa) BOS liste doner -- MetaMask davranisi.
 * 'Unknown message type' donmek autoconnect'i saglayici arizasi sanip iptal
 * ettiriyordu.
 */
export async function handleGetAccounts(message, sender, sendResponse) {
    try {
        const { hostname } = resolveSenderOrigin(sender)
        const { dapps = {}, currentNetwork } = await chrome.storage.local.get(['dapps', 'currentNetwork'])

        if (currentNetwork && !isEvm(currentNetwork)) {
            sendResponse({ result: [] })
            return
        }

        const accounts = dapps?.[hostname]?.accounts
        // R4'UN SON HALKASI: uc yazicinin ucu de suzulmus olsa bile, DISKTE
        // ONCEDEN yazilmis bir kayit hala `UQ...` tasiyor olabilir ve bu uc
        // nokta onu bugun AYNEN donduruyordu. Suzgec burada oldugu icin eski
        // kayit icin bir goc yazmaya GEREK YOK (K2).
        sendResponse({ result: Array.isArray(accounts) ? accounts.filter(isEvmDappAddress) : [] })
    } catch (e) {
        sendResponse({ result: [] })
    }
}

export async function resolvePendingRequest(message, sender) {
    const { requestId, status, data, error } = message

    if (pendingRequests.has(requestId)) {
        const request = pendingRequests.get(requestId)

        if (status === 'success') {
            request.sendResponse({ result: data.result })
        } else {
            const errObj = typeof error === 'object' ? error : { code: 4001, message: error || 'Request rejected by user' };
            request.sendResponse({ error: errObj })
        }

        pendingRequests.delete(requestId)
        await chrome.storage.local.remove('current_request')
    } else {
        // MV3 service worker yeniden basladiginda pendingRequests BOSALIR ama
        // diskteki current_request kalir. Kullanicinin Reddet/Onayla'si burada
        // sessizce yutulursa kayit asla silinmez ve popup her acilista ayni olu
        // onay ekranina doner. Yanitlanacak dapp baglantisi artik yok; yapilacak
        // tek dogru is AYNI id'yi tasiyan kaydi temizlemek. Yabanci bir id'de
        // guncel kayda DOKUNULMAZ.
        const { current_request } = await chrome.storage.local.get('current_request')
        if (current_request?.id !== requestId) return
        await chrome.storage.local.remove('current_request')
    }

    if (activeWindowId !== null) {
        try {
            chrome.windows.remove(activeWindowId).catch(() => {})
        } catch (e) {}
        activeWindowId = null
    }
}