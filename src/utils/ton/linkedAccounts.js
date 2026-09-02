/**
 * Kasa listesinde gosterilecek hesaplar — saf katman.
 *
 * TON kasasi hesap TASIMAZ (spec §6.1): hesap EVM kasasinda yasar ve TON kasasi
 * yalnizca anahtar tutucudur. Ama kullanicinin Tonkeeper ifadesini yedekledigi yer
 * o kasadir; listeden gizlenemez - gizlenseydi kullanici ANA ifadesine ulasamazdi.
 *
 * Bu yuzden hesapsiz bir kasa, kendisine `tonFingerprint` ile bagli hesaplari
 * gosterir.
 *
 * AG YOK, DEPO YOK.
 */

/**
 * @param {object[]} vaults tum kasalar
 * @param {object} vault gosterilecek kasa
 * @returns {object[]} kasanin kendi hesaplari, yoksa ona bagli hesaplar
 */
export function accountsForVaultDisplay(vaults, vault) {
    const own = vault?.accounts
    if (Array.isArray(own) && own.length) return own

    const fingerprint = vault?.fingerprint
    if (!fingerprint || !Array.isArray(vaults)) return []

    const linked = []
    for (const v of vaults) {
        if (!Array.isArray(v?.accounts)) continue
        for (const a of v.accounts) {
            if (a?.tonFingerprint === fingerprint) linked.push(a)
        }
    }
    return linked
}

/**
 * Bu kasanin ifadesi TON ifadesinden TURETILMIS mi?
 *
 * Kasa duzeyindeki yedekleme ekrani (Ayarlar -> Guvenlik -> Yedekleme) HESABI degil
 * KASAYI acar; elinde `account.tonFingerprint` yoktur. Turetilmis EVM kasasi orada
 * gecerli ama TEK BASINA YETMEYEN bir ifade gosterir - TON tarafini kurtarmaz.
 * Ayirt edilmezse kullanici o ifadeyi yazip "yedekledim" der ve Tonkeeper ifadesini
 * atarsa TON parasi KALICI olarak kaybolur.
 *
 * TON kasasinin kendisi bu kapidan GECMEZ: hesap tasimaz (§6.1, `accounts: []`) ve
 * gosterdigi ifade zaten ANA ifadedir - orada uyari yanlis olurdu.
 *
 * @param {object} vault
 * @returns {boolean}
 */
export function isDerivedEvmVault(vault) {
    const accounts = vault?.accounts
    if (!Array.isArray(accounts)) return false
    return accounts.some((a) => !!a?.tonFingerprint)
}
