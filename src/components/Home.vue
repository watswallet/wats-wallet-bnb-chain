<template>
  <Transition
    :enter-active-class="'transition-opacity duration-200 ease-kaymak motion-reduce:duration-0'"
    :leave-active-class="'transition-opacity duration-200 ease-kaymak motion-reduce:duration-0'"
    :enter-from-class="'opacity-0'"
    :enter-to-class="'opacity-100'"
    :leave-from-class="'opacity-100'"
    :leave-to-class="'opacity-0'"
  >
    <Receive v-if="popups.receive"></Receive>
  </Transition>

  <div ref="kok" class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-y-auto overflow-x-hidden custom-scrollbar selection:bg-indigo-500/30 transition-colors duration-300" data-home-scroller>
    <!-- KAYMAK G11 (spec 7.9 Mini serit, K8, D10): kaydirinca ustte mini bakiye seridi. Kokun ilk cocugu, sticky
         top-0 h-0 kap icinde 44 px mutlak serit (yerlesim kaymaz); sekmeler normal modda bunun altina (top-11) yapisir.
         YALNIZ istemcide (seritHazir mount'tan sonra): v-show toplami SSR HTML'ine ikinci kez basardi. Gizli modda hic
         yok (toplam yok). Baslik bakiyesi kaydiricidan cikinca belirir (seritGorunur); gorunmezken tiklama gecer,
         gorunurken tiklamayi yutar ve kendisi bir sey yapmaz. aria-hidden: toplam zaten baslikta okunuyor. Goz
         dugmesi ve baslik sinifi YOK: goz isareti sayfada tek kalir, baslik ayiklayicisi yalniz basligi alir (bu
         yorum gelistirme cizimine girer; isaret ve sinif adlari burada bilerek yazilmadi). -->
    <div v-if="seritHazir && !privacy.active" class="sticky top-0 z-30 h-0" aria-hidden="true">
      <div class="kaymak-serit absolute inset-x-0 top-0 h-11 flex items-center justify-between px-7 bg-white dark:bg-[#0c0c0e] border-b border-slate-100 dark:border-white/5" :class="seritGorunur ? '' : 'kaymak-serit-gizli'">
        <span class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('home.totalBalance') }}</span>
        <span v-if="isBalanceVisible && toplamDurumu !== 'okundu'" class="text-[15px] font-bold text-slate-900 dark:text-white"><span v-if="toplamDurumu === 'bekleniyor'" class="kaymak-iskelet w-[4.5em] h-[0.8em]" aria-hidden="true"></span><template v-else>—</template></span>
        <CountingText v-else class="text-[15px] font-bold text-slate-900 dark:text-white" :class="gozDegisSinifi" :text="isBalanceVisible ? moneyOrZero(filteredUsd) : '****'" :value="isBalanceVisible ? filteredUsd : null" :format="moneyOrZero" :identity="sayacKimligi" />
      </div>
    </div>
    <Header></Header>
    <!-- Ust yikama gizli modda cizilmez: gizli mod ust alaninin renk karari morsuz ve gradyansiz (kullanici,
         2026-10-26). Genel gizli ton kaymasi (style.css) bu kararin disinda. -->
    <div v-if="!privacy.active" class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none"></div>

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

    <!-- GIZLI MOD (gizli-mod cok-ag spec 4.7): fiyat istekleri kapali, USD toplami ve 24 sa karti YOK. Ag secici ve goz
         dugmesi gizli modda Varliklar sekmesinin basinda durdugu icin bu alan bos kalirdi; gizli modda hic cizilmez. -->
    <div v-if="!privacy.active" class="relative flex flex-col items-center pt-6 pb-8 space-y-3">
      <!-- TEK AG KONTROLU. `switches-network` YALNIZCA ana ekranda verilir (burada ya da
           gizli modda Varliklar sekmesinde; ikisi ayni anda cizilmez): ana ekranda
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
        <!-- Toplam SECILI birimde: sembol/onek kucuk (text-2xl), sayi buyuk; sembolu sonda yazan
             dillerde (de: "39,00 EUR") son ek ayni kucuk stille sayidan sonra gelir. Yazi boyutu
             metnin GERCEK uzunluguna gore kuculur (IDR/VND/KRW 360 px popup'ta tasmasin);
             bakiye gizliyken de gercek uzunluk kullanilir, goz dugmesinde boyut sicramaz.
             KAYMAK G8 (spec 7.7, D9): sayi bolumu sayac rakamlarla doner (OdometerNumber); onek ve son ek
             donmez. Sarmalayici gizli halde de ayni yapida (gizli HTML = acik HTML, yalniz sayi ****);
             tabular-nums: donen sutunlar ve duz metin ayni genislikte (Ek madde 1). Sayi hicbir oznitelige konmaz.
             KAYMAK G9 (spec 7.8, D4): cift sarmalayicinin ICINDE anahtarli gecis; yalniz goz basisinda (gozAnimasyonu)
             cikan hal .18s'de bulaniklasip mutlak konumla ust uste durur, sonra DOM'dan duser (gizliyken sayi
             DOM'da yok). Mount'ta ve bellekten gelen degerde gecis yok. -->
        <span ref="baslikBakiye" class="font-bold text-slate-900 dark:text-white leading-tight tracking-tight flex items-center gap-1 whitespace-nowrap transition-colors duration-300" :class="headlineSize">
          <span v-if="headlineParts.prefix" class="text-2xl text-slate-400 dark:text-zinc-500">{{ headlineParts.prefix }}</span>
          <span class="relative tabular-nums"><Transition name="kaymak-goz" :css="gozAnimasyonu"><OdometerNumber v-if="isBalanceVisible && toplamDurumu === 'okundu'" key="acik" :text="headlineParts.number" :size="headlineSize" :identity="sayacKimligi" :locale="locale" /><span v-else-if="isBalanceVisible" key="bekle"><span v-if="toplamDurumu === 'bekleniyor'" class="kaymak-iskelet w-[3.5em] h-[0.75em]" aria-hidden="true"></span><template v-else>—</template></span><span v-else key="gizli">****</span></Transition></span>
          <span v-if="headlineParts.suffix" class="text-2xl text-slate-400 dark:text-zinc-500">{{ headlineParts.suffix }}</span>
          
          <button type="button" data-balance-toggle @click="toggleBalanceVisibility" class="ml-2 mt-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors">
            <svg v-if="isBalanceVisible" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
          </button>
        </span>
      </div>

      <div class="flex items-center gap-2 px-3 py-1 rounded-full bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none backdrop-blur-md transition-colors duration-140 ease-kaymak">
        <span class="flex items-center text-xs font-bold gap-1" :class="[filteredPercentageInfo.pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400', gozDegisSinifi]">
          <svg v-if="isBalanceVisible && toplamDurumu === 'okundu'" class="w-3 h-3" :class="{ 'rotate-x-180': filteredPercentageInfo.pct < 0 }" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
          <span v-if="isBalanceVisible && toplamDurumu === 'bekleniyor'" class="kaymak-iskelet w-[3em] h-[0.9em]" aria-hidden="true"></span>
          <span v-else-if="isBalanceVisible && toplamDurumu === 'okunamadi'">—</span>
          <CountingText v-else :text="isBalanceVisible ? filteredPercentageInfo.pct.toFixed(2) + '%' : '***'" :value="isBalanceVisible ? filteredPercentageInfo.pct : null" :format="yuzdeBicim" :identity="sayacKimligi" />
        </span>
        <div class="w-px h-3 bg-slate-200 dark:bg-white/10 transition-colors duration-300"></div>
        <span v-if="isBalanceVisible && toplamDurumu !== 'okundu'" class="text-slate-500 dark:text-zinc-400 text-xs font-medium"><span v-if="toplamDurumu === 'bekleniyor'" class="kaymak-iskelet w-[4em] h-[0.9em]" aria-hidden="true"></span><template v-else>—</template></span>
        <CountingText v-else class="text-slate-500 dark:text-zinc-400 text-xs font-medium transition-colors duration-300" :class="gozDegisSinifi" :text="isBalanceVisible ? moneyOrZero(filteredPercentageInfo.usd) : '***'" :value="isBalanceVisible ? sayilabilir(filteredPercentageInfo.usd) : null" :format="moneyOrZero" :identity="sayacKimligi" />
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
         turer (Gonder+Al her zaman, digerleri kendi kapilarindan) ve 2/3/4/5'in
         hepsi haritalanir -- kapilar ileride birbirinden ayrisirsa bu satir
         KENDILIGINDEN dogru kalir. Gizli modda bu satir yerine asagidaki kutular cizilir. -->
    <div v-if="!privacy.active" class="grid gap-3 px-6 pb-8" :class="actionGridClass">
      <button class="group flex flex-col items-center gap-2" @click="goSend">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-indigo-400 dark:group-hover:border-indigo-500/50 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/10 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:shadow-md kaymak-karo">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors">{{ $t('home.send') }}</span>
      </button>

      <button v-if="canSwap" class="group flex flex-col items-center gap-2" @click="page.currentPage = 'swap'">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-amber-400 dark:group-hover:border-amber-500/50 group-hover:bg-amber-50 dark:group-hover:bg-amber-500/10 group-hover:text-amber-600 dark:group-hover:text-amber-400 group-hover:shadow-md kaymak-karo">
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
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-blue-400 dark:group-hover:border-blue-500/50 group-hover:bg-blue-50 dark:group-hover:bg-blue-500/10 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:shadow-md kaymak-karo">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-white transition-colors">{{ $t('home.bridge') }}</span>
      </button>
      </template>

      <button class="group flex flex-col items-center gap-2" @click="popups.receive = true">
        <div class="w-12 h-12 rounded-2xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 flex items-center justify-center shadow-sm dark:shadow-none group-hover:scale-105 group-hover:border-emerald-400 dark:group-hover:border-emerald-500/50 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-500/10 group-hover:shadow-md group-hover:text-emerald-600 dark:group-hover:text-emerald-400 kaymak-karo">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-zinc-400 group-hover:text-emerald-600 dark:group-hover:text-white transition-colors">{{ $t('home.receive') }}</span>
      </button>
    </div>

    <!-- GIZLI MOD UST ALANI (kullanici karari, 2026-10-26). Bakiye alani gizli modda cizilmez; yerini kalkan karti
         ve buyuk eylem kutulari alir. Kart yalniz gercekten yururlukte olan korumalari yazar (fiyat istegi yok
         P11, dApp'e kapali spec 6.2, uzak gorsel yok D6); yeni bir iddia eklenecekse once korumanin kendisi
         olmali. Ikinci tur (ayni gun): mor palet ve kalin, kutu icindeki ikonlar reddedildi, "grafit" secildi.
         Renk notr; Gonder murekkep (acikta siyah, koyuda kirik beyaz); tek renk zumrut ve yalniz koruma
         isaretlerinde ("bu koruma acik"). Ikonlar tek aile: 24'luk izgara, 1.75 cizgi, non-scaling-stroke
         (her boyutta ayni kalinlik), kutusuz; amblem PrivacyToggle'daki hayaletin cizgi hali. Kok relative:
         sonraki kardes olan varlik kartinin golgesi alt siranin ustune boyanmasin. Dar genislikte (yan panel
         320px, buyuk yazi ayari) alt siranin ikonlari dugmenin kendi genisligine bakarak gizlenir (@container),
         yazi kenara binmez; Gonder/Al basliklari ustten sabit, ipucu iki satira inse de hizali kalir. Gonder'deki
         saydam kenarlik iki kutunun icerigini ayni hizaya koyar, kontrast temasinda da sinir cizer. Koyu kart opak #131315
         olmali: style.css'teki gizli ton eslemesi onu tona ceker, baska bir hex tonun disinda kalir. Gonder
         yine goSend'e gider (tek karar noktasi). Alt sira sutun sayisi gorunur kutudan turer
         (privateActionRowClass). Takas ve Kopru kapilari normal satirdakinden AYRIDIR: script bolumundeki privateSwapVisible ve privateBridgeVisible. -->
    <div v-else class="relative px-5 pt-2 pb-3 flex flex-col gap-2.5">
      <div data-private-shield class="rounded-[18px] border border-zinc-200/90 bg-white px-4 py-3.5 dark:border-white/[0.07] dark:bg-[#131315]">
        <div class="flex items-center gap-3">
          <svg class="size-6 shrink-0 text-zinc-900 dark:text-zinc-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path vector-effect="non-scaling-stroke" d="M4.75 20.5V10a7.25 7.25 0 0 1 14.5 0v10.5l-2.417-1.75-2.416 1.75L12 18.75l-2.417 1.75-2.416-1.75-2.417 1.75Z" />
            <path vector-effect="non-scaling-stroke" d="M9.375 9.625v1.5M14.625 9.625v1.5" />
          </svg>
          <div class="min-w-0 flex-1">
            <p class="text-base leading-5 font-semibold tracking-[-0.01em] text-zinc-950 dark:text-zinc-50">{{ $t('privacy.home.shieldTitle') }}</p>
            <p class="text-xs leading-4 text-zinc-600 dark:text-zinc-400">{{ $t('privacy.home.shieldBody') }}</p>
          </div>
        </div>
        <ul class="mt-2.5 flex flex-col gap-1 border-t border-zinc-100 pt-2.5 text-xs leading-4 text-zinc-700 dark:border-white/[0.06] dark:text-zinc-300">
          <li class="flex items-center gap-3">
            <span class="flex w-6 shrink-0 justify-center"><svg class="size-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M6.75 19.5A4 4 0 0 1 6.026 11.566A6 6 0 0 1 17.984 10.56A4.5 4.5 0 0 1 17.25 19.5ZM3 3l18 18" /></svg></span>
            <span>{{ $t('privacy.home.guardPrices') }}</span>
          </li>
          <li class="flex items-center gap-3">
            <span class="flex w-6 shrink-0 justify-center"><svg class="size-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg></span>
            <span>{{ $t('privacy.home.guardDapps') }}</span>
          </li>
          <li class="flex items-center gap-3">
            <span class="flex w-6 shrink-0 justify-center"><svg class="size-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M3.75 19.5h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5ZM3 3l18 18" /></svg></span>
            <span>{{ $t('privacy.home.guardImages') }}</span>
          </li>
        </ul>
      </div>

      <div data-private-actions class="flex flex-col gap-2">
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="flex min-h-[104px] flex-col items-start rounded-[18px] border border-transparent bg-zinc-950 px-3.5 pt-3.5 pb-3 text-left text-white shadow-[0_1px_2px_rgb(0_0_0/0.06)] transition duration-150 hover:bg-zinc-800 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:bg-zinc-200 dark:text-zinc-950 dark:shadow-none dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-200" @click="goSend">
            <svg class="-mt-[3px] -ml-[3px] size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>
            <span class="mt-4.25 block">
              <span class="block text-base leading-5 font-semibold tracking-[-0.01em]">{{ $t('home.send') }}</span>
              <span class="mt-0.5 block text-xs leading-4 tracking-[-0.01em] text-zinc-400 dark:text-zinc-600">{{ $t('privacy.home.sendHint') }}</span>
            </span>
          </button>
          <button type="button" class="flex min-h-[104px] flex-col items-start rounded-[18px] border border-zinc-200/90 bg-white px-3.5 pt-3.5 pb-3 text-left text-zinc-950 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition duration-150 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-zinc-50 dark:shadow-none dark:hover:border-white/[0.14] dark:hover:bg-white/[0.07] dark:focus-visible:outline-zinc-200" @click="popups.receive = true">
            <svg class="-mt-[3px] -ml-[3px] size-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="m19.5 4.5-15 15m0 0h11.25m-11.25 0V8.25" /></svg>
            <span class="mt-4.25 block">
              <span class="block text-base leading-5 font-semibold tracking-[-0.01em]">{{ $t('home.receive') }}</span>
              <span class="mt-0.5 block text-xs leading-4 tracking-[-0.01em] text-zinc-600 dark:text-zinc-400">{{ $t('privacy.home.receiveHint') }}</span>
            </span>
          </button>
        </div>

        <div data-private-secondary class="grid gap-2" :class="privateActionRowClass">
          <button type="button" class="@container flex h-11 items-center justify-center gap-1.5 rounded-[14px] border border-zinc-200/90 bg-white text-zinc-900 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition duration-150 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-zinc-100 dark:shadow-none dark:hover:border-white/[0.14] dark:hover:bg-white/[0.07] dark:focus-visible:outline-zinc-200" @click="page.currentPage = 'private_fund'">
            <svg class="size-4 shrink-0 @max-[5.75rem]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            <span class="text-[13px] leading-4 font-medium whitespace-nowrap">{{ $t('privacy.home.fund') }}</span>
          </button>
          <button v-if="privateSwapVisible" type="button" class="@container flex h-11 items-center justify-center gap-1.5 rounded-[14px] border border-zinc-200/90 bg-white text-zinc-900 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition duration-150 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-zinc-100 dark:shadow-none dark:hover:border-white/[0.14] dark:hover:bg-white/[0.07] dark:focus-visible:outline-zinc-200" @click="page.currentPage = 'private_swap'">
            <svg class="size-4 shrink-0 @max-[5.75rem]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
            <span class="text-[13px] leading-4 font-medium whitespace-nowrap">{{ $t('home.swap') }}</span>
          </button>
          <button v-if="privateBridgeVisible" type="button" class="@container flex h-11 items-center justify-center gap-1.5 rounded-[14px] border border-zinc-200/90 bg-white text-zinc-900 shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition duration-150 hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-zinc-100 dark:shadow-none dark:hover:border-white/[0.14] dark:hover:bg-white/[0.07] dark:focus-visible:outline-zinc-200" @click="page.currentPage = 'private_bridge'">
            <svg class="size-4 shrink-0 @max-[5.75rem]:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="M2.25 7.5h19.5M4.5 7.5v12M19.5 7.5v12M4.5 19.5a7.5 7.5 0 0 1 15 0" /></svg>
            <span class="text-[13px] leading-4 font-medium whitespace-nowrap">{{ $t('home.bridge') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Gizlilik onayi popup'i: yalniz bayrak aciksa ve karar verilmemisse cizilir. Gizli Hesap aktifken HIC cizilmez
         (eski bilgilendirme kartiyla ayni kapi: privacy.active); gizli modda onay sorulmaz, ping ve sayac zaten kapali. -->
    <AnalyticsConsent v-if="!privacy.active" />

    <!-- "Gelismeler" seridi. KENDI verisini kendisi ceker ve gosterilecek hicbir kayit
         yoksa (hepsi kapatilmis / sunucu bos liste donmus) HIC render edilmez, yani bu
         satir buradaki duzene kosulsuz bir bosluk EKLEMEZ. Konum kasitli: hizli eylem
         dugmelerinin ALTI, varlik kartinin USTU -- duyuru bakiyenin ve eylemlerin onune
         gecmemeli, ama varlik listesine dalan kullanicinin da gozunden kacmamali. -->
    <NewsStrip />

    <!-- KAYMAK G10 (spec 7.9, Ek insaatci notu 1): panel icerik tabanli esasla uzar (flex-[1_0_auto]; flex-1 ile
         en az yukseklik panelin uzamasini iptal ederdi, yapisik sekmeler panel bitisinde koperdi). En az yukseklik:
         normalde kaydirici eksi serit, gizlide tam kaydirici; yapisikken kisa sekmeye geciste scrollTop kirpilmaz.
         +2px (G10 inceleme bulgusu): panelin 1 px border-t'si (border-box) ve gozcunun kendi 1 px'i. Payi olmadan kisa
         sekmede en fazla kaydirma satiri cizginin 1 px altinda birakiyordu: yapisikken kisa sekmeye geciste satir 1 px
         kayiyor, gozcunun alti cizgiye inmedigi icin kose geri geliyordu. +2px ile satir cizgide, yapisma suruyor. -->
    <div class="flex-[1_0_auto] bg-white dark:bg-[#0c0c0e] rounded-t-4xl border-t border-slate-200 dark:border-white/5 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.05)] dark:shadow-2xl dark:shadow-black transition-colors duration-300"
         :class="privacy.active ? 'min-h-[calc(100%+2px)]' : 'min-h-[calc(100%-2.75rem+2px)]'">
      
      <!-- Gizli modda dort sekme (Gizli islemler eklenir): 360px'e sigmasi icin aralik ve yazi
           YALNIZ gizli modda daralir; tasarsa satir kaydirilir (kaydirma cubugu gizli).
           KAYMAK G10 (spec 7.9, K8): satir yapisir; normalde seridin altina (top-11), gizlide en uste (top-0). Zemin
           panelle ayni (tema geciste ayni hizda doner), backdrop-filter yok. Yapismamisken rounded-t-4xl: zemin panelin
           yuvarlak kosesinden tasmaz; yapisinca kose 0. Yapismayi hemen ustteki 1 px gozcu (net yukseklik 0) soyler. -->
      <div ref="sekmeGozcu" aria-hidden="true" class="h-px -mb-px"></div>
      <div class="flex items-center pt-5 pb-0 border-b border-slate-100 dark:border-white/5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sticky z-20 bg-white dark:bg-[#0c0c0e] transition-colors duration-300"
           ref="sekmeSatiri" data-home-tabs
           :class="[privacy.active ? 'top-0 px-5 gap-4 [&>button]:text-[13px] [&>button]:whitespace-nowrap' : 'top-11 px-8 gap-8', yapisti ? '' : 'rounded-t-4xl']">
        <button 
          @click="sekmeSec('assets')"
          class="pb-3 text-sm font-semibold transition-colors duration-160 ease-kaymak relative"
          :class="gorunenSekme === 'assets' ? sekmeSecili : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('home.assets') }}
        </button>

        <!-- HISSELER: KESIF GORUNUMU (dosya basi karar notu). Tiklama
             `openStocksTab`'e gider (duz bir sekme atamasina DEGIL) cunku bStocks
             bakiyeleri ana ekranin 10 saniyelik dongusune BAGLANMAZ -- yalniz
             sekme ACILDIGINDA okunur (bkz. loadBStockData). Sekme artik
             hatirlandigi icin onMounted'da IKINCI bir giris noktasi var.
             HESAP KAPISI: sekme, hesabin TUTABILDIGI zincirlerin gruplarindan
             (`stockGroups`: bStocks BSC'de 56; bayrak aciksa xStocks Ethereum,
             BSC ve Arbitrum'da) en az biri varsa gorunur ve satirlar TIKLANABILIR.
             Hicbir hisse zincirini tutamayan bir hesapta (eski `type: 'ton'` kaydi)
             sekme zararsiz bir katalogken kalabilirdi; tiklanir olunca BOZUK bir
             detay ekranina acilan kapiya donuserdi (bakiye yanlis adres kodlamasinda
             duser). `accountSupportsChain` bilinmeyen hesapta FAIL-OPEN true doner,
             yani hesap daha yuklenmemisken sekme KAYBOLMAZ.
             GIZLI MOD: sekme ozel modda HIC yoktur (stocksTabVisible = stocksAvailable && !privacy.active, P13). -->
        <button
          v-if="stocksTabVisible"
          @click="openStocksTab"
          class="pb-3 text-sm font-semibold transition-colors duration-160 ease-kaymak relative"
          :class="gorunenSekme === 'stocks' ? sekmeSecili : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('home.stocks') }}
        </button>

        <button
          @click="sekmeSec('activity')"
          class="pb-3 text-sm font-semibold transition-colors duration-160 ease-kaymak relative"
          :class="gorunenSekme === 'activity' ? sekmeSecili : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('home.activities') }}
        </button>

        <!-- GIZLI ISLEMLER: SilentSwap siparisleri (durum, iade). Kayitlar yalniz bu cihazda ve
             normal/gizli hesabi birbirine baglar; bu yuzden sekme YALNIZ gizli modda var. -->
        <button
          v-if="privacy.active"
          @click="sekmeSec('private')"
          class="pb-3 text-sm font-semibold transition-colors duration-160 ease-kaymak relative"
          :class="gorunenSekme === 'private' ? sekmeSecili : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
        >
          {{ $t('privacy.home.tab') }}
        </button>
        <span aria-hidden="true" class="kaymak-gosterge pointer-events-none absolute bottom-0 left-0 h-0.5 w-12 origin-left rounded-t-full" :class="sekmeCizgi" :style="gostergeStili"></span>
      </div>

      <PrivateOrders v-if="gorunenSekme === 'private'" embedded :class="sekmeGiris" />

      <div v-if="gorunenSekme === 'assets'" class="flex-1 relative flex flex-col" :class="sekmeGiris">
        <!-- GIZLI MOD KONUMU (kullanici karari, 2026-10-26): ag secici ve goz dugmesi
             gizli modda bakiye alanindan Varliklar sekmesinin basina tasinir (bakiye alani
             gizli modda hic cizilmez); normal modda yerleri degismedi. Pill'in kurallari
             bakiye alanindaki TEK AG KONTROLU notunda. Pill satirin SOLUNDA durdugu icin
             menusu sola hizalanir: ortalanan menu dar bir pill'de kartin sol kenarindan
             tasip kirpilirdi. Goz tercihi genel modla ortaktir ve satirlardaki miktarlari
             gizler; toggle olmazsa gizlenmis miktarlar gizli modda acilamazdi.
             KAYMAK G10 (spec 7.9): relative z-10 kap, secicinin acik menusunu yapisik sekmelerin (z-20) altinda tutar. -->
        <div v-if="privacy.active" class="flex items-center justify-between px-7 pt-4 relative z-10">
          <NetworkScopePill switches-network menu-align="start" :model-value="scope.filter" @update:model-value="scope.setFilter" />

          <button type="button" data-balance-toggle @click="toggleBalanceVisibility" class="p-1 -mr-1 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors">
            <svg v-if="isBalanceVisible" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.522 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
          </button>
        </div>

        <!-- SPL BAKIYE HATASI (Gorev 19, E3): SPL okumasi basarisiz olunca liste SPL satirlarini eksik gosterir ve toplam
             EKSIK kalir; kullanici "SPL tokenim yok" sanmasin diye ince bir bant + yeniden dene. useSolanaAssets dizisinde
             numaralandirilamaz `splFailed` / `solFailed` tasir (yok/duz dizi = bant yok). Gizli modda Solana hic sorgulanmaz, bant da yok.
             Bant KAPSAMA baglidir (`solanaInScope`: bayrak + gizli degil + Tum Aglar/Solana): `solanaSplFailed` yalniz bakiye turunun sonunda
             yazilir, kapsam degisince bir tur boyunca bayat kalirdi (final cuzdan-istemci-D2); SelectAssets zaten `solanaInScope` ile kapsamli. -->
        <div v-if="solanaSplFailed && solanaInScope" data-spl-error-band role="status" aria-live="polite" class="flex items-center justify-between gap-3 p-3 mx-4 mt-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 transition-colors duration-300">
          <div class="flex items-center gap-2 min-w-0">
            <ExclamationTriangleIcon class="w-4 h-4 text-red-500/80 shrink-0" />
            <span class="text-xs text-red-600 dark:text-red-300">{{ $t('home.solana.splLoadError') }}</span>
          </div>
          <button type="button" data-spl-retry @click="retrySolanaAssets" class="text-xs font-semibold text-red-600 dark:text-red-300 hover:text-red-700 dark:hover:text-red-200 underline cursor-pointer shrink-0">
            {{ $t('history.list.retry') }}
          </button>
        </div>

        <div class="px-4 pb-2 space-y-1" :class="privacy.active ? 'pt-2' : 'pt-4'">
          <button v-for="token in displayedTokens" :key="token.chainId + '_' + token.address" :data-row-key="satirAnahtari(token)" class="group flex w-full items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer kaymak-satir" @click="selectToken(token)">
          <div class="flex items-center gap-3 min-w-0">
            <div class="relative min-w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5 group-hover:border-slate-300 dark:group-hover:border-zinc-600 transition-colors" :data-flight-icon="satirAnahtari(token)">
              <img v-if="privacy.active" :src="rowLogo(token)" :alt="token.name" class="rounded-full w-6 h-6" width="36" @error="handleImageError">
              <TokenAvatar v-else :token="token" :alt="token.name" class="rounded-full w-6 h-6" />
              
              <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10 shadow-sm">
                <img :src="getChainLogo(token.chainId)" class="w-full h-full rounded-full" @error="hideBrokenImage" />
              </div>
            </div>

            <div class="flex flex-col min-w-0">
              <span class="truncate text-sm font-bold text-slate-900 dark:text-white text-start transition-colors duration-300">{{ token.name }}</span>
              <!-- error=true (ör. TON proxy dustu / kasa kilitli): miktar yerine "—" —
                   formatTokenAmount(undefined) sessizce "0" donerdi, bu da bakiyenin
                   gittigi izlenimini verirdi. -->
              <span class="truncate text-xs text-slate-500 dark:text-zinc-500 font-medium text-start transition-colors duration-300" :class="gozDegisSinifi"><span v-if="isBalanceVisible && satirOkunmadi(token)" class="kaymak-iskelet w-[3em] h-[0.9em]" aria-hidden="true"></span>{{ isBalanceVisible && satirOkunmadi(token) ? '' : (isBalanceVisible ? (user.tokenBalances[token.chainId + '_' + token.address]?.error ? '—' : formatTokenAmount(user.tokenBalances[token.chainId + '_' + token.address]?.amount)) : '***') }} {{ token.symbol.toUpperCase() }}</span>
            </div>
          </div>

          <!-- GIZLI MOD: USD karsiligi ve 24 sa degisimi YOK (fiyat istekleri kapali; spec 4.7). -->
          <div v-if="!privacy.active" class="flex flex-col items-end shrink-0">
            <span v-if="isBalanceVisible && satirOkunmadi(token)" class="text-sm font-bold"><span class="kaymak-iskelet w-[4em] h-[0.9em]" aria-hidden="true"></span></span>
            <CountingText v-else class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300" :class="gozDegisSinifi" :text="isBalanceVisible ? ((user.tokenBalances[token.chainId + '_' + token.address]?.error || user.tokenBalances[token.chainId + '_' + token.address]?.valueUnknown) ? '—' : moneyOrZero(user.tokenBalances[token.chainId + '_' + token.address]?.value)) : '****'" :value="satirSayacDegeri(token)" :format="moneyOrZero" :identity="satirSayacKimligi(token)" />
            <span class="text-xs font-medium transition-colors duration-300" :class="user.tokenBalances[token.chainId + '_' + token.address]?.change >= 0 ? 'text-emerald-500' : 'text-red-500'"><span v-if="satirOkunmadi(token)" class="kaymak-iskelet w-[2.5em] h-[0.9em]" aria-hidden="true"></span>{{ satirOkunmadi(token) ? '' : (user.tokenBalances[token.chainId + '_' + token.address]?.change?.toFixed(2) || 0.00) + '%' }}</span>
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
            v-if="selectedFilterNetwork !== 'all' && !privacy.active"
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
            class="px-4 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-zinc-700 hover:border-indigo-400 dark:hover:border-zinc-500 bg-white/70 hover:bg-white dark:bg-[#18181b]/70 dark:hover:bg-[#18181b] text-slate-500 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white transition-colors duration-140 ease-kaymak flex items-center justify-center gap-2 group backdrop-blur-md shadow-sm"
          >
            <div class="w-5 h-5 rounded-full border border-slate-300 dark:border-zinc-600 flex items-center justify-center group-hover:border-indigo-400 dark:group-hover:border-zinc-400 transition-colors duration-300 bg-white dark:bg-zinc-800">
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            </div>
            <span class="text-xs font-semibold">{{ $t('home.import') }}</span>
          </button>
        </div>
      </div>

      <!-- KAYMAK G10 (inceleme bulgusu, spec 7.9 "Duragan gorunum ayni"): Aktiviteler kabi icerik boyunda kalir,
           flex-1 ile GERILMEZ. Panelin en az yuksekligi (kaydirici eksi serit) gerilen kaba ve gomulu History'nin
           h-full / min-h-full zincirine gecip ortalanan bos/hata durumlarini ("islem yok", "yuklenemedi + Tekrar dene",
           "adres cozulemedi") gorunen alanin altina itiyordu. Icerik boyunda popupta konum G10 oncesiyle ayni; uzun
           listede fark yok (panel zaten icerikle uzar, History'nin ic kaydiricisi devreye girmez); panelin kalan alti
           bos beyaz zemindir. -->
      <div v-if="gorunenSekme === 'activity'" class="overflow-hidden relative" :class="sekmeGiris">
        <!-- GIZLI MOD: aktivite listesi HESABA baglidir. History yalniz onMounted ve zincir
             izleyicisiyle yukler; mod/hesap degisiminde (user.address) yeniden kurulmazsa
             onceki modun islem listesi ekranda kalirdi. :key remount eder: loading=true,
             transactions=[] ve active_account yeniden okunur. -->
        <History :embedded="true" :key="user.address" class="h-full w-full" />
      </div>

      <!-- HISSELER: KESIF GORUNUMU. Bakiyeye degil KATALOGA (bStocks + xStocks,
           tokenizedStocks.stocksByChain) baglidir -- imported_tokens kovasi bos
           olsa bile satirlarin hepsi gorunur (dosya basi karar notu). Liste AGA
           GORE gruplanir; aktif ag en ustte. Bakiyeler yalniz bu sekme
           ACILDIGINDA ve acikken 60 sn'de bir okunur (openStocksTab ->
           loadBStockData), ana ekranin 10 saniyelik dongusune BAGLANMAZ: zincir
           basina TEK Multicall3 cagrisidir (utils/stockBalances.js).
           OZELLIK BAYRAKLARI kapaliyken (stockGroupedOn false: xstocksOn VE lcxOn kapali) yalniz BSC'deki bStocks ve
           BUGUNKU gorunum: ag basligi, ihracci rozeti, ag logosu ve bakiye cizilmez.
           LCX bayragi (lcxOn) aciksa ek aglarin (Base, Optimism, ...) dinamik LCX gruplari da bu dalla gorunur.
           GIZLI MODDA (xstocksOn ve lcxOn da false olur) sekmenin KENDISI yoktur: stocksTabVisible (P13);
           bStocks bakiyesi, fiyati ve 60 sn tazeleyici de calismaz.
           Kopruye YONLENDIREN hicbir sey YOK -- iki ihracci da koprulenemez
           (utils/bridge.js, bridge/bridgeFrom.vue listeden zaten eliyor). -->
      <div v-if="gorunenSekme === 'stocks'" class="flex-1 relative flex flex-col" :class="sekmeGiris">
        <!-- AG CIPLERI (yalniz stockGroupedOn iken, yani xStocks ya da LCX bayragi acik VE gizli mod kapali): listeyi suzer, aktif agi DEGISTIRMEZ. -->
        <div v-if="stockGroupedOn && stocksAvailable" data-stock-chips class="flex gap-2 px-4 pt-4 overflow-x-auto">
          <button
            v-for="chip in stockChips"
            :key="chip"
            type="button"
            data-stock-chip
            :aria-pressed="chip === stockChipSelected ? 'true' : 'false'"
            @click="stockChipChoice = chip"
            class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            :class="chip === stockChipSelected ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
          >
            <img v-if="chip !== STOCK_CHIP_ALL" :src="getChainLogo(chip)" :alt="chainNameOf(chip)" class="w-4 h-4 rounded-full object-contain">
            <span>{{ chip === STOCK_CHIP_ALL ? $t('home.stocksAll') : chainNameOf(chip) }}</span>
          </button>
        </div>
        <div class="px-4 pt-4 pb-2 space-y-1">
          <template v-for="group in visibleStockGroups" :key="group.chainId">
            <div v-if="stockGroupedOn" data-stock-group-header class="flex items-center gap-2 px-3 pt-3 pb-1">
              <img :src="getChainLogo(group.chainId)" :alt="chainNameOf(group.chainId)" class="w-4 h-4 rounded-full object-contain">
              <span class="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-500">{{ chainNameOf(group.chainId) }}</span>
            </div>

            <!-- Satir TIKLANABILIR: detay ekrani (Token.vue) iki ihracciyi da taniyor
                 (rozet, ihracci notu, Kopru kapali) ama oraya ancak hisseye SAHIPSEN
                 ulasabiliyordun; katalogdaki satirlarin cogu erisilmezdi. Gorunum
                 Varliklar satiriyla AYNI kalip (logonun sag altinda kucuk ag logosu). -->
            <button
              v-for="stock in group.rows"
              :key="stock.key"
              :data-row-key="stock.key"
              class="group flex w-full items-center justify-between p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer kaymak-satir"
              @click="openStock(stock)"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div class="relative min-w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5">
                  <TokenAvatar :token="stockLogoToken(stock)" :alt="stock.name" class="rounded-full w-9 h-9" />

                  <div v-if="stockGroupedOn" data-stock-chain-logo class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10 shadow-sm">
                    <img :src="getChainLogo(stock.chainId)" :alt="chainNameOf(stock.chainId)" class="w-full h-full rounded-full">
                  </div>
                </div>

                <div class="flex flex-col min-w-0">
                  <span class="truncate text-sm font-bold text-slate-900 dark:text-white text-start transition-colors duration-300">{{ stock.name }}</span>
                  <span class="truncate text-xs text-slate-500 dark:text-zinc-500 font-medium text-start transition-colors duration-300">
                    <span data-stock-ticker>{{ stock.ticker }}</span>
                    <template v-if="stockGroupedOn">
                      <span v-if="companyBalanceLabel(stock)" data-stock-balance class="ml-1">&middot; {{ companyBalanceLabel(stock) }}</span>
                    </template>
                  </span>
                </div>
              </div>

              <!-- FIYAT YOKKEN tire yazar, "$0.00" DEGIL. Sekme hatirlandigi icin panel
                   veri GELMEDEN de cizilebiliyor (hisse detayindan geri donus) ve o
                   pencerede satirlar sifir fiyatla, ustelik YESIL "+0.00%" ile
                   cikiyordu -- Apple'i sifir fiyatta ve yukseliste gostermek eksik
                   veriden daha kotu. xStocks'ta carpan bilinmiyorsa da tire. -->
              <div class="flex flex-col items-end shrink-0">
                <span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ bStockFiyatMetni(companyRepresentative(stock)) }}</span>
                <span v-if="bStockMarketData(companyRepresentative(stock))" class="text-xs font-medium transition-colors duration-300" :class="(bStockMarketData(companyRepresentative(stock)).change ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'">
                  {{ (bStockMarketData(companyRepresentative(stock)).change ?? 0).toFixed(2) }}%
                </span>
              </div>
            </button>
          </template>

          <!-- SAVUNMACI: katalog hicbir sekilde bos kalirsa bolum "bozuk" gorunmesin
               diye ne oldugu yazilir. -->
          <div v-if="stockGroups.length === 0" class="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <span class="text-sm font-bold text-slate-900 dark:text-white">{{ $t('home.stocksEmpty') }}</span>
          </div>

          <!-- ILK ALIM KAPISI: uygunluk yaniti gelene kadar iskelet (liste bos, bos durum YOK); yanit gelince ve
               bakiye okununca liste hala bossa ulke durumuna gore tek cumle. home.stocksEmpty'den AYRI durumdur. -->
          <div v-if="!eligibilityReady && listedGroups.length === 0" data-stock-skeleton class="space-y-3 px-3 pt-3" aria-hidden="true">
            <div v-for="n in 3" :key="n" class="flex items-center gap-3">
              <span class="block w-10 h-10 rounded-full bg-slate-200 dark:bg-white/10 animate-pulse"></span>
              <span class="flex-1 space-y-2">
                <span class="block h-3 w-1/3 rounded bg-slate-200 dark:bg-white/10 animate-pulse"></span>
                <span class="block h-3 w-1/5 rounded bg-slate-200 dark:bg-white/10 animate-pulse"></span>
              </span>
            </div>
          </div>
          <div v-if="stockListEmpty" data-stock-empty class="flex flex-col items-center justify-center gap-2 py-12 px-6 text-center">
            <span v-if="stockRegionUnknown" data-stock-empty-unknown class="text-sm font-medium text-slate-500 dark:text-zinc-400">{{ $t('stockGate.empty.unknown') }}</span>
            <span v-else data-stock-empty-list class="text-sm font-medium text-slate-500 dark:text-zinc-400">{{ $t('stockGate.empty.list') }}</span>
          </div>
        </div>

        <!-- FIYAT KAYNAGI SATIRI (spec 7): YALNIZCA en az bir satir Atlas'tan
             SON 10 DAKIKADA yazilmissa (stocksAtlasPriced). Sunucu bayragi
             kapaliyken belgelerde `price_source` hic yok ve satir gorunmez;
             bayrak kapatilirsa `price_source` 'atlas' kalir ama zaman eskir ve
             satir yine duser -- durmus bir kaynagi canli gibi anmamak icin.
             SERTIFIKA NOTU (TK14): ihracci adi OLMADAN tek cumle (home.stocksCertNote). -->
        <div class="px-6 pt-2 pb-6 text-center text-[10px] leading-relaxed text-slate-400 dark:text-zinc-600">
          <p v-if="stocksAtlasPriced" class="mb-1 font-medium text-slate-500 dark:text-zinc-500">{{ $t('home.stocksPriceSource') }}</p>
          <p>{{ $t('home.stocksCertNote') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, onUnmounted, watch, computed, inject } from 'vue'
import { networkStore } from '../store/network'
import { JsonRpcProvider } from 'ethers'
import { pageStore } from '../store/pageStore'
import { useTokenBalance } from '../composables/useTokenBalance'
import { marketForDisplay, isRebasedStock } from '../utils/stockPricing'
import { ensureMultipliersFor, multiplierFor } from '../utils/stockBalances'
import { userStore } from '../store/user'
import { privacyStore } from '../store/privacy'
import { popupStore } from '../store/popup'
import Receive from './popups/Receive.vue'
import PasswordRotation from './popups/PasswordRotation.vue'
import History from './History.vue' // History componentini import ettik
import axios from 'axios'
import Header from './Header.vue'
import { cryptoStore } from '../store/crypto'
import { configStore } from '../store/config'
import { ALL_CHAINS as chains, chainsForFlow, LISTED_CHAINS } from '../data/chains'
import { hedgedRead } from '../utils/hedgedRead'
import NetworkScopePill from './NetworkScopePill.vue'
import NewsStrip from './NewsStrip.vue'
import AnalyticsConsent from './AnalyticsConsent.vue'
import { requestAnalyticsCount } from '../utils/analyticsCountRequest'
import { tokenScopeStore } from '../store/tokenScope'
import { ALL_NETWORKS, privateModeScope } from '../utils/networkFilter'
import { privateNowOf, readPrivateNow } from '../utils/privacy/privateAccount'
import { SOLANA_CHAIN_ID } from '../utils/solana/constants'
import { chainVm, isSameChainId, rpcUrlsOf } from '../utils/vm'
import { chainLogo } from '../utils/chainLogo'
import { useSolanaAssets } from '../composables/useSolanaAssets'
import { ExclamationTriangleIcon } from '@heroicons/vue/24/outline'
import { normalizeBucketChainId, tokenBucketKey, dedupeTokenRows } from '../utils/homeTokenBucket'
import { evmOnlyFeatures } from '../utils/evmGates'
import { isTon, chainSupportsFlow, FLOW, TON_MAINNET_ID, TON_TESTNET_ID } from '../utils/chainKind'
import { accountSupportsChain } from '../utils/accountKind'
import { applyNetworkChange } from '../utils/applyNetworkChange'
import { useI18n } from 'vue-i18n'
import { useTabIndicator } from '../composables/useTabIndicator'
import { useHomeStickyBar, SERIT_PX } from '../composables/useHomeStickyBar'
import { useHomeScrollMemory } from '../composables/useHomeScrollMemory'
import { scrollKey } from '../utils/motion/scrollMemory'
import { motionAllowed } from '../utils/motion/motionAllowed'
import { tabSlideClass, TAB_SLIDE_CLEAR_MS } from '../utils/motion/tabSlide'
import { useMoney } from '../composables/useMoney'
import { headlineSizeClass } from '../utils/homeHeadline'
import { NATIVE_TOKEN_ADDRESS } from '../utils/nativeToken'
import { ensureTonNativeToken } from '../utils/ton/tonTokenSeed'
import { ensureDefaultTokens, bucketNeedsDefaults } from '../utils/defaultTokenSeed'
import { ensurePrivateDefaultTokens } from '../utils/privacy/privateDefaultTokens'
import { privateScopeChainId, rowsOfChain, withScopeNativeRow, comparePrivateRows, hideLogolessZeroRows } from '../utils/privacy/privateHomeScope'
import { privateTokenLogo, UNKNOWN_TOKEN_LOGO } from '../utils/privacy/privateTokenLogo'
import { privateSourceChains } from '../utils/privacy/silentswapConfig'
import { selfSwapSourceChains, selfBridgeTargets } from '../utils/privacy/selfRoutes'
import { getTonClient } from '../utils/ton/tonClient'
import { getTonBalance } from '../utils/ton/tonBalance'
import { ensureTonAddress } from '../utils/ton/tonIdentity'
import { jettonsFromTokens } from '../utils/ton/jettonList'
import { getJettonWalletAddress } from '../utils/ton/jettonAddress'
import { getJettonBalance } from '../utils/ton/jettonBalance'
import { hideLogolessZero } from '../utils/tokenLogoState'
import TokenAvatar from './TokenAvatar.vue'
import CountingText from './motion/CountingText.vue'
import OdometerNumber from './motion/OdometerNumber.vue'
import { createFirstLoadGate } from '../utils/firstLoadGate'
import { hydrateBalanceSnapshot, persistBalanceSnapshot } from '../utils/sessionBalanceCache'
import { currencyStore } from '../store/currency'
// HISSELER (bStocks + xStocks) KESIF GORUNUMU verisi: sabit katalog (utils/tokenizedStocks);
// imported_tokens kovasindan OKUNMAZ, kovaya katalogun tamamini $0,00 satirlari olarak eklemek
// istemiyoruz (spec gerekcesi, Task 9). Yalniz SAHIP OLUNANLAR kovaya yazilir.
import { BSTOCKS_CHAIN_ID } from '../data/bStocks'
import { XSTOCKS_ENABLED, PRIVATE_SWAP_BRIDGE, SOLANA_ENABLED, LCX_ENABLED } from '../utils/featureFlags'
import { stocksByChain, stockEntry, stockKey } from '../utils/tokenizedStocks'
import { STOCK_CHIP_ALL, stockChipIds, initialStockChip, filterStockGroups, collectStockIds, loadGroupBalances, ownedRows, planSeed, stockPriceText, companyBalanceText, companyValueOf, syncLcxStockRows, UNKNOWN_TEXT } from '../utils/stocksTab'
import { mergeGroupRows, pickRepresentative } from '../utils/stocks/stockCompanies'
import { isAtlasPriced } from '../utils/priceSource'
import { useStocksRefresh } from '../utils/stocksRefresh'
// ILK ALIM KAPISI (K34, K35): Hisseler LISTESI yalniz uygun ihraccilari (ve ELDE tutulan hisseyi) gosterir.
import { useStockEligibility } from '../composables/useStockEligibility'
import { offerableRows } from '../utils/stockGate/offerable'
import PrivateOrders from './privacy/PrivateOrders.vue'

const network = networkStore()
const page = pageStore()
const user = userStore()
const popups = popupStore()
const privacy = privacyStore()
const crypto = cryptoStore()
const config = configStore()
const currency = currencyStore()

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
//
// GIZLI MOD: Solana kapsamda DEGILDIR (Gizli Hesap EVM-yalnizdir; gizli-mod cok-ag spec 4.7 P13). Her turdaki
// SOLANA_GET_ADDRESS mesaji ve Solana RPC'si kalkar.
// Kapsam SECIMI (mod'dan bagimsiz); modu updateBalance her turda depodaki hesaptan okur (readPrivateNow, PF-DD11).
// Ozellik bayragi KAPALIYKEN (SOLANA_ENABLED false) kapsam Solana'yi HIC icermez: yoklama (SOLANA_GET_ADDRESS + Solana RPC)
// calismaz (Global Constraint 20; SelectAssets.vue solanaInScope ile ayni kapi). Bayrak const'tur, islem aninda okunur.
const solanaScopeSelected = computed(() =>
  SOLANA_ENABLED && (scope.filter === ALL_NETWORKS || isSameChainId(scope.filter, SOLANA_CHAIN_ID)))
const solanaInScope = computed(() => !privacy.active && solanaScopeSelected.value)

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
const { t, locale } = useI18n()

// Secili para birimi: ekrandaki TUM tutarlar (toplam, 24 sa degisim, satir degeri, hisse fiyati) buradan gecer.
// Fiyat/deger USD tutulur, cevirme ve bicim useMoney'de (kur yoksa "USD 12.34" etiketiyle).
const { money, moneyOrZero, partsOrZero } = useMoney()

// Aktif hesap. `loadCurrentTokens` zaten depodan okuyor ve hesap DEGISIMINDE yeniden
// kosuyor (startBalanceUpdates <- `user.address` izleyicisi), yani ayri bir izleyici
// GEREKMIYOR - okunan deger oraya yazilir.
//
// `null` "hesap TON'a kilitli DEGIL" anlamina GELMEZ, "henuz bilinmiyor" anlamina
// gelir; asagidaki kapi bu ayrimi acikca yapiyor.
//
// TOHUM (Task 43): pinia'daki `user.activeAccount` (Header yazar, Home yeniden kurulunca KALIR) varsa onunla baslar.
// Hatirlanan Hisseler sekmesi yalniz ayni acilista Home'a donuldugunde vardir; o anda hesap zaten bilinir, boylece
// TON'a kilitli hesapta `gorunenSekme` mount aninda 'assets' olur ve uygunluk aboneligi hic baslamaz (STOCK_GATE_STATUS
// ve /eligibility IP sorgusu gitmez). Soguk acilista pinia bos: davranis eskisi gibi (fail-open, hesap gelince duzelir).
const activeAccount = ref(user.activeAccount ?? null)

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
// Normal satir yalniz normal modda cizilir: Gonder ve Al HER ZAMAN gorunur (taban 2),
// digerleri kendi kapilarindan. Gizli moddaki alt kutu sirasi (privateActionRowClass)
// ayni kurali Para yukle tabaniyla (taban 1) uygular. 1..5'in hepsi haritalanir ki
// kapilar ileride ayrisirsa satir kendiliginden dogru kalsin.
const ACTION_GRID = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5' }
const gatedActionCount = computed(() => (canSwap.value ? 1 : 0) + (bridgeActionVisible.value ? 1 : 0))
const actionGridClass = computed(() => ACTION_GRID[2 + gatedActionCount.value] || 'grid-cols-5')
// Gizli modda Takas ve Kopru dugmeleri YALNIZ PRIVATE_SWAP_BRIDGE acikken VE statik kullanilabilirlik kosulu saglanirken gorunur
// (Takas: en az bir Takas kaynak agi, Kopru: en az bir kaynak icin baska acik Para yukle agi; kaynak: selfRoutes.js, FUND listesi)
// ve private_swap / private_bridge ekranlarini acar (klasik ekranlari DEGIL). Etkin aga, canSwap / bridgeActionVisible'a ve bakiyeye BAKMAZ.
// Normal modun satiri (canSwap / bridgeActionVisible) bundan ETKILENMEZ.
const privateSwapVisible = computed(() => PRIVATE_SWAP_BRIDGE && selfSwapSourceChains(LISTED_CHAINS).length > 0)
const privateBridgeVisible = computed(() => PRIVATE_SWAP_BRIDGE && privateSourceChains(LISTED_CHAINS).some((c) => selfBridgeTargets(c.chainId).length > 0))
const privateGatedCount = computed(() => (privateSwapVisible.value ? 1 : 0) + (privateBridgeVisible.value ? 1 : 0))
const privateActionRowClass = computed(() => ACTION_GRID[1 + privateGatedCount.value] || 'grid-cols-3')

// ESKI AD, AYNI DEGER. Iki dal bu hesaplanani farkli adlandirdi (Solana dalinda
// `quickActionGridClass`, main'de `actionGridClass`) ve IKI AYRI test dosyasi
// ikisini de okuyor. Yeni bir hesaplanan DEGIL, ayni ref'e ikinci bir ad:
// kopyalanmis bir formul zamanla ayrisir ve iki testten yalnizca biri fark ederdi.
// Adlarin tek'e indirilmesi (ve testlerin guncellenmesi) ayri bir temizlik isi.
const quickActionGridClass = actionGridClass

// Gizli modda "Gonder" gizli gondermeyi acar (spec 4.2 akis 3). Sade Gonder gizli modda
// ulasilamaz kalir: secimi yapan TEK yer burasidir.
const goSend = () => { page.currentPage = privacy.active ? 'private_send' : 'select_asset' }

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
let kullaniciSekmeTiklamasi = false
const sekmeSec = (sekme) => {
    if (sekme !== gorunenSekme.value) kullaniciSekmeTiklamasi = true
    // Yalniz Gecmis dugmesi sekmeSec('activity') cagirir; geri yukleme bu fonksiyondan gecmez.
    // GIZLI MOD: mesaj hic yollanmaz (spec 5 ve 15; atsBuy ve App.vue izleyicisiyle ayni kapi). Gecmis sekmesi gizli
    // modda da gorunur; Hisseler sekmesi orada hic cizilmez (stocksTabVisible), bu yuzden openStocksTab kapisiz.
    if (sekme === 'activity' && privacy.active !== true) requestAnalyticsCount('screen', { key: 'homeActivity' })
    activeTab.value = sekme
    page.homeTab = sekme
}

// `gorunenSekme` ayri bir izleyici olmadan da tutarli kalir: hatirlanan sekme
// 'stocks' iken hicbir hisse zincirini tutamayan bir hesaba GECILIRSE ekran bos kalmaz,
// Varliklar'a duser. `activeTab` bilerek DEGISTIRILMEZ -- hesap geri alinirsa sekme geri gelir.
//
// HISSELER GRUPLARI (spec 5.7): katalogdan, BAKIYEDEN BAGIMSIZ. Ag basina bir grup (Ethereum, BSC,
// Arbitrum); aktif ag bunlardan biriyse en ustte, degilse sabit sira. Hesabin TUTAMADIGI zincirin grubu
// cizilmez: hicbir zinciri tutamayan hesapta (eski `type: 'ton'` kaydi) sekme HIC gosterilmez. xStocks
// yalniz ozellik bayragi aciksa (XSTOCKS_ENABLED) VE gizli mod kapaliyken listeye girer; aksi halde yalniz
// BSC'deki bStocks.
//
// GIZLI MOD (sahip karari 2026-10-16: xStocks gizli modda KAPALI): xStocks gruplari Ethereum ve Arbitrum'u da
// icerir ve her grup icin Multicall3 ile OWNER = aktif adres bakiyesi okunur; gizli modda bu Gizli adresi bu
// aglarin RPC'sine gonderirdi (D6 "yalniz gereken aglar"). `xstocksOn` bu yuzden `privacy.active`'e de bakar ve
// mod bilesen yasarken degisebildigi icin COMPUTED'dir. Hisseler sekmesinin KENDISI de ozel modda gizlidir
// (`stocksTabVisible`, P13): BSC'deki 22 bStock'un bakiyesi (Gizli adres) ve fiyati da sorgulanmaz.
const xstocksOn = computed(() => XSTOCKS_ENABLED && !privacy.active)
// LCX HISSELERI (Bolum 2): dinamik satirlar (sunucu /lcx/stocks) yalniz LCX bayragi acik VE gizli mod kapaliyken listeye girer;
// gizli modda satir da, /lcx/stocks istegi de yoktur (ayni gerekce: Gizli adres hicbir LCX agina sorulmaz). Mod bilesen yasarken
// degisebildigi icin COMPUTED. Satirlar MODUL durumundadir (reaktif degil): yukleyici (loadLcxRows) her adimdan sonra
// `lcxRowsRev`'i artirir ve `stockGroups` ona baglidir.
const lcxOn = computed(() => LCX_ENABLED && !privacy.active)
const lcxRowsRev = ref(0)
// Ag basligi, ag logosu, bakiye etiketi ve ag cipleri: xStocks ya da LCX gruplari varken (bugunku gorunum yalniz bStocks'tur).
const stockGroupedOn = computed(() => xstocksOn.value || lcxOn.value)
const stockGroups = computed(() => {
  lcxRowsRev.value // bagimlilik: modul durumundaki LCX satirlari degisince gruplar yeniden kurulur
  return stocksByChain({
    activeChainId: network.currentNetwork?.chainId,
    includeXstocks: xstocksOn.value,
    includeLcx: lcxOn.value,
  }).filter(group => accountSupportsChain(activeAccount.value, group.chainId))
})
const stocksAvailable = computed(() => stockGroups.value.length > 0)
// GIZLI MOD (P13, gizli-mod cok-ag spec 4.7): Hisseler sekmesi ozel modda GIZLIDIR. Sekme gorunmezse `gorunenSekme`
// Varliklar'a duser (hatirlanan sekme korunur), 22 bakiye okumasi, fiyat istegi ve 60 sn tazeleyici (gorunenSekme
// 'stocks' degilken durur) calismaz. Mod bilesen yasarken degisebilir: COMPUTED.
const stocksTabVisible = computed(() => stocksAvailable.value && !privacy.active)

// 'private' (Gizli islemler) ayni desen: mod kapaliyken Varliklar'a duser, hatirlanan sekme korunur.
// Tek tanim burada (useStockEligibility aboneligi asagida bunu okur): gizli modda 'stocks' gorunmez, abonelik ve /eligibility sorgusu acilmaz.
const gorunenSekme = computed(() => {
  if (activeTab.value === 'stocks' && !stocksTabVisible.value) return 'assets'
  if (activeTab.value === 'private' && !privacy.active) return 'assets'
  return activeTab.value
})

// ILK ALIM KAPISI (K34, K35; spec 6.8; PE15): bir ihracci bu baglanti ulkesinden musait degilse satirlari Hisseler
// LISTESINDEN dusurulur, ama ELDE tutulan hisse kalir (K35: Sat / Gonder / goruntuleme acik). `stockGroups` KATALOG
// kalir: fiyat (collectStockIds), bakiye (loadGroupBalances) ve Varliklar tohumu (seedOwnedStocks) tam katalogdan
// beslenir; suzulen yalnizca GOSTERIMdir (`listedGroups`). Yukleme = gizli: yanit gelene kadar hicbir ihracci musait
// sayilmaz (useStockEligibility), bu yuzden yuzeyde ayri bir "yukleniyor" dali yoktur.
//
// Abonelik olcutu `gorunenSekme`'dir, hatirlanan `activeTab` DEGIL: hesap hicbir hisse zincirini tutamiyorsa panel
// cizilmez (stocksRefresher ve loadBStockData ile AYNI getter); abonelik aynisini kullanmazsa gorunmeyen bir yuzey icin
// STOCK_GATE_STATUS ve dolayisiyla /eligibility IP sorgusu giderdi (spec 5.13).
const { ready: eligibilityReady, isAvailable: issuerAvailable, verdictOf: issuerVerdictOf } = useStockEligibility({
  enabled: () => gorunenSekme.value === 'stocks',
})

// Hisseler Multicall3'unun sonucu: stockKey(zincir, adres) -> { status, balance, multiplier }.
const stockBalances = ref({})
// loadBStockData bakiyeyi OKUYUP bitirince true; hesap degisince false. Bos durum bunu bekler: bakiye gelmeden "hisse yok"
// denirse sonradan gelen tutulan hisse bir an bos ekranin ardindan belirirdi.
const balancesLoaded = ref(false)
// Okunmus ve > 0 (ownedRows ile AYNI olcut): okunamayan satir tutulan sayilmaz.
const isHeld = (row) => {
  const state = stockBalances.value[stockKey(row.chainId, row.address)]
  return state?.status === 'ok' && state.balance > 0n
}
const listedGroups = computed(() => stockGroups.value
  .map(group => ({ chainId: group.chainId, rows: offerableRows(group.rows, { isAvailable: issuerAvailable, isHeld }) }))
  .filter(group => group.rows.length > 0))

// Ag cipleri: secim yalniz gorunumdur; bellekte (pageStore.stockChip), oturum boyunca; diske yazilmaz (kaymak D5:
// Home her donuste yeniden mount olur, bilesen ici bir ref secimi sifirlardi). null = henuz secilmedi,
// baslangic aktif agdan turetilir; satira basinca ag degisecegi icin once DONDURULUR (openStock).
const stockChipChoice = computed({
  get: () => page.stockChip,
  set: (v) => { page.stockChip = v },
})
const stockChips = computed(() => stockChipIds(listedGroups.value))
const stockChipSelected = computed(() => {
  const choice = stockChipChoice.value ?? initialStockChip(listedGroups.value, network.currentNetwork?.chainId)
  return stockChips.value.includes(choice) ? choice : STOCK_CHIP_ALL
})
// Satirlar SIRKET satiridir (TK5): ayni zincirdeki bStocks + xStocks cifti tek satir. Fiyat istegi
// ve bakiye okumasi `stockGroups` (TUM secenekler) uzerinden gider; yalniz GOSTERIM birlesir.
// Suzme `mergeGroupRows`'tan ONCE (listedGroups): sirketin `options`'i yalniz uygun ya da tutulan secenekleri tasir ve
// temsilci (companyRepresentative) SUZULMUS options uzerinden secilir; uygun olmayan bStocks temsilci olamaz.
const visibleStockGroups = computed(() => (stockGroupedOn.value
  ? filterStockGroups(listedGroups.value, stockChipSelected.value)
  : listedGroups.value
).map(group => ({ chainId: group.chainId, rows: mergeGroupRows(group.chainId, group.rows) })))

// Bos durum: eligibility hazir + bakiye yuklendi + liste bos. Ulke bilinmiyorsa (COUNTRY_UNKNOWN / CHECK_FAILED, sigorta
// dahil) "bolgen belirlenemedi" dili, aksi halde "bu bolgede sunulan urun yok". home.stocksEmpty ("liste yuklenemedi")
// BU durum DEGILDIR. VITE_XSTOCKS_ENABLED=false derlemede Turkiye'de liste bos kalir ve bu durum gorunur (spec 13.2 #42).
const stockListEmpty = computed(() => eligibilityReady.value && balancesLoaded.value && listedGroups.value.length === 0)
const stockRegionUnknown = computed(() => [...new Set(stockGroups.value.flatMap(group => group.rows.map(row => row.issuer)))]
  .some(issuer => ['COUNTRY_UNKNOWN', 'CHECK_FAILED'].includes(issuerVerdictOf(issuer)?.reason)))
// Secili sekmenin vurgusu: normal modda indigo; gizli modda notr murekkep (grafit karari, kullanici 2026-10-26).
const sekmeSecili = computed(() => (privacy.active ? 'text-zinc-950 dark:text-white' : 'text-indigo-600 dark:text-white'))
const sekmeCizgi = computed(() => (privacy.active ? 'bg-zinc-950 dark:bg-white' : 'bg-indigo-500'))
// Tek kayan gosterge (spec 7.2): satirdaki gorunen sekmelerin SABLON sirasi.
const gorunenSekmeler = computed(() => ['assets', ...(stocksTabVisible.value ? ['stocks'] : []), 'activity', ...(privacy.active ? ['private'] : [])])
const sekmeSatiri = ref(null)
const { style: gostergeStili, measure: gostergeOlc } = useTabIndicator({
  rowRef: sekmeSatiri,
  activeIndex: () => gorunenSekmeler.value.indexOf(gorunenSekme.value),
})
// Sekme icerigi yonlu giris (spec 7.3, K9): yon sinifi dort sekme bloguna baglanir (sarmalayici yok). YALNIZ
// kullanici tiklamasi kaydirir; otomatik dususler (hesap kapisi, gizli mod, disaridan yazilan homeTab) ve 10 sn
// yenilemesi aninda degisir. Sinif en uzun hareket bitince kalkar: sonradan gelen satirlar animasyon almaz.
const sekmeGiris = ref('')
let sekmeGirisZamanlayici = null
const sekmeGirisDurdur = () => {
  if (sekmeGirisZamanlayici !== null) clearTimeout(sekmeGirisZamanlayici)
  sekmeGirisZamanlayici = null
}
// Kullanici tiklamasiyla degisen sekmede gosterge kayar ve icerik tiklanan yonden gelir; otomatik dususte
// (hesap yuklendi) gosterge gecissiz yerlesir, icerik kaymaz.
watch(gorunenSekme, (yeni, eski) => {
  const kullanici = kullaniciSekmeTiklamasi
  kullaniciSekmeTiklamasi = false
  gostergeOlc({ animate: kullanici })
  sekmeGirisDurdur()
  sekmeGiris.value = kullanici && motionAllowed() ? tabSlideClass(eski, yeni) : ''
  if (sekmeGiris.value) {
    sekmeGirisZamanlayici = setTimeout(() => {
      sekmeGirisZamanlayici = null
      sekmeGiris.value = ''
    }, TAB_SLIDE_CLEAR_MS)
  }
})
watch([gorunenSekmeler, () => privacy.active, locale], () => gostergeOlc({ animate: false }))
// Yapiskan sekmeler (spec 7.9, K8): kok Home kaydiricisi, gozcu sekme satirinin hemen ustu, ust pay normalde serit
// (SERIT_PX), gizli modda 0 (serit yok). yapisti yalniz kose sinifini surer; G13 recompute()'u geri yuklemeden sonra cagirir.
const kok = ref(null)
const sekmeGozcu = ref(null)
// Mini bakiye seridi (spec 7.9, G11): baslik bakiyesi span'i (gizli modda yok, ref null) ikinci gozlemcinin hedefi;
// cikinca seritGorunur. seritHazir yalniz istemcide, kok gercekten bagliyken acilir (SSR testlerinde onMounted
// onServerPrefetch'e eslenir ve kok null kalir: serit SSR HTML'ine girmez).
const baslikBakiye = ref(null)
const yapiskanCubuk = useHomeStickyBar({ scrollerRef: kok, sentinelRef: sekmeGozcu, headlineRef: baslikBakiye, offsetPx: () => (privacy.active ? 0 : SERIT_PX) })
const yapisti = yapiskanCubuk.stuck
const seritGorunur = yapiskanCubuk.stripShown
const seritHazir = ref(false)
onMounted(() => {
  if (kok.value) seritHazir.value = true
})

// GOZ TERCIHI (kaymak D4): setup'ta bellekten (pageStore) senkron; bellek bossa (ilk kurulum) gorunur baslar ve
// onMounted'daki depo okumasi hem burayi hem bellegi animasyonsuz yazar.
const isBalanceVisible = ref(page.balanceVisible ?? true)
// GOZ GECISI (spec 7.8): YALNIZ goz dugmesine basista ve hareket izniyle acilir. gozAnimasyonu basliktaki
// <Transition>'in css'ini acar (mount'ta ve bellekten gelen degerde gecis yok); gozDegis diger degerlere
// (hap, satir degeri, miktar) gecici kSwap sinifini verir. Ikisi GOZ_DEGIS_MS sonra kapanir: 10 sn
// yenilemesi sinifi yeniden tetiklemez, ogede kalici filter kalmaz.
const GOZ_DEGIS_MS = 220
const gozAnimasyonu = ref(false)
const gozDegis = ref(false)
const gozDegisSinifi = computed(() => (gozDegis.value ? 'kaymak-kswap' : ''))
let gozZamanlayici = null
const gozDurdur = () => {
  if (gozZamanlayici !== null) clearTimeout(gozZamanlayici)
  gozZamanlayici = null
}
const currentTokens = ref(null)
// SPL/SOL bakiye okumasi basarisiz oldu mu (Gorev 19, final cuzdan-istemci-1): useSolanaAssets dizisinin `splFailed` / `solFailed` ozelligi. Her bakiye turunda yeniden yazilir;
// Solana kapsamda degilse / okunamadiysa (rows null) false: "okunamadi" kendi `error` isaretiyle gosterilir, bu bant yalniz
// "Solana okundu AMA SPL kismi dusmus" durumu icindir.
const solanaSplFailed = ref(false)
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

// Satir logosu (YALNIZ gizli mod): TEK cozucu privateTokenLogo (ayni hasPrivateLogo testi). Normal modda satir <TokenAvatar> cizer (tokenLogoSources.js).
const rowLogo = (token) => privateTokenLogo({ chainId: token.chainId, address: token.address, symbol: token.symbol })

const displayedTokens = computed(() => {
  if (!currentTokens.value) return []
  let result = currentTokens.value
  if (selectedFilterNetwork.value !== 'all') {
    result = result.filter(t => isSameChainId(t.chainId, selectedFilterNetwork.value))
  }
  // GIZLI MOD: yalniz S'nin satirlari (kapsam cozulemezse hic satir): baska aglarin satirlari listeye girmez.
  if (privacy.active) result = rowsOfChain(result, privateScopeChainId(selectedFilterNetwork.value))
  // GIZLI MOD: logosuz VE kesin sifir bakiyeli satir gizlenir; bakiyesi olan logosuz token gorunur kalir (para gizlenmez, sahip karari 2026-11-03).
  if (privacy.active) result = hideLogolessZeroRows(result, (t) => user.tokenBalances[t.chainId + '_' + t.address])
  // NORMAL MOD: ayni kural. Logosu hic cozulemeyen (ya da tum kaynaklari yuklenemeyen) VE bakiyesi KESIN sifir olan satir gizlenir; bakiyesi olan,
  // bilinmeyen ya da henuz yuklenmemis token logosuz olsa da GORUNUR kalir (satirda notr monogram). Para gizlenmez (sahip karari 2026-11-03).
  else result = hideLogolessZero(result, (t) => user.tokenBalances[t.chainId + '_' + t.address])
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
  // GIZLI MOD: USD yokken bakiye siralamasi anlamsizdir: yerel coin once, sonra sembol A-Z (spec 4.7).
  if (privacy.active) return [...result].sort(comparePrivateRows)
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

// Baslik toplami { prefix, number, suffix }; gecersiz toplam sifir olarak yazilir (hicbir zaman bos/NaN).
const headlineParts = computed(() => partsOrZero(filteredUsd.value))
const headlineSize = computed(() => {
  const { prefix, number, suffix } = headlineParts.value
  return headlineSizeClass((prefix + number + suffix).length)
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

// KAYMAK G7: sayan degerler (spec 7.6, K6, K7). Sayilan ara deger YALNIZ CountingText
// yapraginda yasar; buradaki hicbir hesap onu okumaz (Max, limit, dogrulama canli degeri okur).
// Blok BILEREK filteredUsd/filteredPercentageInfo'dan SONRA: toplam kimligi onlari okur.
//
// listeHazir: ilk `loadCurrentTokens()` donene kadar false. `currentTokens` Home'un yerel
// ref'i ve her yeniden kurulumda sifirlaniyor; ag suzgeci seciliyken 24 sa hapi once 0
// oluyor. Kimlikte durdugu icin liste hazir olana kadar deger animasyonsuz yazilir, her
// donuste 0'dan sayma olmaz (Ek, insaatci notu 2).
const listeHazir = ref(false)
// toplamHesabi: toplamlar (user.usd, percentage, percentageUSD) en son HANGI HESAP icin bir
// okuma turundan (updateBalance tur sonu, applySolanaRows) ya da oturum onbelleginden yazildi.
// Hesap degisimindeki sifirlama toplamlari 0'a ceker ama yazilmis SAYMAZ; isareti de null'a ceker
// (A -> B -> A: B'nin turu bitmeden A'ya donulurse A'nin eski isareti gecerli kalmasin); satir yer tutuculari
// da saymaz (TON kolu `{}`'ini turun basinda, toplamlardan saniyeler once yazar). Sozlukte
// anahtar olmasi bu yuzden yetmez: hap 0.00%'dan sayardi (G7 inceleme). Yerel ref: yeniden
// kurulumda null baslar, o ilk turun toplami sayilmaz (K6, yeniden kurulumda gosteri yok).
const toplamHesabi = ref(null)
const toplamOkundu = computed(() => user.balancesAccountKey !== null && toplamHesabi.value === user.balancesAccountKey)
// HESAP DEGISIMI: yeni hesabin toplami okunana kadar YANLIS $0.00 yerine yukleme cubugu, tur bitip hicbir sey
// okunamadiysa tire. Store isareti (yeniden kurulumda kalir): token sayfasindan donuste cubuk gorunmez.
const toplamDurumu = computed(() => {
  const k = user.balancesAccountKey
  if (k !== null && user.totalsReadFor === k) return 'okundu'
  if (k !== null && user.totalsFailedFor === k) return 'okunamadi'
  return 'bekleniyor'
})
// Satir henuz okunmadi (kayit yok ya da miktar yok, hata da yok): miktar/deger/degisim yerine yukleme cubugu.
const satirOkunmadi = (token) => {
  const b = user.tokenBalances[token.chainId + '_' + token.address]
  return !b || (!b.error && (b.amount === undefined || b.amount === null))
}
// Kimlik degisince sayma yok, deger aninda atlar: baska hesabin, gizli modun, baska para
// biriminin ya da dilin rakami yeni ekranda yarim saniye gorunmez (anti-hedef).
//
// Taban (satir degerinin kimligi): `okumaVar` burada "sozluk dolu". Satir icin yeter: yer
// tutucu ya da sifirlanmis satirin degeri zaten null'dir, null'dan sayiya gecis sayilmaz.
const sayacKimlikTabani = computed(() => {
  const okumaVar = user.balancesAccountKey !== null && Object.keys(user.tokenBalances).length > 0
  return [
    user.balancesAccountKey,
    privacy.active,
    currency.display.code,
    currency.display.fellBack,
    locale.value,
    scope.filter,
    listeHazir.value,
    okumaVar,
    page.firstLoadDone,
  ].join('|')
})
// Toplam kimligi (24 sa hapi; G8 baslik, G11 serit): taban + toplamin okunma durumu. Toplam bu
// hesap icin henuz okunmadiysa son parca degerlerin KENDISIDIR: her degisim kimligi de
// degistirir, deger aninda yazilir. Sabit bir "okunmadi" parcasi yetmezdi: suzgec seciliyken
// toplam satirlardan turer, satirlar tur icinde tek tek dolar ve hap 0'dan kismi toplamlara sayardi.
const sayacKimligi = computed(() => sayacKimlikTabani.value + '|' + (toplamOkundu.value
  ? 'okundu'
  : 'okunmadi:' + [filteredUsd.value, filteredPercentageInfo.value.pct, filteredPercentageInfo.value.usd].join(',')))
const satirSayacKimligi = (token) => sayacKimlikTabani.value + '|' + token.chainId + '_' + token.address
// Sayilabilir hedef: sonlu sayiysa kendisi, degilse null (null'dan ya da null'a gecis animasyonsuz).
const sayilabilir = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null)
// Satir degeri yalniz gorunur, hatasiz ve degeri bilinen satirda sayar; aksi halde metin
// ('—', '****', bos degerin sifiri) aninda yazilir.
const satirSayacDegeri = (token) => {
  if (!isBalanceVisible.value) return null
  const b = user.tokenBalances[token.chainId + '_' + token.address]
  if (!b || b.error || b.valueUnknown) return null
  return sayilabilir(b.value)
}
// Kararli bicim fonksiyonu: sablonda satir ici ok fonksiyonu her cizimde yeni prop olur
// ve yapragi da yeniden cizerdi.
const yuzdeBicim = (n) => n.toFixed(2) + '%'

// KAYMAK G13: kaydirma hafizasi (spec 7.10, K2, H10). Bilesen her donuste yeniden kurulur (KeepAlive yok); kalinan
// yer onBeforeUnmount'ta pageStore'a (yalniz bellek) yazilir, kurulunca anahtar ve sekme tutarsa geri yuklenir.
// Anahtar hesap | gizli mod | kapsam; sinir yapiskan sinir (normalde serit + sekme satiri, gizlide yalniz sekme
// satiri). Varliklar listesi ilk tur bitince (listeHazir) en fazla 150 ms beklenir; Hisseler katalogdan senkron.
// Geri yuklemeden sonra serit ve yapisma bir kez senkron hesaplanir. Varlik listesi bellekte tutulmaz (D6).
// satirAnahtari: satirin `data-row-key`'i; tokenBucketKey bicimi (adres kucultulmez). Zincir kimligi
// normalizeBucketChainId'den gecer: App'in secili token anahtari (selected_token_ref.chainId de oyle yazilir) ile
// ayni bicim; ham `token.chainId + '_'` '0x38' gibi bir kimlikte eslesmezdi. Hisse satirinin anahtari stock.key.
const satirAnahtari = (token) => tokenBucketKey(normalizeBucketChainId(token.chainId), token.address)
const kaydirma = useHomeScrollMemory({
  scrollerRef: kok,
  page,
  key: () => scrollKey({ accountKey: user.balancesAccountKey, privateMode: privacy.active, scope: scope.filter }),
  tab: () => gorunenSekme.value,
  boundary: () => (privacy.active ? 0 : SERIT_PX) + (sekmeSatiri.value?.offsetHeight ?? 0),
  listReady: listeHazir,
  onRestored: () => yapiskanCubuk.recompute(),
})
// KAYMAK G15 (spec 7.5, H7): geri simge ucusu Home'un konumu oturunca baslar. App saglar; App disinda (testler) null.
// settled false (bekleme doldu, kullanici once davrandi, SSR) ise denetleyici bekleyen ucusu iptal eder.
const ucus = inject('kaymakUcus', null)
kaydirma.settled.then((ok) => ucus?.homeReady(ok))

let currentRequestId = 0
let currentProvider = null

const toggleBalanceVisibility = () => {
  // Gecis izni ters cevirmeden ONCE kurulur: ayni cizimde <Transition> css'i acik gorur.
  const izin = motionAllowed()
  gozDurdur()
  gozAnimasyonu.value = izin
  gozDegis.value = izin
  if (izin) {
    gozZamanlayici = setTimeout(() => {
      gozZamanlayici = null
      gozAnimasyonu.value = false
      gozDegis.value = false
    }, GOZ_DEGIS_MS)
  }
  isBalanceVisible.value = !isBalanceVisible.value
  page.balanceVisible = isBalanceVisible.value
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

// Gizli modun paketli logosu yuklenemezse (dosya her zaman pakette; savunma): gizli modun kendi yedek simgesi. Normal mod satirlari TokenAvatar'dir.
const handleImageError = (event) => {
  event.target.src = UNKNOWN_TOKEN_LOGO
}

// Zincir rozeti bir TOKEN logosu degildir (yerel /chains dosyasi): yuklenemezse rozet cizilmez, gri yer tutucu cizilmez.
const hideBrokenImage = (event) => {
  event.target.style.display = 'none'
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

// Bu yuklemede onbellekten boyandi mi (kapi canli turu beklemeden acilsin).
let hydratedFromSnapshot = false

const loadCurrentTokens = async () => {
  try {
    const { active_account: seedAccount } = await chrome.storage.local.get('active_account')

    // BAYAT DURUM, SUNUCU BEKLENMEDEN ONCE TEMIZLENIR (gizli mod: merge inceleme I1).
    //
    // `ensureDefaultTokens` en fazla 8 sn bekler. Hesap degistiyse (ozellikle Normal <-> Gizli
    // gecisi) o sure boyunca ekranda ONCEKI hesabin satirlari, bakiyeleri ve toplami YENI
    // hesabin kabugu altinda kalirdi: Gizli'ye girerken genel hesabin varliklari gizli
    // ekranda, Gizli'den cikarken Gizli Hesabin satirlari ve toplami HERKESE ACIK ana ekranda.
    // Asagidaki (liste kurulduktan sonraki) sifirlama ayni kosulu kullanir; bu, onu bekleme
    // oncesine de tasir. `null` (ilk yukleme) silme degildir -- gerekce asagida.
    if (user.balancesAccountKey !== null && user.balancesAccountKey !== seedAccount.key) {
      currentTokens.value = []
      evmImportedTokens.value = []
      activeAccount.value = seedAccount
      user.tokenBalances = {}
      user.usd = 0
      user.percentage = 0
      user.percentageUSD = 0
      user.balancesAccountKey = seedAccount.key
      // KAYMAK G7: sifirlanan toplam OKUNMUS sayilmaz; bu hesabin ONCEKI okumasi da gecersiz
      // (A -> B -> A hizli donusunde bayat isaret hap'i 0'dan saydirirdi).
      toplamHesabi.value = null
      user.totalsReadFor = null
      user.totalsFailedFor = null
    }

    // SON BILINEN DEGER (oturum onbellegi): sozluk BOSSA ve gizli degilse onceki oturumdaki tam turun degeri
    // ilk boyamada gorunur, canli tur sessizce uzerine yazar. Anahtar hesap + ag + para birimi; baska hesabin
    // degeri gelmez. Kapi liste kurulduktan sonra (bu fonksiyonun sonunda) acilir. Yalniz GOSTERIM: islem
    // dogrulamalari bu sozlugu kullanmaz, canli okur.
    const onbellektenBoyandi = await hydrateBalanceSnapshot(user, {
      accountKey: seedAccount.key,
      chainId: network.currentNetwork?.chainId,
      currency: currency.code,
      isPrivate: privateNowOf(seedAccount, privacy.active),
    })
    // KAYMAK G7: onbellekteki toplam bu hesabin son TAM turudur, sayac icin okunmus sayilir (canli tur
    // ondan sayarak gelir). Bekleme sirasinda baska bir yukleme hesabi degistirdiyse isaretlenmez.
    if (onbellektenBoyandi && user.balancesAccountKey === seedAccount.key) {
      toplamHesabi.value = seedAccount.key
      user.totalsReadFor = seedAccount.key
    }
    hydratedFromSnapshot = onbellektenBoyandi || hydratedFromSnapshot

    // VARSAYILAN TOKENLAR (ETH+USDT / ATS+BNB), TON tohumundan ONCE.
    //
    // Eskiden yalniz App.vue acilisinda tohumlaniyordu ve asagidaki
    // ensureTonNativeToken bos kovayi `{'-239':[GRAM]}` olarak YARATIP diske
    // yazinca acilistaki `!imported_tokens[hesap]` kapisi kalici kapaniyordu: import
    // edilen cuzdanda hic token gelmiyordu (cumle importunda yalniz GRAM, ozel
    // anahtar importunda -- TON satiri EVM-only hesapta suzuldugu icin -- SIFIR satir).
    // Yan panelde App yeniden kurulmadigi icin acilis tohumu import sonrasi zaten
    // calismaz. Kural tek yerde (utils/defaultTokenSeed.js): saglikli kovada ag
    // istegi yoktur; basarisizlikta HICBIR sey yazilmaz ve sonraki yukleme tekrar dener.
    //
    // GIZLI MOD (gizli-mod cok-ag spec 4.7, P12): Gizli Hesap'in tohumu YEREL yazilir ({'56': [BNB, USDC, ATS]}; ag
    // istegi YOK, Ethereum tohumu YOK). Karar DEPODAN taze okunan aktif hesaptan verilir (hesap tabanli kimlik; popup'in
    // gizlilik store'u da bunu turetir): store, user.address izleyicisinin gerisinde kalabilir (gizlilik senkronu ayri bir
    // storage.onChanged dinleyicisidir), o yuzden girista Gizli hesaba sunucu/TON tohumu, cikista genel hesaba yerel BSC
    // tohumu yazilmasin diye store'a degil hesaba bakilir. Okunabilir hesap yoksa store'a dusulur. Karar bu yuklemenin
    // basinda BIR KEZ verilir: bekleme sirasinda hesap degisirse user.address yuklemeyi zaten yeniden baslatir.
    const privateActive = privateNowOf(seedAccount, privacy.active)
    if (privateActive) await ensurePrivateDefaultTokens(seedAccount.key)
    else await ensureDefaultTokens(seedAccount.key)

    // TAZE okuma: yukaridaki cagri kovayi yazmis olabilir ve sunucu beklenirken (en fazla
    // 8 sn) kullanici HESAP DEGISTIRMIS olabilir -- bu yuzden hesap da yeniden okunur ve
    // liste ANLIK aktif hesaptan kurulur (eski hesabin satirlari yeni hesabin adresiyle
    // okunurdu). `imported_tokens` depoda HIC olmayabilir (Sifirla / Forgot password
    // sonrasi): `?.` olmadan TypeError atar, catch listeyi sessizce [] yapardi.
    const { imported_tokens, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
    let parsed_data = imported_tokens?.[active_account.key] || {}

    // TON satiri hesabin haritasina bir kez yazilir; sonrasinda diger tokenlar gibi
    // yonetilir (SearchTokens/ImportToken).
    // GIZLI MOD: TON tohumu uygulanmaz (Gizli Hesap EVM-yalnizdir; kovaya '-239' yazmak anlamsiz).
    const seeded = privateActive ? { changed: false, byChain: parsed_data } : ensureTonNativeToken(parsed_data)
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
    
    // GIZLI MOD (spec 4.7 "Home sorgu kumesi"): S'nin yerel coin satiri kovada yoksa URETILIR (Base'e gelen ETH
    // kovada satiri olmasa da gorunur).
    if (privateActive) {
      // Store geride kalmissa (hesap Gizli, privacy.active henuz false) kapsam hala ham 'all' olabilir: S ayni kuralla
      // (ham all -> etkin ag) burada da turetilir; store ozel moddaysa islem degistirmez (idempotent).
      const scopeChainId = privateScopeChainId(privateModeScope(scope.filter, network.currentNetwork?.chainId))
      allTokens = withScopeNativeRow(allTokens, scopeChainId)
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
      // KAYMAK G7: yukaridaki sifirlamayla ayni kural (bekleme sirasinda hesap degisti).
      toplamHesabi.value = null
      user.totalsReadFor = null
      user.totalsFailedFor = null
    }
    user.balancesAccountKey = active_account.key

    // Onbellekten boyanan ekran YARIM degildir (son TAM turun toplami + satirlari); liste de kuruldu.
    // Ilk yukleme kapisi canli turu beklemez. Onbellek yoksa kapi eskisi gibi tur bitince acilir.
    if (hydratedFromSnapshot) firstLoadGate.open()
  } catch (error) {
    console.error('Token yükleme hatası:', error)
    evmImportedTokens.value = []
    currentTokens.value = []
  }
}

const getTokensData = async() => {
  // GIZLI MOD (gizli-mod cok-ag spec 4.7 satir 2): fiyat istegi token kimliklerini ve IP'yi ana API'ye gonderir; ozel
  // modda HIC atilmaz. Fiyat tablosu bos kalir: satirlar fiyatsiz, toplam yazilmaz (updateBalance `tokensData`yi okur).
  // Karar depodaki hesaptan her cagrida taze okunur (PF-DD11): store geride kalsa da Gizli adresin token kimlikleri gitmez.
  if (await readPrivateNow(privacy.active)) {
    tokensData.value = []
    return
  }
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
// cagrisinda gelir (asagidaki loadBStockPrices). Mevcut portfoyle BIRLESTIRILMEZ:
// sunucunun MAX_TOKEN_IDS (250) tavani asilirsa fazla kimlik SESSIZCE kirpilir
// (400 donmez), yani birlestirmek hisse satirlarini fiyatsiz birakabilirdi. Tek
// cagri bStocks + xStocks kimliklerinin tamamini tasir (tekrarsiz, 250 tavaninin cok altinda).
//
// AD NOTU: `bStock*` adlari bStocks doneminden kaldi (testler bunlara bagli); artik
// iki ihracciyi (bStocks + xStocks) birden yonetirler.
const bStockPrices = ref([])

// Son fiyat DENEMESININ ani -- basarili ya da degil. Kaynak etiketinin saati
// budur (bkz. stocksAtlasPriced): istek dustugunde de ilerler, boylece eldeki
// fiyat 10 dakikayi gecince "Atlas" satiri kendiliginden kaybolur.
const bStockPricesCheckedAt = ref(Date.now())

// AYNI YUKLEME UST USTE tetiklenirse (sekmeye hizlica birkac kez tiklamak
// gibi) TEK bir cagriya indirgenir -- ikinci cagri birinciyi BEKLER.
let bStocksLoadPromise = null

// Hesap degisim sayaci (T16-GAP-5): uctaki bir okuma hesap DEGISMEDEN once baslamissa sonucu
// ESKI hesaba aittir; ne ekrana yazilir ne de yeni hesabin kovasina tohumlanir.
let stockAccountGen = 0


// (stockBalances / balancesLoaded: yukarida, listedGroups ile birlikte tanimli.)

// Satir kaydi: katalog satiri (chainId tasir) ya da bStocks KATALOG kaydi (chainId
// tasimaz, zincir BSC). openStock ve fiyat metni iki bicimi de kabul eder.
const stockRowOf = (stock) => (stock ? stockEntry(stock.chainId ?? BSTOCKS_CHAIN_ID, stock.address) : null)

// Sunucudaki fiyat kaydi (coingecko_id ile).
// LCX satiri katalog kimligi tasimaz (coingeckoId null): CoinGecko kaydi yok, fiyat satirin kendi priceUsd'si (stockPriceText).
const stockRecordOf = (row) => (row.coingeckoId == null
  ? null
  : (bStockPrices.value || []).find(d => d.coingecko_id === row.coingeckoId) || null)

// Carpan: once bu turun Multicall sonucu, yoksa 60 sn'lik bellek onbellegi (Varliklar doldurmus olabilir).
const stockMultiplierOf = (row) =>
  stockBalances.value[stockKey(row.chainId, row.address)]?.multiplier ?? multiplierFor(row.chainId, row.address)

// Katalog kaydi -> fiyat/degisim. Fiyat henuz gelmediyse (ilk render, ya da cagri
// basarisiz oldu) `null` doner; sablon bunu tire / gizli degisime dusurur --
// UYDURMA bir deger degil, "henuz bilinmiyor" durumu. `priceUSD` HAM sunucu
// fiyatidir; GOSTERILEN fiyat icin bStockFiyatMetni (xStocks'ta carpana bolunur).
const bStockMarketData = (stock) => {
  const row = stockRowOf(stock)
  // LCX satirinin 24 sa degisimi yok (sunucu yalniz priceUsd verir): satir fiyat gosterir, degisim yuzdesi CIZILMEZ.
  // Fiyat metni bStockFiyatMetni'nde (row.priceUsd).
  if (row?.source === 'lcx') return null
  const data = row ? stockRecordOf(row) : null
  if (!data?.market_data) return null
  return { priceUSD: data.market_data.priceUSD, change: data.market_data.change?.h24 }
}

// Fiyat metni SABLONDA degil BURADA kurulur: sablonda para birimi sembolunu bir
// ifadeye birlestirmek gerekiyordu ve veri yokken sifir bicimi donuyor -- yani
// sablon "$0.00" yazip fiyati SIFIR gibi gosteriyordu. Karar
// utils/stocksTab.js stockPriceText'te: bStocks eski davranis, xStocks carpana
// bolunur, carpan bilinmiyorsa tire; tutar secili birimde `money` ile yazilir.
const bStockFiyatMetni = (stock) => {
  const row = stockRowOf(stock)
  if (!row) return UNKNOWN_TEXT
  return stockPriceText({ row, record: stockRecordOf(row), multiplier: stockMultiplierOf(row), money })
}

// Sirket satirinin TOPLAM adedi (ayni zincirdeki tum secenekler) ve TK6 temsilcisi.
const companyBalanceLabel = (company) => companyBalanceText({ company, balances: stockBalances.value })
const stockValueOf = () => companyValueOf({
  balances: stockBalances.value,
  recordOf: stockRecordOf,
  multiplierOf: stockMultiplierOf,
})
const companyRepresentative = (company) => pickRepresentative(company, stockValueOf())

// Satir logosu: bStocks katalog gorseli; xStocks icin sunucu fiyat kaydindaki CoinGecko `image`
// nesnesi (logo katalogda tutulmaz: ihracci kullanim sartlari md. 6). Hicbiri yoksa null:
// sablon sembol harfi cizer.
// Satir `stock.logoRow` verir; TokenAvatar logo yoksa/yuklenemezse tickerin ilk harfini cizer (satir hep gorunur).
const stockLogoToken = (stock) => {
  const row = stock.logoRow
  return { symbol: stock.ticker, name: stock.name, image: row?.image ?? (row ? stockRecordOf(row)?.image : null) ?? null }
}

const chainNameOf = (chainId) => chains.find(c => isSameChainId(c.chainId, chainId))?.name || String(chainId)

// "Fiyat: Atlas Oracle" satiri. Kural utils/priceSource.js'te -- Token.vue ile
// TEK kaynak, iki ekran ayni hisse icin farkli sey soylemesin.
//
// "EN AZ BIRI", "HEPSI" DEGIL: GMEB ve HIMSB Atlas'ta yok ve hep CoinGecko'dan
// gelir (spec 2.2); "hepsi Atlas" sarti satiri HIC gostermezdi.
//
// Saat olarak Date.now() DEGIL bStockPricesCheckedAt: computed onbellekli
// oldugu icin icindeki Date.now() yalnizca veri degisince yeniden okunurdu.
// Fiyat istegi dusmeye baslarsa veri DEGISMEZ ve etiket bayat fiyatin ustunde
// sonsuza kadar kalirdi; deneme ani ise her denemede ilerler.
const stocksAtlasPriced = computed(() =>
  (bStockPrices.value || []).some(record => isAtlasPriced(record, bStockPricesCheckedAt.value)))

// YALNIZCA sifirdan buyuk bakiyeli hisseler ilgili zincirin kovasina eklenir --
// boylece Varliklar sekmesinde de gorunurler (spec gerekcesi: "kesif gorunumu,
// kovaya YAZMA degil" -- ama SAHIP OLUNAN bir hisse artik Varliklar'da GORUNMELI).
// Kovada ZATEN olan kayit TEKRAR eklenmez. xStock logosu katalogda yok: sunucu
// fiyat kaydindaki CoinGecko gorselinden alinir (planSeed imageOf).
const seedOwnedStocks = async (owned) => {
  // GIZLI MOD (P13): Hisseler sekmesi yok; bakiyeden Gizli kovaya hisse satiri tohumlanmaz.
  if (owned.length === 0) return

  const { imported_tokens, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
  if (privateNowOf(active_account, privacy.active)) return
  const byAccount = imported_tokens?.[active_account.key] || {}

  // VARSAYILANLAR ONCE. Hisse bakiyesi zincir RPC'sinden gelir, kendi API'mizden DEGIL: varsayilan
  // istegi basarisizken (ya da hala yoldayken) hasarli bir kovaya `'56': [hisse]` yazmak
  // `bucketNeedsDefaults`i sonsuza dek "saglikli" yapar ve ETH/USDT/ATS/BNB HIC gelmez; yavas ama
  // basarili durumda da "mevcut kazanir" birlestirmesi hisse-yalniz '56'yi korur, ATS/BNB kaybolur.
  // Bu yuzden kova varsayilan bekliyorsa zincir anahtari YARATILMAZ; hisse satiri varsayilanlar
  // yazildiktan SONRAKI hisse yuklemesinde (sekme acilisi / yeniden mount) eklenir.
  if (bucketNeedsDefaults(byAccount)) return

  const additions = planSeed({ owned, bucket: byAccount, imageOf: (row) => stockRecordOf(row)?.image })
  const chainKeys = Object.keys(additions)
  if (chainKeys.length === 0) return

  const nextAccount = { ...byAccount }
  for (const chainKey of chainKeys) nextAccount[chainKey] = [...(byAccount[chainKey] || []), ...additions[chainKey]]

  await chrome.storage.local.set({
    imported_tokens: { ...imported_tokens, [active_account.key]: nextAccount },
  })

  // Varliklar sekmesi de gorsun diye TAZELE: interval yalniz updateBalance'i
  // tekrarlar, loadCurrentTokens'i DEGIL -- tazelemeden yeni satir bir sonraki
  // hesap/ag degisimine kadar gorunmezdi.
  await loadCurrentTokens()
  await updateBalance()
}

// LCX SATIRLARI (Bolum 2): once depo (ag yok), sonra 60 sn'den bayatsa /lcx/stocks. Karar utils/stocksTab.js syncLcxStockRows'ta:
// bayrak kapaliyken ya da gizli modda (depodaki hesap, PF-DD11) hicbir sey yapmaz; HIC firlatmaz. Satirlar modul durumunda
// oldugundan her adimdan sonra lcxRowsRev artar (stockGroups yeniden kurulur). Sekme acilisi (loadBStockData) ve 60 sn'lik
// tazeleme (refreshStocks) ayni fonksiyonu kullanir; fiyat ve bakiye BUNDAN sonra gruplari gorur.
const loadLcxRows = () => syncLcxStockRows({
  enabled: LCX_ENABLED,
  isPrivate: () => readPrivateNow(privacy.active),
  onRows: () => { lcxRowsRev.value += 1 },
})

// Hisselerin YALNIZCA FIYATI -- sekme acilisinda (loadBStockData) ve 60 sn'lik
// tazelemede (stocksRefresher) AYNI fonksiyon. Iki kopya olsaydi biri kontrol
// anini (bStockPricesCheckedAt) yazmayi unuttugu gun kaynak etiketi sessizce
// bayat kalirdi.
//
// Hata YUTULUR ve eldeki fiyatlar SILINMEZ: gecici bir ag hatasi satirlari
// fiyatsiz gosterime (bStockFiyatMetni'nin tire isareti) cevirmemeli. Kontrol
// ani HER DURUMDA ilerler (finally), boylece istek uzun sure duserse eldeki
// "Atlas" fiyati 10 dakika sonra etiketsiz kalir.
const loadBStockPrices = async () => {
  try {
    // GIZLI MOD (P13, spec 4.7 satir 2): hisse fiyat istegi ozel modda HIC atilmaz (token kimlikleri ve IP ana API'ye gitmez).
    if (await readPrivateNow(privacy.active)) return
    const ids = collectStockIds(stockGroups.value)
    if (ids.length === 0) return

    // 10 sn zaman asimi (findings F6): axios timeout OLMADAN takilan bir istek
    // stocksRefresh'in inFlight bayragini kalici tutardi -- 60 sn'lik tazeleme
    // sonsuza kadar bloke olurdu.
    const priceResp = await axios.post(config.api + '/getTokensDataById', { ids }, { timeout: 10000 })
    if (priceResp.status === 200) bStockPrices.value = priceResp.data.tokens
  } catch (priceError) {
    console.error('bStocks fiyat verisi alinamadi:', priceError)
  } finally {
    bStockPricesCheckedAt.value = Date.now()
  }
}

// Her satir KENDI zincirinin ucundan okunur: aktif ag ne olursa olsun, `network.rpc`
// KULLANILMAZ (o kullanicinin O ANKI aktif agina aittir, satirin zincirine degil).
const stockRpcFor = (chainId) => rpcUrlsOf(chains.find(c => isSameChainId(c.chainId, chainId)))[0] || null

// BAKIYE + CARPAN: zincir basina TEK Multicall3, uc zincir PARALEL (utils/stocksTab.js).
// Bir zincir dusunce yalniz o zincirin satirlari tire olur; loadGroupBalances reddetmez.
const loadStockBalances = async (owner) => {
  const gen = stockAccountGen
  const balances = await loadGroupBalances({ owner, groups: stockGroups.value, rpcFor: stockRpcFor })
  // Okuma sirasinda hesap degistiyse sonuc eski hesaba aittir: ekrana YAZILMAZ.
  if (gen === stockAccountGen) stockBalances.value = balances
  return balances
}

// HISSELER sekmesi acildiginda CAGRILIR -- ana ekranin 10 saniyelik dongusune
// BAGLANMAZ (kullanici karari, Task 9 brief): bakiye okumasi zincir basina bir
// Multicall3 olsa da surekli tekrari gereksizdir.
//
// Bakiye okuma KARARI hasUiMultiplier'a baglidir ve useTokenBalance ile AYNIDIR
// (stockBalances.js basligi): bStocks balanceOfUI, xStocks balanceOf.
const loadBStockData = () => {
  if (bStocksLoadPromise) return bStocksLoadPromise

  const gen = stockAccountGen
  const pending = (async () => {
    try {
      const { active_account } = await chrome.storage.local.get('active_account')
      // GIZLI MOD (P13, spec 4.7 satir 2 ve 11): Hisseler sekmesi ozel modda yoktur. Cagiran (onUserAddressChanged) modu
      // user.address degisiminde, privacy.active guncellenmeden once okumus olabilir; gorunurluk (hesap kapisi VE
      // depodaki hesap Gizli degil, PF-DD11) bu yuzden burada, ilk bekleme SONRASI taze okunan hesaptan verilir.
      if (!active_account?.address || !stocksAvailable.value || privateNowOf(active_account, privacy.active)) return

      // LCX satirlari fiyat istegiyle PARALEL gelir (depo, sonra en cok 4 sn'lik ag); bakiye okumasi gruplari satirlar GELDIKTEN
      // sonra gorur (LCX gruplari da okunsun). loadLcxRows firlatmaz ve bayrak kapaliyken bir sey yapmaz.
      const lcxRows = loadLcxRows()

      // FIYAT: AYRI cagri (bkz. bStockPrices tanimindaki MAX_TOKEN_IDS notu).
      await loadBStockPrices()
      await lcxRows
      if (await readPrivateNow(privacy.active)) return

      const balances = await loadStockBalances(active_account.address)
      // Hesap bu arada degistiyse ESKI hesabin bakiyesi yeni hesabin kovasina tohumlanmaz.
      if (gen !== stockAccountGen) return
      // Bos durum ve tutulan-hisse satiri bakiye gelince acilir; tohum yazimini (storage) beklemez.
      balancesLoaded.value = true
      // Tohum SUZULMUS listeden DEGIL tam katalogdan (K35): uygun olmayan ihraccinin tutulan hissesi de Varliklar'a girer.
      await seedOwnedStocks(ownedRows(stockGroups.value, balances))
    } catch (error) {
      console.error('bStocks verisi yuklenemedi:', error)
    } finally {
      // Hesap degisiminde yeni yukleme baslamis olabilir: onun sozunu silme.
      if (bStocksLoadPromise === pending) bStocksLoadPromise = null
    }
  })()
  bStocksLoadPromise = pending

  return pending
}

// Sekme dugmesinin cagirdigi TEK giris noktasi: sekmeyi acar VE (yalnizca bu
// aninda) bakiye/fiyat yuklemesini baslatir.
const openStocksTab = () => {
  // Yalniz sablon tiklamasi sayilir (onMounted dogrudan loadBStockData cagirir).
  requestAnalyticsCount('screen', { key: 'homeStocks' })
  sekmeSec('stocks')
  loadBStockData()
}

// HISSELER TAZELEME (spec 5.7): panel ACIKKEN fiyat 60 sn'de bir yeniden istenir ve
// (ESKI KURALIN DEGISIKLIGI) bakiye + xStocks carpani da yenilenir: zincir basina TEK
// Multicall3 oldugundan ucuz, "carpan degisince bakiye dogru gorunur" olcutu acik
// sekmede de saglanir. Zamanlama ve sekme izleme utils/stocksRefresh.js'te.
const refreshStocks = async () => {
  // GIZLI MOD (P13): tazeleyici yalniz gorunur Hisseler panelinde calisir (ozel modda panel yok); mod tur ORTASINDA
  // degisirse bile Gizli adresin hisse bakiyesi okunmaz.
  if (await readPrivateNow(privacy.active)) return
  const lcxRows = loadLcxRows()
  await loadBStockPrices()
  await lcxRows
  const { active_account } = await chrome.storage.local.get('active_account')
  if (active_account?.address && !privateNowOf(active_account, privacy.active)) await loadStockBalances(active_account.address)
}

// Olcut `gorunenSekme`, `activeTab` DEGIL: hatirlanan sekme 'stocks' iken hesap
// hicbir hisse zincirini tutamiyorsa panel cizilmez; kimsenin gormedigi bir liste
// icin dakikada bir istek atmak bosuna (onMounted'daki ayni olcut).
//
// Baslatma (kurulum ani dahil: token detayindan donus), durdurma (sekme
// degisimi ya da hesap kapisi) ve sokulmede temizleme yardimcinin ICINDE; bu
// yuzden onMounted/onUnmounted'a ayrica bir satir EKLENMEDI.
const stocksRefresher = useStocksRefresh({
  visible: () => gorunenSekme.value === 'stocks',
  refresh: refreshStocks,
})

// HISSE DETAYI. `selectToken` ile AYNI sozlesme -- Token.vue kaydi
// `selected_token_ref`ten okur ve `id` ile `selected_token_id` tutmazsa
// kaydi BAYAT sayip duser (Token.vue pickedRef).
//
// Zincir SATIRDAN gelir (xStocks ayni adresi uc zincirde tasir; bStocks KATALOG kaydi
// chainId tasimaz ve zincir BSC'dir, 56). Satirin zinciri aktif agdan farkli olsa bile cuzdanin
// AKTIF AGI DEGISMEZ (kullanici karari 2026-10-23; eski K3 gecisi ve 2026-10-11 bayrak ayrimi kalkti):
// yalniz hisse kimligi (chainId dahil) yazilir; Al/Sat teklifi, bakiyesi ve emri hissenin zincirinden calisir.
//
// `decimals` ve `symbol` de tasinir: kanonik kayit (/getTokenDataById) ondalik
// DONDURMUYOR ve kayit hic cozulemezse (ag hatasi) ekran kimligi YALNIZCA bu
// nesneden okuyabilir.
const openStock = (stock) => {
  if (stockChipChoice.value === null) stockChipChoice.value = stockChipSelected.value
  // Sirket satiri (options) -> TK6 temsilcisi; duz katalog satiri aynen kabul edilir.
  const picked = Array.isArray(stock?.options) ? companyRepresentative(stock) : stock
  const row = stockRowOf(picked) ?? picked
  const chainId = row.chainId ?? BSTOCKS_CHAIN_ID
  // LCX satiri katalog kimligi tasimaz: null (undefined degil; Token / StockDetail kimlik yoklugunu null ile okur).
  const id = row.coingeckoId ?? row.coingecko_id ?? null

  crypto.selected_token_ref = {
    id,
    chainId,
    address: row.address,
    decimals: row.decimals,
    symbol: row.symbol,
  }
  crypto.selected_token_id = id
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
  // GIZLI MOD (PF-DD11): Gizli Hesap EVM-yalnizdir; Solana adresi istenmez, Solana RPC'sine gidilmez (okunamadi sayilir).
  if (privateNowOf(active_account, privacy.active)) return null
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

// K4: DEGERI bilinmeyen xStock satiri (carpan okunamadi YA DA sunucuda fiyat kaydi yok): miktar gorunur,
// deger tire (`valueUnknown`), satir toplamlara KATILMAZ. UYDURMA 0 da ham fiyat da YAZILMAZ.
const markValueUnknown = (row) => {
  row.valueUnknown = true
  delete row.price
  delete row.value
  delete row.nowValue
  delete row.oldValue
}

// SPL hata bandindaki "tekrar dene": bakiye turunu bastan kosar (useSolanaAssets'i yeniden cagirir; bant tur sonunda yeniden hesaplanir).
const retrySolanaAssets = async () => {
  await updateBalance()
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
    // GIZLI MODDA da KURULMAZ (spec 9.9): ornek hicbir yerde kullanilmiyor ve ethers surumune gore baglanti acabilir;
    // sifir istek ethers'in davranisina birakilmaz.
    // Mod her turda depodaki hesaptan taze okunur (PF-DD11): kapilarin hepsi (provider, Solana, S kumesi) AYNI karari kullanir.
    const privateNow = await readPrivateNow(privacy.active)
    if (requestId !== currentRequestId) return
    if (!solanaActive && network.rpc && !privateNow) createProvider()
    // Solana turu: Gizli Hesap EVM-yalnizdir (P13); aksi halde aktif ag Solana ise ya da kapsam Solana'yi iceriyorsa.
    const solanaNow = SOLANA_ENABLED && !privateNow && (solanaActive || solanaScopeSelected.value)

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
      if (solanaNow) rows = await loadSolanaRows(requestId)
    } catch (solanaError) {
      console.error('Solana varliklari okunamadi:', solanaError)
    }
    if (requestId !== currentRequestId) return
    // splFailed (SPL okumasi) VEYA solFailed (native SOL okumasi, final cuzdan-istemci-1): ikisi de "Solana okundu ama eksik" demektir.
    solanaSplFailed.value = solanaNow && Array.isArray(rows) && (rows.splFailed === true || rows.solFailed === true)

    // ZINCIRDEN-OKUMA LISTESI HER ZAMAN `evmImportedTokens`: loadCurrentTokens'in
    // yazdigi, ice aktarilmis CAPRAZ ZINCIR kova. `currentTokens.value` BILEREK
    // kullanilmaz -- o, onceki turun Solana satirlariyla BIRLESTIRILMIS halini
    // tasir ve dongu her turda ayni Solana satirlarini yeniden gezerdi.
    // GIZLI MOD: SORGU KUMESI Q = {S} (spec 4.7): bakiye turu yalniz S'nin satirlarini S'nin kendi ilk RPC'sinden okur;
    // baska aglarin satirlari hic sorgulanmaz. S cozulemezse (null) hicbir ag sorgulanmaz (fail-closed).
    const tokens = privateNow
      ? rowsOfChain(evmImportedTokens.value, privateScopeChainId(privateModeScope(scope.filter, network.currentNetwork?.chainId)))
      : (evmImportedTokens.value || [])
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
      user.usd = 0; user.percentage = 0; user.percentageUSD = 0
      // Liste bos: toplam GERCEKTEN 0, okunmus sayilir (yukleme cubugu sonsuza kalmaz).
      toplamHesabi.value = user.balancesAccountKey
      user.totalsReadFor = user.balancesAccountKey
      return
    }

    // getTokensData `currentTokens.value`u okur: BIRLESIMDEN SONRA cagrilir ki
    // SOL'un coingecko_id'si de fiyat istegine girsin (aksi halde satir gorunur,
    // degeri 0 kalir ve toplama katkisi olmaz).
    //
    // PARALEL: fiyat istegi BEKLENMEDEN baslatilir, bakiye okumalari (RPC) onunla ayni anda kosar; ilk yukleme
    // kapisi toplam yerine en uzun olani bekler. SERT KURAL: hicbir satira fiyat gelmeden miktar/deger yazilmaz --
    // her kol bakiyeyi okur, `await pricePromise` ile fiyati bekler, SONRA yazar ve carpar (yarim toplam yok).
    // getTokensData kendi hatasini yutar; yine de atarsa tur eskisi gibi sessizce bitmesin diye burada yakalanir.
    const pricePromise = getTokensData().catch((priceError) => {
      console.error('getTokensData beklenmeyen hata', priceError)
    })

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

    // XSTOCKS (spec 8.2): eksik / eskimis carpanlar zincir basina TEK Multicall3 ile doldurulur (xStock
    // yoksa ag istegi YOK; hata yutulur, carpan bilinmezse satir degeri tire gosterir).
    await ensureMultipliersFor(tokens, {
      rpcFor: (chainId) => rpcUrlsOf(chains.find((c) => isSameChainId(c.chainId, chainId)))[0] || null,
    })
    if (requestId !== currentRequestId) return

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

          // Jetton okumalari native okumayla (ve fiyat istegiyle) AYNI ANDA baslar; sonuclar asagida yazilir.
          const tonChainId = Boolean(network.currentNetwork?.testnet) ? TON_TESTNET_ID : TON_MAINNET_ID
          const jettons = jettonsFromTokens(
            tokens.filter(t => isTon(t.chainId) && t.address !== NATIVE_TOKEN_ADDRESS)
          )
          // PARALEL - Promise.allSettled. getJettonBalance HICBIR HATAYI
          // YUTMUYOR (bkz. jettonBalance.js bas yorumu): Promise.all kullansaydik
          // TEK bir jettonun proxy/adres hatasi TUM listenin sonucunu kaybettirirdi.
          const jettonResultsPromise = jettons.length > 0
            ? Promise.allSettled(jettons.map(async (jetton) => {
              const client = getTonClient(config.api)
              const walletAddress = await getJettonWalletAddress({
                client, owner: tonAddress, master: jetton.master, chainId: tonChainId,
                storage: chrome.storage.local,
              })
              return getJettonBalance({ client, walletAddress, decimals: jetton.decimals })
            }))
            : null

          // Native TON bakiyesi jetton okumasindan BAGIMSIZ basarisizlik yuzeyi:
          // node/proxy TON icin gecici hata verebilir, bu jettonlarin da
          // okunamayacagi anlamina gelmez (ayri get-method cagrilari).
          try {
            const tonAmount = await getTonBalance(getTonClient(config.api), tonAddress)
            await pricePromise

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
          if (jettons.length > 0) {
            const jettonResults = await jettonResultsPromise
            await pricePromise
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
        const chainRpcs = rpcUrlsOf(chainData)
        // YEDEKLI OKUMA (yalniz bu salt-okuma): ilk uc ~1,75 sn icinde yanit vermezse zincirin KENDI listesindeki
        // siradaki uca da ayni okuma baslar, ilk basarili yanit alinir (utils/hedgedRead.js). Satir tek bir kaynaktan
        // okunur, deger karistirilmaz; hepsi basarisizsa ilk ucun hatasi atilir (eski davranis). GIZLI MODDA yedek
        // YOKTUR: adres yalniz S'nin ilk RPC'sine gider (spec 4.7/9.9).
        const readUrls = privateNow || chainRpcs.length < 2 ? [rpcPath] : chainRpcs.slice(0, 3)
        // chainId, rpcPath ile AYNI kaynaktan (satirin kendi zinciri): bStock kolu
        // ancak dogru uctayken acilmali.
        const tokenAmount = await hedgedRead(readUrls, (url) => useTokenBalance(active_account.address, token.address, url, token.chainId))
        await pricePromise
      
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
          // XSTOCKS (spec 8.2): fiyat ve sparkline carpana bolunur; xStock DEGILSE kayit AYNEN doner (eski
          // davranis). Carpan bilinmiyorsa priceUSD 0 olur: miktar gorunur, DEGER tire, toplama katilmaz --
          // UYDURMA 0 da ham CoinGecko fiyati da YAZILMAZ (K4).
          const market = marketForDisplay({
            chainId: token.chainId,
            address: token.address,
            market: token_data.market_data,
            multiplier: multiplierFor(token.chainId, token.address),
          })
          token['market'] = market

          if (isRebasedStock(token.chainId, token.address) && !(market.priceUSD > 0)) {
            user.tokenBalances[tokenKey].change = token_data.market_data.change.h24
            markValueUnknown(user.tokenBalances[tokenKey])
            return
          }
          if (user.tokenBalances[tokenKey].valueUnknown) user.tokenBalances[tokenKey].valueUnknown = false

          user.tokenBalances[tokenKey].price = market.priceUSD
          user.tokenBalances[tokenKey].change = token_data.market_data.change.h24
          user.tokenBalances[tokenKey].value = market.priceUSD * tokenAmount

          const nowValue = market.priceUSD * tokenAmount
          const sparklineVal = market.sparkline?.d7?.[143] || market.priceUSD
          const oldValue = sparklineVal * tokenAmount

          user.tokenBalances[tokenKey].nowValue = nowValue
          user.tokenBalances[tokenKey].oldValue = oldValue

          totalNowValue += nowValue
          totalOldValue += oldValue
          usdBalance += user.tokenBalances[tokenKey].value
        } else if (isRebasedStock(token.chainId, token.address)) {
          // FIN-bilesen-1: /getTokensDataById bulunmayan kimligi SESSIZCE dusurur (seed calismadi / yeni
          // katalog satiri); kayit yoksa `value` hic yazilmaz ve sablon moneyOrZero(undefined) ile
          // sifir tutar ("$0.00") basardi. Kayit varken carpan bilinmeyen dalla AYNI kural: miktar gorunur, DEGER tire.
          markValueUnknown(user.tokenBalances[tokenKey])
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

    // Satirsiz tur (yalniz Solana) dongude fiyati beklemez; applySolanaRows `tokensData`yi okur.
    await pricePromise
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
      // KAYMAK G7: toplam bu hesap icin OKUNDU (ayni esanli blokta: kimlik ve deger birlikte degisir).
      toplamHesabi.value = user.balancesAccountKey
      user.totalsReadFor = user.balancesAccountKey
    } else if (!hasSolanaRows) {
      // Tur bitti, hicbir satir okunamadi: yukleme cubugu yerine tire (sonsuz cubuk yok, uydurma 0 yok).
      user.totalsFailedFor = user.balancesAccountKey
    }

    // SOLANA KAPSAMDA AMA OKUNAMADI: satirlar `error` isaretlenir, UYDURMA 0
    // YAZILMAZ. Yukaridaki toplam Solana'yi zaten ICERMIYOR, yani ekranda "-"
    // gorunen bir satir toplama da katilmaz -- ikisi birbirini yalanlamaz.
    if (solanaNow && !rows) markSolanaRowsUnread()

    // Solana satirlari EVM/TON toplamlarindan SONRA islenir: applySolanaRows
    // toplamlari `currentTokens.value`un TAMAMI (EVM + TON + Solana) uzerinden
    // YENIDEN hesaplar, yani yukaridaki Solana'siz toplami birlesik toplamla
    // degistirir. Solana satiri yoksa bu satir HIC calismaz ve EVM/TON davranisi
    // bit bit aynidir.
    if (hasSolanaRows) applySolanaRows(rows)

    // TAM tur ise son bilinen degeri oturum deposuna yaz (yarim / hatali tur ve gizli mod yazmaz). Beklenmez.
    if (requestId === currentRequestId && !privateNow) {
      persistBalanceSnapshot(user, {
        accountKey: active_account?.key,
        chainId: network.currentNetwork?.chainId,
        currency: currency.code,
        isPrivate: privateNow,
        expectedKeys: (currentTokens.value || []).map((t) => tokenBucketKey(t.chainId, t.address)),
      }).catch(() => {})
    }
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
  // KAYMAK G7: birlesik toplam bu hesap icin OKUNDU (bkz. updateBalance'taki ayni satir).
  toplamHesabi.value = user.balancesAccountKey
  user.totalsReadFor = user.balancesAccountKey
}

let balanceInterval
let onVisible = null
const startBalanceUpdates = async () => {
  if (balanceInterval) clearInterval(balanceInterval)
  currentRequestId++
  await loadCurrentTokens()
  listeHazir.value = true
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
// HESAP DEGISIMI (T16-GAP-5): eski hesabin xStock/bStock bakiye etiketleri en fazla 60 sn
// ekranda kalmasin ve yeni hesabin kovasina tohum yazma gecikmesin diye Hisseler bakiyesi
// SIFIRLANIR; sekme gorunuyorsa HEMEN yeniden okunur (await EDILMEZ: ana ekran taramasini
// bekletmesin). Gorunmuyorsa sekme acilisi zaten okur (openStocksTab).
const onUserAddressChanged = async () => {
  stockAccountGen++
  bStocksLoadPromise = null
  stockBalances.value = {}
  balancesLoaded.value = false
  // Hatirlanan sekmeye bakilir (gorunenSekme DEGIL): gorunurluk mod guncellemesiyle yarisabilir (girista privacy.active
  // henuz false, cikista henuz true); karar loadBStockData'da, ilk beklemeden sonra verilir.
  if (activeTab.value === 'stocks') loadBStockData()
  if (balanceInterval) clearInterval(balanceInterval)
  await startBalanceUpdates()
}
watch(() => user.address, onUserAddressChanged)

onMounted(async () => {
  try {
    const storage = await chrome.storage.local.get(['isBalanceVisible', 'needsPasswordRotation'])
    // Depodaki tercih bellege de yazilir (D4); animasyonsuz: baska panelde degisen tercih boyle uzlasir.
    if (storage.isBalanceVisible !== undefined) {
      isBalanceVisible.value = storage.isBalanceVisible
      page.balanceVisible = storage.isBalanceVisible
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
  sekmeGirisDurdur()
  gozDurdur()
  if (balanceInterval) clearInterval(balanceInterval)
  if (currentProvider) currentProvider.destroy?.()
  if (onVisible && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
})
</script>
