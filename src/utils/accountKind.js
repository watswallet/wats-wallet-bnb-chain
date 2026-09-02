// Hesabin hangi zincirlere AIT oldugu — saf katman.
//
// chainKind.js "bu zincir nedir" sorusunu cevapliyor; bu dosya "bu HESAP hangi
// zincirlerde kullanilabilir" sorusunu. Ikisi ayri sorulardir: TON zinciri
// herkes icin TON'dur, ama TON ifadesiyle ice aktarilmis bir hesabin Ethereum'da
// KARSILIGI YOKTUR - o hesabin EVM anahtari hic uretilmemistir.
//
// Karar TEK yerde: gorunum kosullari (v-if) karar degildir. Bu dersin bedeli
// d75a6d5'te odendi - takas dugmesi Home.vue'da elle gizli kaldigi icin uctan
// uca calisan bir ozellik kullaniciya HIC gorunmedi.
//
// AG YOK, DEPO YOK.

import { isTon } from './chainKind'

/**
 * FAIL-OPEN. Hesap okunamadiysa `false` doner: acilista `active_account` bir an
 * bos olabiliyor ve o anda kilidi uygulamak butun aglari kapatirdi.
 */
export function isTonOnlyAccount(account) {
    return account?.type === 'ton'
}

export function accountSupportsChain(account, chainOrId) {
    if (!isTonOnlyAccount(account)) return true
    return isTon(chainOrId)
}

/**
 * Liste DEGISMIYORSA ayni referans doner — cagiran taraflar `computed` icinde
 * kullaniyor ve gereksiz bir kopya her seferinde yeniden render tetiklerdi.
 */
export function chainsForAccount(account, chains) {
    if (!isTonOnlyAccount(account)) return chains
    return chains.filter((c) => isTon(c))
}
