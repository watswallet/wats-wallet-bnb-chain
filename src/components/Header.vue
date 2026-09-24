<template>
    <header class="flex h-16 items-center justify-between px-5 py-4 bg-transparent backdrop-blur-sm transition-colors duration-300 border-b border-transparent dark:border-transparent z-40">
        
        <div class="flex min-w-0 items-center gap-2.5 p-1.5 pr-3 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:border-slate-200 dark:hover:border-white/5 transition-all duration-300 group">
            <button
                @click="show = true"
                class="shrink-0 cursor-pointer rounded-full overflow-hidden hover:opacity-80 transition-opacity"
            >
                <!-- Solana'da SEED headerAddress (solanaAddress) olmali: activeAccount.address
                     her zaman EVM adresidir ve kimlik gorseli aktif hesabin GERCEKTEN
                     kullandigi zincirle eslesmez. Cozum bekleniyorsa/basarisizsa
                     activeAccount?.address'e DUSER -- salt kozmetik bir simge, bos
                     kalmasindan iyidir. -->
                <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${headerAddress || activeAccount?.address}`" class="w-6 shadow-sm dark:shadow-none" />
            </button>
            
            <div
                class="flex flex-col items-start relative min-w-0"
                @mouseenter="showWalletDropdown = true"
                @mouseleave="showWalletDropdown = false"
                @focusin="showWalletDropdown = true"
                @focusout="showWalletDropdown = false"
            >
                <button type="button" class="flex flex-col items-start cursor-pointer" @click="showWalletDropdown = true">
                    <span class="truncate max-w-28 text-xs font-bold text-slate-700 dark:text-zinc-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">@{{ profile?.username }}</span>
                    <span class="truncate max-w-28 text-[10px] text-slate-500 dark:text-zinc-500 font-medium group-hover:text-slate-600 dark:group-hover:text-zinc-400 transition-colors duration-300">
                        {{ activeAccount?.name || $t('header.default_account') }}
                    </span>
                </button>

                <Transition
                    enter-active-class="transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    leave-active-class="transition-all duration-200 ease-in"
                    enter-from-class="opacity-0 scale-[0.97] translate-y-2"
                    enter-to-class="opacity-100 scale-100 translate-y-0"
                    leave-from-class="opacity-100 scale-100 translate-y-0"
                    leave-to-class="opacity-0 scale-95 translate-y-1"
                >
                    <div v-show="showWalletDropdown" class="absolute top-full -left-11 pt-2 z-50 cursor-default w-max">
                        <div class="bg-white/90 dark:bg-[#131315]/90 backdrop-blur-xl border border-slate-200/50 dark:border-white/10 rounded-xl shadow-lg p-1">
                            <!-- Kullanicinin BIRDEN COK adresi var (EVM + TON; Solana aktifken
                                 ayrica Solana) ve hepsi HER ZAMAN gecerlidir - biri "aktif"
                                 digeri "yok" degil. Burasi eskiden tek satirdi ve icerigini
                                 aktif aga gore degistiriyordu: TON adresini kopyalamak icin
                                 once TON agina gecmek gerekiyordu. Artik hepsi ALT ALTA durur,
                                 aktif olan yalnizca VURGULANIR.

                                 Her satir KENDI rozetini ve logolarini tasir. Iki adres yan yanayken
                                 tek bir ortak etiket, tek adres gosteren ekrandan DAHA tehlikelidir:
                                 dogru adres de ekranda oldugu icin kullanici "kontrol ettim" hissiyle
                                 yanlis zincirden gonderir ve varlik KALICI OLARAK KAYBOLUR.
                                 (Ayni sinif bulgu: Receive.vue ve useDisplayAddress.js)

                                 BIRLESTIRME NOTU -- SOLANA SATIRI: Solana dali burada tek satiri
                                 aktif VM'e gore degistiriyordu (Solana'da rozet "Solana", adres
                                 solanaAddress). O karar KORUNDU ama TON dalinin coklu-satir
                                 bicimine tasindi: yanlis etiketli adres yasagi degismedi, yalnizca
                                 artik satirlar birbirini gizlemiyor. Solana satiri YALNIZCA Solana
                                 aktifken cikar -- EVM/TON adreslerinin aksine cuzdan acilisinda
                                 hazir DEGILDIR (arka uca SOLANA_GET_ADDRESS ile sorulur) ve
                                 hicbir zaman gelmeyebilir (kasa kilitli). Hazir olmayan bir adresi
                                 kalici bir satir olarak listelemek, kullaniciyi olmayan bir sey
                                 icin bekletir. -->
                            <div class="flex flex-col gap-0.5">
                                <button
                                    v-for="row in addressRows"
                                    :key="row.kind"
                                    @click="copyRow(row)"
                                    :disabled="!row.address"
                                    class="flex items-center gap-2 px-3 py-2 rounded-lg transition-all group/copy"
                                    :class="[
                                        row.address ? 'cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5' : 'opacity-50 cursor-default',
                                        row.active ? 'bg-indigo-50/70 dark:bg-indigo-500/10' : ''
                                    ]"
                                >
                                    <!-- SABIT GENISLIK BURADA, logo kumesinde DEGIL
                                         (2026-09-12). Olcu logo kumesine konulunca
                                         satirlar hizalaniyordu ama TON/Solana satirinda
                                         TEK logo 46px'lik kutunun solunda kaliyor ve
                                         adiyla arasinda 30px bosluk aciliyordu. Olcu
                                         blogun TAMAMINDA olunca logo ile ad YAN YANA
                                         durur, artan bosluk saga -- ayirica cizgiye --
                                         gider ve adres sutunu yine hizali kalir.
                                         w-24 = 96px; en genis icerik EVM satiri
                                         (46px logo + 8px bosluk + etiket) ~76px. -->
                                    <div class="flex items-center gap-2 border-r border-slate-200 dark:border-zinc-800 pr-2 mr-1 w-24 shrink-0">
                                        <div class="flex items-center -space-x-1.5 shrink-0">
                                            <img v-if="row.kind === 'ton'" :src="tonChain?.logoURI" class="w-4 h-4 rounded-full border-[1.5px] border-white dark:border-[#131315] bg-slate-100 dark:bg-zinc-800" :title="tonChain?.name" />
                                            <img v-else-if="row.kind === 'solana'" :src="solanaChainLogo" class="w-4 h-4 rounded-full border-[1.5px] border-white dark:border-[#131315] bg-slate-100 dark:bg-zinc-800" :title="row.badge" />
                                            <template v-else>
                                                <img v-for="chain in popularChains.slice(0, 4)" :key="chain.chainId" :src="chain.logoURI" class="w-4 h-4 rounded-full border-[1.5px] border-white dark:border-[#131315] bg-slate-100 dark:bg-zinc-800" :title="chain.name" />
                                            </template>
                                        </div>
                                        <span
                                            class="text-[9px] font-bold uppercase tracking-widest shrink-0 whitespace-nowrap"
                                            :class="row.active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-zinc-400'"
                                        >{{ row.badge }}</span>
                                    </div>
                                    <span class="flex-1 text-left text-[11px] text-slate-600 dark:text-zinc-300 font-mono tracking-wide">{{ row.address ? shortenAddress(row.address) : row.pending }}</span>
                                    <div class="shrink-0 text-slate-400 dark:text-zinc-500 group-hover/copy:text-indigo-500 transition-colors">
                                        <svg v-if="copiedKind !== row.kind" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                        <svg v-else class="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </Transition>
            </div>
        </div>

        <!-- Dapp Mode: read-only network badge -->
        <template v-if="dappMode">
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 shadow-sm dark:shadow-none">
                <img v-if="dappNetworkLogo" :src="dappNetworkLogo" class="w-4 h-4 rounded-full" @error="e => e.target.style.display='none'" />
                <div v-else class="w-2 h-2 rounded-full bg-amber-500"></div>
                <span class="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {{ dappNetworkName || network.currentNetwork?.name }}
                </span>
            </div>
        </template>

        <!-- Normal Mode: yakit pill'i + interactive connection status -->
        <template v-else>
          <div class="flex items-center gap-1.5">
            <!-- GLOBAL AG ANAHTARI ARTIK BURADA DEGIL. Buradaki <ChangeNetwork all-vms />
                 chip'i, Home.vue'deki kapsam pill'i ile BIRLESTIRILDI
                 (NetworkScopePill, `switches-network`).
                 NEDEN: ana ekranda gorsel olarak neredeyse ayni IKI acilir menu
                 yan yana duruyordu -- bu chip aktif agi (imzalama/gonderim/dapp)
                 degistiriyor, hemen altindaki pill ise yalnizca listeyi
                 filtreliyordu. Kullanici hangisinin ne yaptigini ayirt edemedigini
                 bildirdi; iki menu tek kontrole indirildi.
                 EVM DISI ERISIM KORUNDU (bu chip'in var olma sebebi buydu):
                 birlesik pill listesini LISTED_CHAINS'ten alir, yani Solana da TON
                 da ORADA vardir ve o aglar AKTIFKEN de gorunur -- geri donus yolu
                 kapanmaz.
                 Dapp modundaki (v-if="dappMode") rozet SALT OKUNUR kalir: orada
                 aktif zinciri dapp belirler, Header hicbir ag anahtari render
                 ETMEZ.
                 BU CHIP AYNI ZAMANDA ANA EKRANIN TEK SUREKLI AG GOSTERGESIYDI
                 (network.currentNetwork?.name'i kosulsuz basiyordu). O gorev de
                 pill'e TASINDI: `switchesNetwork` acikken pill, kapsam etiketinin
                 yaninda AKTIF AGI da (yesil nokta + logo + ad) MENU ACILMADAN
                 gosterir. Bu satir olmadan ana ekran, imzalamanin hangi zincirde
                 yapilacagini hicbir yerde SOYLEMEZ hale gelir. -->

            <!-- ATS YAKITI + DAPP BAGLANTISI: GORUNURLUK KAPISI -- BIRLESTIRME KARARI.
                 Iki dal bu iki pill icin ZIT kararlar verdi ve ikisi de KORUNDU,
                 cunku her biri KENDI zinciri hakkinda:

                 - TON dali (2026-08-27, kullanici karari, kullaniciya sinirlari
                   anlatildiktan sonra YINELENDI): TON aginda GOSTER. Kullanici EVM
                   hesabiyla TON'a bakarken de ATS yakitina ve dapp baglantisina
                   erisebilmek istiyor. Sinirlar bilinerek kabul edildi: AtsFuelPill
                   BSC'yi hesabin adresiyle sorgular, o adres `UQ...` olunca istek bos
                   doner (useAtsFuel kendi catch'inde yutar) -- pill cikar, yakit
                   gostermez; dapp baglantisi da EIP-1193'tur ve TON adresinin orada
                   karsiligi yoktur.
                 - Solana dali (Task 15): Solana aktifken GIZLE. Gaz-token kavraminin
                   kendisi EVM'e ozel; ayrica Solana icin ayri bir dapp-provider yolu
                   YOK ve `loadConnectionState` Solana'nin METIN chainId'sini
                   Number()'a sokup NaN uretiyordu (bkz. Header.ssr.test.js).

                 Kapi bu yuzden "EVM mi" DEGIL "Solana mi" diye soruyor:
                 features.ats/features.dapp (evmOnlyFeatures) TON'u da kapatirdi ve
                 kullanicinin kararini geri alirdi.

                 AG KOSULU IKI ELEMANIN KENDI UZERINDE DEGIL, ONLARI SARAN template'te
                 (`<template v-if="headerPills">`) -- dapp kabi (connectionDropdownRef)
                 hala KENDI uzerinde hicbir kosul TASIMAZ. ATS pill'i ARTIK KENDI
                 uzerinde bir kosul tasiyor (2026-09-05 tasarim belgesi, gorev 6) ama
                 bu bir AG kapisi DEGIL, bir HESAP kapisi: `activeAccount?.type !== 'ton'`.
                 EVM anahtari OLMAYAN bir hesapta (eski/legacy TON hesabi) BSC sorgusu
                 firlar ve useAtsFuel onu yutar; pill sonsuza kadar "—" gosterirdi. Bu
                 bir bicim tercihi degil: tonFlowWiring.test.js ("baslik pill'leri ag
                 kapisi TASIMAZ, ATS pill'i HESAP kapisi tasir") dapp kabinin KENDI
                 uzerinde hala hicbir AG kosulu olmamasini VE ATS pill'inin
                 `isTon`/`currentNetwork`/`features.*` gibi bir AG kosuluyla degil
                 yalniz hesap turuyle kosullandigini kilitliyor -- cunku bu depoda ayni
                 pill'ler uc kez
                 "TON'da gorunmemeli" sezgisiyle elle gizlendi. O kilit TON AG kapisina
                 karsidir; buradaki HESAP kosulu TON'u DEGIL EVM-anahtarsiz hesabi
                 disliyor, yani kilitlenen davranis (TON AGINDA gorunurluk) aynen
                 yururlukte.
                 (Ayni sebeple bu yorumda dapp kabi etiketinin metni AYNEN yazilmaz:
                 test dosyayi METIN olarak tariyor ve ilk eslesmeyi kullaniyor.)

                 GORUNURLUK ile KORUMA ayri katmanlar ve KORUMALAR YERINDE DURUYOR:
                 dappFunctions.js TON hesabini bagli-dapp hizli yolunda sunmaz,
                 hesap degisiminde ACCOUNT_CHANGED `null` adres yayinlar (asagida) ve
                 background eth_requestAccounts/eth_sendTransaction/eth_chainId
                 girisinde requireEvmChain ile korur. Pill'i gostermek o kapilari
                 acmaz. -->
            <template v-if="headerPills">
            <AtsFuelPill v-if="activeAccount?.type !== 'ton'" :address="activeAccount?.address" />

            <div class="relative flex items-center gap-2" ref="connectionDropdownRef">

                <!-- Dapp Connection Button -->
                <button
                    v-if="currentTabHostname"
                    @click="toggleConnectionDropdown"
                    class="flex items-center gap-0.5 px-1 py-1 rounded-full border transition-all duration-300 cursor-pointer shadow-sm dark:shadow-none"
                    :class="isConnected
                        ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60 hover:border-emerald-300 dark:hover:border-emerald-700'
                        : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20 hover:bg-slate-50 dark:hover:bg-white/10'"
                    :title="`${currentTabHostname} — ${isConnected ? $t('header.connected') : $t('header.not_connected')}`"
                >
                    <div class="relative flex items-center justify-center shrink-0 w-5 h-5 rounded-full overflow-hidden bg-white bg-opacity-80 dark:bg-zinc-800">
                        <img v-if="connectedDappInfo?.favicon" :src="connectedDappInfo.favicon" class="w-full h-full object-cover" @error="e => e.target.style.display='none'" />
                        <svg v-else class="w-3.5 h-3.5" :class="isConnected ? 'text-emerald-500' : 'text-slate-400 dark:text-zinc-500'" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                        <div class="absolute -bottom-0.5 -right-0.5 border-[1.5px] border-white dark:border-[#09090b] w-2.5 h-2.5 rounded-full z-20" :class="isConnected ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-zinc-500'"></div>
                    </div>
                    <svg class="w-3.5 h-3.5 transition-transform duration-200 text-slate-400 dark:text-zinc-500 ml-0.5" :class="[showConnectionDropdown ? 'rotate-180' : '']" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                </button>

                <!-- Connection Dropdown -->
                <Transition
                    enter-active-class="transition-all duration-200 ease-out"
                    leave-active-class="transition-all duration-150 ease-in"
                    enter-from-class="opacity-0 scale-95 -translate-y-1"
                    enter-to-class="opacity-100 scale-100 translate-y-0"
                    leave-from-class="opacity-100 scale-100 translate-y-0"
                    leave-to-class="opacity-0 scale-95 -translate-y-1"
                >
                    <div 
                        v-if="showConnectionDropdown" 
                        class="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl z-50 overflow-hidden"
                    >
                        <!-- Connection Status Header -->
                        <div class="p-3 border-b border-slate-100 dark:border-white/5">
                            <h3 class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider mb-2 px-1">{{ $t('header.website') }}</h3>
                            <div class="flex items-center gap-3 px-1 pb-1">
                                <div class="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                                    <img v-if="connectedDappInfo?.favicon" :src="connectedDappInfo.favicon" class="w-5 h-5 rounded-full" @error="e => e.target.style.display='none'" />
                                    <svg v-else class="w-4 h-4 text-slate-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                                </div>
                                <div class="flex-1 min-w-0 flex justify-between items-center group/dapp">
                                    <div class="flex flex-col min-w-0">
                                        <p class="text-xs font-semibold text-slate-800 dark:text-zinc-200 truncate">
                                            {{ currentTabHostname || $t('header.unknown') }}
                                        </p>
                                        <div class="flex items-center gap-1.5 mt-0.5">
                                            <div class="min-w-1.5 h-1.5 rounded-full" :class="isConnected ? 'bg-emerald-500' : 'bg-red-400'"></div>
                                            <span class="text-[10px] font-medium" :class="isConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">
                                                {{ isConnected ? $t('header.connected') : $t('header.not_connected') }}
                                            </span>
                                        </div>
                                    </div>
                                    <div v-if="isConnected" class="flex items-center gap-1.5 pl-2 opacity-100 sm:opacity-0 sm:group-hover/dapp:opacity-100 transition-opacity duration-200">
                                        <!-- IZIN EKRANI EVM'E OZEL: `accounts`/`allowedChains`
                                             EIP-1193 kavramlari ve savePermissions yalnizca
                                             `dapps` kaydina yazar. Yalnizca TON/Solana ile bagli
                                             bir sitede bu dugmeyi gostermek, hicbir seye
                                             dokunmayan bir ayar ekrani acardi. Kesme dugmesi ise
                                             UC oturum icin de calisir, o yuzden `isConnected`te
                                             kalir. -->
                                        <button 
                                            v-if="evmConnected"
                                            @click="showConnectionDropdown = false; showPermissions = true"
                                            class="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all cursor-pointer"
                                            :title="$t('header.manage_permissions')"
                                        >
                                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                        </button>
                                        <button 
                                            @click="disconnectDapp"
                                            class="p-1.5 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-all cursor-pointer"
                                            :title="$t('header.disconnect')"
                                        >
                                            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Transition>
            </div>
            </template>
          </div>
        </template>
    </header>

    <Transition
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-200 ease-in"
        enter-from-class="opacity-0 -translate-y-2 max-h-0"
        enter-to-class="opacity-100 translate-y-0 max-h-16"
        leave-from-class="opacity-100 translate-y-0 max-h-16"
        leave-to-class="opacity-0 -translate-y-2 max-h-0"
    >
        <div v-if="!dappMode && isConnected && dappNetworkActivated" class="mx-3 mt-2 flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 overflow-hidden">
            <div class="shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                <svg class="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 leading-tight">{{ $t('header.network_activated') }}</p>
                <p class="text-[9px] text-indigo-500/80 dark:text-indigo-400/70 leading-tight mt-0.5">{{ $t('header.network_activated_desc', { network: network.currentNetwork?.name, host: currentTabHostname }) }}</p>
            </div>
        </div>
    </Transition>

    <Transition
        enter-active-class="transition-opacity duration-300 ease-out"
        leave-active-class="transition-opacity duration-200 ease-in"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
    >
        <div 
            v-if="showPermissions" 
            class="fixed inset-0 z-100 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm" 
            @click="showPermissions = false"
        >
            <Transition
                enter-active-class="transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1)"
                leave-active-class="transition-all duration-200 ease-in"
                enter-from-class="opacity-0 translate-y-4 scale-95"
                enter-to-class="opacity-100 translate-y-0 scale-100"
                leave-from-class="opacity-100 translate-y-0 scale-100"
                leave-to-class="opacity-0 translate-y-4 scale-95"
            >
                <div 
                    v-if="showPermissions"
                    class="absolute inset-x-3 top-12 bottom-12 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                    @click.stop
                >
                    <!-- Modal Header -->
                    <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/5 shrink-0">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                <svg class="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                            </div>
                            <div>
                                <h3 class="text-sm font-bold text-slate-800 dark:text-white">{{ $t('header.permission_management') }}</h3>
                                <p class="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">{{ currentTabHostname }}</p>
                            </div>
                        </div>
                        <button @click="showPermissions = false" class="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all cursor-pointer">
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    <!-- Modal Content (scrollable) -->
                    <div class="flex-1 overflow-y-auto p-5 space-y-5">
                        <!-- ── ACCOUNTS SECTION ── -->
                        <div>
                            <div class="flex items-center gap-2 mb-3">
                                <svg class="w-4 h-4 text-slate-500 dark:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                <h4 class="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">{{ $t('header.account_permissions') }}</h4>
                            </div>
                            <div class="space-y-2">
                                <label
                                    v-for="acc in dappEvmAccounts"
                                    :key="acc.key"
                                    class="flex items-center gap-3 p-3 rounded-xl border transition-all duration-200 cursor-pointer"
                                    :class="isAccountShared(acc.address) 
                                        ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20' 
                                        : 'border-slate-100 dark:border-white/5 hover:border-slate-200 dark:hover:border-white/10'"
                                >
                                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${acc.address}`" class="w-8 h-8 rounded-full shrink-0" />
                                    <div class="flex-1 min-w-0">
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
                                <h4 class="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">{{ $t('header.network_permissions') }}</h4>
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
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-1.5">
                                            <p class="text-xs font-semibold text-slate-700 dark:text-zinc-200 truncate">{{ chain.name }}</p>
                                            <span v-if="isCurrentNetwork(chain.chainId)" class="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-full shrink-0">{{ $t('header.active') }}</span>
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
                    </div>

                    <!-- Modal Footer -->
                    <div class="px-5 py-4 border-t border-slate-100 dark:border-white/5 shrink-0">
                        <button 
                            @click="savePermissions"
                            class="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors duration-200 cursor-pointer shadow-lg shadow-indigo-500/20"
                        >
                            {{ $t('header.save_changes') }}
                        </button>
                    </div>
                </div>
            </Transition>
        </div>
    </Transition>

    <!-- ============ ACCOUNTS SIDEBAR (yandan kayan drawer) ============ -->
    <!-- Tek katman, class-driven: scrim opacity ile, panel translate-x ile kayar.
         Ic ice <Transition> yerine bu desen acilis+kapanisi garantiler. -->
    <div
        class="fixed inset-0 z-100"
        :class="show ? '' : 'pointer-events-none'"
    >
        <!-- Scrim: opacity ile yumusak gel/git -->
        <div
            class="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-300"
            :class="show ? 'opacity-100' : 'opacity-0'"
            @click="show = false"
        ></div>

        <!-- Panel: soldan kayar (translate-x) -->
        <div
            class="absolute top-0 left-0 h-full w-20 bg-white dark:bg-[#09090b] border-r border-slate-200 dark:border-white/10 shadow-2xl flex flex-col justify-between py-6 overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform"
            :class="show ? 'translate-x-0' : '-translate-x-full'"
            @click.stop
        >
                    <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

                    <div class="flex flex-col items-center gap-6 w-full relative">
                        <button 
                            @click="show = false"
                            class="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 dark:text-zinc-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-300 cursor-pointer"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="m10 18l-6-6l6-6l1.4 1.45L7.85 11H20v2H7.85l3.55 3.55z"/></svg>
                        </button>

                    <div class="flex flex-col gap-s w-full items-center overflow-y-auto custom-scrollbar px-2 max-h-87.5">
                        <div 
                            v-for="group in groupedAccounts" 
                            :key="group.fingerprint"
                            class="flex flex-col items-center w-full rounded-2xl transition-all duration-300 py-1.5 relative group/vault"
                            :class="hoveredGroup === group.fingerprint ? 'bg-slate-100 dark:bg-zinc-800/80' : 'bg-transparent'"
                            @mouseenter="hoveredGroup = group.fingerprint"
                            @mouseleave="hoveredGroup = null"
                        >
                            <button 
                                v-for="account in group.accounts" 
                                :key="account.key"
                                class="relative flex flex-col items-center gap-1.5 transition-all cursor-pointer py-1.5 w-full group/account"
                                @click="changeAccount(account)"
                            >
                                <div 
                                    class="relative flex items-center justify-center transition-all duration-300"
                                    :class="account.key === activeAccount?.key ? 'scale-100 opacity-100' : 'scale-90 opacity-50 group-hover/account:scale-100 group-hover/account:opacity-100'"
                                >
                                    <div 
                                        class="rounded-full transition-all duration-300 flex items-center justify-center"
                                        :class="account.key === activeAccount?.key 
                                            ? 'p-0.75 bg-indigo-500/10 dark:bg-indigo-400/10 border border-indigo-500/30 dark:border-indigo-400/30' 
                                            : 'p-0 border border-transparent'"
                                    >
                                        <img 
                                            :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${account.address}`" 
                                            class="rounded-full w-9 h-9 object-cover bg-white dark:bg-black" 
                                        />
                                    </div>
                                    
                                    <div 
                                        v-if="account.key === activeAccount?.key" 
                                        class="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 ring-2 ring-white dark:ring-[#09090b] rounded-full z-20"
                                    ></div>
                                </div>
                                
                                <span
                                    v-if="accountBadge(account)"
                                    class="relative z-10 mt-0.5 px-1 py-px rounded text-[8px] font-bold leading-none bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300"
                                >{{ accountBadge(account) }}</span>
                                <span
                                    class="relative z-10 text-[9px] truncate w-14 text-center transition-all duration-300 mt-0.5"
                                    :class="account.key === activeAccount?.key
                                        ? 'text-slate-800 dark:text-white font-bold'
                                        : 'text-slate-400 dark:text-zinc-500 font-medium group-hover/account:text-slate-600 dark:group-hover/account:text-zinc-400'"
                                >
                                    {{ account.name }}
                                </span>
                            </button>
                            
                            <div 
                                v-if="group.accounts.length > 1"
                                class="absolute top-8 bottom-8 left-1/2 -translate-x-1/2 w-0.5 bg-slate-200/50 dark:bg-white/5 pointer-events-none transition-opacity duration-300"
                                :class="hoveredGroup === group.fingerprint ? 'opacity-100' : 'opacity-0'"
                            ></div>
                        </div>

                    </div>
                    </div>

                    <div class="w-full flex flex-col items-center gap-2 px-3 pt-4 border-t border-slate-200 dark:border-white/5 relative transition-colors duration-300">
                        <button class="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-300 group relative cursor-pointer" @click="page.currentPage = 'settings_add_wallet'" :title="$t('header.add_wallet')">
                            <svg class="w-6 h-6 transition-transform group-hover:scale-110" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M11 13H5v-2h6V5h2v6h6v2h-6v6h-2z"/></svg>
                        </button>

                        <button class="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-300 group cursor-pointer" @click="page.currentPage = 'settings_manage_accounts'" :title="$t('header.manage_accounts')">
                            <svg class="w-5 h-5 transition-transform group-hover:scale-110" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3s1.34 3 3 3m-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5S5 6.34 5 8s1.34 3 3 3m0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5m8 0c-.29 0-.62.02-.97.05c1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5"/></svg>
                        </button>

                        <button class="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-300 group cursor-pointer" @click="page.currentPage = 'settings'" :title="$t('header.settings')">
                            <svg class="w-5 h-5 transition-transform group-hover:rotate-90 duration-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6s3.6 1.62 3.6 3.6s-1.62 3.6-3.6 3.6"/></svg>
                        </button>
                    </div>
                </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../store/pageStore'
import { userStore } from '../store/user'
import { activeTabQuery, initPanelWindowId } from '../utils/panelWindow'
// ChangeNetwork ARTIK BURADA KULLANILMIYOR (bkz. sablondaki aciklama): ag anahtari
// Home.vue'deki NetworkScopePill'e tasindi. Bilesenin KENDISI SILINMEDI -- Swap.vue
// onu kendi kaynak-zincir secicisi olarak (prop'suz, EVM-only liste ile) hala
// kullaniyor ve icindeki networksPopup'i acan TEK yer orasi.
import AtsFuelPill from './AtsFuelPill.vue'
import { shortenAddress } from '../utils/shortenAddress'
import { networkStore } from '../store/network'
import { buildAddressRows } from '../composables/useDisplayAddress'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { isTon, TON_MAINNET_ID } from '../utils/chainKind'
import { accountHasEvm, accountHasTon, accountShowsEvmRow, chainsForAccount } from '../utils/accountKind'
import { isEvmDappAddress } from '../utils/dappFunctions'
import { applyNetworkChange } from '../utils/applyNetworkChange'
// Ag adi cozumlemesi DESTEKLENEN listeden yapilir. Tam EVM kaydindan cozulurse
// cuzdanin desteklemedigi bir zincir de dost adiyla ("Avalanche C-Chain") gorunur ve
// kullanici o agda islem yapabilecegini sanir; desteklenmeyen zincir "Chain <id>"
// olarak kalmali.
import { ALL_CHAINS as chains, LISTED_CHAINS as supportedChains } from '../data/chains'
import { evmOnlyFeatures } from '../utils/evmGates'
// Derleme zamani bayragi. Kardes bilesen (settings/Dapps.vue) ayni kapiyi ayni
// gerekceyle tasiyor: bayrak kapaliyken arka plan Solana aksiyonlarini TUMDEN
// reddeder, dolayisiyla bir Solana oturumunu ARAYUZDE "bagli" gostermek
// kullaniciya calismayan bir kesme dugmesi vaat etmek olur.
import { SOLANA_ENABLED } from '../utils/featureFlags'
import { chainVm } from '../utils/vm'
import { SOLANA_CHAIN_ID } from '../utils/solana/constants'

const props = defineProps({
    dappMode: { type: Boolean, default: false }
})

const page = pageStore()
const user = userStore()
const network = networkStore()
// Sablon `$t` kullaniyor ama script'te `t` yoktu; applyNetworkChange uyari
// metnini cevirmek icin ona ihtiyac duyuyor.
const { t } = useI18n()

// EVM'e ozel ozelliklerin tek kaynagi (bkz. utils/evmGates.js). Basliktaki iki
// pill ARTIK dogrudan buna bagli DEGIL (asagidaki `headerPills`); `features` yine
// de burada duruyor cunku `loadConnectionState` icindeki dapp yazma kapisi onu
// okuyor ve testler bayraklari buradan olcuyor.
const features = computed(() => evmOnlyFeatures(network.currentNetwork))
const vm = computed(() => chainVm(network.currentNetwork))

// BASLIK PILL'LERININ (ATS yakiti + dapp baglantisi) GORUNURLUGU -- birlestirme
// karari; gerekcesi sablonda, pill'lerin hemen ustunde uzun uzun yazili.
//
// Kisaca: kapi "EVM mi" DEGIL "Solana mi" diye sorar. TON dalinda kullanici
// (2026-08-27) bu pill'lerin TON'da GORUNMESINI acikca istedi; Solana dalinda
// (Task 15) Solana'da GIZLENMELERI kararlastirildi. Ikisi ayri zincirler hakkinda
// oldugu icin ikisi de yururlukte. `features.ats`/`features.dapp` kullanilsaydi
// TON da kapanir ve kullanicinin karari sessizce geri alinirdi.
const headerPills = computed(() => vm.value !== 'solana')

// Dapp mode: network info from current_request
const dappNetworkName = ref('')
const dappNetworkLogo = ref('')
const dappNetworkRestricted = ref(false)
const dappNetworkActivated = ref(false)

const show = ref(false)
const profile = ref(null)
const accounts = ref([])
// AKTIF HESAP DEPODA DURUR (store/user.js), bilesenin YEREL ref'inde DEGIL.
//
// Kapatilan hata: bu bir `ref(null)` idi ve yalnizca `onMounted`ta bir kez
// doluyordu. Panel N pencerede acik olabilir ve her biri AYRI bir Vue
// ornegidir: A panelinde hesap degistirildiginde paneller arasi kopru
// (utils/uiSync.js) B panelinde SADECE `user.address`i guncelliyordu -- Home
// YENI hesabin bakiyelerini gosterirken baslik ONCEKI hesabin adinda ve
// avatarinda kaliyordu. Bir cuzdanda, harcanan hesaptan BASKA bir hesabi
// adlandiran bir baslik gercek bir yanlis okuma riskidir.
//
// YAZILABILIR computed: mevcut `activeAccount.value = ...` cagri yerleri
// (onMounted, changeAccount) AYNEN calisir, ama artik tek bir kaynaga yazar.
const activeAccount = computed({
    get: () => user.activeAccount,
    set: (acc) => { user.activeAccount = acc },
})
const copiedKind = ref(null)
const hoveredGroup = ref(null)
const tonAddress = ref(null)

// Kopyalama listesinin ISKELETI: EVM + TON. TON satiri 0x adresine ASLA dusmez;
// adres hazir degilse null kalir, satir "hazirlaniyor" gosterir ve kopyalama
// kapanir (buildAddressRows, useDisplayAddress.js).
//
// Solana satiri BURADA DEGIL, asagidaki `addressRows`ta ekleniyor: useDisplayAddress.js
// yalnizca EVM ve TON'u biliyor ve o dosya TON dalinin sozlesmesi -- kendi testleri
// (useDisplayAddress.rows.test.js) donen satirlarin sayisini ve sirasini kilitliyor.
const baseAddressRows = computed(() => buildAddressRows({
    chain: network.currentNetwork,
    // TON'a kilitli (eski/legacy `type:'ton'`) hesapta `account.address` ZATEN TON
    // adresidir (spec §5: oraya bir EVM adresi konsaydi o adresin ozel anahtari
    // ed25519 tohumunun kendisi olurdu). EVM satirina verilirse AYNI UQ... dizesi
    // listede iki kez cikar ve biri "EVM" etiketini tasir - useDisplayAddress.js'in
    // pazarlik disi ilk kurali tam bunu yasakliyor: yanlis etiketli bir satir, tek
    // adres gosteren ekrandan DAHA tehlikelidir. Adres yoksa satir "hazirlaniyor"
    // gosterir.
    //
    // Tekil aileden kumeye gecince (accountKind.js, 2026-09-10) `accountHasEvm`
    // `type:'ton'` icin de `true` donmeye basladi -- o fonksiyon artik BURADA
    // KULLANILAMAZ, cunku bu satirin sorusu "hesap EVM ailesini destekler mi"
    // DEGIL, "`.address` alani GERCEKTEN bir EVM adresi mi" (eski `type:'ton'`
    // kayitlarda degil). Dogrudan tip kontrolu bu ayrimi koruyan tek yol -- eskiden
    // bu ayrimi tasiyan yardimci sembol de tam olarak bu kontrolden ibaretti.
    //
    // `null` gecmek TEK BASINA yetmiyordu: o deger "adres henuz turetilmedi" ile ayni
    // ve satir sonsuza kadar "Hazirlaniyor…" yaziyordu. Bu hesapta EVM adresi hic
    // OLMAYACAK, o yuzden satirin kendisi kalkiyor (evmSupported).
    // Receive.vue ile AYNI fonksiyon (2026-09-11): iki ekran ayni hesap icin
    // ayri cevaplar veriyordu. Davranis burada DEGISMIYOR -- `type:'ton'` yine
    // gizli, `type`siz eski kayit yine GORUNUR -- yalnizca tek kaynaga baglandi.
    evmSupported: accountShowsEvmRow(activeAccount.value),
    evmAddress: accountShowsEvmRow(activeAccount.value) ? activeAccount.value?.address : null,
    tonAddress: tonAddress.value,
    // TON satiri KANIT ister (spec §5, buildAddressRows'un fail-closed varsayilani):
    // `activeAccount` acilista bir an `null`dir ve o anda `accountHasTon(null)` false
    // doner - satir cizilmez. Hesap TON'u KANITLADIGINDA (type:'ton') satir gorunur.
    tonSupported: accountHasTon(activeAccount.value),
}))

// TON satirinin rozet logosu. Aktif ag TON olmayabilir - satir yine gosterildigi
// icin logo aktif agdan DEGIL, sabit TON kaydindan okunur.
const tonChain = computed(() => chains.find(c => Number(c.chainId) === TON_MAINNET_ID))

// ATS yakit pill'i ve dapp baglanti pill'i TON AGINDA GORUNUR (kullanici karari,
// 2026-08-27), YALNIZCA Solana'da gizlenir (Task 15) -- AG kapisi yukaridaki
// `headerPills`; gerekcesi sablonda pill'lerin ustunde.
//
// ATS pill'i AYRICA (2026-09-05 tasarim belgesi, gorev 6) EVM anahtari OLMAYAN
// bir HESAPTA (eski/legacy `type:'ton'` hesap) hesap turu kontroluyle gizlenir
// -- bu bir AG kapisi degil, HESAP kapisi: kullanici EVM hesabiyla TON agina
// bakarken pill YINE gorunur, gizlenen yalniz BSC'de imzalayacak anahtari
// olmayan hesap.
//
// `accountHasEvm` KULLANILAMAZ (2026-09-10 Gorev 4): kumeye gecince
// (accountKind.js) o fonksiyon `type:'hd'` icin de `true` doner ve pill HER
// EVM hesabinda gorunurdu -- zaten oyle olmasi gerekiyordu, ama `type:'ton'`
// icin de `true` dondugunden pill o hesapta da GORUNURDU, tam da bu blogun
// gizlemek istedigi nufus. Dogrudan tip kontrolu bu ayrimi koruyan tek yol.
//
// Bir donem burada `isTonNetwork` ve `canDapp` vardi. Silindiler cunku artik
// okuyan kimse yok; okunmayan bir hesaplanan deger, ileride birinin "demek ki bu
// kapi var" diye guvenecegi OLU bir kapidir. `headerPills` onlarin yerine GECMEZ:
// o kapi TON'u DEGIL Solana'yi disliyor.

// Aktif hesabin gosterilecek adresi. `activeAccount.address` HER ZAMAN EVM
// adresidir; Solana'da bu, kullanicinin kontrol ETMEDIGI bir adres olabilir --
// oraya kopyalanan bir adres Solana'da baska bir cuzdana ait olabilir.
// `null` = HENUZ cozulmedi ya da cozum basarisiz (Home.vue/Send.vue/Receive.vue
// ile AYNI ilke): bu durumda '...' gosterilir, EVM adresine SESSIZCE DUSULMEZ.
const solanaAddress = ref(null)
const headerAddress = computed(() => (vm.value === 'solana' ? solanaAddress.value : activeAccount.value?.address))
const solanaChainLogo = computed(() => chains.find(c => c.chainId === SOLANA_CHAIN_ID)?.logoURI || null)

// Satir rozetleri. Rozet SATIRIN turunden okunur, aktif agdan DEGIL: iki (ya da uc)
// adres alt alta dururken yanlis etiketli TEK bir satir, tek adres gosteren
// ekrandan daha tehlikelidir (useDisplayAddress.js'in birinci kurali).
const ROW_BADGE = { evm: 'EVM', ton: 'TON', solana: 'Solana' }

// HESAP DEGISTIRICI CIPI (drawer, :450-486). Adres satirlarindaki ROW_BADGE'in
// aksine burada YALNIZCA TON isaretlenir: liste ezici cogunlukla EVM hesaplarindan
// olusur ve her satira "EVM" basmak gurultudur; ayirt edilmesi gereken azinliktir.
//
// Kaynak hesabin TIPI, hesap ADI DEGIL: "TON 1" yeniden adlandirilabilir ve o
// anda cip yanlis satirda kalirdi. `accountHasTon` kullanilamaz: kumeye gecince
// (accountKind.js) `type:'hd'` icin de `true` doner ve EVERY EVM hesabinda TON
// cipi cikardi -- burada sorulan soru "bu hesap TON'u DESTEKLER mi" degil, "bu
// hesap eski/legacy `type:'ton'` cizgisinde mi" (yeniden adlandirilamayan tek
// ayirt edici).
const SWITCHER_BADGE = { ton: 'TON' }
const accountBadge = (acc) => (acc?.type === 'ton' ? SWITCHER_BADGE.ton : null)

// EKRANA BASILAN satirlar.
//
// EVM + TON iskeleti buildAddressRows'tan gelir; Solana satiri BURADA eklenir ve
// YALNIZCA Solana aktifken. Diger ikisinin aksine Solana adresi cuzdan acilir
// acilmaz elde DEGILDIR: hesapta hazir yoksa arka uca sorulur (SOLANA_GET_ADDRESS)
// ve kasa kilitliyken HIC cozulmez. Hicbir zaman dolmayacak bir satiri kalici
// olarak listelemek kullaniciyi olmayan bir sey icin bekletirdi.
//
// AYNI SEBEPLE bekleme metni de ayrilir: EVM/TON satirlari "Hazirlaniyor…" der
// (gercekten birazdan gelir), Solana satiri '...' -- gelmeyebilecegi icin bir soz
// vermez.
//
// Solana aktifken EVM/TON satirlarinin `active` vurgusu KALDIRILIR: buildAddressRows
// yalnizca iki VM biliyor ve "TON degilse EVM aktiftir" varsayar, yani Solana'da
// EVM satirini yanlislikla aktif isaretlerdi.
const addressRows = computed(() => {
    const solanaActive = vm.value === 'solana'
    const rows = baseAddressRows.value.map((row) => ({
        ...row,
        badge: ROW_BADGE[row.kind],
        pending: t('header.address_preparing'),
        active: solanaActive ? false : row.active,
    }))
    if (!solanaActive) return rows
    return [...rows, {
        kind: 'solana',
        badge: ROW_BADGE.solana,
        address: headerAddress.value,
        active: true,
        pending: '...',
    }]
})

// Home.vue/Send.vue/SelectAssets.vue/Receive.vue ile AYNI sira: once hesaptaki
// hazir alan, yoksa arka uca (SOLANA_GET_ADDRESS) sorulur.
const resolveHeaderSolanaAddress = async (account) => {
    try {
        const address = account?.solanaAddress
            || (await chrome.runtime.sendMessage({ type: 'SOLANA_GET_ADDRESS' }))?.result?.address
        solanaAddress.value = address || null
    } catch (e) {
        console.error('Solana adresi cozulemedi (Header):', e.message)
        solanaAddress.value = null
    }
}

// Connection status
const showConnectionDropdown = ref(false)
const showWalletDropdown = ref(false)
const showPermissions = ref(false)
const connectionDropdownRef = ref(null)
const currentTabHostname = ref('')
// SOLANA OTURUMLARI TAM ORIGIN ile anahtarlanir (K5), hostname ile DEGIL:
// `https://x.com` ile `http://x.com` ve o host'un her portu ayni yetkiyi
// paylasirdi. Bu yuzden sekmeden IKI deger birden cozulur.
const currentTabOrigin = ref('')
const connectedDapps = ref({})
// TON ve Solana oturumlari EVM'den AYRI depolarda durur (`ton_dapps`,
// `solana_dapps`) -- birlestirilmis TEK bir kayit yazmak, uc protokolun
// birbirinden bagimsiz olan yetki modellerini tek bir sekle zorlardi.
// Baslik bu yuzden ucunu de AYRI okur ve yalnizca GORUNTUDE birlestirir.
const connectedTonDapps = ref({})
const connectedSolanaDapps = ref({})
const connectedDappInfo = ref(null)

// Permission editing state
const editableAccounts = ref([])
const editableChains = ref([])

// Networks for permission UI
const popularChains = supportedChains

/**
 * EVM (EIP-1193) oturumu. AYRI TUTULUR cunku bu ekranin izin yuzeyi TAMAMEN
 * EVM'e ozeldir: `accounts` / `allowedChains` EIP-1193 kavramlari ve
 * `savePermissions` yalnizca `dapps` kaydina yazar. Yalnizca TON ile bagli bir
 * sitede o dugmeyi gostermek, hicbir seye dokunmayan bir ayar ekrani acardi.
 */
const evmConnected = computed(() => {
    if (!currentTabHostname.value) return false
    return !!connectedDapps.value[currentTabHostname.value]
})

const tonConnected = computed(() => {
    if (!currentTabHostname.value) return false
    return !!connectedTonDapps.value[currentTabHostname.value]
})

// ORIGIN ile, hostname ile DEGIL (yukaridaki `currentTabOrigin` notu).
//
// BAYRAK KAPISI EN BASTA. `SOLANA_ENABLED` kapaliyken (yayin derlemesinin
// varsayilani, client/.env.production) diskte eskiden kalma bir `solana_dapps`
// kaydi HALA durabilir -- bayrak Solana'yi main'den AYIRDIGINDA kayitlar
// silinmedi. Bu kaydi "bagli" saymak kullaniciya YESIL bir rozet ve calismayan
// bir "Baglantiyi Kes" dugmesi gosterirdi: background.js'in
// `if (!SOLANA_ENABLED && isSolanaAction(action))` kapisi DISCONNECT_SOLANA_DAPP'i
// reddeder ve HICBIR SEY olmaz. Kardes bilesen (settings/Dapps.vue) ayni kapiyi
// ayni gerekceyle tasiyor.
//
// `disconnectDapp` kararlarini bu computed'den turettigi icin mesaj da
// kendiliginden susar -- ikinci bir kapi GEREKMEZ.
const solanaConnected = computed(() => {
    if (!SOLANA_ENABLED) return false
    if (!currentTabOrigin.value) return false
    return !!connectedSolanaDapps.value[currentTabOrigin.value]
})

/**
 * "Bu site cuzdana bagli mi" -- UC PROTOKOLUN BIRLESIMI.
 *
 * KOK NEDEN: bu kosul yalnizca EVM `dapps` kaydini okuyordu. Kullanici bir TON
 * dapp'ine BASARIYLA baglandiginda (oturum `ton_dapps`e yazilir) baslik ayni
 * site icin "Bagli Degil" diyordu -- dapp sayfasi "Connected" derken. Ayni
 * oturum Ayarlar > Dapp'ler ekraninda DOGRU listeleniyordu: iki yuzey celiskili
 * konusuyordu ve kullanici bunu "baglanamadim" diye okuyup tekrar tekrar
 * deniyordu. Kesme dugmesi de bu kosulun arkasinda oldugu icin o oturum
 * basliktan YONETILEMIYORDU.
 */
const isConnected = computed(() => evmConnected.value || tonConnected.value || solanaConnected.value)

// Dapp izin modalinin listesi: SADECE EVM hesaplari (§8 R4).
//
// Suzgec BURADA, `accounts` ref'inin KENDISINDE DEGIL: ayni diziyi asagidaki
// groupedAccounts -> hesap DEGISTIRICI de tuketiyor ve orada TON hesabinin
// GORUNMESI GEREKIYOR. Kaynagi suzmek, kullanicinin kendi TON cuzdanina bir
// daha gecememesi demekti.
//
// accountHasEvm FAIL-CLOSED (bilinmeyen tur -> false): kalici bir izin kaydina
// yazacak bir listede, EVM oldugunu KANITLAYAMAYAN hesap gosterilmez.
const dappEvmAccounts = computed(() => accounts.value.filter(accountHasEvm))

const groupedAccounts = computed(() => {
    if (!accounts.value) return []
    
    const groups = new Map()
    
    accounts.value.forEach(acc => {
        const groupId = acc.fingerprint || acc.key 
        
        if (!groups.has(groupId)) {
            groups.set(groupId, {
                fingerprint: groupId,
                accounts: []
            })
        }
        groups.get(groupId).accounts.push(acc)
    })
    
    return Array.from(groups.values())
})

function isAccountShared(address) {
    return editableAccounts.value.some(a => a.toLowerCase() === address.toLowerCase())
}

function isChainAllowed(chainId) {
    return editableChains.value.includes(chainId)
}

function toggleAccountPermission(address) {
    const idx = editableAccounts.value.findIndex(a => a.toLowerCase() === address.toLowerCase())
    if (idx >= 0) {
        // Don't allow removing the last account
        if (editableAccounts.value.length <= 1) return
        editableAccounts.value.splice(idx, 1)
    } else {
        editableAccounts.value.push(address)
    }
}

function toggleChainPermission(chainId) {
    // Don't allow deactivating the current network
    if (isCurrentNetwork(chainId)) return
    
    const idx = editableChains.value.indexOf(chainId)
    if (idx >= 0) {
        // Don't allow removing the last chain
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
    // KAPI `evmConnected`, `isConnected` DEGIL. `isConnected` bu turda UC
    // protokolu kapsayacak sekilde genisledi; bu govde ise YALNIZCA EVM `dapps`
    // kaydina yazar. Eski kosulla birakilsaydi yalnizca TON ile bagli bir sitede
    // de govdeye girilirdi ve o durumu kurtaran tek sey asagidaki
    // `if (dapps[hostname])` satiri olurdu -- yani kaza.
    if (!currentTabHostname.value || !evmConnected.value) return
    
    const { dapps = {} } = await chrome.storage.local.get('dapps')
    const hostname = currentTabHostname.value
    
    if (dapps[hostname]) {
        // 0x SUZGECI: liste suzulmus olsa bile editableAccounts DISKTEN
        // yukleniyor (:819) ve eski bir `UQ...` kaydi tasiyor olabilirdi --
        // yukaridaki filtre ona hic dokunmaz, bu satir dokunur. Suzgec
        // dappFunctions.js'ten ice aktarilir (FIX 5) - uc bagimsiz kopyanin
        // (burada, DappPermissions.vue'de, dappFunctions.js'in kendisinde)
        // birbirinden sessizce sapmasi riski TEK kaynaga indirgenir.
        dapps[hostname].accounts = editableAccounts.value.filter(isEvmDappAddress)
        dapps[hostname].allowedChains = [...editableChains.value]
        await chrome.storage.local.set({ dapps })
        connectedDapps.value = { ...dapps }
    }
    
    showPermissions.value = false
}

/**
 * "Baglantiyi kes" -- SITENIN SAHIP OLDUGU HER OTURUMU keser.
 *
 * UC AYRI DEPO, UC AYRI MESAJ. Eski govde yalnizca `dapps` kaydini siliyordu;
 * TON ile bagli bir sitede kullanici "kes"e basar, HICBIR SEY olmaz ve kart
 * "Bagli" kalirdi.
 *
 * HER MESAJ YALNIZCA O OTURUM VARSA gonderilir. Kosulsuz gondermek arka planda
 * gereksiz bir oku-degistir-yaz turu baslatir ve TAM O SIRADA onay ekranindan
 * gelen bir oturum yazimini EZEBILIR -- klasik kayip-guncelleme yarisi (ayni
 * gerekce: tonDappFunctions.js'teki `disconnect` dali).
 *
 * TON/Solana kayitlarini BURADA DISKTEN SILMEYIZ: arka plandaki isleyiciler
 * (DISCONNECT_TON_DAPP / DISCONNECT_SOLANA_DAPP) kendi depolarindan zaten
 * siliyor VE dapp'e olay yayinliyor. Ikinci bir yazici, ayni yarisin oteki
 * ucunu acardi. Yerel ref'ler yalnizca EKRANI guncellemek icin bosaltilir.
 * (EVM dali eskiden beri kaydi kendisi siliyor -- DISCONNECT_DAPP isleyicisi
 * `dapps`a dokunmuyor; o davranis AYNEN korundu.)
 */
async function disconnectDapp() {
    if (!currentTabHostname.value) return
    const hostname = currentTabHostname.value
    const origin = currentTabOrigin.value

    // KARARLAR ILK `await`TEN ONCE DONDURULUR.
    //
    // Asagidaki EVM dali IKI await yapar. Tam o sirada `chrome.tabs.onActivated`
    // ya da ag degisimi izleyicisi `loadConnectionState()`i kosturur ve
    // `currentTabHostname` / `currentTabOrigin` / uc oturum haritasinin HEPSINI
    // yeniden yazar. Sonraki dallar kararlarini CANLI computed'lerden turetseydi
    // (`tonConnected.value`), await donunce o computed ARTIK BASKA BIR SITEYI
    // anlatiyor olurdu: TON/Solana oturumu SESSIZCE ayakta kalir, kullanici
    // "kestim" sanir ve dapp imza istemeye devam edebilirdi.
    const evmVardi = evmConnected.value
    const tonVardi = tonConnected.value
    const solVardi = solanaConnected.value

    if (evmVardi) {
        const { dapps = {} } = await chrome.storage.local.get('dapps')
        delete dapps[hostname]
        await chrome.storage.local.set({ dapps })
        connectedDapps.value = { ...dapps }
        chrome.runtime.sendMessage({ type: 'DISCONNECT_DAPP', hostname })
    }

    // TON ve SOLANA: kaydi silen TEK yer ARKA PLAN isleyicisidir (ikisi de kendi
    // depolarindan siler VE dapp'e olay yayinlar). Buradan ikinci bir yazici
    // eklemek klasik kayip-guncelleme yarisini acardi.
    //
    // AMA cagiran, isleyicinin BASARIP BASARMADIGINA bakmak ZORUNDA. Bir onceki
    // surum yaniti okumadan yerel ref'i IYIMSER temizliyordu: isleyici hata
    // verirse disk hala bagli, dapp hala bagli sanir, ama ekran "Bagli Degil"
    // derdi -- ve kesme dugmesi `v-if="isConnected"` arkasinda oldugu icin
    // EKRANDAN KAYBOLUP kullaniciyi TEKRAR DENEYEMEZ hale getirirdi.
    //
    // Dogru davranis kardes bilesende zaten yazili (settings/Dapps.vue): yaniti
    // BEKLE, hatayi uyar, ve HER DURUMDA listeyi DISKTEN yeniden oku. Ekranin
    // gosterdigi sey boylece her zaman diskin kendisi olur.
    if (tonVardi) {
        try {
            const yanit = await chrome.runtime.sendMessage({ type: 'DISCONNECT_TON_DAPP', hostname })
            if (yanit?.success === false) console.warn('[header] DISCONNECT_TON_DAPP basarisiz:', yanit)
        } catch (e) {
            console.warn('[header] DISCONNECT_TON_DAPP hata:', e)
        }
        const { ton_dapps: guncelTon = {} } = await chrome.storage.local.get('ton_dapps')
        connectedTonDapps.value = guncelTon
    }

    if (solVardi) {
        try {
            const yanit = await chrome.runtime.sendMessage({ type: 'DISCONNECT_SOLANA_DAPP', origin })
            if (yanit?.success === false) console.warn('[header] DISCONNECT_SOLANA_DAPP basarisiz:', yanit)
        } catch (e) {
            console.warn('[header] DISCONNECT_SOLANA_DAPP hata:', e)
        }
        const { solana_dapps: guncelSol = {} } = await chrome.storage.local.get('solana_dapps')
        connectedSolanaDapps.value = guncelSol
    }

    if (evmVardi) connectedDappInfo.value = null
    showConnectionDropdown.value = false
}

function toggleConnectionDropdown() {
    showConnectionDropdown.value = !showConnectionDropdown.value
}

// Close dropdown on outside click
function handleOutsideClick(e) {
    if (connectionDropdownRef.value && !connectionDropdownRef.value.contains(e.target)) {
        showConnectionDropdown.value = false
    }
}

async function loadConnectionState() {
    const { dapps = {}, ton_dapps = {}, solana_dapps = {} } = await chrome.storage.local.get(['dapps', 'ton_dapps', 'solana_dapps'])
    connectedDapps.value = dapps
    connectedTonDapps.value = ton_dapps
    connectedSolanaDapps.value = solana_dapps

    // Get current tab hostname
    try {
        // Sorgu PANELIN KENDI penceresine sabitlenir. Tarayicinin son odakli
        // penceresine bakan eski sorgu coklu pencerede BASKA bir pencerenin
        // sekmesini dondurebiliyordu ve hostname yalnizca gosterimde degil
        // YAZMA yolunda da kullaniliyor (disconnectDapp / savePermissions) --
        // yanlis pencere, kullanicinin bakmadigi sitenin baglantisini kesmek
        // demekti.
        const [tab] = await chrome.tabs.query(activeTabQuery())
        if (!tab?.url) {
            // Sekme cozulemedi: hostname'i ESKI degerinde birakma. Mevcut bos
            // catch bunu yutuyordu ve panel, kullanici baska sekmeye gectikten
            // sonra da onceki sitenin kartini gostermeye devam ediyordu.
            currentTabHostname.value = ''
            currentTabOrigin.value = ''
            connectedDappInfo.value = null
            return
        }

        const url = new URL(tab.url)
        currentTabHostname.value = url.hostname
        currentTabOrigin.value = url.origin

        if (dapps[url.hostname]) {
            connectedDappInfo.value = dapps[url.hostname]
            // Init editable permission state
            editableAccounts.value = [...(dapps[url.hostname].accounts || [])]
            const defaultChains = popularChains.map(c => c.chainId)
            editableChains.value = [...(dapps[url.hostname].allowedChains || defaultChains)]

            // Check if current network is not in allowedChains — auto-add it
            //
            // `features.dapp` SART: bu blok Solana aktifken de CALISIRDI (dugme gizli
            // olsa da fonksiyon her ag degisiminde tetiklenir, bkz. asagidaki watch).
            // `Number('solana-mainnet')` NaN'dir ve `allowedChains.push(NaN)` hem depoyu
            // kirletir hem de asagidaki "ag etkinlestirildi" banner'ini Solana icin
            // (anlamsizca) gosterirdi -- EIP-1193 dapp'lerinin bilmesi gereken bir zincir
            // degistirmedi, gostermeye de gerek yok.
            const currentChainId = network.currentNetwork?.chainId
            if (features.value.dapp && currentChainId && dapps[url.hostname].allowedChains) {
                const numericChainId = typeof currentChainId === 'string' && currentChainId.startsWith('0x')
                    ? parseInt(currentChainId, 16)
                    : Number(currentChainId)
                if (!dapps[url.hostname].allowedChains.includes(numericChainId)) {
                    // Auto-activate: add network to allowedChains and save
                    dapps[url.hostname].allowedChains.push(numericChainId)
                    await chrome.storage.local.set({ dapps })
                    connectedDapps.value = { ...dapps }
                    editableChains.value = [...dapps[url.hostname].allowedChains]

                    // Show activation notification briefly
                    dappNetworkActivated.value = true
                    setTimeout(() => { dappNetworkActivated.value = false }, 4000)
                }
            }
        }
    } catch (e) {
        // Sekme erisimi yok (uzanti sayfasi) ya da sorgu reddedildi: kartlari
        // temizle, ESKI degerde birakma.
        currentTabHostname.value = ''
        // ORIGIN DE TEMIZLENIR -- yukaridaki erken cikisla SIMETRIK.
        // `solanaConnected` YALNIZCA origin'e bakar: burada birakilirsa hostname
        // bos ama origin DOLU kalir ve baslik "Unknown -- Bagli" gibi imkansiz bir
        // durum gosterir. Kesme dugmesi de olu olur: disconnectDapp ilk satirinda
        // (`!currentTabHostname.value`) geri doner, yani gorunen dugme hicbir sey
        // yapmaz.
        currentTabOrigin.value = ''
        connectedDappInfo.value = null
    }
}

onMounted(async() => {
    const { active_account, user: userProfile, vaults } = await chrome.storage.local.get(['active_account', 'user', 'vaults'])
    activeAccount.value = active_account
    profile.value = userProfile

    if (vm.value === 'solana') await resolveHeaderSolanaAddress(active_account)

    for (const vault of vaults) {
        for (const acc of vault.accounts) {
            accounts.value.push(acc)
        }
    }

    // In dapp mode, resolve network name from current_request
    if (props.dappMode) {
        try {
            const { current_request, currentNetwork, dapps = {} } = await chrome.storage.local.get(['current_request', 'currentNetwork', 'dapps'])
            const chainId = current_request?.chainId || currentNetwork?.chainId
            if (chainId) {
                const numericChainId = typeof chainId === 'string' && chainId.startsWith('0x') 
                    ? parseInt(chainId, 16) 
                    : Number(chainId)
                const found = chains.find(c => c.chainId === numericChainId)
                if (found) {
                    dappNetworkName.value = found.name
                    dappNetworkLogo.value = found.logoURI || ''
                } else {
                    dappNetworkName.value = currentNetwork?.name || `Chain ${numericChainId}`
                    dappNetworkLogo.value = currentNetwork?.logoURI || ''
                }

            } else {
                dappNetworkName.value = currentNetwork?.name || ''
                dappNetworkLogo.value = currentNetwork?.logoURI || ''
            }
        } catch {
            // fallback to store value
        }
    }

    // Panel kendi pencere kimligini BIR KEZ cozer; asagidaki her tabs.query
    // ona sabitlenir.
    await initPanelWindowId()

    // SEKME DINLEYICILERI BURADA, `initPanelWindowId()`TEN SONRA kaydedilir.
    //
    // Onceden ikinci ve SENKRON bir `onMounted` hook'undaydilar: o hook bu
    // (async) hook daha `initPanelWindowId()`i beklerken kosuyordu. Arada
    // gerceklesen bir sekme aktivasyonu `loadConnectionState`i panel pencere
    // kimligi COZULMEDEN tetikler ve sorgu "en son odaklanan pencere" yedegine
    // duser (bkz. utils/panelWindow.js) -- yani BASKA bir pencerenin sekmesi
    // okunur. O yolun sonunda
    // `loadConnectionState`in otomatik-etkinlestirme dali `dapps[host].allowedChains`e
    // YAZIYOR: yanlis origin icin kalici bir izin kaydi.
    if (chrome.tabs?.onActivated) { chrome.tabs.onActivated.addListener(onTabActivated) }
    if (chrome.tabs?.onUpdated) { chrome.tabs.onUpdated.addListener(onTabUpdated) }

    await loadConnectionState()
    document.addEventListener('click', handleOutsideClick)
})

// Panel sekme degisiminde ACIK KALIR. Bu dinleyiciler olmadan kullanici A
// sitesinden B'ye gectiginde panel hala A'nin baglanti kartini ve
// "Baglantiyi Kes" dugmesini gosteriyordu -- kesme YANLIS origin'e uygulanirdi.
//
// Referanslari degiskende tutmak SART: addListener'a verilen ok fonksiyonu
// saklanmazsa removeListener sessizce hicbir sey yapmaz.
const onTabActivated = () => { loadConnectionState() }
const onTabUpdated = (_tabId, changeInfo) => {
    // Yalniz adres degisiminde: her yukleme asamasinda sorgulamak gereksiz.
    if (changeInfo?.url) loadConnectionState()
}

// IKINCI BIR `onMounted` HOOK'U YOK (bilincli): kayit, yukaridaki async hook'un
// ICINDE `await initPanelWindowId()`ten SONRA yapiliyor. Ayri bir senkron hook,
// pencere kimligi daha cozulmemisken gelen bir sekme olayini islerdi.
// Yetenek kontrolu (`chrome.tabs?.onActivated`) orada da duruyor: eski sahteler
// ve eski Chrome surumleri bu API'leri tanimlamayabilir.

onUnmounted(() => {
    document.removeEventListener('click', handleOutsideClick)
    if (chrome.tabs?.onActivated) { chrome.tabs.onActivated.removeListener(onTabActivated) }
    if (chrome.tabs?.onUpdated) { chrome.tabs.onUpdated.removeListener(onTabUpdated) }
})

// BASKA bir panelde yapilan hesap degisiminin YAN ETKISI.
//
// Ad/avatar/profil zaten yukaridaki `activeAccount` computed'i uzerinden
// DEPODAN gelir; burada kapatilan sey Solana adresidir: `changeAccount` onu
// KENDI panelinde acikca gecersiz kiliyor ("onceki hesabin adresini kopyalamak"
// notu), uzaktan gelen degisimde ise kimse kilmiyordu. TON adresi asagidaki
// `[chainId, activeAccount.value?.key]` izleyicisinde zaten tazeleniyor.
watch(() => user.activeAccount?.key, (yeni, eski) => {
    if (!yeni || yeni === eski) return
    solanaAddress.value = null
    if (vm.value === 'solana') resolveHeaderSolanaAddress(user.activeAccount)
})

// Re-check dapp permissions when network changes
watch(() => network.currentNetwork, () => {
    if (!props.dappMode) {
        loadConnectionState()
    }
    // Ag EVM'den Solana'ya gecince (ayni hesap, ayni oturum -- Header YALNIZCA
    // Home.vue'de render edildigi icin bu geciste bilesen YENIDEN MOUNT OLMAZ)
    // adres HENUZ cozulmemis olabilir. Aksi halde kopyalama dugmesi ag
    // degisiminden SONRA bir sure (ya da kalici olarak) EVM adresini gostermeye
    // devam ederdi.
    if (vm.value === 'solana' && !solanaAddress.value) {
        resolveHeaderSolanaAddress(activeAccount.value)
    }
}, { deep: true })

// Aktif hesap ya da ag degistiginde TON adresini tazele. Onceki hesabin/agin
// TON adresi burada YENI secim icin GECERSIZ olur (tonAddress once null'a
// cekilir); aksi halde kisa bir an icin ONCEKI hesabin TON adresi YENI
// hesabin adresiymis gibi gorunebilir.
watch(() => [network.currentNetwork?.chainId, activeAccount.value?.key], async () => {
    tonAddress.value = null
    // Eskiden burada `!isTon(network.currentNetwork)` kapisi vardi: TON adresi yalnizca
    // TON agindayken turetiliyordu. AG kapisi kalkti (TON adresi EVM aginda da
    // cozulur - satirin GORUNMESI icin degil, TON hesabina gecildiginde onceden
    // hazir olmasi icin), ama satirin EKRANDA gorunmesi ayri bir soru: asagidaki
    // `accountHasTon` kapisi hesap TON'u KANITLAMADIKCA `tonAddress`i `null`de
    // birakir, `baseAddressRows`taki `tonSupported` de ayni kapiyi tekrar sorup
    // satirin KENDISINI hic uretmez (buildAddressRows, useDisplayAddress.js).
    // Iki kapi AYNI soruyu iki farkli katmanda soruyor: biri DEGERI, digeri
    // SATIRIN VARLIGINI kapatiyor.
    if (!activeAccount.value) return
    // HESAP KAPISI. Bu watch `immediate: true` ve AG KOSULU YOK: her hesap
    // degisiminde, hangi agda olursak olalim kosar. Yani hesabin zincir suzgeci
    // onu erisilemez KILMAZ - digerlerinden farki bu.
    //
    // TON cuzdani olmayan hesapta `tonIdentityForAccount` TON_ACCOUNT_REQUIRED
    // firlatir; asagidaki catch onu yutar ama HER hesap degisiminde konsola bir
    // hata yazar. TON adresi olmayan hesap icin dogru deger `null`dir, hata degil.
    if (!accountHasTon(activeAccount.value)) return
    try {
        tonAddress.value = await ensureTonAddress(activeAccount.value, {
            testnet: Boolean(network.currentNetwork?.testnet),
        })
    } catch (e) {
        // Kilitli kasa ya da turetme hatasi: adres BOS kalir, 0x'e DUSULMEZ.
        console.error('TON adresi cozulemedi:', e.message)
    }
}, { immediate: true })

const changeAccount = async(acc) => {
    await chrome.storage.local.set({ active_account: acc })
    activeAccount.value = acc
    show.value = false
    user.address = acc.address

    // Hesap degisince ONCEKI hesabin Solana adresi ARTIK GECERSIZDIR: yeni
    // hesap icin YENIDEN cozulmezse kopyalama dugmesi bir sonraki hesabin
    // adresini gostermeye devam ederdi (baska bir cuzdanin adresini kopyalamak).
    solanaAddress.value = null
    if (vm.value === 'solana') await resolveHeaderSolanaAddress(acc)

    // Bağlı dapp'lere EIP-1193 accountsChanged bildirilir. Bildirilmezse dapp eski
    // hesabı bağlı sanmaya devam eder ve işlemlerini o hesap için hazırlar.
    //
    // TON'a kilitli hesapta BILDIRILEN SEY BAGLANTI KESILMESIDIR, adres degil.
    // `acc.address` orada TON adresidir (spec §5) ve notifyConnectedDapps onu
    // accountsChanged ile EIP-1193 hesabi olarak yayinlar: dapp base64 bir TON
    // dizesini selectedAddress sanir - checksum dogrulayan dapp'ler coker,
    // dogrulamayanlar onu kullanicinin Ethereum hesabi diye gosterir. O hesaptan
    // imza zaten HICBIR ZAMAN uretilemez, yani dogru bildirim "hesap yok"tur.
    // `null` gonderiliyor: arka plandaki ACCOUNT_CHANGED bunu bos diziye cevirir
    // ve DISCONNECT_DAPP ile AYNI sekli (`accountsChanged, []`) yayinlar.
    //
    // dappFunctions.js'teki kapi bunu KAPSAMAZ: o yalnizca zaten bagli olan
    // hizli yolda active_account'un dapp'e SUNULMASINI engelliyor, hesap
    // degisiminde yayinlanan bildirimi degil.
    //
    // FAIL-CLOSED: `accountHasEvm(acc)` DOGRUYSA gecer (tipi bilinmeyen bir
    // hesap da reddedilir). Bu, dapp'e KALICI SEKILDE giden EIP-1193 hesap
    // bildirimidir - branch'teki diger tum kalici disa-cikis noktalari
    // (handleGetAccounts, sendTxDapp, signMessageDapp) ayni yonde kapali;
    // burasi FAIL-OPEN kalsaydi tipi taniinmayan bir hesap ve `0x` ile
    // baslamayan bir adres her bagli dapp'e EIP-1193 hesabi diye yayinlanirdi.
    // Bugun erisilemez (accountKindsOf bilinmeyen tipte null doner ve
    // accountHasEvm de null'da false verir, yani BURADA reddedilir) ama diger
    // butun boru hatlari gibi burada da bir kemer olmali - "0x" suzgeci
    // (isEvmDappAddress) burada YOK cunku
    // `accountHasEvm` zaten adresin degil HESABIN TURUNU kanitliyor.
    const dappAddress = accountHasEvm(acc) ? acc.address : null
    chrome.runtime.sendMessage({ type: 'ACCOUNT_CHANGED', address: dappAddress }).catch(() => {})

    const { vaults } = await chrome.storage.local.get('vaults')
    const vault = vaults.find(v => v.fingerprint === acc.fingerprint)

    user.vault = vault

    // Hesap TON'a kilitliyse (eski/legacy `type:'ton'` kaydi) ve o an EVM
    // agindaysak agi TON'a al.
    //
    // Bu olmadan diger iki kapi YETMEZ: hesap degisiminde ag DEGISMEDIGI icin
    // applyNetworkChange hic calismaz ve kullanici, imzalayacak anahtari olmayan
    // bir agda hicbir sey yapamadigi bir ekranda kalir.
    if (acc?.type === 'ton' && !isTon(network.currentNetwork) && tonChain.value) {
        await applyNetworkChange(tonChain.value, t)
    }

    // AYNA DAL — EVM yonu. Ustteki kapinin eksik yarisi.
    //
    // TON agindayken EVM hesabina gecmek bir AG degisimi degildir: applyNetworkChange
    // hic calismaz ve kullanici, o agda hicbir sey imzalayamayacagi bir hesapla TON'da
    // kalir. accountSupportsChain cift yonlu oldugundan (accountKind.js) bu artik
    // yalnizca bos bir ekran degil, YUKLEMLE CELISEN bir durum: ag secici o zinciri
    // hesabin listesinden dusurmus, ama aktif ag hala o.
    //
    // Hedef SABIT DEGIL, hesabin destekledigi ILK zincir. store/network.js'in acilis
    // uzlastirmasi da ayni ifadeyi kullaniyor; sabit bir zincir yazmak iki yolun ayni
    // hesabi iki farkli aga goturmesi demek olurdu. `chains` = ALL_CHAINS (yukaridaki
    // import), ilk kaydi Ethereum.
    //
    // Ayri bir `if`, `else if` DEGIL: iki dalin kosullari zaten birbirini disliyor
    // (`acc?.type === 'ton'` ile `!accountHasTon(acc)` ayni hesapta birlikte dogru
    // olamaz), ve ayri blok ustteki dalin kosulunu ilerde degistirecek birinin
    // bu dali kazara yakalamasini engelliyor.
    //
    // DUZELTME (2026-09-10, inceleme turu 2, Important 5): bu dal `accountHasEvm(acc)
    // && isTon(...)` idi. accountKind.js kumeye gecince (Gorev 2) `type:'hd'`
    // hesabin da `accountHasEvm` DOGRU donuyor -- ve TUM_AILELER'de oldugu icin
    // TON'u da destekliyor. Yani eski kosul, TON agindayken IKI hd hesap
    // arasinda gecis yapan bir kullaniciyi bile zorla Ethereum'a cekiyordu:
    // "TON hesabinin EVM'i yok" duzeltmesiyle ILGISIZ, ayri bir hata (accountKind.js'in
    // inceleme turu 2'deki `type:'ton'` duzeltmesi bunu KENDILIGINDEN cozmuyor,
    // cunku bu dal hic `type:'ton'`u sormuyordu). Dogru soru "bu hesap TON'u
    // KANITLIYOR mu" -- `!accountHasTon(acc)`, yalniz ice aktarilmis/ozel
    // anahtar hesaplarinda (accountKind.js: YALNIZ_EVM) `true` doner ve YALNIZ
    // onlar TON agindan cikarilmasi gereken GERCEK nufustur.
    //
    // Donus degeri BILINCLI OLARAK okunmuyor — ustteki TON dali da okumuyor: RPC'ye
    // ulasilamamasi gecisi iptal etmez, applyNetworkChange kullaniciyi zaten uyarir.
    const evmFallback = !accountHasTon(acc) && isTon(network.currentNetwork)
        ? chainsForAccount(acc, chains)[0]
        : null
    if (evmFallback) {
        await applyNetworkChange(evmFallback, t)
    }
}

const copyRow = async(row) => {
    if (!row?.address) return
    await navigator.clipboard.writeText(row.address)

    copiedKind.value = row.kind

    setTimeout(() => {
        // Bu arada DIGER satir kopyalandiysa onun geri bildirimini silme: iki satirin
        // zamanlayicilari ic ice binebiliyor ve kosulsuz null yapmak, kullanici henuz
        // "Kopyalandi" yazisini gormeden onu sifirliyordu.
        if (copiedKind.value === row.kind) copiedKind.value = null
    }, 3000)
}

// `handleCopyAddress` / `copy` / `copied` SILINDI (birlestirme): tek satirli
// kopyalama dugmesinin yerini `copyRow` + `copiedKind` aldi. Ikisini birlikte
// tutmak, ayni panoyu iki farkli geri bildirim durumundan yoneten iki yol
// birakirdi; ustelik birlesmis agacta `handleCopyAddress` artik var olmayan bir
// `copy()` cagiriyordu.
</script>