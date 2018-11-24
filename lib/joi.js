const joi = require('joi')
  .extend((joi) => ({
    name: 'oneOf',
    language: {
      single: '{{v}} is not a oneOf relation'
    },
    rules: [{
      name: 'model',
      params: {
        model: joi.object()
      },
      validate (params, value, state, options) {
        try {
          joi.assert(value, params.model)
        } catch (err) {
          return this.createError('relation.single', { v: value }, state, options)
        }
        return value
      }
    }]
  }))
  .extend((joi) => ({
    name: 'manyOf',
    language: {
      multiple: '{{v}} is not a manyOf relation'
    },
    rules: [{
      name: 'model',
      params: {
        model: joi.object()
      },
      validate (params, value, state, options) {
        const validator = joi.array().items(params.model)
        try {
          joi.assert(value, validator)
        } catch (err) {
          return this.createError('relation.multiple', { v: value }, state, options)
        }
        return value
      }
    }]
  }))

module.exports = joi
