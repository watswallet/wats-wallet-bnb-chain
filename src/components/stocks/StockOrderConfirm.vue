<template>
    <div data-order-confirm class="absolute inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm">
        <div class="w-full max-h-full overflow-y-auto custom-scrollbar rounded-t-3xl bg-white dark:bg-[#131315] border-t border-slate-200 dark:border-white/10 p-5 flex flex-col gap-4 text-slate-900 dark:text-white">
            <!-- bStocks (emir yasam dongusu yok): islem GONDERILDI. Makbuz beklenmez, "basarili" DENMEZ (spec 5.4).
                 Gezgin baglantisi yok: ATS yolunda hash userOp hash'idir, islem hash'i degil. -->
            <template v-if="placed && placed.kind === 'tx'">
                <div data-order-status="submitted" class="flex flex-col gap-3">
                    <div class="rounded-2xl border px-4 py-3 flex flex-col gap-1" :class="PHASE_TONE.pending">
                        <p class="text-base font-bold">{{ t('stockTrade.status.txSubmitted') }}</p>
                        <p v-if="placed.unverified" data-order-unverified class="text-xs opacity-80">{{ t('stockTrade.status.txUnverifiedDesc') }}</p>
                        <p v-else data-order-submitted-desc class="text-xs opacity-80">{{ t('stockTrade.status.txSubmittedDesc') }}</p>
                    </div>
                    <button data-order-history class="text-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 cursor-pointer" @click="openHistory">{{ t('stockTrade.status.openHistory') }}</button>
                    <div class="grid grid-cols-2 gap-2">
                        <button data-order-close class="py-3 rounded-2xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 cursor-pointer" @click="closePanel">{{ t('stockTrade.status.close') }}</button>
                        <button data-order-new class="py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer" @click="newTrade">{{ t('stockTrade.status.newTrade') }}</button>
                    </div>
                </div>
            </template>

            <!-- Durum paneli: gonderimden sonra katmanin yerine gecer. Iptal dugmesi YOK (plan disi).
                 Sunum yeniden tasarimi: adimlar / ozet / gezgin baglantilari. Yoklama ve faz mantigi DEGISMEZ. -->
            <template v-else-if="placed">
                <div :data-order-status="phase" class="flex flex-col gap-4">
                    <div data-order-live role="status" aria-live="polite" aria-atomic="true" class="rounded-2xl border px-4 py-3 flex flex-col gap-1" :class="PHASE_TONE[phase] ?? PHASE_TONE.pending">
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-base font-bold">{{ headline }}</p>
                            <span v-if="phase === 'fulfilled'" class="shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center" aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            </span>
                        </div>
                        <span v-if="currentStepLabel" class="sr-only">{{ currentStepLabel }}</span>
                        <p v-if="phase === 'expired'" data-order-expired-desc class="text-xs opacity-90">{{ t('stockTrade.status.expiredDesc') }}</p>
                        <p v-if="phase === 'cancelled'" data-order-cancelled-desc class="text-xs opacity-90">{{ t('stockTrade.status.cancelledDesc') }}</p>
                        <p v-if="failed" data-order-safe class="text-xs font-semibold">{{ t('stockTrade.status.safeFunds') }}</p>
                        <p v-if="stillPending && (phase === 'submitting' || phase === 'pending')" data-order-still class="text-xs opacity-80">{{ t('stockTrade.status.stillPending') }}</p>
                    </div>

                    <!-- Beklerken: adim adim ilerleme -->
                    <template v-if="stepIndex !== null && phase !== 'fulfilled'">
                        <ol data-order-steps :aria-label="t('stockTrade.status.stepsLabel')" class="flex flex-col gap-0 px-1">
                            <li
                                v-for="(key, i) in ORDER_STEP_KEYS"
                                :key="key"
                                :data-order-step="key"
                                :data-step-state="stepState(i)"
                                :aria-current="stepState(i) === 'current' ? 'step' : undefined"
                                class="flex items-center gap-3 py-1.5 text-sm"
                                :class="stepState(i) === 'upcoming' ? 'text-slate-400 dark:text-zinc-600' : stepState(i) === 'current' ? 'font-bold text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-zinc-300'"
                            >
                                <span class="shrink-0 w-5 h-5 rounded-full flex items-center justify-center border" :class="stepState(i) === 'done' ? 'bg-emerald-500 border-emerald-500 text-white' : stepState(i) === 'current' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-white/15'" aria-hidden="true">
                                    <svg v-if="stepState(i) === 'done'" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    <span v-else-if="stepState(i) === 'current'" class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                                </span>
                                <span>{{ t(`stockTrade.status.steps.${key}`) }}</span>
                                <span v-if="stepState(i) === 'done'" class="sr-only">{{ t('stockTrade.status.stepDone') }}</span>
                                <span v-else-if="stepState(i) === 'current'" class="sr-only">{{ t('stockTrade.status.stepCurrent') }}</span>
                            </li>
                        </ol>
                        <div class="rounded-2xl bg-slate-50 dark:bg-white/5 px-4 py-3 flex flex-col gap-1 text-xs text-slate-500 dark:text-zinc-400">
                            <div class="flex justify-between gap-2">
                                <span data-order-typical>{{ t('stockTrade.status.typical') }}</span>
                                <span data-order-elapsed class="font-mono font-semibold text-slate-700 dark:text-zinc-300">{{ t('stockTrade.status.elapsed', { time: elapsedText }) }}</span>
                            </div>
                            <p v-if="validUntilText" data-order-valid-until>{{ t('stockTrade.status.validUntil', { time: validUntilText }) }}</p>
                            <p data-order-hint class="font-semibold text-slate-600 dark:text-zinc-300">{{ t('stockTrade.status.closeHint') }}</p>
                        </div>
                    </template>

                    <!-- Tamamlandi: ozet -->
                    <template v-if="phase === 'fulfilled'">
                        <div class="rounded-2xl bg-slate-50 dark:bg-white/5 px-4 py-4 flex flex-col gap-3">
                            <div class="flex flex-col gap-0.5">
                                <span class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">{{ t('stockTrade.status.summary.received') }}</span>
                                <span data-order-received class="text-2xl font-extrabold break-words">{{ summary.receivedText }}</span>
                                <span v-if="summary.usdText" data-order-usd class="text-xs text-slate-500 dark:text-zinc-400">{{ t('stockTrade.status.summary.approxUsd', { value: summary.usdText }) }}</span>
                            </div>
                            <div class="flex flex-col gap-2 text-sm border-t border-slate-200 dark:border-white/10 pt-3">
                                <div v-if="summary.paidText" class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t(placed.side === 'sell' ? 'stockTrade.status.summary.paidSell' : 'stockTrade.status.summary.paidBuy') }}</span><span data-order-paid class="font-semibold">{{ summary.paidText }}</span></div>
                                <div v-if="summary.avgText" class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.status.summary.avgPrice') }}</span><span data-order-avg-price class="font-semibold">{{ summary.avgText }}</span></div>
                                <div class="flex justify-between items-center gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.status.summary.network') }}</span><span data-order-network class="font-semibold flex items-center gap-1.5"><img data-order-network-logo :src="networkLogo" alt="" class="w-4 h-4 rounded-full object-contain">{{ networkName }}</span></div>
                            </div>
                        </div>
                        <div class="flex flex-col gap-1 items-center">
                            <a
                                v-if="txHash"
                                data-order-explorer
                                :href="explorerTxUrl(orderChainId, txHash)"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 py-1"
                            >{{ t('stockTrade.status.viewExplorer') }}</a>
                            <a
                                v-if="cowUrl"
                                data-order-cow
                                :href="cowUrl"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 py-1"
                            >{{ t('stockTrade.status.viewCow') }}</a>
                        </div>
                    </template>

                    <button v-if="phase === 'fulfilled'" type="button" data-order-view-stock class="py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer" @click="viewStock">{{ t('stockTrade.status.viewStock') }}</button>
                    <button v-else-if="failed" type="button" data-order-retry class="py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer" @click="retry">{{ t('stockTrade.status.retry') }}</button>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" data-order-close class="py-3 rounded-2xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 cursor-pointer" @click="closePanel">{{ t('stockTrade.status.close') }}</button>
                        <button
                            type="button"
                            data-order-new
                            class="py-3 rounded-2xl text-sm font-bold cursor-pointer"
                            :class="phase === 'fulfilled' || failed ? 'border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300' : 'text-white bg-indigo-600 hover:bg-indigo-500'"
                            @click="newTrade"
                        >{{ t('stockTrade.status.newTrade') }}</button>
                    </div>
                </div>
            </template>

            <!-- Imza oncesi katman: her deger motorun quoteRows'u (arka plan display) dizesidir, ekran sayi uretmez. -->
            <template v-else>
                <h2 class="text-lg font-bold">{{ t('stockTrade.confirm.title') }}</h2>
                <div v-if="rows" class="flex flex-col gap-2 text-sm">
                    <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.confirm.sell') }}</span><span data-confirm-sell class="font-semibold">{{ rows.spend.value }}</span></div>
                    <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.confirm.minReceive') }}</span><span data-confirm-min class="font-semibold">{{ rows.minimum.value }}</span></div>
                    <!-- CoW ucreti ve gecerlilik suresi emir motoruna ozgudur; bStocks'ta ATS ucreti ayri satirlarda. -->
                    <template v-if="!isTx">
                        <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.confirm.fee') }}</span><span data-confirm-fee>{{ rows.feesTotalUsd }}</span></div>
                        <!-- Faz 3 ATS ucreti: tutar imza ONCESI gorunur (Entegrator Sartlari 3.3(i)); imzalanan CoW yapisi degismez. -->
                        <div v-if="atsFeeAmount !== null" data-confirm-ats-fee class="flex justify-between gap-2 text-xs"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.atsFee.confirmLine', { amount: atsFeeAmount }) }}</span></div>
                        <p v-if="rows.networkFee" data-confirm-network-fee class="text-xs text-slate-500 dark:text-zinc-400">{{ t(rows.networkFee.key, rows.networkFee.params) }}</p>
                        <div v-if="rows.feeWarning" data-confirm-fee-warning class="rounded-2xl border border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">{{ t(rows.feeWarning.key, rows.feeWarning.params) }}<template v-if="rows.feeWarning.extraKey">{{ " " + t(rows.feeWarning.extraKey) }}</template></div>
                        <p data-confirm-validity class="text-xs text-slate-500 dark:text-zinc-400">{{ t('stockTrade.confirm.validity', { time: validityTime }) }}</p>
                    </template>
                    <template v-else>
                        <div v-if="rows.priceImpact" class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.quote.priceImpact') }}</span><span data-confirm-price-impact>{{ impactText }}</span></div>
                        <div v-if="atsLines" class="flex flex-col gap-1">
                            <!-- Bootstrap op'u varsa (opCount > 1) kalemler toplami tutmaz: ana ekranla AYNI gercek toplam gosterilir. -->
                            <div v-if="atsLines.total" class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.quote.feeAtsTotal') }}</span><span data-confirm-ats-total>{{ atsLines.total }}</span></div>
                            <template v-else>
                                <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.quote.feeAtsNetwork') }}</span><span data-confirm-ats-network>{{ atsLines.network }}</span></div>
                                <div class="flex justify-between gap-2"><span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.quote.feeAtsCommission') }}</span><span data-confirm-ats-commission>{{ atsLines.commission }}</span></div>
                            </template>
                        </div>
                    </template>
                    <div v-if="approvalMode === 'permit'" data-confirm-approval class="rounded-2xl bg-slate-50 dark:bg-white/5 px-3 py-2 flex flex-col gap-1 text-xs">
                        <span class="font-semibold">{{ t('stockTrade.confirm.approvalType') }}: {{ t('stockTrade.approval.permit') }}</span>
                        <span class="text-slate-500 dark:text-zinc-400">{{ t('stockTrade.approval.unlimited') }}</span>
                    </div>
                </div>

                <div v-if="errorCode" data-confirm-error class="rounded-2xl border border-red-300/50 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                    <span class="font-bold">{{ t('stockTrade.error.title') }}</span>: {{ t(errorKeyOf(errorCode)) }}
                </div>

                <div class="grid grid-cols-2 gap-2">
                    <button data-confirm-cancel class="py-3 rounded-2xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" :disabled="signing" @click="cancelLayer">{{ t('stockTrade.confirm.cancel') }}</button>
                    <button data-confirm-sign class="py-3 rounded-2xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed" :disabled="signing || !canSign" @click="sign">{{ signing ? t('stockTrade.confirm.signing') : t('stockTrade.confirm.sign') }}</button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMoney } from '../../composables/useMoney'
import { useCowOrderWatch } from '../../composables/useCowOrderWatch'
import { ORDER_VALIDITY_SEC } from '../../utils/cow/config'
import { explorerTxUrl } from '../../utils/explorer'
import { chainLogo, chainName } from '../../utils/chainLogo'
import { formatAmount } from '../../utils/stockTrade'
import { formatMoney } from '../../utils/money'
import { ORDER_STEP_KEYS, averageUnitPrice, cowExplorerOrderUrl, formatAtomsLocale, formatElapsed, stepIndexOf, stockValueUsd } from '../../utils/stocks/orderSummary'
import { cowEngine } from '../../utils/stocks/engines/cowEngine'
import { isEngineCode } from '../../utils/stocks/engines/errors'
import { pageStore } from '../../store/pageStore'

const props = defineProps({
    quote: { type: Object, required: true }, // useCowQuote cikisi (reactive)
    side: { type: String, required: true },
    stock: { type: Object, required: true },
    paySymbol: { type: String, default: '' },
    locale: { type: String, default: 'en' },
    // Motor (T14 tasir). Verilmezse xStocks (cowEngine): imza yolu iki motorda da engine.place'tir.
    engine: { type: Object, default: null },
    // bStocks ATS ucret onayi; yalniz pancake place'e gider. xStocks yolu bunlari OKUMAZ.
    atsQuoted: { type: Object, default: null },
    atsBlocked: { type: Boolean, default: false },
    // Gercek tahsilat: op sayisi ve toplam ATS ucreti (useAtsOpFee). opCount > 1 (ilk ATS kurulumu) iken
    // transfer + komisyon kalemleri toplami TUTMAZ; katman yalniz toplami gosterir, toplam yoksa imza kapali.
    atsOpCount: { type: Number, default: 1 },
    atsTotal: { type: Number, default: null },
})
// expired: { code } -> code null ise teklif suresi doldu (stockTrade.quote.updated bandi), degilse hata kodu bandi.
const emit = defineEmits(['close', 'expired', 'placed', 'new'])

const { t } = useI18n()
// Secili para birimi: ucret satirlari ve ag ucreti satiri bununla yazilir. Adi 'moneyDisplay': sign() icindeki
// yerel 'display' (teklif display'i) ile karismasin.
const { display: moneyDisplay } = useMoney()
const page = pageStore()

const eng = computed(() => props.engine ?? cowEngine)
// Emir yasam dongusu olmayan motor (bStocks): sonuc "islem gonderildi", emir yoklayicisi yok.
const isTx = computed(() => eng.value.hasOrderLifecycle === false)
const errorKeyOf = (code) => eng.value.errorKey(code)

// Bu hatalarda teklif ARTIK gecersizdir: katman kapanir, teklif yenilenir (eski sayilarla imza yolu yok).
const CLOSING_CODES = new Set(['QUOTE_EXPIRED', 'QUOTE_NOT_FOUND', 'QUOTE_USED', 'ACCOUNT_CHANGED', 'PERMIT_DOMAIN_MISMATCH', 'APPROVAL_REQUIRED'])
const STABLE_PAY = new Set(['USDC', 'USDT']) // ortalama fiyat yalniz dolar sabit odeme tokeninde anlamli
// Emir suresi dolmasi PARA CIKMADI demektir: kirmizi degil nötr/amber.
const PHASE_TONE = {
    submitting: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200',
    pending: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300',
    fulfilled: 'border-emerald-300/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    expired: 'border-amber-300/50 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    cancelled: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300',
}

const signing = ref(false)
const errorCode = ref(null)
// emir: { uid, state, side, symbol, decimals }; islem (bStocks): { kind: 'tx', side, symbol, hash }
const placed = ref(null)

const rows = computed(() => {
    if (props.quote.state !== 'ready' || !props.quote.result) return null
    return eng.value.quoteRows({
        result: props.quote.result,
        side: props.side,
        symbol: props.stock?.symbol,
        paySymbol: props.paySymbol,
        locale: props.locale,
        chainId: props.stock?.chainId,
        display: moneyDisplay.value,
    })
})
// Yalniz mode 'ats' iken; tutar arka planin teklif kaydindaki atom dizesinden (Number yok).
const atsFeeAmount = computed(() => {
    const fp = props.quote.result?.feePreview
    if (!fp || fp.mode !== 'ats' || !Number.isInteger(fp.decimals)) return null
    const text = formatAmount(fp.quotedAtsRaw, fp.decimals, 2)
    return text === '-' ? null : text
})
const approvalMode = computed(() => props.quote.result?.approval?.mode ?? null)

// bStocks: fiyat etkisi (motor satiri) ve onayli ATS ucreti. Sayi uretilmez, yalniz bicimlenir.
const impactText = computed(() => {
    const p = rows.value?.priceImpact
    if (!p) return ''
    return typeof p.pct === 'number' ? `${p.pct.toFixed(2)}%` : t('stockTrade.quote.priceImpactUnmeasured')
})
const fmtAts = (n) => {
    const v = Number(n)
    if (v > 0 && v < 0.0001) return '<0.0001' // toFixed(4) cok kucuk ucreti '0' gostermesin
    return v.toFixed(4).replace(/\.?0+$/, '')
}
const atsBootstrap = computed(() => props.atsOpCount > 1)
const atsLines = computed(() => {
    const q = props.atsQuoted
    if (!isTx.value || !q) return null
    if (atsBootstrap.value) return { total: `${fmtAts(props.atsTotal)} ATS` }
    return { network: `${fmtAts(q.transferFee)} ATS`, commission: `${fmtAts(q.commissionFee)} ATS` }
})

// 'onchain' modda katman acilmaz (StockTrade approve yoluna gider); burada da imza kapali.
// bStocks: onayli ATS ucreti yoksa ya da engel varsa imza kapali (motor da fail-closed).
const canSign = computed(
    () =>
        rows.value !== null &&
        typeof props.quote.quoteId === 'string' &&
        props.quote.quoteId !== '' &&
        approvalMode.value !== 'onchain' &&
        (!isTx.value ||
            (props.atsQuoted !== null &&
                props.atsQuoted !== undefined &&
                !props.atsBlocked &&
                // Eksik tahsilat gosterilerek riza alinmaz: bootstrap varken gercek toplam bilinmeli.
                (!atsBootstrap.value || (typeof props.atsTotal === 'number' && Number.isFinite(props.atsTotal) && props.atsTotal > 0)))),
)

// Gecerlilik: katmanin acildigi an + emir gecerlilik suresi, yerel saat.
const validityTime = (() => {
    const end = new Date(Date.now() + ORDER_VALIDITY_SEC * 1000)
    try {
        return new Intl.DateTimeFormat(props.locale, { hour: '2-digit', minute: '2-digit' }).format(end)
    } catch {
        return end.toTimeString().slice(0, 5)
    }
})()

// Yoklama: emir (uid) dolunca baslar. Panel katmanin YERINE gecer. Islem (bStocks) icin uid hep null: yoklama yok.
const { phase, apiStatus, txHash, executedBuy, executedSell, stillPending } = useCowOrderWatch({
    uid: () => placed.value?.uid ?? null,
    chainId: props.stock.chainId,
    initial: () => (placed.value?.state === 'open' ? 'pending' : 'submitting'),
})

// --- Sunum (yoklama mantigi degismez): adimlar, gecen sure, ozet, baglantilar ---
const nowMs = ref(Date.now())
let tickTimer = null
function stopTick() {
    if (tickTimer !== null) clearInterval(tickTimer)
    tickTimer = null
}
function startTick() {
    stopTick()
    tickTimer = setInterval(() => {
        nowMs.value = Date.now()
    }, 1000)
    tickTimer?.unref?.()
}
watch(phase, (p) => {
    if (p === 'fulfilled' || p === 'expired' || p === 'cancelled') stopTick()
})
onUnmounted(stopTick)

const stepIndex = computed(() => stepIndexOf(phase.value, apiStatus.value))
const stepState = (i) => (stepIndex.value === null ? 'upcoming' : i < stepIndex.value ? 'done' : i === stepIndex.value ? 'current' : 'upcoming')
const currentStepLabel = computed(() => (stepIndex.value === null || phase.value === 'fulfilled' ? '' : t(`stockTrade.status.steps.${ORDER_STEP_KEYS[stepIndex.value]}`)))
const failed = computed(() => phase.value === 'expired' || phase.value === 'cancelled')
const elapsedText = computed(() => formatElapsed(nowMs.value - (placed.value?.placedAt ?? nowMs.value)))
const validUntilText = computed(() => {
    const v = placed.value?.validTo
    if (typeof v !== 'number' || !Number.isFinite(v)) return ''
    try {
        return new Intl.DateTimeFormat(props.locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(v))
    } catch {
        return new Date(v).toTimeString().slice(0, 5)
    }
})
const orderChainId = computed(() => placed.value?.chainId ?? props.stock.chainId)
const networkName = computed(() => chainName(orderChainId.value))
const networkLogo = computed(() => chainLogo(orderChainId.value))
const cowUrl = computed(() => cowExplorerOrderUrl(orderChainId.value, placed.value?.uid))
// Ozet: yalniz kayittaki gerceklesen tutarlar; eksik olan satir cizilmez, sayi uydurulmaz.
const summary = computed(() => {
    const p = placed.value
    if (!p || phase.value !== 'fulfilled') return null
    const buy = p.side !== 'sell'
    const stock = buy ? { atoms: executedBuy.value, dec: p.decimals, sym: p.symbol } : { atoms: executedSell.value, dec: p.decimals, sym: p.symbol }
    const pay = buy ? { atoms: executedSell.value, dec: p.payDecimals, sym: p.paySymbol } : { atoms: executedBuy.value, dec: p.payDecimals, sym: p.paySymbol }
    const recv = buy ? stock : pay
    const paid = buy ? pay : stock
    const line = (x) => {
        const v = formatAtomsLocale(x.atoms, x.dec, props.locale)
        return v === null ? null : `${v} ${x.sym ?? ''}`.trim()
    }
    const usd = buy ? stockValueUsd({ atoms: stock.atoms, decimals: stock.dec, price: p.referencePrice }) : null
    const avg = STABLE_PAY.has(p.paySymbol) ? averageUnitPrice({ paidAtoms: pay.atoms, paidDecimals: pay.dec, stockAtoms: stock.atoms, stockDecimals: stock.dec }) : null
    return {
        receivedText: line(recv) ?? '-',
        paidText: line(paid),
        usdText: usd === null ? null : formatMoney(usd, moneyDisplay.value, { locale: props.locale, style: 'price' }),
        avgText: avg === null ? null : formatMoney(avg, moneyDisplay.value, { locale: props.locale, style: 'price' }),
    }
})
const headline = computed(() => {
    const p = placed.value
    switch (phase.value) {
        case 'fulfilled':
            return t('stockTrade.status.fulfilled')
        case 'expired':
            return t('stockTrade.status.expired')
        case 'cancelled':
            return t('stockTrade.status.cancelled')
        case 'pending':
            return t('stockTrade.status.pending')
        default:
            return t('stockTrade.status.submitting')
    }
})

const sameAddr = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()

// Gecmis karti kimligi (bStocks): adresler ISTEKTEN gelir (motor adresi islemin gercek tokeniyle eslestirir).
// Hisse adresi istekte bulunamazsa kimlik HIC yollanmaz (QUOTE_MISMATCH riski yok).
function identityOf(request) {
    const s = props.stock
    if (!request || typeof request !== 'object') return {}
    let stockSide = null
    if (sameAddr(request.inTokenAddress, s?.address)) stockSide = 'in'
    else if (sameAddr(request.outTokenAddress, s?.address)) stockSide = 'out'
    if (stockSide === null) return {}
    const stockMeta = { symbol: s.symbol, name: s.name, address: s.address }
    const payAddress = stockSide === 'in' ? request.outTokenAddress : request.inTokenAddress
    const pay = eng.value.payTokens(s.chainId)?.find((p) => sameAddr(p.address, payAddress))
    const payMeta = pay ? { symbol: pay.symbol, name: pay.symbol, address: payAddress } : null
    return stockSide === 'in'
        ? { inTokenData: stockMeta, ...(payMeta ? { outTokenData: payMeta } : {}) }
        : { outTokenData: stockMeta, ...(payMeta ? { inTokenData: payMeta } : {}) }
}

async function sign() {
    if (signing.value) return // cift tik: ikinci cagri mesaj uretmez
    if (placed.value || !canSign.value) return
    const side = props.side
    const display = props.quote.result?.display
    const request = props.quote.result?.request
    const placedAt = Date.now()
    signing.value = true
    errorCode.value = null
    let res = null
    try {
        // Govde motorun isi: xStocks yalniz { quoteId } gonderir (imzalanan yapi arka plandaki kayittan kurulur);
        // bStocks motoru kayitli istekten SWAP kurar. Ekran mesaj uretmez.
        res = await eng.value.place({
            quote: props.quote,
            request,
            accountIndex: request?.index,
            atsQuoted: props.atsQuoted ?? undefined,
            atsBlocked: props.atsBlocked,
            ...(isTx.value ? identityOf(request) : {}),
        })
    } catch {
        res = null // hata metni arayuze sizmaz
    }
    signing.value = false
    if (res && res.ok === true && res.kind === 'tx') {
        clearExpiry()
        placed.value = { kind: 'tx', side, symbol: props.stock.symbol, hash: res.hash ?? null, unverified: res.unverified === true }
        emit('placed', { id: res.id })
        return
    }
    if (res && res.ok === true && res.kind === 'order' && typeof res.uid === 'string') {
        clearExpiry()
        placed.value = {
            uid: res.uid,
            state: res.state,
            side,
            symbol: props.stock.symbol,
            decimals: side === 'buy' ? display?.buyDecimals : display?.sellDecimals,
            payDecimals: side === 'buy' ? display?.sellDecimals : display?.buyDecimals,
            paySymbol: props.paySymbol,
            referencePrice: display?.referencePrice ?? null,
            chainId: props.stock.chainId,
            placedAt,
            validTo: placedAt + ORDER_VALIDITY_SEC * 1000,
        }
        nowMs.value = placedAt
        startTick()
        emit('placed', { uid: res.uid })
        return
    }
    // Yalniz kapali kume kodu gosterilir; ic mesaj/detail ASLA.
    const code = res && res.ok === false && typeof res.code === 'string' && isEngineCode(res.code) ? res.code : 'UNKNOWN'
    if (CLOSING_CODES.has(code)) {
        props.quote.refresh()
        emit('expired', { code })
        return
    }
    errorCode.value = code
}

// Teklif suresi katman acikken dolarsa katman KAPANIR ve teklif yenilenir.
let expiryTimer = null
function clearExpiry() {
    if (expiryTimer !== null) clearTimeout(expiryTimer)
    expiryTimer = null
}
function onQuoteExpired() {
    expiryTimer = null
    if (placed.value || signing.value) return // imza surerken sonucu arka plan verir
    props.quote.refresh()
    emit('expired', { code: null })
}
function armExpiry() {
    clearExpiry()
    if (placed.value) return
    const at = props.quote.expiresAt
    if (typeof at !== 'number' || !Number.isFinite(at)) return
    expiryTimer = setTimeout(onQuoteExpired, Math.max(0, at - Date.now()))
}
watch(() => props.quote.expiresAt, armExpiry)
onMounted(armExpiry)
onUnmounted(clearExpiry)

function cancelLayer() {
    if (signing.value) return
    emit('close')
}
const closePanel = () => emit('close')
const newTrade = () => emit('new')
// Gerceklesmeyen emirde "Tekrar dene": forma doner (tutar korunur, teklif yenilenir); eski emir yeniden gonderilmez.
const retry = () => emit('close')
// "Hisseyi goruntule": hisse detay sayfasi (popup/App.vue: 'token' + hisse = StockDetail). Secili hisse zaten bu hisse.
function viewStock() {
    page.currentPage = 'token'
}
// "Gecmiste takip et": ana ekranin Etkinlik sekmesi (History). Ekran yonlendirmesi pageStore'dan.
function openHistory() {
    page.homeTab = 'activity'
    page.currentPage = 'home'
}
</script>
