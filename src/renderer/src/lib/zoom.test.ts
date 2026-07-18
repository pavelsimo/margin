import { describe, expect, it } from 'vitest'
import { openingZoomForWidth } from './zoom'

describe('openingZoomForWidth', () => {
  it('never opens below 100% when the viewer is narrow', () => {
    expect(openingZoomForWidth(600)).toBe(100)
    expect(openingZoomForWidth(0)).toBe(100)
  })

  it('selects a zoom level at its exact width threshold', () => {
    expect(openingZoomForWidth(740)).toBe(100)
    expect(openingZoomForWidth(888)).toBe(120)
    expect(openingZoomForWidth(1_073)).toBe(145)
  })

  it('rounds down to the largest zoom level that fits', () => {
    expect(openingZoomForWidth(1_294)).toBe(145)
  })

  it('caps the opening zoom at 300%', () => {
    expect(openingZoomForWidth(2_220)).toBe(300)
    expect(openingZoomForWidth(5_000)).toBe(300)
  })

  it('falls back to 100% for an invalid measurement', () => {
    expect(openingZoomForWidth(Number.NaN)).toBe(100)
    expect(openingZoomForWidth(Number.POSITIVE_INFINITY)).toBe(100)
  })
})
