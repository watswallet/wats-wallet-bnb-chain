// Sunucu, kullanicinin gonderdigi ANLAMSAL eylem listesinden W5 govdesini KENDI
// kurar ve bize hazir bir payloadBoc dondurur (spec 2.2). Yani kullanici
// KURMADIGI bir govdeyi imzalamak uzeredir. Bu dosya, o govdeyi imzadan ONCE
// acip kullanicinin gercekten istedigi seyle karsilastiran tek yerdir; burasi
// dusmeden imza asamasina gecilmez.
import { Address, Cell, comment as yorumHucresi, loadMessageRelaxed } from '@ton/core'
import { assertTonFeeDomain } from './tonFeeConfig'
import { asBigInt } from './tonFeeAmounts'
// TEP-74 transfer opcode'u. Gonderim tarafinin (jettonTransfer.js) kullandigi AYNI
// sabit: dogrulayici kendi kopyasini tutsaydi biri guncellenip digeri unutulabilirdi.
import { readJettonTransferBody } from './jettonBodyRead'

// W5 imzali INTERNAL istegin opcode'u. 'external' varyanti (0x7369676e) baska
// bir yol izler; ikisini karistirmak imzayi bambaska bir baglama tasir.
const W5_AUTH_SIGNED_INTERNAL = 0x73696e74
// out_action_send_msg#0ec3c86d mode:(## 8) out_msg:^MessageRelaxed
const ACTION_SEND_MSG = 0x0ec3c86d
// text_comment#00000000 -- TON'un duz metin notu (TEP-74 transferiyle ALAKASIZ,
// ayri bir op). Govde bu op'la basliyorsa jetton ayristiricisina GIRMEZ.
const TEXT_COMMENT_OP = 0
// Olculen gonderim modu: 1 (ucreti ayri ode) + 2 (hatalari yok say).
// 128 (KALAN BAKIYENIN TAMAMINI TASI) ve 64 (GELEN DEGERI TASI) modlarinda
// mesajin GERCEK tutari value alanindan bagimsizdir - o modda "hedef ve tutar
// niyetle ayni" kontrolu hicbir sey ifade etmez, cuzdanin tamami gidebilir.
const EXPECTED_SEND_MODE = 3

// Iki ayri tehlike, iki ayri sinir:
//   - Suresi GECMIS bir teklifi imzalamak: bosuna imza, sunucu reddeder.
//   - Suresi UZUN bir teklifi imzalamak: kullanicinin ATS'sini cok ileri bir
//     tarihe kadar baglayan bir odeme yetkisi vermis oluruz.
// Ust sinir sunucunun 120sn TTL'i degil, ona SAAT KAYMASI PAYI eklenmis hali:
// istemcinin saati birkac saniye ilerideyse dogru bir teklifi reddetmek,
// korudugumuz seyden daha pahaliya mal olur.
const MAX_AUTH_WINDOW_SEC = 180 // 120 sunucu TTL + 60 saat kaymasi payi

export class TonQuoteVerifyError extends Error {
    constructor(code, detail) {
        super(detail ? `${code}: ${detail}` : code)
        this.name = 'TonQuoteVerifyError'
        // Cagiran taraf mesaj metnini degil `code`u okur: ekranlarda hata
        // esleme tablosu (spec 7) koda gore calisir. `detail` yalniz teshis
        // icindir - tanimadigimiz bir govdeyle karsilastigimizda hangi op'a ya da
        // hangi ALANA takildigimizi mesajda gormek tek teshis ipucumuzdur.
        this.code = code
    }
}

function fail(code, detail) {
    throw new TonQuoteVerifyError(code, detail)
}

// TEP-74 jetton transfer govdesi (olculen yapi, 2026-08-29 canli jetton quote'u):
//   transfer#0f8a7ea5  query_id:uint64  amount:(VarUInteger 16)  destination:MsgAddress
//                      response_destination:MsgAddress  custom_payload:(Maybe ^Cell)
//                      forward_ton_amount:(VarUInteger 16)  forward_payload:(Either Cell ^Cell)
//
// Bu fonksiyon YALNIZ COZER; niyetle karsilastirma V5'in isidir. Ama cozemedigi ya da
// ANLAMADIGI her seyde duser: acilmis ama okunmamis bir alan, hic acilmamis govdeyle
// AYNI siniftadir. TEK ISTISNA forward_payload ve o da bir istisna DEGIL, ayni kuralin
// baska bir olcusu: icerigi COZULMEZ, HASH'i disari verilir ve V5 onu kendi kurdugu
// hucreyle karsilastirir (bkz. asagidaki not).
function parseJettonBody(body) {
    let ham
    try {
        ham = readJettonTransferBody(body)
    } catch (e) {
        // COZME ile KARAR ayri: okuyucu "anlamadim" der, hata KODUNU bu dosya
        // secer. `detail` aynen tasinir - tanimadigimiz bir govdeyle
        // karsilastigimizda hangi ALANA takildigimiz tek teshis ipucumuz.
        if (e?.name === 'JettonBodyReadError') fail('TON_PAYLOAD_BODY_UNVERIFIED', e.detail)
        throw e
    }

    return {
        amount: ham.amount,
        destination: ham.destination ? ham.destination.toString() : null,
        responseDestination: ham.responseDestination ? ham.responseDestination.toString() : null,
        // forward_ton_amount TEK BASINA bir UST SINIRA baglanmaz: bu TON mesajin
        // KENDI degerinden cikar (V5 onu attachNanoton ile sinirlar) ve DOGRULANMIS
        // `destination`a gider. Alt siniri V5'te olculur - notlu gonderimde sifir
        // olamaz, takasta ise niyetle BIREBIR tutmali.
        forwardTonAmount: ham.forwardTonAmount,
        // Yukun HASH'i - cozulmus icerigi DEGIL. Yoksa null, ve null da bir
        // degerdir: V5 "niyet bos" ile tam olarak bunu karsilastirir.
        //
        // ICERIK BURADA VERILMEZ ve bu bilincli: bu dosya DUSMANCA bir govdeyi
        // olcuyor. Hucreyi disari vermek, cagiranin onu "anlamaya" calismasina
        // kapi acardi; hash ise anlamadan BIREBIR esitlik olcmeye zorlar.
        forwardPayloadHash: ham.forwardPayload ? ham.forwardPayload.hash().toString('hex') : null,
    }
}

/**
 * Sunucunun kurdugu W5 imzali internal govdesini cozer.
 *
 * Olculen yapi (2026-08-29, canli quote):
 *   root:  op(32)=0x73696e74  walletId(32)  validUntil(32)  seqno(32)
 *          out_actions:(Maybe ^OutList)(1 bit)  has_other_actions(1 bit)
 *     ref0:  action_send_msg(32)=0x0ec3c86d  sendMode(8)
 *       ref0: bir sonraki eylem (bos hucre = liste sonu)
 *       ref1: MessageRelaxed
 *
 * @returns {{op:number, walletId:number, validUntil:number, seqno:number,
 *            messages:Array<{to:string, valueNano:bigint, sendMode:number,
 *              jetton:null|{amount:bigint, destination:string|null,
 *                           responseDestination:string|null, forwardTonAmount:bigint,
 *                           forwardPayloadHash:string|null}}>}}
 * @throws {TonQuoteVerifyError} TON_PAYLOAD_UNPARSEABLE | TON_PAYLOAD_UNKNOWN_ACTION |
 *   TON_PAYLOAD_BODY_UNVERIFIED | TON_PAYLOAD_INIT_UNVERIFIED
 */
export function parseTonPayload(payloadBoc, { hamGovdeyeIzinVer = false } = {}) {
    let root
    try {
        root = Cell.fromBase64(String(payloadBoc ?? ''))
    } catch {
        // Acilmayan bir govdeyi "herhalde iyidir" deyip imzalamak, dogrulama
        // kapisini tamamen atlamak demektir.
        fail('TON_PAYLOAD_UNPARSEABLE')
    }

    let op, walletId, validUntil, seqno, hasOutActions, hasOtherActions, listRef
    try {
        const s = root.beginParse()
        op = s.loadUint(32)
        walletId = s.loadUint(32)
        validUntil = s.loadUint(32)
        seqno = s.loadUint(32)
        hasOutActions = s.loadBit()
        hasOtherActions = s.loadBit()
        listRef = hasOutActions ? s.loadRef() : null
    } catch {
        fail('TON_PAYLOAD_UNPARSEABLE')
    }

    // BU AYRISTIRICININ KURALI: DOGRULAMADIGIMIZ HICBIR SEYI GECMEYIZ.
    // Bu gorevde ayni siniftan dort delik cikti - sendMode, has_other_actions,
    // mesaj govdesi ve init. Her biri "okunup yok sayilan" bir alandi ve her biri
    // testleri YESIL birakiyordu. Yeni bir alan eklenirse varsayilan cevap
    // FIRLATMAK olmali; gecirmek ancak o alan icin bir dogrulama yazildiktan sonra.

    // has_other_actions, W5'in "genisletilmis eylemler" bolumu: eklenti ekleme,
    // imza dogrulamasini kapatma gibi cuzdanin KONTROLUNU degistiren islemler
    // buradan gecer. Cozmedigimiz bir bolumu bos verip gecmek, saldirganin
    // gorunmez bir eylemi yanina eklemesine izin verirdi.
    if (hasOtherActions) fail('TON_PAYLOAD_UNKNOWN_ACTION')

    const messages = []
    let list = listRef ? listRef.beginParse() : null
    // OutList bir zincir: her halka bir eylem + bir sonraki halkanin ref'i.
    // Bos hucre listenin sonudur.
    while (list && (list.remainingBits > 0 || list.remainingRefs > 0)) {
        let tag, sendMode, next, msgSlice
        try {
            tag = list.loadUint(32)
            sendMode = list.loadUint(8)
            next = list.loadRef()
            msgSlice = list.loadRef().beginParse()
        } catch {
            fail('TON_PAYLOAD_UNPARSEABLE')
        }

        // TANIMADIGIMIZ ETIKET = DUR. "Zararsizdir" varsayip atlamak tam olarak
        // V5'in kapatmak icin var oldugu delik: dogrulanmamis fazladan bir
        // eylem kullanicinin imzasiyla birlikte yayina cikar.
        if (tag !== ACTION_SEND_MSG) fail('TON_PAYLOAD_UNKNOWN_ACTION')

        let msg
        try {
            msg = loadMessageRelaxed(msgSlice)
        } catch {
            fail('TON_PAYLOAD_UNPARSEABLE')
        }
        // external mesajin hedefi/tutari bizim okudugumuz alanlarda YOK; onu
        // "hedefi bos" diye gecmek yine dogrulanmamis bir eylem birakirdi.
        if (msg.info.type !== 'internal') fail('TON_PAYLOAD_UNKNOWN_ACTION')

        // INIT TASIYAN MESAJ = DUR. `init` (StateInit) hedefe kontrat dagitir.
        // Bunu okuyup yok saymak, yukaridaki kuralin ihlalidir: `dest` ve
        // `value` V5 tarafindan kilitli oldugu icin bu alan TEK BASINA parayi
        // baska yere gonderemez, ama dogrulamadigimiz bir alani gecirmek
        // diger uc delikle AYNI sekildi. Dagitilacak kodun hash'i teshis icin
        // mesaja yazilir.
        if (msg.init) {
            const initDetail = msg.init.code
                ? '0x' + msg.init.code.hash().toString('hex')
                : 'code yok'
            fail('TON_PAYLOAD_INIT_UNVERIFIED', initDetail)
        }

        // GOVDE: TASK 2'NIN KAPISI SILINMEDI, YERINE KONDU.
        // Jetton transferinde mesajin `dest`i KENDI jetton cuzdanimiz, `value`si
        // iliskilendirilen TON'dur; GERCEK alici ve GERCEK token tutari govdedeki
        // transfer#0f8a7ea5 yukundedir. Govdeyi okumadan "hedef ve tutar niyetle
        // ayni" demek, jetton yolunda HICBIR SEY dogrulamadan yesil yanmak olurdu.
        // Bu yuzden govde ACILIR ve icindeki alanlar V5'te niyetle karsilastirilir;
        // TANIMADIGIMIZ her govde ise hala TON_PAYLOAD_BODY_UNVERIFIED ile duser.
        const body = msg.body.beginParse()
        const bosGovde = body.remainingBits === 0 && body.remainingRefs === 0

        // OP'A GORE DALLAN, "govde dolu mu"ya gore DEGIL.
        //
        // Eskiden dolu her govde parseJettonBody'ye gidiyordu ve YORUMLU bir duz
        // TON mesaji orada TON_PAYLOAD_BODY_UNVERIFIED ile DUSUYORDU -- notlu
        // gonderimin rolede yasak olmasinin gercek sebebi buydu. Yorum bir jetton
        // transferi degil; kendi op'u var (text_comment = 0x00000000).
        //
        // KAPI DARALMIYOR: taninmayan op HALA duser (asagidaki parseJettonBody
        // dali, degismemis metniyle). Yalnizca TANIDIGIMIZ ikinci bir govde sekli
        // eklendi -- ve yorum METIN OLARAK COZULMEZ (snake hucre zinciri, cok
        // baytli karakterler): hucrenin HASH'i disari verilir ve V5 kendi kurdugu
        // hucrenin hash'iyle karsilastirir. Cozmek yerine yeniden kurup
        // karsilastirmak, ayristirici farkliliginin acabilecegi her bosluğu kapatir.
        const op = (!bosGovde && body.remainingBits >= 32) ? body.preloadUint(32) : null

        let jetton = null
        if (!bosGovde) {
            if (op === TEXT_COMMENT_OP) {
                // Yorum govdesi ACILMAZ: karsilastirma asagidaki `bodyHash`
                // uzerinden, V5'te yapilir.
            } else if (!hamGovdeyeIzinVer) {
                // op null (32 bitten kisa govde) dahil: eski davranis, eski hata metni.
                jetton = parseJettonBody(body)
            }
            // hamGovdeyeIzinVer: govde ACILMAZ, yalnizca hash'i disari verilir ve
            // V5 onu NIYETTEKI payloadBoc'un hash'iyle karsilastirir. Bu bir gevseme
            // DEGIL, dogrulamanin YER DEGISTIRMESIDIR: "govdeyi anliyor muyum"
            // sorusunun yerini "govde kullanicinin ekranda onayladigi govdenin
            // TA KENDISI mi" sorusu alir -- ve ikincisi opak yuk icin daha gucludur,
            // cunku anlamak zorunda kalmadan BIREBIR esitlik olcer.
        }

        messages.push({
            to: msg.info.dest.toString(),
            valueNano: msg.info.value.coins,
            sendMode,
            // GOVDENIN TEK OLCUSU. Bos govdede null. Hem yorum (kind:'ton') hem ham
            // yuk (kind:'raw') bununla karsilastirilir -- AYRI bir `commentHash`
            // tutmak bir delik aciyordu: karisik bir niyet listesinde (bir raw + bir
            // ton) `hamGovdeyeIzinVer` GLOBAL oldugu icin `ton` eyleminin taninmayan
            // govdesi parseJettonBody'yi atlar, commentHash null kalir, beklenen de
            // null olur ve DOGRULANMAMIS bir govde gecerdi. `bodyHash` bu durumda
            // DOLU oldugu icin ayni karsilastirma onu yakalar.
            bodyHash: bosGovde ? null : msg.body.hash().toString('hex'),
            // `bounce` NIYETIN parcasidir: duz transferde false (hedef zincirde
            // yoksa para geri sekmesin), kontrat cagrisinda true (cagri duserse TON
            // kontratta kilitli kalmasin). Sunucu secerse niyetten sapabilir.
            bounce: !!msg.info.bounce,
            // Duz TON mesajinda null. V5 hangi alanlarla karsilastiracagini bu
            // ayrimla secer.
            jetton,
        })
        list = next.beginParse()
    }

    // KANONIK SIRA: OutList'te EN DISTAKI hucre SON eylemdir, ilk degil.
    // @ton/core'un kendi loadOutList'i de ayni dolasimi yapip sonunda
    // reverse() cagirir (dist/types/OutList.js). Bu satir olmadan iki eylemli
    // bir listede mesajlar TERS sirada donuyordu; V5 niyetle sirali
    // karsilastirma yaptigi icin gecerli bir teklif YANLIS yere reddedilirdi
    // (kapali taraf, ama yaniltici bir kodla sert blok).
    messages.reverse()

    return { op, walletId, validUntil, seqno, messages }
}

// 0x on eki ve buyuk/kucuk harf farki AYNI degeri iki farkli metinle yazar;
// duz string karsilastirmasi dogru bir anahtari YANLIS reddederdi. Bos taraf
// asla esit sayilmaz: eksik alan sessizce "uyustu" olmamali.
function hexEsit(a, b) {
    const n = (v) => String(v ?? '').trim().toLowerCase().replace(/^0x/, '')
    const x = n(a)
    return x.length > 0 && x === n(b)
}

// AYNI TON adresinin birden cok gecerli yazimi var (EQ../UQ.., bounce eden ya
// da etmeyen). String karsilastirmasi dogru adresi reddeder ve bu, sonradan
// "adresi normalize edelim" diye YANLIS yonde cozulur.
function adresEsit(a, b) {
    try {
        return Address.parse(String(a)).equals(Address.parse(String(b)))
    } catch {
        return false
    }
}

// Sayi cevrimi basarisiz olursa DUSER. Bozuk bir tutari 0 sayip devam etmek,
// dogrulamayi tam da korumasi gereken alanda kor birakirdi.
function tamSayi(v, code) {
    try {
        return asBigInt(v)
    } catch {
        fail(code)
    }
}

// quoteId = <base64url(govde)>.<hmac>. HMAC'i istemci DOGRULAYAMAZ (anahtar
// sunucuda), ama govde sunucunun MUHURLEDIGI degerleri tasir; ust seviye
// alanlar bu muhurden ayrisirsa gosterilen/imzalanan sayi sunucunun kaydettigi
// sayi degildir. Buffer yerine atob: MV3 service worker'inda Buffer yok.
function muhruCoz(quoteId) {
    const b64 = String(quoteId ?? '').split('.')[0].replace(/-/g, '+').replace(/_/g, '/')
    try {
        return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
    } catch {
        fail('TON_QUOTE_SEALED_MISMATCH')
    }
}

/**
 * Sunucunun donderdigi quote'u, kullanicinin NIYETI ile karsilastirir.
 * Kontroller spec 3.1'deki sirayla calisir ve ilk dusende firlatir; birisi
 * bile gecmezse imza asamasina HIC gidilmez.
 *
 * @param {object} quote  /paymaster/ton/quote yaniti (olculen sekil, spec 2.3)
 * @param {{tonWallet:string, tonPublicKey:string, seqno:number|string|bigint,
 *          approvedAtsFee:bigint|string, now:number|bigint,
 *          actions:Array<{kind?:'ton'|'jetton'|'raw', to:string, amountNano?:bigint|string,
 *                         amount?:bigint|string, jettonWallet?:string, comment?:string,
 *                         forwardTonNano?:bigint|string, forwardPayloadBoc?:string}>}} intent
 *   Jetton eyleminde tutar alani `amount` (sunucunun olculen sozlesmesiyle ayni ad)
 *   ve `jettonWallet` GONDERENIN kendi jetton cuzdanidir - sunucuya GITMEZ, yalniz
 *   "hangi token" dogrulamasinin girdisidir.
 *   `seqno` ZINCIRDEN okunan deger, `approvedAtsFee` kullaniciya GOSTERILEN
 *   ve onaylanan tutar, `now` dogrulama anidir.
 * @returns {void}
 * @throws {TonQuoteVerifyError}
 */
export function verifyTonQuote(quote, intent) {
    const feeAuth = quote?.sign?.feeAuth ?? {}
    // HAM GOVDEYE IZIN NIYETTEN GELIR, sunucudan DEGIL. Ancak kullanicinin
    // onayladigi eylem ACIKCA bir `payloadBoc` tasiyorsa cozulemeyen bir govde
    // kabul edilir -- ve o zaman da V5 onu BIREBIR hash esitligiyle olcer. Bayrak
    // sunucunun gonderdigi bir seyden turetilseydi, ele gecirilmis bir backend
    // kapiyi kendisi acardi.
    const hamGovdeyeIzinVer = (Array.isArray(intent?.actions) ? intent.actions : [])
        .some((a) => a?.kind === 'raw' && String(a?.payloadBoc ?? '').trim() !== '')
    const payload = parseTonPayload(quote?.payloadBoc, { hamGovdeyeIzinVer })

    // V1 hash(payloadBoc) === sign.tonPayloadHash === feeAuth.actionHash.
    // Ayrisirlarsa kullaniciya gosterilen govde ile EIP-712'de imzalanan
    // actionHash farkli iki eyleme isaret eder: ucret birine, TON imzasi
    // otekine baglanir.
    const hash = '0x' + Cell.fromBase64(quote?.payloadBoc).hash().toString('hex')
    if (!hexEsit(hash, quote?.sign?.tonPayloadHash)) fail('TON_QUOTE_HASH_MISMATCH')
    if (!hexEsit(hash, feeAuth.actionHash)) fail('TON_QUOTE_HASH_MISMATCH')

    // V2 opcode auth_signed_internal olmali. external varyanti bambaska bir
    // yayin yolu ve baska bir imza baglami demektir.
    if (payload.op !== W5_AUTH_SIGNED_INTERNAL) fail('TON_QUOTE_AUTH_TYPE')

    // V3 govdedeki validUntil = quote.validUntil = feeAuth.deadline. Ekranda
    // gosterilen sure ile govdenin gercek suresi ayrisirsa kullanici artik
    // gecerli olmayan bir seyi imzalamis ya da suresi cok uzun bir yetki
    // vermis olur.
    const validUntil = tamSayi(payload.validUntil, 'TON_QUOTE_DEADLINE_MISMATCH')
    if (validUntil !== tamSayi(quote?.validUntil, 'TON_QUOTE_DEADLINE_MISMATCH')) fail('TON_QUOTE_DEADLINE_MISMATCH')
    if (validUntil !== tamSayi(feeAuth.deadline, 'TON_QUOTE_DEADLINE_MISMATCH')) fail('TON_QUOTE_DEADLINE_MISMATCH')

    // V4 govdedeki seqno = feeAuth.seqno = ZINCIRDEN okunan seqno. Uyusmazsa
    // imza ya hic gecmez ya da baska bir sirada yayinlanir.
    const seqno = tamSayi(payload.seqno, 'TON_QUOTE_SEQNO_MISMATCH')
    if (seqno !== tamSayi(feeAuth.seqno, 'TON_QUOTE_SEQNO_MISMATCH')) fail('TON_QUOTE_SEQNO_MISMATCH')
    if (seqno !== tamSayi(intent?.seqno, 'TON_QUOTE_SEQNO_MISMATCH')) fail('TON_QUOTE_SEQNO_MISMATCH')

    // V5 GOVDEDEKI HER MESAJ, KULLANICININ ISTEDIGIYLE AYNI.
    // Bu ozelligin en onemli kontrolu. Digerleri quote'un kendi icinde tutarli
    // oldugunu olcer; V5 NIYET olcer. Ele gecirilmis bir backend'in kullaniciya
    // parasini baska bir adrese gonderten govde imzalatmasini engelleyen TEK
    // kontrol budur. Sira da onemli: sunucu eylemleri gonderdigimiz sirada
    // kurar, sirasi degisen bir liste ayni liste degildir - karsilastirma
    // parseTonPayload'in KANONIK sirasi uzerinden yapilir (bkz. messages.reverse).
    const istenen = Array.isArray(intent?.actions) ? intent.actions : []
    if (payload.messages.length !== istenen.length) fail('TON_QUOTE_INTENT_MISMATCH')
    for (let i = 0; i < istenen.length; i++) {
        const mesaj = payload.messages[i]
        const eylem = istenen[i]

        // TANIMADIGIMIZ TUR DUZ TON'A DUSURULMEZ. "jetton mi degil mi" diye soran
        // bir kontrol 'swap'i, bir yazim hatasini ya da sonradan eklenen bir turu
        // SESSIZCE duz TON dalindan olcer ve "dogruladim" der - oysa o eylem seklini
        // bu dosya ANLAMIYOR. Ayni kural bir dosya oteki tonFeeRelayer'da da var
        // (taninmayan kind FIRLATIR, yok sayilmaz); burada da olmali, cunku
        // verifyTonQuote DISA ACIK guvenlik sinirdir ve tek cagirani relayer olmak
        // zorunda degil. `kind` YAZILMAMIS eski cagrilar duz TON sayilir.
        const tur = eylem?.kind ?? 'ton'
        if (tur !== 'ton' && tur !== 'jetton' && tur !== 'raw') fail('TON_QUOTE_INTENT_MISMATCH')
        // TUR ESLESMESI IKI YONLU. Niyet jetton derken sunucunun duz TON gonderen
        // bir govde kurmasi (ya da tersi) sessizce gecemez: turler yer degistirirse
        // karsilastirilan alanlar da yer degistirir ve dogrulama baska bir seyi olcer.
        if ((tur === 'jetton') !== !!mesaj.jetton) fail('TON_QUOTE_INTENT_MISMATCH')

        if (tur === 'raw') {
            // HAM GOVDE: ANLAM DEGIL, OZDESLIK olculur.
            //
            // Bu turde govdenin ne yaptigini BILMIYORUZ ve bilmeyi de denemiyoruz --
            // dapp'ten gelen opak bir BOC. Dogrulama bu yuzden "govde mantikli mi"
            // sorusunu degil, "govde kullanicinin ekranda gordugu govdenin TA KENDISI
            // mi" sorusunu yanitlar. Hash esitligi bunun icin ANLAMSAL cozumlemeden
            // GUCLUDUR: tek bit farki yakalar.
            if (!adresEsit(mesaj.to, eylem?.to)) fail('TON_QUOTE_INTENT_MISMATCH')
            const hamTutar = tamSayi(eylem?.amountNano, 'TON_QUOTE_INTENT_MISMATCH')

            const yuk = String(eylem?.payloadBoc ?? '').trim()
            if (yuk) {
                // Gaz payi RELAYER'IN cebinden cikar ve giden degere EKLENIR
                // (olculdu: mesaj degeri = amountNano + gasTonNano). Toplam
                // beklenenden BUYUKSE fazlasi kullanicinin kendi bakiyesinden
                // cikardi -- urunun on kabulu ise kullanicinin TON tutmadigidir.
                const gaz = tamSayi(eylem?.gasTonNano, 'TON_QUOTE_INTENT_MISMATCH')
                if (mesaj.valueNano !== hamTutar + gaz) fail('TON_QUOTE_INTENT_MISMATCH')

                let beklenen
                try {
                    beklenen = Cell.fromBase64(yuk).hash().toString('hex')
                } catch {
                    // Niyetin KENDI yuku cozulemiyorsa karsilastiracak bir sey yok.
                    fail('TON_QUOTE_INTENT_MISMATCH')
                }
                if (mesaj.bodyHash !== beklenen) fail('TON_QUOTE_INTENT_MISMATCH')
            } else {
                // Yuksuz raw: govde BOS olmali. Sunucunun bos govdeye bir sey
                // EKLEMESI burada duser.
                if (mesaj.valueNano !== hamTutar) fail('TON_QUOTE_INTENT_MISMATCH')
                if (mesaj.bodyHash !== null) fail('TON_QUOTE_INTENT_MISMATCH')
            }

            // `bounce` PARA-KRITIK: kontrat cagrisinda false, cagri duserse TON'u
            // hedefte kilitli birakir; duz transferde true, hedef henuz zincirde
            // yoksa parayi geri sektirir. Niyetten sapmasi kullanicinin onaylamadigi
            // bir davranistir.
            if (mesaj.bounce !== !!eylem?.bounce) fail('TON_QUOTE_INTENT_MISMATCH')
        } else if (mesaj.jetton) {
            // JETTON: KARSILASTIRMA IC ALANLARLA YAPILIR.
            // Dis `dest` kendi jetton cuzdanimiz, dis `value` iliskilendirilen
            // TON'dur; ikisini niyetle karsilastirmak tokenlarin KIME gittigi
            // hakkinda hicbir sey soylemez.
            if (!adresEsit(mesaj.jetton.destination, eylem?.to)) fail('TON_QUOTE_INTENT_MISMATCH')
            const tokenTutari = tamSayi(eylem?.amount, 'TON_QUOTE_INTENT_MISMATCH')
            if (mesaj.jetton.amount !== tokenTutari) fail('TON_QUOTE_INTENT_MISMATCH')

            // HANGI TOKEN? Dis hedef, transferin gectigi jetton cuzdanidir ve o
            // cuzdan HANGI jetton oldugunu belirler. Ic alici ve ic tutar niyetle
            // birebir ayni olsa bile BASKA bir jetton cuzdanimizdan gecen transfer
            // kullanicinin gonderdigini sandigi token DEGILDIR. Jetton cuzdan adresi
            // zincirden turer (jettonAddress.js), bu saf dosyada HESAPLANAMAZ - bu
            // yuzden niyetin kendisi tasir; tasimiyorsa dogrulanamaz ve DUSER.
            if (!adresEsit(mesaj.to, eylem?.jettonWallet)) fail('TON_QUOTE_INTENT_MISMATCH')

            // ARTAN TON KIME DONER? response_destination, harcanmayan iliskilendirilmis
            // TON'un iade adresidir; saldirganin adresi yazilirsa artan ona kalir.
            if (!adresEsit(mesaj.jetton.responseDestination, intent?.tonWallet)) {
                fail('TON_QUOTE_INTENT_MISMATCH')
            }

            // ILISKILENDIRILEN TON, cuzdanin bakiyesinden cikar ve niyet bu tutari
            // BELIRTMEZ (sunucu secer) - o yuzden esitlik degil UST SINIR olcuyoruz:
            // relayer'in yatirdigi attachNanoton (olculdu: iki ayri jetton quote'unda
            // da dis deger 50000001, attachNanoton ise ondan buyuk).
            //
            // BU KONTROL NE YAKALAR, NE YAKALAMAZ: karsilastirdigimiz iki degeri de
            // SUNUCU uretir, yani bu dosyanin tehdit modelindeki ELE GECIRILMIS
            // backend siniri kendisiyle birlikte YUKARI TASIYABILIR. Yakaladigi sey
            // TUTARSIZ bir sunucudur - yatirdigindan fazlasini gonderen bir govde.
            // Artik risk kucuk, cunku bu daldaki DIGER kontroller bagimsiz: sisirilmis
            // TON, DOGRULANMIS `destination`in jetton cuzdanina gider ve artani
            // DOGRULANMIS `response_destination` (kullanicinin KENDI cuzdani) uzerinden
            // geri doner - saldirganin cebine degil.
            const yatirilan = tamSayi(quote?.attachNanoton, 'TON_QUOTE_INTENT_MISMATCH')
            if (mesaj.valueNano > yatirilan) fail('TON_QUOTE_INTENT_MISMATCH')

            // FORWARD_PAYLOAD TEK BIR SLOTTUR, niyette IKI SEKILDE ifade edilir:
            //
            //   comment            -> YORUM. Hucreyi BIZ kurariz ve hash'ini
            //                         karsilastiririz (duz TON'daki `bodyHash` ile
            //                         ayni teknik).
            //   forwardPayloadBoc  -> TAKAS. Opak bir DEX yuku; ne yaptigini
            //                         BILMIYORUZ ve bilmeyi denemiyoruz. Olculen sey
            //                         ANLAM degil OZDESLIK - `kind:'raw'` dalindaki
            //                         AYNI soru: "govde kullanicinin ekranda
            //                         onayladigi govdenin TA KENDISI mi".
            //
            // IKISI BIRDEN GECERSIZ: TEP-74'te forward_payload TEKTIR, ikisini birden
            // tasiyan bir niyette hangisinin dogrulandigi belirsiz kalirdi. Sunucu da
            // reddediyor (olculdu 2026-09-15: "actions[0]: comment and
            // forwardPayloadBoc cannot be given together").
            //
            // TAKASTA BU KARSILASTIRMA TEK GERCEK KORUMADIR. Sunucu yukun ICERIGINI
            // HIC denetlemiyor (sozlesme ss05: opcode, swap parametreleri, slippage,
            // alici adres - hicbiri okunmuyor); yalniz base64 gecerliligine, boyuta
            // ve tek kokluluge bakiyor. Bu adimi atlayan bir cuzdan, ele gecirilmis
            // bir backend'in beyaz listedeki HERHANGI bir router'a KEYFI bir swap
            // kurup kullaniciya imzalatmasina acik kalir.
            //
            // `trim()` cagiranin (tonFeeRelayer.quoteAction, buildJettonTransferBody)
            // uyguladigi AYNI normalizasyon: ekranda gorulen ile imzalanan ayni dize.
            const jYorum = typeof eylem?.comment === 'string' ? eylem.comment.trim() : ''
            const jYuk = String(eylem?.forwardPayloadBoc ?? '').trim()
            if (jYorum && jYuk) fail('TON_QUOTE_INTENT_MISMATCH')

            let jBeklenen = null
            if (jYuk) {
                try {
                    jBeklenen = Cell.fromBase64(jYuk).hash().toString('hex')
                } catch {
                    // Niyetin KENDI yuku cozulemiyorsa karsilastiracak bir sey yok.
                    fail('TON_QUOTE_INTENT_MISMATCH')
                }
            } else if (jYorum) {
                jBeklenen = yorumHucresi(jYorum).hash().toString('hex')
            }
            // NULL DA BIR DEGERDIR: niyet bossa sunucunun forward_payload EKLEMESI de
            // burada duser. Notu sessizce eklemek, sessizce dusurmek kadar zararli.
            if (mesaj.jetton.forwardPayloadHash !== jBeklenen) fail('TON_QUOTE_INTENT_MISMATCH')

            // FORWARD_TON_AMOUNT - iki sekil, iki farkli olcu.
            //
            // NIYET SOYLUYORSA (takas): BIREBIR esitlik. Tutari sunucu secmez, BIZ
            // veririz - DEX'in istedigi gaz payi odur ve sozlesme alt siniri acikca
            // bize birakiyor (ss04: "Backend alt sinir dayatmaz; DEX'in istedigi
            // duzeye siz cikarin"). Sunucu onu DUSURURSE swap router'da gazsiz kalir:
            // zincirde sessizce duser, ucret ise ALINMISTIR.
            //
            // NIYET SUSUYORSA (notlu gonderim): yalniz ALT sinir. Tutari sunucu secer;
            // bizim sart kostugumuz tek sey sifir OLMAMASI - notu aliciya tasiyan
            // transfer_notification mesaji yalniz forward_ton_amount > 0 ise OLUSUR.
            // Sifirda not govdeye yazilir, hash tutar, dogrulama yesil yanar ve not
            // hicbir zaman TESLIM EDILMEZ; yani hash kontrolu TEK BASINA yetmez.
            // (jettonTransfer.js KAPI 1 ile ayni kural: orada KENDI govdemizi
            // kurarken, burada SUNUCUNUNKINI olcerken.)
            //
            // NOTSUZ ve YUKSUZ gonderimde kural YOK ve bu bilincli: teslim edilecek
            // bir sey olmadigi icin bildirim mesajinin olusmamasi bir kayip degildir.
            if (eylem?.forwardTonNano !== undefined && eylem?.forwardTonNano !== null) {
                const jIleri = tamSayi(eylem.forwardTonNano, 'TON_QUOTE_INTENT_MISMATCH')
                if (mesaj.jetton.forwardTonAmount !== jIleri) fail('TON_QUOTE_INTENT_MISMATCH')
            } else if (jYuk) {
                // Yuk VAR ama niyet tutari SOYLEMIYOR: dogrulayacak bir sey yok ve
                // sunucunun varsayilani (1 nanoton) bir DEX cagrisini FONLAMAZ.
                fail('TON_QUOTE_INTENT_MISMATCH')
            } else if (jYorum && mesaj.jetton.forwardTonAmount <= 0n) {
                fail('TON_QUOTE_INTENT_MISMATCH')
            }

            // BOUNCE JETTONDA HER ZAMAN TRUE - bir SABIT, niyetin tasidigi bir alan
            // degil (bu yuzden JETTON_ACTION_KEYS'te de yok). Sozlesmenin ss05 mesaj
            // tablosu boyle diyor, olculen altin vektor de oyle, ve kendi self-pay
            // yolumuz (jettonSend.js) bilerek true seciyor.
            //
            // NEDEN PARA-KRITIK: transfer duserse (bozuk govde, yaris halinde dusen
            // bakiye, router'in reddi) iliştirilen TON yalniz bounce=true iken GERI
            // DONER. false ile hedefte kilitli kalir - kullanicinin kendi jetton
            // cuzdaninda, sessizce yanmis olarak.
            //
            // Alan ayristiricida bastan beri OKUNUYORDU ama yalniz `raw` dalinda
            // karsilastiriliyordu; jetton ve duz TON dallarinda okunup YOK SAYILIYORDU
            // - bu dosyanin kapatmak icin var oldugu delik sinifinin ta kendisi
            // (bkz. yukarida "DOGRULAMADIGIMIZ HICBIR SEYI GECMEYIZ").
            if (mesaj.bounce !== true) fail('TON_QUOTE_INTENT_MISMATCH')
        } else {
            if (!adresEsit(mesaj.to, eylem?.to)) fail('TON_QUOTE_INTENT_MISMATCH')
            const tutar = tamSayi(eylem?.amountNano, 'TON_QUOTE_INTENT_MISMATCH')
            if (mesaj.valueNano !== tutar) fail('TON_QUOTE_INTENT_MISMATCH')

            // YORUM (memo) - IKI YONLU ve HASH UZERINDEN.
            //
            // Beklenen hucreyi BURADA kuruyoruz; sunucunun govdesini metne
            // COZMUYORUZ. Sebep: uzun bir yorum snake hucre zincirine bolunur ve
            // cok baytli bir karakter tam bolme noktasina denk gelebilir - kendi
            // cozucumuzu yazmak, sunucununkiyle ayrisabilecek ikinci bir
            // ayristirici demekti. Yeniden kurup hash karsilastirmak o sinifi
            // tumden kapatir: esitse govde BIREBIR kullanicinin yazdigi nottur.
            //
            // NULL DA BIR DEGERDIR: niyet yorumsuzken sunucunun govdeye bir not
            // EKLEMESI de bu satirda duser. Notu sessizce eklemek, sessizce
            // dusurmek kadar zararli - memosuz giden bir borsa yatirimi KAYIP
            // sayilir, memosu DEGISTIRILMIS olan da oyle.
            //
            // `trim()` cagiranin (buildTonTransfer) uyguladigi AYNI normalizasyon:
            // ekranda gorulen ile imzalanan ayni dize olmali.
            const yorum = typeof eylem?.comment === 'string' ? eylem.comment.trim() : ''
            const beklenenHash = yorum ? yorumHucresi(yorum).hash().toString('hex') : null
            // `bodyHash` -- `commentHash` DEGIL. Ikisi yorumlu govdede AYNIDIR, ama
            // TANINMAYAN bir govdede ayrisir: commentHash null kalir (yani "yorum
            // yok" gibi gorunur), bodyHash ise DOLUDUR. Burada bodyHash'e bakmak
            // duz TON eyleminin govdesini de KAPATIR.
            if (mesaj.bodyHash !== beklenenHash) fail('TON_QUOTE_INTENT_MISMATCH')
        }

        // V12 - TURDEN BAGIMSIZ: olculen sendMode hem duz TON hem jetton govdesinde
        // 3. Tutar kontrolunun ANLAMLI olmasi icin mod da olculen mod olmali;
        // 128'de hedef ve value niyetle birebir aynidir ama giden para cuzdandaki
        // HER SEYDIR.
        if (mesaj.sendMode !== EXPECTED_SEND_MODE) fail('TON_QUOTE_INTENT_MISMATCH')
    }

    // V6 feeAuth.tonPublicKey bizim cuzdanimizin anahtari. Baska bir anahtar,
    // baska bir cuzdanin eylemini bizim ATS'imizle odetmeye calisiyor demektir.
    if (!hexEsit(feeAuth.tonPublicKey, intent?.tonPublicKey)) fail('TON_QUOTE_PUBKEY_MISMATCH')

    // V7 feeAuth.tonWallet bizim W5 adresimiz.
    if (!adresEsit(feeAuth.tonWallet, intent?.tonWallet)) fail('TON_QUOTE_WALLET_MISMATCH')

    // V8 quoteId'nin muhurlu govdesi ust seviyeyle TUTARLI. Muhur payloadBoc'un
    // KENDISINI tasidigi icin karsilastirma skaler degil, GOVDENIN TAMAMI
    // uzerinden yapilir: sunucu govdeyi bastan kurup hash'leri yeniden
    // hesaplasa ve bize uygun bir niyet gosterse bile (V1..V7 gecer), relay'e
    // gidecek olan muhurlu govde ayrisir ve burada yakalanir.
    const muhur = muhruCoz(quote?.quoteId)
    if (muhur?.payloadBoc !== quote?.payloadBoc) fail('TON_QUOTE_SEALED_MISMATCH')
    if (!hexEsit(muhur.actionHash, feeAuth.actionHash)) fail('TON_QUOTE_SEALED_MISMATCH')
    if (!adresEsit(muhur.tonWallet, feeAuth.tonWallet)) fail('TON_QUOTE_SEALED_MISMATCH')
    if (!hexEsit(muhur.tonPublicKey, feeAuth.tonPublicKey)) fail('TON_QUOTE_SEALED_MISMATCH')
    if (tamSayi(muhur.seqno, 'TON_QUOTE_SEALED_MISMATCH')
        !== tamSayi(feeAuth.seqno, 'TON_QUOTE_SEALED_MISMATCH')) fail('TON_QUOTE_SEALED_MISMATCH')
    if (tamSayi(muhur.deadline, 'TON_QUOTE_SEALED_MISMATCH')
        !== tamSayi(feeAuth.deadline, 'TON_QUOTE_SEALED_MISMATCH')) fail('TON_QUOTE_SEALED_MISMATCH')
    if (tamSayi(muhur.atsFee, 'TON_QUOTE_SEALED_MISMATCH')
        !== tamSayi(quote?.atsFee, 'TON_QUOTE_SEALED_MISMATCH')) fail('TON_QUOTE_SEALED_MISMATCH')
    if (tamSayi(muhur.attachNanoton, 'TON_QUOTE_SEALED_MISMATCH')
        !== tamSayi(quote?.attachNanoton, 'TON_QUOTE_SEALED_MISMATCH')) fail('TON_QUOTE_SEALED_MISMATCH')

    // V9 sign.domain istemcinin KENDI kurdugu domain olmali. Karsilastirma
    // tonFeeConfig'e delege edilir: domain iki yerde tanimlanirsa biri
    // guncellenip digeri unutulur.
    try {
        assertTonFeeDomain(quote?.sign?.domain)
    } catch {
        // Cagiran taraf her hatada `code` bekliyor; duz Error'u sarmaladan
        // birakmak ekrandaki hata eslemesini sessizce atlatirdi.
        fail('TON_FEE_DOMAIN_MISMATCH')
    }

    // V10 imzalanan atsMaxFee, gosterilen atsFee ile AYNI ve kullanicinin
    // onayladigi tutari ASMAZ. Kullanici bir sayi gorup baska bir sayiyi
    // imzalayamaz.
    const atsMaxFee = tamSayi(feeAuth.atsMaxFee, 'TON_QUOTE_FEE_MISMATCH')
    if (atsMaxFee !== tamSayi(quote?.atsFee, 'TON_QUOTE_FEE_MISMATCH')) fail('TON_QUOTE_FEE_MISMATCH')
    if (atsMaxFee > tamSayi(intent?.approvedAtsFee, 'TON_QUOTE_FEE_ABOVE_APPROVED')) {
        fail('TON_QUOTE_FEE_ABOVE_APPROVED')
    }

    // V11 teklifin suresi HEM gecmemis HEM de asiri uzun degil. Suresi gecmis
    // bir govdeyi imzalamak bosuna imzadir (relay reddeder); suresi cok uzun
    // bir govdeyi imzalamak ise kullanicinin ATS'sini cok ileri bir tarihe
    // kadar baglayan bir odeme yetkisi vermektir. Ust sinir MAX_AUTH_WINDOW_SEC
    // (sunucu TTL'i + saat kaymasi payi) uzerinden olculur.
    const now = tamSayi(intent?.now, 'TON_QUOTE_EXPIRED')
    const deadline = tamSayi(feeAuth.deadline, 'TON_QUOTE_EXPIRED')
    if (now > deadline) fail('TON_QUOTE_EXPIRED')
    if (deadline - now > BigInt(MAX_AUTH_WINDOW_SEC)) fail('TON_QUOTE_WINDOW_TOO_LONG')
}
