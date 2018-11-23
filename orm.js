const pg = require('pg')
const format = require('pg-format')
const debug = require('debug')('parthenon')

const BaseModel = require('./lib/base-model')

const TABLE = `CREATE TABLE IF NOT EXISTS %I (%s uuid, data jsonb, meta jsonb)`
const RELTABLE = `CREATE TABLE IF NOT EXISTS %I (id bigserial PRIMARY KEY, relation varchar(64), target_type varchar(64), target_id uuid, owner_id uuid)`

class ORM {
  constructor (connection) {
    if (connection) {
      this._pool = new pg.Pool(connection)
      this._modelCache = new Map()
      this._transaction = false
      this._client = null
    }
  }

  async initialize (models) {
    for (const model of models) {
      const tableSQL = format(TABLE, model._table, model._idColumn)
      const relSQL = format(RELTABLE, `${model._table}_relations`)
      await this._pool.query(tableSQL)
      await this._pool.query(relSQL)
    }
  }

  async end () {
    return this._pool.end()
  }

  async query (query, args) {
    debug(`Query: ${query}, args: %o`, args)
    return this._pool.query(query, args)
  }

  async startTransaction () {
    debug(`Starting transaction`)
    this._transaction = true
  }

  transaction (queries) {
    return new Promise(async (resolve, reject) => {
      const client = await this._pool.connect()
      try {
        debug('Start transaction')
        await client.query('BEGIN')
        for (const query of queries) {
          debug(`Query ${query.query}, args: %o`, query.args)
          await client.query(query.query, query.args)
        }
        await client.query('COMMIT')
        debug('Commit transaction')
        client.release()
        resolve()
      } catch (err) {
        debug('Transaction failed!', err)
        await client.query('ROLLBACK')
        client.release()
        reject(err)
      }
    })
  }

  makeModel (config) {
    if (!config) throw new Error('You need to supply a configuration')

    const handler = {
      construct: (Target, args) => {
        args.push(config, this)
        return new Target(...args)
      }
    }

    const model = new Proxy(BaseModel, handler)
    this._modelCache.set(config.name, model)

    model._table = config.name || config.tableName
    model._idColumn = config.idColumn || 'id'
    return model
  }
}

module.exports = ORM
