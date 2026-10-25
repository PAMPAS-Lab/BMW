import {prepareNewsDelivery} from '../packages/feature-video/src/news-delivery.js'
const [projectDirectory,historyFile,draftId,runId,outputDirectory,...extra]=process.argv.slice(2)
if(extra.length||![projectDirectory,historyFile,draftId,runId,outputDirectory].every(Boolean))throw new Error('Usage: node scripts/prepare-news-delivery.js PROJECT_DIRECTORY HISTORY_FILE DRAFT_ID REVIEW_RUN_ID NEW_OUTPUT_DIRECTORY')
console.log(JSON.stringify(await prepareNewsDelivery({projectDirectory,historyFile,draftId,runId,outputDirectory}),null,2))
