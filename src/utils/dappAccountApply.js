// Hesap degisiminin TEK giris noktasi (spec 6 G4 f, 7.4 C).
//
// TEK TETIKLEYICI: `chrome.storage.onChanged` `active_account` dinleyicisi
// (arka plan, T14a). Header ve bes sessiz yazicinin HEPSI bu yoldan gecer.
// `ACCOUNT_CHANGED` mesaji bu fonksiyonu CAGIRMAZ: Header hem `active_account`'u
// yazar hem o mesaji yollar; ikisi de cagirsaydi fonksiyon iki kez calisir ve
// yinelenen `accountsChanged` giderdi.
//
// CAGIRAN (arka plan) SORUMLULUGU:
//   - `previousAddress` = `changes.active_account.oldValue?.address`; oldValue
//     yoksa (ilk yazim) bu fonksiyon HIC cagrilmaz.
//   - `nextAddress` = DISKTEKI guncel `active_account.address` (olay yukune
//     DEGIL): ust uste hizli degisimlerde son durum kazanir.
//
// IDEMPOTANS: karar `updateDapps` mutator'i ICINDE (kilit altinda, o anki
// kayitlardan) hesaplanir; YALNIZCA `accounts`'i gercekten degisen kayitlar
// yazilir ve YALNIZCA onlar bildirilir. Ayni cagri ikinci kez gelirse
// `{ changed: false, notified: [] }` doner. (Istisna: EVM'siz hesaba gecis ve
// EVM'siz hesaptan donus, saklanan kayit degismese de dapp'e durum bildirir;
// ayni olayin iki kez teslimi orada tekrar bildirir ve zararsizdir.)

import { planAccountSwitch, isSameAddress } from './dappAccountSync.js'

// dappFunctions.UNAUTHORIZED ile AYNI metin (o modul chrome'a dokundugu icin
// buradan ice aktarilamaz): izni kalkan sitenin bekleyen onay istegi bununla reddedilir.
export const ACCOUNT_REVOKED_ERROR = Object.freeze({
    code: 4100,
    message: 'The requested account and/or method has not been authorized by the user.',
})

const defaultIsEvmAddress = (value) => typeof value === 'string' && value.startsWith('0x')

// Son basariyla islenen gecis. Planlayici, saklanan sira yeni siraya zaten esitken
// de dapp'in son gordugu listeye gore bildirebildigi icin (G4: sekme kapaliyken
// yapilan gecisler), ayni olayin ikinci teslimini yalniz bu bellek ayirt eder.
// Service worker yeniden baslarsa sifirlanir (en kotu ihtimal zararsiz tekrar).
let lastHandledKey = null

/** Test yardimcisi: tekrar-teslim hafizasini sifirlar. */
export function resetAccountSwitchMemory() {
    lastHandledKey = null
}

const isNonEmptyString = (value) => typeof value === 'string' && value !== ''

/**
 * Sekme listesinden (chrome.tabs.query({}) sonucu) ACIK sekmesi olan hostname
 * kumesini cikarir. Yalniz UST cercevenin adresine bakilir: bir iframe icinde
 * calisan dapp bu kumede GORUNMEZ ve "uyuyan site" sayilir (kaydina dokunulmaz,
 * guvenli yon). Gecersiz adresli sekmeler atlanir.
 *
 * NOT: eslesme YALNIZ hostname uzerindendir (sema/port bakilmaz). `http://app.x.io`
 * sekmesi, kaydin `origin`i `https://app.x.io` olsa da siteyi "acik" sayar ve
 * takip/bildirim alabilir; bildirim zaten hostname bazlidir (notifyDappHostnames).
 * Istek yolundaki tam-origin denetimi (resolveDappRecord) bundan ayri ve katidir.
 */
export function collectOpenHostnames(tabs) {
    const hostnames = new Set()
    for (const tab of Array.isArray(tabs) ? tabs : []) {
        try {
            const hostname = new URL(tab?.url).hostname
            if (hostname) hostnames.add(hostname)
        } catch {
            // adresi olmayan / bozuk sekme
        }
    }
    return hostnames
}

// Yeni aktif hesap KASA hesabi mi: tohumdan/anahtardan gelmeyen, bozuk bir
// `active_account` kaydi hibe dagitmamali.
async function defaultIsVaultAddress(address) {
    const { vaults } = await chrome.storage.local.get('vaults')
    if (!Array.isArray(vaults)) return false
    return vaults.some(
        (vault) => Array.isArray(vault?.accounts) && vault.accounts.some((account) => isSameAddress(account?.address, address)),
    )
}

/**
 * @param {{ previousAddress: string, nextAddress: string }} args
 * @param {{
 *   updateDapps: (mutator: Function) => Promise<object>,
 *   notifyDappHostnames: (hostnames: string[], method: string, result: any) => Promise<void>,
 *   getOpenHostnames: () => Promise<Iterable<string>> | Iterable<string>,
 *   rejectPendingForOrigin: (origin: string, error: {code: number, message: string}) => Promise<number>,
 *   isEvmAddress?: (address: string) => boolean,
 *   isVaultAddress?: (address: string) => Promise<boolean> | boolean,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<{ changed: boolean, notified: string[] }>}
 */
export async function applyAccountSwitchToDapps({ previousAddress, nextAddress } = {}, deps = {}) {
    const nothing = () => ({ changed: false, notified: [] })
    const { updateDapps, notifyDappHostnames, getOpenHostnames, rejectPendingForOrigin } = deps
    const isEvmAddress = deps.isEvmAddress || defaultIsEvmAddress
    const isVaultAddress = deps.isVaultAddress || defaultIsVaultAddress
    const now = deps.now || Date.now

    if (!isNonEmptyString(previousAddress) || !isNonEmptyString(nextAddress)) return nothing()
    // Yeniden adlandirma, parola degisimi gibi yazimlar adresi degistirmez.
    if (isSameAddress(previousAddress, nextAddress)) return nothing()

    let plan = null
    try {
        if (isEvmAddress(nextAddress) && !(await isVaultAddress(nextAddress))) return nothing()

        const openHostnames = await getOpenHostnames()

        // Ayni (previous, next) cifti ARDISIK ikinci kez gelirse bu AYNI olayin tekrar
        // teslimidir (aktif hesap B'den A'ya donmeden ayni gecis yeniden olamaz).
        const eventKey = `${previousAddress.toLowerCase()}>${nextAddress.toLowerCase()}`
        const suppressUnchanged = eventKey === lastHandledKey

        // KARAR KILIT ALTINDA: plan, depodan o anda okunan taze kayitlardan
        // hesaplanir; yazma ayni kilitte yapilir (onceden-oku-sonra-yaz yarisi yok).
        await updateDapps((dapps) => {
            plan = planAccountSwitch({
                dapps, previousAddress, nextAddress, openHostnames, isEvmAddress, now: now(), suppressUnchanged,
            })
            for (const [hostname, write] of Object.entries(plan.writes)) {
                dapps[hostname].accounts = write.accounts
                if (write.followedAt !== undefined) dapps[hostname].followedAt = write.followedAt
            }
        })
        lastHandledKey = eventKey
    } catch (e) {
        console.error('applyAccountSwitchToDapps: hibe guncellenemedi:', e?.message || e)
        return nothing()
    }
    if (!plan) return nothing()

    // ONCE YAZ (yukarida), SONRA BILDIR.
    const notified = []
    for (const group of plan.notifications) {
        try {
            await notifyDappHostnames(group.hostnames, 'accountsChanged', group.accounts)
            notified.push(...group.hostnames)
        } catch (e) {
            console.error('applyAccountSwitchToDapps: bildirim basarisiz:', e?.message || e)
        }
    }

    // Onceki hesabin hibesini kaybeden sitelerin bekleyen onay istekleri reddedilir.
    // Eski kayitta tam origin yoktur: https varsayilir (http yalniz localhost icin
    // izinli oldugundan eski bir http kaydi bu yolda reddedilmeden kalabilir; kabul).
    for (const { hostname, origin } of plan.permissionLost) {
        try {
            await rejectPendingForOrigin(origin || `https://${hostname}`, ACCOUNT_REVOKED_ERROR)
        } catch (e) {
            console.error('applyAccountSwitchToDapps: bekleyen istek reddedilemedi:', e?.message || e)
        }
    }

    return { changed: Object.keys(plan.writes).length > 0, notified }
}
