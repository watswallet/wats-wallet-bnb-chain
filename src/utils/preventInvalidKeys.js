export function preventInvalidKeys(e) {
  const invalidChars = ['e', 'E', '+', '-']
  if (invalidChars.includes(e.key)) e.preventDefault()
}