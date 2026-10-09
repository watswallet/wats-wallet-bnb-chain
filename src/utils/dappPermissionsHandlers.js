import { isEvm } from './chainKind'
import { isEvmDappAddress, resolveSenderOrigin } from './dappFunctions'
import { orderGrantedAccounts, resolveDappRecord } from './dappAccountSync'
import { updateDapps as defaultUpdateDapps } from './dappsStore'
import { buildPermissions, parseRevokeParams } from './dappPermissions'

/**
 * EIP-2255 izin isleyicileri: `wallet_getPermissions` ve `wallet_revokePermissions`
 * (`wallet_requestPermissions` BILEREK desteklenmez: 4200, `default:` dalinda).
 *
 * Ikisi de onay penceresi ACMAZ ve kisa yoldur (wagmi `disconnect`'te
 * `wallet_revokePermissions`'i ~100 ms zaman asimiyla cagirir ve hatayi yutar).
 * Origin HER ZAMAN `resolveSenderOrigin(sender)`'dan gelir, `params`'tan ASLA.
 */

// dappFunctions.js'teki UNAUTHORIZED ile AYNI metin (orada modul-ozel).
const UNAUTHORIZED = { code: 4100, message: 'The requested account and/or method has not been authorized by the user.' }

/**
 * `wallet_getPermissions`: bagli degilse, ag EVM degilse, aktif hesabin EVM adresi
 * yoksa ya da gonderen origin kayitli TAM origin ile ESIT degilse `[]`.
 * Hesap listesi `orderGrantedAccounts` ile sirali listedir (aktif hesap basta; `eth_accounts` ile AYNI kural, esitligi T14b/T15 dogrular).
 * Sessiz bir sorgudur: hata durumunda da hata DEGIL `[]` doner.
 */
export async function getPermissionsDapp(message, sender, sendResponse) {
    try {
        const { origin } = resolveSenderOrigin(sender)
        const { dapps = {}, currentNetwork, active_account } = await chrome.storage.local.get(['dapps', 'currentNetwork', 'active_account'])

        if (currentNetwork && !isEvm(currentNetwork)) {
            sendResponse({ result: [] })
            return
        }
        // handleGetAccounts ile AYNI kural: aktif hesabin EVM adresi yoksa hicbir izin sunulmaz.
        if (active_account && !isEvmDappAddress(active_account.address)) {
            sendResponse({ result: [] })
            return
        }

        // Kayit cozumu T3'te: hostname anahtari + kayitli TAM origin gonderenle esit
        // (eski kayitta `origin` yoksa hostname'e duser); cozulemezse izin YOK.
        const resolved = resolveDappRecord(dapps, origin)
        if (!resolved) {
            sendResponse({ result: [] })
            return
        }
        const { record } = resolved

        const accounts = Array.isArray(record.accounts) ? record.accounts.filter(isEvmDappAddress) : []
        const orderedAccounts = orderGrantedAccounts(accounts, active_account?.address)
        sendResponse({ result: buildPermissions({ origin, record, orderedAccounts }) })
    } catch (error) {
        console.error('getPermissionsDapp error:', error)
        sendResponse({ result: [] })
    }
}

/**
 * `wallet_revokePermissions`: `eth_accounts` anahtari varsa gonderen origin'in
 * `dapps` kaydi SILINIR (yalniz kayitli tam origin gonderenle esitse), o hostname'in
 * bekleyen onay istekleri 4100 ile reddedilip pencere kapatilir, dapp'e
 * `accountsChanged([])` bildirilir; sonuc `null`. Diger anahtarlar yok sayilir.
 * `ton_dapps`/`solana_dapps`'a DOKUNULMAZ.
 *
 * Sira: ONCE yaz, sonra reddet, sonra bildir (yarim kalan bir islemde bile dapp
 * silinmis bir izin icin "bagli" gorunmesin).
 *
 * `deps` (T14b gercek islevleri verir): `notify(hostname, method, result)`,
 * `rejectPendingForOrigin(hostname, {code, message})` (T8); `updateDapps` istege
 * bagli (varsayilan: dappsStore.js, testler sahtesini verir).
 */
export async function revokePermissionsDapp(message, sender, sendResponse, { notify, rejectPendingForOrigin, updateDapps = defaultUpdateDapps } = {}) {
    try {
        if (typeof notify !== 'function' || typeof rejectPendingForOrigin !== 'function') {
            throw new Error('REVOKE_DEPS_MISSING')
        }

        const parsed = parseRevokeParams(message?.params)
        if (!parsed.ok) {
            sendResponse({ error: parsed.error })
            return
        }
        // `eth_accounts` disindaki izin adlari yok sayilir (hosgorulu).
        if (!parsed.value.revokesEthAccounts) {
            sendResponse({ result: null })
            return
        }

        const { origin } = resolveSenderOrigin(sender)

        // Mutator T3 sozlesmesine gore haritanin derin KOPYASINI yerinde degistirir
        // (donus degeri yok sayilir). Kayit cozumu `resolveDappRecord`'da: hostname
        // anahtari + kayitli TAM origin gonderenle esit olmali; aksi halde SILINMEZ.
        let removedHostname = null
        await updateDapps((dapps) => {
            removedHostname = null
            const resolved = resolveDappRecord(dapps, origin)
            if (!resolved) return
            removedHostname = resolved.hostname
            delete dapps[resolved.hostname]
        })

        if (removedHostname !== null) {
            try {
                await rejectPendingForOrigin(removedHostname, UNAUTHORIZED)
            } catch (error) {
                // Kayit zaten silindi: bildirim YINE GIDER.
                console.error('revokePermissionsDapp rejectPendingForOrigin:', error)
            }
            await notify(removedHostname, 'accountsChanged', [])
        }
        sendResponse({ result: null })
    } catch (error) {
        console.error('revokePermissionsDapp error:', error)
        sendResponse({ error: { code: -32603, message: 'Internal Error' } })
    }
}
