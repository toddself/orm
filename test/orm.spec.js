const {skip, test} = require('tap') // eslint-disable-line
const pg = require('pg')
const crypto = require('crypto')
const joi = require('joi')
const ORM = require('..')

const testDatabase = `tdb_${crypto.randomBytes(16).toString('hex')}`
const c = {
  user: process.env.PGUSER,
  host: process.env.PGHOST,
  database: 'postgres'
}

async function setup () {
  if (process.env.PGPASSWORD) c.password = process.env.PGPASSWORD
  const pool = new pg.Pool(c)
  await pool.query(`CREATE DATABASE ${testDatabase}`)
  return pool.end()
}

async function teardown () {
  const pool = new pg.Pool(c)
  await pool.query(`DROP DATABASE ${testDatabase}`)
  return pool.end()
}

test('orm', async (t) => {
  await setup()

  await t.test('connects', async (t) => {
    const orm = new ORM({ database: testDatabase })
    t.ok(orm._pool, 'everybody in the pool')
    await orm.end()
    t.end()
  }).catch(t.threw)

  await t.test('creates a model', async (t) => {
    const orm = new ORM({ database: testDatabase })
    const config = {
      name: 'foo',
      idColumn: 'key',
      fields: {
        key: joi.string().guid({ version: 'uuidv4' }),
        name: joi.string(),
        email: joi.string().email()
      }
    }
    const Test = orm.makeModel(config)
    await orm.initialize([Test])
    const test1 = new Test({ name: 'todd', email: 'todd@selfassembled.org' })

    try {
      await test1.save()
    } catch (err) {
      t.fail(err)
    }

    const test2 = new Test({ key: test1.key })

    try {
      await test2.load()
    } catch (err) {
      t.fail(err)
    }

    const t1Data = test1.toJSON()
    const t2Data = test2.toJSON()
    t1Data.key = t2Data.key
    t.deepEquals(t1Data, t2Data, 'new save and load')
    await orm.end()
    t.end()
  }).catch(t.threw)

  await t.test('handles complex data types', async (t) => {
    const orm = new ORM({ database: testDatabase })
    const barConfig = {
      name: 'bar',
      fields: {
        id: joi.string().guid({ version: 'uuidv4' }),
        name: joi.string(),
        beeps: { schemaType: 'relation', multi: true, validator: joi.object().unknown(true) }
      }
    }
    const beepConfig = {
      name: 'beep',
      fields: {
        id: joi.string().guid({ version: 'uuidv4' }),
        name: joi.string()
      }
    }
    const Bar = orm.makeModel(barConfig)
    const Beep = orm.makeModel(beepConfig)

    await orm.initialize([Beep, Bar])

    const beep = new Beep({ name: 'beep-test' })
    await beep.save()

    const bar = new Bar({ name: 'test', beeps: beep })
    await bar.save()

    const bar2 = new Bar({ id: bar.id })
    await bar2.load({ expand: true })
    const expect = {
      beeps: [{
        name: 'beep-test'
      }],
      name: 'test'
    }

    const data = bar2.toJSON()
    expect.id = data.id
    data.beeps.forEach((d, i) => (expect.beeps[i].id = d.id))
    t.deepEqual(data, expect, 'loaded')

    await orm.end()
    t.end()
  }).catch(t.threw)

  await teardown()
  t.end()
}).catch(test.threw)
