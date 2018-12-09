function changeList () {
  const list = []
  const traps = {
    add (target) {
      return function (prop, val) {
        target.push({ change: 'add', prop, val })
      }
    },
    del (target) {
      return function (prop, val) {
        target.push({ change: 'del', prop, val })
      }
    },
    reconcile (target) {
      return function () {
        // no mutations please
        const rev = target.slice(0).reverse()
        return rev.reduce((acc, change) => {
          if (!acc.some((val) => val.prop === change.prop)) acc.push(change)
          return acc
        }, [])
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
    }
  }

  return new Proxy(list, handler)
}

module.exports = changeList
