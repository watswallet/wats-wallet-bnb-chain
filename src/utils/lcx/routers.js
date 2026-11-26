// LCX (Liberty DEX) router adresleri -- TEK KAYNAK. Saf veri: HICBIR SEY IMPORT ETMEZ.
//
// Iki tuketicisi var ve ikisi de bu tabloyu okur:
//   - utils/lcx/routerGuard.js: imzalanacak takas tx'inin `to`su BU adres olmali (yeniden disa aktarir).
//   - scripts/gen-router-manifest.mjs: ATS komisyon manifestosu (docs/ats-komisyon-router-listesi.json). Backend
//     komisyonu cagrilan router adresine gore uygular; burada olup manifestoda olmayan bir router'dan gecen takas
//     komisyonsuz kalir (canli bulgu 2026-11-20). Betik duz Node ile calistigi icin bu dosya import'suz kalmali.
//
// Adresler zincirden 2026-11-19'da okundu (checksum'li). UUPS proxy; yukseltme gecikmesi 48 saat.
const ROUTER_A = '0x0000000000b1ae06c96aB73FF4360d7AeAaB56F0'
const ROUTER_B = '0x0000000000654902B6Ed6cC240cc81CB4c4a3dff'

export const LCX_ROUTERS = Object.freeze({
    1: ROUTER_A,
    8453: ROUTER_A,
    42161: ROUTER_A,
    10: ROUTER_A,
    56: ROUTER_B,
    137: ROUTER_B,
    100: ROUTER_B,
    25: ROUTER_B,
})
