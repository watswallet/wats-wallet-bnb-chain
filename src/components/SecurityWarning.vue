<template>
    <!-- Alici adresinin guvenlik kartlari. Send.vue ve ConfirmTransaction.vue ayni
         bileseni kullanir: iki ekranda birbirinden kayan iki kopya, kapilardan birinin
         sessizce farkli davranmasi demekti. -->

    <div v-if="checking" class="shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-200 dark:border-white/5 transition-colors duration-300">
        <svg class="w-3.5 h-3.5 animate-spin text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        <span class="text-[10px] font-medium text-slate-500 dark:text-zinc-500">{{ $t('send.reputation.checking') }}</span>
    </div>

    <!-- Itibar saglayicisi bu agi DESTEKLEMIYOR (ornegin Solana). Sessizce hicbir sey
         gostermemek, "kontrol edildi, temiz" ile AYNI deneyimi verir — kullanici hicbir
         seyin kontrol edilmedigini bilmeli. Bu yuzden `checking` bittiginde de, itibar
         `severity` uretmese bile, ayri bir bilgi karti kalir. Onay kutusu YOK: bu bir
         tehdit degil, bir bilgi eksikligi — gonderimi engellemez. -->
    <div v-if="!checking && reputation?.unsupported" class="shrink-0 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-900/60 border border-slate-200 dark:border-white/5 transition-colors duration-300">
        <svg class="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        <span class="text-[10px] font-medium text-slate-500 dark:text-zinc-500">{{ $t('send.reputationUnsupported') }}</span>
    </div>

    <!-- Itibar karti. 'block' onaylanamaz: bildirilmis bir hirsiz adresine "anladim"
         diyerek gonderim yapilabilseydi sert engel diye bir sey olmazdi. -->
    <div v-if="reputation?.severity" class="shrink-0 rounded-2xl border p-3.5 flex flex-col gap-3 transition-colors duration-300"
         :class="isBlock
            ? 'border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10'
            : 'border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10'">
        <div class="flex items-start gap-2">
            <svg class="w-4 h-4 shrink-0 mt-0.5" :class="isBlock ? 'text-red-600 dark:text-red-500' : 'text-amber-600 dark:text-amber-500'" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div class="flex flex-col gap-1 min-w-0">
                <span class="text-xs font-bold" :class="isBlock ? 'text-red-800 dark:text-red-400' : 'text-amber-800 dark:text-amber-400'">
                    {{ isBlock ? $t('send.reputation.blockTitle') : $t('send.reputation.warnTitle') }}
                </span>
                <span class="text-[10px] leading-relaxed" :class="isBlock ? 'text-red-700/90 dark:text-red-300/90' : 'text-amber-700/90 dark:text-amber-300/90'">
                    {{ isBlock ? $t('send.reputation.blockDesc') : $t('send.reputation.warnDesc') }}
                </span>
            </div>
        </div>

        <div class="flex flex-wrap gap-1.5">
            <span v-for="flag in reputation.flags" :key="flag"
                  class="text-[10px] font-bold px-2 py-0.5 rounded-full border"
                  :class="isBlock
                    ? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/25'
                    : 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/25'">
                {{ flagLabel(flag) }}
            </span>
        </div>

        <span v-if="reputation.sources?.length" class="text-[9px] text-slate-500 dark:text-zinc-500">
            {{ $t('send.reputation.sources', { sources: reputation.sources.join(', ') }) }}
        </span>

        <label v-if="!isBlock" class="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="reputationAck" class="mt-0.5 w-3.5 h-3.5 shrink-0 accent-amber-600 cursor-pointer">
            <span class="text-[10px] font-medium text-amber-800 dark:text-amber-300 leading-snug">{{ $t('send.reputation.ack') }}</span>
        </label>
    </div>

    <!-- Zehirli adres karti. Adresler TAM haliyle ve alt alta gosterilir: kisaltilmis
         gosterim (0xAbCd...CdEf) saldiriyi gizleyen seyin ta kendisi. Ayni olan bas/son
         soluk, FARKLI olan orta vurgulu — goz farki aramak zorunda kalmasin. -->
    <div v-if="poisonMatch && poisonParts" class="shrink-0 rounded-2xl border border-red-300 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 p-3.5 flex flex-col gap-3 transition-colors duration-300">
        <div class="flex items-start gap-2">
            <svg class="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div class="flex flex-col gap-1 min-w-0">
                <span class="text-xs font-bold text-red-800 dark:text-red-400">{{ $t('send.poisoning.title') }}</span>
                <span class="text-[10px] leading-relaxed text-red-700/90 dark:text-red-300/90">{{ $t('send.poisoning.desc') }}</span>
            </div>
        </div>

        <div class="flex flex-col gap-2">
            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                    {{ $t('send.poisoning.yours') }} · {{ poisonMatch.label || $t(poisonSourceKey) }}
                </span>
                <span class="text-[10px] font-mono break-all text-slate-400 dark:text-zinc-600">
                    {{ poisonParts.known.head }}<span class="font-bold text-slate-800 dark:text-zinc-100">{{ poisonParts.known.mid }}</span>{{ poisonParts.known.tail }}
                </span>
            </div>

            <div class="flex flex-col gap-0.5">
                <span class="text-[9px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">{{ $t('send.poisoning.entered') }}</span>
                <span class="text-[10px] font-mono break-all text-slate-400 dark:text-zinc-600">
                    {{ poisonParts.entered.head }}<span class="font-bold text-red-600 dark:text-red-400">{{ poisonParts.entered.mid }}</span>{{ poisonParts.entered.tail }}
                </span>
            </div>
        </div>

        <label class="flex items-start gap-2 cursor-pointer select-none">
            <input type="checkbox" v-model="poisonAck" class="mt-0.5 w-3.5 h-3.5 shrink-0 accent-red-600 cursor-pointer">
            <span class="text-[10px] font-medium text-red-800 dark:text-red-300 leading-snug">{{ $t('send.poisoning.ack') }}</span>
        </label>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
    checking: { type: Boolean, default: false },
    reputation: { type: Object, default: null },
    poisonMatch: { type: Object, default: null },
    poisonParts: { type: Object, default: null },
    poisonSourceKey: { type: String, default: '' }
})

const poisonAck = defineModel('poisonAck', { type: Boolean, default: false })
const reputationAck = defineModel('reputationAck', { type: Boolean, default: false })

const { t, te } = useI18n()

const isBlock = computed(() => props.reputation?.severity === 'block')

// Sunucu ileride tanimadigimiz bir bayrak dondurse etiket yerine ham ad gosterilir;
// bos bir rozet gostermek "neden engellendim" sorusunu cevapsiz birakirdi.
function flagLabel(flag) {
    const key = `send.reputation.flags.${flag}`
    return te(key) ? t(key) : flag
}
</script>
