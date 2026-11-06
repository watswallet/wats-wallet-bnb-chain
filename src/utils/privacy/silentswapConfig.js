import { GATEWAY_CHAIN_ID, isSourceChainId } from '@silentswap/chains'
import { getAssetOnChain, isAssetSymbol } from '@silentswap/sdk'
import { isEvm } from '../chainKind'
import { isNativeAsset } from '../nativeAsset'
import { PRIVATE_BRIDGED_SOURCES } from './privateBridgedSources'
import { bridgedDepositoryFor } from './privateBridgedSources'
import { deliveryChainOf } from './deliveryChains'

const INTEGRATOR_ID_RE = /^int_[a-z0-9]{24}$/

// SDK kurucusu bicim disi kimlikte FIRLATIR. Bu sarmalayici bicim disi ya da bos degeri
// "integratorId'siz istemci" sayar (calisma zamaninda yalniz gelistirmede anlamli). Derleme
// zamaninda ise kapi mekaniktir (manifest.config.js): bicimi bozuk id HICBIR modda derlenmez; bos id
// yalniz URETIM derlemesinde (mode === 'production') Gizli mod ACIKKEN derlemeyi durdurur. Gelistirme
// modunda bos id bayrak ACIKKEN de derlenir (.env.development'in durumu budur: integratorId'siz istemci,
// yalniz gelistirmede anlamli); uretimde bayrak KAPALIYKEN de derlenir (olu kod olarak paketlenir).
export function integratorIdFrom(raw) {
    return typeof raw === 'string' && INTEGRATOR_ID_RE.test(raw) ? raw : undefined
}

export const SILENTSWAP_INTEGRATOR_ID = integratorIdFrom(import.meta.env.VITE_SILENTSWAP_INTEGRATOR_ID)

// SilentSwap'in gateway (odeme) zinciri. SDK JSDoc'u "Base" der, kod 56'dir.
export const PAYOUT_CHAIN_ID = GATEWAY_CHAIN_ID

// SilentSwap'in alici basina asgari USDC tutari. Kural ISTENEN tutara uygulanir (sunucu "Minimum payout is 12 USDC (requested
// 10 USDC)" der; yerel denetim ayni degeri ayni tutara uygular, providerGuard.js). Uretim modelinde (ucret ustune eklenir,
// silentswap.js 'UCRET MODELI') istenen = alicinin alacagi tutardir; cuzdandan cikan tutar bunun ~%1 ustudur ve 12 sinirina
// girmez. Ekran denetimi, ipucu ve hata metni ayni sabiti kullanir (uc ayri kopya zamanla ayrisirdi).
// Canli (2026-10-10): sunucu "Minimum payout is 12 USDC (requested 10 USDC)" dedi.
export const MIN_PAYOUT_USDC = 12

// Toplam ucret ust siniri (baz puan): serviceFee + integratorFee, istenen tutarin bu orani ASAMAZ (silentswap.js assertQuoteMatches
// 'fee.cap'). Esitlik gecer.
export const MAX_TOTAL_FEE_BPS = 100

// CANLI DENEME SONUCLARI.
// S2 (Task 12): ATS 7702 op'uyla yapilan yatirma gozleniyor ve sonuclaniyor.
// S3 (Task 6): BSC'de native BNB hedef varlik (`dest`) olarak kabul ediliyor. GECTI 2026-10-10: kullanicinin
//    cuzdanindan 15 USDC -> BNB teklifi success:true, dest.expectedDestAmount dolu (para oynamadi).
//
// PRIVATE_ORDER_ATS ACIK (2026-10-29, K7, sade ekran plani Task 20): ag ucreti her iki modda ATS ile odenir.
// Para yukle'de ucreti normal hesap, Gonder'de Gizli Hesap oder (K7). Kod tarafi onkosullar tamamdir:
// atsCallsFromPlan artik izni sifirlar (silentswap.js), ekranin ATS yetersiz/kurulum/hata durumlari ve SSR
// testleri yazildi, hash'siz belirsiz sonuc PRIVATE_DEPOSIT_UNTRACKED ile cevaplanir.
//
// Bilgi (yapilacak is DEGIL): opKind 'private' icin komisyon plani YOKTUR (atsPaymaster COMMISSION_ALLOWED_KINDS
// yalniz swap/bridge): bu op'ta ATS komisyonu alinmaz.
//
// CANLIDA DOGRULANACAKLAR (fonlu, yalniz sahip yapar; sonuclar canli-defter.md'ye; basarisizsa bayrak GERI KAPANIR):
// - Bundler'in SilentSwap gateway `approve`+`deposit` op'unu ve Relay Depository op'larini (depositErc20 /
//   depositNative) sponsorlamasi (R1; L1, L2, L5). Paymaster'in hedef sozlesme kisiti varsa her yatirma
//   `sponsor` asamasinda duser ve K7 uygulanamaz.
// - `integratorId` ile brut pin (R2; L3): silentswap.js `amount.request` brutu pinler, integrator ucreti
//   odemenin USTUNE eklenirse teklifler reddedilebilir. Pin DEGISTIRILMEZ, karar sahibe doner.
// - Artik izinli kaynakta `approve(0)` + `approve(tutar)` + `deposit` tek op'ta (L4; USDT benzeri tokenlar).
// - Hash'siz belirsiz sonuclar (7.6 madde 6; L8): sendOneOp, nonce ilerledigi icin op'un calismis olabilecegi
//   hatayi ve yeniden deneme hakki bitince nonce'un ilerledigi (ya da okunamadigi) relay hatasini opMayHaveRun
//   ile isaretler; yurutucu bunu hashsiz PRIVATE_DEPOSIT_UNCONFIRMED'a, arka plan da PRIVATE_DEPOSIT_UNTRACKED
//   cevabina cevirir ve ticket bellekte tuketilmis kalir. Kalici kayit yazilamaz: siparis izlenemez ve Gizli
//   islemler'de SATIRI YOKTUR. Gercek relay davranisi (saf red mi, op indi mi) canlida dogrulanmali; arka ucun
//   ayni ticket'in ikinci yatirmasini reddettigi VARSAYILMAMALI.
// - Bundler'in ve satis sunucusunun istemci IP'sini + Gizli Hesap adresini LOGLAMADIGININ yazili teyidi
//   (madde 3; L9): ATS teklifi ve op bu ikisini birlikte arka ucumuza gonderir (spec 8 yalniz gizli akis
//   icinde kabul eder).
// Relay edilen op'un yatirma hash'i onRelayed ile kaydedilir: relay "basarisiz" dese bile islem
// hash'i varsa (belirsiz) sendOneOp onu bir kez bildirir ve yurutucu kaydeder. Hash HIC uretilmezse
// kayit YAZILAMAZ; bu iki ayri durumdur:
//  - atsExecute hash'siz REDDEDILIRSE ve hata opMayHaveRun tasimiyorsa (saf red: nonce ilerlememis)
//    yatirma gitmemistir, cevap PRIVATE_FAILED/PROVIDER_DOWN olur ve ticket yeniden denenebilir.
//  - hata opMayHaveRun tasiyorsa YA DA atsExecute hash'siz COZULURSE (gercek executeAtsTransfer
//    bunu bugun dondurmez; savunma amacli) cevap PRIVATE_DEPOSIT_UNTRACKED'dir ve ticket
//    bellekte tuketilmis kalir.
// Bayrak aciklamasi: Para yukle'de ucreti normal hesap, Gonder'de Gizli Hesap oder (K7).
export const PRIVATE_ORDER_ATS = true
export const PRIVATE_DEST_NATIVE = true

// Koprulu kaynaklar YALNIZ Relay Depository rotasinda acik: sabit, (zincir, varlik) tablosu ve gerekcesi privateBridgedSources.js'te.
// TEK DIKIS: bu dosya sabiti YENIDEN DISA AKTARMAZ; kapi yardimcilari (asagida) VE assertQuoteMatches
// (silentswap.js) onu dogrudan privateBridgedSources.js'ten okur, testler yalniz o modulu mock'lar (T26 M3).

const STABLES = ['USDC', 'USDT', 'DAI']

// Dogrudan rota: ayri bir yonlendirici gerektirmeyen tek kaynak (BSC + USDC, hedef = kanonik gateway).
const isDirectSource = (chainId, symbol) => chainId === PAYOUT_CHAIN_ID && symbol === 'USDC'

// Kaynak olarak acik mi: dogrudan rota, ya da sabit acikken Depository tablosundaki koprulu ikili. Tablo disindaki
// koprulu ikililer (BSC USDT/BNB gibi yonlendirici rotalari) sabit acikken de SUNULMAZ (teklif zaten reddederdi).
const isOpenSource = (chainId, symbol) => isDirectSource(chainId, symbol)
    || (PRIVATE_BRIDGED_SOURCES && bridgedDepositoryFor(chainId, symbol) !== null)

// Bir kaynak zincirinde SilentSwap'in kurasyonlu listesinde olan ve kaynak olarak acik varliklar. Koprulu kaynaklar
// kapaliyken yalniz dogrudan rotanin varligi doner. Acik durum yalniz sabitle degisir (argumanla DEGIL, T23 M1).
export function privateAssetsFor(chain) {
    const id = Number(chain?.chainId)
    const candidates = [...STABLES, chain?.nativeCurrency?.symbol]
    return candidates.filter((s, i) =>
        s && candidates.indexOf(s) === i && isAssetSymbol(s) && !!getAssetOnChain(s, id)
        && isOpenSource(id, s))
}

// Gizli siparise kaynak olabilecek zincirler: EVM + SilentSwap kaynak listesi +
// en az bir kurasyonlu varlik.
export function privateSourceChains(chains) {
    return (chains || []).filter((c) =>
        isEvm(c) && isSourceChainId(Number(c.chainId)) && privateAssetsFor(c).length > 0)
}

// Cuzdandaki bir token (zincir kaydi + token adresi) gizli siparise kaynak olabilir mi: o zincirin ACIK kaynak varliklarindan
// SDK kayit adresi tokenin adresiyle AYNI olan sembol, yoksa null. Yalniz sembol yetmez: kendine "USDC" diyen baska bir token kaynak
// sayilmaz. Yerel coin kayitta sifir adrestir; cuzdan onu birkac bicimde tutar (isNativeAsset). Adres yok, bos ya da dizge degilse null
// (bos adres yerel coin SAYILMAZ). Token ekrani Gizli takas / kopru dugmelerini bununla onsecer; eslesme yoksa dugmeler GOSTERILMEZ
// (klasik ekrana DUSULMEZ: gizli modda klasik Takas/Kopru yoktur). Arka plan siniri privateSourceSupported'dir, bu degil.
export function privateSourceAssetOf(chain, address) {
    if (typeof address !== 'string' || address.trim() === '') return null
    if (!chain || !privateSourceChains([chain]).length) return null
    const id = Number(chain.chainId)
    const native = isNativeAsset(address)
    return privateAssetsFor(chain).find((s) => {
        const registered = getAssetOnChain(s, id)?.address
        if (typeof registered !== 'string') return false
        return native
            ? registered === ZERO_ADDRESS
            : typeof address === 'string' && registered.toLowerCase() === address.trim().toLowerCase()
    }) ?? null
}

// Arka planin teklif kapisi (spec 6.2): arayuz kurallari erken uyaridir, sinir burasidir.
// Zincir SilentSwap kaynak listesinde, varlik kurasyonlu kayitta ve o zincirde dagitilmis olmali.
// isAssetSymbol buyuk/kucuk harfe bakmaz ama getAssetOnChain birebir ister: ikisi birlikte aranir.
export function privateSourceSupported(chainId, asset) {
    const id = Number(chainId)
    if (!Number.isInteger(id) || !isSourceChainId(id)) return false
    if (typeof asset !== 'string' || !isAssetSymbol(asset)) return false
    if (!isOpenSource(id, asset)) return false
    return !!getAssetOnChain(asset, id)
}

// PARA YUKLE TESLIM DEGISMEZI (1.10, sahip karari 2026-10-30): Gizli Hesap'a teslim edilen her varlik YALNIZ Gonder ile cikabilir (uretimde
// ATS satisi ve gizli modda Takas/Kopru kapali; gelistirmede bayrak aciksa kendine Takas/Kopru ciktilari da bu kurala tabidir, arka plan bunu bayraktan bagimsiz uygular). Ag ucreti HER islemde ATS ile odenir, yerel coin gaz icin gerekmez; bu yuzden "gaz icin yerel
// coin" istisnasi YOKTUR: Para yukle'de teslim edilebilen token = o teslim agindaki Gonder kaynagi varliklari (privateAssetsFor, koprulu
// kaynaklar dahil), baska hicbir sey. Yerel coin (sifir adres) yalniz o agin yerel coini Gonder kaynagiysa (ETH gibi) gecer; BNB, POL, xDAI,
// CELO, MNT, CRO teslim edilemez. Token { chainId, address }: ag teslim tablosunda olmali; adres harf boyutuna bakmaz; baska agin adresi
// bu agda sayilmaz. Bozuk girdi false (fail-closed). Gonder modunda (alici dis adres) bu suzme UYGULANMAZ.
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export function privateFundDeliverable(token) {
    const chain = deliveryChainOf(token?.chainId)
    if (!chain || typeof token?.address !== 'string') return false
    const address = token.address.toLowerCase()
    const symbols = privateAssetsFor({ chainId: chain.chainId, nativeCurrency: { symbol: chain.nativeSymbol } })
    if (address === ZERO_ADDRESS) return symbols.includes(chain.nativeSymbol)
    return symbols.some((symbol) => getAssetOnChain(symbol, chain.chainId)?.address?.toLowerCase() === address)
}
