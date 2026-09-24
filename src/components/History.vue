<template>
    <Transition
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-200 ease-in"
        enter-from-class="opacity-0 scale-95"
        enter-to-class="opacity-100 scale-100"
        leave-from-class="opacity-100 scale-100"
        leave-to-class="opacity-0 scale-95"
    >
        <div v-if="selectedTx" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-black/80 p-4 transition-colors duration-300">
            <div class="w-full bg-white dark:bg-[#0c0c0e] border border-slate-200 dark:border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[95%] transition-colors duration-300">
                
                <div class="flex items-center justify-between p-4 border-b border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/5 transition-colors duration-300">
                    <span class="text-sm font-bold text-slate-800 dark:text-white transition-colors duration-300">{{ $t('history.details.title') }}</span>
                    <button @click="selectedTx = null" class="w-8 h-8 rounded-full bg-slate-200 dark:bg-zinc-800 flex items-center justify-center text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-300 dark:hover:bg-zinc-700 transition-colors cursor-pointer">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div class="p-5 overflow-y-auto custom-scrollbar space-y-5">
                    
                    <div class="flex flex-col items-center py-2">
                        <div class="w-16 h-16 rounded-full flex items-center justify-center mb-3 ring-4 ring-white dark:ring-black shadow-sm dark:shadow-none transition-all duration-300" 
                            :class="getStatusColor(selectedTx, true)">
                            <component :is="getIcon(selectedTx)" class="w-8 h-8" />
                        </div>
                        <h3 class="text-lg font-bold text-slate-900 dark:text-white text-center px-4 leading-tight transition-colors duration-300">
                            {{ getShortTitle(selectedTx) }}
                        </h3>
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium mt-1 transition-colors duration-300">{{ formatDate(txDate(selectedTx)) }}</span>
                    </div>

                    <div v-if="selectedTx.category === 'token swap'" class="space-y-2">
                        <div v-for="transfer in getTransfersByDirection(selectedTx, 'send')" :key="transfer.log_index" 
                            class="flex items-center justify-between p-3 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-100 dark:border-red-500/10 transition-colors duration-300">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none">
                                    <img v-if="transfer.token_logo" :src="transfer.token_logo" class="w-5 h-5 rounded-full" @error="$event.target.style.display='none'">
                                    <span v-else class="text-[10px] text-slate-700 dark:text-zinc-300">{{ transfer.token_symbol }}</span>
                                </div>
                                <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('history.details.sent') }}</span>
                            </div>
                            <span class="text-sm font-bold text-slate-800 dark:text-white transition-colors duration-300">-{{ parseFloat(transfer.value_formatted).toFixed(4) }} {{ transfer.token_symbol }}</span>
                        </div>

                        <div class="flex justify-center -my-3 relative z-10">
                            <div class="bg-white dark:bg-[#0c0c0e] p-1 rounded-full border border-slate-200 dark:border-white/10 text-slate-400 dark:text-zinc-500 transition-colors duration-300 shadow-sm dark:shadow-none">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                            </div>
                        </div>

                        <div v-for="transfer in getTransfersByDirection(selectedTx, 'receive')" :key="transfer.log_index" 
                            class="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/10 transition-colors duration-300">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none">
                                    <img v-if="transfer.token_logo" :src="transfer.token_logo" class="w-5 h-5 rounded-full" @error="$event.target.style.display='none'">
                                    <span v-else class="text-[10px] text-slate-700 dark:text-zinc-300">{{ transfer.token_symbol }}</span>
                                </div>
                                <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('history.details.received') }}</span>
                            </div>
                            <span class="text-sm font-bold text-emerald-600 dark:text-emerald-400 transition-colors duration-300">+{{ parseFloat(transfer.value_formatted).toFixed(4) }} {{ transfer.token_symbol }}</span>
                        </div>
                    </div>

                    <div v-else class="text-center p-4 rounded-xl bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                        <span class="block text-2xl font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ getMainAmount(selectedTx) }}</span>
                    </div>

                    <div class="space-y-3 pt-2">
                        <div v-if="selectedTx.method_label" class="flex justify-between items-center p-3 rounded-lg bg-slate-50 dark:bg-zinc-800/30 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                            <span class="text-xs text-slate-500 dark:text-zinc-500">{{ $t('history.details.function') }}</span>
                            <span class="text-[10px] font-mono font-medium px-2 py-1 rounded bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20 transition-colors duration-300">{{ selectedTx.method_label }}</span>
                        </div>

                        <button type="button" class="w-full text-left flex flex-col gap-1 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 dark:bg-zinc-800/30 dark:hover:bg-zinc-800/50 border border-slate-200 dark:border-white/5 group cursor-pointer active:scale-[0.98] transition-all duration-300" @click="copyToClipboard(selectedTx.hash)">
                            <span class="text-xs" :class="copiedHash ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-zinc-500'">{{ copiedHash ? $t('history.details.copied') : $t('history.details.txHash') }}</span>
                            <div class="flex items-center justify-between">
                                <span class="text-xs text-slate-700 dark:text-zinc-300 font-mono truncate mr-2 transition-colors duration-300">{{ formatHash(selectedTx.hash) }}</span>
                                <svg class="w-3 h-3 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            </div>
                        </button>

                        <div class="grid grid-cols-2 gap-3">
                            <div class="p-3 rounded-lg bg-slate-50 dark:bg-zinc-800/30 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                                <span class="block text-[10px] text-slate-500 dark:text-zinc-500 mb-1">{{ $t('history.details.from') }}</span>
                                <span class="text-xs text-slate-700 dark:text-zinc-300 font-mono transition-colors duration-300">{{ modalFrom(selectedTx) }}</span>
                            </div>

                            <div class="p-3 rounded-lg bg-slate-50 dark:bg-zinc-800/30 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                                <span class="block text-[10px] text-slate-500 dark:text-zinc-500 mb-1">{{ $t('history.details.interactedWith') }}</span>
                                <span class="text-xs text-slate-700 dark:text-zinc-300 font-mono transition-colors duration-300">
                                    {{ modalTo(selectedTx) }}
                                </span>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-3">
                            <div class="flex flex-col justify-center p-3 rounded-lg bg-slate-50 dark:bg-zinc-800/30 border border-slate-200 dark:border-white/5 transition-colors duration-300"
                                :class="{ 'col-span-2': isSolanaHistoryRow(selectedTx) || isTon(selectedTx.chainId) }">
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500">{{ $t('history.details.txFee') }}</span>
                                <span class="text-xs text-slate-700 dark:text-zinc-300 font-mono transition-colors duration-300">
                                    <!-- Birim etiketi zincire gore secilir: sabit "ETH" yazsaydi TON ucreti
                                         de ETH gibi gorunurdu (getListAmount'un native dalindaki ayni hataya
                                         detay modalinda da dusulmesin diye). -->
                                    <span v-if="selectedTx.transaction_fee">{{ parseFloat(selectedTx.transaction_fee).toFixed(6) }} {{ ucretBirimi(selectedTx) }}</span>
                                    <!-- Solana satirlari islem ucretini TASIMAZ (bkz. historyRow.js arayuz
                                    sozlesmesi): "Hesaplaniyor..." sonsuza dek gostermek yerine bilinmiyor
                                    isaretlenir; aksi halde asla gelmeyecek bir deger bekleniyormus izlenimi
                                    verirdi. TON'da bu dala DUSULMEZ: /ton/history yalnizca zincire islenmis
                                    kayit dondurdugu icin ucret orada HER ZAMAN bilinir. -->
                                    <span v-else-if="isSolanaHistoryRow(selectedTx)">{{ solanaUcreti(selectedTx) }}</span>
                                    <span v-else class="text-amber-600 dark:text-amber-500 text-[10px]">{{ $t('history.details.calculating') }}</span>
                                </span>
                            </div>
                            <!-- Nonce EVM'e OZGUDUR: TON'da yerine seqno var (elde tutulmuyor), Solana'da
                                 karsiligi hic yok (recent blockhash farkli bir seydir). Var olmayan bir alani
                                 "#undefined" diye gostermektense kutu hic render edilmiyor.
                                 IKI KAPI AYRI DURUYOR cunku AYRI SEYLERE bakiyorlar: TON satiri chainId'siyle
                                 (negatif -239/-3), Solana satiri SATIR BICIMIYLE taninir (isSolanaHistoryRow --
                                 o satirlarda chainId alani yoktur, tek alanli bir kontrol otekini yanlis
                                 siniflandirirdi). Tek bir `&&` ifadesine katlanirlarsa hangi zincirin hangi
                                 gerekceyle elendigi de okunamaz olur. -->
                            <template v-if="!isTon(selectedTx.chainId)">
                                <div v-if="!isSolanaHistoryRow(selectedTx)" class="flex flex-col justify-center p-3 rounded-lg bg-slate-50 dark:bg-zinc-800/30 border border-slate-200 dark:border-white/5 transition-colors duration-300">
                                    <span class="text-[10px] text-slate-500 dark:text-zinc-500">Nonce</span>
                                    <span class="text-xs text-slate-700 dark:text-zinc-300 font-mono transition-colors duration-300">#{{ selectedTx.nonce }}</span>
                                </div>
                            </template>
                        </div>
                    </div>

                    <a :href="getExplorerUrl(selectedTx)" target="_blank" class="flex items-center justify-center w-full py-3 mt-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 dark:text-zinc-400 dark:bg-white/5 dark:hover:bg-white/10 dark:hover:text-white dark:border-white/5 rounded-xl transition-all duration-300 cursor-pointer">
                        {{ $t('history.details.viewOnExplorer') }}
                        <svg class="w-3 h-3 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                    </a>
                </div>
            </div>
        </div>
    </Transition>


    <div class="w-full h-full bg-transparent flex flex-col">
        
        <div v-if="!embedded" class="px-6 pt-6 pb-4 flex items-center justify-between z-10 bg-white dark:bg-[#09090b] border-b border-slate-200 dark:border-white/5 transition-colors duration-300">
            <button @click="page.currentPage = 'home'" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:text-zinc-400 dark:hover:text-white dark:hover:border-zinc-600 transition-all duration-300 cursor-pointer">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span class="text-lg font-bold transition-colors duration-300">{{ $t('history.list.title') }}</span>
            <div class="w-8"></div>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 relative" :aria-busy="loading ? 'true' : 'false'">
            <!-- KOD INCELEMESI (review round 2, Bulgu A): gecmis ucu hata verirken
            yerel bekleyen bir satir VARSA, asagidaki tam-ekran hata blogu devreye
            GIRMEZ (transactions.length === 0 kosulu) -- liste gosterilir ama onceki
            turde hatanin KENDISI ve "tekrar dene" dugmesi TAMAMEN kayboluyordu.
            Kullanici uc cokmusken tek satirlik bir liste gorup "gecmisim silinmis"
            sanabilir, elinde basacak hicbir sey olmadan. Cozum: bilinen satir(lar)
            GORUNMEYE devam eder, hata da INCE bir banner olarak listenin USTUNDE
            kalir -- ne satir kaybolur ne "tekrar dene" yolu. -->
            <div v-if="historyError === 'fetch' && transactions.length > 0" role="status" aria-live="polite" class="flex items-center justify-between gap-3 p-3 mb-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 transition-colors duration-300">
                <div class="flex items-center gap-2 min-w-0">
                    <ExclamationTriangleIcon class="w-4 h-4 text-red-500/80 shrink-0" />
                    <span class="text-xs text-red-600 dark:text-red-300 truncate">{{ $t('history.list.loadError') }}</span>
                </div>
                <button @click="fetchHistory" class="text-xs font-semibold text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200 underline cursor-pointer shrink-0">
                    {{ $t('history.list.retry') }}
                </button>
            </div>
            
            <!-- Iskelet satirlari SALT GORSELDIR: ekran okuyucuya bos kutular
            okutulmaz, yukleniyor bilgisi kapsayicidaki aria-busy ile verilir.
            Yukseklik ve kose yaricapi gercek satirla AYNI tutuluyor ki liste
            geldiginde duzen zipla-masin. -->
            <div v-if="loading" class="space-y-1" aria-hidden="true">
                <div v-for="i in 5" :key="i" class="w-full h-16 rounded-xl bg-slate-100 dark:bg-zinc-800/40 animate-pulse transition-colors duration-300"></div>
            </div>

            <!-- Zincir adresi cozulemedi: kasa kilitli, arka uc henuz hazir degil vb.
            Bos liste ile AYNI GORUNURSE kullanici parasi kaybolmus sanabilir (bkz.
            Task 14 brief) -- bu yuzden AYRI bir durum, AYRI bir metinle gosterilir. -->
            <div v-else-if="historyError === 'address'" role="status" class="flex flex-col items-center justify-center min-h-full py-10 px-6 text-center text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                <ExclamationTriangleIcon class="w-10 h-10 mb-3 text-amber-500" />
                <span class="text-sm font-medium">{{ $t('history.list.addressUnresolved') }}</span>
            </div>

            <!-- Gecmis ucu basarisiz oldu (zaman asimi ya da HTTP hatasi). TON dali
            burada tek bir "yuklenemedi" ekrani gosteriyordu, Solana dali ise ayni
            duruma "tekrar dene" ekledi; iki zincir ARTIK AYNI ekrani paylasiyor
            (ayrisan iki metin, ayni durumun iki farkli aciklamasi demekti).

            KOD INCELEMESI (review round 1, Bulgu 2): "transactions.length === 0"
            KOSULU EKLENDI. Onceden bu blok yalniz historyError'a bakiyordu ve yerel
            bekleyen islem varken bile TAM EKRAN hata/"tekrar dene" ekranini gosterip
            listeyi GIZLIYORDU -- yani loadHistory.js'in yerel kaydi KORUMASI, ust
            katmandaki bu kosul yuzunden hala GORUNMEZ kaliyordu. Simdi: bilinen
            (yerel) bir sey varsa liste gosterilir, yalniz GERCEKTEN hicbir sey
            yoksa tam ekran hata/"tekrar dene" cikar. -->
            <!-- h-full DEGIL min-h-full: gomulu modda (Home'daki aktivite sekmesi)
            kapsayici popup yuksekligine sabitlenince bu blok tam o yuksekligi
            kapliyor ve "tekrar dene" dugmesi gorunur alanin ALTINDA kalip
            ERISILEMEZ oluyordu -- hatadan cikis yolu yoktu. -->
            <div v-else-if="historyError === 'fetch' && transactions.length === 0" role="status" class="flex flex-col items-center justify-center min-h-full py-10 px-6 text-center text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                <ExclamationTriangleIcon class="w-10 h-10 mb-3 text-red-500" />
                <span class="text-sm font-medium">{{ $t('history.list.loadError') }}</span>
                <button @click="fetchHistory" class="mt-3 text-xs font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 underline cursor-pointer">
                    {{ $t('history.list.retry') }}
                </button>
            </div>

            <div v-else-if="transactions.length === 0" class="flex flex-col items-center justify-center min-h-full py-10 px-6 text-center text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                <svg class="w-12 h-12 mb-3 text-slate-300 dark:text-zinc-600 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                <span class="text-sm font-medium">{{ $t('history.list.empty') }}</span>
            </div>

            <!-- GUN BLOKLARI. Tarih her satirda tekrar etmek yerine bir kez basliga
            cikti: 20 satirlik bir listede ayni bilgi 20 kez yaziliyordu ve
            "bugun ne oldu" sorusu ancak satir satir okunarak cevaplanabiliyordu.
            Satirda geriye yalniz saat kaliyor.

            groupByDay SIRALAMAZ (bkz. historyGrouping.js): ust katmanin sirasini
            -- ozellikle one alinan bekleyen kayitlari -- oldugu gibi korur. -->
            <template v-else>
                <!-- role="group" + aria-label: gun basligi GORSEL olarak satirlarin
                ustunde duruyor, ama ekran okuyucu icin aralarinda bir bag yoktu --
                kullanici "Gonderim, -0.5 BNB..." duyup bunun HANGI gune ait
                oldugunu bilemiyordu. -->
                <div v-for="(grup, grupIndex) in gunGruplari" :key="grupIndex" role="group" :aria-label="gunBasligi(grup)">
                    <div class="px-3 pt-3 pb-1">
                        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 transition-colors duration-300">{{ gunBasligi(grup) }}</span>
                    </div>

                    <!-- Kart kabugu (arka plan + cerceve + golge) BIRAKILDI: ayni sekme
                    grubundaki Varliklar listesi cerceve KULLANMIYOR, iki liste artik ayni
                    dili konusuyor. 360px'lik bir ekranda satir basina kazanilan ~8px,
                    goruntudeki satir sayisini 5'ten 6'ya cikariyor. -->
                    <button
                        v-for="tx in grup.rows"
                        :key="tx.hash"
                        @click="selectedTx = tx"
                        :aria-label="satirOzeti(tx)"
                        class="group flex w-full items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-colors duration-200"
                    >
                        <div class="flex items-center gap-3 min-w-0">
                            <!-- Saglayici logosu (borsa vb.) ARTIK durum cercevesinin ICINDE.
                            Eskiden logo cerceveyi TAMAMEN degistiriyordu ve o satirda durum
                            rengi kayboluyordu: bir borsaya giden BASARISIZ islem, sadece borsa
                            logosu olarak goruluyordu -- durum, tam da en cok islem yapilan
                            satirlarda gorunmez oluyordu. -->
                            <div class="min-w-10 h-10 rounded-full flex items-center justify-center border border-slate-200 dark:border-white/5 transition-colors duration-300"
                                :class="getStatusColor(tx)">
                                <img v-if="tx.to_address_entity_logo" :src="tx.to_address_entity_logo" alt="" class="w-6 h-6 rounded-full" @error="$event.target.style.display='none'">
                                <component v-else :is="getIcon(tx)" class="w-5 h-5" />
                            </div>

                            <div class="flex flex-col min-w-0">
                                <!-- title: baslik kirpildiginda tam metin fareyle ulasilabilir kalir. -->
                                <span class="truncate text-sm font-bold text-slate-900 dark:text-white text-start transition-colors duration-300" :title="getShortTitle(tx)">{{ getShortTitle(tx) }}</span>
                                <!-- Ikinci satir: bekleyen/basarisizda DURUM, onaylanmista
                                KARSI TARAF. "Onaylandi" her satirda tekrar ediyordu ve tek
                                basarisiz islem 20 "Onaylandi" arasinda kayboluyordu. -->
                                <span v-if="altSatir(tx)" class="truncate text-xs font-medium text-start transition-colors duration-300" :class="altSatirRengi(tx)">{{ altSatir(tx) }}</span>
                            </div>
                        </div>

                        <div class="flex flex-col items-end shrink-0 pl-2">
                            <span class="text-sm font-bold whitespace-nowrap transition-colors duration-300" :class="getListAmountColor(tx)">{{ getListAmount(tx) }}</span>
                            <!-- Buradaki font-mono method_label rozeti ("swapExac...")
                            KALDIRILDI: ekranin en dar ve en degerli sutununda, yalnizca
                            EVM'de dolan, kirpilmis bir teknik metin tutarla yarisiyordu.
                            Detay modalinde tam haliyle duruyor. Yerini saat aldi. -->
                            <span class="text-[11px] text-slate-500 dark:text-zinc-400 font-medium tabular-nums transition-colors duration-300">{{ formatTime(txDate(tx)) }}</span>
                        </div>
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import axios from 'axios'
import { pageStore } from '../store/pageStore'
import { configStore } from '../store/config'
import { networkStore } from '../store/network'
import { useI18n } from 'vue-i18n'
import { explorerTxUrl } from '../utils/explorer'
import { isTon, TON_MAINNET_ID, TON_TESTNET_ID } from '../utils/chainKind'
import { chainVm, isSameChainId } from '../utils/vm'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { toHistoryRows } from '../utils/ton/tonHistoryView'
import { getTonClient } from '../utils/ton/tonClient'
import { jettonsFromTokens } from '../utils/ton/jettonList'
import { getJettonWalletAddress } from '../utils/ton/jettonAddress'
import { loadSolanaHistory } from '../utils/solana/loadHistory'
import { isSolanaHistoryRow, historyStatusKind, solanaSymbolLabel } from '../utils/historyRowDisplay'
import { groupByDay, needsYear } from '../utils/historyGrouping'
import { counterpartyOf } from '../utils/historyCounterparty'
import { swapGivenLeg, solanaFeeLabel, feeUnitFor } from '../utils/historyRowText'
import { evmNativeParts } from '../utils/nativeAmount'
import { accountsForChain } from '../utils/knownRecipients'

import {
    ArrowUpIcon,
    ArrowDownIcon,
    ArrowsRightLeftIcon,
    CodeBracketIcon,
    CubeTransparentIcon,
    ClockIcon,
    ExclamationTriangleIcon
} from '@heroicons/vue/24/outline'

const { t, te, locale } = useI18n() // 2. t fonksiyonunu al
const props = defineProps(['embedded'])

const page = pageStore()
const config = configStore()
const network = networkStore()

const transactions = ref([])
const loading = ref(true)
const selectedTx = ref(null)
// Hash kopyalama onayi: yalniz BASARILI yazmada 1.5 sn "Kopyalandı!" gosterir
// (AddressBook.vue'daki copiedAddress deseniyle ayni).
const copiedHash = ref(false)

// UC AYRI GECMIS KAYNAGI, TEK EKRAN:
//   EVM    -> /wallet/history (Moralis semasi: block_timestamp / receipt_status /
//             erc20_transfers)
//   TON    -> /ton/history, tonHistoryView.js AYNI Moralis semasina cevirir
//             (satirlar `chainId` + `category` tasir, `direction` TASIMAZ)
//   Solana -> /solana/history, toHistoryRow KENDI semasini uretir (`direction` +
//             `status` + `timestamp`; `receipt_status`/`category` YOKTUR)
// Satir tipi bu yuzden HER ZAMAN isSolanaHistoryRow / isTon(tx.chainId) ile
// sorulur, aktif aga BAKILARAK degil: liste bekleyen yerel kayitlarla karisik
// gelebiliyor ve tek bir alani okuyan kontrol otekini yanlis siniflandirir.

// Solana dalinin cozdugu KENDI adresi. Modal'daki "Gonderen"/"Etkilesim"
// alanlari icin gerekli: toHistoryRow yalniz `counterparty` + `direction`
// dondurur (bkz. historyRow.js arayuz sozlesmesi), kendi adresimizi TASIMAZ.
const solanaMyAddress = ref('')

// null: hata yok. 'address': aktif hesabin zincir adresi cozulemedi (kasa
// kilitli, arka uc henuz hazir degil vb). 'fetch': gecmis ucu basarisiz oldu
// (zaman asimi ya da HTTP hatasi). Bu AYRIM sart: bos liste ile "adresin
// cozulemedi" AYNI GORUNURSE kullanici parasi kaybolmus sanabilir (bkz. Task 14
// brief; TON tarafinda ayni gerekce spec'te "asla bos/sifir gostermez" olarak
// yaziliydi).
//
// BIRLESTIRME NOTU: TON dali burada boolean bir bayrak (`historyError = true`)
// tutuyordu ve tek bir "yuklenemedi" ekrani gosteriyordu. Solana dalinin uc
// degerli hali onu KAPSAR (ayni ekran + "tekrar dene" + satir varken bannerlasma),
// bu yuzden TEK gosterim tutuldu ve TON kolu 'fetch' yaziyor.
//
// Kapsam bilerek EVM DISI zincirlerle sinirli: EVM kolunda hata olsa da yerel
// bekleyen kayitlar goruntude kaliyor, bu onceden var olan davranis
// DEGISTIRILMEDI.
const historyError = ref(null)

// Karsi tarafin ISMINI cozmek icin okunan iki liste (adres defteri + kendi
// hesaplarim). Gecmis yuklemesinden AYRI tutulur: bu okuma basarisiz olursa
// satirlarda ham adres gorunur, ama GECMIS YUKLENMEYE devam eder.
const bilinenHesaplar = ref([])
const kayitliAdresler = ref([])

// SON ISTEK KAZANIR. Kullanici aktivite sekmesindeyken agi iki kez hizlica
// degistirirse iki fetchHistory es zamanli akar; once BASLAYAN sonra BITEBILIR
// ve ekrana YANLIS zincirin gecmisini yazabilir. Her istek bir numara alir,
// yalnizca en guncel numaraya sahip olan ekrana yazar.
let aktifIstekNo = 0
const istekGecerli = (no) => no === aktifIstekNo

// watch'in AYNI zincir icin tekrar yukleme yapmasini engeller: networkStore'un
// kendi initializeCurrentNetwork()'u kaydi bir kez daha atayabiliyor ve bu,
// onMounted'daki yuklemenin USTUNE ikinci bir istek bindirirdi.
let sonYuklenenZincir = null

const formatDate = (isoString) => {
    if (!isoString) return ''
    const date = new Date(isoString)
    // locale.value kullanarak otomatik dil seçimi (tr-TR, en-US vb.)
    return date.toLocaleString(locale.value, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    })
}

// Satirda YALNIZ saat gosterilir; tarihi gun BASLIGI tasir. Eskiden her satirda
// tam tarih tekrar ediyordu ve 20 satirlik bir listede ayni bilgi 20 kez
// yaziliyordu.
const formatTime = (value) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
}

// Liste, gun bloklarina ayrilir. groupByDay SIRALAMAZ, yalnizca ardisik ayni-gun
// satirlarini bir araya alir (bkz. historyGrouping.js): ust katmanin sirasi --
// ozellikle one alinan bekleyen kayitlar -- oldugu gibi korunur.
const gunGruplari = computed(() => groupByDay(transactions.value, txDate, new Date()))

const gunBasligi = (grup) => {
    if (grup.key === 'today') return t('history.list.today')
    if (grup.key === 'yesterday') return t('history.list.yesterday')
    if (!grup.date) return t('history.list.unknownDate')

    // Yil YALNIZCA farkliysa yazilir: her baslikta tekrarlayan yil gurultudur,
    // ama 2023'teki bir islem de bugunkuyle ayni gorunmemeli.
    return grup.date.toLocaleDateString(locale.value, {
        day: 'numeric',
        month: 'long',
        ...(needsYear(grup.date, new Date()) ? { year: 'numeric' } : {}),
    })
}

const isApprove = (tx) => Boolean(tx?.category?.toLowerCase?.().includes('approve'))

// Ikisi de historyRowText.js'te, GERCEKTEN test edilerek duruyor: ucret birimi
// bir kez sabit 'ETH' yazilmisti, Solana ucreti de bir kez kalici "bilinmiyor"
// gosteriyordu -- ikisi de .vue icinde testsiz kaldiklari icin kacmisti.
const ucretBirimi = (tx) => feeUnitFor(tx, network.currentNetwork)
const solanaUcreti = (tx) => solanaFeeLabel(tx, TUTAR_YOK)

// Onaylanmis bir satirin ikinci satiri. "Onaylandi" yazmak GURULTUYDU: onayli
// olmak zaten varsayilan durum ve tek basarisiz islem 20 "Onaylandi" arasinda
// kayboluyordu. Yeri, gecmise bakmanin bir numarali sebebi olan "kiminle"
// sorusuna acildi.
const onaylananBilgi = (tx) => {
    const verilen = swapGivenLeg(tx, formatNumberShort)
    if (verilen) return verilen
    if (isApprove(tx)) return t('history.list.approvalGranted')

    const karsi = counterpartyOf(tx, {
        accounts: bilinenHesaplar.value,
        savedAddresses: kayitliAdresler.value,
    })
    if (!karsi) return ''

    // Adres KUCULTULMEDEN kisaltilir (formatAddress yalniz ortasini keser):
    // base58 ve base64url adreslerde harf kasasi ANLAMLIDIR.
    return karsi.label || formatAddress(karsi.address)
}

// Ikinci satir ONCE durumu soyler: bekleyen ya da basarisiz bir islemde baska
// her sey ikincildir. Durum burada historyStatusKind uzerinden okunur, ciplak
// receipt_status ile DEGIL -- o alan Solana satirlarinda hic yoktur ve her
// basarili Solana islemini "Basarisiz" gosterirdi.
const altSatir = (tx) => {
    if (historyStatusKind(tx) === 'pending') return t('history.list.statusPending')
    if (historyStatusKind(tx) === 'confirmed') return onaylananBilgi(tx)
    return t('history.list.statusFailed')
}

// OLCULDU (WCAG 2.x, gercek zeminler: acik #fff / hover #f8fafc, koyu #0c0c0e /
// hover ~#1a1a1c). Bu metinler 12px, yani "buyuk metin" istisnasi (3:1) GECERSIZ,
// esik 4.5:1. Secilen tonlar: amber-700 5.05, slate-500 4.77, red-600 4.76,
// zinc-400 7.43, amber-500 9.11, red-400 6.76 -- hepsi hover zemininde de geciyor.
// Onceki secimler (amber-600 3.19, zinc-500 4.05) esigin ALTINDAYDI.
const altSatirRengi = (tx) => {
    if (historyStatusKind(tx) === 'pending') return 'text-amber-700 dark:text-amber-500'
    if (historyStatusKind(tx) === 'confirmed') return 'text-slate-500 dark:text-zinc-400'
    return 'text-red-600 dark:text-red-400'
}

// Ekran okuyucu icin satirin TEK cumlelik ozeti. Satir bir <button>: okuyucu
// aksi halde yalnizca ic metinleri ardi ardina okur ve hangisinin tutar, hangisinin
// karsi taraf oldugu kaybolur.
const satirOzeti = (tx) => {
    const tutar = getListAmount(tx)
    return [
        getShortTitle(tx),
        // TUTAR_YOK ('—') GORSEL bir yer tutucudur: sesli okundugunda cumlenin
        // ortasina anlamsiz bir noktalama girer. .filter(Boolean) onu ELEMEZ
        // cunku bos dize degildir -- bu yuzden acikca disarida birakilir.
        tutar === TUTAR_YOK ? '' : tutar,
        altSatir(tx),
        formatDate(txDate(tx)),
    ].filter(Boolean).join(', ')
}

const getShortTitle = (tx) => {
    if (!tx) return ''

    // Solana satirlari (toHistoryRow) `category`/`summary` TASIMAZ, yalniz
    // `direction` tasir — asagidaki EVM'e ozgu alanlari okumak yerine burada
    // ayrilir. TON satirlari bu daldan GECMEZ: tonHistoryView.js onlara
    // `category: 'send'|'receive'` yazar ve `direction` alani KOYMAZ.
    if (isSolanaHistoryRow(tx)) {
        if (tx.direction === 'self') return t('history.categories.selfTransfer')
        return t(`history.categories.${tx.direction === 'out' ? 'send' : 'receive'}`)
    }

    // Kategoriye göre çeviri anahtarı oluştur (swap, receive, send).
    // replaceAll: `replace` YALNIZ ILK boslugu degistirir; iki kelimeden uzun bir
    // kategori ("cross chain swap") yariya kadar cevrilmis bir anahtar uretirdi.
    const categoryKey = tx.category?.toLowerCase().replaceAll(' ', '_') || 'transaction'

    if (tx.category === 'token swap' && tx.summary) {
        const p = tx.summary.split(' ')
        if (p.length >= 6) {
            // "Swap {token1} to {token2}" yapısı için i18n parametresi
            return t('history.categories.swap_detail', { from: p[2], to: p[5] })
        }
    }

    // Yerel bekleyen kayitlarin `summary`si INGILIZCE ve makine uretimidir
    // ("Sending 0.5 ETH", "Approve Token Limit" -- bkz. processTransaction.js).
    // Kullanicinin gecmise EN COK baktigi an tam da budur: "az once gonderdim,
    // gitti mi". O anda ekranda cevrilmemis bir metin gormemeli.
    //
    // TON memo'su bu daldan GECMEZ: /ton/history yalniz zincire islenmis kayit
    // doner, yani bir TON satiri hicbir zaman 'pending' olmaz ve kullanicinin
    // yazdigi not (summary) kaybolmaz.
    if (historyStatusKind(tx) === 'pending') return kategoriMetni(categoryKey)

    // Eğer summary varsa onu bas, yoksa genel kategori ismini çevir
    return tx.summary || kategoriMetni(categoryKey)
}

// Sozlukte KARSILIGI OLMAYAN bir kategori ekrana ham anahtar yolu olarak
// dusmemeli ("history.categories.approve" gibi -- uygulama bozuk gorunur).
// Moralis 'approve', 'bridge', 'contract interaction' gibi kategoriler de
// donebiliyor; bilinmeyen her kategori genel "Islem" metnine duser.
const kategoriMetni = (key) => (
    te(`history.categories.${key}`) ? t(`history.categories.${key}`) : t('history.categories.transaction')
)

const truncate = (str, n) => {
    return (str && str.length > n) ? str.slice(0, n - 1) + '...' : str
}
const formatNumberShort = (value, { decimals = 4, short = true, minDecimals = 2 } = {}) => {
    if (value === null || value === undefined) return '0'

    const num = Number(value)
    if (isNaN(num)) return '0'

    const abs = Math.abs(num)

    if (short) {
        if (abs >= 1e12) return (num / 1e12).toFixed(2) + 'T'
        if (abs >= 1e9)  return (num / 1e9).toFixed(2) + 'B'
        if (abs >= 1e6)  return (num / 1e6).toFixed(2) + 'M'
        if (abs >= 1e3)  return (num / 1e3).toFixed(2) + 'K'
    }

    if (abs < 1) return num.toFixed(decimals).replace(/\.?0+$/, '')

    return num.toFixed(minDecimals)
}

const copyToClipboard = async (text) => {
    if (!text) return
    try {
        await navigator.clipboard.writeText(text)
        copiedHash.value = true
        setTimeout(() => { copiedHash.value = false }, 1500)
    } catch (err) {
        // Basarisiz kopyalamada onay GOSTERILMEZ: copiedHash'e dokunulmaz.
        console.error('Copy failed', err)
    }
}

// Durum/kategori renkleri TEK yerde. Adlarin ROZET_ oneki tasimasi bilincli:
// bu dosyada "TON" bir ZINCIR adidir (isTon, TON_MAINNET_ID) ve renk tonlarini
// TON_ ile adlandirmak iki ayri kavrami ayni oneke bindirirdi. Daginik yazildiklarinda AYRI AYRI kayiyorlar:
// varsayilan (notr) dal `bg-zinc-800 text-zinc-400` idi ve ACIK TEMA KARSILIGI HIC
// YOKTU -- acik temada her giden islem SIYAH bir daire olarak goruluyordu. Ayni
// sekilde amber/kirmizi tonlari acik zeminde WCAG AA kontrastinin altinda kaliyordu;
// bu iki durum metni ekrandaki EN KRITIK iki metin.
const ROZET_AMBER = (isBg) => (isBg
    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-500 border-amber-500/20'
    : 'bg-amber-500/10 text-amber-700 dark:text-amber-500')
const ROZET_KIRMIZI = (isBg) => (isBg
    ? 'bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20'
    : 'bg-red-500/10 text-red-600 dark:text-red-500')
const ROZET_YESIL = (isBg) => (isBg
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
    : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400')
const ROZET_INDIGO = (isBg) => (isBg
    ? 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20'
    : 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400')
const ROZET_NOTR = (isBg) => (isBg
    ? 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700'
    : 'bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400')

const getStatusColor = (tx, isBg = false) => {
    // KOD INCELEMESI (review round 1, "ucuz, ayni dosya"): getIcon ve
    // getShortTitle `!tx` icin savunmali; burasi DEGILDI. Bugun
    // ULASILAMAZ (modal `v-if="selectedTx"` ile sarili) ama bu TUTARSIZLIK
    // tam olarak getIcon(selectedTx.category) cokmesinin nasil sizdigi
    // (bir kardes fonksiyonun ayni savunmayi TASIMAMASI) -- burada da tutulur.
    if (!tx) return 'bg-zinc-800 text-zinc-400 border-zinc-700'

    // Solana satirlari `receipt_status` TASIMAZ (`status`: 'success'|'failed'|
    // 'pending' tasir, bkz. historyRowDisplay.js) — asagidaki EVM kontrolleri
    // Solana'da hep varsayilana duserdi. TON satirlari EVM semasina cevrildigi
    // icin (receipt_status: '1') asagidaki dallardan gecer.
    if (isSolanaHistoryRow(tx)) {
        if (tx.status === 'pending') return ROZET_AMBER(isBg)
        if (tx.status === 'failed') return ROZET_KIRMIZI(isBg)
        if (tx.direction === 'in') return ROZET_YESIL(isBg)
        return ROZET_NOTR(isBg)
    }

    // 🔥 PENDING DURUMU
    if (tx.receipt_status === 'pending') return ROZET_AMBER(isBg)

    if (tx.receipt_status === '0') return ROZET_KIRMIZI(isBg)

    const cat = tx.category?.toLowerCase() || ''
    if (cat.includes('swap')) return ROZET_INDIGO(isBg)
    if (cat.includes('receive')) return ROZET_YESIL(isBg)

    return ROZET_NOTR(isBg)
}

// İKON SEÇİCİYİ GÜNCELLEME (Pending desteği eklendi)
const getIcon = (tx) => {
    // KOD INCELEMESI (Task 14): modal bu fonksiyonu `getIcon(selectedTx.category)`
    // ile cagiriyordu (sablonda `getIcon(selectedTx)`e duzeltildi) — Solana
    // satirlarinda `category` HIC YOK, yani `getIcon(undefined)` gecerdi ve
    // ilk satirdaki `tx.receipt_status` okumasi RENDER ANINDA firlardi (ekran
    // hic acilmadan cokerdi). Savunma burada da tutuluyor.
    if (!tx) return CodeBracketIcon

    // Basarisiz islemde YON degil SONUC onemlidir: kirmizi bir "yukari ok",
    // gonderimin gerceklestigi izlenimini birakiyordu. historyStatusKind uc
    // zincirin de basarisizligini TEK yerden bilir (EVM receipt_status '0',
    // Solana status 'failed'), bu yuzden dal zincir ayrimindan ONCE gelir.
    if (historyStatusKind(tx) === 'failed') return ExclamationTriangleIcon

    // Solana satirlari `receipt_status`/`category` TASIMAZ, `direction` tasir.
    if (isSolanaHistoryRow(tx)) {
        if (tx.status === 'pending') return ClockIcon
        if (tx.direction === 'in') return ArrowDownIcon
        if (tx.direction === 'out') return ArrowUpIcon
        return CubeTransparentIcon
    }

    if (tx.receipt_status === 'pending') return ClockIcon // Bekliyor ikonu

    const category = tx.category
    if (!category) return CodeBracketIcon
    const cat = category.toLowerCase()
    if (cat.includes('swap')) return ArrowsRightLeftIcon
    if (cat.includes('receive')) return ArrowDownIcon
    if (cat.includes('send')) return ArrowUpIcon
    return CubeTransparentIcon
}

// LİSTE RENGİNİ GÜNCELLEME
// Tutari OLMAYAN ya da cozulemeyen satirin isareti. '0' YAZILMAZ: sifir gecerli
// bir tutardir ve kullaniciya parasinin gittigini soyler.
const TUTAR_YOK = '—'

const getListAmountColor = (tx) => {
    if (!tx) return 'text-slate-800 dark:text-white'

    if (isSolanaHistoryRow(tx)) {
        if (tx.status === 'pending') return 'text-amber-700 dark:text-amber-500'
        if (tx.status === 'failed') return 'text-slate-500 dark:text-zinc-400 line-through'
        if (tx.direction === 'in') return 'text-emerald-700 dark:text-emerald-400'
        return 'text-slate-900 dark:text-white'
    }

    if (tx.receipt_status === '0') return 'text-slate-500 dark:text-zinc-400 line-through'
    if (tx.receipt_status === 'pending') return 'text-amber-700 dark:text-amber-500' // Pending ise tutar sarı görünsün
    // Tutari OLMAYAN satirlar (izin) vurgusuz kalir: kehribar/beyaz bir "—" o
    // satiri ekrandaki en onemli sey gibi gosterirdi. Yine de OKUNUR kalir.
    if (isApprove(tx)) return 'text-slate-500 dark:text-zinc-400'
    if (tx.category?.toLowerCase().includes('receive')) return 'text-emerald-700 dark:text-emerald-400'
    return 'text-slate-900 dark:text-white'
}

const getListAmount = (tx) => {
    if (!tx) return TUTAR_YOK

    if (isSolanaHistoryRow(tx)) {
        const prefix = tx.direction === 'out' ? '-' : (tx.direction === 'in' ? '+' : '')
        return `${prefix}${formatNumberShort(tx.amount)} ${solanaSymbolLabel(tx, formatAddress)}`.trim()
    }

    // Izin (approve) satirinda transfer YOKTUR. Eski kod buraya kadar gelip
    // ciplak bir '0' basiyordu: kehribar, buyuk bir sifir. Kullanici bakiyesinin
    // sifirlandigini sanabilir. Tutar yerine "yok" isareti konur, satirin ne
    // oldugunu ikinci satirdaki "Harcama izni verildi" soyler.
    if (isApprove(tx)) return TUTAR_YOK

    if (tx.category === 'token swap') {
        const received = tx.erc20_transfers?.find(t => t.direction === 'receive')
        if (received) {
            return `+${formatNumberShort(received.value_formatted)} ${received.token_symbol || ''}`.trim()
        }
        // Eskiden BOS DIZE donuyordu ve sutun tamamen bos kaliyordu (satir
        // "yuklenmemis" gibi gorunur). Bilinmeyen tutar ACIKCA isaretlenir.
        return TUTAR_YOK
    }

    if (tx.erc20_transfers?.length) {
        const t = tx.erc20_transfers[0]
        const prefix = t.direction === 'send' ? '-' : '+'
        // TON jetton satirlari `jettonSymbol` tasir (bkz. tonHistoryView.js); bu alan
        // varken t.token_symbol'e guvenmemek jetton satirlarinin da "TON" etiketiyle
        // gorunmesini engeller - bu satirin var olma sebebi tam olarak bu hata.
        const symbol = tx.jettonSymbol || t.token_symbol || ''
        return `${prefix}${formatNumberShort(t.value_formatted)} ${symbol}`.trim()
    }

    // BIRIM ZINCIRDEN OKUNUR. Burada sabit 'ETH' yaziliydi: BNB Chain'de 0,5 BNB
    // gonderen kullanici listede "0,5 ETH" goruyordu -- duz bir yalan. Tutarin,
    // isaretin ve sembolun HANGI kurallarla cozuldugu nativeAmount.js'te yazili
    // ve orada test edildi (ozellikle ondaligin aktif agdan OKUNMAMASI sart:
    // okununca TON ekranina dusen EVM satirlari 10^9 kat sisiyordu).
    const native = evmNativeParts(tx, network.currentNetwork)
    if (native.amount !== null) {
        return `${native.sign}${formatNumberShort(native.amount)} ${native.symbol}`.trim()
    }

    return TUTAR_YOK
}

const getMainAmount = (tx) => {
    if (!tx) return TUTAR_YOK

    if (isSolanaHistoryRow(tx)) {
        const prefix = tx.direction === 'out' ? '-' : (tx.direction === 'in' ? '+' : '')
        return `${prefix}${formatNumberShort(tx.amount, { decimals: 6 })} ${solanaSymbolLabel(tx, formatAddress)}`.trim()
    }

    if (isApprove(tx)) return TUTAR_YOK

    if (tx.erc20_transfers?.length) {
        const t = tx.erc20_transfers[0]
        const prefix = t.direction === 'send' ? '-' : '+'
        const symbol = tx.jettonSymbol || t.token_symbol || ''
        return `${prefix}${formatNumberShort(t.value_formatted, { decimals: 6 })} ${symbol}`.trim()
    }

    // NATIVE DAL EKSIKTI: bu fonksiyon yalnizca erc20_transfers'e bakiyordu, yani
    // 12 BNB'lik duz bir gonderimin detay modali tutar alaninda BUYUK bir "0"
    // gosteriyordu -- listede ayni islem dogru sekilde "-12.00 BNB" yazarken.
    // getListAmount ile AYNI (test edilmis) kaynagi kullanir.
    const native = evmNativeParts(tx, network.currentNetwork)
    if (native.amount !== null) {
        return `${native.sign}${formatNumberShort(native.amount, { decimals: 6 })} ${native.symbol}`.trim()
    }

    return TUTAR_YOK
}

const getTransfersByDirection = (tx, dir) => {
    // Bekleyen swap iskeletinde native_transfers HİÇ YOK: doğrudan spread edilince
    // "not iterable" fırlıyor ve detay modalının tamamı render edilemiyordu.
    const transfers = [...(tx?.erc20_transfers || []), ...(tx?.native_transfers || [])]
    return transfers.filter(t => t.direction === dir)
}

const formatAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''
const formatHash = (hash) => hash ? `${hash.slice(0, 10)}...${hash.slice(-10)}` : ''

const getExplorerUrl = (tx) => {
    // TON'da baglanti ADRES sayfasina gider (bkz. explorer.js), hash'e degil. 'Benim'
    // TON adresim satirin yonune gore from_address ya da to_address alanindadir
    // (toHistoryRows: giden satirda from ben, gelen satirda to ben).
    //
    // Ucuncu argumana yalnizca TON zincirlerinde bakilir; Solana ve EVM satirlari
    // hash ile cozulur (Solana satirinda hash = imza, bkz. historyRow.js).
    const tonAddress = tx?.category === 'send' ? tx?.from_address : tx?.to_address
    return explorerTxUrl(network.currentNetwork?.chainId, tx?.hash, tonAddress)
}

// Solana satirlarinda tarih `timestamp` (ms sayisi, bkz. historyRow.js) alaninda;
// EVM ve TON satirlarinda `block_timestamp` (ISO dizgi) alaninda. `new Date()`
// ikisini de kabul eder, tek fark hangi alanin okunacagi.
const txDate = (tx) => isSolanaHistoryRow(tx) ? tx.timestamp : tx?.block_timestamp

// toHistoryRow yalniz `counterparty` + `direction` dondurur, kendi adresimizi
// TASIMAZ (bkz. historyRow.js arayuz sozlesmesi) — modal'in "Gonderen"/
// "Etkilesim" alanlari icin kendi adresimiz `solanaMyAddress`ten tamamlanir.
// TON satirlari bu yola GIRMEZ: tonHistoryView.js from_address/to_address'i
// zaten doldurur.
const solanaFrom = (tx) => (tx.direction === 'in' ? tx.counterparty : solanaMyAddress.value)
const solanaTo = (tx) => (tx.direction === 'out' ? tx.counterparty : solanaMyAddress.value)

const modalFrom = (tx) => isSolanaHistoryRow(tx) ? formatAddress(solanaFrom(tx)) : formatAddress(tx?.from_address)
const modalTo = (tx) => {
    if (isSolanaHistoryRow(tx)) return formatAddress(solanaTo(tx))
    return tx?.to_address_label ? truncate(tx.to_address_label, 15) : formatAddress(tx?.to_address)
}

// Kullanicinin izledigi jetton listesinden { jettonCuzdaniAdresi: { symbol, decimals } }
// eslemesini kurar. Bu alan sunucuya gitmezse /ton/history ESKI davranisi doner -
// yalnizca native TON satirlari, jetton satiri HIC gorunmez (bkz. server/controllers/
// tonController.js: hasJettonMap kapisi). Desen Home.vue'daki bakiye okumasindan
// (jettonsFromTokens -> getJettonWalletAddress) BIREBIR alindi, yeni bir yol icat
// edilmedi.
const buildJettonWalletMap = async (owner, currentNetwork) => {
    const jettonWallets = {}

    const { imported_tokens = {}, active_account: acct } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
    const tonChainId = Boolean(currentNetwork?.testnet) ? TON_TESTNET_ID : TON_MAINNET_ID
    // imported_tokens zincir anahtarlarini JSON'dan geldigi gibi (metin) tutar; sayisal
    // anahtar erisimi JS'te otomatik metne cevrilir, yine de iki bicimi de dener.
    const chainTokens = imported_tokens?.[acct?.key]?.[tonChainId]
        || imported_tokens?.[acct?.key]?.[String(tonChainId)]
        || []

    const jettons = jettonsFromTokens(
        chainTokens.filter((t) => t && t.address !== NATIVE_TOKEN_ADDRESS)
    )
    if (jettons.length === 0) return jettonWallets

    const client = getTonClient(config.api)

    // PARALEL - Promise.allSettled: Home.vue'daki bakiye okumasiyla AYNI gerekce (bkz. o
    // dosyanin bas yorumu) - TEK bir jettonun proxy/adres hatasi listenin geri kalanini
    // (diger jettonlar ve native TON satirlari) kaybettirmemeli.
    const results = await Promise.allSettled(jettons.map(async (jetton) => {
        const walletAddress = await getJettonWalletAddress({
            client, owner, master: jetton.master, chainId: tonChainId,
            storage: chrome.storage.local,
        })
        return { walletAddress, jetton }
    }))

    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            const { walletAddress, jetton } = result.value
            jettonWallets[walletAddress] = { symbol: jetton.symbol, decimals: jetton.decimals }
        } else {
            // Adres turetilemeyen jetton sessizce ATLANIR: sunucu esleme icinde onu
            // bulamaz ve o jettonun gecmisi bu yuklemede gorunmez, ama native TON
            // satirlari ve diger jettonlar bundan etkilenmez.
            console.error('Jetton cuzdan adresi turetilemedi:', result.reason)
        }
    })

    return jettonWallets
}

const fetchSolanaTxHistory = async (istekNo) => {
    // KOD INCELEMESI (review round 1, Bulgu 2): `pending_transactions` de
    // okunur ve loadSolanaHistory'ye gecirilir -- aksi halde kullanicinin az
    // once gonderdigi ama Helius'un henuz indekslemedigi islem "Islem
    // bulunamadi" ile kaybolur ve kullanici gonderiminin basarisiz oldugunu
    // sanip TEKRAR gonderir (cift gonderim, bkz. loadHistory.js).
    const { active_account, pending_transactions = [] } = await chrome.storage.local.get(['active_account', 'pending_transactions'])
    const result = await loadSolanaHistory({
        activeAccount: active_account,
        pendingTransactions: pending_transactions,
        // chrome.runtime.sendMessage baglamindan KOPARILMAMASI icin sarmalanir.
        sendMessage: (msg) => chrome.runtime.sendMessage(msg),
    })

    // Bu istek eskidiyse (kullanici agi degistirdi, yeni bir yukleme basladi)
    // ekrana HICBIR SEY yazilmaz: aksi halde gec donen eski istek, yeni zincirin
    // gecmisini ezip kullaniciya YANLIS zincirin islemlerini gosterirdi.
    if (!istekGecerli(istekNo)) return

    solanaMyAddress.value = result.address
    transactions.value = result.transactions
    historyError.value = result.error
}

const fetchHistory = async () => {
    const istekNo = ++aktifIstekNo
    sonYuklenenZincir = network.currentNetwork?.chainId ?? null
    loading.value = true
    // Her denemede sifirlanir: onceki denemeden kalan hata durumu, bu deneme
    // basarili olursa ekranda TAKILI KALMAMALI (gecici hata sonrasi tekrar
    // denendiginde kalici hata gorunmesin).
    historyError.value = null

    // Solana EVM saglayicisi kullanmaz ve gecmis kaynagi tamamen farkli
    // (kendi backend'imizdeki /solana/history, Helius-destekli). Bu dal EVM
    // yolundan ONCE gelir; asagidaki axios.post EVM'e ozgu (`active_account.address`,
    // `/wallet/history`) ve Solana'da anlamsiz.
    //
    // TON'un dali AYRI ve asagida, try'in ICINDE: TON'da yerel bekleyen kayitlar
    // once okunur (EVM adresine bagli olduklari icin listede kalmazlar ama okuma
    // akisi TON dalindan geldigi gibi korunuyor). Solana'da ise bekleyen kayitlar
    // loadSolanaHistory'nin KENDI icinde birlestiriliyor -- iki dal ayri yerlerde
    // duruyor cunku bekleyen kayit birlestirmesi iki zincirde AYRI katmanda.
    if (chainVm(network.currentNetwork) === 'solana') {
        try {
            await fetchSolanaTxHistory(istekNo)
        } catch (e) {
            // loadSolanaHistory kendi hatalarini yutup { error } ile doner;
            // buraya yalniz chrome.storage.local.get gibi beklenmeyen bir
            // cokme duserse girilir. Ekran SONSUZA DEK "yukleniyor" kalmaz.
            console.error('Solana gecmisi yuklenemedi:', e?.message)
            if (!istekGecerli(istekNo)) return
            transactions.value = []
            historyError.value = 'fetch'
        } finally {
            if (istekGecerli(istekNo)) loading.value = false
        }
        return
    }

    // Yerel bekleyen işlemler HER DURUMDA gösterilir. Birleştirme eskiden API
    // çağrısından SONRA yapılıyordu; API hata verdiğinde (sunucunun desteklemediği
    // bir zincir 400 döner, ya da geçici erişim sorunu) catch listeyi boş bırakıyor
    // ve kullanıcı yolda olan kendi işlemini bile göremiyordu.
    let myPendingTxs = []
    try {
        const { active_account, pending_transactions = [] } = await chrome.storage.local.get(['active_account', 'pending_transactions'])

        myPendingTxs = pending_transactions.filter(
            tx => tx.from_address?.toLowerCase() === active_account?.address?.toLowerCase()
        )
        if (!istekGecerli(istekNo)) return
        transactions.value = [...myPendingTxs]

        // TON'un kendi ucu var: /wallet/history Moralis'e gider ve TON'u tanimaz
        // (walletController'daki CHAINS tablosunda -239 yok, 400 doner).
        if (isTon(network.currentNetwork)) {
            const tonAddress = await ensureTonAddress(active_account, {
                testnet: Boolean(network.currentNetwork?.testnet),
            })

            // Bu esleme BOS gelebilir (kullanicinin izledigi jetton yok ya da katalog
            // ucu henuz yok) - bu hata DEGIL, sunucu o durumda sessizce native satirlara
            // duser (bkz. buildJettonWalletMap bas yorumu).
            const jettonWallets = await buildJettonWalletMap(tonAddress, network.currentNetwork)

            const { data: tonData } = await axios.post(`${config.api}/ton/history`, {
                address: tonAddress,
                jettonWallets,
            })
            if (!tonData?.success) throw new Error('TON gecmisi alinamadi')

            // Bekleyen yerel kayitlar EVM adresine bagli; TON'da gosterilmez.
            if (!istekGecerli(istekNo)) return
            // testnet bayragi SART: karsi taraf adresi burada depo konvansiyonuna
            // cevriliyor ve friendly bicim AG BAYRAGI tasir -- mainnet'te UQ...,
            // testnet'te 0Q.... Bayrak gecilmezse testnet satirlari mainnet
            // bicimiyle gorunur ve adres defteriyle eslesemez.
            transactions.value = toHistoryRows(tonData.history, tonAddress, {
                testnet: Boolean(network.currentNetwork?.testnet),
            })
            return
        }

        // API'den GERÇEK geçmişi çek
        const { data } = await axios.post(`${config.api}/wallet/history`, {
            address: active_account.address,
            chainId: network.currentNetwork.chainId
        })

        const apiHistory = data.history || []

        // Pending bir işlem artık API'den geliyorsa yereldeki kopyası atılır.
        const apiHashes = new Set(apiHistory.map(t => t.hash))
        const uniquePendingTxs = myPendingTxs.filter(t => !apiHashes.has(t.hash))

        const combinedList = [...uniquePendingTxs, ...apiHistory]

        // Tarihe göre sırala (Yeni -> Eski)
        combinedList.sort((a, b) => new Date(b.block_timestamp) - new Date(a.block_timestamp))

        if (!istekGecerli(istekNo)) return
        transactions.value = combinedList

    } catch (e) {
        console.error('History fetch error:', e)
        if (!istekGecerli(istekNo)) return
        // Yerel kayıtlar korunur; yalnızca sunucu geçmişi eksik kalır.
        transactions.value = [...myPendingTxs]

        // TON'a OZEL hata durumu: TON'da bekleyen yerel kayitlar EVM adresine bagli
        // oldugundan yukaridaki satir pratikte listeyi TAMAMEN bosaltir — kullanici
        // "İşlem bulunamadı" gorup islemlerinin kayboldugunu sanir (spec: hata
        // durumunda asla bos/sifir gosterilmez). EVM kolunda bu bayrak BILEREK
        // ayarlanmaz: orada en azindan yerel bekleyen kayitlar goruntude kalir, bu
        // onceden var olan davranis burada degistirilmiyor.
        //
        // Deger 'fetch': Solana dalindan gelen uc degerli `historyError` ile AYNI
        // dil. Boylece iki zincir AYNI hata ekranini ("yuklenemedi" + tekrar dene)
        // paylasir; ayri bir TON ekrani tutmak, ayni durumun iki farkli metinle
        // gosterildigi bir ayrisma noktasi olurdu.
        if (isTon(network.currentNetwork)) {
            historyError.value = 'fetch'
        }
    } finally {
        if (istekGecerli(istekNo)) loading.value = false
    }
}

// Adres defteri + kendi hesaplarim: satirda karsi tarafin ISMINI gosterebilmek icin.
// Gecmis yuklemesinden AYRI bir akis ve AYRI bir try/catch: bu okuma patlarsa
// satirlarda ham adres gorunur, ama gecmisin kendisi YUKLENMEYE devam eder.
const loadKnownParties = async () => {
    try {
        const { vaults, saved_addresses } = await chrome.storage.local.get(['vaults', 'saved_addresses'])
        // accountsForChain: TON'da hesabin adresi AYRI bir alanda durur
        // (tonAddress / tonAddressTestnet). Duz `address` okunursa TON agindayken
        // kullanicinin KENDI hesaplari hicbir zaman eslesmez.
        bilinenHesaplar.value = accountsForChain(vaults, network.currentNetwork?.chainId)
        kayitliAdresler.value = Array.isArray(saved_addresses) ? saved_addresses : []
    } catch (e) {
        console.error('Bilinen alicilar okunamadi:', e?.message)
    }
}

// AG DEGISIMI: kullanici aktivite sekmesindeyken agi degistirdiginde liste eski
// zincirin islemlerini gostermeye devam ediyordu ve kullanici dogru zincire
// baktigini saniyordu.
//
// Yukleme onMounted'da KALIR, buraya TASINMAZ: History.ssr.test.js onMounted'i
// onServerPrefetch'e cevirerek ilk yuklemeyi dogruluyor; watch'a tasinirsa o
// testlerde hic istek atilmaz.
//
// Kimlik uzerinden izlenir (kaydin kendisi uzerinden DEGIL): networkStore'un
// initializeCurrentNetwork()'u AYNI zinciri bir kez daha atayabiliyor ve bu,
// onMounted'daki yuklemenin ustune gereksiz ikinci bir istek bindirirdi.
watch(() => network.currentNetwork?.chainId, (yeniZincir) => {
    if (yeniZincir === undefined || yeniZincir === null) return
    if (isSameChainId(yeniZincir, sonYuklenenZincir)) return

    fetchHistory()
    loadKnownParties()
})

onMounted(fetchHistory)
onMounted(loadKnownParties)
</script>
