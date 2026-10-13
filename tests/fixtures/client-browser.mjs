import { createEntityStore, createSync, createTransport } from '@harness-projects/client'

const sourceMetadata = (revision, freshness = 'fresh') => ({ revision, freshness, authority: 'provider' })
const entity = (revision, title) => ({
  entityId: 'entity-browser',
  kind: 'work_item',
  planningStatus: 'todo',
  content: {
    contentKind: 'work_item',
    title,
    body: 'body',
    bindingId: 'binding-browser',
    externalKind: 'issue',
    externalId: 'issue-browser',
  },
  derived: [],
  source: sourceMetadata(revision),
})
const header = (revision) => ({
  workspace: { id: 'workspace-browser', name: 'Browser workspace' },
  capabilities: [{ key: 'planning.item.read', access: 'available', reason: undefined }],
  source: sourceMetadata(revision),
})
let baselineRevision = 1
const baseline = () => ({ ...header(baselineRevision), revision: baselineRevision, entities: [entity(baselineRevision, baselineRevision === 1 ? 'before' : 'recovered')] })
let nextEvent
const source = {
  baseline,
  watch: () => ({
    async poll() {
      const event = nextEvent
      nextEvent = undefined
      return event
    },
    close() {},
  }),
}

export async function drive() {
  const store = createEntityStore()
  let gapCurrent
  const sync = createSync(createTransport(source), store, {
    clock: () => '2026-10-12T00:00:00.000Z',
    onGap: (_gap, current) => { gapCurrent = current.isCurrent('entity-browser') },
  })
  const first = await sync.connect()
  nextEvent = {
    kind: 'delta',
    delta: {
      ...header(2),
      previousRevision: 1,
      revision: 2,
      upserts: [entity(2, 'after')],
      removed: [],
    },
  }
  const second = await sync.poll()
  baselineRevision = 3
  nextEvent = { kind: 'gap', gap: { requestedAfter: 2, currentRevision: 3, reason: 'fixture gap' } }
  const third = await sync.poll()
  sync.disconnect()
  const disconnectedCurrent = store.isCurrent('entity-browser')
  const disconnectedConnected = sync.connected
  const fourth = await sync.reconnect()
  const read = sync.read()
  return {
    first: first.kind,
    second: second.kind,
    third: third.kind,
    fourth: fourth.kind,
    gapCurrent,
    disconnectedCurrent,
    disconnectedConnected,
    connected: sync.connected,
    revision: sync.revision,
    title: store.get('entity-browser')?.entity.content.title,
    current: store.isCurrent('entity-browser'),
    workspace: read?.workspace.name,
  }
}
