// Zincirin SANAL MAKINESI (VM) — saf katman.
//
// AG YOK, DEPO YOK, chrome API'si YOK: yalnizca kendisine verilen zincir kaydini
// okur. Butun EVM'e ozel yollar (swap, kopru, ATS, EIP-1193) buradan gecer.

import { isTon } from './chainKind'

const SOLANA = 'solana'
const TON = 'ton'
const EVM = 'evm'

/**
 * Zincirin VM'i: 'solana' | 'ton' | 'evm'.
 *
 * `vm` alani OLMAYAN EVM kayitlari EVM sayilir. On EVM kaydinda bu alan yok;
 * varsayilani EVM yapmak onlarin hicbirine dokunmadan Solana'yi eklemeyi mumkun
 * kildi. Bilinmeyen bir `vm` degeri de EVM'e duser: bilinmeyeni ozel bir yola
 * sokmak, o yolun var olmadigi yerde sessiz cokme uretir.
 *
 * TON, chainKind.js'e SORULUR -- burada TEKRAR TANIMLANMAZ. Bu dosya ile
 * chainKind.js iki AYRI dalda (Solana ve TON) bagimsiz yazildi ve birlestikleri
 * an su tuzagi urettiler: TON kaydi `kind: 'ton'` tasir ama `vm` alani YOKTUR,
 * yani bu fonksiyon TON'a 'evm' derdi. Sonuc sessiz ve agirdi -- requireEvmVm
 * TON'u GECIRIR ve EIP-1193 dapp yolu TON'da acilirdi.
 *
 * Iki kapi, TEK dogru: tip sorusunun cevabi chainKind.kindOf'tadir; burasi onu
 * VM diline cevirir. Yeni bir zincir tipi eklendiginde DEGISECEK TEK YER orasi.
 */
export function chainVm(chain) {
    if (chain?.vm === SOLANA) return SOLANA
    if (isTon(chain)) return TON
    return EVM
}

/**
 * Bir degeri chainId olarak SAYIYA cevirir; cevrilemiyorsa NaN.
 *
 * Number()'a dogrudan guvenilemez: Number('') ve Number(null) 0, Number(true) 1
 * uretir. Bunlar chainId DEGILDIR ve kontrolsuz birakilirsa cozulememis bir
 * zincir, chainId 0 olan bir kayitla eslesir.
 */
function numericChainId(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value)
        return Number.isFinite(n) ? n : NaN
    }
    return NaN
}

/**
 * Zincir kimligi karsilastirmasi.
 *
 * EVM kimlikleri SAYI ve hem 1 hem '1' olarak dolasiyor; Solana'ninki bilerek
 * METIN ('solana-mainnet'). Sayisal yola yalnizca IKI TARAF DA sayiya
 * cevrilebiliyorsa girilir; aksi halde metin karsilastirmasi yapilir.
 */
export function isSameChainId(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false

    const na = numericChainId(a)
    const nb = numericChainId(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb

    return String(a) === String(b)
}

/**
 * Zincirin RPC url listesi.
 *
 * Solana kaydinda `rpc` BILEREK yok: boylece hicbir ethers.JsonRpcProvider Solana
 * icin acilamaz. Ama mevcut cagri noktalari `chain.rpc.map(...)` yaziyor ve Solana
 * secilince TypeError ile cokerlerdi. Bos dizi donmek, cagiranin dogal "hicbir RPC
 * yok" yoluna girmesini saglar.
 *
 * `rpc` hem dizi hem nesne olabiliyor (repairNetworkData mirasi) — ikisi de kabul.
 */
export function rpcUrlsOf(chain) {
    if (!chain || chainVm(chain) !== EVM || !chain.rpc) return []
    const list = Array.isArray(chain.rpc) ? chain.rpc : Object.values(chain.rpc)
    return list.map((r) => r?.url).filter(Boolean)
}

/**
 * KIMLIK KAPISI: "bu bir EVM zinciri mi" -- UC NOKTASI SORULMAZ.
 *
 * Arayuz bu dugmeleri Solana'da gizler ama background bir mesaji HER ZAMAN
 * alabilir (baska bir sekmeden, eski bir popup'tan, bir dapp'ten); sessizce
 * undefined.rpc[0] okumak yerine acik bir hata dondurulur.
 *
 * IKI AYRI KAPI OLMASININ NEDENI (kod incelemesi, olculdu): evmGates.js
 * bayraklari ZATEN ikiye ayiriyor -- swap/bridge zincirin KENDI RPC'sine
 * ihtiyac duyar, ats/buy/dapp DUYMAZ (bkz. evmGates.js'teki gerekce). Ama
 * background tarafinda tek bir kapi vardi ve o kapi UC NOKTASI da istiyordu:
 * `rpc` dizisi BOS olan GERCEK bir EVM kaydinda (yanlis girilmis/bosaltilmis
 * bir zincir) uc dapp giris noktasi da CHAIN_NOT_EVM donuyordu -- Task 15
 * ONCESINDE bu kayitla dapp NORMAL calisiyordu (0x89, onay penceresi acilirdi).
 * Yani arayuz "bu kayit dapp'e uygun" deyip Dapp.vue'ye yonlendirirken
 * background AYNI kaydi reddediyordu. Kimlik sorusu ile "bu zincirin RPC'si
 * yapilandirilmis mi" sorusu AYRI ariza modlaridir; ayri kapilar da oyle.
 */
export function requireEvmVm(chain) {
    if (!chain || chainVm(chain) !== EVM) {
        throw new Error('CHAIN_NOT_EVM')
    }
    return chain
}

/**
 * UC NOKTASI KAPISI: EVM zinciri VE en az bir RPC url'i.
 *
 * Yalnizca zincirin KENDI RPC'sini acacak yollar icin (swap, kopru, gonderim,
 * durum sorgusu, gasless secenekleri): bunlar `found.rpc[0].url` okur, yani
 * bos bir `rpc` dizisi kapinin ARKASINDA TypeError'a donusurdu.
 */
export function requireEvmChain(chain) {
    requireEvmVm(chain)
    if (rpcUrlsOf(chain).length === 0) {
        throw new Error('CHAIN_NOT_EVM')
    }
    return chain
}
