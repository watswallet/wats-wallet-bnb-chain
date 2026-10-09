import { dappErrorCode, isEvmDappAddress, openApprovalWindow, resolveSenderOrigin } from './dappFunctions'
import { requireEvmVm } from './vm'
import { findGrantedAccount } from './dappAccountSync'
import { checkApprovalThrottle } from './approvalThrottle'
import { findAccountByAddress } from './deriveAccount'
import { parseTypedDataParams } from './eip712/parse'
import { hashTypedDataDigest } from './eip712/digest'
import { signStoredTypedData } from './eip712/sign'
import { buildTypedDataView } from './eip712/view'

/**
 * eth_signTypedData_v4: istek kapisi (`signTypedDataDapp`) ve onay ani yeniden
 * dogrulama (`confirmStoredTypedData`).
 *
 * `personal_sign` ikizi (dappFunctions.js `signMessageDapp`) ama farklar bilincli:
 * parametre sirasi `[adres, typedData]` (personal_sign'in TERSI), ayristirma ve
 * ozet saf EIP-712 modullerinde (`./eip712/*`), ve onay aninda ARKA PLAN her
 * seyi diskteki KENDI kaydindan yeniden dogrular -- popup'tan gelen yuk
 * (adres, ozet disinda) hicbir zaman imzalanmaz.
 *
 * Bu dosya `dappFunctions.js`in MEVCUT disa acik adlarini (`openApprovalWindow`,
 * `resolveSenderOrigin`, `dappErrorCode`, `isEvmDappAddress`) import eder; T8'in
 * YENI islevleri (`hasPendingRequest`, ...) ise `deps` ile gelir.
 */

export const SIGN_TYPED_DATA_TYPE = 'SIGN_TYPED_DATA'

// current_request SW olumunden sonra diskte KALIR; gunler sonra imzalanamasin.
export const TYPED_DATA_REQUEST_TTL_MS = 5 * 60 * 1000

// dappFunctions.js'teki UNAUTHORIZED ile AYNI metin (orada modul-ozel; ayni metni
// kilitleyen test dappTypedData.test.js'tedir).
const UNAUTHORIZED_MESSAGE = 'The requested account and/or method has not been authorized by the user.'

const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1'])

// Duz `http` yalniz yerel gelistirme icin kabul; hostname basina tek hibe
// http/https ayrimi yapmadigi icin imza yuzeyinde bu kapi ayrica gerekir.
function isOriginAllowed(origin) {
    try {
        const url = new URL(origin)
        if (url.protocol === 'https:') return true
        return url.protocol === 'http:' && LOCAL_HTTP_HOSTS.has(url.hostname)
    } catch (e) {
        return false
    }
}

const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// Chain kimlikleri sayi, ondalik metin ya da 0x hex metin olabilir; BigInt ile
// TAM karsilastirilir (Number yuvarlamasi yok). Cevrilemeyen -> esit DEGIL.
function chainIdsEqual(a, b) {
    try {
        return BigInt(a) === BigInt(b)
    } catch (e) {
        return false
    }
}

/**
 * Bu origin bu adres icin imza isteyebilir mi? Saklanan hibe adresini ya da null
 * doner. Kosullar: http kurali; adres hibeli ve `0x` onekli; kayitta TAM origin
 * varsa gonderenle ESIT (bu denetimi T3 `findGrantedAccount` yapar: eski kayitta
 * `origin` yoksa hostname'e duser).
 *
 * `address` bos olamaz: `findGrantedAccount` bos adreste kayittaki ILK hesaba
 * duser; imza yuzeyinde "adres verilmedi" ASLA bir hesap secmemeli.
 */
function grantedAddressFor(dapps, origin, address) {
    if (!isOriginAllowed(origin)) return null
    if (typeof address !== 'string' || !address) return null
    const granted = findGrantedAccount(dapps, origin, address)
    return typeof granted === 'string' && isEvmDappAddress(granted) ? granted : null
}

export async function signTypedDataDapp(message, sender, sendResponse, openWindow = openApprovalWindow) {
    try {
        const { origin } = resolveSenderOrigin(sender)

        // N7 (2): kisit, ayristirmadan (256 KiB JSON, ozet) ve depo okumasindan ONCE.
        const verdict = checkApprovalThrottle(origin)
        if (verdict && verdict.ok === false) {
            sendResponse({ error: { code: -32005, message: 'Rate limited' } })
            return
        }

        // Kardes kapilarla AYNI: kayit YOKSA varsayilan EVM; EVM disi agda 4901.
        const { currentNetwork, dapps = {} } = await chrome.storage.local.get(['currentNetwork', 'dapps'])
        if (currentNetwork) requireEvmVm(currentNetwork)
        const activeChainId = currentNetwork ? Number(currentNetwork.chainId) : 1

        const parsed = parseTypedDataParams(message?.params, { activeChainId })
        if (!parsed.ok) {
            sendResponse({ error: parsed.error })
            return
        }
        const { signWith, typedData, chainCheck } = parsed.value

        const granted = grantedAddressFor(dapps, origin, signWith)
        if (!granted) {
            sendResponse({ error: { code: 4100, message: UNAUTHORIZED_MESSAGE } })
            return
        }

        // Spec 9 (4): satir tavani asilirsa pencere acilmadan -32602. Karari bu kapi verir;
        // `overLimit` sinyalini T2'nin gorunumu uretir (500 sayisi burada KOPYALANMAZ).
        // Hibe kapisindan SONRA: yetkisiz site gorunum hesabini tetikleyemez.
        if (buildTypedDataView(typedData).overLimit === true) {
            sendResponse({ error: { code: -32602, message: 'Typed data is too large to display.' } })
            return
        }

        let digest
        try {
            digest = hashTypedDataDigest(typedData).digest
        } catch (e) {
            sendResponse({ error: { code: -32602, message: 'The typed data could not be hashed.' } })
            return
        }

        const requestId = crypto.randomUUID()
        await openWindow(requestId, sendResponse, {
            type: SIGN_TYPED_DATA_TYPE,
            id: requestId,
            origin,
            favicon: sender.tab?.favIconUrl,
            signWith: granted,
            typedData,
            digest,
            chainCheck,
            createdAt: Date.now(),
        })
    } catch (error) {
        console.error('signTypedDataDapp error:', error)
        sendResponse({ error: { code: dappErrorCode(error), message: error?.message === 'CHAIN_NOT_EVM' ? error.message : 'Internal Error' } })
    }
}

const fail = (code, message) => ({ success: false, error: { code, message } })

/**
 * SIGN_TYPED_DATA_CONFIRM isleyicisi (dahili eylem; arka plan kablolamasini T14a
 * yapar). KAPALI-BASARISIZ: asagidakilerin HEPSI saglanmazsa imza URETILMEZ.
 *
 * `deps` (T14a gercek islevleri verir, testler sahtesini):
 *   isWalletUiMessage(sender) -> boolean
 *   hasPendingRequest(id)     -> boolean            (T8 dappFunctions.js)
 *   createSigner(account)     -> Promise<{ signDigest(hexDigest) -> hex imza }>
 *   findAccountByAddress?     (varsayilan deriveAccount.js)
 *   now?                      (varsayilan Date.now)
 *
 * Donus: { success: true, signature } | { success: false, error: { code, message } }
 */
export async function confirmStoredTypedData({ message, sender, deps }) {
    try {
        const findAccount = deps.findAccountByAddress ?? findAccountByAddress
        const now = deps.now ?? Date.now

        // (f) yalniz cuzdan arayuzu (derinlemesine savunma; messageGate de engeller)
        if (!deps.isWalletUiMessage(sender)) return fail(4100, UNAUTHORIZED_MESSAGE)

        const payload = message?.message
        const requestId = payload?.requestId
        if (typeof requestId !== 'string' || !requestId) return fail(-32602, 'Missing requestId.')
        const expectedDigest = payload?.expectedDigest
        if (typeof expectedDigest !== 'string' || !expectedDigest) return fail(-32602, 'Missing expectedDigest.')

        // (a) bu istek HALA bekliyor, diskteki kayit AYNI istek ve dogru tipte
        if (!deps.hasPendingRequest(requestId)) return fail(-32603, 'Request expired')
        const { current_request, dapps = {}, vaults, currentNetwork } = await chrome.storage.local.get(['current_request', 'dapps', 'vaults', 'currentNetwork'])
        if (!current_request || current_request.id !== requestId || current_request.type !== SIGN_TYPED_DATA_TYPE) {
            return fail(-32603, 'Request expired')
        }

        // (d) TTL
        const createdAt = current_request.createdAt
        if (!Number.isFinite(createdAt) || now() - createdAt > TYPED_DATA_REQUEST_TTL_MS) return fail(-32603, 'Request expired')

        // (b) izin DISKTEN yeniden okunur: pencere acikken revoke / hesap kaldirma / followActive gecisi olmus olabilir
        const granted = grantedAddressFor(dapps, current_request.origin, current_request.signWith)
        if (!granted) return fail(4100, UNAUTHORIZED_MESSAGE)

        // (c) ag hala EVM; bildirilmis chainId varsa aktif zincire hala esit
        if (currentNetwork) requireEvmVm(currentNetwork)
        const activeChainId = currentNetwork ? Number(currentNetwork.chainId) : 1
        if (current_request.chainCheck === 'match' && !chainIdsEqual(current_request.typedData?.domain?.chainId, activeChainId)) {
            return fail(-32602, `Provided chainId "${current_request.typedData?.domain?.chainId}" must match the active chainId "${activeChainId}"`)
        }

        // (e) popup `account` gonderdiyse imzacinin AYNISI olmali (gizli-mod kapisi bunu bekler)
        const claimed = payload.account
        if (claimed !== undefined && claimed !== null) {
            const claimedAddress = typeof claimed === 'string' ? claimed : claimed?.address
            if (!sameAddress(claimedAddress, current_request.signWith)) return fail(4100, UNAUTHORIZED_MESSAGE)
        }

        // imzalayan hesap DISKTEKI kasalardan cozulur, popup'in nesnesinden DEGIL
        const account = findAccount(vaults, current_request.signWith)
        if (!account) return fail(4100, UNAUTHORIZED_MESSAGE)

        let signer
        try {
            signer = await deps.createSigner(account)
        } catch (error) {
            if (/locked/i.test(String(error?.message))) return fail(4100, 'Wallet is locked.')
            throw error
        }

        // imza ARKA PLANIN kendi kaydindan: ozet yeniden hesaplanir, expectedDigest ile karsilastirilir
        const result = await signStoredTypedData({ request: current_request, expectedDigest, signer })
        if (!result.ok) return { success: false, error: result.error }
        return { success: true, signature: result.signature }
    } catch (error) {
        console.error('confirmStoredTypedData error:', error)
        return fail(dappErrorCode(error), error?.message === 'CHAIN_NOT_EVM' ? error.message : 'Internal Error')
    }
}
