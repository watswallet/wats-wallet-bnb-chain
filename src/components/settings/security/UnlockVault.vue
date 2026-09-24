<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-20 transition-colors duration-300">
            <Back page="settings_security_select_phrase" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.unlockVault.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 flex flex-col justify-center gap-8 relative -mt-10 z-10">
            <div class="flex flex-col items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-20 h-20 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                </div>

                <div class="text-center space-y-1">
                    <h2 class="text-lg font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.unlockVault.subtitle') }}</h2>
                    <p class="text-xs text-slate-500 dark:text-zinc-500 max-w-50 mx-auto leading-relaxed transition-colors duration-300">
                        {{ $t('settings.security.unlockVault.desc') }}
                    </p>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <div class="relative group">
                    <input 
                        v-model="password" 
                        :type="showPassword ? 'text' : 'password'" 
                        :placeholder="$t('settings.security.unlockVault.placeholder_pass')" 
                        class="w-full bg-white dark:bg-[#131315] border rounded-xl py-3.5 pl-4 pr-12 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none transition-all duration-300 shadow-sm dark:shadow-none"
                        :class="error ? 'border-rose-400 dark:border-rose-500/50 focus:border-rose-500' : 'border-slate-200 dark:border-zinc-800 focus:border-indigo-500'"
                        @keydown.enter="unlock"
                    >
                    
                    <button 
                        @click="showPassword = !showPassword"
                        class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"
                    >
                        <svg v-if="!showPassword" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    </button>
                </div>

                <div class="h-5 ml-1">
                    <p v-if="error" class="text-xs text-rose-600 dark:text-rose-500 font-bold flex items-center gap-1 animate-fade-in transition-colors duration-300">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {{ $t('settings.security.unlockVault.error_wrong_pass') }}
                    </p>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="unlock"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="isValid && !loading
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.01] shadow-indigo-600/20 dark:shadow-indigo-500/20' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="!isValid || loading"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white/70" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('settings.security.unlockVault.btn_continue') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { unlockVault } from '../../../utils/crypto-utils'
import { verifyPassword } from '../../../utils/masterKey'
import Back from '../../Back.vue'

const props = defineProps(['vault'])
const emit = defineEmits(['mnemonic'])

const page = pageStore()

const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref(false)

const isValid = computed(() => password.value && password.value.length > 0)

// Şifre değişince hatayı temizle
watch(password, () => {
    if (error.value) error.value = false
})

const unlock = async() => {
    if (!isValid.value || loading.value) return

    loading.value = true
    error.value = false

    try {
        const { vaults, walletSalt } = await chrome.storage.local.get(['vaults', 'walletSalt'])

        if (!vaults || !walletSalt) {
            throw new Error("Veri bulunamadı")
        }

        // Şifre doğrulama: diskte anahtar kopyası tutulmadığı için kasa çözerek.
        const masterKey = await verifyPassword(password.value, { walletSalt, vaults })
        if (!masterKey) {
            throw new Error('Invalid password')
        }

        // Seçilen Vault'u çöz
        const mnemonic = await unlockVault(masterKey, props.vault)

        if (mnemonic) {
            emit('mnemonic', mnemonic)
            page.currentPage = 'settings_security_phrases_disclaimer'
        } else {
            throw new Error("Vault çözülemedi")
        }

    } catch (err) {
        console.error(err)
        error.value = true
    } finally {
        loading.value = false
    }
}
</script>

<style scoped>
@keyframes fade-in {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
    animation: fade-in 0.2s ease-out;
}
</style>