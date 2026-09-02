// "Odendi ama gitmedi" kurtarmasi (tasarim belgesi bolum 6). Kullanici geri
// dondugunde, yarim kalmis her makbuz icin ne yapilacagina KARAR VEREN dosya.
//
// BU DOSYADAKI YANLIS BIR KARARIN BEDELI SESSIZDIR. TON ucreti BSC'de, TON mesaji
// gonderilmeden ONCE tahsil edilir ve IADE EDILMEZ. Bu yuzden buradaki tek bir hatali
// 'success', ucreti yanmis bir islemi ekranda basarili gosterir ve kullanici parasinin
// gittigini HIC ogrenmez. Planin geri kalani gurultuyle patlar; burasi patlamaz.
//
// ---------------------------------------------------------------------------
// 1) BU MODUL /quote IMPORT ETMEZ - test ile kilitli (tonFeeRecovery.test.js).
// ---------------------------------------------------------------------------
// Kurtarma YENI BIR TEKLIF ALMAZ. Alsaydi, ucreti ZATEN alinmis bir islem icin IKINCI
// bir tahsilat baslatirdi. Elimizde ne varsa (diskteki quoteId + iki imza) onunla
// calisilir; yoksa is unresolved'a birakilir.
//
// ---------------------------------------------------------------------------
// 2) seqno ILERLEMESI "BIZIM EYLEMIMIZ GITTI" DEMEK DEGILDIR.
// ---------------------------------------------------------------------------
// TON'da seqno cuzdanin HERHANGI bir gonderiminde artar: kullanici ayni cuzdandan
// self-pay ile, Tonkeeper'dan ya da baska bir cihazdan bir sey gondermis olabilir.
// seqno yalnizca bir TETIKLEYICIDIR; karar `actionHash`in zincirde dogrulanmasina
// baglidir (findActionOnChain). 'found' DISINDAKI her sonuc - 'missing', 'unknown',
// beklenmeyen bir deger, firlatan bir arama - 'unresolved'a duser. Bu modulde
// `'success'` yazan TEK dal, findActionOnChain'in 'found' dondugu daldir.
//
// ---------------------------------------------------------------------------
// 3) 'unresolved' TERMINALDIR.
// ---------------------------------------------------------------------------
// Bir kayit 'unresolved'a dustukten sonra bu modul ona BIR DAHA relay cagrisi yapmaz.
// Yapsaydi, her tetikleyicide (dakikada bir alarm + her HEARTBEAT) ayni kayit icin
// yeni bir tahsilat denemesi gonderilirdi. 'unresolved' kayit diskte, kullaniciya
// destek kaydi (settlementId) gosterilebilsin diye TTL'ine kadar durur;
// hasUnsettledTonFee onu KILIT saymaz, yani cuzdani tikamaz.
import { loadAllTonSettlements, updateTonSettlement, clearTonSettlement } from './tonFeeSettlement'
import { tonFeeRelay } from './tonFeeClient'
import { settlementDispositionFor } from './tonFeeBlocker'
import { withKeepAlive } from './swKeepAlive'
import { isTon } from '../chainKind'

// Yetim taramasinin yas siniri. Bundan kisa surede bir relay hala devam ediyor
// olabilir (agir ag, yavas tahsilat); erken "baslatilamadi" demek, aslinda ucreti
// alinmakta olan bir islemi "ucret alinmadi" diye isaretlerdi.
export const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000

// UCUS KORUMASI. Makbuz relay cagrisindan ONCE diske iner ('relay-inflight', bkz.
// gonderim yolunun 9. adimi) ki service worker tam o anda olurse kurtarilabilsin. Bedeli:
// kayit, ASIL istek HALA UCUSTAYKEN kurtarmanin gorus alanindadir.
//
// CANLI OLCUM 2026-09-01: relay 200 dondu, ama arayuz "DOGRULANAMADI" gosterdi.
// Network izi:  relay(200) -> rpc(seqno) -> relay(400) -> relay(400), son ikisi
// KURTARMANIN kopyalari ve ikisi de `ton-fee-already-settled`. Kayit 'collected' ->
// 'unresolved' yoluna dustu: ucret GERCEKTEN alinmisken kullaniciya islem
// basarisizmis gibi gorundu. Tetikleyici bol: alarm dakikada bir, HEARTBEAT ise
// popup acikken saniyeler icinde (background.js).
//
// 60 sn: bundan uzun suren bir relay istegi pratikte olmustur (cagrinin
// AbortController'i yok), bundan kisasi ise saglikli bir cagriyla yarisir. Esik
// GECMEDEN kayda DOKUNULMAZ - sayac bile harcanmaz.
//
// Fazla beklemenin bedeli sinirlidir: SW gercekten olduyse kayit yalnizca bu kadar
// gec kurtarilir; teklif penceresi arada kapanirsa `resolveExpired` yine TEK bir
// sorguyla sonucu ogrenir.
export const RELAY_INFLIGHT_MIN_AGE_MS = 60 * 1000

// Bekleyen sayilan islem durumlari - background.js:updateTxStatus'un yazdigi adlar.
const PENDING_TX_STATUSES = new Set(['queued', 'processing'])

/**
 * Islem kaydinin (`current_transactions`) meta bayragi: "bu islem TON ucret RELAY
 * yolundan gitti".
 *
 * YETIM TARAMASI YALNIZ BU BAYRAGI TASIYAN ISLEMLERI GORUR ve bu bir daraltma
 * DEGIL, bir zorunluluktur: self-pay TON gonderimleri de makbuzsuzdur ve
 * `sendTonInternal` onlari `waitForSeqno` dogrulayamadiginda BILEREK 'processing'te
 * birakir ("`false` BASARISIZ DEGIL... 'error' yazmak kullaniciyi tekrar gondermeye
 * iter ve deger IKI KEZ gidebilir"). Bayrak olmadan yetim taramasi o kayitlari
 * "islem baslatilamadi, ucret alinmadi" diye isaretlerdi: self-pay'de dogru olmayan
 * bir cumle ve tam olarak o cift-gonderim riskinin geri acilmasi.
 *
 * Relay yolunu `background.js`'e baglayan gorev bu bayragi `updateTxStatus`
 * cagrisinin meta'sina YAZMAK ZORUNDADIR; yazmazsa yetim taramasi HICBIR SEY
 * bulmaz (guvenli yon: yanlis "ucret alinmadi" demektense hic konusmamak).
 */
export const TON_RELAY_TX_FLAG = 'tonFeeRelay'

/**
 * Islem kaydinin (`current_transactions`) meta alani `tonFeeState`. Kurtarmanin
 * vardigi sonucu KULLANICIYA gosteren tek kanal budur: TransactionStatus.vue bu
 * alani okuyup karti boyuyor ve kart tonuna `tx.status`tan ONCE bu alana bakiyor -
 * yani kayit makbuz deposunda kapandigi halde islem 'processing' kalsa bile kart
 * sonsuza kadar "isleniyor" gorunmuyor.
 *
 * Adlar BURADA, TEK yerde yasar; arayuz tarafi da ayni degerleri bekliyor. Elle
 * kopyalanan ikinci bir liste, biri degistiginde sessizce eskir ve kullanici
 * ucreti alinmis bir islem hakkinda HICBIR SEY gormez.
 */
export const TON_FEE_TX_STATES = {
    // Ucret ALINMADI, islem hic baslamadi. Guvenle tekrar denenebilir.
    notCharged: 'not-charged',
    // Ucret ALINDI, islemin sonucu dogrulanamadi. "Basarisiz" DEGIL.
    unresolved: 'unresolved',
    // Kurtarma bu kayit uzerinde HALA calisiyor; karar bu turda verilemedi.
    recovering: 'recovering',
}

/**
 * Kullaniciya islem kartinda gosterilen metinler. background.js'in TON kolu da ham
 * Turkce dizeleri `meta.error`a yaziyor (TON_SEND_ERROR_MESSAGES) - ayni sozlesme.
 */
export const RECOVERY_TX_MESSAGES = {
    // Relay'e HIC cikilmamis: makbuz relay'den ONCE diske yazilir (yonetmenin 9.
    // adimi, orada test ile kilitli), yani makbuzsuz bir islem tahsilata hic
    // ulasmamistir. Tekrar denemek GUVENLIDIR.
    notStarted: 'islem baslatilamadi, ucret alinmadi',
    // Sunucu "tahsilat yapilmadi" dedi (ton-collect-failed ve kardesleri).
    notSent: 'islem gonderilemedi, ucret alinmadi',
    // seqno ilerledi ama zincirde BIZIM eylemimiz bulunamadi.
    notVerified: 'islem dogrulanamadi',
}

// Ayni anda BIRDEN FAZLA tetikleyici var: dakikalik alarm, HEARTBEAT, onStartup,
// onInstalled. Ust uste binen iki tur AYNI kaydi gorup IKI relay cagrisi yapardi -
// tekrar denemeyi bir kereye indiren `attempts` sayaci da bu yarista ise yaramaz,
// cunku ikinci tur sayaci HENUZ artmamisken okur. Es zamanli cagrilar ayni turu
// paylasir.
let inFlight = null

/**
 * Yarim kalmis TON ucret makbuzlarini cozer. HICBIR ZAMAN firlatmaz cagirana kadar
 * ulasan bir hata birakmaz; tek bir kaydin hatasi digerlerini engellemez.
 *
 * @param {object} deps
 * @param {(tonWallet: string) => Promise<number>} deps.getSeqnoFor  zincirden TAZE
 *   seqno. Firlatirsa/eksikse adim 2-4 CALISMAZ: seqno'yu bilmeden saklanmis govdeyi
 *   tekrar oynatmak korlemesine olurdu.
 * @param {(tonWallet: string, actionHash: string) => Promise<'found'|'missing'|'unknown'>} deps.findActionOnChain
 *   Gercek zincir aramasi bu gorevin disinda (Task 9 sonrasi); 'unknown' guvenli tarafa duser.
 * @param {(txId: string, status: string, meta?: object) => Promise<void>} deps.updateTxStatus
 * @param {() => Promise<Array>} deps.listTransactions  `current_transactions` listesi (yetim taramasi)
 * @param {number} [deps.now]  ms; testler icin enjekte edilir
 * @returns {Promise<void>}
 */
export function recoverTonSettlements(deps = {}) {
    if (inFlight) return inFlight
    inFlight = runRecovery(deps).finally(() => { inFlight = null })
    return inFlight
}

async function runRecovery({ getSeqnoFor, findActionOnChain, updateTxStatus, listTransactions, now = Date.now() } = {}) {
    let settlements
    try {
        settlements = await loadAllTonSettlements()
    } catch (e) {
        console.error('[ton] makbuz deposu okunamadi:', e)
        return
    }

    // Islem listesi TUR BASINA BIR KEZ okunur ve iki yerde kullanilir: yetim taramasi
    // ve 'recovering' yazmasinin kapisi. Iki ayri okuma, ayni tur icinde birbiriyle
    // celisen iki goruntu uretebilirdi.
    const txs = await readTransactions(listTransactions)

    // 0. YETIM TARAMA - makbuz kumesinin BU turdaki hali uzerinde, kayit isleme
    // dongusunden ONCE. Sonra calissaydi, bu turda silinen bir kaydin islemi ayni
    // turda "yetim" gorunurdu.
    await scanOrphanTxs({ settlements, txs, updateTxStatus, now })

    // Islem kartlarinin BU turdaki durumlari. Iki ayri kapi bunu okuyor ve ikisinin
    // esigi FARKLI (bkz. markRecovering ve setTxOutcome) - bu yuzden bir Set degil,
    // durumun kendisi tasinir. Liste okunamadiysa harita BOSTUR: o zaman 'recovering'
    // hic yazilmaz (bilmedigimiz bir karti 'processing'e cekmeyiz) ama olumsuz
    // sonuclar yazilir (kartin sessiz kalmasi, yanlis bilgiden daha kotu).
    const txStates = new Map(
        txs.filter((t) => t && t.id).map((t) => [t.id, t.status])
    )

    for (const [key, rec] of Object.entries(settlements)) {
        try {
            await recoverOne({ key, rec, getSeqnoFor, findActionOnChain, updateTxStatus, txStates, now })
        } catch (e) {
            // Bir kaydin cozulememesi digerlerini bloklamaz: her makbuz ayri bir para.
            console.error('[ton] makbuz kurtarma basarisiz:', key, e && e.message)
        }
    }
}

async function readTransactions(listTransactions) {
    if (typeof listTransactions !== 'function') return []
    try {
        const txs = await listTransactions()
        return Array.isArray(txs) ? txs : []
    } catch (e) {
        console.error('[ton] islem listesi okunamadi:', e)
        return []
    }
}

// --- 0. yetim tarama -------------------------------------------------------

async function scanOrphanTxs({ settlements, txs, updateTxStatus, now }) {
    if (typeof updateTxStatus !== 'function') return

    // Makbuzu OLAN islemler: fazi ne olursa olsun (unresolved dahil) yetim DEGILDIR -
    // kayit varsa relay'e cikilmistir ve "ucret alinmadi" demek yalan olurdu.
    const withReceipt = new Set(
        Object.values(settlements || {}).map((r) => r && r.txId).filter(Boolean)
    )

    for (const tx of txs) {
        if (!tx || !PENDING_TX_STATUSES.has(tx.status)) continue
        // chainId meta'da yasiyor (bkz. tonPending.js dosya basi notu); ust seviye YEDEK.
        if (!isTon(tx.meta?.chainId ?? tx.chainId)) continue
        if (tx.meta?.[TON_RELAY_TX_FLAG] !== true) continue
        // timestamp yoksa yasini bilemeyiz - dokunmayiz.
        if (typeof tx.timestamp !== 'number') continue
        if (now - tx.timestamp <= ORPHAN_MIN_AGE_MS) continue
        if (withReceipt.has(tx.id)) continue

        // Ucret ALINMADI: relay'e hic cikilmamis. Kart bunu SOYLEMELI - "islem
        // baslatilamadi" ile "ucreti alindi ama sonucu bilinmiyor" kullanici icin
        // tamamen farkli iki durum, ve ilkinde tekrar denemek GUVENLI.
        await setTxStatus(updateTxStatus, tx.id, 'error', {
            error: RECOVERY_TX_MESSAGES.notStarted,
            tonFeeState: TON_FEE_TX_STATES.notCharged,
        })
    }
}

// --- kayit basina karar ----------------------------------------------------

async function recoverOne({ key, rec, getSeqnoFor, findActionOnChain, updateTxStatus, txStates, now }) {
    if (!rec || typeof rec !== 'object') return
    // Yalniz CANLI fazlar islenir. 'unresolved' terminaldir (dosya basi 3).
    if (rec.phase !== 'relay-inflight' && rec.phase !== 'collected') return

    // UCUSTAKI ISTEGI RAHAT BIRAK (bkz. RELAY_INFLIGHT_MIN_AGE_MS). Deadline
    // kontrolunden ONCE: teklif penceresi ucus SIRASINDA kapanmis olabilir ve o
    // durumda da kopya bir sorgu gondermemeliyiz.
    //
    // YALNIZ 'relay-inflight': 'collected' fazinda ucretin alindigi zaten
    // kanitlanmistir ve o dal relay'e HIC cikmaz (markUnresolved) - orayi da
    // beklemeye almak, taze bir 'collected' kaydinda kullaniciyi geri bildirimsiz
    // birakirdi.
    //
    // DAMGASIZ kayit KORUNMAZ: `savedAt` bu surumden onceki kayitlarda yok ve
    // onlar tanim geregi ucusta olamaz. Onlari da beklemeye almak, sonucu HIC
    // ogrenilemeyen bir makbuz birakirdi - korumanin onlemeye calistigi seyden
    // daha kotu.
    if (rec.phase === 'relay-inflight') {
        const savedAt = Number(rec.savedAt)
        // `<=`: yetim taramasinin AYNI sinir kurali (`now - tx.timestamp <=
        // ORPHAN_MIN_AGE_MS`). Sinir degeri keyfidir; iki esigin AYNI yonde
        // olmasi, birini okuyup digerini yanlis hatirlamayi onler.
        if (Number.isFinite(savedAt) && now - savedAt <= RELAY_INFLIGHT_MIN_AGE_MS) return
    }

    // 1. deadline gecmis mi? deadline unix SANIYE (feeAuth'tan geldigi gibi);
    // `now` ms. Okunamayan bir deadline GECMIS sayilir: penceresini bilmedigimiz bir
    // govdeyi tekrar oynatmaktansa kaydi cozmeye calismak guvenli yondur.
    const deadline = Number(rec.deadline)
    const expired = !Number.isFinite(deadline) || Math.floor(now / 1000) > deadline
    if (expired) return await resolveExpired({ key, rec, updateTxStatus, txStates })

    // seqno'yu okuyamiyorsak adim 2'nin cift kosulu KURULAMAZ. O halde adim 3/4'e de
    // gecilmez: saklanan payloadBoc belirli bir seqno'ya kilitlidir ve seqno'nun
    // ilerleyip ilerlemedigini bilmeden tekrar oynatmak korlemesine olur.
    if (typeof getSeqnoFor !== 'function') return await markRecovering(rec, updateTxStatus, txStates)
    let seqnoNow
    try {
        seqnoNow = Number(await getSeqnoFor(rec.tonWallet))
    } catch (e) {
        console.error('[ton] seqno okunamadi:', e && e.message)
        // Karar YOK ama is BITMEDI: kart "islem dogrulaniyor" desin. Hicbir sey
        // yazilmasaydi kullanici (orn. uzun bir RPC kesintisinde) ciplak bir
        // "isleniyor" carki gorurdu ve neden bekledigini bilemezdi.
        return await markRecovering(rec, updateTxStatus, txStates)
    }
    const recSeqno = Number(rec.seqno)

    // 2. seqno ILERLEDI -> ONAY GEREKLI (dosya basi 2)
    if (Number.isFinite(seqnoNow) && Number.isFinite(recSeqno) && seqnoNow > recSeqno) {
        return await confirmOnChain({ key, rec, findActionOnChain, updateTxStatus, txStates })
    }

    // 3. Bir kez denenmisse bir daha denenmez.
    if (Number(rec.attempts) >= 1) return await markUnresolved({ key, rec, updateTxStatus, txStates })

    // 4. Tekrar deneme.
    return await retryRelay({ key, rec, updateTxStatus, txStates })
}

// --- 1. deadline gecmis ----------------------------------------------------

async function resolveExpired({ key, rec, updateTxStatus, txStates }) {
    // Ucretin alindigi ZATEN biliniyor; deadline gectigine gore govde de artik
    // gecersiz. Sorulacak bir sey yok, sorulacak biri de yok.
    if (rec.phase === 'collected') return await markUnresolved({ key, rec, updateTxStatus, txStates })

    // "TEK sorgu" GERCEKTEN tek olmali (inceleme turu 1, bulgu 1). Bu dalin tek
    // cikisi markUnresolved ve o BILEREK dogrulanmiyor; updateTonSettlement de yazma
    // hatasini yutuyor. Kapisiz birakilirsa, depoya yazilamayan bir ortamda kayit
    // 'relay-inflight' + sureli kalir ve HER tetikleyici YENI bir sorgu gonderir -
    // dakikada bir alarm, ustune popup acikken ~5 sn'de bir HEARTBEAT. Sunucu
    // quoteId uzerinden tekilledigi icin ikinci tahsilat olmaz, ama kural kagit
    // uzerinde kalir ve her tik bir ag cagrisi harcar. Sayac adim 4'tekiyle AYNI
    // kapidan gecer.
    if (Number(rec.attempts) >= 1) return await markUnresolved({ key, rec, updateTxStatus, txStates })
    if (!await countAttemptDurably(key, rec)) {
        console.error('[ton] deneme sayaci diske yazilamadi, sureli sorgu atlandi:', key)
        return await markRecovering(rec, updateTxStatus, txStates)
    }

    // 'relay-inflight': ucretin alinip alinmadigini BILMIYORUZ. AYNI quoteId + AYNI
    // govdeyle TEK bir sorgu, bunu ogrenmenin tek yolu - yeni bir teklif almak (ve
    // ikinci kez odetmek) secenek degil.
    const outcome = await attemptRelay(rec)
    if (outcome.ok) {
        // 2xx: sunucu bir sey yapti ama BIZ islemin zincire indigini DOGRULAMADIK.
        // 'success' yazmak burada dosya basi 2'yi ihlal ederdi.
        return await markUnresolved({
            key, rec, updateTxStatus, txStates,
            patch: { settlementId: outcome.response?.settlementId },
        })
    }
    return await applyErrorDisposition({ key, rec, error: outcome.error, updateTxStatus, txStates })
}

// --- 2. zincirde dogrulama -------------------------------------------------

async function confirmOnChain({ key, rec, findActionOnChain, updateTxStatus, txStates }) {
    let verdict = 'unknown'
    try {
        if (typeof findActionOnChain === 'function') {
            verdict = await findActionOnChain(rec.tonWallet, rec.actionHash)
        }
    } catch (e) {
        // Arama YAPILAMADI - "bulunamadi" DEGIL. Ikisini karistirmak, RPC kesintisinde
        // basarili bir islemi "dogrulanamadi" diye isaretlemek olurdu.
        console.error('[ton] zincirde eylem aramasi basarisiz:', e && e.message)
        verdict = 'unknown'
    }

    if (verdict === 'found') {
        // BU MODULDEKI TEK 'success' YOLU.
        //
        // SIRA PAZARLIK DISI: once islem durumu, SONRA makbuzun silinmesi. Ters sirada
        // (ya da yazma hatasi yutularak) makbuz silinir, islem 'processing' kalir ve bir
        // sonraki turda yetim taramasi ona "ucret alinmadi" der - oysa ucret ALINDI ve
        // islem GITTI. Yazma basarisizsa kayit BIRAKILIR: fazlasini saklamak kendi
        // kendini iyilestirir, silmek geri donusu olmayan bir kayiptir.
        // `tonFeeState` YAZILMAZ: kayit siliniyor, gosterilecek bir ucret durumu
        // kalmiyor - kart sade bir basari kartidir.
        const written = await setTxStatus(updateTxStatus, rec.txId, 'success', {})
        if (!written) return
        return await clearTonSettlement(key)
    }

    if (verdict === 'missing') {
        // Baktik ve BULAMADIK: bu, dogrulanmis bir olumsuzluk. Ucret yine de ALINDI,
        // yani durum 'unresolved' - "ucret alinmadi" DEGIL.
        return await markUnresolved({
            key, rec, updateTxStatus, txStates,
            error: RECOVERY_TX_MESSAGES.notVerified,
        })
    }

    // 'unknown' ya da beklenmeyen bir deger: guvenli tarafa. Kart 'unresolved' der ama
    // MESAJ YAZILMAZ - "dogrulanamadi" demek icin once bakabilmis olmak gerekir; burada
    // bakilamadi.
    return await markUnresolved({ key, rec, updateTxStatus, txStates })
}

// --- 4. tekrar deneme ------------------------------------------------------

async function retryRelay({ key, rec, updateTxStatus, txStates }) {
    if (!await countAttemptDurably(key, rec)) {
        console.error('[ton] deneme sayaci diske yazilamadi, relay atlandi:', key)
        return await markRecovering(rec, updateTxStatus, txStates)
    }

    const outcome = await attemptRelay(rec)
    if (outcome.ok) {
        // 2xx: ucret alindi ve sunucu govdeyi kabul etti; ama zincire indigini
        // DOGRULAMADIK (dosya basi 2). Kayit da SILINMEZ - silinseydi islem hala
        // bekliyorken makbuzsuz kalir ve sonraki tur yetim taramasi ona "ucret
        // alinmadi" derdi.
        return await markUnresolved({
            key, rec, updateTxStatus, txStates,
            patch: { settlementId: outcome.response?.settlementId },
        })
    }

    const error = outcome.error
    const disposition = settlementDispositionFor({ httpStatus: error?.httpStatus, code: error?.code })

    if (disposition === 'keep-settled' && rec.phase === 'collected') {
        // Ucretin alindigi ZATEN biliniyordu; yeni olan `settlementId` OLABILIR.
        // Tasarim belgesi R3'un kapanmayan penceresi (tahsilat oldu, yanit donmeden SW
        // oldu) tam olarak boyle onarilir: sunucunun 'ton-fee-already-settled'
        // yanitindaki settlementId, kullanicinin elindeki TEK destek kaydidir. Burada
        // yakalanmazsa kalici olarak kaybolur.
        return await markUnresolved({
            key, rec, updateTxStatus, txStates,
            patch: { settlementId: error?.settlementId },
        })
    }

    if (disposition === 'keep-settled') {
        // 'relay-inflight': ucretin alindigi YENI KANITLANDI. Once kaniti diske gecir,
        // sonra tekrari BIR KEZ dene.
        //
        // IKINCI DENEME ILKININ BIREBIR AYNISIDIR - govdesinde `receipt` YOKTUR.
        // (Bu satirda eskiden "makbuzlu tekrar" yaziyordu; kod hicbir zaman oyle bir
        // istek gondermedi. tonFeeClient.tonFeeRelay govdeyi { quoteId, signature,
        // feeAuthSignature } olarak KURAR - fazladan verilen bir alan cagri sinirinda
        // sessizce DUSER, yani yorumla kod arasindaki fark hicbir yerde gorunmezdi.)
        //
        // Alani GONDERMIYORUZ, bu bilincli: /relay govdesinin `quoteId` disindaki alan
        // adlari HENUZ OLCULMEDI (tasarim bolum 10 R1) - sunucu tanimadigi bir alanda
        // istegin TAMAMINI reddediyor, yani UYDURULMUS bir ad, ucreti zaten alinmis bir
        // kaydin son tekrar hakkini da yakardi. Makbuzun bugunku isi DESTEK VE TESHIS:
        // odenmis ucretin diskteki kaniti (`settlementId` ile birlikte kullaniciya
        // gosterilen kayit). Gercek alan adi ilk basarili relay olcumunde ogrenildiginde
        // gonderim TEK yerde - tonFeeClient.tonFeeRelay'de - acilir.
        const upgraded = await patchDurably(
            key,
            definedOnly({
                phase: 'collected',
                settlementId: error?.settlementId ?? rec.settlementId,
                receipt: error?.receipt ?? rec.receipt,
            }),
            (r) => r?.phase === 'collected',
        )
        // Yukumluluk 2 (ikinci yari): yukseltme inmediyse TEKRAR DENENMEZ. Denenseydi
        // ve SW bu arada olseydi, kayit hala 'relay-inflight' + attempts=1 gorunur ve
        // makbuzun kaniti hicbir zaman diske inmezdi.
        if (!upgraded) {
            console.error('[ton] collected yukseltmesi diske yazilamadi, ikinci deneme atlandi:', key)
            return await markRecovering(rec, updateTxStatus, txStates)
        }
        const second = await attemptRelay(rec)
        // Ikinci denemeden sonra bu kaydin isi BITER: hangi yanit gelirse gelsin
        // ucret alinmistir ve sonucu dogrulayamadik.
        return await markUnresolved({
            key, rec, updateTxStatus, txStates,
            patch: { settlementId: (second.ok ? second.response?.settlementId : second.error?.settlementId) },
        })
    }

    if (disposition === 'clear') {
        // "Tahsilat YAPILMADI" diyen kodlar. AMA: kayit zaten 'collected' ise ucretin
        // alindigi KANITLANMISTIR - sonraki bir yanit ne derse desin o kanit silinmez.
        // Silinirse odenmis bir ucretin tek izi kalici olarak kaybolur.
        if (rec.phase === 'collected') return await markUnresolved({ key, rec, updateTxStatus, txStates })
        await clearTonSettlement(key)
        return await setTxOutcome(updateTxStatus, txStates, rec.txId, 'error', {
            error: RECOVERY_TX_MESSAGES.notSent,
            tonFeeState: TON_FEE_TX_STATES.notCharged,
        })
    }

    // 'keep' (kodsuz yanit, ag hatasi, quote-expired/consumed): kayda DOKUNULMAZ.
    // attempts artmis durumda, yani bir sonraki tur adim 3'te unresolved'a duser -
    // dongu KAPALI. Bu turda karar YOK, is de bitmedi: kart "dogrulaniyor" der.
    return await markRecovering(rec, updateTxStatus, txStates)
}

// --- ortak yardimcilar -----------------------------------------------------

// Relay'e cikmadan ONCE deneme sayacini artirir ve GERI OKUYARAK diske indigini
// dogrular. Task 6'dan tasinan YUKUMLULUK 2: updateTonSettlement yazma hatasini YUTAR
// (saveTonSettlement'in aksine boolean donmez). Sayac diske inmeden relay'e cikilirsa
// sonraki her tur ayni kaydi "hic denenmemis" gorur ve YENI bir istek gonderir -
// sinirsiz tekrar, her turu bir ag cagrisi ve prensipte bir para riski.
//
// RELAY'E CIKAN HER YOL BU KAPIDAN GECER (adim 1'in sureli sorgusu ve adim 4'un
// tekrari). Tek bir yol atlanirsa kapinin hicbir anlami kalmaz.
//
// @returns {Promise<boolean>} `false` ise relay'e HIC gidilmemeli.
async function countAttemptDurably(key, rec) {
    const attempts = (Number(rec.attempts) || 0) + 1
    return await patchDurably(key, { attempts }, (r) => Number(r?.attempts) >= attempts)
}

async function attemptRelay(rec) {
    try {
        // withKeepAlive: relay yanitini beklerken SW'in olme penceresini DARALTIR
        // (heuristik, garanti degil - bkz. swKeepAlive.js). Asil savunma zaten
        // diskteki makbuz.
        const response = await withKeepAlive(() => tonFeeRelay({
            quoteId: rec.quoteId,
            signature: rec.signature,
            feeAuthSignature: rec.feeAuthSignature,
        }))
        return { ok: true, response }
    } catch (error) {
        return { ok: false, error }
    }
}

async function applyErrorDisposition({ key, rec, error, updateTxStatus, txStates }) {
    const disposition = settlementDispositionFor({ httpStatus: error?.httpStatus, code: error?.code })

    if (disposition === 'clear' && rec.phase !== 'collected') {
        await clearTonSettlement(key)
        return await setTxOutcome(updateTxStatus, txStates, rec.txId, 'error', {
            error: RECOVERY_TX_MESSAGES.notSent,
            tonFeeState: TON_FEE_TX_STATES.notCharged,
        })
    }
    // 'keep-settled' ve 'keep': ucret alinmis OLABILIR ya da alindigi kanitlanmistir;
    // her iki durumda da kayit korunur ve unresolved'a dusurulur.
    return await markUnresolved({
        key, rec, updateTxStatus, txStates,
        patch: { settlementId: error?.settlementId },
    })
}

// KAYDI kapatir VE islem kartini da bilgilendirir. Ikisi TEK yerde birlikte yapilir:
// ayri birakilsalardi (eskiden oyleydi) kayit makbuz deposunda 'unresolved' olur ama
// islem kaydi 'processing'te asili kalirdi - kullanici ucreti alinmis, sonucu
// dogrulanamamis bir islem hakkinda HICBIR SEY gormezdi, sadece hic bitmeyen bir
// "isleniyor" karti.
//
// Kayit yazmasinin hatasi burada DOGRULANMAZ ve bu bilincli: dusserse kayit canli
// fazinda kalir ve BIR SONRAKI tur ayni karari yeniden verir (adim 3 sayesinde relay'e
// cikmadan). Tekrar denenmesi tehlikeli olan yazmalar - attempts sayaci ve 'collected'
// yukseltmesi - patchDurably ile geri okunarak dogrulanir.
//
// @param {object} args
// @param {object} [args.patch]  makbuz kaydina yazilacak ek alanlar (settlementId gibi)
// @param {string} [args.error]  islem kartinda gosterilecek mesaj
async function markUnresolved({ key, rec, updateTxStatus, txStates, patch, error } = {}) {
    const full = { phase: 'unresolved', ...definedOnly(patch || {}) }
    await updateTonSettlement(key, full)

    // `settlementId` DESTEK KAYDIDIR: TransactionStatus.vue onu metne gomuyor ve
    // Kopyala butonunu yalnizca VARKEN ciziyor. definedOnly sayesinde yoksa alan HIC
    // yazilmaz - aksi halde kullaniciya goremeyecegi bir referansi soylemis olurduk.
    return await setTxOutcome(updateTxStatus, txStates, rec?.txId, 'error', definedOnly({
        tonFeeState: TON_FEE_TX_STATES.unresolved,
        settlementId: full.settlementId ?? rec?.settlementId,
        error,
    }))
}

// Bu turda karar VERILEMEDI ama is de bitmedi (seqno okunamadi, yazma dusmedi, sunucu
// belirsiz yanit verdi). Kart 'processing'te KALIR - sadece kullaniciya neden
// bekledigi soylenir.
//
// YALNIZ hala bekleyen bir islem icin yazilir: bitmis bir karti (success/error) geri
// 'processing'e cekmek, kullanicinin gordugu sonucu geri almak olurdu.
async function markRecovering(rec, updateTxStatus, txStates) {
    if (!rec?.txId || !PENDING_TX_STATUSES.has(txStates?.get(rec.txId))) return
    return await setTxStatus(updateTxStatus, rec.txId, 'processing', {
        tonFeeState: TON_FEE_TX_STATES.recovering,
    })
}

// OLUMSUZ bir sonucu ('unresolved'/'not-charged') islem kartina yazan TEK kapi.
//
// KULLANICININ ZATEN BASARILI GORDUGU BIR KART GERI ALINMAZ. Bu erisilebilir bir yol:
// clearTonSettlement yazma hatasini YUTUYOR, yani 'found' dogrulamasindan sonra kart
// dogru sekilde 'success' yazilmis ama kayit diskte KALMIS olabilir. Kayit hala canli
// fazda oldugu icin sonraki tur onu isler ve deadline (saniyeler-dakikalar) coktan
// gecmis olacagi icin dogruca resolveExpired'a gider - kapisiz birakilirsa DOGRU bir
// basari karti kalici olarak "ucretiniz alindi, sonuc dogrulanamadi"ya cevrilir ve
// 'unresolved' TERMINAL oldugu icin bir daha DUZELMEZ. Para kaybi yok; kullaniciya
// basarili isleminin dogrulanamadigini soylemek var - bu modulun amacinin TERSI.
//
// Kapi YALNIZ 'success'i korur, "bekleyen olmayan her kart"i DEGIL: 'error' bir kart
// icin 'unresolved' bir IYILESTIRMEDIR (tasarim bolum 8: o durumda "basarisiz"
// denmemeli ve destek kaydi gosterilmeli). Genis bir kapi, relay'i cagiran taraf
// 'error' yazdiginda kullanicinin ucretinin alindigini HIC ogrenememesi demek olurdu.
//
// Yetim taramasi bu kapiyi kullanmaz: o zaten listedeki GERCEK duruma bakip yalniz
// 'queued'/'processing' kayitlari isliyor - daha dar bir kapi.
async function setTxOutcome(updateTxStatus, txStates, txId, status, meta) {
    if (txStates?.get(txId) === 'success') return true
    return await setTxStatus(updateTxStatus, txId, status, meta)
}

// @returns {Promise<boolean>} yazma BASARISIZ olduysa `false`. Yazacak BIR SEY yoksa
// (txId tasimayan kayit, enjekte edilmemis yazici) `true` doner: bu bir basarisizlik
// DEGILDIR, cunku yanlis etiketlenebilecek bir islem kaydi da yoktur. `false`
// dondurulseydi, txId'siz bir kayit zincirde DOGRULANMIS olsa bile hicbir zaman
// silinmez ve cozulmus bir makbuz cuzdani deadline'a kadar kilitlerdi.
async function setTxStatus(updateTxStatus, txId, status, meta) {
    if (typeof updateTxStatus !== 'function' || !txId) return true
    try {
        await updateTxStatus(txId, status, meta || {})
        return true
    } catch (e) {
        console.error('[ton] islem durumu yazilamadi:', txId, e && e.message)
        return false
    }
}

// IKI KATMANLI dogrulama; ikisi de gerekli:
//   1. `updateTonSettlement` ARTIK boolean doner (gorev 10, yukumluluk 3): depo yok,
//      kayit yok ya da `set()` firladi -> `false`. Ucuz ve dogrudan sinyal.
//   2. Geri okuma: yazma "indi" dedigi halde diskte BEKLENEN degerin olmamasi hala
//      mumkun (budama kaydi elemis ya da es zamanli bir tur uzerine yazmis olabilir).
//      `landed` tam da bunu olcer.
// Yalniz (1) olsaydi ustune yazilan bir kayit gorunmezdi; yalniz (2) olsaydi -
// onceki hali - dusen bir yazmadan sonra bile bir tur daha depo okunurdu. Kritik
// olan degismedi: HERHANGI biri "hayir" derse relay'e CIKILMAZ.
async function patchDurably(key, patch, landed) {
    try {
        if (!await updateTonSettlement(key, patch)) return false
        const after = await loadAllTonSettlements()
        return landed(after?.[key])
    } catch {
        return false
    }
}

// `undefined` alanlar patch'e KONMAZ: konsaydi, var olan bir settlementId'yi
// undefined ile ezip destek kaydini yok ederdi.
function definedOnly(obj) {
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined) out[k] = v
    }
    return out
}
