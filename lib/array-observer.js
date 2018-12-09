function makeArrayObserver (arr, prop, validator, changeList, joi) {
  const traps = {
    push (target) {
      return function (val, opts) {
        joi.assert(val, validator)
        if (!opts.ignore) changeList.add(prop, val)
        return Array.prototype.push.call(target, val)
      }
    },
    unshift (target) {
      return function (val, opts) {
        joi.assert(val, validator)
        if (!opts.ignore) changeList.add(prop, val)
        return Array.prototype.unshift.call(target, val)
      }
    },
    shift (target) {
      return function (opts) {
        if (!opts.ignore) changeList.del(prop, arr[0])
        return Array.prototype.shift.call(target)
      }
    },
    pop (target) {
      return function (opts) {
        if (!opts.ignore) changeList.del(prop, target[target.length - 1])
        return Array.prototype.pop.call(target)
      }
    },
    splice (target) {
      return function (...args) {
        const opts = args[args.length - 1].ignore ? args.pop() : {}
        const start = args[0]
        let len = target.length
        if (typeof args[1] !== 'undefined') len = args[1]
        const vals = args.slice(2)

        for (const val of vals) {
          joi.assert(val, validator)
          if (!opts.ignore) changeList.add(prop, val)
        }

        if (len > 0) {
          const tl = target.length
          for (let i = (start % tl); i <= len; i++) {
            if (i < tl && !opts.ignore) changeList.del(prop, target[i])
          }
        }

        return Array.prototype.splice.apply(target, args)
      }
    },
    fill (target) {
      return function (val, opts) {
        joi.assert(val, validator)
        for (const val of arr) {
          if (!opts.ignore) changeList.del(prop, val)
        }
        Array.prototype.fill.call(target, val)
        for (let i = 0, len = target.length; i < len; i++) {
          if (!opts.ignore) changeList.add(prop, val)
        }
        return target
      }
    }
  }

  const handler = {
    get (target, property) {
      const trapList = Object.keys(traps)
      if (trapList.includes(property)) {
        return traps[property](target)
      } else {
        return target[property]
      }
    },
    set (target, property, val) {
      if (!Number.isNaN(parseInt(property, 10))) {
        joi.assert(val, validator)
        changeList.add(prop, val)
        target[property] = val
        return val
      }

      if (property === 'length') {
        for (const val of target) {
          if (val) changeList.del(prop, val)
        }
        target.length = val
        return val
      }

      target[property] = val
      return val
    }
  }

  for (const val in arr) {
    joi.assert(val, validator)
  }

  return new Proxy(arr, handler)
}

module.exports = makeArrayObserver
