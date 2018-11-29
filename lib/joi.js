const joi = require('joi')

function extendJoi (orm) {
  const customJoi = joi.extend((joi) => ({
    name: 'relation',
    language: {
      message: '{{v}} is not oneOf {{m}}'
    },
    rules: [{
      name: 'model',
      params: {
        model: joi.alternatives().try(joi.object(), joi.string())
      },
      validate (params, value, state, options) {
        let model = params.model
        if (typeof model === 'string') {
          model = orm.getModel(model)
        }
        try {
          joi.assert(value, model.fields)
        } catch (err) {
          return this.createError('relation.message', { v: value, m: params.model._name }, state, options)
        }
        return value
      }
    }]
  }))

  const customFields = {
    oneOf (model, relationName) {
      const schema = customJoi.relation().model(model)
      schema._table = model._table || model
      schema._relationName = relationName
      schema._isRelation = true
      schema._relationType = 'single'
      return schema
    },
    manyOf (model, relationName) {
      const schema = joi.array().items(customJoi.relation().model(model))
      schema._table = model._table || model
      schema._relationName = relationName
      schema._isRelation = true
      schema._relationType = 'many'
      return schema
    }
  }
  return Object.assign({}, customJoi, customFields)
}

module.exports = extendJoi
