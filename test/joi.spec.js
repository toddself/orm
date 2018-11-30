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
  } catch (err) {
    t.fail(err)
  }

  try {
    joi.assert(false, test)
  } catch (err) {
    t.ok(err, 'should throw')
  }

  t.end()
})
