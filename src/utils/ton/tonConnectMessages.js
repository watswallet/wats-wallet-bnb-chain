// TonConnect `sendTransaction` istegini COZUMLEME ve DOGRULAMA -- saf katman.
//
// Buradaki her kapi IMZADAN ONCE calisir. Sonra calisan bir kontrol, kullanicinin
// ONAYLADIGI seyle IMZALANAN sey arasinda fark birakir -- bu farkin bedeli para.
//
// AG YOK, chrome YOK.

import { TON_MAINNET_ID, TON_TESTNET_ID } from '../chainKind'

export const MAX_MESSAGES = 4
const BAD_REQUEST = 1

const err = (message) => ({ ok: false, code: BAD_REQUEST, message })

/**
 * Cuzdanin TonConnect'e bildirecegi ag kimligi.
 *
 * TonConnect aktif agdan BAGIMSIZ (K3): kullanici Ethereum'da dururken de bir TON
 * dapp'ine baglanabilir ve o durumda TON kimligi MAINNET'tir. Testnet YALNIZCA
 * kullanici acikca TON testnet'e gectiyse secilir -- "EVM disi her sey testnet"
 * gibi bir sezgi, gercek parayi test agina yollamanin yolu olurdu.
 */
export function tonNetworkId(currentNetwork) {
    return Number(currentNetwork?.chainId) === TON_TESTNET_ID
        ? String(TON_TESTNET_ID)
        : String(TON_MAINNET_ID)
}

function parseRaw(rawParams) {
    // Kopru tarafinda TonConnect params'i JSON METIN olarak tasiyabiliyor.
    // Iki bicimi de kabul etmek, "bazi dapp'lerde calisiyor" hatasinin onunu keser.
    if (typeof rawParams !== 'string') return rawParams
    try { return JSON.parse(rawParams) } catch (e) { return null }
}

// nanoton POZITIF TAM SAYI. '1.5' ya da '-5' BigInt'e cevrilirken patlar ya da
// (daha kotusu) sessizce yuvarlanip zincirde BASKA bir deger olur.
const isNanoAmount = (v) => /^\d+$/.test(v) && BigInt(v) >= 0n

/**
 * @param {object|string} rawParams
 * @param {{nowSec: number, walletNetwork: string}} ctx
 */
export function validateSendTransactionRequest(rawParams, { nowSec, walletNetwork } = {}) {
    const raw = parseRaw(rawParams)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('Malformed sendTransaction params')

    if (raw.network !== undefined && raw.network !== null && String(raw.network) !== String(walletNetwork)) {
        return err('Requested network does not match the wallet network')
    }

    let validUntil = null
    if (raw.valid_until !== undefined && raw.valid_until !== null) {
        const vu = Number(raw.valid_until)
        if (!Number.isFinite(vu)) return err('valid_until is not a number')
        // GECMIS bir valid_until'i imzalamak anlamsiz: islem zincirde zaten
        // reddedilir, ama kullaniciya bir onay ekrani gostermis oluruz. Ekrani
        // ACMADAN reddetmek dogru olan.
        if (vu <= Number(nowSec)) return err('Request expired')
        validUntil = vu
    }

    const list = raw.messages
    if (!Array.isArray(list) || list.length === 0) return err('messages must be a non-empty array')
    if (list.length > MAX_MESSAGES) return err('Too many messages')

    const messages = []
    for (const m of list) {
        if (!m || typeof m !== 'object') return err('Malformed message')
        const address = typeof m.address === 'string' ? m.address.trim() : ''
        if (!address) return err('Message address is missing')

        // Sayi TIPI amount'de: JSON.parse zaten BUYUK SAYILARI yanlislastirir
        // (2^53 usteri), ve bu noktada ORIJINAL DEGER KURTARILAMIYOR. Sessizce
        // yanlis imzalamak olurdu -- REDDETMEK tek dofru secenektir.
        if (typeof m.amount === 'number' && !Number.isSafeInteger(m.amount)) {
            return err('Message amount out of safe integer range')
        }

        const amountRaw = typeof m.amount === 'number' ? String(m.amount) : String(m.amount ?? '').trim()
        if (!isNanoAmount(amountRaw)) return err('Message amount must be a non-negative integer in nanotons')

        messages.push({
            address,
            amountNano: amountRaw,
            // payload/stateInit BOC'tur ve BU KATMAN ONU COZMEZ. Cozebiliyormus
            // gibi davranmak, onay ekraninda uydurma bir ozet gostermek olurdu.
            payload: typeof m.payload === 'string' && m.payload ? m.payload : null,
            stateInit: typeof m.stateInit === 'string' && m.stateInit ? m.stateInit : null,
        })
    }

    return { ok: true, validUntil, messages }
}
