// Ice aktarma aninda zincire SORAR. Karar VERMEZ.
//
// Iki ayri tuzagi ayni sorguyla acar:
//
// 1) SURUM (spec §7). TON'da bir mnemonic tek bir adres belirlemez; adres,
//    mnemonic VE cuzdan sozlesmesinin surumuyle birlikte belirlenir. Olculdu:
//    ayni ifade W5/v4R2/v3R2'de UC AYRI adres uretiyor. Bu uygulama yalnizca W5
//    imzaliyor - eski bir Tonkeeper cuzdani aktarilirsa W5 adresi BOS cikar ve
//    kullanici parasinin gittigini sanar.
//
// 2) CAKISMA (spec §8). Bir ifade iki standartta da gecerli olabilir; olculdu:
//    ~500'de bir. Hangi turetmenin kullanilacagi zincire bakilarak secilir,
//    sabit bir siraya gore DEGIL.
//
// v4R2/v3R2 sozlesmeleri YALNIZCA adres hesaplamak icin kurulur. Imzalanmaz,
// desteklenmez, kullaniciya sunulmaz.

import { WalletContractV4, WalletContractV3R2 } from '@ton/ton'
import { fromNano } from '@ton/core'
import { tonKeyPairFromMnemonic, tonWalletContract } from './tonAccount'
import { tonKeyPairFromTonMnemonic } from './tonMnemonic'
import { toFriendlyTon } from './tonAddress'

function contractsFor(publicKey, kind) {
    // TEK W5 fabrikasi tonAccount.js'te tanimli - burada AYRICA kurulmaz.
    // tonAccount.js'in kendi yorumu: "kurulum baska hicbir yerde TEKRARLANMAZ" -
    // iki kurulum sitesi zamanla birbirinden sapabilir (biri degisip digeri
    // unutulur) ve bu probun w5 adayi, uygulamanin GERCEKTEN imzaladigi adresle
    // sessizce uyusmaz hale gelir. Bu, tam olarak bu probun var olma sebebinin
    // tersidir - o yuzden burada AYRI bir W5 sozlesme kurulumu YOK.
    const w5 = tonWalletContract(publicKey)

    // BIP39 tarafinda eski surumlerin karsiligi YOK: bu uygulama o tohumdan
    // zaten yalnizca W5 uretiyor, baska bir surumde hic adresi olmadi.
    if (kind === 'bip39') return [{ version: 'w5', contract: w5 }]

    return [
        { version: 'w5', contract: w5 },
        // `walletVersion` alani GECILMEZ: WalletContractV4.create yalnizca
        // workchain/publicKey/walletId/domain okuyor ve o alani SESSIZCE yok
        // sayiyor (olculdu: alanli ve alansiz cagri AYNI adresi uretiyor).
        // Yazmak, olmayan bir surum secimi yapiliyor izlenimi verir ve ayni
        // kalip v3R2/v5 satirlarina kopyalanirsa gercek bir hataya doner.
        // Surum etiketi yalnizca disaridaki `version` alaninda durur.
        { version: 'v4R2', contract: WalletContractV4.create({ publicKey, workchain: 0 }) },
        { version: 'v3R2', contract: WalletContractV3R2.create({ publicKey, workchain: 0 }) },
    ]
}

async function keyPairFor(mnemonic, kind) {
    if (kind === 'tonMnemonic') return await tonKeyPairFromTonMnemonic(mnemonic)
    return await tonKeyPairFromMnemonic(mnemonic, 0)
}

export async function probeTonMnemonic({ mnemonic, kinds, client }) {
    const candidates = []

    try {
        for (const kind of kinds) {
            const keyPair = await keyPairFor(mnemonic, kind)
            for (const { version, contract } of contractsFor(keyPair.publicKey, kind)) {
                const nano = await client.getBalance(contract.address)
                candidates.push({
                    kind,
                    version,
                    // tonAddress.js'teki TEK bicimlendirme yolu: contract.address'i
                    // burada elle .toString({bounceable:false}) ile cevirmek,
                    // toFriendlyTon'un bayrak kumesinden (testOnly dahil) sessizce
                    // sapabilir. Varsayilan testnet:false ile bugunku deger DEGISMEZ.
                    address: toFriendlyTon(contract.address),
                    balance: Number(fromNano(nano)),
                })
            }
        }
    } catch (error) {
        // Zincire ulasilamadi. Bu bir GUVENLIK kapisi degil, bir yardim mesaji -
        // fırlatmak, bir RPC kesintisinde kullanicinin kendi cuzdanini
        // aktarmasini durdururdu. `failed` bayragini tasiyoruz ki cagiran taraf
        // cakisma durumunda (karar yoklamaya BAGLIYKEN) fail-open davranmasin.
        console.error('TON cuzdan yoklamasi basarisiz:', error.message)
        return { candidates: [], failed: true }
    }

    return { candidates, failed: false }
}
