let retained

class ProbeValue {
  constructor(value) {
    this.value = value
  }
}

export function exerciseExactAllocations() {
  function LocalFunction() { return 1 }
  class LocalClass { method() { return 1 } }
  const objectLiteral = { method() { return 1 } }
  const arrayLiteral = []
  const arrow = () => 1
  const functionExpression = function () { return 1 }
  const classExpression = class { method() { return 1 } }
  const pattern = /allocation-control/
  const created = globalThis.Object.create(null)
  const keys = globalThis.Object.keys({ key: true })
  const values = globalThis.Object.values({ value: true })
  const arrayOf = globalThis.Array.of(1)
  const instance = new ProbeValue(3)
  retained = [
    LocalFunction,
    LocalClass,
    objectLiteral,
    arrayLiteral,
    arrow,
    functionExpression,
    classExpression,
    pattern,
    created,
    keys,
    values,
    arrayOf,
    instance,
  ]
  return retained.length
}

export function unsupportedRestArray(...values) {
  return values.length
}

export function unsupportedArrayDestructuring(values) {
  const [first] = values
  return first
}

let destructured
export function unsupportedDestructuringAssignment(values) {
  ;[destructured] = values
  return destructured
}

export function unsupportedObjectRest(value) {
  const { retained: first, ...rest } = value
  return first ?? rest
}

export function unsupportedSpreadIteration(values) {
  return [...values]
}

export function unsupportedObjectSpread(value) {
  return { ...value }
}

export function unsupportedForOf(values) {
  for (const value of values) return value
  return undefined
}

export function unsupportedExplicitIterator(values) {
  return values[Symbol.iterator]()
}

export function unsupportedIterableConstructor(values) {
  return new Set(values)
}

export function unsupportedIteratorNext(iterator) {
  return iterator.next()
}

export async function unsupportedAsyncPath() {
  await Promise.resolve()
  return 1
}

export function* unsupportedGeneratorPath() {
  yield 1
}

export function unsupportedPromisePath() {
  return Promise.resolve(1)
}

export function unsupportedObjectEntries(value) {
  return Object.entries(value)
}

export function unsupportedDynamicFunctionConstructor() {
  return new Function('return 1')
}

export function unsupportedCallableObjectFactory() {
  return Object()
}

export function unsupportedMatchAll(value) {
  return value.matchAll(/allocation/g)
}

export function unsupportedDynamicImport() {
  return import('node:path')
}

function retainTemplate(strings) {
  return strings
}

export function unsupportedTaggedTemplate() {
  return retainTemplate`allocation`
}

export function unsupportedArgumentsObject() {
  return arguments.length
}
