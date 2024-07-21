import type { SourceFile } from 'ts-morph'

export function findImportedIdentifier(sourceFile: SourceFile, moduleSpecifier: string, name: string) {
  if (name === 'default') {
    throw new Error('default import is not implemented')
  }

  const importSpecifier = sourceFile
    .getImportDeclarations()
    .filter(decl => decl.getModuleSpecifierValue() === moduleSpecifier)
    .flatMap(decl => decl.getNamedImports())
    .reverse()
    .find(bindings => bindings.getName() === name)
  return importSpecifier?.getAliasNode() ?? importSpecifier?.getNameNode() ?? null
}

export function addImports(sourceFile: SourceFile, moduleSpecifier: string, namedImports: string[]) {
  // TODO: rename existing import if there is a conflict
  const importDeclaration = sourceFile.getImportDeclaration(moduleSpecifier)
  if (!importDeclaration) {
    sourceFile.addImportDeclaration({ moduleSpecifier, namedImports })
    return
  }

  const existingImportedNames = sourceFile
    .getImportDeclarations()
    .flatMap(decl => decl.getNamedImports())
    .filter(specifier => specifier.getAliasNode() == null)
    .map(specifier => specifier.getName())
  const existingImportedNameSet = new Set(existingImportedNames)

  if (!importDeclaration.getNamedImports().some(specifier => namedImports.includes(specifier.getName()))) {
    importDeclaration.addNamedImports(namedImports.filter(name => !existingImportedNameSet.has(name)))
  }
}
