<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md z-10 transition-colors duration-300 shrink-0">
            <Back page="settings_dapps" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white cursor-pointer" />
            <span class="w-8"></span>
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('header.manage_permissions') || 'Manage Permissions' }}</h1>
            <div class="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 dark:text-zinc-600 transition-colors duration-300">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar relative z-10">
            <div class="p-5 space-y-5">
                <div class="flex items-center gap-4 border-b border-dashed border-slate-200 dark:border-white/5 pb-5">
                    <div class="relative w-12 h-12 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center shadow-md dark:shadow-xl transition-colors duration-300 shrink-0">
                        <img 
                            :src="dappInfo?.favicon" 
                            @error="$event.target.src = 'https://api.dicebear.com/7.x/initials/svg?seed=' + (dapp || 'D')"
                            alt="dapp icon" 
                            class="w-8 h-8 object-contain rounded-xl"
                        >
                    </div>
                    <div class="flex-1 min-w-0 flex flex-col items-start gap-0">
                        <h2 class="text-sm font-bold text-slate-900 dark:text-white tracking-tight truncate w-full">{{ dapp }}</h2>
                        <p class="text-[10px] text-slate-500 dark:text-zinc-500 font-mono mt-0.5 truncate w-full text-start">{{ getHostname(dapp) }}</p>
                    </div>
                </div>

                <!-- ── ACCOUNTS SECTION ── -->
                <div>
                    <div class="flex items-center gap-2 mb-3">
                        <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        <h4 class="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">{{ $t('header.account_permissions') || 'Account Permissions' }}</h4>
                    </div>
                    <div class="space-y-2">
                        <label 
                            v-for="acc in accounts" 
                            :key="acc.key"
                            class="flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 cursor-pointer"
                            :class="isAccountShared(acc.address) 
                                ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20' 
                                : 'border-slate-100 dark:border-white/5 hover:border-slate-200 dark:hover:border-white/10'"
                        >
                            <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${acc.address}`" class="w-8 h-8 rounded-full shrink-0" />
                            <div class="flex-1 min-w-0 text-start">
                                <p class="text-xs font-semibold text-slate-700 dark:text-zinc-200 truncate">{{ acc.name }}</p>
                                <p class="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">{{ shortenAddress(acc.address) }}</p>
                            </div>
                            <div class="relative">
                                <input 
                                    type="checkbox" 
                                    :checked="isAccountShared(acc.address)" 
                                    @change="toggleAccountPermission(acc.address)"
                                    class="sr-only peer"
                                />
                                <div class="w-9 h-5 rounded-full transition-colors duration-200 peer-checked:bg-emerald-500 bg-slate-200 dark:bg-zinc-700 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:after:translate-x-4"></div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- ── NETWORKS SECTION ── -->
                <div>
                    <div class="flex items-center gap-2 mb-3">
                        <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <h4 class="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">{{ $t('header.network_permissions') || 'Network Permissions' }}</h4>
                    </div>
                    <div class="space-y-2">
                        <label 
                            v-for="chain in popularChains" 
                            :key="chain.chainId"
                            class="flex items-center gap-3 p-3 rounded-xl border transition-all duration-200"
                            :class="[
                                isChainAllowed(chain.chainId) 
                                    ? 'border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-950/20' 
                                    : 'border-slate-100 dark:border-white/5 hover:border-slate-200 dark:hover:border-white/10',
                                isCurrentNetwork(chain.chainId) ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                            ]"
                        >
                            <img v-if="chain.logoURI" :src="chain.logoURI" class="w-7 h-7 rounded-full shrink-0" @error="e => e.target.style.display='none'" />
                            <div v-else class="w-7 h-7 rounded-full bg-slate-200 dark:bg-zinc-700 shrink-0"></div>
                            <div class="flex-1 min-w-0 text-start">
                                <div class="flex items-center gap-1.5">
                                    <p class="text-xs font-semibold text-slate-700 dark:text-zinc-200 truncate">{{ chain.name }}</p>
                                    <span v-if="isCurrentNetwork(chain.chainId)" class="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">{{ $t('header.active') || 'Active' }}</span>
                                </div>
                                <p class="text-[10px] text-slate-400 dark:text-zinc-500">ID: {{ chain.chainId }}</p>
                            </div>
                            <div class="relative">
                                <input 
                                    type="checkbox" 
                                    :checked="isChainAllowed(chain.chainId)" 
                                    @change="toggleChainPermission(chain.chainId)"
                                    :disabled="isCurrentNetwork(chain.chainId)"
                                    class="sr-only peer"
                                />
                                <div class="w-9 h-5 rounded-full transition-colors duration-200 peer-checked:bg-indigo-500 bg-slate-200 dark:bg-zinc-700 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:after:translate-x-4"></div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- ── GASLESS SECTION ── -->
                <div>
                    <div class="flex items-center gap-2 mb-3">
                        <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        <h4 class="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">{{ $t('settings.dapps.gas_section') }}</h4>
                    </div>
                    <label class="flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 cursor-pointer"
                        :class="editableGasless ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-slate-100 dark:border-white/5'">
                        <div class="flex-1 min-w-0 text-start">
                            <p class="text-xs font-semibold text-slate-700 dark:text-zinc-200">{{ $t('settings.dapps.gasless') }}</p>
                        </div>
                        <div class="relative">
                            <input type="checkbox" :checked="editableGasless" @change="editableGasless = !editableGasless" class="sr-only peer" />
                            <div class="w-9 h-5 rounded-full transition-colors duration-200 peer-checked:bg-emerald-500 bg-slate-200 dark:bg-zinc-700 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 peer-checked:after:translate-x-4"></div>
                        </div>
                    </label>
                </div>

                 <button
                    @click="disconnectDapp"
                    class="w-full py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 text-sm bg-rose-50 dark:bg-rose-500/5 text-rose-500 hover:bg-rose-100 hover:dark:bg-rose-500/10 transition-colors cursor-pointer mt-4"
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    <span>{{ $t('header.disconnect') || 'Disconnect' }}</span>
                </button>
            </div>
        </div>

        <!-- Modal Footer -->
        <div class="px-5 py-4 border-t border-slate-100 dark:border-white/5 bg-white dark:bg-[#09090b] relative z-20 shrink-0">
            <button 
                @click="savePermissions"
                class="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors duration-200 cursor-pointer shadow-lg shadow-indigo-500/20"
            >
                {{ $t('header.save_changes') || 'Save Changes' }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import Back from '../Back.vue'
import { pageStore } from '../../store/pageStore'
import { networkStore } from '../../store/network'
import { LISTED_CHAINS as supportedChains } from '../../data/chains'
import { accountHasEvm } from '../../utils/accountKind'
import { isEvmDappAddress } from '../../utils/dappFunctions'

const page = pageStore()
const network = networkStore()
const props = defineProps(['dapp'])
const dappInfo = ref(null)

const accounts = ref([])
const popularChains = supportedChains

// Permission state
const editableAccounts = ref([])
const editableChains = ref([])
const editableGasless = ref(false) // dapp basina gasless (token ile gas) opt-in

const shortenAddress = (addr) => {
    if (!addr) return ''
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const getHostname = (url) => {
    if(!url) return ''
    try {
        const fullUrl = url.startsWith('http') ? url : `https://${url}`
        return new URL(fullUrl).hostname
    } catch (e) {
        return url.split('://')[1] || url
    }
}

onMounted(async() => {
    const dAppName = props.dapp || page.data
    const { dapps = {}, vaults = [] } = await chrome.storage.local.get(['dapps', 'vaults'])
    
    // Load accounts -- SADECE EVM hesaplari (§8 R4c).
    //
    // Bu ekran Header.vue'nun izin modalindan BAGIMSIZ IKINCI bir yazicidir
    // (asagidaki savePermissions ayni `dapps[host].accounts` anahtarina
    // yaziyor). Header'i kapatip burayi acik birakmak, deligi Ayarlar
    // yolundan tamamen ACIK tutardi.
    //
    // Suzgec DOGRUDAN push'ta: Header'dan farkli olarak buradaki `accounts`
    // ref'ini baska hicbir sey tuketmiyor (tek okuyucu :39'daki v-for).
    //
    // DUZELTME (2026-09-10, inceleme turu 2): bir onceki tur burada dogrudan
    // `acc?.type === 'ton'` kontrolu vardi -- accountKind.js'teki bir spec
    // olcum hatasina dayaniyordu. Olculdu: yanlisti. `type:'ton'` artik
    // hicbir akis URETMIYOR, kalan kayitlarin GERCEKTEN EVM'i yok
    // (accountKindsOf duzeltildi). `accountHasEvm` dogru soruyu soruyor VE
    // fail-closed'i dogrudan tip kontrolunden DAHA IYI koruyor: bilinmeyen
    // turde `false` doner, yani `!accountHasEvm` `true` -- listeye GIRMEZ.
    // Dogrudan tip kontrolu bilinmeyen tipi yanlislikla listeye SOKARDI.
    for (const vault of vaults) {
        for (const acc of vault.accounts) {
            if (!accountHasEvm(acc)) continue
            accounts.value.push(acc)
        }
    }

    if(dapps[dAppName]) {
        dappInfo.value = dapps[dAppName]
        editableAccounts.value = [...(dapps[dAppName].accounts || [])]
        const defaultChains = popularChains.map(c => c.chainId)
        editableChains.value = [...(dapps[dAppName].allowedChains || defaultChains)]
        editableGasless.value = !!dapps[dAppName].gasless
    }
})

// Permissions logic
function isAccountShared(address) {
    return editableAccounts.value.some(a => a.toLowerCase() === address.toLowerCase())
}

function isChainAllowed(chainId) {
    return editableChains.value.includes(chainId)
}

function toggleAccountPermission(address) {
    const idx = editableAccounts.value.findIndex(a => a.toLowerCase() === address.toLowerCase())
    if (idx >= 0) {
        if (editableAccounts.value.length <= 1) return
        editableAccounts.value.splice(idx, 1)
    } else {
        editableAccounts.value.push(address)
    }
}

function toggleChainPermission(chainId) {
    if (isCurrentNetwork(chainId)) return
    
    const idx = editableChains.value.indexOf(chainId)
    if (idx >= 0) {
        if (editableChains.value.length <= 1) return
        editableChains.value.splice(idx, 1)
    } else {
        editableChains.value.push(chainId)
    }
}

function isCurrentNetwork(chainId) {
    const currentChainId = network.currentNetwork?.chainId
    if (!currentChainId) return false
    const numericCurrent = typeof currentChainId === 'string' && currentChainId.startsWith('0x')
        ? parseInt(currentChainId, 16)
        : Number(currentChainId)
    return Number(chainId) === numericCurrent
}

async function savePermissions() {
    const dAppName = props.dapp || page.data
    const { dapps = {} } = await chrome.storage.local.get('dapps')
    
    if (dapps[dAppName]) {
        // 0x SUZGECI: editableAccounts DISKTEN yukleniyor (:193) ve onceden
        // yazilmis bir `UQ...` kaydi tasiyor olabilir -- yukaridaki liste
        // filtresi ona dokunmaz, bu satir dokunur. Suzgec dappFunctions.js'ten
        // ice aktarilir (FIX 5) - Header.vue ve dappFunctions.js'in kendisiyle
        // AYNI tek kaynak.
        dapps[dAppName].accounts = editableAccounts.value.filter(isEvmDappAddress)
        dapps[dAppName].allowedChains = [...editableChains.value]
        dapps[dAppName].gasless = editableGasless.value
        await chrome.storage.local.set({ dapps })
        
        page.currentPage = 'settings_dapps'
    }
}

const disconnectDapp = async () => {
    const dAppName = props.dapp || page.data
    const { dapps = {} } = await chrome.storage.local.get('dapps')
    if(dapps[dAppName]) {
        delete dapps[dAppName]
        await chrome.storage.local.set({ dapps })
        
        chrome.runtime.sendMessage({ type: 'DISCONNECT_DAPP', hostname: dAppName })
        page.currentPage = 'settings_dapps'
    }
}
</script>
