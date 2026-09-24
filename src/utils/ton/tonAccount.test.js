import { describe, it, expect } from 'vitest'
import {
    slip10DerivePath,
    tonKeyPairFromMnemonic,
    tonKeyPairFromPrivateKey,
    tonWalletContract,
    tonWalletAddress,
    deriveTonAccount,
} from './tonAccount'
import { toFriendlyTon } from './tonAddress'

// Sabit test tohumu. BU MNEMONIC HICBIR YERDE KULLANILMAZ — yalnizca turetmenin
// kaymadigini kilitler.
const MNEMONIC = 'test test test test test test test test test test test junk'
const PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

describe('tonAccount', () => {
    it('SLIP-0010 hep 32 baytlik tohum uretir', async () => {
        const seed = new Uint8Array(64).fill(7)
        const key = await slip10DerivePath(seed, [44, 607, 0])
        expect(key).toBeInstanceOf(Uint8Array)
        expect(key.length).toBe(32)
    })

    it('SLIP-0010 deterministiktir', async () => {
        const seed = new Uint8Array(64).fill(7)
        const a = await slip10DerivePath(seed, [44, 607, 0])
        const b = await slip10DerivePath(seed, [44, 607, 0])
        expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
    })

    it('farkli indeks farkli tohum verir', async () => {
        const seed = new Uint8Array(64).fill(7)
        const a = await slip10DerivePath(seed, [44, 607, 0])
        const b = await slip10DerivePath(seed, [44, 607, 1])
        expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'))
    })

    it('ayni mnemonic hep ayni adresi verir', async () => {
        const first = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        const second = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        expect(first.publicKey.toString('hex')).toBe(second.publicKey.toString('hex'))

        const addr = toFriendlyTon(tonWalletAddress(first.publicKey))
        expect(addr.startsWith('UQ')).toBe(true)
        expect(addr.length).toBe(48)
    })

    it('hesap indeksi degisince adres degisir', async () => {
        // Hesap izolasyonu: Hesap 1 ve Hesap 2 ayni TON adresini PAYLASMAMALI.
        const a = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        const b = await tonKeyPairFromMnemonic(MNEMONIC, 1)
        expect(toFriendlyTon(tonWalletAddress(a.publicKey)))
            .not.toBe(toFriendlyTon(tonWalletAddress(b.publicKey)))
    })

    it('mainnet ve testnet adresleri farklidir', async () => {
        const kp = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        const main = toFriendlyTon(tonWalletAddress(kp.publicKey), { testnet: false })
        const test = toFriendlyTon(tonWalletAddress(kp.publicKey, { testnet: true }), { testnet: true })
        expect(main).not.toBe(test)
        expect(test.startsWith('0Q')).toBe(true)
    })

    it('tonWalletContract TEK W5 fabrikasidir — tonWalletAddress ile AYNI adresi verir', async () => {
        // tonWalletAddress artik dahili olarak tonWalletContract'i cagiriyor.
        // tonSend.js de (walletFromKeyPair, openWallet) AYNI fabrikayi kullaniyor.
        // Bu esitlik BOZULURSA kullaniciya gosterilen "adresim" ile sendTon'un
        // gonderim yaptigi sozlesme farklilasabilir — fon kaybina giden bir sapma.
        const kp = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        const contract = tonWalletContract(kp.publicKey)
        expect(contract.address.toString()).toBe(tonWalletAddress(kp.publicKey).toString())

        const testnetContract = tonWalletContract(kp.publicKey, { testnet: true })
        expect(testnetContract.address.toString())
            .toBe(tonWalletAddress(kp.publicKey, { testnet: true }).toString())
        expect(testnetContract.address.toString()).not.toBe(contract.address.toString())
    })

    it('ozel anahtardan turetme deterministiktir', () => {
        const a = tonKeyPairFromPrivateKey(PRIVATE_KEY)
        const b = tonKeyPairFromPrivateKey(PRIVATE_KEY.slice(2))
        expect(a.publicKey.toString('hex')).toBe(b.publicKey.toString('hex'))
        expect(toFriendlyTon(tonWalletAddress(a.publicKey)).startsWith('UQ')).toBe(true)
    })

    it('gecersiz ozel anahtar reddedilir', () => {
        expect(() => tonKeyPairFromPrivateKey('0x1234')).toThrow('TON_SEED_INVALID')
        expect(() => tonKeyPairFromPrivateKey('')).toThrow('TON_SEED_INVALID')
    })

    it('deriveTonAccount semayi CAGIRANDAN alir - ozel anahtar; bip39 ARTIK KAPALI', async () => {
        // Eskiden bu test semayi HIC gecmiyordu ve `value.includes(' ')` sezgisine
        // guveniyordu. Sezgi silindi: sema artik SOYLENMEK ZORUNDA.
        //
        // 2026-09-11: eski SLIP-10 'bip39' yolu GERI ACILDI (asagidaki
        // 'derivedTonMnemonic dali' bloguna bakin). Burada kilitlenen sey, o
        // yolun index'i ONURSAMASI -- eskiden `Number(index) || 0` ile sessizce
        // sifira duserdi ve iki hesap ayni adresi paylasirdi.
        const eski1 = await deriveTonAccount(MNEMONIC, { type: 'hd', index: 1 }, { secretKind: 'bip39' })
        const eski0 = await deriveTonAccount(MNEMONIC, { type: 'hd', index: 0 }, { secretKind: 'bip39' })
        expect(eski1.friendly).not.toBe(eski0.friendly)

        const imported = await deriveTonAccount(PRIVATE_KEY, { type: 'imported' }, { secretKind: 'privateKey' })
        expect(imported.friendly).toBe(
            toFriendlyTon(tonWalletAddress(tonKeyPairFromPrivateKey(PRIVATE_KEY).publicKey))
        )
    })

    it('turetme sabit vektorden kaymaz', async () => {
        // KILIT: bu deger degisirse mevcut kullanicilarin TON adresi de degisir ve
        // fonlari eski adreste kalir. Degistirmek icin bilincli bir goc plani gerekir.
        const kp = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        expect(toFriendlyTon(tonWalletAddress(kp.publicKey)))
            .toBe('UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r')
    })

    it('testnet turetmesi de sabit vektorden kaymaz', async () => {
        // Mainnet altin vektoru TON_MAINNET_ID'yi (-239) dolayli kilitler ama
        // TON_TESTNET_ID (-3) yalniz "mainnet != testnet" ile test edilirse, sabit
        // -3 yanlislikla baska bir degere (or. -100) donse test yine gecer. Bu yuzden
        // testnet icin de ayri, somut bir "0Q..." adresi kilitlenir.
        const kp = await tonKeyPairFromMnemonic(MNEMONIC, 0)
        expect(toFriendlyTon(tonWalletAddress(kp.publicKey, { testnet: true }), { testnet: true }))
            .toBe('0QDZg_XvhyVdOoqQkNKhCWCDg64Q2wXXfHgkGRZyMoT4O_Sc')
    })

    describe('index sanitizasyonu', () => {
        // `Number(index) || 0` seklindeki eski sanitizasyon gecersiz girdide SESSIZCE
        // Hesap 0'in anahtarini uretiyordu ("abc" -> 0, 1.9 -> 1, -1 -> kabul, 2^31 ->
        // Hesap 0 ile CARPISMA). Bu, spec'in yasakladigi "butun hesaplar tek bir TON
        // adresini paylasir" durumunun ta kendisi. Simdi bu dort girdi de ACIKCA
        // reddediliyor — sessiz duzeltme yok.
        it.each([
            ['"abc" (sayi degil)', 'abc'],
            ['1.9 (tam sayi degil)', 1.9],
            ['-1 (negatif)', -1],
            ['2^31 (hardened sinirini asiyor, index 0 ile carpisir)', 0x80000000],
        ])('%s reddedilir', async (_label, badIndex) => {
            await expect(tonKeyPairFromMnemonic(MNEMONIC, badIndex))
                .rejects.toThrow('TON_INDEX_INVALID')
        })

        it('index verilmemisse (undefined/null) hesap 0 hala gecerlidir', async () => {
            // deriveTonAccount, importe edilmis (index'siz) hesaplar icin `account?.index ?? 0`
            // kullanir — bu satir BOZULMAMALI, sert doğrulama yalnizca index VERILMIS ama
            // gecersizse devreye girmeli.
            const viaUndefined = await tonKeyPairFromMnemonic(MNEMONIC)
            const viaNull = await tonKeyPairFromMnemonic(MNEMONIC, null)
            const viaZero = await tonKeyPairFromMnemonic(MNEMONIC, 0)
            expect(viaUndefined.publicKey.toString('hex')).toBe(viaZero.publicKey.toString('hex'))
            expect(viaNull.publicKey.toString('hex')).toBe(viaZero.publicKey.toString('hex'))
        })
    })

    describe('SLIP-0010 resmi test vektoru (ed25519, Test Vector 1)', () => {
        // Kaynak: SLIP-0010 (SatoshiLabs) spesifikasyonunun resmi ed25519 Test Vector 1'i.
        // Bu, `slip10DerivePath`'in "bizim kodumuzun urettigi deger" DEGIL, TON'dan
        // bagimsiz, harici bir standarda birebir uydugunu kanitlar. seed sabit test
        // vektorunun kendisidir (TON/kullanici mnemonic'iyle ilgisi yoktur).
        const SEED = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')

        it.each([
            [`m/0'`, [0], '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3'],
            [`m/0'/1'`, [0, 1], 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2'],
            [`m/0'/1'/2'`, [0, 1, 2], '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9'],
            [`m/0'/1'/2'/2'`, [0, 1, 2, 2], '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662'],
            [`m/0'/1'/2'/2'/1000000000'`, [0, 1, 2, 2, 1000000000], '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793'],
        ])('%s spec vektoruyle birebir tutar', async (_label, path, expectedHex) => {
            const key = await slip10DerivePath(SEED, path)
            expect(Buffer.from(key).toString('hex')).toBe(expectedHex)
        })
    })
})

describe('deriveTonAccount — sir tipi TAHMIN EDILMEZ', () => {
    // Ayni ifade, iki turetme, IKI FARKLI ADRES. Fixture'in degeri bu: yanlis
    // dala dusen bir uygulama yanlis adresi uretir ve test gorur. Tek standarttan
    // gecen sıradan bir ifadeyle bu kapi test edilmis SAYILMAZDI.
    const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'
    const VIA_TON = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'

    it("secretKind 'tonMnemonic' ise TON turetmesi kullanilir", async () => {
        const { friendly } = await deriveTonAccount(DUAL, { index: 0 }, { secretKind: 'tonMnemonic' })
        expect(friendly).toBe(VIA_TON)
    })

    // TERSINE DONDU (2026-09-10): eski SLIP-10 'bip39' yolu KAPATILDI. Bir
    // zamanlar bu ifadeyi 'UQBviJxv...' adresine cozuyordu (bkz. tonBackgroundKeyPair.test.js
    // altin vektoru) - artik o adres sessizce degil, GURULTULU biciminde erisilemez.
    // 2026-09-11: 'bip39' ARTIK FIRLATMIYOR, eski SLIP-10 adresini URETIYOR.
    // Gerekce: olculdu, origin/main (1.7.0) her HD hesap icin bu semadan bir
    // adres uretip DISKE yaziyor -- nufus "test adresi" degil gercek kullanici.
    // Kapali birakmak o adreslerdeki fonu erisilemez yapardi.
    //
    // KILITLENEN SOZLESME: dala SEZGIYLE girilmez, cagiran taraf ACIKCA ister.
    it("secretKind 'bip39' eski SLIP-10 adresini uretir (sezgiyle DEGIL, acikca istenerek)", async () => {
        const eski = await deriveTonAccount(DUAL, { index: 0 }, { secretKind: 'bip39' })
        const beklenen = toFriendlyTon(
            tonWalletAddress((await tonKeyPairFromMnemonic(DUAL, 0)).publicKey)
        )
        expect(eski.friendly).toBe(beklenen)

        // Ve AYNI ifadeden yeni sema BASKA bir adres verir -- iki semanin
        // ayrildigi yer tam olarak burasi.
        const yeni = await deriveTonAccount(DUAL, { index: 0 }, { secretKind: 'derivedTonMnemonic' })
        expect(yeni.friendly).not.toBe(eski.friendly)
    })

    // TERSINE DONDU (2026-09-05 manuel TON karari). Eskiden "secretKind
    // verilmezse bugunku sezgi korunur" idi ve gerekcesi "diskte duran her TON
    // adresi bu dala bagli" idi. Artik EVM hesabinin TON adresi HIC YOK ve
    // secretKindForVault tam+firlatan oldugu icin `undefined` gecen erisilebilir
    // bir cagiran KALMADI. Sezgi, TON kasasindaki 24 kelimeyi BIP39 sanip
    // SESSIZCE yanlis adres ureten mekanizmanin ta kendisiydi.
    it('secretKind verilmezse SESSIZCE turetmez, FIRLATIR', async () => {
        await expect(deriveTonAccount(DUAL, { index: 0 }))
            .rejects.toThrow('TON_SECRET_KIND_MISSING')
    })

    // Bosluksuz sir de TAHMIN EDILMEZ. Sezginin `else` yarisini da kapatmak sart:
    // yalnizca mnemonic yarisi kapatilsaydi "bosluk yoksa ozel anahtardir" kurali
    // canli kalir ve bozuk/kirpilmis bir sir sessizce ozel anahtar sanilirdi.
    it('bosluksuz sir de sema olmadan turetilmez', async () => {
        await expect(deriveTonAccount('0x' + '11'.repeat(32), {}))
            .rejects.toThrow('TON_SECRET_KIND_MISSING')
    })

    // Taninmayan bir deger SESSIZCE sezgiye DUSMEMELI: dusen bir yazim hatasi
    // ('tonmnemonic', 'ton') TON kasasini BIP39 dalina sokar ve kullanici bos
    // cuzdan gorur. Gurultulu basarisizlik, sessiz yanlis adresten iyidir.
    it('tanimadigi secretKind degerini REDDEDER', async () => {
        await expect(deriveTonAccount(DUAL, { index: 0 }, { secretKind: 'ton' }))
            .rejects.toThrow('TON_SECRET_KIND_INVALID')
    })

    it("secretKind 'privateKey' ham anahtar yolunu kullanir", async () => {
        const key = '0x' + '11'.repeat(32)
        const { friendly } = await deriveTonAccount(key, {}, { secretKind: 'privateKey' })
        expect(friendly).toMatch(/^UQ/)
    })
})

describe('deriveTonAccount — derivedTonMnemonic dali (2026-09-10)', () => {
    const MASTER = 'abandon '.repeat(11) + 'about'

    // ALTIN VEKTOR: tonFromSeed.test.js ile AYNI ana ifade, ayni index.
    const GOLDEN_W5_INDEX_0 = 'UQDqyT778Wrtja0ouo994yPNugR3jM7NAofAgs6WnJg6SveD'
    const GOLDEN_W5_INDEX_1 = 'UQBdUvb886q08Do1hiOOiysAh8rb1k0bqh3TAoLmJ6UR-RqV'

    it('hd kasasindan index 0 icin altin vektoru uretir', async () => {
        const { friendly } = await deriveTonAccount(MASTER, { index: 0 }, {
            secretKind: 'derivedTonMnemonic',
            vaultType: 'hd',
        })
        expect(friendly).toBe(GOLDEN_W5_INDEX_0)
    })

    it('index hesap kaydindan OKUNUR — hesap izolasyonu TON tarafinda yasar', async () => {
        const { friendly } = await deriveTonAccount(MASTER, { index: 1 }, {
            secretKind: 'derivedTonMnemonic',
            vaultType: 'hd',
        })
        expect(friendly).toBe(GOLDEN_W5_INDEX_1)
        expect(friendly).not.toBe(GOLDEN_W5_INDEX_0)
    })

    it('gecersiz index SESSIZCE duzeltilmez', async () => {
        await expect(
            deriveTonAccount(MASTER, { index: -1 }, {
                secretKind: 'derivedTonMnemonic',
                vaultType: 'hd',
            })
        ).rejects.toThrow('TON_INDEX_INVALID')
    })

    // §6 capraz kontrolu: secretKind ile vaultType BAGIMSIZ iki girdidir.
    it('tonMnemonic kasasi + derivedTonMnemonic semasi FIRLATIR', async () => {
        await expect(
            deriveTonAccount(MASTER, { index: 0 }, {
                secretKind: 'derivedTonMnemonic',
                vaultType: 'tonMnemonic',
            })
        ).rejects.toThrow('TON_SECRET_KIND_MISMATCH')
    })

    // Eski SLIP-10 yolu kapatildi: o yolla uretilmis bir adres varsa sessizce
    // BASKA bir adres gostermek yerine GURULTULU patlamali.
    // 2026-09-11: bu test DEPRECATED bekliyordu. Karar degisti -- eski adres
    // ERISILEBILIR kalmali (bkz. tonAccount.js'in 'bip39' dalindaki gerekce).
    it('eski bip39 semasi hd kasasindan GECER ve ESKI adresi verir', async () => {
        const eski = await deriveTonAccount(MASTER, { index: 0 }, { secretKind: 'bip39', vaultType: 'hd' })
        const yeni = await deriveTonAccount(MASTER, { index: 0 }, { secretKind: 'derivedTonMnemonic', vaultType: 'hd' })

        expect(eski.friendly).toMatch(/^UQ/)
        expect(eski.friendly).not.toBe(yeni.friendly)
    })

    // Kapinin varlik sebebi: 'hd' kasasindaki sir bir BIP39 IFADESIDIR.
    // 'tonMnemonic' semasi gecirilirse tonKeyPairFromTonMnemonic onu TON
    // ifadesi sanip turetir ve SESSIZCE yanlis bir adres uretir.
    it('hd kasasi + tonMnemonic semasi FIRLATIR', async () => {
        await expect(
            deriveTonAccount(MASTER, { index: 0 }, {
                secretKind: 'tonMnemonic',
                vaultType: 'hd',
            })
        ).rejects.toThrow('TON_SECRET_KIND_MISMATCH')
    })

    // 'bip39' ISTISNA: DEPRECATED, MISMATCH'ten ONCE gelmeli.
    // hd kasasi + bip39 semasi MISMATCH ATMAZ: capraz kontrolun bilincli
    // istisnasi (tonAccount.js:179). Eskiden ardindan DEPRECATED geliyordu;
    // 2026-09-11'den beri turetme TAMAMLANIYOR. Kilitlenen sey istisnanin
    // KORUNMASI -- kaldirilirsa eski adres bir daha uretilemez.
    it('hd kasasi + bip39 semasi capraz kontrolden GECER', async () => {
        const sonuc = await deriveTonAccount(MASTER, { index: 0 }, { secretKind: 'bip39', vaultType: 'hd' })
        expect(sonuc.friendly).toMatch(/^UQ/)
    })

    // AYNANIN DIGER YUZU HALA KAPALI: tonMnemonic kasasindan bip39 CIKAMAZ.
    it('tonMnemonic kasasi + bip39 semasi MISMATCH verir', async () => {
        await expect(
            deriveTonAccount(MASTER, { index: 0 }, { secretKind: 'bip39', vaultType: 'tonMnemonic' })
        ).rejects.toThrow('TON_SECRET_KIND_MISMATCH')
    })
})
