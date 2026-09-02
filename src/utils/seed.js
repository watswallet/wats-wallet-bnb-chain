export function getRandomWordPositions(total = 12, count = 3) {
  const positions = new Set()
  while (positions.size < count) {
    positions.add(Math.floor(Math.random() * total))
  }
  return Array.from(positions).sort((a, b) => a - b)
}