import { ensurePrivateAccount, findPrivateAccount, isPrivateAccount } from './privateAccount'
import { accountSupportsChain, chainsForAccount } from '../accountKind'
import { isEvm } from '../chainKind'
import { isSameChainId } from '../vm'

// GIZLI MOD DURUMU (spec 5.4). "Gizli mod acik mi" sorusunun TEK DOGRULUK KAYNAGI
// aktif hesaptir (active_account.private === true); burada ayri bir `enabled`
// alani BILEREK YOK. Aksi halde "ayarlardan yeni hesap eklendi, bayrak acik kaldi
// ama aktif hesap normal" gibi tutarsiz bir durum mumkun olurdu.
export const PRIVACY_MODE_KEY = 'privacy_mode'
export const DEFAULT_PRIVACY_MODE = Object.freeze({ lastPublicAccountKey: null, introSeen: false })
const BSC_CHAIN_ID = 56

export async function readPrivacyMode(storage) {
    const { [PRIVACY_MODE_KEY]: stored } = await storage.get(PRIVACY_MODE_KEY)
    const safe = stored && typeof stored === 'object' ? stored : {}
    return {
        lastPublicAccountKey: safe.lastPublicAccountKey ?? null,
        introSeen: safe.introSeen === true,
    }
}

// Gizli Hesap vaults[i].privateAccount altinda durur, accounts[] icinde DEGIL; yine de
// savunma olarak suzulur ki cikis asla Gizli Hesap'a "donmesin".
const publicAccountsOf = (vaults) =>
    (Array.isArray(vaults) ? vaults : [])
        .flatMap((v) => (Array.isArray(v?.accounts) ? v.accounts : []))
        .filter((a) => !isPrivateAccount(a))

// Hesap gecisinde mevcut ag hesaba uymuyorsa gecilecek zincir; uyuyorsa null.
export function networkFor(account, currentNetwork, allChains, preferredChainId) {
    if (currentNetwork && accountSupportsChain(account, currentNetwork)) return null
    const candidates = chainsForAccount(account, allChains)
    return candidates.find((c) => Number(c.chainId) === Number(preferredChainId)) || candidates[0] || null
}

// P5 (spec 4.9): cikista GIRIS ONCESI (donmus) agin geri yazilip yazilmayacagi. Donus: geri
// yazilacak ag kaydi (donmusun KENDISI) ya da null. Kosullar BIRLIKTE aranir: cikis hesabi var
// (yoksa accountSupportsChain FAIL-OPEN true verirdi; hesap bilinmiyorsa ag yazilmaz, PF-B4),
// donmus deger bir kayit (girisin ag kaydi yoksa `null` saklanir; geri yazilacak bir sey yok),
// chainId'si `allChains` icinde (listeden dusmus bir ag geri yazilmaz) ve cikis hesabi o agi
// destekliyor (EVM-only hesaba TON agi, yalniz-TON hesaba EVM agi yazilmaz). Saglanmazsa cagiran
// `networkFor` davranisini surdurur (bugunku cikis).
export function restoreNetworkFor(account, frozen, allChains) {
    if (!account) return null
    if (!frozen || typeof frozen !== 'object' || Array.isArray(frozen)) return null
    const listede = (Array.isArray(allChains) ? allChains : []).some((c) => isSameChainId(c?.chainId, frozen.chainId))
    if (!listede) return null
    return accountSupportsChain(account, frozen) ? frozen : null
}

// Geri yazimin depoya GIDECEK alanlari (`restoreNetworkFor`un dondurdugu kayit icin). Canli ag
// zaten ayni zincirse bos nesne: gereksiz bir storage.onChanged olayi dogmaz. Aksi halde
// `currentNetwork`; ag EVM ise ayrica `last_evm_chain_id` (store/network.js setCurrentNetwork ile
// AYNI kural: EVM disi bir ag "son EVM zinciri" olmaz).
export function restoreNetworkWrites(restore, currentNetwork) {
    if (!restore || isSameChainId(currentNetwork?.chainId, restore.chainId)) return {}
    return {
        currentNetwork: restore,
        ...(isEvm(restore) ? { last_evm_chain_id: restore.chainId } : {}),
    }
}

// Iki kayit ayni mi (alanlari ilkel degerlerden olusan duz nesneler).
function sameRecord(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) if (a[k] !== b[k]) return false
    return true
}

// `restoreNetwork` (P5, spec 4.9): YALNIZ cikista okunur; arka planin girisin kaydettigi donmus ag
// kaydi (`undefined` = kayit yok, `null` = girerken ag kaydi yoktu). Gecerliyse (restoreNetworkFor)
// ag, `active_account` ile AYNI storage.set icinde geri yazilir: hesap degistigi anda canli ag zaten
// sitelerin gordugu agdir, aradaki pencerede son gizli ag okunamaz.
export async function setPrivacyMode(enabled, { storage, getMasterKey, announce, allChains, privateAccountName, restoreNetwork }) {
    // Yalniz gercek boolean: 'false' dizesi gibi degerler gizli moda GIRMEMELI. Bu saf fonksiyon
    // Plan 2'nin de cagrisidir, guvenligi tek bir cagiranin denetimine bagli olmamali.
    if (enabled !== true && enabled !== false) throw new Error('INVALID_ENABLED')
    const mode = await readPrivacyMode(storage)
    const { active_account, currentNetwork, vaults } = await storage.get(['active_account', 'currentNetwork', 'vaults'])

    if (enabled) {
        // Aktif hesap zaten depodaki Gizli Hesap'sa ve ag ona uyuyorsa yapilacak bir sey yok:
        // yazma da, EVM sitelerine ikinci bir `accountsChanged []` duyurusu da yapilmaz
        // (cikistaki no-op ile simetrik). Kayit farkliysa asagidaki yol onu yeniden yazar.
        const stored = findPrivateAccount(vaults)?.account
        if (
            isPrivateAccount(active_account) && stored && sameRecord(active_account, stored)
            && !networkFor(stored, currentNetwork, allChains, BSC_CHAIN_ID)
        ) {
            return { enabled: true, account: stored }
        }

        // Kilitliyse BURADA firlatir -- henuz hicbir sey yazilmadi (yari gecis yok).
        const masterKey = await getMasterKey()
        const preferred = isPrivateAccount(active_account) ? null : active_account
        const account = await ensurePrivateAccount({ storage, masterKey, preferredAccount: preferred, name: privateAccountName })

        const writes = {
            [PRIVACY_MODE_KEY]: {
                lastPublicAccountKey: preferred?.key ?? mode.lastPublicAccountKey,
                introSeen: true,
            },
            active_account: account,
        }
        const chain = networkFor(account, currentNetwork, allChains, BSC_CHAIN_ID)
        if (chain) {
            writes.currentNetwork = chain
            writes.last_evm_chain_id = chain.chainId
        }
        // Tek set: hesap ve ag AYNI anda degisir, arada yarim durum gorunmez.
        await storage.set(writes)
        await announce(account)
        return { enabled: true, account }
    }

    // Aktif hesap zaten normalse cikilacak bir sey yok: yazma da duyuru da yapilmaz
    // (ornegin iki sekmeden ust uste cikis istegi gelirse ikincisi sessizce biter).
    if (!isPrivateAccount(active_account)) return { enabled: false, account: active_account ?? null }

    const all = publicAccountsOf(vaults)
    const target = all.find((a) => a.key === mode.lastPublicAccountKey) || all[0] || null
    if (!target) throw new Error('NO_PUBLIC_ACCOUNT')

    const writes = { [PRIVACY_MODE_KEY]: { ...mode }, active_account: target }
    const restore = restoreNetworkFor(target, restoreNetwork, allChains)
    if (restore) {
        Object.assign(writes, restoreNetworkWrites(restore, currentNetwork))
    } else {
        const chain = networkFor(target, currentNetwork, allChains, currentNetwork?.chainId)
        if (chain) writes.currentNetwork = chain
    }
    // Tek set: hesap ve ag AYNI anda degisir (girisle simetrik).
    await storage.set(writes)
    await announce(target)
    return { enabled: false, account: target }
}
