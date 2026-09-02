<template>
    <Transition name="slide-up">
        <div v-if="txStore.transactions.length > 0" class="absolute z-50 transition-all duration-500 ease-[cubic-bezier(0.19,1,0.22,1)]"
            :class="txStore.isMinimized ? 'bottom-28 right-4' : 'inset-0 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-2xl'">
            
            <!-- MINIMIZED VIEW (TINY PILL) -->
            <button type="button" v-if="txStore.isMinimized"
                @click="txStore.maximize"
                class="bg-white/90 dark:bg-[#131315]/90 backdrop-blur-md border border-slate-200 dark:border-white/10 rounded-full py-1.5 px-1.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgba(99,102,241,0.2)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.5)] cursor-pointer flex items-center gap-2 group transition-all duration-300 pointer-events-auto text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
            >
                <div class="relative w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-inner"
                    :class="activeTxCount > 0 ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'">
                    
                    <span v-if="activeTxCount > 0" class="absolute inset-0 rounded-full animate-ping bg-indigo-500/30"></span>
                    
                    <svg v-if="activeTxCount > 0" class="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-dasharray="16" stroke-dashoffset="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="160"/><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12360 12 12"/></path></svg>
                    <span v-else>{{ txStore.transactions.length }}</span>
                </div>
                
                <div class="pr-2 flex flex-col justify-center">
                    <span class="text-xs font-bold text-slate-800 dark:text-white leading-none mb-0.5">
                        {{ activeTxCount > 0 ? activeTxCount + ' ' + $t('transactionStatus.txQueue') : $t('transactionStatus.completed') }}
                    </span>
                    <span class="text-[9px] text-slate-500 dark:text-zinc-400 leading-none">{{ activeTxCount > 0 ? $t('history.details.processing') : $t('transactionStatus.viewHistory') }}</span>
                </div>
            </button>

            <!-- EXPANDED VIEW -->
            <div v-else class="w-full h-full flex flex-col relative">
                <div class="w-full flex items-center justify-between p-6 z-20 shrink-0">
                    <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{{ $t('transactionStatus.transactions') }} ({{ txStore.transactions.length }})</h2>
                    <button @click.stop="txStore.minimize" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto px-6 pb-24 space-y-4 custom-scrollbar">
                    <div v-for="tx in txStore.transactions" :key="tx.id" class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm relative overflow-hidden transition-all duration-300">
                        
                        <!-- TON ucret kurtarmasi 'not-charged'/'unresolved' sonucuna vardiginda
                             ALTTAKI tx.status HALA 'processing' KALABILIR (tonFeeRecovery.js:
                             'unresolved' cogu yolda islem kaydina hic dokunmaz - kayit yalniz
                             makbuz deposunda kapanir). Kullaniciyi sonsuza kadar "isleniyor"
                             gorunumunde birakmamak icin ton (bar/rozet) ONCE tonFeeTone'a
                             bakar, sonra tx.status'a duser. -->
                        <div v-if="tonFeeTone(tx) === 'processing'" class="absolute top-0 left-0 h-1 bg-indigo-500 animate-progress-indeterminate w-full"></div>
                        <div v-else-if="tonFeeTone(tx) === 'success'" class="absolute top-0 left-0 w-full h-1 bg-emerald-500"></div>
                        <div v-else-if="tonFeeTone(tx) === 'queued'" class="absolute top-0 left-0 w-full h-1 bg-amber-500"></div>
                        <div v-else-if="tonFeeTone(tx) === 'error'" class="absolute top-0 left-0 w-full h-1 bg-rose-500"></div>

                        <div class="flex items-center justify-between pointer-events-none mb-3 mt-1">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold px-2 py-0.5 rounded uppercase" :class="[
                                    tonFeeTone(tx) === 'processing' ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20' : '',
                                    tonFeeTone(tx) === 'success' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20' : '',
                                    tonFeeTone(tx) === 'error' ? 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20' : '',
                                    tonFeeTone(tx) === 'queued' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20' : ''
                                ]">
                                    {{
                                        tx.meta.tonFeeState === 'unresolved' ? $t('transactionStatus.tonFeeUnresolvedBadge') :
                                        tx.meta.tonFeeState === 'recovering' ? $t('transactionStatus.processing').replace('...', '') :
                                        tx.status === 'success' ? $t('transactionStatus.success') :
                                        tx.status === 'error' ? $t('transactionStatus.failed') :
                                        tx.status === 'processing' ? $t('transactionStatus.processing').replace('...', '') :
                                        tx.status === 'queued' ? $t('transactionStatus.txQueue') : tx.status
                                    }}
                                </span>
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500">{{ chains.find(c => c.chainId === tx.meta.chainId)?.name || $t('header.network') }}</span>
                            </div>
                            <button v-if="tx.status === 'success' || tx.status === 'error'" @click="txStore.clearTransaction(tx.id)" class="pointer-events-auto text-xs text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors">
                                {{ $t('transactionStatus.dismiss') }}
                            </button>
                        </div>

                        <div class="flex items-center justify-between">
                            <div class="flex flex-col">
                                <span class="text-sm font-bold text-slate-800 dark:text-white">{{ tx.meta.type || $t('history.categories.transaction') }}</span>
                                <span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold" v-if="tx.status === 'processing' && tx.meta.total > 1">
                                    {{ tx.meta.stepKind === 'bootstrap' ? $t('transactionStatus.atsStepSetup') : $t('transactionStatus.atsStepTransfer') }}
                                </span>
                                <!-- TON ucret kurtarmasi (T7/tonFeeRecovery.js) satirlari - Task 7'nin
                                     yazdigi `meta.tonFeeState`i tuketir (spec 8 karar tablosu).
                                     KRITIK: 'unresolved' icin "basarisiz" kelimesi HICBIR YERDE
                                     kullanilmaz - ucret alindi, sonuc GERCEKTEN bilinmiyor; bunu
                                     basarisiz saymak kullaniciyi tekrar gondermeye iter (ikinci
                                     ucret). 'not-charged' FARKLI: ucretin alinmadigi KESIN, tekrar
                                     denemek guvenli. -->
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 max-w-50 truncate" v-if="tx.meta.tonFeeState === 'recovering'">{{ $t('transactionStatus.tonFeeVerifying') }}</span>
                                <span class="text-[10px] text-rose-600 dark:text-rose-400 max-w-50 truncate font-medium" v-else-if="tx.meta.tonFeeState === 'not-charged'">{{ $t('send.confirmTransaction.tonFeeNotCharged') }}</span>
                                <!-- ALSO FIX (round 1 review): settlementId YOKKEN interpolasyonu
                                     yine de basmak "Destek kaydı:" yazip ARDINDAN hicbir sey
                                     gostermiyordu - Kopyala butonuyla AYNI kosulla korunur. -->
                                <span class="text-[10px] text-rose-600 dark:text-rose-400 max-w-50 truncate font-medium" v-else-if="tx.meta.tonFeeState === 'unresolved' && tx.meta.settlementId">{{ $t('send.confirmTransaction.tonFeeUnresolved', { settlementId: tx.meta.settlementId }) }}</span>
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 max-w-50 truncate" v-else-if="tx.meta.error">{{ tx.meta.error }}</span>
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 max-w-50 truncate" v-else-if="tx.status === 'queued'">{{ $t('transactionStatus.waiting') }}</span>
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500" v-else-if="tx.meta.amount">{{ $t('transactionStatus.amount') }}: {{ tx.meta.amount }}</span>

                                <!-- ROUND 1 REVIEW BULGU 3: bu buton "Tekrar dene" YAZIP
                                     `clearTransaction` (KAYDI SILME) CAGIRIYORDU - etiket ve eylem
                                     CELISIYORDU, kullanici "tekrar dene"ye basip kaydinin
                                     kaybolduğunu görüyordu. Etiket eylemle UYUSSUN diye "Kapat"a
                                     (transactionStatus.dismiss) cevrildi: 'not-charged' ucretin
                                     KESIN alinmadigini soyluyor (tonFeeRecovery.js'te bu deger
                                     YALNIZ makbuz kaydi ya HIC OLUSMAMISKEN ya da 'tahsilat
                                     yapilmadi' disposition'iyla SILINDIKTEN sonra yazilir - geride
                                     korunacak bir makbuz KALMAZ), yani kapatmak HER ZAMAN guvenli;
                                     brief'in "deadline gecmemisken ve makbuz varken" koşulu GERCEK
                                     bir relay-tekrarini korumak icindir, bu buton onu YAPMIYOR. Asil
                                     "tekrar gonder" kullanicinin Gonder/Takas ekranina DONMESI
                                     demek - bu panelin orijinal islemin parametrelerine erisimi yok,
                                     yeniden olusturamiyor. 'unresolved': deadline GECMIS bir teklifi
                                     tekrar oynatmak YENI bir teklif/IKINCI ucret demek olurdu (spec
                                     8) - bu yuzden orada buton YOK, yalniz destek kaydini KOPYALAMA
                                     var. -->
                                <div class="flex items-center gap-2 mt-1 pointer-events-auto" v-if="tx.meta.tonFeeState === 'not-charged' || (tx.meta.tonFeeState === 'unresolved' && tx.meta.settlementId)">
                                    <button v-if="tx.meta.tonFeeState === 'not-charged'" @click="txStore.clearTransaction(tx.id)" class="text-[10px] font-bold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors">
                                        {{ $t('transactionStatus.dismiss') }}
                                    </button>
                                    <button v-if="tx.meta.tonFeeState === 'unresolved' && tx.meta.settlementId" @click="copy(tx.meta.settlementId)" class="text-[10px] font-bold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-600 dark:text-zinc-300 transition-colors">
                                        {{ $t('dapps.sign.btn_copy') }}
                                    </button>
                                </div>
                            </div>

                            <a v-if="tx.meta.txHash" :href="getExplorerUrl(tx)" target="_blank" class="flex items-center gap-1 text-[10px] bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 px-2 py-1 rounded text-slate-600 dark:text-zinc-300 transition-colors pointer-events-auto">
                                {{ shortenHash(tx.meta.txHash) }}
                                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                            </a>
                        </div>
                    </div>
                </div>

                <div class="absolute bottom-0 left-0 w-full p-6 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-md flex justify-center z-20">
                    <button @click="txStore.clearTransactions" class="flex-1 py-3 text-sm font-bold bg-slate-800 hover:bg-slate-700 dark:bg-white dark:hover:bg-gray-200 dark:text-black text-white rounded-xl transition-all shadow-lg" :disabled="activeTxCount > 0 && txStore.transactions.length === activeTxCount">
                        {{ $t('transactionStatus.clearCompleted') }}
                    </button>
                </div>
            </div>
        </div>
    </Transition>
</template>

<script setup>
import { computed } from 'vue'
import { useTransactionStore } from '../store/transaction'
import chains from '../data/supported_chains.json'
import { explorerTxUrl } from '../utils/explorer'
import { copy } from '../utils/copy'

const txStore = useTransactionStore()

const activeTxCount = computed(() => txStore.transactions.filter(t => t.status === 'processing' || t.status === 'queued').length)
const successCount = computed(() => txStore.transactions.filter(t => t.status === 'success').length)
const errorCount = computed(() => txStore.transactions.filter(t => t.status === 'error').length)

const shortenHash = (hash) => {
    if(!hash) return ''
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

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
</style>