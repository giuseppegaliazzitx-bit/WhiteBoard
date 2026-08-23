/**
 * Store factory.
 *
 * The UI only ever talks to the object this returns, so swapping the backing
 * service is a change here and nowhere else:
 *
 *   mode      string
 *   list()    -> Promise<Card[]>
 *   create(p) -> Promise<Card>
 *   update(id, patch) -> Promise<Card>
 *   remove(id)        -> Promise<void>
 *   listPeople() / upsertPerson({ name })
 *   listCanvas() / createCanvasObject / updateCanvasObject / removeCanvasObject
 *   subscribe(fn)     -> unsubscribe
 *   close()           -> Promise<void>
 */
import { createLocalStore } from './local.js'
import { config } from '../config.js'

/**
 * Async because supabase-js is imported dynamically: it is ~40% of the bundle
 * and a board running on localStorage should not pay for it at all.
 */
export async function createStore(options = {}) {
  const mode = options.mode || config.mode
  const boardId = options.boardId || config.boardId

  if (mode !== 'supabase') return createLocalStore({ boardId })

  const [{ createClient }, { createSupabaseStore }] = await Promise.all([
    import('@supabase/supabase-js'),
    import('./supabase.js'),
  ])

  const client =
    options.client ||
    createClient(config.supabaseUrl, config.supabaseAnonKey, {
      // No login in v1, so there is no session worth persisting or refreshing.
      auth: { persistSession: false, autoRefreshToken: false },
      // A busy board should not be able to flood a browser tab.
      realtime: { params: { eventsPerSecond: 10 } },
    })

  return createSupabaseStore({ client, boardId })
}
