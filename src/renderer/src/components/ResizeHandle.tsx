import React, { useCallback, useRef } from 'react'

interface ResizeHandleProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}

export function ResizeHandle({ direction, onResize }: ResizeHandleProps) {
  const startRef = useRef(0)
  const dragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startRef.current = direction === 'horizontal' ? e.clientX : e.clientY
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const current = direction === 'horizontal' ? ev.clientX : ev.clientY
      const delta = current - startRef.current
      if (delta !== 0) {
        onResize(delta)
        startRef.current = current
      }
    }

    const handleMouseUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [direction, onResize])

  const isH = direction === 'horizontal'

  return (
    <div
      className={`${isH ? 'w-1 cursor-col-resize hover:bg-blue-500/40' : 'h-1 cursor-row-resize hover:bg-blue-500/40'} bg-gray-700 shrink-0 transition-colors`}
      onMouseDown={handleMouseDown}
    />
  )
}
