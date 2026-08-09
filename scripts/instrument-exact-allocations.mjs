import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import {
  EXACT_ALLOCATION_COVERAGE_PROTOCOL,
  EXACT_ALLOCATION_GLOBAL_SYMBOL,
  EXACT_ALLOCATION_INSTRUMENTATION,
  EXACT_ALLOCATION_MARKER_PROTOCOL,
  exactPackageJavaScriptFiles,
} from '../fixtures/consumers/exact-allocation-evidence.mjs'

const recorderName = '__wristMenuExactAllocation'
const variableCardinalityMethods = new Set([
  'bind',
  'concat',
  'entries',
  'exec',
  'filter',
  'flat',
  'flatMap',
  'intersectObject',
  'intersectObjects',
  'keys',
  'map',
  'match',
  'matchAll',
  'next',
  'slice',
  'splice',
  'split',
  'toReversed',
  'toSorted',
  'toSpliced',
  'values',
])
const variableCardinalityStaticMethods = new Map([
  ['Array', new Set(['from'])],
  ['JSON', new Set(['parse'])],
  ['Map', new Set(['groupBy'])],
  ['Object', new Set([
    'entries',
    'fromEntries',
    'getOwnPropertyDescriptor',
    'getOwnPropertyDescriptors',
    'groupBy',
  ])],
  ['Proxy', new Set(['revocable'])],
  ['Reflect', new Set(['construct'])],
])
const exactStaticMethods = new Map([
  ['Array', new Set(['of'])],
  ['Object', new Set(['create', 'keys', 'values'])],
])
const promiseMethods = new Set([
  'all',
  'allSettled',
  'any',
  'catch',
  'finally',
  'race',
  'reject',
  'resolve',
  'then',
  'try',
  'withResolvers',
])
const iterableConstructors = new Set(['Map', 'Set', 'WeakMap', 'WeakSet'])
const dynamicConstructors = new Set([
  'AggregateError',
  'AsyncFunction',
  'AsyncGeneratorFunction',
  'Function',
  'GeneratorFunction',
])
const callableObjectFactories = new Set([
  'Array',
  'Error',
  'EvalError',
  'Function',
  'Object',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'SyntaxError',
  'TypeError',
  'URIError',
  'eval',
  'structuredClone',
])

const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex')

function propertyOwnerName(expression) {
  if (!ts.isPropertyAccessExpression(expression)) return undefined
  const owner = expression.expression
  if (ts.isIdentifier(owner)) return { name: owner.text, explicitGlobal: false }
  if (
    ts.isPropertyAccessExpression(owner) &&
    ts.isIdentifier(owner.expression) &&
    owner.expression.text === 'globalThis'
  ) {
    return { name: owner.name.text, explicitGlobal: true }
  }
  return undefined
}

function exactStaticCallKind(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
    return undefined
  }
  const owner = propertyOwnerName(node.expression)
  if (!owner?.explicitGlobal) return undefined
  const method = node.expression.name.text
  return exactStaticMethods.get(owner.name)?.has(method)
    ? `static:${owner.name}.${method}`
    : undefined
}

function isPromiseConstructor(expression) {
  return (
    ts.isIdentifier(expression) && expression.text === 'Promise'
  ) || (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'globalThis' &&
    expression.name.text === 'Promise'
  )
}

function constructorName(expression) {
  if (ts.isIdentifier(expression)) return expression.text
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'globalThis'
  ) {
    return expression.name.text
  }
  return undefined
}

function unsupportedCallKind(node) {
  if (!ts.isCallExpression(node)) return undefined
  if (exactStaticCallKind(node) !== undefined) return undefined
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return 'dynamic-import'
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === 'Promise') {
    return 'promise-path'
  }
  if (
    ts.isIdentifier(node.expression) &&
    callableObjectFactories.has(node.expression.text)
  ) {
    return 'variable-cardinality-call'
  }
  if (ts.isElementAccessExpression(node.expression)) {
    const key = node.expression.argumentExpression
    if (
      ts.isPropertyAccessExpression(key) &&
      (key.name.text === 'iterator' || key.name.text === 'asyncIterator') &&
      (
        (ts.isIdentifier(key.expression) && key.expression.text === 'Symbol') ||
        (
          ts.isPropertyAccessExpression(key.expression) &&
          ts.isIdentifier(key.expression.expression) &&
          key.expression.expression.text === 'globalThis' &&
          key.expression.name.text === 'Symbol'
        )
      )
    ) {
      return 'for-of-iteration'
    }
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined
  const method = node.expression.name.text
  const owner = propertyOwnerName(node.expression)
  if (owner?.name === 'Promise' && promiseMethods.has(method)) {
    return 'promise-path'
  }
  if (promiseMethods.has(method) && ['then', 'catch', 'finally'].includes(method)) {
    return 'promise-path'
  }
  if (owner !== undefined) {
    if (
      variableCardinalityStaticMethods.get(owner.name)?.has(method) ||
      (!owner.explicitGlobal && exactStaticMethods.get(owner.name)?.has(method))
    ) {
      return 'variable-cardinality-call'
    }
  }
  if (variableCardinalityMethods.has(method)) {
    return 'variable-cardinality-call'
  }
  return undefined
}

function methodObjectCount(members) {
  return members.reduce((count, member) => {
    if (
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      return count + 1
    }
    if (ts.isMethodDeclaration(member)) {
      return count + (member.asteriskToken === undefined ? 1 : 2)
    }
    return count
  }, 0)
}

function functionObjectCount(node) {
  const asyncFunction = node.modifiers?.some(
    ({ kind }) => kind === ts.SyntaxKind.AsyncKeyword,
  ) ?? false
  return asyncFunction && node.asteriskToken === undefined ? 1 : 2
}

function exactAllocation(node) {
  if (ts.isObjectLiteralExpression(node)) {
    return {
      kind: 'object-literal',
      objectsPerEvaluation: 1 + methodObjectCount(node.properties),
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    return { kind: 'array-literal', objectsPerEvaluation: 1 }
  }
  if (ts.isNewExpression(node)) {
    if (isPromiseConstructor(node.expression)) return undefined
    return { kind: 'new-expression', objectsPerEvaluation: 1 }
  }
  if (ts.isArrowFunction(node)) {
    return { kind: 'arrow-function', objectsPerEvaluation: 1 }
  }
  if (ts.isFunctionExpression(node)) {
    return {
      kind: 'function-expression',
      objectsPerEvaluation: functionObjectCount(node),
    }
  }
  if (ts.isClassExpression(node)) {
    return {
      kind: 'class-expression',
      objectsPerEvaluation: 2 + methodObjectCount(node.members),
    }
  }
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    return { kind: 'regexp-literal', objectsPerEvaluation: 1 }
  }
  const staticKind = exactStaticCallKind(node)
  return staticKind === undefined
    ? undefined
    : { kind: staticKind, objectsPerEvaluation: 1 }
}

function bindingUnsupportedKinds(name) {
  const kinds = new Set()
  const visit = (node) => {
    if (ts.isArrayBindingPattern(node)) kinds.add('destructuring-iteration')
    if (ts.isBindingElement(node) && node.dotDotDotToken !== undefined) {
      kinds.add(
        ts.isObjectBindingPattern(node.parent) ? 'object-rest' : 'rest-array',
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(name)
  return [...kinds]
}

function functionUsesArguments(node) {
  if (ts.isArrowFunction(node) || node.body === undefined) return false
  let found = false
  const visit = (child) => {
    if (found) return
    if (
      child !== node &&
      ts.isFunctionLike(child) &&
      !ts.isArrowFunction(child)
    ) {
      return
    }
    if (ts.isIdentifier(child) && child.text === 'arguments') {
      found = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node.body)
  return found
}

function insertAfterDirectives(statements, additions) {
  if (additions.length === 0) return statements
  let directiveCount = 0
  while (
    directiveCount < statements.length &&
    ts.isExpressionStatement(statements[directiveCount]) &&
    ts.isStringLiteral(statements[directiveCount].expression)
  ) {
    directiveCount += 1
  }
  return [
    ...statements.slice(0, directiveCount),
    ...additions,
    ...statements.slice(directiveCount),
  ]
}

function instrumentSource(source, path, firstSiteId) {
  if (source.includes(recorderName)) {
    throw new Error(`candidate output already contains ${recorderName}: ${path}`)
  }
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  if (sourceFile.parseDiagnostics.length !== 0) {
    throw new Error(`candidate output cannot be parsed completely: ${path}`)
  }
  let sourceNodeCount = 0
  const countSourceNodes = (node) => {
    sourceNodeCount += 1
    ts.forEachChild(node, countSourceNodes)
  }
  countSourceNodes(sourceFile)

  const sites = []
  const transformer = (context) => {
    const { factory } = context
    const functionEntrySites = new WeakMap()
    const blockEntrySites = new WeakMap()
    const switchFunctionDeclarations = new WeakSet()

    const register = (
      node,
      classification,
      kind,
      objectsPerEvaluation = null,
    ) => {
      const id = firstSiteId + sites.length
      const position = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      )
      const site = {
        id,
        path,
        line: position.line + 1,
        column: position.character + 1,
        classification,
        kind,
        objectsPerEvaluation,
      }
      sites.push(site)
      return site
    }

    const recordCall = (site) => factory.createCallExpression(
      factory.createIdentifier(recorderName),
      undefined,
      [
        factory.createNumericLiteral(site.id),
        factory.createNumericLiteral(site.objectsPerEvaluation ?? 0),
      ],
    )
    const recordStatement = (site) =>
      factory.createExpressionStatement(recordCall(site))
    const recordBefore = (site, expression) =>
      factory.createParenthesizedExpression(
        factory.createCommaListExpression([recordCall(site), expression]),
      )
    const recordAfter = (site, expression) => factory.createCallExpression(
      factory.createIdentifier(recorderName),
      undefined,
      [
        factory.createNumericLiteral(site.id),
        factory.createNumericLiteral(site.objectsPerEvaluation ?? 0),
        expression,
      ],
    )

    const entrySites = (node) => {
      const cached = functionEntrySites.get(node)
      if (cached !== undefined) return cached
      const entries = []
      if (node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.AsyncKeyword)) {
        entries.push(register(node, 'unsupported', 'async-path'))
      }
      if (node.asteriskToken !== undefined) {
        entries.push(register(node, 'unsupported', 'generator-path'))
      }
      for (const parameter of node.parameters) {
        if (parameter.dotDotDotToken !== undefined) {
          entries.push(register(parameter, 'unsupported', 'rest-array'))
        }
        for (const kind of bindingUnsupportedKinds(parameter.name)) {
          entries.push(register(parameter.name, 'unsupported', kind))
        }
      }
      if (functionUsesArguments(node)) {
        entries.push(register(node, 'unsupported', 'arguments-object'))
      }
      functionEntrySites.set(node, entries)
      return entries
    }

    const declarationSite = (node) => {
      if (ts.isFunctionDeclaration(node)) {
        return register(
          node,
          'exact',
          'function-declaration',
          functionObjectCount(node),
        )
      }
      return register(
        node,
        'exact',
        'class-declaration',
        2 + methodObjectCount(node.members),
      )
    }

    const transformStatements = (statements, functionEntries = []) => {
      const functionDeclarationSites = statements
        .filter(
          (statement) =>
            ts.isFunctionDeclaration(statement) &&
            !switchFunctionDeclarations.has(statement),
        )
        .map(declarationSite)
      const transformed = []
      for (const statement of statements) {
        if (ts.isClassDeclaration(statement)) {
          transformed.push(recordStatement(declarationSite(statement)))
        }
        transformed.push(ts.visitNode(statement, visit))
      }
      return insertAfterDirectives(
        transformed,
        [...functionEntries, ...functionDeclarationSites].map(recordStatement),
      )
    }

    const visit = (node) => {
      if (ts.isSourceFile(node)) {
        return factory.updateSourceFile(node, transformStatements(node.statements))
      }

      if (ts.isBlock(node)) {
        const parentEntries =
          ts.isFunctionLike(node.parent) && node.parent.body === node
            ? entrySites(node.parent)
            : []
        const additionalEntries = blockEntrySites.get(node) ?? []
        return factory.updateBlock(
          node,
          transformStatements(
            node.statements,
            [...parentEntries, ...additionalEntries],
          ),
        )
      }

      if (ts.isSwitchStatement(node)) {
        const declarationSites = []
        for (const clause of node.caseBlock.clauses) {
          for (const statement of clause.statements) {
            if (ts.isFunctionDeclaration(statement)) {
              switchFunctionDeclarations.add(statement)
              declarationSites.push(declarationSite(statement))
            }
          }
        }
        let expression = ts.visitNode(node.expression, visit)
        for (const site of declarationSites) {
          expression = recordAfter(site, expression)
        }
        return factory.updateSwitchStatement(
          node,
          expression,
          ts.visitNode(node.caseBlock, visit),
        )
      }

      if (ts.isCaseClause(node)) {
        return factory.updateCaseClause(
          node,
          ts.visitNode(node.expression, visit),
          transformStatements(node.statements),
        )
      }

      if (ts.isDefaultClause(node)) {
        return factory.updateDefaultClause(
          node,
          transformStatements(node.statements),
        )
      }

      if (ts.isCatchClause(node)) {
        if (node.variableDeclaration !== undefined) {
          const entries = bindingUnsupportedKinds(node.variableDeclaration.name)
            .map((kind) => register(
              node.variableDeclaration.name,
              'unsupported',
              kind,
            ))
          if (entries.length !== 0) blockEntrySites.set(node.block, entries)
        }
        return factory.updateCatchClause(
          node,
          node.variableDeclaration === undefined
            ? undefined
            : ts.visitNode(node.variableDeclaration, visit),
          ts.visitNode(node.block, visit),
        )
      }

      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const visitedName = ts.visitNode(node.name, visit)
        let initializer = ts.visitNode(node.initializer, visit)
        for (const kind of bindingUnsupportedKinds(node.name)) {
          initializer = recordBefore(
            register(node.name, 'unsupported', kind),
            initializer,
          )
        }
        return factory.updateVariableDeclaration(
          node,
          visitedName,
          node.exclamationToken,
          node.type,
          initializer,
        )
      }

      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (
          ts.isArrayLiteralExpression(node.left) ||
          ts.isObjectLiteralExpression(node.left)
        )
      ) {
        const right = ts.visitNode(node.right, visit)
        return factory.updateBinaryExpression(
          node,
          node.left,
          node.operatorToken,
          recordAfter(
            register(node.left, 'unsupported', 'destructuring-assignment'),
            right,
          ),
        )
      }

      if (ts.isSpreadElement(node)) {
        const expression = ts.visitNode(node.expression, visit)
        return factory.updateSpreadElement(
          node,
          recordBefore(
            register(node, 'unsupported', 'spread-iteration'),
            expression,
          ),
        )
      }

      if (ts.isSpreadAssignment(node)) {
        const expression = ts.visitNode(node.expression, visit)
        return factory.updateSpreadAssignment(
          node,
          recordBefore(
            register(node, 'unsupported', 'object-spread'),
            expression,
          ),
        )
      }

      if (ts.isForOfStatement(node)) {
        const awaitModifier = node.awaitModifier === undefined
          ? undefined
          : ts.visitNode(node.awaitModifier, visit)
        const initializer = ts.visitNode(node.initializer, visit)
        const expression = ts.visitNode(node.expression, visit)
        const statement = ts.visitNode(node.statement, visit)
        return factory.updateForOfStatement(
          node,
          awaitModifier,
          initializer,
          recordBefore(
            register(node, 'unsupported', 'for-of-iteration'),
            expression,
          ),
          statement,
        )
      }

      const visited = ts.visitEachChild(node, visit, context)

      if (
        ts.isArrowFunction(node) &&
        !ts.isBlock(node.body) &&
        entrySites(node).length !== 0
      ) {
        const arrow = visited
        const body = factory.createBlock([
          ...entrySites(node).map(recordStatement),
          factory.createReturnStatement(arrow.body),
        ], true)
        const updated = factory.updateArrowFunction(
          arrow,
          arrow.modifiers,
          arrow.typeParameters,
          arrow.parameters,
          arrow.type,
          arrow.equalsGreaterThanToken,
          body,
        )
        const exact = exactAllocation(node)
        return exact === undefined
          ? updated
          : recordBefore(
              register(
                node,
                'exact',
                exact.kind,
                exact.objectsPerEvaluation,
              ),
              updated,
            )
      }

      let unsupportedKind
      if (ts.isNewExpression(node) && isPromiseConstructor(node.expression)) {
        unsupportedKind = 'promise-path'
      } else if (
        ts.isNewExpression(node) &&
        (node.arguments?.length ?? 0) !== 0 &&
        iterableConstructors.has(constructorName(node.expression))
      ) {
        unsupportedKind = 'for-of-iteration'
      } else if (
        ts.isNewExpression(node) &&
        dynamicConstructors.has(constructorName(node.expression))
      ) {
        unsupportedKind = 'variable-cardinality-call'
      } else if (ts.isTaggedTemplateExpression(node)) {
        unsupportedKind = 'tagged-template'
      } else if (ts.isAwaitExpression(node)) {
        unsupportedKind = 'async-path'
      } else if (ts.isYieldExpression(node)) {
        unsupportedKind = 'generator-path'
      } else {
        unsupportedKind = unsupportedCallKind(node)
      }
      if (unsupportedKind !== undefined) {
        return recordBefore(
          register(node, 'unsupported', unsupportedKind),
          visited,
        )
      }

      const exact = exactAllocation(node)
      if (exact === undefined) return visited
      return recordBefore(
        register(node, 'exact', exact.kind, exact.objectsPerEvaluation),
        visited,
      )
    }

    return (root) => {
      const visited = ts.visitNode(root, visit)
      if (sites.length === 0) return visited
      const recorder = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList(
          [factory.createVariableDeclaration(
            recorderName,
            undefined,
            undefined,
            factory.createElementAccessExpression(
              factory.createIdentifier('globalThis'),
              factory.createCallExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier('Symbol'),
                  'for',
                ),
                undefined,
                [factory.createStringLiteral(EXACT_ALLOCATION_GLOBAL_SYMBOL)],
              ),
            ),
          )],
          ts.NodeFlags.Const,
        ),
      )
      return factory.updateSourceFile(
        visited,
        [recorder, ...visited.statements],
      )
    }
  }

  const result = ts.transform(sourceFile, [transformer])
  try {
    return {
      output: ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
        .printFile(result.transformed[0]),
      sites,
      visitedNodeCount: sourceNodeCount,
    }
  } finally {
    result.dispose()
  }
}

export async function instrumentExactPackageAllocations(packageRoot) {
  const absoluteRoot = resolve(packageRoot)
  const files = []
  const sites = []
  for (const { absolutePath, path } of await exactPackageJavaScriptFiles(
    absoluteRoot,
  )) {
    const source = await readFile(absolutePath, 'utf8')
    const instrumented = instrumentSource(source, path, sites.length)
    const output = `${instrumented.output.trimEnd()}\n`
    await writeFile(absolutePath, output)
    sites.push(...instrumented.sites)
    const exactSiteCount = instrumented.sites.filter(
      ({ classification }) => classification === 'exact',
    ).length
    const unsupportedSiteCount = instrumented.sites.length - exactSiteCount
    files.push({
      path,
      sourceSha256: sha256(source),
      instrumentedSha256: sha256(output),
      siteCount: instrumented.sites.length,
      visitedNodeCount: instrumented.visitedNodeCount,
      exactSiteCount,
      unsupportedSiteCount,
    })
  }
  const exactSiteCount = sites.filter(
    ({ classification }) => classification === 'exact',
  ).length
  const marker = {
    schemaVersion: EXACT_ALLOCATION_MARKER_PROTOCOL.schemaVersion,
    instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
    globalSymbol: EXACT_ALLOCATION_GLOBAL_SYMBOL,
    coverage: {
      classifier: {
        id: EXACT_ALLOCATION_COVERAGE_PROTOCOL.id,
        version: EXACT_ALLOCATION_COVERAGE_PROTOCOL.version,
      },
      status: 'complete',
      visitedNodeCount: files.reduce(
        (total, file) => total + file.visitedNodeCount,
        0,
      ),
      exactSiteCount,
      unsupportedSiteCount: sites.length - exactSiteCount,
      exactKinds: EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds,
      unsupportedKinds: EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds,
    },
    siteCount: sites.length,
    files,
    sites,
  }
  await writeFile(
    resolve(absoluteRoot, EXACT_ALLOCATION_MARKER_PROTOCOL.filename),
    `${JSON.stringify(marker, null, 2)}\n`,
    { flag: 'wx' },
  )
  return marker
}

const invokedPath = process.argv[1] === undefined
  ? undefined
  : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  const packageRoot = process.argv[2]
  if (packageRoot === undefined) {
    throw new Error('usage: node scripts/instrument-exact-allocations.mjs <package-root>')
  }
  const marker = await instrumentExactPackageAllocations(packageRoot)
  console.log(JSON.stringify({
    instrumentation: marker.instrumentation,
    files: marker.files.length,
    allocationSites: marker.siteCount,
    coverage: marker.coverage,
  }))
}
