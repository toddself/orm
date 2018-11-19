const joi = require('joi')
const pg = require('pg')
const format = require('pg-format')
const uuid = require('uuid/v4')

const INSERTSQL = `INSERT INTO %I (id, data, meta) VALUES ($1, $2, $3)`
const UPDATESQL = `UPDATE %I SET meta = meta || %L, data = data || %L`
const RELATIONSQL = `INSERT INTO %I SET (relation, target_type, target_id, owner_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`

const TABLE = `CREATE TABLE %I (id uuid, data jsonb, meta jsonb)`
const RELTABLE = `CREATE TABLE $I (id bigserial PRIMARY KEY, relation varchar(64), target_model varchar(64), target_id uuid, owner_id uuid)`

class ORM {
  static setConnection (connection) {
    this._pool = new pg.Pool(connection)
  }

  static async initialize (models) {
    for (const model of models) {
      const tableSQL = format(TABLE, model._table)
      const relSQL = format(RELTABLE, `${model._table}_relation`)
      await ORM._pool.query(tableSQL)
      await ORM._pool.query(relSQL)
    }
  }

  constructor () {
    if (!ORM._pool) throw new Error('You must call ORM.setConnection first')
  }

  makeModel (config) {
    if (!config) throw new Error('You need to supply a configuration')
    class model extends ORM {
      constructor (data) {
        super()
        this.name = config.name
        this._table = config.name || config.tableName
        this._data = {}
        this._dirty = []
        this._new = true
        this._id = null
        this._fields = config.fields
        this._pool = ORM._pool
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
            joi.assert([val], field)
            data.push(val)
          }
        } else {
          if (field.schemaType === 'relation') {
            joi.assert(val, field.validator)
          } else {
            joi.assert(val, field)
          }
          this._data[key] = val
        }

        if (key === 'id') this._new = false
        if (!this._dirty.includes(key)) this._dirty.push(key)
      }
    })
  }

  async load () {
    if (!this.id) throw new Error('You must provide an id to load from the database')
    const dataSQL = format(`SELECT data FROM %I WHERE id = $1`, this._table)
    const relationSQL = format(`SELECT relation, target_type, target_id FROM %I WHERE owner_id = $1`, `${this._table}_relations`)
    const [data, relations] = await Promise.all([
      this._pool.query(dataSQL, [this.id]),
      this._pool.query(relationSQL, [this.id])
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
      relations.rows.forEach((row) => {
        try {
          this[row.relation] = {id: row.target_id, type: row.target_type}
        } catch (err) {
          throw new Error(`${row.relation} is not a defined property for ${this._table}`)
        }
      })
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

    const {data, complex, relations} = this._parseUpdates()
    const sql = []
    const args = []
    if (this._new) {
      sql.push(format(INSERTSQL, this._table))
      args.push(this.id)
      args.push(data)
      args.push(meta)
    } else {
      sql.push(format(UPDATESQL, this._table, {updated: meta.updated}, data))
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

    const client = await this._pool.connect()
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
    return {data, complex, relations}
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
