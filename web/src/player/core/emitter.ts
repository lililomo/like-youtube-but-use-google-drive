export type Listener<T> = (payload: T) => void;

/** Event emitter kecil bertipe. */
export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.map.get(type)?.forEach((fn) => {
      try {
        (fn as Listener<E[K]>)(payload);
      } catch (err) {
        console.error(err);
      }
    });
  }

  clear(): void {
    this.map.clear();
  }
}
