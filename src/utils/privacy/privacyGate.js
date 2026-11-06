import { isPrivateAccount, findPrivateAccount, PRIVATE_ACCOUNT_PATH } from './privateAccount'
import { TYPED_DATA_USER_REJECT_MESSAGE } from '../eip712/errors'
import { PRIVATE_ATS_SALE, PRIVATE_SWAP_BRIDGE } from '../featureFlags'

// GIZLI MOD KAPISI -- saf karar (spec 6). Dagitici (background.js) baglami depodan
// TAZE okuyup buraya verir; bu dosya chrome API'si BILMEZ.
//
// SINIFLANDIRMA KILIDI: background.js switch'indeki HER case asagidaki uc kumeden
// TAM BIRINDE olmak zorunda (privacyGate.test.js switch'i tarar). Yeni bir aksiyon
// siniflandirilmadan eklenirse test kirilir -- kapiyi sessizce atlayamaz.

// Hesap ile IMZA ATMAYAN, para HAREKET ETTIRMEYEN ve hesap adresini bir dapp'e
// ACMAYAN aksiyonlar: oturum islemleri, ayar/yardimci aksiyonlar ve yalniz adres
// okuyan sorgular (ATS_FEE_QUOTE, ATS_FUEL_BALANCE, ATS_PRIVATE_FEE_QUOTE). Imzalayan ya da zincire islem
// gonderen bir aksiyon BURAYA GIRMEZ (CONDITIONAL'a girer).
// ATS_PRIVATE_FEE_QUOTE: ATS_SWAP/BRIDGE_FEE_QUOTE createWalletInstance ile anahtari ACAR (kosullu);
// bu ise yalniz saklanan tekliften kaynak hesabin ADRESINI okur, anahtar acmaz, imza atmaz.
// PRIVATE_PROVIDER_INFO: SilentSwap durum okumasinin ozeti (ucret orani, limitler, musaitlik); yalniz sayilar, adres yok.
// CONNECT_WALLET_REJECTED: "Gizli moddasin" popup'i bekleyen dapp istegini bununla
// reddeder; gizli modda da calismak zorunda.
// wallet_addEthereumChain: hesap gerektirmez, her iki modda da ayni 4200 cevabini
// alir; gizli modda farkli bir ret sayfaya modu sizdirirdi.
// TON_DAPP_REQUEST_STATE: yalniz cuzdan arayuzunun "bekleyen istek kaydi hala bir pencerede mi"
// sorusu (kapat-yalniz TonConnect ekrani); hesap, imza ve adres tasimaz. Gizli moda gecis bekleyen
// istekleri iptal eder; ekran bu soruyu iki modda da cevaplayabilmeli.
export const ALWAYS_ALLOWED = new Set([
    'CHECK_UNLOCK', 'UNLOCK_WALLET', 'LOCK', 'SET_UI_MODE', 'HEARTBEAT',
    'CHAIN_CHANGED', 'ACCOUNT_CHANGED',
    'DISCONNECT_DAPP', 'DISCONNECT_TON_DAPP', 'DISCONNECT_SOLANA_DAPP',
    'CHECK_TX_STATUS', 'TON_DAPP_REQUEST_STATE',
    'ATS_FUEL_BALANCE', 'ATS_FEE_QUOTE', 'ATS_PRIVATE_FEE_QUOTE', 'PRIVATE_PROVIDER_INFO',
    'eth_chainId', 'solana_disconnect', 'wallet_addEthereumChain',
    'PRIVACY_MODE_SET', 'CONNECT_WALLET_REJECTED',
])

// Karari imzaci / alici / zincir belirler. ATS_RUN_ONBOARDING (BSC'de sponsorlu islem),
// GASLESS_TOKEN_OPTIONS (bundler'a hesap adresiyle imzali istek) ve (YALNIZ normal modda) iki ATS ucret
// teklifi (anahtari SWAP_QUOTE gibi acar) cozulen hesapla calisir; imzaci baglamda
// ZORUNLU (yoksa PRIVATE_CHECK_FAILED). Gizli kimlikte klasik alti ad (SWAP_BRIDGE_ACTIONS, asagida: SWAP,
// SWAP_QUOTE, BRIDGE, BRIDGE_QUOTE ve iki ATS ucret teklifi) bunlardan ONCE, imzaci ve zincir OKUNMADAN
// PRIVATE_SWAP_BRIDGE_CLOSED ile kesilir. ISTISNA: PRIVATE_ACTIONS (gizli siparis) kendi
// karar dalina sahiptir; cozulemeyen imzaci / teklif orada PRIVATE_UNSUPPORTED olur.
// SIGN_TYPED_DATA_CONFIRM: SIGN'in ikizi (eth_signTypedData_v4 onay ekraninin imzalat aksiyonu);
// mesaj `account` tasir, imzaci o (ya da aktif hesap) olarak cozulur.
export const CONDITIONAL = new Set([
    'SWAP', 'SWAP_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE', 'SEND_TRANSACTION', 'SIGN', 'SIGN_TYPED_DATA_CONFIRM',
    'ATS_RUN_ONBOARDING', 'GASLESS_TOKEN_OPTIONS', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE',
    'PRIVATE_QUOTE', 'PRIVATE_ORDER', 'PRIVATE_ORDERS', 'PRIVATE_REFUND',
    // ATS satin alma (K13, cok-ag spec 4.5 madde 2): Gizli Hesap KENDI BSC varliklariyla gizli modda ATS alabilir. Kapi
    // imzaciyi isleyicinin kendi resolveAccount'uyla cozer (zincir ATS_SALE_CHAIN_ID sabitinden: privacyChainIdFor).
    // Eslesmeyen her durum PRIVATE_ATS_SALE_BLOCKED'a eslenir (privacyDecision sarmalayicisi); BLOCKED_IN_PRIVATE'a ya da
    // ALWAYS_ALLOWED'a GERI TASINMAZ. PRIVATE_ATS_SALE kapaliyken gizli modda imzaciya bakilmadan engel (bugunku yanit).
    'ATS_SALE_QUOTE', 'ATS_SALE_EXECUTE',
])

// Normal modda serbest, gizli modda engelli (dapp'ler ve EVM disi zincirler).
export const BLOCKED_IN_PRIVATE = new Set([
    'SOLANA_GET_ADDRESS', 'SOLANA_SEND', 'SOLANA_CONNECT_IDENTITY',
    'SOLANA_DAPP_SIGN_TX', 'SOLANA_DAPP_SIGN_MESSAGE',
    'SEND_TON_TRANSACTION', 'SEND_TON_JETTON', 'TON_DAPP_SEND', 'TON_DAPP_SIGN',
    'TON_FEE_IDENTITY', 'TON_SWAP_FEE_ACTION', 'TON_CONNECT_IDENTITY',
    'eth_requestAccounts', 'eth_accounts', 'eth_sendTransaction', 'personal_sign',
    'wallet_switchEthereumChain',
    // WalletConnect 1.8.3 ile gelen dapp yuzeyi (gizli modda her site "bagli degil" gorunur):
    // eth_signTypedData_v4 = personal_sign ikizi (4100, popup yok); wallet_getPermissions
    // `[]` (aktif hesap Gizli Hesap iken dapps[host].accounts KAMU hesaplari tutar, caveat'ta
    // kamu adresi sizardi); wallet_revokePermissions etkisiz `null` (hibe silinmez, olay gitmez).
    'eth_signTypedData_v4', 'wallet_getPermissions', 'wallet_revokePermissions',
    // xStocks (CoW Al/Sat) gizli modda KAPALI (sahip karari 2026-10-16): CoW emri Gizli adresi CoW'a IP ile
    // gosterir, gizli modda fiyat istekleri kapali ve xStocks "fiyat yoksa kilit" der. Sekiz ad da BURADA olmak
    // ZORUNDA (siniflandirma kilidi); COW_* mesajlari gizli modda isleyiciye ulasmaz (bu yoldan CoW calisma
    // zamani kurulmaz; alarm yoklayicisi ayridir ve o da ozel modda durur: background.js pollCowOrdersSafe),
    // normal modda kapidan gecerler.
    // Yeni bir COW_ adi da buraya girer (privacyGate.test.js COW_ ailesi kilidi).
    'COW_QUOTE', 'COW_PLACE_ORDER', 'COW_APPROVE_QUOTE', 'COW_APPROVE_EXECUTE', 'COW_ORDERS_REFRESH',
    // Faz 3 ATS ucreti + iade (origin/main 2a8acd4): kasayi acar, aktif hesabin ATS bakiyesinden ucret op'u imzalar
    // (PAY / APPROVE_CHANGE) ya da emir/iade kayitlarini doner (STATUS); ayni sahip karari, ayni kapi.
    'COW_FEE_STATUS', 'COW_FEE_PAY', 'COW_FEE_APPROVE_CHANGE',
    'tonconnect_connect', 'tonconnect_restore', 'tonconnect_send',
    'solana_connect', 'solana_signMessage', 'solana_signIn',
    'solana_signTransaction', 'solana_signAndSendTransaction',
])

// Gizli siparis aksiyonlari (Plan 2). Kendi karar dali var (privateActionDecision).
// Her ad ayrica CONDITIONAL'da bulunmak ZORUNDA (siniflandirma kilidi, privacyGate.test.js)
// ve messageGate INTERNAL_ACTIONS'ta yazili olmak ZORUNDA (messageGate.test.js): ikisinden
// biri eksikse test kirilir, yani yeni bir ad iki kumeye birden girmeden eklenemez.
export const PRIVATE_ACTIONS = new Set(['PRIVATE_QUOTE', 'PRIVATE_ORDER', 'PRIVATE_ORDERS', 'PRIVATE_REFUND'])

// Gizli SIPARIS ailesinin (PRIVATE_QUOTE/ORDER/ORDERS/REFUND) kapi yanit kodlari ile bayrak ve
// fail-closed kesmelerinin kodlari (bu kodlar icin TEK kaynak): privateActionDecision, privacyDecision'in
// fail-closed / EVM_ONLY dallari, dagiticinin bayrak kesmesi (DISABLED) ve fail-closed (CHECK_FAILED)
// bunlari kullanir; testler bu kodlari elle tutulan bir listeden degil buradan alir.
// KAPSAM DISI (bilerek duz dizge): siparis ailesi disindaki genel mod kapisinin eski kodlari
// (PRIVATE_ACCOUNT_IN_PUBLIC_MODE, RECIPIENT_IS_PRIVATE, PRIVATE_DAPP_BLOCKED, PRIVATE_USE_PRIVATE_SEND,
// PRIVATE_SIGNER_MUST_BE_PRIVATE) privacyDecision'da, handlePrivacyModeSet'teki 'PRIVACY_DISABLED' ve
// dagiticidaki PRIVATE_DAPP_BLOCKED karsilastirmasi background.js'te yazilidir; davranis degismedi.
export const PRIVATE_GATE_CODES = Object.freeze({
    MODE_OFF: 'PRIVACY_MODE_OFF',
    UNSUPPORTED: 'PRIVATE_UNSUPPORTED',
    EVM_ONLY: 'PRIVATE_EVM_ONLY',
    SAME_ADDRESS: 'PRIVATE_SAME_ADDRESS',
    TRANSFER_TARGET: 'PRIVATE_TRANSFER_TARGET',
    CHECK_FAILED: 'PRIVATE_CHECK_FAILED',
    DISABLED: 'PRIVACY_DISABLED',
    // ATS alimi icin "bu alim bu modda/imzaciyla yapilamaz" kodu (K13: Gizli Hesap'in KENDI alimi disindaki her durum;
    // PRIVATE_ATS_SALE kapaliyken gizli modda her durum): kapi dogrudan mesaji bu kodla keser, arka planin takas erken
    // dali (assertSaleSignerAllowed) ayni kodu `error` alanina yazar.
    ATS_SALE_BLOCKED: 'PRIVATE_ATS_SALE_BLOCKED',
    // Gizli modda KLASIK Takas/Kopru (ve ATS ucret teklifleri) PRIVATE_SWAP_BRIDGE degerinden BAGIMSIZ kapali; gizli yol SilentSwap ekranlaridir
    // (PRIVATE_QUOTE / PRIVATE_ORDER). Yalniz cuzdanin KENDI arayuzune donen ic yanitta kalir.
    SWAP_BRIDGE_CLOSED: 'PRIVATE_SWAP_BRIDGE_CLOSED',
})

// Gizli kimlik icin bayraktan bagimsiz reddedilen KLASIK aksiyonlar: takas/kopru ile bunlarin ATS ucret teklifleri
// (ATS_PRIVATE_FEE_QUOTE gizli siparisin teklifidir, burada DEGIL). Hepsi CONDITIONAL'da kalir (geri tasinmaz).
const SWAP_BRIDGE_ACTIONS = new Set(['SWAP', 'SWAP_QUOTE', 'BRIDGE', 'BRIDGE_QUOTE', 'ATS_SWAP_FEE_QUOTE', 'ATS_BRIDGE_FEE_QUOTE'])

// ATS satin alma mesajlari: CONDITIONAL'da olup ATS_SALE_ onekini tasiyan HER ad. Liste ayrica TUTULMAZ: ucuncu bir
// ATS_SALE_* adi CONDITIONAL'a eklenince sessizce PRIVATE_EVM_ONLY / PRIVATE_SIGNER_MUST_BE_PRIVATE almasin (T28 M5, K13).
const ATS_SALE_PREFIX = 'ATS_SALE_'
const isAtsSaleAction = (action) => typeof action === 'string' && action.startsWith(ATS_SALE_PREFIX) && CONDITIONAL.has(action)
// Bu ailede genel CONDITIONAL kodlari tek kodda toplanir: arayuz (Swap.vue) yalniz PRIVATE_ATS_SALE_BLOCKED'i bilir ve
// onu "private-blocked" kartina cevirir; baska kod "sonuc bilinmiyor" yoluna dusup olmamis bir alimin olmus olabilecegini
// soylerdi. PRIVATE_CHECK_FAILED ESLENMEZ (genel CONDITIONAL dongu testi onu bekler; kabul edilen nadir artik, spec 4.5).
const ATS_SALE_REMAPPED_CODES = new Set(['PRIVATE_ACCOUNT_IN_PUBLIC_MODE', 'PRIVATE_SIGNER_MUST_BE_PRIVATE', PRIVATE_GATE_CODES.EVM_ONLY])

const EVM_DAPP_METHODS = new Set([
    'eth_requestAccounts', 'eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4',
    'wallet_switchEthereumChain',
])

// EIP-2255 izin yontemleri: onay penceresi acmazlar, cevaplari EVM_USER_REJECT degil
// privacyBlockResponse / dagitici ozel durumlariyla verilir.
const PERMISSION_METHODS = new Set(['wallet_getPermissions', 'wallet_revokePermissions'])

// Gizli modda engellenince kullaniciya "Gizli moddasin" popup'i acilan istekler.
// YALNIZ normal modun da BAGLI OLMAYAN bir siteye popup actigi iki metot: gizli modda
// her site "bagli degil" gorunur (eth_accounts [], sign/send aninda 4100 -- bkz.
// respondPrivacyBlock). Sign/send burada OLMAZ: bagli bir siteye popup, bagli olmayana
// 4100 vermek modu sizdirirdi (eth_accounts [] + popup normal modda HICBIR durumla
// uretilemez).
export const POPUP_DAPP_METHODS = new Set([
    'eth_requestAccounts', 'wallet_switchEthereumChain',
])

const isDappAction = (action) =>
    EVM_DAPP_METHODS.has(action) || PERMISSION_METHODS.has(action) || action.startsWith('tonconnect_') || action.startsWith('solana_')

// 0x oneki ve harf boyutu duyarsiz: oneksiz yazilmis 40 hex adres de ayni adrestir
// (yoksa Gizli Hesap'a dogrudan gonderim engeli "0x" silinerek asilirdi). Bos / yalniz
// "0x" asla eslesme sayilmaz.
const normAddress = (a) => (typeof a === 'string' ? a.trim().toLowerCase().replace(/^0x/, '') : '')
export const sameAddress = (a, b) => {
    const x = normAddress(a)
    return x !== '' && x === normAddress(b)
}

// Normal modda yukunde Gizli adres aranan aksiyonlar: sayfadan gelen uc islem/imza metodu ve onay sonrasi
// SEND_TRANSACTION. wallet_sendCalls icin arka planda ISLEYICI YOK (default: 4200), yani imza yolu da yok.
const PAYLOAD_SCANNED_ACTIONS = new Set(['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'SEND_TRANSACTION'])

const isObject = (v) => v !== null && typeof v === 'object'

// TUREME YOLU KANONIK BICIMI (A-M2). ethers `m/` onekini ve onde sifirli sayilari
// ("m/44'/60'/0'/01/0", "m/044'/60'/0'/1/0") ayni anahtara cevirir; duz metin
// karsilastirmasi bu yazimlari kacirirdi. Onek istege bagli, sayilar tamsayi, sertlestirme
// isareti (' / h / H) tek bicime iner. Cozulemeyen yol null: hicbir seyle eslesmez.
export function normalizeDerivationPath(path) {
    if (typeof path !== 'string') return null
    const parts = path.trim().split('/')
    if (parts[0] === 'm' || parts[0] === 'M') parts.shift()
    if (parts.length === 0) return null
    const out = []
    for (const part of parts) {
        const m = /^(\d+)(['hH]?)$/.exec(part)
        if (!m) return null
        out.push(`${Number(m[1])}${m[2] ? "'" : ''}`)
    }
    return out.join('/')
}

const PRIVATE_PATH_CANON = normalizeDerivationPath(PRIVATE_ACCOUNT_PATH)

// Kasadaki Gizli Hesap kaydina KIMLIKLE eslesme (bayrak DEGIL): ayni adres (0x'li/0x'siz,
// harf duyarsiz), ayni key ya da ayni (kanonik) turetme yolu. createWalletInstance
// anahtari bu alanlardan cozer. Kayit bilinmiyorsa (ctx.privateAccount / privateAddress
// yok) eslesme de olamaz.
function matchesStoredPrivate(account, ctx) {
    if (!isObject(account)) return false
    const stored = isObject(ctx?.privateAccount) ? ctx.privateAccount : null
    if (sameAddress(account.address, ctx?.privateAddress ?? stored?.address)) return true
    if (account.key && stored?.key && account.key === stored.key) return true
    return !!stored && PRIVATE_PATH_CANON !== null && normalizeDerivationPath(account.derivationPath) === PRIVATE_PATH_CANON
}

// "Bu hesap Gizli Hesap mi" sorusu KIMLIKLE cevaplanir (TEK KURAL; arka planin her
// yeri -- kapi, duyuru -- bunu kullanir): `private` bayragi YETERLI (fail-closed), ama
// tek yol DEGIL; kasadaki kayitla eslesen her hesap da Gizli Hesap'tir.
export function isPrivateIdentity(account, ctx) {
    if (!isObject(account)) return false
    if (isPrivateAccount(account)) return true
    return matchesStoredPrivate(account, ctx)
}

// "Imzaci Gizli Hesap mi" TEK kural: kasadaki kayit biliniyorsa YALNIZ kayit eslesmesi
// sayilir (bayrak almis bir genel hesap Gizli Hesap'in ayricaligini alamaz: bir ATS islemini
// genel anahtarla imzalatir ya da fon kuralini asardi); kayit bilinmiyorsa `private` bayragi
// gecerlidir (fail-closed kimlik). Gizli siparis, ATS_RUN_ONBOARDING, GASLESS_TOKEN_OPTIONS ve
// ATS_SALE_* ayni kurali kullanir (klasik takas/kopru adlari imzaciya hic gelmeden kesilir).
export function signerIsThePrivateAccount(signer, ctx) {
    const storedKnown = isObject(ctx?.privateAccount) || !!ctx?.privateAddress
    return storedKnown ? matchesStoredPrivate(signer, ctx) : isPrivateIdentity(signer, ctx)
}

// Kasalar listesinden kapi baglami (yalniz Gizli Hesap kismi). Arka plan ve dappFunctions
// ayni sekilde kursun diye tek yerde.
export function privateContextFrom(vaults) {
    const stored = findPrivateAccount(vaults)?.account || null
    return { privateAccount: stored, privateAddress: stored?.address || null }
}

export function privacyNeedsCheck(action) {
    return CONDITIONAL.has(action) || BLOCKED_IN_PRIVATE.has(action) || PRIVATE_ACTIONS.has(action)
}

// Gizli siparis karari (spec 6.2). Cozulemeyen imzaci / cikti PRIVATE_UNSUPPORTED:
// hala bir ENGEL (yalniz null izin verir), ama kullaniciya "dogrulanamadi" yerine
// dogru neden gosterilir. Imzaci, kasadan anahtarla ya da saklanan tekliften cozulmus
// hesaptir (checkPrivacy); sayfanin gonderdigi bir nesne degildir.
function privateActionDecision(action, ctx) {
    const C = PRIVATE_GATE_CODES
    // Gizli mod = aktif hesap Gizli Hesap (kimlikle); ayri bir "acik" bayragi yok.
    if (!isPrivateIdentity(ctx.activeAccount, ctx)) return { block: C.MODE_OFF }
    // Liste ve iade: kaynak siparis kaydindan, iade imzacisi isleyicide denetlenir.
    if (action === 'PRIVATE_ORDERS' || action === 'PRIVATE_REFUND') return null
    const signer = isObject(ctx.signer) ? ctx.signer : null
    // Once kaynak ve cikti: teklif yoksa zincir de bilinmez ve kullanici yaniltici
    // bir "yalniz EVM" mesaji gorurdu.
    if (!signer?.address || !ctx.outputAddress) return { block: C.UNSUPPORTED }
    if (ctx.chainKind !== 'evm') return { block: C.EVM_ONLY }
    // Ayni adrese donus gizlilik saglamaz (spec 2, "ayni adres tuzagi"). TEK ISTISNA (kendine Takas/Kopru, SilentSwap):
    // PRIVATE_SWAP_BRIDGE acik VE imzaci Gizli Hesap VE cikti kasadaki BILINEN Gizli Hesap adresi. Kasadaki adres bilinmiyorsa
    // istisna isleyemez ve engel kalir (fail-closed); genel hesabin kendine donusu ve imzacinin adresi kasadakinden farkliysa
    // imzacinin kendi adresine donusu istisna DEGILDIR.
    const privateAddress = ctx.privateAddress ?? ctx.privateAccount?.address
    const selfSwap = PRIVATE_SWAP_BRIDGE && signerIsThePrivateAccount(signer, ctx) && sameAddress(ctx.outputAddress, privateAddress)
    if (!selfSwap && sameAddress(ctx.outputAddress, signer.address)) return { block: C.SAME_ADDRESS }
    // Gizli modda genel hesap YALNIZ Gizli Hesap'a aktarabilir (fon, spec 4.2 akis 2);
    // Gizli Hesap kaynaksa (gonderim) cikti serbest.
    if (!signerIsThePrivateAccount(signer, ctx) && !sameAddress(ctx.outputAddress, privateAddress)) return { block: C.TRANSFER_TARGET }
    return null
}

// Dis API: ATS_SALE_* ailesinde genel kararin kodlarini PRIVATE_ATS_SALE_BLOCKED'a esler (K13).
export function privacyDecision(action, ctx) {
    const decision = baseDecision(action, ctx)
    if (decision?.block && isAtsSaleAction(action) && ATS_SALE_REMAPPED_CODES.has(decision.block)) {
        return { block: PRIVATE_GATE_CODES.ATS_SALE_BLOCKED }
    }
    return decision
}

function baseDecision(action, ctx) {
    if (!privacyNeedsCheck(action)) return null
    // FAIL-CLOSED: baglam yoksa karar verilemez, islem YAPILMAZ. activeAccount'un
    // yoklugu ise engel DEGIL (aktif hesap yok = normal mod; onboarding oncesi
    // eth_accounts sorgusu calismali).
    if (!isObject(ctx)) return { block: PRIVATE_GATE_CODES.CHECK_FAILED }
    // PRIVATE_ATS_SALE KAPALI: gizli modda ATS_SALE_* imzaciya BAKILMADAN bugunku yaniti alir (imzaci cozulemese de).
    if (isAtsSaleAction(action) && !PRIVATE_ATS_SALE && isPrivateIdentity(ctx.activeAccount, ctx)) {
        return { block: PRIVATE_GATE_CODES.ATS_SALE_BLOCKED }
    }
    // Gizli modda klasik Takas/Kopru ve ATS ucret teklifleri bayraktan bagimsiz reddedilir: PRIVATE_SWAP_BRIDGE bu dala GIRMEZ
    // (bayrak yalniz SilentSwap ekranlarini ve privateActionDecision'daki dar SAME_ADDRESS istisnasini acar). Imzaciya BAKILMADAN
    // kesilir (imzaci cozulemese ya da zincir turu bilinmese de). Normal mod bu dala girmez.
    if (SWAP_BRIDGE_ACTIONS.has(action) && isPrivateIdentity(ctx.activeAccount, ctx)) {
        return { block: PRIVATE_GATE_CODES.SWAP_BRIDGE_CLOSED }
    }
    // Gizli siparis: genel CONDITIONAL imzaci kuralindan ONCE (kendi kodlari var).
    if (PRIVATE_ACTIONS.has(action)) return privateActionDecision(action, ctx)
    // Imzalayan aksiyonda imzaci cozulemediyse de karar verilemez (iki modda da).
    if (CONDITIONAL.has(action) && !isObject(ctx.signer)) return { block: PRIVATE_GATE_CODES.CHECK_FAILED }
    const privateMode = isPrivateIdentity(ctx.activeAccount, ctx)
    const signerIsPrivate = isPrivateIdentity(ctx.signer, ctx)

    if (!privateMode) {
        if (signerIsPrivate) return { block: 'PRIVATE_ACCOUNT_IN_PUBLIC_MODE' }
        // ctx.txTo: islemin `to` alani. Gizli Hesap bir EOA'dir; ona giden HER cagri
        // (cagri verisi taninmayan bir selector tasisa da) iki hesabi zincirde baglar.
        // Cozulmus alici (recipient: ERC-20 transfer vb.) kontrolu AYRICA durur.
        if (action === 'SEND_TRANSACTION'
            && (sameAddress(ctx.recipient, ctx.privateAddress) || sameAddress(ctx.txTo, ctx.privateAddress))) {
            return { block: 'RECIPIENT_IS_PRIVATE' }
        }
        // dApp yuku (eth_sendTransaction / personal_sign / eth_signTypedData_v4) ya da onay sonrasi islem:
        // Gizli adres yukun HERHANGI bir yerinde (router calldata'si, permit spender'i, imzalanan metin) gecemez.
        // ctx.payloadHasPrivate dagiticida privateAddressScan ile hesaplanir (ham 20 bayt, harf duyarsiz).
        // Ret sayfaya normal kullanici reti (4001) olarak gider; popup ve ag istegi HIC acilmaz.
        if (PAYLOAD_SCANNED_ACTIONS.has(action) && ctx.payloadHasPrivate === true) {
            return { block: 'RECIPIENT_IS_PRIVATE' }
        }
        return null
    }

    if (BLOCKED_IN_PRIVATE.has(action)) {
        // eth_accounts ve wallet_getPermissions: hibesiz bir sitenin normal cevabi `[]`.
        if (action === 'eth_accounts' || action === 'wallet_getPermissions') return { respond: { result: [] } }
        if (action === 'tonconnect_send' && ctx.tonMethod === 'disconnect') return null
        return { block: isDappAction(action) ? 'PRIVATE_DAPP_BLOCKED' : PRIVATE_GATE_CODES.EVM_ONLY }
    }

    if (action === 'SEND_TRANSACTION' || action === 'SIGN' || action === 'SIGN_TYPED_DATA_CONFIRM') return { block: 'PRIVATE_USE_PRIVATE_SEND' }
    // Gizli modda buraya yalniz ATS_RUN_ONBOARDING, GASLESS_TOKEN_OPTIONS ve (PRIVATE_ATS_SALE aciksa) ATS_SALE_QUOTE / ATS_SALE_EXECUTE ulasir
    // (klasik takas/kopru adlari yukarida kesilir); kural imzaci ve zincir uzerinden uygulanir. Normal modda bu satir SWAP / SWAP_QUOTE / BRIDGE / BRIDGE_QUOTE icin hic calismaz (yukaridaki normal mod dali doner).
    if (ctx.chainKind !== 'evm') return { block: PRIVATE_GATE_CODES.EVM_ONLY }
    // Gizli modda "imzaci Gizli Hesap olmali" kurali KIMLIKLE uygulanir: kasadaki kayit
    // biliniyorsa yalniz `private` bayragi tasiyan bir nesne YETMEZ (bayrak almis bir
    // genel hesap swap'i genel anahtarla imzalatirdi). Kayit bilinmiyorsa bayrak gecerli.
    if (!signerIsThePrivateAccount(ctx.signer, ctx)) return { block: 'PRIVATE_SIGNER_MUST_BE_PRIVATE' }
    return null
}

// ONAY SONUCU KANALI (A-C1). Popup'in "onayladim / reddettim" yanitlari switch'e girmez
// (messageGate INTERNAL_RESPONSES, dagiticinin `ignoredResponses` dali) ama bekleyen dapp
// istegini COZER; yani sayfaya giden cevabi kuran SON halka budur ve kapidan gecmek
// zorundadir. Siniflandirma kilidi (privacyGate.test.js) INTERNAL_RESPONSES'in her adinin
// TAM BIR kumede olmasini sart kosar.
//   CHECKED: sonucu sayfaya gider; gizli modda ya da Gizli Hesap adresi tasiyorsa RET olur.
//   PASSTHROUGH: zaten bir ret (sonuc tasimaz); gizli modda da calismak zorunda
//   ("Gizli moddasin" popup'i istegi bununla reddeder).
export const APPROVAL_RESULTS_CHECKED = new Set(['SIGN_MESSAGE_SUCCESS', 'CONNECT_WALLET_SUCCESS', 'SEND_TX_SUCCESS'])
export const APPROVAL_RESULTS_PASSTHROUGH = new Set(['SIGN_MESSAGE_REJECTED', 'CONNECT_WALLET_REJECTED', 'SEND_TX_REJECTED'])

// Sonucun icinde (derinlemesine, sinirli) Gizli Hesap adresi geciyor mu?
function mentionsPrivateAddress(value, privateAddress, depth = 0) {
    if (depth > 6 || value === null || value === undefined) return false
    if (typeof value === 'string') return sameAddress(value, privateAddress)
    if (Array.isArray(value)) return value.some((v) => mentionsPrivateAddress(v, privateAddress, depth + 1))
    if (isObject(value)) return Object.values(value).some((v) => mentionsPrivateAddress(v, privateAddress, depth + 1))
    return false
}

// Onay ekraninin NORMAL "kullanici reddetti" cevabi (ekran turune gore; metinler
// ConnectDapp / SwitchChain / Dapp / Sign / Solana ekranlarinin kendi retleriyle ayni).
// TON ekranlari retlerini baska sekilde gonderir; onlar icin pencere kapatma cevabi
// (dappFunctions.js onRemoved ile ayni nesne) kullanilir.
export function approvalRejectionFor(requestType) {
    const t = typeof requestType === 'string' ? requestType : ''
    if (t.startsWith('TON_')) return { code: 4001, message: 'User closed the window.' }
    if (t.startsWith('SOLANA_')) return { code: 4001, message: SOLANA_USER_REJECT }
    if (t === 'SEND_TX') return { code: 4001, message: EVM_USER_REJECT.eth_sendTransaction }
    if (t === 'SIGN_MESSAGE') return { code: 4001, message: EVM_USER_REJECT.personal_sign }
    if (t === 'SIGN_TYPED_DATA') return { code: 4001, message: EVM_USER_REJECT.eth_signTypedData_v4 }
    if (t === 'SWITCH_CHAIN') return { code: 4001, message: EVM_USER_REJECT.wallet_switchEthereumChain }
    return { code: 4001, message: EVM_USER_REJECT.eth_requestAccounts }
}

// Saf karar: { reject: true } ise cagiran sonucu RETTE cevirir ve dapps kaydindan Gizli
// Hesap adresini temizler. ctx = { activeAccount, privateAccount, privateAddress }.
export function approvalResultDecision(action, message, ctx) {
    if (!APPROVAL_RESULTS_CHECKED.has(action)) return { reject: false }
    if (!isObject(ctx)) return { reject: true }
    if (isPrivateIdentity(ctx.activeAccount, ctx)) return { reject: true }
    if (ctx.privateAddress && mentionsPrivateAddress(message?.data, ctx.privateAddress)) return { reject: true }
    return { reject: false }
}

// dapps kaydindan Gizli Hesap adresini temizler (A-C1): hesap listesinden cikarir, baska
// hesap kalmadiysa kaydin TAMAMINI siler. { dapps, changed } doner; girdi degismez.
export function scrubPrivateAddress(dapps, privateAddress) {
    if (!isObject(dapps) || !privateAddress) return { dapps, changed: false }
    const next = {}
    let changed = false
    for (const [hostname, record] of Object.entries(dapps)) {
        const accounts = isObject(record) && Array.isArray(record.accounts) ? record.accounts : null
        if (!accounts || !accounts.some((a) => sameAddress(a, privateAddress))) {
            next[hostname] = record
            continue
        }
        changed = true
        const kalan = accounts.filter((a) => !sameAddress(a, privateAddress))
        if (kalan.length > 0) next[hostname] = { ...record, accounts: kalan }
    }
    return { dapps: next, changed }
}

// SAYFAYA donen retler cuzdanin NORMAL "kullanici reddetti" cevaplariyla BAYT BAYT
// aynidir (kodlar ve metinler mevcut isleyicilerden alindi: ConnectDapp.vue,
// SwitchChain.vue, Dapp.vue, Sign.vue, SolanaConnectApprove.vue, tonDappFunctions.js).
// content.js response.error'u sayfaya aynen iletir; "gizli mod" ya da PRIVATE_ kodu
// tasiyan bir ret, herhangi bir sitenin kullanicinin Gizli Hesap'ta oldugunu
// ogrenmesine yol acardi. PRIVATE_* kodu yalniz cuzdanin KENDI arayuzune donen
// (ic aksiyon) yanitlarda kalir.
const EVM_USER_REJECT = {
    eth_requestAccounts: 'User rejected the connection',
    wallet_switchEthereumChain: 'User rejected the chain switch',
    eth_sendTransaction: 'Transaction cancelled by user.',
    personal_sign: 'Sign Request cancelled by user.',
    // personal_sign'in metni DEGIL: SignTypedData.vue'nun kendi reti (eip712/errors.js, tek kaynak).
    eth_signTypedData_v4: TYPED_DATA_USER_REJECT_MESSAGE,
}
const SOLANA_USER_REJECT = 'User rejected the request.'
const TON_USER_REJECT = 'User rejected the request'

// action: engellenen aksiyon. code: PRIVATE_* nedeni (yalniz ic yanitlara yazilir,
// sayfaya ASLA). request: gelen istek mesaji (tonconnect_send icin params[0].id).
export function privacyBlockResponse(action, code, request) {
    if (EVM_DAPP_METHODS.has(action)) {
        return { error: { code: 4001, message: EVM_USER_REJECT[action] || SOLANA_USER_REJECT } }
    }
    if (action === 'eth_accounts' || action === 'wallet_getPermissions') return { result: [] }
    if (action === 'wallet_revokePermissions') return { result: null }
    if (action.startsWith('solana_')) {
        return { error: { code: 4001, message: SOLANA_USER_REJECT } }
    }
    if (action === 'tonconnect_connect' || action === 'tonconnect_restore') {
        return { result: { event: 'connect_error', id: Date.now(), payload: { code: 300, message: TON_USER_REJECT } } }
    }
    if (action === 'tonconnect_send') {
        return { result: { error: { code: 300, message: TON_USER_REJECT }, id: request?.params?.[0]?.id } }
    }
    if (action.startsWith('SOLANA_')) return { error: code }
    return { success: false, error: code }
}
