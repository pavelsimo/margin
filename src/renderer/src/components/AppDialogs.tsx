import { useLibraryStore } from '../state/libraryStore'
import { useUiStore } from '../state/uiStore'

function DeleteConfirmDialog() {
  const { confirmDeleteId, cancelDelete, confirmDelete } = useLibraryStore()
  if (!confirmDeleteId) return null
  return (
    <div className="dialog-overlay" onClick={cancelDelete}>
      <div className="dialog dialog-small" role="alertdialog" aria-modal="true" aria-labelledby="delete-paper-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="delete-paper-title">Delete paper?</h2>
        <p className="dialog-copy">This removes the paper, its pages, and its chat history.</p>
        <div className="dialog-actions">
          <button className="btn btn-soft" onClick={cancelDelete}>Cancel</button>
          <button className="btn btn-danger" onClick={() => void confirmDelete()}>Delete</button>
        </div>
      </div>
    </div>
  )
}

function AboutDialog() {
  const { aboutOpen, closeAbout, windowState } = useUiStore()
  if (!aboutOpen) return null
  return (
    <div className="dialog-overlay" onClick={closeAbout}>
      <div className="dialog about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(e) => e.stopPropagation()}>
        <span className="app-logo app-logo-large" />
        <h2 id="about-title">Margin</h2>
        <p className="dialog-copy">AI paper reader, desktop edition</p>
        <span className="mono">Version {windowState?.version ?? '0.1.0'}</span>
        <button className="btn btn-soft" onClick={closeAbout}>Close</button>
      </div>
    </div>
  )
}

export default function AppDialogs() {
  return <><DeleteConfirmDialog /><AboutDialog /></>
}
