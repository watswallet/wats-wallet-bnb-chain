// Hibe (dapp izin) kurallarinin SAF mantigi (spec 7.2 "Hibe modeli", G4, D1 = A).
//
// Bu modul `chrome`, depo, ag ya da zaman BILMEZ (`now` disaridan verilebilir):
// hesap degisiminde bir sitenin ne olacagi TEK yerde, test edilebilir bicimde
// durur. Yazma ve bildirim `dappAccountApply.js`in isidir.
//
// KAYIT SEKLI: `dapps` HOSTNAME ile anahtarlanir (eski kayitlar dahil).
// Bagli sitenin TAM origin'i yeni kayitlarda `origin` alaninda durur
// (ConnectDapp yazar); eski kayitta yoktur ve o zaman hostname'e dusulur.
//
// `isEvmAddress` varsayilani `dappFunctions.isEvmDappAddress` ile AYNI kural
// (`0x` oneki). O fonksiyon dappFunctions.js'te yasar ve o dosya modul ust
// duzeyinde `chrome`'a dokundugu icin buradan ice aktarilamaz; cagiranlar
// (arka plan) gerekirse kendi suzgeclerini ENJEKTE eder.

const defaultIsEvmAddress = (value) => typeof value === 'string' && value.startsWith('0x')

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)

const isNonEmptyString = (value) => typeof value === 'string' && value !== ''

/** Iki adres HARF DUYARSIZ ayni mi (EIP-55 checksum'lu ve kucuk harfli yazim ayni adrestir). */
export function isSameAddress(a, b) {
    return isNonEmptyString(a) && isNonEmptyString(b) && a.toLowerCase() === b.toLowerCase()
}

/**
 * Site aktif hesabi izlemeli mi: `followActive !== false`. Alan eski kayitta
 * yoktur (izler); yalniz kullanici hesaplari ELLE duzenleyince `false` olur.
 * Kayit bir nesne degilse izlenecek bir sey yoktur.
 */
export function resolveFollowActive(record) {
    return isPlainObject(record) ? record.followActive !== false : false
}

/**
 * Izinli hesaplari dapp'e sunulacak SIRAYA koyar: aktif hesap (izinliyse) basa,
 * kalanlar saklanan sirayla, tekrarlar (harf duyarsiz) ve dize olmayanlar atilir.
 * Girdiyi DEGISTIRMEZ. `eth_accounts`, `eth_requestAccounts` hizli yolu ve
 * `accountsChanged` yuku ayni listeyi kullanir.
 */
export function orderGrantedAccounts(accounts, activeAddress) {
    if (!Array.isArray(accounts)) return []

    const seen = new Set()
    const unique = []
    for (const account of accounts) {
        if (!isNonEmptyString(account)) continue
        const key = account.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(account)
    }

    if (!isNonEmptyString(activeAddress)) return unique
    const index = unique.findIndex((account) => isSameAddress(account, activeAddress))
    if (index <= 0) return unique

    const [active] = unique.splice(index, 1)
    return [active, ...unique]
}

/**
 * Gonderen origin'in kaydini cozer: `{ hostname, record }` ya da `null`.
 *
 * - `origin` TAM origin dizesi olmali (`https://app.x.io`); `Unknown`, `null`
 *   ya da bozuk dize `null` doner.
 * - Kayitta `origin` varsa gonderen origin'e TAM esit olmali (sema, host ve port);
 *   esit degilse `null` (fail-closed). Eski kayitta `origin` yoktur: hostname
 *   esitligine dusulur (spec 7.3, R-19).
 * - Anahtar aramasi YALNIZ kendi (own) anahtarlara bakar: `constructor`,
 *   `__proto__` gibi adlar kayit sayilmaz.
 */
export function resolveDappRecord(dapps, origin) {
    if (!isPlainObject(dapps) || !isNonEmptyString(origin)) return null

    let parsed
    try {
        parsed = new URL(origin)
    } catch {
        return null
    }
    if (!parsed.hostname) return null
    if (!hasOwn(dapps, parsed.hostname)) return null

    const record = dapps[parsed.hostname]
    if (!isPlainObject(record)) return null

    if (record.origin !== undefined) {
        let stored
        try {
            stored = new URL(record.origin).origin
        } catch {
            return null
        }
        if (stored !== parsed.origin) return null
    }

    return { hostname: parsed.hostname, record }
}

/**
 * Bir origin'e VERILMIS hesabi bulur; yetki yoksa `null`. Saklanan yazimi
 * (checksum/kucuk harf) AYNEN doner, karsilastirma harf duyarsizdir.
 * `address` verilmezse (undefined/null/bos) kayittaki ILK hesap doner -- o anki
 * aktif hesaba DUSULMEZ (dappFunctions.grantedAccountFor ile ayni sozlesme).
 */
export function findGrantedAccount(dapps, origin, address) {
    const resolved = resolveDappRecord(dapps, origin)
    if (!resolved) return null

    const accounts = Array.isArray(resolved.record.accounts) ? resolved.record.accounts : []
    if (address === undefined || address === null || address === '') {
        return isNonEmptyString(accounts[0]) ? accounts[0] : null
    }
    return accounts.find((account) => isSameAddress(account, address)) ?? null
}

/**
 * Kullanicinin Manage Permissions'ta hesaplari ELLE duzenlemesi: yeni kaydi
 * dondurur (girdi degismez). Hesap KUMESI degistiyse `followActive = false`
 * olur (kullanici bilerek bir secim yapti: hesap degisimi bu siteyi artik
 * izlemez); kume ayni kaldiysa (yalniz zincir/gasless duzenlendi) kayit
 * hesaplar ve bayrak bakimindan DEGISMEZ. Iki ekran (Header modali ve
 * DappPermissions) ayni yardimciyi kullanir; kural iki yerde ayri yazilmaz.
 */
export function applyManualAccountEdit(record, accounts) {
    const base = isPlainObject(record) ? record : {}
    const edited = orderGrantedAccounts(accounts, undefined)
    const current = orderGrantedAccounts(base.accounts, undefined)

    const sameSet =
        edited.length === current.length &&
        edited.every((account) => current.some((existing) => isSameAddress(existing, account)))
    if (sameSet) return { ...base }

    return { ...base, accounts: edited, followActive: false }
}

const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index])

const sameListInsensitive = (a, b) =>
    a.length === b.length && a.every((value, index) => value.toLowerCase() === b[index].toLowerCase())

/**
 * Aktif hesap `previousAddress`ten `nextAddress`e gecince HER sitenin kaydina ne
 * olacagini hesaplar (D1 = A, daraltilmis hibrit). SAFTIR: girdiyi degistirmez.
 *
 * Donus: `{ writes, notifications, permissionLost }`
 *   - `writes`: `{ [hostname]: { accounts, followedAt? } }` -- YALNIZ `accounts`
 *     listesi gercekten degisen kayitlar.
 *   - `notifications`: `[{ hostnames, accounts }]` -- ayni yuku alan siteler
 *     gruplanir; `accounts` dapp'e `accountsChanged` ile gidecek liste.
 *   - `permissionLost`: `[{ hostname, origin|null }]` -- onceki hesabin hibesini
 *     kaybeden (takip edip degistirilen) siteler; bekleyen onaylari reddedilir.
 *
 * Kurallar (spec 6 G4):
 *   1. Yalniz `openHostnames` icindeki (acik sekmeli) siteler ele alinir; uyuyan
 *      sitelerin kaydina ve bildirimine DOKUNULMAZ.
 *   2. Takip: `followActive !== false` VE `accounts` TAM OLARAK `[previous]`
 *      -> `accounts = [next]` (degistir, biriktirme) + `followedAt`.
 *   3. Takip etmeyen acik site: `next` izinliyse listesi aktif basta olacak
 *      sekilde yeniden siralanir; degilse HICBIR SEY (sizinti yok).
 *   4. `next` EVM adresi degilse (TON/Solana hesabi): kayitlar degismez; onceki
 *      adres EVM idiyse acik bagli sitelere `accountsChanged([])`.
 *   3b. Takip etmeyen acik sitede BILDIRIM karari YAZMA kararindan ayridir:
 *      dapp'in son gordugu liste orderGrantedAccounts(saklanan, previous)'tir;
 *      yeni liste ondan farkliysa saklanan sira zaten yeni siraya esit olsa da
 *      (yazim yok) bildirilir. `suppressUnchanged: true` bu yazimsiz bildirimi
 *      kapatir (ayni olayin tekrar teslimi icin uygulayici kullanir).
 *   5. `previous` EVM degildi ve `next` EVM'e donduyse (dapp `[]` almisti):
 *      `next`i izinli acik siteler siralari ayni olsa bile `accountsChanged` alir.
 *   6. `previous` ile `next` ayni adres (yeniden adlandirma) -> bos plan.
 */
export function planAccountSwitch({
    dapps,
    previousAddress,
    nextAddress,
    openHostnames,
    isEvmAddress = defaultIsEvmAddress,
    now = Date.now(),
    suppressUnchanged = false,
} = {}) {
    // `writes` prototipsiz: hostname `__proto__` ise bile yazim sessizce dusmez.
    const plan = { writes: Object.create(null), notifications: [], permissionLost: [] }

    if (!isPlainObject(dapps)) return plan
    if (!isNonEmptyString(nextAddress)) return plan
    if (isSameAddress(previousAddress, nextAddress)) return plan

    const open = new Set(openHostnames || [])
    const hostnames = Object.keys(dapps).filter(
        (host) => host !== '__proto__' && open.has(host) && isPlainObject(dapps[host]),
    )
    const previousWasEvm = isNonEmptyString(previousAddress) && isEvmAddress(previousAddress)

    const groups = new Map()
    const notify = (hostname, accounts) => {
        const key = accounts.map((account) => account.toLowerCase()).join(',')
        if (!groups.has(key)) groups.set(key, { hostnames: [], accounts })
        groups.get(key).hostnames.push(hostname)
    }

    if (!isEvmAddress(nextAddress)) {
        // EVM'siz aktif hesap: izinler degismez. Dapp `[]` almissa tekrar soylenmez.
        if (previousWasEvm) for (const host of hostnames) notify(host, [])
    } else {
        for (const host of hostnames) {
            const record = dapps[host]
            const granted = Array.isArray(record.accounts) ? record.accounts.filter(isNonEmptyString) : []

            const follows =
                resolveFollowActive(record) && granted.length === 1 && isSameAddress(granted[0], previousAddress)
            if (follows) {
                plan.writes[host] = { accounts: [nextAddress], followedAt: now }
                plan.permissionLost.push({
                    hostname: host,
                    origin: isNonEmptyString(record.origin) ? record.origin : null,
                })
                notify(host, [nextAddress])
                continue
            }

            if (!granted.some((account) => isSameAddress(account, nextAddress))) continue

            const ordered = orderGrantedAccounts(record.accounts, nextAddress)
            // YAZMA karari: saklanan sira yeni siradan farkli mi.
            const needsWrite = !sameList(record.accounts, ordered)
            // BILDIRIM karari ayri: dapp SAKLANAN sirayi gormez; `eth_accounts`
            // orderGrantedAccounts(saklanan, aktif) doner, yani dapp'in son gordugu
            // liste ONCEKI aktif hesaba gore siralidir. Saklanan sira yeni siraya
            // zaten esitse bile (sekme kapaliyken yapilan gecisler yazimi atlatir)
            // dapp bayat `accounts[0]` tutabilir.
            const lastSeen = previousWasEvm ? orderGrantedAccounts(record.accounts, previousAddress) : null
            const differsFromLastSeen = lastSeen === null || !sameListInsensitive(lastSeen, ordered)
            // `suppressUnchanged`: ayni olayin tekrar teslimi (uygulayici bilir);
            // yazimsiz bildirim tekrarlanmaz. EVM'siz -> EVM donusu yine bildirilir.
            const needsNotify = needsWrite || lastSeen === null || (!suppressUnchanged && differsFromLastSeen)
            if (!needsNotify) continue

            if (needsWrite) plan.writes[host] = { accounts: ordered }
            notify(host, ordered.filter((account) => isEvmAddress(account)))
        }
    }

    plan.notifications = [...groups.values()]
    return plan
}

