// Zincirin TIPI: EVM mi, TON mu — saf katman.
//
// Neden ayri dosya: bu kapi 8 dosyada okunuyor ve karari TEK yerde tutmak zorunlu.
// Kapi gevserse (or. "kind yoksa TON say") TON gonderim yolu EVM zincirlerine sizar
// ve kullanicinin parasi yanlis agda yayinlanir.
//
// AG YOK: yalnizca pakete gomulu JSON okunur. axios / pinia / chrome BILEREK disarida.

import supported_chains from '../data/supportedChains'
import { isSwapSupported } from './swapChains'

export const TON_MAINNET_ID = -239
export const TON_TESTNET_ID = -3

// Kayit listeden dusse bile TON kimlikleri TON kalir. Savunma amacli: zincir kaydini
// silen biri, sessizce TON'u "bilinmeyen EVM zinciri" haline getirmemeli.
const TON_IDS = new Set([TON_MAINNET_ID, TON_TESTNET_ID])

// kind degerinin case / whitespace varyasyonlarina karsi dayanikli. Yanlis yazilmis
// kind (ornegin 'TON', 'Ton', ' ton ') sessizce TON kaydini EVM'e dusmemeli.
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

// DISA AKTARILDI: accountKind.js hesabin destekledigi aile KUMESINI zincirin
// ailesiyle karsilastiriyor. Kopya bir siniflandirici yazilsaydi Solana gibi
// 'kind' yerine 'vm' tasiyan kayitlar iki yerde farkli cozulurdu.
export function kindOf(chainOrId) {
    if (chainOrId === null || chainOrId === undefined) return null

    if (typeof chainOrId === 'object') {
        // SOLANA ONCE. Solana kaydi `kind` DEGIL `vm` tasir (bkz. vm.js) ve chainId'si
        // METINDIR ('solana-mainnet'): asagidaki Number() yolu onu NaN'a cevirip null
        // dondururdu. null 'bilinmeyen' demektir ve isEvm'i false yapiyordu -- DOGRU
        // sonuc, YANLIS sebeple. Solana'yi ACIKCA adlandirmak, kaydin alanlari
        // degisirse sessizce EVM'e dusmesini engeller.
        if (norm(chainOrId.vm) === 'solana') return 'solana'
        if (typeof chainOrId.kind === 'string' && chainOrId.kind) return norm(chainOrId.kind)
        if (chainOrId.chainId === undefined || chainOrId.chainId === null) return null
        return kindOf(Number(chainOrId.chainId))
    }

    // METIN KIMLIKLI ZINCIR (Solana). Sayiya cevrilemez ama GECERSIZ de degildir:
    // kayit listesinde adiyla aranir. Bulunamazsa null (bilinmeyen) doner -- EVM'e
    // DUSURULMEZ: 'sayi degil' bilgisi zincirin var olmadigini kanitlamaz.
    const id = Number(chainOrId)
    if (!Number.isFinite(id)) {
        const byText = supported_chains.find((c) => String(c.chainId) === String(chainOrId).trim())
        if (!byText) return null
        return norm(byText.vm) === 'solana' ? 'solana' : (norm(byText.kind) || 'evm')
    }
    if (TON_IDS.has(id)) return 'ton'

    // Bilinmeyen zincir EVM'e duser: bugun calisan hicbir EVM akisi bu yuzden bozulmaz.
    const entry = supported_chains.find((c) => Number(c.chainId) === id)
    return norm(entry?.kind) || 'evm'
}

export function isTon(chainOrId) {
    return kindOf(chainOrId) === 'ton'
}

// EVM OLMAYAN, BILINEN tipler ACIKCA sayilir. Kosul 'ton degilse EVM' olarak
// birakilirsa, kindOf Solana'yi TANIR TANIMAZ Solana EVM sayilir ve swap/kopru/
// dapp kapilarinin HEPSI Solana'da acilirdi. (Solana bugune kadar yalnizca kindOf
// null dondurdugu icin disarida kaliyordu: dogru sonuc, YANLIS sebep -- ve o sebep
// bu dosyada Solana adlandirilir adlandirilmaz ortadan kalkti.)
// Bilinmeyen bir kind DEGERI hala EVM'e duser: dosyanin bas yorumundaki karar.
const NON_EVM_KINDS = new Set(['ton', 'solana'])

export function isEvm(chainOrId) {
    const kind = kindOf(chainOrId)
    return kind !== null && !NON_EVM_KINDS.has(kind)
}

export function isSolana(chainOrId) {
    return kindOf(chainOrId) === 'solana'
}

// Zincirin TIPI ile "o zincirde su AKIS calisir mi" ayri sorulardir. Ikincisi burada,
// cunku birincisi de burada: iki karari ayri evlere koymak ikinci bir gercek kaynak
// uretirdi ve bu dosyanin bas yorumu tam olarak bunu yasakliyor.
//
// KAPATILAN SORUN: swap/bridge'i TON'da gizleyen tek sey Home.vue'daki bir `v-if`ti.
// Gorunum kosulu bir KARAR degildir; kopru zincir secicileri, takas ekranindaki ag
// degistirici ve token secicileri onu atlayip TON'a gecebiliyordu. Karar artik tek
// yerde ve hem arayuz hem arka plan ayni tablodan okuyor.
export const FLOW = {
    SWAP: 'swap',
    BRIDGE: 'bridge',
    DAPP: 'dapp',
}

export function chainSupportsFlow(chainOrId, flow) {
    switch (flow) {
        // Takasin IKI AYRI motoru var ve kosullari da ayri:
        //
        // EVM: kendi entegrasyonumuz; zincir basina router/factory/quoter kontrat
        // adresleri swapChains.js'te. Orada kaydi olmayan bir zincirde takas kurulamaz.
        //
        // TON: STON.fi. Bir donem burada TON kosulsuz REDDEDILIYORDU ve dogruydu -
        // o zaman TON'da takas motoru YOKTU. Artik var (tasarim belgesi
        // 2026-08-26-ton-swap-bridge-design.md).
        //
        // TON dali isSwapSupported'a BAKMAZ ve bakmamali: o tablo Uniswap tarzi EVM
        // kontrat adresleri tutuyor, TON'un orada kaydi yok ve olmasi da gerekmiyor -
        // TON'da router SABIT DEGILDIR, her takasta teklif yanitindan gelir (spec §2.3).
        // Buraya isSwapSupported eklenirse takas TON'da sessizce kapali kalir.
        case FLOW.SWAP:
            return isTon(chainOrId)
                ? true
                : isEvm(chainOrId) && isSwapSupported(toChainId(chainOrId))

        // Kopru ucuncu taraf LI.FI uzerinden ve LI.FI EVM disi zincir TASIMIYOR
        // (canli /chains ucunda 69 zincirin tamami EVM, TON yok). Kosul BILEREK
        // yalnizca isEvm: zincirin rpc listesine bagli bir kosul, gecici bir veri
        // duzenlemesinde calisan bir kopruyu sessizce kapatabilirdi.
        //
        // TON KOPRUSU BILINCLI OLARAK KAPALI. Symbiosis TON'u destekliyor ama
        // NATIVE TON TASIMIYOR - yalnizca uc jetton (USDT, EVAA, DROPEE). "Kopru var"
        // diye sunulan ama kullanicinin Toncoin'ini tasimayan bir ozellik,
        // olmamasindan kotudur; kullanici bunu ancak deneyene kadar ogrenemez.
        // Karar ve olcum: tasarim belgesi §2.6 ve §7.
        case FLOW.BRIDGE:
            return isEvm(chainOrId)

        // Dapp yolu EIP-1193; TON'un hex chainId karsiligi yok (bkz. hexChainIdFor).
        case FLOW.DAPP:
            return isEvm(chainOrId)

        // FAIL-OPEN. Akis verilmemis ya da tanimadigimiz bir ad gelmisse kapi ACIK
        // kalir: yanlis yazilmis bir flow degeri, bugun calisan bir EVM ekranini
        // OLDURMEMELI. Cagiran taraftaki wiring testleri kapinin gercekten
        // baglandigini ayrica kilitliyor.
        default:
            return true
    }
}

function toChainId(chainOrId) {
    if (chainOrId && typeof chainOrId === 'object') return Number(chainOrId.chainId)
    return Number(chainOrId)
}
