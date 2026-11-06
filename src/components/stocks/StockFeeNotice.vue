<template>
    <div v-if="items.length" data-fee-notices class="flex flex-col gap-2">
        <!-- Metin ve eylem listesi feeNoticeOf'tan gelir; bu bilesen sayi ya da metin karari uretmez. -->
        <div v-for="it in items" :key="it.uid" data-fee-notice :data-fee-uid="it.uid" :data-fee-tone="it.tone" class="rounded-2xl border px-4 py-3 flex flex-col gap-2 text-xs" :class="TONE[it.tone] ?? TONE.info">
            <span data-fee-text>{{ t(it.key, it.params) }}</span>
            <div v-if="it.actions.length" class="flex flex-wrap gap-2">
                <button
                    v-for="a in it.actions"
                    :key="a"
                    :data-fee-action="a"
                    class="px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer"
                    :class="a === 'decline' ? 'border border-slate-300 dark:border-white/10 text-slate-700 dark:text-zinc-300' : 'bg-indigo-600 text-white'"
                    @click="emit('action', { name: a, uid: it.uid })"
                >{{ t('stockTrade.atsFee.btn.' + a) }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { feeNoticeOf } from '../../utils/cow/feeNotice'

const props = defineProps({
    views: { type: Array, default: () => [] },
    walletLocked: { type: Boolean, default: false },
    formatAtsRaw: { type: Function, default: (raw) => raw },
})
const emit = defineEmits(['action'])
const { t } = useI18n()

// AtsFeeCard / uyari bantlariyla ayni palet; yeni renk yok.
const TONE = {
    info: 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 text-slate-700 dark:text-zinc-300',
    warn: 'border-amber-300/50 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300',
    error: 'border-red-300/50 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300',
    ok: 'border-emerald-300/50 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}
// Kilitli kasada imza gerektiren eylemler (odeme, yeniden deneme) sunulmaz: arka plan zaten WALLET_LOCKED derdi.
const SIGNING = new Set(['payNow', 'retry'])

const items = computed(() => {
    const out = []
    for (const view of Array.isArray(props.views) ? props.views : []) {
        const n = feeNoticeOf(view, { walletLocked: props.walletLocked, format: props.formatAtsRaw })
        if (!n) continue
        const actions = props.walletLocked ? n.actions.filter((a) => !SIGNING.has(a)) : n.actions
        out.push({ uid: view.uid, key: n.key, params: n.params, tone: n.tone, actions })
    }
    return out
})
</script>
