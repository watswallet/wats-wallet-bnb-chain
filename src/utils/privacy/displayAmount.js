import { formatUnits } from 'ethers'
import { PAYOUT_CHAIN_ID } from './silentswapConfig'

// Gosterim yardimcilari (inceleme karti + siparis listesi). Saf islevler: bilesenden bagimsiz test edilir.

const DISPLAY_DECIMALS = 6
const TINY = '<0.000001'

// Ham birimi (wei benzeri dizge) ondalikli dizgeye cevirir; bozuksa null.
export function formatRawAmount(raw, decimals) {
    try {
        return formatUnits(raw, decimals)
    } catch {
        return null
    }
}

// Uzun ondalik kuyrugu gosterim icin keser (YUVARLAMAZ: gosterilen tutar asla gercekten fazla olmaz).
// Dondurur { text, exact, trimmed }: exact her zaman tam deger (title ozniteligi icin).
// Gecersiz girdi (dizge degil, sayi bicimi disi) oldugu gibi, trimmed false doner.
export function trimAmount(value, maxDecimals = DISPLAY_DECIMALS) {
    const exact = value == null ? '' : String(value)
    const m = /^(\d+)(?:\.(\d+))?$/.exec(exact)
    if (!m || !m[2] || m[2].length <= maxDecimals) return { text: exact, exact, trimmed: false }
    const cut = m[2].slice(0, maxDecimals).replace(/0+$/, '')
    const isZero = /^0*$/.test(m[1]) && cut === ''
    const text = isZero ? TINY : (cut ? `${m[1]}.${cut}` : m[1])
    return { text, exact, trimmed: true }
}

// "Odeyecegin" satiri: tek kaynak (kart ve PrivateTransfer ayni karari verir).
//  1) dogrudan rotada (kaynak zincir = gateway zinciri ve kaynak varlik USDC): gateway toplami
//     "<totalUsdc> USDC" (yatirma tutari tam olarak odur); totalUsdc yoksa null
//  2) koprulu rotada sourceInput bicimlenebiliyorsa "<tutar> <varlik>"
//  3) aksi halde null: gosterilemiyor, onay KAPALI olmali (fail-closed)
// source: { chainId, asset } teklif aninda DONDURULMUS kaynak; canli girdi degil.
export function payAmountLabel(quote, source) {
    const direct = Number(source?.chainId) === Number(PAYOUT_CHAIN_ID) && source?.asset === 'USDC'
    const total = quote?.totalUsdc
    const totalOk = typeof total === 'string' && /^\d+(\.\d+)?$/.test(total)
    // Dogrudan rotada yatirma tutari kendi formatUsdc(quote.amount) degerimizdir ve tek dogru
    // kaynaktir; sourceInput.decimals sunucu yankisidir ve rakami olcekleyebilir (21 ondalik
    // 1000 USDC'yi "1.0" gosterir). Bu yuzden sourceInput yalniz totalUsdc ile AYNI sayiysa
    // gecerli sayilir, farkliysa (ya da hic yoksa) totalUsdc gosterilir; o da yoksa null.
    if (direct) return totalOk ? `${total} USDC` : null
    const si = quote?.sourceInput
    if (si?.amount) {
        const amount = formatRawAmount(si.amount, si.decimals)
        if (amount !== null && si.asset) return `${amount} ${si.asset}`
    }
    return null
}
