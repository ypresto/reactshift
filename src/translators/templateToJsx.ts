import {
  baseParse,
  ElementTypes,
  NodeTypes as VueNodeTypes,
  type TemplateChildNode,
  type AttributeNode as VueAttributeNode,
  type CommentNode as VueCommentNode,
  type DirectiveNode as VueDirectiveNode,
  type ElementNode as VueElementNode,
  type TextNode as VueTextNode,
} from '@vue/compiler-core'
import { SyntaxKind, ts } from 'ts-morph'

export function translateTemplateToJsx(template: string) {
  // comment to {/* ... */}
  // v-model:foo="bar" to foo={bar} and onChangeFoo={newFoo => bar.value = newFoo}
  // v-model:foo="bar.baz" to foo={bar.baz} and onChangeFoo={newFoo => bar.value.baz = newFoo}
  // :foo="..." to foo={...}
  // @foo="..." to onFoo={...}
  // v-for to {.map()}
  // <div v-if="...">...</div> to {... && <div>...</div>}. Use ESLint to detect 0 && <div /> ?
  // ref="foo" or :ref="foo" to ref={foo}. Mark foo as useRef() not useState().
  // :class="{...}" to className={clsx(...)}

  const vueRootNode = baseParse(template)

  return translateChildrenToSingleJsxElement(vueRootNode.children)
}

function translateChildNodeToJsx(node: TemplateChildNode): ts.JsxChild {
  switch (node.type) {
    case VueNodeTypes.ELEMENT: {
      const typedNode = node as VueElementNode
      const result = translateVueElementNodeToExpression(typedNode)
      if (ts.isJsxChild(result)) return result
      return ts.factory.createJsxExpression(undefined, result)
    }
    case VueNodeTypes.TEXT: {
      const typedNode = node as VueTextNode
      return ts.factory.createJsxText(typedNode.content)
    }
    case VueNodeTypes.COMMENT: {
      const typedNode = node as VueCommentNode
      return translateVueCommentNodeToJsx(typedNode)
    }
    default:
      throw new Error(`Unsupported VueNodeTypes ${node.type} (${node.loc.source})`)
  }
}

function translateVueElementNodeToExpression(
  node: VueElementNode,
  skipFor = false
): ts.JsxElement | ts.JsxFragment | ts.JsxSelfClosingElement | ts.Expression {
  if (!skipFor) {
    const forDirective = findDirective(node, ['for'])
    if (forDirective) {
      return translateForNodeToJsx(node, forDirective)
    }
  }

  const props = translateVuePropsToJsx(node.props)
  const attributes = ts.factory.createJsxAttributes(props)
  // TODO: support slot
  // TODO: support :is
  const children = translateChildrenToJsxElements(node.children)

  if (node.tagType === ElementTypes.TEMPLATE) {
    return ts.factory.createJsxFragment(
      ts.factory.createJsxOpeningFragment(),
      children,
      ts.factory.createJsxJsxClosingFragment()
    )
  }

  const identifier = ts.factory.createIdentifier(node.tag)

  if (children.length === 0) {
    return ts.factory.createJsxSelfClosingElement(identifier, undefined, attributes)
  }

  return ts.factory.createJsxElement(
    ts.factory.createJsxOpeningElement(identifier, undefined, attributes),
    children,
    ts.factory.createJsxClosingElement(identifier)
  )
}

function translateIfBranchesToJsx(
  branches: readonly { node: VueElementNode; directive: VueDirectiveNode }[]
): ts.JsxExpression {
  if (branches.length === 0) {
    throw new Error('branches should not be empty')
  }

  if (branches.length === 1) {
    // <>{condition && <div>...</div>}</>
    return ts.factory.createJsxExpression(
      undefined,
      ts.factory.createBinaryExpression(
        parseExpressionText(branches[0].directive.exp?.loc.source ?? ''),
        SyntaxKind.AmpersandAmpersandToken,
        translateVueElementNodeToExpression(branches[0].node)
      )
    )
  }

  // a ? b : c ? d : e
  const conditionChain = branches.reduceRight(
    (acc: ts.Expression | null, branch) =>
      acc
        ? ts.factory.createConditionalExpression(
            parseExpressionText(branch.directive.exp?.loc.source ?? ''),
            ts.factory.createToken(SyntaxKind.QuestionToken),
            translateVueElementNodeToExpression(branch.node),
            ts.factory.createToken(SyntaxKind.ColonToken),
            acc
          )
        : translateVueElementNodeToExpression(branch.node),
    null
  )!

  return ts.factory.createJsxExpression(undefined, conditionChain)
}

function translateForNodeToJsx(node: VueElementNode, directive: VueDirectiveNode): ts.JsxExpression {
  const forParseResult = directive.forParseResult!
  const source = forParseResult.source.loc.source
  const value = forParseResult.value?.loc.source
  const key = forParseResult.key?.loc.source
  // TODO: if source is object not array, use Object.entries(source)
  const objectIndex = forParseResult.index?.loc.source
  if (objectIndex) {
    throw new Error('object iteration is not supported')
  }

  const parameters: ts.ParameterDeclaration[] = []
  // TODO: manage unwanted shadowing of variable (by _value or _key)
  if (value || key) parameters.push(ts.factory.createParameterDeclaration(undefined, undefined, value ?? '_value'))
  if (key) parameters.push(ts.factory.createParameterDeclaration(undefined, undefined, key ?? '_key'))

  // {source.map((value, key) => <>...</>)}
  return ts.factory.createJsxExpression(
    undefined,
    ts.factory.createCallExpression(parseExpressionText(source + '.map'), undefined, [
      ts.factory.createArrowFunction(
        undefined,
        undefined,
        parameters,
        undefined,
        undefined,
        translateVueElementNodeToExpression(node, true)
      ),
    ])
  )
}

// function translateChildrenToJsxElementOld(node: VueElementNode): ts.JsxElement | ts.JsxFragment {
//   // TODO: Support comment node
//   const children = node.children.map((child, i) => translateVueNodeToJsx(child, i, node))
//   if (children.length === 1) {
//     const el = children[0] as ts.JsxElement
//     return el
//   }
//   return ts.factory.createJsxFragment(
//     ts.factory.createJsxOpeningFragment(),
//     children,
//     ts.factory.createJsxJsxClosingFragment()
//   )
// }

function findDirective(node: VueElementNode, names: string[]): VueDirectiveNode | null {
  return node.props.find(
    prop => prop.type === VueNodeTypes.DIRECTIVE && names.includes(prop.name)
  ) as VueDirectiveNode | null
}

function translateChildrenToSingleJsxElement(children: readonly TemplateChildNode[]): ts.JsxElement | ts.JsxFragment {
  const jsxChildren = translateChildrenToJsxElements(children)

  if (jsxChildren.length === 1) {
    // TODO: Support comment node
    const el = jsxChildren[0] as ts.JsxElement
    return el
  }
  return ts.factory.createJsxFragment(
    ts.factory.createJsxOpeningFragment(),
    jsxChildren,
    ts.factory.createJsxJsxClosingFragment()
  )
}

function translateChildrenToJsxElements(children: readonly TemplateChildNode[]): ts.JsxChild[] {
  const jsxChildren: ts.JsxChild[] = []
  // TODO: Support comment node ({/* ... */})

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (child.type !== VueNodeTypes.ELEMENT) {
      jsxChildren.push(translateChildNodeToJsx(child))
      continue
    }
    const ifDirective = findDirective(child, ['if', 'else-if', 'else'])
    if (ifDirective) {
      if (ifDirective.name !== 'if') {
        // TODO: better error message
        throw new Error('else-if and else should be sibling of if')
      }

      const branches = [{ node: child, directive: ifDirective }]
      i++

      // eagerly collect all branches
      while (i < children.length) {
        const sibling = children[i]
        if (sibling.type === VueNodeTypes.COMMENT) continue // TODO: support comment
        if (sibling.type !== VueNodeTypes.ELEMENT) break
        const directive = findDirective(sibling, ['else-if', 'else'])
        if (!directive) break
        branches.push({ node: sibling, directive })
        i++
      }

      jsxChildren.push(translateIfBranchesToJsx(branches))
      continue
    }

    jsxChildren.push(translateChildNodeToJsx(child))
  }

  return jsxChildren
}

function translateVueCommentNodeToJsx(typedNode: VueCommentNode) {
  const parsed = ts.createSourceFile(
    '',
    `<>{${typedNode.content}}</>`,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX
  )
  const statement = parsed.statements[0]
  if (!ts.isExpressionStatement(statement)) throw new Error('Failed to create comment')
  if (!ts.isJsxFragment(statement.expression)) throw new Error('Failed to create comment')
  if (!ts.isJsxExpression(statement.expression.children[0])) throw new Error('Failed to create comment')
  return statement.expression.children[0]
}

function translateVuePropsToJsx(props: (VueAttributeNode | VueDirectiveNode)[]): ts.JsxAttribute[] {
  return props.flatMap(node => {
    switch (node.type) {
      case VueNodeTypes.ATTRIBUTE: {
        return ts.factory.createJsxAttribute(
          ts.factory.createIdentifier(node.name),
          node.value ? ts.factory.createStringLiteral(node.value.content) : undefined
        )
      }
      case VueNodeTypes.DIRECTIVE: {
        // TODO: plaggable architecture here
        // TODO: determine source is Ref then add .value .
        switch (node.name) {
          case 'bind':
            if (!node.arg) {
              throw new Error('v-bind="..." syntax is not implemented')
            }
            return [
              ts.factory.createJsxAttribute(
                ts.factory.createIdentifier(node.arg.loc.source),
                node.exp
                  ? ts.factory.createJsxExpression(undefined, parseExpressionText(node.exp.loc.source))
                  : undefined
              ),
            ]
          case 'on':
            if (!node.arg) {
              throw new Error('v-on="..." syntax is not supported')
            }
            // TODO: support modifiers (withModifiers())
            return [
              ts.factory.createJsxAttribute(
                ts.factory.createIdentifier(camelize('on-' + node.arg.loc.source)),
                node.exp
                  ? ts.factory.createJsxExpression(undefined, parseExpressionText(node.exp.loc.source))
                  : undefined
              ),
            ]
          case 'model':
            // TODO: native tag form input bindings https://ja.vuejs.org/guide/essentials/forms#form-input-bindings
            // input/textarea -> value & onInput
            // checkbox/radio -> checked & onChange
            // select -> value & onChange

            const name = node.arg?.loc.source ?? 'modelValue'
            debugger
            return [
              ts.factory.createJsxAttribute(
                ts.factory.createIdentifier(name),
                node.exp
                  ? ts.factory.createJsxExpression(undefined, parseExpressionText(node.exp.loc.source))
                  : undefined
              ),
              ts.factory.createJsxAttribute(
                ts.factory.createIdentifier(camelize('onUpdate:' + name)),
                node.exp
                  ? ts.factory.createJsxExpression(
                      undefined,
                      parseExpressionText(`${name} => { ${node.exp.loc.source} = ${name} }`)
                    )
                  : undefined
              ),
            ]
          case 'show':
            // TODO: support
            return []
          case 'for':
          case 'if':
            // handled by
            return []

          default:
            throw new Error(`Unsupported directive ${node.name}`)
        }
      }
    }
  })
}

function parseExpressionText(sourceText: string): ts.Expression {
  const expr = ts.createSourceFile('_expr.ts', sourceText, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
    .statements[0]
  if (!expr || !ts.isExpressionStatement(expr)) {
    throw new Error(`Failed to parse source text: "${sourceText}" results ${JSON.stringify(expr)}`)
  }
  return expr.expression
}

// TODO: 見直し
function camelize(str: string) {
  return str.replaceAll(/-[a-z]/g, prefix => prefix[1].toUpperCase())
}
