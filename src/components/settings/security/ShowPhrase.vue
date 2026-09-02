<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-rose-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-rose-500/5 dark:from-rose-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_security" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <span class="w-8"></span>

            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.showPhrase.title') }}</h1>
            
            <button 
                @click="copyPhrases"
                class="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 text-slate-400 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white transition-colors relative group cursor-pointer"
                :title="$t('settings.security.showPhrase.tooltip_copy')"
            >
                <svg v-if="!copied" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                <svg v-else class="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-5 pt-5 flex flex-col gap-6 relative pb-6 z-10">
            <div class="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-2xl p-4 flex gap-3 items-start shadow-sm dark:shadow-lg dark:shadow-rose-900/10 transition-colors duration-300">
                <div class="p-1.5 rounded-lg bg-white dark:bg-rose-500/20 shrink-0 text-rose-600 dark:text-rose-500 mt-0.5 shadow-sm dark:shadow-none">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                </div>

                <div class="flex flex-col gap-1">
                    <h3 class="text-sm font-bold text-rose-800 dark:text-rose-100 transition-colors duration-300">{{ $t('settings.security.showPhrase.warning_title') }}</h3>
                    <p class="text-[11px] text-rose-700/80 dark:text-rose-200/70 leading-relaxed transition-colors duration-300">{{ $t('settings.security.showPhrase.warning_desc') }}</p>
                </div>
            </div>

            <p v-if="isDerivedEvm" class="text-[11px] text-amber-700 dark:text-amber-300/80 leading-relaxed bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl px-4 py-3 -mt-2 transition-colors duration-300">
                {{ $t('settings.account.showPhrases.ton_master_note') }}
            </p>

            <div class="grid grid-cols-3 gap-2.5">
                <div 
                    v-for="(phrase, index) in mnemonic.split(' ')" 
                    :key="index"
                    class="group relative flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-lg hover:border-indigo-400 dark:hover:border-white/10 transition-all shadow-sm dark:shadow-none select-none"
                >
                    <span class="text-[10px] font-mono text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-500 w-4 text-right transition-colors">{{ index + 1 }}.</span>
                    <span class="text-xs font-bold text-slate-800 dark:text-zinc-200 group-hover:text-slate-900 dark:group-hover:text-white tracking-wide transition-colors">{{ phrase }}</span>
                </div>
            </div>

            <button 
                @click="copyPhrases"
                class="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-indigo-500 dark:hover:border-zinc-500 hover:bg-white dark:hover:bg-white/5 transition-all group mt-2 cursor-pointer"
            >
                <span class="text-xs font-bold transition-colors" :class="copied ? 'text-emerald-600 dark:text-emerald-500' : 'text-slate-500 dark:text-zinc-400 group-hover:text-slate-800 dark:group-hover:text-zinc-200'">
                    {{ copied ? $t('settings.security.showPhrase.btn_copied') : $t('settings.security.showPhrase.btn_copy_all') }}
                </span>
                <svg v-if="!copied" class="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 group-hover:text-indigo-600 dark:group-hover:text-zinc-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
            </button>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-slate-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white hover:scale-[1.01] transition-all shadow-lg cursor-pointer"
                @click="page.currentPage = 'settings_security'"
            >
                {{ $t('settings.security.showPhrase.btn_done') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { isDerivedEvmVault } from '../../../utils/ton/linkedAccounts'
import Back from '../../Back.vue'

const props = defineProps(['mnemonic', 'vault'])
const page = pageStore()
const copied = ref(false)

// Bu ekran KASA yolundan gelir: kullanici hesabi degil kasayi acti, elimizde
// `account.tonFingerprint` yok - kapi KASA uzerinden kuruluyor.
//
// Turetilmis EVM kasasi burada gecerli ama TEK BASINA YETMEYEN bir ifade gosterir.
// docs/ton-evm-turetme.md kullaniciyi tam bu ekrana yolluyor; not olmasaydi
// kullanici ifadeyi yazip "yedeklendim" der, Tonkeeper ifadesini atarsa TON parasi
// KALICI olarak kaybolurdu.
//
// TON kasasinin KENDISI bu kapidan gecmez (hesap tasimaz, §6.1) - dogrusu bu:
// orada gosterilen ifade ZATEN ana ifadedir, uyari yanlis olurdu.
const isDerivedEvm = computed(() => isDerivedEvmVault(props.vault))

const copyPhrases = async () => {
    try {
        await navigator.clipboard.writeText(props.mnemonic)
        copied.value = true
        setTimeout(() => {
            copied.value = false
        }, 2000)
    } catch (err) {
        console.error('Copy error:', err)
    }
}
</script>