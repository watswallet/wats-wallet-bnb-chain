/**
 * Kasa listesinde gosterilecek hesaplar — saf katman, YALNIZCA ESKI KAYIT ICIN.
 *
 * 2026-08-29 belgesinin "TON kasasi hesapsizdir" kurali 2026-09-05'te IPTAL EDILDI.
 * Yerine INV-1 gecti: her hesap nesnesi TAM OLARAK BIR kasanin `accounts[]`
 * dizisinde bulunur — TON kasasi da kendi `type:'ton'` hesabini TASIR. Yeni
 * kayitlarda bu dosyanin ikinci daline HIC girilmez: kasanin kendi `accounts[]`i
 * doludur ve ilk dal doner.
 *
 * Dosya yine de KORUNUYOR: eski hibrit profillerde HESAPSIZ TON kasalari var
 * (hesap EVM kasasinda yasiyor, bag `account.tonFingerprint` ile kuruluydu). Onlar
 * listede "0 hesap" gorunur ve kullanicinin ANA ifadesi ULASILAMAZ olurdu.
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
 * TON kasasinin kendisi bu kapidan GECMEZ ve sebebi artik "kasa hesapsizdir" DEGIL:
 * TON kasasi kendi `type:'ton'` hesabini TASIR (INV-1), ama o hesapta
 * `tonFingerprint` alani YOKTUR — o alan yalnizca eski hibrit kayitta vardi. Kapi
 * `tonFingerprint`e bakar, HESAP SAYISINA degil.
 *
 * @param {object} vault
 * @returns {boolean}
 */
export function isDerivedEvmVault(vault) {
    const accounts = vault?.accounts
    if (!Array.isArray(accounts)) return false
    return accounts.some((a) => !!a?.tonFingerprint)
}
