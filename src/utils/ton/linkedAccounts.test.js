import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { accountsForVaultDisplay, isDerivedEvmVault } from './linkedAccounts'

// YALNIZCA ESKI KAYIT. INV-1: her hesap tam olarak bir kasanin accounts[] dizisinde
// bulunur ve TON kasasi kendi type:'ton' hesabini TASIR. Eski hibrit profillerde ise
// hesapsiz TON kasalari var ve kullanicinin Tonkeeper ifadesini yedekledigi yer O
// kasa -- listeden gizlenemez, gizlenseydi ANA ifadeye ulasilamazdi.
describe('accountsForVaultDisplay', () => {
    const HYBRID = { key: 'k1', name: 'Wats 2', address: '0xabc', tonFingerprint: 'F_TON' }
    const EVM_VAULT = { type: 'hd', fingerprint: 'F_EVM', accounts: [HYBRID] }
    const TON_VAULT = { type: 'tonMnemonic', fingerprint: 'F_TON', accounts: [] }

    it('kasanin KENDI hesaplari varsa onlari doner', () => {
        expect(accountsForVaultDisplay([EVM_VAULT, TON_VAULT], EVM_VAULT)).toBe(EVM_VAULT.accounts)
    })

    it('hesapsiz kasada tonFingerprint ile BAGLI hesaplari doner', () => {
        expect(accountsForVaultDisplay([EVM_VAULT, TON_VAULT], TON_VAULT)).toEqual([HYBRID])
    })

    it('hicbir hesap bagli degilse BOS dizi doner', () => {
        const orphan = { type: 'tonMnemonic', fingerprint: 'F_YOK', accounts: [] }
        expect(accountsForVaultDisplay([EVM_VAULT, orphan], orphan)).toEqual([])
    })

    it('bozuk girdide cokmez', () => {
        expect(accountsForVaultDisplay(undefined, undefined)).toEqual([])
        expect(accountsForVaultDisplay(null, { fingerprint: 'X' })).toEqual([])
    })

    // Ayni ifadeden birden fazla hesap turetilmis olabilir.
    it('BIRDEN FAZLA bagli hesabi da doner', () => {
        const a2 = { key: 'k2', name: 'Wats 4', address: '0xdef', tonFingerprint: 'F_TON' }
        const v2 = { type: 'hd', fingerprint: 'F_EVM2', accounts: [a2] }
        expect(accountsForVaultDisplay([EVM_VAULT, v2, TON_VAULT], TON_VAULT)).toEqual([HYBRID, a2])
    })
})

// KASA duzeyinde ayirt etme. Ayarlar -> Guvenlik -> Yedekleme yolunda kullanici
// HESABI degil KASAYI seciyor; ekranin elinde `account.tonFingerprint` yok, yalnizca
// kasa var. Turetilmis EVM kasasi ile ice aktarilmis TON kasasi ayirt EDILEMEZSE
// ya uyari hic gorunmez (kullanici turetilmis ifadeyi yedekleyip TON'u kaybeder)
// ya da TON kasasinda da gorunur (kullanici ANA ifadesine bakarken "bu yetmez"
// yazisini okur ve olmayan bir ikinci ifade arar).
describe('isDerivedEvmVault', () => {
    const HYBRID = { key: 'k1', name: 'Wats 2', address: '0xabc', tonFingerprint: 'F_TON' }
    const EVM_VAULT = { type: 'hd', fingerprint: 'F_EVM', accounts: [HYBRID] }
    const TON_VAULT = { type: 'tonMnemonic', fingerprint: 'F_TON', accounts: [] }

    it('tonFingerprint tasiyan hesabi olan kasada TRUE doner', () => {
        expect(isDerivedEvmVault(EVM_VAULT)).toBe(true)
    })

    // TON kasasi ANA ifadeyi gosterir: uyari orada YANLIS olur. `accounts: []`
    // oldugu icin bu kapi onu dogal olarak disarida birakir.
    it('TON kasasinda FALSE doner - ana ifade uyari ISTEMEZ', () => {
        expect(isDerivedEvmVault(TON_VAULT)).toBe(false)
    })

    it('siradan HD kasasinda FALSE doner', () => {
        const plain = { type: 'hd', fingerprint: 'F_X', accounts: [{ name: 'A', address: '0x1' }] }
        expect(isDerivedEvmVault(plain)).toBe(false)
    })

    // Kasada birden fazla hesap olabilir ve hibrit olan ilk sirada olmayabilir.
    it('hibrit hesap dizinin SONUNDA olsa da TRUE doner', () => {
        const mixed = { type: 'hd', accounts: [{ name: 'A', address: '0x1' }, HYBRID] }
        expect(isDerivedEvmVault(mixed)).toBe(true)
    })

    // Depodan gelen kasa yarim olabilir; cokme, uyariyi gostermemekten daha kotu:
    // butun ekran bos kalirdi.
    it('bozuk girdide cokmez', () => {
        expect(isDerivedEvmVault(undefined)).toBe(false)
        expect(isDerivedEvmVault(null)).toBe(false)
        expect(isDerivedEvmVault({})).toBe(false)
        expect(isDerivedEvmVault({ accounts: null })).toBe(false)
        expect(isDerivedEvmVault({ accounts: 'bozuk' })).toBe(false)
        expect(isDerivedEvmVault({ accounts: [null, undefined] })).toBe(false)
    })

    // Bos string bir parmak izi DEGIL: `!!` ile degil, varlik ile olculmemeli.
    it('BOS tonFingerprint bag SAYILMAZ', () => {
        expect(isDerivedEvmVault({ accounts: [{ tonFingerprint: '' }] })).toBe(false)
    })

    // INV-1 ALTINDAKI GERCEK TON KASASI. Yukaridaki TON_VAULT eski modeldir
    // (`accounts: []`) ve kapiyi DOGAL OLARAK gecemiyordu -- ama o gerekce artik
    // curuk: TON kasasi kendi type:'ton' hesabini TASIYOR. Kapinin bugunku dogru
    // gerekcesi baska: o hesapta `tonFingerprint` alani YOKTUR, cunku o alan
    // yalnizca eski hibrit kayitta vardi. Kapi tonFingerprint'e bakar, hesap
    // sayisina DEGIL -- ve bu testin varlik sebebi tam olarak budur.
    it('INV-1 TON kasasi (kendi hesabini TASIR) yine FALSE doner', () => {
        const tonAccount = {
            key: 'k-ton', name: 'TON 1', type: 'ton',
            address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG',
            fingerprint: 'F_TON_NEW',
        }
        const vault = { type: 'tonMnemonic', fingerprint: 'F_TON_NEW', accounts: [tonAccount] }
        expect(isDerivedEvmVault(vault)).toBe(false)
        // Ayni kasa kendi hesabini listeler: bagli-hesap dalina HIC girilmez.
        expect(accountsForVaultDisplay([vault], vault)).toBe(vault.accounts)
    })
})

// DOM testi yazilamiyor (bu repoda jsdom/@vue/test-utils yok, vitest environment
// 'node'); kosul KAYNAK METINDEN olculuyor - deponun swapWiring/headerClickable
// dosyalarindaki ayni desen.
//
// DOSYA SECIMI KRITIK: `components/settings/SelectPhrase.vue` App.vue:23'te YORUM
// SATIRINDA - hicbir sayfa onu mount etmiyor. Canli ekran budur: Guvenlik ->
// "Kurtarma ifadesini goster" (Security.vue) -> settings_security_select_phrases.
// Olu dosyaya bakan bir iddia bu kusuru zaten bir kez gecirdi.
describe('security/SelectPhrases.vue yardimciyi kullanir', () => {
    const SRC = readFileSync(fileURLToPath(new URL(
        '../../components/settings/security/SelectPhrases.vue', import.meta.url)), 'utf8')

    it('accountsForVaultDisplay i ice aktarir', () => {
        expect(SRC).toMatch(
            /import\s*\{[^}]*\baccountsForVaultDisplay\b[^}]*\}\s*from\s*['"][^'"]*linkedAccounts['"]/)
    })

    // Ham `vault.accounts` kalirsa hesapsiz TON kasasi bos bir hesap seridiyle
    // cikar - kullanici onu "bos kasa" sanip ANA ifadesini yedeklemeden gecer.
    it('sablonda ham vault.accounts KALMAZ', () => {
        const tpl = SRC.slice(0, SRC.indexOf('</template>'))
        expect(tpl).not.toContain('vault.accounts')
    })

    // YOKLUKLA TATMIN OLAN IDDIA HICBIR SEY OLCMEZ: ustteki `not.toContain` v-for
    // satiri tamamen SILINSE de yesil kalir - hesap seridi hic cizilmez ve ekran
    // sessizce bosalir. Once VARLIK.
    it('sablon accountsOf(vault) i GERCEKTEN cagirir', () => {
        const tpl = SRC.slice(0, SRC.indexOf('</template>'))
        expect(tpl).toContain('accountsOf(vault)')
    })

    it('accountsOf yardimcinin uzerine kuruludur', () => {
        expect(SRC).toMatch(/const\s+accountsOf\s*=[\s\S]{0,120}accountsForVaultDisplay\(/)
    })
})

// Hibrit hesapta bu ekran TURETILMIS BIP39 ifadesini gosterir. Bu dogrudur ve
// kasitlidir - kullanici onu MetaMask'e yazabilsin diye. Ama TEK BASINA yeterli
// DEGILDIR: TON tarafini kurtarmaz. Kullanici "kurtarma ifademi yedekledim" deyip
// Tonkeeper ifadesini atarsa TON parasini kaybeder.
describe('ShowPhrases.vue ana ifadenin hangisi oldugunu soyler', () => {
    const SRC = readFileSync(fileURLToPath(new URL(
        '../../components/settings/accounts/ShowPhrases.vue', import.meta.url)), 'utf8')

    it('not metnini i18n den alir', () => {
        expect(SRC).toContain('settings.account.showPhrases.ton_master_note')
    })

    // Not YALNIZCA hibrit hesapta gorunmeli: siradan bir HD hesabinda gosterilseydi
    // ortada olmayan bir Tonkeeper ifadesi aranirdi.
    it('not tonFingerprint kapisina baglidir', () => {
        const tpl = SRC.slice(0, SRC.indexOf('</template>'))
        const line = tpl.split('\n').find((l) => l.includes('ton_master_note'))
        expect(line, 'not satiri sablonda bulunamadi').toBeDefined()
        expect(tpl).toContain('v-if="isHybrid"')
    })

    // `[^)]*` KULLANMA: computed(() => ...) icindeki bos parantez ilk `)` olur ve
    // eslesme tonFingerprint'e HIC ulasmaz - iddia dogru kodda bile kirmizi kalir.
    it('isHybrid account.tonFingerprint ten hesaplanir', () => {
        expect(SRC).toMatch(/const\s+isHybrid\s*=\s*computed\([\s\S]*?tonFingerprint/)
    })
})

// YENI HESAP TURU, YENI NOT. `type:'ton'` hesapta bu ekran findVaultForAccount ile
// TON kasasini cozer ve 24 KELIMELIK ANA TON IFADESINI gosterir.
//
// Notsuz birakilirsa kullanici o 24 kelimeyi BIP39 saniyor -- ekranin basligi
// "kurtarma ifadesi" diyor ve deponun geri kalaninda o her zaman bir BIP39
// ifadesiydi. MetaMask'e yazmayi deniyor, "gecersiz ifade" aliyor ve elindeki
// ifadenin BOZUK oldugunu sanip yeni bir cuzdan kuruyor. Ifade dogrudur; yanlis
// olan ekranin sustugu sey.
//
// Iki not BIRBIRINI DISLAR ve ikisi de KALIR: `isHybrid` ESKI hibrit kayit icin
// (type:'hd' + tonFingerprint, turetilmis EVM ifadesi gosterir), `isTonAccount`
// YENI model icin (type:'ton', ana TON ifadesi gosterir).
describe('ShowPhrases.vue TON hesabinda TON alt basligini gosterir', () => {
    const SRC = readFileSync(fileURLToPath(new URL(
        '../../components/settings/accounts/ShowPhrases.vue', import.meta.url)), 'utf8')
    const TPL = SRC.slice(0, SRC.indexOf('</template>'))

    it('not metnini i18n den alir', () => {
        expect(TPL).toContain('settings.account.showPhrases.ton_account_note')
    })

    it('not isTonAccount kapisina baglidir', () => {
        const line = TPL.split('\n').find((l) => l.includes('ton_account_note'))
        expect(line, 'TON not satiri sablonda bulunamadi').toBeDefined()
        expect(TPL).toContain('v-if="isTonAccount"')
    })

    // `[^)]*` KULLANMA: computed(() => ...) icindeki bos parantez ilk `)` olur ve
    // eslesme accountHasTon'a HIC ulasmaz - iddia dogru kodda bile kirmizi kalir.
    // 2026-09-11: `accountHasTon` YANLIS soruydu (final inceleme bulgusu).
    // Kumeye gecince o fonksiyon HER `type:'hd'` hesapta true donuyor ve bu ekran
    // ANA BIP-39 IFADESINI gosterirken ustune "bu bir TON ifadesidir, Ethereum
    // cuzdanini geri getirmez" notunu basiyordu -- yani kullaniciya elindeki
    // ifadenin EVM yedegi OLMADIGINI soyluyorduk. Tam tersi dogru.
    //
    // Dogru soru: BU EKRANIN GOSTERDIGI ifade TON-native mi. Cevap kasadan gelir
    // ve yalnizca `type:'ton'` hesapta findVaultForAccount bir tonMnemonic kasasi
    // cozer.
    it('isTonAccount hesap TURUNDEN hesaplanir, yetenekten DEGIL', () => {
        expect(SRC).toMatch(/const\s+isTonAccount\s*=\s*computed\([\s\S]{0,80}?type\s*===\s*'ton'/)
        expect(SRC).not.toMatch(/const\s+isTonAccount\s*=\s*computed\([\s\S]{0,80}?accountHasTon\(/)
    })

    // Ekran artik `accountHasTon`a HIC ihtiyac duymuyor; kullanilmayan bir
    // ithalin durmasi bir sonraki okuyucuyu yanlis kapiya goturur.
    // Yorumda gecmesi SERBEST -- o soruyu neden SORMADIGIMIZ orada yazili.
    // Aranan sey CALISAN bir ithal/cagri satiridir.
    it('kullanilmayan accountHasTon ithali KALMADI', () => {
        expect(SRC).not.toMatch(/^\s*import[^\n]*\baccountHasTon\b/m)
        expect(SRC).not.toMatch(/accountHasTon\(/)
    })

    // ESKI notun SILINMEDIGINI kilitle: eski hibrit hesaplar hala turetilmis ifade
    // gosteriyor ve tek durustluk sinyalleri o not.
    it('eski hibrit notu (isHybrid) KORUNUR', () => {
        expect(TPL).toContain('settings.account.showPhrases.ton_master_note')
        expect(TPL).toContain('v-if="isHybrid"')
    })
})

// AYNI uyari IKINCI bir yoldan da ulasilabilen bir ekranda gerekiyor.
//
// ShowPhrases.vue HESAP yoludur (Hesabi Duzenle -> Kurtarma ifadesi). KASA yolu
// bambaska: Guvenlik -> Yedekleme -> SelectPhrases -> UnlockVault -> ShowPhrase.
// Ikincisi notsuzdu ve `docs/ton-evm-turetme.md` kullaniciyi TAM ORAYA yolluyor
// ("Ayarlar -> Guvenlik -> Yedekleme altinda gorebilir"). Deponun kendi dokumanini
// izleyen kullanici turetilmis EVM ifadesini yazar, "yedeklendim" der ve TON'u
// yedeklemez - KALICI para kaybi.
describe('security/ShowPhrase.vue de ana ifade notunu gosterir', () => {
    const SRC = readFileSync(fileURLToPath(new URL(
        '../../components/settings/security/ShowPhrase.vue', import.meta.url)), 'utf8')
    const TPL = SRC.slice(0, SRC.indexOf('</template>'))

    // AYNI i18n anahtari: ikinci bir kopya metin kacinilmaz olarak ayrisirdi.
    it('AYNI i18n anahtarini kullanir', () => {
        expect(TPL).toContain('settings.account.showPhrases.ton_master_note')
    })

    it('isDerivedEvmVault i ice aktarir', () => {
        expect(SRC).toMatch(
            /import\s*\{[^}]*\bisDerivedEvmVault\b[^}]*\}\s*from\s*['"][^'"]*linkedAccounts['"]/)
    })

    // Kosulsuz gosterilseydi TON kasasinda da cikardi: kullanici ANA ifadesine
    // bakarken "bu ifade yetmez" okur ve olmayan bir ikinci ifade arardi.
    it('not KASA kapisina baglidir', () => {
        const line = TPL.split('\n').find((l) => l.includes('ton_master_note'))
        expect(line, 'not satiri sablonda bulunamadi').toBeDefined()
        expect(TPL).toContain('v-if="isDerivedEvm"')
    })

    // `[^)]*` KULLANMA: computed(() => ...) icindeki bos parantez ilk `)` olur ve
    // eslesme isDerivedEvmVault'a HIC ulasmaz - iddia dogru kodda bile kirmizi kalir.
    it('isDerivedEvm yardimcidan hesaplanir', () => {
        expect(SRC).toMatch(/const\s+isDerivedEvm\s*=\s*computed\([\s\S]*?isDerivedEvmVault\(/)
    })

    // Kasa prop olarak gelmezse kapi HER ZAMAN kapali kalir ve uyari HIC gorunmez -
    // sessiz basarisizlik, tam da duzeltilen kusurun kendisi.
    it('vault i prop olarak alir', () => {
        expect(SRC).toMatch(/defineProps\(\[[^\]]*'vault'/)
    })
})

// Prop bildirilmis olmasi yetmez: App.vue onu GECIRMEZSE uyari yine hic gorunmez.
describe('App.vue kasayi ShowPhrase e gecirir', () => {
    const SRC = readFileSync(fileURLToPath(new URL(
        '../../popup/App.vue', import.meta.url)), 'utf8')

    it('ShowPhrase e :vault="selected_vault" verir', () => {
        const line = SRC.split('\n').find((l) => l.includes('<ShowPhrase '))
        expect(line, 'ShowPhrase mount satiri bulunamadi').toBeDefined()
        expect(line).toContain(':vault="selected_vault"')
    })
})

describe('ShowPhrases notlari her iki dilde de tanimli', () => {
    const load = (lang) => JSON.parse(readFileSync(
        fileURLToPath(new URL(`../../i18n/locales/${lang}.json`, import.meta.url)), 'utf8'))

    it.each([['tr'], ['en']])('%s: ton_master_note', (lang) => {
        const note = load(lang).settings?.account?.showPhrases?.ton_master_note
        expect(note, `${lang}.json: ton_master_note yok`).toBeTruthy()
    })

    it.each([['tr'], ['en']])('%s: ton_account_note', (lang) => {
        const note = load(lang).settings?.account?.showPhrases?.ton_account_note
        expect(note, `${lang}.json: ton_account_note yok`).toBeTruthy()
    })
})

const readRel = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// ESKI KURALIN DUZ YAZISI SILINDI (2026-09-05 tasarim belgesi §2.4).
//
// TON tasarim belgesinin 6.1 sayili eski kurali ("TON kasasi hesapsizdir")
// 2026-08-29 belgesinin kuraliydi ve IPTAL EDILDI; yerine INV-1 gecti. Yorumlarin
// spec oldugu bir depoda eski yorum birakmak IKI CEVAP YAYINLAMAKTIR: en kritigi
// `isDerivedEvmVault`in basligiydi -- DOGRU bir sonucu artik CURUMUS bir sebeple
// savunuyordu, yani kapiyi "gereksiz" sanip silecek birine hazir bir gerekce
// sunuyordu.
//
// KAPSAM ACIKCA ALTI DOSYA. Kor bir depo genelinde tarama YAPILMAZ: ayni bolum
// numarasi SOLANA tasarim belgesinin 6.1 sayili bolumu (imzalayici kilidi) olarak
// 12 kez daha geciyor (solanaDappFunctions.js, SolanaSignTx.vue ve testleri) ve o
// BASKA bir belgedir.
//
// `OLD_RULE` PARCALI kuruluyor VE BU YORUMDA DA DIZE CONTIGUOUS YAZILMAZ: bu dosya
// kendi kendini de tariyor ve dizeyi duz yazsaydik iddia SONSUZA KADAR kirmizi
// kalirdi.
describe('iptal edilen 6.1 sayili duz yazi geri gelmez (INV-1)', () => {
    const OLD_RULE = '§' + '6.1'

    const FILES = [
        './linkedAccounts.js',
        './linkedAccounts.test.js',
        '../../components/settings/SelectPhrase.vue',
        '../../components/settings/security/SelectPhrases.vue',
        '../../components/settings/security/ShowPhrase.vue',
    ]

    it.each(FILES)('%s iptal edilen kurala atif YAPMAZ', (rel) => {
        expect(readRel(rel)).not.toContain(OLD_RULE)
    })

    // YOKLUKLA TATMIN OLAN IDDIA HICBIR SEY OLCMEZ: yukaridaki tarama, yorumlarin
    // TAMAMEN silinmesiyle de yesil kalirdi ve kapinin gerekcesi kaybolurdu.
    // Once VARLIK: yeni degismezin adi gecmeli.
    it('linkedAccounts.js yerine gecen degismezi (INV-1) ADIYLA anar', () => {
        expect(readRel('./linkedAccounts.js')).toContain('INV-1')
    })

    it('isDerivedEvmVault basligi kapinin GERCEK olcutunu yazar', () => {
        const src = readRel('./linkedAccounts.js')
        const header = src.slice(0, src.indexOf('export function isDerivedEvmVault'))
        expect(header).toContain('tonFingerprint')
    })

    it('docs/ton-entegrasyonu.md iptal edilen kurali savunmaz', () => {
        expect(readRel('../../../../docs/ton-entegrasyonu.md')).not.toMatch(/hesap\s+taşımaz/)
    })
})

// SelectPhrase.vue MUTASYONU DONDURULDU (2026-09-05 tasarim belgesi §5).
//
// `active_account.fingerprint = vault.fingerprint` + `chrome.storage.set(...)`
// vardi. Iki ayri sebeple gitti:
//  1) `chrome.storage.set` DIYE BIR API YOK (dogrusu `chrome.storage.local.set`),
//     yani yazim hicbir zaman diske inmiyordu -- "calisiyor" gorunen olu kod.
//  2) INV-1 altinda `fingerprint` hesabin HANGI KASAYA ait oldugunu soyleyen bagdir.
//     "Duzeltilmis" bir surum -- yani gercekten yazan bir surum -- bir TON hesabini
//     EVM kasasina baglar ve findVaultForAccount o hesap icin YANLIS sirri acardi.
//
// Bu ekran su an OLU (popup/App.vue:23'te yorum satirinda). Olu olmasi kodun geri
// gelmemesini garanti ETMEZ: bu iddia tam da birinin "bozuk API'yi duzelteyim"
// diye dosyayi acmasina karsi.
describe('SelectPhrase.vue aktif hesabin kasa bagini DEGISTIRMEZ', () => {
    const SRC = readRel('../../components/settings/SelectPhrase.vue')

    it('var olmayan chrome.storage.set cagrisi KALMADI', () => {
        expect(SRC).not.toContain('chrome.storage.set(')
    })

    // `(?!=)`: isSelected'daki `active_account.fingerprint === vault.fingerprint`
    // KIYASI kalir -- o dokunulmuyor, yalnizca TEK `=` ATAMASI aranir. Lookahead
    // olmasaydi `===`in ilk `=`i de eslesir ve iddia dogru kodda bile kirmizi kalirdi.
    it('active_account.fingerprint a ATAMA yapilmaz', () => {
        expect(SRC).not.toMatch(/active_account\.fingerprint\s*=(?!=)/)
    })

    // Ekranin ISI kaybolmamali: secim `user.vault` uzerinden tasinir.
    it('secim user.vault uzerinden tasinmaya devam eder', () => {
        expect(SRC).toMatch(/const\s+selectMnemonic[\s\S]{0,200}user\.vault\s*=\s*vault/)
    })
})
