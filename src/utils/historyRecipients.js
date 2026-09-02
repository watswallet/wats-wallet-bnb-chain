// Islem gecmisinden "karsi taraf" adreslerini cikarir.
//
// Neden gerekli: zehirli adres tespiti yalnizca TANIDIGIN adreslere benzerlik arar. Adres
// defterine kaydetmedigin, bu cihazdan hic gondermedigin ama gecmiste islem yaptigin bir
// adres (sana odeme yapan biri, baska bir cihazdan yaptigin gonderim) bu kumede yoktu —
// onun ikizi uyari uretmiyordu.
//
// TEHLIKE: zehirleme yemi de GECMISTEDIR. Gecmisi ayirt etmeden guvenilir saymak korumayi
// TERSINE CEVIRIR — sahte adres "tanidik" olur ve sessizce gecer, gercek adres uyari verir.
// Buradaki kural bu yuzden yone gore ayrisir:
//   - GONDERDIGIM adres: guvenilir. O adresi ben sectim; tutari onemsiz.
//   - GELEN odeme: yalnizca tutar SIFIRDAN BUYUKSE. Yemin klasik teslimati 0 degerli
//     transferdir; sifir tutarli bir gelen transfer hicbir zaman "tanidik" sayilmaz.
//
// Ucuncu ve dorduncu valf burada DEGIL, addressPoisoning.buildTrustedList'te: guvenilen
// bir adrese benzeyen aday ve birbirine benzeyen iki aday orada elenir.
//
// EVM'e ozel DEGILDIR: adres karsilastirmasi addressForm.js'teki PAYLASILAN
// canonicalAddress()'e dayanir, bu yuzden Solana (base58) adresleri de dogru
// islenir — HARF KASASI KORUNARAK (kucultulmez).
//
// Solana AYRI bir saglayicidan (Helius, sunucudaki POST /solana/history uzerinden)
// besleniyor — bu uc ZATEN yayinda ve testli (server/test/solanaHistory.test.js).
// EVM'in /wallet/history'si Moralis sekli doner, Solana'ninki TAMAMEN FARKLI bir
// sekil (Helius zenginlestirilmis islem): ikisini AYNI ayristiriciyla okumak
// mumkun degil, bu yuzden fetchHistoryCounterparties chainId'ye gore dallanir.
//
// KOD INCELEMESI (Task 13, onemli 4): Solana tarafi solana/historyRow.js'teki
// toHistoryRow()'u KULLANMAZ. O bir GOSTERIM yardimcisidir — TEK islemi TEK
// satira indirger (`tokenTransfers` tercih edilir, sonra ILK `nativeTransfer`);
// coklu-bacakli bir islemde (Solana'da swap/routed islemlerde YAYGIN) diger
// gercek karsi taraflari SESSIZCE dusurur, hatta sifir tutarli bir token bacagi
// "kazanip" ardindan sifir-valfine takilarak asil (gercek tutarli) native
// bacagini TAMAMEN gizleyebilir. Guvenlik yolu bu yuzden EVM'deki extractHistoryCounterparties
// ile AYNI desende KENDI ayristiricisina sahiptir: HER bacagi (native + token) gezer.
// toHistoryRow yalnizca DISPLAY (History.vue) icin kalir.

import axios from 'axios'
import { dedupeKey } from './addressForm'
import { isSameChainId } from './vm'
import { SOLANA_CHAIN_ID, LAMPORTS_PER_SOL } from './solana/constants'
import { fetchSolanaHistory } from './solana/history'

function isRealAmount(value) {
    if (value === null || value === undefined || value === '') return false
    const n = Number(value)
    return Number.isFinite(n) && n > 0
}

export function extractHistoryCounterparties(history, myAddress) {
    const me = dedupeKey(myAddress)
    if (!Array.isArray(history) || !me) return []

    const seen = new Set()
    const list = []

    for (const tx of history) {
        const transfers = [
            ...(Array.isArray(tx?.erc20_transfers) ? tx.erc20_transfers : []),
            ...(Array.isArray(tx?.native_transfers) ? tx.native_transfers : [])
        ]

        for (const transfer of transfers) {
            const outgoing = transfer?.direction === 'send'

            // Gelen tarafta tutar SIFIRSA adres alinmaz: yem tam olarak boyle gelir.
            if (!outgoing && !isRealAmount(transfer?.value_formatted)) continue

            const raw = outgoing ? transfer?.to_address : transfer?.from_address
            // form+key ile anahtarlanir: farkli bicimdeki (EVM/Solana) adresler asla
            // ayni anahtara dusmez, base58 KUCULTULMEZ (bkz. addressForm.js).
            const key = dedupeKey(raw)
            if (!key || key === me || seen.has(key)) continue

            seen.add(key)
            list.push({ address: raw, label: null, source: 'history' })
        }
    }

    return list
}

// Bir Helius transfer bacagini (nativeTransfers/tokenTransfers ogesi) karsi
// taraf/yon/tutara cevirir; myAddress'i ILGILENDIRMEYEN ya da kendine olan
// bacaklar icin null doner. SAF: EVM'deki transfer donguculugunun (asagida)
// Solana bicimindeki karsiligi — toHistoryRow'un aksine TEK bir "ilk eslesen"
// ile YETINMEZ, cagiran HER bacak icin ayri ayri cagirir.
function solanaLeg(transfer, myAddress, isToken) {
    const from = transfer?.fromUserAccount
    const to = transfer?.toUserAccount
    if (typeof from !== 'string' || typeof to !== 'string') return null
    if (from !== myAddress && to !== myAddress) return null
    // Kendine transfer (ATA acma gibi) ne giden ne gelen: guvenilir SAYILMAZ.
    if (from === to) return null

    const outgoing = from === myAddress
    const amount = isToken ? Number(transfer.tokenAmount) : Number(transfer.amount) / LAMPORTS_PER_SOL
    return { outgoing, counterparty: outgoing ? to : from, amount }
}

// Solana: Helius zenginlestirilmis islem kaydinin HER bacagini (nativeTransfers
// + tokenTransfers) gezer — bkz. dosya basindaki "onemli 4" notu: toHistoryRow
// yalnizca ILK eslesen bacagi alir, coklu-bacakli bir islemde diger gercek karsi
// taraflari kaybederdi. Ayni iki valf EVM'deki gibi burada da uygulanir:
//   - kendine transfer guvenilir SAYILMAZ
//   - GELEN odeme yalnizca tutar SIFIRDAN BUYUKSE alinir
// addressPoisoning.buildTrustedList'teki iki EK valf (benzeyen aday elenir,
// birbirine benzeyen iki aday birbirini goturur) zaten form-farkinda oldugu
// icin degismeden, buraya da uygulanir.
export function extractSolanaHistoryCounterparties(history, myAddress) {
    if (!Array.isArray(history) || typeof myAddress !== 'string' || myAddress.length === 0) return []

    const seen = new Set()
    const list = []

    for (const raw of history) {
        const native = Array.isArray(raw?.nativeTransfers) ? raw.nativeTransfers : []
        const token = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []

        const legs = [
            ...token.map(t => solanaLeg(t, myAddress, true)),
            ...native.map(t => solanaLeg(t, myAddress, false))
        ].filter(Boolean)

        for (const leg of legs) {
            // Gelen tarafta tutar SIFIRSA/GECERSIZSE adres alinmaz: yem tam olarak boyle gelir.
            if (!leg.outgoing && !isRealAmount(leg.amount)) continue

            // form+key ile anahtarlanir, base58 KUCULTULMEZ (bkz. addressForm.js).
            const key = dedupeKey(leg.counterparty)
            if (!key || seen.has(key)) continue

            seen.add(key)
            list.push({ address: leg.counterparty, label: null, source: 'history' })
        }
    }

    return list
}

// Gonderim akisinda cagrilir; sunucu tarafinda 30sn/(Solana'da) 30sn onbellekli.
// HER hata yolu bos liste doner: gecmis alinamadiginda tespit diger kaynaklarla
// calismaya devam eder, kullanici durmaz.
export async function fetchHistoryCounterparties(api, address, chainId) {
    if (!api || !dedupeKey(address) || !chainId) return []

    // Yonlendirme adres BICIMINE degil, cagiranin bildirdigi chainId'ye gore
    // yapilir: chainId zaten dogru bilgiyi tasiyor, adres bicimine tekrar bakmak
    // (ki zaten dedupeKey ile yukarida bakildi) gereksiz bir ikinci tahmin olurdu.
    if (isSameChainId(chainId, SOLANA_CHAIN_ID)) {
        try {
            const raw = await fetchSolanaHistory(address)
            return extractSolanaHistoryCounterparties(raw, address)
        } catch (e) {
            console.warn('Solana gecmis karsi taraflari alinamadi:', e.message)
            return []
        }
    }

    try {
        const { data } = await axios.post(
            `${api}/wallet/history`,
            { address, chainId },
            { timeout: 6000 }
        )

        if (!data?.success || !Array.isArray(data.history)) return []

        return extractHistoryCounterparties(data.history, address)
    } catch (e) {
        console.warn('Gecmis karsi taraflari alinamadi:', e.message)
        return []
    }
}
