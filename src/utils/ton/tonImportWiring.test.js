import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const IMPORT = read('../../components/onboarding/ImportPhrases.vue')

describe('ice aktarma ekrani iki standardi da tanir', () => {
    // Brief'teki hali `expect(IMPORT).toContain('isTonMnemonic')` idi - bu, import
    // satirinin KENDISI tarafindan tatmin edilir; fonksiyonu ice aktarip hic
    // CAGIRMAYAN bir uygulama da gecerdi (bu planda daha once bulunan tam bu
    // kusur). Burada confirm() govdesine daraltilip parantezli bir CAGRI araniyor.
    it('TON dogrulamasi cagrilir', () => {
        const confirm = IMPORT.slice(IMPORT.indexOf('const confirm ='))
        expect(confirm).toMatch(/isTonMnemonic\(/)
    })

    it('karar decideImport a birakilir', () => {
        const confirm = IMPORT.slice(IMPORT.indexOf('const confirm ='))
        expect(confirm).toMatch(/decideImport\(/)
    })

    it('zincir yoklamasi yapilir', () => {
        const confirm = IMPORT.slice(IMPORT.indexOf('const confirm ='))
        expect(confirm).toMatch(/probeTonMnemonic\(/)
    })

    // ASIL KUSUR: `isValidMnemonic` false donunce ANINDA firlatiliyordu ve TON
    // ifadesi oraya kadar bile gelemiyordu. O erken cikis GERI GELMEMELI.
    it('BIP39 gecersizken ANINDA firlatmaz', () => {
        const confirm = IMPORT.slice(IMPORT.indexOf('const confirm ='))
        expect(confirm).not.toMatch(/if\s*\(!Mnemonic\.isValidMnemonic\([^)]*\)\)\s*throw/)
    })

    // Iki dogrulama da CALISMALI - biri tuttugunda durulmamali. Durulsaydi
    // cakisma hic fark edilmez ve karar sabit siraya duserdi (spec §8).
    //
    // Sadece iki metnin dosyada bir yerde GECMESI yetmez (mesela `tonValid`in
    // `bip39Valid` true ise atlanip false'a sabitlenmesi de her iki metni
    // barindirir ama ikinci dogrulamayi hic CALISTIRMAZ). Bu yuzden iki `const`
    // satirinin ART ARDA, birbirine baglanmadan, KOSULSUZ durdugu araniyor.
    it('iki dogrulama da calisir', () => {
        const confirm = IMPORT.slice(IMPORT.indexOf('const confirm ='))
        expect(confirm).toContain('Mnemonic.isValidMnemonic')
        expect(confirm).toContain('isTonMnemonic')
        expect(confirm).toMatch(
            /const bip39Valid\s*=\s*Mnemonic\.isValidMnemonic\([^)]*\)\s*\r?\n\s*const tonValid\s*=\s*await isTonMnemonic\(/
        )
    })

    it("TON secildiginde ton_mnemonic olayi yayilir", () => {
        expect(IMPORT).toContain("emit('ton_mnemonic'")
        expect(IMPORT).toContain('ton_mnemonic')
    })

    it('engellenen durumlar kullaniciya SEBEBIYLE bildirilir', () => {
        // `blocked` -> firlatilir -> catch dalinda o kodun kendi mesaji gosterilir.
        // Serbest `toContain('TON_OLD_WALLET_VERSION')` yorumla da tatmin olurdu;
        // catch dalindaki gercek alert baglantisi araniyor.
        const body = IMPORT.slice(IMPORT.indexOf('const confirm ='))
        expect(body).toMatch(/if \(decision\.action === 'blocked'\) throw blockedError\(decision\)/)
        expect(body).toMatch(/error\.message === 'TON_OLD_WALLET_VERSION'[\s\S]{0,120}?alertOldWalletVersion\(/)
    })
})

describe("cakisma cozulemedigi durumda kullaniciya SORULUR (spec §8, §12)", () => {
    const BODY = IMPORT.slice(IMPORT.indexOf('const confirm ='))

    // ASIL KUSUR: 'ask' bir SORU olarak modellenmisti ama ekran onu hataya
    // ceviriyordu -> "ag ayirt edemedi, lutfen tekrar deneyin". Iki ulasilabilir
    // durumda da cikmaz sokakti:
    //   1) iki turetmede de VARLIK var: ag gayet ayirt etti, mesaj FAKTUEL OLARAK
    //      YANLIS ve karar deterministik oldugu icin tekrar denemek ayni yere
    //      cikiyor - o cuzdan HIC aktarilamiyordu.
    //   2) cift-gecerli ifade + RPC kesintisi: mesaj dogru ama yine cikis yok.
    it("'ask' artik FIRLATMAZ", () => {
        expect(BODY).not.toMatch(/action === 'ask'\)\s*throw/)
        expect(BODY).not.toMatch(/throw new Error\('MNEMONIC_AMBIGUOUS'\)/)
    })

    it("'ask' dali kullaniciya bir SORU sorar", () => {
        const ask = BODY.slice(BODY.indexOf("decision.action === 'ask'"))
        expect(ask).toMatch(/globalThis\.confirm\(/)
        expect(ask).toContain('confirm_ambiguous_choice')
    })

    // Sormak yetmez: CEVABIN iki yola da GITMESI gerekiyor. Sabit bir cevap
    // (or. her zaman 'bip39') soruyu sorar gibi gorunup kullanicinin secimini
    // yok sayardi ve bu blogun diger testleri yine gecerdi.
    it('cevap iki turetme yoluna da baglanir', () => {
        const ask = BODY.slice(BODY.indexOf("decision.action === 'ask'"))
        expect(ask).toMatch(/\?\s*'tonMnemonic'\s*\r?\n?\s*:\s*'bip39'/)
    })

    // Secim GERCEKTEN kullanilmali: `decision.kind` dogrudan okunmaya devam
    // ederse kullanicinin cevabi hicbir seyi degistirmez ('ask' kararlarinda
    // decideImport zaten `kind` DONDURMUYOR - yani TON secimi sessizce BIP39'a
    // duserdi).
    it('secilen tur turetme dalinda KULLANILIR', () => {
        expect(BODY).toMatch(/if \(kind === 'tonMnemonic'\) \{/)
        expect(BODY).not.toMatch(/if \(decision\.kind === 'tonMnemonic'\)/)
    })

    // Cakisma zincirden COZULDUGUNDE (action 'import') bilgilendirme alerti
    // duruyor olmali - ama 'ask' dalinda GOSTERILMEMELI: kullanici az once
    // secimini yapti, "Ethereum olarak aktarildi" demek yanlis olurdu.
    it('cozulen cakisma bilgisi yalnizca ask DISINDA gosterilir', () => {
        expect(BODY).toMatch(/\}\s*else if \(decision\.reason === 'MNEMONIC_AMBIGUOUS'\)\s*\{/)
    })

    it('olu yakalama dallari kaldirildi', () => {
        // Bunlari artik hicbir sey firlatmiyor; birakilirlarsa okuyucuya var
        // olmayan bir yol varmis gibi gorunur.
        expect(IMPORT).not.toContain('INVALID_MNEMONIC_CHECKSUM')
        // `alert_ambiguous_resolved` KALIYOR - alt-dize eslesmesi onu da yakalardi.
        expect(IMPORT).not.toMatch(/alert_ambiguous(?!_resolved)/)
    })
})

describe('ilk kurulumda TON kasasi olusur', () => {
    const PASSWORD = read('../../components/onboarding/CreatePassword2.vue')
    const INDEX = read('../../components/onboarding/index.vue')

    // Brief'teki hali `expect(PASSWORD).toContain('ton_mnemonic')` idi - bu, prop
    // adinin dosyada BIR YERDE gecmesiyle (mesela bir yorumda) tatmin edilirdi.
    // defineProps CAGRISINA daraltildi ki gercekten prop olarak tanimlandigi kanitlansin.
    it('sifre adimi ton_mnemonic prop unu alir', () => {
        expect(PASSWORD).toMatch(/defineProps\(\[[^\]]*'ton_mnemonic'[^\]]*\]\)/)
    })

    // MODEL DEGISTI (spec §2, 2026-08-29): TON ice aktarma artik TON'a KILITLI bir
    // hesap uretmiyor. Kasa kurulumu yardimciya tasindi; ekranin kendi kopyasi yok.
    it('TON kurulumu buildHybridTonAccount a devredilir', () => {
        const branch = PASSWORD.slice(PASSWORD.indexOf('props.ton_mnemonic'))
        expect(branch).toMatch(/buildHybridTonAccount\(/)
    })

    // Ekran kurali KOPYALAMAMALI: kasalari kendisi kurarsa iki kurulum yolu
    // birbirinden ayrisir ve kullanici hangi kapidan girdigine gore farkli bir
    // cuzdan alir.
    it('sifre adimi kasalari KENDISI kurmaz', () => {
        const branch = PASSWORD.slice(PASSWORD.indexOf('props.ton_mnemonic'))
        expect(branch).not.toMatch(/createTonVault\(/)
    })

    // Ice aktarilan cuzdan TON'a kilitli DEGIL: kopru, dapp ve EVM acik olmali.
    it("olusan hesap 'ton' tipinde DEGIL", () => {
        const branch = PASSWORD.slice(PASSWORD.indexOf('props.ton_mnemonic'))
        expect(branch).not.toContain("type: 'ton'")
    })

    // Brief'teki hali iki serbest `toContain` idi - 'ton_mnemonic' ve 'setTonMnemonic'
    // dosyanin HERHANGI bir yerinde (yorum, kullanilmayan degisken) gecmesi yeterdi.
    // Dort somut baglanti noktasina (ref, setter, prop-binding, event-binding) ve
    // v-else-if kosuluna daraltildi - CreatePassword2'nin gercekten render
    // EDILEBILDIGININ kaniti da budur (context notundaki "sessiz cikmaz" riski).
    it('onboarding ton_mnemonic i baglar', () => {
        expect(INDEX).toContain('ton_mnemonic')
        expect(INDEX).toContain('setTonMnemonic')
        expect(INDEX).toMatch(/const ton_mnemonic = ref\(null\)/)
        expect(INDEX).toMatch(/const setTonMnemonic = /)
        expect(INDEX).toMatch(/:ton_mnemonic="ton_mnemonic"/)
        expect(INDEX).toMatch(/@ton_mnemonic="setTonMnemonic"/)
        expect(INDEX).toMatch(/status === 'password' && \(private_key \|\| mnemonic \|\| ton_mnemonic\)/)
    })

    // SIR HIJYENI: mevcut ifade/anahtar refleri ekran degisiminde temizleniyor.
    // Yeni ref o temizlige DAHIL EDILMEZSE TON ifadesi bellekte asili kalir.
    //
    // Brief'teki hali dosyanin SONUNA kadar tek bir slice idi: ilk 'clearImportSecrets(mnemonic'
    // eslesmesinden itibaren TUM dosyada 'ton_mnemonic' ARANIYORDU. Bu, yalnizca
    // import_private satirina eklenip start/import_wallet satiri UNUTULSA bile
    // gecerdi (ikinci satir zaten slice icinde kaliyordu). Her iki cagriyi TEK TEK,
    // birbirine karismadan sinirlamak icin iki ayri satira daraltildi.
    it('ton_mnemonic ekran degisiminde temizlenir', () => {
        const startClear = INDEX.slice(
            INDEX.indexOf("newStatus === 'start'"),
            INDEX.indexOf("newStatus === 'import_phrases'")
        )
        expect(startClear).toContain('ton_mnemonic')

        const importPrivateSection = INDEX.slice(INDEX.indexOf("newStatus === 'import_private'"))
        const importPrivateLine = importPrivateSection.slice(0, importPrivateSection.indexOf('\n'))
        expect(importPrivateLine).toContain('ton_mnemonic')
    })
})


describe("kullanicinin TON secimi de SURUM KAPISINDAN gecer (spec §7)", () => {
    const BODY = IMPORT.slice(IMPORT.indexOf('const confirm ='))
    const ASK = BODY.slice(BODY.indexOf("decision.action === 'ask'"))

    // Delik: 'ask' bir soruya cevrilince TON secimi dogrudan importTonWallet'a
    // gidiyordu. Cift-gecerli ifade + TON parasi v4R2'de + BIP39 tarafi dolu ->
    // BOS bir W5 cuzdani UYARISIZ aktariliyordu.
    it('secim decideAfterChoice ile karara cevrilir', () => {
        expect(ASK).toMatch(/decideAfterChoice\(\{\s*kind:\s*picked,\s*probe\s*\}\)/)
    })

    it('engellenen secim FIRLATIR - sessizce ice aktarilmaz', () => {
        expect(ASK).toMatch(/if \(resolved\.action === 'blocked'\) throw blockedError\(resolved\)/)
    })

    // SIRA KRITIK: kapi, turetmeye giden cagridan ONCE olmali. Sonra olsaydi
    // kasa zaten kurulmus olurdu.
    it('kapi importTonWallet ten ONCE calisir', () => {
        const gate = BODY.indexOf('decideAfterChoice(')
        const derive = BODY.indexOf('await importTonWallet(')
        expect(gate).toBeGreaterThan(-1)
        expect(derive).toBeGreaterThan(gate)
    })

    // Ekran kurali KOPYALAMAZ: `tonVersionBlock`/`w5`/`v4R2` gibi terimler
    // burada gecmemeli. Gecseydi saf katmanla sapabilecek ikinci bir gercek olurdu.
    it('ekran surum kuralini KOPYALAMAZ', () => {
        expect(IMPORT).not.toMatch(/tonVersionBlock|'v4R2'|version === 'w5'/)
    })

    it('decideAfterChoice karar katmanindan ice aktarilir', () => {
        expect(IMPORT).toMatch(
            /import\s*\{[^}]*\bdecideAfterChoice\b[^}]*\}\s*from\s*['"][^'"]*tonImportDecision['"]/
        )
    })

    // Spec §12: engel kullaniciya SEBEBIYLE ulasmali - surum, adres, bakiye;
    // genel bir "cuzdan eklenemedi" degil.
    it('engel kullaniciya surum/adres/bakiye ile bildirilir', () => {
        expect(IMPORT).toMatch(/const blockedError = \(decision\) =>[\s\S]{0,160}?detail: decision\.detail/)
        expect(IMPORT).toMatch(/error\.message === 'TON_OLD_WALLET_VERSION'\)\s*\{\s*\r?\n\s*return alertOldWalletVersion\(error\.detail\)/)
        expect(IMPORT).toMatch(/alert_old_wallet_detail'[\s\S]{0,200}?version: detail\.version[\s\S]{0,120}?balance: detail\.balance/)
    })
})

describe('MAM ifadesi taninir ama KOSULLU sorulur (Gorev 8)', () => {
    const confirmBody = () => IMPORT.slice(IMPORT.indexOf('const confirm ='))

    it('MAM sorusu confirm() icinde CAGRILIR', () => {
        expect(confirmBody()).toMatch(/isMamMnemonic\(/)
    })

    it('MAM ifadesi kendi mesajini alir', () => {
        expect(confirmBody()).toMatch(/isMamMnemonic\([\s\S]{0,200}?mam_not_supported/)
    })

    // ASIL KUSUR (olculdu 2026-09-11, n=3000): MAM'in gecerlilik kurali tek
    // iterasyonluk bir PBKDF2'nin ilk baytinin 0 olmasidir -- rastgele bir ifade
    // ~1/256 olasilikla MAM gorunur, gecerli BIP39 ifadelerinin %0.57'si (~1/176).
    // Kontrol KOSULSUZ ve dogrulamalardan ONCE kosarken her ~176 MetaMask ice
    // aktarmasi KALICI olarak reddediliyordu. Bu kapi o regresyonu geri
    // getirtmez: soru yalnizca ifade iki aileden de kalmisken sorulmalidir.
    it('MAM YALNIZCA iki aile de kaldiginda sorulur', () => {
        expect(confirmBody()).toMatch(/if\s*\(\s*!bip39Valid\s*&&\s*!tonValid\s*&&\s*await\s+isMamMnemonic\(/)
    })

    it('MAM sorusu iki dogrulamadan SONRA gelir', () => {
        const body = confirmBody()
        const bip39 = body.indexOf('const bip39Valid =')
        const ton = body.indexOf('const tonValid =')
        const mam = body.indexOf('isMamMnemonic(')
        expect(bip39).toBeGreaterThan(-1)
        expect(ton).toBeGreaterThan(bip39)
        expect(mam).toBeGreaterThan(ton)
    })

    // GPL-3.0 SINIRI. `@ton-keychain/core` GPL'dir ve bu uzanti kapali kaynaktir;
    // paket URETIM koduna girerse yayinlanan bundle'a GPL kod linklenir. Yeri
    // devDependency ve TEK mesru kullanimi tonMamMnemonic.test.js'teki fark
    // testidir. Bu kapi, birinin "kutuphaneyi cagirmak daha kolay" deyip geri
    // sokmasini engeller.
    it('GPL kutuphanesi URETIM kaynagina girmez', () => {
        // ELLE YAZILMIS BEYAZ LISTE KALDIRILDI (final inceleme bulgusu,
        // 2026-09-11): listede olmayan herhangi bir uretim dosyasindan yapilan
        // ithal hem takimdan hem yayinlanan paketten SESSIZCE geciyordu. Artik
        // butun `src/` agaci taraniyor; kapiyi asmanin tek yolu testi degistirmek.
        const testMi = (yol) => /\.test\.js$|\.ssr\.test\.js$|[\\/]test-utils[\\/]/.test(yol)
        const kok = fileURLToPath(new URL('../..', import.meta.url))

        const suclular = []
        const gez = (dizin) => {
            for (const girdi of readdirSync(dizin, { withFileTypes: true })) {
                const tam = join(dizin, girdi.name)
                if (girdi.isDirectory()) { gez(tam); continue }
                if (!/\.(js|vue)$/.test(girdi.name) || testMi(tam)) continue
                // Yorumlarda gecmesi SERBEST -- kuralin gerekcesi orada yazili.
                // Aranan sey CALISAN bir import/require satiridir.
                const kaynak = readFileSync(tam, 'utf8')
                if (/^\s*(import|const)\s[^\n]*['"]@ton-keychain\/core['"]/m.test(kaynak)) {
                    suclular.push(tam.slice(kok.length))
                }
            }
        }
        gez(kok)

        expect(suclular).toEqual([])
    })

    // MAM'in imzalama yolunda hicbir isi yoktur: ice aktarma ekraninda bir SORU
    // sorulur, sonra ifade reddedilir. Service worker'a sizmasi yalnizca olu yuk
    // olurdu (ve GPL siniriyla birlikte gelen bir kaza riski).
    it('MAM modulu service worker yoluna SIZMAZ', () => {
        const sw = [
            '../../background.js',
            './tonAccount.js',
            './tonIdentity.js',
        ]
        for (const rel of sw) {
            expect(read(rel)).not.toMatch(/tonMamMnemonic/)
        }
    })
})
