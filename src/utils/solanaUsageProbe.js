// Solana kullanim yoklamasi: bir adres "kullanilmis" mi (hesap taramasi icin, O6 Faz 1).
//
// "Kullanilmis" = SOL bakiyesi > 0 VEYA (SOL 0 ve) herhangi bir SPL token hesabinda
// amount > 0. Seed import'unda turetilmis hesaplari bulmak icin accountScan.js bunu
// indeks indeks cagirir (EVM tarafindaki evmUsageProbe.js'in Solana karsiligi).
//
// SOZLESME: ASLA firlatmaz; sonuc 'used' | 'unused' | 'failed'.
//   - 'used'   : getBalance.value > 0, ya da SOL 0 iken getTokenAccountsByOwner
//                yanitinda amount > 0 olan bir hesap var.
//   - 'unused' : her iki cagri da yanit verdi ve hicbirinde bakiye yok.
//   - 'failed' : SOL cagrisi hata/429/zaman asimi/iptal; YA DA SOL 0 iken token
//                cagrisi hata verdi (or. canli SOLANA_RPC_URL 403'u) veya yanit
//                bozuk geldi; YA DA yoklama iptal edildi.
//
// NEDEN token hatasi 'unused' DEGIL: bilinmeyen durum bos sayilirsa SPL tasiyan
// hesaplar sessizce "kullanilmamis" olur ve tarama ardisik 3 bos indekste durur.
// 'failed' taramayi DURDURMAZ (Gorev 26, patron karari R26-1; ayrinti accountScan.js
// ust notu): tarama-yerel bayrakla ayni taramada Solana bir daha yoklanmaz, EVM
// taramasi surer ve sonuc 'solana_incomplete' (kismi) olur; bulunanlar korunur.
//
// Devre kesici/fabrika YOK: tekrar cagriyi engelleyen sey accountScan.js'teki
// tarama-yerel bayraktir, bu modul durum tutmaz.
//
// Chrome 115: `AbortSignal.any` yok; iptal solanaRpc'in kendi sinyal baglamasina
// birakilir (istek GERCEKTEN kesilir).
import { solanaRpc } from './solana/client'
import { TOKEN_PROGRAM_ID } from './solana/constants'

// Tek bir JSON-RPC cagrisi icin ust sure (evmUsageProbe ile ayni).
const PROBE_CALL_TIMEOUT_MS = 4000

// SPL "amount" u64 dizge olarak gelir; BigInt ile karsilastirilir (Number yuvarlamasi yok).
function positiveRawAmount(raw) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return false
    return BigInt(raw) > 0n
}

export async function probeSolanaAddress(address, { signal, timeoutMs = PROBE_CALL_TIMEOUT_MS, rpc = solanaRpc } = {}) {
    try {
        // Yarim yoklama 'unused' sayilamaz; zaten iptalse agi hic rahatsiz etme.
        if (signal?.aborted) return 'failed'

        const sol = await rpc('getBalance', [address], { signal, timeoutMs })
        const lamports = sol?.value
        // Bozuk/eksik yanit: bilinmeyen durum, 'unused' degil.
        if (typeof lamports !== 'number' || !Number.isFinite(lamports) || lamports < 0) return 'failed'
        if (lamports > 0) return 'used'

        // SOL cagrisi sirasinda iptal edildiyse token cagrisini baslatma.
        if (signal?.aborted) return 'failed'

        const spl = await rpc(
            'getTokenAccountsByOwner',
            [address, { programId: TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }],
            { signal, timeoutMs }
        )
        const rows = spl?.value
        if (!Array.isArray(rows)) return 'failed'

        for (const row of rows) {
            if (positiveRawAmount(row?.account?.data?.parsed?.info?.tokenAmount?.amount)) return 'used'
        }
        return 'unused'
    } catch {
        return 'failed'
    }
}
