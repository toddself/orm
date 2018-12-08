const uuid = require('uuid/v4')
const format = require('pg-format')
const debug = require('debug')('parthenon:base-model')

const makeArrayObserver = require('./array-observer')
const parseChanges = require('./parse-changes')

const INSERTSQL = `INSERT INTO %I (%s, data, meta) VALUES ($1, $2, $3)`
const UPDATESQL = `UPDATE %I SET meta = meta || %L, data = data || %L`
const RELATIONSQL = `INSERT INTO %I (relation, %s_id %s_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`
const SELECTSQL = `SELECT data FROM %I WHERE %s = $1`

class BaseModel {
  constructor (data, config, _orm) {
    this._name = config.name
    this._table = config.name || config.tableName
    this._idColumn = config.idColumn || 'id'
    this._idGenerator = config.idGenerator || uuid
    this._data = {}
    this._new = true
    this._orm = _orm
    this._fields = {}
    this._meta = null
    this._dirty = [] // @TODO merge with _changes
    this._changes = []

    // keep track of all models that relate to this one
    this._relatedModels = new Set()
    // the prop name might not be the relation name in the db, so we need a lookup
    // to detemine where on this model the data should be assigned
    this._relationLookup = {}

    this._init(config.fields, data)

    return new Proxy(this, {
      set: (obj, prop, val) => {
        const fields = Object.keys(obj._fields)
        if (!fields.includes(prop) && !prop.startsWith('_')) return false
        obj[prop] = val
        return true
      }
    })
  }

  _init (fields, data) {
    const props = {}
    for (const [prop, field] of Object.entries(fields)) {
      if (!field.isJoi) throw new Error('Fields must be Joi objects')
      this._fields[prop] = field
      if (field._isRelation) {
        this._relatedModels.add(field._table)
        this._relationLookup[field._relationName || prop] = prop
        if (field._relationType === 'many') {
          this._data[prop] = makeArrayObserver([], prop, field, this._changes, this._orm.fields)
        }
      }

      props[prop] = {
        get: () => this._data[prop],
        set: (val) => {
          const type = field.schemaType
          if (type === 'array' || type === 'manyOf') {
            throw new Error(`You must use Array.prototype methods to alter ${prop}`)
          }
          if (field.isJoi) this._orm.fields.assert(val, field)
          else field.validator(val)
          this._data[prop] = val
          if (prop === this._idColumn) this._new = false
        }
      }
    }
    Object.defineProperties(this, props)

    if (data) {
      for (const [key, val] of Object.entries(data)) {
        this[key] = val
      }
    }
  }

  get id () {
    return this[this._idColumn]
  }

  get fields () {
    return this._fields
  }

  get hasRelations () {
    return Object.values(this._fields).some((field) => field._isRelation)
  }

  get meta () {
    if (!this._meta) {
      this._meta = {
        created: (new Date()).toISOString(),
        updated: (new Date()).toISOString(),
        isDeleted: false
      }
    }
    return this._meta
  }

  getRelatedModelName (relation) {
    const field = this._relationType[relation]
    return this._fields[field]._name
  }

  async load (opts) {
    if (!this.id) throw new Error('You must provide an id to load from the database')

    const data = await this._orm.query(format(SELECTSQL, this._table, this._idColumn), [this.id])
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

    if (this.hasRelations) await this._populate(opts)
    this._new = false
  }

  async _populate (opts) {
    const SELECTRELATIONSQL = `SELECT relation, %s_id AS id FROM %I WHERE %s_id = $1`
    const promises = []
    for (const model of this._relatedModels) {
      const table = this._orm.getRelTable(this, model)
      const sql = format(SELECTRELATIONSQL, table, model._table, this._table)
      promises.push(this._orm.query(sql, [this.id]))
    }
    const res = await Promise.all(promises)
    const rows = [].concat.apply(res.map((result) => result.rows))
    await Promise.all(rows.map((row) => this._processRelation(row, opts)))
  }

  async _processRelation ({ relation, id }, opts) {
    const modelName = this.getRelatedModelName(relation)
    const Model = this._orm.getModel(modelName)
    if (!Model) {
      throw new Error(`${modelName} is not a registered model!`)
    }
    const m = new Model({ id })
    if (opts.expand) await m.load()
    const prop = this._relationLookup[relation]
    try {
      if (this._fields[prop]._relationType === 'many') {
        this[prop].push(m)
        // @TODO: set ignore on relation changes
        this._changes.pop()
      } else {
        this[prop] = m
      }
    } catch (err) {
      throw new Error(`${prop} is not a defined property for ${this._table}`)
    }
  }

  async save () {
    if (!this.id) {
      this.id = this._idGenerator()
      this._new = true
    }

    const { simple, complex, relations } = parseChanges(this._dirty, this._fields, this._data)
    let queries = []
    if (this._new) {
      debug(`creating ${this._table}:${this.id}`)
      queries = this._create(simple, relations)
    } else {
      debug(`updating ${this._table}:${this.id}`)
      queries = await this._update(simple, complex, relations)
    }

    debug('queries: %O', queries)

    try {
      await this._orm.transaction(queries)
    } catch (err) {
      throw err
    } finally {
      this._dirty.length = 0
      this._changes.length = 0
      this._new = false
    }
  }

  _create (data, relations) {
    const sql = format(INSERTSQL, this._table, this._idColumn)
    const args = [this.id, data, this.meta]
    return [{ query: sql, args }].concat(this._createRelations(relations))
  }

  _update (simple, complex, relations) {
    const sql = [format(UPDATESQL, this._table, { updated: this.meta.updated }, simple)]
    const args = [this.id]
    const bounds = ['WHERE id = $1']

    // @TODO: can i reduce this complexity with mutliple passes?
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
    return [{ query: sql.join(' '), args }].concat(this._updateRelations(relations))
  }

  // @TODO: this needs to examine the changes feed
  _createRelations (relations) {
    const relationSQL = format(RELATIONSQL, `${this._table}_relations`)
    const queries = []
    for (const [key, relation] of Object.entries(relations)) {
      if (Array.isArray(relation)) {
        relation.forEach((rel) => {
          queries.push({ query: relationSQL, args: [key, rel._name, rel[rel._idColumn], this.id] })
        })
      } else {
        queries.push({ query: relationSQL, args: [key, relation._name, relation[relation._idColumn], this.id] })
      }
    }
    return queries
  }

  // @TODO: this needs to examine the changes feed
  _updateRelations (relations) {
    // const relationSQL = format(RELATIONSQL, `${this._table}_relations`)
  }

  // @TODO: need to reconcile all the changes to cancel out conflicting changes
  _reconcileChanges () {
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
