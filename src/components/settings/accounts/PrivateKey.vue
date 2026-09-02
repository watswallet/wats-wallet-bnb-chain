<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-rose-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-rose-500/5 dark:from-rose-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_edit_account" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <span class="w-8"></span>

            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.account.privateKey.title') }}</h1>
            
            <button 
                @click="handleCopy"
                class="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 text-slate-400 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white transition-colors cursor-pointer"
                :title="$t('settings.account.privateKey.tooltip_copy')"
            >
                <svg v-if="!copied" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                <svg v-else class="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-6 relative z-10 pb-20">
            <div class="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-xl p-4 flex gap-3 items-start transition-colors duration-300 shadow-sm dark:shadow-none">
                <svg class="w-5 h-5 text-rose-600 dark:text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div class="flex flex-col gap-1">
                    <h3 class="text-sm font-bold text-rose-800 dark:text-rose-200 transition-colors duration-300">{{ $t('settings.account.privateKey.warning_title') }}</h3>
                    
                    <i18n-t keypath="settings.account.privateKey.warning_desc" tag="p" class="text-[11px] text-rose-700/80 dark:text-rose-200/70 leading-relaxed transition-colors duration-300">
                        <template #control>
                            <b class="text-rose-900 dark:text-rose-400">{{ $t('settings.account.privateKey.warning_control_text') }}</b>
                        </template>
                    </i18n-t>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <p class="text-xs text-slate-500 dark:text-zinc-500 font-bold ml-1 transition-colors duration-300">{{ $t('settings.account.privateKey.label_your_key') }}</p>
                
                <div class="relative group">
                    <div 
                        class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl p-4 transition-all duration-300 shadow-sm dark:shadow-none"
                        :class="isRevealed ? 'border-rose-300 dark:border-rose-500/30 bg-rose-50/30 dark:bg-rose-900/5' : ''"
                    >
                        <p 
                            class="font-mono text-sm break-all leading-relaxed transition-all duration-300"
                            :class="isRevealed ? 'text-rose-900 dark:text-rose-100 blur-0' : 'text-slate-400 dark:text-zinc-600 blur-md select-none'"
                        >
                            {{ privateKey }}
                        </p>
                    </div>

                    <div 
                        v-if="!isRevealed"
                        @click="isRevealed = true"
                        class="absolute inset-0 flex items-center justify-center cursor-pointer rounded-2xl hover:bg-slate-50/50 dark:hover:bg-white/5 transition-colors"
                    >
                        <div class="flex items-center gap-2 bg-white dark:bg-zinc-900/80 backdrop-blur-sm px-4 py-2 rounded-full border border-slate-200 dark:border-white/10 shadow-lg transition-colors duration-300">
                            <svg class="w-4 h-4 text-slate-600 dark:text-zinc-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            <span class="text-xs font-bold text-slate-800 dark:text-white">{{ $t('settings.account.privateKey.click_to_reveal') }}</span>
                        </div>
                    </div>

                    <button 
                        v-if="isRevealed"
                        @click="isRevealed = false"
                        class="absolute -top-7 right-0 text-xs font-bold text-slate-400 dark:text-zinc-500 hover:text-indigo-600 dark:hover:text-zinc-300 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        {{ $t('settings.account.privateKey.hide') }}
                    </button>
                </div>
            </div>

            <button 
                @click="handleCopy"
                class="flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-zinc-500 hover:bg-white dark:hover:bg-white/5 transition-all group mt-2 cursor-pointer"
            >
                <span class="text-xs font-bold transition-colors" :class="copied ? 'text-emerald-600 dark:text-emerald-500' : 'text-slate-500 dark:text-zinc-400 group-hover:text-slate-800 dark:group-hover:text-zinc-200'">
                    {{ copied ? $t('settings.account.privateKey.copy_success') : $t('settings.account.privateKey.copy_action') }}
                </span>
                <svg v-if="!copied" class="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 group-hover:text-indigo-600 dark:group-hover:text-zinc-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
            </button>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-slate-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white hover:scale-[1.01] transition-all shadow-lg cursor-pointer"
                @click="page.currentPage = 'settings_edit_account'"
            >
                {{ $t('settings.account.privateKey.btn_done') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { copy } from '../../../utils/copy'
import Back from '../../Back.vue'

const props = defineProps(['privateKey'])
const page = pageStore()

const isRevealed = ref(false)
const copied = ref(false)

const handleCopy = () => {
    copy(props.privateKey)
    copied.value = true
    setTimeout(() => {
        copied.value = false
    }, 2000)
}
</script>