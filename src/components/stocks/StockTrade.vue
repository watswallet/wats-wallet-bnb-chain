<template>
    <div data-stock-trade class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/10 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <section class="flex flex-col h-full relative z-10">
            <div class="flex items-center justify-between px-5 py-4">
                <Back page="home" class="hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
                <span></span>
                <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white ms-5 transition-colors duration-300">{{ $t('stockTrade.title', { symbol: stock?.symbol ?? '' }) }}</h1>
                <span class="w-9"></span>
            </div>

            <!-- Katalog disi / bayrak kapali / secili hisse yok: yalniz mesaj + Geri. -->
            <div v-if="!available" class="px-4 pb-20 flex-1 flex flex-col items-center justify-center gap-4">
                <p class="text-sm text-center text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.unavailable') }}</p>
            </div>

            <template v-else>
                <div class="px-4 pb-20 flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
                    <div class="flex items-center gap-3">
                        <!-- Hisse logosu + ag rozeti: Hisseler listesindeki satirla AYNI kaynak (sunucu `image`, tokenLogo) ve ayni duzen. -->
                        <div class="relative min-w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5">
                            <img v-if="stockLogo" data-stock-logo :src="stockLogo" :alt="stock.name" class="rounded-full w-9 h-9" @error="stockImage = null">
                            <span v-else data-stock-logo-placeholder class="text-sm font-bold text-slate-500 dark:text-zinc-400">{{ stock.symbol.charAt(0) }}</span>
                            <div data-stock-chain-logo class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10 shadow-sm">
                                <img :src="chainLogo(stock.chainId)" :alt="stockChain?.name ?? ''" class="w-full h-full rounded-full">
                            </div>
                        </div>
                        <div class="flex flex-col">
                            <div class="flex items-center gap-2">
                                <span class="font-bold">{{ stock.symbol }}</span>
                                <span v-if="issuerInfo" class="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider">{{ $t(issuerInfo.badgeKey) }}</span>
                            </div>
                            <span class="text-xs text-slate-500 dark:text-zinc-400">{{ stock.name }}</span>
                        </div>
                    </div>

                    <!-- Ihracci secici (K5): yalniz iki ihracci varken DOM'da; bayrak kapaliyken hic. Secim mantigi useIssuerSwitch'te. -->
                    <IssuerSwitch :options="issuerSwitch.options" :selected="issuerSwitch.selected" :lock="issuerSwitch.xLock" @pick="issuerSwitch.pick" />
                    <!-- Ag secici: hissenin bu ihraccidaki aglari; yalniz hisse baglamini degistirir, cuzdan agini DEGISTIRMEZ. -->
                    <StockChainPicker :rows="issuerSwitch.chainRows" :selected="issuerSwitch.chain" @pick="issuerSwitch.pickChain" />

                    <!-- Sekmeler -->
                    <div class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-200/60 dark:bg-white/5">
                        <button
                            v-for="tab in ['buy', 'sell']"
                            :key="tab"
                            :data-trade-tab="tab"
                            class="py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                            :class="side === tab ? 'bg-white dark:bg-[#202022] text-indigo-600 dark:text-white shadow-sm' : 'text-slate-500 dark:text-zinc-400'"
                            @click="setSide(tab)"
                        >
                            <svg data-trade-tab-icon width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0"><template v-if="tab === 'buy'"><path d="M12 5v14"></path><path d="M19 12l-7 7-7-7"></path></template><template v-else><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></template></svg>
                            <span>{{ tab === 'buy' ? $t('stockTrade.tabBuy') : $t('stockTrade.tabSell') }}</span>
                        </button>
                    </div>

                    <!-- Odeme tokeni: iki dugmeli segment (yeni bilesen yok) -->
                    <div class="flex items-center justify-between gap-3">
                        <span class="text-sm text-slate-500 dark:text-zinc-400">{{ side === 'buy' ? $t('stockTrade.payWith') : $t('stockTrade.receiveIn') }}</span>
                        <div class="flex gap-1">
                            <button
                                v-for="p in payTokens"
                                :key="p.address"
                                :data-pay-token="p.symbol"
                                class="px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer inline-flex items-center gap-1.5"
                                :class="payToken?.address === p.address ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-zinc-400'"
                                @click="setPayToken(p)"
                            ><img v-if="payLogo(p)" :src="payLogo(p)" :alt="p.symbol" class="w-4 h-4 rounded-full shrink-0">{{ p.symbol }}</button>
                        </div>
                    </div>

                    <!-- Tutar -->
                    <div class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-4 shadow-md dark:shadow-xl transition-colors duration-300">
                        <div class="flex flex-col gap-3">
                            <div class="flex justify-between items-start gap-2">
                                <span class="text-xs text-slate-500 dark:text-zinc-400 shrink-0">{{ side === 'buy' ? $t('stockTrade.amountBuy', { symbol: payToken?.symbol ?? '' }) : $t('stockTrade.amountSell', { symbol: stock.symbol }) }}</span>
                                <div class="flex flex-wrap justify-end items-center gap-2 text-xs">
                                    <span v-if="balanceLoading" class="inline-block h-3 w-20 rounded bg-slate-200 dark:bg-white/10 animate-pulse"></span>
                                    <span v-else class="whitespace-nowrap" :class="{ 'text-red-500 dark:text-red-400': blockReason === 'insufficient-balance' }">{{ $t('stockTrade.available', { amount: balanceText, symbol: spendSymbol }) }}</span>
                                    <button
                                        v-for="percent in SEND_PERCENTS"
                                        :key="percent"
                                        class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 font-bold px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                        :disabled="balanceLoading || balanceAtoms === null"
                                        @click="setPercent(percent)"
                                    >{{ percent === 1 ? $t('stockTrade.max') : $t('common.percentChip', { value: percent * 100 }) }}</button>
                                </div>
                            </div>
                            <input
                                data-trade-amount
                                :value="amountShown"
                                type="number"
                                inputmode="decimal"
                                class="w-full bg-transparent text-3xl font-bold text-right text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-zinc-700 outline-none caret-indigo-500 transition-colors duration-300"
                                :class="blockReason === 'insufficient-balance' ? 'text-red-500 dark:text-red-400' : ''"
                                placeholder="0"
                                @keydown="preventInvalidKeys"
                                @input="onAmountInput"
                            >
                        </div>
                    </div>

                    <!-- Kilit satiri (amber/kirmizi bant, Swap.vue kalibi). Karari arka plan verir, burasi yalniz gosterir. -->
                    <div v-if="lock" data-trade-lock class="rounded-2xl border border-red-300/50 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">{{ $t(lock.key, lock.params) }}</div>

                    <!-- Faz 3 ATS ucreti: borc / bloke / iade bildirimleri. Metin ve eylem karari feeNoticeOf'tan. -->
                    <StockFeeNotice v-if="noticeViews.length" :views="noticeViews" :wallet-locked="feeWalletLocked" :format-ats-raw="formatAtsRaw" @action="onFeeAction" />
                    <p v-if="feeApproved" data-fee-approved class="rounded-2xl border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300">{{ $t('stockTrade.atsFee.state.paying') }}</p>
                    <p v-if="feeErrorCode" data-fee-error class="rounded-2xl border border-red-300/50 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">{{ $t(cowErrorKey(feeErrorCode)) }}</p>

                    <!-- Sat + kapali/belirsiz piyasa: bilgi, dugmeyi kapatmaz -->
                    <div v-if="notice" data-trade-notice class="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">{{ $t(notice.key) }}<template v-if="notice.time"> ({{ notice.time }})</template></div>

                    <!-- Katman kapaninca: teklif guncellendi ya da hata kodu (ic mesaj yok) -->
                    <div v-if="bannerKey" data-trade-banner class="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">{{ $t(bannerKey) }}</div>

                    <!-- Zincir ustu onay tamamlandi (allowance dogrulandi); teklif yenilenirken gorunur -->
                    <div v-if="approveStep.done" data-approve-done class="rounded-2xl border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300">{{ $t('stockTrade.approve.done') }}</div>

                    <!-- Hata -->
                    <div v-if="quote.state === 'error'" :data-trade-insufficient="insufficientCard ? '' : undefined" class="flex items-center justify-between gap-3 rounded-2xl border border-red-300/50 bg-red-50 dark:bg-red-500/10 px-4 py-3">
                        <span class="text-xs text-red-700 dark:text-red-300">{{ insufficientCard ? $t('stockTrade.insufficient.detail', insufficientCard.params) : $t(errorKeyOf(quote.errorCode)) }}</span>
                        <!-- Bakiye hatasinda 'Yeniden dene' anlamsiz: ayni tutar ayni hatayi verir. Yerine tutari bakiyeye esitleme. -->
                        <button v-if="insufficientCard?.equalizeAmount" data-trade-use-balance class="shrink-0 text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer" @click="useFullBalance">{{ $t('stockTrade.btn.useBalance') }}</button>
                        <button v-else-if="quote.errorCode !== 'INSUFFICIENT_BALANCE'" class="shrink-0 text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer" @click="quote.refresh()">{{ $t('stockTrade.btn.retry') }}</button>
                    </div>
                    <div v-if="minHint" class="px-1 -mt-2 flex flex-col items-start gap-1">
                        <p data-trade-min-hint class="text-xs text-slate-500 dark:text-zinc-400">{{ $t(minHint.key, minHint.params ?? {}) }}<template v-if="minHint.extraKey">{{ " " + $t(minHint.extraKey) }}</template></p>
                        <button v-if="minHint.minAmount" data-trade-use-min class="text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer" @click="useMinAmount">{{ $t('stockTrade.btn.useMin') }}</button>
                    </div>

                    <!-- Teklif yukleniyor: iskelet -->
                    <div v-if="quoteLoading" class="rounded-3xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 p-4 flex flex-col gap-2">
                        <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.quote.loading') }}</span>
                        <span class="block h-3 w-full rounded bg-slate-200 dark:bg-white/10 animate-pulse"></span>
                        <span class="block h-3 w-2/3 rounded bg-slate-200 dark:bg-white/10 animate-pulse"></span>
                    </div>

                    <!-- Teklif karti -->
                    <div v-if="rows" data-trade-fees class="rounded-3xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 p-4 flex flex-col gap-2 text-sm">
                        <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t(rows.spend.labelKey) }}</span><span class="font-semibold">{{ rows.spend.value }}</span></div>
                        <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t(rows.primary.labelKey) }}</span><span class="font-semibold">{{ rows.primary.value }}</span></div>
                        <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t(rows.minimum.labelKey) }}</span><span>{{ rows.minimum.value }}</span></div>
                        <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.quote.unitPrice') }}</span><span>{{ rows.unitPrice }}</span></div>
                        <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.quote.reference') }}</span><span>{{ rows.reference }}</span></div>
                        <p v-if="rows.networkFee" data-trade-network-fee class="text-xs text-slate-500 dark:text-zinc-400">{{ $t(rows.networkFee.key, rows.networkFee.params) }}</p>
                        <div v-if="rows.feeWarning" data-trade-fee-warning class="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">{{ $t(rows.feeWarning.key, rows.feeWarning.params) }}<template v-if="rows.feeWarning.extraKey">{{ " " + $t(rows.feeWarning.extraKey) }}</template></div>
                        <div v-if="rows.priceImpact" data-trade-price-impact class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.quote.priceImpact') }}</span><span>{{ impactText }}</span></div>
                        <!-- Referans farki BILGIDIR (bStocks: |fark| >= %2 sari uyari, kilit yok). -->
                        <p v-if="rows.gap" :data-trade-gap-warn="rows.gapWarn ? '' : undefined" class="text-xs" :class="rows.gapWarn ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-zinc-400'">{{ $t(rows.gapWarn ? 'stockTrade.quote.gapWarn' : rows.gap.key, { pct: rows.gap.pct }) }}</p>
                        <div v-if="rows.fees.length" class="border-t border-slate-100 dark:border-white/5 pt-2 flex flex-col gap-1 text-xs">
                            <span class="font-semibold text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.quote.fees') }}</span>
                            <div v-for="fee in rows.fees" :key="fee.labelKey" class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t(fee.labelKey) }}</span><span>{{ fee.usd }}</span></div>
                            <div class="flex justify-between gap-2 font-semibold"><span>{{ $t('stockTrade.quote.feeTotal') }}</span><span>{{ rows.feesTotalUsd }}</span></div>
                        </div>
                        <!-- bStocks ucreti ATS ile (ustteki CoW ucret dokumu yerine). -->
                        <div v-if="atsRows" data-trade-ats-fees class="border-t border-slate-100 dark:border-white/5 pt-2 flex flex-col gap-1 text-xs">
                            <span class="font-semibold text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.quote.fees') }}</span>
                            <div v-for="r in atsRows" :key="r.labelKey" class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ $t(r.labelKey) }}</span><span>{{ r.value }}</span></div>
                        </div>
                        <p v-if="engine.showsCowDisclosure" data-trade-powered class="text-[10px] text-center text-slate-400 dark:text-zinc-500">{{ $t('stockTrade.quote.poweredBy') }}</p>
                    </div>

                    <!-- Faz 3 ATS islem ucreti karti: yalniz fee.mode 'ats' ve teklif hazirken. Tutar arka plandaki atom dizesinden (formatAmount). -->
                    <div v-if="showCowAtsCard" data-trade-ats-fee>
                        <AtsFeeCard
                            label-key="stockTrade.atsFee.title"
                            paid-with-key="stockTrade.atsFee.sub"
                            paid-on-bsc-key="stockTrade.atsFee.when"
                            :amount="atsCardAmount"
                            symbol="ATS"
                            logo-uri="/ats.png"
                        >
                            <template #details>
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500">{{ $t('stockTrade.atsFee.refund') }}</span>
                                <span v-if="feePreview.lowNetworkFee" data-trade-ats-netnote class="text-[10px] text-slate-500 dark:text-zinc-500">{{ $t('stockTrade.atsFee.netNote') }}</span>
                            </template>
                        </AtsFeeCard>
                    </div>
                    <!-- Hazir olmayan kullanici: tek satir ipucu, ATS alma / hazirlik ekranina. -->
                    <button v-else-if="showAtsHint" data-trade-ats-hint class="self-start text-xs font-bold text-indigo-600 dark:text-indigo-400 cursor-pointer" @click="buyAtsFromApprove">{{ $t('stockTrade.atsFee.prepare') }}</button>
                    <!-- bStocks: ATS ucret karti ana ekranda (onay adimi yok) + fiyat etkisi onay kutusu (>%5). -->
                    <StockAtsFeeCard v-if="showAtsCard" :ats="gates.ats" @onboard="gates.startOnboarding" />
                    <div v-if="gates.priceImpactHigh" data-trade-impact class="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 p-3">
                        <p class="text-xs font-bold text-amber-700 dark:text-amber-400">{{ $t('swap.priceImpactTitle') }}</p>
                        <p class="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">{{ $t('swap.priceImpactBody') }}</p>
                        <label class="mt-2 flex items-center gap-2 cursor-pointer">
                            <input v-model="gates.acknowledged" data-trade-impact-ack type="checkbox" class="accent-amber-600">
                            <span class="text-xs font-bold text-amber-800 dark:text-amber-300">{{ $t('swap.priceImpactAck') }}</span>
                        </label>
                    </div>
                    <div v-else-if="gates.priceImpactUnmeasured" data-trade-impact-unmeasured class="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">{{ $t('swap.priceImpactUnmeasured') }}</div>
                </div>

                <button
                    data-trade-primary
                    class="absolute bottom-5 left-4 right-4 py-4 rounded-2xl font-bold text-base text-white bg-indigo-600 hover:bg-indigo-500 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    :disabled="blockReason !== null"
                    @click="onPrimary"
                >{{ primaryText }}</button>
            </template>
        </section>

        <StockOrderConfirm
            v-if="confirmOpen && stock"
            :quote="quote"
            :side="side"
            :stock="stock"
            :pay-symbol="payToken?.symbol ?? ''"
            :locale="locale"
            :engine="engine"
            :ats-quoted="gates.atsQuoted"
            :ats-blocked="gates.atsBlocked"
            :ats-op-count="gates.ats.opCount"
            :ats-total="gates.ats.totalAtsCost"
            @close="onConfirmClose"
            @expired="onConfirmExpired"
            @placed="onConfirmPlaced"
            @new="onConfirmNew"
        />

        <!-- Once onay ver: harcayici/tutar/cagri arayuzde YOK; yalniz quoteId ve ATS ucret teklifi gider. -->
        <div v-if="approveOpen && stock" data-approve-step class="absolute inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm">
            <div class="w-full max-h-full overflow-y-auto custom-scrollbar rounded-t-3xl bg-white dark:bg-[#131315] border-t border-slate-200 dark:border-white/10 p-5 flex flex-col gap-4 text-slate-900 dark:text-white">
                <h2 class="text-lg font-bold">{{ $t('stockTrade.approve.title') }}</h2>
                <div class="rounded-2xl bg-slate-50 dark:bg-white/5 px-3 py-2 flex flex-col gap-1 text-xs">
                    <span data-approve-unlimited class="text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.approval.unlimited') }}</span>
                    <span v-if="approveStep.resetFirst" data-approve-reset-note class="text-slate-500 dark:text-zinc-400">{{ $t('stockTrade.approve.resetNote') }}</span>
                </div>

                <!-- ATS ucret karti: Swap.vue ucret karti baglari (yeni paylasilan bilesen yok). -->
                <AtsFeeCard
                    label-key="send.confirmTransaction.atsPaidWith"
                    paid-on-bsc-key="send.confirmTransaction.atsPaidOnBsc"
                    :amount="atsFee != null ? atsFeeText : null"
                    :symbol="atsSymbol"
                    :loading="atsLoading || approveStep.loading"
                    logo-uri="/ats.png"
                    :show-up-to="atsFeeRefundable"
                    :prepaid-key="atsPrepaid ? 'send.confirmTransaction.atsPrepaidNote' : null"
                >
                    <template #decision>
                        <div v-if="atsDecisionVisible" class="flex flex-col gap-1.5 pt-2 border-t border-slate-100 dark:border-white/5">
                            <span class="text-xs font-bold" :class="atsDecision.severity === 'user' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-zinc-200'">{{ $t(atsDecision.i18nKey, { symbol: atsSymbol }) }}</span>
                            <span v-if="atsDecision.action === 'run-onboarding'" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(atsNextSteps.length > 1 ? 'send.confirmTransaction.atsOnboardingDesc' : 'send.confirmTransaction.atsBudgetLowDesc') }}</span>
                            <span v-else-if="atsDecision.i18nDescKey" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(atsDecision.i18nDescKey) }}</span>
                            <button
                                v-if="atsDecision.action === 'run-onboarding'"
                                data-approve-onboarding
                                :disabled="atsLoading || atsOnboarding"
                                class="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                                @click="startApproveOnboarding"
                            >{{ $t('send.confirmTransaction.atsOnboardingRun') }}</button>
                            <AtsBuyButton v-if="atsDecision.action === 'buy-ats'" :handler="buyAtsFromApprove" />
                        </div>
                    </template>
                    <template #shortfall>
                        <div v-if="atsInsufficient && !atsLoading && !atsDecisionVisible" class="flex flex-col gap-1 border-t border-slate-100 dark:border-white/5 pt-2">
                            <span class="text-xs font-bold text-rose-600 dark:text-rose-400">{{ $t('send.confirmTransaction.atsInsufficientTitle', { symbol: atsSymbol }) }}</span>
                            <span class="text-[10px] text-rose-500 dark:text-rose-300/80">{{ atsShortfall ? $t('stockTrade.insufficient.detail', atsShortfall.params) : $t('send.confirmTransaction.atsInsufficientDesc', { amount: atsRequiredText, symbol: atsSymbol }) }}</span>
                            <AtsBuyButton :handler="buyAtsFromApprove" />
                        </div>
                    </template>
                </AtsFeeCard>

                <p v-if="approveErrorShown" data-approve-error class="rounded-2xl border border-red-300/50 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">{{ $t(cowErrorKey(approveStep.errorCode)) }}</p>

                <div class="grid grid-cols-2 gap-2">
                    <button data-approve-cancel :disabled="approveStep.running" class="py-3 rounded-2xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" @click="closeApprove">{{ $t('stockTrade.confirm.cancel') }}</button>
                    <button data-approve-run :disabled="approveRunDisabled" class="py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" @click="runApprove">{{ approveStep.running ? $t('stockTrade.approve.running') : $t('stockTrade.approve.run') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Back from '../Back.vue'
import StockOrderConfirm from './StockOrderConfirm.vue'
import IssuerSwitch from './IssuerSwitch.vue'
import StockChainPicker from './StockChainPicker.vue'
import StockAtsFeeCard from './StockAtsFeeCard.vue'
import AtsFeeCard from '../AtsFeeCard.vue'
import StockFeeNotice from './StockFeeNotice.vue'
import AtsBuyButton from '../AtsBuyButton.vue'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { useCowQuote } from '../../composables/useCowQuote'
import { useTokenBalance } from '../../composables/useTokenBalance'
import { useAtsFee } from '../../composables/useAtsFee'
import { useAtsPurchase } from '../../composables/useAtsPurchase'
import { XSTOCKS_ATS_FEE_ENABLED } from '../../utils/featureFlags'
import { feeNoticeOf } from '../../utils/cow/feeNotice'
import { useIssuerSwitch } from '../../composables/useIssuerSwitch'
import { fetchMarketStatus } from '../../utils/stocks/marketStatus'
import { useStockEngineGates } from '../../composables/useStockEngineGates'
import { pageStore } from '../../store/pageStore'
import { stockEntry, stockIssuerInfo } from '../../utils/tokenizedStocks'
import { engineFor, tradeEnabledFor } from '../../utils/stocks/engines'
import { cowErrorKey, isCowCode } from '../../utils/cow/errors'
import { ALL_CHAINS } from '../../data/chains'
import { isSameChainId, rpcUrlsOf } from '../../utils/vm'
import { resolveAtsBlocker } from '../../utils/atsBlocker'
import { smallAmountHint } from '../../utils/stockTradeHint'
import { preventInvalidKeys } from '../../utils/preventInvalidKeys'
import { SEND_PERCENTS } from '../../utils/sendPercent'
import { buildInsufficient, chipAmount, cutDisplay, decimalToAtoms, formatAtoms, shortfallOfNumbers } from '../../utils/stockBalance'
import { tokenLogo } from '../../utils/tokenLogo'
import { chainLogo } from '../../utils/chainLogo'
import { PAY_META, cgImage } from '../../utils/payTokenMeta'
import axios from 'axios'
import { configStore } from '../../store/config'
import {
    sanitizeAmountInput,
    tradeBlockReason,
    lockLine,
    formatAmount,
} from '../../utils/stockTrade'

const { t, locale } = useI18n()
const network = networkStore()
const config = configStore()
const crypto = cryptoStore()

// Hisse kimligi: Home.vue openStock `selected_token_ref` yazar; katalog tek yetkili.
// Bu ekran ASLA currentPage yazmaz (Geri dugmesi Back.vue'dan gelir).
// Kapi: bStocks her zaman, xStocks yalniz bayrakla (tradeEnabledFor). Motor ONCE kapidan gecmis hisseye secilir:
// engineFor('xstocks') bayrak kapaliyken de cow doner, kapi tek basina onda degildir.
const stock = computed(() => {
    const r = crypto.selected_token_ref
    if (!r) return null
    const entry = stockEntry(r.chainId, r.address)
    return entry && tradeEnabledFor(entry) ? entry : null
})
const engine = computed(() => (stock.value ? engineFor(stock.value) : null))
const errorKeyOf = (code) => (engine.value ? engine.value.errorKey(code) : cowErrorKey(code))
// Hisse logosu katalogda yok (data/xStocks.js); Hisseler listesiyle ayni uctan gelir. Gelmezse bas harfli yer tutucu.
const stockImage = ref(null)
// bStocks referans fiyati: sunucu priceUSD'si (gosterim birimi, Hisseler sekmesiyle ayni kaynak). Yalniz BILGI (kilit yok).
const refPrice = ref(null)
const refSettled = ref(stock.value?.issuer !== 'bstocks') // bStocks: ilk teklif referans cevaplanmadan istenmez
let logoSeq = 0
const stockLogo = computed(() => tokenLogo({ image: stockImage.value }, null))
const payLogo = (p) => {
    const meta = PAY_META[p.symbol]
    return meta ? tokenLogo({ image: cgImage(meta.large) }, null) : null
}
async function loadStockLogo() {
    const s = stock.value
    const id = s?.coingeckoId
    if (!id) {
        refSettled.value = true // kimliksiz kayit: referans beklenmez, teklif kilitli kalmasin
        return
    }
    const mine = ++logoSeq
    try {
        const resp = await axios.post(config.api + '/getTokensDataById', { ids: [id] }, { timeout: 10000 })
        if (mine !== logoSeq) return
        const rec = (resp?.data?.tokens ?? []).find((d) => d.coingecko_id === id)
        stockImage.value = rec?.image ?? null
        const price = Number(rec?.market_data?.priceUSD)
        refPrice.value = s.issuer === 'bstocks' && Number.isFinite(price) && price > 0 ? price : null
    } catch {
        if (mine !== logoSeq) return
        stockImage.value = null
        refPrice.value = null
    }
    refSettled.value = true
}
const available = computed(() => stock.value !== null && engine.value !== null)
const issuerInfo = computed(() => stockIssuerInfo(stock.value))
const stockChain = computed(() => (stock.value ? ALL_CHAINS.find((c) => isSameChainId(c.chainId, stock.value.chainId)) ?? null : null))
// AG KILIDI YOK (kullanici karari 2026-10-23): hisse cuzdanin aktif agindan baska agda olabilir. Teklif, bakiye, imza
// ve emir hissenin zincirinden (selected_token_ref.chainId) calisir; cuzdanin aktif agina HIC bakilmaz.

// Detaydan gelen yon (StockDetail Al/Sat): mount'ta okunur ve TEMIZLENIR (bayat kalmasin).
const page = pageStore()
const side = ref(page.tradeSide === 'sell' ? 'sell' : 'buy')
page.tradeSide = null
const amount = ref('')
const payTokens = computed(() => (stock.value && engine.value ? engine.value.payTokens(stock.value.chainId) : []))
const payToken = ref(payTokens.value[0] ?? null)
const activeAccount = ref(null)
const accountReady = computed(() => Boolean(activeAccount.value?.address))
const confirmOpen = ref(false) // imza oncesi katman (StockOrderConfirm)
const bannerKey = ref(null) // katman kapaninca gosterilen i18n anahtari (teklif guncellendi / hata kodu)
const justPlaced = ref(false) // bu acilista emir gonderildi: kapaninca teklif + bakiye tazelenir
const approveOpen = ref(false) // zincir ustu onay adimi (ATS karti)
// Adim durumu. quote = COW_APPROVE_QUOTE.quote (ATS ucret teklifi); done = onay dogrulandi bandi.
const approveStep = reactive({ loading: false, quote: null, resetFirst: false, running: false, done: false, errorCode: null })
// Teklif istegini yeniden baslatmak icin kapi: invalidate sonrasi istek anahtari ayni kalir, kapi kapanip acilinca yeni istek atilir.
const quoteGate = ref(true)
let approveSeq = 0 // adim kapaninca/yenilenince gecikmis yanitlari yoksaymak icin
let approveQuoteId = null // adim acilirken sabitlenir; ekran sonradan degisen teklif kimligiyle onay gondermez

const balance = ref(0)
// Zincirdeki TAM bakiye (BigInt atom) + ondaligi: MAX/yuzde cipleri ve yetersiz-bakiye karari bundan. null = bilinmiyor
// (okuma hatasi): cipler pasif. Number `balance` yalniz gosterim ve eski yol icin kalir (18 ondalikta bakiyeyi asabilir).
const balanceAtoms = ref(null)
const balanceDecimals = ref(null)
const balanceLoading = ref(true)
let balanceSeq = 0
// Cip (MAX/yuzde) tutari: amount tam atom dizesidir, girdi alani kirpilmis halini gosterir. Elle yazinca silinir.
const chip = ref(null)

const spendSymbol = computed(() => (side.value === 'buy' ? payToken.value?.symbol ?? '' : stock.value?.symbol ?? ''))
// Sahip olunan miktar ASLA fazla gosterilmez: tam atom varsa BigInt'ten asagi kirpilir, yoksa Number asagi kirpilir.
const balanceText = computed(() => {
    if (balanceAtoms.value !== null && balanceDecimals.value !== null) {
        return formatAtoms(balanceAtoms.value, balanceDecimals.value, { locale: locale.value })
    }
    const n = Number(balance.value)
    if (!Number.isFinite(n)) return '-'
    return String(Math.floor(n * 1e6) / 1e6)
})
const amountShown = computed(() => (chip.value !== null && chip.value.amount === amount.value ? chip.value.display : amount.value))

const visible = ref(typeof document === 'undefined' || document.visibilityState !== 'hidden')
const onVisibility = () => {
    visible.value = document.visibilityState !== 'hidden'
    if (visible.value && mounted) refreshMarket()
}

// Teklif: hesap arka planda (COW_QUOTE); ekran yalniz gosterir.
const request = computed(() =>
    stock.value && engine.value
        ? engine.value.buildQuoteMessage({
              side: side.value,
              chainId: stock.value.chainId,
              stockAddress: stock.value.address,
              payToken: payToken.value,
              amount: amount.value,
              referencePrice: refPrice.value,
          })
        : null,
)
// xStocks ihraccisinin piyasa durumu (marketStatus): kapaliyken secici 'alim kapali' notu gosterir (kullanici karari 2026-10-24).
// null = bilinmiyor/hata -> kilit YOK (mevcut davranis). Ihracci gecisi onIssuerSwitched'te (setup'ta cagrilmaz: market basta null).
const market = ref(null)
const issuerSwitch = reactive(useIssuerSwitch({ onSwitched: onIssuerSwitched, market: () => market.value }))
// xStocks secili + kapali + Al sekmesi: kilitli, teklif istenmez, mevcut kapali mesaji gosterilir. Sat etkilenmez.
const marketBlocked = computed(() => issuerSwitch.blocked && side.value === 'buy')
const quoteEnabled = computed(() => Boolean(stock.value) && accountReady.value && quoteGate.value && refSettled.value && !marketBlocked.value)
// Katman acikken otomatik yenileme KAPALI: eski sayilarla imza yolu olmasin (katman suresi kendi kapanir).
// Teklifi motor verir (xStocks COW_QUOTE, bStocks SWAP_QUOTE); yanit sekli ortaktir. Yenileme motorun expiresAt'inda (bStocks 30 sn).
const quote = reactive(useCowQuote({ request, enabled: quoteEnabled, visible: () => visible.value && !confirmOpen.value && !approveOpen.value, send: (message) => engine.value.quote(message) }))
// Motora bagli ek kapilar (bStocks: ATS ucreti + fiyat etkisi onayi); xStocks icin hep null.
const gates = reactive(useStockEngineGates({ engine, quote, account: activeAccount }))

const blockReason = computed(() =>
    marketBlocked.value ? 'lock-MARKET_CLOSED' : tradeBlockReason({
        enabled: Boolean(stock.value),
        stockOk: Boolean(stock.value),
        accountReady: accountReady.value,
        amount: amount.value,
        balanceLoading: balanceLoading.value,
        balance: balance.value,
        balanceAtoms: balanceAtoms.value,
        balanceDecimals: balanceDecimals.value,
        quote: { state: quote.state, lockReason: quote.lockReason },
    }) ?? gates.extraBlock,
)
const primaryAction = computed(() => engine.value?.primaryAction(quote.result) ?? 'trade')

const rows = computed(() => {
    if ((quote.state !== 'ready' && quote.state !== 'locked') || !quote.result) return null
    return engine.value.quoteRows({
        result: quote.result,
        side: side.value,
        symbol: stock.value?.symbol,
        paySymbol: payToken.value?.symbol,
        locale: locale.value,
        chainId: stock.value?.chainId,
    })
})
const impactText = computed(() => {
    const p = rows.value?.priceImpact
    if (!p) return ''
    return typeof p.pct === 'number' ? `${p.pct.toFixed(2)}%` : t('stockTrade.quote.priceImpactUnmeasured')
})
const quoteLoading = computed(() => quote.state === 'loading' && request.value !== null)
const lock = computed(() => {
    if (marketBlocked.value) return lockLine({ lockReason: 'MARKET_CLOSED', side: side.value, nextChangeAt: market.value?.nextChangeAt, locale: locale.value })
    if (quote.state !== 'locked') return null
    return lockLine({
        lockReason: quote.lockReason,
        side: side.value,
        gapPct: quote.result?.display?.gapPct,
        nextChangeAt: quote.result?.nextChangeAt,
        locale: locale.value,
    })
})
// Kucuk tutar ipucu: yalniz aciklama (kilit/hata ayni kalir). Kilit mesajinin altinda gorunur.
const minHint = computed(() => {
    if (!stock.value || !engine.value?.showsCowDisclosure) return null // ipucu CoW ag ucretine ozgu
    if (quote.state !== 'locked' && quote.state !== 'error') return null
    return smallAmountHint({
        chainId: stock.value.chainId,
        side: side.value,
        errorCode: quote.state === 'error' ? quote.errorCode : null,
        errorInfo: quote.state === 'error' ? quote.errorInfo : null,
        symbol: spendSymbol.value,
        locale: locale.value,
    })
})
// "En az tutari gir": tutar alanini hesaplanan en az tutarla doldurur (yeni teklif kendiliginden istenir).
function useMinAmount() {
    const min = minHint.value?.minAmount
    if (!min) return
    amount.value = sanitizeAmountInput(min)
    bannerKey.value = null
    approveStep.done = false
}
const notice = computed(() => (side.value === 'sell' && quote.state === 'ready' ? rows.value?.notice ?? null : null))

// ATS ucret durumu (Takas ile ayni kural: ATS zorunlu, secim yok). Teklif kaynagi COW_APPROVE_QUOTE.
const {
    atsFee, atsBalance, atsSymbol, isCrosschain: atsCrosschain, ready: atsReady, decision: atsDecision,
    nextSteps: atsNextSteps, feeTotal: atsFeeTotal, requiredAts, feeRefundable: atsFeeRefundable, prepaid: atsPrepaid,
    loading: atsLoading, onboarding: atsOnboarding, insufficient: atsInsufficient, blocked: atsBlocked,
    loadAtsFee, runOnboarding: runAtsOnboarding,
} = useAtsFee()

const fmtAts = (n) => (n == null ? '' : Number(n).toFixed(4).replace(/\.?0+$/, ''))
// bStocks ucret dokumu (useAtsOpFee, onayli ucret): bootstrap op'u varsa yalniz toplam (kalemler toplami tutmaz).
const atsRows = computed(() => {
    const q = gates.atsQuoted
    if (!q || rows.value === null) return null
    const sym = gates.ats.atsSymbol
    const total = { labelKey: 'stockTrade.quote.feeAtsTotal', value: `${fmtAts(gates.ats.totalAtsCost)} ${sym}` }
    if (gates.ats.opCount > 1) return [total]
    return [
        { labelKey: 'stockTrade.quote.feeAtsNetwork', value: `${fmtAts(q.transferFee)} ${sym}` },
        { labelKey: 'stockTrade.quote.feeAtsCommission', value: `${fmtAts(q.commissionFee)} ${sym}` },
        total,
    ]
})
const showAtsCard = computed(() => engine.value?.id === 'pancake' && quote.state === 'ready')
const atsFeeText = computed(() => fmtAts(atsFeeTotal.value))
const atsRequiredText = computed(() => fmtAts(requiredAts.value))
// Eksik ATS: gereken / mevcut / eksik (Number degerlerinden, gereken yukari mevcut asagi yuvarlanir). Kurulamazsa eski 'gerekli' satiri.
const atsShortfall = computed(() => shortfallOfNumbers({ required: requiredAts.value, have: atsBalance.value, symbol: atsSymbol.value, locale: locale.value }))
// Engel karti: backend kendi engelini verdiyse ve istemci hatasi degilse gorunur.
const atsDecisionVisible = computed(() => Boolean(atsDecision.value) && !atsLoading.value && atsDecision.value.severity !== 'internal')
// Sunucu hata satiri: ATS engel karti ayni seyi anlatiyorsa tekrarlanmaz.
const approveErrorShown = computed(() => approveStep.errorCode !== null && !atsDecisionVisible.value)
const approveRunDisabled = computed(() => approveStep.running || approveStep.loading || atsBlocked.value || !approveStep.quote)

const primaryText = computed(() => {
    const r = blockReason.value
    if (r === null) {
        if (primaryAction.value === 'approve') return t('stockTrade.btn.approveFirst')
        return side.value === 'buy' ? t('stockTrade.btn.buy') : t('stockTrade.btn.sell')
    }
    if (r === 'enter-amount') return t('stockTrade.btn.enterAmount')
    if (r === 'balance-loading' || r === 'quote-loading' || r === 'ats-loading') return t('stockTrade.btn.loading')
    if (r === 'insufficient-balance') return t('stockTrade.btn.insufficient')
    if (r === 'lock-FEE_DEBT') return t('stockTrade.atsFee.payFirst')
    if (r === 'ats-insufficient' || r === 'ats-blocked') return t('stockTrade.btn.atsBlocked')
    if (r === 'price-impact') return t('stockTrade.btn.confirmImpact')
    if (r.startsWith('lock-')) return t('stockTrade.btn.locked')
    return t('stockTrade.btn.unavailable')
})

// --- Faz 3 ATS islem ucreti (spec 4.1 / 4.2) ---
// Ekran sayi uretmez: tutar teklif kaydindaki atom dizesinden (formatAmount), metin karari feeNoticeOf'tan.
const feePreview = computed(() => {
    if (!XSTOCKS_ATS_FEE_ENABLED || quote.state !== 'ready') return null
    const fp = quote.result?.feePreview
    return fp && typeof fp === 'object' ? fp : null
})
const atsCardAmount = computed(() => {
    const fp = feePreview.value
    if (!fp || fp.mode !== 'ats' || !Number.isInteger(fp.decimals)) return null
    const txt = formatAmount(fp.quotedAtsRaw, fp.decimals, 2)
    return txt === '-' ? null : txt
})
const showCowAtsCard = computed(() => atsCardAmount.value !== null)
const showAtsHint = computed(() => feePreview.value?.mode === 'none' && feePreview.value.hint === true)
// Bildirimlerde tutar ATS (BSC, 18 ondalik).
const ATS_DECIMALS = 18
const formatAtsRaw = (raw) => {
    const txt = formatAmount(raw, ATS_DECIMALS, 2)
    return txt === '-' ? '' : txt
}

const FEE_UID_RE = /^0x[0-9a-f]{112}$/
const FEE_NOTICE_MAX = 3
const feeViews = ref([])
const dismissedFees = ref([]) // 'Vazgec' ile kapatilan bildirimler (kilit surer, yalniz bildirim gizlenir)
const feeWalletLocked = ref(false)
const feeBusy = ref(false)
const feeApproved = ref(false) // degisen ucret onaylandi: PENDING/APPROVED -> "onaylandi, ucret aliniyor"
const feeErrorCode = ref(null)
const noticeViews = computed(() => {
    if (!XSTOCKS_ATS_FEE_ENABLED) return []
    return feeViews.value
        .filter((v) => v && !dismissedFees.value.includes(v.uid))
        .filter((v) => {
            const n = feeNoticeOf(v)
            return n !== null && n.tone !== 'ok'
        })
        .slice(0, FEE_NOTICE_MAX)
})

async function loadFees() {
    // Ucret/borc bildirimleri CoW (xStocks) emirlerine ozgu: bStocks (pancake) motorunda COW_FEE_STATUS hic gonderilmez.
    if (!XSTOCKS_ATS_FEE_ENABLED || engine.value?.id !== 'cow') return
    let resp
    try {
        resp = await chrome.runtime.sendMessage({ type: 'COW_FEE_STATUS' })
    } catch {
        resp = null
    }
    // Okuma basarisizsa onceki gorunum kalir (borcu gizlemek yerine eski bilgiyi gostermek guvenli).
    if (resp && resp.success === true && Array.isArray(resp.fees)) feeViews.value = resp.fees
}

// Arka plana tek mesaj; hata ham metinle degil kodla (cowErrorKey) gosterilir.
async function feeCall(msg) {
    let resp
    try {
        resp = await chrome.runtime.sendMessage(msg)
    } catch {
        resp = null
    }
    if (!resp || resp.success !== true) {
        const code = resp && isCowCode(resp.code) ? resp.code : 'UNKNOWN'
        feeErrorCode.value = code
        feeWalletLocked.value = code === 'WALLET_LOCKED'
        return null
    }
    feeWalletLocked.value = false
    return resp
}

async function onFeeAction({ name, uid } = {}) {
    if (!XSTOCKS_ATS_FEE_ENABLED || feeBusy.value) return
    if (typeof uid !== 'string' || !FEE_UID_RE.test(uid)) return
    feeErrorCode.value = null
    feeApproved.value = false
    if (name === 'decline') {
        dismissedFees.value = [...dismissedFees.value, uid]
        return
    }
    if (name === 'buyAts') {
        await buyAtsFromApprove()
        return
    }
    if (name !== 'payNow' && name !== 'retry' && name !== 'approve' && name !== 'prepare') return
    feeBusy.value = true
    try {
        if (name === 'approve') {
            const resp = await feeCall({ type: 'COW_FEE_APPROVE_CHANGE', message: { uid } })
            // Onay islendi: ucret arka planda alinir (PENDING/APPROVED) -- ekran "onaylandi, ucret aliniyor" der.
            if (resp && resp.outcome?.outcome === 'PENDING' && resp.outcome?.code === 'APPROVED') feeApproved.value = true
        } else if (name === 'prepare') {
            // Mevcut BSC hazirlik yolu (yeni onboarding yazilmaz); basarisizsa ucret cagrisi YAPILMAZ.
            const ok = await runAtsOnboarding({
                chainId: 56,
                address: activeAccount.value?.address,
                call: null,
                sentAssetAddress: null,
                sendAmount: 0,
                fetchQuote: async () => ({ success: false, error: 'stale' }),
            })
            if (ok === true) await feeCall({ type: 'COW_FEE_PAY' })
        } else {
            await feeCall({ type: 'COW_FEE_PAY' })
        }
    } finally {
        feeBusy.value = false
    }
    await loadFees()
    // Borc kilidiyle bekleyen teklif odemeden sonra yeniden istenir.
    if (feeErrorCode.value === null && blockReason.value === 'lock-FEE_DEBT') quote.refresh()
}

// Bakiye HISSENIN zincirinden okunur. Aktif ag ayniysa kullanicinin RPC'si; degilse hissenin zincirinin RPC'si.
// Zincirin RPC'si yoksa aktif agin RPC'sine DUSULMEZ (ayni adres baska zincirde yanlis bakiye verirdi): firlatir,
// loadBalance bilinmeyen bakiye sayar.
function rpcForStock() {
    if (isSameChainId(network.currentNetwork?.chainId, stock.value?.chainId)) return network.rpc
    const url = rpcUrlsOf(stockChain.value)[0]
    if (!url) throw new Error('no-rpc')
    return url
}

async function loadBalance() {
    const address = activeAccount.value?.address
    const s = stock.value
    if (!address || !s || !payToken.value) {
        balanceLoading.value = false
        return
    }
    const mine = ++balanceSeq
    balanceLoading.value = true
    // Al'da odeme tokeni, Sat'ta hisse. Ekranda birim donusumu YOK: useTokenBalance bStocks icin balanceOfUI (UI birimi), xStocks icin balanceOf okur.
    const tokenAddress = side.value === 'buy' ? payToken.value.address : s.address
    try {
        const value = await useTokenBalance(address, tokenAddress, rpcForStock(), s.chainId, { exact: true })
        if (mine !== balanceSeq) return
        if (value !== null && typeof value === 'object' && typeof value.atoms === 'bigint') {
            balance.value = Number(value.balance)
            balanceAtoms.value = value.atoms
            balanceDecimals.value = value.decimals
        } else {
            balance.value = Number(value)
            balanceAtoms.value = null
            balanceDecimals.value = null
        }
    } catch {
        if (mine !== balanceSeq) return
        balance.value = Number.NaN // bilinmeyen bakiye yetersiz sayilir (isInsufficientBalance)
        balanceAtoms.value = null
        balanceDecimals.value = null
    }
    balanceLoading.value = false
}

function setSide(next) {
    if (side.value === next) return
    side.value = next
    bannerKey.value = null
    approveStep.done = false
    amount.value = ''
    quote.invalidate()
    loadBalance()
}

function setPayToken(p) {
    if (payToken.value?.address === p.address) return
    payToken.value = p
    bannerKey.value = null
    approveStep.done = false
    if (side.value === 'buy') {
        amount.value = ''
        quote.invalidate()
        loadBalance()
    }
}

function onAmountInput(e) {
    chip.value = null
    amount.value = sanitizeAmountInput(e.target.value)
    bannerKey.value = null
    approveStep.done = false
    if (e.target.value !== amount.value) e.target.value = amount.value
}

// MAX ve yuzde cipleri zincirdeki TAM atom bakiyesinden hesaplanir ve ASAGI yuvarlanir: Number bakiyeden hesap, 18 ondalikli
// tokende bakiyenin USTUNE cikip INSUFFICIENT_BALANCE uretiyordu. Atom bilinmiyorsa cip tutar YAZMAZ (butonlar pasif).
function setPercent(percent) {
    if (balanceAtoms.value === null || balanceDecimals.value === null) return
    const c = chipAmount({ atoms: balanceAtoms.value, decimals: balanceDecimals.value, percent })
    chip.value = c.amount ? c : null
    amount.value = c.amount
}

// 'Bakiye yetersiz' karti: gereken / mevcut / eksik. Kaynak oncelikle arka plan (rezerv dusulmus kullanilabilir), yoksa ekranin
// kendi tam bakiyesi ve tutari. Token = SATILAN token (Al'da odeme tokeni, Sat'ta hisse) = spendSymbol.
const insufficientCard = computed(() => {
    if (quote.state !== 'error' || quote.errorCode !== 'INSUFFICIENT_BALANCE') return null
    const symbol = spendSymbol.value
    const info = quote.errorInfo
    if (info) {
        return buildInsufficient({ requiredAtoms: info.requiredAtoms, availableAtoms: info.availableAtoms, decimals: info.decimals, symbol, locale: locale.value })
    }
    if (balanceAtoms.value === null || balanceDecimals.value === null) return null
    const need = decimalToAtoms(amount.value, balanceDecimals.value)
    if (need === null) return null
    return buildInsufficient({ requiredAtoms: need, availableAtoms: balanceAtoms.value, decimals: balanceDecimals.value, symbol, locale: locale.value })
})
// 'Tutari bakiyeye esitle': tutar kullanilabilir TAM atom olur (zaten bakiye, ek yuvarlama yok).
function useFullBalance() {
    const eq = insufficientCard.value?.equalizeAmount
    if (!eq) return
    chip.value = { amount: eq, display: cutDisplay(eq) }
    amount.value = eq
    bannerKey.value = null
    approveStep.done = false
}

// COW_APPROVE_QUOTE yanitini useAtsFee'nin bekledigi ATS_FEE_QUOTE seklinde dondurur (kart/engel mantigi kopyalanmaz).
function approveFetcher(mine, quoteId) {
    return async () => {
        let resp
        try {
            resp = await chrome.runtime.sendMessage({ type: 'COW_APPROVE_QUOTE', message: { quoteId } })
        } catch {
            resp = null
        }
        if (mine !== approveSeq) return { success: false, error: 'stale' }
        if (!resp || resp.success !== true || !resp.quote || typeof resp.quote !== 'object') {
            approveStep.quote = null
            approveStep.resetFirst = false
            approveStep.errorCode = resp && isCowCode(resp.code) ? resp.code : 'UNKNOWN'
            // ATS kodu varsa karti engel karariyla anlatir (resolveAtsBlocker); yoksa yalniz sunucu hata metni.
            return {
                success: false,
                error: approveStep.errorCode,
                code: typeof resp?.atsCode === 'string' ? resp.atsCode : undefined,
                httpStatus: typeof resp?.httpStatus === 'number' ? resp.httpStatus : undefined,
            }
        }
        approveStep.quote = resp.quote
        approveStep.resetFirst = resp.resetFirst === true
        approveStep.errorCode = null
        return { ...resp.quote, success: true }
    }
}

function approveFeeArgs(mine, quoteId) {
    return {
        chainId: stock.value.chainId,
        address: activeAccount.value?.address,
        call: null,
        sentAssetAddress: null,
        sendAmount: 0,
        fetchQuote: approveFetcher(mine, quoteId),
    }
}

async function loadApproveQuote() {
    const mine = ++approveSeq
    const quoteId = approveQuoteId
    Object.assign(approveStep, { loading: true, quote: null, resetFirst: false, running: false, done: false, errorCode: null })
    try {
        if (!quoteId || !stock.value) {
            approveStep.errorCode = 'QUOTE_NOT_FOUND'
        } else {
            await loadAtsFee(approveFeeArgs(mine, quoteId))
        }
    } catch {
        if (mine === approveSeq) approveStep.errorCode = 'UNKNOWN'
    }
    if (mine !== approveSeq) return
    approveStep.loading = false
    if (approveStep.errorCode === 'QUOTE_EXPIRED') expireApprove()
}

function openApprove() {
    approveQuoteId = typeof quote.quoteId === 'string' ? quote.quoteId : null
    approveOpen.value = true
    return loadApproveQuote()
}

function closeApprove() {
    approveSeq += 1
    approveOpen.value = false
    approveStep.loading = false
    approveStep.running = false
}

// Onay suresi (approveUntil) gecti: adim kapanir, teklif yenilenir.
function expireApprove() {
    closeApprove()
    bannerKey.value = cowErrorKey('QUOTE_EXPIRED')
    quote.refresh()
}

// ATS AL: cuzdanin mevcut alim ekranina gider (Swap.vue ile ayni yol). Ekran degisince bu
// bilesen kapanir; adim kapatilir ve donuste yeniden acilan adim bakiyeyi/ucreti taze okur.
const atsPurchase = useAtsPurchase()
async function buyAtsFromApprove() {
    closeApprove()
    return atsPurchase.open()
}

async function startApproveOnboarding() {
    if (!approveOpen.value || !stock.value || atsOnboarding.value) return
    const mine = ++approveSeq
    approveStep.errorCode = null
    approveStep.loading = true
    await runAtsOnboarding(approveFeeArgs(mine, approveQuoteId))
    if (mine === approveSeq) approveStep.loading = false
}

async function runApprove() {
    if (approveRunDisabled.value || !approveQuoteId) return
    const mine = approveSeq
    const quoteId = approveQuoteId
    // Onaylanan ATS ucreti (kart ile ayni sayi); executeAtsTransfer bunu ust sinir olarak kullanir.
    const quoted = { transferFee: atsFee.value }
    approveStep.running = true
    approveStep.errorCode = null
    let resp
    try {
        resp = await chrome.runtime.sendMessage({ type: 'COW_APPROVE_EXECUTE', message: { quoteId, quoted } })
    } catch {
        resp = null
    }
    if (mine !== approveSeq) return
    approveStep.running = false
    // Basari = arka plan allowance'i zincirden dogruladi (confirmed). APPROVAL_REQUIRED basari SAYILMAZ.
    if (resp && resp.success === true && resp.confirmed === true) {
        approveOpen.value = false
        approveStep.quote = null
        approveStep.done = true
        quote.invalidate()
        quoteGate.value = false
        await nextTick()
        quoteGate.value = true
        return
    }
    const code = resp && isCowCode(resp.code) ? resp.code : 'UNKNOWN'
    if (code === 'QUOTE_EXPIRED') {
        expireApprove()
        return
    }
    approveStep.errorCode = code
    if (typeof resp?.atsCode === 'string') atsDecision.value = resolveAtsBlocker(resp.atsCode, { httpStatus: 400 })
}

function onPrimary() {
    if (quote.state !== 'ready' || blockReason.value !== null) return
    if (primaryAction.value === 'approve') {
        openApprove()
        return
    }
    bannerKey.value = null
    justPlaced.value = false
    confirmOpen.value = true
}

// Katmandan gelen olaylar. Teklifi yenileme isini katman yapar (refresh); burasi yalniz gorunumu surer.
function onConfirmExpired({ code } = {}) {
    confirmOpen.value = false
    justPlaced.value = false
    bannerKey.value = code ? cowErrorKey(code) : 'stockTrade.quote.updated'
}
function onConfirmPlaced() {
    justPlaced.value = true
}
function onConfirmClose() {
    confirmOpen.value = false
    if (!justPlaced.value) return
    // Emir gitti: teklif kaydi tuketildi, bakiye degisti.
    justPlaced.value = false
    quote.refresh()
    loadBalance()
}
function onConfirmNew() {
    confirmOpen.value = false
    justPlaced.value = false
    amount.value = ''
    quote.invalidate()
    loadBalance()
}

// Ihracci degisti (bStocks <-> xStocks): hisse, motor ve bazen zincir degisir. setSide kalibi: tutar, teklif, bant sifirlanir;
// odeme tokeni hedef motorun varsayilanina doner; referans fiyat/logo yeni hisse icin yeniden okunur.
function onIssuerSwitched() {
    closeApprove()
    bannerKey.value = null
    approveStep.done = false
    amount.value = ''
    payToken.value = payTokens.value[0] ?? null
    quote.invalidate()
    refPrice.value = null
    refSettled.value = stock.value?.issuer !== 'bstocks'
    stockImage.value = null
    loadStockLogo()
    loadBalance()
}

// Hesap degisince adim kapanir (gecikmis yanitlar closeApprove ile yoksayilir).
watch(() => activeAccount.value?.address, (next, prev) => {
    if (prev !== undefined && next !== prev && approveOpen.value) closeApprove()
})

// Piyasa durumu: xStocks satiri varsa ihracci API'sinden; hata/belirsiz -> null. Acilis/kapanis aninda ve gorunur olunca tazelenir.
let marketSeq = 0
let marketTimer = null
async function refreshMarket() {
    const row = issuerSwitch.marketRow
    const mine = ++marketSeq
    clearTimeout(marketTimer)
    if (!row) { market.value = null; return }
    let next = null
    try { next = await fetchMarketStatus(row) } catch { next = null }
    if (mine !== marketSeq) return
    market.value = next
    const at = next?.nextChangeAt ? Date.parse(next.nextChangeAt) : NaN
    if (Number.isFinite(at)) marketTimer = setTimeout(refreshMarket, Math.min(Math.max(at - Date.now() + 2000, 5000), 3_600_000))
}
watch(() => issuerSwitch.marketRow?.symbol, () => { if (mounted) refreshMarket() })
let mounted = false

onMounted(async () => {
    if (!stock.value) return
    mounted = true
    refreshMarket()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    const logoLoad = loadStockLogo()
    const { active_account } = await chrome.storage.local.get('active_account')
    activeAccount.value = active_account ?? null
    // SIRA ONEMLI: bakiye hesap atandiktan SONRA (Swap.vue ile ayni).
    await loadBalance()
    await loadFees()
    await logoLoad
})

onUnmounted(() => {
    mounted = false
    marketSeq += 1
    clearTimeout(marketTimer)
    balanceSeq += 1
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
})
</script>
