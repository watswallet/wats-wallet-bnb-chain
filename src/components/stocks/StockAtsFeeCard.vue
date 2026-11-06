<template>
    <!-- bStocks Al/Sat ATS ucret karti (spec 5.3). Sunum: sayilar ve kararlar `useAtsOpFee` (reactive `ats`)
         icinden gelir, burada hesap YOK. Kart govdesi Swap.vue / onay adimi ile ayni AtsFeeCard; engel ve
         eksik bakiye bolumleri AYNI kartin icindedir (ucret ve eksik bakiye tek konudur). -->
    <AtsFeeCard
        data-stock-ats-card
        label-key="send.confirmTransaction.atsPaidWith"
        paid-on-bsc-key="send.confirmTransaction.atsPaidOnBsc"
        :amount="ats.atsFee != null ? totalText : null"
        :symbol="ats.atsSymbol"
        :usd-text="usdText"
        :loading="ats.loading"
        logo-uri="/ats.png"
        :show-up-to="ats.feeRefundable"
        :prepaid-key="ats.prepaid ? 'send.confirmTransaction.atsPrepaidNote' : null"
    >
        <template #decision>
            <div v-if="decisionVisible" data-ats-decision class="flex flex-col gap-1.5 pt-2 border-t border-slate-100 dark:border-white/5">
                <span class="text-xs font-bold" :class="ats.decision.severity === 'user' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-zinc-200'">{{ $t(ats.decision.i18nKey, { symbol: ats.atsSymbol }) }}</span>
                <span v-if="ats.decision.action === 'run-onboarding'" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(ats.nextSteps.length > 1 ? 'send.confirmTransaction.atsOnboardingDesc' : 'send.confirmTransaction.atsBudgetLowDesc') }}</span>
                <span v-else-if="ats.decision.i18nDescKey" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(ats.decision.i18nDescKey) }}</span>
                <button
                    v-if="ats.decision.action === 'run-onboarding'"
                    data-ats-onboarding
                    :disabled="ats.loading"
                    class="self-start px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                    @click="$emit('onboard')"
                >{{ $t('send.confirmTransaction.atsOnboardingRun') }}</button>
                <AtsBuyButton v-if="ats.decision.action === 'buy-ats'" />
            </div>
        </template>
        <template #shortfall>
            <div v-if="insufficientVisible" data-ats-insufficient class="flex flex-col gap-1 border-t border-slate-100 dark:border-white/5 pt-2">
                <span class="text-xs font-bold text-rose-600 dark:text-rose-400">{{ $t('send.confirmTransaction.atsInsufficientTitle', { symbol: ats.atsSymbol }) }}</span>
                <span class="text-[10px] text-rose-500 dark:text-rose-300/80">{{ shortfall ? $t('stockTrade.insufficient.detail', shortfall.params) : $t('send.confirmTransaction.atsInsufficientDesc', { amount: requiredText, symbol: ats.atsSymbol }) }}</span>
                <AtsBuyButton />
            </div>
        </template>
    </AtsFeeCard>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { shortfallOfNumbers } from '../../utils/stockBalance'
import AtsFeeCard from '../AtsFeeCard.vue'
import AtsBuyButton from '../AtsBuyButton.vue'
import { configStore } from '../../store/config'
import { useUsdPrice } from '../../composables/useUsdPrice'
import { tokenToUsd, formatUsd } from '../../utils/assetPrice'
import { ATS_COINGECKO_ID } from '../../utils/atsConfig'

const props = defineProps({
    // reactive(useAtsOpFee()) -- ref'ler acik (unwrapped)
    ats: { type: Object, required: true },
})
defineEmits(['onboard'])
const { locale } = useI18n()

// Gosterim kirpmasi (Swap.vue fmt ile ayni): 4 hane, sondaki sifirlar atilir. Imzalanan tutar buradan gecmez.
const fmt = (n) => (n == null ? '' : Number(n).toFixed(4).replace(/\.?0+$/, ''))
const totalText = computed(() => fmt(props.ats.totalAtsCost))
// Dolar karsiligi: Swap/Onayla ile AYNI yol (useUsdPrice + ATS_COINGECKO_ID, 60 sn onbellek). Fiyat ya da tutar
// yoksa null -> satir hic cizilmez ("$0.00" bir ucret kartinda "bedava" demek olurdu). Beklenmez: ikincil satir.
const config = configStore()
const atsPrice = useUsdPrice({ apiBase: () => config.api })
onMounted(() => { atsPrice.loadById(ATS_COINGECKO_ID) })
const usdText = computed(() => {
    const p = Number(atsPrice.price.value)
    if (props.ats.atsFee == null || !(p > 0)) return null
    return formatUsd(tokenToUsd(props.ats.totalAtsCost, p))
})
const requiredText = computed(() => fmt(props.ats.requiredAtsFor(0)))
// Eksik ATS: gereken / mevcut / eksik; kurulamazsa eski 'gerekli' satiri.
const shortfall = computed(() => shortfallOfNumbers({ required: props.ats.requiredAtsFor(0), have: props.ats.atsBalance, symbol: props.ats.atsSymbol, locale: locale.value }))
// Engel karti: backend kendi engelini verdiyse ve istemci hatasi degilse gorunur.
const decisionVisible = computed(() => Boolean(props.ats.decision) && !props.ats.loading && props.ats.decision.severity !== 'internal')
// Eksik bakiye, sunucu engeli ayni seyi anlatmiyorsa gorunur (ayni sey iki kez yazilmaz).
const insufficientVisible = computed(() => props.ats.insufficient === true && !props.ats.loading && !decisionVisible.value)
</script>
