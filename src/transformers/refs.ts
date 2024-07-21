import { SourceFile, SyntaxKind, ts } from 'ts-morph'
import { findImportedIdentifier, addImports } from '@/utils/imports.js'

export function transformRefs(sourceFile: SourceFile) {
  // const foo = ref(...) -> const [foo, setFoo] = useState(...)
  // foo.value -> foo
  // foo.value = ... -> setFoo(...)

  // TODO: configurable
  const importedIdentifier = findImportedIdentifier(sourceFile, 'vue', 'ref')
  if (!importedIdentifier) return []

  // TODO: handle ref={...} -> useRef()

  // NOTE: maybe parenthesized  (const foo = ((ref)(...)), or type annotated (const foo = ref(...) as Ref<...>)).
  // Currently both of these are not supported.

  const targets = importedIdentifier
    .findReferencesAsNodes()
    .map(node => {
      // ref(...)
      const referenceIdentifier = node.asKindOrThrow(SyntaxKind.Identifier)
      const callExpression = referenceIdentifier.getParentIfKind(SyntaxKind.CallExpression)
      if (callExpression?.getExpression() !== node) return null

      // const foo = ref(...)
      const variableDeclaration = callExpression.getParentIfKind(SyntaxKind.VariableDeclaration)
      if (variableDeclaration?.getInitializer() != callExpression) return null
      // Can be const [foo, foo2] = ref(...) or something.
      if (!variableDeclaration.getNameNode().isKind(SyntaxKind.Identifier)) return null
      return { variableDeclaration, callExpression }
    })
    .filter(decl => decl != null)

  for (const { variableDeclaration, callExpression } of targets) {
    const nameIdentifier = variableDeclaration.getNameNode().asKindOrThrow(SyntaxKind.Identifier)
    const name = nameIdentifier.getText()
    const nameForSetter = `set${name[0].toUpperCase()}${name.slice(1)}`

    for (const reference of nameIdentifier.findReferencesAsNodes()) {
      const propAccess = reference.getParentIfKind(SyntaxKind.PropertyAccessExpression)
      if (propAccess?.getExpression() !== reference) continue
      if (propAccess.getName() !== 'value') continue

      const binaryExpression = propAccess.getParentIfKind(SyntaxKind.BinaryExpression)
      if (binaryExpression?.getOperatorToken().isKind(SyntaxKind.EqualsToken)) {
        // foo.value = ...
        binaryExpression.transform(() =>
          ts.factory.createCallExpression(ts.factory.createIdentifier(nameForSetter), undefined, [
            binaryExpression.getRight().compilerNode,
          ])
        )
      } else {
        propAccess.transform(() => ts.factory.createIdentifier(name))
      }
    }

    variableDeclaration
      .getNameNode()
      .transform(() =>
        ts.factory.createArrayBindingPattern([
          ts.factory.createBindingElement(undefined, undefined, name),
          ts.factory.createBindingElement(undefined, undefined, nameForSetter),
        ])
      )

    // TODO: rename if variable named 'useState' exists
    callExpression.transform(() =>
      ts.factory.updateCallExpression(
        callExpression.compilerNode,
        ts.factory.createIdentifier('useState'),
        callExpression.compilerNode.typeArguments,
        callExpression.compilerNode.arguments
      )
    )
  }

  if (targets.length > 0) {
    addImports(sourceFile, 'react', ['useState'])
  }
}
