// TON anahtar turetme: mevcut kasadan ed25519, W5 adresi.
//
// EVM secp256k1 kullanir, TON ed25519 — ayni anahtar iki agda KULLANILAMAZ. Bu yuzden
// TON anahtari mevcut tohumdan AYRICA turetilir:
//
//   HD kasa       -> BIP39 seed -> SLIP-0010 ed25519, m/44'/607'/{index}'
//   Ozel anahtar  -> 32 baytlik EVM anahtari dogrudan ed25519 tohumu
//
// Indeks yola GIRER: aksi halde bir kasanin butun hesaplari TEK bir TON adresini
// paylasir ve hesap izolasyonu (Hesap 1 / Hesap 2) TON tarafinda yok olur.
//
// HMAC icin WebCrypto (crypto.subtle) kullanilir — @ton/crypto'nun kendi
// deriveEd25519Path'i DEGIL. Neden: @ton/crypto-primitives'in tarayici derlemesi
// (dist/browser/hmac_sha512.js) `window.crypto.subtle` okur; bu uzanti MV3'te arka
// planda bir SERVICE WORKER olarak calisir ve service worker'da `window` TANIMSIZDIR.
// Yani kutuphanenin turetme fonksiyonu orada `ReferenceError: window is not defined`
// ile patlar. Burada elle yazilan surum ciplak `crypto.subtle` kullanir — hem
// popup/pencerede hem service worker'da calisir. Bu satirlari "sadelestirip" @ton/crypto
// fonksiyonuna gecmek, arka planda TON adresi turetmeyi sessizce kirar.
//
// SIR YAZILMAZ: bu dosya yalnizca hesaplar; diske/aga hicbir sey gondermez.

import * as bip39 from 'bip39'
import { keyPairFromSeed } from '@ton/crypto'
import { WalletContractV5R1 } from '@ton/ton'
import { TON_MAINNET_ID, TON_TESTNET_ID } from '../chainKind'
import { toFriendlyTon } from './tonAddress'
import { tonKeyPairFromTonMnemonic } from './tonMnemonic'

// SLIP-0010'da ed25519 icin master anahtar bu sabit dizeyle uretilir.
const ED25519_SEED_KEY = new TextEncoder().encode('ed25519 seed')

async function hmacSha512(keyBytes, dataBytes) {
    const key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, dataBytes)
    return new Uint8Array(signature)
}

async function masterNode(seed) {
    const I = await hmacSha512(ED25519_SEED_KEY, seed)
    return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

// ed25519'da YALNIZCA hardened turetme tanimlidir; index her zaman 0x80000000 ile OR'lanir.
async function deriveHardened(parent, index) {
    const data = new Uint8Array(1 + 32 + 4)
    data[0] = 0x00
    data.set(parent.key, 1)
    new DataView(data.buffer).setUint32(33, (index | 0x80000000) >>> 0, false)

    const I = await hmacSha512(parent.chainCode, data)
    return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

export async function slip10DerivePath(seed, path) {
    let node = await masterNode(seed)
    for (const index of path) node = await deriveHardened(node, index)
    return node.key
}

export async function tonKeyPairFromMnemonic(mnemonic, index = 0) {
    const seed = await bip39.mnemonicToSeed(String(mnemonic).trim())

    // `index` turetme yoluna GIRER (m/44'/607'/index'). Eskiden `Number(index) || 0`
    // ile sessizce sifira dusuyordu: "abc", NaN, ondalik, negatif ya da 2^31 (hardened
    // sinirini asan) bir index FARK ETTIRMEDEN baska bir hesabin (cogunlukla Hesap 0'in)
    // anahtarini uretiyordu. Sonuc: iki farkli hesap ayni TON adresini paylasir ve
    // hesap izolasyonu sessizce kirilir. Bu yuzden gecersiz index duzeltilmez, ACIKCA
    // reddedilir — index verilMEMISse (undefined/null) varsayilan 0 hala gecerlidir.
    const i = Number(index ?? 0)
    if (!Number.isInteger(i) || i < 0 || i >= 0x80000000) throw new Error('TON_INDEX_INVALID')

    const key = await slip10DerivePath(new Uint8Array(seed), [44, 607, i])
    return keyPairFromSeed(Buffer.from(key))
}

export function tonKeyPairFromPrivateKey(privateKey) {
    const raw = typeof privateKey === 'string' ? privateKey.trim() : ''
    const hex = raw.startsWith('0x') ? raw.slice(2) : raw
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('TON_SEED_INVALID')
    return keyPairFromSeed(Buffer.from(hex, 'hex'))
}

/**
 * TEK W5 cuzdan fabrikasi. `tonWalletAddress` (asagida) ve `tonSend.js`teki
 * `walletFromKeyPair`/`openWallet` BUNU cagirir — kurulum baska hicbir yerde
 * TEKRARLANMAZ. Neden onemli: kullaniciya gosterilen "adresim" ile sendTon'un
 * gonderim yaptigi ve waitForSeqno'nun izledigi sozlesme, IKI AYRI
 * `WalletContractV5R1.create(...)` cagrisindan gelirse zamanla birbirinden
 * SAPABILIR (biri degisip digeri unutulur) — sonuc fon kaybina giden bir
 * adres uyusmazligidir. Tek fabrika bu sapmayi yapisal olarak imkansiz kilar.
 */
export function tonWalletContract(publicKey, { testnet = false } = {}) {
    // W5 (V5R1) DISINDA bir surum ASLA kurulmaz: cuzdanin tek destekledigi tip bu.
    return WalletContractV5R1.create({
        publicKey,
        workchain: 0,
        walletId: { networkGlobalId: testnet ? TON_TESTNET_ID : TON_MAINNET_ID },
    })
}

export function tonWalletAddress(publicKey, opts = {}) {
    return tonWalletContract(publicKey, opts).address
}

// Bunlar TURETME SEMASI adlari, `vault.type` DEGERLERI DEGIL — crypto-utils.js'te
// vault.type 'hd' ya da 'privateKey' olur, 'bip39' hic yoktur. Cagiran taraf
// CEVIRI yapmali: 'tonMnemonic' turu bir kasa secretKind: 'tonMnemonic' gecirir;
// 'hd' ve 'privateKey' kasalar secretKind HIC VERMEZ (undefined) ve eski sezgiye
// birakilir — diskteki her TON adresi o sezgiye bagli. vault.type'i CEVIRISIZ
// gecirmek (or. dogrudan 'hd') TON_SECRET_KIND_INVALID firlatir.
const SECRET_KINDS = new Set(['tonMnemonic', 'bip39', 'privateKey'])

/**
 * Kasadan cikan sirri hesabin TON kimligine cevirir.
 *
 * `secretKind` VERILMISSE turetme ona gore yapilir ve TAHMIN EDILMEZ.
 *
 * Neden kritik: eski davranis "bosluk iceriyorsa mnemonic" idi ve TON ifadesinde
 * de bosluk var. Bir TON kasasi o dala girerse BIP39 turetmesi uygulanir ve
 * SESSIZCE YANLIS bir adres uretilir — kullanici cuzdanini aktarir, bos bakiye
 * gorur, parasinin gittigini sanir. Hata mesaji yoktur, geri donus yoktur.
 *
 * `secretKind` VERILMEMISSE eski sezgi korunur: diskte duran her mevcut TON
 * adresi o davranisa bagli ve degisirse kullanicinin adresi bir gecede kayar.
 */
export async function deriveTonAccount(secret, account, { testnet = false, secretKind, vaultType } = {}) {
    const value = typeof secret === 'string' ? secret.trim() : ''
    if (!value) throw new Error('TON_SECRET_MISSING')

    // Tanimadigimiz bir deger sezgiye DUSMEZ. Dusseydi 'tonmnemonic' gibi tek
    // harflik bir yazim hatasi TON kasasini BIP39 dalina sokar ve bu fonksiyonun
    // varlik sebebi olan kusuru geri getirirdi.
    if (secretKind !== undefined && !SECRET_KINDS.has(secretKind)) {
        throw new Error('TON_SECRET_KIND_INVALID')
    }

    // SPEC §6 EK KORUMASI — capraz kontrol.
    //
    // `secretKind` ile `vaultType` BAGIMSIZ iki girdidir: birincisini cagiran
    // taraf secer, ikincisi diskteki kasanin kendisidir. Uyusmuyorlarsa
    // turetilecek anahtar kullanicinin cuzdaninin anahtari DEGILDIR.
    //
    // Neden burada: turetmenin TEK bogazi bu fonksiyon. Gorunum yolu
    // (tonIdentityForAccount -> Header/Receive) ve IMZALAMA yolu (background.js
    // -> sendTon/jetton/swap) buradan geciyor; kapi ustteki cagiranlara
    // konsaydi her yeni cagiran onu yeniden yazmak zorunda kalirdi ve tam bu
    // kusur -- arka planin `secretKind` gecirmemesi -- oyle dogdu.
    //
    // Sessiz yanlis adres yerine gurultulu basarisizlik: bu ifadenin BIP39
    // olarak da gecerli olma ihtimali ~1/500 ve bip39.mnemonicToSeed saf
    // PBKDF2'dir - saglama DOGRULAMAZ, yani hicbir sey FIRLATMAZ ve gecerli
    // gorunumlu ama YANLIS bir W5 adresi doner.
    if (vaultType === 'tonMnemonic' && secretKind !== 'tonMnemonic') {
        throw new Error('TON_SECRET_KIND_MISMATCH')
    }

    let keyPair
    if (secretKind === 'tonMnemonic') {
        keyPair = await tonKeyPairFromTonMnemonic(value)
    } else if (secretKind === 'bip39') {
        keyPair = await tonKeyPairFromMnemonic(value, account?.index ?? 0)
    } else if (secretKind === 'privateKey') {
        keyPair = tonKeyPairFromPrivateKey(value)
    } else {
        keyPair = value.includes(' ')
            ? await tonKeyPairFromMnemonic(value, account?.index ?? 0)
            : tonKeyPairFromPrivateKey(value)
    }

    const address = tonWalletAddress(keyPair.publicKey, { testnet })
    return { keyPair, address, friendly: toFriendlyTon(address, { testnet }) }
}
