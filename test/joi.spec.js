const { skip, test } = require('tap') // eslint-disable-line
const extendJoi = require('../lib/joi')
const j = require('joi')

test('joi extended', (t) => {
  const ormShim = {
    getModel () {
      return {
        fields: {
          name: j.string()
        }
      }
    }
  }
  const joi = extendJoi(ormShim)
  const test = joi.oneOf('test')
  try {
    joi.assert({ name: 'foo' }, test)
    t.ok('asserts via lookup')
    t.equal(test._table, 'test', 'test table name')
    t.equal(test._name, 'test', 'test model name')
  } catch (err) {
    t.fail(err)
  }

  try {
    joi.assert(false, test)
  } catch (err) {
    t.ok(err, 'test should throw')
  }

  const fakeModel = {
    _table: 'test',
    _name: 'test',
    fields: {
      data: joi.boolean()
    }
  }
  const test2 = joi.manyOf(fakeModel, 'bar')

  try {
    joi.assert([{ data: true }], test2)
    t.ok('asserts via direct model')
    t.equal(test2._table, 'test', 'test2 table name')
    t.equal(test2._name, 'test', 'test2 model name')
  } catch (err) {
    t.fail(err)
  }

  try {
    joi.assert('boop', test2)
  } catch (err) {
    t.ok('it does not like bad data')
  }
  t.end()
})
