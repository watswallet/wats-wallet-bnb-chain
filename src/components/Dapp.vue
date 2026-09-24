<template>
    <div class="w-full h-screen flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-emerald-500/5 dark:from-emerald-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <!-- Dapp'in istedigi gonderen hesap bu cuzdanda yok: imzalanacak hesabi
             sessizce degistirmek yerine istek reddedilir. -->
        <div v-if="unknownSender" class="flex-1 min-h-0 px-6 flex flex-col items-center justify-center gap-4 z-10">
            <span class="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center">
                <svg class="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></svg>
            </span>
            <h2 class="text-base font-bold text-center">{{ $t('send.confirmTransaction.unknownSenderTitle') }}</h2>
            <p class="text-xs text-slate-500 dark:text-zinc-400 text-center leading-relaxed">
                {{ $t('send.confirmTransaction.unknownSenderDesc') }}
            </p>
            <span class="text-[10px] font-mono text-slate-400 dark:text-zinc-500 break-all text-center">{{ unknownSender }}</span>
            <button @click="reject" class="mt-2 w-full py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 text-sm font-bold cursor-pointer hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors">
                {{ $t('send.confirmTransaction.cancel') }}
            </button>
        </div>

        <div v-else class="flex-1 min-h-0 px-4 pt-1 flex flex-col gap-3 relative overflow-y-auto custom-scrollbar pb-20 z-10 mt-5">

            <!-- DApp Source Bar -->
            <div class="flex justify-between items-center p-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-lg transition-colors duration-300">
                <!-- `min-w-0` BU SARMALAYICIDA ZORUNLU. Icerideki `truncate` tek basina
                     YETMEZ: bir flex ogesinin otomatik en kucuk genisligi icerigine gore
                     hesaplanir ve nowrap bir metnin min-content'i TAM genisligidir. Olculdu
                     (360px kap, uzun dapp adresi): sarmalayici min-w-0 olmadan cubuk 432px
                     tasiyor ve yontem rozeti sag kenarin 431px disina cikiyordu. Rozet de
                     kendi metnini kisaltabilmeli — getMethodName eslesmeyen isimlerde
                     zincirdeki fonksiyon adini oldugu gibi dondurur, uzunlugu sinirsizdir. -->
                <div class="flex items-center gap-2 min-w-0 flex-1">
                    <img :src="logo || '/default-dapp.png'" class="w-5 h-5 rounded-full border border-slate-200 dark:border-transparent shrink-0" @error="e => e.target.src = '/default-dapp.png'">
                    <div class="flex flex-col overflow-hidden">
                        <span class="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold uppercase tracking-wider">{{ $t('send.confirmTransaction.source') }}</span>
                        <span class="text-xs text-slate-700 dark:text-white truncate font-medium transition-colors duration-300">{{ url }}</span>
                    </div>
                </div>
                <div class="px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wide shrink-0 max-w-[40%] truncate" :title="contractMethodName">
                    {{ contractMethodName }}
                </div>
            </div>

            <!-- Token / Amount Hero -->
            <div class="flex flex-col items-center gap-2 py-1">
                <div class="relative group">
                    <div class="absolute inset-0 blur-xl rounded-full transition-colors duration-300" :class="resolvedTokenLogo === 'CONTRACT' ? 'bg-indigo-500/10 dark:bg-indigo-500/20 group-hover:blur-2xl' : 'bg-emerald-500/10 dark:bg-emerald-500/20 group-hover:blur-2xl'"></div>
                    
                    <div v-if="resolvedTokenLogo === 'CONTRACT'" class="relative w-12 h-12 rounded-full shadow-lg dark:shadow-2xl border-2 border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 flex flex-col items-center justify-center text-indigo-500 dark:text-indigo-400 transition-colors duration-300">
                        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>

                    <img 
                        v-else
                        :src="resolvedTokenLogo" 
                        :alt="crypto.sendAsset?.name || network.currentNetwork?.nativeCurrency?.name" 
                        class="relative w-12 h-12 rounded-full shadow-lg dark:shadow-2xl border-2 border-white dark:border-white/10 bg-slate-100 dark:bg-zinc-900 transition-colors duration-300 object-cover"
                        @error="e => { e.target.src = '/default-token.png'; }"
                    >
                </div>

                <div class="text-center">
                    <template v-if="txType === 'APPROVE'">
                        <h2 class="text-xl font-bold text-amber-600 dark:text-amber-500 tracking-tight transition-colors duration-300">
                            {{ isInfiniteApprove ? $t('send.confirmTransaction.infiniteApprove') : crypto.transactionData.amount + ' ' + crypto.sendAsset?.symbol?.toUpperCase() }}
                        </h2>
                        <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('send.confirmTransaction.grantingApproval') }}</span>
                    </template>
                    
                    <template v-else-if="txType === 'CONTRACT_CALL'">
                        <h2 class="text-xl font-bold text-cyan-600 dark:text-cyan-500 tracking-tight transition-colors duration-300">
                            {{ $t('send.confirmTransaction.contractInteraction') }}
                        </h2>
                        <span v-if="crypto.transactionData.nativeValue !== '0'" class="text-sm font-semibold text-slate-700 dark:text-zinc-300 mt-1 block">
                            {{ $t('send.confirmTransaction.value') }}: {{ crypto.transactionData.nativeValue }} {{ network.currentNetwork.nativeCurrency.symbol }}
                        </span>
                    </template>

                    <template v-else>
                        <h2 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300">
                            -{{ crypto.transactionData.amount }} {{ crypto.sendAsset?.symbol?.toUpperCase() || network.currentNetwork.nativeCurrency.symbol }}
                        </h2>
                    </template>
                </div>
            </div>

            <!-- APPROVE: İnsan dostu açıklama kartı -->
            <div v-if="txType === 'APPROVE'" class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 flex flex-col gap-2 transition-colors duration-300 shrink-0">
                <div class="flex items-center gap-2">
                    <svg class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span class="text-xs font-bold text-amber-800 dark:text-amber-300">{{ $t('send.confirmTransaction.whatDoesThisMean') }}</span>
                </div>
                <p class="text-[11px] text-amber-700 dark:text-amber-300/80 leading-relaxed">
                    <template v-if="isInfiniteApprove">
                        <span v-html="$t('send.confirmTransaction.infiniteApproveDesc', { symbol: crypto.sendAsset?.symbol?.toUpperCase() || 'Token' })"></span>
                    </template>
                    <template v-else>
                        <span v-html="$t('send.confirmTransaction.approveDesc', { amount: crypto.transactionData.amount, symbol: crypto.sendAsset?.symbol?.toUpperCase() || 'Token' })"></span>
                    </template>
                </p>
            </div>

            <!-- ═══════════════ İNSAN DOSTU ÖZET KARTI ═══════════════ -->
            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-lg transition-colors duration-300 shrink-0">
                <div class="px-3 pt-3 pb-1">
                    <div class="flex items-center gap-1.5 mb-2">
                        <svg class="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ $t('send.confirmTransaction.summary') }}</span>
                    </div>
                </div>

                <div class="px-3 pb-3 flex flex-col gap-2.5">
                    <!-- From -->
                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.from') }}</span>
                        <div class="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-zinc-800/50 transition-colors duration-300">
                            <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${user.address}`" class="w-4 h-4 rounded-full bg-slate-200 dark:bg-zinc-700 shrink-0" v-if="user.address" />
                            <span class="text-xs font-bold text-slate-700 dark:text-zinc-300">{{ activeAccountName }}</span>
                            <span class="text-[10px] font-mono text-slate-500 dark:text-zinc-500">({{ shortenAddress(user.address) }})</span>
                        </div>
                    </div>

                    <!-- To / Spender -->
                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">
                            {{ txType === 'APPROVE' ? $t('send.confirmTransaction.spender') : $t('send.confirmTransaction.target') }}
                        </span>
                        <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded-lg transition-colors duration-300" :title="crypto.transactionData.to">{{ shortenAddress(crypto.transactionData.to) }}</span>
                    </div>

                    <!-- Asset -->
                    <div class="flex justify-between items-center" v-if="crypto.sendAsset && crypto.sendAsset.symbol !== 'UNKNOWN'">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.asset') }}</span>
                        <div class="flex items-center gap-1.5">
                            <img v-if="resolvedTokenLogo !== 'CONTRACT'" :src="resolvedTokenLogo" class="w-4 h-4 rounded-full shrink-0" @error="e => e.target.src = '/default-token.png'">
                            <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold transition-colors duration-300" :title="crypto.sendAsset?.name">{{ crypto.sendAsset?.symbol?.toUpperCase() }}</span>
                        </div>
                    </div>

                    <!-- Network -->
                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.network') || 'Network' }}</span>
                        <div class="flex items-center gap-1.5">
                            <img :src="network.currentNetwork?.logoURI || `/chains/${network.currentNetwork?.chainId}.png`" class="w-4 h-4 rounded-full shrink-0" @error="e => e.target.style.display = 'none'">
                            <span class="text-xs text-slate-800 dark:text-zinc-200 font-medium transition-colors duration-300">{{ network.currentNetwork?.name || 'Unknown' }}</span>
                        </div>
                    </div>

                    <!-- Gas Fee. ATS kolunda CIZILMEZ: orada gaz native ile odenmiyor ve
                         bu satir "0.000001 BNB odeyeceksiniz" diyerek kendi ucret kartiyla
                         celisirdi. Ucret o kolda asagidaki ATS kartinda durur. -->
                    <div v-if="!isAtsTransfer" class="flex justify-between items-center">
                        <div class="flex items-center gap-1.5">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.gasFee') }}</span>
                            <span class="text-[9px] text-emerald-600 dark:text-emerald-500 font-bold bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-full">{{ $t('send.confirmTransaction.estimated') }}</span>
                        </div>
                        <div>
                            <span class="text-xs text-slate-800 dark:text-zinc-200 font-bold transition-colors duration-300" v-if="gas">{{ gas }} {{ network.currentNetwork.nativeCurrency.symbol }}</span>
                            <div v-else class="h-4 w-16 bg-slate-100 dark:bg-zinc-800 rounded animate-pulse transition-colors duration-300"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ATS ucret karti. Duzeni ve kurallari Gonder ekranindakiyle AYNI: tutar
                 kahramandir ve kendi satirinda durur, logo tutarin onunde bir para birimi
                 isareti gibi, dolar karsiligi kendi metnine bagli (tutar varken fiyat
                 gelmemis olabilir ve o zaman satir HIC cizilmemeli -- sifirli bir dolar
                 metni "bedava" demek olurdu). -->
            <!-- "en fazla" niteleyicisi YALNIZ ayni-zincir yolunda dogrudur: orada ucret
                 bir UST SINIRDIR ve postOp kullanilmayan gazi iade eder. Capraz-zincirde
                 IADE YOKTUR (remote paymaster'in postOp'u yok) -- o yuzden `show-up-to`
                 ile `no-refund-key` AYNI kosuldan turer ve asla birlikte dolmaz. -->
            <AtsFeeCard
                v-if="isAtsTransfer"
                label-key="send.confirmTransaction.gasFee"
                paid-with-key="send.confirmTransaction.atsPaidWith"
                :no-refund-key="isCrosschain ? 'send.confirmTransaction.atsFeeNoRefund' : null"
                :paid-on-bsc-key="isCrosschain ? 'send.confirmTransaction.atsPaidOnBsc' : null"
                :amount="atsFee != null ? atsFeeDisplay : null"
                :exact="atsTotalExact"
                :usd-text="atsFeeUsdText"
                :symbol="atsSymbol"
                :logo-uri="atsLogoURI"
                :loading="atsLoading"
                :show-up-to="!isCrosschain"
                footer-joined
            >
                <!-- BAKIYE YETMIYOR -- AYNI KARTIN ICINDE. Ayri bir kart olarak cizildiginde
                     ikisi ayni konuyu ("bu ucret ve senin ATS'n") anlatirken ekranda birbirinden
                     kopuyor, arada teknik detaylar akordiyonu kaliyordu. Once sayili hali
                     (eksik miktar), o hesaplanamiyorsa sayisiz uyari -- ikisi ayni anda CIZILMEZ.

                     ZINCIR BUTUN HALDE SLOT'A GIRER: `v-if`/`v-else-if` ciftini bolup
                     birini component'e tasimak "ikisi ayni anda cizilmez" garantisini
                     kirardi. Kirmizi seridin negatif marjlari da kartin `p-3`ine yapisik;
                     kabuk tek dizeye sabitlendigi icin hizalama korunuyor. -->
                <template #shortfall>
                <AtsShortfallNote
                    v-if="showAtsShortfall"
                    :symbol="atsSymbol"
                    :logo-uri="atsLogoURI"
                    :exact="`${atsShortfall} ${atsSymbol}`"
                    :amount-display="atsShortfallDisplay"
                    :usd-text="atsShortfallUsdText"
                    :required-display="atsRequiredTotalDisplay"
                    :balance-display="atsBalanceDisplay"
                />

                <!-- `buy-ats` DISLANIR: o durumda asagidaki engel karti ayni seyi sunucunun
                     kendi metniyle zaten soyluyor, iki yerde tekrarlanmasin. -->
                <div v-else-if="atsInsufficient && !atsLoading && !(atsDecision && atsDecision.action === 'buy-ats')" class="-mx-3 -mb-3 px-3 py-3 rounded-b-xl bg-red-50 dark:bg-red-500/10 border-t border-red-200 dark:border-red-500/20 flex items-start gap-2 transition-colors duration-300">
                    <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.atsInsufficientTitle', { symbol: atsSymbol }) }}</span>
                        <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.atsInsufficientDesc', { amount: atsRequiredDisplay, symbol: atsSymbol }) }}</span>
                        <!-- Logo + dolar, cumlenin ALTINDA kendi satirinda. Tutar cumlede
                             zaten yaziyor; burada TEKRARLANMAZ. Fiyat yoksa satir HIC cizilmez. -->
                        <span v-if="atsRequiredUsdText" class="flex items-center gap-1 mt-0.5 text-[10px] text-red-600/80 dark:text-red-300/70 tabular-nums">
                            <img src="/ats.png" alt="ATS" class="w-3 h-3 rounded-full shrink-0" @error="e => e.target.style.display='none'" />
                            ≈ ${{ atsRequiredUsdText }}
                        </span>
                    </div>
                </div>
                </template>
            </AtsFeeCard>

            <!-- ════ TOKEN PATH ════ -->
            <div v-if="tokenPath.length > 1" class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-lg transition-colors duration-300 shrink-0">
                <div class="px-3 pt-3 pb-1">
                    <div class="flex items-center gap-1.5 mb-2">
                        <svg class="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        <span class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">{{ $t('send.confirmTransaction.tokenPath') }}</span>
                    </div>
                </div>
                <div class="px-3 pb-3">
                    <div class="flex items-center gap-1 flex-wrap">
                        <template v-for="(token, idx) in tokenPath" :key="idx">
                            <div class="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-zinc-800/50 border border-slate-100 dark:border-white/5">
                                <img :src="token.logo || `https://api.dicebear.com/7.x/identicon/svg?seed=${token.address}`" class="w-4 h-4 rounded-full shrink-0" @error="e => e.target.src = `https://api.dicebear.com/7.x/identicon/svg?seed=${token.address}`" />
                                <span class="text-xs font-bold text-slate-700 dark:text-zinc-300">{{ token.symbol }}</span>
                            </div>
                            <svg v-if="idx < tokenPath.length - 1" class="w-3.5 h-3.5 text-slate-400 dark:text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
                        </template>
                    </div>
                </div>
            </div>

            <!-- ═══════════════ TEKNİK DETAYLAR (Collapsible Accordion) ═══════════════ -->
            <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-lg transition-colors duration-300 shrink-0">
                <button 
                    @click="showTechnicalDetails = !showTechnicalDetails" 
                    class="w-full p-3 flex items-center justify-between cursor-pointer group hover:bg-slate-50 dark:hover:bg-white/2 transition-colors"
                >
                    <div class="flex items-center gap-2">
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                        <span class="text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">{{ $t('send.confirmTransaction.technicalDetails') }}</span>
                    </div>
                    <svg 
                        class="w-4 h-4 text-slate-400 dark:text-zinc-500 transition-transform duration-300"
                        :class="showTechnicalDetails ? 'rotate-180' : ''"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </button>
                
                <div v-show="showTechnicalDetails" class="border-t border-slate-100 dark:border-white/5">
                    <div class="p-3 flex flex-col gap-2.5">
                        <!-- Function -->
                        <div class="flex justify-between items-center" v-if="txType === 'CONTRACT_CALL' || txType === 'APPROVE' || txType === 'TRANSFER'">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.function') }}</span>
                            <span class="text-xs font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-1 rounded-lg font-bold transition-colors duration-300">{{ rawFunctionName }}</span>
                        </div>

                        <!-- Contract Address -->
                        <div class="flex justify-between items-center" v-if="txType !== 'NATIVE' && crypto.transactionData.asset">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.contract') }}</span>
                            <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded-lg transition-colors duration-300" :title="crypto.transactionData.asset">{{ shortenAddress(crypto.transactionData.asset) }}</span>
                        </div>

                        <!-- Nonce -->
                        <div class="flex justify-between items-center" v-if="nonce !== null">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.nonce') }}</span>
                            <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded-lg transition-colors duration-300">#{{ nonce }}</span>
                        </div>

                        <!-- Value -->
                        <div class="flex justify-between items-center" v-if="crypto.transactionData.nativeValue && crypto.transactionData.nativeValue !== '0'">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.value') }}</span>
                            <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded-lg transition-colors duration-300">{{ crypto.transactionData.nativeValue }} {{ network.currentNetwork.nativeCurrency.symbol }}</span>
                        </div>

                        <!-- Hex Data -->
                        <div class="flex flex-col gap-1.5" v-if="crypto.transactionData.data && crypto.transactionData.data !== '0x'">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.hexData') }}</span>
                            <div class="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-lg p-2.5 max-h-24 overflow-y-auto custom-scrollbar">
                                <span class="text-[10px] text-slate-600 dark:text-zinc-400 font-mono break-all leading-relaxed">{{ crypto.transactionData.data }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Engel karti. `decision.severity` kartin tonunu, `action` butonunu belirler.
                 KIRMIZI YALNIZ `blocked` icin (kimsenin cozemeyecegi durum); `transient`/
                 `operator`/`user` KEHRIBAR kalir -- gecici bir /status aksakligina kirmizi
                 "engellendi" demek kullaniciyi gonderilebilir bir islemi iptal etmeye iter.
                 'internal' ailesi HIC cizilmez (kod duzeltir, kullaniciya gosterilmez) ve
                 asagidaki jenerik hata karti o durumda tek geri bildirim olarak kalir. -->
            <!-- KURULUM DUSTU. Diger tum ucret/bakiye kartlarindan ONCE gelir:
                 onlar "su sayi sorunlu" der, bu "HICBIR sayiya guvenme" der.
                 KIRMIZI ve gonderim KAPALI -- bu kart cizildiyse ekranin gaz
                 tahmini de ATS teklifi de bakiye kontrolu de calismamis olabilir
                 (hangisinin dustugunu bilmiyoruz). TonSendTx'teki ucret karti
                 BILGILENDIRIR cunku orada self-pay TASARLANMIS bir yedektir;
                 burada oyle bir yedek YOK: ATS'in vaadi "native gerekmez" ve
                 sifir BNB'li kullanici onaylarsa islem zincirde duser. -->
            <div v-if="kurulumDustu" class="rounded-xl p-3 flex flex-col gap-1 border bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <span class="text-xs font-bold text-slate-800 dark:text-zinc-100 transition-colors duration-300">{{ $t('send.confirmTransaction.setupFailedTitle') }}</span>
                <span class="text-[10px] text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors duration-300">{{ $t('send.confirmTransaction.setupFailedDesc') }}</span>
                <button type="button" :disabled="isCheckingBalance" @click="kurulumuCalistir"
                        class="mt-1 self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50 cursor-pointer">
                    {{ $t('send.confirmTransaction.atsQuoteRetry') }}
                </button>
            </div>

            <div v-if="isAtsTransfer && atsDecision && !atsLoading && atsDecision.severity !== 'internal' && !showAtsShortfall"
                 class="rounded-xl p-3 flex items-start gap-2 border transition-colors duration-300 shadow-sm dark:shadow-none shrink-0"
                 :class="atsDecision.severity === 'blocked'
                   ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                   : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'">
                <div class="flex flex-col gap-1 min-w-0 w-full">
                    <span class="text-xs font-bold text-slate-800 dark:text-zinc-100">
                        {{ $t(atsDecision.i18nKey, { symbol: atsSymbol }) }}
                    </span>
                    <span v-if="atsDecision.action === 'run-onboarding'" class="text-[10px] text-slate-600 dark:text-zinc-400">
                        {{ $t(atsOnboardingDescKey) }}
                    </span>
                    <span v-else-if="atsDecision.i18nDescKey" class="text-[10px] text-slate-600 dark:text-zinc-400">
                        {{ $t(atsDecision.i18nDescKey) }}
                    </span>
                    <!-- Sunucu metnini AYNEN goster: bootstrap kota hatalari KODSUZ 400 olarak
                         gelir ve ucunu tek bir "hata" mesajina indirgemek kullaniciyi yeni
                         cuzdan acmaya iter. -->
                    <span v-else-if="atsDecision.severity === 'transient' && atsError"
                          class="text-[10px] text-slate-600 dark:text-zinc-400 wrap-break-word">
                        {{ atsError }}
                    </span>
                    <button v-if="atsDecision.action === 'run-onboarding'"
                            :disabled="atsOnboarding || atsLoading"
                            class="mt-1 self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50 cursor-pointer"
                            @click="onRunOnboarding">
                        {{ atsOnboarding ? $t('send.confirmTransaction.atsOnboardingRunning') : $t('send.confirmTransaction.atsOnboardingRun') }}
                    </button>
                    <!-- Yeniden denemenin ANLAMLI oldugu tek durumlar bunlar (atsBlocker.js).
                         suggest-other-chain / explain-foreign / buy-ats icin buton YOK --
                         yeniden denemek cozmez. -->
                    <button v-else-if="atsDecision.action === 'refresh-status' || atsDecision.action === 'retry-later'"
                            :disabled="atsLoading || atsOnboarding"
                            class="mt-1 self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50 cursor-pointer"
                            @click="runAtsQuote">
                        {{ $t('send.confirmTransaction.atsQuoteRetry') }}
                    </button>
                </div>
            </div>

            <!-- Karar karti FIILEN gosteriliyorsa bu jenerik kart bastirilir; iki kart birden
                 cikip celisen eylemler onerirdi. 'internal' severity'de karar karti kendini
                 gizler -- o durumda bu kart TEK geri bildirim kaynagi olarak kalmali. -->
            <div v-if="isAtsTransfer && atsError && (!atsDecision || atsDecision.severity === 'internal')" class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col items-start">
                    <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.atsQuoteFailedTitle') }}</span>
                    <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.atsQuoteFailedDesc') }}</span>
                    <button
                        class="mt-1.5 px-2 py-1 rounded-lg text-[10px] font-bold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/30 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        :disabled="atsLoading"
                        @click="runAtsQuote"
                    >
                        {{ $t('send.confirmTransaction.atsQuoteRetry') }}
                    </button>
                </div>
            </div>


            <!-- ATS kolunda native bakiye uyarisi GAZLA ILGILI DEGIL: gaz ATS'ten odeniyor,
                 eksik olan islemin TASIDIGI tutarin kendisi. Gaz metnini gostermek
                 kullaniciyi "BNB al" diye yanlis yone iterdi. -->
            <div v-if="isAtsTransfer && nativeAmountInsufficient" class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.atsNativeValueTitle') }}</span>
                    <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.insufficientTokenDesc', { symbol: network.currentNetwork.nativeCurrency.symbol }) }}</span>
                </div>
            </div>

            <!-- Insufficient gas warning -->
            <div v-if="!isAtsTransfer && insufficientGas && !gasToken" class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientFee') }}</span>
                    <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.insufficientFeeDesc', { symbol: network.currentNetwork.nativeCurrency.symbol }) }}</span>
                </div>
            </div>

            <!-- Insufficient token balance warning.
                 `showAtsShortfall` ciziliyorsa BU KART CIZILMEZ: ucret kartindaki
                 bolum ayni seyi SAYIYLA soyluyor (eksik tutar + mevcut bakiye),
                 buradaki kart ise sayisiz tekrar -- ekranin en altinda ikinci kez
                 "yeterli ATS yok" demek kullaniciya yeni bir sey anlatmiyordu. -->
            <div v-if="insufficientTokenBalance && !showAtsShortfall" class="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <svg class="w-4 h-4 text-orange-600 dark:text-orange-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-orange-800 dark:text-orange-400">{{ $t('send.confirmTransaction.insufficientBalance') }}</span>
                    <span class="text-[10px] text-orange-600 dark:text-orange-300">{{ $t('send.confirmTransaction.insufficientTokenDesc', { symbol: crypto.sendAsset?.symbol || 'Token' }) }}</span>
                </div>
            </div>

            <!-- Gasless: fee-token selector (only shown when dapp opted-in + chain supported).
                 ATS kolunda SECIM YOKTUR (Gonder akisiyla ayni kural), secici cizilmez. -->
            <GasTokenSelector
                v-if="!isAtsTransfer && gasTokenOptions.length"
                v-model="gasToken"
                :options="gasTokenOptions"
                :native-symbol="network.currentNetwork.nativeCurrency.symbol"
                :native-logo="network.currentNetwork.logoURI || `/chains/${network.currentNetwork.chainId}.png`"
                :sent-asset-address="crypto.transactionData.asset"
                :send-amount="crypto.transactionData.amount"
            />

            <!-- Gasless: selected gas token insufficient balance warning -->
            <div v-if="!isAtsTransfer && selectedInsufficient" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300 mb-2">
                <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientToken') }}</span>
                    <span class="text-xs text-red-500/80 dark:text-red-300/70">{{ $t('send.confirmTransaction.insufficientGasTokenDesc', { symbol: crypto.sendAsset?.symbol?.toUpperCase() || network.currentNetwork.nativeCurrency.symbol }) }}</span>
                </div>
            </div>

        </div>

        <!-- Bottom Action Bar -->
        <div class="absolute bottom-0 left-0 w-full px-4 py-3 bg-slate-50/95 dark:bg-[#09090b]/95 backdrop-blur-md border-t border-slate-200 dark:border-white/5 z-20 flex gap-2 transition-colors duration-300">
            <button class="flex-1 py-3.5 rounded-xl font-bold text-xs bg-slate-200 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-700 dark:text-white transition-all cursor-pointer shadow-sm dark:shadow-none" @click="reject">
                {{ $t('send.confirmTransaction.cancel') }}
            </button>
            
            <button 
                class="flex-2 py-3.5 rounded-xl font-bold text-xs transition-all shadow-lg cursor-pointer flex items-center justify-center gap-2"
                :class="(isSubmitting || sendBlocked || isCheckingBalance || atsLoading)
                    ? 'bg-slate-300 dark:bg-zinc-800 text-slate-500 dark:text-zinc-600 cursor-not-allowed shadow-none'
                    : (txType === 'APPROVE' ? 'bg-amber-600 text-white hover:bg-amber-500 shadow-amber-600/20' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-600/20')"
                :disabled="isSubmitting || sendBlocked || isCheckingBalance || atsLoading"
                @click="send"
            >
                <div v-if="isSubmitting || isCheckingBalance || atsLoading" class="flex items-center gap-2">
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>{{ (isCheckingBalance || atsLoading) ? $t('send.confirmTransaction.calculating') : $t('send.confirmTransaction.processing') }}</span>
                </div>
                <!-- Blokluyken metin SEBEBI soyler: ATS kolunda sebep cogu zaman bakiye
                     DEGIL (kurulum gerekli, /status hazir degil) ve "Yetersiz Bakiye"
                     yazmak kullaniciyi olmayan bir sorunu cozmeye iterdi. -->
                <span v-else>{{ sendBlocked ? blockedLabel : (txType === 'APPROVE' ? $t('send.confirmTransaction.confirmApprove') : $t('send.confirmTransaction.confirmTx')) }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { cryptoStore } from '../store/crypto'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { pageStore } from '../store/pageStore'
import { computed, markRaw, nextTick, onMounted, ref } from 'vue'
import { shortenAddress } from '../utils/shortenAddress'
import { getEstimatedGas } from '../utils/getEstimatedGas'
import axios from 'axios'
import { useTransactionStore } from '../store/transaction'
import { ethers } from 'ethers'
import { buildTransaction } from '../utils/buildTransaction'
import { configStore } from '../store/config'
import { findAccountByAddress } from '../utils/deriveAccount'
import { useI18n } from 'vue-i18n'
import { useGasToken } from '../composables/useGasToken'
import { isGaslessChain } from '../utils/gaslessConfig'
import { dappValueToEtherString } from '../utils/dappNativeValue'
import GasTokenSelector from './GasTokenSelector.vue'
import AtsShortfallNote from './AtsShortfallNote.vue'
import AtsFeeCard from './AtsFeeCard.vue'
import { rpcUrlsOf } from '../utils/vm'
import { useAtsFee } from '../composables/useAtsFee'
import { useAtsFuel } from '../composables/useAtsFuel'
import { useUsdPrice } from '../composables/useUsdPrice'
import { isAtsChain, getAtsConfig, ATS_COINGECKO_ID, ATS_LOGO_URI } from '../utils/atsConfig'
import { isNativeAmountInsufficient, pickFeeBranch } from '../utils/atsFee'
import { atsShortfallAmount } from '../utils/atsShortfall'
import { formatUsd, tokenToUsd } from '../utils/assetPrice'
import { isRevertError } from '../utils/dappGasPreflight'
import { tokenLogo } from '../utils/tokenLogo'

const { t } = useI18n()

const txStore = useTransactionStore()
const crypto = cryptoStore()
const network = networkStore()
const user = userStore()
const page = pageStore()
const config = configStore()

const gas = ref(null)
const from_dapp = ref(false)
const url = ref('')
const logo = ref('')
const currentRequestId = ref(null)
const rpc = ref(null)
const activeAccountName = ref('Account')
// Islemi imzalayacak hesap: dapp'in istedigi `from`. Aktif hesap DEGIL.
const signerAccount = ref(null)
const unknownSender = ref('')
// Dapp'in kendi bildirdigi gas limiti (istekteki `gas`): zincir tahmini
// basarisiz oldugunda yayin icin tek guvenli yedek.
const dappGasLimit = ref(null)
// transferFrom/safeTransferFrom'da tokenlarin GERCEKTEN ciktigi adres
// (calldata args[0]); bakiye kontrolu imzalayana degil buna bakmali.
const tokenDebitAddress = ref(null)

// YENİ STATE'LER: Dinamik Parser için
const txType = ref('NATIVE') // Seçenekler: NATIVE, TRANSFER, APPROVE, CONTRACT_CALL
const contractMethodName = ref('Transfer')
const isInfiniteApprove = ref(false)
const nonce = ref(null)
const showTechnicalDetails = ref(false)
const rawFunctionName = ref('')
const tokenPath = ref([])

const insufficientGas = ref(false)
const insufficientTokenBalance = ref(false)
const isCheckingBalance = ref(true)
const isSubmitting = ref(false)

const { gasToken, gasTokenOptions, selectedInsufficient, loadGasOptions } = useGasToken()

// ATS: ucret ATS zincirinde HER ZAMAN ATS ile odenir -- Gonder akisinda da, burada da
// (bkz. atsFee.pickFeeBranch). Bu ekranin ATS kartlarini cizmesi bir sus degil, ARKA
// PLANDAKI KAPININ SARTI: background `atsTransfer` bayragini yalnizca "ucret ekranda
// gosterildi ve kullanici onayladi" oldugunda kabul eder.
const {
  atsFee, atsSymbol, isCrosschain, decision: atsDecision,
  nextSteps: atsNextSteps, feeTotal: atsFeeTotal, requiredAts,
  loading: atsLoading, onboarding: atsOnboarding,
  error: atsError, insufficient: atsInsufficient, blocked: atsBlocked,
  beginQuote, failQuote, loadAtsFee, runOnboarding,
} = useAtsFee()

const isAtsTransfer = ref(false)
// Kurulum govdesi dustu mu? Dustuyse EKRANDAKI HICBIR SAYIYA GUVENILEMEZ:
// gaz tahmini, ATS teklifi ve bakiye kontrolunun hangisinin calistigini
// bilmiyoruz. Korlemesine gondermek her zincirde yanlis.
const kurulumDustu = ref(false)
// ATS kolunda gas icin native GEREKMEZ; yalnizca islem native deger TASIYORSA
// (odenmis mint, WETH deposit, duz gonderim) o tutar kadar native gerekir.
const nativeAmountInsufficient = ref(false)
// runAtsQuote'un kurdugu cagri: "Kurulumu baslat" tazelemesi ayni cagriyla fiyatlanir.
const atsCall = ref(null)

// Bakiye ZINCIRDEN okunur (ATS_FUEL_BALANCE, her zaman BSC) -- eksik miktar karti
// icin tek dogru kaynak budur (bkz. ConfirmTransaction'daki ayni not).
const atsFuel = useAtsFuel()
const atsPrice = useUsdPrice({ apiBase: () => config.api })

const atsCfg = computed(() => getAtsConfig(network.currentNetwork?.chainId))
// Logo ZINCIRE BAGLI DEGIL: varlik her zincirde ayni varlik. Kayitta bir deger varsa
// o, yoksa paylasilan sabit -- ama ASLA bos kalmaz (bos kalinca `v-if` logoyu gizler).
const atsLogoURI = computed(() => atsCfg.value?.token?.logoURI || ATS_LOGO_URI)

// ATS miktarlari icin kompakt gosterim: >=0.0001 ise 6 ondalik, altinda 4 anlamli hane.
function atsCompact(value) {
  const n = Number(value)
  if (value == null || !isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n >= 0.0001) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return Number(n.toPrecision(4)).toString()
}

// Bu GONDERIMIN TOPLAM ucreti (per-op x op sayisi): bootstrap modunda iki op gider ve
// her biri ayri tahsil edilir, tek op'unkini gostermek yarisini gostermek olurdu.
const atsFeeDisplay = computed(() => atsCompact(atsFeeTotal.value))
const atsTotalExact = computed(() => atsFeeTotal.value == null ? '' : `${atsFeeTotal.value} ${atsSymbol.value}`)
const atsRequiredDisplay = computed(() => atsCompact(requiredAts.value))

// Fiyat ya da tutar BILINMIYORSA null -> satir HIC cizilmez. Sifirli bir dolar metni
// bu ekranda "ucret bedava" demek olurdu (assetPrice.js'teki ayni kural).
const atsUsd = (amount) => formatUsd(tokenToUsd(amount, atsPrice.price.value))
const atsFeeUsdText = computed(() => atsUsd(atsFeeTotal.value))
const atsRequiredUsdText = computed(() => atsUsd(requiredAts.value))

const atsShortfall = computed(() => atsShortfallAmount({
  required: requiredAts.value,
  balance: atsFuel.balance.value,
}))
const atsShortfallDisplay = computed(() => atsCompact(atsShortfall.value))
const atsShortfallUsdText = computed(() => atsUsd(atsShortfall.value))
const atsBalanceDisplay = computed(() => atsCompact(atsFuel.balance.value))
const atsRequiredTotalDisplay = computed(() => atsCompact(requiredAts.value))

// Kart YALNIZ sunucu "ATS satin al" dedigi durumda ve YALNIZ gercek bir sayi
// hesaplanabildiginde cizilir; sayi yoksa asagidaki kehribar/kirmizi uyari yerinde kalir.
const showAtsShortfall = computed(() =>
  isAtsTransfer.value && !atsLoading.value &&
  atsDecision.value?.action === 'buy-ats' && atsShortfall.value != null)

const atsOnboardingDescKey = computed(() => atsNextSteps.value.length > 1
  ? 'send.confirmTransaction.atsOnboardingDesc'
  : 'send.confirmTransaction.atsBudgetLowDesc')

// Islem bloklanir:
//  - ATS kolunda: ucret alinamadi/yetersiz VEYA gonderilen native tutari karsilanmiyor
//  - digerlerinde: (native gas yetersiz VE token secilmemis) VEYA secili token yetersiz
// Token bakiyesi AYRI tutulur: o ucretle ilgili degil, iki kolda da ayni sekilde bloklar.
const feeBlocked = computed(() => isAtsTransfer.value
  ? (atsBlocked.value || nativeAmountInsufficient.value)
  : ((insufficientGas.value && !gasToken.value) || selectedInsufficient.value))

// `kurulumDustu` AYRI bir terim, `feeBlocked`in icine konmadi: o computed ATS ve
// native kollarini AYIRIYOR, oysa kurulum dustugunde HANGI KOLDA oldugumuzu bile
// bilmiyoruz (`isAtsTransfer` atanamadan firlamis olabilir).
const sendBlocked = computed(() => kurulumDustu.value || feeBlocked.value || insufficientTokenBalance.value)

// Buton metni BLOKLAMA SEBEBINI soylemeli: ATS kolunda sebep cogu zaman bakiye DEGIL
// (kurulum gerekli, /status hazir degil) ve "Yetersiz Bakiye" yazmak kullaniciyi
// olmayan bir sorunu cozmeye -- daha fazla ATS almaya -- iter.
const blockedLabel = computed(() => {
  const balanceIsTheReason = isAtsTransfer.value
    ? (atsInsufficient.value || nativeAmountInsufficient.value || insufficientTokenBalance.value)
    : true
  return balanceIsTheReason
    ? t('send.confirmTransaction.insufficientBalance')
    : t('send.confirmTransaction.atsCannotSend')
})

// Token logosunu doğru tespit eden computed
const resolvedTokenLogo = computed(() => {
    if (txType.value === 'NATIVE') {
        return network.currentNetwork?.logoURI || `/chains/${network.currentNetwork?.chainId}.png`
    }
    const asset = crypto.sendAsset
    if (!asset || asset.symbol === 'UNKNOWN') return 'CONTRACT'
    return asset.logo || asset.logoURI || asset.image?.large || asset.image?.small || asset.image?.thumb || asset.image || asset.iconUrl || 'CONTRACT'
})

// 1. KATMAN: Genişletilmiş ABI Sözlüğü
const standardABIs = [
    // ERC20 Temel
    "function transfer(address to, uint256 amount)",
    "function approve(address spender, uint256 amount)",
    "function transferFrom(address from, address to, uint256 amount)",
    // ERC721 / ERC1155
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
    "function setApprovalForAll(address operator, bool approved)",
    // Mint
    "function mint(uint256 quantity)",
    "function mint(address to, uint256 quantity)",
    // DEX Swap (Uniswap V2 / PancakeSwap)
    "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
    "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
    "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
    // Multicall
    "function multicall(bytes[] data)",
    "function multicall(uint256 deadline, bytes[] data)",
    // Likidite
    "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)",
    "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline)",
    "function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)",
    "function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline)",
    // Staking / DeFi
    "function deposit(uint256 amount)",
    "function withdraw(uint256 amount)",
    "function stake(uint256 amount)",
    "function unstake(uint256 amount)",
    "function claim()",
    "function claim(uint256 tokenId)",
    "function claimRewards()",
    // WETH
    "function deposit()",
];
const iface = new ethers.Interface(standardABIs);

// i18n-based method name resolver
function getMethodName(fname) {
    const methodMap = {
        'transfer': 'method_transfer',
        'approve': 'method_approve',
        'transferFrom': 'method_transferFrom',
        'safeTransferFrom': 'method_safeTransferFrom',
        'setApprovalForAll': 'method_setApprovalForAll',
        'mint': 'method_mint',
        'swapExactTokensForTokens': 'method_swap',
        'swapTokensForExactTokens': 'method_swap',
        'swapExactETHForTokens': 'method_coinToToken',
        'swapExactTokensForETH': 'method_tokenToCoin',
        'swapTokensForExactETH': 'method_tokenToCoin',
        'swapExactETHForTokensSupportingFeeOnTransferTokens': 'method_coinToToken',
        'swapExactTokensForTokensSupportingFeeOnTransferTokens': 'method_swap',
        'swapExactTokensForETHSupportingFeeOnTransferTokens': 'method_tokenToCoin',
        'multicall': 'method_multicall',
        'addLiquidity': 'method_addLiquidity',
        'addLiquidityETH': 'method_addLiquidity',
        'removeLiquidity': 'method_removeLiquidity',
        'removeLiquidityETH': 'method_removeLiquidity',
        'deposit': 'method_deposit',
        'withdraw': 'method_withdraw',
        'stake': 'method_stake',
        'unstake': 'method_unstake',
        'claim': 'method_claim',
        'claimRewards': 'method_claim',
    }
    const key = methodMap[fname]
    if (key) {
        return t(`send.confirmTransaction.${key}`)
    }
    return fname
}

// Extract token addresses from swap path[] args and resolve their symbols
async function extractTokenPath(decoded, fname, provider) {
    const swapFunctions = [
        'swapExactTokensForTokens', 'swapTokensForExactTokens',
        'swapExactETHForTokens', 'swapExactTokensForETH',
        'swapTokensForExactETH',
        'swapExactETHForTokensSupportingFeeOnTransferTokens',
        'swapExactTokensForTokensSupportingFeeOnTransferTokens',
        'swapExactTokensForETHSupportingFeeOnTransferTokens',
    ]
    const liquidityFunctions = [
        'addLiquidity', 'removeLiquidity',
    ]

    let addresses = []

    if (swapFunctions.includes(fname)) {
        // All Uniswap V2 swap functions have path as address[]
        const fragment = decoded.fragment
        const pathIdx = fragment.inputs.findIndex(inp => inp.name === 'path')
        if (pathIdx >= 0 && decoded.args[pathIdx]) {
            addresses = [...decoded.args[pathIdx]]
        }
    } else if (liquidityFunctions.includes(fname)) {
        // addLiquidity(tokenA, tokenB, ...) / removeLiquidity(tokenA, tokenB, ...)
        if (decoded.args[0] && decoded.args[1]) {
            addresses = [decoded.args[0], decoded.args[1]]
        }
    } else if (fname === 'addLiquidityETH' || fname === 'removeLiquidityETH') {
        // addLiquidityETH(token, ...) + native
        if (decoded.args[0]) {
            addresses = [decoded.args[0]]
            // Add native currency as placeholder
            tokenPath.value = []
            const nativeSym = network.currentNetwork?.nativeCurrency?.symbol || 'ETH'
            const nativeLogo = network.currentNetwork?.logoURI || null
            const resolved = await resolveTokenAddresses([decoded.args[0]], provider)
            tokenPath.value = [{ symbol: nativeSym, logo: nativeLogo, address: 'native' }, ...resolved]
            return
        }
    }

    if (addresses.length > 0) {
        tokenPath.value = await resolveTokenAddresses(addresses, provider)
    }
}

async function resolveTokenAddresses(addresses, provider) {
    const symbolAbi = ['function symbol() view returns (string)']
    const results = []
    for (const addr of addresses) {
        let symbol = shortenAddress(addr)
        let logo = null
        try {
            const contract = new ethers.Contract(addr, symbolAbi, provider)
            symbol = await contract.symbol()
        } catch (e) { /* fallback to shortened address */ }

        // Try to get logo from API
        try {
            const { data } = await axios.post(config.api + '/getTokenByAddress', { address: addr })
            if (data.token) {
                // `image` HIC OLMAYAN kayitta eski ifade TypeError atiyordu.
                logo = tokenLogo(data.token, null)
                if (symbol === shortenAddress(addr)) symbol = data.token.symbol || symbol
            }
        } catch (e) { /* no logo */ }

        results.push({ symbol, logo, address: addr })
    }
    return results
}

// KURULUM TEK PARCA VE YENIDEN CALISTIRILABILIR.
//
// Eskiden bu govde dogrudan onMounted icindeydi ve sonundaki catch yalnizca
// console'a yaziyordu. Denetim (2026-09-14) sonucu: govdenin ORTASINDA bir RPC
// cagrisi dustugunde (provider.getBalance :1123 `.catch()` TASIMIYOR)
// `isAtsTransfer` false KALIYOR, `insufficientGas` false KALIYOR, dolayisiyla
// `feeBlocked`in HICBIR kolu calismiyor ve islem SESSIZCE kullanicinin NATIVE
// gaziyla yayinlaniyordu. ATS'in vaadi "native gerekmez"; sifir BNB'li kullanici
// bunu onayliyor ve islem zincirde dusuyordu.
//
// KARDES EKRAN bu hatayi TASIMIYOR: ConfirmTransaction.vue'nun onMounted'inda
// GLOBAL try/catch YOK ve `isAtsTransfer` teklif cagrisindan ONCE kuruluyor
// (:1347), yani teklif dusse bile ekran ATS kolunda kalip `atsBlocked` ile
// engelliyor. Buradaki cozum o yapiyi kopyalamak DEGIL: "bayragi erken kur"
// yalnizca bayraktan ONCEKI hatalari kapatirdi. ACIK bir basarisizlik durumu
// govdedeki HER firlatma noktasini kapsar.
async function kurulumuCalistir() {
    await nextTick()
    isCheckingBalance.value = true
    // "Tekrar dene" ayni fonksiyonu cagirir; onceki basarisizlik TEMIZLENMELI,
    // yoksa duzelen bir kurulumdan sonra da blok yapisir kalirdi.
    kurulumDustu.value = false

    // Store paylasimli: onceki bir akistan (dapp istegi YA DA cuzdan ici
    // gonderim) kalan degerler bu ekrana sizmasin diye her acilista sifirlanir.
    // sendAsset sifirlanmazsa NATIVE transferin basligi onceki akisin token
    // sembolunu tasir ('-0.001 USDC' gibi) -- imzalanan sey ETH'dir.
    crypto.transactionData.nativeValue = '0'
    crypto.sendAsset = null

    try {
        const { current_request, currentNetwork, active_account } = await chrome.storage.local.get(['current_request', 'currentNetwork', 'active_account'])

        // F5 (kod incelemesi): bu ekran TAMAMEN EVM'e ozel. App.vue normalde Solana
        // aktifken buraya hic yonlendirmez (onMounted/storage.onChanged guard'lari),
        // ama `current_request` Solana'ya gecilmeden ONCE yazilmis olabilir ve bir
        // MV3 service-worker yeniden baslatilmasinda (pendingRequests Map'i BOSALIR)
        // o guard'lardan biri atlanip dogrudan buraya duselebilir. `currentNetwork.rpc[0].url`
        // guard'siz okumak Solana kaydinda (rpc alani BILEREK yok, bkz. vm.js)
        // TypeError atardi -- tam olarak rpcUrlsOf'un onlemek icin var oldugu cokme,
        // dapp onay ekraninin TAM ORTASINDA.
        const rpcUrl = rpcUrlsOf(currentNetwork)[0]
        if (!rpcUrl) {
            if (current_request?.type === 'SEND_TX' && current_request.id) {
                chrome.runtime.sendMessage({
                    type: 'SEND_TX_REJECTED',
                    requestId: current_request.id,
                    target: 'wats_content_script',
                    status: 'error',
                    error: { code: 4901, message: 'Chain Disconnected' }
                })
            }
            await chrome.storage.local.remove('current_request')
            page.currentPage = 'home'
            return
        }
        rpc.value = rpcUrl

        if (active_account && active_account.name) {
            activeAccountName.value = active_account.name
        }
        const provider = new ethers.JsonRpcProvider(rpc.value)
        
        if (current_request && current_request.type === 'SEND_TX') {
            from_dapp.value = true
            currentRequestId.value = current_request.id
            url.value = current_request.origin
            logo.value = current_request.favicon

            const txData = current_request.txData
            const rawData = txData.data || '0x'
            const rawValue = txData.amount || '0x0'

            // Onceki cuzdan-ici gonderimden kalan alici etiketi dapp islemine sizmasin
            crypto.transactionData.toLabel = null

            // Dapp'in istedigi native value tek yerde cozulur ve bir daha ezilmez;
            // `amount` asagida token miktariyla degistiriliyor. Deger her bicimde
            // WEI'dir (hex, decimal string, Number) -- bkz. dappNativeValue.js.
            const nativeValue = dappValueToEtherString(rawValue)
            crypto.transactionData.nativeValue = nativeValue

            // Dapp gas bildirdiyse sakla (hex ya da decimal olabilir).
            try {
                dappGasLimit.value = txData.gas ? BigInt(txData.gas) : null
            } catch { dappGasLimit.value = null }

            // Dapp islemi BELIRLI bir hesap icin istiyor. Bu adres yok sayilip aktif
            // hesapla imzalanirsa, kullanicinin baska bir hesabinin fonlari, kendisinin
            // baska bir hesap icin onayladigini sandigi bir isleme harcanir.
            // (Hesap degistirildiginde dapp'e accountsChanged gonderilmiyordu, bu yuzden
            // dapp hala eski hesabi bagli saniyor.)
            const { vaults } = await chrome.storage.local.get('vaults')
            signerAccount.value = txData.from
                ? findAccountByAddress(vaults, txData.from)
                : active_account

            if (!signerAccount.value) {
                unknownSender.value = txData.from || ''
                return
            }

            crypto.transactionData.from = signerAccount.value.address
            activeAccountName.value = signerAccount.value.name || activeAccountName.value

            // 🔥 DİNAMİK PARSER BAŞLIYOR 🔥
            if (rawData === '0x' || rawData === '') {
                // NATIVE (ETH) TRANSFER
                txType.value = 'NATIVE'
                contractMethodName.value = t('send.confirmTransaction.nativeSend')
                rawFunctionName.value = ''
                crypto.transactionData.asset = null
                crypto.transactionData.to = txData.to
                crypto.transactionData.amount = nativeValue
                crypto.transactionData.data = '0x'
            } else {
                // KONTRAT ETKİLEŞİMİ VAR
                crypto.transactionData.asset = txData.to // İşlemin gittiği kontrat
                crypto.transactionData.data = rawData
                crypto.transactionData.amount = nativeValue

                // Ethers.js ile yerel sözlükte (ABI) arama yap
                let decoded = null
                try { decoded = iface.parseTransaction({ data: rawData, value: rawValue }) } catch (e) {}

                if (decoded) {
                    const fname = decoded.name

                    if (fname === 'transfer') {
                        txType.value = 'TRANSFER'
                        contractMethodName.value = getMethodName(fname)
                        rawFunctionName.value = fname
                        crypto.transactionData.to = decoded.args[0]
                        await fetchTokenInfo(crypto.transactionData.asset, provider, decoded.args[1])

                    } else if (fname === 'transferFrom') {
                        txType.value = 'TRANSFER'
                        contractMethodName.value = getMethodName(fname)
                        rawFunctionName.value = fname
                        // Tokenlar args[0]'dan cikar; imzalayan yalniz allowance
                        // sahibi olabilir. Bakiye kontrolu bu adrese bakmali.
                        tokenDebitAddress.value = decoded.args[0]
                        crypto.transactionData.to = decoded.args[1]
                        await fetchTokenInfo(crypto.transactionData.asset, provider, decoded.args[2])

                    } else if (fname === 'approve') {
                        txType.value = 'APPROVE'
                        contractMethodName.value = getMethodName(fname)
                        rawFunctionName.value = fname
                        crypto.transactionData.to = decoded.args[0]
                        const rawTokenAmount = decoded.args[1]
                        if (rawTokenAmount === ethers.MaxUint256 || rawTokenAmount.toString() === "115792089237316195423570985008687907853269984665640564039457584007913129639935") {
                            isInfiniteApprove.value = true
                        }
                        await fetchTokenInfo(crypto.transactionData.asset, provider, rawTokenAmount)

                    } else if (fname === 'setApprovalForAll') {
                        txType.value = 'APPROVE'
                        contractMethodName.value = getMethodName(fname)
                        rawFunctionName.value = fname
                        crypto.transactionData.to = decoded.args[0]
                        isInfiniteApprove.value = !!decoded.args[1]
                        crypto.sendAsset = { symbol: 'NFT', name: 'NFT Collection', decimals: 0 }

                    } else if (fname === 'safeTransferFrom') {
                        txType.value = 'TRANSFER'
                        contractMethodName.value = getMethodName(fname)
                        rawFunctionName.value = fname
                        tokenDebitAddress.value = decoded.args[0]
                        crypto.transactionData.to = decoded.args[1]
                        crypto.sendAsset = { symbol: 'NFT', name: 'NFT', decimals: 0 }
                        crypto.transactionData.amount = '#' + decoded.args[2]?.toString()

                    } else {
                        // Known method but no special handler (swap, stake, liquidity...)
                        txType.value = 'CONTRACT_CALL'
                        contractMethodName.value = getMethodName(fname)
                        rawFunctionName.value = fname
                        crypto.transactionData.to = txData.to

                        // Extract token path from swap & liquidity functions
                        await extractTokenPath(decoded, fname, provider)
                    }
                } else {
                    // YEREL SÖZLÜKTE BULUNAMADI: 4byte API'ye soralım
                    txType.value = 'CONTRACT_CALL'
                    crypto.transactionData.to = txData.to
                    try {
                        const methodId = rawData.substring(0, 10)
                        const response = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${methodId}`)
                        const result = await response.json()
                        if (result?.result?.function?.[methodId]?.[0]?.name) {
                            const apiRawName = result.result.function[methodId][0].name.split('(')[0]
                            contractMethodName.value = getMethodName(apiRawName)
                            rawFunctionName.value = apiRawName
                        } else {
                            contractMethodName.value = t('send.confirmTransaction.contractCall')
                            rawFunctionName.value = methodId
                        }
                    } catch (e) {
                        contractMethodName.value = t('send.confirmTransaction.unknownMethod')
                        rawFunctionName.value = rawData.substring(0, 10)
                    }
                    
                    // İşaret edilen kontratın kendisi de aslında bir token olabilir! Kontrol et:
                    await fetchTokenInfo(txData.to, provider, null)
                }
            }
        }

        // Bakiye ve Gas Hesaplamaları
        await calculateGasAndBalance(provider)

        // UCRET KOLU -- karar Gonder akisiyla AYNI saf fonksiyondan gelir (atsFee.pickFeeBranch).
        // ATS zincirinde ucret ATS'tir; ATS'siz zincirde eski Pimlico secicisi (per-dapp
        // opt-in) yerinde kalir.
        const feeBranch = pickFeeBranch({
            fromDapp: true,
            atsEnabled: isAtsChain(network.currentNetwork.chainId),
        })

        if (feeBranch === 'ats') {
            isAtsTransfer.value = true
            // Fiyat teklifle YARISMAZ: beklenirse ucret karti fiyat gelene kadar bos durur.
            atsPrice.loadById(ATS_COINGECKO_ID)
            await runAtsQuote()
        } else if (feeBranch === 'dapp' && isGaslessChain(network.currentNetwork.chainId)) {
            // GASLESS (dapp): yalnizca bu dapp gasless'a opt-in yapmissa fee-token sun.
            let dappHost = ''
            try { dappHost = new URL(url.value).hostname } catch { dappHost = url.value }
            const { dapps = {} } = await chrome.storage.local.get('dapps')
            if (dappHost && dapps[dappHost]?.gasless) {
                await loadGasOptions({
                    chainId: network.currentNetwork.chainId,
                    address: crypto.transactionData.from || user.address,
                    bundlerBase: config.bundlerBase,
                    sentAsset: crypto.transactionData.asset ? {
                        address: crypto.transactionData.asset,
                        symbol: crypto.sendAsset?.symbol,
                        decimals: crypto.sendAsset?.decimals,
                        image: crypto.sendAsset?.image,
                    } : null,
                    sendAmount: crypto.transactionData.amount,
                    nativeInsufficient: insufficientGas.value,
                })
            }
        }

    } catch (e) {
        console.error("Setup error:", e)
        // SESSIZ DEGIL: bu bayrak gonderimi kapatir (bkz. sendBlocked).
        kurulumDustu.value = true
    } finally {
        isCheckingBalance.value = false
    }}

onMounted(kurulumuCalistir)

// YARDIMCI FONKSİYON: Token Bilgilerini ve Decimals'ı Çekme
async function fetchTokenInfo(contractAddress, provider, rawAmountBigInt) {
    const minAbi = ["function decimals() view returns (uint8)"]
    let tokenDecimals = 18
    let onchainDecimalsOk = false

    try {
        const tokenContract = new ethers.Contract(contractAddress, minAbi, provider)
        tokenDecimals = Number(await tokenContract.decimals())
        onchainDecimalsOk = true
    } catch (contractErr) {
        console.warn("Decimals fetch failed", contractErr)
    }

    try {
        const { data } = await axios.post(config.api + '/getTokenByAddress', { address: contractAddress })
        if (data.token) {
            // Zincirden okunan decimals OTORITEDIR: asagida amount bu degerle
            // formatlaniyor. API kaydi (coklu zincir tokeni) farkli soylerse
            // bakiye kontrolu ayni sayiyi baska olcekle okurdu.
            crypto.sendAsset = onchainDecimalsOk ? { ...data.token, decimals: tokenDecimals } : data.token
        } else {
            crypto.sendAsset = { symbol: 'UNKNOWN', name: 'Unknown Token', decimals: tokenDecimals }
        }
    } catch (e) {
        crypto.sendAsset = { symbol: 'UNKNOWN', name: 'Unknown Token', decimals: tokenDecimals }
    }

    if (!isInfiniteApprove.value && rawAmountBigInt) {
        crypto.transactionData.amount = ethers.formatUnits(rawAmountBigInt, tokenDecimals)
    }
}

// DAPP'IN ISTEDIGI CAGRI -- TEK YERDE KURULUR.
//
// Uc yer ayni cagriyi ister: bakiye/gaz on kontrolu, ATS ucret teklifi ve gonderim.
// Ucu de ayni `to/value/data`yi kurmak ZORUNDA: ATS ucreti cagrinin gaz maliyetinden
// turuyor, yani ekranda gosterilen tutar ancak fiyatlanan cagri gonderilenle AYNIYSA
// dogru. Ayri ayri kurulurlarsa fark hicbir yerde gorunmez.
const buildDappCall = (provider) => buildTransaction({
    provider,
    from: crypto.transactionData.from || user.address,
    // Kontrat islemlerinde 'to' her zaman kontrattir
    to: txType.value === 'NATIVE' ? crypto.transactionData.to : crypto.transactionData.asset,
    // dapp'in istedigi native deger: kontrat cagrisinda da tasinmali
    amount: crypto.transactionData.nativeValue,
    asset: crypto.transactionData.asset,
    data: crypto.transactionData.data,
})

// `sentAssetAddress`/`sendAmount` useAtsFee'de TEK bir soruyu cevaplar: "gonderilen
// varlik ATS'nin KENDISI mi?" -- oyleyse gereken ATS'ye tutar da eklenir.
//
// YALNIZ gercek transferde verilir. Approve'da tutar cuzdandan CIKMAZ (yalnizca izin
// verilir) ve kontrat cagrisinda `amount` cozulmus bir token tutari olabilir ama nereye
// gittigi bilinmez; ikisinde de eklemek kullaniciyi OLMAYAN bir eksikle bloklardi.
const atsSentContext = () => (txType.value === 'TRANSFER'
    ? { sentAssetAddress: crypto.transactionData.asset, sendAmount: crypto.transactionData.amount }
    : { sentAssetAddress: null, sendAmount: 0 })

// ATS ucret teklifini (yeniden) calistirir. Idempotent: "Tekrar dene" butonu da,
// acilistaki ilk yukleme de bunu cagirir.
async function runAtsQuote() {
    beginQuote()
    try {
        const provider = new ethers.JsonRpcProvider(rpc.value)
        const call = await buildDappCall(provider)
        // markRaw: deger sablonda kullanilmiyor, yalnizca arka plana tasiniyor.
        atsCall.value = markRaw({ to: call.to, value: call.value?.toString(), data: call.data })
        const address = crypto.transactionData.from || user.address
        await loadAtsFee({
            chainId: network.currentNetwork.chainId,
            address,
            call: atsCall.value,
            ...atsSentContext(),
        })
        // Eksik-miktar kartinin bakiyesi; teklifle ayni anda okunur ki kart tek seferde
        // dolsun (yoksa "eksik" once hesaplanamaz gorunup sonra beliriyordu).
        await atsFuel.load(address, network.currentNetwork.chainId)
    } catch (e) {
        // buildTransaction patlarsa loadAtsFee hic cagrilmaz; failQuote ayni "teklif
        // basarisiz" kartini tetikler (yakalanmamis reddetme yerine).
        console.error('ATS quote error:', e)
        failQuote(e?.message || 'quote failed')
    }
}

// Engel kartinin "Kurulumu baslat" butonu: nextSteps'i backend'in sirasiyla BSC'de
// kosturur (sifir BNB), bitince /status'u tazeler.
async function onRunOnboarding() {
    await runOnboarding({
        chainId: network.currentNetwork.chainId,
        address: crypto.transactionData.from || user.address,
        call: atsCall.value,
        ...atsSentContext(),
    })
}

// YARDIMCI FONKSİYON: Gas Tahmini ve Bakiye Yetersizliği Kontrolleri
async function calculateGasAndBalance(provider) {
    const isTokenTransfer = txType.value === 'TRANSFER'
    
    // Gas Estimate
    gas.value = await getEstimatedGas(
        crypto.transactionData.from || user.address,
        txType.value === 'NATIVE' ? crypto.transactionData.to : crypto.transactionData.asset,
        txType.value === 'NATIVE' ? crypto.transactionData.amount : "0",
        crypto.transactionData.data
    ).catch(() => "0.00")

    const nativeBalance = await provider.getBalance(crypto.transactionData.from || user.address)
    nonce.value = await provider.getTransactionCount(crypto.transactionData.from || user.address, 'pending')

    // Real TX Build for strict gas limit
    const tx = await buildDappCall(provider)

    // On kontrolde tahmin dusurse dapp'in bildirdigi limit tercih edilir;
    // yoksa eski yedek yalniz GOSTERIM/uyari icindir (yayin kapisi send()'te).
    const gasLimit = await provider.estimateGas(tx).catch(() => dappGasLimit.value ?? (isTokenTransfer ? 65000n : 21000n))
    const feeData = await provider.getFeeData()
    const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || 0n
    
    const totalGasCostWei = gasLimit * maxFeePerGas

    // 1. Native Bakiye Kontrolü (Gas + varsa Native Value)
    // Her tx tipi native value tasiyabilir (odenmis mint, WETH deposit, payable transferFrom),
    // sadece NATIVE/CONTRACT_CALL degil.
    let nativeAmountToSendWei = 0n
    if (crypto.transactionData.nativeValue && crypto.transactionData.nativeValue !== "0") {
        nativeAmountToSendWei = ethers.parseEther(crypto.transactionData.nativeValue.toString())
    }

    if (nativeBalance < (totalGasCostWei + nativeAmountToSendWei)) {
        insufficientGas.value = true
    } else {
        insufficientGas.value = false
    }

    // ATS kolunun AYRI sorusu: gaz ATS'ten odendigi icin gaz maliyeti bu hesaba GIRMEZ,
    // yalnizca islemin TASIDIGI native deger gerekir. `insufficientGas`i ATS kolunda
    // kullanmak, ozelligin hedef kitlesini -- 0 BNB'li kullaniciyi -- tam da calisacagi
    // yerde bloklardi. Kural iki ekranda da AYNI fonksiyondan okunur.
    nativeAmountInsufficient.value = isNativeAmountInsufficient({
        nativeBalance: Number(ethers.formatEther(nativeBalance)),
        isNativeSend: nativeAmountToSendWei > 0n,
        sendAmount: crypto.transactionData.nativeValue,
    })

    // 2. Token Bakiye Kontrolü (SADECE TRANSFER işeminde yapılır. Approve için tokene gerek yok)
    if (isTokenTransfer) {
        try {
            const minAbi = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"]
            const tokenContract = new ethers.Contract(crypto.transactionData.asset, minAbi, provider)
            
            // transferFrom'da tokenlar calldata'daki `from`dan (args[0]) cikar,
            // imzalayandan degil; imzalayan yalniz allowance sahibi olabilir.
            const debitAddress = tokenDebitAddress.value || crypto.transactionData.from || user.address
            const tBalanceWei = await tokenContract.balanceOf(debitAddress)
            // `??`: decimals 0 olan token gecerlidir; `||` onu "eksik" sayiyordu.
            const tDecimals = crypto.sendAsset?.decimals ?? await tokenContract.decimals().catch(()=>18)
            const tokenAmountToSendWei = ethers.parseUnits(crypto.transactionData.amount.toString(), tDecimals)

            if (tBalanceWei < tokenAmountToSendWei) insufficientTokenBalance.value = true
            else insufficientTokenBalance.value = false
        } catch (err) {
            console.warn("Token bakiye kontrolü yapılamadı:", err)
        }
    }
}

// ... (serializeTx, send ve reject fonksiyonları tamamen aynı kalacak)
function serializeTx(tx) {
    const allowedFields = ['to', 'from', 'nonce', 'gasLimit', 'gasPrice', 'maxPriorityFeePerGas', 'maxFeePerGas', 'data', 'value', 'chainId', 'type']
    const out = {}
    for (const key of allowedFields) {
        if (tx[key] !== undefined && tx[key] !== null) {
            out[key] = typeof tx[key] === "bigint" ? tx[key].toString() : tx[key]
        }
    }
    return out
}

const send = async () => {
    if (isSubmitting.value) return;
    if (sendBlocked.value) return;
    isSubmitting.value = true;
    try {
        const provider = new ethers.JsonRpcProvider(rpc.value)
        const tx = await buildDappCall(provider)

        // ATS kolunda native gaz tahmini UCRET icin kullanilmaz (arka plan kendi gaz
        // parametrelerini kurar, tx'ten yalniz to/value/data okur) ama cagrinin
        // DUSUP DUSMEYECEGI yine sorulur: dusen bir op'ta paymaster ATS'i yine tahsil
        // eder. Gerekce ve canli olcum: utils/dappGasPreflight.js.
        if (isAtsTransfer.value) {
            try {
                await provider.estimateGas({ ...tx, gasPrice: 0 })
            } catch (e) {
                // Dapp kendi limitini bildirmisse yayin durdurulmaz: eski gaz kolundaki
                // kuralin AYNISI -- "kor sabit YOK, ama dapp'in kendi beyani kabul".
                if (isRevertError(e) && !dappGasLimit.value) {
                    throw new Error('Gas estimation failed: the transaction would likely fail on-chain.')
                }
            }
        } else {
            // Tahmin dusunce KOR bir 65000n ile yayin YAPILMAZ: 150k+ isteyen cagri
            // zincirde kesin revert olur ve kullanici bosuna gaz oder (dapp de hash'i
            // "basarili" yanit sanir). Dapp'in kendi bildirdigi limit varsa o kullanilir;
            // yoksa yayin durdurulur ve dapp'e hata doner.
            const gasLimit = await provider.estimateGas(tx).catch(() => {
                if (dappGasLimit.value) return dappGasLimit.value
                throw new Error('Gas estimation failed: the transaction would likely fail on-chain.')
            })
            const feeData = await provider.getFeeData()
            tx.gasLimit = gasLimit
            tx.maxFeePerGas = feeData.maxFeePerGas
            tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
        }

        const serializedTx = serializeTx(tx)
        delete serializedTx.from

        // Imzalayan hesap onMounted'da COZULDU (dapp'in istedigi `from`). Burada aktif
        // hesaba geri dusmek o cozumu bosa cikarir ve islem yanlis hesapla imzalanir.
        const signer = signerAccount.value
        if (!signer) throw new Error(t('send.confirmTransaction.unknownSenderTitle'))

        const message = {
            // `account` acikca gonderilir: background'in resolveAccount'u aksi halde
            // AKTIF hesaba duser ve dapp'in istedigi hesap yerine onunla imzalar.
            account: signer,
            index: signer.type === 'imported' ? signer.address : signer.derivationPath,
            chainId: network.currentNetwork.chainId,
            amount: crypto.transactionData.amount,
            tx: serializedTx,
            gasToken: gasToken.value,
            atsTransfer: isAtsTransfer.value,
            // Kullanicinin ONAYLADIGI teklif; executeAtsTransfer bunu approvedFee olarak
            // kullanir. PER-OP ucret gonderilir (toplam DEGIL): tavan kontrolu her op'a
            // ayri ayri uygulanir.
            atsQuoted: isAtsTransfer.value ? { transferFee: atsFee.value } : undefined,
            bundlerBase: config.bundlerBase,
        }

        const response = await chrome.runtime.sendMessage({ type: "SEND_TRANSACTION", message })

        // background basarisizlikta kanaldan hata FIRLATMAZ; { success:false, error }
        // ile RESOLVE eder. Kontrol edilmezse dapp'e undefined hash'li bir "success"
        // gidiyor ve dapp basarili sandigi islemi undefined ile pollemeye baslıyor.
        //
        // `txHash` ONCE gelir: ATS kolunda `hash` USEROP hash'idir ve dapp onunla
        // `eth_getTransactionReceipt` cagirsa makbuzu ASLA bulamaz -- site basarili
        // bir islemi sonsuza dek "bekliyor" gosterirdi. Arka plan zincirdeki islem
        // hash'ini ayri alanda dondurur.
        const txHash = response?.txHash || response?.hash || response?.signature
        if (response?.success === false || !txHash) {
            throw new Error(response?.error || t('send.confirmTransaction.txFailed'))
        }

        if (from_dapp.value && currentRequestId.value) {
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_SUCCESS',
                requestId: currentRequestId.value,
                status: 'success',
                data: { result: txHash }
            })
            page.currentPage = 'home'
        } else {
            page.currentPage = 'home'
        }
    } catch (err) {
        console.error("SEND ERROR:", err)
        if (from_dapp.value && currentRequestId.value) {
            await chrome.runtime.sendMessage({
                type: 'SEND_TX_REJECTED',
                requestId: currentRequestId.value,
                status: 'error',
                error: { code: -32603, message: err.message || 'Internal error' }
            })
            page.currentPage = 'home'
        } else {
            // Dapp'siz akista kullanici ekranda kalir; sessizce home'a atmak
            // basarisiz islemi basarili gostermek olur.
            alert(err.message || t('send.confirmTransaction.txFailed'))
        }
    } finally {
        isSubmitting.value = false;
    }
}

const reject = () => {
    if (from_dapp.value && currentRequestId.value) {
        chrome.runtime.sendMessage({
            type: 'SEND_TX_REJECTED',
            requestId: currentRequestId.value,
            target: 'wats_content_script',
            status: 'error',
            error: { code: 4001, message: 'Transaction cancelled by user.' }
        })
        page.currentPage = 'home'
    } else {
        page.currentPage = 'send'
    }
}
</script>