import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { PRIVATE_ORDER_ATS, PRIVATE_DEST_NATIVE, integratorIdFrom } from './utils/privacy/silentswapConfig'
import { DELIVERY_CHAIN_IDS, parseDeliveryChains, checkDeliveryLists } from './utils/privacy/deliveryChains'
import { hasPrivateSendSource } from './utils/privacy/privateBridgedSources'
import { yorumsuz } from './test-utils/kaynakTarama'

/**
 * Derleme yapilandirmasi kilitleri (Task 23). Hepsi kaynak taramadir: vitest derleme yapmaz, bu yuzden
 * sessiz kayma ya da dikkatsiz bir birlestirme (spec bolum 14: WalletConnect birlestirmesi .env.* ve
 * manifest.config.js uzerinde cakisacak) burada kirmizi teste donusur.
 */
const oku = (yol) => readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8')
const VITE_CONFIG = oku('../vite.config.js')
const MANIFEST_CONFIG = oku('../manifest.config.js')
const ENV_PRODUCTION = oku('../.env.production')
const ENV_DEVELOPMENT = oku('../.env.development')

describe('vite.config.js: arsiv adi moda baglidir (build:dev magaza zip adini ezmez)', () => {
    const kod = yorumsuz(VITE_CONFIG)

    it('config mod alan bir fonksiyondur: defineConfig(({ mode }) => ...)', () => {
        expect(kod).toMatch(/defineConfig\(\s*\(\s*\{\s*mode\s*\}\s*\)\s*=>/)
    })

    it('zip eklentisinin dosya adi mod bagimli bir ifadeden gelir, sabit sablon degil', () => {
        const zip = kod.match(/zip\(\{[^}]*\}\)/)
        expect(zip, 'zip(...) cagrisi bulunamadi').not.toBeNull()
        expect(zip[0]).toMatch(/outFileName:\s*archiveName\(mode\)/)
        // Eski, moddan bagimsiz ad geri gelirse kirmizi.
        expect(zip[0]).not.toMatch(/outFileName:\s*`\$\{name\}-\$\{version\}\.zip`/)
    })

    it('archiveName: yalniz production eski adi verir, diger her mod -dev.zip alir', () => {
        const govde = kod.match(/const archiveName = \(mode\) => (`[^`]*`)/)
        expect(govde, 'archiveName bulunamadi').not.toBeNull()
        const archiveName = new Function('name', 'version', `return (mode) => ${govde[1]}`)('wats_wallet', '1.2.3')
        expect(archiveName('production')).toBe('wats_wallet-1.2.3.zip')
        expect(archiveName('development')).toBe('wats_wallet-1.2.3-dev.zip')
        expect(archiveName('staging')).toBe('wats_wallet-1.2.3-dev.zip')
        expect(archiveName(undefined)).toBe('wats_wallet-1.2.3-dev.zip')
    })
})

describe('vite.config.js: manifest.config.js kapilarina baglidir', () => {
    it('manifest.config.js import edilir ve crx() ona verilir (kapilar atlanamaz)', () => {
        const kod = yorumsuz(VITE_CONFIG)
        expect(kod).toMatch(/import\s+manifest\s+from\s+['"]\.\/manifest\.config\.js['"]/)
        expect(kod).toMatch(/crx\(\{\s*manifest\s*\}\)/)
    })
})

// Bayragin DERLEMEYE GIRECEK degeri, dosyanin Vite'in kendi yukleyicisiyle (loadEnv) degerlendirilmesidir: ayni anahtar
// tekrarlanirsa SON satir kazanir, tirnak/aciklama kurallari Vite'inkidir (ilk eslesen satiri okumak son satirdaki
// "true"yu kacirirdi, T23 M6). Dosya HERMETIK bir gecici klasore '.env.production' diye yazilir: ust dizindeki
// .env.local ve ortam degiskeni (loadEnv process.env'i de gorur) sonucu degistirmez.
function productionFlagOf(metin) {
    const dizin = mkdtempSync(join(tmpdir(), 'wats-env-'))
    const eski = process.env.VITE_PRIVACY_ENABLED
    delete process.env.VITE_PRIVACY_ENABLED
    try {
        writeFileSync(join(dizin, '.env.production'), metin)
        return loadEnv('production', dizin, 'VITE_').VITE_PRIVACY_ENABLED
    } finally {
        if (eski === undefined) delete process.env.VITE_PRIVACY_ENABLED
        else process.env.VITE_PRIVACY_ENABLED = eski
        rmSync(dizin, { recursive: true, force: true })
    }
}

describe('productionFlagOf (kilidin okuyucusu): Vite loadEnv sirasi', () => {
    it('tekrarlanan anahtarda SON satir kazanir (ilk satiri okumak yetmez)', () => {
        expect(productionFlagOf('VITE_PRIVACY_ENABLED=false\nVITE_PRIVACY_ENABLED=true\n')).toBe('true')
        expect(productionFlagOf('VITE_PRIVACY_ENABLED=true\r\nVITE_PRIVACY_ENABLED=false\r\n')).toBe('false')
    })

    it('tirnakli deger ve yorum satiri Vite kurallariyla okunur; anahtar yoksa undefined', () => {
        expect(productionFlagOf('# VITE_PRIVACY_ENABLED=true\nVITE_PRIVACY_ENABLED="false"\n')).toBe('false')
        expect(productionFlagOf('VITE_OTHER=1\n')).toBeUndefined()
    })
})

describe('.env.production: Gizli mod bayragi (yayin kapisi 12.6)', () => {
    const deger = productionFlagOf(ENV_PRODUCTION)

    it('VITE_PRIVACY_ENABLED tanimlidir (Vite loadEnv ile, son satir kazanir)', () => {
        expect(deger).toBeTruthy()
    })

    // 1.10 magaza surumu: Gizli mod uretimde ACIK. Yayin kapilari (integratorId, teslim degismezi, Takas/Kopru ve ATS satisi kapali)
    // baska kilitlerle korunur; bu kilit "kazara false" ya da dosyadan silinen satir (sessizce kapali) icin kirmizi olur.
    it('uretimde TAM "true" dur (1.10: gizli mod acik surum); aciksa PRIVATE_ORDER_ATS ya da PRIVATE_DEST_NATIVE de true olmalidir', () => {
        expect(deger).toBe('true')
        expect(PRIVATE_ORDER_ATS || PRIVATE_DEST_NATIVE).toBe(true)
    })

    it('KONTROL: okuyucu uretim dosyasinda false yapilmis bayragi gorur (kilit bayrak kapaninca kirmizi olur)', () => {
        expect(productionFlagOf(ENV_PRODUCTION.replace(/^VITE_PRIVACY_ENABLED=.*$/m, 'VITE_PRIVACY_ENABLED=false'))).toBe('false')
    })
})

describe('integratorId bicimi uc yerde AYNI', () => {
    // SDK (kurucu firlatir), sarmalayici (silentswapConfig) ve derleme kapisi (manifest.config.js).
    const regexMetni = (kaynak, onek) => {
        const m = yorumsuz(kaynak).match(onek)
        expect(m, `${onek} bulunamadi`).not.toBeNull()
        return m[1]
    }
    const SDK = readFileSync(fileURLToPath(new URL('../node_modules/@silentswap/sdk/dist/client.js', import.meta.url)), 'utf8')
    const sdk = regexMetni(SDK, /integratorId && !\/(\^int_[^/]+)\/\.test\(config\.integratorId\)/)
    const sarmalayici = regexMetni(oku('./utils/privacy/silentswapConfig.js'), /INTEGRATOR_ID_RE = \/(\^int_[^/]+)\//)
    const kapi = regexMetni(MANIFEST_CONFIG, /INTEGRATOR_ID && !\/(\^int_[^/]+)\/\.test\(INTEGRATOR_ID\)/)

    it('ucunun regex metni birebir ayni', () => {
        expect(sarmalayici).toBe(sdk)
        expect(kapi).toBe(sdk)
    })

    it('ayni regex davranisla da ayni: sarmalayici uyan id yi birakir, uymayani atar', () => {
        const re = new RegExp(sdk)
        for (const id of ['int_0123456789abcdef01234567', 'int_0123456789ABCDEF01234567', 'int_short', '']) {
            expect(integratorIdFrom(id) !== undefined, id).toBe(re.test(id))
        }
    })
})

// GIZLI MOD TESLIM AG LISTELERI (gizli-mod cok-ag spec 4.2, 6.1-6.3): iki liste derleme ayaridir. Dosyalar Vite'in kendi
// yukleyicisiyle (loadEnv) ve HERMETIK bir gecici klasorde okunur; vitest.config.js test.env ayni degiskenleri verir ve
// loadEnv process.env'i dosyanin USTUNE koydugu icin okuma boyunca ilgili anahtarlar silinir ve sonra geri konur.
const LISTE_ANAHTARLARI = ['VITE_PRIVATE_SEND_CHAINS', 'VITE_PRIVATE_FUND_CHAINS']
// Degismez (c) iki listenin yaninda dosyanin KENDI VITE_PRIVATE_ATS_SALE degerini ister (vitest test.env'i 'true' verir ve loadEnv onu
// dosyanin ustune koyar: anahtar okuma boyunca silinmezse uretim dosyasi da 'true' okunurdu).
const LISTE_VE_BAYRAK = [...LISTE_ANAHTARLARI, 'VITE_PRIVATE_ATS_SALE']
function envFileValues(mod, metin, anahtarlar) {
    const dizin = mkdtempSync(join(tmpdir(), 'wats-env-'))
    const eski = Object.fromEntries(anahtarlar.map((k) => [k, process.env[k]]))
    for (const k of anahtarlar) delete process.env[k]
    try {
        writeFileSync(join(dizin, `.env.${mod}`), metin)
        return loadEnv(mod, dizin, 'VITE_')
    } finally {
        for (const [k, v] of Object.entries(eski)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
        rmSync(dizin, { recursive: true, force: true })
    }
}

describe('teslim ag listeleri: .env.development ve .env.production', () => {
    it.each([['development', ENV_DEVELOPMENT], ['production', ENV_PRODUCTION]])('%s: iki liste de tanimli (bos olabilir), gecersiz oge yok, degismezler saglanir', (mod, metin) => {
        const env = envFileValues(mod, metin, LISTE_VE_BAYRAK)
        for (const k of LISTE_ANAHTARLARI) expect(env[k], `${mod}: ${k} dosyada tanimli olmali`).toBeDefined()
        const send = parseDeliveryChains(env.VITE_PRIVATE_SEND_CHAINS)
        const fund = parseDeliveryChains(env.VITE_PRIVATE_FUND_CHAINS)
        expect(send.invalid).toEqual([])
        expect(fund.invalid).toEqual([])
        // Teslim degismezi (1.10): Para yuklede her agin en az bir Gonder kaynagi var (ATS satisi bayragina bagli degil).
        expect(checkDeliveryLists(send.ids, fund.ids, DELIVERY_CHAIN_IDS.filter(hasPrivateSendSource))).toEqual([])
    })

    // Sahip gelistirme derlemesinde her agi deneyebilsin: Gonder de Para yukle de on ag (E/F-3).
    it('gelistirme: Gonder ve Para yukle on agin hepsini acar, satin alma bayragi acik', () => {
        const env = envFileValues('development', ENV_DEVELOPMENT, LISTE_VE_BAYRAK)
        expect(parseDeliveryChains(env.VITE_PRIVATE_SEND_CHAINS).ids).toEqual(DELIVERY_CHAIN_IDS)
        expect(parseDeliveryChains(env.VITE_PRIVATE_FUND_CHAINS).ids).toEqual(DELIVERY_CHAIN_IDS)
        expect(env.VITE_PRIVATE_ATS_SALE).toBe('true')
    })

    // Test ortami (vitest.config.js test.env) gelistirme dosyasiyla AYNI listeleri ve bayragi verir: mevcut testler acik aglarla ve acik
    // satin almayla calisir, kapali-durum testleri vi.stubEnv kullanir. Ikisi ayrisirsa testler gelistirme derlemesinden farkli bir dunyada kosar.
    it('test ortami (vitest.config.js test.env) gelistirme dosyasiyla ayni listeleri ve bayragi verir', () => {
        const env = envFileValues('development', ENV_DEVELOPMENT, LISTE_VE_BAYRAK)
        expect(import.meta.env.VITE_PRIVATE_SEND_CHAINS).toBe(env.VITE_PRIVATE_SEND_CHAINS)
        expect(import.meta.env.VITE_PRIVATE_FUND_CHAINS).toBe(env.VITE_PRIVATE_FUND_CHAINS)
        expect(import.meta.env.VITE_PRIVATE_ATS_SALE).toBe(env.VITE_PRIVATE_ATS_SALE)
    })

    // 1.10 magaza surumu: Gonder listesi gelistirmedeki on agin hepsi. Para yukle listesi = bu aglardan TESLIM DEGISMEZINI saglayanlar:
    // Gizli Hesap'a teslim edilen varlik yalniz Gonder ile cikabilir (ATS satisi ve gizli modda Takas/Kopru kapali; gelistirmede kendine Takas/Kopru da ayni kuraldadir), yani Para yukle'deki her
    // agin en az bir Gonder kaynagi olmali. Bugun on agin hepsinin var (Gonder kaynaklari: BSC USDC; Ethereum USDC/USDT/DAI/ETH; Base USDC/ETH;
    // Arbitrum USDC/USDT/ETH; Optimism USDC/USDT/ETH; Polygon USDC/USDT; Gnosis, Celo, Mantle, Cronos USDC), bu yuzden Para yukle de on ag.
    // Yeni ag ekleyen ya da tabloyu daraltan commit bu kilidi de bilerek degistirir.
    const uretimListeleri = () => {
        const env = envFileValues('production', ENV_PRODUCTION, LISTE_VE_BAYRAK)
        return { send: parseDeliveryChains(env.VITE_PRIVATE_SEND_CHAINS).ids, fund: parseDeliveryChains(env.VITE_PRIVATE_FUND_CHAINS).ids }
    }
    it('uretim: Gonder listesi gelistirmedeki on agdir', () => {
        expect(uretimListeleri().send).toEqual(DELIVERY_CHAIN_IDS)
        expect(uretimListeleri().send).toEqual(parseDeliveryChains(envFileValues('development', ENV_DEVELOPMENT, LISTE_VE_BAYRAK).VITE_PRIVATE_SEND_CHAINS).ids)
    })

    it('uretim: Para yukle listesi, teslim degismezini (Gonder kaynagi olan ag) saglayan aglarin TAMAMIDIR ve 56yi icerir', () => {
        const { send, fund } = uretimListeleri()
        expect(fund).toEqual(send.filter(hasPrivateSendSource))
        expect(fund).toEqual(DELIVERY_CHAIN_IDS)
        expect(fund).toContain(56)
        for (const id of fund) expect(hasPrivateSendSource(id), `ag ${id}: Gonder kaynagi yok`).toBe(true)
    })

    it('KONTROL: Gonder kaynagi olmayan ag Para yukle listesine eklenirse degismez ihlali raporlanir (kilit kaynaksiz agi yakalar)', () => {
        const { send, fund } = uretimListeleri()
        expect(checkDeliveryLists(send, fund, send.filter((id) => id !== 8453))).not.toEqual([])
    })

    it('uretim: ATS satisi ACIK (1.10, sahip karari 2026-11-06) ve Para yukle genisligi ona bagli degildir', () => {
        expect(envFileValues('production', ENV_PRODUCTION, LISTE_VE_BAYRAK).VITE_PRIVATE_ATS_SALE).toBe('true')
    })

    it('KONTROL: okuyucu uretim dosyasina eklenmis bir listeyi gorur (kilit liste degisince kirmizi olur)', () => {
        const sentetik = ENV_PRODUCTION.replace(/^VITE_PRIVATE_FUND_CHAINS=.*$/m, 'VITE_PRIVATE_FUND_CHAINS=56,8453,1')
        expect(parseDeliveryChains(envFileValues('production', sentetik, LISTE_VE_BAYRAK).VITE_PRIVATE_FUND_CHAINS).ids).toEqual([56, 1, 8453])
    })

    // 6.3: Gizli Hesap'a para yuklenemeyen bir surum cikmaz. Bayrak 1.10'da acik; acikken liste 56'yi icermek zorunda.
    it('uretim: Gizli mod bayragi aciksa Para yukle listesi 56yi icerir', () => {
        const env = envFileValues('production', ENV_PRODUCTION, [...LISTE_ANAHTARLARI, 'VITE_PRIVACY_ENABLED'])
        if (env.VITE_PRIVACY_ENABLED === 'true') expect(parseDeliveryChains(env.VITE_PRIVATE_FUND_CHAINS).ids).toContain(56)
    })

    // KONTROL: yukaridaki kilit bugun iddiasizdir (uretimde bayrak false, `if` hic girilmez). Bayragi YAPAY olarak acik ve Para yukle
    // listesini bos gosterip kilidin baktigi okuyucunun 56yi "yok" gorebildigini kanitlar: gercek dosyada bayrak acilip liste
    // doldurulmazsa yukaridaki test kirmizi olur. Gercek dosyanin liste degerine BAGLI DEGILDIR (magaza listesi dolunca da yesil kalir)
    // ve uygulamadan bagimsizdir (Step 2'de de yesil).
    it('KONTROL: bayrak true ve Para yukle listesi bos ise okuyucu 56yi YOK gorur (kilit bayrak acilinca kirmizi olur)', () => {
        const sentetik = ENV_PRODUCTION
            .replace(/^VITE_PRIVACY_ENABLED=.*$/m, 'VITE_PRIVACY_ENABLED=true')
            .replace(/^VITE_PRIVATE_FUND_CHAINS=.*$/m, 'VITE_PRIVATE_FUND_CHAINS=')
        const env = envFileValues('production', sentetik, [...LISTE_ANAHTARLARI, 'VITE_PRIVACY_ENABLED'])
        expect(env.VITE_PRIVACY_ENABLED).toBe('true')
        expect(parseDeliveryChains(env.VITE_PRIVATE_FUND_CHAINS).ids).not.toContain(56)
    })
})

// Derleme kapisi teslim degismezini GERCEK Gonder kaynagi bilgisine baglar (1.10): ATS satisi bayragina ya da isAtsSaleLive()'a BAGLI DEGIL.
describe('manifest.config.js: Para yukle kapisi Gonder kaynagina bagli (ATS satisi sarti kalkti)', () => {
    const kod = yorumsuz(MANIFEST_CONFIG)

    it('hasPrivateSendSource ile hesaplanan kaynakli aglari checkDeliveryLists e acikca verir; ATS satisi sartini aramaz', () => {
        expect(kod).toContain('hasPrivateSendSource')
        expect(kod).toMatch(/checkDeliveryLists\(SEND_CHAINS\.ids, FUND_CHAINS\.ids, SEND_SOURCE_CHAINS\)/)
        expect(kod).not.toContain('isAtsSaleLive')
        expect(kod).not.toMatch(/ATS_SALE_OPEN/)
    })

    // Spec 6.11: bayragi uretimde acan commit derleme kuralini da kaldirir.
    it("uretim derlemesi VITE_PRIVATE_ATS_SALE === 'true' ile durmaz", () => {
        expect(kod).not.toMatch(/mode === 'production' && ENV\.VITE_PRIVATE_ATS_SALE === 'true'/)
    })
})

// GIZLI MODDA TAKAS VE KOPRU BAYRAGI (1.10 magaza surumu): uretimde ve gelistirmede ACIK (sahip karari 2026-11-06).
// Dosyadan silinen satir kirmizi olur.
const TAKAS_KOPRU_ANAHTARI = ['VITE_PRIVATE_SWAP_BRIDGE']
describe('VITE_PRIVATE_SWAP_BRIDGE: .env.development, .env.production ve derleme kapisi', () => {
    it('gelistirme: ACIK (sahip Takas/Kopru akisini deneyebilsin)', () => {
        expect(envFileValues('development', ENV_DEVELOPMENT, TAKAS_KOPRU_ANAHTARI).VITE_PRIVATE_SWAP_BRIDGE).toBe('true')
    })

    it('uretim: degisken dosyada TANIMLIDIR ve "true" (1.10 yayini)', () => {
        const deger = envFileValues('production', ENV_PRODUCTION, TAKAS_KOPRU_ANAHTARI).VITE_PRIVATE_SWAP_BRIDGE
        expect(deger, 'satir silinirse sessizce kapali sayilir ama kilit bunu kirmizi yapar').toBeDefined()
        expect(deger).toBe('true')
    })

    it('KONTROL: okuyucu uretim dosyasina eklenmis "true" satirini gorur (kilit bayrak acilinca kirmizi olur)', () => {
        const sentetik = ENV_PRODUCTION.replace(/^VITE_PRIVATE_SWAP_BRIDGE=.*$/m, 'VITE_PRIVATE_SWAP_BRIDGE=true')
        expect(envFileValues('production', sentetik, TAKAS_KOPRU_ANAHTARI).VITE_PRIVATE_SWAP_BRIDGE).toBe('true')
    })

    it("uretim derlemesi VITE_PRIVATE_SWAP_BRIDGE === 'true' ile durmaz", () => {
        expect(yorumsuz(MANIFEST_CONFIG)).not.toMatch(/mode === 'production' && ENV\.VITE_PRIVATE_SWAP_BRIDGE === 'true'/)
    })
})

// GIZLI HESAP ATS SATIN ALMA BAYRAGI (gizli-mod cok-ag spec 4.5 madde 2, E18, yayin kapisi 6.11): uretimde canli kanit
// (5.2 adim 1) ve L9 teyidi gelene dek KAPALIDIR. Bu kilit bilerek sert: bayragi acan commit bu testi, canli defter
// satirlarini anan mesajla BIRLIKTE degistirir; "kazara true" ya da dosyadan silinen satir kirmizi olur.
const ATS_SATIS_ANAHTARI = ['VITE_PRIVATE_ATS_SALE']
describe('VITE_PRIVATE_ATS_SALE: .env.development ve .env.production', () => {
    it('gelistirme: ACIK (sahip canli adim 5.2/1 i ve satin alma ekranini deneyebilsin)', () => {
        expect(envFileValues('development', ENV_DEVELOPMENT, ATS_SATIS_ANAHTARI).VITE_PRIVATE_ATS_SALE).toBe('true')
    })

    it('uretim: degisken dosyada TANIMLIDIR ve tam "true" (1.10 yayini, 6.11)', () => {
        const deger = envFileValues('production', ENV_PRODUCTION, ATS_SATIS_ANAHTARI).VITE_PRIVATE_ATS_SALE
        expect(deger, 'satir silinirse sessizce kapali sayilir ama kilit bunu kirmizi yapar').toBeDefined()
        expect(deger).toBe('true')
    })

    it('KONTROL: okuyucu uretim dosyasina eklenmis "true" satirini gorur (kilit bayrak acilinca kirmizi olur)', () => {
        const sentetik = ENV_PRODUCTION.replace(/^VITE_PRIVATE_ATS_SALE=.*$/m, 'VITE_PRIVATE_ATS_SALE=true')
        expect(envFileValues('production', sentetik, ATS_SATIS_ANAHTARI).VITE_PRIVATE_ATS_SALE).toBe('true')
    })
})
