import {architectureViolations,readSourceGraph} from './source-graph.js'
import {catalogViolations} from './test-selection.js'
import {checkArchitectureDocument} from './architecture-document.js'
const root=process.cwd(),graph=readSourceGraph(root),failures=[...architectureViolations(root,graph),...catalogViolations(graph)]
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
else{checkArchitectureDocument(root,graph,process.argv.includes('--write'));console.log('Module public APIs, dependency direction, interface guarantors and test classification are current.')}
