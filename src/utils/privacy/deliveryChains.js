// GIZLI MOD TESLIM AGLARI TABLOSU (gizli-mod cok-ag spec 4.1, K6, E19).
//
// POPUP, ARKA PLAN VE YAPILANDIRMA DOSYASININ (manifest.config.js) ORTAK, SAF modulu: HICBIR SEY IMPORT ETMEZ.
// Ne `@silentswap/*` (popup'a gecisli ulasmalarini privatePopupImports.test.js yasaklar), ne silentswap.js /
// privateOrderExec.js, ne de `import.meta.env`: manifest.config.js Node'da calisir ve orada import.meta.env yoktur.
// Ortami okuyan taraf deliveryChainSetting.js'tir.
//
// Tablo teslim aglarinin TEK kaynagidir. SDK kayit defteri (SOURCE_CHAINS), supported_chains.json, ATS_CHAINS,
// swapChains CHAIN_CONFIG ve sunucunun Aktivite tablosu elle esit tutulan kopyalardir; deliveryChains.test.js
// esitligi kilitler (11. ag hepsine dokunur). Satir sirasi SECICI SIRASIDIR ve BSC ilk satirdir (varsayilan ag).
//
// `route` (cex-direct / deposit-bridge) sunucunun secimidir ve degisebilir: yalniz bilgi olarak durur, pinlenmez ve
// ekranda gosterilmez. `activityServer`, sunucunun /wallet/history icin ag destegidir (server/controllers/
// walletController.js CHAINS): ozel modda desteklenmeyen agda gereksiz istek atilmaz (spec 4.7).
// `defaultAsset` (P1): BSC'de USDC (alt proje 1'den beri); oteki aglarda yerel coin, cunku fonlu kanit yerel
// coindedir (D2). Bir agda USDC teslimi canli defterde "gecti" olunca o satir 'usdc' yapilir (ayni commit'te defter
// satiri anilir).

export const BSC_DELIVERY_CHAIN_ID = 56

const chain = (chainId, name, nativeSymbol, usdcAddress, usdcDecimals, defaultAsset, activityServer, route) => Object.freeze({
    chainId, name, nativeSymbol, nativeDecimals: 18, usdcAddress, usdcDecimals,
    logo: `/chains/${chainId}.png`, defaultAsset, activityServer, route,
})

export const DELIVERY_CHAINS = Object.freeze([
    chain(56, 'BNB Smart Chain', 'BNB', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18, 'usdc', true, 'deposit-bridge'),
    chain(1, 'Ethereum', 'ETH', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 'native', true, 'cex-direct'),
    chain(8453, 'Base', 'ETH', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6, 'native', true, 'cex-direct'),
    chain(42161, 'Arbitrum One', 'ETH', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6, 'native', true, 'cex-direct'),
    chain(10, 'Optimism', 'ETH', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6, 'native', true, 'deposit-bridge'),
    chain(137, 'Polygon', 'POL', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6, 'native', true, 'deposit-bridge'),
    chain(100, 'Gnosis', 'XDAI', '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0', 6, 'native', false, 'cex-direct'),
    chain(42220, 'Celo', 'CELO', '0xcebA9300f2b948710d2653dD7B07f33A8B32118C', 6, 'native', false, 'deposit-bridge'),
    chain(5000, 'Mantle', 'MNT', '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9', 6, 'native', false, 'deposit-bridge'),
    chain(25, 'Cronos', 'CRO', '0x3D7F2C478aAfdB65542BCB44bCeeC05849999d2D', 6, 'native', false, 'deposit-bridge'),
])

export const DELIVERY_CHAIN_IDS = Object.freeze(DELIVERY_CHAINS.map((c) => c.chainId))
const BY_ID = new Map(DELIVERY_CHAINS.map((c) => [c.chainId, c]))

// KANONIK kimlik: pozitif tamsayi ya da kanonik ondalik dizge. '08453', ' 8453', '0x2105', 8453.5 kabul edilmez:
// ayni agin farkli yazimlari para yolunda ayni karari vermelidir (K4: sessiz donusum yok).
const CANONICAL_ID_RE = /^[1-9]\d{0,14}$/
export function canonicalChainId(raw) {
    if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null
    if (typeof raw === 'string' && CANONICAL_ID_RE.test(raw)) return Number(raw)
    return null
}

export function deliveryChainOf(raw) {
    const id = canonicalChainId(raw)
    return id === null ? null : (BY_ID.get(id) ?? null)
}

// Varsayilan teslim varligi (P1). PRIVATE_DEST_NATIVE (silentswapConfig.js) kapaliysa yerel coin secilemeyecegi
// icin her agda USDC'ye duser; cagiran bayragi `nativeEnabled` olarak verir (bu modul ortam okumaz).
export function defaultAssetOf(chainId, nativeEnabled) {
    const entry = deliveryChainOf(chainId)
    if (!entry) return null
    return nativeEnabled === true && entry.defaultAsset === 'native' ? 'native' : 'usdc'
}

// Derleme listesi ayristirici (spec 4.2 kural 2). Degisken yok ya da bos -> o liste icin HICBIR ag acik degil
// (BSC dahil; fail-closed). Gecerli ogeler tablo sirasiyla ve tekil `ids`'e gider; kanonik olmayan, tabloda olmayan
// ve bos ('56,,1' ya da sondaki virgul) ogeler `invalid`'e: derleme kapisi (manifest.config.js) bunlari her modda reddeder.
export function parseDeliveryChains(raw) {
    const found = new Set()
    const invalid = []
    if (typeof raw === 'string' && raw.trim() !== '') {
        for (const part of raw.split(',')) {
            const item = part.trim()
            const id = CANONICAL_ID_RE.test(item) ? Number(item) : null
            if (id !== null && BY_ID.has(id)) found.add(id)
            else invalid.push(item)
        }
    }
    return { ids: DELIVERY_CHAIN_IDS.filter((id) => found.has(id)), invalid }
}

export const LIST_VIOLATION = Object.freeze({
    FUND_NOT_IN_SEND: 'fund-not-in-send',
    FUND_NEEDS_BSC: 'fund-needs-bsc',
    FUND_NO_SEND_SOURCE: 'fund-no-send-source',
})

// Iki listenin degismezleri (spec 4.2 kural 3 + 1.10 teslim degismezi). Donus ihlal kodlari listesidir, gecerliyse bos.
//  (a) Para yukle listesi Gonder listesinin altkumesidir.
//  (b) Para yuklede BSC disi bir ag varsa 56 da Para yuklededir (BSC kapaliysa BSC disi aglara hic ulasilamaz; Gizli Hesap'a para
//      yuklenemeyen surum cikmaz, manifest.config.js).
//  (c) Para yuklede her agin en az bir Gonder kaynagi vardir (`sendSourceChains`): Gizli Hesap'a teslim edilen varlik yalniz Gonder ile
//      cikabilir (uretimde ATS satisi ve gizli modda Takas/Kopru kapali; gelistirmede kendine Takas/Kopru ciktilari da ayni kuraldadir); Gonder kaynagi olmayan bir aga yuklenen para icerde kilitli
//      kalirdi. Eski ATS satin alma yolu sarti (FUND_NEEDS_ATS_SALE) kalkti. Ihlal ag basina degil, TEK kez raporlanir.
//      `sendSourceChains` = Gonder kaynagi olan zincir kimlikleri dizisi; iki cagiran (deliveryChainSetting.js, manifest.config.js) onu
//      hasPrivateSendSource (privateBridgedSources.js, SDK'siz) ile KENDISI hesaplayip acikca verir. Bu modul saftir ve hicbir sey import
//      etmez, bu yuzden gizli bir varsayilan YOKTUR; verilmeyen ya da dizi olmayan deger "hicbir agin Gonder kaynagi yok" sayilir.
export function checkDeliveryLists(send, fund, sendSourceChains) {
    const sendIds = new Set(Array.isArray(send) ? send : [])
    const fundIds = Array.isArray(fund) ? fund : []
    const withSource = new Set(Array.isArray(sendSourceChains) ? sendSourceChains : [])
    const violations = []
    if (fundIds.some((id) => !sendIds.has(id))) violations.push(LIST_VIOLATION.FUND_NOT_IN_SEND)
    const beyondBsc = fundIds.some((id) => id !== BSC_DELIVERY_CHAIN_ID)
    if (beyondBsc && !fundIds.includes(BSC_DELIVERY_CHAIN_ID)) violations.push(LIST_VIOLATION.FUND_NEEDS_BSC)
    if (fundIds.some((id) => !withSource.has(id))) violations.push(LIST_VIOLATION.FUND_NO_SEND_SOURCE)
    return violations
}
