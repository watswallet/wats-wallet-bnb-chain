<template>
    <div @pointerdown.passive="scheduler.touch()" class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden transition-colors duration-300">
        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10">
            <Back page="home" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight">{{ pageTitle }}</h1>
            <!-- "?" (K4): nasil calistigini PrivateInfoSheet anlatir; kapaninca odak bu dugmeye doner. -->
            <button type="button" ref="infoTrigger" data-testid="info-button" aria-haspopup="dialog" :aria-label="$t('privacy.transfer.howTitle')" @click="infoOpen = true" class="absolute right-5 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold leading-none text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer">?</button>
        </div>
        <!-- Paneller body'ye tasinir (ekran kokleri transform/backdrop tasiyabilir); pi-sheet gecisinin CSS'i PrivacyIntro.vue'da. -->
        <Teleport to="body">
            <Transition name="pi-sheet" :duration="{ enter: 380, leave: 240 }">
                <PrivateInfoSheet v-if="infoOpen" :mode="mode" :chain-name="deliveryChainName" @close="closeInfo" />
            </Transition>
        </Teleport>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 pt-2 pb-2 flex flex-col gap-2 relative z-10">
            <!-- Hesaplar arasi (Para yukle, sahip karari F1): solda KAYNAK hesap karesi (Kimden, K3, sT9), sagda Gizli Hesap karesi (etkilesimsiz), ortada ok.
                 Hesap sayisi > 1 ise kaynak karesi etkilesimli (okla) ve yalniz KAYNAK hesabi secer (aktif Gizli Hesap degismez); tek hesapta dugmesiz duz kare.
                 Eski "Kimden: ad, adres" metni karenin aria-label'i olarak kalir. -->
            <div v-if="mode === 'fund' && sourceAccount" class="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5 pt-1">
                <component
                    :is="fromInteractive ? 'button' : 'div'"
                    ref="fromTrigger"
                    :type="fromInteractive ? 'button' : undefined"
                    :role="fromInteractive ? undefined : 'group'"
                    :aria-haspopup="fromInteractive ? 'dialog' : undefined"
                    :aria-label="$t('privacy.transfer.fromPill', { name: sourceAccount.name, address: shortenAddress(sourceAccount.address) })"
                    data-testid="from-pill"
                    @click="fromInteractive && (fromOpen = true)"
                    class="min-w-0 flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 px-2 py-2.5 text-center transition-colors duration-300"
                    :class="fromInteractive ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5' : ''"
                >
                    <img :src="fromIdenticon" alt="" decoding="async" class="w-8 h-8 rounded-full shrink-0" />
                    <span class="flex flex-col items-center min-w-0 max-w-full leading-tight gap-0.5">
                        <span class="flex items-center justify-center gap-1 min-w-0 max-w-full">
                            <span class="truncate text-sm font-semibold">{{ sourceAccount.name }}</span>
                            <svg v-if="fromInteractive" class="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-zinc-400" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z" /></svg>
                        </span>
                        <span class="font-mono text-[11px] text-slate-500 dark:text-zinc-500">{{ shortenAddress(sourceAccount.address) }}</span>
                    </span>
                </component>
                <svg class="w-4 h-4 shrink-0 text-slate-400 dark:text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                <div data-testid="private-tile" class="min-w-0 flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 px-2 py-2.5 text-center transition-colors duration-300">
                    <span class="w-8 h-8 rounded-full border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0 text-slate-600 dark:text-zinc-300">
                        <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    </span>
                    <span class="flex flex-col items-center min-w-0 max-w-full leading-tight gap-0.5">
                        <span class="truncate max-w-full text-sm font-semibold">{{ $t('privacy.transfer.privateAccountName') }}</span>
                        <span v-if="privacy.active" class="font-mono text-[11px] text-slate-500 dark:text-zinc-500">{{ shortenAddress(privacy.privateAddress || '') }}</span>
                    </span>
                </div>
            </div>
            <Teleport v-if="mode === 'fund' && fromInteractive" to="body">
                <Transition name="pi-sheet" :duration="{ enter: 380, leave: 240 }">
                    <PrivateOptionSheet v-if="fromOpen" :title="$t('privacy.transfer.fromAccount')" title-id="from-sheet-title" :options="accountOptions" :selected="sourceKey" @select="onPickFrom" @close="closeFrom" />
                </Transition>
            </Teleport>

            <!-- Ana kart (Swap.vue sinif kumesi; Para yukle, Takas, Kopru): ust kutu = odeme (bakiye, yuzde cipleri, kaynak cipi, tutar), rozet, alt kutu.
                 Gonder bu karti KULLANMAZ: kartsiz "buyuk tutar" duzeni (sahip karari A) asagidaki sablondadir. Ortada dev tutar, altinda kucuk kaynak hapi, bakiye +
                 yuzde cipleri; sonra Alici (sagda "SilentSwap ile gizli" notu), tek dugme olan teslim ozet satiri ve "En az" / "Odeyecegin" satiri. Kart `v-else`
                 oldugundan yorumlar ikisinin ARASINA girmez (aksi halde `v-else` dali parcaya doner). -->
            <template v-if="mode === 'send'">
                <div class="shrink-0 flex flex-col items-center pt-1">
                    <!-- Kaynak USDC degilse tutarin hemen yaninda "USDC" birimi (tutar USDC degerindedir, kaynak varligi degil): girdi icerigi kadar genisler (field-sizing),
                         birim taban cizgisinde ve bir kademe kucuk durur; USDC kaynakta birim yok, girdi tam genislik. -->
                    <div class="w-full min-w-0 flex items-baseline justify-center gap-2">
                        <input
                            v-model.trim="amount"
                            data-testid="amount-input"
                            type="text"
                            inputmode="decimal"
                            spellcheck="false"
                            placeholder="0"
                            class="min-w-0 h-14 font-bold text-center bg-transparent placeholder-slate-300 dark:placeholder-zinc-700 outline-none transition-colors duration-300"
                            :class="[heroAmountClass, showUnit ? 'field-sizing-content max-w-full' : 'w-full', amountRed ? 'text-red-500 dark:text-red-400' : 'text-slate-900 dark:text-white']"
                        />
                        <span v-if="showUnit" data-testid="amount-unit" aria-hidden="true" class="shrink-0 font-semibold text-slate-400 dark:text-zinc-500 transition-colors duration-300" :class="heroUnitClass">USDC</span>
                    </div>
                    <div class="mt-2 flex flex-col items-center gap-1 max-w-full">
                        <PrivateAssetChip
                            ref="sourceChipEl"
                            testid="source-chip"
                            compact
                            :logo="sourceLogo"
                            :badge="sourceBadge"
                            :symbol="asset"
                            :network="chain ? chain.name : ''"
                            :interactive="sourceInteractive"
                            @click="sourcePickerOpen = true"
                        />
                        <span v-if="showUnit" data-testid="usdc-value-note" class="text-center text-[11px] leading-snug text-slate-500 dark:text-zinc-400">{{ $t('privacy.transfer.usdcEntryNote', { asset }) }}</span>
                    </div>
                    <!-- Sarma politikasi kartla ayni: bakiye hic kirilmaz (whitespace-nowrap), cipler tasarsa alt satira iner. -->
                    <div class="mt-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                        <span data-testid="balance" class="whitespace-nowrap" :class="{ 'text-red-500 dark:text-red-400': balanceRed || payExceedsBalance }">{{ $t('swap.balance') }}: {{ balanceLabel }}</span>
                        <template v-if="showPercentChips">
                            <button
                                v-for="p in PERCENT_CHIPS"
                                :key="p"
                                type="button"
                                :data-testid="p === 1 ? 'percent-max' : 'percent-' + p * 100"
                                class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold px-1 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                @click="setPercent(p)"
                            >{{ p === 1 ? 'MAX' : $t('common.percentChip', { value: p * 100 }) }}</button>
                        </template>
                    </div>
                    <p v-if="amountInvalid" data-testid="amount-error" class="mt-1.5 text-center text-[11px] font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.amountInvalid') }}</p>
                    <p v-else-if="belowMin" data-testid="amount-min" class="mt-1.5 text-center text-[11px] font-medium text-red-600 dark:text-red-400">{{ belowMinText }}</p>
                </div>

                <!-- Alici (K1): etiket satirinda sagda "SilentSwap ile gizli" notu (rozet), altinda mono adres girdisi ve "Yapistir". Alici Gizli Hesap'in
                     kendisiyse kutunun altinda kirmizi uyari. Adres her tusta teklif ISTEMEZ: teklif zamanlamasi sonraki gorevdedir. -->
                <div class="shrink-0 flex flex-col gap-1.5 mt-1">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 transition-colors duration-300">{{ $t('privacy.transfer.recipient') }}</span>
                        <span data-testid="private-badge" class="inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-zinc-500 transition-colors duration-300">
                            <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            {{ $t('privacy.transfer.privateBadge') }}
                        </span>
                    </div>
                    <div class="flex items-center gap-2 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2.5 transition-colors duration-300">
                        <input
                            v-model.trim="recipient"
                            data-testid="recipient-input"
                            type="text"
                            spellcheck="false"
                            autocomplete="off"
                            placeholder="0x..."
                            class="w-full min-w-0 bg-transparent outline-none font-mono text-xs text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-zinc-700"
                        />
                        <button type="button" data-testid="paste-button" @click="pasteRecipient" class="shrink-0 px-2 py-0.5 rounded-md text-[10.5px] font-medium text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer">{{ $t('privacy.transfer.paste') }}</button>
                    </div>
                    <p v-if="privateRecipient" data-testid="same-account" class="text-[11px] font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.sameAccount') }}</p>
                </div>

                <!-- Teslim ozeti: TEK dugme (tum satir teslim token secicisini acar; ag ve token tek yerde, K2). Tek acik ag olsa da etkilesimli kalir. Tahmini
                     tutar salt okunur; hesaplanirken yerini "Hesaplaniyor" alir. Hic teslim agi acik degilse dugme yerine not cikar ve teklif istenmez (sT20). -->
                <div v-if="hasDeliveryChain" class="shrink-0 mt-2 border-t border-slate-200 dark:border-white/10">
                    <button
                        ref="deliveryTrigger"
                        type="button"
                        aria-haspopup="dialog"
                        data-testid="delivery-chip"
                        @click="pickerOpen = true"
                        class="group w-full text-left flex items-center gap-2 px-1 pt-3 pb-2 cursor-pointer"
                    >
                        <span class="flex flex-col min-w-0 flex-1 leading-tight gap-0.5">
                            <span class="text-[11px] text-slate-500 dark:text-zinc-500">{{ $t('privacy.transfer.recipientReceives') }}</span>
                            <span class="flex items-baseline gap-1.5 min-w-0 text-sm">
                                <PrivateTokenLogo small class="self-center" :logo="outputLogoSrc" :badge="outputBadge" />
                                <span v-if="!calculating" class="flex items-baseline gap-1 min-w-0 font-semibold transition-colors duration-300" :class="estimateText === null ? 'text-slate-400 dark:text-zinc-600' : 'text-slate-900 dark:text-white'">
                                    <span data-testid="estimate" class="tabular-nums truncate min-w-0" :title="estimateText === null ? undefined : estimateText">{{ estimateLabel }}</span>
                                    <span class="shrink-0">{{ outputToken.symbol }}</span>
                                </span>
                                <span v-else data-testid="calc-pill" class="inline-flex items-baseline gap-1.5 shrink-0 font-medium text-slate-500 dark:text-zinc-400">
                                    <svg class="w-3.5 h-3.5 animate-spin self-center" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9" /></svg>
                                    <span>{{ $t('swap.calculating') }}</span>
                                </span>
                                <!-- Dar satirda once ag adi kisalir (truncate): tutar ve sembol yerinde kalir. -->
                                <span class="flex items-baseline gap-1 min-w-0 shrink-[4] text-xs text-slate-500 dark:text-zinc-400">
                                    <span class="shrink-0" aria-hidden="true">&middot;</span>
                                    <span class="truncate">{{ deliveryChainName }}</span>
                                </span>
                            </span>
                        </span>
                        <span class="shrink-0 inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 dark:text-zinc-400 group-hover:text-slate-700 dark:group-hover:text-zinc-200 transition-colors">
                            {{ $t('privacy.transfer.change') }}
                            <svg class="w-4 h-4 shrink-0 -rotate-90 text-slate-400 dark:text-zinc-500" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z" /></svg>
                        </span>
                    </button>
                </div>
                <p v-else data-testid="no-chain-open" class="shrink-0 w-full rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">{{ $t('privacy.transfer.noChainOpen') }}</p>
                <!-- "En az" satiri solda, "Odeyecegin" satiri (K10, X13) sagda: teklif varsa HER rotada cikar (dogrudan BSC USDC dahil). Yazilan tutar alicinin alacagidir,
                     SilentSwap ucreti ustune eklenir; gercek cikis (quote.amount, brut) burada gosterilir. -->
                <div v-if="hasDeliveryChain || payLineShown" class="shrink-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-1 -mt-1 min-h-4 text-[11px]">
                    <p v-if="hasDeliveryChain" data-testid="min-eta" class="text-slate-500 dark:text-zinc-500">{{ minEtaText }}</p>
                    <div v-if="payLineShown" data-testid="pay-line" class="ml-auto flex items-baseline justify-end gap-1.5">
                        <template v-if="payKnown">
                            <span class="text-slate-500 dark:text-zinc-500">{{ $t('privacy.review.youPay') }}</span>
                            <span class="font-bold tabular-nums text-slate-700 dark:text-zinc-200" :class="{ 'text-red-500 dark:text-red-400': payExceedsBalance }">{{ payLabel }}</span>
                        </template>
                        <template v-else>
                            <span class="font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.payUnknown') }}</span>
                        </template>
                    </div>
                </div>
            </template>

            <template v-else-if="mode === 'fund'">
                <div class="shrink-0 flex flex-col gap-1 mt-2">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-0.5 transition-colors duration-300">{{ $t('privacy.transfer.amountLabel') }}</span>
                        <span data-testid="private-badge" class="inline-flex items-center gap-1 text-[10.5px] font-medium text-slate-500 dark:text-zinc-500 transition-colors duration-300">
                            <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            {{ $t('privacy.transfer.privateBadge') }}
                        </span>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <!-- Gonder'deki gibi: kaynak USDC degilse tutarin yaninda "USDC" birimi (girdi icerigi kadar genisler, birim taban cizgisinde ve kucuk). -->
                        <div class="min-w-0 flex-1 flex items-baseline gap-1.5">
                            <input
                                v-model.trim="amount"
                                data-testid="amount-input"
                                type="text"
                                inputmode="decimal"
                                spellcheck="false"
                                placeholder="0"
                                class="min-w-0 h-11 font-bold text-left bg-transparent placeholder-slate-300 dark:placeholder-zinc-700 outline-none transition-colors duration-300"
                                :class="[fundAmountClass, showUnit ? 'field-sizing-content max-w-full' : 'w-full', amountRed ? 'text-red-500 dark:text-red-400' : 'text-slate-900 dark:text-white']"
                            />
                            <span v-if="showUnit" data-testid="amount-unit" aria-hidden="true" class="shrink-0 font-semibold text-slate-400 dark:text-zinc-500 transition-colors duration-300" :class="fundUnitClass">USDC</span>
                        </div>
                        <PrivateAssetChip
                            ref="sourceChipEl"
                            testid="source-chip"
                            :logo="sourceLogo"
                            :badge="sourceBadge"
                            :symbol="asset"
                            :network="chain ? chain.name : ''"
                            :interactive="sourceInteractive"
                            @click="sourcePickerOpen = true"
                        />
                    </div>
                    <span v-if="showUnit" data-testid="usdc-value-note" class="ml-0.5 text-[11px] leading-snug text-slate-500 dark:text-zinc-400">{{ $t('privacy.transfer.usdcEntryNote', { asset }) }}</span>
                    <!-- Sarma politikasi kartla ayni: bakiye hic kirilmaz (whitespace-nowrap), cipler tasarsa alt satira iner. -->
                    <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                        <span data-testid="balance" class="whitespace-nowrap" :class="{ 'text-red-500 dark:text-red-400': balanceRed || payExceedsBalance }">{{ $t('swap.balance') }}: {{ balanceLabel }}</span>
                        <span v-if="showPercentChips" class="flex items-center gap-1.5">
                            <button
                                v-for="p in PERCENT_CHIPS"
                                :key="p"
                                type="button"
                                :data-testid="p === 1 ? 'percent-max' : 'percent-' + p * 100"
                                class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold px-1 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                @click="setPercent(p)"
                            >{{ p === 1 ? 'MAX' : $t('common.percentChip', { value: p * 100 }) }}</button>
                        </span>
                    </div>
                    <p v-if="amountInvalid" data-testid="amount-error" class="text-[11px] font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.amountInvalid') }}</p>
                    <p v-else-if="belowMin" data-testid="amount-min" class="text-[11px] font-medium text-red-600 dark:text-red-400">{{ belowMinText }}</p>
                </div>

                <!-- Teslim ozeti: TEK dugme, tam genislik, ustunde ince cizgi, sagda belirgin ok (tum satir teslim token secicisini acar; ag ve token tek yerde, K2).
                     Tek akan cumle (etiket + tahmin + sembol + ag adi; dar satirda ikinci satira sarar, ag adi kesilmez); cumle kalibi dilin sozcuk sirasini tasir
                     (arrivesAs anahtari, {amount} yer tutucusu). Tahmini tutar salt okunur; hesaplanirken cumle yerine "Hesaplaniyor" cikar. Hic teslim agi acik degilse dugme yerine
                     not cikar ve teklif istenmez (sT20). -->
                <div v-if="hasDeliveryChain" class="shrink-0 mt-1 border-t border-slate-200 dark:border-white/10">
                    <button
                        ref="deliveryTrigger"
                        type="button"
                        aria-haspopup="dialog"
                        data-testid="delivery-chip"
                        @click="pickerOpen = true"
                        class="group w-full text-left flex items-center gap-2 pt-3 pb-2 cursor-pointer"
                    >
                        <PrivateTokenLogo :logo="outputLogoSrc" :badge="outputBadge" />
                        <span class="flex-1 min-w-0 leading-snug break-words">
                            <i18n-t v-if="!calculating" keypath="privacy.transfer.arrivesAs" tag="span" class="text-xs text-slate-500 dark:text-zinc-500">
                                <template #amount>
                                    <span class="text-sm font-semibold transition-colors duration-300" :class="estimateText === null ? 'text-slate-400 dark:text-zinc-600' : 'text-slate-900 dark:text-white'"><span data-testid="estimate" class="tabular-nums" :title="estimateText === null ? undefined : estimateText">{{ estimateLabel }}</span> <span>{{ outputToken.symbol }}</span></span>
                                </template>
                            </i18n-t>
                            <span v-else data-testid="calc-pill" class="inline-flex items-baseline gap-1.5 text-sm font-medium text-slate-500 dark:text-zinc-400">
                                <svg class="w-3.5 h-3.5 shrink-0 self-center animate-spin" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.25" /><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 3a9 9 0 0 1 9 9" /></svg>
                                <span>{{ $t('swap.calculating') }}</span>
                            </span>
                            <span class="text-xs text-slate-500 dark:text-zinc-400"><span aria-hidden="true">&nbsp;&middot;</span> <span class="whitespace-nowrap">{{ deliveryChainName }}</span></span>
                        </span>
                        <svg class="w-5 h-5 shrink-0 -rotate-90 text-slate-500 dark:text-zinc-400 group-hover:text-slate-700 dark:group-hover:text-zinc-200 transition-colors" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z" /></svg>
                    </button>
                </div>
                <p v-else data-testid="no-chain-open" class="shrink-0 w-full rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">{{ $t('privacy.transfer.noChainOpen') }}</p>
                <!-- "En az" satiri solda, "Odeyecegin" satiri (K10, X13) sagda: teklif varsa HER rotada cikar. Yazilan tutar alicinin alacagidir, SilentSwap ucreti
                     ustune eklenir; gercek cikis (quote.amount, brut) burada gosterilir. -->
                <div v-if="hasDeliveryChain || payLineShown" class="shrink-0 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-0.5 -mt-1 min-h-4 text-[11px]">
                    <p v-if="hasDeliveryChain" data-testid="min-eta" class="text-slate-500 dark:text-zinc-500">{{ minEtaText }}</p>
                    <div v-if="payLineShown" data-testid="pay-line" class="ml-auto flex items-baseline justify-end gap-1.5">
                        <template v-if="payKnown">
                            <span class="text-slate-500 dark:text-zinc-500">{{ $t('privacy.review.youPay') }}</span>
                            <span class="font-bold tabular-nums text-slate-700 dark:text-zinc-200" :class="{ 'text-red-500 dark:text-red-400': payExceedsBalance }">{{ payLabel }}</span>
                        </template>
                        <template v-else>
                            <span class="font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.payUnknown') }}</span>
                        </template>
                    </div>
                </div>
            </template>

            <div v-else class="relative w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-3 shadow-md dark:shadow-xl transition-colors duration-300">
                <div class="flex flex-col gap-2">
                    <div class="flex justify-between items-start gap-2">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 shrink-0 transition-colors duration-300">{{ $t('privacy.transfer.amountLabel') }}</span>
                        <!-- Sarma politikasi Takas ile ayni: bakiye hic kirilmaz (whitespace-nowrap), cipler tasarsa alt satira iner. -->
                        <div class="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                            <span data-testid="balance" class="whitespace-nowrap" :class="{ 'text-red-500 dark:text-red-400': balanceRed || payExceedsBalance }">{{ $t('swap.balance') }}: {{ balanceLabel }}</span>
                            <template v-if="showPercentChips">
                                <button
                                    v-for="p in PERCENT_CHIPS"
                                    :key="p"
                                    type="button"
                                    :data-testid="p === 1 ? 'percent-max' : 'percent-' + p * 100"
                                    class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold px-1 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    @click="setPercent(p)"
                                >{{ p === 1 ? 'MAX' : $t('common.percentChip', { value: p * 100 }) }}</button>
                            </template>
                        </div>
                    </div>
                    <div class="flex items-center justify-between gap-4">
                        <div class="flex flex-col items-start gap-1 shrink-0">
                            <PrivateAssetChip
                                ref="sourceChipEl"
                                testid="source-chip"
                                :logo="sourceLogo"
                                :badge="sourceBadge"
                                :symbol="asset"
                                :network="chain ? chain.name : ''"
                                :interactive="sourceInteractive"
                                @click="sourcePickerOpen = true"
                            />
                        </div>
                        <input
                            v-model.trim="amount"
                            data-testid="amount-input"
                            type="text"
                            inputmode="decimal"
                            spellcheck="false"
                            placeholder="0"
                            class="w-full min-w-0 text-3xl font-bold text-right bg-transparent placeholder-slate-300 dark:placeholder-zinc-700 outline-none transition-colors duration-300"
                            :class="amountRed ? 'text-red-500 dark:text-red-400' : 'text-slate-900 dark:text-white'"
                        />
                        <!-- Kaynak USDC degilse sagda hizali tutarin hemen arkasinda "USDC" birimi (satirin gap-4 bosluguna negatif kenar: tutara yapisik; pt: taban cizgisi). -->
                        <span v-if="showUnit" data-testid="amount-unit" aria-hidden="true" class="-ml-3 pt-2.5 shrink-0 text-base font-semibold text-slate-400 dark:text-zinc-500 transition-colors duration-300">USDC</span>
                    </div>
                    <span v-if="showUnit" data-testid="usdc-value-note" class="ml-1 text-[11px] leading-snug text-slate-500 dark:text-zinc-400">{{ $t('privacy.transfer.usdcEntryNote', { asset }) }}</span>
                    <p v-if="amountInvalid" data-testid="amount-error" class="text-[11px] font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.amountInvalid') }}</p>
                    <p v-else-if="belowMin" data-testid="amount-min" class="text-[11px] font-medium text-red-600 dark:text-red-400">{{ belowMinText }}</p>
                </div>
                <!-- Odeyecegin satiri (K10, X13): ust kutunun hemen altinda, kartin icinde. Teklif varsa HER rotada cikar (dogrudan BSC USDC dahil):
                     ust kutudaki tutar alicinin alacagi tutardir, SilentSwap ucreti ustune eklenir; gercek cikis (quote.amount, brut) burada gosterilir. -->
                <div v-if="payLineShown" data-testid="pay-line" class="mt-1 ml-1 flex items-center justify-between gap-3 text-[11px]">
                    <template v-if="payKnown">
                        <span class="text-slate-500 dark:text-zinc-500">{{ $t('privacy.review.youPay') }}</span>
                        <span class="font-bold tabular-nums text-slate-700 dark:text-zinc-200" :class="{ 'text-red-500 dark:text-red-400': payExceedsBalance }">{{ payLabel }}</span>
                    </template>
                    <template v-else>
                        <span class="font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.payUnknown') }}</span>
                    </template>
                </div>

                <!-- Rozet: Takas'in ters cevir dugmesinin yerinde ayrac cizgisi; ortadaki yalniz bilgi etiketidir (dugme degil, rolsuz). -->
                <div class="relative h-6 w-full my-1 flex items-center justify-center">
                    <div class="absolute inset-0 flex items-center">
                        <div class="w-full border-t border-slate-100 dark:border-white/5 transition-colors duration-300"></div>
                    </div>
                    <span data-testid="private-badge" class="relative pointer-events-none inline-flex items-center gap-1 rounded-xl bg-slate-50 dark:bg-[#18181b] border-2 border-white dark:border-[#131315] px-2.5 py-0.5 text-[10.5px] font-medium text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                        <svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                        {{ $t('privacy.transfer.privateBadge') }}
                    </span>
                </div>

                <!-- Alt kutu: teslim cipi (teslim agi + teslim varligi tek cipte, K2), tahmini teslim tutari (salt okunur) ve "En az" satiri.
                     Hic teslim agi acik degilse cip yerine not cikar ve teklif istenmez (sT20). -->
                <div class="flex flex-col gap-2">
                    <div class="flex justify-between items-start gap-2">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 shrink-0 transition-colors duration-300">{{ $t('privacy.transfer.toPrivate') }}</span>
                        <span v-if="privacy.active" class="font-mono text-xs text-slate-500 dark:text-zinc-400">{{ shortenAddress(privacy.privateAddress || '') }}</span>
                    </div>
                    <template v-if="hasDeliveryChain">
                        <div class="flex items-center justify-between gap-4">
                            <!-- Tek acik ag olsa da cip etkilesimli kalir (token secimi icin); secici yalniz cok aglida ag cipleri gosterir. -->
                            <PrivateAssetChip
                                ref="deliveryTrigger"
                                testid="delivery-chip"
                                :logo="outputLogoSrc"
                                :badge="outputBadge"
                                :symbol="outputToken.symbol"
                                :network="deliveryChainName"
                                :interactive="true"
                                @click="pickerOpen = true"
                            />
                            <div class="flex items-center justify-end h-9 flex-1 min-w-0">
                                <span
                                    v-if="!calculating"
                                    data-testid="estimate"
                                    class="w-full text-right font-bold text-slate-800 dark:text-zinc-200 truncate transition-colors duration-300"
                                    :class="estimateSizeClass"
                                    :title="estimateText === null ? undefined : estimateText"
                                >{{ estimateLabel }}</span>
                                <div v-else data-testid="calc-pill" class="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-zinc-800 rounded-lg transition-colors duration-300 shrink-0">
                                    <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400 animate-spin" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9" /></svg>
                                    <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('swap.calculating') }}</span>
                                </div>
                            </div>
                        </div>
                        <p data-testid="min-eta" class="min-h-4 text-right text-[11px] text-slate-500 dark:text-zinc-500">{{ minEtaText }}</p>
                    </template>
                    <p v-else data-testid="no-chain-open" class="w-full rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 text-xs font-medium text-amber-700 dark:text-amber-400">{{ $t('privacy.transfer.noChainOpen') }}</p>
                </div>
            </div>
            <!-- Kaynak (ag, varlik) cifti secicisi: seceneklerde bakiye YOK (sT13). -->
            <Teleport to="body">
                <Transition name="pi-sheet" :duration="{ enter: 380, leave: 240 }">
                    <PrivateAssetPicker v-if="sourcePickerOpen" :options="sourcePairOptions" :selected-key="sourceKeyPair" @select="onPickSourcePair" @close="closeSourcePicker" />
                </Transition>
            </Teleport>

            <!-- Kartin altinda SIRA: (1) amber alici notu ve (yalniz Takas) ayni-varlik notu (secimden hesaplanir, teklife bagli DEGIL), (2) SecurityWarning, (3) asagidaki hata/uyari ve
                 ucret bloklari. -->
            <p v-if="recipientCheck" data-testid="recipient-note" class="text-[11px] font-medium text-amber-600 dark:text-amber-400">{{ $t('privacy.review.recipientCheck', { chain: deliveryChainName }) }}</p>
            <p v-if="sameAsSource" data-testid="same-asset-note" class="text-[11px] font-medium text-amber-600 dark:text-amber-400">{{ $t('privacy.transfer.sameAssetNote') }}</p>
            <SecurityWarning
                v-if="mode === 'send'"
                :checking="securityChecking"
                :reputation="reputation"
                :poison-match="poisonMatch"
                :poison-parts="poisonParts"
                :poison-source-key="poisonSourceKey"
                v-model:poison-ack="poisonAcknowledged"
                v-model:reputation-ack="reputationAcknowledged"
            />

            <!-- Teslim token secici: teslim cipinden acilir (tum modlarda), alttan acilan panel; ag kapsam cipleri icin acik teslim aglari (chains) verilir.
                 Panel body'ye tasinir: ekran kokleri transform/backdrop tasiyabilir (PrivacyToggle ile ayni gerekce).
                 pi-sheet gecisinin CSS'i PrivacyIntro.vue'da (scoped DEGIL, .pi-backdrop/.pi-panel'i hedefler); panel bu
                 siniflari tasir. -->
            <Teleport v-if="hasDeliveryChain" to="body">
                <Transition name="pi-sheet" :duration="{ enter: 380, leave: 240 }">
                    <PrivateDeliveryTokenPicker v-if="pickerOpen" :chain-id="outputToken.chainId" :chains="deliveryChains" :mode="mode" :native-enabled="PRIVATE_DEST_NATIVE" :selected="outputToken" @select="onPickToken" @close="closePicker" />
                </Transition>
            </Teleport>
            <!-- Sure doldu (K9): sayilar yerinde kalir, onay kapali; "Teklifi yenile" ayni girdilerle yeni teklif ister. On yenileme (refreshing)
                 sirasinda ekran ziplamaz: yalniz kucuk bir bilgi satiri cikar, onay acik kalir. -->
            <div v-if="phase === 'expired'" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <span data-testid="quote-expired">{{ $t('privacy.transfer.expired') }}</span>
                <button type="button" data-testid="quote-refresh" @click="retryQuote" class="font-bold underline cursor-pointer">{{ $t('privacy.transfer.quoteRefresh') }}</button>
            </div>
            <p v-else-if="refreshing" data-testid="quote-refreshing" class="text-[11px] text-slate-500 dark:text-zinc-500">{{ $t('privacy.transfer.quoteRefreshing') }}</p>
            <!-- TEK hata satiri (X4): metin quote-error, yalniz faz error iken "Tekrar dene" (quote-retry). SilentSwap kapaliyken (X21) ekran susmaz,
                 PRIVATE_PROVIDER_DOWN metni burada gorunur. Hiz siniri beklemesinde (rateWait) hata yerine bilgi satiri cikar. -->
            <div v-if="shownError && phase !== 'rateWait'" ref="errorEl" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-red-600 dark:text-red-400">
                <span data-testid="quote-error">{{ shownError }}</span>
                <button v-if="phase === 'error'" type="button" data-testid="quote-retry" @click="retryQuote" class="font-bold underline cursor-pointer">{{ $t('privacy.orders.retry') }}</button>
            </div>
            <p v-if="phase === 'rateWait'" data-testid="quote-rate-wait" class="text-xs font-medium text-slate-500 dark:text-zinc-400">{{ $t('privacy.transfer.quoteRateWait') }}</p>
            <!-- Ucretler karti (K6): her durumda cizilir (teklif yokken tahmin / tire). Ag ucreti HER ZAMAN ATS (K7); satir ATS durumunu atsState'ten alir. -->
            <PrivateFeeCard
                :mode="mode"
                :quote="quote"
                :dest-is-usdc="quoteDestIsUsdc"
                :fee-bps="providerInfo?.feeBps ?? null"
                :payout-text="amountValid ? normalizedAmount : ''"
                :min-usdc="effectiveMin"
                :below-min="belowMin"
                :quote-loading="calculating"
                :ats="feeAts"
            >
                <!-- ATS durumlari (K8, spec 7.3), ag ucreti satirinin hemen altinda. Hicbir durum dugme ACMAZ; onay dugmesi atsBlocked'a bagli. -->
                <template #ats-extra>
                    <!-- Yetersiz: kirmizi kutu. Gonder, Takas ve Kopru'de (odeyen Gizli Hesap) baglanti uyarisi + ATS Al (bayrak kapaliysa bilesen blocked satirini kendisi cizer);
                         Para yukle'de Gizli Hesap'a ATS aldiran HICBIR dugme/baglanti yok (sT10, PD9): her zaman blocked satiri, PRIVATE_ATS_SALE acik olsa da. -->
                    <div v-if="atsState === 'short'" data-testid="ats-short-box" class="flex flex-col gap-1.5 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-2">
                        <p class="text-[11px] font-bold leading-snug text-red-600 dark:text-red-400">{{ $t('privacy.transfer.atsShort', { balance: fmt(atsBalance) }) }}</p>
                        <div v-if="mode !== 'fund'" class="flex flex-col gap-1">
                            <PrivateAtsLinkWarning v-if="atsLinkWarn" />
                            <AtsBuyButton />
                        </div>
                        <p v-else class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t('privacy.atsSale.blocked') }}</p>
                    </div>
                    <!-- Kurulum gerekli (run-onboarding). Gonder, Takas ve Kopru'de odeyen Gizli Hesap'tir ve kapi ATS_RUN_ONBOARDING'i Gizli Hesap imzaciyla
                         gizli modda gecirir: kurulum DUGMESI burada (gizli modda Takas'in ATS karti hic cizilmez, oraya yonlendirmek kullaniciyi cikmaza sokar).
                         Para yukle'de odeyen NORMAL hesaptir ve kapi onu gizli modda PRIVATE_SIGNER_MUST_BE_PRIVATE ile reddeder: dugme YOK, yalniz "gizli moddan cikip tamamla" notu.
                         Calisirken (setupBusy) ucret yuvasi loading olur ve atsSetupNeeded kapanir: blok setupBusy ile acik kalir. -->
                    <div v-if="atsSetupNeeded || setupBusy" class="flex flex-col gap-1.5">
                        <p data-testid="ats-setup-note" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(mode !== 'fund' ? 'privacy.transfer.atsSetupSend' : 'privacy.transfer.atsSetupFund') }}</p>
                        <template v-if="mode !== 'fund'">
                            <button type="button" data-testid="ats-setup-run" :disabled="setupBusy" @click="runAtsSetup" class="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default">{{ setupBusy ? $t('send.confirmTransaction.atsOnboardingRunning') : (setupFailed ? $t('privacy.orders.retry') : $t('send.confirmTransaction.atsOnboardingRun')) }}</button>
                            <p v-if="setupFailed && !setupBusy" data-testid="ats-setup-error" class="text-[11px] font-medium text-red-600 dark:text-red-400">{{ $t('privacy.transfer.atsSetupFailed') }}</p>
                        </template>
                    </div>
                    <!-- Operator / gecici karar: karar metni satirda; varsa aciklamasi burada, dugme kapali. -->
                    <p v-else-if="atsState === 'blocked' && atsDecision && atsDecision.i18nDescKey" data-testid="ats-decision-desc" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(atsDecision.i18nDescKey) }}</p>
                    <!-- Ucret alinamadi: kirmizi kart. "Tekrar dene" YALNIZ ATS ucretini yeniler (SilentSwap teklifini yeniden istemez). Agir rota
                         (PRIVATE_UNSUPPORTED) yeniden denemekle degismez: kendi metni, baglanti yok (X20). -->
                    <div v-if="atsState === 'error'" data-testid="ats-error-box" class="flex flex-col gap-1 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 p-2">
                        <template v-if="atsUnsupported">
                            <p class="text-[11px] font-bold leading-snug text-red-600 dark:text-red-400">{{ errorText('PRIVATE_UNSUPPORTED') }}</p>
                        </template>
                        <template v-else>
                            <p class="text-[11px] font-bold leading-snug text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.atsQuoteFailedTitle') }}</p>
                            <p class="text-[10px] leading-tight text-red-500 dark:text-red-300/80">{{ $t('send.confirmTransaction.atsQuoteFailedDesc') }}</p>
                            <button type="button" data-testid="ats-retry" @click="refreshAtsFee" class="self-start text-[11px] font-bold underline text-red-600 dark:text-red-400 cursor-pointer">{{ $t('privacy.orders.retry') }}</button>
                        </template>
                    </div>
                </template>
            </PrivateFeeCard>
        </div>

        <div class="px-4 pb-4 relative z-10">
            <!-- Alt dugme TEK: teklif otomatik gelir (zamanlayici); teklif yok / faz ready degil / odeme bilinmiyor ise kapali. -->
            <button @click="confirm" data-testid="confirm-button" :disabled="busy || !quote || phase !== 'ready' || atsBlocked || !payKnown || payExceedsBalance || (mode === 'send' && securityBlocked)" class="w-full py-3.5 rounded-xl font-bold text-sm bg-violet-600 hover:bg-violet-500 text-white transition-all cursor-pointer disabled:opacity-60">{{ busy ? $t('privacy.transfer.sending') : (mode === 'fund' ? $t('privacy.transfer.fundConfirm') : $t('privacy.transfer.confirm')) }}</button>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { isAddress } from 'ethers'
import Back from '../Back.vue'
import SecurityWarning from '../SecurityWarning.vue'
import PrivateFeeCard from './PrivateFeeCard.vue'
import PrivateAtsLinkWarning from './PrivateAtsLinkWarning.vue'
import AtsBuyButton from '../AtsBuyButton.vue'
import PrivateInfoSheet from './PrivateInfoSheet.vue'
import PrivateOptionSheet from './PrivateOptionSheet.vue'
import PrivateAssetChip from './PrivateAssetChip.vue'
import PrivateTokenLogo from './PrivateTokenLogo.vue'
import PrivateAssetPicker from './PrivateAssetPicker.vue'
import PrivateDeliveryTokenPicker from './PrivateDeliveryTokenPicker.vue'
import { usdcTokenOf, defaultDeliveryToken, isUsdcDeliveryToken } from '../../utils/privacy/deliveryTokens'
import { BSC_DELIVERY_CHAIN_ID, deliveryChainOf } from '../../utils/privacy/deliveryChains'
import { openDeliveryChains, defaultDeliveryChain } from '../../utils/privacy/deliveryChainSetting'
import { selfSourceChains, selfSwapTargets, selfDeliveryTokenOf, defaultSelfSource } from '../../utils/privacy/selfRoutes'
import { privateTokenLogo, privateChainBadge, hasPrivateLogo } from '../../utils/privacy/privateTokenLogo'
import { identiconUri } from '../../utils/localAvatar'
import { pageStore } from '../../store/pageStore'
import { privacyStore } from '../../store/privacy'
import { configStore } from '../../store/config'
import { LISTED_CHAINS } from '../../data/chains'
import { accountSupportsChain, accountShowsEvmRow } from '../../utils/accountKind'
import { flattenVaultAccounts } from '../../utils/knownRecipients'
import { isPrivateAccount } from '../../utils/privacy/privateAccount'
import { recordSentRecipient } from '../../utils/sentRecipients'
import { shortenAddress } from '../../utils/shortenAddress'
import { useAddressSecurity } from '../../composables/useAddressSecurity'
import { privateAssetsFor, privateFundDeliverable, PRIVATE_DEST_NATIVE, MIN_PAYOUT_USDC } from '../../utils/privacy/silentswapConfig'
import { payAmountLabel, formatRawAmount, trimAmount } from '../../utils/privacy/displayAmount'
import { useAtsOpFee } from '../../composables/useAtsOpFee'
import { privateAtsLinkWarningVisible } from '../../utils/privacy/privateAtsLinkWarning'
import { privacyErrorKey } from '../../utils/privacy/privacyErrors'
import { QUOTE_MIN_REMAINING_MS, CANONICAL_AMOUNT_RE } from '../../utils/privacy/privateConstants'
import { sourcePairs, pairKey, sourceAssetAddress } from '../../utils/privacy/sourceAssets'
import { PERCENT_CHIPS, percentChipAmount, exceedsBalanceWithFee, balanceFeeBps, etaMinutes, amountAtLeast, effectiveMinUsdc } from '../../utils/privacy/feeBreakdown'
import { createQuoteScheduler } from '../../utils/privacy/quoteScheduler'
import { usePrivateSourceBalance } from '../../composables/usePrivateSourceBalance'

// Gizli aktarma (fund: normal hesap -> Gizli Hesap), gizli gonderme (send: Gizli Hesap -> adres), kendine Takas (swap) ve Kopru (bridge)
// (Gizli Hesap -> kendi Gizli Hesabi, SilentSwap). Spec 4.2 akis 2 ve 3; spec 2026-11-02. Teklif ARKA PLANDA tutulur; burada yalniz ozet ve ticket var.
const props = defineProps({ mode: { type: String, default: 'fund' } })
const { t } = useI18n()
const page = pageStore()
const privacy = privacyStore()
const config = configStore()
// Baslik: dort kip icin dort TAM literal anahtar (sablonla kurulan anahtar locales kilitlerinde gorunmez).
const pageTitle = computed(() => ({
    fund: t('privacy.transfer.fundTitle'),
    send: t('privacy.transfer.sendTitle'),
    swap: t('privacy.transfer.swapTitle'),
    bridge: t('privacy.transfer.bridgeTitle'),
})[props.mode])

const FAILED_KEY = 'privacy.errors.PRIVATE_FAILED'
// Tutar: ondalik ayraci "," da kabul edilir ("." ye cevrilir); kanonik bicim arka planla ortaktir (CANONICAL_AMOUNT_RE).
// Bu ekranin rotasi: onay cevabi geldiginde kullanici hala burada degilse baska ekrana ZORLA gidilmez.
const MY_ROUTE_FOR = { fund: 'private_fund', send: 'private_send', swap: 'private_swap', bridge: 'private_bridge' }
// Belirsiz sonuc ya da zaten gonderilmis: kullanici Gizli islemlere yonlendirilir.
const GO_TO_ORDERS_CODES = new Set(['PRIVATE_ORDER_IN_PROGRESS', 'PRIVATE_DEPOSIT_UNCONFIRMED'])
const UNCONFIRMED_NOTICE_KEY = 'privacy.orders.unconfirmedNotice'
// Hata metni: PRIVATE_MIN_AMOUNT {min} yer tutucusunu tasir (arka plan `limitUsdc` verdiyse o, yoksa yerlesik en az tutar);
// PRIVATE_MAX_AMOUNT `limitUsdc` ile "En cok tutar {max} USDC." der, yoksa mevcut genel metin; digerleri fazla parametreyi yok sayar.
// `limitUsdc` yanittan gelen serbest degerdir (C1 inceleme karari): yalniz kanonik ondalik dizge (CANONICAL_AMOUNT_RE) ekrana girer,
// aksi halde yok sayilir ve mevcut genel metne dusulur.
const errorText = (code, limitRaw = null) => {
    const limit = typeof limitRaw === 'string' && CANONICAL_AMOUNT_RE.test(limitRaw) ? limitRaw : null
    if (code === 'PRIVATE_MAX_AMOUNT' && limit) return t('privacy.errors.PRIVATE_MAX_AMOUNT_LIMIT', { max: limit })
    return t(privacyErrorKey(code, FAILED_KEY), { min: code === 'PRIVATE_MIN_AMOUNT' && limit ? limit : MIN_PAYOUT_USDC })
}

const publicAccounts = ref([])
const sourceKey = ref(null)
const recipient = ref('')
// KAYNAK CIFTI (Takas/Kopru). Token sayfasindan gelen bir kerelik on secim (pageStore.privateSwapSource) SETUP'ta okunur ve HER ZAMAN
// null'a cekilir; onMounted'ta DEGIL: SSR onMounted calistirmaz ve ilk cizim (ile setup'taki tek fitDeliveryToSource cagrisi) dogru
// kaynakla acilmali. On secim yalniz modun KENDI kaynak listesinde gecerliyse kullanilir (Takas: selfSourceChains('swap') ciftleri,
// Kopru: tum kaynak ciftleri); bayat ya da gecersiz deger sessizce defaultSelfSource(mode)'a duser. fund/send ne okur ne temizler.
// chainId/asset ref'lerinden ONCE calisir: computed okumaz (TDZ), yalniz page, props ve ice aktarilan saf fonksiyonlari kullanir.
function takeSelfSource() {
    const fallback = defaultSelfSource(props.mode)
    if (props.mode !== 'swap' && props.mode !== 'bridge') return fallback
    const pre = page.privateSwapSource
    page.privateSwapSource = null
    if (!pre) return fallback
    const pair = sourcePairs(selfSourceChains(props.mode, LISTED_CHAINS)).find((p) => p.key === pairKey(pre.chainId, pre.asset))
    return pair ? { chainId: pair.chainId, asset: pair.asset } : fallback
}
// Baslangic kaynak cifti: gecerli Token on secimi, yoksa defaultSelfSource (Takas'ta ilk Takas cifti (Ethereum USDC), digerlerinde BSC USDC).
const startPair = takeSelfSource()
const chainId = ref(startPair.chainId)
const asset = ref(startPair.asset)
const amount = ref('')
// Teslim agi (spec 4.8 P7): DEGER outputToken.chainId'dir (ayri bir ref yok: ag ve token ayrisamaz). Her acilista varsayilan ag
// defaultDeliveryChain(mode) (BSC aciksa BSC) ve onun varsayilan varligidir; son secim saklanmaz. Hic ag acik degilse ekran
// islevsiz bir BSC USDC ile kurulur ama "Teklif al" kapali kalir ve alan yerine not cikar.
// Alici Gizli Hesap olunca (Para yukle, Takas, Kopru) teslim FUND listesindendir; arka plan ayni listeyi deliveryScreenOf ile turetir (cikti adresi
// Gizli Hesap ise ekran 'fund'). Takas: yalniz kaynak ag; Kopru: kaynaktan farkli acik aglar. chain.value DEGIL: o bir LISTED_CHAINS kaydidir, tablo satiri degil.
const deliveryChains = computed(() => {
    if (props.mode === 'swap') return openDeliveryChains('fund').filter((c) => c.chainId === Number(chainId.value))
    if (props.mode === 'bridge') return openDeliveryChains('fund').filter((c) => c.chainId !== Number(chainId.value))
    return openDeliveryChains(props.mode)
})
const hasDeliveryChain = computed(() => deliveryChains.value.length > 0)
// Bir agin varsayilan teslim tokeni. Gizli Hesap'a teslimde (Para yukle, Takas, Kopru) teslim degismezi (1.10, sahip karari 2026-10-30: ag ucreti ATS, yerel coin gaz istisnasi yok)
// yalniz Gonder kaynagi varliklarini teslim eder: varsayilan yerel coin bu kumede degilse (POL, xDAI, CELO, MNT, CRO) o agin USDC'sine doner. Gonder'de (alici dis adres) suzme yok.
function defaultTokenOn(id) {
    const next = defaultDeliveryToken(Number(id), PRIVATE_DEST_NATIVE)
    return props.mode !== 'send' && next && !privateFundDeliverable(next) ? usdcTokenOf(Number(id)) : next
}
function initialDeliveryToken() {
    const id = defaultDeliveryChain(props.mode)
    return (id === null ? null : defaultTokenOn(id)) ?? usdcTokenOf(BSC_DELIVERY_CHAIN_ID)
}
// Alicinin alacagi token (DeliveryToken: chainId dahil); secici { chainId, address, symbol, decimals } yayar.
// Takas/Kopru'de bu ilk deger yer tutucudur (BSC USDC): kurulum sonunda fitDeliveryToSource() kaynaga gore gercek varsayilani yazar. initialDeliveryToken degismez.
const outputToken = ref(initialDeliveryToken())
// Teslim cipinin logosu ve ag rozeti TEK cozucudan (privateTokenLogo): paketli dosya, ag istegi ve uzak adres yok. Yerel coin COININ logosudur
// (Base'te ETH = ETH elmasi, Base logosu degil); secici satirinin logosu ayrica tasinmaz, ayni cozucu ayni cevabi verir.
const outputLogoSrc = computed(() => privateTokenLogo({ chainId: outputToken.value.chainId, address: outputToken.value.address, symbol: outputToken.value.symbol }))
const outputBadge = computed(() => privateChainBadge(outputToken.value.chainId))
const pickerOpen = ref(false)
// Sablon referanslari: teslim cipi (kapaninca odak buraya doner; logo yedegi cipin kendisindedir) ve hata satiri (gorunur alana getirilir).
const deliveryTrigger = ref(null)
const errorEl = ref(null)
// Ag ucreti HER ZAMAN ATS (K7, sT15): ekranda gaz secimi ve sessiz native yedek yoktur; arka plan PRIVATE_ORDER_ATS ve zinciri YENIDEN denetler.
const quote = ref(null)
// Kabul edilen teklifin istek anahtari (requestInputs()): confirm() canli girdi bununla ayniysa gonderir.
const quoteKey = ref('')
// Teklif aninda DONDURULMUS kaynak zincir/varlik: kart ve "odeyecegin" karari canli formdan degil buradan.
const quoteSourceChainId = ref(null)
const quoteSourceAsset = ref(null)
// Teklif aninda DONDURULMUS: teslim tokeni o agin TABLO USDC si mi (Ucretler karti pay hesabinin yolunu bundan secer; sunucu sembolu yetmez).
const quoteDestIsUsdc = ref(false)
const error = ref('')
const busy = ref(false)
const nowMs = ref(Date.now())
// Duz degisken (ref degil): yalniz onUnmounted'ta okunur.
let expiryTimer = null
// Otomatik teklif zamanlayicisinin TEK anlik goruntusu (X1): onChange her degisimde buraya yazar; faz ve on yenileme bundan turetilir,
// sablon scheduler.snapshot() CAGIRMAZ. Soguma (2 sn), butce (12 / 60 sn) ve yeniden deneme kurallari zamanlayicidadir.
const schedState = ref({ phase: 'idle', seq: 0, errorCode: null, autoRefreshes: 0, endMs: null, refreshing: false })
const phase = computed(() => schedState.value.phase)
const refreshing = computed(() => schedState.value.refreshing)
// SilentSwap durum ozeti (PRIVATE_PROVIDER_INFO, sT7): { feeBps, minUsdc, maxUsdc, available } ya da null. Yanit yoksa/bozuksa null kalir ve
// ekrani ENGELLEMEZ (yerlesik en az tutar gecerli, saglayici musait sayilir).
const providerInfo = ref(null)

// Fund, Takas ve Kopru modunda `recipient` BOS kalir: Gizli Hesap adresi itibar/gecmis mantigina girmez.
const {
    checking: securityChecking, reputation, poisonMatch, poisonParts, poisonSourceKey,
    poisonAcknowledged, reputationAcknowledged, blocked: securityBlocked, privateRecipient, loadTrusted,
} = useAddressSecurity(recipient, computed(() => config.api), { privateAddress: computed(() => privacy.privateAddress) })

const sourceAccount = computed(() => publicAccounts.value.find((a) => a.key === sourceKey.value) || null)

// Takas'ta yalniz en az iki Gonder kaynagi varligi olan aglar (selfRoutes); Kopru ve diger modlarda tum Gonder kaynak aglari.
const sourceChains = computed(() => {
    const all = selfSourceChains(props.mode, LISTED_CHAINS)
    return props.mode === 'fund' && sourceAccount.value
        ? all.filter((c) => accountSupportsChain(sourceAccount.value, c))
        : all
})
const chain = computed(() => sourceChains.value.find((c) => Number(c.chainId) === Number(chainId.value)) || null)
const assets = computed(() => (chain.value ? privateAssetsFor(chain.value) : []))

// Kimden panelinin ve Teslim agi alaninin satirlari. Hesap ikonu cuzdanin her yerinde kullanilan yerel kimlik ikonudur (uzak istek yok).
const accountOptions = computed(() => publicAccounts.value.map((a) => ({
    value: a.key, title: a.name, subtitle: shortenAddress(a.address), subtitleMono: true, logo: identiconUri(a.address),
})))
// Kaynak (zincir, varlik) ciftleri: ust kutudaki cip ve birlesik secici AYNI listeyi okur (sade ekran K1, K2). Logo ve rozet yerel yollar.
// Logosuz cift secicide ve cipte gosterilmez (hasPrivateLogo, bugun hicbir kaynak cift elenmez: kilit privateTokenLogo.guard.test.js).
const sourcePairList = computed(() => sourcePairs(sourceChains.value).filter((p) => hasPrivateLogo({ chainId: p.chainId, symbol: p.asset })))
const sourcePairOptions = computed(() => sourcePairList.value.map((p) => ({ ...p, logo: privateTokenLogo({ chainId: p.chainId, symbol: p.asset }), badge: privateChainBadge(p.chainId) })))
// Ust cipin (secili kaynak cifti) logosu ve rozeti: secici satirlariyla ayni cozucu.
const sourceLogo = computed(() => privateTokenLogo({ chainId: chainId.value, symbol: asset.value }))
const sourceBadge = computed(() => privateChainBadge(chainId.value))
const sourceKeyPair = computed(() => pairKey(chainId.value, asset.value))
// Tek cift varsa cip etkilesimsiz (sT20).
const sourceInteractive = computed(() => sourcePairList.value.length > 1)
// Kimden hapi: hesap sayisi > 1 ise etkilesimli (sT9).
const fromInteractive = computed(() => publicAccounts.value.length > 1)
const fromIdenticon = computed(() => identiconUri(sourceAccount.value?.address || ''))
// Baska agdaki alici notu (P6): Gonder modu ve SECILI teslim agi BSC degilken "alicinin bu agda ayni adresi kullandigindan emin ol" der.
// Teklife bagli degil: secimden (outputToken) hesaplanir, teklif gelmeden de gorunur.
const recipientCheck = computed(() => props.mode === 'send' && outputToken.value.chainId !== BSC_DELIVERY_CHAIN_ID)

// "Yapistir" (K1): panodaki adresi KIRPILMIS yazar (Send.vue handlePaste deseni). Pano okunamayabilir (uzantinin clipboardRead izni yok,
// Chrome yalniz odaklanmis uzanti sayfasina verir): reddedilirse ya da pano yoksa sessiz kalinmaz, hata satirina pasteFailed yazilir.
// Bos pano alani degistirmez. Basarili yapistirma recipient izleyicisiyle eski teklifi ve hatayi zaten dusurur.
async function pasteRecipient() {
    error.value = ''
    try {
        const text = (await navigator.clipboard.readText()).trim()
        if (text) recipient.value = text
    } catch {
        error.value = t('send.pasteFailed')
    }
}

// Teslim agi: DEGER outputToken.chainId (ayri alan yok); teslim cipi ve "?" sayfasi ondan okur. Ag degisince token O AGIN varsayilan
// varligina doner (P1: BSC'de USDC, oteki aglarda yerel coin; yerel teslim kapaliyken her yerde USDC) ve eski
// teklif outputToken izleyicisiyle (ve confirm()'in istek anahtari denetimiyle) duser. Mevcut ag yeniden secilirse hicbir sey
// degismez (kullanicinin token secimi korunur). Ekranda ag secimi yoktur: cipin degeri ancak token secilince (onPickToken) degisir.
const deliveryChainId = computed({
    get: () => outputToken.value.chainId,
    set: (id) => {
        const next = defaultTokenOn(id)
        if (!next || next.chainId === outputToken.value.chainId) return
        outputToken.value = next
    },
})

// Takas/Kopru'de teslim tokeni kaynaga BAGLIDIR (spec: Takas ayni agda baska varlik, Kopru baska agda). Tek mekanizma
// fitDeliveryToSource(): kurulumda bir kez ve onPickSourcePair'in gecerli-cift dalinin SON ifadesi olarak cagrilir; izleyici YOK
// (SSR'da izleyiciler calismaz). Gecerli kullanici secimini korur. quoteEligible ayni kurallari bagimsiz sinar (fail-closed).
const isSelfMode = computed(() => props.mode === 'swap' || props.mode === 'bridge')
// Secili teslim agi acik teslim aglari satirlarinda mi (Takas: yalniz kaynak ag, Kopru: kaynaktan baska acik aglar).
const routeOk = computed(() => deliveryChains.value.some((c) => Number(c.chainId) === Number(outputToken.value.chainId)))
// Ayni varlik yalniz Takas'ta engellenir; kimlik (zincir, adres): sembol kimlik DEGILDIR (ayni sozlesme baska sembolle gelebilir, ayni
// sembol baska sozlesme olabilir). Yerel coin sifir adrestir. Kayitta olmayan varlik (null) ayni sayilmaz.
const sameAsSource = computed(() => {
    if (props.mode !== 'swap') return false
    const src = sourceAssetAddress(chainId.value, asset.value)
    return src !== null
        && Number(outputToken.value.chainId) === Number(chainId.value)
        && String(outputToken.value.address).toLowerCase() === src.toLowerCase()
})
// Gecersiz teslimi (ag disi, teslim edilemez, Takas'ta kaynakla ayni) mod varsayilanina ceker; aday yoksa HICBIR sey degistirmez.
function fitDeliveryToSource() {
    if (!isSelfMode.value) return
    if (routeOk.value && privateFundDeliverable(outputToken.value) && !sameAsSource.value) return
    let candidate = null
    if (props.mode === 'swap') {
        const symbol = selfSwapTargets(Number(chainId.value), asset.value)[0]
        candidate = symbol === undefined ? null : selfDeliveryTokenOf(Number(chainId.value), symbol)
    } else {
        const row = deliveryChains.value[0]
        candidate = row ? defaultTokenOn(row.chainId) : null
    }
    if (!candidate) return
    outputToken.value = candidate
}
fitDeliveryToSource()
const deliveryChainName = computed(() => deliveryChainOf(outputToken.value.chainId)?.name ?? '')

// Tahmini teslim tutari ve "En az" satiri: teklifin dest ozetinden (ham tutar -> ondalikli dizge -> kirpilmis metin). Bozuk ham tutar
// "~" ile yarim yazilmaz (null: ekran "\u2014" gosterir). Teklif yokken estimate "\u2014", min-eta bos.
const quoteAmountText = (raw) => {
    const d = quote.value?.dest
    const human = d ? formatRawAmount(raw, d.decimals) : null
    if (human === null) return null
    const text = trimAmount(human).text
    return text === '' ? null : text
}
const estimateText = computed(() => quoteAmountText(quote.value?.dest?.expectedDestAmount))
// Ekranda gorunen tahmin: tutar yoksa tire, "<" ile baslayan (cok kucuk) tutar "~" almaz. Kart ve Gonder teslim satiri ayni metni okur.
const estimateLabel = computed(() => (estimateText.value === null ? '\u2014' : (estimateText.value.startsWith('<') ? '' : '~') + estimateText.value))
// 360 px popup'ta estimate alani ~105 px kalir (cip ag adiyla ~158 px): "~" haric 5 karakter text-3xl'e sigar,
// 6-8 karakter text-xl, daha uzunu text-base; yine sigmazsa truncate keser, tam deger title'da.
const estimateSizeClass = computed(() => {
    const n = estimateText.value === null ? 0 : estimateText.value.length
    if (n > 8) return 'text-base mt-1.5'
    if (n > 5) return 'text-xl mt-1.5'
    return 'text-3xl'
})
// Boyut kademeleri: [en cok karakter, tutar sinifi, birim sinifi]. Birimsiz (USDC kaynak) kademeler eski degerlerdir; birimli kademeler "USDC" genisligini (~2.84 em)
// ve bosluklari dusunerek olculdu (en genis rakam Inter kalin '0' ~0.675 em).
const HERO_TIERS = [[9, 'text-5xl'], [12, 'text-4xl'], [15, 'text-3xl'], [20, 'text-2xl'], [Infinity, 'text-xl']]
const HERO_UNIT_TIERS = [[7, 'text-5xl', 'text-2xl'], [10, 'text-4xl', 'text-xl'], [13, 'text-3xl', 'text-lg'], [16, 'text-2xl', 'text-base'], [Infinity, 'text-xl', 'text-sm']]
const FUND_TIERS = [[6, 'text-4xl'], [7, 'text-3xl'], [9, 'text-2xl'], [11, 'text-xl'], [12, 'text-lg'], [14, 'text-base'], [16, 'text-sm'], [Infinity, 'text-xs']]
const FUND_UNIT_TIERS = [[4, 'text-4xl', 'text-lg'], [5, 'text-3xl', 'text-base'], [7, 'text-2xl', 'text-sm'], [9, 'text-xl', 'text-sm'], [10, 'text-lg', 'text-xs'], [12, 'text-base', 'text-xs'], [13, 'text-sm', 'text-xs'], [Infinity, 'text-xs', 'text-xs']]
const tierOf = (tiers, n) => tiers.find(([max]) => n <= max)
// Gonder'in dev tutar girdisi (360 px'te ~328 px kullanilabilir): metin uzadikca yazi kuculur ki tutar kaymadan gorunsun. Esikler olculdu: en genis
// basamak (Inter kalin '0') ~0.675 em; 328 px'e 48 px'te 9, 36 px'te 12, 30 px'te 15, 24 px'te 20 karakter sigar, 20 px kalani tasir. En uzun tutar
// (18 ondalik) ~22 karakterdir; daha uzunu girdinin icinde kayar. Girdi yuksekligi sabit (h-14): boyut degisince alttaki satirlar ziplamaz.
const heroTier = computed(() => tierOf(showUnit.value ? HERO_UNIT_TIERS : HERO_TIERS, amount.value.length))
const heroAmountClass = computed(() => heroTier.value[1])
const heroUnitClass = computed(() => heroTier.value[2])
// Para yukle'nin sola dayali tutar girdisi: sagdaki kaynak cipi (en genis ag adiyla ~165 px) yuzunden girdiye ~153 px kalir; metin uzadikca yazi kuculur.
// Esikler olculdu: en genis basamak (Inter kalin '0') yazi boyunun ~0.675 kati; 153 px'e 36 px'te 6, 30 px'te 7, 24 px'te 9, 20 px'te 11, 18 px'te 12,
// 16 px'te 14, 14 px'te 16, 12 px'te 18 karakter sigar; daha uzunu girdinin icinde kayar (yuzde cipi en cok 6 ondalik yazar, gercek tutarlar ~13 karakteri gecmez).
// Girdi yuksekligi sabit (h-11): boyut degisince alttaki satirlar ziplamaz.
const fundTier = computed(() => tierOf(showUnit.value ? FUND_UNIT_TIERS : FUND_TIERS, amount.value.length))
const fundAmountClass = computed(() => fundTier.value[1])
const fundUnitClass = computed(() => fundTier.value[2])
// Uygun girdi, teklif bekleniyor/isteniyor ve eldeki teklif yok: tutarin yerine "Hesaplaniyor" hapi (Swap.vue).
const calculating = computed(() => quoteEligible.value && ['waiting', 'quoting'].includes(phase.value) && !quote.value)
const minEtaText = computed(() => {
    const min = quoteAmountText(quote.value?.dest?.minDestAmount)
    if (min === null) return ''
    const symbol = quote.value.dest.asset
    const n = etaMinutes(quote.value.expectedFulfillmentMs)
    return n === null ? t('privacy.transfer.minOnly', { min, symbol }) : t('privacy.transfer.minEta', { min, symbol, n })
})

// Teslim adresi: Gonder'de yazilan alici; Para yukle, Takas ve Kopru'de Gizli Hesap'in kendisi (alici girdisi yoktur).
const outputAddress = computed(() => (props.mode === 'send' ? recipient.value : privacy.privateAddress))
const sourceAccountKey = computed(() => (props.mode === 'fund' ? sourceKey.value : privacy.privateAccountKey))

const normalizedAmount = computed(() => amount.value.replace(',', '.'))
const amountValid = computed(() => CANONICAL_AMOUNT_RE.test(normalizedAmount.value))
const amountInvalid = computed(() => amount.value !== '' && !amountValid.value)

// Kaynak bakiyesi (sT13): kaynak hesabin SECILI (zincir, varlik) bakiyesi, yalniz ilk RPC; fund'da normal hesap, send/swap/bridge'de Gizli Hesap.
// Bilinmiyorsa null: satir "\u2014" gosterir, yuzde cipleri gizlenir.
const balanceAddress = computed(() => (props.mode === 'fund' ? sourceAccount.value?.address : privacy.privateAddress) || null)
const { balance } = usePrivateSourceBalance({ address: balanceAddress, chain, asset })
const balanceKnown = computed(() => typeof balance.value === 'number' && Number.isFinite(balance.value))
const balanceText = computed(() => (balanceKnown.value ? Number(balance.value).toFixed(4) : '\u2014'))
// Yuzde cipleri yalniz odeme varligi USDC iken ve bakiye biliniyorken (sT8): tutar HER ZAMAN USDC brut (K10).
const showPercentChips = computed(() => asset.value === 'USDC' && balanceKnown.value)
// Tutar HER ZAMAN USDC degerindedir (SilentSwap yalniz teslim tutariyla calisir): kaynak USDC degilse tutarin yaninda "USDC" birimi gorunur ve bakiye
// kaynak varligiyla yazilir ("0.0412 ETH"); boylece cipteki ETH yuzunden sayi ETH sanilmaz.
const showUnit = computed(() => asset.value !== 'USDC')
const balanceLabel = computed(() => (balanceKnown.value && showUnit.value ? balanceText.value + ' ' + asset.value : balanceText.value))

// Bakiye asimi yalniz USDC icin kirmizi (X14): baska varlikta tutar USDC degerinde, bakiye farkli birimde. SilentSwap ucreti tutarin USTUNE
// eklenir (olculdu: 15 -> 15.15), bu yuzden karsilastirilan sey tutar x (1 + feeBps/10000)'dir; feeBps bilinmiyorsa temkinli yedek %1 (I2).
const balanceFee = computed(() => balanceFeeBps(providerInfo.value))
const balanceRed = computed(() => asset.value === 'USDC' && exceedsBalanceWithFee(balance.value, normalizedAmount.value, balanceFee.value))
const amountRed = computed(() => amountInvalid.value || balanceRed.value || belowMin.value)
// Cip tutari = bakiye x yuzde / (1 + feeBps/10000), 6 ondaliga kirpilir (percentChipAmount): odeme + ustune eklenen ucret bakiyeyi asmaz.
function setPercent(p) {
    if (asset.value !== 'USDC' || !balanceKnown.value) return
    amount.value = percentChipAmount(balance.value, p, balanceFee.value)
}

// Etkin en az tutar: yerlesik 12 USDC, sunucu degeri yalniz YUKSELTME yonunde izlenir (feeBreakdown.effectiveMinUsdc).
const effectiveMin = computed(() => effectiveMinUsdc(providerInfo.value, MIN_PAYOUT_USDC))
// Teklif uygunlugu (spec Bolum 6 "Uygunluk"): SilentSwap'a istek YALNIZ uygun girdiyle gider. securityBlocked uygunluga GIRMEZ (K9): adres
// guvenlik engeli teklifi durdurmaz, yalniz onay dugmesini kapatir. Bakiye karsilastirmasi yalniz USDC odemede (baska varlikta tutar USDC
// degerinde, bakiye farkli birimde). Takas/Kopru'de ek olarak teslim agi satirlarda olmali ve teslim edilebilir olmali, Takas'ta teslim kaynakla ayni olmamali
// (fitDeliveryToSource'un ayni kurallari; Para yukle ve Gonder etkilenmez).
const quoteEligible = computed(() => {
    // Hic teslim agi acik degilse teklif istenmez (arka plan da PRIVATE_CHAIN_CLOSED ile reddederdi).
    if (!hasDeliveryChain.value) return false
    if (!amountAtLeast(normalizedAmount.value, effectiveMin.value)) return false
    if (!chain.value || !assets.value.includes(asset.value) || !sourceAccountKey.value) return false
    if (!isAddress(outputAddress.value || '')) return false
    if (props.mode === 'send' && privateRecipient.value) return false
    if (sameAsSource.value) return false
    if (isSelfMode.value && !(routeOk.value && privateFundDeliverable(outputToken.value))) return false
    if (balanceRed.value) return false
    if (providerInfo.value?.available === false) return false
    return true
})
// Hata satiri metni: istek/onay hatasi; (X21) SilentSwap kapaliysa PRIVATE_PROVIDER_DOWN; faz error ama metin yoksa (ardisik 'stale' bitti)
// genel hata metni: "Tekrar dene" baglantisi her zaman bir metinle birlikte gorunur.
const shownError = computed(() => error.value
    || (providerInfo.value?.available === false ? errorText('PRIVATE_PROVIDER_DOWN') : '')
    || (phase.value === 'error' ? errorText(schedState.value.errorCode) : ''))
// Fail-closed: bitis zamani yok/gecersizse teklif SURESI DOLMUS sayilir (arka plan da boyle karar verir).
// Yurutucu bitisten QUOTE_MIN_REMAINING_MS (20 sn) once reddeder: ekran da o kadar ERKEN "Teklif al"a doner,
// yoksa son 20 sn'de Onayla sunulur ve PRIVATE_QUOTE_EXPIRED ile basarisiz olurdu (T25 U:M-5).
const expiredAt = (q, now) => !(q?.expiresAtMs - QUOTE_MIN_REMAINING_MS > now)
const expired = computed(() => !!quote.value && expiredAt(quote.value, nowMs.value))
// "Odeyecegin" etiketi (K10): teklif aninda DONDURULMUS kaynakla hesaplanir (canli form degil); belirlenemiyorsa null ve onay kapali (fail-closed).
const payLabel = computed(() => (quote.value ? payAmountLabel(quote.value, { chainId: quoteSourceChainId.value, asset: quoteSourceAsset.value }) : null))
const payKnown = computed(() => payLabel.value !== null)
// Teklif varsa pay-line HER rotada cizilir (I1): yazilan tutar alicinin alacagidir, odenen tutar (quote.amount, brut) ustune ucret eklenmis halidir.
const payLineShown = computed(() => !!quote.value)
// Etiketteki varlik kaynak varlikla ayni ve bakiye biliniyorsa: odenecek sayi bakiyeyi asiyor mu (X14: USDC disi varlikta TEK kirmizi kural).
// Etiket "<tutar> <varlik>" bicimindedir (payAmountLabel); bakiye CANLI secilen (zincir, varlik) cifti icindir, bu yuzden dondurulmus kaynakla eslesmesi sart.
const payExceedsBalance = computed(() => {
    const label = payLabel.value
    if (label === null || !balanceKnown.value) return false
    const i = label.lastIndexOf(' ')
    const n = Number(label.slice(0, i))
    return label.slice(i + 1) === asset.value && asset.value === quoteSourceAsset.value
        && Number(chainId.value) === Number(quoteSourceChainId.value) && Number.isFinite(n) && n > balance.value
})
// En az tutarin altinda: gecerli, pozitif ama etkin en azin altindaki tutar. Tutarin hemen altinda kirmizi hata satiri (amount-min), tutar kirmizi; ucret karti tire gosterir.
const belowMin = computed(() => amountValid.value && Number(normalizedAmount.value) > 0 && !amountAtLeast(normalizedAmount.value, effectiveMin.value))
// Hata metni: en az tutar USDC DEGERINDEDIR; kaynak USDC degilse ("USDC degerinde" notuyla ayni kosul) "... degerinde tutar gir" der. {min} etkin en az tutardir.
const belowMinText = computed(() => t(asset.value !== 'USDC' ? 'privacy.transfer.belowMinValue' : 'privacy.transfer.belowMin', { min: effectiveMin.value }))

// Ag ucreti ATS ile ZORUNLU (K7). IKI ucret yuvasi (PD7): normal teklifte etkin yuva yuklenir; on yenilemede yeni ticket in ucreti BOSTAKI yuvada
// hazirlanir ve hazir olunca teklif + yuva tek adimda degisir. Yuvalar duz dizidir (SSR testleri setupState.feeSlots[i] uzerinden okur/yazar).
const feeSlots = [useAtsOpFee(), useAtsOpFee()]
const activeSlot = ref(0)
const slot = computed(() => feeSlots[activeSlot.value])
const atsFee = computed(() => slot.value.atsFee.value)
const atsSymbol = computed(() => slot.value.atsSymbol.value)
const atsBalance = computed(() => slot.value.atsBalance.value)
const atsReady = computed(() => slot.value.ready.value)
const atsDecision = computed(() => slot.value.decision.value)
const atsLoading = computed(() => slot.value.loading.value)
const atsError = computed(() => slot.value.error.value)
const commissionHuman = computed(() => slot.value.commissionHuman.value)
const totalAtsCost = computed(() => slot.value.totalAtsCost.value)
const atsFeeRefundable = computed(() => slot.value.feeRefundable.value)
const atsPrepaid = computed(() => slot.value.prepaid.value)
const atsFeeInsufficient = computed(() => slot.value.insufficient.value)
const requiredAtsFor = (extra = 0) => slot.value.requiredAtsFor(extra)
const fmt = (n) => (n == null ? '\u2014' : Number(n).toFixed(4).replace(/\.?0+$/, ''))
// Etkin yuvanin ucretinin HANGI teklif icin alindigi: baska bir teklifin ucreti bu teklife onay vermez.
const atsTicket = ref(null)
// ATS kurulumu (yalniz Gonder/Takas/Kopru, odeyen Gizli Hesap): calisiyor ve basarisiz bayraklari. Basari ayri bir bayrak degildir: ucret yeniden
// yuklenir ve durum ready olunca not ile dugme kendiliginden kalkar (sunucu hala kurulum istiyorsa geri gelir).
const setupBusy = ref(false)
const setupFailed = ref(false)
// "ready" bakiyeyi soylemez (useAtsOpFee): hazir degil, yukleniyor, bakiye yetmiyor ya da ucret baska bir teklife aitse onay kapali.
// Ek olarak ucret yuvasinda HERHANGI bir karar (ic karar dahil) varsa onay kapali kalir: atsState ready degilse dugme acilmaz (Review Focus 5).
const atsBlocked = computed(() => !!quote.value
    && (!atsReady.value || atsLoading.value || atsFeeInsufficient.value || atsTicket.value !== quote.value.ticket || atsDecision.value != null))

// Etkin yuvayi O teklifin ticket'i icin yukler (arka plan cagri listesini saklanan tekliften kurar; yuk yalniz { ticket }). Dogrudan cagrilir:
// SSR'da izleyici calismaz, izleyici YOKTUR.
function refreshAtsFee() {
    const q = quote.value
    if (!q) {
        atsTicket.value = null
        slot.value.reset()
        return
    }
    atsTicket.value = q.ticket
    slot.value.load({ kind: 'private', payload: { ticket: q.ticket } })
}
function resetFeeSlots() {
    for (const s of feeSlots) s.reset()
    atsTicket.value = null
    setupFailed.value = false
}

// Ucretler kartinin ATS satiri durumu (atsState) ve metinleri. Teklif yoksa idle; yukleniyor loading; hata (karar yok ya da ic) error;
// bakiye yetmiyor ya da "ATS al" karari short; baska karar (operator, gecici, kurulum) blocked; aksi ready. Hazir olmayan ya da baska
// teklife ait ucret ready gosterilmez. Ic karar kullaniciya gosterilmez: ucret alinamadi karti (error) cikar.
const atsState = computed(() => {
    if (!quote.value) return 'idle'
    if (atsLoading.value) return 'loading'
    const d = atsDecision.value
    if (atsError.value && (!d || d.severity === 'internal')) return 'error'
    if (atsShort.value) return 'short'
    if (d && d.severity === 'internal') return 'error'
    if (d) return 'blocked'
    if (atsTicket.value !== quote.value.ticket) return 'loading'
    if (!atsReady.value) return 'error'
    return 'ready'
})
// ATS yetersiz mi (K8): kendi hesabimiz bakiye yetmiyor diyor ya da sunucu karari "ATS al". Kutu yalniz atsState short iken cizilir.
const atsShort = computed(() => atsFeeInsufficient.value || atsDecision.value?.action === 'buy-ats')
// Gonder, Takas ve Kopru'de (odeyen Gizli Hesap) ATS yetersizken kirmizi baglanti uyarisi; Para yukle'de odeyen Gizli Hesap degil (baglanti riski yok): privacyActive false.
const atsLinkWarn = computed(() => privateAtsLinkWarningVisible({
    privacyActive: props.mode !== 'fund',
    payWithAts: true,
    shortfall: atsFeeInsufficient.value,
    insufficient: atsFeeInsufficient.value,
    buyAts: atsDecision.value?.action === 'buy-ats',
}))
// Kurulum gerekli (run-onboarding): not (ve Gonder/Takas/Kopru'de kurulum dugmesi). Yetersiz olsa da kurulum notu gorunur (ikisi de dogru).
const atsSetupNeeded = computed(() => (atsState.value === 'blocked' || atsState.value === 'short') && atsDecision.value?.action === 'run-onboarding')
// Kurulumu calistirir: Swap'in ATS kartiyla AYNI islev (useAtsOpFee.runOnboarding -> ATS_RUN_ONBOARDING, kurulum adimlarini sunucu soyler), odeyen
// Gizli Hesap icin (kapi imzaciyi aktif hesaptan, yani gizli modda Gizli Hesap'tan cozer). Zincir: teklifin donmus kaynak zinciri (ucret teklifinin
// sorulan zinciri). Basarida ucret yeniden yuklenir; basarisizlikta hata satiri ve "Tekrar dene". Para yukle'de (odeyen normal hesap) cagrilmaz.
async function runAtsSetup() {
    if (props.mode === 'fund' || setupBusy.value || !quote.value) return
    setupBusy.value = true
    setupFailed.value = false
    try {
        const ok = await slot.value.runOnboarding({ chainId: Number(quoteSourceChainId.value ?? chainId.value), address: privacy.privateAddress })
        if (ok) refreshAtsFee()
        else setupFailed.value = true
    } catch {
        setupFailed.value = true
    } finally {
        setupBusy.value = false
    }
}
// Agir rota (R5): ATS ucret teklifi PRIVATE_UNSUPPORTED doner; yeniden denemek degistirmez.
const atsUnsupported = computed(() => atsState.value === 'error' && atsError.value === 'PRIVATE_UNSUPPORTED')
const feeAts = computed(() => {
    const state = atsState.value
    const d = atsDecision.value
    const required = requiredAtsFor(0)
    let message = null
    // Karar metni YALNIZ blocked/kurulum satirinda (X5). short: sayi (ya da tire) satirda, anlatim kirmizi kutuda; error: kirmizi kartta.
    if (state === 'blocked' && d) message = t(d.i18nKey, { symbol: atsSymbol.value })
    return {
        state,
        amount: fmt(totalAtsCost.value),
        symbol: atsSymbol.value,
        required: required == null ? null : fmt(required),
        refundable: atsFeeRefundable.value,
        prepaid: !!atsPrepaid.value,
        message,
    }
})

// Kabul edilen teklifin TUM baglami tek yerde sifirlanir (teklif, istek anahtari ve teklif aninda
// dondurulmus kaynak zincir/varlik/etiket): yarim sifirlama kart ve "odeyecegin" kararini eski
// teklifin kaynagiyla birakirdi. Girdi degisince eski teklif ve eski hata gecersiz (duzeltilen
// alanin yanindaki eski hata durmasin); confirm() de basarisiz/belirsiz sonuclarda bunu kullanir.
function invalidateQuote() {
    quote.value = null
    quoteKey.value = ''
    quoteSourceChainId.value = null
    quoteSourceAsset.value = null
    quoteDestIsUsdc.value = false
    resetFeeSlots()
    error.value = ''
}
// Ayni token yeniden secilince nesne degismez: izleyici gecerli teklifi atmaz (kimlik chainId + adres, adres harf boyutuna bakilmaz).
function onPickToken(token) {
    if (token.chainId !== outputToken.value.chainId || token.address.toLowerCase() !== outputToken.value.address.toLowerCase()) outputToken.value = token
    closePicker()
}
// Kimden paneli (yalniz kaynak hesabi secer; aktif Gizli Hesap degismez), kaynak cifti secicisi ve "?" sayfasi.
const fromOpen = ref(false)
const sourcePickerOpen = ref(false)
const infoOpen = ref(false)
const fromTrigger = ref(null)
const sourceChipEl = ref(null)
const infoTrigger = ref(null)
async function closeFrom() {
    fromOpen.value = false
    await nextTick()
    fromTrigger.value?.focus?.()
}
function onPickFrom(key) {
    sourceKey.value = key
    closeFrom()
}
async function closeSourcePicker() {
    sourcePickerOpen.value = false
    await nextTick()
    sourceChipEl.value?.$el?.focus?.()
}
// Secim (zincir, varlik) ciftini BIRLIKTE yazar; bilinmeyen anahtar secimi bozmaz. Takas/Kopru'de teslim tokeni yeni kaynaga gore uydurulur (fitDeliveryToSource).
function onPickSourcePair(key) {
    const pair = sourcePairList.value.find((p) => p.key === key)
    if (pair) {
        chainId.value = pair.chainId
        asset.value = pair.asset
        fitDeliveryToSource()
    }
    closeSourcePicker()
}
async function closeInfo() {
    infoOpen.value = false
    await nextTick()
    infoTrigger.value?.focus?.()
}
// Panel kapaninca odak panelin acildigi dugmeye doner (klavye/ekran okuyucu kullanicisi yerini kaybetmesin).
async function closePicker() {
    pickerOpen.value = false
    await nextTick()
    // Kartta cip bileseni ($el), Gonder'de duz <button> (kendisi): ikisi de olur.
    const el = deliveryTrigger.value
    const trigger = el?.$el ?? el
    trigger?.focus?.()
}
// Hata satiri sayfanin altinda kalabilir (fund modunda uzun form): hata gelince gorunur alana getirilir.
// Optional zincir: SSR ve testlerde eleman/scrollIntoView yoktur, sessiz gecer.
async function revealError() {
    await nextTick()
    errorEl.value?.scrollIntoView?.({ block: 'nearest' })
}
watch(error, (msg) => { if (msg) revealError() })
// Kaynak hesap degisince secili (zincir, varlik) cifti listeden dusebilir: ilk gecerli cifte don (zincir ve varlik BIRLIKTE).
watch(sourcePairList, (list) => {
    if (list.length && !list.some((p) => p.key === sourceKeyPair.value)) {
        chainId.value = list[0].chainId
        asset.value = list[0].asset
    }
})

onMounted(async () => {
    // Zamanlayici ILK await'ten once kurulur: kullanici ekrandan await'ler sirasinda cikarsa
    // onUnmounted zaten calismis olur ve sonradan kurulan zamanlayici sizardi.
    if (typeof window !== 'undefined') expiryTimer = window.setInterval(() => { nowMs.value = Date.now() }, 5000)
    // Sayfa gizlenip gorunur olunca zamanlayici on yenilemeyi yeniden degerlendirir (gizliyken on yenileme istenmez).
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    // SilentSwap durum ozeti acilista TAM bir kez istenir; beklenmez (yanit gelmese de ekran calisir).
    loadProviderInfo()
    const { vaults, privacy_mode } = await chrome.storage.local.get(['vaults', 'privacy_mode'])
    // Eski `type: 'ton'` kayitlari EVM kaynak olamaz; Gizli Hesap zaten `accounts` disinda.
    publicAccounts.value = flattenVaultAccounts(vaults).filter((a) => accountShowsEvmRow(a) && !isPrivateAccount(a))
    sourceKey.value = publicAccounts.value.find((a) => a.key === privacy_mode?.lastPublicAccountKey)?.key || publicAccounts.value[0]?.key || null
    // myAddress BILEREK verilmez: uzak gecmis sorgusu Gizli Hesap adresini tasiyamasin.
    if (props.mode === 'send') await loadTrusted({ chainId: outputToken.value.chainId })
})

onUnmounted(() => {
    if (expiryTimer !== null) {
        window.clearInterval(expiryTimer)
        expiryTimer = null
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    scheduler.dispose()
})

// Mesaj hic ulasmazsa (servis calisani yeniden basliyorsa) cevap bos sayilir: ham hata
// metni asla gosterilmez.
async function send(type, message) {
    try {
        return await chrome.runtime.sendMessage({ type, message })
    } catch {
        return null
    }
}

// Teklif ozeti secimle uyusmali (spec 4.8): recipientChainId (sunucu yankisi) ve dest.chainId istegin teslim agina esit; dest.asset dolu
// ve istegin sembolune, tamsayi dest.decimals istegin ondaligina esit olmali. Aksi halde kart cizilmez ve PRIVATE_QUOTE_MISMATCH olur
// ("BNB / 18" yedegi yok). Arka plan sembolu ve ondaligi secimden yazar: esitsizlik bir arka plan hatasidir ve kart yanlis ondalikla tutar cizerdi.
function quoteDeliveryOk(q, token) {
    const d = q?.dest
    return !!d && Number(q.recipientChainId) === token.chainId && Number(d.chainId) === token.chainId
        && typeof d.asset === 'string' && d.asset !== '' && d.asset === token.symbol
        && Number.isInteger(d.decimals) && d.decimals === token.decimals
}

// Teklif istegi girdileri (tek kaynak): yanit gelince girdiler bunlarla ayni degilse yanit atilir.
function requestInputs() {
    return {
        sourceAccountKey: sourceAccountKey.value,
        sourceChainId: Number(chainId.value),
        sourceAsset: asset.value,
        outputAddress: outputAddress.value,
        payoutUsdc: normalizedAmount.value,
        outputToken: { chainId: outputToken.value.chainId, address: outputToken.value.address, symbol: outputToken.value.symbol, decimals: outputToken.value.decimals },
    }
}

// SilentSwap durum ozetini okur (PRIVATE_PROVIDER_INFO). Yanit bozuksa/yoksa providerInfo null kalir: ekran ENGELLENMEZ.
async function loadProviderInfo() {
    const res = await send('PRIVATE_PROVIDER_INFO')
    const i = res?.success ? res.info : null
    providerInfo.value = i && typeof i === 'object' && !Array.isArray(i)
        ? { feeBps: i.feeBps ?? null, minUsdc: i.minUsdc ?? null, maxUsdc: i.maxUsdc ?? null, available: i.available !== false }
        : null
}

// Zamanlayicinin cagirdigi tek teklif istegi (eski getQuote govdesi; busy/soguma YOK, onlari zamanlayici yonetir). Cevapta IKI denetim
// birlikte: istek hala guncel mi (isCurrent) ve girdiler istekle ayni mi; degilse eski cevap teklif KURMAZ ('stale').
// On yenilemede (refresh) hata satiri YAZILMAZ: eldeki gecerli teklif ve onay etkilenmez.
async function runQuote({ isCurrent, refresh }) {
    if (!quoteEligible.value) return { status: 'stale' }
    if (!refresh) error.value = ''
    const req = requestInputs()
    const res = await send('PRIVATE_QUOTE', req)
    // Girdiler bekleme sirasinda degistiyse (ya da istek eskidiyse) eski istegin teklifi KURULMAZ: arka plan yatirmayi teklif kaydindaki
    // hesap/aliciya baglar, ekran canli girdiyi gosterirdi.
    // On yenileme cevabi zamanlayici HALA onu beklerken kurulur: yenileme ucustayken teklif suresi dolarsa (onExpiry -> expired, refreshing false)
    // gec gelen cevap yeni teklif/bilet kurmaz (aksi halde onay dugmesi kalici kapali, yeni teklif karti gorunur ve aciklama yok olurdu; I1).
    // Ayni iki denetim ATS ucreti beklendikten sonra da tekrarlanir (PD7).
    const wanted = () => isCurrent() && JSON.stringify(requestInputs()) === JSON.stringify(req) && (!refresh || schedState.value.refreshing)
    if (!wanted()) return { status: 'stale' }
    if (res?.success && res.quote) {
        // Teklifin alicisi istenen adresle AYNI olmali (buyuk/kucuk harf farki sayilmaz): arka plan da denetler, burada gosterilen alici
        // ile istenen alici hic ayrisamasin. Teslim ozeti de secimle uyusmali (quoteDeliveryOk).
        if (String(res.quote.recipient || '').toLowerCase() !== String(req.outputAddress || '').toLowerCase() || !quoteDeliveryOk(res.quote, req.outputToken)) {
            if (!refresh) error.value = errorText('PRIVATE_QUOTE_MISMATCH')
            return { status: 'error', code: 'PRIVATE_QUOTE_MISMATCH' }
        }
        // Teklif ve baglami TEK adimda kurulur (yarim kurulum "odeyecegin" kararini eski kaynakla birakirdi).
        const adopt = () => {
            quote.value = res.quote
            quoteKey.value = JSON.stringify(req)
            quoteSourceChainId.value = req.sourceChainId
            quoteSourceAsset.value = req.sourceAsset
            quoteDestIsUsdc.value = isUsdcDeliveryToken(req.outputToken)
            nowMs.value = Date.now()
        }
        if (!refresh) {
            // Normal teklif: invalidateQuote ucreti zaten sifirlamistir; etkin yuva yeni ticket icin dogrudan yuklenir (onay, yukleme bitene dek kapali).
            adopt()
            refreshAtsFee()
            return { status: 'ok', endMs: Number(res.quote.expiresAtMs) - QUOTE_MIN_REMAINING_MS }
        }
        // On yenileme (PD7): yeni ticket in ucreti BOSTAKI yuvada hazirlanir; ekran bu sirada eski teklifi ve eski ucreti gosterir (onay acik).
        // Yuva hazir degilse ya da hatali ise yenileme error sayilir ve eski teklif ile eski ucret yerinde kalir. Takas TEK adimdir.
        const spare = feeSlots[1 - activeSlot.value]
        spare.reset()
        await spare.load({ kind: 'private', payload: { ticket: res.quote.ticket } })
        if (!wanted()) {
            spare.reset()
            return { status: 'stale' }
        }
        if (!spare.ready.value || spare.error.value) {
            spare.reset()
            return { status: 'error', code: 'PRIVATE_FAILED' }
        }
        const old = feeSlots[activeSlot.value]
        adopt()
        activeSlot.value = 1 - activeSlot.value
        atsTicket.value = res.quote.ticket
        old.reset()
        return { status: 'ok', endMs: Number(res.quote.expiresAtMs) - QUOTE_MIN_REMAINING_MS }
    }
    if (!refresh) error.value = errorText(res?.error, res?.limitUsdc)
    return { status: 'error', code: res?.error ?? 'PRIVATE_FAILED' }
}

const scheduler = createQuoteScheduler({
    run: runQuote,
    onChange: (snapshot) => {
        const prevPhase = schedState.value.phase
        schedState.value = snapshot
        // Faz degisimi yan etkisi BURADA (izleyici degil, X2): sure dolunca saglayici durumu (en az tutar, musaitlik) yeniden okunur.
        if (snapshot.phase === 'expired' && prevPhase !== 'expired') loadProviderInfo()
    },
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
})

// Girdi degisti: eski teklif ve hata duser, zamanlayici yeniden planlar (uygun degilse bosa duser). kind: 'amount' (800 ms) | 'discrete' (300 ms).
function onQuoteInput(kind) {
    invalidateQuote()
    scheduler.input(kind, quoteEligible.value)
}
function retryQuote() {
    error.value = ''
    scheduler.retry()
}
function onVisibility() {
    scheduler.visibilityChanged()
}

// Teklifi etkileyen KULLANICI girdileri (X3), tutar ve uygunluk HARIC: kaynak hesap, (zincir, varlik) cifti, teslim cipi ve YALNIZ gecerli
// alici adresi. Yazilmakta olan gecersiz alici anahtari degistirmez; bakiye/saglayici bilgisi yalniz uygunluk donusuyle etkiler.
const userKey = computed(() => JSON.stringify({
    source: sourceAccountKey.value,
    chainId: chainId.value,
    asset: asset.value,
    outputToken: { chainId: outputToken.value.chainId, address: outputToken.value.address, symbol: outputToken.value.symbol, decimals: outputToken.value.decimals },
    output: isAddress(outputAddress.value || '') ? outputAddress.value : '',
}))
// Tek izleyici: tutar ve diger girdiler AYRI izlenmez (tutar yazarken 800 ms, 300 ms'ye dusmesin). Kullanici anahtari degistiyse ya da
// yalniz uygunluk dondu (tutar ayni) 'discrete'; degisen yalniz tutarsa (uygunluk donse de) 'amount'.
function onInputWatch(next, prev) {
    if (!prev || (next.amount === prev.amount && next.key === prev.key && next.eligible === prev.eligible)) return
    if (next.key !== prev.key || next.amount === prev.amount) onQuoteInput('discrete')
    else onQuoteInput('amount')
}
watch(() => ({ amount: amount.value, key: userKey.value, eligible: quoteEligible.value }), onInputWatch)

// Ana ekranin Gizli islemler sekmesine gider (yalniz kullanici hala bu ekrandaysa) ve istenirse tek seferlik not birakir.
// Donus: gidildi mi (kullanici baska sayfadaysa false: ekran acik kalir).
function goToOrders(noticeKey = null) {
    if (page.currentPage !== MY_ROUTE_FOR[props.mode]) return false
    page.ordersNotice = noticeKey
    page.homeTab = 'private'
    page.currentPage = 'home'
    return true
}

async function confirm() {
    if (busy.value || !quote.value) return
    // Onay kutusu teklif sonrasi geri alindiysa gonderilmez (geri donulmez adim).
    if (props.mode === 'send' && securityBlocked.value) return
    const q = quote.value
    // Tiklamasini beklemeden: sure dolduysa (ya da bitis zamani yoksa) gonderilmez, ekran "yeni teklif al"a doner.
    if (expiredAt(q, Date.now())) {
        nowMs.value = Date.now()
        retryQuote()
        return
    }
    // Kabul edilen teklif baska bir istege aitse (girdi degisti, izleyici henuz calismadi) gonderilmez.
    if (quoteKey.value !== JSON.stringify(requestInputs())) {
        invalidateQuote()
        return
    }
    // Odenecek tutar gosterilemiyorsa onay verilmez.
    if (!payKnown.value) return
    // Ucret onayi eksikse (yukleniyor, hazir degil, bakiye yok, baska teklif) ya da odenecek tutar bakiyeyi asiyorsa gonderilmez; zamanlayici DURMAZ (X17).
    if (payExceedsBalance.value || atsBlocked.value) return
    // "Uyari cikmis alici kaydedilmez" kurali bekleme ONCESI durumdan okunur: siparis suresince
    // alici alani degisse de kayit, gonderilen teklifin bayraklarina gore karar verir.
    const flagged = !!poisonMatch.value || !!reputation.value.severity
    const sentRecipient = q.recipient || recipient.value
    busy.value = true
    error.value = ''
    try {
        // Ag ucreti HER ZAMAN ATS (K7, sT15): mesaj yalniz { ticket, gas: 'ats', atsQuoted } tasir.
        const message = { ticket: q.ticket, gas: 'ats', atsQuoted: { transferFee: atsFee.value, commissionFee: commissionHuman.value } }
        // Tum on denetimler gecti: gonderim BASLARKEN zamanlayici durur (ucustaki teklif/yenileme cevaplari gecersiz olur, X17).
        scheduler.stop()
        const res = await send('PRIVATE_ORDER', message)
        if (res?.success) {
            // Gonderilen alici gizli tarafa yazilir (normal mod onerilerine ve zehirli adres
            // listesine sizmaz). Uyari cikmis alici kaydedilmez: bkz. ConfirmTransaction.
            if (props.mode === 'send' && !flagged) {
                // Teklifin alicisi: yatirmanin gercekten baglandigi adres, canli girdi degil.
                await recordSentRecipient(sentRecipient, null, Date.now(), { private: true })
                    .catch((e) => console.warn('Alici kaydedilemedi:', e.message))
            }
            // Teslim edilen token'in Gizli Hesabin listesine yazimi ARKA PLANDADIR (runPrivateOrder, E13): popup 10 sn'yi asan
            // onay/yayin sirasinda kapanirsa buradaki yazim hic olmazdi.
            // Gecis sirasinda (0.25 sn'lik cikis animasyonu) eski DOM ayni ticket icin ikinci bir onay
            // tetikleyemesin: teklif once kapanir (T25 U:M-1). Kalici koruma yine arka plandadir.
            invalidateQuote()
            goToOrders()
            return
        }
        // Cevap yok (hizmet calisani yeniden basliyor): yayin olmus olabilir. Liste kontrol edilmeden
        // tekrar denenmez. Bilet tuketilmis olabilecegi icin teklif de kapanir.
        // `== null`: dinleyici hic cevap vermezse (undefined) da ayni yol; res.error okumasi TypeError atmaz.
        if (res == null) {
            invalidateQuote()
            scheduler.lock()
            // Yonlendirme yapilamadiysa (kullanici baska sayfada) kilitli ekran metinsiz kalmasin (X4); yapildiysa ekran zaten kapanir.
            if (!goToOrders(UNCONFIRMED_NOTICE_KEY)) error.value = t(UNCONFIRMED_NOTICE_KEY)
            return
        }
        // Yatirma gonderilmis olabilir ama izlenemiyor: Gizli islemlere YONLENDIRILMEZ (kayit yok); ekran kilitlenir (otomatik teklif cift
        // yatirmaya iterdi) ve metin hata satirinda yerinde gorunur. Kilit yalniz girdi degisimiyle acilir.
        if (res.error === 'PRIVATE_DEPOSIT_UNTRACKED') {
            invalidateQuote()
            scheduler.lock()
            error.value = errorText(res.error)
            return
        }
        // Zaten gonderilmis ya da yatirma belirsiz bitti: sonucu Gizli islemler listesi gosterir.
        if (GO_TO_ORDERS_CODES.has(res.error)) {
            invalidateQuote()
            scheduler.lock()
            if (!goToOrders(`privacy.errors.${res.error}`)) error.value = errorText(res.error)
            return
        }
        // Listeye gitmeyen her basarisiz cevapta teklif kapanir: tuketilmis ya da gecersiz bilet ekrandan
        // yeniden denenmez; hata satiri ve "Tekrar dene" (faz error) sunulur.
        invalidateQuote()
        error.value = errorText(res.error)
        scheduler.fail(res.error)
    } finally {
        busy.value = false
    }
}
</script>
