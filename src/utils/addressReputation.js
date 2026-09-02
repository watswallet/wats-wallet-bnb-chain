// Adres itibar sorgusu (kendi backend'imizdeki /wallet/reputation proxy'si uzerinden).
//
// TEK KURAL — FAIL-OPEN: bu dosyadaki hicbir hata yolu kullanicinin gonderimini
// engellemez. Itibar servisi en iyi cabadir; ulasilamadiginda "bilinmiyor" deriz,
// "tehlikeli" demeyiz. Ucuncu taraf bir servisin cuzdani kilitlemesi, engellemeye
// calistigimiz zarardan buyuk bir zarardir.

import axios from 'axios'
import { canonicalAddress } from './addressForm'

export const CLEAN_REPUTATION = Object.freeze({ severity: null, flags: [], sources: [] })

// Istemcinin TANIDIGI severity degerleri. Sunucu ileride baska bir sey dondurse bile
// bilmedigimiz bir degeri "engelle" diye yorumlamiyoruz.
const KNOWN_SEVERITIES = ['block', 'warn']

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// Onay ekranindaki dugme bu sorguyu bekliyor; sunucu tarafi zaten 4sn'de vazgeciyor,
// buradaki tavan onun biraz ustunde.
const TIMEOUT_MS = 5000

function stringsOnly(value) {
    return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []
}

export function normalizeReputation(payload) {
    if (!payload || typeof payload !== 'object') return { ...CLEAN_REPUTATION }
    if (!KNOWN_SEVERITIES.includes(payload.severity)) return { ...CLEAN_REPUTATION }

    return {
        severity: payload.severity,
        flags: stringsOnly(payload.flags),
        sources: stringsOnly(payload.sources)
    }
}

export async function fetchReputation(api, address) {
    if (!api || typeof address !== 'string') {
        return { ...CLEAN_REPUTATION }
    }

    const trimmed = address.trim()

    // Saglayici (GoPlus, server/controllers/reputationController.js uzerinden proxy'lenir)
    // Solana'yi DESTEKLEMIYOR: sunucu tarafinda da ADDRESS_RE ayni sekilde yalnizca
    // 0x-hex kabul ediyor, base58 gonderilirse 400 doner. Bunu sessizce "temiz" saymak
    // OLMAYAN bir guvence verir — kullanici kontrol edildigini sanir. Bu yuzden agsa
    // hic gidilmez, `unsupported: true` ile "bu agda itibar kontrolu yok" bilgisi
    // useAddressSecurity uzerinden ekrana tasinir.
    //
    // "Solana mi" sorusu addressForm.js'teki PAYLASILAN canonicalAddress()'e
    // sorulur — burada AYRI bir regex kopyasi tutulmaz (besinci bir ozel kopya,
    // agin kontrol edilip edilmeyecegine karar veren TAM DA bu dosyada, hicbir
    // sey tarafindan senkron tutulmazdi).
    if (canonicalAddress(trimmed)?.form === 'solana') {
        return { ...CLEAN_REPUTATION, unsupported: true }
    }

    // ADDRESS_RE BILEREK trim edilmemis girdiye uygulanir: davranis Adim 5'ten once
    // ne ise (bosluklu adres = ag cagrisi yok, sessiz temiz) ayni kalir.
    if (!ADDRESS_RE.test(address)) {
        return { ...CLEAN_REPUTATION }
    }

    try {
        const { data } = await axios.post(
            `${api}/wallet/reputation`,
            { address },
            { timeout: TIMEOUT_MS }
        )

        if (!data?.success) return { ...CLEAN_REPUTATION }

        return normalizeReputation(data.reputation)
    } catch (e) {
        console.warn('Adres itibari sorgulanamadi:', e.message)
        return { ...CLEAN_REPUTATION }
    }
}
