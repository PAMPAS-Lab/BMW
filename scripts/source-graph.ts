import fs from 'node:fs'
import path from 'node:path'
import {isBuiltin} from 'node:module'
import {API} from 'typescript/unstable/sync'
import {SyntaxKind, isCallExpression, isExportDeclaration, isIdentifier, isImportDeclaration, isImportTypeNode, isLiteralTypeNode, isNamedImports, isNamedExports, isStringLiteral, isPropertyAccessExpression} from 'typescript/unstable/ast'
import type {Node, SourceFile} from 'typescript/unstable/ast'
import {modules, ownerOf} from './module-catalog.js'

export interface ImportEdge {specifier: string; typeOnly: boolean; target?: string}
export interface SourceGraph {files: string[]; imports: Record<string, ImportEdge[]>; dynamicImports: string[]; exports: Record<string, string[]>}
export function walkFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const file = path.join(directory,entry.name)
    return entry.isDirectory() ? walkFiles(file) : [file]
  })
}
export function authoredFiles(root: string): string[] {
  return ['apps','packages','scripts','types'].flatMap(dir => walkFiles(path.join(root,dir)))
    .filter(file => /\.(ts|cts|mts|html|css|json|yml)$/.test(file)).map(file => path.relative(root,file).split(path.sep).join('/')).sort()
}
export function importsOf(source: SourceFile, installedPackages: readonly string[] = []): {edges: ImportEdge[]; computed: boolean} {
  const edges: ImportEdge[] = []
  let computed = false
  function visit(node: Node): void {
    if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings
      const typeOnly = clause?.phaseModifier === SyntaxKind.TypeKeyword || Boolean(!clause?.name && named && isNamedImports(named) && named.elements.length && named.elements.every(element => element.isTypeOnly))
      edges.push({specifier:node.moduleSpecifier.text,typeOnly})
    } else if (isExportDeclaration(node) && node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
      edges.push({specifier:node.moduleSpecifier.text,typeOnly:node.isTypeOnly || Boolean(node.exportClause && isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(element => element.isTypeOnly))})
    } else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument) && isStringLiteral(node.argument.literal)) {
      edges.push({specifier:node.argument.literal.text,typeOnly:true})
    } else if (isCallExpression(node) && (node.expression.kind === SyntaxKind.ImportKeyword || isIdentifier(node.expression) && node.expression.text === 'require')) {
      const argument = node.arguments[0]
      if (argument && isStringLiteral(argument)) edges.push({specifier:argument.text,typeOnly:false})
      else if (node.expression.kind === SyntaxKind.ImportKeyword && argument && isCallExpression(argument) &&
          isPropertyAccessExpression(argument.expression) && isIdentifier(argument.expression.expression) &&
          argument.expression.expression.text === 'requireDsh' && argument.expression.name.text === 'resolve' &&
          argument.arguments.length === 1 && isStringLiteral(argument.arguments[0]) && installedPackages.includes(argument.arguments[0].text)) {
        edges.push({specifier: argument.arguments[0].text, typeOnly: false})
      } else computed = true
    }
    node.forEachChild(visit)
  }
  visit(source)
  return {edges,computed}
}
function sourcePath(file: string): string {
  return file.replace(/\.cjs$/,'.cts').replace(/\.mjs$/,'.mts').replace(/\.js$/,'.ts')
}
export function readSourceGraph(root: string): SourceGraph {
  const files = authoredFiles(root), imports: SourceGraph['imports'] = {}, exports: SourceGraph['exports'] = {}, names = new Map<string,string>()
  for (const module of modules.filter(module => module.roots[0].startsWith('packages/'))) {
    const directory = module.roots[0].slice(0,-1)
    const metadata = JSON.parse(fs.readFileSync(path.join(root,directory,'package.json'),'utf8')) as {name:string;exports:string|Record<string,string>}
    const entries = typeof metadata.exports === 'string' ? {'.':metadata.exports} : metadata.exports
    exports[module.id] = Object.values(entries).map(file => path.posix.normalize(directory + '/' + sourcePath(file)))
    for (const [subpath,file] of Object.entries(entries)) names.set(metadata.name + (subpath === '.' ? '' : subpath.slice(1)),path.posix.normalize(directory+'/'+sourcePath(file)))
  }
  const dynamicImports: string[] = []
  const api = new API({cwd:root})
  try {
    const snapshot = api.updateSnapshot({openProjects:[path.join(root,'tsconfig.json')]})
    try {
      const project = snapshot.getProject(path.join(root,'tsconfig.json'))
      if (!project) throw new Error('TypeScript cannot load the BMW project for dependency analysis.')
      for (const file of files.filter(file => /\.(ts|cts|mts)$/.test(file))) {
        const source = project.program.getSourceFile(path.join(root,file))
        if (!source) throw new Error('Authored source is missing from the TypeScript program: ' + file)
        const parsed = importsOf(source, ownerOf(file)?.installedImports?.[file])
        if (parsed.computed) dynamicImports.push(file)
        imports[file] = parsed.edges.map(edge => ({...edge,target:edge.specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file),sourcePath(edge.specifier))) : names.get(edge.specifier)}))
      }
    } finally {snapshot.dispose()}
  } finally {api.close()}
  return {files,imports,dynamicImports,exports}
}
export function architectureViolations(root: string, graph: SourceGraph): string[] {
  const failures: string[] = [], known = new Set(graph.files)
  const privileged = (specifier: string): boolean => isBuiltin(specifier) || /^electron(?:\/|$)/.test(specifier)
  for (const file of graph.dynamicImports) if (!file.includes('/test/') && ownerOf(file)?.id !== 'validation') failures.push(file+': unbounded computed production module import')
  for (const files of Object.values(graph.exports)) for (const file of files) if (file.includes('/test/')) failures.push('Production public entry exposes test code: '+file)
  for (const [file,edges] of Object.entries(graph.imports)) {
    const owner = ownerOf(file)
    if (!owner) {failures.push('Unowned authored file: '+file);continue}
    const test = file.includes('/test/') || owner.id === 'validation'
    for (const edge of edges) {
      if (!test && /^(?:\/|[a-zA-Z]:[\\/]|[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)/.test(edge.specifier)) failures.push(file+': nonportable production module specifier '+edge.specifier)
      if (!edge.target) {
        if (edge.specifier.startsWith('@bmw-agent/')) failures.push(`${file}: unexported package subpath ${edge.specifier}`)
        if (!test && /\/renderer\/|\/src\/media\//.test(file) && privileged(edge.specifier)) failures.push(`${file}: privileged renderer import ${edge.specifier}`)
        continue
      }
      if (!known.has(edge.target)) {failures.push(`${file}: unresolved authored import ${edge.specifier}`);continue}
      if (!test && edge.target.includes('/test/')) failures.push(file+': production import reaches test-only code '+edge.target)
      const dependency = ownerOf(edge.target)
      if (!dependency || owner.id === dependency.id || test) continue
      const allowed = [...owner.runtimeDependencies,...(edge.typeOnly ? owner.typeDependencies ?? [] : [])]
      if (!allowed.includes(dependency.id)) failures.push(`${file}: forbidden ${edge.typeOnly?'type':'runtime'} dependency ${owner.id} -> ${dependency.id}`)
      if (dependency.id !== 'application' && !graph.exports[dependency.id]?.includes(edge.target)) failures.push(`${file}: private cross-module import ${edge.target}`)
    }
  }
  for (const module of modules.filter(module => module.roots[0].startsWith('packages/'))) {
    const directory=module.roots[0].slice(0,-1), metadata=JSON.parse(fs.readFileSync(path.join(root,directory,'package.json'),'utf8')) as {dependencies?:Record<string,string>}
    const required=new Set(Object.entries(graph.imports).filter(([file])=>ownerOf(file)?.id===module.id&&!file.includes('/test/')).flatMap(([,edges])=>edges.map(edge=>edge.target&&ownerOf(edge.target)?.id).filter(id=>id&&id!==module.id)))
    for (const dependency of required) if(!metadata.dependencies?.['@bmw-agent/'+dependency])failures.push(`${module.id}: missing workspace dependency ${dependency}`)
  }
  // Chromium modules cannot reach privileged services indirectly through a helper.
  for (const file of Object.keys(graph.imports).filter(file => /\/renderer\/|\/src\/media\//.test(file) && !file.includes('/test/'))) {
    const visited = new Set<string>()
    function inspect(current: string): void {
      if (visited.has(current)) return
      visited.add(current)
      for (const edge of graph.imports[current] ?? []) {
        if (edge.typeOnly) continue
        if (privileged(edge.specifier)) failures.push(`${file}: privileged renderer import via ${current}: ${edge.specifier}`)
        if (edge.target) inspect(edge.target)
      }
    }
    inspect(file)
  }
  // Runtime cycles are forbidden. Deliberate type-only consumer/host edges are erased.
  const active=new Set<string>(),done=new Set<string>()
  function visit(id:string):void {
    if(active.has(id)){failures.push('Runtime dependency cycle at '+id);return}
    if(done.has(id))return
    active.add(id)
    const targets=new Set(Object.entries(graph.imports).filter(([file])=>ownerOf(file)?.id===id&&!file.includes('/test/')).flatMap(([,edges])=>edges.filter(edge=>!edge.typeOnly).map(edge=>edge.target&&ownerOf(edge.target)?.id).filter(target=>target&&target!==id)))
    for(const target of targets)visit(target)
    active.delete(id);done.add(id)
  }
  for(const module of modules.filter(module=>module.id!=='validation'))visit(module.id)
  return [...new Set(failures)].sort()
}
