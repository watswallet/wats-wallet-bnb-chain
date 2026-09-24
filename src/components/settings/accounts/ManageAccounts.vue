<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />

            <span></span>

            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.account.manageAccounts.title') }}</h1>
            
            <button 
                @click="page.currentPage = 'settings_add_wallet'"
                class="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer shadow-sm dark:shadow-none"
            >
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-4 flex flex-col gap-3 relative z-10">
            <button 
                v-for="(account, index) in accounts" 
                :key="index"
                @click="selectAccount(account)"
                class="group relative w-full flex items-center justify-between p-3 rounded-2xl border transition-all duration-300 cursor-pointer"
                :class="isActive(account) 
                    ? 'bg-white dark:bg-[#131315] border-indigo-400 dark:border-indigo-500/50 shadow-md dark:shadow-[0_0_15px_rgba(99,102,241,0.1)]' 
                    : 'bg-white dark:bg-[#131315] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:bg-slate-50 dark:hover:bg-[#18181b] shadow-sm dark:shadow-none'"
            >
                <div class="flex items-center gap-3">
                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${account?.address}`" class="rounded-full w-9 h-9 shadow-sm dark:shadow-none" />

                    <div class="flex flex-col items-start">
                        <p class="text-sm font-bold transition-colors duration-300" :class="isActive(account) ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white'">{{ account.name }}</p>
                        <div class="flex items-center gap-1.5">
                            <span class="text-[10px] text-slate-500 dark:text-zinc-500 font-mono transition-colors duration-300">{{ account.address ? shorten(account.address) : $t('settings.account.manageAccounts.localAccount') }}</span>
                            <span v-if="badgeOf(account)" class="text-[9px] font-bold leading-none px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-zinc-400 transition-colors duration-300">{{ badgeOf(account) }}</span>
                            <span v-if="isActive(account)" class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        </div>
                    </div>
                </div>

                <svg class="w-5 h-5 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400 transition-all group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white/90 dark:bg-[#09090b] relative z-20 transition-colors duration-300">
            <button 
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-slate-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white hover:scale-[1.01] transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                @click="page.currentPage = 'settings_add_wallet'"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                {{ $t('settings.account.manageAccounts.confirm') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { pageStore } from '../../../store/pageStore'
import Back from '../../Back.vue'
const emit = defineEmits(['selected'])
const page = pageStore()

const accounts = ref([])
const activeAccount = ref(null)

onMounted(async() => {
    // Tüm hesapları ve aktif hesabı çek
    const { vaults, active_account } = await chrome.storage.local.get(['vaults', 'active_account'])
    activeAccount.value = active_account

    if (vaults) {
        for (const vault of vaults) {
            for (const acc of vault.accounts) {
                // Adres bilgisini simüle ediyoruz, gerçek yapıda vault içinde address varsa onu kullanın
                accounts.value.push({
                    ...acc,
                    // Eğer account objesinde adres yoksa, vault'tan veya türetme yolundan gelebilir
                    // Örnek: address: acc.address || '0x...' 
                })
            }
        }
    }
})

const selectAccount = async (acc) => {
    // Sadece seçim yapıldığında aktif hesabı güncellemek istiyorsanız:
    // await chrome.storage.local.set({ active_account: acc })
    // activeAccount.value = acc
    
    emit('selected', acc)
}

// ADLA DEGIL KEY ILE. Hesap adlari kullanici tarafindan serbestce degistirilebilir
// ve varsayilanlari CAKISIR (iki kasanin ilk hesabi da "Wats 1"). Ad karsilastirmasi
// o durumda IKI satiri birden aktif gosteriyordu. `key` kasa-icinde benzersizdir;
// deriveAccount.js:findVaultForAccount de ayni sebeple ONCE onu deniyor.
//
// `!!activeAccount.value?.key` kapisi ZORUNLU: yarim bir kayitta iki taraf da
// `undefined` olur ve `undefined === undefined` HER satiri aktif isaretlerdi.
const isActive = (acc) => {
    return !!activeAccount.value?.key && activeAccount.value.key === acc?.key
}

// Zincir rozeti. Rozet HESABIN TURUNDEN okunur, adres biciminden ya da addan DEGIL:
// "TON 1" yeniden adlandirilabilir, yani zincir ipucu sayilmaz. Metinler cevrilmez --
// Header.vue:632'deki ROW_BADGE ile ayni karar: bunlar zincir adlari, ceviri degil.
//
// Bilinmeyen `type` icin `undefined` -> `|| null` doner ve rozet HIC cizilmez:
// uydurulmus bir rozet, adresin kendisinden daha az bilgi tasiyan bir yalan
// olurdu. Kumeye gecince (accountKind.js) `accountHasTon`/`accountHasEvm`
// KULLANILAMAZ: ikisi de `type:'hd'` ve `type:'ton'` icin birlikte `true`
// donebiliyor, oysa burada TEK bir rozet secilmesi gerekiyor -- dogrudan tip
// eslemesi tek dogru kaynak.
const ACCOUNT_BADGE = { ton: 'TON', hd: 'EVM', imported: 'EVM', privateKey: 'EVM' }
const badgeOf = (acc) => ACCOUNT_BADGE[acc?.type] || null

const shorten = (addr) => {
    if(!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}
</script>