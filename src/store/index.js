/**
 * Store factory.
 *
 * The UI only ever talks to the object this returns, so swapping the backing
 * service is a change here and nowhere else. Phase 5 adds the Supabase adapter
 * behind the same interface:
 *
 *   mode      string
 *   list()    -> Promise<Card[]>
 *   create(p) -> Promise<Card>
 *   update(id, patch) -> Promise<Card>
 *   remove(id)        -> Promise<void>
 *   subscribe(fn)     -> unsubscribe
 *   close()           -> Promise<void>
 */
import { createLocalStore } from './local.js'

export function createStore(options = {}) {
  return createLocalStore(options)
}
