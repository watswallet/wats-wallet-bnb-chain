import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Jetton gonderim akisinin BAGLANTI testleri.
//
// Saf katmanlar (jettonSend.js dort kapi, jettonTransfer.js govde) kendi
// dosyalarinda test ediliyor. Ama dogru calisan bir kapi CAGRILMAZSA hicbir sey
// yapmaz - bu depoda tam olarak bu yasandi: K1'de Token.vue'nun Gonder duğmesi
// jetton satirinda sessizce native TON gonderiyordu ve hicbir birim testi
// bunu gormuyordu, cunku gonderilen sey dogru bir native TON islemiydi.
//
// Bu depoda kaynak metni okuyan bu kalip zaten var (tonFlowWiring.test.js,
// swapWiring.test.js, jettonHomeWiring.test.js).
//
// O3 DERSI: bu testler YORUM METNINI eslemez. jettonHomeWiring.test.js'in ilk
// hali Home.vue'daki bir YORUMU esliyordu; gercek kod tamamen silinip yorumlar
// birakildiginda test YESIL kaliyordu. Buradaki her esleme CAGRILABILIR bir
// ifadeyi hedefler ve asagida ayrica "yorumda degil, kodda" kontrolu var.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const SEND = read('../../components/Send.vue')
const CONFIRM = read('../../components/ConfirmTransaction.vue')
const TOKEN = read('../../components/Token.vue')
const BACKGROUND = read('../../background.js')
const GATE = read('../messageGate.js')

// Yorum satirlarini ATAR. Bir eslemenin gercek kodda mi yoksa yalnizca bir
// aciklama yorumunda mi oldugunu ayirmak icin (bkz. O3 dersi yukarida).
const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const SEND_CODE = codeOnly(SEND)
const CONFIRM_CODE = codeOnly(CONFIRM)
const TOKEN_CODE = codeOnly(TOKEN)

describe('Send ekrani jetton icin AYRI dogrulama kullanir', () => {
    // tonSendAmountFits miktari ve ucreti AYNI bakiyeden duser. Jettonda ikisi
    // AYRI varliktir; o fonksiyonu jettonda kullanmak, jetton bakiyesinden TON
    // ucreti dusmeye calismak demektir.
    it('jetton miktar dogrulamasi jettonSendFits ile yapilir', () => {
        expect(SEND_CODE).toContain('jettonSendFits({')
        expect(SEND_CODE).toContain('jettonBalance: balance.value')
        expect(SEND_CODE).toContain('tonBalance: tonBalance.value')
    })

    // MUTASYON BOSLUGU: yukaridaki esleme, dalin OLU olup olmadigini goremiyor -
    // `if (isTonJetton.value)` yerine `if (false)` yazilsa metin yerinde kalir ve
    // test yesil gecerdi. Bu depoda tam olarak bu sinif hata yasandi (O3: bir
    // bagalanti testi Home.vue'nun YORUMUNU esliyordu, gercek kod silinince
    // yesil kaliyordu). Bu yuzden cagriyi degil, onu KORUYAN KAPIYI dogruluyoruz:
    // jettonSendFits'ten hemen once acilan kosul isTonJetton olmali.
    it('jetton dogrulamasi GERCEKTEN isTonJetton kapisinin ARDINDA', () => {
        const call = SEND_CODE.indexOf('jettonSendFits({')
        expect(call).toBeGreaterThan(-1)
        const guardAt = SEND_CODE.lastIndexOf('if (', call)
        const guard = SEND_CODE.slice(guardAt, SEND_CODE.indexOf(')', guardAt) + 1)
        expect(guard).toBe('if (isTonJetton.value)')
    })

    it('jetton bakiye okumasi da AYNI kapinin ardinda', () => {
        const call = SEND_CODE.indexOf('getJettonBalance({')
        expect(call).toBeGreaterThan(-1)
        const guardAt = SEND_CODE.lastIndexOf('if (', call)
        const guard = SEND_CODE.slice(guardAt, SEND_CODE.indexOf(')', guardAt) + 1)
        expect(guard).toBe('if (isTonJetton.value)')
    })

    it('jetton bakiyesi AYRI okunur - getTonBalance ile degil', () => {
        expect(SEND_CODE).toContain('getJettonWalletAddress({')
        expect(SEND_CODE).toContain('getJettonBalance({')
    })

    // Ucret TON'dan odenir, jettondan degil: jetton gonderiminde native TON
    // bakiyesi de HER DURUMDA okunmali, yoksa ucret kapisi bos bir degerle calisir.
    it('native TON bakiyesi jetton yolunda da okunur', () => {
        expect(SEND_CODE).toContain('tonBalance.value = await getTonBalance(')
    })

    it('jetton ayrimi Token.vue ile AYNI kaynaktan yapilir', () => {
        expect(SEND_CODE).toContain('NATIVE_TOKEN_ADDRESS')
        expect(SEND_CODE).toContain('const isTonJetton = computed(')
    })
})

describe('Onay ekrani jetton miktarini ve TON ucretini AYRI gosterir', () => {
    it('iliştirilen TON sabiti ekranda gosterilir', () => {
        expect(CONFIRM_CODE).toContain('JETTON_ATTACH_TON')
    })

    it('ucret kapisi jetton icin jettonSendFits kullanir', () => {
        expect(CONFIRM_CODE).toContain('jettonSendFits({')
        expect(CONFIRM_CODE).toContain('jettonAmount: crypto.transactionData.amount')
    })

    // SON kapi: iki ekran arasinda bakiye degismis olabilir, bu yuzden Send.vue'nun
    // okumasina guvenilmez.
    it('jetton bakiyesi onay ekraninda ZINCIRDEN TAZE okunur', () => {
        expect(CONFIRM_CODE).toContain('getJettonBalance({')
    })
})

describe('gonderim DOGRU aksiyona gider', () => {
    // K1'in ta kendisi: jetton satirinda SEND_TON_TRANSACTION'a gitmek,
    // kullanicinin jettonu yerine NATIVE TON'unu gondermek demektir.
    it('jettonda SEND_TON_JETTON, native TON da SEND_TON_TRANSACTION', () => {
        expect(CONFIRM_CODE).toContain('isTonJetton.value ? {')
        expect(CONFIRM_CODE).toContain('type: "SEND_TON_JETTON"')
        expect(CONFIRM_CODE).toContain('type: "SEND_TON_TRANSACTION"')
    })

    // Ondalik gecmezse arka plan gonderilen miktari 1000 kat yanlis kurar
    // (USDT-TON 6 ondalik kullanir).
    it('master ve decimals aksiyona TASINIR', () => {
        expect(CONFIRM_CODE).toContain('master: crypto.sendAsset?.address')
        expect(CONFIRM_CODE).toContain('decimals: crypto.sendAsset?.decimals')
    })

    // Varsayilan ondalik = sessiz para kaybi. Hicbir yerde olmamali.
    it('ondalik icin YEDEK DEGER kullanilmaz', () => {
        expect(CONFIRM_CODE).not.toMatch(/decimals:\s*crypto\.sendAsset\?\.decimals\s*\|\|/)
        expect(SEND_CODE).not.toMatch(/decimals:\s*crypto\.sendAsset\?\.decimals\s*\|\|/)
    })
})

describe('arka plan aksiyonu bagli ve KAPIDAN gecmis', () => {
    it('switch te isleyici var', () => {
        expect(BACKGROUND).toContain('case "SEND_TON_JETTON":')
        expect(BACKGROUND).toContain('sendJettonInternal(message, sender, sendResponse)')
    })

    // Kapiya eklenmemis bir ic aksiyon, sayfadan cagrilabilir bir aksiyondur.
    it('aksiyon guvenlik kapisinin IC AKSIYON listesinde', () => {
        expect(GATE).toContain("'SEND_TON_JETTON'")
    })

    it('isleyici saf gonderim katmanini cagirir', () => {
        // Import satiri gorev 10'da `isJettonWallet`i de tasimaya basladi (relay dali
        // sendJetton'u ATLADIGI icin KAPI 1'i kendi kuruyor). Iddia bu yuzden tam dize
        // yerine desen: onemli olan `sendJetton`in O MODULDEN gelmesi ve cagrilmasi.
        expect(BACKGROUND).toContain("from './utils/ton/jettonSend'")
        expect(BACKGROUND).toMatch(/import \{[^}]*sendJetton[^}]*\} from '\.\/utils\/ton\/jettonSend'/)
        expect(BACKGROUND).toContain('await sendJetton({')
    })

    // Bekleyen islem kapisi (KAPI 4) saf katmanda calisir ama listeyi okumak
    // storage erisimi gerektirir; okunup ORAYA verilmezse kapi bos dizi gorup
    // hicbir seyi engellemez.
    it('bekleyen islem listesi saf katmana GECIRILIR', () => {
        expect(BACKGROUND).toContain('pendingTransactions: otherPending')
    })

    // GIZLI YARIS: updateTxStatus(txId, 'queued') BU islemi listeye yaziyor ve
    // hasPendingTonTx 'queued' durumunu bekleyen sayiyor - kapi kendi kendini
    // engelleyebilirdi. Dogru davranis bugun yalnizca updateTxStatus'un
    // await EDILMEMESINE, yani bir yarisa bagliydi. Iki TON yolu da kendi
    // kaydini suzmeli.
    // Sayi DORT: native TON gonderimi, jetton gonderimi, TON takasi ve TonConnect
    // dapp gonderimi (tonDappSend, gorev 9). Yeni bir TON yolu eklenip bu suzgec
    // unutulursa sayi tutmaz ve test duser - kasit bu.
    it('kapi KENDI kaydini suzer - TON yollarinin HEPSINDE', () => {
        const matches = BACKGROUND.match(/\(t\) => t\?\.id !== txId/g) || []
        expect(matches.length).toBe(4)
    })

    // Gecmis kartinda jetton satiri native TON gonderimi gibi gorunmemeli.
    it('gecmis kaydi Jetton tipiyle yazilir', () => {
        expect(BACKGROUND).toContain("type: 'Jetton'")
    })
})

describe('Token.vue jetton satiri', () => {
    // K1 duzeltmesinde butun eylem satiri gizlenmisti; akis baglandigi icin geri acildi.
    it('Gonder duğmesi jetton satirinda artik GIZLI DEGIL', () => {
        expect(TOKEN_CODE).not.toContain('v-if="!isTonJetton"')
    })

    // Swap/Bridge/Receive TON'da hala kapali olmali (takas/kopru yok, Al MoonPay akisi).
    it('Swap/Bridge/Receive TON varliginda YINE gizli', () => {
        expect(TOKEN_CODE).toContain('v-if="!isTonAsset"')
    })

    it('jetton bakiyesi gercekten okunur - artik sadece hata isaretlenmiyor', () => {
        expect(TOKEN_CODE).toContain('getJettonWalletAddress({')
        expect(TOKEN_CODE).toContain('getJettonBalance({')
    })

    // Jetton satirinda getTonBalance cagrilirsa BASKA bir varligin bakiyesi
    // jetton sembolu altinda gosterilir - K1'in aslinda ilk kusuru buydu.
    it('jetton dalinda getTonBalance CAGRILMAZ', () => {
        const branch = TOKEN_CODE.slice(
            TOKEN_CODE.indexOf('if (isTonJetton.value) {'),
            TOKEN_CODE.indexOf('} else {', TOKEN_CODE.indexOf('if (isTonJetton.value) {')),
        )
        expect(branch.length).toBeGreaterThan(0)
        expect(branch).not.toContain('getTonBalance')
    })
})
