import { createUiSync } from '../uiSync'
import { findPrivateAccount, isPrivateAccount } from './privateAccount'
import { PRIVACY_MODE_KEY } from './privacyMode'
import { setLocalLogosOnly } from '../tokenLogo'
import { setNeutralAvatars } from '../localAvatar'

// Depodaki uc anahtardan arayuz durumunu turetir. "Gizli mod acik mi" = aktif
// hesap Gizli Hesap mi (spec 5.4; ayri bayrak yok).
export function privacyStateFrom({ active_account, vaults, privacy_mode } = {}) {
    const found = findPrivateAccount(vaults)
    return {
        active: isPrivateAccount(active_account),
        privateAddress: found?.account?.address || null,
        privateAccountKey: found?.account?.key || null,
        introSeen: privacy_mode?.introSeen === true,
    }
}

// Store'u doldurur, <html class="private">'i ayarlar ve depo degisimlerini izler
// (uiSync deseni: panel N pencerede acik olabilir).
export async function installPrivacySync({ privacyStore, storage = chrome.storage.local, doc = globalThis.document }) {
    const store = privacyStore()
    const snapshot = await storage.get(['active_account', 'vaults', PRIVACY_MODE_KEY])

    const apply = (partial) => {
        Object.assign(snapshot, partial)
        const s = privacyStateFrom(snapshot)
        store.active = s.active
        store.privateAddress = s.privateAddress
        store.privateAccountKey = s.privateAccountKey
        store.introSeen = s.introSeen
        // Ozel modda logolar YALNIZ yerel dosyadan (spec 4.7 "Logolar yerel"): tokenLogo'nun modul duzeyindeki anahtari
        // store ile AYNI yerden cevrilir; cagiran yerler degismez.
        setLocalLogosOnly(s.active)
        // Avatarlar notr gri (grafit karari, kullanici 2026-10-26): yerel identicon/initials paletinde mor tonlar var ve
        // <img> data URI'sini CSS boyayamaz; localAvatar'in modul anahtari da ayni yerden cevrilir.
        setNeutralAvatars(s.active)
        doc?.documentElement?.classList?.toggle('private', s.active)
    }
    apply({})

    const sync = createUiSync({
        handlers: {
            active_account: (v) => apply({ active_account: v }),
            vaults: (v) => apply({ vaults: v }),
            [PRIVACY_MODE_KEY]: (v) => apply({ [PRIVACY_MODE_KEY]: v }),
        },
    })
    sync.start()
    return () => {
        sync.stop()
        // Dinleyici kalkinca anahtar da normale doner: mod artik izlenmiyor, takili kalan "yalniz yerel" kural
        // sonraki kurulumun ilk cizimini yanlis etkilemesin.
        setLocalLogosOnly(false)
        setNeutralAvatars(false)
    }
}
