<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <span class="w-8"></span>

            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.addresses.savedAddresses.title') }}</h1>
            
            <button 
                @click="page.currentPage = 'settings_add_address'"
                class="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-50 dark:bg-white/5 hover:bg-indigo-100 dark:hover:bg-white/10 text-indigo-600 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer shadow-sm dark:shadow-none"
            >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar relative z-10">
            
            <div v-if="!savedAddresses || savedAddresses.length === 0" class="flex flex-col items-center justify-center h-full gap-4 px-8 text-center -mt-10 transition-colors duration-300">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all"></div>
                    <div class="relative w-20 h-20 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-slate-300 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                    </div>
                </div>

                <div class="space-y-1">
                    <h3 class="text-base font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.addresses.savedAddresses.empty_title') }}</h3>
                    <p class="text-xs text-slate-500 dark:text-zinc-500 leading-relaxed transition-colors duration-300">{{ $t('settings.addresses.savedAddresses.empty_desc') }}</p>
                </div>
            </div>

            <div v-else class="flex flex-col gap-3 p-4 pb-20">
                <button 
                    v-for="(savedAddress, index) in savedAddresses" 
                    :key="index"
                    @click="editAddress(savedAddress, index)"
                    class="group w-full bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/30 rounded-2xl p-3.5 flex items-center justify-between transition-all duration-300 shadow-sm dark:shadow-none cursor-pointer"
                >
                    <div class="flex items-center gap-3 overflow-hidden">
                        <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border border-slate-200 dark:border-white/10 flex items-center justify-center text-sm font-bold text-indigo-600 dark:text-indigo-400 shrink-0 shadow-inner transition-colors duration-300">
                            {{ savedAddress.label.charAt(0).toUpperCase() }}
                        </div>

                        <div class="flex flex-col items-start min-w-0">
                            <span class="text-sm font-bold text-slate-900 dark:text-white truncate w-full text-start group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">{{ savedAddress.label }}</span>
                            <span class="text-[10px] font-mono text-slate-500 dark:text-zinc-500 truncate w-full text-start transition-colors duration-300">{{ shortenAddress(savedAddress.address) }}</span>
                        </div>
                    </div>

                    <div class="w-8 h-8 flex items-center justify-center rounded-full bg-transparent group-hover:bg-indigo-50 dark:group-hover:bg-white/5 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-600 dark:group-hover:text-white transition-all duration-300 shrink-0">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </div>
                </button>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white/90 dark:bg-[#09090b] relative z-20 transition-colors duration-300">
            <button 
                @click="page.currentPage = 'settings_add_address'"
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-slate-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white hover:scale-[1.01] transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                {{ $t('settings.addresses.savedAddresses.btn_add') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { shortenAddress } from '../../../utils/shortenAddress'
import Back from '../../Back.vue'

const emits = defineEmits(['editAddress'])
const page = pageStore()

const savedAddresses = ref(null)

// Kaydin KENDISI ile birlikte DIZI INDISI de yayinlanir (inceleme, Bulgu A).
// Duzenleme ekrani depoyu yeniden okuyup kaydi BULMAK zorunda ve o arama TEK
// BASINA GUVENILIR bir anahtar bulamiyor: `label` benzersiz degil (ayni kisi
// icin biri EVM biri Solana iki kayit -- Task 16b bunu YAYGIN hale getirdi) ve
// `address` de benzersiz DEGIL (AddAddress.vue yinelenen kontrolu YAPMADAN
// push eder, yani ayni adres "Ev" ve "Is" diye IKI KEZ kaydedilebilir).
// Listedeki KONUM ise tanim geregi TEKTIR ve zaten burada, elimizin altinda.
const editAddress = (address, index) => {
    emits('editAddress', address, index)
    page.currentPage = 'settings_edit_address'
}

onMounted(async() => {
    const { saved_addresses } = await chrome.storage.local.get('saved_addresses')
    savedAddresses.value = saved_addresses
})
</script>