import { defineStore } from "pinia"
import { ref } from "vue"

export const pageStore = defineStore('pageStore', () => {
    const currentPage = ref('')
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

    return { currentPage, redirect, data, firstLoadDone, homeTab, ordersNotice, tradeSide, privateSwapSource }
})