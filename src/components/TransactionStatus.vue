<template>
    <Transition name="slide-up">
        <div v-if="txStore.transactions.length > 0" class="absolute z-50 transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]"
            :class="txStore.isMinimized ? 'bottom-28 right-4' : 'inset-0 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-2xl'">

            <!-- KUCULTULMUS GORUNUM (BALON)

                 TEK SATIR. Oncesinde iki satirdi ve ~48px yer kapliyordu: ana ekranda
                 varlik satirlarinin USTUNE biniyordu. Kapladigi alan, soyledigi seyle
                 orantili degildi.

                 DOLU DISK icindeki sayi KALKTI: balonun en gurultulu ogesiydi ve
                 yanindaki kelimeyi TEKRARLIYORDU; tek islemde "1" hicbir sey
                 soylemiyordu. Yerine kartlardaki AYNI ikon seti geldi -- panel ile balon
                 artik ayni gorsel dili konusuyor.

                 IKINCI SATIR ("Gecmisi goruntule") KALKTI: butonun kendisi zaten onu
                 ima ediyor. `animate-ping` halkasi da daha once ayni gerekceyle
                 kaldirilmisti (donen ikon "suruyor"u tek basina anlatiyor). -->
            <button type="button" v-if="txStore.isMinimized"
                @click="txStore.maximize"
                class="bg-white/90 dark:bg-[#131315]/90 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-full py-2 px-3 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] hover:border-slate-300 dark:hover:border-white/20 cursor-pointer flex items-center gap-2 transition-colors duration-300 pointer-events-auto text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
                <span class="shrink-0 flex transition-colors duration-300" :class="toneText(pillTone)">
                    <svg v-if="pillTone === 'processing'" class="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    </svg>
                    <svg v-else-if="pillTone === 'queued'" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="2" /><path stroke-linecap="round" stroke-width="2" d="M12 7v5l3 2" /></svg>
                    <svg v-else class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
                </span>
                <span class="text-xs font-bold text-slate-800 dark:text-white whitespace-nowrap transition-colors duration-300">{{ pillLabel }}</span>
            </button>

            <!-- ACIK GORUNUM -->
            <div v-else class="w-full h-full flex flex-col relative">
                <div class="w-full flex items-center justify-between p-6 pb-4 z-20 shrink-0">
                    <h2 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
                        {{ $t('transactionStatus.transactions') }}
                        <span class="font-semibold tabular-nums text-slate-400 dark:text-zinc-600">({{ txStore.transactions.length }})</span>
                    </h2>
                    <button @click.stop="txStore.minimize" :aria-label="$t('transactionStatus.back')" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                </div>

                <!-- TransitionGroup: basarili kart kendiliginden kapandiginda (asagidaki
                     sayac) aniden YOK OLMAZ, kisa bir gecisle cikar ve kalanlar yerine
                     kayar. Kullanici bakarken bir satirin cat diye kaybolmasi, kaybolan
                     seyin NE oldugunu anlamasini engellerdi. -->
                <TransitionGroup tag="div" name="card" class="flex-1 overflow-y-auto px-6 space-y-3 custom-scrollbar" :class="clearableCount > 0 ? 'pb-24' : 'pb-6'">
                    <article v-for="tx in txStore.transactions" :key="tx.id" class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl p-4 relative overflow-hidden shadow-sm dark:shadow-none transition-colors duration-300">

                        <!-- TON ucret kurtarmasi 'not-charged'/'unresolved' sonucuna vardiginda
                             ALTTAKI tx.status HALA 'processing' KALABILIR (tonFeeRecovery.js:
                             'unresolved' cogu yolda islem kaydina hic dokunmaz - kayit yalniz
                             makbuz deposunda kapanir). Kullaniciyi sonsuza kadar "isleniyor"
                             gorunumunde birakmamak icin ton (cubuk/ikon/metin) ONCE tonFeeTone'a
                             bakar, sonra tx.status'a duser.

                             CUBUK ARTIK YALNIZ 'processing'te ciziliyor: bitmis bir islemde
                             ustteki kalin renk barinin tasidigi bilgi SIFIRDI - ikon ve durum
                             sozcugu zaten ayni seyi soyluyordu, uc isaret tek olguyu
                             tekrarliyordu. Surerken ise gercekten bir sey anlatir (belirsiz
                             sureli bekleme), o yuzden orada kaldi. -->
                        <div v-if="tonFeeTone(tx) === 'processing'" class="absolute top-0 left-0 h-0.5 bg-indigo-500 animate-progress-indeterminate w-full"></div>

                        <!-- DURUM SATIRI: ikon + durum sozcugu. Renk YALNIZCA burada. -->
                        <div class="flex items-center justify-between gap-2 mb-2.5">
                            <div class="flex items-center gap-1.5 min-w-0 transition-colors duration-300" :class="toneText(tonFeeTone(tx))">
                                <svg v-if="tonFeeTone(tx) === 'processing'" class="w-3.5 h-3.5 shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none">
                                    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25" />
                                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                                </svg>
                                <svg v-else-if="tonFeeTone(tx) === 'success'" class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
                                <svg v-else-if="tonFeeTone(tx) === 'error'" class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                <svg v-else class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" stroke-width="2" /><path stroke-linecap="round" stroke-width="2" d="M12 7v5l3 2" /></svg>

                                <span class="text-xs font-bold truncate">
                                    {{
                                        tx.meta.tonFeeState === 'unresolved' ? $t('transactionStatus.tonFeeUnresolvedBadge') :
                                        tx.meta.tonFeeState === 'recovering' ? $t('transactionStatus.processing').replace('...', '') :
                                        tx.status === 'success' ? $t('transactionStatus.success') :
                                        tx.status === 'error' ? $t('transactionStatus.failed') :
                                        tx.status === 'processing' ? $t('transactionStatus.processing').replace('...', '') :
                                        tx.status === 'queued' ? $t('transactionStatus.txQueue') : tx.status
                                    }}
                                </span>
                            </div>
                            <button v-if="tx.status === 'success' || tx.status === 'error'" @click="txStore.clearTransaction(tx.id)" class="shrink-0 pointer-events-auto rounded text-[11px] font-medium text-slate-400 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
                                {{ $t('transactionStatus.dismiss') }}
                            </button>
                        </div>

                        <!-- ICERIK SATIRI: ne yapildi + ne kadar. Karttaki ASIL cumle budur,
                             bu yuzden en buyuk ve en koyu satir o. Miktar saga hizali ve
                             `tabular-nums`: kartlar alt alta dizilince rakamlar hizalanir. -->
                        <div class="flex items-baseline justify-between gap-3">
                            <h3 class="text-[15px] font-bold text-slate-900 dark:text-white truncate transition-colors duration-300">{{ typeLabel(tx) }}</h3>
                            <span v-if="tx.meta.amount" class="shrink-0 text-[15px] font-bold tabular-nums text-slate-900 dark:text-white transition-colors duration-300">
                                {{ tx.meta.amount }}<span v-if="tx.meta.symbol" class="ml-1 text-[11px] font-semibold text-slate-500 dark:text-zinc-500">{{ tx.meta.symbol }}</span>
                            </span>
                        </div>

                        <!-- KIMLIK SATIRI (TxIdentityLine.vue): kime/neyle/nereye.
                             AYRI bilesende, kart dosyasinin icinde DEGIL: bes turun
                             dallari buraya girseydi sablon okunamaz hale gelirdi. -->
                        <TxIdentityLine :meta="tx.meta" />

                        <!-- Adim satiri indigo KALIR (durumla ayni aile, ilerleme demek) ama
                             KALIN DEGIL: kalinken durum sozcuguyle esit sesle bagiriyor ve
                             karttaki asil satiri (tur + miktar) golgeliyordu. -->
                        <p class="mt-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400" v-if="tx.status === 'processing' && tx.meta.total > 1">
                            {{ tx.meta.stepKind === 'bootstrap' ? $t('transactionStatus.atsStepSetup') : $t('transactionStatus.atsStepTransfer') }}
                        </p>

                        <!-- TON ucret kurtarmasi (T7/tonFeeRecovery.js) satirlari - Task 7'nin
                             yazdigi `meta.tonFeeState`i tuketir (spec 8 karar tablosu).
                             KRITIK: 'unresolved' icin "basarisiz" kelimesi HICBIR YERDE
                             kullanilmaz - ucret alindi, sonuc GERCEKTEN bilinmiyor; bunu
                             basarisiz saymak kullaniciyi tekrar gondermeye iter (ikinci
                             ucret). 'not-charged' FARKLI: ucretin alinmadigi KESIN, tekrar
                             denemek guvenli. -->
                        <p class="mt-1 text-[11px] leading-snug text-slate-500 dark:text-zinc-500" v-if="tx.meta.tonFeeState === 'recovering'">{{ $t('transactionStatus.tonFeeVerifying') }}</p>
                        <p class="mt-1 text-[11px] leading-snug font-medium text-rose-600 dark:text-rose-400" v-else-if="tx.meta.tonFeeState === 'not-charged'">{{ $t('send.confirmTransaction.tonFeeNotCharged') }}</p>
                        <!-- ALSO FIX (round 1 review): settlementId YOKKEN interpolasyonu
                             yine de basmak "Destek kaydi:" yazip ARDINDAN hicbir sey
                             gostermiyordu - Kopyala butonuyla AYNI kosulla korunur. -->
                        <p class="mt-1 text-[11px] leading-snug font-medium text-rose-600 dark:text-rose-400" v-else-if="tx.meta.tonFeeState === 'unresolved' && tx.meta.settlementId">{{ $t('send.confirmTransaction.tonFeeUnresolved', { settlementId: tx.meta.settlementId }) }}</p>
                        <!-- Hata metni artik MIKTARIN YERINI ALMIYOR, altina geliyor: basarisiz
                             bir islemde kullanicinin ilk sordugu sey "ne kadardi" oluyordu ve
                             tam o an ekrandan kayboluyordu.

                             Metin de artik BURADA uretiliyor: arka plan KOD yaziyor, ceviri
                             ekranda yapiliyor (errorText / utils/txErrors.js). -->
                        <p class="mt-1 text-[11px] leading-snug text-rose-600 dark:text-rose-400" v-else-if="errorText(tx)">{{ errorText(tx) }}</p>
                        <p class="mt-1 text-[11px] leading-snug text-slate-500 dark:text-zinc-500" v-else-if="tx.status === 'queued'">{{ $t('transactionStatus.waiting') }}</p>

                        <!-- ROUND 1 REVIEW BULGU 3: bu buton "Tekrar dene" YAZIP
                             `clearTransaction` (KAYDI SILME) CAGIRIYORDU - etiket ve eylem
                             CELISIYORDU, kullanici "tekrar dene"ye basip kaydinin
                             kayboldugunu goruyordu. Etiket eylemle UYUSSUN diye "Kapat"a
                             (transactionStatus.dismiss) cevrildi: 'not-charged' ucretin
                             KESIN alinmadigini soyluyor (tonFeeRecovery.js'te bu deger
                             YALNIZ makbuz kaydi ya HIC OLUSMAMISKEN ya da 'tahsilat
                             yapilmadi' disposition'iyla SILINDIKTEN sonra yazilir - geride
                             korunacak bir makbuz KALMAZ), yani kapatmak HER ZAMAN guvenli;
                             brief'in "deadline gecmemisken ve makbuz varken" kosulu GERCEK
                             bir relay-tekrarini korumak icindir, bu buton onu YAPMIYOR. Asil
                             "tekrar gonder" kullanicinin Gonder/Takas ekranina DONMESI
                             demek - bu panelin orijinal islemin parametrelerine erisimi yok,
                             yeniden olusturamiyor. 'unresolved': deadline GECMIS bir teklifi
                             tekrar oynatmak YENI bir teklif/IKINCI ucret demek olurdu (spec
                             8) - bu yuzden orada buton YOK, yalniz destek kaydini KOPYALAMA
                             var. -->
                        <div class="flex items-center gap-2 mt-1 pointer-events-auto" v-if="tx.meta.tonFeeState === 'not-charged' || (tx.meta.tonFeeState === 'unresolved' && tx.meta.settlementId)">
                            <button v-if="tx.meta.tonFeeState === 'not-charged'" @click="txStore.clearTransaction(tx.id)" class="text-[10px] font-bold px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 cursor-pointer transition-colors">
                                {{ $t('transactionStatus.dismiss') }}
                            </button>
                            <button v-if="tx.meta.tonFeeState === 'unresolved' && tx.meta.settlementId" @click="copy(tx.meta.settlementId)" class="text-[10px] font-bold px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 cursor-pointer transition-colors">
                                {{ $t('dapps.sign.btn_copy') }}
                            </button>
                        </div>

                        <!-- BAGLAM SATIRI: ag solda, zincir tarayicisi baglantisi sagda. Karttaki
                             en sessiz satir - kimlige degil, aramaya yarar. -->
                        <div class="mt-3 flex items-center justify-between gap-2">
                            <!-- Ag LOGOSU adin SOLUNDA: kullanici agi renk/bicimden
                                 ADINDAN once taniyor. Yedek ACIKCA bos: chainLogo'nun
                                 varsayilan yedek DOSYASI depoda YOK, basmak kirik resim
                                 cizerdi; bos src'de TokenLogo monograma duser. -->
                            <span class="flex items-center gap-1.5 min-w-0">
                                <TokenLogo :src="chainLogo(tx.meta.chainId, '')" :symbol="chainName(tx.meta.chainId)" size-class="w-3.5 h-3.5" text-class="text-[8px]" />
                                <span class="text-[11px] text-slate-500 dark:text-zinc-500 truncate transition-colors duration-300">{{ networkName(tx) }}</span>
                            </span>
                            <a v-if="tx.meta.txHash" :href="getExplorerUrl(tx)" target="_blank" rel="noopener noreferrer" class="shrink-0 pointer-events-auto flex items-center gap-1 rounded font-mono text-[11px] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
                                {{ shortenHash(tx.meta.txHash) }}
                                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                        </div>
                    </article>
                </TransitionGroup>

                <!-- Temizlenecek bir sey YOKKEN buton HIC cizilmez: devre disi duran dolu siyah
                     bir bar, ekranin en agir ogesi olup hicbir sey yapmiyordu. -->
                <div v-if="clearableCount > 0" class="absolute bottom-0 left-0 w-full p-6 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-md flex justify-center z-20">
                    <button @click="txStore.clearTransactions" class="flex-1 py-3 text-sm font-bold rounded-xl border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-900 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40">
                        {{ $t('transactionStatus.clearCompleted') }}
                    </button>
                </div>
            </div>
        </div>
    </Transition>
</template>

<script setup>
import { computed, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTransactionStore } from '../store/transaction'
import TokenLogo from './TokenLogo.vue'
import TxIdentityLine from './TxIdentityLine.vue'
import { chainLogo, chainName } from '../utils/chainLogo'
import { explorerTxUrl } from '../utils/explorer'
import { shortenAddress } from '../utils/shortenAddress'
import { txErrorText } from '../utils/txErrors'
import { autoDismissIds, SUCCESS_TTL_MS } from '../utils/txAutoDismiss'
import { copy } from '../utils/copy'

const txStore = useTransactionStore()
const { t } = useI18n()

const activeTxCount = computed(() => txStore.transactions.filter(tx => tx.status === 'processing' || tx.status === 'queued').length)

// BALONUN TONU ve METNI. Ton kartlarla AYNI kumeden ('processing'/'queued'/
// 'success') geliyor ki iki yuzey ayni renkleri ayni anlamda kullansin.
//
// 'queued' AYRI tutuldu: balon eskiden HEPSINE "kuyrukta" deyip ALT SATIRDA
// "Isleniyor..." yaziyordu -- ayni kutu iki celiskili sey soyluyordu. Artik
// GERCEKTEN suren bir islem varsa "suruyor", hepsi bekliyorsa "kuyrukta" der.
const processingCount = computed(() => txStore.transactions.filter(tx => tx.status === 'processing').length)

const pillTone = computed(() => {
    if (activeTxCount.value === 0) return 'success'
    return processingCount.value > 0 ? 'processing' : 'queued'
})

// Sayi METNIN ICINDE ve yalnizca anlamli oldugu yerde. Eskiden `sayi + ' ' + t(...)`
// ile kuruluyordu ve ingilizcede "1 Tx queue" gibi BOZUK bir dize uretiyordu --
// dizgi birlestirme dil bilmez. Tekil/cogul AYRI anahtarlar: bu depoda hic cogul
// (`|`) kullanimi yok, tek kullanim icin yeni bir kural getirmek yerine secim
// burada ACIKCA yapiliyor.
const pillLabel = computed(() => {
    const n = activeTxCount.value
    if (n === 0) return t('transactionStatus.completed')
    const base = pillTone.value === 'processing' ? 'Processing' : 'Queued'
    return n === 1
        ? t(`transactionStatus.pill${base}One`)
        : t(`transactionStatus.pill${base}Many`, { count: n })
})

// "Tamamlananlari Temizle" YALNIZCA temizlenecek bir kayit varken anlamli:
// clearTransactions suren/kuyruktaki kayitlara dokunmaz (store/transaction.js),
// yani hepsi surerken buton hicbir sey yapmazdi.
const clearableCount = computed(() => txStore.transactions.length - activeTxCount.value)

// `meta.type` arka planin YAZDIGI icsel etikettir ('Transaction', 'Swap', ...) ve
// dogrudan ekrana basiliyordu: Turkce arayuzde kart "Transaction" diyordu. Depolanan
// deger DEGISMEZ (background.js'teki dizeleri tonSwapWiring/tonBackgroundGuards
// testleri kilitliyor), yalniz GOSTERIMI cevrilir. Bilinmeyen bir deger gelirse ham
// hali basilir - uydurulmus bir etiket, anlasilmayan bir etiketten daha kotudur.
const TYPE_KEYS = {
    Transaction: 'send',
    Swap: 'swap',
    Bridge: 'bridge',
    Jetton: 'jetton',
    TonConnect: 'tonconnect',
}

const typeLabel = (tx) => {
    const key = TYPE_KEYS[tx?.meta?.type]
    if (key) return t(`transactionStatus.types.${key}`)
    return tx?.meta?.type || t('history.categories.transaction')
}

// Renk karttaki TEK isaret oldugu icin ton->sinif eslemesi tek yerde durur; sablona
// dagilmis dort ayri ternary, bir durum eklenince sessizce eksik kalirdi.
const TONE_TEXT = {
    processing: 'text-indigo-600 dark:text-indigo-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-rose-600 dark:text-rose-400',
    queued: 'text-amber-600 dark:text-amber-400',
}

const toneText = (tone) => TONE_TEXT[tone] || 'text-slate-500 dark:text-zinc-400'

// Karttaki hata satiri. Arka plan artik CUMLE degil KOD yaziyor (utils/txErrors.js)
// ve ceviri BURADA yapiliyor -- Turkce arayuzde "Transaction failed on-chain"
// gorunmesinin sebebi metnin arka planda kurulmasiydi.
//
// SIRA onemli: (1) kod varsa cevrilir, (2) yoksa HAM metin oldugu gibi basilir
// (ethers/SDK istisnalari cevrilemez; yanlis dilde ama DOGRU bir sebep, jenerik bir
// cumleden daha faydalidir), (3) ikisi de yoksa ve islem GERCEKTEN dustuyse jenerik
// cumle basilir -- basarisiz bir kartin hicbir sey soylememesi en kotu secenek.
const errorText = (tx) => txErrorText(tx, t)

// Cozumleme utils/chainLogo.js'te TEK yerde: burada `c.chainId === ...` yaziliydi
// ve metin yazimli bir kimlik ('56', 'solana-mainnet') sessizce cozulemiyordu.
const networkName = (tx) => chainName(tx?.meta?.chainId) || t('header.network')

// Ozel kopya KALKTI: ayni kisaltma utils/shortenAddress.js'te duruyor ve kimlik
// satiri da onu kullaniyor. Iki kopya, iki farkli genislige ayrilmaya acikti.
// 6/4 GENISLIGI KORUNUR -- hash icin depodaki yerlesik genislik 16/8 olsa da bu
// baglanti kartin EN SESSIZ satirinda ve yaninda ag adiyla ayni satiri paylasiyor.
const shortenHash = (hash) => shortenAddress(hash, 6, 4)

const getExplorerUrl = (tx) => explorerTxUrl(tx?.meta?.chainId, tx?.meta?.txHash)

// TON ucret kurtarmasi (tonFeeRecovery.js) `meta.tonFeeState`'i 'not-charged'/
// 'unresolved' sonucuna vardirdiginda ALTTAKI `tx.status` HALA 'processing'
// KALABILIR (kayit yalniz makbuz deposunda kapanir, cogu yolda islem kaydina
// hic dokunulmaz). Karti sonsuza kadar "isleniyor" gorunumunde birakmamak
// icin ton ONCE tonFeeState'e bakar, sonra tx.status'a duser.
//
// ROUND 1 REVIEW BULGU 2: 'recovering' AYRICA ele alinir ve HER ZAMAN
// 'processing' doner - `tx.status` bu sirada 'error' OLABILIR (ornegin
// onceki bir denemeden kalma) ve dokunulmadan birakilirsa rozet "İŞLEM
// BAŞARISIZ" yazardi tam da kurtarma surerken; ucret alinmis, sonuc HENUZ
// bilinmiyor - bu, brief'in yasakladigi TAM OLARAK o iddia.
function tonFeeTone(tx) {
    const state = tx?.meta?.tonFeeState
    if (state === 'not-charged' || state === 'unresolved') return 'error'
    if (state === 'recovering') return 'processing'
    return tx?.status
}

// BASARILI KAYIT KENDILIGINDEN KAPANIR (utils/txAutoDismiss.js).
//
// Sayac DEPODA degil BURADA: sure, arayuzun kaydi GORDUGU andan itibaren isler.
// "Islem basarili oldu" anindan sayilsaydi, eklenti penceresi odak kaybinda
// kapandigi icin kullanici onayi cogu zaman HIC gormezdi -- pencere kapaliyken
// kayit oldugu gibi durur, tekrar acilinca sayac yeniden kurulur.
//
// KARAR `tonFeeTone`a ait, ham `tx.status`a DEGIL: ucreti alinmis ama sonucu
// bilinmeyen bir TON islemi ('recovering'/'unresolved') sessizce silinmemeli.
const dismissTimers = new Map()

const cancelTimer = (id) => {
    clearTimeout(dismissTimers.get(id))
    dismissTimers.delete(id)
}

watch(() => txStore.transactions, (list) => {
    const dismissable = new Set(autoDismissIds(list, tonFeeTone))

    // Artik "basarili" OLMAYAN ya da listeden dusmus kayitlarin sayaci iptal edilir:
    // duran bir sayac, yerine gecen YENI bir kaydi (ayni id tekrar kullanilirsa)
    // ya da tonu degismis bir kaydi kazara silebilirdi.
    for (const id of [...dismissTimers.keys()]) {
        if (!dismissable.has(id)) cancelTimer(id)
    }

    for (const id of dismissable) {
        if (dismissTimers.has(id)) continue
        dismissTimers.set(id, setTimeout(() => {
            dismissTimers.delete(id)
            txStore.clearTransaction(id)
        }, SUCCESS_TTL_MS))
    }
}, { immediate: true, deep: true })

onUnmounted(() => {
    for (const id of [...dismissTimers.keys()]) cancelTimer(id)
})
</script>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active {
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
}
.slide-up-enter-from, .slide-up-leave-to {
    transform: translateY(100%);
    opacity: 0;
}

@keyframes progress-indeterminate {
    0% { left: -40%; width: 40%; }
    50% { left: 100%; width: 40%; }
    100% { left: 100%; width: 0%; }
}
.animate-progress-indeterminate {
    animation: progress-indeterminate 1.5s infinite linear;
}

/* Kart cikisi. Kendiliginden kapanan basarili kart aniden yok olmaz; kalanlar da
   `card-move` ile yerine KAYAR, zipla-maz. Giris gecisi YOK: kartlar cogunlukla
   panel zaten acikken gelmiyor, panelin kendi `slide-up`i onlari birlikte tasiyor. */
.card-leave-active { transition: opacity 0.25s ease, transform 0.25s ease; }
.card-leave-to { opacity: 0; transform: scale(0.97); }
.card-move { transition: transform 0.25s ease; }

/* Hareket azaltma tercihi: belirsiz sureli cubuk KAYMAYI birakir ama KALIR -
   "suruyor" bilgisini tasiyan sey cubugun VARLIGI, hareketi degil. */
@media (prefers-reduced-motion: reduce) {
    .animate-progress-indeterminate { animation: none; left: 0; width: 100%; }
    .slide-up-enter-active, .slide-up-leave-active { transition: opacity 0.2s ease; }
    .slide-up-enter-from, .slide-up-leave-to { transform: none; }
    .card-leave-active, .card-move { transition: none; }
}
</style>
