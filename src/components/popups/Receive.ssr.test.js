// Receive.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (Task 16b): ekran EVM `user.address`'i KOSULSUZ gosteriyordu. Solana
// aktifken bu, kullaniciya kendi kontrol ETMEDIGI bir adresi (EVM hesabi)
// gosterip "buraya varlik gonder" demek anlamina gelirdi -- gonderilen SOL/SPL
// o adrese ULASAMAZ ve KAYBOLUR (EVM ve Solana ayri anahtar uzaylarindadir).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { networkStore } from '../../store/network'
import { userStore } from '../../store/user'
import Receive from './Receive.vue'
import supported_chains from '../../data/supported_chains.json'

const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)
const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')

afterEach(() => {
    delete globalThis.chrome
})

// `onCapture`: instance YAKALANDIGI ANDA cagrilir; `selectedKind` gibi KULLANICI
// dokunusuyla olusan ic durumu render'dan ONCE kurmanin TEK yolu bu -- bu ortamda
// DOM yok, gercek bir tiklama ATILAMAZ (bkz. ssrRender.js:captureInstance).
function setup(chainRecord, { activeAccount = {}, sendMessageImpl = null, userAddress = '0xAbCdEf0000000000000000000000000000000001', onCapture = null } = {}) {
    const chromeStub = installChromeStub({ active_account: activeAccount })
    if (sendMessageImpl) chromeStub.setSendMessage(sendMessageImpl)

    const app = createApp(Receive)
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    const user = userStore()
    user.address = userAddress

    const captured = captureInstance(app, 'Receive', onCapture)
    return { app, captured, user }
}

describe('Receive.vue (SSR) -- EVM REGRESYONU: davranis degismedi', () => {
    it('EVM aktif: user.address gosterilir, "EVM compatible" uyarisi kalir', async () => {
        const { app, user } = setup(ETH_CHAIN, { activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001' } })
        const html = await render(app)

        expect(html).toContain(user.address)
        expect(html).toContain('EVM compatible')
        expect(html).not.toContain('Could not load your Solana address')
    })
})

describe('Receive.vue (SSR) -- Solana da active_account.solanaAddress gosterilir', () => {
    it('active_account.solanaAddress HAZIR: dogrudan kullanilir, EVM adresi SIZMAZ', async () => {
        const SOL_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const { app, user } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', solanaAddress: SOL_ADDR },
        })
        const html = await render(app)

        expect(html).toContain(SOL_ADDR)
        expect(html).not.toContain(user.address)
        expect(html).toContain('Solana')
    })

    it('harf kasasi BIREBIR korunur (kucultulmez)', async () => {
        const SOL_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { solanaAddress: SOL_ADDR },
        })
        const html = await render(app)

        expect(html).toContain(SOL_ADDR)
        expect(html).not.toContain(SOL_ADDR.toLowerCase())
    })

    it('active_account.solanaAddress YOKSA SOLANA_GET_ADDRESS ile cozulur', async () => {
        const SOL_ADDR = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
        const { app } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001' },
            sendMessageImpl: async (msg) => {
                if (msg?.type === 'SOLANA_GET_ADDRESS') return { result: { address: SOL_ADDR } }
                return { error: 'unexpected' }
            },
        })
        const html = await render(app)

        expect(html).toContain(SOL_ADDR)
    })

    // COZUM BASARISIZ: "bos bakiye" ile "cozum basarisiz" AYRI durumlardir. EVM
    // adresine SESSIZCE DUSMEK -- kullanicinin kontrol etmedigi bir adrese
    // varlik gondermesine yol acar -- burada ACIKCA engellenir.
    it('cozum BASARISIZ olursa EVM adresine SESSIZCE DUSULMEZ, hata gosterilir', async () => {
        const { app, user } = setup(SOLANA_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001' },
            sendMessageImpl: async () => { throw new Error('kasa kilitli') },
        })
        const html = await render(app)

        expect(html).not.toContain(user.address)
        expect(html).toContain('Could not load your Solana address')
    })

    it('SOLANA_GET_ADDRESS sonucu bossa da EVM adresine DUSULMEZ', async () => {
        const { app, user } = setup(SOLANA_CHAIN, {
            activeAccount: {},
            sendMessageImpl: async () => ({ error: 'locked' }),
        })
        const html = await render(app)

        expect(html).not.toContain(user.address)
        expect(html).toContain('Could not load your Solana address')
    })
})

// KOD INCELEMESI (Task 16b review, "Also fix (cheap)"): EVM'de `user.address`
// HENUZ HIDRATE olmamissa (Receive.vue bu degeri kendisi YAZMAZ) eski kosul
// (yalniz `displayAddress`) bu karti YANLIS ZINCIR ADIYLA acardi.
describe('Receive.vue (SSR) -- EVM de yanlislikla Solana hata karti gorunmez', () => {
    it('EVM aktif, user.address HENUZ bos: Solana hata mesaji GORUNMEZ', async () => {
        const { app } = setup(ETH_CHAIN, { userAddress: null })
        const html = await render(app)

        expect(html).not.toContain('Could not load your Solana address')
    })
})

// ============================================================================
// BIRLESTIRME INCELEMESI, BULGU 1 -- TON dalinin COKLU-ADRES Al ekrani.
//
// TON dali bu ekrani iki satirlik bir listeye cevirmisti (EVM + TON alt alta,
// QR dokunulan satiri izler) ve bunu ACIK bir hatayi kapatmak icin yapmisti:
// "TON adresini almak icin once TON agina gecmek gerekiyordu".
//
// Birlestirmede liste TUMDEN kaldirildi; gerekce ":3: coklu-satir bicimi
// Receive.ssr.test.js:68/107/118'i MATEMATIKSEL OLARAK gecemez" idi. O gerekce
// OLCULDU ve YANLIS cikti: TON'un bicimi AYNEN geri konuldugunda bu dosyadaki
// 7 testten 5'i duser ve BESI DE `setup(SOLANA_CHAIN, ...)` ile kurulan Solana
// testleridir; IKI EVM testi (satir 49 ve 127) coklu-satir listeyle GECER.
// Yani listeyi Solana'da kapatmak yetiyordu, TUMDEN silmek gerekmiyordu.
//
// Asagidaki testler geri getirilen bicimi kilitler VE Solana kuralini
// ("Solana aktifken ekranda EVM adresi HIC BULUNMAMALI") ayni anda korur.
const TON_CHAIN = supported_chains.find((c) => c.chainId === -239)
const TON_ADDR = 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r'

describe('Receive.vue (SSR) -- EVM/TON: iki adres ALT ALTA (TON dali davranisi)', () => {
    it('EVM aktifken TON adresi de listelenir: ag DEGISTIRMEDEN gorulur/kopyalanir', async () => {
        const { app, user } = setup(ETH_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
        })
        const html = await render(app)

        expect(html).toContain(user.address)
        expect(html).toContain(TON_ADDR)
    })

    it('TON aktifken EVM adresi de listelenir', async () => {
        const { app, user } = setup(TON_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
        })
        const html = await render(app)

        expect(html).toContain(TON_ADDR)
        expect(html).toContain(user.address)
    })

    it('her satir KENDI etiketini tasir ve QR rozeti hangi adresin QR de oldugunu YAZIYLA soyler', async () => {
        const { app } = setup(ETH_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
        })
        const html = await render(app)

        // 'EVM compatible' + 'TON' etiketleri ve 'IN QR' rozeti (popups.receive.qr_badge).
        expect(html).toContain('EVM compatible')
        expect(html).toContain('>TON<')
        expect(html).toContain('IN QR')
    })
})

describe('Receive.vue (SSR) -- Solana aktifken liste TEK adrese duser', () => {
    it('Solana aktif: EVM ve TON adresi ekranda HIC BULUNMAZ', async () => {
        const SOL_ADDR = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const { app, user } = setup(SOLANA_CHAIN, {
            activeAccount: {
                address: '0xAbCdEf0000000000000000000000000000000001',
                tonAddress: TON_ADDR,
                solanaAddress: SOL_ADDR,
            },
        })
        const html = await render(app)

        expect(html).toContain(SOL_ADDR)
        expect(html).not.toContain(user.address)
        expect(html).not.toContain(TON_ADDR)
    })
})

// BULGU 2 -- MV3 servis calisani YANIT VERMEDEN uykuya dalarsa
// `chrome.runtime.sendMessage(...)` promise'i NE cozulur NE reddedilir.
// `solanaFailed` false KALIR, `displayAddress` null KALIR: ekran SONSUZA KADAR
// "Preparing address" gosterir -- dosyanin kendi yorumunun "daha kotu" dedigi
// durumun ta kendisi, ustelik hicbir tarafin (ne TON ne Solana dali) bilmedigi
// bir ARA DURUM.
describe('Receive.vue (SSR) -- Solana adres cagrisi ASILI KALIRSA sonsuza kadar beklenmez', () => {
    it('servis calisani hic yanit vermezse zaman asimindan sonra hata karti cikar', async () => {
        vi.useFakeTimers()
        try {
            const { app, user } = setup(SOLANA_CHAIN, {
                activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001' },
                // NE cozulur NE reddedilir: asili kalan servis calisani.
                sendMessageImpl: () => new Promise(() => {}),
            })

            const pending = render(app)
            // Gercek zaman beklemeden zaman asimini tetikle.
            await vi.advanceTimersByTimeAsync(60000)
            const html = await pending

            expect(html).not.toContain(user.address)
            expect(html).toContain('Could not load your Solana address')
        } finally {
            vi.useRealTimers()
        }
    })
})

// ============================================================================
// SECIM KILIDI -- `activeKind` (Receive.vue:340-346).
//
// Dosyanin kendi yorumu (Receive.vue:337-339) bu kilidin NEDENINI yaziyor:
// secim, listede GERCEKTEN VAR OLMAYAN bir satirda kalirsa `displayAddress`
// null doner ve ekran, adres ZATEN ELDEYKEN sonsuza kadar "Preparing address"
// gosterir -- kullaniciyi hicbir zaman gelmeyecek bir sey icin bekletir
// (useDisplayAddress.js 3. kuralin ayni sinifi: bekleyen kullanici cuzdanin
// bozuk oldugunu dusunur, oysa hesap tam tasarlandigi gibi calisiyor).
//
// Uc yol da ayri ayri kilitlenir: (1) secim listede yok, aktif ag listede VAR;
// (2) hic uretilmeyen bir tur secili kalmis; (3) NE secim NE aktif ag listede
// var (kinds[0] geri dusmesi).
//
// Kanit yuzeyleri BILEREK "QR alani" tarafindan secildi: satirin KENDISI her iki
// halde de adresi basiyor, ayrisan sey QR/rozet/uyari. 'IN QR' rozeti
// (qr_badge) yalnizca `row.kind === activeKind && row.address` iken cizilir,
// yani QR'in GERCEK bir satira dustugunun YAZILI kanitidir.
describe('Receive.vue (SSR) -- secim listede OLMAYAN bir satirda kalirsa ekran TAKILMAZ', () => {
    it('TON a kilitli hesap: secim EVM de kalsa bile QR gercek TON satirina duser', async () => {
        const { app, user } = setup(TON_CHAIN, {
            // TON'a kilitli hesapta EVM satiri HIC uretilmez (evmSupported false).
            activeAccount: { type: 'ton', address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
            onCapture: (instance) => { instance.setupState.selectedKind = 'evm' },
        })
        const html = await render(app)

        // Adres ELDE oldugu halde "hazirlaniyor" yazmak, bu ekranin kacinmak icin
        // var oldugu sonsuz bekleme durumunun ta kendisi.
        expect(html).not.toContain('Preparing address')
        expect(html).toContain('IN QR')
        expect(html).toContain(TON_ADDR)
        // Uyari etiketi de `activeKind`ten beslenir: QR duruyorsa uyari da durmali,
        // yoksa kullanici hangi zincirden gonderecegini HIC ogrenemez.
        expect(html).toContain('Only send assets from')
        // Uretilmeyen satirin adresi hicbir yoldan sizmaz.
        expect(html).not.toContain(user.address)
    })

    it('listede HIC olmayan bir tur secili kalmis: QR yine gercek satira duser', async () => {
        // 'solana' secimi Solana ekranindaki tek-adres dugmesinden ARTA KALABILIR
        // (selectAndCopy({ kind: 'solana' })); EVM/TON listesinde boyle bir satir YOK.
        const { app, user } = setup(ETH_CHAIN, {
            activeAccount: { address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
            onCapture: (instance) => { instance.setupState.selectedKind = 'solana' },
        })
        const html = await render(app)

        expect(html).not.toContain('Preparing address')
        expect(html).toContain('IN QR')
        // Aktif ag listede VAR: QR ona duser, yani EVM adresi gosterilir.
        expect(html).toContain(user.address)
    })

    it('TON a kilitli hesap EVM aginda: aktif ag da listede yokken QR ilk satira duser', async () => {
        // Kullanici dokunmamis (selectedKind null) VE aktif agin (evm) satiri
        // uretilmemis: geriye yalnizca kinds[0] kalir. Bu kapi olmadan ekran, TON
        // adresi ELDEYKEN "hazirlaniyor" der.
        const { app, user } = setup(ETH_CHAIN, {
            activeAccount: { type: 'ton', address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
        })
        const html = await render(app)

        expect(html).not.toContain('Preparing address')
        expect(html).toContain('IN QR')
        expect(html).toContain(TON_ADDR)
        expect(html).not.toContain(user.address)
    })
})

// ============================================================================
// TON'A KILITLI HESAP + SOLANA AGI -- `solanaSupported` (Receive.vue:297-301).
//
// Bu hesabin sirri bir TON ifadesidir. Arka uca sorulursa resolveSolanaAddress o
// ifadeyi BIP39 sayip gecerli GORUNEN ama YANLIS bir adres uretebilir; boyle bir
// dizeyi "Solana" etiketiyle basmak, tonIdentity.js'de yazili
// TON_SECRET_KIND_MISMATCH kazasinin ta kendisidir ve kullanicinin kontrol
// ETMEDIGI bir adrese SOL gondermesiyle biter (varlik KALICI OLARAK KAYBOLUR).
//
// Bu yuzden olculen sey yalnizca ekranin ne yazdigi DEGIL, arka uca HIC
// SORULMADIGI: adres bir kez uretilirse ekranda gosterilmese bile diske yazilan/
// onbellege alinan bir kimlik dogar.
//
// AYRISMA NOTU (birlestirme incelemesi, Bulgu 3 -- HALA acik): bu kural
// accountSupport.js'in "kural TEK YERDE" sozlesmesinin DISINDA duruyor;
// background.js:390 ve solana/sendGuards.js:31 yalnizca
// isSolanaUnsupportedAccount'a bakiyor, yani arka uc bu hesap icin turetmeyi
// YINE DE dener. Asagidaki test kurali TASIMIYOR, yalnizca BUGUNKU tek kapiyi
// -- bu ekrani -- kilitliyor.
describe('Receive.vue (SSR) -- TON a kilitli hesapta Solana adresi HIC istenmez', () => {
    it('Solana aktif, hesap TON a kilitli: arka uca sorulmaz, desteklenmiyor durumu gosterilir', async () => {
        const WRONG_SOL_ADDR = 'So11111111111111111111111111111111111111112'
        const sendMessage = vi.fn(async () => ({ result: { address: WRONG_SOL_ADDR } }))

        const { app, user } = setup(SOLANA_CHAIN, {
            activeAccount: { type: 'ton', address: '0xAbCdEf0000000000000000000000000000000001', tonAddress: TON_ADDR },
            sendMessageImpl: sendMessage,
        })
        const html = await render(app)

        // ASIL kanit: TON ifadesinden ed25519 turetmesi HIC denenmez.
        expect(sendMessage).not.toHaveBeenCalled()
        expect(html).not.toContain(WRONG_SOL_ADDR)

        // Sonsuz "hazirlaniyor" yerine ACIKCA "yuklenemedi" denir.
        expect(html).toContain('Could not load your Solana address')
        expect(html).not.toContain('Preparing address')

        // Solana aktifken ekranda EVM/TON adresi HIC BULUNMAZ.
        expect(html).not.toContain(user.address)
        expect(html).not.toContain(TON_ADDR)
    })
})
