import type { AiChoice } from '@shared/ipc'
import type { TaskKind } from './providers/types'

export interface ExecutionScope {
  requestId: string
  task: TaskKind
  ownerId?: number
  documentId?: number
  threadId?: number
  profile?: Readonly<AiChoice>
}
export interface ExecutionLease {
  readonly scope: Readonly<ExecutionScope>
  readonly signal: AbortSignal
  readonly valid: boolean
  readonly done: Promise<void>
  bindThread(threadId: number): void
  captureProfile(profile: AiChoice): void
  finish(): void
}
interface ActiveExecution {
  scope: ExecutionScope
  controller: AbortController
  invalidated: boolean
  terminal: boolean
  documentToken?: object
  threadToken?: object
  globalToken: object
  done: Promise<void>
  resolve: () => void
}

/** Process-local ownership. No Electron, database, or provider dependencies. */
export class ExecutionCoordinator {
  private active = new Map<string, ActiveExecution>()
  private documents = new Map<number, object>()
  private threads = new Map<number, object>()
  private globalToken = {}
  private closed = false

  private token(map: Map<number, object>, id: number | undefined): object | undefined {
    if (id === undefined) return undefined
    if (!map.has(id)) map.set(id, {})
    return map.get(id)
  }
  private valid(job: ActiveExecution): boolean {
    return !job.invalidated && job.globalToken === this.globalToken
      && job.documentToken === this.token(this.documents, job.scope.documentId)
      && job.threadToken === this.token(this.threads, job.scope.threadId)
  }
  private assertThreadAvailable(threadId: number, except?: ActiveExecution): void {
    if ([...this.active.values()].some((job) => job !== except && this.valid(job)
      && job.scope.task === 'chat' && job.scope.threadId === threadId)) {
      throw new Error('Another chat request is already running in this thread.')
    }
  }
  begin(scope: ExecutionScope): ExecutionLease {
    if (this.closed) throw new Error('The application is shutting down.')
    if (!scope.requestId.trim()) throw new Error('A request ID is required.')
    if (this.active.has(scope.requestId)) throw new Error('That request is already running.')
    if (scope.task === 'chat') {
      if (scope.ownerId !== undefined && [...this.active.values()].some((job) => this.valid(job)
        && job.scope.task === 'chat' && job.scope.ownerId === scope.ownerId)) {
        throw new Error('Another chat request is already running.')
      }
      if (scope.threadId !== undefined) this.assertThreadAvailable(scope.threadId)
    }
    let resolve!: () => void
    const done = new Promise<void>((r) => { resolve = r })
    const job: ActiveExecution = { scope: { ...scope, profile: scope.profile && { ...scope.profile } },
      controller: new AbortController(), invalidated: false, terminal: false,
      documentToken: this.token(this.documents, scope.documentId), threadToken: this.token(this.threads, scope.threadId),
      globalToken: this.globalToken, done, resolve }
    this.active.set(scope.requestId, job)
    const coordinator = this
    return {
      get scope() { return job.scope },
      signal: job.controller.signal,
      get valid() { return !job.terminal && coordinator.valid(job) },
      done,
      bindThread(threadId) {
        if (job.terminal || !coordinator.valid(job)) throw new Error('This request is no longer active.')
        if (job.scope.threadId !== undefined && job.scope.threadId !== threadId) throw new Error('Cannot change the request thread.')
        if (job.scope.task === 'chat') coordinator.assertThreadAvailable(threadId, job)
        job.scope.threadId = threadId
        job.threadToken = coordinator.token(coordinator.threads, threadId)
      },
      captureProfile(profile) { job.scope.profile = { ...profile } },
      finish() {
        if (job.terminal) return
        job.terminal = true
        coordinator.active.delete(scope.requestId)
        job.resolve()
      },
    }
  }
  stop(requestId: string, ownerId?: number): boolean {
    const job = this.active.get(requestId)
    if (!job || (ownerId !== undefined && job.scope.ownerId !== ownerId)) return false
    job.controller.abort()
    return true
  }
  private invalidate(predicate: (scope: ExecutionScope) => boolean): void {
    for (const job of this.active.values()) {
      if (predicate(job.scope)) {
        job.invalidated = true
        job.controller.abort()
      }
    }
  }
  invalidateThread(threadId: number): void {
    this.threads.set(threadId, {})
    this.invalidate((scope) => scope.threadId === threadId)
  }
  invalidateDocument(documentId: number): void {
    this.documents.set(documentId, {})
    this.invalidate((scope) => scope.documentId === documentId)
  }
  invalidateOwner(ownerId: number): void {
    this.invalidate((scope) => scope.ownerId === ownerId)
  }
  invalidateChats(): void {
    // Tags belong to documents, so clearing chats leaves tagging alone.
    for (const job of this.active.values()) {
      if (job.scope.task !== 'tagging') {
        if (job.scope.threadId !== undefined) this.threads.set(job.scope.threadId, {})
        job.invalidated = true
        job.controller.abort()
      }
    }
  }
  async shutdown(): Promise<void> {
    this.closed = true
    this.globalToken = {}
    const jobs = [...this.active.values()]
    this.invalidate(() => true)
    await Promise.all(jobs.map((job) => job.done))
  }
}

export const executions = new ExecutionCoordinator()
