import { isEvm } from './chainKind'
import { isTonOnlyAccount } from './accountKind'
import { requireEvmVm } from './vm'

export const pendingRequests = new Map()

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

export async function handleConnectWallet(message, sender, sendResponse) {
    try {
        const requestId = crypto.randomUUID()
        const { origin, hostname } = resolveSenderOrigin(sender)

        // Check if the dapp is already connected
        const { dapps = {}, active_account, currentNetwork } = await chrome.storage.local.get(['dapps', 'active_account', 'currentNetwork'])

        // IKI AYRI KAPI, IKI AYRI SORU (birlestirme notu): asagidaki requireEvmVm
        // "aktif AG EVM mi" diye sorar, isTonOnlyAccount ise "aktif HESABIN EVM
        // adresi var mi". Ikisi de gerekli ve biri otekini kapsamaz: EVM aginda
        // duran bir TON-only hesap birinci kapidan gecer, EVM disi bir agda duran
        // EVM hesabi ikinciden.
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
        if (currentNetwork) requireEvmVm(currentNetwork)

        // TON hesabinin EVM adresi YOKTUR. Sunulursa dapp bir TON adresini EVM
        // adresi sanip islem hazirlar ve kullanici bunu ancak "imzala"ya
        // bastiginda ogrenir.
        // Adres karsilastirmasi HARF DUYARSIZ (grantedAccountFor): kayit kucuk
        // harfle, aktif hesap EIP-55 checksum'uyla tutulmus olabilir -- ayni
        // adrestir. Duyarli karsilastirma bagli dapp'e gereksiz onay penceresi acar.
        if (active_account && !isTonOnlyAccount(active_account) && grantedAccountFor(dapps, hostname, active_account.address)) {
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
        sendResponse({ error: { code: -32603, message: error.message } })
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
        if (!granted) {
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
        sendResponse({ error: { code: -32603, message: error.message } })
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
        if (!granted) {
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
        sendResponse({ error: { code: -32603, message: error.message } })
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
        sendResponse({ result: Array.isArray(accounts) ? accounts : [] })
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