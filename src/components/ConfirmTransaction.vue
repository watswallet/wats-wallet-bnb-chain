<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-emerald-500/5 dark:from-emerald-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-2 relative z-10">
            <Back v-if="!from_dapp" page="send" class="hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('send.confirmTransaction.title') }}</h1>
        </div>

        <div class="flex-1 min-h-0 px-5 pt-2 flex flex-col gap-4 relative overflow-y-auto custom-scrollbar pb-24 z-10">
            
            <div v-if="from_dapp" class="shrink-0 flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-lg transition-colors duration-300">
                <img :src="logo || '/default-dapp.png'" class="w-5 h-5 rounded-full border border-slate-200 dark:border-transparent" @error="e => { e.target.onerror = null; e.target.src = '/default-dapp.png' }">
                <div class="flex flex-col overflow-hidden">
                    <span class="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold uppercase tracking-wider">{{ $t('send.confirmTransaction.source') }}</span>
                    <span class="text-xs text-slate-700 dark:text-white truncate font-medium transition-colors duration-300">{{ url }}</span>
                </div>
            </div>

            <div class="shrink-0 flex flex-col items-center gap-2 py-1">
                <div class="relative">
                    <div class="absolute inset-0 bg-emerald-500/10 dark:bg-emerald-500/20 blur-xl rounded-full transition-colors duration-300"></div>
                    <img
                        :src="sentAssetLogo"
                        :alt="crypto.sendAsset?.name"
                        class="relative w-12 h-12 rounded-full shadow-lg dark:shadow-2xl border-2 border-white dark:border-white/10 bg-slate-100 dark:bg-zinc-900 transition-colors duration-300"
                        @error="e => { e.target.onerror = null; e.target.src = '/default-token.png' }"
                    >
                </div>

                <div class="text-center">
                    <h2 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300 break-all px-2">-{{ crypto.transactionData.amount }} {{ crypto.sendAsset?.symbol?.toUpperCase() }}</h2>
                </div>
            </div>

            <div class="shrink-0 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm dark:shadow-lg transition-colors duration-300">
                <div class="p-3.5 flex flex-col gap-3">
                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.asset') }}</span>
                        <div class="flex items-center gap-1.5">
                            <img :src="sentAssetLogo" class="w-4 h-4 rounded-full" @error="e => { e.target.onerror = null; e.target.src = '/default-token.png' }">
                            <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold transition-colors duration-300">{{ crypto.sendAsset?.symbol?.toUpperCase() }}</span>
                        </div>
                    </div>

                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.network') }}</span>
                        <div class="flex items-center gap-1.5">
                            <img :src="networkLogo" :alt="crypto.transactionData.network" class="w-4 h-4 rounded-full" @error="e => { e.target.onerror = null; e.target.src = '/default-token.png' }">
                            <span class="text-sm text-slate-800 dark:text-zinc-200 font-medium transition-colors duration-300">{{ crypto.transactionData.network }}</span>
                        </div>
                    </div>
                </div>

                <div class="relative w-full h-px">
                    <div class="absolute inset-0 flex items-center">
                        <div class="w-full border-t border-dashed border-slate-200 dark:border-zinc-700 transition-colors duration-300"></div>
                    </div>
                    <div class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 bg-slate-50 dark:bg-[#09090b] rounded-full border border-slate-200 dark:border-white/5 transition-colors duration-300"></div>
                    <div class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 bg-slate-50 dark:bg-[#09090b] rounded-full border border-slate-200 dark:border-white/5 transition-colors duration-300"></div>
                </div>

                <div class="p-3.5 flex flex-col gap-3">
                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.from') }}</span>
                        <!-- BULGU 3: "Gonderen" EVM-DISI aglarda 0x'e GERI DUSMEZ. Gonderim
                             gercekten dogru cuzdandan yapiliyor (arka plan TON'da
                             SEND_TON_TRANSACTION'da active_account'in TON turevi ile,
                             Solana'da solanaAddress ile imzalar) ama bu satir eskiden
                             KOSULSUZ user.address (EVM) gosteriyordu -- imza oncesi SON
                             ekranda "EVM olmayan agda 0x gorunmez" kuralinin en gorunur
                             ihlali. Kaynak TEK yerde: asagidaki `fromAddress` computed'i
                             UC VM'i de karsilar. Adres henuz cozulmediyse ADRES DEGIL
                             "hazirlaniyor" yazilir - yanlis adres gostermektense hicbiri. -->
                        <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded transition-colors duration-300">{{ fromAddress ? shortenAddress(fromAddress) : $t('send.confirmTransaction.preparingAddress') }}</span>
                    </div>

                    <div class="flex justify-between items-center">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('send.confirmTransaction.to') }}</span>
                        <div class="flex flex-col items-end gap-0.5">
                            <span v-if="crypto.transactionData.toLabel" class="text-xs font-bold text-slate-800 dark:text-zinc-200 truncate max-w-40 transition-colors duration-300">{{ crypto.transactionData.toLabel }}</span>
                            <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800/50 px-2 py-1 rounded transition-colors duration-300">{{ shortenAddress(crypto.transactionData.to) }}</span>
                        </div>
                    </div>

                    <div v-if="isTonNetwork && crypto.tonComment" class="flex justify-between">
                        <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium">{{ $t('confirm.ton_comment') }}</span>
                        <span class="text-xs font-mono text-slate-600 dark:text-zinc-300 break-all">{{ crypto.tonComment }}</span>
                    </div>
                </div>
            </div>

            <SecurityWarning
                :checking="securityChecking"
                :reputation="reputation"
                :poison-match="poisonMatch"
                :poison-parts="poisonParts"
                :poison-source-key="poisonSourceKey"
                v-model:poison-ack="poisonAcknowledged"
                v-model:reputation-ack="reputationAcknowledged"
            />

            <div v-if="!isAtsTransfer && !hideNativeTonFeeCard" class="shrink-0 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex justify-between items-center transition-colors duration-300 shadow-sm dark:shadow-none">
                <div class="flex flex-col">
                    <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('send.confirmTransaction.gasFee') }}</span>
                    <span class="text-[10px] text-emerald-600 dark:text-emerald-500 font-bold transition-colors duration-300">{{ $t('send.confirmTransaction.timing') }}</span>
                </div>

                <div class="flex flex-col items-end min-w-0 max-w-[55%]">
                    <!-- TON'da imzali govde onay aninda yok (anahtar arka planda), yani canli bir
                         teklif cekilemez. Yaklasik bir ihtiyat payi gosterilir; net oldugu asagidaki
                         notta belirtilir. -->
                    <!-- JETTON: harcanan TON, gonderilen jettondan AYRI gosterilir.
                         Ikisi AYRI VARLIKTIR; tek satirda birlestirmek kullaniciya ne
                         odedigini yanlis gosterir. Ustteki kahraman satir jetton
                         miktarini gosteriyor, bu satir TON'u. Fazlasi zincirde iade
                         edilir - "en fazla" ifadesi bu yuzden. -->
                    <!-- NOTLAR BU DALLARDAN CIKARILDI, asagida TEK yerde ciziliyor
                         (`feeNoteKey`): dolar satiri tutarin hemen ALTINA giriyor ve
                         notlar burada kalsaydi araya metin girerdi. Hangi notun
                         cikacagi degismedi, yalnizca NEREDE cizildigi degisti. -->
                    <template v-if="isTonJetton">
                        <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold tabular-nums transition-colors duration-300">≤ {{ JETTON_ATTACH_TON }} GRAM</span>
                    </template>
                    <!-- Rule 3 (spec 8): relay modunda BU satir GIZLENIR - asagidaki TON
                         ucret kartinin ATS tutari zaten AYNI ucreti anlatiyor, iki farkli
                         ucret gosterilmez. Kosul `sendWithTonRelay` (inceleme turu 1,
                         onemli 4): cipilak `payWithTonFee` ile, teklif sessizce cozulemedigi
                         durumda HEM bu satir HEM ATS karti gizleniyordu ve gonderim yine de
                         self-pay'e dusuyordu - kullanici odedigi TON ucretini HICBIR YERDE
                         gormuyordu. -->
                    <template v-else-if="isTonNetwork && !sendWithTonRelay">
                        <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold tabular-nums transition-colors duration-300">≈ {{ TON_FEE_RESERVE }} GRAM</span>
                    </template>
                    <span v-else-if="gas" class="text-sm text-slate-800 dark:text-zinc-200 font-bold tabular-nums truncate transition-colors duration-300" :title="`${gas} ${network.currentNetwork.nativeCurrency.symbol}`">{{ gasDisplay }} {{ network.currentNetwork.nativeCurrency.symbol.toUpperCase() }}</span>
                    <div v-else class="h-4 w-16 bg-slate-100 dark:bg-zinc-800 rounded animate-pulse transition-colors duration-300"></div>

                    <!-- DOLAR KARSILIGI - uc dalin da ALTINDA, tek yerde. Uc kopya
                         olsaydi biri duzeltilip digerleri geride kalirdi.
                         Fiyat bilinmiyorsa satir HIC cizilmez: sifirli bir dolar metni bu kartta
                         "ucret bedava" demek olurdu (assetPrice.js'teki ayni kural).
                         Ucret notundan ONCE durur ki sayiyla arasina metin girmesin. -->
                    <span v-if="gasUsdText" class="text-[11px] text-slate-500 dark:text-zinc-500 tabular-nums transition-colors duration-300">≈ ${{ gasUsdText }}</span>

                    <span v-if="feeNoteKey" class="text-[10px] text-slate-500 dark:text-zinc-500 block text-right">{{ $t(feeNoteKey) }}</span>
                </div>
            </div>

            <!-- TON gasless ucret karti - relayer BSC'deki ATS bakiyesinden tahsil
                 ediyor, kullanici TON gazi ODEMEZ (mevcut ATS kartinin TON kolu, spec 8).
                 Rule 1: gosterilen sayi DOGRUDAN imzalanacak atsMaxFee alanindan
                 (tonFee.atsMaxFee) - ekranda AYRI bir hesap YOK. Rule 2: "en fazla"
                 niteleyicisi YOK - iade olmadigi icin bir tampon vaat etmez.
                 ROUND 1 REVIEW BULGU 1: kart YALNIZ gercek bir teklif VARSA (atsMaxFee
                 != null) cizilir - iskelet/tire YOK. Fiyatsiz, "bu ucret iade edilmez"
                 yazan bir kart, ne kadar odenecegini SOYLEMEDEN alarmdan baska bir sey
                 katmiyor; bolge kapisi (payWithTonFee) zaten TON secenegini relay
                 kapaliyken gizliyor, teklifsiz bir yer tutucuya gerek yok. -->
            <!-- "TAHMINI" DEGIL. Bu kart EVM gaz kartinin (yukarisi) etiketini
                 kullaniyordu ve orada dogru: EVM'de kullanilmayan gaz IADE
                 EDILIR, yani gosterilen sayi gercekten bir tahmindir. TON'da
                 oyle degil -- `/relay` TAM OLARAK bu kadar tahsil eder
                 (sozlesme ss03: "atsMaxFee bir tavan degildir ... Kullaniciya
                 'en fazla' degil, 'bu kadar kesilecek' deyin"). Yanindaki
                 "iade edilmez" satiriyla birlikte "tahmini" demek celiskiydi:
                 tahmin edilen ama iade edilmeyen bir ucret, kullanicinin
                 bekleyecegi sey DEGIL.

                 "Ucret yanar" uyarisi `priceImpact`e BAGLI DEGIL: ucret dusuk fiyat
                 etkisinde de yaniyor. Duz TON gonderiminde bounce:false oldugu icin
                 zincirde dusecek bir eylem YOK -- bu yuzden yalniz jetton icin. -->
            <AtsFeeCard
                v-if="isTonNetwork && payWithTonFee && tonFee.atsMaxFee.value != null"
                label-key="send.confirmTransaction.tonFeeExact"
                paid-on-bsc-key="send.confirmTransaction.tonFeePaidOnBsc"
                no-refund-key="send.confirmTransaction.tonFeeNoRefund"
                :amount="tonFee.atsMaxFee.value"
                :usd-text="tonAtsFeeUsdText"
                :symbol="atsSymbol"
                :logo-uri="atsLogoURI"
                :burns-warning="payWithTonFee && isTonJetton"
            >
                <!-- Rule 4: quoteId/actionHash/seqno/imza varligi ana kartta GOSTERILMEZ;
                     yalniz burada, isteyene, KAPALI baslar. Acik/kapali durumu ve
                     `tonFee.quote` erisimi EKRANIN -- bu yuzden slot. -->
                <template #details>
                <button type="button" class="self-start text-[10px] text-slate-400 dark:text-zinc-500 underline decoration-dotted cursor-pointer" @click="tonFeeDetailsOpen = !tonFeeDetailsOpen">
                    {{ tonFeeDetailsOpen ? '▾' : '▸' }} {{ $t('send.confirmTransaction.tonFeeDetails') }}
                </button>
                <div v-if="tonFeeDetailsOpen && tonFee.quote.value" class="flex flex-col gap-0.5 text-[10px] font-mono text-slate-400 dark:text-zinc-500 break-all">
                    <span>quoteId: {{ tonFee.quote.value.quoteId }}</span>
                    <span>actionHash: {{ tonFee.quote.value.sign?.feeAuth?.actionHash }}</span>
                    <span>seqno: {{ tonFee.quote.value.sign?.feeAuth?.seqno }}</span>
                </div>
                </template>

                <template #shortfall>
                <!-- Bakiye yetmiyorsa AYNI KARTIN icinde. Ayri bir kart, ayni konuyu
                     (bu ucret ve senin ATS'n) ekranda ikiye boluyordu.
                     DAR AMA GERCEK BIR YOL (olculdu 2026-09-15): bu TON ucret karti
                     `sendWithTonRelay`, yani `atsMaxFee != null` ister; oysa useTonFee
                     `decision`i YALNIZ catch dalinda yazar ve AYNI catch `atsMaxFee`i
                     null'a ceker - normal akista ikisi ayni anda dogru OLAMAZ. Tek
                     istisna `runOnboarding`in finally'si: kurulum denemesi duser,
                     ardindan calisan `load()` bu kez basarili olur (atsMaxFee dolar) ve
                     finally dusen denemenin kararini geri koyar. Yani bolum "Kurulumu
                     calistir"dan sonra ucret tutariyla BIRLIKTE gorunebilir. -->
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
                </template>
            </AtsFeeCard>

            <!-- SPL alicisinin token hesabi (ATA) yoksa GONDEREN kirasini oder — TEK
                 SEFERLIK, ag ucretinden AYRI bir kesinti. Gizlenirse kullanici
                 beklemedigi bir maliyetle karsilasir (bkz. Task 10/12 notlari). -->
            <div v-if="vm === 'solana' && solanaContext && solanaContext.recipientAtaExists === false"
                 class="shrink-0 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex justify-between items-center transition-colors duration-300 shadow-sm dark:shadow-none">
                <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium transition-colors duration-300">{{ $t('send.confirmTransaction.ataRent') }}</span>
                <span class="text-sm text-slate-800 dark:text-zinc-200 font-bold tabular-nums transition-colors duration-300">
                    ~{{ (solanaContext.ataRentLamports / LAMPORTS_PER_SOL).toFixed(6) }} SOL
                </span>
            </div>

            <!-- Solana gonderim hatasi: buildTransferPlan/send.js/background.js'in
                 firlattigi HER ad sendErrors.js uzerinden buraya kullanici diliyle
                 duser — ham sabit ASLA ekrana cikmaz (bkz. sendErrors.test.js). -->
            <div v-if="solanaSendError" class="shrink-0 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ solanaSendError }}</span>
            </div>

            <!-- YAYIN BELIRSIZ dustu (zaman asimi / 5xx): islem zincire GITMIS OLABILIR.
                 Bu bir HATA DEGIL, bu yuzden kirmizi degil AMBER: kullaniciya "tekrar
                 deneyin" demek, imzalanmis bir islemi ikinci kez gondermeye davet etmek
                 olurdu (bkz. background.js sendSolanaTransfer). Onayla dugmesi asagida
                 v-if ile KALDIRILIR -- devre disi birakilmaz. -->
            <div v-if="solanaStatusUnknown" class="shrink-0 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none">
                <svg class="w-4 h-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span class="text-xs font-bold text-amber-800 dark:text-amber-400">{{ $t('send.errors.statusUnknown') }}</span>
            </div>

            <!-- ATS ucret karti. Tutar KAHRAMANDIR ve kendi satirinda tam genislikte durur.
                 Eski duzen etiketi ve tutari tek satira sikistirip tutari truncate ediyordu:
                 kullanici "en fazla ~2.323158 ..." goruyor, yani ODEYECEGI TUTARI goremiyordu.
                 Logo artik tutarin onunde bir para birimi isareti gibi durur; sembol sayinin
                 yaninda kalir (birim sayidan ayri dusmez), rozet tekrarina gerek yok. -->
            <!-- "en fazla" niteleyicisi YALNIZ ayni-zincir yolunda dogrudur: orada ucret bir
                 UST SINIRDIR ve postOp kullanilmayan gazi iade eder. Capraz-zincirde IADE YOKTUR
                 (remote paymaster'in postOp'u yok) - "bu ucret iade edilmez" satiriyla birlikte
                 gosterilince iki satir birbirini CURUTUYORDU. Ikisi de AYNI kosuldan turer,
                 yani asla birlikte dolmazlar. -->
            <AtsFeeCard
                v-if="isAtsTransfer && !isTonNetwork"
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
                <template #shortfall>
                <!-- Bakiye yetmiyorsa AYNI KARTIN icinde -- yukaridaki TON kartiyla ayni
                     gerekce. Once sayili hali (eksik miktar); hesaplanamiyorsa sayisiz
                     uyari. Ikisi ayni anda CIZILMEZ -- `v-if`/`v-else-if` zinciri bu
                     yuzden BUTUN halde slot'a girer. -->
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

                <!-- `buy-ats` DISLANIR: o durumda engel karti ayni seyi sunucunun kendi
                     metniyle zaten soyluyor. -->
                <div v-else-if="atsInsufficient && !atsLoading && !(atsDecision && atsDecision.action === 'buy-ats')" class="-mx-3 -mb-3 px-3 py-3 rounded-b-xl bg-red-50 dark:bg-red-500/10 border-t border-red-200 dark:border-red-500/20 flex items-start gap-2 transition-colors duration-300">
                    <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.atsInsufficientTitle', { symbol: atsSymbol }) }}</span>
                        <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.atsInsufficientDesc', { amount: atsRequiredDisplay, symbol: atsSymbol }) }}</span>

                        <!-- Logo + dolar, cumlenin ALTINDA kendi satirinda. Tutar cumlede
                             zaten yaziyor; burada TEKRARLANMAZ - yalnizca hangi varlik
                             oldugu (logo) ve ne ettigi (dolar) eklenir. Fiyat yoksa satir
                             HIC cizilmez. -->
                        <span v-if="atsRequiredUsdText" class="flex items-center gap-1 mt-0.5 text-[10px] text-red-600/80 dark:text-red-300/70 tabular-nums">
                            <img src="/ats.png" alt="ATS" class="w-3 h-3 rounded-full shrink-0" @error="e => e.target.style.display='none'" />
                            ≈ ${{ atsRequiredUsdText }}
                        </span>
                    </div>
                </div>
                </template>
            </AtsFeeCard>

            <GasTokenSelector
                v-if="!isAtsTransfer && !isTonNetwork && gasTokenOptions.length"
                v-model="gasToken"
                :options="gasTokenOptions"
                :native-symbol="network.currentNetwork.nativeCurrency.symbol"
                :native-logo="networkLogo"
                :sent-asset-address="crypto.transactionData.asset"
                :send-amount="crypto.transactionData.amount"
            />

            <!-- `!tonFeeBlocked`: TEK ENGEL, TEK MESAJ. Bloklayici bir ucret karari
                 varken (ATS eksik, kurulum gerekli, /status okunamadi) gonderim ZATEN
                 olmuyor - `feeBlocked` tonFeeBlocked'u bu karttan ONCE okuyor, yani
                 buton sebebi dogru soyluyordu ama EKRAN iki kirmizi kart birden
                 ciziyordu. Ikincisi YANLIS YONLENDIRIR: "yeterli TON yok" kullaniciya
                 TON almasini soyler, oysa TON almak hicbir seyi acmaz - eksik olan ATS.
                 Takas ekranindaki AYNI kapi (Swap.vue, gaz karti) ile birlikte konuldu;
                 iki ekran ayni durumda ayni sayida kart cizmeli. -->
            <div v-if="!isAtsTransfer && !tonFeeBlocked && nativeBalanceShort && !gasToken" class="shrink-0 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientFee') }}</span>
                    <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.insufficientFeeDesc', { symbol: network.currentNetwork.nativeCurrency.symbol }) }}</span>
                </div>
            </div>

            <div v-else-if="!isAtsTransfer && selectedInsufficient" class="shrink-0 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none">
                <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.confirmTransaction.insufficientToken') }}</span>
                    <span class="text-[10px] text-red-600 dark:text-red-300">{{ $t('send.confirmTransaction.insufficientGasTokenDesc', { symbol: selectedSymbol }) }}</span>
                </div>
            </div>

            <!-- EKSIK ATS -- KENDI KARTIYLA, yalnizca hicbir ucret karti cizilmediginde.
                 Normalde bu bolum ucret kartinin ICINDE durur (yukarida, iki kolda da):
                 ayri kart olarak cizildiginde ayni konu -- "bu ucret ve senin ATS'n" --
                 ekranda ikiye bolunuyor, arada baska kartlar kaliyordu.
                 Yedek yol SART: TON kolunda bakiye yetmeyince teklif hic donmez, dolayisiyla
                 ucret karti da CIZILMEZ (`atsMaxFee != null` kurali) ve bolum icine
                 yerlesecegi bir kart bulamaz. O durumda kullanici kartsiz kalmamali. -->
            <AtsShortfallNote
                v-if="showAtsShortfall && shortfallStandalone"
                standalone
                :symbol="atsSymbol"
                :logo-uri="atsLogoURI"
                :exact="`${atsShortfall} ${atsSymbol}`"
                :amount-display="atsShortfallDisplay"
                :usd-text="atsShortfallUsdText"
                :required-display="atsRequiredTotalDisplay"
                :balance-display="atsBalanceDisplay"
            />

            <!-- Engel karti. `decision.severity` kartin tonunu, `action` butonunu belirler.
                 KIRMIZI YALNIZ `blocked` icin: kimsenin cozemeyecegi durum (guvenlik
                 reddi, yabanci delegasyon). `transient`/`operator` KEHRIBAR - bir /status
                 ya da /quote aksakligi CALISAN bir gonderimi durdurmuyor (self-pay yolu
                 acik) ve kirmizi "engellendi" demek yanlis; kullanici gonderilebilir bir
                 islemi iptal eder. `user` da kehribar kalir (eylem kullanicida, engel
                 degil). ONCEKI kural (`severity === 'user' ? amber : red`) tam tersini
                 yapiyordu: TEK kirmizi olmamasi gereken aile disindaki HER SEY kirmiziydi.
                 TON KOLU AYNI karta besleniyor (Task 8 olcumu) - abort-unsafe/blocked icin
                 YENI DAL YOK: dogrulama reddinde kullanicinin yapabilecegi bir sey yok,
                 buton koymak onu donguye sokardi; mesaj burada, butonsuz cizilir (asagidaki
                 iki button'dan hicbiri o action'i eslemez). Operator kaynakli engeller once
                 gelir: ag saglıksizken "ATS satin alin" demek yanlis yonlendirmedir - ATS
                 alsa bile islem yine gecmez.
                 ROUND 1 REVIEW BULGU 4: TON tarafi `tonFeeDecisionActive`ye (Swap.vue'daki
                 AYNI ifade) baglidir, cipilak `isTonNetwork`e DEGIL - o kosul bir /status
                 kesintisinde calisan bir self-pay gonderiminin (TON_FEE_RESERVE karti)
                 YANINA yanlislikla bir engel karti boyuyordu. -->
            <div v-if="(isAtsTransfer || tonFeeDecisionActive) && feeDecision && !feeLoading && feeDecision.severity !== 'internal' && !showAtsShortfall"
                 class="shrink-0 rounded-xl p-3 flex items-start gap-2 border transition-colors duration-300 shadow-sm dark:shadow-none"
                 :class="feeDecision.severity === 'blocked'
                   ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                   : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'">
              <div class="flex flex-col gap-1 min-w-0 w-full">
                <span class="text-xs font-bold text-slate-800 dark:text-zinc-100">
                  {{ $t(feeDecision.i18nKey, { symbol: atsSymbol }) }}
                </span>
                <span v-if="feeDecision.action === 'run-onboarding'" class="text-[10px] text-slate-600 dark:text-zinc-400">
                  {{ $t(feeOnboardingDescKey) }}
                </span>
                <!-- Aciklamasi eylemden turetilemeyen engeller kendi metnini tasir (atsBlocker
                     i18nDescKey). Bunsuz kart yalnizca bir baslik + ise yaramayan bir butondan
                     ibaret kalirdi. -->
                <span v-else-if="feeDecision.i18nDescKey" class="text-[10px] text-slate-600 dark:text-zinc-400">
                  {{ $t(feeDecision.i18nDescKey) }}
                </span>
                <!-- Sunucu metnini AYNEN goster. Bootstrap kota hatalari ("imza zaten acik" ~5 dk,
                     "gunluk kota doldu" ertesi gun, "deneme hakki doldu" destek) KODSUZ 400 olarak gelir;
                     ucunu tek bir "hata" mesajina indirgemek kullaniciyi yeni cuzdan acmaya iter. -->
                <span v-else-if="feeDecision.severity === 'transient' && feeRawError"
                      class="text-[10px] text-slate-600 dark:text-zinc-400 wrap-break-word">
                  {{ feeRawError }}
                </span>
                <button v-if="feeDecision.action === 'run-onboarding'"
                        :disabled="feeOnboarding || feeLoading"
                        class="mt-1 self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
                        @click="isTonNetwork ? onRunTonOnboarding() : onRunOnboarding()">
                  {{ feeOnboarding ? $t('send.confirmTransaction.atsOnboardingRunning') : $t('send.confirmTransaction.atsOnboardingRun') }}
                </button>
                <!-- Yeniden denemenin ANLAMLI oldugu tek durumlar bunlar (atsBlocker.js): rate-stale
                     ve bilinmeyen/gecici kodlar. suggest-other-chain / explain-foreign / buy-ats
                     icin buton YOK - yeniden denemek cozmez, atsBlocker'in dongu korumasi tam bunun icin var. -->
                <button v-else-if="feeDecision.action === 'refresh-status' || feeDecision.action === 'retry-later'"
                        :disabled="feeLoading || feeOnboarding"
                        class="mt-1 self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
                        @click="isTonNetwork ? runTonFeeQuote() : runAtsQuote()">
                  {{ $t('send.confirmTransaction.atsQuoteRetry') }}
                </button>
              </div>
            </div>

            <!-- Karar karti FIILEN gosteriliyorsa (decision var VE severity 'internal' degil)
                 bu jenerik kart bastirilir: onboarding basarisizliginda ikisi ayni anda
                 doluyor (decision + error) ve iki kart birden cikip celisen eylemler
                 onerirdi. 'internal' severity'de karar karti zaten kendini gizliyor (kod
                 duzeltir, kullaniciya gosterilmez) - o durumda bu jenerik kart TEK geri
                 bildirim kaynagi olarak kalmali, yoksa kullanici hicbir kart gormeden bloklu kalir. -->
            <div v-if="isAtsTransfer && atsError && (!atsDecision || atsDecision.severity === 'internal')" class="shrink-0 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3 flex items-start gap-2 transition-colors duration-300 shadow-sm dark:shadow-none">
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

        </div>

        <div class="absolute bottom-0 left-0 w-full p-5 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-sm border-t border-slate-200 dark:border-white/5 z-20 flex gap-3 transition-colors duration-300">
            <button 
                class="flex-1 py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-600 dark:text-white transition-all cursor-pointer shadow-sm dark:shadow-none" 
                @click="reject"
            >
                {{ $t('send.confirmTransaction.cancel') }}
            </button>
            
            <!-- v-if, `disabled` DEGIL: yayin belirsiz dustugunde bu dugme yeniden
                 tiklanabilir olmamali. `disabled` bir stil durumudur ve bir sonraki
                 refactor onu kosula ekleyip cikarabilir; kaldirilmis bir dugme
                 tiklanamaz. -->
            <button 
                v-if="!solanaStatusUnknown"
                class="flex-2 py-3.5 rounded-xl font-bold text-sm transition-all shadow-lg cursor-pointer flex items-center justify-center gap-2"
                :class="(isSubmitting || feeBlocked || isCheckingBalance || securityBlocked)
                    ? 'bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-600 cursor-not-allowed shadow-none'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-600/10 dark:shadow-emerald-900/20'"
                :disabled="isSubmitting || feeBlocked || isCheckingBalance || securityBlocked"
                @click="send"
            >
                <template v-if="isSubmitting || isCheckingBalance || atsLoading">
                    <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>{{ (isCheckingBalance || atsLoading) ? $t('send.confirmTransaction.calculating') : $t('send.confirmTransaction.loading') }}</span>
                </template>
                <template v-else>
                    <span>{{ confirmLabel }}</span>
                </template>
            </button>
        </div>

    </div>
</template>

<script setup>
import { cryptoStore } from '../store/crypto'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { pageStore } from '../store/pageStore'
import { onMounted, onUnmounted, ref, computed, markRaw } from 'vue'
import { shortenAddress } from '../utils/shortenAddress'
import Back from './Back.vue'
import { useGasToken } from '../composables/useGasToken'
import GasTokenSelector from './GasTokenSelector.vue'
import AtsShortfallNote from './AtsShortfallNote.vue'
import AtsFeeCard from './AtsFeeCard.vue'
import { formatBalance } from '../utils/tokenMark'
import { getEstimatedGas } from '../utils/getEstimatedGas'
import axios from 'axios'
import { useTransactionStore } from '../store/transaction'
import { ethers } from 'ethers'
import { buildTransaction } from '../utils/buildTransaction'
import { configStore } from '../store/config'
import { isTon } from '../utils/chainKind'
import { TON_FEE_RESERVE, tonSendAmountFits } from '../utils/ton/tonSend'
import { JETTON_ATTACH_TON, jettonSendFits } from '../utils/ton/jettonSend'
import { getJettonWalletAddress } from '../utils/ton/jettonAddress'
import { decimalToRawUnits } from '../utils/ton/jettonTransfer'
import { toNano } from '@ton/core'
import { getJettonBalance } from '../utils/ton/jettonBalance'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'
import { getTonClient } from '../utils/ton/tonClient'
import { getTonBalance } from '../utils/ton/tonBalance'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { pickDisplayAddress } from '../composables/useDisplayAddress'
import { isGaslessChain } from '../utils/gaslessConfig'
import { useAtsFee } from '../composables/useAtsFee'
import { useTonFee } from '../composables/useTonFee'
import { isAtsChain, getAtsConfig, ATS_COINGECKO_ID, ATS_LOGO_URI } from '../utils/atsConfig'
import { isNativeAmountInsufficient, pickFeeBranch } from '../utils/atsFee'
import { atsRequiredFromBudget, atsShortfallAmount } from '../utils/atsShortfall'
// ATS tutarlarinin EKRAN bicimi - Swap.vue ile ORTAK (gerekce o dosyanin basinda).
import { formatAtsAmount } from '../utils/atsAmountFormat'
import { useAtsFuel } from '../composables/useAtsFuel'
import { useI18n } from 'vue-i18n'
import { recordSentRecipient } from '../utils/sentRecipients'
import { useUsdPrice } from '../composables/useUsdPrice'
import { tokenToUsd, formatUsd } from '../utils/assetPrice'
import { useAddressSecurity } from '../composables/useAddressSecurity'
import SecurityWarning from './SecurityWarning.vue'
import { chainVm } from '../utils/vm'
import { closeOrNavigate } from '../utils/uiSurface'
import { prepareTransferContext } from '../utils/solana/send'
import { fetchSolanaAssets } from '../utils/solana/balances'
import { SOL_NATIVE_MARKER, SOL_DECIMALS, LAMPORTS_PER_SOL } from '../utils/solana/constants'
import { solanaMintOf } from '../utils/solana/sendMint'
import { resolveSolanaSendError } from '../utils/solana/sendErrors'
import { tokenLogo } from '../utils/tokenLogo'

const { t } = useI18n()
const txStore = useTransactionStore()

const crypto = cryptoStore()
const network = networkStore()
const user = userStore()
const page = pageStore()
const config = configStore()

// TON EVM DEGIL: bu ekranin buyuk kismi (gas tahmini, ATS, gasless) yalnizca
// EVM'de anlamli. Tek bir bayraktan turetip her yeri buna gore dallandiriyoruz.
const isTonNetwork = computed(() => isTon(network.currentNetwork))

// Send.vue ve Token.vue ile AYNI ayrim, AYNI kaynak (NATIVE_TOKEN_ADDRESS).
// Uc ekran ayrisirsa biri jetton satirinda native TON gonderir - K1 buydu.
const isTonJetton = computed(() =>
    isTonNetwork.value && crypto.sendAsset?.address !== NATIVE_TOKEN_ADDRESS)

const gas = ref(null)
const from_dapp = ref(false)
const url = ref('')
const logo = ref('')
// BULGU 3: "Gonderen" satirinin TON adresi. checkTonFeeSufficiency zaten
// ensureTonAddress'i cagiriyor (bakiye/ucret kontrolu icin); ayni cozumleme
// burada da kullanilir — ikinci bir turetme GEREKMEZ.
const tonFromAddress = ref(null)

// "Gonderen" satirinin GOSTERILECEK adresi. Header.vue/Receive.vue ile AYNI
// desen (useDisplayAddress.js:pickDisplayAddress): TON'da adres henuz
// cozulmediyse 0x'e GERI DUSULMEZ, sablon "hazirlaniyor" gosterir.
//
// SOLANA DALI BIRLESMEDE GEREKTI, ama BU DOSYADA DEGIL: karar da TON'daki gibi
// pickDisplayAddress'in icinde durur (`solanaAddress` kolu). Burada ayri bir
// `if (vm === 'solana')` dali tutmak, "hangi VM hangi adresi gosterir" sorusuna
// IKINCI bir cevap kaynagi acardi -- Header/Receive ile ayni deseni kullanmanin
// tek sebebi bu kaynagin TEK olmasi. Solana kimligi `crypto.transactionData.from`
// dur: Send.vue oraya `active_account.solanaAddress` yaziyor (bkz. Send.vue
// confirm, Solana dali); cozulemediyse `null` gider ve ekran "hazirlaniyor"
// gosterir -- 0x'e GERI DUSMEZ (TON'da duzeltilen BULGU 3'un birebir ikizi).
//
// EVM dalinda `crypto.transactionData.from` ONCELIKLI, `user.address` YEDEK:
// dosyanin geri kalani (gas tahmini, bakiye okumasi, buildTransaction) HEP
// `crypto.transactionData.from || user.address` okuyor. Gosterilen gonderen ile
// islemi kuran gonderen AYNI degerden turemeli -- aksi halde dapp'ten gelen,
// aktif hesaptan FARKLI bir `from` tasiyan bir istekte ekran bir adresi gosterip
// baskasindan imzalatirdi.
//
// TON'da `transactionData.from` BILEREK YOK SAYILIR: Send.vue'nun EVM dali oraya
// 0x adresini yazar ve onceligi ona vermek tam da BULGU 3'u geri getirirdi.
// pickDisplayAddress'in TON kolu zaten yalnizca `tonAddress`e bakiyor.
const fromAddress = computed(() => pickDisplayAddress({
  chain: network.currentNetwork,
  evmAddress: crypto.transactionData.from || user.address,
  tonAddress: tonFromAddress.value,
  solanaAddress: crypto.transactionData.from || null,
}))

// YENİ STATE'LER
const insufficientGas = ref(false)
const isCheckingBalance = ref(true)

// TON BAKIYELERI HAM TUTULUR; KARAR ASAGIDA `tonInsufficient`e birakilir.
//
// NEDEN AYRILDI: `checkTonFeeSufficiency` onMounted'ta `tonFee.load`tan ONCE
// calisiyor, yani calistigi anda `sendWithTonRelay` HER ZAMAN false. Karari o
// anda yazmak, role modunu HIC goremeyen bir kontrol demekti -- ve kontrolun
// istedigi paylar (jetton'un 0.05 TON ilisigi, duz TON'un 0.01 ihtiyat payi)
// role modunda rolecinin cebinden cikiyor. Sonuc: hic TON'u olmayan bir
// kullanici, ekranda ATS ucret kartini gorurken "Yetersiz Bakiye" ile
// kilitleniyordu -- gasless'in AMIRAL GEMISI senaryosu (bkz. paymaster cevabi
// 2026-09-14, docs/backend-istek-2026-09-14c-uninit-cuzdan-role.md bolum 5).
//
// `null` = HENUZ OKUNMADI. `0`dan AYRI tutulur: sifir bakiye gercek bir cevaptir,
// okunmamislik degil.
const tonBalanceOkunan = ref(null)
const tonJettonBalanceOkunan = ref(null)
// Okuma DUSTU (proxy, kilitli kasa, RPC). Fail-closed karari buradan turer.
const tonBalanceOkunamadi = ref(false)
const isSubmitting = ref(false)

// Zincirin SANAL MAKINESI — Solana/EVM dallanmasinin TEK kaynagi (Send.vue ile ayni).
const vm = computed(() => chainVm(network.currentNetwork))

// Solana mint kimligi VE ondalik — Send.vue ile AYNI normalizasyon (sendMint.js).
// Once burada da HAM `crypto.sendAsset?.address || SOL_NATIVE_MARKER` iki ayri
// yerde (onMounted, sendSolana) tekrarlaniyordu; kod incelemesinde Send.vue'da
// bulunan "normalizasyon TEK yerden okunmali" bulgusu burada da gecerli.
const mint = computed(() => solanaMintOf(crypto.sendAsset))
const solanaDecimals = computed(() => crypto.sendAsset?.decimals ?? SOL_DECIMALS)

// Solana ucret/kira baglami. `recipientAtaExists === false` durumunda alicinin
// token hesabini GONDEREN acar ve kirasini oder — bu ekranda AYRI bir satir
// olarak gorunmezse kullanici beklemedigi bir kesintiyle karsilasir.
const solanaContext = ref(null)
// Gonderim sonrasi (SOLANA_SEND) hata mesaji — kullaniciya gosterilecek METIN
// (i18n anahtari degil, `t()` ile ONCEDEN cozulmus).
const solanaSendError = ref(null)
// Yayin BELIRSIZ dustu (bkz. background.js): islem zincire GITMIS OLABILIR.
// Bir HATA degil, bir DURUM -- ve bu durumda tekrar gondermek CIFT GONDERIMDIR.
const solanaStatusUnknown = ref(false)

// Guvenlik kapilari (zehirli adres + itibar). Bu ekran dapp islemleri icin TEK kapidir:
// dapp'ten gelen istek Send.vue'ya hic ugramaz, oradaki uyariyi hic gormez.
const {
  checking: securityChecking, reputation, poisonMatch, poisonParts, poisonSourceKey,
  poisonAcknowledged, reputationAcknowledged, blocked: securityBlocked, loadTrusted,
} = useAddressSecurity(computed(() => crypto.transactionData?.to), computed(() => config.api))

// GASLESS: token ile gas — composable'dan gelir
const { gasToken, gasTokenOptions, selectedOption, selectedInsufficient, loadGasOptions } = useGasToken()

// ATS: kullanici transferi (dapp DEGIL) + ATS zinciri -> ucret her zaman ATS.
// v3: bloklama backend'in `ready` alanina dayanir; istemci bakiye/izin/delegasyondan
// kendi karar turetmez. `decision` engel kartinin tonunu/butonunu belirler (bkz. atsBlocker.js).
// `ready` ve `mode` BILEREK alinmiyor: `ready` zaten `blocked` icinde degerlendiriliyor ve
// ekranda ikinci bir kullanicisi yok; `mode` da arka plana gonderiliyordu ama
// executeAtsTransfer onu HIC okumuyor (modu her zaman kendi /status'undan alir — istemcinin
// gonderdigi bayat bir moda gore fiyatlama yapmasi zaten yanlis olurdu).
const {
  atsFee, atsSymbol, isCrosschain, decision: atsDecision,
  nextSteps: atsNextSteps, feeTotal: atsFeeTotal, requiredAts,
  loading: atsLoading, onboarding: atsOnboarding,
  error: atsError, insufficient: atsInsufficient, blocked: atsBlocked,
  beginQuote, failQuote, loadAtsFee, runOnboarding,
} = useAtsFee()

// TON gasless ucret onizlemesi (Task 8, spec 8) - relayer BSC'deki ATS
// bakiyesinden tahsil ediyor, kullanici TON gazi ODEMEZ. `tonFee` yalniz
// ONIZLER, imzalamaz/gondermez (bkz. useTonFee.js dosya basi notu).
const tonFee = useTonFee()

// `tonPublicKey` KASADAN cikar ve bu bilesenin kasaya erisimi YOK (olmamali da:
// onizleme bir arayuz isi, sifre cozme degil). Deger arka plandan TEK bir mesajla
// gelir ve YALNIZCA acik anahtardir. Cozulemezse (kilitli kasa, TON kasasi yok)
// null kalir; useTonFee o zaman yalniz bolge kontrolunu yapar ve tutar
// gosterilmez - kart da cizilmez (atsMaxFee null).
const tonFeePublicKey = ref(null)
// TON'a KILITLI hesapta ATS'i BSC'de imzalayacak anahtar YOK. Varsayilan `false`:
// bilinmeyen durumda relay secenegi GOSTERILMEZ (guvenli taraf self-pay'dir).
const tonFeeEvmCapable = ref(false)
async function loadTonFeeIdentity() {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'TON_FEE_IDENTITY',
      message: { chainId: network.currentNetwork.chainId },
    })
    tonFeePublicKey.value = resp?.success ? resp.tonPublicKey : null
    tonFeeEvmCapable.value = resp?.success ? resp.evmCapable === true : false
  } catch (e) {
    console.warn('TON ucret kimligi alinamadi:', e?.message)
    tonFeePublicKey.value = null
    tonFeeEvmCapable.value = false
  }
}

// RELAY BU GONDERIM ICIN UYGUN MU - bolge kapisinin (relayActive) YANINDAKI ikinci
// kapi, ve GONDERIM ANINDAN ONCE bilinmek zorunda. Bu ekranda relay/self-pay
// anahtari YOK (mod bolgeden turuyor), yani gonderim aninda "bu boyle
// gonderilemez" demek kullaniciyi donebilecegi hicbir secenegi olmayan bir
// cikmaza sokar - daha once calisan bir akis (notlu borsa yatirimi) oyle olmustu.
//
//   - EVM kasasi: `evmVaultResolvable` ile arka planda cozulur - relayer'in KENDI
//     3. kapisiyla AYNI yuklem. GERIYE KALAN TEK KOSUL BU.
//
// Arka plandaki karsiligi KALDIRILMADI: bu bayrak yalnizca ARAYUZ karari, arka
// plan icin baglayici degil (mesaj bayat ya da uydurulmus olabilir).
//
// NOT (memo) KAPISI BURADA IKI ADIMDA TUMDEN KALKTI - ve yerine bir sey KONDU.
//
// Kosul eskiden "notlu gonderim relay'e cikmasin" diyordu. Sebep sunucunun notu
// reddetmesi DEGILDI; notu DOGRULAYAMIYOR olmamizdi:
//   - duz TON'da (2026-09-14) yorumlu govde tonQuoteVerify'da
//     TON_PAYLOAD_BODY_UNVERIFIED ile duserdi;
//   - jettonda (2026-09-15) not TEP-74 `forward_payload`inin ICINDE tasinir ve
//     ayristirici dolu bir forward_payload'da KOSULSUZ duserdi.
// Iki olcum de kisitin BIZDE oldugunu gosterdi: `kind:'ton'` bastan beri bir
// `comment` alani tasiyor, `kind:'jetton'` de oyle (ayirt edici olcum: ayni
// istege eklenen `comment` KABUL, `gasTonNano` REDDEDILDI).
//
// HER IKI ADIMDA DA ONCE DOGRULAMA ACILDI, SONRA KOSUL KALKTI. V5 artik notu
// KENDI kurdugu hucrenin hash'iyle karsilastiriyor (duz TON'da `bodyHash`,
// jettonda `forwardPayloadHash`). Kosulu dogrulama olmadan kaldirmak, tam da
// onlemeye calistigi kaybi gerceklestirirdi: not sessizce duser ve memosuz giden
// bir borsa yatirimi KAYIP sayilir.
//
// GERI EKLEMEYIN. `&& !(isTonJetton.value && crypto.tonComment)` bicimindeki bir
// dislama artik CALISAN bir gonderimi gereksiz yere self-pay'e dusurur:
// kullanici odemesi gerekmeyen TON ucretini oder. (Kablolama testi bu satirin
// YOKLUGUNU olcuyor - bkz. tonFeeUiWiring.test.js "JETTON + not ARTIK elemiyor".)
const tonRelayEligible = computed(() => tonFeeEvmCapable.value)

// Relay bu gonderici icin ACIK mi (/status.ton bolge/oran kapisi). Tutarin
// KENDISI (tonFee.atsMaxFee) HENUZ cozulmemis olabilir - bu, kartin/uyarinin
// gorunurlugunu ETKILEMEZ (spec 8: uyari priceImpact'e degil payWithTonFee'ye
// bagli).
const payWithTonFee = computed(() =>
  isTonNetwork.value && tonFee.relayActive.value && tonRelayEligible.value)

// GONDERIM MODU, ucret KARTININ gorunurluguyle AYNI kosula baglidir: kullanicinin
// GORUP onayladigi bir tutar yoksa relay'e cikilmaz. Yalniz `payWithTonFee` yeterli
// olsaydi (bolge acik ama teklif dusmus), fiyati hic gorunmemis bir ucret onaylatmis
// olurduk - ve dogrulama (V10, approvedAtsFee) zaten kapali tarafa duserdi.
const sendWithTonRelay = computed(() => payWithTonFee.value && tonFee.atsMaxFee.value != null)
// Rule 3: relay AKTIFKEN duz TON gonderiminin kendi ihtiyat payi (TON_FEE_RESERVE)
// kartini TAMAMEN gizler - jetton'un TON ekleme karti (JETTON_ATTACH_TON) BASKA
// bir seyi anlatir (mesaj iletim payi), o yuzden burada YOK sayilmaz.
// `sendWithTonRelay`e bagli, cipilak `payWithTonFee`ye DEGIL (inceleme turu 1,
// onemli 4). Fark SESSIZ bir yol aciyordu: `useTonFee.load` tonWallet/tonPublicKey/
// actions'tan biri eksikse teklife HIC gitmez ve `decision`i null birakir - yani
// engel karti da CIZILMEZ. O durumda relay ucret karti gizli (atsMaxFee null),
// TON_FEE_RESERVE satiri gizli (payWithTonFee true), engel karti yok ve gonderim
// self-pay'e duserek kullanicidan TON aliyordu: ekranda HICBIR ucret gorunmeden.
// `sendWithTonRelay` fiyatin gercekten cozuldugunu de olctugu icin bu bosluk kapanir.
const hideNativeTonFeeCard = computed(() => sendWithTonRelay.value && !isTonJetton.value)

// ROUND 1 REVIEW BULGU 4: engel kartinin TON tarafi ne cipilak `isTonNetwork`e
// (her plain-TON gonderiminde, calisan bir self-pay'in yanina bile boyanirdi)
// ne de cipilak `payWithTonFee`ye (bir /status kesintisinde sessizce kaybolurdu,
// Swap.vue'da yasanan hata) baglanir. Sunucunun ACIKCA "kapali" dedigi (relayActive
// false, statusUnreadable false) durumla, DURUMU HIC OKUYAMADIGIMIZ (statusUnreadable
// true) durumu AYIRT EDER - ikincisinde de decision GORUNMELI (ag kesintisi kullaniciya
// soylenmeli) ama odeme modu (payWithTonFee) buna gore DEGISMEZ. Swap.vue'da AYNI
// ifade, harfi harfine - "iki ekran ayni sekilde kapılıyor" (kablolama testiyle kilitli).
const tonFeeDecisionActive = computed(() => isTonNetwork.value && (payWithTonFee.value || tonFee.statusUnreadable.value))

// Engel karti TEK - TON kolu ATS'in AYNI karar/yukleme degiskenine besleniyor
// (Task 8 olcumu: "TON kolu AYNI engel bloguna besleniyor, yeni kart ACILMIYOR").
const feeDecision = computed(() => isTonNetwork.value ? tonFee.decision.value : atsDecision.value)
const feeLoading = computed(() => isTonNetwork.value ? tonFee.loading.value : atsLoading.value)
const feeOnboarding = computed(() => isTonNetwork.value ? tonFee.onboarding.value : atsOnboarding.value)
const feeRawError = computed(() => isTonNetwork.value ? tonFee.error.value : atsError.value)
// TON'un kendi `nextSteps` sayisi YOK (useTonFee onboarding'i dogrudan BSC'de
// calistirir, ATS_FEE_QUOTE'un ongordugu adim listesini onizlemez) - daha
// kapsamli aciklama guvenli varsayilan.
const feeOnboardingDescKey = computed(() => isTonNetwork.value
  ? 'send.confirmTransaction.atsOnboardingDesc'
  : (atsNextSteps.value.length > 1 ? 'send.confirmTransaction.atsOnboardingDesc' : 'send.confirmTransaction.atsBudgetLowDesc'))

// "Detaylar" katlanir paneli (Rule 4) - varsayilan KAPALI.
const tonFeeDetailsOpen = ref(false)

// Teklifin ANLAMSAL niyeti. `jettonWallet` BURADA YOK ve olmamali: sunucu tanimadigi
// alani reddeder (tonFeeRelayer.js:quoteAction da onu ayni sebeple ayikliyor). Gercek
// gonderimde o alan arka planda ZINCIRDEN cozulur - dogrulamanin "hangi token"
// girdisi oradan gelir, buradan degil.
const tonFeeActions = computed(() => {
  const to = crypto.transactionData?.to
  const amount = crypto.transactionData?.amount
  if (!to || amount === undefined || amount === null || amount === '') return null
  try {
    if (isTonJetton.value) {
      const decimals = crypto.sendAsset?.decimals
      // Ondalik yoksa miktar 1000 kat yanlis olurdu; varsayilana DUSMEK yerine
      // teklif hic istenmez (kart cizilmez).
      if (!Number.isInteger(decimals)) return null
      // ONIZLEMEDEKI NIYET = GONDERIMDEKI NIYET (duz TON dalindaki ayni kural).
      // `comment` tasinmazsa teklif notsuz bir govde icin fiyatlanir, gonderim
      // notlu bir govde ister ve kullanici FIYATINI GORDUGU bir gonderimde
      // dogrulama hatasi alir. background.js'in jetton relay dali AYNI alani
      // AYNI adla gonderiyor.
      return [{
        kind: 'jetton', jettonMaster: crypto.sendAsset?.address, to,
        amount: decimalToRawUnits(amount, decimals).toString(),
        comment: crypto.tonComment,
      }]
    }
    // ONIZLEMEDEKI NIYET = GONDERIMDEKI NIYET. `comment` burada da tasinmali:
    // taşınmazsa teklif notsuz bir govde icin fiyatlanir, gonderim notlu bir
    // govde ister ve kullanici FIYATINI GORDUGU bir gonderimde dogrulama hatasi
    // alir. background.js'in relay dali AYNI alani AYNI adla gonderiyor.
    return [{ kind: 'ton', to, amountNano: toNano(amount).toString(), comment: crypto.tonComment }]
  } catch (e) {
    // Gecersiz adres/miktar: teklif istemenin anlami yok. Gonderim yolu ayni
    // girdiyi kendi kapilarinda reddedecek.
    return null
  }
})

// Iki cagri yeri (ilk yukleme ve "Tekrar dene") AYNI argumanlari kurmali - ayrisirsa
// biri tutari gosterir, digeri gostermez ve fark hicbir yerde gorunmez.
const tonFeeLoadArgs = () => ({
  sender: user.address,
  tonWallet: tonFromAddress.value,
  tonPublicKey: tonFeePublicKey.value,
  actions: tonFeeActions.value,
})

// Engel kartinin "Tekrar dene" butonu (action: refresh-status|retry-later) TON
// kolunda bunu cagirir - runAtsQuote'un TON karsiligi.
async function runTonFeeQuote() {
  await tonFee.load(tonFeeLoadArgs())
}

// ATS onboarding HER ZAMAN BSC'de (tonFee.runOnboarding ATS_SRC_CHAIN_ID kullanir,
// TON'un kendi chainId'si DEGIL) - kullanicinin BSC'deki ATS hesabi, TON
// islemi icin de AYNI hesap.
async function onRunTonOnboarding() {
  const { active_account } = await chrome.storage.local.get('active_account')
  await tonFee.runOnboarding({
    address: user.address,
    index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,
  })
}

const isAtsTransfer = ref(false)
// ATS kolunda gas icin native GEREKMEZ; yalnizca native GONDERILIYORSA tutar gerekir.
const nativeAmountInsufficient = ref(false)
// runAtsQuote'ta kurulan cagriyi onboarding butonu icin sakliyoruz: tazeleme quote'u
// gaz tahmini istiyor (Task 9), tekrar buildTransaction cagirmaya gerek yok.
const atsCall = ref(null)

// Yetersiz token uyarisindaki sembol (native veya secili ERC-20)
const selectedSymbol = computed(() => gasToken.value === null
  ? (network.currentNetwork?.nativeCurrency?.symbol || 'ETH')
  : (selectedOption.value?.symbol || '?'))

// TON relay kolunda ucret karari GONDERIMI DE bloklar - EVM'deki `atsBlocked`in
// (loading || onboarding || !ready || ...) aynasi.
//
// CANLI OLCUM 2026-09-01: kurulum karti CIZILIYOR ama "Onayla & Gonder" ACIK
// kaliyordu, cunku `feeBlocked` TON kolunda YALNIZ bakiyeye bakiyordu. Kullanici
// kurulumu bitirmeden basinca gonderim sessizce self-pay'e dusuyor (sendWithTonRelay
// false) ve gasless soylenmisken kullanicinin KENDI TON'u yaniyordu.
//
// Kapi engel KARTIYLA birebir AYNI (`tonFeeDecisionActive`): cipilak `isTonNetwork`
// calisan bir self-pay gonderimini de kilitlerdi. 'internal' DISLANIR - o aile kartta
// da cizilmez (kartin v-if'indeki AYNI kural), gorunmeyen bir sebeple kilitlenen buton
// aciklamasi olmayan olu bir butondur.
const tonFeeBlocked = computed(() =>
  tonFeeDecisionActive.value && feeDecision.value != null && feeDecision.value.severity !== 'internal')

// TON BAKIYE KARARI -- MODA GORE, GONDERIM ANINDA DEGIL.
//
// Iki pay role modunda kullanicidan ISTENMEZ, cunku ikisini de roleci fonluyor:
//   - jetton'un ilisik TON'u (JETTON_ATTACH_TON): hedef jetton cuzdaninin gazi
//   - duz TON'un ihtiyat payi (TON_FEE_RESERVE): ag ucreti
// Kart zaten role modunda ucreti SIFIR gosteriyor (`gasNativeAmount`); kontrolun
// yine de pay istemesi, EKRANIN SOYLEDIGI ile BUTONUN YAPTIGINI ayirirdi.
//
// AMA GONDERILEN TUTAR ROLE MODUNDA DA KULLANICIDAN CIKAR. Paymaster'in 2026-09-14
// cevabi (bolum 5) bunu acikca soyluyor: `amountNano` HICBIR ZAMAN sponsorlanmaz;
// rolecinin ilistirdigi TON yalniz HEDEF kontratin gazini fonlar. Tutar yetmezse
// ATS TAHSIL EDILIR ve islem zincirde duser -- "ucret alindi, teslim edilmedi".
// Bu yuzden paylar sifirlanir, bakiye kontrolunun KENDISI kalir.
const tonInsufficient = computed(() => {
  if (!isTonNetwork.value) return false
  // FAIL-CLOSED: okuma dustuyse ucretin karsilandigini BILMIYORUZ.
  if (tonBalanceOkunamadi.value) return true
  const tonBalance = tonBalanceOkunan.value
  // HENUZ OKUNMADI -> "yetersiz" DEMEYIZ: kirmizi kart daha okuma bitmeden
  // yanip sonerdi. Buton bu arada zaten `isCheckingBalance` ile kapali.
  if (tonBalance === null) return false
  if (isTonJetton.value) {
    return !jettonSendFits({
      jettonAmount: crypto.transactionData.amount,
      jettonBalance: tonJettonBalanceOkunan.value,
      tonBalance,
      attach: sendWithTonRelay.value ? 0 : JETTON_ATTACH_TON,
    })
  }
  return !tonSendAmountFits({
    amount: crypto.transactionData.amount,
    balance: tonBalance,
    reserve: sendWithTonRelay.value ? 0 : TON_FEE_RESERVE,
  })
})

// NATIVE BAKIYE YETERSIZLIGININ TEK OKUMA NOKTASI. Sablondaki kirmizi kart,
// `feeBlocked` ve `confirmLabel` UCU DE bunu okur -- ucu ayri kaynaga baglanirsa
// buton kapali kalirken kart cizilmeyen (ya da tersi) bir durum dogar.
const nativeBalanceShort = computed(() => isTonNetwork.value ? tonInsufficient.value : insufficientGas.value)

// Islem bloklanir:
//  - ATS kolunda: ucret alinamadi/yetersiz VEYA gonderilen native tutari karsilanmiyor
//  - TON relay kolunda: yukaridaki bloklayici ucret karari
//  - digerlerinde: (native gas yetersiz VE token secilmemis) VEYA secili token yetersiz
const feeBlocked = computed(() => isAtsTransfer.value
  ? (atsBlocked.value || nativeAmountInsufficient.value)
  : (tonFeeBlocked.value || (nativeBalanceShort.value && !gasToken.value) || selectedInsufficient.value))

// Onay butonunun metni BLOKLAMA SEBEBINI soylemeli.
//
// Eskiden her blok "Yetersiz Bakiye" yaziyordu. ATS kolunda blok sebebi cogu zaman bakiye
// DEGILDIR (kurulum gerekli, kaynak-zincir izni yetersiz, /status hazir degil) ve bu metin
// kullaniciyi olmayan bir sorunu cozmeye — daha fazla ATS almaya — iter: 2026-08-10'da
// hesapta 955 ATS varken 19,5 ATS'lik bir islem icin "Yetersiz Bakiye" yaziyordu.
// Native/dapp kolunda sebep gercekten bakiyedir; orada metin AYNEN kalir - ama artik
// cipilak `true` DEGIL, o kolun GERCEK bakiye kosulu olculur: TON relay kolu ayni dala
// dusuyor ve orada sebep cogu zaman bakiye DEGIL (kurulum gerekli, /status okunamadi).
// Bakiye gercekten yetmiyorsa o kazanir - daha eyleme donuk sebep odur.
const confirmLabel = computed(() => {
  if (!feeBlocked.value) return t('send.confirmTransaction.confirm')
  const balanceIsTheReason = isAtsTransfer.value
    ? (atsInsufficient.value || nativeAmountInsufficient.value)
    : ((nativeBalanceShort.value && !gasToken.value) || selectedInsufficient.value)
  return balanceIsTheReason
    ? t('send.confirmTransaction.insufficientBalance')
    : t('send.confirmTransaction.atsCannotSend')
})

// Ag logosu: chain-list logoURI'si, yoksa /chains/<id>.png. Native fee-token icin de bu kullanilir.
const networkLogo = computed(() =>
  network.currentNetwork?.logoURI || `/chains/${network.currentNetwork?.chainId}.png`)

// ATS token gorseli config'ten gelir (gecici monogram; gercek marka logosu atsConfig.token.logoURI).
const atsCfg = computed(() => getAtsConfig(network.currentNetwork?.chainId))

// LOGO ZINCIRE BAGLI DEGILDIR. Eskiden `atsCfg.value?.token?.logoURI || ''`
// idi ve TON'da `atsCfg` NULL: ATS_CHAINS yalnizca EVM zincirlerini tutuyor
// (ucret TON'da da ATS ile odeniyor ama tahsilat BSC'de). Sonuc: TON'da her
// ATS kartinda logo `v-if`e takilip GIZLENIYORDU -- TON relay ucret karti
// TON'a OZEL oldugu icin oradaki logo hicbir zaman gorunmedi.
//
// Varlik her zincirde AYNI varlik, dolayisiyla isareti de ayni. Zincir kaydinda
// bir deger varsa o kullanilir (ileride zincire ozel bir isaret gerekirse yol
// acik kalsin), yoksa paylasilan sabite dusulur -- ama ASLA bos kalmaz.
const atsLogoURI = computed(() => atsCfg.value?.token?.logoURI || ATS_LOGO_URI)
// Gonderilen varligin logosu: kendi logosu yoksa VE gonderilen ATS ise ATS logosunu kullan,
// aksi halde default-token (bozuk logo @error dongusu de default'a duser).
const sentAssetLogo = computed(() => {
  // `tokenLogo` bos dize doner ki asagidaki ATS dali calisabilsin.
  const direct = tokenLogo(crypto.sendAsset, '')
  if (direct) return direct
  const asset = crypto.transactionData.asset, ats = atsCfg.value?.token?.address
  if (asset && ats && String(asset).toLowerCase() === String(ats).toLowerCase()) return atsLogoURI.value
  return '/default-token.png'
})

// Gaz ucreti ham olarak 15+ haneli gelebilir (0.000003072446223) — satiri tasirir.
// Kompakt goster: >=0.0001 ise 6 ondalik, daha kucukse 4 anlamli hane. Tam deger :title'da.
const gasDisplay = computed(() => {
  const n = Number(gas.value)
  if (!gas.value || !isFinite(n)) return gas.value
  if (n === 0) return '0'
  if (n >= 0.0001) return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return Number(n.toPrecision(4)).toString()
})

// GAZ UCRETININ DOLAR KARSILIGI.
//
// Kartin UC dali da ayni cinsten bir sayi gosteriyor: aktif zincirin NATIVE
// varliginda bir ucret (jettonda iliştirilen TON, TON self-pay'de ihtiyat payi,
// digerlerinde canli gaz tahmini). Dolar satiri bu yuzden dallarin ALTINDA tek
// bir yerde duruyor -- uc kopya olsaydi biri duzeltilip digerleri geride
// kalirdi ve kartin hangi dalda ne gosterdigi ekrandan takip edilemezdi.
const gasNativeAmount = computed(() => {
  if (isTonJetton.value) return JETTON_ATTACH_TON
  if (isTonNetwork.value && !sendWithTonRelay.value) return TON_FEE_RESERVE
  return gas.value
})

const nativePrice = useUsdPrice({
  tokenBalances: () => user.tokenBalances,
  apiBase: () => config.api,
})

// ATS ayri bir ornek: gaz ucreti native varlikta, ATS ucreti ATS'te olculuyor ve
// ikisi AYNI ekranda yan yana duruyor. Tek ornek paylasilsaydi biri otekinin
// fiyatini ezerdi (composable'da bunu olcen bir test var).
const atsPrice = useUsdPrice({ apiBase: () => config.api })

// Fiyat ya da tutar BILINMIYORSA `null` -> satir HIC cizilmez. Sifirli bir dolar metni yazmak
// bu ekranda "ucret bedava" demek olurdu (assetPrice.js'teki ayni kural).
const gasUsdText = computed(() => formatUsd(tokenToUsd(gasNativeAmount.value, nativePrice.price.value)))

// ATS KARTLARININ DOLAR KARSILIGI. Uc kart, uc AYRI tutar - ortak olan yalnizca
// fiyat. Tek bir "atsUsd" yapilamaz: kartlar ayni anda gorunebiliyor ve her biri
// KENDI sayisini aciklamak zorunda (odenecek ucret / eksik bakiye ayri seyler).
const atsUsd = (amount) => formatUsd(tokenToUsd(amount, atsPrice.price.value))

const atsFeeUsdText = computed(() => atsUsd(atsFeeTotal.value))
const tonAtsFeeUsdText = computed(() => atsUsd(tonFee.atsMaxFee.value))
const atsShortfallUsdText = computed(() => atsUsd(atsShortfall.value))

// "Yetersiz ATS" uyari karti. Tutar bu kartta bir CUMLENIN ICINDE geciyor
// (atsInsufficientDesc), o yuzden dolar cumleye sokulmaz -- ceviriyi bozardi ve
// iki dilde de kirilgan olurdu. Altina kendi satiri olarak eklenir.
const atsRequiredUsdText = computed(() => atsUsd(requiredAts.value))

// Ucret notu. Kosullar `gasNativeAmount` ile AYNI sirada okunur - not, altinda
// durdugu sayiyi acikliyor; ikisi ayrisirsa kart jetton tutarinin altina TON
// self-pay notunu basardi.
const feeNoteKey = computed(() => {
  if (isTonJetton.value) return 'confirm.jetton_fee_note'
  if (isTonNetwork.value && !sendWithTonRelay.value) return 'confirm.ton_fee_note'
  return null
})

// ATS miktarlari icin kompakt gosterim (gasDisplay ile ayni kural).
//
// GOVDE ARTIK BURADA DEGIL: utils/atsAmountFormat.js. Kural degismedi, YERI
// degisti - ayni bolum (AtsShortfallNote) takas ekraninda da ciziliyor ve orasi
// kendi `fmt`siyle (toFixed(4)) yaziyordu: eksik 0.00004 ATS takasta "0", 8.583333
// ise "8.5833" gorunuyordu. Iki ekranin AYNI sayiyi farkli soylemesi, gosterilen
// kadar yukleyip yine bloklu kalan kullanici demekti. Yerel ad KORUNUYOR ki bu
// dosyadaki cagrilar ve onlarin gerekce yorumlari oldugu gibi kalsin.
const atsCompact = formatAtsAmount

// Ucret satiri: bu GONDERIMIN TOPLAM ag ucreti. Bootstrap modunda iki op gider ve her biri
// ayri ayri tahsil edilir; tek op'un ucretini gostermek kullaniciya odeyeceginin YARISINI
// gosterirdi (useAtsFee.feeTotal = per-op x opCount).
const atsFeeDisplay = computed(() => atsCompact(atsFeeTotal.value))
// Ekrandaki tutar kompakt (6 ondalik); tam deger :title'da durur ki kullanici
// gercekte ne kadar kesilecegini gorebilsin.
const atsTotalExact = computed(() => atsFeeTotal.value == null ? '' : `${atsFeeTotal.value} ${atsSymbol.value}`)
// Uyari karti: bloklamayi kaldiracak TOPLAM (ATS gonderiliyorsa ucret + tutar).
// Burada ucreti gostermek kullaniciyi yaniltirdi: gosterilen kadar yukleyip yine
// bloklu kalirdi.
const atsRequiredDisplay = computed(() => atsCompact(requiredAts.value))

// --- "Daha ne kadar ATS gerekli" karti (2026-09-01) -------------------------------
//
// ONCEKI DAVRANIS: bakiye yetmeyince ekranda YALNIZ "BSC aginda ATS gerekli" yazan
// kehribar bir uyari cikiyordu. KAC ATS gerektigi HICBIR YERDE yoktu - kullanici
// tahminen yukleyip ayni kartla geri donuyordu. EVM kolunda tutari SOYLEYEN bir kart
// zaten vardi ama `action === 'buy-ats'` iken bilerek BASTIRILIYORDU (asagidaki
// v-else-if), yani tam da sayinin gerektigi durumda gizleniyordu.
//
// ARTIK: ucret ("quote") kartiyla AYNI tasarimda, kahraman sayisi EKSIK MIKTAR olan
// bir kart cizilir; kehribar uyari o durumda cizilmez.
const atsFuel = useAtsFuel()

// Gereken TOPLAM ATS. Iki kolun kaynagi FARKLI ve olmak zorunda:
//   EVM  -> useAtsFee.requiredAts (ucret + ATS gonderiliyorsa tutar) - teklif ELDE.
//   TON  -> /status budget'in minChargeAts'i - cunku bakiye yetmeyince TON teklifi
//           hic donmez, `atsMaxFee` yoktur ve geriye tek sayi kaynagi budur.
//           budget.commissionAts EKLENMEZ: o alan EVM batch'ini KURMAK icin gereken
//           komisyon tahminidir ve TON akisi o batch'i hic kurmaz (bkz. atsShortfall.js).
const atsRequiredForShortfall = computed(() => isTonNetwork.value
  ? atsRequiredFromBudget(tonFee.budget.value)
  : requiredAts.value)

// Bakiye ZINCIRDEN okunur (ATS_FUEL_BALANCE, her zaman BSC). /status'un
// `budget.srcBalance`i BU is icin KULLANILAMAZ: chainId=56 sorgusunda sabit "0"
// donuyor (canli olcum 2026-09-01 - hesapta 20 ATS varken). Ondan hesaplanan bir
// "eksik" kullaniciya gerekenin TAMAMINI yukletirdi.
const atsShortfall = computed(() => atsShortfallAmount({
  required: atsRequiredForShortfall.value,
  balance: atsFuel.balance.value,
}))
const atsShortfallDisplay = computed(() => atsCompact(atsShortfall.value))
const atsBalanceDisplay = computed(() => atsCompact(atsFuel.balance.value))
const atsRequiredTotalDisplay = computed(() => atsCompact(atsRequiredForShortfall.value))

// Kart YALNIZ sunucu "ATS satin al" dedigi durumda ve YALNIZ gercek bir sayi
// hesaplanabildiginde cizilir. Sayi yoksa (bakiye okunamadi, budget gelmedi) kehribar
// uyari YERINDE KALIR: sayisiz bir "eksik bakiye" karti eskisinden daha iyi degil.
const showAtsShortfall = computed(() =>
  (isAtsTransfer.value || tonFeeDecisionActive.value) &&
  !feeLoading.value &&
  feeDecision.value?.action === 'buy-ats' &&
  atsShortfall.value != null)

// Eksik-bakiye bolumu UCRET KARTININ ICINDE durur (iki kolda da). Hicbir ucret karti
// cizilmiyorsa kendi kartiyla cizilir -- bu YEDEK DEGIL, gercek bir durum: TON kolunda
// bakiye yetmeyince teklif hic donmez ve kart `atsMaxFee != null` kuralina takilir.
// Kosullar kartlarin kendi `v-if`leriyle BIREBIR ayni ifadeden turetilir; ayrisirsa
// bolum ya iki kez cizilir ya da hic cizilmez.
const atsFeeCardShown = computed(() => isAtsTransfer.value && !isTonNetwork.value)
const shortfallStandalone = computed(() => !atsFeeCardShown.value && !sendWithTonRelay.value)

// Bakiye/gas tahmini -- EVM'in ethers yolu (provider, gas limiti, fee data). Ayri
// bir fonksiyon olarak tutuluyor ki onMounted TON'da bunu HIC CAGIRMASIN: TON'da
// network.rpc null ve ethers v6 JsonRpcProvider(null)'i sessizce localhost:8545'e
// dusurur. Icerik AYNEN korunuyor, yalnizca cagrisi kosullu.
//
// SOLANA DA BURADAN GECER ve bu bilincli: govdenin ILK dali `vm === 'solana'` olup
// hicbir ethers cagrisi yapmadan erken doner (asagidaki yorum). Ad "Evm" diyor cunku
// bu fonksiyonun ayrilma SEBEBI TON'u disarida birakmakti; Solana icin ucuncu bir
// fonksiyon acmak `isCheckingBalance` / `insufficientGas` / `gas` sozlesmesini uc
// yerde tutmak demekti -- birlestirmeden once tam olarak bu tur ikizlesmeler
// yuzunden iki dal ayni hatayi ayri ayri buldu.
//
// GUVENLIK KAPISI DEGISMEDI: onMounted TON'da bunu cagirmaz, Solana'da cagirir ve
// Solana dali ethers'a dokunmadan doner. Ucu de kendi yolunda `isCheckingBalance`i
// `finally` icinde birakir.
async function checkEvmGasAndBalance() {
    isCheckingBalance.value = true

    // Solana TAMAMEN AYRI bir yol: ATS/gasless/dapp mantiginin hicbiri EVM
    // zincir kimligine (Number(chainId)) baglidir ve Solana'nin metin kimligiyle
    // (isAtsChain/isGaslessChain) zaten hep FALSE doner — ama JsonRpcProvider(
    // network.rpc) burada CAGRILMAMALI: Solana kaydinda rpc alani YOK (vm.js),
    // provider olusturmak/estimateGas cagirmak ya hemen patlar ya da anlamsiz
    // bir uca gider. Bu yuzden EVM gas tahmini denenmeden dallanip erken donulur.
    if (vm.value === 'solana') {
        solanaSendError.value = null
        try {
            const from = crypto.transactionData.from

            const ctx = await prepareTransferContext({ from, to: crypto.transactionData.to, mint: mint.value })
            solanaContext.value = ctx
            gas.value = String(ctx.feeLamports / LAMPORTS_PER_SOL)

            // Bu ekran SON DURAKTIR: Send.vue'nun ayri bir aninda okudugu bakiye
            // BAYAT olabilir (EVM dalinin burada KENDI gas tahminini yapmasiyla
            // ayni ilke) — bakiye burada TAZE okunur.
            const assets = from ? await fetchSolanaAssets(from) : []
            const solLamports = Math.round((assets.find(a => a.mint === SOL_NATIVE_MARKER)?.amount || 0) * LAMPORTS_PER_SOL)

            const amountLamports = mint.value === SOL_NATIVE_MARKER
                ? Math.round(Number(crypto.transactionData.amount) * LAMPORTS_PER_SOL)
                : 0 // SPL tutari SOL bakiyesini etkilemez; yalniz ucret+kira SOL'dan duser
            const ataCost = ctx.recipientAtaExists ? 0 : ctx.ataRentLamports

            // Gonderenin hesabi kira muafiyeti esiginin ALTINA duserse silinebilir
            // (bkz. buildTransferPlan/maxSendableSol); bu yuzden rentExemptLamports
            // de TOPLAM ihtiyaca eklenir, yalnizca fee+tutar+ATA DEGIL.
            const totalNeeded = ctx.feeLamports + ctx.rentExemptLamports + amountLamports + ataCost
            insufficientGas.value = solLamports < totalNeeded
        } catch (e) {
            console.error('Solana ucret/kira bilgisi alinamadi:', e)
            // FAIL-CLOSED: EVM dalindaki nativeAmountInsufficient ile ayni ilke —
            // ag durumu okunamadiysa gonderim karsilanip karsilanmadigi BILINMEZ.
            insufficientGas.value = true
            // KOD INCELEMESI (1. tur, bulgu 5): buraya kadar SADECE insufficientGas
            // isaretleniyordu, yani her AG hatasi (zaman asimi, 503, blockhash
            // okunamadi...) "Yetersiz Bakiye" olarak goruluyordu — 10 SOL'u olan
            // bir kullanici bile bu yanlis etiketi goruyordu. Dugme kapali kalmasi
            // (fail-closed) DOGRU; ama sebep artik dogru mesajla, ayri bir kirmizi
            // kartta (asagidaki solanaSendError, sendErrors.js uzerinden) gorunur.
            solanaSendError.value = t(resolveSolanaSendError(e?.message), { decimals: solanaDecimals.value })
        } finally {
            isCheckingBalance.value = false
        }
        return
    }

    try {
        const isToken = !!crypto.transactionData.asset

        const provider = new ethers.JsonRpcProvider(network.rpc)
        const nativeBalance = await provider.getBalance(crypto.transactionData.from || user.address)

        // İşlemi build edip gerçek gas limitini çekiyoruz
        const tx = await buildTransaction({
            provider,
            from: crypto.transactionData.from || user.address,
            to: crypto.transactionData.to,
            amount: crypto.transactionData.amount,
            asset: crypto.transactionData.asset
        })

        // Gas estimate başarısız olursa (örneğin contract reject ederse) standart transfer limiti
        const gasLimit = await provider.estimateGas(tx).catch(() => isToken ? 65000n : 21000n)
        const feeData = await provider.getFeeData()
        const maxFeePerGas = feeData.maxFeePerGas || feeData.gasPrice || 0n

        // Toplam ödenecek tahmini ağ ücreti (Wei cinsinden)
        const totalGasCostWei = gasLimit * maxFeePerGas

        // GÖSTERİLEN ücret ile bakiye kontrolünde kullanılan ücret AYNI sayıdan gelir.
        // Önce getEstimatedGas ile ayrı bir tahmin yapılıyordu; o çağrı token
        // gönderimlerinde calldata'sız (düz ETH transferi gibi) tahmin ettiği için
        // ~21000 gaz üzerinden, yani gerçeğin yaklaşık üçte biri kadar bir ücret
        // gösteriyordu — ekrandaki ücret uygun görünürken "yetersiz bakiye" uyarısı
        // çıkabiliyordu.
        gas.value = ethers.formatEther(totalGasCostWei)

        // Eğer gönderilen şey Native Token (ETH, BNB) ise; miktar + gas ücretini toplamalıyız
        let amountToSendWei = 0n
        if (!isToken) {
            amountToSendWei = ethers.parseEther(crypto.transactionData.amount.toString())
        }

        // Bakiye, ödenmesi gereken toplam Native miktardan küçükse uyarı ver
        if (nativeBalance < (totalGasCostWei + amountToSendWei)) {
            insufficientGas.value = true
        } else {
            insufficientGas.value = false
        }

        // ATS kolu icin ayri olcut: gas haric, yalnizca gonderilen native tutar.
        nativeAmountInsufficient.value = isNativeAmountInsufficient({
            nativeBalance: Number(ethers.formatEther(nativeBalance)),
            isNativeSend: !isToken,
            sendAmount: crypto.transactionData.amount,
        })
    } catch (e) {
        console.error("Gas / Balance check error:", e)
        // FAIL-CLOSED: bakiye/gas okumasi patladiysa gonderilen native tutarin
        // karsilandigini BILMIYORUZ. ATS kolunda "false" birakmak, bakiyesi yetmeyen
        // native gonderimin userOp'unu execution fazinda revert ettirir; bu da paketteki
        // approve'u geri alip postOp'un transferFrom'unu dusurur -> EntryPoint ucreti
        // PAYMASTER'dan keser, ATS tahsil edilemez. Her RPC hiccup'i bedava sponsorluk
        // olmasin diye burada bloklu tarafta kaliyoruz.
        nativeAmountInsufficient.value = true
    } finally {
        isCheckingBalance.value = false
    }
}

// BULGU 1 (merge engelleyici) — TON'da native bakiye + ucret payi (TON_FEE_RESERVE)
// kontrolu. Send.vue Onizle asamasinda AYNI kontrolu zaten yapiyor (tonSendAmountFits)
// ama bu SON kapi: iki ekran arasinda bakiye DEGISMIS olabilir (ayni hesaptan baska
// bir gonderim daha, RPC gecikmesi, vb.) ve eskiden burada HICBIR kontrol yoktu —
// `insufficientGas` TON'da HEP false kalip Onayla duğmesi HER ZAMAN acikti. Sonuc:
// PAY_GAS_SEPARATELY | IGNORE_ERRORS altinda ucret karsilanamayinca mesaj sessizce
// duser, cuzdan yine de "basarili" gosterirdi (bkz. tonSend.js yorumlari).
//
// `insufficientGas` EVM'in checkEvmGasAndBalance'inin kullandigi AYNI degisken:
// sablondaki "yetersiz ag ucreti" karti ve Onayla'yi kilitleyen `feeBlocked` bunu
// zaten okuyor — TON icin ayri bir UI dalina GEREK YOK.
async function checkTonFeeSufficiency() {
    isCheckingBalance.value = true
    try {
        const { active_account } = await chrome.storage.local.get('active_account')
        const tonAddress = await ensureTonAddress(active_account, {
            testnet: Boolean(network.currentNetwork?.testnet),
        })
        // BULGU 3: "Gonderen" satiri icin de kullanilir (yukaridaki fromAddress computed).
        tonFromAddress.value = tonAddress
        const client = getTonClient(config.api)
        const tonBalance = await getTonBalance(client, tonAddress)

        if (isTonJetton.value) {
            // JETTON: IKI AYRI bakiye. Jetton bakiyesi ZINCIRDEN TAZE okunur -
            // Send.vue'daki okumaya guvenilmez, iki ekran arasinda bakiye
            // degismis olabilir (ayni hesaptan baska bir gonderim, gecikmis
            // onay). Bu SON kapidir.
            const walletAddress = await getJettonWalletAddress({
                client,
                owner: tonAddress,
                master: crypto.sendAsset.address,
                chainId: network.currentNetwork.chainId,
                storage: chrome.storage.local,
            })
            const jettonBalance = await getJettonBalance({
                client,
                walletAddress,
                decimals: crypto.sendAsset?.decimals,
            })
            tonJettonBalanceOkunan.value = jettonBalance
        }
        // KARAR BURADA YAZILMAZ (bkz. tonInsufficient): bu fonksiyon `tonFee.load`
        // COZULMEDEN once kosuyor, yani role modunu goremez.
        tonBalanceOkunan.value = tonBalance
        tonBalanceOkunamadi.value = false
    } catch (e) {
        // FAIL-CLOSED: bakiye okunamadiysa (proxy dustu, kasa kilitli - WALLET_LOCKED,
        // RPC hatasi) ucretin karsilandigini BILMIYORUZ. checkEvmGasAndBalance'daki
        // AYNI karar (asagidaki yorum) burada da gecerli: bir RPC/kasa hiccup'i
        // Onayla duğmesini ACMAMALI.
        console.error('TON bakiye/ucret kontrolu basarisiz:', e.message)
        tonBalanceOkunamadi.value = true
    } finally {
        isCheckingBalance.value = false
    }
}

onMounted(async() => {
    // Gaz ucretinin dolar karsiligi. BEKLENMEZ (`await` YOK): fiyat yalnizca
    // ikincil bir satiri besliyor, gelmemesi ekranin kurulmasini geciktirmemeli
    // -- bu ekranda asil is bakiye/gaz kontrolu ve onlar sirada beklememeli.
    nativePrice.loadNative(network.currentNetwork?.chainId)

    // ATS fiyati AYNI kuralla: beklenmez, ikincil satirlari besler. Kimlik
    // zincire gore degismez -- ucret her zaman BSC'deki gercek ATS'ten tahsil
    // edilir (atsConfig.js'teki ATS_COINGECKO_ID notu).
    atsPrice.loadById(ATS_COINGECKO_ID)

    // Guvenilir adres listesi kendi hata yolunda: depo okumasi patlarsa gas/bakiye
    // kontrolu yine calissin (loadTrusted kendi icinde yutar). ZINCIRDEN BAGIMSIZ:
    // zehirli adres / itibar / gecmis karsilastirma kontrolleri hem TON'da hem
    // Solana'da calismali, bu yuzden asagidaki EVM kapisinin DISINDA, kosulsuz.
    //
    // `user.address` YEDEGI YALNIZCA EVM'DE gecerlidir. O bir EVM (0x...) adresidir;
    // Solana'da onu yedek olarak kullanmak, adres guvenligi katmanina CUZDANIN KENDI
    // ADRESI diye BASKA bir VM'in adresini vermek demektir: `isSelfSend` hicbir zaman
    // eslesmez ve "kendi adresine gonderiyorsun" uyarisi Solana'da SESSIZCE olur.
    // Send.vue tam olarak bu yedegi tasiyordu, duzeltildi ve test ile kilitlendi
    // (bkz. sendGuards/useAddressSecurity testleri).
    //
    // Bugun Send.vue her iki VM'de de `from` yaziyor, yani yedek ULASILMAZ -- ama
    // hicbir sey onu ulasilabilir kilmayi engellemiyordu (Solana'da
    // `active_account.solanaAddress` tanimsizsa `from` undefined olur).
    //
    // TON'da yedek KALIYOR: orada `from` zaten 0x'tir (Send.vue'nun EVM dali yazar)
    // ve loadTrusted'in TON kimligini cozmesi ensureTonAddress'i bir kez daha
    // cagirmak olurdu -- bu, kasa kilitliyken guvenlik kontrollerini TAMAMEN
    // susturma riski demek. Ayri bir bulgu olarak raporlandi, burada davranis
    // main dalindaki haliyle korunuyor.
    await loadTrusted({
        chainId: network.currentNetwork.chainId,
        myAddress: vm.value === 'solana'
            ? crypto.transactionData.from
            : (crypto.transactionData.from || user.address)
    })

    // TON EVM DEGIL: network.rpc TON'da null, ve ethers.JsonRpcProvider(null) ethers v6'da
    // sessizce localhost:8545'e duser (kutuphanenin varsayilan davranisi) — kullaniciya
    // gorunmeyen, gereksiz ve yaniltici bir ag cagrisi olurdu. checkEvmGasAndBalance TON'da
    // HIC cagrilmaz; onun yerine TON'a ozel checkTonFeeSufficiency cagrilir (yukaridaki
    // yorum) — ekranda gosterilen ihtiyat payi (TON_FEE_RESERVE) artik gercekten
    // BAKIYEYE KARSI da dogrulaniyor, yalniz bir metin degil.
    if (isTonNetwork.value) {
        await checkTonFeeSufficiency()
        // TON gasless ucret onizlemesi - `tonFromAddress` yukaridaki
        // checkTonFeeSufficiency BITTIKTEN SONRA doludur (ensureTonAddress onu
        // orada cozer). `tonPublicKey` arka plandan ONCE alinir: onsuz useTonFee
        // teklife HIC gitmez ve kart tutar gosteremez (Task 8'de ekranda
        // gorulen eksik buydu).
        await loadTonFeeIdentity()
        await tonFee.load(tonFeeLoadArgs())
    } else {
        await checkEvmGasAndBalance()
    }

    // BSC'deki ATS bakiyesi - "daha ne kadar gerekli" kartinin ikinci girdisi
    // (birincisi gereken tutar). AWAIT EDILMEZ: bu kart bir YARDIMDIR, onay
    // ekraninin acilmasini bir balanceOf'un arkasina koymak dogru degil; useAtsFuel
    // kendi hatalarini zaten yutuyor (pill'i header'da dusurmemek icin) ve sonuc
    // gelince kart kendiliginden cizilir.
    //
    // YALNIZ ATS/TON kollarinda: duz native bir gonderimde ATS'nin hicbir rolu yok,
    // orada bir balanceOf tamamen israf olurdu.
    if (isTonNetwork.value || isAtsChain(network.currentNetwork.chainId)) {
        atsFuel.load(user.address, network.currentNetwork.chainId)
    }

    // DApp Kontrolü
    if(!crypto.sendAsset && crypto.transactionData.asset) {
        // KAYNAK AKTIF SEKMEDEN OKUNMAZ. Burada eskiden
        // aktif sekmeden origin/ikon okuyan kod vardi ve
        // ekranda gosterilen origin/ikon oradan geliyordu. Dogru kaynak istegin
        // KENDI kaydidir (`current_request.origin`) ve dapp onayinin gercek
        // ekrani olan Dapp.vue zaten oyle yapiyor. Yan panel sekme degisiminde
        // ayakta kaldigi icin bu kalip orada dogrudan bir imza tuzagi olurdu.
        // Kaynak kilidi: ConfirmTransaction.solana.ssr.test.js.

        from_dapp.value = true
        
        try {
            const { data } = await axios.post(config.api + '/getTokenByAddress', {
                address: crypto.transactionData.asset
            })
            if (data.token) crypto.sendAsset = data.token
        } catch (e) {
            console.error("Token fetch error", e)
            crypto.sendAsset = { symbol: 'UNKNOWN', name: 'Unknown Token' }
        }
    }

    // UCRET KOLU (spec §2) — ATS ve gasless (token ile gas) ikisi de EVM'e ozel kavramlar
    // (paymaster, bundler, ERC-20 gas token). TON'da bu karar HIC alinmaz.
    if (!isTonNetwork.value) {
        await applyEvmFeeBranch()
    }
})

// UCRET KOLU (spec §2) — karar saf fonksiyonda, burasi yalnizca uygular. Yalnizca EVM'de
// cagrilir (bkz. onMounted): 'dapp' dalindaki gasless token secenekleri ve 'ats' dalindaki
// paymaster teklifi TON'da anlamsizdir.
async function applyEvmFeeBranch() {
    const feeBranch = pickFeeBranch({
        fromDapp: from_dapp.value,
        atsEnabled: isAtsChain(network.currentNetwork.chainId),
    })

    if (feeBranch === 'dapp') {
        if (isGaslessChain(network.currentNetwork.chainId)) {
            const { dapps = {} } = await chrome.storage.local.get('dapps')
            if (url.value && dapps[url.value] && dapps[url.value].gasless) {
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
    } else if (feeBranch === 'ats') {
        isAtsTransfer.value = true
        await runAtsQuote()
    }
}

// ATS ucret teklifini (yeniden) calistirir. Idempotent: "tekrar dene" butonu da
// bunu cagirir, acilistaki ilk yukleme de.
async function runAtsQuote() {
    // decimals() round-trip + arka plandaki teklif bitene kadar loading'i simdiden
    // isaretle; yoksa atsFee henuz null iken "yetersiz bakiye" karti yanlislikla gorunur.
    beginQuote()
    try {
        const provider = new ethers.JsonRpcProvider(network.rpc)
        const call = await buildTransaction({
            provider,
            from: crypto.transactionData.from || user.address,
            to: crypto.transactionData.to,
            amount: crypto.transactionData.amount,
            asset: crypto.transactionData.asset,
        })
        // Onboarding butonu tazeleme sirasinda ayni cagriyi kullanir; burada saklanir.
        //
        // markRaw: deger sablonda kullanilmiyor, yalnizca arka plana tasiniyor — reaktiflige
        // ihtiyaci yok ve ref'e konan duz nesne aksi halde gereksiz yere proxy'lenir.
        atsCall.value = markRaw({ to: call.to, value: call.value?.toString(), data: call.data })
        await loadAtsFee({
            chainId: network.currentNetwork.chainId,
            address: crypto.transactionData.from || user.address,
            call: atsCall.value,
            sentAssetAddress: crypto.transactionData.asset,
            sendAmount: crypto.transactionData.amount,
        })
    } catch (e) {
        // buildTransaction patlarsa loadAtsFee hic cagrilmaz; failQuote ayni
        // "quote basarisiz" kartini tetikler (unhandled rejection yerine).
        console.error("ATS quote error:", e)
        failQuote(e?.message || 'quote failed')
    }
}

// Onboarding karti butonu: nextSteps'i backend'in sirasiyla BSC'de kosturur (sifir BNB),
// bitince /status'u tazeler (ekran ready:true olana kadar bloklu kalir). `call` runAtsQuote'un
// sakladigi son teklif cagrisidir; adres kaynagi dosyadaki digerleriyle tutarlidir.
async function onRunOnboarding() {
    await runOnboarding({
        chainId: network.currentNetwork.chainId,
        address: crypto.transactionData.from || user.address,
        call: atsCall.value,
        sentAssetAddress: crypto.transactionData.asset,
        sendAmount: crypto.transactionData.amount,
    })
}

function serializeTx(tx) {
    const allowedFields = [
        'to', 'from', 'nonce', 'gasLimit', 'gasPrice', 
        'maxPriorityFeePerGas', 'maxFeePerGas', 
        'data', 'value', 'chainId', 'type'
    ]
    
    const out = {}

    for (const key of allowedFields) {
        if (tx[key] !== undefined && tx[key] !== null) {
            if (typeof tx[key] === "bigint") {
                out[key] = tx[key].toString() 
            } else {
                out[key] = tx[key]
            }
        }
    }

    return out
}

// SOLANA_SEND yaniti: `{ result: { signature, bookkeepingError? } }` YA DA
// `{ error }`. `res.result.signature` res.result DOGRULANMADAN OKUNMAZ: hicbir
// hata sinir otesine falsy gecemez (background.js) ama savunma ikinci kati
// olarak burada da falsy bir `error` + result yoklugu BASARI SAYILMAZ.
async function sendSolana() {
    solanaSendError.value = null

    const res = await chrome.runtime.sendMessage({
        type: 'SOLANA_SEND',
        to: crypto.transactionData.to,
        mint: mint.value,
        amount: crypto.transactionData.amount,
        decimals: solanaDecimals.value,
    })

    if (!res?.result?.signature) {
        // {decimals}: AMOUNT_EXCEEDS_PRECISION mesaji "en fazla N ondalik basamak"
        // diyor; digerleri bu parametreyi yoksayar (vue-i18n kullanilmayan
        // interpolasyonu sessizce atar), tek cagriyi tum kodlar icin ortak tutar.
        solanaSendError.value = t(resolveSolanaSendError(res?.error), { decimals: solanaDecimals.value })
        return false
    }

    // BELIRSIZ yayin: imza elimizde ve bekleyen kayit YAZILDI, ama islemin
    // zincire ulasip ulasmadigi BILINMIYOR. Ana ekrana GECILMEZ (kullanici ne
    // oldugunu okumali) ve `false` donulur; Onayla dugmesi sablonda v-if ile
    // kaldirildigi icin ikinci bir tiklama MUMKUN DEGIL.
    if (res.result.broadcastStatusUnknown) {
        console.warn('Solana yayini belirsiz dustu:', res.result.broadcastError, res.result.signature)
        solanaStatusUnknown.value = true
        return false
    }

    if (res.result.bookkeepingError) {
        // Islem ZATEN zincire gitti; yalnizca yerel kayit yazilamadi. Bunu
        // basarisizlik gibi gostermek kullaniciyi TEKRAR gondermeye iter —
        // bu da cift gonderim demektir (bkz. background.js sendSolanaTransfer).
        console.warn('Solana islemi yayinlandi ama kayit yazilamadi:', res.result.bookkeepingError)
    }
    return true
}

const send = async () => {
    if (isSubmitting.value) return;
    isSubmitting.value = true;
    try {
        // TON EVM DEGIL: buildTransaction/estimateGas/paymaster yolunun hicbiri gecerli
        // degil. Arka plan kendi imzalama yolunu kullanir.
        if (isTonNetwork.value) {
            // JETTON ve native TON AYRI aksiyonlardir. K1 (merge engelleyici) tam
            // olarak bunun eksikligiydi: jetton satirindaki Gonder duğmesi
            // SEND_TON_TRANSACTION'a gidiyor ve kullanicinin jettonu yerine
            // NATIVE TON'unu gonderiyordu - sessizce, yanlis varlikla.
            //
            // RELAY MODU ve ONAYLANAN UST SINIR ikisine de AYNEN gider (asagida
            // yayilir). Bayrak tek basina YETKI DEGIL - arka plan bolge/kasa/makbuz
            // kapilarini taze /status ile yeniden olcer. `approvedAtsFee` ise
            // kullanicinin EKRANDA GORDUGU tutarin ta kendisidir (feeAuth.atsMaxFee):
            // dogrulama (V10) sunucunun imzalatmak istedigi ucreti bununla
            // karsilastirir ve buyukse HICBIR SEY imzalanmaz.
            const tonRelayFields = {
                payWithTonFee: sendWithTonRelay.value,
                approvedAtsFee: tonFee.quote.value?.sign?.feeAuth?.atsMaxFee ?? null,
            }

            const response = await chrome.runtime.sendMessage(isTonJetton.value ? {
                type: "SEND_TON_JETTON",
                message: {
                    ...tonRelayFields,
                    chainId: network.currentNetwork.chainId,
                    to: crypto.transactionData.to,
                    amount: crypto.transactionData.amount,
                    // master ve decimals ZORUNLU. decimals'i burada `|| 9` gibi bir
                    // varsayilana dusurmek gonderilen miktari 1000 kat yanlis yapar
                    // (USDT-TON 6 kullanir); arka plandaki dort kapi eksik/gecersiz
                    // ondaligi JETTON_DECIMALS_MISSING ile reddeder.
                    master: crypto.sendAsset?.address,
                    decimals: crypto.sendAsset?.decimals,
                    symbol: crypto.sendAsset?.symbol,
                    // Kaydin KENDISI de gider: master/decimals/symbol gonderim icin
                    // yeterli ama karta TAM AD ve LOGO lazim -- onlar olmadan jetton
                    // satiri gri yer tutucuyla cizilir.
                    assetData: crypto.sendAsset,
                    comment: crypto.tonComment || '',
                    apiBase: config.api,
                },
            } : {
                type: "SEND_TON_TRANSACTION",
                message: {
                    ...tonRelayFields,
                    chainId: network.currentNetwork.chainId,
                    to: crypto.transactionData.to,
                    amount: crypto.transactionData.amount,
                    comment: crypto.tonComment || '',
                    apiBase: config.api,
                },
            })

            if (response && response.success === false) {
                console.error('TON gonderimi reddedildi:', response.error)
                isSubmitting.value = false
                return
            }

            if (!poisonMatch.value && !reputation.value.severity) {
                await recordSentRecipient(
                    crypto.transactionData.to,
                    crypto.transactionData.toLabel ?? null
                ).catch(e => console.warn('Alici kaydedilemedi:', e.message))
            }

            crypto.tonComment = ''
        // Islem GONDERILDI: gonder ekraninin taslagi artik gecmis. Burasi
            // temizlenmezse Send.vue bir daha kurulmadigi icin (dogruca ana ekrana
            // gidiliyor) taslak store'da asili kalir ve AYNI varliga bir sonraki
            // gonderimde eski alici ile eski tutar forma geri yazilirdi.
            crypto.sendDraft = null
            page.currentPage = 'home'
            return
        }

        if (vm.value === 'solana') {
            if (!(await sendSolana())) return
        } else {
            const provider = new ethers.JsonRpcProvider(network.rpc)

            const tx = await buildTransaction({
                provider,
                from: crypto.transactionData.from,
                to: crypto.transactionData.to,
                amount: crypto.transactionData.amount,
                asset: crypto.transactionData.asset
            })

            // ATS kolunda native gas tahmini KULLANILMAZ: background yalnizca to/value/data
            // okur. Ustelik ozelligin hedef kitlesi 0 native'li kullanici; estimateGas orada
            // patlar ve yakalanmayan hata ekrani sessizce onay ekraninda birakirdi.
            if (!isAtsTransfer.value) {
                const gasLimit = await provider.estimateGas(tx)
                const feeData = await provider.getFeeData()

                tx.gasLimit = gasLimit
                tx.maxFeePerGas = feeData.maxFeePerGas
                tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas
            }

            const serializedTx = serializeTx(tx)
            delete serializedTx.from

            const { active_account } = await chrome.storage.local.get('active_account')

            await chrome.runtime.sendMessage({
                type: "SEND_TRANSACTION",
                message: {
                    index: active_account.type === 'imported' ? active_account.address : active_account.derivationPath,
                    chainId: network.currentNetwork.chainId,
                    amount: crypto.transactionData.amount,
                    tx: serializedTx,
                    assetData: crypto.sendAsset,
                    // Adres defterindeki ad: kartta ham adres yerine okunur bir
                    // satir cizilsin diye. Ekranda (yukarida) ZATEN gosteriliyordu,
                    // eksik olan arka plana tasinmasiydi.
                    toLabel: crypto.transactionData.toLabel ?? null,
                    gasToken: gasToken.value,
                    atsTransfer: isAtsTransfer.value,
                    // Kullanicinin ONAYLADIGI teklif; executeAtsTransfer bunu approvedFee olarak
                    // kullanir. PER-OP ucret gonderilir (toplam DEGIL): tavan kontrolu her op'a
                    // ayri ayri uygulanir.
                    atsQuoted: isAtsTransfer.value
                      ? { transferFee: atsFee.value }
                      : undefined,
                    bundlerBase: config.bundlerBase
                }
            })
        }

        // Alici "daha once gonderdiklerim" listesine yazilir; bir sonraki gonderimde
        // zehirli ikizi bu kayda benzedigi icin yakalanir.
        //
        // Uyari CIKMIS bir adres BILEREK kaydedilmez: kullanici onay kutusunu isaretleyip
        // yine de gonderdiyse (yani muhtemelen tuzaga dustuyse) o adresi guvenilir sayip
        // sonraki gonderimlerde sessiz kalmak, tespiti kendi kendine kapatirdi. Ayni sebeple
        // itibar bayragi almis adres de kaydedilmez.
        if (!poisonMatch.value && !reputation.value.severity) {
            await recordSentRecipient(
                crypto.transactionData.to,
                crypto.transactionData.toLabel ?? null
            ).catch(e => console.warn('Alici kaydedilemedi:', e.message))
        }

        // Islem GONDERILDI: gonder ekraninin taslagi artik gecmis. Burasi
        // temizlenmezse Send.vue bir daha kurulmadigi icin (dogruca ana ekrana
        // gidiliyor) taslak store'da asili kalir ve AYNI varliga bir sonraki
        // gonderimde eski alici ile eski tutar forma geri yazilirdi.
        crypto.sendDraft = null
        page.currentPage = 'home'

    } catch (err) {
        console.error("SEND ERROR:", err)
        if (vm.value === 'solana') solanaSendError.value = t(resolveSolanaSendError(err?.message), { decimals: solanaDecimals.value })
    } finally {
        isSubmitting.value = false;
    }
}

// S4.7: PANELDE KAPANMA YOK. Burada ham bir pencere-kapatma cagrisi vardi ve
// panelde boyle bir cagri ya hicbir sey yapmaz (kullanici reddettigi ekranda
// ASILI kalir) ya da TUM paneli kapatir -- ikisi de cagri yerinin niyeti degil.
// Niyet "gonder ekranina don"du ve artik acikca yaziliyor. Pencere/popup
// modunda davranis AYNEN korunur: closeOrNavigate orada gercekten kapatir.
//
// `from_dapp` hala ConfirmTransaction'da kuruluyor (dapp yolu bu ekrani BUGUN
// acmiyor -- ConfirmTransaction.solana.ssr.test.js bunu kilitliyor -- ama dal
// "olduguna inanilan" durumda, kanitlanmis olu degil).
const reject = () => {
    if (from_dapp.value) {
        closeOrNavigate('send', { page })
        return
    }
    page.currentPage = 'send'
}

// tonFee.load() her basarili turden sonra 60sn'lik bir sessiz tazeleme
// zamanlayicisi kurar (bkz. useTonFee.js) - bilesen kapandiktan SONRA ates
// alip yikilmis bir bilesene karsi state yazmasin diye burada durdurulur.
onUnmounted(() => {
    tonFee.stop()
})
</script>