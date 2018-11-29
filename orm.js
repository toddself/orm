const pg = require('pg')
const format = require('pg-format')
const debug = require('debug')('parthenon')

const joi = require('./lib/joi')
const BaseModel = require('./lib/base-model')

const TABLE = `CREATE TABLE IF NOT EXISTS %I (%s uuid, data jsonb, meta jsonb)`
const RELTABLE = `CREATE TABLE IF NOT EXISTS %I (id bigserial PRIMARY KEY, owner_relation varchar(64), target_relation varchar(64), target_id uuid, owner_id uuid)`

class ORM {
  constructor (connection) {
    this._client = null
    this._modelCache = new Map()
    this.fields = joi(this)
    if (connection) {
      this._pool = new pg.Pool(connection)
    }
  }

  setConnection (connection) {
    this._pool = new pg.Pool(connection)
  }

  async initialize (models) {
    for (const model of models) {
      debug(`Creating table for ${model._table} with id column ${model._idColumn}`)
      const tableSQL = format(TABLE, model._table, model._idColumn)
      await this.query(tableSQL)
      for (const relation of model._relations) {
        const relationSQL = format(RELTABLE, [model._table, relation._modelName].sort().join('_'))
        await this.query(relationSQL)
      }
    }
  }

  async end () {
    return this._pool.end()
  }

  async query (query, args) {
    debug(`Query: ${query}, args: %o`, args)
    const client = this._client || this._pool
    return client.query(query, args)
  }

  async transaction (queries) {
    queries.unshift({ query: 'BEGIN' })
    queries.push({ query: 'COMMIT' })
    this._client = await this._pool.connect()
    try {
      this._transaction = true
      for (const query of queries) {
        await this.query(query.query, query.args)
      }
    } catch (err) {
      debug('Rolled back transaction', err)
      await this.query('ROLLBACK')
      throw err
    } finally {
      debug('Cleaning up')
      this._client.release()
      this._client = null
    }
  }

  getModel (modelName) {
    return this._modelCache.get(modelName)
  }

  makeModel (config) {
    if (!config) throw new Error('You need to supply a configuration')

    const proxyHandler = {
      construct: (Target, args) => {
        args.push(config, this)
        return new Target(...args)
      },
      get (target, prop) {
        if (prop === '_table') return config.name || config.tableName
        if (prop === '_idColumn') return config.idColumn || 'id'
        if (prop === '_relations') {
          return Object.values(config.fields).filter((field) => field._isRelation)
        }
        return target[prop]
      }
    }

    const model = new Proxy(BaseModel, proxyHandler)
    this._modelCache.set(config.name, model)
    return model
  }
}

module.exports = ORM
