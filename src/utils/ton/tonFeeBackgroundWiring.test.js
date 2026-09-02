// TON UCRET KURTARMASININ ARKA PLAN TELLERI - kaynak metninden kilitlenir.
//
// NEDEN KAYNAK METNI: depoda jsdom/SW kosum ortami YOK (vitest environment 'node'),
// `background.js` en ustte `chrome.alarms.create` cagiriyor - import edildigi anda
// patlar. Kardes kablolama testleri (jettonHomeWiring, tonImportWiring) ayni yolu
// izliyor.
//
// IKI TUZAK, IKISI DE BU DEPODA YASANDI:
//
// 1) YORUM TUZAGI: naif bir `toContain`, aranan dizeyi yalnizca bir ACIKLAMA
//    YORUMUNDA tasiyan dosyada da yesil kalir - gercek kod tamamen silinmis olsa bile.
//    Bu yuzden butun iddialar YORUMLARI SIYRILMIS kaynak uzerinde calisir.
//
// 2) YOKLUKLA SAGLANAN SIRA IDDIASI: `indexOf` bulunamayan bir dize icin -1 doner ve
//    -1 < N HER ZAMAN dogrudur - yani silinmis bir cagri "once cagriliyor" gibi
//    gorunur. Bu planda UC KEZ yasandi. Asagida her sira karsilastirmasinin ONCESINDE
//    iki dizenin de GERCEKTEN VAR oldugu ayrica dogrulanir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BG_RAW = readFileSync(fileURLToPath(new URL('../../background.js', import.meta.url)), 'utf8')
const GATE_SRC = readFileSync(fileURLToPath(new URL('../messageGate.js', import.meta.url)), 'utf8')

const BG = BG_RAW
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')

// Bir isleyicinin GOVDESINI ayirir: iddialar dosyanin tamamina degil, ilgili dala
// bakar. Dosyanin baska bir yerindeki bir cagri, yanlis dala konmus bir teli
// "dogrulanmis" gostermemeli.
function blockAfter(src, marker, closer) {
    const start = src.indexOf(marker)
    if (start === -1) return null
    const end = src.indexOf(closer, start + marker.length)
    return end === -1 ? src.slice(start) : src.slice(start, end)
}

describe('background.js - TON ucret kurtarmasi kablolamasi', () => {
    it('recoverTonSettlements hem TANIMLI hem CAGRILIYOR', () => {
        expect(BG).toContain("from './utils/ton/tonFeeRecovery'")

        const body = blockAfter(BG, 'async function recoverTonFees(', '\n}')
        expect(body).not.toBeNull()
        expect(body).toContain('recoverTonSettlements(')
        // Bagimliliklar gercekten geciliyor: bunlar olmadan kurtarma ne seqno
        // okuyabilir ne de islem kartini guncelleyebilir - sessizce hicbir sey yapar.
        expect(body).toContain('getSeqnoFor')
        expect(body).toContain('findActionOnChain')
        expect(body).toContain('updateTxStatus')
        expect(body).toContain('listTransactions')
    })

    it('onAlarm govdesinde cagri, if (!session_active) satirinin USTUNDE', () => {
        // ALTINA konursa kurtarma KILITLI cuzdanda hic calismaz - oysa kurtarmanin
        // gerektigi an TAM OLARAK kullanicinin uzaklastigi ve cuzdanin kilitlendigi
        // andir.
        const alarm = blockAfter(BG, 'chrome.alarms.onAlarm.addListener', '\n})')
        expect(alarm).not.toBeNull()

        const call = alarm.indexOf('recoverTonFees(')
        const guard = alarm.indexOf('if (!session_active) return')
        // VARLIK once: eksik bir dize -1 doner ve -1 < N ile "once" gorunurdu.
        expect(call).toBeGreaterThan(-1)
        expect(guard).toBeGreaterThan(-1)
        expect(call).toBeLessThan(guard)
    })

    it('kilit karari kurtarmanin BEKLENMESINE bagli DEGIL', () => {
        // Kurtarma `session_active` kapisinin USTUNDE BASLAR (kilitli cuzdanda da
        // calismali) ama BEKLENMEZ. tonFeeRelay'in zaman asimi/AbortController'i YOK ve
        // tonSeqnoFor canli bir zincir cagrisi yapiyor; ustelik tonFeeRecovery'nin
        // modul duzeyindeki `inFlight` kilidi AYNI askidaki sozu SONRAKI tike de
        // veriyor. Beklenirse, takilan TEK bir istek pes pese butun tikleri bloklar ve
        // shouldLock/lockWallet HIC calismaz - otomatik kilit, yani bir GUVENLIK
        // kontrolu, aga rehin dusup ACIK TARAFA duser.
        const alarm = blockAfter(BG, 'chrome.alarms.onAlarm.addListener', '\n})')
        expect(alarm).not.toBeNull()

        expect(alarm).not.toMatch(/await\s+recoverTonFees\s*\(/)
        // Askidaki soz yakalanmis olmali: iki nokta arasinda dogan bir reddetme
        // yakalanmamis reddetme olarak yuzeye cikmasin.
        expect(alarm).toMatch(/recoverTonFees\s*\(\s*\)\s*\.catch\s*\(/)

        const start = alarm.indexOf('recoverTonFees(')
        const lock = alarm.indexOf('shouldLock(')
        const settle = alarm.indexOf('await recovering')
        // VARLIK once: eksik bir dize -1 doner ve -1 < N ile "once" gorunurdu.
        expect(start).toBeGreaterThan(-1)
        expect(lock).toBeGreaterThan(-1)
        expect(settle).toBeGreaterThan(-1)
        expect(start).toBeLessThan(lock)     // kurtarma ONCE baslar
        expect(lock).toBeLessThan(settle)    // ama kilit karari onu BEKLEMEDEN verilir
    })

    it('HEARTBEAT dalinda da cagriliyor', () => {
        const heartbeat = blockAfter(BG, 'case "HEARTBEAT":', 'case "')
        expect(heartbeat).not.toBeNull()
        expect(heartbeat).toContain('recoverTonFees(')
    })

    it('onStartup ve onInstalled dallarinda da cagriliyor', () => {
        const startup = blockAfter(BG, 'chrome.runtime.onStartup.addListener', '\n})')
        expect(startup).not.toBeNull()
        expect(startup).toContain('recoverTonFees(')

        const installed = blockAfter(BG, 'chrome.runtime.onInstalled.addListener', '\n})')
        expect(installed).not.toBeNull()
        expect(installed).toContain('recoverTonFees(')
    })
})

// ---------------------------------------------------------------------------
// GOREV 10 - RELAY DALI. Olculen baslangic durumu: `executeTonViaRelayer`in
// HICBIR gercek cagirani yoktu (yalniz bir yorumda adi geciyordu) ve
// `TON_RELAY_TX_FLAG` okunuyor ama HIC yazilmiyordu. Dokuz gorevlik mekanizma
// arayuzden ULASILAMIYORDU.
//
// Asagidaki iddialarin HEPSI ESLENMIS: her biri icin bir "silinirse duser" ve bir
// "zayiflatilirsa/yer degistirirse duser" iddiasi var. Tek basina bir `indexOf`
// karsilastirmasi ya da bir `not.toContain` OLCMEZ (dosya basi notu 2).
// ---------------------------------------------------------------------------
describe('background.js - TON ucret RELAY dali (gorev 10)', () => {
    const relayBody = () => blockAfter(BG, 'async function tonRelayExecute(', '\n}')
    const nativeBody = () => blockAfter(BG, 'async function sendTonInternal(', '\n}')
    const jettonBody = () => blockAfter(BG, 'async function sendJettonInternal(', '\n}')

    it('executeTonViaRelayer IMPORT ediliyor VE gercekten CAGRILIYOR', () => {
        expect(BG).toContain("from './utils/ton/tonFeeRelayer'")
        expect(BG).toMatch(/import \{[^}]*executeTonViaRelayer[^}]*\} from '\.\/utils\/ton\/tonFeeRelayer'/)

        const body = relayBody()
        expect(body).not.toBeNull()
        expect(body).toContain('await executeTonViaRelayer({')
    })

    it('HER IKI gonderim yolu da relay dalina GIRIYOR (native + jetton)', () => {
        // Tek bir kolun baglanmasi yetmez: jetton yolu baglanmazsa T9'un kapattigi
        // saldirinin hedefi olan tam da o yol olu kalir.
        for (const [ad, body] of [['sendTonInternal', nativeBody()], ['sendJettonInternal', jettonBody()]]) {
            expect(body, `${ad}: govde okunamadi`).not.toBeNull()
            expect(body, `${ad}: relayMode dali yok`).toContain('if (relayMode) {')
            expect(body, `${ad}: tonRelayExecute cagrilmiyor`).toContain('await tonRelayExecute({')
        }
    })

    // YUKUMLULUK 2: makbuz yetim taramasinin gorus alanina girsin diye bayrak
    // islem kaydina YAZILMALI. Yazilmazsa scanOrphanTxs HICBIR SEY bulmaz -
    // Task 7'nin yarisi olu kod olur.
    it('TON_RELAY_TX_FLAG islem meta sina YAZILIYOR', () => {
        expect(BG).toMatch(/import \{[^}]*TON_RELAY_TX_FLAG[^}]*\} from '\.\/utils\/ton\/tonFeeRecovery'/)

        // (a) bayragi yazan TEK yer
        const helper = blockAfter(BG, 'const tonTxMeta =', '\n')
        expect(helper).not.toBeNull()
        expect(helper).toContain('[TON_RELAY_TX_FLAG]: true')

        // (b) o yer HER IKI yolun ILK yazmasinda ('queued') kullaniliyor - relay
        // dalinin ICINE konsaydi, SW dalin oncesinde olen her turda bayraksiz bir
        // kayit birakirdi.
        for (const [ad, body] of [['sendTonInternal', nativeBody()], ['sendJettonInternal', jettonBody()]]) {
            const metaAt = body.indexOf('tonTxMeta(')
            const queuedAt = body.indexOf("updateTxStatus(txId, 'queued', meta)")
            const branchAt = body.indexOf('if (relayMode) {')
            expect(metaAt, `${ad}: tonTxMeta kullanilmiyor`).toBeGreaterThan(-1)
            expect(queuedAt, `${ad}: queued yazmasi meta kullanmiyor`).toBeGreaterThan(-1)
            expect(branchAt, `${ad}: relay dali yok`).toBeGreaterThan(-1)
            expect(metaAt, `${ad}: bayrak relay dalindan SONRA kuruluyor`).toBeLessThan(branchAt)
            expect(queuedAt, `${ad}: queued yazmasi relay dalindan SONRA`).toBeLessThan(branchAt)
        }
    })

    // YUKUMLULUK 3 - PLANIN EN PAHALI SIRASI. Ters sirada SW olurse islem
    // 'processing'te makbuzsuz kalir (yetim imzasi) ve ucreti ALINMIS bir islem
    // "ucret alinmadi" diye etiketlenir; 'unresolved' terminal oldugu icin DUZELMEZ.
    it('once islem durumu yazilir, SONRA clearTonSettlement', () => {
        const body = relayBody()
        expect(body).not.toBeNull()

        const statusAt = body.indexOf("await updateTxStatus(txId, 'processing', sentMeta)")
        const clearAt = body.indexOf('await clearTonSettlement(')
        // VARLIK ONCE: eksik bir dize -1 doner ve -1 < N HER ZAMAN dogrudur -
        // silinmis bir cagri "once cagriliyor" gibi gorunurdu (bu planda uc kez yasandi).
        expect(statusAt, 'durum yazmasi YOK').toBeGreaterThan(-1)
        expect(clearAt, 'clearTonSettlement YOK').toBeGreaterThan(-1)
        expect(statusAt).toBeLessThan(clearAt)

        // Ikisi de AYNI kapinin ardinda: belirsiz (bos govdeli) bir 2xx'te ne durum
        // yazilir ne makbuz silinir.
        const gateAt = body.indexOf("if (out?.status === 'sent') {")
        expect(gateAt, "status === 'sent' kapisi YOK").toBeGreaterThan(-1)
        expect(gateAt).toBeLessThan(statusAt)
    })

    // HAKEMLIK (inceleme turu 1): /relay'in dolu govde donmesi "RELAYER KABUL ETTI"
    // demektir, "ZINCIR ISLEDI" demek degil. 'success' ancak self-pay'in kullandigi
    // AYNI onaydan (waitForSeqno) sonra yazilir - yoksa zincirde reddedilmis bir
    // transfer "gonderildi" gorunurdu.
    it("'success' DOGRUDAN yazilmaz - waitForSeqno onayindan SONRA gelir", () => {
        const body = relayBody()
        expect(body).not.toBeNull()

        const waitAt = body.indexOf('waitForSeqno({ contract: wallet, previous: seqno })')
        expect(waitAt, 'onay adimi (waitForSeqno) YOK').toBeGreaterThan(-1)

        // Dosyadaki HER 'success' yazmasi onaydan SONRA olmali. Tek bir indexOf
        // karsilastirmasi, ONAYDAN ONCE ikinci bir 'success' eklenmesini kacirirdi.
        const successler = [...body.matchAll(/updateTxStatus\(txId, [^)]*'success'/g)].map((m) => m.index)
        expect(successler.length, "'success' yazmasi yok").toBeGreaterThan(0)
        for (const at of successler) expect(at).toBeGreaterThan(waitAt)

        // Onay 'error' YAZMAZ: dogrulanamamak basarisizlik degildir (self-pay ile
        // AYNI kural) - aksi halde kullanici tekrar gonderir ve deger iki kez gider.
        const onay = body.slice(waitAt)
        expect(onay).not.toContain("'error'")
    })

    // Makbuz BILEREK silindikten sonra kayit yetim taramasinin gorus alaninda
    // KALMAMALI: taramanin sorusu "makbuz yazilmadan mi olduk" ve relay kabul
    // ettikten sonra o cikarim yanlis. Bayrak birakilsaydi, waitForSeqno'nun 45 sn
    // icinde dogrulayamadigi her gonderim 10 dk sonra "ucret alinmadi" olurdu.
    it('relay KABUL EDILDIKTEN sonra yetim bayragi DUSURULUR', () => {
        const body = relayBody()
        expect(body).not.toBeNull()

        expect(body).toContain('const sentMeta = { ...meta, [TON_RELAY_TX_FLAG]: false }')

        // Kapi icindeki HER yazma `sentMeta` kullanmali - biri `meta` ile kalirsa
        // bayrak geri gelir ve tarama yeniden yanlis etiketler.
        const gate = body.slice(body.indexOf("if (out?.status === 'sent') {"))
        const yazmalar = [...gate.matchAll(/updateTxStatus\(txId, [^)]*\)/g)].map((m) => m[0])
        expect(yazmalar.length, 'kapi icinde durum yazmasi yok').toBeGreaterThan(0)
        for (const y of yazmalar) expect(y, `bayragi tasiyan yazma: ${y}`).toContain('sentMeta')
    })

    // seqno ZINCIRDEN ve executeTonViaRelayer'a GIRMEDEN ONCE okunur. T6 tazeligi
    // dogrulamaz; bayat seqno sunucunun kurdugu govdeyi gecersiz kilar - imzalar
    // uretilir, ucret alinir, mesaj zincirde HIC islenmez.
    it('seqno ZINCIRDEN taze okunur ve intent e girer', () => {
        const body = relayBody()
        expect(body).not.toBeNull()

        const readAt = body.indexOf('await wallet.getSeqno()')
        const callAt = body.indexOf('await executeTonViaRelayer({')
        expect(readAt, 'zincirden seqno okumasi YOK').toBeGreaterThan(-1)
        expect(callAt, 'executeTonViaRelayer cagrisi YOK').toBeGreaterThan(-1)
        expect(readAt).toBeLessThan(callAt)

        // Okunup KULLANILMAMASI da bir gerileme olurdu.
        const intent = blockAfter(body, 'intent: {', '},')
        expect(intent, 'intent blogu yok').not.toBeNull()
        expect(intent).toContain('seqno,')
        expect(intent).toContain('tonPublicKey')
        expect(intent).toContain('tonWallet')
    })

    // YUKUMLULUK 8 - T9'un "yanlis token" saldirisini kapatan alan. Sunucudan
    // GELMEZ: zincirden (jettonAddress.js) cozulur. Tasinmazsa dogrulama kapali
    // tarafa duser ve jetton yolu HIC calismaz.
    it('jettonWallet ZINCIRDEN cozulup jetton eylemine KONUYOR', () => {
        expect(BG).toMatch(/import \{[^}]*getJettonWalletAddress[^}]*\} from '\.\/utils\/ton\/jettonAddress'/)

        const body = jettonBody()
        expect(body).not.toBeNull()

        const resolveAt = body.indexOf('await getJettonWalletAddress({')
        const callAt = body.indexOf('await tonRelayExecute({')
        expect(resolveAt, 'jetton cuzdani cozulmuyor').toBeGreaterThan(-1)
        expect(callAt, 'tonRelayExecute cagrilmiyor').toBeGreaterThan(-1)
        expect(resolveAt).toBeLessThan(callAt)

        // Cozulup EYLEME KONMAMASI kapiyi yine kapali birakirdi.
        const action = blockAfter(body, 'actions: [{', '}],')
        expect(action, 'jetton eylemi yok').not.toBeNull()
        expect(action).toContain("kind: 'jetton'")
        expect(action).toContain('jettonWallet: myJettonWallet')
        expect(action).toContain('jettonMaster: master')
    })

    // Imzalayanlar GERCEK olmali: enjeksiyon noktasi test icin vardi, uretimde
    // gercek anahtarlarla doldurulmazsa akis hicbir sey imzalayamaz.
    it('signers GERCEK imzalayanlara bagli (ed25519 + EVM kasasi)', () => {
        const body = relayBody()
        expect(body).not.toBeNull()

        const signers = blockAfter(body, 'signers: {', '\n    },')
        expect(signers, 'signers blogu yok').not.toBeNull()
        // A: ed25519 - TON gizli anahtariyla
        expect(signers).toMatch(/tonSign:[\s\S]*sign\(/)
        expect(signers).toContain('keyPair.secretKey')
        // B: secp256k1 - kasadan cozulen EVM cuzdaniyla
        expect(signers).toContain('createWalletInstance(account')
        expect(signers).toContain('signTypedData(domain, types, value)')
    })

    // Relay yolu sendTon/sendJetton'u ATLIYOR, yani onlarin para-kritik kapilarini
    // da atliyor. Gecersiz bir alici ya da alici olarak yazilmis bir jetton cuzdani
    // icin once ucret odenir, sonra token kaybolur.
    it('self-pay yolunun para-kritik kapilari relay dalinda da KURULU', () => {
        const native = nativeBody()
        const jetton = jettonBody()
        expect(native).not.toBeNull()
        expect(jetton).not.toBeNull()

        // Native: alici+miktar dogrulamasi AYNI fonksiyondan (kopya degil).
        expect(BG).toMatch(/import \{[^}]*buildTonTransfer[^}]*\} from '\.\/utils\/ton\/tonSend'/)
        expect(native).toContain('buildTonTransfer({ to, amount,')

        // Jetton: KAPI 1 (alici bir jetton cuzdani DEGIL) ve KAPI 4 (bekleyen islem).
        expect(BG).toMatch(/import \{[^}]*isJettonWallet[^}]*\} from '\.\/utils\/ton\/jettonSend'/)
        const relayBranch = blockAfter(jetton, 'if (relayMode) {', '\n        }')
        expect(relayBranch, 'jetton relay dali okunamadi').not.toBeNull()
        expect(relayBranch).toContain('await isJettonWallet({ client, address: recipient })')
        expect(relayBranch).toContain('hasPendingTonTx(otherPending)')
    })

    // KAPI 2 AYRI TEST: relay yolunda maliyeti self-pay'den STRIKT OLARAK YUKSEK.
    // Self-pay'de bakiyesi yetmeyen bir transfer zincirde duser ve kullanici HICBIR
    // SEY kaybetmez. Relay'de ayni dusus, dogrulama + iki imza + makbuz + ~18 ATS
    // tahsilatindan SONRA olur - ucret yanar, jetton hic gitmez. jettonSend.js kendi
    // basliginda "BU DOSYA IMZALAMADAN ONCEKI SON KAPIDIR" diyor ve arayuz okumasinin
    // yerine GECMEDIGINI soyluyor (iki ekran arasinda bakiye degismis olabilir).
    it('KAPI 2: jetton bakiyesi imzadan ONCE zincirden dogrulaniyor', () => {
        expect(BG).toMatch(/import \{[^}]*getJettonBalance[^}]*\} from '\.\/utils\/ton\/jettonBalance'/)

        const relayBranch = blockAfter(jettonBody(), 'if (relayMode) {', '\n        }')
        expect(relayBranch, 'jetton relay dali okunamadi').not.toBeNull()

        const balanceAt = relayBranch.indexOf('await getJettonBalance({')
        const execAt = relayBranch.indexOf('await tonRelayExecute({')
        // VARLIK ONCE - eksik dize -1 doner ve -1 < N her zaman dogrudur.
        expect(balanceAt, 'jetton bakiyesi HIC okunmuyor').toBeGreaterThan(-1)
        expect(execAt, 'tonRelayExecute cagrilmiyor').toBeGreaterThan(-1)
        expect(balanceAt).toBeLessThan(execAt)

        // Okuyup KARAR VERMEMEK kapiyi kurmus sayilmaz.
        expect(relayBranch).toContain("throw new Error('JETTON_INSUFFICIENT_BALANCE')")

        // Cozulmus jetton cuzdanindan okunmali - baska bir adresten okunan bakiye
        // baska bir tokenin bakiyesidir.
        expect(relayBranch).toContain('walletAddress: myJettonWallet')
    })

    // KAPI 3 (TON bakiyesi) BILEREK YOK: iliskilendirilen TON'u sunucu seciyor
    // (quote.attachNanoton) ve relay modunda kullanici ag ucretini odemiyor. Ikinci
    // bir esik iki farkli karar uretirdi.
    it('KAPI 3 (TON bakiyesi) relay dalinda YENIDEN KURULMUYOR', () => {
        const relayBranch = blockAfter(jettonBody(), 'if (relayMode) {', '\n        }')
        expect(relayBranch).not.toBeNull()
        // Eslenmis: yukaridaki test KAPI 2'nin VARLIGINI olcuyor, bu da KAPI 3'un
        // YOKLUGUNU - ikisi ayni anda yanlislikla yesil kalamaz.
        expect(relayBranch).not.toContain('JETTON_INSUFFICIENT_TON')
        expect(relayBranch).not.toContain('client.getBalance(')
    })

    // Sunucunun eylem sozlesmesinde yorum alani YOK. Sessizce dusurmek, memosuz
    // giden bir borsa yatirimini KAYIP yapar - bu yuzden acikca reddedilir.
    it('yorumlu gonderim relay yolunda SESSIZCE dusurulmez, REDDEDILIR', () => {
        const guard = blockAfter(BG, 'function assertRelayComment(', '\n}')
        expect(guard).not.toBeNull()
        expect(guard).toContain("throw new Error('TON_RELAY_COMMENT_UNSUPPORTED')")

        for (const [ad, body] of [['sendTonInternal', nativeBody()], ['sendJettonInternal', jettonBody()]]) {
            expect(body, `${ad}: yorum kapisi cagrilmiyor`).toContain('assertRelayComment(comment)')
        }
        // Kullaniciya HAM kod gitmesin.
        expect(BG).toContain("'TON_RELAY_COMMENT_UNSUPPORTED':")
    })

    it('acik anahtar TEK yerden turetiliyor (onizleme ve gonderim AYNI dize)', () => {
        // Ayrisirlarsa onizleme bir yazimla teklif alir, gonderim otekiyle dogrular
        // ve V6 (TON_QUOTE_PUBKEY_MISMATCH) FIYATI GORULMUS bir gonderimde duser.
        // Sayi 2: tonRelayExecute (dogrulamaya giden) + tonFeeIdentity (arayuze giden).
        expect(BG).toContain('const tonPublicKeyHex =')
        const kez = (BG.match(/tonPublicKeyHex\(keyPair\)/g) || []).length
        expect(kez, 'iki cagiran da AYNI yardimciyi kullanmali').toBe(2)
    })

    // Ucret kartinin tutari gosterebilmesi icin tonPublicKey KASADAN cikmali ve
    // bilesen kasaya erisemez. Mesaj hem BAGLI hem KAPIDAN gecmis olmali.
    it('tonPublicKey arka plandan bir MESAJLA geliyor ve kapiya yazilmis', () => {
        expect(BG).toContain('case "TON_FEE_IDENTITY":')
        const handler = blockAfter(BG, 'async function tonFeeIdentity(', '\n}')
        expect(handler).not.toBeNull()
        expect(handler).toContain('createTonKeyPair(account')
        expect(handler).toContain('tonPublicKey:')
        // Ozel anahtar YANITA GIRMEZ.
        expect(handler).not.toMatch(/secretKey/)

        expect(GATE_SRC).toContain("'TON_FEE_IDENTITY'")
    })

    // SINIRI GECEN HER ALAN IKI UCTAN DA KILITLENIR.
    //
    // `evmCapable` bu kuralin bedelini ikinci kez odettigi alan: tuketici ucu
    // (ConfirmTransaction.vue, `resp.evmCapable === true`) tonFeeUiWiring'de
    // kilitliydi ama URETICI ucu degildi. Alani buradan silmek yetiyordu -
    // `undefined` gelir, `tonFeeEvmCapable` kalici `false` olur, `tonRelayEligible`
    // ve `payWithTonFee` duser ve RELAY YOLU YENIDEN ULASILMAZ hale gelir; olculdu,
    // suit 58/58 YESIL kaliyordu. Bu, bu gorevin var olma sebebi olan durumun ta
    // kendisi. Tek uctan kilitlemek her zaman ulasilmazliga giden yesil bir yol
    // birakir.
    it('evmCapable URETICI ucta da kilitli (sinirin iki yani)', () => {
        const handler = blockAfter(BG, 'async function tonFeeIdentity(', '\n}')
        expect(handler).not.toBeNull()

        // (a) SILME yonu: alan yanitta VAR ve degeri relayer'in KENDI kapisindan
        //     turuyor - kopya bir yuklem yazilsaydi ikisi ayrisir, arayuz secenegi
        //     gosterir, arka plan reddederdi.
        expect(handler, 'evmCapable uretilmiyor').toContain('evmCapable: evmVaultResolvable(')
        expect(BG).toMatch(/import \{[^}]*evmVaultResolvable[^}]*\} from '\.\/utils\/ton\/tonFeeRelayer'/)

        // (b) ZAYIFLATMA yonu: sabit bir degere baglanmis olmamali. `true` her
        //     hesapta relay secenegini acar (TON'a kilitli hesap dahil, ki orada
        //     gonderim TON_RELAY_NO_EVM_VAULT ile cikmaza girer); `false` ozelligi
        //     tumden ulasilmaz yapar.
        expect(handler, 'evmCapable SABIT bir degere baglanmis').not.toMatch(/evmCapable:\s*(true|false)\b/)
    })
})

// ---------------------------------------------------------------------------
// IKINCI KEZ ODETMEME KAPISININ SELF-PAY YARISI (tasarim bolum 6).
//
// Tasarim acikca "moddan BAGIMSIZ" diyor: cozulmemis makbuz varken hem relay hem
// SELF-PAY yolu kapanir. Olculen baslangic durumu: `hasUnsettledTonFee`in TEK
// uretim cagirani `tonFeeRelayer.js` idi - self-pay dallari kapiyi HIC
// sormuyordu, yani kilit yalnizca yarim kuruluydu.
//
// Boslugun bedeli somut ve GERI DONUSSUZ: relay ucreti tahsil eder, yanit
// kaybolur (ag hatasi -> esem 'keep', makbuz CANLI kalir), islem karti 'error'
// yazilir ve hasPendingTonTx (yalniz 'queued'/'processing' sayar) ARTIK
// engellemez. Kullanicinin tekrar denemesi self-pay'e duserse (not ekledi ya da
// /status kapandi) seqno ILERLER ve makbuzdaki payloadBoc - belirli bir seqno'ya
// KILITLI - kalici olarak olur. Ucret alinmis, islem hicbir zaman gonderilmemis;
// iade YOK.
//
// Her iddia ESLENMIS (dosya basi notu 2): biri kapi SILINIRSE duser, digeri kapi
// GONDERIMDEN SONRAYA kayarsa duser - ikisi ayni anda yanlislikla yesil kalamaz.
// ---------------------------------------------------------------------------
describe('background.js - makbuz kilidi SELF-PAY yolunda da kurulu (tasarim 6)', () => {
    const nativeBody = () => blockAfter(BG, 'async function sendTonInternal(', '\n}')
    const jettonBody = () => blockAfter(BG, 'async function sendJettonInternal(', '\n}')

    it('kapi GERCEK bir okuma yapiyor - iki fonksiyon da IMPORT edilmis ve KULLANILMIS', () => {
        // Sabit `false` donduren ya da depoyu hic okumayan bir "kapi" butun sira
        // iddialarini yesil birakir ve HICBIR SEY engellemez.
        expect(BG).toMatch(
            /import \{[^}]*loadAllTonSettlements[^}]*\} from '\.\/utils\/ton\/tonFeeSettlement'/)
        expect(BG).toMatch(
            /import \{[^}]*hasUnsettledTonFee[^}]*\} from '\.\/utils\/ton\/tonFeeSettlement'/)

        const gate = blockAfter(BG, 'async function assertNoUnsettledTonFee(', '\n}')
        expect(gate, 'kapi fonksiyonu YOK').not.toBeNull()
        expect(gate, 'depo OKUNMUYOR').toContain('await loadAllTonSettlements()')
        expect(gate, 'yuklem CAGRILMIYOR').toContain('hasUnsettledTonFee(settlements)')
        // Okuyup KARAR VERMEMEK kapiyi kurmus sayilmaz. Kod, relay kolununkiyle
        // AYNI - mesaj tablosunda karsiligi zaten var ve iki mod icin de dogru.
        expect(gate, 'firlatma YOK').toContain("throw new Error('TON_RELAY_PENDING_SETTLEMENT')")
        expect(BG, 'kullaniciya HAM kod gider').toContain("'TON_RELAY_PENDING_SETTLEMENT':")
    })

    it('HER IKI self-pay kolu da kapiyi cagiriyor (native + jetton)', () => {
        for (const [ad, body] of [['sendTonInternal', nativeBody()], ['sendJettonInternal', jettonBody()]]) {
            expect(body, `${ad}: govde okunamadi`).not.toBeNull()
            expect(body, `${ad}: makbuz kapisi cagrilmiyor`).toContain('await assertNoUnsettledTonFee()')
        }
    })

    it('kapi GONDERIMDEN ONCE calisiyor - seqno ilerlemeden', () => {
        // Gonderimden SONRA sorulan bir kapi hicbir sey korumaz: seqno o an zaten
        // ilerlemis, saklanan govde coktan olmustur.
        for (const [ad, body, send] of [
            ['sendTonInternal', nativeBody(), 'await sendTon({'],
            ['sendJettonInternal', jettonBody(), 'await sendJetton({'],
        ]) {
            const gateAt = body.indexOf('await assertNoUnsettledTonFee()')
            const sendAt = body.indexOf(send)
            const relayAt = body.indexOf('if (relayMode) {')
            // VARLIK ONCE: eksik bir dize -1 doner ve -1 < N HER ZAMAN dogrudur -
            // silinmis bir cagri "once cagriliyor" gibi gorunurdu.
            expect(gateAt, `${ad}: makbuz kapisi YOK`).toBeGreaterThan(-1)
            expect(sendAt, `${ad}: self-pay gonderimi YOK`).toBeGreaterThan(-1)
            expect(relayAt, `${ad}: relay dali YOK`).toBeGreaterThan(-1)
            expect(gateAt, `${ad}: kapi gonderimden SONRA`).toBeLessThan(sendAt)
            // SELF-PAY yarisinda olmali: relay dali kendi kapisini
            // executeTonViaRelayer'in 4. adiminda zaten tasiyor.
            expect(gateAt, `${ad}: kapi relay dalindan ONCE`).toBeGreaterThan(relayAt)
        }
    })

    // UCUNCU SELF-PAY KOLU: takas. Inceleme once bu kolu BILEREK disarida
    // birakmisti (paylasilan hata yakalayicisi ham error.message yaziyor
    // gerekcesiyle) - ama ayni kart zaten TON_SWAP_* kodlarini ham yaziyor
    // (tonSwap.js), yani kapi yeni bir kusur sinifi ACMIYOR. Boslugun bedeli
    // digerleriyle AYNI: takas da bu cuzdanin seqno'sunu ilerletir ve canli bir
    // makbuzun payloadBoc'unu kalici olarak oldurur.
    it('TAKAS kolu da kapiyi cagiriyor (tonSwapExecute)', () => {
        const body = blockAfter(BG, 'async function tonSwapExecute(', '\n}')
        expect(body, 'tonSwapExecute govdesi okunamadi').not.toBeNull()
        expect(body, 'takas kolunda makbuz kapisi cagrilmiyor').toContain('await assertNoUnsettledTonFee()')
    })

    it('takas kolunda kapi GONDERIMDEN ONCE calisiyor - seqno ilerlemeden', () => {
        const body = blockAfter(BG, 'async function tonSwapExecute(', '\n}')
        expect(body, 'tonSwapExecute govdesi okunamadi').not.toBeNull()

        const gateAt = body.indexOf('await assertNoUnsettledTonFee()')
        const sendAt = body.indexOf('await sendTonSwap({')
        // VARLIK ONCE: eksik bir dize -1 doner ve -1 < N HER ZAMAN dogrudur -
        // silinmis bir cagri "once cagriliyor" gibi gorunurdu (bu planda uc kez
        // yasandi, bkz. dosya basi notu 2).
        expect(gateAt, 'takas kolunda makbuz kapisi YOK').toBeGreaterThan(-1)
        expect(sendAt, 'takas gonderimi (sendTonSwap) YOK').toBeGreaterThan(-1)
        expect(gateAt, 'kapi takas gonderiminden SONRA').toBeLessThan(sendAt)
    })

    // DORDUNCU SELF-PAY KOLU: TonConnect dapp gonderimi (tonDappSend, gorev 9,
    // inceleme turu 1 CRITICAL 2). Digerleriyle AYNI risk: dapp'in imzalattigi
    // gonderim de bu cuzdanin seqno'sunu ilerletir ve canli bir makbuzun
    // payloadBoc'unu kalici olarak oldurebilir. tonDappSend'in relayMode'u YOK
    // (TonConnect dapp gonderimi ucret sponsorlugunu desteklemiyor), bu yuzden
    // native/jetton ciftinin kullandigi relay-dali sira testi degil, takas
    // kolununkiyle AYNI dogrudan-sira testi kullanilir.
    it('DAPP (TonConnect) kolu da kapiyi cagiriyor (tonDappSend)', () => {
        const body = blockAfter(BG, 'async function tonDappSend(', '\n}')
        expect(body, 'tonDappSend govdesi okunamadi').not.toBeNull()
        expect(body, 'dapp kolunda makbuz kapisi cagrilmiyor').toContain('await assertNoUnsettledTonFee()')
    })

    it('dapp kolunda kapi GONDERIMDEN ONCE calisiyor - seqno ilerlemeden', () => {
        const body = blockAfter(BG, 'async function tonDappSend(', '\n}')
        expect(body, 'tonDappSend govdesi okunamadi').not.toBeNull()

        const gateAt = body.indexOf('await assertNoUnsettledTonFee()')
        const sendAt = body.indexOf('await wallet.send(body)')
        // VARLIK ONCE: eksik bir dize -1 doner ve -1 < N HER ZAMAN dogrudur -
        // silinmis bir cagri "once cagriliyor" gibi gorunurdu.
        expect(gateAt, 'dapp kolunda makbuz kapisi YOK').toBeGreaterThan(-1)
        expect(sendAt, 'dapp kolunda yayin (wallet.send) YOK').toBeGreaterThan(-1)
        expect(gateAt, 'kapi yayindan SONRA').toBeLessThan(sendAt)
    })
})
