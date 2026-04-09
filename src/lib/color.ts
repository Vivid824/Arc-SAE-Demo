export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

type RGB = {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): RGB {
  const normalized = hex.replace('#', '')
  const safe = normalized.length === 3
    ? normalized
        .split('')
        .map((character) => `${character}${character}`)
        .join('')
    : normalized

  return {
    r: Number.parseInt(safe.slice(0, 2), 16),
    g: Number.parseInt(safe.slice(2, 4), 16),
    b: Number.parseInt(safe.slice(4, 6), 16),
  }
}

function mixChannel(left: number, right: number, t: number) {
  return Math.round(left + (right - left) * clamp01(t))
}

export function mixHex(left: string, right: string, t: number) {
  const leftRgb = hexToRgb(left)
  const rightRgb = hexToRgb(right)

  return `rgb(${mixChannel(leftRgb.r, rightRgb.r, t)}, ${mixChannel(leftRgb.g, rightRgb.g, t)}, ${mixChannel(leftRgb.b, rightRgb.b, t)})`
}

export function createSequentialScale(low: string, high: string) {
  return (value: number, min: number, max: number) => {
    if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
      return mixHex(low, high, 0.5)
    }
    if (max <= min) {
      return mixHex(low, high, 0.5)
    }

    return mixHex(low, high, (value - min) / (max - min))
  }
}

const palette = ['#534AB7', '#1D9E75', '#D85A30', '#BA7517', '#3B82F6', '#E05A8D']

export function categoricalColor(label: string) {
  let hash = 0
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash << 5) - hash + label.charCodeAt(index)
    hash |= 0
  }

  return palette[Math.abs(hash) % palette.length]
}
