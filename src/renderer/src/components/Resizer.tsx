import { useCallback, useRef } from 'react'

/** Drag handle between two panels. Reports the pointer's movement delta
 *  each frame — the caller clamps and applies it to whatever dimension
 *  it owns (sidebar width, agent panel width, bottom panel height). */
export function Resizer({
  direction,
  onResize
}: {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}) {
  const draggingRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      draggingRef.current = true
      let last = direction === 'horizontal' ? e.clientX : e.clientY
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const onMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return
        const current = direction === 'horizontal' ? ev.clientX : ev.clientY
        onResize(current - last)
        last = current
      }
      const onUp = () => {
        draggingRef.current = false
        target.releasePointerCapture(e.pointerId)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [direction, onResize]
  )

  return (
    <div
      className={`resizer resizer-${direction}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
    />
  )
}
