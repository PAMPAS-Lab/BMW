import fs from 'node:fs'
import path from 'node:path'
import {interfaces,modules,implementationChecks} from './module-catalog.js'
import {tests} from './test-catalog.js'
import type {SourceGraph} from './source-graph.js'
const begin='<!-- BEGIN GENERATED MODULE CONTRACTS -->',end='<!-- END GENERATED MODULE CONTRACTS -->'
export function architectureInventory(graph:SourceGraph):string{
  const lines=[begin,'','### 模块与允许的依赖','','| 模块 | 职责 | 运行时依赖 | 额外类型依赖 |','|---|---|---|---|']
  for(const module of modules)lines.push(`| ${module.id} | ${module.responsibility} | ${module.runtimeDependencies.join(', ')||'无'} | ${module.typeDependencies?.join(', ')||'无'} |`)
  lines.push('','### 跨模块接口与保障','','| 接口 | 提供方 → 消费方 | 保证 | 直接接口保障测试 |','|---|---|---|---|')
  for(const contract of interfaces)lines.push(`| ${contract.id} | ${contract.provider} → ${contract.consumers.join(', ')} | ${contract.guarantees} | ${contract.tests.join(', ')} |`)
  lines.push('','### 具体实现与产品装配保障','','这些测试验证实现对通用契约的符合性，不能解释为抽象模块的代码依赖。Browser Schema、目录、Bridge 或 MCP 单独改动执行通用 driver 连接保障；DSH 实现、通用 Agent 契约或产品组装改动，以及完整基线执行这些集成保障。','','| 保障 | 归属 | 消费的契约 | 验证内容 | 测试 | 自动选择范围 |','|---|---|---|---|---|---|')
  for(const item of implementationChecks)lines.push(`| ${item.id} | ${item.modules.join(', ')} | ${item.contracts.join(', ')} | ${item.guarantees} | ${item.tests.join(', ')} | ${item.watch.join(', ')} |`)
  lines.push('','### 安装依赖解析','','生产计算式导入默认拒绝；以下安装依赖仅允许 requireDsh.resolve 使用列出的固定包名字面量。额外计算式导入仍被拒绝。','','| 模块 | 文件 | 固定安装包 |','|---|---|---|')
  for(const module of modules)for(const [file,packages] of Object.entries(module.installedImports??{}))lines.push(`| ${module.id} | ${file} | ${packages.join(', ')} |`)
  lines.push('','### 公开入口','','跨模块相对导入也只能指向这些入口；浏览器中的 ES 模块继续使用相对 URL。','')
  for(const [module,files]of Object.entries(graph.exports))lines.push(`- ${module}: ${files.map(file=>'`'+file+'`').join(', ')}`)
  lines.push('','### 分类测试清单','','| ID | 分类 | 归属 | 入口 | 配置／分支 |','|---|---|---|---|---|')
  for(const test of tests)lines.push(`| ${test.id} | ${test.layer}${test.optIn?' (opt-in)':''} | ${test.modules.join(', ')} | ${test.file} | ${[test.group?'group='+test.group:'',...Object.entries(test.env??{}).map(([key,value])=>key+'='+value),test.optIn?'opt-in: '+test.optIn:''].filter(Boolean).join('; ')||'默认'} |`)
  lines.push('',end)
  return lines.join('\n')
}
export function checkArchitectureDocument(root:string,graph:SourceGraph,write=false):void{
  const file=path.join(root,'docs/ARCHITECTURE.md'),document=fs.readFileSync(file,'utf8'),a=document.indexOf(begin),b=document.indexOf(end)
  if(a<0||b<a)throw new Error('Architecture inventory markers are missing.')
  const expected=document.slice(0,a)+architectureInventory(graph)+document.slice(b+end.length)
  if(write)fs.writeFileSync(file,expected)
  else if(expected!==document)throw new Error('Stale module/interface/test documentation; run npm run docs:architecture.')
}
