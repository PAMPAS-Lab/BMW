/** Compatibility entry; the classified runner owns the complete stability plan. */
import {run} from './test-runner.js'
run({all:true,plan:false,files:[]}).then(code=>{process.exitCode=code}).catch((error:unknown)=>{console.error(error);process.exitCode=1})
