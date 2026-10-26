export type StoreUpdate<T> = T | ((previous: T) => T)

export function resolveUpdate<T>(update: StoreUpdate<T>, previous: T): T {
  return typeof update === 'function' ? (update as (previous: T) => T)(previous) : update
}
