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

  await t.test('connects', async () => {
    const orm = new ORM({ database: testDatabase })
    orm.end()
  })

  await t.test('creates a model', async (t) => {
    const orm = new ORM({ database: testDatabase })
    const config = {
      name: 'foo',
      idField: 'id',
      fields: {
        id: joi.string().guid({ version: 'uuidv4' }),
        name: joi.string(),
        email: joi.string().email()
      }
    }
    const Test = orm.makeModel(config)
    await orm.initialize([Test])
    const test1 = new Test({ name: 'todd', email: 'todd@selfassembled.org' })
    await test1.save()
    const test2 = new Test({ id: test1.id })
    await test2.load()
    const t1Data = test1.toJSON()
    const t2Data = test2.toJSON()
    t1Data.id = t2Data.id
    t.deepEquals(t1Data, t2Data, 'new save and load')
    await orm.end()
    t.end()
  })

  await teardown()
  t.end()
})
