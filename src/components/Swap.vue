<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/10 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>
        
        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
            <SwapFrom v-if="popups.swap_from"/>
        </Transition>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 translate-y-4" enter-to-class="opacity-100 translate-y-0" leave-from-class="opacity-100 translate-y-0" leave-to-class="opacity-0 translate-y-4">
            <SwapTo v-if="popups.swap_to"/>
        </Transition>

        <Transition enter-active-class="transition-all duration-300 ease-out" leave-active-class="transition-all duration-200 ease-in" enter-from-class="opacity-0 scale-95" enter-to-class="opacity-100 scale-100" leave-from-class="opacity-100 scale-100" leave-to-class="opacity-0 scale-95">
            <Settings v-if="popups.swap_settings"/>
        </Transition>

        <section class="flex flex-col h-full relative z-10">
            
            <div class="flex items-center justify-between px-5 py-4">
                <Back page="home" class="hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
                <span></span>
                
                <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white ms-5 transition-colors duration-300">{{ $t('swap.title') }}</h1>
                
                <button 
                    @click="popups.swap_settings = true"
                    class="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-white/5 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white transition-colors duration-300 cursor-pointer"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m19.588 15.492l-1.814-1.29a6.483 6.483 0 0 0-.005-3.421l1.82-1.274l-1.453-2.514l-2.024.926a6.484 6.484 0 0 0-2.966-1.706L12.953 4h-2.906l-.193 2.213A6.483 6.483 0 0 0 6.889 7.92l-2.025-.926l-1.452 2.514l1.82 1.274a6.483 6.483 0 0 0-.006 3.42l-1.814 1.29l1.452 2.502l2.025-.927a6.483 6.483 0 0 0 2.965 1.706l.193 2.213h2.906l.193-2.213a6.484 6.484 0 0 0 2.965-1.706l2.025.927l1.453-2.501ZM13.505 2.985a.5.5 0 0 1 .5.477l.178 2.035a7.45 7.45 0 0 1 2.043 1.178l1.85-.863a.5.5 0 0 1 .662.195l2.005 3.47a.5.5 0 0 1-.162.671l-1.674 1.172c.128.798.124 1.593.001 2.359l1.673 1.17a.5.5 0 0 1 .162.672l-2.005 3.457a.5.5 0 0 1-.662.195l-1.85-.863c-.602.49-1.288.89-2.043 1.179l-.178 2.035a.5.5 0 0 1-.5.476h-4.01a.5.5 0 0 1-.5-.476l-.178-2.035a7.453 7.453 0 0 1-2.043-1.179l-1.85.863a.5.5 0 0 1-.663-.194L2.257 15.52a.5.5 0 0 1 .162-.671l1.673-1.171a7.45 7.45 0 0 1 0-2.359L2.42 10.148a.5.5 0 0 1-.162-.67L4.26 6.007a.5.5 0 0 1 .663-.195l1.85.863a7.45 7.45 0 0 1 2.043-1.178l.178-2.035a.5.5 0 0 1 .5-.477h4.01ZM11.5 9a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Zm0 1a2.5 2.5 0 1 0 0 5a2.5 2.5 0 0 0 0-5Z"/></svg>
                </button>
            </div>

            <!-- pb-20 + overflow-y-auto: onay butonu `absolute bottom-5` ile AKISIN DISINDA
                 duruyor, yani icerik onun altina girer. ATS ucret/komisyon karti eklendikten
                 sonra sabit yukseklikte (h-150) yer kalmadi ve kart butonun arkasinda kesildi.
                 Bridge.vue ayni sorunu ayni sekilde cozuyor; iki ekran artik ayni yapida.
                 DEGER OLCUYE GORE: buton py-4 (32) + text-base satiri (~24) = 56 yuksek,
                 uzerine bottom-5 (20) -> ust kenari alttan 76px. pb-20 (80px) bunu 4px
                 payla temizler. pb-28 (112) fazlaydi ve sona kaydirinca bos bant birakiyordu. -->
            <div class="px-4 pb-20 flex-1 flex flex-col gap-4 overflow-y-auto custom-scrollbar">
                <div class="w-full flex justify-center">
                    <ChangeNetwork flow="swap" class="scale-90" />
                </div>

                <div class="relative w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-3xl p-4 shadow-md dark:shadow-xl transition-colors duration-300">
                    <div class="flex flex-col gap-3">
                        
                        <div class="flex justify-between items-center">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 transition-colors duration-300">{{ $t('swap.pay') }}</span>
                            <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-400 transition-colors duration-300">
                                <!-- Token yokken SAYI BASILMAZ. useTokenBalance `undefined` adresi
                                     native sayiyor (nativeAsset.js): buton bombosken bakiye satiri
                                     "132.4999" gosteriyor ve kullanici token secili saniyordu. -->
                                <span :class="{ 'text-red-500 dark:text-red-400': insufficientBalance }">{{ $t('swap.balance') }}: {{ crypto.swap.inToken ? (Number(inBalance).toFixed(4) || 0) : '—' }}</span>
                                <!-- Yuzde cipleri. MAX eskiden TAM bakiyeyi yaziyordu ve native
                                     girdide bu bir cikmazdi: "yetersiz gaz" kirmiziya donuyor,
                                     dugme kilitleniyor ve MAX hicbir zaman tamamlanamiyordu.
                                     Artik ucret payi dusulmus HARCANABILIR bakiyeden pay
                                     aliniyor (Gonder ekraniyla ayni saf katman). -->
                                <button
                                    v-for="percent in SEND_PERCENTS"
                                    :key="percent"
                                    class="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 rounded hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                                    :disabled="!crypto.swap.inToken"
                                    @click="setPercent(percent)"
                                >{{ percent === 1 ? 'MAX' : $t('common.percentChip', { value: percent * 100 }) }}</button>
                            </div>
                        </div>

                        <div class="flex items-center justify-between gap-4">
                            <button 
                                class="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] text-slate-800 dark:text-white px-3 py-2 rounded-xl transition-all border border-transparent hover:border-slate-300 dark:hover:border-white/10 shrink-0 cursor-pointer" 
                                @click="popups.swap_from = true"
                            >
                                <!-- `image` guard'i IC alana kadar iner: Token.vue'nun yazdigi
                                     kayitta `image` hic olmayabiliyor ve `image.large` TypeError
                                     atiyordu. Sembol de kirik opsiyonel zincirdeydi. -->
                                <img v-if="crypto.swap.inToken?.image?.large" :src="crypto.swap.inToken.image.large" :alt="crypto.swap.inToken.name" class="w-6 h-6 rounded-full border border-slate-200 dark:border-transparent">
                                <span class="font-bold text-sm">{{ crypto.swap.inToken?.symbol?.toUpperCase() || $t('swap.selectToken') }}</span>
                                <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z"/></svg>
                            </button>

                            <input 
                                v-model="inTokenAmount" 
                                type="number" 
                                inputmode="numeric" 
                                class="w-full bg-transparent text-3xl font-bold text-right text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-zinc-700 outline-none caret-indigo-500 transition-colors duration-300" 
                                :class="insufficientBalance ? 'text-red-500 dark:text-red-400' : ''" 
                                placeholder="0" 
                                @keydown="preventInvalidKeys"
                            >
                        </div>
                    </div>

                    <div class="relative h-8 w-full my-2 flex items-center justify-center">
                        <div class="absolute inset-0 flex items-center">
                            <div class="w-full border-t border-slate-100 dark:border-white/5 transition-colors duration-300"></div>
                        </div>
                        <button 
                            class="relative w-10 h-10 rounded-xl bg-slate-50 dark:bg-[#18181b] border-4 border-white dark:border-[#131315] flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-700 transition-all duration-300 group"
                            :disabled="!crypto.swap.outToken"
                            :style="{ cursor: !crypto.swap.outToken ? 'not-allowed' : 'pointer' }"
                            @click="reverse"
                        >
                            <svg class="w-5 h-5 transition-transform duration-300 group-hover:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 16L7 11l1.4-1.4l2.6 2.6V4h2v8.2l2.6-2.6L17 11l-5 5Z"/></svg>
                        </button>
                    </div>

                    <div class="flex flex-col gap-3">
                        <div class="flex justify-between items-center">
                            <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 transition-colors duration-300">{{ $t('swap.receive') }}</span>
                            <span v-if="crypto.swap.outToken" class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('swap.balance') }}: {{ outBalance || 0 }}</span>
                        </div>

                        <div class="flex items-center justify-between gap-4">
                            <button 
                                class="flex items-center gap-2 px-3 py-2 rounded-xl transition-all shrink-0 border border-dashed cursor-pointer"
                                :class="crypto.swap.outToken 
                                    ? 'bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] text-slate-800 dark:text-white border-transparent' 
                                    : 'bg-transparent border-slate-300 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-zinc-200 hover:border-indigo-400 dark:hover:border-zinc-500'"
                                @click="popups.swap_to = true"
                            >
                                <img v-if="crypto.swap.outToken" :src="crypto.swap.outToken.image.large" :alt="crypto.swap.outToken.name" class="w-6 h-6 rounded-full border border-slate-200 dark:border-transparent">
                                <span class="font-bold text-sm">{{ crypto.swap.outToken?.symbol.toUpperCase() || $t('swap.selectToken') }}</span>
                                <svg class="w-4 h-4 opacity-70" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z"/></svg>
                            </button>

                            <div class="flex items-center justify-end h-9 flex-1 min-w-0">
                                <span 
                                    v-if="!swapLoading" 
                                    class="w-full text-right font-bold text-slate-800 dark:text-zinc-200 truncate transition-colors duration-300"
                                    :class="String(Number(swapData?.expectedOutput || 0).toFixed(4)).length > 10 ? 'text-xl mt-1.5' : 'text-3xl'"
                                >
                                    {{ swapData?.expectedOutput ? Number(swapData?.expectedOutput).toFixed(4) : '0.00' }}
                                </span>
                                <div v-else class="flex items-center gap-2 px-3 py-1 bg-slate-100 dark:bg-zinc-800 rounded-lg transition-colors duration-300 shrink-0">
                                    <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-dasharray="16" stroke-dashoffset="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="160"/><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12360 12 12"/></path></svg>
                                    <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('swap.calculating') }}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- NE flex-1 NE justify-end: ikisi bu bloku kabin dibine, gonder butonunun
                     hemen ustune itiyordu ve takas karti ile ucret karti arasinda bos bant
                     kaliyordu. Kartlar takas kartinin ALTINDA akar; artan bosluk asagida,
                     butonun uzerinde toplanir.
                     pb-20 DA BURADA OLMAZ: saran kaydirma kabi (yukarida) zaten pb-20 tasiyor
                     ve mutlak konumlu gonder butonunu o temizliyor. -->
                <div class="flex flex-col gap-3">
                    
                    <div v-if="swapData" class="w-full bg-white dark:bg-white/5 rounded-xl p-3 border border-slate-200 dark:border-white/5 flex flex-col gap-2 animate-fade-in-up shadow-sm dark:shadow-none transition-colors duration-300">
                        <div class="flex justify-between items-center text-xs text-slate-500 dark:text-zinc-400">
                            <span>{{ $t('swap.exchangeRate') }}</span>
                            <span class="text-slate-700 dark:text-zinc-200 font-mono transition-colors duration-300">1 {{ crypto.swap.inToken.symbol.toUpperCase() }} ≈ {{ swapData.exchangeRate }} {{ crypto.swap.outToken.symbol.toUpperCase() }}</span>
                        </div>
                        <!-- TAHMINI GAZ SATIRI KALDIRILDI: bu satir NATIVE gaz maliyetini
                             gosteriyordu, ama on agin hepsinde ucret ATS ile odeniyor
                             (payWithAts her zincirde true) — yani kullanicinin hic odemedigi
                             bir tutari, odeyecegi tutarin yaninda gostermek oluyordu. Gercek
                             maliyet asagidaki ATS kartinda TEK SATIRDA duruyor.
                             `swapData.estimatedGasFee` KALDI: ATS kolunun DISINDAKI
                             insufficientGas kontrolu ondan besleniyor. -->

                        <!-- R20 — derinlik esigi TUM V2 adaylarini eledi ve taranmamis bir V3
                             rotasi kazandi. Fiyat etkisi bu rotada zaten 'N/A'; yani uyariya
                             en cok ihtiyaci olan buyuk takas, tek uyari kaynagini kaybetmis
                             oluyor. Bu satir o bosluga koyuluyor. -->
                        <div v-if="swapData.depthGateWarning" class="flex items-start gap-1.5 text-[10px] leading-tight text-amber-600 dark:text-amber-400 pt-1 border-t border-slate-100 dark:border-white/5">
                            <svg class="w-3 h-3 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            <span>{{ $t('swap.depthGateWarning') }}</span>
                        </div>
                    </div>

                    <!-- Zincir cozulemedi: girdi tokeni kurulamiyor. Eskiden bu durumda ekran
                         hicbir sey soylemiyordu (bos buton + calisir gorunen bakiye satiri). -->
                    <!-- Zincir uyusmazligi: takasi ENGELLEMEZ, yalnizca neden baska bir token
                         gordugunu soyler. Kart degil satir — engel degil bilgi. -->
                    <!-- SUPHE (token KORUNUR): slug baska bir zincir diyor ama ayni adres
                         birden cok zincirde gecerli olabiliyor; kesinlik yok, o yuzden
                         secim silinmez, yalnizca uyarilir. -->
                    <div v-if="tokenNotice === 'chain-suspect'" class="flex items-start gap-1.5 text-[10px] leading-tight text-amber-600 dark:text-amber-400 px-1">
                        <svg class="w-3 h-3 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>{{ $t('swap.tokenChainSuspect') }}</span>
                    </div>

                    <div v-if="tokenNotice === 'chain-mismatch' || tokenNotice === 'foreign-asset'" class="flex items-start gap-1.5 text-[10px] leading-tight text-amber-600 dark:text-amber-400 px-1">
                        <svg class="w-3 h-3 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <!-- 'foreign-asset' "baska bir agda" DEGIL, "cuzdanin desteklemedigi bir
                             agda" demektir; ayni metni basmak kullaniciyi yanlis yone gonderir. -->
                        <span>{{ $t(tokenNotice === 'foreign-asset' ? 'swap.tokenForeignAsset' : 'swap.tokenChainMismatch') }}</span>
                    </div>

                    <div v-if="tokenNotice === 'unsupported-chain'" class="w-full rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 flex items-start gap-3 transition-colors duration-300">
                        <svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-bold text-amber-600 dark:text-amber-400">{{ $t('swap.unsupportedChain') }}</span>
                            <span class="text-xs text-amber-600/80 dark:text-amber-300/70">{{ $t('swap.unsupportedChainDesc') }}</span>
                        </div>
                    </div>

                    <!-- Teklif hatasi — R17. Derinlik esigiyle elenen aday, "havuz yok" ile
                         AYNI metni uretiyordu ve ekranda hicbir sey gorunmuyordu: kullanici
                         yalnizca 0.00 goruyor, miktarin sorun oldugunu anlamiyordu.
                         UCUNCU DAL ('unknown'): tanimadigimiz hatalara "rota yok" demek yalan
                         olurdu, ama SESSIZ kalmak da yalandi — kullanici 0.00 gorup miktari
                         sucluyordu. Artik "teklif alinamadi" denir, sebep iddia edilmez. -->
                    <div v-if="quoteError" class="w-full rounded-xl p-3 flex items-start gap-3 border transition-colors duration-300"
                         :class="quoteError === 'amount'
                            ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'
                            : 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10'">
                        <svg class="w-5 h-5 shrink-0 mt-0.5" :class="quoteError === 'amount' ? 'text-amber-500' : 'text-slate-400 dark:text-zinc-500'" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-bold" :class="quoteError === 'amount' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-zinc-200'">
                                {{ quoteError === 'amount' ? $t('swap.quoteAmountTooLarge') : quoteError === 'unknown' ? $t('swap.quoteFailed') : $t('swap.quoteNoRoute') }}
                            </span>
                            <span class="text-xs" :class="quoteError === 'amount' ? 'text-amber-600/80 dark:text-amber-300/70' : 'text-slate-500 dark:text-zinc-400'">
                                {{ quoteError === 'amount' ? $t('swap.quoteAmountTooLargeDesc') : quoteError === 'unknown' ? $t('swap.quoteFailedDesc') : $t('swap.quoteNoRouteDesc') }}
                            </span>
                        </div>
                    </div>

                    <GasTokenSelector
                        v-if="gasTokenOptions.length && !payWithAts"
                        v-model="gasToken"
                        :options="gasTokenOptions"
                        :native-symbol="network.currentNetwork.nativeCurrency.symbol"
                        :native-logo="network.currentNetwork.logoURI || `/chains/${network.currentNetwork.chainId}.png`"
                        :sent-asset-address="crypto.swap.inToken?.address"
                        :send-amount="inTokenAmount"
                    />

                    <!-- ATS ucret + komisyon karti — belge "Swap ve Bridge Komisyonu".
                         SECIM YOKTUR: ATS zincirinde ucret her zaman ATS ile odenir (Send
                         akisiyla ayni kural, bkz. atsFee.pickFeeBranch).
                         ROUND 1 REVIEW: bu kart ARTIK yalniz ATS-EVM'e ozel - TON'un kendi
                         fiyat karti ve engel karti ASAGIDA, AYRI bloklar (bulgu 1: fiyatsiz
                         bir TON karti gosterilmemeli; bulgu 4: TON'un engel karti fiyat
                         kartindan BAGIMSIZ gorunebilmeli - ikisi ayni kapta oldugu surece
                         biri digerini engelliyordu). -->
                    <div v-if="payWithAts" class="w-full rounded-xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 px-3 py-2.5 flex flex-col gap-1.5 transition-colors duration-300">
                        <!-- TEK SATIR, TEK SAYI. Gosterilen tutar `atsTotalDisplay` yani
                             ag ucreti x op sayisi + komisyon — bilesenler AYRI YAZILMAZ.
                             "en fazla" KALIR: ucret bir UST SINIRDIR (op basina onay tavani da
                             bu sayiya gore uygulanir), kesin tutar degil. -->
                        <div class="flex items-center justify-between gap-2">
                            <span class="flex items-center gap-2 min-w-0">
                                <img src="/ats.png" alt="ATS" class="w-4 h-4 rounded-full shrink-0 ring-1 ring-black/5 dark:ring-white/10">
                                <span class="text-xs font-semibold text-slate-700 dark:text-zinc-200 truncate">{{ $t('send.confirmTransaction.atsPaidWith', { symbol: atsSymbol }) }}</span>
                            </span>
                            <div v-if="atsLoading" class="h-4 w-20 bg-slate-100 dark:bg-zinc-800 rounded animate-pulse shrink-0"></div>
                            <span v-else-if="atsFee != null" class="text-xs shrink-0 whitespace-nowrap">
                                <span class="text-slate-400 dark:text-zinc-500">{{ $t('send.confirmTransaction.atsFeeUpTo') }}</span>
                                <span class="font-mono font-bold text-slate-800 dark:text-zinc-100 tabular-nums ml-1">{{ atsTotalDisplay }} {{ atsSymbol }}</span>
                            </span>
                        </div>

                        <span v-if="!atsLoading && atsFee != null" class="text-[10px] leading-tight text-slate-400 dark:text-zinc-500">{{ $t('send.confirmTransaction.atsPaidOnBsc', { symbol: atsSymbol }) }}</span>

                        <!-- ENGEL AYRI KART DEGIL, AYNI KARTIN ALT BOLUMU (ATS-EVM icin - bu
                             kural DEGISMEDI). Engel her zaman ucretle AYNI seyi anlatiyor ("bu
                             ucreti odeyecek ATS'niz yok / izniniz yok"); iki ayri kutuya bolmek,
                             ust kartta bir tutar gosterip hemen altinda onu odeyemeyecegini
                             soylemek oluyordu. `severity` renklendirmeyi surduruyor: 'user' ->
                             kehribar (eylem kullanicida), digerleri -> notr. 'internal' HIC
                             cizilmez (istemci hatasi). -->
                        <div v-if="atsDecision && !atsLoading && atsDecision.severity !== 'internal'"
                             class="flex flex-col gap-1.5 pt-2 border-t border-slate-100 dark:border-white/5">
                            <span class="flex items-start gap-1.5 text-xs font-bold"
                                  :class="atsDecision.severity === 'user'
                                     ? 'text-amber-600 dark:text-amber-400'
                                     : 'text-slate-700 dark:text-zinc-200'">
                                <svg class="w-3.5 h-3.5 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                <span>{{ $t(atsDecision.i18nKey, { symbol: atsSymbol }) }}</span>
                            </span>
                            <span v-if="atsDecision.action === 'run-onboarding'" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">
                                {{ $t(atsNextSteps.length > 1 ? 'send.confirmTransaction.atsOnboardingDesc' : 'send.confirmTransaction.atsBudgetLowDesc') }}
                            </span>
                            <span v-else-if="atsDecision.i18nDescKey" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(atsDecision.i18nDescKey) }}</span>
                            <button v-if="atsDecision.action === 'run-onboarding'"
                                    :disabled="atsLoading"
                                    class="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold disabled:opacity-50"
                                    @click="startAtsOnboarding">
                                {{ $t('send.confirmTransaction.atsOnboardingRun') }}
                            </button>
                        </div>
                    </div>

                    <!-- TON gasless UCRET KARTI BURADA YOKTUR ve BILEREK yoktur - eklenmesi
                         bir gerilemedir.

                         TAKAS RELAY YOLUNU HIC KULLANAMAZ. Sunucunun OLCULEN eylem
                         sozlesmesinde (tasarim 2.2) `kind` yalniz 'ton' ve 'jetton';
                         'swap'/'jetton-swap'/'dex' sunucu tarafinda REDDEDILIYOR. Dahasi bir
                         takas, DEX yonlendiricisine giden jetton govdesinde dolu bir
                         forward_payload ister - ne anlamsal eylem listesi onu ifade edebiliyor
                         ne de dogrulama kapisi acabiliyor (tonQuoteVerify/parseJettonBody dolu
                         forward_payload'da duser). Ayni gerekce tonFeeRelayer.js'in eylem
                         kapisinda da yazili.

                         Buradaki kart bu yuzden ULASILAMAZDI, kotu ayarlanmis degil: bu ekran
                         `tonFee.load`u yalniz { sender, tonWallet } ile cagirir (tonPublicKey
                         ve actions YOK), useTonFee o durumda teklife HIC gitmez ve
                         `atsMaxFee` kalici olarak null kalir - kartin kendi kapisi asla acilmaz.
                         Kapiyi "duzeltmek" (eksik alanlari doldurmak) ekrana odenmesi MUMKUN
                         OLMAYAN bir ucret yazdirirdi; dogru duzeltme kartin OLMAMASI.

                         ALTTAKI ENGEL KARTI KALIR: `useTonFee` teklif olmadan da bolge
                         durumunu (relayActive/statusUnreadable) okur ve bir /status kesintisi
                         bu ekranda hala kullaniciya soylenmelidir. -->

                    <!-- TON engel karti - ROUND 1 REVIEW BULGU 4: fiyat kartindan BAGIMSIZ bir
                         kart, cunku `tonFeeDecisionActive` fiyat hazir olmadan da (bolge
                         kapisi okunamadi - statusUnreadable) dogru olabilir. Bu ifade
                         ConfirmTransaction.vue'dakiyle HARFI HARFINE AYNI - "iki ekran ayni
                         sekilde kapılıyor" (kablolama testiyle kilitli). abort-unsafe/blocked
                         icin YENI DAL YOK, mesaj burada butonsuz cizilir. -->
                    <div v-if="tonFeeDecisionActive && feeDecision && !feeLoading && feeDecision.severity !== 'internal'"
                         class="w-full rounded-xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 px-3 py-2.5 flex flex-col gap-1.5 transition-colors duration-300">
                        <!-- KIRMIZI YALNIZ `blocked` icin (ConfirmTransaction.vue ile AYNI
                             kural): guvenlik reddi kimsenin cozemeyecegi durumdur ve
                             onceki `user ? amber : slate` onu SESSIZ bir gri yapiyordu.
                             `transient`/`operator` KEHRIBAR - bir /status ya da /quote
                             aksakligi calisan bir gonderimi durdurmuyor. -->
                        <span class="flex items-start gap-1.5 text-xs font-bold"
                              :class="feeDecision.severity === 'blocked'
                                 ? 'text-red-600 dark:text-red-400'
                                 : 'text-amber-600 dark:text-amber-400'">
                            <svg class="w-3.5 h-3.5 shrink-0 mt-px" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            <span>{{ $t(feeDecision.i18nKey, { symbol: atsSymbol }) }}</span>
                        </span>
                        <span v-if="feeDecision.action === 'run-onboarding'" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">
                            {{ $t(feeOnboardingDescKey) }}
                        </span>
                        <span v-else-if="feeDecision.i18nDescKey" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(feeDecision.i18nDescKey) }}</span>
                        <button v-if="feeDecision.action === 'run-onboarding'"
                                :disabled="feeLoading"
                                class="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold disabled:opacity-50"
                                @click="startTonOnboarding">
                            {{ $t('send.confirmTransaction.atsOnboardingRun') }}
                        </button>
                    </div>

                    <!-- §06.1 — ATS SATAN swap: bakiye - gaz ucreti - komisyon.
                         BACKEND BUNU DENETLEMEZ; asilirsa op zincirde AA33 ile duser ve gaz yanar. -->
                    <div v-if="payWithAts && atsCapExceeded" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex flex-col gap-1 transition-colors duration-300">
                        <span class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.atsCapTitle') }}</span>
                        <span class="text-xs text-red-500/80 dark:text-red-300/70">{{ $t('send.confirmTransaction.atsCapDesc', { amount: atsCapDisplay, symbol: atsSymbol }) }}</span>
                        <button class="self-start mt-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-semibold" @click="applyAtsCap">
                            {{ $t('send.confirmTransaction.atsCapApply', { amount: atsCapDisplay }) }}
                        </button>
                    </div>

                    <div v-if="payWithAts && atsError && (!atsDecision || atsDecision.severity === 'internal')" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex flex-col gap-1 transition-colors duration-300">
                        <span class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.atsQuoteFailedTitle') }}</span>
                        <span class="text-xs text-red-500/80 dark:text-red-300/70">{{ $t('send.confirmTransaction.atsQuoteFailedDesc') }}</span>
                    </div>

                    <!-- Pimlico gas-token kartlari YALNIZ ATS kolunun DISINDA. ATS ile odenirken
                         ne native gaz ne de secili fee-token konu disidir; gostermek kullaniciyi
                         var olmayan bir sorunu cozmeye iter. Send ekrani ayni korumayi
                         `!isAtsTransfer` ile yapiyor (ConfirmTransaction.vue). -->
                    <div v-if="!payWithAts && selectedInsufficient" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 transition-colors duration-300">
                        <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-bold text-red-600 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientToken') }}</span>
                            <span class="text-xs text-red-500/80 dark:text-red-300/70">{{ $t('send.confirmTransaction.insufficientGasTokenDesc', { symbol: crypto.swap.inToken?.symbol?.toUpperCase() }) }}</span>
                        </div>
                    </div>

                    <div v-if="insufficientBalance" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 animate-shake transition-colors duration-300">
                        <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-bold text-red-600 dark:text-red-400 transition-colors duration-300">{{ $t('swap.insufficientBalance') }}</span>
                            <span class="text-xs text-red-500/80 dark:text-red-300/70 transition-colors duration-300">
                                {{ $t('swap.insufficientBalanceDesc', { 
                                    amount: (inTokenAmount - inBalance).toFixed(4), 
                                    symbol: crypto.swap.inToken?.symbol?.toUpperCase() 
                                }) }}
                            </span>
                        </div>
                    </div>

                    <div v-if="!payWithAts && !insufficientBalance && insufficientGas && !gasToken" class="w-full rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 flex items-start gap-3 animate-shake transition-colors duration-300">
                        <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <div class="flex flex-col">
                            <span class="text-sm font-bold text-red-600 dark:text-red-400 transition-colors duration-300">{{ $t('swap.insufficientBalance') }} (Gas)</span>
                            <span class="text-xs text-red-500/80 dark:text-red-300/70 transition-colors duration-300">
                                {{ $t('swap.insufficientFeeBalanceDesc', {
                                    symbol: network.currentNetwork.nativeCurrency.symbol.toUpperCase()
                                }) }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="absolute bottom-5 left-0 w-full px-4 z-20">
                <!-- FIYAT ETKISI UYARISI. Sig havuzda buyuk emir, kullanicinin verdiginin cok
                     altinda bir cikti uretir - ve kayma korumasi (`min_ask_units`) bunu
                     ENGELLEMEZ, cunku o zaten dusmus fiyata gore hesaplanir. Bu yuzden
                     ACIK ONAY isteniyor; onay verilene kadar Takas dugmesi KILITLI.
                     Onay her yeni teklifte dusuyor (bkz. priceImpactAcknowledged). -->
                <div v-if="priceImpactHigh" class="mb-3 rounded-xl border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3">
                    <p class="text-[11px] font-bold text-amber-700 dark:text-amber-400">{{ $t('swap.priceImpactTitle') }}</p>
                    <p class="mt-1 text-[10px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">{{ $t('swap.priceImpactBody') }}</p>
                    <label class="mt-2 flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" v-model="priceImpactAcknowledged" class="accent-amber-600" />
                        <span class="text-[11px] font-bold text-amber-800 dark:text-amber-300">{{ $t('swap.priceImpactAck') }}</span>
                    </label>
                </div>

                <button 
                    class="w-full py-4 rounded-2xl font-bold text-base tracking-wide flex items-center justify-center gap-2 transition-all duration-300 shadow-md dark:shadow-lg"
                    :class="isValid() 
                        ? 'bg-linear-to-r from-indigo-600 to-purple-600 text-white hover:scale-[1.02] shadow-indigo-500/20 cursor-pointer' 
                        : 'bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-transparent dark:border-white/5'"
                    :disabled="!isValid()"
                    @click="swap"
                >
                    <div v-if="loading || swapLoading" class="flex items-center gap-2">
                        <svg class="w-5 h-5 animate-spin text-white/70" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-dasharray="16" stroke-dashoffset="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3c4.97 0 9 4.03 9 9"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.2s" values="160"/><animateTransform attributeName="transform" dur="1.5s" repeatCount="indefinite" type="rotate" values="0 12 12360 12 12"/></path></svg>
                        <span>{{ $t('swap.loading') }}</span>
                    </div>
                    <!-- Buton metni BLOKLAMA SEBEBINI soylemeli. ATS kolunda sebep cogu zaman
                         bakiye DEGILDIR (kurulum gerekli, /status hazir degil) ve "Yetersiz
                         Bakiye" yazmak kullaniciyi olmayan bir sorunu cozmeye — daha fazla ATS
                         almaya — iter. Ayni gerekce ConfirmTransaction.vue'daki confirmLabel'da.
                         Sebep artik `swapGuard.swapBlockReason`'dan gelir; sira ORADA baglayicidir
                         — `select-in-token` ATS dalindan ONCE. Bugun Polygon'da token secili
                         degilken buton "ATS ile gonderilemiyor" yaziyordu; oysa ATS teklifi hic
                         istenmemisti, sebep token secilmemis olmasiydi. -->
                    <span v-else-if="['insufficient-balance', 'ats-cap', 'insufficient-gas', 'fee-token-insufficient'].includes(blockReason)">{{ $t('swap.insufficientBalance') }}</span>
                    <!-- `ton-fee-blocked` AYNI metni alir: iki kolda da sebep bakiye DEGIL,
                         ucret yolunun su an kullanilamamasidir. Sebebin AYRINTISI zaten
                         yukaridaki TON engel kartinda yaziyor. -->
                    <span v-else-if="blockReason === 'ats-not-ready' || blockReason === 'ton-fee-blocked'">{{ $t('send.confirmTransaction.atsCannotSend') }}</span>
                    <span v-else-if="blockReason === 'select-in-token' || blockReason === 'select-out-token'">{{ $t('swap.selectToken') }}</span>
                    <span v-else-if="blockReason === 'unsupported-chain'">{{ $t('swap.unsupportedChain') }}</span>
                    <span v-else>{{ $t('swap.confirm') }}</span>
                </button>
            </div>
        </section>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ethers } from 'ethers'
import contract_addresses from '../data/contract_addresses.json'
import { networkStore } from '../store/network'
import { useTokenBalance } from '../composables/useTokenBalance'
import { isNativeAsset } from '../utils/nativeAsset'
import Back from './Back.vue'
import ChangeNetwork from './ChangeNetwork.vue'
import { preventInvalidKeys } from '../utils/preventInvalidKeys'
import { cryptoStore } from '../store/crypto'
import SwapFrom from './swap/swapFrom.vue'
import { popupStore } from '../store/popup'
import { pageStore } from '../store/pageStore'
import SwapTo from './swap/swapTo.vue'
import Settings from './swap/Settings.vue'
import { useTransactionStore } from '../store/transaction'
import { configStore } from '../store/config'
import { isGaslessChain } from '../utils/gaslessConfig'
import GasTokenSelector from './GasTokenSelector.vue'
import { useGasToken } from '../composables/useGasToken'
import { useAtsOpFee } from '../composables/useAtsOpFee'
import { useTonFee } from '../composables/useTonFee'
import { isAtsChain, getAtsConfig } from '../utils/atsConfig'
import { pickFeeBranch } from '../utils/atsFee'
import { clampToDecimals, isInsufficientBalance } from '../utils/swapValidation'
import { SEND_PERCENTS, percentAmount } from '../utils/sendPercent'
import { needsNativeReserve, reserveFromQuote, SWAP_GAS_FALLBACK, TON_SWAP_GAS_RESERVE } from '../utils/nativeReserve'
// Native varsayilan artik AGDAN gelmiyor; gerekce utils/nativeToken.js basinda.
import { reconcileSwapToken } from '../utils/swapTokenState'
import { isTon } from '../utils/chainKind'
import { getTonClient } from '../utils/ton/tonClient'
import { getTonBalance } from '../utils/ton/tonBalance'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { swapBlockReason } from '../utils/swapGuard'
// Motorun hata metinleri buraya chrome.runtime uzerinden yalniz STRING olarak gelir;
// sabitler swapRoutes.js'te (saf katman) durur ki iki taraf ayni metni tekrar yazmasin.
import { LIQUIDITY_GATE_ERROR, NO_ROUTE_ERROR } from '../utils/swapRoutes'
import { evmOnlyFeatures } from '../utils/evmGates'

const network = networkStore()
const crypto = cryptoStore()
const popups = popupStore()
const config = configStore()

// Slippage YÜZDE olarak saklanır: Settings hazır değerleri 0.5 ve 1.0, varsayılan
// seçim 0.5. Yedek değer 0.05 idi — Settings 0.5% gösterirken gerçekte 0.05%
// kullanılıyordu, yani ayarlara hiç girmemiş kullanıcı 10 kat dar toleransla
// işlem yapıyor ve router normal fiyat hareketinde bile revert ediyordu.
const DEFAULT_SWAP_SLIPPAGE = 0.5

const inTokenAmount = ref(0)
const swapData = ref(null)
// null | 'amount' (derinlik esigi) | 'route' (havuz yok). Tanimadigimiz hatalar burada
// null kalir: teklif yolu RPC hatasinda da patlayabiliyor ve ona "rota yok" demek yanlis
// bilgi vermek olur.
const quoteError = ref(null)

const isTonNetwork = computed(() => isTon(network.currentNetwork))

// FIYAT ETKISI ONAYI. Sig havuzda buyuk emir, kullanicinin verdiginin cok
// altinda bir cikti uretir - ve `minAskUnits` bunu ENGELLEMEZ, cunku o zaten
// dusmus fiyata gore hesaplanir. Yani kayma korumasi fiyat etkisine karsi
// KORUMAZ; kullanicidan ACIK onay istenir.
//
// Onay HER YENI TEKLIFTE dusurulur: onceki teklif icin verilen onay yenisine
// tasinirsa kapi hic sorulmadan acilmis olur (zehirli adres onayindaki ayni
// karar, useAddressSecurity.js).
const priceImpactAcknowledged = ref(false)

// Teklif fiyat etkisi esigi asiyor mu? Arka plan bunu `depthGateWarning` ile
// bildiriyor - esik degeri TEK YERDE (tonSwap.js MAX_PRICE_IMPACT) ve arayuz
// onu yeniden hesaplamiyor.
const priceImpactHigh = computed(() =>
    isTonNetwork.value && swapData.value?.depthGateWarning === true)
// null | 'unsupported-chain' | 'chain-mismatch' | 'foreign-asset'. Girdi tokeni cozulemediginde ekran
// bunu SOYLEMEK zorunda: eski davranis (undefined token + dolu bakiye satiri)
// kullaniciyi "token secili" sanmaya itiyordu.
const tokenNotice = ref(null)
const inBalance = ref(0)
const outBalance = ref(0)

const swapLoading = ref(false)
const loading = ref(false)
const balanceLoading = ref(false)
const insufficientGas = ref(false) // YENİ: Gas yetersizlik kontrol state'i
const activeAccount = ref(null)

const { gasToken, gasTokenOptions, selectedInsufficient, loadGasOptions } = useGasToken()

// --- ATS ile ode (swap/bridge komisyonu) ---------------------------------------------
//
// SECIM YOKTUR; ATS ZORUNLUDUR — kural Send akisiyla BIREBIR ayni (bkz. atsFee.pickFeeBranch:
// dapp degilse ve zincir ATS ise kosulsuz 'ats', native'e dusus yok).
//
// ONCE bir onay kutusu olarak yapilmisti; iki sebeple YANLISTI:
//   1. Ayni cuzdanda iki farkli kural olurdu (Send'de zorunlu, swap'ta istege bagli).
//   2. Kapali varsayilanla komisyon HIC toplanmazdi — belgenin butun amaci op basina
//      komisyon tahsil etmek; isaretlenmeyen bir kutuya bagli komisyon olu koddur.
//
// Bedeli acikca kabul ediliyor: ATS zincirlerinde ATS'si olmayan kullanici once kurulumu
// tamamlamak zorunda. Send bu bedeli ZATEN odetiyor; swap/bridge'i ayri tutmak tutarsizlikti.
//
// `fromDapp: false` SABIT: bu bilesen yalnizca kullanicinin kendi swap ekranidir. Dapp'in
// tetikledigi islemler buradan GECMEZ (background.js'teki gate gerekcesi).
const payWithAts = computed(() =>
  pickFeeBranch({ fromDapp: false, atsEnabled: isAtsChain(network.currentNetwork.chainId) }) === 'ats')
const {
  atsFee, atsSymbol, ready: atsReady, decision: atsDecision,
  nextSteps: atsNextSteps, loading: atsLoading, error: atsError, errorCode: atsErrorCode,
  commissionHuman, totalAtsCost, maxAtsSellRaw, exceedsAtsCap,
  load: loadAtsOpFee, runOnboarding: runAtsOnboardingOp, reset: resetAtsOpFee,
} = useAtsOpFee()

const atsConfig = computed(() => getAtsConfig(network.currentNetwork.chainId))
const atsDecimals = computed(() => atsConfig.value?.token?.decimals ?? 18)

const fmt = (n) => (n == null ? '—' : Number(n).toFixed(4).replace(/\.?0+$/, ''))
// Kart TEK SAYI gosterir: ag ucreti x op sayisi + komisyon. Bilesenleri ayri ayri bicimleyen
// `atsFeeDisplay`/`commissionDisplay` kaldirildi — dokum ekrandan cikinca olu koda dondu.
// (`totalAtsCost` carpimi da komisyonu da useAtsOpFee icinde yapiyor.)
const atsTotalDisplay = computed(() => fmt(totalAtsCost.value))

// Girdi tokeni ATS mi? §06.1 tavani YALNIZ o zaman anlamlidir — baska bir token satarken
// ATS bakiyesi yalnizca ucret+komisyon icin gerekir, swap miktarina girmez.
const sellingAts = computed(() => {
  const inAddr = crypto.swap.inToken?.address
  const atsAddr = atsConfig.value?.token?.address
  return !!inAddr && !!atsAddr && inAddr.toLowerCase() === atsAddr.toLowerCase()
})

const inAmountRaw = computed(() => {
  try { return ethers.parseUnits(String(inTokenAmount.value || 0), atsDecimals.value).toString() }
  catch { return null }
})

const atsCapExceeded = computed(() =>
  payWithAts.value && sellingAts.value && exceedsAtsCap(inAmountRaw.value))

const atsCapDisplay = computed(() => {
  if (maxAtsSellRaw.value == null) return '—'
  return fmt(ethers.formatUnits(BigInt(maxAtsSellRaw.value), atsDecimals.value))
})

// Tavani tek dokunusla uygula: kullaniciya "97'ye dus" deyip hesaplamayi ona birakmak,
// yuvarlama yuzunden tekrar tekrar ayni karti gormesi demekti.
const applyAtsCap = () => {
  if (maxAtsSellRaw.value == null) return
  inTokenAmount.value = ethers.formatUnits(BigInt(maxAtsSellRaw.value), atsDecimals.value)
}

const refreshAtsOpFee = async () => {
  if (!payWithAts.value) return
  if (!crypto.swap.inToken || !crypto.swap.outToken) return
  if (!inTokenAmount.value || Number(inTokenAmount.value) <= 0) return
  const { active_account, swap_slippage } = await chrome.storage.local.get(['active_account', 'swap_slippage'])
  await loadAtsOpFee({
    kind: 'swap',
    payload: {
      index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,
      chainId: network.currentNetwork.chainId,
      inTokenAddress: crypto.swap.inToken.address,
      outTokenAddress: crypto.swap.outToken.address,
      amount: String(inTokenAmount.value),
      slippage: swap_slippage || DEFAULT_SWAP_SLIPPAGE,
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

// --- TON gasless ucret onizlemesi (Task 8, spec 8) --------------------------
//
// `payWithAts` bu ekranda TON icin HIC true olmaz (isAtsChain TON chainId'sini
// taniMAZ) - TON'un kendi ucret kolu burada. ROUND 1 REVIEW: fiyat karti ve
// engel karti ARTIK AYRI bloklar (bulgu 1 + 4, template'teki notlara bakin).
// `tonFee` yalniz ONIZLER, imzalamaz/gondermez (bkz. useTonFee.js).
const tonFee = useTonFee()
const payWithTonFee = computed(() => isTonNetwork.value && tonFee.relayActive.value)

// ROUND 1 REVIEW BULGU 4: TON engel kartinin gorunurlugu ne cipilak
// `isTonNetwork`e (calisan bir self-pay'in yanina bile boyanirdi) ne de
// cipilak `payWithTonFee`ye (bir /status kesintisinde sessizce kaybolurdu -
// tam olarak bu ekranda yasanan hataydi) baglanir. ConfirmTransaction.vue'daki
// AYNI ifade, harfi harfine - kablolama testi bunu iki dosya arasinda
// kilitliyor.
const tonFeeDecisionActive = computed(() => isTonNetwork.value && (payWithTonFee.value || tonFee.statusUnreadable.value))

// TON'un karar/yukleme degiskenleri - ConfirmTransaction.vue'daki AYNI isimler
// ve AYNI formul (isTonNetwork'e gore dallanir, `payWithTonFee`ye DEGIL - bir
// /status kesintisinde `payWithTonFee` false olsa bile `tonFee.decision` yine
// de okunabilmeli). Yalniz asagidaki TON engel kartinda kullanilir; ATS-EVM
// karti kendi `atsDecision`/`atsLoading`/`atsNextSteps`'ini DOGRUDAN kullanir
// (yukarida, degismedi).
const feeDecision = computed(() => isTonNetwork.value ? tonFee.decision.value : atsDecision.value)
const feeLoading = computed(() => isTonNetwork.value ? (tonFee.loading.value || tonFee.onboarding.value) : atsLoading.value)

// TON relay kolunda ucret karari TAKAS BUTONUNU DA kilitler - EVM'deki `ats-not-ready`in
// karsiligi ve ConfirmTransaction.vue'daki `tonFeeBlocked` ile AYNI formul. Onceden
// yalniz KART ciziliyordu: buton acik kaliyor, gonderim sessizce self-pay'e dusuyor ve
// gasless soylenmisken kullanicinin KENDI TON'u yaniyordu (2026-09-01).
// 'internal' DISLANIR: o aile kartta da cizilmez (yukaridaki kartin AYNI kurali) ve
// gorunmeyen bir sebeple kilitlenen buton aciklamasi olmayan olu bir butondur.
const tonFeeBlocked = computed(() =>
  tonFeeDecisionActive.value && feeDecision.value != null && feeDecision.value.severity !== 'internal')
// TON'un kendi `nextSteps` sayisi YOK (onboarding'i dogrudan BSC'de calistirir,
// bir adim listesi onizlemez) - daha kapsamli aciklama guvenli varsayilan.
const feeOnboardingDescKey = computed(() => isTonNetwork.value
  ? 'send.confirmTransaction.atsOnboardingDesc'
  : (atsNextSteps.value.length > 1 ? 'send.confirmTransaction.atsOnboardingDesc' : 'send.confirmTransaction.atsBudgetLowDesc'))

// TON agindayken YALNIZ BOLGE DURUMUNU (relayActive/statusUnreadable) yukler/tazeler.
//
// `tonPublicKey` ve `actions` BILEREK GECILMEZ: useTonFee o ikisi olmadan /quote'a
// HIC gitmez, yani bu ekran TEKLIF ISTEMEZ. Sebep, unutulmus bir alan degil - TAKAS
// RELAY YOLUNU KULLANAMAZ (sunucunun eylem sozlesmesinde takas turu yok; yukarida,
// kaldirilan ucret kartinin yerindeki notta ayrintili). Buraya alan eklemek ekrana
// odenmesi mumkun olmayan bir ucret yazdirirdi.
//
// `active_account` HER cagrida DEPODAN TAZE okunur (getSwapData'daki AYNI desen) -
// `activeAccount.value` (setup aninda bir kez atanan yerel kopya) ensureTonAddress'in
// yazdigi tonAddress/tonAddressTestnet onbellegini HIC GORMEZ; bu ekran uzun omurlu
// oldugu icin (ag degistirmede unmount OLMAZ) bayat kopyayla her seferinde TAM
// turetme (PBKDF2+SLIP10) calisirdi.
const refreshTonFee = async () => {
  if (!isTonNetwork.value) { tonFee.stop(); return }
  try {
    const { active_account } = await chrome.storage.local.get('active_account')
    if (!active_account) return
    const tonWallet = await ensureTonAddress(active_account, {
      testnet: Boolean(network.currentNetwork?.testnet),
    })
    await tonFee.load({ sender: active_account.address, tonWallet })
  } catch (e) {
    console.error('TON ucret onizlemesi basarisiz:', e.message)
  }
}

// ATS onboarding HER ZAMAN BSC'de (tonFee.runOnboarding ATS_SRC_CHAIN_ID
// kullanir, TON'un kendi chainId'si DEGIL) - startAtsOnboarding'in TON karsiligi.
const startTonOnboarding = async () => {
  const { active_account } = await chrome.storage.local.get('active_account')
  await tonFee.runOnboarding({
    address: active_account.address,
    index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,
  })
}

// Ag degisince kol da degisir. ATS koluna GIRERKEN Pimlico secimi temizlenir (ikisi de ayni
// op'u sponsorlamaya calisir); ATS kolundan CIKARKEN eski teklif ekranda ASILI KALMAMALI —
// baska bir agda odenmeyecek bir ATS ucreti gostermek kullaniciyi yaniltir.
watch(payWithAts, async (on) => {
  if (!on) return resetAtsOpFee()
  gasToken.value = null
  await refreshAtsOpFee()
}, { immediate: true })

// Yetersiz bakiye ELLE atanmaz, miktar ve bakiyeden türetilir. Elle atandığında
// token değiştirildikten sonra karar "yeterli"de takılı kalıyordu (bkz.
// utils/swapValidation.js). Bakiye yüklenirken kırmızı uyarı gösterilmez;
// gönderimi isValid() ayrıca engeller.
// UCRET PAYI. Yalniz native verilirken ve ucret gercekten native'den
// odenirken ayrilir (needsNativeReserve); ATS ya da gas-tokeni kolunda pay
// ayirmak, hedef kitlesi zaten native'i OLMAYAN kullaniciyi engellerdi.
const swapReserve = async () => {
    const isNativeIn = isNativeAsset(crypto.swap.inToken?.address)
    if (!needsNativeReserve({ isNativeIn, gasToken: gasToken.value, payWithAts: payWithAts.value })) return 0

    // Canli teklif varsa ONUN tahmini kullanilir: takasin gaz maliyeti duz
    // transferin kat kat ustunde ve rotaya gore degisiyor, sabit bir sayi
    // buradaki her zinciri birden yanlis tahmin ederdi.
    const quoted = reserveFromQuote(swapData.value?.estimatedGasFee?.totalCost)
    if (quoted > 0) return quoted

    // Teklif HENUZ YOK - MAX'a ilk basista olan budur. Ihtiyatli sabite dusulur.
    if (isTonNetwork.value) return TON_SWAP_GAS_RESERVE

    try {
        const provider = new ethers.JsonRpcProvider(network.rpc)
        const feeData = await provider.getFeeData()
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
        if (!gasPrice) throw new Error('gas fiyati okunamadi')
        return Number(ethers.formatEther(BigInt(SWAP_GAS_FALLBACK) * BigInt(gasPrice)))
    } catch (e) {
        // Gaz fiyati okunamadi: oransal paya dusulur. Pay AYIRMAMAK, duzeltilen
        // cikmaza geri donmek olurdu.
        console.warn('Takas gaz payi tahmin edilemedi:', e.message)
        return Number(inBalance.value) * 0.01
    }
}

const setPercent = async (percent) => {
    const decimals = crypto.swap.inToken?.decimals ?? 18

    // clampToDecimals bu ekranin parseUnits oncesi SON kapisi (ustel gosterim +
    // fazla ondalik). Yuzde sonucu da ondan geciyor ki ikinci bir bicimlendirme
    // yolu dogmasin.
    inTokenAmount.value = clampToDecimals(
        percentAmount({ balance: inBalance.value, reserve: await swapReserve(), percent, decimals }),
        decimals,
    )
}

const insufficientBalance = computed(() =>
    !balanceLoading.value && isInsufficientBalance(inTokenAmount.value, inBalance.value)
)

// Art arda token değiştirmede geç dönen eski isteğin yeni bakiyeyi ezmemesi için.
let balanceRequestId = 0

const loadInBalance = async (tokenAddress) => {
    const requestId = ++balanceRequestId
    balanceLoading.value = true
    try {
        const balance = await useTokenBalance(activeAccount.value?.address, tokenAddress, network.rpc)
        if (requestId !== balanceRequestId) return // daha yeni bir istek var, bunu yok say
        inBalance.value = balance
    } catch (error) {
        console.error('inBalance okunamadi:', error.message)
        if (requestId === balanceRequestId) inBalance.value = 0
    } finally {
        if (requestId === balanceRequestId) balanceLoading.value = false
    }
}

let swapInterval
// R18: miktar watcher'i her tus vurusunda calisiyordu, tek teklif onlarca RPC
// cagrisi yapabiliyor. Dort agda TEK RPC uc noktasi var ve failover yok; 429
// findBestDexRoute'un aday-basina catch'ine dusup adayi sessizce null yapiyor,
// yani hiz siniri "likidite yok" ile ayirt edilemez hale geliyordu. Debounce
// yalniz yazma durunca bir sorgu gitmesini saglar, 10sn periyodik yenilemeye
// dokunmaz.
let quoteDebounceTimer = null

const txStore = useTransactionStore()

const getSwapData = async () => {
    try {
        if (!inTokenAmount.value || Number(inTokenAmount.value) <= 0) {
            quoteError.value = null
            return swapData.value = null
        }
        swapLoading.value = true
        insufficientGas.value = false // Sorgu başlarken resetle
        quoteError.value = null

        const { active_account, swap_slippage } = await chrome.storage.local.get(['active_account', 'swap_slippage'])

        const message = { index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath, chainId: network.currentNetwork.chainId, inTokenAddress: crypto.swap.inToken.address, outTokenAddress: crypto.swap.outToken.address, amount: String(inTokenAmount.value), slippage: swap_slippage || DEFAULT_SWAP_SLIPPAGE }

        // TON'un teklif yolu EVM'inkinden iki sey daha istiyor ve IKISI DE
        // ZORUNLU:
        //   - ondaliklar: TON'da zincirden okunacak bir ERC20.decimals() yok,
        //     token kaydindan gelir. VARSAYILANI YOK - jettonlar 9 ondalik
        //     degildir (USDT-TON 6) ve bir varsayilan gosterilen ciktiyi 1000
        //     kat yanlis yapardi.
        //   - apiBase: teklif kendi sunucumuzdan proxy'leniyor.
        if (isTonNetwork.value) {
            message.inDecimals = crypto.swap.inToken?.decimals
            message.outDecimals = crypto.swap.outToken?.decimals
            message.apiBase = config.api
        }

        const data = await chrome.runtime.sendMessage({ type: 'SWAP_QUOTE', message })

        // Motor hatasi: background sendResponse({ error }) donuyor ve bu dal bugune kadar
        // hic okunmuyordu — ekranda yalnizca 0.00 kaliyordu. Iki BILINEN sebep ayirt edilir;
        // metin getExpectedOutput tarafindan sarmalandigi icin icerik esleşmesi kullanilir.
        if (data?.error) {
            swapData.value = null
            // TON MAKINE ANAHTARI kullaniyor, EVM ise serbest INGILIZCE METIN ve
            // arayuz onu `includes()` ile ayirt ediyor. Iki konvansiyon ayni
            // alanda bulusamaz, bu yuzden `code` EK bir alan olarak tasiniyor ve
            // ONCE ona bakiliyor. EVM kolu `code` yazmiyor - davranisi degismiyor.
            if (data.code === 'TON_SWAP_NO_ROUTE') quoteError.value = 'route'
            else if (data.code) {
                console.error('TON takas teklifi alinamadi:', data.code, data.error)
                quoteError.value = 'unknown'
            }
            else if (data.error.includes(LIQUIDITY_GATE_ERROR)) quoteError.value = 'amount'
            else if (data.error.includes(NO_ROUTE_ERROR)) quoteError.value = 'route'
            else {
                // Tanimadigimiz hata: sebebini bilmedigimiz icin "rota yok" DEMEYIZ,
                // ama sessiz de kalmayiz — eskiden ekranda yalnizca 0.00 kaliyordu.
                console.error('Swap teklifi alinamadi:', data.error)
                quoteError.value = 'unknown'
            }
            return
        }

        swapData.value = data.data
        // Yeni teklif -> onceki onay DUSER (yukaridaki gerekce).
        priceImpactAcknowledged.value = false

        // --- FEE BALANCE (GAS) KONTROLÜ ---
        if (swapData.value && swapData.value.estimatedGasFee && isTonNetwork.value) {
            // TON EVM DEGIL: `network.rpc` TON'da null ve ethers v6
            // JsonRpcProvider(null) SESSIZCE localhost:8545'e duser - kullaniciya
            // gorunmeyen, hicbir zaman cevap vermeyecek bir ag cagrisi. Bakiye
            // TON istemcisinden okunur.
            //
            // Native TON verilirken MIKTAR + GAZ ayni bakiyeden cikar; jetton
            // verilirken yalnizca gaz. Arka plandaki KAPI 6 ile ayni kural -
            // burasi onun GORUNUR yuzu, yerine gecmiyor.
            try {
                const tonAddress = await ensureTonAddress(active_account, {
                    testnet: Boolean(network.currentNetwork?.testnet),
                })
                const tonBal = await getTonBalance(getTonClient(config.api), tonAddress)
                const gasCost = Number(swapData.value.estimatedGasFee.totalCost || 0)
                const needed = isNativeAsset(crypto.swap.inToken.address)
                    ? Number(inTokenAmount.value) + gasCost
                    : gasCost
                insufficientGas.value = tonBal < needed
            } catch (e) {
                // FAIL-CLOSED: bakiye okunamadiysa yeterli oldugunu BILMIYORUZ.
                // Bir RPC/kasa hiccup'i takas dugmesini ACMAMALI.
                console.error('TON bakiye kontrolu basarisiz:', e.message)
                insufficientGas.value = true
            }
        } else if (swapData.value && swapData.value.estimatedGasFee) {
            const provider = new ethers.JsonRpcProvider(network.rpc)
            const nativeBalWei = await provider.getBalance(active_account.address)
            const nativeBal = Number(ethers.formatEther(nativeBalWei))
            
            // Tahmini gas maliyetini number formatında al
            const gasCost = Number(swapData.value.estimatedGasFee.totalCost || 0)
            
            // Native mi? KENDI listesini tutma — `isNativeAsset` projedeki tek dogru kapi.
            // Buradaki elle yazilmis kiyas '0x0'i TANIMIYORDU ve varsayilan girdi tokeni artik
            // tam olarak o adresi tasiyor (buildNativeToken). Sonuc: on zincirin hepsinde
            // native takas ERC20 dalina dusuyor, yani "miktar + gaz" yerine yalniz "gaz"
            // denetleniyordu. MAX ile takasta buton yesil kaliyor, islem zincirde
            // "insufficient funds for gas * price + value" ile duser ve gaz yanar.
            const isNativeIn = isNativeAsset(crypto.swap.inToken.address)

            if (isNativeIn) {
                // Eğer Native veriyorsak toplam ihtiyaç (Giden Miktar + Gas) bakiyeyi geçemez
                if (nativeBal < (Number(inTokenAmount.value) + gasCost)) {
                    insufficientGas.value = true
                }
            } else {
                // Eğer farklı bir token veriyorsak sadece gas parası var mı diye bakıyoruz
                if (nativeBal < gasCost) {
                    insufficientGas.value = true
                }
            }
        }

        // GASLESS: bu zincirde fee-token secenekleri (kesif yalniz inToken/chain degisince yapilir).
        // GASLESS bir EVM paymaster akisi; TON'da kavram yok ve isGaslessChain
        // negatif zincir kimligini tanimiyor. Acikca disariyor ki ileride o liste
        // degisse bile TON o yola girmesin.
        if (!isTonNetwork.value && isGaslessChain(network.currentNetwork.chainId)) {
            await loadGasOptions({
                chainId: network.currentNetwork.chainId,
                address: active_account.address,
                bundlerBase: config.bundlerBase,
                sentAsset: {
                    address: crypto.swap.inToken.address,
                    symbol: crypto.swap.inToken.symbol,
                    decimals: crypto.swap.inToken.decimals,
                    image: crypto.swap.inToken.image,
                },
                sendAmount: inTokenAmount.value,
                nativeInsufficient: insufficientGas.value,
            })
        }

    } catch (error) {
        // RPC/mesajlasma hatasi da SESSIZ OLMEZ: kullanici 0.00 gorup miktarin
        // sorun oldugunu saniyordu. Sebep bilinmiyor -> 'unknown' karti.
        console.error('Swap hatası:', error)
        swapData.value = null
        quoteError.value = 'unknown'
    } finally {
        swapLoading.value = false
    }
}

// Girdi tokeni ile AKTIF ZINCIRI uzlastirir. Eski hali uzak `POST /getTokenByName`
// cagiriyordu; ad ucuncu tarafin mulkiyetinde oldugu icin Polygon'da 404 doner ve
// `crypto.swap.inToken` SESSIZCE `undefined` kalirdi (buton bos, bakiye satiri dolu).
// Karar artik saf katmanda: utils/swapTokenState.js.
const ensureSwapInToken = () => {
    const chainId = network.currentNetwork?.chainId
    const { token, reason } = reconcileSwapToken(crypto.swap.inToken, chainId)
    crypto.swap.inToken = token
    tokenNotice.value = (reason === 'seeded' || reason === null) ? null : reason

    // KESIN uyusmazlikta token ekranda ASILI KALMAZ: bu zincirin native'i ile tohumlanir,
    // boylece kullanici bos bir butonla bas basa birakilmaz. 'chain-suspect' BURAYA
    // GIRMEZ — orada kesinlik yok (ayni adres birden cok zincirde gecerli olabiliyor),
    // token korunur ve yalnizca uyari basilir.
    if (reason === 'chain-mismatch' || reason === 'foreign-asset') {
        const seeded = reconcileSwapToken(null, chainId)
        crypto.swap.inToken = seeded.token
        // SEBEP GOSTERILIR. Tohum kullaniciyi bos butonla birakmiyor ama sessizce baska bir
        // token koymak da yaniltici: Home'dan Arbitrum USDC'ye basip Takas'ta POL bulan
        // kullanici NEDEN oldugunu goremiyordu. Kart degil tek satir — takas yine yapilabilir.
        // Sebep KORUNUR: 'foreign-asset' "baska bir agda" DEGIL, "cuzdanin desteklemedigi
        // bir agda" demektir; ayni metni basmak yanlis yonlendirir.
        tokenNotice.value = seeded.token ? reason : 'unsupported-chain'
    }
    // Bakiye ELLE cagrilmaz: `watch(crypto.swap.inToken)` zaten loadInBalance yapiyor.
}

onMounted(async() => {
    const { active_account } = await chrome.storage.local.get('active_account')
    activeAccount.value = active_account

    // SIRA ONEMLI: tohum `activeAccount` ATANDIKTAN SONRA calisir. Once calissaydi
    // (or. `{ immediate: true }` bir izleyiciyle) `useTokenBalance(undefined, …)`
    // reject eder, `inBalance` 0'a duser ve `inToken` bir daha degismedigi icin
    // bakiye HIC tazelenmezdi.
    ensureSwapInToken()
    if (crypto.swap.inToken) await loadInBalance(crypto.swap.inToken.address)
    await refreshTonFee()
})

// IKINCI KOK NEDEN: ChangeNetwork bu ekranin ICINDE duruyor ve applyNetworkChange
// swap secimlerini null'a cekiyor. onMounted bir daha calismadigi icin buton
// bosaliyor, bakiye satiri onceki zincirin BAYAT degerini gosteriyordu.
// `immediate` YOK: setup aninda `activeAccount` henuz null olurdu (yukaridaki not).
watch(() => network.currentNetwork?.chainId, async () => {
    // Eski miktar farkli decimals'li yeni tokene TASINMAZ; bayat teklif de silinir.
    inTokenAmount.value = ''
    quoteError.value = null
    swapData.value = null
    ensureSwapInToken()
    // TON disina cikildiysa onceki bolgenin sessiz tazelemesi DURUR (asagidaki
    // refreshTonFee kendi icinde tonFee.stop() cagirir) - baska bir agdayken
    // arka planda TON /status'una gitmeye devam etmenin bir anlami yok.
    await refreshTonFee()
})

// UCUNCU KOK NEDEN: Home.vue'nun Swap dugmesini gizlemesi bu ekrandan CIKMAYA
// engel degil -- yukaridaki ChangeNetwork bilesenin TAM ICINDE, oradan Solana
// secilebilir. `tokenNotice = 'unsupported-chain'` (reconcileSwapToken/buildNativeToken)
// zaten cokmeyi engelliyordu ama ekran ACIK, dugme SADECE devre disi kalirdi --
// arayuzun her yerde uyguladigi "v-if, disabled degil" ilkesini (bkz. evmGates.js)
// tam da bu ekranda bozardi. Zincir EVM olmaktan cikinca ekran KENDINI kapatir.
//
// `immediate: true`: bugun bu ekrana YALNIZ Home/Token'in gizlenen dugmeleriyle
// girilebiliyor (ikisi de EVM'de acik), yani baslangicta Solana aktifken buraya
// dusmek reel bir yol degil -- ama ucuz bir ikinci savunma katmani: yarin baska
// bir kod yolu (ornegin sayfa durumunun geri yuklenmesi) `currentPage`'i EVM
// kontrolsuz 'swap'a yazarsa bu satir ekrani YINE de kapatir.
watch(() => network.currentNetwork, (chain) => {
    if (!evmOnlyFeatures(chain).swap) pageStore().currentPage = 'home'
}, { deep: true, immediate: true })

// Bloklama KARARLARI degismedi; degisen tek sey sebebin ADLANDIRILMASI. Sira
// utils/swapGuard.js'te ve orada BAGLAYICIDIR — 'select-in-token' ATS dalindan
// ONCE gelir, cunku token secili degilken "ATS ile gonderilemiyor" yazmak yalandi
// (refreshAtsOpFee token yoksa hic calismiyor, atsReady false'ta cakiliyor).
const blockReason = computed(() => swapBlockReason({
    chainSupported: tokenNotice.value !== 'unsupported-chain',
    inToken: crypto.swap.inToken,
    outToken: crypto.swap.outToken,
    amount: inTokenAmount.value,
    balanceLoading: balanceLoading.value,
    insufficientBalance: insufficientBalance.value,
    loading: loading.value,
    swapLoading: swapLoading.value,
    payWithAts: payWithAts.value,
    atsLoading: atsLoading.value,
    atsReady: atsReady.value,
    atsCapExceeded: atsCapExceeded.value,
    insufficientGas: insufficientGas.value,
    gasToken: gasToken.value,
    selectedInsufficient: selectedInsufficient.value,
    tonFeeBlocked: tonFeeBlocked.value,
}))

// Fiyat etkisi kapisi swapBlockReason'a EKLENMEDI bilerek: o saf katman EVM ve
// TON'un ORTAK kurallarini tutuyor ve TON'a ozel bir kavrami oraya koymak, EVM
// tarafinda hicbir zaman tetiklenmeyecek olu bir dal birakirdi. Kapi burada,
// ayni ve tek `isValid` cikisinda.
const isValid = () => blockReason.value === null
    && !(priceImpactHigh.value && !priceImpactAcknowledged.value)

watch(() => [crypto.swap.inToken, crypto.swap.outToken, inTokenAmount.value], () => {
    if(!inTokenAmount.value || Number(inTokenAmount.value) <= 0) return
    // R18: 400ms debounce — yalniz kullanici yazmayi bir an durdurunca sorgu gider.
    if (quoteDebounceTimer) clearTimeout(quoteDebounceTimer)
    quoteDebounceTimer = setTimeout(async() => {
        quoteDebounceTimer = null
        // insufficientBalance burada ELLE atanmıyordu: bu watcher yeni token'ın bakiyesi
        // yüklenmeden çalıştığı için ESKİ bakiyeye göre karar veriyordu. Artık computed.
        await getSwapData()
        // ATS teklifi de miktarla birlikte tazelenir: gaz tahmini cagrilarin KENDISINDEN turer,
        // yani miktar degisince ucret de degisir. Bayat bir ucret gostermek, gonderim aninda
        // assertQuoteWithinApproval'in islemi durdurmasi demektir.
        await refreshAtsOpFee()
        if(!swapInterval) swapInterval = setInterval(async() => {
            await getSwapData()
            await refreshAtsOpFee()
        }, 10000)
    }, 400)
})

watch(() => crypto.swap.outToken, async() => {
    try {
        if(!crypto.swap.outToken) return
        let out_token_address
        if(crypto.swap.outToken.address) out_token_address = crypto.swap.outToken.address
        else {
            out_token_address = contract_addresses[crypto.swap.outToken.uuid]?.[network.currentNetwork.chainId]
            if (!out_token_address && contract_addresses[crypto.swap.outToken.uuid]) out_token_address = '0x0'
        }
        outBalance.value = await useTokenBalance(activeAccount.value?.address, out_token_address, network.rpc)
    } catch (error) { console.error(error.message) }
})

// UYARI BAYAT KALMAZ. Kullanici uyariyi okuyup DOGRU tokeni sectiginde sebep gecerliligini
// yitirir; ama `tokenNotice` yalnizca `ensureSwapInToken` icinde yaziliyordu ve o, token
// null OLMADIGI icin bu yolda kosmuyor. Sonuc: USDC secili dururken ekran hala
// "sectiginiz token baska bir agda" diyordu. Kullanicinin ELIYLE yaptigi her token
// degisimi uyariyi dusurur; gecerliyse ensureSwapInToken zaten yeniden yazar.
watch(() => crypto.swap.inToken, async() => {
    // TOHUM "inToken BOSALDI" olayina da baglidir, yalniz chainId'ye degil:
    // applyNetworkChange once agi degistirir, SONRA (iki await sonra) swap
    // secimlerini null'a ceker. chainId izleyicisi araya girip tohumlasa bile o
    // null yazimi tohumu silecek ve buton yine bosalacakti. Iki olaya birden
    // baglanmak sirayi onemsiz kilar.
    // Sonsuz dongu yok: desteklenmeyen zincirde null'a null yazilir, degisim olmaz.
    // onUnmounted'daki null bunu tetiklemez — bilesenin effect scope'u unmount
    // sirasinda hook'lardan ONCE durduruluyor.
    if(!crypto.swap.inToken) {
        ensureSwapInToken()
        return
    }

    // Token DEGISTI ve dolu: onceki sebep artik konu disi.
    tokenNotice.value = null

    let in_token_address
    if(crypto.swap.inToken.address) in_token_address = crypto.swap.inToken.address
    else {
        in_token_address = contract_addresses[crypto.swap.inToken.uuid]?.[network.currentNetwork.chainId]
        if (!in_token_address && contract_addresses[crypto.swap.inToken.uuid]) in_token_address = '0x0'
    }

    insufficientGas.value = false
    await loadInBalance(in_token_address)
})

onUnmounted(() => {
    if(swapInterval) clearInterval(swapInterval)
    // R18: bekleyen debounce, bilesen kaldirildiktan SONRA ates alip yikilmis bir
    // bilesene karsi getSwapData/refreshAtsOpFee calistirmasin diye temizlenir.
    if(quoteDebounceTimer) clearTimeout(quoteDebounceTimer)
    // tonFee.load()'un 60sn'lik sessiz tazeleme zamanlayicisi (bkz. useTonFee.js)
    // - bilesen kapandiktan SONRA ates almasin diye durdurulur.
    tonFee.stop()
    crypto.swap.inToken = null
    crypto.swap.outToken = null
})

const swap = async() => {
    try {
        // isValid() artik gasless kosullarini da iceriyor; elle tekrarlamak yerine
        // tek kapidan gecilir (buton disabled olsa bile bu yol cagrilabilir).
        if(!isValid()) return
        loading.value = true
        // null'a çekilmezse eski (temizlenmiş) id truthy kaldığı için watcher
        // `if(!swapInterval)` koşulunu bir daha geçemiyor: bir Onayla tıklamasından
        // sonra 10 saniyelik teklif yenilemesi bileşen ömrü boyunca ölü kalıyordu.
        clearInterval(swapInterval)
        swapInterval = null

        const { swap_slippage, active_account } = await chrome.storage.local.get(['swap_slippage', 'active_account'])

        const message = { index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath, chainId: network.currentNetwork.chainId, inTokenAddress: crypto.swap.inToken.address, outTokenAddress: crypto.swap.outToken.address, amount: String(inTokenAmount.value), slippage: swap_slippage || DEFAULT_SWAP_SLIPPAGE }

        // ATS: ucret + komisyon ATS ile. Bayrak background.js'teki kapiyi acan TEK seydir;
        // Pimlico dalindan ONCE degerlendirilir ve ikisi ayni anda gonderilmez.
        if (payWithAts.value && isAtsChain(network.currentNetwork.chainId)) {
            message.atsSwap = true
            // Onay aninda ekranda YAZAN ucret: executeAtsTransfer bunu ust sinir olarak
            // kullanir (assertQuoteWithinApproval) ve gonderim anindaki taze teklif bunu
            // asarsa islemi IMZADAN ONCE durdurur.
            // Komisyon da onaya GIRER: /sponsor spoke zincirde ucret + komisyonu TEK alanda
            // tahsil eder, tavan yalniz ucretten kurulursa her komisyonlu op patlar.
            message.atsQuoted = { transferFee: atsFee.value, commissionFee: commissionHuman.value }
        } else if (gasToken.value && isGaslessChain(network.currentNetwork.chainId)) {
            // GASLESS: secili fee-token varsa ve zincir destekliyorsa token ile gas
            message.gasToken = gasToken.value
            message.bundlerBase = config.bundlerBase
        }

        // TON: kapilar (tazelik, cift eslesmesi) TEKLIF NESNESI olmadan calisamaz.
        // Ondaliklar burada da ZORUNLU - gonderilen miktarin ham birime cevrimi
        // onlara bagli.
        if (isTonNetwork.value) {
            message.tonQuote = swapData.value?.tonQuote
            message.inDecimals = crypto.swap.inToken?.decimals
            message.outDecimals = crypto.swap.outToken?.decimals
            message.apiBase = config.api
            // Fiyat etkisi onayi KULLANICIDAN gelir. Sabit true gecilseydi kapi
            // olurdu; false gecilseydi kullanici onaylasa bile takas durur.
            message.priceImpactAcknowledged = priceImpactAcknowledged.value
        }

        await chrome.runtime.sendMessage({ type: 'SWAP', message })

        // ISLEM GONDERILDI -> ANA SAYFA. Send (ConfirmTransaction) ve Bridge zaten boyle
        // davraniyordu; Swap yaniti hic okumuyor ve ekranda kaliyordu, yani kullanici
        // gonderdigi takasin ne oldugunu goremiyordu.
        //
        // KOSULSUZ, cunku sonucun asil yeri ana sayfadaki ISLEMLER paneli: arka plan
        // `updateTxStatus` ile durumu oraya yaziyor (queued/processing/success/error) ve
        // basarisiz bir op orada sebebiyle birlikte gorunuyor. Burada kalmak, o paneli
        // gormeyi geciktirmekten baska bir sey yapmiyordu.
        //
        // Not: arka plan `resolve`'u islem ZINCIRE GONDERILDIGINDE dusuyor, makbuz
        // beklenmeden — yani "tamamlandi" burada "gonderildi" demektir. Makbuz sonucu
        // yine panele yaziliyor.
        pageStore().currentPage = 'home'
    } catch (error) {
        console.error('swap error', error.message)
    } finally {
        loading.value = false
    }
}

const reverse = () => {
    const in_token = crypto.swap.inToken
    const out_token = crypto.swap.outToken
    crypto.swap.inToken = out_token
    crypto.swap.outToken = in_token
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