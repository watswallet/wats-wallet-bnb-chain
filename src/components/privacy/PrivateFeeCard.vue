<template>
    <!-- GIZLI MOD UCRETLER KARTI (sade Para yukle / Gonder / Takas / Kopru ekranlari: dort mod, spec 5.6). Saf sunum: ag, depo, mesaj yok.
         Kabuk AtsFeeCard.vue kabugudur. Hicbir yerde dolar karsiligi yoktur (gizli modda fiyat istegi yok). -->
    <div data-testid="fee-card" class="shrink-0 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-3 flex flex-col gap-1.5 transition-colors duration-300 shadow-sm dark:shadow-none">
        <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-sm text-slate-900 dark:text-white transition-colors duration-300">{{ $t('privacy.transfer.feesTitle') }}</span>
            <span data-testid="fee-tag" class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#202022] text-slate-600 dark:text-zinc-300 transition-colors duration-300">{{ tag }}</span>
        </div>

        <!-- SilentSwap ucreti: teklif varsa gercek toplam (hizmet + ortak), yoksa tahmin, aksi tire. -->
        <div data-testid="fee-service" class="flex items-center justify-between gap-3 text-xs">
            <span class="text-slate-500 dark:text-zinc-400 transition-colors duration-300">{{ $t('privacy.review.serviceFee') }}</span>
            <span v-if="serviceText !== null" class="inline-flex items-center justify-end gap-1.5 font-bold text-slate-900 dark:text-white tabular-nums">
                <img v-if="quoteFee !== null" src="/usdc.png" alt="" decoding="async" class="w-3.5 h-3.5 rounded-full shrink-0" @error="onLogoError">
                <span>{{ serviceText }}</span>
            </span>
            <span v-else class="font-bold text-slate-300 dark:text-zinc-700">—</span>
        </div>

        <!-- Ag ucreti: ATS durumuna gore. Tutar bicimlenmez, ekrandan geldigi gibi yazilir. "hesaplaniyor..." YALNIZ gercekten bir sey yuklenirken:
             ATS ucreti yukleniyor (loading) ya da teklif yolda (quoteLoading). Hicbir sey hesaplanmiyorsa (ATS idle ve teklif yolda degil: tutar bos, en az tutarin
             altinda, alici/kaynak eksik, hiz siniri beklemesi, hata) tire. -->
        <div data-testid="fee-network" class="flex items-center justify-between gap-3 text-xs">
            <span class="text-slate-500 dark:text-zinc-400 transition-colors duration-300">{{ $t('privacy.transfer.feeNetwork') }}</span>
            <span v-if="ats.state === 'idle' && !quoteLoading" class="font-bold text-slate-300 dark:text-zinc-700">—</span>
            <span v-else-if="ats.state === 'idle' || ats.state === 'loading'" class="text-slate-500 dark:text-zinc-400">{{ $t('privacy.transfer.feeCalculating') }}</span>
            <span v-else-if="ats.state === 'ready'" class="inline-flex items-baseline justify-end gap-1.5 min-w-0">
                <img src="/ats.png" alt="" decoding="async" class="w-4 h-4 rounded-full shrink-0 self-center" @error="onAtsLogoError">
                <span v-if="ats.refundable" class="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-zinc-500 shrink-0">{{ $t('send.confirmTransaction.atsFeeUpTo') }}</span>
                <span class="font-bold text-slate-900 dark:text-white tabular-nums truncate">{{ ats.amount }}</span>
                <span class="font-bold text-slate-500 dark:text-zinc-400 shrink-0">{{ ats.symbol }}</span>
                <!-- Iade edilmez bilgisi dipnota (Ayrinti) saklanmaz: kisa metin satirda hep gorunur (H1). Iade edilebilirse "en fazla" niteleyicisi zaten ayni isi gorur. -->
                <span v-if="!ats.refundable" data-testid="fee-network-short" class="text-[10px] font-medium text-slate-400 dark:text-zinc-500 shrink-0">· {{ $t('privacy.transfer.feeNoRefund') }}</span>
            </span>
            <span v-else-if="ats.state === 'short'" class="font-bold text-red-600 dark:text-red-400 text-right">{{ ats.required != null ? $t('privacy.transfer.feeNeedsAts', { amount: ats.required }) : (ats.message || '—') }}</span>
            <span v-else-if="ats.message" class="text-slate-500 dark:text-zinc-400 text-right">{{ ats.message }}</span>
            <span v-else class="font-bold text-slate-300 dark:text-zinc-700">—</span>
        </div>
        <!-- Onceki odeme notu (zumrut: bir kolaylik, uyari degil). -->
        <span v-if="ats.state === 'ready' && ats.prepaid" class="text-[10px] leading-tight text-emerald-600 dark:text-emerald-500 font-bold">{{ $t('send.confirmTransaction.atsPrepaidNote') }}</span>
        <!-- Ag ucreti satirinin alti: ekran ATS yetersiz / kurulum / yeniden dene bloklarini buraya koyar. -->
        <slot name="ats-extra"></slot>

        <!-- Teslim edilen deger: yalniz teklifte hedef varken. Hesaplanamazsa satir yerine "dogrulanamadi" notu. -->
        <template v-if="quote && quote.dest">
            <div v-if="share.pay !== null" data-testid="fee-share" class="flex items-center justify-between gap-3 text-xs" :class="share.warn ? 'text-amber-600 dark:text-amber-400' : ''">
                <span :class="share.warn ? '' : 'text-slate-500 dark:text-zinc-400'">{{ $t('privacy.review.deliveredShare') }}</span>
                <span class="font-bold tabular-nums">{{ shareText }}</span>
            </div>
            <div v-else data-testid="share-unknown" class="text-[11px] text-slate-500 dark:text-zinc-400">{{ $t('privacy.review.shareUnknown') }}</div>
            <div v-if="share.warn" data-testid="cost-warning" class="text-[11px] font-medium text-amber-600 dark:text-amber-400">{{ $t('privacy.review.costWarning', { n: costText }) }}</div>
        </template>

        <!-- Ayrinti: varsayilan KAPALI. Dipnotlar (SilentSwap ucreti ustune eklenir, ag ucreti notu) icinde oldugu icin dugme her durumda vardir. -->
        <button type="button" data-testid="fee-detail-toggle" :aria-expanded="detailOpen ? 'true' : 'false'" class="self-start flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors duration-300" @click="detailOpen = !detailOpen">
            {{ $t('privacy.transfer.detail') }}
            <svg class="w-3.5 h-3.5 shrink-0 transition-transform duration-300" :class="detailOpen ? 'rotate-180' : ''" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z" /></svg>
        </button>
        <div v-if="detailOpen" data-testid="fee-detail" class="flex flex-col gap-1.5 text-xs">
            <template v-if="quote">
                <div class="flex justify-between gap-3"><span class="text-slate-500 dark:text-zinc-400">{{ $t('privacy.review.serviceFee') }}</span><span class="text-right tabular-nums">{{ quote.serviceFeeUsdc }} USDC</span></div>
                <div class="flex justify-between gap-3"><span class="text-slate-500 dark:text-zinc-400">{{ $t('privacy.review.partnerFee') }}</span><span class="text-right tabular-nums">{{ quote.integratorFeeUsdc }} USDC<template v-if="quote.integratorAddress"> · {{ shortenAddress(quote.integratorAddress) }}</template></span></div>
                <div v-if="validUntil" class="flex justify-between gap-3"><span class="text-slate-500 dark:text-zinc-400">{{ $t('privacy.review.validUntil') }}</span><span class="text-right tabular-nums">{{ validUntil }}</span></div>
                <div v-if="expected" class="flex justify-between gap-3"><span class="text-slate-500 dark:text-zinc-400">{{ $t('privacy.review.deliversExpected') }}</span><span class="font-bold text-right tabular-nums" :title="expected.exact + ' ' + quote.dest.asset">{{ expected.trimmed ? '~' : '' }}{{ expected.text }} {{ quote.dest.asset }}</span></div>
            </template>
            <!-- Dipnotlar. Hesap adi eki URETILMEZ (sT14): metin tek ve sabit. -->
            <div data-testid="fee-notes" class="flex flex-col gap-1" :class="quote ? 'border-t border-slate-100 dark:border-white/5 pt-1.5' : ''">
                <span data-testid="fee-note-service" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-500">{{ $t('privacy.transfer.feeNoteService', { min: minUsdc }) }}</span>
                <span data-testid="fee-note-network" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-500">{{ networkNote }}</span>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { shortenAddress } from '../../utils/shortenAddress'
import { formatRawAmount, trimAmount } from '../../utils/privacy/displayAmount'
import { QUOTE_MIN_REMAINING_MS } from '../../utils/privacy/privateConstants'
import { deliveredShare } from '../../utils/privacy/deliveredShare'
import { totalSilentSwapFee, feePercent, estimatedServiceFee } from '../../utils/privacy/feeBreakdown'

// Ucretler karti (sade Para yukle / Gonder / Takas / Kopru). SAF SUNUM: ekran verir, kart cizer; ag, depo ve mesaj yoktur.
// quote: teklif aninda DONDURULMUS ozet (serviceFeeUsdc, integratorFeeUsdc, integratorAddress, totalUsdc, dest, expiresAtMs) ya da null.
// payoutText: kanonik tutar ya da '' (teklif oncesi tahmin icin). ats.message: ekranin cevirdigi, tire yerine gosterilen metin (X5).
const props = defineProps({
    mode: { type: String, default: 'fund' },
    quote: { type: Object, default: null },
    destIsUsdc: { type: Boolean, default: false },
    feeBps: { type: Number, default: null },
    payoutText: { type: String, default: '' },
    minUsdc: { type: Number, default: 12 },
    belowMin: { type: Boolean, default: false },
    // Teklif gercekten yolda mi (ekran: uygun girdi, teklif bekleniyor/isteniyor, elde teklif yok). Yalniz bu ve ats.state loading "hesaplaniyor..." gosterir.
    quoteLoading: { type: Boolean, default: false },
    ats: {
        type: Object,
        default: () => ({ state: 'idle', amount: null, symbol: 'ATS', required: null, refundable: false, prepaid: false }),
    },
})
const { t, locale } = useI18n()

// Ayrinti bolumu varsayilan kapali.
const detailOpen = ref(false)

// Logo yuklenemezse varsayilan simge (onerror once temizlenir, dongu olmasin).
function onLogoError(e) {
    e.target.onerror = null
    e.target.src = '/default-token.png'
}
function onAtsLogoError(e) {
    e.target.style.display = 'none'
}

// Etiket: oran bilinmiyorsa sade "SilentSwap" (sabit %1 yedegi YOK).
const pct = computed(() => feePercent({ feeBps: props.feeBps, summary: props.quote }))
const tag = computed(() => (pct.value === null
    ? 'SilentSwap'
    : t('privacy.transfer.feeTag', { pct: pct.value.toLocaleString(locale.value, { maximumFractionDigits: 1 }) })))

// SilentSwap ucreti: teklif varsa toplam; yoksa tahmin (en az altindaysa gosterilmez); aksi null (tire).
const quoteFee = computed(() => (props.quote ? totalSilentSwapFee(props.quote) : null))
const estimate = computed(() => (props.belowMin ? null : estimatedServiceFee(props.payoutText, props.feeBps)))
const serviceText = computed(() => {
    if (quoteFee.value !== null) return `${quoteFee.value} USDC`
    if (estimate.value !== null) return `≈ ${estimate.value} USDC`
    return null
})

// Ag ucreti dipnotu: iade edilebiliyorsa "en fazla"; degilse moda gore: Para yukle'de kaynak normal hesap (feeNoteFund), digerlerinde Gizli Hesap (feeNoteSend).
const networkNote = computed(() => {
    if (props.ats.refundable) return t('privacy.transfer.feeNoteUpTo')
    return t(props.mode !== 'fund' ? 'privacy.transfer.feeNoteSend' : 'privacy.transfer.feeNoteFund')
})

// Teslim edilen deger payi. Yuzde yerel ayara gore; maliyet uyarisinin {n} degeri YALNIZ sayidir.
const share = computed(() => deliveredShare(props.quote, { tableUsdc: props.destIsUsdc }))
const shareText = computed(() => (share.value.pay === null
    ? ''
    : (share.value.pay / 100).toLocaleString(locale.value, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })))
const costText = computed(() => (share.value.cost === null
    ? ''
    : share.value.cost.toLocaleString(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 })))

// Ayrinti: "gecerli" saati ETKIN saattir (sunucu bitisi eksi QUOTE_MIN_REMAINING_MS).
const validUntil = computed(() => (props.quote?.expiresAtMs
    ? new Date(props.quote.expiresAtMs - QUOTE_MIN_REMAINING_MS).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
    : null))
// Beklenen teslim: ondalik tamsayi degilse ya da tutar bicimlenemiyorsa satir yok (yedek ondalik YOK).
const expected = computed(() => {
    const dest = props.quote?.dest
    if (!dest || !Number.isInteger(dest.decimals)) return null
    const value = formatRawAmount(dest.expectedDestAmount, dest.decimals)
    return value === null ? null : trimAmount(value)
})
</script>
