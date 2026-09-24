<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-40 bg-linear-to-b from-indigo-500/10 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
            <SelectFromChain v-if="popups.bridge_from_network"/>
        </Transition>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
            <SelectToChains v-if="popups.bridge_to_network"/>
        </Transition>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
            <bridgeFrom v-if="popups.bridge_from"/>
        </Transition>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
            <bridgeTo v-if="popups.bridge_to"/>
        </Transition>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 scale-95" enter-to-class="opacity-100 scale-100" leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
            <Settings v-if="popups.bridge_settings"/>
        </Transition>

        <section class="flex flex-col h-full relative z-10">
            <div class="flex items-center justify-between px-5 py-4">
                <Back page="home" class="hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
                <span></span>
                
                <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2 ms-5 transition-colors duration-300">{{ $t('bridge.title') }}</h1>
                
                <button 
                    @click="popups.bridge_settings = true"
                    class="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-white/5 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white transition-colors duration-300 cursor-pointer"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m19.588 15.492l-1.814-1.29a6.483 6.483 0 0 0-.005-3.421l1.82-1.274l-1.453-2.514l-2.024.926a6.484 6.484 0 0 0-2.966-1.706L12.953 4h-2.906l-.193 2.213A6.483 6.483 0 0 0 6.889 7.92l-2.025-.926l-1.452 2.514l1.82 1.274a6.483 6.483 0 0 0-.006 3.42l-1.814 1.29l1.452 2.502l2.025-.927a6.483 6.483 0 0 0 2.965 1.706l.193 2.213h2.906l.193-2.213a6.484 6.484 0 0 0 2.965-1.706l2.025.927l1.453-2.501ZM13.505 2.985a.5.5 0 0 1 .5.477l.178 2.035a7.45 7.45 0 0 1 2.043 1.178l1.85-.863a.5.5 0 0 1 .662.195l2.005 3.47a.5.5 0 0 1-.162.671l-1.674 1.172c.128.798.124 1.593.001 2.359l1.673 1.17a.5.5 0 0 1 .162.672l-2.005 3.457a.5.5 0 0 1-.662.195l-1.85-.863c-.602.49-1.288.89-2.043 1.179l-.178 2.035a.5.5 0 0 1-.5.476h-4.01a.5.5 0 0 1-.5-.476l-.178-2.035a7.453 7.453 0 0 1-2.043-1.179l-1.85.863a.5.5 0 0 1-.663-.194L2.257 15.52a.5.5 0 0 1 .162-.671l1.673-1.171a7.45 7.45 0 0 1 0-2.359L2.42 10.148a.5.5 0 0 1-.162-.67L4.26 6.007a.5.5 0 0 1 .663-.195l1.85.863a7.45 7.45 0 0 1 2.043-1.178l.178-2.035a.5.5 0 0 1 .5-.477h4.01ZM11.5 9a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Zm0 1a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5Z"/></svg>
                </button>
            </div>

            <div class="px-4 pb-20 flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar">                
                <div class="relative w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-4 shadow-sm dark:shadow-xl transition-colors duration-300">
                    <div class="flex flex-col gap-3">
                        
                        <div class="flex justify-between items-center">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 transition-colors duration-300">{{ $t('bridge.senderChain') }}</span>
                            <button @click="popups.bridge_from_network = true" class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] border border-slate-200 dark:border-white/5 transition-colors duration-300 cursor-pointer">
                                <img v-if="network.currentNetwork?.logoURI" :src="network.currentNetwork.logoURI" class="w-3.5 h-3.5 rounded-full border border-slate-200 dark:border-transparent">
                                <span class="text-[10px] font-bold text-slate-700 dark:text-zinc-300">{{ network.currentNetwork?.shortName?.toUpperCase() || $t('bridge.select') }}</span>
                                <svg class="w-3 h-3 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                        </div>

                        <div class="flex items-center justify-between gap-4">
                            <button 
                                class="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] text-slate-900 dark:text-white px-3 py-2 rounded-xl transition-colors duration-300 border border-transparent hover:border-slate-300 dark:hover:border-white/10 shrink-0 cursor-pointer" 
                                @click="openIn"
                            >
                                <img v-if="crypto.bridge.inToken" :src="tokenLogo(crypto.bridge.inToken)" :alt="crypto.bridge.inToken.name" class="w-6 h-6 rounded-full border border-slate-200 dark:border-transparent">
                                <span class="font-bold text-sm">{{ crypto.bridge.inToken?.symbol.toUpperCase() || $t('bridge.select') }}</span>
                                <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z"/></svg>
                            </button>

                            <input 
                                v-model="amount" 
                                type="number" 
                                inputmode="numeric" 
                                class="w-full bg-transparent text-3xl font-bold text-right text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-zinc-700 outline-none caret-indigo-500 transition-colors duration-300" 
                                :class="insufficientBalance ? 'text-red-500 dark:text-red-400' : ''" 
                                placeholder="0" 
                            >
                        </div>

                        <!-- Sarma politikasi Swap.vue'daki "Odeyeceksin" satiriyla AYNI gerekce:
                             bakiye + dort cip dar panelde tek siraya sigmiyor ve sarma yokken
                             bakiye metni ortasindan kiriliyordu. Cipler alt satira iner. -->
                        <div class="flex flex-wrap justify-end items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                            <span class="whitespace-nowrap" :class="{ 'text-red-500 dark:text-red-400': insufficientBalance }">{{ $t('bridge.balance') }} {{ Number(inBalance).toFixed(4) || 0 }}</span>
                            <!-- Yuzde cipleri. MAX eskiden TAM bakiyeyi yaziyordu ve native
                                 girdide bu bir cikmazdi (Takas ekraniyla ayni hata). -->
                            <button
                                v-for="percent in SEND_PERCENTS"
                                :key="percent"
                                class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold px-1 transition-colors cursor-pointer"
                                @click="setPercent(percent)"
                            >{{ percent === 1 ? 'MAX' : $t('common.percentChip', { value: percent * 100 }) }}</button>
                        </div>
                    </div>

                    <div class="relative h-8 w-full my-3 flex items-center justify-center">
                        <div class="absolute inset-0 flex items-center">
                            <div class="w-full border-t border-slate-200 dark:border-white/5 transition-colors duration-300"></div>
                        </div>

                        <button 
                            class="relative w-8 h-8 rounded-lg bg-slate-50 dark:bg-[#18181b] border-4 border-white dark:border-[#131315] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-700 transition-all duration-300 shadow-xs dark:shadow-none"
                            :disabled="isReversing"
                            :class="isReversing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer group'"
                            @click="reverse"
                        >
                            <svg 
                                class="w-4 h-4 transition-transform duration-300" 
                                :class="isReversing ? 'animate-spin' : 'group-hover:rotate-180'" 
                                xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
                            >
                                <path fill="currentColor" d="M12 16L7 11l1.4-1.4l2.6 2.6V4h2v8.2l2.6-2.6L17 11l-5 5Z"/>
                            </svg>
                        </button>
                    </div>

                    <div class="flex flex-col gap-3">
                        
                        <div class="flex justify-between items-center">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 transition-colors duration-300">{{ $t('bridge.receiverChain') }}</span>
                            <button @click="popups.bridge_to_network = true" class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] transition-colors border border-slate-200 dark:border-white/5 cursor-pointer">
                                <img v-if="crypto.bridge.toChain?.logoURI" :src="crypto.bridge.toChain.logoURI" class="w-3.5 h-3.5 rounded-full border border-slate-200 dark:border-transparent">
                                <span class="text-[10px] font-bold text-slate-700 dark:text-zinc-300 transition-colors">{{ crypto.bridge.toChain?.shortName.toUpperCase() || $t('bridge.select') }}</span>
                                <svg class="w-3 h-3 text-slate-400 dark:text-zinc-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                        </div>

                        <div class="flex items-center justify-between gap-4">
                            <button 
                                class="flex items-center gap-2 px-3 py-2 rounded-xl transition-all duration-300 shrink-0 border border-dashed cursor-pointer"
                                :class="crypto.bridge.outToken ? 'bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] text-slate-900 dark:text-white border-transparent' : 'bg-transparent border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-zinc-200 hover:border-indigo-400 dark:hover:border-zinc-500'"
                                @click="openOut"
                            >
                                <img v-if="crypto.bridge.outToken" :src="tokenLogo(crypto.bridge.outToken)" :alt="crypto.bridge.outToken.name" class="w-6 h-6 rounded-full border border-slate-200 dark:border-transparent">
                                <span class="font-bold text-sm">{{ crypto.bridge.outToken?.symbol.toUpperCase() || $t('bridge.selectToken') }}</span>
                                <svg class="w-4 h-4 opacity-70" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z"/></svg>
                            </button>

                            <div class="flex items-center justify-end h-9 flex-1 min-w-0">
                                <span 
                                    v-if="!bridgeLoading && bridgeData" 
                                    class="w-full text-right text-2xl font-bold text-slate-900 dark:text-zinc-200 truncate transition-colors duration-300"
                                    :title="parseFloat(bridgeData.estimate.toAmount) / (10 ** bridgeData.action.toToken.decimals)"
                                >
                                    {{ parseFloat(bridgeData.estimate.toAmount) / (10 ** bridgeData.action.toToken.decimals) }}
                                </span>
                                <div v-else-if="bridgeLoading" class="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-zinc-800 rounded-lg transition-colors duration-300 shrink-0">
                                    <svg class="w-4 h-4 text-slate-400 dark:text-zinc-400 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-dasharray="16" stroke-dashoffset="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="160"/><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12360 12 12"/></path></svg>
                                </div>
                                <span v-else class="w-full text-right text-2xl font-bold text-slate-300 dark:text-zinc-700 transition-colors duration-300">0.00</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="w-full bg-slate-100 dark:bg-[#131315] p-1 rounded-xl border border-slate-200 dark:border-white/5 flex relative transition-colors duration-300">
                    <div class="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white dark:bg-zinc-800 rounded-lg shadow-sm transition-all duration-300 ease-out"
                        :class="filter === 'CHEAPEST' ? 'left-1' : 'left-[50%]'"></div>

                    <button class="flex-1 relative flex items-center justify-center gap-2 py-2 text-xs font-bold transition-colors duration-300 cursor-pointer"
                        :class="filter === 'CHEAPEST' ? 'text-slate-800 dark:text-white' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-400'"
                        @click="filter = 'CHEAPEST'">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7M10.5 16a1.5 1.5 0 1 1 3 0a1.5 1.5 0 0 1-3 0"/><path d="M17.526 5.116L14.347.659L2.658 9.997L2.01 9.99V10H1.5v12h21V10h-.962l-1.914-5.599zM19.425 10H9.397l7.469-2.546l1.522-.487zM15.55 5.79L7.84 8.418l6.106-4.878zM3.5 18.169v-4.34A3 3 0 0 0 5.33 12h13.34a3 3 0 0 0 1.83 1.83v4.34A3 3 0 0 0 18.67 20H5.332A3.01 3.01 0 0 0 3.5 18.169"/></svg>
                        {{ $t('bridge.cheapest') }}
                    </button>

                    <button class="flex-1 relative flex items-center justify-center gap-2 py-2 text-xs font-bold transition-colors duration-300 cursor-pointer"
                        :class="filter === 'FASTEST' ? 'text-slate-800 dark:text-white' : 'text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-400'"
                        @click="filter = 'FASTEST'">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="m12 15.6l3.2-4.6h-2.85l2-7H9v8h3zM10 22v-8H7V2h10l-2 7h4zm2-10H9z"/></svg>
                        {{ $t('bridge.fastest') }}
                    </button>
                </div>

                <div v-if="bridgeData" class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-2 transition-colors duration-300 shadow-sm dark:shadow-none animate-fade-in-up">
                    <div class="flex justify-between items-center text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                        <span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> {{ $t('bridge.totalCost') }}</span>
                        <span class="text-slate-800 dark:text-zinc-200 font-bold">${{ Number(totalCost).toFixed(2) }}</span>
                    </div>

                    <div class="w-full h-px bg-slate-100 dark:bg-white/5 transition-colors duration-300"></div>

                    <div class="flex justify-between items-center text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                        <span class="flex items-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>{{ $t('bridge.predictedTime') }}</span>
                        <span class="text-slate-800 dark:text-zinc-200 font-bold">{{ bridgeData.estimate.executionDuration }} {{ $t('bridge.sec') }}</span>
                    </div>
                </div>

                <!-- Teklif hatasi — sonsuz spinner yerine notr bilgi karti (Swap.vue'daki
                     quoteError 'unknown' dalinin deseni). Sebep iddia edilmez; 20 sn'lik
                     interval otomatik yeniden dener. -->
                <div v-if="bridgeQuoteError && !bridgeLoading" class="w-full rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 p-3 flex items-start gap-3 transition-colors duration-300">
                    <svg class="w-5 h-5 text-slate-400 dark:text-zinc-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-700 dark:text-zinc-200">{{ $t('bridge.quoteFailed') }}</span>
                        <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('bridge.quoteFailedDesc') }}</span>
                    </div>
                </div>

                <GasTokenSelector
                    v-if="gasTokenOptions.length && !payWithAts"
                    v-model="gasToken"
                    :options="gasTokenOptions"
                    :native-symbol="network.currentNetwork.nativeCurrency.symbol"
                    :native-logo="network.currentNetwork.logoURI || `/chains/${network.currentNetwork.chainId}.png`"
                    :sent-asset-address="crypto.bridge.inToken?.address"
                    :send-amount="amount"
                />

                <!-- ATS ucret + komisyon karti. SECIM YOKTUR: ATS zincirinde ucret her zaman
                     ATS ile odenir (Send/Swap ile ayni kural, atsFee.pickFeeBranch). -->
                <!-- TEK SAYI: gosterilen tutar `atsTotalDisplay` yani ag ucreti x op
                     sayisi + komisyon; bilesenler AYRI YAZILMAZ. Kullanicinin sordugu
                     tek soru "ne kadar ATS kesilecek"; dokum, odenecek tutari
                     degistirmeyen ama dar popup'ta (360x600) satir yiyen bir ayrinti.
                     Komisyon acik/kapali FARK ETMEZ.

                     "en fazla" KALIR: ucret bir UST SINIRDIR, kesin tutar degil --
                     ve bu ekranda "iade edilmez" satiri BILEREK yok, yoksa iki satir
                     birbirini curuturdu.

                     `atsPaidWith` burada KARTIN BASLIGI (Send/Dapp'te yesil alt satir):
                     bu yuzden `paid-with-key` GECILMEZ, yoksa ayni dize iki kez cizilir. -->
                <AtsFeeCard
                    v-if="payWithAts"
                    label-key="send.confirmTransaction.atsPaidWith"
                    paid-on-bsc-key="send.confirmTransaction.atsPaidOnBsc"
                    :amount="atsFee != null ? atsTotalDisplay : null"
                    :usd-text="atsTotalUsdText"
                    :symbol="atsSymbol"
                    :loading="atsLoading"
                    logo-uri="/ats.png"
                    show-up-to
                />

                <div v-if="payWithAts && atsDecision && !atsLoading && atsDecision.severity !== 'internal'"
                     class="w-full rounded-xl p-3 flex flex-col gap-2 border transition-colors duration-300"
                     :class="atsDecision.severity === 'user'
                        ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
                        : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'">
                    <span class="text-xs font-bold text-slate-800 dark:text-zinc-100">{{ $t(atsDecision.i18nKey, { symbol: atsSymbol }) }}</span>
                    <span v-if="atsDecision.action === 'run-onboarding'" class="text-[10px] text-slate-600 dark:text-zinc-400">
                        {{ $t(atsNextSteps.length > 1 ? 'send.confirmTransaction.atsOnboardingDesc' : 'send.confirmTransaction.atsBudgetLowDesc') }}
                    </span>
                    <span v-else-if="atsDecision.i18nDescKey" class="text-[10px] text-slate-600 dark:text-zinc-400">{{ $t(atsDecision.i18nDescKey) }}</span>
                    <button v-if="atsDecision.action === 'run-onboarding'"
                            :disabled="atsLoading"
                            class="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold disabled:opacity-50"
                            @click="startAtsOnboarding">
                        {{ $t('send.confirmTransaction.atsOnboardingRun') }}
                    </button>
                </div>

                <!-- §06.3 — native deger gerektiren rota (native->native kopru) sponsorlu
                     yolda calismaz; teklif asamasinda soylenir. -->
                <div v-if="payWithAts && atsError && (!atsDecision || atsDecision.severity === 'internal')" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex flex-col gap-1 transition-colors duration-300">
                    <span class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.atsQuoteFailedTitle') }}</span>
                    <span class="text-xs text-red-500/80 dark:text-red-300/70">{{ $t('send.confirmTransaction.atsQuoteFailedDesc') }}</span>
                </div>

                <!-- Pimlico gas-token kartlari YALNIZ ATS kolunun DISINDA (Swap.vue ile ayni gerekce). -->
                <div v-if="!payWithAts && selectedInsufficient" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300">
                    <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientToken') }}</span>
                        <span class="text-xs text-red-500/80 dark:text-red-300/70">{{ $t('send.confirmTransaction.insufficientGasTokenDesc', { symbol: crypto.bridge.inToken?.symbol?.toUpperCase() }) }}</span>
                    </div>
                </div>

                <div v-if="insufficientBalance" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300 animate-shake">
                    <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-red-600 dark:text-red-400 transition-colors duration-300">{{ $t('bridge.insufficientBalance') }}</span>
                        <span class="text-xs text-red-500/80 dark:text-red-300/70 transition-colors duration-300">
                            {{ $t('bridge.insufficientBalanceDesc', { amount: (amount - inBalance).toFixed(4), symbol: crypto.bridge.inToken?.symbol?.toUpperCase() }) }}
                        </span>
                    </div>
                </div>

                <div v-if="!payWithAts && !insufficientBalance && insufficientGas && !gasToken" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300 animate-shake">
                    <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-red-600 dark:text-red-400 transition-colors duration-300">{{ $t('bridge.insufficientBalance') }} (Gas)</span>
                        <span class="text-xs text-red-500/80 dark:text-red-300/70 transition-colors duration-300">
                            {{ $t('bridge.insufficientFeeBalanceDesc', { symbol: network.currentNetwork.nativeCurrency.symbol.toUpperCase() }) }}
                        </span>
                    </div>
                </div>

                <!-- Gonderim hatasi — background'dan basarisiz cevap veya beklenmeyen hata.
                     Sessiz console.error yetmez; kullanici islemin gitmedigini gormeli. -->
                <div v-if="bridgeError" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300 animate-shake">
                    <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-red-600 dark:text-red-400 transition-colors duration-300">{{ $t('bridge.submitFailed') }}</span>
                        <span class="text-xs text-red-500/80 dark:text-red-300/70 transition-colors duration-300">{{ $t('bridge.submitFailedDesc') }}</span>
                    </div>
                </div>

            </div>

            <div class="absolute bottom-5 left-0 w-full px-4 z-20">
                <button 
                    class="w-full py-4 rounded-2xl font-bold text-base tracking-wide flex items-center justify-center gap-2 transition-all duration-300 shadow-md dark:shadow-lg"
                    :class="isValid() 
                        ? 'bg-linear-to-r from-indigo-600 to-purple-600 text-white hover:scale-[1.02] shadow-indigo-500/20 cursor-pointer' 
                        : 'bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border-transparent dark:border-white/5'"
                    :disabled="!isValid()"
                    @click="bridge"
                >
                    <div v-if="loading || bridgeLoading" class="flex items-center gap-2">
                        <svg class="w-5 h-5 animate-spin text-white/70" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-dasharray="16" stroke-dashoffset="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="160"/><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12360 12 12"/></path></svg>
                        <span>{{ $t('bridge.loading') }}</span>
                    </div>
                    <!-- Buton metni BLOKLAMA SEBEBINI soylemeli; ATS kolunda sebep cogu zaman bakiye DEGILDIR. -->
                    <span v-else-if="insufficientBalance">{{ $t('bridge.insufficientBalance') }}</span>
                    <span v-else-if="payWithAts && !atsLoading && !atsReady">{{ $t('send.confirmTransaction.atsCannotSend') }}</span>
                    <span v-else-if="!payWithAts && ((insufficientGas && !gasToken) || selectedInsufficient)">{{ $t('bridge.insufficientBalance') }}</span>
                    <span v-else>{{ $t('bridge.confirm') }}</span>
                </button>
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ethers } from 'ethers'
import Back from './Back.vue'
import AtsFeeCard from './AtsFeeCard.vue'
import { networkStore } from '../store/network'
import { useTokenBalance } from '../composables/useTokenBalance'
import bridgeTo from './bridge/bridgeTo.vue'
import bridgeFrom from './bridge/bridgeFrom.vue'
import { popupStore } from '../store/popup'
import { cryptoStore } from '../store/crypto'
import SelectToChains from './bridge/selectToChains.vue'
import SelectFromChain from './bridge/selectFromChain.vue'
import Settings from './bridge/Settings.vue'
import { buildNativeToken } from '../utils/nativeToken'
import { pageStore } from '../store/pageStore'
import { useTransactionStore } from '../store/transaction'
import { configStore } from '../store/config'
import { isGaslessChain } from '../utils/gaslessConfig'
import GasTokenSelector from './GasTokenSelector.vue'
import { useGasToken } from '../composables/useGasToken'
import { useAtsOpFee } from '../composables/useAtsOpFee'
import { isAtsChain, ATS_COINGECKO_ID } from '../utils/atsConfig'
import { useUsdPrice } from '../composables/useUsdPrice'
import { tokenToUsd, formatUsd } from '../utils/assetPrice'
import { pickFeeBranch } from '../utils/atsFee'
import { toDecimalString, clampToDecimals } from '../utils/swapValidation'
import { isNativeAsset } from '../utils/nativeAsset'
import { SEND_PERCENTS, percentAmount } from '../utils/sendPercent'
import { needsNativeReserve, reserveFromQuote, BRIDGE_GAS_FALLBACK } from '../utils/nativeReserve'
import { FLOW } from '../utils/chainKind'
import { useFlowScreenGuard } from '../composables/useFlowScreenGuard'
import { tokenLogo } from '../utils/tokenLogo'

const txStore = useTransactionStore()

const network = networkStore()
const popups = popupStore()
const crypto = cryptoStore()
const config = configStore()

const amount = ref(null)
const insufficientBalance = ref(false)
const insufficientGas = ref(false) // YENİ: Gas yetersizlik state'i
const inBalance = ref(0)
const bridgeLoading = ref(false)
const bridgeData = ref(null)
// Teklif alinamadiginda (basarisiz cevap veya beklenmeyen hata) notr bilgi karti gosterilir;
// spinner sonsuza dek donmez. 20 sn'lik interval zaten otomatik yeniden dener.
const bridgeQuoteError = ref(false)
// Son teklifin GERCEK native gaz maliyeti (ether cinsinden). Yuzde/MAX secimi
// bunu pay olarak ayirir; teklif yoksa 0 kalir ve ihtiyatli sabite dusulur.
const estimatedGasNative = ref(0)
const totalCost = ref(0)
const filter = ref('CHEAPEST') // CHEAPEST | FASTEST
const loading = ref(false)
const bridge_success = ref(false)
// Gonderim basarisiz olunca kullaniciya soylenir; sessiz console.error yetmez.
const bridgeError = ref(false)
const activeAccount = ref(null)

const { gasToken, gasTokenOptions, selectedInsufficient, loadGasOptions } = useGasToken()

// --- ATS ile ode (swap/bridge komisyonu) ---------------------------------------------
// SECIM YOKTUR; ATS ZORUNLUDUR — Send ve Swap ile ayni kural (atsFee.pickFeeBranch).
// Gerekce Swap.vue'da uzun uzun yazili: kapali varsayilanli bir onay kutusu hem cuzdanda
// iki farkli kural yaratirdi hem de komisyonu HIC toplatmazdi.
//
// §06.1 (ATS satan swap bakiye tavani) BURADA YOK ve bilinerek: kopru islemi ATS satmaz,
// ATS yalnizca ucret+komisyon icin BSC'de harcanir. Tavan kontrolu swap'a ozgudur.
const payWithAts = computed(() =>
  pickFeeBranch({ fromDapp: false, atsEnabled: isAtsChain(network.currentNetwork.chainId) }) === 'ats')
const {
  atsFee, atsSymbol, ready: atsReady, decision: atsDecision,
  nextSteps: atsNextSteps, loading: atsLoading, error: atsError, errorCode: atsErrorCode,
  commissionHuman, totalAtsCost,
  load: loadAtsOpFee, runOnboarding: runAtsOnboardingOp, reset: resetAtsOpFee,
} = useAtsOpFee()


const fmt = (n) => (n == null ? '—' : Number(n).toFixed(4).replace(/\.?0+$/, ''))
// Kart TEK SAYI gosterir: ag ucreti x op sayisi + komisyon. Bilesenleri ayri bicimleyen
// `atsFeeDisplay`/`commissionDisplay` kaldirildi — dokum ekrandan cikinca olu koda dondu.
// `commissionHuman` KALIR: onay tavani (atsQuoted.commissionFee) onu kullaniyor.
const atsTotalDisplay = computed(() => fmt(totalAtsCost.value))

// ATS ucretinin dolar karsiligi - Swap.vue ile BIREBIR ayni kural. Kimlik
// zincire gore DEGISMEZ: ucret her zaman BSC'deki gercek ATS'ten tahsil edilir.
// Fiyat ya da tutar bilinmiyorsa satir HIC cizilmez (sifirli bir dolar metni = "bedava").
const atsPrice = useUsdPrice({ apiBase: () => config.api })
const atsTotalUsdText = computed(() => formatUsd(tokenToUsd(totalAtsCost.value, atsPrice.price.value)))

// Teklif, GONDERILECEK rotanin transactionRequest'i uzerinden alinir — ekranda baska bir
// rota, gonderimde baska bir rota fiyatlanirsa kilit tutmaz.
const refreshAtsOpFee = async () => {
  if (!payWithAts.value) return
  const d = bridgeData.value
  if (!d || !d.transactionRequest) return
  const { active_account } = await chrome.storage.local.get('active_account')
  await loadAtsOpFee({
    kind: 'bridge',
    payload: {
      index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,
      chainId: d.action.fromChainId,
      to: d.transactionRequest.to,
      data: d.transactionRequest.data,
      value: d.transactionRequest.value,
      fromTokenAddress: d.action.fromToken.address,
      amount_raw: d.action.fromAmount,
      approvalAddress: d.estimate?.approvalAddress,
    },
  })
}

const startAtsOnboarding = async () => {
  const { active_account } = await chrome.storage.local.get('active_account')
  const ok = await runAtsOnboardingOp({
    chainId: network.currentNetwork.chainId,
    address: active_account.address,
    index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,
  })
  if (ok) await refreshAtsOpFee()
}

// Ag degisince kol da degisir. ATS koluna girerken Pimlico secimi temizlenir (ikisi de ayni
// op'u sponsorlamaya calisir); ciktiginda eski ATS teklifi ekranda ASILI KALMAMALI.
watch(payWithAts, async (on) => {
  if (!on) return resetAtsOpFee()
  gasToken.value = null
  await refreshAtsOpFee()
}, { immediate: true })
// Rota degisince ucret de degisir; bayat bir ucret gonderim aninda
// assertQuoteWithinApproval'a takilip islemi durdururdu.
watch(bridgeData, async () => { await refreshAtsOpFee() })

// Home.vue'nun Kopru dugmesini gizlemesi bu ekrandan CIKMAYA engel degil:
// bridgeFrom.vue -> selectFromChain.vue (asagida import edilen SelectFromChain)
// ekranin TAM ICINDEN aktif agi degistirebiliyor. O secici artik akis kapisiyla
// suzuluyor (chainsForFlow('bridge')), yani EVM disi bir zincir oradan SECILEMEZ;
// bu izleyici yine de duruyor cunku aktif ag baska yollardan da degisebilir
// (baslikta ag secici, dapp'in wallet_switchEthereumChain istegi, kilit acilisinda
// geri yuklenen ag). Kopru altyapisi (LI.FI rota, ATS, gasless) tumuyle EVM'e ozel;
// zincir akisi desteklemiyorsa ekran KENDINI kapatir (bkz. Swap.vue'daki ayni desen).
//
// KORUMA DURUYOR, OTORITESI DEGISTI: dugmeyi SUNAN kapinin ta kendisi
// (chainSupportsFlow + FLOW.BRIDGE) sorulur. Kopru icin BUGUNKU DAVRANIS AYNI --
// iki kapi hem TON'da hem Solana'da zaten hemfikirdi; degisen tek sey gercegin
// artik TEK kaynaktan okunmasi. Gerekce: composables/useFlowScreenGuard.js.
useFlowScreenGuard(FLOW.BRIDGE)

const isReversing = ref(false)
let balanceFetchId = 0
// Teklif sorguları her tuş vuruşunda ve 20 saniyede bir tetiklenir. Guard olmadan
// EN SON dönen cevap kazanır: yavaş bir eski teklif, yeni teklifin üzerine yazar ve
// bridge() zincire o eski calldata'yı gönderir. Bakiyelerdeki balanceFetchId ile aynı kalıp.
let quoteFetchId = 0

let bridgeInterval
let onVisible = null

// --- Helpers & Logic ---

const isValid = () => {
    if(!crypto.bridge.inToken || !crypto.bridge.outToken || !crypto.bridge.toChain || !amount.value || amount.value <= 0 || insufficientBalance.value || loading.value || bridgeLoading.value || !bridgeData.value) return false
    // ATS ile odenecekse native yetersizligi ENGEL DEGILDIR (ucret zaten ATS ile odenir), ama
    // teklif hazir olmali: hazir olmayan bir /status ile gondermek op'u ucus sirasinda oldurur.
    if (payWithAts.value) return !atsLoading.value && atsReady.value
    // ATS kolunun DISINDA bugunku kural aynen gecerli.
    if (insufficientGas.value && !gasToken.value) return false
    if (selectedInsufficient.value) return false
    return true
}

// Teklifin fromAmount'u, kullanıcının girdiği miktarla aynı mı?
// Hesaplanamayan durumlarda (garip girdi, eksik teklif) true döner: bu kontrol bir
// emniyet kemeri, tek başına geçerlilik kuralı değil.
const quoteMatchesAmount = () => {
    const quoted = bridgeData.value?.action?.fromAmount
    const decimals = crypto.bridge.inToken?.decimals

    if (quoted === undefined || decimals === undefined || !amount.value) return true

    try {
        return ethers.parseUnits(String(amount.value), decimals).toString() === String(quoted)
    } catch {
        return true
    }
}

// UCRET PAYI - Takas ekranindaki AYNI kural (bkz. nativeReserve.js).
const bridgeReserve = async () => {
    const isNativeIn = isNativeAsset(crypto.bridge.inToken?.address)
    if (!needsNativeReserve({ isNativeIn, gasToken: gasToken.value, payWithAts: payWithAts.value })) return 0

    const quoted = reserveFromQuote(estimatedGasNative.value)
    if (quoted > 0) return quoted

    try {
        const provider = new ethers.JsonRpcProvider(network.rpc)
        const feeData = await provider.getFeeData()
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
        if (!gasPrice) throw new Error('gas fiyati okunamadi')
        return Number(ethers.formatEther(BigInt(BRIDGE_GAS_FALLBACK) * BigInt(gasPrice)))
    } catch (e) {
        console.warn('Kopru gaz payi tahmin edilemedi:', e.message)
        return Number(inBalance.value) * 0.01
    }
}

const setPercent = async (percent) => {
    const decimals = crypto.bridge.inToken?.decimals ?? 18

    // clampToDecimals parseUnits oncesi son kapi (bkz. Swap.vue:setPercent).
    amount.value = clampToDecimals(
        percentAmount({ balance: inBalance.value, reserve: await bridgeReserve(), percent, decimals }),
        decimals,
    )
}

const getBridgeData = async() => {
    // Bu sorgunun sıra numarası. Daha yenisi başlarsa bu sorgu hiçbir state'e yazmaz.
    const currentFetchId = ++quoteFetchId
    const isStale = () => currentFetchId !== quoteFetchId

    try {
        if(!amount.value || Number(amount.value) <= 0) {
            bridgeData.value = null
            // Reset loading when empty amount
            bridgeLoading.value = false
            bridgeQuoteError.value = false
            return
        }
        bridgeLoading.value = true
        insufficientGas.value = false // Sorgu başlarken resetle
        bridgeQuoteError.value = false

        const { bridge_slippage, active_account } = await chrome.storage.local.get(['bridge_slippage', 'active_account'])

        const inToken = { address: crypto.bridge.inToken.address, decimals: crypto.bridge.inToken.decimals }
        const outToken = { address: crypto.bridge.outToken.address, decimals: crypto.bridge.outToken.decimals }

        const message = { 
            fromChain: network.currentNetwork.chainId, 
            toChain: crypto.bridge.toChain.chainId, 
            inToken, 
            outToken, 
            amount: amount.value, 
            filter: filter.value, 
            slippage: bridge_slippage || 0.5, 
            index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath
        }

        const {success, data, error} = await chrome.runtime.sendMessage({ type: 'BRIDGE_QUOTE', message })

        // Bu cevap beklenirken daha yeni bir sorgu başladıysa sonucu yok say.
        if(isStale()) return

        if(!success) {
            bridgeData.value = null
            bridgeLoading.value = false
            bridgeQuoteError.value = true
            return console.error('bridge error', error)
        }

        bridgeData.value = data

        // Toplam USD Maliyet Hesaplama
        let cost = 0
        if (bridgeData.value.estimate.feeCosts) {
            for (const fee_cost of bridgeData.value.estimate.feeCosts) cost += Number(fee_cost.amountUSD)
        }
        if (bridgeData.value.estimate.gasCosts) {
            for (const gas_cost of bridgeData.value.estimate.gasCosts) cost += Number(gas_cost.amountUSD)
        }
        totalCost.value = cost

        // --- FEE BALANCE (GAS) KONTROLÜ ---
        if (bridgeData.value && bridgeData.value.transactionRequest) {
            const provider = new ethers.JsonRpcProvider(network.rpc)
            const nativeBalWei = await provider.getBalance(activeAccount.value.address)
            
            // Bridge işlemi için blockzincire gönderilecek gerçek "value" (Wei cinsinden)
            const txReq = bridgeData.value.transactionRequest
            const txValue = BigInt(txReq.value || "0")
            
            // Gerçek ağ ücreti hesaplaması (Wei cinsinden)
            let gasCostWei = 0n
            if (txReq.gasLimit && txReq.gasPrice) {
                gasCostWei = BigInt(txReq.gasLimit) * BigInt(txReq.gasPrice)
            } else if (bridgeData.value.estimate?.gasCosts?.length > 0) {
                gasCostWei = BigInt(bridgeData.value.estimate.gasCosts[0].amount || "0")
            } else {
                // Herhangi bir veri gelmezse Fallback olarak 300k gas baz alınıyor
                const feeData = await provider.getFeeData().catch(() => ({ maxFeePerGas: 3000000000n }))
                gasCostWei = 300000n * (feeData.maxFeePerGas || 3000000000n)
            }

            // Zincir sorguları beklenirken yeni bir teklif başlamış olabilir.
            if (isStale()) return

            // txValue her halükarda Native ödemeyi kapsadığı için (Token bile olsa fee varsa buraya eklenir)
            // Direkt txValue ile gasCostWei toplamını Native Balance ile kıyaslıyoruz.
            // Yuzde/MAX secimi ayni sayiyi pay olarak kullanir; burada zaten
            // hesaplanmisken saklanmasi, ayri bir tahmin yolu acmaktan iyi.
            estimatedGasNative.value = Number(ethers.formatEther(gasCostWei))

            if (nativeBalWei < (txValue + gasCostWei)) {
                insufficientGas.value = true
            }
        }

        // GASLESS: kaynak zincir destekliyorsa fee-token secenekleri.
        if (isGaslessChain(network.currentNetwork.chainId)) {
            await loadGasOptions({
                chainId: network.currentNetwork.chainId,
                address: active_account.address,
                bundlerBase: config.bundlerBase,
                sentAsset: {
                    address: crypto.bridge.inToken.address,
                    symbol: crypto.bridge.inToken.symbol,
                    decimals: crypto.bridge.inToken.decimals,
                    image: crypto.bridge.inToken.image,
                },
                sendAmount: amount.value,
                nativeInsufficient: insufficientGas.value,
            })
        }

        // Eski bir sorgu spinner'ı kapatıp butonu açmasın: o an ekranda daha yeni
        // bir teklif hesaplanıyor olabilir.
        if (isStale()) return

        // Sadece başarılı olduğunda loading'i kapat
        bridgeLoading.value = false

    } catch (error) {
        // Bayat bir hata, o an hesaplanan YENI teklifin spinner'ini kapatmasin.
        if (isStale()) return
        bridgeData.value = null
        bridgeLoading.value = false
        bridgeQuoteError.value = true
        console.error(error.message)
    }
}

const bridge = async() => {
    try {
        // Tekrar deneme eski hata kartini temizlesin.
        bridgeError.value = false
        if(insufficientBalance.value || selectedInsufficient.value) return
        // ATS ile odenecekse native yetersizligi ENGEL DEGILDIR, ama teklif HAZIR olmali:
        // hazir olmayan bir /status ile gondermek op'u ucus sirasinda oldurur.
        if (payWithAts.value) {
            if (atsLoading.value || !atsReady.value) return
        } else if (insufficientGas.value && !gasToken.value) return

        // Son kapı: zincire gidecek calldata, ekranda yazan miktarla aynı olmalı.
        // Teklif yarışı guard'ına ek bir emniyet; hesaplanamıyorsa engellemez.
        if (!quoteMatchesAmount()) {
            console.error('bridge: teklif ekrandaki miktarla uyuşmuyor, yeni teklif alınıyor')
            bridgeData.value = null
            await getBridgeData()
            return
        }

        loading.value = true
        const data = bridgeData.value.transactionRequest
        const { active_account } = await chrome.storage.local.get(['active_account'])

        const fromChainId = bridgeData.value.action.fromChainId
        const message = {
            from: bridgeData.value.action.fromToken.address,
            to: data.to, data: data.data,
            value: data.value,
            chain: fromChainId,
            amount: Number(ethers.formatUnits(bridgeData.value.action.fromAmount, bridgeData.value.action.fromToken.decimals)),
            amount_raw: bridgeData.value.action.fromAmount,
            index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,

            // ISLEM KARTININ KAYNAGI. Payload bugune kadar yalnizca `chain`
            // (KAYNAK ag) tasiyordu: kart "nereye" sorusunu hicbir zaman
            // cevaplayamiyordu. Kimlik OLDUGU GIBI gonderilir -- cevrim TON ve
            // Solana kimliklerinde sessizce yanlis deger uretir.
            toChain: bridgeData.value.action.toChainId,
            // YALNIZ KAYNAK TOKEN: sembolu miktar satirinin birimi olarak
            // kullaniliyor. Koprude kartin ekseni AGDIR, token degil; hedef token
            // kaydi hicbir yerde okunmuyor ve gondermek depoya olu alan yazardi.
            fromTokenData: bridgeData.value.action.fromToken,
        }

        // ATS: ucret + komisyon ATS ile. Bayrak background.js'teki kapiyi acan TEK seydir.
        if (payWithAts.value && isAtsChain(fromChainId)) {
            message.atsBridge = true
            message.fromTokenAddress = bridgeData.value.action.fromToken.address
            message.approvalAddress = bridgeData.value.estimate?.approvalAddress
            // Onay aninda ekranda YAZAN ucret: gonderim anindaki taze teklif bunu asarsa
            // executeAtsTransfer islemi IMZADAN ONCE durdurur.
            // Komisyon da onaya GIRER: /sponsor spoke zincirde ucret + komisyonu TEK alanda
            // tahsil eder, tavan yalniz ucretten kurulursa her komisyonlu op patlar.
            message.atsQuoted = { transferFee: atsFee.value, commissionFee: commissionHuman.value }
        } else if (gasToken.value && isGaslessChain(fromChainId)) {
            // GASLESS: tercih edilen gas token'i ayarliysa ve kaynak zincir destekliyorsa token ile gas
            message.gasToken = gasToken.value
            message.fromTokenAddress = bridgeData.value.action.fromToken.address
            message.bundlerBase = config.bundlerBase
        }

        const {success} = await chrome.runtime.sendMessage({ type: 'BRIDGE', message })
        if(success) {
            bridge_success.value = true
            setTimeout(() => {
                pageStore().currentPage = 'home'
                bridge_success.value = false
            }, 1500)
        } else {
            bridgeError.value = true
            console.error('bridge failed')
        }

    } catch (error) {
        bridgeError.value = true
        console.error('bridge error', error.message)
    } finally {
        loading.value = false
    }
}

// Modal Openers
const openOut = () => {
    if(!crypto.bridge.toChain) popups.bridge_to_network = true
    else popups.bridge_to = true
}

const openIn = () => {
    if(crypto.bridge.inToken) popups.bridge_from = true
    else popups.bridge_from_network = true
}

// Native varsayilan artik AGDAN gelmiyor (gerekce utils/nativeToken.js basinda).
// Eski satir `token.address`'i GUARD'SIZ okuyordu ve onMounted try/catch'siz:
// Polygon/Mantle/Cronos'ta `findToken` `undefined` donunce YAKALANMAMIS bir
// TypeError atiyor, onMounted'in kalani HIC calismiyordu.
//
// Bakiye cagrisi da buradan SILINDI: `watch(crypto.bridge.inToken) -> updateBalances`
// zaten var ve o fonksiyon `activeAccount` guard'li.
//
// KOPRU CAPRAZ ZINCIRDIR: burada yalnizca KAYNAK zincirin varsayilani tohumlanir;
// bridgeFrom'un kapsami ve bridgeTo'nun toChain bagi DEGISMEZ.
onMounted(async() => {
    // ATS fiyati BEKLENMEZ: ikincil bir dolar satirini besliyor, ekranin
    // kurulmasini geciktirmemeli (Swap.vue ile ayni kural).
    atsPrice.loadById(ATS_COINGECKO_ID)

    const { active_account } = await chrome.storage.local.get('active_account')
    activeAccount.value = active_account

    if(!crypto.bridge.inToken) crypto.bridge.inToken = buildNativeToken(network.currentNetwork?.chainId)
    await updateBalances()

    // Panel gorunur oldugunda bir kez tazele: gizliyken atlanan turlar birikmesin,
    // kullanici panele dondugunde bayat bir teklif gormesin.
    onVisible = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
        getBridgeData()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
})

onUnmounted(() => {
    if(bridgeInterval) clearInterval(bridgeInterval)
    if(onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})

watch(() => [crypto.bridge.inToken, amount.value, crypto.bridge.outToken, filter.value], async() => {
    // Yeni miktar/token/filtre eski gonderim hatasini gecersiz kilar.
    bridgeError.value = false
    if(!amount.value || Number(amount.value) <= 0) {
        insufficientBalance.value = false;
        insufficientGas.value = false; // Miktar sıfırlandığında gas uyarısını da gizle
        return;
    }

    insufficientBalance.value = Number(amount.value) > Number(inBalance.value);

    await getBridgeData()
    if(bridgeInterval) clearInterval(bridgeInterval)

    bridgeInterval = setInterval(async() => {
        // Panel gorunmez ise yoklama yapma. Gorunur olunca asagidaki
        // visibilitychange dinleyicisi bir kez tazeler.
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        await getBridgeData()
    }, 20000)
})

watch(() => crypto.bridge.inToken, async() => {
    await updateBalances();
})

const updateBalances = async () => {
    const currentFetchId = ++balanceFetchId; 

    try {
        if (!activeAccount.value?.address) return;
        
        if (crypto.bridge.inToken) {
            const tokenAddress = crypto.bridge.inToken.address || '0x0';
            const currentRpc = network.currentNetwork?.rpc?.[0].url || network.rpc;
            
            // `currentRpc` AKTIF agin ucu; chainId de oradan alinir ki ikisi tutsun.
            const newBalance = await useTokenBalance(activeAccount.value.address, tokenAddress, currentRpc, network.currentNetwork?.chainId);

            if (currentFetchId !== balanceFetchId) return;

            inBalance.value = newBalance;
        } else {
            if (currentFetchId !== balanceFetchId) return;
            inBalance.value = 0;
        }

        if (amount.value && Number(amount.value) > 0) {
            insufficientBalance.value = Number(amount.value) > Number(inBalance.value);
        } else {
            insufficientBalance.value = false;
        }

    } catch (error) {
        console.error("Bakiye güncelleme hatası:", error);
    }
}

// rpc alanı hem dizi hem { key: {url} } şeklinde gelebiliyor (bkz. App.vue reconnect).
const firstRpcUrl = (net) => {
    const rpc = net?.rpc
    if (!rpc) return null

    const list = Array.isArray(rpc) ? rpc : Object.values(rpc)
    return list[0]?.url || null
}

const reverse = async () => {
    if (isReversing.value) return

    // Hedef zincir seçilmeden ters çevirilirse currentNetwork null olarak KAYDEDİLİR
    // ve network.currentNetwork.chainId okuyan her yer patlar.
    if (!crypto.bridge.toChain) return

    isReversing.value = true

    try {
        const old_in_token = crypto.bridge.inToken
        const old_out_token = crypto.bridge.outToken
        const old_to_chain = crypto.bridge.toChain
        const old_current_network = network.currentNetwork

        inBalance.value = 0;
        bridgeData.value = null
        // Uçuşta olan teklif artık eski yöne ait: sonucu bridgeData'ya yazmasın.
        quoteFetchId++

        network.setCurrentNetwork(old_to_chain)

        // Zincir değişti, rpc de değişmeli. Yoksa gas/bakiye kontrolleri (örn.
        // getBridgeData'daki JsonRpcProvider) eski zincirin rpc'sinden okur.
        const newRpc = firstRpcUrl(old_to_chain)
        if (newRpc) network.rpc = newRpc

        crypto.bridge.toChain = old_current_network

        crypto.bridge.inToken = old_out_token
        crypto.bridge.outToken = old_in_token
        
        await new Promise(resolve => setTimeout(resolve, 150));
        await updateBalances();

    } finally {
        isReversing.value = false; 
    }
}
</script>

<style scoped>
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-2px); }
    75% { transform: translateX(2px); }
}
.animate-shake {
    animation: shake 0.3s ease-in-out;
}

@keyframes fade-in-up {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
    animation: fade-in-up 0.3s ease-out;
}
</style>