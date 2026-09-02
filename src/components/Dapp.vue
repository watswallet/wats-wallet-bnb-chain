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
                <div class="flex items-center gap-2">
                    <img :src="logo || '/default-dapp.png'" class="w-5 h-5 rounded-full border border-slate-200 dark:border-transparent shrink-0" @error="e => e.target.src = '/default-dapp.png'">
                    <div class="flex flex-col overflow-hidden">
                        <span class="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold uppercase tracking-wider">{{ $t('send.confirmTransaction.source') }}</span>
                        <span class="text-xs text-slate-700 dark:text-white truncate font-medium transition-colors duration-300">{{ url }}</span>
                    </div>
                </div>
                <div class="px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wide">
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

                    <!-- Gas Fee -->
                    <div class="flex justify-between items-center">
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

            <!-- Insufficient gas warning -->
            <div v-if="insufficientGas && !gasToken" class="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientFee') }}</span>
                    <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.insufficientFeeDesc', { symbol: network.currentNetwork.nativeCurrency.symbol }) }}</span>
                </div>
            </div>

            <!-- Insufficient token balance warning -->
            <div v-if="insufficientTokenBalance" class="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none shrink-0">
                <svg class="w-4 h-4 text-orange-600 dark:text-orange-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-orange-800 dark:text-orange-400">{{ $t('send.confirmTransaction.insufficientBalance') }}</span>
                    <span class="text-[10px] text-orange-600 dark:text-orange-300">{{ $t('send.confirmTransaction.insufficientTokenDesc', { symbol: crypto.sendAsset?.symbol || 'Token' }) }}</span>
                </div>
            </div>

            <!-- Gasless: fee-token selector (only shown when dapp opted-in + chain supported) -->
            <GasTokenSelector
                v-if="gasTokenOptions.length"
                v-model="gasToken"
                :options="gasTokenOptions"
                :native-symbol="network.currentNetwork.nativeCurrency.symbol"
                :native-logo="network.currentNetwork.logoURI || `/chains/${network.currentNetwork.chainId}.png`"
                :sent-asset-address="crypto.transactionData.asset"
                :send-amount="crypto.transactionData.amount"
            />

            <!-- Gasless: selected gas token insufficient balance warning -->
            <div v-if="selectedInsufficient" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300 mb-2">
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
                :class="(isSubmitting || (insufficientGas && !gasToken) || selectedInsufficient || insufficientTokenBalance || isCheckingBalance)
                    ? 'bg-slate-300 dark:bg-zinc-800 text-slate-500 dark:text-zinc-600 cursor-not-allowed shadow-none'
                    : (txType === 'APPROVE' ? 'bg-amber-600 text-white hover:bg-amber-500 shadow-amber-600/20' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-600/20')"
                :disabled="isSubmitting || (insufficientGas && !gasToken) || selectedInsufficient || insufficientTokenBalance || isCheckingBalance" 
                @click="send"
            >
                <div v-if="isSubmitting || isCheckingBalance" class="flex items-center gap-2">
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>{{ isCheckingBalance ? $t('send.confirmTransaction.calculating') : $t('send.confirmTransaction.processing') }}</span>
                </div>
                <span v-else>{{ ((insufficientGas && !gasToken) || selectedInsufficient || insufficientTokenBalance) ? $t('send.confirmTransaction.insufficientBalance') : (txType === 'APPROVE' ? $t('send.confirmTransaction.confirmApprove') : $t('send.confirmTransaction.confirmTx')) }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { cryptoStore } from '../store/crypto'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { pageStore } from '../store/pageStore'
import { computed, nextTick, onMounted, ref } from 'vue'
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
import { rpcUrlsOf } from '../utils/vm'

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
                logo = data.token.image.large || data.token.logoURI || data.token.image || null
                if (symbol === shortenAddress(addr)) symbol = data.token.symbol || symbol
            }
        } catch (e) { /* no logo */ }

        results.push({ symbol, logo, address: addr })
    }
    return results
}

onMounted(async () => {
    await nextTick()
    isCheckingBalance.value = true

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

        // GASLESS (dapp): yalnizca bu dapp gasless'a opt-in yapmissa + zincir destekliyorsa fee-token sun.
        if (isGaslessChain(network.currentNetwork.chainId)) {
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
    } finally {
        isCheckingBalance.value = false
    }
})

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
    const tx = await buildTransaction({
        provider,
        from: crypto.transactionData.from || user.address,
        to: txType.value === 'NATIVE' ? crypto.transactionData.to : crypto.transactionData.asset,
        amount: crypto.transactionData.nativeValue,
        asset: crypto.transactionData.asset,
        data: crypto.transactionData.data
    })

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
    if ((insufficientGas.value && !gasToken.value) || selectedInsufficient.value) return;
    isSubmitting.value = true;
    try {
        const provider = new ethers.JsonRpcProvider(rpc.value)
        const tx = await buildTransaction({
            provider,
            from: crypto.transactionData.from || user.address,
            to: txType.value === 'NATIVE' ? crypto.transactionData.to : crypto.transactionData.asset, // Kontrat işlemlerinde 'to' her zaman kontrattır
            amount: crypto.transactionData.nativeValue, // dapp'in istedigi ETH degeri: kontrat cagrisinda da tasinmali
            asset: crypto.transactionData.asset,
            data: crypto.transactionData.data
        })

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
            bundlerBase: config.bundlerBase,
        }

        const response = await chrome.runtime.sendMessage({ type: "SEND_TRANSACTION", message })

        // background basarisizlikta kanaldan hata FIRLATMAZ; { success:false, error }
        // ile RESOLVE eder. Kontrol edilmezse dapp'e undefined hash'li bir "success"
        // gidiyor ve dapp basarili sandigi islemi undefined ile pollemeye baslıyor.
        const txHash = response?.hash || response?.signature
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