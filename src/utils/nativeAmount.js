// Aktivite listesindeki NATIVE tutarin birimi ve olcegi — SAF katman.
//
// KOK NEDEN: History.vue'nun getListAmount fonksiyonu native dalda
// `Number(tx.value) / 1e18` yapip yanina SABIT 'ETH' yaziyordu. BNB Chain'de
// 0,5 BNB gonderen kullanici listede "0,5 ETH" goruyordu; ayni satirin detay
// modalinde ucret birimi zincire gore secildigi halde (bkz. History.vue'deki
// `isTon(...) ? 'GRAM' : 'ETH'` yorumu) LISTE tarafi bu duzeltmeyi hic almamisti.
//
// Sabit 1e18 de ayni sinifta bir varsayimdir: ondaligi farkli bir zincirde
// tutari 10^n kat yanlis gosterir. Ikisi de burada, zincir KAYDINDAN okunur.

const EVM_VARSAYILAN_ONDALIK = 18

/**
 * Zincirin native birim sembolu. Bilinmiyorsa BOS dize doner.
 *
 * 'ETH'e DUSMEK duzeltilen hatanin ta kendisidir: birimsiz bir sayi durust,
 * yanlis birimli bir sayi yalandir.
 */
export function nativeSymbolOf(chain) {
    const sembol = chain?.nativeCurrency?.symbol
    return typeof sembol === 'string' && sembol ? sembol : ''
}

/**
 * Ham zincir degerini (wei benzeri tam sayi, metin ya da sayi) okunabilir
 * birime cevirir. Cozulemeyen degerde `null` doner — `0` DEGIL: bilinmeyen bir
 * tutari sifir gostermek kullaniciya parasinin gittigini soyler.
 */
export function nativeUnits(rawValue, chain) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null

    const ham = Number(rawValue)
    if (!Number.isFinite(ham)) return null

    const ondalik = Number(chain?.nativeCurrency?.decimals)
    const bolen = 10 ** (Number.isFinite(ondalik) ? ondalik : EVM_VARSAYILAN_ONDALIK)

    return ham / bolen
}

/**
 * Liste ve detay modalindeki NATIVE tutarin parcalari: { amount, sign, symbol }.
 *
 * ONDALIK SABIT 18'dir, aktif agdan OKUNMAZ. Sebep bir kolaylik degil, olculmus
 * bir hata: bu dala yalniz EVM-bicimli satirlar ulasir (Solana kendi dalinda,
 * TON satirlari her zaman erc20_transfers tasir) ve supported_chains.json'daki
 * ON EVM zincirinin HEPSI 18 ondalik kullanir. Ondaligi aktif agdan okumak,
 * EVM bekleyen bir satir TON ekraninda goruntude kaldiginda (ki kaliyor:
 * /ton/history hata verince fetchHistory yerel EVM kayitlarina duser) tutari
 * 10^9 KAT sisiriyordu -- 0,5 ETH ekranda "500.00M GRAM" olarak gorunuyordu.
 *
 * SEMBOL ise aktif agdan gelir, ama YALNIZCA aktif ag EVM ise. EVM olmayan bir
 * agda duran bu satir o agin varligi DEGILDIR; oraya "GRAM" ya da "SOL" yazmak
 * yalnizca birimi degil islemin hangi zincirde oldugunu da yanlis soyler.
 * Bilinmiyorsa bos kalir: birimsiz bir sayi durust, yanlis birimli bir sayi degil.
 */
export function evmNativeParts(tx, chain) {
    const ham = tx?.value
    const amount = ham && ham !== '0' ? nativeUnits(ham, { nativeCurrency: { decimals: EVM_VARSAYILAN_ONDALIK } }) : null

    const kategori = typeof tx?.category === 'string' ? tx.category.toLowerCase() : ''
    // Yon YALNIZ bilindiginde isaretlenir: sozlesme etkilesimleri kategorisizdir
    // ve uydurma bir '-' islemin yonu hakkinda yalan soylerdi.
    const sign = kategori.includes('receive') ? '+' : (kategori.includes('send') ? '-' : '')

    // Number(chainId) > 0: EVM zincirleri pozitif sayisal kimlik tasir. TON
    // negatif (-239 / -3), Solana ise sayiya CEVRILEMEYEN bir metin kullanir
    // ('solana-mainnet' -> NaN); ikisi de bu kapidan gecemez.
    const kimlik = Number(chain?.chainId)
    const evmMi = Number.isFinite(kimlik) && kimlik > 0

    return { amount, sign, symbol: evmMi ? nativeSymbolOf(chain) : '' }
}
