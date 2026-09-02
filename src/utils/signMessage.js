import { ethers } from 'ethers'

/**
 * personal_sign (EIP-191) yuku 0x on ekli bir hex string ise, imzalanmasi gereken sey
 * o hex'in KODLADIGI baytlardir - hex metninin kendisi degil. ethers'a string verilirse
 * onu UTF-8 olarak imzalar, yani "0x48656c6c6f" 12 karakterlik metin olarak imzalanir;
 * dapp ise 5 baytlik "Hello" bekler ve ecrecover baska bir adres dondurur.
 *
 * Hex olmayan yukler (cuzdan icindeki EditUsername mesaji gibi) eskisi gibi UTF-8 metin
 * olarak imzalanir. MetaMask de ayni geriye donuk uyumu uygular.
 */
// ethers.isHexString TEK haneli uzunluklari da kabul eder ('0x123'), ama getBytes
// bunlari reddeder. Cift uzunluk sarti olmadan tek sayili bir yuk imzalama akisini
// tamamen cokertirdi; boyle bir yuk EIP-191 hex'i degildir, metin olarak imzalanir.
function isDecodableHex(message) {
    return ethers.isHexString(message) && message.length % 2 === 0
}

export function normalizePersonalSignMessage(message) {
    if (typeof message !== 'string') return message
    if (!isDecodableHex(message)) return message
    return ethers.getBytes(message)
}

/**
 * Onay ekraninda gosterilecek metin. Kullanici imzaladigi seyi okuyabilmeli:
 * hex yuk cozulup insan tarafindan okunabilir metne cevrilir. Cozulemiyorsa
 * (ikili veri) ham hex gosterilir - uydurma bir metin gostermek yanlis olur.
 */
export function decodePersonalSignMessage(message) {
    if (typeof message !== 'string') return message
    if (!isDecodableHex(message)) return message
    try {
        return ethers.toUtf8String(message)
    } catch {
        return message
    }
}
