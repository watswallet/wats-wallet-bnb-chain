<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_edit_account" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.account.editAccountName.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-8 relative z-10">
            
            <div class="flex flex-col items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${account?.address}`" class="rounded-full w-20 h-20 shadow-sm dark:shadow-none" />
                </div>
                <p class="text-sm font-medium text-slate-500 dark:text-zinc-500 text-center px-4 transition-colors duration-300">{{ $t('settings.account.editAccountName.description') }}</p>
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.account.editAccountName.accountName') }}</label>
                
                <div class="relative group">
                    <input 
                        v-model="new_name" 
                        type="text" 
                        :placeholder="$t('settings.account.editAccountName.search')" 
                        class="w-full bg-white dark:bg-[#131315] border rounded-xl py-3.5 pl-4 pr-10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none transition-all duration-300 shadow-sm dark:shadow-none"
                        :class="[
                            taken ? 'border-rose-400 dark:border-rose-500/50 focus:border-rose-500' : 
                            (isValid ? 'border-emerald-400 dark:border-emerald-500/50 focus:border-emerald-500' : 'border-slate-200 dark:border-zinc-800 focus:border-indigo-500')
                        ]"
                    >
                    
                    <div class="absolute right-3 top-1/2 -translate-y-1/2">
                        <svg v-if="taken" class="w-5 h-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        <svg v-else-if="isValid" class="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                    </div>
                </div>

                <div class="h-5 ml-1">
                    <p v-if="taken" class="text-xs text-rose-500 dark:text-rose-400 flex items-center gap-1 animate-fade-in transition-colors duration-300">{{ $t('settings.account.editAccountName.taken') }}</p>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="changeName"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="canSave 
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.01] shadow-indigo-500/20' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-transparent dark:border-white/5'"
                :disabled="!canSave"
            >
                <svg v-if="saving" class="w-4 h-4 animate-spin text-white/70" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('settings.account.editAccountName.save') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, watch, computed } from 'vue'
import { pageStore } from '../../../store/pageStore'
import Back from '../../Back.vue'

const props = defineProps(['account'])
const emit = defineEmits(['accountUpdated']) // Gerekirse parent'ı uyar

const page = pageStore()

const new_name = ref(props.account.name)
const accountNames = ref([])
const taken = ref(false)
const saving = ref(false)

// Validasyon Durumları
const isValid = computed(() => !taken.value && new_name.value.length > 0 && new_name.value !== props.account.name)
const canSave = computed(() => isValid.value && !saving.value)

onMounted(async() => {
    const { vaults } = await chrome.storage.local.get('vaults')
    if (vaults) {
        for (const vault of vaults) {
            for (const account of vault.accounts) {
                // Kendi ismini hariç tut, diğerlerini listeye ekle
                if (account.name.toLowerCase() !== props.account.name.toLowerCase()) accountNames.value.push(account.name.toLowerCase())
            }
        }
    }
})

watch(new_name, (val) => {
    if (accountNames.value.includes(val.trim().toLowerCase())) {
        taken.value = true
    } else {
        taken.value = false
    }
})

const changeName = async() => {
    if (!canSave.value) return
    
    saving.value = true
    
    try {
        const { vaults, active_account } = await chrome.storage.local.get(['vaults', 'active_account'])
        
        let updated = false
        let updatedAccountObj = null

        // 1. Vault içindeki ismi güncelle
        for (const vault of vaults) {
            for (const account of vault.accounts) {
                // ID veya Adres kontrolü daha güvenlidir ama burada name üzerinden gidiyoruz (orijinal kod mantığı)
                // Not: Orijinal kodda isim üzerinden eşleştirme yapılıyor.
                if (props.account.name.toLowerCase() === account.name.toLowerCase()) {
                    account.name = new_name.value.trim()
                    updatedAccountObj = account
                    updated = true
                    break
                }
            }
            if (updated) break
        }
        
        if (updated) {
            if (active_account && active_account.name.toLowerCase() === props.account.name.toLowerCase()) await chrome.storage.local.set({ active_account: updatedAccountObj })

            await chrome.storage.local.set({ vaults })
            
            page.currentPage = 'settings_manage_accounts'
        }
    } catch (error) {
        console.error('Error updating account name:', error)
    } finally {
        saving.value = false
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