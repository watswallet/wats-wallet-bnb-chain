<template>
    <!-- ATS AL (spec docs/superpowers/specs/2026-10-04-ats-satin-alma-design.md §6.4) -- buy-ats
         blokaj kartlarinin eylemi. Satis yolu KAPALIYKEN (bayrak ya da adresler) HICBIR SEY
         cizilmez: kartlar bugunku gibi yalniz metin. -->
    <div v-if="live" class="flex flex-col items-start gap-1 mt-1">
        <!-- GIZLI MOD + PRIVATE_ATS_SALE KAPALI: Gizli Hesap ATS alamaz (gizli-mod spec 23.8). Dugme CIZILMEZ, yerine kisa
             aciklama. Bayrak aciksa (K13) gizli modda da dugme cizilir; dapp notu gizli modda yine cizilmez. -->
        <span v-if="blocked" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t('privacy.atsSale.blocked') }}</span>
        <button v-else type="button"
                :disabled="busy"
                class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer transition-colors duration-200"
                @click="onClick">
            {{ $t('atsSale.buy') }}
        </button>
        <span v-if="noteKey && !privacy.active" class="text-[10px] leading-tight text-slate-500 dark:text-zinc-400">{{ $t(noteKey) }}</span>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useAtsPurchase } from '../composables/useAtsPurchase'
import { privacyStore } from '../store/privacy'
import { atsPurchaseBlocked } from '../utils/atsPurchaseGate'

// `handler`: varsayilan eylem cuzdani satin alma ekranina goturur (openAtsPurchase). Dapp onay
// penceresi KENDI eylemini verir: satin almayi ayri pencerede acip bekleyen istegi reddeder (Dapp.vue).
const props = defineProps({
    noteKey: { type: String, default: null },
    handler: { type: Function, default: null },
})

const { live, open } = useAtsPurchase()
const privacy = privacyStore()
const blocked = computed(() => atsPurchaseBlocked(privacy))
const busy = ref(false)

async function onClick() {
    if (busy.value) return
    busy.value = true
    try {
        if (props.handler) await props.handler()
        else await open()
    } catch (e) {
        console.error('[ats-sale] satin alma ekrani acilamadi:', e)
    } finally {
        busy.value = false
    }
}
</script>
