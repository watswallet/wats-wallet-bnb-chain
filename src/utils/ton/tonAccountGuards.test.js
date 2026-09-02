import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
    // `isTonOnlyAccount\(\s*props\.account\s*\)` alt-dize eslesmesi bir basindaki
    // `!` isaretini FARK ETMEZ - `computed(() => !isTonOnlyAccount(props.account))`
    // de gecerdi. O tersine cevirme TAM OLARAK ters davranis demek: TON hesabinda
    // calismayan EVM ozel anahtari dugmesi GORUNUR, sıradan EVM hesabinda ise
    // GIZLENIR - ve bu blokun butun testleri yine de yesil kalirdi.
    it('tonOnly tanimi TERS CEVRILMEMIS - isTonOnlyAccount dogrudan (basinda ! olmadan) donuyor', () => {
        expect(EDIT).toMatch(/const\s+tonOnly\s*=\s*computed\(\s*\(\)\s*=>\s*isTonOnlyAccount\(\s*props\.account\s*\)\s*\)/)
    })

    // Ozel anahtar dugmesi 'settings_show_private_key' sayfasina gider - o bloga
    // daralttik ki baska bir yerdeki v-if bu testi yaniltmasin.
    const privateKeyButton = (() => {
        const idx = EDIT.indexOf("settings_show_private_key")
        const start = EDIT.lastIndexOf('<button', idx)
        const end = EDIT.indexOf('</button>', idx)
        return EDIT.slice(start, end)
    })()

    it('ozel anahtar dugmesi tonOnly iken gizlenir', () => {
        expect(privateKeyButton).toMatch(/v-if="!tonOnly"/)
    })

    // Kapi SADECE EVM ozel anahtarini gizlemeli - ifade (mnemonic) ve TON anahtari
    // girisleri KALMALI, cunku kullanicinin cuzdanina bu uygulama olmadan da
    // ulasabilmesi gerekir (spec: dogru olan, calismayan bir dugmeyi gostermek
    // degil gizlemektir, ama BASKA bir seyi de gizlememelidir).
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

    it('TON anahtari girisi tonOnly kosuluna baglanmaz - her zaman erisilebilir kalir', () => {
        expect(tonKeyButton).not.toMatch(/tonOnly/)
    })
})

describe('TON hesabi dapp e sunulmaz', () => {
    // Dapp yolu EIP-1193; TON hesabinin EVM adresi YOKTUR. Sunulursa dapp
    // bir TON adresini EVM adresi sanip islem hazirlar.
    //
    // Brief'teki hali `expect(DAPP).toContain('isTonOnlyAccount')` idi - bu, sadece
    // import satiri tarafindan da tatmin edilir. Asagida, active_account'u sayfaya
    // DONDUREN spesifik dala (accounts.includes(...) kosulu) daraltilip kapinin
    // TAM O DALA eklendigi dogrulaniyor - baska bir yerde (mesela kullanilmayan
    // bir yardimci fonksiyonda) durması yeterli olmaz.
    // Capa guncellendi: hizli yolun kosulu artik harf duyarsiz yardimciyla
    // (grantedAccountFor) soruluyor -- bkz. dappFunctions.authz.test.js.
    const activeAccountBranch = (() => {
        const idx = DAPP.indexOf('grantedAccountFor(dapps, hostname, active_account.address)')
        const lineStart = DAPP.lastIndexOf('\n', idx) + 1
        const lineEnd = DAPP.indexOf('\n', idx)
        return DAPP.slice(lineStart, lineEnd)
    })()

    it('dapp e sunulan active_account kosulu isTonOnlyAccount ile daraltilir', () => {
        expect(activeAccountBranch).toMatch(/!isTonOnlyAccount\(active_account\)/)
    })

    it('isTonOnlyAccount accountKind modulunden ice aktarilir', () => {
        expect(DAPP).toMatch(/import\s*\{[^}]*\bisTonOnlyAccount\b[^}]*\}\s*from\s*['"]\.\/accountKind['"]/)
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
            /const dappAddress = isTonOnlyAccount\(acc\)\s*\?\s*null\s*:\s*acc\.address/
        )
        expect(CHANGE_ACCOUNT).toMatch(/type: 'ACCOUNT_CHANGED', address: dappAddress/)
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
