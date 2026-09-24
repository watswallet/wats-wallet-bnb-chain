import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { accountHasEvm } from '../accountKind'
import { tonVaultForAccount } from './tonVaultResolve'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const CREATE = read('../../components/settings/CreateAccount.vue')
const EDIT = read('../../components/settings/accounts/EditAccount.vue')
const DAPP = read('../dappFunctions.js')
const HEADER = read('../../components/Header.vue')
const BACKGROUND = read('../../background.js')

describe('TON kasasina ikinci hesap eklenemez (spec §11)', () => {
    // TON'da turetme yolu YOKTUR: mnemonicToPrivateKey bir ifadeden TEK anahtar
    // uretir. "Hesap 2" BIREBIR AYNI adresi uretirdi - kullanici iki hesap gorur,
    // ikisi tek cuzdandir, birinden harcayinca digeri de bosalir.
    // Kasa listesi IKI YERDE kuruluyor (onMounted ve confirmBackupAndContinue).
    // Yalnizca birini filtrelemek, hesap eklendikten SONRA listenin TON kasasini
    // geri getirmesine yol acar.
    //
    // Iddia artik "dosyada kac satirda tonMnemonic geciyor" DEGIL, IKI FILTRE
    // IFADESININ kendisi. Sayim, dosyaya tonMnemonic gecen baska bir kapi
    // eklendiginde (asagidaki secim kapisi ve create() sert-durdurmasi gibi)
    // ALAKASIZ bir sebeple kirilir ve dogru duzeltmeyi ENGELLER - bu tam olarak
    // yasandi.
    it('kasa listesi tonMnemonic kasalarini IKI YERDE de eler', () => {
        const filters = CREATE.match(
            /\.filter\(\s*v\s*=>\s*v\.type\s*!==\s*'privateKey'\s*&&\s*v\.type\s*!==\s*'tonMnemonic'\s*\)/g
        ) || []
        expect(filters).toHaveLength(2)
    })

    // ASIL KUSUR: LISTE filtreleniyordu ama SECIM filtrelenmiyordu. `activeVault`
    // filtresiz `vaults` uzerinden seciliyor, ice aktarilmis bir TON hesabi
    // aktifken TON kasasi secili kaliyor ve "Olustur" dugmesi ONUN uzerinde
    // calisiyordu. Cift-gecerli bir ifadede (~1/500) HDNodeWallet.fromPhrase
    // BASARILI olur ve TON kasasina bir `hd` hesabi yazilirdi.
    it('aktif kasa SECIMI filtresiz `vaults` uzerinden yapilmaz', () => {
        const line = CREATE.split('\n').find((l) => l.includes('activeVault.value ='))
        expect(line, 'activeVault atamasi bulunamadi').toBeDefined()
        expect(line).not.toMatch(/\bvaults\.find\(/)
    })

    it('aktif kasa adaylari tonMnemonic elenmis kumeden gelir', () => {
        expect(CREATE).toMatch(/const selectableVaults = vaults\.filter\(\s*v\s*=>\s*v\.type\s*!==\s*'tonMnemonic'\s*\)/)
        expect(CREATE).toMatch(/activeVault\.value\s*=\s*selectableVaults\.find\(/)
    })

    // Gorunum/secim kapisi ATLANIRSA diye yazma anindaki sert durdurma. Kosulun
    // varligi yetmez: gercekten FIRLATTIGI ve turetmeden ONCE durdugu olculuyor.
    const CREATE_FN = CREATE.slice(CREATE.indexOf('const create = async'))

    it('create() tonMnemonic kasasinda FIRLATIR', () => {
        expect(CREATE_FN).toMatch(
            /if \(activeVault\.value\?\.type === 'tonMnemonic'\) \{\s*\r?\n\s*throw new Error\('TON_VAULT_SINGLE_ACCOUNT'\)/
        )
    })

    it('sert durdurma TURETMEDEN ve YAZMADAN ONCE calisir', () => {
        const gate = CREATE_FN.indexOf("activeVault.value?.type === 'tonMnemonic'")
        const derive = CREATE_FN.indexOf('HDNodeWallet.fromPhrase')
        const write = CREATE_FN.indexOf('chrome.storage.local.set')
        expect(gate).toBeGreaterThan(-1)
        expect(derive).toBeGreaterThan(gate)
        expect(write).toBeGreaterThan(gate)
    })

    it('kullaniciya SEBEBI soylenir - sessiz basarisizlik degil', () => {
        expect(CREATE_FN).toContain('ton_single_account')
    })

    // Ustteki kapinin BOSLUGU: `activeVault` null oldugunda `?.type` undefined doner
    // ve TON kontrolu SESSIZCE gecilir. Tek kasasi TON kasasi olan kullanicida
    // `activeVault` tam olarak null kaliyordu - `user_vaults` da `selectableVaults`
    // da bos. Dugme canliydi, TON kapisi atlaniyordu, akis `unlockVault(masterKey,
    // null)` icinde patliyordu.
    //
    // Optional chaining'i kaldirmak cozum DEGIL: o zaman null kasa "TON degil"
    // sayilip yine asagi akardi. Eksik olan AYRI bir kontroldu.
    it('create() kasa YOKKEN de FIRLATIR - TON kapisinin boslugu', () => {
        expect(CREATE_FN).toMatch(
            /if \(!activeVault\.value\) \{\s*\r?\n\s*throw new Error\('NO_ELIGIBLE_VAULT'\)/
        )
    })

    it('kasa kontrolu de TURETMEDEN ve YAZMADAN ONCE calisir', () => {
        const gate = CREATE_FN.indexOf('if (!activeVault.value)')
        const derive = CREATE_FN.indexOf('HDNodeWallet.fromPhrase')
        const write = CREATE_FN.indexOf('chrome.storage.local.set')
        expect(gate).toBeGreaterThan(-1)
        expect(derive).toBeGreaterThan(gate)
        expect(write).toBeGreaterThan(gate)
    })

    // Dugme de kapatilmali: sert durdurma kullaniciyi KORUR ama canli bir dugme ona
    // once "olacakmis" hissi verir. Ikisi ayri katman, ikisi de gerekli.
    it('Olustur dugmesi kasa yokken devre disi', () => {
        const line = CREATE.split('\n').find((l) => l.includes(':disabled="loading'))
        expect(line, 'disabled satiri bulunamadi').toBeDefined()
        expect(line).toContain('!activeVault')
    })

    // Bos liste + sebep yazmayan bir ekran, kullaniciya "bir sey ters gitti"
    // dedirtir. Sebep BILINIYOR, yazilmali.
    it('secilebilir kasa yokken ekranda sebep yazar', () => {
        expect(CREATE).toContain('v-if="!user_vaults.length"')
        expect(CREATE).toContain('onlyTonVaults')
    })

    // Sebep DOGRU olmali: `activeVault` null'in tek sebebi TON degil (or. yalnizca
    // privateKey kasasi olup parmak izi eslesmemesi). Iki duruma ayni metni yazmak
    // birine yalan soylemek olurdu.
    it('sebep metni TON durumuna ozel secilir, hepsine ayni metin yazilmaz', () => {
        expect(CREATE).toMatch(
            /onlyTonVaults\.value\s*=\s*vaults\.length > 0 && vaults\.every\(v => v\.type === 'tonMnemonic'\)/
        )
        expect(CREATE).toContain('no_eligible_vault')
    })
})

describe('TON hesabinda EVM anahtari disa aktarilamaz (spec §10)', () => {
    // Brief'teki hali `expect(EDIT).toContain('isTonOnlyAccount')` idi - bu, sadece
    // import satirinin veya bir yorumun kendisi tarafindan tatmin edilir; sembolu
    // ice aktarip hic KULLANMAYAN bir uygulama da gecerdi. Asagida gercekten
    // CAGRILDIGI ve dogru dugmeye BAGLANDIGI ayri ayri dogrulaniyor.

    it('`vue`dan computed ice aktarilir (aksi halde ReferenceError - ekran bombos kalir)', () => {
        expect(EDIT).toMatch(/import\s*\{[^}]*\bcomputed\b[^}]*\}\s*from\s*['"]vue['"]/)
    })

    // Sadece cagriyi degil, TUM tanimi (`const tonOnly = ...`) sabitliyoruz.
    // `props\.account\?\.type === 'ton'` alt-dize eslesmesi bir basindaki `!`
    // isaretini FARK ETMEZ - `computed(() => !(props.account?.type === 'ton'))`
    // de gecerdi. O tersine cevirme TAM OLARAK ters davranis demek: TON hesabinda
    // calismayan EVM ozel anahtari dugmesi GORUNUR, sıradan EVM hesabinda ise
    // GIZLENIR - ve bu blokun butun testleri yine de yesil kalirdi.
    //
    // Gorev 4 (accountKindOf/isTonOnlyAccount temizligi): sembol kod tabanindan
    // tamamen kaldirildi ve dogrudan hesap turu esitligine cevrildi -- eski
    // yardimci zaten bundan baska bir sey degildi, davranis AYNI.
    // IKI AYRI SORU, IKI AYRI KAPI (2026-09-11). Eskiden tek bir `tonOnly`
    // computed'i ikisine birden cevap veriyordu ve bu, TON anahtari dugmesini
    // HICBIR kullaniciya gostermeyen bir kusur dogurdu (asagi bak).
    it('EVM anahtari kapisi hesap turunu DOGRUDAN (basinda ! olmadan) karsilastirir', () => {
        expect(EDIT).not.toContain('isTonOnlyAccount')
        expect(EDIT).toMatch(/const\s+evmKeyYok\s*=\s*computed\(\s*\(\)\s*=>\s*props\.account\?\.type\s*===\s*'ton'\s*\)/)
    })

    // ASIL KUSUR: TON anahtari kapisi da `type === 'ton'` idi. O turu artik
    // HICBIR akis uretmiyor (kayit defteri R6) -- yeni hesaplar da, ice
    // aktarilan Tonkeeper hesabi da `type:'hd'`. Yani dugme hicbir kullaniciya
    // GORUNMUYORDU ve Gorev 9'un turetilmis-ifade paneli OLU KODDU. Kapi artik
    // `tonIdentityForAccount`in kendi kapisiyla AYNI soruyu soruyor.
    it('TON anahtari kapisi TURE degil YETENEGE bakar', () => {
        expect(EDIT).toMatch(/const\s+tonKeyVar\s*=\s*computed\(\s*\(\)\s*=>\s*accountHasTon\(props\.account\)\s*\)/)
        expect(EDIT).not.toMatch(/const\s+tonKeyVar\s*=[^\n]*type\s*===\s*'ton'/)
    })

    // Ozel anahtar dugmesi 'settings_show_private_key' sayfasina gider - o bloga
    // daralttik ki baska bir yerdeki v-if bu testi yaniltmasin.
    const privateKeyButton = (() => {
        const idx = EDIT.indexOf("settings_show_private_key")
        const start = EDIT.lastIndexOf('<button', idx)
        const end = EDIT.indexOf('</button>', idx)
        return EDIT.slice(start, end)
    })()

    it('ozel anahtar dugmesi legacy TON hesabinda gizlenir', () => {
        expect(privateKeyButton).toMatch(/v-if="!evmKeyYok"/)
    })

    // Kapi SADECE EVM ozel anahtarini gizlemeli - ifade (mnemonic) girisi HER
    // ZAMAN KALMALI, cunku kullanicinin cuzdanina bu uygulama olmadan da
    // ulasabilmesi gerekir (spec: dogru olan, calismayan bir dugmeyi gostermek
    // degil gizlemektir, ama BASKA bir seyi de gizlememelidir).
    // (TON anahtari girisi icin AYNI kural GECERLI DEGIL: o giris artik `tonOnly`
    // kosuluna baglidir, asagidaki "TON anahtari girisi YALNIZCA TON hesabinda
    // gorunur" testine bakin.)
    const phraseButton = (() => {
        const idx = EDIT.indexOf("settings_show_phrases")
        const start = EDIT.lastIndexOf('<button', idx)
        const end = EDIT.indexOf('</button>', idx)
        return EDIT.slice(start, end)
    })()

    const tonKeyButton = (() => {
        const idx = EDIT.indexOf("settings_show_ton_key")
        const start = EDIT.lastIndexOf('<button', idx)
        const end = EDIT.indexOf('</button>', idx)
        return EDIT.slice(start, end)
    })()

    it('kurtarma ifadesi girisi tonOnly kosuluna baglanmaz - her zaman erisilebilir kalir', () => {
        expect(phraseButton).not.toMatch(/tonOnly/)
    })

    // BU TEST TERS CEVRILDI (2026-09-05 tasarim belgesi, adim 11).
    //
    // Eski hâli "TON anahtari girisi tonOnly kosuluna baglanmaz - her zaman
    // erisilebilir kalir" idi ve o gun DOGRUYDU: hibrit modelde her hesabin
    // turetilmis bir TON adresi vardi, yani her hesapta gosterilecek bir TON
    // anahtari VARDI. Manuel TON modelinde artik yok: EVM hesabinda bu dugmeye
    // basan kullanici DOGRU sifresini yaziyor ve `error_wrong_pass` yiyor --
    // ShowTonKey.vue sifreyi dogruluyor, sonra tonIdentityForAccount kapida
    // reddediyor ve ekran o hatayi "yanlis sifre" diye cevirip gosteriyor.
    // Kullaniciya soylenen sey YANLIS ve tam olarak paniklemesi gereken sey.
    //
    // Ifade girisi (settings_show_phrases) HER IKI hesap turunde de acik KALIR --
    // asagidaki komsu test onu kilitliyor.
    it('TON anahtari girisi TON u OLAN her hesapta gorunur', () => {
        expect(tonKeyButton).toMatch(/v-if="tonKeyVar"/)
    })

    // Polarite iddiasi: `v-if="!tonOnly"` de yukaridaki alt-dize eslesmesini
    // GECERDI ve davranis tam tersine donerdi.
    it('TON anahtari kapisi TERS CEVRILMEMIS', () => {
        expect(tonKeyButton).not.toMatch(/v-if="!tonOnly"/)
    })
})

describe('TON hesabi dapp e sunulmaz', () => {
    // Dapp yolu EIP-1193; TON hesabinin EVM adresi YOKTUR. Sunulursa dapp
    // bir TON adresini EVM adresi sanip islem hazirlar.
    //
    // GOREV 5 GUNCELLEMESI: bu iddia eskiden hizli yolun kosulunun ICINE
    // gomulu, hesap turune bakan bir `&&` parcasini ariyordu. Gorev 5 o
    // parcayi KALDIRDI ve YERINE, hizli yoldan (ve
    // onay penceresi acilisindan) ONCE calisan AYRI bir fail-open erken-
    // donus koydu (bkz. dappFunctions.js:handleConnectWallet, "HESAP
    // KAPISI" yorumu) -- kapsanan nufus AYNI (aktif hesap TON ise dapp'e
    // hicbir adres sunulmaz), mekanizma degisti. Asagida once YENI kapinin
    // VARLIGI/TIPI, sonra hizli yoldan ONCE calistigi sinaniyor --
    // davranissal ikizi dappFunctions.authz.test.js'teki "TON hesabi
    // aktifken 4100 doner" testidir.
    //
    // GUNCELLEME (2026-09-10 Gorev 4, tekil aileden kumeye gecis): kapi
    // `accountHasTon(active_account)` DEGIL `active_account?.type === 'ton'`.
    // Kumeye gecince (accountKind.js) `accountHasTon` `type:'hd'` icin de
    // `true` doner ve eski kapi butun siradan EVM kullanicilarini (buyuk
    // cogunluk) dapp baglantisindan REDDEDERDI (background.evmGates.test.js
    // bunu yakaladi). Dogrudan tip kontrolu -- fail-open ozelligi KORUNUR:
    // turu bilinmeyen hesapta `type === 'ton'` false doner, yani gecer.
    const CONNECT_FN = DAPP.slice(
        DAPP.indexOf('export async function handleConnectWallet'),
        DAPP.indexOf('export async function sendTxDapp'),
    )

    it('handleConnectWallet TON hesabini hesap turuyle erken reddeder (fail-open: turu bilinmeyen hesap gecer)', () => {
        expect(CONNECT_FN).toMatch(
            /if \(active_account\?\.type === 'ton'\) \{\s*\r?\n\s*sendResponse\(\{ error: UNAUTHORIZED \}\)\s*\r?\n\s*return\s*\r?\n\s*\}/
        )
        expect(CONNECT_FN).not.toContain('accountHasTon(active_account)')
    })

    it('hesap kapisi grantedAccountFor hizli yolundan ONCE calisir', () => {
        const gate = CONNECT_FN.indexOf("active_account?.type === 'ton'")
        const fastPath = CONNECT_FN.indexOf('grantedAccountFor(dapps, hostname, active_account.address)')
        expect(gate, 'hesap turu kapisi handleConnectWallet govdesinde bulunamadi').toBeGreaterThan(-1)
        expect(fastPath, 'grantedAccountFor hizli yolu bulunamadi').toBeGreaterThan(-1)
        expect(fastPath).toBeGreaterThan(gate)
    })
})

describe('hesap degisiminde TON adresi dapp e YAYINLANMAZ', () => {
    // dappFunctions.js'teki kapi YALNIZCA zaten bagli olan hizli yolu kapsiyor
    // (active_account'un dapp'e SUNULMASI). Hesap DEGISIMINDE Header ayrica
    // ACCOUNT_CHANGED yayinliyor ve arka plan onu butun bagli sekmelere
    // notifyConnectedDapps('accountsChanged', [adres]) olarak gonderiyor.
    //
    // TON hesabinda `acc.address` bir TON adresidir (spec §5): dapp base64 bir
    // dizeyi selectedAddress sanir - checksum dogrulayan dapp'ler coker,
    // dogrulamayanlar onu kullanicinin Ethereum hesabi diye gosterir. O hesaptan
    // imza HICBIR ZAMAN uretilemez, yani dogru bildirim "hesap yok"tur.
    const CHANGE_ACCOUNT = HEADER.slice(
        HEADER.indexOf('const changeAccount'),
        HEADER.indexOf('const copyRow')
    )

    it('ACCOUNT_CHANGED e ham acc.address GONDERILMEZ', () => {
        const line = CHANGE_ACCOUNT.split('\n').find((l) => l.includes("type: 'ACCOUNT_CHANGED'"))
        expect(line, 'ACCOUNT_CHANGED gonderimi bulunamadi').toBeDefined()
        expect(line).not.toMatch(/address:\s*acc\.address/)
    })

    it('TON hesabinda adres yerine null (baglanti kesildi) gonderilir', () => {
        expect(CHANGE_ACCOUNT).toMatch(
            /const dappAddress = accountHasEvm\(acc\)\s*\?\s*acc\.address\s*:\s*null/
        )
        expect(CHANGE_ACCOUNT).toMatch(/type: 'ACCOUNT_CHANGED', address: dappAddress/)
    })

    // FIX 3 (kucuk bulgu, fix dalgasi): eski kapi hesap turunu tersinden sorup
    // "TON ise null, degilse acc.address" diyordu -- FAIL-OPEN. O eski kapi
    // bilinmeyen/eksik bir `type` icin de "TON degil" sayardi, yani tipi
    // TANINMAYAN bir hesap bu satirdan `acc.address`iyle GECERDI. Bu branch'teki
    // dapp'e giden diger her KALICI EVM boru hatti (handleGetAccounts,
    // sendTxDapp, signMessageDapp, handleConnectWallet) FAIL-CLOSED; burasi tek
    // istisnaydi ve `0x` kemeri de yoktu. Yeni kapi `accountHasEvm(acc) ?
    // acc.address : null` -- hesap EVM oldugunu KANITLAMADIKCA `null` gonderilir.
    it('tipi BILINMEYEN hesapta da null gonderilir (fail-closed, eski kapi fail-open idi)', () => {
        const dappAddressFor = (acc) => (accountHasEvm(acc) ? acc.address : null)

        // Eski (tersinden soran) kapiyla bu uc de `acc.address`i AYNEN
        // dondururdu - ikisi tip alani hic tasimiyor, biri hem tip HEM 0x
        // onekini tasimiyor.
        expect(dappAddressFor({ address: '0xDeadBeef00000000000000000000000000000001' })).toBeNull()
        expect(dappAddressFor({ type: 'unknown', address: '0xDeadBeef00000000000000000000000000000001' })).toBeNull()
        expect(dappAddressFor({ type: 'unknown', address: 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r' })).toBeNull()

        // Gercek EVM hesabinda davranis DEGISMEDI: adres yine gonderilir.
        expect(dappAddressFor({ type: 'hd', address: '0xDeadBeef00000000000000000000000000000001' }))
            .toBe('0xDeadBeef00000000000000000000000000000001')
    })

    // Arka plandaki cevirinin GERCEKTEN bos dizi urettigi - DISCONNECT_DAPP ile
    // AYNI sekil. Bu satir degisirse (or. `?? ''`) null bir dapp'e bos DIZE
    // olarak gider ve yukaridaki kapi sessizce anlamsizlasir.
    it('arka plan null adresi BOS DIZIYE cevirir (DISCONNECT_DAPP ile ayni sekil)', () => {
        const handler = BACKGROUND.slice(
            BACKGROUND.indexOf('case "ACCOUNT_CHANGED"'),
            BACKGROUND.indexOf('case "DISCONNECT_DAPP"')
        )
        expect(handler).toContain("notifyConnectedDapps('accountsChanged', message.address ? [message.address] : [])")
    })
})

const TON_IDENTITY = read('./tonIdentity.js')

// TURETME BOGAZINDAKI HESAP KAPISI (spec §3).
//
// `tonVaultForAccount`in `tonFingerprint` dali KORUNDU ama ERISILEMEZ: o dala
// giden tek nufus `type:'hd'` + `tonFingerprint` tasiyan eski hibrit kayittir ve
// ustteki `accountHasTon` kapisi onu zaten reddediyor. Dal SILINMIYOR cunku
// `tonSecretForAccount` / `tonIdentityForAccount` ikilisinin AYNI cozumleyiciyi
// kullanma sozlesmesi ondan geciyor. Erisilemezlik burada IDDIA olarak duruyor:
// kapi silinirse ya da cozumlemenin ALTINA kayarsa bu blok kizarir.
describe('turetme bogazinda hesap kapisi (spec §3)', () => {
    it('kapi TON olmayan hesabi TON_ACCOUNT_REQUIRED ile reddeder', () => {
        expect(TON_IDENTITY).toMatch(
            /if \(!accountHasTon\(account\)\) throw new Error\('TON_ACCOUNT_REQUIRED'\)/
        )
    })

    it('accountHasTon accountKind modulunden ice aktarilir', () => {
        expect(TON_IDENTITY).toMatch(
            /import\s*\{[^}]*\baccountHasTon\b[^}]*\}\s*from\s*['"]\.\.\/accountKind['"]/
        )
    })

    // SIRA kritik: kapi kasa cozumlemesinden SONRA konsaydi reddedilen hesap icin
    // once kasa aranir, sonra reddedilirdi - ve tonFingerprint dali ERISILEBILIR
    // kalirdi.
    it('kapi kasa cozumlemesinden ONCE gelir', () => {
        const fn = TON_IDENTITY.slice(TON_IDENTITY.indexOf('export async function tonIdentityForAccount('))
        const gate = fn.indexOf('accountHasTon(account)')
        const resolve = fn.indexOf('tonVaultForAccount(')
        expect(gate, 'kapi tonIdentityForAccount govdesinde bulunamadi').toBeGreaterThan(-1)
        expect(resolve).toBeGreaterThan(gate)
    })

    // BU TEST BOSALMISTI (final inceleme bulgusu, 2026-09-11): bir YORUMDA
    // 'ERISILEMEZ' kelimesini ariyordu. Yorum Gorev 2'den beri zaten yanlisti
    // (dal ARTIK ERISILEBILIR) ve daha kotusu, `accountHasTon` kapisi gercekten
    // kaldirilsa test YINE YESIL kalirdi. Iddia metne degil DAVRANISA baglandi.
    it('dangling tonFingerprint TON_VAULT_NOT_FOUND ile duser, EVM kasasina DUSMEZ', () => {
        // Dususe izin verilseydi hibrit bir hesabin TON adresi sessizce EVM
        // kasasindan turetilir ve kullaniciya A adresi gosterilirken B'nin
        // anahtariyla imzalanirdi.
        const hdKasa = { fingerprint: 'f-hd', type: 'hd', accounts: [] }
        const hesap = { key: 'a', type: 'hd', fingerprint: 'f-hd', tonFingerprint: 'ARTIK-YOK' }
        hdKasa.accounts = [hesap]

        expect(() => tonVaultForAccount([hdKasa], hesap)).toThrow('TON_VAULT_NOT_FOUND')
    })

    it('tonFingerprint COZULUYORSA o kasa doner -- dal ERISILEBILIR', () => {
        const hdKasa = { fingerprint: 'f-hd', type: 'hd', accounts: [] }
        const tonKasa = { fingerprint: 'f-ton', type: 'tonMnemonic', accounts: [] }
        const hesap = { key: 'a', type: 'hd', fingerprint: 'f-hd', tonFingerprint: 'f-ton' }
        hdKasa.accounts = [hesap]

        expect(tonVaultForAccount([hdKasa, tonKasa], hesap)).toBe(tonKasa)
    })
})
