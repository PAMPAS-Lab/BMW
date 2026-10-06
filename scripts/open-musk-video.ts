import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import electronPath from 'electron'
import {ProjectStore} from '../packages/platform/src/project-store.js'
import {LayoutStore} from '../packages/platform/src/layout-store.js'
const root=path.resolve(import.meta.dirname,'..')
const workspace=path.join(root,'.bmw-runtime/video-cases/musk-september-2026')
if(!fs.existsSync(path.join(workspace,'video-studio')))throw new Error('Create the production case before opening its editor.')
// The regular BMW main window, with a disposable profile and persistent case media.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bmw-case-editor-'))
const store=new ProjectStore({filePath:path.join(temporary,'projects.json'),projectsDirectory:path.join(temporary,'projects'),initialWorkspacePath:workspace,onState:undefined})
store.completeInitialSetup({name:'马斯克九月大模型观点',homeUrl:''})
const layout=new LayoutStore({filePath:path.join(temporary,'layout-settings.json'),onState:undefined})
layout.update({configured:true,mode:'sidebar'})
const cleanup=()=>fs.rmSync(temporary,{recursive:true,force:true})
const child=spawn(String(electronPath).trim(),['.'],{cwd:root,stdio:'inherit',env:{...process.env,BMW_PRODUCT_ID:'bmw',BMW_USER_DATA_DIR:temporary,BMW_OPEN_STUDIO:'1'}})
child.once('error',error=>{cleanup();console.error(error.message);process.exitCode=1})
child.once('exit',code=>{cleanup();process.exitCode=code??1})
