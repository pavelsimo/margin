import { useEffect, useRef, useState } from 'react'
import { useLibraryStore } from '../state/libraryStore'

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

export default function GlobalDropOverlay() {
  const [active, setActive] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    const reset = () => {
      depth.current = 0
      setActive(false)
    }

    const onDragEnter = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      event.preventDefault()
      depth.current += 1
      setActive(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      // Required for drop to fire; also blocks Electron's default file:// navigation.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent) => {
      if (!isFileDrag(event)) return
      // dragenter/dragleave fire per element crossed; only hide once the
      // counter says the drag left the outermost node (the window).
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      reset()
      const file = event.dataTransfer?.files[0]
      if (!file) return
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
      const store = useLibraryStore.getState()
      if (!isPdf || store.addingSource !== null) return
      void store.addByFile(file)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [])

  if (!active) return null
  return (
    <div className="global-drop-overlay" role="status">
      <div className="global-drop-card">
        <span className="upload-arrow">↑</span>
        <span className="global-drop-title">Drop PDF to add to your library</span>
        <span className="global-drop-hint">PDF up to 50 MB</span>
      </div>
    </div>
  )
}
