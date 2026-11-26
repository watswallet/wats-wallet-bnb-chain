import { defineStore } from "pinia"
import { ref } from "vue"

export const pageStore = defineStore('pageStore', () => {
    const currentPage = ref('')

    // GEZINME NIYETI (kaymak sayfa yonu, D2). Yalniz bellekte; sayfa yonu denetleyicisi okur.
    // 'back' geri, 'neutral' yon vermez, null = niyet yok.
    const navIntent = ref(null)
    function navigate(target, intent = null) {
        if (currentPage.value === target) { navIntent.value = null; return }
        navIntent.value = intent
        currentPage.value = target
    }
    const redirect = ref(null)
    const data = ref(null)

    // ILK BAKIYE TURU BITTI MI. Yukleme ekranini App.vue cizer, kapiyi Home.vue
    // acar -- ikisi AYNI ANDA mount olmadigi icin (ekranlar .25s'lik out-in
    // gecisi icinde yasiyor) bag bir prop/emit degil, PAYLASILAN bir bayrak
    // olmak zorunda. Bir kez acilir ve oturum boyunca acik kalir: home -> token
    // -> home dolasimi yeniden yukleme ekrani gostermemeli.
    const firstLoadDone = ref(false)

    // ANA EKRANDA SON SECILEN SEKME. `firstLoadDone` ile AYNI gerekce: Home.vue
    // home -> token -> home dolasiminda YENIDEN MOUNT olur, yani bilesen icindeki
    // bir `ref` her donuste varsayilana sifirlanir. Hisseler sekmesinden bir
    // hisseye girip geri donen kullanici kendini Varliklar'da buluyordu.
    //
    // `<script setup>` govdesi MODUL DUZEYI DEGILDIR (setup() icidir), yani orada
    // tanimlanan bir `let` bu isi GORMEZ -- olculdu.
    const homeTab = ref('assets')

    // GOZ TERCIHI BELLEKTE (kaymak D4). null = henuz okunmadi. Home ilk okumada chrome.storage.local'daki
    // isBalanceVisible'i buraya da yazar; sonraki her Home kurulumu degeri setup'ta senkron alir. Yoksa
    // ref(true) ile baslayip mount'tan sonra okunan tercih, bakiyesini gizleyen kullaniciya her donuste
    // gercek sayiyi bir an gosterirdi. Depoya yazma Home'un goz dugmesinde kalir.
    const balanceVisible = ref(null)

    // HISSE AG CIPI SECIMI BELLEKTE (kaymak D5). number (zincir kimligi) | 'all' | null; null = henuz
    // secilmedi, Home baslangici aktif agdan turetir. `homeTab` ile AYNI gerekce: Home her donuste yeniden
    // mount olur, bilesen ici bir ref secimi sifirlar ve geri yuklenen kaydirma konumu baska bir listeye
    // uygulanirdi. Yalniz bellekte, oturum boyunca; diske (chrome.storage dahil) yazilmaz.
    const stockChip = ref(null)

    // ANA EKRANDA KALINAN YER (kaymak G13, spec 7.10, K2). { key, tab, top, anchorKey, anchorOffset } | null; tek
    // deger, buyuyen bir sozluk degil. Home'un onBeforeUnmount'u yazar, kurulunca anahtar (hesap|gizli mod|kapsam)
    // ve sekme tutarsa geri yukler (composables/useHomeScrollMemory.js). App.vue siler: kilit sayfasina gidis ve
    // kilitten cikis, gizli mod, SESSION_EXPIRED, hesap ve kapsam degisimi. Capa anahtari gizli hesabin tokenini
    // gosterebilir: YALNIZ bellekte; diske (chrome.storage dahil) asla yazilmaz.
    const homeScroll = ref(null)

    // Gizli aktarma ekraninin Gizli islemlerim ekranina biraktigi BIR KEZ gosterilecek not
    // (i18n anahtari). Siparis ekrani mount olunca okur ve null'lar.
    const ordersNotice = ref(null)

    // HISSE DETAYINDAN AL/SAT YONU ('buy' | 'sell' | null). `data` genel amaclidir ve bayat
    // kalabilir; bu alan tek anlamli. StockDetail yazar (ag gecisi basariliysa), StockTrade mount'ta
    // okur ve null'a CEKER (T14). Baska kimse yazmaz.
    const tradeSide = ref(null)

    // TOKEN SAYFASINDAN GIZLI TAKAS/KOPRU'YE BIR KEZLIK ON SECIM ({ chainId: number, asset: string } | null). asset SilentSwap kayit
    // semboludur ('USDC', 'ETH'), satir etiketi degil. Token.vue yazar (Takas/Kopru dugmesi), PrivateTransfer swap/bridge modunda
    // SETUP'ta okur ve null'a CEKER (gecerli olsun olmasin, bayat kalmasin). fund/send modlari ne okur ne temizler. Baska kimse yazmaz.
    const privateSwapSource = ref(null)

    return { currentPage, navIntent, navigate, redirect, data, firstLoadDone, homeTab, balanceVisible, stockChip, homeScroll, ordersNotice, tradeSide, privateSwapSource }
})