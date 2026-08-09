import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

import {
  EXACT_ALLOCATION_COVERAGE_PROTOCOL,
  EXACT_ALLOCATION_GLOBAL_SYMBOL,
  EXACT_ALLOCATION_INSTRUMENTATION,
  EXACT_ALLOCATION_MARKER_PROTOCOL,
  EXACT_ALLOCATION_RUNTIME_PROTOCOL,
  exactPackageJavaScriptFiles,
} from '../fixtures/consumers/exact-allocation-evidence.mjs'

const recorderName = EXACT_ALLOCATION_RUNTIME_PROTOCOL.recorderName

const sha256 = (bytes) =>
  createHash('sha256').update(bytes).digest('hex')

/**
 * Calls admitted by the zero-allocation protocol. Each entry names one emitted
 * package callee identity; everything else is guarded unsupported. Keep this
 * registry deliberately narrow and evidence-specific.
 */
const packageCallReason =
  'resolved ordinary synchronous package call constructs no object at the call site; its body is independently classified'
const hostCallReason =
  'XR host-boundary call constructs no package-owned source object; host return values are outside package attribution'
const collectionReadReason =
  'preallocated WeakMap/WeakSet lookup constructs no JavaScript object'
const allocationFreeCallRegistry = Object.freeze([
  {
    id: 'free.probe.known-sync-call',
    path: 'dist/probe.js',
    identity: 'knownAllocationFreeProbe',
    scopes: ['exerciseAllocationFreeCall'],
    reason: packageCallReason,
    proof: { kind: 'function-declaration' },
  },
  {
    id: 'free.three-index.assert-active',
    path: 'dist/three/index.js',
    identity: 'assertActive',
    scopes: ['updateThreeWristMenu'],
    reason: packageCallReason,
    proof: { kind: 'function-declaration' },
  },
  {
    id: 'free.three-index.set-observation-context',
    path: 'dist/three/index.js',
    identity: 'setSteadyFrameObservationContext',
    scopes: ['updateThreeWristMenu'],
    reason: packageCallReason,
    proof: {
      kind: 'relative-import',
      module: './steady-frame.js',
      imported: 'setSteadyFrameObservationContext',
    },
  },
  {
    id: 'free.three-index.presentation-state-changed',
    path: 'dist/three/index.js',
    identity: 'steadyPresentationStateChanged',
    scopes: ['updateThreeWristMenu'],
    reason: packageCallReason,
    proof: {
      kind: 'relative-import',
      module: './steady-frame.js',
      imported: 'steadyPresentationStateChanged',
    },
  },
  {
    id: 'free.three-index.observe-steady-frame',
    path: 'dist/three/index.js',
    identity: 'observeSteadyFrame',
    scopes: ['updateThreeWristMenu'],
    reason: packageCallReason,
    proof: {
      kind: 'relative-import',
      module: './steady-frame.js',
      imported: 'observeSteadyFrame',
    },
  },
  {
    id: 'free.three-index.advance-settled-runtime',
    path: 'dist/three/index.js',
    identity: 'advanceSettledRuntimeFrame',
    scopes: ['updateThreeWristMenu'],
    reason: packageCallReason,
    proof: {
      kind: 'relative-import',
      module: '../core/runtime-internals.js',
      imported: 'advanceSettledRuntimeFrame',
    },
  },
  {
    id: 'free.three-index.xr-session-read',
    path: 'dist/three/index.js',
    identity: 'state.renderer.xr.getSession',
    scopes: ['updateThreeWristMenu'],
    reason: hostCallReason,
    proof: { kind: 'exact-property-access' },
  },
  {
    id: 'free.three-index.xr-reference-space-read',
    path: 'dist/three/index.js',
    identity: 'state.renderer.xr.getReferenceSpace',
    scopes: ['updateThreeWristMenu'],
    reason: hostCallReason,
    proof: { kind: 'exact-property-access' },
  },
  {
    id: 'free.steady-frame.observe-group-transform',
    path: 'dist/three/steady-frame.js',
    identity: 'observeGroupTransform',
    scopes: ['steadyPresentationStateChanged', 'observeSteadyFrame'],
    reason: packageCallReason,
    proof: { kind: 'function-declaration' },
  },
  {
    id: 'free.steady-frame.observe-pose',
    path: 'dist/three/steady-frame.js',
    identity: 'observePose',
    scopes: ['observeSource'],
    reason: packageCallReason,
    proof: { kind: 'function-declaration' },
  },
  {
    id: 'free.steady-frame.observe-source',
    path: 'dist/three/steady-frame.js',
    identity: 'observeSource',
    scopes: ['observeSteadyFrame'],
    reason: packageCallReason,
    proof: { kind: 'function-declaration' },
  },
  {
    id: 'free.steady-frame-pressed-read',
    path: 'dist/three/steady-frame.js',
    identity: 'sourcePressed.get',
    scopes: ['observeSource'],
    reason: collectionReadReason,
    proof: { kind: 'exact-property-access' },
  },
  {
    id: 'free.steady-frame-completed-read',
    path: 'dist/three/steady-frame.js',
    identity: 'sourceCompleted.has',
    scopes: ['observeSource'],
    reason: collectionReadReason,
    proof: { kind: 'exact-property-access' },
  },
  {
    id: 'free.steady-frame-signature-source-read',
    path: 'dist/three/steady-frame.js',
    identity: 'signature.sources.get',
    scopes: ['observeSteadyFrame'],
    reason: collectionReadReason,
    proof: { kind: 'exact-property-access' },
  },
  {
    id: 'free.steady-frame-xr-pose-read',
    path: 'dist/three/steady-frame.js',
    identity: 'frame.getPose',
    scopes: ['observeSource'],
    reason: hostCallReason,
    proof: { kind: 'exact-property-access' },
  },
  {
    id: 'free.steady-frame-xr-viewer-pose-read',
    path: 'dist/three/steady-frame.js',
    identity: 'frame.getViewerPose',
    scopes: ['observeSteadyFrame'],
    reason: hostCallReason,
    proof: { kind: 'exact-property-access' },
  },
])

function invocationIdentity(node, sourceFile) {
  return node.expression.getText(sourceFile)
}

function invocationScope(node, sourceFile) {
  let current = node.parent
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      return current.name.text
    }
    if (ts.isMethodDeclaration(current)) {
      return current.name.getText(sourceFile)
    }
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text
    }
    current = current.parent
  }
  return '<module>'
}

function exactInvocationDescriptor() {
  // No CallExpression or NewExpression currently has a source-level fixed
  // object cardinality proof. Literal/declaration handlers below provide the
  // exact categories; invocation coverage remains default-deny.
  return undefined
}

function ordinaryFunctionDeclarationMatches(sourceFile, identity) {
  const declarations = sourceFile.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === identity,
  )
  if (declarations.length !== 1) return false
  const declaration = declarations[0]
  return (
    declaration.asteriskToken === undefined &&
    !(declaration.modifiers?.some(
      ({ kind }) => kind === ts.SyntaxKind.AsyncKeyword,
    ) ?? false) &&
    declaration.parameters.every(
      (parameter) =>
        parameter.dotDotDotToken === undefined &&
        ts.isIdentifier(parameter.name),
    ) &&
    !functionUsesArguments(declaration)
  )
}

function relativeImportMatches(
  sourceFile,
  path,
  identity,
  proof,
  packageSources,
) {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== proof.module
    ) {
      continue
    }
    const bindings = statement.importClause?.namedBindings
    if (!ts.isNamedImports(bindings)) continue
    if (bindings.elements.some((element) => (
      element.name.text === identity &&
      (element.propertyName?.text ?? element.name.text) === proof.imported
    ))) {
      const targetPath = posix.normalize(
        posix.join(posix.dirname(path), proof.module),
      )
      const targetSource = packageSources.get(targetPath)
      if (targetSource === undefined) return false
      const targetFile = ts.createSourceFile(
        targetPath,
        targetSource,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      )
      return ordinaryFunctionDeclarationMatches(targetFile, proof.imported)
    }
  }
  return false
}

function allocationFreeProofMatches(
  registered,
  node,
  sourceFile,
  path,
  packageSources,
) {
  if (registered.proof.kind === 'function-declaration') {
    return ordinaryFunctionDeclarationMatches(sourceFile, registered.identity)
  }
  if (registered.proof.kind === 'relative-import') {
    return relativeImportMatches(
      sourceFile,
      path,
      registered.identity,
      registered.proof,
      packageSources,
    )
  }
  return (
    registered.proof.kind === 'exact-property-access' &&
    ts.isPropertyAccessExpression(node.expression)
  )
}

function allocationFreeCallDescriptor(node, sourceFile, path, packageSources) {
  if (!ts.isCallExpression(node)) return undefined
  const callee = invocationIdentity(node, sourceFile)
  const scope = invocationScope(node, sourceFile)
  const registered = allocationFreeCallRegistry.find(
    (entry) =>
      entry.path === path &&
      entry.identity === callee &&
      entry.scopes.includes(scope) &&
      allocationFreeProofMatches(
        entry,
        node,
        sourceFile,
        path,
        packageSources,
      ),
  )
  if (registered === undefined) return undefined
  return {
    classification: 'allocation-free',
    kind: 'call-expression',
    objectsPerEvaluation: null,
    descriptorId: registered.id,
    identity: `${path}#${scope}:${callee}`,
    reason: registered.reason,
  }
}

function unsupportedInvocationDescriptor(node, sourceFile) {
  const call = ts.isCallExpression(node)
  const callee = invocationIdentity(node, sourceFile)
  const scope = invocationScope(node, sourceFile)
  return {
    classification: 'unsupported',
    kind: call && node.expression.kind === ts.SyntaxKind.ImportKeyword
      ? 'dynamic-import'
      : call ? 'call-expression' : 'new-expression',
    objectsPerEvaluation: null,
    descriptorId: call
      ? 'unsupported.call.default-deny'
      : 'unsupported.new.default-deny',
    identity: `${scope}:${callee}`,
    reason: call
      ? 'callee identity has no fixed-cardinality or allocation-free protocol proof'
      : 'constructor cardinality is not generically one and has no exact protocol proof',
  }
}

const invocationDescriptorHandlers = Object.freeze([
  exactInvocationDescriptor,
  allocationFreeCallDescriptor,
  unsupportedInvocationDescriptor,
])

function describeInvocation(node, sourceFile, path, packageSources) {
  for (const handler of invocationDescriptorHandlers) {
    const descriptor = handler(node, sourceFile, path, packageSources)
    if (descriptor !== undefined) return descriptor
  }
  throw new Error(`allocation descriptor registry did not classify ${path}`)
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
  return undefined
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

function instrumentSource(source, path, firstSiteId, packageSources) {
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
  let callExpressionCount = 0
  let newExpressionCount = 0
  const countSourceNodes = (node) => {
    sourceNodeCount += 1
    if (ts.isCallExpression(node)) callExpressionCount += 1
    if (ts.isNewExpression(node)) newExpressionCount += 1
    ts.forEachChild(node, countSourceNodes)
  }
  countSourceNodes(sourceFile)

  const sites = []
  const transformer = (context) => {
    const { factory } = context
    const functionEntrySites = new WeakMap()
    const blockEntrySites = new WeakMap()
    const switchFunctionDeclarations = new WeakSet()
    const describedInvocations = new WeakSet()

    const register = (
      node,
      classification,
      kind,
      objectsPerEvaluation = null,
      descriptor = {},
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
        nodeKind: ts.SyntaxKind[node.kind],
        descriptorId: descriptor.descriptorId ?? `${classification}.${kind}`,
        identity: descriptor.identity ?? kind,
        reason: descriptor.reason ?? (
          classification === 'exact'
            ? `${kind} has fixed source-language object cardinality`
            : `${kind} cannot be counted exactly by this protocol`
        ),
      }
      sites.push(site)
      return site
    }

    const registerInvocation = (node) => {
      if (describedInvocations.has(node)) {
        throw new Error(`invocation received more than one descriptor: ${path}`)
      }
      describedInvocations.add(node)
      const descriptor = describeInvocation(
        node,
        sourceFile,
        path,
        packageSources,
      )
      return register(
        node,
        descriptor.classification,
        descriptor.kind,
        descriptor.objectsPerEvaluation,
        descriptor,
      )
    }

    const recordCall = (site) => factory.createCallExpression(
      factory.createIdentifier(recorderName),
      undefined,
      [
        factory.createStringLiteral(
          site.classification === 'exact'
            ? EXACT_ALLOCATION_RUNTIME_PROTOCOL.exactToken
            : EXACT_ALLOCATION_RUNTIME_PROTOCOL.unsupportedToken,
        ),
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
        factory.createStringLiteral(
          site.classification === 'exact'
            ? EXACT_ALLOCATION_RUNTIME_PROTOCOL.exactToken
            : EXACT_ALLOCATION_RUNTIME_PROTOCOL.unsupportedToken,
        ),
        factory.createNumericLiteral(site.id),
        factory.createNumericLiteral(site.objectsPerEvaluation ?? 0),
        expression,
      ],
    )
    const guardUnsupportedFunctionInvocation = (entrySites, target) =>
      factory.createNewExpression(
        factory.createIdentifier('Proxy'),
        undefined,
        [
          target,
          factory.createObjectLiteralExpression([
            factory.createMethodDeclaration(
              undefined,
              undefined,
              'apply',
              undefined,
              undefined,
              [
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  'target',
                ),
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  'thisArg',
                ),
                factory.createParameterDeclaration(
                  undefined,
                  undefined,
                  'args',
                ),
              ],
              undefined,
              factory.createBlock([
                ...entrySites.map(recordStatement),
                factory.createReturnStatement(
                  factory.createCallExpression(
                    factory.createPropertyAccessExpression(
                      factory.createIdentifier('Reflect'),
                      'apply',
                    ),
                    undefined,
                    [
                      factory.createIdentifier('target'),
                      factory.createIdentifier('thisArg'),
                      factory.createIdentifier('args'),
                    ],
                  ),
                ),
              ], true),
            ),
          ], true),
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
      const functionDeclarations = statements
        .filter(
          (statement) =>
            ts.isFunctionDeclaration(statement) &&
            !switchFunctionDeclarations.has(statement),
        )
      const functionDeclarationSites = functionDeclarations.map(declarationSite)
      const invocationGuards = functionDeclarations.flatMap((declaration) => {
        const invocationEntries = entrySites(declaration).filter(
          ({ kind }) => kind === 'generator-path' || kind === 'async-path',
        )
        if (invocationEntries.length === 0) return []
        if (declaration.name === undefined) {
          throw new Error(`anonymous function declaration cannot be guarded: ${path}`)
        }
        return [factory.createExpressionStatement(
          factory.createAssignment(
            factory.createIdentifier(declaration.name.text),
            guardUnsupportedFunctionInvocation(
              invocationEntries,
              factory.createIdentifier(declaration.name.text),
            ),
          ),
        )]
      })
      const transformed = []
      for (const statement of statements) {
        if (ts.isClassDeclaration(statement)) {
          transformed.push(recordStatement(declarationSite(statement)))
        }
        transformed.push(ts.visitNode(statement, visit))
      }
      return insertAfterDirectives(
        transformed,
        [
          ...[...functionEntries, ...functionDeclarationSites].map(
            recordStatement,
          ),
          ...invocationGuards,
        ],
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
              if (
                statement.asteriskToken !== undefined ||
                (statement.modifiers?.some(
                  ({ kind }) => kind === ts.SyntaxKind.AsyncKeyword,
                ) ?? false)
              ) {
                throw new Error(
                  `switch-scoped async/generator invocation cannot be guarded exactly: ${path}`,
                )
              }
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
        ts.isMethodDeclaration(node) &&
        (
          node.asteriskToken !== undefined ||
          (node.modifiers?.some(
            ({ kind }) => kind === ts.SyntaxKind.AsyncKeyword,
          ) ?? false)
        )
      ) {
        throw new Error(
          `async/generator method invocation cannot be guarded exactly: ${path}`,
        )
      }

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
        const invocationEntries = entrySites(node).filter(
          ({ kind }) => kind === 'generator-path' || kind === 'async-path',
        )
        const callable = invocationEntries.length === 0
          ? updated
          : guardUnsupportedFunctionInvocation(invocationEntries, updated)
        const exact = exactAllocation(node)
        return exact === undefined
          ? callable
          : recordBefore(
              register(
                node,
                'exact',
                exact.kind,
                exact.objectsPerEvaluation,
              ),
              callable,
            )
      }

      if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        const invocationEntries = entrySites(node).filter(
          ({ kind }) => kind === 'generator-path' || kind === 'async-path',
        )
        if (invocationEntries.length !== 0) {
          const exact = exactAllocation(node)
          const guarded = guardUnsupportedFunctionInvocation(
            invocationEntries,
            visited,
          )
          return exact === undefined
            ? guarded
            : recordBefore(
                register(
                  node,
                  'exact',
                  exact.kind,
                  exact.objectsPerEvaluation,
                ),
                guarded,
              )
        }
      }

      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const site = registerInvocation(node)
        return site.classification === 'allocation-free'
          ? visited
          : recordBefore(site, visited)
      }

      let unsupportedKind
      if (ts.isTaggedTemplateExpression(node)) {
        unsupportedKind = 'tagged-template'
      } else if (ts.isAwaitExpression(node)) {
        unsupportedKind = 'async-path'
      } else if (ts.isYieldExpression(node)) {
        unsupportedKind = 'generator-path'
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
    const callDescriptorCount = sites.filter(
      ({ nodeKind }) => nodeKind === 'CallExpression',
    ).length
    const newDescriptorCount = sites.filter(
      ({ nodeKind }) => nodeKind === 'NewExpression',
    ).length
    if (
      callDescriptorCount !== callExpressionCount ||
      newDescriptorCount !== newExpressionCount
    ) {
      throw new Error(
        `invocation descriptor coverage incomplete for ${path}: ` +
        `${callDescriptorCount}/${callExpressionCount} calls, ` +
        `${newDescriptorCount}/${newExpressionCount} constructors`,
      )
    }
    return {
      output: ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
        .printFile(result.transformed[0]),
      sites,
      visitedNodeCount: sourceNodeCount,
      callExpressionCount,
      callDescriptorCount,
      newExpressionCount,
      newDescriptorCount,
    }
  } finally {
    result.dispose()
  }
}

export async function instrumentExactPackageAllocations(packageRoot) {
  const absoluteRoot = resolve(packageRoot)
  const files = []
  const sites = []
  const packageFiles = await exactPackageJavaScriptFiles(absoluteRoot)
  const packageSources = new Map(await Promise.all(
    packageFiles.map(async ({ absolutePath, path }) => [
      path,
      await readFile(absolutePath, 'utf8'),
    ]),
  ))
  for (const { absolutePath, path } of packageFiles) {
    const source = packageSources.get(path)
    if (source === undefined) {
      throw new Error(`package source disappeared before instrumentation: ${path}`)
    }
    const instrumented = instrumentSource(
      source,
      path,
      sites.length,
      packageSources,
    )
    const output = `${instrumented.output.trimEnd()}\n`
    await writeFile(absolutePath, output)
    sites.push(...instrumented.sites)
    const exactSiteCount = instrumented.sites.filter(
      ({ classification }) => classification === 'exact',
    ).length
    const allocationFreeSiteCount = instrumented.sites.filter(
      ({ classification }) => classification === 'allocation-free',
    ).length
    const unsupportedSiteCount = instrumented.sites.length -
      exactSiteCount - allocationFreeSiteCount
    files.push({
      path,
      sourceSha256: sha256(source),
      instrumentedSha256: sha256(output),
      siteCount: instrumented.sites.length,
      visitedNodeCount: instrumented.visitedNodeCount,
      exactSiteCount,
      allocationFreeSiteCount,
      unsupportedSiteCount,
      callExpressionCount: instrumented.callExpressionCount,
      callDescriptorCount: instrumented.callDescriptorCount,
      newExpressionCount: instrumented.newExpressionCount,
      newDescriptorCount: instrumented.newDescriptorCount,
    })
  }
  const exactSiteCount = sites.filter(
    ({ classification }) => classification === 'exact',
  ).length
  const allocationFreeSiteCount = sites.filter(
    ({ classification }) => classification === 'allocation-free',
  ).length
  const marker = {
    schemaVersion: EXACT_ALLOCATION_MARKER_PROTOCOL.schemaVersion,
    instrumentation: EXACT_ALLOCATION_INSTRUMENTATION,
    globalSymbol: EXACT_ALLOCATION_GLOBAL_SYMBOL,
    runtime: EXACT_ALLOCATION_RUNTIME_PROTOCOL,
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
      allocationFreeSiteCount,
      unsupportedSiteCount:
        sites.length - exactSiteCount - allocationFreeSiteCount,
      exactKinds: EXACT_ALLOCATION_COVERAGE_PROTOCOL.exactKinds,
      allocationFreeKinds:
        EXACT_ALLOCATION_COVERAGE_PROTOCOL.allocationFreeKinds,
      unsupportedKinds: EXACT_ALLOCATION_COVERAGE_PROTOCOL.unsupportedKinds,
      callExpressionCount: files.reduce(
        (total, file) => total + file.callExpressionCount,
        0,
      ),
      callDescriptorCount: files.reduce(
        (total, file) => total + file.callDescriptorCount,
        0,
      ),
      newExpressionCount: files.reduce(
        (total, file) => total + file.newExpressionCount,
        0,
      ),
      newDescriptorCount: files.reduce(
        (total, file) => total + file.newDescriptorCount,
        0,
      ),
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
