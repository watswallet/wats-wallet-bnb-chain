/**
 * Sifre guc endeksi — TEK kaynak.
 *
 * Kural onboarding'de iki kez kopyalanmisti (CreatePassword.vue ve
 * CreatePassword2.vue) ve sifre DEGISTIRME ekraninda hic yoktu: o ekranda
 * `isFormValid` yalnizca "dolu + eslesiyor + eskisinden farkli" diyordu, yani
 * kullanici cuzdanini tek harfli bir sifreyle korunur hale getirebiliyordu.
 * Aslinda cuzdanin ilk kurulumundan daha riskli bir an: icinde bakiye var.
 *
 * Puanlama BILEREK degistirilmedi; onboarding'deki mevcut davranisla birebir.
 *
 * BILINEN ZAYIFLIK: puan uzunluktan BAGIMSIZ toplanabildigi icin 'Aa1!' gibi
 * dort karakterli bir sifre de esigi (2) geciyor. Esigi yukseltmek ya da mutlak
 * bir minimum uzunluk sarti eklemek onboarding'in kabul ettigi sifreleri de
 * degistirir; o ayri bir karar.
 */

/** Esik: bu puanin altindaki sifreler kabul edilmez. */
export const MIN_PASSWORD_SCORE = 2

/** 0 (bos/cok zayif) ile 4 (guclu) arasi puan. */
export function passwordStrength(password) {
    if (!password || typeof password !== 'string') return 0

    let s = 0
    if (password.length > 7) s++
    if (/[A-Z]/.test(password) && /[0-9]/.test(password)) s++
    if (/[^A-Za-z0-9]/.test(password)) s++
    if (password.length > 12) s++

    return s
}

export function isPasswordStrongEnough(password) {
    return passwordStrength(password) >= MIN_PASSWORD_SCORE
}
