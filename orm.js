const joi = require('joi')
const pg = require('pg')
const format = require('pg-format')
const uuid = require('uuid/v4')

const INSERTSQL = `INSERT INTO %I (%s, data, meta) VALUES ($1, $2, $3)`
const UPDATESQL = `UPDATE %I SET meta = meta || %L, data = data || %L`
const RELATIONSQL = `INSERT INTO %I SET (relation, target_type, target_id, owner_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`

const TABLE = `CREATE TABLE IF NOT EXISTS %I (%s uuid, data jsonb, meta jsonb)`
const RELTABLE = `CREATE TABLE IF NOT EXISTS %I (id bigserial PRIMARY KEY, relation varchar(64), target_type varchar(64), target_id uuid, owner_id uuid)`

const ModelSym = Symbol('models')
const PoolSym = Symbol('pool')

class ORM {
  constructor (connection) {
    if (connection) {
      this[PoolSym] = new pg.Pool(connection)
      this[ModelSym] = new Map()
    }
  }

  async initialize (models) {
    for (const model of models) {
      const tableSQL = format(TABLE, model._table, model._idColumn)
      const relSQL = format(RELTABLE, `${model._table}_relations`)
      await this[PoolSym].query(tableSQL)
      await this[PoolSym].query(relSQL)
    }
  }

  async end () {
    return this[PoolSym].end()
  }

  async query (query, args) {
    return this[PoolSym].query(query, args)
  }

  makeModel (config) {
    if (!config) throw new Error('You need to supply a configuration')
    const that = this
    class model extends ORM {
      constructor (data) {
        super(false)
        this.name = config.name
        this._table = config.name || config.tableName
        this._idColumn = config.idColumn || 'id'
        this._data = {}
        this._dirty = []
        this._new = true
        this._id = null
        this._fields = config.fields
        this[PoolSym] = that[PoolSym]
        this[ModelSym] = that[ModelSym]
        Object.keys(this._fields).forEach((key) => {
          this._define(key)
        })

        if (data) {
          for (const [key, val] of Object.entries(data)) {
            this[key] = val
          }
        }

        return new Proxy(this, {
          set: function (obj, prop, val) {
            const fields = Object.keys(obj._fields)
            if (!fields.includes(prop) && !prop.startsWith('_')) return false
            obj[prop] = val
            return true
          }
        })
      }
    }
    this[ModelSym].set(config.name, model)
    model._table = config.name || config.tableName
    model._idColumn = config.idColumn || 'id'
    return model
  }

  _isArrayField (field) {
    return field.schemaType === 'array' || (field.schemaType === 'relation' && field.multi)
  }

  _define (key) {
    if (this._isArrayField(this._fields[key]) && !Array.isArray(this._data[key])) {
      this._data[key] = []
    }

    Object.defineProperty(this, key, {
      get: () => {
        return this._data[key]
      },
      set: (val) => {
        const field = this._fields[key]
        if (!field) {
        }
        const data = this._data[key]
        if (field.schemaType === 'array') {
          if (!data.find((obj) => obj.id === val.id)) {
            if (field.isJoi) joi.assert([val], field)
            else field.validator([val])
            data.push(val)
          }
        } else {
          if (field.schemaType === 'relation') {
            if (field.validator.isJoi) joi.assert(val, field.validator)
            else field.validator(val)
          } else {
            if (field.isJoi) joi.assert(val, field)
            else field.validator(val)
          }
          this._data[key] = val
        }

        if (key === 'id') this._new = false
        if (!this._dirty.includes(key)) this._dirty.push(key)
      }
    })
  }

  async load (expand) {
    if (!this.id) throw new Error('You must provide an id to load from the database')
    const dataSQL = format(`SELECT data FROM %I WHERE %s = $1`, this._table, this._idColumn)
    const relationSQL = format(`SELECT relation, target_type, target_id FROM %I WHERE owner_id = $1`, `${this._table}_relations`)
    const [data, relations] = await Promise.all([
      this[PoolSym].query(dataSQL, [this.id]),
      this[PoolSym].query(relationSQL, [this.id])
    ])

    if (data && data.rows[0]) {
      const dbData = data.rows[0].data
      Object.keys(dbData).forEach((key) => {
        try {
          this[key] = dbData[key]
        } catch (err) {
          throw new Error(`${key} is not a defined property for ${this._table}`)
        }
      })
    }

    if (relations && relations.rows.length > 0) {
      await Promise.all(relations.rows.map((row) => {
        try {
          const Model = this[ModelSym].get(row.relation)
          if (!Model) {
            throw new Error(`${row.relation} is not a registered model!`)
          }
          const m = new Model({ id: row.target_id, type: row.target_type })
          this[row.relation] = m
          if (expand) {
            return m.load()
          }
        } catch (err) {
          throw new Error(`${row.relation} is not a defined property for ${this._table}`)
        }
      }))
    }
    this._new = false
  }

  async save () {
    if (!this.id) {
      this.id = uuid()
      this._new = true
    }

    const meta = {
      created: (new Date()).toISOString(),
      updated: (new Date()).toISOString(),
      isDeleted: false
    }

    const { data, complex, relations } = this._parseUpdates()
    const sql = []
    const args = []
    if (this._new) {
      sql.push(format(INSERTSQL, this._table, this._idColumn))
      args.push(this.id)
      args.push(data)
      args.push(meta)
    } else {
      sql.push(format(UPDATESQL, this._table, { updated: meta.updated }, data))
      const bounds = ['WHERE id = $1']
      args.push(this.id)
      const complexKeys = Object.keys(complex)
      if (complexKeys.length > 0) {
        sql.push('|| JSONB_BUILD_OBJECT(')
        for (const key of complexKeys) {
          const field = this._fields[key]
          const val = this._data[key]
          if (field.schemaType === 'array') {
            sql.push(`'${key}', '${JSON.stringify(val)}'::jsonb`)
            bounds.push(`AND NOT data#>'{${key}}' @> '${JSON.stringify(val)}'::jsonb`)
          } else {
            sql.push(`'${key}', ${format('%L', val)}::jsonb`)
          }
        }
        sql.push(')')
      }
      sql.push(bounds.join(' '))
    }

    const relationSQL = format(RELATIONSQL, `${this._table}_relations`)
    const relationsData = []

    for (const [key, relation] of Object.values(relations)) {
      if (Array.isArray(relation)) {
        relation.forEach((rel) => {
          relationsData.push([key, rel.type, rel.id, this.id])
        })
      } else {
        relationsData.push([key, relation.type, relation.id, this.id])
      }
    }

    const client = await this[PoolSym].connect()
    try {
      await client.query('BEGIN')
      await client.query(sql.join(' '), args)
      for (const data of relationsData) {
        await client.query(relationSQL, data)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      this._dirty.length = 0
      this._new = false
      client.release()
    }
  }

  _parseUpdates () {
    const data = {}
    const complex = {}
    const relations = {}
    for (const key of this._dirty) {
      const field = this._fields[key]
      if (key === 'id') continue
      if (field.schemaType === 'relation') {
        relations[key] = this._data[key]
      } else if (field.schemaType === 'array' || field.schemaType === 'object') {
        complex[key] = this._data[key]
      } else {
        data[key] = this._data[key]
      }
    }
    return { data, complex, relations }
  }

  toJSON () {
    const data = {}
    Object.keys(this._data).forEach((key) => {
      if (this._data[key] && typeof this._data[key].toJSON === 'function') {
        data[key] = this._data[key].toJSON()
      } else {
        data[key] = this._data[key]
      }
    })
    return data
  }
}

module.exports = ORM
