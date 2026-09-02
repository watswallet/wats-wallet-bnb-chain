import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { accountsForVaultDisplay, isDerivedEvmVault } from './linkedAccounts'

// TON kasasi hesap TASIMAZ (spec §6.1): hesap EVM kasasinda yasar. Ama kullanicinin
// Tonkeeper ifadesini yedekledigi yer O kasa - gizlenemez. Gizlenseydi kullanici
// ANA ifadesine ulasamazdi.
//
// AG YOK, DEPO YOK: saf bir gorunum yardimcisi.
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

describe('ton_master_note her iki dilde de tanimli', () => {
    const load = (lang) => JSON.parse(readFileSync(
        fileURLToPath(new URL(`../../i18n/locales/${lang}.json`, import.meta.url)), 'utf8'))

    it.each([['tr'], ['en']])('%s', (lang) => {
        const note = load(lang).settings?.account?.showPhrases?.ton_master_note
        expect(note, `${lang}.json: ton_master_note yok`).toBeTruthy()
    })
})
