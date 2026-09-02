import { describe, it, expect } from 'vitest'
import { probeTonMnemonic } from './tonWalletProbe'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const DUAL = 'logic service expect film garbage twist fabric shop grow patient toe furnace index certain gym occur rabbit caution injury zero language brother minimum water'

// Sahte istemci: adrese gore bakiye. Gercek zincire cikilmaz - bu testin olctugu
// sey ADAYLARIN DOGRU KURULMASI, zincirin dogru cevap vermesi degil.
const clientWith = (balances) => ({
    getBalance: async (address) => {
        const key = address.toString({ bounceable: false })
        return BigInt(Math.round((balances[key] ?? 0) * 1e9))
    },
})

describe('probeTonMnemonic', () => {
    it('TON turetmesinde uc surumu de yoklar', async () => {
        const r = await probeTonMnemonic({
            mnemonic: DUAL, kinds: ['tonMnemonic'], client: clientWith({}),
        })
        expect(r.candidates.map((c) => c.version)).toEqual(['w5', 'v4R2', 'v3R2'])
        expect(r.candidates.every((c) => c.kind === 'tonMnemonic')).toBe(true)
    })

    // Bu modulun VAR OLMA sebebi: bir mnemonic TEK BASINA adresi belirlemez, sozlesme
    // surumuyle BIRLIKTE belirler. Bu uygulama yalnizca W5 imzaliyor; eger W5/v4R2/v3R2
    // GERCEKTE ayni adrese cikiyor olsaydi eski surum tespiti hicbir zaman tetiklenmez
    // ve eski bir Tonkeeper cuzdani (v4R2) aktaran kullanici W5'te BOS bir adres gorup
    // parasinin gittigini sanirdi. Altin degerler DUAL ifadesinden, kurulu @ton/ton ile
    // olculdu - rastgele degil, ispatlanabilir. Ustteki test yalnizca etiket/sira/kind
    // kontrol eder ve ucu de W5'ten kopyalayip yeniden etiketleyen bozuk bir uygulamayi
    // YAKALAYAMAZ; bu test asil adresleri dogrulayarak o durumu yakalar.
    it('uc TON surumu farkli VE OLCULEN adreslere cikar', async () => {
        const r = await probeTonMnemonic({
            mnemonic: DUAL, kinds: ['tonMnemonic'], client: clientWith({}),
        })
        const byVersion = Object.fromEntries(r.candidates.map((c) => [c.version, c.address]))
        expect(byVersion).toEqual({
            w5: 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q',
            v4R2: 'UQAoMENnstZjb53Q3Eqt4dTjowD53Wr6dYOSGtWVczmGlMD6',
            v3R2: 'UQBovsXezDdvB_nxJbtfJinq1fb1s4chIq_2qhgvgN_Hen2V',
        })
        // Etiketler dogru olsa bile UC AYRI adres olmasi gereken sey: aksi halde
        // "surume gore farkli adres" iddiasinin kendisi cokuyor demektir.
        expect(new Set(r.candidates.map((c) => c.address)).size).toBe(3)
    })

    // Cakisma durumu (spec §8): iki turetme de yoklanir ki hangisinde varlik
    // oldugu gorulebilsin.
    it('iki tip verildiginde IKISINI de yoklar', async () => {
        const r = await probeTonMnemonic({
            mnemonic: DUAL, kinds: ['tonMnemonic', 'bip39'], client: clientWith({}),
        })
        expect(new Set(r.candidates.map((c) => c.kind))).toEqual(new Set(['tonMnemonic', 'bip39']))
    })

    // BIP39 tarafinda YALNIZCA W5 yoklanir: bu uygulama BIP39 tohumundan zaten
    // sadece W5 uretiyor, eski surumlerin orada bir karsiligi yok.
    //
    // Adres burada da OLCULEN altin degerle dogrulanir - yalnizca uzunluk/etiket
    // kontrolu DUAL gibi cift-standartli bir ifadede yeterli degildir: DUAL hem
    // BIP39 hem TON-native semasinda gecerli oldugundan, `keyPairFor` icindeki
    // 'bip39' dalini yanlislikla `tonKeyPairFromTonMnemonic`'e baglayan bir
    // mutasyon HICBIR ZAMAN firlatmaz - sessizce YANLIS anahtar ciftini turetir
    // ve yanlis adresi raporlar. Uzunluk/etiket testleri boyle bir kaymayi
    // YAKALAYAMAZ; asagidaki adres esitligi yakalar.
    it('bip39 tipinde yalnizca W5 yoklanir', async () => {
        const r = await probeTonMnemonic({
            mnemonic: DUAL, kinds: ['bip39'], client: clientWith({}),
        })
        expect(r.candidates).toHaveLength(1)
        expect(r.candidates[0].version).toBe('w5')
        expect(r.candidates[0].address).toBe('UQBviJxvVm84QbDBDJ_6quvu9nO2ZKJeOmSBRuDR-58k-e7m')
    })

    it('bakiyeleri adaya yazar', async () => {
        const TON_W5 = 'UQB1-bGBpFuFl8Ho83XCuq1dJUYcMgBu2zSobPATzsSjCm7q'
        const r = await probeTonMnemonic({
            mnemonic: DUAL, kinds: ['tonMnemonic'], client: clientWith({ [TON_W5]: 12.5 }),
        })
        const w5 = r.candidates.find((c) => c.version === 'w5')
        expect(w5.address).toBe(TON_W5)
        expect(w5.balance).toBe(12.5)
    })

    // FAIL-OPEN, ama GORUNUR (spec §7). Yoklama bir yardim mesajidir; bir RPC
    // kesintisi kullanicinin kendi cuzdanini aktarmasini durdurmamali. Yine de
    // `failed` bayragi tasinir ki cagiran taraf cakisma durumunda (karar
    // yoklamaya bagliyken) fail-open DAVRANMASIN.
    it('zincir hatasinda failed doner, FIRLATMAZ', async () => {
        const r = await probeTonMnemonic({
            mnemonic: DUAL, kinds: ['tonMnemonic'],
            client: { getBalance: async () => { throw new Error('ag yok') } },
        })
        expect(r.failed).toBe(true)
        expect(r.candidates).toEqual([])
    })
})

const PROBE = readFileSync(fileURLToPath(new URL('./tonWalletProbe.js', import.meta.url)), 'utf8')

// YAPISAL kilit — bu depoda zaten var olan bir kalip (tonFlowWiring.test.js,
// tonAccountLockWiring.test.js, swapWiring.test.js kaynak metni okuyarak bir
// cagri noktasinin GERCEKTEN var oldugunu kanitlar).
//
// Burada DAVRANISSAL bir test ISE YARAMAZ: inline bir
// `WalletContractV5R1.create({ publicKey, workchain: 0, walletId: { networkGlobalId: -239 } })`
// ile tonAccount.js'teki paylasilan `tonWalletContract` fabrikasi BUGUN AYNI
// adresi uretir — @ton/ton'un kendi varsayilani `networkGlobalId`'yi zaten -239'a
// (TON_MAINNET_ID) dusuruyor. Yani hicbir adres/bakiye iddiasi ikisini AYIRT
// EDEMEZ; olculdu. Korunan sey bugunku deger degil, ZAMANLA SAPMA: tonAccount.js
// kendi yorumunda "TEK W5 cuzdan fabrikasi ... kurulum baska hicbir yerde
// TEKRARLANMAZ" der — iki ayri kurulum sitesi olursa biri degisip digeri
// unutulabilir ve bu probun w5 adayi, uygulamanin GERCEKTEN imzaladigi adresten
// SESSIZCE sapar. Bu yuzden kilit kaynak METNINE bakar: paylasilan fabrika
// CAGRILIYOR mu, ayrica bir W5R1 kurulumu VAR mi — deger esitligine degil.
describe('W5 icin TEK fabrika kullanilir (yapisal kilit)', () => {
    it('paylasilan tonWalletContract fabrikasini cagirir', () => {
        expect(PROBE).toContain('tonWalletContract(')
    })

    it('kendi WalletContractV5R1 kurulumunu ICERMEZ', () => {
        expect(PROBE).not.toContain('WalletContractV5R1')
    })
})
