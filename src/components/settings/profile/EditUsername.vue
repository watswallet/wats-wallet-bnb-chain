<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_edit_profile" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.profile.editUsername.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-6 relative z-10">
            <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.profile.editUsername.label_new') }}</label>
                
                <div class="relative group">
                    <div class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 font-bold pointer-events-none transition-colors duration-300">@</div>
                    
                    <input 
                        v-model="username" 
                        type="text" 
                        :placeholder="$t('settings.profile.editUsername.placeholder')" 
                        class="w-full bg-white dark:bg-[#131315] border rounded-xl py-3.5 pl-9 pr-10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none transition-all duration-300 shadow-sm dark:shadow-none"
                        :class="inputBorderClass"
                        @input="checkAvailability"
                    >
                    
                    <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
                        <button 
                            v-if="username && !checking" 
                            @click="username = ''"
                            class="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <svg v-if="checking" class="w-4 h-4 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    </div>
                </div>
            </div>

            <div class="flex flex-col gap-3 min-h-15">
                <div v-if="checking" class="flex items-center gap-2 px-1 animate-pulse">
                    <span class="text-xs text-slate-400 dark:text-zinc-400 font-bold">{{ $t('settings.profile.editUsername.status_checking') }}</span>
                </div>

                <div v-else-if="errorMessage" class="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-xl p-3 flex items-start gap-3 animate-fade-in transition-colors duration-300 shadow-sm dark:shadow-none">
                    <svg class="w-5 h-5 text-rose-600 dark:text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-rose-700 dark:text-rose-400">{{ $t('settings.profile.editUsername.status_unavailable_title') }}</span>
                        <span class="text-xs text-rose-600/80 dark:text-rose-500/70">{{ errorMessage }}</span>
                    </div>
                </div>

                <div v-else-if="isValid && username" class="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-xl p-3 flex items-start gap-3 animate-fade-in transition-colors duration-300 shadow-sm dark:shadow-none">
                    <svg class="w-5 h-5 text-emerald-600 dark:text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-emerald-700 dark:text-emerald-400">{{ $t('settings.profile.editUsername.status_available_title') }}</span>
                        <span class="text-xs text-emerald-600/80 dark:text-emerald-500/70">{{ $t('settings.profile.editUsername.status_available_desc') }}</span>
                    </div>
                </div>

                <div v-else-if="!isValid && username" class="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-xl p-3 flex items-start gap-3 animate-fade-in transition-colors duration-300 shadow-sm dark:shadow-none">
                    <svg class="w-5 h-5 text-rose-600 dark:text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-rose-700 dark:text-rose-400">{{ $t('settings.profile.editUsername.status_unavailable_title') }}</span>
                        <span class="text-xs text-rose-600/80 dark:text-rose-500/70">{{ $t('settings.profile.editUsername.status_unavailable_desc') }}</span>
                    </div>
                </div>

                <div v-else class="flex items-start gap-2 px-1 text-slate-400 dark:text-zinc-500 transition-colors duration-300">
                    <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    
                    <i18n-t keypath="settings.profile.editUsername.info_text" tag="p" class="text-xs leading-relaxed">
                        <template #days>
                            <b class="text-slate-600 dark:text-zinc-300">{{ $t('settings.profile.editUsername.info_days_bold') }}</b>
                        </template>
                    </i18n-t>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="save"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="canSave 
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.01] shadow-indigo-600/20 dark:shadow-indigo-500/20' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="!canSave"
            >
                <span v-if="saving" class="flex items-center gap-2">
                    <svg class="w-4 h-4 animate-spin text-white/70" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ $t('settings.profile.editUsername.btn_saving') }}
                </span>
                <span v-else>{{ $t('settings.profile.editUsername.btn_save') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import axios from 'axios'
import { onMounted, ref, watch, computed } from 'vue'
import { pageStore } from '../../../store/pageStore'
import Back from '../../Back.vue'
import { configStore } from '../../../store/config'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const page = pageStore()
const config = configStore()

const profile = ref(null)
const username = ref('')
const isValid = ref(false)
const checking = ref(false)
const saving = ref(false)
const errorMessage = ref(null)

const inputBorderClass = computed(() => {
    if (checking.value) return 'border-indigo-500/50 focus:border-indigo-500'
    if (username.value && isValid.value) return 'border-emerald-500/50 focus:border-emerald-500 bg-emerald-500/5'
    if (username.value && !isValid.value) return 'border-rose-500/50 focus:border-rose-500 bg-rose-500/5'
    return 'border-zinc-800 focus:border-indigo-500'
})

const canSave = computed(() => isValid.value && username.value && !checking.value && !saving.value)

onMounted(async() => {
    const { user } = await chrome.storage.local.get('user')
    profile.value = user
    if(user?.username) username.value = user.username
})

function debounce(fn, delay) {
    let timeoutId
    return function (...args) {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
            fn.apply(this, args)
        }, delay)
    }
}

const debouncedCheckUsername = debounce(async (val) => {
    if (!val) {
        checking.value = false
        isValid.value = false
        return
    }

    try {
        const { data } = await axios.post(config.api + '/checkUsername', { username: val })
        
        if (data.found) isValid.value = false
        else isValid.value = true

    } catch (error) {
        isValid.value = false
    } finally {
        checking.value = false
    }
}, 500)

watch(username, (new_username) => {
    if (new_username === profile.value?.username) {
        isValid.value = false
        return
    }
    
    if (new_username) {
        checking.value = true
        debouncedCheckUsername(new_username)
    } else {
        isValid.value = false
        checking.value = false
    }
})

const save = async () => {
    if (!canSave.value) return
    saving.value = true
    errorMessage.value = null

    try {
        const { active_account } = await chrome.storage.local.get('active_account')

        const message = {
            sign_message: `change ${active_account.address} name as ${username.value}`,
            index: active_account.derivationPath
        }

        const data = await chrome.runtime.sendMessage({ type: 'SIGN', message })
        if(!data.success) return

        await axios.post(config.api + '/profile/changeUsername', {
            userID: profile.value.userID,
            address: active_account.address,
            signature: data.signature,
            new_username: username.value
        })
        
        const newUser = { ...profile.value, username: username.value }
        await chrome.storage.local.set({ user: newUser })
        
        page.currentPage = 'settings_edit_profile'
        
    } catch (e) {
        console.error('Username update error:', e)

        if (e.response && e.response.data && e.response.data.message) errorMessage.value = e.response.data.message
        else if (e.request) errorMessage.value = t('settings.profile.editUsername.error_network')
        else errorMessage.value = e.message || t('settings.profile.editUsername.error_unknown')

    } finally {
        saving.value = false
    }
}
</script>

<style scoped>
@keyframes fade-in {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
    animation: fade-in 0.3s ease-out;
}
</style>