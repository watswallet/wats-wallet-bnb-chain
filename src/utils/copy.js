export async function copy(value) {
    await navigator.clipboard.writeText(value)
}