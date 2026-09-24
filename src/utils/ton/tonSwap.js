// TON takasi: YEDI KAPI, sonra imza. BU PLANIN PARA-KRITIK DOSYASI.
//
// Mesaji SDK kurar, biz DEGIL. Gerekcesi olculdu ve belgelendi
// (docs/superpowers/notes/2026-08-26-stonfi-dogrulama.md):
//   - `TON -> jetton` yonu ROUTER SURUMUNE gore bambaska bir mekanizma
//     kullaniyor (v1'de TEP-74 transferi, v2.2'de pTON'a giden ayri bir opcode).
//     Elle kurmak iki surum icin iki ayri mekanizmayi dogru uygulamak demekti.
//   - Router SABIT DEGIL: her takasta teklif yanitindan geliyor ve v1/v2 FARKLI
//     alan duzeni kullaniyor.
//
// GAZ SABITLERI SDK'DAN OKUNUR, KOPYALANMAZ. Gorev 4 karari: SDK'nin degerleri
// olculen gercek dagilimin (45 trace, medyan forward 0.247 TON) tam icinde ve
// SURUME GORE degisiyor - tek bir kendi sabitimiz iki surum icin birden dogru
// olamazdi. Catallamak, SDK guncellendiginde sessiz ayrisma uretirdi.
import { internal } from '@ton/ton'
import { Address, SendMode } from '@ton/core'
import { getJettonWalletAddress } from './jettonAddress'
import { getJettonBalance } from './jettonBalance'
import { decimalToRawUnits } from './jettonTransfer'
import { hasPendingTonTx } from './tonPending'
import { isQuoteFresh } from './tonSwapQuote'

// Kod tabaninin native varlik isaretcisi (utils/nativeToken.js). Sunucu teklif
// ucu de bunu tanir ve pTON adresine cevirir.
export const NATIVE_SWAP_SENTINEL = '0x0'

// jettonTransfer.js / jettonBalance.js / jettonList.js ile AYNI sinir, AYNI
// yerel-sabit deseni (bkz. Ku1). Bu depoda ondalik yuzunden iki ayri kusur cikti.
const MAX_DECIMALS = 30

/**
 * FIYAT ETKISI ESIGI (oran, 0.05 = %5).
 *
 * Sig bir havuzda buyuk emir, kullanicinin verdiginin cok altinda bir cikti
 * uretir - ve `minAskUnits` bunu ENGELLEMEZ, cunku o teklifteki (zaten dusmus)
 * fiyata gore hesaplanir. Yani kayma korumasi FIYAT ETKISINE KARSI KORUMAZ;
 * ayri bir kapi gerekir.
 *
 * %5 ihtiyatli bir esik: olculen 45 gercek takasin fiyat etkisi cok daha
 * dusuktu (ornek teklifte 0.0000003). Esigi asan islem YASAKLANMAZ, kullanicidan
 * ACIK ONAY ister - kendi parasi, ama ne yaptigini bilerek.
 */
export const MAX_PRICE_IMPACT = 0.05

const SEND_MODE = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS

const isNative = (address) => address === NATIVE_SWAP_SENTINEL

/**
 * Yone gore SDK gaz sabitini secer.
 *
 * Bilinmeyen yonde HATA ATAR, sessizce sifir/varsayilan KULLANMAZ: sifir gazla
 * gonderilen takas zincirde duser ve sebebi hicbir yerde gorunmez.
 */
export function swapGasFor(gasConstants, direction) {
    const key = {
        j2j: 'swapJettonToJetton',
        j2t: 'swapJettonToTon',
        t2j: 'swapTonToJetton',
    }[direction]
    const gas = key ? gasConstants?.[key] : null
    if (!gas) throw new Error('TON_SWAP_GAS_UNKNOWN')
    return gas
}

function assertDecimals(asset) {
    const d = asset?.decimals
    if (!Number.isInteger(d) || d < 0 || d > MAX_DECIMALS) throw new Error('JETTON_DECIMALS_MISSING')
    return d
}

/**
 * Takasi kurar ve YEDI KAPIDAN gecirir - GONDERMEZ.
 *
 * NEDEN AYRILDI (2026-09-15): ayni takas iki yoldan gidebiliyor artik - kendi
 * TON'uyla (self-pay) ya da role uzerinden (gazsiz). Ikisi de AYNI kapilardan
 * gecmek ZORUNDA: kapilarin kopyalanmasi, birinin duzelip digerinin
 * duzelmemesi demekti ve bu dosya "PLANIN PARA-KRITIK DOSYASI". Bu yuzden
 * kapilar burada TEK yerde kaldi; ayrilan sey yalnizca son adim.
 *
 * `routerFactory` / `dexFactory` DISARIDAN verilir: bu dosya kapilari uygular,
 * SDK'nin govde uretimini degil - o Gorev 3'te zincire karsi dogrulandi ve
 * testleri gercek SDK'yi cagirmak zorunda birakmak, birim testleri aga bagimli
 * yapardi.
 *
 * @param {boolean} [args.relayMode] role yolunda GAZ kullanicidan CIKMAZ
 *   (rolecinin tankindan) - KAPI 6 buna gore olcer.
 * @returns {Promise<{params: object, direction: string, offerUnits: bigint,
 *   offerJettonWallet: string|null, gasNano: bigint, router: any}>}
 */
export async function prepareTonSwap({
    client, quote, offerAsset, askAsset, amount,
    owner, chainId, storage, pendingTransactions, testnet = false,
    priceImpactAcknowledged = false, relayMode = false,
    routerFactory, dexFactory,
}) {
    // --- KAPI 1: teklif TAZE mi ---------------------------------------------
    // Bayat teklifle imzalamak, kullanicinin EKRANDA GORDUGU fiyatla zincire
    // GIDEN fiyatin ayrismasi demektir. Havuz fiyati saniyeler icinde kayar.
    if (!isQuoteFresh(quote)) throw new Error('TON_SWAP_QUOTE_STALE')

    // --- KAPI 4 (once, cunku ucuz): ondalik ---------------------------------
    // Yanlis/eksik ondalik gonderilen miktari 1000 kat yanlis yapar (USDT-TON 6).
    const offerDecimals = assertDecimals(offerAsset)
    assertDecimals(askAsset)

    // --- KAPI 2: teklif BU cift ve BU miktar icin mi -------------------------
    // Kullanici teklifi aldiktan sonra token degistirirse (ya da bir yaris
    // sonucu eski teklif elde kalirsa), o teklifin `minAskUnits`i BASKA BIR
    // CIFT icin hesaplanmistir. Onunla imzalamak, kullanicinin GORMEDIGI bir
    // korumayla takas yapmaktir - ve miktar da eslesmeli: 1 USDT icin alinan
    // teklifle 100 USDT gondermek, korumayi 100 kat kucultmek demek.
    const offerUnits = decimalToRawUnits(amount ?? '0', offerDecimals)
    if (quote?.offerAddress !== offerAsset.address
        || quote?.askAddress !== askAsset.address
        || String(quote?.offerUnits) !== offerUnits.toString()) {
        throw new Error('TON_SWAP_QUOTE_MISMATCH')
    }

    // --- KAPI 3: fiyat etkisi -----------------------------------------------
    // `<=` BILEREK: sinir DEGERI degil, ASILMASI onay ister (tonSendAmountFits /
    // jettonSendFits ile ayni karar).
    const impact = Number(quote?.priceImpact ?? 0)
    if (Number.isFinite(impact) && impact > MAX_PRICE_IMPACT && !priceImpactAcknowledged) {
        throw new Error('TON_SWAP_PRICE_IMPACT_HIGH')
    }

    // --- Yon ve gaz ---------------------------------------------------------
    const offerNative = isNative(offerAsset.address)
    const askNative = isNative(askAsset.address)
    const direction = offerNative ? 't2j' : (askNative ? 'j2t' : 'j2j')

    const router = client.open(routerFactory({
        address: quote.router.address,
        majorVersion: quote.router.majorVersion,
        minorVersion: quote.router.minorVersion,
        routerType: quote.router.routerType,
    }))
    const gas = swapGasFor(router.gasConstants, direction)
    // t2j'de iliştirilen deger gaz DEGIL, gonderilen TON + gaz; SDK bunu kendisi
    // hesapliyor. Bakiye kapisi icin gereken pay ise forwardGasAmount.
    const gasNano = BigInt(gas.gasAmount ?? gas.forwardGasAmount)

    // --- KAPI 5: verilen varligin bakiyesi ----------------------------------
    let offerJettonWallet = null
    if (!offerNative) {
        offerJettonWallet = await getJettonWalletAddress({
            client, owner, master: offerAsset.address, chainId, storage,
        })
        const balanceRaw = await getJettonBalance({
            client, walletAddress: offerJettonWallet, decimals: offerDecimals,
        })
        const balanceUnits = decimalToRawUnits(String(balanceRaw), offerDecimals)
        if (offerUnits > balanceUnits) throw new Error('TON_SWAP_INSUFFICIENT_BALANCE')
    }

    // --- KAPI 6: gaz icin TON --------------------------------------------------
    // Jetton takasi jettonun KENDISINDEN gaz harcamaz ama TON harcar. Jettonu
    // bol olup TON'u bitmis kullanici COK YAYGIN ve AYRI bir mesaji hak ediyor -
    // tek bir "yetersiz bakiye" hangi bakiyenin eksik oldugunu gizler.
    // ROLE MODUNDA GAZ KULLANICIDAN CIKMAZ - rolecinin tankindan cikar ve
    // karsiligi BSC'de ATS olarak kesilir. Gaz payini yine de istemek, hic TON'u
    // olmayan kullaniciyi ekranda ATS ucret kartini GORURKEN "yetersiz bakiye"
    // ile durdururdu - ayni hata ConfirmTransaction ve TonSendTx'te de cikmisti.
    //
    // AMA `amountNano` HICBIR ZAMAN SPONSORLANMAZ (sozlesme ss00/ss04): TON
    // verilen yonde (t2j) takasa GIREN TON kullanicinin kendi bakiyesinden cikar
    // ve o pay role modunda da ISTENIR. "Role acik" ile "bedava" ayni sey degil.
    const tonNeeded = offerNative
        ? (relayMode ? offerUnits : gasNano + offerUnits)
        : (relayMode ? 0n : gasNano)
    // Sifir ihtiyacta zincire CIKILMAZ: jetton->* role yolunda kullanicinin TON
    // bakiyesi SORUYU HIC ETKILEMEZ, okumak bosuna bir RPC turu (ve bir arıza
    // noktasi) olurdu.
    if (tonNeeded > 0n) {
        const tonBalance = BigInt(await client.getBalance(Address.parse(owner)))
        if (tonBalance < tonNeeded) throw new Error('TON_SWAP_INSUFFICIENT_TON')
    }

    // --- KAPI 7: bekleyen TON islemi ----------------------------------------
    // TON'da tekrar koruma seqno ile: ayni seqno ile gonderilen ikinci islem
    // SESSIZCE duser ve kullanici tekrar gonderirse deger IKI KEZ gidebilir.
    if (hasPendingTonTx(pendingTransactions)) throw new Error('TON_TX_ALREADY_PENDING')

    // --- Yedi kapi de gecti: SDK mesaji kurar --------------------------------
    const common = {
        userWalletAddress: owner,
        offerAmount: offerUnits,
        // TEKLIFTEKI DEGER. Yeniden hesaplanmiyor - kayma korumasi budur.
        minAskAmount: BigInt(quote.minAskUnits),
        // KOMISYON YOKTUR. SDK varsayilan olarak ref_fee = 10 (%0.1) yaziyor
        // (stonfi-dogrulama.md §2); bu satir olmazsa kullanicidan HABERI OLMADAN
        // kesilir. Global Constraint: komisyon yok.
        referralValue: 0,
    }

    let params
    if (direction === 'j2j') {
        params = await router.getSwapJettonToJettonTxParams({
            ...common,
            offerJettonAddress: offerAsset.address,
            // Jetton cuzdan adresini SDK'ya VERIYORUZ: zaten biliyoruz (P2
            // kalici onbellegi) ve vermezsek SDK zincire ek sorgu atar - genel
            // toncenter ucu bu cagrilarda 429 donuyordu (Gorev 3 §7).
            offerJettonWalletAddress: offerJettonWallet,
            askJettonAddress: askAsset.address,
        })
    } else if (direction === 'j2t') {
        params = await router.getSwapJettonToTonTxParams({
            ...common,
            offerJettonAddress: offerAsset.address,
            offerJettonWalletAddress: offerJettonWallet,
            proxyTon: makePton(dexFactory, quote.router),
        })
    } else {
        params = await router.getSwapTonToJettonTxParams({
            ...common,
            proxyTon: makePton(dexFactory, quote.router),
            askJettonAddress: askAsset.address,
        })
    }

    return { params, direction, offerUnits, offerJettonWallet, gasNano, router: quote.router }
}

/**
 * Takasi kurar, kapilardan gecirir ve KENDI TON'UYLA gonderir (self-pay).
 *
 * Kapilarin tamami `prepareTonSwap`ta - burada KOPYA YOK. Role yolu ayni
 * fonksiyonu `relayMode: true` ile cagirir ve gonderim yerine eylem uretir
 * (tonSwapRelayAction.js).
 */
export async function sendTonSwap({ wallet, keyPair, ...args }) {
    const { params, direction, router } = await prepareTonSwap({ ...args, relayMode: false })

    const seqno = await wallet.getSeqno()
    await wallet.sendTransfer({
        seqno,
        secretKey: keyPair?.secretKey,
        sendMode: SEND_MODE,
        messages: [internal({
            to: params.to,
            value: params.value,
            body: params.body,
            // SDK'nin urettigi hedef router ya da pTON sozlesmesidir; ikisi de
            // KESIN dagitilmistir. bounce=true, basarisiz bir cagride iliştirilen
            // TON'un geri donmesini saglar (jetton gonderimindeki ayni karar).
            bounce: true,
        })],
    })

    return { seqno, router: router.address, direction }
}

// pTON SURUMU ROUTER SURUMUYLE ESLENMELI. dexFactory router surumunden dogru
// pTON sinifini veriyor; uyusmazsa mesaj YANLIS SOZLESMEYE gider. Adres de
// teklifle birlikte gelen `ptonMasterAddress` - koda yazilmiyor.
function makePton(dexFactory, routerInfo) {
    const contracts = dexFactory({
        majorVersion: routerInfo.majorVersion,
        minorVersion: routerInfo.minorVersion,
        routerType: routerInfo.routerType,
    })
    if (!routerInfo.ptonMasterAddress) throw new Error('TON_SWAP_QUOTE_FAILED')
    return new contracts.pTON(routerInfo.ptonMasterAddress)
}
