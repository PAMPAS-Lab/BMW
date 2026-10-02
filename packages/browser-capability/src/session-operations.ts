/** FIFO admission shared by browser Sessions. A failed action cannot poison the queue. */
export class SessionOperations {
  private tail: Promise<unknown> = Promise.resolve()
  private pending = 0
  get busy(): boolean { return this.pending > 0 }
  run<T>(admit: () => void, operation: () => Promise<T>): Promise<T> {
    this.pending++
    const result = this.tail.then(() => { admit(); return operation() })
    this.tail = result.catch(() => {}).finally(() => { this.pending-- })
    return result
  }
  async drain(): Promise<void> { await this.tail }
}
