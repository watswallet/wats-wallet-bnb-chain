// Hesabin hangi zincirlere AIT oldugu — saf katman.
//
// chainKind.js "bu zincir nedir" sorusunu cevapliyor; bu dosya "bu HESAP hangi
// zincirlerde kullanilabilir" sorusunu.
//
// TEKIL AILEDEN KUMEYE (2026-09-10 tasarim belgesi). Eskiden bir hesap ya EVM ya
// TON idi. Artik degil: her HD hesabin TON'u ana seed'den turetilen hesaba ozel
// bir TON-native ifadeden gelir (tonFromSeed.js). Ice aktarilan bir TON
// ifadesinden de evmFromTon.js ile GECERLI bir BIP39 ifadesi turetilir AMA o
// hesap `type:'hd'` (+ `tonFingerprint`) olarak doguyor (buildHybridTonAccount,
// hybridTonAccount.js:72) -- `type:'ton'` DEGIL.
//
// DUZELTME (2026-09-10, inceleme turu 2): bu dosya oncesinde `type:'ton'`
// hesaba da TUM_AILELER veriyordu; bu YANLISTI. Olculdu: `type:'ton'` hesabi
// artik HICBIR akis URETMIYOR -- Y1 "TON cuzdani olustur" dugmesini iptal etti,
// Y2'nin ice aktarilan hesabi yukaridaki gibi `type:'hd'` doguyor,
// `createTonVault` BOS bir hesap nesnesiyle cagriliyor (hybridTonAccount.js:58,
// TON kasasi hesap TASIMIYOR). Kalan `type:'ton'` kayitlar yalnizca ESKI/LEGACY
// gelistirici profilleri: `account.address` orada bir TON adresidir, EVM
// adresi DEGIL, kasasi `tonMnemonic`dir ve icinde EVM anahtari YOKTUR.
//
// AYIRT EDICI hala `account.type`. Ikinci bir gercek kaynagi degil, imzalama
// yeteneginin KENDISI: createWalletInstance ve extractPrivateKey de bu alana
// bakiyor.
//
// AG YOK, DEPO YOK.

import { kindOf } from './chainKind'

// Ifadesi olan hesaplar UCUNU DE tasir. Sira sabittir: testler ve
// `chainsForAccount` cikti kararliligina yaslaniyor.
const TUM_AILELER = ['evm', 'solana', 'ton']

// Tek bir secp256k1 ozel anahtarindan ed25519 TURETILEMEZ; o hesaplarda Solana da
// TON da yoktur.
const YALNIZ_EVM = ['evm']

// ESKI/LEGACY kayit. `account.address` bir TON adresidir, EVM'i YOKTUR --
// yukaridaki dosya basi notuna bakin.
const YALNIZ_TON = ['ton']

/**
 * Hesabin destekledigi zincir aileleri: string[] | null.
 *
 * FAIL-OPEN: bilinmeyen/eksik hesap `null` doner. Acilista `active_account` bir
 * an bos olabiliyor ve o anda kilidi uygulamak butun aglari kapatirdi.
 */
export function accountKindsOf(account) {
    const t = account?.type
    if (t === 'hd') return TUM_AILELER          // Y3 + Y2 (hibrit ice aktarma da burada yasar)
    if (t === 'ton') return YALNIZ_TON          // eski/legacy kayit
    if (t === 'imported' || t === 'privateKey') return YALNIZ_EVM
    return null
}

// `null` (bilinmeyen hesap) burada FALSE verir. Fail-open yalnizca zincir
// FILTRESI icindir: "hangi aglari gosterelim" sorusu ile "bu hesap TON
// imzalayabilir mi" sorusu ayridir ve ikincisinde tahmin tehlikelidir.
const tasiyorMu = (account, aile) => (accountKindsOf(account) ?? []).includes(aile)

export function accountHasTon(account) {
    return tasiyorMu(account, 'ton')
}

export function accountHasEvm(account) {
    return tasiyorMu(account, 'evm')
}

/**
 * Bu hesabin EVM ADRES SATIRI cizilmeli mi?
 *
 * `accountHasEvm`den AYRI ve bilerek FAIL-OPEN. Ikisi farkli sorular:
 *   - `accountHasEvm` = "bu hesap EVM imzalayabilir mi" -> tahmin TEHLIKELI,
 *     bilinmeyen tur `false`.
 *   - bu = "kullaniciya EVM alis adresini gosterelim mi" -> tahmin ETMEMEK
 *     tehlikeli: `type` alani olmayan ESKI bir kayitta satir tumden kalkar,
 *     kullanici kendi adresini goremez ve QR bos kalir.
 *
 * NEDEN VAR (final inceleme bulgusu, 2026-09-11). Receive.vue bu soruyu
 * `accountHasEvm` ile soruyordu ve `type`siz kayitta HICBIR adres satiri
 * cizmiyordu -- ayni hesap icin Header.vue ise (`type !== 'ton'`) EVM adresini
 * GOSTERIYORDU. Iki ekran ayni hesap hakkinda celisiyordu; birlesik cevap budur.
 *
 * `type:'ton'` (eski/legacy kayit) HALA `false`: o kayitta `account.address`
 * bir TON adresidir ve EVM satirinda gostermek yanlis adres olurdu.
 */
export function accountShowsEvmRow(account) {
    if (!account) return true
    return accountKindsOf(account) === null || accountHasEvm(account)
}

export function accountHasSolana(account) {
    return tasiyorMu(account, 'solana')
}

/**
 * CIFT YONLU ve UC AILELI.
 *
 * Eski hali `isTon(x) ? kind === 'ton' : kind === 'evm'` idi ve Solana'yi EVM
 * kovasina dusuruyordu — chainKind.js:kindOf `'solana'` dondurdugu halde. Dogru
 * sonuc, YANLIS sebeple: kayit alanlari degisirse sessizce sapardi.
 */
export function accountSupportsChain(account, chainOrId) {
    const kinds = accountKindsOf(account)
    if (kinds === null) return true

    // Bilinmeyen ZINCIR de engellenmez: 'sayi degil' zincirin var olmadigini
    // kanitlamaz ve gecerli bir kayitla gelen kullaniciyi kilitlerdi.
    const kind = kindOf(chainOrId)
    if (kind === null) return true

    return kinds.includes(kind)
}

/**
 * Liste DEGISMIYORSA ayni referans doner — cagiran taraflar `computed` icinde
 * kullaniyor ve gereksiz bir kopya her seferinde yeniden render tetiklerdi.
 */
export function chainsForAccount(account, chains) {
    if (accountKindsOf(account) === null) return chains
    const out = chains.filter((c) => accountSupportsChain(account, c))
    return out.length === chains.length ? chains : out
}
