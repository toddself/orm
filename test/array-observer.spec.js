const { skip, test } = require('tap') // eslint-disable-line
const joi = require('joi')

const makeArray = require('../lib/array-observer')

test('array observer', (t) => {
  const changes = []
  const validator = joi.string()
  const arr = makeArray([], 'test', validator, changes, joi)

  t.test('push', (t) => {
    try {
      arr.push(1)
    } catch (err) {
      t.ok(err, 'cannot push a number')
      t.equal(changes.length, 0, 'no changes recorded')
      t.equal(arr.length, 0, 'no data pushed')
    }
    const newLen = arr.push('foo')
    t.deepEqual(changes[0], { change: 'add', prop: 'test', val: 'foo' }, 'change recorded')
    t.deepEqual(arr, ['foo'], 'foo pushed')
    t.equal(newLen, arr.length, 'length returned')
    t.end()
  })

  t.test('unshift', (t) => {
    try {
      arr.unshift(true)
    } catch (err) {
      t.ok(err, 'cannot push not a string')
      t.equal(changes.length, 1, 'no changed recorded')
      t.equal(arr.length, 1, 'no data unshifted')
    }
    const newLen = arr.unshift('bar')
    t.deepEqual(changes[1], { change: 'add', prop: 'test', val: 'bar' }, 'change recorded')
    t.deepEqual(arr, ['bar', 'foo'], 'bar unshifted')
    t.equal(newLen, arr.length, 'length returned')
    t.end()
  })

  t.test('shift', (t) => {
    const val = arr.shift()
    t.equal(val, 'bar', 'got first element')
    t.deepEqual(arr, ['foo'], 'only foo')
    t.equal(arr.length, 1, 'one element left')
    t.deepEqual(changes[2], { change: 'remove', prop: 'test', val: 'bar' }, 'change recorded')
    t.end()
  })

  t.test('pop', (t) => {
    const val = arr.pop()
    t.equal(val, 'foo', 'got first element')
    t.deepEqual(arr, [], 'nothing')
    t.equal(arr.length, 0, 'no elements left')
    t.deepEqual(changes[3], { change: 'remove', prop: 'test', val: 'foo' }, 'change recorded')
    t.end()
  })

  t.test('fill', (t) => {
    const changeList = []
    const arr = makeArray(['a', 'b', 'c'], 'test2', validator, changeList, joi)
    try {
      arr.fill({})
    } catch (err) {
      t.ok(err, 'cannot fill with a non string')
      t.deepEqual(arr, ['a', 'b', 'c'], 'no changes')
      t.equal(changeList.length, 0, 'no changes')
    }
    arr.fill('beep')
    const expect = [
      { change: 'remove', prop: 'test2', val: 'a' },
      { change: 'remove', prop: 'test2', val: 'b' },
      { change: 'remove', prop: 'test2', val: 'c' },
      { change: 'add', prop: 'test2', val: 'beep' },
      { change: 'add', prop: 'test2', val: 'beep' },
      { change: 'add', prop: 'test2', val: 'beep' }
    ]
    t.deepEqual(arr, ['beep', 'beep', 'beep'], 'beeps all the way down')
    t.deepEqual(changeList, expect, 'changes recorded')
    t.end()
  })

  t.test('indexes', (t) => {
    arr[3] = 'yo'
    t.deepEqual(changes[4], { change: 'add', prop: 'test', val: 'yo' }, 'yo!')
    arr.forEach((val, idx) => {
      t.equal(val, 'yo', 'only has yo')
    })
    arr.length = 0
    t.deepEqual(arr, [], 'no values')
    t.deepEqual(changes[5], { change: 'remove', prop: 'test', val: 'yo' }, 'removed')
    t.end()
  })

  t.end()
})
