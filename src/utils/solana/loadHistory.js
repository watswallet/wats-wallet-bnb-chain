import { fetchSolanaHistory } from './history'
import { toHistoryRow } from './historyRow'
import { fetchTokenMetadata } from './tokenMetadata'
import { SOLANA_CHAIN_ID, SOL_NATIVE_MARKER } from './constants'

/**
 * Sembolu bilinmeyen SPL satirlarini (symbol: null, yalniz mint bilgisi olan)
 * PAYLASILAN /solana/tokens metadata katmaniyla (bkz. tokenMetadata.js --
 * useSolanaAssets.js'in bakiye listesinde KULLANDIGI AYNI kumeleme/hata-yalitma
 * mantigi) zenginlestirir.
 *
 * KOK NEDEN (review round 1, Bulgu 5): mint->sembol cozulmezse Gecmis'te
 * "EPjFWd...Dt1v" gibi bir mint kisaltmasi sembol yerine gecerdi -- oysa AYNI
 * cuzdan Home'da AYNI token icin "USDC" gosteriyordu. Bu, zehirli-adres
 * bulanikligina cok benzer bir gorsel belirsizlik yaratir tam da bu planin iki
 * kez ugrastigi konuda: kullanici "dogru tokeni mi gonderdim?" sorusunu Gecmis
 * ekraninda cevaplayamaz hale gelir.
 *
 * Metadata ucu duserse (ya da hic mint yoksa) satirlar OLDUGU GIBI doner --
 * `fetchTokenMetadata` KENDI ICINDE hata yutar ve bos harita doner (bkz.
 * tokenMetadata.js); yani bir metadata kesintisi ASLA gecmis LISTESINI
 * BOSALTMAZ, yalniz sembol alani mint kisaltmasina (solanaSymbolLabel'in
 * kendi fallback'i) duser -- bakiye yolunun (useSolanaAssets) zaten dogru
 * yaptigi seyin AYNISI.
 */
async function enrichWithTokenSymbols(rows, fetchMetadata) {
    const mints = [...new Set(rows.filter((t) => t.mint && !t.symbol).map((t) => t.mint))]
    if (mints.length === 0) return rows

    const metadata = await fetchMetadata(mints)
    return rows.map((t) => {
        if (!t.mint || t.symbol) return t
        const meta = metadata.get(t.mint)
        return meta?.symbol ? { ...t, symbol: meta.symbol } : t
    })
}

/**
 * `background.js`'in yazdigi yerel bekleyen Solana kaydini (bkz. background.js
 * SOLANA_SEND handler'i, `saveOrUpdateTxInStorage` cagrisi) gecmis satiri
 * bicimine cevirir -- SAF katman, `toHistoryRow`'un ciktisiyla AYNI SEKLI
 * tasir ki gorunum katmani (History.vue) ikisini AYIRT ETMEK zorunda kalmasin.
 *
 * Yerel kayit HER ZAMAN kullanicinin KENDI gonderimidir (`direction: 'out'`
 * sabit) -- background.js bu kaydi yalniz BASARILI YAYINDAN SONRA, kendi
 * SOLANA_SEND cagrisinda yazar.
 *
 * `status`: kaydin KENDI `receipt_status`'undan TURETILIR, sabit
 * 'pending' DEGIL (review round 2, Bulgu B). background.js bu alani
 * `checkAndRecoverPendingTxs`/`fetchSolanaResolution` ile '0' (basarisiz) ya
 * da '1' (basarili) olarak GUNCELLER ve AYNI kilit icinde `prunePendingTransactions`
 * ile listeden DUSURUR -- yani kayit cozulmus AMA henuz budanmamis halde
 * gorunme penceresi bugun NEREDEYSE SIFIRDIR. Ama sifir DEGILDIR (iki adim
 * ayri bir heartbeat turuna dusebilir, ya da baska bir yazici prune'suz
 * cozebilir); status'u SABIT 'pending' birakmak, boyle bir anda BASARISIZ
 * OLMUS bir gonderiyi SONSUZA DEK "Bekliyor..." gosterirdi -- bu ekran bu
 * sinifta (goruntunun tasidigi durumdan uzun yasamasi) daha once iki kez
 * isirildi.
 */
export function pendingSolanaTxToRow(tx) {
    const isNative = !tx.asset || tx.asset === SOL_NATIVE_MARKER
    const status = tx.receipt_status === '0'
        ? 'failed'
        : (tx.receipt_status === '1' ? 'success' : 'pending')
    return {
        hash: tx.hash,
        direction: 'out',
        counterparty: tx.to_address,
        amount: Number(tx.value),
        symbol: isNative ? 'SOL' : null,
        mint: isNative ? null : tx.asset,
        timestamp: tx.block_timestamp ? Date.parse(tx.block_timestamp) : null,
        status,
    }
}

/**
 * Gecmis ekraninin (History.vue) Solana dalini SAF sekilde yurutur.
 *
 * chrome.* API'lerine DOGRUDAN DOKUNMAZ: storage sonucu (`activeAccount`,
 * `pendingTransactions`) ve mesaj gonderici (`sendMessage`) disaridan enjekte
 * edilir. Bu depoda component mount-test harness'i yok (bkz.
 * sendConfirmWiring.test.js); .vue icinde kalsaydi bu adres-cozumleme + hata
 * siniflandirma + yerel-bekleyen-birlestirme mantigi TESTSIZ kalirdi.
 *
 * Adres cozulemezse BOS LISTE degil error: 'address' ile doner. Bos liste,
 * "hic islemin yok" ile "adresin cozulemedi"yi AYNILASTIRIR ve kullaniciya
 * parasi kaybolmus gibi gorunur (bkz. Task 14 brief).
 *
 * `fetchHistory` HTTP/zaman-asimi hatasi firlatirsa (SOLANA_HISTORY_TIMEOUT,
 * SOLANA_HISTORY_HTTP_*, bkz. history.js) error: 'fetch' ile doner — ekran
 * SONSUZA DEK "yukleniyor" gostermez, ama kullaniciya ayri bir "tekrar dene"
 * yolu sunulabilsin diye 'address'ten AYRI bir kod tasir. BU DURUMDA BILE
 * yerel bekleyen islemler `transactions` icinde DONER (bkz. asagidaki KOD
 * INCELEMESI notu) -- sunucu gecmisi eksik kalsa da kullanicinin KENDI az
 * once gonderdigi islem KAYBOLMAZ.
 *
 * KOD INCELEMESI (Task 14, review round 1, Bulgu 2): EVM dalinin (History.vue
 * fetchHistory) kendi yorumu aynen soyle diyor: "Yerel bekleyen islemler HER
 * DURUMDA gosterilir... API hata verdiginde catch listeyi bos birakiyor ve
 * kullanici yolda olan kendi islemini bile goremiyordu." Solana dali ilk
 * yazildiginda BU HATA BIRE BIR TEKRARLANMISTI: fetchSolanaTxHistory sadece
 * Helius'tan gelen satirlari donduruyor, background.js'in yazdigi yerel
 * `pending_transactions` kaydina HIC BAKMIYORDU. Senaryo: kullanici 5 SOL
 * gonderir, Helius henuz indekslemeden (ya da /solana/history hata verirken)
 * Gecmis'i acar, "Islem bulunamadi" gorur, gonderimin basarisiz oldugunu
 * sanip TEKRAR gonderir -- background.js'in bir paragraf ayirdigi CIFT
 * GONDERIM riski. Duzeltme: yerel kayit (varsa) HER ZAMAN sonuca katilir,
 * yalniz Helius'tan GELEN (fetchedHashes) ile CAKISANLAR dusurulur.
 *
 * Adres KUCULTULMEZ: `pendingTransactions[].from_address` background.js
 * tarafindan base58 olarak (kucultulmeden) yazilir; burada da AYNI SEKILDE
 * (case-sensitive) karsilastirilir -- EVM dalinin `.toLowerCase()`'i (0x
 * adresleri icin) BURADA KULLANILMAZ.
 */
export async function loadSolanaHistory({
    activeAccount,
    sendMessage,
    pendingTransactions = [],
    fetchHistory = fetchSolanaHistory,
    toRow = toHistoryRow,
    fetchMetadata = fetchTokenMetadata,
} = {}) {
    // Adres KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir (bkz. historyRow.js).
    let address = activeAccount?.solanaAddress || ''

    if (!address) {
        try {
            const res = await sendMessage?.({ type: 'SOLANA_GET_ADDRESS' })
            address = res?.result?.address || ''
        } catch (e) {
            // Kasa kilitliyken ya da arka uc yeniden basladiginda SOLANA_GET_ADDRESS
            // hata doner/firlatir; adres cozulemedigi ANLASILIR SEKILDE bildirilir.
            console.error('Solana adresi cozulemedi:', e?.message)
            address = ''
        }
    }

    if (!address) return { transactions: [], error: 'address', address: '' }

    const myPending = (Array.isArray(pendingTransactions) ? pendingTransactions : [])
        .filter((tx) => tx?.chainId === SOLANA_CHAIN_ID && tx?.from_address === address)
        .map(pendingSolanaTxToRow)

    try {
        const raw = await fetchHistory(address)
        // Basarisiz islem de gecmiste GORUNMELI: ucret odenmistir ve kullanici
        // gonderiminin neden gerceklesmedigini bilmelidir (bkz. historyRow.js,
        // Task 14 brief). `.filter(Boolean)` YALNIZ null satirlari (transferi
        // olmayan islemler) dusurur -- `status`e GORE bir eleme YAPILMAZ; bu
        // ayrim historyRow.test.js'te GORUNUR ama satirin BURAYA, sonuca kadar
        // HAYATTA KALDIGINI kanitlamaz, bu yuzden asagida ayrica test edilir.
        const fetched = (Array.isArray(raw) ? raw : [])
            .map((r) => toRow(r, address))
            .filter(Boolean)

        // Bir islem artik Helius'tan geliyorsa yereldeki kopyasi atilir (EVM
        // dalindaki apiHashes/uniquePendingTxs deseniyle AYNI, bkz. History.vue).
        const fetchedHashes = new Set(fetched.map((t) => t.hash))
        const uniquePending = myPending.filter((t) => !fetchedHashes.has(t.hash))

        const merged = await enrichWithTokenSymbols([...uniquePending, ...fetched], fetchMetadata)
        return { transactions: merged, error: null, address }
    } catch (e) {
        console.error('Solana gecmisi alinamadi:', e?.message)
        // Sunucu hatasi YEREL kayitlari SILMEZ: yalniz sunucu gecmisi eksik
        // kalir (bkz. yukaridaki KOD INCELEMESI notu). Yerel kayit da (SPL ise)
        // ayni zenginlestirmeyi alir.
        //
        // KOD INCELEMESI (review round 2, Bulgu C): bu zenginlestirme cagrisi
        // KENDI try/catch'i icinde. Varsayilan fetchTokenMetadata KENDI ICINDE
        // hata yutar (bkz. tokenMetadata.js), yani bu dal PRODUKSIYONDA
        // ULASILAMAZ -- ama enjekte edilen bir fetchMetadata firlatirsa (orn.
        // testte, ya da ileride farkli bir cagiran) bu FIRLAMA sarmalanmazsa
        // disariya CIKARDI ve loadSolanaHistory { error: 'fetch' } DONMEK
        // yerine tamamen FIRLARDI -- tam olarak Bulgu 2'nin korumaya
        // calistigi yerel bekleyen satiri BOSALTIRDI.
        let enrichedPending = myPending
        try {
            enrichedPending = await enrichWithTokenSymbols(myPending, fetchMetadata)
        } catch (metaError) {
            console.error('Yerel bekleyen islem zenginlestirilemedi:', metaError?.message)
        }
        return { transactions: enrichedPending, error: 'fetch', address }
    }
}
