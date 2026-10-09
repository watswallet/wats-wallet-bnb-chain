import { hashTypedData, keccak256 } from 'viem'

import {
    CarryEntry,
    EIP7702_INITCODE_MARKER,
    GasParams,
    GaslessClient,
    XcFeeAuthTypedData,
    addressesFor,
    assembleUserOp,
    computeUserOpHash,
} from './gasless'

/**
 * Cüzdan ham özel anahtarı bu modüle VERMEZ. İki metotluk bir arayüz yeter; anahtar
 * cüzdanın kendi deposunda kalır.
 */
export interface Authorization {
    chainId: number
    address: string
    nonce: number
    yParity: number
    r: string
    s: string
}

export interface WalletSigner {
    address: string
    /** Ham digest imzası — EIP-191 sarması YOK (Simple7702Account ECDSA.recover ile doğrular). */
    signDigest(digest: `0x${string}`): Promise<`0x${string}`>
    signAuthorization(p: { chainId: number; delegate: string; nonce: number }): Promise<Authorization>
    /**
     * EIP-712 imzası — OPSİYONEL. Verilirse çapraz-zincir ücret yetkisi bununla imzalanır.
     * Verilmezse `signDigest(hashTypedData(...))` kullanılır: matematiksel olarak AYNI imza.
     */
    signTypedData?(typedData: XcFeeAuthTypedData): Promise<`0x${string}`>
}

export interface RunArgs {
    client: GaslessClient
    chainId: number
    signer: WalletSigner
    callData: `0x${string}`
    nonce: bigint
    gas: GasParams
    maxPriorityFeePerGas: bigint
    /** Hedef zincirde 7702 delegesi var mı (`/paymaster/status`'ün `delegated` alanı). */
    delegated: boolean
    /** Delege DEĞİLSE gerekli: authorization'ın nonce'u için hesabın işlem sayısı. */
    txCount?: number
    /**
     * EKLENTI FARKI: ZINCIR-KANITLI TAHSILAT MAKBUZU. Capraz-zincirde ucret imzadan ONCE
     * tahsil edilir; /relay duserse para gitmistir. Kilit omru (~120 sn) dolduktan sonraki
     * yeniden denemede ilk /sponsor yanitindaki settlementId + atsFee buradan geri gonderilir:
     * sunucu odemeyi zincirden dogrular ve IKINCI KEZ TAHSIL ETMEZ.
     * 2026-08-08'de bu katman olmadigi icin ayni op 6,9 ATS'ye iki kez odendi.
     */
    settlement?: { id: string; atsAmount: string }
    /**
     * EKLENTI FARKI: FIYAT KILIDININ YENIDEN KULLANIMI.
     *
     * Belge 09: "Ayni quoteId ile yapilan yeniden deneme ayni ucreti, dolayisiyla ayni
     * settlementId'yi uretir; settled[id] eslesir ve ikinci tahsilat olmaz."
     *
     * Yeniden denemede TAZE bir /quote almak bu garantiyi bozar: ATS kuru arada tiklerse
     * atsFee, dolayisiyla settlementId degisir, settled[id] eslesmez ve sunucu IKINCI KEZ
     * tahsil eder. Belgedeki 2026-08-08 olayi birebir budur (6,9 ATS, zincire hicbir sey
     * gitmeden). Verilmisse /quote ATLANIR ve bu kilit dogrudan /sponsor'a gecirilir.
     */
    quoteId?: string
    /**
     * EKLENTI FARKI (K12): onceki denemenin UCRET YETKISI IMZASI. `quoteId` ile BIRLIKTE verilir
     * ve /sponsor'a AYNEN gider — rehber "Yeniden deneme" B.1: birebir ayni govde. Kilitsiz bir
     * imza ya da makbuzla birlikte bir imza GONDERILMEZ (asagida).
     */
    feeAuthSignature?: `0x${string}`
    /**
     * EKLENTI FARKI (odeme devri): ayni nonce'taki BASKA islemlerin odenmis tahsilatlari.
     * /sponsor'a aynen gider; sunucu biri gecerliyse yeni tahsilat yapmadan imzalar. Makbuzla
     * (settlement) birlikte GONDERILMEZ: makbuz yolu degismez.
     */
    carry?: CarryEntry[]
    /** EKLENTI FARKI: onaylanan tutarla karsilastirma icin quote yanitini disari verir. */
    onQuoted?: (q: any) => void
    /**
     * EKLENTI FARKI (K12): feeAuth op'a ait cikinca, IMZADAN ONCE beklenir. Firlatirsa imza atilmaz
     * ve /sponsor'a gidilmez (tutar onayi, son gecerlilik). Ucret cekilmeden durulur.
     */
    onFeeAuth?: (feeAuth: XcFeeAuthTypedData, ctx: { quoteId?: string }) => void | Promise<void>
    /**
     * EKLENTI FARKI (K12): imza atildi, /sponsor'dan ONCE beklenir. Yeniden deneme imzayi ve
     * makbuz adayini buradan saklar — MV3 worker'i /sponsor yanitini beklerken olebilir.
     */
    onFeeAuthSigned?: (p: {
        feeAuth: XcFeeAuthTypedData
        signature: `0x${string}`
        quoteId?: string
    }) => void | Promise<void>
    /**
     * EKLENTI FARKI (K12): /sponsor istegi ucmadan HEMEN once beklenir (her denemede). Cagiran
     * imzali tahsilat isteginin baslangicini ve kaydini buradan yazar; firlatirsa istek GITMEZ.
     */
    onBeforeSponsor?: () => void | Promise<void>
    /** EKLENTI FARKI: settlementId/atsFee'yi yeniden deneme icin disari verir. */
    onSponsored?: (r: any) => void
}

/**
 * Backend'in imzalattığı ücret yetkisi GERÇEKTEN bu op için mi? Bozuk ya da ele geçirilmiş bir
 * backend kullanıcıya BAŞKA bir op'un ücretini imzalatamasın — bir alan tutmazsa İMZALAMA.
 * `atsAmount` burada denetlenmez: onu cüzdan onaylanan tutarla karşılaştırır (onFeeAuth).
 */
export function assertFeeAuthForOp(
    fa: XcFeeAuthTypedData,
    op: { sender: string; nonce: bigint; chainId: number; callData: `0x${string}` }
): void {
    const bad = (what: string): never => {
        const err = new Error(`feeAuth bu op'a ait değil: ${what} uyuşmuyor — imzalanmadı`)
        // EKLENTI FARKI: makine-okunur kod — cagiran bunu KALICI sayar ve ayni kilitle (imzasiz)
        // yeniden DENEMEZ.
        ;(err as any).code = 'xc-fee-auth-mismatch'
        throw err
    }
    // Sunucudan gelen `nonce`/`dstChainId` sayı DIZESI olmayabilir (bozuk/ele geçirilmiş backend) —
    // `BigInt(...)` bu durumda ham bir SyntaxError fırlatır. Aynı `bad(...)` yoluna düşürüyoruz ki
    // çağıran tek bir hata biçimiyle karşılaşsın.
    const toBigInt = (what: string, v: string): bigint => {
        try {
            return BigInt(v)
        } catch {
            return bad(what)
        }
    }
    if (fa?.primaryType !== 'XcFeeAuth') bad('primaryType')
    if (fa.domain?.name !== 'ATS Crosschain Gas') bad('domain.name')
    if (!fa.message) bad('message')
    if (String(fa.message.sender).toLowerCase() !== op.sender.toLowerCase()) bad('sender')
    if (toBigInt('nonce', fa.message.nonce) !== op.nonce) bad('nonce')
    if (toBigInt('dstChainId', fa.message.dstChainId) !== BigInt(op.chainId)) bad('dstChainId')
    if (String(fa.message.callDataHash).toLowerCase() !== keccak256(op.callData).toLowerCase()) bad('callDataHash')
}

/**
 * EN KRİTİK KURAL BURADA DAYATILIR: `paymasterAndData` userOp hash'ine girer, dolayısıyla
 * `/sponsor` imzadan ÖNCE çağrılmak ZORUNDADIR. Bunu belgeye yazıp umut etmek yerine tek
 * fonksiyona kapatıyoruz — cüzdan sırayı yanlış kuramaz.
 *
 * `quote` da burada: `sender` ile çağrılınca backend fiyat kilidini (`quoteId`) üretir ve
 * `sponsor`'a aktarılır. Kilit olmadan gösterilen ile tahsil edilen ayrışabilir; çapraz-zincirde
 * bunun iade yolu YOKTUR.
 */
export async function runSponsoredOp(
    a: RunArgs
): Promise<{ userOpHash: string; txHash: string; settlementId?: string; atsFee?: string }> {
    const addr = addressesFor(a.chainId)
    const initCode = (a.delegated ? '0x' : EIP7702_INITCODE_MARKER) as `0x${string}`

    let authorization: Authorization | undefined
    if (!a.delegated) {
        if (a.txCount === undefined) throw new Error('delege olmayan hesap için txCount gerekli')
        authorization = await a.signer.signAuthorization({
            chainId: a.chainId,
            delegate: addr.delegate,
            nonce: a.txCount,
        })
    }

    // Oncelik sirasi (EKLENTI FARKI):
    //   1. makbuz varsa   -> /quote ATLANIR. Makbuz zaten ODENMIS bir tutari temsil eder; yeni
    //      bir kilit almak hem gereksiz hem de kullanicinin (odeme sonrasi dusmus) bakiyesi
    //      uzerinden yeni bir fiyat okumaya calisirdi (belge 09).
    //   2. quoteId verilmisse -> /quote ATLANIR, ONCEKI denemenin kilidi yeniden kullanilir.
    //      Ayni kilit ayni ucreti, ayni ucret ayni settlementId'yi verir; sunucu settled[id]'yi
    //      zincirden dogrular ve IKINCI KEZ TAHSIL ETMEZ.
    //   3. hicbiri yoksa -> taze /quote (ilk deneme).
    let quoteId: string | undefined = a.settlement ? undefined : a.quoteId
    // Kilit ile imza AYNI denemeye aittir (EKLENTI FARKI, K12): kilitsiz bir imza baska bir
    // tahsilati yetkilendirir; makbuz yolunda sunucu imza istemez (odeme zaten zincirde).
    let feeAuthSignature: `0x${string}` | undefined = a.settlement || !quoteId ? undefined : a.feeAuthSignature
    if (!a.settlement && !quoteId) {
        // EKLENTI FARKI: /quote HER ZAMAN `callData` ILE cagrilir (belge "Swap ve Bridge
        // Komisyonu" §03/§04/§07).
        //
        // NEDEN KOSULSUZ: komisyon kapisi backend'de MOD SECIMINDEN ONCE calisir, yani
        // komisyonlu bir op'ta callData'siz uretilen kilit HER ZINCIRDE reddedilir
        // (commission-quote-required / commission-lock-missing) — spoke zincirler dahil.
        // "Bu op komisyonlu mu" sorusunu istemci YANITLAYAMAZ: turu backend kendi router
        // listesinden belirler (§01). Kosullu gondermek, listeye yeni bir router eklendigi
        // gun cuzdanin haberi olmadan her swap'i hataya dusururdu.
        //
        // KOMISYON KAPALIYKEN ZARARSIZ: 2026-08-17'de canli olculdu — callData'li ve
        // callData'siz /quote yanitlari (atsFee, quoteId govdesi dahil) BIREBIR ayni.
        // Ucret degismedigi icin capraz-zincirdeki "ayni quoteId -> ayni settlementId ->
        // ikinci tahsilat YOK" garantisi de bozulmaz.
        const q = await a.client.quote(a.gas, a.signer.address, a.callData, a.nonce)
        a.onQuoted?.(q)
        quoteId = q.quoteId

        // ÜCRET YETKİSİ (K12): çapraz-zincirde backend tahsilattan önce kullanıcının imzasını ister.
        // Önce yetkinin BU op'a ait olduğu denetlenir, sonra cüzdanın kendi kapıları (onFeeAuth),
        // sonra imza. Sıra normatif: hiçbiri tutmazsa imza atılmaz ve /sponsor'a gidilmez.
        if (q.feeAuth) {
            assertFeeAuthForOp(q.feeAuth, {
                sender: a.signer.address,
                nonce: a.nonce,
                chainId: a.chainId,
                callData: a.callData,
            })
            await a.onFeeAuth?.(q.feeAuth, { quoteId })
            feeAuthSignature = a.signer.signTypedData
                ? await a.signer.signTypedData(q.feeAuth)
                : await a.signer.signDigest(hashTypedData(q.feeAuth as any))
            // EKLENTI FARKI: bos ya da bicimsiz imza /sponsor'a GITMEZ. Asagidaki `feeAuthSignature ?`
            // kosulu onu sessizce dusururdu: istek IMZASIZ gider ve gecis modunda sunucu imzasiz
            // tahsil eder. Sunucunun kabul ettigi bicim: 65 bayt (130 hex) ya da EIP-2098 64 bayt.
            if (typeof feeAuthSignature !== 'string' || !/^0x([0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/.test(feeAuthSignature)) {
                const err = new Error("ücret yetkisi imzası geçersiz biçimde — /sponsor'a gönderilmedi")
                ;(err as any).code = 'xc-fee-auth-signature'
                throw err
            }
            await a.onFeeAuthSigned?.({ feeAuth: q.feeAuth, signature: feeAuthSignature, quoteId })
        }
    }

    await a.onBeforeSponsor?.()
    const res = await a.client.sponsor({
        sender: a.signer.address,
        nonce: a.nonce,
        initCode,
        callData: a.callData,
        gas: a.gas,
        maxPriorityFeePerGas: a.maxPriorityFeePerGas,
        ...(quoteId ? { quoteId } : {}),
        ...(a.settlement ? { settlement: a.settlement } : {}),
        ...(authorization ? { authorization } : {}),
        ...(feeAuthSignature ? { feeAuthSignature } : {}),
        ...(a.carry && a.carry.length && !a.settlement ? { carry: a.carry } : {}),
    })
    a.onSponsored?.(res)

    const packed = assembleUserOp({
        sender: a.signer.address,
        nonce: a.nonce,
        initCode,
        callData: a.callData,
        verificationGasLimit: a.gas.verificationGasLimit,
        callGasLimit: a.gas.callGasLimit,
        preVerificationGas: a.gas.preVerificationGas,
        maxPriorityFeePerGas: a.maxPriorityFeePerGas,
        maxFeePerGas: a.gas.maxFeePerGas,
        paymasterAndDataPrefix: res.paymasterAndDataPrefix,
        paymasterData: res.paymasterData,
        signature: '0x',
    })

    const userOpHash = computeUserOpHash(packed, {
        chainId: BigInt(a.chainId),
        entryPoint: addr.entryPoint as `0x${string}`,
        ...(a.delegated ? {} : { eip7702Delegate: addr.delegate as `0x${string}` }),
    })
    packed.signature = await a.signer.signDigest(userOpHash)

    // EKLENTI FARKI: relay cagrisinin KENDISI (ag hatasi) duserse userOpHash'i hataya ilistir.
    // txHash yoktur — istek zincire hic ulasmamis OLABILIR ama ulasmis da olabilir. Cagiran
    // nonce'un ilerleyip ilerlemedigine bakarak ayrimi yapar; ilerlediyse op zincirde
    // calismistir ve kullaniciya sorgulayabilecegi TEK tanitici bu hash'tir.
    let relay: any
    try {
        relay = await a.client.relay(packed, authorization)
    } catch (e) {
        ;(e as any).userOpHash = userOpHash
        throw e
    }
    if (!relay.success) {
        // EKLENTI FARKI: txHash'i hataya ilistir - cagiran "zincire gitti mi" ayrimini
        // buna gore yapar ve gitmisse AYNI NONCE ile yeniden DENEMEZ.
        const err = new Error(`relay başarısız (tx ${relay.txHash})`)
        ;(err as any).txHash = relay.txHash
        ;(err as any).userOpHash = userOpHash
        throw err
    }
    return { userOpHash, txHash: relay.txHash, settlementId: res.settlementId, atsFee: res.atsFee }
}
