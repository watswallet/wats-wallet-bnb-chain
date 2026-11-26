// Kullanici adi degistirme hatasini i18n anahtarina cevirir. Sunucunun ham mesaji ya da
// e.message ASLA ekrana gecmez: yalniz bilinen sunucu mesajlari cevrilir.
// Bilinen kume: server/controllers/profileController.js changeUsername.
const P = 'settings.profile.editUsername.'

export function usernameErrorKey(e) {
    const msg = e?.response?.data?.message
    if (typeof msg === 'string') {
        if (msg === 'Username already taken') return { key: P + 'status_unavailable_desc' }
        const m = /^You must wait (\d+) more days? to change your username\.$/.exec(msg)
        if (m) return { key: P + 'error_cooldown', params: { days: Number(m[1]) } }
        return { key: P + 'error_unknown' }
    }
    if (e?.request) return { key: P + 'error_network' }
    return { key: P + 'error_unknown' }
}
