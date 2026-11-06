import { Interface, getAddress, ZeroAddress, formatUnits } from 'ethers'
import {
    createSilentSwapClient, parseUsdc, formatUsdc, getAssetOnChain, isAssetSymbol, NATIVE_TOKEN_SENTINEL,
    AmountOutOfRangeError, MaintenanceModeError, HttpError,
} from '@silentswap/sdk'
import { BSC_GATEWAY_ADDRESS } from '@silentswap/chains'
import { SILENTSWAP_INTEGRATOR_ID, PAYOUT_CHAIN_ID, MAX_TOTAL_FEE_BPS } from './silentswapConfig'
import { normalizeDeliveryToken, isUsdcDeliveryToken } from './deliveryTokens'
import { PRIVATE_BRIDGED_SOURCES } from './privateBridgedSources'
import { bridgedDepositoryFor } from './privateBridgedSources'
import { CANONICAL_AMOUNT_RE } from './privateConstants'
import { installProviderFetch } from './providerFetch'

// SilentSwap SDK'sinin YALNIZ okuma/teklif tarafi (spec 5.6, plan 2 "ayrilan
// noktalar" 1). placeOrder/ensureAllowance KULLANILMAZ: maxUint256 izin verir.
// SDK sekline dair tum varsayimlar bu dosyada toplanir (canli deneme yok).

const ERC20 = new Interface(['function approve(address spender, uint256 amount)'])

// Relay Depository'nin yatirma cagrilari (dogrulanmis kaynak, privateBridgedSources.js notu). Imzalar TAM yazilir:
// 3 argumanli depositErc20(depositor, token, id) asiri yuklemesi tutar yerine Depository'ye verilmis TUM izni ceker
// ve kabul EDILMEZ.
const DEPOSITORY = new Interface([
    'function depositErc20(address depositor, address token, uint256 amount, bytes32 id)',
    'function depositNative(address depositor, bytes32 id) payable',
])
const DEPOSIT_ERC20 = DEPOSITORY.getFunction('depositErc20')
const DEPOSIT_NATIVE = DEPOSITORY.getFunction('depositNative')

// Yatirma verisi olarak ASLA imzalanmayacak cagrilar (secici = ilk 4 bayt): token/NFT
// izinleri ve dogrudan transferler. Yatirma gateway ya da Relay Depository cagrisidir;
// bunlardan biri gorunuyorsa teklif sahte ya da bozuktur.
//
// SAVUNMA DERINLIGI, SINIR DEGIL: bu liste bilinen standart "hirsiz" cagrilarin kucuk bir
// alt kumesini keser. Gercek sinir, dogrudan rotada deposit.to === gateway, koprulu rotada
// deposit.to'nun koda sabit Relay Depository listesine karsi denetlenmesi ve calldata'nin
// cozulup istekle birebir esitlenmesidir (assertDepositoryCall, privateBridgedSources.js).
const DENIED_SELECTORS = new Set([
    '0x095ea7b3', // approve
    '0xa9059cbb', // transfer
    '0x23b872dd', // transferFrom
    '0x39509351', // increaseAllowance
    '0xa457c2d7', // decreaseAllowance
    '0xd505accf', // permit
    '0xa22cb465', // setApprovalForAll
    '0x87517c45', // Permit2 approve
    '0x2b67b570', // Permit2 permit
    '0x36c78516', // Permit2 transferFrom
    '0x42842e0e', // ERC-721 safeTransferFrom
    '0xb88d4fde', // ERC-721 safeTransferFrom (data)
    '0xf242432a', // ERC-1155 safeTransferFrom
    '0x2eb2c2d6', // ERC-1155 safeBatchTransferFrom
    '0xb753a98c', // DAI push
    '0xbb35783b', // DAI move
    '0xf2d5d56b', // DAI pull
    '0x4000aea0', // ERC-677 transferAndCall
])

// SDK 2.3.0 ticket'i `Hex` tipler ve refund(bytes32 ticket) olarak kodlar: 32 bayt hex.
const TICKET_RE = /^0x[0-9a-fA-F]{64}$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// SDK'nin yayimladigi kanonik BSC gateway'i (@silentswap/chains 2.3.0). Gateway degisirse
// SDK surumu yukseltilir (surum sabit): bu bilerek kabul edilmis bir tavizdir.
export const CANONICAL_GATEWAY = getAddress(BSC_GATEWAY_ADDRESS)

// Emekli gateway adresleri: YALNIZ IADE icin kabul edilir (yatirma pinleri hep CANONICAL_GATEWAY'e baglidir).
// Gateway degisince (V4: 2026-08-24) eski adreste acik kalan siparisin parasi yalnizca eski kontratin
// refund(ticket) cagrisiyla kurtulur. BUGUN BOS. Her SDK surum yukseltmesinde, yeni kanonik adres
// gelmeden ONCE eski adres buraya eklenir (spec 14 SDK yukseltme kontrol listesi).
export const RETIRED_GATEWAYS = Object.freeze([].map((a) => getAddress(a)))

let client = null
export function privacyClient() {
    if (!client) {
        // SDK fetch'i istek basina sinyal gecmeden cagirir (zaman asimi yok): istemci kurulmadan ONCE api.silentswap.com
        // isteklerine gercek bir AbortSignal.timeout eklenir (P14). Idempotenttir; yalniz bu ana makineye dokunur.
        installProviderFetch()
        client = createSilentSwapClient(SILENTSWAP_INTEGRATOR_ID ? { integratorId: SILENTSWAP_INTEGRATOR_ID } : {})
    }
    return client
}

// TESLIM VARLIGI (`dest`). Canli (2026-10-10, api.silentswap.com): operator dogrudan saglayici->EVM
// odemesini KAPATTI; dest'siz alici 400 `direct_evm_payout_disabled` alir. Bu yuzden USDC teslimi de
// dest blogu ile istenir (gecici cuzdan akisi). Teslim edilen tutar sabit degildir: teklif
// beklenen/en az tutar (dest.expectedDestAmount / minDestAmount) verir.
// Teslim tokeni (DeliveryToken, deliveryTokens.js) -> dest blogu (spec 4.1): teslim agi tokenin ICINDEDIR (dest.chainId =
// token.chainId). TEK kaynak: istek kurucu ve iki dogrulayici ayni blogu kullanir. Dondurulmus BSC tekilleri
// (NATIVE_BNB_DEST, USDC_BSC_DEST) ve destAssetOf kalkti: kimlik artik yapisal esitlikle denetlenir. Girdi DeliveryToken;
// chainId'siz ya da bozuksa PRIVATE_UNSUPPORTED (request.outputToken[.chainId]).
export function destFor(raw) {
    const t = normalizeDeliveryToken(raw)
    return Object.freeze({ kind: 'evm', chainId: t.chainId, assetId: t.address, assetSymbol: t.symbol, assetDecimals: t.decimals })
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// Her pin reddi kisa bir makine nedeni tasir (err.reason, ornek 'direct.to'). Mesaj BILEREK
// yalniz kod kalir: arayuze giden budur. Neden yalniz arka plan konsoluna yazilir; boylece
// ilk reddedilen canli teklif hangi pin'e takildigiyla izlenebilir.
const withReason = (code, reason) => { const e = new Error(code); e.reason = reason; return e }
const unsupported = (reason) => withReason('PRIVATE_UNSUPPORTED', reason)
const mismatch = (reason) => withReason('PRIVATE_QUOTE_MISMATCH', reason)

// Sunucu yanitindaki adres: 0x + 40 hex, getAddress ile normallestirilir. Bicim disi ya da
// (izin verilmedikce) sifir adres PRIVATE_UNSUPPORTED. Kucuk harfe indirilir: sunucunun
// checksum buyuk/kucuk harfi tek basina bir red sebebi degildir, karsilastirma kanoniktir.
function pinAddress(v, reason, { allowZero = false } = {}) {
    if (typeof v !== 'string' || !ADDRESS_RE.test(v)) throw unsupported(reason)
    const a = getAddress(v.toLowerCase())
    if (a === ZeroAddress && !allowZero) throw unsupported(reason)
    return a
}

// Relay Depository cagrisini cozer ve istekle BIREBIR esitler. Yeniden kodlama esitligi secicinin, argumanlarin ve
// uzunlugun tamamini kapsar: sondaki fazla bayt, baska bir asiri yukleme ya da kanonik olmayan kodlama reddedilir.
// depositor TAM istenen adres olmali (sozlesme sifir adresi msg.sender sayar ama sinir yalniz istenen adrestir; iade
// bu adrese gider). `id` sunucunun siparis kimligidir ve denetlenmez: parayi depositor ve tutar sinirlar.
function assertDepositoryCall(data, { native, depositor, token, amount }) {
    const fn = native ? DEPOSIT_NATIVE : DEPOSIT_ERC20
    let args
    try { args = DEPOSITORY.decodeFunctionData(fn, data) } catch { throw unsupported('deposit.call') }
    if (DEPOSITORY.encodeFunctionData(fn, args).toLowerCase() !== data) throw unsupported('deposit.call')
    if (getAddress(args.depositor) !== depositor) throw unsupported('deposit.call')
    if (!native && (getAddress(args.token) !== token || args.amount !== amount)) throw unsupported('deposit.call')
}

// Hata atmayan bicim denetimi: bicim disi adres hicbir adresle eslesmez.
function normalizedOrNull(v) {
    return typeof v === 'string' && ADDRESS_RE.test(v) ? getAddress(v.toLowerCase()) : null
}

// Istek tarafi adresleri SIKI: yanlis checksum da reddedilir. SDK inputAddress'i viem
// isAddress ile denetler ve gecersizse sessizce RASTGELE bir imzaci uydurur; boyle bir
// siparis kullanicinin kontrol etmedigi bir adrese baglanir.
function strictAddress(v, reason) {
    if (typeof v !== 'string' || !ADDRESS_RE.test(v)) throw unsupported(reason)
    let a
    try { a = getAddress(v) } catch { throw unsupported(reason) }
    if (a === ZeroAddress) throw unsupported(reason)
    return a
}

// Tutar alani ZORUNLUDUR: eksik/bos alan 0 sayilmaz (eski surum BigInt(undefined ?? 0) = 0n
// verip eksik tutarli teklifi "uyusmuyor" diye raporluyordu; bozuk yapi PRIVATE_UNSUPPORTED'dir).
// Yalniz opsiyonel alanlar (deposit.value) cagri yerinde `|| 0` ile varsayilan verir.
function nonNegativeBigInt(v, reason) {
    if (v === undefined || v === null || v === '') throw unsupported(reason)
    let n
    try { n = BigInt(v) } catch { throw unsupported(reason) }
    if (n < 0n) throw unsupported(reason)
    return n
}

// Tutar KANONIK bicimde olmali (ekranla AYNI kural, privateConstants.js): yuvarlanan bir tutar gosterilen
// tutardan farkli bir teklif kurdururdu (T25 U:M-8c).
function payoutUnits(payoutUsdc) {
    const text = String(payoutUsdc)
    if (!CANONICAL_AMOUNT_RE.test(text)) throw unsupported('request.payout')
    try { return parseUsdc(text) } catch { throw unsupported('request.payout') }
}

// Ust duzey `amount` (EXACT-INPUT) BILEREK konmaz (yalniz koprulu rotalarda calisiyor). Alicinin `amount`'u ISTENEN tutardir;
// ucretin istenenin ICINDEN mi USTUNE mi eklendigini SUNUCU belirler (assertQuoteMatches 'UCRET MODELI'): uretimde (integratorId
// ve/veya kayitli magaza Origin'i) ustune eklenir, yani istenen = alicinin alacagi (canli 2026-10-29: 15 istendi -> amount 15.15,
// payoutAmount 15); integratorsuz/Origin'siz istekte icinden duser (15 istendi -> amount 15, payoutAmount 14.85).
// Her cikti teslim varliginin dest blogunu tasir (destFor; dest'siz istek canlida 400). Teslim agi cikti ve dest'te AYNI
// olmak zorundadir (SDK kurali, types.ts: outputs[].chainId = dest.chainId; olcum istekleri boyle gonderildi): ikisi de
// outputToken.chainId'dir. PAYOUT_CHAIN_ID (56) gateway/odeme zinciridir ve teslim zinciriyle BIRLESTIRILMEZ.
// outputToken ZORUNLU: yoksa (eski outputAsset dizgesi dahil), chainId'siz ya da bozuksa PRIVATE_UNSUPPORTED /
// request.outputToken[.chainId]; sessizce BSC USDC'ye dusulmez (K4).
export function buildPrivateQuoteRequest({ sourceChainId, sourceAsset, inputAddress, outputAddress, payoutUsdc, outputToken }) {
    const address = strictAddress(outputAddress, 'request.output')
    const amount = payoutUnits(payoutUsdc)
    const dest = destFor(outputToken)
    const output = { address, chainId: dest.chainId, amount, dest }
    return {
        privacy: true,
        sourceChainId: Number(sourceChainId),
        sourceAsset,
        inputAddress: strictAddress(inputAddress, 'request.input'),
        outputs: [output],
    }
}

// IMZADAN ONCE calisan teklif dogrulamasi. Teklif sunucudan gelir; cuzdanin imzalayacagi
// islem bu istek beklentilerine SABITLENIR. Yatirma yurutucusu (Task 14) imzadan hemen once
// ayni kontrolu saklanan teklif uzerinde, imzalayan cuzdanin adresiyle YENIDEN calistirir.
//
// DOGRULANANLAR (hepsi kod duzeyinde, esitlik; tolerans yok, kararsiz kalan reddedilir)
//  - ticket 32 bayt hex; txKind evm; deposit zinciri istenen kaynak zinciri; quote.gateway
//    SDK'nin kanonik BSC gateway'i; deposit verisi gecerli hex, en az bir secici ve yasak
//    secicilerden (izin/transfer) degil.
//  - Dogrudan rota (bridge yok): kaynak zincir BSC ve varlik USDC; deposit.to === gateway;
//    quote.usdc kanonik BSC USDC'si; deposit.value 0; izin tokeni USDC, spender gateway,
//    tutar TAM quote.amount (depositPlanFromQuote bunu quote'tan kurar). Kartta gosterilen
//    odeme rakami da quote.amount'tur (sourceInput varsa BIREBIR ona esit, USDC ve BSC
//    olmak zorunda; yoksa kart quote.amount'u gosterir), yani cuzdandan cikacak USDC kartta
//    gorunen rakamdir. BSC USDC isteginde teklif bir
//    bridge nesnesi tasiyorsa PRIVATE_QUOTE_MISMATCH: yoksa sahte bridge dogrudan rota
//    sabitlerini kapatirdi.
//  - Koprulu rota (YALNIZ PRIVATE_BRIDGED_SOURCES acikken). Kapaliyken bridge nesnesi tasiyan her
//    teklif reddedilir: BSC + USDC isteginde once 'route.bridge-on-direct' ile PRIVATE_QUOTE_MISMATCH
//    (yukaridaki kural), diger her istekte 'bridged.closed' ile PRIVATE_UNSUPPORTED; ret ayni, makine
//    nedeni ve kod farkli. Acikken YALNIZ Relay Depository rotasi (privateBridgedSources.js): (zincir,
//    varlik) tabloda degilse 'bridged.route'; bridge.protocol 'relay'; deposit.to TAM o zincirin
//    Depository'si ('bridge.to'); calldata depositErc20(depositor, token, tutar, id) ya da
//    depositNative(depositor, id) olarak cozulur, yeniden kodlamayla birebir esit, depositor istenen
//    girdi adresi, token secilen varligin kayit adresi, tutar bridge.sourceAmount ('deposit.call').
//    Pinler: bridge.destinationChainId BSC, bridge.sourceChainId === deposit zinciri;
//    izin tokeni kullanicinin sectigi varligin kayit adresi (native kaynakta izin yok);
//    native kaynakta value === bridge.sourceAmount, ERC-20 kaynakta value 0; izin tutari
//    TAM bridge.sourceAmount. sourceInput ZORUNLU ve sourceInput.amount === bridge.sourceAmount,
//    varlik istenen varlik, zincir istenen kaynak zinciri: kartta "ode" olarak gorunen rakam
//    cuzdandan cikabilecek en cok tutardir.
//  - IKI ROTADA UCRET MODELI (canli olcum 2026-10-29, BSC USDC; model teklifin integratorFee'sinden okunur):
//      integratorFee > 0 (URETIM; ucret USTUNE eklenir): quote.payoutAmount === istenen (payout.request) VE
//        quote.amount === payoutAmount + serviceFee + integratorFee (fee.sum). 15 istendi -> amount 15.15, payout 15.
//        Cuzdandan cikan tutar (izin, yatirma, "Odeyecegin") quote.amount'tur.
//      integratorFee = 0 (ESKI; ucret icten duser): quote.amount === istenen (amount.request) VE
//        quote.amount - serviceFee === payoutAmount (fee.sum). 15 istendi -> amount 15, payout 14.85, serviceFee 0.15.
//    IKI MODELDE DE toplam ucret (serviceFee + integratorFee) istenenin MAX_TOTAL_FEE_BPS (%1) ustune cikamaz (fee.cap):
//    uretimde istenen = alicinin alacagi, eskide istenen = amount; yani cuzdandan cikan en cok istenen x 1.01.
//  - Tek alici = istenen adres (sifir adres degil), BSC'de; 0 < quote.payoutAmount <= quote.amount ve
//    alicinin payoutAmount'u quote.payoutAmount'a BIREBIR esit. dest ZORUNLU ve istekle ayni
//    (kind, chainId, assetId: secilen teslim tokeninin adresi); en az teslim > 0 ve
//    beklenen >= en az. Teslim tutarinin ust/alt siniri (kayma payi) denetlenmez: kart beklenen ve
//    en az tutari imzadan once gosterir.
//  - Teklifin inputAddress'i istenen kaynak adres. DIKKAT: SDK quote.inputAddress'i istege
//    yazdigimiz degerle EZER (sdk client.js:1018); teklif aninda bu denetim tek basina bir
//    sey kanitlamaz. Anlam kazandigi yer, yurutucunun bunu imzalayan cuzdanin adresiyle
//    yeniden calistirdigi andir (Task 14).
//
// DOGRULANMAYANLAR (bilinen artik risk)
//  - KOPRULU ROTADA RELAY'E GUVEN: Depository'ye yatirilan parayi Relay'in allocator imzasi serbest birakir;
//    kopru teslim etmezse iade depositor'a (istenen girdi adresi) gider. Imzalanan cagri gosterilen tutardan
//    fazlasini hareket ettiremez (depositErc20 yalniz msg.sender'dan `amount` ceker, izin tam tutardir;
//    depositNative yalniz value'yu alir), ama teslimat Relay'in ve SilentSwap'in isidir. Relay yonlendiricisi
//    ve onay aracisi (keyfi cagri listesi) KAPALIDIR: o rotalardaki (zincir, varlik) ikilileri tabloda yoktur.
//  - sourceInput.amount === bridge.sourceAmount esitligi canlida olculdu (2026-10-26: Arbitrum USDC,
//    Ethereum ETH/DAI, Polygon USDT, Mantle USDC; tutar, varlik, zincir ve ondalik birebir). Ileride mesru
//    bir fark cikarsa pin, bridge.sourceAmount'tan turetilen kart satiri ile degistirilir (spec bolum 14,
//    M2-m7), tolerans eklenmez. Kartin "ode" rakami = sourceInput = bridge.sourceAmount = calldata tutari.
//  - Koprulu rotada quote.amount (gateway USDC'si) ile kaynak varlik tutari (bridge.sourceAmount) arasindaki kur/kopru payi
//    denetlenmez; ucret ust siniri (fee.cap) yalniz gateway USDC'si cinsindeki ucretlere uygulanir.
//  - sourceInput.decimals bir sunucu yankisidir: kartin "ode" rakami onunla olceklenir; SDK
//    kayit defterindeki ondalikla BIREBIR esit olmak zorundadir (21 ondalik 1000 USDC'yi
//    "1.0" gosterirdi). Esitlik iki rotada da denetlenir.
//  - Dogrudan rotada calldata'nin ICERIGI cozulmez (deposit.to gateway'e sabit, izin tam tutar); yalniz
//    secici yasak listesine bakilir. Koprulu rotada calldata cozulur (yukarida).
export function assertQuoteMatches(quote, expected) {
    const { sourceChainId, sourceAsset, payoutUsdc, outputAddress, inputAddress } = expected || {}
    if (!quote || typeof quote !== 'object') throw unsupported('quote.shape')
    if (typeof quote.ticket !== 'string' || !TICKET_RE.test(quote.ticket)) throw unsupported('ticket')
    const d = quote.deposit
    if (!d || typeof d !== 'object' || (d.txKind ?? 'evm') !== 'evm') throw unsupported('deposit.shape')
    const chainId = Number(d.chainId)
    if (!Number.isInteger(chainId) || chainId !== Number(sourceChainId)) throw unsupported('deposit.chain')
    const data = typeof d.data === 'string' ? d.data.toLowerCase() : ''
    if (!/^0x[0-9a-f]{8,}$/.test(data) || data.length % 2 !== 0) throw unsupported('deposit.data')
    if (DENIED_SELECTORS.has(data.slice(0, 10))) throw unsupported('deposit.selector')
    const to = pinAddress(d.to, 'deposit.to')
    const gateway = pinAddress(quote.gateway, 'gateway')
    if (gateway !== CANONICAL_GATEWAY) throw unsupported('gateway')
    const value = nonNegativeBigInt(d.value || 0, 'deposit.value')
    if (pinAddress(quote.inputAddress, 'inputAddress') !== pinAddress(inputAddress, 'inputAddress')) throw unsupported('inputAddress')
    // Teslim tokeni ZORUNLU (K4): expected.outputToken eksik ya da bozuksa PRIVATE_UNSUPPORTED; varsayilan YOK.
    const outputToken = normalizeDeliveryToken(expected?.outputToken)
    const payout = payoutUnits(payoutUsdc)

    // isAssetSymbol korumasi: 'constructor' gibi prototip adlari getAssetOnChain'de ham
    // TypeError atardi (PRIVATE_FAILED); bicim disi varlik PRIVATE_UNSUPPORTED'dir.
    const registry = typeof sourceAsset === 'string' && isAssetSymbol(sourceAsset) ? getAssetOnChain(sourceAsset, chainId) : null
    if (!registry) throw unsupported('request.asset')
    const registryToken = pinAddress(registry.address, 'registry', { allowZero: true })
    const si = quote.sourceInput
    const total = nonNegativeBigInt(quote.amount, 'amount')
    if (!quote.bridge) {
        const usdc = getAssetOnChain('USDC', PAYOUT_CHAIN_ID)
        if (chainId !== PAYOUT_CHAIN_ID || sourceAsset !== 'USDC' || !usdc) throw unsupported('direct.route')
        if (to !== gateway) throw unsupported('direct.to')
        if (pinAddress(quote.usdc, 'direct.usdc') !== pinAddress(usdc.address, 'direct.usdc')) throw unsupported('direct.usdc')
        if (value !== 0n) throw unsupported('direct.value')
        // Kartin "ode" satiri sourceInput'tan gelir; varsa quote.amount ile BIREBIR ayni olmali.
        if (si !== undefined && si !== null) {
            if (typeof si !== 'object') throw unsupported('direct.sourceInput')
            if (nonNegativeBigInt(si.amount, 'direct.sourceInput') !== total) throw mismatch('direct.sourceInput.amount')
            if (si.asset !== 'USDC') throw mismatch('direct.sourceInput.asset')
            if (Number(si.chainId) !== PAYOUT_CHAIN_ID) throw mismatch('direct.sourceInput.chain')
            if (Number(si.decimals) !== Number(registry.decimals)) throw mismatch('direct.sourceInput.decimals')
        }
    } else {
        // BSC USDC isteginde bridge nesnesi olmaz: dogrudan rota sabitlerini kapatmanin yolu.
        if (chainId === PAYOUT_CHAIN_ID && sourceAsset === 'USDC') throw mismatch('route.bridge-on-direct')
        // Koprulu kaynaklar kapaliysa (fail-closed) hicbir koprulu teklif kabul edilmez.
        if (!PRIVATE_BRIDGED_SOURCES) throw unsupported('bridged.closed')
        const b = quote.bridge
        if (typeof b !== 'object') throw unsupported('bridge.shape')
        // Yalniz Relay Depository rotasi: (zincir, varlik) tabloda olmali ve o zincirin Depository adresi bilinmeli.
        const depository = bridgedDepositoryFor(chainId, sourceAsset)
        if (!depository) throw unsupported('bridged.route')
        if (b.protocol !== 'relay') throw unsupported('bridge.protocol')
        if (Number(b.destinationChainId) !== PAYOUT_CHAIN_ID) throw unsupported('bridge.destination')
        if (Number(b.sourceChainId) !== chainId) throw unsupported('bridge.sourceChain')
        const sourceAmount = nonNegativeBigInt(b.sourceAmount, 'bridge.sourceAmount')
        if (sourceAmount === 0n) throw unsupported('bridge.sourceAmount')
        if (registryToken === ZeroAddress) {
            // Native kaynak: izin yok (token sentinel = sifir adres), value bridge tutariyla ayni.
            if (pinAddress(b.sourceToken, 'bridge.token', { allowZero: true }) !== ZeroAddress) throw unsupported('bridge.token')
            if (value !== sourceAmount) throw unsupported('bridge.value')
        } else {
            if (pinAddress(b.sourceToken, 'bridge.token') !== registryToken) throw unsupported('bridge.token')
            if (value !== 0n) throw unsupported('bridge.value')
        }
        // Kartta gorunen odeme rakami = cuzdandan cikabilecek en cok tutar (esitlik).
        if (!si || typeof si !== 'object') throw unsupported('bridge.sourceInput')
        if (nonNegativeBigInt(si.amount, 'bridge.sourceInput') !== sourceAmount) throw mismatch('bridge.sourceInput.amount')
        if (si.asset !== sourceAsset) throw mismatch('bridge.sourceInput.asset')
        if (Number(si.chainId) !== chainId) throw mismatch('bridge.sourceInput.chain')
        if (Number(si.decimals) !== Number(registry.decimals)) throw mismatch('bridge.sourceInput.decimals')
        // Islem hedefi (ve ERC-20'de izin spender'i) o zincirin Depository'si; cagri cozulur ve istekle esitlenir.
        if (to !== depository) throw unsupported('bridge.to')
        assertDepositoryCall(data, {
            native: registryToken === ZeroAddress,
            depositor: pinAddress(inputAddress, 'inputAddress'),
            token: registryToken,
            amount: sourceAmount,
        })
    }
    // UCRET MODELI (canli olcum 2026-10-29): odeme ve ucretler once okunur; model integratorFee'den gelir.
    let qp
    try { qp = BigInt(quote.payoutAmount) } catch { throw unsupported('payout.shape') }
    const serviceFee = nonNegativeBigInt(quote.serviceFee, 'fee.service')
    const integratorFee = nonNegativeBigInt(quote.integratorFee, 'fee.integrator')
    if (integratorFee > 0n) {
        // URETIM: ucret USTUNE eklenir; istenen = alicinin alacagi. Cuzdandan cikan tutar quote.amount (fee.sum asagida).
        if (qp <= 0n || qp > total) throw mismatch('payout.quote')
        if (qp !== payout) throw mismatch('payout.request')
    } else {
        // ESKI: ucret icten duser; istenen = cuzdandan cikan brut tutar (izin, kartin "odeyecegin" satiri) BIREBIR.
        if (total !== payout) throw mismatch('amount.request')
        if (qp <= 0n || qp > total) throw mismatch('payout.quote')
    }
    // Kartin ucret satirlari ve cuzdandan cikan tutar odemeye bagli: amount = odeme + SilentSwap ucreti + ortak ucreti
    // (amount = payout + ucretler). Aksi halde kart kucuk ucret gosterirken
    // cuzdandan cikan tutar (ya da odeme) gosterilenden cok farkli olabilirdi.
    if (total - serviceFee - integratorFee !== qp) throw mismatch('fee.sum')
    // Toplam ucret ust siniri: istenenin MAX_TOTAL_FEE_BPS / 10000'i (her iki modelde istenen = payout degiskeni). Esitlik gecer.
    if ((serviceFee + integratorFee) * 10000n > payout * BigInt(MAX_TOTAL_FEE_BPS)) throw mismatch('fee.cap')

    const r = Array.isArray(quote.recipients) ? quote.recipients : []
    const want = normalizedOrNull(outputAddress)
    // Sifir adres alici hicbir zaman mesru degildir: istenen de teklifteki de reddedilir.
    if (want === ZeroAddress) throw unsupported('recipient.zero')
    if (r.length === 1 && normalizedOrNull(r[0]?.address) === ZeroAddress) throw unsupported('recipient.zero')
    if (r.length !== 1) throw mismatch('recipient.count')
    if (!want || normalizedOrNull(r[0]?.address) !== want) throw mismatch('recipient.address')
    // TEKLIFTE recipients[0].chainId TESLIM agidir (olculdu: 8453, 42161); siparis KAYDINDA ise 56 sabittir (assertOrderStateMatches).
    if (Number(r[0].chainId) !== outputToken.chainId) throw mismatch('recipient.chain')
    let rp
    try { rp = BigInt(r[0].payoutAmount) } catch { throw unsupported('payout.shape') }
    if (rp !== qp) throw mismatch('payout.recipient')
    const wantDest = destFor(outputToken)
    const dest = quote.dest
    if (!dest || typeof dest !== 'object' || dest.kind !== wantDest.kind || Number(dest.chainId) !== wantDest.chainId
        || !same(String(dest.assetId), wantDest.assetId)) throw mismatch('dest.echo')
    const minDest = nonNegativeBigInt(dest.minDestAmount, 'dest.min')
    const expectedDest = nonNegativeBigInt(dest.expectedDestAmount, 'dest.expected')
    if (minDest === 0n) throw mismatch('dest.min')
    // Tablo USDC'si tesliminde en az teslim odemeyi asamaz (K7). Birim farki OLCEKLENIR: odeme (payoutAmount) gateway USDC'si
    // (BSC, 18 ondalik) cinsindendir; teslim USDC'si BSC'de 18, oteki aglarda 6 ondaliktir. Ondalik TABLODAN gelir (token tablo
    // USDC'sine inmistir), sunucu yankisindan degil. Olceksiz karsilastirma 6 ondalikta HIC tetiklenmezdi. Diger tokenlerde birim
    // farkli ve alt sinir yoktur (kart beklenen ve en az tutari imzadan once gosterir).
    if (isUsdcDeliveryToken(outputToken) && minDest * 10n ** BigInt(18 - outputToken.decimals) > qp) throw mismatch('dest.min')
    if (expectedDest < minDest) throw mismatch('dest.expected')
}

// SIPARIS KAYDI DENETIMI (spec 16, M2-m8). dest akisinda (2026-10-10'dan beri her teslim) paranin gidecegi
// yer, siparisin SUNUCU durum kaydindaki (GET /order/{ticket}) recipients[].destAddress'tir: kayitta
// recipients[0].address SIFIR yer tutucudur (gecici cuzdan sonra atanir), teklifin recipients yankisi ise
// istenen adresi tekrarlar ve tek basina bir sey kanitlamaz. Canli olculdu: kayit yatirmadan ONCE
// (AWAITING_DEPOSIT) okunabilir ve destAddress/destAssetId tasir. Bu yuzden teklif kullaniciya gosterilmeden
// once kayit denetlenir. Iade order.signer'a gider (SDK refundOrder belgesi): imzaci kaynak adres olmali.
// `quote` assertQuoteMatches'ten GECMIS tekliftir; `expected` onunla ayni istek beklentileri.
export function assertOrderStateMatches(state, expected, quote) {
    // Teslim tokeni ZORUNLU (K4): chainId'siz ya da bozuk outputToken PRIVATE_UNSUPPORTED.
    const outputToken = normalizeDeliveryToken(expected?.outputToken)
    if (!state || typeof state !== 'object') throw unsupported('order.shape')
    if (!same(String(state.ticket ?? ''), String(quote?.ticket ?? ''))) throw mismatch('order.ticket')
    if (state.status !== 'AWAITING_DEPOSIT') throw mismatch('order.status')
    if (nonNegativeBigInt(state.amount, 'order.amount') !== BigInt(quote.amount)) throw mismatch('order.amount')
    if (normalizedOrNull(state.gateway) !== CANONICAL_GATEWAY) throw mismatch('order.gateway')
    // Iade order.signer'a yalniz cuzdanin kendisinin odedigi evm kaynakli sipariste gider (SDK belgesi).
    if (state.sourceChainKind !== 'evm') throw mismatch('order.sourceChainKind')
    if (state.sourceAsset !== expected?.sourceAsset) throw mismatch('order.sourceAsset')
    const signer = normalizedOrNull(state.signer)
    if (!signer || signer !== normalizedOrNull(expected?.inputAddress)) throw mismatch('order.signer')
    const r = Array.isArray(state.recipients) ? state.recipients : []
    if (r.length !== 1) throw mismatch('order.recipient.count')
    const want = normalizedOrNull(expected?.outputAddress)
    const dest = normalizedOrNull(r[0]?.destAddress)
    if (!want || want === ZeroAddress || dest !== want) throw mismatch('order.destAddress')
    // KAYITTA recipients[0].chainId 56 SABITTIR ve teslim agina CEVRILMEZ (olculdu: Base ve Arbitrum siparislerinde de 56);
    // teslim agi yalniz destChainId'dedir (asagida). Teklifteki kural (teslim agi) ile kayittaki kurali tek kurala indirmek ya
    // her BSC disi teklifi reddeder ya da kaydi gevsetir; sunucu bunu degistirirse fail-closed olur.
    if (Number(r[0].chainId) !== PAYOUT_CHAIN_ID) throw mismatch('order.recipient.chain')
    // Yer tutucu adres SIFIR (canli) ya da istenen adres olmali: baska bir adres, sunucu dogrudan odeme
    // yoluna donerse paranin gidecegi yer olurdu.
    const placeholder = normalizedOrNull(r[0].address)
    if (placeholder !== ZeroAddress && placeholder !== want) throw mismatch('order.recipient.address')
    const wantDest = destFor(outputToken)
    if (r[0].destChainKind !== wantDest.kind || Number(r[0].destChainId) !== wantDest.chainId
        || !same(String(r[0].destAssetId), wantDest.assetId)) throw mismatch('order.destAsset')
    if (nonNegativeBigInt(r[0].payoutAmount, 'order.payout') !== BigInt(quote.payoutAmount)) throw mismatch('order.payout')
    // Kartin "en az teslim" satiri teklifin dest.minDestAmount'udur; iscinin uyguladigi en az kayittakidir ve
    // ondan KUCUK olamaz (canli: kayit 14.64 >= teklif 14.35; esitlik beklenmez, kayit kaymayi yeniden hesaplar).
    if (nonNegativeBigInt(r[0].minDestAmount, 'order.minDest') < BigInt(quote.dest.minDestAmount)) throw mismatch('order.minDest')
}

const isEvmAddress = (s) => typeof s === 'string' && ADDRESS_RE.test(s)

// Yatirma plani. SDK'nin (gizli) allowanceTarget kuralinin kopyasi:
//   koprulu rota  -> token bridge.sourceToken, spender deposit.to, tutar bridge.sourceAmount
//   koprusuz rota -> token quote.usdc, spender quote.gateway, tutar quote.amount
// Native kaynakta izin yoktur: SDK sentinel'i sifir adrestir ve teklif fixture'i da
// sifir adresle isaretler, ikisi de native sayilir (address(0)'a approve uretilmez).
// Izin HER ZAMAN tam tutardir (sinirsiz degil). Izin turetilemeyen teklif sessizce
// "izinsiz" sayilmaz: PRIVATE_UNSUPPORTED (T2 M3).
export function depositPlanFromQuote(quote) {
    const d = quote.deposit
    const value = BigInt(d.value || '0')
    let approval = null
    if (quote.bridge) {
        const token = quote.bridge.sourceToken
        if (!isEvmAddress(token)) throw unsupported('plan.bridgeToken')
        if (!same(token, NATIVE_TOKEN_SENTINEL) && !same(token, ZeroAddress)) {
            approval = { token: getAddress(token.toLowerCase()), spender: pinAddress(d.to, 'plan.spender'), amount: BigInt(quote.bridge.sourceAmount) }
        }
    } else {
        if (value !== 0n) throw unsupported('plan.value')
        approval = { token: pinAddress(quote.usdc, 'plan.usdc'), spender: pinAddress(quote.gateway, 'plan.gateway'), amount: BigInt(quote.amount) }
    }
    return {
        chainId: Number(d.chainId),
        approval,
        deposit: { to: pinAddress(d.to, 'plan.to'), data: d.data, value },
    }
}

export function approveCall({ token, spender, amount }) {
    return { to: token, data: ERC20.encodeFunctionData('approve', [spender, amount]), value: 0n }
}

// ATS yolunda op'un cagri listesi: TEK uretici (arka plan teklifi ve yurutucu AYNI listeyi kullanir).
// `allowanceRaw` harcayicinin (spender) kaynak token uzerindeki MEVCUT izni (bigint) ya da bilinmiyorsa null:
//   - approval yok (native)  -> [deposit] (izin degeri yok sayilir)
//   - null/verilmemis        -> [approve(tutar), deposit] (eski davranis)
//   - izin === tutar         -> [deposit] (approve gereksiz)
//   - izin === 0             -> [approve(tutar), deposit]
//   - diger izin > 0         -> [approve(spender, 0), approve(spender, tutar), deposit]
// USDT benzeri tokenlar sifir olmayan izni dogrudan degistirmez: artik izin once sifirlanir (native yoldaki
// ensureExactAllowance ile ayni kural). approve sayisi HICBIR yerde tahminle azaltilmaz; yalniz okunan izne gore secilir.
export function atsCallsFromPlan(plan, allowanceRaw = null) {
    if (!plan.approval) return [plan.deposit]
    if (allowanceRaw == null) return [approveCall(plan.approval), plan.deposit]
    if (allowanceRaw === plan.approval.amount) return [plan.deposit]
    if (allowanceRaw === 0n) return [approveCall(plan.approval), plan.deposit]
    return [approveCall({ ...plan.approval, amount: 0n }), approveCall(plan.approval), plan.deposit]
}

// SDK expiresAt biriminin belgesi yok: 1e12'den kucukse saniye kabul edilir.
export function expiresAtMs(v) {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return null
    return n < 1e12 ? n * 1000 : n
}

// Arayuze giden ozet: yalniz dizge/sayi (mesaj siniri JSON'dur, BigInt gecmez). `outputToken` ZORUNLU (K4): dest'in ag,
// sembol ve ondaligi SECIMDEN gelir (K6), sunucu yankisindan degil; eksik ya da bozuksa PRIVATE_UNSUPPORTED. `recipientChainId`
// sunucu yankisi olarak kalir ve yalniz esitlik denetimi icindir (arayuz teslim agini dest.chainId'den gosterir).
// dest.quoteUsd (destQuoteUsd yankisi) yalniz BILGIdir: sonlu ve > 0 degilse null.
export function quoteSummary(quote, outputToken) {
    const token = normalizeDeliveryToken(outputToken)
    const first = Array.isArray(quote.recipients) ? quote.recipients[0] : null
    const si = quote.sourceInput
    const usd = Number(quote.dest?.destQuoteUsd)
    return {
        ticket: quote.ticket,
        payoutUsdc: formatUsdc(quote.payoutAmount),
        totalUsdc: formatUsdc(quote.amount),
        serviceFeeUsdc: formatUsdc(quote.serviceFee || '0'),
        integratorFeeUsdc: formatUsdc(quote.integratorFee || '0'),
        integratorAddress: quote.integratorAddress || null,
        expiresAtMs: expiresAtMs(quote.expiresAt),
        expectedFulfillmentMs: Number(quote.expectedFulfillmentMs) || null,
        recipient: first?.address || null,
        recipientChainId: first ? Number(first.chainId) : null,
        sourceInput: si ? { amount: String(si.amount), asset: si.asset, decimals: Number(si.decimals), chainId: Number(si.chainId) } : null,
        dest: quote.dest ? {
            chainId: token.chainId,
            asset: token.symbol,
            decimals: token.decimals,
            expectedDestAmount: String(quote.dest.expectedDestAmount ?? ''),
            minDestAmount: String(quote.dest.minDestAmount ?? ''),
            quoteUsd: Number.isFinite(usd) && usd > 0 ? usd : null,
        } : null,
    }
}

// Her hata tek bir koda iner; kodlari arayuz katmani cevirir (privacyErrors.js KNOWN
// ve dil anahtarlari kodu kapsadikca).
export function privacyErrorCode(e) {
    if (e instanceof AmountOutOfRangeError) return e.code === 'amount_above_maximum' ? 'PRIVATE_MAX_AMOUNT' : 'PRIVATE_MIN_AMOUNT'
    if (e instanceof MaintenanceModeError) return 'PRIVATE_PROVIDER_DOWN'
    // Canli (2026-10-10): secilen token icin rota yoksa 502 near_payout_preflight_failed / ROUTE_TEMPORARILY_UNAVAILABLE.
    if (e instanceof HttpError && (e.body?.errorCode === 'ROUTE_TEMPORARILY_UNAVAILABLE' || e.body?.error === 'near_payout_preflight_failed')) return 'PRIVATE_ROUTE_UNAVAILABLE'
    // Canli (2026-10-15): ATS gibi ince havuzlu tokenlerde 400 relay_preflight_failed / SWAP_IMPACT_TOO_HIGH (%96-97). Token'a
    // ozeldir, agi kapatmaz: kullanici baska bir token dener.
    if (e instanceof HttpError && e.body?.errorCode === 'SWAP_IMPACT_TOO_HIGH') return 'PRIVATE_IMPACT_TOO_HIGH'
    // Sunucu hiz siniri (POST /orders 20 / 60 sn, GET /order 120 / 60 sn): yerel pencere (providerGuard) bunu cogu zaman once yakalar.
    if (e instanceof HttpError && e.status === 429) return 'PRIVATE_RATE_LIMITED'
    if (e instanceof HttpError) return e.status >= 500 ? 'PRIVATE_PROVIDER_DOWN' : 'PRIVATE_PROVIDER_ERROR'
    // providerFetch'in AbortSignal.timeout'u ya da bir iptal: fetch AbortError / TimeoutError ile reddedilir.
    if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return 'PRIVATE_PROVIDER_DOWN'
    const msg = typeof e?.message === 'string' ? e.message : ''
    // ethers 'insufficient funds for intrinsic transaction cost': yatirma ve iadede gaz yetmedi.
    if (e?.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(msg)) return 'PRIVATE_INSUFFICIENT_GAS'
    // createWalletInstance kilitli cuzdanda 'Wallet locked. Please enter your password.' firlatir.
    if (msg === 'WALLET_LOCKED' || /wallet locked/i.test(msg)) return 'WALLET_LOCKED'
    // requireEvmChain (utils/vm.js) EVM olmayan zincirde bu kodu firlatir; kapi da ayni kodu kullanir.
    if (msg === 'CHAIN_NOT_EVM') return 'PRIVATE_EVM_ONLY'
    if (/^PRIVATE_[A-Z_]+$/.test(msg)) return msg
    // Yalniz fetch/ag basarisizligi saglayici kesintisidir; baska TypeError yerel hatadir
    // (bozuk kayit vb.) ve PRIVATE_FAILED olarak kalir.
    if (e instanceof TypeError && /failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(msg)) return 'PRIVATE_PROVIDER_DOWN'
    return 'PRIVATE_FAILED'
}

// Hata yanitina eklenen sinir (spec 4.2): yerel providerGuard hatasi `limitUsdc` dizgesini kendisi tasir; SDK'nin
// AmountOutOfRangeError'u ham tutari (`limitAmount`, `usdcDecimals` ondalikli) tasir. Ekran metni bu alani kullanir
// (PRIVATE_MIN_AMOUNT {min}, PRIVATE_MAX_AMOUNT_LIMIT {max}). Okunamazsa ya da sifirsa null: ekran genel metne duser.
export function limitUsdcOf(e) {
    if (typeof e?.limitUsdc === 'string' && e.limitUsdc) return e.limitUsdc
    if (e instanceof AmountOutOfRangeError && typeof e.limitAmount === 'string') {
        try {
            const raw = BigInt(e.limitAmount)
            if (raw <= 0n) return null
            const text = formatUnits(raw, e.usdcDecimals)
            return text.includes('.') ? text.replace(/\.?0+$/, '') : text
        } catch {
            return null
        }
    }
    return null
}
