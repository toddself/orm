const {test, skip} = require('tap') // eslint-disable-line

const changeList = require('../lib/changelist')

test('changelist', (t) => {
  const changes = changeList()

  t.test('add', (t) => {
    changes.add('foo', 'bar')
    t.deepEqual(changes[0], { change: 'add', prop: 'foo', val: 'bar' }, 'recorded')
    t.end()
  })

  t.test('del', (t) => {
    changes.del('foo', 'bar')
    t.deepEqual(changes[1], { change: 'del', prop: 'foo', val: 'bar' }, 'recorded')
    t.end()
  })

  t.test('reconcile', (t) => {
    const reconciled = changes.reconcile()
    t.deepEqual(reconciled, [{ change: 'del', prop: 'foo', val: 'bar' }], 'recorded')
    t.deepEqual(changes, [{ change: 'add', prop: 'foo', val: 'bar' }, { change: 'del', prop: 'foo', val: 'bar' }], 'unchanged')
    t.end()
  })

  t.end()
})
