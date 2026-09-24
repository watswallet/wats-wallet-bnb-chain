<template>
  <Transition
    :enter-active-class="'transition-all duration-200 ease-out'"
    :leave-active-class="'transition-all duration-200 ease-in'"
    :enter-from-class="'opacity-0'"
    :enter-to-class="'opacity-100'"
    :leave-from-class="'opacity-100'"
    :leave-to-class="'opacity-0'"
  >
    <Receive v-if="popups.receive"></Receive>
  </Transition>

  <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-y-auto overflow-x-hidden custom-scrollbar selection:bg-indigo-500/30 transition-colors duration-300">
    <Header></Header>
    <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none"></div>

    <!--
      Anahtari eskiden diskte tutulan kullanicilar icin tek seferlik bilgilendirme.
      Satir yerine modal: bu bir kenar notu degil, kullanicinin okumasi gereken bir
      guvenlik degisikligi. Bilesen popups/PasswordRotation.vue.
    -->
    <PasswordRotation
      v-if="showPasswordRotation"
      @change-password="goToChangePassword"
      @dismiss="dismissPasswordRotation"
    />

    <div class="relative flex flex-col items-center pt-6 pb-8 space-y-3">
      <!-- TEK AG KONTROLU. `switches-network` YALNIZCA burada verilir: ana ekranda
           bu pill'in hemen ustunde (Header) gorsel olarak neredeyse ayni ikinci bir
           acilir menu duruyordu ve kullanici hangisinin aktif agi degistirdigini
           ayirt edemiyordu. Artik somut bir zincir secmek hem AKTIF AGI degistirir
           hem kapsami o zincire tasir; "Tum Aglar" ise yalnizca kapsamdir.

           BURAYA BAGLANAN DEGER KAPSAMDIR (scope.filter), AKTIF AG DEGIL -- ve ikisi
           BILEREK ayrisabilir: Gonder/Takas/Kopru/Token Ara ekranlarindaki ayni pill
           `switches-network` GECMEDEN ayni paylasilan store'a yazar. Bu yuzden pill
           `switchesNetwork` acikken aktif agi AYRICA, MENU ACILMADAN gosterir
           (NetworkScopePill'deki yesil nokta + ad): Header'dan kaldirilan chip
           aktif zincirin adini kosulsuz basiyordu ve imzalama/gonderim/dapp hep
           AKTIF agda kosar, kapsamda DEGIL. -->
      <NetworkScopePill switches-network :model-value="scope.filter" @update:model-value="scope.setFilter" />

      <div class="flex flex-col items-center">
        <span class="text-[42px] font-bold text-slate-900 dark:text-white leading-tight tracking-tight flex items-center gap-1 transition-colors duration-300">
          <span class="text-2xl text-slate-400 dark:text-zinc-500">$</span>
          {{ isBalanceVisible ? filteredUsd.toFixed(2) : '****' }}
          
          <button @click="toggleBalanceVisibility" class="ml-2 mt-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors">
            <svg v-if="isBalanceVisible" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
          </button>
        </span>
      </div>

      <div class="flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none backdrop-blur-md transition-all duration-300">
        <span class="flex items-center text-xs font-bold gap-1" :class="filteredPercentageInfo.pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'">
          <svg v-if="isBalanceVisible" class="w-3 h-3" :class="{ 'rotate-x-180': filteredPercentageInfo.pct < 0 }" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          {{ isBalanceVisible ? filteredPercentageInfo.pct.toFixed(2) + '%' : '***' }}
        </span>
        <div class="w-px h-3 bg-slate-200 dark:bg-white/10 transition-colors duration-300"></div>
        <span class="text-slate-500 dark:text-zinc-400 text-xs font-medium transition-colors duration-300">{{ isBalanceVisible ? filteredPercentageInfo.usd.toFixed(2) + '$' : '***' }}</span>
        <span class="text-slate-400 dark:text-zinc-600 text-[10px] uppercase ml-1 transition-colors duration-300">{{ $t('home.timeframe24h') }}</span>
      </div>
    </div>

    <!-- Sutun sayisi GORUNUR dugme sayisindan turer -- sabit `grid-cols-4` DEGIL.
         Iki dal ayni satirda iki AYRI kusur buldu ve ikisi de burada kapali:
           - Solana'da Swap/Kopru gizlenince geriye "iki dugme + iki BOS hucre"
             kaliyordu; bu BOZUK gorunur, "iki dugme" (grid-cols-2) kasitli.
           - "TON ise 2, degilse 4" formulu de yanlisti: TON'da takas acilinca
             3 dugme oldu ve o formul ucunu 2 sutuna sikistirdi.
         Ortak ders: sayi ELLE VARSAYILMAZ. actionGridClass GORUNUR dugmelerden
         turer (Gonder+Al her zaman, digerleri kendi kapilarindan) ve 2/3/4'un
         hepsi haritalanir -- kapilar ileride birbirinden ayrisirsa bu satir
         KENDILIGINDEN dogru kalir. -->
    <div class="grid gap-3 px-6 pb-8" :class="actionGridClass">
      <button class="group flex flex-col items-center gap-2" @click="page.currentPage = 'select_asset'">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-indigo-400 dark:group-hover:border-indigo-500/50 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/10 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:shadow-md transition-all duration-300">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors">{{ $t('home.send') }}</span>
      </button>

      <button v-if="canSwap" class="group flex flex-col items-center gap-2" @click="page.currentPage = 'swap'">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-amber-400 dark:group-hover:border-amber-500/50 group-hover:bg-amber-50 dark:group-hover:bg-amber-500/10 group-hover:text-amber-600 dark:group-hover:text-amber-400 group-hover:shadow-md transition-all duration-300">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-amber-600 dark:group-hover:text-white transition-colors">{{ $t('home.swap') }}</span>
      </button>

      <!-- KOPRU DUGMESI: IKI AYRI KAPI, ve ayri durmalari ZORUNLU.
           `canBridge` HESABA sorar (hesabin EVM adresi var mi). Kullanici karari,
           2026-08-27: EVM hesabiyla TON agina bakarken de kopru kurulabilmeli --
           eksik olan tek sey aktif agdir ve onu goToBridge duzeltir.
           SARAN kosul ise Solana kapisidir (Task 15): Solana'da bu satirda Swap ile
           birlikte Kopru de gizlenir.
           NEDEN DUGMENIN KENDI v-if'INE EKLENMEDI: tonFlowWiring.test.js dugmenin
           v-if'inin TAM OLARAK `canBridge` olmasini kilitliyor, cunku o kosul bir
           donem zincire soruyordu ve TON'da dugmeyi yok ediyordu. O kilit TON
           kapisina karsidir; buradaki kosul TON'u DEGIL Solana'yi disliyor, yani
           kilitlenen davranis (TON'da gorunurluk) aynen yururlukte. -->
      <template v-if="!isSolanaNetwork">
      <button v-if="canBridge" class="group flex flex-col items-center gap-2" @click="goToBridge">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-blue-400 dark:group-hover:border-blue-500/50 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:shadow-md transition-all duration-300">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-white transition-colors">{{ $t('home.bridge') }}</span>
      </button>
      </template>

      <button class="group flex flex-col items-center gap-2" @click="popups.receive = true">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-emerald-400 dark:group-hover:border-emerald-500/50 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 group-hover:shadow-md group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-all duration-300">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-white transition-colors">{{ $t('home.receive') }}</span>
      </button>
    </div>

    <!-- "Gelismeler" seridi. KENDI verisini kendisi ceker ve gosterilecek hicbir kayit
         yoksa (hepsi kapatilmis / sunucu bos liste donmus) HIC render edilmez, yani bu
         satir buradaki duzene kosulsuz bir bosluk EKLEMEZ. Konum kasitli: hizli eylem
         dugmelerinin ALTI, varlik kartinin USTU -- duyuru bakiyenin ve eylemlerin onune
         gecmemeli, ama varlik listesine dalan kullanicinin da gozunden kacmamali. -->
    <NewsStrip />

    <div class="flex-1 bg-white dark:bg-[#0c0c0e] rounded-t-4xl border-t border-slate-200 dark:border-white/5 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.05)] dark:shadow-2xl dark:shadow-black transition-colors duration-300">
      
      <div class="flex items-center px-8 pt-5 pb-0 border-b border-slate-100 dark:border-white/5 gap-8">
        <button 
          @click="sekmeSec('assets')"
          class="pb-3 text-sm font-semibold transition-all duration-300 relative"
          :class="gorunenSekme === 'assets' ? 'text-indigo-600 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('home.assets') }}
          <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full transition-all duration-300" 
               :class="gorunenSekme === 'assets' ? 'opacity-100 w-full' : 'opacity-0 w-0 mx-auto'"></div>
        </button>

        <button
          @click="sekmeSec('activity')"
          class="pb-3 text-sm font-semibold transition-all duration-300 relative"
          :class="gorunenSekme === 'activity' ? 'text-indigo-600 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('home.activities') }}
          <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full transition-all duration-300"
               :class="gorunenSekme === 'activity' ? 'opacity-100 w-full' : 'opacity-0 w-0 mx-auto'"></div>
        </button>

        <!-- HISSELER: KESIF GORUNUMU (dosya basi karar notu). Tiklama
             `openStocksTab`'e gider (duz bir sekme atamasina DEGIL) cunku bStocks
             bakiyeleri ana ekranin 10 saniyelik dongusune BAGLANMAZ -- yalniz
             sekme ACILDIGINDA okunur (bkz. loadBStockData). Sekme artik
             hatirlandigi icin onMounted'da IKINCI bir giris noktasi var.
             HESAP KAPISI: bStocks BSC'de (56) ve satirlar artik TIKLANABILIR.
             BSC tutamayan bir hesapta (eski `type: 'ton'` kaydi) sekme zararsiz
             bir katalogken kalabilirdi; tiklanir olunca BOZUK bir detay ekranina
             acilan kapiya donuserdi (bakiye BSC adres kodlamasinda duser).
             `accountSupportsChain` bilinmeyen hesapta FAIL-OPEN true doner, yani
             hesap daha yuklenmemisken sekme KAYBOLMAZ. -->
        <button
          v-if="stocksAvailable"
          @click="openStocksTab"
          class="pb-3 text-sm font-semibold transition-all duration-300 relative"
          :class="gorunenSekme === 'stocks' ? 'text-indigo-600 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('home.stocks') }}
          <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500 rounded-t-full transition-all duration-300"
               :class="gorunenSekme === 'stocks' ? 'opacity-100 w-full' : 'opacity-0 w-0 mx-auto'"></div>
        </button>
      </div>

      <div v-if="gorunenSekme === 'assets'" class="flex-1 relative flex flex-col">
        <div class="px-4 pt-4 pb-2 space-y-1">
          <button v-for="token in displayedTokens" :key="token.chainId + '_' + token.address" class="group flex w-full items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-all duration-200" @click="selectToken(token)">
          <div class="flex items-center gap-3 min-w-0">
            <div class="relative min-w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5 group-hover:border-slate-300 dark:group-hover:border-zinc-600 transition-colors">
              <img :src="tokenLogo(token)" :alt="token.name" class="rounded-full w-6 h-6" width="36">
              
              <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10 shadow-sm">
                <img :src="getChainLogo(token.chainId)" class="w-full h-full rounded-full" />
              </div>
            </div>

            <div class="flex flex-col min-w-0">
              <span class="truncate text-sm font-bold text-slate-900 dark:text-white text-start transition-colors duration-300">{{ token.name }}</span>
              <!-- error=true (ör. TON proxy dustu / kasa kilitli): miktar yerine "—" —
                   formatTokenAmount(undefined) sessizce "0" donerdi, bu da bakiyenin
                   gittigi izlenimini verirdi. -->
              <span class="truncate text-xs text-slate-500 dark:text-zinc-500 font-medium text-start transition-colors duration-300">{{ isBalanceVisible ? (user.tokenBalances[token.chainId + '_' + token.address]?.error ? '—' : formatTokenAmount(user.tokenBalances[token.chainId + '_' + token.address]?.amount)) : '***' }} {{ token.symbol.toUpperCase() }}</span>
            </div>
          </div>

          <div class="flex flex-col items-end shrink-0">
            <span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ isBalanceVisible ? (user.tokenBalances[token.chainId + '_' + token.address]?.error ? '—' : '$' + formatUSDAmount(user.tokenBalances[token.chainId + '_' + token.address]?.value)) : '****' }}</span>
            <span class="text-xs font-medium transition-colors duration-300" :class="user.tokenBalances[token.chainId + '_' + token.address]?.change >= 0 ? 'text-emerald-500' : 'text-red-500'">{{ user.tokenBalances[token.chainId + '_' + token.address]?.change?.toFixed(2) || 0.00 }}%</span>
          </div>
        </button>

        <!-- Ag filtresi artik baslikta secilen agi takip ediyor; kullanicinin token'i
             olmayan bir zincire gecmek listeyi bosaltir. Bos alan "bozuk" gibi
             gorundugu icin ne oldugu ve ne yapilacagi yaziliyor. -->
        <div v-if="displayedTokens.length === 0" class="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
          <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-white/5 flex items-center justify-center">
            <img v-if="selectedFilterNetwork !== 'all'" :src="getChainLogo(selectedFilterNetwork)" class="w-6 h-6 rounded-full" />
            <span v-else class="text-slate-400 dark:text-zinc-500 text-lg">—</span>
          </div>
          <span class="text-sm font-bold text-slate-900 dark:text-white">
            {{ selectedFilterNetwork === 'all'
                ? $t('home.noTokensAny')
                : $t('home.noTokensOnNetwork', { name: chains.find(c => isSameChainId(c.chainId, selectedFilterNetwork))?.name || '' }) }}
          </span>
          <button
            v-if="selectedFilterNetwork !== 'all'"
            @click="selectedFilterNetwork = 'all'"
            class="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors cursor-pointer"
          >
            {{ $t('home.showAllNetworks') }}
          </button>
        </div>

        </div>

        <div class="px-4 pt-2 pb-6 flex justify-center">
          <button
            @click="page.currentPage = 'search_tokens'"
            class="px-4 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-zinc-500 bg-white/70 hover:bg-white dark:bg-[#18181b]/70 dark:hover:bg-[#18181b] text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white transition-all duration-300 flex items-center justify-center gap-2 group backdrop-blur-md shadow-sm"
          >
            <div class="w-5 h-5 rounded-full border border-slate-300 dark:border-zinc-600 flex items-center justify-center group-hover:border-indigo-400 dark:group-hover:border-zinc-400 transition-colors duration-300 bg-white dark:bg-zinc-800">
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            </div>
            <span class="text-xs font-semibold">{{ $t('home.import') }}</span>
          </button>
        </div>
      </div>

      <div v-if="gorunenSekme === 'activity'" class="flex-1 overflow-hidden relative">
        <History :embedded="true" class="h-full w-full" />
      </div>

      <!-- HISSELER: KESIF GORUNUMU. Bakiyeye degil KATALOGA (BSTOCKS, Task 4)
           baglidir -- imported_tokens kovasi bos olsa bile 22 satirin hepsi
           gorunur (dosya basi karar notu). Bakiyeler yalniz bu sekme
           ACILDIGINDA okunur (openStocksTab -> loadBStockData), ana ekranin
           10 saniyelik dongusune BAGLANMAZ: 22 token x getCode+balanceOfUI+
           decimals tek public BSC ucuna gider, surekli tekrari pahalidir.
           Kopruye YONLENDIREN hicbir sey YOK -- bStocks koprulenemez
           (utils/bridge.js BSTOCK_NOT_BRIDGEABLE, bridge/bridgeFrom.vue
           listeden zaten eliyor). -->
      <div v-if="gorunenSekme === 'stocks'" class="flex-1 relative flex flex-col">
        <div class="px-4 pt-4 pb-2 space-y-1">
          <!-- Satir TIKLANABILIR: detay ekrani (Token.vue) bStock'u Task 10'dan
               beri taniyor (rozet, ihracci notu, Kopru kapali) ama oraya ancak
               hisseye SAHIPSEN -- satir imported_tokens kovasina dusup Varliklar
               listesinde gorundugunde -- ulasabiliyordun; katalogdaki 22 hissenin
               21'i erisilmezdi. Gorunum Varliklar satiriyla AYNI kalip. -->
          <button
            v-for="stock in BSTOCKS"
            :key="stock.address"
            class="group flex w-full items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer transition-all duration-200"
            @click="openStock(stock)"
          >
            <div class="flex items-center gap-3 min-w-0">
              <div class="relative min-w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5">
                <img :src="tokenLogo(stock)" :alt="stock.name" class="rounded-full w-6 h-6" width="36" @error="handleImageError">
              </div>

              <div class="flex flex-col min-w-0">
                <span class="truncate text-sm font-bold text-slate-900 dark:text-white text-start transition-colors duration-300">{{ stock.name }}</span>
                <span class="truncate text-xs text-slate-500 dark:text-zinc-500 font-medium text-start transition-colors duration-300">{{ stock.symbol }}</span>
              </div>
            </div>

            <!-- FIYAT YOKKEN '—' YAZAR, "$0.00" DEGIL. Sekme artik hatirlandigi
                 icin panel veri GELMEDEN de cizilebiliyor (hisse detayindan geri
                 donus) ve o pencerede 22 satir sifir fiyatla, ustelik YESIL
                 "+0.00%" ile cikiyordu -- Apple'i sifir fiyatta ve yukseliste
                 gostermek eksik veriden daha kotu. Varliklar satiri ayni durumda
                 ZATEN '—' yaziyor. -->
            <div class="flex flex-col items-end shrink-0">
              <span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ bStockFiyatMetni(stock) }}</span>
              <span v-if="bStockMarketData(stock)" class="text-xs font-medium transition-colors duration-300" :class="(bStockMarketData(stock).change ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'">
                {{ (bStockMarketData(stock).change ?? 0).toFixed(2) }}%
              </span>
            </div>
          </button>

          <!-- SAVUNMACI: BSTOCKS sabit ve derleme zamaninda 22 kayitli, ama
               kayit hicbir sekilde bos kalirsa bolum "bozuk" gorunmesin diye
               ne oldugu yazilir. -->
          <div v-if="BSTOCKS.length === 0" class="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <span class="text-sm font-bold text-slate-900 dark:text-white">{{ $t('home.stocksEmpty') }}</span>
          </div>
        </div>

        <div class="px-6 pt-2 pb-6 text-center text-[10px] leading-relaxed text-slate-400 dark:text-zinc-600">
          {{ $t('home.stocksIssuer') }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, onUnmounted, watch, computed } from 'vue'
import { networkStore } from '../store/network'
import { JsonRpcProvider } from 'ethers'
import { pageStore } from '../store/pageStore'
import { useTokenBalance } from '../composables/useTokenBalance'
import { userStore } from '../store/user'
import { popupStore } from '../store/popup'
import Receive from './popups/Receive.vue'
import PasswordRotation from './popups/PasswordRotation.vue'
import History from './History.vue' // History componentini import ettik
import axios from 'axios'
import Header from './Header.vue'
import { cryptoStore } from '../store/crypto'
import { configStore } from '../store/config'
import { ALL_CHAINS as chains, chainsForFlow } from '../data/chains'
import NetworkScopePill from './NetworkScopePill.vue'
import NewsStrip from './NewsStrip.vue'
import { tokenScopeStore } from '../store/tokenScope'
import { ALL_NETWORKS } from '../utils/networkFilter'
import { SOLANA_CHAIN_ID } from '../utils/solana/constants'
import { chainVm, isSameChainId, rpcUrlsOf } from '../utils/vm'
import { chainLogo } from '../utils/chainLogo'
import { useSolanaAssets } from '../composables/useSolanaAssets'
import { normalizeBucketChainId, tokenBucketKey, dedupeTokenRows } from '../utils/homeTokenBucket'
import { evmOnlyFeatures } from '../utils/evmGates'
import { isTon, chainSupportsFlow, FLOW, TON_MAINNET_ID, TON_TESTNET_ID } from '../utils/chainKind'
import { accountSupportsChain } from '../utils/accountKind'
import { applyNetworkChange } from '../utils/applyNetworkChange'
import { useI18n } from 'vue-i18n'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'
import { ensureTonNativeToken } from '../utils/ton/tonTokenSeed'
import { getTonClient } from '../utils/ton/tonClient'
import { getTonBalance } from '../utils/ton/tonBalance'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { jettonsFromTokens } from '../utils/ton/jettonList'
import { getJettonWalletAddress } from '../utils/ton/jettonAddress'
import { getJettonBalance } from '../utils/ton/jettonBalance'
import { tokenLogo } from '../utils/tokenLogo'
import { createFirstLoadGate } from '../utils/firstLoadGate'
// HISSELER (bStocks) KESIF GORUNUMU verisi -- Task 4/5'ten TUKETILIR,
// DEGISTIRILMEZ (bkz. dosya basi ARAYUZ notu). BSTOCKS 22 sabit kayit;
// imported_tokens kovasindan OKUNMAZ, kovaya 22 tane $0,00 satiri eklemek
// istemiyoruz (spec gerekcesi, Task 9).
import { BSTOCKS, BSTOCKS_CHAIN_ID } from '../data/bStocks'

const network = networkStore()
const page = pageStore()
const user = userStore()
const popups = popupStore()
const crypto = cryptoStore()
const config = configStore()

// ILK YUKLEME KAPISI -- ana sayfa, ilk bakiye turu bitmeden GOSTERILMEZ
// (kullanici karari, 2026-09-15). Onceden Home mount olur olmaz ciziliyor,
// bakiyeler ise asagidaki onMounted icinde ASENKRON geliyordu: ilk saniyelerde
// portfoy "0.00", satirlar bakiyesizdi -- kullanici cuzdanini BOS goruyordu.
//
// EKRANI BURASI CIZMEZ, yalniz kapiyi ACAR: ortu App.vue da tek bir yerde durur
// (gerekcesi orada -- .25s lik out-in gecisi). Bag, paylasilan
// `page.firstLoadDone` bayragidir.
//
// ORTU, YERINE GECME DEGIL: ana sayfanin YERINE konsaydi Home un icerigi hic
// kurulmaz, bakiyeleri ceken onMounted hic calismaz ve kapi SONSUZA KADAR
// kapali kalirdi. Kilit: homeFirstLoadGate.ssr.test.js.
//
// Kapinin KENDISI ayri bir modulde (utils/firstLoadGate.js): zaman asimi ve
// "henuz acilmadi" hali orada sahte zamanlayiciyla dogrudan olculebiliyor --
// burada, SSR onMounted i beklediginden, o an hic yakalanamazdi.
const firstLoadGate = createFirstLoadGate({ onOpen: () => { page.firstLoadDone = true } })

// EVM'e ozgu ozelliklerin tek kaynagi (bkz. utils/evmGates.js).
//
// Hizli eylem dugmeleri ARTIK dogrudan buna bagli DEGIL: takas akis tablosundan
// (canSwap), kopru hesaptan (canBridge) turer -- bkz. asagidaki gerekceler.
// `features` yine de burada duruyor cunku "bu zincirde EVM'e ozel ne calisir"
// sorusunun cevabi tek yerde kalmali ve testler bayraklari buradan olcuyor.
const features = computed(() => evmOnlyFeatures(network.currentNetwork))

// SOLANA KAPISI. `features.*` YERINE ayri bir kosul: features TON'u da kapatirdi
// ve kopru dugmesinin TON'da GORUNMESI acik bir kullanici karari (2026-08-27).
// Soru "EVM mi" degil, "Solana mi".
const isSolanaNetwork = computed(() => chainVm(network.currentNetwork) === 'solana')

const scope = tokenScopeStore()

// Solana satirlari AKTIF AGA DEGIL, SECILI KAPSAMA baglidir -- SelectAssets.vue:187
// ile BIREBIR ayni kural.
//
// KOK NEDEN (nihai inceleme, Bulgu 3): useSolanaAssets Home'da TEK bir yerden,
// `chainVm(network.currentNetwork) === 'solana'` dalinin ICINDEN cagriliyordu.
// Yani EVM bir zincirde "Tum Aglar" seciliyken Home Solana bakiyesini HIC
// cekmiyordu: SOL satiri YOK, ice aktarilmis SPL satirlari 0.00. Ayni ekranin
// Gonder secicisi (SelectAssets) ise kapsama baktigi icin SOL'u CANLI bakiyesiyle
// listeliyordu -- iki ekran, kullanicinin SOL'u olup olmadigi konusunda ayri
// cevaplar veriyordu. Spec'in bu gereksinim icin yazdigi gerekce zaten buydu:
// "Portfoy toplami eksik olursa kullanici parasinin kayboldugunu sanir."
const solanaInScope = computed(() =>
  scope.filter === ALL_NETWORKS || isSameChainId(scope.filter, SOLANA_CHAIN_ID))

// Sablon ve hesaplananlar bu ada bakiyor; store'a giden tek satirlik kopru.
const selectedFilterNetwork = computed({
  get: () => scope.filter,
  set: (value) => scope.setFilter(value),
})

// Hangi eylemin bu zincirde ANLAMI VAR sorusunun tek cevabi chainKind.js'teki
// tablodur; burasi onu OKUR, yeniden karar VERMEZ.
//
// Burada bir donem `isTonNetwork` vardi ve iki dugmeyi de TON'da gizliyordu. O
// dogru bir vekildi - ta ki tablo degisene kadar: TON takasi acildiginda tablo
// "evet" demeye basladi, bu satir hala "hayir" diyordu ve ozellik kullaniciya HIC
// gorunmedi. Vekil, taklit ettigi karar degistiginde onunla birlikte degismez.
//
// `t` yalnizca applyNetworkChange'in uyarilarini cevirmek icin: o fonksiyon ceviriciyi
// disaridan alir (kendi i18n baglamini kurmaz).
const { t } = useI18n()

// Aktif hesap. `loadCurrentTokens` zaten depodan okuyor ve hesap DEGISIMINDE yeniden
// kosuyor (startBalanceUpdates <- `user.address` izleyicisi), yani ayri bir izleyici
// GEREKMIYOR - okunan deger oraya yazilir.
//
// `null` "hesap TON'a kilitli DEGIL" anlamina GELMEZ, "henuz bilinmiyor" anlamina
// gelir; asagidaki kapi bu ayrimi acikca yapiyor.
const activeAccount = ref(null)

const canSwap = computed(() => chainSupportsFlow(network.currentNetwork, FLOW.SWAP))

// KOPRU DUGMESI ZINCIRE DEGIL HESABA SORAR - ve bu, takasla arasindaki gercek farki
// yansitir (kullanici karari, 2026-08-27).
//
// Iki AYRI soru var ve uzun sure tek satirda birlestirilmislerdi:
//   1) "bu ZINCIR koprulenebilir mi" -> chainSupportsFlow(..., FLOW.BRIDGE).
//      Kopru ekranindaki zincir SECICILERI hala bunu okuyor (chainsForFlow('bridge'))
//      ve TON o listede YOK - LI.FI EVM disi zincir tasimiyor.
//   2) "bu HESAP kopru ekranina girebilir mi" -> hesabin bir EVM adresi var mi.
//
// Dugme (2)'yi sorar. Eskiden (1)'i soruyordu ve sonuc suydu: EVM hesabiyla TON agina
// bakan kullanici, EVM zincirleri arasinda kopru kurmak isterken dugmeyi hic
// goremiyordu. Oysa o kullanicinin EVM adresi VAR; eksik olan tek sey aktif agdi ve
// onu dugmenin kendisi duzeltebilir (goToBridge, asagida).
//
// TON'a KILITLI (eski/legacy `type:'ton'`) hesapta dugme yine gizli: o hesapta
// `.address` gercek bir EVM adresi degildir (spec §5), kopru orada cikmaz sokak
// olurdu. `accountHasEvm` burada KULLANILAMAZ: kumeye gecince (accountKind.js,
// 2026-09-10) `type:'ton'` icin de `true` doner, oysa bu satirin sorusu "hesap
// EVM ailesini destekler mi" DEGIL, "`.address` alani GERCEKTEN bir EVM adresi
// mi" -- dogrudan tip kontrolu bu ayrimi koruyan tek yol.
const canBridge = computed(() => activeAccount.value !== null && activeAccount.value?.type !== 'ton')

// Kopru ekranina GECIS. Dugmenin gorunur olmasi tek basina yetmiyordu.
//
// Kopru ekraninin KAYNAK zinciri aktif agdir (bridgeFrom.vue `network.currentNetwork`
// okuyor). Dugmeyi TON aginda acip dogrudan yonlendirseydik ekranda kaynak olarak
// "TON" yazardi - kullanicinin ACIKCA istemedigi sey ("kopru ekraninda aglar arasinda
// TON bulunmasin"). Zincir seciciler TON'u zaten listelemiyor, ama BASLANGIC durumu
// onlardan gelmiyordu.
//
// Bu yuzden gecis, aktif agi once koprulenebilir bir zincire alir. Ayni desen depoda
// zaten var: Token.vue'nun `ensureChain`i de Takas/Kopru secilince satirin zincirine
// gecis yapiyor.
//
// Hedef, koprulenebilir VE hesabin destekledigi ILK zincir (bugun Ethereum). Sabit
// bir chainId yazmak, o zincir listeden dusunce sessizce bozulurdu.
//
// `applyNetworkChange` false donerse (RPC yok, akis/hesap kapisi reddetti) SAYFA
// DEGISMEZ: kullanici uyariyi gorur ve yerinde kalir - yarim bir gecis, TON'u kaynak
// gosteren bir kopru ekranindan daha iyidir.
const goToBridge = async () => {
  if (!chainSupportsFlow(network.currentNetwork, FLOW.BRIDGE)) {
    const target = chainsForFlow('bridge').find(c => accountSupportsChain(activeAccount.value, c))
    if (!target) return
    if (!await applyNetworkChange(target, t, { flow: 'bridge' })) return
  }
  page.currentPage = 'bridge'
}

// Kopru dugmesinin GERCEKTEN gorunur oldugu kosul: hesap kapisi VE Solana kapisi.
// Sablon bu iki kapiyi ic ice yazar (dis <template>, ic v-if) -- gerekcesi orada.
// Sutun sayisi GORUNUR dugmeden turedigi icin ayni bilesik kosulu burada da
// kullanmak ZORUNDA: yalnizca canBridge'e bakan bir sayac, Solana'da gizlenen
// dugme icin bos bir sutun ayirirdi (F7'nin ta kendisi).
const bridgeActionVisible = computed(() => canBridge.value && !isSolanaNetwork.value)

// Sinif adlari TAM METIN yazilmali: Tailwind kaynak dosyalarini metin olarak
// tarar ve `grid-cols-${n}` gibi kurulmus bir ad uretilen CSS'e hic girmez.
// Gonder+Al HER ZAMAN gorunur (EVM'e ozgu degiller), digerleri kendi kapilarindan;
// 2/3/4'un hepsi haritalanir ki kapilar ileride ayrisirsa satir kendiliginden
// dogru kalsin.
const ACTION_GRID = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }
const actionGridClass = computed(
  () => ACTION_GRID[2 + (canSwap.value ? 1 : 0) + (bridgeActionVisible.value ? 1 : 0)] || 'grid-cols-4'
)

// ESKI AD, AYNI DEGER. Iki dal bu hesaplanani farkli adlandirdi (Solana dalinda
// `quickActionGridClass`, main'de `actionGridClass`) ve IKI AYRI test dosyasi
// ikisini de okuyor. Yeni bir hesaplanan DEGIL, ayni ref'e ikinci bir ad:
// kopyalanmis bir formul zamanla ayrisir ve iki testten yalnizca biri fark ederdi.
// Adlarin tek'e indirilmesi (ve testlerin guncellenmesi) ayri bir temizlik isi.
const quickActionGridClass = actionGridClass

// Master key eskiden diskte duruyordu. Silmek mantiksal kopyayi kaldirir ama
// LevelDB'de fiziksel iz kalabilir; eski anahtari gercekten devre disi birakmanin
// tek yolu sifre degisimi (yeni salt + yeniden sifrelenmis kasalar).
// Bayrak background.js'te YALNIZCA diskte jwk bulunan kurulumlar icin konur ve
// sifre degisimi basarili olunca passwordChange.js'te ayni yazimda temizlenir.
const showPasswordRotation = ref(false)

const dismissPasswordRotation = async () => {
  showPasswordRotation.value = false
  await chrome.storage.local.set({ needsPasswordRotation: false })
}

// Modal kapanir ama bayrak DURUR: sifre gercekten degistirilirse passwordChange.js
// atomik yazimda temizler. Kullanici vazgecip geri donerse uyari tekrar gosterilir.
const goToChangePassword = () => {
  showPasswordRotation.value = false
  page.currentPage = 'settings_security_change_password'
}

// SEKME DEPODA HATIRLANIR (`page.homeTab`). Ana ekran token detayindan geri
// donuldugunde YENIDEN MOUNT olur (App.vue `<Transition mode="out-in">` +
// `:key="page.currentPage"`), yani bilesen icindeki bir `ref` her donuste
// 'assets'e sifirlanir: Hisseler'den bir hisseye girip geri donen kullanici
// kendini Varliklar'da buluyordu. `firstLoadDone` ile AYNI gerekce, ayni depo.
//
// DEPO OLMAK ZORUNDA: `<script setup>` govdesi modul duzeyi DEGIL, `setup()`
// icidir -- orada tanimlanan bir `let` de her mount'ta sifirlanir (olculdu,
// HomeBStocks.ssr.test.js "sekme hafizasi").
const activeTab = ref(page.homeTab)
const sekmeSec = (sekme) => {
    activeTab.value = sekme
    page.homeTab = sekme
}

// bStocks HER ZAMAN BSC'de (56). Hesap BSC tutamiyorsa sekme HIC gosterilmez.
// `gorunenSekme` ayri bir izleyici olmadan da tutarli kalir: hatirlanan sekme
// 'stocks' iken BSC tutamayan bir hesaba GECILIRSE ekran bos kalmaz, Varliklar'a
// duser. `activeTab` bilerek DEGISTIRILMEZ -- hesap geri alinirsa sekme geri gelir.
const stocksAvailable = computed(() => accountSupportsChain(activeAccount.value, BSTOCKS_CHAIN_ID))
const gorunenSekme = computed(() => (activeTab.value === 'stocks' && !stocksAvailable.value ? 'assets' : activeTab.value))

const isBalanceVisible = ref(true)
const currentTokens = ref(null)
const tokensData = ref(null)
// loadCurrentTokens'in yazdigi EVM capraz-zincir liste — currentTokens'dan AYRI
// tutulur. Solana aktifken currentTokens Solana satirlariyla BIRLESTIRILMIS
// (EVM + Solana) halini tasir; birlestirme her dongude bu SABIT EVM listesi
// uzerine kurulur, bir onceki dongunun birlesik cikisinin uzerine degil —
// aksi halde her 10 saniyede Solana satirlari ikiye katlanirdi.
const evmImportedTokens = ref([])

// jettonList.js (jettonsFromTokens) ile AYNI sinir (bkz. Ku1) - decimals'in gecerli
// sayilma kurali dagilmasin diye tek sabit burada da tekrarlanir (dosyalar arasi
// import gerektirmeyecek kadar kucuk bir kural, digerleriyle AYNI desen).
const MAX_JETTON_DECIMALS = 30

const displayedTokens = computed(() => {
  if (!currentTokens.value) return []
  let result = currentTokens.value
  if (selectedFilterNetwork.value !== 'all') {
    result = result.filter(t => isSameChainId(t.chainId, selectedFilterNetwork.value))
  }
  // O1: ondaligi OLMAYAN/GECERSIZ bir TON jetton kaydi listeden DUSURULUR (spec §3.3
  // "kayitta ondalik yoksa o jetton LISTELENMEZ"). jettonList.js (jettonsFromTokens)
  // AYNI kurali bakiye okuma asamasinda uyguluyor - decimals gecersizse o jetton hic
  // okunmuyor - ama SATIR burada, listede, kalmaya devam ediyordu: sablondaki
  // formatTokenAmount(undefined) sessizce "0" doner (bkz. asagidaki formatTokenAmount)
  // ve kullaniciya SAHTE bir "0 <SEMBOL>" bakiyesi gosterirdi - spec §3.2'nin acikca
  // yasakladigi durum. Native TON (`address === NATIVE_TOKEN_ADDRESS`) ve EVM
  // kayitlari (`isTon` false) bu elemeden ETKILENMEZ.
  result = result.filter(t => {
    if (!isTon(t.chainId) || t.address === NATIVE_TOKEN_ADDRESS) return true
    return Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= MAX_JETTON_DECIMALS
  })
  // Sort by USD balance descending without mutating original array
  return [...result].sort((a, b) => {
    const valA = user.tokenBalances[`${a.chainId}_${a.address}`]?.value || 0
    const valB = user.tokenBalances[`${b.chainId}_${b.address}`]?.value || 0
    return valB - valA
  })
})

const filteredUsd = computed(() => {
  if (selectedFilterNetwork.value === 'all') return user.usd
  let sum = 0
  displayedTokens.value.forEach(token => {
    const key = `${token.chainId}_${token.address}`
    sum += user.tokenBalances[key]?.value || 0
  })
  return sum
})

const filteredPercentageInfo = computed(() => {
  if (selectedFilterNetwork.value === 'all') {
    return { pct: user.percentage, usd: user.percentageUSD }
  }
  let now = 0, old = 0
  displayedTokens.value.forEach(token => {
    const key = `${token.chainId}_${token.address}`
    if (user.tokenBalances[key]) {
      now += user.tokenBalances[key].nowValue || 0
      old += user.tokenBalances[key].oldValue || 0
    }
  })
  const pct = old !== 0 ? ((now - old) / old) * 100 : 0
  return { pct, usd: now - old }
})

let currentRequestId = 0
let currentProvider = null

const toggleBalanceVisibility = () => {
  isBalanceVisible.value = !isBalanceVisible.value
  chrome.storage.local.set({ isBalanceVisible: isBalanceVisible.value })
}

// Cozumlemenin TEK kopyasi utils/chainLogo.js'te (ayni kural alti bilesende
// kopyalanmisti).
const getChainLogo = (chainId) => chainLogo(chainId)

const createProvider = () => {
  try {
    if (currentProvider) currentProvider.destroy?.()
    currentProvider = new JsonRpcProvider(network.rpc)
    return currentProvider
  } catch (error) {
    console.error('Provider oluşturma hatası:', error)
    return null
  }
}

const formatTokenAmount = (amount) => {
  if (!amount || amount === 0) return '0'
  return parseFloat(amount).toFixed(4)
}

const formatUSDAmount = (amount) => {
  if (!amount || amount === 0) return '0.00'
  return parseFloat(amount).toFixed(2)
}

// Hisseler sekmesindeki logolar icin yedek: `tokenLogo` gecerli bir URL
// COZEMEZSE bile o URL 404 donebilir (kirik resim ikonu). Diger ekranlarin
// ayni deseni (SearchTokens.vue, swap/swapFrom.vue).
const handleImageError = (event) => {
  event.target.src = '/default-token.png'
}

const selectToken = token => {
  // Satirin KIMLIGI (chainId + address) kapida ATILMAZ.
  //
  // Token.vue kanonik kaydi `/getTokenDataById`'den cekiyor; o kayit chainId
  // TASIMIYOR ve `address` alani tokenin ANA zincirindeki adres — canli olculdu:
  // tether -> chain='ethereum', address=0xdac17f95…, chainId YOK, decimals YOK.
  // Eskiden yalniz `coingecko_id` gecirildigi icin Polygon USDT satirina basmak
  // Ethereum adresini aciyordu: bakiye okumasi "bu adreste kontrat yok" ile
  // dusuyor, ayni kayit Gonder/Takas/Kopru'ye tasiniyordu.
  //
  // chainId normalizeBucketChainId ile KENDI TIPINDE gecirilir (EVM: Number,
  // Solana: metin) — ham Number(token.chainId) Solana satirinda NaN uretirdi,
  // yani kullanicinin az once gordugu bakiyeye TIKLAMASI onu bozuk bir kayda
  // goturuyordu. `address` KUCULTULMEZ: base58 buyuk/kucuk harf duyarlidir.
  //
  // `decimals` DE tasinir. Token.vue kanonik kayittan ondalik ALAMAZ (o kayitta
  // yok) ve EVM'de zincirden ERC-20 `decimals()` ile okur — Solana'da boyle bir
  // yol YOK. Ondalik burada BILINIYOR (useSolanaAssets satiri getTokenAccounts-
  // ByOwner'dan aliyor) ve gonderimde ZORUNLU: createTransferCheckedInstruction
  // ondaligi ZINCIRDE dogrular, yanlis deger islemi dusurur (6 ondalikli bir
  // SPL tokeni 9 ile gondermek). SOL icin de gerekli: buildTransferPlan native
  // yolda `decimals !== SOL_DECIMALS` ise ACIKCA reddediyor.
  crypto.selected_token_ref = {
    id: token.coingecko_id,
    chainId: normalizeBucketChainId(token.chainId),
    address: token.address,
    // Kanonik kayitta (/getTokenDataById) decimals YOK; TON gibi '0x0' adresli
    // native varliklarda Token.vue zincirden de OKUYAMAZ (adres '0x0' oldugu icin
    // Contract cagrisi hic yapilmaz) ve Solana'da ERC-20 `decimals()` karsiligi
    // ZATEN YOK. Satirin KENDI decimals'i (buildNativeToken / useSolanaAssets)
    // burada tasinmazsa Send.vue sessizce 18'e duser -- TON 9, SPL cogunlukla 6
    // ondaliklidir; sonuc toNano'nun patlamasi ya da
    // createTransferCheckedInstruction'in islemi ZINCIRDE dusurmesidir.
    decimals: token.decimals,
    // `symbol` de tasinir: kanonik kayit COZULEMEZSE (metadata'si olmayan SPL
    // satirinda `coingecko_id` null oldugu icin istek HER ZAMAN duser) Token.vue
    // ve Gonder formu kimligi YALNIZCA bu nesneden okuyabilir. Sembolsuz kalirsa
    // kullanici bos bir baslik gorur -- bkz. utils/tokenRowRecord.js.
    symbol: token.symbol,
  }
  crypto.selected_token_id = token.coingecko_id
  page.currentPage = 'token'
}

const loadCurrentTokens = async () => {
  try {
    const { imported_tokens, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
    let parsed_data = imported_tokens[active_account.key] || {}

    // TON satiri hesabin haritasina bir kez yazilir; sonrasinda diger tokenlar gibi
    // yonetilir (SearchTokens/ImportToken).
    const seeded = ensureTonNativeToken(parsed_data)
    if (seeded.changed) {
      parsed_data = seeded.byChain
      await chrome.storage.local.set({
        imported_tokens: { ...imported_tokens, [active_account.key]: parsed_data },
      })
    }

    let allTokens = []
    
    for (const chainId in parsed_data) {
      if(parsed_data[chainId] && parsed_data[chainId].length > 0) {
        allTokens.push(...parsed_data[chainId].map(token => ({
          ...token, amount: 0, chainId: normalizeBucketChainId(chainId)
        })))
      }
    }
    
    // HESAP KAPISI. Bu yuzey, kapinin konmadigi TEK yuzeydi.
    //
    // Kapi her yere kondu - ag secici, ag degistirme, adres satirlari, dapp,
    // EditAccount, Al ekrani - ama varlik listesi atlandi ve orada YALNIZCA ag
    // kapsami pill'ine gore suzuluyordu. Sonuc: TON'a kilitli hesapta "Tum Aglar"
    // secili iken Ethereum ve Tether listeleniyordu.
    //
    // Gorunen "0 ETH" bir bakiye DEGILDI: EVM okumasi `active_account.address` ile
    // yapiliyor, o adres TON'a kilitli hesapta `UQ...` oluyor, ethers reddediyor ve
    // hata updateBalance'in genel catch'inde yutulup satir "0" gosteriyordu. Depo
    // kendi kuralini yaziyor - "bakiye hata durumunda asla 0 gostermez" - ve burada
    // ihlal ediliyordu. Kullaniciya "Ethereum'un yok" deniyordu; dogrusu "bu hesabin
    // Ethereum'u OLAMAZ".
    //
    // Suzgec LISTEYE konuyor, bakiye okumasina degil: okumayi duzeltmek satiri
    // "—" yapardi, oysa satirin kendisi bu hesapta ANLAMSIZ.
    //
    // `loadCurrentTokens` hesap degisiminde yeniden kosuyor (startBalanceUpdates ->
    // `user.address` izleyicisi), yani kapi hesapla birlikte guncellenir.
    activeAccount.value = active_account

    currentTokens.value = allTokens.filter(t => accountSupportsChain(active_account, t.chainId))
    // AYNI suzgecten gecen IKINCI, BAGIMSIZ bir anlik goruntu: Solana dali her
    // dongude birlesimi BU SABIT liste uzerine kurar (bir onceki dongunun BIRLESIK
    // cikisinin uzerine degil -- aksi halde Solana satirlari her 10 saniyede
    // ikiye katlanirdi).
    //
    // Suzgec BILEREK tekrar yaziliyor, ortak bir degiskene alinmiyor: iki ref AYNI
    // dizi ornegini paylassaydi, `currentTokens` uzerinde yapilacak yerinde bir
    // degisiklik anlik goruntuyu de sessizce bozardi -- anlik goruntunun tum anlami
    // BAGIMSIZ olmasi. Kapidan gecmis olmasi da SART: aksi halde hesap kapisinin
    // eledigi satirlar birlesim yoluyla listeye geri sizardi.
    evmImportedTokens.value = allTokens.filter(t => accountSupportsChain(active_account, t.chainId))

    // BAKIYE SOZLUGU YALNIZ HESAP DEGISTIGINDE SILINIR.
    //
    // Eskiden HER turda siliniyordu (yalnizca Solana aktifken muaf) ve bu,
    // kullanicinin bildirdigi kusurun IKINCI kapisiydi: reconnect
    // `network.rpc`yi degistirince `startBalanceUpdates` -> bu fonksiyon
    // yeniden kosuyor, sozluk bosaliyor ve AG FILTRESI secili ekranda toplam
    // (filteredUsd/filteredPercentageInfo `user.usd`den DEGIL, bu sozlukten
    // toplanir) SIFIRA dusuyordu. Arkasindan gelen tur de -- RPC o anda dustugu
    // icin, "Connect disconnected" mesajinin sebebi budur -- hicbir satiri
    // dolduramiyordu. Silmek icin bir sebep de yoktu: ag ucu degisti, HESAP
    // degil; ayni adresin bakiyeleri hala gecerli.
    //
    // HESAP DEGISIMI AYRI BIR SEY ve silme TAM OLARAK oraya aittir: oradaki
    // degerler BASKA BIR CUZDANA aittir. Sozlukle birlikte TOPLAMLAR da
    // dusurulur -- `updateBalance`in "hic okunamadiysa toplami yazma" kapisi
    // (gerekcesi orada) aksi halde onceki hesabin toplamini ekranda BIRAKIRDI.
    //
    // Solana muafiyeti kalkti: hesap degisiminde Solana satirlari da baskasinin
    // bakiyesidir, onlarin ayri tutulmasi icin bir sebep yok.
    //
    // ILK YUKLEME SILME DEGILDIR (`null`): o an temizlenecek baska bir hesabin
    // verisi YOKTUR. Ayrim onemli, cunku hafiza DEPODA yasiyor (user.js'teki
    // gerekce) ve Home dolasimla sokulup yeniden kuruluyor: "bilinmiyor"u
    // "degisti" saymak her gezinmede sozlugu bosaltirdi.
    if (user.balancesAccountKey !== null && user.balancesAccountKey !== active_account.key) {
      user.tokenBalances = {}
      user.usd = 0
      user.percentage = 0
      user.percentageUSD = 0
    }
    user.balancesAccountKey = active_account.key
  } catch (error) {
    console.error('Token yükleme hatası:', error)
    evmImportedTokens.value = []
    currentTokens.value = []
  }
}

const getTokensData = async() => {
  try {
    const response = await axios.post(config.api + '/getTokensDataById', {
      ids: currentTokens.value.map(t => t.coingecko_id)
    })
    if(response.status != 200) return
    tokensData.value = response.data.tokens
  } catch (error) {
    console.error('getTokensData error', error.message)
  }
}

// Hisseler sekmesinin fiyat/degisim verisi -- AYRI bir /getTokensDataById
// cagrisinda gelir (asagidaki loadBStockData). Mevcut portfoyle BIRLESTIRILMEZ:
// sunucunun MAX_TOKEN_IDS (250) tavani asilirsa fazla kimlik SESSIZCE kirpilir
// (400 donmez), yani birlestirmek bStocks satirlarini fiyatsiz birakabilirdi.
const bStockPrices = ref([])

// AYNI YUKLEME UST USTE tetiklenirse (sekmeye hizlica birkac kez tiklamak
// gibi) TEK bir cagriya indirgenir -- ikinci cagri birinciyi BEKLER.
let bStocksLoadPromise = null

// Katalog kaydi -> fiyat/degisim. Fiyat henuz gelmediyse (ilk render, ya da
// cagri basarisiz oldu) `null` doner; sablon bunu $0.00/%0.00'a duser --
// UYDURMA bir deger degil, "henuz bilinmiyor" durumu.
const bStockMarketData = (stock) => {
  const data = (bStockPrices.value || []).find(d => d.coingecko_id === stock.coingecko_id)
  if (!data?.market_data) return null
  return { priceUSD: data.market_data.priceUSD, change: data.market_data.change?.h24 }
}

// Fiyat metni SABLONDA degil BURADA kurulur: sablonda dolar isaretini bir
// ifadeye birlestirmek gerekiyordu ve `formatUSDAmount` veri yokken "0.00"
// donuyor -- yani sablon "$0.00" yazip fiyati SIFIR gibi gosteriyordu.
const bStockFiyatMetni = (stock) => {
  const data = bStockMarketData(stock)
  return data ? '$' + formatUSDAmount(data.priceUSD) : '—'
}

// YALNIZCA sifirdan buyuk bakiyeli bStock'lar kovaya eklenir -- boylece
// Varliklar sekmesinde de gorunurler (spec gerekcesi: "kesif gorunumu, kovaya
// YAZMA degil" -- ama SAHIP OLUNAN bir bStock artik Varliklar'da GORUNMELI).
// Kovada ZATEN olan bir kayit TEKRAR eklenmez.
const seedOwnedBStocks = async (owned) => {
  if (owned.length === 0) return

  const { imported_tokens, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
  const chainKey = String(BSTOCKS_CHAIN_ID)
  const byAccount = imported_tokens?.[active_account.key] || {}
  const existing = byAccount[chainKey] || []
  const existingAddresses = new Set(existing.map(t => t.address.toLowerCase()))

  const additions = owned
    .filter(stock => !existingAddresses.has(stock.address.toLowerCase()))
    .map(stock => ({
      name: stock.name, symbol: stock.symbol, decimals: stock.decimals,
      address: stock.address, image: stock.image, coingecko_id: stock.coingecko_id,
    }))

  if (additions.length === 0) return

  await chrome.storage.local.set({
    imported_tokens: {
      ...imported_tokens,
      [active_account.key]: { ...byAccount, [chainKey]: [...existing, ...additions] },
    },
  })

  // Varliklar sekmesi de gorsun diye TAZELE: interval yalniz updateBalance'i
  // tekrarlar, loadCurrentTokens'i DEGIL -- tazelemeden yeni satir bir sonraki
  // hesap/ag degisimine kadar gorunmezdi.
  await loadCurrentTokens()
  await updateBalance()
}

// HISSELER sekmesi acildiginda CAGRILIR -- ana ekranin 10 saniyelik dongusune
// BAGLANMAZ (kullanici karari, Task 9 brief): 22 token x getCode+balanceOfUI+
// decimals tek public BSC ucuna gider, surekli tekrari pahalidir.
//
// Bakiyeler useTokenBalance ILE okunur -- AYRI bir Multicall3 YAZILMAZ: BEP-677
// "Scaled UI Amount" carpan mantiginin TEK kopyasi orada yasiyor (bkz.
// useTokenBalance.js), ikinci bir bagimsiz kopya iki yolu zamanla ayristirir.
const loadBStockData = () => {
  if (bStocksLoadPromise) return bStocksLoadPromise

  bStocksLoadPromise = (async () => {
    try {
      const { active_account } = await chrome.storage.local.get('active_account')
      if (!active_account?.address) return

      // bStocks HER ZAMAN BSC'de (56) -- aktif ag ne olursa olsun. `network.rpc`
      // KULLANILMAZ: o kullanicinin O ANKI aktif agina aittir, bStocks'un
      // zincirine degil.
      const bscChain = chains.find(c => isSameChainId(c.chainId, BSTOCKS_CHAIN_ID))
      const rpcUrl = rpcUrlsOf(bscChain)[0]
      if (!rpcUrl) return

      // FIYAT: AYRI cagri (bkz. bStockPrices tanimindaki MAX_TOKEN_IDS notu).
      try {
        const priceResp = await axios.post(config.api + '/getTokensDataById', {
          ids: BSTOCKS.map(t => t.coingecko_id),
        })
        if (priceResp.status === 200) bStockPrices.value = priceResp.data.tokens
      } catch (priceError) {
        console.error('bStocks fiyat verisi alinamadi:', priceError)
      }

      // BAKIYE: useTokenBalance TEK KAPI. Promise.allSettled -- tek bir
      // tokenin RPC hatasi digerlerinin sonucunu KAYBETMESIN.
      const results = await Promise.allSettled(
        BSTOCKS.map(stock => useTokenBalance(active_account.address, stock.address, rpcUrl, BSTOCKS_CHAIN_ID))
      )

      const owned = []
      results.forEach((result, i) => {
        const stock = BSTOCKS[i]
        if (result.status === 'rejected') {
          console.error(`bStock bakiyesi okunamadi (${stock.symbol}):`, result.reason)
          return
        }
        if (result.value > 0) owned.push(stock)
      })

      await seedOwnedBStocks(owned)
    } catch (error) {
      console.error('bStocks verisi yuklenemedi:', error)
    } finally {
      bStocksLoadPromise = null
    }
  })()

  return bStocksLoadPromise
}

// Sekme dugmesinin cagirdigi TEK giris noktasi: sekmeyi acar VE (yalnizca bu
// aninda) bakiye/fiyat yuklemesini baslatir.
const openStocksTab = () => {
  sekmeSec('stocks')
  loadBStockData()
}

// HISSE DETAYI. `selectToken` ile AYNI sozlesme -- Token.vue kaydi
// `selected_token_ref`ten okur ve `id` ile `selected_token_id` tutmazsa
// kaydi BAYAT sayip duser (Token.vue pickedRef).
//
// `chainId` SABIT 56: BSTOCKS kayitlari chainId ALANI TASIMIYOR
// (data/bStocks.js), zincir katalogun kendisinde ortak. Bu alan atlanirsa
// Token.vue bakiyeyi AKTIF agdan okur ve kullanici Ethereum'dayken bir
// hisseye bastiginda "bu adreste kontrat yok" ile sifir gorurdu.
//
// `decimals` ve `symbol` de tasinir: kanonik kayit (/getTokenDataById)
// ondalik DONDURMUYOR ve kayit hic cozulemezse (ag hatasi) ekran kimligi
// YALNIZCA bu nesneden okuyabilir.
const openStock = (stock) => {
  crypto.selected_token_ref = {
    id: stock.coingecko_id,
    chainId: BSTOCKS_CHAIN_ID,
    address: stock.address,
    decimals: stock.decimals,
    symbol: stock.symbol,
  }
  crypto.selected_token_id = stock.coingecko_id
  page.currentPage = 'token'
}

/**
 * Solana varlik satirlarini ceker. Adres cozulemezse `null` doner (BOS DIZI
 * DEGIL): kasa kilitliyken ya da arka uc yeniden baslarken SOLANA_GET_ADDRESS
 * hata doner ve bunu "kullanicinin hic Solana varligi yok" ile ayni saymak,
 * elde duran satirlari SIFIRLA EZMEK demektir.
 *
 * `requestId`: cagiran, cagri donunce hala guncel turda olup olmadigini kontrol
 * eder (burada da kontrol edilir ki adres cozumu ile bakiye cekimi ARASINDA
 * eskiyen bir tur bosuna ag turu yapmasin).
 */
const loadSolanaRows = async (requestId) => {
  const { active_account } = await chrome.storage.local.get('active_account')
  const addressResult = active_account?.solanaAddress
    ? { result: { address: active_account.solanaAddress } }
    : await chrome.runtime.sendMessage({ type: 'SOLANA_GET_ADDRESS' })
  const solanaAddress = addressResult?.result?.address

  if (requestId !== currentRequestId) return null

  if (!solanaAddress) {
    console.error('Solana adresi cozulemedi:', addressResult?.error || 'bilinmiyor')
    return null
  }

  return await useSolanaAssets(solanaAddress)
}

/**
 * Solana satirlari OKUNAMADI -> her birine `error` isaretlenir.
 *
 * "Okunamadi" ile "kullanicinin Solana varligi YOK" AYNI SEY DEGIL: ilkinde
 * `loadSolanaRows` null doner (kasa kilitli, arka uc yeniden basliyor, RPC
 * dustu), ikincisinde BOS DIZI doner. Ayrimi kaybetmek, elde duran satirlari
 * UYDURMA bir sifirla ezmek demektir.
 *
 * Yer tutucu satirlar bu yuzden onemli: ImportToken.vue ile ice aktarilmis bir
 * SPL mint, kullanici onu TUTMASA bile kovada `amount:0` ile durur ve
 * `user.tokenBalances`ta HIC girdisi olmaz. Okuma basarisiz oldugunda o satir
 * `formatTokenAmount(undefined)` -> '0' basiyordu; artik `error` sayesinde
 * sablon "-" gosterir. Kural TON kolununkiyle AYNI (bkz. getTonBalance catch'i).
 *
 * `amount` BILEREK silinmez (sablonda `error` zaten onceliklidir), ama
 * `value/nowValue/oldValue` SILINIR: `applySolanaRows`in toplam dongusu bakiye
 * SOZLUGUNU gezer, yani bayat degerler birakilsaydi satir listede "-"
 * gorunurken portfoy toplamina HALA katilirdi -- ekranla toplam birbirini
 * yalanlardi.
 */
const markSolanaRowsUnread = () => {
  for (const token of currentTokens.value || []) {
    const chainData = chains.find(c => isSameChainId(c.chainId, token.chainId))
    if (chainVm(chainData) !== 'solana') continue

    const key = tokenBucketKey(token.chainId, token.address)
    if (!user.tokenBalances[key]) user.tokenBalances[key] = {}
    user.tokenBalances[key].error = true
    delete user.tokenBalances[key].value
    delete user.tokenBalances[key].nowValue
    delete user.tokenBalances[key].oldValue
  }
}


const updateBalance = async () => {
  const requestId = ++currentRequestId
  try {
    // TEK YOL, DALSIZ.
    //
    // Bu fonksiyon bir donem IKIYE ayriliyordu: once bir Solana dali (satirlari
    // yazip ERKEN DONEN), sonra EVM/TON dali. Sonuc (birlesme incelemesi,
    // YUKSEK): Solana aktifken "Tum Aglar" kapsaminda LISTELENEN TON/EVM
    // satirlarina ne `amount` ne `error` yaziliyordu -- `applySolanaRows`
    // YALNIZCA Solana satirlarina anahtar yazar. Sablon
    // `formatTokenAmount(undefined)` -> '0' basip UYDURMA bir "0 TON / $0.00"
    // gosteriyor, satir portfoy toplamina da HIC girmiyordu. "Deger kaybolmaz,
    // yalnizca tazelenmez" savunmasi GECERSIZDI: SOGUK ACILISTA (uzantiyi
    // Solana secili acmak) onceki dongunun degeri HIC YOKTUR.
    //
    // Ihlal edilen iki kural TON tarafinin (origin/main) ACIKCA yazdiklariydi:
    // (a) bakiye okunamadiysa 0 GOSTERME, `error` isaretle; (b) TON KENDI
    // yolundan (ensureTonAddress + getTonBalance) okunur. HEAD^2'deki dongu
    // ikisini de AKTIF AGDAN BAGIMSIZ yapiyordu -- liste CAPRAZ ZINCIR, her
    // satir kendi zincirinin ucunu (EVM) ya da kendi istemcisini (TON proxy'si)
    // kullanir ve aktif agin ne oldugu onu ILGILENDIRMEZ.
    //
    // Dallari birlestirmek o bagimsizligi YAPISAL hale getirir: "su dalda su
    // satirlar okunmuyor" durumu bir daha OLUSAMAZ. Aktif agin degistirdigi
    // yalnizca UC sey kaldi ve ucu de asagida acikca isaretli: RPC kapisi, EVM
    // saglayicisi ve Solana satirlarinin KOSULSUZ cekilmesi.
    const solanaActive = chainVm(network.currentNetwork) === 'solana'

    // RPC KAPISI. Solana'da UYGULANMAZ: Solana kaydinda `rpc` alani YOK, setRpc
    // hic cagrilmaz ve `network.rpc` ONCEKI zincirin ucunda BAYAT kalir --
    // kapiyi uygulamak ya hicbir sey yuklememek ya da bayat bir ucla kosmak
    // demekti. TON'da da UYGULANMAZ: `networkStore.clearRpc` TON'da rpc'yi null
    // yapar ama liste CAPRAZ ZINCIR; aktif agin ucu olmadan da diger
    // zincirlerin bakiyesi okunur ve kosulsuz cikmak TON secilir secilmez TUM
    // listeyi bosaltirdi.
    if (!solanaActive && !isTon(network.currentNetwork)) {
      if(!network.rpc) return
    }

    // provider yalnizca EVM icin: dongu zaten her tokenin KENDI zincirinin ucunu
    // kullaniyor, bu ornek yalnizca yasam dongusu icin tutuluyor. Solana
    // aktifken KURULMAZ -- `network.rpc` orada bayattir.
    if (!solanaActive && network.rpc) createProvider()

    // Solana satirlari AKTIF AGA DEGIL SECILI KAPSAMA baglidir (SelectAssets.vue
    // ile BIREBIR ayni kural); aktif ag Solana ise kapsam onu zaten icerir.
    //
    // HATA YUTULUR AMA ORTULMEZ: loadSolanaRows bir ag cagrisi yapar
    // (useSolanaAssets -> fetchSolanaAssets) ve FIRLATABILIR. Disaridaki genel
    // catch'e birakilsaydi TEK bir Solana RPC hatasi BUTUN portfoyu -- EVM ve
    // TON satirlari DAHIL -- okunmamis birakirdi. `null` "OKUNAMADI" demektir ve
    // BOS DIZI ile ("kullanicinin Solana varligi yok") AYNI SEY DEGILDIR;
    // ayrimi asagida `markSolanaRowsUnread` kullanir.
    let rows = null
    try {
      if (solanaActive || solanaInScope.value) rows = await loadSolanaRows(requestId)
    } catch (solanaError) {
      console.error('Solana varliklari okunamadi:', solanaError)
    }
    if (requestId !== currentRequestId) return

    // ZINCIRDEN-OKUMA LISTESI HER ZAMAN `evmImportedTokens`: loadCurrentTokens'in
    // yazdigi, ice aktarilmis CAPRAZ ZINCIR kova. `currentTokens.value` BILEREK
    // kullanilmaz -- o, onceki turun Solana satirlariyla BIRLESTIRILMIS halini
    // tasir ve dongu her turda ayni Solana satirlarini yeniden gezerdi.
    const tokens = evmImportedTokens.value || []
    const hasSolanaRows = Array.isArray(rows) && rows.length > 0

    // dedupeTokenRows: ayni mint hem imported_tokens kovasinda (amount:0 yer
    // tutucu) hem canli satirlarda olabilir; anahtar iki kez gecerse portfoy
    // toplami o tutari IKI KEZ sayar (bkz. homeTokenBucket.js).
    //
    // `rows` null (OKUNAMADI) ise liste DEGISTIRILMEZ: elde duran Solana
    // satirlarini bos bir birlesimle EZMEK, kullanicinin varliklarini yok olmus
    // gosterirdi.
    if (hasSolanaRows) currentTokens.value = dedupeTokenRows(evmImportedTokens.value, rows)

    // Hic ice aktarilmis token yoksa ama Solana satiri VARSA erken donulmez:
    // aksi halde yalnizca SOL tutan bir kullanici bakiyesini goremezdi.
    if(tokens.length === 0 && !hasSolanaRows) {
      user.usd = 0; user.percentage = 0; user.percentageUSD = 0; return
    }

    // getTokensData `currentTokens.value`u okur: BIRLESIMDEN SONRA cagrilir ki
    // SOL'un coingecko_id'si de fiyat istegine girsin (aksi halde satir gorunur,
    // degeri 0 kalir ve toplama katkisi olmaz).
    await getTokensData()
    if (requestId !== currentRequestId) return

    let usdBalance = 0
    let totalNowValue = 0
    let totalOldValue = 0

    // KAC SATIR GERCEKTEN ZINCIRDEN OKUNDU.
    //
    // `usdBalance === 0` bu soruyu CEVAPLAYAMAZ: "kullanicinin hicbir seyi yok"
    // ile "hicbir sey okunamadi" ayni sayiyi uretir. Ayrim TOPLAMIN yazilip
    // yazilmayacagina karar verir (bkz. dongu sonrasindaki kapi), o yuzden
    // BUYUKLUK degil SAYIM tutulur. Fiyat verisi olmayan bir satir da SAYILIR:
    // olculen sey "uca ulasabildik mi", "degeri hesaplayabildik mi" degil.
    let readCount = 0
    const { active_account } = await chrome.storage.local.get('active_account')

    await Promise.all(tokens.map(async(token) => {
      if (requestId !== currentRequestId) return
      try {
        // TON'un rpc listesi BOS: `chainData.rpc[0].url` burada TypeError atardi.
        // Bu yuzden dallanma o satirdan ONCE.
        if (isTon(token.chainId)) {
          const tokenKey = `${token.chainId}_${token.address}`
          if (!user.tokenBalances[tokenKey]) user.tokenBalances[tokenKey] = {}

          // Native TON satiri TEK (ensureTonNativeToken hep native adresle -
          // NATIVE_TOKEN_ADDRESS - yazar). currentTokens.value'da bu zincirin
          // BASKA bir kaydi varsa (kullanici bir jetton eklediyse) o bir jetton
          // satiridir ve asagida native satirin yaninda TOPLU okunur - burada
          // AYRICA islenirse hem cift okuma hem de yanlislikla native akisla
          // (getTonBalance) okunmus olurdu.
          if (token.address !== NATIVE_TOKEN_ADDRESS) return

          // TON kolu KENDI try/catch'inde: proxy dustu ya da kasa kilitliyse
          // (WALLET_LOCKED) `amount` hic ATANMAZ, yalnizca `error` isaretlenir.
          // Disaridaki genel catch'e dusseydi ayni sonuc olurdu ama niyet acik
          // degildi; burada satir neden "—" gosterecegini kendi basina anlatiyor.
          let tonAddress
          try {
            tonAddress = await ensureTonAddress(active_account, {
              testnet: Boolean(network.currentNetwork?.testnet),
            })
          } catch (addressError) {
            // Adres turetilemedi: NE native NE jetton okunabilir, ikisi de ayni
            // sahip adresinden turer. Jetton blogu asagida hic calismaz.
            user.tokenBalances[tokenKey].error = true
            console.error(`TON adresi turetilemedi (${tokenKey}):`, addressError)
            return
          }

          // Native TON bakiyesi jetton okumasindan BAGIMSIZ basarisizlik yuzeyi:
          // node/proxy TON icin gecici hata verebilir, bu jettonlarin da
          // okunamayacagi anlamina gelmez (ayri get-method cagrilari).
          try {
            const tonAmount = await getTonBalance(getTonClient(config.api), tonAddress)

            if (requestId !== currentRequestId) return

            user.tokenBalances[tokenKey].amount = tonAmount
            readCount++
            // Onceki bir hatadan sonra bagli kalmasin: basarili okuma bayragi temizler.
            user.tokenBalances[tokenKey].error = false

            const ton_data = tokensData.value.find(d => d.coingecko_id === token.coingecko_id)
            if (ton_data) {
              token['market'] = ton_data.market_data
              const price = ton_data.market_data.priceUSD
              const nowValue = price * tonAmount
              const sparklineVal = ton_data.market_data.sparkline?.d7?.[143] || price
              const oldValue = sparklineVal * tonAmount

              user.tokenBalances[tokenKey].price = price
              user.tokenBalances[tokenKey].change = ton_data.market_data.change.h24
              user.tokenBalances[tokenKey].value = nowValue
              user.tokenBalances[tokenKey].nowValue = nowValue
              user.tokenBalances[tokenKey].oldValue = oldValue

              totalNowValue += nowValue
              totalOldValue += oldValue
              usdBalance += nowValue
            }
          } catch (tonError) {
            // amount ATANMAZ: formatTokenAmount(undefined) "0" dondurup ekranda
            // "0 TON" gosterirdi — spec'in acikca yasakladigi durum (bkz. Task 10
            // karari). Sablon `error` bayragina bakip "—" gosterir.
            user.tokenBalances[tokenKey].error = true
            console.error(`TON bakiyesi okunamadi (${tokenKey}):`, tonError)
          }

          // TON jetton bakiyeleri. Kaynak sunucudan gelen token kayitlaridir:
          // currentTokens.value TON zincirinde native disi ne varsa (kullanici
          // SearchTokens'tan eklediyse) sunucunun /getChainTokens ucundan
          // turemistir. Bugun bu liste COGUNLUKLA BOS - jettonlarin sunucu
          // katalogu (Gorev 6) ayri bir gorevle geliyor ve henuz commitlenmedi;
          // bos liste HATA DEGIL, jettonsFromTokens zaten [] dondurur ve asagidaki
          // blok sessizce hicbir sey yapmaz.
          const tonChainId = Boolean(network.currentNetwork?.testnet) ? TON_TESTNET_ID : TON_MAINNET_ID
          const jettons = jettonsFromTokens(
            tokens.filter(t => isTon(t.chainId) && t.address !== NATIVE_TOKEN_ADDRESS)
          )

          if (jettons.length > 0) {
            const client = getTonClient(config.api)

            // PARALEL - Promise.allSettled. getJettonBalance HICBIR HATAYI
            // YUTMUYOR (bkz. jettonBalance.js bas yorumu): Promise.all kullansaydik
            // TEK bir jettonun proxy/adres hatasi TUM listenin sonucunu kaybettirirdi.
            const jettonResults = await Promise.allSettled(jettons.map(async (jetton) => {
              const walletAddress = await getJettonWalletAddress({
                client, owner: tonAddress, master: jetton.master, chainId: tonChainId,
                storage: chrome.storage.local,
              })
              return getJettonBalance({ client, walletAddress, decimals: jetton.decimals })
            }))

            if (requestId === currentRequestId) {
              jettonResults.forEach((result, i) => {
                const jettonKey = `${tonChainId}_${jettons[i].master}`
                if (!user.tokenBalances[jettonKey]) user.tokenBalances[jettonKey] = {}

                if (result.status === 'fulfilled') {
                  user.tokenBalances[jettonKey].amount = result.value
                  user.tokenBalances[jettonKey].error = false
                  readCount++

                  // DOLAR KARSILIGI — native TON kolundaki (yukarisi) AYNI hesap.
                  //
                  // Bu blok eskiden YALNIZCA `amount`/`error` yaziyordu: jetton
                  // satiri ana ekranda dogru miktari gosterip degerini HER ZAMAN
                  // "$0.00", degisimini "%0" basiyordu ve portfoy toplamina HIC
                  // katilmiyordu. Fiyat eslemesinin yapildigi tek yer olan TON
                  // kolu ise jetton satirini `address !== NATIVE_TOKEN_ADDRESS`
                  // ile ZATEN disari atmisti (yukari bkz.), yani satirin dolar
                  // karsiligi kodun HICBIR yerinde hesaplanmiyordu.
                  //
                  // Kimlik ONCE kontrol edilir: kimliksiz bir jettonda (orn. STON)
                  // `find(d => d.coingecko_id === undefined)` cagrisi kimligi
                  // olmayan BASKA bir kayda eslesebilirdi -- YANLIS fiyat EKSIK
                  // fiyattan KOTUDUR.
                  const jettonId = jettons[i].coingecko_id
                  const jetton_data = jettonId
                    ? tokensData.value.find(d => d.coingecko_id === jettonId)
                    : null

                  if (jetton_data) {
                    const price = jetton_data.market_data.priceUSD
                    const nowValue = price * result.value
                    const sparklineVal = jetton_data.market_data.sparkline?.d7?.[143] || price
                    const oldValue = sparklineVal * result.value

                    user.tokenBalances[jettonKey].price = price
                    user.tokenBalances[jettonKey].change = jetton_data.market_data.change.h24
                    user.tokenBalances[jettonKey].value = nowValue
                    user.tokenBalances[jettonKey].nowValue = nowValue
                    user.tokenBalances[jettonKey].oldValue = oldValue

                    totalNowValue += nowValue
                    totalOldValue += oldValue
                    usdBalance += nowValue
                  }
                } else {
                  // `amount` ATANMAZ - basarisiz okuma sifira CEVRILMEZ: kullanici
                  // bakiyesinin sifira dustugunu sanir. Sablon `error` bayragina
                  // bakip "—" gosterir ve USD degeri hesaplamaz (nowValue/oldValue
                  // hic yazilmadigi icin toplamlara da katilmaz).
                  user.tokenBalances[jettonKey].error = true
                  console.error(`Jetton bakiyesi okunamadi (${jettonKey}):`, result.reason)
                }
              })
            }
          }

          return
        }

        const chainData = chains.find(c => isSameChainId(c.chainId, token.chainId))

        // SOLANA SATIRI BU DONGUYE GIRMEZ. Satirlari `applySolanaRows` yazar;
        // buraya girerse `rpcUrlsOf(Solana)` BOS doner, `rpcPath` asagida
        // `network.rpc`ye (bir EVM ucuna) DUSER ve o uca base58 bir mint sorulur.
        //
        // Kapi BURADA, cagiranin listesinde DEGIL: kova CAPRAZ ZINCIR ve
        // `imported_tokens[account]['solana-mainnet']` (ImportToken.vue'nun
        // yazdigi yer tutucular) HER dalda bu listeye girer -- cagiranin "bu
        // liste yalniz EVM" varsayimi bir SPL tokeni ice aktarilir aktarilmaz
        // bozulurdu. Zincir tipine gore elemek, listeyi kim kurarsa kursun dogru.
        //
        // `chains.find` bilinmeyen bir zincirde undefined doner ve chainVm(undefined)
        // 'evm'dir: BILINMEYEN zincirin bugunku davranisi (network.rpc'ye dusmek)
        // BILEREK korunur, yalnizca Solana ayrilir.
        if (chainVm(chainData) === 'solana') return

        // rpcUrlsOf: Solana kaydinda rpc YOK ve `chainData.rpc[0]` TypeError atardi.
        // Hata ic try/catch'e dusup sessizce yutuluyordu, bakiye 0 kaliyordu.
        const rpcPath = rpcUrlsOf(chainData)[0] || network.rpc
        // chainId, rpcPath ile AYNI kaynaktan (satirin kendi zinciri): bStock kolu
        // ancak dogru uctayken acilmali.
        const tokenAmount = await useTokenBalance(active_account.address, token.address, rpcPath, token.chainId)
      
        if (requestId !== currentRequestId) return
      
        const tokenKey = `${token.chainId}_${token.address}`
        if (!user.tokenBalances[tokenKey]) user.tokenBalances[tokenKey] = {}
      
        user.tokenBalances[tokenKey].amount = tokenAmount
        readCount++
        // Onceki turdan kalan `error` bayragini dusur -- KOSULLU: ilk basarili
        // okumada anahtar eklemek tam-sekil toEqual iddialarini kirar.
        if (user.tokenBalances[tokenKey].error) user.tokenBalances[tokenKey].error = false
        const token_data = tokensData.value.find(data => data.coingecko_id === token.coingecko_id)
      
        if(token_data) {
          token['market'] = token_data.market_data

          user.tokenBalances[tokenKey].price = token_data.market_data.priceUSD
          user.tokenBalances[tokenKey].change = token_data.market_data.change.h24
          user.tokenBalances[tokenKey].value = token_data.market_data.priceUSD * tokenAmount

          const nowValue = token_data.market_data.priceUSD * tokenAmount
          const sparklineVal = token_data.market_data.sparkline?.d7?.[143] || token_data.market_data.priceUSD
          const oldValue = sparklineVal * tokenAmount

          user.tokenBalances[tokenKey].nowValue = nowValue
          user.tokenBalances[tokenKey].oldValue = oldValue

          totalNowValue += nowValue
          totalOldValue += oldValue
          usdBalance += user.tokenBalances[tokenKey].value
        }
      } catch (error) {
        // Okunamayan EVM satiri UYDURMA 0 gostermez: `error` isaretlenir,
        // sablon bayragi okuyup "—" basar. `amount`a DOKUNULMAZ.
        const tokenKey = `${token.chainId}_${token.address}`
        if (!user.tokenBalances[tokenKey]) user.tokenBalances[tokenKey] = {}
        user.tokenBalances[tokenKey].error = true
        console.error(`Error fetching balance for ${token.symbol}:`, error)
      }
    }))

    if (requestId !== currentRequestId) return

    // TEK BIR SATIR BILE OKUNAMADIYSA TOPLAMLAR YAZILMAZ.
    //
    // KOK NEDEN (kullanici bildirimi, 2026-09-15): konsolda "Connect
    // disconnected! Reconnecting..." her ciktiginda toplam USD ve gunluk yuzde
    // SIFIRA dusuyordu. O mesaj RPC'nin O ANDA cevap vermedigi anlamina gelir;
    // ayni anda kosan tur her satirda FIRLAR, satir basina catch dogru davranip
    // `error` isaretler (`amount` yazilmaz, ekranda "—" cikar) -- ama
    // `nowValue/oldValue` HIC yazilmadigi icin asagidaki toplam 0 cikiyor ve
    // KOSULSUZ olarak uzerine yaziliyordu.
    //
    // Deponun satirlar icin acikca yazdigi kural -- "basarisiz okuma sifira
    // CEVRILMEZ: kullanici bakiyesinin sifira dustugunu sanir" -- TOPLAM icin
    // uygulanmiyordu. Ekran kendini yalanliyordu: her satir "—", toplam "$0.00".
    // Bir cuzdanda bu, paranin kayboldugunu sanmak demektir.
    //
    // KAPI "hic okunamadi"ya ozeldir, "eksik okundu"ya DEGIL: en az bir satir
    // okunduysa toplam bugunku gibi yazilir (okunamayan satir 0 katkida bulunur
    // ve listede "—" gorunur). Kismi turun eksik toplami ayri bir konudur ve
    // ekranda ayri bir isaret gerektirir.
    //
    // `tokens.length === 0` durumunda da yazilmaz: o yol ya yukaridaki erken
    // donusle biter ya da Solana satirlari vardir ve toplami `applySolanaRows`
    // kendi hesabiyla yazar.
    if (readCount > 0) {
      user.percentageUSD = totalNowValue - totalOldValue
      user.percentage = user.percentageUSD !== 0 ? (totalNowValue - totalOldValue) / totalOldValue * 100 : 0
      user.usd = usdBalance
    }

    // SOLANA KAPSAMDA AMA OKUNAMADI: satirlar `error` isaretlenir, UYDURMA 0
    // YAZILMAZ. Yukaridaki toplam Solana'yi zaten ICERMIYOR, yani ekranda "-"
    // gorunen bir satir toplama da katilmaz -- ikisi birbirini yalanlamaz.
    if ((solanaActive || solanaInScope.value) && !rows) markSolanaRowsUnread()

    // Solana satirlari EVM/TON toplamlarindan SONRA islenir: applySolanaRows
    // toplamlari `currentTokens.value`un TAMAMI (EVM + TON + Solana) uzerinden
    // YENIDEN hesaplar, yani yukaridaki Solana'siz toplami birlesik toplamla
    // degistirir. Solana satiri yoksa bu satir HIC calismaz ve EVM/TON davranisi
    // bit bit aynidir.
    if (hasSolanaRows) applySolanaRows(rows)
  } catch (error) { console.error('Balance güncelleme hatası:', error) }
}

/**
 * Solana satirlarini mevcut bakiye/portfoy sozlugune yazar.
 *
 * EVM dalindan ayri: orada bakiye TOKEN BASINA zincirden okunuyor, burada tek
 * cagride hepsi geliyor. Doldurulan ALANLAR ayni olmali, yoksa portfoy yuzdesi
 * Solana'da sessizce 0 kalir.
 */
const applySolanaRows = (rows) => {
  // currentTokens.value BURADA YAZILMAZ: cagiran (updateBalance) onu EVM +
  // Solana BIRLESIMI olarak zaten ayarladi. Burada tekrar `rows`a (Solana
  // ONLY) esitlemek o birlesimi aninda geri alir ve "Tum Aglar" yeniden
  // Solana'ya daralir — Bulgu 2'nin tam olarak duzeltmeye calistigi kirilma.
  for (const row of rows) {
    const key = tokenBucketKey(row.chainId, row.address)
    if (!user.tokenBalances[key]) user.tokenBalances[key] = {}
    user.tokenBalances[key].amount = row.amount

    // `tokensData.value` ilk yuklemede getTokensData basarisiz olursa null
    // kalabilir: (tokensData.value || []) olmadan .find NULLA cokerdi ve dongu
    // ILK satirdan SONRAKI butun satirlarin miktarini sessizce atlardi.
    const data = (tokensData.value || []).find(d => d.coingecko_id === row.coingecko_id)
    if (!data) continue   // metadata/fiyat bilinmiyor: satir gorunur, degeri toplama girmez

    const price = data.market_data.priceUSD
    const nowValue = price * row.amount
    const sparklineVal = data.market_data.sparkline?.d7?.[143] || price
    const oldValue = sparklineVal * row.amount

    user.tokenBalances[key].price = price
    user.tokenBalances[key].change = data.market_data.change.h24
    user.tokenBalances[key].value = nowValue
    user.tokenBalances[key].nowValue = nowValue
    user.tokenBalances[key].oldValue = oldValue
  }

  // Portfoy toplami currentTokens.value'nun TAMAMINDAN (EVM + TON + Solana)
  // hesaplanir. EVM/TON kismi ARTIK ayni turda TAZE okunuyor: `updateBalance`
  // zincirden-okuma dongusunu (aktif ag ne olursa olsun) bu fonksiyondan ONCE
  // bitirir, yani asagidaki toplam bayat degil GUNCEL bakiyeler uzerinden cikar.
  //
  // Bakiyesi OKUNAMAYAN satir (TON kolu `error` isaretledi, `nowValue/oldValue`
  // HIC yazilmadi) toplama 0 katkida bulunur; ama listede "0" DEGIL tire (sablon
  // `error` bayragina bakar) gorunur.
  // Ayni ilke fiyati/metadata'si bilinmeyen Solana satirlari icin de gecerli.
  let usdBalance = 0, totalNowValue = 0, totalOldValue = 0
  for (const token of currentTokens.value) {
    const bal = user.tokenBalances[tokenBucketKey(token.chainId, token.address)]
    if (!bal) continue
    totalNowValue += bal.nowValue || 0
    totalOldValue += bal.oldValue || 0
    usdBalance += bal.value || 0
  }

  user.percentageUSD = totalNowValue - totalOldValue
  user.percentage = totalOldValue !== 0 ? (totalNowValue - totalOldValue) / totalOldValue * 100 : 0
  user.usd = usdBalance
}

let balanceInterval
let onVisible = null
const startBalanceUpdates = async () => {
  if (balanceInterval) clearInterval(balanceInterval)
  currentRequestId++
  await loadCurrentTokens()
  await updateBalance()
  balanceInterval = setInterval(async () => {
    // Panel gorunmez ise yoklama yapma. Gorunur olunca asagidaki
    // visibilitychange dinleyicisi bir kez tazeler.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    await updateBalance()
  }, 10000)
}

// Solana'da network.rpc DEGISMEZ (setRpc cagrilmaz), bu yuzden zincirin kendisi
// de izlenir; aksi halde Solana'ya gecince bakiye yuklemesi hic tetiklenmezdi.
watch(() => [network.rpc, network.currentNetwork?.chainId], async () => {
  await startBalanceUpdates()
})
watch(() => user.address, async() => {
  if (balanceInterval) clearInterval(balanceInterval)
  await startBalanceUpdates()
})

onMounted(async () => {
  try {
    const storage = await chrome.storage.local.get(['isBalanceVisible', 'needsPasswordRotation'])
    if (storage.isBalanceVisible !== undefined) {
      isBalanceVisible.value = storage.isBalanceVisible
    }

    showPasswordRotation.value = storage.needsPasswordRotation === true

    // SEKME MOUNT ANINDA 'stocks' ISE veri BURADA yuklenir.
    //
    // BU DAL ARTIK GERCEK KULLANICIDA DA CALISIYOR. Eski yorumu "tek yolu SSR
    // test harness'i, gercek kullanicida varsayilan hep 'assets'" diyordu; sekme
    // `page.homeTab`te hatirlandigindan beri hisse detayindan geri donen
    // kullanici da buraya duser ve panelin fiyatlarini GERI GETIREN tek yol bu
    // (`loadBStockData`'in diger cagirani `openStocksTab` yalnizca TIKLAMAYLA kosar).
    //
    // `startBalanceUpdates`'ten ONCE ve `await` OLMADAN: panel bu dal donmeden
    // cizilir. Bakiye taramasinin (`loadCurrentTokens` + tum portfoyun RPC turu)
    // arkasina kuyruklanirsa 22 satir saniyelerce fiyatsiz kalirdi. Kendi icinde
    // `bStocksLoadPromise` ile tekillestirildigi icin cift cagri zararsiz.
    //
    // Olcut `gorunenSekme`: hatirlanan sekme 'stocks' iken BSC tutamayan bir
    // hesap aktifse panel ZATEN cizilmiyor -- 22 RPC cagrisini kimsenin gormedigi
    // bir gorunum icin yapmak bosuna (hesap kapisinin kendi gerekcesi).
    if (gorunenSekme.value === 'stocks') loadBStockData()

    await startBalanceUpdates()
  } catch (error) {
    console.error('Error in onMounted:', error)
  } finally {
    // KAPI HER YOLDA ACILIR -- `catch` degil `finally`.
    //
    // `catch`e konsaydi yalniz HATA yolunda acilirdi; burasi hem basarili turu
    // hem de yutulan bir hatayi kapsar. Kapali kalan bir kapi, kullaniciyi kendi
    // cuzdanindan kilitler -- eksik bakiye bundan iyidir. Ikinci emniyet,
    // `createFirstLoadGate` icindeki zaman asimi: `await` HIC donmezse (RPC
    // asili kaldi) `finally` de hic calismaz.
    firstLoadGate.open()
  }

  // Panel gorunur oldugunda bir kez tazele: gizliyken atlanan turlar birikmesin,
  // kullanici panele dondugunde bayat bir bakiye gormesin.
  onVisible = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    updateBalance()
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
})

onUnmounted(() => {
  // Popup kisa omurlu, yan panel DEGIL: birakilan zaman asimi zamanlayicisi
  // orada sokulmus bir bilesene yazmaya calisirdi.
  firstLoadGate.dispose()
  if (balanceInterval) clearInterval(balanceInterval)
  if (currentProvider) currentProvider.destroy?.()
  if (onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})
</script>