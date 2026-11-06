import { getAddress } from 'ethers'
import { DELIVERY_CHAINS, canonicalChainId, deliveryChainOf, defaultAssetOf } from './deliveryChains'
import { ATS_CHAINS } from '../atsConfig'
import { isStockDeliveryToken } from './stockDelivery'
import { hasStockIssuerMarker } from './deliveryStocks'

// GIZLI MOD TESLIM TOKENLERI (spec 2026-10-10 teslim tokenleri; gizli-mod cok-ag spec 4.1, K4-K6). Popup ve arka planin ORTAK,
// SDK'siz modulu: popup silentswap.js'i import edemez (privatePopupImports.test.js), bu yuzden teslim tokeninin tanimi,
// dogrulamasi ve secici listesi burada yasar.
//
// DeliveryToken = { chainId, address, symbol, decimals } (dondurulmus nesne). Kimlik (chainId, adres): adres tek basina kimlik
// DEGILDIR (sifir adres her agda ayni, ayni sozlesme adresi baska agda baska token). chainId token'in ICINDEDIR ve ZORUNLUDUR:
// "alan yoksa BSC USDC" gibi sessiz bir varsayilan yoktur (K4), cunku istek ile iki dogrulayici ayni nesneden turedigi icin hepsi
// yanlisa birlikte uyarir ve para yanlis aga giderdi. Sifir adres SECILEN AGIN yerel coinidir (K5: BSC'de BNB, Base'de ETH,
// Polygon'da POL); sembol, ondalik ve ag SUNUCU YANKISINDAN degil tablodan (deliveryChains.js) ve secimden gelir (K6).

export const DELIVERY_VERSION = 2
const ZERO = '0x0000000000000000000000000000000000000000'
// Bazi token listeleri yerel coin icin bu yer tutucuyu kullanir; gercek bir token degil, teslim edilemez.
const NATIVE_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
// Sembol kirpildiktan sonra 1-20 karakter olmali ve HAM degerde su Unicode siniflarindan hicbiri bulunmamali: kontrol
// (Cc: ASCII ve C1), bicim (Cf: sifir genislik, yon isaretleri, bidi gomme/izolasyon, yumusak tire, BOM U+FEFF vb.),
// satir ve paragraf ayiricilari (Zl, Zp). Gorunmez karakter sembolu taklit edemesin. Liste sayilmaz, sinif
// kullanilir: yeni gorunmez karakterler de otomatik kapsanir. Denetim HAM degerde yapilir: trim() BOM'u (U+FEFF)
// ve sekme/satir sonunu sessizce atar, kirpilmis degerde bakmak bunlari gizlerdi.
const SYMBOL_BAD_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
// Liste adi ayni siniftan temizlenir (yalniz gorunum ve arama metni), en fazla NAME_MAX karakter.
const NAME_BAD_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
const NAME_MAX = 60
const SYMBOL_MAX = 20
const DIGITS_RE = /^\d{1,2}$/
// USDC logosu yerel dosyada (client/public/usdc.png, Trust Wallet varlik deposundan). Gizli modda TUM token logolari TEK cozucudan alinir
// (privateTokenLogo.js: USDC her agda bu dosya); secici satirlari logo tasimaz.
export const USDC_LOGO = '/usdc.png'

const fail = (reason = 'request.outputToken') => { const e = new Error('PRIVATE_UNSUPPORTED'); e.reason = reason; return e }

// Tablodan dondurulmus TEKIL nesneler: ag basina yerel coin ve USDC. normalizeDeliveryToken bunlari AYNI nesne olarak dondurur.
const NATIVE_BY_CHAIN = new Map(DELIVERY_CHAINS.map((c) => [c.chainId, Object.freeze({ chainId: c.chainId, address: ZERO, symbol: c.nativeSymbol, decimals: c.nativeDecimals })]))
const USDC_BY_CHAIN = new Map(DELIVERY_CHAINS.map((c) => [c.chainId, Object.freeze({ chainId: c.chainId, address: c.usdcAddress, symbol: 'USDC', decimals: c.usdcDecimals })]))

export const nativeTokenOf = (chainId) => NATIVE_BY_CHAIN.get(canonicalChainId(chainId)) ?? null
export const usdcTokenOf = (chainId) => USDC_BY_CHAIN.get(canonicalChainId(chainId)) ?? null

// Varsayilan teslim tokeni (P1): BSC'de USDC, oteki aglarda yerel coin; yerel teslim kapaliysa (PRIVATE_DEST_NATIVE) her yerde USDC.
export function defaultDeliveryToken(chainId, nativeEnabled) {
    const asset = defaultAssetOf(chainId, nativeEnabled)
    if (asset === null) return null
    return asset === 'native' ? nativeTokenOf(chainId) : usdcTokenOf(chainId)
}

export const deliveryTokenKey = (t) => `${t.chainId}:${String(t.address).toLowerCase()}`

// Ham deger -> kanonik DeliveryToken. chainId ZORUNLU (sayi ya da kanonik ondalik dizge, tabloda olmali; sonuc sayidir).
// Sifir adres o agin yerel coin tekiline, tablo USDC adresi o agin USDC tekiline doner: gelen sembol/ondalik YOK SAYILIR (K6;
// bozuk olsalar bile tablo degeri doner). Diger tokenlerde sembol buyuk harfe cevrilir (sunucu listesi kucuk harf tutar,
// cuzdan sembolu her yerde buyuk harf gosterir; toUpperCase yerel ayarsiz: tr'de i -> I olmali, uzunluk denetimi buyutmeden
// SONRA: ss -> SS uzatir). Bozuk her sey PRIVATE_UNSUPPORTED (reason 'request.outputToken'; ag icin '...chainId').
export function normalizeDeliveryToken(raw) {
    if (!raw || typeof raw !== 'object') throw fail()
    const chain = deliveryChainOf(raw.chainId)
    if (!chain) throw fail('request.outputToken.chainId')
    const { address, symbol } = raw
    const decimals = typeof raw.decimals === 'string' && DIGITS_RE.test(raw.decimals) ? Number(raw.decimals) : raw.decimals
    if (typeof address !== 'string' || !ADDRESS_RE.test(address)) throw fail()
    if (address.toLowerCase() === NATIVE_PLACEHOLDER) throw fail()
    const canonical = getAddress(address.toLowerCase())
    if (canonical === ZERO) return NATIVE_BY_CHAIN.get(chain.chainId)
    if (canonical === chain.usdcAddress) return USDC_BY_CHAIN.get(chain.chainId)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw fail()
    if (typeof symbol !== 'string' || SYMBOL_BAD_RE.test(symbol)) throw fail()
    const upper = symbol.trim().toUpperCase()
    if (upper.length < 1 || upper.length > SYMBOL_MAX) throw fail()
    return Object.freeze({ chainId: chain.chainId, address: canonical, symbol: upper, decimals })
}

// Yeni mesaj (arayuz -> arka plan) teslim tokenini outputToken'da tasir. VARSAYILAN YOK: alan yoksa (eski `outputAsset`
// dizgesi dahil) ya da bozuksa PRIVATE_UNSUPPORTED; sessizce BSC USDC'ye dusulmez (K4).
export function deliveryTokenFromMessage(data) {
    if (!data || typeof data !== 'object' || data.outputToken === undefined) throw fail()
    return normalizeDeliveryToken(data.outputToken)
}

// Kayit (oturum deposundaki teklif kaydi ya da kalici siparis kaydi) `deliveryVersion: 2` ve outputToken tasir. Surumsuz
// kayit icin ESKI-KAYIT YOLU YOKTUR (E4): teklif kaydi oturumla silinir, yeni teklif alinir; siparis kaydinin eski
// gosterim yolu background.js'te (orderDelivery.js) ayrica ve yalniz gosterim icindir.
export function deliveryTokenFromRecord(rec) {
    if (!rec || typeof rec !== 'object' || rec.deliveryVersion !== DELIVERY_VERSION) throw fail('record.deliveryVersion')
    return normalizeDeliveryToken(rec.outputToken)
}

// Adres karsilastirmasi buyuk/kucuk harfe duyarsiz: normallestirilmemis bir girdi USDC-yalniz kurallari
// (min <= odeme) sessizce atlatmasin. Karar (chainId, adres) ile verilir: baska agin USDC adresi bu agda USDC sayilmaz.
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
export function isNativeDeliveryToken(t) {
    return !!deliveryChainOf(t?.chainId) && sameAddress(t?.address, ZERO)
}
export function isUsdcDeliveryToken(t) {
    const chain = deliveryChainOf(t?.chainId)
    return !!chain && sameAddress(t?.address, chain.usdcAddress)
}

// Liste adi: gorunmez/yon karakterleri atilir, kirpilir, 60 karakterle sinirlanir (yarim vekil cift birakilmaz).
// Bos kalirsa sembol kullanilir.
function cleanName(name, symbol) {
    if (typeof name !== 'string') return symbol
    let n = name.replace(NAME_BAD_RE, '').trim().slice(0, NAME_MAX)
    if (/[\ud800-\udbff]$/.test(n)) n = n.slice(0, -1)
    n = n.trim()
    return n || symbol
}

// Secici listesi (spec 4.1): `chainId` seciciin agidir ve ZORUNLUDUR. Sabit satirlar sirayla o agin yerel coini (bayrak
// aciksa), o agin USDC'si, ag 56 ise ATS (ATS_CHAINS[56].token, kopya yok); sonra ice aktarilanlar, sunucu listesi. Ayni
// (chainId, adres) bir kez; ilk gorulen kazanir. Satirlar LOGO TASIMAZ (logo tek cozucudan: privateTokenLogo.js). Gecersiz adres/ondalik/sembol
// tasiyan kayit SESSIZCE dusurulur (tek bozuk kayit listeyi bozmasin). Sunucunun yerel kaydi (native: true) atlanir: yerel
// coin burada sabit uretilir. Arama sembol, ad ve tam adreste.
//
// SATIRIN AGI (damgalama): uc satir kaynagi agi farkli tasir. Sunucu satirlari chainId tasir; ImportToken satirlari yalniz
// `chain: <slug>` tasir ve teslim yazicisinin satirlari `chain: null`; ikisinin agi yalniz kova anahtarindan bilinir (cagiran,
// satiri zaten o agin kovasindan ya da o ag icin yapilmis istekten okumus olmalidir). Kural: (1) satirin kendi chainId'si varsa
// kanonik kimlik karsilastirmasiyla (canonicalChainId) secici agina esit olmali, degilse satir DUSER (baska agin satiri bu agda teslim varligi olamaz:
// ayni adres baska agda baska bir tokendir); (2) chainId'si yoksa secici agini devralir; (3) ag karari normallestirmeden ONCE
// verilir: normallestirme satirin kendi chainId'sini seciciyle ezseydi, baska ag damgali satir sessizce bu aga cevrilirdi.
export function buildDeliveryTokenList({ chainId, nativeEnabled = false, imported = [], remote = [], search = '' } = {}) {
    const chain = deliveryChainOf(chainId)
    if (!chain) throw fail('request.outputToken.chainId')
    const out = []
    const byKey = new Map()
    // Ayni (chainId, adres) iki kaynakta FARKLI ondalikla geldiyse token listeden tamamen dusurulur: ondalik SilentSwap tutar
    // hesabina girer, iki kaynagin celismesi para ekraninda veri bozulmasi isaretidir. Sabit USDC ve yerel coin her zaman
    // kendi tekil nesnesine indigi icin bu kurala hic takilmaz.
    const conflicts = new Set()
    const stamp = (raw) => {
        if (!raw || typeof raw !== 'object') return null
        // Kanonik kimlikle karsilastirilir (Number() degil): true, [8453], '0x2105', '08453', ' 8453' gibi kanonik olmayan yazimlar
        // ag degildir (K4) ve secici agina damgalanip KALMAZ.
        if (raw.chainId !== undefined && raw.chainId !== null && canonicalChainId(raw.chainId) !== chain.chainId) return null
        return { ...raw, chainId: chain.chainId }
    }
    const push = (raw, extra = {}) => {
        const row = stamp(raw)
        if (!row) return
        let token
        try { token = normalizeDeliveryToken(row) } catch { return }
        if (isNativeDeliveryToken(token) && !nativeEnabled) return
        // Tokenlastirilmis hisse (bStocks/xStocks) gizli modda teslim edilemez: sunucu listesi ve ice aktarilanlardan ayiklanir (sahip karari 2026-10-23).
        if (isStockDeliveryToken(token.chainId, token.address)) return
        // Adres listelerinde (katalog + deliveryStocks.js) olmayan ama hisse ihraccisinin adini tasiyan satir ("<Sirket> xStock", "Backed <Sirket>"): sunucu
        // yarin yeni bir hisse getirirse de secicide gorunmez (ek ag; arka plan kapilari adres tabanli kalir, teklifte ad yok).
        if (hasStockIssuerMarker(cleanName(extra.name, ''))) return
        const key = deliveryTokenKey(token)
        const existing = byKey.get(key)
        if (existing) {
            if (existing.decimals !== token.decimals) conflicts.add(key)
            return
        }
        const entry = { ...token, name: cleanName(extra.name, token.symbol) }
        byKey.set(key, entry)
        out.push(entry)
    }
    if (nativeEnabled) push(nativeTokenOf(chain.chainId), { name: chain.nativeSymbol })
    push(usdcTokenOf(chain.chainId), { name: 'USD Coin' })
    const ats = chain.chainId === 56 ? ATS_CHAINS[56]?.token : null
    if (ats) push({ address: ats.address, symbol: ats.symbol, decimals: ats.decimals }, { name: ats.symbol })
    for (const t of Array.isArray(imported) ? imported : []) push(t, t)
    for (const t of Array.isArray(remote) ? remote : []) {
        if (t?.native === true) continue
        push(t, t)
    }
    const list = conflicts.size ? out.filter((t) => !conflicts.has(deliveryTokenKey(t))) : out
    const q = String(search || '').trim().toLowerCase()
    if (!q) return list
    return list.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q)
}
