// Bilinen alicilar: cuzdandaki kendi hesaplari (vaults) + adres defteri (saved_addresses).
// Send akisinda adresi kayitli ismiyle gostermek icin kullanilir.

import { isTon, TON_TESTNET_ID } from './chainKind'
import { isSameAddress } from './addressForm'

export function flattenVaultAccounts(vaults) {
    if (!Array.isArray(vaults)) return []

    const accounts = []
    for (const vault of vaults) {
        if (!Array.isArray(vault?.accounts)) continue
        for (const acc of vault.accounts) {
            if (!acc?.address) continue
            accounts.push(acc)
        }
    }
    return accounts
}

// Kullanicinin KENDI hesaplarini AKTIF ZINCIRIN adres alaniyla dondurur.
//
// NEDEN GEREKLI: hesap kaydinda EVM adresi `address`, TON adresi ise AYRI bir
// alanda (`tonAddress` / `tonAddressTestnet`) yasiyor. Zehirli adres kapisi
// hesaplari `address` uzerinden okuyordu; TON agindayken guvenilir listeye
// kullanicinin EVM adresleri giriyor, TON adresleri HIC GIRMIYORDU. Sonuc:
// modul TON adreslerini tanisa bile karsilastiracak hicbir TON adresi
// bulamiyor ve koruma TON'da SESSIZCE hicbir sey yapmiyordu.
//
// Alan secimi `ensureTonAddress` (tonIdentity.js) ile AYNI kurali izler:
// testnet ayri alanda tutulur, cunku tek bir alan hangi ag once turetirse onu
// kalici kazandiriyordu ve arayuz mainnet adresini gosterirken background
// testnet sozlesmesiyle imzaliyordu.
//
// TON adresi HENUZ TURETILMEMIS hesaplar listeye GIRMEZ. Turetme burada
// YAPILMAZ: bu dosya saftir ve turetme kasa acmayi (WALLET_LOCKED) gerektirir.
// Adres Home ekraninda zaten turetilip diske yaziliyor; yoksa o hesap icin
// koruma bir tur eksik calisir - hicbir seyi bozmaz, yalnizca bir uyari
// uretmez. Kilitli kasada tum listeyi kaybetmekten iyidir.
//
// SOLANA BURADA ELE ALINMAZ ve bu bilinclidir: Solana kimligi (`solanaAddress`)
// AYNI hesap kaydinda durur ve onu okuyan taraf `buildTrustedList`tir
// (addressPoisoning.js) — orada zincirden BAGIMSIZ okunabilir, cunku bir
// base58 kayit bir EVM/TON adayiyla hicbir kosulda karsilastirilmaz. TON'da
// ise iki alan (mainnet/testnet) AYNI bicimde oldugu icin secim ZORUNLU ve
// yalnizca burada, aktif zincir bilinirken yapilabilir.
export function accountsForChain(vaults, chainId) {
    const accounts = flattenVaultAccounts(vaults)
    if (!isTon(chainId)) return accounts

    const field = Number(chainId) === TON_TESTNET_ID ? 'tonAddressTestnet' : 'tonAddress'
    return accounts
        .filter((acc) => typeof acc?.[field] === 'string' && acc[field])
        .map((acc) => ({ ...acc, address: acc[field] }))
}

// Iki adres AYNI alici mi? Bicim basina AYRI kural gecerlidir ve karistirilmalari
// dogrudan bir guvenlik hatasidir:
//
//   EVM (0x...)     -> harf kutusu ANLAMSIZ, kucultulerek karsilastirilir.
//   base58 (Solana) -> harf kutusu ANLAMLI, ASLA kucultulmez.
//   TON (base64url) -> harf kutusu ANLAMLI, ASLA kucultulmez.
//
// Ilk ikisinin karari addressForm.js'teki PAYLASILAN `isSameAddress`e birakilir
// (addressPoisoning.js ve historyRecipients.js ile AYNI kaynak). TON bicimini
// addressForm.js TANIMAZ (canonicalAddress null doner), bu yuzden onun icin TAM
// (trim edilmis, harf kasasina DUYARLI) dize esitligine dusulur.
//
// Bu dosya bir donem `address.toLowerCase()` ile karsilastiriyordu ve o gun
// yalnizca EVM adresleri vardi. Bugun kucultme YASAKTIR: base58 ya da base64url
// bir kaydi kucultmek IKI FARKLI ADRESI AYNI GOSTERIR ve bu fonksiyon bir
// alicinin GUVENILIR (kayitli/tanidik) sayilip sayilmadigini belirledigi icin
// koruma TERSINE donerdi.
//
// Tanimadigimiz bir bicimde dize esitligine dusmek FAIL-CLOSED yondedir: en
// kotu ihtimalle etiket BULUNAMAZ (kullanici ham adresi gorur), yanlis bir
// etiket YAPISTIRILMAZ.
function isSameRecipientAddress(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    if (isSameAddress(a, b)) return true

    const left = a.trim()
    return left !== '' && left === b.trim()
}

// Oncelik: hesap adi > adres defteri etiketi.
// Kayittaki adres oldugu gibi doner (checksum case) — identicon seed'i her yerde ayni kalsin.
//
// GUNCELLEME (Task 16b review, F7 ile AYNI sinif): bu satir eskiden "adres defteri
// UI'i ethers.isAddress ile dogruluyor, yani buraya base58 ULASMAZ" diyordu --
// ARTIK YANLIS. AddAddress.vue/EditAddress.vue `validateRecipient` kullaniyor ve
// base58 bir kaydi harf kasasi korunarak KABUL EDIYOR, yani `savedAddresses` artik
// base58 tasiyabilir.
//
// AMA `accounts` TARAFI ICIN AYNI SEY GECERLI DEGIL (inceleme, Bulgu B --
// TASIMAK ile KULLANMAK ayni sey degildir): `flattenVaultAccounts` hesabin
// TAMAMINI (`solanaAddress` alani DAHIL) tasir, ama asagidaki eslesme YALNIZ
// `a?.address`e bakar. Sonuc: Solana'da kullanicinin KENDI baska bir hesabina
// gonderirken bu fonksiyon HICBIR etiket bulamaz. `addressPoisoning.js`teki
// `buildTrustedList` bunu FARKLI yapar -- orada `e => [e?.address, e?.solanaAddress]`
// ile IKI alan da okunur. Iki dosya GERCEKTEN ayrisiyor; bu ONCEDEN VAR OLAN bir
// davranistir ve Task 16b'nin KAPSAMI DISINDADIR -- burada yalnizca GORUNUR kilinir
// ki bir sonraki okuyucu `solanaAddress`in TASINMASINI, KULLANILDIGI sanip uzerine
// kod kurmasin. TON'da ayni bosluk YOKTUR: `accountsForChain` aktif zincirin TON
// adresini `address` alanina yazip verdigi icin, cagiran onu kullanirsa eslesme
// dogru alan uzerinden kurulur.
export function resolveRecipient(address, { accounts = [], savedAddresses = [] } = {}) {
    if (!address || typeof address !== 'string') return null

    const account = accounts.find(a => isSameRecipientAddress(a?.address, address))
    if (account?.name) return { label: account.name, address: account.address }

    const saved = savedAddresses.find(s => isSameRecipientAddress(s?.address, address))
    if (saved?.label) return { label: saved.label, address: saved.address }

    return null
}

export function resolveRecipientLabel(address, lists) {
    return resolveRecipient(address, lists)?.label ?? null
}
