const uuid = require('uuid/v4')
const joi = require('joi')
const format = require('pg-format')
const debug = require('debug')('parthenon:base-model')

const INSERTSQL = `INSERT INTO %I (%s, data, meta) VALUES ($1, $2, $3)`
const UPDATESQL = `UPDATE %I SET meta = meta || %L, data = data || %L`
const RELATIONSQL = `INSERT INTO %I (relation, target_type, target_id, owner_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`
const SELECTSQL = `SELECT data FROM %I WHERE %s = $1`
const SELECTRELATIONSQL = `SELECT relation, target_type, target_id FROM %I WHERE owner_id = $1`

class BaseModel {
  constructor (data, config, _orm) {
    this._name = config.name
    this._table = config.name || config.tableName
    this._idColumn = config.idColumn || 'id'
    this._idGenerator = config.idGenerator || uuid
    this._data = {}
    this._dirty = []
    this._new = true
    this._fields = config.fields
    this._orm = _orm
    Object.keys(this._fields).forEach((key) => {
      this._define(key)
    })

    if (data) {
      for (const [key, val] of Object.entries(data)) {
        this[key] = val
      }
    }

    return new Proxy(this, {
      set: (obj, prop, val) => {
        const fields = Object.keys(obj._fields)
        if (!fields.includes(prop) && !prop.startsWith('_')) return false
        obj[prop] = val
        return true
      }
    })
  }

  _isArrayField (field) {
    return field.schemaType === 'array' || (field.schemaType === 'relation' && field.multi)
  }

  _define (prop) {
    if (this._isArrayField(this._fields[prop]) && !Array.isArray(this._data[prop])) {
      this._data[prop] = []
    }

    Object.defineProperty(this, prop, {
      get: () => {
        return this._data[prop]
      },
      set: (val) => {
        const field = this._fields[prop]
        if (!field) throw new Error(`${prop} is not a defined property for ${this._table}`)
        const data = this._data[prop]
        if (field.schemaType === 'array') {
          if (!data.find((obj) => obj[this._idColumn] === val[this._idColumn])) {
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
          this._data[prop] = val
        }

        if (prop === this._idColumn) this._new = false
        if (!this._dirty.includes(prop)) this._dirty.push(prop)
      }
    })
  }

  async load (opts) {
    if (!this[this._idColumn]) throw new Error('You must provide an id to load from the database')

    const dataSQL = format(SELECTSQL, this._table, this._idColumn)
    const relationSQL = format(SELECTRELATIONSQL, `${this._table}_relations`)
    const [data, relations] = await Promise.all([
      this._orm.query(dataSQL, [this[this._idColumn]]),
      this._orm.query(relationSQL, [this[this._idColumn]])
    ])

    if (data && data.rows[0]) {
      const dbData = data.rows[0].data
      for (const [key, val] of Object.entries(dbData)) {
        try {
          this[key] = val
        } catch (err) {
          throw new Error(`${key} is not a defined property for ${this._table}`)
        }
      }
    }

    if (relations && relations.rows.length > 0) {
      await Promise.all(relations.rows.map((row) => {
        debug('Processing row %o', row)
        const Model = this._orm._modelCache.get(row.target_type)
        if (!Model) {
          throw new Error(`${row.target_type} is not a registered model!`)
        }
        const m = new Model({ id: row.target_id })
        try {
          this[row.relation] = m
          if (opts.expand) return m.load()
        } catch (err) {
          throw new Error(`${row.relation} is not a defined property for ${this._table}`)
        }
      }))
    }

    this._new = false
  }

  async save () {
    if (!this[this._idColumn]) {
      this[this._idColumn] = this._idGenerator()
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
      args.push(this[this._idColumn])
      args.push(data)
      args.push(meta)
    } else {
      sql.push(format(UPDATESQL, this._table, { updated: meta.updated }, data))
      const bounds = ['WHERE id = $1']
      args.push(this[this._idColumn])

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
    const queries = [{ query: sql.join(' '), args }]

    for (const [key, relation] of Object.entries(relations)) {
      if (Array.isArray(relation)) {
        relation.forEach((rel) => {
          queries.push({ query: relationSQL, args: [key, rel._name, rel[rel._idColumn], this[this._idColumn]] })
        })
      } else {
        queries.push({ query: relationSQL, args: [key, relation._name, relation[relation._idColumn], this[this._idColumn]] })
      }
    }

    debug('Queries to run: %O', queries)

    try {
      await this._orm.transaction(queries)
    } catch (err) {
      throw err
    } finally {
      this._dirty.length = 0
      this._new = false
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

module.exports = BaseModel
