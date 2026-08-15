let retained

function knownAllocationFreeProbe(value) {
  return value
}

export function exerciseAllocationFreeCall() {
  return knownAllocationFreeProbe(1)
}

export function unsupportedKnownCalleeOutsideProofScope() {
  return knownAllocationFreeProbe(1)
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
  retained = [
    LocalFunction,
    LocalClass,
    objectLiteral,
    arrayLiteral,
    arrow,
    functionExpression,
    classExpression,
    pattern,
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

export function unsupportedGeneratorInvocation() {
  return unsupportedGeneratorPath()
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

export function unsupportedGlobalThisObjectFactory() {
  return globalThis.Object()
}

export function unsupportedGlobalThisArrayFactory() {
  return globalThis.Array()
}

export function unsupportedGlobalThisFunctionFactory() {
  return globalThis.Function('return 1')
}

const aliasedObjectFactory = Object
export function unsupportedAliasedObjectFactory() {
  return aliasedObjectFactory()
}

export function unsupportedGetOwnPropertyNames(value) {
  return Object.getOwnPropertyNames(value)
}

export function unsupportedReflectOwnKeys(value) {
  return Reflect.ownKeys(value)
}

export function unsupportedTypedArrayNew() {
  return new Uint8Array(1)
}

export function unsupportedTypedArraySubarray(value) {
  return value.subarray(0, 1)
}

export function unsupportedTypedArrayFrom(value) {
  return Uint8Array.from(value)
}

export function unsupportedUnknownPropertyCall(value) {
  return value.allocateMaybe()
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
