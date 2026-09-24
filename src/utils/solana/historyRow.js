import { LAMPORTS_PER_SOL } from './constants'

/**
 * Saglayici yanitini gecmis satirina cevirir — SAF katman.
 *
 * Adresler KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir ve kucultulen bir
 * adres, zehirli adres tespitinde BASKA bir adres olur.
 */
export function toHistoryRow(raw, myAddress) {
    if (!raw || typeof raw !== 'object') return null
    if (typeof myAddress !== 'string' || myAddress.length === 0) return null

    const native = Array.isArray(raw.nativeTransfers) ? raw.nativeTransfers : []
    const token = Array.isArray(raw.tokenTransfers) ? raw.tokenTransfers : []

    // Kullaniciyi ILGILENDIREN ilk transfer. Transferi olmayan islemler (oy,
    // program cagrisi) listeden dusurulur: anlam ifade etmeyen yuzlerce satir
    // gercek gonderileri gozden kacirir.
    const tokenHit = token.find(t => t.fromUserAccount === myAddress || t.toUserAccount === myAddress)
    const nativeHit = native.find(t => t.fromUserAccount === myAddress || t.toUserAccount === myAddress)
    const hit = tokenHit || nativeHit
    if (!hit) return null

    const isToken = hit === tokenHit
    const from = hit.fromUserAccount
    const to = hit.toUserAccount

    // Kendine transfer (ATA acma gibi) ne giden ne gelen: yanlis ok gostermektense
    // ayri isaretlenir.
    const direction = from === to ? 'self' : (from === myAddress ? 'out' : 'in')
    const counterparty = direction === 'out' ? to : from

    return {
        hash: raw.signature,
        direction,
        counterparty,
        amount: isToken ? Number(hit.tokenAmount) : Number(hit.amount) / LAMPORTS_PER_SOL,
        symbol: isToken ? null : 'SOL',
        mint: isToken ? hit.mint : null,
        timestamp: raw.timestamp ? raw.timestamp * 1000 : null,
        // Islem ucreti (SOL). Helius kaydi bunu `fee` alaninda LAMPORTS olarak
        // tasiyor ve sunucu AYNEN geciriyordu, ama bu fonksiyon satira KOYMUYORDU --
        // veri tam burada elden dusuyordu. Sonuc: detay modali Solana islemlerinde
        // ucreti KALICI OLARAK "—" gosteriyordu, sanki hicbir zaman bilinemezmis gibi.
        //
        // Ucret gercekten yoksa null KALIR: uydurma bir 0 kullaniciya islemin
        // ucretsiz oldugunu soylerdi. Modal'in mevcut "bilinmiyor" yolu korunur.
        fee: raw.fee != null ? Number(raw.fee) / LAMPORTS_PER_SOL : null,
        // Basarisiz islem de GORUNMELI: ucret odenmistir ve kullanici gonderiminin
        // neden gerceklesmedigini bilmelidir.
        status: raw.transactionError ? 'failed' : 'success',
    }
}
