<template>
    <Transition
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-200 ease-in"
        enter-from-class="opacity-0 translate-y-4"
        enter-to-class="opacity-100 translate-y-0"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-4"
    >
        <AddressBook v-if="popups.addressBook" @select="setAddress"></AddressBook>
    </Transition>

    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-2 relative z-10">
            <Back page="select_asset" class="hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('send.title') }}</h1>
        </div>

        <!-- Zehirli adres karti acilinca icerik 600px'e sigmiyor: kaydirma olmadan
             tutar alani ve uyari kutusu ekranin altinda kaliyordu. Uyari yokken
             icerik zaten siğdigi icin kaydirma cubugu gorunmez. -->
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pt-4 flex flex-col gap-6 relative z-10">
            
            <div class="flex flex-col items-center gap-3 py-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-300"></div>
                    <img
                        :src="tokenLogo(crypto.sendAsset)"
                        :alt="crypto.sendAsset?.name"
                        class="relative w-16 h-16 rounded-full shadow-lg dark:shadow-2xl border-2 border-white dark:border-white/10 transition-colors duration-300"
                        @error="e => { e.target.onerror = null; e.target.src = '/default-token.png' }"
                    >
                    <div class="absolute max-w-40 -bottom-1 left-1/2 -translate-x-1/2 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-full px-1.5 py-0.5 flex items-center gap-2 shadow-sm dark:shadow-lg transition-colors duration-300">
                        <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        <span class="text-[8px] font-bold text-slate-500 dark:text-zinc-400 uppercase whitespace-nowrap mt-px transition-colors duration-300">{{ network.currentNetwork.name }}</span>
                    </div>
                </div>
                
                <div class="text-center mt-2">
                    <h2 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300">{{ crypto.sendAsset?.symbol?.toUpperCase() }}</h2>
                    <!-- balanceError true iken sayi YERINE "-" gosterilir: balance ref'i
                         baslangicta 0, hata yakalanip sayi hic guncellenmezse "0 bakiye"
                         gosterilmis olurdu — spec'in acikca yasakladigi durum. -->
                    <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('send.balance') }}: {{ balanceError ? '—' : Number(balance).toFixed(4) }}</p>
                    <p v-if="balanceError" class="text-[10px] font-medium text-red-500 dark:text-red-400 mt-1 transition-colors duration-300">{{ $t('send.balance_unavailable') }}</p>
                </div>
            </div>

            <!-- Varlik aktif zincire ait degil. KESIN sebepte gonderim kilitli (kirmizi),
                 SUPHELI sebepte yalnizca uyari (amber) — ayni adres birden cok zincirde
                 gecerli olabiliyor ve calisan bir gonderimi oldurmek yanlis olur. -->
            <div v-if="assetChainNotice" class="w-full rounded-xl p-3 flex items-start gap-3 border transition-colors duration-300"
                 :class="assetChainBlocked
                    ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
                    : 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'">
                <svg class="w-5 h-5 shrink-0 mt-0.5" :class="assetChainBlocked ? 'text-red-500' : 'text-amber-500'" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span class="text-xs leading-snug" :class="assetChainBlocked ? 'text-red-600 dark:text-red-300/80' : 'text-amber-600 dark:text-amber-300/80'">
                    {{ $t(assetChainNotice === 'foreign-asset' ? 'send.assetForeignAsset'
                         : assetChainNotice === 'chain-mismatch' ? 'send.assetChainMismatch'
                         : 'send.assetChainSuspect') }}
                </span>
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-xs font-medium text-slate-500 dark:text-zinc-400 ml-1 transition-colors duration-300">{{ $t('send.receiverAddress') }}</label>
                <div class="relative group">
                    <div class="absolute inset-0 bg-linear-to-r from-emerald-500/10 dark:from-emerald-500/20 to-transparent rounded-xl opacity-0 transition-opacity duration-500" :class="{ 'opacity-100': validAddress }"></div>
                    
                    <div class="relative flex items-center bg-white dark:bg-[#131315] border rounded-xl transition-colors duration-300 pe-3 shadow-sm dark:shadow-none"
                        :class="[
                            validAddress 
                                ? 'border-emerald-400 dark:border-emerald-500/50' 
                                : (to && !validAddress 
                                    ? 'border-red-400 dark:border-red-500/50' 
                                    : 'border-slate-200 dark:border-white/10 group-focus-within:border-indigo-400 dark:group-focus-within:border-indigo-500/50')
                        ]">
                        
                        <input
                            v-model="to"
                            type="text"
                            class="w-full bg-transparent p-3.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none font-mono transition-colors duration-300"
                            :placeholder="isTonNetwork ? $t('send.placeholder_address_ton') : '0x...'"
                        >

                        <!-- YAPISTIR. Fonksiyon dosyada zaten duruyordu ve `send.paste`
                             cevirisi iki dilde de var; yalnizca dugme bir tasarim
                             turunde dusmus. Panoya erisilemezse (uzantida
                             `clipboardRead` izni yok) alan degismez ve sebep
                             pasteFailed ile SOYLENIR - sessizce hicbir sey
                             yapmayan bir dugme, bozuk bir dugmeden beterdir. -->
                        <button
                            v-if="!to"
                            class="text-[10px] font-bold px-2 py-1 rounded-md text-slate-500 hover:text-indigo-600 dark:text-zinc-500 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors duration-300 cursor-pointer shrink-0"
                            @click="handlePaste"
                        >{{ $t('send.paste') }}</button>

                        <button class="text-slate-400 hover:text-indigo-500 dark:text-zinc-500 dark:hover:text-white transition-colors duration-300" @click="popups.addressBook = true">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
                        </button>
                    </div>

                    <!-- Yanlis agin adres bicimini isaret etmesin diye mesaj da aga gore secilir
                         (Task 11'de Al ekraninda duzeltilen sorunun ayni sinifi). -->
                    <p v-if="pasteFailed" class="text-[10px] text-amber-600 dark:text-amber-400 mt-1 ml-1 absolute -bottom-5 transition-colors duration-300">{{ $t('send.pasteFailed') }}</p>

                    <!-- UC VM, TEK MESAJ ALANI. Sira ONEMLI: en SPESIFIK sebep once.
                         RECIPIENT_NOT_WALLET digerlerinden AYRI bir siniftir -- adres
                         bicimsel olarak DOGRUDUR, yalnizca cuzdan degildir (muhtemelen bir
                         token hesabi) ve oraya giden para GERI ALINAMAZ; jenerik "gecersiz
                         adres" bunu kullaniciya soylemez. Sebep kodu yoksa (EVM/TON) aga
                         gore secilen jenerik mesaja dusulur. -->
                    <p v-if="to && !validAddress" class="text-[10px] text-red-500 dark:text-red-400 mt-1 ml-1 absolute -bottom-5 transition-colors duration-300">
                        {{ addressReason === 'RECIPIENT_NOT_WALLET' ? $t('send.recipientNotWallet')
                            : addressReason === 'INVALID_SOLANA_ADDRESS' ? $t('send.errors.invalidSolanaAddress')
                            : isTonNetwork ? $t('send.invalidAddressTon')
                            : $t('send.invalidAddress') }}
                    </p>

                    <div v-else-if="recipient && validAddress" class="absolute -bottom-5 mt-1 ml-1 flex items-center gap-1.5 transition-colors duration-300">
                        <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${recipient.address}`" class="w-3.5 h-3.5 rounded-full bg-white dark:bg-black border border-slate-200 dark:border-white/10" />
                        <span class="text-[10px] font-bold truncate max-w-55" :class="isSelfSend ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'">
                            {{ recipient.label }}<template v-if="isSelfSend"> · {{ $t('send.activeAccountHint') }}</template>
                        </span>
                    </div>
                </div>
            </div>

            <div v-if="isTonNetwork" class="mt-3">
                <label class="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                    {{ $t('send.ton_comment_label') }}
                </label>
                <input
                    v-model="tonComment"
                    type="text"
                    maxlength="120"
                    :placeholder="$t('send.ton_comment_placeholder')"
                    class="w-full mt-1 px-3 py-2 rounded-xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-800 text-sm text-slate-800 dark:text-zinc-200 outline-none focus:border-indigo-400 dark:focus:border-indigo-500/30 transition-colors"
                />
                <p class="mt-1 text-[10px] text-slate-500 dark:text-zinc-500">{{ $t('send.ton_comment_hint') }}</p>
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

            <div class="flex flex-col gap-2 mt-2">
                <!-- Sarma politikasi Swap.vue'daki "Odeyeceksin" satiriyla AYNI gerekce:
                     ekran koku artik 360px'e sabit degil, dar panelde etiket + dort cip tek
                     siraya sigmayabiliyor. Cipler alt satira iner, etiket kucumez. -->
                <div class="flex justify-between items-start gap-2 flex-wrap ml-1">
                    <label class="text-xs font-medium text-slate-500 dark:text-zinc-400 shrink-0 transition-colors duration-300">{{ $t('send.amount') }}</label>

                    <!-- Yuzde cipleri. Her biri HARCANABILIR bakiyeden pay alir (ucret
                         payi dusulmus), yani hicbir cip odenemez bir tutar uretemez.
                         MAX = %100 ve eski setMax ile birebir ayni sonucu verir.

                         BIRLESME: Solana dalinin kilidi (`solanaMaxDisabled`) TEK bir MAX
                         dugmesindeydi cunku o dalda tek dugme oydu. Kilit artik BUTUN
                         ciplere bagli: cipler AYNI harcanabilir tutardan pay aliyor, yani
                         ucret/kira baglami bilinmiyorsa %25 de %100 kadar yanlistir.
                         Kilidin sebebi sendMax.js'te: native SOL'da kira muafiyeti
                         minimumu bilinmeden hesaplanan bir tutar, hesabi kira esiginin
                         ALTINA dusurup sildirebilir. -->
                    <div class="flex flex-wrap items-center justify-end gap-0.5">
                        <button
                            v-for="percent in SEND_PERCENTS"
                            :key="percent"
                            @click="setPercent(percent)"
                            :disabled="solanaMaxDisabled"
                            class="text-[10px] font-bold px-1.5 py-0.5 rounded-md transition-colors duration-300"
                            :class="solanaMaxDisabled
                                ? 'text-slate-300 dark:text-zinc-700 cursor-not-allowed'
                                : 'text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 cursor-pointer'"
                        >{{ percent === 1 ? 'MAX' : $t('common.percentChip', { value: percent * 100 }) }}</button>
                    </div>
                </div>

                <div class="relative bg-white dark:bg-[#131315] border rounded-2xl p-4 flex flex-col items-center group shadow-sm dark:shadow-none transition-colors duration-300"
                     :class="!isValidAmount && amount ? 'border-red-400 dark:border-red-500/50' : 'border-slate-200 dark:border-white/10 focus-within:border-indigo-400 dark:focus-within:border-indigo-500/50'">

                    <!-- Birim degistirme. Fiyat bilinmiyorsa KILITLI: bilinmeyen bir
                         fiyat uzerinden dolar girisi, kullanicinin yazdigi tutari
                         sessizce bambaska bir miktara cevirirdi. -->
                    <button
                        @click="toggleUnit"
                        :disabled="!hasPrice"
                        :title="hasPrice ? $t('send.switchUnit') : $t('send.priceUnavailable')"
                        class="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-md border transition-colors duration-300"
                        :class="hasPrice
                            ? 'text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 cursor-pointer'
                            : 'text-slate-300 dark:text-zinc-700 border-slate-200 dark:border-white/5 cursor-not-allowed'"
                    >{{ unitLabel }}</button>

                    <input
                        v-model="rawInput"
                        type="number"
                        inputmode="decimal"
                        class="w-full bg-transparent text-4xl font-bold text-center text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-zinc-700 focus:outline-none caret-indigo-500 transition-colors duration-300 mt-4"
                        :class="{ 'text-red-500 dark:text-red-400': !isValidAmount && amount }"
                        placeholder="0"
                    >

                    <p class="text-xs font-medium mt-2 transition-colors duration-300" :class="!isValidAmount && amount ? 'text-red-500 dark:text-red-500/70' : 'text-slate-400 dark:text-zinc-500'">
                        <!-- Sira ONEMLI, en dar kapsam once: ucret yetmiyor (TON) ->
                             bakiye yetmiyor -> Solana ucret baglami okunamadi (cipler
                             kilitli, SEBEBI soylenir) -> karsi birim -> fiyat bilinmiyor. -->
                        <span v-if="insufficientForFee && amount">{{ $t('send.insufficientForFee') }}</span>
                        <span v-else-if="!isValidAmount && amount">{{ $t('send.insufficientBalance') }}</span>
                        <span v-else-if="solanaMaxDisabled">{{ solanaFeeErrorCode && isKnownSolanaSendError(solanaFeeErrorCode) ? $t(resolveSolanaSendError(solanaFeeErrorCode), { decimals: solanaDecimals }) : $t('send.feeUnavailable') }}</span>
                        <!-- KARSI birim. Fiyat yoksa "$0.00" YERINE fiyatin bilinmedigi
                             soylenir; duzeltilen hata tam olarak o "$0.00" idi. -->
                        <span v-else-if="counterValue">≈ {{ counterValue }}</span>
                        <span v-else>{{ $t('send.priceUnavailable') }}</span>
                    </p>
                </div>
            </div>
        </div>

        <div class="p-5 relative z-20 bg-slate-50 dark:bg-[#09090b] transition-colors duration-300 flex flex-col gap-3">
            <!-- Solana'da ice aktarilmis/privateKey hesaplar imzalayamaz. ONCEDEN
                 gosterilmezse kullanici "Onayla"ya basar ve pencere hicbir aciklama
                 olmadan kapanir (bkz. sendGuards.js / SOLANA_SEND background kapisi). -->
            <div v-if="blockReason" class="w-full rounded-xl p-3 flex items-start gap-3 border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 transition-colors duration-300">
                <svg class="w-5 h-5 shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span class="text-xs leading-snug text-red-600 dark:text-red-300/80">{{ $t('send.solanaUnsupportedAccount') }}</span>
            </div>

            <button
                @click="confirm"
                :disabled="!isFormValid"
                class="w-full py-4 rounded-2xl font-bold text-base tracking-wide flex items-center justify-center gap-2 transition-all duration-300 shadow-sm dark:shadow-lg"
                :class="isFormValid 
                    ? 'bg-linear-to-r from-emerald-500 to-emerald-400 dark:from-emerald-600 dark:to-emerald-500 text-white hover:scale-[1.02] shadow-emerald-500/20 cursor-pointer' 
                    : 'bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border-transparent dark:border-white/5'"
            >
                {{ $t('send.preview') }}
                <svg v-if="isFormValid" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, watch, computed } from 'vue'
import { networkStore } from '../store/network'
import { ethers } from 'ethers'
import { cryptoStore } from '../store/crypto'
import { useTokenBalance } from '../composables/useTokenBalance'
import { pageStore } from '../store/pageStore'
import Back from './Back.vue'
import { popupStore } from '../store/popup'
import { isNativeAsset } from '../utils/nativeAsset'
import { classifyAssetChain, isCertainMismatch } from '../utils/assetChain'
import AddressBook from './popups/AddressBook.vue'
import { flattenVaultAccounts, resolveRecipient } from '../utils/knownRecipients'
import { useAddressSecurity } from '../composables/useAddressSecurity'
import SecurityWarning from './SecurityWarning.vue'
import { configStore } from '../store/config'
import { chainVm } from '../utils/vm'
import { validateRecipient, sendBlockReason } from '../utils/solana/sendGuards'
import { isSolanaMaxDisabled, computeSolanaMaxAmount } from '../utils/solana/sendMax'
import { solanaMintOf } from '../utils/solana/sendMint'
import { prepareTransferContext } from '../utils/solana/send'
import { fetchSolanaAssets } from '../utils/solana/balances'
import { resolveSolanaSendError, isKnownSolanaSendError } from '../utils/solana/sendErrors'
import { SOL_DECIMALS } from '../utils/solana/constants'
import { isTon } from '../utils/chainKind'
import { isValidTonAddress } from '../utils/ton/tonAddress'
import { getTonClient } from '../utils/ton/tonClient'
import { getTonBalance } from '../utils/ton/tonBalance'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { TON_FEE_RESERVE, tonSendAmountFits } from '../utils/ton/tonSend'
import { JETTON_ATTACH_TON, jettonSendFits } from '../utils/ton/jettonSend'
import { getJettonWalletAddress } from '../utils/ton/jettonAddress'
import { getJettonBalance } from '../utils/ton/jettonBalance'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'
import { captureSendDraft, restoreSendDraft } from '../utils/sendDraft'
import { assetPriceUSD, tokenToUsd, formatUsd, tokenToUsdInput, usdToToken } from '../utils/assetPrice'
import { SEND_PERCENTS, percentAmount } from '../utils/sendPercent'
import { tokenLogo } from '../utils/tokenLogo'

const network = networkStore()
const crypto = cryptoStore()
const page = pageStore()
const popups = popupStore()
const config = configStore()

const balance = ref(0)
// KUTUYA YAZILAN HAM METIN. Birim ne olursa olsun v-model bunu hedefler.
// `:value` + `@input` ile baglamak bir gerileme uretiyordu: `type="number"`
// girisinde "0." gecerli bir sayi degildir, tarayici `el.value` olarak BOS
// dondurur ve bagli deger bosalinca Vue alani siliyordu. Vue'nun bunu onleyen
// korumasi (looseToNumber karsilastirmasi) YALNIZCA v-model yolunda calisir.
const rawInput = ref('')

// Girdi birimi. Dolar yalnizca bir GIRIS KOLAYLIGIDIR.
const inputMode = ref('token')
const isValidAmount = ref(true)
// TON'da miktarin KENDISI bakiyeyi asmiyor, yalniz ucrete (TON_FEE_RESERVE) yer
// kalmiyor — bu ayri bir mesaji hak eder (bkz. asagidaki watch(amount, ...)).
const insufficientForFee = ref(false)
const to = ref('')
const validAddress = ref(false)
// Adresin gecersiz OLMA sebebi. RECIPIENT_NOT_WALLET diger her gecersizlikten AYRI:
// adres bicimsel olarak DOGRU ama bir cuzdan degil, oraya giden para geri alinamaz.
const addressReason = ref(null)
const knownAccounts = ref([])
const savedAddresses = ref([])
const activeAddress = ref('')
const activeAccount = ref(null)

// Zincirin SANAL MAKINESI — Solana/TON/EVM dallanmasinin TEK kaynagi.
// UC deger doner: 'solana' | 'ton' | 'evm' (bkz. vm.js). Bu ekranda "solana degil"
// ARTIK "EVM" DEMEK DEGILDIR: her dal ACIKCA yazilmali, yoksa TON EVM koluna duser.
const vm = computed(() => chainVm(network.currentNetwork))

// Solana mint kimligi — TEK normalizasyon noktasi (bkz. sendMint.js). Once bu
// normalizasyon dort ayri yerde tekrarlaniyordu ama IKI yerde (Maks devre disi
// kontrolu, Maks hesaplamasinin SPL erken donusu) HAM `crypto.sendAsset?.address`
// karsilastiriliyordu — adres eksikse (`undefined`) bu iki kontrol NATIVE SOL'u
// SPL saniyor, "Maks" YANLISLIKLA etkin kalip ucret/kira dusulmeden tum bakiyeyi
// yaziyordu (kod incelemesinde bulundu). Artik HERKES ayni `mint.value`'yu okur.
const mint = computed(() => solanaMintOf(crypto.sendAsset))
// Solana ondaligi — ConfirmTransaction.vue'nun solanaDecimals'iyla AYNI
// normalizasyon. Bugun bu ekranda AMOUNT_EXCEEDS_PRECISION firlayamaz
// (prepareTransferContext bu hatayi hic uretmez) ama resolveSolanaSendError'a
// verilen `{decimals}` parametresi diger UC cagri noktasiyla (ConfirmTransaction.vue)
// tutarli tutulur — kod ileride degisirse ham "{decimals}" yazan bir mesaj
// gorunmesin diye.
const solanaDecimals = computed(() => crypto.sendAsset?.decimals ?? SOL_DECIMALS)

// Solana'da ice aktarilmis/privateKey hesaplar imzalayamaz (bkz. sendGuards.js).
// ONCEDEN bilinmezse kullanici "Onayla"ya basar, arka plan reddeder ve pencere
// hicbir aciklama olmadan kapanir.
const blockReason = computed(() => sendBlockReason({ account: activeAccount.value, vm: vm.value }))

// Ucret + kira baglami (Solana). Null = HENUZ YUKLENMEDI ya da OKUNAMADI — "Maks"
// (ve butun yuzde cipleri) bu durumda kira minimumunu bilmedigi icin devre disi
// kalir; sifir kira VARSAYILMAZ (bkz. asagidaki watch), aksi halde hesap kira
// muafiyeti altina dusup silinebilir.
const solanaFee = ref(null)
// solanaFee NEDEN null kaldi — bilinen bir ag hatasi kodu varsa. Yalniz "Maks
// hesaplanamiyor" ipucunu daha SPESIFIK gostermek icin; devre disi birakma
// KARARININ kendisi (isSolanaMaxDisabled) buna bakmaz, yalnizca solanaFee'nin
// null olup olmadigina bakar.
const solanaFeeErrorCode = ref(null)

// "Maks" devre disi mi — SAF karar sendMax.js'te. MAX artik TEK bir noktadan,
// HER ZAMAN normalize edilmis `mint.value` ile hesaplanir (kod incelemesinde
// bulunan "ham adres karsilastirmasi NATIVE'i SPL sanabiliyordu" hatasi kapandi).
const solanaMaxDisabled = computed(() =>
    vm.value === 'solana' && isSolanaMaxDisabled({ mint: mint.value, solanaFee: solanaFee.value }))

const tonComment = ref('')
// Bakiye okunamadiginda true. balance.value baslangicta 0 oldugu icin hata
// yakalanip sayi hic guncellenmezse ekranda "0 bakiye" gorunurdu; bu bayrak
// sablonun "-" gostermesini ve formu kilitlemesini saglar.
const balanceError = ref(false)

// JETTON GONDERIMINDE IKI AYRI BAKIYE VAR ve karistirilamaz:
//   `balance`    -> gonderilen varligin bakiyesi (jetton ya da native TON)
//   `tonBalance` -> ISLEM UCRETI icin gereken native TON
// Jetton gonderimi jetton'un KENDISINDEN hicbir sey harcamaz ama TON harcar.
// Tek bir bakiyeye bakan bir kontrol, jettonu bol olup TON'u bitmis kullaniciyi
// gonderime birakirdi: zincirde compute fazi calisir (seqno artar), mesaj
// sessizce duser, cuzdan yine de "basarili" gosterir.
// Native TON gonderiminde ikisi AYNI degerdir.
const tonBalance = ref(0)

// Zehirli adres + itibar kapilari tek composable'da; ConfirmTransaction.vue ayni mantigi
// paylasir. `blocked` her iki kapiyi da kapsar.
const {
    checking: securityChecking, reputation, poisonMatch, poisonParts, poisonSourceKey,
    poisonAcknowledged, reputationAcknowledged, blocked: securityBlocked, loadTrusted,
} = useAddressSecurity(to, computed(() => config.api))

// Alici bilinen bir hesap/kayitli adresse ismi gorunur (elle yazma dahil).
// recipient.address kayittaki checksum case'tir — identicon seed'i diger ekranlarla ayni kalir.
const recipient = computed(() => resolveRecipient(to.value, {
    accounts: knownAccounts.value,
    savedAddresses: savedAddresses.value
}))

// Kendi aktif hesabina gonderim genelde hata — cip yesil yerine amber gosterilir.
// Solana'da KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir, kucultulen bir adres
// baska bir adrese donusur (yanlis pozitif/negatif self-send tespiti).
//
// TON adresleri de base58 tabanli ve buyuk/kucuk harf duyarli — ama asagidaki
// `toLowerCase()` dali TON'da ZARARSIZ, cunku TON'da `activeAddress` bir EVM `0x`
// adresidir (bkz. onMounted): karsilastirma HICBIR ZAMAN eslesmez, yani yanlis
// POZITIF uretemez. TON kimligi bu ekranda cozulmeye baslarsa bu dal da Solana
// gibi ACIKCA ayrilmali - aksi halde kucultulmus bir TON adresi baska bir adrese
// donusur.
const isSelfSend = computed(() => {
    if (!to.value || !activeAddress.value) return false
    if (vm.value === 'solana') return to.value === activeAddress.value
    return to.value.toLowerCase() === activeAddress.value.toLowerCase()
})

// Fiyat TEK YERDEN okunur. Eskiden burada dogrudan `sendAsset.market.priceUSD`
// vardi; Token.vue kaydi fiyati `market_data` altinda tasidigi icin Ana ekran ->
// Token -> Gonder yolunda fiyat bulunamiyor ve ekranda "$0.00" yaziyordu.
const price = computed(() => assetPriceUSD(crypto.sendAsset))

// Fiyat bilinmiyorsa dolar girisi ACILAMAZ.
const hasPrice = computed(() => price.value !== null)

const assetSymbol = computed(() => crypto.sendAsset?.symbol?.toUpperCase() || '')

const unitLabel = computed(() => inputMode.value === 'usd' ? 'USD' : (assetSymbol.value || 'USD'))

// GONDERILECEK MIKTAR - HER ZAMAN token cinsinden ve TEK kaynaktan turetilir.
// Dogrulama kapilari, taslak ve confirm() bunu okur; dolar hicbir yere sizmaz.
//
// Turetilmis olmasi cevrimi tek yere hapseder: hicbir kod yolu token -> dolar ->
// token gidip gelemez, dolayisiyla programatik yazmalarda deger oynayamaz.
const amount = computed(() => {
    if (inputMode.value !== 'usd') return rawInput.value
    return usdToToken(rawInput.value, price.value, crypto.sendAsset?.decimals) ?? ''
})

// Kutunun altindaki satir HER ZAMAN karsi birimi gosterir. Fiyat yoksa null
// doner ve sablon "fiyat bilinmiyor" der - "$0.00" DEGIL.
const counterValue = computed(() => {
    if (inputMode.value === 'usd') return `${amount.value || '0'} ${assetSymbol.value}`.trim()

    const usd = formatUsd(tokenToUsd(amount.value || '0', price.value))
    return usd === null ? null : `$${usd}`
})

// VARLIK <-> AKTIF ZINCIR kapisi. Takas ekraninin kullandigi AYNI saf katman.
//
// Buraya kadar gelen kaydin dogru zincirde oldugunu VARSAYIYORDUK. Yazanlar aga
// gecmeyi ustleniyor (SelectAssets.vue, Token.vue) ama bu bir SOZLESME degildi:
// Home -> Token -> Gonder yolu tam olarak bu yuzden yabanci zincir adresini aktif
// zincirde kullaniyordu. Kapi artik kaynaga GUVENMIYOR.
//
// Kesin sebep (chainId var ve tutmuyor / cuzdanin desteklemedigi varlik) gonderimi
// DURDURUR: gonderim geri alinamaz ve yanlis adres en iyi ihtimalle gazi yakar.
// Supheli sebep yalnizca uyarir — ayni adres birden cok zincirde gecerli olabiliyor.
const assetChainNotice = computed(() =>
    classifyAssetChain(crypto.sendAsset, network.currentNetwork?.chainId))

const assetChainBlocked = computed(() => isCertainMismatch(assetChainNotice.value))

const isTonNetwork = computed(() => isTon(network.currentNetwork))

// Token.vue'daki AYNI ayrim ve AYNI kaynak (NATIVE_TOKEN_ADDRESS). Iki dosya
// ayrisirsa bir ekran jetton satirinda native TON gonderir - K1 tam olarak
// buydu ve merge engelleyiciydi.
const isTonJetton = computed(() =>
    isTonNetwork.value && crypto.sendAsset?.address !== NATIVE_TOKEN_ADDRESS)

// Formun genel geçerlilik durumu.
// Guvenlik kapisi acikken duğme kilitli: tek tikla gonderim tam da saldirinin
// hesapladigi seydir. `securityBlocked` hem zehirli adresi hem itibar bayragini kapsar.
const isFormValid = computed(() => {
    if (securityBlocked.value) return false
    if (assetChainBlocked.value) return false
    // Solana: ice aktarilmis/privateKey hesap imzalayamaz.
    if (blockReason.value) return false
    // Bakiye okunamadiysa miktar dogrulanamaz: bilinmeyen bir bakiyeden
    // gonderim yaptirmak yanlis. WALLET_LOCKED de bu yoldan kapsanir.
    if (balanceError.value) return false
    return amount.value && to.value && isValidAmount.value && validAddress.value
})

onMounted(async() => {
    const { active_account, vaults, saved_addresses } = await chrome.storage.local.get(['active_account', 'vaults', 'saved_addresses'])

    knownAccounts.value = flattenVaultAccounts(vaults)
    savedAddresses.value = saved_addresses || []
    activeAccount.value = active_account || null

    // KOD INCELEMESI (Task 13, kritik 3): Solana'da aktif hesabin KIMLIGI
    // solanaAddress'tir, EVM `.address` DEGIL. Once BURADA cozulur ki loadTrusted
    // (gecmis sorgusu + kendi-adres eslesmesi) DOGRU kimlikle cagrilsin — yanlis
    // (EVM) adres gecirilirse /solana/history'ye GECERSIZ bir sorgu gider (sunucu
    // 400 doner) ve gecmis kaynagi SESSIZCE bos kalir. Henuz turetilmediyse
    // (kullanici Home'a hic ugramadan buraya geldiyse) Home.vue ile AYNI
    // yedekle cozulur — background sonucu ayrica DISKE de yazar.
    let solanaAddress = ''
    if (vm.value === 'solana') {
        try {
            solanaAddress = active_account?.solanaAddress
                || (await chrome.runtime.sendMessage({ type: 'SOLANA_GET_ADDRESS' }))?.result?.address
                || ''
        } catch (e) {
            console.error('Solana adresi alinamadi:', e.message)
        }
    }

    await loadTrusted({
        chainId: network.currentNetwork.chainId,
        myAddress: vm.value === 'solana' ? solanaAddress : active_account?.address
    })

    // SELF-SEND karsilastirmasinin kimligi. Solana'da EVM `.address` HICBIR ZAMAN
    // eslesmez; yukarida COZULEN AYNI solanaAddress kullanilir.
    //
    // TON'da main dalindaki davranis (EVM adresi) BILEREK KORUNDU: TON kimligini
    // burada cozmek ensureTonAddress'i ikinci kez cagirmak demek ve kasa
    // kilitliyken bu, yalnizca bir "kendine gonderiyorsun" ipucu ugruna butun
    // ekrani kilitlerdi. Sonuc: TON'da self-send cipi hic gorunmez (yanlis POZITIF
    // uretmez -- 0x adresi bir TON adresine asla esit olamaz).
    activeAddress.value = vm.value === 'solana' ? solanaAddress : (active_account?.address || '')

    // BAKIYE — UC VM, UC AYRI OKUMA, TEK try/catch.
    //
    // Solana: EVM saglayicisi (network.rpc) KULLANILAMAZ — Solana kaydinda `rpc`
    // alani YOK (vm.js), useTokenBalance orada anlamsizdir.
    // TON: network.rpc null (networkStore.clearRpc) — useTokenBalance burada
    // JsonRpcProvider(null) kurup patlardi.
    //
    // try/catch UCUNU DE KAPSAR ve ZORUNLU: fetchSolanaAssets / getTonBalance /
    // useTokenBalance hatayi FIRLATIR (proxy dustu, kasa kilitli - WALLET_LOCKED,
    // RPC hatasi...). Yakalanmazsa balance.value baslangic degeri olan 0'da kalir
    // ve kullanici "bakiyen sifir" sanir — spec'in acikca yasakladigi durum.
    // Bunun yerine balanceError isaretlenir; sablon "-" gosterir ve isFormValid
    // formu kilitler.
    //
    // BIRLESME DUZELTMESI: Solana dali hatayi KENDI icinde yutup `balance = 0`
    // yaziyordu — yani tam olarak yukarida yasaklanan gorunumu uretiyordu. Ortak
    // kapiya alindi; Solana da artik "-" gosterip formu kilitliyor.
    try {
        if (vm.value === 'solana') {
            // Adres cozulemediyse bakiye de BILINMIYOR demektir. Bos listeye
            // dusup 0 yazmak "paran yok" der; dogrusu "okunamadi".
            if (!solanaAddress) throw new Error('SOLANA_ADDRESS_UNAVAILABLE')

            const assets = await fetchSolanaAssets(solanaAddress)
            balance.value = assets.find(a => a.mint === mint.value)?.amount || 0
        } else if (isTonNetwork.value) {
            const tonAddress = await ensureTonAddress(active_account, {
                testnet: Boolean(network.currentNetwork?.testnet),
            })
            const client = getTonClient(config.api)

            // Native TON HER DURUMDA okunur - jetton gonderiminde de ucret ondan
            // odenir. Okunamazsa balanceError isaretlenir ve form kilitlenir:
            // bilinmeyen bir ucret bakiyesinden gonderim yaptirmak, spec'in
            // acikca yasakladigi "hata 0 gosterilir" durumuyla ayni sinifta.
            tonBalance.value = await getTonBalance(client, tonAddress)

            if (isTonJetton.value) {
                // ONDALIK ZORUNLU ve varsayilani YOK: jettonlar 9 ondalik degildir
                // (USDT-TON 6). Varsayilan koymak bakiyeyi 1000 kat yanlis
                // gosterirdi ve kullanici gonderirken ayni carpani kullandigi icin
                // bu DOGRUDAN para kaybidir. getJettonBalance kendi kapisini de
                // uygular; buradaki erken cikis hatanin sebebini net tutuyor.
                const walletAddress = await getJettonWalletAddress({
                    client,
                    owner: tonAddress,
                    master: crypto.sendAsset.address,
                    chainId: network.currentNetwork.chainId,
                    storage: chrome.storage.local,
                })
                balance.value = await getJettonBalance({
                    client,
                    walletAddress,
                    decimals: crypto.sendAsset?.decimals,
                })
            } else {
                balance.value = tonBalance.value
            }
        } else {
            // `network.rpc` AKTIF agin ucu; chainId de oradan alinir ki ikisi tutsun.
            balance.value = await useTokenBalance(active_account.address, crypto.sendAsset?.address, network.rpc, network.currentNetwork?.chainId)
        }
        balanceError.value = false
    } catch (e) {
        balanceError.value = true
        console.error('Bakiye okunamadi:', e)
    }

    // ONIZLEMEDEN GERI DONUS. App.vue ekranlari `v-if` ile kuruyor: onizlemeye
    // gecerken bu bilesen sokuldu, simdi SIFIRDAN kuruldu ve girdiler bostu.
    //
    // Bakiye okumasindan SONRA calismasi zorunlu: tutari geri yazmak watch(amount)
    // tetikler ve o kapi `balance.value`ye bakar. Bakiye daha gelmemis olsaydi
    // (baslangic degeri 0) gecerli bir tutar "yetersiz bakiye" damgasi yerdi ve
    // watcher bir daha atesleyecegi icin ekran o hatada KILITLI kalirdi.
    //
    // restoreSendDraft varlik+zincir eslesmiyorsa null doner: eski bir aliciyi
    // yeni bir gonderime tasimak, kullanicinin fark etmeden yanlis adrese para
    // gondermesi demektir.
    const draft = restoreSendDraft(crypto.sendDraft, {
        asset: crypto.sendAsset,
        chainId: network.currentNetwork?.chainId,
    })
    // Taslak TEK KULLANIMLIK: onizleme yolu her girisinde yeniden yazilir
    // (bkz. confirm). Burada tuketilmezse kullanicinin bilerek terk ettigi bir
    // form, ayni varliga ikinci kez girdiginde geri gelirdi.
    crypto.sendDraft = null
    if (draft) {
        to.value = draft.to
        tonComment.value = draft.tonComment
        // Taslak dolar dese bile fiyat bilinmiyorsa dolar modu ACILMAZ:
        // cevrilemeyen bir kutu kullaniciya bos bir alan gosterirdi.
        inputMode.value = draft.mode === 'usd' && hasPrice.value ? 'usd' : 'token'
        // Kutunun HAM metni geri yazilir; `amount` ondan yeniden turer.
        //
        // KAPI: taslak dolar cinsindeydi ama dolar modu ACILAMADIYSA metin
        // token miktari olarak okunurdu - "100 dolar" sessizce "100 TOKEN"
        // olurdu. Boyle bir durumda alan bos birakilir.
        rawInput.value = draft.mode === 'usd' && !hasPrice.value ? '' : draft.amount
    }
})

// Pano okunamayabilir: uzantinin `clipboardRead` izni yok ve Chrome erisimi
// yalnizca odaklanmis bir uzanti sayfasina veriyor. Basarisizlik SESSIZ
// KALMAMALI - hicbir sey yapmayan bir dugme, kullaniciya elle yapistirmasi
// gerektigini de soylemez.
const pasteFailed = ref(false)

const handlePaste = async () => {
    pasteFailed.value = false
    try {
        const text = await navigator.clipboard.readText()
        if (text) to.value = text.trim()
    } catch (err) {
        pasteFailed.value = true
        console.error('Paste error:', err)
    }
}

// Adres dogrulamasi + (Solana'da) ucret/kira baglami TEK watcher'da.
//
// KOK NEDEN (kod incelemesi, 1. tur): once IKI ayri watcher vardi — biri `to`yu
// izleyip `validAddress`'i GUNCELLIYORDU, digeri (ONCE OLUSTURULDUGU icin Vue'nun
// ayni-bilesen pre-flush watcher sirasinda ONCE calisan) `validAddress`'i yalnizca
// OKUYORDU. Sonuc: kullanici ILK gecerli adresi yapistirdiginda ucret watcher'i
// HALA ESKI (false) `validAddress` ile calisip `solanaFee`'yi null'a dusuruyordu;
// hicbir sey onu yeniden TETIKLEMEDIGI icin "Maks" o oturum boyunca KALICI olarak
// devre disi kaliyordu — Step 4e'nin tek somut ciktisi calismiyordu. Tek watcher,
// TAZE hesaplanan `check.valid`'i kullanarak bu sira sorununu ORTADAN KALDIRIR.
//
// BIRLESME: main dalinin AYRI `watch(to, ...)` dogrulayicisi buraya KATILDI. Iki
// watcher birakmak, ikisinin de `validAddress`'i yazdigi ve sirasinin Vue'nun
// olusturma sirasina bagli oldugu bir yaris demekti — yukaridaki KOK NEDEN
// paragrafi tam olarak o sinifin bir ornegini anlatiyor.
//
// prepareTransferContext ZINCIR DURUMU okur (blockhash, ucret, kira minimumu,
// alicinin ATA'si). "Maks" dugmesi kira minimumunu bilmeden dogru calisamaz; bu
// yuzden alici girilir girilmez yuklenir, gonderim anina birakilmaz.
//
// solanaFeeRequestId: bu watcher ASENKRON'dur ve `to` HIZLICA degisebilir
// (yapistir-duzelt-yapistir). Token OLMADAN, A adresi icin baslayan bir
// prepareTransferContext cagrisi B adresi icin baslayan cagridan GEC donerse,
// A'nin (artik ESKI, ozellikle ATA-var-mi bilgisi alici basina degisen)
// baglamini B icin GECERLIYMIS gibi solanaFee'ye yazar (Home.vue'nun
// currentRequestId ile AYNI desen; kod incelemesinde bulundu — bu yol Bulgu
// 1 duzeltmesiyle ILK KEZ gercekten calisir hale geldigi icin bu turda cikti).
let solanaFeeRequestId = 0

watch([to, vm, mint], async ([new_to]) => {
    const requestId = ++solanaFeeRequestId

    if (!new_to) {
        validAddress.value = false
        addressReason.value = null
        solanaFee.value = null
        solanaFeeErrorCode.value = null
        return
    }

    // UC VM, UC AYRI ADRES BICIMI — ve TON ACIKCA dallanmali.
    //
    // sendGuards.validateRecipient yalnizca IKI dal taniyor: 'solana' ve (else)
    // EVM. TON'u ona vermek `ethers.isAddress` demektir; her TON adresi (base58,
    // EQ.../UQ... ile baslar) REDDEDILIR ve TON'da HICBIR adresin gecerli
    // sayilmadigi bir Gonder ekrani ortaya cikardi. `vm` artik uc deger
    // donduruyor (bkz. vm.js); "solana degil" ARTIK "EVM" demek DEGIL.
    //
    // try/catch main dalindan korunuyor: isValidTonAddress bicimsiz girdide
    // FIRLATABILIR, ethers.isAddress ise firlatmiyor — ikisini ayni kapinin
    // arkasinda tutmak, ileride hangisi degisirse degissin ekranin cokmemesini
    // garanti eder.
    let check
    try {
        check = vm.value === 'ton'
            // Sebep kodu YAZILMAZ: TON'un tek gecersizlik sinifi var ve mesaji
            // sablon zaten `isTonNetwork` uzerinden seciyor. Uydurma bir kod
            // yazmak, sablonda karsiligi olmayan olu bir dal birakirdi.
            ? { valid: isValidTonAddress(new_to), reason: null }
            : validateRecipient(new_to, vm.value)
    } catch (e) {
        check = { valid: false, reason: null }
    }
    validAddress.value = check.valid
    addressReason.value = check.reason

    if (vm.value !== 'solana' || !check.valid) {
        // Adres gecersiz / zincir Solana degil: ONCEKI baglam ARTIK GECERSIZDIR
        // (ozellikle ATA-var-mi bilgisi alici basina degisir). Stale veriyle
        // "Maks" hesaplamak yanlis bir tutar onerebilir; null'a dusup devre disi
        // birakmak GUVENLI TARAF.
        solanaFee.value = null
        solanaFeeErrorCode.value = null
        return
    }

    const { active_account } = await chrome.storage.local.get('active_account')
    // Bu asamada BASKA bir tetiklenme (yeni adres/ag/varlik) ARADA baslamis
    // olabilir: eldeki cagri ARTIK ESKI, yazmaya devam etmek YARIS DURUMU'na
    // (yukaridaki yorum) girer.
    if (requestId !== solanaFeeRequestId) return
    try {
        const ctx = await prepareTransferContext({
            from: active_account?.solanaAddress,
            to: new_to,
            mint: mint.value,
        })
        if (requestId !== solanaFeeRequestId) return
        solanaFee.value = ctx
        solanaFeeErrorCode.value = null
    } catch (e) {
        if (requestId !== solanaFeeRequestId) return
        // Ucret okunamadi: "Maks" kira minimumunu bilemez. Varsayilana DUSULMEZ —
        // 0 kira, kullanicinin tum bakiyesini gonderip hesabini kapatmasina yol acar.
        // Kod ayrica saklanir: MAX ipucu jenerik "feeUnavailable" yerine (mumkunse)
        // asil sebebi (ag zaman asimi, RPC hatasi...) gosterebilsin diye.
        console.error('Solana ucret baglami alinamadi:', e.message)
        solanaFee.value = null
        solanaFeeErrorCode.value = e?.message || e?.name || 'SOLANA_SEND_FAILED'
    }
}, { immediate: true })

// Ucret icin ayrilacak pay.
//
// SOLANA BURAYA GELMEZ: setPercent Solana'da harcanabiliri sendMax.js'ten alir
// (lamport TAM SAYISIYLA hesaplanir). Yine de acik bir kapi var, cunku bu
// fonksiyonun govdesi ethers saglayicisi kuruyor ve Solana kaydinda `rpc` YOK.
//
// JETTON: 0. Ucret jetton'dan DEGIL TON'dan odenir, yani jetton tarafinda
// ayrilacak pay YOKTUR. Pay ayirmak kullanicinin jettonunun tamamini
// gondermesini imkansiz kilardi. (TON yetersizse miktar dogrulamasi zaten
// kilitler - watch(amount) jetton dali.)
//
// ERC-20: 0, ayni sebeple - gas native coinden odenir.
//
// NATIVE: gas payi. Native coin'de tam bakiye yazmak onay ekraninin
// `bakiye < gas + tutar` kontrolune takiliyor ve Onayla dugmesi kalici olarak
// kapali kaliyordu; MAX hicbir zaman tamamlanamiyordu.
const percentReserve = async () => {
    if (vm.value === 'solana') return 0
    if (isTonJetton.value) return 0
    if (!isNativeAsset(crypto.sendAsset?.address || crypto.sendAsset?.ca)) return 0
    return await estimateNativeGasReserve()
}

// Kutuya AKTIF BIRIMDE bir token miktari yazar. Dolar modunda deger once dolara
// cevrilir; tokenToUsdInput ASAGI kirptigi icin geri cevrim harcanabiliri asamaz.
const writeTokenAmount = (tokenAmount) => {
    rawInput.value = inputMode.value === 'usd'
        ? tokenToUsdInput(tokenAmount, price.value)
        : tokenAmount
}

// Yuzde cipleri. MAX artik %100'un ta kendisi - ayri bir kod yolu kalmadi.
// (Solana dalinin eski `setMax` fonksiyonu da BURAYA katildi: iki yol ayrisirsa
// biri ucret/kira payini duser digeri dusmez ve MAX yine tamamlanamaz olurdu.)
//
// SIRA BILINCLI: EVM/TON yolu ONCE gelir. Genel yolun sozlesmesi (yuzde tutari
// `balance.value` + `percentReserve()` ikilisinden turer) kaynaktan, ILK
// `percentAmount` cagrisi uzerinden kilitleniyor; Solana dali onun ONUNE
// konursa kilit Solana'nin ozel yoluna kayar ve genel yol TESTSIZ kalir.
//
// SOLANA AYRI DAL, ve `reserve` uzerinden GECMEZ. Harcanabilir tutar sendMax.js'in
// SAF katmanindan gelir: native SOL'da ucret VE kira muafiyeti minimumu LAMPORT
// TAM SAYISIYLA dusulur, SPL'de bakiyenin tamami harcanabilirdir (ucret SOL'dan
// oder). `reserve = balance - max` diye geri hesaplamak kayan nokta artigi uretir
// ve sonuc harcanabiliri MIKROSKOBIK olarak asabilirdi; Solana'da bu, hesabi kira
// esiginin ALTINA dusuren -- yani hesabi sildirebilen -- bir tutar demektir.
//
// `max` null ise ucret/kira baglami YOK: hicbir sey yazilmaz. Cipler bu durumda
// zaten kilitli (solanaMaxDisabled); burasi ikinci, savunma amacli kapi.
//
// Harcanabilirin TAMAMI `balance` olarak verilip `reserve: 0` denmesi bilincli:
// boylece %25/%50/%75 de AYNI harcanabilir tanimindan pay alir ve hicbir cip
// odenemez bir tutar uretemez -- EVM/TON dalindaki sozlesmenin ta kendisi.
const setPercent = async (percent) => {
    // EVM/TON: ucret payi `reserve` uzerinden duser. Bu dal ONCE gelir --
    // bkz. yukaridaki SIRA notu.
    if (vm.value !== 'solana') {
        writeTokenAmount(percentAmount({
            balance: balance.value,
            reserve: await percentReserve(),
            percent,
            decimals: crypto.sendAsset?.decimals,
        }))
        return
    }

    const max = computeSolanaMaxAmount({ mint: mint.value, balance: balance.value, solanaFee: solanaFee.value })
    if (max === null) return

    writeTokenAmount(percentAmount({
        balance: max,
        reserve: 0,
        percent,
        decimals: solanaDecimals.value,
    }))
}

const toggleUnit = () => {
    if (!hasPrice.value) return

    // Kutudaki deger KORUNUR: once bugunku token miktari okunur, mod
    // degistirilir, sonra ayni miktar yeni birimde geri yazilir.
    const current = amount.value
    inputMode.value = inputMode.value === 'usd' ? 'token' : 'usd'
    writeTokenAmount(current)
}

// Gönderim için ayrılması gereken native miktar (gas). RPC'ye ulaşılamazsa
// bakiyenin küçük bir payı ile ihtiyatlı davranılır.
const estimateNativeGasReserve = async () => {
    // TON'da gas fiyati/limit kavrami yok. Sabit, ihtiyatli bir pay ayrilir; aksi
    // halde MAX tam bakiyeyi yazar ve gonderim ucreti karsilanamadigi icin duser.
    if (isTon(network.currentNetwork)) return TON_FEE_RESERVE

    const FALLBACK_RATIO = 0.01 // %1
    try {
        const provider = new ethers.JsonRpcProvider(network.rpc)
        const feeData = await provider.getFeeData()
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice
        if (!gasPrice) throw new Error('gas fiyati okunamadi')

        // 21000 düz transfer + onay ekranındaki tahminin üstünde kalmak için pay.
        const reserveWei = 21000n * BigInt(gasPrice) * 2n
        return Number(ethers.formatEther(reserveWei))
    } catch (e) {
        console.warn('Gas rezervi tahmin edilemedi, oransal paya dusuluyor:', e.message)
        return Number(balance.value) * FALLBACK_RATIO
    }
}

const setAddress = data => {
    to.value = data.address
}

const formatSafeAmount = (value, maxDecimals) => {
    let numStr = String(value).toLowerCase();
    
    if (numStr.includes('e')) numStr = Number(value).toFixed(maxDecimals + 5)

    const parts = numStr.split('.');
    if (parts.length === 2) {
        if (parts[1].length > maxDecimals) numStr = `${parts[0]}.${parts[1].substring(0, maxDecimals)}`
    }

    if (numStr.includes('.')) {
        numStr = numStr.replace(/0+$/, '').replace(/\.$/, '');
    }

    return numStr || "0";
}

const confirm = async() => {
    const { active_account } = await chrome.storage.local.get('active_account')

    if (vm.value === 'solana') {
        // formatSafeAmount BILEREK KULLANILMAZ: fazla ondalik basamagi SESSIZCE
        // KESER (substring), tam olarak buildTransferPlan.js'nin toBaseUnits'in
        // ACIKCA REDDETMEK icin var oldugu sessiz hassasiyet kaybi. Ham dizge
        // oldugu gibi gecirilir; ondalik sinirini asan bir tutar burada degil,
        // gonderim aninda AMOUNT_EXCEEDS_PRECISION ile acikca reddedilir.
        crypto.transactionData = {
            from: active_account?.solanaAddress,
            to: to.value,
            toLabel: recipient.value?.label ?? null,
            amount: String(amount.value),
            asset: mint.value,
            network: network.currentNetwork.name
        }
    } else {
        // API native coin'i '0x0' adresiyle donduruyor ('0x0' truthy!). Sadece "adres var mi"
        // diye bakilirsa native, ERC-20 sanilir; Contract('0x0').decimals() reject eder ve
        // gonderim hicbir hata gostermeden olur.
        const assetAddress = crypto.sendAsset?.address || crypto.sendAsset?.ca
        const isNative = isNativeAsset(assetAddress)
        const decimals = crypto.sendAsset?.decimals || 18;

        const formattedAmount = formatSafeAmount(amount.value, decimals);

        crypto.transactionData = {
            from: active_account.address,
            to: to.value,
            toLabel: recipient.value?.label ?? null,
            amount: formattedAmount,
            asset: isNative ? null : assetAddress,
            network: network.currentNetwork.name
        }
    }

    // BIRLESME: Solana dali eskiden BURADAN ONCE `return` ediyordu ve asagidaki
    // IKI ADIM Solana'da HIC calismiyordu:
    //   - tonComment sifirlama: onceki bir TON gonderiminden kalan memo
    //     `crypto.tonComment`te ASILI kalirdi.
    //   - captureSendDraft: onizlemeden geri donen kullanici formu BOS bulurdu
    //     (adres, tutar, birim modu -- hepsi silinmis).
    // Ikisi de zincirden BAGIMSIZ adimlar; ortak kuyruga alindi.

    // Memo yalnizca TON'da anlamli; EVM'e sizmasin diye her seferinde sifirlanir.
    crypto.tonComment = isTonNetwork.value ? tonComment.value.trim() : ''

    // Kullanicinin YAZDIGI degerler saklanir (formattedAmount DEGIL): geri
    // donuste alan tam olarak biraktigi gibi acilsin.
    crypto.sendDraft = captureSendDraft({
        asset: crypto.sendAsset,
        chainId: network.currentNetwork?.chainId,
        to: to.value,
        amount: rawInput.value,
        tonComment: tonComment.value,
        mode: inputMode.value,
    })

    page.currentPage = 'confirm_transaction'
}

// BULGU 1 (merge engelleyici): burasi eskiden yalniz `amount > balance` diyordu —
// TON'da UCRETI HIC HESABA KATMIYORDU. Gonderim modu PAY_GAS_SEPARATELY |
// IGNORE_ERRORS: tum bakiyeyi yazan kullanicida (amount === balance) zincirde
// compute fazi calisir (seqno ARTAR), action fazi ucreti karsilayamaz, mesaj
// SESSIZCE duser — aliciya hicbir sey gitmez, ucret yanar, waitForSeqno yine de
// "basarili" yazdirir (bkz. tonSend.js:tonSendAmountFits, sendTon yorumlari).
//
// Kontrol YALNIZCA TON'DA devreye girer: EVM'in kendi ayri kapisi var
// (ConfirmTransaction.vue:checkEvmGasAndBalance), buradaki EVM dali AYNEN kaldi.
watch(amount, new_amount => {
    if (new_amount === '') {
        isValidAmount.value = true
        insufficientForFee.value = false
        return
    }

    if (isTonJetton.value) {
        // JETTON: tonSendAmountFits DEGIL. O fonksiyon miktari ve ucreti AYNI
        // bakiyeden duser - jettonda ikisi AYRI varliktir ve o hesap yanlis olur
        // (jetton bakiyesinden TON ucreti dusulmeye calisilirdi).
        const fits = jettonSendFits({
            jettonAmount: new_amount,
            jettonBalance: balance.value,
            tonBalance: tonBalance.value,
        })
        isValidAmount.value = fits
        // Jetton yeterli ama TON yetmiyorsa mesaj bunu AYIRT ETMELI: kullanici
        // jetton bakiyesine bakip "ama param var" der. Bu senaryo cok yaygin.
        insufficientForFee.value = !fits && Number(new_amount) <= Number(balance.value)
    } else if (isTonNetwork.value) {
        const fits = tonSendAmountFits({ amount: new_amount, balance: balance.value })
        isValidAmount.value = fits
        // "Yetersiz bakiye" DEGIL: miktarin kendisi bakiyeyi asmiyor, yalniz ucrete
        // pay kalmiyor. Kullanici MAX'a yonlendirilmeli, mesaj bunu ayirt eder.
        insufficientForFee.value = !fits && Number(new_amount) <= Number(balance.value)
    } else {
        // String karşılaştırması yerine sayısal karşılaştırma
        if (Number(new_amount) > Number(balance.value)) isValidAmount.value = false
        else isValidAmount.value = true
        insufficientForFee.value = false
    }
})
</script>